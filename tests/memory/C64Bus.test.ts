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
    bus.writePhysicalRam(0xd020, 0x44);
    bus.write(0xd020, 0x07);

    expect(bus.peek(0xd020)).toBe(0x07);
    expect(bus.read(0xd020)).toBe(0x07);
    expect(bus.readPhysicalRam(0xd020)).toBe(0x44);
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

describe('C64Bus VIC-II memory view', () => {
  it('applies CIA2 bank selection independently from CPU banking', () => {
    const bus = new C64Bus();
    const character = new Uint8Array(0x1000);
    character[0] = 0x5a;
    bus.roms.load('character', character);

    bus.writePhysicalRam(0x1000, 0x11);
    bus.writePhysicalRam(0x5000, 0x22);

    // CIA2 inputs are high after reset, selecting VIC bank 0.
    expect(bus.vicBankNumber).toBe(0);
    expect(bus.readVicMemory(0x1000)).toBe(0x5a);

    // CIA2 PA1..PA0 = %10 selects bank 1 ($4000-$7FFF).
    bus.io.cia2.write(0x02, 0x03);
    bus.io.cia2.write(0x00, 0x02);
    expect(bus.vicBankNumber).toBe(1);
    expect(bus.readVicMemory(0x1000)).toBe(0x22);
  });

  it('shadows character ROM in VIC banks 0 and 2 but not banks 1 and 3', () => {
    const bus = new C64Bus();
    const character = new Uint8Array(0x1000);
    character[0x0123] = 0xa7;
    bus.roms.load('character', character);

    bus.writePhysicalRam(0x1123, 0x10);
    bus.writePhysicalRam(0x5123, 0x11);
    bus.writePhysicalRam(0x9123, 0x12);
    bus.writePhysicalRam(0xd123, 0x13);
    bus.io.cia2.write(0x02, 0x03);

    for (const [pins, expected] of [[0x03, 0xa7], [0x02, 0x11], [0x01, 0xa7], [0x00, 0x13]] as const) {
      bus.io.cia2.write(0x00, pins);
      expect(bus.readVicMemory(0x1123)).toBe(expected);
    }
  });
});

describe('C64Bus CPU data-bus/open-bus behavior', () => {
  it('returns the last CPU bus value from undriven expansion I/O', () => {
    const bus = new C64Bus();

    bus.write(0x2000, 0xa5);
    expect(bus.systemDataBusValue).toBe(0xa5);
    expect(bus.read(0xde00)).toBe(0xa5);
  });

  it('lets a VIC memory fetch refresh the shared open-bus latch', () => {
    const bus = new C64Bus();
    bus.writePhysicalRam(0x0200, 0x6c);

    expect(bus.readVicMemory(0x0200)).toBe(0x6c);
    expect(bus.read(0xde00)).toBe(0x6c);
  });

  it('merges color RAM low bits with the previous CPU bus high nibble', () => {
    const bus = new C64Bus();
    bus.io.colorRam.write(0, 0x0b);

    bus.write(0x2000, 0xa5);
    expect(bus.read(0xd800)).toBe(0xab);
    expect(bus.systemDataBusValue).toBe(0xab);
  });

  it('keeps debugger peeks side-effect free with respect to the bus latch', () => {
    const bus = new C64Bus();

    bus.write(0x2000, 0x5a);
    bus.writePhysicalRam(0x3000, 0xc3);
    expect(bus.peek(0x3000)).toBe(0xc3);
    expect(bus.systemDataBusValue).toBe(0x5a);
    expect(bus.peek(0xde00)).toBe(0x5a);
  });
});
