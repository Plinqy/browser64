# v0.1 Verification Record

## Core type check

The browser-independent core and browser entry point were checked with strict TypeScript settings, including unchecked-index access, exact optional properties, unused symbols, and fallthrough checks.

The artifact environment had a global TypeScript compiler available, so the source was independently type-checked even though the environment could not reach the npm registry to install the project's pinned dependency set.

## Official opcode coverage

`src/core/cpu/opcodes.ts` contains 151 documented NMOS 6502 opcode encodings. A smoke pass instantiated and executed every documented encoding to verify that every opcode maps to a implemented addressing mode and mnemonic handler.

## Decimal arithmetic

ADC and SBC were exhaustively checked over every possible 8-bit accumulator value, every possible 8-bit operand, and both carry-in states:

```text
256 × 256 × 2 × 2 operations = 262,144 decimal-mode cases
```

The check includes invalid packed-BCD inputs, which are useful for verifying actual NMOS behavior rather than only ordinary human-readable BCD values.

Result:

```text
262,144 exhaustive NMOS decimal ADC/SBC cases PASS
```

## Klaus Dormann NMOS 6502 functional test

The CPU was run against the current upstream Klaus Dormann `6502_functional_test` image. For local verification, the 64 KiB image was reconstructed from the official AS65 listing rather than redistributed in this project.

Execution result:

```text
Instructions executed: 30,646,177
Emulated CPU cycles:    96,241,367
Final trap:             $3469
Result:                 PASS
```

The `$3469` self-jump is the current suite's success trap. The suite's `test_case` byte also reached `$F0`, indicating opcode testing completed.

The optional Vitest integration harness is included at `tests/cpu/KlausFunctional.test.ts`. Place the upstream binary at `tests/assets/6502_functional_test.bin` to run that validation locally with `npm test`.

## Timing scope

Passing the CPU functional suite does not mean the emulator is yet cycle-exact at the bus level. Version 0.1 accounts for complete-instruction cycle totals, indexed page-cross penalties, and branch penalties. Individual read/write microcycles, interrupt sampling edge cases, RDY behavior, and VIC-II bus arbitration are deliberately reserved for the cycle-engine milestone.
