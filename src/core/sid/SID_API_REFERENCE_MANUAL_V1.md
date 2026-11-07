# Appendix A — SID API and Reference Manual v1

**Status:** Planning / table of contents only
**Manual version:** v1 planning draft
**Implementation baseline:** emulator v0.8

## Purpose of v1

The completed manual will serve two audiences: emulator contributors who need the TypeScript API/architecture contract, and C64/SID programmers who need a precise hardware/register reference tied to this implementation. It will clearly separate hardware facts, implementation APIs, model approximations, and browser-audio concerns.

No normative reference prose is being written in this planning pass. Section numbering below is reserved so later revisions can grow without destabilizing links.

## Planned Table of Contents

1. **About This Manual**
   1. Scope and audience
   2. Versioning and compatibility policy
   3. Terminology and numeric conventions
   4. Hardware fact vs implementation behavior vs approximation

2. **SID in the Commodore 64**
   1. 6581 and 8580 overview
   2. C64 clock relationship
   3. CPU address window and register mirroring
   4. EXT IN, POT inputs, and AUDIO OUT

3. **Implementation Architecture**
   1. `Sid`
   2. `SidVoice`
   3. `SidOscillator`
   4. `SidEnvelope`
   5. `SidFilter`
   6. `SidModel` and model characteristics
   7. Core/host audio boundary
   8. Per-cycle execution order

4. **Public TypeScript API Reference**
   1. Construction and chip-model selection
   2. `read`, `peek`, and `write`
   3. `tick`
   4. Reset behavior
   5. POT and EXT IN inputs
   6. Audio configuration and PCM draining
   7. Snapshots and inspection
   8. Voice/oscillator/envelope/filter inspection APIs

5. **SID Register Reference — `$D400-$D41C`**
   1. Voice 1 registers `$D400-$D406`
   2. Voice 2 registers `$D407-$D40D`
   3. Voice 3 registers `$D40E-$D414`
   4. Filter cutoff `$D415-$D416`
   5. Resonance/routing `$D417`
   6. Mode/volume `$D418`
   7. POTX/POTY `$D419-$D41A`
   8. OSC3/ENV3 `$D41B-$D41C`
   9. Mirrors and write-only read behavior

6. **Oscillator and Frequency Generator**
   1. 24-bit phase accumulator
   2. Frequency-register formula
   3. Phase wrap and timing
   4. TEST behavior
   5. Pulse-width comparator

7. **Waveform Generator**
   1. Triangle
   2. Sawtooth
   3. Pulse
   4. Noise/LFSR
   5. No-waveform floating DAC state
   6. Combined waveforms
   7. 6581/8580 waveform differences

8. **Oscillator Interaction**
   1. Hard synchronization ring
   2. Chained-sync exception
   3. Ring modulation
   4. Timing examples

9. **Envelope Generator (ADSR)**
   1. Gate/state machine
   2. 15-bit rate LFSR / prescaler
   3. Attack
   4. Decay and sustain
   5. Release
   6. Exponential divider
   7. ADSR delay bug
   8. ENV3 semantics
   9. 6581/8580 envelope DACs

10. **Mixer and Filter**
    1. Voice/EXT routing
    2. Cutoff register
    3. Resonance
    4. Low-pass, band-pass, and high-pass
    5. Combined filter modes
    6. Voice 3 OFF
    7. Master volume
    8. 6581 cutoff variability
    9. 8580 cutoff behavior
    10. Motherboard output network

11. **6581 vs 8580 Model Reference**
    1. DAC termination/linearity
    2. Filter characteristics
    3. Bus-latch decay
    4. Write timing
    5. Floating waveform behavior
    6. Compatibility expectations

12. **Data Bus and Readback Semantics**
    1. Write-only registers
    2. Bus-value refresh
    3. Bus decay
    4. POT reads
    5. OSC3 reads
    6. ENV3 reads
    7. Side-effect-free `peek`

13. **Timing and C64 Integration**
    1. PAL and NTSC clocks
    2. `C64Io` mapping
    3. Master scheduler relationship
    4. Reset sequencing
    5. Determinism contract

14. **PCM and Browser Audio API**
    1. Cycle-rate analog output
    2. Core decimation
    3. `SidAudio`
    4. AudioWorklet message flow
    5. Buffering and underruns
    6. Browser autoplay policy
    7. Mute/resume behavior

15. **Testing and Verification**
    1. Register/mirror tests
    2. Oscillator tests
    3. LFSR tests
    4. ADSR timing tests
    5. Filter/routing tests
    6. Bus-decay tests
    7. 6581/8580 differential tests
    8. External test-program strategy
    9. Audio regression strategy

16. **Known Accuracy Boundaries and Future Work**
    1. Combined-waveform measurement parity
    2. Full analog 6581 filter model
    3. Per-chip calibration
    4. POT conversion timing
    5. Digi/volume-DAC refinements
    6. VICE/reSID compatibility corpus

17. **Programming Examples — Reserved for v1 Content Pass**
    1. Single-voice tone
    2. ADSR note
    3. Pulse-width modulation
    4. Ring modulation
    5. Hard sync
    6. Filter sweep
    7. Noise percussion
    8. Direct register inspection from tests

### Reference Tables — Planned

A. Complete SID register map
B. ADSR rate-LFSR match-state table
C. Sustain-level table
D. Exponential-divider thresholds
E. Frequency-register conversion formulas
F. Pulse-width formulas
G. Noise-register tap map
H. Control-register bit definitions
I. Filter-routing/mode bit definitions
J. PAL/NTSC clock constants
K. 6581/8580 behavior comparison matrix

### Provenance / Research Appendix — Planned

A future content pass will list primary datasheets, reverse-engineered schematics, measurement literature, hardware test programs, and external emulator sources used only as behavioral cross-checks. It will also document which artifacts are intentionally **not** redistributed (for example, proprietary ROMs and third-party measured waveform tables).
