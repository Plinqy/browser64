# Commodore Serial IEC Bus

## Overview

`src/core/iec` models the electrical three-wire serial IEC bus shared by the C64 and peripherals. Version 0.10 introduces ATN, CLOCK, and DATA as open-collector lines so a future cycle-accurate 1541 can attach to the same bus used by CIA2.

This phase deliberately does **not** emulate a 1541 DOS, VIA chips, GCR mechanics, or the KERNAL serial protocol at a high level. D64 convenience loading is a separate host-assisted path and never pretends to be IEC traffic.

## Architecture

```text
CIA2 PA3/PA4/PA5
       |
       | inverted motherboard drivers
       v
+--------------------+
| C64 IEC endpoint   |
| pull low / release |
+---------+----------+
          |
          v
+-------------------------------+
| IecBus                        |
| wired-AND/open-collector      |
| ATN      CLOCK      DATA      |
+-------------------------------+
          ^
          |
 future 1541 / printer / device endpoints

CLOCK/DATA resolved levels
          |
          +--> CIA2 PA6 / PA7 inputs
```

## Implementation Discussion

### Electrical convention

The API represents physical line level: `true` is released/high and `false` is asserted/low. Endpoints never drive a line high. They either pull it low or release it, matching the real serial bus pull-up/open-collector topology.

On the C64 motherboard CIA2 PA3, PA4, and PA5 feed inverting output stages for ATN, CLOCK, and DATA. Consequently a CIA output bit of `1` with its DDR bit configured as an output pulls the corresponding IEC line low. CIA2 PA6 and PA7 read the resolved CLOCK and DATA line levels directly.

### Why D64 loading is separate

A D64 image is only sector data. Treating sector extraction as if bytes traversed the serial bus would make fast loaders appear to work while bypassing the actual 1541 CPU and IEC handshake. v0.10 therefore exposes two clearly separate mechanisms:

- `IecBus` is the physical serial-wire foundation for future true-drive emulation.
- `D64Image` plus the browser's **Host-assisted Load** feature extracts a PRG directly and feeds the existing PRG loader.

This boundary lets users work with disk images now without compromising the architecture required for real 1541/fast-loader compatibility later.

### Deferred lines

SRQ and RESET are not represented yet. Standard C64/1541 KERNAL serial transfers use ATN, CLOCK, and DATA; the additional lines can be added when a physical peripheral model needs them.
