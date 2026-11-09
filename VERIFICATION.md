# v1.0 Verification

Version 1.0 is the release-hardening milestone for the browser Commodore 64 emulator. It does not broaden the compatibility claim into transistor-level or half-cycle behavior that the core does not model. Instead it freezes the supported feature set, strengthens release smoke coverage, hardens browser persistence/audio startup failure paths, and makes the documentation describe the actual current tree rather than historical milestones.

## Release scope

The v1.0 release gate covers the following user-visible paths:

- booting user-supplied BASIC, KERNAL, and character ROMs through the real reset vector;
- entering BASIC programs through the CIA1 keyboard matrix;
- PRG and normal T64 PRG loading through the canonical machine loader;
- host-assisted D64 PRG extraction for convenience;
- firmware-driven 1541 operation over the shared IEC bus with user-supplied 1541 DOS ROM;
- writable D64 and raw G64 media/export;
- TAP playback and C64 TAP v1 recording;
- supported generic and banked cartridges;
- PAL MOS 6569 and later-NTSC MOS 6567R8 timing profiles;
- selectable MOS 6581/8580 SID models and browser AudioWorklet output;
- debugger/monitor inspection and execution stops;
- portable motherboard save states and IndexedDB session restoration.

## v1.0 hardening changes

### Release metadata and gate

- `package.json` is version `1.0.0`.
- `src/release.ts` is the browser-visible release metadata authority.
- `npm run check` performs build plus the complete Vitest suite.
- `npm run release:check` additionally runs `scripts/release-audit.mjs`.
- The release audit checks package/release/documentation version consistency, rejects pre-1.0 milestone prose in Markdown/README files, verifies key release usage sections, and confirms every TypeScript-bearing `src/core` directory has a README.

### Release-readiness regression

`tests/release/ReleaseReadiness.test.ts` adds end-to-end smoke coverage for the workflows explicitly required before 1.0:

1. published release metadata is `1.0.0`;
2. host key classes needed for a representative BASIC line are accepted and released through the physical keyboard adapter;
3. a BASIC PRG extracted from D64 loads through `C64Machine.loadPrg()` and initializes BASIC pointers;
4. a BASIC PRG extracted from T64 follows the same canonical loader path.

These tests supplement, rather than replace, the dedicated chip/media/drive tests.

### Browser audio hardening

`SidAudio.createGraph()` now treats AudioWorklet startup as an atomic operation. If module load, node construction, graph connection, or resume fails, partially created nodes are disconnected and the temporary `AudioContext` is closed before the original error is rethrown. A browser audio failure therefore remains recoverable and does not leak an orphaned audio context.

### Browser session hardening

`BrowserSessionStore` now handles IndexedDB lifecycle failures explicitly:

- a blocked database open reports that another open emulator tab is preventing the operation;
- a failed open clears the cached promise so a later user action can retry;
- `versionchange` closes the active database handle and clears it for a clean future reopen.

The persistence layer remains browser-only and does not enter deterministic core timing.

## Documentation audit

Every `README*` and `*.md` file in the repository was reviewed against the v1.0 tree. The audit specifically corrected stale claims including:

- root documentation identifying an old pre-release version;
- D64 described as immutable after writable-media support existed;
- the 1541 described as future work after the true-drive core existed;
- cartridge GAME/EXROM modes described as future work after they were implemented;
- subsystem READMEs written as historical milestone notes rather than current behavior;
- the root verification document still being primarily an early disk/IEC milestone report;
- the SID manual planning document pointing at an obsolete implementation baseline.

The current documentation separates implemented behavior from known accuracy boundaries and includes explicit instructions for typing BASIC programs and using D64/G64 and T64 media.

## Known accuracy boundaries

v1.0 does not claim the following as exact:

- measured/empirically calibrated SID combined-waveform parity;
- half-cycle-exact VIC sprite p/s DMA fetch ordering;
- exact dot-clock border transitions and border-opening tricks;
- light-pen pin capture and once-per-frame latch timing;
- half-cycle-exact shared-bus/open-bus phase ordering;
- sprite crunch and obscure expansion flip-flop tricks;
- 6567R56A and deeper VIC revision-specific timing;
- transistor/op-amp-level 6581 filter calibration and per-chip variation;
- exact SID POT RC timing and analog noise/distortion floor;
- host-assisted SAVE/REL/SEQ/BAM filesystem creation helpers;
- chip-specific unstable XAA/LXA/AHX/TAS/SHX/SHY behavior;
- BRK/IRQ vector hijacking and remaining interrupt races;
- reset-pin micro-sequencing;
- analog 1541 PLL/weak-bit/magnetic-transition behavior and every copy-protection scheme;
- active expansion-port DMA bus stealing or arbitrary freezer-cartridge hardware.

Those limits are explicit compatibility boundaries, not hidden shortcuts.

## Required local release gate

Run from the project root after applying the patch:

```bash
npm run release:check
```

The optional Klaus Dormann functional test remains skipped when `tests/assets/6502_functional_test.bin` is absent and runs automatically when the user supplies that external binary.

## Patch-generation verification

The generated release patch is validated by applying it to a fresh copy of the successful post-readiness tree with:

```bash
patch -p1 --dry-run --forward --batch --no-backup-if-mismatch < PATCH
patch -p1 --forward --batch --no-backup-if-mismatch < PATCH
```

The patched tree must match the intended v1.0 target byte-for-byte, contain no `.rej`/`.orig` files, pass whitespace checks, pass the documentation audit, and pass strict TypeScript/runtime smoke verification available in the artifact environment. The user's installed Vite/Vitest toolchain remains the authoritative final integration gate.
