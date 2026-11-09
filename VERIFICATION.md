# v1.0.1 Verification

Version 1.0.1 is the first maintenance release of Browser64. It preserves the v1.0 feature scope while fixing two user-visible release issues discovered with real ROM/media operation: completed VIC frames are retained for browser display, and host-assisted PRG launching no longer decides BASIC-versus-machine-code behavior from the PRG load address alone.

## Release scope

The v1.0.1 release gate covers the following user-visible paths:

- booting user-supplied BASIC, KERNAL, and character ROMs through the real reset vector;
- displaying the completed ROM-generated VIC frame at frame rollover;
- entering BASIC programs through the CIA1 keyboard matrix;
- PRG and normal T64 PRG loading through the canonical machine loader;
- structural BASIC-bootstrap detection at `$0801`, including PRGs that begin below `$0801`;
- host-assisted D64 PRG extraction and Load Only / Load + Run/Start workflows;
- firmware-driven 1541 operation over the shared IEC bus with user-supplied 1541 DOS ROM;
- writable D64 and raw G64 media/export;
- TAP playback and C64 TAP v1 recording;
- supported generic and banked cartridges;
- PAL MOS 6569 and later-NTSC MOS 6567R8 timing profiles;
- selectable MOS 6581/8580 SID models and browser AudioWorklet output;
- debugger/monitor inspection and execution stops;
- portable motherboard save states and IndexedDB session restoration;
- the `documents/OPERATORS_GUIDE.md` operating handbook.

## v1.0.1 maintenance changes

### Release metadata and gate

- `package.json` is version `1.0.1`.
- `src/release.ts` publishes `1.0.1` and the maintenance-release description.
- `npm run check` performs build plus the complete Vitest suite.
- `npm run release:check` additionally runs `scripts/release-audit.mjs`.
- The release audit verifies the current version and now requires the Browser64 Operator's Guide plus its 1541, host-assisted-loading, and troubleshooting sections.

### Completed-frame VIC display

The VIC-II no longer clears the entire framebuffer at frame rollover. Each raster line of the next frame overwrites its own output naturally, so retaining the just-completed frame lets `C64Machine.runFrame()` return a renderable image instead of a border-color-only buffer. A regression test verifies a rendered text pixel survives the rollover boundary.

### PRG BASIC-bootstrap detection

`detectBasicBootstrap()` examines the memory image at `$0801` rather than assuming that only a PRG whose header load address equals `$0801` can contain BASIC.

The detector validates:

- that `$0801` lies inside the loaded PRG range;
- a plausible linked-line pointer for the first BASIC line;
- a legal BASIC line number;
- a terminating zero at the linked-line boundary;
- at least one BASIC V2 token in the first line;
- memory bounds appropriate for stock BASIC text.

Only the first line must be structurally valid. This deliberately supports common game-loader layouts where a one-line BASIC `SYS` bootstrap at `$0801` immediately enters machine code and arbitrary data follows.

When a bootstrap is detected, `C64Machine.loadPrg()` initializes `TXTTAB` to `$0801` and refreshes the BASIC boundary pointers. `launchPrg()` then queues `RUN` through the normal KERNAL keyboard buffer. Without a detected bootstrap, host-assisted Run/Start falls back to the PRG load address.

### Attached media corpus review

The v1.0.1 launch logic was checked against the supplied open-source sample corpus without adding those media images to the repository. The samples include several distinct patterns:

- conventional BASIC programs loading directly at `$0801`;
- BASIC loaders whose PRGs start at `$0800`;
- loaders with substantial bytes below `$0801` before the BASIC stub;
- multi-file disks whose later files are machine-code/data assets;
- disks whose first directory PRG is machine code rather than BASIC;
- T64 containers with PRG entries.

Representative supplied disks demonstrated why load-address-only classification is insufficient: some loaders begin below `$0801` but contain a valid BASIC launcher at `$0801`, while other first-stage files genuinely contain machine code at low memory addresses. The new detector distinguishes the former structurally and leaves the latter on the explicit PC-start fallback.

### Browser64 Operator's Guide

`documents/OPERATORS_GUIDE.md` is added as the user-facing handbook. It covers:

- ROM requirements and first power-on;
- BASIC entry and keyboard use;
- Load Only versus Load + Run/Start;
- PRG bootstrap analysis;
- D64/G64/T64/TAP workflows;
- 1541 DOS ROM requirements and true-drive operation;
- writable media and export;
- cartridges and expansion port;
- PAL/NTSC and SID controls;
- joystick input;
- save states and persistent sessions;
- machine monitor/debugger operation;
- troubleshooting and compatibility boundaries.

## Release-readiness regression

`tests/release/ReleaseReadiness.test.ts` continues the end-to-end smoke coverage for the workflows explicitly required for the release:

1. published release metadata is `1.0.1`;
2. host key classes needed for a representative BASIC line are accepted and released through the physical keyboard adapter;
3. a BASIC PRG extracted from D64 loads through `C64Machine.loadPrg()`, initializes BASIC pointers, and launches through queued `RUN`;
4. a BASIC PRG extracted from T64 follows the same canonical loader path.

Dedicated PRG tests additionally verify a BASIC bootstrap embedded in a PRG that begins below `$0801` and reject arbitrary machine code at `$0801` as BASIC.

## Documentation audit

The v1.0 documentation audit remains active. Version 1.0.1 updates the root README, verification document, machine/program architecture notes, release metadata, and adds the operator handbook. The audit rejects pre-1.0 milestone prose and verifies key current-release sections.

## Known accuracy boundaries

The v1.x compatibility claim still does not include exact modeling of:

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
- chip-specific unstable XAA/AHX/TAS/SHX/SHY behavior beyond the C64-profiled LXA `$AB` compatibility model;
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

The generated v1.0.1 patch must be validated against the intended post-v1.0-fix base with:

```bash
patch -p1 --dry-run --forward --batch --no-backup-if-mismatch < PATCH
patch -p1 --forward --batch --no-backup-if-mismatch < PATCH
git diff --check
```

The patched tree must match the intended v1.0.1 target byte-for-byte, contain no `.rej`/`.orig` files, pass the documentation audit, pass strict TypeScript checks available in the artifact environment, and pass the focused launch-analysis runtime verification. The user's installed Vite/Vitest toolchain remains the authoritative final integration gate.
