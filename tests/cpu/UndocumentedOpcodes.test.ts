import { describe, expect, it } from 'vitest';
import { Cpu6510, UnstableOpcodeError } from '../../src/core/cpu/Cpu6510';
import { Flag } from '../../src/core/cpu/Flags';
import { RamBus } from '../../src/core/memory/RamBus';

function cpuWith(program: number[]): { cpu: Cpu6510; bus: RamBus } {
  const bus = new RamBus();
  bus.load(program, 0x8000);
  bus.setVector(0xfffc, 0x8000);
  bus.setVector(0xfffe, 0x9000);
  bus.setVector(0xfffa, 0xa000);
  const cpu = new Cpu6510(bus);
  cpu.reset();
  return { cpu, bus };
}

describe('stable NMOS undocumented read-modify-write opcodes', () => {
  it('implements SLO, RLA, SRE, RRA, DCP, and ISC with NMOS RMW timing', () => {
    const cases = [
      { opcode: 0x07, a: 0x01, memory: 0x80, carry: false, result: 0x00, accumulator: 0x01, cycles: 5 },
      { opcode: 0x27, a: 0xf0, memory: 0x81, carry: false, result: 0x02, accumulator: 0x00, cycles: 5 },
      { opcode: 0x47, a: 0xf0, memory: 0x03, carry: false, result: 0x01, accumulator: 0xf1, cycles: 5 },
      { opcode: 0x67, a: 0x10, memory: 0x02, carry: false, result: 0x01, accumulator: 0x11, cycles: 5 },
      { opcode: 0xc7, a: 0x10, memory: 0x11, carry: false, result: 0x10, accumulator: 0x10, cycles: 5 },
      { opcode: 0xe7, a: 0x20, memory: 0x0f, carry: true, result: 0x10, accumulator: 0x10, cycles: 5 }
    ] as const;

    for (const entry of cases) {
      const { cpu, bus } = cpuWith([entry.opcode, 0x40]);
      cpu.a = entry.a;
      cpu.setFlag(Flag.Carry, entry.carry);
      bus.write(0x0040, entry.memory);

      expect(cpu.step(), `opcode $${entry.opcode.toString(16)}`).toBe(entry.cycles);
      expect(bus.read(0x0040)).toBe(entry.result);
      expect(cpu.a).toBe(entry.accumulator);
    }
  });

  it('uses the eight-cycle indexed-indirect RMW sequence', () => {
    const { cpu, bus } = cpuWith([0x03, 0x20]); // SLO ($20,X)
    cpu.x = 4;
    cpu.a = 0x01;
    bus.write(0x0024, 0x00);
    bus.write(0x0025, 0x30);
    bus.write(0x3000, 0x80);

    expect(cpu.step()).toBe(8);
    expect(bus.read(0x3000)).toBe(0x00);
    expect(cpu.a).toBe(0x01);
    expect(cpu.getFlag(Flag.Carry)).toBe(true);
  });
});

describe('stable NMOS undocumented load/store and immediate opcodes', () => {
  it('implements LAX and SAX', () => {
    const { cpu, bus } = cpuWith([0xa7, 0x40, 0x87, 0x41]);
    bus.write(0x0040, 0x8a);

    expect(cpu.step()).toBe(3);
    expect(cpu.a).toBe(0x8a);
    expect(cpu.x).toBe(0x8a);
    expect(cpu.getFlag(Flag.Negative)).toBe(true);

    expect(cpu.step()).toBe(3);
    expect(bus.read(0x0041)).toBe(0x8a);
  });

  it('implements ANC, ALR, binary ARR, and AXS flag behavior', () => {
    const { cpu } = cpuWith([
      0x0b, 0x80, // ANC #$80
      0x4b, 0x03, // ALR #$03
      0x6b, 0xff, // ARR #$FF
      0xcb, 0x01  // AXS #$01
    ]);

    cpu.a = 0xf3;
    cpu.step();
    expect(cpu.a).toBe(0x80);
    expect(cpu.getFlag(Flag.Carry)).toBe(true);

    cpu.a = 0x03;
    cpu.step();
    expect(cpu.a).toBe(0x01);
    expect(cpu.getFlag(Flag.Carry)).toBe(true);

    cpu.a = 0xff;
    cpu.setFlag(Flag.Carry, false);
    cpu.step();
    expect(cpu.a).toBe(0x7f);
    expect(cpu.getFlag(Flag.Carry)).toBe(true);
    expect(cpu.getFlag(Flag.Overflow)).toBe(false);

    cpu.a = 0x0f;
    cpu.x = 0x0f;
    cpu.step();
    expect(cpu.x).toBe(0x0e);
    expect(cpu.getFlag(Flag.Carry)).toBe(true);
  });

  it('implements LAS as memory AND stack pointer into A, X, and SP', () => {
    const { cpu, bus } = cpuWith([0xbb, 0x00, 0x30]);
    cpu.sp = 0xfc;
    cpu.y = 1;
    bus.write(0x3001, 0xf3);

    expect(cpu.step()).toBe(4);
    expect(cpu.a).toBe(0xf0);
    expect(cpu.x).toBe(0xf0);
    expect(cpu.sp).toBe(0xf0);
  });

  it('executes undocumented NOP operand reads including page-cross timing', () => {
    const { cpu, bus } = cpuWith([0x1c, 0xff, 0x20]);
    cpu.x = 1;
    bus.write(0x2100, 0x55);

    expect(cpu.step()).toBe(5);
    expect(cpu.pc).toBe(0x8003);
  });

  it('implements $EB as the immediate SBC alias', () => {
    const { cpu } = cpuWith([0xeb, 0x10]);
    cpu.a = 0x40;
    cpu.setFlag(Flag.Carry, true);

    expect(cpu.step()).toBe(2);
    expect(cpu.a).toBe(0x30);
  });
});

describe('unstable NMOS opcodes', () => {
  it('decodes but refuses chip-dependent magic-constant execution', () => {
    for (const opcode of [0x8b, 0xab, 0x93, 0x9f, 0x9b, 0x9c, 0x9e]) {
      const { cpu } = cpuWith([opcode, 0x00, 0x20]);
      expect(() => cpu.step(), `opcode $${opcode.toString(16)}`).toThrow(UnstableOpcodeError);
    }
  });
});
