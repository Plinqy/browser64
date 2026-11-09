import { cartridgeFromCrt } from '../cartridge/BankedCartridge';
import { GenericCartridge, type RawCartridgeMode } from '../cartridge/GenericCartridge';
import { parseCrt, type CrtImage } from '../cartridge/CrtImage';
import { Cpu6510, type CpuClockResult } from '../cpu/Cpu6510';
import type { CpuState } from '../cpu/types';
import { C1541Drive, C1541_CLOCK_HZ } from '../drive1541/C1541Drive';
import type { D64Image } from '../disk/D64Image';
import type { G64Image } from '../disk/G64Image';
import type { ExportedDriveMedia } from '../drive1541/DriveMechanism1541';
import type { IecEndpoint } from '../iec/IecBus';
import { Disassembler } from '../debugger/Disassembler';
import { TraceFormatter } from '../debugger/TraceFormatter';
import { C64Monitor } from '../debugger/Monitor';
import type { JoystickControl, JoystickPort } from '../io/C64Io';
import { C64Bus, type C64BusState } from '../memory/C64Bus';
import { parsePrg, type PrgLoadResult } from '../program/Prg';
import type { C64RomKind } from '../rom/RomSet';
import type { SidChipModel } from '../sid/SidModel';
import { TapImage } from '../tape/TapImage';
import { PAL_6569_TIMING, type VicTimingProfile } from '../vic/VicTiming';

export interface C64MachineOptions {
  readonly timing?: VicTimingProfile;
  readonly sidModel?: SidChipModel;
}


export interface C64MachineState {
  readonly format: 'c64-browser-emulator-state';
  readonly version: 1;
  readonly videoStandard: 'pal' | 'ntsc';
  readonly systemClockHz: number;
  readonly cpu: CpuState;
  readonly bus: C64BusState;
  readonly masterCycleCounter: number;
  readonly cpuStallCounter: number;
  readonly cia2IrqWasAsserted: boolean;
  readonly expansionNmiWasAsserted: boolean;
  readonly restorePressed: boolean;
  readonly driveClockAccumulator: number;
}

export interface C64SystemCycleResult {
  cpu: CpuClockResult;
  /** VIC BA level used for this system cycle. */
  baHigh: boolean;
  /** VIC AEC level used for this system cycle. */
  aecHigh: boolean;
  /** Master system-cycle number after the cycle completed. */
  masterCycle: number;
}

/**
 * Top-level composition root for one stock Commodore 64.
 *
 * The system cycle is the actual execution boundary. Each master tick
 * samples VIC-II BA/AEC, advances one 6510 micro-cycle when permitted, advances
 * VIC/CIA/SID time once, advances the independent 1 MHz 1541 clock, and then
 * resynchronizes interrupt lines. PAL/NTSC timing remains a machine-level choice.
 */
export class C64Machine {
  public readonly bus: C64Bus;
  public readonly cpu: Cpu6510;
  public readonly disassembler: Disassembler;
  public readonly trace: TraceFormatter;
  public readonly monitor: C64Monitor;
  public readonly drive1541: C1541Drive;

  private cia2IrqWasAsserted = false;
  private expansionNmiWasAsserted = false;
  private restorePressed = false;
  private masterCycleCounter = 0;
  private cpuStallCounter = 0;
  private driveClockAccumulator = 0;
  private readonly c64ResetEndpoint: IecEndpoint;

  public readonly timing: VicTimingProfile;

  constructor(options: C64MachineOptions | VicTimingProfile = {}) {
    const normalized = isTimingProfile(options) ? { timing: options } : options;
    this.timing = normalized.timing ?? PAL_6569_TIMING;
    this.bus = new C64Bus(this.timing, normalized.sidModel ?? '6581');
    this.cpu = new Cpu6510(this.bus);
    this.drive1541 = new C1541Drive(this.bus.io.iecBus, 8);
    this.c64ResetEndpoint = this.bus.io.iecBus.createEndpoint('c64-reset');
    this.disassembler = new Disassembler(this.bus);
    this.trace = new TraceFormatter(this.cpu);
    this.monitor = new C64Monitor(this.cpu, this.bus, {
      masterCycles: () => this.masterCycleCounter,
      cpuStallCycles: () => this.cpuStallCounter
    });
    this.bus.setAccessObserver((access) => this.monitor.observeBusAccess(access));
  }

  loadRom(kind: C64RomKind, bytes: ArrayLike<number>): void {
    this.bus.roms.load(kind, bytes);
  }

