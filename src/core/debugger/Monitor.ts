import { Flag } from '../cpu/Flags';
import { Disassembler } from './Disassembler';
import type { Cpu6510 } from '../cpu/Cpu6510';
import type { CpuSnapshot } from '../cpu/types';
import type { C64Bus, C64BusAccess } from '../memory/C64Bus';

export type WatchpointMode = 'read' | 'write' | 'readwrite';
export type MemoryView = 'mapped' | 'ram';

export interface AddressBreakpoint {
  id: number;
  address: number;
  enabled: boolean;
}

export interface Watchpoint {
  id: number;
  startAddress: number;
  endAddress: number;
  mode: WatchpointMode;
  enabled: boolean;
}

export interface RasterBreakpoint {
  id: number;
  rasterLine: number;
  rasterCycle: number | null;
  enabled: boolean;
}

export type MonitorStopReason =
  | { type: 'manual'; message: string }
  | { type: 'address'; breakpointId: number; address: number }
  | { type: 'watchpoint'; watchpointId: number; access: MonitorBusTraceEntry }
  | { type: 'raster'; breakpointId: number; rasterLine: number; rasterCycle: number };

export interface MonitorExecutionEntry extends CpuSnapshot {
  masterCycle: number;
  frame: number;
  rasterLine: number;
  rasterCycle: number;
  instruction: string;
}

export interface MonitorBusTraceEntry extends C64BusAccess {
  masterCycle: number;
  frame: number;
  rasterLine: number;
  rasterCycle: number;
}

export interface MonitorInterruptEntry {
  kind: 'IRQ' | 'NMI';
  asserted: boolean;
  sources: readonly string[];
  masterCycle: number;
  frame: number;
  rasterLine: number;
  rasterCycle: number;
  pc: number;
}

export interface MonitorVicSnapshot {
  frame: number;
  rasterLine: number;
  rasterCycle: number;
  rasterCompare: number;
  irqAsserted: boolean;
  baHigh: boolean;
  aecHigh: boolean;
  badLine: boolean;
  graphicsMode: number;
  screenAddress: number;
  characterAddress: number;
  bitmapAddress: number;
  borderColor: number;
  backgroundColor: number;
}

export interface MonitorCiaSnapshot {
  timerA: number;
  timerB: number;
  timerALatch: number;
  timerBLatch: number;
  interruptMask: number;
  interruptFlags: number;
  irqAsserted: boolean;
  controlA: number;
  controlB: number;
  portA: number;
  portB: number;
  ddra: number;
  ddrb: number;
}

export interface MonitorHardwareSnapshot {
  cpu: CpuSnapshot;
  masterCycle: number;
  cpuStallCycles: number;
  vic: MonitorVicSnapshot;
  cia1: MonitorCiaSnapshot;
  cia2: MonitorCiaSnapshot;
  sid: ReturnType<C64Bus['io']['sid']['snapshot']>;
  processorPort: {
    ddr: number;
    latch: number;
    pins: number;
  };
}

export interface ScreenMemorySnapshot {
  address: number;
  characters: Uint8Array;
  colors: Uint8Array;
}

interface MonitorClockSource {
  masterCycles: () => number;
  cpuStallCycles: () => number;
}

const DEFAULT_HISTORY_LIMIT = 256;
const DEFAULT_BUS_TRACE_LIMIT = 512;
const DEFAULT_INTERRUPT_HISTORY_LIMIT = 128;

/**
 * Side-effect-free debugger/monitor state for one C64 machine.
 *
 * Breakpoints are checked only at safe instruction boundaries. Watchpoints and
 * raster breakpoints latch at the exact bus/raster cycle that triggered them,
 * then execution pauses after the current instruction finishes so register and
 * memory edits never occur in the middle of a scheduled 6510 micro-operation.
 */
export class C64Monitor {
  private readonly addressBreakpointsValue = new Map<number, AddressBreakpoint>();
  private readonly watchpointsValue = new Map<number, Watchpoint>();
  private readonly rasterBreakpointsValue = new Map<number, RasterBreakpoint>();
  private readonly executionHistoryValue: MonitorExecutionEntry[] = [];
  private readonly busTraceValue: MonitorBusTraceEntry[] = [];
  private readonly interruptHistoryValue: MonitorInterruptEntry[] = [];

  private nextBreakpointId = 1;
  private stopReasonValue: MonitorStopReason | null = null;
  private ignoreAddressOnce: number | null = null;
  private observationSuppressed = false;
  private lastIrqAsserted = false;
  private readonly rasterMatches = new Set<number>();
  private readonly disassembler: Disassembler;

