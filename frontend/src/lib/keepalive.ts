// THE BACKGROUND KEEPALIVE (D73 S6 ③ / R75 §12.2 A3, mechanism per Maya F2) — one node pair, two owners.
//
// Chrome Android FREEZES a hidden page that has made no sound for ~90 s: timers, `play()` and an
// AudioContext's render all stop with it, and thaw on return (R75 §3). The cure is to keep the page
// AUDIBLE in Blink's sense, which is literally `energy > 0` on a context's destination bus
// (`audio_context.cc:157`): an audible page is `IsBackgrounded() == false`, which removes the freeze AND
// background throttling wholesale. So: a `ConstantSourceNode` through a tiny gain into the destination.
//
// TWO CONTEXTS USE IT (ISS-73 ①, car-wave design §3.1 — "extract, don't duplicate"): the CALL's capture
// context (`pcmCapture.setKeepalive`, armed by `useLiveCall` while a call is hidden) and the mouth's
// REPLY HOLD (`audioController.holdWhileHidden`, while a reply or a clip upload is pending on a hidden
// page). One module, so the gain and the mint/retire rule cannot drift apart between them.
//
// It is not playback: it has no status, no event, and nothing above its owner can see it.

/** The keepalive's amplitude (D73 S6 ③). Inaudible on any device — it is ~80 dB below a normal signal,
 *  far under a phone speaker's own noise floor — and NONZERO, which is the whole requirement: Blink
 *  asks `energy > 0` of the rendered bus and nothing more (R75 §13, verified at `audio_context.cc:157`).
 *  Not a config knob: it is the platform's threshold, not the owner's preference. */
export const KEEPALIVE_GAIN = 1e-4;

export interface Keepalive {
  /** The one switch. Idempotent — a page that says "hidden" twice still runs ONE node. */
  set(on: boolean): void;
  /** Retire the node if it is running, and refuse every later ON: the owner is tearing its context
   *  down, and a keepalive outliving the graph it kept alive would be a page held audible by nothing. */
  close(): void;
}

/**
 * The keepalive for ONE context. A `ConstantSourceNode` cannot be restarted once stopped, so each ON
 * mints a fresh pair and each OFF retires it — which also keeps "is it running?" a single fact (the
 * node's existence) rather than a flag beside it.
 */
export function createKeepalive(ctx: AudioContext): Keepalive {
  let node: { src: ConstantSourceNode; gain: GainNode } | null = null;
  let closed = false;
  const set = (on: boolean): void => {
    const want = on && !closed;
    if (want === (node !== null)) return;
    if (node) {
      node.src.stop();
      node.src.disconnect();
      node.gain.disconnect();
      node = null;
      return;
    }
    // A constant source's `offset` defaults to 1, so the gain below IS the amplitude that reaches the
    // destination — DC, which costs nothing to render and still counts as energy.
    const src = ctx.createConstantSource();
    const gain = ctx.createGain();
    gain.gain.value = KEEPALIVE_GAIN;
    src.connect(gain);
    gain.connect(ctx.destination);
    src.start();
    node = { src, gain };
  };
  return {
    set,
    close() {
      set(false);
      closed = true;
    },
  };
}
