import type { SidChipModel } from './SidModel';

const ACC_MASK = 0x00ff_ffff;
const LFSR_MASK = 0x007f_ffff;
const LFSR_RESET_SEED = 0x007f_fff8;

export class SidOscillator {
  private frequencyValue = 0;
  private pulseWidthValue = 0;
  private controlValue = 0;
  // Die-informed power-up pattern: even accumulator bits are high. RESET does
  // not clear this accumulator; TEST is the hardware phase-clear mechanism.
  private accumulatorValue = 0x0055_5555;
  private lfsr = LFSR_RESET_SEED;
  private shiftDelay = 0;
  private testShiftResetTtl = 0;
  private msbRose = false;
  private pulseOutput = 0xfff;
  private waveformOutput = 0;
  private oscReadOutput = 0;
  private floatingOutput = 0;
  private floatingTtl = 0;

  constructor(private model: SidChipModel) {
    this.reset();
  }

  reset(): void {
    this.frequencyValue = 0;
    this.pulseWidthValue = 0;
    this.controlValue = 0;
    // RESET leaves the phase accumulator untouched. The noise register exits
    // reset at $7FFFFE; the familiar $7FFFF8 test sequence appears after the
    // following internal shifts.
    this.lfsr = 0x007f_fffe;
    this.shiftDelay = 0;
    this.testShiftResetTtl = 0;
    this.msbRose = false;
    this.pulseOutput = 0xfff;
    this.waveformOutput = 0;
    this.oscReadOutput = 0;
    this.floatingOutput = 0;
    this.floatingTtl = 0;
  }

  setModel(model: SidChipModel): void {
    this.model = model;
  }

  writeFrequencyLow(value: number): void {
    this.frequencyValue = (this.frequencyValue & 0xff00) | (value & 0xff);
  }

  writeFrequencyHigh(value: number): void {
    this.frequencyValue = ((value & 0xff) << 8) | (this.frequencyValue & 0xff);
  }

  writePulseLow(value: number): void {
    this.pulseWidthValue = (this.pulseWidthValue & 0x0f00) | (value & 0xff);
    this.refreshPulseComparator();
  }

  writePulseHigh(value: number): void {
    this.pulseWidthValue = ((value & 0x0f) << 8) | (this.pulseWidthValue & 0xff);
    this.refreshPulseComparator();
  }

  writeControl(value: number): void {
    const previous = this.controlValue;
    const wasTest = (previous & 0x08) !== 0;
    const test = (value & 0x08) !== 0;
    const hadWaveform = (previous & 0xf0) !== 0;
    const hasWaveform = (value & 0xf0) !== 0;

    this.controlValue = value & 0xff;

    if (!wasTest && test) {
      this.accumulatorValue = 0;
      this.shiftDelay = 0;
      this.testShiftResetTtl = this.model === '6581' ? 35_000 : 2_519_864;
      this.pulseOutput = 0xfff;
    } else if (wasTest && !test) {
      // TEST release completes the first phase of the noise-register shift.
      // With TEST high the feedback input behaves as 1 XOR bit17.
      const feedback = (~this.lfsr >>> 17) & 0x01;
      this.lfsr = ((this.lfsr << 1) | feedback) & LFSR_MASK;
      this.shiftDelay = 0;
      this.testShiftResetTtl = 0;
    }

    if (hadWaveform && !hasWaveform) {
      this.floatingOutput = this.waveformOutput;
      this.floatingTtl = this.model === '6581' ? 182_000 : 4_400_000;
    }
  }

  clockPhase(): void {
    this.msbRose = false;

    if (this.testEnabled) {
      this.accumulatorValue = 0;
      this.pulseOutput = 0xfff;
      this.clockTestShiftRegisterReset();
      return;
    }

    if (this.shiftDelay > 0) {
      this.shiftDelay -= 1;
      if (this.shiftDelay === 0) this.clockNoiseLfsr();
    }

    const previous = this.accumulatorValue;
    const next = (previous + this.frequencyValue) & ACC_MASK;
    const rising = (~previous & next) & ACC_MASK;
    this.accumulatorValue = next;
    this.msbRose = (rising & 0x800000) !== 0;

    // Noise is clocked from an accumulator bit-19 rising edge, with the known
    // two-cycle internal pipeline between edge detection and LFSR shift.
    if ((rising & 0x080000) !== 0) this.shiftDelay = 2;
  }

