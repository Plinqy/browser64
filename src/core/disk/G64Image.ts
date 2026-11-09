const G64_SIGNATURE = 'GCR-1541';
const HEADER_SIZE = 0x0c;
const MAX_HALF_TRACKS = 84;

export interface G64TrackData {
  /** Physical track number: 1, 1.5, 2, 2.5 ... */
  readonly track: number;
  readonly bytes: Uint8Array;
  /** One 1541 speed-zone value (0-3) per stored GCR byte. */
  readonly speedZones: Uint8Array;
}

/**
 * Mutable G64 raw-GCR image.
 *
 * G64 stores every full/half track as the byte stream seen by the 1541 read
 * electronics, plus either a constant speed zone or a packed per-byte speed
 * map. Keeping this representation intact lets custom formats and many
 * copy-protection layouts survive a mount/edit/export round trip.
 */
export class G64Image {
  public readonly version: 0;
  public readonly trackEntryCount: number;
  private maximumTrackSizeValue: number;
  private readonly tracks: Array<G64TrackData | null>;

  private constructor(version: 0, trackEntryCount: number, maximumTrackSize: number, tracks: Array<G64TrackData | null>) {
    this.version = version;
    this.trackEntryCount = trackEntryCount;
    this.maximumTrackSizeValue = maximumTrackSize;
    this.tracks = tracks;
  }

  static parse(bytesLike: ArrayLike<number>): G64Image {
    const bytes = Uint8Array.from(bytesLike, (value) => value & 0xff);
    if (bytes.length < HEADER_SIZE) throw new RangeError(`G64 image is too short (${bytes.length} bytes).`);
    if (ascii(bytes, 0, 8) !== G64_SIGNATURE) throw new Error('Invalid G64 signature.');

    const version = bytes[0x08] ?? 0xff;
    if (version !== 0) throw new Error(`Unsupported G64 version ${version}; only version 0 is defined.`);

    const trackEntryCount = bytes[0x09] ?? 0;
    if (trackEntryCount < 1 || trackEntryCount > MAX_HALF_TRACKS) {
      throw new RangeError(`Invalid G64 track-entry count ${trackEntryCount}; expected 1-${MAX_HALF_TRACKS}.`);
    }

    const maximumTrackSize = le16(bytes, 0x0a);
    if (maximumTrackSize < 1) throw new RangeError('G64 maximum track size must be non-zero.');

    const tablesEnd = HEADER_SIZE + trackEntryCount * 8;
    if (tablesEnd > bytes.length) throw new RangeError('G64 track/speed tables are truncated.');

    const speedTableOffset = HEADER_SIZE + trackEntryCount * 4;
    const tracks: Array<G64TrackData | null> = [];

    for (let index = 0; index < trackEntryCount; index += 1) {
      const trackOffset = le32(bytes, HEADER_SIZE + index * 4);
      const speedEntry = le32(bytes, speedTableOffset + index * 4);
      if (trackOffset === 0) {
        tracks.push(null);
        continue;
      }
      if (trackOffset + 2 > bytes.length) throw new RangeError(`G64 track ${trackName(index)} offset is outside the image.`);

      const actualLength = le16(bytes, trackOffset);
      if (actualLength < 1 || actualLength > maximumTrackSize || trackOffset + 2 + actualLength > bytes.length) {
        throw new RangeError(`Invalid G64 track ${trackName(index)} length ${actualLength}.`);
      }

      const trackBytes = bytes.slice(trackOffset + 2, trackOffset + 2 + actualLength);
      const speedZones = new Uint8Array(actualLength);
      if (speedEntry <= 3) {
        speedZones.fill(speedEntry);
      } else {
        const packedLength = Math.ceil(actualLength / 4);
        if (speedEntry + packedLength > bytes.length) {
          throw new RangeError(`G64 speed map for track ${trackName(index)} is truncated.`);
        }
        for (let byteIndex = 0; byteIndex < actualLength; byteIndex += 1) {
          const packed = bytes[speedEntry + Math.floor(byteIndex / 4)] ?? 0;
          const shift = 6 - (byteIndex & 0x03) * 2;
          speedZones[byteIndex] = (packed >> shift) & 0x03;
        }
      }

      tracks.push(Object.freeze({ track: 1 + index / 2, bytes: trackBytes, speedZones }));
    }

    return new G64Image(0, trackEntryCount, maximumTrackSize, tracks);
  }

  get maximumTrackSize(): number { return this.maximumTrackSizeValue; }

  /** Read a 1-based physical half-track position (1 = track 1.0, 2 = 1.5). */
  readHalfTrack(position: number): G64TrackData | null {
    const index = this.positionToIndex(position);
    const track = this.tracks[index];
    if (track === null || track === undefined) return null;
    return Object.freeze({ track: track.track, bytes: track.bytes.slice(), speedZones: track.speedZones.slice() });
  }

  /** Internal mutable track view for the emulated read/write head. */
  mutableHalfTrack(position: number): G64TrackData | null {
    const index = this.positionToIndex(position);
    return this.tracks[index] ?? null;
  }

