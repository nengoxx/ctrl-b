import { useCallback, useEffect, useRef, useState } from "react";

import {
  dismiss,
  getPlayStatus,
  openCallVoiceGate,
  setCallPrePlay,
  setCallVoice,
  subscribePlayback,
  useMouthFailures,
  type PlayStatus,
} from "../lib/audioController";
import { sendCallTranscript } from "../lib/composer";
import { liveSocketUrl, openLiveSocket, type LiveSocket } from "../lib/liveSocket";
import { startPcmCapture, type PcmCapture } from "../lib/pcmCapture";
import { useStagedFiles } from "../store/attachments";
import { cancelTurn, confirmOutstanding, getLiveTurn, useChatSlice } from "../store/chat";
import { appendDraft } from "../store/composer";
import { endCall } from "../store/liveCall";
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
// THE EAR-HOLD (S3 · §5.1's `echo_workaround`, the S0 device ruling). Where the track's AEC is the
// subtractive `"all"` mode the ear stays open under the reply and voice barge-in is real. Where it is
// not — Fennec, measured at near-full leak — an open ear would transcribe the character's own words
// into the owner's next message, so while the mouth is audible the ear CLOSES (`earHeld`) and every
// event from that stretch is dropped. Nothing is lost by it: interruption there is the tap, which is
// every browser's interrupt anyway (§4.3's trigger B).
//
// THE GENERATION FENCE (delta round F7). Every asynchronous callback — a send's outcome, a cancel's
// settlement, a reconnect timer, a socket event — carries the generation it was armed under, and the
// reducer drops anything armed under a different one. Hanging up bumps the generation, so a hang-up's
// own C3 kill can never fire a stale drain-submit and a redial inherits nothing.

// ── the named constants (all of them, in this one file — the R69 precedent) ──────────────────────
// What is NOT here: every §4.1 tunable (`frame_ms`, `buffered_ceiling_ms`, `min_speech_ms`,
// `barge_threshold`, `barge_in`, `max_session_s`). Those are the owner's, delivered by
// `/voice/status.live_call`, and this hook reads them — it never defaults them.

/** Reconnect attempts before the call gives up (§4.5's "bounded attempts with backoff"). One per entry
 *  in the backoff schedule below, which is what keeps the two from drifting apart. */
const RECONNECT_BACKOFF_MS = [400, 900, 1800, 3000] as const;

/** How long the "connection strained" note stands after a `degraded` frame, unless another one re-arms
 *  it (S2b — the S2a residual).
 *
 *  It has to be a CLIENT decision because the relay only ever says the bad news: it emits ONE `degraded`
 *  state per overflow burst and has no recovery signal at all (`services/voice_live.py` — the bounded
 *  queue drops its oldest frames and says so once). Without a hold the note would stand for the whole
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

/** The overlay's own copy. Plain sentences, kept here so the machine's arms can pin them. */
export const CALL_COPY = {
  busy: "another call is active",
  limit: "call time limit reached",
  strained: "connection strained",
  micLost: "the microphone stopped",
  voiceFailed: "voice failed — the reply is in the chat",
  refused: "couldn't send that — it's back in the composer",
  unknown: "not sure that sent — check the chat before repeating it",
  lost: "lost the connection",
  unconfigured: "live call is not configured",
} as const;

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
  /** Does THIS call's track need the ear-hold at all (§5.1's `echo_workaround`, resolved ONCE at capture
   *  from the track's own AEC readback — never UA-sniffed, never re-decided mid-call). */
  earHoldMode: boolean;
  /** …and is it closed right now. DERIVED after every reduce (see `normalize`) — never set by an arm. */
  earHeld: boolean;
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
  gen: 0,
  attempts: 0,
};

export type SendResult = "accepted" | "refused" | "unknown" | "held";

