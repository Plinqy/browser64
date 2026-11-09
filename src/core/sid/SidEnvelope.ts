import { sidEnvelopeDac } from './SidDac';
import type { SidChipModel } from './SidModel';

export enum SidEnvelopeState {
  Attack = 'attack',
  DecaySustain = 'decay-sustain',
  Release = 'release'
}

// The SID does not use a binary divider for ADSR timing. A 15-bit LFSR is
// compared against one of these hardware states. The sequence lengths between
// matches yield the familiar 2 ms..8 s envelope rates while preserving the
// phase-dependent ADSR delay behavior when software changes rates mid-count.
const RATE_LFSR_MATCH = Object.freeze([
  0x007f, 0x3000, 0x1e00, 0x0660,
  0x0182, 0x5573, 0x000e, 0x3805,
  0x2424, 0x2220, 0x090c, 0x0ecd,
  0x010e, 0x23f7, 0x5237, 0x64a8
]);

/**
 * Cycle-clocked SID ADSR envelope generator.
 *
 * Rate timing follows the physical 15-bit LFSR prescaler rather than replacing
 * it with an elapsed-cycle counter. Gate/state changes and envelope decrements
 * are pipelined, which preserves the delay and $00/$FF boundary behaviors that
 * are visible through ENV3.
 */

export interface SidEnvelopeSnapshotState {
  readonly attack: number;
  readonly decay: number;
  readonly sustainLevel: number;
  readonly release: number;
  readonly gate: boolean;
  readonly rateLfsr: number;
  readonly activeRateMatch: number;
  readonly rateResetPending: boolean;
  readonly exponentialCounter: number;
  readonly exponentialPeriod: number;
  readonly deferredExponentialPeriod: number;
  readonly envelopeStepPipeline: number;
  readonly exponentialPipeline: number;
  readonly counterEnabled: boolean;
  readonly envelopeCounter: number;
  readonly envReadLatch: number;
  readonly state: SidEnvelopeState;
  readonly nextState: SidEnvelopeState;
  readonly statePipeline: number;
}

export class SidEnvelope {
  private attack = 0;
  private decay = 0;
  private sustainLevel = 0;
  private release = 0;
  private gate = false;

  private rateLfsr = 0x7fff;
  private activeRateMatch = RATE_LFSR_MATCH[0]!;
  private rateResetPending = false;

  private exponentialCounter = 0;
  private exponentialPeriod = 1;
  private deferredExponentialPeriod = 0;
  private envelopeStepPipeline = 0;
  private exponentialPipeline = 0;
  private counterEnabled = true;

  // Power-up pattern observed by die-informed SID models. RESET does not clear
  // the envelope counter itself.
  private envelopeCounter = 0xaa;
  private envReadLatch = 0xaa;
  private stateValue = SidEnvelopeState.Release;
  private nextState = SidEnvelopeState.Release;
  private statePipeline = 0;

  constructor(private model: SidChipModel) {
    this.reset();
  }

  reset(): void {
    this.attack = 0;
    this.decay = 0;
    this.sustainLevel = 0;
    this.release = 0;
    this.gate = false;

    // Reset schedules the ADSR prescaler back to its all-ones state. The
    // envelope DAC counter itself is deliberately preserved by the reset pin.
    this.rateResetPending = true;
    this.exponentialCounter = 0;
    this.exponentialPeriod = 1;
    this.deferredExponentialPeriod = 0;
    this.envelopeStepPipeline = 0;
    this.exponentialPipeline = 0;
    this.counterEnabled = true;

    this.stateValue = SidEnvelopeState.Release;
    this.nextState = SidEnvelopeState.Release;
    this.statePipeline = 0;
    this.activeRateMatch = RATE_LFSR_MATCH[this.release]!;
    this.envReadLatch = this.envelopeCounter;
  }

  setModel(model: SidChipModel): void {
    this.model = model;
  }

  saveState(): SidEnvelopeSnapshotState {
    return {
      attack: this.attack, decay: this.decay, sustainLevel: this.sustainLevel, release: this.release, gate: this.gate,
      rateLfsr: this.rateLfsr, activeRateMatch: this.activeRateMatch, rateResetPending: this.rateResetPending,
      exponentialCounter: this.exponentialCounter, exponentialPeriod: this.exponentialPeriod,
      deferredExponentialPeriod: this.deferredExponentialPeriod, envelopeStepPipeline: this.envelopeStepPipeline,
      exponentialPipeline: this.exponentialPipeline, counterEnabled: this.counterEnabled,
      envelopeCounter: this.envelopeCounter, envReadLatch: this.envReadLatch,
      state: this.stateValue, nextState: this.nextState, statePipeline: this.statePipeline
    };
  }

