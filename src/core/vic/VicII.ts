import type { MemoryMappedDevice } from '../io/Device';
import { PAL_6569_TIMING, type VicTimingProfile } from './VicTiming';

export interface VicMemory {
  /** Read one byte from the VIC's current 16 KiB address space. */
  read(address: number): number;

  /** Read one low-nibble color value for a video-matrix cell. */
  readColor(index: number): number;
}

const OPEN_VIC_MEMORY: VicMemory = Object.freeze({
  read: () => 0xff,
  readColor: () => 0x0f
});

export const VIC_FRAMEBUFFER_WIDTH = 384;
export const VIC_FRAMEBUFFER_HEIGHT = 272;
export const VIC_ACTIVE_WIDTH = 320;
export const VIC_ACTIVE_HEIGHT = 200;
export const VIC_ACTIVE_X = (VIC_FRAMEBUFFER_WIDTH - VIC_ACTIVE_WIDTH) / 2;
export const VIC_ACTIVE_Y = (VIC_FRAMEBUFFER_HEIGHT - VIC_ACTIVE_HEIGHT) / 2;

const REGISTER_MASK = 0x3f;
const LAST_IMPLEMENTED_REGISTER = 0x2e;
const IRQ_RASTER = 0x01;

/**
 * MOS VIC-II foundation.
 *
 * v0.4 implements the CPU-visible register behavior required for normal text
 * display and raster interrupts, PAL/NTSC raster counters, and a deterministic
 * 40x25 standard-text framebuffer. Sprite DMA, bad-line bus arbitration,
 * multicolor/bitmap modes, open-bus behavior, and cycle-positioned pixels are
 * deliberately deferred.
 */
export class VicII implements MemoryMappedDevice {
  public readonly framebuffer = new Uint8Array(VIC_FRAMEBUFFER_WIDTH * VIC_FRAMEBUFFER_HEIGHT);

  private readonly registers = new Uint8Array(0x40);
  private rasterLineValue = 0;
  private cycleInLineValue = 0;
  private rasterCompareValue = 0;
  private interruptStatus = 0;
  private interruptMask = 0;
  private frameCounter = 0;

  constructor(
    private readonly memory: VicMemory = OPEN_VIC_MEMORY,
    public readonly timing: VicTimingProfile = PAL_6569_TIMING
  ) {
    this.reset();
  }

  read(offset: number): number {
    return this.readRegister(offset);
  }

  peek(offset: number): number {
    return this.readRegister(offset);
  }

  write(offset: number, value: number): void {
    const register = offset & REGISTER_MASK;
    if (register > LAST_IMPLEMENTED_REGISTER) {
      return;
    }

    const byte = value & 0xff;

    switch (register) {
      case 0x11:
        this.registers[register] = byte & 0x7f;
        this.rasterCompareValue = (this.rasterCompareValue & 0x00ff) | ((byte & 0x80) << 1);
        break;
      case 0x12:
        this.rasterCompareValue = (this.rasterCompareValue & 0x0100) | byte;
        break;
      case 0x18:
        this.registers[register] = byte & 0xfe;
        break;
      case 0x19:
        // VIC interrupt latches acknowledge by writing a 1 to each source bit.
        this.interruptStatus &= ~(byte & 0x0f);
        break;
      case 0x1a:
        this.interruptMask = byte & 0x0f;
        break;
      default:
        this.registers[register] = register >= 0x20 && register <= 0x2e
          ? byte & 0x0f
          : byte;
        break;
    }
  }

  reset(): void {
    this.registers.fill(0);
    this.rasterLineValue = 0;
    this.cycleInLineValue = 0;
    this.rasterCompareValue = 0;
    this.interruptStatus = 0;
    this.interruptMask = 0;
    this.frameCounter = 0;
    this.framebuffer.fill(0);
  }

  /** Advance VIC raster time by complete C64 system/PHI2 cycles. */
  tick(cycles = 1): void {
    const count = Math.max(0, Math.trunc(cycles));
    for (let i = 0; i < count; i += 1) {
      this.tickOneCycle();
    }
  }

