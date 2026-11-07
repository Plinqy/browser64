# Verification — v0.6

This file records verification performed while preparing the combined v0.6 VIC-II fetch/render + graphics/sprite patch.

## Scope

v0.6 intentionally combines the two planned VIC-II phases:

1. timed display-memory sequencing and live raster-fed pixel generation,
2. legal graphics modes plus the eight-sprite engine.

The major implementation changes are confined to the VIC-II core, its browser/debug presentation, documentation, and tests. The verified v0.5 `Cpu6510` implementation is unchanged.

## Strict TypeScript

The complete source and test tree was checked under the project's strict TypeScript settings:

- `strict`
- `noUncheckedIndexedAccess`
- `exactOptionalPropertyTypes`
- `noFallthroughCasesInSwitch`
- `noImplicitOverride`
- `noUnusedLocals`
- `noUnusedParameters`

The sandbox cannot complete `npm install`, so temporary local declaration shims for Vitest, Vite's CSS module declarations, and the small Node APIs used by the optional Klaus test were used only for verification. They are removed before packaging and are not part of the patch.

Result: **PASS**.

## Compiled unit-test regression

All normal unit tests except the optional external-binary Klaus test were compiled to CommonJS and executed with a minimal verification runner implementing the Vitest assertions used by this repository.

Result:

```text
112 passed
0 failed
```

This covers the pre-existing CPU, memory, ROM, debugger, CIA, I/O, machine, and VIC tests plus the new v0.6 suites.

The project's real `npm run test` remains the authoritative local check because the verification runner is intentionally not a replacement for Vitest itself.

## VIC memory sequencer assertions

Focused tests verify:

- first default PAL bad line at raster 51 for YSCROLL=3,
- 40 c-accesses feed the same line's 40 g-accesses,
- VC advances across a 40-column display line,
- VC resets from VCBASE for subsequent raster lines,
- RC advances through the eight character rows,
- VCBASE advances by 40 after the eighth row,
- display state exits until the next bad line,
- XSCROLL shifts generated display pixels.

Result: **PASS**.

## Graphics-mode assertions

Pixel-level tests verify all five documented VIC-II modes:

- standard text,
- multicolor text,
- standard bitmap,
- multicolor bitmap,
- ECM text.

The tests cover character/bitmap address selection, Color RAM use, screen-nibble colors, background registers, multicolor pair decoding, and ECM character/background selection.

The illegal ECM combinations are also checked to produce black display data while the sequencer remains active.

Result: **PASS**.

## Sprite assertions

Focused tests verify:

- video-matrix sprite pointer lookup,
- hires sprite decoding,
- multicolor sprite decoding,
- X expansion,
- Y expansion source-row repetition,
- fixed lower-numbered sprite priority,
- sprite/background priority,
- sprite-sprite collision latching,
- sprite-background collision latching,
- read-to-clear `$D01E/$D01F`,
- collision IRQ assertion,
- sprite BA/AEC request timing.

Result: **PASS**.

## Machine-level sprite DMA arbitration

A KERNAL NOP stream is advanced to a non-bad raster line with only sprite 0 active. The PAL scheduler is checked for the single-sprite request window:

- BA prevents a read-only CPU stream from progressing for five system cycles,
- `cpuStallCycles` increases by five,
- master time continues,
- CPU execution resumes after the request window.

This implements the 3-cycle BA warning plus two stolen PHI2 cycles for a single active sprite group. Contiguous sprite request windows merge naturally through the same BA/AEC logic.

Result: **PASS**.

## Previous-phase regression

The normal v0.5 unit suites were included in the 112-test compiled regression and all passed.

The v0.5 CPU source was also compared directly against the v0.6 tree and is unchanged, so the prior 151-opcode/755-case CPU differential verification remains applicable to this patch.

## npm/Vitest limitation in this sandbox

`npm install --ignore-scripts --no-audit --no-fund` was attempted and timed out because the sandbox cannot reliably reach the package registry. Therefore actual Vite/Vitest execution is not claimed here.

Run after applying the patch on the development machine:

```bash
npm install
npm run build
npm run test
```

The optional Klaus functional test remains available through `tests/cpu/KlausFunctional.test.ts` when `tests/assets/6502_functional_test.bin` is supplied. The binary is not redistributed.

## Known accuracy boundary after v0.6

v0.6 is a major VIC-II accuracy step, but it still does **not** claim complete dot/half-cycle accuracy:

- sprite line data is staged at raster-line start while PAL BA/AEC request windows model CPU-visible DMA cost; individual half-cycle p/s accesses are not exposed separately,
- border transitions are modeled at display-window/raster granularity rather than every dot-clock transition,
- sprite crunch/expansion flip-flop tricks are not modeled,
- light-pen and VIC open-bus behavior are not modeled,
- NTSC sprite access placement is still a conservative derivative of the PAL schedule,
- undocumented VIC-II quirks remain compatibility work.
