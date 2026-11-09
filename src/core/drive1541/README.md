# Commodore 1541 drive core

## Overview

`C1541Drive` is an independent 1 MHz computer on the shared open-collector IEC bus. It has its own NMOS 6502 core, 2 KiB RAM, two MOS 6522 VIAs, user-supplied 16 KiB DOS ROM, and a byte-level GCR read/write mechanism.

## Architecture

`C1541Bus` maps RAM, IEC VIA, disk VIA, and DOS ROM as on a stock 1541. VIA #0 implements IEC plus device-address jumpers. VIA #1 connects PA to the read/write byte bus, PB0/PB1 to the stepper, PB2 to spindle motor, PB3 to the LED, PB4 to write-protect sense, PB5/PB6 to density selection, PB7 to SYNC, CA1 to BYTE READY, CA2 to SOE, and CB2 to the read/write gate.

`DriveMechanism1541` accepts either D64 or G64. D64 sectors are synthesized into standard circular GCR tracks; valid standard sectors written back through the GCR stream are decoded into the mutable D64 before export/eject/read-mode transition. G64 stays raw and preserves half-track data and per-byte speed zones. Read-side BYTE READY is suppressed throughout BLOCK SYNC and resumes on the first post-sync GCR byte; write mode continues to pace each completed byte.

## Accuracy boundary

This is firmware-driven media I/O rather than a KERNAL trap. The write path and raw G64 preservation are byte-level: exact analog PLL behavior, weak/random bits, magnetic transition timing below a GCR byte, and every copy-protection quirk remain outside the v1.0 accuracy claim. Future fidelity work should extend this mechanism rather than bypass the drive CPU/VIAs/IEC architecture.