  /** Render the current standard-text state into a browser-independent color-index framebuffer. */
  renderFrame(): Uint8Array {
    const borderColor = this.borderColor;
    this.framebuffer.fill(borderColor);

    if (!this.displayEnabled) {
      return this.framebuffer;
    }

    const backgroundColor = this.backgroundColor;
    this.fillRectangle(
      VIC_ACTIVE_X,
      VIC_ACTIVE_Y,
      VIC_ACTIVE_WIDTH,
      VIC_ACTIVE_HEIGHT,
      backgroundColor
    );

    // v0.4 deliberately renders only the normal hires text mode. Keeping the
    // unsupported mode result deterministic is more useful than approximating
    // bitmap, ECM, or multicolor behavior incorrectly.
    if (!this.standardTextMode) {
      return this.framebuffer;
    }

    const screenBase = this.screenMemoryOffset;
    const characterBase = this.characterMemoryOffset;

    for (let row = 0; row < 25; row += 1) {
      for (let column = 0; column < 40; column += 1) {
        const cell = row * 40 + column;
        const characterCode = this.memory.read(screenBase + cell) & 0xff;
        const foregroundColor = this.memory.readColor(cell) & 0x0f;
        const glyphAddress = characterBase + characterCode * 8;

        for (let glyphRow = 0; glyphRow < 8; glyphRow += 1) {
          const bits = this.memory.read(glyphAddress + glyphRow) & 0xff;
          const y = VIC_ACTIVE_Y + row * 8 + glyphRow;
          const lineOffset = y * VIC_FRAMEBUFFER_WIDTH + VIC_ACTIVE_X + column * 8;

          for (let glyphColumn = 0; glyphColumn < 8; glyphColumn += 1) {
            const mask = 0x80 >> glyphColumn;
            this.framebuffer[lineOffset + glyphColumn] = (bits & mask) !== 0
              ? foregroundColor
              : backgroundColor;
          }
        }
      }
    }

    return this.framebuffer;
  }

  get irqAsserted(): boolean {
    return (this.interruptStatus & this.interruptMask & 0x0f) !== 0;
  }

  get rasterLine(): number {
    return this.rasterLineValue;
  }

  /** Human-facing cycle number, 1..cyclesPerLine. */
  get rasterCycle(): number {
    return this.cycleInLineValue + 1;
  }

  get rasterCompare(): number {
    return this.rasterCompareValue;
  }

  get frameNumber(): number {
    return this.frameCounter;
  }

  get cyclesPerFrame(): number {
    return this.timing.cyclesPerLine * this.timing.linesPerFrame;
  }

  get displayEnabled(): boolean {
    return (this.registers[0x11]! & 0x10) !== 0;
  }

  get standardTextMode(): boolean {
    const control1 = this.registers[0x11]!;
    const control2 = this.registers[0x16]!;
    return (control1 & 0x60) === 0 && (control2 & 0x10) === 0;
  }

  get screenMemoryOffset(): number {
    return ((this.registers[0x18]! >> 4) & 0x0f) * 0x0400;
  }

  get characterMemoryOffset(): number {
    return ((this.registers[0x18]! >> 1) & 0x07) * 0x0800;
  }

  get borderColor(): number {
    return this.registers[0x20]! & 0x0f;
  }

  get backgroundColor(): number {
    return this.registers[0x21]! & 0x0f;
  }

  private readRegister(offset: number): number {
    const register = offset & REGISTER_MASK;
    if (register > LAST_IMPLEMENTED_REGISTER) {
      return 0xff;
    }

    switch (register) {
      case 0x11:
        return (this.registers[0x11]! & 0x7f) | ((this.rasterLineValue & 0x0100) >> 1);
      case 0x12:
        return this.rasterLineValue & 0xff;
      case 0x18:
        return this.registers[0x18]! | 0x01;
      case 0x19:
        return 0x70 | (this.interruptStatus & 0x0f) | (this.irqAsserted ? 0x80 : 0);
      case 0x1a:
        return 0xf0 | this.interruptMask;
      default:
        return this.registers[register] ?? 0xff;
    }
  }

  private tickOneCycle(): void {
    this.cycleInLineValue += 1;

    if (this.cycleInLineValue < this.timing.cyclesPerLine) {
      return;
    }

    this.cycleInLineValue = 0;
    this.rasterLineValue += 1;

    if (this.rasterLineValue >= this.timing.linesPerFrame) {
      this.rasterLineValue = 0;
      this.frameCounter += 1;
      this.renderFrame();
    }

    this.latchRasterInterruptIfMatched();
  }

  private latchRasterInterruptIfMatched(): void {
    if (this.rasterLineValue === this.rasterCompareValue) {
      this.interruptStatus |= IRQ_RASTER;
    }
  }

  private fillRectangle(x: number, y: number, width: number, height: number, color: number): void {
    for (let row = y; row < y + height; row += 1) {
      const start = row * VIC_FRAMEBUFFER_WIDTH + x;
      this.framebuffer.fill(color & 0x0f, start, start + width);
    }
  }
}
