import type { D64Image } from '../disk/D64Image';
import { buildGcrTrack, cyclesPerGcrByte, type GcrTrack } from './Gcr';

export interface DriveMechanismTickResult {
  readonly byteReady: boolean;
  readonly dataByte: number;
  readonly syncLow: boolean;
}

/**
 * Read-side 1541 spindle/head/gate-array media model.
 *
 * D64 sectors are converted to the byte-level GCR stream a 1541 actually
 * consumes. The spindle advances at density-selected 26/28/30/32 drive
 * cycles per raw byte, and the four-phase stepper moves in half-track units.
 * D64 media is intentionally write-protected in v0.11; write-side flux and
 * G64 preservation are a later compatibility phase.
 */
export class DriveMechanism1541 {
  private image: D64Image | null = null;
  private readonly trackCache = new Map<number, GcrTrack>();
  private halfTrackPosition = 35; // Track 18: full tracks are odd half-track positions.
  private stepperPhase = 0;
  private motorEnabled = false;
  private activity = false;
  private density: 0 | 1 | 2 | 3 = 2;
  private readMode = true;
  private byteReadyEnabled = true;
  private byteIndex = 0;
  private byteCountdown = 1;
  private currentByteValue = 0x55;
  private currentSyncLow = false;

  mount(image: D64Image): void {
    this.image = image;
    this.trackCache.clear();
    this.byteIndex = 0;
    this.byteCountdown = 1;
    this.refreshCurrentByte();
  }

  eject(): void {
    this.image = null;
    this.trackCache.clear();
    this.byteIndex = 0;
    this.byteCountdown = 1;
    this.currentByteValue = 0x55;
    this.currentSyncLow = false;
  }

  resetElectronics(): void {
    this.motorEnabled = false;
    this.activity = false;
    this.density = 2;
    this.readMode = true;
    this.byteReadyEnabled = true;
    this.stepperPhase = 0;
    this.byteCountdown = 1;
    this.currentSyncLow = false;
  }

  tick(): DriveMechanismTickResult {
    let byteReady = false;

    if (this.motorEnabled && this.image !== null) {
      this.byteCountdown -= 1;
      if (this.byteCountdown <= 0) {
        this.advanceByte();
        this.byteCountdown = cyclesPerGcrByte(this.density);
        byteReady = this.byteReadyEnabled && this.readMode;
      }
    }

    return {
      byteReady,
      dataByte: this.currentByteValue,
      syncLow: this.currentSyncLow
    };
  }

  setMotorEnabled(enabled: boolean): void {
    if (this.motorEnabled === enabled) return;
    this.motorEnabled = enabled;
    if (enabled) this.byteCountdown = Math.max(1, this.byteCountdown);
  }

  setActivityLed(enabled: boolean): void {
    this.activity = enabled;
  }

  setDensitySelect(value: number): void {
    this.density = (value & 0x03) as 0 | 1 | 2 | 3;
    this.byteCountdown = Math.min(this.byteCountdown, cyclesPerGcrByte(this.density));
  }

  setReadMode(enabled: boolean): void {
    this.readMode = enabled;
  }

  setByteReadyEnabled(enabled: boolean): void {
    this.byteReadyEnabled = enabled;
  }

  setStepperPhase(phase: number): void {
    const next = phase & 0x03;
    if (next === this.stepperPhase) return;

    if (this.motorEnabled) {
      const forward = (this.stepperPhase + 1) & 0x03;
      const backward = (this.stepperPhase + 3) & 0x03;
      if (next === forward) this.moveHalfTrack(1);
      else if (next === backward) this.moveHalfTrack(-1);
    }

    this.stepperPhase = next;
  }

  get mounted(): boolean { return this.image !== null; }
  get writeProtected(): boolean { return true; }
  get motorOn(): boolean { return this.motorEnabled; }
  get activityLedOn(): boolean { return this.activity; }
  get densitySelect(): number { return this.density; }
  get currentDataByte(): number { return this.currentByteValue; }
  get syncAsserted(): boolean { return this.currentSyncLow; }
  get currentHalfTrack(): number { return this.halfTrackPosition; }
  get currentTrack(): number { return Math.max(1, Math.floor((this.halfTrackPosition + 1) / 2)); }

  private moveHalfTrack(direction: -1 | 1): void {
    const maxTrack = this.image?.geometry.tracks ?? 42;
    const maximum = maxTrack * 2 - 1;
    const previousTrack = this.currentTrack;
    this.halfTrackPosition = Math.max(1, Math.min(maximum, this.halfTrackPosition + direction));
    const nextTrack = this.currentTrack;

    if (nextTrack !== previousTrack) {
      // Keep approximate spindle phase when moving between tracks of different
      // raw lengths rather than snapping to the beginning of the next track.
      const oldTrack = this.getTrack(previousTrack);
      const newTrack = this.getTrack(nextTrack);
      if (oldTrack !== null && newTrack !== null && oldTrack.bytes.length > 0) {
        const phase = this.byteIndex / oldTrack.bytes.length;
        this.byteIndex = Math.floor(phase * newTrack.bytes.length) % newTrack.bytes.length;
      } else {
        this.byteIndex = 0;
      }
      this.refreshCurrentByte();
    }
  }

  private advanceByte(): void {
    const track = this.getTrack(this.currentTrack);
    if (track === null || track.bytes.length === 0) {
      this.currentByteValue = 0x55;
      this.currentSyncLow = false;
      return;
    }

    this.byteIndex = (this.byteIndex + 1) % track.bytes.length;
    this.currentByteValue = track.bytes[this.byteIndex] ?? 0x55;
    this.currentSyncLow = isSyncPosition(track.bytes, this.byteIndex);
  }

  private refreshCurrentByte(): void {
    const track = this.getTrack(this.currentTrack);
    if (track === null || track.bytes.length === 0) {
      this.currentByteValue = 0x55;
      this.currentSyncLow = false;
      return;
    }
    this.byteIndex %= track.bytes.length;
    this.currentByteValue = track.bytes[this.byteIndex] ?? 0x55;
    this.currentSyncLow = isSyncPosition(track.bytes, this.byteIndex);
  }

  private getTrack(track: number): GcrTrack | null {
    if (this.image === null || track > this.image.geometry.tracks) return null;
    let cached = this.trackCache.get(track);
    if (cached === undefined) {
      cached = buildGcrTrack(this.image, track);
      this.trackCache.set(track, cached);
    }
    return cached;
  }
}

function isSyncPosition(bytes: Uint8Array, index: number): boolean {
  if (bytes[index] !== 0xff || bytes.length < 2) return false;
  const previous = bytes[(index + bytes.length - 1) % bytes.length];
  const next = bytes[(index + 1) % bytes.length];
  return previous === 0xff || next === 0xff;
}
