# Browser64 Operator's Guide

**Version:** 1.0.1
**Product:** Browser64 / C64 Browser Emulator
**Purpose:** Operating handbook for normal use, BASIC development, media loading, 1541 true-drive operation, debugging, audio, cartridges, save states, and troubleshooting.

## 1. Overview

Browser64 is a from-scratch Commodore 64 emulator written in TypeScript for a modern browser. The motherboard core models the MOS 6510 CPU, two MOS 6526 CIAs, VIC-II, SID, the C64 memory/PLA arrangement, keyboard and joystick wiring, Datasette signals, cartridge expansion, and a separately clocked 1541 drive connected through the IEC serial bus.

Browser64 intentionally separates two kinds of file operation:

- **Host-assisted loading** reads a PRG directly from a host file, D64, or T64 container and copies it into C64 RAM. It is fast and convenient, but it is not an emulated disk/tape transfer.
- **Hardware-emulated loading** lets the C64 KERNAL and the emulated 1541 or Datasette perform the transfer through the same hardware paths used by a real machine.

That distinction matters most for multi-file games, custom fast loaders, disk writes, copy protection, and software that talks directly to drive hardware.

## 2. Requirements

Browser64 requires:

- a supported modern browser;
- Node.js 22.12 or newer and npm for local development;
- user-supplied Commodore ROM images;
- a 1541 DOS ROM when using true-drive disk access.

The emulator repository does not bundle Commodore ROM images.

### 2.1 Motherboard ROMs

The motherboard requires three unheadered binary ROM images:

| ROM | Size | Common standard image name |
| --- | ---: | --- |
| BASIC | 8,192 bytes | `basic.901226-01.bin` |
| KERNAL | 8,192 bytes | `kernal.901227-03.bin` |
| Character | 4,096 bytes | `characters.901225-01.bin` or equivalent character ROM dump |

All three must be accepted by the ROM panel before **Power On** becomes available.

### 2.2 1541 DOS ROM

True-drive operation requires one unheadered **16 KiB 1541 DOS ROM**. This ROM is separate from the C64 motherboard KERNAL ROM.

The 1541 panel reports whether its DOS ROM is loaded. A D64 can still be browsed and host-loaded without this ROM, but software running on the C64 cannot perform real device-8 IEC access until the 1541 ROM is present.

## 3. Starting Browser64

From the repository root:

```bash
npm install
npm run dev
```

Open the Vite development URL shown by the terminal.

For a production build:

```bash
npm run build
```

For the complete release gate:

```bash
npm run release:check
```

## 4. First Power-On

1. Load the BASIC ROM.
2. Load the KERNAL ROM.
3. Load the character ROM.
4. Confirm the ROM status reports the complete ROM set.
5. Click **Power On**.
6. Wait for the normal Commodore BASIC startup screen and `READY.` prompt.
7. Click the VIC-II display to give the emulated keyboard focus.

Power On starts at the real KERNAL reset vector. Browser64 does not inject a fake startup screen or bypass ROM initialization.

## 5. Main Machine Controls

### Power On

Performs a cold power-on of the emulated motherboard using the loaded ROMs.

### Run / Pause

Starts or pauses continuous emulation. Normal games should run continuously.

### Reset

Performs the emulator's modeled warm reset while retaining mounted media and other appropriate host state.

### RESTORE

Generates the C64 RESTORE-key NMI behavior. This is separate from normal keyboard-matrix input.

### Step

Executes one 6510 instruction while paused.

### Run 100

Executes up to 100 instructions or until a monitor stop condition occurs.

### Run Frame

Advances until the VIC-II enters the next video frame.

## 6. Entering and Running BASIC Programs

After the C64 reaches `READY.`, click the VIC-II display and type BASIC exactly as on a physical C64.

Example:

```text
10 PRINT "HELLO FROM BROWSER64"
20 GOTO 10
RUN
```

The browser keyboard adapter drives the CIA1 keyboard matrix; it does not paste text directly into BASIC memory.

Useful operations include:

```text
LIST
RUN
NEW
```

Cursor keys, both C64 shift paths, RUN/STOP, Commodore, function keys, quotes, colon, and common punctuation are represented by the host input adapter.

## 7. PRG Files

A PRG contains a two-byte little-endian load address followed by bytes to copy into C64 RAM. The load address does **not** universally mean "execution starts here."

Browser64 therefore presents two host-assisted actions.

### Load Only

**Load Only** copies the PRG into RAM and does not deliberately start it.

Use this when:

- you want to inspect memory before execution;
- you know the program expects a manual BASIC command;
- you are loading data rather than an executable program;
- you are following original software instructions.

### Load + Run/Start

Version 1.0.1 analyzes the loaded PRG before deciding how to start it.

