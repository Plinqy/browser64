import { describe, expect, it } from 'vitest';
import { IMPLEMENTED_OPCODE_COUNT, OFFICIAL_OPCODE_COUNT, OPCODES, UNSTABLE_OPCODE_COUNT } from '../../src/core/cpu/opcodes';

describe('NMOS 6502/6510 opcode table', () => {
  it('contains all 151 documented NMOS 6502 opcodes', () => {
    expect(OFFICIAL_OPCODE_COUNT).toBe(151);
  });

  it('classifies every byte while separating unstable silicon-dependent opcodes', () => {
    const entries = OPCODES.filter((entry) => entry !== undefined);
    expect(entries).toHaveLength(256);
    expect(new Set(entries.map((entry) => entry.opcode)).size).toBe(256);
    expect(IMPLEMENTED_OPCODE_COUNT).toBe(249);
    expect(UNSTABLE_OPCODE_COUNT).toBe(7);
    expect(entries.every((entry) => entry.opcode >= 0 && entry.opcode <= 0xff)).toBe(true);
  });

  it('has internally consistent instruction lengths and cycle counts', () => {
    for (const entry of OPCODES) {
      if (entry === undefined) continue;
      expect(entry.bytes).toBeGreaterThanOrEqual(1);
      expect(entry.bytes).toBeLessThanOrEqual(3);
      expect(entry.cycles).toBeGreaterThanOrEqual(2);
      expect(entry.cycles).toBeLessThanOrEqual(8);
    }
  });
});