  constructor(
    private readonly cpu: Cpu6510,
    private readonly bus: C64Bus,
    private readonly clocks: MonitorClockSource,
    private readonly historyLimit = DEFAULT_HISTORY_LIMIT,
    private readonly busTraceLimit = DEFAULT_BUS_TRACE_LIMIT,
    private readonly interruptHistoryLimit = DEFAULT_INTERRUPT_HISTORY_LIMIT
  ) {
    if (historyLimit < 1 || busTraceLimit < 1 || interruptHistoryLimit < 1) {
      throw new RangeError('Monitor history limits must be positive.');
    }
    this.disassembler = new Disassembler(bus);
  }

  get stopReason(): MonitorStopReason | null {
    return this.stopReasonValue;
  }

  get paused(): boolean {
    return this.stopReasonValue !== null;
  }

  get addressBreakpoints(): readonly AddressBreakpoint[] {
    return Array.from(this.addressBreakpointsValue.values());
  }

  get watchpoints(): readonly Watchpoint[] {
    return Array.from(this.watchpointsValue.values());
  }

  get rasterBreakpoints(): readonly RasterBreakpoint[] {
    return Array.from(this.rasterBreakpointsValue.values());
  }

  get executionHistory(): readonly MonitorExecutionEntry[] {
    return this.executionHistoryValue;
  }

  get busTrace(): readonly MonitorBusTraceEntry[] {
    return this.busTraceValue;
  }

  get interruptHistory(): readonly MonitorInterruptEntry[] {
    return this.interruptHistoryValue;
  }

  addAddressBreakpoint(address: number): AddressBreakpoint {
    const normalized = address & 0xffff;
    const existing = Array.from(this.addressBreakpointsValue.values())
      .find((breakpoint) => breakpoint.address === normalized);
    if (existing !== undefined) return existing;

    const breakpoint: AddressBreakpoint = {
      id: this.nextBreakpointId++,
      address: normalized,
      enabled: true
    };
    this.addressBreakpointsValue.set(breakpoint.id, breakpoint);
    return breakpoint;
  }

  addWatchpoint(startAddress: number, mode: WatchpointMode = 'readwrite', endAddress = startAddress): Watchpoint {
    const start = startAddress & 0xffff;
    const end = endAddress & 0xffff;
    if (end < start) {
      throw new RangeError('Watchpoint end address must be greater than or equal to its start address.');
    }

    const watchpoint: Watchpoint = {
      id: this.nextBreakpointId++,
      startAddress: start,
      endAddress: end,
      mode,
      enabled: true
    };
    this.watchpointsValue.set(watchpoint.id, watchpoint);
    return watchpoint;
  }

  addRasterBreakpoint(rasterLine: number, rasterCycle: number | null = null): RasterBreakpoint {
    const line = Math.trunc(rasterLine);
    const cycle = rasterCycle === null ? null : Math.trunc(rasterCycle);
    if (line < 0 || line >= this.bus.io.vic.timing.linesPerFrame) {
      throw new RangeError(`Raster line must be 0-${this.bus.io.vic.timing.linesPerFrame - 1}.`);
    }
    if (cycle !== null && (cycle < 1 || cycle > this.bus.io.vic.timing.cyclesPerLine)) {
      throw new RangeError(`Raster cycle must be 1-${this.bus.io.vic.timing.cyclesPerLine}.`);
    }

    const breakpoint: RasterBreakpoint = {
      id: this.nextBreakpointId++,
      rasterLine: line,
      rasterCycle: cycle,
      enabled: true
    };
    this.rasterBreakpointsValue.set(breakpoint.id, breakpoint);
    return breakpoint;
  }

  removeBreakpoint(id: number): boolean {
    return this.addressBreakpointsValue.delete(id)
      || this.watchpointsValue.delete(id)
      || this.rasterBreakpointsValue.delete(id);
  }

  clearBreakpoints(): void {
    this.addressBreakpointsValue.clear();
    this.watchpointsValue.clear();
    this.rasterBreakpointsValue.clear();
    this.stopReasonValue = null;
    this.ignoreAddressOnce = null;
  }

  setBreakpointEnabled(id: number, enabled: boolean): boolean {
    const breakpoint = this.addressBreakpointsValue.get(id)
      ?? this.watchpointsValue.get(id)
      ?? this.rasterBreakpointsValue.get(id);
    if (breakpoint === undefined) return false;
    breakpoint.enabled = enabled;
    return true;
  }

  pause(message = 'Paused by debugger.'): void {
    this.stopReasonValue = { type: 'manual', message };
  }

  /**
   * Resume execution. If stopped on the current PC address breakpoint, that
   * address is ignored exactly once so Continue can make forward progress.
   */
  resume(): void {
    if (this.stopReasonValue?.type === 'address' && this.stopReasonValue.address === this.cpu.pc) {
      this.ignoreAddressOnce = this.cpu.pc;
    }
    this.stopReasonValue = null;
  }

