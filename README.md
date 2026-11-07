# C64 Browser Emulator

A from-scratch Commodore 64 emulator written in TypeScript for the browser.

Version **0.8.0** adds a cycle-clocked MOS 6581/8580 SID to the usable C64: three voices, ADSR, sync/ring/noise/pulse synthesis, model-specific DAC and bus behavior, shared multimode filtering, and browser AudioWorklet output.

## Current Capabilities

### MOS 6510 / NMOS 6502

- all 151 documented NMOS 6502 opcodes
- all documented addressing modes
- binary and NMOS decimal ADC/SBC
- stack, BRK, IRQ, NMI, RTI, JSR/RTS
- documented instruction cycle counts and page-cross penalties
- NMOS `JMP ($xxFF)` wrap behavior
- read-modify-write old-value dummy writes
- explicit read/write bus-cycle micro-operations
- RDY stalls on read cycles
- write cycles can complete while RDY is low
- AEC can disconnect the CPU from the bus
- instruction-level `step()` retained for compatibility tests
- explicit host/debugger program-counter launch API

### C64 Memory and ROMs

- 64 KiB physical RAM
- real 6510 `$0000/$0001` processor port
- all LORAM/HIRAM/CHAREN banking combinations
- BASIC/KERNAL/character ROM mapping
- RAM underneath ROM
- independent VIC 14-bit memory view
- CIA2-selected VIC banks
- VIC character-ROM shadowing in banks 0 and 2
- browser-supplied 8K BASIC, 8K KERNAL, and 4K character ROMs
- Power On begins at the real KERNAL `$FFFC/$FFFD` reset vector

### MOS 6526 CIA and Input

- port and DDR behavior
- timers A/B and Timer-B cascading
- interrupt control/mask logic
- FLAG/CNT behavior
- TOD clock/alarm foundation
- serial input shifting
- complete 8×8 C64 keyboard matrix
- browser keyboard adapter with shifted cursor/function-key behavior
- joystick ports 1 and 2 through the real active-low CIA1 pins
- selectable arrow-key/Space joystick capture
- CIA2 VIC-bank output
- CIA1 IRQ and CIA2 NMI integration
- RESTORE as a separate NMI source rather than a fake CIA FLAG input

### VIC-II

- PAL MOS 6569 timing: 63 cycles/line × 312 lines/frame
- NTSC 6567R8 timing profile metadata
- raster line/cycle/frame counters and raster IRQ
- bad-line BA/AEC arbitration
- c/g display-memory sequencer with VC/VCBASE/RC/VMLI
- standard text, multicolor text, standard bitmap, multicolor bitmap, ECM text
- deterministic illegal-mode black display
- all 8 hardware sprites
- hires/multicolor sprites and X/Y expansion
- sprite priority and collision latches/IRQs
- sprite DMA BA/AEC request windows
- live color-index framebuffer

### PRG Loading

- canonical two-byte little-endian `.PRG` load-address parsing
- physical-RAM loading including RAM beneath banked ROM
- bounds validation
- `$0801` BASIC program pointer initialization (`TXTTAB`, `VARTAB`, `ARYTAB`, `STREND`)
- explicit machine-code “load + jump to load address” action
- file picker and drag/drop browser workflow

### Browser Runtime

- continuous Run/Pause mode paced from the VIC timing profile
- Power On begins real ROM execution automatically
- canvas-scoped keyboard capture so the emulator does not globally steal browser keys
- Page Up = RESTORE
- Escape = RUN/STOP
- Alt = Commodore key
- both C64 shift keys, cursor keys, function keys, punctuation, and common printable keys
- joystick capture selector for control port 1 or 2
- debugger Step / Run 100 / Run Frame controls remain available while paused

### MOS 6581 / 8580 SID

- three cycle-clocked voices with 24-bit phase accumulators
- triangle, sawtooth, pulse, and 23-bit LFSR noise
- pulse-width comparator and TEST behavior
- hard sync ring and triangle ring modulation
- cycle-clocked ADSR with rate-counter delay behavior and exponential decay/release
- 6581 R-2R waveform/envelope DAC model with missing termination
- 8580 idealized terminated DAC model
- algorithmic combined-waveform neighbor coupling and noise write-back
- shared low-pass/band-pass/high-pass state-variable filter
- voice/EXT filter routing, resonance, voice-3-off, and master volume
- representative nonlinear 6581 cutoff curve and near-linear 8580 curve
- model-specific floating data-bus decay and one-cycle 8580 register-write pipeline
- POTX/POTY, OSC3, and ENV3 readable registers
- deterministic PCM decimation and browser AudioWorklet output
- browser-selectable 6581/8580 model and mute/resume controls

