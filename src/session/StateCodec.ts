import type { C64MachineState } from '../core';

const U8_MARKER = '__c64_u8__';

interface EncodedUint8Array {
  readonly [U8_MARKER]: string;
}

export function encodeMachineState(state: C64MachineState): string {
  return JSON.stringify(state, (_key, value: unknown) => {
    if (value instanceof Uint8Array) {
      return { [U8_MARKER]: bytesToBase64(value) } satisfies EncodedUint8Array;
    }
    return value;
  });
}

export function decodeMachineState(text: string): C64MachineState {
  const parsed = JSON.parse(text, (_key, value: unknown) => {
    if (isEncodedUint8Array(value)) return base64ToBytes(value[U8_MARKER]);
    return value;
  }) as unknown;

  if (!isMachineState(parsed)) throw new Error('The selected file is not a supported C64 save state.');
  return parsed;
}

function isEncodedUint8Array(value: unknown): value is EncodedUint8Array {
  return typeof value === 'object' && value !== null &&
    U8_MARKER in value && typeof (value as Record<string, unknown>)[U8_MARKER] === 'string';
}

function isMachineState(value: unknown): value is C64MachineState {
  if (typeof value !== 'object' || value === null) return false;
  const state = value as Partial<C64MachineState>;
  return state.format === 'c64-browser-emulator-state' && state.version === 1 &&
    (state.videoStandard === 'pal' || state.videoStandard === 'ntsc') &&
    typeof state.systemClockHz === 'number' && typeof state.cpu === 'object' && state.cpu !== null &&
    typeof state.bus === 'object' && state.bus !== null;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, Math.min(bytes.length, offset + chunkSize));
    for (const byte of chunk) binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i) & 0xff;
  return bytes;
}
