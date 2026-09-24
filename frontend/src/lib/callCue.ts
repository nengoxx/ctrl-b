// THE CALL'S SOUND CUE (Phase 24 / D76 §C.5, evidence docs/research/R85) — one short tone, played when
// the near-speech gate DROPS a final ("too quiet — didn't take that").
//
// WHY A SOUND. The drop already says so on the overlay's note line, but the call is a voice surface:
// in the car the owner cannot read the note, and a turn that silently went nowhere is the worst answer
// the gate can give. So the drop is heard as well as shown. R85 ⑤ is the field evidence: what makes
// Hermes' voice mode feel good is its audio cues (record/stop beeps, a thinking blip), not VAD
// accuracy. Always on and not a knob: it is a BEHAVIOUR of the gate, not a preference, and the
// constants below are named rather than configured for that reason.
//
// WHERE IT PLAYS. On the CAPTURE's own `AudioContext` — the one context a call already owns and has
// already unlocked with the owner's gesture (`startPcmCapture`), so the cue needs no autoplay grant and
// no second context. It is not the mouth: the reply's playback (`audioController`) knows nothing about
// it, and nothing in the call machine can see it, exactly like the keepalive beside it.

/** The tone's pitch, Hz — A4, a plain unmistakable note. Owner: the cue's own voice (fixed). */
export const CUE_HZ = 440;
/** Its level, linear gain into the destination — audible over a car, well under the reply. Owner: the
 *  cue's own voice (fixed). */
export const CUE_GAIN = 0.15;
/** Its length, ms — a blip, over before the owner could start their retry. Owner: the cue's own voice
 *  (fixed). */
export const CUE_MS = 120;
/** The attack/release ramp, ms: a sine switched on or off at full gain clicks audibly. A property of
 *  the signal, not a preference. */
export const CUE_RAMP_MS = 10;

/** Play the drop cue once on `ctx`. A context that is not running (closing on a teardown race, or
 *  suspended by the platform) plays nothing — a cue is never worth an exception in the call's path. */
export function playDropCue(ctx: AudioContext): void {
  if (ctx.state !== "running") return;
  const start = ctx.currentTime;
  const end = start + CUE_MS / 1000;
  const ramp = CUE_RAMP_MS / 1000;
  const osc = ctx.createOscillator();
  osc.type = "sine";
  osc.frequency.value = CUE_HZ;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(CUE_GAIN, start + ramp);
  gain.gain.setValueAtTime(CUE_GAIN, end - ramp);
  gain.gain.linearRampToValueAtTime(0, end);
  osc.connect(gain);
  gain.connect(ctx.destination);
  // The pair retires itself: a one-shot source cannot be restarted, and a finished node left connected
  // to the destination is a graph that grows by two nodes per dropped turn.
  osc.onended = () => {
    osc.disconnect();
    gain.disconnect();
  };
  osc.start(start);
  osc.stop(end);
}
