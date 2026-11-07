import type { Bus } from '../memory/Bus';
import { word } from '../memory/Bus';
import { Flag } from './Flags';
import { getOpcodeInfo } from './opcodes';
import type { AddressingMode, CpuSnapshot, Mnemonic, OpcodeInfo } from './types';

export type CpuCycleKind = 'read' | 'write';

export interface CpuClockResult {
  /** True when the current CPU micro-cycle actually advanced. */
  advanced: boolean;
  /** True when RDY held a read cycle and no CPU state changed. */
  stalled: boolean;
  /** Bus direction of the cycle the CPU attempted. */
  kind: CpuCycleKind;
  /** True when this cycle completed an instruction or interrupt sequence. */
  instructionCompleted: boolean;
}

interface CpuMicroOperation {
  kind: CpuCycleKind;
  run(): void;
}

interface AddressLatch {
  lo: number;
  hi: number;
  base: number;
  address: number;
  pointer: number;
  value: number;
}

export class UnsupportedOpcodeError extends Error {
  constructor(public readonly opcode: number, public readonly address: number) {
    super(`Unsupported/undocumented opcode $${hex(opcode, 2)} at $${hex(address, 4)}`);
    this.name = 'UnsupportedOpcodeError';
  }
}

/**
 * Cycle-steppable NMOS 6502 execution core used as the computational heart of
 * the MOS 6510.
 *
 * v0.5 schedules every documented instruction as explicit read/write bus
 * micro-operations. clock() advances exactly one CPU bus cycle and can hold a
 * read cycle when RDY is low. This is the behavior the C64 needs when VIC-II
 * pulls BA low before taking AEC during bad-line DMA. Write cycles are never
 * held by RDY, matching NMOS 6502/6510 behavior.
 *
 * step() remains as a compatibility convenience: it clocks with RDY high until
 * one instruction or interrupt sequence completes, preserving the public API
 * used by the existing CPU functional tests.
 */
export class Cpu6510 {
  public a = 0;
  public x = 0;
  public y = 0;
  public sp = 0xfd;
  public pc = 0;
  public status = Flag.Unused | Flag.InterruptDisable;
  public cycles = 0;

  private irqLine = false;
  private nmiPending = false;
  private microOps: CpuMicroOperation[] = [];
  private instructionActive = false;

  constructor(public readonly bus: Bus) {}

  reset(): number {
    this.a = 0;
    this.x = 0;
    this.y = 0;
    this.sp = 0xfd;
    this.status = Flag.Unused | Flag.InterruptDisable;
    this.irqLine = false;
    this.nmiPending = false;
    this.microOps = [];
    this.instructionActive = false;
    this.pc = this.readWord(0xfffc);
    this.cycles = 7;
    return 7;
  }

  snapshot(): CpuSnapshot {
    return {
      a: this.a,
      x: this.x,
      y: this.y,
      sp: this.sp,
      pc: this.pc,
      status: this.status,
      cycles: this.cycles
    };
  }

  setIrqLine(asserted: boolean): void {
    this.irqLine = asserted;
  }

  pulseNmi(): void {
    this.nmiPending = true;
  }

  getFlag(flag: Flag): boolean {
    return (this.status & flag) !== 0;
  }

  setFlag(flag: Flag, enabled: boolean): void {
    if (enabled) {
      this.status |= flag;
    } else {
      this.status &= ~flag;
    }

    this.status = (this.status | Flag.Unused) & 0xff;
  }

  /** Bus direction of the next CPU micro-cycle. Useful to model RDY correctly. */
  get nextCycleKind(): CpuCycleKind {
    return this.microOps[0]?.kind ?? 'read';
  }

  get instructionInProgress(): boolean {
    return this.instructionActive || this.microOps.length > 0;
  }

