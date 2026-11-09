import { describe, expect, it } from 'vitest';
import { D64Image } from '../../src/core/disk/D64Image';
import { G64Image } from '../../src/core/disk/G64Image';
import { DriveMechanism1541 } from '../../src/core/drive1541/DriveMechanism1541';

describe('DriveMechanism1541', () => {
  it('advances GCR bytes only with a mounted spinning disk', () => {
    const mechanism = new DriveMechanism1541();
    mechanism.mount(D64Image.parse(new Uint8Array(174_848)));

    expect(mechanism.tick().byteReady).toBe(false);
    mechanism.setMotorEnabled(true);
    expect(mechanism.tick().byteReady).toBe(true);

    mechanism.setDensitySelect(3);
    for (let i = 0; i < 25; i += 1) expect(mechanism.tick().byteReady).toBe(false);
    expect(mechanism.tick().byteReady).toBe(true);
  });

  it('moves inward and outward in half-track units using the four-phase sequence', () => {
    const mechanism = new DriveMechanism1541();
    mechanism.mount(D64Image.parse(new Uint8Array(174_848)));
    mechanism.setMotorEnabled(true);
    const start = mechanism.currentHalfTrack;

    mechanism.setStepperPhase(1);
    expect(mechanism.currentHalfTrack).toBe(start + 1);
    mechanism.setStepperPhase(2);
    expect(mechanism.currentHalfTrack).toBe(start + 2);
    mechanism.setStepperPhase(1);
    expect(mechanism.currentHalfTrack).toBe(start + 1);
  });

  it('mounts D64 media writable by default and supports the write-protect sensor', () => {
    const mechanism = new DriveMechanism1541();
    mechanism.mount(D64Image.parse(new Uint8Array(174_848)));
    expect(mechanism.writeProtected).toBe(false);
    mechanism.setWriteProtected(true);
    expect(mechanism.writeProtected).toBe(true);
  });

  it('preserves G64 half-tracks and honors their per-byte speed map', () => {
    const raw = emptyG64(35);
    const image = G64Image.parse(raw);
    image.replaceHalfTrack(35, Uint8Array.of(0x11, 0x22, 0x33, 0x44), Uint8Array.of(3, 0, 3, 0));

    const mechanism = new DriveMechanism1541();
    mechanism.mountG64(image);
    mechanism.setMotorEnabled(true);
    expect(mechanism.currentTrackPosition).toBe(18);
    expect(mechanism.tick().byteReady).toBe(true);
    for (let index = 0; index < 31; index += 1) expect(mechanism.tick().byteReady).toBe(false);
    expect(mechanism.tick().byteReady).toBe(true);
  });

  it('writes raw G64 bytes in write mode and exports the modified image', () => {
    const image = G64Image.parse(emptyG64(35));
    image.replaceHalfTrack(35, Uint8Array.of(0x11, 0x22, 0x33, 0x44), Uint8Array.of(3, 3, 3, 3));
    const mechanism = new DriveMechanism1541();
    mechanism.mountG64(image);
    mechanism.setWriteDataByte(0xa5);
    mechanism.setReadMode(false);
    mechanism.setMotorEnabled(true);
    mechanism.tick();

    expect(mechanism.dirty).toBe(true);
    const exported = mechanism.exportMountedMedia();
    expect(exported?.kind).toBe('g64');
    const reparsed = G64Image.parse(exported!.bytes);
    expect([...reparsed.readHalfTrack(35)!.bytes]).toContain(0xa5);
  });
});

function emptyG64(trackEntries: number): Uint8Array {
  const bytes = new Uint8Array(0x0c + trackEntries * 8);
  for (let index = 0; index < 8; index += 1) bytes[index] = 'GCR-1541'.charCodeAt(index);
  bytes[0x09] = trackEntries;
  bytes[0x0a] = 1;
  return bytes;
}
