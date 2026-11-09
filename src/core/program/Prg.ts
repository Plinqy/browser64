export interface ParsedPrg {
  readonly loadAddress: number;
  readonly endAddressExclusive: number;
  readonly payload: Uint8Array;
}

export interface BasicBootstrap {
  readonly startAddress: number;
  readonly firstLineNumber: number;
  readonly nextLineAddress: number;
}

export interface PrgLoadResult {
  readonly loadAddress: number;
  readonly endAddressExclusive: number;
  readonly byteLength: number;
  readonly basicBootstrapDetected: boolean;
  readonly basicBootstrapAddress: number | null;
  readonly basicPointersInitialized: boolean;
}

const BASIC_START_ADDRESS = 0x0801;
const BASIC_TOKEN_MIN = 0x80;
const BASIC_TOKEN_MAX = 0xcb;
const BASIC_MAX_LINE_NUMBER = 63999;
const BASIC_MAX_PROGRAM_ADDRESS = 0xa000;

/**
 * Parse the canonical C64 PRG container: a two-byte little-endian load address
 * followed by the bytes that are copied into C64 RAM.
 */
export function parsePrg(bytes: ArrayLike<number>): ParsedPrg {
  if (bytes.length < 3) {
    throw new RangeError('PRG must contain a two-byte load address and at least one payload byte.');
  }

  const loadAddress = ((bytes[0]! & 0xff) | ((bytes[1]! & 0xff) << 8)) & 0xffff;
  const payloadLength = bytes.length - 2;
  const endAddressExclusive = loadAddress + payloadLength;

  if (endAddressExclusive > 0x10000) {
    throw new RangeError(
      `PRG payload at $${hex(loadAddress, 4)} does not fit in the 64 KiB C64 address space.`
    );
  }

  const payload = new Uint8Array(payloadLength);
  for (let i = 0; i < payloadLength; i += 1) {
    payload[i] = bytes[i + 2]! & 0xff;
  }

  return { loadAddress, endAddressExclusive, payload };
}

/**
 * Detect the conventional tokenized BASIC bootstrap at $0801, even when a PRG
 * begins below BASIC and carries machine code/data before or after the stub.
 * Only the first BASIC line is required because many game loaders intentionally
 * jump into machine code before BASIC would ever traverse later bytes.
 */
export function detectBasicBootstrap(parsed: ParsedPrg): BasicBootstrap | null {
  if (parsed.loadAddress > BASIC_START_ADDRESS || parsed.endAddressExclusive <= BASIC_START_ADDRESS + 4) {
    return null;
  }

  const offset = BASIC_START_ADDRESS - parsed.loadAddress;
  const nextLineAddress = wordAt(parsed.payload, offset);
  const firstLineNumber = wordAt(parsed.payload, offset + 2);

  if (firstLineNumber > BASIC_MAX_LINE_NUMBER ||
      nextLineAddress <= BASIC_START_ADDRESS + 4 ||
      nextLineAddress > parsed.endAddressExclusive ||
      nextLineAddress > BASIC_MAX_PROGRAM_ADDRESS) {
    return null;
  }

  const linkedOffset = nextLineAddress - parsed.loadAddress;
  const standardTerminatorOffset = linkedOffset - 1;
  const compatibleTerminatorOffset = linkedOffset;
  const lineEndOffset = parsed.payload[standardTerminatorOffset] === 0
    ? standardTerminatorOffset
    : parsed.payload[compatibleTerminatorOffset] === 0
      ? compatibleTerminatorOffset
      : -1;
  if (lineEndOffset <= offset + 4 || lineEndOffset >= parsed.payload.length) return null;

  let hasBasicToken = false;
  for (let index = offset + 4; index < lineEndOffset; index += 1) {
    const value = parsed.payload[index]!;
    if (value === 0) return null;
    if (value >= BASIC_TOKEN_MIN && value <= BASIC_TOKEN_MAX) hasBasicToken = true;
  }

  if (!hasBasicToken) return null;
  return { startAddress: BASIC_START_ADDRESS, firstLineNumber, nextLineAddress };
}

function wordAt(bytes: Uint8Array, offset: number): number {
  if (offset < 0 || offset + 1 >= bytes.length) return 0;
  return (bytes[offset]! | (bytes[offset + 1]! << 8)) & 0xffff;
}

function hex(value: number, width: number): string {
  return (value >>> 0).toString(16).toUpperCase().padStart(width, '0');
}
