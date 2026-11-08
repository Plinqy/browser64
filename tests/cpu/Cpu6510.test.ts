import { describe, expect, it } from 'vitest';
import { Cpu6510, CpuJammedError } from '../../src/core/cpu/Cpu6510';
import { Flag } from '../../src/core/cpu/Flags';
import { OPCODES } from '../../src/core/cpu/opcodes';
import type { Bus } from '../../src/core/memory/Bus';
import { RamBus } from '../../src/core/memory/RamBus';

function machine(program: number[], start = 0x8000): { cpu: Cpu6510; bus: RamBus } {
  const bus = new RamBus();
  bus.load(program, start);
  bus.setVector(0xfffc, start);
  bus.setVector(0xfffe, 0x9000);
  bus.setVector(0xfffa, 0xa000);
  const cpu = new Cpu6510(bus);
  cpu.reset();
  return { cpu, bus };
}

describe('Cpu6510 reset and basic execution', () => {
  it('loads the reset vector and starts with the interrupt flag set', () => {
    const { cpu } = machine([0xea]);
    expect(cpu.pc).toBe(0x8000);
    expect(cpu.sp).toBe(0xfd);
    expect(cpu.getFlag(Flag.InterruptDisable)).toBe(true);
    expect(cpu.cycles).toBe(7);
  });

  it('executes load, transfer, increment, and store instructions', () => {
    const { cpu, bus } = machine([
      0xa9, 0x7f,       // LDA #$7F
      0xaa,             // TAX
      0xe8,             // INX -> $80
      0x8e, 0x00, 0x20  // STX $2000
    ]);

    cpu.run(4);

    expect(cpu.a).toBe(0x7f);
    expect(cpu.x).toBe(0x80);
    expect(bus.read(0x2000)).toBe(0x80);
    expect(cpu.getFlag(Flag.Negative)).toBe(true);
    expect(cpu.getFlag(Flag.Zero)).toBe(false);
  });

  it('enters the NMOS JAM state and requires RESET to recover', () => {
    const { cpu } = machine([0x02]);
    expect(cpu.step()).toBe(2);
    expect(cpu.jammed).toBe(true);
    expect(() => cpu.step()).toThrow(CpuJammedError);
    cpu.reset();
    expect(cpu.jammed).toBe(false);
  });
});

describe('addressing and documented timing', () => {
  it('adds a cycle to eligible absolute indexed reads on page crossing', () => {
    const { cpu, bus } = machine([0xbd, 0xff, 0x20]); // LDA $20FF,X
    cpu.x = 1;
    bus.write(0x2100, 0x55);

    expect(cpu.step()).toBe(5);
    expect(cpu.a).toBe(0x55);
  });

  it('does not add a page-cross cycle to STA absolute,X', () => {
    const { cpu, bus } = machine([0x9d, 0xff, 0x20]); // STA $20FF,X
    cpu.x = 1;
    cpu.a = 0x44;

    expect(cpu.step()).toBe(5);
    expect(bus.read(0x2100)).toBe(0x44);
  });

  it('wraps zero-page indexed addressing', () => {
    const { cpu, bus } = machine([0xb5, 0xff]); // LDA $FF,X
    cpu.x = 2;
    bus.write(0x0001, 0x66);

    cpu.step();
    expect(cpu.a).toBe(0x66);
  });

  it('wraps zero-page pointer high-byte reads for indirect-indexed mode', () => {
    const { cpu, bus } = machine([0xb1, 0xff]); // LDA ($FF),Y
    cpu.y = 1;
    bus.write(0x00ff, 0xfe);
    bus.write(0x0000, 0x20);
    bus.write(0x20ff, 0x77);

    cpu.step();
    expect(cpu.a).toBe(0x77);
  });

  it('reproduces the NMOS JMP indirect page-wrap hardware bug', () => {
    const { cpu, bus } = machine([0x6c, 0xff, 0x30]); // JMP ($30FF)
    bus.write(0x30ff, 0x34);
    bus.write(0x3000, 0x12);
    bus.write(0x3100, 0x99);

    cpu.step();
    expect(cpu.pc).toBe(0x1234);
  });

  it('charges one extra cycle for a taken branch and another for page crossing', () => {
    const samePage = machine([0xd0, 0x02], 0x8000); // BNE +2; Z starts clear
    expect(samePage.cpu.step()).toBe(3);
    expect(samePage.cpu.pc).toBe(0x8004);

    const crossing = machine([0xd0, 0x7f], 0x80fd); // PC after operand=$80FF, target=$817E
    expect(crossing.cpu.step()).toBe(4);
    expect(crossing.cpu.pc).toBe(0x817e);
  });

  it('uses base timing for a branch that is not taken', () => {
    const { cpu } = machine([0xf0, 0x7f]); // BEQ
    cpu.setFlag(Flag.Zero, false);
    expect(cpu.step()).toBe(2);
    expect(cpu.pc).toBe(0x8002);
  });
});

