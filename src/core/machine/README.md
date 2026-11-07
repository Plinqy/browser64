# C64 Machine Composition

## Overview

This directory is the composition root for a complete Commodore 64 instance. `C64Machine` owns the CPU, C64 bus, ROM set, I/O devices, debugger/disassembler, execution trace, and the first explicit machine timing boundary.

Version 0.3 integrates the two MOS 6526 CIA chips with CPU execution and interrupt wiring. VIC-II and SID still await their dedicated implementations.

## Architecture

```text
C64Machine
├── C64Bus
│   ├── 64 KiB physical RAM
│   ├── C64Roms
│   └── C64Io
│       ├── VIC-II placeholder
│       ├── SID placeholder
│       ├── Color RAM
│       ├── CIA1 (6526) ---> 6510 IRQ
│       └── CIA2 (6526) ---> 6510 NMI edge
├── Cpu6510
├── Disassembler
└── TraceFormatter
```

The CPU still sees only the generic `Bus` interface. Browser code constructs one `C64Machine` and should use `machine.step()` rather than calling `cpu.step()` directly so peripheral time and interrupt wiring stay synchronized.

## Implementation Discussion

`powerOn()` clears main RAM and color RAM deterministically, resets the processor port and I/O chips, then resets the CPU through the mapped KERNAL reset vector. `reset()` preserves RAM/color RAM and external keyboard/joystick state while resetting the processor and resettable chips.

### v0.3 scheduler boundary

The CPU is still instruction-granular: one `Cpu6510.step()` executes an entire instruction and returns its cycle count. `C64Machine.step()` then advances both CIA chips by exactly that many PHI2 cycles. This makes timers deterministic and correctly proportional to CPU execution without pretending the emulator already has cycle-by-cycle VIC arbitration.

CIA1's interrupt output is level-wired to the 6510 IRQ input. CIA2's interrupt output is wired to NMI; the machine tracks its previous state and only pulses the CPU when CIA2 changes from non-asserted to asserted, matching NMI edge semantics.

`setRestorePressed()` drives CIA2's active-low FLAG input, reflecting the C64 RESTORE path. `pulseTod()` supplies one external 50/60 Hz TOD input pulse to both CIAs; wall-clock scheduling of those pulses belongs to the browser/runtime layer rather than the deterministic core.

A later VIC-II phase will replace instruction-granular peripheral advancement with a true master-cycle scheduler. The public machine boundary introduced here is intended to survive that transition.
