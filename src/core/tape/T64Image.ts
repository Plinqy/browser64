export type T64CbmFileType = 'DEL' | 'SEQ' | 'PRG' | 'USR' | 'REL' | 'UNKNOWN';

export interface T64Header {
  readonly signature: string;
  readonly version: number;
  readonly directoryEntries: number;
  readonly usedEntries: number;
  readonly description: string;
}

export interface T64DirectoryEntry {
  readonly directoryIndex: number;
  readonly entryType: number;
  readonly cbmFileTypeByte: number;
  readonly fileType: T64CbmFileType;
  readonly filename: string;
  readonly startAddress: number;
  readonly endAddressExclusive: number;
  readonly dataOffset: number;
  readonly byteLength: number;
  readonly loadable: boolean;
}

interface RawT64Entry {
  readonly directoryIndex: number;
  readonly entryType: number;
  readonly cbmFileTypeByte: number;
  readonly fileType: T64CbmFileType;
  readonly filename: string;
  readonly startAddress: number;
  readonly declaredEndAddress: number;
  readonly dataOffset: number;
}

const T64_HEADER_SIZE = 64;
const T64_DIRECTORY_ENTRY_SIZE = 32;

/**
 * Read-only parser for the legacy T64 tape-container format.
 *
 * T64 is not a pulse-level tape image. It is a host-side directory plus raw
 * file payloads. The emulator therefore exposes its PRG entries through the
 * same explicit host-assisted load path used for standalone PRGs and D64 file
 * extraction, while TAP remains the cycle-timed Datasette format.
 */
export class T64Image {
  public readonly header: T64Header;
  private readonly bytes: Uint8Array;
  private readonly entries: readonly T64DirectoryEntry[];

  private constructor(bytes: Uint8Array, header: T64Header, entries: readonly T64DirectoryEntry[]) {
    this.bytes = bytes;
    this.header = header;
    this.entries = entries;
  }

  static parse(bytes: ArrayLike<number>): T64Image {
    if (bytes.length < T64_HEADER_SIZE) {
      throw new RangeError(`T64 image is truncated: expected at least ${T64_HEADER_SIZE} bytes.`);
    }

    const copy = Uint8Array.from(bytes, (value) => value & 0xff);
    const signature = decodeAscii(copy.subarray(0, 32)).replace(/\0.*$/u, '').trimEnd();
    if (!/^C64S?\s+tape\s+image\s+file/iu.test(signature)) {
      throw new Error(`Unsupported T64 signature: ${signature === '' ? '(empty)' : signature}.`);
    }

    const version = readLe16(copy, 32);
    const directoryEntries = readLe16(copy, 34);
    const usedEntries = readLe16(copy, 36);
    const directoryEnd = T64_HEADER_SIZE + directoryEntries * T64_DIRECTORY_ENTRY_SIZE;
    if (directoryEnd > copy.length) {
      throw new RangeError(
        `T64 directory is truncated: header declares ${directoryEntries} entries but the file is only ${copy.length} bytes.`
      );
    }

    const header: T64Header = {
      signature,
      version,
      directoryEntries,
      usedEntries,
      description: decodePetsciiName(copy.subarray(40, 64))
    };

    const rawEntries: RawT64Entry[] = [];
    for (let index = 0; index < directoryEntries; index += 1) {
      const offset = T64_HEADER_SIZE + index * T64_DIRECTORY_ENTRY_SIZE;
      const entryType = copy[offset]!;
      if (entryType === 0) continue;

      const cbmFileTypeByte = copy[offset + 1]!;
      rawEntries.push({
        directoryIndex: index,
        entryType,
        cbmFileTypeByte,
        fileType: decodeCbmFileType(cbmFileTypeByte),
        startAddress: readLe16(copy, offset + 2),
        declaredEndAddress: readLe16(copy, offset + 4),
        dataOffset: readLe32(copy, offset + 8),
        filename: decodePetsciiName(copy.subarray(offset + 16, offset + 32))
      });
    }

    const payloadOffsets = rawEntries
      .map((entry) => entry.dataOffset)
      .filter((offset) => offset >= directoryEnd && offset < copy.length)
      .sort((left, right) => left - right);

    const entries = rawEntries.map((entry) => materializeEntry(entry, payloadOffsets, directoryEnd, copy.length));
    return new T64Image(copy, header, entries);
  }

