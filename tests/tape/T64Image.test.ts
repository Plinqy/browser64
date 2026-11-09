import { describe, expect, it } from 'vitest';
import { parsePrg } from '../../src/core/program/Prg';
import { parseT64 } from '../../src/core/tape/T64Image';

function makeT64(): Uint8Array {
  const bytes = new Uint8Array(0x100);
  writeAscii(bytes, 0, 32, 'C64S tape image file');
  writeLe16(bytes, 32, 0x0101);
  writeLe16(bytes, 34, 3);
  writeLe16(bytes, 36, 2);
  writeAscii(bytes, 40, 24, 'TEST TAPE');

  // Normal BASIC PRG at $0801, four payload bytes.
  bytes[64] = 1;
  bytes[65] = 0x82;
  writeLe16(bytes, 66, 0x0801);
  writeLe16(bytes, 68, 0x0805);
  writeLe32(bytes, 72, 0xc0);
  writeAscii(bytes, 80, 16, 'BASIC GAME');
  bytes.set([0x0b, 0x08, 0x0a, 0x00], 0xc0);

  // Free entry at index 1 remains invisible.

  // Machine-code PRG with a deliberately broken conv64-style end address.
  const second = 64 + 2 * 32;
  bytes[second] = 1;
  bytes[second + 1] = 0x82;
  writeLe16(bytes, second + 2, 0x2000);
  writeLe16(bytes, second + 4, 0xc3c6);
  writeLe32(bytes, second + 8, 0xe0);
  writeAscii(bytes, second + 16, 16, 'MACHINE');
  bytes.set([0xa9, 0x2a, 0x60], 0xe0);

  return bytes.subarray(0, 0xe3);
}

describe('T64 image parser', () => {
  it('reads the header, skips free slots, and exposes normal PRG entries', () => {
    const image = parseT64(makeT64());
    const entries = image.listDirectory();

    expect(image.header).toMatchObject({
      version: 0x0101,
      directoryEntries: 3,
      usedEntries: 2,
      description: 'TEST TAPE'
    });
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      directoryIndex: 0,
      filename: 'BASIC GAME',
      fileType: 'PRG',
      startAddress: 0x0801,
      endAddressExclusive: 0x0805,
      byteLength: 4,
      loadable: true
    });
  });

  it('converts a T64 PRG entry into canonical PRG bytes', () => {
    const image = parseT64(makeT64());
    const bytes = image.readPrg(image.listDirectory()[0]!);
    const parsed = parsePrg(bytes);

    expect(parsed.loadAddress).toBe(0x0801);
    expect([...parsed.payload]).toEqual([0x0b, 0x08, 0x0a, 0x00]);
  });

  it('falls back to physical payload boundaries for the known bogus end-address pattern', () => {
    const image = parseT64(makeT64());
    const entry = image.listDirectory()[1]!;

    expect(entry).toMatchObject({
      filename: 'MACHINE',
      startAddress: 0x2000,
      endAddressExclusive: 0x2003,
      byteLength: 3,
      loadable: true
    });
    expect([...image.readPrg(entry)]).toEqual([0x00, 0x20, 0xa9, 0x2a, 0x60]);
  });

  it('accepts older C64S tape files and their common malformed PRG type byte', () => {
    const bytes = makeT64();
    writeAscii(bytes, 0, 32, 'C64S tape file\r\nDemo tape');
    bytes[65] = 0x44;

    const image = parseT64(bytes);
    expect(image.header.signature).toMatch(/^C64S tape file/);
    expect(image.listDirectory()[0]).toMatchObject({ fileType: 'PRG', loadable: true });
  });

  it('rejects non-T64 signatures and truncated directory tables', () => {
    expect(() => parseT64(new Uint8Array(64))).toThrow(/signature/i);

    const truncated = new Uint8Array(80);
    writeAscii(truncated, 0, 32, 'C64S tape image file');
    writeLe16(truncated, 34, 2);
    expect(() => parseT64(truncated)).toThrow(/directory is truncated/i);
  });
});

function writeAscii(target: Uint8Array, offset: number, width: number, value: string): void {
  target.fill(0x20, offset, offset + width);
  for (let index = 0; index < Math.min(width, value.length); index += 1) {
    target[offset + index] = value.charCodeAt(index) & 0xff;
  }
}

function writeLe16(target: Uint8Array, offset: number, value: number): void {
  target[offset] = value & 0xff;
  target[offset + 1] = (value >>> 8) & 0xff;
}

function writeLe32(target: Uint8Array, offset: number, value: number): void {
  target[offset] = value & 0xff;
  target[offset + 1] = (value >>> 8) & 0xff;
  target[offset + 2] = (value >>> 16) & 0xff;
  target[offset + 3] = (value >>> 24) & 0xff;
}
