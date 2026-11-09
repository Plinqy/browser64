# Browser SID audio bridge

## Overview

`src/audio` is the browser-facing transport between the deterministic SID core and Web Audio. It does not emulate SID hardware and it never drives emulator time.

## Architecture

`Sid` runs at the selected C64 system clock and produces deterministic PCM samples. `SidAudio` drains those samples in blocks and transfers them to `sid-audio-worklet.js`. The AudioWorklet consumes the blocks on the browser audio-render thread and writes mono audio to an `AudioWorkletNode`.

The dependency direction is one-way:

`core/sid -> PCM queue -> SidAudio -> AudioWorklet`

Nothing under `src/core` imports browser audio APIs.

## Implementation discussion

Audio is deliberately push-buffered. The emulated machine remains the clock authority; Web Audio never tells the C64 how many SID cycles to execute. The worklet outputs zero on underrun and bounds its queued chunks when a throttled browser lets the producer get too far ahead. Browser scheduling errors therefore produce a short underrun/resynchronization instead of corrupting emulated hardware state.

Audio startup is also failure-safe. Worklet module loading, node creation, connection, and resume are treated as one operation; if any step fails, partially created nodes are disconnected and the temporary `AudioContext` is closed before the error is returned to the UI. Audio failure does not stop the C64 core.
