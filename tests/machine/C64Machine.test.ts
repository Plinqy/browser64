import { describe, expect, it } from 'vitest';
import { C64Machine } from '../../src/core/machine/C64Machine';
import { KERNAL_ROM_SIZE } from '../../src/core/rom/RomSet';

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

    const cycles = machine.step(); // NOP

    expect(cycles).toBe(2);
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

    machine.step(); // NOP; timer underflows during its cycles
    expect(machine.bus.io.cia1.irqAsserted).toBe(true);

    machine.step(); // hardware IRQ service
    expect(machine.cpu.pc).toBe(0xe200);
  });

  it('turns a new CIA2 interrupt assertion into one NMI edge', () => {
    const machine = new C64Machine();
    const kernal = kernalWithVectors(0xe000, 0xe100, 0xe200);
    machine.loadRom('kernal', kernal);
    machine.powerOn();

    machine.bus.io.cia2.write(0x0d, 0x90); // enable FLAG interrupt
    machine.setRestorePressed(true);
    expect(machine.bus.io.cia2.irqAsserted).toBe(true);

    machine.step();
    expect(machine.cpu.pc).toBe(0xe100);
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

    machine.step();
    expect(machine.cpu.pc).toBe(0xe200);
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
