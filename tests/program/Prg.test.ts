import { describe, expect, it } from 'vitest';
import { parsePrg } from '../../src/core/program/Prg';

describe('PRG parser', () => {
  it('decodes the little-endian load address and payload', () => {
    const parsed = parsePrg(Uint8Array.of(0x01, 0x08, 0xa9, 0x2a, 0x60));

    expect(parsed.loadAddress).toBe(0x0801);
    expect(parsed.endAddressExclusive).toBe(0x0804);
    expect([...parsed.payload]).toEqual([0xa9, 0x2a, 0x60]);
  });

  it('rejects a header without payload bytes', () => {
    expect(() => parsePrg(Uint8Array.of(0x01, 0x08))).toThrow(/payload byte/i);
  });

  it('rejects a payload that crosses the top of memory', () => {
    expect(() => parsePrg(Uint8Array.of(0xff, 0xff, 0xaa, 0xbb))).toThrow(/does not fit/i);
  });
});
