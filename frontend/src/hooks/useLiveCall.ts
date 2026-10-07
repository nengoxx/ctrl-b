import { useCallback, useEffect, useRef, useState } from "react";

import {
  dismiss,
  dismissTurn,
  getPlayStatus,
  getSpokenPolicy,
  markStreamRetag,
  openCallVoiceGate,
  type PlayStatus,
  pokeCallMouth,
  setCallMouthGate,
  setCallPrePlay,
  setCallVoice,
  STREAM_RETAG_MS,
  subscribePlayback,
  useMouthFailures,
} from "../lib/audioController";
import { CUE_HOLD_MS, playDropCue } from "../lib/callCue";
import { type CallTrail, createCallTrail, postTrail } from "../lib/callTrail";
import {
  CHIRP_HOLD_MS,
  CHIRP_LEAD_MS,
  ChirpMatcher,
  type ChirpResult,
  playChirp,
} from "../lib/chirp";
import { sendCallTranscript } from "../lib/composer";
import { ECHO_MIN_CHARS, echoSimilarity, normalizeForEcho } from "../lib/echoText";
import { buzz } from "../lib/haptics";
import {
  DBFS_SILENCE,
  effectiveFloor,
  type FloorInputs,
  type GateCfg,
  learnVoice,
  newNoiseTracker,
  pinCeiling,
  type NoiseTracker,
  resetNoise,
  rmsToDbfs,
  seedBinds,
  trackNoise,
  type UtteranceLevels,
} from "../lib/levelGate";
import {
  liveSocketUrl,
  openLiveSocket,
  type LiveOutcome,
  type LiveReason,
  type LiveSocket,
} from "../lib/liveSocket";
import {
  ecEngaged,
  type EarDeath,
  startPcmCapture,
  wantsAec,
  type MicRequest,
  type PcmCapture,
} from "../lib/pcmCapture";
import { toSpeech } from "../lib/toSpeech";
import { accrue, enqueueBounded, newPacer, pump, type PacerState } from "../lib/uplinkPacer";
import { newWakeLockState, releaseWakeLock, takeWakeLock as takeScreenLock } from "../lib/wakeLock";
import { useStagedFiles } from "../store/attachments";
import {
  cancelTurn,
  confirmOutstanding,
  getLiveTurn,
  lastReply,
  useChatSlice,
} from "../store/chat";
import { appendDraft } from "../store/composer";
import { endCall } from "../store/liveCall";
import { releaseMic } from "../store/micRelease";
import {
  borrowVoiceLevel,
  type BorrowedVoiceLevel,
  getVoiceLevel,
  setVoiceLevel,
  voiceDeviceKey,
} from "../store/voiceLevels";
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
// `waitingFinal` from a speech-stop until its transcript is consumed or discarded — since Phase 26 D9 derived
// from `awaiting`, the ordered ids of every segment whose transcript is still owed). The rule those flags
// exist for is §4.2's: **playback may not start while either holds** — the gap between "you stopped
// talking" and "your words arrived" must not let an older reply begin. Enforced by WAITING, not killing
// (the owner's ruling 2026-09-26 on R86 LC-1 / R88 E-1): the mouth's automatic starts ask the pure
// `mouthMayOpen` through the controller's gate and are held until the ear settles — the reply is never
// cancelled because the owner (or a TV) was making sound when it became ready. A segment open long
// enough to be judged NOISE by the transcript gate's own measure (`noiseOpen`) settles it early.
//
// ONE QUEUE FOR EVERY HOLD (§4.3). The cancel-settle window, the `barge_in`-off walkie-talkie hold, a
// suspended confirm gate and a staged upload in flight are four reasons not to submit and ONE mechanism:
// utterances join an ordered pending queue and drain as a SINGLE message, in order, when the last hold
// clears. Never a one-slot overwrite (the coherence sweep's correction), never lost speech.
//
// THE TURN HOLD (ISS-55, `turn_hold_ms`; amends ASR_PLAN §3.5 ⑤) is a fifth reason on that queue. The ear
// ends a SEGMENT after `silence_ms`, and a thinking pause is longer than that: one monologue reached the
// agent as three or four turns whose replies queued behind each other. With the knob on, a TAKEN final is
// queued rather than sent and (re)starts the hold; only when the hold runs out over a SETTLED ear does
// the queue drain — one message, however many pauses it spanned. While it stands the mouth stays shut
// (`mouthMayOpen`): the owner holds the floor. 0 is the call without it, signal for signal.
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
// `mic_hold: auto` IS THE D73 RULE (D80 ⑤): held unless the track's canceller reads back `"all"` — the
// one readback that subtracts the reply. It was briefly a per-chunk LEAK PROBE (D76 §B.3) that released
// any chunk whose first 600 ms stayed under the floor; the owner's car falsified its premise (the car
// round, LIVE_VOICE_PLAN §7): the probe judged each chunk in its first 600 ms — before a car had
// emitted a sample — and a Bluetooth head unit plays the reply seconds late AND as loud as the owner.
// So `auto` holds exactly where `on` does unless the canceller subtracts; `on` holds every reply
// regardless; `off` never holds.
//
// THE TAIL (D80 ①). The element's `ended` is not the reply's end: the owner's car plays it ≈ 2.3 s
// LATER over a Bluetooth link whose delay the web cannot read (Android discards sink reports ≥ 1 s,
// R91 §1), as loud as the owner — and a hold released on the element opened the ear into the last
// sentence, which came back as the owner's next turn. So when the mouth falls — drained, failed, or
// KILLED by a tap (the car keeps playing what it already buffered) — the hold passes to `tail`, and
// the ear reopens on a MEASURED DEADLINE (D80 ⑦ as-built, wave 1.5 — `tailPlan`): the connect chirp's
// lag + `tail_lag_margin_ms` when it measured this sink; the minimum when it did not but nothing of the
// reply reached the mic (or a tap armed it — the owner answers a tap at once). Only a leaking sink the
// chirp never measured falls back to OBSERVED QUIET: the wiring's meter, below the room's NOISE floor +
// a margin (never the Sensitivity pin, which sits inside the echo's band) for a contiguous stretch,
// after a minimum and under a cap (`hold_tail_*`, `tail_quiet_*`) — quiet was only ever a proxy for the
// lag, and an owner who answers quickly never gives it. The reducer decides, the wiring measures
// (`tailOver`, fenced on the tail it was armed for). What escapes a LEVEL rule — a long pause inside
// the tail not yet heard, a tail past the cap — the TEXT BACKSTOP catches (D80 ②, `lib/echoText`): a
// final in the post-reply window that repeats the reply's spoken words is dropped, visibly.
//
// THE LEDGER (D80 ③). Every final is judged on ITS OWN segment's evidence, keyed by the ear's
// `item_id` (the relay forwards Speaches' one id per VAD segment). Speaches overlaps segments —
// `speech_started(B)` before `transcript(A)` is routine — and a single "current utterance" slot judged
// A on B's accrual and let B through unmeasured. The fail-open survives only for an id nobody measured.
//
// THE CONNECT CHIRP (D80 ⑦, `lib/chirp`). Each capture opens with a short sweep the mic listens for,
// which MEASURES how late this output path plays — the number the tail's deadline is built on.
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
// `barge_in`, the D76 §C gate six, the D80 tail four + backstop pair + `chirp`). Those are the owner's,
// delivered by `/voice/status.live_call`, and this hook reads them — it never defaults them. The level
// gate's own estimator constants live beside the estimators (`lib/levelGate`), the drop cue's beside
// the cue (`lib/callCue`), the chirp's beside the chirp (`lib/chirp`), the echo matcher's beside the
// matcher (`lib/echoText`), and the segment ledger's bound (`SEGMENT_CAP`) beside the meter below.

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
 *  back in a hurry.
 *
 *  …THE COMPAT PATH since Phase 26 D5. Wherever BOTH ends carry the tab's `client_id` (`liveClientId`),
 *  this phone's own zombie is SUPERSEDED, not refused — the relay hands the newer leg the slot at once, so
 *  the first rung just dials. The ≈14 s span is kept for the two cases where it is still the only correct
 *  behaviour: a relay older than D5 (v1.7.10 — the rollback skew), and a tab with no id (no storage, no
 *  secure context). Not a legacy seam: the live path there. */
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

/** The kill's haptic tick, ms (LIVE-001) — DECORATIVE, like every buzz (`lib/haptics`): it rides a state
 *  change the screen is already making, and Firefox for Android swallows it silently. 20 ms is the house
 *  "tap acknowledged" length (`useMicGesture`'s start/catch buzz, R69 §2). Not a config knob: it is the
 *  platform's texture, not a preference the owner tunes. */
const KILL_BUZZ_MS = 20;

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
 *  platform's behaviour, not a preference of the owner's.
 *
 *  ITS SIBLING is the ear that never heard AT ALL (ISS-54): the capture's own first-frame watchdog and
 *  its context's `error` (`pcmCapture`'s `FIRST_FRAME_MS`) → `earDead`. That one REBUILDS the capture
 *  instead of redialling over it — a render-error context does not come back the way a frozen one does
 *  (the `earDead` arm). */
const EAR_OUTAGE_MS = 4000;

/** The signals that re-arm the background idle clock (D73 S6 ④ / Maya F6): the owner speaking, their
 *  words landing, and the reply's mouth opening and closing — the four edges that mean a call is still
 *  a conversation. `confirmHold` rides the same set as the PAUSE edge: it is not activity, but it is
 *  the one other thing that changes whether the clock may run at all, and routing it through the same
 *  "look again" call keeps one decision in one place. `speechStop` is deliberately out — its `final`
 *  follows within the same breath and re-arms for it. `idleExpired` itself is in (R86 LC-6): an expiry
 *  the reducer declined because the reply is still audible must start the window over — and one it
 *  took is terminal, which `armIdle` already refuses to re-arm. */
