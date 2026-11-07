# Core Emulator Architecture

## Overview

`src/core` contains the platform-independent emulator implementation. Code in this tree must not depend on browser APIs, DOM objects, Canvas, Web Audio, timers, or UI state. The core is deterministic and can run under a browser frontend, Node test harness, command-line debugger, or future host.

Version 0.4 contains:

- `cpu/` — validated NMOS 6502 instruction engine forming the computational core of the MOS 6510.
- `memory/` — generic bus contracts plus stock C64 CPU banking and the independent VIC memory view.
- `rom/` — motherboard BASIC/KERNAL/character ROM ownership and validation.
- `io/` — C64 `$D000-$DFFF` device routing, color RAM, SID placeholder, VIC and CIA composition.
- `cia/` — functional MOS 6526 CIA chips and C64 keyboard switch matrix.
- `vic/` — timed VIC-II register/raster/text-rendering foundation.
- `machine/` — complete machine composition, one-cycle master clock, IRQ/NMI wiring.
- `debugger/` — side-effect-free disassembly and execution trace formatting.

Every directory under `src/core` must contain a `README.md` describing its overview, architecture, and implementation decisions.

## Architecture

```text
Host / browser
     |
     v
 C64Machine
     |
     +-- Cpu6510 ----> C64Bus CPU view
     |
     +-- master-cycle scheduler
     |       +-- VIC-II ----> C64Bus VIC view
     |       +-- CIA1
     |       +-- CIA2
     |
     +-- Debugger / trace
```

The CPU knows only about `Bus`. The VIC has a separate 14-bit memory interface because its hardware view differs from the 6510's PLA-banked view. Hardware register reads may have side effects; debugger inspection uses `peek()` and must not acknowledge interrupts or alter latches.

## Implementation Discussion

### Timing model

The machine now has a true one-system-cycle peripheral boundary: `C64Machine.tickSystemCycle()` advances VIC and CIA state one cycle at a time.

The 6510 itself remains instruction-granular. `Cpu6510.step()` performs its bus accesses atomically and returns a cycle total, after which `C64Machine.step()` advances the rest of the machine by that number of cycles. This means raster counters and timer totals are correct at the cycle-count level, while intra-instruction memory-access placement and VIC CPU stalls are not yet modeled.

That limitation is deliberately isolated to the CPU execution boundary so the next phase can add resumable bus-cycle micro-operations without rewriting the VIC, CIA, bus, debugger, or browser frontend contracts.

### Determinism

Core code does not call wall-clock or random APIs. TOD input is supplied explicitly, CPU/peripheral time advances explicitly, and browser scheduling remains outside `core/`.

### Testing philosophy

Correctness is validated bottom-up: CPU/bus primitives, C64 banking, chip-local behavior, address decode, VIC memory visibility/rendering, and finally machine-level interrupt/timing integration. External compatibility suites are additive; they do not replace focused tests that identify exactly which contract failed.
