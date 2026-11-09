# Browser Input Adapter

The `src/input` layer translates host keyboard names into physical C64 keyboard-matrix closures, joystick lines, and RESTORE events. It intentionally sits outside `src/core` so the emulated chips remain independent of DOM/browser APIs.

`HostInputController` itself accepts plain `code`/`key` strings instead of `KeyboardEvent` objects, which keeps the mapping unit-testable in Node. `main.ts` owns the actual event listeners and decides when browser input is captured.

Browser64 exposes input as two explicit UI choices: **Input mode** (`C64 keyboard` or `Joystick`) and, in joystick mode, **Joystick port** (`Port 1` or `Port 2`). In keyboard mode, arrow keys map to the C64 cursor keys and Space maps to the C64 SPACE key. In joystick mode, Arrow keys become Up/Down/Left/Right and Space becomes Fire on the selected active-low CIA1 control port. Port 2 is preselected when joystick mode is first chosen because it is the most common game configuration, but either port can be selected. Page Up maps to RESTORE, Escape maps to RUN/STOP, Alt maps to the Commodore key, and the normal function/cursor key combinations synthesize the C64's shifted physical keys where necessary.


### CIA pin-level joystick behavior

The control-port switches are electrical pull-downs on CIA1's physical pins. Browser64 therefore resolves an external low even when the corresponding CIA bit is configured as an output and its data latch is high. This matters most for joystick Port 2 (`$DC00`): the KERNAL normally leaves CIA1 Port A configured as outputs for keyboard scanning, but a real joystick must still be able to pull Up/Down/Left/Right/Fire low and be observed by software reading `$DC00`.
