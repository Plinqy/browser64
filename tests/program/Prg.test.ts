import { describe, expect, it } from 'vitest';
import { detectBasicBootstrap, parsePrg } from '../../src/core/program/Prg';

describe('PRG parser', () => {
  it('decodes the little-endian load address and payload', () => {
    const parsed = parsePrg(Uint8Array.of(0x01, 0x08, 0xa9, 0x2a, 0x60));

    expect(parsed.loadAddress).toBe(0x0801);
    expect(parsed.endAddressExclusive).toBe(0x0804);
    expect([...parsed.payload]).toEqual([0xa9, 0x2a, 0x60]);
  });

  it('detects a conventional tokenized BASIC program at $0801', () => {
    const parsed = parsePrg(Uint8Array.of(0x01, 0x08, 0x07, 0x08, 0x0a, 0x00, 0x99, 0x00, 0x00, 0x00));

    expect(detectBasicBootstrap(parsed)).toEqual({
      startAddress: 0x0801,
      firstLineNumber: 10,
      nextLineAddress: 0x0807
    });
  });

  it('detects a one-line BASIC bootstrap when machine data begins below $0801', () => {
    const bytes = new Uint8Array(2 + 0x50);
    bytes[0] = 0xc0;
    bytes[1] = 0x07;
    const offset = 2 + (0x0801 - 0x07c0);
    // The following bytes mimic game loaders that execute SYS from one BASIC line and never return to parse the following data.
    bytes.set([0x0c, 0x08, 0xc9, 0x07, 0x9e, 0x32, 0x30, 0x36, 0x34, 0x20, 0x00, 0xa0, 0x00], offset);

    expect(detectBasicBootstrap(parsePrg(bytes))).toEqual({
      startAddress: 0x0801,
      firstLineNumber: 1993,
      nextLineAddress: 0x080c
    });
  });

  it('accepts a loader whose next-line pointer lands on its BASIC line terminator', () => {
    const parsed = parsePrg(Uint8Array.of(
      0x01, 0x08,
      0x0d, 0x08, 0xce, 0x07, 0x9e, 0x20, 0x28, 0x32, 0x30, 0x36, 0x34, 0x29, 0x00, 0x00, 0x00, 0x78
    ));

    expect(detectBasicBootstrap(parsed)).toEqual({
      startAddress: 0x0801,
      firstLineNumber: 1998,
      nextLineAddress: 0x080d
    });
  });

  it('does not classify arbitrary machine code at $0801 as BASIC', () => {
    const parsed = parsePrg(Uint8Array.of(0x01, 0x08, 0xa9, 0x00, 0x8d, 0x20, 0xd0, 0x60));
    expect(detectBasicBootstrap(parsed)).toBeNull();
  });

  it('rejects a header without payload bytes', () => {
    expect(() => parsePrg(Uint8Array.of(0x01, 0x08))).toThrow(/payload byte/i);
  });

  it('rejects a payload that crosses the top of memory', () => {
    expect(() => parsePrg(Uint8Array.of(0xff, 0xff, 0xaa, 0xbb))).toThrow(/does not fit/i);
  });
});
