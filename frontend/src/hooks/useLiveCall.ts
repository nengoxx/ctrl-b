import { useCallback, useEffect, useRef, useState } from "react";

import {
  dismiss,
  getPlayStatus,
  markStreamRetag,
  openCallVoiceGate,
  type PlayStatus,
  setCallPrePlay,
  setCallVoice,
  subscribePlayback,
  useMouthFailures,
} from "../lib/audioController";
import { playDropCue } from "../lib/callCue";
import { sendCallTranscript } from "../lib/composer";
import {
  DBFS_SILENCE,
  effectiveFloor,
  type GateCfg,
  learnVoice,
  newNoiseTracker,
  type NoiseTracker,
  resetNoise,
  rmsToDbfs,
  trackNoise,
  type UtteranceLevels,
} from "../lib/levelGate";
import { liveSocketUrl, openLiveSocket, type LiveSocket } from "../lib/liveSocket";
import {
  ecEngaged,
  startPcmCapture,
  wantsAec,
  type MicRequest,
  type PcmCapture,
} from "../lib/pcmCapture";
import { accrue, enqueueBounded, newPacer, pump, type PacerState } from "../lib/uplinkPacer";
import { useStagedFiles } from "../store/attachments";
import { cancelTurn, confirmOutstanding, getLiveTurn, useChatSlice } from "../store/chat";
import { appendDraft } from "../store/composer";
import { endCall } from "../store/liveCall";
import { releaseMic } from "../store/micRelease";
import { getVoiceLevel, setVoiceLevel, voiceDeviceKey } from "../store/voiceLevels";
import { useVoiceStatus } from "./useVoiceStatus";

// THE CALL MACHINE (Phase 24 / D71 §4.2 · §4.3 · §4.5) — one owner for the ear, the brain and the mouth.
//
// Shaped like `micReduce` (S0.5): a PURE `callReduce` holding every rule, and a thin wiring layer below
// it that owns the sockets, the clocks and the stores. Everything a review argues about — what a final
// during `thinking` does, who may submit while a confirm is open, what a hang-up throws away — is in the
// reducer, testable without a browser.
//
// THE THREE RUN CONCURRENTLY, so one linear enum cannot carry the truth (council F5): a rendered PRIMARY
// PHASE plus two ORTHOGONAL FLAGS (`userSpeechActive` between the server VAD's start/stop,
// `waitingFinal` from a speech-stop until its transcript is consumed or discarded). The rule those flags
// exist for is §4.2's: **playback may not start while either holds** — the gap between "you stopped
// talking" and "your words arrived" must not let an older reply begin. A mouth that would open there IS
// a barge-in, killed before its first audible sample.
//
// ONE QUEUE FOR EVERY HOLD (§4.3). The cancel-settle window, the `barge_in`-off walkie-talkie hold, a
// suspended confirm gate and a staged upload in flight are four reasons not to submit and ONE mechanism:
// utterances join an ordered pending queue and drain as a SINGLE message, in order, when the last hold
// clears. Never a one-slot overwrite (the coherence sweep's correction), never lost speech.
//
// THE MOUTH IS NOT THE PHASE (S3). C3 plays over HTTP, so the reply is audible or not for reasons this
// call's socket knows nothing about — a leg that drops mid-reply changes the SCREEN and nothing else.
// `mouthLive` carries that truth beside the phase, and everything meaning "there is something to
// interrupt" reads it: a tap across the reconnect window still kills the reply, and the fresh leg's
// `ready` lands back on `speaking` rather than telling the owner the floor is theirs over a voice they
// can still hear.
//
// THE EAR-HOLD (S3 · `mic_hold`, D76 §B; the S0 device ruling). Where the track's AEC is the
// subtractive `"all"` mode the ear stays open under the reply and voice barge-in is real. Where it is
// not — Fennec, measured at near-full leak — an open ear would transcribe the character's own words
// into the owner's next message, so while the mouth is audible the ear is HELD (`earHeld`): the uplink
// carries silence in place of those frames (D76 §B.1 — the client still hears them) and every event
// from that stretch is dropped. Nothing is lost by it: interruption there is the tap, which is every
// browser's interrupt anyway (§4.3's trigger B).
//
// THE RELATIVE GATE (D76 §C). What counts as the owner speaking is measured in dBFS against a floor
// that FOLLOWS the room — a minimum-tracking noise estimate, the owner's own learned voice level, a
// clamp (`lib/levelGate`). One effective floor, computed in one place (`gateFloor`), read by the
// transcript gate's accrual, trigger A (raised by `playback_margin_db`) and the readouts alike.
//
// THE CALL SURVIVES BACKGROUNDING (D73 S6, evidence docs/research/R75). Nothing in the web platform
// ends a call because the page went hidden — our old `hidden`-ends-it arm was a policy, and it is now
// a knob (`background`), with `pagehide` as the one signal that really means the document is dying.
// What the policy cost to keep is an honesty problem, not a plumbing one: Chrome Android FREEZES a
// hidden page that has made no sound for ~90 s, which pauses the audio graph — the ear goes deaf while
// the track stays live, the socket stays open and this screen goes on saying Listening. So three arms
// hold the line: the page is kept (inaudibly) audible while it is away, the ear is asked on every wake
// whether it slept — `earOutage`, which redials and SAYS SO — and a backgrounded call nobody is in
// ends itself rather than riding a hot mic to the session cap.
//
// THE GENERATION FENCE (delta round F7). Every asynchronous callback — a send's outcome, a cancel's
// settlement, a reconnect timer, a socket event — carries the generation it was armed under, and the
// reducer drops anything armed under a different one. Hanging up bumps the generation, so a hang-up's
// own C3 kill can never fire a stale drain-submit and a redial inherits nothing.

// ── the named constants (all of them, in this one file — the R69 precedent) ──────────────────────
// What is NOT here: every §4.1 tunable (`frame_ms`, `buffered_ceiling_ms`, `min_speech_ms`,
// `barge_in`, `max_session_s`, the D76 §C gate six). Those are the owner's, delivered by
// `/voice/status.live_call`, and this hook reads them — it never defaults them. The level gate's own
// estimator constants live beside the estimators (`lib/levelGate`), the drop cue's beside the cue
// (`lib/callCue`).

/** Reconnect attempts before the call gives up (§4.5's "bounded attempts with backoff"). One per entry
 *  in the backoff schedule below, which is what keeps the two from drifting apart.
 *
 *  THE LADDER MUST OUTLAST THE RELAY'S SLOT (A-F3, evidence docs/research/R72 §4). When this client's own
 *  leg dies without a close frame — a Wi-Fi↔LTE handover, the case §4.5's reconnect contract exists for —
 *  the relay goes on holding its `max_sessions` slot until its WebSocket ping times out, and every dial
 *  inside that window is refused `busy` by a session that is really this same phone. The launch sites now
 *  run uvicorn at `--ws-ping-interval 5 --ws-ping-timeout 5` (R72's (B), the deploy half of the same fix),
 *  which puts the worst-case slot release at 10.0 s — so the ladder spans ≈14.1 s, with margin, instead of
 *  the 6.1 s that could not reach it. Longer rungs, not more of them: six dials is already generous for a
 *  single-user install, and the last two repeat because a link that has not returned in 10 s is not coming
 *  back in a hurry. */
const RECONNECT_BACKOFF_MS = [400, 900, 1800, 3000, 4000, 4000] as const;

/** How long the "connection strained" note stands after a `degraded` frame, unless another one re-arms
 *  it (S2b — the S2a residual).
 *
 *  It has to be a CLIENT decision because neither end of the loss chain says the good news: the relay
 *  emits ONE `degraded` state per overflow burst and has no recovery signal at all
 *  (`services/voice_live.py` — the bounded queue drops its oldest frames and says so once), and the
 *  client's OWN bounded queue (A-F2 — see the pacer in the capture callback) reports the same way on
 *  purpose: one loss chain, one signal, one hold. Without that hold the note would stand for the whole
 *  rest of the call over a single hiccup, which is how a warning stops meaning anything.
 *
 *  3× the relay's own default `relay_queue_ms` (2000 ms of audio, `LiveCfg`): long enough that a burst
 *  of overflows re-arms the note rather than flickering it, short enough that a call which recovered
 *  stops claiming otherwise. Not a config knob — it is the presentation of someone else's number, and
 *  the owner tunes the queue, not the note. */
const DEGRADED_NOTE_MS = 6000;

/** How successive queued utterances are joined into the ONE message a drain submits: a space, because
 *  they are continuous speech, not composer lines. (The composer HARVEST joins with newlines — there
 *  they are lines the owner will edit.) */
const PENDING_JOIN = " ";
const HARVEST_JOIN = "\n";

/** How long a gap in the EAR's own frames means the ear stopped hearing (D73 S6 ② / A2, evidence
 *  docs/research/R75 §3).
 *
 *  The failure it detects is silent by construction: Chrome Android freezes a hidden, inaudible page
 *  (`kStopInBackground`, ON by default) and the freeze PAUSES the AudioContext, so the worklet's
 *  `process()` stops being called while `track.readyState` stays `"live"`, the permission stays
 *  granted, the socket stays open and the overlay goes on saying Listening. Nothing reports it; only
 *  the missing frames do.
 *
 *  4 s is chosen against both ends of that gap and not by feel: the graph mints a frame every
 *  `frame_ms` (40 ms by default), so this is two orders of magnitude past ordinary jitter and past any
 *  main-thread stall the uplink pacer was built for (R71) — and it is a small fraction of the ~90 s of
 *  background silence R75 §3.5 derives before a freeze can even begin, so nothing short of an ear that
 *  genuinely stopped can trip it. NOT a config knob, for `DEGRADED_NOTE_MS`'s reason: it describes the
 *  platform's behaviour, not a preference of the owner's. */
const EAR_OUTAGE_MS = 4000;

/** The signals that re-arm the background idle clock (D73 S6 ④ / Maya F6): the owner speaking, their
 *  words landing, and the reply's mouth opening and closing — the four edges that mean a call is still
 *  a conversation. `confirmHold` rides the same set as the PAUSE edge: it is not activity, but it is
 *  the one other thing that changes whether the clock may run at all, and routing it through the same
 *  "look again" call keeps one decision in one place. `speechStop` is deliberately out — its `final`
 *  follows within the same breath and re-arms for it. */
const IDLE_EDGES: ReadonlySet<CallSignal["type"]> = new Set([
  "speechStart",
  "final",
  "playbackStarted",
  "playbackDrained",
  "confirmHold",
]);

/** How much of trigger A's window has to be above the floor before the kill fires (D74 S4 ⑥).
 *
 *  What it replaces is a CONSECUTIVE run: one frame under the floor reset the clock to zero, so the
 *  owner had to produce `min_speech_ms` of UNBROKEN above-floor energy to interrupt — which is not
 *  what speech looks like at a 20–40 ms frame, where a stop consonant or the breath between two
 *  syllables is a hole several frames wide. Same floor, same window; a MAJORITY of it instead of all
 *  of it.
 *
 *  3/4 rather than a knob, deliberately: it is the shape of the detector, not a preference of the
 *  owner's. The two things the S4 gate calibrates are the floor (the effective floor plus
 *  `playback_margin_db`, D76 §C.6) and the window (`min_speech_ms`), and a third dial on the same
 *  decision makes both of those harder to read. */
const BARGE_HIT_RATIO = 0.75;

/** How often the debug block re-reads, ms (D74 S7). The measurements it shows arrive on the audio
 *  callback at 25–50 Hz, and re-rendering the overlay per frame to show them is exactly the trade the
 *  meter's ref refused — so the block SAMPLES instead. 250 ms is fast enough to watch a syllable move
 *  the peak and slow enough to be invisible in a profile; the block only exists while the owner has
 *  the `debug` knob on. Not a knob of its own: it is a property of reading, not of the call. */
const DEBUG_TICK_MS = 250;

/** THE UPLINK'S SILENCE (D76 §B.1): the ONE zeroed buffer a held frame is sent as, reallocated only when
 *  the frame size changes (a capture's size is fixed by its rate and `frame_ms`, so in practice once per
 *  capture). Sharing it across queued entries is safe because nothing writes to it and the wire COPIES:
 *  `enqueueBounded`/`pump` only move references through the pacer's FIFO, and `WebSocket.send()` of an
 *  `ArrayBuffer` queues a copy of its bytes rather than transferring (detaching) it. */
let silentFrame: ArrayBuffer | null = null;
function silenceLike(buf: ArrayBuffer): ArrayBuffer {
  if (silentFrame?.byteLength !== buf.byteLength) silentFrame = new ArrayBuffer(buf.byteLength);
  return silentFrame;
}

/** How long the debug readout's PEAK holds, ms (D74 S7 / R78 §6.2). The whole C1 diagnosis is "is the
 *  line above the hill", and without a hold the owner cannot see a floor their voice never reaches —
 *  the instantaneous number is already back under it by the time the eye arrives. R78's own
 *  recommendation, and about one spoken phrase. Not a knob: it is a property of human eyesight. */
const PEAK_HOLD_MS = 2000;

/** THE TAB'S LIVE-CALL MARKER (D73 S6 ⑦ / R75 §9.2). `sessionStorage` because the key is exactly
 *  per-tab and — the whole point — it SURVIVES the reload a discarded tab comes back through.
 *
 *  It answers one question the machine cannot otherwise ask: a FIRST dial refused `busy` is genuinely
 *  another device holding the call, UNLESS this same tab was in a call a moment ago, in which case the
 *  slot the relay has not reaped yet is this phone's own ≤10 s zombie (R72 §4). Ownership is never
 *  inferred from `attempts` — two tabs, or a second device, make "another call is active" a real story
 *  the ladder would erase (Maya F5, which the main seat's own unification lost to).
 *
 *  It is a HEURISTIC and the council ruled its hole bounded and acceptable: a tab killed without
 *  running its teardown leaves the marker standing, so the next first dial reads a genuine
 *  other-device refusal as its own zombie and spends the ladder (~14 s) before saying so — on a
 *  single-user install, a slower answer to a question that is nearly always the other way round. */
const BUSY_MARKER = "ctrlb-live-call";

/** Write/clear the marker. Wrapped like any storage access: a private window, blocked site data or a
 *  full quota all throw, and not one of them is a reason a call cannot be made. */
function markLeg(on: boolean): void {
  try {
    if (on) sessionStorage.setItem(BUSY_MARKER, "1");
    else sessionStorage.removeItem(BUSY_MARKER);
  } catch {
    // No marker, then: the busy arm simply keeps today's terminal, which is the safe default.
  }
}

