import type { MemoryMappedDevice } from '../io/Device';

export enum CiaInterrupt {
  TimerA = 0x01,
  TimerB = 0x02,
  Alarm = 0x04,
  Serial = 0x08,
  Flag = 0x10
}

type PortInputProvider = () => number;
type PortOutputChangeHandler = () => void;

const REGISTER_MASK = 0x0f;
const INTERRUPT_MASK = 0x1f;

export interface Cia6526State {
  readonly pra: number;
  readonly prb: number;
  readonly ddra: number;
  readonly ddrb: number;
  readonly timerALatch: number;
  readonly timerBLatch: number;
  readonly timerA: number;
  readonly timerB: number;
  readonly tod: Uint8Array;
  readonly alarm: Uint8Array;
  readonly todReadLatch: Uint8Array;
  readonly todLatched: boolean;
  readonly todRunning: boolean;
  readonly todInputDivider: number;
  readonly sdr: number;
  readonly serialShift: number;
  readonly serialBits: number;
  readonly interruptMask: number;
  readonly interruptFlags: number;
  readonly irq: boolean;
  readonly cra: number;
  readonly crb: number;
  readonly timerAOutput: boolean;
  readonly timerBOutput: boolean;
  readonly timerAPulse: boolean;
  readonly timerBPulse: boolean;
  readonly timerACount2: boolean;
  readonly timerACount3: boolean;
  readonly timerBCount2: boolean;
  readonly timerBCount3: boolean;
  readonly timerALoad1: boolean;
  readonly timerBLoad1: boolean;
  readonly timerAForceLoad: boolean;
  readonly timerBForceLoad: boolean;
  readonly timerAOneShot0: boolean;
  readonly timerBOneShot0: boolean;
  readonly irqPending: boolean;
  readonly cntRisePending: boolean;
  readonly cntHigh: boolean;
  readonly spHigh: boolean;
  readonly flagHigh: boolean;
}

/**
 * Functional MOS 6526 Complex Interface Adapter.
 *
 * v0.3 models the software-visible register file, both parallel ports, both
 * 16-bit interval timers, interrupt mask/data behavior, TOD/alarm clock,
 * negative-edge FLAG input, CNT-driven timer modes, and serial input shifting.
 * v0.14 adds the documented old-6526 timer count/load pipeline and delayed IRQ
 * latch behavior used by timing-sensitive C64 software. The remaining silicon
 * corner cases (notably the old-CIA Timer-B ICR race) stay explicitly deferred.
 */
export class Cia6526 implements MemoryMappedDevice {
  private pra = 0;
  private prb = 0;
  private ddra = 0;
  private ddrb = 0;

  private timerALatch = 0xffff;
  private timerBLatch = 0xffff;
  private timerA = 0xffff;
  private timerB = 0xffff;

  private readonly tod = new Uint8Array(4);
  private readonly alarm = new Uint8Array(4);
  private readonly todReadLatch = new Uint8Array(4);
  private todLatched = false;
  private todRunning = false;
  private todInputDivider = 0;

  private sdr = 0;
  private serialShift = 0;
  private serialBits = 0;

  private interruptMask = 0;
  private interruptFlags = 0;
  private irq = false;

  private cra = 0;
  private crb = 0;

  private timerAOutput = false;
  private timerBOutput = false;
  private timerAPulse = false;
  private timerBPulse = false;

  // The 6526 does not start/stop/decode timer clocks combinatorially. START,
  // CNT/PHI2 steps, force-load, and one-shot state move through short internal
  // pipelines. These stages reproduce the externally visible two-cycle START
  // delay and delayed force-load behavior documented by the classic CIA tests.
  private timerACount2 = false;
  private timerACount3 = false;
  private timerBCount2 = false;
  private timerBCount3 = false;
  private timerALoad1 = false;
  private timerBLoad1 = false;
  private timerAForceLoad = false;
  private timerBForceLoad = false;
  private timerAOneShot0 = false;
  private timerBOneShot0 = false;

