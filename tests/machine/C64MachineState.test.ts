import { describe, expect, it } from 'vitest';
import {
  C64Machine,
  NTSC_6567R8_TIMING,
  PAL_6569_TIMING,
  TapImage
} from '../../src/core';

describe('C64Machine v0.16 configuration and save states', () => {
  it('constructs an NTSC machine with an explicitly selected 8580 SID', () => {
    const machine = new C64Machine({ timing: NTSC_6567R8_TIMING, sidModel: '8580' });

    expect(machine.timing).toBe(NTSC_6567R8_TIMING);
    expect(machine.bus.io.vic.timing).toBe(NTSC_6567R8_TIMING);
    expect(machine.bus.io.sid.model).toBe('8580');
    expect(machine.bus.io.sid.clockFrequencyHz).toBe(NTSC_6567R8_TIMING.systemClockHz);
    expect(machine.bus.datasette.clockHz).toBe(NTSC_6567R8_TIMING.systemClockHz);
  });

  it('restores CPU, RAM, VIC, CIA, SID, color RAM, and Datasette state', () => {
    const machine = new C64Machine({ timing: PAL_6569_TIMING, sidModel: '6581' });
    machine.cpu.a = 0x42;
    machine.cpu.x = 0x17;
    machine.cpu.y = 0x99;
    machine.cpu.sp = 0xe8;
    machine.cpu.pc = 0xc123;
    machine.cpu.status = 0xa5;
    machine.cpu.cycles = 12_345;
    machine.bus.writePhysicalRam(0x2000, 0xde);
    machine.bus.io.colorRam.write(0x012, 0x0b);
    machine.bus.io.vic.write(0x20, 0x06);
    machine.bus.io.vic.tick(137);
    machine.bus.io.cia1.write(0x04, 0x34);
    machine.bus.io.cia1.write(0x05, 0x12);
    machine.bus.io.cia1.write(0x0e, 0x01);
    machine.bus.io.cia1.tick(5);
    machine.bus.io.sid.write(0x00, 0x55);
    machine.bus.io.sid.write(0x01, 0x23);
    machine.bus.io.sid.write(0x04, 0x21);
    machine.bus.io.sid.tick(12);
    machine.bus.datasette.mount(TapImage.create(0));
    machine.bus.datasette.pressPlay();

    const expectedVic = machine.bus.io.vic.saveState();
    const expectedCia = machine.bus.io.cia1.saveState();
    const expectedSid = machine.bus.io.sid.saveState();
    const state = machine.saveState();

    machine.cpu.a = 0;
    machine.cpu.pc = 0x0000;
    machine.bus.writePhysicalRam(0x2000, 0x00);
    machine.bus.io.colorRam.write(0x012, 0x00);
    machine.bus.io.vic.reset();
    machine.bus.io.cia1.reset();
    machine.bus.io.sid.reset();
    machine.bus.datasette.eject();

    machine.restoreState(state);

    expect(machine.cpu.a).toBe(0x42);
    expect(machine.cpu.x).toBe(0x17);
    expect(machine.cpu.y).toBe(0x99);
    expect(machine.cpu.sp).toBe(0xe8);
    expect(machine.cpu.pc).toBe(0xc123);
    expect(machine.cpu.cycles).toBe(12_345);
    expect(machine.bus.readPhysicalRam(0x2000)).toBe(0xde);
    expect(machine.bus.io.colorRam.memory[0x012]).toBe(0x0b);
    expect(machine.bus.io.vic.saveState()).toEqual(expectedVic);
    expect(machine.bus.io.cia1.saveState()).toEqual(expectedCia);
    expect(machine.bus.io.sid.saveState()).toEqual(expectedSid);
    expect(machine.bus.datasette.mounted).toBe(true);
    expect(machine.bus.datasette.playPressed).toBe(true);
  });

  it('rejects a save state captured for the other video standard', () => {
    const pal = new C64Machine({ timing: PAL_6569_TIMING });
    const ntsc = new C64Machine({ timing: NTSC_6567R8_TIMING });
    const state = pal.saveState();

    expect(() => ntsc.restoreState(state)).toThrow(/requires PAL timing/);
  });
});
