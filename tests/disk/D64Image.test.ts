import { describe, expect, it } from 'vitest';
import { D64Image, decodePetscii, parseD64 } from '../../src/core/disk/D64Image';
import { parsePrg } from '../../src/core/program/Prg';

const D64_SIZE_35 = 174_848;

function sectorsOnTrack(track: number): number {
  if (track <= 17) return 21;
  if (track <= 24) return 19;
  if (track <= 30) return 18;
  return 17;
}

function sectorOffset(track: number, sector: number): number {
  let sectors = 0;
  for (let current = 1; current < track; current += 1) {
    sectors += sectorsOnTrack(current);
  }
  return (sectors + sector) * 256;
}

function sector(image: Uint8Array, track: number, sectorNumber: number): Uint8Array {
  const offset = sectorOffset(track, sectorNumber);
  return image.subarray(offset, offset + 256);
}

function writePetscii(target: Uint8Array, offset: number, width: number, text: string): void {
  target.fill(0xa0, offset, offset + width);
  for (let index = 0; index < Math.min(width, text.length); index += 1) {
    target[offset + index] = text.charCodeAt(index) & 0xff;
  }
}

function makeDirectoryImage(): Uint8Array {
  const image = new Uint8Array(D64_SIZE_35);
  const bam = sector(image, 18, 0);
  bam[0x02] = 0x41;
  writePetscii(bam, 0x90, 16, 'TEST DISK');
  writePetscii(bam, 0xa2, 2, 'ID');
  writePetscii(bam, 0xa5, 2, '2A');

  const directory = sector(image, 18, 1);
  directory[0] = 0;
  directory[1] = 0xff;

  directory[2] = 0xc2; // closed + locked PRG
  directory[3] = 1;
  directory[4] = 0;
  writePetscii(directory, 5, 16, 'HELLO');
  directory[30] = 2;
  directory[31] = 0;

  const second = 32;
  directory[second + 2] = 0x81; // closed SEQ
  directory[second + 3] = 2;
  directory[second + 4] = 0;
  writePetscii(directory, second + 5, 16, 'NOT A PRG');
  directory[second + 30] = 1;

  return image;
}

describe('D64 geometry', () => {
  it('recognizes 35/40/42-track images with and without error tables', () => {
    const cases = [
      [174_848, 35, 683, false],
      [175_531, 35, 683, true],
      [196_608, 40, 768, false],
      [197_376, 40, 768, true],
      [205_312, 42, 802, false],
      [206_114, 42, 802, true]
    ] as const;

    for (const [size, tracks, sectors, errors] of cases) {
      const image = parseD64(new Uint8Array(size));
      expect(image.geometry.tracks).toBe(tracks);
      expect(image.geometry.sectorCount).toBe(sectors);
      expect(image.geometry.hasErrorInfo).toBe(errors);
    }
  });

  it('rejects unsupported image lengths and invalid track/sector addresses', () => {
    expect(() => parseD64(new Uint8Array(1234))).toThrow(/unsupported d64 size/i);

    const image = parseD64(new Uint8Array(D64_SIZE_35));
    expect(() => image.readSector(0, 0)).toThrow(/track/i);
    expect(() => image.readSector(18, 19)).toThrow(/sector/i);
    expect(() => image.readSector(35, 17)).toThrow(/sector/i);
  });

  it('returns optional per-sector error bytes by physical sector order', () => {
    const bytes = new Uint8Array(175_531);
    bytes[174_848] = 0x05;
    bytes[175_530] = 0x0b;
    const image = parseD64(bytes);

    expect(image.sectorErrorCode(1, 0)).toBe(0x05);
    expect(image.sectorErrorCode(35, 16)).toBe(0x0b);
    expect(parseD64(new Uint8Array(D64_SIZE_35)).sectorErrorCode(1, 0)).toBeNull();
  });
});

