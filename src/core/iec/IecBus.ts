export type IecLine = 'atn' | 'clock' | 'data';

export interface IecBusSnapshot {
  readonly atnHigh: boolean;
  readonly clockHigh: boolean;
  readonly dataHigh: boolean;
}

const LINE_MASK: Readonly<Record<IecLine, number>> = Object.freeze({
  atn: 0x01,
  clock: 0x02,
  data: 0x04
});

/**
 * One participant on the three-wire serial IEC bus.
 *
 * IEC signal drivers are open collector: an endpoint can only pull a line low
 * or release it. The bus resolves high only when every endpoint releases the
 * line. This endpoint abstraction is intentionally drive-agnostic so a future
 * cycle-accurate 1541 can attach without changing C64-side wiring.
 */
export class IecEndpoint {
  private lowMask = 0;
  private detached = false;

  constructor(
    private readonly bus: IecBus,
    public readonly id: number,
    public readonly name: string
  ) {}

  setPulledLow(line: IecLine, pulledLow: boolean): void {
    this.assertAttached();
    const mask = LINE_MASK[line];
    const nextMask = pulledLow ? this.lowMask | mask : this.lowMask & ~mask;
    if (nextMask === this.lowMask) {
      return;
    }
    this.lowMask = nextMask;
    this.bus.updateEndpoint(this.id, this.lowMask);
  }

  release(line: IecLine): void {
    this.setPulledLow(line, false);
  }

  releaseAll(): void {
    this.assertAttached();
    if (this.lowMask === 0) {
      return;
    }
    this.lowMask = 0;
    this.bus.updateEndpoint(this.id, 0);
  }

  get atnHigh(): boolean {
    return this.bus.atnHigh;
  }

  get clockHigh(): boolean {
    return this.bus.clockHigh;
  }

  get dataHigh(): boolean {
    return this.bus.dataHigh;
  }

  snapshot(): IecBusSnapshot {
    return this.bus.snapshot();
  }

  detach(): void {
    if (this.detached) {
      return;
    }
    this.detached = true;
    this.lowMask = 0;
    this.bus.removeEndpoint(this.id);
  }

  /** @internal keep endpoint-local state coherent with a bus-wide release. */
  releaseFromBus(): void {
    if (!this.detached) {
      this.lowMask = 0;
    }
  }

  private assertAttached(): void {
    if (this.detached) {
      throw new Error(`IEC endpoint "${this.name}" is detached.`);
    }
  }
}

/**
 * Open-collector Commodore serial IEC bus for ATN, CLOCK, and DATA.
 *
 * `true` means a line is electrically released/high; `false` means at least
 * one participant is pulling it low. SRQ and RESET are deliberately deferred
 * until a physical drive/tape/peripheral model needs them.
 */
export class IecBus {
  private readonly endpointMasks = new Map<number, number>();
  private readonly endpoints = new Map<number, IecEndpoint>();
  private nextEndpointId = 1;
  private aggregateLowMask = 0;

  createEndpoint(name: string): IecEndpoint {
    const trimmedName = name.trim();
    if (trimmedName.length === 0) {
      throw new RangeError('IEC endpoint name must not be empty.');
    }

    const id = this.nextEndpointId;
    this.nextEndpointId += 1;
    const endpoint = new IecEndpoint(this, id, trimmedName);
    this.endpointMasks.set(id, 0);
    this.endpoints.set(id, endpoint);
    return endpoint;
  }

  get atnHigh(): boolean {
    return (this.aggregateLowMask & LINE_MASK.atn) === 0;
  }

  get clockHigh(): boolean {
    return (this.aggregateLowMask & LINE_MASK.clock) === 0;
  }

  get dataHigh(): boolean {
    return (this.aggregateLowMask & LINE_MASK.data) === 0;
  }

  snapshot(): IecBusSnapshot {
    return {
      atnHigh: this.atnHigh,
      clockHigh: this.clockHigh,
      dataHigh: this.dataHigh
    };
  }

  /** Release every currently attached participant without detaching it. */
  releaseAll(): void {
    for (const [id, endpoint] of this.endpoints) {
      endpoint.releaseFromBus();
      this.endpointMasks.set(id, 0);
    }
    this.aggregateLowMask = 0;
  }

  /** @internal endpoint-to-bus update path. */
  updateEndpoint(id: number, lowMask: number): void {
    if (!this.endpointMasks.has(id)) {
      throw new Error(`Unknown IEC endpoint ${id}.`);
    }
    this.endpointMasks.set(id, lowMask & 0x07);
    this.recomputeAggregate();
  }

  /** @internal endpoint detach path. */
  removeEndpoint(id: number): void {
    this.endpointMasks.delete(id);
    this.endpoints.delete(id);
    this.recomputeAggregate();
  }

  private recomputeAggregate(): void {
    let mask = 0;
    for (const endpointMask of this.endpointMasks.values()) {
      mask |= endpointMask;
    }
    this.aggregateLowMask = mask & 0x07;
  }
}
