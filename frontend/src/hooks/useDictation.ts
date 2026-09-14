import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";

import type { LiveCallWire, SttAutoStopWire } from "./useVoiceStatus";
import { runComposer } from "../lib/composer";
import { liveSocketUrl, openLiveSocket, type LiveSocket } from "../lib/liveSocket";
import { attachPcmUplink, type PcmUplink } from "../lib/pcmCapture";
import { appendDraft, clearDraft, getDraft } from "../store/composer";
import { pushToast } from "../store/toast";

// Phase 6b-1 — push-to-talk dictation (tap to start, tap to stop). The idiomatic React home for the
// imperative MediaRecorder API is a custom hook (not a store): recording state is read by exactly one
// place — the Composer mic button — so it never needs to be globally shared. (TTS *playback*, which
// many bubbles + the chat reducer coordinate, gets a shared singleton in 6b-2 instead.)
//
// Flow: getUserMedia → MediaRecorder → on stop, POST the recorded clip to /api/voice/stt → append the
// transcript to the composer draft for review-then-send. The recorder's container mimeType and the
// upload filename extension MUST agree — Whisper servers route by extension (the 6a↔6b contract).
//
// Five button states (owner-locked 2026-06-22; `insecure` added 2026-06-26), surfaced via `status`:
//   idle        — armed, not recording (the default look)
//   recording   — actively capturing (drives the vapor `.rec` red-pulse)
//   sending     — clip uploaded, awaiting the transcript (briefly inert, idle look)
//   unavailable — a recording attempt 502'd (the whole STT chain failed). REACTIVE per the owner's
//                 call: no proactive liveness probe — looks normal until an attempt fails, then greys
//                 + goes inert. Re-arms on the next fresh /voice/status probe (Conf save / refocus),
//                 an infra-free recovery path.
//   insecure    — the browser blocks getUserMedia because this isn't a secure context (plain HTTP over
//                 the tailnet, no Tailscale Serve / no browser-flag whitelist). Detected up front from
//                 `navigator.mediaDevices` availability (which IS flag-aware: enabling Chrome's
//                 `unsafely-treat-insecure-origin-as-secure` for this origin makes it a secure context,
//                 so the mic then works on plain HTTP). Greyed like `unavailable` BUT still tappable, so
//                 a tap re-explains the fix via a toast instead of looking dead/stuck (owner ask).
//
// R51 Tier 0 — AUTO-STOP (config `voice.stt.auto_stop*`, delivered by `GET /voice/status`, default
// OFF): while recording, an AnalyserNode on the SAME stream is polled for time-domain RMS; a run of
// readings below the configured floor spanning the configured window ends the recording through the
// ordinary `stop()` — so `onstop → upload → auto_send` is untouched and the two knobs compose (stop
// alone = hands-free stop + review; with auto_send = say-it-and-it-goes). No VAD model, no worklet, no
// background listening: a hidden page stops the recording outright (see `armDetector`).
//
// Phase 24 / S0.5 — the hook WIDENS for the hold-to-record gesture (LIVE_VOICE_PLAN §6, D71). There is
// exactly ONE recorder: the gesture drives THIS machine through `start`/`stop`/`cancel` instead of
// standing up a second one, and `toggle` stays untouched as the keyboard/AT path (R69 §8.1 — the
// Telegram-Web degradation IS the shipped alternative). What the gesture needed, and nothing more:
//   · `start()` RESOLVES to whether a recorder actually armed, so a hold on a denied/failed mic can
//     close its own chrome instead of painting a circle over a mic that never opened;
//   · `cancel()` discards — a flag consulted in the `onstop` path, so the clip costs no POST;
//   · the 1000 ms FLOOR (R69 §9, Signal's rule) lives here, in the pre-upload path, because this is
//     the layer that knows when the recording started;
//   · the arming latch is now a TOKEN rather than a boolean (delta round F5): a release landing while
//     `getUserMedia` is still pending ABORTS that attempt, and a stream resolving afterwards is stopped
//     at once — never an ownerless recording.
//
// S0.5 FEEL ROUND (owner, 2026-09-13) — METERING IS SPLIT FROM POLICY (OF-3). The R51 detector already
// read time-domain RMS every 100 ms, but only while the auto-stop POLICY was on, so the live voice level
// the record circle wants existed exactly when the owner had switched a different feature on. The
// analyser + poll now arm for EVERY recording (that is the METER); the auto-stop STOP decision below is
// gated on `autoStopOn` exactly as it always was (that is the POLICY, untouched). Both seams the gesture
// consumes — the level, and the too-short teaching — are ASSIGNABLE REFS on the return rather than props:
// they are registered by whoever is painting (one composer at a time), they are null-safe, and a null one
// falls back to the behaviour that shipped. A 10 Hz level must not re-render React, which is the whole
// reason it is a ref the gesture writes to the DOM from rather than a piece of state.
//
// Phase 24 / S2.5 — PHRASE-BY-PHRASE STREAMING DICTATION (D71 §7-S2.5, evidence: docs/research/R70).
// The hold/lock rides the SAME realtime ear the call uses: while the recorder runs, a pcm uplink hangs
// off ITS stream and the relay's finals append to the composer draft at every pause. What that is NOT:
// a second recorder, a second `getUserMedia`, a second AudioContext, a new gesture stage, or a change to
// the send policy. The whole branch is ONE optional leg beside the existing machine, and every number it
// uses arrives from `/voice/status.live_call` — nothing here defaults one.
//
// THE FIVE RULES WORTH READING BEFORE EDITING ANY OF IT:
//   ① FEED ONLY AFTER `ready`. Frames captured during the handshake BUFFER and drain ahead of the live
//     frame once the relay answers — audio ORDER is the contract, and the first words of a sentence are
//     exactly the ones a handshake would eat. ONE queue carries both phases and ONE wall-clock token
//     bucket meters it, under the relay's own 2×-realtime rolling budget
//     (`services/voice_live.py::_note_frame`); a backlog past `buffered_ceiling_ms` is a handshake that
//     is not coming (before `ready`) or stale speech (after it), and neither may reach the ear.
//   ② THE RELEASE IS DRAIN → `flush` → AWAIT THE TAIL → `stop`. (The drain is N1's: the uplink's pacer
//     is pumped by worklet callbacks, and the release stops those, so whatever is still queued must be
//     paced out HERE or it is audio the owner said and nothing carries.) Never a commit: the client API
//     has no such word, and a commit during open speech KILLS the Speaches session (R70 §1.2 arm A).
//     `flush` has no ack — the endpoint's own `speech_stopped`+`transcript` are the answer, and whether
//     it went out AT ALL is the socket's readyState, which is why `flush()` reports it — and `stop`
//     DISCARDS unendpointed audio, which is exactly why it goes last (§7-S1's as-built wire law).
//   ③ THE EITHER/OR (R70 §8): ≥1 phrase appended ⇒ the recorded clip is DISCARDED; 0 ⇒ it uploads
//     exactly as it always has. Never both — appending a phrase stream AND the whole-clip transcript is
//     the one way this feature could duplicate the owner's words. The recorder keeps running underneath
//     for precisely that reason: the degrade is free and total.
//   ④ AUTO-SEND FIRES ONCE, AT SESSION END (R70 §6) — through the same helper the upload path calls, so
//     "the gesture is capture ergonomics, `stt_auto_send` is the send policy" survives verbatim.
//   ⑤ NOTHING IS EVER RETRACTED FROM THE DRAFT. A cancel, a dropped socket, a timed-out tail: what
//     already landed stays. The draft is the app's never-lose-speech surface, and the owner may have
//     been editing beside it.

// Auto-stop (R51 Tier 0) — how often the energy detector reads the stream while recording. NOT a
// tunable (the two tunables are the silence window + the RMS floor, both config): 100 ms resolves the
// configured window to within one reading and costs nothing, the order the field ships at (R51 §5).
// Since the feel round it is also the METER's cadence — one timer, two readers.
const SILENCE_POLL_MS = 100;

/** The time-domain RMS that reads as a FULL meter, i.e. `level === 1` (OF-3). Feel-tuned, not measured:
 *  ordinary speech at arm's length on the owner's phone sits well under 0.1 RMS, so 0.12 puts a normal
 *  sentence in the upper half of the bulge and leaves headroom for a shout instead of pinning. The
 *  auto-stop's own `threshold` is deliberately NOT reused — that one is a SILENCE floor (default 0.01),
 *  three orders of feel away from "how loud is loud", and it is user-configurable. */
const METER_FULL_RMS = 0.12;

/** The minimum clip we will spend a POST on, in ms (R69 §9 / §2 — Signal's floor, ratified in
 *  LIVE_VOICE_PLAN §6). A mis-timed hold produces a 200 ms blip: discard it CLIENT-SIDE, before any
 *  upload, and teach the gesture instead of failing silently. Applies to every entry — the gesture and
 *  the keyboard toggle alike — because "a clip too short to be speech" is one fact about the clip, not
 *  a property of how the recording was started. */
const MIN_CLIP_MS = 1000;

