# v0.10 Verification

Version 0.10 adds D64 disk-image parsing and a physical serial IEC bus foundation while preserving the v0.9 CPU/VIC/CIA/SID timing model. The accelerated D64 path is intentionally host-assisted: it extracts a PRG from disk sectors and feeds the existing PRG loader, while the IEC layer remains an independent electrical bus for the later real-1541 phase.

## D64 geometry and parser scope

`D64Image` accepts these exact image geometries:

| Tracks | Sectors | Data bytes | With error table |
| ---: | ---: | ---: | ---: |
| 35 | 683 | 174,848 | 175,531 |
| 40 | 768 | 196,608 | 197,376 |
| 42 | 802 | 205,312 | 206,114 |

Sector geometry follows the 1541 zones used by standard D64 images:

- tracks 1-17: 21 sectors/track;
- tracks 18-24: 19 sectors/track;
- tracks 25-30: 18 sectors/track;
- tracks 31 onward: 17 sectors/track.

The parser copies the supplied image, exposes immutable geometry/header/directory metadata, returns copies for public raw-sector reads, and keeps the optional one-byte-per-sector error table separate from disk data.

The directory traversal begins at track 18 sector 1 and follows link bytes, with loop detection and track/sector bounds checks. File extraction also follows linked sectors with loop detection. Non-final file sectors contribute 254 bytes; on a final sector the second link byte is interpreted as the last used byte position, so `$FF` contributes all 254 payload bytes and `$01` contributes zero payload bytes.

A PRG is not interpreted by the disk layer. `readPrg()` returns the exact linked file stream including its two-byte little-endian load address and the existing PRG loader remains the single authority for loading it into C64 RAM.

Reference basis: VICE D64 image-format documentation and the 1541-compatible sector/directory conventions used by current D64 tooling.

## IEC electrical model

`IecBus` models ATN, CLOCK, and DATA as wired-low/open-collector lines. An endpoint can pull a line low or release it; a resolved line is high only when every attached endpoint releases it.

CIA2 wiring follows the C64 motherboard connection:

- PA3 -> inverted ATN output;
- PA4 -> inverted CLOCK output;
- PA5 -> inverted DATA output;
- PA6 <- resolved CLOCK input;
- PA7 <- resolved DATA input.

Because the motherboard output stages invert PA3-PA5, an output-configured CIA bit value of `1` pulls the corresponding IEC line low. A CIA bit configured as an input does not drive the line.

`Cia6526` exposes a generic Port-A output-change observer rather than containing IEC knowledge. This guarantees that both CPU-routed writes and direct CIA writes update external motherboard wiring consistently. Reset also emits the observer update, releasing the C64 endpoint without incorrectly releasing another attached peripheral.

A bus-wide `releaseAll()` keeps both the resolved bus state and each endpoint's local drive state coherent, so an endpoint can immediately reassert the same line afterward.

Reference basis: C64 CIA2/IEC wiring documentation and the C64 service-manual schematic; future drive devices are expected to attach another endpoint to the same bus.

## Host-assisted D64 loading boundary

The browser UI can mount a D64, display its directory, select PRG entries, and perform either:

- **Host-assisted Load** — extract the PRG and use the normal C64 PRG loader;
- **Host-assisted Load + Jump** — same extraction with the existing explicit machine-code jump option.

This path does **not**:

- execute KERNAL IEC LOAD routines;
- emulate 1541 DOS;
- emulate a 6502/VIA drive computer;
- synthesize fake serial handshakes;
- support fastloaders;
- modify the mounted D64.

That separation is intentional. The D64 parser provides useful read-only disk-image access now, while `IecBus` provides the physical boundary needed by the next true-drive phase.

## Public-image format cross-check

During implementation, the parser assumptions were independently checked against the public `dirien/c64-demo` D64 image. The image is a standard 174,848-byte 35-track D64 whose BAM/directory data identifies:

```text
Disk label: DEMO DISK
Disk ID:    01
DOS type:   2A
Entry:      DEMO
Type byte:  $82 (closed PRG)
Start:      track 1, sector 0
Blocks:     7
Final link: track 0, byte-position 222
```

The seven-sector chain and final-sector marker are consistent with the same linked-file rules exercised by the synthetic unit tests. The repository's current standalone `demo.prg` is a different revision/size, so no byte-for-byte PRG identity claim is made.

## Existing emulator core retained

The v0.9 compatibility work is intentionally untouched where this phase does not need it. The CPU, VIC-II, SID implementation, machine timing profiles, undocumented-opcode behavior, and raster timing remain the v0.9 baseline. v0.10 changes CIA only to provide the generic output-observer hook required by physical IEC wiring.

## Static verification

The complete source and test tree is type-checked in strict mode using the locally available TypeScript compiler plus verification-only ambient declarations for unavailable Vitest/Vite/Node packages. Those declarations are not part of the project or patch.

Result: **PASS**

## Normal regression suite

The compiled normal regression includes all previous CPU, memory, CIA, VIC-II, sprite, SID, ROM, host-input, PRG, debugger, and machine tests plus v0.10 coverage for:

- all supported D64 sizes and error-table variants;
- D64 track/sector bounds;
- BAM/header metadata;
- linked directory traversal;
- closed/locked/type flags;
- typed zero-block entries;
- multi-sector PRG extraction;
- full final sectors using `$FF`;
- invalid file types and malformed/looping chains;
- PETSCII filename display conversion;
- IEC wired-low resolution across multiple endpoints;
- endpoint detach and bus-wide release consistency;
- CIA2 output inversion and DDR behavior;
- resolved IEC input levels on PA6/PA7;
- direct CIA2 register writes updating IEC;
- reset releasing only the C64 endpoint;
- full CPU-visible `$DD00/$DD02` integration through `C64Bus`.

Pre-packaging result:

```text
184 passed
0 failed
```

The optional Klaus Dormann test remains separate because `tests/assets/6502_functional_test.bin` is not redistributed with the project.

The final generated patch is applied to a fresh exact v0.9 tree and the complete normal regression is rerun from that freshly patched tree. Artifact results are recorded in `V0.10-PATCH-VERIFICATION.txt`.

## Package-manager limitation

This execution environment cannot reliably reach the npm registry, so the real installed Vite/Vitest dependency tree is not available here. Verification therefore uses strict TypeScript plus an independent compiled test runner. The generated patch itself is then applied to a fresh tree and retested.

After applying locally, run:

```bash
npm run build
npm run test
```

With the optional Klaus binary absent, local Vitest is expected to report 184 passed and 1 skipped.


## v0.16 user-facing completeness verification

The v0.16 milestone adds portable save states, browser-persistent session assets, configurable PAL/NTSC construction, and persisted 6581/8580 selection. Save states are deliberately captured only at a C64 6510 instruction boundary. Motherboard state is serialized deeply; independent 1541 CPU/VIA microstate is not fabricated and is reset during restore while mounted media/head position remain attached.

Verification performed for this patch includes strict TypeScript compilation of the complete core, session codec/store, browser main UI, 1541 UI, expansion/tape UI, input adapter, and audio adapter using only a verification-only Vite URL declaration; strict compilation of all ordinary tests except the optional Klaus Node-file harness using verification-only Vitest declarations; and an independent compiled runtime harness covering NTSC+8580 construction, deep motherboard state restore, portable binary-state encoding, and cross-standard state rejection.
