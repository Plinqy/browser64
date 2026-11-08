import { describe, expect, it } from 'vitest';
import { C64Machine } from '../../src/core/machine/C64Machine';
import { C1541_ROM_SIZE } from '../../src/core/drive1541/C1541Bus';
import { KERNAL_ROM_SIZE } from '../../src/core/rom/RomSet';
import { NTSC_6567R8_TIMING, PAL_6569_TIMING } from '../../src/core/vic/VicTiming';

function c64Kernal(): Uint8Array {
  const rom = new Uint8Array(KERNAL_ROM_SIZE).fill(0xea);
  rom[0x1ffc] = 0x00;
  rom[0x1ffd] = 0xe0;
  return rom;
}

function driveRom(): Uint8Array {
  const rom = new Uint8Array(C1541_ROM_SIZE).fill(0xea);
  rom[0x3ffc] = 0x00;
  rom[0x3ffd] = 0x80;
  return rom;
}

describe('C64Machine true-drive integration', () => {
  it('shares the motherboard IEC bus with the 1541 endpoint', () => {
    const machine = new C64Machine();

    machine.bus.io.cia2.write(0x02, 0x08);
    machine.bus.io.cia2.write(0x00, 0x08); // C64 asserts ATN
    machine.drive1541.tick();

    expect(machine.bus.io.iecBus.atnHigh).toBe(false);
    expect(machine.drive1541.via0.read(0x00) & 0x80).toBe(0x80);
  });

  it('advances the fixed 1 MHz drive clock by rational accumulation on PAL', () => {
    const machine = new C64Machine(PAL_6569_TIMING);
    machine.loadRom('kernal', c64Kernal());
    machine.load1541Rom(driveRom());
    machine.powerOn();
    const before = machine.drive1541.cycles;

    for (let i = 0; i < 10_000; i += 1) machine.tickSystemCycle();

    const expected = Math.floor(10_000 * 1_000_000 / PAL_6569_TIMING.systemClockHz);
    expect(Math.abs((machine.drive1541.cycles - before) - expected)).toBeLessThanOrEqual(1);
  });

  it('uses the same 1 MHz drive against the faster NTSC C64 clock', () => {
    const machine = new C64Machine(NTSC_6567R8_TIMING);
    machine.loadRom('kernal', c64Kernal());
    machine.load1541Rom(driveRom());
    machine.powerOn();
    const before = machine.drive1541.cycles;

    for (let i = 0; i < 10_000; i += 1) machine.tickSystemCycle();

    const expected = Math.floor(10_000 * 1_000_000 / NTSC_6567R8_TIMING.systemClockHz);
    expect(Math.abs((machine.drive1541.cycles - before) - expected)).toBeLessThanOrEqual(1);
  });

  it('mounts D64 media into the true-drive mechanism independently of host-assisted loading', () => {
    const machine = new C64Machine();
    const image = machine.mountD64In1541(new Uint8Array(174_848));
    expect(machine.drive1541.mechanism.mounted).toBe(true);
    expect(image.geometry.tracks).toBe(35);
    machine.eject1541Disk();
    expect(machine.drive1541.mechanism.mounted).toBe(false);
  });
});