  synchronizeFrom(source: SidOscillator, sourceSource: SidOscillator): void {
    if (!source.msbRising || !this.syncEnabled) return;
    if (source.syncEnabled && sourceSource.msbRising) return;
    this.accumulatorValue = 0;
  }

  calculateWaveform(syncSource: SidOscillator): number {
    const waveform = this.waveformBits;

    if (waveform === 0) {
      if (this.model === '8580') {
        this.waveformOutput = 0;
        this.oscReadOutput = 0;
        return 0;
      }
      if (this.floatingTtl > 0) {
        this.floatingTtl -= 1;
        if (this.floatingTtl === 0) this.floatingOutput = 0;
      }
      this.waveformOutput = this.floatingOutput;
      this.oscReadOutput = this.waveformOutput;
      return this.waveformOutput;
    }

    const saw = (this.accumulatorValue >>> 12) & 0x0fff;
    const sourceMsb = (syncSource.accumulatorValue & 0x800000) !== 0;
    const ownMsb = (this.accumulatorValue & 0x800000) !== 0;
    const ringActive = this.ringEnabled && (waveform & 0x01) !== 0 && (waveform & 0x02) === 0;
    // Ring modulation substitutes the triangle MSB with ownMSB XOR NOT sourceMSB.
    const triangleMsb = ringActive ? ownMsb === sourceMsb : ownMsb;
    const folded = triangleMsb ? (~this.accumulatorValue & ACC_MASK) : this.accumulatorValue;
    const triangle = (folded >>> 11) & 0x0ffe;
    const pulse = this.testEnabled ? 0x0fff : this.pulseOutput;
    const noise = this.noiseOutput12();

    let output: number;
    const normalBits = waveform & 0x07;
    const noiseSelected = (waveform & 0x08) !== 0;

    if (noiseSelected && normalBits !== 0) {
      // Combined NOISE waveforms physically short selector lines together.
      // Model that as an AND-like output plus destructive write-back into the
      // visible LFSR taps; this naturally tends toward the familiar lock-up.
      const normal = this.combineNormalWaveforms(normalBits, triangle, saw, pulse);
      output = normal & noise;
      this.writeNoiseVisibleBits(output);
    } else if (noiseSelected) {
      output = noise;
    } else if (normalBits === 0x01) {
      output = triangle;
    } else if (normalBits === 0x02) {
      output = saw;
    } else if (normalBits === 0x04) {
      output = pulse;
    } else {
      output = this.combineNormalWaveforms(normalBits, triangle, saw, pulse);
    }

    const previousOutput = this.waveformOutput;
    this.waveformOutput = output & 0x0fff;
    this.floatingOutput = this.waveformOutput;

    // On 8580, triangle/sawtooth appear one full SID cycle later at OSC3.
    // Pulse already has its own one-cycle comparator latch.
    this.oscReadOutput = this.model === '8580' && (waveform & 0x03) !== 0
      ? previousOutput
      : this.waveformOutput;

    // Combined 6581 waveforms containing saw can pull accumulator MSB low
    // through the selector/DAC network. This is observable in OSC3 sweeps.
    if (this.model === '6581' && (waveform & 0x02) !== 0 && (waveform & 0x0d) !== 0) {
      this.accumulatorValue &= ((this.waveformOutput << 12) | 0x7fffff) & ACC_MASK;
    }

    // The pulse comparator is latched one cycle after the phase comparison.
    this.refreshPulseComparator();
    return this.waveformOutput;
  }

  get frequency(): number { return this.frequencyValue; }
  get pulseWidth(): number { return this.pulseWidthValue; }
  get control(): number { return this.controlValue; }
  get accumulator(): number { return this.accumulatorValue; }
  get noiseShiftRegister(): number { return this.lfsr; }
  get msbRising(): boolean { return this.msbRose; }
  get syncEnabled(): boolean { return (this.controlValue & 0x02) !== 0; }
  get ringEnabled(): boolean { return (this.controlValue & 0x04) !== 0; }
  get testEnabled(): boolean { return (this.controlValue & 0x08) !== 0; }
  get gateEnabled(): boolean { return (this.controlValue & 0x01) !== 0; }
  get waveformBits(): number { return (this.controlValue >>> 4) & 0x0f; }
  get output12(): number { return this.waveformOutput; }
  get oscByte(): number { return (this.oscReadOutput >>> 4) & 0xff; }