/** …and the read, taken ONCE at call start — before this call's own leg writes one. */
function markStanding(): boolean {
  try {
    return sessionStorage.getItem(BUSY_MARKER) !== null;
  } catch {
    return false;
  }
}

/** The overlay's own copy. Plain sentences, kept here so the machine's arms can pin them. */
export const CALL_COPY = {
  busy: "another call is active",
  /** …and the same refusal arriving mid-RECONNECT, which is a different fact (A-F3): the only thing this
   *  client can collide with there is its own zombie slot, and the ladder is already redialling. */
  busyRetrying: "the last connection hasn't let go yet — retrying",
  /** …and the TERMINAL that ladder ends on when it never did. `lost` would be a different, wrong story
   *  — the link was never lost, every dial was ANSWERED and refused — and it is the wrong remedy too:
   *  this one clears by waiting for the relay to reap its slot, which "Call again" then finds free. */
  busyHeld: "the last connection never let go",
  limit: "call time limit reached",
  strained: "connection strained",
  /** A `protocol` terminal, in the owner's words. The relay's own message is an internal sentence
   *  ("uplink frame rate exceeded: 4040 ms of audio in 2s …") written for a log, and the terminal face
   *  already carries the action (Call again) — so the note says what happened, not what tripped. */
  protocol: "the connection had a problem",
  micLost: "the microphone stopped",
  // "…text only", never a PLACE (design L2): with captions on the reply is on THIS screen, and copy
  // sending the owner to the chat while they are reading it here would be the screen contradicting
  // itself. The reducer cannot see the captions knob, so the words name the mode, not the location.
  voiceFailed: "voice failed — the reply is text only",
  refused: "couldn't send that — it's back in the composer",
  unknown: "not sure that sent — check the chat before repeating it",
  lost: "lost the connection",
  unconfigured: "live call is not configured",
  /** D73 S5 — the picked capture device would not open, so this call is on the system default route
   *  (`openMicStream`'s one retry). The call works; where the sound comes out may not be where the
   *  owner asked for it, and that is worth one line on the overlay. */
  deviceFallback: "that microphone wasn't available — using the default",
  /** D75 ③ — an EC-off route asked for the media path and the track came back with the canceller
   *  still engaged, twice (R80 §5: the mode is restored only when the LAST input stream is released,
   *  and our re-open can beat that release). The call works and the ear is safe either way; what the
   *  owner has lost is the clean audio they picked the route FOR, and nothing else would say so. */
  ecStuck: "the echo canceller didn't let go — audio may still be processed",
  /** D73 S6 ② — the ear stopped hearing while the page was away (a frozen renderer, a stolen mic) and
   *  the leg is being redialled. It says what the owner needs to know and nothing else: a resumed call
   *  must never present as if it heard, and the stretch it missed is not recoverable. */
  earAsleep: "the ear was asleep — nothing said while away was heard",
  /** D74 S5 — a final the EAR has no energy to account for: the relay answered a stretch of near
   *  silence with a plausible sentence (R76), and the microphone says nobody said it. The line owns
   *  up to the DISCARD rather than explaining the mechanism — what the owner needs to know is that
   *  their words did not go, and that saying it louder is the remedy. */
  tooQuiet: "too quiet — didn't take that",
  /** D73 S6 ④ — the background idle end. The terminal face already says "Call ended", so the note is
   *  the REASON, which is the one thing a call that ended on its own owes the owner. */
  idleBackground: "the call sat idle in the background",
} as const;

/** The notes a FRESH LEG retracts — connection news, which a live connection has just made false.
 *  Everything else standing there (a refused send, a mouth failure, an upstream hiccup) arrived for its
 *  own reason and is the owner's unread news, which a reconnect has no business clearing (S2b confirm
 *  F3). The set exists because there are now two: the strained note, and the busy-retrying one the
 *  reconnect itself put up. */
const CONNECTION_NOTES: readonly string[] = [CALL_COPY.strained, CALL_COPY.busyRetrying];

// ── the machine ──────────────────────────────────────────────────────────────────────────────────

export type CallPhase = "connecting" | "listening" | "thinking" | "speaking" | "error" | "ended";

export interface CallState {
  phase: CallPhase;
  /** Between the server VAD's `speech_started` and `speech_stopped`. */
  userSpeechActive: boolean;
  /** Speech stopped, its transcript not yet consumed or discarded. */
  waitingFinal: boolean;
  /** The §4.3 pending-utterance queue: ordered, drained as one message. */
  pending: string[];
  /** The last final the ear heard — the overlay's transcript line (what YOU said, §6). */
  heard: string;
  /** One plain line: a degrade, a nonfatal failure, or a terminal's reason. */
  note: string | null;
  /** The cancel-settle window (§4.3 step ②): a kill is in flight and nothing may submit yet. */
  killing: boolean;
  /** A staged upload held the last submit (§4.5) — the utterance went back on the queue. */
  heldUpload: boolean;
  /** A confirm gate is outstanding (delta round F1): utterances hold until it resolves either way. */
  confirmHold: boolean;
  /** The ear is MUTED (§6's call furniture): the track is disabled, the frames keep flowing as silence,
   *  and nothing the ear still delivers about the muted stretch is taken. */
  muted: boolean;
  /** THE MOUTH IS AUDIBLE — the observed transport truth, and deliberately ORTHOGONAL to the phase (S3).
   *  C3 rides HTTP, not the call's socket, so a reply keeps playing straight through a reconnect while
   *  the rendered phase is `connecting`. Anything that means "there is something to interrupt" reads
   *  THIS; only what the screen says reads `phase`. Maintained by the playback signals whatever the
   *  phase logic decides to do with them. */
  mouthLive: boolean;
  /** Does THIS call's track need the ear-hold at all (`mic_hold`, D76 §B — resolved ONCE at capture
   *  from the track's own AEC readback — never UA-sniffed, never re-decided mid-call). */
  earHoldMode: boolean;
  /** Is the canceller ENGAGED on the ear that actually opened — the track's readback, never the ask
   *  (ISS-18 review F3): an EC-off route whose capture came back EC-on (`ecStuck`) is still IN comm
   *  mode, and only this bit knows it. Seeded on `captureReady`; what `leavesComm` measures against. */
  ecOn: boolean;
  /** …and is it closed right now. DERIVED after every reduce (see `normalize`) — never set by an arm. */
  earHeld: boolean;
  /** THE ROUTE THIS CALL IS ON, and the device it asked for (D74 S2) — EPHEMERAL, per call. Seeded
   *  from the knobs by the capture that actually opened (`captureReady`) and moved only by the
   *  owner's in-call control, which deliberately writes NO config: §4.5 says settings edited mid-call
   *  apply to the next call, and the Conf pair stays exactly that — the next call's default. What the
   *  owner does on the call screen is about THIS call, and it dies with it. */
  route: string;
  inputDevice: string;
  /** THIS TAB WAS IN A CALL WHEN IT LAST WENT AWAY (D73 S6 ⑦) — the `sessionStorage` marker was
   *  standing when this machine started, which only happens when a leg opened here and no clean end
   *  cleared it: a discarded tab's reload, a crash. Read ONCE at call start, like `earHoldMode`, and
   *  consulted by exactly one rule — whether a FIRST dial's `busy` is another device or our own
   *  unreaped slot. */
  priorLeg: boolean;
  /** The call generation (F7). Bumped by every terminal and by hang-up. */
  gen: number;
  /** Reconnect attempts spent since the last `ready`. */
  attempts: number;
}

export const CALL_INITIAL: CallState = {
  phase: "connecting",
  userSpeechActive: false,
  waitingFinal: false,
  pending: [],
  heard: "",
  note: null,
  killing: false,
  heldUpload: false,
  confirmHold: false,
  muted: false,
  mouthLive: false,
  earHoldMode: false,
  earHeld: false,
  route: "",
  ecOn: false,
  inputDevice: "",
  priorLeg: false,
  gen: 0,
  attempts: 0,
};

export type SendResult = "accepted" | "refused" | "unknown" | "held";

export type CallSignal = { gen?: number } & (
  | { type: "ready" } //                       the relay said `state: ready`
  | { type: "socketLost" } //                  the leg closed while the call was still wanted
  | { type: "speechStart" }
  | { type: "speechStop" }
  /** …with THE TRANSCRIPT GATE's two numbers (D74 S5), carried on the signal because the rule is the
   *  reducer's and the measurement is the wiring's. `energyMs` is the ear's own accrual for the
   *  utterance this final is about — ABSENT when no epoch matched, which is the fail-open case: a
   *  final nobody measured is unmeasured, not quiet. `minFinalMs` is the owner's knob, delivered the
   *  same way every other §4.1 tunable is; absent or 0 means the gate is off. */
  | { type: "final"; text: string; energyMs?: number; minFinalMs?: number }
  /** The uplink is losing audio — the relay's own overflow state, or (A-F2) our own bounded queue
   *  dropping its oldest frames. ONE signal for both, deliberately: it is one loss chain, and two notes
   *  for it would be two things saying the same thing. */
  | { type: "degraded" }
  | { type: "degradedOver" } //                the strained note's hold expired (see DEGRADED_NOTE_MS)
  | { type: "setMuted"; on: boolean } //       the mute control (§6)
  /** The capture RESOLVED, carrying the one thing about it the rules depend on: whether this track
   *  needs the ear-hold (`mic_hold`, D76 §B — resolved against the track's own AEC
   *  readback). `note` is the one thing about it the SCREEN depends on: the D73 device fallback. */
  | {
      type: "captureReady";
      earHoldMode: boolean;
      note?: string;
      route: string;
      /** The readback's EC truth (`ecEngaged`); absent ⇒ derived from the route's ask (tests). */
      ecOn?: boolean;
      deviceId: string;
    }
  /** D74 S2 — the owner moved the route, the input device, or both, WHILE the call is up. Legal only
   *  in the settled phases; anywhere else it is a no-op, because there is either a leg already being
   *  opened or no ear left to move. */
  | { type: "routeChange"; route?: string; deviceId?: string }
  /** D73 S6 ⑦ — the tab's own live-call marker was standing when this machine started (see
   *  `BUSY_MARKER`). Sent at call start, BEFORE this call's first leg writes its own. */
  | { type: "priorLeg" }
  /** D73 S6 ② — the ear missed a stretch: the frames stopped arriving while the page was away (a
   *  frozen renderer, R75 §3.4) and the gap outran `EAR_OUTAGE_MS`. */
  | { type: "earOutage" }
  /** D73 S6 ④ — a BACKGROUNDED call sat past `background_idle_s` with no speech and no reply. */
  | { type: "idleExpired" }
  | { type: "serverError"; code: string; message: string }
  | { type: "serverEnded" } //                 the relay said `state: ended`
  | { type: "barge" } //                       trigger A (voice) or B (tap) — the same edge
  | { type: "killSettled" }
  | { type: "playbackStarted" }
  | { type: "playbackDrained" }
  | { type: "playbackFailed" }
  | { type: "turnSettled" } //                 chat status left `streaming`
  | { type: "confirmHold"; on: boolean }
  | { type: "sent"; outcome: SendResult; text: string }
  | { type: "uploadSettled" }
  | { type: "captureLost" }
  /** The user's own exit. Since S2b the OVERLAY does not send this — the shell owns "a call is up" and
   *  ending it is `endCall()`, whose unmount IS the teardown — but the rule it carries is the same one
   *  `hidden` needs, and the two share this arm. */
  | { type: "hangup" }
  /** The page went away — a clean end, not an error. WHO sends it changed at D73 S6: `pagehide`
   *  always does (the document really dying, A7), and `visibilitychange→hidden` only while
   *  `background` is off. The RULE it lands on is the hang-up's, unchanged. */
  | { type: "hidden" }
  /** The machine's component is UNMOUNTING (the shell's `endCall`, or a redial's key bump). The arm
   *  exists for the FENCE, not the teardown: the wiring's callbacks — a socket frame already
   *  dispatched (`close()` only starts the handshake), a `cancelTurn` settlement, a send outcome —
   *  can land AFTER the unmount, and before S2b every user exit moved the generation through the
   *  `hangup` arm so those became ghosts. The shell exit must too, or a `final` in that gap still
   *  SUBMITS after the owner closed the call (§4.3's hang-up-discards, violated one task late).
   *  Deliberately NOT `hangup` itself: its `close: true` would `endCall()`, and on a redial's
   *  remount that would kill the fresh call the owner just asked for. */
  | { type: "unmounted" }
  /** The start effect's SETUP is running (again). Dev-only in practice: StrictMode runs every effect
   *  setup → cleanup → setup on the same instance, state surviving, so the cleanup's `unmounted` has
   *  just landed the machine terminal — and without a symmetric re-arm every call on the dev server
   *  dies at birth ("Call ended", no note, redial included). Carries no `gen` ON PURPOSE: it is the
   *  one signal that must land across the generation the cleanup moved. */
  | { type: "remount" }
  | { type: "failed"; note: string } //        the call could not start at all
);

export type CallEffect =
  | { type: "submit"; text: string }
  /** The §4.3 ORDERED kill: C3 first (synchronous, the audible part stops now), then the scoped cancel
   *  AND its settlement, and only then the pending submit. The reducer has already set `killing`, so the
   *  queue is held for the whole of it. */
  | { type: "kill" }
  | { type: "harvest"; lines: string[] }
  | { type: "reconnect"; delayMs: number }
  /** (Re)arm the strained note's hold — the relay never says "recovered", so the client times it out. */
  | { type: "degradeHold" }
  /** THE DROP CUE (D76 §C.5): the transcript gate just discarded a final as too quiet — say so out
   *  loud, because the owner in the car cannot read the note (`lib/callCue`). */
  | { type: "dropCue" }
  /** Close THIS leg and nothing else (D73 S6 ②). Deliberately not a reconnect: the close is what the
   *  ONE existing `socketLost` arm reconnects from, so the ladder keeps its own accounting — the
   *  outage spends a rung from wherever the ladder stands instead of minting a second counter beside
   *  it (the `busy` arm's lesson, A-F3). */
  | { type: "closeLeg" }
  /** THE ROUTE CYCLE (D74 S2): close this leg cleanly, release the ear, and run the SAME acquisition
   *  the mount effect runs — under the new constraints. In-place `applyConstraints` is rejected by
   *  design (R78 §8: the mode is pinned by the live source for the device, and the round-trip reports
   *  success on a set it never widened), so the only honest way to change the route is a new track. */
  | {
      type: "recapture";
      route: string;
      deviceId: string;
      /** The flip leaves comm mode (EC on → off): the mouth must open a FRESH output stream for the next
       *  reply (`audioController.markStreamRetag`, ISS-18 / R81). */
      leavesComm: boolean;
    }
  /** Release everything. `close` additionally dismisses the overlay — the user's own exit gets no
   *  terminal screen (§6); an `error`/`ended` terminal keeps the overlay up to say why. */
  | { type: "teardown"; close: boolean };

