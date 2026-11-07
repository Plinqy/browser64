import { describe, expect, it } from 'vitest';
import {
  BASIC_ROM_SIZE,
  C64Roms,
  CHARACTER_ROM_SIZE,
  KERNAL_ROM_SIZE
} from '../../src/core/rom/RomSet';

describe('C64Roms', () => {
  it('accepts exact motherboard ROM sizes and tracks completeness', () => {
    const roms = new C64Roms();

    roms.load('basic', new Uint8Array(BASIC_ROM_SIZE));
    roms.load('kernal', new Uint8Array(KERNAL_ROM_SIZE));
    expect(roms.complete).toBe(false);

    roms.load('character', new Uint8Array(CHARACTER_ROM_SIZE));
    expect(roms.complete).toBe(true);
  });

  it('rejects malformed ROM images instead of truncating or padding them', () => {
    const roms = new C64Roms();

    expect(() => roms.load('basic', new Uint8Array(BASIC_ROM_SIZE - 1))).toThrow(RangeError);
    expect(() => roms.load('kernal', new Uint8Array(KERNAL_ROM_SIZE + 1))).toThrow(RangeError);
    expect(() => roms.load('character', new Uint8Array(CHARACTER_ROM_SIZE - 1))).toThrow(RangeError);
  });

  it('copies supplied bytes so caller mutations cannot alter a loaded ROM', () => {
    const roms = new C64Roms();
    const source = new Uint8Array(BASIC_ROM_SIZE);
    source[0] = 0x42;

    roms.load('basic', source);
    source[0] = 0x99;

    expect(roms.basic[0]).toBe(0x42);
  });
  it('unloads a ROM without leaving stale bytes or loaded state behind', () => {
    const roms = new C64Roms();
    roms.load('basic', new Uint8Array(BASIC_ROM_SIZE).fill(0x42));

    roms.unload('basic');

    expect(roms.isLoaded('basic')).toBe(false);
    expect(roms.basic[0]).toBe(0xff);
  });

});