Browser64 looks for a structurally plausible tokenized BASIC bootstrap at `$0801`. The PRG itself may begin at `$0801` **or below it**. This is important because many games place machine code, metadata, or a loader prefix before the BASIC text area.

When a BASIC bootstrap is detected:

1. the complete PRG is copied to its native load address;
2. BASIC's `TXTTAB` is pointed at `$0801`;
3. BASIC boundary pointers are refreshed;
4. `RUN` plus Return is placed in the normal KERNAL keyboard buffer;
5. the ROM BASIC interpreter starts the loader naturally.

When no BASIC bootstrap is detected, **Load + Run/Start** falls back to starting the CPU at the PRG's load address.

The trace explicitly reports which path was chosen.

### Why bootstrap detection matters

A game can load at, for example, `$07C0` while containing a one-line tokenized BASIC launcher at `$0801`. Jumping directly to `$07C0` would execute data rather than the intended loader. Browser64 1.0.1 recognizes the BASIC line at `$0801` instead of deciding solely from the file's load address.

No heuristic can prove the intended entry point for every historical PRG. If a title does not start correctly, use its original loading instructions or the true-drive path.

## 8. D64 Disk Images

A D64 represents Commodore 1541 logical sectors. Browser64 provides both a convenience browser and a true-drive mount for the same selected D64.

### 8.1 D64 directory browser

Selecting a D64 normally displays its directory and available PRG files. If a disk uses a damaged, protected, or intentionally nonstandard directory chain, Browser64 1.0.1 keeps the image available to the true-drive path even when the convenience directory browser cannot enumerate it.

Choose a PRG from the selector and use:

- **Host-assisted Load Only** to copy the selected file to RAM without starting it;
- **Host-assisted Load + Run/Start** to apply the version 1.0.1 BASIC-bootstrap launch analysis and then start it.

The host-assisted path is useful for simple single-file software and for development/testing.

### 8.2 D64 and multi-file software

Many commercial games contain a small first-stage loader plus additional program, graphics, level, score, or save files. Host-loading only the first file does not make those later files magically available to KERNAL device 8.

For software that later performs disk access:

1. load a 1541 DOS ROM in the **1541 True Drive** panel;
2. mount the D64;
3. verify the drive panel reports **Drive 8 · ROM ready · D64 ...**;
4. start the program;
5. leave the disk mounted while the program runs.

When the same D64 is selected in the D64 browser, Browser64 also mounts it into the emulated 1541 mechanism.

### 8.3 Using a D64 through the real C64/1541 path

With the 1541 ROM loaded and the disk mounted, use normal Commodore commands from BASIC.

Load the first file using normal BASIC/KERNAL semantics:

```text
LOAD"*",8,1
```

Then follow the title's normal startup instructions. If the loaded program is BASIC, this is often:

```text
RUN
```

For a BASIC program intended to load at its BASIC address, software may use other `LOAD` forms according to its original instructions.

To view a disk directory through the KERNAL:

```text
LOAD"$",8
LIST
```

The true-drive path executes the C64 KERNAL IEC routines, the shared serial bus, the 1541's own 6502 and 6522 VIAs, and the 1541 DOS ROM.

## 9. 1541 True Drive

### 9.1 What is emulated

The true-drive subsystem includes:

- an independent approximately 1 MHz NMOS 6502 drive CPU;
- 2 KiB drive RAM;
- two MOS 6522 VIA devices;
- user-supplied 16 KiB 1541 DOS ROM;
- IEC ATN, CLOCK, DATA, and RESET lines;
- head stepping and density zones;
- D64-to-GCR media behavior;
- raw G64 track operation;
- drive motor and activity state;
- writable media state;
- write protection and media export.

This is not a KERNAL LOAD trap.

### 9.2 Mounting disks

Selecting a D64 in the main disk browser mounts it into the 1541 as well. G64 media can be selected directly in the 1541 panel.

The drive status reports:

- ROM readiness;
- media kind;
- current track/head position;
- write-protect state;
- clean/modified state;
- motor state;
- activity LED state.

### 9.3 Write protection

Enable **Write protect** when you do not want the emulated drive to alter mounted media.

Disable it when testing software that saves scores, characters, configuration, or game progress.

### 9.4 Export Mounted Disk

If software modifies a mounted D64 or G64, use **Export Mounted Disk** to download the current media image. Browser64 does not silently replace the original host file.

### 9.5 1541 compatibility limits

The drive is firmware-driven and preserves much more behavior than host-assisted loading, but version 1.0.1 does not claim exact analog magnetic/PLL behavior, weak-bit physics, or compatibility with every copy-protection scheme ever used on 1541 media.

G64 is preferred when nonstandard raw GCR tracks, half-tracks, or variable speed-zone data must be retained.

## 10. G64 Images

