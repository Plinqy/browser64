# v0.9 Verification

Version 0.9 is a compatibility-hardening release. It extends the already cycle-stepped v0.8 machine with stable NMOS 6510 undocumented instructions, more faithful interrupt polling, shared motherboard data-bus/open-bus behavior, tighter VIC-II raster interrupt timing, and coherent PAL/NTSC machine profiles.

## CPU compatibility and timing

The opcode table classifies all 256 byte values. The v0.9 core contains:

- all 151 documented NMOS 6502 opcodes;
- stable undocumented opcode families `SLO`, `RLA`, `SRE`, `RRA`, `SAX`, `LAX`, `DCP`, `ISC`, `ANC`, `ALR`, `ARR`, `AXS`, `LAS`, undocumented NOP forms, and the `$EB` SBC alias;
- all twelve JAM/KIL encodings, which halt the CPU until RESET;
- explicit classification of the unstable `XAA`, `LXA`, `AHX`, `TAS`, `SHY`, and `SHX` forms. These throw `UnstableOpcodeError` instead of inventing a chip-independent magic constant or bus result.

IRQ/NMI recognition is sampled at the end of the instruction's penultimate effective cycle. Dynamic branch/page-cross extensions therefore move the poll to the later penultimate cycle. This reproduces the characteristic CLI/SEI/PLP interrupt-mask latency while preserving immediate RTI mask restoration.

The remaining interrupt-race limitations are documented: BRK/IRQ vector hijacking by a late NMI and reset-pin micro-sequencing are not yet claimed cycle exact.

## VIC-II timing and machine profiles

The PAL profile remains MOS 6569 at 63 cycles × 312 lines and 985,248 system cycles/second.

v0.9 adds the MOS 6567R8 NTSC profile at 65 cycles × 263 lines and 1,022,727 system cycles/second. The selected profile is propagated through `C64Machine` to both VIC-II timing and the SID clock so video and sound cannot silently run from different standards.

Raster compare assertion now occurs on the boundary entering cycle 1 of a raster line, with the line-zero exception occurring on the boundary entering cycle 2. Writes to `$D011/$D012` that create a compare match after that line's compare point also latch the raster interrupt. Full instruction/RMW race parity remains future compatibility work.

PAL and 6567R8 NTSC sprite pointer/DMA slots use separate measured schedules instead of applying a one-cycle NTSC approximation.

## Shared data bus / open bus

`C64Bus` keeps the last byte driven on the motherboard data bus. CPU reads/writes and VIC DRAM/character-ROM fetches update that latch. Expansion I/O open-bus reads therefore return the current latch value, and color RAM combines its stored low nibble with the current bus high nibble.

Debugger `peek()` remains side-effect free and does not drive the latch.

This model is intentionally system-cycle granular. Exact phi1/phi2 charge retention and the precise ordering of a VIC fetch versus a CPU open-bus access in the same system cycle remain a documented half-cycle refinement.

## v0.8 SID baseline retained

The v0.8 SID implementation remains intact: cycle-clocked 6581/8580 voices, 15-bit ADSR rate LFSR, noise and synchronization behavior, model-specific DAC/data-bus/write timing, filter routing, deterministic PCM generation, and browser AudioWorklet output. v0.9 only adds the public SID clock-frequency diagnostic used to verify machine-profile propagation.

## Static verification

The complete source and test tree is type-checked in strict mode using the locally available TypeScript compiler plus verification-only ambient declarations for Vitest/Vite/Node packages and the Vite `?url` asset import. Those declarations are never added to the project or patch.

Result: **PASS**

## CPU differential verification

The documented opcode executor is compared against the exact v0.8 CPU for every documented opcode across eight deterministic register/memory states:

```text
151 documented opcodes × 8 states = 1,208 comparisons
```

Each comparison checks cycle count, A/X/Y/SP/PC/status, total CPU cycles, and the complete 64 KiB RAM image. This guards the compatibility work against unintended regressions in the documented instruction set.

Result: **1,208 / 1,208 PASS**

`ARR`, the most irregular stable undocumented immediate operation, is additionally checked exhaustively across every accumulator byte, operand byte, carry input, and decimal-mode state against an independent NMOS reference formula.

Result: **262,144 / 262,144 PASS**

## Normal regression suite

The normal regression suite covers the existing CPU, memory, CIA, VIC-II, sprite, SID, ROM, input, PRG, debugger, and machine behavior plus the new v0.9 compatibility cases. The optional Klaus Dormann test remains separate because `tests/assets/6502_functional_test.bin` is not redistributed with the project.

Pre-packaging result:

```text
166 passed
0 failed
```

The generated patch is also applied to a fresh v0.8 tree and the resulting tree is retested; that final artifact result is recorded in `V0.9-PATCH-VERIFICATION.txt`.

## Package-manager limitation

This execution environment cannot reliably reach the npm registry, so the real installed Vite/Vitest dependency tree is not available here. The project is therefore verified with strict TypeScript and an independent compiled test runner, then the generated patch is applied and retested from a fresh tree.

After applying the patch locally, run:

```bash
npm run build
npm run test
```