## Still Intentionally Deferred

- measured/empirically calibrated combined-waveform parity
- half-cycle-exact sprite p/s DMA fetch ordering
- exact dot-clock border transitions and border-opening tricks
- light pen
- VIC open-bus behavior
- sprite crunch and obscure expansion flip-flop tricks
- deeper NTSC VIC timing refinement
- full transistor/op-amp-level 6581 filter calibration and per-chip variation
- exact SID POT RC conversion timing and analog noise/distortion floor
- IEC bus and 1541
- T64/D64 loading
- cartridges/GAME/EXROM
- undocumented NMOS opcodes
- reset-pin micro-sequencing

## Requirements

- Node.js 22.12 or newer
- npm

## Run

```bash
npm install
npm run dev
```

Supply your own unheadered ROM images in the browser:

- BASIC: 8192 bytes
- KERNAL: 8192 bytes
- character generator: 4096 bytes

No Commodore ROM images are included in this repository.

After loading all three ROMs, click **Power On**. The machine starts at the real KERNAL reset vector and runs continuously. Click the C64 display to give it keyboard focus.

For a BASIC `.PRG`, wait until the ROM reaches `READY.`, load the file, then type `RUN`. Use **Load + Jump to Address** only for machine-code files whose entry point is intentionally the PRG load address.

## Build

```bash
npm run build
```

## Test

```bash
npm run test
```

Optional watch mode:

```bash
npm run test:watch
```

The Klaus Dormann functional test remains optional. If you possess the 64 KiB `6502_functional_test.bin`, place it at:

```text
tests/assets/6502_functional_test.bin
```

## v0.8 Architecture

```text
Browser adapters
 ROM / PRG   keyboard / joystick / RESTORE   frame pacing
     \             |                            /
      \            |                           /
       +-------------+--------------------------+
                     |
                     v
              +-------------+
              | C64Machine  |
              | master tick |
              +------+------+
                     |
        +------------+-------------+
        |            |             |
      Cpu6510      VIC-II       CIA1/CIA2
        |          BA/AEC          |
        +------------+-------------+
                     |
                   C64Bus
                     |
                SID 6581/8580
              voices + ADSR + filter
                     |
              deterministic PCM
                     |
           browser SidAudio adapter
                     |
                 AudioWorklet
```

## Documentation Rule

Every directory under `src/core/` contains its own `README.md` with:

- Overview
- Architecture
- Implementation Discussion

Current core documentation:

- `src/core/README.md`
- `src/core/cpu/README.md`
- `src/core/debugger/README.md`
- `src/core/memory/README.md`
- `src/core/rom/README.md`
- `src/core/io/README.md`
- `src/core/machine/README.md`
- `src/core/cia/README.md`
- `src/core/vic/README.md`
- `src/core/program/README.md`
- `src/core/sid/README.md`
- `src/core/sid/SID_API_REFERENCE_MANUAL_V1.md` (planning/TOC appendix)

The host-only input adapter is separately documented in `src/input/README.md`.

## Roadmap

### v0.9 — CPU/VIC/SID compatibility hardening

- external SID test-program corpus
- combined-waveform empirical refinement
- undocumented 6510 opcodes and interrupt edge cases
- deeper VIC raster/border/open-bus behavior
- SID analog/filter calibration improvements

### Later

- CPU/VIC edge-case accuracy and VICE tests
- D64 and IEC abstraction
- full 1541 emulation
- cartridges and tape
- advanced debugger tooling
- save states and compatibility/performance hardening

## Design Rules

1. `src/core` never depends on browser APIs.
2. CPU and VIC memory views remain explicit and separate.
3. Debug inspection never causes hardware side effects.
4. Emulated time advances explicitly; wall-clock time stays outside the core.
5. Timing shortcuts are documented as shortcuts.
6. Temporary placeholders are labeled as placeholders.
7. Unknown hardware behavior fails visibly rather than being silently invented.
8. File containers and CPU entry points are separate concepts.
9. Optimize only after correctness tests and profiling identify a hot path.
