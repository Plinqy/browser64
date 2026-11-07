import type { MemoryMappedDevice } from '../io/Device';
import { PAL_6569_TIMING, type VicTimingProfile } from './VicTiming';

export interface VicMemory {
  /** Read one byte from the VIC's current 16 KiB address space. */
  read(address: number): number;

  /** Read one low-nibble color value for a video-matrix cell. */
  readColor(index: number): number;
}

export enum VicGraphicsMode {
  STANDARD_TEXT = 0,
  MULTICOLOR_TEXT = 1,
  STANDARD_BITMAP = 2,
  MULTICOLOR_BITMAP = 3,
  EXTENDED_COLOR_TEXT = 4,
  INVALID_ECM_MULTICOLOR_TEXT = 5,
  INVALID_ECM_BITMAP = 6,
  INVALID_ECM_MULTICOLOR_BITMAP = 7
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
const IRQ_SPRITE_BACKGROUND = 0x02;
const IRQ_SPRITE_SPRITE = 0x04;
const BADLINE_FIRST_RASTER = 0x30;
const BADLINE_LAST_RASTER = 0xf7;
const BADLINE_BA_FIRST_CYCLE = 12;
const BADLINE_AEC_FIRST_CYCLE = 15;
const BADLINE_LAST_DMA_CYCLE = 54;
const G_ACCESS_FIRST_CYCLE = 16;
const G_ACCESS_LAST_CYCLE = 55;
const MATRIX_COLUMNS = 40;
const MATRIX_ROWS = 25;
const MATRIX_CELLS = MATRIX_COLUMNS * MATRIX_ROWS;
const VISIBLE_RASTER_START = 15;
const DISPLAY_FIRST_RASTER_25 = 51;
const DISPLAY_LAST_RASTER_25 = 250;
const DISPLAY_FIRST_RASTER_24 = 55;
const DISPLAY_LAST_RASTER_24 = 246;
const DISPLAY_X_40 = VIC_ACTIVE_X;
const DISPLAY_X_38 = VIC_ACTIVE_X + 8;
const SPRITE_X_ORIGIN = 24;
const SPRITE_COUNT = 8;
const SPRITE_POINTER_OFFSET = 0x03f8;

const PAL_SPRITE_POINTER_CYCLES = [58, 60, 62, 1, 3, 5, 7, 9] as const;

/**
 * MOS VIC-II video/memory sequencer.
 *
 * v0.6 moves display generation onto the raster pipeline: bad-line c-accesses
 * fill the video/color matrix latches, g-accesses fetch character/bitmap bytes
 * using VC/VCBASE/RC, and those bytes immediately generate framebuffer pixels.
 * All five documented graphics modes and all eight hardware sprites are
 * represented, including expansion, multicolor, priority, collision latches,
 * collision IRQs, and sprite DMA bus requests.
 */
export class VicII implements MemoryMappedDevice {
  public readonly framebuffer = new Uint8Array(VIC_FRAMEBUFFER_WIDTH * VIC_FRAMEBUFFER_HEIGHT);

  private readonly registers = new Uint8Array(0x40);
  private readonly graphicsOpaque = new Uint8Array(VIC_FRAMEBUFFER_WIDTH * VIC_FRAMEBUFFER_HEIGHT);
  private readonly videoMatrix = new Uint8Array(MATRIX_CELLS);
  private readonly colorMatrix = new Uint8Array(MATRIX_CELLS);
  private readonly lineVideoMatrix = new Uint8Array(MATRIX_COLUMNS);
  private readonly lineColorMatrix = new Uint8Array(MATRIX_COLUMNS);
  private readonly spriteLineData = Array.from({ length: SPRITE_COUNT }, () => new Uint8Array(3));
  private readonly spriteLineActive = new Uint8Array(SPRITE_COUNT);
  private readonly spriteLineRows = new Uint8Array(SPRITE_COUNT);

  private rasterLineValue = 0;
  private cycleInLineValue = 0;
  private rasterCompareValue = 0;
  private interruptStatus = 0;
  private interruptMask = 0;
  private frameCounter = 0;
  private badLineEnableLatch = false;
  private cAccessCounter = 0;
  private gAccessCounter = 0;
  private spriteDataAccessCounter = 0;

