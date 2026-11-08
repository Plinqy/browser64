import { describe, expect, it } from 'vitest';
import { C64Bus } from '../../src/core/memory/C64Bus';
import { CHARACTER_ROM_SIZE } from '../../src/core/rom/RomSet';
import { VIC_ACTIVE_X, VIC_ACTIVE_Y, VIC_FRAMEBUFFER_WIDTH } from '../../src/core/vic/VicII';
import { NTSC_6567R8_TIMING } from '../../src/core/vic/VicTiming';

function spriteBus(): C64Bus {
  const bus = new C64Bus();
  bus.roms.load('character', new Uint8Array(CHARACTER_ROM_SIZE));
  bus.io.vic.write(0x11, 0x1b);
  bus.io.vic.write(0x16, 0x08);
  bus.io.vic.write(0x18, 0x14);
  bus.io.vic.write(0x21, 0x00);
  return bus;
}

function setSpritePointer(bus: C64Bus, sprite: number, pointer: number): void {
  bus.writePhysicalRam(0x0400 + 0x03f8 + sprite, pointer);
}

function writeSpriteRow(bus: C64Bus, pointer: number, row: number, bytes: readonly number[]): void {
  const address = pointer * 64 + row * 3;
  bytes.forEach((value, index) => bus.writePhysicalRam(address + index, value));
}

function firstActivePixel(bus: C64Bus, offset = 0): number {
  const index = VIC_ACTIVE_Y * VIC_FRAMEBUFFER_WIDTH + VIC_ACTIVE_X + offset;
  return bus.io.vic.framebuffer[index] ?? 0;
}

function runThroughSpriteRender(bus: C64Bus, raster = 51): void {
  bus.io.vic.tick(raster * 63 + 56);
}

