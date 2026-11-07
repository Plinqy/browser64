export type SidChipModel = '6581' | '8580';

/** PAL-B C64 master/SID clock used by the current VIC profile. */
export const PAL_SID_CLOCK_HZ = 985_248;

/** NTSC-M clock for future machine-profile wiring. */
export const NTSC_SID_CLOCK_HZ = 1_022_727;

export interface SidModelCharacteristics {
  readonly databusTtlCycles: number;
  readonly waveZero: number;
  readonly voiceDc: number;
  readonly mixerDc: number;
}

export const SID_MODEL_CHARACTERISTICS: Readonly<Record<SidChipModel, SidModelCharacteristics>> = Object.freeze({
  '6581': Object.freeze({
    databusTtlCycles: 0x1d00,
    waveZero: 0x380,
    voiceDc: 0x800 * 0xff,
    mixerDc: -((0xfff * 0xff) / 18) / 128
  }),
  '8580': Object.freeze({
    databusTtlCycles: 0x0a2000,
    waveZero: 0x800,
    voiceDc: 0,
    mixerDc: 0
  })
});