describe('ALU and flags', () => {
  it('sets carry and zero on binary ADC overflow past $FF', () => {
    const { cpu } = machine([0x69, 0x01]);
    cpu.a = 0xff;
    cpu.setFlag(Flag.Carry, false);

    cpu.step();
    expect(cpu.a).toBe(0x00);
    expect(cpu.getFlag(Flag.Carry)).toBe(true);
    expect(cpu.getFlag(Flag.Zero)).toBe(true);
  });

  it('sets signed overflow on binary ADC', () => {
    const { cpu } = machine([0x69, 0x50]);
    cpu.a = 0x50;

    cpu.step();
    expect(cpu.a).toBe(0xa0);
    expect(cpu.getFlag(Flag.Overflow)).toBe(true);
    expect(cpu.getFlag(Flag.Negative)).toBe(true);
  });

  it('implements SBC carry as NOT borrow', () => {
    const { cpu } = machine([0xe9, 0x01, 0xe9, 0x01]);
    cpu.a = 0x01;
    cpu.setFlag(Flag.Carry, true);

    cpu.step();
    expect(cpu.a).toBe(0x00);
    expect(cpu.getFlag(Flag.Carry)).toBe(true);

    cpu.step();
    expect(cpu.a).toBe(0xff);
    expect(cpu.getFlag(Flag.Carry)).toBe(false);
  });

  it('implements BCD ADC', () => {
    const { cpu } = machine([0xf8, 0x69, 0x55]); // SED; ADC #$55
    cpu.a = 0x45;
    cpu.setFlag(Flag.Carry, false);

    cpu.step();
    cpu.step();

    expect(cpu.a).toBe(0x00);
    expect(cpu.getFlag(Flag.Carry)).toBe(true);
  });

  it('reproduces NMOS decimal ADC N/V flag behavior rather than CMOS behavior', () => {
    const { cpu } = machine([0xf8, 0x38, 0x69, 0x79]); // SED; SEC; ADC #$79
    cpu.a = 0x00;

    cpu.run(3);

    expect(cpu.a).toBe(0x80);
    expect(cpu.getFlag(Flag.Negative)).toBe(true);
    expect(cpu.getFlag(Flag.Overflow)).toBe(true);
    expect(cpu.getFlag(Flag.Zero)).toBe(false);
  });

  it('uses the unadjusted binary result for NMOS decimal ADC Z', () => {
    const { cpu } = machine([0xf8, 0x38, 0x69, 0xff]); // SED; SEC; ADC #$FF
    cpu.a = 0x00;

    cpu.run(3);

    expect(cpu.a).toBe(0x66);
    expect(cpu.getFlag(Flag.Zero)).toBe(true);
  });

  it('implements BCD SBC', () => {
    const { cpu } = machine([0xf8, 0x38, 0xe9, 0x01]); // SED; SEC; SBC #$01
    cpu.a = 0x00;

    cpu.run(3);

    expect(cpu.a).toBe(0x99);
    expect(cpu.getFlag(Flag.Carry)).toBe(false);
  });

  it('BIT sources N and V from memory and Z from A&M', () => {
    const { cpu, bus } = machine([0x24, 0x10]);
    cpu.a = 0x0f;
    bus.write(0x0010, 0xc0);

    cpu.step();
    expect(cpu.getFlag(Flag.Zero)).toBe(true);
    expect(cpu.getFlag(Flag.Negative)).toBe(true);
    expect(cpu.getFlag(Flag.Overflow)).toBe(true);
  });
});