  private vcValue = 0;
  private vcBaseValue = 0;
  private rcValue = 0;
  private vmliValue = 0;
  private displayStateValue = false;
  private spriteSpriteCollision = 0;
  private spriteBackgroundCollision = 0;

  constructor(
    private readonly memory: VicMemory = OPEN_VIC_MEMORY,
    public readonly timing: VicTimingProfile = PAL_6569_TIMING
  ) {
    this.reset();
  }

  read(offset: number): number {
    const register = offset & REGISTER_MASK;
    if (register === 0x1e) {
      const value = this.spriteSpriteCollision;
      this.spriteSpriteCollision = 0;
      return value;
    }
    if (register === 0x1f) {
      const value = this.spriteBackgroundCollision;
      this.spriteBackgroundCollision = 0;
      return value;
    }
    return this.readRegister(register);
  }

  peek(offset: number): number {
    return this.readRegister(offset & REGISTER_MASK);
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
      case 0x1e:
      case 0x1f:
        // Collision registers are read-only; reads clear their latches.
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
    this.badLineEnableLatch = false;
    this.cAccessCounter = 0;
    this.gAccessCounter = 0;
    this.spriteDataAccessCounter = 0;
    this.vcValue = 0;
    this.vcBaseValue = 0;
    this.rcValue = 0;
    this.vmliValue = 0;
    this.displayStateValue = false;
    this.spriteSpriteCollision = 0;
    this.spriteBackgroundCollision = 0;
    this.videoMatrix.fill(0);
    this.colorMatrix.fill(0);
    this.lineVideoMatrix.fill(0);
    this.lineColorMatrix.fill(0);
    this.spriteLineActive.fill(0);
    this.spriteLineRows.fill(0);
    for (const data of this.spriteLineData) data.fill(0);
    this.framebuffer.fill(0);
    this.graphicsOpaque.fill(0);
  }

  /** Advance VIC raster time by complete C64 system/PHI2 cycles. */
  tick(cycles = 1): void {
    const count = Math.max(0, Math.trunc(cycles));
    for (let i = 0; i < count; i += 1) {
      this.tickOneCycle();
    }
  }

