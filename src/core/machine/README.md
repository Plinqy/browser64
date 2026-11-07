# C64 Machine Composition

## Overview

`C64Machine` is the composition root for a stock Commodore 64. It owns the CPU, bus, VIC-II, both CIA chips, debugger interfaces, interrupt wiring, and the master system clock.

Version 0.5 makes the master clock the actual execution boundary rather than replaying a whole CPU instruction's cycle count after the instruction has already executed.

## Architecture

```text
                 one system cycle
                       |
                       v
                 +-----------+
                 | C64Machine|
                 +-----+-----+
                       |
          sample VIC BA / AEC
                       |
              +--------+--------+
              |                 |
              v                 v
        Cpu6510.clock()       VIC-II
              |                 |
              |               CIAs
              |                 |
              +------ C64Bus ---+
```

CIA1 and VIC-II share the 6510 IRQ line. CIA2 assertion is edge-converted to NMI. VIC memory remains independent of CPU memory banking.

## Implementation Discussion

### Master system cycle

`tickSystemCycle()` now advances a complete C64 system cycle:

1. synchronize IRQ/NMI inputs,
2. sample the VIC's BA and AEC levels for the current raster cycle,
3. offer one micro-cycle to the 6510,
4. advance VIC-II and both CIAs by one system cycle,
5. increment the master cycle counter,
6. synchronize newly generated interrupts for the next CPU cycle.

The returned `C64SystemCycleResult` reports the CPU-cycle result and the BA/AEC levels that governed that cycle.

### Bad-line stalls

The CPU receives VIC BA as its RDY input. A BA-low read cycle is frozen without incrementing `cpu.cycles`; a pending write can still complete during the BA warning window. Once AEC is low, the CPU cannot advance any bus cycle.

`masterCycles` always advances because the motherboard clock continues even while the CPU is stunned. `cpuStallCycles` counts system cycles on which the CPU attempted but could not advance.

### Instruction stepping

`C64Machine.step()` repeatedly calls `tickSystemCycle()` until one CPU instruction or interrupt sequence finishes. Its return value is now **elapsed system cycles**, including any VIC-induced stalls. On a normal line this equals the instruction's documented CPU cycle count.

This distinction is important for raster code: a nominal two-cycle NOP can take much longer in wall-clock machine time if a bad line begins between its bus cycles.

### Reset

`Cpu6510.reset()` still establishes the reset-vector state atomically and returns seven reset cycles. `C64Machine` advances VIC/CIA time through those seven cycles without executing normal instruction micro-operations.
