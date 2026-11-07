# MOS 6510 / NMOS 6502 CPU Core

## Overview

This directory implements the CPU portion of emulator v0.1. The Commodore 64 uses a MOS 6510, whose instruction set and execution core are based on the NMOS 6502. The 6510 additionally contains a small processor I/O port associated with addresses `$0000` and `$0001`; that C64-specific external-memory behavior is intentionally deferred to the C64 bus layer so the instruction engine can be validated as a plain NMOS 6502.

Files:

- `Cpu6510.ts` — register state, fetch/decode/execute, addressing, stack, interrupts, arithmetic, flags, and cycle accounting.
- `Flags.ts` — status-register bit definitions.
- `types.ts` — opcode/addressing/register types.
- `opcodes.ts` — metadata for all 151 documented NMOS 6502 opcodes.

## Architecture

`Cpu6510` has exactly one external hardware dependency: `Bus`.

```text
                  +------------------+
IRQ ------------->|                  |
NMI ------------->|     Cpu6510      |---- registers / cycles
RESET vector ---->|                  |
                  +--------+---------+
                           |
                     read / write
                           |
                           v
                         Bus
```

Instruction metadata is data-driven. `opcodes.ts` maps opcode bytes to mnemonic, addressing mode, instruction length, base cycles, and whether an indexed page crossing adds a cycle. `Cpu6510` resolves the addressing mode and dispatches the operation semantics by mnemonic.

This keeps opcode encoding separate from instruction behavior. For example, the eight official `ADC` encodings all use the same arithmetic implementation while differing only in operand acquisition and timing metadata.

## Implementation Discussion

### Registers and status

The emulated programmer-visible state is:

- 8-bit accumulator `A`
- 8-bit index registers `X` and `Y`
- 8-bit stack pointer `SP`
- 16-bit program counter `PC`
- 8-bit processor status `P`

Status bits are represented by `Flag`. The unused status bit is forced high in the internal representation. The break bit is treated as a stack-image artifact rather than persistent silicon state: `PHP`/`BRK` push it set, while hardware IRQ/NMI push it clear.

### Stack

The 6502 stack occupies `$0100-$01FF`. `SP` is the low byte. Push writes to `$0100 | SP` and then decrements `SP`; pull increments `SP` and then reads. JSR/RTS and interrupt entry/RTI are implemented in terms of these primitives.

### Addressing modes

All documented modes are implemented:

- implied and accumulator
- immediate
- zero page, zero page X, zero page Y
- absolute, absolute X, absolute Y
- indirect
- indexed-indirect `($nn,X)`
- indirect-indexed `($nn),Y`
- relative

Zero-page pointer reads wrap from `$FF` to `$00`. `JMP ($xxFF)` deliberately implements the original NMOS hardware bug where the high target byte is fetched from `$xx00`, not from the following page.

### Cycle accounting

Each opcode has a documented base cycle count. Indexed read instructions marked with `pageCrossCycle` add one cycle when indexing changes the high address byte. Taken branches add one cycle, plus another if the branch destination crosses a page.

Stores use their fixed documented timing and do not receive an extra page-cross cycle. Read-modify-write instructions likewise use their fixed timing.

The current implementation accounts for complete-instruction cycle totals. It does not yet schedule each internal bus access on a separate machine cycle.

### Read-modify-write bus behavior

Memory forms of `ASL`, `LSR`, `ROL`, `ROR`, `INC`, and `DEC` reproduce an important NMOS behavior: they read the old value, perform a dummy write of that old value, and then write the new value. This is mostly invisible with RAM but becomes observable when these instructions target C64 hardware registers.

### Interrupts

`setIrqLine()` models a level-sensitive IRQ input. IRQ is serviced between instructions only when the interrupt-disable flag is clear. `pulseNmi()` latches a pending edge so NMI is serviced at the next instruction boundary regardless of the interrupt-disable flag.

Hardware interrupt entry pushes PC and a status image with B clear, sets I, and reads the appropriate vector. `BRK` uses the IRQ/BRK vector but pushes B set and advances PC as the original two-byte BRK behavior requires.

### Decimal mode

ADC and SBC support NMOS BCD mode. Decimal ADC reproduces the NMOS quirk precisely: Z comes from the unadjusted binary sum, N/V come from the intermediate high-nibble stage after the decimal carry from the low nibble, and C comes from the final decimal correction. Decimal SBC keeps N/V/Z/C from the binary subtraction while applying decimal correction only to the accumulator. This intentionally differs from CMOS 65C02 behavior. Decimal behavior is isolated inside `adc()` and `sbc()` because this is a historically subtle compatibility area and should remain easy to test independently.

### Undocumented opcodes

Undocumented opcodes are intentionally not implemented in v0.1. Encountering one throws `UnsupportedOpcodeError` with the opcode and address. Later C64 compatibility work will add the stable NMOS illegal opcode families intentionally, along with dedicated tests, rather than treating unknown bytes as NOPs.

### Future cycle engine

The eventual VIC-II-compatible CPU will need individual read/write cycles and interrupt recognition timing. The intended evolution is to convert each instruction into a sequence of micro-operations while preserving the current public register state, bus abstraction, opcode metadata, and debugger interfaces.
