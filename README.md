# C64 Browser Emulator

A from-scratch Commodore 64 emulator written in TypeScript for the browser.

Version **0.5.0** adds cycle-steppable 6510 execution and the first real VIC-II/CPU bus arbitration: PAL bad-line detection, BA/RDY holds, AEC bus ownership, and 40 character/color c-accesses.

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

### C64 Memory and ROMs

- 64 KiB physical RAM
- real 6510 `$0000/$0001` processor port
- all LORAM/HIRAM/CHAREN banking combinations
- BASIC/KERNAL/character ROM mapping
- RAM underneath ROM
- independent VIC 14-bit memory view
- CIA2-selected VIC banks
- VIC character-ROM shadowing in banks 0 and 2

### MOS 6526 CIA

- port and DDR behavior
- timers A/B
- Timer-B cascading
- interrupt control/mask logic
- FLAG/CNT behavior
- TOD clock/alarm foundation
- serial input shifting
- keyboard matrix and joystick hooks
- CIA2 VIC-bank output
- CIA1 IRQ and CIA2 NMI integration

### VIC-II

- PAL MOS 6569 timing: 63 cycles/line × 312 lines/frame
- NTSC 6567R8 timing profile metadata
- raster line/cycle/frame counters
- 9-bit raster IRQ compare
- `$D019/$D01A` IRQ latch/mask behavior
- `$D018` screen/character pointers
- border/background colors
- standard 40×25 hires text framebuffer
- Canvas frontend
- bad-line condition using raster/YSCROLL/DEN
- BA low on bad-line cycles 12–54
- AEC low on cycles 15–54
- 40 character/color c-accesses per bad line
- latched video/color matrix data for timing tests

### Master Timing

`C64Machine.tickSystemCycle()` is now the actual execution boundary. Every call:

1. samples VIC BA/AEC,
2. attempts one 6510 bus cycle,
3. advances VIC and both CIAs once,
4. advances the master clock,
5. resynchronizes interrupt lines.

On a normal line, CPU cycles and master cycles advance together. During a bad line, the VIC can stun the CPU while the master clock, raster, and CIA timers continue.

A read-only instruction stream can lose 43 CPU cycles on a PAL bad line because BA drops at cycle 12; the 40 VIC c-accesses themselves occupy cycles 15–54. A CPU already executing writes may use some of the three BA-warning cycles before AEC falls.

## Still Intentionally Deferred

- sprite DMA and sprite BA/AEC steals
- exact g-access timing and row-counter/VC behavior
- line-buffer-driven pixel generation
- bitmap, multicolor, ECM, and fine scrolling
- cycle/dot-positioned border tricks
- light pen and sprite collisions
- SID synthesis/audio
- browser keyboard/joystick adapter
- IEC bus and 1541
- PRG/T64/D64 loading
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

## v0.5 Architecture

```text
Browser UI / Canvas
        |
        v
+------------------------+
|       C64Machine       |
| one system-cycle clock |
+-----------+------------+
            |
       sample BA/AEC
            |
   +--------+---------+
   |                  |
+--v---------+    +---v----+
| Cpu6510    |    | VIC-II |
| micro-ops  |<---| BA/AEC |
+--+---------+    +---+----+
   |                  |
   +------ C64Bus ----+
              |
        +-----+-----+
        |           |
      CIA1         CIA2
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

## Roadmap

### v0.6 — VIC-II fetch/render timing refinement

- row counter / VC / VCBASE state
- g-access timing
- consume bad-line-latched matrix/color data during display
- cycle-positioned border/background writes
- fine-scroll foundation

### Later

- sprite DMA and sprites
- complete VIC-II display modes
- SID/audio worklet
- input adapters
- media loading
- 1541/IEC
- cartridges
- undocumented CPU opcodes and deeper compatibility suites

## Design Rules

1. `src/core` never depends on browser APIs.
2. CPU and VIC memory views remain explicit and separate.
3. Debug inspection never causes hardware side effects.
4. Emulated time advances explicitly; wall-clock time stays outside the core.
5. Timing shortcuts are documented as shortcuts.
6. Temporary placeholders are labeled as placeholders.
7. Unknown hardware behavior fails visibly rather than being silently invented.
8. Optimize only after correctness tests and profiling identify a hot path.
