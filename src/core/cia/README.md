# MOS 6526 CIA

## Overview

`src/core/cia` contains the browser-independent MOS 6526 Complex Interface Adapter implementation and the physical C64 keyboard switch matrix. A stock C64 contains two 6526s: CIA1 at `$DC00-$DC0F` and CIA2 at `$DD00-$DD0F`, with their 16-register files mirrored throughout `$DC00-$DCFF` and `$DD00-$DDFF` respectively.

Version 0.3 replaces the v0.2 CIA register-file placeholders with functional devices. The implementation covers the software-visible behavior required for C64 startup and input work: parallel ports and DDRs, both 16-bit timers, interrupt data/mask handling, TOD/alarm behavior, FLAG input, CNT timer modes, serial input shifting, CIA1 keyboard matrix wiring, and CIA2 VIC-bank output.

## Architecture

```text
C64Machine
    |
    +--> C64Io
          |
          +--> CIA1 (6526) <--> KeyboardMatrix / joystick pin state
          |
          +--> CIA2 (6526) ----> VIC bank select

CIA1 IRQ -----------------------> 6510 IRQ level
CIA2 IRQ -- rising assertion ---> 6510 NMI edge
```

`Cia6526` is a reusable chip model. It does not contain C64-specific knowledge about which keys, joystick ports, IEC signals, or VIC bank lines are connected to its pins. C64-specific wiring belongs to `C64Io` and `C64Machine`.

The keyboard model stores physical `(column,row)` switch closures. Host/browser key names are deliberately absent from the core; a later input adapter can map `KeyboardEvent.code` values to matrix coordinates without making the chip model depend on the DOM.

## Implementation Discussion

### Parallel ports

PRA/PRB output latches are combined with DDRA/DDRB and external input-provider callbacks. A DDR bit of `1` drives the corresponding output latch; a bit of `0` reads the external pin level. CIA1 providers model the active-low keyboard matrix and joystick pins. PB6/PB7 are overridden when Timer A/Timer B port output is enabled.

### Timers

Timer A and Timer B have independent 16-bit latches/counters. They support PHI2 counting, CNT counting, Timer-B chaining from Timer-A underflows, continuous/one-shot mode, force-load strobes, and PB6/PB7 pulse/toggle output. A counter underflows after reaching zero, then reloads from its latch.

`tick(n)` advances PHI2 time explicitly. This is integrated at `C64Machine.step()`: the CPU still executes an instruction atomically in v0.3, then both CIAs receive the instruction's cycle count. This is deterministic and substantially more faithful than wall-clock timers, but it is not yet a transistor/cycle-pipeline reproduction of every 6526 quirk.

### Interrupt controller

The ICR is asymmetric as on hardware. Writing bit 7 set adds selected mask bits; writing bit 7 clear removes selected mask bits. Interrupt source flags latch independently of the mask. Reading ICR returns the source bits plus bit 7 when an enabled source is asserting the interrupt output, then clears the latched sources and releases the output. `peek()` never acknowledges the interrupt.

CIA1's active-low IRQ output is modeled as the 6510 IRQ level. CIA2 is connected to NMI; because the 6510 NMI input is edge-sensitive, `C64Machine` converts a newly asserted CIA2 interrupt output into one `pulseNmi()` event and does not retrigger until CIA2 releases and asserts again.

### TOD/alarm

TOD is driven only by explicit `pulseTod()` calls. CRA bit 7 selects five input pulses per tenth for 50 Hz or six for 60 Hz. Writes to the hours register stop TOD and a write to tenths restarts it. Reading hours latches a coherent snapshot until tenths is read. CRB bit 7 redirects TOD writes to the alarm registers; a match raises the alarm interrupt source.

The real 6526 has silicon-revision-specific TOD and interrupt timing oddities. v0.3 implements documented functional behavior and intentionally leaves those compatibility-test quirks for the later cycle-exact phase.

### Serial port scope

The SDR register and serial-input path are modeled: rising CNT edges shift SP into an 8-bit receive register and raise the serial interrupt after eight bits. Timer-A-driven serial output waveform timing is not yet implemented because it is not required for C64 KERNAL startup and belongs with later IEC/serial timing work.

### Verification strategy

CIA tests cover reset state, DDR/port resolution, timer reload/one-shot behavior, Timer-B cascading, mask/ICR semantics, FLAG, CNT, TOD latching/alarm, serial input, keyboard scanning, mirrored C64 addresses, CIA2 VIC bank selection, and machine-level IRQ/NMI delivery. Later compatibility work should add the Lorenz/VICE CIA suites rather than weakening these focused unit tests.
