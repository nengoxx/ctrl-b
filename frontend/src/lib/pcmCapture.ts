import { PCM_WORKLET_NAME, PCM_WORKLET_SOURCE } from "./pcmWorklet";

// THE CALL'S EAR, client side (Phase 24 / D71 §3.1 · §4.1 · §4.3) — one `getUserMedia`, one
// `AudioContext`, one worklet, and the two things the machine upstairs needs from them: a stream of
// `frame_ms` pcm16 frames with their RMS, and the honest answer to "is this track's echo cancellation
// the subtractive `all` mode".
//
// TWO ENTRY POINTS SINCE S2.5, and the split is the whole point:
//   · `startPcmCapture` — the CALL's: it opens its own `getUserMedia` and its own `AudioContext`,
//     because a call has no recorder beside it and owns the ear outright;
//   · `attachPcmUplink` — the worklet graph ALONE, over a context and a stream the CALLER already
//     holds. Streaming dictation (D71 §7-S2.5) is a THIRD consumer of the ONE stream `useDictation`
//     already opened for its `MediaRecorder` and its `armDetector` analyser (R70 §8) — never a second
//     `getUserMedia`, never a second context. `startPcmCapture` is written in terms of it, so the two
//     legs cannot drift into two different frame contracts.
// THE CONSTRAINTS ARE NO LONGER THIS MODULE'S ALONE (D73 S5): `micConstraints`/`openMicStream` below
// are what EVERY capture in the app asks with — the call's, and `useDictation`'s own `getUserMedia`,
// which closes R51 §6.1's "dictation passes no constraints" residual. R74 §0.3 is why that mattered:
// an unconstrained `audio: true` resolves to the platform AEC and lands in exactly the communication
// -mode trap the route knob exists to escape. One builder, so the two paths cannot ask differently.
//
// THE ECHO READBACK IS THE BARGE-IN GATE (§7-S0 ③, owner's device round): Chrome honours
// `echoCancellation: {ideal: "all"}` and genuinely SUBTRACTS the page's own playback, so the mic can stay
// open while the reply speaks and voice barge-in is viable. Fennec coerces the string to `true` and its
// AEC measurably does nothing against the phone's own output. So the capability is READ BACK per track
// (never UA-sniffed) and handed up; the machine arms the automatic interrupt only on `"all"` — and
// everywhere else it arms the EAR-HOLD instead (`setHeld`, S3), which is the same readback read for its
// other consequence: an ear that cannot be left open under the reply is closed while the reply speaks.

// ── THE ROUTE (D73 S5, evidence docs/research/R74) ───────────────────────────────────────────────
// Chrome Android puts the whole device into `MODE_IN_COMMUNICATION` — and re-tags the page's OWN
// output as voice-communication, i.e. the earpiece/speaker at call quality — as soon as it satisfies
// an echo-cancellation request with the platform's canceller (§1.1–§1.3, verified in source). Clearing
// AEC empties the effects mask, which is the single bit that decides the switch, so TTS goes back down
// the A2DP media path. `noiseSuppression` runs in software and stays on either way.
//
// It is ONE choice, not a codec toggle, because the physics come in a pair: with headphones on the
// head there is no acoustic echo path, so AEC off AND the ear-hold off is the honest configuration
// (R74 §9.2). `useLiveCall` resolves both halves from this one field — see its capture-ready block.

/** `voice.live.route`. Typed loosely at the seam because it arrives over the wire like
 *  `echo_workaround` does; anything that is not the headphones case IS the speaker case. */
export type MicRequest = {
  /** `"speaker"` (default) or `"headphones"`. Absent ⇒ speaker — a pre-S5 backend gets today's ear. */
  route?: string;
  /** `voice.live.input_device` — a browser-local `deviceId`, "" = the system default. */
  deviceId?: string;
};

const HEADPHONES = "headphones";

/** The one place the route string is read. A predicate rather than a comparison spread across three
 *  files: the constraints, the ear-hold and the barge-in arming must all answer it the same way. */
export function onHeadphones(route: string | undefined): boolean {
  return route === HEADPHONES;
}

