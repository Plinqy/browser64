# D64 and G64 Disk Images

## Overview

`src/core/disk` contains browser-independent 1541 media containers. `D64Image` is a mutable sector image supporting the standard 35-track layout and common 40/42-track extensions, with or without the optional per-sector error table. `G64Image` preserves raw GCR full/half-track byte streams and either constant or per-byte speed zones.

D64 remains the right representation for normal CBM DOS sectors. G64 is used when exact non-standard track bytes, half-tracks, or variable speed zones must survive a mount/write/export round trip.

## Architecture

```text
host .D64 bytes -> D64Image -> sectors / directory / files
                         \-> mutable sector writes -> toBytes()

host .G64 bytes -> G64Image -> raw track 1.0 / 1.5 / ...
                         \-> per-byte speed map -> toBytes()
```

## Implementation Discussion

### D64

A D64 stores 256-byte logical sectors with 21 sectors on tracks 1-17, 19 on 18-24, 18 on 25-30, and 17 from track 31 onward. `writeSector()` replaces an exact sector, invalidates cached directory metadata, and `toBytes()` preserves the original geometry and optional error table. `setSectorErrorCode()` updates that table when one exists.

Directory traversal still follows the linked chain from 18/1 with loop and bounds protection. PRG extraction returns the native file bytes including the two-byte load address.

### G64

G64 v0 track and speed tables are parsed by absolute offset. A track carries its actual raw byte length rather than the padded maximum track size. Speed entries 0-3 apply to an entire track; offset entries are unpacked into one zone value per four encoded track bytes. Serialization rebuilds canonical offset tables while preserving the raw track bytes and speed map.

The single-sided 1541 path supports up to 84 full/half-track entries (track 1.0 through 42.5).

### Host-assisted loading versus drive emulation

The browser can still use `D64Image.readPrg()` as an accelerated convenience path. That path does not execute KERNAL IEC routines. Separately, `C1541Drive` mounts D64 or G64 into the firmware-driven drive and performs media reads/writes through its VIA and mechanism.
