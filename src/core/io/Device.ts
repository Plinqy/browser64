/**
 * Minimal contract for a CPU-visible memory-mapped device.
 *
 * read() may have emulated hardware side effects. peek() must not. The address
 * passed to a device is relative to the device's mapped region, not the CPU's
 * full 16-bit address.
 */
export interface MemoryMappedDevice {
  read(offset: number): number;
  peek(offset: number): number;
  write(offset: number, value: number): void;
  reset(): void;
}
