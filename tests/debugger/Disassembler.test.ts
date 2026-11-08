import { describe, expect, it } from 'vitest';
import { Cpu6510 } from '../../src/core/cpu/Cpu6510';
import { Disassembler } from '../../src/core/debugger/Disassembler';
import { TraceFormatter } from '../../src/core/debugger/TraceFormatter';
import { RamBus } from '../../src/core/memory/RamBus';

describe('Disassembler', () => {
  it('formats immediate, indexed, indirect, and relative operands', () => {
    const bus = new RamBus();
    bus.load([
      0xa9, 0x42,
      0xbd, 0x34, 0x12,
      0xb1, 0x80,
      0xd0, 0xf7
    ], 0x8000);
    const disassembler = new Disassembler(bus);

    expect(disassembler.disassemble(0x8000).text).toBe('LDA #$42');
    expect(disassembler.disassemble(0x8002).text).toBe('LDA $1234,X');
    expect(disassembler.disassemble(0x8005).text).toBe('LDA ($80),Y');
    expect(disassembler.disassemble(0x8007).text).toBe('BNE $8000');
  });

  it('renders decoded undocumented opcodes, including JAM, without throwing', () => {
    const bus = new RamBus();
    bus.load([0x02, 0x8b, 0x44], 0x8000);
    const disassembler = new Disassembler(bus);

    expect(disassembler.disassemble(0x8000).text).toBe('JAM');
    expect(disassembler.disassemble(0x8001).text).toBe('XAA #$44');
  });
});

describe('TraceFormatter', () => {
  it('formats the pre-instruction CPU state in one line', () => {
    const bus = new RamBus();
    bus.load([0xa9, 0x42], 0x8000);
    bus.setVector(0xfffc, 0x8000);
    const cpu = new Cpu6510(bus);
    cpu.reset();

    const line = new TraceFormatter(cpu).formatCurrent();
    expect(line).toContain('8000  A9 42');
    expect(line).toContain('LDA #$42');
    expect(line).toContain('A:00');
    expect(line).toContain('CYC:7');
  });
});
