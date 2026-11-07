import { C64Io } from '../io/C64Io';
import { C64Roms } from '../rom/RomSet';
import type { Bus } from './Bus';

export interface C64MemoryConfiguration {
  port: number;
  loram: boolean;
  hiram: boolean;
  charen: boolean;
  basicVisible: boolean;
  kernalVisible: boolean;
  ioVisible: boolean;
  characterVisible: boolean;
}

/**
 * CPU-facing Commodore 64 bus for the stock no-cartridge memory configuration.
 *
 * The bus also exposes the VIC's independent 14-bit memory view. VIC accesses
 * bypass CPU ROM/I/O banking and apply CIA2 bank selection plus VIC-specific
 * character-ROM shadowing.
 */
export class C64Bus implements Bus {
  public readonly ram = new Uint8Array(0x10000);
  public readonly roms = new C64Roms();
  public readonly io: C64Io;

  private dataDirection = 0x2f;
  private dataLatch = 0x37;

  // Deterministic external pin levels. Bits 0-2 are high when configured as
  // inputs, matching the stock machine's pulled-up banking lines. Bit 4 is the
  // inactive Datasette switch sense. Undefined bits 6-7 stay low for now.
  private inputPins = 0x17;

  constructor() {
    this.io = new C64Io({
      read: (address) => this.readVicMemory(address),
      readColor: (index) => this.readVicColor(index)
    });
  }

  read(address: number): number {
    return this.readMapped(address, false);
  }

  peek(address: number): number {
    return this.readMapped(address, true);
  }

  write(address: number, value: number): void {
    const normalizedAddress = address & 0xffff;
    const byte = value & 0xff;

    if (normalizedAddress === 0x0000) {
      this.dataDirection = byte;
      return;
    }

    if (normalizedAddress === 0x0001) {
      this.dataLatch = byte;
      return;
    }

    if (normalizedAddress >= 0xd000 && normalizedAddress <= 0xdfff && this.configuration.ioVisible) {
      this.io.write(normalizedAddress - 0xd000, byte);
      return;
    }

    // ROM is read-only from the CPU's point of view, but the C64's physical RAM
    // remains underneath BASIC/KERNAL/CHAR ROM and receives writes whenever I/O
    // is not actively decoding the $D000-$DFFF range.
    this.ram[normalizedAddress] = byte;
  }

  /**
   * Read one byte through the VIC-II's 14-bit address bus.
   *
   * The VIC never sees CPU I/O or BASIC/KERNAL ROM. Character ROM shadows
   * relative $1000-$1FFF only in banks 0 and 2.
   */
  readVicMemory(address: number): number {
    const vicAddress = address & 0x3fff;
    const bank = this.vicBankNumber;

    if ((bank === 0 || bank === 2) && vicAddress >= 0x1000 && vicAddress <= 0x1fff) {
      return this.roms.character[vicAddress - 0x1000] ?? 0xff;
    }

    return this.ram[this.vicBankBase | vicAddress] ?? 0;
  }

  readVicColor(index: number): number {
    return this.io.colorRam.memory[index & 0x03ff]! & 0x0f;
  }

  resetProcessorPort(): void {
    this.dataDirection = 0x2f;
    this.dataLatch = 0x37;
    this.inputPins = 0x17;
  }

  resetIo(): void {
    this.io.reset();
  }

  clearRam(value = 0): void {
    this.ram.fill(value & 0xff);
  }

  loadRam(bytes: ArrayLike<number>, address: number): void {
    const start = address & 0xffff;

    if (start + bytes.length > 0x10000) {
      throw new RangeError('RAM image does not fit in the 64 KiB address space.');
    }

    for (let i = 0; i < bytes.length; i += 1) {
      this.ram[start + i] = bytes[i]! & 0xff;
    }
  }

  readPhysicalRam(address: number): number {
    return this.ram[address & 0xffff] ?? 0;
  }

  writePhysicalRam(address: number, value: number): void {
    this.ram[address & 0xffff] = value & 0xff;
  }

  setProcessorPortInputPins(value: number): void {
    this.inputPins = value & 0xff;
  }

  get processorPortDataDirection(): number {
    return this.dataDirection;
  }

  get processorPortDataLatch(): number {
    return this.dataLatch;
  }

  get processorPortPins(): number {
    return ((this.dataLatch & this.dataDirection) | (this.inputPins & ~this.dataDirection)) & 0xff;
  }

  /** CIA2 PA0/PA1 are inverted before becoming the VIC's A14/A15 lines. */
  get vicBankNumber(): number {
    return (3 - (this.io.cia2.portAPins & 0x03)) & 0x03;
  }

  get vicBankBase(): number {
    return this.vicBankNumber << 14;
  }

  get configuration(): C64MemoryConfiguration {
    const port = this.processorPortPins;
    const loram = (port & 0x01) !== 0;
    const hiram = (port & 0x02) !== 0;
    const charen = (port & 0x04) !== 0;
    const romIoWindowEnabled = loram || hiram;

    return {
      port,
      loram,
      hiram,
      charen,
      basicVisible: loram && hiram,
      kernalVisible: hiram,
      ioVisible: romIoWindowEnabled && charen,
      characterVisible: romIoWindowEnabled && !charen
    };
  }

  private readMapped(address: number, sideEffectFree: boolean): number {
    const normalizedAddress = address & 0xffff;

    if (normalizedAddress === 0x0000) {
      return this.dataDirection;
    }

    if (normalizedAddress === 0x0001) {
      return this.processorPortPins;
    }

    const configuration = this.configuration;

    if (normalizedAddress >= 0xa000 && normalizedAddress <= 0xbfff && configuration.basicVisible) {
      return this.roms.basic[normalizedAddress - 0xa000] ?? 0xff;
    }

    if (normalizedAddress >= 0xd000 && normalizedAddress <= 0xdfff) {
      if (configuration.ioVisible) {
        const offset = normalizedAddress - 0xd000;
        return sideEffectFree ? this.io.peek(offset) : this.io.read(offset);
      }

      if (configuration.characterVisible) {
        return this.roms.character[normalizedAddress - 0xd000] ?? 0xff;
      }
    }

    if (normalizedAddress >= 0xe000 && configuration.kernalVisible) {
      return this.roms.kernal[normalizedAddress - 0xe000] ?? 0xff;
    }

    return this.ram[normalizedAddress] ?? 0;
  }
}
