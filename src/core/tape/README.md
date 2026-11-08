# Datasette and TAP Playback

## Overview

`src/core/tape` models the Commodore 1530/C2N at the signal boundary the C64 actually sees. Version 0.12 parses raw C64 TAP v0/v1 images and replays their pulse timing through CIA1 FLAG while the 6510 processor port supplies MOTOR, SENSE, and WRITE.

## Architecture

```text
TAP image -> Datasette pulse timer -> falling CIA1 FLAG edge
                  ^
                  |
         6510 port $00/$01
         bit 5 MOTOR (low=on)
         bit 4 SENSE (low=key down)
         bit 3 WRITE
```

The tape deck is clocked by C64 master cycles, not browser time. Custom loaders therefore see the same timing source as the CPU and CIA timers. TAP pulse counts are converted from the recording standard's timer clock (PAL/NTSC/old-NTSC/PAL-N) into the active machine clock so cross-standard playback preserves pulse duration.

## Implementation Discussion

TAP v0 nonzero bytes encode pulse intervals in units of eight C64 cycles. A zero v0 byte means the original long interval overflowed the one-byte representation, so its exact duration is unavailable; playback uses VICE's 2500-cycle compatibility default. TAP v1 uses the same compact form and encodes a zero byte followed by a 24-bit little-endian exact cycle count for long pulses; an all-zero extended length falls back to the same compatibility gap.

For C64 TAP v0/v1 each entry represents a complete pulse interval. CIA1 FLAG only reacts to a falling edge, so playback emits one falling edge per TAP entry rather than toggling and accidentally delivering only every second pulse. TAP v2 half-wave images are not accepted because version 2 is a C16/Plus4 extension, not a C64 tape format.

The transport key and motor are independent. PLAY drives SENSE low, while the processor's active-low MOTOR output determines whether the tape advances. A deterministic 300 ms motor spin-up interval is modeled before pulses are delivered. Recording is deliberately deferred; WRITE level is exposed so a later recorder can timestamp its transitions without changing the processor-port architecture.
