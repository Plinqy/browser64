import { describe, expect, it } from 'vitest';
import { C64Bus } from '../../src/core/memory/C64Bus';
import { CHARACTER_ROM_SIZE } from '../../src/core/rom/RomSet';
import {
  VIC_ACTIVE_X,
  VIC_ACTIVE_Y,
  VIC_FRAMEBUFFER_WIDTH,
  VicII
} from '../../src/core/vic/VicII';

function characterRomWithSinglePixel(): Uint8Array {
  const rom = new Uint8Array(CHARACTER_ROM_SIZE);
  rom[0] = 0x80;
  return rom;
}

describe('VicII raster timing and interrupts', () => {
  it('advances PAL raster time at 63 cycles per line and 312 lines per frame', () => {
    const vic = new VicII();

    vic.tick(62);
    expect(vic.rasterLine).toBe(0);
    expect(vic.rasterCycle).toBe(63);

    vic.tick(1);
    expect(vic.rasterLine).toBe(1);
    expect(vic.rasterCycle).toBe(1);

    vic.tick(vic.cyclesPerFrame - 63);
    expect(vic.rasterLine).toBe(0);
    expect(vic.rasterCycle).toBe(1);
    expect(vic.frameNumber).toBe(1);
  });

  it('uses the nine-bit raster compare and write-one-to-clear IRQ latch', () => {
    const vic = new VicII();
    vic.write(0x11, 0x00);
    vic.write(0x12, 0x01);
    vic.write(0x1a, 0x01);

    vic.tick(63);

    expect(vic.rasterLine).toBe(1);
    expect(vic.irqAsserted).toBe(true);
    expect(vic.read(0x19)).toBe(0xf1);

    vic.write(0x19, 0x01);
    expect(vic.irqAsserted).toBe(false);
    expect(vic.read(0x19)).toBe(0x70);
  });

  it('reads the live raster high bit through $D011', () => {
    const vic = new VicII();
    vic.tick(256 * 63);

    expect(vic.rasterLine).toBe(256);
    expect(vic.read(0x11) & 0x80).toBe(0x80);
    expect(vic.read(0x12)).toBe(0x00);
  });

  it('reads the live raster through $D012 rather than the last compare value written', () => {
    const vic = new VicII();
    vic.write(0x12, 0x77);

    expect(vic.rasterCompare).toBe(0x77);
    expect(vic.peek(0x12)).toBe(0x00);
    expect(vic.read(0x12)).toBe(0x00);

    vic.tick(63);
    expect(vic.read(0x12)).toBe(0x01);
  });
});

describe('VicII standard text rendering', () => {
  it('renders fetched screen codes, character ROM, color RAM, background, and border', () => {
    const bus = new C64Bus();
    bus.roms.load('character', characterRomWithSinglePixel());

    bus.writePhysicalRam(0x0400, 0x00);
    bus.io.colorRam.write(0, 0x02);
    bus.io.vic.write(0x11, 0x1b); // DEN, 25 rows, YSCROLL=3, standard text
    bus.io.vic.write(0x16, 0x08); // 40-column select, XSCROLL=0, hires text
    bus.io.vic.write(0x18, 0x14); // screen $0400, chars $1000
    bus.io.vic.write(0x20, 0x06); // border blue
    bus.io.vic.write(0x21, 0x00); // background black

    // Raster 51 is the first default bad line. Cycle 15 fetches matrix column 0
    // and cycle 16 consumes it in the first g-access.
    bus.io.vic.tick(51 * 63 + 16);

    const frame = bus.io.vic.renderFrame();
    const activeStart = VIC_ACTIVE_Y * VIC_FRAMEBUFFER_WIDTH + VIC_ACTIVE_X;
    const sameLineBorder = VIC_ACTIVE_Y * VIC_FRAMEBUFFER_WIDTH;

    expect(frame[sameLineBorder]).toBe(0x06);
    expect(frame[activeStart]).toBe(0x02);
    expect(frame[activeStart + 1]).toBe(0x00);
  });

  it('shows only the border when display enable is clear', () => {
    const bus = new C64Bus();
    bus.io.vic.write(0x11, 0x0b); // RSEL + YSCROLL=3, DEN clear
    bus.io.vic.write(0x16, 0x08);
    bus.io.vic.write(0x20, 0x05);
    bus.io.vic.write(0x21, 0x01);
    bus.io.vic.tick(51 * 63 + 1);

    const frame = bus.io.vic.renderFrame();
    const activeStart = VIC_ACTIVE_Y * VIC_FRAMEBUFFER_WIDTH + VIC_ACTIVE_X;

    expect(frame[activeStart]).toBe(0x05);
  });
});

describe('VicII bad-line bus arbitration', () => {
  it('asserts BA three cycles before AEC and performs 40 c-accesses', () => {
    const bus = new C64Bus();
    const vic = bus.io.vic;

    bus.writePhysicalRam(0x0400, 0x12);
    bus.writePhysicalRam(0x0427, 0x34);
    bus.io.colorRam.write(0, 0x05);
    bus.io.colorRam.write(39, 0x06);

    vic.write(0x11, 0x1b); // DEN + YSCROLL=3
    vic.write(0x18, 0x14); // screen $0400, chars $1000

    vic.tick(51 * 63);
    expect(vic.rasterLine).toBe(51);
    expect(vic.rasterCycle).toBe(1);
    expect(vic.badLine).toBe(true);
    expect(vic.baHigh).toBe(true);
    expect(vic.aecHigh).toBe(true);

    vic.tick(11);
    expect(vic.rasterCycle).toBe(12);
    expect(vic.baHigh).toBe(false);
    expect(vic.aecHigh).toBe(true);

    vic.tick(3);
    expect(vic.rasterCycle).toBe(15);
    expect(vic.baHigh).toBe(false);
    expect(vic.aecHigh).toBe(false);

    vic.tick(40);
    expect(vic.rasterCycle).toBe(55);
    expect(vic.baHigh).toBe(true);
    expect(vic.aecHigh).toBe(true);
    expect(vic.cAccessesThisFrame).toBe(40);
    expect(vic.readLatchedVideoMatrix(0)).toBe(0x12);
    expect(vic.readLatchedVideoMatrix(39)).toBe(0x34);
    expect(vic.readLatchedColorMatrix(0)).toBe(0x05);
    expect(vic.readLatchedColorMatrix(39)).toBe(0x06);
  });

  it('does not generate bad lines when DEN was never observed on raster $30', () => {
    const vic = new VicII();
    vic.write(0x11, 0x03); // YSCROLL=3, DEN clear
    vic.tick(51 * 63);

    expect(vic.badLine).toBe(false);
    expect(vic.baHigh).toBe(true);
    expect(vic.aecHigh).toBe(true);
  });
});
