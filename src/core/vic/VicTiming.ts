export type VicVideoStandard = 'pal' | 'ntsc';

export interface VicTimingProfile {
  readonly standard: VicVideoStandard;
  readonly chip: string;
  readonly cyclesPerLine: number;
  readonly linesPerFrame: number;
  readonly systemClockHz: number;
}

/** MOS 6569 / PAL-B timing used by the default C64Machine configuration. */
export const PAL_6569_TIMING: VicTimingProfile = Object.freeze({
  standard: 'pal',
  chip: 'MOS 6569',
  cyclesPerLine: 63,
  linesPerFrame: 312,
  systemClockHz: 985_248
});

/** Later MOS 6567 NTSC timing, exposed now so the scheduler is not PAL-hardcoded. */
export const NTSC_6567R8_TIMING: VicTimingProfile = Object.freeze({
  standard: 'ntsc',
  chip: 'MOS 6567R8',
  cyclesPerLine: 65,
  linesPerFrame: 263,
  systemClockHz: 1_022_727
});
