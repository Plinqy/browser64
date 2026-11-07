export const BASIC_ROM_SIZE = 0x2000;
export const KERNAL_ROM_SIZE = 0x2000;
export const CHARACTER_ROM_SIZE = 0x1000;

export type C64RomKind = 'basic' | 'kernal' | 'character';

const ROM_SIZES: Record<C64RomKind, number> = {
  basic: BASIC_ROM_SIZE,
  kernal: KERNAL_ROM_SIZE,
  character: CHARACTER_ROM_SIZE
};

/**
 * Owns the three motherboard ROM images without depending on browser File APIs.
 */
export class C64Roms {
  public readonly basic = new Uint8Array(BASIC_ROM_SIZE);
  public readonly kernal = new Uint8Array(KERNAL_ROM_SIZE);
  public readonly character = new Uint8Array(CHARACTER_ROM_SIZE);

  private readonly loaded = new Set<C64RomKind>();

  constructor() {
    this.clear();
  }

  load(kind: C64RomKind, bytes: ArrayLike<number>): void {
    const expectedSize = ROM_SIZES[kind];

    if (bytes.length !== expectedSize) {
      throw new RangeError(
        `${kind} ROM must be exactly ${expectedSize} bytes; received ${bytes.length}.`
      );
    }

    const target = this[kind];
    for (let i = 0; i < expectedSize; i += 1) {
      target[i] = bytes[i]! & 0xff;
    }

    this.loaded.add(kind);
  }

  unload(kind: C64RomKind): void {
    this[kind].fill(0xff);
    this.loaded.delete(kind);
  }

  isLoaded(kind: C64RomKind): boolean {
    return this.loaded.has(kind);
  }

  get complete(): boolean {
    return this.loaded.size === 3;
  }

  clear(): void {
    this.basic.fill(0xff);
    this.kernal.fill(0xff);
    this.character.fill(0xff);
    this.loaded.clear();
  }
}
