# Debugger and Disassembly

## Overview

This directory provides developer tooling around the emulator core without changing emulated state. Version 0.1 includes an instruction disassembler and a compact trace-line formatter.

Files:

- `Disassembler.ts` — decodes official opcode metadata and formats operands.
- `TraceFormatter.ts` — combines disassembly with CPU registers, flags, and cycle count.

## Architecture

Debugger code observes the CPU and bus but is not part of instruction execution:

```text
             +-------------+
             |   Cpu6510   |
             +------+------+ 
                    |
                  Bus
                    ^
                    | peek only
             +------+------+
             |  Debugger   |
             +-------------+
```

The key rule is that disassembly uses `Bus.peek()`, not `Bus.read()`. This distinction has no visible effect with `RamBus`, but it becomes essential when reading C64 registers can clear flags, acknowledge interrupts, or return transient bus values.

## Implementation Discussion

### Disassembler

The disassembler consumes the same opcode metadata table used by the CPU decoder. This prevents a second, independently maintained opcode-length table from drifting out of sync.

Relative branches are rendered as their resolved destination address rather than raw signed offsets. Unknown/undocumented opcodes are displayed as `.byte $xx`, allowing memory dumps to remain navigable before illegal-opcode execution is implemented.

### Trace format

A trace captures the instruction *about to execute* and the CPU state at that boundary. This convention makes traces straightforward to compare against reference emulator logs:

```text
0800  A2 00    LDX #$00           A:00 X:00 Y:00 SP:FD P:..-..I.. CYC:7
```

The browser demo keeps a small rolling trace, while tests can instantiate `TraceFormatter` directly.

### Future monitor

The planned machine monitor will build on these primitives with:

- breakpoints by address and condition
- watchpoints for reads/writes
- memory dump/edit
- register edit
- assembly input
- symbolic labels
- raster/cycle breakpoints
- VIC-II state inspection
- CIA timers and interrupt sources
- SID register display
- execution history

Breakpoints should be implemented by the machine runner, not by modifying guest memory with trap opcodes. That keeps debugging observational and avoids changing timing or behavior.
