import type { MemoryMappedDevice } from './Device';

/**
 * The C64 has 1 KiB of dedicated 4-bit color RAM at $D800-$DBFF.
 *
 * Real hardware only drives the low nibble on reads. v0.9 supplies the upper
 * nibble from the CPU data-bus latch, while standalone instances retain the
 * previous deterministic $F fallback.
 */
export class ColorRam implements MemoryMappedDevice {
  public readonly memory = new Uint8Array(0x400);

  constructor(private readonly busValue: () => number = () => 0xff) {}

  read(offset: number): number {
    return (this.busValue() & 0xf0) | (this.memory[offset & 0x03ff] ?? 0);
  }

  peek(offset: number): number {
    return this.read(offset);
  }

  write(offset: number, value: number): void {
    this.memory[offset & 0x03ff] = value & 0x0f;
  }

  // Color RAM is memory, not a resettable chip register file. A machine reset
  // therefore preserves it; deterministic power-on clearing is explicit.
  reset(): void {}

  clear(value = 0): void {
    this.memory.fill(value & 0x0f);
  }
}