  listDirectory(): readonly T64DirectoryEntry[] {
    return this.entries;
  }

  readPrg(entry: T64DirectoryEntry): Uint8Array {
    if (!entry.loadable || entry.fileType !== 'PRG') {
      throw new Error(`T64 entry "${entry.filename}" is not a loadable normal PRG file.`);
    }

    const result = new Uint8Array(entry.byteLength + 2);
    result[0] = entry.startAddress & 0xff;
    result[1] = (entry.startAddress >>> 8) & 0xff;
    result.set(this.bytes.subarray(entry.dataOffset, entry.dataOffset + entry.byteLength), 2);
    return result;
  }
}

export function parseT64(bytes: ArrayLike<number>): T64Image {
  return T64Image.parse(bytes);
}

function materializeEntry(
  entry: RawT64Entry,
  payloadOffsets: readonly number[],
  directoryEnd: number,
  imageLength: number
): T64DirectoryEntry {
  if (entry.dataOffset < directoryEnd || entry.dataOffset >= imageLength) {
    return {
      ...entry,
      endAddressExclusive: entry.startAddress,
      byteLength: 0,
      loadable: false
    };
  }

  const nextOffset = payloadOffsets.find((offset) => offset > entry.dataOffset) ?? imageLength;
  const availableLength = Math.max(0, nextOffset - entry.dataOffset);
  const declaredLength = entry.declaredEndAddress > entry.startAddress
    ? entry.declaredEndAddress - entry.startAddress
    : 0;
  const maxAddressableLength = 0x10000 - entry.startAddress;

  // Old conv64-created T64s are known to contain bogus end addresses. Prefer a
  // sane declared range, but fall back to the physical payload boundary when
  // the declared end is zero, backwards, out of range, or exceeds the file.
  const byteLength = declaredLength > 0
    && declaredLength <= availableLength
    && declaredLength <= maxAddressableLength
    && entry.declaredEndAddress !== 0xc3c6
    ? declaredLength
    : Math.min(availableLength, maxAddressableLength);

  return {
    directoryIndex: entry.directoryIndex,
    entryType: entry.entryType,
    cbmFileTypeByte: entry.cbmFileTypeByte,
    fileType: entry.fileType,
    filename: entry.filename,
    startAddress: entry.startAddress,
    endAddressExclusive: entry.startAddress + byteLength,
    dataOffset: entry.dataOffset,
    byteLength,
    loadable: entry.entryType === 1 && entry.fileType === 'PRG' && byteLength > 0
  };
}

function decodeCbmFileType(value: number): T64CbmFileType {
  switch (value & 0x07) {
    case 0: return 'DEL';
    case 1: return 'SEQ';
    case 2: return 'PRG';
    case 3: return 'USR';
    case 4: return 'REL';
    default: return 'UNKNOWN';
  }
}

function readLe16(bytes: Uint8Array, offset: number): number {
  return bytes[offset]! | (bytes[offset + 1]! << 8);
}

function readLe32(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset]!
    | (bytes[offset + 1]! << 8)
    | (bytes[offset + 2]! << 16)
    | (bytes[offset + 3]! << 24)
  ) >>> 0;
}

function decodeAscii(bytes: Uint8Array): string {
  let value = '';
  for (const byte of bytes) value += String.fromCharCode(byte);
  return value;
}

function decodePetsciiName(bytes: Uint8Array): string {
  let end = bytes.length;
  while (end > 0) {
    const byte = bytes[end - 1]!;
    if (byte !== 0x00 && byte !== 0x20 && byte !== 0xa0) break;
    end -= 1;
  }

  let value = '';
  for (let index = 0; index < end; index += 1) {
    const byte = bytes[index]!;
    if (byte === 0x20 || byte === 0xa0) value += ' ';
    else if (byte >= 0x41 && byte <= 0x5a) value += String.fromCharCode(byte);
    else if (byte >= 0xc1 && byte <= 0xda) value += String.fromCharCode(0x41 + byte - 0xc1);
    else if (byte >= 0x30 && byte <= 0x39) value += String.fromCharCode(byte);
    else if (byte >= 0x21 && byte <= 0x3f) value += String.fromCharCode(byte);
    else if (byte === 0x5c) value += '£';
    else if (byte === 0x5e) value += '↑';
    else if (byte === 0x5f) value += '←';
    else value += '·';
  }
  return value;
}