const IDLE_EDGES: ReadonlySet<CallSignal["type"]> = new Set([
  "speechStart",
  "final",
  "playbackStarted",
  "playbackDrained",
  "confirmHold",
  "idleExpired",
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

/** How long the device list must sit STILL before a mid-call `devicechange` re-chirps, ms (D80 ⑦ as-built,
 *  the wave-1.5 fix wave's O-W15-MED). A Bluetooth device connecting raises SEVERAL `devicechange` events
 *  while its profiles negotiate (input and output lists move separately), and the system does not route
 *  the page's audio to the new sink until its stream is up — so the re-chirp waits for the burst to end
 *  (a trailing debounce: every event restarts it; one chirp per settled change) and plays into a route
 *  that has had a moment to move. 1.5 s spans a typical connect burst without leaving the tails that
 *  arm meanwhile unmeasured for long (they take the no-lag rules, the safe side). A property of the
 *  platform's event pattern, not a preference — not a knob. */
const RECHIRP_SETTLE_MS = 1500;

/** How often the debug block re-reads, ms (D74 S7). The measurements it shows arrive on the audio
 *  callback at 25–50 Hz, and re-rendering the overlay per frame to show them is exactly the trade the
 *  meter's ref refused — so the block SAMPLES instead. 250 ms is fast enough to watch a syllable move
 *  the peak and slow enough to be invisible in a profile; the block only exists while the owner has
 *  the `debug` knob on. Not a knob of its own: it is a property of reading, not of the call. */
const DEBUG_TICK_MS = 250;

/** How often THE CALL TRAIL samples the same record, ms (D77) — the debug block's numbers, written to
 *  the per-call file instead of the screen. 1 Hz because the trail is read AFTER the call, beside the
 *  relay's own stamps: once a second is enough to see the floor, the noise estimate and the hold move
 *  across a phrase, and few enough lines that a half-hour call stays a file one can read. Not a knob,
 *  for `DEBUG_TICK_MS`'s reason: it is a property of reading, not of the call. */
const TRAIL_SAMPLE_MS = 1000;

/** WHAT that sample carries (D77) — the readback record's MOVING fields, named here and nowhere else.
 *  The per-capture constants (the route, the hold lever, the echo pair, the device, the voice key)
 *  are written once, on the `capture` line; the last final has a line of its own (`final`). A second
 *  of a half-hour call should not repeat what cannot have changed. */
const TRAIL_SAMPLE_FIELDS = [
  "level",
  "levelPeak2s",
  "floor",
  "floorPinned",
  "noise",
  "noiseSettled",
  "voiceLevel",
  "earHeld",
  "tail",
  "mouthLive",
  "bargeArmed",
] as const satisfies readonly (keyof CallDebug)[];

/** THE CALL PACER'S DROPS, per leg (Phase 26 S1, ASR_PLAN §5 T6 — R95 §6). The bounded enqueue loses the
 *  OLDEST audio past `call_backlog_ms`, and the strained note says so once per burst; this says HOW MUCH
 *  and WHEN, for the trail — how many frames the leg lost, how many bursts they came in, and the ones
 *  still unreported, which ride the next `speech_started` as ONE `uplink {drops, ms_since_drop}` line (a
 *  turn that starts right after a loss may be missing its head). The leg's totals are written where the
 *  leg ends (`endUplinkLeg`). Counted always — a few integers — and written only by a debug trail. */
interface UplinkDrops {
  total: number;
  bursts: number;
  /** Frames dropped since the last `uplink` line, and the `performance.now()` of the latest of them. */
  since: number;
  lastAt: number;
}

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
 *  single-user install, a slower answer to a question that is nearly always the other way round.
 *
 *  …THE COMPAT PATH since Phase 26 D5, with the ladder above: where both ends carry the tab's
 *  `client_id`, the zombie this marker infers is superseded by the relay and no `busy` ever reaches the
 *  reducer. It still answers for a pre-D5 relay (v1.7.10) and for an id-less tab. */
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
   *  ("uplink allowance exceeded (ms budget): …") written for a log, and the terminal face
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
  /** ISS-54 — the capture's ear DIED (no frame ever, or its context errored) and is being rebuilt. The
   *  `earAsleep` honesty rule: it STANDS past the fresh leg, because what was said into the dead ear
   *  stays unheard whatever the rebuild fixes. */
  earStalled: "the microphone stalled — anything said just now wasn't heard",
  /** ISS-54 ② — the flip INTO call mode (`entersComm`) waits out the output pool (`STREAM_RETAG_MS`)
   *  before the fresh ear opens, so the screen says why `connecting` takes this long. Connection news: the
   *  fresh leg that ends the wait retracts it (`CONNECTION_NOTES`). */
  switchingRoute: "switching to call mode — about five seconds",
  /** D74 S5 — a final the EAR has no energy to account for: the relay answered a stretch of near
   *  silence with a plausible sentence (R76), and the microphone says nobody said it. The line owns
   *  up to the DISCARD rather than explaining the mechanism — what the owner needs to know is that
   *  their words did not go, and that saying it louder is the remedy. */
  tooQuiet: "too quiet — didn't take that",
  /** D80 ② — THE TEXT BACKSTOP: a final that is the reply's own words, heard back through the mic (a
   *  car still playing the tail). It stands on the HEARD line, in place of the words, so the owner sees
   *  what the ear dropped and why — parenthesised, because it is not something anybody said. The house
   *  copy names no pronoun for the agent anywhere (every line above talks about "the reply"), so the
   *  ruled "(her own words)" is kept NEUTRAL here. */
  ownWords: "(the reply's own words)",
  /** D73 S6 ④ — the background idle end. The terminal face already says "Call ended", so the note is
   *  the REASON, which is the one thing a call that ended on its own owes the owner. */
  idleBackground: "the call sat idle in the background",
  /** Phase 26 D5 — the relay ended this leg because a NEWER leg of this same tab took its slot
   *  (`ended{reason:"superseded"}`). Inside one tab the old leg is already fenced out, so in practice
   *  this is a DUPLICATED tab (a copied `sessionStorage`, same id) — whose newer leg may be a call OR a
   *  dictation, so the words claim no continuity, only what happened. Terminal, never a redial: two
   *  copies redialling would supersede each other until a ladder ran out. */
  superseded: "the call was taken over by another ctrl-b session",
  /** S7a (R2-1, N-6, H7) — the new ear's worker failed (`error{ear_failed}`) and the 1011 close that
   *  always follows redials through the ladder. Connection news — the fresh leg retracts it — that owns up
   *  to the one thing it may have cost: the segment that was in flight. */
  earFailed: "the ear restarted — the last thing you said may not have been heard",
  /** S7a (§3.5 ⑨, H8) — an awaited segment's answer outran the relay's own deadline (`answer_ttl_ms`), so
   *  its id was dropped and the mouth may open. A QUIET note, no cue: cues echo back in a car (D80 ⑥). */
  answerLate: "the ear didn't answer in time — that may not have been heard",
} as const;

/** The notes a FRESH LEG retracts — connection news, which a live connection has just made false.
 *  Everything else standing there (a refused send, a mouth failure, an upstream hiccup) arrived for its
 *  own reason and is the owner's unread news, which a reconnect has no business clearing (S2b confirm
 *  F3). The set exists because there is more than one: the strained note, the busy-retrying one the
 *  reconnect itself put up, and the route cycle's wait (ISS-54 ②) — which a leg that came up has ended. */
const CONNECTION_NOTES: readonly string[] = [
  CALL_COPY.strained,
  CALL_COPY.busyRetrying,
  CALL_COPY.switchingRoute,
  CALL_COPY.earFailed,
];

// ── the machine ──────────────────────────────────────────────────────────────────────────────────

export type CallPhase = "connecting" | "listening" | "thinking" | "speaking" | "error" | "ended";

/** `mic_hold` (D76 §B → D80 ⑤): `on` = held under every reply, `off` = never, `auto` = the D73 rule —
 *  held unless the track's canceller subtracts the reply (`"all"`). */
export type HoldMode = "auto" | "on" | "off";

/** Does THIS capture hold the ear under the reply — the policy half of `earHeld`, and the pre-play
 *  tap's question. `on`, or `auto` on an ear whose canceller does not subtract (D80 ⑤). The ONE
 *  predicate: the normalize reads it for the hold, the wiring for whether to register the tap. */
const mayHold = (s: CallState): boolean =>
  s.holdMode === "on" || (s.holdMode === "auto" && !s.ecAll);

export interface CallState {
  phase: CallPhase;
  /** Between the server VAD's `speech_started` and `speech_stopped`. */
  userSpeechActive: boolean;
  /** …and WHICH segment that is: the ear's `item_id` for the open segment (D80 ③), `null` when none is
   *  open or the relay named none. DERIVED to `null` with `userSpeechActive` (see `callReduce`). What
   *  lets a final for ANOTHER segment — Speaches overlaps them — leave this one's verdict alone. */
  speechItem: string | null;
  /** THE AWAITED SET (Phase 26 D9): the segments whose speech has STOPPED and whose transcript is not yet
   *  consumed or discarded, by the ear's `item_id`, in stop order; an id-less stop holds a `""` placeholder.
   *  A set, not a bit, because the ear can owe several at once (Speaches overlaps segments, and session
   *  B's batch ASR makes it routine): with one bit, A's final cleared the wait B's stop had raised and the
   *  mouth could open before B's words arrived (LIVE_VOICE_PLAN OPEN-2). Moved only by `settle` (an
   *  answer) and by an accepted `speechStop` (an add); every clear path writes `[]`. */
  awaiting: readonly string[];
  /** Speech stopped, its transcript not yet consumed or discarded — DERIVED from `awaiting` after every
   *  reduce (see `callReduce`), never set by an arm. Kept as a field for its readers (the overlay's `…`,
   *  `idleExpired`); the mouth's gate reads the set itself (`earUnsettled`). */
  waitingFinal: boolean;
  /** THE NOISE VERDICT (the owner's 2026-09-26 ruling): the segment open right now has run
   *  `noise_verdict_ms` with less of its OWN accrual than `min_final_ms` — the transcript gate would
   *  drop its final as "too quiet", so it does not hold the mouth. Only ever true WITH
   *  `userSpeechActive` (normalized — see `callReduce`): a verdict is about one open segment. */
  noiseOpen: boolean;
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
  /** THE HOLD POLICY this capture runs under (`mic_hold`, D76 §B) — read at `captureReady` like every
   *  other §4.5 knob, never re-decided mid-call. `off` until a capture exists: no track, no hold. */
  holdMode: HoldMode;
  /** Did the ear that actually opened come back with the SUBTRACTIVE canceller (`echoCancellation ===
   *  "all"`, the S0 ruling — the track's readback, never UA-sniffed)? Under `auto` it is the whole
   *  answer: a canceller that subtracts the reply needs no hold (D73 → D80 ⑤). */
  ecAll: boolean;
  /** Is the canceller ENGAGED on the ear that actually opened — the track's readback, never the ask
   *  (ISS-18 review F3): an EC-off route whose capture came back EC-on (`ecStuck`) is still IN comm
   *  mode, and only this bit knows it. Seeded on `captureReady`; what `leavesComm` measures against. */
  ecOn: boolean;
  /** THE TAIL HOLD (D80 ①): the mouth has fallen under a holding policy and the reply may still be in
   *  the air — a car plays it seconds after the element does. ARMED by the normalize on every fall of
   *  `mouthLive` while `mayHold` (drain, failure AND kill), cleared by a rising mouth, a policy that no
   *  longer holds (a route cycle, a terminal) or the wiring's `tailOver` for THIS arming. */
  tail: boolean;
  /** …and which arming it is: bumped on every one, so a `tailOver` measured for an older tail is a
   *  ghost (the `degradeHold`/generation fence, one level finer). */
  tailSeq: number;
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
   *  cleared it: a discarded tab's reload, a crash. Read ONCE at call start, like `holdMode`, and
   *  consulted by exactly one rule — whether a FIRST dial's `busy` is another device or our own
   *  unreaped slot. */
  priorLeg: boolean;
  /** The call generation (F7). Bumped by every terminal and by hang-up. */
  gen: number;
  /** Reconnect attempts spent since the last `ready`. */
  attempts: number;
  /** ISS-54 — this ROUTE has already had its one automatic rebuild after an `earDead`. Set by that
   *  rebuild, reset by a route cycle (the owner's own move) or by a TAKEN final (the rebuilt ear heard
   *  speech end-to-end — ISS-54 code round, Opus 2): a second death with neither in between ends the
   *  call (`micLost`) instead of looping ~8 s rebuilds the ladder could never bound. */
  earRetried: boolean;
  /** ISS-54 code round (Opus 1): a fresh-sink recapture onto the CALL route is under way, so comm mode
   *  is OFF until the fresh ear's `getUserMedia` turns it back on — and a stream the mouth opened in
   *  that window would be born MEDIA-tagged and re-routed by the switch. The mouth waits (`mouthMayOpen`,
   *  the existing seam), which it asks only when a reply STARTS, or RESUMES after a gap
   *  (`audioController`'s chunked path) — a reply already playing keeps talking through the wait. Set by
   *  `routeChange`/`earDead`, cleared by `captureReady` (the ear's gUM has run) and by every terminal. */
  sinkWait: boolean;
  /** THE TURN HOLD (ISS-55, `turn_hold_ms`): a TAKEN final waits in `pending` until the owner's pause has
   *  run `turnHoldMs`, and a final taken inside it joins the same message and starts it over. One more
   *  reason in `held()`, released only through `drain()` — by `callReduce`, once the hold is DUE and the
   *  ear settled. Set by the `final` arm; cleared by that release, a lost leg, a fresh ear (`freshEar`)
   *  and every terminal. Never set with the knob at 0. */
  turnHold: boolean;
  /** …which arming it is: bumped on every open and restart, so a `turnHoldOver` measured for an older
   *  one is a ghost (the tail's `tailSeq` fence) — and the wiring arms its clock on exactly this edge. */
  turnHoldSeq: number;
  /** …how long THIS arming runs, ms: the final's `turnHoldMs`, written with the seq, so the clock the
   *  wiring arms on that edge reads it from the state it arms for. */
  turnHoldMs: number;
  /** …and the pause has RUN OUT while the ear still owed something (a segment open, a transcript in
   *  flight): the release waits for the ear to settle — a taken final starts the hold over instead. */
  turnHoldDue: boolean;
  /** THE CAP JOIN (S7a, ASR_PLAN §3.5 ⑤ — G-2): the hold stands because a `max_segment` final cut the
   *  owner mid-sentence, and a cap cut is not a pause (R20). ONE flag ON `turnHold`, never a second hold or
   *  queue: a TAKEN cap final opens it (H4), any cap final while a hold stands continues it (EM-1), any
   *  other final clears it (and the ordinary hold rule then applies). While it stands `turnHoldDue` does not
   *  release — the joined id's TTL does (`answerExpired`). Cleared wherever `turnHold` is, and by mute
   *  (the continuation is condemned). Never set on a leg without the clock (H10). */
  capJoin: boolean;
  /** THE LEG CLOCK (S7a, ASR_PLAN §3.2/§3.5 ⑨): this leg's `ready.answer_ttl_ms` — the relay declared the
   *  new ear — or `null` on a leg without the capability, where every S7a rule is inert. ONE field rather
   *  than a bit + a number, so the two can never disagree; written by every `ready` (a rolled-back relay's
   *  next leg turns it off mid-call). */
  answerTtlMs: number | null;
}

export const CALL_INITIAL: CallState = {
  phase: "connecting",
  userSpeechActive: false,
  speechItem: null,
  awaiting: [],
  waitingFinal: false,
  noiseOpen: false,
  pending: [],
  heard: "",
  note: null,
  killing: false,
  heldUpload: false,
  confirmHold: false,
  muted: false,
  mouthLive: false,
  holdMode: "off",
  ecAll: false,
  tail: false,
  tailSeq: 0,
  earHeld: false,
  route: "",
  ecOn: false,
  inputDevice: "",
  priorLeg: false,
  gen: 0,
  attempts: 0,
  earRetried: false,
  sinkWait: false,
  turnHold: false,
  turnHoldSeq: 0,
  turnHoldMs: 0,
  turnHoldDue: false,
  capJoin: false,
  answerTtlMs: null,
};

export type SendResult = "accepted" | "refused" | "unknown" | "held";

export type CallSignal = { gen?: number } & (
  | {
      type: "ready"; //                         the relay said `state: ready`
      /** S7a — the leg clock's pair (§3.2), when the relay declared one: the parser admits both or
       *  neither. */
      clock?: "leg";
      answerTtlMs?: number;
      /** …and the parser's verdict on HALF a pair (H5): the leg runs without the clock — trail only. */
      anomaly?: string;
    }
  | { type: "socketLost" } //                  the leg closed while the call was still wanted
  /** The three SEGMENT signals carry the ear's `item_id` (D80 ③ — the relay forwards Speaches' one id
   *  per VAD segment) as `itemId`; absent when the relay named none, which is the unmeasured case. */
  | { type: "speechStart"; itemId?: string }
  | { type: "speechStop"; itemId?: string }
  /** THE NOISE VERDICT on the segment still open: it has run `noise_verdict_ms` and its accrual is below
   *  `min_final_ms` (measured in the wiring, on the segment it was armed for). Ignored with no segment
   *  open. */
  | { type: "segmentNoise" }
  /** …with THE TRANSCRIPT GATE's two numbers (D74 S5), carried on the signal because the rule is the
   *  reducer's and the measurement is the wiring's. `energyMs` is the ear's own accrual for the
   *  SEGMENT this final is about (D80 ③, keyed by its `itemId`) — ABSENT when no segment of that id was
   *  measured, which is the fail-open case: a final nobody measured is unmeasured, not quiet.
   *  `minFinalMs` is the owner's knob, delivered the same way every other §4.1 tunable is; absent or 0
   *  means the gate is off. */
  /** …and THE TEXT BACKSTOP's pair (D80 ②), the same split: `echo` is how much the final looks like the
   *  reply the mouth just spoke (`lib/echoText`), stamped by the wiring ONLY for a final that landed
   *  inside the post-reply window and is long enough to judge — ABSENT otherwise, which is never an
   *  echo; `echoMin` is the owner's `echo_similarity`. `inEchoWindow` says the final landed inside that
   *  window at all (judged or not): the reducer ignores it, the voice learner does not learn from it. */
  /** …and THE TURN HOLD's length (ISS-55), the `minFinalMs` contract: the owner's `turn_hold_ms`, stamped
   *  by the wiring only when it is on — absent or 0 means a taken final is sent at once. */
  | {
      type: "final";
      text: string;
      itemId?: string;
      energyMs?: number;
      minFinalMs?: number;
      echo?: number;
      echoMin?: number;
      inEchoWindow?: true;
      turnHoldMs?: number;
      /** S7a — a capability leg's final (§3.5 ②): why its segment ended, what the ASR said, the parser's
       *  `anomaly` when it failed validation (H1: settled, no text taken), and `late` when its id already
       *  expired (R3-2 — the trail's `late_finals`; the reducer treats it like any other final). All
       *  absent on a leg without the clock, so the signal and its trail line stay today's. */
      reason?: LiveReason;
      outcome?: LiveOutcome;
      anomaly?: string;
      late?: true;
    }
  /** The uplink is losing audio — the relay's own overflow state, or (A-F2) our own bounded queue
   *  dropping its oldest frames. ONE signal for both, deliberately: it is one loss chain, and two notes
   *  for it would be two things saying the same thing. */
  | { type: "degraded" }
  | { type: "degradedOver" } //                the strained note's hold expired (see DEGRADED_NOTE_MS)
  | { type: "setMuted"; on: boolean } //       the mute control (§6)
  /** The capture RESOLVED, carrying the two things about it the hold depends on (D76 §B): the policy
   *  (`mic_hold`, read at call start) and whether the track's own AEC readback is the subtractive
   *  `"all"`. `note` is the one thing about it the SCREEN depends on: the D73 device fallback. */
  | {
      type: "captureReady";
      holdMode: HoldMode;
      ecAll: boolean;
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
  /** ISS-54 — the capture's ear DIED (`PcmCaptureOpts.onDead`): its context raised `error`, or it never
   *  posted a frame. `heard` (any frame ever) and `visibilityState` (the page when it died, ISS-54 design round F6) ride for
   *  the trail; the reducer decides by neither. */
  | {
      type: "earDead";
      reason: EarDeath;
      heard: boolean;
      visibilityState?: DocumentVisibilityState;
    }
  /** D73 S6 ④ — a BACKGROUNDED call sat past `background_idle_s` with no speech and no reply. */
  | { type: "idleExpired" }
  /** `itemId` — the segment an `upstream_error` was raised for, when the relay names one (D9). Speaches
   *  sends the error INSTEAD of that segment's final and names none, so only the id-less branch runs
   *  there; the new ear (a leg with the clock) sends the typed `asr_error` final FIRST and then this
   *  error with its id (H6, ASR_PLAN §3.9 ①) — the final settles, the error sets the note. */
  | { type: "serverError"; code: string; message: string; itemId?: string }
  /** The relay said `state: ended` — with the frame's `reason` when it named one (D5: `superseded`). */
  | { type: "serverEnded"; reason?: string }
  /** Trigger A — VOICE over an AUDIBLE reply (the wiring's sustained-energy window). Interrupts the
   *  mouth and nothing else: inert while it is silent, so speech during `thinking` steers (D41). */
  | { type: "barge" }
  /** THE OWNER'S STOP — the overlay's whole-surface tap (§4.3 trigger B, amended by LIVE-001 / D71
   *  amendment №3): "stop her, whatever she is doing". Speaking ⇒ the same ordered kill a barge fires;
   *  thinking ⇒ the same kill with nothing audible to silence, cancelling the turn; anywhere else inert.
   *  A separate signal from `barge` ON PURPOSE: the intent is named once, here, rather than the voice
   *  path leaning on the wiring's `mouthLive` guard to stay out of turns it must only steer. */
  | { type: "stop" }
  | { type: "killSettled" }
  | { type: "playbackStarted" }
  | { type: "playbackDrained" }
  /** THE TAIL'S RELEASE (D80 ①), measured in the wiring: the ear heard `quiet` for long enough after
   *  the minimum, the `cap` ran out, or — for a tail a KILL armed — the minimum itself passed (`kill`).
   *  For the arming `seq` only — a stale one is ignored. */
  | { type: "tailOver"; seq: number; reason: TailReason }
  /** THE TURN HOLD'S CLOCK ran out (ISS-55) — for the arming `seq` only, like `tailOver`. */
  | { type: "turnHoldOver"; seq: number }
  /** THE AWAITED HEAD'S TTL ran out (S7a, §3.5 ⑨ — N-1): `itemId` reached the head of the D9 set
   *  `answerTtlMs` ago and is still unanswered. Fenced by the head itself: a TTL for an id that is no
   *  longer the head is a ghost. */
  | { type: "answerExpired"; itemId: string }
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
   *  SUBMITS after the owner closed the call (every exit HARVESTS to the draft, never sends — ISS-61).
   *  Deliberately NOT `hangup` itself: its `close: true` would `endCall()`, and on a redial's
   *  remount that would kill the fresh call the owner just asked for. */
  | { type: "unmounted" }
  /** The start effect's SETUP is running (again). Dev-only in practice: StrictMode runs every effect
   *  setup → cleanup → setup on the same instance, state surviving, so the cleanup's `unmounted` has
   *  just landed the machine terminal — and without a symmetric re-arm every call on the dev server
   *  dies at birth ("Call ended", no note, redial included). Carries no `gen` ON PURPOSE: it is the
   *  one signal that must land across the generation the cleanup moved. */
  | { type: "remount" }
  /** The call could not start at all. `cause` is TRAIL-ONLY (ISS-54 confirm round): which failure the
   *  start threw (`failureCause`), so a render error ("audio context suspended (error)") reads apart from
   *  a policy suspend; the reducer decides by `note` alone. */
  | { type: "failed"; note: string; cause?: string }
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
   *  success on a set it never widened), so the only honest way to change the route is a new track.
   *  Since ISS-54 it is also the dead ear's rebuild (`earDead`) — same route, same device, new track. */
  | {
      type: "recapture";
      route: string;
      deviceId: string;
      /** The flip leaves comm mode (EC on → off): the mouth must open a FRESH output stream for the next
       *  reply (`audioController.markStreamRetag`, ISS-18 / R81). */
      leavesComm: boolean;
      /** THE EAR's half of the same mirror (ISS-54 ②, R99 §1.4): the fresh capture must not open its
       *  context until the output pool has let the old context's stream go — `STREAM_RETAG_MS` from the
       *  release — or it draws that stream back and the comm-mode re-route kills it. True for every
       *  recapture onto the call route (a flip in, a device move within) and every `earDead` rebuild;
       *  false where the old stream is harmless (a flip out of comm mode, a media-route device move).
       *  …and the MOUTH's half (ISS-54 code round, Maya M1): every fresh-sink recapture ON THE CALL ROUTE
       *  re-enters comm mode — releasing the last input left it for the wait — so the next reply opens a
       *  fresh output stream too (`markStreamRetag`). Off the call route nothing is re-routed, and a
       *  re-tag would only cost the next reply the 5.5 s element wait (ISS-54 confirm round, Opus). */
      freshSink: boolean;
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

/** Every reason a queued utterance may not go out right now (§4.3's one mechanism, four holds — and
 *  the owner's own pause, the turn hold, ISS-55). */
function held(s: CallState): boolean {
  return (
    s.turnHold ||
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

/** THE TRANSCRIPT GATE'S VERDICT (D74 S5), ONE predicate for the two places that judge by it — the
 *  `final` arm it was built for, and the wiring's noise verdict on a segment still open (the owner's
 *  2026-09-26 ruling: "noise" means exactly what this gate would drop). True only on the segment's own
 *  evidence below a knob that is on: absent evidence is unmeasured, not quiet, and absent/0 is the gate
 *  off. */
function tooQuiet(sig: { energyMs?: number; minFinalMs?: number }): boolean {
  return (
    sig.energyMs !== undefined &&
    sig.minFinalMs !== undefined &&
    sig.minFinalMs > 0 &&
    sig.energyMs < sig.minFinalMs
  );
}

/** Is a segment signal about the OPEN segment (D80 ③)? Two KNOWN ids that differ are two segments;
 *  anything unnamed on either side keeps the pre-ledger rule (it is). ONE predicate for the `speechStop`
 *  and `final` arms. */
function sameSegment(itemId: string | undefined, open: string | null): boolean {
  return itemId === undefined || open === null || itemId === open;
}

/** THE EAR ANSWERED a segment (Phase 26 D9) — its final, dropped or taken, or the `upstream_error` it
 *  sends instead — so that segment is no longer awaited. ONE rule for every answer:
 *  · a KNOWN id leaves the set WITH every id ahead of it: the ear answers in stop order (Speaches per
 *    session, session B's serial worker by construction), so anything still ahead lost its answer — a
 *    stop whose final never came is healed by the next answer instead of holding the mouth for the rest
 *    of the call (D9 design round, Opus M1; never worse than the one bit this replaces);
 *  · an id the set does NOT hold (a late final, one a clear already settled) was never awaited by name:
 *    it settles only the `""` placeholders, one of which may be its own id-less stop (Opus M2 / Maya M1)
 *    — clearing everything here would open the mouth over a segment still owed;
 *  · an id-LESS answer (a relay that names no segment — every error today) clears the whole set: the
 *    pre-D9 belt, because nothing says which one it was.
 *  Returns `s` itself when nothing moved, like `mouth`. */
function settle(s: CallState, itemId: string | undefined): CallState {
  if (s.awaiting.length === 0) return s;
  if (itemId === undefined) return { ...s, awaiting: [] };
  const at = s.awaiting.indexOf(itemId);
  if (at >= 0) return { ...s, awaiting: s.awaiting.slice(at + 1) };
  if (!s.awaiting.includes("")) return s;
  return { ...s, awaiting: s.awaiting.filter((id) => id !== "") };
}

/** THE CAP JOIN LETS GO (S7a, §3.5 ⑤) — a final of another reason, the joined id's TTL, or a mute. The
 *  hold itself stays and falls back to the ordinary rule: with the knob on, its `turn_hold_ms` clock
 *  (already counting since the cap final, or already due); at 0 there is no clock, so it is due at once —
 *  and `callReduce` releases it the moment the ear settles. Returns `s` itself when no join stood. */
function dropJoin(s: CallState): CallState {
  if (!s.capJoin) return s;
  return { ...s, capJoin: false, turnHoldDue: s.turnHoldDue || s.turnHoldMs === 0 };
}

/** Start the §4.3 ORDERED kill. Both triggers land here — the voice barge and the owner's stop (which
 *  also takes it from `thinking`, with no mouth to fall) — so the state the kill leaves behind is written
 *  once.
 *
 *  `mouthLive` goes down with it, and that is not an inference about the element: step ① of the effect is
 *  a SYNCHRONOUS `dismiss()`, so by the time anything else reads this state the element is already
 *  silent. What is NOT silent is whatever the output path had buffered — a car keeps playing ~2 s of it
 *  (D80 ①; the owner's answer ⑥) — so the ear-hold does not lift here: the mouth's fall arms the TAIL
 *  (see `callReduce`), which a kill's wiring ends on a DEADLINE — `hold_tail_min_ms` — rather than on
 *  quiet, because the owner is talking into it (`TailRun.deadline`). */
function killNow(s: CallState): Step {
  return { state: { ...mouth(s, false), killing: true }, out: [{ type: "kill" }] };
}

/** THE EAR STARTS OVER (D74 S2's route cycle, shared since ISS-54 with the `earDead` rebuild): the
 *  state for "this leg closes, this ear is released, a fresh one is being acquired". ONE helper for both
 *  arms, so a rule about what dies with the old track cannot be written into one and forgotten in the
 *  other. The route pair, the note and the rebuild bound are the caller's. */
function freshEar(s: CallState): CallState {
  return {
    ...s,
    // The SCREEN is honest about what is happening: this is a fresh leg on a fresh ear, and the
    // ladder starts clean because the redial is the acquisition's, not a rung of the ladder's (the
    // `earDead` rebuild carries its own bound, `earRetried`).
    phase: "connecting",
    attempts: 0,
    // …and THIS TAB DEMONSTRABLY OWNED A LEG a moment ago (R86 LC-4): the old one's slot is
    // released only after its close has crossed Serve and the relay's upstream teardown has run,
    // so the redial can be refused `busy` by our own leg. That is exactly the S6 ⑦ case — the
    // note-only path, where the 1013 close drives the ladder that outlasts the slot.
    priorLeg: true,
    // The utterance in flight dies with the track, exactly as it does on a `socketLost`: the
    // audio is gone and no session will endpoint it — and so is every transcript still owed.
    userSpeechActive: false,
    awaiting: [],
    // …and a kill in flight is released rather than left standing: its `killSettled` was armed
    // under the generation this arm is about to move, so nothing would ever clear the flag and
    // the pending queue would be held for the rest of the call.
    killing: false,
    // The HOLD belongs to the track (§5.1, resolved ONCE per capture), so it dies with it; the
    // fresh `captureReady` decides it again under the new route. `earHeld` follows in normalize.
    holdMode: "off",
    ecAll: false,
    // …and so does its TAIL (D80 ①): the fresh ear is not the one the reply was leaking into.
    tail: false,
    // …and the TURN HOLD lets go (ISS-55), keeping its words: the pause it was timing belonged to the
    // ear being released — nothing that ear heard can arrive to join them now — and the move below
    // makes its clock a ghost, so a hold left standing would never release. The queue drains at the
    // fresh leg's `ready` (`connecting` holds it until then), like every other queued utterance.
    turnHold: false,
    turnHoldDue: false,
    capJoin: false,
    // THE FENCE (F7). The old leg's frames, its close, this capture's `onEnded` and any send
    // outcome armed under it all become ghosts — which is the point: the redial is driven by the
    // acquisition, not by the close, so a `socketLost` from the leg being closed must not spend a
    // rung of a ladder that is not running. The one thing it costs is an in-flight chat POST's
    // outcome, which is a note the owner loses, not speech (the queue is kept).
    gen: s.gen + 1,
  };
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
      awaiting: [],
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
      holdMode: "off",
      ecAll: false,
      tail: false,
      earHeld: false,
      // …and no recapture is coming to clear the mouth's wait (ISS-54): the terminal's teardown runs.
      sinkWait: false,
      // …nor a turn hold to release (ISS-55): its words are in the harvest above.
      turnHold: false,
      turnHoldDue: false,
      capJoin: false,
      gen: s.gen + 1,
    },
    out,
  };
}

/** ONE SIGNAL, as a call-trail line (D77) — built around the reduce, never inside it (the reducer stays
 *  pure; the wiring logs what went in and what changed). The payload rides verbatim — every signal
 *  carries primitives only — with three deliberate exceptions (council F5/F1):
 *  · a `text` becomes `textLen`: the owner's words are in the trail ONCE, in the relay's `transcript`
 *    line (which is how a self-transcribed reply is recognised), never copied here;
 *  · a `final` snapshots the PRE-reduce state the ear decision turns on (`pre`), so a final that
 *    walked in through an ear that was open when it should not have been is VISIBLE;
 *  · a signal armed under another generation says so (`staleGen`) — the fence dropped it.
 *  `phase`/`note` appear only when the reduce moved them, and so does `genMove`: the line is STAMPED
 *  after the reduce, so a signal that moved the generation (a terminal, an accepted route cycle) would
 *  otherwise read as belonging to the generation it created rather than the one it ran under. */
export function trailSig(
  sig: CallSignal,
  prev: CallState,
  next: CallState,
): Record<string, unknown> {
  const { type, gen, ...payload } = sig;
  const line: Record<string, unknown> = { type };
  for (const [k, v] of Object.entries(payload)) {
    if (k === "text" && typeof v === "string") line.textLen = v.length;
    else line[k] = v;
  }
  if (gen !== undefined && gen !== prev.gen) line.staleGen = gen;
  if (type === "final")
    line.pre = { earHeld: prev.earHeld, mouthLive: prev.mouthLive, muted: prev.muted };
  if (prev.phase !== next.phase) line.phase = `${prev.phase}→${next.phase}`;
  if (prev.gen !== next.gen) line.genMove = `${prev.gen}→${next.gen}`;
  if (prev.note !== next.note) line.note = next.note;
  return line;
}

/**
 * The whole conversation loop, as one pure function.
 *
 * THE EAR-HOLD IS DERIVED, NOT DECIDED (S3): `earHeld` is normalized once here, after the arm has had its
 * say, rather than being maintained by every arm that could move one of its inputs. A rule spread
 * across a dozen arms is a rule with a dozen chances to be forgotten by the next one. The TAIL is armed
 * here for the same reason (D80 ①): "the mouth fell" is a fact about the step, not about any one arm.
 */
export function callReduce(s: CallState, sig: CallSignal): Step {
  const step = reduce(s, sig);
  const st = step.state;
  // A NOISE VERDICT is about ONE open segment: every arm that closes or condemns it (the stop, a mute,
  // a lost or fresh leg, a route cycle, a terminal) takes the verdict with it, and the next segment
  // starts unjudged, without any arm remembering to. The segment's ID goes the same way.
  const noiseOpen = st.noiseOpen && st.userSpeechActive;
  const speechItem = st.userSpeechActive ? st.speechItem : null;
  // The wait is the SET's (D9): no arm writes the bit, so it can never disagree with the ids behind it.
  const waitingFinal = st.awaiting.length > 0;
  // The POLICY is the capture's (`holdMode` × `ecAll`, D73 → D80 ⑤), `mouthLive` the transport's (is
  // the reply audible?), and `tail` the reply's afterlife (D80 ①): EVERY fall of the mouth under a
  // holding policy arms a new tail — a drain, a failure, and a KILL alike, because a tap silences the
  // element and not the car's buffer (D80 ①, the owner's answer ⑥ — the `!killing` release this
  // replaces opened the ear into ~2.3 s of it). A rising mouth takes the tail back (the next fall arms
  // a new one), and so does a policy that stopped holding (a route cycle, a terminal).
  const holds = mayHold(st);
  const armed = holds && s.mouthLive && !st.mouthLive;
  const tail = holds && !st.mouthLive && (armed || st.tail);
  const tailSeq = armed ? st.tailSeq + 1 : st.tailSeq;
  const earHeld = (st.mouthLive || tail) && holds;
  const normalized: Step =
    earHeld === st.earHeld &&
    noiseOpen === st.noiseOpen &&
    speechItem === st.speechItem &&
    waitingFinal === st.waitingFinal &&
    tail === st.tail &&
    tailSeq === st.tailSeq
      ? step
      : {
          state: { ...st, earHeld, noiseOpen, speechItem, waitingFinal, tail, tailSeq },
          out: step.out,
        };
  // THE TURN HOLD'S RELEASE (ISS-55) — ONE site, here, after the normalize, for the reason the ear-hold
  // is derived here: "the pause has run out and the ear has settled" is a fact about the step, not about
  // any one arm. A hold that ran out over an open or owed segment is released by WHATEVER settles the
  // ear — that segment's dropped or empty final, a noise verdict, an `upstream_error`, a mute condemning
  // the half-utterance — and a release inside an arm would read an ear the normalize had not yet
  // re-derived (TH design round, Opus H1 / Maya H2). A TAKEN final never lands here: it starts the hold
  // over. `drain` still honours every other hold (`speaking`, `connecting`, a kill, a confirm, an
  // upload), and the queue then waits for THAT release, as any queued utterance does.
  // …and a CAP JOIN never releases on the pause (S7a, §3.5 ⑤): the owner was cut mid-sentence, so the
  // hold waits for the continuation's final — or the joined id's TTL, which clears the flag.
  const ns = normalized.state;
  if (!ns.turnHold || !ns.turnHoldDue || ns.capJoin || earUnsettled(ns)) return normalized;
  const released = drain({ ...ns, turnHold: false, turnHoldDue: false });
  return { state: released.state, out: [...normalized.out, ...released.out] };
}

/** MAY THE MOUTH BECOME AUDIBLE NOW (§4.2's iron rule, enforced by waiting — the owner's 2026-09-26
 *  ruling)? No transcript in flight, no segment open unless it has been judged noise, no fresh ear
 *  still waiting for comm mode to come back (`sinkWait`, ISS-54), and no TURN HOLD standing (ISS-55 —
 *  the owner is mid-thought and holds the floor: a reply readied meanwhile waits, and one already
 *  playing pauses at its next synthesis gap until the hold lets go). The whole of
 *  the controller's gate (`setCallMouthGate`); `barge_in` plays no part in it — a barge-in interrupts
 *  something AUDIBLE, and a mouth still waiting is not. */
export function mouthMayOpen(s: CallState): boolean {
  return !earUnsettled(s) && !s.sinkWait && !s.turnHold;
}

/** IS THE EAR STILL OWED SOMETHING — a transcript in flight, or a segment open that has not been judged
 *  noise? The EAR's half of the mouth's gate (`sinkWait` is the sink's), named so that what waits on the
 *  ear to SPEAK can ask one predicate. Not `idleExpired`'s: that guard keeps its own rule on purpose (any
 *  open segment, noise or not, keeps a backgrounded call alive). It reads the awaited SET, never the
 *  derived `waitingFinal`: an arm's state has not been through the normalize yet, so the bit can be stale
 *  there. */
function earUnsettled(s: CallState): boolean {
  return s.awaiting.length > 0 || (s.userSpeechActive && !s.noiseOpen);
}

function reduce(s: CallState, sig: CallSignal): Step {
  // THE FENCE (F7), first line: a callback armed under an older generation is not this call's business.
  if (sig.gen !== undefined && sig.gen !== s.gen) return { state: s, out: [] };
  // "Hang up from every state" (§4.2) is the one rule that outranks the terminal guard below — and
  // `unmounted` shares it: the generation MUST move on every exit, terminal or not, or a callback
  // still in flight (a dispatched socket frame, a cancel settlement) outlives the call it belonged to.
  if (sig.type === "hangup" || sig.type === "hidden" || sig.type === "unmounted") {
    // EVERY exit HARVESTS the pending queue to the draft — never a send (ISS-61, the owner's ruling of
    // 2026-10-06: "I'd rather manually delete the text in the composer than lose part of the
    // conversation"). A draft costs one delete; lost words cost the conversation. This reverses the old
    // "a deliberate exit discards" rule (§4.3, amended): its `(hidden || turnHold)` predicate threw away
    // 13 utterances held behind a confirm gate at an `unmounted` exit in the owner's 13:02 call. It
    // harvests exactly as a terminal does. `unmounted` alone does not `close` — its component is ALREADY
    // unmounting, and an `endCall()` here would end the fresh call a redial's key bump is mounting in the
    // same commit. Never twice: this arm consumes `pending` (CALL_INITIAL), so a second exit on the same
    // instance finds it empty — and StrictMode's simulated cleanup runs only at mount (nothing queued),
    // while a redial's key bump unmounts the old instance once, from its own state.
    const out: CallEffect[] = [];
    if (s.pending.length) out.push({ type: "harvest", lines: s.pending });
    out.push({ type: "teardown", close: sig.type !== "unmounted" });
    return {
      // `priorLeg` survives the reset (S6 code-review F3, reshaped): StrictMode's simulated cleanup
      // funnels through THIS arm, and its teardown clears the sessionStorage marker — so the state's
      // copy is the only carrier left when the re-run's `remount` re-arms. A REAL exit loses nothing
      // by it: a redial's key bump mounts a fresh instance whose state starts at CALL_INITIAL anyway.
      state: { ...CALL_INITIAL, phase: "ended", priorLeg: s.priorLeg, gen: s.gen + 1 },
      out,
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
        awaiting: [],
        note: s.note !== null && CONNECTION_NOTES.includes(s.note) ? null : s.note,
        // THE LEG CLOCK (S7a, §3.2) is this leg's declaration, re-read on every `ready` — a relay rolled
        // back between two legs of one call turns every S7a rule off again (H10).
        answerTtlMs: sig.clock === "leg" ? (sig.answerTtlMs ?? null) : null,
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
      // the awaited set clears rather than waiting for transcripts no session will send. Playback is
      // untouched: C3 rides HTTP, not this socket.
      // …and a TURN HOLD lets go (ISS-55), for the same reason: the continuation it was waiting for
      // can no longer arrive, so the words already taken go at the fresh leg's `ready` (`connecting`
      // holds them until then) instead of sitting out a pause nobody is in.
      return {
        state: {
          ...s,
          phase: "connecting",
          attempts: attempt,
          userSpeechActive: false,
          awaiting: [],
          turnHold: false,
          turnHoldDue: false,
          capJoin: false,
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
      // would light "speaking" for nobody and hold the mouth for a phantom.
      if (s.muted || s.earHeld) return { state: s, out: [] };
      return { state: { ...s, userSpeechActive: true, speechItem: sig.itemId ?? null }, out: [] };

    case "speechStop":
      // A stop PAIRS WITH AN ACCEPTED START, or it is nothing (the design round's A2). A start the
      // machine ignored (muted, held) or one a mute already condemned opened no segment, and a stop that
      // raised `waitingFinal` for it would hold the mouth for a final that is never coming.
      if (!s.userSpeechActive) return { state: s, out: [] };
      // …and it pairs with ITS OWN start (D80 ③, Maya's code round): a stop naming another segment than
      // the open one closes nothing — the `final` arm's identity rule, applied to the stop. Speaches'
      // order (stop(A) before start(B)) makes it unreachable today; the meter already freezes by id.
      if (!sameSegment(sig.itemId, s.speechItem)) return { state: s, out: [] };
      // HELD, a stop still LOWERS the flag it pairs with — it never raises `waitingFinal`, whose final
      // the held arm below drops anyway (R86 LC-1's knock-on). A segment can be open when the hold
      // engages (a reply that restarts over it); a flag left up behind it would hold the next reply at
      // the mouth's door for a final the held arm drops.
      if (s.earHeld) return { state: { ...s, userSpeechActive: false }, out: [] };
      // The segment's transcript is now OWED, by its id (D9) — or by a `""` placeholder when the relay
      // named none, which an id-less answer, an unknown id, or a known id's answer queued BEHIND it
      // settles (see `settle`).
      return {
        state: { ...s, userSpeechActive: false, awaiting: [...s.awaiting, sig.itemId ?? ""] },
        out: [],
      };

    case "segmentNoise":
      // The verdict on the segment STILL OPEN: it lifts the mouth's hold for it, and nothing else — its
      // final, if one comes, still meets the transcript gate on its own arm.
      if (!s.userSpeechActive || s.noiseOpen) return { state: s, out: [] };
      return { state: { ...s, noiseOpen: true }, out: [] };

    case "setMuted":
      // MUTE CONDEMNS THE HALF-UTTERANCE (§6, owner-ratified). Both flags clear with the same edge: the
      // words in flight are not going to be sent, so nothing waits on them — and §4.2's iron rule (no
      // playback while `userSpeechActive || waitingFinal`) must not go on holding the mouth for a final
      // that is never coming. Unmuting is simply the ear opening again; the next utterance is fresh.
      // A TURN HOLD standing is NOT condemned (ISS-55, the main seat's Q1): its words were taken before
      // the tap — only the half-utterance in flight is — so a cough-mute cannot throw a finished
      // monologue away. It runs on; one already due is released by the ear this settles (`callReduce`).
      // …but a CAP JOIN is (S7a, audit §C.6): the continuation it waits for is the half-utterance this
      // condemns, and its final lands muted and is dropped before any hold logic — so the flag lets go
      // here, the held words stay, and the hold falls back to its own clock (`dropJoin`).
      if (sig.on) {
        return {
          state: dropJoin({ ...s, muted: true, userSpeechActive: false, awaiting: [] }),
          out: [],
        };
      }
      return { state: { ...s, muted: false }, out: [] };

    case "final": {
      // THE VERDICT ENDS WITH ITS SEGMENT'S FINAL (Emma's code round F2): a final that lands before or
      // without `speech_stopped` leaves the segment open, and the normalization in `callReduce` would
      // keep the verdict with it — the mouth permitted over a segment whose judgement has expired. So
      // EVERY exit below runs with it cleared, once; a later segment is a new one with its own timer.
      // …but ONLY ITS OWN (D80 ③): Speaches overlaps segments — `speech_started(B)` lands before
      // `transcript(A)` — and A's final ending B's verdict would put a judged TV segment back in front
      // of the mouth. Two KNOWN ids that differ are two segments; anything unnamed keeps the old rule.
      if (s.noiseOpen && sameSegment(sig.itemId, s.speechItem))
        return reduce({ ...s, noiseOpen: false }, sig);
      // "Mute means don't send that" (owner-ratified), applied FLAT: a final that arrives while muted is
      // dropped whether it is the condemned half-utterance or one the server endpointed a moment before
      // the tap. One rule, no window where the words go out anyway.
      // …and the same flat drop while the ear is HELD (S3), where the words are the reply's own leaking
      // back in: transcribing the character into the owner's next message is the exact failure the hold
      // exists to prevent, and it must not depend on whether the VAD pair that framed it was seen.
      // Either drop still SETTLES the wait (R86 LC-1's knock-on, as at `speechStop`): the final has
      // arrived, so its segment is no longer in flight — an id stranded here holds the mouth for nothing.
      // EVERY exit below runs on `settled` for the same reason (D9): an answer is an answer, taken or not.
      // …except an ID-LESS final on a leg with the clock (S7a review, Opus LOW-3): every final there
      // names its segment, so one that does not is an anomaly (H1) that answers NOTHING — the legacy
      // id-less belt would clear the whole set and open the mouth over segments still owed. The id it
      // failed to name stays awaited and is the TTL's to expire (§3.5 ⑨). A leg without the clock keeps
      // the belt, byte for byte.
      const settled =
        s.answerTtlMs !== null && sig.itemId === undefined ? s : settle(s, sig.itemId);
      // THE CAP JOIN (S7a, §3.5 ⑤ — inert without the leg clock, H10): is this final a `max_segment` cut?
      // An anomalous final's reason is not evidence (H1), so it counts as any other final.
      const capCut =
        s.answerTtlMs !== null && sig.reason === "max_segment" && sig.anomaly === undefined;
      // …and what a final that is NOT taken does to it (EM-1, H4): a cap final while a hold stands
      // CONTINUES the join whatever its fate (the owner is still mid-sentence in the next segment); any
      // other final ENDS it — the N-2 release on the last absorbed non-`max_segment` final of every reason
      // and outcome, a gate-dropped one included (R3-1).
      const unTaken = (st: CallState): CallState =>
        !capCut ? dropJoin(st) : s.turnHold && !st.capJoin ? { ...st, capJoin: true } : st;
      // Mute and the held ear only ever END a join (mute already cleared it; a cap final there continues
      // nothing the machine is listening to).
      if (s.muted || s.earHeld) return { state: capCut ? settled : dropJoin(settled), out: [] };
      // An `asr_error` final settles SILENTLY and takes no text even if it carries some (§3.5 ⑨, R3-2) —
      // its companion `error{upstream_error}` sets the one note (H6). An anomalous final likewise (H1):
      // its id is settled so the mouth is not stranded, and its `sig` line is the trail's record.
      const text = sig.anomaly !== undefined || sig.outcome === "asr_error" ? "" : sig.text.trim();
      // Empty finals are discarded (§4.5's no-speech path): nothing submits, the wait settles.
      if (!text) return { state: unTaken(settled), out: [] };
      // THE TEXT BACKSTOP (D80 ②): the reply's own words, heard back after the element finished — the
      // tail hold's residue (a pause inside the not-yet-heard tail, a tail past the cap). Dropped
      // VISIBLY on the heard line, and SILENTLY to the ear: a cue here would be one more sound for the
      // car to play back. BEFORE the transcript gate, because it is the more specific diagnosis — an echo
      // that is also quiet is still an echo, and a cue for it would be wrong twice.
      if (sig.echo !== undefined && sig.echoMin !== undefined && sig.echo >= sig.echoMin)
        return { state: unTaken({ ...settled, heard: CALL_COPY.ownWords }), out: [] };
      // THE TRANSCRIPT GATE (D74 S5 ③). A Whisper-family endpoint does not answer noise with nothing
      // — it answers with a PLAUSIBLE SENTENCE (R76), and on a call that sentence is submitted to the
      // agent as if the owner had said it. The relay cannot tell; the client can, because it already
      // measures what the microphone heard. So a final the EAR cannot account for is dropped, with
      // one line saying so — never silently, because a discarded utterance the owner believes went
      // out is the worse failure of the two.
      //
      // FAIL-OPEN, NARROWED TO UNKNOWN IDS (D74 → D80 ③): it fires only when there IS evidence for this
      // final's OWN segment. A final whose id no measured segment carries — a start the machine ignored
      // (held, muted), a leg that died, an id nobody saw — carries no accrual, and absence of evidence
      // is not evidence of silence. AFTER the empty check on purpose: a no-speech final (and the relay's
      // gap-cut `short` one, D80 ④) is already handled, and it deserves no note.
      if (tooQuiet(sig)) {
        // …and HEARD, not only shown (D76 §C.5): the note line is useless to an owner who is driving.
        // But only for a SUSTAINED drop (D80 ⑥): a final whose segment put NOTHING above the floor is a
        // hallucination on a flap (Parakeet's "Yeah."/"Mm." on car noise), not an owner too quiet to
        // hear — and in the car the cue's own echo came back 2.3 s later as the next flap, which dropped,
        // which cued (12 beeps in 5 minutes). Nothing heard, nothing said.
        return {
          state: unTaken({ ...settled, note: CALL_COPY.tooQuiet }),
          out: (sig.energyMs ?? 0) > 0 ? [{ type: "dropCue" }] : [],
        };
      }
      // A TAKEN final retracts the "too quiet" note (D80's W6): it was about the last drop, and it stood
      // for the rest of the call. Only ITS OWN note — the `degradedOver` rule: anything else there is
      // news of its own that the owner has not read yet. The TTL's `answerLate` is the same kind of
      // note (S7a review, Opus LOW-2): about one segment, and an ear that just answered disproves it.
      const taken: CallState = {
        ...settled,
        heard: text,
        pending: [...s.pending, text],
        note: s.note === CALL_COPY.tooQuiet || s.note === CALL_COPY.answerLate ? null : s.note,
        // …and a rebuilt ear that heard speech end-to-end earns its one rebuild back (ISS-54 code round,
        // Opus 2): a long call's second, unrelated render error is not a loop — a flapping headset
        // yields no taken finals between flaps, so it stays bounded.
        earRetried: false,
      };
      // THE TURN HOLD (ISS-55): with the knob on the words WAIT — a pause shorter than the hold joins
      // the next segment into the same message. EVERY taken final (re)starts it, a due one included
      // (the ASR_PLAN §3.5 ⑤ amendment: serial pauses stay ONE turn), and none drains here: the release
      // is `callReduce`'s, once the hold is due over a settled ear. A DROPPED final above never reaches
      // this: echo, noise or a TV must not hold the owner's turn open — it only answers its segment.
      const holdMs = sig.turnHoldMs ?? 0;
      // THE CAP JOIN OPENS (S7a, H4) on a TAKEN cap final — at ANY knob, 0 included: the hold is the
      // owner's sentence, not their pause, so it stands until the continuation's final (or its TTL). With
      // the knob on, the ordinary restart runs beside it; at 0 no clock is armed (no 0-ms timer — the seq
      // does not move).
      if (capCut)
        return {
          state: {
            ...taken,
            turnHold: true,
            capJoin: true,
            turnHoldDue: false,
            turnHoldMs: holdMs,
            turnHoldSeq: holdMs > 0 ? s.turnHoldSeq + 1 : s.turnHoldSeq,
          },
          out: [],
        };
      // Any other taken final ends a join (N-2) and the ordinary rule applies.
      const unjoined: CallState = taken.capJoin ? { ...taken, capJoin: false } : taken;
      if (holdMs > 0)
        return {
          state: {
            ...unjoined,
            turnHold: true,
            turnHoldDue: false,
            turnHoldSeq: s.turnHoldSeq + 1,
            turnHoldMs: holdMs,
          },
          out: [],
        };
      // At 0 a hold still standing is a join's (the knob opens none): this final ends the sentence, so the
      // hold is due — `callReduce` releases it once the ear settles (E-N3, R3-1: the LAST absorbed one).
      if (s.turnHold) return { state: { ...unjoined, turnHoldDue: true }, out: [] };
      return drain(unjoined);
    }

    case "barge":
      // THE GATE IS THE MOUTH, NOT THE PHASE (S3). A voice barge-in is the interruption of an AUDIBLE
      // reply (§4.3), so `thinking`/`listening` answer no (their `mouthLive` is false) — speech there
      // steers the live turn instead. The honest case the phase enum cannot express rides the same gate:
      // a reply still audible across a reconnect, where the screen says `connecting`.
      if (!s.mouthLive || s.killing) return { state: s, out: [] };
      return killNow(s);

    case "stop":
      // THE OWNER'S STOP (LIVE-001, D71 amendment №3). One kill per interruption, as ever. An audible
      // mouth is killed exactly as a barge kills it — whatever the phase says, the reconnect window
      // included. With no mouth, only `thinking` has something to stop: the turn itself while it still
      // streams (the POST, the reasoning, a tool call, text ahead of its first chunk). A ready reply the
      // mouth gate holds AFTER the turn settled is not reachable here — `turnSettled` has already moved
      // the phase to `listening` — and the tap stays inert until it becomes audible. It takes the SAME
      // ordered kill — `mouthLive` is already down, so no tail arms (nothing reached the car) and the ear
      // is never held by it; `killSettled` walks `thinking` → `listening` and drains what the owner said
      // meanwhile. `listening`/`connecting` stay inert: nothing to stop.
      if (s.killing) return { state: s, out: [] };
      if (s.mouthLive || s.phase === "thinking") return killNow(s);
      return { state: s, out: [] };

    case "playbackStarted": {
      // The transport spoke, so the flag lands FIRST and unconditionally — what the phase logic below
      // decides to do about it is a separate question (see `mouthLive`).
      // NO KILL (the owner's 2026-09-26 ruling on R86 LC-1 / R88 E-1): §4.2's iron rule is enforced
      // BEFORE this edge, at the controller's gate (`mouthMayOpen`), by waiting — so an automatic start
      // reaches here only over a settled ear, and one over an unsettled ear is the owner's own gesture
      // (a resume tap, a seek), which is theirs to make.
      const open = mouth(s, true);
      // THE RECONNECT OWNS THE PHASE while the leg is down (confirm round F1's survivor). `socketLost`
      // deliberately paints `connecting` over a live mouth and `playbackDrained` preserves it — an arm
      // that repainted `speaking` here would be the one voice disagreeing about who owns the screen
      // during a reconnect (and a kill settling after it would inherit the lie). The flag lands above;
      // `ready` is the arm that consults it.
      if (s.phase === "connecting") return { state: open, out: [] };
      return { state: { ...open, phase: "speaking" }, out: [] };
    }

    case "tailOver":
      // THE TAIL ENDS (D80 ①) — fenced twice: by the generation (the reduce's first line) and by the
      // ARMING, so a release measured for a tail that a new reply already replaced frees nothing.
      if (!s.tail || sig.seq !== s.tailSeq) return { state: s, out: [] };
      return { state: { ...s, tail: false }, out: [] };

    case "turnHoldOver":
      // THE PAUSE RAN OUT (ISS-55) — fenced like the tail's release: by the generation (the reduce's
      // first line) and by the ARMING, so a clock for a hold that a later final already restarted
      // releases nothing. The arm only marks it DUE: the release is `callReduce`'s, the one site that
      // reads the settled ear — a segment still open or owed holds it until that segment is answered.
      if (!s.turnHold || s.turnHoldDue || sig.seq !== s.turnHoldSeq) return { state: s, out: [] };
      return { state: { ...s, turnHoldDue: true }, out: [] };

    case "answerExpired": {
      // THE AWAITED HEAD OUTRAN ITS DEADLINE (S7a, §3.5 ⑨ — N-1). The relay answers every segment within
      // `timeout_s` of it reaching its serial worker, so an id still owed `answer_ttl_ms` after reaching the
      // head is an answer that is not coming: it leaves the set — the mouth may open — with a quiet note
      // (H8). Fenced by the head (a TTL for an id already answered, or behind a newer head, is a ghost) and
      // inert on a leg without the clock. A final that turns up later is a LATE final (R3-2): taken the
      // normal way if it carries text, its id settling nothing.
      if (s.answerTtlMs === null || s.awaiting[0] !== sig.itemId) return { state: s, out: [] };
      const expired: CallState = {
        ...s,
        awaiting: s.awaiting.slice(1),
        note: CALL_COPY.answerLate,
      };
      // …and a CAP JOIN waiting on it ends once nothing else is owed — no id left, no segment open (the
      // joined id's TTL is the cap hold's expiry, §3.5 ⑤). With a segment still open its own final ends it.
      const settledEar = expired.awaiting.length === 0 && !expired.userSpeechActive;
      return { state: settledEar ? dropJoin(expired) : expired, out: [] };
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
      // The ear-hold POLICY, taken ONCE from the track that actually opened (§5.1). It cannot be
      // re-decided later: `mic_hold` is read at call start like every other knob (§4.5 — settings edited
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
          holdMode: sig.holdMode,
          ecAll: sig.ecAll,
          note: sig.note ?? s.note,
          route: sig.route,
          ecOn: sig.ecOn ?? wantsAec(sig.route),
          inputDevice: sig.deviceId,
          // The fresh ear's `getUserMedia` has run, so comm mode is back on: the mouth may open again
          // (ISS-54 code round, Opus 1), and the poke after this reduce releases a start it held.
          sinkWait: false,
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
      // …and its mirror (ISS-54): entering comm mode re-routes the mouth's pooled MEDIA stream (ISS-54
      // design round F2) — the one move the note names — and ANY ear opened on the call route (a flip in,
      // or a device move within it) must wait the pool out before its context draws a stream (ISS-54
      // design round, Maya M2: a comm-device switch re-routes VOICE streams too).
      const entersComm = !s.ecOn && wantsAec(route);
      const freshSink = wantsAec(route);
      return {
        state: {
          ...freshEar(s),
          route,
          inputDevice: deviceId,
          // A new route gets its own one rebuild (ISS-54 design round, Maya M1): the bound is per route,
          // and this is the owner's own move, not the machine's loop.
          earRetried: false,
          // The mouth waits for the fresh ear's gUM on the call route (ISS-54 code round, Opus 1).
          sinkWait: freshSink && wantsAec(route),
          // ISS-54 design round F7 — the flip INTO call mode waits ~5.5 s in `connecting`, and the screen owes that an
          // explanation. Only that flip: a device move within the call route waits too but is not
          // "switching to call mode" (ISS-54 lane D2, RULINGS), and every other move keeps the line as it
          // was (the flip out has the picker's footer — owner ruling 2026-09-24).
          note: entersComm ? CALL_COPY.switchingRoute : s.note,
        },
        out: [{ type: "recapture", route, deviceId, leavesComm, freshSink }],
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
          // (Since Phase 26 D5 this whole arm is the COMPAT path: a relay that knows this tab's
          // `client_id` supersedes its own zombie instead of refusing it, so only a pre-D5 relay or an
          // id-less tab still lands here with this phone's own slot — see `RECONNECT_BACKOFF_MS`.)
          return { state: { ...s, note: CALL_COPY.busyRetrying }, out: [] };
        case "ear_failed":
          // THE NEW EAR'S WORKER FAILED (S7a — R2-1, N-6; §3.4 "behind is a failure"): the relay sends
          // this typed frame and then closes 1011, never a bare 1011. A NOTE-ONLY no-op, shaped like the
          // mid-ladder `busy` above and for its reason: the close is what the ONE `socketLost` arm
          // reconnects from (a fresh leg, the VAD reset), so one failure spends one rung — and falling to
          // the default here would land a TERMINAL before that close could redial. No gate: today's
          // relay never sends it.
          return { state: { ...s, note: CALL_COPY.earFailed }, out: [] };
        case "session_limit":
          // The relay's sentence IS the note here (unlike `protocol`'s diagnostics): the class now has
          // two causes — the hard session cap, and the uplink-idle reaper (R86 LC-8) — and both
          // messages are written for the owner. The copy is the fallback for a relay that sent none.
          return terminal(s, "ended", sig.message || CALL_COPY.limit);
        case "upstream_error":
          // The ONE code the relay keeps the session alive through — so the client must too.
          // …and it is what the ear sends INSTEAD of the final (R86 LC-2: Speaches publishes `error` and
          // never the `…completed` for a transcription that raised), so nothing is in flight any more.
          // A wait left standing would hold every reply at the mouth's door from here on. So it SETTLES
          // like the final it replaces (D9, design round Maya H1): with an id, that segment (and any
          // ahead of it); with none — the relay forwards none today — the whole set, the belt.
          // Only the wait: `userSpeechActive` may be a NEW segment, genuinely live. A final that does
          // turn up later is taken by its own arm regardless of the set, so the clear loses nothing.
          // On a leg with the clock the typed `asr_error` final came FIRST and already settled its id
          // (H6), so this settle finds nothing to move and the NOTE is the arm's whole effect.
          return {
            state: { ...settle(s, sig.itemId), note: sig.message || CALL_COPY.lost },
            out: [],
          };
        case "protocol":
          // The client and the relay disagreed about the wire. Since Phase 26 S2 the uplink allowance
          // covers every reservoir a legit client has (a stall's burst no longer trips it), so this is a
          // real client bug, and terminal is the honest answer. The relay's `message` is a diagnostic
          // sentence for the journal, not a line for the owner's screen, so this arm is the one place
          // the default's echo is refused.
          return terminal(s, "error", CALL_COPY.protocol);
        default:
          return terminal(s, "error", sig.message || CALL_COPY.lost);
      }

    case "serverEnded":
      // D5 — a newer leg of this tab took the relay's slot. A TERMINAL like every `ended` (never a
      // reconnect: a duplicated tab redialling would supersede the copy that superseded it, back and
      // forth until a ladder ran out), but it says why, because the owner did not hang up.
      if (sig.reason === "superseded") return terminal(s, "ended", CALL_COPY.superseded);
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

    case "earDead":
      // THE EAR THAT NEVER HEARD (ISS-54, R99 §3). NOT `earOutage`'s remedy: that redials the socket
      // over the SAME capture, which a frozen context survives and a render-error context does not —
      // the fresh leg would come up `ready` on a dead ear. The remedy is the route cycle's own: release
      // the ear and acquire a fresh one, after the output pool has let the dead context's stream go
      // (`freshSink`). Legal in EVERY non-terminal phase, `connecting` included: a death before `ready`
      // must not be lost, the generation move fences the leg in flight, and the effect clears a pending
      // reconnect and closes the socket.
      // ONE rebuild per route (ISS-54 design round, Maya M1): the ladder cannot bound this (`ready` resets
      // it before a watchdog can fire), so a second death on the same route is the micLost terminal —
      // the owner redials. A TAKEN final earns the rebuild back (the `final` arm, ISS-54 code round Opus 2).
      if (s.earRetried) return terminal(s, "error", CALL_COPY.micLost);
      return {
        state: {
          ...freshEar(s),
          note: CALL_COPY.earStalled,
          earRetried: true,
          sinkWait: wantsAec(s.route), // the effect's `freshSink` is always true here
        },
        out: [
          {
            type: "recapture",
            route: s.route,
            deviceId: s.inputDevice,
            leavesComm: false,
            freshSink: true,
          },
        ],
      };

    case "idleExpired":
      // A BACKGROUNDED CALL NOBODY IS IN (S6 ④). A clean `ended`, like the session limit and unlike a
      // failure — the mic being hot for ten minutes in a pocket is not an error, it is the thing this
      // ends. The wiring only ever arms the clock while hidden, so reaching here means exactly that.
      // …UNLESS SOMEONE IS STILL TALKING. The reply (R86 LC-6): a seamless chunked reply publishes no
      // status edge between chunks, so a long answer can outlast a short window. The owner (R88 E-2):
      // `speechStart` re-arms the clock once, but a sentence can outlast a short window, and a final can
      // still be in flight — ending there loses the utterance. The knob's contract is "no speech AND no
      // reply". A no-op here; the wiring re-arms on this very signal (`IDLE_EDGES`).
      // …and a TURN HOLD standing is the owner mid-thought (ISS-55, TH design round Opus L1): their
      // words are queued and seconds from going out, which is speech, not idleness.
      if (s.mouthLive || s.userSpeechActive || s.waitingFinal || s.turnHold)
        return { state: s, out: [] };
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

/** THE LEDGER'S BOUND (D80 ③): how many segments may be awaiting their final at once. Speaches runs one
 *  VAD segment at a time and transcribes each in ~0.3–0.5 s, so a healthy ear has one or two in flight;
 *  the bound exists for the segments that NEVER get a final (a transcription that errored sends
 *  `error` instead, R86 LC-2) — without it they would accumulate for the whole call. The oldest is
 *  evicted, and a final arriving for it later is unmeasured, the fail-open case. A property of the
 *  bookkeeping, not a preference: 16 is an order of magnitude past anything a live ear keeps open. */
const SEGMENT_CAP = 16;

/** One speech segment's evidence (D80 ③ — was the single-slot utterance EPOCH): the accrual the
 *  transcript gate reads, and the voice learner's samples, for ONE ear segment. */
interface Segment {
  /** ms of UPLINKED frames at or above the effective floor since this segment's speech-start
   *  (D76 §C.5), and the loudest of them, dBFS. */
  accruedMs: number;
  accruedPeak: number;
  /** The VOICE LEARNER's evidence for the same segment (D76 §C.3): every uplinked frame's level, and
   *  whether any of them arrived while the reply was audible. */
  utterance: UtteranceLevels;
}

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
  /** THE SEGMENT LEDGER (D80 ③) — every segment the machine ACCEPTED a start for whose final has not
   *  landed yet, keyed `${leg}:${item_id}` (`segmentKey`). It replaced a single EPOCH slot that
   *  whichever final landed next closed: Speaches emits `speech_started(B)` before `transcript(A)`
   *  routinely, so A was judged on B's empty accrual and B's final found nothing and failed OPEN — two
   *  of the car round's echoes walked in through that door (EVIDENCE Fact 3). Insertion-ordered, so the
   *  first key is the oldest (`SEGMENT_CAP`'s eviction). */
  segments: Map<string, Segment>;
  /** The segment frames accrue to RIGHT NOW — the one the ear has open (Silero is sequential: one at
   *  a time), `null` between a stop and the next start. Its `speech_stopped` FREEZES it: frames after
   *  the stop belong to nobody, never to a finished segment. */
  open: Segment | null;
  /** What the LAST final was judged on, kept for the debug block. `measured: false` is the fail-open
   *  signature — a final whose segment the ledger did not hold (D80 ③: an unknown id). */
  last: { accruedMs: number; peakDb: number; chars: number; measured: boolean } | null;
}

function newEarMeter(): EarMeter {
  return {
    db: null,
    peakDb: null,
    peakAt: 0,
    window: [],
    at: 0,
    hits: 0,
    segments: new Map(),
    open: null,
    last: null,
  };
}

/** A segment's ledger key: its LEG and the ear's `item_id`. The leg is in it because a reconnect is a
 *  fresh Speaches session whose ids share no namespace with the old one's. */
function segmentKey(leg: number, itemId: string): string {
  return `${leg}:${itemId}`;
}

/**
 * One frame, consumed ONCE. Everything below reads what this wrote.
 *
 * THE PARTITION (D76 §B.2): the level and its peak are every frame's; the open segment's accrual and
 * the learner's samples take only UPLINKED frames — a held frame is the reply leaking back in, and a
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
  const seg = m.open;
  if (seg === null || !uplinked) return;
  seg.utterance.samples.push(db);
  if (mouthLive) seg.utterance.duringPlayback = true;
  if (db >= floor) {
    seg.accruedMs += frameMs;
    if (db > seg.accruedPeak) seg.accruedPeak = db;
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

/** Open segment `key` — it takes the frames from here. The ledger stays bounded (`SEGMENT_CAP`). */
function openSegment(m: EarMeter, key: string): void {
  if (m.segments.size >= SEGMENT_CAP) {
    const oldest = m.segments.keys().next().value;
    if (oldest !== undefined) m.segments.delete(oldest);
  }
  const seg: Segment = {
    accruedMs: 0,
    accruedPeak: DBFS_SILENCE,
    utterance: { samples: [], duringPlayback: false },
  };
  m.segments.delete(key); // a re-used key re-inserts at the END, so eviction stays oldest-first
  m.segments.set(key, seg);
  m.open = seg;
}

/** THE SEGMENT'S EVIDENCE — the ONE reader for both judgements made on it (a `final`'s transcript
 *  gate, and the noise verdict on a segment still open): its accrual, or `undefined` when the ledger
 *  holds no segment under `key` — unmeasured, which no verdict is ever taken on. */
function segmentAccrual(m: EarMeter, key: string | null): number | undefined {
  return key === null ? undefined : m.segments.get(key)?.accruedMs;
}

/** Forget every segment — the ear they were measured on is gone or condemned. */
function clearSegments(m: EarMeter): void {
  m.segments.clear();
  m.open = null;
}

/** DID THIS STEP TAKE ITS FINAL — the accepted transition, read off the state diff and the effects,
 *  never a re-derivation of the arm's rules. Taken words either still sit in the queue (it grew — a hold
 *  standing, or a `speaking` reply holding it) or went out IN this step's submit, which then says MORE
 *  than the queue held before it: a DROPPED final's step can carry a submit too — a due hold's release
 *  (ISS-55), words judged long ago — and that one says exactly the old queue. The second half is what
 *  keeps a hold-0 CAP JOIN honest (S7a, G-8): the final that ends the join is taken AND releases in the
 *  same step, so the queue does not grow. Read by the voice learner (`meterEdge`) and the `turn` line. */
function queueTook(prev: CallState, next: CallState, out: readonly CallEffect[]): boolean {
  if (next.pending.length > prev.pending.length) return true;
  const before = prev.pending.join(PENDING_JOIN);
  return out.some((e) => e.type === "submit" && e.text !== before);
}

/**
 * THE METER'S EDGES, decided in ONE place — the `IDLE_EDGES` precedent, for the same reason: every
 * rule about what voids the ear's evidence is a rule about the SIGNAL that arrived, and a copy of it
 * inside each arm is a copy the next edge gets forgotten in.
 *
 * WHAT CLEARS WHAT, and why they are not the same set (S5 / review F2 → D80 ③):
 *  · the trigger's WINDOW clears on the mouth's rising edge, because the reply's own start transient
 *    is not the owner talking and must not pre-fill a window that is about to kill the reply;
 *  · a SEGMENT opens on an accepted speech-start that names its id, is FROZEN by its own stop, and is
 *    consumed by its own final — each keyed by the ear's `item_id`, never by arrival order;
 *  · the whole LEDGER clears wherever the evidence becomes unknowable — a mute, a leg that died, a leg
 *    that came up, the route cycle and the dead ear's rebuild (and the teardown);
 *  · and MUTE clears both, because "the ear is closed" has to mean it.
 *
 * RETURNS the closing segment's level evidence when the signal was a final the reducer TOOK (it
 * joined the queue or went out) — the voice learner's one input (D76 §C.3), keyed, like the segment
 * edges, on the ACCEPTED transition and never on a re-derivation of the arm's rules. `null` otherwise:
 * a final that was dropped (too quiet, muted, held, empty, echo) teaches nothing.
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
      // machine, and a segment opened for it would attribute the next frames to an utterance that,
      // as far as the call is concerned, never happened. The accepted transition is the state diff,
      // never a re-derivation of the arm's own eligibility rules. A start the relay named no id for
      // opens NOTHING (its final is then unmeasured — the fail-open case, D80 ③).
      if (next.userSpeechActive && !prev.userSpeechActive) {
        if (sig.itemId === undefined) m.open = null;
        else openSegment(m, segmentKey(leg, sig.itemId));
      }
      break;
    case "speechStop": {
      // Its stop FREEZES the segment (D80 ③): its evidence is complete, whatever the ear hears before
      // its final lands — the next segment's start, or its frames, are never this one's.
      const seg =
        sig.itemId === undefined ? undefined : m.segments.get(segmentKey(leg, sig.itemId));
      if (seg !== undefined && m.open === seg) m.open = null;
      break;
    }
    case "final": {
      const key = sig.itemId === undefined ? null : segmentKey(leg, sig.itemId);
      const seg = key === null ? undefined : m.segments.get(key);
      m.last = {
        accruedMs: seg?.accruedMs ?? 0,
        peakDb: seg?.accruedPeak ?? DBFS_SILENCE,
        chars: sig.text.trim().length,
        measured: seg !== undefined,
      };
      if (key !== null) m.segments.delete(key);
      if (seg !== undefined && m.open === seg) m.open = null;
      return queueTook(prev, next, out) && seg !== undefined ? seg.utterance : null;
    }
    case "playbackStarted":
      clearBarge(m);
      break;
    case "setMuted":
      clearBarge(m);
      clearSegments(m);
      break;
    case "ready":
    case "socketLost":
      clearSegments(m);
      break;
    case "routeChange":
      // Same F2 gate, other direction: a route change the reducer REFUSED (outside the stable
      // phases, or nothing moved) must not throw away evidence for an utterance that is still
      // live. An accepted cycle paints `connecting`, and that edge is the truth to key on.
      if (next.phase !== prev.phase) clearSegments(m);
      break;
    case "earDead":
      // …and the ISS-54 rebuild releases the ear the same way. It may land in `connecting`, where the
      // phase does not move, so the edge here is the generation: a stale death the fence dropped moved
      // nothing and voids nothing.
      if (next.gen !== prev.gen) clearSegments(m);
      break;
  }
  return null;
}

// ── THE TAIL'S RELEASE, measured (D80 ① · ⑦) ─────────────────────────────────────────────────────
//
// The reducer ARMS the tail when the mouth falls; the wiring decides when the reply has actually left
// the room. FIRST by what was MEASURED (wave 1.5): the connect chirp's lag sets a deadline, and a reply
// that never reached the mic has nothing to outwait (`tailPlan`). Only when nothing measured a leaking
// sink does the wave-1 QUIET rule run — on the ear's own frames (the `cueFramesLeft` precedent: frames
// ARE the ear's clock, so a frozen page cannot release a tail it never heard), and against the NOISE
// floor, never the effective floor: the owner's Sensitivity pin sat at −20 dBFS, inside the echo's own
// −11…−35 band, and "quiet" read against it called the echo quiet mid-sentence (R91 §4.3).

/** The knobs one tail release runs under — `LiveCfg`'s tail five, structurally (the wire type satisfies
 *  it). */
interface TailCfg {
  hold_tail_min_ms: number;
  tail_quiet_ms: number;
  tail_quiet_margin_db: number;
  hold_tail_max_ms: number;
  tail_lag_margin_ms: number;
}

/** A tail's release DEADLINE, chosen at its arming (D80 ⑦ as-built — wave 1.5), and the evidence behind
 *  it: `lag` = the connect chirp measured this sink, so the tail ends a known `lag + tail_lag_margin_ms`
 *  after the element did; `kill` = a tap with nothing measured (the owner is talking into it — the code
 *  round's O-HIGH), so it ends at the minimum; `noleak` = nothing measured, but nothing of this reply
 *  reached the microphone either, so there is nothing to wait for past the minimum. */
interface TailDeadline {
  ms: number;
  reason: "lag" | "noleak" | "kill";
}

/** One running release: which arming it is for (and under which generation), how long it has run, the
 *  contiguous quiet it has heard since the minimum (the fallback rule's count), and the plan it runs.
 *  Mutated in place per frame, like the meter. `lagMs`/`leakSeen` are the evidence the plan was chosen
 *  on, carried for the trail line. */
interface TailRun {
  seq: number;
  gen: number;
  elapsedMs: number;
  quietMs: number;
  /** The measured-or-decided deadline, or `null` = the quiet rule (the one case nothing measured). */
  deadline: TailDeadline | null;
  lagMs: number | null;
  leakSeen: boolean;
  leakMs: number;
}

/**
 * DID THIS REPLY REACH THE MIC (D80 ⑦ as-built — wave 1.5, its fix wave): the leak EVIDENCE of one reply,
 * accumulated on the frames while the mouth is live and read ONLY at a tail's arming, to choose its
 * release rule when the chirp measured nothing (`tailPlan`'s rule 3 vs 4). It is NOT the deleted leak
 * probe (D76 §B.3 → D80 ⑤): it never opens the ear during a reply and judges nothing per chunk — the ear
 * stays held for the whole reply either way.
 *
 *  · CUMULATIVE, not one frame (the fix wave's O-W15-HIGH): `ms` counts the frames that read ≥ the NOISE
 *    floor + `tail_quiet_margin_db` (the tail's own "not quiet" line — one definition of loud), and the
 *    reply counts as leaked at `ms ≥ tail_quiet_ms / 2` (`leaked`). A DERIVED threshold, not a knob: a
 *    sink that really leaks the reply fills it within the reply's first second (seconds of speech at the
 *    mic), while a cough, a clink or an "mm-hm" on earbuds the chirp cannot hear is a frame or two —
 *    and one frame used to send the tail back to the quiet rule, the whole-answer loss this slice ends.
 *    The OWNER talking over the reply for that long still counts — the safe direction, by design.
 *  · UNKNOWN IS LEAKED, at once (`unknown`): no noise estimate yet, or a MUTED frame (digital silence,
 *    which proves nothing) — the safe branch.
 *  · KEYED BY THE REPLY (the fix wave's M-W15-MED): `replyId` is the chat store's last assistant message
 *    at the mouth's rising edge — the same identity the text backstop reads — so a pause/resume or a
 *    stall's re-fire INSIDE one reply keeps its evidence; only a different reply starts over. (An
 *    assistant message's id is fixed before any of it can be spoken: `message.start` adopts the
 *    server's id before the first text delta, and nothing rewrites it after. A `null` id — no reply in
 *    the store — is no identity at all, so it starts over every time, the pre-fix rule.)
 */
interface LeakEvidence {
  replyId: string | null;
  ms: number;
  unknown: boolean;
}

function newLeak(replyId: string | null): LeakEvidence {
  return { replyId, ms: 0, unknown: false };
}

/** One frame of a live mouth into the evidence (mutated in place, like the meter). */
function leakFrame(
  e: LeakEvidence,
  db: number,
  noise: number | null,
  muted: boolean,
  frameMs: number,
  marginDb: number,
): void {
  if (noise === null || muted) e.unknown = true;
  else if (db >= noise + marginDb) e.ms += frameMs;
}

/** Has this reply leaked, by the evidence — see `LeakEvidence`. */
function leaked(e: LeakEvidence, cfg: TailCfg): boolean {
  return e.unknown || e.ms >= cfg.tail_quiet_ms / 2;
}

/** Why a tail ended (D80 ①/⑦): its deadline (`lag`/`noleak`/`kill`), heard quiet, or ran out its cap. */
type TailReason = TailDeadline["reason"] | "quiet" | "cap";

/**
 * THE TAIL'S RELEASE RULE, chosen at its ARMING by the evidence there is, in this order (D80 ⑦ as-built,
 * the owner's "fix those issues forever"):
 *
 *  1. the connect CHIRP measured this sink (`lagMs` known) ⇒ a DEADLINE at `lagMs + tail_lag_margin_ms`
 *     — whatever the meter hears, so an owner who answers at once (or taps and talks) is no longer held
 *     whole: quiet was only ever a PROXY for this number (R93 §V; the margin covers lag jitter and the
 *     ear's own 135–271 ms reporting delay). A kill uses it too: what a tap leaves in the sink's buffer
 *     is at most one lag.
 *  2. no lag, and a KILL ⇒ the minimum (`kill` — fix wave 1's rule; kept distinct in the trail).
 *  3. no lag, and nothing of this reply reached the mic (`!leakSeen`) ⇒ the minimum (`noleak`): there is
 *     no echo to outwait.
 *  4. no lag, and the reply DID leak (or leaking could not be judged) ⇒ `null`: the wave-1 QUIET rule —
 *     the fallback for a sink that leaks and was never measured (a head unit that clipped the chirp).
 *
 * Every deadline is floored at `hold_tail_min_ms` (a loudspeaker's 40 ms lag still holds the minimum);
 * the cap still bounds everything (`tailStep`). A chirp whose window has not CONCLUDED when a tail arms (a
 * reply that drains within ~6 s of the capture) is "no lag" for that tail; the next one reads the verdict.
 */
function tailPlan(
  killed: boolean,
  lagMs: number | null,
  leakSeen: boolean,
  cfg: TailCfg,
): TailDeadline | null {
  if (lagMs !== null)
    return {
      ms: Math.max(cfg.hold_tail_min_ms, lagMs + cfg.tail_lag_margin_ms),
      reason: "lag",
    };
  if (killed) return { ms: cfg.hold_tail_min_ms, reason: "kill" };
  if (!leakSeen) return { ms: cfg.hold_tail_min_ms, reason: "noleak" };
  return null;
}

/**
 * One frame into a running tail release; the reason it ends ON this frame, or `null`.
 *
 * A tail with a DEADLINE (`tailPlan`'s rules 1–3) ends at it — its own reason — whatever the meter hears;
 * a deadline past `hold_tail_max_ms` ends at the cap instead (`cap`). Otherwise, the QUIET rule (rule 4):
 *
 *  1. nothing before `hold_tail_min_ms` — a headphone or loudspeaker sink still lags the element by a
 *     few hundred ms (R91 §J3 (i));
 *  2. then CONTIGUOUS frames below `noise + tail_quiet_margin_db`: `tail_quiet_ms` of them is `quiet`
 *     (700 ms bridges 97 % of the pauses inside a reply, R91 §4.2 — a shorter run would reopen the ear
 *     between two of its sentences). A MUTED frame is digital silence and proves nothing about the
 *     room, so it breaks the run; with no noise estimate yet there is nothing to be quiet against, and
 *     only the cap can end it;
 *  3. `hold_tail_max_ms` after the arming ends it regardless — `cap` (a cabin louder than its own
 *     margin, or an owner who started talking into the tail; the text backstop is the belt there).
 */
function tailStep(
  run: TailRun,
  db: number,
  noise: number | null,
  muted: boolean,
  frameMs: number,
  cfg: TailCfg,
): TailReason | null {
  const from = run.elapsedMs; // where THIS frame starts, after the arming
  run.elapsedMs += frameMs;
  const d = run.deadline;
  if (d !== null) {
    if (d.ms > cfg.hold_tail_max_ms) return run.elapsedMs >= cfg.hold_tail_max_ms ? "cap" : null;
    return run.elapsedMs >= d.ms ? d.reason : null;
  }
  if (from >= cfg.hold_tail_min_ms) {
    const quiet = noise !== null && !muted && db < noise + cfg.tail_quiet_margin_db;
    run.quietMs = quiet ? run.quietMs + frameMs : 0;
    if (run.quietMs >= cfg.tail_quiet_ms) return "quiet";
  }
  return run.elapsedMs >= cfg.hold_tail_max_ms ? "cap" : null;
}

/** Why the ear-hold just moved, for the trail's `hold` line (D80 ①): what closed it (the reply — or a
 *  tail, which only ever arms under a hold already standing), or what opened it (the tail's release,
 *  or the policy itself letting go — a route cycle, a terminal). */
function holdWhy(sig: CallSignal, next: CallState): "mouth" | "tail" | "policy" {
  if (next.earHeld) return next.mouthLive ? "mouth" : "tail";
  return sig.type === "tailOver" ? "tail" : "policy";
}

/** Why the TURN HOLD just moved, for the trail's `turn` line (ISS-55): a taken final opened or
 *  restarted it; its clock ran out over an ear still owed (`due`); or it let go — at its clock's
 *  `expiry` over a settled ear, once a due hold's ear `settle`d, on a lost `leg`, on a fresh ear (a
 *  `route` cycle or an `earDead` rebuild — both move the generation) or at a `terminal`. S7a adds two:
 *  a `max_segment` final opened or continued a CAP JOIN (`join`), an awaited head's TTL moved it
 *  (`ttl` — the join let go, or the hold released over the ear the expiry settled), and — the review's
 *  LOW-1 — a join let go while the hold STILL STANDS (`unjoin`: a mute or a dropped final mid-join; with
 *  the knob on, the hold's own clock decides from there). */
function turnWhy(
  sig: CallSignal,
  prev: CallState,
  next: CallState,
):
  | "open"
  | "restart"
  | "due"
  | "expiry"
  | "settle"
  | "leg"
  | "route"
  | "terminal"
  | "join"
  | "ttl"
  | "unjoin" {
  if (sig.type === "final" && next.capJoin) return "join";
  if (sig.type === "answerExpired") return "ttl";
  if (!prev.turnHold) return "open";
  if (next.turnHold) {
    if (next.turnHoldSeq !== prev.turnHoldSeq) return "restart";
    return prev.capJoin && !next.capJoin ? "unjoin" : "due";
  }
  if (isTerminal(next.phase)) return "terminal";
  if (sig.type === "turnHoldOver") return "expiry";
  if (sig.type === "socketLost") return "leg";
  if (next.gen !== prev.gen) return "route";
  return "settle";
}

// ── THE RELATIVE GATE'S STATE (D76 §C) ───────────────────────────────────────────────────────────
//
// The estimators the effective floor is computed from, and the owner's per-call pin. Measurements, so
// they ride a ref beside the meter (the D74 S7 rule) — nothing renders off them; the readouts sample.

interface GateState {
  /** The gate's knobs, taken from the acquisition that opened the current capture (§4.5 — read at
   *  call start). `null` before any acquisition: there is no floor to compute without them. */
  cfg:
    | (GateCfg &
        TailCfg & {
          playback_margin_db: number;
          min_final_ms?: number;
          noise_verdict_ms?: number;
          echo_window_ms: number;
        })
    | null;
  noise: NoiseTracker;
  /** The owner's learned voice level on THIS capture's device, dBFS — seeded from `store/voiceLevels`
   *  when the capture opens, learned from accepted finals, written back when it is released. */
  voiceLevel: number | null;
  /** …and the key it is stored under (`voiceDeviceKey`: the device × the granted echo mode), `null`
   *  when the capture names no device. */
  voiceKey: string | null;
  /** ANOTHER key's level, borrowed when this capture's own key has none (D8, `borrowVoiceLevel`) — a
   *  provisional floor term until `voiceLevel` is known. Never fed to the learner, never written back:
   *  `learnVoice` and `persistVoice` read `voiceLevel` alone. */
  voiceSeed: BorrowedVoiceLevel | null;
  /** The owner's MANUAL floor for this call, dBFS (S1's control sets it; `setFloorPin`), or `null` =
   *  Auto. Per call, never written anywhere — Discord's shape (D76 §C.7). */
  pin: number | null;
}

function newGateState(): GateState {
  return {
    cfg: null,
    noise: newNoiseTracker(),
    voiceLevel: null,
    voiceKey: null,
    voiceSeed: null,
    pin: null,
  };
}

/** What the gate's floor is computed from right now (`lib/levelGate`'s `FloorInputs`). */
function floorInputs(g: GateState, cfg: GateCfg): FloorInputs {
  return {
    noise: g.noise.floor,
    settled: g.noise.settled,
    voiceLevel: g.voiceLevel,
    voiceSeed: g.voiceSeed?.dbfs ?? null,
    cfg,
  };
}

/** THE effective floor right now under `cfg` (D76 §C.4 — `autoFloor` holds the truth table). The
 *  ONE place the hook asks; every consumer reads its answer. */
function gateFloor(g: GateState, cfg: GateCfg): number {
  return effectiveFloor({ ...floorInputs(g, cfg), pin: g.pin });
}

/** …and the highest a pin may go right now (D80 ⑤ → the code round's O-MED-1): the same inputs, the
 *  same module, so the Sensitivity column's top and the floor the gate applies cannot disagree. */
function gateCeiling(g: GateState, cfg: GateCfg): number {
  return pinCeiling(floorInputs(g, cfg));
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
  /** …and the flags the arming decision produced, rendered TOGETHER on purpose: whether voice can
   *  interrupt, whether the ear is closed right now, and whether the mouth is audible. */
  bargeArmed: boolean;
  earHeld: boolean;
  /** …and whether that hold is the reply's TAIL (D80 ①) — the element is done, the room may not be. */
  tail: boolean;
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
  /** …and the key that level is stored under (S3b: device × granted echo mode), `null` = unnamed. */
  voiceKey: string | null;
  /** …and what the last final was judged on (S5), its peak in dBFS. `measured: false` is the fail-open
   *  signature — a final whose segment the ledger did not hold (D80 ③). */
  lastFinal: { accruedMs: number; peakDb: number; chars: number; measured: boolean } | null;
  /** THE CONNECT CHIRP's verdict on this capture (D80 ⑦): the output path's measured lag (ms, `null` =
   *  no return), with the correlation peak and the runner-up — what the owner's car card compares with
   *  each reply's measured tail. `null` until the matcher's window has closed (or with `chirp` off). */
  chirp: ChirpResult | null;
  /** THE LAST TAIL (D80 ⑦ as-built): the rule it was armed with (`lag`/`noleak`/`kill`, or `quiet` =
   *  the fallback) and its deadline in ms after the arming (`null` on the quiet rule), then — once it
   *  ended — why and when. `null` before the first tail. */
  lastTail: {
    rule: TailDeadline["reason"] | "quiet";
    deadlineMs: number | null;
    reason?: TailReason;
    ms?: number;
  } | null;
  /** THE TURN HOLD standing right now (ISS-55): which arming, and whether its pause has run out over an
   *  ear still owed something. `null` when none stands (always, with `turn_hold_ms` at 0). */
  /** …`join` while a CAP JOIN stands (S7a, §3.5 ⑤) — absent otherwise. */
  turnHold: { seq: number; due: boolean; join?: true } | null;
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
  /** THE TAIL (D80 ①): the element has finished but the reply may still be playing out of the car —
   *  the overlay keeps showing the speaking face over `listening` while it holds. */
  tail: boolean;
  /** THE OWNER'S STOP — the tap outside the control cluster (§4.3 trigger B, LIVE-001): speaking kills
   *  the reply, thinking cancels the turn, anywhere else it is inert. The machine owns that rule. */
  stop: () => void;
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
   *  dBFS (`null` before the first frame / before the knobs), and — D80 ⑤ — the highest a pin may go
   *  right now (`pinCeiling`: `max_dbfs`, lowered to the learned voice − its margin once that is known,
   *  never below the Auto floor).
   *  A READER, not a field: the numbers move at 25–50 Hz and ride refs (the D74 S7 rule), so a value on
   *  this view would be as stale as the last render. The meter polls it at its own tick. */
  readLevel: () => { level: number | null; floor: number | null; ceiling: number | null };
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
  /** The call's screen lock (`lib/wakeLock` — its own `WakeLockState`, never dictation's: two holders
   *  are two sentinels, T-12). One request in flight at a time (A1) is the state's `pending`. */
  const wakeLock = useRef(newWakeLockState());
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
  /** …and what those drops came to, for the trail (T6 — see `UplinkDrops`). Per leg, like the pacer:
   *  made with it in `openLeg`, closed out where the leg ends (`endUplinkLeg`). */
  const uplinkDrops = useRef<UplinkDrops | null>(null);
  /** How many more FRAMES the DROP CUE is audible for — frames inside the window ride up as silence, so
   *  the tone the owner hears cannot be heard by the EAR on a route without a canceller (the S0b code
   *  round: a cue that reaches the relay is a new quiet final, which drops, which cues…). Counted in
   *  frames, not wall-clock, for the liveness stamp's reason: frames ARE the ear's clock — a window
   *  that ran on `performance.now()` would expire unheard across a freeze. 0 = no cue playing.
   *  Wiring-owned, like `overflowed`: it is about what this capture sends. */
  const cueFramesLeft = useRef(0);
  /** THE TAIL'S RELEASE, running (D80 ①) — armed by `send` on the reducer's rising `tail` edge, stepped
   *  by the frame handler, dropped the moment the machine says the tail is over. Wiring-owned, by the
   *  meter's split: the frames are a measurement, the reducer gets the decision (`tailOver`). */
  const tailRun = useRef<TailRun | null>(null);
  /** …and the last one's plan and outcome, for the debug block. */
  const lastTail = useRef<CallDebug["lastTail"]>(null);
  /** THE CURRENT REPLY'S LEAK EVIDENCE (`LeakEvidence`, D80 ⑦ as-built): re-keyed at the mouth's rising
   *  edge, fed by the frame handler while the mouth is live, read at a tail's arming. */
  const leak = useRef<LeakEvidence>(newLeak(null));
  /** THE TEXT BACKSTOP'S WINDOW (D80 ②), on `performance.now()`: a final arriving at or before this
   *  instant is compared with the reply's spoken words. Opened (to +∞) when the mouth falls into a tail,
   *  closed to the tail's release + `echo_window_ms` when the tail ends (or to the fall + that window
   *  when no tail was armed), shut when the next reply starts. −∞ = no window. A wall clock, not the
   *  frames': what it bounds is when a TRANSCRIPT lands, and transcripts arrive on the socket. */
  const echoUntil = useRef(-Infinity);
  /** THE CONNECT CHIRP's matcher (D80 ⑦) — alive from the chirp's scheduling until its window closes,
   *  fed EVERY frame of the capture that played it (held, muted or masked alike: it is looking for our
   *  own sound). One per capture; a route cycle's recapture replaces it with its own. */
  const chirp = useRef<ChirpMatcher | null>(null);
  /** …and its verdict, for the debug block. */
  const lastChirp = useRef<ChirpResult | null>(null);
  /** THE RE-CHIRP after a mid-call `devicechange` (see `RECHIRP_SETTLE_MS`) — one pending timer. */
  const rechirpTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  /** THE CALL TRAIL (D77) — `null` unless `voice.live.debug` is on, so every site below is a
   *  `trail.current?.push(…)` that costs nothing in the shipped default. The id is minted ONCE per
   *  instance (lazily, and only for a debug call): a reconnect, a route cycle or StrictMode's re-run
   *  keeps it — `gen` and `leg` move, the call does not — while a redial mounts a fresh instance, which
   *  IS a new call. The sampler is the 1 Hz `sample` clock, capture-ready to terminal. */
  const callId = useRef<string | null>(null);
  const trail = useRef<CallTrail | null>(null);
  const trailSampler = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  /** THE NOISE VERDICT's clock (the owner's 2026-09-26 ruling) — ONE timer, armed on an ACCEPTED
   *  speech-start and living exactly as long as the segment it judges: `send` clears it the moment the
   *  machine says no segment is open (a stop, a mute, a lost or fresh leg, a route cycle, a terminal). */
  const noiseTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  /** THE TURN HOLD's clock (ISS-55) — ONE timer, armed by `send` on the reducer's arming edge (a new
   *  `turnHoldSeq` with the hold up) and dropped the moment the hold falls or the call tears down. */
  const turnHoldTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  /** …and the KNOB it runs on (`turn_hold_ms` — not the state's per-arming `turnHoldMs`, which the
   *  `final` arm copies from the signal this stamps), LATCHED at call start with `bg` (§4.5 — a setting edited mid-call
   *  applies to the next call). Not read off the leg's `knobs` like `min_final_ms`: those are the query
   *  result the leg was opened under, and a reconnect after a `/voice/status` refetch opens its leg
   *  under the NEW one — a hold whose length moved between two pauses of one call would be a hold the
   *  owner cannot reason about. 0 = off, and it stays 0 until the knobs arrive. */
  const holdKnob = useRef(0);
  /** THE AWAITED HEAD'S TTL (S7a, §3.5 ⑨ — G-3) — ONE timer, armed by `send` on the reducer's edge where
   *  the head of the D9 set changes on a leg with the clock, for `answerTtlMs`; replaced by the next head,
   *  dropped when the set empties or the call tears down. The turn-hold clock's state-edge pattern. */
  const answerTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  /** …and the ids it EXPIRED, by `segmentKey(leg, id)`, so a final that turns up for one later is
   *  stamped `late` (R3-2 — the trail's `late_finals`). Bounded like the segment ledger (`SEGMENT_CAP`,
   *  oldest evicted): a healthy relay expires none, and a sick one must not grow it for a whole call. */
  const expiredIds = useRef(new Set<string>());

  /** THE LEG'S DROP TOTALS (T6), written once where the leg ends — a fresh leg (`openLeg`, BEFORE the
   *  leg number moves, so the line is stamped with the leg it describes), a route cycle, the trail's own
   *  end — and then forgotten. Idempotent: a second caller finds nothing. */
  const endUplinkLeg = useCallback((): void => {
    const d = uplinkDrops.current;
    uplinkDrops.current = null;
    if (d) trail.current?.push("uplink", { leg_drops: d.total, leg_bursts: d.bursts });
  }, []);

  /** The trail's end — its last flush rides `keepalive`, then it stops. Idempotent: the terminal edge
   *  and the unmount both call it, and whichever comes second finds nothing. */
  const endTrail = useCallback((): void => {
    endUplinkLeg(); // the live leg's totals, before the last flush
    clearInterval(trailSampler.current);
    trailSampler.current = undefined;
    trail.current?.flush("end");
    trail.current?.dispose();
    trail.current = null;
  }, [endUplinkLeg]);

  /** THE READBACK RECORD (D74 S7), built in ONE place: the debug block renders it every
   *  `DEBUG_TICK_MS` and the call trail samples its moving fields every `TRAIL_SAMPLE_MS` (D77) — one
   *  field list, two readers. A READER over refs, never state: the numbers move at 25–50 Hz. */
  const readDebug = useCallback((): CallDebug => {
    const cap = capture.current;
    const m = meter.current;
    const s = ref.current;
    const g = gate.current;
    return {
      ecSettings: cap?.readback.echoCancellation,
      ecCapabilities: cap?.readback.echoCapabilities,
      route: s.route,
      micHold: knobs?.mic_hold ?? "",
      bargeArmed: bargeArmed.current,
      earHeld: s.earHeld,
      tail: s.tail,
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
      voiceKey: g.voiceKey,
      lastFinal: m.last,
      chirp: lastChirp.current,
      lastTail: lastTail.current,
      turnHold: s.turnHold
        ? { seq: s.turnHoldSeq, due: s.turnHoldDue, ...(s.capJoin ? { join: true as const } : {}) }
        : null,
    };
  }, [knobs]);

  /** Release EVERYTHING, on every exit path (§6's "hang up = immediate full teardown"). Idempotent. */
  const teardown = useCallback((): void => {
    clearTimeout(retryTimer.current);
    clearTimeout(degradeTimer.current);
    clearTimeout(idleTimer.current);
    clearTimeout(noiseTimer.current);
    clearTimeout(rechirpTimer.current);
    clearTimeout(turnHoldTimer.current);
    clearTimeout(answerTimer.current);
    expiredIds.current.clear();
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
    endUplinkLeg(); // …and its drop totals (already written by the trail's own end, on a terminal)
    // What this call learned about the owner's voice outlives it, on this device (D76 §C.3).
    persistVoice(gate.current);
    capture.current?.stop();
    capture.current = null;
    chirp.current = null; // …and so is the chirp's, if its window was still open
    lastChirp.current = null; // …and what it measured: the next call's capture measures its own sink
    leak.current = newLeak(null);
    clearSegments(meter.current); // the ledger's evidence is about an ear that is gone (D80 ③)
    dismiss(); // an ended call does not keep talking
    setCallVoice(false, false);
    setCallPrePlay(null); // the pre-play tap dies with the capture it closes over
    setCallMouthGate(null); // …and the mouth's gate, with whatever start it was holding (nothing runs)
    releaseWakeLock(wakeLock.current);
  }, [endUplinkLeg]);

  /** `openLeg` needs `send` (its frames drive the machine) and `send` needs `openLeg` (a reconnect
   *  effect opens one), so one of the two rides a ref. Assigned during render — the latch-ref idiom
   *  `LineComposer` uses — and only ever read from a timer, long after this render is done. */
  const openLegRef = useRef<() => void>(() => {});
  /** …and the same knot, tied the same way, for the idle clock: `send` re-arms it on the activity
   *  edges and the clock's own expiry sends. Assigned during render, read only from inside callbacks. */
  const armIdleRef = useRef<() => void>(() => {});
  /** …and once more for THE ACQUISITION (D74 S2): `send` runs the `recapture` effect, and `acquire`
   *  needs `openLeg`, which needs `send`. Same latch-ref idiom, same read-only-from-a-callback rule. */
  const acquireRef = useRef<(req: MicRequest, alive: () => boolean, notBefore?: number) => void>(
    () => {},
  );

  const send = useCallback(
    function send(sig: CallSignal): void {
      const prev = ref.current;
      const { state: next, out } = callReduce(prev, sig);
      if (next !== ref.current) {
        ref.current = next;
        setState(next);
      }
      // THE TRAIL'S ONE HOOK (D77): every signal passes here, so every signal is a line — BEFORE the
      // effects run, so a re-entrant signal an effect sends lands after the one that caused it. A
      // terminal ends the trail on the same edge (the redial is a fresh instance, a fresh call).
      trail.current?.push("sig", trailSig(sig, prev, next));
      // EVERY EDGE OF THE EAR-HOLD is a line (D80 ①): what closed it and what opened it — the car
      // round's whole diagnosis was hold timing read off 1 Hz samples; the edges are exact.
      if (prev.earHeld !== next.earHeld)
        trail.current?.push("hold", { held: next.earHeld, why: holdWhy(sig, next) });
      // …and EVERY EDGE OF THE TURN HOLD (ISS-55), on its own line: `hold` means the EAR's edges, and
      // the car card's readers key on it. `seq` is the arming the edge is about (a fall reports the one
      // that fell — `hidden`'s reset would otherwise read 0), `n` the queued segments it carries (a
      // fall: the ones it let go — whether they went out is the `sig` line's phase move beside it).
      // A hold that was never up moves nothing worth a line (`hidden`/`unmounted` reset the seq).
      // …and a CAP JOIN's edges (S7a): `join` rides the line while one stands — absent otherwise, so a
      // leg without the clock writes today's line byte for byte.
      if (
        prev.turnHold !== next.turnHold ||
        (next.turnHold &&
          (prev.turnHoldSeq !== next.turnHoldSeq ||
            prev.turnHoldDue !== next.turnHoldDue ||
            prev.capJoin !== next.capJoin))
      )
        trail.current?.push("turn", {
          held: next.turnHold,
          why: turnWhy(sig, prev, next),
          seq: next.turnHold ? next.turnHoldSeq : prev.turnHoldSeq,
          // a fall counts the words it let go — the releasing final's own too, when it was taken in the
          // same step (a hold-0 cap join's end, S7a)
          n: next.turnHold
            ? next.pending.length
            : prev.pending.length + (sig.type === "final" && queueTook(prev, next, out) ? 1 : 0),
          ...(next.capJoin ? { join: true } : {}),
        });
      // THE TURN HOLD'S CLOCK (ISS-55) arms on the reducer's arming — a new `turnHoldSeq` with the
      // hold up, an open or a taken final's restart — replacing whatever was counting, and dies the
      // moment the hold falls: the tail's state-edge pattern, so no effect has to say when.
      // A plain `setTimeout`, deliberately, with no visibility reconcile (the `degradeHold` timer has
      // none either; TH design round, Maya M2 ruled): it is armed from a socket message, never chained
      // from another timer, so Chrome's intensive throttling — which only bites chained timers — does
      // not apply; a hidden page aligns it to the 1 Hz wake-ups (at most ~1 s late), a frozen one runs
      // it the moment it unfreezes, and an ear that froze through the pause goes `earOutage` →
      // `socketLost`, which releases the hold on its own.
      if (next.turnHold && next.turnHoldSeq !== prev.turnHoldSeq) {
        clearTimeout(turnHoldTimer.current);
        const seq = next.turnHoldSeq;
        const gen = next.gen;
        turnHoldTimer.current = setTimeout(
          () => send({ type: "turnHoldOver", seq, gen }),
          next.turnHoldMs,
        );
      } else if (!next.turnHold) clearTimeout(turnHoldTimer.current);
      // THE AWAITED HEAD'S TTL (S7a, §3.5 ⑨) — timed from the id reaching the HEAD of the D9 set (the
      // relay's serial worker only starts it then), so it arms on every edge where the head changes and
      // dies with the set; on a leg without the clock there is no head to time (`answerTtlMs` null —
      // inert). Plain `setTimeout`, for the turn-hold clock's reasons: armed from a socket message, never
      // chained, and a frozen ear goes `earOutage` → `socketLost`, which clears the set on its own.
      const head = next.answerTtlMs === null ? undefined : next.awaiting[0];
      const prevHead = prev.answerTtlMs === null ? undefined : prev.awaiting[0];
      if (head !== prevHead) {
        clearTimeout(answerTimer.current);
        if (head !== undefined && next.answerTtlMs !== null) {
          const gen = next.gen;
          const key = segmentKey(legSeq.current, head);
          answerTimer.current = setTimeout(() => {
            const before = ref.current.awaiting;
            send({ type: "answerExpired", itemId: head, gen });
            // Remembered only when the reducer TOOK it (the head still was this id), bounded.
            if (ref.current.awaiting !== before) {
              const ids = expiredIds.current;
              if (ids.size >= SEGMENT_CAP) ids.delete(ids.values().next().value as string);
              ids.add(key);
            }
          }, next.answerTtlMs);
        }
      }
      // THE TAIL'S RELEASE ARMS on the reducer's arming (a new `tailSeq` with the tail up), and dies the
      // moment the machine says the tail is over — a rising mouth, a route cycle, a terminal, its own
      // `tailOver`. One run at a time: a fresh arming replaces whatever was still counting.
      // Its RULE is chosen here, once, by the evidence there is (`tailPlan`): the chirp's measured lag,
      // whether the KILL itself armed it (the step where `killing` went up is the one `killNow` took —
      // the mouth's fall and the kill land in the same reduce), and whether this reply reached the mic.
      // (No knobs yet is unreachable — a tail arms only under a capture's policy, and the acquisition
      // latched them first — and it would fall back to the quiet rule rather than leave a tail unarmed.)
      if (next.tail && next.tailSeq !== prev.tailSeq) {
        const cfg = gate.current.cfg;
        const lagMs = lastChirp.current?.lagMs ?? null;
        const killed = next.killing && !prev.killing;
        const leakSeen = cfg ? leaked(leak.current, cfg) : true;
        const deadline = cfg ? tailPlan(killed, lagMs, leakSeen, cfg) : null;
        tailRun.current = {
          seq: next.tailSeq,
          gen: next.gen,
          elapsedMs: 0,
          quietMs: 0,
          deadline,
          lagMs,
          leakSeen,
          leakMs: leak.current.ms,
        };
        lastTail.current = { rule: deadline?.reason ?? "quiet", deadlineMs: deadline?.ms ?? null };
      } else if (!next.tail) tailRun.current = null;
      // A NEW REPLY is a new question for the leak evidence; the SAME reply resuming (a pause, a stall)
      // keeps what its first half showed. One read of the store at the edge, no subscription.
      if (!prev.mouthLive && next.mouthLive) {
        const replyId = lastReply()?.id ?? null;
        if (replyId === null || replyId !== leak.current.replyId) leak.current = newLeak(replyId);
      }
      // THE TEXT BACKSTOP'S WINDOW (D80 ②) follows the same two edges: from the mouth's LAST fall
      // (drain, failure, kill) through the tail's release, plus `echo_window_ms` — the echo's final
      // lands ~0.4 s after its own stop, and that stop comes `silence_ms` after the audible end (R91 §6).
      // A reply starting closes it: only the CURRENT reply is ever compared.
      const echoMs = gate.current.cfg?.echo_window_ms ?? 0;
      if (!prev.mouthLive && next.mouthLive) echoUntil.current = -Infinity;
      else if (prev.mouthLive && !next.mouthLive)
        echoUntil.current = next.tail ? Infinity : performance.now() + echoMs;
      else if (prev.tail && !next.tail && !next.mouthLive)
        echoUntil.current = performance.now() + echoMs;
      if (!isTerminal(prev.phase) && isTerminal(next.phase)) endTrail();
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
            const turn = getLiveTurn();
            // ① the audible part stops NOW — synchronous, before anything is awaited — and the rest of
            //    THIS TURN stays silent (LIVE-001): a thinking stop lands before anything docked, so the
            //    feeder's undock latch never arms and the cancelled turn's idle edge would read its
            //    partial aloud "like a Stop". `dismissTurn` bumps the controller's turn-stop count, which
            //    the feeder reads as the same latch — keyed to the TURN, so neither the placeholder's
            //    rename on `message.start` nor a second round's message id escapes it.
            dismissTurn();
            buzz(KILL_BUZZ_MS);
            // The trail's `sig` line already carries `stop`/`barge` with its phase; this is the detail.
            // `live` separates "no live turn, nothing to cancel" from "live but not yet scoped" (a null
            // `turnId`) — the two cases residual ① turns on.
            trail.current?.push("kill", {
              turn: turn?.turnId ?? null,
              live: turn !== null,
              phase: next.phase,
            });
            // ② the scoped cancel, AND its settlement. `discard` because the steer this cancel harvests
            //    is the owner's own call-origin speech, which they are in the middle of replacing — and
            //    a stopped THINKING turn is one they re-say, not one they edit.
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
            // first (its close STARTS the relay's slot release — which lands only once the close has
            // crossed Serve and the upstream teardown has run, so the redial below CAN be refused
            // `busy` by our own leg; the reducer's `priorLeg: true` is what makes that refusal a
            // retry, not a terminal — R86 LC-4), then the leg's pacer, then the ear.
            const gen = ref.current.gen;
            // ISS-18 (R81): the mouth's next reply must open a FRESH output stream once comm mode is
            // left — told BEFORE the ear is released, so a silent mouth is unloaded and its 5 s starts
            // alongside the redial rather than after it. …and on every FRESH-SINK recapture (ISS-54 code
            // round, Maya M1) ON THE CALL ROUTE: the wait leaves comm mode and the fresh ear's gUM
            // re-enters it, so whatever the mouth pooled is re-routed; the reducer's `sinkWait` keeps the
            // mouth shut until that gUM, and this makes its next `src` a fresh stream. A media-route
            // fresh sink (an `earDead` there) re-routes nothing, so it re-tags nothing (confirm round).
            if (eff.leavesComm || (eff.freshSink && wantsAec(eff.route))) markStreamRetag();
            clearTimeout(retryTimer.current);
            socket.current?.close();
            socket.current = null;
            pacer.current = null;
            overflowed.current = false;
            endUplinkLeg(); // the released leg's drop totals (T6), stamped with its own leg
            // The pre-play tap closes over the capture it is about to release (S3 confirm F2), so it
            // goes with it; the fresh capture registers its own if its track needs one.
            setCallPrePlay(null);
            chirp.current = null; // the fresh ear plays — and measures — its own chirp (the route moved)
            lastChirp.current = null; // …and until it has, the old sink's lag is no evidence about this one
            clearTimeout(rechirpTimer.current); // …which is the re-chirp a pending device change wanted
            leak.current = newLeak(null); // the fresh ear re-measures the rest of any reply still playing
            clearTimeout(noiseTimer.current); // a verdict about a segment on the ear being released
            // The OLD ear's learned level goes back under the OLD device's key (D76 §C.3) before the
            // fresh capture seeds from whatever its own key holds.
            persistVoice(gate.current);
            capture.current?.stop();
            capture.current = null;
            // THE POOL ESCAPE (ISS-54 ②, R99 §1.4): the clock starts HERE, at the release — closing
            // the old context is what hands its output stream back to the pool, and only a stream
            // idle past Chromium's close delay is gone. `STREAM_RETAG_MS` is that delay plus slack,
            // the mouth's own number for the same pool (ISS-18).
            const notBefore = eff.freshSink ? performance.now() + STREAM_RETAG_MS : 0;
            // NOT `markLeg(false)`: this tab is still in a call. And the fence is the generation this
            // arm just moved — a hang-up or a terminal inside the acquisition gap moves it again, and
            // the capture that resolves afterwards stops itself exactly as the mount path's does.
            acquireRef.current(
              { route: eff.route, deviceId: eff.deviceId },
              () => ref.current.gen === gen,
              notBefore,
            );
            break;
          }
          case "dropCue": {
            // On the capture's own context (`lib/callCue`); an ear already released plays nothing.
            const ctx = capture.current?.context;
            if (ctx && knobs) {
              playDropCue(ctx);
              // `max`: a cue inside the connect chirp's window (D80 ⑦) must not SHORTEN that window.
              cueFramesLeft.current = Math.max(
                cueFramesLeft.current,
                Math.ceil(CUE_HOLD_MS / knobs.frame_ms),
              );
            }
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
      const g = gate.current;
      // THE FINAL'S JUDGEMENT NUMBERS (D77), beside its `sig` line (which carries the energy and the
      // knob): the segment's peak is the meter's record, just written by `meterEdge` — its one source
      // — and the effective floor is read NOW, before the learner below can move it. An EMPTY final (a
      // no-speech answer, or the relay's gap cut, D80 ④) says so: it closed its segment and went
      // nowhere — no queue, no note, no cue, no learner.
      if (sig.type === "final")
        trail.current?.push("final", {
          ...meter.current.last,
          floor: g.cfg && gateFloor(g, g.cfg),
          // …and WHICH borrowed tier set that floor (D8), only when one did — absent under a known
          // level, a pin, or a base (the ceiling or the room) that already stood higher.
          ...(g.cfg && g.voiceSeed && seedBinds({ ...floorInputs(g, g.cfg), pin: g.pin })
            ? { seed: g.voiceSeed.from }
            : {}),
          ...(sig.text.trim() === "" ? { empty: true } : {}),
        });
      // THE VOICE LEARNER (D76 §C.3) — fed only a final the machine took, and guarded inside
      // `learnVoice` (a settled noise term, a clear margin above it, no playback during it). A final
      // that landed inside the ECHO WINDOW teaches nothing even when taken (D80 — the design of record;
      // the code round's O-LOW-2): the car's residue under the owner's words would walk the level up.
      const echoWindowFinal = sig.type === "final" && sig.inEchoWindow === true;
      if (taken && g.cfg && !echoWindowFinal)
        g.voiceLevel = learnVoice(g.voiceLevel, taken, g.noise, g.cfg);
      // The noise verdict is about the segment that is open; with none open there is nothing to judge.
      if (!ref.current.userSpeechActive) clearTimeout(noiseTimer.current);
      // THE MOUTH'S HOLD LIFTS HERE (the owner's 2026-09-26 ruling): the one answer to "the ear may have
      // settled" — every signal is a chance, and the poke is a no-op unless a start is waiting AND the
      // gate now says yes. Last, so it reads the state every effect above has already moved (a kill's
      // `dismiss()` has dropped the held start; a terminal's teardown has taken the gate).
      pokeCallMouth();
    },
    [teardown, endTrail, endUplinkLeg],
  );

  /** THE TEXT BACKSTOP'S MEASUREMENT (D80 ②) for a final landing INSIDE the post-reply window (the
   *  caller asks `performance.now() <= echoUntil` once and passes only those): how much it looks like
   *  the reply the mouth just spoke — or `undefined` when it cannot be judged: under `ECHO_MIN_CHARS` (a
   *  one-word answer is never called an echo), or with no reply to compare. The spoken words are read
   *  ONCE, here, from the chat store's last reply through the policy the mouth SPOKE that very message
   *  by (keyed by its id — its speaker's effective one: an agent-duties reply keeps its `*…*` words,
   *  session-51 polish #6) —
   *  the controller drops its chunk texts at finish, and the captions already read the reply from the
   *  same store (`lastReply`). Every judged final is an `echo` trail line, dropped or not: the car card calibrates
   *  the threshold on the scores. */
  const echoOf = useCallback((text: string): number | undefined => {
    const chars = normalizeForEcho(text).length;
    if (chars < ECHO_MIN_CHARS) return undefined;
    const reply = lastReply();
    if (reply === null) return undefined;
    const sim = echoSimilarity(text, toSpeech(reply.text, getSpokenPolicy(reply.id)));
    trail.current?.push("echo", { sim, chars });
    return sim;
  }, []);

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
    // The PREVIOUS leg's drop totals (T6) go first, while the stamp still reads its number.
    endUplinkLeg();
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
    uplinkDrops.current = { total: 0, bursts: 0, since: 0, lastAt: 0 };
    socket.current?.close();
    socket.current = openLiveSocket({
      url: liveSocketUrl(),
      sampleRate: cap.sampleRate,
      ceilingMs: knobs.buffered_ceiling_ms,
      // D77 — only a debug call names itself to the relay; otherwise `start` is byte-identical.
      trail: trail.current && callId.current ? { callId: callId.current, leg } : undefined,
      onFrame: (frame) => {
        if (!mine()) return;
        switch (frame.type) {
          case "state":
            if (frame.state === "ready")
              send({
                type: "ready",
                // THE LEG CLOCK (S7a, §3.2) — only when declared, so a bare `ready`'s signal and its
                // trail line stay today's; a half pair arrives as the parser's `anomaly` (H5).
                ...(frame.clock === "leg"
                  ? { clock: frame.clock, answerTtlMs: frame.answer_ttl_ms }
                  : {}),
                ...(frame.anomaly === undefined ? {} : { anomaly: frame.anomaly }),
                gen,
              });
            else if (frame.state === "degraded") send({ type: "degraded", gen });
            // A call never flushes (only dictation's release does), so `flushed` answers nothing here —
            // and it must not fall through to the `ended` terminal below (S7a, audit §C.9).
            else if (frame.state === "flushed") break;
            else send({ type: "serverEnded", reason: frame.reason, gen });
            break;
          case "speech_started": {
            // T6 — the pacer's unreported drops ride THIS turn's start as one line: a turn that begins
            // right after the queue lost audio may be missing its head, and the gap says how likely.
            const d = uplinkDrops.current;
            if (d !== null && d.since > 0) {
              trail.current?.push("uplink", {
                drops: d.since,
                ms_since_drop: Math.round(performance.now() - d.lastAt),
              });
              d.since = 0;
            }
            const was = ref.current.userSpeechActive;
            send({ type: "speechStart", itemId: frame.item_id, gen });
            // THE NOISE VERDICT (the owner's 2026-09-26 ruling): a segment the machine ACCEPTED is judged
            // once, `noise_verdict_ms` in, by the transcript gate's own measure — a final it would drop
            // as "too quiet" is noise, and noise does not hold the mouth. Fenced on the LEG and on THIS
            // SEGMENT (D80 ③ — was the meter's single epoch, which an overlapping earlier final closed
            // under it): the verdict reads only the segment it was armed for, and only while that one is
            // still the open one. 0 on either knob = no verdict, ever: the mouth waits for the stop.
            const cfg = gate.current.cfg;
            const verdictMs = cfg?.noise_verdict_ms ?? 0;
            const minFinalMs = cfg?.min_final_ms ?? 0;
            const key = frame.item_id === undefined ? null : segmentKey(leg, frame.item_id);
            const seg = key === null ? undefined : meter.current.segments.get(key);
            if (
              !was &&
              ref.current.userSpeechActive &&
              verdictMs > 0 &&
              minFinalMs > 0 &&
              seg !== undefined &&
              meter.current.open === seg
            ) {
              clearTimeout(noiseTimer.current);
              noiseTimer.current = setTimeout(() => {
                const m = meter.current;
                if (!mine() || m.open !== seg || !ref.current.userSpeechActive) return;
                if (tooQuiet({ energyMs: seg.accruedMs, minFinalMs }))
                  send({ type: "segmentNoise", gen });
              }, verdictMs);
            }
            break;
          }
          case "speech_stopped":
            send({ type: "speechStop", itemId: frame.item_id, gen });
            break;
          case "transcript": {
            // THE TRANSCRIPT GATE's evidence (D74 S5), offered only for THIS final's own segment
            // (D80 ③, by its `item_id` on this leg). Anything else carries none, and the reducer passes
            // it: a final nobody measured is unmeasured, not quiet.
            if (!frame.final) break;
            const key = frame.item_id === undefined ? null : segmentKey(leg, frame.item_id);
            // THE ECHO WINDOW (D80 ②), asked ONCE: it decides both whether the backstop judges this
            // final and whether the voice learner may learn from it (the design of record: "the learner
            // ignores echo-window finals" — the code round's O-LOW-2).
            const inWindow = performance.now() <= echoUntil.current;
            send({
              type: "final",
              text: frame.text,
              itemId: frame.item_id,
              energyMs: segmentAccrual(meter.current, key),
              minFinalMs: knobs.min_final_ms,
              // ISS-55 — THE TURN HOLD, stamped only while it is on: at 0 (or an older backend's absent
              // knob) the signal — and its trail line — stays exactly the pre-hold call's.
              ...(holdKnob.current > 0 ? { turnHoldMs: holdKnob.current } : {}),
              ...(inWindow ? { echo: echoOf(frame.text), inEchoWindow: true } : {}),
              echoMin: knobs.echo_similarity,
              // S7a — a capability leg's final carries its reason/outcome (§3.5 ②) and the parser's
              // verdict (H1); `late` when its id already expired (R3-2). None of it exists on a leg
              // without the clock, so there the signal — and its `sig` line — is today's.
              ...(frame.reason === undefined ? {} : { reason: frame.reason }),
              ...(frame.outcome === undefined ? {} : { outcome: frame.outcome }),
              ...(frame.anomaly === undefined ? {} : { anomaly: frame.anomaly }),
              ...(key !== null && expiredIds.current.delete(key) ? { late: true as const } : {}),
              gen,
            });
            break;
          }
          case "error":
            send({
              type: "serverError",
              code: frame.code,
              message: frame.message,
              itemId: frame.item_id,
              gen,
            });
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
  }, [knobs, send, echoOf, endUplinkLeg]);

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
   *  screen behaviour. Idempotent: a lock still held is not re-requested. The body is `lib/wakeLock`'s
   *  (lifted in Phase 26 SP so dictation takes the same one); the FENCE stays the call's. */
  const takeWakeLock = useCallback((): void => {
    // The GENERATION rides the request (S6 code-review F2): a lock resolving after this call's exit
    // must not become the NEXT call's sentinel — a stale sentinel makes the re-take guard skip the
    // acquisition the fresh call actually needs. Terminal-phase alone cannot tell the two apart: the
    // next call's phase is not terminal.
    const gen = ref.current.gen;
    takeScreenLock(
      wakeLock.current,
      () => gen === ref.current.gen && !isTerminal(ref.current.phase),
    );
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
   * @param notBefore ISS-54 ② — `performance.now()` before which the ear must not open (the output
   *              pool's wait, set by a `freshSink` recapture). 0 — the mount path — opens at once.
   */
  /** THE CONNECT CHIRP, played and listened for on `cap` (D80 ⑦): scheduled on the capture's own context
   *  a lead ahead of its clock, a fresh matcher over the same clock, and its window riding the drop cue's
   *  mask (`max`-merged — never shortening one already running). ONE door for both callers: the
   *  capture's start and a mid-call device change. */
  const startChirp = useCallback((cap: PcmCapture, frameMs: number): void => {
    const when = cap.context.currentTime + CHIRP_LEAD_MS / 1000;
    if (!playChirp(cap.context, when)) return;
    chirp.current = new ChirpMatcher(cap.sampleRate, when);
    cueFramesLeft.current = Math.max(cueFramesLeft.current, Math.ceil(CHIRP_HOLD_MS / frameMs));
  }, []);

  const acquire = useCallback(
    (req: MicRequest, alive: () => boolean, notBefore = 0): void => {
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
      g.voiceSeed = null; // a borrow is the capture's, like its noise: the fresh ear borrows its own (D8)
      // THE EAR IS TAKEN BEFORE IT IS OPENED (D74 S6 ⑧, evidence docs/research/R78 §2.3): a live
      // dictation capture PINS the echo-cancellation mode of the next one on the same device, so a
      // call opening beside one silently inherits whatever dictation asked for — with a readback that
      // honestly reports a mode this call never chose. Stop, THEN open. It resolves at once when
      // nothing was recording, which is every ordinary call.
      void releaseMic()
        .then(async () => {
          // A CALL THAT ENDED WHILE IT WAITED opens nothing (Phase 26 D5 code round): since D5 the wait
          // can last a dictation leg's whole release (≤ `tail_wait_ms`), and a `getUserMedia` after a
          // hang-up — even one stopped at once below — is, on the call route, a Bluetooth audio-mode
          // switch in the car. Checked FIRST, before the pool's wait and before the capture.
          if (!alive()) return null;
          // THE POOL'S WAIT (ISS-54 ②) sits BEFORE `getUserMedia`: the fresh context opens after comm
          // mode is on and after the old stream has aged out of the pool — exactly what a direct
          // call-route start gets — and a call that ended during the wait never opens a mic at all.
          const wait = notBefore - performance.now();
          if (wait > 0) {
            await new Promise((resolve) => setTimeout(resolve, wait));
            if (!alive()) return null;
          }
          return startPcmCapture({
            frameMs: knobs.frame_ms,
            // D73 S5 — the capture pair, read at call start like every other knob (§4.5).
            route: req.route,
            deviceId: req.deviceId,
            onFrame: (frame) => {
              // THE UPLINK GOES THROUGH THE PACER (A-F2, evidence docs/research/R71). The worklet's
              // MessagePort deliveries queue while the main thread is blocked and then dispatch in ONE tick;
              // shipped raw, only the relay's idle reaper (`uplink_idle_s`) and the send-buffer ceiling would
              // bound that burst. Metered, it is a burst the uplink allowance's proof COUNTS (the pacer's
              // cap), and the backlog behind it obeys a stale-speech rule. Dictation has metered this wire
              // since S2.5; the call spends from the same bucket (`lib/uplinkPacer`), under the CALL's
              // backlog rule: drop-OLDEST past `call_backlog_ms`, because a call has a clock on both
              // sides and a second of stale speech endpoints a turn the owner has moved past (R71 §5.3).
              //
              // THE SUBSTITUTION (D76 §B.1) happens HERE, at the pacer boundary, and nowhere else: a frame
              // that is not `uplinked` (muted, or held under the reply) goes up as the ONE zeroed buffer of
              // its length. The server receives exactly the digital silence a disabled track used to give
              // it — which is what its VAD must observe to endpoint (`pcmCapture`'s one rule) — and the
              // frames keep arriving whatever the classification, so there is no stranded tail here and no
              // flush-on-mute question: the queue is pumped by a callback that never stops while the
              // capture is alive.
              // THE CONNECT CHIRP's matcher sees EVERY frame first (D80 ⑦) — its own sound is exactly
              // what it listens for, so no mask applies to it. Its verdict lands once, on the frame that
              // closes its window, and from then on times every tail on this capture (`tailPlan`).
              const cm = chirp.current;
              if (cm !== null) {
                const verdict = cm.feed(frame.buf, frame.t);
                if (verdict !== undefined) {
                  chirp.current = null;
                  lastChirp.current = verdict;
                  const { lagMs, peak, second } = verdict;
                  trail.current?.push(
                    "chirp",
                    lagMs === null ? { none: true, peak, second } : { lagMs, peak, second },
                  );
                }
              }
              // …and the drop cue's own window rides up as silence too (the S0b code round, MED 2): the
              // tone plays on this device's output, and on a media route the microphone hears it. The
              // connect chirp's window rides the same mask (D80 ⑦ — one mechanism for our own sounds).
              const inCue = cueFramesLeft.current > 0;
              if (inCue) cueFramesLeft.current -= 1;
              const uplinked = frame.uplinked && !inCue;
              const p = pacer.current;
              if (p) {
                const up = uplinked ? frame.buf : silenceLike(frame.buf);
                const dropped = enqueueBounded(p, up, knobs.frame_ms, knobs.call_backlog_ms);
                if (dropped > 0) {
                  // …counted for the trail (T6): how many, and when the last one went.
                  const d = uplinkDrops.current;
                  if (d !== null) {
                    d.total += dropped;
                    d.since += dropped;
                    d.lastAt = performance.now();
                    if (!overflowed.current) d.bursts += 1;
                  }
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
                // handshake of a fresh leg belongs to that leg, and `sendAudio` drops it anyway until that
                // leg's relay has said `ready` (the reconnect gap and the handshake alike — R86 LC-5).
                pump(p, knobs.frame_ms, (buf) => socket.current?.sendAudio(buf));
              }
              // dBFS AT THE CHOKEPOINT (D76 §C.1): the ONE conversion, on every frame, before anything
              // below compares a level against anything.
              const db = rmsToDbfs(frame.rms);
              // THE PARTITION (D76 §B.2). The noise tracker takes UPLINKED frames only — a HELD frame is
              // the reply leaking back in, not the room. And it PAUSES while the mouth is live (R83 §8,
              // the S0b code round MED 1): on the call route the ear stays open under the reply and the
              // canceller's residue is not the room — a long reply would ratchet the minimum up, half a
              // window at a time, into the next quiet turn.
              if (uplinked && !ref.current.mouthLive) trackNoise(g.noise, db, knobs.frame_ms);
              // THE effective floor for this frame — the one normalize (`gateFloor`); every reader below
              // takes this number.
              const floor = gateFloor(g, knobs);
              // THE TAIL'S RELEASE (D80 ①) — every frame while a tail holds, held or not (a held frame
              // still carries its REAL level, D76 §B.1: that is what the release listens to), against
              // the NOISE estimate (`tailStep`). The verdict reaches the capture before the NEXT frame
              // is classified, the playback subscription's same-task rule.
              // …and THIS REPLY'S LEAK EVIDENCE, accumulated on the same frames while the mouth is live
              // (`LeakEvidence`: loud against the noise floor by the tail's own margin, or unknown).
              if (ref.current.mouthLive)
                leakFrame(
                  leak.current,
                  db,
                  g.noise.floor,
                  ref.current.muted,
                  knobs.frame_ms,
                  knobs.tail_quiet_margin_db,
                );
              const tr = tailRun.current;
              if (tr !== null) {
                const reason = tailStep(
                  tr,
                  db,
                  g.noise.floor,
                  ref.current.muted,
                  knobs.frame_ms,
                  knobs,
                );
                if (reason !== null) {
                  tailRun.current = null;
                  if (lastTail.current)
                    lastTail.current = { ...lastTail.current, reason, ms: tr.elapsedMs };
                  trail.current?.push("tail", {
                    seq: tr.seq,
                    reason,
                    ms: tr.elapsedMs,
                    ...(tr.deadline ? { deadlineMs: tr.deadline.ms } : {}),
                    ...(tr.lagMs !== null ? { lagMs: tr.lagMs } : {}),
                    leakSeen: tr.leakSeen,
                    leakMs: tr.leakMs,
                  });
                  send({ type: "tailOver", seq: tr.seq, reason, gen: tr.gen });
                  capture.current?.setHeld(ref.current.earHeld);
                }
              }
              // THE EAR METER, FED ONCE (D74 S4 ⑥): trigger A below, the transcript gate's accrual (S5),
              // the voice learner's samples and the readouts all read what this line wrote. It sits
              // OUTSIDE every guard below on purpose — what the microphone heard does not stop being
              // true because the interrupt happens to be disarmed.
              const m = meter.current;
              meterFrame(m, db, uplinked, knobs.frame_ms, floor, ref.current.mouthLive);
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
              const above = uplinked && db >= floor + knobs.playback_margin_db;
              if (bargeWindow(m, above, bargeFrames)) {
                clearBarge(m);
                send({ type: "barge", gen: ref.current.gen });
              }
            },
            onEnded: () => send({ type: "captureLost", gen: ref.current.gen }),
            // ISS-54 — the ear died without the track ending (a context `error`, or no frame ever).
            // The page's visibility rides along for the trail (ISS-54 design round F6): a locked screen's death reads
            // differently from one in front of the owner.
            onDead: (reason, heard) =>
              send({
                type: "earDead",
                reason,
                heard,
                visibilityState: document.visibilityState,
                gen: ref.current.gen,
              }),
          });
        })
        .then((cap) => {
          // The pool's wait outlived the call — nothing was opened, so there is nothing to release.
          if (cap === null) return;
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
          // device the capture ACTUALLY opened, in the echo mode it was actually GRANTED (S3b) — a
          // different device, or the same one under a different mode, has no level of its own — so the
          // own-voice term applies from the first frame (C.4). Written back on release (`persistVoice`).
          g.voiceKey = voiceDeviceKey(cap.readback);
          g.voiceLevel = g.voiceKey === null ? null : getVoiceLevel(g.voiceKey);
          // …and with none of its own, ANOTHER key's level as a provisional floor term (D8): the same
          // device's other mode, else the last route that ended a call knowing one — at twice the
          // margin, until this key's own level is learned, and never written back under it.
          g.voiceSeed = g.voiceLevel === null ? borrowVoiceLevel(g.voiceKey) : null;
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
          // flags (`barge_in` may be off on a perfectly open ear — walkie-talkie by choice). Under
          // `auto` a readback that is not `"all"` HOLDS (the D73 rule, D80 ⑤): nothing a page can
          // measure in time tells a car that leaks seconds late from headphones that do not leak.
          const ecAll = cap.readback.echoCancellation === "all";
          bargeArmed.current = knobs.barge_in && ecAll;
          const hold = knobs.mic_hold;
          send({
            type: "captureReady",
            ecOn: ecEngaged(cap.readback.echoCancellation),
            holdMode: hold === "on" || hold === "off" ? hold : "auto",
            ecAll,
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
          // THE TRAIL'S CAPTURE LINE (D77) — what this acquisition opened and what it runs on: the
          // readback, the seeded voice level and its key, and the gate knobs the floor is computed
          // from. Then the 1 Hz sampler, once per call (a route cycle's recapture keeps it running).
          const t = trail.current;
          if (t) {
            t.push("capture", {
              route: req.route ?? "",
              deviceId: cap.readback.deviceId,
              label: cap.readback.label,
              ec: cap.readback.echoCancellation,
              ecCaps: cap.readback.echoCapabilities,
              // T5 (Phase 26 S1) — the rest of what the track granted, raw, and the two rates: the
              // track's own and the context's the worklet runs at (what `start.sample_rate` declares).
              ns: cap.readback.noiseSuppression,
              agc: cap.readback.autoGainControl,
              channels: cap.readback.channelCount,
              trackRate: cap.readback.sampleRate,
              ctxRate: cap.context.sampleRate,
              // K6 — the 16 kHz ask was abandoned for the device rate (`openCaptureContext`'s fallback).
              nativeRate: cap.readback.nativeRate,
              fellBack: cap.fellBack,
              // D80's W6 (R91 §1, §6 ③) — what the platform REPORTS about this context's output path, for
              // COMPARISON ONLY: Android's Bluetooth drivers discard delay reports ≥ 1 s, so on the car
              // these read ~0.28 s against a measured ~2.3 s. Never a policy input — nothing reads them.
              outputLatency: cap.context.outputLatency,
              baseLatency: cap.context.baseLatency,
              voiceKey: g.voiceKey,
              voiceLevel: g.voiceLevel,
              voiceSeed: g.voiceSeed, // D8 — the borrowed level and its tier, or null
              cfg: {
                floor_dbfs: knobs.floor_dbfs,
                noise_margin_db: knobs.noise_margin_db,
                voice_margin_db: knobs.voice_margin_db,
                min_dbfs: knobs.min_dbfs,
                max_dbfs: knobs.max_dbfs,
                playback_margin_db: knobs.playback_margin_db,
                min_final_ms: knobs.min_final_ms,
                noise_verdict_ms: knobs.noise_verdict_ms,
                // ISS-55 — the turn hold this call runs: the call-start latch, which is what governs it.
                turn_hold_ms: holdKnob.current,
                mic_hold: knobs.mic_hold,
                // …and every knob a tail's release, the text backstop and the chirp decide by (D80), so a
                // release can be reconstructed from the trail after the fact (the car card reads it).
                hold_tail_min_ms: knobs.hold_tail_min_ms,
                tail_quiet_ms: knobs.tail_quiet_ms,
                tail_quiet_margin_db: knobs.tail_quiet_margin_db,
                hold_tail_max_ms: knobs.hold_tail_max_ms,
                tail_lag_margin_ms: knobs.tail_lag_margin_ms,
                echo_similarity: knobs.echo_similarity,
                echo_window_ms: knobs.echo_window_ms,
                chirp: knobs.chirp,
              },
            });
            // ISS-54 design round F4 — the context's own events, from birth: whatever it raised before this install
            // first, then each one as it lands, until the capture is released.
            cap.watchContext((e) => trail.current?.push("ctx", { ...e }));
            if (trailSampler.current === undefined)
              trailSampler.current = setInterval(() => {
                // The debug block's record, only its moving fields (`TRAIL_SAMPLE_FIELDS`) — and the
                // phase they were read in.
                const d = readDebug();
                const line: Record<string, unknown> = {};
                for (const k of TRAIL_SAMPLE_FIELDS) line[k] = d[k];
                line.phase = ref.current.phase;
                // ISS-54 / R99 §4 — is the context RENDERING: `running` proves nothing on its own, and
                // `currentTime` advances only while a render happens.
                line.ctxState = capture.current?.context.state;
                line.ctxTime = capture.current?.context.currentTime;
                trail.current?.push("sample", line);
              }, TRAIL_SAMPLE_MS);
          }
          // THE PRE-PLAY TAP (confirm round F2): on a leaking track the mouth closes the ear BEFORE it
          // asks the element to play — observation, however synchronous, races the audio thread. The tap
          // is a bare "close now": stable until the play event's own reduce confirms it (nothing can
          // transition `earHeld` in that gap), and a rejected play's status edge is what reopens it.
          if (mayHold(ref.current)) setCallPrePlay(() => cap.setHeld(true));
          // THE CONNECT CHIRP (D80 ⑦, R93 §V): once per CAPTURE — the call's start and every route cycle,
          // because the sink can change with the route — scheduled on this capture's own context before
          // the leg opens (so the ear is listening, and the owner has not yet been told it is), whatever
          // `mic_hold` says: it is the call's "connected" sound. Its own window rides the drop cue's mask,
          // and its matcher hears everything. `chirp: false` plays nothing, measures nothing, trails
          // nothing (the whole-feature toggle).
          if (knobs.chirp) startChirp(cap, knobs.frame_ms);
          openLeg();
        })
        .catch((e: unknown) => {
          if (alive()) send({ type: "failed", note: micFailure(e), cause: failureCause(e) });
        });
    },
    [knobs, openLeg, send, readDebug, startChirp],
  );

  acquireRef.current = acquire;

  // ── the one start effect: capture, then the first leg ──────────────────────────────────────────
  useEffect(() => {
    // THE CALL TRAIL (D77), gated on the knob read HERE with every other call-start knob (§4.5) — and
    // before the re-arm below, so a StrictMode re-run's trail starts at its `remount`.
    // `randomUUID` is secure-context only — a plain-HTTP page (where the mic cannot open either) gets
    // no trail rather than a crashed call screen.
    if (
      knobs?.debug === true &&
      trail.current === null &&
      typeof crypto.randomUUID === "function"
    ) {
      callId.current ??= crypto.randomUUID();
      trail.current = createCallTrail({
        callId: callId.current,
        mode: "call", // the trail route files it at the root (Phase 26 S1)
        post: postTrail,
        stamp: () => ({ leg: legSeq.current, gen: ref.current.gen }),
      });
    }
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
    // …and the TURN HOLD's length (ISS-55), with them and for their reason (see the ref).
    holdKnob.current = knobs.turn_hold_ms ?? 0;
    // …and the tab's own marker, read BEFORE the first leg writes one (S6 ⑦). This order is the whole
    // mechanism: what it can report is the PREVIOUS document's unfinished call, never this one's.
    if (markStanding()) send({ type: "priorLeg", gen: ref.current.gen });
    // The call speaks every turn that STARTS after this moment, and deliberately not the one already
    // streaming (§4.5 — a reply half-read to an owner who was not yet in a call is not picked up). The
    // exclusion is a GATE on the status timeline, not an id: the streaming message is renamed to the
    // server's id mid-flight, and a captured id stops matching the message it was meant to exclude.
    setCallVoice(true, getLiveTurn() !== null);
    // THE MOUTH'S GATE (the owner's 2026-09-26 ruling), registered for the call's whole life rather than
    // per capture: it reads the MACHINE, not the track, so a route cycle leaves it standing — and a start
    // it is holding across the cycle is released by the poke that follows the cycle's own reduce.
    setCallMouthGate(() => mouthMayOpen(ref.current));
    acquire({ route: knobs.route, deviceId: knobs.input_device }, () => !disposed);
    // THE SINK CAN MOVE WITHOUT A ROUTE CYCLE (D80 ⑦ as-built, the wave-1.5 fix wave's O-W15-MED): a
    // call started on the phone's speaker, and the car's Bluetooth connects mid-call — every tail would
    // go on planning the SPEAKER's lag (≈ 0.5 s) while the car plays 2.3 s late, the dangerous direction.
    // So a `devicechange` forgets the measured lag AT ONCE (the tails between take the no-lag rules, the
    // safe side), drops a matcher still listening, and RE-CHIRPS on the same capture once the list has
    // settled (`RECHIRP_SETTLE_MS`) — even over a reply: the matcher is proven under over-talk. Its own
    // listener, deliberately not the Sound picker's: that one refreshes a LIST on the overlay (and lives
    // only while the deck is rendered); this one is the machine's evidence, and must not depend on what
    // the screen happens to show. UNVERIFIED on the car itself: whether an A2DP-only head unit raises
    // `devicechange` on Android Chrome at all (its INPUT list may not move) — the car card probes it;
    // the passive per-reply onset-lag check (R93 §V.b5) is the recorded seam that would not need it.
    const md: MediaDevices | undefined = navigator.mediaDevices;
    const onDevices = (): void => {
      // A change while `getUserMedia` is still opening needs no re-chirp: the capture's own chirp,
      // scheduled once it opens, already measures whatever output is current by then.
      if (!capture.current) return;
      lastChirp.current = null;
      chirp.current = null;
      trail.current?.push("chirp", { reset: "devicechange" });
      clearTimeout(rechirpTimer.current);
      rechirpTimer.current = setTimeout(() => {
        const cap = capture.current;
        if (cap && !isTerminal(ref.current.phase)) startChirp(cap, knobs.frame_ms);
      }, RECHIRP_SETTLE_MS);
    };
    if (knobs.chirp) md?.addEventListener("devicechange", onDevices);
    return () => {
      disposed = true;
      md?.removeEventListener("devicechange", onDevices);
      clearTimeout(rechirpTimer.current);
      // THROUGH THE REDUCER, not a bare `teardown()`: the `unmounted` arm moves the generation FIRST,
      // so a callback that lands after this cleanup — `close()` only starts the socket's handshake,
      // and a `killSettled`/`sent` settlement answers whenever it answers — is a ghost by the same
      // fence every other stale callback hits. The arm's own effect runs the teardown.
      send({ type: "unmounted" });
      endTrail(); // the terminal edge above already ended it, unless the machine was terminal before
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
  // `speech_stopped` the engaged hold would then drop (a stranded `userSpeechActive` would hold the NEXT
  // reply at the mouth's door), and no re-open race between a pre-play hold and a stale effect.
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
        // D77 — the page may not come back: what the trail holds goes now, on `keepalive`.
        trail.current?.flush("hidden");
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
    const onPagehide = (): void => {
      trail.current?.flush("hidden"); // D77 — before the `hidden` below ends the call (and the trail)
      send({ type: "hidden" });
    };
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

  const stop = useCallback(() => send({ type: "stop", gen: ref.current.gen }), [send]);

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
    const read = (): void => setDebug(readDebug());
    read();
    const id = setInterval(read, DEBUG_TICK_MS);
    return () => clearInterval(id);
  }, [debugOn, readDebug]);

  // ── the Sensitivity seam (D76 §C.7 — S1 renders it) ──────────────────────────────────────────────
  // A SAMPLER over the same refs the debug block reads, never a per-frame state write (the D74 S7
  // rule): the meter that consumes it polls at its own tick.
  const readLevel = useCallback((): {
    level: number | null;
    floor: number | null;
    ceiling: number | null;
  } => {
    const g = gate.current;
    return {
      level: meter.current.db,
      floor: g.cfg && gateFloor(g, g.cfg),
      ceiling: g.cfg && gateCeiling(g, g.cfg),
    };
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
    tail: state.tail,
    stop,
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

/** …and the same failure in the ENGINE's words, for the trail only (ISS-54 confirm round): a platform
 *  `DOMException`'s class (`NotAllowedError`, …), or — for the capture's own plain `Error` — its message,
 *  which is a fixed sentence of `pcmCapture`'s (never a browser string that could carry anything else). */
function failureCause(e: unknown): string {
  if (!(e instanceof Error)) return "unknown";
  return e.name === "Error" ? e.message : e.name;
}

/** Why the ear never opened, in the owner's words rather than the engine's. */
function micFailure(e: unknown): string {
  const name = e instanceof Error ? e.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") return "microphone permission denied";
  if (name === "NotFoundError") return "no microphone found";
  return "could not open the microphone";
}
