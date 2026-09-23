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
//
// THE THIRD ANSWER (D75 ①, evidence docs/research/R80 §10-①): `speaker-hifi` — the LOUDSPEAKER with
// echo cancellation OFF. It is the same escape from comm mode that `headphones` takes, on the route
// that has an acoustic echo path, so the bargain is the other one: media-path audio (the owner proved
// it clean on their phone where the EC-on route crackles — ISS-16), paid for with an ear that CLOSES
// while the reply speaks, and the tap as the only interrupt. Nothing in use is lost by offering it:
// `barge_in` ships OFF (D74 addendum ⑨), and the field's own posture is half-duplex by default
// (R79 §5 — Open WebUI is deaf for the whole assistant turn out of the box). The ear-hold needs no new
// rule for it: the hold's `auto` arm already reads the TRACK, and an EC-off track reads back non-`all`.

/** `voice.live.route`. Typed loosely at the seam because it arrives over the wire like
 *  `echo_workaround` does; anything that is not one of the named answers IS the plain speaker case. */
export type MicRequest = {
  /** `"speaker"` (default), `"speaker-hifi"` or `"headphones"`. Absent ⇒ speaker — a pre-S5 backend
   *  gets today's ear. */
  route?: string;
  /** `voice.live.input_device` — a browser-local `deviceId`, "" = the system default. */
  deviceId?: string;
};

/** The three answers the route knob takes. Exported since D74 S2 put the choice on the call screen: the
 *  overlay's picker has to be able to NAME them, and a fourth file spelling `"headphones"` by hand is
 *  how one of them eventually gets it wrong. `SPEAKER` is the default in the sense that everything
 *  which is not a named answer IS the plain speaker case — see the predicates below. */
export const ROUTE_HEADPHONES = "headphones";
export const ROUTE_SPEAKER = "speaker";
export const ROUTE_SPEAKER_HIFI = "speaker-hifi";

/** The one place the route string is read. A predicate rather than a comparison spread across three
 *  files: the constraints, the ear-hold and the barge-in arming must all answer it the same way. */
export function onHeadphones(route: string | undefined): boolean {
  return route === ROUTE_HEADPHONES;
}

/** …and the OTHER question the same string answers (D75 ①): does this route want the platform's
 *  canceller at all? TRUE only for the plain-speaker case. Both EC-off routes share every consequence
 *  that matters below — the empty effects mask, the skipped `MODE_IN_COMMUNICATION` flip, the media-path
 *  output, the R77 SCO trap and the ear-hold's `auto` arm — so they are asked as ONE predicate rather
 *  than as two comparisons that could drift apart. */
export function wantsAec(route: string | undefined): boolean {
  return !onHeadphones(route) && route !== ROUTE_SPEAKER_HIFI;
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
    echoCancellation: wantsAec(req.route) ? { ideal: "all" } : false,
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
  // The picker's label probe first, if one is mid-flight (S5 review F1) — its throwaway grab could
  // otherwise hold the very route this capture is about to ask for.
  if (probeInFlight) await probeInFlight;
  // The WALK (code round F3): each candidate in order, aborting only on the two failures more
  // attempts cannot improve — a denied permission is denied for every rung. `fellBack` stays what it
  // has always meant: the OWNER'S pick did not carry this call (a steer rung falling to its neighbour
  // is this module's own business, not a note for the screen — the owner picked nothing).
  const list = await candidateConstraints(req);
  let lastErr: unknown;
  for (let i = 0; i < list.length; i++) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: list[i] });
      return { stream, fellBack: i > 0 && !!req.deviceId };
    } catch (e) {
      lastErr = e;
      const name = e instanceof Error ? e.name : "";
      if (name === "NotAllowedError" || name === "SecurityError") throw e;
    }
  }
  throw lastErr;
}

