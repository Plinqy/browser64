import workletUrl from './sid-audio-worklet.js?url';
import type { Sid } from '../core/sid/Sid';

/** Browser-only sink that keeps Web Audio outside the deterministic SID core. */
export class SidAudio {
  private context: AudioContext | null = null;
  private node: AudioWorkletNode | null = null;
  private gain: GainNode | null = null;
  private muted = false;
  private startPromise: Promise<void> | null = null;

  constructor(private readonly sid: Sid) {}

  async start(): Promise<void> {
    if (this.context !== null) {
      if (this.context.state === 'suspended') await this.context.resume();
      return;
    }
    if (this.startPromise !== null) return this.startPromise;

    this.startPromise = this.createGraph();
    try {
      await this.startPromise;
    } finally {
      this.startPromise = null;
    }
  }

  flush(): void {
    if (this.node === null) return;
    const samples = this.sid.drainAudioSamples();
    if (samples.length === 0) return;
    this.node.port.postMessage({ type: 'samples', samples }, [samples.buffer]);
  }

  clear(): void {
    this.sid.drainAudioSamples();
    this.node?.port.postMessage({ type: 'clear' });
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.gain !== null) this.gain.gain.value = muted ? 0 : 1;
  }

  async dispose(): Promise<void> {
    this.node?.disconnect();
    this.gain?.disconnect();
    const context = this.context;
    this.context = null;
    this.node = null;
    this.gain = null;
    this.startPromise = null;
    if (context !== null && context.state !== 'closed') await context.close();
  }

  get active(): boolean {
    return this.context !== null && this.node !== null;
  }

  get state(): AudioContextState | 'off' {
    return this.context?.state ?? 'off';
  }

  get isMuted(): boolean {
    return this.muted;
  }

  private async createGraph(): Promise<void> {
    const context = new AudioContext({ latencyHint: 'interactive' });
    await context.audioWorklet.addModule(workletUrl);

    const node = new AudioWorkletNode(context, 'c64-sid-output', {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [1]
    });
    const gain = context.createGain();
    gain.gain.value = this.muted ? 0 : 1;
    node.connect(gain).connect(context.destination);

    this.context = context;
    this.node = node;
    this.gain = gain;
    this.sid.configureAudio(context.sampleRate);

    if (context.state === 'suspended') await context.resume();
  }
}
