# C64 Machine Composition

## Overview

`C64Machine` is the composition root for a stock Commodore 64. It owns the CPU, bus, VIC-II, SID, both CIA chips, debugger interfaces, interrupt wiring, the master system clock, and the machine-level operations a host needs for ROM startup, joystick state, RESTORE, and PRG loading.

The browser is responsible for wall-clock pacing and host-event translation; the machine remains deterministic.

## Architecture

```text
             host requests / physical inputs
                         |
                         v
                   +-----------+
                   | C64Machine|
                   +-----+-----+
                         |
            one master system cycle
                         |
             +-----------+-----------+
             |                       |
        Cpu6510.clock()           VIC-II
             |                    /   \
             |               c/g fetch  sprites
             |                       |
             +--------- C64Bus ------+
                         |
                    SID / CIA1 / CIA2
                         |
              keyboard / joysticks
```

CIA1 and VIC-II share the 6510 IRQ line. CIA2 assertion is edge-converted to NMI. RESTORE supplies an independent NMI edge. VIC memory remains independent of CPU memory banking.

## Implementation Discussion

### Master system cycle

`tickSystemCycle()` advances a complete C64 system cycle: synchronize interrupt inputs, sample VIC BA/AEC, offer one bus cycle to the 6510, advance VIC/SID/CIAs, increment the master clock, and synchronize newly generated interrupt state.

`step()` remains an instruction-granular wrapper and `runFrame()` advances whole instructions until the VIC enters its next frame.

### Real-time execution

There is intentionally no `setInterval`, `performance.now()`, or frame-rate logic in this class. Browser code computes the VIC profile's frame duration and calls `runFrame()` as needed. This preserves deterministic tests and makes future headless execution possible.

### Reset and ROM startup

Power-on clears deterministic RAM, asserts the modeled chip reset paths, and lets `Cpu6510.reset()` read the real KERNAL reset vector at `$FFFC/$FFFD`. No KERNAL routine is bypassed. Warm reset preserves RAM and physical input state while resetting processor/I/O control state. Individual chips retain any internal state that their reset pin does not physically clear; for SID this includes oscillator phase and envelope counter state.

### NMI sources

CIA2's interrupt output and RESTORE are separate sources on the NMI path. CIA2 is edge-detected by the machine. `setRestorePressed()` separately detects the key's press edge and calls `pulseNmi()`; holding RESTORE does not repeatedly retrigger NMI.

### Joysticks

`setJoystickControl()` delegates named directions/fire to `C64Io`, which converts them to active-low CIA1 port pins. The host does not write CIA registers directly.

### PRG loading

`loadPrg()` parses a two-byte little-endian load address, copies payload bytes into physical RAM, and returns load metadata. When the address is `$0801`, it can update BASIC's `TXTTAB`, `VARTAB`, `ARYTAB`, and `STREND` pointers. It does not assume the load address is executable.

`startAt()` is the explicit debugger/host escape hatch for machine-code files whose entry point is known. It deliberately discards any partially scheduled CPU instruction before changing PC.

### SID timing

The SID is owned by `C64Io` and advances during every `tickSystemCycle()`, including cycles where VIC BA/AEC stalls the 6510. This matches the physical SID PHI2 relationship and keeps oscillator/envelope timing independent from CPU bus availability. Browser audio drains SID-produced PCM separately and never drives machine time.
