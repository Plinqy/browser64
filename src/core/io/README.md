# C64 I/O Layer

## Overview

This directory owns CPU-visible device routing for the `$D000-$DFFF` C64 I/O window. The address decode is real. As of v0.3, both CIA regions contain functional MOS 6526 devices; VIC-II and SID remain explicit register-file placeholders until their dedicated phases. Color RAM is modeled separately because it is dedicated 4-bit memory rather than a normal chip register bank.

## Architecture

`C64Io` is the single router used by `C64Bus` whenever CHAREN and the active memory configuration expose I/O. It divides the 4 KiB window into the C64 regions:

- `$D000-$D3FF` — VIC-II, 64 registers mirrored through 1 KiB (placeholder in v0.3)
- `$D400-$D7FF` — SID, 32 registers mirrored through 1 KiB (placeholder in v0.3)
- `$D800-$DBFF` — 1 KiB color RAM
- `$DC00-$DCFF` — CIA #1, real 6526, 16 registers mirrored through 256 bytes
- `$DD00-$DDFF` — CIA #2, real 6526, 16 registers mirrored through 256 bytes
- `$DE00-$DEFF` — expansion I/O 1
- `$DF00-$DFFF` — expansion I/O 2

Every device implements `MemoryMappedDevice`, keeping normal reads distinct from side-effect-free debugger peeks. This matters now: reading a CIA ICR acknowledges its pending interrupt sources, while peeking the same register must not.

## Implementation Discussion

`RegisterFileDevice` remains only for VIC-II and SID. It is not intended to fake those chips. CIA1/CIA2 are `Cia6526` instances from `core/cia` and receive PHI2 cycles from `C64Machine`.

CIA1 is wired to the `KeyboardMatrix` and two active-low joystick pin images. Port A corresponds to keyboard columns / joystick 2 and Port B to keyboard rows / joystick 1. The keyboard wiring supports the normal KERNAL scan direction and reverse-direction scans without embedding browser key names in the core.

CIA2 currently treats unimplemented IEC/user-port inputs as pulled high. Its Port A bits 0-1 are consumed by `C64Bus` to derive the inverted VIC 16 KiB bank selection. IEC electrical behavior will be added when drive/serial-bus emulation begins.

Color RAM stores only its low four bits and is preserved across machine reset because it is RAM rather than a resettable register file. A deterministic cold power-on explicitly clears it. Until an open-bus model exists, its undefined high nibble reads as `$F`.

The expansion I/O areas use `OpenBusDevice`. Returning `$FF` there remains a deterministic temporary policy, not a claim about every real cartridge/open-bus condition.