  /** Return the live color-index framebuffer generated by raster fetches. */
  renderFrame(): Uint8Array {
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

  /** Low three bits of $D011. */
  get yScroll(): number {
    return this.registers[0x11]! & 0x07;
  }

  /** Low three bits of $D016. */
  get xScroll(): number {
    return this.registers[0x16]! & 0x07;
  }

  get rowCounter(): number {
    return this.rcValue;
  }

  get videoCounter(): number {
    return this.vcValue;
  }

  get videoCounterBase(): number {
    return this.vcBaseValue;
  }

  get videoMatrixLineIndex(): number {
    return this.vmliValue;
  }

  get displayState(): boolean {
    return this.displayStateValue;
  }

  get graphicsMode(): VicGraphicsMode {
    const ecm = (this.registers[0x11]! >> 6) & 0x01;
    const bmm = (this.registers[0x11]! >> 5) & 0x01;
    const mcm = (this.registers[0x16]! >> 4) & 0x01;
    return ((ecm << 2) | (bmm << 1) | mcm) as VicGraphicsMode;
  }

  /**
   * A bad line performs 40 c-accesses for the next character row. DEN must have
   * been observed during raster $30 and the raster low three bits must match
   * YSCROLL.
   */
  get badLine(): boolean {
    return this.badLineEnableLatch
      && this.rasterLineValue >= BADLINE_FIRST_RASTER
      && this.rasterLineValue <= BADLINE_LAST_RASTER
      && (this.rasterLineValue & 0x07) === this.yScroll;
  }

  /** VIC BA output, combining bad-line and active-sprite DMA requests. */
  get baHigh(): boolean {
    return !this.badLineBaLow && !this.spriteBaLow;
  }

  /** VIC AEC output, low while either bad-line or sprite DMA owns PHI2. */
  get aecHigh(): boolean {
    return !this.badLineAecLow && !this.spriteAecLow;
  }

  /** Number of bad-line c-accesses completed in the current frame. */
  get cAccessesThisFrame(): number {
    return this.cAccessCounter;
  }

  /** Number of display g-accesses completed in the current frame. */
  get gAccessesThisFrame(): number {
    return this.gAccessCounter;
  }

  /** Number of sprite data bytes fetched in the current frame. */
  get spriteDataAccessesThisFrame(): number {
    return this.spriteDataAccessCounter;
  }

  readLatchedVideoMatrix(index: number): number {
    return this.videoMatrix[index % MATRIX_CELLS] ?? 0;
  }

  readLatchedColorMatrix(index: number): number {
    return this.colorMatrix[index % MATRIX_CELLS] ?? 0;
  }

  get displayEnabled(): boolean {
    return (this.registers[0x11]! & 0x10) !== 0;
  }

  get standardTextMode(): boolean {
    return this.graphicsMode === VicGraphicsMode.STANDARD_TEXT;
  }

  get screenMemoryOffset(): number {
    return ((this.registers[0x18]! >> 4) & 0x0f) * 0x0400;
  }

  get characterMemoryOffset(): number {
    return ((this.registers[0x18]! >> 1) & 0x07) * 0x0800;
  }

  get bitmapMemoryOffset(): number {
    return (this.registers[0x18]! & 0x08) !== 0 ? 0x2000 : 0x0000;
  }

  get borderColor(): number {
    return this.registers[0x20]! & 0x0f;
  }

  get backgroundColor(): number {
    return this.backgroundColorAt(0);
  }

  get spriteSpriteCollisionBits(): number {
    return this.spriteSpriteCollision;
  }

  get spriteBackgroundCollisionBits(): number {
    return this.spriteBackgroundCollision;
  }

  spriteSourceRow(sprite: number): number {
    return this.spriteLineRows[sprite & 0x07] ?? 0;
  }

  private get badLineBaLow(): boolean {
    if (!this.badLine) return false;
    const cycle = this.rasterCycle;
    return cycle >= BADLINE_BA_FIRST_CYCLE && cycle <= BADLINE_LAST_DMA_CYCLE;
  }

  private get badLineAecLow(): boolean {
    if (!this.badLine) return false;
    const cycle = this.rasterCycle;
    return cycle >= BADLINE_AEC_FIRST_CYCLE && cycle <= BADLINE_LAST_DMA_CYCLE;
  }

  private get spriteBaLow(): boolean {
    for (let sprite = 0; sprite < SPRITE_COUNT; sprite += 1) {
      if (this.spriteLineActive[sprite] === 0) continue;
      const pointerCycle = this.spritePointerCycle(sprite);
      if (this.cycleInWrappedRange(this.rasterCycle, pointerCycle - 3, pointerCycle + 1)) {
        return true;
      }
    }
    return false;
  }

  private get spriteAecLow(): boolean {
    for (let sprite = 0; sprite < SPRITE_COUNT; sprite += 1) {
      if (this.spriteLineActive[sprite] === 0) continue;
      const pointerCycle = this.spritePointerCycle(sprite);
      if (this.cycleInWrappedRange(this.rasterCycle, pointerCycle, pointerCycle + 1)) {
        return true;
      }
    }
    return false;
  }

  private readRegister(register: number): number {
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
      case 0x1e:
        return this.spriteSpriteCollision;
      case 0x1f:
        return this.spriteBackgroundCollision;
      default:
        return this.registers[register] ?? 0xff;
    }
  }

