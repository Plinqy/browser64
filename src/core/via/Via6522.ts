export type ViaPortInputProvider = () => number;
export type ViaPortOutputHandler = (pins: number) => void;
export type ViaControlOutputHandler = (high: boolean) => void;

export enum ViaInterruptFlag {
  Ca2 = 0x01,
  Ca1 = 0x02,
  ShiftRegister = 0x04,
  Cb2 = 0x08,
  Cb1 = 0x10,
  Timer2 = 0x20,
  Timer1 = 0x40
}

const INTERRUPT_MASK = 0x7f;

/**
 * Cycle-stepped MOS 6522 VIA.
 *
 * The implementation covers the register-visible behavior needed by a stock
 * 1541: both parallel ports, CA1/CA2/CB1/CB2 edge/handshake modes, Timer 1,
 * Timer 2, PB7 timer output, IER/IFR, and the shift-register clock modes.
 * `peek()` is side-effect free so the debugger can inspect a drive safely.
 */
export class Via6522 {
  private ora = 0;
  private orb = 0;
  private ddra = 0;
  private ddrb = 0;

  private timer1Counter = 0xffff;
  private timer1Latch = 0xffff;
  private timer1Running = false;
  private timer1Delay = 0;
  private timer1Pb7 = true;

  private timer2Counter = 0xffff;
  private timer2LatchLow = 0xff;
  private timer2Running = false;
  private timer2Delay = 0;
  private pb6Previous = true;

  private sr = 0;
  private shiftBitsRemaining = 0;
  private shiftClockHigh = true;
  private shiftT2Divider = 0;

  private acr = 0;
  private pcr = 0;
  private ifr = 0;
  private ier = 0;

  private ca1High = true;
  private ca2High = true;
  private cb1High = true;
  private cb2High = true;
  private ca2Output = true;
  private cb2Output = true;
  private ca2PulsePending = false;
  private cb2PulsePending = false;

  private portAInput: ViaPortInputProvider = () => 0xff;
  private portBInput: ViaPortInputProvider = () => 0xff;
  private portAOutput: ViaPortOutputHandler = () => {};
  private portBOutput: ViaPortOutputHandler = () => {};
  private ca2OutputHandler: ViaControlOutputHandler = () => {};
  private cb1OutputHandler: ViaControlOutputHandler = () => {};
  private cb2OutputHandler: ViaControlOutputHandler = () => {};

  reset(): void {
    this.ora = 0;
    this.orb = 0;
    this.ddra = 0;
    this.ddrb = 0;
    this.timer1Counter = 0xffff;
    this.timer1Latch = 0xffff;
    this.timer1Running = false;
    this.timer1Delay = 0;
    this.timer1Pb7 = true;
    this.timer2Counter = 0xffff;
    this.timer2LatchLow = 0xff;
    this.timer2Running = false;
    this.timer2Delay = 0;
    this.pb6Previous = true;
    this.sr = 0;
    this.shiftBitsRemaining = 0;
    this.shiftClockHigh = true;
    this.shiftT2Divider = 0;
    this.acr = 0;
    this.pcr = 0;
    this.ifr = 0;
    this.ier = 0;
    this.ca1High = true;
    this.ca2High = true;
    this.cb1High = true;
    this.cb2High = true;
    this.ca2Output = true;
    this.cb2Output = true;
    this.ca2PulsePending = false;
    this.cb2PulsePending = false;
    this.notifyPortA();
    this.notifyPortB();
    this.ca2OutputHandler(true);
    this.cb1OutputHandler(true);
    this.cb2OutputHandler(true);
  }

  read(offset: number): number {
    return this.readRegister(offset & 0x0f, true);
  }

  peek(offset: number): number {
    return this.readRegister(offset & 0x0f, false);
  }

