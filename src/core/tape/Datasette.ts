import { TapImage } from './TapImage';

export const DATASETTE_MOTOR_SPINUP_SECONDS = 0.30;

export interface DatasetteSnapshot {
  readonly mounted: boolean;
  readonly playPressed: boolean;
  readonly motorOn: boolean;
  readonly writeHigh: boolean;
  readonly atEnd: boolean;
  readonly dataOffset: number;
}

/**
 * Commodore 1530/C2N signal-level playback deck.
 *
 * TAP v0/v1 entries represent intervals between complete-wave read pulses. The
 * C64 only observes falling edges on CIA1 FLAG, so each completed pulse emits
 * one low/high FLAG pulse. MOTOR, SENSE, and WRITE are driven by the 6510 port.
 */
export class Datasette {
  private tape: TapImage | null = null;
  private play = false;
  private motor = false;
  private writeLineHigh = true;
  private dataOffsetValue = 0;
  private cyclesUntilPulse = 0;
  private spinupCyclesRemaining = 0;
  private endReached = false;

  constructor(
    public readonly clockHz: number,
    private readonly readPulse: () => void
  ) {
    if (!Number.isFinite(clockHz) || clockHz <= 0) {
      throw new RangeError(`Datasette clock must be positive; received ${clockHz}.`);
    }
  }

  mount(imageOrBytes: TapImage | ArrayLike<number>): TapImage {
    this.tape = imageOrBytes instanceof TapImage ? imageOrBytes : TapImage.parse(imageOrBytes);
    this.rewind();
    return this.tape;
  }

  eject(): void {
    this.tape = null;
    this.play = false;
    this.dataOffsetValue = 0;
    this.cyclesUntilPulse = 0;
    this.spinupCyclesRemaining = 0;
    this.endReached = false;
  }

  pressPlay(): void {
    this.play = true;
    this.endReached = false;
    this.armSpinup();
  }

  pressStop(): void {
    this.play = false;
  }

  rewind(): void {
    this.dataOffsetValue = 0;
    this.cyclesUntilPulse = 0;
    this.endReached = false;
    if (this.play) this.armSpinup();
  }

  setMotor(on: boolean): void {
    if (on === this.motor) return;
    this.motor = on;
    if (on) this.armSpinup();
  }

  setWriteLine(high: boolean): void {
    this.writeLineHigh = high;
  }

  tick(cycles = 1): void {
    if (!Number.isInteger(cycles) || cycles < 0) {
      throw new RangeError(`Datasette cycle count must be a non-negative integer; received ${cycles}.`);
    }
    if (cycles === 0 || this.tape === null || !this.play || !this.motor || this.endReached) return;

    let remaining = cycles;
    if (this.spinupCyclesRemaining > 0) {
      const consumed = Math.min(remaining, this.spinupCyclesRemaining);
      this.spinupCyclesRemaining -= consumed;
      remaining -= consumed;
      if (remaining === 0) return;
    }

    while (remaining > 0 && !this.endReached) {
      if (this.cyclesUntilPulse <= 0) {
        const pulse = this.tape.pulseAt(this.dataOffsetValue);
        if (pulse === null) {
          this.endReached = true;
          return;
        }
        this.cyclesUntilPulse = scaleCycles(pulse.cycles, this.tape.sourceClockHz, this.clockHz);
        this.dataOffsetValue = pulse.nextOffset;
      }

      const elapsed = Math.min(remaining, this.cyclesUntilPulse);
      this.cyclesUntilPulse -= elapsed;
      remaining -= elapsed;

      if (this.cyclesUntilPulse === 0) {
        this.readPulse();
      }
    }
  }

  get mounted(): boolean {
    return this.tape !== null;
  }

  get playPressed(): boolean {
    return this.play;
  }

  /** SENSE is active low when a transport key such as PLAY is engaged. */
  get senseHigh(): boolean {
    return !this.play;
  }

  get motorOn(): boolean {
    return this.motor;
  }

  get writeHigh(): boolean {
    return this.writeLineHigh;
  }

  get atEnd(): boolean {
    return this.endReached;
  }

  get dataOffset(): number {
    return this.dataOffsetValue;
  }

  snapshot(): DatasetteSnapshot {
    return {
      mounted: this.mounted,
      playPressed: this.play,
      motorOn: this.motor,
      writeHigh: this.writeLineHigh,
      atEnd: this.endReached,
      dataOffset: this.dataOffsetValue
    };
  }

  private armSpinup(): void {
    if (this.play && this.motor) {
      this.spinupCyclesRemaining = Math.round(this.clockHz * DATASETTE_MOTOR_SPINUP_SECONDS);
    }
  }
}

function scaleCycles(cycles: number, sourceClockHz: number, targetClockHz: number): number {
  return Math.max(1, Math.round(cycles * targetClockHz / sourceClockHz));
}
