# Verification — v0.4

This file records verification performed on the v0.4 source tree.

## Result

**PASS for strict TypeScript and direct runtime verification available in this execution environment.**

`npm install` was attempted but the package registry did not respond before the execution timeout. The repository's pinned Vite/Vitest dependencies therefore could not be installed here, so `npm test` and `npm run build` are not claimed as executed.

The emulator source was instead checked with the locally available TypeScript compiler, the complete source/test tree was typechecked with verification-only dependency declarations, and an independently compiled CommonJS copy of `src/core` was exercised directly under Node.

## Strict TypeScript

The complete browser/core source passed strict compilation with the repository's relevant constraints:

- `strict`
- `noUncheckedIndexedAccess`
- `exactOptionalPropertyTypes`
- `noFallthroughCasesInSwitch`
- `noImplicitOverride`
- `noUnusedLocals`
- `noUnusedParameters`

Result: **PASS**

The complete `src` + `tests` + `vite.config.ts` tree was also typechecked using temporary local declarations for `vitest`, `vitest/config`, and the Node built-ins referenced by the optional Klaus test. Those declarations are verification-only and are not included in the project.

Result: **PASS**

## v0.4 VIC-II Direct Runtime Assertions

An independently compiled copy of `src/core` was exercised directly under Node. Assertions covered:

- PAL 6569 timing profile of 63 cycles per line
- 312 PAL raster lines per frame
- 19,656 cycles per PAL frame
- raster line/cycle wrap behavior
- frame counter advancement
- nine-bit raster compare foundation
- raster interrupt latching
- `$D019` IRQ status and write-one-to-clear acknowledgement
- `$D01A` raster interrupt masking
- live raster high-bit read through `$D011`
- live raster low-byte read through `$D012`
- CIA2-selected VIC bank changes
- VIC character-ROM shadowing in banks 0 and 2
- RAM visibility instead of character ROM in VIC banks 1 and 3
- standard-text screen-code fetch
- character-glyph fetch
- color-RAM nibble fetch
- border/background color rendering
- display-disable border behavior
- machine master-cycle accounting
- VIC raster IRQ delivery to the 6510 IRQ input

Result: **PASS**

## v0.3 Regression Assertions

The v0.3 direct runtime assertion suite was rerun against the v0.4 compiled core. It covers the MOS 6526 timer, ICR, FLAG, CNT, serial-input, TOD/alarm, keyboard matrix, joystick wiring, CIA2 VIC-bank selection, CIA1 IRQ delivery, and CIA2/RESTORE NMI integration.

Result: **PASS**

## v0.2 Regression Assertions

The v0.2 machine/banking smoke suite was rerun against the v0.4 compiled core. It covers all eight LORAM/HIRAM/CHAREN combinations, ROM/I/O selection, RAM-under-ROM writes, the official opcode table count, and synthetic KERNAL reset-vector execution.

Result: **PASS**

## CPU Regression Boundary

No files under `src/core/cpu/` were changed by v0.4. The CPU implementation therefore remains byte-for-byte the previously validated core that reached the Klaus NMOS 6502 functional-suite success trap `$3469` after 30,646,177 instructions.

The project does not redistribute the Klaus binary. For a local regression, place a legal copy of `6502_functional_test.bin` in `tests/assets/` and run `npm test`.

## Known Timing Boundary

v0.4 introduces a real one-system-cycle machine clock for VIC-II and both CIAs, but the CPU is still instruction-granular. `Cpu6510.step()` completes all reads/writes for an instruction before `C64Machine` replays the returned cycle count through the peripheral clock.

Consequences:

- raster counters and peripheral elapsed-cycle totals are deterministic;
- raster IRQs become visible at instruction boundaries;
- a CPU write to `$D020`, `$D011`, etc. is not yet positioned on its exact bus cycle;
- VIC BA/AEC stalls cannot yet pause a CPU read mid-instruction;
- bad-line, sprite-DMA, stable-raster, and border-opening timing are **not** claimed cycle-exact.

This is the intended handoff point for the next phase: a resumable CPU bus-cycle/micro-operation execution model plus VIC bus arbitration.

## Framebuffer Boundary

The v0.4 framebuffer is a 384×272 logical presentation with a centered 320×200 standard text area and border. It is not a literal 504-dot PAL raster capture. Raster timing and framebuffer presentation are intentionally separated so later cycle/dot rendering can replace the presentation layer without redesigning the master scheduler.

Only standard hires character mode is rendered in v0.4. Bitmap, multicolor, ECM, sprites, fine scrolling, and border tricks remain deferred.

## Recommended Local Commands

With registry access:

```bash
npm install
npm run build
npm test
```

If the Klaus binary is available, copy it to `tests/assets/6502_functional_test.bin` before `npm test`.
