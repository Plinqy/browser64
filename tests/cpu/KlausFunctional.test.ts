import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Cpu6510 } from '../../src/core/cpu/Cpu6510';
import { Flag } from '../../src/core/cpu/Flags';
import { RamBus } from '../../src/core/memory/RamBus';

const functionalTestUrl = new URL('../assets/6502_functional_test.bin', import.meta.url);
const functionalTestPath = fileURLToPath(functionalTestUrl);
const hasFunctionalTest = existsSync(functionalTestPath);
const externalIt = hasFunctionalTest ? it : it.skip;

describe('Klaus Dormann NMOS 6502 functional test', () => {
  externalIt('reaches the upstream success trap at $3469', () => {
    const image = readFileSync(functionalTestPath);
    expect(image.byteLength).toBe(0x10000);

    const bus = new RamBus();
    bus.load(image, 0x0000);

    const cpu = new Cpu6510(bus);
    cpu.pc = 0x0400;
    cpu.sp = 0xfd;
    cpu.status = Flag.Unused | Flag.InterruptDisable;
    cpu.cycles = 0;

    const instructionLimit = 40_000_000;
    let stoppedAt: number | undefined;

    for (let executed = 0; executed < instructionLimit; executed += 1) {
      const before = cpu.pc;
      cpu.step();

      // Klaus uses a self-loop for every failure trap and for final success.
      if (cpu.pc === before) {
        stoppedAt = cpu.pc;
        break;
      }
    }

    expect(stoppedAt).toBe(0x3469);
    expect(bus.read(0x0200)).toBe(0xf0); // test_case marks opcode testing complete.
  });
});