  private tickOneCycle(): void {
    const cycle = this.rasterCycle;

    if (cycle === 1) {
      this.beginRasterLine();
    }

    if (cycle === 14) {
      this.beginDisplayFetchWindow();
    }

    if (this.badLine && cycle >= BADLINE_AEC_FIRST_CYCLE && cycle <= BADLINE_LAST_DMA_CYCLE) {
      this.performBadLineCAccess(cycle - BADLINE_AEC_FIRST_CYCLE);
    }

    if (cycle >= G_ACCESS_FIRST_CYCLE && cycle <= G_ACCESS_LAST_CYCLE) {
      this.performGAccess(cycle - G_ACCESS_FIRST_CYCLE);
    }

    if (cycle === 56) {
      this.renderSpritesForCurrentRaster();
    }

    if (cycle === 58) {
      this.finishDisplayFetchWindow();
    }

    this.cycleInLineValue += 1;

    if (this.cycleInLineValue < this.timing.cyclesPerLine) {
      return;
    }

    this.cycleInLineValue = 0;
    this.rasterLineValue += 1;

    if (this.rasterLineValue >= this.timing.linesPerFrame) {
      this.rasterLineValue = 0;
      this.frameCounter += 1;
      this.badLineEnableLatch = false;
      this.cAccessCounter = 0;
      this.gAccessCounter = 0;
      this.spriteDataAccessCounter = 0;
      this.vcValue = 0;
      this.vcBaseValue = 0;
      this.rcValue = 0;
      this.vmliValue = 0;
      this.displayStateValue = false;
      this.framebuffer.fill(this.borderColor);
      this.graphicsOpaque.fill(0);
    }

    this.latchRasterInterruptIfMatched();
  }

  private beginRasterLine(): void {
    if (this.rasterLineValue === BADLINE_FIRST_RASTER && this.displayEnabled) {
      this.badLineEnableLatch = true;
    }

    this.prepareFramebufferLine();
    this.prepareSpriteLineData();
  }

  private beginDisplayFetchWindow(): void {
    this.vcValue = this.vcBaseValue;
    this.vmliValue = 0;

    if (this.badLine) {
      this.rcValue = 0;
      this.displayStateValue = true;
    }
  }

  private finishDisplayFetchWindow(): void {
    if (!this.displayStateValue) {
      return;
    }

    if (this.rcValue === 7) {
      this.vcBaseValue = this.vcValue & 0x03ff;
      this.displayStateValue = false;
      return;
    }

    this.rcValue = (this.rcValue + 1) & 0x07;
  }

  private performBadLineCAccess(column: number): void {
    if (column < 0 || column >= MATRIX_COLUMNS) {
      return;
    }

    const matrixIndex = (this.vcBaseValue + column) & 0x03ff;
    const video = this.memory.read(this.screenMemoryOffset + matrixIndex) & 0xff;
    const color = this.memory.readColor(matrixIndex) & 0x0f;

    this.lineVideoMatrix[column] = video;
    this.lineColorMatrix[column] = color;
    if (matrixIndex < MATRIX_CELLS) {
      this.videoMatrix[matrixIndex] = video;
      this.colorMatrix[matrixIndex] = color;
    }
    this.cAccessCounter += 1;
  }

  private performGAccess(column: number): void {
    if (!this.displayStateValue || column < 0 || column >= MATRIX_COLUMNS) {
      return;
    }

    const video = this.lineVideoMatrix[column]!;
    const color = this.lineColorMatrix[column]!;
    const matrixIndex = this.vcValue & 0x03ff;
    const graphics = this.readGraphicsByte(video, matrixIndex);

    this.renderGraphicsByte(column, graphics, video, color);

    this.vcValue = (this.vcValue + 1) & 0x03ff;
    this.vmliValue = (this.vmliValue + 1) % MATRIX_COLUMNS;
    this.gAccessCounter += 1;
  }

  private readGraphicsByte(video: number, matrixIndex: number): number {
    switch (this.graphicsMode) {
      case VicGraphicsMode.STANDARD_BITMAP:
      case VicGraphicsMode.MULTICOLOR_BITMAP:
      case VicGraphicsMode.INVALID_ECM_BITMAP:
      case VicGraphicsMode.INVALID_ECM_MULTICOLOR_BITMAP:
        return this.memory.read(this.bitmapMemoryOffset + matrixIndex * 8 + this.rcValue) & 0xff;
      case VicGraphicsMode.EXTENDED_COLOR_TEXT:
      case VicGraphicsMode.INVALID_ECM_MULTICOLOR_TEXT:
        return this.memory.read(this.characterMemoryOffset + (video & 0x3f) * 8 + this.rcValue) & 0xff;
      default:
        return this.memory.read(this.characterMemoryOffset + video * 8 + this.rcValue) & 0xff;
    }
  }