  private refreshPulseComparator(): void {
    this.pulseOutput = ((this.accumulatorValue >>> 12) & 0x0fff) >= this.pulseWidthValue
      ? 0x0fff
      : 0x0000;
  }

  private clockNoiseLfsr(): void {
    const feedback = ((this.lfsr >>> 22) ^ (this.lfsr >>> 17)) & 0x01;
    this.lfsr = ((this.lfsr << 1) | feedback) & LFSR_MASK;
  }


  private clockTestShiftRegisterReset(): void {
    if (this.testShiftResetTtl <= 0) return;
    this.testShiftResetTtl -= 1;
    if (this.testShiftResetTtl !== 0) return;

    // SRAM cells in the noise register slowly charge high while TEST is set.
    // Propagating adjacent ones approximates the measured bit-fade sequence.
    this.lfsr |= 1;
    this.lfsr |= (this.lfsr << 1) & LFSR_MASK;
    if (this.lfsr !== LFSR_MASK) {
      this.testShiftResetTtl = this.model === '6581' ? 1_000 : 315_000;
    }
  }

  private writeNoiseVisibleBits(output: number): void {
    const visibleMask = 0x100000 | 0x040000 | 0x004000 | 0x000800 |
      0x000200 | 0x000020 | 0x000004 | 0x000001;
    let selected = 0;
    if ((output & 0x800) !== 0) selected |= 0x100000;
    if ((output & 0x400) !== 0) selected |= 0x040000;
    if ((output & 0x200) !== 0) selected |= 0x004000;
    if ((output & 0x100) !== 0) selected |= 0x000800;
    if ((output & 0x080) !== 0) selected |= 0x000200;
    if ((output & 0x040) !== 0) selected |= 0x000020;
    if ((output & 0x020) !== 0) selected |= 0x000004;
    if ((output & 0x010) !== 0) selected |= 0x000001;
    this.lfsr &= (~visibleMask | selected) & LFSR_MASK;
  }
  private noiseOutput12(): number {
    // Fixed selector wiring: LFSR bits 20,18,14,11,9,5,2,0 feed DAC bits 11..4.
    return (
      ((this.lfsr & 0x100000) >>> 9) |
      ((this.lfsr & 0x040000) >>> 8) |
      ((this.lfsr & 0x004000) >>> 5) |
      ((this.lfsr & 0x000800) >>> 3) |
      ((this.lfsr & 0x000200) >>> 2) |
      ((this.lfsr & 0x000020) << 1) |
      ((this.lfsr & 0x000004) << 3) |
      ((this.lfsr & 0x000001) << 4)
    ) & 0x0ff0;
  }

  private combineNormalWaveforms(bits: number, triangle: number, saw: number, pulse: number): number {
    const hasTriangle = (bits & 0x01) !== 0;
    const hasSaw = (bits & 0x02) !== 0;
    const hasPulse = (bits & 0x04) !== 0;

    let base: number;
    if (hasTriangle && !hasSaw) base = triangle;
    else if (hasSaw && !hasTriangle) base = saw;
    else if (hasTriangle && hasSaw) base = this.model === '6581' ? (triangle & saw) : saw;
    else base = 0x0fff;

    if (this.model === '6581') {
      base = erode12(base);
      base = erode12(base);
    } else if (hasPulse && !(hasTriangle && hasSaw)) {
      base = majority12(base);
    } else {
      base = erode12(base);
    }

    if (hasPulse) base &= pulse;
    return base & 0x0fff;
  }
}

function erode12(value: number): number {
  return value & ((value << 1) & 0x0fff) & (value >>> 1) & 0x0fff;
}

function majority12(value: number): number {
  const left = (value << 1) & 0x0fff;
  const right = value >>> 1;
  return ((value & left) | (value & right) | (left & right)) & 0x0fff;
}
