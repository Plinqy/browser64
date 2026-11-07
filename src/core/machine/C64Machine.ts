import { Cpu6510 } from '../cpu/Cpu6510';
import { Disassembler } from '../debugger/Disassembler';
import { TraceFormatter } from '../debugger/TraceFormatter';
import { C64Bus } from '../memory/C64Bus';
import type { C64RomKind } from '../rom/RomSet';

/**
 * Top-level composition root for one stock Commodore 64.
 *
 * v0.4 establishes a one-system-cycle master clock boundary. CPU instructions
 * are still executed atomically by the 6510 core, but every returned cycle is
 * replayed individually through VIC-II and both CIA chips so raster/peripheral
 * time shares one machine clock.
 */
export class C64Machine {
  public readonly bus = new C64Bus();
  public readonly cpu = new Cpu6510(this.bus);
  public readonly disassembler = new Disassembler(this.bus);
  public readonly trace = new TraceFormatter(this.cpu);

  private cia2IrqWasAsserted = false;
  private masterCycleCounter = 0;

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
    this.masterCycleCounter = 0;
    const cycles = this.cpu.reset();
    this.advanceSystemCycles(cycles);
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
    this.masterCycleCounter = 0;
    const cycles = this.cpu.reset();
    this.advanceSystemCycles(cycles);
    return cycles;
  }

  /** Execute one 6510 instruction/interrupt service and advance machine time. */
  step(): number {
    this.syncInterruptLines();
    const cycles = this.cpu.step();
    this.advanceSystemCycles(cycles);
    return cycles;
  }

  /** Advance exactly one C64 system cycle without executing a CPU instruction. */
  tickSystemCycle(): void {
    this.bus.io.tick(1);
    this.masterCycleCounter += 1;
    this.syncInterruptLines();
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

  /** RESTORE is connected to CIA2 FLAG, whose enabled interrupt output drives NMI. */
  setRestorePressed(pressed: boolean): void {
    this.bus.io.cia2.setFlagLine(!pressed);
    this.syncInterruptLines();
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

  private advanceSystemCycles(cycles: number): void {
    for (let i = 0; i < cycles; i += 1) {
      this.tickSystemCycle();
    }
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
