# Datasette, C64 TAP Media, and T64 Containers

## Overview

`src/core/tape` models the Commodore 1530/C2N at the signal boundary the C64 sees. It parses and replays C64 TAP v0/v1 images through CIA1 FLAG and can record the 6510 cassette WRITE signal into cycle-timed TAP v1 media. It also parses legacy T64 file containers for explicit host-assisted PRG extraction; T64 never masquerades as pulse-level Datasette media.

## Architecture

```text
TAP image <-> Datasette pulse timer <-> CIA1 FLAG
                    ^
                    |
           6510 port $00/$01
           bit 5 MOTOR (low=on)
           bit 4 SENSE (low=key down)
           bit 3 WRITE
```

The deck is clocked by C64 master cycles, not browser time. Pulse counts are converted between the image's recording-standard clock and the active machine clock.

## Implementation Discussion

TAP v0 nonzero bytes encode intervals in units of eight C64 cycles; zero is an overflow whose exact duration was lost, so playback uses the VICE-compatible 2500-cycle fallback. TAP v1 adds a zero marker followed by an exact 24-bit little-endian cycle count.

Recording watches rising edges of the cassette WRITE signal and stores the full-wave interval between those edges as TAP v1. Compact one-byte entries are used when the interval is an exact multiple of eight cycles and fits; otherwise the exact 24-bit form is emitted. Recording can begin part-way through a mounted tape, preserving the prefix before the current position. Blank tapes, write protection, STOP/REWIND finalization, and complete TAP export are supported.

C64 TAP v2 is intentionally rejected: the v2 half-wave extension belongs to the C16/Plus4 tape format rather than C64 TAP media.


## T64 Container Boundary

`T64Image` accepts the common C64S/VICE T64 header, lists non-free directory entries, and exposes normal PRG entries as canonical two-byte-load-address PRG streams. Normal entry type 1 is the supported execution path, matching the format subset that is actually common in the wild. Historical files with the known bogus `$C3C6` end address fall back to the physical payload boundary.

T64 is intentionally read-only and host-assisted. A T64 does not encode cassette pulse timing, so feeding it into `Datasette` would invent hardware behavior that is not present in the file. Use TAP for true cassette emulation.