  shouldPauseBeforeInstruction(): boolean {
    if (this.stopReasonValue !== null) return true;

    const pc = this.cpu.pc & 0xffff;
    if (this.ignoreAddressOnce === pc) {
      this.ignoreAddressOnce = null;
      return false;
    }

    for (const breakpoint of this.addressBreakpointsValue.values()) {
      if (breakpoint.enabled && breakpoint.address === pc) {
        this.stopReasonValue = {
          type: 'address',
          breakpointId: breakpoint.id,
          address: pc
        };
        return true;
      }
    }
    return false;
  }

  recordInstructionBoundary(): void {
    if (this.observationSuppressed) return;
    const vic = this.bus.io.vic;
    const snapshot = this.cpu.snapshot();
    this.executionHistoryValue.push({
      ...snapshot,
      masterCycle: this.clocks.masterCycles(),
      frame: vic.frameNumber,
      rasterLine: vic.rasterLine,
      rasterCycle: vic.rasterCycle,
      instruction: this.disassembler.disassemble(snapshot.pc).text
    });
    trimFront(this.executionHistoryValue, this.historyLimit);
  }

  observeBusAccess(access: C64BusAccess): void {
    if (this.observationSuppressed) return;
    const vic = this.bus.io.vic;
    const trace: MonitorBusTraceEntry = {
      ...access,
      masterCycle: this.clocks.masterCycles(),
      frame: vic.frameNumber,
      rasterLine: vic.rasterLine,
      rasterCycle: vic.rasterCycle
    };
    this.busTraceValue.push(trace);
    trimFront(this.busTraceValue, this.busTraceLimit);

    if (this.stopReasonValue !== null) return;
    for (const watchpoint of this.watchpointsValue.values()) {
      if (!watchpoint.enabled || access.source !== 'cpu' || access.address < watchpoint.startAddress || access.address > watchpoint.endAddress) {
        continue;
      }
      const matchesMode = watchpoint.mode === 'readwrite' || watchpoint.mode === access.kind;
      if (matchesMode) {
        this.stopReasonValue = {
          type: 'watchpoint',
          watchpointId: watchpoint.id,
          access: trace
        };
        break;
      }
    }
  }

  observeRasterPosition(): void {
    if (this.observationSuppressed || this.stopReasonValue !== null) return;
    const vic = this.bus.io.vic;
    for (const breakpoint of this.rasterBreakpointsValue.values()) {
      const matches = breakpoint.enabled
        && breakpoint.rasterLine === vic.rasterLine
        && (breakpoint.rasterCycle === null || breakpoint.rasterCycle === vic.rasterCycle);
      if (!matches) {
        this.rasterMatches.delete(breakpoint.id);
        continue;
      }
      if (this.rasterMatches.has(breakpoint.id)) continue;
      this.rasterMatches.add(breakpoint.id);
      this.stopReasonValue = {
        type: 'raster',
        breakpointId: breakpoint.id,
        rasterLine: vic.rasterLine,
        rasterCycle: vic.rasterCycle
      };
      break;
    }
  }

  observeIrq(asserted: boolean, sources: readonly string[]): void {
    if (this.observationSuppressed || asserted === this.lastIrqAsserted) return;
    this.lastIrqAsserted = asserted;
    this.pushInterrupt('IRQ', asserted, sources);
  }

  observeNmi(source: string): void {
    if (this.observationSuppressed) return;
    this.pushInterrupt('NMI', true, [source]);
  }

  beginMachineReset(): void {
    this.observationSuppressed = true;
    this.stopReasonValue = null;
    this.ignoreAddressOnce = null;
    this.executionHistoryValue.length = 0;
    this.busTraceValue.length = 0;
    this.interruptHistoryValue.length = 0;
    this.lastIrqAsserted = false;
    this.rasterMatches.clear();
  }

  endMachineReset(): void {
    this.observationSuppressed = false;
  }

  clearHistory(): void {
    this.executionHistoryValue.length = 0;
    this.busTraceValue.length = 0;
    this.interruptHistoryValue.length = 0;
  }

  readMemory(address: number, length: number, view: MemoryView = 'mapped'): Uint8Array {
    const count = Math.max(0, Math.trunc(length));
    if (count > 0x10000) throw new RangeError('Memory read length cannot exceed 65536 bytes.');
    const result = new Uint8Array(count);
    for (let i = 0; i < count; i += 1) {
      const current = (address + i) & 0xffff;
      result[i] = view === 'ram' ? this.bus.readPhysicalRam(current) : this.bus.peek(current);
    }
    return result;
  }

