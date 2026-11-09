# Debugger and Machine Monitor

## Overview

`src/core/debugger` provides side-effect-free inspection and execution control for the emulator core. The v1.0 machine monitor includes address breakpoints, CPU read/write watchpoints, raster line/cycle stops, editable CPU/RAM state, bounded execution and bus histories, IRQ/NMI history, hardware snapshots, and screen-memory inspection.

Files:

- `Disassembler.ts` — decodes the CPU opcode table without touching device side effects.
- `TraceFormatter.ts` — formats the current instruction and CPU state for compact traces.
- `Monitor.ts` — owns debugger configuration, stop reasons, bounded histories, state editing, and hardware snapshots.

## Architecture

The monitor observes the machine rather than modifying guest code:

```text
                   +----------------+
                   |   C64Machine   |
                   | instruction /  |
                   | raster timing  |
                   +---+--------+---+
                       |        |
             boundaries|        |raster / IRQ / NMI
                       v        v
                  +----------------+
                  |   C64Monitor   |
                  +---+--------+---+
                      ^        ^
             bus trace|        |peek / physical RAM
                      |        |
                 +----+--------+----+
                 |      C64Bus      |
                 +------------------+
```

`C64Bus` exposes a single optional access observer. Normal CPU and VIC traffic is reported to the monitor after the bus value is known. Debugger reads themselves use `peek()` or direct physical-RAM inspection, so opening the monitor cannot acknowledge interrupts, clear collision latches, alter the shared data-bus latch, or otherwise change emulated hardware state.

## Execution Stops

### Address breakpoints

Address breakpoints are checked before an instruction begins. Continuing from a stopped PC ignores that same breakpoint exactly once so the machine can make forward progress without removing it.

### Watchpoints

Watchpoints can cover one address or a contiguous range and can match reads, writes, or both. Only CPU traffic triggers watchpoints; VIC traffic is still captured in the bus trace but cannot unexpectedly halt the CPU because the video chip fetched screen or character data from the watched range.

The access that hits a watchpoint is recorded at its exact master/raster cycle. The machine then completes the current 6510 instruction and pauses at a safe instruction boundary. This avoids exposing a half-completed micro-operation to register or memory editing.

### Raster breakpoints

Raster stops can target a whole line or an exact line/cycle. The hit is latched at the requested VIC-II position and, like a watchpoint, execution pauses after the current CPU instruction completes. Line-only stops are edge-latched so they fire once on entry rather than once per cycle for the entire line.

## Inspection and Editing

The monitor exposes:

- CPU registers and total CPU cycles
- mapped-memory dumps through `peek()`
- physical RAM dumps/writes beneath ROM or I/O
- CPU register editing at instruction boundaries
- VIC frame/raster state, BA/AEC, bad-line state, graphics mode, memory bases, and colors
- CIA timer, latch, interrupt, control, port, and DDR state
- SID model/filter/envelope snapshot
- 6510 processor-port DDR/latch/pin state
- the active 1000-byte screen matrix plus color RAM

Edits are intentionally rejected while a CPU instruction is in progress. The browser UI also requires the machine to be paused before applying register or RAM changes.

## Histories and Tracing

Histories are bounded so leaving the browser running does not grow debugger memory indefinitely. The default limits are 256 instruction-boundary entries, 512 CPU/VIC bus accesses, and 128 interrupt edges.

Execution history stores the disassembled instruction plus CPU/master/raster position. Bus history records source (`CPU` or `VIC`), read/write direction, address, value, and timing position. IRQ history records assertion and clearing edges with the active CIA1/VIC-II sources; NMI history records RESTORE and CIA2 edges.

Power-on/reset clears runtime histories and a latched stop while preserving configured breakpoints/watchpoints, matching normal monitor expectations during iterative debugging.

## Browser Monitor

The development console exposes the monitor directly:

- add/remove PC breakpoints, watchpoints, and raster stops
- Continue from a stop
- inspect/edit CPU registers
- inspect mapped memory or physical RAM and write RAM bytes
- view execution, bus, and interrupt histories
- inspect VIC/CIA/SID/processor-port state
- inspect screen matrix bytes
- view a raster/cycle activity plot of recent CPU and VIC bus accesses

The browser layer only renders and edits through the core monitor API; breakpoint semantics remain testable without DOM or browser APIs.
