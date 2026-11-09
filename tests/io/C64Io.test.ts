import { describe, expect, it } from 'vitest';
import { C64Io } from '../../src/core/io/C64Io';

describe('C64Io address decoding', () => {
  it('mirrors VIC-II registers every $40 bytes through $D3FF', () => {
    const io = new C64Io();
    io.write(0x0020, 0x0e);

    expect(io.read(0x0020)).toBe(0xfe);
    expect(io.read(0x0060)).toBe(0xfe);
    expect(io.read(0x03e0)).toBe(0xfe);
  });

  it('mirrors SID registers every $20 bytes through $D7FF', () => {
    const io = new C64Io();
    io.write(0x0418, 0x0f);

    expect(io.read(0x0418)).toBe(0x0f);
    expect(io.read(0x0438)).toBe(0x0f);
    expect(io.read(0x07f8)).toBe(0x0f);
  });

  it('stores only the low nibble in color RAM', () => {
    const io = new C64Io();
    io.write(0x0800, 0xab);

    expect(io.colorRam.memory[0]).toBe(0x0b);
    expect(io.read(0x0800)).toBe(0xfb);
  });

  it('mirrors both CIA register files every 16 bytes', () => {
    const io = new C64Io();
    io.write(0x0c02, 0x12);
    io.write(0x0d03, 0x34);

    expect(io.read(0x0cf2)).toBe(0x12);
    expect(io.read(0x0df3)).toBe(0x34);
  });

  it('wires CIA1 to the keyboard matrix and active-low joystick inputs', () => {
    const io = new C64Io();
    io.keyboard.press(7, 4); // SPACE
    io.cia1.write(0x02, 0xff); // PA outputs
    io.cia1.write(0x03, 0x00); // PB inputs
    io.cia1.write(0x00, 0x7f); // select column 7

    expect(io.cia1.read(0x01)).toBe(0xef);

    io.setJoystick1Pins(0xfe);
    expect(io.cia1.read(0x01)).toBe(0xee);
  });


  it('lets joystick port 2 pull CIA1 Port A low even while KERNAL configures it as output', () => {
    const io = new C64Io();
    io.cia1.write(0x02, 0xff); // KERNAL IOINIT: CIA1 Port A outputs for keyboard scanning.
    io.cia1.write(0x00, 0xff); // No keyboard column intentionally driven low.

    expect(io.cia1.read(0x00) & 0x1f).toBe(0x1f);

    io.setJoystickControl(2, 'up', true);
    io.setJoystickControl(2, 'fire', true);
    expect(io.cia1.read(0x00) & 0x1f).toBe(0x0e);

    io.setJoystickControl(2, 'up', false);
    io.setJoystickControl(2, 'fire', false);
    expect(io.cia1.read(0x00) & 0x1f).toBe(0x1f);
  });

  it('updates active-low joystick pins through named controls', () => {
    const io = new C64Io();

    io.setJoystickControl(1, 'up', true);
    io.setJoystickControl(1, 'fire', true);
    io.setJoystickControl(2, 'left', true);

    expect(io.joystick1InputPins).toBe(0xee);
    expect(io.joystick2InputPins).toBe(0xfb);

    io.setJoystickControl(1, 'up', false);
    expect(io.joystick1InputPins).toBe(0xef);

    io.releaseJoysticks();
    expect(io.joystick1InputPins).toBe(0xff);
    expect(io.joystick2InputPins).toBe(0xff);
  });

  it('keeps expansion I/O areas open/unimplemented', () => {
    const io = new C64Io();
    io.write(0x0e00, 0x12);
    io.write(0x0f00, 0x34);

    expect(io.read(0x0e00)).toBe(0xff);
    expect(io.read(0x0f00)).toBe(0xff);
  });
});
