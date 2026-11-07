# SID Core

## Overview

`src/core/sid` implements the MOS 6581/8580 Sound Interface Device as a browser-independent, cycle-clocked C64 component. The SID advances once per C64 system cycle, exposes the real `$D400-$D41F` register semantics, mixes three independently clocked voices through the shared multimode filter, and produces deterministic normalized audio samples for a host sink.

The implementation is original. Hardware documentation, die-level findings, measurements, and other emulator behavior were used as references, but no reSID source code or GPL combined-waveform lookup tables are embedded.

## Architecture

```text
$D400-$D7FF CPU mirrors
          |
          v
        Sid
   +------+------+----------------+
   |             |                |
 voice 1       voice 2          voice 3
   |             |                |
 oscillator    oscillator       oscillator
 envelope      envelope         envelope
   +-------------+----------------+
                 |
                 v
             SidFilter
       routing / LP / BP / HP
                 |
          motherboard RC path
                 |
           deterministic PCM
```

Each voice contains a 24-bit phase accumulator, waveform generator, 23-bit noise shift register, and ADSR envelope. Voice synchronization is a ring: voice 1 is synchronized from voice 3, voice 2 from voice 1, and voice 3 from voice 2.

`Sid` owns register decoding, model-specific bus behavior, POT/OSC3/ENV3 reads, one-cycle 8580 write delay, filter/mixer integration, and PCM decimation. Browser audio is outside this directory in `src/audio`.

## Implementation Discussion

### Clocking

The SID is clocked at the C64 system frequency. For every cycle the implementation advances envelopes, advances all three phase accumulators/noise pipelines, resolves hard synchronization after all oscillators have advanced, calculates waveform outputs, clocks the filter/output network, samples PCM when required, applies the 8580 write pipeline, and ages the floating data bus.

Reset follows the digital chip behavior rather than treating SID state as a software synthesizer: frequency/control/envelope control registers reset, but the oscillator phase accumulator and envelope DAC counter are not forcibly zeroed. The deterministic power-up model begins with the observed patterned accumulator/envelope states; TEST remains the hardware mechanism for forcing oscillator phase to zero.

### Oscillators and waveforms

Each oscillator uses a 24-bit phase accumulator with the 16-bit FREQ value added once per clock. Triangle, sawtooth, pulse, and noise follow the documented digital paths. Pulse comparison is one-cycle latched. Noise uses the 23-bit XOR feedback register and a two-cycle bit-19 clock pipeline. TEST immediately holds the phase accumulator at zero and models the much slower noise-register reset behavior. The internal shift register is stored in the left-shifting bit orientation used by the original SID analyses; modern right-shifting references are bit-reversed representations of the same physical register, and translated regression vectors are tested explicitly.

Hard sync is evaluated only after all oscillators have clocked, including the chained-sync exception. Ring modulation affects the triangle path only and uses the documented `own MSB XOR NOT source MSB` substitution.

### Combined waveforms

Real combined waveforms are analog interactions between selector lines, not a simple Boolean AND. Exact output also varies by chip revision and individual silicon. To keep this project independently implemented and license-clean, v0.8 uses an algorithmic neighbor-coupling model rather than measured lookup tables. Noise combinations include destructive write-back to the LFSR selector taps so they can collapse/lock as on hardware.

This is intentionally marked as an approximation and is a future candidate for empirical validation against hardware measurements.

### DACs

6581 waveform/envelope DAC transfer tables are generated at startup by independently solving the R-2R resistor ladder with an approximately 2.2 `2R/R` ratio and the known missing LSB termination. This produces the expected non-monotonic major-carry behavior without importing another emulator's tables. The 8580's approximately 2.0 terminated ladder is treated as ideal.

### ADSR

The envelope generator uses the hardware 15-bit rate-LFSR match states and sustain levels. The rate counter is not reset by gate changes or attack/decay/release register writes, preserving the classic ADSR delay bug. Decay/release use the piecewise exponential divider thresholds at `$FF`, `$5D`, `$36`, `$1A`, `$0E`, `$06`, and `$00`.

The gate/state transition has a short cycle pipeline so ENV3 does not change as if the envelope were an instantaneous high-level synthesizer primitive.

### Filter

The shared filter retains the SID topology: per-source routing into a two-integrator state-variable filter with independently selectable low-pass, band-pass, and high-pass outputs, 16 resonance settings, voice-3-off behavior, EXT IN routing, and 4-bit master volume.

8580 cutoff is modeled as the close-to-linear 30 Hz to 12 kHz characteristic and its 16 resonance settings follow the documented exponential `1/Q = 2^((4-RES)/8)` ladder law. 6581 uses a representative nonlinear 220 Hz to 18 kHz curve with the well-known discontinuity near FC `$400`; real 6581s vary significantly, so the curve is not presented as a universal per-chip calibration. Filter coefficients are cached on register/model changes rather than recomputed at the ~1 MHz chip rate.

The output then passes through a lightweight C64 motherboard output network (approximately 16 kHz low-pass followed by a 1.6 Hz DC-blocking high-pass) before PCM sampling.

### Bus behavior and chip models

Write-only register reads return the SID data-bus latch while it remains charged. The modeled decay window is much shorter on 6581 than 8580. POTX/POTY, OSC3, and ENV3 are readable registers and refresh the bus latch. 8580 register writes are delayed by one SID cycle.

The model can be switched between `6581` and `8580` without moving browser/audio policy into the core.

### Audio sampling

The chip produces one normalized analog-output value per system cycle. `configureAudio()` enables deterministic boxcar decimation to the host sample rate. `drainAudioSamples()` hands completed samples to the browser adapter. The emulator clock remains authoritative; Web Audio never clocks the SID.

## Accuracy Boundary

v0.8 intentionally distinguishes implemented hardware behavior from remaining analog uncertainty. The following are not claimed bit-/sample-exact yet:

- measured combined-waveform tables and long-term floating-waveform bit fade,
- per-chip 6581 filter calibration and full nonlinear op-amp/VCR simulation,
- POT RC conversion timing beyond host-provided read values,
- exact analog distortion/noise floor and board-revision output networks,
- every die-level ADSR transition race,
- exhaustive VICE/reSID test-program parity.

Those limits are compatibility work, not hidden shortcuts.

## Appendix A — SID API and Reference Manual v1

Planning and table-of-contents work has begun in [`SID_API_REFERENCE_MANUAL_V1.md`](./SID_API_REFERENCE_MANUAL_V1.md). Per the v1 request, that document contains structure/planning only and deliberately does not yet attempt the full reference manual.
