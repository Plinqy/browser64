# Core Emulator Architecture

## Overview

`src/core` is the browser-independent Commodore 64 hardware model. It must not depend on DOM, Canvas, Web Audio, timers, or host wall-clock state.

Version 0.6 contains:

- `cpu/` — cycle-steppable MOS 6510/NMOS 6502 engine for all 151 official opcodes.
- `memory/` — CPU banking plus the VIC's independent memory view.
- `rom/` — BASIC, KERNAL, and character ROM ownership/validation.
- `io/` — `$D000-$DFFF` routing, color RAM, SID placeholder, and chip composition.
- `cia/` — functional MOS 6526 CIAs and keyboard matrix.
- `vic/` — raster memory sequencer, all five legal display modes, hardware sprites, collisions, and BA/AEC arbitration.
- `machine/` — one-cycle master scheduler and interrupt/bus arbitration.
- `debugger/` — side-effect-free disassembly and trace formatting.

Every directory under `src/core` contains a README describing overview, architecture, and implementation choices.

## Architecture

```text
Host / browser
     |
     v
 C64Machine  <------------- master system cycle -------------+
     |                                                        |
     +-- Cpu6510 -- read/write --> C64Bus CPU view            |
     |       ^                                                |
     |       +------------- BA / AEC -------------------------+-- VIC-II
     |                                                           |
     +-- CIA1 / CIA2                                             +--> VIC memory view
     |                                                           |       |
     |                                                           |       +-- c/g fetch pipeline
     |                                                           |       +-- sprites
     +-- Debugger / trace                                        +--> framebuffer
```

The CPU and VIC intentionally have different memory views. The VIC cannot see CPU BASIC/KERNAL/I/O banking and instead uses CIA2-selected 16 KiB banks plus its character-ROM shadow rules.

## Implementation Discussion

### Timing model

CPU instructions are decomposed into bus-cycle micro-operations and interleaved with VIC/CIA time one C64 system cycle at a time. VIC-II BA/RDY holds can stop CPU read cycles in the middle of an instruction; AEC explicitly represents VIC ownership of the PHI2 bus.

v0.6 keeps that motherboard timing boundary and makes the video path consume it: bad-line matrix fetches and g-access display fetches happen at defined raster cycles rather than through a frame-time memory snapshot.

### Pixel state is derived from hardware state

The framebuffer is not a second source of truth. It is output derived from:

- VIC register state,
- CIA2-selected VIC memory,
- c-access video/color latches,
- VC/VCBASE/RC sequencer state,
- graphics mode decoding,
- sprite registers/data,
- sprite priority/collision classification.

Foreground/background classification is tracked independently from palette color because the VIC uses bit-pattern class—not color equality—for sprite priority and collision behavior.

### Determinism

Core code has no wall-clock or random dependencies. Every clock edge is advanced explicitly. TOD input is injected explicitly. Browser scheduling remains entirely outside the core.

### Testing philosophy

Timing changes are tested at several levels:

1. CPU micro-cycle behavior and instruction compatibility,
2. VIC-local raster/bad-line/c-access/g-access behavior,
3. graphics-mode pixel decoding,
4. sprite rendering/priority/collision behavior,
5. machine-level CPU stalls and shared-clock integration.

The instruction-granular `Cpu6510.step()` API remains available so opcode and external functional-test coverage can validate architectural CPU behavior independently of the C64 scheduler.
