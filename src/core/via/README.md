# MOS 6522 VIA core

## Overview

`Via6522` is the browser-independent, cycle-stepped MOS 6522 Versatile Interface Adapter used by the 1541 drive. It exposes the sixteen-register programming model, two bidirectional parallel ports, timers, control lines, shift register, and interrupt controller.

## Architecture

The VIA owns no host/browser state. External hardware is attached through input providers and output callbacks for PA/PB and CA2/CB1/CB2. CA1/CA2/CB1/CB2 input lines are driven explicitly, which lets the same core connect to IEC logic, the 1541 gate-array/mechanism model, or future peripherals.

Timers advance from `tick()` in PHI2 units. IRQ is derived from `IFR & IER`, while `peek()` returns register state without clearing flags or triggering handshake side effects.

## Implementation notes

The implementation covers the behavior needed by stock 1541 DOS: Timer 1 one-shot/continuous operation and PB7 output, Timer 2 PHI2/pulse counting, CA/CB edge interrupts, handshake/pulse/manual control outputs, IER/IFR semantics, and all shift-register clock-mode families. Exact transistor-level timer edge quirks and rare shift-register silicon anomalies remain compatibility-test targets rather than being inferred.