// ── THE STEERING RULE (D74 S3, evidence docs/research/R77) ───────────────────────────────────────
// "The system default input" is NOT neutral on Android. Chrome picks the MOST UNIQUE communication
// device, and with a classic BT headset connected that is the Bluetooth row (R77 §1.2) — which starts
// SCO, which makes AOSP suspend the A2DP output, whose frames are then DISCARDED ("Simulate write to
// HAL when suspended"). The media-quality TTS an EC-off route exists for — down the A2DP path —
// becomes SILENCE; and because those routes clear AEC there is no communication-mode exit to restore
// anything on teardown either (R77 §2.1). So where the page can SEE that trap it steers around it, to
// a row that leaves `STRATEGY_MEDIA` alone: the earpiece first (picking it forces nothing at all),
// then the wired headset, then the speakerphone (which forces `FOR_COMMUNICATION` only — a slot
// `STRATEGY_MEDIA` never reads).
//
// CAPABILITY-SHAPED, NEVER UA-SNIFFED. The test is that the audioinput list IS Chrome's fixed
// synthetic communication-device list — five names hardcoded in English in
// `CommunicationDeviceSelector.java` — and that the Bluetooth row is in it. A desktop's real
// microphones, or Fennec's, match nothing and steer nowhere. An explicit owner pick always wins:
// this only ever resolves the EMPTY device, i.e. "system default".
//
// It cannot fire on a page that has never been granted a capture (the labels are permission-gated and
// `listAudioInputs` drops unnameable rows), which is the honest degrade: with no list there is no
// evidence, and the request goes out exactly as it did before this rule existed.

/** Chrome's synthetic communication-device names (`DEVICE_NAMES`), and the Bluetooth row the whole
 *  fork turns on. */
const ROUTE_LABELS: ReadonlySet<string> = new Set([
  "Speakerphone",
  "Wired headset",
  "Headset earpiece",
  "Bluetooth headset",
  "USB audio",
]);
const BT_ROW = "Bluetooth headset";
/** Where to steer, in R77 §5's own ranking: rows 3′ then 3 — least forced first. */
const STEER_TO: readonly string[] = ["Headset earpiece", "Wired headset", "Speakerphone"];

/** The audioinput list AS Chrome's synthetic route list, or `null` when it is anything else. */
function syntheticRoutes(inputs: MicDevice[]): Map<string, string> | null {
  const rows = new Map<string, string>();
  for (const d of inputs) {
    // Every row has to be one of the five, or this is not the list (a desktop's "Microphone
    // (Realtek…)" fails here, which is exactly the intent). Chrome's own localized "Default …" entry
    // — the one row that could never be matched by NAME — never reaches here: `listAudioInputs`
    // drops it at the source.
    if (!ROUTE_LABELS.has(d.label)) return null;
    rows.set(d.label, d.deviceId);
  }
  // Speakerphone ALWAYS exists in that list (`setDeviceExistence(ID_SPEAKERPHONE, true)`), so its
  // absence means this is not the list either — and it is the steer's guaranteed last rung, which is
  // what makes "never fall through to the default while the BT row stands" structural rather than
  // hopeful.
  return rows.has("Speakerphone") ? rows : null;
}

/** Every constraint set this request may open with, IN ORDER (code round F3 reshaped the single
 *  `steered()` resolution into this ladder): the owner's explicit pick first when there is one, then —
 *  for any EC-OFF route on the synthetic list with a Bluetooth row standing — each steer rung that
 *  exists, and NEVER the bare default while that row stands (the default selection is the SCO trap,
 *  R77 (a)). Everywhere else the tail is the plain default request, exactly as before the steer
 *  existed. `openMicStream` walks this list, so a steered rung that will not open falls to the NEXT
 *  rung instead of throwing — the Speakerphone rung's guaranteed presence still bounds the walk.
 *
 *  THE MISSING TAIL IS A RULING, not an oversight (D74 code round F3a, overruled twice on the
 *  record): a desktop whose every audioinput label coincidentally equals Chrome's five Android-only
 *  synthetic names AND whose named devices are all busy while the system default works would fail
 *  here where a default tail would have carried it. Accepted residual — on the one platform where
 *  this list shape occurs for real, that tail is the silent-TTS SCO trap (R77), and a LOUD capture
 *  failure (the owner sees the mic error) beats a silently dead call every time. */
