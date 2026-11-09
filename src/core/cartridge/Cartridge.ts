export type CartridgeMode = 'none' | '8k' | '16k' | 'ultimax';

/**
 * Electrical/logical contract presented by a C64 expansion-port cartridge.
 *
 * GAME/EXROM are represented as physical line levels: true = released/high,
 * false = asserted/low. ROML/ROMH are read chip-select regions; writes in the
 * normal 8K/16K modes still reach motherboard RAM and therefore are not routed
 * here. IO1/IO2 are bidirectional expansion windows.
 */
export interface CartridgeDevice {
  readonly name: string;
  readonly gameHigh: boolean;
  readonly exromHigh: boolean;
  /** Optional active-low expansion interrupt lines used by freezer/debug cartridges. */
  readonly irqLow?: boolean;
  readonly nmiLow?: boolean;
  readonly dmaLow?: boolean;

  reset(): void;
  /** Optional physical FREEZE button hook. */
  freeze?(): void;
  readRomL(address: number): number | undefined;
  readRomH(address: number): number | undefined;
  readIo1(offset: number, sideEffectFree: boolean): number | undefined;
  readIo2(offset: number, sideEffectFree: boolean): number | undefined;
  writeIo1(offset: number, value: number): void;
  writeIo2(offset: number, value: number): void;
}

/**
 * One motherboard expansion port. The abstraction deliberately exposes only
 * the cartridge memory/control lines plus IRQ/NMI/DMA and an optional FREEZE
 * button hook so freezer hardware can integrate without special-casing the bus.
 */
export class ExpansionPort {
  private attached: CartridgeDevice | null = null;

  attach(device: CartridgeDevice): void {
    this.attached = device;
    device.reset();
  }

  detach(): void {
    this.attached = null;
  }

  reset(): void {
    this.attached?.reset();
  }

  get cartridge(): CartridgeDevice | null {
    return this.attached;
  }

  get gameHigh(): boolean {
    return this.attached?.gameHigh ?? true;
  }

  get exromHigh(): boolean {
    return this.attached?.exromHigh ?? true;
  }

  get irqAsserted(): boolean { return this.attached?.irqLow === true; }
  get nmiAsserted(): boolean { return this.attached?.nmiLow === true; }
  get dmaAsserted(): boolean { return this.attached?.dmaLow === true; }

  freeze(): void { this.attached?.freeze?.(); }

  get mode(): CartridgeMode {
    const game = this.gameHigh;
    const exrom = this.exromHigh;
    if (game && exrom) return 'none';
    if (game && !exrom) return '8k';
    if (!game && !exrom) return '16k';
    return 'ultimax';
  }

  readRomL(address: number): number | undefined {
    return this.attached?.readRomL(address & 0xffff);
  }

  readRomH(address: number): number | undefined {
    return this.attached?.readRomH(address & 0xffff);
  }

  readIo1(offset: number, sideEffectFree: boolean): number | undefined {
    return this.attached?.readIo1(offset & 0xff, sideEffectFree);
  }

  readIo2(offset: number, sideEffectFree: boolean): number | undefined {
    return this.attached?.readIo2(offset & 0xff, sideEffectFree);
  }

  writeIo1(offset: number, value: number): void {
    this.attached?.writeIo1(offset & 0xff, value & 0xff);
  }

  writeIo2(offset: number, value: number): void {
    this.attached?.writeIo2(offset & 0xff, value & 0xff);
  }
}
