# PRG Program Loading

## Overview

`src/core/program` contains browser-independent program-container parsing. Version 0.7 starts with the native Commodore `.PRG` format: two little-endian bytes specify the destination address and every remaining byte is copied into C64 RAM.

The parser deliberately does not know about file pickers, drag/drop, MIME types, or browser APIs. Those concerns remain in the host layer.

## Architecture

```text
host File / drag-drop
        |
        v
     parsePrg()
        |
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
          +--> optional PC launch
```

## Implementation Discussion

### Container semantics

A PRG is not an executable format in the modern sense. The first two bytes are a load address, not a CPU entry point. The remaining bytes are copied verbatim to memory. A BASIC program normally loads at `$0801`; a machine-language PRG may load anywhere appropriate for the program.

For that reason parsing and launching are separate concepts. `C64Machine.loadPrg()` loads bytes and, for the normal `$0801` BASIC case, repairs BASIC text/variable pointers. `C64Machine.startAt()` is an explicit debugger/host action for machine-code programs whose entry point is known to be the load address.

### BASIC pointers

When a PRG loads at `$0801`, the machine helper sets `TXTTAB` (`$2B/$2C`) to `$0801` and sets `VARTAB`, `ARYTAB`, and `STREND` (`$2D-$32`) to the first byte after the loaded program. This mirrors the important memory bookkeeping expected after a normal BASIC program load without pretending to emulate an IEC/KERNAL LOAD transaction.

### Physical RAM

PRG bytes are written to physical RAM. This is intentional: a load operation can place bytes underneath currently visible ROM, just as C64 RAM physically exists beneath banked ROM regions. CPU visibility after loading still obeys `$0001` banking.
