# Memory and Bus Layer

## Overview

This directory defines how emulated chips access the address space. Version 0.1 includes a minimal flat 64 KiB RAM bus for CPU development. It is deliberately simpler than a real C64 memory map.

Files:

- `Bus.ts` — hardware-neutral bus interface and a word helper.
- `RamBus.ts` — 65,536-byte RAM bus used by unit and functional tests and the browser CPU demo.

## Architecture

The bus is the boundary between a processor and the rest of the machine:

```text
CPU ---- read/write ----> Bus ----> selected device
Debugger ---- peek ------> |
                           +---- RAM
                           +---- future BASIC ROM
                           +---- future KERNAL ROM
                           +---- future character ROM
                           +---- future VIC-II
                           +---- future SID
                           +---- future CIA #1/#2
```

`Bus.read(address)` represents a real emulated read and may eventually cause device side effects. `Bus.write(address, value)` represents a real write. `Bus.peek(address)` is a side-effect-free inspection path for debugger tooling.

## Implementation Discussion

### Why the CPU never owns a Uint8Array

A C64 does not present a permanently flat 64 KiB memory array to its CPU. ROM and I/O are banked over underlying RAM, and the mapping changes according to the 6510 processor port and cartridge signals. If the CPU directly indexed a RAM array, that behavior would have to leak into the instruction engine.

Routing every access through `Bus` makes banking a machine concern instead.

### RamBus

`RamBus` intentionally provides a completely flat address space. It exists to make CPU tests independent of C64 banking. Addresses and values are masked to their hardware widths. `load()` rejects an image that would extend beyond `$FFFF` rather than silently wrapping it.

`setVector()` is a test/development convenience for writing little-endian CPU vectors.

### Future C64 bus

A later `C64Bus` will own:

- 64 KiB physical RAM
- BASIC ROM
- KERNAL ROM
- character ROM
- color RAM
- VIC-II/SID/CIA register windows
- 6510 data-direction and processor-port state
- cartridge GAME/EXROM mapping inputs
- open-bus behavior where required

Importantly, RAM will continue to exist underneath visible ROM. A write to `$A000` while BASIC ROM is visible will update the underlying RAM even though a CPU read from the same address returns ROM. This behavior naturally belongs in `C64Bus.write()`/`read()`.

### DMA and multiple bus masters

The VIC-II is also a memory consumer. The future architecture should distinguish CPU-visible bus reads from VIC-visible memory fetches because the VIC has its own bank view. Arbitration will live at the machine/scheduler level rather than being hidden inside `RamBus`.
