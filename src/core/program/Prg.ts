export interface ParsedPrg {
  readonly loadAddress: number;
  readonly endAddressExclusive: number;
  readonly payload: Uint8Array;
}

export interface PrgLoadResult {
  readonly loadAddress: number;
  readonly endAddressExclusive: number;
  readonly byteLength: number;
  readonly basicPointersInitialized: boolean;
}

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

function hex(value: number, width: number): string {
  return (value >>> 0).toString(16).toUpperCase().padStart(width, '0');
}
