import { describe, expect, it } from 'vitest';
import { TAP_ZERO_GAP_CYCLES, TapImage, encodeTapPulse } from '../../src/core/tape/TapImage';

function tap(version: 0 | 1, data: readonly number[]): Uint8Array {
  const bytes = new Uint8Array(0x14 + data.length);
  for (let i = 0; i < 12; i += 1) bytes[i] = 'C64-TAPE-RAW'.charCodeAt(i);
  bytes[0x0c] = version;
  bytes[0x0d] = 0;
  bytes[0x0e] = 0;
  bytes[0x10] = data.length & 0xff;
  bytes[0x11] = (data.length >> 8) & 0xff;
  bytes[0x12] = (data.length >> 16) & 0xff;
  bytes[0x13] = (data.length >> 24) & 0xff;
  bytes.set(data, 0x14);
  return bytes;
}

describe('TapImage', () => {
  it('decodes compact v0/v1 pulse lengths in eight-cycle units', () => {
    const image = TapImage.parse(tap(0, [0x2f, 0]));
    expect(image.pulseAt(0)).toEqual({ cycles: 0x2f * 8, nextOffset: 1 });
    expect(image.pulseAt(1)).toEqual({ cycles: TAP_ZERO_GAP_CYCLES, nextOffset: 2 });
  });

  it('decodes v1 exact 24-bit pulse lengths after a zero marker', () => {
    const image = TapImage.parse(tap(1, [0, 0x34, 0x12, 0x01, 1]));
    expect(image.pulseAt(0)).toEqual({ cycles: 0x011234, nextOffset: 4 });
    expect(image.pulseAt(4)).toEqual({ cycles: 8, nextOffset: 5 });
  });

  it('uses the compatibility gap for a zero-length v1 extended pulse', () => {
    const image = TapImage.parse(tap(1, [0, 0, 0, 0]));
    expect(image.pulseAt(0)).toEqual({ cycles: TAP_ZERO_GAP_CYCLES, nextOffset: 4 });
  });

  it('serializes blank/v1 images and encodes compact or exact pulse lengths', () => {
    expect([...encodeTapPulse(16)]).toEqual([2]);
    expect([...encodeTapPulse(17)]).toEqual([0, 17, 0, 0]);

    const image = TapImage.fromPulseBytes([...encodeTapPulse(16), ...encodeTapPulse(0x1234)], 0);
    const reparsed = TapImage.parse(image.toBytes());
    expect(reparsed.version).toBe(1);
    expect(reparsed.pulseAt(0)).toEqual({ cycles: 16, nextOffset: 1 });
    expect(reparsed.pulseAt(1)).toEqual({ cycles: 0x1234, nextOffset: 5 });
    expect(TapImage.parse(TapImage.create().toBytes()).byteLength).toBe(0);
  });

  it('rejects non-C64 and unsupported half-wave TAP images', () => {
    const wrongPlatform = tap(1, [1]);
    wrongPlatform[0x0d] = 2;
    expect(() => TapImage.parse(wrongPlatform)).toThrow(/not a C64/i);

    const v2 = tap(1, [1]);
    v2[0x0c] = 2;
    expect(() => TapImage.parse(v2)).toThrow(/version 2/i);
  });
});
