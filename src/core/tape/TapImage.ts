const TAP_HEADER_SIZE = 0x14;
const TAP_SIGNATURE = 'C64-TAPE-RAW';

/** VICE-compatible fallback for TAP gaps whose exact duration was lost. */
export const TAP_ZERO_GAP_CYCLES = 2500;

export interface TapPulse {
  readonly cycles: number;
  readonly nextOffset: number;
}

export class TapImage {
  public readonly version: 0 | 1;
  public readonly platform: number;
  public readonly videoStandard: number;
  private readonly data: Uint8Array;

  private constructor(version: 0 | 1, platform: number, videoStandard: number, data: Uint8Array) {
    this.version = version;
    this.platform = platform;
    this.videoStandard = videoStandard;
    this.data = data;
  }

  static create(videoStandard = 0): TapImage {
    return new TapImage(1, 0, videoStandard & 0xff, new Uint8Array(0));
  }

  static parse(bytesLike: ArrayLike<number>): TapImage {
    const bytes = Uint8Array.from(bytesLike, (value) => value & 0xff);
    if (bytes.length < TAP_HEADER_SIZE) {
      throw new RangeError(`TAP image is too short (${bytes.length} bytes).`);
    }

    let signature = '';
    for (let index = 0; index < 12; index += 1) {
      signature += String.fromCharCode(bytes[index] ?? 0);
    }
    if (signature !== TAP_SIGNATURE) {
      throw new Error(`Invalid TAP signature ${JSON.stringify(signature)}.`);
    }

    const rawVersion = bytes[0x0c] ?? 0xff;
    if (rawVersion !== 0 && rawVersion !== 1) {
      throw new Error(`Unsupported C64 TAP version ${rawVersion}; versions 0 and 1 are supported.`);
    }

    const platform = bytes[0x0d] ?? 0;
    if (platform !== 0) {
      throw new Error(`TAP platform ${platform} is not a C64 image.`);
    }

    const dataLength = le32(bytes, 0x10);
    if (TAP_HEADER_SIZE + dataLength > bytes.length) {
      throw new RangeError(`TAP declares ${dataLength} data bytes but the file is truncated.`);
    }

    return new TapImage(rawVersion, platform, bytes[0x0e] ?? 0, bytes.slice(TAP_HEADER_SIZE, TAP_HEADER_SIZE + dataLength));
  }

  get byteLength(): number {
    return this.data.length;
  }

  /** Defensive copy of the raw pulse stream, excluding the 20-byte TAP header. */
  dataBytes(): Uint8Array { return this.data.slice(); }

  /** Serialize this image as a complete C64 TAP file. */
  toBytes(): Uint8Array {
    const output = new Uint8Array(TAP_HEADER_SIZE + this.data.length);
    for (let index = 0; index < TAP_SIGNATURE.length; index += 1) output[index] = TAP_SIGNATURE.charCodeAt(index);
    output[0x0c] = this.version;
    output[0x0d] = this.platform;
    output[0x0e] = this.videoStandard;
    writeLe32(output, 0x10, this.data.length);
    output.set(this.data, TAP_HEADER_SIZE);
    return output;
  }

  /** Build a v1 C64 TAP from raw already-encoded pulse bytes. */
  static fromPulseBytes(data: ArrayLike<number>, videoStandard = 0): TapImage {
    return new TapImage(1, 0, videoStandard & 0xff, Uint8Array.from(data, (value) => value & 0xff));
  }

  /** Timer clock that the TAP pulse counts were recorded against. */
  get sourceClockHz(): number {
    switch (this.videoStandard) {
      case 0: return 985_248; // PAL
      case 1:
      case 2: return 1_022_730; // NTSC / old NTSC TAP convention
      case 3: return 1_023_440; // PAL-N
      default: return 985_248; // Original TAPs assumed a PAL C64 clock.
    }
  }

  pulseAt(offset: number): TapPulse | null {
    if (offset < 0 || offset >= this.data.length) return null;
    const value = this.data[offset] ?? 0;

    if (value !== 0) {
      return { cycles: value * 8, nextOffset: offset + 1 };
    }

    if (this.version === 0) {
      // TAP v0 lost the exact duration of overflow entries. VICE defaults to
      // reconstructing those otherwise-unknown intervals as 2500 CPU cycles.
      return { cycles: TAP_ZERO_GAP_CYCLES, nextOffset: offset + 1 };
    }

    if (offset + 3 >= this.data.length) {
      throw new RangeError(`Truncated TAP v1 extended pulse at data offset ${offset}.`);
    }
    const cycles = (this.data[offset + 1] ?? 0) |
      ((this.data[offset + 2] ?? 0) << 8) |
      ((this.data[offset + 3] ?? 0) << 16);
    // Some v1 files also carry an all-zero extended length. VICE treats that
    // as the same compatibility gap rather than as an end marker.
    return { cycles: cycles === 0 ? TAP_ZERO_GAP_CYCLES : cycles, nextOffset: offset + 4 };
  }
}

export function parseTap(bytes: ArrayLike<number>): TapImage {
  return TapImage.parse(bytes);
}

/** Encode one exact v1 C64 TAP interval in source-clock cycles. */
export function encodeTapPulse(cycles: number): Uint8Array {
  if (!Number.isInteger(cycles) || cycles < 1 || cycles > 0xffffff) {
    throw new RangeError(`TAP v1 pulse must be 1-$FFFFFF cycles; received ${cycles}.`);
  }
  if (cycles <= 255 * 8 && cycles % 8 === 0) return Uint8Array.of(cycles / 8);
  return Uint8Array.of(0, cycles & 0xff, (cycles >> 8) & 0xff, (cycles >> 16) & 0xff);
}

function le32(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] ?? 0) |
    ((bytes[offset + 1] ?? 0) << 8) |
    ((bytes[offset + 2] ?? 0) << 16) |
    ((bytes[offset + 3] ?? 0) * 0x01000000)) >>> 0;
}

function writeLe32(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >>> 8) & 0xff;
  bytes[offset + 2] = (value >>> 16) & 0xff;
  bytes[offset + 3] = (value >>> 24) & 0xff;
}
