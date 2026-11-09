# C64 Browser Emulator

A from-scratch Commodore 64 emulator written in TypeScript for the browser.

Version **1.0.1** is the first maintenance release of Browser64. It retains the v1.0 cycle-stepped 6510/CIA/VIC/SID motherboard, firmware-driven 1541/IEC disk path, writable D64/G64 media, PRG/T64 host-assisted loading, TAP playback/recording, banked cartridges, debugger/monitor, save states, persistent browser sessions, and selectable PAL/NTSC plus 6581/8580 profiles. Version 1.0.1 adds structural BASIC-bootstrap detection for PRGs that begin below `$0801`, correct host-assisted launch semantics for those loaders, the completed-frame VIC display fix, and a full operator handbook at `documents/OPERATORS_GUIDE.md`.

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
- timers A/B with old-6526 START/count/force-load pipeline timing
- Timer-B cascading and underflow/CNT gated mode
- delayed interrupt master latch and hardware IMR/ICR acknowledgement semantics
- FLAG/CNT behavior with synchronized timer CNT edges and reset-high CNT
- TOD clock/alarm foundation
- serial input shifting
- complete 8×8 C64 keyboard matrix
- browser keyboard adapter with shifted cursor/function-key behavior
- joystick ports 1 and 2 through the real active-low CIA1 pins
- explicit C64-keyboard/joystick input mode with selectable control port; Arrow keys drive directions and Space drives Fire
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
- VIC register electrical readback masks and read-only light-pen latches
- measured 38-column window geometry (7-pixel left / 9-pixel right border expansion)

### PRG Loading

- canonical two-byte little-endian `.PRG` load-address parsing
- physical-RAM loading including RAM beneath banked ROM
- bounds validation
- structural detection of a tokenized BASIC bootstrap at `$0801`, including PRGs whose load address is below BASIC
- BASIC pointer initialization (`TXTTAB`, `VARTAB`, `ARYTAB`, `STREND`) for detected bootstraps
- host-assisted Load + Run/Start queues BASIC `RUN` when a bootstrap is detected and otherwise starts at the PRG load address
- file picker and drag/drop browser workflow

### D64 Disk Images and IEC

- mutable standard 35-track D64 images (683 sectors / 174,848 bytes)
- common 40- and 42-track D64 extensions
- optional one-byte-per-sector D64 error tables with writable error codes
- BAM disk name/ID/DOS metadata
- linked directory traversal beginning at 18/1
- DEL/SEQ/PRG/USR/REL type decoding and file flags
- loop- and bounds-safe linked file extraction
- PRG extraction retains the native two-byte load-address header
- browser directory browser and host-assisted PRG Load Only / Load + Run/Start workflow
- nonstandard/unreadable directory chains no longer prevent the same D64 from remaining available to the 1541 true-drive path
- open-collector serial IEC ATN/CLOCK/DATA/RESET bus abstraction
- real C64 CIA2 PA3/PA4/PA5 inverted output wiring
- real CIA2 PA6/PA7 CLOCK/DATA input feedback
- G64 v0 raw-GCR full/half-track images with constant or per-byte speed zones
- explicit separation between host-assisted D64 access and firmware-driven IEC traffic


### T64 Tape Containers

- legacy C64S/VICE `.T64` header and directory parsing, including older `C64S tape file` signatures
- normal tape-file (`entry type 1`) PRG extraction
- multi-entry browser selection
- host-assisted Load Only / Load + Run/Start with the same BASIC-bootstrap detector used by PRG/D64 loading
- compatibility fallback for the historical conv64 bogus `$C3C6` end-address pattern
- session persistence and automatic T64 restoration
- intentionally separate from TAP: T64 is a host-side file container, while TAP drives the cycle-timed Datasette signal path

### Commodore 1541 True Drive

- independent 1 MHz NMOS 6502 drive computer
- 2 KiB drive RAM and two MOS 6522 VIA devices
- user-supplied 16 KiB 1541 DOS ROM
- shared open-collector IEC ATN/CLOCK/DATA/RESET wiring
- writable D64-to-GCR mechanism with sector write-back, density zones, and half-track stepping
- raw G64 media preserving non-standard GCR data, half-tracks, and per-byte speed zones
- VIA1 PA write-data path plus BYTE READY/SOE read/write timing
- browser write-protect control and modified-media export
- firmware-driven serial traffic rather than KERNAL LOAD traps