  write(offset: number, value: number): void {
    const register = offset & 0x0f;
    const data = value & 0xff;

    switch (register) {
      case 0x00:
        this.orb = data;
        this.clearPortBInterrupts();
        this.triggerCb2Handshake();
        this.notifyPortB();
        return;
      case 0x01:
        this.ora = data;
        this.clearPortAInterrupts();
        this.triggerCa2Handshake();
        this.notifyPortA();
        return;
      case 0x02:
        this.ddrb = data;
        this.notifyPortB();
        return;
      case 0x03:
        this.ddra = data;
        this.notifyPortA();
        return;
      case 0x04:
      case 0x06:
        this.timer1Latch = (this.timer1Latch & 0xff00) | data;
        return;
      case 0x05:
        this.timer1Latch = (data << 8) | (this.timer1Latch & 0x00ff);
        this.timer1Counter = this.timer1Latch;
        this.timer1Running = true;
        this.timer1Delay = 1;
        this.timer1Pb7 = false;
        this.clearInterrupt(ViaInterruptFlag.Timer1);
        this.notifyPortB();
        return;
      case 0x07:
        this.timer1Latch = (data << 8) | (this.timer1Latch & 0x00ff);
        this.clearInterrupt(ViaInterruptFlag.Timer1);
        return;
      case 0x08:
        this.timer2LatchLow = data;
        return;
      case 0x09:
        this.timer2Counter = (data << 8) | this.timer2LatchLow;
        this.timer2Running = true;
        this.timer2Delay = 1;
        this.clearInterrupt(ViaInterruptFlag.Timer2);
        return;
      case 0x0a:
        this.sr = data;
        this.shiftBitsRemaining = 8;
        this.clearInterrupt(ViaInterruptFlag.ShiftRegister);
        this.startShiftClockIfNeeded();
        return;
      case 0x0b:
        this.acr = data;
        this.notifyPortB();
        this.startShiftClockIfNeeded();
        return;
      case 0x0c:
        this.pcr = data;
        this.applyControlOutputModes();
        return;
      case 0x0d:
        this.ifr &= ~(data & INTERRUPT_MASK);
        return;
      case 0x0e:
        if ((data & 0x80) !== 0) this.ier |= data & INTERRUPT_MASK;
        else this.ier &= ~(data & INTERRUPT_MASK);
        this.ier &= INTERRUPT_MASK;
        return;
      case 0x0f:
        this.ora = data;
        this.notifyPortA();
        return;
      default:
        return;
    }
  }

  tick(cycles = 1): void {
    if (!Number.isInteger(cycles) || cycles < 0) {
      throw new RangeError(`VIA cycle count must be a non-negative integer; received ${cycles}.`);
    }

    for (let cycle = 0; cycle < cycles; cycle += 1) {
      if (this.ca2PulsePending) {
        this.ca2PulsePending = false;
        this.setCa2Output(true);
      }
      if (this.cb2PulsePending) {
        this.cb2PulsePending = false;
        this.setCb2Output(true);
      }

      this.clockTimer1();
      this.clockTimer2();
      this.clockInternalShiftRegister();
    }
  }

  setPortAInputProvider(provider: ViaPortInputProvider): void {
    this.portAInput = provider;
  }

  setPortBInputProvider(provider: ViaPortInputProvider): void {
    this.portBInput = provider;
  }

  setPortAOutputHandler(handler: ViaPortOutputHandler): void {
    this.portAOutput = handler;
    this.notifyPortA();
  }

  setPortBOutputHandler(handler: ViaPortOutputHandler): void {
    this.portBOutput = handler;
    this.notifyPortB();
  }

  setCa2OutputHandler(handler: ViaControlOutputHandler): void {
    this.ca2OutputHandler = handler;
    handler(this.ca2Output);
  }

  setCb1OutputHandler(handler: ViaControlOutputHandler): void {
    this.cb1OutputHandler = handler;
    handler(this.shiftClockHigh);
  }

  setCb2OutputHandler(handler: ViaControlOutputHandler): void {
    this.cb2OutputHandler = handler;
    handler(this.cb2Output);
  }