  private renderGraphicsByte(column: number, graphics: number, video: number, color: number): void {
    const frameY = this.frameYForRaster(this.rasterLineValue);
    if (frameY < 0 || frameY >= VIC_FRAMEBUFFER_HEIGHT || !this.verticalDisplayOpen) {
      return;
    }

    const cellX = VIC_ACTIVE_X + column * 8 + this.xScroll;
    const leftClip = this.horizontalDisplayStart;
    const rightClip = this.horizontalDisplayEnd;

    if (this.graphicsMode >= VicGraphicsMode.INVALID_ECM_MULTICOLOR_TEXT) {
      for (let pixel = 0; pixel < 8; pixel += 1) {
        this.writeGraphicsPixel(cellX + pixel, frameY, 0, false, leftClip, rightClip);
      }
      return;
    }

    switch (this.graphicsMode) {
      case VicGraphicsMode.STANDARD_TEXT:
        this.renderHiresByte(cellX, frameY, graphics, color, this.backgroundColorAt(0), leftClip, rightClip);
        break;
      case VicGraphicsMode.MULTICOLOR_TEXT:
        if ((color & 0x08) === 0) {
          this.renderHiresByte(cellX, frameY, graphics, color & 0x07, this.backgroundColorAt(0), leftClip, rightClip);
        } else {
          this.renderMulticolorByte(
            cellX,
            frameY,
            graphics,
            [this.backgroundColorAt(0), this.backgroundColorAt(1), this.backgroundColorAt(2), color & 0x07],
            leftClip,
            rightClip
          );
        }
        break;
      case VicGraphicsMode.STANDARD_BITMAP:
        this.renderHiresByte(cellX, frameY, graphics, (video >> 4) & 0x0f, video & 0x0f, leftClip, rightClip);
        break;
      case VicGraphicsMode.MULTICOLOR_BITMAP:
        this.renderMulticolorByte(
          cellX,
          frameY,
          graphics,
          [this.backgroundColorAt(0), (video >> 4) & 0x0f, video & 0x0f, color & 0x0f],
          leftClip,
          rightClip
        );
        break;
      case VicGraphicsMode.EXTENDED_COLOR_TEXT:
        this.renderHiresByte(
          cellX,
          frameY,
          graphics,
          color & 0x0f,
          this.backgroundColorAt((video >> 6) & 0x03),
          leftClip,
          rightClip
        );
        break;
      default:
        break;
    }
  }

  private renderHiresByte(
    x: number,
    y: number,
    bits: number,
    foreground: number,
    background: number,
    leftClip: number,
    rightClip: number
  ): void {
    for (let pixel = 0; pixel < 8; pixel += 1) {
      const opaque = (bits & (0x80 >> pixel)) !== 0;
      this.writeGraphicsPixel(x + pixel, y, opaque ? foreground : background, opaque, leftClip, rightClip);
    }
  }

  private renderMulticolorByte(
    x: number,
    y: number,
    bits: number,
    colors: readonly [number, number, number, number],
    leftClip: number,
    rightClip: number
  ): void {
    for (let pair = 0; pair < 4; pair += 1) {
      const selector = (bits >> (6 - pair * 2)) & 0x03;
      const color = colors[selector] ?? 0;
      // In multicolor display modes, %00 and %01 are background-class pixels;
      // %10 and %11 are foreground for sprite priority/collision purposes.
      const opaque = selector >= 2;
      const pixelX = x + pair * 2;
      this.writeGraphicsPixel(pixelX, y, color, opaque, leftClip, rightClip);
      this.writeGraphicsPixel(pixelX + 1, y, color, opaque, leftClip, rightClip);
    }
  }

  private writeGraphicsPixel(
    x: number,
    y: number,
    color: number,
    opaque: boolean,
    leftClip: number,
    rightClip: number
  ): void {
    if (x < leftClip || x >= rightClip || x < 0 || x >= VIC_FRAMEBUFFER_WIDTH) {
      return;
    }
    const index = y * VIC_FRAMEBUFFER_WIDTH + x;
    this.framebuffer[index] = color & 0x0f;
    this.graphicsOpaque[index] = opaque ? 1 : 0;
  }