### Cartridges, Expansion Port, and Datasette

- expansion-port device abstraction with GAME/EXROM PLA participation
- raw 8 KiB, 16 KiB, and Ultimax cartridge images
- VICE CRT parsing for generic hardware type 0 plus Ocean type 1, C64GS/System 3, Dinamic, and Magic Desk banked cartridges
- ROML/ROMH mapping, RAM-under-ROM writes, Ultimax open regions, and VIC ROMH visibility
- IO1/IO2 banking plus expansion IRQ/NMI/DMA and FREEZE hooks
- Commodore 1530/C2N MOTOR/SENSE/WRITE wiring
- TAP v0/v1 parsing and cycle-timed CIA1 FLAG playback
- cycle-timed C64 TAP v1 recording, blank tape creation, write protection, and export
- PAL/NTSC/old-NTSC/PAL-N source-clock conversion into the active machine clock

### Machine Monitor

- PC address breakpoints without patching guest memory
- CPU read/write/read-write watchpoints
- VIC raster line and exact line/cycle stops
- side-effect-free mapped-memory inspection and physical-RAM inspection/editing
- editable 6510 registers at instruction boundaries
- bounded instruction, CPU/VIC bus, and IRQ/NMI histories
- VIC/CIA/SID/processor-port hardware snapshots
- screen-matrix/color-RAM inspection and raster/cycle bus-activity visualization

### Browser Runtime

- continuous Run/Pause mode paced from the VIC timing profile
- Power On begins real ROM execution automatically
- canvas-scoped keyboard capture so the emulator does not globally steal browser keys
- Page Up = RESTORE
- Escape = RUN/STOP
- Alt = Commodore key
- both C64 shift keys, cursor keys, function keys, punctuation, and common printable keys
- explicit Input mode selector plus Joystick port 1/2 selector (Port 2 preselected for game use)
- debugger Step / Run 100 / Run Frame controls remain available while paused
- quick save/load plus portable `.c64state` import/export
- IndexedDB persistence for ROMs, mounted media, preferences, and quick state
- PAL/NTSC and 6581/8580 selection persisted across browser sessions

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

### Enter BASIC programs

Wait for the normal Commodore BASIC `READY.` prompt, click the display, and type program lines exactly as on a C64. The browser input adapter drives the physical CIA1 keyboard matrix rather than injecting text. `RUN`, `LIST`, editing keys, quotes, colon, cursor keys, function keys, RUN/STOP, Commodore, and both shift-key paths are represented.

For host-assisted loading, **Load Only** copies the PRG without launching it. **Load + Run/Start** examines the loaded bytes for a structurally valid tokenized BASIC bootstrap at `$0801`, including PRGs that begin below `$0801`. A detected bootstrap queues `RUN` through the KERNAL keyboard buffer; otherwise the action starts execution at the PRG load address. Custom loaders with a different entry point should be started according to their original instructions or through the true-drive path.

### D64 / G64 disk games

A `.D64` can be mounted and browsed immediately; a PRG entry can be sent through **Host-assisted Load Only** for convenience. **Host-assisted Load + Run/Start** uses the structural BASIC-bootstrap detector rather than assuming that a PRG load address is its entry point; loaders that begin below `$0801` but contain a BASIC launcher at `$0801` therefore follow the BASIC `RUN` path. For normal multi-file games and software that talks to the drive, supply a 16 KiB 1541 DOS ROM and use the firmware-driven 1541/IEC path from BASIC/KERNAL (`LOAD`, directory commands, and software loaders). Writable D64 media is committed back to sectors and can be exported. G64 is the raw-GCR path for full/half tracks and variable speed zones.

The true-drive path is intentionally preferred for software that depends on 1541 behavior. Very aggressive copy protection can still depend on analog PLL/weak-bit behavior beyond the v1.0 accuracy boundary.

### T64

Open a `.T64` in the T64 panel, select a normal PRG entry, and use **Host-assisted Load Only** when you only want the bytes placed in RAM. **Load + Run/Start** applies the same BASIC-bootstrap detector used for standalone PRG and D64 loading, then either queues `RUN` or falls back to the PRG load address. T64 is a file container rather than pulse timing, so `.TAP` remains the physical Datasette path.

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