interface Step {
  state: CallState;
  out: CallEffect[];
}

const isTerminal = (p: CallPhase): boolean => p === "error" || p === "ended";

/** The phases a ROUTE CYCLE is legal in (D74 S2) — the call is up and settled. `connecting` is out
 *  because a leg is already being opened there and a second acquisition racing it is exactly what the
 *  generation fence exists to prevent; the terminals are out because there is no ear left to move. */
const isStable = (p: CallPhase): boolean =>
  p === "listening" || p === "thinking" || p === "speaking";

/** Every reason a queued utterance may not go out right now (§4.3's one mechanism, four holds). */
function held(s: CallState): boolean {
  return (
    s.killing ||
    s.confirmHold ||
    s.heldUpload ||
    s.phase === "speaking" ||
    s.phase === "connecting" ||
    isTerminal(s.phase)
  );
}

/** Submit the WHOLE queue as one message if nothing holds it. The single drain — every release path
 *  calls it, so "what happens when a hold clears" has exactly one answer. */
function drain(s: CallState): Step {
  if (held(s) || s.pending.length === 0) return { state: s, out: [] };
  return {
    state: { ...s, pending: [], phase: "thinking" },
    out: [{ type: "submit", text: s.pending.join(PENDING_JOIN) }],
  };
}

/** The observed mouth, written without churning the state when nothing moved (the wiring's `next !==
 *  ref.current` check is what keeps a re-render honest). Its callers set it from the PLAYBACK signals
 *  regardless of what their phase logic does with them — see `mouthLive`. */
function mouth(s: CallState, live: boolean): CallState {
  return s.mouthLive === live ? s : { ...s, mouthLive: live };
}

/** Start the §4.3 ORDERED kill. Both triggers land here, and so does §4.2's iron rule, so the state the
 *  kill leaves behind is written once.
 *
 *  `mouthLive` goes down with it, and that is not an inference about the element: step ① of the effect is
 *  a SYNCHRONOUS `dismiss()`, so by the time anything else reads this state the audible part is already
 *  gone. Waiting for the playback store's own drain to say so would leave a window — a `killSettled` that
 *  answers synchronously (the turn was already terminal, the common case per council F1) lands BEFORE the
 *  drain does — in which the ear-hold would close again over exactly the words the owner interrupted
 *  with. */
function killNow(s: CallState): Step {
  return { state: { ...mouth(s, false), killing: true }, out: [{ type: "kill" }] };
}

/** Land on a terminal: the pending queue is HARVESTED (never-lose applies to failures), the flags are
 *  cleared, and the generation moves so nothing armed under the old one can still fire. */
function terminal(s: CallState, phase: "error" | "ended", note: string): Step {
  const out: CallEffect[] = [];
  if (s.pending.length) out.push({ type: "harvest", lines: s.pending });
  out.push({ type: "teardown", close: false });
  return {
    state: {
      ...s,
      phase,
      note,
      pending: [],
      userSpeechActive: false,
      waitingFinal: false,
      killing: false,
      // …`muted` included: the terminal's teardown RELEASES the capture, so a closed ear is not a state
      // any more, and the terminal face carries no control to reopen it. A ring still wearing the static
      // muted look there would be describing something that no longer exists.
      muted: false,
      // The same reasoning, twice over (S3): the teardown's `dismiss()` silences the mouth, and the
      // track the ear-hold governs is released with it — a hold standing on a capture that is gone, or a
      // MODE describing a track nobody holds, would both outlive the thing they were about. The next
      // call re-reads the mode from its own track.
      mouthLive: false,
      earHoldMode: false,
      earHeld: false,
      gen: s.gen + 1,
    },
    out,
  };
}

/**
 * The whole conversation loop, as one pure function.
 *
 * THE EAR-HOLD IS DERIVED, NOT DECIDED (S3): `earHeld` is normalized once here, after the arm has had its
 * say, rather than being maintained by every arm that could move one of its three inputs. A rule spread
 * across a dozen arms is a rule with a dozen chances to be forgotten by the next one.
 */
export function callReduce(s: CallState, sig: CallSignal): Step {
  const step = reduce(s, sig);
  // `earHoldMode` is the track's (does this ear leak?), `mouthLive` the transport's (is the reply
  // audible?), and `!killing` the machine's own: an interrupt in flight has ALREADY silenced the mouth
  // synchronously, and holding the ear until the cancel settles would eat the first word of exactly the
  // sentence the owner interrupted with.
  const earHeld = step.state.earHoldMode && step.state.mouthLive && !step.state.killing;
  if (earHeld === step.state.earHeld) return step;
  return { state: { ...step.state, earHeld }, out: step.out };
}

