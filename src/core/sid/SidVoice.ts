import { sidWaveDac } from './SidDac';
import { SidEnvelope } from './SidEnvelope';
import type { SidChipModel } from './SidModel';
import { SID_MODEL_CHARACTERISTICS } from './SidModel';
import { SidOscillator } from './SidOscillator';

export class SidVoice {
  public readonly oscillator: SidOscillator;
  public readonly envelope: SidEnvelope;

  constructor(private model: SidChipModel) {
    this.oscillator = new SidOscillator(model);
    this.envelope = new SidEnvelope(model);
  }

  reset(): void {
    this.oscillator.reset();
    this.envelope.reset();
  }

  setModel(model: SidChipModel): void {
    this.model = model;
    this.oscillator.setModel(model);
    this.envelope.setModel(model);
  }

  writeControl(value: number): void {
    this.oscillator.writeControl(value);
    this.envelope.setGate((value & 0x01) !== 0);
  }

  output(): number {
    const characteristics = SID_MODEL_CHARACTERISTICS[this.model];
    const wave = sidWaveDac(this.model, this.oscillator.output12);
    const env = this.envelope.outputLevel();
    return (wave - characteristics.waveZero) * env + characteristics.voiceDc;
  }
}
