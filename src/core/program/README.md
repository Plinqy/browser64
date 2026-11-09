# PRG Program Loading

## Overview

`src/core/program` contains browser-independent parsing and launch analysis for the native Commodore `.PRG` container: two little-endian bytes specify the destination address and every remaining byte is copied into C64 RAM.

The parser deliberately does not know about file pickers, drag/drop, MIME types, or browser APIs. Those concerns remain in the host layer.

## Architecture

```text
host File / D64 / T64
        |
        v
     parsePrg()
        |
        +--> detectBasicBootstrap()
        |         |
        |         +--> conventional tokenized first BASIC line at $0801
        |              even when the PRG begins below $0801
        v
+-------------------+
| ParsedPrg         |
| load address      |
| payload bytes     |
| end address       |
+---------+---------+
          |
          v
     C64Machine
          |
          +--> physical RAM
          +--> optional BASIC pointer repair
          +--> BASIC RUN or explicit PC launch
```

## Implementation Discussion

### Container semantics

A PRG is not an executable format in the modern sense. The first two bytes are a load address, not a CPU entry point. The remaining bytes are copied verbatim to memory. A normal BASIC program begins at `$0801`, while many commercial loaders place machine code/data below `$0801` and still contain a short BASIC `SYS` bootstrap at `$0801`.

For that reason parsing and launching are separate concepts. `C64Machine.loadPrg()` loads the full byte range and asks `detectBasicBootstrap()` whether the memory image contains a structurally plausible tokenized BASIC first line at `$0801`. When detected, the machine repairs BASIC pointers around that text address. `C64Machine.launchPrg()` then queues BASIC `RUN` through the KERNAL keyboard buffer. When no bootstrap is detected, host-assisted Run/Start falls back to the PRG load address.

`C64Machine.startAt()` remains the explicit debugger/host action for a separately known machine-code entry point.

### BASIC bootstrap detection

The detector intentionally does not classify a program from filename or load address alone. It validates the first tokenized BASIC line at `$0801` using the linked-line pointer, legal BASIC line-number range, terminating zero byte, memory bounds, and the presence of a BASIC V2 token. A narrow compatibility allowance accepts historical loader stubs whose stored next-line pointer lands on the line terminator itself instead of the byte after it.

Only the first line must be structurally valid. This is intentional: historical game loaders commonly execute a `SYS` from that first line and then place arbitrary machine code/data immediately after it, so requiring a completely traversable BASIC linked list would reject valid bootstrap loaders.

The detector is conservative but still heuristic. Custom loaders can use entry conventions that no generic PRG analysis can infer. In those cases the operator should use Load Only plus the software's original command or use the firmware-driven 1541 path.

### BASIC pointers

For a detected bootstrap, the machine helper sets `TXTTAB` (`$2B/$2C`) to `$0801` and sets `VARTAB`, `ARYTAB`, and `STREND` (`$2D-$32`) to the first byte after the complete loaded PRG. This gives the BASIC interpreter a valid text start while preserving machine code/data that may live before or after the bootstrap.

### Physical RAM

PRG bytes are written to physical RAM. This is intentional: a load operation can place bytes underneath currently visible ROM, just as C64 RAM physically exists beneath banked ROM regions. CPU visibility after loading still obeys `$0001` banking.

### D64 and T64 integration

Disk/tape-container concerns do not enter `parsePrg()`. `D64Image.readPrg()` and `T64Image.readPrg()` both produce canonical PRG bytes including the two-byte load address, and callers use the same parser, bootstrap detector, and machine loading path described above. The firmware-driven 1541/IEC path is separate and does not depend on host-assisted PRG extraction.
