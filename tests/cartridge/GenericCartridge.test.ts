import { describe, expect, it } from 'vitest';
import { ExpansionPort } from '../../src/core/cartridge/Cartridge';
import { GenericCartridge } from '../../src/core/cartridge/GenericCartridge';

describe('GenericCartridge', () => {
  it('models raw 8K, 16K, and Ultimax GAME/EXROM modes', () => {
    const port = new ExpansionPort();

    port.attach(GenericCartridge.fromRaw(new Uint8Array(0x2000).fill(0x81), '8k'));
    expect(port.mode).toBe('8k');
    expect(port.readRomL(0x8000)).toBe(0x81);

    port.attach(GenericCartridge.fromRaw(new Uint8Array(0x4000).fill(0x16), '16k'));
    expect(port.mode).toBe('16k');
    expect(port.readRomL(0x8000)).toBe(0x16);
    expect(port.readRomH(0xa000)).toBe(0x16);

    const ultimax = new Uint8Array(0x4000);
    ultimax.fill(0x8a, 0, 0x2000);
    ultimax.fill(0xea, 0x2000);
    port.attach(GenericCartridge.fromRaw(ultimax, 'ultimax'));
    expect(port.mode).toBe('ultimax');
    expect(port.readRomL(0x8000)).toBe(0x8a);
    expect(port.readRomH(0xe000)).toBe(0xea);
  });

  it('enforces unambiguous raw image sizes', () => {
    expect(() => GenericCartridge.fromRaw(new Uint8Array(1), '8k')).toThrow(/8192/i);
    expect(() => GenericCartridge.fromRaw(new Uint8Array(0x2000), '16k')).toThrow(/16384/i);
    expect(() => GenericCartridge.fromRaw(new Uint8Array(0x2000), 'ultimax')).toThrow(/16 KiB/i);
  });
});