function reduce(s: CallState, sig: CallSignal): Step {
  // THE FENCE (F7), first line: a callback armed under an older generation is not this call's business.
  if (sig.gen !== undefined && sig.gen !== s.gen) return { state: s, out: [] };
  // "Hang up from every state" (§4.2) is the one rule that outranks the terminal guard below — and
  // `unmounted` shares it: the generation MUST move on every exit, terminal or not, or a callback
  // still in flight (a dispatched socket frame, a cancel settlement) outlives the call it belonged to.
  if (sig.type === "hangup" || sig.type === "hidden" || sig.type === "unmounted") {
    // A deliberate exit DISCARDS the pending queue: the owner chose to leave, and never-lose-speech is
    // about failures, not about the user's own decision (§4.3's terminal disposition). `unmounted`
    // alone does not `close` — its component is ALREADY unmounting, and an `endCall()` here would end
    // the fresh call a redial's key bump is mounting in the same commit.
    return {
      // `priorLeg` survives the reset (S6 code-review F3, reshaped): StrictMode's simulated cleanup
      // funnels through THIS arm, and its teardown clears the sessionStorage marker — so the state's
      // copy is the only carrier left when the re-run's `remount` re-arms. A REAL exit loses nothing
      // by it: a redial's key bump mounts a fresh instance whose state starts at CALL_INITIAL anyway.
      state: { ...CALL_INITIAL, phase: "ended", priorLeg: s.priorLeg, gen: s.gen + 1 },
      out: [{ type: "teardown", close: sig.type !== "unmounted" }],
    };
  }
  // The re-arm HAS to outrank the terminal guard — the terminal it recovers from is the one the
  // cleanup's `unmounted` just wrote. The generation is PRESERVED, not reset: everything the first
  // setup armed (a capture promise, a socket frame) was fenced out by the cleanup's bump, and a
  // fresh run re-reads `ref.current.gen` live. On a machine that is not terminal — the genuine
  // first mount — this is a no-op, so the arm cannot disturb a call that is actually running.
  if (sig.type === "remount") {
    if (!isTerminal(s.phase)) return { state: s, out: [] };
    // `priorLeg` is preserved beside the generation, and for a related reason: the first setup's
    // teardown CLEARED the marker it was read from, so the re-arm is the only thing that can carry
    // what this tab learned about the previous document into the call that actually runs.
    return { state: { ...CALL_INITIAL, gen: s.gen, priorLeg: s.priorLeg }, out: [] };
  }
  if (isTerminal(s.phase)) return { state: s, out: [] };

  switch (sig.type) {
    case "ready":
      // A fresh leg is a fresh session: the ear knows nothing about a half-spoken phrase that died with
      // the old socket, so the flags start clean and the reconnect budget resets. The note follows the
      // `degradedOver` rule (S2b confirm F3): only CONNECTION news is retracted by a fresh connection —
      // anything else standing there (a refused send, a mouth failure) is unread news that arrived for
      // its own reason, and a reconnect has no business clearing it.
      return drain({
        ...s,
        // A FRESH LEG CHANGES NOTHING ABOUT THE MOUTH (S3). C3 rides HTTP, so a reply that was speaking
        // when the socket dropped is still speaking now — landing on `listening` here would tell the
        // owner the floor is theirs over a voice they can hear, and (worse, before the `mouthLive` gate
        // below) would make their tap-to-interrupt inert for the rest of the reply.
        phase: s.mouthLive ? "speaking" : "listening",
        attempts: 0,
        userSpeechActive: false,
        waitingFinal: false,
        note: s.note !== null && CONNECTION_NOTES.includes(s.note) ? null : s.note,
      });

    case "socketLost": {
      const attempt = s.attempts + 1;
      // THE LADDER IS SPENT. The terminal's note is the reason the DIALS failed, not the shape of the
      // last event: a ladder that ran out while every rung was answered `busy` ends on the busy truth,
      // because "lost the connection" would send the owner looking at their Wi-Fi for a slot the relay
      // is holding. The standing note is what carries that fact here — the busy arm below puts it up
      // and a `ready` retracts it, so its presence at exhaustion means a dial was refused and no leg
      // came ready since — a mixed ladder (a refusal, then silent deaths) lands here too, and the
      // held-slot story is still the truer of the two.
      if (attempt > RECONNECT_BACKOFF_MS.length) {
        const why = s.note === CALL_COPY.busyRetrying ? CALL_COPY.busyHeld : CALL_COPY.lost;
        return terminal(s, "error", why);
      }
      // §4.5, stated honestly: a drop mid-utterance LOSES that utterance — the audio is gone — so
      // `waitingFinal` clears rather than waiting for a transcript no session will send. Playback is
      // untouched: C3 rides HTTP, not this socket.
      return {
        state: {
          ...s,
          phase: "connecting",
          attempts: attempt,
          userSpeechActive: false,
          waitingFinal: false,
        },
        out: [{ type: "reconnect", delayMs: RECONNECT_BACKOFF_MS[attempt - 1] }],
      };
    }

    case "speechStart":
      // The flag only. The ACTION (trigger A) waits on the client's sustained-energy floor, which the
      // wiring measures off the worklet's own RMS and delivers as `barge` — Speaches fires
      // `speech_started` on first detection and has no minimum-speech knob (council F2).
      // MUTED: ignored. The frames are silence, but the server's VAD can still be mid-utterance when the
      // mute lands, and a stale start would light "speaking" on a screen whose whole point is that the
      // ear is closed.
      // HELD: ignored for a DIFFERENT reason, and it is the whole point of the hold (S3). On a track
      // whose AEC does not subtract the page's own playback, what the ear hears under the reply is the
      // CHARACTER — so a VAD event from that stretch is the phone listening to itself, and taking it
      // would light "speaking" for nobody and arm §4.2's iron rule against a phantom.
      if (s.muted || s.earHeld) return { state: s, out: [] };
      return { state: { ...s, userSpeechActive: true }, out: [] };

    case "speechStop":
      if (s.muted || s.earHeld) return { state: s, out: [] };
      return { state: { ...s, userSpeechActive: false, waitingFinal: true }, out: [] };

    case "setMuted":
      // MUTE CONDEMNS THE HALF-UTTERANCE (§6, owner-ratified). Both flags clear with the same edge: the
      // words in flight are not going to be sent, so nothing waits on them — and §4.2's iron rule (no
      // playback while `userSpeechActive || waitingFinal`) must not go on killing replies over a final
      // that is never coming. Unmuting is simply the ear opening again; the next utterance is fresh.
      if (sig.on) {
        return {
          state: { ...s, muted: true, userSpeechActive: false, waitingFinal: false },
          out: [],
        };
      }
      return { state: { ...s, muted: false }, out: [] };

    case "final": {
      // "Mute means don't send that" (owner-ratified), applied FLAT: a final that arrives while muted is
      // dropped whether it is the condemned half-utterance or one the server endpointed a moment before
      // the tap. One rule, no window where the words go out anyway.
      // …and the same flat drop while the ear is HELD (S3), where the words are the reply's own leaking
      // back in: transcribing the character into the owner's next message is the exact failure the hold
      // exists to prevent, and it must not depend on whether the VAD pair that framed it was seen.
      if (s.muted || s.earHeld) return { state: s, out: [] };
      const text = sig.text.trim();
      // Empty finals are discarded (§4.5's no-speech path): nothing submits, the flag clears.
      if (!text) return { state: { ...s, waitingFinal: false }, out: [] };
      // THE TRANSCRIPT GATE (D74 S5 ③). A Whisper-family endpoint does not answer noise with nothing
      // — it answers with a PLAUSIBLE SENTENCE (R76), and on a call that sentence is submitted to the
      // agent as if the owner had said it. The relay cannot tell; the client can, because it already
      // measures what the microphone heard. So a final the EAR cannot account for is dropped, with
      // one line saying so — never silently, because a discarded utterance the owner believes went
      // out is the worse failure of the two.
      //
      // FAIL-OPEN BY CONSTRUCTION: it fires only when there IS epoch-matched evidence. A final that
      // arrives after a reconnect, or a second final for one speech segment, carries no accrual — and
      // absence of evidence is not evidence of silence. AFTER the empty check on purpose: a no-speech
      // final is already handled, and it deserves no note.
      if (
        sig.energyMs !== undefined &&
        sig.minFinalMs !== undefined &&
        sig.minFinalMs > 0 &&
        sig.energyMs < sig.minFinalMs
      ) {
        // …and HEARD, not only shown (D76 §C.5): the note line is useless to an owner who is driving.
        return {
          state: { ...s, waitingFinal: false, note: CALL_COPY.tooQuiet },
          out: [{ type: "dropCue" }],
        };
      }
      return drain({ ...s, waitingFinal: false, heard: text, pending: [...s.pending, text] });
    }

    case "barge":
      // THE GATE IS THE MOUTH, NOT THE PHASE (S3). §4.3's ratified intent — "outside `speaking`, overlay
      // taps are inert; nothing cancels by accident" — is a statement about whether there is anything to
      // interrupt, and `thinking`/`listening` still answer no (their `mouthLive` is false). What changes
      // is the honest case the phase enum cannot express: a reply still audible across a reconnect, where
      // the screen says `connecting` and the tap must STILL interrupt. Both triggers, one sequence.
      if (!s.mouthLive || s.killing) return { state: s, out: [] };
      return killNow(s);

    case "playbackStarted": {
      // The transport spoke, so the flag lands FIRST and unconditionally — what the phase logic below
      // decides to do about it is a separate question (see `mouthLive`).
      const open = mouth(s, true);
      // §4.2's iron rule (confirm-round MED 2). The mouth is about to open while the owner is mid-word,
      // or while their words are still in flight: that IS a barge-in, and it is killed BEFORE the first
      // audible sample rather than after it.
      if (s.userSpeechActive || s.waitingFinal) {
        if (s.killing) return { state: open, out: [] };
        return killNow(open);
      }
      // THE RECONNECT OWNS THE PHASE while the leg is down (confirm round F1's survivor). `socketLost`
      // deliberately paints `connecting` over a live mouth and `playbackDrained` preserves it — an arm
      // that repainted `speaking` here would be the one voice disagreeing about who owns the screen
      // during a reconnect (and a kill settling after it would inherit the lie). The flag lands above;
      // `ready` is the arm that consults it.
      if (s.phase === "connecting") return { state: open, out: [] };
      return { state: { ...open, phase: "speaking" }, out: [] };
    }

    case "playbackDrained": {
      // The mouth stopped: the flag goes down even where the arm declines to move the phase, because a
      // reply that ended during a reconnect is exactly what the fresh leg's `ready` must not mistake for
      // one still speaking.
      const quiet = mouth(s, false);
      // A kill in flight owns the transition (its settlement releases the queue in the §4.3 ORDER);
      // without this guard our own `dismiss()` would look like a natural drain and submit early. And the
      // phase test stays the RENDERED phase deliberately: this arm paints `listening`, and only a screen
      // that was saying `speaking` may be repainted — a drain landing during `connecting` leaves the
      // reconnect owning the phase (its `ready` reads the flag this arm just cleared).
      if (s.killing || s.phase !== "speaking") return { state: quiet, out: [] };
      return drain({ ...quiet, phase: "listening" });
    }

    case "playbackFailed": {
      // Synthesis that never produced a sample, or a mouth that died mid-reply: either way nothing is
      // audible any more, so the flag goes down here too, guard or no guard.
      const quiet = mouth(s, false);
      // §4.5 — a mouth failure is NONFATAL: the ear keeps working, the reply is in the chat, and
      // hanging up stays the user's move. Repeated failure never ends the call on its own.
      if (s.killing || isTerminal(s.phase)) return { state: quiet, out: [] };
      return drain({ ...quiet, phase: "listening", note: CALL_COPY.voiceFailed });
    }

    case "captureReady":
      // The ear-hold RULE, taken ONCE from the track that actually opened (§5.1). It cannot be re-decided
      // later: `mic_hold` is read at call start like every other knob (§4.5 — settings edited
      // mid-call apply to the NEXT call), and the capability belongs to this track, not to the browser.
      // The note is the capture's own news (the D73 device fallback) and rides the same arm: it is a
      // fact about THIS track, learned at exactly this moment, and it is not connection news — so a
      // reconnect's `CONNECTION_NOTES` retraction deliberately leaves it standing.
      // …and the ROUTE PAIR rides the same arm (D74 S2), for the same reason: it is what the capture
      // that actually opened was asked for, learned at exactly this moment. That makes this the ONE
      // seeding point — the machine never reads the knobs itself — and it re-states the pair after a
      // route cycle, so the control the owner just moved and the ear they are talking into cannot
      // drift apart.
      return {
        state: {
          ...s,
          earHoldMode: sig.earHoldMode,
          note: sig.note ?? s.note,
          route: sig.route,
          ecOn: sig.ecOn ?? wantsAec(sig.route),
          inputDevice: sig.deviceId,
        },
        out: [],
      };

    case "routeChange": {
      // ILLEGAL OUTSIDE THE SETTLED PHASES, as a NO-OP rather than a queued intent: the control is
      // disabled there anyway, and an intent parked across a reconnect would fire an acquisition at
      // whatever moment the leg happened to come up (the "a wait that parks a decision open widens
      // every ownership window it spans" lesson, S3).
      if (!isStable(s.phase)) return { state: s, out: [] };
      const route = sig.route ?? s.route;
      const deviceId = sig.deviceId ?? s.inputDevice;
      // Nothing moved — and re-dialling for nothing costs the owner a reconnect they did not ask for.
      if (route === s.route && deviceId === s.inputDevice) return { state: s, out: [] };
      // ISS-18 (R81): leaving comm mode re-tags nothing already open. A reply PLAYING at the flip
      // finishes on the old route. The Sound picker's footer says so, statically, where the choice is
      // made (owner ruling 2026-09-24) — not a note on the overlay's line, which read as an alarm.
      const leavesComm = s.ecOn && !wantsAec(route);
      return {
        state: {
          ...s,
          route,
          inputDevice: deviceId,
          // The SCREEN is honest about what is happening: this is a fresh leg on a fresh ear, and the
          // ladder starts clean because it is a deliberate redial, not a failure to recover from.
          phase: "connecting",
          attempts: 0,
          // The utterance in flight dies with the track, exactly as it does on a `socketLost`: the
          // audio is gone and no session will endpoint it.
          userSpeechActive: false,
          waitingFinal: false,
          // …and a kill in flight is released rather than left standing: its `killSettled` was armed
          // under the generation this arm is about to move, so nothing would ever clear the flag and
          // the pending queue would be held for the rest of the call.
          killing: false,
          // The HOLD belongs to the track (§5.1, resolved ONCE per capture), so it dies with it; the
          // fresh `captureReady` decides it again under the new route. `earHeld` follows in normalize.
          earHoldMode: false,
          // THE FENCE (F7). The old leg's frames, its close, this capture's `onEnded` and any send
          // outcome armed under it all become ghosts — which is the point: the redial below is driven
          // by the acquisition, not by the close, so a `socketLost` from the leg we are closing must
          // not spend a rung of a ladder that is not running. The one thing it costs is an in-flight
          // chat POST's outcome, which is a note the owner loses, not speech (the queue is kept).
          gen: s.gen + 1,
        },
        out: [{ type: "recapture", route, deviceId, leavesComm }],
      };
    }

    case "turnSettled":
      // The brain finished without a mouth (a tool-only turn, TTS off, a reply that never synthesized).
      // Playback, if it is coming, moves us to `speaking` on its own.
      if (s.phase !== "thinking") return { state: s, out: [] };
      return drain({ ...s, phase: "listening" });

    case "killSettled": {
      // Step ③, and only now: the interrupted turn is gone, so what the owner said over it may go.
      // The restore reads the RENDERED phase, not the mouth (S3's audit): what this arm repaints is the
      // screen, and only a screen that was showing the interrupted turn may be repainted — a kill that
      // settles while the leg is down must leave `connecting` standing, because the floor is genuinely
      // not the owner's yet.
      // …but WHICH repaint consults the mouth (S3 review F1): a `playbackStarted` that landed during
      // the kill re-set `mouthLive` — something genuinely started talking after the dismiss — and a
      // settlement that painted `listening` over it would also DRAIN the queue into a reply still
      // speaking (`held()` reads the phase this arm writes). Landing on `speaking` keeps the queue
      // held and leaves the handoff where it already lives: the real `playbackDrained` drains it.
      const next: CallState = {
        ...s,
        killing: false,
        phase:
          s.phase === "speaking" || s.phase === "thinking"
            ? s.mouthLive
              ? "speaking"
              : "listening"
            : s.phase,
      };
      return drain(next);
    }

    case "confirmHold":
      // Speech during `awaiting_confirm` HOLDS (delta round F1): a suspended turn leaves chat status
      // idle, so a send would take the optimistic fresh-turn path and strand on the held turn's 202.
      // Resolution — allow OR deny — releases it; the confirmation itself still needs its own tap.
      return drain({ ...s, confirmHold: sig.on });

    case "uploadSettled":
      return drain({ ...s, heldUpload: false });

    case "sent":
      switch (sig.outcome) {
        case "accepted":
          return { state: s, out: [] };
        case "held":
          // The upload gate refused to route (§4.5). The utterance goes back to the FRONT of the queue —
          // it was spoken before everything still in it — and the wiring retries once when the upload
          // settles.
          return {
            state: {
              ...s,
              heldUpload: true,
              pending: [sig.text, ...s.pending],
              phase: s.phase === "thinking" ? "listening" : s.phase,
            },
            out: [],
          };
        case "refused":
          return {
            state: {
              ...s,
              note: CALL_COPY.refused,
              phase: s.phase === "thinking" ? "listening" : s.phase,
            },
            out: [{ type: "harvest", lines: [sig.text] }],
          };
        case "unknown":
          // Deliberately NOT re-sent and deliberately NOT harvested: an invisible duplicate is worse
          // than a manual retry, and the words may well be in the thread already.
          return {
            state: {
              ...s,
              note: CALL_COPY.unknown,
              phase: s.phase === "thinking" ? "listening" : s.phase,
            },
            out: [],
          };
      }
      break;

    case "degraded":
      return { state: { ...s, note: CALL_COPY.strained }, out: [{ type: "degradeHold" }] };

    case "degradedOver":
      // Clears ONLY the note it was armed for. Anything else standing there — a refused send, a mouth
      // failure, a nonfatal upstream error — arrived AFTER the degrade and is newer news; a timer that
      // clobbered it would silently retract a message the owner has not read yet.
      if (s.note !== CALL_COPY.strained) return { state: s, out: [] };
      return { state: { ...s, note: null }, out: [] };

    case "serverError":
      switch (sig.code) {
        case "busy":
          // A FIRST dial refused is genuinely another device holding the call: terminal, named, ratified
          // (§4.5, e2e-pinned). The SAME refusal during a reconnect is the opposite fact (A-F3 / R72):
          // this install has one user, so the only session that can be holding the slot is this phone's
          // own dead leg, which the relay has not reaped yet.
          // …and since S6 ⑦ there is a THIRD case between them, with its own narrow evidence: a first
          // dial from a tab whose own marker is still standing is a discarded tab coming back to the
          // slot IT left behind (R75 §9.2 — the relay releases it within ~10 s). That takes the
          // note-only path below, where the 1013 close drives the ladder that outlasts the slot. The
          // marker is the whole test: without it the refusal stays the terminal it has always been.
          if (s.attempts === 0 && !s.priorLeg) return terminal(s, "error", CALL_COPY.busy);
          // …and there it is a NOTE-ONLY NO-OP, deliberately driving nothing. A busy refusal is TWO
          // events on the wire — this typed frame, and the 1013 close that always follows it (RFC 6455
          // §7.4.1 "try again later"; `api/voice.py` sends both). The close is what the ONE existing
          // `socketLost` arm reconnects from, so a dial that gets `busy` consumes exactly ONE attempt:
          // reconnecting from here as well would burn two rungs per refusal and need a second counter
          // to notice.
          return { state: { ...s, note: CALL_COPY.busyRetrying }, out: [] };
        case "session_limit":
          return terminal(s, "ended", CALL_COPY.limit);
        case "upstream_error":
          // The ONE code the relay keeps the session alive through — so the client must too.
          return { state: { ...s, note: sig.message || CALL_COPY.lost }, out: [] };
        case "protocol":
          // The client and the relay disagreed about the wire (A-F2: an uplink burst past the rolling
          // budget is the one way this happens in practice, which the pacer is there to prevent). The
          // relay's `message` is a diagnostic sentence for the journal, not a line for the owner's
          // screen, so this arm is the one place the default's echo is refused.
          return terminal(s, "error", CALL_COPY.protocol);
        default:
          return terminal(s, "error", sig.message || CALL_COPY.lost);
      }

    case "serverEnded":
      return terminal(s, "ended", s.note ?? "");

    case "captureLost":
      // §4.5: permission revoked, a real phone call stole the mic, a headset event.
      return terminal(s, "error", CALL_COPY.micLost);

    case "priorLeg":
      return { state: { ...s, priorLeg: true }, out: [] };

    case "earOutage":
      // THE EAR SLEPT (S6 ② / A2). The remedy is the one the ladder already owns — a fresh session, an
      // honest note — so this arm does the smallest thing that gets there: paint the reconnect, say
      // what happened, and CLOSE the leg. The close's `socketLost` is what actually redials, which is
      // why no `attempts` are touched here: one outage spends one rung from wherever the ladder
      // stands, exactly as a `busy` refusal does, and a reset would hand a wedged link an endless
      // supply of them. The no-op guard is not an optimization — freeze recovery overlaps the track's
      // own mute events and the socket's death by nature, so `visible` and `resume` and a close can
      // all arrive about the same instant, and a leg must not be closed twice for one outage.
      if (s.phase === "connecting") return { state: s, out: [] };
      // The note deliberately does NOT join `CONNECTION_NOTES`: the fresh leg makes the ear work
      // again, it does not make the missed stretch heard, and a note retracted 400 ms later is one the
      // owner never read. It stands until something newer replaces it.
      return {
        state: { ...s, phase: "connecting", note: CALL_COPY.earAsleep },
        out: [{ type: "closeLeg" }],
      };

    case "idleExpired":
      // A BACKGROUNDED CALL NOBODY IS IN (S6 ④). A clean `ended`, like the session limit and unlike a
      // failure — the mic being hot for ten minutes in a pocket is not an error, it is the thing this
      // ends. The wiring only ever arms the clock while hidden, so reaching here means exactly that.
      return terminal(s, "ended", CALL_COPY.idleBackground);

    case "failed":
      return terminal(s, "error", sig.note);
  }
  return { state: s, out: [] };
}

// ── THE EAR METER (D74 S4 ⑥ → D76 §C) ────────────────────────────────────────────────────────────
//
// ONE accumulator over the worklet's own per-frame level, and every consumer in this call reads what it
// wrote: trigger A's windowed floor, the transcript gate's per-utterance evidence (S5), the voice
// learner's samples (D76 §C.3) and the readouts (S7). They started as three readings of the same number
// in three places, which is how two of them end up disagreeing about what the microphone heard.
//
// IN dBFS SINCE D76 §C.1: the frame's linear RMS is converted ONCE, where the frame arrives
// (`rmsToDbfs`), and nothing below compares a linear number against anything.
//
// It lives in the WIRING, not the reducer: it is a measurement, arriving on the audio callback at
// 25–50 Hz, and re-rendering React for it is exactly the trade the dictation meter's ref already
// refused. What the reducer gets is the DECISION — `barge`, or a final's accrual on its own signal.

interface EarMeter {
  /** The last frame's level, and the loudest one still inside `PEAK_HOLD_MS` (S7), dBFS — `null` until
   *  the first frame. Every frame, held or not: what the microphone hears is true either way. */
  db: number | null;
  peakDb: number | null;
  peakAt: number;
  /** TRIGGER A's rolling window: one slot per frame of `min_speech_ms`, oldest overwritten, with the
   *  count kept incrementally so a frame costs no scan. */
  window: boolean[];
  at: number;
  hits: number;
  /** THE UTTERANCE EPOCH (S5) — which (leg, utterance) the accrual below is evidence about, or `null`
   *  when no utterance is open and there is therefore NO evidence to offer. The distinction is the
   *  gate's whole fail-open rule: a final with no matching epoch is not quiet, it is unmeasured. */
  epoch: { leg: number; seq: number } | null;
  seq: number;
  /** …and the accrual: ms of UPLINKED frames at or above the effective floor since this utterance's
   *  speech-start (D76 §C.5), and the loudest of them, dBFS. */
  accruedMs: number;
  accruedPeak: number;
  /** …and the VOICE LEARNER's evidence for the same utterance (D76 §C.3): every uplinked frame's level,
   *  and whether any of them arrived while the reply was audible. */
  utterance: UtteranceLevels;
  /** What the LAST final was judged on, kept for the debug block. An `accruedMs` of 0 beside a
   *  non-zero `chars` is the fail-open signature — a final that arrived with no epoch behind it. */
  last: { accruedMs: number; peakDb: number; chars: number } | null;
}

