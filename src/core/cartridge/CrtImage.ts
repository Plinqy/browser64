const CRT_SIGNATURE = 'C64 CARTRIDGE   ';
const CHIP_SIGNATURE = 'CHIP';
const MIN_HEADER_LENGTH = 0x40;
const CHIP_HEADER_LENGTH = 0x10;

export interface CrtChipPacket {
  readonly chipType: number;
  readonly bank: number;
  readonly loadAddress: number;
  readonly image: Uint8Array;
}

export interface CrtImage {
  readonly version: number;
  readonly hardwareType: number;
  readonly exromHigh: boolean;
  readonly gameHigh: boolean;
  readonly name: string;
  readonly chips: readonly CrtChipPacket[];
}

export function parseCrt(bytesLike: ArrayLike<number>): CrtImage {
  const bytes = Uint8Array.from(bytesLike, (value) => value & 0xff);
  if (bytes.length < MIN_HEADER_LENGTH) {
    throw new RangeError(`CRT image is too short (${bytes.length} bytes).`);
  }

  const signature = ascii(bytes, 0, 16);
  if (signature !== CRT_SIGNATURE) {
    throw new Error(`Invalid CRT signature ${JSON.stringify(signature)}.`);
  }

  const headerLength = be32(bytes, 0x10);
  if (headerLength < MIN_HEADER_LENGTH || headerLength > bytes.length) {
    throw new RangeError(`Invalid CRT header length ${headerLength}.`);
  }

  const version = be16(bytes, 0x14);
  const hardwareType = be16(bytes, 0x16);
  const exromHigh = (bytes[0x18] ?? 0) !== 0;
  const gameHigh = (bytes[0x19] ?? 0) !== 0;
  const name = ascii(bytes, 0x20, 32).replace(/\0+$/g, '').trimEnd();

  const chips: CrtChipPacket[] = [];
  let offset = headerLength;
  while (offset < bytes.length) {
    if (offset + CHIP_HEADER_LENGTH > bytes.length) {
      throw new RangeError(`Truncated CRT CHIP header at offset $${hex(offset, 6)}.`);
    }
    if (ascii(bytes, offset, 4) !== CHIP_SIGNATURE) {
      throw new Error(`Missing CHIP signature at CRT offset $${hex(offset, 6)}.`);
    }

    const packetLength = be32(bytes, offset + 4);
    const chipType = be16(bytes, offset + 8);
    const bank = be16(bytes, offset + 0x0a);
    const loadAddress = be16(bytes, offset + 0x0c);
    const imageSize = be16(bytes, offset + 0x0e);

    if (packetLength < CHIP_HEADER_LENGTH + imageSize || offset + packetLength > bytes.length) {
      throw new RangeError(`Invalid CRT CHIP packet length ${packetLength} at offset $${hex(offset, 6)}.`);
    }

    chips.push(Object.freeze({
      chipType,
      bank,
      loadAddress,
      image: bytes.slice(offset + CHIP_HEADER_LENGTH, offset + CHIP_HEADER_LENGTH + imageSize)
    }));
    offset += packetLength;
  }

  if (chips.length === 0) {
    throw new Error('CRT image contains no CHIP packets.');
  }

  return Object.freeze({
    version,
    hardwareType,
    exromHigh,
    gameHigh,
    name,
    chips: Object.freeze(chips.slice())
  });
}

function be16(bytes: Uint8Array, offset: number): number {
  return (((bytes[offset] ?? 0) << 8) | (bytes[offset + 1] ?? 0)) & 0xffff;
}

function be32(bytes: Uint8Array, offset: number): number {
  return (((bytes[offset] ?? 0) * 0x01000000) +
    ((bytes[offset + 1] ?? 0) << 16) +
    ((bytes[offset + 2] ?? 0) << 8) +
    (bytes[offset + 3] ?? 0)) >>> 0;
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  let out = '';
  for (let index = 0; index < length; index += 1) {
    out += String.fromCharCode(bytes[offset + index] ?? 0);
  }
  return out;
}

function hex(value: number, width: number): string {
  return (value >>> 0).toString(16).toUpperCase().padStart(width, '0');
}
