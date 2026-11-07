import { describe, expect, it } from 'vitest';
import { C64Bus } from '../../src/core/memory/C64Bus';

function filled(size: number, value: number): Uint8Array {
  return new Uint8Array(size).fill(value & 0xff);
}

function busWithRoms(): C64Bus {
  const bus = new C64Bus();
  bus.roms.load('basic', filled(0x2000, 0xba));
  bus.roms.load('kernal', filled(0x2000, 0xe0));
  bus.roms.load('character', filled(0x1000, 0xcc));
  return bus;
}

describe('C64Bus 6510 processor port', () => {
  it('starts in the deterministic stock $2F/$37 configuration', () => {
    const bus = new C64Bus();

    expect(bus.read(0x0000)).toBe(0x2f);
    expect(bus.read(0x0001)).toBe(0x37);
    expect(bus.configuration).toMatchObject({
      loram: true,
      hiram: true,
      charen: true,
      basicVisible: true,
      kernalVisible: true,
      ioVisible: true,
      characterVisible: false
    });
  });

  it('$0000/$0001 are internal registers and do not modify physical RAM', () => {
    const bus = new C64Bus();
    bus.writePhysicalRam(0x0000, 0xaa);
    bus.writePhysicalRam(0x0001, 0xbb);

    bus.write(0x0000, 0x07);
    bus.write(0x0001, 0x05);

    expect(bus.read(0x0000)).toBe(0x07);
    expect(bus.read(0x0001) & 0x07).toBe(0x05);
    expect(bus.readPhysicalRam(0x0000)).toBe(0xaa);
    expect(bus.readPhysicalRam(0x0001)).toBe(0xbb);
  });

  it('uses external pin levels for processor-port bits configured as inputs', () => {
    const bus = new C64Bus();
    bus.write(0x0001, 0x00);
    bus.write(0x0000, 0x00);

    expect(bus.processorPortPins & 0x07).toBe(0x07);
    expect(bus.configuration.basicVisible).toBe(true);
    expect(bus.configuration.kernalVisible).toBe(true);
    expect(bus.configuration.ioVisible).toBe(true);
  });
});

describe('C64Bus stock no-cartridge banking', () => {
  const expected = [
    { bits: 0b000, basic: false, kernal: false, io: false, char: false },
    { bits: 0b001, basic: false, kernal: false, io: false, char: true },
    { bits: 0b010, basic: false, kernal: true,  io: false, char: true },
    { bits: 0b011, basic: true,  kernal: true,  io: false, char: true },
    { bits: 0b100, basic: false, kernal: false, io: false, char: false },
    { bits: 0b101, basic: false, kernal: false, io: true,  char: false },
    { bits: 0b110, basic: false, kernal: true,  io: true,  char: false },
    { bits: 0b111, basic: true,  kernal: true,  io: true,  char: false }
  ] as const;

  for (const entry of expected) {
    it(`maps control bits %${entry.bits.toString(2).padStart(3, '0')} correctly`, () => {
      const bus = new C64Bus();
      bus.write(0x0001, entry.bits);

      expect(bus.configuration.basicVisible).toBe(entry.basic);
      expect(bus.configuration.kernalVisible).toBe(entry.kernal);
      expect(bus.configuration.ioVisible).toBe(entry.io);
      expect(bus.configuration.characterVisible).toBe(entry.char);
    });
  }

  it('reads BASIC and KERNAL ROM while preserving writes in RAM underneath', () => {
    const bus = busWithRoms();

    bus.write(0xa123, 0x11);
    bus.write(0xe456, 0x22);

    expect(bus.read(0xa123)).toBe(0xba);
    expect(bus.read(0xe456)).toBe(0xe0);
    expect(bus.readPhysicalRam(0xa123)).toBe(0x11);
    expect(bus.readPhysicalRam(0xe456)).toBe(0x22);

    bus.write(0x0001, 0x00);
    expect(bus.read(0xa123)).toBe(0x11);
    expect(bus.read(0xe456)).toBe(0x22);
  });

  it('switches $D000-$DFFF among I/O, character ROM, and RAM', () => {
    const bus = busWithRoms();
    bus.writePhysicalRam(0xd020, 0x44);

    // %111: I/O
    bus.write(0xd020, 0x06);
    expect(bus.read(0xd020)).toBe(0x06);
    expect(bus.readPhysicalRam(0xd020)).toBe(0x44);

    // %011: character ROM. Writes still go to the RAM underneath.
    bus.write(0x0001, 0x03);
    expect(bus.read(0xd020)).toBe(0xcc);
    bus.write(0xd020, 0x55);
    expect(bus.read(0xd020)).toBe(0xcc);
    expect(bus.readPhysicalRam(0xd020)).toBe(0x55);

    // %000: all RAM in the three banked regions.
    bus.write(0x0001, 0x00);
    expect(bus.read(0xd020)).toBe(0x55);
  });

  it('routes debugger peeks through the same visible bank without changing storage', () => {
    const bus = busWithRoms();
    bus.write(0xd012, 0x77);

    expect(bus.peek(0xd012)).toBe(0x77);
    expect(bus.read(0xd012)).toBe(0x77);
  });
});

describe('C64Bus CIA2 VIC bank selection', () => {
  it('starts in VIC bank 0 while CIA2 PA0/PA1 are pulled-up inputs', () => {
    const bus = new C64Bus();
    expect(bus.vicBankNumber).toBe(0);
    expect(bus.vicBankBase).toBe(0x0000);
  });

  it('uses inverted CIA2 PA0/PA1 outputs to select all four 16 KiB VIC banks', () => {
    const bus = new C64Bus();
    bus.io.cia2.write(0x02, 0x03);

    const cases = [
      { bits: 0x03, bank: 0, base: 0x0000 },
      { bits: 0x02, bank: 1, base: 0x4000 },
      { bits: 0x01, bank: 2, base: 0x8000 },
      { bits: 0x00, bank: 3, base: 0xc000 }
    ] as const;

    for (const entry of cases) {
      bus.io.cia2.write(0x00, entry.bits);
      expect(bus.vicBankNumber).toBe(entry.bank);
      expect(bus.vicBankBase).toBe(entry.base);
    }
  });
});
