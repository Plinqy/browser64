# Core Emulator Architecture

## Overview

`src/core` contains the platform-independent emulator implementation. Code in this tree must not depend on browser APIs, DOM objects, Canvas, Web Audio, timers, or UI state. The goal is to keep the machine deterministic and testable so the same core can eventually run in a browser, Node.js test process, command-line debugger, or a future WebAssembly host without changing machine behavior.

Version 0.1 contains three working subsystems:

- `cpu/` — the NMOS 6502 instruction engine that forms the computational core of the MOS 6510.
- `memory/` — the bus contract and a flat 64 KiB RAM implementation used for CPU validation.
- `debugger/` — side-effect-free disassembly and execution trace formatting.

Future C64-specific components such as VIC-II, SID, CIA, C64 memory banking, cartridge lines, and the machine scheduler will be added under `core/` and will follow the same separation rule.

## Architecture

The dependency direction is intentionally one-way:

```text
Browser/UI
    |
    v
Core debugger ------+
    |                |
    v                v
Cpu6510 ----------> Bus <---------- future VIC/CIA/SID/C64 bus
                     |
                     v
                    RAM
```

The CPU knows only about the `Bus` interface. It does not know whether an address refers to RAM, ROM, VIC-II registers, CIA registers, SID registers, cartridge space, or an open bus. That mapping will be owned by the future C64 machine bus.

Likewise, the debugger uses `Bus.peek()` rather than `Bus.read()`. This distinction matters once reads from hardware registers have side effects. A debugger must be able to inspect memory without acknowledging an interrupt or altering a latch.

## Implementation Discussion

### Instruction stepping versus machine-cycle stepping

Version 0.1 executes one complete instruction per `Cpu6510.step()` call. The returned cycle count is the documented NMOS 6502 instruction duration plus relevant page-cross and branch penalties. This is sufficient for CPU functional testing and for bootstrapping the emulator.

It is *not* yet the final C64 timing model. The VIC-II steals individual bus cycles from the 6510, and exact raster software depends on when each read/write occurs inside an instruction. The public core is therefore structured so the instruction executor can later be replaced by a micro-operation/cycle engine while the machine bus, debugger, and UI contracts remain stable.

### Determinism

Core code does not call `Date.now()`, `performance.now()`, `setTimeout()`, `requestAnimationFrame()`, or random-number APIs. A future machine scheduler will advance emulated time by explicit clock cycles. The browser frontend will decide how quickly to request those cycles in wall-clock time.

### Numeric representation

JavaScript numbers are used for registers and counters, but all address/data boundaries are explicitly masked to 16 or 8 bits. Bulk memory is represented by `Uint8Array`. A cycle counter stored as a JavaScript integer remains exact for vastly longer than a normal emulator session.

### Testing philosophy

Core correctness is validated from the bottom up:

1. Bus semantics and wraparound.
2. CPU reset/register/flag behavior.
3. Addressing modes and cycle penalties.
4. Instruction families.
5. Stack and interrupt behavior.
6. Decimal arithmetic.
7. Disassembly and traces.
8. External functional-test ROMs.

Later C64 integration tests should never replace these focused tests; they should be added on top of them.
