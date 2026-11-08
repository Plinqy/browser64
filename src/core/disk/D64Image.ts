export type D64FileType = 'DEL' | 'SEQ' | 'PRG' | 'USR' | 'REL' | 'UNKNOWN';

export interface D64Geometry {
  readonly tracks: 35 | 40 | 42;
  readonly sectorCount: number;
  readonly dataByteLength: number;
  readonly hasErrorInfo: boolean;
}

export interface D64DirectoryEntry {
  readonly directoryIndex: number;
  readonly fileTypeByte: number;
  readonly fileType: D64FileType;
  readonly closed: boolean;
  readonly locked: boolean;
  readonly startTrack: number;
  readonly startSector: number;
  readonly filename: string;
  readonly filenamePetscii: readonly number[];
  readonly blocks: number;
}

export interface D64DiskHeader {
  readonly name: string;
  readonly id: string;
  readonly dosType: string;
  readonly dosVersion: number;
}

interface D64Variant extends D64Geometry {
  readonly totalByteLength: number;
}

const SECTOR_SIZE = 256;
const DIRECTORY_TRACK = 18;
const DIRECTORY_FIRST_SECTOR = 1;

const D64_VARIANTS: readonly D64Variant[] = Object.freeze([
  Object.freeze({ tracks: 35, sectorCount: 683, dataByteLength: 174_848, hasErrorInfo: false, totalByteLength: 174_848 }),
  Object.freeze({ tracks: 35, sectorCount: 683, dataByteLength: 174_848, hasErrorInfo: true, totalByteLength: 175_531 }),
  Object.freeze({ tracks: 40, sectorCount: 768, dataByteLength: 196_608, hasErrorInfo: false, totalByteLength: 196_608 }),
  Object.freeze({ tracks: 40, sectorCount: 768, dataByteLength: 196_608, hasErrorInfo: true, totalByteLength: 197_376 }),
  Object.freeze({ tracks: 42, sectorCount: 802, dataByteLength: 205_312, hasErrorInfo: false, totalByteLength: 205_312 }),
  Object.freeze({ tracks: 42, sectorCount: 802, dataByteLength: 205_312, hasErrorInfo: true, totalByteLength: 206_114 })
]);

const FILE_TYPE_NAMES: Readonly<Record<number, D64FileType>> = Object.freeze({
  0: 'DEL',
  1: 'SEQ',
  2: 'PRG',
  3: 'USR',
  4: 'REL'
});

/**
 * Immutable parser/view for 1541-compatible D64 sector images.
 *
 * Standard 35-track images plus the common 40/42-track extensions are
 * accepted, with or without the optional one-byte-per-sector error table.
 */
export class D64Image {
  public readonly geometry: D64Geometry;
  public readonly header: D64DiskHeader;

  private readonly diskData: Uint8Array;
  private readonly errorInfo: Uint8Array | null;
  private readonly trackOffsets: Uint32Array;
  private directoryCache: readonly D64DirectoryEntry[] | null = null;

  private constructor(bytes: Uint8Array, variant: D64Variant) {
    this.geometry = Object.freeze({
      tracks: variant.tracks,
      sectorCount: variant.sectorCount,
      dataByteLength: variant.dataByteLength,
      hasErrorInfo: variant.hasErrorInfo
    });
    this.diskData = bytes.slice(0, variant.dataByteLength);
    this.errorInfo = variant.hasErrorInfo
      ? bytes.slice(variant.dataByteLength, variant.totalByteLength)
      : null;
    this.trackOffsets = buildTrackOffsets(variant.tracks);

    const bam = this.sectorView(DIRECTORY_TRACK, 0);
    this.header = Object.freeze({
      name: decodePetscii(bam.subarray(0x90, 0xa0)),
      id: decodePetscii(bam.subarray(0xa2, 0xa4)),
      dosType: decodePetscii(bam.subarray(0xa5, 0xa7)),
      dosVersion: bam[0x02] ?? 0
    });
  }