  restoreState(state: SidEnvelopeSnapshotState): void {
    this.attack = state.attack & 0x0f; this.decay = state.decay & 0x0f;
    this.sustainLevel = state.sustainLevel & 0xff; this.release = state.release & 0x0f; this.gate = state.gate;
    this.rateLfsr = state.rateLfsr & 0x7fff; this.activeRateMatch = Math.max(0, Math.trunc(state.activeRateMatch));
    this.rateResetPending = state.rateResetPending; this.exponentialCounter = Math.max(0, Math.trunc(state.exponentialCounter));
    this.exponentialPeriod = Math.max(1, Math.trunc(state.exponentialPeriod));
    this.deferredExponentialPeriod = Math.max(0, Math.trunc(state.deferredExponentialPeriod));
    this.envelopeStepPipeline = Math.max(0, Math.trunc(state.envelopeStepPipeline));
    this.exponentialPipeline = Math.max(0, Math.trunc(state.exponentialPipeline)); this.counterEnabled = state.counterEnabled;
    this.envelopeCounter = state.envelopeCounter & 0xff; this.envReadLatch = state.envReadLatch & 0xff;
    this.stateValue = state.state; this.nextState = state.nextState; this.statePipeline = Math.max(0, Math.trunc(state.statePipeline));
  }

  writeAttackDecay(value: number): void {
    this.attack = (value >>> 4) & 0x0f;
    this.decay = value & 0x0f;

    if (this.stateValue === SidEnvelopeState.Attack) {
      this.activeRateMatch = RATE_LFSR_MATCH[this.attack]!;
    } else if (this.stateValue === SidEnvelopeState.DecaySustain) {
      this.activeRateMatch = RATE_LFSR_MATCH[this.decay]!;
    }
  }

  writeSustainRelease(value: number): void {
    const sustainNibble = (value >>> 4) & 0x0f;
    this.sustainLevel = (sustainNibble << 4) | sustainNibble;
    this.release = value & 0x0f;

    if (this.stateValue === SidEnvelopeState.Release) {
      this.activeRateMatch = RATE_LFSR_MATCH[this.release]!;
    }
  }

  setGate(enabled: boolean): void {
    if (enabled === this.gate) return;
    this.gate = enabled;

    if (enabled) {
      this.nextState = SidEnvelopeState.Attack;
      this.statePipeline = 2;

      // A gate edge can intersect either of the decrement pipelines. These
      // delays are observable and are part of the SID's ADSR boundary quirks.
      if (this.rateResetPending || this.exponentialPipeline === 2) {
        this.envelopeStepPipeline =
          this.exponentialPeriod === 1 || this.exponentialPipeline === 2 ? 2 : 4;
      } else if (this.exponentialPipeline === 1) {
        this.statePipeline = 3;
      }
      return;
    }

    this.nextState = SidEnvelopeState.Release;
    this.statePipeline = this.envelopeStepPipeline > 0 ? 3 : 2;
  }

  clock(): void {
    // ENV3 samples the envelope DAC counter before this cycle's internal work.
    this.envReadLatch = this.envelopeCounter;

    if (this.deferredExponentialPeriod > 0) {
      this.exponentialPeriod = this.deferredExponentialPeriod;
      this.deferredExponentialPeriod = 0;
    }

    if (this.statePipeline > 0) this.clockStatePipeline();

    // These are a priority chain only when a pipeline *fires*. A pipeline
    // that merely counts down without reaching zero does not block the next
    // internal stage during the same SID cycle.
    let internalStageHandled = false;

    if (this.envelopeStepPipeline > 0) {
      this.envelopeStepPipeline -= 1;
      if (this.envelopeStepPipeline === 0) {
        this.applyEnvelopeStep();
        internalStageHandled = true;
      }
    }

    if (!internalStageHandled && this.exponentialPipeline > 0) {
      this.exponentialPipeline -= 1;
      if (this.exponentialPipeline === 0) {
        this.exponentialCounter = 0;
        const decayStillAboveSustain =
          this.stateValue === SidEnvelopeState.DecaySustain &&
          this.envelopeCounter !== this.sustainLevel;
        if (decayStillAboveSustain || this.stateValue === SidEnvelopeState.Release) {
          this.envelopeStepPipeline = 1;
        }
        internalStageHandled = true;
      }
    }

    if (!internalStageHandled && this.rateResetPending) {
      this.rateLfsr = 0x7fff;
      this.rateResetPending = false;

      if (this.stateValue === SidEnvelopeState.Attack) {
        this.exponentialCounter = 0;
        this.envelopeStepPipeline = 2;
      } else if (this.counterEnabled) {
        this.exponentialCounter += 1;
        if (this.exponentialCounter === this.exponentialPeriod) {
          this.exponentialPipeline = this.exponentialPeriod === 1 ? 1 : 2;
        }
      }
    }

    this.clockRateLfsr();
  }

