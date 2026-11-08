import type { CartridgeDevice, CartridgeMode } from './Cartridge';
import { parseCrt, type CrtImage } from './CrtImage';

interface RomSegment {
  readonly start: number;
  readonly endExclusive: number;
  readonly data: Uint8Array;
}

export type RawCartridgeMode = Exclude<CartridgeMode, 'none'>;

/**
 * Static generic C64 cartridge.
 *
 * This deliberately does not guess banking rules for Action Replay/Ocean/etc.
 * CRT hardware type 0 is supported because its CHIP packets describe the ROM
 * locations directly and GAME/EXROM are static electrical levels.
 */
export class GenericCartridge implements CartridgeDevice {
  private constructor(
    public readonly name: string,
    public readonly gameHigh: boolean,
    public readonly exromHigh: boolean,
    private readonly segments: readonly RomSegment[]
  ) {}

  static fromCrt(bytes: ArrayLike<number>): GenericCartridge {
    return GenericCartridge.fromParsedCrt(parseCrt(bytes));
  }

  static fromParsedCrt(crt: CrtImage): GenericCartridge {
    if (crt.hardwareType !== 0) {
      throw new Error(`CRT hardware type ${crt.hardwareType} is not a generic cartridge.`);
    }

    const segments: RomSegment[] = crt.chips.map((chip) => {
      if (chip.chipType !== 0) {
        throw new Error(`Generic CRT CHIP type ${chip.chipType} is not ROM.`);
      }
      if (chip.bank !== 0) {
        throw new Error(`Generic CRT bank ${chip.bank} requires cartridge-specific banking logic.`);
      }
      const endExclusive = chip.loadAddress + chip.image.length;
      if (endExclusive > 0x10000) {
        throw new RangeError('CRT CHIP image exceeds the C64 address space.');
      }
      return Object.freeze({
        start: chip.loadAddress,
        endExclusive,
        data: chip.image.slice()
      });
    });

    return new GenericCartridge(
      crt.name === '' ? 'Generic CRT' : crt.name,
      crt.gameHigh,
      crt.exromHigh,
      Object.freeze(segments)
    );
  }

  static fromRaw(bytesLike: ArrayLike<number>, mode: RawCartridgeMode, name = 'Raw cartridge'): GenericCartridge {
    const bytes = Uint8Array.from(bytesLike, (value) => value & 0xff);
    let gameHigh = true;
    let exromHigh = true;
    const segments: RomSegment[] = [];

    switch (mode) {
      case '8k':
        if (bytes.length !== 0x2000) throw new RangeError('8K cartridge ROM must be exactly 8192 bytes.');
        exromHigh = false;
        segments.push(segment(0x8000, bytes));
        break;
      case '16k':
        if (bytes.length !== 0x4000) throw new RangeError('16K cartridge ROM must be exactly 16384 bytes.');
        gameHigh = false;
        exromHigh = false;
        segments.push(segment(0x8000, bytes));
        break;
      case 'ultimax':
        if (bytes.length !== 0x4000) {
          throw new RangeError('Raw Ultimax ROM must be 16 KiB: 8 KiB ROML followed by 8 KiB ROMH.');
        }
        gameHigh = false;
        segments.push(segment(0x8000, bytes.subarray(0, 0x2000)));
        segments.push(segment(0xe000, bytes.subarray(0x2000)));
        break;
      default:
        return assertNever(mode);
    }

    return new GenericCartridge(name, gameHigh, exromHigh, Object.freeze(segments));
  }

  reset(): void {}

  readRomL(address: number): number | undefined {
    return this.readSegment(address);
  }

  readRomH(address: number): number | undefined {
    return this.readSegment(address);
  }

  readIo1(_offset: number, _sideEffectFree: boolean): number | undefined {
    return undefined;
  }

  readIo2(_offset: number, _sideEffectFree: boolean): number | undefined {
    return undefined;
  }

  writeIo1(_offset: number, _value: number): void {}
  writeIo2(_offset: number, _value: number): void {}

  private readSegment(address: number): number | undefined {
    const normalized = address & 0xffff;
    for (const entry of this.segments) {
      if (normalized >= entry.start && normalized < entry.endExclusive) {
        return entry.data[normalized - entry.start];
      }
    }
    return undefined;
  }
}

function segment(start: number, bytes: Uint8Array): RomSegment {
  return Object.freeze({ start, endExclusive: start + bytes.length, data: bytes.slice() });
}

function assertNever(value: never): never {
  throw new Error(`Unexpected cartridge mode ${String(value)}`);
}
