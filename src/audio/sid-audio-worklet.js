class C64SidOutputProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.chunks = [];
    this.chunkIndex = 0;
    this.sampleIndex = 0;

    this.port.onmessage = (event) => {
      if (event.data?.type === 'clear') {
        this.chunks.length = 0;
        this.chunkIndex = 0;
        this.sampleIndex = 0;
        return;
      }

      if (event.data?.type === 'samples' && event.data.samples instanceof Float32Array) {
        this.chunks.push(event.data.samples);
        // Bound latency if the browser is throttled and the producer gets ahead.
        if (this.chunks.length - this.chunkIndex > 24) {
          this.chunks.splice(0, this.chunks.length - 12);
          this.chunkIndex = 0;
          this.sampleIndex = 0;
        }
      }
    };
  }

  process(_inputs, outputs) {
    const channel = outputs[0]?.[0];
    if (channel === undefined) return true;

    for (let index = 0; index < channel.length; index += 1) {
      while (this.chunkIndex < this.chunks.length &&
             this.sampleIndex >= this.chunks[this.chunkIndex].length) {
        this.chunkIndex += 1;
        this.sampleIndex = 0;
      }

      if (this.chunkIndex >= this.chunks.length) {
        channel[index] = 0;
        continue;
      }

      channel[index] = this.chunks[this.chunkIndex][this.sampleIndex++] ?? 0;
    }

    if (this.chunkIndex > 8) {
      this.chunks.splice(0, this.chunkIndex);
      this.chunkIndex = 0;
    }

    return true;
  }
}

registerProcessor('c64-sid-output', C64SidOutputProcessor);