## v1.0.1 Architecture

```text
Browser adapters + persistent session
 ROM / PRG / T64 / media   keyboard / joystick / RESTORE   state / frame pacing
          \                         |                         /
           +-------------------------+------------------------+
                                     |
                                     v
                              +-------------+
                              | C64Machine  |
                              | master tick |
                              +------+------+
                                     |
               +---------------------+----------------------+
               |                     |                      |
            Cpu6510                VIC-II               CIA1/CIA2
               |                   BA/AEC                   |
               +---------------------+----------------------+
                                     |                      \n                                   C64Bus                    +--> IEC bus <--> 1541 CPU/VIAs <--> D64/G64
                              /       |       \n                            RAM      SID      expansion/cartridge
                                     |
                              deterministic PCM
                                     |
                              SidAudio / AudioWorklet

Datasette TAP playback/recording and host-assisted PRG/T64/D64 loading remain
separate paths around the same deterministic motherboard core.
```

## Documentation Rule

Every browser-independent hardware directory under `src/core/` is documented with current architecture and accuracy boundaries. Release documentation is intentionally written as current-state documentation rather than a history of old milestones.

Current documentation includes:

- `README.md` — release capabilities, usage, and accuracy boundaries
- `VERIFICATION.md` — v1.0.1 verification and release gates
- `src/core/README.md` — core architecture
- `src/core/cpu/README.md`
- `src/core/memory/README.md`
- `src/core/rom/README.md`
- `src/core/io/README.md`
- `src/core/machine/README.md`
- `src/core/cia/README.md`
- `src/core/via/README.md`
- `src/core/vic/README.md`
- `src/core/sid/README.md`
- `src/core/cartridge/README.md`
- `src/core/disk/README.md`
- `src/core/drive1541/README.md`
- `src/core/iec/README.md`
- `src/core/program/README.md`
- `src/core/tape/README.md`
- `src/core/debugger/README.md`
- `src/audio/README.md` — browser SID output bridge
- `src/input/README.md` — browser input adapter
- `src/session/README.md` — browser persistence/save-state boundary
- `tests/assets/README.md` — optional external regression assets
- `src/core/sid/SID_API_REFERENCE_MANUAL_V1.md` — SID reference-manual plan aligned to the v1.x implementation
- `documents/OPERATORS_GUIDE.md` — complete Browser64 operating handbook, including BASIC, media workflows, and 1541 true-drive operation

## v1.0.1 Release Scope

The v1.0.1 support target is a usable browser C64 for ordinary BASIC development and a broad class of real software: keyboard/joystick input, ROM boot, PRG/T64 host loading, D64/G64 through the 1541 path, TAP playback/recording, supported cartridges, SID audio, debugging, and persistent sessions/save states. Unknown or unimplemented hardware behavior is not silently fabricated.

The release gate is:

```bash
npm run release:check
```

That command performs the TypeScript/Vite build, the complete Vitest regression suite, and a documentation/version audit.

## Known accuracy boundaries

The following remain intentionally outside the v1.0 compatibility claim and are candidates for post-1.0 work:

- measured/empirically calibrated SID combined-waveform parity
- half-cycle-exact sprite p/s DMA fetch ordering
- exact dot-clock border transitions and border-opening tricks
- light-pen pin capture and once-per-frame latch timing
- half-cycle-exact shared-bus/open-bus phase ordering
- sprite crunch and obscure expansion flip-flop tricks
- older 6567R56A NTSC profile and deeper per-revision VIC timing
- transistor/op-amp-level 6581 filter calibration and per-chip variation
- exact SID POT RC conversion timing and analog noise/distortion floor
- host-assisted SAVE/REL/SEQ creation and DOS-level BAM allocation helpers
- chip-specific unstable XAA/AHX/TAS/SHX/SHY behavior beyond the C64-profiled LXA `$AB` compatibility model
- BRK/IRQ vector hijacking and remaining interrupt race edge cases
- reset-pin micro-sequencing
- exact analog 1541 PLL/weak-bit/magnetic-transition behavior and every copy-protection scheme
- active expansion-port DMA bus stealing and chip-specific freezer cartridges beyond the existing electrical hooks

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
