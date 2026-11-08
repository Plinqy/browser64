# Commodore 1541 drive core

## Overview

v0.11 introduces the first true-drive layer. `C1541Drive` is an independent 1 MHz computer attached to the C64 through the same open-collector IEC bus used by the motherboard CIA2. It has its own NMOS 6502 execution core, 2 KiB RAM, two MOS 6522 VIAs, user-supplied 16 KiB DOS ROM, and a read-side GCR disk mechanism.

No Commodore ROM is distributed by the project. A 1541 ROM must be supplied by the user, just like the C64 ROMs.

## Architecture

`C1541Bus` implements the stock address decode: 2 KiB RAM and mirrors, IEC VIA at `$1800`, disk VIA at `$1C00`, and the 16 KiB ROM mirrored across `$8000-$FFFF`.

VIA #0 connects PB0/PB2/PB7 to DATA/CLOCK/ATN input, PB1/PB3 to the inverted open-collector DATA/CLOCK drivers, PB4 to ATN acknowledge logic, and PB5/PB6 to the device-address jumpers. ATN also drives CA1 through the board inverter.

VIA #1 connects PA to the 64H156 byte bus, PB0/PB1 to the four-phase stepper, PB2 to the spindle motor, PB3 to the activity LED, PB4 to write-protect sense, PB5/PB6 to density select, PB7 to SYNC, CA1 to BYTE-ready, CA2 to SOE, and CB2 to read/write output-enable. BYTE-ready also sets the 6502 V flag through the SO-pin behavior.

`DriveMechanism1541` converts mounted D64 sectors to a circular Commodore GCR track stream. The spindle advances at the selected density-zone byte rate and the head moves in half-track increments using the physical four-phase sequence.

## Accuracy boundary

This phase is a true firmware-driven drive, not a KERNAL LOAD trap, but its media path is intentionally read-only and byte-level. D64 sector data is synthesized into standard GCR. Writable flux, exact PLL/bit-cell analog behavior, G64/nib preservation, weak bits, and copy-protection-specific half-track data remain future work. Those features should extend the mechanism, not bypass the 1541 CPU/VIAs/IEC architecture introduced here.
