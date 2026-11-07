# Browser SID audio bridge

## Overview

`src/audio` is the browser-facing transport between the deterministic SID core and Web Audio. It does not emulate SID hardware.

## Architecture

`Sid` runs at the C64 system clock and produces deterministic PCM samples. `SidAudio` drains those samples in blocks and transfers them to `sid-audio-worklet.js`. The AudioWorklet consumes the blocks on the browser audio-render thread and writes mono audio to an `AudioWorkletNode`.

The dependency direction is one-way:

`core/sid -> PCM queue -> SidAudio -> AudioWorklet`

Nothing under `src/core` imports browser APIs.

## Implementation discussion

Audio is deliberately push-buffered. The emulated machine remains the clock authority; Web Audio never tells the C64 how many SID cycles to execute. The worklet outputs zero on underrun and bounds its queue when a throttled browser lets the producer get too far ahead. This makes browser scheduling errors audible as a short underrun rather than allowing host timing to corrupt emulated hardware state.
