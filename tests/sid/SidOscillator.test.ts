import { describe, expect, it } from 'vitest';
import { SidOscillator } from '../../src/core/sid/SidOscillator';

function setFrequency(oscillator: SidOscillator, value: number): void {
  oscillator.writeFrequencyLow(value & 0xff);
  oscillator.writeFrequencyHigh((value >>> 8) & 0xff);
}


function reverse23(value: number): number {
  let reversed = 0;
  for (let bit = 0; bit < 23; bit += 1) {
    reversed |= ((value >>> bit) & 1) << (22 - bit);
  }
  return reversed >>> 0;
}

function zeroPhase(oscillator: SidOscillator, waveform: number): void {
  oscillator.writeControl((waveform & 0xf0) | 0x08); // TEST holds phase at zero
  oscillator.writeControl(waveform & 0xf0);
}

describe('SidOscillator phase and pure waveforms', () => {
  it('adds the 16-bit frequency to the 24-bit accumulator every SID cycle', () => {
    const oscillator = new SidOscillator('8580');
    zeroPhase(oscillator, 0x20);
    setFrequency(oscillator, 0x1000);

    oscillator.clockPhase();
    expect(oscillator.accumulator).toBe(0x001000);
    expect(oscillator.calculateWaveform(oscillator)).toBe(0x001);

    oscillator.clockPhase();
    expect(oscillator.accumulator).toBe(0x002000);
    expect(oscillator.calculateWaveform(oscillator)).toBe(0x002);
  });

  it('uses ownMSB XOR NOT sourceMSB for triangle ring modulation', () => {
    const source = new SidOscillator('8580'); // source MSB = 0
    const plain = new SidOscillator('8580');
    const ring = new SidOscillator('8580');
    zeroPhase(plain, 0x10);
    zeroPhase(ring, 0x10);
    setFrequency(plain, 0x1000);
    setFrequency(ring, 0x1000);
    ring.writeControl(0x14);

    plain.clockPhase();
    ring.clockPhase();

    const plainOutput = plain.calculateWaveform(source);
    const ringOutput = ring.calculateWaveform(source);
    expect(plainOutput).toBe(0x002);
    expect(ringOutput).toBeGreaterThan(0x0f00);
  });

  it('hard-syncs a destination on the source MSB rising edge', () => {
    const source = new SidOscillator('8580');
    const destination = new SidOscillator('8580');
    const sourceSource = new SidOscillator('8580');
    zeroPhase(source, 0x00);
    zeroPhase(destination, 0x00);
    zeroPhase(sourceSource, 0x00);
    setFrequency(source, 0xffff);
    setFrequency(destination, 0x1234);
    destination.writeControl(0x02); // SYNC

    let synchronized = false;
    for (let cycle = 0; cycle < 200; cycle += 1) {
      source.clockPhase();
      destination.clockPhase();
      sourceSource.clockPhase();
      destination.synchronizeFrom(source, sourceSource);
      if (source.msbRising) {
        expect(destination.accumulator).toBe(0);
        synchronized = true;
        break;
      }
    }
    expect(synchronized).toBe(true);
  });

  it('clocks the 23-bit noise LFSR two cycles after an accumulator bit-19 rise', () => {
    const oscillator = new SidOscillator('6581');
    zeroPhase(oscillator, 0x80);
    setFrequency(oscillator, 0xffff);
    const afterTestRelease = oscillator.noiseShiftRegister;

    for (let cycle = 0; cycle < 9; cycle += 1) oscillator.clockPhase();
    expect(oscillator.noiseShiftRegister).toBe(afterTestRelease);
    oscillator.clockPhase();
    expect(oscillator.noiseShiftRegister).toBe(afterTestRelease);
    oscillator.clockPhase();
    expect(oscillator.noiseShiftRegister).not.toBe(afterTestRelease);
  });
  it('matches published noise-selector vectors after internal bit-orientation translation', () => {
    const source = new SidOscillator('6581');
    const oscillator = new SidOscillator('6581');
    const internals = oscillator as unknown as {
      lfsr: number;
      clockNoiseLfsr(): void;
    };

    internals.lfsr = reverse23(0x35555f);
    oscillator.writeControl(0x80);
    expect(oscillator.calculateWaveform(source)).toBe(0x0e20);

    internals.lfsr = reverse23(0x35555e);
    internals.clockNoiseLfsr();
    expect(oscillator.calculateWaveform(source)).toBe(0x09e0);
  });

  it('preserves phase across RESET while resetting control state', () => {
    const oscillator = new SidOscillator('6581');
    setFrequency(oscillator, 0x1234);
    oscillator.clockPhase();
    const phase = oscillator.accumulator;

    oscillator.reset();

    expect(oscillator.accumulator).toBe(phase);
    expect(oscillator.frequency).toBe(0);
    expect(oscillator.control).toBe(0);
    expect(oscillator.noiseShiftRegister).toBe(0x7ffffe);
  });
});

describe('SidOscillator model-specific readback timing', () => {
  it('delays triangle/saw OSC3 readback by one cycle on 8580', () => {
    const source = new SidOscillator('8580');
    const mos6581 = new SidOscillator('6581');
    const mos8580 = new SidOscillator('8580');
    zeroPhase(mos6581, 0x20);
    zeroPhase(mos8580, 0x20);
    setFrequency(mos6581, 0x1000);
    setFrequency(mos8580, 0x1000);

    mos6581.clockPhase();
    mos8580.clockPhase();
    mos6581.calculateWaveform(source);
    mos8580.calculateWaveform(source);

    expect(mos6581.oscByte).toBe(0x00); // current output is $001; top byte still zero
    expect(mos8580.oscByte).toBe(0x00);

    // Use a larger phase step so the top eight readback bits visibly differ.
    setFrequency(mos6581, 0xffff);
    setFrequency(mos8580, 0xffff);
    for (let cycle = 0; cycle < 20; cycle += 1) {
      mos6581.clockPhase();
      mos8580.clockPhase();
      mos6581.calculateWaveform(source);
      const previous8580 = mos8580.output12;
      mos8580.calculateWaveform(source);
      expect(mos8580.oscByte).toBe((previous8580 >>> 4) & 0xff);
    }
    expect(mos6581.oscByte).toBe((mos6581.output12 >>> 4) & 0xff);
  });
});