  load1541Rom(bytes: ArrayLike<number>): void {
    this.drive1541.loadRom(bytes);
    this.drive1541.reset();
  }

  mountD64In1541(imageOrBytes: D64Image | ArrayLike<number>, writeProtected = false): D64Image {
    return this.drive1541.mountD64(imageOrBytes, writeProtected);
  }

  mountG64In1541(imageOrBytes: G64Image | ArrayLike<number>, writeProtected = false): G64Image {
    return this.drive1541.mountG64(imageOrBytes, writeProtected);
  }

  export1541Media(): ExportedDriveMedia | null {
    return this.drive1541.exportMountedMedia();
  }

  set1541WriteProtected(writeProtected: boolean): void {
    this.drive1541.setDiskWriteProtected(writeProtected);
  }

  eject1541Disk(): void {
    this.drive1541.ejectDisk();
  }

  mountCrt(bytes: ArrayLike<number>): CrtImage {
    const crt = parseCrt(bytes);
    this.bus.attachCartridge(cartridgeFromCrt(crt));
    return crt;
  }

  mountRawCartridge(bytes: ArrayLike<number>, mode: RawCartridgeMode, name?: string): void {
    this.bus.attachCartridge(GenericCartridge.fromRaw(bytes, mode, name));
  }

  ejectCartridge(): void {
    this.bus.detachCartridge();
    this.expansionNmiWasAsserted = false;
    this.syncInterruptLines();
  }

  pressCartridgeFreeze(): void {
    this.bus.expansion.freeze();
    this.syncInterruptLines();
  }

  mountTap(bytes: ArrayLike<number>, writeProtected = false): TapImage {
    const image = TapImage.parse(bytes);
    this.bus.datasette.mount(image, writeProtected);
    return image;
  }

  newBlankTape(): TapImage {
    return this.bus.datasette.newBlankTape(videoStandardForTiming(this.timing));
  }

  recordTape(): void {
    this.bus.datasette.pressRecord();
  }

  exportTape(): Uint8Array | null {
    return this.bus.datasette.exportTapBytes();
  }

  setTapeWriteProtected(writeProtected: boolean): void {
    this.bus.datasette.setWriteProtected(writeProtected);
  }

  ejectTape(): void {
    this.bus.datasette.eject();
  }

  playTape(): void {
    this.bus.datasette.pressPlay();
  }

  stopTape(): void {
    this.bus.datasette.pressStop();
  }

  rewindTape(): void {
    this.bus.datasette.rewind();
  }

  /**
   * Deterministic cold start for development. Real DRAM power-up patterns are
   * not yet emulated, so RAM is cleared instead of pretending to be authentic.
   */
  powerOn(): number {
    this.monitor.beginMachineReset();
    try {
      this.bus.clearRam();
      this.bus.resetProcessorPort();
      this.bus.resetIo();
      this.bus.io.colorRam.clear();
      this.cia2IrqWasAsserted = false;
      this.expansionNmiWasAsserted = false;
      this.restorePressed = false;
      this.masterCycleCounter = 0;
      this.cpuStallCounter = 0;
      this.driveClockAccumulator = 0;
      this.c64ResetEndpoint.setPulledLow('reset', true);
      this.drive1541.powerOn();
      const cycles = this.cpu.reset();
      this.advanceResetCycles(cycles);
      this.c64ResetEndpoint.release('reset');
      return cycles;
    } finally {
      this.monitor.endMachineReset();
    }
  }

  /**
   * Reset preserves RAM and physical input state while resetting the processor
   * port and resettable I/O chips.
   */
  reset(): number {
    this.monitor.beginMachineReset();
    try {
      this.bus.resetProcessorPort();
      this.bus.resetIo();
      this.cia2IrqWasAsserted = false;
      this.expansionNmiWasAsserted = false;
      this.restorePressed = false;
      this.masterCycleCounter = 0;
      this.cpuStallCounter = 0;
      this.driveClockAccumulator = 0;
      this.c64ResetEndpoint.setPulledLow('reset', true);
      this.drive1541.reset();
      const cycles = this.cpu.reset();
      this.advanceResetCycles(cycles);
      this.c64ResetEndpoint.release('reset');
      return cycles;
    } finally {
      this.monitor.endMachineReset();
    }
  }