  // Old 6526s latch the source bit first and assert the master IRQ indication
  // one PHI2 later. Once asserted, removing the IMR bit does not release IRQ;
  // reading ICR is the acknowledge operation that clears it.
  private irqPending = false;
  private cntRisePending = false;

  private cntHigh = true;
  private spHigh = true;
  private flagHigh = true;

  private portAInput: PortInputProvider = () => 0xff;
  private portBInput: PortInputProvider = () => 0xff;
  private portAOutputChange: PortOutputChangeHandler = () => {};

  constructor() {
    this.reset();
  }

  read(offset: number): number {
    const register = offset & REGISTER_MASK;

    switch (register) {
      case 0x00: return this.portAPins;
      case 0x01: return this.portBPins;
      case 0x02: return this.ddra;
      case 0x03: return this.ddrb;
      case 0x04: return this.timerA & 0xff;
      case 0x05: return (this.timerA >> 8) & 0xff;
      case 0x06: return this.timerB & 0xff;
      case 0x07: return (this.timerB >> 8) & 0xff;
      case 0x08: return this.readTodRegister(0, true);
      case 0x09: return this.readTodRegister(1, true);
      case 0x0a: return this.readTodRegister(2, true);
      case 0x0b: return this.readTodRegister(3, true);
      case 0x0c: return this.sdr;
      case 0x0d: return this.readInterruptData(true);
      case 0x0e: return this.cra;
      case 0x0f: return this.crb;
      default: throw new Error(`Unexpected CIA register: ${register}`);
    }
  }

  peek(offset: number): number {
    const register = offset & REGISTER_MASK;

    switch (register) {
      case 0x00: return this.portAPins;
      case 0x01: return this.portBPins;
      case 0x02: return this.ddra;
      case 0x03: return this.ddrb;
      case 0x04: return this.timerA & 0xff;
      case 0x05: return (this.timerA >> 8) & 0xff;
      case 0x06: return this.timerB & 0xff;
      case 0x07: return (this.timerB >> 8) & 0xff;
      case 0x08: return this.readTodRegister(0, false);
      case 0x09: return this.readTodRegister(1, false);
      case 0x0a: return this.readTodRegister(2, false);
      case 0x0b: return this.readTodRegister(3, false);
      case 0x0c: return this.sdr;
      case 0x0d: return this.readInterruptData(false);
      case 0x0e: return this.cra;
      case 0x0f: return this.crb;
      default: throw new Error(`Unexpected CIA register: ${register}`);
    }
  }

  write(offset: number, value: number): void {
    const register = offset & REGISTER_MASK;
    const byte = value & 0xff;

    switch (register) {
      case 0x00:
        this.pra = byte;
        break;
      case 0x01:
        this.prb = byte;
        break;
      case 0x02:
        this.ddra = byte;
        break;
      case 0x03:
        this.ddrb = byte;
        break;
      case 0x04:
        this.timerALatch = (this.timerALatch & 0xff00) | byte;
        break;
      case 0x05:
        this.timerALatch = ((byte << 8) | (this.timerALatch & 0x00ff)) & 0xffff;
        if (!this.timerAStarted) {
          this.timerA = this.timerALatch;
        }
        break;
      case 0x06:
        this.timerBLatch = (this.timerBLatch & 0xff00) | byte;
        break;
      case 0x07:
        this.timerBLatch = ((byte << 8) | (this.timerBLatch & 0x00ff)) & 0xffff;
        if (!this.timerBStarted) {
          this.timerB = this.timerBLatch;
        }
        break;
      case 0x08:
      case 0x09:
      case 0x0a:
      case 0x0b:
        this.writeTodRegister(register - 0x08, byte);
        break;
      case 0x0c:
        this.sdr = byte;
        break;
      case 0x0d:
        this.writeInterruptMask(byte);
        break;
      case 0x0e:
        this.writeControlA(byte);
        break;
      case 0x0f:
        this.writeControlB(byte);
        break;
      default:
        throw new Error(`Unexpected CIA register: ${register}`);
    }

    if (register === 0x00 || register === 0x02) {
      this.portAOutputChange();
    }
  }

