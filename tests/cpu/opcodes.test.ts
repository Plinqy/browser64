import { describe, expect, it } from 'vitest';
import { OFFICIAL_OPCODE_COUNT, OPCODES } from '../../src/core/cpu/opcodes';

describe('official opcode table', () => {
  it('contains all 151 documented NMOS 6502 opcodes', () => {
    expect(OFFICIAL_OPCODE_COUNT).toBe(151);
  });

  it('does not accidentally define an opcode twice or outside byte range', () => {
    const entries = OPCODES.filter((entry) => entry !== undefined);
    expect(new Set(entries.map((entry) => entry.opcode)).size).toBe(151);
    expect(entries.every((entry) => entry.opcode >= 0 && entry.opcode <= 0xff)).toBe(true);
  });

  it('has internally consistent instruction lengths and cycle counts', () => {
    for (const entry of OPCODES) {
      if (entry === undefined) continue;
      expect(entry.bytes).toBeGreaterThanOrEqual(1);
      expect(entry.bytes).toBeLessThanOrEqual(3);
      expect(entry.cycles).toBeGreaterThanOrEqual(2);
      expect(entry.cycles).toBeLessThanOrEqual(7);
    }
  });
});
