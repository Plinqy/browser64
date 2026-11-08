import { describe, expect, it } from 'vitest';
import { C64Machine } from '../../src/core/machine/C64Machine';
import { KERNAL_ROM_SIZE } from '../../src/core/rom/RomSet';

function machineWithProgram(bytes: readonly number[], resetAddress = 0xe000): C64Machine {
  const machine = new C64Machine();
  const kernal = new Uint8Array(KERNAL_ROM_SIZE).fill(0xea);
  const offset = resetAddress - 0xe000;
  kernal.set(bytes, offset);
  kernal[0x1ffc] = resetAddress & 0xff;
  kernal[0x1ffd] = (resetAddress >> 8) & 0xff;
  machine.loadRom('kernal', kernal);
  machine.powerOn();
  return machine;
}

describe('C64Monitor breakpoints', () => {
  it('stops before an address breakpoint and continues past it exactly once', () => {
    const machine = machineWithProgram([0xea, 0xea, 0xea]);
    const breakpoint = machine.monitor.addAddressBreakpoint(0xe001);

    expect(machine.run(10)).toBe(1);
    expect(machine.cpu.pc).toBe(0xe001);
    expect(machine.monitor.stopReason).toEqual({
      type: 'address',
      breakpointId: breakpoint.id,
      address: 0xe001
    });

    machine.monitor.resume();
    expect(machine.run(1)).toBe(1);
    expect(machine.cpu.pc).toBe(0xe002);
    expect(machine.monitor.stopReason).toBeNull();
  });

  it('latches a write watchpoint at the exact CPU bus access and pauses after the instruction', () => {
    const machine = machineWithProgram([
      0xa9, 0x42,       // LDA #$42
      0x8d, 0x00, 0x02, // STA $0200
      0xea
    ]);
    const watchpoint = machine.monitor.addWatchpoint(0x0200, 'write');

    expect(machine.run(10)).toBe(2);
    expect(machine.cpu.pc).toBe(0xe005);
    expect(machine.bus.readPhysicalRam(0x0200)).toBe(0x42);

    const reason = machine.monitor.stopReason;
    expect(reason?.type).toBe('watchpoint');
    if (reason?.type !== 'watchpoint') throw new Error('Expected watchpoint stop.');
    expect(reason.watchpointId).toBe(watchpoint.id);
    expect(reason.access.kind).toBe('write');
    expect(reason.access.address).toBe(0x0200);
    expect(reason.access.value).toBe(0x42);
  });

  it('stops on a precise raster line/cycle without leaving the CPU mid-instruction', () => {
    const machine = machineWithProgram([0xea, 0xea, 0xea]);
    expect(machine.bus.io.vic.rasterLine).toBe(0);
    expect(machine.bus.io.vic.rasterCycle).toBe(8);
    const breakpoint = machine.monitor.addRasterBreakpoint(0, 10);

    expect(machine.run(10)).toBe(1);
    expect(machine.cpu.instructionInProgress).toBe(false);
    expect(machine.bus.io.vic.rasterCycle).toBe(10);
    expect(machine.monitor.stopReason).toEqual({
      type: 'raster',
      breakpointId: breakpoint.id,
      rasterLine: 0,
      rasterCycle: 10
    });
  });
});

describe('C64Monitor inspection and editing', () => {
  it('reads mapped memory through peek without adding CPU bus trace entries', () => {
    const machine = machineWithProgram([0xea]);
    machine.bus.writePhysicalRam(0x2000, 0x7b);
    const traceLength = machine.monitor.busTrace.length;

    expect(Array.from(machine.monitor.readMemory(0x2000, 1))).toEqual([0x7b]);
    expect(machine.monitor.busTrace.length).toBe(traceLength);
  });

  it('edits physical RAM and CPU registers only at instruction boundaries', () => {
    const machine = machineWithProgram([0xea]);

    machine.monitor.writeMemory(0x1234, 0xaa);
    machine.monitor.setCpuRegisters({ a: 0x1ff, x: 0x44, pc: 0xc000, status: 0 });

    expect(machine.bus.readPhysicalRam(0x1234)).toBe(0xaa);
    expect(machine.cpu.a).toBe(0xff);
    expect(machine.cpu.x).toBe(0x44);
    expect(machine.cpu.pc).toBe(0xc000);
    expect(machine.cpu.status & 0x20).toBe(0x20);
  });

  it('captures execution, bus, interrupt, hardware, and screen-memory diagnostics', () => {
    const machine = machineWithProgram([0xea, 0xea]);
    machine.bus.io.vic.write(0x18, 0x10); // screen memory at VIC-bank + $0400
    machine.bus.writePhysicalRam(0x0400, 0x41);
    machine.bus.io.colorRam.write(0, 0x06);

    machine.step();
    machine.setRestorePressed(true);
    machine.setRestorePressed(false);

    expect(machine.monitor.executionHistory.at(-1)?.pc).toBe(0xe000);
    expect(machine.monitor.executionHistory.at(-1)?.instruction).toBe('NOP');
    expect(machine.monitor.busTrace.length).toBeGreaterThan(0);
    expect(machine.monitor.interruptHistory.at(-1)?.kind).toBe('NMI');
    expect(machine.monitor.interruptHistory.at(-1)?.sources).toEqual(['RESTORE']);

    const hardware = machine.monitor.hardwareSnapshot();
    expect(hardware.cpu.pc).toBe(0xe001);
    expect(hardware.vic.rasterLine).toBe(machine.bus.io.vic.rasterLine);
    expect(hardware.sid.model).toBe(machine.bus.io.sid.model);

    const screen = machine.monitor.screenMemorySnapshot();
    expect(screen.address).toBe(0x0400);
    expect(screen.characters[0]).toBe(0x41);
    expect(screen.colors[0]).toBe(0x06);
  });

  it('preserves configured breakpoints across reset while clearing runtime history', () => {
    const machine = machineWithProgram([0xea]);
    machine.monitor.addAddressBreakpoint(0xe000);
    machine.step();
    expect(machine.monitor.executionHistory.length).toBe(1);

    machine.reset();

    expect(machine.monitor.addressBreakpoints).toHaveLength(1);
    expect(machine.monitor.executionHistory).toHaveLength(0);
    expect(machine.monitor.busTrace).toHaveLength(0);
    expect(machine.monitor.interruptHistory).toHaveLength(0);
    expect(machine.monitor.stopReason).toBeNull();
  });
});
