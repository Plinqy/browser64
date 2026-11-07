import { describe, expect, it } from 'vitest';
import { C64Bus } from '../../src/core/memory/C64Bus';
import { CHARACTER_ROM_SIZE } from '../../src/core/rom/RomSet';
import { VIC_ACTIVE_X, VIC_ACTIVE_Y, VIC_FRAMEBUFFER_WIDTH } from '../../src/core/vic/VicII';

function firstBadLineSetup(): C64Bus {
  const bus = new C64Bus();
  const character = new Uint8Array(CHARACTER_ROM_SIZE);
  character[0] = 0xff;
  character[1] = 0x80;
  bus.roms.load('character', character);
  bus.writePhysicalRam(0x0400, 0x00);
  bus.io.colorRam.write(0, 0x07);
  bus.io.vic.write(0x11, 0x1b); // DEN, RSEL, YSCROLL=3
  bus.io.vic.write(0x16, 0x08); // CSEL, XSCROLL=0
  bus.io.vic.write(0x18, 0x14); // screen $0400 / char $1000
  return bus;
}

describe('VicII display memory sequencer', () => {
  it('feeds bad-line c-access latches into same-line g-accesses and advances VC/RC', () => {
    const bus = firstBadLineSetup();
    const vic = bus.io.vic;

    vic.tick(51 * 63 + 55); // through all 40 g-accesses on first bad line

    expect(vic.cAccessesThisFrame).toBe(40);
    expect(vic.gAccessesThisFrame).toBe(40);
    expect(vic.videoCounter).toBe(40);
    expect(vic.videoCounterBase).toBe(0);
    expect(vic.rowCounter).toBe(0);
    expect(vic.displayState).toBe(true);

    vic.tick(3); // process cycles 56, 57, 58
    expect(vic.rowCounter).toBe(1);

    // Seven more display lines complete the 8-row character cell and move VCBASE.
    vic.tick(7 * 63);
    expect(vic.videoCounterBase).toBe(40);
    expect(vic.displayState).toBe(false);
  });

  it('uses XSCROLL to shift fetched display pixels while retaining border clipping', () => {
    const bus = firstBadLineSetup();
    const vic = bus.io.vic;
    vic.write(0x16, 0x0d); // CSEL + XSCROLL=5
    vic.tick(51 * 63 + 16);

    const line = VIC_ACTIVE_Y * VIC_FRAMEBUFFER_WIDTH;
    expect(vic.framebuffer[line + VIC_ACTIVE_X]).toBe(vic.backgroundColor);
    expect(vic.framebuffer[line + VIC_ACTIVE_X + 5]).toBe(0x07);
  });
});