async function candidateConstraints(req: MicRequest): Promise<MediaTrackConstraints[]> {
  const out: MediaTrackConstraints[] = [];
  if (req.deviceId) out.push(micConstraints(req));
  // THE GATE IS THE EC ANSWER, not the headphones name (D75 ①): the trap this ladder avoids is a
  // property of EC-OFF CAPTURE — an empty effects mask means no comm-mode flip, so the output stays on
  // `STRATEGY_MEDIA` and an SCO link started by the default selection suspends it into silence, with no
  // mode exit left to restore anything. `speaker-hifi` rides exactly the same physics as `headphones`,
  // so it rides the same steer; the plain speaker route is in comm mode by construction and is left
  // alone (moving its device would change a shipped behaviour this rule has no evidence about).
  if (!wantsAec(req.route)) {
    const rows = syntheticRoutes(await listAudioInputs());
    if (rows?.has(BT_ROW)) {
      for (const label of STEER_TO) {
        const id = rows.get(label);
        if (id !== undefined) out.push(micConstraints({ ...req, deviceId: id }));
      }
      return out;
    }
  }
  out.push(micConstraints({ route: req.route }));
  return out;
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
/** The label probe in flight, or null (S5 review F1). The probe's throwaway capture can hold the
 *  Android communication device for the instant it lives, and a REAL capture opening inside that
 *  instant would fail over to the default route for no true reason — so `openMicStream` awaits any
 *  running probe first. One direction only, deliberately: while a real capture is LIVE the labels
 *  are already earned, so the probe branch below never fires against one. */
let probeInFlight: Promise<void> | null = null;

export async function listAudioInputs(probe = false): Promise<MicDevice[]> {
  // Annotated rather than asserted: the DOM lib types this as always present, and it is not — an
  // insecure context has no `mediaDevices` at all (the mic's own `micCapable` gate rests on that).
  const md: MediaDevices | undefined = navigator.mediaDevices;
  if (!md?.enumerateDevices) return [];
  const read = async (): Promise<MediaDeviceInfo[]> =>
    (await md.enumerateDevices()).filter((d) => d.kind === "audioinput");
  let inputs = await read();
  if (probe && inputs.length > 0 && inputs.every((d) => !d.label)) {
    // ONE PROBE AT A TIME (D74 S6 ⑧). A second ask landing while the first is still in flight used to
    // mint a SECOND throwaway capture and overwrite the latch — so `openMicStream` would then wait on
    // the newer probe while the older one was still holding the Android communication device, which
    // is precisely the race the latch exists to close. Riding the probe already running costs
    // nothing: what a caller wants is the LABELS, and they land for everyone at once.
    const running = probeInFlight;
    if (running) {
      await running;
      inputs = await read();
    } else {
      const run = (async () => {
        const stream = await md.getUserMedia({ audio: micConstraints({}) });
        for (const t of stream.getTracks()) t.stop();
      })();
      // The latch holds the SETTLED promise, never the rejection: its one consumer only cares that
      // the probe's tracks are gone, not why.
      probeInFlight = run
        .catch(() => {})
        .finally(() => {
          probeInFlight = null;
        });
      try {
        await run;
        inputs = await read();
      } catch {
        // Still no permission. The picker keeps the system default as its only offer, which is honest.
      }
    }
  }
  // Chrome's virtual `default` / `communications` rows are DROPPED, not offered (owner, 2026-09-23:
  // "System default" and "Default" side by side — "one entry"). They name the same routing decision
  // as the picker's own empty pick, and they are the worse spelling of it: an explicit `deviceId`
  // wins the constraint ladder outright (`candidateConstraints`), so picking "Default" on an EC-off
  // route would step around the SCO steer and walk into the silent-TTS trap the ladder exists to
  // avoid. The empty pick rides the ladder; nothing is lost by hiding the row.
  return inputs
    .filter((d) => d.deviceId && d.label)
    .filter((d) => d.deviceId !== "default" && d.deviceId !== "communications")
    .map((d) => ({ deviceId: d.deviceId, label: d.label }));
}

/** The keepalive's amplitude (D73 S6 ③). Inaudible on any device — it is ~80 dB below a normal signal,
 *  far under a phone speaker's own noise floor — and NONZERO, which is the whole requirement: Blink
 *  asks `energy > 0` of the rendered bus and nothing more (R75 §13, verified at `audio_context.cc:157`).
 *  Not a config knob: it is the platform's threshold, not the owner's preference. */
const KEEPALIVE_GAIN = 1e-4;

/** One uplink frame: pcm16 LE mono bytes, plus the RMS of the same samples (§4.3's energy gate reuses
 *  the worklet's own pass — there is deliberately no second AnalyserNode measuring the same audio). */
export interface PcmFrame {
  buf: ArrayBuffer;
  rms: number;
}

/**
 * WHAT THE TRACK ITSELF SAYS (D74 S7, evidence docs/research/R78 §1.4 · §6.2).
 *
 * Read ONCE, at open, because all four are synchronous property reads that never change for the life
 * of a track — and because the one question they answer together is "what did we actually get", which
 * is a fact about the moment it opened.
 *
 * The PAIR is the point. `getSettings().echoCancellation` is the GRANT of the resolved mode, computed
 * from the ENUMERATION-time effects mask; `getCapabilities().echoCancellation` is computed from the
 * OPEN-time one. Chromium has a commented-out `CHECK` sitting exactly on the mismatch
 * (`crbug.com/405165917`), and comparing the two is the one free field probe that separates "the
 * device stopped offering the canceller" from "it offered it and we did not get it".
 */
export interface MicReadback {
  /** `"all"` on a Chromium that granted the system-loopback mode, `true`/`false` on a boolean-only
   *  implementation, `undefined` when the browser reports nothing at all. The ONE input to the
   *  trigger-A arming decision — and it is passed up RAW, never coerced: `"all"` and `true` mean
   *  opposite things here and a boolean cast would erase the difference. */
  echoCancellation: string | boolean | undefined;
  /** …and the other sample. `undefined` where the browser has no audio-track capabilities at all,
   *  reported honestly rather than defaulted (R78 §7). */
  echoCapabilities: readonly (string | boolean)[] | undefined;
  /** Which device actually opened, in the browser's own words. */
  label: string;
  deviceId: string;
}

export interface PcmCapture {
  /** The context's REAL rate — what `start.sample_rate` must declare (§3.1: the browser gives 44.1k or
   *  48k by device and there is no reliable way to ask for 24k, so the relay resamples from this). */
  sampleRate: number;
  /** The live track's own readback — the arming decision's input, and the overlay's debug block. */
  readback: MicReadback;
  /** D73 S5 — the configured `input_device` could not be opened and the DEFAULT route carries this
   *  call instead (`openMicStream`'s one retry). The caller says so; a silent fallback would leave the
   *  owner looking at a picked headset while the reply comes out of the phone. */
  fellBack: boolean;
  /** D75 ③ — this capture ASKED for echo cancellation off and the track came back with it ON, twice
   *  (see `openEcChecked`). Advisory only: everything that governs the ear reads the READBACK and never
   *  the ask, so a stuck track is governed as the track it IS — and which track that is depends on the
   *  readback's VALUE, not merely on the mismatch (review round C4; `useLiveCall`'s capture-ready block
   *  states the same rule from the other side). An `"all"` readback is the genuinely subtractive mode, so
   *  the hold LIFTS and — with `barge_in` on — the voice interrupt arms, exactly as for a speaker-route
   *  track; only a bare `true` (or `false`/absent) readback leaves the hold armed. What the owner loses
   *  is the route's whole point — media-path audio — and nothing else on the screen could tell them. */
  ecStuck: boolean;
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
  /** THE EAR'S OWN LIVENESS (D73 S6 ② / R75 §12.2 A2): milliseconds since the last frame this capture
   *  actually HEARD. The number exists because the failure it measures is SILENT — Chrome Android
   *  freezes a hidden, inaudible page and the freeze PAUSES the AudioContext (`base_audio_context.cc`,
   *  R75 §3.4), so `process()` stops being called, no frames are minted, and every other observable
   *  stays healthy: the track is `live`, the permission granted, the socket open, the overlay still
   *  saying Listening. A gap is the one tell.
   *
   *  Frames arriving while the track is OS-MUTED (another app took the mic) do not count as hearing —
   *  they are digital silence, and a stretch of them is exactly as deaf as a paused graph. That is what
   *  the `mute`/`unmute` listeners are for; nothing else in the capture reads them.
   *
   *  A stamp of ARRIVAL, deliberately, not of some audio clock: the freeze mints nothing, so there is
   *  no backlog to flush on resume and no way for a queued frame to pretend the ear was awake. */
  earGapMs: () => number;
  /** THE BACKGROUND KEEPALIVE (D73 S6 ③ / R75 §12.2 A3, mechanism per Maya F2). A `ConstantSourceNode`
   *  through a tiny gain into THIS context's destination, started while the page is hidden.
   *
   *  Blink's audibility test is literally `energy > 0` on the destination bus (`audio_context.cc:157`),
   *  and an audible page is `IsBackgrounded() == false`, which removes the freeze AND background
   *  throttling wholesale. Raising the uplink chain's own sink gain does NOT work: the worklet writes
   *  no output at all, so that path multiplies zero — hence a source of our own.
   *
   *  It lives here because this context is this module's, and it is invisible to everything above: it
   *  is not playback, it has no status, and no rule in the call machine can see it. Idempotent. */
  setKeepalive: (on: boolean) => void;
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

// ── THE EC-RELEASE BARRIER (D75 ③, evidence docs/research/R80 §5) ────────────────────────────────
// The communication mode is evaluated ONLY for the FIRST input stream (`has_input_streams` early-return)
// and restored ONLY when the LAST one is released — and that release happens in the audio SERVICE, after
// a mojo round trip, while our recapture calls `stop()` and `getUserMedia` back to back with no barrier
// (R80 §5.1–§5.2, verified in Chromium source). Lose that race and two things are true at once: the
// device stays in `MODE_IN_COMMUNICATION`, and — R78 §2.3's pin — `EchoCancellationContainer` collapses
// our naked `echoCancellation: false` onto the mode of the still-live first source, so an "EC-off" ask
// comes back EC-ON. The crackle survives the flip, which is exactly the owner's "sometimes it clears it".
//
// The readback is the free detector, and the fix is DETECTION-DRIVEN: nothing waits unless the flip is
// observed to have failed. Only then is the stream released and the open run once more, with a beat in
// between for the old stream's release to reach the service — which is all the "barrier" the platform
// offers, since no API surfaces "the old input stream is gone".

/** How long to give the audio service to reap the released input stream before asking again, ms. A
 *  PLATFORM property like `EAR_OUTAGE_MS` in `useLiveCall` — an IPC round trip's order of magnitude,
 *  not a preference — so it is a named constant here rather than a config knob nobody could calibrate. */
const EC_RELEASE_RETRY_MS = 250;

/** Did this track come back with the canceller ENGAGED? `"all"` and `true` are both engaged (R78 §1.3 —
 *  they differ in which canceller, never in whether); anything else, `undefined` included, is not. */
function ecEngaged(v: string | boolean | undefined): boolean {
  return v === true || v === "all";
}

/** `openMicStream`, plus the ONE re-open a failed EC-off flip earns (D75 ③).
 *
 *  THE OPPOSITE MISMATCH IS NOT A FAILURE and deliberately does not reach here: a route that asked for
 *  AEC and got none is a phone with no canceller, which is a legitimate degrade the capture-ready
 *  resolution already handles by arming the ear-hold (R78 §1.3 — that is what a `false`/`undefined`
 *  readback under an AEC ask MEANS). Only the EC-OFF direction has a race to lose.
 *
 *  The second result is accepted either way: one retry is the barrier, and a second wait would be a
 *  delay dressed as a fix. A `getUserMedia` that throws on the retry propagates exactly as the first
 *  one's would — the caller renders it as the call's error terminal. */
async function openEcChecked(
  req: MicRequest,
): Promise<{ stream: MediaStream; fellBack: boolean; ecStuck: boolean }> {
  const opened = await openMicStream(req);
  // Named for what it HOLDS — the readback, this file's governing truth — never for the ask (review F6).
  const engaged = ecEngaged(opened.stream.getAudioTracks()[0]?.getSettings().echoCancellation);
  if (wantsAec(req.route) || !engaged) return { ...opened, ecStuck: false };
  for (const t of opened.stream.getTracks()) t.stop();
  await new Promise((resolve) => setTimeout(resolve, EC_RELEASE_RETRY_MS));
  const again = await openMicStream(req);
  return {
    ...again,
    ecStuck: ecEngaged(again.stream.getAudioTracks()[0]?.getSettings().echoCancellation),
  };
}

/**
 * Open the call's capture chain. Throws whatever `getUserMedia` throws (a denied permission, an absent
 * device) — the caller renders that as the call's error terminal; everything it allocated before a later
 * failure is released on the way out.
 */
export async function startPcmCapture(opts: PcmCaptureOpts): Promise<PcmCapture> {
  // §4.1's constraints, now ROUTE-DERIVED and shared with dictation (D73 S5 — `micConstraints`), and
  // since D75 ③ checked against the track that actually opened before anything is built on it.
  const { stream, fellBack, ecStuck } = await openEcChecked(opts);
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
  // THE EAR'S LIVENESS + THE KEEPALIVE (D73 S6 ②/③) — both are facts about the graph this function
  // owns, so both live beside the track's two enable rules rather than being inferred upstairs.
  let lastHeard = performance.now();
  /** The track's OWN `muted` — the OS/another app has the mic (never our `track.enabled`, which is a
   *  different property and this module's own two rules above). Frames still arrive; they are silence. */
  let deaf = false;
  let keepalive: { src: ConstantSourceNode; gain: GainNode } | null = null;
  const applyEnabled = (): void => {
    // Guarded on `stopped` for the same reason every other exit here is: a released track is not a muted
    // (or held) one, and re-enabling one the call has already torn down would be a lie about the ear.
    if (!stopped) track.enabled = !(muted || held);
  };
  /** The keepalive's one switch (S6 ③). A `ConstantSourceNode` cannot be restarted once stopped, so
   *  each ON mints a fresh pair and each OFF retires it — which also keeps "is it running?" a single
   *  fact (the node's existence) rather than a flag beside it. */
  const setKeepalive = (on: boolean): void => {
    const want = on && !stopped && ctx !== null;
    if (want === (keepalive !== null)) return;
    if (keepalive) {
      keepalive.src.stop();
      keepalive.src.disconnect();
      keepalive.gain.disconnect();
      keepalive = null;
      return;
    }
    if (!ctx) return;
    // A constant source's `offset` defaults to 1, so the gain below IS the amplitude that reaches the
    // destination — DC, which costs nothing to render and still counts as energy.
    const src = ctx.createConstantSource();
    const gain = ctx.createGain();
    gain.gain.value = KEEPALIVE_GAIN;
    src.connect(gain);
    gain.connect(ctx.destination);
    src.start();
    keepalive = { src, gain };
  };
  const stop = (): void => {
    if (stopped) return;
    stopped = true;
    // Before the context goes: the node is this graph's, and a keepalive outliving the call it kept
    // alive would be a page held audible by nothing.
    setKeepalive(false);
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
        if (stopped) return;
        // THE STAMP (S6 ②): only a frame the ear genuinely HEARD moves it. While the track is OS-muted
        // the frames are silence, and counting them would tell the outage detector the ear was awake
        // through exactly the stretch it slept.
        if (!deaf) lastHeard = performance.now();
        opts.onFrame(frame);
      },
    });
    track.addEventListener("ended", () => {
      if (!stopped) opts.onEnded();
    });
    // …and the two events beside it (S6 ②). `muted` is the TRACK's own property — the OS handing the
    // mic to a phone call, a headset event — and it is not `ended`: the track comes back, which is
    // why this pair only informs the stamp instead of failing the call the way `ended` does.
    track.addEventListener("mute", () => {
      deaf = true;
    });
    track.addEventListener("unmute", () => {
      deaf = false;
    });
    const settings = track.getSettings();
    return {
      sampleRate: ctx.sampleRate,
      readback: {
        echoCancellation: settings.echoCancellation,
        // Feature-detected rather than assumed: MDN/BCD coverage for audio-track capabilities has
        // historically been uneven, and an absent API must read as `undefined`, not as "no modes".
        echoCapabilities:
          typeof track.getCapabilities === "function"
            ? track.getCapabilities().echoCancellation
            : undefined,
        label: track.label,
        deviceId: settings.deviceId ?? "",
      },
      fellBack,
      ecStuck,
      setMuted: (m: boolean) => {
        muted = m;
        applyEnabled();
      },
      setHeld: (h: boolean) => {
        held = h;
        applyEnabled();
      },
      earGapMs: () => performance.now() - lastHeard,
      setKeepalive,
      stop,
    };
  } catch (e) {
    stop();
    throw e;
  }
}
