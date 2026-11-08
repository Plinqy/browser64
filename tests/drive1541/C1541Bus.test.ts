import { describe, expect, it } from 'vitest';
import { C1541Bus, C1541_ROM_SIZE } from '../../src/core/drive1541/C1541Bus';

describe('C1541Bus', () => {
  it('maps 2 KiB RAM through the stock A13/A14 mirror decode', () => {
    const bus = new C1541Bus();
    bus.write(0x0123, 0x5a);
    expect(bus.read(0x0123)).toBe(0x5a);
    expect(bus.read(0x2123)).toBe(0x5a);
    expect(bus.read(0x4123)).toBe(0x5a);
    expect(bus.read(0x6123)).toBe(0x5a);
  });

  it('routes the mirrored $1800 and $1c00 regions to separate VIAs', () => {
    const bus = new C1541Bus();
    bus.write(0x1802, 0xff);
    bus.write(0x1c02, 0x0f);
    expect(bus.via0.dataDirectionB).toBe(0xff);
    expect(bus.via1.dataDirectionB).toBe(0x0f);

    bus.write(0x3bf2, 0x55); // VIA0 mirror, register 2
    expect(bus.via0.dataDirectionB).toBe(0x55);
    bus.write(0x5ff2, 0xaa); // VIA1 mirror, register 2
    expect(bus.via1.dataDirectionB).toBe(0xaa);
  });

  it('requires a 16 KiB ROM and mirrors it across $8000-$ffff', () => {
    const bus = new C1541Bus();
    expect(() => bus.loadRom(new Uint8Array(8192))).toThrow(/exactly 16384/i);

    const rom = new Uint8Array(C1541_ROM_SIZE);
    rom[0] = 0x11;
    rom[0x3fff] = 0x22;
    bus.loadRom(rom);
    expect(bus.read(0x8000)).toBe(0x11);
    expect(bus.read(0xc000)).toBe(0x11);
    expect(bus.read(0xbfff)).toBe(0x22);
    expect(bus.read(0xffff)).toBe(0x22);
  });

  it('keeps peek side-effect free for VIA interrupt flags', () => {
    const bus = new C1541Bus();
    bus.via0.write(0x0e, 0x82);
    bus.via0.setCa1Line(false);
    expect(bus.via0.irqAsserted).toBe(true);
    bus.peek(0x1801);
    expect(bus.via0.irqAsserted).toBe(true);
    bus.read(0x1801);
    expect(bus.via0.irqAsserted).toBe(false);
  });
});
