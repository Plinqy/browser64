import { describe, expect, it } from 'vitest';
import { BankedCartridge, cartridgeFromCrt } from '../../src/core/cartridge/BankedCartridge';
import { ExpansionPort } from '../../src/core/cartridge/Cartridge';
import { parseCrt } from '../../src/core/cartridge/CrtImage';

interface ChipSpec {
  bank: number;
  loadAddress: number;
  value: number;
  size?: number;
}

function crt(hardwareType: number, chips: readonly ChipSpec[], gameHigh = true, exromHigh = false): Uint8Array {
  const chipBytes = chips.reduce((total, chip) => total + 0x10 + (chip.size ?? 0x2000), 0);
  const bytes = new Uint8Array(0x40 + chipBytes);
  writeAscii(bytes, 0, 'C64 CARTRIDGE   ');
  writeBe32(bytes, 0x10, 0x40);
  writeBe16(bytes, 0x14, 0x0100);
  writeBe16(bytes, 0x16, hardwareType);
  bytes[0x18] = exromHigh ? 1 : 0;
  bytes[0x19] = gameHigh ? 1 : 0;
  writeAscii(bytes, 0x20, 'BANK TEST');

  let offset = 0x40;
  for (const chip of chips) {
    const size = chip.size ?? 0x2000;
    writeAscii(bytes, offset, 'CHIP');
    writeBe32(bytes, offset + 4, 0x10 + size);
    writeBe16(bytes, offset + 8, 0);
    writeBe16(bytes, offset + 0x0a, chip.bank);
    writeBe16(bytes, offset + 0x0c, chip.loadAddress);
    writeBe16(bytes, offset + 0x0e, size);
    bytes.fill(chip.value, offset + 0x10, offset + 0x10 + size);
    offset += 0x10 + size;
  }
  return bytes;
}

describe('banked CRT cartridges', () => {
  it('switches Ocean type 1 banks with writes to $DE00', () => {
    const cart = BankedCartridge.fromParsedCrt(parseCrt(crt(5, [
      { bank: 0, loadAddress: 0x8000, value: 0x10 },
      { bank: 1, loadAddress: 0x8000, value: 0x11 }
    ])));
    const port = new ExpansionPort();
    port.attach(cart);

    expect(port.readRomL(0x8000)).toBe(0x10);
    port.writeIo1(0, 1);
    expect(cart.bank).toBe(1);
    expect(port.readRomL(0x8000)).toBe(0x11);
  });

  it('switches C64GS and Dinamic cartridges from IO1 address accesses', () => {
    const c64gs = BankedCartridge.fromParsedCrt(parseCrt(crt(15, [
      { bank: 0, loadAddress: 0x8000, value: 0x20 },
      { bank: 2, loadAddress: 0x8000, value: 0x22 }
    ])));
    expect(c64gs.readRomL(0x8000)).toBe(0x20);
    c64gs.readIo1(2, false);
    expect(c64gs.readRomL(0x8000)).toBe(0x22);

    const dinamic = BankedCartridge.fromParsedCrt(parseCrt(crt(17, [
      { bank: 0, loadAddress: 0x8000, value: 0x30 },
      { bank: 3, loadAddress: 0x8000, value: 0x33 }
    ])));
    dinamic.readIo1(3, true);
    expect(dinamic.bank).toBe(0); // debugger/peek reads must be side-effect free
    dinamic.readIo1(3, false);
    expect(dinamic.readRomL(0x8000)).toBe(0x33);
  });

  it('implements Magic Desk bank select and bit-7 cartridge disable', () => {
    const cart = BankedCartridge.fromParsedCrt(parseCrt(crt(19, [
      { bank: 0, loadAddress: 0x8000, value: 0x40 },
      { bank: 1, loadAddress: 0x8000, value: 0x41 }
    ])));
    const port = new ExpansionPort();
    port.attach(cart);

    port.writeIo1(0, 1);
    expect(port.readRomL(0x8000)).toBe(0x41);
    port.writeIo1(0, 0x80);
    expect(port.mode).toBe('none');
    expect(port.readRomL(0x8000)).toBeUndefined();
    port.writeIo1(0, 0);
    expect(port.mode).toBe('8k');
    expect(port.readRomL(0x8000)).toBe(0x40);
  });

  it('routes supported hardware through the CRT factory and rejects unknown hardware', () => {
    expect(cartridgeFromCrt(parseCrt(crt(5, [{ bank: 0, loadAddress: 0x8000, value: 1 }])))).toBeInstanceOf(BankedCartridge);
    expect(() => cartridgeFromCrt(parseCrt(crt(42, [{ bank: 0, loadAddress: 0x8000, value: 1 }])))).toThrow(/not implemented/i);
  });
});

function writeAscii(bytes: Uint8Array, offset: number, value: string): void {
  for (let index = 0; index < value.length; index += 1) bytes[offset + index] = value.charCodeAt(index);
}
function writeBe16(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = (value >> 8) & 0xff;
  bytes[offset + 1] = value & 0xff;
}
function writeBe32(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = (value >>> 24) & 0xff;
  bytes[offset + 1] = (value >>> 16) & 0xff;
  bytes[offset + 2] = (value >>> 8) & 0xff;
  bytes[offset + 3] = value & 0xff;
}
