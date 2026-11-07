import type { Bus } from '../memory/Bus';
import { getOpcodeInfo } from '../cpu/opcodes';
import type { AddressingMode } from '../cpu/types';

export interface DisassembledInstruction {
  address: number;
  bytes: number[];
  text: string;
  nextAddress: number;
}

export class Disassembler {
  constructor(private readonly bus: Bus) {}

  disassemble(address: number): DisassembledInstruction {
    const pc = address & 0xffff;
    const opcode = this.bus.peek(pc);
    const info = getOpcodeInfo(opcode);

    if (info === undefined) {
      return {
        address: pc,
        bytes: [opcode],
        text: `.byte $${hex(opcode, 2)}`,
        nextAddress: (pc + 1) & 0xffff
      };
    }

    const bytes: number[] = [];
    for (let i = 0; i < info.bytes; i += 1) {
      bytes.push(this.bus.peek((pc + i) & 0xffff));
    }

    return {
      address: pc,
      bytes,
      text: `${info.mnemonic}${formatOperand(info.mode, bytes, pc)}`,
      nextAddress: (pc + info.bytes) & 0xffff
    };
  }

  disassembleRange(address: number, instructionCount: number): DisassembledInstruction[] {
    const result: DisassembledInstruction[] = [];
    let current = address & 0xffff;

    for (let i = 0; i < instructionCount; i += 1) {
      const instruction = this.disassemble(current);
      result.push(instruction);
      current = instruction.nextAddress;
    }

    return result;
  }
}

function formatOperand(mode: AddressingMode, bytes: number[], address: number): string {
  const b1 = bytes[1] ?? 0;
  const b2 = bytes[2] ?? 0;
  const absolute = (b2 << 8) | b1;

  switch (mode) {
    case 'IMP': return '';
    case 'ACC': return ' A';
    case 'IMM': return ` #$${hex(b1, 2)}`;
    case 'ZP': return ` $${hex(b1, 2)}`;
    case 'ZPX': return ` $${hex(b1, 2)},X`;
    case 'ZPY': return ` $${hex(b1, 2)},Y`;
    case 'ABS': return ` $${hex(absolute, 4)}`;
    case 'ABSX': return ` $${hex(absolute, 4)},X`;
    case 'ABSY': return ` $${hex(absolute, 4)},Y`;
    case 'IND': return ` ($${hex(absolute, 4)})`;
    case 'INDX': return ` ($${hex(b1, 2)},X)`;
    case 'INDY': return ` ($${hex(b1, 2)}),Y`;
    case 'REL': {
      const offset = b1 < 0x80 ? b1 : b1 - 0x100;
      const destination = (address + 2 + offset) & 0xffff;
      return ` $${hex(destination, 4)}`;
    }
    default: return assertNever(mode);
  }
}

function hex(value: number, width: number): string {
  return (value >>> 0).toString(16).toUpperCase().padStart(width, '0');
}

function assertNever(value: never): never {
  throw new Error(`Unhandled addressing mode: ${String(value)}`);
}