describe('stack, subroutines, and interrupts', () => {
  it('implements JSR/RTS with the 6502 return-address convention', () => {
    const { cpu, bus } = machine([0x20, 0x00, 0x90, 0xa9, 0x42]);
    bus.load([0xa9, 0x11, 0x60], 0x9000);

    cpu.step(); // JSR
    expect(cpu.pc).toBe(0x9000);
    expect(cpu.sp).toBe(0xfb);

    cpu.step(); // LDA #$11
    cpu.step(); // RTS
    expect(cpu.pc).toBe(0x8003);

    cpu.step();
    expect(cpu.a).toBe(0x42);
  });

  it('BRK pushes PC+2 and a status image with B set', () => {
    const { cpu, bus } = machine([0x00, 0xea]);
    cpu.setFlag(Flag.Carry, true);

    expect(cpu.step()).toBe(7);
    expect(cpu.pc).toBe(0x9000);
    expect(cpu.sp).toBe(0xfa);
    expect(bus.read(0x01fd)).toBe(0x80);
    expect(bus.read(0x01fc)).toBe(0x02);
    expect(bus.read(0x01fb) & Flag.Break).toBe(Flag.Break);
  });

  it('samples IRQ before CLI changes I, delaying recognition one instruction', () => {
    const { cpu } = machine([0x58, 0xea, 0xea]); // CLI; NOP; NOP
    cpu.setIrqLine(true);

    expect(cpu.step()).toBe(2); // CLI: penultimate sample still sees I=1.
    expect(cpu.pc).toBe(0x8001);
    expect(cpu.step()).toBe(2); // One NOP executes before the pending level is recognized.
    expect(cpu.pc).toBe(0x8002);
    expect(cpu.step()).toBe(7);
    expect(cpu.pc).toBe(0x9000);
  });

  it('samples IRQ before SEI changes I, so an already-sampled IRQ still enters', () => {
    const { cpu } = machine([0x58, 0xea, 0x78, 0xea]); // CLI; NOP; SEI; NOP

    cpu.step(); // CLI
    cpu.step(); // NOP; establishes a clean no-IRQ boundary sample.
    cpu.setIrqLine(true);

    expect(cpu.step()).toBe(2); // SEI executes, but IRQ was sampled while I was still clear.
    expect(cpu.getFlag(Flag.InterruptDisable)).toBe(true);
    expect(cpu.step()).toBe(7);
    expect(cpu.pc).toBe(0x9000);
  });

  it('services NMI regardless of the I flag and RTI restores PC', () => {
    const { cpu, bus } = machine([0xea]);
    bus.write(0xa000, 0x40); // RTI
    cpu.pulseNmi();

    expect(cpu.step()).toBe(7);
    expect(cpu.pc).toBe(0xa000);
    expect(cpu.step()).toBe(6);
    expect(cpu.pc).toBe(0x8000);
  });
});

describe('NMOS read-modify-write bus behavior', () => {
  class RecordingBus implements Bus {
    readonly memory = new Uint8Array(0x10000);
    readonly writes: Array<{ address: number; value: number }> = [];

    read(address: number): number { return this.memory[address & 0xffff] ?? 0; }
    peek(address: number): number { return this.memory[address & 0xffff] ?? 0; }
    write(address: number, value: number): void {
      const normalizedAddress = address & 0xffff;
      const normalizedValue = value & 0xff;
      this.writes.push({ address: normalizedAddress, value: normalizedValue });
      this.memory[normalizedAddress] = normalizedValue;
    }
  }

  it('writes the old value before the transformed value', () => {
    const bus = new RecordingBus();
    bus.memory.set([0x06, 0x10], 0x8000); // ASL $10
    bus.memory[0x0010] = 0x81;
    bus.memory[0xfffc] = 0x00;
    bus.memory[0xfffd] = 0x80;
    const cpu = new Cpu6510(bus);
    cpu.reset();
    bus.writes.length = 0;

    cpu.step();

    expect(bus.writes).toEqual([
      { address: 0x0010, value: 0x81 },
      { address: 0x0010, value: 0x02 }
    ]);
    expect(cpu.getFlag(Flag.Carry)).toBe(true);
  });
});

