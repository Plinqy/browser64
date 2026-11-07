# Verification — v0.5

This file records verification performed while preparing the v0.5 patch.

## Scope

v0.5 changes timing-sensitive code in three places:

- `Cpu6510` now schedules official instructions as individual read/write bus micro-cycles.
- `VicII` now models bad-line detection, BA/AEC timing, and 40 c-accesses.
- `C64Machine` now advances CPU, VIC-II, and both CIAs on one shared system-cycle boundary.

Because the CPU executor was structurally rewritten, verification emphasized regression equivalence as well as the new timing behavior.

## Strict TypeScript

The complete source and test tree was checked under strict TypeScript options matching the project configuration. The sandbox cannot install npm packages, so temporary declaration shims for Vitest/Node modules were used only by the verification command and were not added to the project.

Result: **PASS**.

## Official-opcode differential regression

The v0.5 cycle engine was compared against the verified v0.4 instruction executor for every one of the 151 official opcodes across five deterministic processor/memory states.

For each of the 755 cases the harness compared:

- returned instruction cycle count,
- A/X/Y,
- SP and PC,
- processor status,
- the complete 64 KiB RAM image after execution.

Result: **755 / 755 PASS**.

This verifies that the move from atomic instruction execution to bus-cycle scheduling preserves the existing architectural instruction behavior while changing when accesses occur.

## CPU cycle/RDY/AEC assertions

Focused direct runtime checks verify that:

- an immediate instruction advances one bus cycle at a time,
- RDY-low read cycles do not advance PC/registers or CPU cycle count,
- write cycles complete while RDY/BA is low,
- AEC-low prevents both reads and writes from advancing,
- `step()` still returns the documented instruction cycle count when the bus is continuously available.

Result: **PASS**.

## VIC-II bad-line assertions

Focused direct runtime checks verify PAL bad-line behavior:

- DEN observation on raster `$30`,
- YSCROLL/raster bad-line matching,
- BA low beginning at cycle 12,
- AEC low on cycles 15-54,
- both signals released for cycle 55,
- exactly 40 c-accesses,
- screen-code and color-nibble values latched into the video/color matrix buffers.

Result: **PASS**.

## Machine-level bus arbitration

A KERNAL-ROM NOP stream was run through `C64Machine` to the first normal PAL bad line (`$33` with YSCROLL=3). For a read-only NOP stream:

- master time advanced 43 cycles from raster cycle 12 through 54,
- CPU cycle count did not advance during those 43 cycles,
- `cpuStallCycles` increased by 43,
- CPU execution resumed on cycle 55.

Result: **PASS**.

The 43-cycle hold is intentional: BA goes low three cycles before the 40 AEC-low c-access cycles, and a read-heavy CPU stream stops immediately on BA/RDY.

## Previous-phase runtime regression

The direct v0.2, v0.3, and v0.4 runtime regression harnesses were rerun against the compiled v0.5 core.

Results:

- v0.2 C64 banking/machine smoke assertions: **PASS**
- v0.3 CIA/runtime assertions: **PASS**
- v0.4 VIC text/raster assertions: **PASS**

## npm/Vitest limitation in this sandbox

`npm install` could not complete within the sandbox because package-registry access timed out. Therefore the actual local Vite/Vitest commands could not be executed here.

The patch adds normal Vitest coverage for the new CPU cycle API, VIC bad-line behavior, and machine bus stalls. Run on a normal development machine:

```bash
npm install
npm run build
npm run test
```

The optional Klaus functional test remains available through `tests/cpu/KlausFunctional.test.ts` when `tests/assets/6502_functional_test.bin` is supplied. The binary is not redistributed with this project.

## Known timing boundary after v0.5

v0.5 establishes real CPU/VIC cycle arbitration for bad-line c-accesses, but it is not yet a complete cycle-exact VIC-II:

- sprite DMA is not modeled,
- g-accesses and row-counter/VC/VCBASE timing are not modeled,
- standard-text pixels are still rendered from a frame-time memory snapshot rather than exclusively from the bad-line-latched matrix data,
- border transitions are not dot-positioned,
- obscure IRQ recognition and reset-pin timing remain future CPU timing work.