  static parse(bytes: ArrayLike<number>): D64Image {
    const variant = D64_VARIANTS.find((candidate) => candidate.totalByteLength === bytes.length);
    if (variant === undefined) {
      throw new RangeError(
        `Unsupported D64 size ${bytes.length} bytes. Expected 35/40/42-track D64 data with optional error bytes.`
      );
    }

    const copy = new Uint8Array(bytes.length);
    for (let index = 0; index < bytes.length; index += 1) {
      copy[index] = bytes[index]! & 0xff;
    }
    return new D64Image(copy, variant);
  }

  /** Number of sectors physically present on one 1-based D64 track. */
  sectorsOnTrack(track: number): number {
    this.assertTrack(track);
    return sectorsForTrack(track);
  }

  /** Copy one complete 256-byte sector from the immutable image. */
  readSector(track: number, sector: number): Uint8Array {
    return this.sectorView(track, sector).slice();
  }

  /** Optional D64 error-table byte for a sector, or `null` when no table exists. */
  sectorErrorCode(track: number, sector: number): number | null {
    const sectorIndex = this.sectorIndex(track, sector);
    return this.errorInfo === null ? null : this.errorInfo[sectorIndex] ?? null;
  }

  /** Parse the linked directory chain beginning at the canonical 18/1 sector. */
  listDirectory(): readonly D64DirectoryEntry[] {
    if (this.directoryCache !== null) {
      return this.directoryCache;
    }

    const entries: D64DirectoryEntry[] = [];
    const visited = new Set<string>();
    let track = DIRECTORY_TRACK;
    let sector = DIRECTORY_FIRST_SECTOR;
    let directoryIndex = 0;

    while (track !== 0) {
      const key = trackSectorKey(track, sector);
      if (visited.has(key)) {
        throw new Error(`D64 directory chain loops at track ${track}, sector ${sector}.`);
      }
      visited.add(key);

      const directorySector = this.sectorView(track, sector);
      const nextTrack = directorySector[0] ?? 0;
      const nextSector = directorySector[1] ?? 0;

      for (let slot = 0; slot < 8; slot += 1) {
        const base = slot * 32;
        const fileTypeByte = directorySector[base + 2] ?? 0;
        const fileTypeCode = fileTypeByte & 0x0f;
        const startTrack = directorySector[base + 3] ?? 0;
        const startSector = directorySector[base + 4] ?? 0;

        // A zero file-type byte denotes an unused/deleted directory slot.
        if (fileTypeByte === 0) {
          continue;
        }

        const filenamePetscii = Object.freeze(Array.from(directorySector.slice(base + 5, base + 21)));
        const blocks = (directorySector[base + 30] ?? 0) | ((directorySector[base + 31] ?? 0) << 8);
        entries.push(Object.freeze({
          directoryIndex,
          fileTypeByte,
          fileType: FILE_TYPE_NAMES[fileTypeCode] ?? 'UNKNOWN',
          closed: (fileTypeByte & 0x80) !== 0,
          locked: (fileTypeByte & 0x40) !== 0,
          startTrack,
          startSector,
          filename: decodePetscii(filenamePetscii),
          filenamePetscii,
          blocks
        }));
        directoryIndex += 1;
      }

      if (nextTrack === 0) {
        break;
      }
      this.assertSector(nextTrack, nextSector);
      track = nextTrack;
      sector = nextSector;
    }

    this.directoryCache = Object.freeze(entries.slice());
    return this.directoryCache;
  }

  /**
   * Extract the byte stream of a chained CBM DOS file.
   *
   * The returned bytes are the exact file contents. For a PRG this includes
   * its first two little-endian load-address bytes, making the result directly
   * consumable by the existing PRG parser/loader.
   */
  readFile(entry: D64DirectoryEntry): Uint8Array {
    if (entry.startTrack === 0) {
      return new Uint8Array(0);
    }

    const chunks: Uint8Array[] = [];
    const visited = new Set<string>();
    let totalLength = 0;
    let track = entry.startTrack;
    let sector = entry.startSector;

    while (track !== 0) {
      const key = trackSectorKey(track, sector);
      if (visited.has(key)) {
        throw new Error(
          `D64 file "${entry.filename}" has a sector-chain loop at track ${track}, sector ${sector}.`
        );
      }
      visited.add(key);

      const dataSector = this.sectorView(track, sector);
      const nextTrack = dataSector[0] ?? 0;
      const nextSector = dataSector[1] ?? 0;

      if (nextTrack === 0) {
        // On the final sector the second link byte is the last used byte index.
        // Therefore $FF means bytes $02-$FF (254 bytes), and $01 means no data.
        if (nextSector < 1) {
          throw new Error(
            `D64 file "${entry.filename}" has invalid final-sector length byte ${nextSector}.`
          );
        }
        const chunk = dataSector.slice(2, nextSector + 1);
        chunks.push(chunk);
        totalLength += chunk.length;
        break;
      }

      const chunk = dataSector.slice(2);
      chunks.push(chunk);
      totalLength += chunk.length;
      this.assertSector(nextTrack, nextSector);
      track = nextTrack;
      sector = nextSector;
    }

    const output = new Uint8Array(totalLength);
    let destination = 0;
    for (const chunk of chunks) {
      output.set(chunk, destination);
      destination += chunk.length;
    }
    return output;
  }