/** The constraints EVERY capture in this app opens with (the call's, dictation's).
 *
 *  `echoCancellation: {ideal: "all"}` is NOT expressible in TS's `ConstrainBoolean` — the mode string
 *  is a Chromium extension of the spec's boolean slot — and the WebIDL degradation is exactly what we
 *  want elsewhere (a string handed to Firefox's boolean slot casts to `true`). So the object is built
 *  through an open local type, once, here, with the reason attached rather than spread through the file.
 *
 *  The device rides as `ideal`, never `exact`: on Android a momentarily unavailable communication
 *  device makes the stream come back as `nullptr` (R74 §2.2(b)), and a call that refuses to start
 *  because a headset is off the charger is worse than one on the default route. `openMicStream` owns
 *  the other half of that rule. */
export function micConstraints(req: MicRequest): MediaTrackConstraints {
  const audio: Record<string, unknown> = {
    echoCancellation: onHeadphones(req.route) ? false : { ideal: "all" },
    noiseSuppression: true,
    channelCount: 1,
  };
  if (req.deviceId) audio.deviceId = { ideal: req.deviceId };
  return audio;
}

/** `getUserMedia` with the route's constraints, plus the ONE retry the device choice needs.
 *
 *  `ideal` is not enough on its own: the Android failure mode is not a constraint the browser relaxes
 *  but a null stream — `MakeLowLatencyInputStream` returns `nullptr` when the selected communication
 *  device cannot be set (R74 §2.2(b)) — so the picked device is dropped and the default asked for
 *  once more. `fellBack` says so, because a call that silently came out of the phone speaker after the
 *  owner picked their headset is the failure this slice exists to make visible.
 *
 *  A REFUSED PERMISSION is never retried: the second ask would surface a second prompt for a decision
 *  the owner already made, and no device choice can repair it. */
export async function openMicStream(
  req: MicRequest,
): Promise<{ stream: MediaStream; fellBack: boolean }> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: micConstraints(req) });
    return { stream, fellBack: false };
  } catch (e) {
    const name = e instanceof Error ? e.name : "";
    if (!req.deviceId || name === "NotAllowedError" || name === "SecurityError") throw e;
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: micConstraints({ route: req.route }),
    });
    return { stream, fellBack: true };
  }
}

/** One selectable capture device, reduced to what a picker can render. */
export interface MicDevice {
  deviceId: string;
  label: string;
}

/**
 * The capture devices this browser will name — on Android, the ROUTE list ("Speakerphone", "Wired
 * headset", "Bluetooth headset", …), because that is what Chrome's audioinput enumeration returns
 * there (R74 §2.2) and the only routing lever a page has.
 *
 * LABELS ARE PERMISSION-GATED, which is the whole subtlety (Maya F4): before this origin has ever
 * been granted a capture, `enumerateDevices()` answers with entries whose `label` is "" — a list
 * nobody can choose from. `probe` takes ONE throwaway capture to earn the labels and re-reads; the
 * caller passes it only from a user gesture (the picker opening), never on mount.
 *
 * An entry with no label, or no id, is dropped rather than offered: an unnameable route is not a
 * choice, and a stored id that stops appearing here is treated by the picker as "not available",
 * never as something still standing.
 */
export async function listAudioInputs(probe = false): Promise<MicDevice[]> {
  // Annotated rather than asserted: the DOM lib types this as always present, and it is not — an
  // insecure context has no `mediaDevices` at all (the mic's own `micCapable` gate rests on that).
  const md: MediaDevices | undefined = navigator.mediaDevices;
  if (!md?.enumerateDevices) return [];
  const read = async (): Promise<MediaDeviceInfo[]> =>
    (await md.enumerateDevices()).filter((d) => d.kind === "audioinput");
  let inputs = await read();
  if (probe && inputs.length > 0 && inputs.every((d) => !d.label)) {
    try {
      const stream = await md.getUserMedia({ audio: micConstraints({}) });
      for (const t of stream.getTracks()) t.stop();
      inputs = await read();
    } catch {
      // Still no permission. The picker keeps the system default as its only offer, which is honest.
    }
  }
  return inputs
    .filter((d) => d.deviceId && d.label)
    .map((d) => ({ deviceId: d.deviceId, label: d.label }));
}

