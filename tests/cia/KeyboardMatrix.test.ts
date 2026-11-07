import { describe, expect, it } from 'vitest';
import { KeyboardMatrix } from '../../src/core/cia/KeyboardMatrix';

describe('KeyboardMatrix', () => {
  it('pulls the pressed row low when its column is selected', () => {
    const keyboard = new KeyboardMatrix();
    keyboard.press(7, 4); // SPACE on the C64 matrix

    expect(keyboard.readRows(0x80)).toBe(0xef);
    expect(keyboard.readRows(0x01)).toBe(0xff);
  });

  it('supports reverse-direction scanning', () => {
    const keyboard = new KeyboardMatrix();
    keyboard.press(7, 4);

    expect(keyboard.readColumns(0x10)).toBe(0x7f);
  });

  it('tracks multiple simultaneous switch closures', () => {
    const keyboard = new KeyboardMatrix();
    keyboard.press(0, 0);
    keyboard.press(1, 3);

    expect(keyboard.readRows(0x03)).toBe(0xf6);
    keyboard.release(0, 0);
    expect(keyboard.readRows(0x03)).toBe(0xf7);
  });
});