  /** Current 8-bit envelope DAC counter. */
  get level(): number {
    return this.envelopeCounter;
  }

  /** ENV3-visible value sampled at the start of the most recent SID cycle. */
  get readbackLevel(): number {
    return this.envReadLatch;
  }

  get state(): SidEnvelopeState {
    return this.stateValue;
  }

  /** Raw 15-bit ADSR prescaler state, useful to timing/debugger tooling. */
  get rateLfsrValue(): number {
    return this.rateLfsr;
  }

  /** Backward-compatible debugger alias retained from the pre-LFSR model. */
  get rateCounterValue(): number {
    return this.rateLfsr;
  }

  get currentExponentialPeriod(): number {
    return this.exponentialPeriod;
  }

  outputLevel(): number {
    return sidEnvelopeDac(this.model, this.envelopeCounter);
  }

  private clockRateLfsr(): void {
    if (this.rateLfsr === this.activeRateMatch) {
      this.rateResetPending = true;
      return;
    }

    const feedback = ((this.rateLfsr & 0x0001) ^ ((this.rateLfsr >>> 1) & 0x0001)) << 14;
    this.rateLfsr = ((this.rateLfsr >>> 1) | feedback) & 0x7fff;
  }

  private clockStatePipeline(): void {
    this.statePipeline -= 1;

    switch (this.nextState) {
      case SidEnvelopeState.Attack:
        if (this.statePipeline === 1) {
          // For one phase of a rising gate edge the decay selector is still on
          // the rate multiplexer before attack takes ownership.
          this.activeRateMatch = RATE_LFSR_MATCH[this.decay]!;
        } else if (this.statePipeline === 0) {
          this.stateValue = SidEnvelopeState.Attack;
          this.activeRateMatch = RATE_LFSR_MATCH[this.attack]!;
          this.counterEnabled = true;
        }
        break;

      case SidEnvelopeState.DecaySustain:
        if (this.statePipeline === 0) {
          this.stateValue = SidEnvelopeState.DecaySustain;
          this.activeRateMatch = RATE_LFSR_MATCH[this.decay]!;
        }
        break;

      case SidEnvelopeState.Release:
        if (
          (this.stateValue === SidEnvelopeState.Attack && this.statePipeline === 0) ||
          (this.stateValue === SidEnvelopeState.DecaySustain && this.statePipeline === 1)
        ) {
          this.stateValue = SidEnvelopeState.Release;
          this.activeRateMatch = RATE_LFSR_MATCH[this.release]!;
        }
        break;
    }
  }

  private applyEnvelopeStep(): void {
    if (!this.counterEnabled) return;

    if (this.stateValue === SidEnvelopeState.Attack) {
      this.envelopeCounter = (this.envelopeCounter + 1) & 0xff;
      if (this.envelopeCounter === 0xff) {
        this.nextState = SidEnvelopeState.DecaySustain;
        this.statePipeline = 3;
      }
    } else {
      this.envelopeCounter = (this.envelopeCounter - 1) & 0xff;
      if (this.envelopeCounter === 0x00) this.counterEnabled = false;
    }

    this.scheduleExponentialPeriodForLevel();
  }

  private scheduleExponentialPeriodForLevel(): void {
    switch (this.envelopeCounter) {
      case 0xff:
      case 0x00:
        this.deferredExponentialPeriod = 1;
        break;
      case 0x5d: this.deferredExponentialPeriod = 2; break;
      case 0x36: this.deferredExponentialPeriod = 4; break;
      case 0x1a: this.deferredExponentialPeriod = 8; break;
      case 0x0e: this.deferredExponentialPeriod = 16; break;
      case 0x06: this.deferredExponentialPeriod = 30; break;
      default: break;
    }
  }
}
