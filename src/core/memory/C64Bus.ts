import { ExpansionPort, type CartridgeDevice, type CartridgeMode } from '../cartridge/Cartridge';
import { IecBus } from '../iec/IecBus';
import { C64Io } from '../io/C64Io';
import { C64Roms } from '../rom/RomSet';
import { Datasette } from '../tape/Datasette';
import { PAL_6569_TIMING, type VicTimingProfile } from '../vic/VicTiming';
import type { Bus } from './Bus';

export type C64BusAccessKind = 'read' | 'write';
export type C64BusAccessSource = 'cpu' | 'vic';

export interface C64BusAccess {
  source: C64BusAccessSource;
  kind: C64BusAccessKind;
  address: number;
  value: number;
}

export type C64BusAccessObserver = (access: C64BusAccess) => void;

export interface C64MemoryConfiguration {
  port: number;
  loram: boolean;
  hiram: boolean;
  charen: boolean;
  gameHigh: boolean;
  exromHigh: boolean;
  cartridgeMode: CartridgeMode;
  basicVisible: boolean;
  kernalVisible: boolean;
  ioVisible: boolean;
  characterVisible: boolean;
}

/**
 * CPU-facing Commodore 64 bus including PLA cartridge and Datasette wiring.
 *
 * The VIC keeps its independent 14-bit memory view. CPU reads are selected by
 * LORAM/HIRAM/CHAREN plus expansion-port GAME/EXROM, while writes beneath
 * ordinary cartridge ROM still reach RAM. Ultimax is handled separately because
 * it hides most motherboard RAM and also exposes ROMH to the VIC.
 */
export class C64Bus implements Bus {
  public readonly ram = new Uint8Array(0x10000);
  public readonly roms = new C64Roms();
  public readonly iec = new IecBus();
  public readonly expansion = new ExpansionPort();
  public readonly io: C64Io;
  public readonly datasette: Datasette;

  private dataDirection = 0x2f;
  private dataLatch = 0x37;
  private dataBusLatch = 0xff;
  private accessObserver: C64BusAccessObserver | null = null;

  // Deterministic external pin levels. Bits 0-2 are high when configured as
  // inputs, matching stock pulled-up banking lines. Bit 4 is the inactive
  // Datasette SENSE input and is pulled low by the deck while PLAY is engaged.
  private inputPins = 0x17;

  constructor(public readonly timing: VicTimingProfile = PAL_6569_TIMING) {
    this.io = new C64Io({
      read: (address) => this.readVicMemory(address),
      readColor: (index) => this.readVicColor(index)
    }, timing, () => this.dataBusLatch, this.iec);
    this.datasette = new Datasette(timing.systemClockHz, () => {
      // CIA1 FLAG is negative-edge triggered. A C64 TAP v0/v1 pulse is one
      // complete wave, so deliver one falling edge and immediately release it.
      this.io.cia1.setFlagLine(false);
      this.io.cia1.setFlagLine(true);
    });
    this.syncDatasettePort();
  }

  read(address: number): number {
    const normalizedAddress = address & 0xffff;
    const value = this.readMapped(normalizedAddress, false) & 0xff;
    this.dataBusLatch = value;
    this.accessObserver?.({ source: 'cpu', kind: 'read', address: normalizedAddress, value });
    return value;
  }

  peek(address: number): number {
    return this.readMapped(address, true);
  }

  write(address: number, value: number): void {
    const normalizedAddress = address & 0xffff;
    const byte = value & 0xff;
    this.dataBusLatch = byte;
    this.accessObserver?.({ source: 'cpu', kind: 'write', address: normalizedAddress, value: byte });

    if (normalizedAddress === 0x0000) {
      this.dataDirection = byte;
      this.syncDatasettePort();
      return;
    }

    if (normalizedAddress === 0x0001) {
      this.dataLatch = byte;
      this.syncDatasettePort();
      return;
    }

    const configuration = this.configuration;
    if (normalizedAddress >= 0xd000 && normalizedAddress <= 0xdfff && configuration.ioVisible) {
      if (this.writeExpansionIo(normalizedAddress, byte)) return;
      this.io.write(normalizedAddress - 0xd000, byte);
      return;
    }

    // Normal 8K/16K cartridge ROM is read-selected only; writes still land in
    // the motherboard RAM beneath it. Ultimax disables CASRAM outside the low
    // 4 KiB, so its unmapped/ROM regions do not receive hidden RAM writes.
    if (configuration.cartridgeMode === 'ultimax' && normalizedAddress >= 0x1000) {
      return;
    }

    this.ram[normalizedAddress] = byte;
  }