  setCa1Line(high: boolean): void {
    const active = edgeMatches(this.ca1High, high, (this.pcr & 0x01) !== 0);
    this.ca1High = high;
    if (!active) return;

    this.raiseInterrupt(ViaInterruptFlag.Ca1);
    if (ca2Mode(this.pcr) === 4) this.setCa2Output(true);
  }

  setCa2Line(high: boolean): void {
    const mode = ca2Mode(this.pcr);
    const active = mode < 4 && edgeMatches(this.ca2High, high, (mode & 0x02) !== 0);
    this.ca2High = high;
    if (active) this.raiseInterrupt(ViaInterruptFlag.Ca2);
  }

  setCb1Line(high: boolean): void {
    const previous = this.cb1High;
    const active = edgeMatches(previous, high, (this.pcr & 0x10) !== 0);
    this.cb1High = high;

    const shiftMode = this.shiftMode;
    if ((shiftMode === 3 || shiftMode === 7) && previous !== high) {
      if (high) this.shiftOneBitExternal();
    }

    if (!active) return;
    this.raiseInterrupt(ViaInterruptFlag.Cb1);
    if (cb2Mode(this.pcr) === 4) this.setCb2Output(true);
  }

  setCb2Line(high: boolean): void {
    const mode = cb2Mode(this.pcr);
    const active = mode < 4 && edgeMatches(this.cb2High, high, (mode & 0x02) !== 0);
    this.cb2High = high;
    if (active) this.raiseInterrupt(ViaInterruptFlag.Cb2);
  }

  /** One negative-going PB6 pulse for Timer 2 pulse-count mode. */
  setPb6Line(high: boolean): void {
    if (this.pb6Previous && !high && this.timer2Running && (this.acr & 0x20) !== 0) {
      this.decrementTimer2();
    }
    this.pb6Previous = high;
  }

  get irqAsserted(): boolean {
    return (this.ifr & this.ier & INTERRUPT_MASK) !== 0;
  }

  get portAPins(): number {
    return ((this.ora & this.ddra) | (this.portAInput() & ~this.ddra)) & 0xff;
  }

  get portBPins(): number {
    let value = ((this.orb & this.ddrb) | (this.portBInput() & ~this.ddrb)) & 0xff;
    if ((this.acr & 0x80) !== 0) value = setBit(value, 7, this.timer1Pb7);
    return value;
  }

  get portAOutputPins(): number {
    return ((this.ora & this.ddra) | (~this.ddra & 0xff)) & 0xff;
  }

  get portBOutputPins(): number {
    let value = ((this.orb & this.ddrb) | (~this.ddrb & 0xff)) & 0xff;
    if ((this.acr & 0x80) !== 0) value = setBit(value, 7, this.timer1Pb7);
    return value;
  }

  get dataDirectionA(): number { return this.ddra; }
  get dataDirectionB(): number { return this.ddrb; }
  get outputRegisterA(): number { return this.ora; }
  get outputRegisterB(): number { return this.orb; }
  get timer1CounterValue(): number { return this.timer1Counter & 0xffff; }
  get timer1LatchValue(): number { return this.timer1Latch & 0xffff; }
  get timer2CounterValue(): number { return this.timer2Counter & 0xffff; }
  get auxiliaryControl(): number { return this.acr; }
  get peripheralControl(): number { return this.pcr; }
  get interruptFlagsValue(): number { return this.readIfr(); }
  get interruptEnableValue(): number { return this.ier; }
  get shiftRegisterValue(): number { return this.sr; }
  get ca2OutputHigh(): boolean { return this.ca2Output; }
  get cb2OutputHigh(): boolean { return this.cb2Output; }