  /**
   * Run until one 6510 instruction/interrupt sequence completes.
   *
   * The returned count is elapsed C64 system cycles, including VIC-induced CPU
   * stalls. With BA/AEC high it is identical to the instruction's CPU cycles.
   */
  step(): number {
    if (!this.cpu.instructionInProgress) {
      this.monitor.recordInstructionBoundary();
    }
    const startingMasterCycle = this.masterCycleCounter;
    let completed = false;

    while (!completed) {
      completed = this.tickSystemCycle().cpu.instructionCompleted;
    }

    return this.masterCycleCounter - startingMasterCycle;
  }

  /** Advance exactly one complete C64 system cycle, including the CPU. */
  tickSystemCycle(): C64SystemCycleResult {
    this.syncInterruptLines();

    const vic = this.bus.io.vic;
    const baHigh = vic.baHigh;
    const aecHigh = vic.aecHigh;
    const cpuResult = this.cpu.clock(baHigh, aecHigh);

    if (cpuResult.stalled) {
      this.cpuStallCounter += 1;
    }

    // VIC and CIAs never stop when the 6510 is denied the bus.
    this.bus.io.tick(1);
    this.bus.tickDatasette(1);
    this.advance1541Clock();
    this.masterCycleCounter += 1;
    this.monitor.observeRasterPosition();
    this.syncInterruptLines();

    return {
      cpu: cpuResult,
      baHigh,
      aecHigh,
      masterCycle: this.masterCycleCounter
    };
  }

  run(maxInstructions: number, shouldStop?: (machine: C64Machine) => boolean): number {
    let executed = 0;
    while (executed < maxInstructions) {
      if (this.monitor.shouldPauseBeforeInstruction() || shouldStop?.(this)) {
        break;
      }
      this.step();
      executed += 1;
      if (this.monitor.paused) {
        break;
      }
    }
    return executed;
  }

  /** Run whole CPU instructions until the VIC enters the next frame. */
  runFrame(maxInstructions = 100_000): number {
    const startingFrame = this.bus.io.vic.frameNumber;
    return this.run(maxInstructions, (machine) => machine.bus.io.vic.frameNumber !== startingFrame);
  }

  /**
   * RESTORE is a separate active-low NMI source on the C64 motherboard.
   * Only the press edge creates an NMI; holding the key does not retrigger it.
   */
  setRestorePressed(pressed: boolean): void {
    if (pressed && !this.restorePressed) {
      this.cpu.pulseNmi();
      this.monitor.observeNmi('RESTORE');
    }
    this.restorePressed = pressed;
  }

  setJoystickControl(port: JoystickPort, control: JoystickControl, pressed: boolean): void {
    this.bus.io.setJoystickControl(port, control, pressed);
  }

  /**
   * Load a PRG into physical RAM. A normal BASIC PRG at $0801 also refreshes
   * BASIC's text/variable boundary pointers so LIST/RUN can consume it.
   */
  loadPrg(bytes: ArrayLike<number>, initializeBasicPointers = true): PrgLoadResult {
    const parsed = parsePrg(bytes);
    this.bus.loadRam(parsed.payload, parsed.loadAddress);

    const initializeBasic = initializeBasicPointers && parsed.loadAddress === 0x0801;
    if (initializeBasic) {
      this.writeWordToRam(0x002b, parsed.loadAddress); // TXTTAB
      this.writeWordToRam(0x002d, parsed.endAddressExclusive); // VARTAB
      this.writeWordToRam(0x002f, parsed.endAddressExclusive); // ARYTAB
      this.writeWordToRam(0x0031, parsed.endAddressExclusive); // STREND
    }

    return {
      loadAddress: parsed.loadAddress,
      endAddressExclusive: parsed.endAddressExclusive,
      byteLength: parsed.payload.length,
      basicPointersInitialized: initializeBasic
    };
  }

  /** Explicit host/debugger launch point for a machine-code PRG. */
  startAt(address: number): void {
    this.cpu.setProgramCounter(address);
  }

  /** Supply one external 50/60 Hz TOD pulse to both motherboard CIAs. */
  pulseTod(): void {
    this.bus.io.cia1.pulseTod();
    this.bus.io.cia2.pulseTod();
    this.syncInterruptLines();
  }

