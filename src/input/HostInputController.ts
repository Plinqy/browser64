import type { KeyboardMatrix } from '../core/cia/KeyboardMatrix';
import type { JoystickControl, JoystickPort } from '../core/io/C64Io';

interface MatrixKey {
  readonly column: number;
  readonly row: number;
}

interface MatrixBinding {
  readonly kind: 'matrix';
  readonly keys: readonly MatrixKey[];
  readonly suppressPhysicalShift?: boolean;
}

interface RestoreBinding {
  readonly kind: 'restore';
}

type HostBinding = MatrixBinding | RestoreBinding;

export interface HostInputCallbacks {
  setRestorePressed(pressed: boolean): void;
  setJoystickControl(port: JoystickPort, control: JoystickControl, pressed: boolean): void;
}

export type JoystickCapturePort = JoystickPort | null;

const SHIFT_LEFT = key(1, 7);
const SHIFT_RIGHT = key(6, 4);

/**
 * Browser-key-name adapter that remains independent from DOM event classes.
 * main.ts passes KeyboardEvent.code/key strings into this controller.
 */
export class HostInputController {
  private readonly active = new Map<string, HostBinding>();
  private readonly activeJoystick = new Map<string, JoystickControl>();
  private joystickCapture: JoystickCapturePort = null;

  constructor(
    private readonly keyboard: KeyboardMatrix,
    private readonly callbacks: HostInputCallbacks
  ) {}

  setJoystickCapture(port: JoystickCapturePort): void {
    if (this.joystickCapture === port) {
      return;
    }

    this.releaseJoystickKeys();
    this.joystickCapture = port;
  }

  /** Returns true when the host key was consumed by the emulated machine. */
  keyDown(code: string, hostKey: string): boolean {
    if (this.joystickCapture !== null) {
      const joystickControl = joystickBinding(code);
      if (joystickControl !== null) {
        if (!this.activeJoystick.has(code)) {
          this.activeJoystick.set(code, joystickControl);
          this.callbacks.setJoystickControl(this.joystickCapture, joystickControl, true);
        }
        return true;
      }
    }

    if (this.active.has(code)) {
      return true;
    }

    const binding = hostBinding(code, hostKey);
    if (binding === null) {
      return false;
    }

    this.active.set(code, binding);
    this.rebuildKeyboard();
    this.updateRestore();
    return true;
  }

  /** Returns true when the host key had been captured. */
  keyUp(code: string): boolean {
    const joystickControl = this.activeJoystick.get(code);
    if (joystickControl !== undefined) {
      const port = this.joystickCapture;
      this.activeJoystick.delete(code);
      if (port !== null) {
        this.callbacks.setJoystickControl(port, joystickControl, false);
      }
      return true;
    }

    if (!this.active.delete(code)) {
      return false;
    }

    this.rebuildKeyboard();
    this.updateRestore();
    return true;
  }

  releaseAll(): void {
    this.active.clear();
    this.keyboard.clear();
    this.callbacks.setRestorePressed(false);
    this.releaseJoystickKeys();
  }

  private rebuildKeyboard(): void {
    this.keyboard.clear();

    const suppressPhysicalShift = [...this.active.values()].some(
      (binding) => binding.kind === 'matrix' && binding.suppressPhysicalShift === true
    );

    for (const [code, binding] of this.active) {
      if (binding.kind !== 'matrix') {
        continue;
      }

      if (suppressPhysicalShift && (code === 'ShiftLeft' || code === 'ShiftRight')) {
        continue;
      }

      for (const matrixKey of binding.keys) {
        this.keyboard.press(matrixKey.column, matrixKey.row);
      }
    }
  }

  private updateRestore(): void {
    const pressed = [...this.active.values()].some((binding) => binding.kind === 'restore');
    this.callbacks.setRestorePressed(pressed);
  }

  private releaseJoystickKeys(): void {
    if (this.joystickCapture !== null) {
      for (const control of this.activeJoystick.values()) {
        this.callbacks.setJoystickControl(this.joystickCapture, control, false);
      }
    }
    this.activeJoystick.clear();
  }
}

