# Core Emulator Architecture

## Overview

`src/core` is the browser-independent Commodore 64 hardware model. It does not depend on DOM, Canvas, Web Audio, host timers, keyboard-event names, file pickers, IndexedDB, or wall-clock state.

The v1.0.1 core contains:

- `cpu/` — cycle-steppable MOS 6510/NMOS 6502 engine for all documented and stable undocumented opcodes, including interrupt polling and JAM behavior.
- `memory/` — CPU PLA banking, cartridge GAME/EXROM participation, shared data-bus/open-bus state, physical RAM, and the VIC's independent memory view.
- `rom/` — BASIC, KERNAL, and character ROM ownership/validation.
- `program/` — browser-independent PRG parsing and load metadata.
- `tape/` — cycle-timed TAP/Datasette playback/recording plus read-only T64 container parsing.
- `disk/` — mutable D64 sector media and raw G64 full/half-track media.
- `iec/` — open-collector ATN/CLOCK/DATA/RESET serial bus shared by CIA2 and the 1541.
- `drive1541/` — independent 1 MHz drive CPU, two 6522 VIAs, GCR mechanism, writable D64/G64 media, and IEC board wiring.
- `via/` — reusable MOS 6522 model used by the 1541.
- `cartridge/` — expansion-port contract, generic/static cartridges, supported banked CRT families, and IRQ/NMI/DMA/FREEZE hooks.
- `io/` — `$D000-$DFFF` routing, color RAM, joystick pin state, and chip composition.
- `cia/` — MOS 6526 CIAs and physical keyboard matrix.
- `sid/` — cycle-clocked MOS 6581/8580 voices, ADSR, DACs, filter/mixer, bus behavior, and PCM sampling.
- `vic/` — raster memory sequencer, all five legal display modes, hardware sprites, collisions, and BA/AEC arbitration.
- `machine/` — PAL/NTSC-profiled one-cycle scheduler, motherboard interrupt wiring, ROM startup, 1541 clock integration, save states, and host-facing machine operations.
- `debugger/` — side-effect-free disassembly, monitor stops, history, inspection, and state editing.

Every hardware directory under `src/core` has a README describing the current architecture and its accuracy boundary.

## Architecture

```text
Host / browser
     |
     | bytes / physical input / requested emulated time
     v
 C64Machine  <------------------ master system cycle -------------------+
     |                                                                  |
     +-- Cpu6510 -- read/write --> C64Bus CPU view                      |
     |       ^                                                          |
     |       +---------------- BA / AEC --------------------------------+-- VIC-II
     |                                                                     |
     +-- SID 6581/8580                                                       +--> VIC memory view
     |      +-- 3 oscillators / ADSR                                         |       |
     |      +-- shared filter / PCM                                           |       +-- c/g fetch pipeline
     |                                                                         |       +-- sprites
     +-- CIA1 / CIA2                                                            |
     |      ^      |                                                            +--> framebuffer
     |      |      +---------------------> IEC bus <----------------+
     |      +-- keyboard + joystick pins                            |
     |                                                              +-- 1541 CPU + VIA0/VIA1
     |                                                                      |
     +-- expansion/cartridge GAME/EXROM + IO1/IO2 + IRQ/NMI                +-- D64/G64 mechanism
     +-- Datasette TAP signal path
     +-- PRG / T64 / host-assisted D64 -> canonical PRG loader
     +-- debugger / save-state boundary
```

## Implementation Discussion

### Host/core boundary

The browser may translate `KeyboardEvent` names, pace frames using `requestAnimationFrame`, persist files in IndexedDB, and read local files. None of those concepts enter `src/core`. The core receives physical matrix closures, active-low joystick switches, explicit RESTORE edges, user-supplied byte images, and explicit clock requests.

### Startup and program loading

Power-on is hardware-driven: the 6510 reads `$FFFC/$FFFD` through the mapped KERNAL ROM. There is no ROM boot trap.

A PRG is a load container, not an implied entry point. `C64Machine.loadPrg()` copies the payload to physical RAM and optionally repairs BASIC pointers for the normal `$0801` case. `startAt()` is an explicit host/debugger action for machine-code files whose entry point is intentionally known.

D64 and T64 host-assisted loading both extract a canonical PRG byte stream and pass it through the same loader. Those convenience paths do not masquerade as serial or tape hardware. The separate 1541/IEC and TAP/Datasette paths execute the corresponding emulated hardware behavior.

### Timing model

CPU instructions are decomposed into bus-cycle micro-operations and interleaved with VIC, SID, CIA, Datasette, and rationally accumulated 1 MHz 1541 time one C64 system cycle at a time. IRQ/NMI are sampled at the NMOS polling point near instruction completion. A timing profile supplies PAL or later-NTSC clocks/raster geometry to the motherboard; host elapsed time never directly changes chip state.

### IEC and 1541

CIA2 PA3/PA4/PA5 feed the motherboard's inverting open-collector ATN/CLOCK/DATA drivers and PA6/PA7 read resolved CLOCK/DATA. `IecBus` models the wired-low lines independently from the drive. `C1541Drive` attaches its own endpoint, executes a user-supplied DOS ROM on an independent drive CPU/VIAs, and accesses D64/G64 through the mechanism/GCR layer.

### Expansion port

`C64Bus` combines processor-port PLA rules with cartridge GAME/EXROM lines. ROML/ROMH and IO1/IO2 are routed through the expansion device interface. Expansion IRQ and NMI are integrated with motherboard interrupt sources. DMA is exposed electrically but active bus stealing remains outside the v1.0 claim.

### Save-state boundary

The machine can serialize the C64 motherboard at a safe 6510 instruction boundary. The independently clocked 1541 CPU/VIA electronics are intentionally reset on restore rather than serializing a drive at an arbitrary microcycle; mounted media/mechanism state remains attached.

### Testing philosophy

Tests cover chip-local behavior, machine integration, storage containers, true-drive wiring, user-facing loading paths, state serialization, and host-input translation independently. Browser DOM/audio/persistence adapters are kept thin so correctness is primarily exercised in Node. The release gate adds an explicit BASIC/D64/T64 smoke suite and a documentation/version audit.
