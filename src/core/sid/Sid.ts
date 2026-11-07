import type { MemoryMappedDevice } from '../io/Device';
import { SidFilter } from './SidFilter';
import type { SidChipModel } from './SidModel';
import { PAL_SID_CLOCK_HZ, SID_MODEL_CHARACTERISTICS } from './SidModel';
import { SidVoice } from './SidVoice';

export interface SidSnapshot {
  readonly model: SidChipModel;
  readonly registers: Uint8Array;
  readonly busValue: number;
  readonly voiceAccumulators: readonly [number, number, number];
  readonly envelopeLevels: readonly [number, number, number];
  readonly filterCutoffHz: number;
  readonly output: number;
}

interface PendingWrite {
  readonly register: number;
  readonly value: number;
}

/**
 * MOS 6581/8580 SID: cycle-clocked digital voices, envelope generators,
 * filter/mixer, model-specific bus semantics, and deterministic PCM decimation.
 */
export class Sid implements MemoryMappedDevice {
  public readonly voices: readonly [SidVoice, SidVoice, SidVoice];
  public readonly filter: SidFilter;

  private readonly registers = new Uint8Array(0x20);
  private modelValue: SidChipModel;
  private clockFrequency: number;
  private busValue = 0;
  private busTtl = 0;
  private pending8580Write: PendingWrite | null = null;
  private potX = 0xff;
  private potY = 0xff;
  private outputValue = 0;

  private audioSampleRate = 0;
  private audioPhase = 0;
  private audioAccumulator = 0;
  private audioAccumulatorCycles = 0;
  private audioQueue: number[] = [];

  constructor(model: SidChipModel = '6581', clockFrequency = PAL_SID_CLOCK_HZ) {
    this.modelValue = model;
    this.clockFrequency = clockFrequency;
    this.voices = [new SidVoice(model), new SidVoice(model), new SidVoice(model)];
    this.filter = new SidFilter(model, clockFrequency);
    this.reset();
  }

  read(offset: number): number {
    const register = offset & 0x1f;
    const value = this.readRegister(register);
    this.refreshBus(value);
    return value;
  }

  peek(offset: number): number {
    return this.readRegister(offset & 0x1f);
  }

  write(offset: number, value: number): void {
    const register = offset & 0x1f;
    const byte = value & 0xff;
    this.refreshBus(byte);

    if (this.modelValue === '8580') {
      this.pending8580Write = { register, value: byte };
      return;
    }

    this.applyWrite(register, byte);
  }

  reset(): void {
    this.registers.fill(0);
    for (const voice of this.voices) voice.reset();
    this.filter.reset();
    this.busValue = 0;
    this.busTtl = 0;
    this.pending8580Write = null;
    this.outputValue = 0;
    this.audioPhase = 0;
    this.audioAccumulator = 0;
    this.audioAccumulatorCycles = 0;
    this.audioQueue = [];
  }

  tick(cycles = 1): void {
    if (!Number.isInteger(cycles) || cycles < 0) {
      throw new RangeError(`SID cycle count must be a non-negative integer; received ${cycles}.`);
    }
    for (let cycle = 0; cycle < cycles; cycle += 1) this.clockOneCycle();
  }

  setModel(model: SidChipModel): void {
    if (model === this.modelValue) return;
    this.modelValue = model;
    for (const voice of this.voices) voice.setModel(model);
    this.filter.setModel(model);
    this.busTtl = Math.min(this.busTtl, SID_MODEL_CHARACTERISTICS[model].databusTtlCycles);
  }

  setClockFrequency(clockFrequency: number): void {
    if (!Number.isFinite(clockFrequency) || clockFrequency <= 0) {
      throw new RangeError('SID clock frequency must be positive.');
    }
    this.clockFrequency = clockFrequency;
    this.filter.setClockFrequency(clockFrequency);
  }

  configureAudio(sampleRate: number): void {
    if (!Number.isFinite(sampleRate) || sampleRate < 8_000 || sampleRate > 192_000) {
      throw new RangeError(`Unsupported SID audio sample rate: ${sampleRate}.`);
    }
    this.audioSampleRate = sampleRate;
    this.audioPhase = 0;
    this.audioAccumulator = 0;
    this.audioAccumulatorCycles = 0;
    this.audioQueue = [];
  }

  disableAudio(): void {
    this.audioSampleRate = 0;
    this.audioQueue = [];
    this.audioAccumulator = 0;
    this.audioAccumulatorCycles = 0;
  }

  drainAudioSamples(): Float32Array {
    const result = Float32Array.from(this.audioQueue);
    this.audioQueue = [];
    return result;
  }

