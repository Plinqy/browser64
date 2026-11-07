import { describe, expect, it } from 'vitest';
import { RamBus } from '../../src/core/memory/RamBus';

describe('RamBus', () => {
  it('provides a full 64 KiB byte-addressable memory', () => {
    const bus = new RamBus();
    bus.write(0x0000, 0x12);
    bus.write(0xffff, 0x34);

    expect(bus.read(0x0000)).toBe(0x12);
    expect(bus.read(0xffff)).toBe(0x34);
  });

  it('masks addresses and values to hardware width', () => {
    const bus = new RamBus();
    bus.write(0x10001, 0x1ab);
    expect(bus.read(0x0001)).toBe(0xab);
  });

  it('loads programs and vectors', () => {
    const bus = new RamBus();
    bus.load([0xa9, 0x42, 0xea], 0x8000);
    bus.setVector(0xfffc, 0x8000);

    expect(Array.from(bus.memory.slice(0x8000, 0x8003))).toEqual([0xa9, 0x42, 0xea]);
    expect(bus.read(0xfffc)).toBe(0x00);
    expect(bus.read(0xfffd)).toBe(0x80);
  });

  it('rejects program images that would overrun the address space', () => {
    const bus = new RamBus();
    expect(() => bus.load([1, 2], 0xffff)).toThrow(RangeError);
  });
});