/** The teaching line that replaces the discarded blip (R69 §2: Signal teaches at exactly this moment).
 *  Short, and it names the gesture rather than scolding. ONE string for both presentations: since the
 *  feel round the composer shows it in the gesture's own hint BUBBLE (right above the mic, where the
 *  blip just happened), and the toast below is the fallback for a consumer that registers no handler. */
export const TOO_SHORT_MSG = "Too short — hold to record";

const INSECURE_MSG =
  "Mic needs a secure connection — use HTTPS via Tailscale Serve, or allow this origin in your browser flags.";

// Shown when the mic DOES work but the page is plain HTTP (typically a browser-flag-whitelisted origin):
// it records fine — never greyed — but nudge that real HTTPS is the proper setup. Once per page load.
const HTTP_REMINDER =
  "Mic is recording over plain HTTP — HTTPS via Tailscale Serve is the recommended setup.";

// Whether the PAGE is served over HTTPS — deliberately distinct from `micCapable`: a browser flag can
// make a plain-HTTP origin a secure context, so the mic works (mediaDevices present) while this stays
// false. So greying keys off capability, the nudge keys off this.
const httpsOn = typeof window !== "undefined" && window.location?.protocol === "https:";

// Module-level → the plain-HTTP nudge fires once per page load, not once per composer mount (the composer
// remounts when you visit Conf/Utils), so it doesn't pop on every mic use.
let httpReminderShown = false;

/** S2.5 — the streaming leg could not be had (a refused handshake, a `ready` that never came, a worklet
 *  that would not install). The recording itself is untouched, so this is INFORMATION, not a failure:
 *  said once per page load on the `httpReminderShown` latch, because a misconfigured ear that silently
 *  degrades every recording forever is worse than one line. */
const LIVE_DEGRADE_MSG = "Live dictation unavailable — using standard transcription.";
let liveDegradeShown = false;

function noteLiveDegrade(): void {
  if (liveDegradeShown) return;
  liveDegradeShown = true;
  pushToast(LIVE_DEGRADE_MSG, "info");
}

/** …and the DISTINCT copy for a leg that died with words already in the draft (R70 §7: "No speech
 *  detected", "No audio detected" and a dead socket are three different sentences, deliberately). It
 *  says what was lost, because the tail after the drop really is gone. */
const LIVE_LOST_MSG = "Voice connection lost — the rest of that wasn't captured";

/** How many phrases a STREAMING session has appended to the draft, ever, this page load.
 *
 *  Module state for the same reason the two latches above are (and `getDraft` is an imperative read):
 *  there is exactly ONE recorder in the app, and the one reader — the kit composer's shared textarea
 *  seam — is nowhere near this hook's tree. A REACTIVE publisher would re-render the whole composer
 *  subtree once per phrase to fix a caret, which is the trade the meter's ref already refused.
 *
 *  It is a COUNTER rather than an "is streaming live" flag because the reader's real question is not
 *  "is a session up" but "was THIS commit caused by one of its appends" — a flag cannot tell a phrase
 *  landing from the owner typing a character while a session is up, and getting that wrong would fight
 *  their typing. One value answers both: it only ever moves inside a live session. */
let streamAppends = 0;
export function dictationAppends(): number {
  return streamAppends;
}

/** THE UPLINK PACER (rule ①) — how much audio-time the one queue earns per millisecond of WALL CLOCK.
 *  1.5× realtime sustained clears a full `buffered_ceiling_ms` backlog in a couple of seconds while
 *  staying under the relay's own ceiling with margin: `_note_frame` closes the leg past 2× realtime in a
 *  rolling 2 s window, and draining at exactly 2× would sit ON that bound where one retained boundary
 *  frame is a protocol close.
 *
 *  WHY A CLOCK AND NOT A PER-CALLBACK RATIO (S2.5 review F5): the worklet's MessagePort deliveries QUEUE
 *  while the main thread is stalled (heavy jank, an app-switch race) and then dispatch in one burst, so
 *  anything paced per CALLBACK ships at dispatch speed — fifty queued callbacks are fifty sends in one
 *  tick, straight through the relay's rolling window and into a protocol close mid-recording. A budget
 *  earned from `performance.now()` cannot be outrun by a burst: the burst carries no wall clock with it. */
const DRAIN_PACE = 1.5;

/** …and the bucket's CEILING, which is what bounds that post-stall burst. The most the wire can take in
 *  one dispatch is `BUCKET_CAP_MS` of banked audio, so over any rolling relay window the total is at most
 *  `cap + DRAIN_PACE × window`. Against the relay's 2 s window that is 500 + 1.5×2000 = 3500 ms under its
 *  2×-realtime budget of 4000 ms — and the same margin holds for its FRAME-count budget at any
 *  `frame_ms`, because both sides scale by the frame size (3500/frame_ms frames against an allowance of
 *  4000/frame_ms). */
const BUCKET_CAP_MS = 500;

/** A finished recording, out of the hook's refs and on its way to a decision: upload it, or drop it
 *  because the phrases already said what it says (rule ③). By VALUE — see `upload`'s `@param clip`. */
interface Clip {
  chunks: Blob[];
  /** `Date.now()` at `rec.start()`; 0 when there was no stamp (which is never a reason to discard). */
  startedAt: number;
}

/** ONE streaming dictation session: the leg, its uplink queue, and the counters the either/or rule, the
 *  pending pulse and the two §9.3 clocks read. There is at most one — there is one recorder. */
interface StreamSession {
  /** Which leg this is. A socket's callbacks may outlive their session (`close()` only STARTS the
   *  handshake), so every one of them checks this against the live session — the `useLiveCall` fence. */
  leg: number;
  socket: LiveSocket;
  /** THE uplink queue, oldest first — one FIFO for both phases (the handshake's buffer and every live
   *  frame), because audio ORDER is the contract and a second path for "the live frame" is how a burst
   *  gets to overtake the backlog. Drained only by the pacer below. */
  backlog: ArrayBuffer[];
  ready: boolean;
  /** Phrases actually APPENDED to the draft this session — rule ③'s only input. An empty final is not
   *  one: counting it would discard a clip that carries words nothing else has. */
  finals: number;
  /** Endpoints the ear has reported vs the finals it has answered them with, empty ones included (an
   *  empty answer still DISCHARGES an endpoint). Read by ONE thing: the pending pulse
   *  (`stops > finalsSeen` — "the ear owes an answer"). Deliberately NOT read by the release's wait —
   *  three review rounds proved no ledger of ordinary events can time a resolve (see `finishStream`). */
  stops: number;
  finalsSeen: number;
  /** The leg is gone (a close/error past `ready`, or the pre-`ready` ceiling abort). No flush is
   *  possible from here; the release choreography skips straight to the either/or. */
  dead: boolean;
  /** …and it has been torn down: the socket's own late callbacks are ghosts from here. Separate from
   *  `dead` because the release marks a leg dead (no flush possible) long before it closes it. */
  closed: boolean;
  /** The release choreography is OWED — marked SYNCHRONOUSLY by `stop()`, because `rec.stop()` only
   *  queues the terminal events and whatever runs in that window (the unmount sweep) must not mistake
   *  this leg for one nobody is going to close. */
  finishing: boolean;
  /** THE PACER's state (see `DRAIN_PACE`): audio-time the uplink may ship right now, and the
   *  `performance.now()` the last grant was measured from. Both start at `ready` — budget earned
   *  across a slow handshake would be spent in one dispatch, the very burst the cap exists to bound. */
  budgetMs: number;
  lastTick: number;
  uplink: PcmUplink | null;
  /** The release's tail wait while it is OPEN — the WAKE that ends it early, null before it is armed
   *  and after it ends. Exactly ONE thing may end the wait before its bound: a DELIVERED close
   *  (`finishStream` has the whole argument for why nothing else soundly can). */
  tail: (() => void) | null;
  /** The two §9.3 clocks, both ticked by the ONE 100 ms detector poll — no timers of their own. */
  elapsedMs: number;
  idleMs: number;
}

/** THE PACER, as the two steps every drainer of the one queue takes (S2.5 confirm round N1): `accrue`
 *  earns audio-time from the WALL CLOCK, `pump` spends it on the head of the FIFO. Lifted out of the
 *  uplink callback because the RELEASE now drains that same queue through that same bucket, and two
 *  copies of this arithmetic would be two pacers that disagree about what the relay has already been
 *  sent — i.e. the relay's rolling budget tripped by the sum of two things each of which thought it was
 *  under it. One bucket, one place it is spent from. */
function accrue(s: StreamSession): void {
  const now = performance.now();
  s.budgetMs = Math.min(BUCKET_CAP_MS, s.budgetMs + (now - s.lastTick) * DRAIN_PACE);
  s.lastTick = now;
}

function pump(s: StreamSession, frameMs: number): void {
  while (s.backlog.length > 0 && s.budgetMs >= frameMs) {
    const head = s.backlog.shift();
    if (head) s.socket.sendAudio(head);
    s.budgetMs -= frameMs;
  }
}

