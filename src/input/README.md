# Browser Input Adapter

The `src/input` layer translates host keyboard names into physical C64 keyboard-matrix closures, joystick lines, and RESTORE events. It intentionally sits outside `src/core` so the emulated chips remain independent of DOM/browser APIs.

`HostInputController` itself accepts plain `code`/`key` strings instead of `KeyboardEvent` objects, which keeps the mapping unit-testable in Node. `main.ts` owns the actual event listeners and decides when browser input is captured.

Arrow keys normally map to the C64 cursor keys. When joystick capture is enabled, arrows become directions and Space becomes Fire for the selected control port. Page Up maps to RESTORE, Escape maps to RUN/STOP, Alt maps to the Commodore key, and the normal function/cursor key combinations synthesize the C64's shifted physical keys where necessary.
