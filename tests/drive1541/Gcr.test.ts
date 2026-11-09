import { describe, expect, it } from 'vitest';
import { D64Image } from '../../src/core/disk/D64Image';
import {
  buildGcrTrack,
  cyclesPerGcrByte,
  decodeGcrBlock,
  decodeGcrTrackToD64,
  densityForTrack,
  encodeGcrBlock,
  gcrChecksum
} from '../../src/core/drive1541/Gcr';

function sectorOffset(track: number, sector: number): number {
  let count = 0;
  for (let current = 1; current < track; current += 1) {
    count += current <= 17 ? 21 : current <= 24 ? 19 : current <= 30 ? 18 : 17;
  }
  return (count + sector) * 256;
}

describe('1541 GCR encoding', () => {
  it('encodes four binary bytes into five standard Commodore GCR bytes', () => {
    expect([...encodeGcrBlock(Uint8Array.of(0, 0, 0, 0))]).toEqual([0x52, 0x94, 0xa5, 0x29, 0x4a]);
    expect([...encodeGcrBlock(Uint8Array.of(0x08, 0, 0, 0))]).toEqual([0x52, 0x54, 0xa5, 0x29, 0x4a]);
    expect(() => encodeGcrBlock(Uint8Array.of(1, 2, 3))).toThrow(/multiple of four/i);
  });

  it('decodes standard Commodore GCR groups back to their original bytes', () => {
    const source = Uint8Array.of(0x08, 0x5a, 0xa5, 0xff, 0x00, 0x10, 0x20, 0x30);
    expect([...decodeGcrBlock(encodeGcrBlock(source))]).toEqual([...source]);
    expect(() => decodeGcrBlock(Uint8Array.of(1, 2, 3, 4))).toThrow(/multiple of five/i);
  });

  it('uses XOR checksums and the four 1541 density zones', () => {
    expect(gcrChecksum(Uint8Array.of(0x01, 0x02, 0x03, 0x04))).toBe(0x04);
    expect([1, 17, 18, 24, 25, 30, 31, 35].map(densityForTrack)).toEqual([3, 3, 2, 2, 1, 1, 0, 0]);
    expect([0, 1, 2, 3].map((zone) => cyclesPerGcrByte(zone as 0 | 1 | 2 | 3))).toEqual([32, 30, 28, 26]);
  });

  it('recovers valid standard sectors from a raw GCR track into a writable D64', () => {
    const sourceBytes = new Uint8Array(174_848);
    const bam = sectorOffset(18, 0);
    sourceBytes[bam + 0xa2] = 0x31;
    sourceBytes[bam + 0xa3] = 0x32;
    const first = sectorOffset(1, 0);
    for (let index = 0; index < 256; index += 1) sourceBytes[first + index] = (index * 7) & 0xff;

    const source = D64Image.parse(sourceBytes);
    const target = D64Image.parse(new Uint8Array(174_848));
    const track = buildGcrTrack(source, 1);
    expect(decodeGcrTrackToD64(target, 1, track.bytes)).toBe(21);
    expect([...target.readSector(1, 0)]).toEqual([...source.readSector(1, 0)]);
  });

  it('builds a circular GCR track containing sync/header/data records for every sector', () => {
    const bytes = new Uint8Array(174_848);
    const bam = sectorOffset(18, 0);
    bytes[bam + 0xa2] = 0x31;
    bytes[bam + 0xa3] = 0x32;
    const first = sectorOffset(1, 0);
    for (let i = 0; i < 256; i += 1) bytes[first + i] = i;

    const track = buildGcrTrack(D64Image.parse(bytes), 1);
    expect(track.track).toBe(1);
    expect(track.density).toBe(3);
    expect(track.cyclesPerByte).toBe(26);
    expect(track.bytes.length).toBeGreaterThanOrEqual(7692);
    expect([...track.bytes.slice(0, 5)]).toEqual([0xff, 0xff, 0xff, 0xff, 0xff]);
    expect(track.bytes.filter((value) => value === 0xff).length).toBeGreaterThanOrEqual(21 * 10);
  });
});
