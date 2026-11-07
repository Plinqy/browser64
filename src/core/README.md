# Core Emulator Architecture

## Overview

`src/core` is the browser-independent Commodore 64 hardware model. It must not depend on DOM, Canvas, Web Audio, timers, or host wall-clock state.

Version 0.5 contains:

- `cpu/` — cycle-steppable MOS 6510/NMOS 6502 engine for all 151 official opcodes.
- `memory/` — CPU banking plus the VIC's independent memory view.
- `rom/` — BASIC, KERNAL, and character ROM ownership/validation.
- `io/` — `$D000-$DFFF` routing, color RAM, SID placeholder, and chip composition.
- `cia/` — functional MOS 6526 CIAs and keyboard matrix.
- `vic/` — raster/text core plus bad-line BA/AEC and c-access DMA foundation.
- `machine/` — one-cycle master scheduler and interrupt/bus arbitration.
- `debugger/` — side-effect-free disassembly and trace formatting.

Every directory under `src/core` contains a README describing overview, architecture, and implementation choices.

## Architecture

```text
Host / browser
     |
     v
 C64Machine  <--------- master system cycle --------+
     |                                             |
     +-- Cpu6510 -- read/write --> C64Bus CPU view |
     |       ^                                     |
     |       +---------- BA / AEC -----------------+-- VIC-II
     |                                                |
     +-- CIA1 / CIA2                                  +--> VIC memory view
     |
     +-- Debugger / trace
```

The CPU and VIC intentionally have different memory views. The VIC cannot see CPU BASIC/KERNAL/I/O banking and instead uses CIA2-selected 16 KiB banks plus its character-ROM shadow rules.

## Implementation Discussion

### Timing model

The machine no longer executes an instruction atomically and then replays its duration. CPU instructions are decomposed into bus-cycle micro-operations and interleaved with VIC/CIA time one C64 system cycle at a time.

This allows VIC-II BA/RDY holds to stop CPU read cycles in the middle of an instruction. AEC then explicitly represents VIC ownership of the PHI2 bus. CPU cycle count and master system-cycle count can therefore diverge on bad lines.

### Determinism

Core code has no wall-clock or random dependencies. Every clock edge is advanced explicitly. TOD input is injected explicitly. Browser scheduling remains entirely outside the core.

### Testing philosophy

Timing changes are tested at three levels:

1. CPU micro-cycle behavior and instruction compatibility,
2. VIC-local BA/AEC/bad-line/c-access behavior,
3. machine-level CPU stalls and shared-clock integration.

The instruction-granular `Cpu6510.step()` API remains available so the existing opcode and external functional-test coverage can continue to validate architectural CPU behavior independently of the C64 scheduler.
