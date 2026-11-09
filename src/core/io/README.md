# C64 I/O Layer

## Overview

This directory owns CPU-visible device routing for the `$D000-$DFFF` C64 I/O window. The VIC-II, SID, both CIA regions, color RAM, and expansion IO1/IO2 routing are composed here. Color RAM is dedicated 4-bit memory rather than a normal chip register bank.

## Architecture

`C64Io` divides the 4 KiB I/O window into the stock regions:

- `$D000-$D3FF` — VIC-II, registers mirrored every `$40`
- `$D400-$D7FF` — SID, 32 registers mirrored every `$20`
- `$D800-$DBFF` — 1 KiB color RAM
- `$DC00-$DCFF` — CIA #1, 16 registers mirrored every `$10`
- `$DD00-$DDFF` — CIA #2, 16 registers mirrored every `$10`
- `$DE00-$DEFF` — expansion I/O 1
- `$DF00-$DFFF` — expansion I/O 2

Every device implements `MemoryMappedDevice`, keeping normal reads distinct from side-effect-free debugger peeks.

## Implementation Discussion

The VIC-II receives a `VicMemory` provider from `C64Bus`; it does not read through the CPU-visible I/O router. This prevents the common emulator mistake of making VIC fetches obey CPU CHAREN/BASIC/KERNAL banking.

`C64Io.tick()` advances VIC-II, SID, and both CIAs. `C64Machine` invokes it one system cycle at a time so all timed I/O shares the master clock.

The SID runs at the selected VIC/system timing profile clock, so PAL and 6567R8 NTSC machines advance oscillator, envelope, and filter state from the same clock definition even when the 6510 is stalled by VIC DMA.

CIA1 is wired to the keyboard matrix and active-low joystick pin images. Named up/down/left/right/fire setters manipulate only the external active-low pin image and do not bypass CIA DDR/port resolution. CIA2 Port A bits 0-1 select the VIC bank through the real inverted mapping; PA3/PA4/PA5 drive the motherboard's inverted open-collector IEC outputs and PA6/PA7 receive resolved CLOCK/DATA. The shared `IecBus` remains device-agnostic; no fake 1541 protocol handling lives in the I/O decoder.

Color RAM stores only its low four bits and survives reset because it is RAM. Deterministic cold power-on clears it. On CPU reads, its undriven high nibble comes from the shared data-bus latch supplied by `C64Bus`.

The expansion I/O areas use `OpenBusDevice`; with no cartridge decoder attached they return that same shared latch. Standalone `C64Io` instances retain an `$FF` fallback so chip-local tests do not require a full motherboard.
