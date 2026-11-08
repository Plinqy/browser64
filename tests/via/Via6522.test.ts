import { describe, expect, it } from 'vitest';
import { Via6522, ViaInterruptFlag } from '../../src/core/via/Via6522';

describe('Via6522 ports and interrupts', () => {
  it('resolves input and output bits through DDR registers', () => {
    const via = new Via6522();
    via.setPortAInputProvider(() => 0x5a);
    via.write(0x03, 0xf0);
    via.write(0x01, 0xa5);

    expect(via.read(0x0f)).toBe(0xaa);
    expect(via.portAOutputPins).toBe(0xaf);
  });

  it('latches CA1 and CB1 on the PCR-selected active edge', () => {
    const via = new Via6522();
    via.write(0x0e, 0x80 | ViaInterruptFlag.Ca1 | ViaInterruptFlag.Cb1);

    via.setCa1Line(false); // default negative edge
    expect(via.irqAsserted).toBe(true);
    expect(via.read(0x0d) & ViaInterruptFlag.Ca1).toBe(ViaInterruptFlag.Ca1);
    via.read(0x01);
    expect(via.irqAsserted).toBe(false);

    via.write(0x0c, 0x10); // CB1 positive edge
    via.setCb1Line(false);
    via.setCb1Line(true);
    expect(via.read(0x0d) & ViaInterruptFlag.Cb1).toBe(ViaInterruptFlag.Cb1);
  });

  it('implements IFR write-to-clear and IER set/clear semantics', () => {
    const via = new Via6522();
    via.write(0x0e, 0x82); // enable CA1
    expect(via.read(0x0e)).toBe(0x82);

    via.setCa1Line(false);
    expect(via.read(0x0d)).toBe(0x82);
    via.write(0x0d, 0x02);
    expect(via.read(0x0d)).toBe(0x00);

    via.write(0x0e, 0x02); // clear enable bit
    expect(via.read(0x0e)).toBe(0x80);
  });
});

describe('Via6522 timers and control outputs', () => {
  it('runs Timer 1 and raises an enabled interrupt on underflow', () => {
    const via = new Via6522();
    via.write(0x0e, 0xc0);
    via.write(0x04, 0x02);
    via.write(0x05, 0x00);

    via.tick(3);
    expect(via.timer1CounterValue).toBe(0);
    expect(via.irqAsserted).toBe(false);
    via.tick(1);
    expect(via.irqAsserted).toBe(true);
    expect(via.read(0x04)).toBe(0xff);
    expect(via.irqAsserted).toBe(false);
  });

  it('reloads continuous Timer 1 and toggles PB7', () => {
    const via = new Via6522();
    via.write(0x0b, 0xc0); // PB7 output + continuous T1
    via.write(0x02, 0x80);
    via.write(0x04, 0x01);
    via.write(0x05, 0x00);
    const before = via.portBOutputPins & 0x80;

    via.tick(3);
    const after = via.portBOutputPins & 0x80;
    expect(after).not.toBe(before);
    expect(via.timer1CounterValue).toBe(1);
  });

  it('supports CA2 pulse-output mode', () => {
    const via = new Via6522();
    via.write(0x0c, 0x0a); // CA2 pulse output (mode 5)
    expect(via.ca2OutputHigh).toBe(true);
    via.write(0x01, 0x55);
    expect(via.ca2OutputHigh).toBe(false);
    via.tick(1);
    expect(via.ca2OutputHigh).toBe(true);
  });

  it('clocks an external shift input through CB1', () => {
    const via = new Via6522();
    via.write(0x0b, 0x0c); // shift in under external CB1 clock (mode 3)
    via.write(0x0a, 0x00);

    for (const bit of [1, 0, 1, 0, 0, 1, 0, 1]) {
      via.setCb2Line(bit !== 0);
      via.setCb1Line(false);
      via.setCb1Line(true);
    }

    expect(via.shiftRegisterValue).toBe(0xa5);
    expect(via.read(0x0d) & ViaInterruptFlag.ShiftRegister).toBe(ViaInterruptFlag.ShiftRegister);
  });
});
