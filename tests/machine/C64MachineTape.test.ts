import { describe, expect, it } from 'vitest';
import { C64Machine } from '../../src/core/machine/C64Machine';

function tapWithPulse(cycles: number): Uint8Array {
  const bytes = new Uint8Array(0x18);
  for (let i = 0; i < 12; i += 1) bytes[i] = 'C64-TAPE-RAW'.charCodeAt(i);
  bytes[0x0c] = 1;
  bytes[0x10] = 4;
  bytes[0x14] = 0;
  bytes[0x15] = cycles & 0xff;
  bytes[0x16] = (cycles >> 8) & 0xff;
  bytes[0x17] = (cycles >> 16) & 0xff;
  return bytes;
}

describe('C64Machine Datasette integration', () => {
  it('wires PLAY to processor-port SENSE and MOTOR to timed CIA1 FLAG pulses', () => {
    const machine = new C64Machine();
    machine.mountTap(tapWithPulse(8));
    machine.playTape();

    expect(machine.bus.processorPortPins & 0x10).toBe(0); // SENSE low

    machine.bus.write(0x0001, machine.bus.processorPortDataLatch & ~0x20); // MOTOR on
    const spinup = Math.round(machine.timing.systemClockHz * 0.30);
    for (let i = 0; i < spinup + 8; i += 1) machine.tickSystemCycle();

    expect(machine.bus.io.cia1.peek(0x0d) & 0x10).toBe(0x10);
  });
});
