import { describe, expect, it } from 'vitest';
import { Sid } from '../../src/core/sid/Sid';

describe('Sid register and bus behavior', () => {
  it('applies 6581 writes immediately but delays 8580 writes by one SID cycle', () => {
    const sid6581 = new Sid('6581');
    sid6581.write(0x00, 0x34);
    expect(sid6581.voices[0].oscillator.frequency).toBe(0x0034);

    const sid8580 = new Sid('8580');
    sid8580.write(0x00, 0x34);
    expect(sid8580.voices[0].oscillator.frequency).toBe(0x0000);
    sid8580.tick(1);
    expect(sid8580.voices[0].oscillator.frequency).toBe(0x0034);
  });

  it('returns the floating data-bus value from write-only registers and ages it to zero', () => {
    const sid = new Sid('6581');
    sid.write(0x18, 0xab);
    expect(sid.read(0x00)).toBe(0xab);

    sid.tick(0x1d00);
    expect(sid.lastBusValue).toBe(0x00);
  });

  it('reads POTX/POTY and live OSC3/ENV3 through their readable registers', () => {
    const sid = new Sid('6581');
    sid.setPotX(0x12);
    sid.setPotY(0x34);
    expect(sid.read(0x19)).toBe(0x12);
    expect(sid.read(0x1a)).toBe(0x34);

    sid.write(0x0e, 0x00);
    sid.write(0x0f, 0x10);
    sid.write(0x12, 0x21); // saw + gate
    sid.write(0x13, 0x00);
    sid.tick(20);

    expect(sid.read(0x1b)).toBe(sid.voices[2].oscillator.oscByte);
    expect(sid.read(0x1c)).toBe(sid.voices[2].envelope.level);
  });
});

describe('Sid deterministic PCM sampling', () => {
  it('decimates chip-rate output into the configured host sample rate', () => {
    const sid = new Sid('8580', 16_000);
    const write = (register: number, value: number): void => {
      sid.write(register, value);
      sid.tick(1); // 8580 commits the register write one cycle later
    };
    write(0x00, 0xff);
    write(0x01, 0xff);
    write(0x05, 0x00);
    write(0x06, 0xf0);
    write(0x04, 0x21); // saw + gate
    write(0x18, 0x0f);
    sid.configureAudio(8_000);

    sid.tick(200);
    const samples = sid.drainAudioSamples();

    expect(samples.length).toBe(100);
    expect(samples.some((sample) => sample !== 0)).toBe(true);
    expect(sid.queuedAudioSamples).toBe(0);
  });
});
