import { describe, expect, it } from 'vitest';
import { parseCrt } from '../../src/core/cartridge/CrtImage';
import { GenericCartridge } from '../../src/core/cartridge/GenericCartridge';

function genericCrt(options: { gameHigh: boolean; exromHigh: boolean; loadAddress: number; data: Uint8Array }): Uint8Array {
  const { gameHigh, exromHigh, loadAddress, data } = options;
  const bytes = new Uint8Array(0x40 + 0x10 + data.length);
  writeAscii(bytes, 0x00, 'C64 CARTRIDGE   ');
  writeBe32(bytes, 0x10, 0x40);
  writeBe16(bytes, 0x14, 0x0100);
  writeBe16(bytes, 0x16, 0);
  bytes[0x18] = exromHigh ? 1 : 0;
  bytes[0x19] = gameHigh ? 1 : 0;
  writeAscii(bytes, 0x20, 'TEST CART');
  writeAscii(bytes, 0x40, 'CHIP');
  writeBe32(bytes, 0x44, 0x10 + data.length);
  writeBe16(bytes, 0x48, 0);
  writeBe16(bytes, 0x4a, 0);
  writeBe16(bytes, 0x4c, loadAddress);
  writeBe16(bytes, 0x4e, data.length);
  bytes.set(data, 0x50);
  return bytes;
}

describe('CRT parser', () => {
  it('parses the header line states and CHIP packet metadata', () => {
    const crt = parseCrt(genericCrt({
      gameHigh: true,
      exromHigh: false,
      loadAddress: 0x8000,
      data: Uint8Array.of(0x11, 0x22, 0x33)
    }));

    expect(crt.hardwareType).toBe(0);
    expect(crt.gameHigh).toBe(true);
    expect(crt.exromHigh).toBe(false);
    expect(crt.name).toBe('TEST CART');
    expect(crt.chips).toHaveLength(1);
    expect(crt.chips[0]).toMatchObject({ bank: 0, loadAddress: 0x8000, chipType: 0 });
    expect([...crt.chips[0]!.image]).toEqual([0x11, 0x22, 0x33]);
  });

  it('rejects malformed headers and truncated CHIP packets', () => {
    expect(() => parseCrt(new Uint8Array(10))).toThrow(/too short/i);

    const bytes = genericCrt({ gameHigh: true, exromHigh: false, loadAddress: 0x8000, data: Uint8Array.of(1) });
    bytes[0] = 0;
    expect(() => parseCrt(bytes)).toThrow(/signature/i);

    const truncated = genericCrt({ gameHigh: true, exromHigh: false, loadAddress: 0x8000, data: Uint8Array.of(1, 2) });
    writeBe32(truncated, 0x44, 0x1000);
    expect(() => parseCrt(truncated)).toThrow(/packet length/i);
  });

  it('rejects non-generic CRT hardware instead of guessing its banking logic', () => {
    const bytes = genericCrt({ gameHigh: true, exromHigh: false, loadAddress: 0x8000, data: Uint8Array.of(1) });
    writeBe16(bytes, 0x16, 5); // Ocean type 1
    expect(() => GenericCartridge.fromCrt(bytes)).toThrow(/not a generic cartridge/i);
  });
});

function writeAscii(bytes: Uint8Array, offset: number, value: string): void {
  for (let i = 0; i < value.length; i += 1) bytes[offset + i] = value.charCodeAt(i);
}
function writeBe16(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = (value >> 8) & 0xff;
  bytes[offset + 1] = value & 0xff;
}
function writeBe32(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = (value >>> 24) & 0xff;
  bytes[offset + 1] = (value >>> 16) & 0xff;
  bytes[offset + 2] = (value >>> 8) & 0xff;
  bytes[offset + 3] = value & 0xff;
}
