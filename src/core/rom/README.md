# C64 ROM Images

## Overview

This directory owns the byte images for the C64 motherboard ROMs: 8 KiB BASIC, 8 KiB KERNAL, and 4 KiB character-generator ROM. ROM bytes are supplied by the user at runtime; the project does not redistribute Commodore ROM images.

## Architecture

`C64Roms` is intentionally independent of browser APIs. The emulator core accepts bytes through `load(kind, bytes)`, validates the exact hardware size, copies them into fixed `Uint8Array` storage, and records whether each image has been supplied. Browser `File`/`ArrayBuffer` handling remains in `src/main.ts`.

The memory bus owns one `C64Roms` instance and selects its bytes only when the 6510 processor-port banking lines make that ROM visible.

## Implementation Discussion

Unloaded ROM arrays are filled with `$FF`. This produces deterministic behavior and makes missing-ROM execution fail visibly instead of accidentally running zero-filled memory as BRK instructions. `C64Roms.complete` is used by the browser UI to keep Power On disabled until all three motherboard ROMs are present.

Only exact image sizes are accepted. Headered archive formats, ROM database identification, revision detection, and checksums are intentionally deferred. Those concerns can be added as import-layer features without changing the bus-facing fixed-size byte arrays.
