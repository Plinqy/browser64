# C64 Machine Composition

## Overview

`C64Machine` is the composition root for a stock Commodore 64. It owns the CPU, bus, VIC-II, both CIA chips, debugger interfaces, interrupt wiring, and the master system clock.

The master clock remains the actual execution boundary in v0.6. The expanded VIC-II now contributes both bad-line and sprite DMA BA/AEC requests, while its c/g fetch sequencer generates display pixels on the same raster timeline.

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
              |               /   \
              |          c/g fetch  sprites
              |                 |
              |               CIAs
              |                 |
              +------ C64Bus ---+
```

CIA1 and VIC-II share the 6510 IRQ line. CIA2 assertion is edge-converted to NMI. VIC memory remains independent of CPU memory banking.

## Implementation Discussion

### Master system cycle

`tickSystemCycle()` advances a complete C64 system cycle:

1. synchronize IRQ/NMI inputs,
2. sample the VIC's combined bad-line/sprite BA and AEC levels,
3. offer one micro-cycle to the 6510,
4. advance VIC-II and both CIAs by one system cycle,
5. increment the master cycle counter,
6. synchronize newly generated interrupts for the next CPU cycle.

The returned `C64SystemCycleResult` reports the CPU-cycle result and the BA/AEC levels that governed that cycle.

### VIC stalls

The CPU receives VIC BA as its RDY input. A BA-low read cycle is frozen without incrementing `cpu.cycles`; a pending write can still complete while BA is low. Once AEC is low, the CPU cannot advance any bus cycle.

`masterCycles` always advances because the motherboard clock continues even while the CPU is stunned. `cpuStallCycles` counts system cycles on which the CPU attempted but could not advance.

Bad-line DMA and sprite DMA now use the same arbitration path. Exact half-cycle sprite p/s access sequencing is still a VIC-local future refinement; no second scheduler or special CPU shortcut is introduced for sprites.

### Instruction stepping

`C64Machine.step()` repeatedly calls `tickSystemCycle()` until one CPU instruction or interrupt sequence finishes. Its return value is **elapsed system cycles**, including VIC-induced stalls. On a bus-free line this equals the instruction's documented CPU cycle count.

### Reset

`Cpu6510.reset()` establishes the reset-vector state atomically and returns seven reset cycles. `C64Machine` advances VIC/CIA time through those seven cycles without executing normal instruction micro-operations.
