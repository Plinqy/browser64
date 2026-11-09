import type { D64Image } from '../disk/D64Image';
import type { G64Image } from '../disk/G64Image';
import { buildGcrTrack, cyclesPerGcrByte, decodeGcrTrackToD64, densityForTrack, type GcrTrack } from './Gcr';

export interface DriveMechanismTickResult {
  readonly byteReady: boolean;
  readonly dataByte: number;
  readonly syncLow: boolean;
}

export type DriveMediaKind = 'd64' | 'g64';

export interface ExportedDriveMedia {
  readonly kind: DriveMediaKind;
  readonly bytes: Uint8Array;
}

type MountedMedia =
  | { readonly kind: 'd64'; readonly image: D64Image }
  | { readonly kind: 'g64'; readonly image: G64Image };

/**
 * 1541 spindle/head/gate-array media model with byte-level read/write support.
 *
 * D64 sectors are expanded into standard GCR tracks. Writes mutate that raw
 * stream and valid standard sectors are decoded back into the D64 on read-mode
 * transitions/export/eject. G64 tracks stay raw, including half-tracks and
 * non-standard byte patterns, so custom formats survive export unchanged.
 */
export class DriveMechanism1541 {
  private media: MountedMedia | null = null;
  private readonly trackCache = new Map<string, GcrTrack>();
  private readonly dirtyD64Tracks = new Set<number>();
  private halfTrackPosition = 35; // Track 18: full tracks are odd half-track positions.
  private stepperPhase = 0;
  private motorEnabled = false;
  private activity = false;
  private density: 0 | 1 | 2 | 3 = 2;
  private readMode = true;
  private overflowEnabledValue = true;
  private mediaModified = false;
  private writeProtectedValue = false;
  private writeDataByte = 0x55;
  private byteIndex = 0;
  private byteCountdown = 1;
  private currentByteValue = 0x55;
  private currentSyncLow = false;

  mount(image: D64Image, writeProtected = false): void {
    this.commitDirtyD64Tracks();
    this.media = { kind: 'd64', image };
    this.writeProtectedValue = writeProtected;
    this.resetMediaPosition();
  }

  mountG64(image: G64Image, writeProtected = false): void {
    this.commitDirtyD64Tracks();
    this.media = { kind: 'g64', image };
    this.writeProtectedValue = writeProtected;
    this.resetMediaPosition();
  }

  eject(): void {
    this.commitDirtyD64Tracks();
    this.media = null;
    this.trackCache.clear();
    this.dirtyD64Tracks.clear();
    this.mediaModified = false;
    this.byteIndex = 0;
    this.byteCountdown = 1;
    this.currentByteValue = 0x55;
    this.currentSyncLow = false;
  }

  exportMountedMedia(): ExportedDriveMedia | null {
    this.commitDirtyD64Tracks();
    if (this.media === null) return null;
    return {
      kind: this.media.kind,
      bytes: this.media.image.toBytes()
    };
  }

  resetElectronics(): void {
    this.motorEnabled = false;
    this.activity = false;
    this.density = 2;
    this.readMode = true;
    this.overflowEnabledValue = true;
    this.stepperPhase = 0;
    this.byteCountdown = 1;
    this.currentSyncLow = false;
  }

