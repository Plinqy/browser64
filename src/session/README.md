# Browser Session and Save-State Layer

## Overview

`src/session` is the browser-only persistence boundary. It keeps IndexedDB, base64/JSON serialization, and session restoration outside the deterministic emulator core while providing quick saves, portable `.c64state` files, persisted machine preferences, and automatic reattachment of user-supplied media.

## Architecture

```text
C64Machine state <-> StateCodec <-> .c64state / IndexedDB quick state
                                      |
ROM / PRG / D64 / G64 / CRT / TAP / T64 assets
                                      |
                               BrowserSessionStore
                                      |
                                  IndexedDB
```

`StateCodec` preserves `Uint8Array` values explicitly so RAM, color RAM, framebuffer, chip state, and other byte arrays survive JSON serialization without changing shape. The encoded state format is versioned independently from the application release.

`BrowserSessionStore` persists PAL/NTSC and 6581/8580 preferences plus user-supplied assets. Stored byte arrays are cloned on both write and read so browser persistence cannot accidentally share mutable buffers with the active emulator.

## Save-State Boundary

A motherboard save state is captured only at a 6510 instruction boundary. CPU, RAM, VIC, CIA, SID, Datasette, processor-port, bus-latch, and supported cartridge-bank state are restored deeply. The independently running 1541 CPU/VIA electronics are reset on restore rather than pretending an arbitrary drive microcycle was captured; mounted media and mechanism position remain attached.

State files are tied to their PAL/NTSC timing standard. Loading a state into the wrong standard is rejected visibly.

## Storage Failure Behavior

IndexedDB open/upgrade failures are surfaced to the browser UI rather than silently discarding persistence. A blocked database open reports the other-tab condition, failed opens may be retried, and `versionchange` closes the current handle so a later schema upgrade can proceed cleanly.