function newEarMeter(): EarMeter {
  return {
    db: null,
    peakDb: null,
    peakAt: 0,
    window: [],
    at: 0,
    hits: 0,
    epoch: null,
    seq: 0,
    accruedMs: 0,
    accruedPeak: DBFS_SILENCE,
    utterance: { samples: [], duringPlayback: false },
    last: null,
  };
}

/**
 * One frame, consumed ONCE. Everything below reads what this wrote.
 *
 * THE PARTITION (D76 §B.2): the level and its peak are every frame's; the utterance's accrual and the
 * learner's samples take only UPLINKED frames — a held frame is the reply leaking back in, and a
 * muted one is silence the owner chose; neither is evidence that the owner spoke.
 */
function meterFrame(
  m: EarMeter,
  db: number,
  uplinked: boolean,
  frameMs: number,
  floor: number,
  mouthLive: boolean,
): void {
  const now = performance.now();
  m.db = db;
  // A decaying peak hold rather than a ring of samples: the reading it feeds is an eyeball one, and a
  // 2 s ring at 50 Hz would be 100 numbers kept so a human can read the largest of them.
  if (m.peakDb === null || db >= m.peakDb || now - m.peakAt > PEAK_HOLD_MS) {
    m.peakDb = db;
    m.peakAt = now;
  }
  if (m.epoch === null || !uplinked) return;
  m.utterance.samples.push(db);
  if (mouthLive) m.utterance.duringPlayback = true;
  if (db >= floor) {
    m.accruedMs += frameMs;
    if (db > m.accruedPeak) m.accruedPeak = db;
  }
}

/** Push one above-floor answer into trigger A's window; true when the window now carries enough. */
function bargeWindow(m: EarMeter, above: boolean, frames: number): boolean {
  if (m.window.length !== frames) {
    m.window = new Array<boolean>(frames).fill(false);
    m.at = 0;
    m.hits = 0;
  }
  if (m.window[m.at] !== above) m.hits += above ? 1 : -1;
  m.window[m.at] = above;
  m.at = (m.at + 1) % frames;
  // FLOOR, not ceil (code round F1): the ratio exists to TOLERATE dips, and ceil quietly walks it
  // back to consecutive-frames at small windows (n=2 ⇒ 2-of-2 — the exact brittleness S4 removed).
  // The max(1) keeps a one-frame window meaning "one hit", never "zero fires it".
  return m.hits >= Math.max(1, Math.floor(frames * BARGE_HIT_RATIO));
}

function clearBarge(m: EarMeter): void {
  m.window.fill(false);
  m.at = 0;
  m.hits = 0;
}

function openUtterance(m: EarMeter, leg: number): void {
  m.seq += 1;
  m.epoch = { leg, seq: m.seq };
  m.accruedMs = 0;
  m.accruedPeak = DBFS_SILENCE;
  m.utterance = { samples: [], duringPlayback: false };
}

function closeUtterance(m: EarMeter): void {
  m.epoch = null;
  m.accruedMs = 0;
  m.accruedPeak = DBFS_SILENCE;
  m.utterance = { samples: [], duringPlayback: false };
}

/**
 * THE METER'S EDGES, decided in ONE place — the `IDLE_EDGES` precedent, for the same reason: every
 * rule about what voids the ear's evidence is a rule about the SIGNAL that arrived, and a copy of it
 * inside each arm is a copy the next edge gets forgotten in.
 *
 * WHAT CLEARS WHAT, and why they are not the same set (S5 / review F2):
 *  · the trigger's WINDOW clears on the mouth's rising edge, because the reply's own start transient
 *    is not the owner talking and must not pre-fill a window that is about to kill the reply;
 *  · the UTTERANCE's accrual clears wherever the thing it is evidence about ends or becomes
 *    unknowable — a new speech-start (which opens the next one), the final it was collected for, a
 *    mute, a leg that died, a leg that came up, and the route cycle;
 *  · and MUTE clears both, because "the ear is closed" has to mean it.
 *
 * RETURNS the closing utterance's level evidence when the signal was a final the reducer TOOK (it
 * joined the queue or went out) — the voice learner's one input (D76 §C.3), keyed, like the epoch
 * edges, on the ACCEPTED transition and never on a re-derivation of the arm's rules. `null` otherwise:
 * a final that was dropped (too quiet, muted, held, empty) teaches nothing.
 */
function meterEdge(
  m: EarMeter,
  sig: CallSignal,
  leg: number,
  prev: CallState,
  next: CallState,
  out: readonly CallEffect[],
): UtteranceLevels | null {
  switch (sig.type) {
    case "speechStart":
      // ONLY when the reducer TOOK it (code round F2): a muted/held speech-start is ignored by the
      // machine, and an epoch opened for it would attribute the next frames to an utterance that,
      // as far as the call is concerned, never happened. The accepted transition is the state diff,
      // never a re-derivation of the arm's own eligibility rules.
      if (next.userSpeechActive && !prev.userSpeechActive) openUtterance(m, leg);
      break;
    case "final": {
      m.last = { accruedMs: m.accruedMs, peakDb: m.accruedPeak, chars: sig.text.trim().length };
      const taken =
        next.pending.length > prev.pending.length || out.some((e) => e.type === "submit");
      const evidence = taken ? m.utterance : null;
      closeUtterance(m);
      return evidence;
    }
    case "playbackStarted":
      clearBarge(m);
      break;
    case "setMuted":
      clearBarge(m);
      closeUtterance(m);
      break;
    case "ready":
    case "socketLost":
      closeUtterance(m);
      break;
    case "routeChange":
      // Same F2 gate, other direction: a route change the reducer REFUSED (outside the stable
      // phases, or nothing moved) must not throw away evidence for an utterance that is still
      // live. An accepted cycle paints `connecting`, and that edge is the truth to key on.
      if (next.phase !== prev.phase) closeUtterance(m);
      break;
  }
  return null;
}

// ── THE RELATIVE GATE'S STATE (D76 §C) ───────────────────────────────────────────────────────────
//
// The estimators the effective floor is computed from, and the owner's per-call pin. Measurements, so
// they ride a ref beside the meter (the D74 S7 rule) — nothing renders off them; the readouts sample.

interface GateState {
  /** The gate's knobs, taken from the acquisition that opened the current capture (§4.5 — read at
   *  call start). `null` before any acquisition: there is no floor to compute without them. */
  cfg: (GateCfg & { playback_margin_db: number }) | null;
  noise: NoiseTracker;
  /** The owner's learned voice level on THIS capture's device, dBFS — seeded from `store/voiceLevels`
   *  when the capture opens, learned from accepted finals, written back when it is released. */
  voiceLevel: number | null;
  /** …and the device key it is stored under (`voiceDeviceKey`), `null` when the capture names none. */
  voiceKey: string | null;
  /** The owner's MANUAL floor for this call, dBFS (S1's control sets it; `setFloorPin`), or `null` =
   *  Auto. Per call, never written anywhere — Discord's shape (D76 §C.7). */
  pin: number | null;
}

function newGateState(): GateState {
  return { cfg: null, noise: newNoiseTracker(), voiceLevel: null, voiceKey: null, pin: null };
}

/** THE effective floor right now under `cfg` (D76 §C.4 — `effectiveFloor` holds the truth table). The
 *  ONE place the hook asks; every consumer reads its answer. */
function gateFloor(g: GateState, cfg: GateCfg): number {
  return effectiveFloor({
    noise: g.noise.floor,
    settled: g.noise.settled,
    voiceLevel: g.voiceLevel,
    pin: g.pin,
    cfg,
  });
}

/** Write the learned level back under its device (D76 §C.3) — on every release of a capture: the
 *  hang-up's teardown, and a route cycle's, before the next capture seeds from its own key. */
function persistVoice(g: GateState): void {
  if (g.voiceKey !== null && g.voiceLevel !== null) setVoiceLevel(g.voiceKey, g.voiceLevel);
}

// ── the wiring ───────────────────────────────────────────────────────────────────────────────────

/**
 * THE READBACK BLOCK (D74 S7, evidence docs/research/R78 §6.2) — every field the S4 calibration
 * sitting needs, on the screen the owner is holding, and read-only in the strictest sense: nothing
 * here touches the track. It is assembled here rather than in the overlay for exactly that reason
 * (review F4) — a screen that can reach a live MediaStreamTrack is a screen that can change one.
 *
 * `null` unless the `debug` knob is on; the overlay renders nothing extra when it is off.
 */
export interface CallDebug {
  /** The PAIR (R78 §1.4): the mode GRANTED, beside what the device was offering at open. */
  ecSettings: string | boolean | undefined;
  ecCapabilities: readonly (string | boolean)[] | undefined;
  /** The effective route pair and the hold lever — the floor is unreadable without them (§3.4). */
  route: string;
  micHold: string;
  /** …and the three flags the arming decision produced. Rendered TOGETHER on purpose: `bargeArmed`
   *  and `earHoldMode` are the same readback read twice and can never honestly disagree. */
  bargeArmed: boolean;
  earHoldMode: boolean;
  earHeld: boolean;
  mouthLive: boolean;
  /** Which ear actually opened, and whether it is the one that was asked for. */
  deviceLabel: string;
  deviceId: string;
  fellBack: boolean;
  /** The whole C1 arithmetic, in dBFS since D76 §C: the live level, the 2 s peak hold, and the line
   *  they are measured against. Without the hold the owner cannot see a floor their voice never
   *  reaches. `null` = no frame yet (or, for the floor, no knobs yet). */
  level: number | null;
  levelPeak2s: number | null;
  floor: number | null;
  /** …whether that floor is the owner's manual pin rather than Auto (D76 §C.7). */
  floorPinned: boolean;
  /** …and what it is computed from (D76 §C.2–§C.4): the noise estimate — PROVISIONAL until its first
   *  full window — and the learned voice level on this device. */
  noise: number | null;
  noiseSettled: boolean;
  voiceLevel: number | null;
  /** …and what the last final was judged on (S5), its peak in dBFS. `accruedMs: 0` beside a non-zero
   *  `chars` is the fail-open signature — a final that arrived with no epoch behind it. */
  lastFinal: { accruedMs: number; peakDb: number; chars: number } | null;
}

/** What the overlay renders + the things it can do. */
export interface CallView {
  phase: CallPhase;
  heard: string;
  note: string | null;
  userSpeechActive: boolean;
  /** A speech segment closed and its transcript is still in flight — the overlay keeps its `…` up
   *  (owner, 2026-09-23: the LAST final showing for the STT round-trip read as a stale pop). */
  waitingFinal: boolean;
  /** The ear is closed (§6) — a STATIC look on the ring/accent, never a pulse. */
  muted: boolean;
  /** Trigger B — a tap outside the control cluster during `speaking` (§4.3). Inert elsewhere. */
  interrupt: () => void;
  /** Mute/unmute the ear. The track goes silent; the frames keep flowing (see `PcmCapture.setMuted`). */
  toggleMute: () => void;
  /** D74 S2 — THIS CALL's route pair, and the two ways to move it. Per call: neither writes config. */
  route: string;
  inputDevice: string;
  /** …and whether moving it is legal right now. The control renders disabled otherwise rather than
   *  silently swallowing the tap — a dead-looking control is honest; an inert live-looking one is not. */
  canRoute: boolean;
  setRoute: (route: string) => void;
  setInputDevice: (deviceId: string) => void;
  /** D74 S7 — the readback block, or `null` with the knob off (which is every ordinary call). */
  debug: CallDebug | null;
  /** D76 §C.7 (S1's Sensitivity meter) — SAMPLE the ear: the current level and the effective floor,
   *  dBFS (`null` before the first frame / before the knobs). A READER, not a field: the numbers move at
   *  25–50 Hz and ride refs (the D74 S7 rule), so a value on this view would be as stale as the last
   *  render. The meter polls it at its own tick. */
  readLevel: () => { level: number | null; floor: number | null };
  /** …whether the floor is Auto (no manual pin standing). */
  floorAuto: boolean;
  /** …and the pin itself: a dBFS floor for THIS call, or `null` to hand the floor back to Auto. Writes
   *  nothing — per call, applied from the next frame, no leg redial. */
  setFloorPin: (dbfs: number | null) => void;
}