  /**
   * Read one byte through the VIC-II's 14-bit address bus.
   *
   * Character ROM shadows relative $1000-$1FFF only in banks 0 and 2 during
   * ordinary C64 operation. In Ultimax, character ROM disappears and the first
   * 4 KiB of ROMH is visible at VIC-relative $3000-$3FFF in every bank.
   */
  readVicMemory(address: number): number {
    const vicAddress = address & 0x3fff;
    const configuration = this.configuration;
    let value: number;

    if (configuration.cartridgeMode === 'ultimax' && vicAddress >= 0x3000) {
      value = this.expansion.readRomH(0xf000 | (vicAddress & 0x0fff)) ?? this.dataBusLatch;
    } else {
      const bank = this.vicBankNumber;
      value = configuration.cartridgeMode !== 'ultimax' &&
        (bank === 0 || bank === 2) && vicAddress >= 0x1000 && vicAddress <= 0x1fff
        ? this.roms.character[vicAddress - 0x1000] ?? 0xff
        : this.ram[this.vicBankBase | vicAddress] ?? 0;
    }

    this.dataBusLatch = value & 0xff;
    const tracedAddress = configuration.cartridgeMode === 'ultimax' && vicAddress >= 0x3000
      ? 0xf000 | (vicAddress & 0x0fff)
      : (this.vicBankBase | vicAddress) & 0xffff;
    this.accessObserver?.({ source: 'vic', kind: 'read', address: tracedAddress, value: this.dataBusLatch });
    return this.dataBusLatch;
  }

  readVicColor(index: number): number {
    const normalizedIndex = index & 0x03ff;
    const value = this.io.colorRam.memory[normalizedIndex]! & 0x0f;
    this.accessObserver?.({ source: 'vic', kind: 'read', address: 0xd800 | normalizedIndex, value });
    return value;
  }

  setAccessObserver(observer: C64BusAccessObserver | null): void {
    this.accessObserver = observer;
  }

  attachCartridge(cartridge: CartridgeDevice): void {
    this.expansion.attach(cartridge);
  }

  detachCartridge(): void {
    this.expansion.detach();
  }

  resetProcessorPort(): void {
    this.dataDirection = 0x2f;
    this.dataLatch = 0x37;
    this.dataBusLatch = 0xff;
    this.inputPins = 0x17;
    this.syncDatasettePort();
  }

  resetIo(): void {
    this.io.reset();
    this.expansion.reset();
  }

