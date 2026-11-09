import { describe, expect, it } from 'vitest';
import { C64Machine } from '../../src/core/machine/C64Machine';
import { KERNAL_ROM_SIZE } from '../../src/core/rom/RomSet';
import { NTSC_6567R8_TIMING, PAL_6569_TIMING } from '../../src/core/vic/VicTiming';

function kernalWithResetVector(target: number): Uint8Array {
  const kernal = new Uint8Array(KERNAL_ROM_SIZE).fill(0xea);
  kernal[0x1ffc] = target & 0xff;
  kernal[0x1ffd] = (target >> 8) & 0xff;
  return kernal;
}

describe('C64Machine', () => {
  it('resets the CPU through the KERNAL ROM reset vector', () => {
    const machine = new C64Machine();
    const kernal = kernalWithResetVector(0xfce2);
    kernal[0x1ce2] = 0xa2; // LDX #$FF
    kernal[0x1ce3] = 0xff;
    machine.loadRom('kernal', kernal);

    machine.powerOn();
    expect(machine.cpu.pc).toBe(0xfce2);

    machine.cpu.step();
    expect(machine.cpu.x).toBe(0xff);
    expect(machine.cpu.pc).toBe(0xfce4);
  });

  it('distinguishes deterministic power-on RAM clearing from reset preservation', () => {
    const machine = new C64Machine();
    machine.loadRom('kernal', kernalWithResetVector(0xe000));

    machine.bus.writePhysicalRam(0x2000, 0xaa);
    machine.powerOn();
    expect(machine.bus.readPhysicalRam(0x2000)).toBe(0x00);

    machine.bus.writePhysicalRam(0x2000, 0xbb);
    machine.bus.io.colorRam.write(0, 0x0a);
    machine.reset();
    expect(machine.bus.readPhysicalRam(0x2000)).toBe(0xbb);
    expect(machine.bus.io.colorRam.memory[0]).toBe(0x0a);
  });
});

describe('C64Machine PRG loading', () => {
  it('loads a BASIC PRG into physical RAM and updates BASIC boundaries', () => {
    const machine = new C64Machine();
    const prg = Uint8Array.of(0x01, 0x08, 0x0b, 0x08, 0x0a, 0x00, 0x99, 0x00, 0x00, 0x00);

    const result = machine.loadPrg(prg);

    expect(result.loadAddress).toBe(0x0801);
    expect(result.endAddressExclusive).toBe(0x0809);
    expect(result.basicPointersInitialized).toBe(true);
    expect(machine.bus.readPhysicalRam(0x0801)).toBe(0x0b);
    expect(machine.bus.readPhysicalRam(0x002b)).toBe(0x01);
    expect(machine.bus.readPhysicalRam(0x002c)).toBe(0x08);
    expect(machine.bus.readPhysicalRam(0x002d)).toBe(0x09);
    expect(machine.bus.readPhysicalRam(0x002e)).toBe(0x08);
    expect(machine.bus.readPhysicalRam(0x002f)).toBe(0x09);
    expect(machine.bus.readPhysicalRam(0x0031)).toBe(0x09);
  });

  it('leaves BASIC pointers alone for a non-BASIC load and can jump explicitly', () => {
    const machine = new C64Machine();
    machine.bus.writePhysicalRam(0x002d, 0xaa);
    machine.bus.writePhysicalRam(0x002e, 0xbb);

    const result = machine.loadPrg(Uint8Array.of(0x00, 0xc0, 0xea, 0x60));
    expect(result.basicPointersInitialized).toBe(false);
    expect(machine.bus.readPhysicalRam(0xc000)).toBe(0xea);
    expect(machine.bus.readPhysicalRam(0x002d)).toBe(0xaa);
    expect(machine.bus.readPhysicalRam(0x002e)).toBe(0xbb);

    machine.startAt(result.loadAddress);
    expect(machine.cpu.pc).toBe(0xc000);
  });
});

