import type { D64Image } from '../disk/D64Image';

const GCR_NIBBLE = Object.freeze([
  0x0a, 0x0b, 0x12, 0x13,
  0x0e, 0x0f, 0x16, 0x17,
  0x09, 0x19, 0x1a, 0x1b,
  0x0d, 0x1d, 0x1e, 0x15
] as const);

const SYNC_LENGTH = 5;
const HEADER_GAP_LENGTH = 9;
const DATA_GAP_MINIMUM = 8;

export interface GcrTrack {
  readonly track: number;
  readonly density: 0 | 1 | 2 | 3;
  /** Nominal 1 MHz drive cycles between complete 8-bit GCR bytes. */
  readonly cyclesPerByte: 32 | 30 | 28 | 26;
  /** Circular byte stream seen by the 1541 read electronics. */
  readonly bytes: Uint8Array;
}

/** Encode four binary bytes into the five on-disk Commodore GCR bytes. */
export function encodeGcrBlock(input: ArrayLike<number>): Uint8Array {
  if ((input.length & 0x03) !== 0) {
    throw new RangeError(`GCR input length must be a multiple of four bytes; received ${input.length}.`);
  }

  const output = new Uint8Array((input.length / 4) * 5);
  let out = 0;

  for (let index = 0; index < input.length; index += 4) {
    let packed = 0n;
    for (let byteIndex = 0; byteIndex < 4; byteIndex += 1) {
      const value = input[index + byteIndex]! & 0xff;
      packed = (packed << 5n) | BigInt(GCR_NIBBLE[(value >> 4) & 0x0f]!);
      packed = (packed << 5n) | BigInt(GCR_NIBBLE[value & 0x0f]!);
    }

    for (let byteIndex = 4; byteIndex >= 0; byteIndex -= 1) {
      output[out + byteIndex] = Number(packed & 0xffn);
      packed >>= 8n;
    }
    out += 5;
  }

  return output;
}

/** Commodore XOR checksum used by both GCR sector headers and data blocks. */
export function gcrChecksum(bytes: ArrayLike<number>): number {
  let checksum = 0;
  for (let index = 0; index < bytes.length; index += 1) checksum ^= bytes[index]! & 0xff;
  return checksum & 0xff;
}

/** Density-zone selection used by the 1541 for standard 5.25-inch tracks. */
export function densityForTrack(track: number): 0 | 1 | 2 | 3 {
  if (!Number.isInteger(track) || track < 1 || track > 42) {
    throw new RangeError(`1541 track must be in the range 1-42; received ${track}.`);
  }
  if (track <= 17) return 3;
  if (track <= 24) return 2;
  if (track <= 30) return 1;
  return 0;
}

export function cyclesPerGcrByte(density: 0 | 1 | 2 | 3): 32 | 30 | 28 | 26 {
  return ([32, 30, 28, 26] as const)[density];
}

/**
 * Build a circular byte-level GCR track from a sector-oriented D64 image.
 *
 * The layout follows the 1541 format consumed by the 64H156 read path:
 * header sync, encoded 8-byte header, header gap, data sync, encoded 260-byte
 * data block, and an inter-sector gap. D64 error-table bytes are reflected in
 * the common corruption modes that can be represented at this layer.
 */
export function buildGcrTrack(image: D64Image, track: number): GcrTrack {
  const sectorCount = image.sectorsOnTrack(track);
  const bam = image.readSector(18, 0);
  const id1 = bam[0xa2] ?? 0;
  const id2 = bam[0xa3] ?? 0;
  const chunks: number[] = [];

  for (let sector = 0; sector < sectorCount; sector += 1) {
    const data = image.readSector(track, sector);
    const error = image.sectorErrorCode(track, sector) ?? 1;
    appendSector(chunks, track, sector, data, id1, id2, error);
  }

  const density = densityForTrack(track);
  const nominalLength = nominalTrackBytes(density);
  while (chunks.length < nominalLength) chunks.push(0x55);

  return Object.freeze({
    track,
    density,
    cyclesPerByte: cyclesPerGcrByte(density),
    bytes: Uint8Array.from(chunks)
  });
}

function appendSector(
  output: number[],
  track: number,
  sector: number,
  sectorData: Uint8Array,
  id1: number,
  id2: number,
  errorCode: number
): void {
  const completeSectorLength = SYNC_LENGTH + 10 + HEADER_GAP_LENGTH + SYNC_LENGTH + 325 + DATA_GAP_MINIMUM;
  if (errorCode === 3) {
    appendFill(output, 0x55, completeSectorLength);
    return;
  }

  const headerId1 = errorCode === 11 ? id1 ^ 0xff : id1;
  const headerId2 = errorCode === 11 ? id2 ^ 0xff : id2;
  let headerChecksum = (sector ^ track ^ headerId1 ^ headerId2) & 0xff;
  if (errorCode === 9) headerChecksum ^= 0xff;

  // 20/READ ERROR: emulate a missing header by omitting its sync/ID block.
  if (errorCode !== 2) {
    appendFill(output, 0xff, SYNC_LENGTH);
    const header = Uint8Array.of(
      0x08,
      headerChecksum,
      sector & 0xff,
      track & 0xff,
      headerId2,
      headerId1,
      0x0f,
      0x0f
    );
    appendBytes(output, encodeGcrBlock(header));
    appendFill(output, 0x55, HEADER_GAP_LENGTH);
  } else {
    appendFill(output, 0x55, SYNC_LENGTH + 10 + HEADER_GAP_LENGTH);
  }

  if (errorCode === 4) {
    appendFill(output, 0x55, SYNC_LENGTH + 325 + DATA_GAP_MINIMUM);
    return;
  }

  appendFill(output, 0xff, SYNC_LENGTH);

  let checksum = gcrChecksum(sectorData);
  if (errorCode === 5) checksum ^= 0xff;
  const marker = errorCode === 4 ? 0x00 : 0x07;
  const dataBlock = new Uint8Array(260);
  dataBlock[0] = marker;
  dataBlock.set(sectorData, 1);
  dataBlock[257] = checksum;
  dataBlock[258] = 0;
  dataBlock[259] = 0;
  appendBytes(output, encodeGcrBlock(dataBlock));
  appendFill(output, 0x55, DATA_GAP_MINIMUM);
}

function nominalTrackBytes(density: 0 | 1 | 2 | 3): number {
  // 300 RPM => five revolutions/second. One raw byte consumes 32/30/28/26
  // microseconds in density zones 0..3 respectively.
  return Math.round(200_000 / cyclesPerGcrByte(density));
}

function appendFill(output: number[], value: number, count: number): void {
  for (let index = 0; index < count; index += 1) output.push(value & 0xff);
}

function appendBytes(output: number[], bytes: Uint8Array): void {
  for (const value of bytes) output.push(value);
}
