# VIC-II Core

## Overview

This directory contains the MOS VIC-II video core. It owns raster timing, CPU-visible VIC registers, raster IRQs, the independent 14-bit VIC memory view, standard-text rendering, and—beginning in v0.5—the first real VIC/6510 bus-arbitration behavior.

The default machine profile is PAL MOS 6569: 63 system cycles per raster line and 312 lines per frame. NTSC timing metadata remains available for later selectable-machine support.

## Architecture

`VicII` is a memory-mapped device but does not use the 6510's CPU memory map. It receives a narrow `VicMemory` interface:

- `read(address)` reads the current VIC 16 KiB bank.
- `readColor(index)` reads one 4-bit color-RAM cell.

`C64Bus` supplies that view using inverted CIA2 bank selection and VIC-specific character-ROM shadowing.

The VIC additionally exposes its current bus signals:

```text
bad-line condition
       |
       +--> BA low, cycles 12-54
       |
       +--> AEC low, cycles 15-54
                       |
                       +--> 40 c-accesses
```

## Implementation Discussion

### Raster and IRQ registers

The v0.4 register behavior remains intact:

- `$D011` supplies display/mode/YSCROLL state on write and the live raster high bit on read.
- `$D012` sets raster compare on write and returns the live raster low byte on read.
- `$D018` selects screen and character memory offsets.
- `$D019` is the interrupt latch with write-one-to-clear acknowledgement.
- `$D01A` masks VIC interrupt sources.
- `$D020/$D021` provide border/background colors.

### Bad-line condition

A raster line is treated as a bad line when:

1. the raster is `$30-$F7`,
2. `(raster & 7) == YSCROLL`, and
3. DEN was observed set at some point during raster `$30`.

The DEN observation is latched for the display window and cleared at the next frame.

### BA and AEC

On a bad line the VIC drives BA low beginning at cycle 12. This gives the 6510 up to three cycles to finish a possible run of write cycles. AEC goes low on cycle 15 and remains low through cycle 54 while VIC owns the PHI2 bus. Both are released for cycle 55.

A read-heavy instruction stream therefore stops as early as cycle 12 and can lose 43 CPU cycles, while a stream already in consecutive write cycles can consume some or all of the three warning cycles before AEC falls.

### c-accesses

During AEC-low cycles 15-54 the VIC performs 40 character/color matrix fetches. v0.5 stores those values in internal 40×25 line buffers (`videoMatrix` and `colorMatrix`) and exposes side-effect-free debug accessors for tests.

The existing standard-text renderer still renders a frame snapshot from the VIC memory interface. Converting g-access/pixel output to consume the time-latched matrix data is intentionally left to the next video-timing refinement rather than mixing two timing changes in one phase.

### Remaining VIC timing work

Not yet implemented:

- sprite DMA and sprite BA/AEC steals,
- g-access cycle placement,
- row counter/VC/VCBASE behavior,
- cycle/dot-positioned border transitions,
- fine scrolling,
- bitmap/multicolor/ECM modes,
- collision/light-pen behavior,
- open-bus details.
