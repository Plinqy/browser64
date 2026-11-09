import { encodeTapPulse, TapImage } from './TapImage';

export const DATASETTE_MOTOR_SPINUP_SECONDS = 0.30;

export interface DatasetteSnapshot {
  readonly mounted: boolean;
  readonly playPressed: boolean;
  readonly recordPressed: boolean;
  readonly motorOn: boolean;
  readonly writeHigh: boolean;
  readonly writeProtected: boolean;
  readonly dirty: boolean;
  readonly atEnd: boolean;
  readonly dataOffset: number;
}

/**
 * Commodore 1530/C2N signal-level playback and recording deck.
 *
 * C64 TAP v0/v1 entries represent intervals between complete-wave read pulses.
 * Playback emits one CIA1 FLAG falling edge for each entry. Recording watches
 * rising edges on the 6510 cassette WRITE line and emits cycle-exact TAP v1
 * intervals, preserving a mounted tape prefix when recording begins mid-image.
 */
export class Datasette {
  private tape: TapImage | null = null;
  private play = false;
  private record = false;
  private motor = false;
  private writeLineHigh = true;
  private writeProtectedValue = false;
  private dirtyValue = false;
  private dataOffsetValue = 0;
  private cyclesUntilPulse = 0;
  private spinupCyclesRemaining = 0;
  private endReached = false;

  private recordingPrefix: number[] = [];
  private recordingData: number[] = [];
  private recordingCycles = 0;

  constructor(
    public readonly clockHz: number,
    private readonly readPulse: () => void
  ) {
    if (!Number.isFinite(clockHz) || clockHz <= 0) {
      throw new RangeError(`Datasette clock must be positive; received ${clockHz}.`);
    }
  }

  mount(imageOrBytes: TapImage | ArrayLike<number>, writeProtected = false): TapImage {
    this.tape = imageOrBytes instanceof TapImage ? imageOrBytes : TapImage.parse(imageOrBytes);
    this.play = false;
    this.record = false;
    this.writeProtectedValue = writeProtected;
    this.dirtyValue = false;
    this.rewind();
    return this.tape;
  }

  newBlankTape(videoStandard = 0): TapImage {
    return this.mount(TapImage.create(videoStandard), false);
  }

  eject(): void {
    if (this.record) this.finishRecording();
    this.tape = null;
    this.play = false;
    this.record = false;
    this.dataOffsetValue = 0;
    this.cyclesUntilPulse = 0;
    this.spinupCyclesRemaining = 0;
    this.endReached = false;
    this.recordingPrefix = [];
    this.recordingData = [];
    this.recordingCycles = 0;
    this.dirtyValue = false;
  }

  pressPlay(): void {
    if (this.record) this.finishRecording();
    this.record = false;
    this.play = true;
    this.endReached = false;
    this.armSpinup();
  }

  /** Engage RECORD + PLAY, matching the physical Datasette transport. */
  pressRecord(): void {
    if (this.tape === null) throw new Error('A tape must be mounted before recording.');
    if (this.writeProtectedValue) throw new Error('The mounted tape is write-protected.');
    if (this.record) return;

    this.play = true;
    this.record = true;
    this.endReached = false;
    this.cyclesUntilPulse = 0;
    this.recordingPrefix = this.encodePrefixAsV1(this.dataOffsetValue);
    this.recordingData = [];
    this.recordingCycles = 0;
    this.armSpinup();
  }

  pressStop(): void {
    if (this.record) this.finishRecording();
    this.record = false;
    this.play = false;
  }

  rewind(): void {
    if (this.record) this.finishRecording();
    this.record = false;
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
    if (high === this.writeLineHigh) return;
    const previousHigh = this.writeLineHigh;
    this.writeLineHigh = high;

    // C64 TAP v1 stores full-wave intervals. Use one polarity as the reference
    // edge so a square-wave write signal produces one stored pulse per period.
    if (this.record && this.motor && !previousHigh && high) this.closeRecordedPulse();
  }

  setWriteProtected(writeProtected: boolean): void {
    if (writeProtected && this.record) {
      this.finishRecording();
      this.record = false;
    }
    this.writeProtectedValue = writeProtected;
  }

  tick(cycles = 1): void {
    if (!Number.isInteger(cycles) || cycles < 0) {
      throw new RangeError(`Datasette cycle count must be a non-negative integer; received ${cycles}.`);
    }
    if (cycles === 0 || this.tape === null || !this.play || !this.motor) return;

    if (this.record) {
      this.recordingCycles += cycles;
      return;
    }
    if (this.endReached) return;

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

      if (this.cyclesUntilPulse === 0) this.readPulse();
    }
  }

  exportTapBytes(): Uint8Array | null {
    if (this.tape === null) return null;
    if (!this.record) return this.tape.toBytes();
    return TapImage.fromPulseBytes(
      [...this.recordingPrefix, ...this.recordingData],
      this.tape.videoStandard
    ).toBytes();
  }

  get mounted(): boolean { return this.tape !== null; }
  get playPressed(): boolean { return this.play; }
  get recordPressed(): boolean { return this.record; }
  /** SENSE is active low when a transport key such as PLAY/RECORD is engaged. */
  get senseHigh(): boolean { return !this.play; }
  get motorOn(): boolean { return this.motor; }
  get writeHigh(): boolean { return this.writeLineHigh; }
  get writeProtected(): boolean { return this.writeProtectedValue; }
  get dirty(): boolean { return this.dirtyValue || this.recordingData.length > 0; }
  get atEnd(): boolean { return this.endReached; }
  get dataOffset(): number { return this.dataOffsetValue; }

  snapshot(): DatasetteSnapshot {
    return {
      mounted: this.mounted,
      playPressed: this.play,
      recordPressed: this.record,
      motorOn: this.motor,
      writeHigh: this.writeLineHigh,
      writeProtected: this.writeProtectedValue,
      dirty: this.dirty,
      atEnd: this.endReached,
      dataOffset: this.dataOffsetValue
    };
  }

  private closeRecordedPulse(): void {
    if (this.tape === null || this.recordingCycles <= 0) {
      this.recordingCycles = 0;
      return;
    }

    let sourceCycles = Math.max(1, Math.round(this.recordingCycles * this.tape.sourceClockHz / this.clockHz));
    while (sourceCycles > 0) {
      const chunk = Math.min(sourceCycles, 0xffffff);
      this.recordingData.push(...encodeTapPulse(chunk));
      sourceCycles -= chunk;
    }
    this.recordingCycles = 0;
    this.dirtyValue = true;
  }

  private finishRecording(): void {
    if (this.tape === null) return;
    const data = Uint8Array.from([...this.recordingPrefix, ...this.recordingData]);
    this.tape = TapImage.fromPulseBytes(data, this.tape.videoStandard);
    this.dataOffsetValue = data.length;
    this.cyclesUntilPulse = 0;
    this.endReached = true;
    this.recordingPrefix = [];
    this.recordingData = [];
    this.recordingCycles = 0;
  }

  private encodePrefixAsV1(endOffset: number): number[] {
    if (this.tape === null || endOffset <= 0) return [];
    if (this.tape.version === 1) return Array.from(this.tape.dataBytes().slice(0, endOffset));

    const output: number[] = [];
    let offset = 0;
    while (offset < endOffset) {
      const pulse = this.tape.pulseAt(offset);
      if (pulse === null || pulse.nextOffset > endOffset) break;
      output.push(...encodeTapPulse(Math.min(0xffffff, pulse.cycles)));
      offset = pulse.nextOffset;
    }
    return output;
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