describe('C64Machine CIA integration', () => {
  function kernalWithVectors(reset: number, nmi: number, irq: number): Uint8Array {
    const kernal = new Uint8Array(KERNAL_ROM_SIZE).fill(0xea);
    const writeVector = (offset: number, target: number): void => {
      kernal[offset] = target & 0xff;
      kernal[offset + 1] = (target >> 8) & 0xff;
    };
    writeVector(0x1ffa, nmi);
    writeVector(0x1ffc, reset);
    writeVector(0x1ffe, irq);
    return kernal;
  }

  it('advances both CIAs by the CPU instruction cycle count', () => {
    const machine = new C64Machine();
    const kernal = kernalWithVectors(0xe000, 0xe100, 0xe200);
    machine.loadRom('kernal', kernal);
    machine.powerOn();

    machine.bus.io.cia1.write(0x04, 0x0a);
    machine.bus.io.cia1.write(0x05, 0x00);
    machine.bus.io.cia1.write(0x0e, 0x01);

    const cycles = machine.step(); // first NOP spans the CIA START pipeline

    expect(cycles).toBe(2);
    expect(machine.bus.io.cia1.timerACounter).toBe(10);
    machine.step();
    expect(machine.bus.io.cia1.timerACounter).toBe(8);
  });

  it('delivers CIA1 enabled interrupts through the 6510 IRQ input', () => {
    const machine = new C64Machine();
    const kernal = kernalWithVectors(0xe000, 0xe100, 0xe200);
    kernal[0x0000] = 0x58; // CLI
    kernal[0x0001] = 0xea; // NOP
    machine.loadRom('kernal', kernal);
    machine.powerOn();

    machine.step(); // CLI
    machine.bus.io.cia1.write(0x04, 0x00);
    machine.bus.io.cia1.write(0x05, 0x00);
    machine.bus.io.cia1.write(0x0d, 0x81);
    machine.bus.io.cia1.write(0x0e, 0x01);

    machine.step(); // NOP; source flag appears, master IRQ is still delayed
    expect(machine.bus.io.cia1.irqAsserted).toBe(false);

    machine.step(); // next NOP promotes the CIA IRQ latch
    expect(machine.bus.io.cia1.irqAsserted).toBe(true);
    expect(machine.cpu.pc).toBe(0xe003);
    machine.step(); // one instruction was already sampled before the IRQ edge
    expect(machine.cpu.pc).toBe(0xe004);
    machine.step(); // hardware IRQ service
    expect(machine.cpu.pc).toBe(0xe200);
  });

  it('turns a new CIA2 interrupt assertion into one NMI edge', () => {
    const machine = new C64Machine();
    const kernal = kernalWithVectors(0xe000, 0xe100, 0xe200);
    machine.loadRom('kernal', kernal);
    machine.powerOn();

    machine.bus.io.cia2.write(0x0d, 0x90); // enable FLAG interrupt
    machine.bus.io.cia2.setFlagLine(false);
    expect(machine.bus.io.cia2.irqAsserted).toBe(false);

    machine.step(); // FLAG source is promoted to the CIA2 interrupt output
    expect(machine.bus.io.cia2.irqAsserted).toBe(true);
    machine.step(); // NMI edge has been latched by the CPU
    machine.step(); // hardware NMI service
    expect(machine.cpu.pc).toBe(0xe100);
  });

  it('delivers RESTORE directly as a separate NMI source', () => {
    const machine = new C64Machine();
    const kernal = kernalWithVectors(0xe000, 0xe100, 0xe200);
    machine.loadRom('kernal', kernal);
    machine.powerOn();

    machine.setRestorePressed(true);
    expect(machine.bus.io.cia2.irqAsserted).toBe(false);

    machine.step();
    expect(machine.cpu.pc).toBe(0xe100);

    // Holding RESTORE is not a second edge.
    machine.setRestorePressed(true);
    machine.step();
    expect(machine.cpu.pc).toBe(0xe101);
  });
});