  private readRegister(register: number, sideEffects: boolean): number {
    switch (register) {
      case 0x00: {
        const value = this.portBPins;
        if (sideEffects) {
          this.clearPortBInterrupts();
          this.triggerCb2Handshake();
        }
        return value;
      }
      case 0x01: {
        const value = this.portAPins;
        if (sideEffects) {
          this.clearPortAInterrupts();
          this.triggerCa2Handshake();
        }
        return value;
      }
      case 0x02: return this.ddrb;
      case 0x03: return this.ddra;
      case 0x04:
        if (sideEffects) this.clearInterrupt(ViaInterruptFlag.Timer1);
        return this.timer1Counter & 0xff;
      case 0x05: return (this.timer1Counter >> 8) & 0xff;
      case 0x06: return this.timer1Latch & 0xff;
      case 0x07: return (this.timer1Latch >> 8) & 0xff;
      case 0x08:
        if (sideEffects) this.clearInterrupt(ViaInterruptFlag.Timer2);
        return this.timer2Counter & 0xff;
      case 0x09: return (this.timer2Counter >> 8) & 0xff;
      case 0x0a:
        if (sideEffects) {
          this.clearInterrupt(ViaInterruptFlag.ShiftRegister);
          this.shiftBitsRemaining = 8;
          this.startShiftClockIfNeeded();
        }
        return this.sr;
      case 0x0b: return this.acr;
      case 0x0c: return this.pcr;
      case 0x0d: return this.readIfr();
      case 0x0e: return 0x80 | this.ier;
      case 0x0f: return this.portAPins;
      default: return 0xff;
    }
  }

  private readIfr(): number {
    return (this.ifr & INTERRUPT_MASK) | (this.irqAsserted ? 0x80 : 0);
  }

  private clockTimer1(): void {
    if (!this.timer1Running) return;
    if (this.timer1Delay > 0) {
      this.timer1Delay -= 1;
      return;
    }

    if (this.timer1Counter === 0) {
      this.raiseInterrupt(ViaInterruptFlag.Timer1);
      if ((this.acr & 0x80) !== 0) {
        this.timer1Pb7 = !this.timer1Pb7;
        this.notifyPortB();
      }

      if ((this.acr & 0x40) !== 0) {
        this.timer1Counter = this.timer1Latch;
        this.timer1Delay = 1;
      } else {
        this.timer1Counter = 0xffff;
        this.timer1Running = false;
      }
      return;
    }

    this.timer1Counter = (this.timer1Counter - 1) & 0xffff;
  }

  private clockTimer2(): void {
    if (!this.timer2Running || (this.acr & 0x20) !== 0) return;
    if (this.timer2Delay > 0) {
      this.timer2Delay -= 1;
      return;
    }
    this.decrementTimer2();
  }

  private decrementTimer2(): void {
    if (this.timer2Counter === 0) {
      this.raiseInterrupt(ViaInterruptFlag.Timer2);
      this.timer2Counter = 0xffff;
      this.timer2Running = false;
      return;
    }
    this.timer2Counter = (this.timer2Counter - 1) & 0xffff;
  }

  private get shiftMode(): number {
    return (this.acr >> 2) & 0x07;
  }

  private startShiftClockIfNeeded(): void {
    const mode = this.shiftMode;
    if (mode === 0) return;
    if (this.shiftBitsRemaining === 0) this.shiftBitsRemaining = 8;
    this.shiftT2Divider = (this.timer2LatchLow + 2) * 2;
  }

  private clockInternalShiftRegister(): void {
    if (this.shiftBitsRemaining === 0) return;
    const mode = this.shiftMode;
    if (mode === 0 || mode === 3 || mode === 7) return;

    if (mode === 2 || mode === 6) {
      this.shiftClockHigh = !this.shiftClockHigh;
      this.cb1OutputHandler(this.shiftClockHigh);
      if (this.shiftClockHigh) this.shiftOneBit(mode >= 4);
      return;
    }

    // Timer-2-derived shift modes (1, 4, 5). A complete shift clock uses
    // T2L+2 PHI2 periods per half-cycle on real silicon.
    this.shiftT2Divider -= 1;
    if (this.shiftT2Divider > 0) return;
    this.shiftT2Divider = Math.max(2, (this.timer2LatchLow + 2));
    this.shiftClockHigh = !this.shiftClockHigh;
    this.cb1OutputHandler(this.shiftClockHigh);
    if (this.shiftClockHigh) this.shiftOneBit(mode >= 4);
  }

