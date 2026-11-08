import { describe, expect, it } from 'vitest';
import { DATASETTE_MOTOR_SPINUP_SECONDS, Datasette } from '../../src/core/tape/Datasette';
import { TapImage } from '../../src/core/tape/TapImage';

function tap(version: 0 | 1, data: readonly number[], videoStandard = 0): Uint8Array {
  const bytes = new Uint8Array(0x14 + data.length);
  for (let i = 0; i < 12; i += 1) bytes[i] = 'C64-TAPE-RAW'.charCodeAt(i);
  bytes[0x0c] = version;
  bytes[0x0d] = 0;
  bytes[0x0e] = videoStandard;
  bytes[0x10] = data.length & 0xff;
  bytes[0x11] = (data.length >> 8) & 0xff;
  bytes[0x12] = (data.length >> 16) & 0xff;
  bytes[0x13] = (data.length >> 24) & 0xff;
  bytes.set(data, 0x14);
  return bytes;
}

function image(data: readonly number[]): TapImage {
  return TapImage.parse(tap(1, data));
}

describe('Datasette', () => {
  it('separates PLAY/SENSE from the computer-controlled motor', () => {
    const deck = new Datasette(1000, () => {});
    deck.mount(image([1]));
    expect(deck.senseHigh).toBe(true);
    deck.pressPlay();
    expect(deck.senseHigh).toBe(false);
    expect(deck.motorOn).toBe(false);
    deck.setMotor(true);
    expect(deck.motorOn).toBe(true);
  });

  it('waits for motor spin-up then emits one read edge per full-wave TAP pulse', () => {
    let pulses = 0;
    const palClockHz = 985_248;
    const deck = new Datasette(palClockHz, () => { pulses += 1; });
    deck.mount(image([1, 2])); // 8 PAL cycles, then 16 PAL cycles
    deck.pressPlay();
    deck.setMotor(true);

    const spinupCycles = Math.round(palClockHz * DATASETTE_MOTOR_SPINUP_SECONDS);
    deck.tick(spinupCycles - 1);
    expect(pulses).toBe(0);
    deck.tick(9); // final spinup cycle + first 8-cycle pulse
    expect(pulses).toBe(1);
    deck.tick(16);
    expect(pulses).toBe(2);
  });

  it('preserves real pulse duration when a PAL TAP is played on an NTSC clock', () => {
    let edges = 0;
    const deck = new Datasette(1_022_727, () => { edges += 1; });
    const image = TapImage.parse(tap(0, [100])); // 800 PAL cycles
    deck.mount(image);
    deck.pressPlay();
    deck.setMotor(true);

    const spinup = Math.round(1_022_727 * DATASETTE_MOTOR_SPINUP_SECONDS);
    const scaledPulse = Math.round(800 * 1_022_727 / 985_248);
    deck.tick(spinup + scaledPulse - 1);
    expect(edges).toBe(0);
    deck.tick(1);
    expect(edges).toBe(1);
  });

  it('pauses tape position while the motor is off', () => {
    const deck = new Datasette(1000, () => {});
    deck.mount(image([10]));
    deck.pressPlay();
    deck.tick(1000);
    expect(deck.dataOffset).toBe(0);
  });
});
