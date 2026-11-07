# C64 I/O Layer

## Overview

This directory owns CPU-visible device routing for the `$D000-$DFFF` C64 I/O window. As of v0.5 the VIC-II and both CIA regions contain functional device models. SID remains an explicit register-file placeholder. Color RAM is dedicated 4-bit memory rather than a normal chip register bank.

## Architecture

`C64Io` divides the 4 KiB I/O window into the stock regions:

- `$D000-$D3FF` — VIC-II, registers mirrored every `$40`
- `$D400-$D7FF` — SID, 32-register placeholder mirrored every `$20`
- `$D800-$DBFF` — 1 KiB color RAM
- `$DC00-$DCFF` — CIA #1, 16 registers mirrored every `$10`
- `$DD00-$DDFF` — CIA #2, 16 registers mirrored every `$10`
- `$DE00-$DEFF` — expansion I/O 1
- `$DF00-$DFFF` — expansion I/O 2

Every device implements `MemoryMappedDevice`, keeping normal reads distinct from side-effect-free debugger peeks.

## Implementation Discussion

The VIC-II receives a `VicMemory` provider from `C64Bus`; it does not read through the CPU-visible I/O router. This prevents the common emulator mistake of making VIC fetches obey CPU CHAREN/BASIC/KERNAL banking.

`C64Io.tick()` advances VIC-II and both CIAs. `C64Machine` invokes it one system cycle at a time so all timed I/O shares the master clock.

CIA1 remains wired to the keyboard matrix and active-low joystick pin images. CIA2 Port A bits 0-1 select the VIC bank through the real inverted mapping. IEC electrical behavior remains deferred.

Color RAM stores only its low four bits and survives reset because it is RAM. Deterministic cold power-on clears it. Until an open-bus model exists, its undefined high nibble reads as `$F`.

The expansion I/O areas use `OpenBusDevice`; `$FF` remains a deterministic temporary policy, not a claim about all real cartridge/open-bus conditions.