G64 is Browser64's raw-GCR disk path. It supports full and half tracks, raw GCR bytes, and speed-zone information that D64 cannot represent.

Use G64 when:

- a disk depends on nonstandard track layout;
- D64 cannot retain required low-level data;
- you want raw media writes preserved.

G64 still cannot represent every analog characteristic of a physical floppy.

## 11. T64 Containers

T64 is a host-side tape-file container rather than a pulse-level tape signal.

Browser64 can:

- parse both the common `C64S tape image file` signature and the older `C64S tape file` variant used by historical archives;
- parse the T64 directory;
- select normal PRG entries;
- host-load the selected entry;
- use the same BASIC-bootstrap launch analysis as standalone PRG/D64 files.

Use **Load Only** when you want manual control, or **Load + Run/Start** to use the launch detector.

T64 is intentionally separate from TAP and the Datasette timing path.

## 12. TAP and Datasette Operation

TAP images model tape pulse timing and are handled by the Datasette subsystem rather than the T64 file-container loader.

Browser64 models:

- PLAY/SENSE behavior;
- MOTOR control;
- tape pulse timing into CIA1 FLAG;
- TAP v0/v1 playback;
- C64 TAP v1 recording;
- blank tape creation;
- tape write protection;
- TAP export.

Use TAP when software expects real cassette timing or Datasette control rather than a host-side file extraction.

## 13. Cartridges and Expansion Port

Browser64 supports raw cartridge images and selected VICE CRT hardware families.

Implemented CRT families include:

- Generic hardware type 0;
- Ocean type 1 / CRT hardware type 5;
- C64GS/System 3 / type 15;
- Dinamic / type 17;
- Magic Desk / type 19.

The expansion-port model includes GAME/EXROM mapping, ROML/ROMH, IO1/IO2, IRQ/NMI, DMA electrical state, and a FREEZE hook. Active expansion DMA bus stealing and arbitrary freezer-cartridge logic remain outside the current compatibility claim.

## 14. Video Standard

The SID Audio panel also provides the machine video-standard selector.

Supported profiles are:

- **PAL-B / MOS 6569** — 985,248 Hz system clock;
- **NTSC-M / MOS 6567R8** — 1,022,727 Hz system clock.

Changing the hardware profile reconstructs the machine rather than merely changing a display label. Persisted preferences are restored on later sessions.

Software written for one video standard can run too fast, too slow, or fail timing checks on the other.

## 15. SID Audio

Browser64 provides selectable MOS 6581 and MOS 8580 SID models.

Use **Enable / Resume Audio** after a browser user gesture to start Web Audio. Browsers commonly prohibit automatic audio startup.

**Mute** silences output without stopping SID emulation.

The SID core remains deterministic; Web Audio consumes generated PCM and does not control emulator time.

## 16. Keyboard and Joysticks

Click the VIC-II display to capture normal C64 keyboard input.

Important host mappings include:

| Host input | C64 function |
| --- | --- |
| Page Up | RESTORE |
| Escape | RUN/STOP |
| Alt | Commodore key |
| Arrow keys / Space | Keyboard or selected joystick port, according to the capture selector |

Joystick input is routed through the real active-low CIA1 port pins.

If keyboard input appears dead, click the VIC-II canvas again and confirm the input selector is not routing the keys to a joystick port unexpectedly.

## 17. Save States

### Quick Save

Captures the C64 motherboard state at a safe 6510 instruction boundary.

### Quick Load

Restores the most recent quick state.

### Export State

Downloads a portable `.c64state` representation.

### Import State

Loads a previously exported compatible state.

The motherboard state includes CPU, RAM, VIC, CIA, SID, Datasette, processor-port/bus state, and supported cartridge bank state.

The independently running 1541 CPU/VIA electronics are not serialized at an arbitrary microcycle. When a state is restored, the 1541 electronics reset while its mounted media/mechanism remains attached.

## 18. Persistent Browser Session

IndexedDB persistence stores supported session assets and preferences, including:

- motherboard ROMs;
- 1541 ROM;
- mounted disk/tape/container assets;
- cartridge asset;
- PAL/NTSC preference;
- 6581/8580 preference;
- quick state.

**Forget Saved Session** clears the saved Browser64 session so the next launch begins without the persisted assets.

## 19. Machine Monitor and Debugger

The monitor provides development/debugging controls without patching guest RAM with trap instructions.

Capabilities include:

- PC address breakpoints;
- CPU read/write/read-write watchpoints;
- raster-line and exact raster line/cycle stops;
- side-effect-free mapped-memory inspection;
- physical RAM inspection and editing;
- editable 6510 registers at safe boundaries;
- instruction history;
- CPU/VIC bus history;
- IRQ/NMI history;
- VIC/CIA/SID/processor-port snapshots;
- screen matrix and color RAM inspection.

