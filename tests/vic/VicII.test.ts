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
});

describe('VicII standard text rendering', () => {
  it('renders screen codes, character ROM, color RAM, background, and border', () => {
    const bus = new C64Bus();
    bus.roms.load('character', characterRomWithSinglePixel());

    bus.writePhysicalRam(0x0400, 0x00);
    bus.io.colorRam.write(0, 0x02);
    bus.io.vic.write(0x11, 0x10); // DEN, standard text
    bus.io.vic.write(0x16, 0x08); // 40-column select, hires text
    bus.io.vic.write(0x18, 0x14); // screen $0400, chars $1000
    bus.io.vic.write(0x20, 0x06); // border blue
    bus.io.vic.write(0x21, 0x00); // background black

    const frame = bus.io.vic.renderFrame();
    const activeStart = VIC_ACTIVE_Y * VIC_FRAMEBUFFER_WIDTH + VIC_ACTIVE_X;

    expect(frame[0]).toBe(0x06);
    expect(frame[activeStart]).toBe(0x02);
    expect(frame[activeStart + 1]).toBe(0x00);
  });

  it('shows only the border when display enable is clear', () => {
    const bus = new C64Bus();
    bus.io.vic.write(0x20, 0x05);
    bus.io.vic.write(0x21, 0x01);

    const frame = bus.io.vic.renderFrame();
    const activeStart = VIC_ACTIVE_Y * VIC_FRAMEBUFFER_WIDTH + VIC_ACTIVE_X;

    expect(frame[0]).toBe(0x05);
    expect(frame[activeStart]).toBe(0x05);
  });
});
