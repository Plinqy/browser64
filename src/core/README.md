# Core Emulator Architecture

## Overview

`src/core` contains the platform-independent emulator implementation. Code in this tree must not depend on browser APIs, DOM objects, Canvas, Web Audio, timers, or UI state. The goal is a deterministic machine core that can run under a browser frontend, Node test harness, command-line debugger, or future host without changing emulated behavior.

Version 0.3 contains:

- `cpu/` — validated NMOS 6502 instruction engine forming the computational core of the MOS 6510.
- `memory/` — generic bus contracts plus stock C64 RAM/ROM/processor-port banking.
- `rom/` — motherboard BASIC/KERNAL/character ROM ownership and validation.
- `io/` — C64 `$D000-$DFFF` device routing, color RAM, and current chip composition.
- `cia/` — functional MOS 6526 CIA chips and C64 keyboard switch matrix.
- `machine/` — complete machine composition, peripheral advancement, IRQ/NMI wiring.
- `debugger/` — side-effect-free disassembly and execution trace formatting.

Every directory under `src/core` must contain a `README.md` describing its overview, architecture, and implementation decisions.

## Architecture

```text
Browser/UI
    |
    v
C64Machine
    |
    +------ Cpu6510 ------------------+
    |                                  |
    +------ C64Bus <-------------------+
    |         |
    |         +-- RAM / ROM / 6510 port
    |         +-- C64Io
    |              +-- CIA1 --> IRQ
    |              +-- CIA2 --> NMI / VIC bank
    |              +-- VIC placeholder
    |              +-- SID placeholder
    |              +-- Color RAM
    |
    +------ Debugger / trace
```

The CPU knows only about `Bus`. Device decoding and banking are outside the instruction engine. Hardware register reads may have side effects; debugger inspection uses `peek()` and must not acknowledge interrupts or alter latches.

## Implementation Discussion

### Timing model

The CPU still executes one complete instruction per `Cpu6510.step()`. Correct documented instruction cycle totals are returned. Starting in v0.3, `C64Machine.step()` uses those totals to advance CIA timers and then synchronizes interrupt lines.

This is an intentional intermediate architecture. It is accurate enough for instruction-proportional CIA timing and KERNAL startup work, but it cannot yet model a VIC-II stealing a particular bus cycle in the middle of an instruction. The upcoming VIC phase will introduce per-cycle arbitration behind the machine-level API rather than putting timing logic in the browser.

### Determinism

Core code does not call wall-clock or random APIs. TOD input is supplied explicitly, CPU/peripheral time advances explicitly, and browser scheduling remains outside `core/`.

### Testing philosophy

Correctness is validated bottom-up: CPU/bus primitives, C64 banking, chip-local behavior, address decode, and finally machine-level integration. External compatibility suites are additive; they do not replace focused tests that identify exactly which contract failed.
