# MOS 6510 / NMOS 6502 CPU Core

## Overview

This directory implements the NMOS 6502 execution engine used by the C64's MOS 6510. The 6510-specific `$0000/$0001` processor port remains in the C64 bus layer, while the CPU core owns registers, flags, addressing, interrupts, decimal arithmetic, stack behavior, and instruction timing.

Version 0.5 changes the timing model substantially: the CPU can now advance **one bus cycle at a time**. `step()` is retained as a compatibility wrapper that repeatedly clocks the cycle engine until one instruction or hardware-interrupt sequence finishes.

Files:

- `Cpu6510.ts` — cycle engine, instruction micro-operations, registers, interrupts, ALU, stack, and RDY/AEC behavior.
- `Flags.ts` — processor-status bit definitions.
- `types.ts` — opcode/addressing/register types.
- `opcodes.ts` — metadata for all 151 documented NMOS 6502 opcodes.

## Architecture

```text
                     BA / RDY          AEC
                        |               |
                        v               v
IRQ / NMI ------> +---------------------------+
                  |          Cpu6510          |
                  |                           |
                  | opcode -> bus-cycle plan  |
                  +-------------+-------------+
                                |
                         read / write
                                |
                                v
                              Bus
```

Each documented instruction is expanded into explicit read/write micro-operations. Addressing modes schedule their actual operand and dummy accesses; instruction semantics run on the bus cycle where the real CPU obtains or stores the relevant value.

## Implementation Discussion

### Cycle API

`clock(rdyHigh, aecHigh)` attempts exactly one CPU bus cycle and returns `CpuClockResult`.

- A normal read or write advances the CPU cycle counter by one.
- If `RDY` is low, a **read** cycle is held and no CPU state changes.
- A write cycle is allowed to complete while RDY is low.
- If `AEC` is low, the CPU is disconnected from the bus and no cycle advances.

`nextCycleKind` exposes whether the pending CPU cycle is a read or write. This lets the C64 machine model VIC-II's three-cycle BA warning before AEC bus ownership.

### Compatibility `step()`

`step()` clocks with RDY/AEC high until the current instruction completes and returns the consumed CPU-cycle count. Existing unit tests and external CPU functional tests can therefore continue to treat the core as an instruction-step processor even though the machine scheduler uses the finer cycle API.

### Addressing and bus sequences

The official addressing modes are represented with their documented bus sequences, including:

- zero-page indexed dummy reads,
- absolute indexed provisional-address reads,
- conditional page-cross reads,
- indexed-indirect and indirect-indexed zero-page pointer wrapping,
- the NMOS `JMP ($xxFF)` high-byte wrap bug,
- fixed-cycle indexed stores,
- read-modify-write old-value dummy writes.

Branches schedule the taken-branch dummy cycle and the additional page-cross cycle when required.

### Stack and interrupts

Stack pushes and pulls occur on explicit bus cycles. BRK, IRQ/NMI, JSR, RTS, and RTI are separately scheduled rather than being collapsed into an atomic helper. IRQ remains level-sensitive and NMI remains edge-latched at instruction boundaries.

The reset vector is still initialized atomically by `reset()` and charged as seven CPU cycles. The machine advances the peripherals through those seven reset cycles without executing normal CPU micro-operations. A later deep-timing phase can model reset pin sequencing if compatibility requires it.

### Decimal mode

ADC and SBC retain the verified NMOS decimal behavior from earlier releases. In particular, decimal ADC uses NMOS-specific intermediate flag behavior, while decimal SBC derives N/V/Z from the binary subtraction before decimal correction.

### Undocumented opcodes

Undocumented NMOS opcodes remain intentionally unsupported. They throw `UnsupportedOpcodeError` rather than silently behaving as NOPs. They will be added as an explicit compatibility phase with dedicated timing tests.