/** How long the release's pre-flush drain (N1) parks between pumps. NOT a tunable: the drain's RATE is
 *  `DRAIN_PACE` whatever this is — a shorter tick just spends the same budget in smaller pieces — so the
 *  only thing it sets is the granularity, and half the detector's own 100 ms poll is fine enough that a
 *  full-ceiling queue leaves in the same handful of pumps the live uplink would have used. */
const DRAIN_TICK_MS = 50;

type Phase = "idle" | "recording" | "sending";
export type MicStatus = Phase | "unavailable" | "insecure";

// Container candidates in preference order — the first the browser can record wins. webm/opus is the
// Android/Chrome default; mp4 covers Safari/iOS; ogg is a fallback. The recording mimeType picked here
// also dictates the upload filename extension (via the recorder's actual mimeType — see extFromMime).
const MIME_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
  "audio/ogg;codecs=opus",
  "audio/ogg",
];

function pickMime(): string | null {
  if (typeof MediaRecorder === "undefined") return null;
  for (const mime of MIME_CANDIDATES) {
    try {
      if (MediaRecorder.isTypeSupported(mime)) return mime;
    } catch {
      /* some engines throw on odd codec strings — skip */
    }
  }
  return null; // fall through to the browser default container
}

/** Map a recorder mimeType to the extension Whisper should route by (the upload filename ext). Derived
 *  from the recorder's *actual* `mimeType` after start() — a browser may fall back to a different
 *  container than we requested, and the filename extension must follow the real bytes, not our guess. */
function extFromMime(mime: string): string {
  if (mime.includes("mp4") || mime.includes("mpeg")) return "mp4";
  if (mime.includes("ogg")) return "ogg";
  if (mime.includes("wav")) return "wav";
  return "webm";
}

/**
 * @param sttReady   whether /voice/status reports STT configured+enabled (gates re-arm on recovery)
 * @param statusStamp `dataUpdatedAt` of the status query — a change means a fresh probe landed, so a
 *                    previously-`unavailable` mic re-arms (no proactive probe; rides the existing query).
 * @param autoSend   SttServiceCfg.auto_send (via /voice/status): true → send the transcript immediately
 *                    (routed like a typed+sent message); false (default) → fill the composer for review.
 * @param autoStop   SttServiceCfg.auto_stop* (via /voice/status), R51 Tier 0: while recording, an
 *                    energy detector on the same stream stops the recording after a silence run —
 *                    hands-free stop, which `autoSend` then composes with unchanged. Absent (older
 *                    backend / test stub) or `enabled: false` → plain push-to-talk, nothing built.
 * @param liveEar    `/voice/status.live_ear` (D71 S2.5): the realtime chain is configured AND
 *                    `voice.live.enabled` — the two terms the WS route itself gates on. Deliberately
 *                    not the `live` bit, whose TTS term belongs to the CALL: dictation fills the
 *                    composer and needs no mouth.
 * @param liveCall   `/voice/status.live_call`, the client-side knobs. Absent (pre-S1 backend / test
 *                    stub) → no streaming, exactly as `liveEar` false. NOTHING in the streaming branch
 *                    may invent one of these numbers.
 */