  reset(): void {
    this.pra = 0;
    this.prb = 0;
    this.ddra = 0;
    this.ddrb = 0;

    this.timerALatch = 0xffff;
    this.timerBLatch = 0xffff;
    this.timerA = 0xffff;
    this.timerB = 0xffff;

    this.tod.fill(0);
    this.alarm.fill(0);
    this.todReadLatch.fill(0);
    this.todLatched = false;
    this.todRunning = false;
    this.todInputDivider = 0;

    this.sdr = 0;
    this.serialShift = 0;
    this.serialBits = 0;

    this.interruptMask = 0;
    this.interruptFlags = 0;
    this.irq = false;

    this.cra = 0;
    this.crb = 0;

    this.timerAOutput = false;
    this.timerBOutput = false;
    this.timerAPulse = false;
    this.timerBPulse = false;

    this.timerACount2 = false;
    this.timerACount3 = false;
    this.timerBCount2 = false;
    this.timerBCount3 = false;
    this.timerALoad1 = false;
    this.timerBLoad1 = false;
    this.timerAForceLoad = false;
    this.timerBForceLoad = false;
    this.timerAOneShot0 = false;
    this.timerBOneShot0 = false;

    this.irqPending = false;
    this.cntRisePending = false;

    // CNT is pulled high when nothing external drives it. Several C64 CIA
    // compatibility tests depend on Timer-B mode 3 seeing this reset level.
    this.cntHigh = true;
    this.spHigh = true;
    this.flagHigh = true;
    this.portAOutputChange();
  }

  saveState(): Cia6526State {
    return {
      pra: this.pra, prb: this.prb, ddra: this.ddra, ddrb: this.ddrb,
      timerALatch: this.timerALatch, timerBLatch: this.timerBLatch,
      timerA: this.timerA, timerB: this.timerB,
      tod: this.tod.slice(), alarm: this.alarm.slice(), todReadLatch: this.todReadLatch.slice(),
      todLatched: this.todLatched, todRunning: this.todRunning, todInputDivider: this.todInputDivider,
      sdr: this.sdr, serialShift: this.serialShift, serialBits: this.serialBits,
      interruptMask: this.interruptMask, interruptFlags: this.interruptFlags, irq: this.irq,
      cra: this.cra, crb: this.crb,
      timerAOutput: this.timerAOutput, timerBOutput: this.timerBOutput,
      timerAPulse: this.timerAPulse, timerBPulse: this.timerBPulse,
      timerACount2: this.timerACount2, timerACount3: this.timerACount3,
      timerBCount2: this.timerBCount2, timerBCount3: this.timerBCount3,
      timerALoad1: this.timerALoad1, timerBLoad1: this.timerBLoad1,
      timerAForceLoad: this.timerAForceLoad, timerBForceLoad: this.timerBForceLoad,
      timerAOneShot0: this.timerAOneShot0, timerBOneShot0: this.timerBOneShot0,
      irqPending: this.irqPending, cntRisePending: this.cntRisePending,
      cntHigh: this.cntHigh, spHigh: this.spHigh, flagHigh: this.flagHigh
    };
  }

