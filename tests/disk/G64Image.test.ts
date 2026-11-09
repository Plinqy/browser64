import { describe, expect, it } from 'vitest';
import { G64Image } from '../../src/core/disk/G64Image';

function emptyG64(trackEntries = 4): Uint8Array {
  const bytes = new Uint8Array(0x0c + trackEntries * 8);
  for (let index = 0; index < 8; index += 1) bytes[index] = 'GCR-1541'.charCodeAt(index);
  bytes[0x08] = 0;
  bytes[0x09] = trackEntries;
  bytes[0x0a] = 1;
  return bytes;
}

describe('G64Image', () => {
  it('round-trips raw full/half tracks with constant and per-byte speed zones', () => {
    const image = G64Image.parse(emptyG64());
    image.replaceHalfTrack(1, Uint8Array.of(0xff, 0x52, 0x55, 0xaa), Uint8Array.of(3, 3, 3, 3));
    image.replaceHalfTrack(2, Uint8Array.of(0x10, 0x20, 0x30, 0x40, 0x50), Uint8Array.of(0, 1, 2, 3, 0));

    const reparsed = G64Image.parse(image.toBytes());
    expect(reparsed.readHalfTrack(1)?.track).toBe(1);
    expect([...reparsed.readHalfTrack(1)!.bytes]).toEqual([0xff, 0x52, 0x55, 0xaa]);
    expect([...reparsed.readHalfTrack(1)!.speedZones]).toEqual([3, 3, 3, 3]);
    expect(reparsed.readHalfTrack(2)?.track).toBe(1.5);
    expect([...reparsed.readHalfTrack(2)!.bytes]).toEqual([0x10, 0x20, 0x30, 0x40, 0x50]);
    expect([...reparsed.readHalfTrack(2)!.speedZones]).toEqual([0, 1, 2, 3, 0]);
  });

  it('rejects invalid signatures, versions, and half-track positions', () => {
    const badSignature = emptyG64();
    badSignature[0] = 0;
    expect(() => G64Image.parse(badSignature)).toThrow(/signature/i);

    const badVersion = emptyG64();
    badVersion[0x08] = 1;
    expect(() => G64Image.parse(badVersion)).toThrow(/version 1/i);

    const image = G64Image.parse(emptyG64());
    expect(() => image.replaceHalfTrack(5, [1])).toThrow(/half-track/i);
  });
});
