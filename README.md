# C64 Browser Emulator

A from-scratch Commodore 64 emulator written in TypeScript for modern web browsers.

The project is built from hardware behavior upward rather than wrapping VICE or another emulator. Version 0.4 adds a timed VIC-II foundation and a real standard-text framebuffer on top of the validated 6510, C64 memory map, and MOS 6526 CIA work from earlier phases.

## v0.4 Status

Implemented:

- all v0.1 6510 CPU/debugger functionality
- all v0.2 C64 processor-port, ROM, RAM-under-ROM, and I/O banking functionality
- all v0.3 MOS 6526 CIA, keyboard-matrix, joystick-pin, IRQ/NMI, TOD, and VIC-bank functionality
- real VIC-II CPU-visible register model replacing the old register-file placeholder
- PAL MOS 6569 timing profile: 63 cycles/line × 312 lines/frame
- NTSC MOS 6567R8 timing profile defined for future machine selection
- one-system-cycle machine clock boundary
- live VIC raster line/cycle/frame counters
- 9-bit raster compare using `$D011/$D012`
- raster IRQ status/mask/acknowledge behavior through `$D019/$D01A`
- CIA2-selected VIC 16 KiB memory banks
- VIC-specific character-ROM shadowing in banks 0 and 2
- `$D018` screen-matrix and character-generator pointers
- fixed color-RAM fetches
- border/background colors from `$D020/$D021`
- deterministic 40×25 standard-hires-text renderer
- browser-independent 4-bit color-index framebuffer
- Canvas display frontend
- browser **Run Frame** control
- VIC raster/IRQ/pointer debugger status

Still intentionally deferred:

- CPU micro-operation execution and exact placement of reads/writes inside instructions
- VIC BA/AEC bus stealing and CPU stalls
- bad lines and real c-access/g-access timing
- sprites and sprite DMA
- bitmap, multicolor, and extended-color modes
- fine-scroll/border flip-flop tricks
- light pen and collision registers
- exact open-bus behavior
- analog VIC color generation
- SID audio
- IEC/1541 emulation
- cartridge GAME/EXROM modes
- undocumented NMOS CPU opcodes

## Requirements

- Node.js 22.12 or newer
- npm

## Run

```bash
npm install
npm run dev
```

Open the local URL printed by Vite.

Supply your own unheadered ROM images:

- BASIC: exactly 8192 bytes
- KERNAL: exactly 8192 bytes
- character generator: exactly 4096 bytes

The project does not redistribute Commodore ROM images. Once all three files are loaded, **Power On** reads the real reset vector at `$FFFC/$FFFD` through the mapped KERNAL ROM.

The VIC display is now visible in the browser. **Run Frame** executes whole CPU instructions until the VIC crosses into the next frame, then redraws the current standard-text state.

## Test

```bash
npm test
```

Optional watch mode:

```bash
npm run test:watch
```

The external Klaus Dormann functional test remains optional. If you possess the 64 KiB `6502_functional_test.bin`, place it at:

```text
tests/assets/6502_functional_test.bin
```

## Core Documentation

Every directory under `src/core/` contains its own `README.md` covering **Overview**, **Architecture**, and **Implementation Discussion**.

Current core documentation:

- `src/core/README.md`
- `src/core/cpu/README.md`
- `src/core/debugger/README.md`
- `src/core/memory/README.md`
- `src/core/rom/README.md`
- `src/core/io/README.md`
- `src/core/machine/README.md`
- `src/core/cia/README.md`
- `src/core/vic/README.md`

When a new core subsystem directory is added, its README is part of the same change.

## v0.4 Architecture

```text
Browser UI / Canvas
        |
        v
+-------------------+
|    C64Machine     |
| master cycle tick |
+---------+---------+
          |
   +------+------+----------------+
   |             |                 |
+--v---+     +---v---+         +---v---+
|6510  |     |VIC-II |         | CIAs  |
+--+---+     +---+---+         +---+---+
   |             |                 |
   +-------> C64Bus <--------------+
                 |
       +---------+----------+
       |                    |
 CPU memory view       VIC 14-bit view
 RAM/ROM/I/O banking   CIA2 bank + char ROM shadow
```

The CPU and VIC do **not** share one logical memory read path. That distinction matters on a real C64: the VIC cannot see CPU I/O or BASIC/KERNAL ROM, and the character ROM appears to the VIC in banks 0 and 2 independently of the 6510 `$0001` banking state.

## Timing Model

`C64Machine.tickSystemCycle()` is now the master hardware clock boundary. One call advances the VIC-II and both CIAs by one C64 system cycle and then synchronizes interrupt lines.

`C64Machine.step()` still calls `Cpu6510.step()`, which executes an entire instruction atomically, and then replays the returned cycle count through `tickSystemCycle()`. Therefore raster/peripheral time is cycle-counted, but a CPU write is not yet positioned on its exact intra-instruction cycle.

That is intentional. The next timing step is to evolve the 6510 executor into resumable micro-operations so VIC BA/AEC can pause CPU read cycles on bad lines and sprite DMA without replacing the machine/device architecture built here.

## Roadmap

### v0.5 — VIC-II bus arbitration and bad-line foundation

- CPU micro-operation / bus-cycle execution boundary
- BA/AEC/RDY-style CPU stalling
- bad-line detection and 40 character/color c-accesses
- line-buffered text fetches rather than whole-frame memory sampling
- cycle-positioned VIC register writes
- raster-accurate border/background changes

### Later

- sprites and sprite DMA
- complete VIC-II display modes
- browser keyboard/joystick adapter
- SID/audio worklet
- PRG/T64/D64 media
- IEC bus and 1541 emulation
- cartridge/expansion support
- undocumented CPU opcodes and deep compatibility suites

## Design Rules

1. `src/core` never depends on browser APIs.
2. CPU and VIC memory access use explicit, separate hardware views.
3. Debug inspection never causes emulated hardware side effects.
4. Emulated time advances explicitly; wall-clock time stays outside the core.
5. Timing shortcuts are documented as shortcuts.
6. Temporary chip placeholders are labeled as placeholders, not fake compatibility.
7. Unknown hardware behavior fails visibly rather than being silently invented.
8. Optimize only after correctness tests and profiling identify a hot path.