describe('VicII hardware sprites', () => {
  it('renders a hires sprite from its video-matrix pointer', () => {
    const bus = spriteBus();
    setSpritePointer(bus, 0, 0x20);
    writeSpriteRow(bus, 0x20, 0, [0x80, 0x00, 0x00]);
    bus.io.vic.write(0x00, 24);
    bus.io.vic.write(0x01, 50);
    bus.io.vic.write(0x15, 0x01);
    bus.io.vic.write(0x27, 0x02);

    runThroughSpriteRender(bus);

    expect(firstActivePixel(bus, 0)).toBe(0x02);
    expect(firstActivePixel(bus, 1)).toBe(0x00);
    expect(bus.io.vic.spriteDataAccessesThisFrame).toBe(3);
  });

  it('supports X/Y expansion and multicolor sprite pixels', () => {
    const bus = spriteBus();
    setSpritePointer(bus, 0, 0x20);
    writeSpriteRow(bus, 0x20, 0, [0x6c, 0x00, 0x00]); // 01 10 11 00...
    bus.io.vic.write(0x00, 24);
    bus.io.vic.write(0x01, 50);
    bus.io.vic.write(0x15, 0x01);
    bus.io.vic.write(0x17, 0x01); // Y expand
    bus.io.vic.write(0x1c, 0x01); // multicolor
    bus.io.vic.write(0x1d, 0x01); // X expand
    bus.io.vic.write(0x25, 0x03);
    bus.io.vic.write(0x26, 0x04);
    bus.io.vic.write(0x27, 0x05);

    runThroughSpriteRender(bus);

    // Multicolor pair pixels are 2x wide; X expansion doubles them again.
    expect([firstActivePixel(bus, 0), firstActivePixel(bus, 4), firstActivePixel(bus, 8)]).toEqual([3, 5, 4]);

    // Y expansion repeats source row 0 on the following raster line.
    bus.io.vic.tick(63);
    expect(bus.io.vic.spriteSourceRow(0)).toBe(0);
  });

  it('latches sprite-sprite collision and preserves fixed lower-index priority', () => {
    const bus = spriteBus();
    setSpritePointer(bus, 0, 0x20);
    setSpritePointer(bus, 1, 0x21);
    writeSpriteRow(bus, 0x20, 0, [0x80, 0x00, 0x00]);
    writeSpriteRow(bus, 0x21, 0, [0x80, 0x00, 0x00]);
    for (const sprite of [0, 1]) {
      bus.io.vic.write(sprite * 2, 24);
      bus.io.vic.write(sprite * 2 + 1, 50);
    }
    bus.io.vic.write(0x15, 0x03);
    bus.io.vic.write(0x1a, 0x04);
    bus.io.vic.write(0x27, 0x02);
    bus.io.vic.write(0x28, 0x03);

    runThroughSpriteRender(bus);

    expect(firstActivePixel(bus)).toBe(0x02); // sprite 0 is in front of sprite 1
    expect(bus.io.vic.peek(0x1e)).toBe(0x03);
    expect(bus.io.vic.irqAsserted).toBe(true);
    expect(bus.io.vic.read(0x1e)).toBe(0x03);
    expect(bus.io.vic.peek(0x1e)).toBe(0x00);
  });

  it('uses graphics foreground classification for sprite priority and collision', () => {
    const bus = spriteBus();
    const character = new Uint8Array(CHARACTER_ROM_SIZE);
    character[0] = 0x80;
    bus.roms.load('character', character);
    bus.writePhysicalRam(0x0400, 0x00);
    bus.io.colorRam.write(0, 0x06);

    setSpritePointer(bus, 0, 0x20);
    writeSpriteRow(bus, 0x20, 0, [0x80, 0x00, 0x00]);
    bus.io.vic.write(0x00, 24);
    bus.io.vic.write(0x01, 50);
    bus.io.vic.write(0x15, 0x01);
    bus.io.vic.write(0x1a, 0x02);
    bus.io.vic.write(0x1b, 0x01); // sprite behind foreground
    bus.io.vic.write(0x27, 0x02);

    runThroughSpriteRender(bus);

    expect(firstActivePixel(bus)).toBe(0x06); // text foreground remains visible
    expect(bus.io.vic.peek(0x1f)).toBe(0x01);
    expect(bus.io.vic.irqAsserted).toBe(true);
    expect(bus.io.vic.read(0x1f)).toBe(0x01);
    expect(bus.io.vic.peek(0x1f)).toBe(0x00);
  });

  it('asserts sprite BA before AEC on an active non-bad raster line', () => {
    const bus = spriteBus();
    setSpritePointer(bus, 0, 0x20);
    writeSpriteRow(bus, 0x20, 0, [0x80, 0x00, 0x00]);
    bus.io.vic.write(0x00, 24);
    bus.io.vic.write(0x01, 51); // first active line is raster 52, not a bad line
    bus.io.vic.write(0x15, 0x01);

    bus.io.vic.tick(52 * 63 + 54); // raster 52, cycle 55
    expect(bus.io.vic.badLine).toBe(false);
    expect(bus.io.vic.baHigh).toBe(false);
    expect(bus.io.vic.aecHigh).toBe(true);

    bus.io.vic.tick(4); // cycle 59
    expect(bus.io.vic.baHigh).toBe(false);
    expect(bus.io.vic.aecHigh).toBe(false);
  });

  it('uses the measured 6567R8 sprite-0 DMA slot at cycle 59', () => {
    const bus = new C64Bus(NTSC_6567R8_TIMING);
    bus.io.vic.write(0x11, 0x1b);
    bus.io.vic.write(0x15, 0x01);
    bus.io.vic.write(0x00, 24);
    bus.io.vic.write(0x01, 51); // activates on raster 52

    bus.io.vic.tick(52 * 65 + 55); // raster 52, cycle 56: BA lead-in starts
    expect(bus.io.vic.rasterCycle).toBe(56);
    expect(bus.io.vic.baHigh).toBe(false);
    expect(bus.io.vic.aecHigh).toBe(true);

    bus.io.vic.tick(3); // cycle 59: pointer/data DMA owns the bus
    expect(bus.io.vic.rasterCycle).toBe(59);
    expect(bus.io.vic.baHigh).toBe(false);
    expect(bus.io.vic.aecHigh).toBe(false);
  });

});