/** One uplink frame: pcm16 LE mono bytes, plus the RMS of the same samples (§4.3's energy gate reuses
 *  the worklet's own pass — there is deliberately no second AnalyserNode measuring the same audio). */
export interface PcmFrame {
  buf: ArrayBuffer;
  rms: number;
}

export interface PcmCapture {
  /** The context's REAL rate — what `start.sample_rate` must declare (§3.1: the browser gives 44.1k or
   *  48k by device and there is no reliable way to ask for 24k, so the relay resamples from this). */
  sampleRate: number;
  /** `getSettings().echoCancellation` for the live track: `"all"` on a Chromium that granted the
   *  system-loopback mode, `true`/`false` on a boolean-only implementation, `undefined` when the browser
   *  reports nothing at all. The one input to the trigger-A arming decision. */
  echoCancellation: string | boolean | undefined;
  /** D73 S5 — the configured `input_device` could not be opened and the DEFAULT route carries this
   *  call instead (`openMicStream`'s one retry). The caller says so; a silent fallback would leave the
   *  owner looking at a picked headset while the reply comes out of the phone. */
  fellBack: boolean;
  /** MUTE (§6's call furniture, D71 delta round F3 — the ONE mechanism). `track.enabled = false` keeps
   *  the graph running and the uplink FLOWING: the samples become digital silence, and the frames keep
   *  going out. That is the point — Speaches endpoints an utterance by OBSERVING silence, so starving it
   *  of frames instead would leave a half-spoken phrase open to merge with whatever is said after the
   *  unmute. Nothing else about the capture changes. */
  setMuted: (muted: boolean) => void;
  /** THE EAR-HOLD (S3 · §5.1's `echo_workaround`, the S0 ruling): the PROTECTIVE close, for a track whose
   *  AEC readback is not the subtractive `"all"` mode. There the phone's own playback rides back into the
   *  capture at near-full level (Fennec, measured — §7-S0 ③), so an ear left open under the reply would
   *  transcribe the character's own words into the owner's next message. While the mouth is audible the
   *  ear closes; interruption there is the tap (§4.3's trigger B), which is why nothing else is owed.
   *
   *  Mechanically it IS mute — `track.enabled`, frames still flowing as digital silence, for exactly the
   *  endpointing reason above — and the two share ONE effective rule (`enabled = !(muted || held)`) so
   *  neither setter can answer over the other: a hold released while the owner is muted must not reopen
   *  the ear, and an unmute under a live hold must not either. */
  setHeld: (held: boolean) => void;
  /** Release everything: the worklet, the graph, the context, the track, and the Blob URL. Idempotent. */
  stop: () => void;
}

export interface PcmCaptureOpts extends MicRequest {
  /** Uplink frame duration, from `/voice/status.live_call.frame_ms`. Never a constant in here. */
  frameMs: number;
  onFrame: (frame: PcmFrame) => void;
  /** The track ENDED on its own — permission revoked, a real phone call stole the mic, a headset
   *  unplugged (§4.5's capture-loss rule: the call ends in `error` with a plain reason). */
  onEnded: () => void;
}

/** The worklet graph, detachable (S2.5). Deliberately NOT a `PcmCapture`: it owns neither the stream
 *  nor the context, so it has nothing to release but its own node chain and its Blob URL. */
export interface PcmUplink {
  /** Stop delivering frames and release the Blob URL. Idempotent, and it leaves the context and the
   *  stream exactly as it found them — dictation's detector owns both and closes them on its own
   *  terminal path (`teardownAudio`), which is also what finally retires these nodes. */
  stop: () => void;
}

/**
 * Hang a pcm16 uplink off an EXISTING running context + stream (the S2.5 seam).
 *
 * Throws whatever the worklet install throws; anything it allocated before a later failure is
 * released on the way out, and the caller's context/stream are untouched either way.
 */