export type CallSignal = { gen?: number } & (
  | { type: "ready" } //                       the relay said `state: ready`
  | { type: "socketLost" } //                  the leg closed while the call was still wanted
  | { type: "speechStart" }
  | { type: "speechStop" }
  | { type: "final"; text: string }
  | { type: "degraded" }
  | { type: "degradedOver" } //                the strained note's hold expired (see DEGRADED_NOTE_MS)
  | { type: "setMuted"; on: boolean } //       the mute control (§6)
  /** The capture RESOLVED, carrying the one thing about it the rules depend on: whether this track
   *  needs the ear-hold (§5.1 — `echo_workaround` resolved against the track's own AEC readback). */
  | { type: "captureReady"; earHoldMode: boolean }
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
  | { type: "hidden" } //                      §5.3: the page went away — a clean end, not an error
  /** The machine's component is UNMOUNTING (the shell's `endCall`, or a redial's key bump). The arm
   *  exists for the FENCE, not the teardown: the wiring's callbacks — a socket frame already
   *  dispatched (`close()` only starts the handshake), a `cancelTurn` settlement, a send outcome —
   *  can land AFTER the unmount, and before S2b every user exit moved the generation through the
   *  `hangup` arm so those became ghosts. The shell exit must too, or a `final` in that gap still
   *  SUBMITS after the owner closed the call (§4.3's hang-up-discards, violated one task late).
   *  Deliberately NOT `hangup` itself: its `close: true` would `endCall()`, and on a redial's
   *  remount that would kill the fresh call the owner just asked for. */
  | { type: "unmounted" }
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
  /** Release everything. `close` additionally dismisses the overlay — the user's own exit gets no
   *  terminal screen (§6); an `error`/`ended` terminal keeps the overlay up to say why. */
  | { type: "teardown"; close: boolean };

interface Step {
  state: CallState;
  out: CallEffect[];
}

const isTerminal = (p: CallPhase): boolean => p === "error" || p === "ended";

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
      state: { ...CALL_INITIAL, phase: "ended", gen: s.gen + 1 },
      out: [{ type: "teardown", close: sig.type !== "unmounted" }],
    };
  }
  if (isTerminal(s.phase)) return { state: s, out: [] };

  switch (sig.type) {
    case "ready":
      // A fresh leg is a fresh session: the ear knows nothing about a half-spoken phrase that died with
      // the old socket, so the flags start clean and the reconnect budget resets. The note follows the
      // `degradedOver` rule (S2b confirm F3): only the STRAINED note is connection news a fresh leg
      // retracts — anything else standing there (a refused send, a mouth failure) is unread news that
      // arrived for its own reason, and a reconnect has no business clearing it.
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
        note: s.note === CALL_COPY.strained ? null : s.note,
      });

    case "socketLost": {
      const attempt = s.attempts + 1;
      if (attempt > RECONNECT_BACKOFF_MS.length) return terminal(s, "error", CALL_COPY.lost);
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
      // later: `echo_workaround` is read at call start like every other knob (§4.5 — settings edited
      // mid-call apply to the NEXT call), and the capability belongs to this track, not to the browser.
      return { state: { ...s, earHoldMode: sig.earHoldMode }, out: [] };

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
          return terminal(s, "error", CALL_COPY.busy);
        case "session_limit":
          return terminal(s, "ended", CALL_COPY.limit);
        case "upstream_error":
          // The ONE code the relay keeps the session alive through — so the client must too.
          return { state: { ...s, note: sig.message || CALL_COPY.lost }, out: [] };
        default:
          return terminal(s, "error", sig.message || CALL_COPY.lost);
      }

    case "serverEnded":
      return terminal(s, "ended", s.note ?? "");

    case "captureLost":
      // §4.5: permission revoked, a real phone call stole the mic, a headset event.
      return terminal(s, "error", CALL_COPY.micLost);

    case "failed":
      return terminal(s, "error", sig.note);
  }
  return { state: s, out: [] };
}

// ── the wiring ───────────────────────────────────────────────────────────────────────────────────

