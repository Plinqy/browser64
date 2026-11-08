import type { Bus } from '../memory/Bus';
import { Via6522 } from '../via/Via6522';

export const C1541_RAM_SIZE = 0x0800;
export const C1541_ROM_SIZE = 0x4000;

/**
 * Stock 1541 CPU address space.
 *
 *  $0000-$07ff  2 KiB RAM, mirrored through $67ff
 *  $1800-$180f  VIA #0 (IEC), mirrored inside each decoded page/bank
 *  $1c00-$1c0f  VIA #1 (disk), likewise mirrored
 *  $8000-$ffff  16 KiB ROM mirrored twice
 */
export class C1541Bus implements Bus {
  public readonly ram = new Uint8Array(C1541_RAM_SIZE);
  private readonly rom = new Uint8Array(C1541_ROM_SIZE).fill(0xff);
  private romPresent = false;

  constructor(
    public readonly via0: Via6522 = new Via6522(),
    public readonly via1: Via6522 = new Via6522()
  ) {}

  read(address: number): number {
    return this.resolveRead(address & 0xffff, false);
  }

  peek(address: number): number {
    return this.resolveRead(address & 0xffff, true);
  }

  write(address: number, value: number): void {
    const addr = address & 0xffff;
    const data = value & 0xff;

    if (addr >= 0x8000) return;

    if (isRamAddress(addr)) {
      this.ram[addr & 0x07ff] = data;
      return;
    }

    const viaRegion = addr & 0x1c00;
    if (viaRegion === 0x1800) {
      this.via0.write(addr & 0x0f, data);
      return;
    }
    if (viaRegion === 0x1c00) {
      this.via1.write(addr & 0x0f, data);
    }
  }

  loadRom(bytes: ArrayLike<number>): void {
    if (bytes.length !== C1541_ROM_SIZE) {
      throw new RangeError(`1541 ROM must be exactly ${C1541_ROM_SIZE} bytes; received ${bytes.length}.`);
    }
    for (let index = 0; index < C1541_ROM_SIZE; index += 1) this.rom[index] = bytes[index]! & 0xff;
    this.romPresent = true;
  }

  clearRam(): void {
    this.ram.fill(0);
  }

  resetIo(): void {
    this.via0.reset();
    this.via1.reset();
  }

  get hasRom(): boolean {
    return this.romPresent;
  }

  private resolveRead(address: number, peek: boolean): number {
    if (address >= 0x8000) return this.rom[(address - 0x8000) & 0x3fff] ?? 0xff;

    if (isRamAddress(address)) return this.ram[address & 0x07ff] ?? 0;

    const viaRegion = address & 0x1c00;
    if (viaRegion === 0x1800) return peek ? this.via0.peek(address & 0x0f) : this.via0.read(address & 0x0f);
    if (viaRegion === 0x1c00) return peek ? this.via1.peek(address & 0x0f) : this.via1.read(address & 0x0f);

    return 0xff;
  }
}

function isRamAddress(address: number): boolean {
  // MAME's map(0000,07ff).mirror(6000): A13/A14 are not decoded.
  return (address & 0x1800) === 0;
}
