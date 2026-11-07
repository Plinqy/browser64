/**
 * The CPU communicates with the machine exclusively through this interface.
 *
 * read() is allowed to have hardware side effects in future C64 buses. peek()
 * must be observational only and exists for debuggers/disassemblers.
 */
export interface Bus {
  read(address: number): number;
  write(address: number, value: number): void;
  peek(address: number): number;
}

export function word(lo: number, hi: number): number {
  return ((hi & 0xff) << 8) | (lo & 0xff);
}