  private prepareFramebufferLine(): void {
    const frameY = this.frameYForRaster(this.rasterLineValue);
    if (frameY < 0 || frameY >= VIC_FRAMEBUFFER_HEIGHT) {
      return;
    }

    const lineStart = frameY * VIC_FRAMEBUFFER_WIDTH;
    const lineEnd = lineStart + VIC_FRAMEBUFFER_WIDTH;
    this.framebuffer.fill(this.borderColor, lineStart, lineEnd);
    this.graphicsOpaque.fill(0, lineStart, lineEnd);

    if (!this.displayEnabled || !this.verticalDisplayOpen) {
      return;
    }

    const displayStart = lineStart + this.horizontalDisplayStart;
    const displayEnd = lineStart + this.horizontalDisplayEnd;
    this.framebuffer.fill(this.backgroundColorAt(0), displayStart, displayEnd);
  }

  private prepareSpriteLineData(): void {
    const enabled = this.registers[0x15]!;
    const yExpand = this.registers[0x17]!;

    for (let sprite = 0; sprite < SPRITE_COUNT; sprite += 1) {
      this.spriteLineActive[sprite] = 0;
      this.spriteLineData[sprite]!.fill(0);

      if ((enabled & (1 << sprite)) === 0) {
        continue;
      }

      const y = this.registers[sprite * 2 + 1]!;
      const relative = this.spriteRelativeRaster(this.rasterLineValue, y);
      const expanded = (yExpand & (1 << sprite)) !== 0;
      const height = expanded ? 42 : 21;
      if (relative < 0 || relative >= height) {
        continue;
      }

      const sourceRow = expanded ? Math.trunc(relative / 2) : relative;
      this.spriteLineRows[sprite] = sourceRow;
      this.spriteLineActive[sprite] = 1;

      const pointer = this.memory.read(this.screenMemoryOffset + SPRITE_POINTER_OFFSET + sprite) & 0xff;
      const dataAddress = pointer * 64 + sourceRow * 3;
      for (let byte = 0; byte < 3; byte += 1) {
        this.spriteLineData[sprite]![byte] = this.memory.read(dataAddress + byte) & 0xff;
        this.spriteDataAccessCounter += 1;
      }
    }
  }

  private renderSpritesForCurrentRaster(): void {
    const frameY = this.frameYForRaster(this.rasterLineValue);
    if (frameY < 0 || frameY >= VIC_FRAMEBUFFER_HEIGHT) {
      return;
    }

    const occupancy = new Uint8Array(VIC_FRAMEBUFFER_WIDTH);
    const multicolorMask = this.registers[0x1c]!;
    const xExpandMask = this.registers[0x1d]!;
    const priorityMask = this.registers[0x1b]!;

    // Lower-numbered sprites have fixed priority over higher-numbered sprites,
    // so paint 7..0 while still accumulating collisions for every overlap.
    for (let sprite = SPRITE_COUNT - 1; sprite >= 0; sprite -= 1) {
      if (this.spriteLineActive[sprite] === 0) {
        continue;
      }

      const xLow = this.registers[sprite * 2]!;
      const xMsb = (this.registers[0x10]! >> sprite) & 0x01;
      const spriteX = xLow | (xMsb << 8);
      const frameX = VIC_ACTIVE_X + spriteX - SPRITE_X_ORIGIN;
      const expanded = (xExpandMask & (1 << sprite)) !== 0;
      const multicolor = (multicolorMask & (1 << sprite)) !== 0;
      const behindGraphics = (priorityMask & (1 << sprite)) !== 0;
      const spriteColor = this.registers[0x27 + sprite]! & 0x0f;
      const data = this.spriteLineData[sprite]!;
      const packed = (data[0]! << 16) | (data[1]! << 8) | data[2]!;

      if (multicolor) {
        for (let pair = 0; pair < 12; pair += 1) {
          const selector = (packed >> (22 - pair * 2)) & 0x03;
          if (selector === 0) continue;
          const color = selector === 1
            ? this.registers[0x25]! & 0x0f
            : selector === 2
              ? spriteColor
              : this.registers[0x26]! & 0x0f;
          const scale = expanded ? 4 : 2;
          const startX = frameX + pair * scale;
          for (let pixel = 0; pixel < scale; pixel += 1) {
            this.plotSpritePixel(sprite, startX + pixel, frameY, color, behindGraphics, occupancy);
          }
        }
      } else {
        const scale = expanded ? 2 : 1;
        for (let bit = 0; bit < 24; bit += 1) {
          if ((packed & (1 << (23 - bit))) === 0) continue;
          const startX = frameX + bit * scale;
          for (let pixel = 0; pixel < scale; pixel += 1) {
            this.plotSpritePixel(sprite, startX + pixel, frameY, spriteColor, behindGraphics, occupancy);
          }
        }
      }
    }
  }