  setPotX(value: number): void { this.potX = value & 0xff; }
  setPotY(value: number): void { this.potY = value & 0xff; }
  setExternalInput(sample: number): void { this.filter.setExternalInput(sample); }

  snapshot(): SidSnapshot {
    return {
      model: this.modelValue,
      registers: this.registers.slice(),
      busValue: this.busValue,
      voiceAccumulators: [
        this.voices[0].oscillator.accumulator,
        this.voices[1].oscillator.accumulator,
        this.voices[2].oscillator.accumulator
      ],
      envelopeLevels: [
        this.voices[0].envelope.level,
        this.voices[1].envelope.level,
        this.voices[2].envelope.level
      ],
      filterCutoffHz: this.filter.cutoffHz,
      output: this.outputValue
    };
  }

  get model(): SidChipModel { return this.modelValue; }
  get output(): number { return this.outputValue; }
  get lastBusValue(): number { return this.busValue; }
  get busValueTtl(): number { return this.busTtl; }
  get queuedAudioSamples(): number { return this.audioQueue.length; }

  private clockOneCycle(): void {
    for (const voice of this.voices) voice.envelope.clock();
    for (const voice of this.voices) voice.oscillator.clockPhase();

    this.voices[0].oscillator.synchronizeFrom(this.voices[2].oscillator, this.voices[1].oscillator);
    this.voices[1].oscillator.synchronizeFrom(this.voices[0].oscillator, this.voices[2].oscillator);
    this.voices[2].oscillator.synchronizeFrom(this.voices[1].oscillator, this.voices[0].oscillator);

    this.voices[0].oscillator.calculateWaveform(this.voices[2].oscillator);
    this.voices[1].oscillator.calculateWaveform(this.voices[0].oscillator);
    this.voices[2].oscillator.calculateWaveform(this.voices[1].oscillator);

    this.outputValue = this.filter.clock({
      voice1: this.voices[0].output(),
      voice2: this.voices[1].output(),
      voice3: this.voices[2].output(),
      external: this.filter.externalInput
    });

    this.clockAudioSampler();

    // 8580 register writes are delayed one SID cycle. Applying after the
    // current clock means the new value affects the following cycle.
    if (this.pending8580Write !== null) {
      const pending = this.pending8580Write;
      this.pending8580Write = null;
      this.applyWrite(pending.register, pending.value);
    }

    if (this.busTtl > 0) {
      this.busTtl -= 1;
      if (this.busTtl === 0) this.busValue = 0;
    }
  }

  private readRegister(register: number): number {
    switch (register) {
      case 0x19: return this.potX;
      case 0x1a: return this.potY;
      case 0x1b: return this.voices[2].oscillator.oscByte;
      case 0x1c: return this.voices[2].envelope.readbackLevel;
      default: return this.busValue;
    }
  }

  private applyWrite(register: number, value: number): void {
    if (register <= 0x18) this.registers[register] = value;

    if (register <= 0x14) {
      const voiceIndex = Math.floor(register / 7);
      const voiceOffset = register % 7;
      const voice = this.voices[voiceIndex];
      if (voice === undefined) return;
      switch (voiceOffset) {
        case 0: voice.oscillator.writeFrequencyLow(value); break;
        case 1: voice.oscillator.writeFrequencyHigh(value); break;
        case 2: voice.oscillator.writePulseLow(value); break;
        case 3: voice.oscillator.writePulseHigh(value); break;
        case 4: voice.writeControl(value); break;
        case 5: voice.envelope.writeAttackDecay(value); break;
        case 6: voice.envelope.writeSustainRelease(value); break;
      }
      return;
    }

    switch (register) {
      case 0x15: this.filter.writeCutoffLow(value); break;
      case 0x16: this.filter.writeCutoffHigh(value); break;
      case 0x17: this.filter.writeResonanceRouting(value); break;
      case 0x18: this.filter.writeModeVolume(value); break;
      default: break;
    }
  }

  private refreshBus(value: number): void {
    this.busValue = value & 0xff;
    this.busTtl = SID_MODEL_CHARACTERISTICS[this.modelValue].databusTtlCycles;
  }

  private clockAudioSampler(): void {
    if (this.audioSampleRate === 0) return;

    this.audioAccumulator += this.outputValue;
    this.audioAccumulatorCycles += 1;
    this.audioPhase += this.audioSampleRate;

    if (this.audioPhase < this.clockFrequency) return;
    this.audioPhase -= this.clockFrequency;

    const average = this.audioAccumulatorCycles === 0
      ? this.outputValue
      : this.audioAccumulator / this.audioAccumulatorCycles;
    this.audioQueue.push(Math.max(-1, Math.min(1, average)));
    this.audioAccumulator = 0;
    this.audioAccumulatorCycles = 0;
  }
}