/** What the overlay renders + the two things it can do. */
export interface CallView {
  phase: CallPhase;
  heard: string;
  note: string | null;
  userSpeechActive: boolean;
  /** The ear is closed (§6) — a STATIC look on the ring/accent, never a pulse. */
  muted: boolean;
  /** Trigger B — a tap outside the control cluster during `speaking` (§4.3). Inert elsewhere. */
  interrupt: () => void;
  /** Mute/unmute the ear. The track goes silent; the frames keep flowing (see `PcmCapture.setMuted`). */
  toggleMute: () => void;
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
  /** Sustained above-floor milliseconds — trigger A's own clock, fed by the worklet's per-frame RMS. */
  const sustained = useRef(0);
  /** Trigger A is armed only on a track whose AEC is the subtractive `all` mode (the S0 ruling). */
  const bargeArmed = useRef(false);
  /** The held-upload retry is ONE PER HOLD (§4.5); this latch is what makes it one. A fresh `held`
   *  outcome re-arms it — see the submit effect. */
  const retriedUpload = useRef(false);
  /** Which socket LEG is current — see `openLeg`. */
  const legSeq = useRef(0);

  /** Release EVERYTHING, on every exit path (§6's "hang up = immediate full teardown"). Idempotent. */
  const teardown = useCallback((): void => {
    clearTimeout(retryTimer.current);
    clearTimeout(degradeTimer.current);
    socket.current?.close();
    socket.current = null;
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

  const send = useCallback(
    function send(sig: CallSignal): void {
      const { state: next, out } = callReduce(ref.current, sig);
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
          case "teardown":
            teardown();
            if (eff.close) endCall();
            break;
        }
      }
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
            if (frame.final) send({ type: "final", text: frame.text, gen });
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

  // ── the one start effect: capture, then the first leg ──────────────────────────────────────────
  useEffect(() => {
    if (voice === undefined) return; // the knobs have not arrived yet — nothing to configure from
    if (!knobs) {
      send({ type: "failed", note: CALL_COPY.unconfigured });
      return;
    }
    let disposed = false;
    // The call speaks every turn that STARTS after this moment, and deliberately not the one already
    // streaming (§4.5 — a reply half-read to an owner who was not yet in a call is not picked up). The
    // exclusion is a GATE on the status timeline, not an id: the streaming message is renamed to the
    // server's id mid-flight, and a captured id stops matching the message it was meant to exclude.
    setCallVoice(true, getLiveTurn() !== null);
    const floor = knobs.barge_threshold || (voice.stt_auto_stop?.threshold ?? 0);
    void startPcmCapture({
      frameMs: knobs.frame_ms,
      onFrame: (frame) => {
        socket.current?.sendAudio(frame.buf);
        // TRIGGER A (§4.3): the worklet already owns the samples, so the sustained-energy floor is
        // measured on the frames we are shipping — never a second AnalyserNode over the same audio.
        // A floor of 0 means neither knob was calibrated, and "every frame is speech" would make a
        // cough kill the reply — so the automatic trigger simply stays disarmed until S4 sets one.
        // Gated on the MOUTH, not the phase (S3, the same audit as the `barge` arm): what trigger A
        // measures is speech over an audible reply, and the reducer's own gate reads `mouthLive` — a
        // clock that stopped at the rendered phase would spend the reconnect window unable to accrue
        // toward a kill the tap could still fire.
        if (!bargeArmed.current || floor <= 0 || !ref.current.mouthLive) {
          sustained.current = 0;
          return;
        }
        if (frame.rms < floor) {
          sustained.current = 0;
          return;
        }
        sustained.current += knobs.frame_ms;
        if (sustained.current >= knobs.min_speech_ms) {
          sustained.current = 0;
          send({ type: "barge", gen: ref.current.gen });
        }
      },
      onEnded: () => send({ type: "captureLost", gen: ref.current.gen }),
    })
      .then((cap) => {
        if (disposed) {
          cap.stop();
          return;
        }
        capture.current = cap;
        // MUTE ACROSS THE ACQUISITION GAP (S2b confirm F1): a Mute tapped while `getUserMedia` was
        // still pending changed the RULE but had no track to change — so the track takes the
        // machine's answer the moment it exists, or audio flows to the relay while the screen says
        // Muted (and a final landing after the unmute would pass the reducer and submit it).
        cap.setMuted(ref.current.muted);
        // The S0 ruling, per TRACK and never UA-sniffed: only a genuinely subtractive canceller lets the
        // ear stay open under the reply, so only there can VOICE interrupt. Everywhere else the tap is
        // the interrupt (§4.3) — and the ear is CLOSED while the reply speaks, which is the same readback
        // read for its other consequence (S3). `on`/`off` are the owner's override of that reading; only
        // `auto` consults the track. The two decisions are deliberately not one flag: `barge_in` may be
        // off on a perfectly subtractive track (walkie-talkie by choice), which holds nothing.
        bargeArmed.current = knobs.barge_in && cap.echoCancellation === "all";
        const hold = knobs.echo_workaround;
        send({
          type: "captureReady",
          earHoldMode:
            hold === "on" ? true : hold === "off" ? false : cap.echoCancellation !== "all",
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
        if (!disposed) send({ type: "failed", note: micFailure(e) });
      });
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
  // effect this replaced paid a render + a paint before the hold could reach `track.enabled`, and on a
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
      // normalize have already answered — the hold reaches the track before this task yields, ahead of
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

  // ── the ear-hold, applied to the track (S3) ───────────────────────────────────────────────────
  // The rule lives in the reducer; this is the general path to the hardware (the playback subscription
  // above applies it synchronously on the edges where a render's delay would leak). Cheap and idempotent
  // (`track.enabled` against the stored pair — see `PcmCapture.setHeld`), so an effect that re-runs on a
  // state the hold did not move costs nothing.
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

  // ── screen + foreground (§5.3) ────────────────────────────────────────────────────────────────
  useEffect(() => {
    // Feature-detected, never UA-sniffed; a browser without it simply keeps today's screen behaviour.
    void navigator.wakeLock
      ?.request("screen")
      .then((lock) => {
        if (isTerminal(ref.current.phase)) void lock.release().catch(() => {});
        else wakeLock.current = lock;
      })
      .catch(() => {});
    const onHidden = (): void => {
      // The call is foreground-only (R14 scope): a hidden page ends it CLEANLY — no half-alive
      // background session, and no error face for something the owner did on purpose.
      if (document.visibilityState === "hidden") send({ type: "hidden" });
    };
    document.addEventListener("visibilitychange", onHidden);
    return () => document.removeEventListener("visibilitychange", onHidden);
  }, [send]);

  const interrupt = useCallback(() => send({ type: "barge", gen: ref.current.gen }), [send]);

  /** The mute control: the TRACK first (the samples go silent immediately, before any render), then the
   *  rule change. Trigger A's own clock is reset with it — silent frames read ~0 RMS and would decay it
   *  anyway, but a counter left standing at the edge of its floor is a barge-in waiting to fire off
   *  audio nobody sent, and "the ear is closed" has to mean it. */
  const toggleMute = useCallback((): void => {
    const on = !ref.current.muted;
    capture.current?.setMuted(on);
    if (on) sustained.current = 0;
    send({ type: "setMuted", on, gen: ref.current.gen });
  }, [send]);

  return {
    phase: state.phase,
    heard: state.heard,
    note: state.note,
    userSpeechActive: state.userSpeechActive,
    muted: state.muted,
    interrupt,
    toggleMute,
  };
}

/** Why the ear never opened, in the owner's words rather than the engine's. */
function micFailure(e: unknown): string {
  const name = e instanceof Error ? e.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") return "microphone permission denied";
  if (name === "NotFoundError") return "no microphone found";
  return "could not open the microphone";
}
