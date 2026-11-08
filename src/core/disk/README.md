# D64 Disk Images

## Overview

`src/core/disk` contains browser-independent parsing for Commodore 1541-compatible `.D64` images. Version 0.10 understands the standard 35-track layout and the common 40/42-track extensions, with or without the optional one-error-byte-per-sector table.

The parser exposes disk metadata, directory entries, raw sectors, sector error codes, and linked-file extraction. A PRG extracted from a D64 retains its two-byte load-address header, so it can be handed directly to the existing PRG loader.

## Architecture

```text
host .D64 bytes
      |
      v
+--------------------+
| D64Image           |
| geometry           |
| BAM/disk header    |
| directory chain    |
| sector addressing  |
+---------+----------+
          |
          +--> listDirectory()
          |
          +--> readSector(t,s)
          |
          +--> readFile(entry)
          |
          +--> readPrg(entry)
                    |
                    v
               parsePrg()
                    |
                    v
               C64Machine
               physical RAM
```

## Implementation Discussion

### Geometry

A 1541 D64 stores 256-byte logical sectors with zone-dependent track sizes: 21 sectors on tracks 1-17, 19 on 18-24, 18 on 25-30, and 17 from track 31 onward. Standard 35-track media contains 683 sectors (174,848 bytes). The parser also accepts the conventional 40- and 42-track extensions and all three optional error-table variants.

### Directory parsing

Directory traversal always begins at track 18 sector 1 and follows the sector link bytes rather than assuming a contiguous directory. Eight 32-byte directory slots are examined per sector. Deleted/unused entries are omitted from the returned listing; file flags, starting track/sector, filename bytes, type, and block count are retained.

Directory and file chains are protected by loop detection and track/sector bounds checks. A malformed image therefore fails explicitly instead of hanging the emulator or reading arbitrary bytes.

### File extraction

Normal file sectors contribute bytes `$02-$FF` (254 payload bytes). On the final sector the next-track byte is zero and the second link byte identifies the last used byte position, so `$FF` represents a full 254-byte payload and `$01` represents an empty final payload.

The parser does not reinterpret PRG contents. `readPrg()` only enforces that the directory entry is a PRG and returns the exact chained file bytes, including the two-byte PRG load address.

### Host-assisted loading versus drive emulation

The browser may use `D64Image.readPrg()` as an accelerated convenience path. That operation does not execute KERNAL IEC routines, does not emulate drive DOS, and does not generate fake serial traffic. The physical IEC abstraction lives separately in `core/iec` so a later 1541 phase can run a second CPU/VIA/drive model against the real bus without replacing this parser.
