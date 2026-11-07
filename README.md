# C64 Browser Emulator

A from-scratch Commodore 64 emulator written in TypeScript for modern web browsers.

This repository is intentionally being built from hardware behavior upward rather than wrapping VICE or another existing emulator. Version 0.1 focuses on a testable NMOS 6502/6510 CPU foundation before adding C64 ROM banking, CIA, VIC-II, SID, input, or storage.

## v0.1 Status

Implemented:

- 64 KiB test/development RAM bus
- all 151 official NMOS 6502 opcode encodings
- all official addressing modes
- processor flags and register semantics
- stack operations
- RESET, IRQ, NMI, BRK, RTI
- binary ADC/SBC
- NMOS decimal-mode ADC/SBC
- indexed page-cross cycle penalties
- taken/page-cross branch cycle penalties
- original `JMP ($xxFF)` wraparound quirk
- NMOS read-modify-write dummy writes
- disassembler
- execution trace formatter
- browser development console
- Vitest test suite
- verified against the Klaus Dormann NMOS 6502 functional suite (success trap `$3469`)

Not yet implemented:

- 6510 `$0000/$0001` C64 processor-port behavior
- C64 ROM banking
- BASIC/KERNAL/character ROM loading
- CIA chips
- VIC-II video
- SID audio
- keyboard/joystick
- PRG/T64/D64
- 1541 drive
- undocumented NMOS opcodes
- individual bus-cycle/micro-operation execution

## Requirements

- Node.js version supported by Vite 8
- npm

## Run

```bash
npm install
npm run dev
```

Open the local URL printed by Vite. The page is currently a CPU development console containing Reset, Step, and Run 100 controls, register state, disassembly, and a rolling instruction trace.

## Test

```bash
npm test
```

The third-party Klaus binary is not redistributed. If `tests/assets/6502_functional_test.bin` is present, the external functional-suite test runs automatically; otherwise that one test is skipped. See `tests/assets/README.md`.

For interactive test watching:

```bash
npm run test:watch
```

## Build

```bash
npm run build
```

## Core Documentation

Every directory under `src/core/` contains its own `README.md` with an overview, architecture, and implementation discussion as a project rule. When a new core subsystem directory is added, its architecture document should be added in the same commit.

Start with:

- `src/core/README.md`
- `src/core/cpu/README.md`
- `src/core/memory/README.md`
- `src/core/debugger/README.md`

## Roadmap

### v0.2 — C64 memory and ROM boot foundation

- 6510 data-direction register and processor port
- RAM-under-ROM behavior
- BASIC/KERNAL/character ROM mapping
- I/O mapping placeholders
- ROM file loader
- reset-vector boot trace

### v0.3 — CIA and KERNAL boot support

- CIA timers and interrupt control
- keyboard matrix foundation
- enough machine initialization behavior to execute real KERNAL startup reliably

### v0.4 — VIC-II text display

- VIC bank selection
- raster timing foundation
- screen/color/character memory fetch
- border/background
- standard character mode framebuffer

Later milestones add full VIC-II graphics/sprites/timing, SID, media formats, and finally 1541 emulation.

## Design Rules

1. `src/core` never imports browser APIs.
2. CPU/device access always crosses an explicit bus/interface boundary.
3. Debug inspection must not cause emulated hardware side effects.
4. Timing shortcuts must be documented as shortcuts.
5. Unknown hardware behavior should fail visibly rather than be silently invented.
6. Optimize only after correctness tests and profiling identify a hot path.
