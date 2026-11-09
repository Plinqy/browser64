import type { SidChipModel } from './SidModel';
import { SID_MODEL_CHARACTERISTICS } from './SidModel';


export interface SidFilterState {
  readonly fc: number;
  readonly resonance: number;
  readonly routing: number;
  readonly modeVolume: number;
  readonly lp: number;
  readonly bp: number;
  readonly hp: number;
  readonly extLowpass: number;
  readonly extDc: number;
  readonly externalInput: number;
  readonly output: number;
}

export interface SidFilterInput {
  readonly voice1: number;
  readonly voice2: number;
  readonly voice3: number;
  readonly external: number;
}

const VOICE_SCALE = 1 / 900_000;
const OUTPUT_GAIN = 0.30;
const FC_6581 = build6581CutoffTable();
const FC_8580 = build8580CutoffTable();

/**
 * Cycle-rate state-variable SID filter plus the C64 motherboard output RC path.
 *
 * The filter topology and register routing follow the chip. The 8580 cutoff
 * characteristic is close to the documented 30 Hz..12 kHz line. The 6581
 * lookup is an independent representative curve with the measured-family
 * nonlinearity/discontinuity; individual 6581 chips vary enough that no single
 * table can be universally exact.
 */
export class SidFilter {
  private fc = 0;
  private resonance = 0;
  private routing = 0;
  private modeVolume = 0;
  private lp = 0;
  private bp = 0;
  private hp = 0;
  private extLowpass = 0;
  private extDc = 0;
  private externalInputValue = 0;
  private outputValue = 0;

  private filterCoefficient = 0;
  private damping = 1 / 0.707;
  private externalLowpassAlpha = 0;
  private externalHighpassAlpha = 0;

  constructor(private model: SidChipModel, private clockHz: number) {
    this.updateCoefficients();
  }

  reset(): void {
    this.fc = 0;
    this.resonance = 0;
    this.routing = 0;
    this.modeVolume = 0;
    this.lp = 0;
    this.bp = 0;
    this.hp = 0;
    this.extLowpass = 0;
    this.extDc = 0;
    this.externalInputValue = 0;
    this.outputValue = 0;
    this.updateCoefficients();
  }

  setModel(model: SidChipModel): void {
    this.model = model;
    this.updateFilterCoefficient();
    this.updateDamping();
  }

  saveState(): SidFilterState {
    return {
      fc: this.fc, resonance: this.resonance, routing: this.routing, modeVolume: this.modeVolume,
      lp: this.lp, bp: this.bp, hp: this.hp, extLowpass: this.extLowpass, extDc: this.extDc,
      externalInput: this.externalInputValue, output: this.outputValue
    };
  }

  restoreState(state: SidFilterState): void {
    this.fc = state.fc & 0x07ff; this.resonance = state.resonance & 0x0f; this.routing = state.routing & 0x0f;
    this.modeVolume = state.modeVolume & 0xff; this.lp = state.lp; this.bp = state.bp; this.hp = state.hp;
    this.extLowpass = state.extLowpass; this.extDc = state.extDc; this.externalInputValue = state.externalInput;
    this.outputValue = state.output; this.updateCoefficients();
  }

  setClockFrequency(clockHz: number): void {
    this.clockHz = clockHz;
    this.updateCoefficients();
  }

  writeCutoffLow(value: number): void {
    this.fc = (this.fc & 0x07f8) | (value & 0x07);
    this.updateFilterCoefficient();
  }

  writeCutoffHigh(value: number): void {
    this.fc = ((value & 0xff) << 3) | (this.fc & 0x07);
    this.updateFilterCoefficient();
  }

  writeResonanceRouting(value: number): void {
    this.resonance = (value >>> 4) & 0x0f;
    this.routing = value & 0x0f;
    this.updateDamping();
  }

  writeModeVolume(value: number): void {
    this.modeVolume = value & 0xff;
  }

  setExternalInput(sample: number): void {
    this.externalInputValue = clamp(sample, -1, 1);
  }

