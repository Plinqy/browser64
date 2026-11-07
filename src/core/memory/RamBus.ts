import type { Bus } from './Bus';

export class RamBus implements Bus {
  public readonly memory = new Uint8Array(0x10000);

  read(address: number): number {
    return this.memory[address & 0xffff] ?? 0;
  }

  peek(address: number): number {
    return this.memory[address & 0xffff] ?? 0;
  }

  write(address: number, value: number): void {
    this.memory[address & 0xffff] = value & 0xff;
  }

  clear(value = 0): void {
    this.memory.fill(value & 0xff);
  }

  load(bytes: ArrayLike<number>, address: number): void {
    const start = address & 0xffff;

    if (start + bytes.length > 0x10000) {
      throw new RangeError('Program does not fit in the 64 KiB address space.');
    }

    for (let i = 0; i < bytes.length; i += 1) {
      this.memory[start + i] = bytes[i]! & 0xff;
    }
  }

  setVector(vectorAddress: number, targetAddress: number): void {
    this.write(vectorAddress, targetAddress & 0xff);
    this.write(vectorAddress + 1, (targetAddress >> 8) & 0xff);
  }
}