describe('D64 directory and file extraction', () => {
  it('reads BAM label metadata and standard directory entry flags', () => {
    const image = D64Image.parse(makeDirectoryImage());
    const entries = image.listDirectory();

    expect(image.header).toEqual({ name: 'TEST DISK', id: 'ID', dosType: '2A', dosVersion: 0x41 });
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      filename: 'HELLO',
      fileType: 'PRG',
      closed: true,
      locked: true,
      startTrack: 1,
      startSector: 0,
      blocks: 2
    });
    expect(entries[1]).toMatchObject({ filename: 'NOT A PRG', fileType: 'SEQ' });
  });

  it('extracts a multi-sector PRG with the load-address bytes intact', () => {
    const bytes = makeDirectoryImage();
    const payload = new Uint8Array(260);
    payload[0] = 0x01;
    payload[1] = 0x08;
    for (let index = 2; index < payload.length; index += 1) {
      payload[index] = index & 0xff;
    }

    const first = sector(bytes, 1, 0);
    first[0] = 1;
    first[1] = 1;
    first.set(payload.subarray(0, 254), 2);

    const last = sector(bytes, 1, 1);
    const remainder = payload.subarray(254);
    last[0] = 0;
    last[1] = remainder.length + 1;
    last.set(remainder, 2);

    const image = parseD64(bytes);
    const entry = image.listDirectory()[0]!;
    const extracted = image.readPrg(entry);

    expect([...extracted]).toEqual([...payload]);
    expect(parsePrg(extracted).loadAddress).toBe(0x0801);
  });

  it('handles a completely full final sector using the $FF length marker', () => {
    const bytes = makeDirectoryImage();
    const data = sector(bytes, 1, 0);
    data[0] = 0;
    data[1] = 0xff;
    for (let index = 0; index < 254; index += 1) data[index + 2] = index & 0xff;

    const image = parseD64(bytes);
    const extracted = image.readPrg(image.listDirectory()[0]!);
    expect(extracted).toHaveLength(254);
    expect(extracted[0]).toBe(0x00);
    expect(extracted[253]).toBe(0xfd);
  });

  it('retains typed zero-block directory entries even when their start track is zero', () => {
    const bytes = makeDirectoryImage();
    const directory = sector(bytes, 18, 1);
    const third = 64;
    directory[third + 2] = 0x82;
    directory[third + 3] = 0;
    directory[third + 4] = 0;
    writePetscii(directory, third + 5, 16, 'EMPTY');

    const entries = parseD64(bytes).listDirectory();
    expect(entries).toHaveLength(3);
    expect(entries[2]).toMatchObject({ filename: 'EMPTY', fileType: 'PRG', blocks: 0, startTrack: 0 });
  });

  it('rejects readPrg for non-PRG entries', () => {
    const image = parseD64(makeDirectoryImage());
    const entry = image.listDirectory()[1]!;

    expect(() => image.readPrg(entry)).toThrow(/not PRG/i);
  });

  it('detects directory and file sector-chain loops', () => {
    const directoryLoopBytes = makeDirectoryImage();
    const directory = sector(directoryLoopBytes, 18, 1);
    directory[0] = 18;
    directory[1] = 1;
    expect(() => parseD64(directoryLoopBytes).listDirectory()).toThrow(/directory chain loops/i);

    const fileLoopBytes = makeDirectoryImage();
    const file = sector(fileLoopBytes, 1, 0);
    file[0] = 1;
    file[1] = 0;
    const fileImage = parseD64(fileLoopBytes);
    expect(() => fileImage.readPrg(fileImage.listDirectory()[0]!)).toThrow(/sector-chain loop/i);
  });

  it('decodes common PETSCII filename characters and trims shifted spaces', () => {
    expect(decodePetscii(Uint8Array.of(0x41, 0x42, 0x20, 0xc3, 0xa0, 0xa0))).toBe('AB C');
    expect(decodePetscii(Uint8Array.of(0x5c, 0x5e, 0x5f))).toBe('£↑←');
  });
});

describe('D64 writable media', () => {
  it('writes sectors, invalidates directory metadata, and serializes changes', () => {
    const bytes = makeDirectoryImage();
    const image = D64Image.parse(bytes);
    expect(image.listDirectory()[0]?.filename).toBe('HELLO');

    const directory = image.readSector(18, 1);
    writePetscii(directory, 5, 16, 'UPDATED');
    image.writeSector(18, 1, directory);

    expect(image.listDirectory()[0]?.filename).toBe('UPDATED');
    expect(D64Image.parse(image.toBytes()).listDirectory()[0]?.filename).toBe('UPDATED');
  });

  it('preserves and updates optional error information on export', () => {
    const bytes = new Uint8Array(175_531);
    bytes[174_848] = 0x05;
    const image = D64Image.parse(bytes);
    image.setSectorErrorCode(1, 0, 0x01);

    const reparsed = D64Image.parse(image.toBytes());
    expect(reparsed.sectorErrorCode(1, 0)).toBe(0x01);
    expect(reparsed.toBytes()).toHaveLength(175_531);
  });
});
