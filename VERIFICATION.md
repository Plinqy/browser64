# v0.8 Verification

Version 0.8 adds the MOS 6581/8580 SID core and the browser AudioWorklet output path while keeping Web Audio outside the deterministic emulator core.

## Research and implementation boundary

The SID implementation was cross-checked against the MOS SID register model, historic hardware measurements, modern reSID/reSIDfp behavioral documentation/source, VICE/libresidfp regression tests, die-informed DAC/filter findings, and current Web Audio/AudioWorklet documentation.

No reSID/reSIDfp source code, measured combined-waveform tables, or other GPL lookup data are copied into this project. The implementation is original. In particular:

- 6581 envelope/waveform DAC tables are generated from an independently solved R-2R ladder (`2R/R ~= 2.2`, missing LSB termination).
- 8580 DACs use the ideal terminated `2R/R ~= 2.0` model.
- combined waveforms use an original algorithmic coupling approximation rather than third-party measured tables.
- the 6581 filter uses a representative nonlinear cutoff curve and simplified state-variable analog model; it is not claimed to reproduce every physical 6581 revision.

The project documentation explicitly identifies those analog limits rather than presenting them as sample-exact behavior.

## Digital SID behavior covered

The v0.8 core implements and tests:

- three independent voices and the real 24-bit phase-accumulator frequency path
- triangle, saw, pulse, and 23-bit LFSR noise
- pulse comparator pipeline
- bit-19 noise clock pipeline
- oscillator synchronization and chained-sync exception
- triangle ring modulation
- TEST phase hold and modeled slow noise-register reset behavior
- combined waveform interaction and destructive noise write-back approximation
- cycle-clocked 15-bit ADSR rate LFSR and exponential divider
- ADSR delay behavior
- `$FF->$00` and `$00->$FF` envelope boundary behaviors
- patterned SID power-up state and reset preservation of oscillator phase/envelope counter state
- 6581 non-monotonic DAC transfer behavior
- 8580 near-ideal DAC transfer behavior
- per-source filter routing, LP/BP/HP modes, resonance, V3OFF, EXT IN, and master volume
- 8580 exponential resonance ladder law
- representative nonlinear 6581 cutoff/resonance behavior
- C64 output RC path (approximately 16 kHz LP and 1.6 Hz high-pass/DC block)
- POTX/POTY, OSC3, and ENV3 reads
- write-only-register floating bus reads with model-specific decay windows
- one-cycle 8580 write pipeline
- PAL/NTSC clock plumbing
- deterministic PCM generation independent of the browser audio clock

## Static verification

The complete source and test tree was type-checked in strict mode using the locally available TypeScript compiler plus verification-only ambient declarations for Vitest/Vite/Node packages and the Vite `?url` asset import. Those declarations are not part of the project or patch.

Result: **PASS**

The browser source is included in this type-check, including the SID model selector, AudioWorklet bridge, PCM transfer, mute/resume controls, and existing ROM/input/PRG runtime.

The AudioWorklet source was also syntax-checked independently with Node's JavaScript parser.

Result: **PASS**

## Compiled regression

All normal unit tests were compiled to a temporary CommonJS tree and executed through the verification-only Vitest-compatible assertion harness.

Result before patch packaging:

```text
147 passed
0 failed
```

The optional Klaus Dormann CPU test is intentionally excluded from this count because `tests/assets/6502_functional_test.bin` is not redistributed with the project. The v0.8 CPU implementation itself is unchanged.

SID-specific coverage includes oscillator phase, hard sync, ring modulation, LFSR timing/published selector vectors, model-specific OSC3 timing, SID reset state, ADSR timing/LFSR phase/delay/boundary behavior, DAC discontinuities, filter routing/cutoff, bus decay, model-specific write timing, readable registers, deterministic PCM output, and machine-level one-SID-clock-per-master-cycle integration.

## Performance sanity check

A standalone SID stress run with all three voices, envelopes, filter routing, and analog-output calculations completed 1,000,000 SID cycles in approximately 282 ms in this container (about 3.55 million SID cycles/second).

This is a performance sanity check, not a browser benchmark, but it provides sufficient headroom over the PAL C64 SID clock (~985 kHz) to keep the TypeScript implementation for this phase rather than prematurely moving the core to WebAssembly.

## Browser audio boundary

`Sid` remains entirely browser-independent. When audio is enabled it deterministically decimates emulated cycle-rate output into PCM. `SidAudio` transfers those samples to an `AudioWorkletProcessor`, which only acts as the browser playback sink. Web Audio does not advance or reschedule emulated SID state.

Actual browser audio device behavior cannot be exercised headlessly in this container, so the user's local browser remains the final integration check for AudioContext autoplay policy, worklet loading, real device sample rate, and audible output.

## Package-manager limitation

This execution environment does not have this project's real npm dependency tree installed and cannot reliably reach the npm registry. Therefore `npm run build` and the real Vitest executable cannot be run here.

After applying the patch locally, run:

```bash
npm run build
npm run test
```

Expected normal Vitest count without the optional Klaus binary: **147 passing, 1 skipped**.
