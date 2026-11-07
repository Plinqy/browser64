# C64 Browser Emulator

A from-scratch Commodore 64 emulator written in TypeScript for modern web browsers.

The project is built from hardware behavior upward rather than wrapping VICE or another emulator. Version 0.3 retains the validated NMOS 6502/6510 CPU and C64 memory-banking foundation and replaces both CIA placeholders with functional MOS 6526 implementations.

## v0.3 Status

Implemented:

- all v0.1 CPU/debugger functionality
- all v0.2 C64 processor-port, ROM, RAM-under-ROM, and I/O banking functionality
- two functional MOS 6526 CIA devices
- CIA register mirroring at `$DC00-$DCFF` / `$DD00-$DDFF`
- PRA/PRB and DDRA/DDRB pin resolution
- Timer A and Timer B 16-bit latches/counters
- continuous and one-shot timer modes
- force-load control strobes
- PHI2 and CNT timer inputs
- Timer B counting Timer A underflows
- PB6/PB7 timer pulse/toggle output behavior
- ICR source latching, set/clear interrupt masks, read-to-acknowledge behavior
- side-effect-free CIA debugger `peek()`
- active-low FLAG edge interrupt
- TOD clock with 50/60 Hz divider selection
- TOD coherent read latch, stop/start write sequence, and alarm interrupt
- SDR serial-input shifting on CNT edges
- 8x8 C64 keyboard switch matrix
- CIA1 keyboard and active-low joystick pin wiring
- CIA2 PA0/PA1 inverted VIC 16 KiB bank selection
- CIA1 IRQ wired to the 6510 IRQ input
- CIA2 interrupt output converted to 6510 NMI edges
- RESTORE-key hook through CIA2 FLAG
- machine-level instruction/cycle advancement via `C64Machine.step()`
- browser console CIA/VIC-bank status display

Still intentionally deferred:

- transistor/cycle-pipeline-specific 6526 quirks and Lorenz/VICE CIA compatibility edge cases
- Timer-A-driven serial output waveform timing
- IEC serial-bus electrical/device behavior
- browser keyboard-to-matrix key mapping
- real VIC-II video/raster/bus stealing
- SID audio
- cartridge GAME/EXROM modes
- PRG/T64/D64 and 1541 drive emulation
- undocumented NMOS CPU opcodes

## Requirements

- Node.js 22.12 or newer
- npm

## Run

```bash
npm install
npm run dev
```

Open the local URL printed by Vite.

The browser page asks you to supply three unheadered ROM images from your own C64 ROM set:

- BASIC: exactly 8192 bytes
- KERNAL: exactly 8192 bytes
- character generator: exactly 4096 bytes

The project does not redistribute Commodore ROM images. Once all three files are loaded, **Power On** reads the real reset vector at `$FFFC/$FFFD` through the mapped KERNAL ROM. Step/Run now use `C64Machine.step()`, so every executed CPU instruction advances both CIA chips by its emulated PHI2 cycle count.

## Test

```bash
npm test
```

Optional watch mode:

```bash
npm run test:watch
```

The external Klaus Dormann functional test remains optional. If you possess the 64 KiB `6502_functional_test.bin`, place it at:

```text
tests/assets/6502_functional_test.bin
```

The Vitest test skips that external suite when the binary is absent.

## Core Documentation

Every directory under `src/core/` contains its own `README.md` covering **Overview**, **Architecture**, and **Implementation Discussion**.

Current core documentation:

- `src/core/README.md`
- `src/core/cpu/README.md`
- `src/core/debugger/README.md`
- `src/core/memory/README.md`
- `src/core/rom/README.md`
- `src/core/io/README.md`
- `src/core/machine/README.md`
- `src/core/cia/README.md`

When a new core subsystem directory is added, its README is part of the same change.

## CIA Architecture

```text
                   +--------------------+
                   |    C64Machine      |
                   +---------+----------+
                             |
                    instruction cycles
                             |
              +--------------+--------------+
              |                             |
         +----v-----+                  +----v-----+
         |  CIA #1  |                  |  CIA #2  |
         |  $DCxx   |                  |  $DDxx   |
         +----+-----+                  +----+-----+
              |                             |
       IRQ ---+----> 6510             NMI <-+--- IRQ assertion edge
              |                             |
     keyboard/joysticks              PA0/PA1 -> VIC bank
                                            FLAG <- RESTORE
```

The 6526 chip model itself contains no C64-specific key names or VIC knowledge. `C64Io` owns motherboard wiring; `C64Machine` owns CPU interrupt wiring and time advancement.

## Timing Model

v0.3 is a functional, deterministic CIA implementation but the emulator is still instruction-granular. `Cpu6510.step()` executes a complete instruction and returns its documented cycle count. `C64Machine.step()` then advances both CIAs by that many PHI2 cycles.

This gives correct proportional timer behavior and real CIA interrupt flow for KERNAL startup work. It does **not** yet model the precise intra-instruction bus cycle on which a CIA/VIC event occurs. The VIC-II phase will require a true master-cycle scheduler so BA/AEC bus arbitration and raster timing can occur between CPU micro-operations.

## Roadmap

### v0.4 — VIC-II text display and master timing foundation

- replace the VIC register placeholder with a real VIC-II register model
- master PHI2/VIC cycle scheduler
- raster counter and raster IRQ foundation
- CIA2-selected VIC memory banks
- VIC character-ROM visibility in banks 0 and 2
- screen RAM / character generator / color RAM fetches
- border and background colors
- standard character-mode framebuffer
- Canvas renderer

### Later

- complete VIC-II graphics modes, badlines, sprites and cycle stealing
- browser keyboard/joystick adapter
- SID/audio worklet
- PRG/T64/D64 media
- IEC bus and 1541 emulation
- cartridge/expansion support
- undocumented CPU opcodes and deep compatibility suites

## Design Rules

1. `src/core` never depends on browser APIs.
2. CPU/device access crosses explicit bus/interface boundaries.
3. Debug inspection never causes emulated hardware side effects.
4. Emulated time advances explicitly; wall-clock time stays outside the core.
5. Timing shortcuts are documented as shortcuts.
6. Temporary chip placeholders are labeled as placeholders, not fake compatibility.
7. Unknown hardware behavior fails visibly rather than being silently invented.
8. Optimize only after correctness tests and profiling identify a hot path.