describe('official opcode execution smoke test', () => {
  it('can decode and execute every documented opcode without hitting an unimplemented mnemonic', () => {
    for (const info of OPCODES) {
      if (info === undefined || info.stability !== 'official') continue;

      const bus = new RamBus();
      const start = 0x8000;
      bus.write(start, info.opcode);
      bus.write(start + 1, 0x00);
      bus.write(start + 2, 0x20);
      bus.setVector(0xfffc, start);
      bus.setVector(0xfffe, 0x9000);
      bus.setVector(0xfffa, 0x9000);
      bus.write(0x9000, 0xea);
      const cpu = new Cpu6510(bus);
      cpu.reset();

      expect(() => cpu.step(), `opcode $${info.opcode.toString(16).padStart(2, '0')} ${info.mnemonic}`).not.toThrow();
    }
  });
});

describe('cycle-steppable execution and RDY/AEC behavior', () => {
  it('advances an instruction one bus cycle at a time', () => {
    const { cpu } = machine([0xa9, 0x42]); // LDA #$42

    const opcodeFetch = cpu.clock();
    expect(opcodeFetch.advanced).toBe(true);
    expect(opcodeFetch.kind).toBe('read');
    expect(opcodeFetch.instructionCompleted).toBe(false);
    expect(cpu.pc).toBe(0x8001);
    expect(cpu.a).toBe(0x00);

    const operandRead = cpu.clock();
    expect(operandRead.instructionCompleted).toBe(true);
    expect(cpu.pc).toBe(0x8002);
    expect(cpu.a).toBe(0x42);
  });

  it('holds a read micro-cycle while RDY is low without consuming a CPU cycle', () => {
    const { cpu } = machine([0xa9, 0x42]);
    cpu.clock(); // opcode fetch
    const beforeCycles = cpu.cycles;
    const beforePc = cpu.pc;

    const held = cpu.clock(false, true);

    expect(held.stalled).toBe(true);
    expect(held.advanced).toBe(false);
    expect(held.kind).toBe('read');
    expect(cpu.cycles).toBe(beforeCycles);
    expect(cpu.pc).toBe(beforePc);
    expect(cpu.a).toBe(0x00);

    expect(cpu.clock(true, true).instructionCompleted).toBe(true);
    expect(cpu.a).toBe(0x42);
  });

  it('allows a write cycle to finish while BA/RDY is low', () => {
    const { cpu, bus } = machine([0x8d, 0x00, 0x20]); // STA $2000
    cpu.a = 0x5a;

    cpu.clock(); // opcode
    cpu.clock(); // low address
    cpu.clock(); // high address
    expect(cpu.nextCycleKind).toBe('write');

    const write = cpu.clock(false, true);
    expect(write.stalled).toBe(false);
    expect(write.instructionCompleted).toBe(true);
    expect(bus.read(0x2000)).toBe(0x5a);
  });

  it('does not advance even a pending write after AEC gives the bus to VIC-II', () => {
    const { cpu, bus } = machine([0x8d, 0x00, 0x20]); // STA $2000
    cpu.a = 0x5a;

    cpu.clock();
    cpu.clock();
    cpu.clock();

    const held = cpu.clock(false, false);
    expect(held.stalled).toBe(true);
    expect(bus.read(0x2000)).toBe(0x00);

    cpu.clock(true, true);
    expect(bus.read(0x2000)).toBe(0x5a);
  });
});