  private shiftOneBitExternal(): void {
    this.shiftOneBit(this.shiftMode === 7);
  }

  private shiftOneBit(outputMode: boolean): void {
    if (this.shiftBitsRemaining === 0) return;

    if (outputMode) {
      const bit = (this.sr & 0x80) !== 0;
      this.setCb2Output(bit);
      this.sr = ((this.sr << 1) | (bit ? 1 : 0)) & 0xff;
    } else {
      this.sr = ((this.sr << 1) | (this.cb2High ? 1 : 0)) & 0xff;
    }

    this.shiftBitsRemaining -= 1;
    if (this.shiftBitsRemaining === 0) {
      this.raiseInterrupt(ViaInterruptFlag.ShiftRegister);
      if (this.shiftMode === 4) this.shiftBitsRemaining = 8;
    }
  }

  private clearPortAInterrupts(): void {
    this.clearInterrupt(ViaInterruptFlag.Ca1);
    const mode = ca2Mode(this.pcr);
    if (mode < 4 && (mode & 0x01) === 0) this.clearInterrupt(ViaInterruptFlag.Ca2);
  }

  private clearPortBInterrupts(): void {
    this.clearInterrupt(ViaInterruptFlag.Cb1);
    const mode = cb2Mode(this.pcr);
    if (mode < 4 && (mode & 0x01) === 0) this.clearInterrupt(ViaInterruptFlag.Cb2);
  }

  private triggerCa2Handshake(): void {
    const mode = ca2Mode(this.pcr);
    if (mode === 4) this.setCa2Output(false);
    if (mode === 5) {
      this.setCa2Output(false);
      this.ca2PulsePending = true;
    }
  }

  private triggerCb2Handshake(): void {
    const mode = cb2Mode(this.pcr);
    if (mode === 4) this.setCb2Output(false);
    if (mode === 5) {
      this.setCb2Output(false);
      this.cb2PulsePending = true;
    }
  }

  private applyControlOutputModes(): void {
    const caMode = ca2Mode(this.pcr);
    if (caMode === 6) this.setCa2Output(false);
    else if (caMode === 7) this.setCa2Output(true);
    else if (caMode >= 4) this.setCa2Output(true);

    const cbMode = cb2Mode(this.pcr);
    if (cbMode === 6) this.setCb2Output(false);
    else if (cbMode === 7) this.setCb2Output(true);
    else if (cbMode >= 4) this.setCb2Output(true);
  }

  private setCa2Output(high: boolean): void {
    if (this.ca2Output === high) return;
    this.ca2Output = high;
    this.ca2OutputHandler(high);
  }

  private setCb2Output(high: boolean): void {
    if (this.cb2Output === high) return;
    this.cb2Output = high;
    this.cb2OutputHandler(high);
  }

  private raiseInterrupt(flag: ViaInterruptFlag): void {
    this.ifr = (this.ifr | flag) & INTERRUPT_MASK;
  }

  private clearInterrupt(flag: ViaInterruptFlag): void {
    this.ifr &= ~flag;
  }

  private notifyPortA(): void {
    this.portAOutput(this.portAOutputPins);
  }

  private notifyPortB(): void {
    this.portBOutput(this.portBOutputPins);
  }
}

function ca2Mode(pcr: number): number {
  return (pcr >> 1) & 0x07;
}

function cb2Mode(pcr: number): number {
  return (pcr >> 5) & 0x07;
}

function edgeMatches(previous: boolean, next: boolean, positiveEdge: boolean): boolean {
  return positiveEdge ? !previous && next : previous && !next;
}

function setBit(value: number, bit: number, enabled: boolean): number {
  return enabled ? (value | (1 << bit)) & 0xff : (value & ~(1 << bit)) & 0xff;
}