describe('C64Machine VIC-II timing integration', () => {
  it('tracks every returned CPU cycle on the master clock and VIC raster', () => {
    const machine = new C64Machine();
    const kernal = kernalWithResetVector(0xe000);
    machine.loadRom('kernal', kernal);

    const resetCycles = machine.powerOn();
    expect(resetCycles).toBe(7);
    expect(machine.masterCycles).toBe(7);
    expect(machine.bus.io.vic.rasterCycle).toBe(8);

    const instructionCycles = machine.step();
    expect(instructionCycles).toBe(2);
    expect(machine.masterCycles).toBe(9);
    expect(machine.bus.io.vic.rasterCycle).toBe(10);
  });

  it('delivers an enabled VIC raster interrupt through the 6510 IRQ line', () => {
    const machine = new C64Machine();
    const kernal = new Uint8Array(KERNAL_ROM_SIZE).fill(0xea);
    kernal[0x0000] = 0x58; // $E000 CLI
    kernal[0x1ffc] = 0x00;
    kernal[0x1ffd] = 0xe0;
    kernal[0x1ffe] = 0x00;
    kernal[0x1fff] = 0xe2;
    machine.loadRom('kernal', kernal);
    machine.powerOn();

    machine.step(); // CLI, total raster cycles now 9
    machine.bus.io.vic.write(0x11, 0x00);
    machine.bus.io.vic.write(0x12, 0x01);
    machine.bus.io.vic.write(0x1a, 0x01);

    for (let i = 0; i < 54; i += 1) {
      machine.tickSystemCycle();
    }

    expect(machine.bus.io.vic.rasterLine).toBe(1);
    expect(machine.bus.io.vic.irqAsserted).toBe(true);

    for (let i = 0; i < 10 && machine.cpu.pc < 0xe200; i += 1) {
      machine.step();
    }
    expect(machine.cpu.pc).toBeGreaterThanOrEqual(0xe200);
    expect(machine.cpu.pc).toBeLessThan(0xe300);
  });
});

describe('C64Machine VIC-II bus arbitration', () => {
  it('stalls a read-only CPU stream for 43 master cycles on a PAL bad line', () => {
    const machine = new C64Machine();
    const kernal = new Uint8Array(KERNAL_ROM_SIZE).fill(0xea); // NOP stream
    kernal[0x1ffc] = 0x00;
    kernal[0x1ffd] = 0xe0;
    kernal[0x1ffe] = 0x00;
    kernal[0x1fff] = 0xe0;
    machine.loadRom('kernal', kernal);
    machine.powerOn();
    machine.bus.io.vic.write(0x11, 0x1b); // DEN + YSCROLL=3

    let guard = 0;
    while (!(machine.bus.io.vic.rasterLine === 51 && machine.bus.io.vic.rasterCycle === 12)) {
      machine.tickSystemCycle();
      guard += 1;
      if (guard > 4000) throw new Error('Failed to reach first PAL bad line.');
    }

    const cpuCyclesBefore = machine.cpu.cycles;
    const stallsBefore = machine.cpuStallCycles;
    const masterBefore = machine.masterCycles;

    for (let i = 0; i < 43; i += 1) {
      machine.tickSystemCycle();
    }

    expect(machine.bus.io.vic.rasterCycle).toBe(55);
    expect(machine.masterCycles - masterBefore).toBe(43);
    expect(machine.cpu.cycles).toBe(cpuCyclesBefore);
    expect(machine.cpuStallCycles - stallsBefore).toBe(43);

    machine.tickSystemCycle();
    expect(machine.cpu.cycles).toBe(cpuCyclesBefore + 1);
  });

  it('reports the VIC bus signals that governed each master cycle', () => {
    const machine = new C64Machine();
    machine.loadRom('kernal', kernalWithResetVector(0xe000));
    machine.powerOn();

    const result = machine.tickSystemCycle();
    expect(result.baHigh).toBe(true);
    expect(result.aecHigh).toBe(true);
    expect(result.masterCycle).toBe(machine.masterCycles);
  });
});

