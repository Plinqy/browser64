import { Cpu6510 } from '../cpu/Cpu6510';
import { Disassembler } from '../debugger/Disassembler';
import { TraceFormatter } from '../debugger/TraceFormatter';
import { C64Bus } from '../memory/C64Bus';
import type { C64RomKind } from '../rom/RomSet';

/**
 * Top-level composition root for one stock Commodore 64.
 *
 * v0.3 adds the first machine scheduler boundary: CPU instructions still run
 * atomically, but their returned PHI2 cycle totals advance both CIA chips and
 * the CIA interrupt outputs are wired to the 6510 between instructions.
 */
export class C64Machine {
  public readonly bus = new C64Bus();
  public readonly cpu = new Cpu6510(this.bus);
  public readonly disassembler = new Disassembler(this.bus);
  public readonly trace = new TraceFormatter(this.cpu);

  private cia2IrqWasAsserted = false;

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
    const cycles = this.cpu.reset();
    this.syncInterruptLines();
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
    const cycles = this.cpu.reset();
    this.syncInterruptLines();
    return cycles;
  }

  /** Execute one 6510 instruction/interrupt service and advance CIA PHI2 time. */
  step(): number {
    this.syncInterruptLines();
    const cycles = this.cpu.step();
    this.bus.io.tick(cycles);
    this.syncInterruptLines();
    return cycles;
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

  private syncInterruptLines(): void {
    const cia1Irq = this.bus.io.cia1.irqAsserted;
    const cia2Irq = this.bus.io.cia2.irqAsserted;

    this.cpu.setIrqLine(cia1Irq);

    if (cia2Irq && !this.cia2IrqWasAsserted) {
      this.cpu.pulseNmi();
    }

    this.cia2IrqWasAsserted = cia2Irq;
  }
}
