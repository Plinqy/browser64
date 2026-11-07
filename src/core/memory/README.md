# Memory and Bus Layer

## Overview

This directory contains the byte-addressable bus abstractions used by the CPU and the C64's machine-specific memory rules. `RamBus` is the flat 64 KiB CPU-test bus. `C64Bus` owns physical RAM, CPU ROM/I/O banking, the 6510 processor port, and the independent memory view used by the VIC-II.

## Architecture

```text
              C64Bus
             /      \
      CPU Bus view   VIC 14-bit view
      /   |   \       /       \
    RAM  ROM  I/O   banked RAM  Char ROM shadow
```

The CPU view is controlled by `$0000/$0001` and the C64 PLA rules. The VIC view is controlled by CIA2 PA0/PA1 and never exposes CPU I/O, BASIC ROM, or KERNAL ROM.

## Implementation Discussion

For the stock no-cartridge CPU memory map:

- BASIC ROM is visible at `$A000-$BFFF` only when LORAM and HIRAM are high.
- KERNAL ROM is visible at `$E000-$FFFF` when HIRAM is high.
- `$D000-$DFFF` exposes I/O when CHAREN is high and either LORAM or HIRAM is high.
- `$D000-$DFFF` exposes character ROM when CHAREN is low and either LORAM or HIRAM is high.
- If both LORAM and HIRAM are low, `$D000-$DFFF` is RAM regardless of CHAREN.

Writes to visible BASIC/KERNAL/character ROM go to physical RAM underneath. When I/O is selected, writes go to the selected device instead.

### VIC memory view

`readVicMemory()` accepts the VIC's 14-bit address. CIA2 Port A bits 0-1 are inverted to select one of four physical 16 KiB banks. In banks 0 and 2, VIC-relative `$1000-$1FFF` reads the 4 KiB character ROM. In banks 1 and 3 the same relative addresses read physical RAM.

This shadowing is independent from CPU `$0001` banking. In particular, VIC bank 3 sees the RAM underneath CPU I/O/KERNAL regions rather than those devices/ROMs.

Color RAM is separate from the VIC 14-bit byte bus. `readVicColor()` supplies its fixed 1 KiB low-nibble storage to the VIC renderer.

Cartridge GAME/EXROM PLA modes, open-bus behavior, and cycle-level VIC arbitration remain future work.
