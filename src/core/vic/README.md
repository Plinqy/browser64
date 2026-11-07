# VIC-II Core

## Overview

This directory contains the MOS VIC-II video-chip foundation introduced in v0.4. The implementation now owns the C64 raster clock, the CPU-visible VIC register file needed for text display and raster interrupts, VIC-side memory fetches, and a browser-independent color-index framebuffer.

The default timing model is the PAL MOS 6569: 63 system cycles per raster line, 312 lines per frame, and 19,656 system cycles per frame. An NTSC 6567R8 timing profile is defined as well so machine scheduling is not architecturally hardcoded to PAL.

## Architecture

`VicII` is a memory-mapped device but it does **not** read memory through the 6510 CPU bus. Instead it receives the narrow `VicMemory` interface:

- `read(address)` reads a byte from the VIC's current 16 KiB address space.
- `readColor(index)` reads one color-RAM nibble for a video-matrix cell.

`C64Bus` implements that view. It applies the inverted CIA2 bank selection and the VIC-specific character-ROM shadowing rules independently of the CPU's `$0001` memory banking.

Raster time is represented by:

- `rasterLine` — 0 through 311 on PAL.
- `rasterCycle` — 1 through 63 on PAL.
- `frameNumber` — increments when the raster wraps to line 0.

The VIC framebuffer contains 4-bit C64 color **indices**, not RGB pixels. This keeps analog/display palette decisions outside the hardware model. `VicPalette.ts` is a frontend presentation palette, while the emulated chip itself only knows color numbers 0–15.

## Implementation discussion

v0.4 implements the pieces required to get a recognizable stock C64 text display without pretending the emulator is already cycle-exact:

- `$D011` supplies display/mode control on write and the live raster high bit on read. Its written bit 7 becomes the high bit of the raster IRQ compare value.
- `$D012` supplies the live raster low byte on read and the low raster IRQ compare byte on write.
- `$D018` selects the screen matrix in 1 KiB steps and the text character base in 2 KiB steps.
- `$D019` exposes VIC interrupt latches and uses write-one-to-clear acknowledgement.
- `$D01A` masks interrupt sources.
- `$D020`/`$D021` drive border/background color.
- VIC registers mirror every `$40` bytes through CPU addresses `$D000-$D3FF` via `C64Io`.

The renderer currently supports standard 40×25, 8×8, hires character text. It fetches the 1,000 screen codes, the corresponding color-RAM nibbles, and glyph bytes through the VIC memory interface. Bitmap, multicolor, ECM, sprites, light pen, sprite collisions, fine-scroll border behavior, and analog color generation remain future phases.

### Timing boundary

`C64Machine.tickSystemCycle()` is now the master hardware-clock boundary. Every system cycle advances VIC and both CIA chips before interrupt lines are synchronized. `C64Machine.step()` still asks the 6510 core to execute an entire instruction atomically and then advances the rest of the machine by the returned cycle count.

That means raster counters and peripheral time are now tracked one cycle at a time, but CPU memory accesses are **not yet placed on their individual bus cycles**. A `STA $D020`, for example, changes the VIC register before the instruction's returned cycles are replayed. This is intentionally documented rather than hidden. True BA/AEC stalls, bad lines, sprite DMA, and cycle-positioned raster writes require the future micro-operation CPU execution model.

### Character ROM visibility

The VIC has only 14 address lines. CIA2 supplies the inverted upper two bank bits. In VIC banks 0 and 2, VIC-relative `$1000-$1FFF` is replaced by the 4 KiB character ROM. In banks 1 and 3 the same relative range is ordinary RAM. This rule is independent of whether the 6510 currently sees I/O, RAM, or character ROM at CPU `$D000-$DFFF`.

### Framebuffer crop

The v0.4 framebuffer is a practical 384×272 logical presentation containing a centered 320×200 text area and border. It is intentionally not a literal 504-dot PAL raster capture. Raster timing is modeled separately at the hardware-cycle level so a later renderer can move to dot/cycle-positioned output without changing the scheduler contract.
