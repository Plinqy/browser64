import { describe, expect, it } from 'vitest';
import { KeyboardMatrix } from '../../src/core/cia/KeyboardMatrix';
import type { JoystickControl, JoystickPort } from '../../src/core/io/C64Io';
import { HostInputController } from '../../src/input/HostInputController';

function fixture(): {
  keyboard: KeyboardMatrix;
  controller: HostInputController;
  restoreEvents: boolean[];
  joystickEvents: Array<[JoystickPort, JoystickControl, boolean]>;
} {
  const keyboard = new KeyboardMatrix();
  const restoreEvents: boolean[] = [];
  const joystickEvents: Array<[JoystickPort, JoystickControl, boolean]> = [];
  const controller = new HostInputController(keyboard, {
    setRestorePressed: (pressed) => restoreEvents.push(pressed),
    setJoystickControl: (port, control, pressed) => joystickEvents.push([port, control, pressed])
  });
  return { keyboard, controller, restoreEvents, joystickEvents };
}

describe('HostInputController', () => {
  it('maps ordinary letters to the physical keyboard matrix', () => {
    const { keyboard, controller } = fixture();

    expect(controller.keyDown('KeyA', 'a')).toBe(true);
    expect(keyboard.isPressed(1, 2)).toBe(true);
    controller.keyUp('KeyA');
    expect(keyboard.isPressed(1, 2)).toBe(false);
  });

  it('synthesizes the C64 shift key for uppercase letters and cursor-left', () => {
    const { keyboard, controller } = fixture();

    controller.keyDown('KeyA', 'A');
    expect(keyboard.isPressed(1, 2)).toBe(true);
    expect(keyboard.isPressed(1, 7)).toBe(true);
    controller.keyUp('KeyA');

    controller.keyDown('ArrowLeft', 'ArrowLeft');
    expect(keyboard.isPressed(0, 2)).toBe(true);
    expect(keyboard.isPressed(1, 7)).toBe(true);
  });

  it('maps BASIC punctuation including quotes and colon to real C64 key chords', () => {
    const { keyboard, controller } = fixture();

    controller.keyDown('QuoteHost', '"');
    expect(keyboard.isPressed(7, 3)).toBe(true);
    expect(keyboard.isPressed(1, 7)).toBe(true);
    controller.keyUp('QuoteHost');

    controller.keyDown('ColonHost', ':');
    expect(keyboard.isPressed(5, 5)).toBe(true);
    expect(keyboard.isPressed(1, 7)).toBe(false);
    controller.keyUp('ColonHost');
  });

  it('uses the C64 PA/PB matrix convention for SPACE and F1', () => {
    const { keyboard, controller } = fixture();

    controller.keyDown('Space', ' ');
    expect(keyboard.isPressed(7, 4)).toBe(true);
    controller.keyUp('Space');

    controller.keyDown('F1', 'F1');
    expect(keyboard.isPressed(0, 4)).toBe(true);
  });

  it('maps PageUp to RESTORE without putting it in the CIA matrix', () => {
    const { keyboard, controller, restoreEvents } = fixture();

    controller.keyDown('PageUp', 'PageUp');
    controller.keyUp('PageUp');

    expect(restoreEvents).toEqual([true, false]);
    expect(keyboard.readRows(0xff)).toBe(0xff);
  });

  it('redirects arrows and Space to the selected joystick port', () => {
    const { keyboard, controller, joystickEvents } = fixture();
    controller.setJoystickCapture(2);

    controller.keyDown('ArrowUp', 'ArrowUp');
    controller.keyDown('Space', ' ');
    controller.keyUp('ArrowUp');
    controller.keyUp('Space');

    expect(joystickEvents).toEqual([
      [2, 'up', true],
      [2, 'fire', true],
      [2, 'up', false],
      [2, 'fire', false]
    ]);
    expect(keyboard.readRows(0xff)).toBe(0xff);
  });

  it('releases a held joystick control when switching ports and routes new input to the new port', () => {
    const { controller, joystickEvents } = fixture();
    controller.setJoystickCapture(1);
    controller.keyDown('ArrowLeft', 'ArrowLeft');

    controller.setJoystickCapture(2);
    controller.keyDown('Space', ' ');
    controller.keyUp('Space');

    expect(joystickEvents).toEqual([
      [1, 'left', true],
      [1, 'left', false],
      [2, 'fire', true],
      [2, 'fire', false]
    ]);
  });

  it('releases held matrix, RESTORE, and joystick state on blur-style releaseAll', () => {
    const { keyboard, controller, restoreEvents, joystickEvents } = fixture();
    controller.setJoystickCapture(1);
    controller.keyDown('ArrowRight', 'ArrowRight');
    controller.keyDown('PageUp', 'PageUp');
    controller.keyDown('KeyA', 'a');

    controller.releaseAll();

    expect(keyboard.readRows(0xff)).toBe(0xff);
    expect(restoreEvents.at(-1)).toBe(false);
    expect(joystickEvents.at(-1)).toEqual([1, 'right', false]);
  });
});
