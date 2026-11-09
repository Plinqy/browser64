import type { CartridgeDevice } from './Cartridge';
import type { CrtChipPacket, CrtImage } from './CrtImage';
import { GenericCartridge } from './GenericCartridge';

export type SupportedBankedHardwareType = 5 | 15 | 17 | 19;

type BankedKind = 'ocean' | 'c64gs' | 'dinamic' | 'magic-desk';

/**
 * Common ROM-banked CRT families whose switching rules are fully described by
 * the standard CRT hardware type and IO1 accesses.
 */
export class BankedCartridge implements CartridgeDevice {
  private selectedBank = 0;
  private disabled = false;

  private constructor(
    public readonly name: string,
    private readonly crtGameHigh: boolean,
    private readonly crtExromHigh: boolean,
    private readonly kind: BankedKind,
    private readonly banks: ReadonlyMap<number, readonly CrtChipPacket[]>
  ) {}

  static fromParsedCrt(crt: CrtImage): BankedCartridge {
    const kind = hardwareKind(crt.hardwareType);
    if (kind === null) throw new Error(`CRT hardware type ${crt.hardwareType} is not a supported banked cartridge.`);

    const banks = new Map<number, CrtChipPacket[]>();
    for (const chip of crt.chips) {
      if (chip.chipType !== 0) throw new Error(`Banked CRT CHIP type ${chip.chipType} is not ROM.`);
      const end = chip.loadAddress + chip.image.length;
      if (end > 0x10000) throw new RangeError('CRT CHIP image exceeds the C64 address space.');
      const list = banks.get(chip.bank) ?? [];
      list.push(chip);
      banks.set(chip.bank, list);
    }
    return new BankedCartridge(
      crt.name === '' ? `CRT type ${crt.hardwareType}` : crt.name,
      crt.gameHigh,
      crt.exromHigh,
      kind,
      banks
    );
  }

  reset(): void {
    this.selectedBank = 0;
    this.disabled = false;
  }

  get gameHigh(): boolean {
    return this.kind === 'magic-desk' && this.disabled ? true : this.crtGameHigh;
  }

  get exromHigh(): boolean {
    return this.kind === 'magic-desk' && this.disabled ? true : this.crtExromHigh;
  }

  get bank(): number { return this.selectedBank; }

  readRomL(address: number): number | undefined { return this.readSelectedChip(address); }
  readRomH(address: number): number | undefined { return this.readSelectedChip(address); }

  readIo1(offset: number, sideEffectFree: boolean): number | undefined {
    if (!sideEffectFree) {
      if (this.kind === 'c64gs' || this.kind === 'dinamic') this.selectBank(offset & 0x3f);
    }
    return undefined;
  }

  readIo2(_offset: number, _sideEffectFree: boolean): number | undefined { return undefined; }

  writeIo1(offset: number, value: number): void {
    switch (this.kind) {
      case 'ocean':
        this.selectBank(value & 0x3f);
        break;
      case 'magic-desk':
        if ((offset & 0xff) === 0) {
          this.disabled = (value & 0x80) !== 0;
          if (!this.disabled) this.selectBank(value & 0x7f);
        }
        break;
      case 'c64gs':
        this.selectBank(offset & 0x3f);
        break;
      case 'dinamic':
        // Dinamic switches on reads from $DE00+bank; writes do not select.
        break;
    }
  }

  writeIo2(_offset: number, _value: number): void {}

  private selectBank(bank: number): void {
    if (this.banks.has(bank)) this.selectedBank = bank;
  }

  private readSelectedChip(address: number): number | undefined {
    if (this.disabled) return undefined;
    const normalized = address & 0xffff;
    const chips = this.banks.get(this.selectedBank);
    if (chips === undefined) return undefined;
    for (const chip of chips) {
      const offset = normalized - chip.loadAddress;
      if (offset >= 0 && offset < chip.image.length) return chip.image[offset];
    }
    return undefined;
  }
}

/** Build the concrete cartridge implementation implied by a CRT header. */
export function cartridgeFromCrt(crt: CrtImage): CartridgeDevice {
  if (crt.hardwareType === 0) return GenericCartridge.fromParsedCrt(crt);
  if (hardwareKind(crt.hardwareType) !== null) return BankedCartridge.fromParsedCrt(crt);
  throw new Error(
    `CRT hardware type ${crt.hardwareType} is not implemented. ` +
    'Supported types are generic (0), Ocean (5), C64GS (15), Dinamic (17), and Magic Desk (19).'
  );
}

function hardwareKind(hardwareType: number): BankedKind | null {
  switch (hardwareType) {
    case 5: return 'ocean';
    case 15: return 'c64gs';
    case 17: return 'dinamic';
    case 19: return 'magic-desk';
    default: return null;
  }
}
