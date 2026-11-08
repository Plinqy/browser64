# C64 Browser Emulator

A from-scratch Commodore 64 emulator written in TypeScript for the browser.

Version **0.10.0** adds usable D64 disk-image browsing/extraction and the physical serial IEC bus foundation needed for later true 1541 emulation, while retaining the v0.9 CPU/VIC/SID compatibility work.

## Current Capabilities

### MOS 6510 / NMOS 6502

- all 151 documented NMOS 6502 opcodes
- stable NMOS undocumented opcode families (SLO/RLA/SRE/RRA/SAX/LAX/DCP/ISC, ANC/ALR/ARR/AXS/LAS, NOP aliases, `$EB` SBC)
- JAM/KIL halt state released only by reset
- unstable magic-constant/store-high opcodes decoded but rejected rather than fabricated
- all documented addressing modes
- binary and NMOS decimal ADC/SBC
- stack, BRK, IRQ, NMI, RTI, JSR/RTS
- IRQ/NMI polling on the penultimate instruction cycle, including CLI/SEI/PLP mask latency
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
- shared data-bus latch updated by CPU and VIC memory traffic
- expansion I/O open-bus reads and color-RAM high-nibble bus behavior

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
- NTSC MOS 6567R8 timing: 65 cycles/line × 263 lines/frame
- profile-selected system/SID clock (985,248 Hz PAL; 1,022,727 Hz NTSC)
- raster line/cycle/frame counters and cycle-1 raster IRQ (cycle 2 on line 0)
- same-line raster-compare write triggering
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

### D64 Disk Images and IEC

- standard 35-track D64 images (683 sectors / 174,848 bytes)
- common 40- and 42-track D64 extensions
- optional one-byte-per-sector D64 error tables
- BAM disk name/ID/DOS metadata
- linked directory traversal beginning at 18/1
- DEL/SEQ/PRG/USR/REL type decoding and file flags
- loop- and bounds-safe linked file extraction
- PRG extraction retains the native two-byte load-address header
- browser directory browser and host-assisted PRG load/jump workflow
- open-collector serial IEC ATN/CLOCK/DATA bus abstraction
- real C64 CIA2 PA3/PA4/PA5 inverted output wiring
- real CIA2 PA6/PA7 CLOCK/DATA input feedback
- explicit separation between host-assisted D64 access and future true-drive IEC traffic

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
- half-cycle-exact shared-bus/open-bus phase ordering
- sprite crunch and obscure expansion flip-flop tricks
- older 6567R56A NTSC profile and deeper per-revision VIC timing
- full transistor/op-amp-level 6581 filter calibration and per-chip variation
- exact SID POT RC conversion timing and analog noise/distortion floor
- cycle-accurate 1541 CPU/VIA/GCR drive emulation
- KERNAL LOAD over the physical IEC handshake / fast-loader compatibility
- D64 write-back, SAVE, REL/SEQ host operations, and BAM mutation
- T64/TAP loading and datasette
- cartridges/GAME/EXROM
- chip-specific modeling for unstable XAA/LXA/AHX/TAS/SHX/SHY opcodes
- BRK/IRQ vector hijacking and the remaining interrupt race edge cases
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

A `.D64` may also be mounted in the browser. Its directory is parsed from the image and PRG files can be sent through the same loader using **Host-assisted Load**. That convenience path is deliberately labeled: it does not yet emulate the 1541 CPU or transfer bytes through IEC.

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

## v0.10 Architecture

```text
Browser adapters
 ROM / PRG / D64   keyboard / joystick / RESTORE   frame pacing
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
        |          BA/AEC          |     |
        +------------+-------------+     +--> IEC ATN/CLK/DATA
                     |
                   C64Bus
                  /      \
                RAM      SID 6581/8580
                 ^          |
                 |       voices + ADSR + filter
          host-assisted     |
          D64/PRG load   deterministic PCM
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

### v0.10 — D64 and IEC foundation

- D64 parsing and directory/file access
- explicit IEC serial-bus lines and device abstraction
- high-level accelerated LOAD path kept separate from hardware emulation
- groundwork for a later cycle-synchronized 1541 computer

### Later

- deeper CPU/VIC half-cycle edge-case accuracy and VICE tests
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