  /**
   * Capture the motherboard at an instruction boundary. The independent 1541
   * electronics are intentionally not serialized; restoreState() resets the
   * drive CPU/VIAs while preserving its mounted media and head position.
   */
  saveState(): C64MachineState {
    if (this.cpu.instructionInProgress) {
      throw new Error('Save states are only available at a 6510 instruction boundary.');
    }
    return {
      format: 'c64-browser-emulator-state',
      version: 1,
      videoStandard: this.timing.standard,
      systemClockHz: this.timing.systemClockHz,
      cpu: this.cpu.saveState(),
      bus: this.bus.saveState(),
      masterCycleCounter: this.masterCycleCounter,
      cpuStallCounter: this.cpuStallCounter,
      cia2IrqWasAsserted: this.cia2IrqWasAsserted,
      expansionNmiWasAsserted: this.expansionNmiWasAsserted,
      restorePressed: this.restorePressed,
      driveClockAccumulator: this.driveClockAccumulator
    };
  }

  restoreState(state: C64MachineState): void {
    if (state.format !== 'c64-browser-emulator-state' || state.version !== 1) {
      throw new Error('Unsupported C64 save-state format.');
    }
    if (state.videoStandard !== this.timing.standard || state.systemClockHz !== this.timing.systemClockHz) {
      throw new Error(`Save state requires ${state.videoStandard.toUpperCase()} timing.`);
    }
    this.monitor.beginMachineReset();
    try {
      this.bus.restoreState(state.bus);
      this.cpu.restoreState(state.cpu);
      this.masterCycleCounter = Math.max(0, Math.trunc(state.masterCycleCounter));
      this.cpuStallCounter = Math.max(0, Math.trunc(state.cpuStallCounter));
      this.cia2IrqWasAsserted = state.cia2IrqWasAsserted;
      this.expansionNmiWasAsserted = state.expansionNmiWasAsserted;
      this.restorePressed = state.restorePressed;
      this.driveClockAccumulator = Math.max(0, state.driveClockAccumulator);
      // A 1541 can be in the middle of a 6502 micro-operation when the C64 is
      // at an instruction boundary. Reset its electronics rather than create
      // a false half-restored state; mounted disk/head position are preserved.
      this.drive1541.reset();
      this.syncInterruptLines();
      this.monitor.clearHistory();
    } finally {
      this.monitor.endMachineReset();
    }
  }

  get masterCycles(): number {
    return this.masterCycleCounter;
  }

  get cpuStallCycles(): number {
    return this.cpuStallCounter;
  }

  private advanceResetCycles(cycles: number): void {
    for (let i = 0; i < cycles; i += 1) {
      this.bus.io.tick(1);
      this.bus.tickDatasette(1);
      this.advance1541Clock();
      this.masterCycleCounter += 1;
      this.syncInterruptLines();
    }
  }


  private advance1541Clock(): void {
    this.driveClockAccumulator += C1541_CLOCK_HZ;
    while (this.driveClockAccumulator >= this.timing.systemClockHz) {
      this.drive1541.tick();
      this.driveClockAccumulator -= this.timing.systemClockHz;
    }
  }

  private writeWordToRam(address: number, value: number): void {
    this.bus.writePhysicalRam(address, value & 0xff);
    this.bus.writePhysicalRam(address + 1, (value >> 8) & 0xff);
  }

  private syncInterruptLines(): void {
    const cia1Irq = this.bus.io.cia1.irqAsserted;
    const vicIrq = this.bus.io.vic.irqAsserted;
    const expansionIrq = this.bus.expansion.irqAsserted;
    const maskableIrq = cia1Irq || vicIrq || expansionIrq;
    const cia2Irq = this.bus.io.cia2.irqAsserted;
    const expansionNmi = this.bus.expansion.nmiAsserted;
    const irqSources = [
      cia1Irq ? 'CIA1' : '',
      vicIrq ? 'VIC-II' : '',
      expansionIrq ? 'EXPANSION' : ''
    ].filter((source) => source !== '');

    this.monitor.observeIrq(maskableIrq, irqSources);
    this.cpu.setIrqLine(maskableIrq);

    if (cia2Irq && !this.cia2IrqWasAsserted) {
      this.cpu.pulseNmi();
      this.monitor.observeNmi('CIA2');
    }
    if (expansionNmi && !this.expansionNmiWasAsserted) {
      this.cpu.pulseNmi();
      this.monitor.observeNmi('EXPANSION');
    }

    this.cia2IrqWasAsserted = cia2Irq;
    this.expansionNmiWasAsserted = expansionNmi;
  }
}

function videoStandardForTiming(timing: VicTimingProfile): number {
  return timing.standard === 'ntsc' ? 1 : 0;
}

function isTimingProfile(value: C64MachineOptions | VicTimingProfile): value is VicTimingProfile {
  return 'cyclesPerLine' in value && 'linesPerFrame' in value && 'systemClockHz' in value;
}
