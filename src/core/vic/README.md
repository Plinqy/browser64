# VIC-II Core

## Overview

This directory contains the MOS VIC-II video core. It owns raster timing, CPU-visible VIC registers, raster IRQs, the independent 14-bit VIC memory view, the text/bitmap graphics sequencer, hardware sprites, collision latches, and VIC/6510 bus arbitration.

Version 0.6 moves pixels onto the timed memory pipeline rather than rendering from a frame-time RAM snapshot. Bad-line c-accesses load the internal video/color matrix, per-line g-accesses consume those latches through VC/VCBASE/RC, and the resulting data drives the framebuffer. The same phase adds all five documented display modes and the eight-sprite visual/collision engine.

The default machine profile remains PAL MOS 6569: 63 system cycles per raster line and 312 lines per frame. NTSC timing metadata remains available for later compatibility refinement.

## Architecture

`VicII` is a memory-mapped CPU device, but display DMA does not use the 6510's CPU memory map. It receives a narrow `VicMemory` interface:

- `read(address)` reads the current VIC 16 KiB bank.
- `readColor(index)` reads one 4-bit color-RAM cell.

`C64Bus` supplies that view using inverted CIA2 bank selection and VIC-specific character-ROM shadowing.

The display path is now driven by timed fetches:

```text
bad line
   |
   +-- cycles 15-54: 40 c-accesses
   |                  screen byte + color nibble
   |                         |
   |                         v
   |                  video/color latches
   |
normal visible line
   |
   +-- cycles 16-55: 40 g-accesses
                      VC + RC + mode bits
                             |
                             v
                     pixel generation
                             |
                             v
                       framebuffer
```

Sprites use the video-matrix pointer table at `screenBase + $3F8..$3FF`, fetch their 63-byte image data through the VIC memory view, contribute BA/AEC DMA requests, and are composed with display foreground/background classification.

## Implementation Discussion

### Raster and IRQ registers

The core implements the VIC-II register block through `$D02E`, including:

- `$D011` display enable, RSEL, YSCROLL, ECM/BMM mode bits, raster compare bit 8 on write, and live raster bit 8 on read.
- `$D012` raster compare low byte on write and live raster low byte on read.
- `$D016` CSEL, XSCROLL, and MCM.
- `$D018` screen/character/bitmap pointer selection.
- `$D019` interrupt latch with write-one-to-clear acknowledgement.
- `$D01A` interrupt enable mask.
- `$D01E/$D01F` read-to-clear sprite collision latches.
- `$D020-$D024` border/background colors.
- `$D025/$D026` shared sprite multicolors and `$D027-$D02E` per-sprite colors.

### Bad lines, VC, VCBASE, and RC

A raster line is a bad line when:

1. the raster is `$30-$F7`,
2. `(raster & 7) == YSCROLL`, and
3. DEN was observed set during raster `$30`.

At the display fetch window the sequencer restores `VC` from `VCBASE`. A bad line resets `RC` to zero and enters display state. Forty c-accesses load the current matrix row while forty g-accesses consume it. `RC` advances through 0-7; after row 7, `VCBASE` advances to the next 40-character matrix row and display state ends until the next bad line.

The debug accessors expose `videoCounter`, `videoCounterBase`, `rowCounter`, `videoMatrixLineIndex`, `displayState`, and the c/g access counters so timing tests can inspect sequencer state without causing register side effects.

### Graphics modes

`graphicsMode` is derived from ECM/BMM/MCM and implements the five documented modes:

1. standard text,
2. multicolor text,
3. standard bitmap,
4. multicolor bitmap,
5. extended-background-color text (ECM).

The three illegal ECM combinations keep the sequencer running but force display data to black. Bitmap addressing uses `$D018` bit 3 for the `$0000/$2000` bitmap base. ECM masks character codes to 6 bits while using bits 6-7 as the background selector.

Multicolor foreground/background classification follows VIC priority rules: pair `%00` and `%01` are background-class pixels, while `%10` and `%11` are foreground-class pixels. This classification is stored separately from color so sprite priority/collision behavior does not depend on which palette index happened to be chosen.

### Fine scroll and display window

YSCROLL controls bad-line alignment and therefore the row-counter phase. XSCROLL shifts generated graphics pixels by 0-7 pixels. RSEL selects the 24/25-row vertical display window; CSEL selects the 38/40-column horizontal window. Border pixels are kept separate from display pixels so sprites remain hidden by the physical border.

This is a cycle-level, not dot-clock-level, model. Mid-cycle border opening tricks and exact 8-dot horizontal transition positions remain later compatibility work.

### Hardware sprites

All eight sprite register sets are represented:

- 9-bit X and 8-bit Y positions,
- enable mask,
- X/Y expansion,
- hires and multicolor decoding,
- per-sprite and shared colors,
- sprite/background priority,
- sprite-sprite collision,
- sprite-background collision,
- collision IRQ sources.

Sprite 0 has fixed priority over sprite 1, and so on through sprite 7. Collision latches are read-to-clear while their corresponding `$D019` IRQ source remains latched until acknowledged there.

Sprite data pointers are read from the final eight bytes of the selected video matrix. The current implementation stages each active raster line's three sprite bytes at line start while exposing PAL sprite BA/AEC request windows to the shared scheduler. The half-cycle ordering of p-accesses and the three individual s-accesses is not yet represented separately; that is the remaining refinement before claiming fully cycle-exact sprite DMA.

### BA and AEC

Bad-line arbitration remains:

- BA low on cycles 12-54,
- AEC low on cycles 15-54.

Active sprite raster lines add sprite DMA BA/AEC request windows around the PAL sprite fetch slots. `C64Machine` samples the combined signals every system cycle, so sprite DMA can stall the cycle-steppable 6510 in addition to bad-line DMA.

### Remaining VIC work

Not yet claimed as cycle-exact:

- half-cycle p/s sprite fetch ordering,
- exact dot-clock border transitions and border-opening tricks,
- light pen,
- open-bus behavior,
- sprite crunch/expansion flip-flop edge cases,
- NTSC-specific sprite fetch windows,
- all undocumented VIC-II quirks and test-suite compatibility cases.
