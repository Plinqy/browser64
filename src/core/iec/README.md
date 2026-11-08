# Commodore Serial IEC Bus

## Overview

`src/core/iec` models the open-collector serial bus shared by the C64 and peripherals. v0.11 extends the v0.10 ATN/CLOCK/DATA foundation with RESET and connects an actual firmware-driven 1541 endpoint to the same bus used by CIA2.

Host-assisted D64 PRG loading remains available as an explicit convenience feature, but it is separate from true-drive execution and never masquerades as IEC traffic.

## Architecture

```text
CIA2 PA3/PA4/PA5                       1541 VIA #0
       |                                    |
       | inverted drivers                   | IEC board logic
       v                                    v
+--------------------+              +--------------------+
| C64 IEC endpoint   |              | 1541 IEC endpoint  |
+---------+----------+              +---------+----------+
          \                                  /
           \                                /
            v                              v
       +-----------------------------------------+
       | IecBus                                  |
       | wired-AND/open-collector                |
       | ATN    CLOCK    DATA    RESET           |
       +-----------------------------------------+
```

## Implementation Discussion

### Electrical convention

The API represents physical line level: `true` is released/high and `false` is asserted/low. Endpoints never drive high; they either pull low or release, matching the real pull-up/open-collector topology.

CIA2 PA3/PA4/PA5 retain the C64 motherboard's inverted ATN/CLOCK/DATA outputs. The 1541 side uses its VIA #0 port-B wiring and ATN-acknowledge logic rather than a protocol-level shortcut. RESET is now a first-class open-collector line so physical drive reset can be represented at the same electrical boundary.

### Host-assisted versus true-drive disk access

`D64Image` extraction is still useful for instant browser-side PRG loading, but v0.11 adds an entirely separate path: `C1541Drive` runs a 1541 ROM on its own CPU and VIAs, reads a GCR media stream, and communicates over `IecBus`. Fast loaders therefore have an architectural path to work by executing their real C64/1541 code rather than by teaching the host loader special cases.

### Deferred line

SRQ is not represented yet. A stock 1541 does not require SRQ for normal serial operation; it can be added when a 1571/1581 or another SRQ-capable peripheral is modeled.