export function useDictation({
  sttReady,
  statusStamp,
  autoSend,
  autoStop,
  liveEar,
  liveCall,
}: {
  sttReady: boolean;
  statusStamp: number;
  autoSend: boolean;
  autoStop?: SttAutoStopWire;
  liveEar?: boolean;
  liveCall?: LiveCallWire;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [unavailable, setUnavailable] = useState(false);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  /** The in-flight `start()` attempt, or null — the re-entrancy latch, now a TOKEN (F5). A second entry
   *  during the `getUserMedia` await would open a SECOND stream and orphan the first (its tracks never
   *  stopped → the mic stays live), which is what the old boolean blocked; the token additionally lets a
   *  release/cancel landing inside that window ABORT the attempt, so a stream that resolves after the
   *  gesture ended is released immediately instead of becoming a recording nobody asked for. */
  const armRef = useRef<{ aborted: boolean } | null>(null);
  /** Set by `cancel()` and consumed in `onstop`: the clip is DROPPED, no upload (LIVE_VOICE_PLAN §6). */
  const discardRef = useRef(false);
  /** `Date.now()` at `rec.start()` — the only thing the 1000 ms floor needs, and this is the layer that
   *  has it. 0 when nothing is recording. */
  const startedAtRef = useRef(0);

  /** THE METER SEAM (OF-3) — assigned by whoever paints the recording (the mic gesture), called with a
   *  0…1 level every `SILENCE_POLL_MS` while recording. Null-safe: with nobody registered the poll still
   *  runs the auto-stop policy and simply meters into nothing. */
  const meterRef = useRef<((level: number) => void) | null>(null);
  /** THE TOO-SHORT SEAM (OF-4) — assigned by whoever can TEACH better than a toast can. The floor RULE
   *  and `MIN_CLIP_MS` stay here (this is the layer that knows how long the clip was); only the
   *  PRESENTATION moves. Null → the toast that always shipped. */
  const tooShortRef = useRef<(() => void) | null>(null);
  /** THE PENDING SEAM (S2.5 / R70 §7 option 1) — assigned by whoever paints the record circle, called
   *  with `true` while a phrase is in flight (the ear said you stopped talking, its words have not
   *  landed) and `false` when it lands or the session ends. The same assignable-ref shape as the two
   *  above, and for the same reasons: chrome-only, null-safe, no gesture-machine stage. */
  const onPendingRef = useRef<((pending: boolean) => void) | null>(null);
  /** THE HANDS-FREE SEAM (S2.5 / §9.3-c) — set by whoever knows whether a hand is on the button: the
   *  idle stop must not run during a `hold`, where the finger IS the timeout. A consumer that registers
   *  nothing leaves it false, i.e. no idle stop, which is the safe half of the rule. */
  const handsFreeRef = useRef(false);

  // Detector state. Every one of these stays null unless an AudioContext actually ran.
  const audioRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const hiddenRef = useRef<(() => void) | null>(null);

  // The streaming leg (S2.5). Null whenever the mic is on the plain whole-clip path, which is every
  // recording until `liveEar && live_call.dictation` is true.
  const streamRef = useRef<StreamSession | null>(null);
  const legRef = useRef(0);
  /** The last value handed to `onPending`, so a repeat costs no DOM write. */
  const pendingRef = useRef(false);

  // The policy, flattened to primitives so the detector's identity tracks the VALUES, not the identity
  // of the query object carrying them. Absent → disabled (the mic predates the field; LOW-4).
  const autoStopOn = autoStop?.enabled ?? false;
  const silenceMs = (autoStop?.silence_s ?? 0) * 1000;
  const silenceFloor = autoStop?.threshold ?? 0;

  // …and the S2.5 knobs, flattened for the same reason. `streamWanted` is the ONE decision, taken per
  // recording at `start()`: both toggles up, and a `live_call` that actually carries numbers (a frame
  // size of 0 would be a backend that sent the object without them — nothing here invents one).
  const frameMs = liveCall?.frame_ms ?? 0;
  const ceilingMs = liveCall?.buffered_ceiling_ms ?? 0;
  const tailWaitMs = liveCall?.tail_wait_ms ?? 0;
  const idleMs = (liveCall?.dictation_idle_s ?? 0) * 1000;
  const maxMs = (liveCall?.dictation_max_s ?? 0) * 1000;
  const streamWanted = !!liveEar && !!liveCall?.dictation && frameMs > 0 && tailWaitMs > 0;

  // Whether the browser will even hand us a mic. `navigator.mediaDevices` is undefined in an insecure
  // context (plain HTTP) AND present once the origin is treated as secure (real HTTPS, localhost, or a
  // browser flag), so this single check is the flag-aware gate — no `location.protocol` sniffing, which
  // would wrongly block a user who whitelisted the origin. Stable per page load (read at render).
  const micCapable =
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof MediaRecorder !== "undefined";

  // Re-arm after a fresh capability probe (Conf voice save / window refocus). /voice/status only
  // reports *configured*, not *reachable*, so this is an optimistic re-arm: worst case the next
  // attempt greys it again. Infra-free recovery from a transient outage without a liveness probe.
  useEffect(() => {
    if (sttReady) setUnavailable(false);
  }, [statusStamp, sttReady]);

  /** Publish the phrase-pending state to whoever is painting (rule E). Deduped, because at a pause it
   *  would otherwise fire on every frame that carries the same answer. */
  const setPending = useCallback((on: boolean): void => {
    if (pendingRef.current === on) return;
    pendingRef.current = on;
    onPendingRef.current?.(on);
  }, []);

  /** Close ONE streaming leg. NEVER flushes — every caller has either flushed already or decided there
   *  is nothing to wait for. The uplink goes first so no frame can reach a socket that is closing, and
   *  a release still parked on the tail is woken rather than left to its timeout. */
  const closeStream = useCallback(
    (s: StreamSession): void => {
      if (s.closed) return;
      s.closed = true;
      s.dead = true;
      s.uplink?.stop();
      s.uplink = null;
      const tail = s.tail;
      s.tail = null;
      tail?.();
      s.socket.close();
      setPending(false);
    },
    [setPending],
  );

  /** …and forget it: the recorder underneath keeps running, so the mic falls back to exactly today's
   *  whole-clip path for the rest of this recording (R70 §8's free degrade). Silent by contract — the
   *  loud version is `degradeStream`, for a leg that never opened at all. */
  const dropStream = useCallback(
    (s: StreamSession): void => {
      closeStream(s);
      if (streamRef.current === s) streamRef.current = null;
    },
    [closeStream],
  );

  /** The same drop, plus the once-per-page-load notice: a leg that never reached `ready` is a
   *  MISCONFIGURATION (a refused handshake, a busy relay, a worklet that would not install), and a
   *  feature that silently does nothing forever is the one failure mode worth one line of toast. */
  const degradeStream = useCallback(
    (s: StreamSession): void => {
      dropStream(s);
      noteLiveDegrade();
    },
    [dropStream],
  );

  /** THE AUTO-SEND, in ONE place (rule ④). Both paths land here — the whole-clip upload right after it
   *  appends its transcript, and the streaming release after its last phrase — and rule ③ guarantees
   *  exactly one of them runs per recording. Semantics are the pre-S2.5 ones, verbatim: routed like a
   *  typed+sent message, NO streaming gate (HIGH-1, D41 — a voice message during a live turn QUEUES as
   *  a steer, same as Enter), and the draft is cleared ONLY if the seam actually routed (D68 MED-2:
   *  `runComposer` HOLDS a send while a staged file is still uploading, and the words must wait for the
   *  file rather than send without it). */
  const maybeAutoSend = useCallback((): void => {
    if (!autoSend) return;
    // Reads the just-appended draft imperatively (combines with anything already typed).
    const full = getDraft().trim();
    if (full && runComposer(full)) clearDraft();
  }, [autoSend]);

  /** @param mime the recorder's ACTUAL container, handed over by the `onstop` closure that owns it —
   *  the recorder releases its ownership of `recRef` before the upload begins (F2), so this can no
   *  longer be read back off the ref.
   *  @param clip the recording, DRAINED OUT OF THE REFS by that same closure. It used to be read back
   *  off `chunksRef` here, which was safe only because the read was synchronous inside `onstop`; S2.5
   *  opened a real gap — the release choreography can sit on the tail final for `tail_wait_ms` while
   *  a NEXT recording arms, and a ref read at that point would hand this upload the next recording's
   *  chunks (and clear them out from under it). The clip travels by value from the one terminal that
   *  owns it, which is the same answer F2 gave for the recorder itself.
   *  (A clip's `heldMs` defaulting to `Infinity` when there is no stamp is deliberate and STAYS: "no
   *  stamp" alone must never discard a clip. A recording that ERRORED is covered by the discard flag
   *  `onerror` sets — F4 — never by the missing stamp.) */
  const upload = useCallback(
    async (mime: string, clip: Clip) => {
      const heldMs = clip.startedAt > 0 ? Date.now() - clip.startedAt : Infinity;
      const blob = new Blob(clip.chunks, { type: mime });
      if (!blob.size) {
        setPhase("idle");
        return;
      }
      // THE 1000 ms FLOOR — before the POST, never after: a blip costs no round trip, and the toast is
      // the teaching moment (R69 §2/§9). Deliberately AFTER the empty-blob early-out, which is about a
      // recorder that produced nothing at all rather than about a recording that was too brief.
      if (heldMs < MIN_CLIP_MS) {
        // The teaching PRESENTATION is the one part a consumer may take over (OF-4): the composer flashes
        // it in the gesture's hint bubble, right above the button the blip happened on. Everyone else —
        // and any future consumer that registers nothing — keeps the toast.
        if (tooShortRef.current) tooShortRef.current();
        else pushToast(TOO_SHORT_MSG, "info");
        setPhase("idle");
        return;
      }
      setPhase("sending");
      // Filename extension follows the recorder's *actual* container (mime ↔ ext must agree — Whisper
      // routes by extension). `mime` strips codec params via extFromMime's substring checks.
      const form = new FormData();
      form.append("file", blob, `dictation.${extFromMime(mime)}`);
      try {
        const res = await fetch("/api/voice/stt", { method: "POST", body: form });
        if (res.status === 502) {
          // The whole STT chain (primary + fallback) failed → the reactive "unavailable" state.
          setUnavailable(true);
          pushToast("Voice servers unreachable", "err");
          return;
        }
        if (!res.ok) {
          pushToast(`Transcription failed (${res.status})`, "err");
          return;
        }
        const data = (await res.json()) as { text?: string };
        if (data.text?.trim()) {
          appendDraft(data.text); // always show it in the composer first
          maybeAutoSend(); // rule ④ — the one shared helper, once per session
        } else {
          pushToast("Didn't catch that — try again", "info");
        }
      } catch {
        // Network failure reaching our own backend — treat like an unreachable chain.
        setUnavailable(true);
        pushToast("Voice servers unreachable", "err");
      } finally {
        setPhase("idle");
      }
    },
    [maybeAutoSend],
  );

  /** Abort an in-flight `start()` (F5), reporting whether there WAS one. The caller then knows there is
   *  no recording to stop or discard: the recorder never armed, so nothing was captured. `armRef` is
   *  released here so an immediate re-press can start afresh — the aborted attempt still owns its own
   *  token, and `start`'s `finally` only clears the ref when it is still the one it parked. */
  const abortArming = useCallback((): boolean => {
    const arm = armRef.current;
    if (!arm) return false;
    arm.aborted = true;
    armRef.current = null;
    return true;
  }, []);

  const stop = useCallback(() => {
    if (abortArming()) return; // released inside the acquisition window — nothing started (F5)
    const rec = recRef.current;
    if (!rec || rec.state === "inactive") return;
    // THE CHOREOGRAPHY IS OWED FROM HERE (S2.5, rule ②) — marked SYNCHRONOUSLY, before the recorder is
    // asked to stop: `rec.stop()` only QUEUES the terminal events, and anything running in that window
    // (the unmount sweep, a socket close) must see a leg with a flush coming rather than a leaked one.
    const s = streamRef.current;
    if (s) s.finishing = true;
    rec.stop(); // fires onstop → cleanup → the release choreography, or the upload
  }, [abortArming]);

  /** Discard the recording: no transcript, no POST, no draft. The flag is consulted in the `onstop`
   *  path (the ONE place that decides whether a stopped recorder uploads), so cancelling reuses the
   *  entire teardown rather than forking it — LIVE_VOICE_PLAN §6's slide-left cancel, the locked-mode
   *  CANCEL button and the Esc key all land here. */
  const cancel = useCallback(() => {
    if (abortArming()) return; // cancelled inside the acquisition window — nothing to discard (F5)
    const rec = recRef.current;
    if (!rec || rec.state === "inactive") return;
    discardRef.current = true;
    // S2.5 — the leg goes NOW, with NO flush: the utterance in flight is dropped and nothing more can
    // append. What already landed STAYS in the draft (rule ⑤) — retracting it could destroy an edit the
    // owner made beside it, and a cancel is about the CLIP, which is what `discardRef` throws away.
    const s = streamRef.current;
    if (s) dropStream(s);
    rec.stop();
  }, [abortArming, dropStream]);

  /** Release ONLY the Web Audio half of the detector (interval · nodes · context). Split out because
   *  the energy detector is allowed to degrade while the hidden-page stop is NOT (MED-1): a context
   *  that won't run must not take the unattended-mic rule with it. */
  const teardownAudio = useCallback(() => {
    if (pollRef.current !== null) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    sourceRef.current?.disconnect();
    analyserRef.current?.disconnect();
    sourceRef.current = null;
    analyserRef.current = null;
    const ctx = audioRef.current;
    audioRef.current = null;
    if (ctx && ctx.state !== "closed") void ctx.close().catch(() => {}); // a double-close rejects
  }, []);

  /** The auto-stop detector's ONE idempotent teardown (council MED-2): the audio half PLUS the
   *  visibility listener. Called from EVERY terminal path — `onstop` (BEFORE the upload begins),
   *  `onerror`, a failed start, unmount — so nothing ever watches a mic that is no longer recording. */
  const teardownDetector = useCallback(() => {
    teardownAudio();
    if (hiddenRef.current) {
      document.removeEventListener("visibilitychange", hiddenRef.current);
      hiddenRef.current = null;
    }
  }, [teardownAudio]);

  /**
   * THE RELEASE CHOREOGRAPHY (rule ②), owned by the ONE terminal that knows the recording is over.
   *
   * Pace out whatever the stopped uplink left queued (N1) → `flush` (a relay-side silence burst — the
   * client may not mint one, §3.1's rate ceiling makes an 88-frame burst a protocol close) → await the
   * release's OWN tail, or `tail_wait_ms` → `stop` → close. The order is the wire's, not a preference:
   * `flush` has NO ack, so the endpoint's own transcript IS the response, and `stop` DISCARDS whatever
   * the ear has not endpointed, so it can only come last — which is also why the wait re-reads the
   * endpoint ledger rather than waking on the first final or on a count of them (F1, twice).
   *
   * IT RUNS TO COMPLETION EVEN IF THE COMPOSER UNMOUNTED MID-WAIT. Every outcome is a store write
   * (`appendDraft`/`runComposer`/the upload), the `setPhase` calls are no-ops on a dead component, and
   * the socket close is bounded on every path — the timeout fires whether or not anyone is watching.
   *
   * @param s    the session, already detached from `streamRef` by the caller: it is closing out, and no
   *             later `stop()`/sweep may adopt it.
   * @param mime the recorder's ACTUAL container, for the clip this may still have to upload.
   */
  const finishStream = useCallback(
    async (s: StreamSession, mime: string, clip: Clip): Promise<void> => {
      // The existing `sending` phase, deliberately — the mic is inert and spinning while a phrase
      // lands, which is exactly what it already means. No new `MicStatus` value is owed.
      setPhase("sending");
      s.uplink?.stop(); // no microphone audio may reach the ear past the release
      s.uplink = null;
      // ⓪ THE RELEASE DRAINS WHAT IS ALREADY CAPTURED, BEFORE THE FLUSH (S2.5 confirm round N1). The
      // pacer's only pump is the next worklet callback — and the line above just stopped those. So a
      // release landing on a non-empty queue (a post-stall burst that was still draining) would strand
      // audio the owner really said, flush PAST it, and then have the either/or discard the clip that
      // also carried it. THE EMPTY QUEUE — every ordinary release, because at the ordinary cadence the
      // bucket keeps up — DOES NOT ENTER THIS BRANCH AT ALL: no await, no timer, no added latency on
      // the path that runs a thousand times for this one.
      if (!s.dead && s.backlog.length > 0) {
        // THE BOUND IS A DERIVATION, not a vibe: the deepest queue the ceiling admits is `ceilingMs` of
        // audio (past that the uplink throws the leg away), and it leaves at `DRAIN_PACE` — so
        // `ceilingMs / DRAIN_PACE` is the whole job, plus one tick for the pump that finishes it.
        const until = performance.now() + ceilingMs / DRAIN_PACE + DRAIN_TICK_MS;
        while (!s.dead && s.backlog.length > 0 && performance.now() < until) {
          // The SAME bucket the live uplink spends from (`accrue`/`pump`), so these frames are under the
          // relay's rolling budget by construction rather than by a second calculation.
          accrue(s);
          pump(s, frameMs);
          if (s.backlog.length === 0) break;
          await new Promise<void>((r) => setTimeout(r, DRAIN_TICK_MS));
        }
        if (!s.dead && s.backlog.length > 0) {
          // The bound expired with audio still queued — a throttled or hidden page, where the ticks
          // meant to pace the drain never arrived. What is left can no longer reach the ear in time, so
          // it is stale speech and gets the S2a doctrine's own answer: throw the leg away, skip the
          // flush and the wait, let the either/or proceed. ONE disposition and the same mid-death rule
          // as everywhere else — the loss is named only when words are already in the draft, because
          // that is exactly when the clip is about to be discarded. (The socket's `close()` is the
          // unconditional one below; nothing awaits between here and it.)
          s.dead = true;
          if (s.finals > 0) pushToast(LIVE_LOST_MSG, "err");
        }
      }
      if (!s.dead) {
        // ① THE TAIL WAIT IS THE BOUND — `tail_wait_ms` FLAT, and nothing but a DELIVERED close may
        // end it early. Three review rounds each killed one attempt to resolve sooner, and their sum
        // is a theorem about this wire, recorded here so nobody re-attempts a fourth:
        //   · "the first final" — a final still in transit at the release satisfies it and the `stop`
        //     that follows DISCARDS the phrase the flush was busy minting;
        //   · a COUNT snapshotted at the release — the ledger GROWS afterwards (VAD lags the words),
        //     and any static N is satisfied by old finals while a late phrase is still unreported;
        //   · a dynamic condition + a settle window — a phrase can be entirely UNOBSERVED (its
        //     `speech_started` queued behind a stalled main thread, or simply in the ear's future)
        //     while the ledger reads square and quiet; timers and socket messages are separate task
        //     sources with no ordering guarantee, so every finite window has a losing boundary.
        // The root fact: `flush` has NO ack and the wire carries no completeness marker (the relay
        // could only ever say "burst handed upstream", never "upstream processed it" — and the server
        // stays untouched, §5.2). An early resolve is an optimization that needs state the protocol
        // cannot give, and the S1 lesson already names the move: DELETE the optimization. Finals
        // append the moment they land — the wait costs nothing mid-session; the flat bound is the
        // RELEASE's price, it IS the declared loss horizon (R70 §4: on expiry keep everything
        // appended), and `tail_wait_ms` is the owner's knob for it (the S4 sitting tunes it against
        // the measured 530–830 ms release→final).
        //
        // The ONE sound early exit: a close the socket actually DELIVERED. WebSocket delivery is
        // in-order, so a delivered close proves nothing more can ever arrive — parking on the bound
        // past it helps nobody. The ⑦ branch owns that wake (and its honesty toast).
        //
        // …and ONE abandonment, which is a different kind of thing entirely (S3): the page going HIDDEN
        // under the wait is the user LEAVING, not evidence that the tail arrived. It ends the wait the
        // way branch ② ends it — the leg is thrown away, not completed — because a hidden page is where
        // this timer is throttled (Android), and the residual it closes is a SOCKET held open long past
        // the tap. Nothing about completeness is claimed or inferred: the theorem above still stands.
        if (s.socket.flush()) {
          setPending(true);
          await new Promise<void>((resolve) => {
            const end = (): void => {
              clearTimeout(timer);
              document.removeEventListener("visibilitychange", onHidden);
              s.tail = null;
              resolve();
            };
            const timer = setTimeout(end, tailWaitMs);
            const onHidden = (): void => {
              if (document.visibilityState !== "hidden") return;
              // The same disposition as every other death mid-release: mark it dead so no `stop` is
              // sent to a leg nobody is listening to, fall through to the unconditional `close()`, and
              // name the loss by the ONE mid-death rule — words in the draft mean the clip is about to
              // be discarded, so a tail that never landed really is gone; none means the clip carries
              // everything and there is nothing to say.
              s.dead = true;
              if (s.finals > 0) pushToast(LIVE_LOST_MSG, "err");
              end();
            };
            document.addEventListener("visibilitychange", onHidden);
            // Whichever ends it first wins; `s.tail = null` makes it exactly once.
            s.tail = end;
          });
          if (!s.dead) s.socket.stop();
        } else {
          // ② AN UNSENT FLUSH IS A DEAD LEG, KNOWN SYNCHRONOUSLY (S2.5 confirm round F2). The socket was
          // already CLOSING — backpressure, the relay's `ended`, the post-`ready` ceiling close — and its
          // `onclose` has simply not been delivered yet, so nothing here could have learned it by
          // waiting: the wait would run the full `tail_wait_ms` for a tail no ear will mint, and the
          // close that eventually lands is ghosted by `mine()` (the session is `closed` by then), so the
          // stall would be silent as well. The readyState `flush()` reports is the fact, taken at once —
          // and the loss is named by the one mid-death rule: words in the draft mean the clip is about
          // to be discarded, so the tail after the drop really is gone; none means the clip carries
          // everything and there is nothing to say.
          s.dead = true;
          if (s.finals > 0) pushToast(LIVE_LOST_MSG, "err");
        }
        // THE ACCEPTED RESIDUAL (F2, and it is bounded): an `onclose` delayed beyond `tail_wait_ms`
        // after a flush that DID go out still ends as a plain timeout with no toast. By construction the
        // client cannot tell that apart from the no-tail case above — both are "the ear said nothing" —
        // and both cost the same bounded wait.
      }
      s.socket.close();
      s.closed = true; // …and from here its own late callbacks are ghosts
      setPending(false);
      // THE EITHER/OR (rule ③), evaluated exactly once, here.
      if (s.finals > 0) {
        // The flush's tail was the last append: the clip would say the same words a second time, so
        // it is simply dropped — it left the refs at `onstop` and nothing else holds it.
        maybeAutoSend();
        setPhase("idle");
        return;
      }
      // Nothing was appended — the clip is the whole recording, uploaded exactly as it always was
      // (the 1000 ms floor, its teaching, the 502 greying, the toasts: all of it untouched).
      await upload(mime, clip);
    },
    [ceilingMs, frameMs, maybeAutoSend, setPending, tailWaitMs, upload],
  );

  /**
   * Open the streaming leg for THIS recording, on the detector's own running context and the recorder's
   * own stream (rule: never a second `getUserMedia`, never a second `AudioContext` — R70 §8's third
   * consumer). Failures are silent-plus-one-notice degrades; nothing in here can end a recording except
   * the two rules that are meant to (the §9.3 clocks, and a death with words already in the draft).
   */
  const armStream = useCallback(
    (ctx: AudioContext, stream: MediaStream): void => {
      const leg = ++legRef.current;
      /** This leg's own session, held in the CLOSURE rather than read back off `streamRef`: the
       *  release DETACHES the session from that ref while the choreography is still running (so no
       *  later `stop()` or sweep can adopt it), and the tail final the flush is waiting for arrives
       *  through these very callbacks. The fence is the `useLiveCall` one, on the two facts that
       *  actually make a callback a ghost: a NEWER leg has taken over, or this one is already torn
       *  down (`close()` only STARTS the handshake — frames can still land after it). */
      let session: StreamSession | null = null;
      const mine = (): StreamSession | null =>
        legRef.current === leg && session && !session.closed ? session : null;
      const socket = openLiveSocket({
        url: liveSocketUrl(),
        // The context's REAL rate — the relay builds its resampler from what we declare here, so it
        // must be what the worklet actually produces (44.1k or 48k by device; there is no asking).
        sampleRate: ctx.sampleRate,
        ceilingMs,
        onFrame: (frame) => {
          const s = mine();
          if (!s) return;
          switch (frame.type) {
            case "state":
              if (frame.state === "ready") {
                s.ready = true; // …and the backlog starts draining on the next live frame
                // The pacer's clock starts HERE, and EMPTY: a slow handshake must bank nothing, or
                // its whole duration would be spent in one dispatch the moment audio is allowed.
                s.budgetMs = 0;
                s.lastTick = performance.now();
              } else if (frame.state === "ended") {
                // The relay said its piece. Whether that costs the clip is the ordinary death rule.
                socket.close();
              }
              // `degraded` is the relay's overflow note; a dictation leg has nothing to show for it
              // and nothing to decide — the words it dropped are already gone.
              break;
            case "speech_started":
              // Counted by nothing since the wait became the flat bound (three rounds, see
              // `finishStream` ①): no resolve reads the ledger, and the pulse lights on the STOP.
              break;
            case "speech_stopped":
              s.stops += 1; // one endpoint the ear now owes a final for — the pulse's whole input
              setPending(true); // "it heard you stop" — the gap R70 §7 wants painted
              break;
            case "transcript": {
              if (!frame.final) break; // we have no partials (§9.4); a future one is data, not text
              s.finalsSeen += 1; // ANY final discharges an endpoint, empty or not
              const text = frame.text.trim();
              if (text) {
                appendDraft(text); // THE join rule, unchanged — `store/composer` already owns it
                streamAppends += 1; // …and the caret seam's cue that THIS commit is a phrase landing
                s.finals += 1;
              }
              // The pulse says what is still OWED rather than "the last one landed": a second endpoint
              // the ear has not answered yet keeps it lit instead of blinking off between two phrases.
              // Deliberately NOT a wake for the release's wait — the flat bound is the rule (① above).
              setPending(s.stops > s.finalsSeen);
              break;
            }
            case "error":
              // Every typed error is followed by the relay's own close, which is where the decision
              // lives — one rule for "the leg is gone", however it went.
              break;
          }
        },
        onClose: () => {
          const s = mine();
          if (!s) return;
          if (s.finishing) {
            // THE RELEASE IS ALREADY RUNNING and the leg died underneath it (S2.5 review F2).
            // Swallowing this — which "the release owns its own close" used to do — parks the
            // choreography on the full `tail_wait_ms` for a tail that can no longer arrive, and then
            // discards the clip in SILENCE when words are already in the draft. The release's own
            // close cannot reach here: it marks the session `closed` in the same synchronous step, so
            // `mine()` is already null by the time that close event lands.
            s.dead = true; // …so a release that has not flushed yet skips straight to the either/or
            const tail = s.tail;
            s.tail = null;
            tail?.();
            // A close DELIVERED during the wait is pre-`stop` by construction (the release's own close
            // is ghosted by `closed`), i.e. abnormal — and in-order delivery means nothing more can
            // arrive, so the wake is the one sound early exit (① in `finishStream`). The loss is named
            // only when there IS one: words in the draft mean the clip is about to be discarded, so a
            // tail the ear never got to report is honestly gone.
            if (s.finals > 0) pushToast(LIVE_LOST_MSG, "err");
            return;
          }
          if (!s.ready) {
            // It never opened: a refused handshake (403), a busy relay (1013), a leg that died before
            // `ready`. Silent for the recording, one notice per page load for the misconfiguration.
            degradeStream(s);
            return;
          }
          if (s.finals === 0) {
            // Nothing was appended, so the clip still carries every word — degrade SILENTLY and let
            // the recording run on exactly as it would have without the feature. The clip fallback IS
            // the retry; there is deliberately no mid-session reconnect (R70 §8's retry-once declined).
            dropStream(s);
            return;
          }
          // Words are already in the draft, so uploading the clip would say them twice (rule ③). End
          // the recording HERE through the ordinary path, with the flush marked impossible: the tail
          // after the drop is honestly lost, and the toast says so rather than pretending otherwise.
          s.dead = true;
          s.uplink?.stop();
          s.uplink = null;
          setPending(false);
          pushToast(LIVE_LOST_MSG, "err");
          stop();
        },
      });
      // Assigned SYNCHRONOUSLY, before the socket can deliver anything: every callback above is
      // asynchronous by construction, so none of them can observe the null.
      session = {
        leg,
        socket,
        backlog: [],
        ready: false,
        finals: 0,
        stops: 0,
        finalsSeen: 0,
        dead: false,
        closed: false,
        finishing: false,
        budgetMs: 0,
        lastTick: 0,
        uplink: null,
        tail: null,
        elapsedMs: 0,
        idleMs: 0,
      };
      streamRef.current = session;
      void attachPcmUplink(ctx, stream, {
        frameMs,
        onFrame: (f) => {
          const s = mine();
          if (!s || s.dead) return;
          // ONE QUEUE, BOTH PHASES (S2.5 review F5): every frame joins the tail of the SAME FIFO and
          // leaves it through the same pacer. Audio ORDER is the contract, and a second path for "the
          // live frame" is how a dispatched burst gets to overtake the backlog.
          s.backlog.push(f.buf);
          // ① BEFORE `ready`, BUFFER. The words spoken while the socket was handshaking are the first
          // words of the sentence, and the relay closes the leg on a leading binary frame anyway.
          if (!s.ready) {
            // THE READY BOUND, and it is a ceiling the owner already configured: a handshake that is
            // not coming looks exactly like a backlog nothing drains. Past it the leg holds a second
            // of stale speech and is worse than no leg at all.
            if (s.backlog.length * frameMs > ceilingMs) degradeStream(s);
            return;
          }
          // …and AFTER it, THE TOKEN BUCKET earns audio-time from the WALL CLOCK and spends it on the
          // head of the queue, so the backlog drains ahead of the live frame at `DRAIN_PACE` whatever
          // cadence the callbacks themselves arrive at. At the ordinary 40 ms cadence each callback
          // banks 60 ms and ships one frame plus half a catch-up frame — the same net ≥ 0.5 extra per
          // callback the old ratio gave, and the identical order. (The two steps are shared with the
          // release's own drain — see `accrue`/`pump`; there is ONE bucket.)
          accrue(s);
          pump(s, frameMs);
          // THE SAME CEILING ONE LAYER UP (the S2a backpressure doctrine): a queue this deep PAST
          // `ready` is not a handshake that never came, it is stale speech — audio the ear would
          // transcribe into a turn the owner has long since moved past. Throw the leg away and let
          // `onClose`'s own mid-death rules decide what that costs; no new mechanism, no new knob.
          if (s.backlog.length * frameMs > ceilingMs) s.socket.close();
        },
      })
        .then((uplink) => {
          const s = mine();
          // The recording ended (or the leg died) while the worklet was installing — a graph nobody
          // owns is released at once, exactly as the arming latch releases an ownerless stream.
          if (!s || s.dead) uplink.stop();
          else s.uplink = uplink;
        })
        .catch(() => {
          const s = mine();
          // A worklet that will not install is a leg that can never say anything: the same never-opened
          // degrade the handshake failures take.
          if (s) degradeStream(s);
        });
    },
    [ceilingMs, degradeStream, dropStream, frameMs, setPending, stop],
  );

  /** Arm the energy detector on the SAME stream the recorder holds (never a second getUserMedia). Silent
   *  by contract (MED-2): no Web Audio, a context that won't leave `suspended`, a throwing node graph —
   *  every one degrades to ordinary push-to-talk. A recording that needs one extra tap is a non-event;
   *  an error toast on every recording would not be. The hidden-page stop is NOT part of that degrade
   *  (MED-1) — when the auto-stop POLICY is on it is armed first, synchronously, and outlives any Web
   *  Audio failure below; with the policy off it does not exist at all (F1 — the policy's rule, never
   *  the meter's).
   *
   *  ARMED FOR EVERY RECORDING since the feel round (OF-3): what it reads is a LEVEL, which the record
   *  circle wants whatever the auto-stop policy says. The policy has not moved — the STOP decision inside
   *  the poll is still gated on `autoStopOn`, and with it off nothing here can end a recording. The
   *  degrade rule covers the meter too: a context that won't run means no level, never a broken mic. */
  const armDetector = useCallback(
    async (stream: MediaStream) => {
      // Council MED-1 — under the AUTO-STOP POLICY, dictation is a screen-on activity: a hidden page
      // ends the recording outright rather than leaving the mic live behind a timer Android throttles
      // to ~once a minute. Armed before any Web Audio work, so an unavailable/suspended context can
      // never leave the mic recording untended; only the full teardown (every terminal path) removes
      // it. ⚠ GATED ON THE POLICY, not on the meter (feel-round review F1): with auto-stop OFF the
      // pre-OF-3 recorder had no listener and kept recording behind a hidden page — the metering
      // split must not broaden that rule. Policy off, a hidden page throttles only the meter poll,
      // which is decoration.
      //
      // …AND UNCONDITIONALLY WHILE STREAMING (S2.5 / §9.3-b — the F1 trap read in the other
      // direction). A live WebSocket plus an open mic behind a locked phone is strictly worse than the
      // recorder F1 was written about, so the arming decision gains a second reason. What that arming
      // CARRIES, enumerated, because the split that created F1 failed to: it calls `stop()`, which for
      // a streaming session is the ordinary release — the recorder stops at once (the mic indicator
      // goes out immediately, which is the point), then the flush's bounded wait runs. A page that goes
      // hidden while that wait is ALREADY open no longer rides a throttled timer to its end: the wait
      // takes it as the user leaving and abandons the leg (S3 — see `finishStream`'s ① block), so the
      // socket does not outlive the departure either. Keyed on `streamWanted` — the per-recording
      // decision, taken once — rather than on whether a leg actually opened: one arming decision per
      // recording, never a listener that comes and goes with a socket.
      if (autoStopOn || streamWanted) {
        const onHidden = () => {
          if (document.visibilityState === "hidden") stop();
        };
        document.addEventListener("visibilitychange", onHidden);
        hiddenRef.current = onHidden;
      }
      if (typeof AudioContext === "undefined") {
        if (streamWanted) noteLiveDegrade(); // no Web Audio ⇒ no uplink either (rule ⑧'s ctx arm)
        return;
      }
      let ctx: AudioContext;
      try {
        ctx = new AudioContext(); // constructed inside the start gesture, so it may autoplay-unlock
      } catch {
        if (streamWanted) noteLiveDegrade();
        return;
      }
      audioRef.current = ctx; // parked BEFORE the await, so a stop during it closes this context
      if (ctx.state === "suspended") await ctx.resume().catch(() => {});
      // The parked context IS this arm's ownership token: if it is no longer the current one, the
      // recording ended (or a NEXT one already armed) while we awaited. A stale continuation closes
      // only its own context, best-effort, and touches nothing global — the live detector, whoever
      // owns it now, must survive it.
      if (audioRef.current !== ctx) {
        if (ctx.state !== "closed") void ctx.close().catch(() => {});
        return;
      }
      // Still ours, but the context never ran → drop the AUDIO only; the hidden-page stop above stays
      // armed for the rest of the recording, which is now plain push-to-talk.
      if (ctx.state !== "running") {
        teardownAudio();
        if (streamWanted) noteLiveDegrade();
        return;
      }
      let analyser: AnalyserNode;
      try {
        analyser = ctx.createAnalyser();
        const source = ctx.createMediaStreamSource(stream);
        source.connect(analyser); // analyser only — never the destination (that would echo the mic)
        analyserRef.current = analyser;
        sourceRef.current = source;
      } catch {
        teardownAudio();
        if (streamWanted) noteLiveDegrade();
        return;
      }
      // THE STREAMING LEG (S2.5) — a THIRD consumer of the one stream, on THIS context, only now that
      // the context is proven to run. Everything below it (the poll's two clocks, the Tier-0
      // suspension) reads the session it parks; everything above is exactly the shipped detector.
      if (streamWanted) armStream(ctx, stream);
      const samples = new Float32Array(analyser.fftSize);
      let silentMs = 0; // the current run of below-floor readings; silence BEFORE speech counts too
      pollRef.current = setInterval(() => {
        analyser.getFloatTimeDomainData(samples);
        let sum = 0;
        for (const v of samples) sum += v * v;
        const rms = Math.sqrt(sum / samples.length);
        // ① THE METER — every reading, whatever the policy (OF-3). Straight to a registered consumer,
        //    never through state: at 10 Hz a `setState` would re-render the whole composer subtree.
        meterRef.current?.(Math.min(1, rms / METER_FULL_RMS));
        // ② THE STREAMING SESSION'S TWO CLOCKS (S2.5 / §9.3-c), both on this ONE poll — no timers of
        //    their own, for the reason the meter has none: this interval already runs at the right
        //    cadence for every decision the mic makes.
        const live = streamRef.current;
        if (live && !live.finishing) {
          //    The HARD cap applies to every streaming session, `hold` included: it bounds the open
          //    socket, not the owner's patience.
          live.elapsedMs += SILENCE_POLL_MS;
          if (live.elapsedMs >= maxMs) {
            stop();
            return;
          }
          //    The IDLE stop is HANDS-FREE ONLY. While the finger is down the finger IS the timeout,
          //    and a pause is the entire point of phrase dictation. The floor is `stt_auto_stop`'s —
          //    the `barge_threshold: 0` reuse precedent, one calibrated silence floor per device — so
          //    an uncalibrated 0 leaves the idle stop DISARMED rather than firing on every reading.
          if (handsFreeRef.current && silenceFloor > 0 && rms < silenceFloor) {
            live.idleMs += SILENCE_POLL_MS;
            if (live.idleMs >= idleMs) {
              stop();
              return;
            }
          } else {
            live.idleMs = 0;
          }
        }
        // ③ THE POLICY — unchanged, and still the only thing that can end a recording from in here.
        if (!autoStopOn) return;
        //    …EXCEPT that it is SUSPENDED while a streaming session is live (§9.3-a): Tier 0's whole
        //    job is to end a push-to-talk clip at the first pause, and under phrase dictation the
        //    pause is the point. The run is RESET rather than frozen — the window is CONTINUOUS
        //    silence, so a session that dies mid-recording must hand the policy a fresh run, not a
        //    stale one that ends the clip the moment it resumes.
        if (live && !live.dead) {
          silentMs = 0;
          return;
        }
        if (rms >= silenceFloor) {
          silentMs = 0; // anything above the floor restarts the run
          return;
        }
        silentMs += SILENCE_POLL_MS;
        if (silentMs >= silenceMs) stop(); // the SAME path as tapping stop → onstop → upload
      }, SILENCE_POLL_MS);
    },
    [
      armStream,
      autoStopOn,
      idleMs,
      maxMs,
      silenceFloor,
      silenceMs,
      stop,
      streamWanted,
      teardownAudio,
    ],
  );

  /** The pre-flight EVERY entry shares — the tap, and (since S0.5) the gesture's activation. No
   *  mediaDevices → can't capture: re-explain the fix on every attempt (greyed but tappable, so it's
   *  never a dead/stuck control). Capable but plain HTTP (flag-whitelisted) → it WORKS (never greyed);
   *  just nudge once per session that HTTPS is the proper setup. Returns whether a recording may start.
   *  ONE function rather than a second copy in the gesture path: the degraded states are UX contracts
   *  (owner-locked 2026-06-22/26), and two copies is how one of them quietly stops being true. */
  const preflight = useCallback((): boolean => {
    if (!micCapable) {
      pushToast(INSECURE_MSG, "info");
      return false;
    }
    if (!httpsOn && !httpReminderShown) {
      httpReminderShown = true;
      pushToast(HTTP_REMINDER, "info");
    }
    return !unavailable;
  }, [micCapable, unavailable]);

  /** Open the mic and start recording. RESOLVES TO WHETHER A RECORDER ARMED (S0.5): the gesture holds a
   *  visible record affordance from the moment of activation, and a permission prompt that is declined —
   *  or a browser with no usable container — must close that affordance rather than leave it painted
   *  over a mic that never opened. `false` also covers the F5 abort (released during acquisition). */
  const start = useCallback(async (): Promise<boolean> => {
    // A NON-NULL `recRef` OWNS the recorder's lifecycle until one of its terminal callbacks releases
    // it (F2) — `state` alone is not enough: `stop()`/`cancel()` flip it to "inactive" synchronously
    // while the final `dataavailable`/`stop` events are still QUEUED, and a recording started inside
    // that window would overwrite the chunks, the discard flag and the stamp the late callback is
    // about to read. A too-early re-press gets `false` here and closes its own chrome, as it does for
    // every other reason a recorder does not arm.
    if (armRef.current || recRef.current) return false;
    if (!preflight()) return false;
    // A fresh recording starts HAND-ON by default: `start()` is what the gesture calls from a press,
    // and whoever knows better (the gesture's `locked` stage, the keyboard's tap-to-start) says so
    // after. ⚠ IT MUST PRECEDE THE FIRST AWAIT (S2.5 review F3) — the ordering rule this codebase
    // already keeps for the call's mute: a rule write must reach the object it governs the MOMENT that
    // object exists, never across an async window. `getUserMedia` can sit on a permission prompt for
    // seconds, the gesture reaches `locked` inside that window and publishes `handsFree = true`, and a
    // reset landing afterwards would silently overwrite it — disarming the §9.3-c idle stop for the
    // whole session, which would then run to the hard cap. Written here, any lock published during
    // acquisition lands AFTER it and wins.
    handsFreeRef.current = false;
    const arm = { aborted: false };
    armRef.current = arm;
    try {
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch {
        // ABORTED FIRST (F1): the gesture let go while the browser was still asking. A rejection that
        // lands after that is the user's own release, not a new fact to report — and the toast and the
        // teardown below both belong to the CURRENT attempt, whose detector/listener this one must not
        // touch. (The non-aborted path is unchanged: a real denial still explains itself.)
        if (arm.aborted) return false;
        teardownDetector(); // every failed start leaves the detector state clean (MED-2)
        pushToast("Microphone permission denied", "err");
        return false;
      }
      // F5 — the gesture ended (release, or a cancel) while the browser was still opening the mic.
      // Release the stream we were handed at once: an ownerless recording is the one outcome the
      // acquisition window must never produce.
      if (arm.aborted) {
        stream.getTracks().forEach((t) => t.stop());
        return false;
      }
      const mime = pickMime();
      let rec: MediaRecorder;
      try {
        rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      } catch {
        // Construction can throw (no supported container) — release the stream we just opened.
        teardownDetector();
        stream.getTracks().forEach((t) => t.stop());
        pushToast("Recording isn't supported on this browser", "err");
        return false;
      }
      recRef.current = rec;
      chunksRef.current = [];
      discardRef.current = false;
      rec.ondataavailable = (e) => {
        if (e.data.size) chunksRef.current.push(e.data);
      };
      rec.onstop = () => {
        // OWNERSHIP ENDS HERE (F2) — before the upload, and before the discard branch returns: this is
        // the terminal callback the queued-events window was held open for, so the next `start()` is
        // free from now on. Guarded on the closure's own `rec` so a future defensive overwrite of the
        // ref is never clobbered by a late callback belonging to an older recorder.
        if (recRef.current === rec) recRef.current = null;
        teardownDetector(); // BEFORE the upload enters `sending` — the watcher dies with the recording
        stream.getTracks().forEach((t) => t.stop()); // release the mic indicator
        // THE CLIP LEAVES THE REFS HERE, once, before anything decides what becomes of it — the F2
        // ownership rule applied to the recording itself now that S2.5 can hold the decision open for
        // `tail_wait_ms` (see `upload`'s `@param clip`).
        const clip: Clip = { chunks: chunksRef.current, startedAt: startedAtRef.current };
        chunksRef.current = [];
        startedAtRef.current = 0;
        // CANCELLED (S0.5): the same teardown, and then nothing — no blob, no POST, no draft.
        if (discardRef.current) {
          discardRef.current = false;
          setPhase("idle");
          return;
        }
        // STREAMING (S2.5): the clip is PARKED, not uploaded — which of the two carries this
        // recording's words is rule ③'s decision, and it cannot be taken until the flush has had its
        // say. The session is detached here so no later `stop()` or unmount sweep can adopt a leg that
        // is already closing itself out.
        const live = streamRef.current;
        if (live) {
          streamRef.current = null;
          void finishStream(live, rec.mimeType || "audio/webm", clip);
          return;
        }
        void upload(rec.mimeType || "audio/webm", clip);
      };
      rec.onerror = () => {
        // OWNERSHIP IS DELIBERATELY NOT RELEASED HERE (the confirm round's sweep): an `error` is not
        // the end of the event stream — the platform's inactivate steps fire the final `dataavailable`
        // and `stop` AFTER it, and releasing early would let a new `start()` reset the shared
        // discard/chunks/stamp that late `onstop` is about to read. The `onstop` above stays the ONE
        // releasing terminal; what the error arms is the discard flag (F4), which makes that `onstop`
        // a clean no-upload close-out.
        discardRef.current = true;
        teardownDetector();
        // …and the streaming leg goes with it, unflushed: a recorder that failed has no release to
        // choreograph. Phrases already appended stay in the draft (rule ⑤) — they are the owner's.
        const live = streamRef.current;
        if (live) dropStream(live);
        stream.getTracks().forEach((t) => t.stop());
        startedAtRef.current = 0;
        pushToast("Recording failed", "err");
        setPhase("idle");
      };
      rec.start();
      startedAtRef.current = Date.now(); // the 1000 ms floor's only input
      setPhase("recording");
      // ALWAYS armed (OF-3): the analyser is the METER first and the auto-stop's input second. The
      // policy toggle now lives inside the poll, so a recording with auto-stop off still behaves
      // exactly as it did pre-Tier-0 — nothing in here can stop it — and the level flows regardless.
      void armDetector(stream);
      return true;
    } finally {
      // Only if it is still OURS: an abort released the ref so a re-press could start immediately, and
      // that newer attempt's token must survive this one's unwind.
      if (armRef.current === arm) armRef.current = null;
    }
  }, [upload, preflight, armDetector, teardownDetector, dropStream, finishStream]);

  /** Tap handler — the KEYBOARD/AT path since S0.5 (R69 §8.1: tap-to-start, tap-to-stop). idle → start,
   *  recording → stop + transcribe. Inert while unavailable/sending; the degraded explainers ride
   *  `preflight`, which `start` re-runs for the gesture. */
  const toggle = useCallback(() => {
    if (phase === "recording") {
      stop();
      return;
    }
    // `start` runs the pre-flight itself; running it HERE too would double the plain-HTTP nudge. The
    // one case `start` cannot cover is a tap that must still explain itself while nothing may start.
    if (phase === "idle" && !unavailable) {
      void start().then((armed) => {
        // A TAP-started recording is HANDS-FREE by construction (R69 §8.1: there is no hand to free),
        // so the §9.3-c idle stop arms for it. Written after `start` resolves, because `start` resets
        // the flag for the gesture's press path. A consumer driving the gesture instead publishes the
        // same fact from its `locked` stage; both land on the one ref.
        if (armed) handsFreeRef.current = true;
      });
      return;
    }
    preflight();
  }, [phase, unavailable, start, stop, preflight]);

  // Stop any in-flight recording if the composer unmounts mid-capture (tab switch to Conf/Utils).
  // `stop()` only ASKS the recorder (its `onstop` may land after we're gone), so the detector is torn
  // down here too — a timer/listener must never outlive the mount that owns it.
  useEffect(
    () => () => {
      stop();
      teardownDetector();
      // EVERY EXIT TEARS THE LEG DOWN, UNMOUNT INCLUDED (S2.5 — the S2b lesson generalized: an exit
      // that skips the teardown is an exit that leaks the ear). The REACHABLE half is `stop()` above:
      // it owes the choreography to whatever was recording, and that choreography closes its own
      // socket on a bounded path whether or not this component still exists.
      //
      // The sweep below is the BELT, and honestly labelled as one: today no leg can reach it. Every
      // path that ends a recording either marks the session `finishing` (`stop()`) or drops it outright
      // (`cancel`, `onerror`, a death, `onstop`'s hand-off to the release), and a leg can only be armed
      // by `armDetector` on a context whose own staleness check already refuses to arm one for a
      // recording that has ended. It stays because the RULE is "every exit", not "every exit we can
      // currently enumerate" — the next exit added here gets the teardown for free instead of being
      // the leak. (Red-proofed at the reachable half: removing `stop()` above is what goes red.)
      //
      // ⚠ The `!finishing` guard is LOAD-BEARING, not defensive dressing: `stop()` above only QUEUES
      // the recorder's terminal events, so a session it just marked is still parked in `streamRef`
      // until `onstop` detaches it — an unguarded drop here would close the very leg whose queued
      // choreography still owes the flush, and the tail phrase would be lost on every tab switch.
      const s = streamRef.current;
      if (s && !s.finishing) dropStream(s);
    },
    [stop, teardownDetector, dropStream],
  );

  // `insecure` wins over `unavailable`: with no secure context a recording attempt can't even start,
  // so the 502-driven `unavailable` flag never gets set — surface the actionable reason instead.
  const status: MicStatus = !micCapable ? "insecure" : unavailable ? "unavailable" : phase;
  // `toggle` is the keyboard/AT path; `start`/`stop`/`cancel` are the gesture's three verbs (S0.5).
  // There is one recorder behind all four. `meter`/`onTooShort`/`onPending`/`handsFree` are the
  // ASSIGNABLE seams — all null-safe, all owned by whoever mounts (assign on mount, null on cleanup),
  // so a second composer can never inherit a dead handler. The two S2.5 additions follow the shape
  // exactly rather than inventing a second one: chrome the gesture paints (`onPending`) and one fact
  // only the gesture knows (`handsFree`).
  return {
    status,
    toggle,
    start,
    stop,
    cancel,
    meter: meterRef,
    onTooShort: tooShortRef,
    onPending: onPendingRef,
    handsFree: handsFreeRef,
  };
}

/** The assignable seams' types, named so a consumer can state what it registers. */
export type MicMeterRef = MutableRefObject<((level: number) => void) | null>;
export type MicTooShortRef = MutableRefObject<(() => void) | null>;
export type MicPendingRef = MutableRefObject<((pending: boolean) => void) | null>;