function hostBinding(code: string, hostKey: string): HostBinding | null {
  if (code === 'PageUp') return { kind: 'restore' };
  if (code === 'ShiftLeft') return matrix(SHIFT_LEFT);
  if (code === 'ShiftRight') return matrix(SHIFT_RIGHT);
  if (code === 'ControlLeft' || code === 'ControlRight') return matrix(key(7, 2));
  if (code === 'AltLeft' || code === 'AltRight') return matrix(key(7, 5)); // Commodore
  if (code === 'Escape') return matrix(key(7, 7)); // RUN/STOP
  if (code === 'Enter' || code === 'NumpadEnter') return matrix(key(0, 1));
  if (code === 'Backspace' || code === 'Delete') return matrix(key(0, 0));
  if (code === 'Insert') return matrix(key(0, 0), SHIFT_LEFT);
  if (code === 'Home') return matrix(key(6, 3));
  if (code === 'End') return matrix(key(6, 3), SHIFT_LEFT);

  if (code === 'ArrowRight') return matrix(key(0, 2));
  if (code === 'ArrowLeft') return matrix(key(0, 2), SHIFT_LEFT);
  if (code === 'ArrowDown') return matrix(key(0, 7));
  if (code === 'ArrowUp') return matrix(key(0, 7), SHIFT_LEFT);

  if (code === 'F1') return matrix(key(0, 4));
  if (code === 'F2') return matrix(key(0, 4), SHIFT_LEFT);
  if (code === 'F3') return matrix(key(0, 5));
  if (code === 'F4') return matrix(key(0, 5), SHIFT_LEFT);
  if (code === 'F5') return matrix(key(0, 6));
  if (code === 'F6') return matrix(key(0, 6), SHIFT_LEFT);
  if (code === 'F7') return matrix(key(0, 3));
  if (code === 'F8') return matrix(key(0, 3), SHIFT_LEFT);

  const printable = printableBinding(hostKey);
  return printable;
}

function printableBinding(hostKey: string): MatrixBinding | null {
  if (hostKey.length !== 1) {
    return null;
  }

  const lower = hostKey.toLowerCase();
  const letter = LETTERS[lower];
  if (letter !== undefined) {
    return hostKey === hostKey.toUpperCase() && hostKey !== lower
      ? matrix(letter, SHIFT_LEFT)
      : matrix(letter);
  }

  const binding = PRINTABLE[hostKey];
  return binding ?? null;
}

function joystickBinding(code: string): JoystickControl | null {
  switch (code) {
    case 'ArrowUp': return 'up';
    case 'ArrowDown': return 'down';
    case 'ArrowLeft': return 'left';
    case 'ArrowRight': return 'right';
    case 'Space': return 'fire';
    default: return null;
  }
}

function key(column: number, row: number): MatrixKey {
  return { column, row };
}

function matrix(...keys: readonly MatrixKey[]): MatrixBinding {
  return { kind: 'matrix', keys };
}

function matrixWithoutHostShift(...keys: readonly MatrixKey[]): MatrixBinding {
  return { kind: 'matrix', keys, suppressPhysicalShift: true };
}

const LETTERS: Readonly<Record<string, MatrixKey>> = Object.freeze({
  a: key(1, 2), b: key(3, 4), c: key(2, 4), d: key(2, 2),
  e: key(1, 6), f: key(2, 5), g: key(3, 2), h: key(3, 5),
  i: key(4, 1), j: key(4, 2), k: key(4, 5), l: key(5, 2),
  m: key(4, 4), n: key(4, 7), o: key(4, 6), p: key(5, 1),
  q: key(7, 6), r: key(2, 1), s: key(1, 5), t: key(2, 6),
  u: key(3, 6), v: key(3, 7), w: key(1, 1), x: key(2, 7),
  y: key(3, 1), z: key(1, 4)
});

const PRINTABLE: Readonly<Record<string, MatrixBinding>> = Object.freeze({
  ' ': matrix(key(7, 4)),
  '0': matrix(key(4, 3)),
  '1': matrix(key(7, 0)), '!': matrix(key(7, 0), SHIFT_LEFT),
  '2': matrix(key(7, 3)), '"': matrix(key(7, 3), SHIFT_LEFT),
  '3': matrix(key(1, 0)), '#': matrix(key(1, 0), SHIFT_LEFT),
  '4': matrix(key(1, 3)), '$': matrix(key(1, 3), SHIFT_LEFT),
  '5': matrix(key(2, 0)), '%': matrix(key(2, 0), SHIFT_LEFT),
  '6': matrix(key(2, 3)), '&': matrix(key(2, 3), SHIFT_LEFT),
  '7': matrix(key(3, 0)), "'": matrix(key(3, 0), SHIFT_LEFT),
  '8': matrix(key(3, 3)), '(': matrix(key(3, 3), SHIFT_LEFT),
  '9': matrix(key(4, 0)), ')': matrix(key(4, 0), SHIFT_LEFT),
  '+': matrixWithoutHostShift(key(5, 0)),
  '-': matrix(key(5, 3)),
  '=': matrix(key(6, 5)),
  '*': matrixWithoutHostShift(key(6, 1)),
  '@': matrixWithoutHostShift(key(5, 6)),
  ':': matrixWithoutHostShift(key(5, 5)),
  '[': matrix(key(5, 5), SHIFT_LEFT),
  ';': matrix(key(6, 2)),
  ']': matrix(key(6, 2), SHIFT_LEFT),
  '.': matrix(key(5, 4)), '>': matrix(key(5, 4), SHIFT_LEFT),
  ',': matrix(key(5, 7)), '<': matrix(key(5, 7), SHIFT_LEFT),
  '/': matrix(key(6, 7)), '?': matrix(key(6, 7), SHIFT_LEFT),
  '^': matrixWithoutHostShift(key(6, 6)),
  '£': matrix(key(6, 0)),
  '`': matrix(key(7, 1)),
  '←': matrix(key(7, 1)),
  '↑': matrix(key(6, 6))
});