  clock(input: SidFilterInput): number {
    let filtered = 0;
    let unfiltered = 0;

    const v1 = input.voice1 * VOICE_SCALE;
    const v2 = input.voice2 * VOICE_SCALE;
    const v3 = input.voice3 * VOICE_SCALE;

    if ((this.routing & 0x01) !== 0) filtered += v1; else unfiltered += v1;
    if ((this.routing & 0x02) !== 0) filtered += v2; else unfiltered += v2;
    if ((this.routing & 0x04) !== 0) filtered += v3;
    else if (!this.voice3Off) unfiltered += v3;

    if ((this.routing & 0x08) !== 0) filtered += input.external;
    else unfiltered += input.external;

    // Two-integrator state-variable filter evaluated at the SID clock rate.
    this.hp = filtered - this.lp - this.damping * this.bp;
    this.bp += this.filterCoefficient * this.hp;
    this.lp += this.filterCoefficient * this.bp;

    let filteredOut = 0;
    if ((this.modeVolume & 0x10) !== 0) filteredOut += this.lp;
    if ((this.modeVolume & 0x20) !== 0) filteredOut += this.bp;
    if ((this.modeVolume & 0x40) !== 0) filteredOut += this.hp;

    const volume = (this.modeVolume & 0x0f) / 15;
    const modelDc = SID_MODEL_CHARACTERISTICS[this.model].mixerDc * VOICE_SCALE;
    const chipOut = (unfiltered + filteredOut + modelDc) * volume;

    // Motherboard output network: approximately 16 kHz LP then 1.6 Hz DC block.
    this.extLowpass += this.externalLowpassAlpha * (chipOut - this.extLowpass);
    this.extDc += this.externalHighpassAlpha * (this.extLowpass - this.extDc);
    this.outputValue = clamp((this.extLowpass - this.extDc) * OUTPUT_GAIN, -1, 1);
    return this.outputValue;
  }

  get cutoffRegister(): number { return this.fc; }
  get cutoffHz(): number { return cutoffForModel(this.model, this.fc); }
  get resonanceValue(): number { return this.resonance; }
  get routingMask(): number { return this.routing; }
  get volume(): number { return this.modeVolume & 0x0f; }
  get modeBits(): number { return (this.modeVolume >>> 4) & 0x07; }
  get voice3Off(): boolean { return (this.modeVolume & 0x80) !== 0; }
  get output(): number { return this.outputValue; }
  get externalInput(): number { return this.externalInputValue; }

  private updateCoefficients(): void {
    this.updateFilterCoefficient();
    this.updateDamping();
    this.externalLowpassAlpha = 1 - Math.exp((-2 * Math.PI * 16_000) / this.clockHz);
    this.externalHighpassAlpha = 1 - Math.exp((-2 * Math.PI * 1.6) / this.clockHz);
  }

  private updateFilterCoefficient(): void {
    const cutoff = cutoffForModel(this.model, this.fc);
    this.filterCoefficient = Math.min(0.99, 2 * Math.sin(Math.PI * cutoff / this.clockHz));
  }

  private updateDamping(): void {
    if (this.model === '8580') {
      // The 8580 resonance control is close to the measured exponential 1/Q
      // law. Using the register-domain law here is both stable and a better
      // fit than sharing the much less regular 6581 mapping.
      this.damping = Math.pow(2, (4 - this.resonance) / 8);
      return;
    }

    // Die-level ladder topology gives an idealized 1/Q of roughly
    // (~RES & $0f) / 8. Real 6581 op-amp gain prevents the lowest settings
    // from reaching the very low ideal Q, so cap that end near Q ~= 0.85.
    // At the high-resonance end retain a finite floor for numerical stability
    // until the planned nonlinear op-amp/VCR model replaces this SVF.
    const ladderDamping = (15 - this.resonance) / 8;
    this.damping = Math.max(1 / 12, Math.min(1 / 0.85, ladderDamping));
  }
}

export function cutoffForModel(model: SidChipModel, register: number): number {
  const fc = Math.max(0, Math.min(0x7ff, register | 0));
  return model === '8580' ? FC_8580[fc]! : FC_6581[fc]!;
}

function build8580CutoffTable(): Float64Array {
  const table = new Float64Array(0x800);
  for (let fc = 0; fc < table.length; fc += 1) {
    table[fc] = 30 + (fc / 0x7ff) * (12_000 - 30);
  }
  return table;
}

function build6581CutoffTable(): Float64Array {
  const points: ReadonlyArray<readonly [number, number]> = [
    [0, 220], [128, 235], [256, 310], [384, 560], [512, 1_200],
    [640, 2_450], [768, 4_050], [896, 5_500], [1023, 6_000],
    [1024, 4_600], [1152, 5_300], [1280, 6_300], [1536, 9_200],
    [1792, 13_200], [2047, 18_000]
  ];
  const table = new Float64Array(0x800);
  let segment = 1;

  for (let fc = 0; fc < table.length; fc += 1) {
    while (segment < points.length - 1 && fc > points[segment]![0]) segment += 1;
    const right = points[segment]!;
    const left = points[segment - 1]!;
    const span = right[0] - left[0];
    const t = span === 0 ? 0 : (fc - left[0]) / span;
    table[fc] = left[1] + (right[1] - left[1]) * t;
  }
  return table;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