  tickDatasette(cycles = 1): void {
    this.datasette.tick(cycles);
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

  /** Last value driven on the shared 8-bit system data bus. */
  get systemDataBusValue(): number {
    return this.dataBusLatch;
  }

  /** Backward-compatible diagnostic alias retained for existing callers. */
  get cpuDataBusValue(): number {
    return this.systemDataBusValue;
  }

  get processorPortPins(): number {
    let externalPins = this.inputPins;
    if (!this.datasette.senseHigh) externalPins &= ~0x10;
    return ((this.dataLatch & this.dataDirection) | (externalPins & ~this.dataDirection)) & 0xff;
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
    const gameHigh = this.expansion.gameHigh;
    const exromHigh = this.expansion.exromHigh;
    const cartridgeMode = this.expansion.mode;

    if (cartridgeMode === 'ultimax') {
      return {
        port, loram, hiram, charen, gameHigh, exromHigh, cartridgeMode,
        basicVisible: false,
        kernalVisible: false,
        ioVisible: true,
        characterVisible: false
      };
    }

    const romIoWindowEnabled = loram || hiram;
    return {
      port,
      loram,
      hiram,
      charen,
      gameHigh,
      exromHigh,
      cartridgeMode,
      basicVisible: cartridgeMode === '16k' ? false : loram && hiram,
      kernalVisible: hiram,
      ioVisible: romIoWindowEnabled && charen,
      characterVisible: romIoWindowEnabled && !charen
    };
  }

  private readMapped(address: number, sideEffectFree: boolean): number {
    const normalizedAddress = address & 0xffff;

    if (normalizedAddress === 0x0000) return this.dataDirection;
    if (normalizedAddress === 0x0001) return this.processorPortPins;

    const configuration = this.configuration;
    if (configuration.cartridgeMode === 'ultimax') {
      if (normalizedAddress < 0x1000) return this.ram[normalizedAddress] ?? 0;
      if (normalizedAddress < 0x8000) return this.dataBusLatch;
      if (normalizedAddress < 0xa000) return this.expansion.readRomL(normalizedAddress) ?? this.dataBusLatch;
      if (normalizedAddress < 0xd000) return this.dataBusLatch;
      if (normalizedAddress < 0xe000) return this.readIoWindow(normalizedAddress, sideEffectFree);
      return this.expansion.readRomH(normalizedAddress) ?? this.dataBusLatch;
    }

    const romlVisible = configuration.loram && configuration.hiram &&
      (configuration.cartridgeMode === '8k' || configuration.cartridgeMode === '16k');
    if (normalizedAddress >= 0x8000 && normalizedAddress <= 0x9fff && romlVisible) {
      return this.expansion.readRomL(normalizedAddress) ?? this.dataBusLatch;
    }

    if (normalizedAddress >= 0xa000 && normalizedAddress <= 0xbfff) {
      if (configuration.cartridgeMode === '16k' && configuration.hiram) {
        return this.expansion.readRomH(normalizedAddress) ?? this.dataBusLatch;
      }
      if (configuration.basicVisible) {
        return this.roms.basic[normalizedAddress - 0xa000] ?? 0xff;
      }
    }

    if (normalizedAddress >= 0xd000 && normalizedAddress <= 0xdfff) {
      if (configuration.ioVisible) return this.readIoWindow(normalizedAddress, sideEffectFree);
      if (configuration.characterVisible) return this.roms.character[normalizedAddress - 0xd000] ?? 0xff;
    }

    if (normalizedAddress >= 0xe000 && configuration.kernalVisible) {
      return this.roms.kernal[normalizedAddress - 0xe000] ?? 0xff;
    }

    return this.ram[normalizedAddress] ?? 0;
  }

  private readIoWindow(address: number, sideEffectFree: boolean): number {
    if (address >= 0xde00 && address <= 0xdeff) {
      const value = this.expansion.readIo1(address - 0xde00, sideEffectFree);
      if (value !== undefined) return value;
    } else if (address >= 0xdf00 && address <= 0xdfff) {
      const value = this.expansion.readIo2(address - 0xdf00, sideEffectFree);
      if (value !== undefined) return value;
    }
    const offset = address - 0xd000;
    return sideEffectFree ? this.io.peek(offset) : this.io.read(offset);
  }

  private writeExpansionIo(address: number, value: number): boolean {
    if (this.expansion.cartridge === null) return false;
    if (address >= 0xde00 && address <= 0xdeff) {
      this.expansion.writeIo1(address - 0xde00, value);
      return true;
    }
    if (address >= 0xdf00 && address <= 0xdfff) {
      this.expansion.writeIo2(address - 0xdf00, value);
      return true;
    }
    return false;
  }

  private syncDatasettePort(): void {
    const motorOutput = (this.dataDirection & 0x20) !== 0;
    this.datasette.setMotor(motorOutput && (this.dataLatch & 0x20) === 0);

    const writeOutput = (this.dataDirection & 0x08) !== 0;
    this.datasette.setWriteLine(writeOutput ? (this.dataLatch & 0x08) !== 0 : true);
  }
}
