import { describe, expect, it } from 'vitest';
import { D64Image } from '../../src/core/disk/D64Image';
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

  it('keeps D64 media read-only in the v0.11 mechanism', () => {
    const mechanism = new DriveMechanism1541();
    mechanism.mount(D64Image.parse(new Uint8Array(174_848)));
    expect(mechanism.writeProtected).toBe(true);
  });
});
