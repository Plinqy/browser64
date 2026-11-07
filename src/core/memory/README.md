# Memory and Bus Layer

## Overview

This directory contains the byte-addressable bus abstractions used by the CPU. `RamBus` remains the simple 64 KiB test bus used for isolated CPU validation. `C64Bus` is the stock no-cartridge Commodore 64 memory system.

## Architecture

```text
Cpu6510
  |
  v
Bus
├── RamBus     isolated CPU/unit tests
└── C64Bus     C64 address decode
    ├── RAM / ROM banking
    ├── 6510 processor port
    └── C64Io
```

`Bus.read()` may cause hardware side effects. `Bus.peek()` must be observational and is used by the disassembler/debugger. `Bus.write()` handles the machine-specific destination of a CPU write.

`C64Bus` owns 64 KiB physical RAM, the 6510 `$0000/$0001` port, the three motherboard ROM images, and the `$D000-$DFFF` I/O router.

## Implementation Discussion

For the stock no-cartridge memory map:

- BASIC ROM is visible at `$A000-$BFFF` only when LORAM and HIRAM are high.
- KERNAL ROM is visible at `$E000-$FFFF` when HIRAM is high.
- `$D000-$DFFF` exposes I/O when CHAREN is high and either LORAM or HIRAM is high.
- `$D000-$DFFF` exposes character ROM when CHAREN is low and either LORAM or HIRAM is high.
- If both LORAM and HIRAM are low, `$D000-$DFFF` is RAM regardless of CHAREN.

Writes to visible BASIC/KERNAL/character ROM go to physical RAM underneath. When I/O is selected, writes go to the selected device instead.

`$0000/$0001` are modeled as 6510 internal registers and never alter physical RAM locations zero and one. Effective bank control comes from resolved processor-port pins, so input-configured bits use external pin levels.

### CIA2 and the VIC bank

v0.3 exposes `vicBankNumber` and `vicBankBase`. CIA2 Port A bits 0-1 supply the VIC's high address bits through inverters, so pin values `11`, `10`, `01`, `00` select banks 0, 1, 2, 3 respectively. If those CIA pins are configured as inputs after reset, pull-ups select bank 0.

This does not yet implement VIC memory fetches or character-ROM visibility from the VIC side; it establishes the real bank-control source for the upcoming VIC-II phase.

Cartridge GAME/EXROM PLA modes, open-bus decay, and cycle-level VIC-II bus arbitration remain future work.
