import { describe, expect, it } from 'vitest';
import { C64Bus } from '../../src/core/memory/C64Bus';
import { CHARACTER_ROM_SIZE } from '../../src/core/rom/RomSet';
import {
  VIC_ACTIVE_X,
  VIC_ACTIVE_Y,
  VIC_FRAMEBUFFER_WIDTH,
  VicGraphicsMode
} from '../../src/core/vic/VicII';

function pixel(bus: C64Bus, x = 0): number {
  const index = VIC_ACTIVE_Y * VIC_FRAMEBUFFER_WIDTH + VIC_ACTIVE_X + x;
  return bus.io.vic.framebuffer[index] ?? 0;
}

function runFirstCell(bus: C64Bus): void {
  bus.io.vic.tick(51 * 63 + 16);
}

function baseBus(): C64Bus {
  const bus = new C64Bus();
  bus.io.vic.write(0x18, 0x14); // screen $0400 / char $1000
  bus.io.vic.write(0x20, 0x06);
  bus.io.vic.write(0x21, 0x01);
  bus.io.vic.write(0x22, 0x02);
  bus.io.vic.write(0x23, 0x03);
  bus.io.vic.write(0x24, 0x04);
  return bus;
}

describe('VicII legal graphics modes', () => {
  it('renders standard text from character data and color RAM', () => {
    const bus = baseBus();
    const character = new Uint8Array(CHARACTER_ROM_SIZE);
    character[0] = 0x80;
    bus.roms.load('character', character);
    bus.writePhysicalRam(0x0400, 0x00);
    bus.io.colorRam.write(0, 0x05);
    bus.io.vic.write(0x11, 0x1b);
    bus.io.vic.write(0x16, 0x08);

    runFirstCell(bus);

    expect(bus.io.vic.graphicsMode).toBe(VicGraphicsMode.STANDARD_TEXT);
    expect(pixel(bus, 0)).toBe(0x05);
    expect(pixel(bus, 1)).toBe(0x01);
  });

  it('renders multicolor text pairs with Color RAM bit 3 selecting multicolor cells', () => {
    const bus = baseBus();
    const character = new Uint8Array(CHARACTER_ROM_SIZE);
    character[0] = 0x6c; // 01 10 11 00
    bus.roms.load('character', character);
    bus.writePhysicalRam(0x0400, 0x00);
    bus.io.colorRam.write(0, 0x0d); // multicolor cell, local color 5
    bus.io.vic.write(0x11, 0x1b);
    bus.io.vic.write(0x16, 0x18);

    runFirstCell(bus);

    expect(bus.io.vic.graphicsMode).toBe(VicGraphicsMode.MULTICOLOR_TEXT);
    expect([pixel(bus, 0), pixel(bus, 2), pixel(bus, 4), pixel(bus, 6)]).toEqual([2, 3, 5, 1]);
  });

  it('renders standard bitmap colors from the video-matrix nibbles', () => {
    const bus = baseBus();
    bus.writePhysicalRam(0x0400, 0xa3);
    bus.writePhysicalRam(0x2000, 0x80);
    bus.io.vic.write(0x11, 0x3b); // BMM + DEN/RSEL/YSCROLL=3
    bus.io.vic.write(0x16, 0x08);
    bus.io.vic.write(0x18, 0x18); // screen $0400 / bitmap $2000

    runFirstCell(bus);

    expect(bus.io.vic.graphicsMode).toBe(VicGraphicsMode.STANDARD_BITMAP);
    expect(pixel(bus, 0)).toBe(0x0a);
    expect(pixel(bus, 1)).toBe(0x03);
  });

  it('renders multicolor bitmap pairs from background, screen nibbles, and Color RAM', () => {
    const bus = baseBus();
    bus.writePhysicalRam(0x0400, 0xa3);
    bus.writePhysicalRam(0x2000, 0x6c); // 01 10 11 00
    bus.io.colorRam.write(0, 0x05);
    bus.io.vic.write(0x11, 0x3b);
    bus.io.vic.write(0x16, 0x18);
    bus.io.vic.write(0x18, 0x18);

    runFirstCell(bus);

    expect(bus.io.vic.graphicsMode).toBe(VicGraphicsMode.MULTICOLOR_BITMAP);
    expect([pixel(bus, 0), pixel(bus, 2), pixel(bus, 4), pixel(bus, 6)]).toEqual([10, 3, 5, 1]);
  });

  it('renders ECM text with screen-code bits 6-7 selecting one of four backgrounds', () => {
    const bus = baseBus();
    const character = new Uint8Array(CHARACTER_ROM_SIZE);
    character[0] = 0x80;
    bus.roms.load('character', character);
    bus.writePhysicalRam(0x0400, 0xc0); // glyph 0, background selector 3
    bus.io.colorRam.write(0, 0x06);
    bus.io.vic.write(0x11, 0x5b); // ECM + DEN/RSEL/YSCROLL=3
    bus.io.vic.write(0x16, 0x08);

    runFirstCell(bus);

    expect(bus.io.vic.graphicsMode).toBe(VicGraphicsMode.EXTENDED_COLOR_TEXT);
    expect(pixel(bus, 0)).toBe(0x06);
    expect(pixel(bus, 1)).toBe(0x04);
  });

  it('forces illegal ECM/MCM or ECM/BMM display data to black', () => {
    const bus = baseBus();
    const character = new Uint8Array(CHARACTER_ROM_SIZE).fill(0xff);
    bus.roms.load('character', character);
    bus.writePhysicalRam(0x0400, 0x00);
    bus.io.colorRam.write(0, 0x07);
    bus.io.vic.write(0x11, 0x5b); // ECM text
    bus.io.vic.write(0x16, 0x18); // + MCM => illegal mode 5

    runFirstCell(bus);

    expect(bus.io.vic.graphicsMode).toBe(VicGraphicsMode.INVALID_ECM_MULTICOLOR_TEXT);
    expect(pixel(bus, 0)).toBe(0x00);
  });
});
