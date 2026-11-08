import { describe, expect, it } from 'vitest';
import { IecBus } from '../../src/core/iec/IecBus';
import { C64Io } from '../../src/core/io/C64Io';

describe('IecBus', () => {
  it('resolves open-collector lines low when any endpoint pulls low', () => {
    const bus = new IecBus();
    const c64 = bus.createEndpoint('c64');
    const drive = bus.createEndpoint('drive8');

    expect(bus.snapshot()).toEqual({ atnHigh: true, clockHigh: true, dataHigh: true });

    c64.setPulledLow('clock', true);
    expect(bus.clockHigh).toBe(false);

    drive.setPulledLow('clock', true);
    c64.release('clock');
    expect(bus.clockHigh).toBe(false);

    drive.release('clock');
    expect(bus.clockHigh).toBe(true);
  });

  it('keeps endpoint state coherent after a bus-wide release', () => {
    const bus = new IecBus();
    const drive = bus.createEndpoint('drive8');

    drive.setPulledLow('clock', true);
    bus.releaseAll();
    expect(bus.clockHigh).toBe(true);

    // Reasserting the same endpoint signal must drive the bus again.
    drive.setPulledLow('clock', true);
    expect(bus.clockHigh).toBe(false);
  });

  it('releases detached endpoints without disturbing other drivers', () => {
    const bus = new IecBus();
    const first = bus.createEndpoint('first');
    const second = bus.createEndpoint('second');

    first.setPulledLow('data', true);
    second.setPulledLow('atn', true);
    first.detach();

    expect(bus.dataHigh).toBe(true);
    expect(bus.atnHigh).toBe(false);
    expect(() => first.setPulledLow('data', true)).toThrow(/detached/i);
  });
});

describe('C64 CIA2 IEC wiring', () => {
  it('maps PA3-PA5 output ones through the inverting open-collector drivers', () => {
    const io = new C64Io();

    io.write(0x0d02, 0x38); // DDRA: PA3/PA4/PA5 outputs
    io.write(0x0d00, 0x08); // ATN output one, CLK/DATA output zero

    expect(io.iecBus.atnHigh).toBe(false);
    expect(io.iecBus.clockHigh).toBe(true);
    expect(io.iecBus.dataHigh).toBe(true);

    io.write(0x0d00, 0x30);
    expect(io.iecBus.atnHigh).toBe(true);
    expect(io.iecBus.clockHigh).toBe(false);
    expect(io.iecBus.dataHigh).toBe(false);
  });

  it('keeps IEC outputs synchronized for direct CIA2 register access', () => {
    const io = new C64Io();

    io.cia2.write(0x02, 0x38);
    io.cia2.write(0x00, 0x20);

    expect(io.iecBus.atnHigh).toBe(true);
    expect(io.iecBus.clockHigh).toBe(true);
    expect(io.iecBus.dataHigh).toBe(false);
  });

  it('feeds resolved CLOCK/DATA bus levels back into CIA2 PA6/PA7 inputs', () => {
    const io = new C64Io();
    const drive = io.iecBus.createEndpoint('drive8');

    io.write(0x0d02, 0x38); // C64 IEC outputs; PA6/PA7 remain inputs.
    io.write(0x0d00, 0x00);
    expect(io.cia2.read(0x00) & 0xc0).toBe(0xc0);

    drive.setPulledLow('clock', true);
    expect(io.cia2.read(0x00) & 0xc0).toBe(0x80);

    drive.setPulledLow('data', true);
    expect(io.cia2.read(0x00) & 0xc0).toBe(0x00);

    drive.releaseAll();
    expect(io.cia2.read(0x00) & 0xc0).toBe(0xc0);
  });

  it('releases only the C64 IEC outputs on I/O reset', () => {
    const io = new C64Io();
    const drive = io.iecBus.createEndpoint('drive8');

    io.write(0x0d02, 0x38);
    io.write(0x0d00, 0x38);
    drive.setPulledLow('data', true);

    io.reset();

    expect(io.iecBus.atnHigh).toBe(true);
    expect(io.iecBus.clockHigh).toBe(true);
    expect(io.iecBus.dataHigh).toBe(false);
  });
});
