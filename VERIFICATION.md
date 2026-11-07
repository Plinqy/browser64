# Verification — v0.3

This file records verification performed on the v0.3 source tree.

## Result

**PASS for the TypeScript and direct runtime verification available in this execution environment.**

The npm registry was not reachable: `npm install` timed out, so the repository's pinned Vite/Vitest packages could not be installed and `npm test` / `npm run build` could not honestly be claimed as executed here.

To compensate, the project was checked with the locally available TypeScript compiler and an independently compiled CommonJS copy of the complete emulator core was exercised with direct Node assertions.

## Strict TypeScript

The browser source passed strict source-level compilation with the repository's relevant compiler constraints:

- `strict`
- `noUncheckedIndexedAccess`
- `exactOptionalPropertyTypes`
- `noFallthroughCasesInSwitch`
- `noImplicitOverride`
- `noUnusedLocals`
- `noUnusedParameters`

Result: **PASS**

The complete source + test tree was also typechecked using temporary local declarations for `vitest`, `vitest/config`, and the Node modules referenced by the external test. Those declarations were verification-only and are not included in the repository.

Result: **PASS**

## v0.3 CIA Direct Runtime Assertions

An independently compiled copy of `src/core` was exercised directly under Node. Assertions covered:

- 6526 reset port/timer/interrupt state
- DDR/output-latch/external-pin resolution
- Timer A continuous count, zero underflow, and latch reload
- Timer A one-shot stop behavior
- Timer B counting Timer A underflows
- pending interrupt source behavior while masked
- enabling/disabling ICR masks after an interrupt source is already pending
- ICR `peek()` preserving pending state
- ICR `read()` acknowledging sources and releasing IRQ
- Timer A CNT input mode
- FLAG high-to-low edge detection
- SDR serial input over eight CNT rising edges
- 60 Hz TOD divider
- 11:59:59.9 AM -> 12:00:00.0 PM rollover
- TOD hours-read latching and tenths-read release
- TOD alarm match interrupt
- keyboard matrix forward scan
- keyboard matrix reverse scan
- CIA1 keyboard + joystick active-low combination
- CIA2 inverted PA0/PA1 VIC bank selection
- all four VIC bank bases
- machine-level CIA cycle advancement from CPU instruction cycles
- CIA1 -> 6510 IRQ delivery
- CIA2/RESTORE FLAG -> 6510 NMI edge delivery

Result: **PASS**

## v0.2 Regression Smoke Assertions

Because the supplied archive was the v0.1 tree, the previously completed v0.2 machine/banking layer was restored before v0.3 was applied. A direct regression pass covered:

- all eight LORAM/HIRAM/CHAREN combinations
- BASIC/KERNAL/character/I/O selection
- RAM-under-ROM writes
- synthetic KERNAL reset vector execution
- retained official opcode table count of 151

Result: **PASS**

## External Klaus CPU Test

The v0.3 artifact does not redistribute the third-party Klaus binary. The CPU implementation itself is unchanged from the previously verified v0.2 core, which had reached the Klaus NMOS 6502 functional suite success trap `$3469` after 30,646,177 instructions.

For a local regression, place a legal copy of `6502_functional_test.bin` in `tests/assets/` and run `npm test`. The external Vitest case automatically enables when the file exists.

## Known Verification Boundary

v0.3 does not claim transistor-level or Lorenz/VICE CIA timing-suite compatibility. The implementation advances CIA state at individual PHI2 counts, but those counts are currently delivered after each complete CPU instruction. Consequently an interrupt that would arise halfway through a real 6510 instruction becomes visible at the next instruction boundary, which is correct for the current scheduler abstraction but not yet sufficient for all cycle-race tests.

Timer-A-driven serial output waveform timing is also intentionally deferred. Serial input shifting is implemented and tested.

## Recommended Local Commands

With registry access:

```bash
npm install
npm run build
npm test
```

If the Klaus binary is available, copy it to `tests/assets/6502_functional_test.bin` before `npm test`.
