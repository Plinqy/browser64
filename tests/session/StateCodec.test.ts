import { describe, expect, it } from 'vitest';
import { C64Machine } from '../../src/core';
import { decodeMachineState, encodeMachineState } from '../../src/session/StateCodec';

describe('portable C64 state codec', () => {
  it('round-trips nested Uint8Array state without losing binary data', () => {
    const machine = new C64Machine();
    machine.bus.writePhysicalRam(0x1234, 0xab);
    machine.bus.io.colorRam.write(0x003, 0x0e);
    machine.bus.io.vic.write(0x21, 0x07);
    const source = machine.saveState();

    const decoded = decodeMachineState(encodeMachineState(source));

    expect(decoded.format).toBe('c64-browser-emulator-state');
    expect(decoded.version).toBe(1);
    expect(decoded.bus.ram).toBeInstanceOf(Uint8Array);
    expect(decoded.bus.ram[0x1234]).toBe(0xab);
    expect(decoded.bus.colorRam[0x003]).toBe(0x0e);
    expect(decoded.bus.vic.registers).toBeInstanceOf(Uint8Array);
    expect(decoded.bus.vic.registers[0x21]).toBe(0x07);
  });

  it('rejects unrelated JSON', () => {
    expect(() => decodeMachineState('{"hello":"world"}')).toThrow(/not a supported C64 save state/);
  });
});