  restoreState(state: Cia6526State): void {
    this.pra = state.pra & 0xff; this.prb = state.prb & 0xff;
    this.ddra = state.ddra & 0xff; this.ddrb = state.ddrb & 0xff;
    this.timerALatch = state.timerALatch & 0xffff; this.timerBLatch = state.timerBLatch & 0xffff;
    this.timerA = state.timerA & 0xffff; this.timerB = state.timerB & 0xffff;
    this.tod.set(state.tod.subarray(0, 4)); this.alarm.set(state.alarm.subarray(0, 4));
    this.todReadLatch.set(state.todReadLatch.subarray(0, 4));
    this.todLatched = state.todLatched; this.todRunning = state.todRunning;
    this.todInputDivider = Math.max(0, Math.trunc(state.todInputDivider));
    this.sdr = state.sdr & 0xff; this.serialShift = state.serialShift & 0xff;
    this.serialBits = Math.max(0, Math.trunc(state.serialBits));
    this.interruptMask = state.interruptMask & INTERRUPT_MASK;
    this.interruptFlags = state.interruptFlags & INTERRUPT_MASK; this.irq = state.irq;
    this.cra = state.cra & 0xef; this.crb = state.crb & 0xef;
    this.timerAOutput = state.timerAOutput; this.timerBOutput = state.timerBOutput;
    this.timerAPulse = state.timerAPulse; this.timerBPulse = state.timerBPulse;
    this.timerACount2 = state.timerACount2; this.timerACount3 = state.timerACount3;
    this.timerBCount2 = state.timerBCount2; this.timerBCount3 = state.timerBCount3;
    this.timerALoad1 = state.timerALoad1; this.timerBLoad1 = state.timerBLoad1;
    this.timerAForceLoad = state.timerAForceLoad; this.timerBForceLoad = state.timerBForceLoad;
    this.timerAOneShot0 = state.timerAOneShot0; this.timerBOneShot0 = state.timerBOneShot0;
    this.irqPending = state.irqPending; this.cntRisePending = state.cntRisePending;
    this.cntHigh = state.cntHigh; this.spHigh = state.spHigh; this.flagHigh = state.flagHigh;
    this.portAOutputChange();
  }

  /** Advance one or more PHI2 cycles. */
  tick(cycles = 1): void {
    if (!Number.isInteger(cycles) || cycles < 0) {
      throw new RangeError(`CIA cycle count must be a non-negative integer; received ${cycles}.`);
    }

    for (let cycle = 0; cycle < cycles; cycle += 1) {
      this.endTimerOutputPulses();
      this.promotePendingIrq();

      const cntRise = this.cntRisePending;
      this.cntRisePending = false;
      const timerAUnderflow = this.clockTimerA(cntRise);
      this.clockTimerB(cntRise, timerAUnderflow);
    }
  }

  /** External CNT pin level. Positive edges feed configured timer/serial modes. */
  setCntLine(high: boolean): void {
    const rising = !this.cntHigh && high;
    this.cntHigh = high;

    if (!rising) {
      return;
    }

    // Timer steps are synchronized through the same internal pipeline as PHI2
    // clocks. Preserve the edge until the next CIA tick instead of changing a
    // counter directly from this asynchronous pin setter.
    this.cntRisePending = true;

    if (!this.serialOutputMode) {
      this.serialShift = ((this.serialShift << 1) | (this.spHigh ? 1 : 0)) & 0xff;
      this.serialBits += 1;
      if (this.serialBits === 8) {
        this.sdr = this.serialShift;
        this.serialBits = 0;
        this.serialShift = 0;
        this.raiseInterrupt(CiaInterrupt.Serial);
      }
    }
  }

  setSpLine(high: boolean): void {
    this.spHigh = high;
  }

  /** FLAG is active low and latches an interrupt on a high-to-low transition. */
  setFlagLine(high: boolean): void {
    if (this.flagHigh && !high) {
      this.raiseInterrupt(CiaInterrupt.Flag);
    }
    this.flagHigh = high;
  }

  /**
   * Supply one external TOD input pulse. CRA bit 7 selects whether five (50 Hz)
   * or six (60 Hz) pulses constitute one tenth of a second.
   */
  pulseTod(): void {
    if (!this.todRunning) {
      return;
    }

    this.todInputDivider += 1;
    const pulsesPerTenth = (this.cra & 0x80) !== 0 ? 5 : 6;
    if (this.todInputDivider < pulsesPerTenth) {
      return;
    }

    this.todInputDivider = 0;
    this.incrementTod();

    if (this.todMatchesAlarm()) {
      this.raiseInterrupt(CiaInterrupt.Alarm);
    }
  }