describe('C64Machine sprite DMA arbitration', () => {
  it('stalls a read-only CPU stream for the PAL five-cycle single-sprite DMA window', () => {
    const machine = new C64Machine();
    const kernal = new Uint8Array(KERNAL_ROM_SIZE).fill(0xea); // NOP stream
    kernal[0x1ffc] = 0x00;
    kernal[0x1ffd] = 0xe0;
    machine.loadRom('kernal', kernal);
    machine.powerOn();

    // Sprite 0 first appears on raster Y+1. Use raster 52 so this is not a bad line.
    machine.bus.io.vic.write(0x11, 0x1b);
    machine.bus.io.vic.write(0x16, 0x08);
    machine.bus.io.vic.write(0x18, 0x14);
    machine.bus.writePhysicalRam(0x07f8, 0x20);
    machine.bus.writePhysicalRam(0x0800, 0x80);
    machine.bus.io.vic.write(0x00, 24);
    machine.bus.io.vic.write(0x01, 51);
    machine.bus.io.vic.write(0x15, 0x01);

    let guard = 0;
    while (!(machine.bus.io.vic.rasterLine === 52 && machine.bus.io.vic.rasterCycle === 55)) {
      machine.tickSystemCycle();
      guard += 1;
      if (guard > 5000) throw new Error('Failed to reach sprite-0 PAL DMA window.');
    }

    const cpuBefore = machine.cpu.cycles;
    const stallsBefore = machine.cpuStallCycles;
    for (let i = 0; i < 5; i += 1) {
      machine.tickSystemCycle();
    }

    expect(machine.cpu.cycles).toBe(cpuBefore);
    expect(machine.cpuStallCycles - stallsBefore).toBe(5);
    expect(machine.bus.io.vic.rasterCycle).toBe(60);

    machine.tickSystemCycle();
    expect(machine.cpu.cycles).toBe(cpuBefore + 1);
  });
});

describe('C64Machine SID integration', () => {
  it('clocks the SID once for every master system cycle, including normal CPU execution', () => {
    const machine = new C64Machine();
    machine.loadRom('kernal', kernalWithResetVector(0xe000));
    machine.powerOn();

    machine.bus.write(0xd400, 0x34);
    machine.bus.write(0xd401, 0x12);
    const before = machine.bus.io.sid.voices[0].oscillator.accumulator;

    for (let cycle = 0; cycle < 10; cycle += 1) machine.tickSystemCycle();

    expect(machine.bus.io.sid.voices[0].oscillator.accumulator)
      .toBe((before + 10 * 0x1234) & 0x00ff_ffff);
  });
});


describe('C64Machine PAL/NTSC profiles', () => {
  it('uses PAL 6569 timing by default across VIC and SID', () => {
    const machine = new C64Machine();

    expect(machine.timing).toBe(PAL_6569_TIMING);
    expect(machine.bus.timing).toBe(PAL_6569_TIMING);
    expect(machine.bus.io.vic.timing).toBe(PAL_6569_TIMING);
    expect(machine.bus.io.vic.cyclesPerFrame).toBe(63 * 312);
    expect(machine.bus.io.sid.clockFrequencyHz).toBe(PAL_6569_TIMING.systemClockHz);
  });

  it('propagates the NTSC 6567R8 clock and raster geometry to timed devices', () => {
    const machine = new C64Machine(NTSC_6567R8_TIMING);

    expect(machine.timing).toBe(NTSC_6567R8_TIMING);
    expect(machine.bus.io.vic.timing).toBe(NTSC_6567R8_TIMING);
    expect(machine.bus.io.vic.cyclesPerFrame).toBe(65 * 263);
    expect(machine.bus.io.sid.clockFrequencyHz).toBe(NTSC_6567R8_TIMING.systemClockHz);
  });
});
