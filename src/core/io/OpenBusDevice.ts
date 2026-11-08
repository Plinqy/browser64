import type { MemoryMappedDevice } from './Device';

/**
 * Placeholder for an unmapped expansion I/O area.
 *
 * $DE00-$DFFF is cartridge/expansion space. With no cartridge decoding the
 * region leaves the CPU data bus undriven, so reads observe the machine's
 * current data-bus latch. Standalone use falls back to $FF.
 */
export class OpenBusDevice implements MemoryMappedDevice {
  constructor(private readonly busValue: () => number = () => 0xff) {}

  read(_offset: number): number {
    return this.busValue() & 0xff;
  }

  peek(_offset: number): number {
    return this.busValue() & 0xff;
  }

  write(_offset: number, _value: number): void {}

  reset(): void {}
}
