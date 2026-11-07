import type { MemoryMappedDevice } from './Device';

/**
 * The C64 has 1 KiB of dedicated 4-bit color RAM at $D800-$DBFF.
 *
 * Real hardware only drives the low nibble on reads; the upper nibble comes
 * from bus/open-bus behavior. Until the machine has an open-bus model, v0.2
 * returns ones in the high nibble so the undefined portion is deterministic.
 */
export class ColorRam implements MemoryMappedDevice {
  public readonly memory = new Uint8Array(0x400);

  read(offset: number): number {
    return 0xf0 | (this.memory[offset & 0x03ff] ?? 0);
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
