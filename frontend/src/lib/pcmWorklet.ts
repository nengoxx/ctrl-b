// THE CAPTURE WORKLET (Phase 24 / D71 §3.1 · §4.3) — the processor that turns the mic's 128-sample
// render quanta into the uplink's `frame_ms` pcm16 frames, and measures each frame's RMS on the way past.
//
// WHY THE PROCESSOR IS A SOURCE STRING AND NOT A MODULE FILE.
// `audioWorklet.addModule(url)` is the one asset load Vite does NOT special-case: `new Worker(new
// URL(...))` is compiled + emitted, `addModule` is an opaque runtime call. The alternative was
// `?worker&url`, and it was MEASURED rather than guessed: the BUILD emits a clean self-contained IIFE
// (loadable, though `globPatterns: **/*.js` then sweeps it into the PWA precache), but DEV serves the
// module with `import "/node_modules/vite/dist/client/env.mjs"` injected as its first line — a static
// import in an AudioWorklet global scope, which is exactly the dev-works/preview-works-differently split
// this must not have. A ~40-line processor inlined as a string has no serving question at all: one
// `Blob` URL, minted and revoked by the capture beside it, identical in dev, preview and prod, and
// invisible to Workbox.
//
// It is still ONE source of truth, not a copy: the unit suite EVALUATES this exact string against a fake
// `AudioWorkletProcessor`/`registerProcessor` pair and exercises the shipped `process()` — so the frame
// arithmetic, the clamp and the RMS are tested as the browser will run them, with nothing re-implemented
// beside them.
//
// THE FRAME CONTRACT (relay-enforced, `services/voice_live.py`): pcm16 LITTLE-ENDIAN mono at the rate the
// client declared in `start`, one frame ≤ `max_frame_bytes` AND ≤ 2× `frame_ms` of audio, and the
// sustained rate under 2× realtime. A worklet that emits exactly `frame_ms` per frame at capture speed
// satisfies all three by construction — which is why the frame size is a CONSTRUCTOR option (from the
// server's knob) and never a number in here.

/** The processor name `registerProcessor` publishes — the same string `new AudioWorkletNode` takes. */
export const PCM_WORKLET_NAME = "ctrlb-pcm-frames";

/** The processor, as the text handed to `audioWorklet.addModule` through a Blob URL.
 *
 *  `DataView.setInt16(…, true)` rather than an `Int16Array` view: the wire is LITTLE-ENDIAN by contract
 *  and a typed array would inherit the platform's order. Every target today is LE, so this costs nothing
 *  measurable and removes the assumption entirely.
 *
 *  The asymmetric scale (`32768` below zero, `32767` above) is the standard pcm16 mapping: it uses the
 *  full negative range without letting +1.0 wrap to −32768. Samples are clamped first — Web Audio does
 *  not guarantee −1..1 on an input that has been gained. */
export const PCM_WORKLET_SOURCE = `
class CtrlbPcmFrames extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const size = Math.round((options && options.processorOptions && options.processorOptions.frameSamples) || 0);
    this.size = size > 0 ? size : 128;
    this.buf = new Float32Array(this.size);
    this.n = 0;
  }

  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    // No input (the graph is still connecting, or the track went silent-by-disconnect) is not an end:
    // returning false would retire the processor for the rest of the call.
    if (!ch) return true;
    for (let i = 0; i < ch.length; i++) {
      this.buf[this.n++] = ch[i];
      if (this.n === this.size) this.emit();
    }
    return true;
  }

  emit() {
    const n = this.n;
    this.n = 0;
    const out = new ArrayBuffer(n * 2);
    const view = new DataView(out);
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const v = this.buf[i];
      sum += v * v;
      const c = v < -1 ? -1 : v > 1 ? 1 : v;
      view.setInt16(i * 2, Math.round(c < 0 ? c * 32768 : c * 32767), true);
    }
    // Transferred, not copied: at 48 kHz/40 ms this runs 25×/s on the audio thread.
    this.port.postMessage({ buf: out, rms: Math.sqrt(sum / n) }, [out]);
  }
}

registerProcessor(${JSON.stringify(PCM_WORKLET_NAME)}, CtrlbPcmFrames);
`;