export function useLiveCall(): CallView {
  const [state, setState] = useState<CallState>(CALL_INITIAL);
  // The SYNCHRONOUS read every callback uses (the `phaseRef` idiom from the gesture hook): a socket
  // frame landing before React has re-rendered must still see the transition the previous one caused,
  // and the generation fence is only honest if it reads the LIVE generation.
  const ref = useRef(state);

  const voice = useVoiceStatus().data;
  const knobs = voice?.live_call;
  const capture = useRef<PcmCapture | null>(null);
  const socket = useRef<LiveSocket | null>(null);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  /** The strained note's hold — re-armed by every `degraded` frame, cleared by the teardown. */
  const degradeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const wakeLock = useRef<WakeLockSentinel | null>(null);
  /** One request in flight at a time (A1): the re-acquire runs on every return to the foreground, and
   *  two overlapping requests would leave the loser sentinel held by nothing that can release it. */
  const lockPending = useRef(false);
  /** The BACKGROUND idle clock (S6 ④) — one timer, owned here, armed from `armIdle` alone. */
  const idleTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  /** THE S6 KNOBS, latched at CALL START (§4.5 — settings edited mid-call apply to the NEXT call).
   *  `null` until they arrive, which is also the honest answer for a page that hides before the call
   *  has one: there is nothing to keep in the background yet, so the old clean end applies. */
  const bg = useRef<{ background: boolean; keepalive: boolean; idleMs: number } | null>(null);
  /** THE ONE EAR METER (D74 S4 ⑥) — trigger A's window, the transcript gate's accrual and the debug
   *  readback, all off the worklet's per-frame level, measured once. */
  const meter = useRef<EarMeter>(newEarMeter());
  /** THE RELATIVE GATE (D76 §C) — the noise tracker, the learned voice level and the manual pin that
   *  the effective floor is computed from (`gateFloor`). */
  const gate = useRef<GateState>(newGateState());
  /** …and the ONE bit of it the screen renders: is a manual pin standing (S1's Auto caption). */
  const [pinned, setPinned] = useState(false);
  /** Trigger A is armed only on a track whose AEC is the subtractive `all` mode (the S0 ruling). */
  const bargeArmed = useRef(false);
  /** The held-upload retry is ONE PER HOLD (§4.5); this latch is what makes it one. A fresh `held`
   *  outcome re-arms it — see the submit effect. */
  const retriedUpload = useRef(false);
  /** Which socket LEG is current — see `openLeg`. */
  const legSeq = useRef(0);
  /** THIS LEG'S UPLINK PACER (A-F2, `lib/uplinkPacer`), or null between legs. Per leg and never shared:
   *  a bucket that survived a reconnect would carry the dead session's banked budget — and its stale
   *  audio — into a fresh one, which is the same fence `legSeq` draws for the socket's callbacks. */
  const pacer = useRef<PacerState | null>(null);
  /** …and the relay's own "one report per overflow BURST" latch (`voice_live.py::_overflow_flagged`),
   *  mirrored client-side: a drop RAISES the strained note once and an enqueue that drops nothing lowers
   *  the latch, so a struggling link re-arms the note instead of re-rendering the overlay per frame. */
  const overflowed = useRef(false);

  /** Release EVERYTHING, on every exit path (§6's "hang up = immediate full teardown"). Idempotent. */
  const teardown = useCallback((): void => {
    clearTimeout(retryTimer.current);
    clearTimeout(degradeTimer.current);
    clearTimeout(idleTimer.current);
    // THE CLEAN END CLEARS THE MARKER (S6 ⑦). This is the one release path every exit funnels through
    // — a terminal, a hang-up, the unmount — so it is the one place that can honestly say "this tab is
    // not in a call any more". What does NOT reach here (a killed tab, a crash) is exactly the case
    // the marker is for.
    markLeg(false);
    socket.current?.close();
    socket.current = null;
    // The pacer dies with the leg it metered: whatever it still held is audio for a session that is over.
    pacer.current = null;
    overflowed.current = false;
    // What this call learned about the owner's voice outlives it, on this device (D76 §C.3).
    persistVoice(gate.current);
    capture.current?.stop();
    capture.current = null;
    dismiss(); // an ended call does not keep talking
    setCallVoice(false, false);
    setCallPrePlay(null); // the pre-play tap dies with the capture it closes over
    const lock = wakeLock.current;
    wakeLock.current = null;
    void lock?.release().catch(() => {});
  }, []);

  /** `openLeg` needs `send` (its frames drive the machine) and `send` needs `openLeg` (a reconnect
   *  effect opens one), so one of the two rides a ref. Assigned during render — the latch-ref idiom
   *  `LineComposer` uses — and only ever read from a timer, long after this render is done. */
  const openLegRef = useRef<() => void>(() => {});
  /** …and the same knot, tied the same way, for the idle clock: `send` re-arms it on the activity
   *  edges and the clock's own expiry sends. Assigned during render, read only from inside callbacks. */
  const armIdleRef = useRef<() => void>(() => {});
  /** …and once more for THE ACQUISITION (D74 S2): `send` runs the `recapture` effect, and `acquire`
   *  needs `openLeg`, which needs `send`. Same latch-ref idiom, same read-only-from-a-callback rule. */
  const acquireRef = useRef<(req: MicRequest, alive: () => boolean) => void>(() => {});

  const send = useCallback(
    function send(sig: CallSignal): void {
      const prev = ref.current;
      const { state: next, out } = callReduce(prev, sig);
      if (next !== ref.current) {
        ref.current = next;
        setState(next);
      }
      for (const eff of out) {
        switch (eff.type) {
          case "submit": {
            const gen = ref.current.gen;
            const text = eff.text;
            void sendCallTranscript(text).then((outcome) => {
              // A NEW hold arms a NEW retry: the latch below is one-per-HOLD, not one-per-call. Without
              // this reset a SECOND held upload in the same call would never receive `uploadSettled`,
              // and every utterance after it would queue until hang-up.
              if (outcome === "held") retriedUpload.current = false;
              send({ type: "sent", outcome, text, gen });
            });
            break;
          }
          case "kill": {
            const gen = ref.current.gen;
            // ① the audible part stops NOW — synchronous, before anything is awaited.
            dismiss();
            // ② the scoped cancel, AND its settlement. `discard` because the steer this cancel harvests
            //    is the owner's own call-origin speech, which they are in the middle of replacing.
            const turn = getLiveTurn();
            if (turn === null) {
              // The turn commonly ends before the mouth does (council F1): nothing to cancel, and the
              // interrupting utterance simply becomes the next turn. Same edge, same order.
              send({ type: "killSettled", gen });
            } else {
              void cancelTurn(turn, "discard").then(() => send({ type: "killSettled", gen }));
            }
            break;
          }
          case "harvest":
            appendDraft(eff.lines.join(HARVEST_JOIN), HARVEST_JOIN);
            break;
          case "reconnect": {
            const gen = ref.current.gen;
            clearTimeout(retryTimer.current);
            retryTimer.current = setTimeout(() => {
              if (ref.current.gen === gen) openLegRef.current();
            }, eff.delayMs);
            break;
          }
          case "degradeHold": {
            // Fenced like every other armed callback (F7): a hold armed in this call cannot clear a note
            // belonging to the next one. Re-arming beats accumulating — one hold, always the newest.
            const gen = ref.current.gen;
            clearTimeout(degradeTimer.current);
            degradeTimer.current = setTimeout(
              () => send({ type: "degradedOver", gen }),
              DEGRADED_NOTE_MS,
            );
            break;
          }
          case "closeLeg":
            // Just the leg. Its `onClose` is the reconnect's trigger, and the leg fence in `openLeg`
            // is what keeps a close this call asked for from driving a socket it has since replaced.
            socket.current?.close();
            break;
          case "recapture": {
            // THE ROUTE CYCLE (D74 S2) — the hang-up path's RELEASE without its terminal, then S1's
            // acquisition again. The order is the teardown's, for the teardown's reasons: the socket
            // first (a clean close releases the relay's slot synchronously, so the redial below is
            // never refused `busy` by our own leg — and the S6 ⑦ marker covers the window if it is),
            // then the leg's pacer, then the ear.
            const gen = ref.current.gen;
            // ISS-18 (R81): the mouth's next reply must open a FRESH output stream once comm mode is
            // left — told BEFORE the ear is released, so a silent mouth is unloaded and its 5 s starts
            // alongside the redial rather than after it.
            if (eff.leavesComm) markStreamRetag();
            clearTimeout(retryTimer.current);
            socket.current?.close();
            socket.current = null;
            pacer.current = null;
            overflowed.current = false;
            // The pre-play tap closes over the capture it is about to release (S3 confirm F2), so it
            // goes with it; the fresh capture registers its own if its track needs one.
            setCallPrePlay(null);
            // The OLD ear's learned level goes back under the OLD device's key (D76 §C.3) before the
            // fresh capture seeds from whatever its own key holds.
            persistVoice(gate.current);
            capture.current?.stop();
            capture.current = null;
            // NOT `markLeg(false)`: this tab is still in a call. And the fence is the generation this
            // arm just moved — a hang-up or a terminal inside the acquisition gap moves it again, and
            // the capture that resolves afterwards stops itself exactly as the mount path's does.
            acquireRef.current(
              { route: eff.route, deviceId: eff.deviceId },
              () => ref.current.gen === gen,
            );
            break;
          }
          case "dropCue": {
            // On the capture's own context (`lib/callCue`); an ear already released plays nothing.
            const ctx = capture.current?.context;
            if (ctx) playDropCue(ctx);
            break;
          }
          case "teardown":
            teardown();
            if (eff.close) endCall();
            break;
        }
      }
      // THE IDLE CLOCK'S EDGES (S6 ④), read from the SIGNAL rather than from a state diff: what re-arms
      // the clock is activity — the owner spoke, their words landed, the reply started or stopped — and
      // none of those is a single field to diff. Last, so `armIdle` reads the state this reduce wrote
      // and a terminal's teardown has already cleared the timer it would otherwise re-arm.
      if (IDLE_EDGES.has(sig.type)) armIdleRef.current();
      // …and the EAR METER's, the same way and for the same reason (D74 S4/S5). After the reduce,
      // because the `final` arm has already been handed the accrual this may now clear.
      const taken = meterEdge(meter.current, sig, legSeq.current, prev, next, out);
      // THE VOICE LEARNER (D76 §C.3) — fed only a final the machine took, and guarded inside
      // `learnVoice` (a settled noise term, a clear margin above it, no playback during it).
      const g = gate.current;
      if (taken && g.cfg) g.voiceLevel = learnVoice(g.voiceLevel, taken, g.noise, g.cfg);
    },
    [teardown],
  );

  /** Open ONE socket leg against the live capture. Reconnect is a FRESH session (no resume protocol,
   *  §3.3) — a new `start` with the same measured rate. */
  const openLeg = useCallback((): void => {
    const cap = capture.current;
    if (!cap || !knobs) return;
    const gen = ref.current.gen;
    // THE LEG FENCE, beside the call-generation one. A reconnect closes the old socket, but `close()`
    // only STARTS the handshake — a frame already in flight can still be dispatched afterwards, and a
    // dead leg's `speech_started` (or its own close) driving the live session would be a ghost. Each
    // leg takes a number; only the newest one may speak. The CALL generation cannot do this job: it is
    // bumped by terminals only, deliberately, so that an HTTP send's outcome still lands across a
    // reconnect (the socket dropping says nothing about whether the chat POST was taken).
    const leg = ++legSeq.current;
    const mine = (): boolean => legSeq.current === leg;
    // THIS TAB IS IN A CALL (S6 ⑦), written at the leg rather than at the machine: what the marker
    // claims is that the RELAY may be holding a slot for us, and it is opening a leg that makes that
    // true. Cleared by the teardown, which every clean end runs.
    markLeg(true);
    // A FRESH LEG GETS A FRESH PACER (see the ref): the old leg's queue is stale speech by definition —
    // a reconnect is a new session and §4.5 already declares the in-flight utterance lost — and its
    // banked budget was earned against a socket that is gone.
    pacer.current = newPacer();
    overflowed.current = false;
    socket.current?.close();
    socket.current = openLiveSocket({
      url: liveSocketUrl(),
      sampleRate: cap.sampleRate,
      ceilingMs: knobs.buffered_ceiling_ms,
      onFrame: (frame) => {
        if (!mine()) return;
        switch (frame.type) {
          case "state":
            if (frame.state === "ready") send({ type: "ready", gen });
            else if (frame.state === "degraded") send({ type: "degraded", gen });
            else send({ type: "serverEnded", gen });
            break;
          case "speech_started":
            send({ type: "speechStart", gen });
            break;
          case "speech_stopped":
            send({ type: "speechStop", gen });
            break;
          case "transcript":
            // THE TRANSCRIPT GATE's evidence (D74 S5), offered only when the accrual belongs to THIS
            // leg's open utterance. Anything else carries none, and the reducer passes it: a final
            // nobody measured is unmeasured, not quiet.
            if (frame.final)
              send({
                type: "final",
                text: frame.text,
                energyMs: meter.current.epoch?.leg === leg ? meter.current.accruedMs : undefined,
                minFinalMs: knobs.min_final_ms,
                gen,
              });
            break;
          case "error":
            send({ type: "serverError", code: frame.code, message: frame.message, gen });
            break;
        }
      },
      onClose: () => {
        // What reaches the machine is an UNANNOUNCED close — a dropped tailnet link, or this client's
        // own backpressure bail — which is what reconnect is for. A relay that already said its piece
        // (a typed `error`/`ended`) left the machine terminal, and the terminal guard drops this.
        if (mine()) send({ type: "socketLost", gen });
      },
    });
  }, [knobs, send]);

  openLegRef.current = openLeg;

  /** THE BACKGROUND IDLE CLOCK (S6 ④ / Maya F6) — ONE timer, re-evaluated from ONE place.
   *
   *  Every caller says the same thing ("look again") and this decides, because every rule about the
   *  clock is a rule about the CURRENT state rather than about the edge that arrived: is the page
   *  hidden, is the bound on, is an approval outstanding, is the call still alive. A version where the
   *  hidden handler armed and the speech handler re-armed and the confirm handler cleared would be
   *  four copies of one rule, which is four chances for the next edge to be forgotten.
   *
   *  It CLEARS first, always — re-arming beats accumulating (the `degradeHold` precedent) — so a call
   *  that came back to the foreground simply never re-arms, and the visible edge needs no branch of
   *  its own. The confirm gate is a full re-arm rather than a resume: the remaining window is not worth
   *  carrying, and being generous here can only ever delay an end the owner never asked for. */
  const armIdle = useCallback((): void => {
    clearTimeout(idleTimer.current);
    const cfg = bg.current;
    // `!(idleMs > 0)` deliberately: 0 is the owner's "off", and a knob a pre-S6 backend never sent
    // arrives as NaN — both must land on "no clock", never on a `setTimeout(NaN)` that fires at once.
    if (!cfg?.background || !(cfg.idleMs > 0)) return;
    if (document.visibilityState !== "hidden") return; // only a BACKGROUNDED call is bounded
    const s = ref.current;
    // AN APPROVAL GATE PAUSES IT (Maya F6): ending the call while the owner is being asked something
    // destroys the interaction the `agent_input` notification just asked them for. Allow or deny —
    // either resolution re-arms through the same `confirmHold` edge that paused it.
    if (isTerminal(s.phase) || s.confirmHold) return;
    const gen = s.gen;
    idleTimer.current = setTimeout(() => send({ type: "idleExpired", gen }), cfg.idleMs);
  }, [send]);

  armIdleRef.current = armIdle;

  /** The screen lock, taken at mount AND re-taken on every return to the foreground (S6 ⑤ / A1): the
   *  platform RELEASES the sentinel when the page hides, so a call the owner came back to would
   *  otherwise be running without one — which is the whole reason 5/5 field projects re-acquire, and
   *  MDN's own instruction. Feature-detected, never UA-sniffed; a browser without it keeps today's
   *  screen behaviour. Idempotent: a lock still held is not re-requested. */
  const takeWakeLock = useCallback((): void => {
    if (lockPending.current) return;
    if (wakeLock.current !== null && !wakeLock.current.released) return;
    // The request is taken BEFORE the latch is set, deliberately: an optional chain that found no API
    // short-circuits the `then`/`catch` with it, and a latch armed on a promise that will never settle
    // would refuse every later attempt for the life of the call.
    // (Explicit `=== undefined`, never a truthiness test: a Promise in a boolean conditional is the
    // `no-misused-promises` trap, and the same line is written this way in `useForegroundNotifications`.)
    const request: Promise<WakeLockSentinel> | undefined = navigator.wakeLock?.request("screen");
    if (request === undefined) return;
    wakeLock.current = null;
    lockPending.current = true;
    // The GENERATION rides the request (S6 code-review F2): a lock resolving after this call's exit
    // must not become the NEXT call's sentinel — a stale sentinel makes the re-take guard above skip
    // the acquisition the fresh call actually needs. Terminal-phase alone cannot tell the two apart:
    // the next call's phase is not terminal.
    const gen = ref.current.gen;
    void request
      .then((lock) => {
        lockPending.current = false;
        if (gen !== ref.current.gen || isTerminal(ref.current.phase))
          void lock.release().catch(() => {});
        else wakeLock.current = lock;
      })
      .catch(() => {
        lockPending.current = false;
      });
  }, []);

  /**
   * THE ACQUISITION, as ONE re-callable function (D74 S1).
   *
   * It was the mount effect's own body until the route cycle (S2) needed to run it a SECOND time,
   * under different constraints and without a remount — and a second copy of "open the ear, decide
   * the hold, arm the trigger, open the leg" is exactly the parallel implementation the house rules
   * forbid. Nothing about it moved in the extraction: the same generation fence, the same
   * disposed/terminal guards, the same order, the same effects.
   *
   * @param req   what to open the ear WITH. At mount it is the knobs' pair (§4.5 — read at call
   *              start); a route cycle passes the owner's IN-CALL choice, which is per-call and never
   *              writes config, so the Conf knob stays the next call's default.
   * @param alive the CALLER's own fence. The mount effect's is its `disposed` local, which has to stay
   *              per-RUN: StrictMode's first setup must go on refusing its own late capture even after
   *              the second setup has started a real one.
   */
  const acquire = useCallback(
    (req: MicRequest, alive: () => boolean): void => {
      if (!knobs) return;
      // Trigger A's window, in FRAMES — the same `min_speech_ms` the consecutive run spent, read once
      // here rather than divided on every frame (D74 S4 ⑥).
      const bargeFrames = Math.max(1, Math.ceil(knobs.min_speech_ms / knobs.frame_ms));
      // THE GATE STARTS OVER WITH THE EAR (D76 §C.2): a fresh capture is a different microphone, or the
      // same one somewhere else, so the noise estimate is re-learned from its 1 s bootstrap. The knobs
      // are this acquisition's (§4.5). The voice level is NOT touched here — it is the DEVICE's, seeded
      // from the store once the capture says which device it opened (below).
      const g = gate.current;
      g.cfg = knobs;
      resetNoise(g.noise);
      // THE EAR IS TAKEN BEFORE IT IS OPENED (D74 S6 ⑧, evidence docs/research/R78 §2.3): a live
      // dictation capture PINS the echo-cancellation mode of the next one on the same device, so a
      // call opening beside one silently inherits whatever dictation asked for — with a readback that
      // honestly reports a mode this call never chose. Stop, THEN open. It resolves at once when
      // nothing was recording, which is every ordinary call.
      void releaseMic()
        .then(() =>
          startPcmCapture({
            frameMs: knobs.frame_ms,
            // D73 S5 — the capture pair, read at call start like every other knob (§4.5).
            route: req.route,
            deviceId: req.deviceId,
            onFrame: (frame) => {
              // THE UPLINK GOES THROUGH THE PACER (A-F2, evidence docs/research/R71). Shipping each frame the
              // instant the worklet hands it over is safe at the ordinary cadence and fatal after a stall: the
              // worklet's MessagePort deliveries queue while the main thread is blocked and then dispatch in
              // ONE tick, which the relay's rolling 2×-realtime budget reads as a protocol violation and
              // answers with `error{code:"protocol"}` + close 1008 — a call that simply ends, mid-sentence,
              // with no reconnect. Dictation has metered this wire since S2.5; the call now spends from the
              // same bucket (`lib/uplinkPacer`), under the CALL's backlog rule: drop-OLDEST past
              // `call_backlog_ms`, because a call has a clock on both sides and a second of stale speech
              // endpoints a turn the owner has moved past (R71 §5.3).
              //
              // THE SUBSTITUTION (D76 §B.1) happens HERE, at the pacer boundary, and nowhere else: a frame
              // that is not `uplinked` (muted, or held under the reply) goes up as the ONE zeroed buffer of
              // its length. The server receives exactly the digital silence a disabled track used to give
              // it — which is what its VAD must observe to endpoint (`pcmCapture`'s one rule) — and the
              // frames keep arriving whatever the classification, so there is no stranded tail here and no
              // flush-on-mute question: the queue is pumped by a callback that never stops while the
              // capture is alive.
              const p = pacer.current;
              if (p) {
                const up = frame.uplinked ? frame.buf : silenceLike(frame.buf);
                if (enqueueBounded(p, up, knobs.frame_ms, knobs.call_backlog_ms)) {
                  // The client's own drop presents the RELAY'S signal, locally raised: one loss chain, one
                  // note, one hold that times out the same way (`degraded` → `degradeHold`). Once per burst —
                  // see the `overflowed` latch.
                  if (!overflowed.current) {
                    overflowed.current = true;
                    send({ type: "degraded", gen: ref.current.gen });
                  }
                } else overflowed.current = false;
                accrue(p);
                // The pump reads the LIVE socket rather than closing over one: a frame paced out across the
                // handshake of a fresh leg belongs to that leg, and `sendAudio` drops it anyway while the
                // socket is not OPEN (the reconnect gap, exactly as before the pacer).
                pump(p, knobs.frame_ms, (buf) => socket.current?.sendAudio(buf));
              }
              // dBFS AT THE CHOKEPOINT (D76 §C.1): the ONE conversion, on every frame, before anything
              // below compares a level against anything.
              const db = rmsToDbfs(frame.rms);
              // THE PARTITION (D76 §B.2). The noise tracker takes UPLINKED frames only; a HELD frame is
              // the leak probe's alone (D76 §B.3 — S2 builds it), and nothing here reads one.
              if (frame.uplinked) trackNoise(g.noise, db, knobs.frame_ms);
              // THE effective floor for this frame — the one normalize (`gateFloor`); every reader below
              // takes this number.
              const floor = gateFloor(g, knobs);
              // THE EAR METER, FED ONCE (D74 S4 ⑥): trigger A below, the transcript gate's accrual (S5),
              // the voice learner's samples and the readouts all read what this line wrote. It sits
              // OUTSIDE every guard below on purpose — what the microphone heard does not stop being
              // true because the interrupt happens to be disarmed.
              const m = meter.current;
              meterFrame(m, db, frame.uplinked, knobs.frame_ms, floor, ref.current.mouthLive);
              // TRIGGER A (§4.3): the worklet already owns the samples, so the sustained-energy floor is
              // measured on the frames we CAPTURE — never a second AnalyserNode over the same audio, and
              // deliberately never inside the pump: what the owner said is a fact about the microphone, not
              // about what the uplink found room for. A dropped frame is one the ear will not transcribe; it
              // is still speech over an audible reply, and it must still count toward the interrupt.
              // Gated on the MOUTH, not the phase (S3, the same audit as the `barge` arm): what trigger A
              // measures is speech over an audible reply, and the reducer's own gate reads `mouthLive` — a
              // clock that stopped at the rendered phase would spend the reconnect window unable to accrue
              // toward a kill the tap could still fire.
              if (!bargeArmed.current || !ref.current.mouthLive) {
                clearBarge(m);
                return;
              }
              // …and the RUN is now an m-of-n WINDOW (D74 S4 ⑥, see `BARGE_HIT_RATIO`): a frame under the
              // floor costs ONE slot instead of the whole clock, because the holes inside a spoken word
              // are exactly what a consecutive run could never survive.
              // THE BARGE FLOOR (D76 §C.6) is the effective floor RAISED by `playback_margin_db` — the
              // reply is audible whenever this line runs, and what the AEC left of it must not interrupt
              // itself. Only an UPLINKED frame can count (the §B.2 partition): a held one is the reply's
              // own leak by definition, exactly the silence it used to arrive as.
              const above = frame.uplinked && db >= floor + knobs.playback_margin_db;
              if (bargeWindow(m, above, bargeFrames)) {
                clearBarge(m);
                send({ type: "barge", gen: ref.current.gen });
              }
            },
            onEnded: () => send({ type: "captureLost", gen: ref.current.gen }),
          }),
        )
        .then((cap) => {
          // TERMINAL beside DISPOSED (S6 code-review F1): a close-class exit (`hidden`, `pagehide`, a
          // hang-up) lands the machine terminal SYNCHRONOUSLY, but the unmount whose cleanup sets
          // `disposed` waits for React's commit — and a capture resolving inside that window would
          // install itself, open a leg and re-write the busy marker on a call that is already over.
          // The gen fence upstairs cannot catch it: `openLeg` reads the LIVE generation, which the
          // terminal has already moved to.
          if (!alive() || isTerminal(ref.current.phase)) {
            cap.stop();
            return;
          }
          capture.current = cap;
          // THE OWNER'S VOICE ON THIS DEVICE (D76 §C.3 / Maya F8): seeded from the store under the
          // device the capture ACTUALLY opened — a different device starts unseeded — so the own-voice
          // term applies from the first frame (C.4). Written back on release (`persistVoice`).
          g.voiceKey = voiceDeviceKey(cap.readback);
          g.voiceLevel = g.voiceKey === null ? null : getVoiceLevel(g.voiceKey);
          // MUTE ACROSS THE ACQUISITION GAP (S2b confirm F1): a Mute tapped while `getUserMedia` was
          // still pending changed the RULE but had no track to change — so the track takes the
          // machine's answer the moment it exists, or audio flows to the relay while the screen says
          // Muted (and a final landing after the unmute would pass the reducer and submit it).
          cap.setMuted(ref.current.muted);
          // …and the SAME lesson for the keepalive (S6 ③): the only thing that starts it is a hidden
          // edge, and a call backgrounded inside the acquisition gap has already had its. Without this
          // it would run with no keepalive at all and freeze ninety seconds later.
          if (
            bg.current?.background &&
            bg.current.keepalive &&
            document.visibilityState === "hidden"
          )
            cap.setKeepalive(true);
          // THE CAPTURE POLICY (D73 S5 → D76 §B). Both halves are decided HERE, together, from the
          // same readback — because they answer the same question and a version of this that let them
          // disagree would arm voice barge-in against an ear the other half had just closed.
          //
          // The S0 ruling, per TRACK and never UA-sniffed: only a genuinely subtractive canceller lets
          // the ear stay open under the reply, so only there can VOICE interrupt. Everywhere else the
          // tap is the interrupt (§4.3) — and, under `mic_hold: auto`, the ear is CLOSED while the reply
          // speaks, which is the same readback read for its other consequence (S3). The `media` route
          // needs no line of its own: it clears AEC, so its readback comes back something other than
          // `"all"`, which holds the ear and leaves `bargeArmed` false.
          //
          // THE READBACK GOVERNS, NOT THE ASK (D75 ③ / R80 §5.2): a `media` capture whose track came
          // back EC-ON reads `"all"` and is treated as the subtractive track it IS, so the hold lifts
          // and — with `barge_in` on — the interrupt arms. `cap.ecStuck` says so on the screen; it
          // never contradicts these two flags.
          //
          // `on`/`off` are the owner's override of the HOLD half only; the two decisions stay separate
          // flags (`barge_in` may be off on a perfectly open ear — walkie-talkie by choice).
          // `auto` IS PROVISIONAL until D76 S2's per-chunk leak probe replaces this readback rule.
          const ecAll = cap.readback.echoCancellation === "all";
          bargeArmed.current = knobs.barge_in && ecAll;
          const hold = knobs.mic_hold;
          send({
            type: "captureReady",
            ecOn: ecEngaged(cap.readback.echoCancellation),
            earHoldMode: hold === "on" ? true : hold === "off" ? false : !ecAll,
            // The picked device did not open and the default took the call (R74 §2.2(b)). The call
            // proceeds — it is the same ear on another route — and the overlay says which.
            //
            // ONE LINE, and the FALLBACK wins it (D75 ③): the device note is about a choice the owner
            // MADE that did not carry, which is theirs to re-make; a stuck canceller is a platform race
            // they cannot act on. When both are true the fallback is also the likelier explanation of
            // the second — it says the capture did not open on the route that was asked for at all.
            note: cap.fellBack
              ? CALL_COPY.deviceFallback
              : cap.ecStuck
                ? CALL_COPY.ecStuck
                : undefined,
            // …and what this acquisition ASKED for (D74 S2): what the in-call control renders, and
            // what the next route change merges its half-payload against.
            route: req.route ?? "",
            deviceId: req.deviceId ?? "",
            gen: ref.current.gen,
          });
          // …and the TRACK takes the machine's answer the moment it exists — the S2b confirm-F1 lesson
          // beside the mute line above, in the other direction: the rule can already be TRUE here (a reply
          // was audible while `getUserMedia` was pending), and a hold that only ever reaches the track on
          // its next CHANGE would leave the ear open for exactly that stretch.
          cap.setHeld(ref.current.earHeld);
          // THE PRE-PLAY TAP (confirm round F2): on a leaking track the mouth closes the ear BEFORE it
          // asks the element to play — observation, however synchronous, races the audio thread. The tap
          // is a bare "close now": stable until the play event's own reduce confirms it (nothing can
          // transition `earHeld` in that gap), and a rejected play's status edge is what reopens it.
          if (ref.current.earHoldMode) setCallPrePlay(() => cap.setHeld(true));
          openLeg();
        })
        .catch((e: unknown) => {
          if (alive()) send({ type: "failed", note: micFailure(e) });
        });
    },
    [knobs, openLeg, send],
  );

  acquireRef.current = acquire;

  // ── the one start effect: capture, then the first leg ──────────────────────────────────────────
  useEffect(() => {
    // SETUP MUST BE CLEANUP'S SYMMETRIC PARTNER (the React effect contract StrictMode enforces by
    // running setup → cleanup → setup on one instance, state surviving). The cleanup below lands the
    // machine terminal through `unmounted`; this re-arm is what lets the second setup — and only a
    // setup facing that terminal — start the call anyway. A genuine first mount reduces to a no-op.
    send({ type: "remount" });
    if (voice === undefined) return; // the knobs have not arrived yet — nothing to configure from
    if (!knobs) {
      send({ type: "failed", note: CALL_COPY.unconfigured });
      return;
    }
    let disposed = false;
    // D73 S6 — the background knobs, LATCHED here with every other §4.5 read: what a call does when it
    // goes away is decided when it starts, not by a `/voice/status` refetch in the middle of it.
    bg.current = {
      background: knobs.background,
      keepalive: knobs.background_keepalive,
      idleMs: knobs.background_idle_s * 1000,
    };
    // …and the tab's own marker, read BEFORE the first leg writes one (S6 ⑦). This order is the whole
    // mechanism: what it can report is the PREVIOUS document's unfinished call, never this one's.
    if (markStanding()) send({ type: "priorLeg", gen: ref.current.gen });
    // The call speaks every turn that STARTS after this moment, and deliberately not the one already
    // streaming (§4.5 — a reply half-read to an owner who was not yet in a call is not picked up). The
    // exclusion is a GATE on the status timeline, not an id: the streaming message is renamed to the
    // server's id mid-flight, and a captured id stops matching the message it was meant to exclude.
    setCallVoice(true, getLiveTurn() !== null);
    acquire({ route: knobs.route, deviceId: knobs.input_device }, () => !disposed);
    return () => {
      disposed = true;
      // THROUGH THE REDUCER, not a bare `teardown()`: the `unmounted` arm moves the generation FIRST,
      // so a callback that lands after this cleanup — `close()` only starts the socket's handshake,
      // and a `killSettled`/`sent` settlement answers whenever it answers — is a ghost by the same
      // fence every other stale callback hits. The arm's own effect runs the teardown.
      send({ type: "unmounted" });
    };
    // Armed ONCE per mount: the overlay's lifetime IS the call's, and a mid-call `/voice/status`
    // refetch must not re-open the ear (§4.5 — settings edited mid-call apply to the NEXT call).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voice === undefined]);

  // ── the mouth, watched (§4.2: `speaking` is C3 playback, observed — never inferred) ────────────
  // A SYNCHRONOUS store subscription, not a render-time effect (S3 review F2). The controller's `emit`
  // runs listeners inside the very `set()` the media `play` event handler made, so everything below —
  // the signal AND the hardware hold on its heels — lands in the SAME task as the audible start. The
  // effect this replaced paid a render + a paint before the hold could reach the capture, and on a
  // leaking track (Fennec) that window put the reply's own first words into the relay: a short reply
  // could drain before their transcript came back, and the leaked final walked in through an open ear.
  // Two knock-ons the timing closes at the root: no leak ⇒ no leak-window `speech_started` whose
  // `speech_stopped` the engaged hold would then drop (a stranded `userSpeechActive` is a phantom
  // iron-rule kill of the NEXT reply), and no re-open race between a pre-play hold and a stale effect.
  //
  // RE-ENTRANCY, now real and deliberately safe: a kill effect's own `dismiss()` moves the status and
  // this listener fires INSIDE that `send`'s effect loop. It is sound for the same reason every other
  // synchronous callback is — `send` writes `ref.current` before it runs effects, so the re-entrant
  // reduce sees the killing state it must (and its `playbackDrained` is dropped by the `killing` guard).
  const prevPlay = useRef<PlayStatus>("idle");
  useEffect(() => {
    const onPlayback = (): void => {
      const status = getPlayStatus();
      const was = prevPlay.current;
      if (was === status) return; // the store emits for time/intent too — only the status edge matters
      prevPlay.current = status;
      const gen = ref.current.gen;
      if (status === "playing") send({ type: "playbackStarted", gen });
      // Synthesis that never produced a sample is the mouth FAILING; audio that played and stopped is
      // the reply finishing (or our own kill, which the machine's `killing` flag tells apart). Kept as
      // BELT beside the explicit tick below — the reducer dedupes (a nonfatal note, back to listening).
      else if (was === "loading" && status === "idle") send({ type: "playbackFailed", gen });
      // "loading" is the mouth still BUSY — a mid-reply synthesis gap the read-along queue publishes
      // honestly. The reply is not over, so this is no drain; and because a reply that ENDS inside such
      // a gap goes loading→paused, the drain has to be "the mouth stopped", not "stopped while playing".
      else if (status !== "loading" && (was === "playing" || was === "loading"))
        send({ type: "playbackDrained", gen });
      // THE ENGAGE-PATH HOLD (F2's fix): `send` is synchronous, so by this line the reducer AND the
      // normalize have already answered — the hold reaches the capture before this task yields, ahead of
      // the first frame that could carry the reply back into the mic. The state effect below stays as
      // the applier for every rule change that does not ride a playback edge (the kill, the terminal).
      capture.current?.setHeld(ref.current.earHeld);
    };
    const unsub = subscribePlayback(onPlayback);
    // One initial pass, exactly like the effect this replaced: a status already standing at mount is a
    // transition the machine has not seen (the door makes it `idle` by construction — this is the belt).
    onPlayback();
    return unsub;
  }, [send]);

  // ── the ear-hold, applied to the capture (S3 → D76 §B.1) ──────────────────────────────────────
  // The rule lives in the reducer; this is the general path to the capture (the playback subscription
  // above applies it synchronously on the edges where a render's delay would leak). Cheap and idempotent
  // (a flag the capture classifies the next frame by — see `PcmCapture.setHeld`), so an effect that
  // re-runs on a state the hold did not move costs nothing.
  useEffect(() => {
    capture.current?.setHeld(state.earHeld);
  }, [state.earHeld]);

  // A mouth failure the TRANSPORT cannot express (§4.5): a rejected `play()` publishes "paused" and a
  // media error resets to "idle", and both of those read as ordinary transitions from here. The
  // controller counts them instead, and an INCREMENT is the signal — two failures in a row are two.
  const mouthFailures = useMouthFailures();
  const prevFailures = useRef(mouthFailures);
  useEffect(() => {
    const was = prevFailures.current;
    prevFailures.current = mouthFailures;
    if (mouthFailures !== was) send({ type: "playbackFailed", gen: ref.current.gen });
  }, [mouthFailures, send]);

  // ── the brain, watched: the turn settling, and the confirm gate ────────────────────────────────
  const chatStatus = useChatSlice((s) => s.status);
  const prevChat = useRef(chatStatus);
  useEffect(() => {
    const was = prevChat.current;
    prevChat.current = chatStatus;
    if (was === "streaming" && chatStatus !== "streaming") {
      send({ type: "turnSettled", gen: ref.current.gen });
      // …and THIS edge is what the read-along gate waits for: a turn that was already streaming when the
      // call started settling is exactly "everything from here is the call's own". Idempotent, so the
      // call's own turns settling cost nothing.
      openCallVoiceGate();
    }
  }, [chatStatus, send]);

  const confirming = useChatSlice(() => confirmOutstanding());
  useEffect(() => {
    send({ type: "confirmHold", on: confirming, gen: ref.current.gen });
  }, [confirming, send]);

  // ── the held upload's ONE retry (§4.5 — "the retry is NOT existing code") ──────────────────────
  const uploading = useStagedFiles().some((f) => f.status === "uploading");
  useEffect(() => {
    if (!state.heldUpload || uploading || retriedUpload.current) return;
    retriedUpload.current = true;
    send({ type: "uploadSettled", gen: ref.current.gen });
  }, [state.heldUpload, uploading, send]);

  // ── screen + foreground + THE BACKGROUND WAVE (§5.3 · D73 S6, evidence docs/research/R75) ──────
  //
  // A HIDDEN PAGE IS NO LONGER AN ENDED CALL. Nothing in the web platform ends one (R75 §0.1) and 5/5
  // field projects keep theirs; ours ended because we said so, and `background` is that policy's
  // switch. What ends a call for certain is `pagehide` — the document really dying (A7; bfcache is
  // provably out of play mid-call, a live track and an open socket each block it) — and that listener
  // is installed on its own, because `pagehide` can arrive with no `visibilitychange` in front of it.
  //
  // The other three arms are all one fact: a backgrounded Chrome Android page FREEZES about ninety
  // seconds after its last sound, which pauses the audio graph and deafens the ear behind a screen
  // still saying Listening (R75 §3). So the page is kept audible while it is away (the keepalive),
  // it is asked on every return whether its ear slept (the outage check), and it is not allowed to sit
  // there forever with a hot mic (the idle clock).
  useEffect(() => {
    takeWakeLock();
    /** The ear-outage check (S6 ② / A2), run on the EDGE — before a fresh frame can re-stamp the gap.
     *  That ordering is safe rather than lucky: a frozen graph mints NOTHING, so there is no backlog
     *  waiting to flush, and the first post-resume frame costs a whole `frame_ms` of audio to exist. */
    const checkEar = (): void => {
      const cap = capture.current;
      if (cap && cap.earGapMs() > EAR_OUTAGE_MS) send({ type: "earOutage", gen: ref.current.gen });
    };
    const onVisibility = (): void => {
      if (document.visibilityState === "hidden") {
        // THE POLICY (S6 ①). With `background` off — or before the knobs have arrived, where there is
        // no call to keep yet — a hidden page ends it CLEANLY, exactly as it always did: no half-alive
        // background session, and no error face for something the owner did on purpose.
        if (!bg.current?.background) {
          send({ type: "hidden" });
          return;
        }
        if (bg.current.keepalive) capture.current?.setKeepalive(true);
        armIdleRef.current();
        return;
      }
      // Back in front of the owner: the page is audible on its own terms again, the background bound
      // no longer applies, the screen lock has to be taken back, and the ear owes an honest answer.
      capture.current?.setKeepalive(false);
      armIdleRef.current();
      takeWakeLock();
      checkEar();
    };
    const onPagehide = (): void => send({ type: "hidden" });
    document.addEventListener("visibilitychange", onVisibility);
    // The Page Lifecycle unfreeze, which is the event the outage check is really about: a page can be
    // resumed while still HIDDEN, and no visibility edge reports that. Both may fire for one wake —
    // the reducer's own no-op is what makes that one outage (S6 ②).
    document.addEventListener("resume", checkEar);
    window.addEventListener("pagehide", onPagehide);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      document.removeEventListener("resume", checkEar);
      window.removeEventListener("pagehide", onPagehide);
    };
  }, [send, takeWakeLock]);

  const interrupt = useCallback(() => send({ type: "barge", gen: ref.current.gen }), [send]);

  /** The mute control: the TRACK first (the samples go silent immediately, before any render), then
   *  the rule change. The ear meter's own reset rides the `setMuted` EDGE since D74 S4 — silent frames
   *  read ~0 RMS and would decay the window anyway, but a window left standing at the edge of its
   *  floor is a barge-in waiting to fire off audio nobody sent, and "the ear is closed" has to mean
   *  it. Moved into `meterEdge` so mute is not the one caller that hand-clears the meter. */
  const toggleMute = useCallback((): void => {
    const on = !ref.current.muted;
    capture.current?.setMuted(on);
    send({ type: "setMuted", on, gen: ref.current.gen });
  }, [send]);

  /** THE IN-CALL ROUTE CONTROLS (D74 S2). Two half-payloads onto ONE signal, because they are one
   *  decision — "what should this ear be" — and the reducer merges whichever half arrives against the
   *  standing pair. Neither writes config: the Conf knobs stay the NEXT call's default (§4.5). */
  const setRoute = useCallback(
    (route: string): void => send({ type: "routeChange", route, gen: ref.current.gen }),
    [send],
  );
  const setInputDevice = useCallback(
    (deviceId: string): void => send({ type: "routeChange", deviceId, gen: ref.current.gen }),
    [send],
  );

  // ── the readback block (D74 S7 / R78 §6.2) ─────────────────────────────────────────────────────
  // SNAPSHOTTED at mount like every other §4.5 knob (and exactly as the overlay's `ring` is): what a
  // call shows is decided when it starts, not by a `/voice/status` refetch in the middle of it.
  const [debugOn] = useState(() => knobs?.debug ?? false);
  const [debug, setDebug] = useState<CallDebug | null>(null);
  useEffect(() => {
    if (!debugOn) return;
    const read = (): void => {
      const cap = capture.current;
      const m = meter.current;
      const s = ref.current;
      const g = gate.current;
      setDebug({
        ecSettings: cap?.readback.echoCancellation,
        ecCapabilities: cap?.readback.echoCapabilities,
        route: s.route,
        micHold: knobs?.mic_hold ?? "",
        bargeArmed: bargeArmed.current,
        earHoldMode: s.earHoldMode,
        earHeld: s.earHeld,
        mouthLive: s.mouthLive,
        deviceLabel: cap?.readback.label ?? "",
        deviceId: cap?.readback.deviceId ?? "",
        fellBack: cap?.fellBack ?? false,
        level: m.db,
        levelPeak2s: m.peakDb,
        floor: g.cfg && gateFloor(g, g.cfg),
        floorPinned: g.pin !== null,
        noise: g.noise.floor,
        noiseSettled: g.noise.settled,
        voiceLevel: g.voiceLevel,
        lastFinal: m.last,
      });
    };
    read();
    const id = setInterval(read, DEBUG_TICK_MS);
    return () => clearInterval(id);
  }, [debugOn, knobs]);

  // ── the Sensitivity seam (D76 §C.7 — S1 renders it) ──────────────────────────────────────────────
  // A SAMPLER over the same refs the debug block reads, never a per-frame state write (the D74 S7
  // rule): the meter that consumes it polls at its own tick.
  const readLevel = useCallback((): { level: number | null; floor: number | null } => {
    const g = gate.current;
    return { level: meter.current.db, floor: g.cfg && gateFloor(g, g.cfg) };
  }, []);
  /** The manual floor for THIS call (D76 §C.7): the frame path reads the ref from its next frame, and
   *  only the Auto bit reaches React. Writes nothing — the pin dies with the call. */
  const setFloorPin = useCallback((dbfs: number | null): void => {
    gate.current.pin = dbfs;
    setPinned(dbfs !== null);
  }, []);

  return {
    phase: state.phase,
    heard: state.heard,
    note: state.note,
    userSpeechActive: state.userSpeechActive,
    waitingFinal: state.waitingFinal,
    muted: state.muted,
    interrupt,
    toggleMute,
    route: state.route,
    inputDevice: state.inputDevice,
    canRoute: isStable(state.phase),
    setRoute,
    setInputDevice,
    debug,
    readLevel,
    floorAuto: !pinned,
    setFloorPin,
  };
}

/** Why the ear never opened, in the owner's words rather than the engine's. */
function micFailure(e: unknown): string {
  const name = e instanceof Error ? e.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") return "microphone permission denied";
  if (name === "NotFoundError") return "no microphone found";
  return "could not open the microphone";
}