  setPortAInputProvider(provider: PortInputProvider): void {
    this.portAInput = provider;
  }

  setPortBInputProvider(provider: PortInputProvider): void {
    this.portBInput = provider;
  }

  setPortAOutputChangeHandler(handler: PortOutputChangeHandler): void {
    this.portAOutputChange = handler;
    handler();
  }

  get irqAsserted(): boolean {
    return this.irq;
  }

  get portADataRegister(): number {
    return this.pra;
  }

  get portBDataRegister(): number {
    return this.prb;
  }

  get dataDirectionA(): number {
    return this.ddra;
  }

  get dataDirectionB(): number {
    return this.ddrb;
  }

  get portAPins(): number {
    const external = this.portAInput() & 0xff;
    return ((this.pra & this.ddra) | (external & ~this.ddra)) & 0xff;
  }

  get portBPins(): number {
    const external = this.portBInput() & 0xff;
    let value = ((this.prb & this.ddrb) | (external & ~this.ddrb)) & 0xff;

    if ((this.cra & 0x02) !== 0) {
      value = setBit(value, 6, this.timerAOutput);
    }
    if ((this.crb & 0x02) !== 0) {
      value = setBit(value, 7, this.timerBOutput);
    }

    return value;
  }

  /** Bits that are actually configured as outputs and currently driven low. */
  get portAOutputLowMask(): number {
    return (~this.pra & this.ddra) & 0xff;
  }

  get portBOutputLowMask(): number {
    let mask = (~this.prb & this.ddrb) & 0xff;
    if ((this.cra & 0x02) !== 0) {
      mask = setBit(mask, 6, !this.timerAOutput);
    }
    if ((this.crb & 0x02) !== 0) {
      mask = setBit(mask, 7, !this.timerBOutput);
    }
    return mask;
  }

  get timerACounter(): number {
    return this.timerA;
  }

  get timerBCounter(): number {
    return this.timerB;
  }

  get timerALatchValue(): number {
    return this.timerALatch;
  }

  get timerBLatchValue(): number {
    return this.timerBLatch;
  }

  get interruptMaskValue(): number {
    return this.interruptMask;
  }

  get interruptFlagsValue(): number {
    return this.interruptFlags;
  }

  get controlA(): number {
    return this.cra;
  }

  get controlB(): number {
    return this.crb;
  }

  private get timerAStarted(): boolean {
    return (this.cra & 0x01) !== 0;
  }

  private get timerBStarted(): boolean {
    return (this.crb & 0x01) !== 0;
  }

  private get timerACountsCnt(): boolean {
    return (this.cra & 0x20) !== 0;
  }

  private get timerBInputMode(): number {
    return (this.crb >> 5) & 0x03;
  }

  private get serialOutputMode(): boolean {
    return (this.cra & 0x40) !== 0;
  }

  private clockTimerA(cntRise: boolean): boolean {
    if (this.timerACount3 && this.timerA !== 0) {
      this.timerA = (this.timerA - 1) & 0xffff;
    }

    const nextCount2 = this.timerAStarted && !this.timerACountsCnt;
    let nextCount3 = this.timerACount2 || (this.timerAStarted && this.timerACountsCnt && cntRise);
    const loadNow = this.timerALoad1;
    const nextLoad1 = this.timerAForceLoad;
    const nextOneShot0 = (this.cra & 0x08) !== 0;
    const nextOneShot = this.timerAOneShot0;
    this.timerAForceLoad = false;

    let underflow = false;
    if (this.timerA === 0 && nextCount3) {
      underflow = true;
      this.raiseInterrupt(CiaInterrupt.TimerA);
      this.updateTimerOutput('A');
    }

    if (loadNow || underflow) {
      this.timerA = this.timerALatch;
      // A reload consumes the count clock that caused it.
      nextCount3 = false;
    }

    if (underflow && (nextOneShot0 || nextOneShot)) {
      this.cra &= ~0x01;
    }

    this.timerACount2 = underflow && (nextOneShot0 || nextOneShot) ? false : nextCount2;
    this.timerACount3 = nextCount3;
    this.timerALoad1 = nextLoad1;
    this.timerAOneShot0 = nextOneShot0;
    return underflow;
  }

