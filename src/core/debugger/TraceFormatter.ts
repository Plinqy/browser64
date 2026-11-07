import type { Cpu6510 } from '../cpu/Cpu6510';
import { Disassembler } from './Disassembler';

export class TraceFormatter {
  private readonly disassembler: Disassembler;

  constructor(private readonly cpu: Cpu6510) {
    this.disassembler = new Disassembler(cpu.bus);
  }

  formatCurrent(): string {
    const instruction = this.disassembler.disassemble(this.cpu.pc);
    const byteText = instruction.bytes.map((byte) => hex(byte, 2)).join(' ').padEnd(8, ' ');
    const asm = instruction.text.padEnd(18, ' ');
    const flags = formatFlags(this.cpu.status);

    return `${hex(this.cpu.pc, 4)}  ${byteText} ${asm} A:${hex(this.cpu.a, 2)} X:${hex(this.cpu.x, 2)} Y:${hex(this.cpu.y, 2)} SP:${hex(this.cpu.sp, 2)} P:${flags} CYC:${this.cpu.cycles}`;
  }
}

export function formatFlags(status: number): string {
  const labels = ['N', 'V', '-', 'B', 'D', 'I', 'Z', 'C'];
  return labels
    .map((label, index) => ((status & (0x80 >> index)) !== 0 ? label : '.'))
    .join('');
}

function hex(value: number, width: number): string {
  return (value >>> 0).toString(16).toUpperCase().padStart(width, '0');
}