  replaceHalfTrack(position: number, data: ArrayLike<number>, speedZones?: ArrayLike<number>): void {
    const index = this.positionToIndex(position);
    if (data.length < 1) throw new RangeError('G64 tracks must contain at least one byte.');
    const bytes = Uint8Array.from(data, (value) => value & 0xff);
    const speeds = speedZones === undefined
      ? new Uint8Array(bytes.length).fill(defaultSpeedForTrack(1 + index / 2))
      : Uint8Array.from(speedZones, (value) => value & 0x03);
    if (speeds.length !== bytes.length) throw new RangeError('G64 speed-map length must match track byte length.');
    this.maximumTrackSizeValue = Math.max(this.maximumTrackSizeValue, bytes.length);
    this.tracks[index] = Object.freeze({ track: 1 + index / 2, bytes, speedZones: speeds });
  }

  /** Canonical G64 v0 serialization preserving raw track bytes and speed maps. */
  toBytes(): Uint8Array {
    let maximumTrackSize = this.maximumTrackSizeValue;
    for (const track of this.tracks) if (track !== null) maximumTrackSize = Math.max(maximumTrackSize, track.bytes.length);
    if (maximumTrackSize > 0xffff) throw new RangeError(`G64 maximum track size ${maximumTrackSize} exceeds 16-bit format capacity.`);

    const tableSize = HEADER_SIZE + this.trackEntryCount * 8;
    const trackOffsets = new Uint32Array(this.trackEntryCount);
    const speedEntries = new Uint32Array(this.trackEntryCount);
    let cursor = tableSize;

    for (let index = 0; index < this.trackEntryCount; index += 1) {
      const track = this.tracks[index];
      if (track !== null && track !== undefined) {
        trackOffsets[index] = cursor;
        cursor += 2 + maximumTrackSize;
      }
    }

    const packedSpeedBlocks = new Map<number, Uint8Array>();
    for (let index = 0; index < this.trackEntryCount; index += 1) {
      const track = this.tracks[index];
      if (track === null || track === undefined) continue;
      const constant = constantSpeed(track.speedZones);
      if (constant !== null) {
        speedEntries[index] = constant;
      } else {
        const packed = packSpeedZones(track.speedZones);
        speedEntries[index] = cursor;
        packedSpeedBlocks.set(index, packed);
        cursor += packed.length;
      }
    }

    const output = new Uint8Array(cursor);
    writeAscii(output, 0, G64_SIGNATURE);
    output[0x08] = 0;
    output[0x09] = this.trackEntryCount;
    writeLe16(output, 0x0a, maximumTrackSize);
    const speedTableOffset = HEADER_SIZE + this.trackEntryCount * 4;

    for (let index = 0; index < this.trackEntryCount; index += 1) {
      writeLe32(output, HEADER_SIZE + index * 4, trackOffsets[index] ?? 0);
      writeLe32(output, speedTableOffset + index * 4, speedEntries[index] ?? 0);
      const track = this.tracks[index];
      if (track === null || track === undefined) continue;
      const offset = trackOffsets[index] ?? 0;
      writeLe16(output, offset, track.bytes.length);
      output.set(track.bytes, offset + 2);
      output.fill(0xff, offset + 2 + track.bytes.length, offset + 2 + maximumTrackSize);
      const packed = packedSpeedBlocks.get(index);
      if (packed !== undefined) output.set(packed, speedEntries[index]);
    }

    return output;
  }

  private positionToIndex(position: number): number {
    if (!Number.isInteger(position) || position < 1 || position > this.trackEntryCount) {
      throw new RangeError(`G64 half-track position must be 1-${this.trackEntryCount}; received ${position}.`);
    }
    return position - 1;
  }
}

export function parseG64(bytes: ArrayLike<number>): G64Image { return G64Image.parse(bytes); }

function constantSpeed(speeds: Uint8Array): number | null {
  const first = speeds[0];
  if (first === undefined) return 0;
  for (let index = 1; index < speeds.length; index += 1) if (speeds[index] !== first) return null;
  return first & 0x03;
}

function packSpeedZones(speeds: Uint8Array): Uint8Array {
  const packed = new Uint8Array(Math.ceil(speeds.length / 4));
  for (let index = 0; index < speeds.length; index += 1) {
    const shift = 6 - (index & 0x03) * 2;
    packed[Math.floor(index / 4)]! |= (speeds[index]! & 0x03) << shift;
  }
  return packed;
}

function defaultSpeedForTrack(track: number): number {
  if (track <= 17) return 3;
  if (track <= 24) return 2;
  if (track <= 30) return 1;
  return 0;
}

function trackName(index: number): string { return (1 + index / 2).toFixed(index & 1 ? 1 : 0); }
function ascii(bytes: Uint8Array, offset: number, length: number): string {
  let value = '';
  for (let index = 0; index < length; index += 1) value += String.fromCharCode(bytes[offset + index] ?? 0);
  return value;
}
function writeAscii(bytes: Uint8Array, offset: number, value: string): void {
  for (let index = 0; index < value.length; index += 1) bytes[offset + index] = value.charCodeAt(index) & 0xff;
}
function le16(bytes: Uint8Array, offset: number): number { return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8); }
function le32(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8) | ((bytes[offset + 2] ?? 0) << 16) | ((bytes[offset + 3] ?? 0) * 0x01000000)) >>> 0;
}
function writeLe16(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >> 8) & 0xff;
}
function writeLe32(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >>> 8) & 0xff;
  bytes[offset + 2] = (value >>> 16) & 0xff;
  bytes[offset + 3] = (value >>> 24) & 0xff;
}
