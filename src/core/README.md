# Core Emulator Architecture

## Overview

`src/core` is the browser-independent Commodore 64 hardware model. It does not depend on DOM, Canvas, Web Audio, host timers, keyboard-event names, file pickers, or wall-clock state.

Version 0.8 contains:

- `cpu/` — cycle-steppable MOS 6510/NMOS 6502 engine for all 151 official opcodes.
- `memory/` — CPU banking plus the VIC's independent memory view.
- `rom/` — BASIC, KERNAL, and character ROM ownership/validation.
- `program/` — browser-independent PRG parsing and load metadata.
- `io/` — `$D000-$DFFF` routing, color RAM, joystick pin state, and chip composition.
- `cia/` — functional MOS 6526 CIAs and physical keyboard matrix.
- `sid/` — cycle-clocked MOS 6581/8580 voices, ADSR, DACs, filter/mixer, bus behavior, and PCM sampling.
- `vic/` — raster memory sequencer, all five legal display modes, hardware sprites, collisions, and BA/AEC arbitration.
- `machine/` — one-cycle master scheduler, interrupt wiring, ROM startup, and PRG/joystick host-facing machine operations.
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
     |      ^                                                    |       |
     |      +-- keyboard + joystick pins                         |       +-- c/g fetch pipeline
     |                                                           |       +-- sprites
     +-- PRG -> physical RAM                                     +--> framebuffer
     |
     +-- Debugger / trace
```

## Implementation Discussion

### Host/core boundary

The browser may translate `KeyboardEvent` names, pace frames using `requestAnimationFrame`, and read local files. None of those concepts enter `src/core`. The core receives physical matrix closures, active-low joystick switches, explicit RESTORE edges, ROM bytes, PRG bytes, and explicit clock requests.

### Startup and program loading

Power-on remains hardware-driven: the 6510 reads `$FFFC/$FFFD` through the mapped KERNAL ROM. There is no ROM boot trap or shortcut.

A PRG is treated as a load container rather than an executable. The parser exposes its little-endian load address and payload. `C64Machine` copies the payload into physical RAM and only changes the PC when a host explicitly requests a machine-code launch.

### Timing model

CPU instructions are decomposed into bus-cycle micro-operations and interleaved with VIC/SID/CIA time one C64 system cycle at a time. The browser's real-time loop merely asks the deterministic core to run enough frames; host elapsed time never changes chip state directly.

### Interrupt wiring

CIA1 and VIC-II share IRQ. CIA2's interrupt output produces NMI edges. RESTORE is a separate motherboard NMI source and is intentionally not represented as a CIA2 FLAG transition.

### Testing philosophy

Tests cover chip-local behavior, machine integration, program containers, and host-input translation independently. Browser-specific DOM rendering remains thin so most correctness can be exercised in Node without a simulated browser.
