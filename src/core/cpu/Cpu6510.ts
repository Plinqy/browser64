import type { Bus } from '../memory/Bus';
import { word } from '../memory/Bus';
import { Flag } from './Flags';
import { getOpcodeInfo } from './opcodes';
import type { AddressingMode, CpuSnapshot, OpcodeInfo } from './types';

interface ResolvedOperand {
  address?: number;
  value?: number;
  relativeOffset?: number;
  pageCrossed: boolean;
}

export class UnsupportedOpcodeError extends Error {
  constructor(public readonly opcode: number, public readonly address: number) {
    super(`Unsupported/undocumented opcode $${hex(opcode, 2)} at $${hex(address, 4)}`);
    this.name = 'UnsupportedOpcodeError';
  }
}

/**
 * NMOS 6502 execution core used as the computational heart of the MOS 6510.
 *
 * The C64-specific 6510 I/O port and memory banking belong to the machine bus,
 * not to the instruction decoder. This keeps the CPU reusable in isolated CPU
 * tests while allowing the later C64 bus to implement $0000/$0001 correctly.
 *
 * v0.1 executes one complete instruction per step(). It accounts for official
 * instruction cycle totals, indexed page-cross penalties, and branch penalties,
 * but does not yet expose each individual bus cycle as a micro-operation.
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

  constructor(public readonly bus: Bus) {}

  reset(): number {
    this.a = 0;
    this.x = 0;
    this.y = 0;
    this.sp = 0xfd;
    this.status = Flag.Unused | Flag.InterruptDisable;
    this.irqLine = false;
    this.nmiPending = false;
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

  step(): number {
    if (this.nmiPending) {
      this.nmiPending = false;
      return this.serviceHardwareInterrupt(0xfffa);
    }

    if (this.irqLine && !this.getFlag(Flag.InterruptDisable)) {
      return this.serviceHardwareInterrupt(0xfffe);
    }

    const opcodeAddress = this.pc;
    const opcode = this.fetchByte();
    const info = getOpcodeInfo(opcode);

    if (info === undefined) {
      throw new UnsupportedOpcodeError(opcode, opcodeAddress);
    }

    const operand = this.resolveOperand(info.mode);
    let instructionCycles = info.cycles;

    if (info.pageCrossCycle && operand.pageCrossed) {
      instructionCycles += 1;
    }

    instructionCycles += this.execute(info, operand);
    this.cycles += instructionCycles;
    return instructionCycles;
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

  private execute(info: OpcodeInfo, operand: ResolvedOperand): number {
    switch (info.mnemonic) {
      case 'ADC': this.adc(this.readOperand(operand)); break;
      case 'AND': this.a = this.setNZ(this.a & this.readOperand(operand)); break;
      case 'ASL': this.shiftOrRotate(operand, 'ASL'); break;
      case 'BCC': return this.branch(!this.getFlag(Flag.Carry), operand);
      case 'BCS': return this.branch(this.getFlag(Flag.Carry), operand);
      case 'BEQ': return this.branch(this.getFlag(Flag.Zero), operand);
      case 'BIT': this.bit(this.readOperand(operand)); break;
      case 'BMI': return this.branch(this.getFlag(Flag.Negative), operand);
      case 'BNE': return this.branch(!this.getFlag(Flag.Zero), operand);
      case 'BPL': return this.branch(!this.getFlag(Flag.Negative), operand);
      case 'BRK': this.brk(); break;
      case 'BVC': return this.branch(!this.getFlag(Flag.Overflow), operand);
      case 'BVS': return this.branch(this.getFlag(Flag.Overflow), operand);
      case 'CLC': this.setFlag(Flag.Carry, false); break;
      case 'CLD': this.setFlag(Flag.Decimal, false); break;
      case 'CLI': this.setFlag(Flag.InterruptDisable, false); break;
      case 'CLV': this.setFlag(Flag.Overflow, false); break;
      case 'CMP': this.compare(this.a, this.readOperand(operand)); break;
      case 'CPX': this.compare(this.x, this.readOperand(operand)); break;
      case 'CPY': this.compare(this.y, this.readOperand(operand)); break;
      case 'DEC': this.rmw(operand, (value) => this.setNZ((value - 1) & 0xff)); break;
      case 'DEX': this.x = this.setNZ((this.x - 1) & 0xff); break;
      case 'DEY': this.y = this.setNZ((this.y - 1) & 0xff); break;
      case 'EOR': this.a = this.setNZ(this.a ^ this.readOperand(operand)); break;
      case 'INC': this.rmw(operand, (value) => this.setNZ((value + 1) & 0xff)); break;
      case 'INX': this.x = this.setNZ((this.x + 1) & 0xff); break;
      case 'INY': this.y = this.setNZ((this.y + 1) & 0xff); break;
      case 'JMP': this.pc = this.requireAddress(operand); break;
      case 'JSR': this.jsr(this.requireAddress(operand)); break;
      case 'LDA': this.a = this.setNZ(this.readOperand(operand)); break;
      case 'LDX': this.x = this.setNZ(this.readOperand(operand)); break;
      case 'LDY': this.y = this.setNZ(this.readOperand(operand)); break;
      case 'LSR': this.shiftOrRotate(operand, 'LSR'); break;
      case 'NOP': break;
      case 'ORA': this.a = this.setNZ(this.a | this.readOperand(operand)); break;
      case 'PHA': this.push(this.a); break;
      case 'PHP': this.push(this.status | Flag.Break | Flag.Unused); break;
      case 'PLA': this.a = this.setNZ(this.pop()); break;
      case 'PLP': this.loadStatus(this.pop()); break;
      case 'ROL': this.shiftOrRotate(operand, 'ROL'); break;
      case 'ROR': this.shiftOrRotate(operand, 'ROR'); break;
      case 'RTI': this.rti(); break;
      case 'RTS': this.rts(); break;
      case 'SBC': this.sbc(this.readOperand(operand)); break;
      case 'SEC': this.setFlag(Flag.Carry, true); break;
      case 'SED': this.setFlag(Flag.Decimal, true); break;
      case 'SEI': this.setFlag(Flag.InterruptDisable, true); break;
      case 'STA': this.bus.write(this.requireAddress(operand), this.a); break;
      case 'STX': this.bus.write(this.requireAddress(operand), this.x); break;
      case 'STY': this.bus.write(this.requireAddress(operand), this.y); break;
      case 'TAX': this.x = this.setNZ(this.a); break;
      case 'TAY': this.y = this.setNZ(this.a); break;
      case 'TSX': this.x = this.setNZ(this.sp); break;
      case 'TXA': this.a = this.setNZ(this.x); break;
      case 'TXS': this.sp = this.x; break;
      case 'TYA': this.a = this.setNZ(this.y); break;
      default: return assertNever(info.mnemonic);
    }

    return 0;
  }

  private resolveOperand(mode: AddressingMode): ResolvedOperand {
    switch (mode) {
      case 'IMP':
      case 'ACC':
        return { pageCrossed: false };
      case 'IMM':
        return { value: this.fetchByte(), pageCrossed: false };
      case 'ZP':
        return { address: this.fetchByte(), pageCrossed: false };
      case 'ZPX':
        return { address: (this.fetchByte() + this.x) & 0xff, pageCrossed: false };
      case 'ZPY':
        return { address: (this.fetchByte() + this.y) & 0xff, pageCrossed: false };
      case 'ABS':
        return { address: this.fetchWord(), pageCrossed: false };
      case 'ABSX': {
        const base = this.fetchWord();
        const address = (base + this.x) & 0xffff;
        return { address, pageCrossed: page(base) !== page(address) };
      }
      case 'ABSY': {
        const base = this.fetchWord();
        const address = (base + this.y) & 0xffff;
        return { address, pageCrossed: page(base) !== page(address) };
      }
      case 'IND': {
        const pointer = this.fetchWord();
        const lo = this.bus.read(pointer);
        // NMOS 6502 JMP ($xxFF) hardware bug: the high byte wraps inside the same page.
        const highAddress = (pointer & 0xff00) | ((pointer + 1) & 0x00ff);
        const hi = this.bus.read(highAddress);
        return { address: word(lo, hi), pageCrossed: false };
      }
      case 'INDX': {
        const pointer = (this.fetchByte() + this.x) & 0xff;
        const lo = this.bus.read(pointer);
        const hi = this.bus.read((pointer + 1) & 0xff);
        return { address: word(lo, hi), pageCrossed: false };
      }
      case 'INDY': {
        const pointer = this.fetchByte();
        const lo = this.bus.read(pointer);
        const hi = this.bus.read((pointer + 1) & 0xff);
        const base = word(lo, hi);
        const address = (base + this.y) & 0xffff;
        return { address, pageCrossed: page(base) !== page(address) };
      }
      case 'REL': {
        const byte = this.fetchByte();
        const relativeOffset = byte < 0x80 ? byte : byte - 0x100;
        return { relativeOffset, pageCrossed: false };
      }
      default:
        return assertNever(mode);
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

    // NMOS 6502 decimal ADC has deliberately odd flag behavior. Z comes from
    // the unadjusted binary sum, while N and V come from the intermediate
    // high-nibble addition after the low-nibble decimal carry has propagated.
    // C comes from the final decimal high-nibble correction.
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

    // As on NMOS silicon, N/Z/V are derived before decimal correction.
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

  private shiftOrRotate(operand: ResolvedOperand, operation: 'ASL' | 'LSR' | 'ROL' | 'ROR'): void {
    const transform = (value: number): number => {
      const carryIn = this.getFlag(Flag.Carry) ? 1 : 0;
      let result: number;

      switch (operation) {
        case 'ASL':
          this.setFlag(Flag.Carry, (value & 0x80) !== 0);
          result = (value << 1) & 0xff;
          break;
        case 'LSR':
          this.setFlag(Flag.Carry, (value & 0x01) !== 0);
          result = value >> 1;
          break;
        case 'ROL':
          this.setFlag(Flag.Carry, (value & 0x80) !== 0);
          result = ((value << 1) | carryIn) & 0xff;
          break;
        case 'ROR':
          this.setFlag(Flag.Carry, (value & 0x01) !== 0);
          result = ((carryIn << 7) | (value >> 1)) & 0xff;
          break;
        default:
          return assertNever(operation);
      }

      return this.setNZ(result);
    };

    if (operand.address === undefined) {
      this.a = transform(this.a);
    } else {
      this.rmw(operand, transform);
    }
  }

  private rmw(operand: ResolvedOperand, transform: (value: number) => number): void {
    const address = this.requireAddress(operand);
    const oldValue = this.bus.read(address);

    // NMOS 6502 memory RMW instructions perform a dummy write of the old value
    // before writing the transformed value. This becomes observable on C64 I/O.
    this.bus.write(address, oldValue);
    this.bus.write(address, transform(oldValue));
  }

  private branch(condition: boolean, operand: ResolvedOperand): number {
    if (!condition) {
      return 0;
    }

    const offset = operand.relativeOffset;
    if (offset === undefined) {
      throw new Error('Branch instruction missing relative offset.');
    }

    const oldPc = this.pc;
    this.pc = (this.pc + offset) & 0xffff;
    return page(oldPc) === page(this.pc) ? 1 : 2;
  }

  private brk(): void {
    // Opcode fetch already advanced PC by one; BRK behaves as a two-byte instruction.
    this.pc = (this.pc + 1) & 0xffff;
    this.push((this.pc >> 8) & 0xff);
    this.push(this.pc & 0xff);
    this.push(this.status | Flag.Break | Flag.Unused);
    this.setFlag(Flag.InterruptDisable, true);
    this.pc = this.readWord(0xfffe);
  }

  private jsr(address: number): void {
    const returnAddress = (this.pc - 1) & 0xffff;
    this.push((returnAddress >> 8) & 0xff);
    this.push(returnAddress & 0xff);
    this.pc = address;
  }

  private rts(): void {
    const lo = this.pop();
    const hi = this.pop();
    this.pc = (word(lo, hi) + 1) & 0xffff;
  }

  private rti(): void {
    this.loadStatus(this.pop());
    const lo = this.pop();
    const hi = this.pop();
    this.pc = word(lo, hi);
  }

  private serviceHardwareInterrupt(vectorAddress: number): number {
    this.push((this.pc >> 8) & 0xff);
    this.push(this.pc & 0xff);
    this.push((this.status & ~Flag.Break) | Flag.Unused);
    this.setFlag(Flag.InterruptDisable, true);
    this.pc = this.readWord(vectorAddress);
    this.cycles += 7;
    return 7;
  }

  private push(value: number): void {
    this.bus.write(0x0100 | this.sp, value);
    this.sp = (this.sp - 1) & 0xff;
  }

  private pop(): number {
    this.sp = (this.sp + 1) & 0xff;
    return this.bus.read(0x0100 | this.sp);
  }

  private loadStatus(value: number): void {
    this.status = ((value & ~Flag.Break) | Flag.Unused) & 0xff;
  }

  private readOperand(operand: ResolvedOperand): number {
    if (operand.value !== undefined) {
      return operand.value;
    }

    return this.bus.read(this.requireAddress(operand));
  }

  private requireAddress(operand: ResolvedOperand): number {
    if (operand.address === undefined) {
      throw new Error('Instruction requires a resolved memory address.');
    }

    return operand.address;
  }

  private fetchByte(): number {
    const value = this.bus.read(this.pc);
    this.pc = (this.pc + 1) & 0xffff;
    return value;
  }

  private fetchWord(): number {
    const lo = this.fetchByte();
    const hi = this.fetchByte();
    return word(lo, hi);
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