export async function attachPcmUplink(
  ctx: AudioContext,
  stream: MediaStream,
  opts: { frameMs: number; onFrame: (frame: PcmFrame) => void },
): Promise<PcmUplink> {
  let url: string | null = null;
  let detached = false;
  const stop = (): void => {
    if (detached) return;
    detached = true;
    if (url) URL.revokeObjectURL(url);
  };
  try {
    url = URL.createObjectURL(new Blob([PCM_WORKLET_SOURCE], { type: "text/javascript" }));
    await ctx.audioWorklet.addModule(url);
    const frameSamples = Math.max(1, Math.round((ctx.sampleRate * opts.frameMs) / 1000));
    const node = new AudioWorkletNode(ctx, PCM_WORKLET_NAME, {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      processorOptions: { frameSamples },
    });
    node.port.onmessage = (e: MessageEvent<PcmFrame>) => {
      if (!detached) opts.onFrame(e.data);
    };
    ctx.createMediaStreamSource(stream).connect(node);
    // A worklet is only PULLED while it is reachable from the destination, so the chain has to terminate
    // there — through a muted gain, because "reachable" must not also mean "audible". The processor
    // writes no output at all (its `outputs` stay zero-filled), so this path carries silence twice over;
    // the gain is the part that does not depend on that staying true.
    const mute = ctx.createGain();
    mute.gain.value = 0;
    node.connect(mute);
    mute.connect(ctx.destination);
    return { stop };
  } catch (e) {
    stop();
    throw e;
  }
}

/**
 * Open the call's capture chain. Throws whatever `getUserMedia` throws (a denied permission, an absent
 * device) — the caller renders that as the call's error terminal; everything it allocated before a later
 * failure is released on the way out.
 */
export async function startPcmCapture(opts: PcmCaptureOpts): Promise<PcmCapture> {
  // §4.1's constraints, now ROUTE-DERIVED and shared with dictation (D73 S5 — `micConstraints`).
  const { stream, fellBack } = await openMicStream(opts);
  const track = stream.getAudioTracks()[0];

  let ctx: AudioContext | null = null;
  let uplink: PcmUplink | null = null;
  let stopped = false;
  // THE TWO REASONS THE EAR CAN BE CLOSED, and the ONE rule that applies them (S3). They are independent
  // — the owner's mute and the call machine's echo hold — so each setter stores its own answer and both
  // route through `applyEnabled`; a setter that wrote `track.enabled` directly would silently revoke the
  // other's decision the moment the two overlapped.
  let muted = false;
  let held = false;
  const applyEnabled = (): void => {
    // Guarded on `stopped` for the same reason every other exit here is: a released track is not a muted
    // (or held) one, and re-enabling one the call has already torn down would be a lie about the ear.
    if (!stopped) track.enabled = !(muted || held);
  };
  const stop = (): void => {
    if (stopped) return;
    stopped = true;
    for (const t of stream.getTracks()) t.stop();
    if (ctx) void ctx.close().catch(() => {});
    // The graph's own release (its Blob URL): the uplink owns what it minted, this owns the context
    // and the track. Order is irrelevant — both are idempotent and neither reaches into the other.
    uplink?.stop();
  };

  try {
    ctx = new AudioContext();
    if (ctx.state === "suspended") await ctx.resume().catch(() => {});
    // A context that will not run is a SILENT CALL: the graph builds, the worklet installs, and not one
    // frame is ever pulled — the overlay would reach "Listening" and sit there forever with a dead ear.
    // Failing the start instead puts it where the owner can see it (the call's error terminal). The
    // gesture unlock this needs is `primeAudio`'s job, inside the tap; there is no second chance here.
    if (ctx.state !== "running") throw new Error("audio context suspended");
    uplink = await attachPcmUplink(ctx, stream, {
      frameMs: opts.frameMs,
      // The `stopped` guard stays HERE rather than riding the uplink's own `detached`: a released
      // CAPTURE must deliver nothing even in the window before `stop()` reaches the graph.
      onFrame: (frame) => {
        if (!stopped) opts.onFrame(frame);
      },
    });
    track.addEventListener("ended", () => {
      if (!stopped) opts.onEnded();
    });
    return {
      sampleRate: ctx.sampleRate,
      echoCancellation: track.getSettings().echoCancellation,
      fellBack,
      setMuted: (m: boolean) => {
        muted = m;
        applyEnabled();
      },
      setHeld: (h: boolean) => {
        held = h;
        applyEnabled();
      },
      stop,
    };
  } catch (e) {
    stop();
    throw e;
  }
}
