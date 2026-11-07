import { describe, expect, it } from 'vitest';
import { SidFilter, cutoffForModel } from '../../src/core/sid/SidFilter';
import { PAL_SID_CLOCK_HZ } from '../../src/core/sid/SidModel';

describe('SidFilter model characteristics', () => {
  it('uses a near-linear 8580 cutoff and a discontinuous representative 6581 curve', () => {
    expect(cutoffForModel('8580', 0)).toBe(30);
    expect(cutoffForModel('8580', 0x7ff)).toBe(12_000);
    expect(cutoffForModel('6581', 0)).toBe(220);
    expect(cutoffForModel('6581', 0x7ff)).toBe(18_000);
    expect(cutoffForModel('6581', 0x400)).toBeLessThan(cutoffForModel('6581', 0x3ff));
  });

  it('honors voice-3-off only when voice 3 bypasses the filter', () => {
    const audible = new SidFilter('8580', PAL_SID_CLOCK_HZ);
    const muted = new SidFilter('8580', PAL_SID_CLOCK_HZ);
    audible.writeModeVolume(0x0f);
    muted.writeModeVolume(0x8f);

    for (let cycle = 0; cycle < 200; cycle += 1) {
      audible.clock({ voice1: 0, voice2: 0, voice3: 500_000, external: 0 });
      muted.clock({ voice1: 0, voice2: 0, voice3: 500_000, external: 0 });
    }

    expect(Math.abs(audible.output)).toBeGreaterThan(Math.abs(muted.output));

    muted.writeResonanceRouting(0x04); // route voice 3 through filter
    muted.writeModeVolume(0x9f); // V3OFF + LP + volume 15
    for (let cycle = 0; cycle < 2_000; cycle += 1) {
      muted.clock({ voice1: 0, voice2: 0, voice3: 500_000, external: 0 });
    }
    expect(Math.abs(muted.output)).toBeGreaterThan(0);
  });
});
