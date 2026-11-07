import type { MemoryMappedDevice } from './Device';

/**
 * Temporary read/write register storage used until the real VIC-II, SID, and
 * CIA implementations replace it. The address mask also models the register
 * mirroring caused by partial address decoding in those chips.
 */
export class RegisterFileDevice implements MemoryMappedDevice {
  public readonly registers: Uint8Array;

  constructor(
    size: number,
    private readonly addressMask: number
  ) {
    if (size <= 0 || (size & (size - 1)) !== 0) {
      throw new RangeError('Register file size must be a positive power of two.');
    }

    this.registers = new Uint8Array(size);
  }

  read(offset: number): number {
    return this.registers[offset & this.addressMask] ?? 0;
  }

  peek(offset: number): number {
    return this.read(offset);
  }

  write(offset: number, value: number): void {
    this.registers[offset & this.addressMask] = value & 0xff;
  }

  reset(): void {
    this.registers.fill(0);
  }
}