Pause the emulator before editing CPU state or RAM when deterministic control is important.

## 20. Recommended Game-Loading Workflow

### Single-file D64 game

1. Power on and reach `READY.`.
2. Select the D64.
3. Select the game's PRG.
4. Click **Host-assisted Load + Run/Start**.
5. Read the trace to confirm either `BASIC bootstrap ... RUN queued` or the explicit PC launch.

### Multi-file D64 game

1. Load the motherboard ROMs and power on.
2. Load the 1541 DOS ROM.
3. Mount the D64.
4. Prefer the software's original disk-loading command, commonly `LOAD"*",8,1`.
5. Leave the disk mounted while playing.
6. If the title writes to disk, disable write protection and export the modified image when finished.

Host-assisted launch can still be useful for the first-stage loader, but later device-8 accesses require the true drive.

### T64 game

1. Open the T64.
2. Select a loadable PRG entry.
3. Use **Load + Run/Start**.
4. If the title's original instructions call for `RUN`, the BASIC detector will normally queue it automatically when a conventional `$0801` bootstrap is present.

## 21. Troubleshooting

### Power On is disabled

All three motherboard ROMs have not been accepted. Confirm BASIC is 8192 bytes, KERNAL is 8192 bytes, and character ROM is 4096 bytes.

### The screen is black before power-on

This is expected. The VIC-II has not begun normal ROM-driven initialization.

### The C64 powers on but there is no `READY.` prompt

Confirm the standard ROM images were loaded correctly and use version 1.0.1 or later. The completed VIC framebuffer must remain visible across the frame boundary for the browser to display the ROM-generated text screen.

### A D64 directory appears but the game does not start

Check the following:

1. Select the intended loader PRG rather than a score/data file.
2. Use **Load + Run/Start** for automatic BASIC-bootstrap analysis.
3. Read the trace to see which launch path was selected.
4. If the disk contains multiple files, load a 1541 DOS ROM and leave the D64 mounted.
5. If the game's original instructions specify a particular `LOAD` or `SYS` command, prefer those instructions.

### Load + Run/Start jumps to the wrong place

The launch detector only automatically recognizes conventional tokenized BASIC bootstraps at `$0801`. A custom machine-code loader may have an entry point different from its PRG load address. Use **Load Only** and follow the title's original command, or use the true-drive path.

### The game starts but later hangs during disk access

The likely cause is missing true-drive support at runtime. Confirm:

- the 1541 DOS ROM is loaded;
- the D64 remains mounted;
- the drive reports ROM ready;
- the software is accessing device 8;
- the title is not relying on an unimplemented copy-protection/analog edge case.

### Audio is silent

Click **Enable / Resume Audio** after interacting with the page. Confirm the emulator is not muted and that the browser allows Web Audio for the page.

### Keyboard input does not reach BASIC or a game

Click the VIC-II display. Check whether arrow/Space input has been assigned to joystick capture instead of the C64 keyboard.

### A save state refuses to load

The state must match the machine timing profile expected by the saved state. PAL and NTSC states are intentionally not cross-restored as if their timing were identical.

## 22. Accuracy Boundaries

Browser64 1.0.1 is intended for ordinary BASIC development and a broad class of C64 software, but it does not claim transistor- or dot-exact parity in every corner case.

Known boundaries include:

- measured SID combined-waveform parity;
- half-cycle-exact sprite DMA fetch ordering;
- exact dot-clock border-opening tricks;
- physical light-pen pin/latch timing;
- half-cycle-exact shared-bus/open-bus ordering;
- sprite crunch and obscure expansion flip-flop tricks;
- early VIC revision timing such as 6567R56A;
- transistor/op-amp-level 6581 filter variation;
- exact SID POT RC conversion and analog noise floor;
- unstable opcode silicon-specific behavior;
- remaining interrupt-vector race cases;
- reset-pin micro-sequencing;
- exact analog 1541 PLL, weak-bit, and magnetic-transition behavior;
- every historical disk copy-protection scheme;
- active expansion DMA bus stealing beyond the existing electrical hooks.

## 23. Operator Checklist

Before reporting a software compatibility problem, record:

- Browser64 version;
- PAL or NTSC profile;
- 6581 or 8580 selection;
- motherboard ROM revisions;
- whether the 1541 ROM is loaded;
- media type (PRG, D64, G64, T64, TAP, CRT);
- filename/selected directory entry;
- host-assisted or true-drive loading path;
- write-protect state;
- trace output near the failure;
- PC/register state if the machine monitor is available;
- whether the same image requires a custom loader or copy protection on a real C64/another emulator.

This information distinguishes host-launch mistakes from CPU/VIC/CIA/SID/1541 compatibility defects and makes regressions reproducible.
