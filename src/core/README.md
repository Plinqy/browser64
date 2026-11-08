# Core Emulator Architecture

## Overview

`src/core` is the browser-independent Commodore 64 hardware model. It does not depend on DOM, Canvas, Web Audio, host timers, keyboard-event names, file pickers, or wall-clock state.

Version 0.10 contains:

- `cpu/` — cycle-steppable MOS 6510/NMOS 6502 engine for all official and stable undocumented opcodes, with interrupt polling and JAM behavior.
- `memory/` — CPU banking, shared data-bus/open-bus state, and the VIC's independent memory view.
- `rom/` — BASIC, KERNAL, and character ROM ownership/validation.
- `program/` — browser-independent PRG parsing and load metadata.
- `disk/` — immutable D64 geometry, directory, sector, error-table, and linked-file parsing.
- `iec/` — open-collector ATN/CLOCK/DATA serial-bus foundation wired to CIA2.
- `io/` — `$D000-$DFFF` routing, color RAM, joystick pin state, and chip composition.
- `cia/` — functional MOS 6526 CIAs and physical keyboard matrix.
- `sid/` — cycle-clocked MOS 6581/8580 voices, ADSR, DACs, filter/mixer, bus behavior, and PCM sampling.
- `vic/` — raster memory sequencer, all five legal display modes, hardware sprites, collisions, and BA/AEC arbitration.
- `machine/` — PAL/NTSC-profiled one-cycle scheduler, interrupt wiring, ROM startup, and PRG/joystick host-facing machine operations.
- `debugger/` — side-effect-free disassembly and trace formatting.

Every directory under `src/core` contains a README describing overview, architecture, and implementation choices.

## Architecture

```text
Host / browser
     |
     | bytes / physical input / requested time
     v
 C64Machine  <------------- master system cycle -------------+
     |                                                        |
     +-- Cpu6510 -- read/write --> C64Bus CPU view            |
     |       ^                                                |
     |       +------------- BA / AEC -------------------------+-- VIC-II
     |                                                           |
     +-- SID 6581/8580
     |      +-- 3 oscillators / ADSR
     |      +-- shared filter / PCM
     |
     +-- CIA1 / CIA2                                             +--> VIC memory view
     |      ^      |                                             |       |
     |      |      +--> IEC ATN/CLOCK/DATA                       |       +-- c/g fetch pipeline
     |      +-- keyboard + joystick pins                         |       +-- sprites
     |                                                           |
     +-- PRG -> physical RAM                                     +--> framebuffer
     +-- D64 -> directory/file extraction -> PRG
     |
     +-- Debugger / trace
```

## Implementation Discussion

### Host/core boundary

The browser may translate `KeyboardEvent` names, pace frames using `requestAnimationFrame`, and read local files. None of those concepts enter `src/core`. The core receives physical matrix closures, active-low joystick switches, explicit RESTORE edges, ROM/PRG/D64 bytes, and explicit clock requests.

### Startup and program loading

Power-on remains hardware-driven: the 6510 reads `$FFFC/$FFFD` through the mapped KERNAL ROM. There is no ROM boot trap or shortcut.

A PRG is treated as a load container rather than an executable. The parser exposes its little-endian load address and payload. `C64Machine` copies the payload into physical RAM and only changes the PC when a host explicitly requests a machine-code launch.

D64 support is intentionally a separate storage layer: `D64Image` parses 1541 sector geometry, BAM metadata, directory chains, and linked file sectors. Host-assisted D64 loading extracts a real PRG byte stream and passes it through the same PRG loader. It does not masquerade as serial I/O.

### Timing model

CPU instructions are decomposed into bus-cycle micro-operations and interleaved with VIC/SID/CIA time one C64 system cycle at a time. IRQ/NMI are sampled at the NMOS polling point near instruction completion rather than at an artificial instruction boundary. A machine timing profile supplies the PAL or NTSC system clock and raster geometry to the VIC and SID. The browser's real-time loop merely asks the deterministic core to run enough frames; host elapsed time never changes chip state directly.

### IEC wiring

CIA2 PA3/PA4/PA5 feed the C64 motherboard's inverting open-collector ATN/CLOCK/DATA drivers; PA6/PA7 read the resolved CLOCK/DATA levels. `IecBus` models that wired-low electrical relationship independently from any future drive implementation.

### Interrupt wiring

CIA1 and VIC-II share IRQ. CIA2's interrupt output produces NMI edges. RESTORE is a separate motherboard NMI source and is intentionally not represented as a CIA2 FLAG transition.

### Testing philosophy

Tests cover chip-local behavior, machine integration, program containers, and host-input translation independently. Browser-specific DOM rendering remains thin so most correctness can be exercised in Node without a simulated browser.
