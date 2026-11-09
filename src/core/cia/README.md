# MOS 6526 CIA

## Overview

`src/core/cia` contains the browser-independent MOS 6526 Complex Interface Adapter implementation and the physical C64 keyboard switch matrix. A stock C64 contains two 6526s: CIA1 at `$DC00-$DC0F` and CIA2 at `$DD00-$DD0F`, with their 16-register files mirrored throughout `$DC00-$DCFF` and `$DD00-$DDFF` respectively.

The implementation covers parallel ports and DDRs, both 16-bit timers, interrupt data/mask handling, TOD/alarm behavior, FLAG input, CNT timer modes, serial input shifting, CIA1 keyboard matrix wiring, CIA2 VIC-bank/IEC output, the old-6526 timer count/load pipeline, synchronized CNT timing, and delayed interrupt-latch behavior used by classic compatibility tests.

## Architecture

```text
C64Machine
    |
    +--> C64Io
          |
          +--> CIA1 (6526) <--> KeyboardMatrix / joystick pin state
          |
          +--> CIA2 (6526) ----> VIC bank select
                              \--> IEC motherboard drivers

CIA1 IRQ -----------------------> 6510 IRQ level
CIA2 IRQ -- rising assertion ---> 6510 NMI edge
```

`Cia6526` is a reusable chip model. It does not contain C64-specific knowledge about which keys, joystick ports, IEC signals, or VIC bank lines are connected to its pins. C64-specific wiring belongs to `C64Io` and `C64Machine`.

The keyboard model stores physical `(column,row)` switch closures. Host/browser key names remain absent from the core; that translation lives in `src/input/HostInputController.ts`, so the CIA and keyboard matrix have no DOM dependency.

## Implementation Discussion

### Parallel ports

PRA/PRB output latches are combined with DDRA/DDRB and external input-provider callbacks. A DDR bit of `1` drives the corresponding output latch; a bit of `0` reads the external pin level. CIA1 providers model the active-low keyboard matrix and joystick pins. PB6/PB7 are overridden when Timer A/Timer B port output is enabled.

`setPortAOutputChangeHandler()` observes the resolved PRA/DDRA output-latch state without embedding C64-specific wiring in the CIA. `C64Io` uses that hook for CIA2's inverted IEC ATN/CLOCK/DATA drivers. The callback fires after PRA/DDRA writes and reset, so direct CIA access and CPU-routed writes cannot diverge.

### Timers

Timer A and Timer B have independent 16-bit latches/counters. They support PHI2 counting, CNT counting, Timer-B chaining from Timer-A underflows, continuous/one-shot mode, force-load strobes, and PB6/PB7 pulse/toggle output. A counter underflows after reaching zero, then reloads from its latch.

`tick(n)` advances PHI2 time explicitly. `C64Machine.tickSystemCycle()` advances both CIAs one shared system cycle at a time alongside an individual 6510 bus micro-cycle, so timers continue during VIC-II stalls. The internal old-6526 count/load/one-shot staging delays START/force-load appropriately, synchronizes CNT edges into the timer pipeline, and resets CNT high. The old-CIA Timer-B ICR race and other silicon-revision corner cases remain outside the v1.0 accuracy claim.

### Interrupt controller

The ICR is asymmetric as on hardware. Writing bit 7 set adds selected mask bits; writing bit 7 clear removes selected mask bits. Interrupt source flags latch independently of the mask. An enabled source promotes to the master interrupt output one PHI2 later. Once that interrupt flip-flop is asserted, clearing the IMR bit does not release it; reading ICR acknowledges and clears the source latches/output. Reading during the one-cycle pending window can prevent assertion. `peek()` never acknowledges the interrupt.

CIA1's active-low IRQ output is modeled as the 6510 IRQ level. CIA2 is connected to NMI; because the 6510 NMI input is edge-sensitive, `C64Machine` converts a newly asserted CIA2 interrupt output into one `pulseNmi()` event and does not retrigger until CIA2 releases and asserts again.

### TOD/alarm

TOD is driven only by explicit `pulseTod()` calls. CRA bit 7 selects five input pulses per tenth for 50 Hz or six for 60 Hz. Writes to the hours register stop TOD and a write to tenths restarts it. Reading hours latches a coherent snapshot until tenths is read. CRB bit 7 redirects TOD writes to the alarm registers; a match raises the alarm interrupt source.

The real 6526 has silicon-revision-specific TOD and interrupt timing oddities. The common interrupt-latch timing is modeled; deeper TOD and old/new-CIA revision races remain post-1.0 compatibility work.

### Serial port scope

The SDR register and serial-input path are modeled: rising CNT edges shift SP into an 8-bit receive register and raise the serial interrupt after eight bits. Timer-A-driven serial output waveform timing is not yet implemented because it is not required for C64 KERNAL startup and belongs with later IEC/serial timing work.

### Verification strategy

CIA tests cover reset state, DDR/port resolution, the START/count pipeline, timer reload/one-shot behavior, Timer-B cascading, reset-high CNT, synchronized CNT counting, delayed IRQ promotion, IMR/ICR semantics, FLAG, TOD latching/alarm, serial input, keyboard scanning, mirrored C64 addresses, CIA2 VIC bank selection, and machine-level IRQ/NMI delivery. Broader compatibility work should add the full Lorenz/VICE CIA suites rather than weakening these focused unit tests.

### RESTORE wiring

RESTORE is not a CIA FLAG input. It is modeled as a separate motherboard NMI source in `C64Machine`; CIA2 interrupts reach NMI independently through CIA2's own interrupt output.
