import { Cpu6510, type CpuClockResult } from '../cpu/Cpu6510';
import { Disassembler } from '../debugger/Disassembler';
import { TraceFormatter } from '../debugger/TraceFormatter';
import type { JoystickControl, JoystickPort } from '../io/C64Io';
import { C64Bus } from '../memory/C64Bus';
import { parsePrg, type PrgLoadResult } from '../program/Prg';
import type { C64RomKind } from '../rom/RomSet';

export interface C64SystemCycleResult {
  cpu: CpuClockResult;
  /** VIC BA level used for this system cycle. */
  baHigh: boolean;
  /** VIC AEC level used for this system cycle. */
  aecHigh: boolean;
  /** Master system-cycle number after the cycle completed. */
  masterCycle: number;
}

/**
 * Top-level composition root for one stock Commodore 64.
 *
 * The system cycle is the actual execution boundary. Each master tick
 * samples VIC-II BA/AEC, advances one 6510 micro-cycle when permitted, advances
 * VIC/CIA time once, and then resynchronizes interrupt lines.
 */
export class C64Machine {
  public readonly bus = new C64Bus();
  public readonly cpu = new Cpu6510(this.bus);
  public readonly disassembler = new Disassembler(this.bus);
  public readonly trace = new TraceFormatter(this.cpu);

  private cia2IrqWasAsserted = false;
  private restorePressed = false;
  private masterCycleCounter = 0;
  private cpuStallCounter = 0;

  loadRom(kind: C64RomKind, bytes: ArrayLike<number>): void {
    this.bus.roms.load(kind, bytes);
  }

  /**
   * Deterministic cold start for development. Real DRAM power-up patterns are
   * not yet emulated, so RAM is cleared instead of pretending to be authentic.
   */
  powerOn(): number {
    this.bus.clearRam();
    this.bus.resetProcessorPort();
    this.bus.resetIo();
    this.bus.io.colorRam.clear();
    this.cia2IrqWasAsserted = false;
    this.restorePressed = false;
    this.masterCycleCounter = 0;
    this.cpuStallCounter = 0;
    const cycles = this.cpu.reset();
    this.advanceResetCycles(cycles);
    return cycles;
  }

  /**
   * Reset preserves RAM and physical input state while resetting the processor
   * port and resettable I/O chips.
   */
  reset(): number {
    this.bus.resetProcessorPort();
    this.bus.resetIo();
    this.cia2IrqWasAsserted = false;
    this.restorePressed = false;
    this.masterCycleCounter = 0;
    this.cpuStallCounter = 0;
    const cycles = this.cpu.reset();
    this.advanceResetCycles(cycles);
    return cycles;
  }

  /**
   * Run until one 6510 instruction/interrupt sequence completes.
   *
   * The returned count is elapsed C64 system cycles, including VIC-induced CPU
   * stalls. With BA/AEC high it is identical to the instruction's CPU cycles.
   */
  step(): number {
    const startingMasterCycle = this.masterCycleCounter;
    let completed = false;

    while (!completed) {
      completed = this.tickSystemCycle().cpu.instructionCompleted;
    }

    return this.masterCycleCounter - startingMasterCycle;
  }

  /** Advance exactly one complete C64 system cycle, including the CPU. */
  tickSystemCycle(): C64SystemCycleResult {
    this.syncInterruptLines();

    const vic = this.bus.io.vic;
    const baHigh = vic.baHigh;
    const aecHigh = vic.aecHigh;
    const cpuResult = this.cpu.clock(baHigh, aecHigh);

    if (cpuResult.stalled) {
      this.cpuStallCounter += 1;
    }

    // VIC and CIAs never stop when the 6510 is denied the bus.
    this.bus.io.tick(1);
    this.masterCycleCounter += 1;
    this.syncInterruptLines();

    return {
      cpu: cpuResult,
      baHigh,
      aecHigh,
      masterCycle: this.masterCycleCounter
    };
  }

  run(maxInstructions: number, shouldStop?: (machine: C64Machine) => boolean): number {
    let executed = 0;
    while (executed < maxInstructions) {
      if (shouldStop?.(this)) {
        break;
      }
      this.step();
      executed += 1;
    }
    return executed;
  }

  /** Run whole CPU instructions until the VIC enters the next frame. */
  runFrame(maxInstructions = 100_000): number {
    const startingFrame = this.bus.io.vic.frameNumber;
    return this.run(maxInstructions, (machine) => machine.bus.io.vic.frameNumber !== startingFrame);
  }

  /**
   * RESTORE is a separate active-low NMI source on the C64 motherboard.
   * Only the press edge creates an NMI; holding the key does not retrigger it.
   */
  setRestorePressed(pressed: boolean): void {
    if (pressed && !this.restorePressed) {
      this.cpu.pulseNmi();
    }
    this.restorePressed = pressed;
  }

  setJoystickControl(port: JoystickPort, control: JoystickControl, pressed: boolean): void {
    this.bus.io.setJoystickControl(port, control, pressed);
  }

  /**
   * Load a PRG into physical RAM. A normal BASIC PRG at $0801 also refreshes
   * BASIC's text/variable boundary pointers so LIST/RUN can consume it.
   */
  loadPrg(bytes: ArrayLike<number>, initializeBasicPointers = true): PrgLoadResult {
    const parsed = parsePrg(bytes);
    this.bus.loadRam(parsed.payload, parsed.loadAddress);

    const initializeBasic = initializeBasicPointers && parsed.loadAddress === 0x0801;
    if (initializeBasic) {
      this.writeWordToRam(0x002b, parsed.loadAddress); // TXTTAB
      this.writeWordToRam(0x002d, parsed.endAddressExclusive); // VARTAB
      this.writeWordToRam(0x002f, parsed.endAddressExclusive); // ARYTAB
      this.writeWordToRam(0x0031, parsed.endAddressExclusive); // STREND
    }

    return {
      loadAddress: parsed.loadAddress,
      endAddressExclusive: parsed.endAddressExclusive,
      byteLength: parsed.payload.length,
      basicPointersInitialized: initializeBasic
    };
  }

  /** Explicit host/debugger launch point for a machine-code PRG. */
  startAt(address: number): void {
    this.cpu.setProgramCounter(address);
  }

  /** Supply one external 50/60 Hz TOD pulse to both motherboard CIAs. */
  pulseTod(): void {
    this.bus.io.cia1.pulseTod();
    this.bus.io.cia2.pulseTod();
    this.syncInterruptLines();
  }

  get masterCycles(): number {
    return this.masterCycleCounter;
  }

  get cpuStallCycles(): number {
    return this.cpuStallCounter;
  }

  private advanceResetCycles(cycles: number): void {
    for (let i = 0; i < cycles; i += 1) {
      this.bus.io.tick(1);
      this.masterCycleCounter += 1;
      this.syncInterruptLines();
    }
  }

  private writeWordToRam(address: number, value: number): void {
    this.bus.writePhysicalRam(address, value & 0xff);
    this.bus.writePhysicalRam(address + 1, (value >> 8) & 0xff);
  }

  private syncInterruptLines(): void {
    const maskableIrq = this.bus.io.cia1.irqAsserted || this.bus.io.vic.irqAsserted;
    const cia2Irq = this.bus.io.cia2.irqAsserted;

    this.cpu.setIrqLine(maskableIrq);

    if (cia2Irq && !this.cia2IrqWasAsserted) {
      this.cpu.pulseNmi();
    }

    this.cia2IrqWasAsserted = cia2Irq;
  }
}