  tick(): DriveMechanismTickResult {
    let byteReady = false;

    if (this.motorEnabled && this.media !== null) {
      this.byteCountdown -= 1;
      if (this.byteCountdown <= 0) {
        if (this.readMode) {
          this.advanceByte();
        } else {
          this.writeCurrentByte();
          this.advanceByte();
        }
        this.byteCountdown = this.cyclesForCurrentByte();
        // BLOCK SYNC suppresses BYTE READY during reads; framing resumes on the first post-sync GCR byte. Writes still pace every completed byte.
        // CA2/SOE separately decides whether BYTE READY reaches the 6502 overflow input.
        byteReady = !this.readMode || !this.currentSyncLow;
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

  setActivityLed(enabled: boolean): void { this.activity = enabled; }

  setDensitySelect(value: number): void {
    this.density = (value & 0x03) as 0 | 1 | 2 | 3;
    if (this.media?.kind !== 'g64') {
      this.byteCountdown = Math.min(this.byteCountdown, cyclesPerGcrByte(this.density));
    }
  }

  setReadMode(enabled: boolean): void {
    if (enabled === this.readMode) return;
    if (enabled) this.commitDirtyD64Tracks();
    this.readMode = enabled;
  }

  /** Backward-compatible name: CA2 controls SOE, not the CA1 BYTE READY pulse itself. */
  setByteReadyEnabled(enabled: boolean): void { this.overflowEnabledValue = enabled; }
  setWriteDataByte(value: number): void { this.writeDataByte = value & 0xff; }
  setWriteProtected(writeProtected: boolean): void { this.writeProtectedValue = writeProtected; }

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

  get mounted(): boolean { return this.media !== null; }
  get mediaKind(): DriveMediaKind | null { return this.media?.kind ?? null; }
  get writeProtected(): boolean { return this.writeProtectedValue; }
  /** True after the mounted image has changed and until new media is mounted/ejected. */
  get dirty(): boolean { return this.mediaModified; }
  get overflowEnabled(): boolean { return this.overflowEnabledValue; }
  get motorOn(): boolean { return this.motorEnabled; }
  get activityLedOn(): boolean { return this.activity; }
  get densitySelect(): number { return this.density; }
  get currentDataByte(): number { return this.currentByteValue; }
  get syncAsserted(): boolean { return this.currentSyncLow; }
  get currentHalfTrack(): number { return this.halfTrackPosition; }
  get currentTrack(): number { return Math.max(1, Math.floor((this.halfTrackPosition + 1) / 2)); }
  get currentTrackPosition(): number { return 1 + (this.halfTrackPosition - 1) / 2; }

  private resetMediaPosition(): void {
    this.trackCache.clear();
    this.dirtyD64Tracks.clear();
    this.mediaModified = false;
    this.byteIndex = 0;
    this.byteCountdown = 1;
    this.refreshCurrentByte();
  }

  private moveHalfTrack(direction: -1 | 1): void {
    const maximum = this.maximumHalfTrackPosition();
    const oldPosition = this.halfTrackPosition;
    const oldTrack = this.getTrackAt(oldPosition);
    this.halfTrackPosition = Math.max(1, Math.min(maximum, oldPosition + direction));
    const newTrack = this.getTrackAt(this.halfTrackPosition);

    if (oldPosition !== this.halfTrackPosition) {
      if (oldTrack !== null && newTrack !== null && oldTrack.bytes.length > 0 && newTrack.bytes.length > 0) {
        const phase = this.byteIndex / oldTrack.bytes.length;
        this.byteIndex = Math.floor(phase * newTrack.bytes.length) % newTrack.bytes.length;
      } else {
        this.byteIndex = 0;
      }
      this.refreshCurrentByte();
    }
  }

  private maximumHalfTrackPosition(): number {
    if (this.media?.kind === 'g64') return this.media.image.trackEntryCount;
    if (this.media?.kind === 'd64') return this.media.image.geometry.tracks * 2 - 1;
    return 83;
  }

  private advanceByte(): void {
    const track = this.getTrackAt(this.halfTrackPosition);
    if (track === null || track.bytes.length === 0) {
      this.currentByteValue = 0x55;
      this.currentSyncLow = false;
      return;
    }

    this.byteIndex = (this.byteIndex + 1) % track.bytes.length;
    this.currentByteValue = track.bytes[this.byteIndex] ?? 0x55;
    this.currentSyncLow = isSyncPosition(track.bytes, this.byteIndex);
  }

  private writeCurrentByte(): void {
    if (this.writeProtectedValue) return;
    const track = this.getTrackAt(this.halfTrackPosition);
    if (track === null || track.bytes.length === 0) return;
    this.byteIndex %= track.bytes.length;
    track.bytes[this.byteIndex] = this.writeDataByte;
    this.currentByteValue = this.writeDataByte;
    this.currentSyncLow = isSyncPosition(track.bytes, this.byteIndex);

    if (this.media?.kind === 'd64') this.dirtyD64Tracks.add(this.currentTrack);
    this.mediaModified = true;
  }

  private refreshCurrentByte(): void {
    const track = this.getTrackAt(this.halfTrackPosition);
    if (track === null || track.bytes.length === 0) {
      this.currentByteValue = 0x55;
      this.currentSyncLow = false;
      return;
    }
    this.byteIndex %= track.bytes.length;
    this.currentByteValue = track.bytes[this.byteIndex] ?? 0x55;
    this.currentSyncLow = isSyncPosition(track.bytes, this.byteIndex);
  }


  private cyclesForCurrentByte(): number {
    if (this.media?.kind === 'g64') {
      const track = this.media.image.mutableHalfTrack(this.halfTrackPosition);
      if (track !== null && track.speedZones.length > 0) {
        const index = this.byteIndex % track.speedZones.length;
        const zone = (track.speedZones[index] ?? 0) as 0 | 1 | 2 | 3;
        return cyclesPerGcrByte(zone);
      }
    }
    return cyclesPerGcrByte(this.density);
  }

  private getTrackAt(position: number): GcrTrack | null {
    if (this.media === null) return null;

    if (this.media.kind === 'g64') {
      const raw = this.media.image.mutableHalfTrack(position);
      if (raw === null) return null;
      const trackNumber = Math.max(1, Math.min(42, Math.floor(raw.track)));
      return {
        track: raw.track,
        density: densityForTrack(trackNumber),
        cyclesPerByte: cyclesPerGcrByte(densityForTrack(trackNumber)),
        bytes: raw.bytes
      };
    }

    const trackNumber = Math.max(1, Math.floor((position + 1) / 2));
    if (trackNumber > this.media.image.geometry.tracks) return null;
    const key = `d64:${trackNumber}`;
    let cached = this.trackCache.get(key);
    if (cached === undefined) {
      cached = buildGcrTrack(this.media.image, trackNumber);
      this.trackCache.set(key, cached);
    }
    return cached;
  }

  private commitDirtyD64Tracks(): void {
    if (this.media?.kind !== 'd64' || this.dirtyD64Tracks.size === 0) return;
    for (const trackNumber of this.dirtyD64Tracks) {
      const track = this.trackCache.get(`d64:${trackNumber}`);
      if (track !== undefined) decodeGcrTrackToD64(this.media.image, trackNumber, track.bytes);
    }
    this.dirtyD64Tracks.clear();
  }
}

function isSyncPosition(bytes: Uint8Array, index: number): boolean {
  if (bytes[index] !== 0xff || bytes.length < 2) return false;
  const previous = bytes[(index + bytes.length - 1) % bytes.length];
  const next = bytes[(index + 1) % bytes.length];
  return previous === 0xff || next === 0xff;
}
