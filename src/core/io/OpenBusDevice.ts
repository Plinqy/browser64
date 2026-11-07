import type { MemoryMappedDevice } from './Device';

/**
 * Placeholder for an unmapped expansion I/O area.
 *
 * $DE00-$DFFF is cartridge/expansion space. A real C64 can expose open-bus or
 * cartridge-specific values here. Until those systems exist, reads return $FF
 * and writes are ignored rather than inventing persistent registers.
 */
export class OpenBusDevice implements MemoryMappedDevice {
  read(_offset: number): number {
    return 0xff;
  }

  peek(_offset: number): number {
    return 0xff;
  }

  write(_offset: number, _value: number): void {}

  reset(): void {}
}