  readPrg(entry: D64DirectoryEntry): Uint8Array {
    if (entry.fileType !== 'PRG') {
      throw new TypeError(`D64 entry "${entry.filename}" is ${entry.fileType}, not PRG.`);
    }
    return this.readFile(entry);
  }

  private sectorView(track: number, sector: number): Uint8Array {
    const index = this.sectorIndex(track, sector);
    const offset = index * SECTOR_SIZE;
    return this.diskData.subarray(offset, offset + SECTOR_SIZE);
  }

  private sectorIndex(track: number, sector: number): number {
    this.assertSector(track, sector);
    return (this.trackOffsets[track] ?? 0) + sector;
  }

  private assertSector(track: number, sector: number): void {
    this.assertTrack(track);
    const count = sectorsForTrack(track);
    if (!Number.isInteger(sector) || sector < 0 || sector >= count) {
      throw new RangeError(
        `D64 sector ${sector} is invalid for track ${track}; expected 0-${count - 1}.`
      );
    }
  }

  private assertTrack(track: number): void {
    if (!Number.isInteger(track) || track < 1 || track > this.geometry.tracks) {
      throw new RangeError(`D64 track ${track} is outside 1-${this.geometry.tracks}.`);
    }
  }
}

export function parseD64(bytes: ArrayLike<number>): D64Image {
  return D64Image.parse(bytes);
}

function sectorsForTrack(track: number): number {
  if (track <= 17) return 21;
  if (track <= 24) return 19;
  if (track <= 30) return 18;
  return 17;
}

function buildTrackOffsets(tracks: number): Uint32Array {
  const offsets = new Uint32Array(tracks + 1);
  let sectorOffset = 0;
  for (let track = 1; track <= tracks; track += 1) {
    offsets[track] = sectorOffset;
    sectorOffset += sectorsForTrack(track);
  }
  return offsets;
}

function trackSectorKey(track: number, sector: number): string {
  return `${track}/${sector}`;
}

/** Conservative PETSCII-to-display conversion for disk labels and filenames. */
export function decodePetscii(bytes: ArrayLike<number>): string {
  let end = bytes.length;
  while (end > 0) {
    const byte = bytes[end - 1]! & 0xff;
    if (byte !== 0xa0 && byte !== 0x20 && byte !== 0x00) {
      break;
    }
    end -= 1;
  }

  let result = '';
  for (let index = 0; index < end; index += 1) {
    const byte = bytes[index]! & 0xff;

    if (byte === 0xa0 || byte === 0x20) {
      result += ' ';
    } else if (byte >= 0x41 && byte <= 0x5a) {
      result += String.fromCharCode(byte);
    } else if (byte >= 0xc1 && byte <= 0xda) {
      result += String.fromCharCode(0x41 + (byte - 0xc1));
    } else if (byte >= 0x61 && byte <= 0x7a) {
      result += String.fromCharCode(byte);
    } else if (byte >= 0x30 && byte <= 0x39) {
      result += String.fromCharCode(byte);
    } else if (byte === 0x5c) {
      result += '£';
    } else if (byte === 0x5e) {
      result += '↑';
    } else if (byte === 0x5f) {
      result += '←';
    } else if (byte >= 0x21 && byte <= 0x3f) {
      result += String.fromCharCode(byte);
    } else {
      result += '·';
    }
  }
  return result;
}
