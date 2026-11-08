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

/**
 * Functional MOS 6526 Complex Interface Adapter.
 *
 * v0.3 models the software-visible register file, both parallel ports, both
 * 16-bit interval timers, interrupt mask/data behavior, TOD/alarm clock,
 * negative-edge FLAG input, CNT-driven timer modes, and serial input shifting.
 * Timing advances in explicit PHI2 cycles, but known transistor-level CIA
 * interrupt/timer pipeline quirks are intentionally deferred to a later
 * cycle-exact compatibility phase.
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

  private cntHigh = false;
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

    this.cntHigh = false;
    this.spHigh = true;
    this.flagHigh = true;
    this.portAOutputChange();
  }

  /** Advance one or more PHI2 cycles. */
  tick(cycles = 1): void {
    if (!Number.isInteger(cycles) || cycles < 0) {
      throw new RangeError(`CIA cycle count must be a non-negative integer; received ${cycles}.`);
    }

    for (let cycle = 0; cycle < cycles; cycle += 1) {
      this.endTimerOutputPulses();

      let timerAUnderflow = false;
      if (this.timerAStarted && !this.timerACountsCnt) {
        timerAUnderflow = this.clockTimerA();
      }

      if (this.timerBStarted) {
        const mode = this.timerBInputMode;
        if (mode === 0) {
          this.clockTimerB();
        } else if (mode >= 2 && timerAUnderflow && (mode === 2 || this.cntHigh)) {
          this.clockTimerB();
        }
      }
    }
  }

  /** External CNT pin level. Positive edges feed configured timer/serial modes. */
  setCntLine(high: boolean): void {
    const rising = !this.cntHigh && high;
    this.cntHigh = high;

    if (!rising) {
      return;
    }

    let timerAUnderflow = false;
    if (this.timerAStarted && this.timerACountsCnt) {
      timerAUnderflow = this.clockTimerA();
    }

    if (this.timerBStarted) {
      const mode = this.timerBInputMode;
      if (mode === 1) {
        this.clockTimerB();
      } else if (mode >= 2 && timerAUnderflow && (mode === 2 || this.cntHigh)) {
        this.clockTimerB();
      }
    }

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

  private clockTimerA(): boolean {
    if (this.timerA !== 0) {
      this.timerA = (this.timerA - 1) & 0xffff;
      return false;
    }

    this.timerA = this.timerALatch;
    this.raiseInterrupt(CiaInterrupt.TimerA);
    this.updateTimerOutput('A');

    if ((this.cra & 0x08) !== 0) {
      this.cra &= ~0x01;
    }

    return true;
  }

  private clockTimerB(): boolean {
    if (this.timerB !== 0) {
      this.timerB = (this.timerB - 1) & 0xffff;
      return false;
    }

    this.timerB = this.timerBLatch;
    this.raiseInterrupt(CiaInterrupt.TimerB);
    this.updateTimerOutput('B');

    if ((this.crb & 0x08) !== 0) {
      this.crb &= ~0x01;
    }

    return true;
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
      this.timerA = this.timerALatch;
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
      this.timerB = this.timerBLatch;
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
    this.updateIrq();
  }

  private readInterruptData(clear: boolean): number {
    const value = (this.interruptFlags & INTERRUPT_MASK) | (this.irq ? 0x80 : 0);
    if (clear) {
      this.interruptFlags = 0;
      this.irq = false;
    }
    return value;
  }

  private raiseInterrupt(source: CiaInterrupt): void {
    this.interruptFlags |= source;
    this.interruptFlags &= INTERRUPT_MASK;
    this.updateIrq();
  }

  private updateIrq(): void {
    this.irq = (this.interruptFlags & this.interruptMask & INTERRUPT_MASK) !== 0;
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