  private plotSpritePixel(
    sprite: number,
    x: number,
    y: number,
    color: number,
    behindGraphics: boolean,
    occupancy: Uint8Array
  ): void {
    if (x < 0 || x >= VIC_FRAMEBUFFER_WIDTH) {
      return;
    }

    const spriteBit = 1 << sprite;
    const existingSprites = occupancy[x]!;
    if (existingSprites !== 0) {
      this.spriteSpriteCollision |= existingSprites | spriteBit;
      this.interruptStatus |= IRQ_SPRITE_SPRITE;
    }
    occupancy[x] = existingSprites | spriteBit;

    const frameIndex = y * VIC_FRAMEBUFFER_WIDTH + x;
    if (this.graphicsOpaque[frameIndex] !== 0) {
      this.spriteBackgroundCollision |= spriteBit;
      this.interruptStatus |= IRQ_SPRITE_BACKGROUND;
      if (behindGraphics) {
        return;
      }
    }

    // The physical border is in front of sprite pixels. Collisions can still
    // latch underneath it, but the sprite is not visible there.
    if (!this.verticalDisplayOpen || x < this.horizontalDisplayStart || x >= this.horizontalDisplayEnd) {
      return;
    }

    this.framebuffer[frameIndex] = color & 0x0f;
  }

  private latchRasterInterruptIfMatched(): void {
    if (this.rasterLineValue === this.rasterCompareValue) {
      this.interruptStatus |= IRQ_RASTER;
    }
  }

  private backgroundColorAt(index: number): number {
    return this.registers[0x21 + (index & 0x03)]! & 0x0f;
  }

  private frameYForRaster(raster: number): number {
    return raster - VISIBLE_RASTER_START;
  }

  private get verticalDisplayOpen(): boolean {
    const rows25 = (this.registers[0x11]! & 0x08) !== 0;
    const first = rows25 ? DISPLAY_FIRST_RASTER_25 : DISPLAY_FIRST_RASTER_24;
    const last = rows25 ? DISPLAY_LAST_RASTER_25 : DISPLAY_LAST_RASTER_24;
    return this.rasterLineValue >= first && this.rasterLineValue <= last;
  }

  private get horizontalDisplayStart(): number {
    return (this.registers[0x16]! & 0x08) !== 0 ? DISPLAY_X_40 : DISPLAY_X_38;
  }

  private get horizontalDisplayEnd(): number {
    return this.horizontalDisplayStart + ((this.registers[0x16]! & 0x08) !== 0 ? 320 : 304);
  }

  private spriteRelativeRaster(raster: number, spriteY: number): number {
    const firstLine = (spriteY + 1) & 0xff;
    if (raster <= 0xff) {
      return raster - firstLine;
    }
    return -1;
  }

  private spritePointerCycle(sprite: number): number {
    if (this.timing.standard === 'pal') {
      return PAL_SPRITE_POINTER_CYCLES[sprite] ?? 1;
    }

    // v0.6 keeps the PAL model authoritative. NTSC uses the same sprite engine
    // but delays the PAL end-of-line slots by one cycle where practical.
    const palCycle = PAL_SPRITE_POINTER_CYCLES[sprite] ?? 1;
    return palCycle >= 58 ? palCycle + 1 : palCycle;
  }

  private cycleInWrappedRange(cycle: number, rawStart: number, rawEnd: number): boolean {
    const normalize = (value: number): number => {
      const zeroBased = ((value - 1) % this.timing.cyclesPerLine + this.timing.cyclesPerLine)
        % this.timing.cyclesPerLine;
      return zeroBased + 1;
    };

    const start = normalize(rawStart);
    const end = normalize(rawEnd);
    if (start <= end) {
      return cycle >= start && cycle <= end;
    }
    return cycle >= start || cycle <= end;
  }
}