  /**
   * Advance one CPU bus cycle.
   *
   * RDY only arrests read cycles. If rdyHigh is false while the next cycle is a
   * write, the write completes and the CPU proceeds to the following cycle.
   */
  clock(rdyHigh = true, aecHigh = true): CpuClockResult {
    if (this.microOps.length === 0) {
      this.beginBoundarySequence();
    }

    const operation = this.microOps[0]!;
    if (!aecHigh || (!rdyHigh && operation.kind === 'read')) {
      return {
        advanced: false,
        stalled: true,
        kind: operation.kind,
        instructionCompleted: false
      };
    }

    this.microOps.shift();
    operation.run();
    this.cycles += 1;

    const instructionCompleted = this.microOps.length === 0;
    if (instructionCompleted) {
      this.instructionActive = false;
    }

    return {
      advanced: true,
      stalled: false,
      kind: operation.kind,
      instructionCompleted
    };
  }

  step(): number {
    const startingCycles = this.cycles;
    let completed = false;

    while (!completed) {
      completed = this.clock(true, true).instructionCompleted;
    }

    return this.cycles - startingCycles;
  }

  run(maxInstructions: number, shouldStop?: (cpu: Cpu6510) => boolean): number {
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

  private beginBoundarySequence(): void {
    this.instructionActive = true;

    if (this.nmiPending) {
      this.nmiPending = false;
      this.scheduleHardwareInterrupt(0xfffa);
      return;
    }

    if (this.irqLine && !this.getFlag(Flag.InterruptDisable)) {
      this.scheduleHardwareInterrupt(0xfffe);
      return;
    }

    this.enqueueRead(() => {
      const opcodeAddress = this.pc;
      const opcode = this.bus.read(this.pc);
      this.pc = (this.pc + 1) & 0xffff;
      const info = getOpcodeInfo(opcode);

      if (info === undefined) {
        throw new UnsupportedOpcodeError(opcode, opcodeAddress);
      }

      this.scheduleInstruction(info);
    });
  }

  private scheduleInstruction(info: OpcodeInfo): void {
    switch (info.mnemonic) {
      case 'BRK': this.scheduleBrk(); return;
      case 'JMP': this.scheduleJmp(info.mode); return;
      case 'JSR': this.scheduleJsr(); return;
      case 'RTS': this.scheduleRts(); return;
      case 'RTI': this.scheduleRti(); return;
      case 'PHA': this.schedulePush(() => this.a); return;
      case 'PHP': this.schedulePush(() => this.status | Flag.Break | Flag.Unused); return;
      case 'PLA': this.schedulePull((value) => { this.a = this.setNZ(value); }); return;
      case 'PLP': this.schedulePull((value) => { this.loadStatus(value); }); return;
      case 'BCC': this.scheduleBranch(!this.getFlag(Flag.Carry)); return;
      case 'BCS': this.scheduleBranch(this.getFlag(Flag.Carry)); return;
      case 'BEQ': this.scheduleBranch(this.getFlag(Flag.Zero)); return;
      case 'BMI': this.scheduleBranch(this.getFlag(Flag.Negative)); return;
      case 'BNE': this.scheduleBranch(!this.getFlag(Flag.Zero)); return;
      case 'BPL': this.scheduleBranch(!this.getFlag(Flag.Negative)); return;
      case 'BVC': this.scheduleBranch(!this.getFlag(Flag.Overflow)); return;
      case 'BVS': this.scheduleBranch(this.getFlag(Flag.Overflow)); return;
      default:
        break;
    }

    if (isStoreMnemonic(info.mnemonic)) {
      this.scheduleStore(info.mode, info.mnemonic);
      return;
    }

    if (isMemoryRmwMnemonic(info.mnemonic) && info.mode !== 'ACC') {
      this.scheduleMemoryRmw(info.mode, info.mnemonic);
      return;
    }

    if (isReadMnemonic(info.mnemonic)) {
      this.scheduleReadOperand(info.mode, (value) => this.executeReadMnemonic(info.mnemonic, value));
      return;
    }

    // Accumulator shifts/rotates and all ordinary implied operations are two
    // cycle instructions: opcode fetch plus a throw-away read from the next PC.
    this.enqueueRead(() => {
      this.bus.read(this.pc);
      this.executeImpliedMnemonic(info.mnemonic);
    });
  }

  private scheduleReadOperand(mode: AddressingMode, consume: (value: number) => void): void {
    const latch = freshLatch();

    switch (mode) {
      case 'IMM':
        this.enqueueRead(() => {
          const value = this.bus.read(this.pc);
          this.pc = (this.pc + 1) & 0xffff;
          consume(value);
        });
        return;
      case 'ZP':
        this.fetchZeroPageAddress(latch);
        this.enqueueRead(() => consume(this.bus.read(latch.address)));
        return;
      case 'ZPX':
      case 'ZPY': {
        const index = mode === 'ZPX' ? () => this.x : () => this.y;
        this.enqueueRead(() => {
          latch.base = this.bus.read(this.pc);
          this.pc = (this.pc + 1) & 0xffff;
        });
        this.enqueueRead(() => {
          this.bus.read(latch.base);
          latch.address = (latch.base + index()) & 0xff;
        });
        this.enqueueRead(() => consume(this.bus.read(latch.address)));
        return;
      }
      case 'ABS':
        this.fetchAbsoluteAddress(latch);
        this.enqueueRead(() => consume(this.bus.read(latch.address)));
        return;
      case 'ABSX':
      case 'ABSY': {
        const index = mode === 'ABSX' ? () => this.x : () => this.y;
        this.fetchAbsoluteBase(latch);
        this.enqueueRead(() => {
          const effective = (latch.base + index()) & 0xffff;
          const provisional = (latch.base & 0xff00) | (effective & 0x00ff);
          const value = this.bus.read(provisional);
          latch.address = effective;
          if (page(latch.base) === page(effective)) {
            consume(value);
          } else {
            this.enqueueRead(() => consume(this.bus.read(latch.address)));
          }
        });
        return;
      }
      case 'INDX':
        this.enqueueRead(() => {
          latch.pointer = this.bus.read(this.pc);
          this.pc = (this.pc + 1) & 0xffff;
        });
        this.enqueueRead(() => {
          this.bus.read(latch.pointer);
          latch.pointer = (latch.pointer + this.x) & 0xff;
        });
        this.enqueueRead(() => { latch.lo = this.bus.read(latch.pointer); });
        this.enqueueRead(() => {
          latch.hi = this.bus.read((latch.pointer + 1) & 0xff);
          latch.address = word(latch.lo, latch.hi);
        });
        this.enqueueRead(() => consume(this.bus.read(latch.address)));
        return;
      case 'INDY':
        this.enqueueRead(() => {
          latch.pointer = this.bus.read(this.pc);
          this.pc = (this.pc + 1) & 0xffff;
        });
        this.enqueueRead(() => { latch.lo = this.bus.read(latch.pointer); });
        this.enqueueRead(() => {
          latch.hi = this.bus.read((latch.pointer + 1) & 0xff);
          latch.base = word(latch.lo, latch.hi);
        });
        this.enqueueRead(() => {
          const effective = (latch.base + this.y) & 0xffff;
          const provisional = (latch.base & 0xff00) | (effective & 0x00ff);
          const value = this.bus.read(provisional);
          latch.address = effective;
          if (page(latch.base) === page(effective)) {
            consume(value);
          } else {
            this.enqueueRead(() => consume(this.bus.read(latch.address)));
          }
        });
        return;
      default:
        throw new Error(`Unsupported read addressing mode ${mode}`);
    }
  }

  private scheduleStore(mode: AddressingMode, mnemonic: 'STA' | 'STX' | 'STY'): void {
    const latch = freshLatch();
    const value = (): number => {
      switch (mnemonic) {
        case 'STA': return this.a;
        case 'STX': return this.x;
        case 'STY': return this.y;
        default: return assertNever(mnemonic);
      }
    };

    switch (mode) {
      case 'ZP':
        this.fetchZeroPageAddress(latch);
        this.enqueueWrite(() => this.bus.write(latch.address, value()));
        return;
      case 'ZPX':
      case 'ZPY': {
        const index = mode === 'ZPX' ? () => this.x : () => this.y;
        this.enqueueRead(() => {
          latch.base = this.bus.read(this.pc);
          this.pc = (this.pc + 1) & 0xffff;
        });
        this.enqueueRead(() => {
          this.bus.read(latch.base);
          latch.address = (latch.base + index()) & 0xff;
        });
        this.enqueueWrite(() => this.bus.write(latch.address, value()));
        return;
      }
      case 'ABS':
        this.fetchAbsoluteAddress(latch);
        this.enqueueWrite(() => this.bus.write(latch.address, value()));
        return;
      case 'ABSX':
      case 'ABSY': {
        const index = mode === 'ABSX' ? () => this.x : () => this.y;
        this.fetchAbsoluteBase(latch);
        this.enqueueRead(() => {
          latch.address = (latch.base + index()) & 0xffff;
          const provisional = (latch.base & 0xff00) | (latch.address & 0x00ff);
          this.bus.read(provisional);
        });
        this.enqueueWrite(() => this.bus.write(latch.address, value()));
        return;
      }
      case 'INDX':
        this.enqueueRead(() => {
          latch.pointer = this.bus.read(this.pc);
          this.pc = (this.pc + 1) & 0xffff;
        });
        this.enqueueRead(() => {
          this.bus.read(latch.pointer);
          latch.pointer = (latch.pointer + this.x) & 0xff;
        });
        this.enqueueRead(() => { latch.lo = this.bus.read(latch.pointer); });
        this.enqueueRead(() => {
          latch.hi = this.bus.read((latch.pointer + 1) & 0xff);
          latch.address = word(latch.lo, latch.hi);
        });
        this.enqueueWrite(() => this.bus.write(latch.address, value()));
        return;
      case 'INDY':
        this.enqueueRead(() => {
          latch.pointer = this.bus.read(this.pc);
          this.pc = (this.pc + 1) & 0xffff;
        });
        this.enqueueRead(() => { latch.lo = this.bus.read(latch.pointer); });
        this.enqueueRead(() => {
          latch.hi = this.bus.read((latch.pointer + 1) & 0xff);
          latch.base = word(latch.lo, latch.hi);
        });
        this.enqueueRead(() => {
          latch.address = (latch.base + this.y) & 0xffff;
          const provisional = (latch.base & 0xff00) | (latch.address & 0x00ff);
          this.bus.read(provisional);
        });
        this.enqueueWrite(() => this.bus.write(latch.address, value()));
        return;
      default:
        throw new Error(`Unsupported store addressing mode ${mode}`);
    }
  }

  private scheduleMemoryRmw(mode: AddressingMode, mnemonic: 'ASL' | 'DEC' | 'INC' | 'LSR' | 'ROL' | 'ROR'): void {
    const latch = freshLatch();
    const readValue = (): void => { latch.value = this.bus.read(latch.address); };
    const writeOld = (): void => { this.bus.write(latch.address, latch.value); };
    const writeNew = (): void => { this.bus.write(latch.address, this.transformRmw(mnemonic, latch.value)); };

    switch (mode) {
      case 'ZP':
        this.fetchZeroPageAddress(latch);
        this.enqueueRead(readValue);
        this.enqueueWrite(writeOld);
        this.enqueueWrite(writeNew);
        return;
      case 'ZPX':
        this.enqueueRead(() => {
          latch.base = this.bus.read(this.pc);
          this.pc = (this.pc + 1) & 0xffff;
        });
        this.enqueueRead(() => {
          this.bus.read(latch.base);
          latch.address = (latch.base + this.x) & 0xff;
        });
        this.enqueueRead(readValue);
        this.enqueueWrite(writeOld);
        this.enqueueWrite(writeNew);
        return;
      case 'ABS':
        this.fetchAbsoluteAddress(latch);
        this.enqueueRead(readValue);
        this.enqueueWrite(writeOld);
        this.enqueueWrite(writeNew);
        return;
      case 'ABSX':
        this.fetchAbsoluteBase(latch);
        this.enqueueRead(() => {
          latch.address = (latch.base + this.x) & 0xffff;
          const provisional = (latch.base & 0xff00) | (latch.address & 0x00ff);
          this.bus.read(provisional);
        });
        this.enqueueRead(readValue);
        this.enqueueWrite(writeOld);
        this.enqueueWrite(writeNew);
        return;
      default:
        throw new Error(`Unsupported RMW addressing mode ${mode}`);
    }
  }

  private scheduleBranch(condition: boolean): void {
    this.enqueueRead(() => {
      const byte = this.bus.read(this.pc);
      this.pc = (this.pc + 1) & 0xffff;
      if (!condition) {
        return;
      }

      const offset = byte < 0x80 ? byte : byte - 0x100;
      const oldPc = this.pc;
      const target = (oldPc + offset) & 0xffff;

      this.enqueueRead(() => {
        this.bus.read(oldPc);
        this.pc = (oldPc & 0xff00) | (target & 0x00ff);
        if (page(oldPc) !== page(target)) {
          this.enqueueRead(() => {
            this.bus.read(this.pc);
            this.pc = target;
          });
        } else {
          this.pc = target;
        }
      });
    });
  }

  private scheduleJmp(mode: AddressingMode): void {
    const latch = freshLatch();
    if (mode === 'ABS') {
      this.enqueueRead(() => {
        latch.lo = this.bus.read(this.pc);
        this.pc = (this.pc + 1) & 0xffff;
      });
      this.enqueueRead(() => {
        latch.hi = this.bus.read(this.pc);
        this.pc = word(latch.lo, latch.hi);
      });
      return;
    }

    if (mode !== 'IND') {
      throw new Error(`Unsupported JMP mode ${mode}`);
    }

    this.enqueueRead(() => {
      latch.lo = this.bus.read(this.pc);
      this.pc = (this.pc + 1) & 0xffff;
    });
    this.enqueueRead(() => {
      latch.hi = this.bus.read(this.pc);
      this.pc = (this.pc + 1) & 0xffff;
      latch.pointer = word(latch.lo, latch.hi);
    });
    this.enqueueRead(() => { latch.lo = this.bus.read(latch.pointer); });
    this.enqueueRead(() => {
      const highAddress = (latch.pointer & 0xff00) | ((latch.pointer + 1) & 0x00ff);
      latch.hi = this.bus.read(highAddress);
      this.pc = word(latch.lo, latch.hi);
    });
  }

  private scheduleJsr(): void {
    const latch = freshLatch();
    this.enqueueRead(() => {
      latch.lo = this.bus.read(this.pc);
      this.pc = (this.pc + 1) & 0xffff;
    });
    this.enqueueRead(() => { this.bus.read(0x0100 | this.sp); });
    this.enqueueWrite(() => {
      this.bus.write(0x0100 | this.sp, (this.pc >> 8) & 0xff);
      this.sp = (this.sp - 1) & 0xff;
    });
    this.enqueueWrite(() => {
      this.bus.write(0x0100 | this.sp, this.pc & 0xff);
      this.sp = (this.sp - 1) & 0xff;
    });
    this.enqueueRead(() => {
      latch.hi = this.bus.read(this.pc);
      this.pc = word(latch.lo, latch.hi);
    });
  }

  private scheduleRts(): void {
    const latch = freshLatch();
    this.enqueueRead(() => { this.bus.read(this.pc); });
    this.enqueueRead(() => { this.bus.read(0x0100 | this.sp); });
    this.enqueueRead(() => {
      this.sp = (this.sp + 1) & 0xff;
      latch.lo = this.bus.read(0x0100 | this.sp);
    });
    this.enqueueRead(() => {
      this.sp = (this.sp + 1) & 0xff;
      latch.hi = this.bus.read(0x0100 | this.sp);
      this.pc = word(latch.lo, latch.hi);
    });
    this.enqueueRead(() => {
      this.bus.read(this.pc);
      this.pc = (this.pc + 1) & 0xffff;
    });
  }

  private scheduleRti(): void {
    const latch = freshLatch();
    this.enqueueRead(() => { this.bus.read(this.pc); });
    this.enqueueRead(() => { this.bus.read(0x0100 | this.sp); });
    this.enqueueRead(() => {
      this.sp = (this.sp + 1) & 0xff;
      this.loadStatus(this.bus.read(0x0100 | this.sp));
    });
    this.enqueueRead(() => {
      this.sp = (this.sp + 1) & 0xff;
      latch.lo = this.bus.read(0x0100 | this.sp);
    });
    this.enqueueRead(() => {
      this.sp = (this.sp + 1) & 0xff;
      latch.hi = this.bus.read(0x0100 | this.sp);
      this.pc = word(latch.lo, latch.hi);
    });
  }

  private scheduleBrk(): void {
    const latch = freshLatch();
    this.enqueueRead(() => {
      this.bus.read(this.pc);
      this.pc = (this.pc + 1) & 0xffff;
    });
    this.enqueueWrite(() => this.pushCycle((this.pc >> 8) & 0xff));
    this.enqueueWrite(() => this.pushCycle(this.pc & 0xff));
    this.enqueueWrite(() => {
      this.pushCycle(this.status | Flag.Break | Flag.Unused);
      this.setFlag(Flag.InterruptDisable, true);
    });
    this.enqueueRead(() => { latch.lo = this.bus.read(0xfffe); });
    this.enqueueRead(() => {
      latch.hi = this.bus.read(0xffff);
      this.pc = word(latch.lo, latch.hi);
    });
  }

  private scheduleHardwareInterrupt(vectorAddress: number): void {
    const latch = freshLatch();
    // Hardware IRQ/NMI consumes seven cycles. The first two are discarded reads
    // from the current PC, followed by the three stack writes and vector reads.
    this.enqueueRead(() => { this.bus.read(this.pc); });
    this.enqueueRead(() => { this.bus.read(this.pc); });
    this.enqueueWrite(() => this.pushCycle((this.pc >> 8) & 0xff));
    this.enqueueWrite(() => this.pushCycle(this.pc & 0xff));
    this.enqueueWrite(() => {
      this.pushCycle((this.status & ~Flag.Break) | Flag.Unused);
      this.setFlag(Flag.InterruptDisable, true);
    });
    this.enqueueRead(() => { latch.lo = this.bus.read(vectorAddress); });
    this.enqueueRead(() => {
      latch.hi = this.bus.read((vectorAddress + 1) & 0xffff);
      this.pc = word(latch.lo, latch.hi);
    });
  }

  private schedulePush(value: () => number): void {
    this.enqueueRead(() => { this.bus.read(this.pc); });
    this.enqueueWrite(() => this.pushCycle(value()));
  }

  private schedulePull(consume: (value: number) => void): void {
    this.enqueueRead(() => { this.bus.read(this.pc); });
    this.enqueueRead(() => { this.bus.read(0x0100 | this.sp); });
    this.enqueueRead(() => {
      this.sp = (this.sp + 1) & 0xff;
      consume(this.bus.read(0x0100 | this.sp));
    });
  }

  private fetchZeroPageAddress(latch: AddressLatch): void {
    this.enqueueRead(() => {
      latch.address = this.bus.read(this.pc);
      this.pc = (this.pc + 1) & 0xffff;
    });
  }

  private fetchAbsoluteBase(latch: AddressLatch): void {
    this.enqueueRead(() => {
      latch.lo = this.bus.read(this.pc);
      this.pc = (this.pc + 1) & 0xffff;
    });
    this.enqueueRead(() => {
      latch.hi = this.bus.read(this.pc);
      this.pc = (this.pc + 1) & 0xffff;
      latch.base = word(latch.lo, latch.hi);
    });
  }

  private fetchAbsoluteAddress(latch: AddressLatch): void {
    this.enqueueRead(() => {
      latch.lo = this.bus.read(this.pc);
      this.pc = (this.pc + 1) & 0xffff;
    });
    this.enqueueRead(() => {
      latch.hi = this.bus.read(this.pc);
      this.pc = (this.pc + 1) & 0xffff;
      latch.address = word(latch.lo, latch.hi);
    });
  }

  private executeReadMnemonic(mnemonic: Mnemonic, value: number): void {
    switch (mnemonic) {
      case 'ADC': this.adc(value); break;
      case 'AND': this.a = this.setNZ(this.a & value); break;
      case 'BIT': this.bit(value); break;
      case 'CMP': this.compare(this.a, value); break;
      case 'CPX': this.compare(this.x, value); break;
      case 'CPY': this.compare(this.y, value); break;
      case 'EOR': this.a = this.setNZ(this.a ^ value); break;
      case 'LDA': this.a = this.setNZ(value); break;
      case 'LDX': this.x = this.setNZ(value); break;
      case 'LDY': this.y = this.setNZ(value); break;
      case 'ORA': this.a = this.setNZ(this.a | value); break;
      case 'SBC': this.sbc(value); break;
      default: throw new Error(`${mnemonic} is not a read-class instruction.`);
    }
  }

  private executeImpliedMnemonic(mnemonic: Mnemonic): void {
    switch (mnemonic) {
      case 'ASL': this.a = this.transformRmw('ASL', this.a); break;
      case 'CLC': this.setFlag(Flag.Carry, false); break;
      case 'CLD': this.setFlag(Flag.Decimal, false); break;
      case 'CLI': this.setFlag(Flag.InterruptDisable, false); break;
      case 'CLV': this.setFlag(Flag.Overflow, false); break;
      case 'DEX': this.x = this.setNZ((this.x - 1) & 0xff); break;
      case 'DEY': this.y = this.setNZ((this.y - 1) & 0xff); break;
      case 'INX': this.x = this.setNZ((this.x + 1) & 0xff); break;
      case 'INY': this.y = this.setNZ((this.y + 1) & 0xff); break;
      case 'LSR': this.a = this.transformRmw('LSR', this.a); break;
      case 'NOP': break;
      case 'ROL': this.a = this.transformRmw('ROL', this.a); break;
      case 'ROR': this.a = this.transformRmw('ROR', this.a); break;
      case 'SEC': this.setFlag(Flag.Carry, true); break;
      case 'SED': this.setFlag(Flag.Decimal, true); break;
      case 'SEI': this.setFlag(Flag.InterruptDisable, true); break;
      case 'TAX': this.x = this.setNZ(this.a); break;
      case 'TAY': this.y = this.setNZ(this.a); break;
      case 'TSX': this.x = this.setNZ(this.sp); break;
      case 'TXA': this.a = this.setNZ(this.x); break;
      case 'TXS': this.sp = this.x; break;
      case 'TYA': this.a = this.setNZ(this.y); break;
      default: throw new Error(`${mnemonic} is not an implied/accumulator instruction.`);
    }
  }

  private transformRmw(operation: 'ASL' | 'DEC' | 'INC' | 'LSR' | 'ROL' | 'ROR', value: number): number {
    switch (operation) {
      case 'DEC': return this.setNZ((value - 1) & 0xff);
      case 'INC': return this.setNZ((value + 1) & 0xff);
      case 'ASL':
        this.setFlag(Flag.Carry, (value & 0x80) !== 0);
        return this.setNZ((value << 1) & 0xff);
      case 'LSR':
        this.setFlag(Flag.Carry, (value & 0x01) !== 0);
        return this.setNZ(value >> 1);
      case 'ROL': {
        const carryIn = this.getFlag(Flag.Carry) ? 1 : 0;
        this.setFlag(Flag.Carry, (value & 0x80) !== 0);
        return this.setNZ(((value << 1) | carryIn) & 0xff);
      }
      case 'ROR': {
        const carryIn = this.getFlag(Flag.Carry) ? 1 : 0;
        this.setFlag(Flag.Carry, (value & 0x01) !== 0);
        return this.setNZ(((carryIn << 7) | (value >> 1)) & 0xff);
      }
      default:
        return assertNever(operation);
    }
  }

  private adc(value: number): void {
    const carryIn = this.getFlag(Flag.Carry) ? 1 : 0;
    const a = this.a;
    const binarySum = a + value + carryIn;
    const binaryResult = binarySum & 0xff;

    this.setFlag(Flag.Overflow, (~(a ^ value) & (a ^ binaryResult) & 0x80) !== 0);

    if (!this.getFlag(Flag.Decimal)) {
      this.setFlag(Flag.Carry, binarySum > 0xff);
      this.a = this.setNZ(binaryResult);
      return;
    }

    let low = (a & 0x0f) + (value & 0x0f) + carryIn;
    let decimalCarry = low > 9;

    if (decimalCarry) {
      low = (low - 10) & 0x0f;
    }

    let high = (a >> 4) + (value >> 4) + (decimalCarry ? 1 : 0);
    const intermediateNegative = (high & 0x08) !== 0;

    this.setFlag(Flag.Negative, intermediateNegative);
    this.setFlag(Flag.Overflow, ((a >= 0x80) !== intermediateNegative) && ((value >= 0x80) !== intermediateNegative));
    this.setFlag(Flag.Zero, binaryResult === 0);

    decimalCarry = high > 9;
    if (decimalCarry) {
      high = (high - 10) & 0x0f;
    }

    this.setFlag(Flag.Carry, decimalCarry);
    this.a = ((high << 4) | low) & 0xff;
  }

  private sbc(value: number): void {
    const carryIn = this.getFlag(Flag.Carry) ? 1 : 0;
    const borrow = 1 - carryIn;
    const a = this.a;
    const difference = a - value - borrow;
    const binaryResult = difference & 0xff;

    this.setFlag(Flag.Overflow, ((a ^ binaryResult) & (a ^ value) & 0x80) !== 0);

    if (!this.getFlag(Flag.Decimal)) {
      this.setFlag(Flag.Carry, difference >= 0);
      this.a = this.setNZ(binaryResult);
      return;
    }

    this.setNZ(binaryResult);

    let low = (a & 0x0f) - (value & 0x0f) - borrow;
    let high = (a >> 4) - (value >> 4);

    if (low < 0) {
      low -= 6;
      high -= 1;
    }

    if (high < 0) {
      high -= 6;
    }

    this.setFlag(Flag.Carry, difference >= 0);
    this.a = ((high << 4) | (low & 0x0f)) & 0xff;
  }

  private bit(value: number): void {
    this.setFlag(Flag.Zero, (this.a & value) === 0);
    this.setFlag(Flag.Negative, (value & 0x80) !== 0);
    this.setFlag(Flag.Overflow, (value & 0x40) !== 0);
  }

  private compare(register: number, value: number): void {
    const result = (register - value) & 0xff;
    this.setFlag(Flag.Carry, register >= value);
    this.setNZ(result);
  }

  private pushCycle(value: number): void {
    this.bus.write(0x0100 | this.sp, value & 0xff);
    this.sp = (this.sp - 1) & 0xff;
  }

  private loadStatus(value: number): void {
    this.status = ((value & ~Flag.Break) | Flag.Unused) & 0xff;
  }

  private readWord(address: number): number {
    const lo = this.bus.read(address & 0xffff);
    const hi = this.bus.read((address + 1) & 0xffff);
    return word(lo, hi);
  }

  private setNZ(value: number): number {
    const result = value & 0xff;
    this.setFlag(Flag.Zero, result === 0);
    this.setFlag(Flag.Negative, (result & 0x80) !== 0);
    return result;
  }

  private enqueueRead(run: () => void): void {
    this.microOps.push({ kind: 'read', run });
  }

  private enqueueWrite(run: () => void): void {
    this.microOps.push({ kind: 'write', run });
  }
}

function freshLatch(): AddressLatch {
  return { lo: 0, hi: 0, base: 0, address: 0, pointer: 0, value: 0 };
}

function isReadMnemonic(mnemonic: Mnemonic): boolean {
  return mnemonic === 'ADC' || mnemonic === 'AND' || mnemonic === 'BIT'
    || mnemonic === 'CMP' || mnemonic === 'CPX' || mnemonic === 'CPY'
    || mnemonic === 'EOR' || mnemonic === 'LDA' || mnemonic === 'LDX'
    || mnemonic === 'LDY' || mnemonic === 'ORA' || mnemonic === 'SBC';
}

function isStoreMnemonic(mnemonic: Mnemonic): mnemonic is 'STA' | 'STX' | 'STY' {
  return mnemonic === 'STA' || mnemonic === 'STX' || mnemonic === 'STY';
}

function isMemoryRmwMnemonic(mnemonic: Mnemonic): mnemonic is 'ASL' | 'DEC' | 'INC' | 'LSR' | 'ROL' | 'ROR' {
  return mnemonic === 'ASL' || mnemonic === 'DEC' || mnemonic === 'INC'
    || mnemonic === 'LSR' || mnemonic === 'ROL' || mnemonic === 'ROR';
}

function page(address: number): number {
  return address & 0xff00;
}

function hex(value: number, width: number): string {
  return (value >>> 0).toString(16).toUpperCase().padStart(width, '0');
}

function assertNever(value: never): never {
  throw new Error(`Unhandled value: ${String(value)}`);
}
