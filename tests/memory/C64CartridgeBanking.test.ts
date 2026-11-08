import { describe, expect, it } from 'vitest';
import { GenericCartridge } from '../../src/core/cartridge/GenericCartridge';
import { C64Bus } from '../../src/core/memory/C64Bus';

function rom(size: number, value: number): Uint8Array {
  return new Uint8Array(size).fill(value);
}

describe('C64 cartridge PLA banking', () => {
  it('maps 8K ROML only when LORAM and HIRAM expose the cartridge window', () => {
    const bus = new C64Bus();
    bus.roms.basic.fill(0xba);
    bus.attachCartridge(GenericCartridge.fromRaw(rom(0x2000, 0x81), '8k'));

    expect(bus.read(0x8000)).toBe(0x81);
    expect(bus.read(0xa000)).toBe(0xba);

    bus.write(0x0001, 0x36); // LORAM=0, HIRAM=1, CHAREN=1
    bus.writePhysicalRam(0x8000, 0x44);
    expect(bus.read(0x8000)).toBe(0x44);
  });

  it('maps 16K ROMH with HIRAM and ROML only with LORAM+HIRAM', () => {
    const bytes = new Uint8Array(0x4000);
    bytes.fill(0x80, 0, 0x2000);
    bytes.fill(0xa0, 0x2000);
    const bus = new C64Bus();
    bus.attachCartridge(GenericCartridge.fromRaw(bytes, '16k'));

    expect(bus.read(0x8000)).toBe(0x80);
    expect(bus.read(0xa000)).toBe(0xa0);

    bus.write(0x0001, 0x36);
    bus.writePhysicalRam(0x8000, 0x22);
    expect(bus.read(0x8000)).toBe(0x22);
    expect(bus.read(0xa000)).toBe(0xa0);
  });

  it('keeps RAM writes beneath normal cartridge ROM', () => {
    const bus = new C64Bus();
    bus.attachCartridge(GenericCartridge.fromRaw(rom(0x2000, 0xcc), '8k'));
    bus.write(0x8000, 0x5a);
    expect(bus.read(0x8000)).toBe(0xcc);
    expect(bus.readPhysicalRam(0x8000)).toBe(0x5a);
  });

  it('implements Ultimax open regions, forced I/O, ROMH, and VIC ROMH visibility', () => {
    const bytes = new Uint8Array(0x4000);
    bytes.fill(0x80, 0, 0x2000);
    bytes.fill(0xe0, 0x2000);
    bytes[0x3000] = 0xf3; // CPU $F000 / VIC-relative $3000

    const bus = new C64Bus();
    bus.attachCartridge(GenericCartridge.fromRaw(bytes, 'ultimax'));
    bus.write(0x0001, 0x30); // banking bits ignored by Ultimax

    bus.write(0x0002, 0x5a); // drives data bus and low RAM
    expect(bus.read(0x1000)).toBe(0x5a); // open bus
    expect(bus.configuration.ioVisible).toBe(true);
    expect(bus.read(0x8000)).toBe(0x80);
    expect(bus.read(0xe000)).toBe(0xe0);
    expect(bus.readVicMemory(0x3000)).toBe(0xf3);

    bus.writePhysicalRam(0xa000, 0x77);
    bus.write(0xa000, 0x33);
    expect(bus.readPhysicalRam(0xa000)).toBe(0x77);
  });
});