  writeMemory(address: number, value: number, view: MemoryView = 'ram'): void {
    this.requireInstructionBoundary();
    if (view === 'ram') {
      this.bus.writePhysicalRam(address, value);
    } else {
      this.bus.write(address, value);
    }
  }

  setCpuRegisters(registers: Partial<Omit<CpuSnapshot, 'cycles'>>): void {
    this.requireInstructionBoundary();
    if (registers.a !== undefined) this.cpu.a = registers.a & 0xff;
    if (registers.x !== undefined) this.cpu.x = registers.x & 0xff;
    if (registers.y !== undefined) this.cpu.y = registers.y & 0xff;
    if (registers.sp !== undefined) this.cpu.sp = registers.sp & 0xff;
    if (registers.status !== undefined) this.cpu.status = (registers.status | Flag.Unused) & 0xff;
    if (registers.pc !== undefined) this.cpu.setProgramCounter(registers.pc);
  }

  hardwareSnapshot(): MonitorHardwareSnapshot {
    const vic = this.bus.io.vic;
    const cia1 = this.bus.io.cia1;
    const cia2 = this.bus.io.cia2;
    return {
      cpu: this.cpu.snapshot(),
      masterCycle: this.clocks.masterCycles(),
      cpuStallCycles: this.clocks.cpuStallCycles(),
      vic: {
        frame: vic.frameNumber,
        rasterLine: vic.rasterLine,
        rasterCycle: vic.rasterCycle,
        rasterCompare: vic.rasterCompare,
        irqAsserted: vic.irqAsserted,
        baHigh: vic.baHigh,
        aecHigh: vic.aecHigh,
        badLine: vic.badLine,
        graphicsMode: vic.graphicsMode,
        screenAddress: (this.bus.vicBankBase + vic.screenMemoryOffset) & 0xffff,
        characterAddress: (this.bus.vicBankBase + vic.characterMemoryOffset) & 0xffff,
        bitmapAddress: (this.bus.vicBankBase + vic.bitmapMemoryOffset) & 0xffff,
        borderColor: vic.borderColor,
        backgroundColor: vic.backgroundColor
      },
      cia1: ciaSnapshot(cia1),
      cia2: ciaSnapshot(cia2),
      sid: this.bus.io.sid.snapshot(),
      processorPort: {
        ddr: this.bus.processorPortDataDirection,
        latch: this.bus.processorPortDataLatch,
        pins: this.bus.processorPortPins
      }
    };
  }

  screenMemorySnapshot(): ScreenMemorySnapshot {
    const vic = this.bus.io.vic;
    const address = (this.bus.vicBankBase + vic.screenMemoryOffset) & 0xffff;
    const characters = new Uint8Array(1000);
    const colors = new Uint8Array(1000);
    for (let i = 0; i < 1000; i += 1) {
      characters[i] = this.bus.readPhysicalRam((address + i) & 0xffff);
      colors[i] = this.bus.io.colorRam.memory[i] ?? 0;
    }
    return { address, characters, colors };
  }

  private pushInterrupt(kind: 'IRQ' | 'NMI', asserted: boolean, sources: readonly string[]): void {
    const vic = this.bus.io.vic;
    this.interruptHistoryValue.push({
      kind,
      asserted,
      sources: [...sources],
      masterCycle: this.clocks.masterCycles(),
      frame: vic.frameNumber,
      rasterLine: vic.rasterLine,
      rasterCycle: vic.rasterCycle,
      pc: this.cpu.pc & 0xffff
    });
    trimFront(this.interruptHistoryValue, this.interruptHistoryLimit);
  }

  private requireInstructionBoundary(): void {
    if (this.cpu.instructionInProgress) {
      throw new Error('Debugger edits are only allowed at a 6510 instruction boundary.');
    }
  }
}

function ciaSnapshot(cia: C64Bus['io']['cia1']): MonitorCiaSnapshot {
  return {
    timerA: cia.timerACounter,
    timerB: cia.timerBCounter,
    timerALatch: cia.timerALatchValue,
    timerBLatch: cia.timerBLatchValue,
    interruptMask: cia.interruptMaskValue,
    interruptFlags: cia.interruptFlagsValue,
    irqAsserted: cia.irqAsserted,
    controlA: cia.controlA,
    controlB: cia.controlB,
    portA: cia.portADataRegister,
    portB: cia.portBDataRegister,
    ddra: cia.dataDirectionA,
    ddrb: cia.dataDirectionB
  };
}

function trimFront<T>(items: T[], limit: number): void {
  const extra = items.length - limit;
  if (extra > 0) items.splice(0, extra);
}