  private clockTimerB(cntRise: boolean, timerAUnderflow: boolean): boolean {
    if (this.timerBCount3 && this.timerB !== 0) {
      this.timerB = (this.timerB - 1) & 0xffff;
    }

    const mode = this.timerBInputMode;
    const nextCount2 = this.timerBStarted && mode === 0;
    const step = mode === 1
      ? cntRise
      : mode === 2
        ? timerAUnderflow
        : mode === 3
          ? timerAUnderflow && this.cntHigh
          : false;
    let nextCount3 = this.timerBCount2 || (this.timerBStarted && step);
    const loadNow = this.timerBLoad1;
    const nextLoad1 = this.timerBForceLoad;
    const nextOneShot0 = (this.crb & 0x08) !== 0;
    const nextOneShot = this.timerBOneShot0;
    this.timerBForceLoad = false;

    let underflow = false;
    if (this.timerB === 0 && nextCount3) {
      underflow = true;
      this.raiseInterrupt(CiaInterrupt.TimerB);
      this.updateTimerOutput('B');
    }

    if (loadNow || underflow) {
      this.timerB = this.timerBLatch;
      nextCount3 = false;
    }

    if (underflow && (nextOneShot0 || nextOneShot)) {
      this.crb &= ~0x01;
    }

    this.timerBCount2 = underflow && (nextOneShot0 || nextOneShot) ? false : nextCount2;
    this.timerBCount3 = nextCount3;
    this.timerBLoad1 = nextLoad1;
    this.timerBOneShot0 = nextOneShot0;
    return underflow;
  }

  private updateTimerOutput(timer: 'A' | 'B'): void {
    const control = timer === 'A' ? this.cra : this.crb;
    const toggleMode = (control & 0x04) !== 0;

    if (timer === 'A') {
      if (toggleMode) {
        this.timerAOutput = !this.timerAOutput;
      } else {
        this.timerAOutput = true;
        this.timerAPulse = true;
      }
    } else if (toggleMode) {
      this.timerBOutput = !this.timerBOutput;
    } else {
      this.timerBOutput = true;
      this.timerBPulse = true;
    }
  }

  private endTimerOutputPulses(): void {
    if (this.timerAPulse) {
      this.timerAOutput = false;
      this.timerAPulse = false;
    }
    if (this.timerBPulse) {
      this.timerBOutput = false;
      this.timerBPulse = false;
    }
  }

  private writeControlA(value: number): void {
    const wasStarted = this.timerAStarted;
    const forceLoad = (value & 0x10) !== 0;
    this.cra = value & 0xef;

    if (forceLoad) {
      this.timerAForceLoad = true;
    }

    if (!wasStarted && this.timerAStarted && (this.cra & 0x04) !== 0) {
      this.timerAOutput = true;
    }
  }

  private writeControlB(value: number): void {
    const wasStarted = this.timerBStarted;
    const forceLoad = (value & 0x10) !== 0;
    this.crb = value & 0xef;

    if (forceLoad) {
      this.timerBForceLoad = true;
    }

    if (!wasStarted && this.timerBStarted && (this.crb & 0x04) !== 0) {
      this.timerBOutput = true;
    }
  }

  private writeInterruptMask(value: number): void {
    const bits = value & INTERRUPT_MASK;
    if ((value & 0x80) !== 0) {
      this.interruptMask |= bits;
    } else {
      this.interruptMask &= ~bits;
    }
    this.interruptMask &= INTERRUPT_MASK;
    if ((this.interruptFlags & this.interruptMask & INTERRUPT_MASK) !== 0) {
      this.irqPending = true;
    }
  }

