# External CPU Test Assets

The emulator source does not redistribute third-party CPU test binaries.

## Klaus Dormann 6502 Functional Test

For the optional external integration test, obtain the current `6502_functional_test.bin` from Klaus Dormann's `6502_65C02_functional_tests` repository and place it here as:

```text
tests/assets/6502_functional_test.bin
```

Then run:

```bash
npm test
```

`tests/cpu/KlausFunctional.test.ts` automatically skips when the binary is absent and runs when it is present.

The current upstream binary is a complete 64 KiB image. Execution begins at `$0400`. The current upstream success trap is a self-jump at `$3469`; failure traps stop at other self-loop addresses. The test asset has its own upstream licensing terms and is intentionally not copied into this project archive.
