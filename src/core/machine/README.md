# C64 Machine Composition

## Overview

This directory is the composition root for a complete Commodore 64 instance. `C64Machine` owns the CPU, C64 bus, I/O chips, debugger/disassembler, execution trace, interrupt wiring, and the master system-cycle boundary.

Version 0.4 promotes timing from instruction-proportional CIA advancement to a shared one-cycle scheduler for VIC-II and both CIA chips.

## Architecture

```text
C64Machine
├── C64Bus
│   ├── 64 KiB physical RAM
│   ├── C64Roms
│   └── C64Io
│       ├── VIC-II ---------> 6510 IRQ
│       ├── SID placeholder
│       ├── Color RAM
│       ├── CIA1 -----------> 6510 IRQ
│       └── CIA2 -----------> 6510 NMI edge
├── Cpu6510
├── Disassembler
└── TraceFormatter
```

Browser code should execute through `C64Machine`, not call `cpu.step()` directly, so clocks and interrupt wiring stay synchronized.

## Implementation Discussion

`powerOn()` clears main RAM/color RAM deterministically, resets the processor port and I/O chips, resets the CPU through the KERNAL vector, and advances the returned reset cycles through the master clock. `reset()` preserves RAM/color RAM and external keyboard/joystick state while resetting the processor and resettable chips.

### Master cycle

`tickSystemCycle()` advances VIC-II and both CIA chips by one system cycle, increments the machine master-cycle counter, and synchronizes CPU interrupt inputs.

CIA1 and VIC-II are ORed onto the 6510's level-sensitive IRQ input. CIA2 drives NMI; the machine detects a CIA2 interrupt-output rising assertion and converts it into one CPU NMI edge.

### Remaining CPU timing limitation

`Cpu6510.step()` still executes a complete instruction before the returned cycles are replayed. Therefore a CPU write to a VIC/CIA register occurs before the individual cycles of that instruction are advanced. This is not yet sufficient for bad lines, stable-raster code, or exact BA/AEC behavior.

The machine API is intentionally ready for the CPU to become resumable at one bus cycle/micro-operation at a time. When that happens, `tickSystemCycle()` remains the clock boundary and VIC/CIAS do not need to be redesigned.

`runFrame()` is a convenience loop for development: it executes whole instructions until the VIC frame counter advances.