  private readInterruptData(clear: boolean): number {
    const value = (this.interruptFlags & INTERRUPT_MASK) | (this.irq ? 0x80 : 0);
    if (clear) {
      this.interruptFlags = 0;
      this.irq = false;
      this.irqPending = false;
    }
    return value;
  }

  private raiseInterrupt(source: CiaInterrupt): void {
    this.interruptFlags |= source;
    this.interruptFlags &= INTERRUPT_MASK;
    if ((this.interruptFlags & this.interruptMask & INTERRUPT_MASK) !== 0) {
      this.irqPending = true;
    }
  }

  private promotePendingIrq(): void {
    if (!this.irqPending) {
      return;
    }
    this.irqPending = false;
    this.irq = true;
  }

  private readTodRegister(index: number, sideEffects: boolean): number {
    if (sideEffects && index === 3 && !this.todLatched) {
      this.todReadLatch.set(this.tod);
      this.todLatched = true;
    }

    const source = this.todLatched ? this.todReadLatch : this.tod;
    const value = source[index] ?? 0;

    if (sideEffects && index === 0 && this.todLatched) {
      this.todLatched = false;
    }

    return value;
  }

  private writeTodRegister(index: number, value: number): void {
    const target = (this.crb & 0x80) !== 0 ? this.alarm : this.tod;
    target[index] = sanitizeTodRegister(index, value);

    if (target === this.alarm) {
      return;
    }

    if (index === 3) {
      this.todRunning = false;
      this.todInputDivider = 0;
    } else if (index === 0) {
      this.todRunning = true;
      this.todInputDivider = 0;
    }
  }

  private incrementTod(): void {
    const tenths = (this.tod[0] ?? 0) & 0x0f;
    if (tenths < 9) {
      this.tod[0] = tenths + 1;
      return;
    }

    this.tod[0] = 0;
    if (incrementBcd60(this.tod, 1)) {
      return;
    }
    if (incrementBcd60(this.tod, 2)) {
      return;
    }

    const hourByte = this.tod[3] ?? 0;
    const pm = (hourByte & 0x80) !== 0;
    const hour = bcdToInt(hourByte & 0x1f);

    if (hour === 11) {
      this.tod[3] = intToBcd(12) | (pm ? 0 : 0x80);
    } else if (hour === 12) {
      this.tod[3] = intToBcd(1) | (pm ? 0x80 : 0);
    } else {
      const next = hour >= 1 && hour < 11 ? hour + 1 : 1;
      this.tod[3] = intToBcd(next) | (pm ? 0x80 : 0);
    }
  }

  private todMatchesAlarm(): boolean {
    for (let index = 0; index < 4; index += 1) {
      if (this.tod[index] !== this.alarm[index]) {
        return false;
      }
    }
    return true;
  }
}

function incrementBcd60(registers: Uint8Array, index: number): boolean {
  const current = bcdToInt(registers[index] ?? 0);
  if (current < 59) {
    registers[index] = intToBcd(current + 1);
    return true;
  }
  registers[index] = 0;
  return false;
}

function bcdToInt(value: number): number {
  return ((value >> 4) & 0x0f) * 10 + (value & 0x0f);
}

function intToBcd(value: number): number {
  return ((((Math.floor(value / 10)) % 10) << 4) | (value % 10)) & 0xff;
}

function sanitizeTodRegister(index: number, value: number): number {
  switch (index) {
    case 0: return value & 0x0f;
    case 1:
    case 2: return value & 0x7f;
    case 3: return value & 0x9f;
    default: return 0;
  }
}

function setBit(value: number, bit: number, enabled: boolean): number {
  return enabled ? (value | (1 << bit)) & 0xff : (value & ~(1 << bit)) & 0xff;
}
