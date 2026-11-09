import { describe, expect, it } from 'vitest';
import type { CartridgeDevice } from '../../src/core/cartridge/Cartridge';
import { C64Machine } from '../../src/core/machine/C64Machine';

class InterruptCartridge implements CartridgeDevice {
  readonly name = 'interrupt test';
  readonly gameHigh = true;
  readonly exromHigh = true;
  irqLow = false;
  nmiLow = false;
  dmaLow = false;

  reset(): void {
    this.irqLow = false;
    this.nmiLow = false;
  }
  freeze(): void { this.nmiLow = true; }
  readRomL(): number | undefined { return undefined; }
  readRomH(): number | undefined { return undefined; }
  readIo1(): number | undefined { return undefined; }
  readIo2(): number | undefined { return undefined; }
  writeIo1(): void {}
  writeIo2(): void {}
}

describe('C64Machine expansion interrupt hooks', () => {
  it('merges expansion IRQ into the motherboard IRQ line and records the source', () => {
    const machine = new C64Machine();
    const cart = new InterruptCartridge();
    machine.bus.attachCartridge(cart);
    cart.irqLow = true;

    machine.tickSystemCycle();
    expect(machine.monitor.interruptHistory.at(-1)).toMatchObject({
      kind: 'IRQ',
      asserted: true,
      sources: ['EXPANSION']
    });
  });

  it('turns a FREEZE-triggered expansion NMI assertion into one NMI edge', () => {
    const machine = new C64Machine();
    const cart = new InterruptCartridge();
    machine.bus.attachCartridge(cart);

    machine.pressCartridgeFreeze();
    expect(machine.monitor.interruptHistory.at(-1)).toMatchObject({
      kind: 'NMI',
      asserted: true,
      sources: ['EXPANSION']
    });

    const count = machine.monitor.interruptHistory.filter((entry) => entry.kind === 'NMI').length;
    machine.tickSystemCycle();
    expect(machine.monitor.interruptHistory.filter((entry) => entry.kind === 'NMI')).toHaveLength(count);
  });
});
