import { describe, expect, it } from "vitest";

import {
  CALL_COPY,
  CALL_INITIAL,
  callReduce,
  type CallEffect,
  type CallSignal,
  type CallState,
} from "../../src/hooks/useLiveCall";

// hooks/useLiveCall — the PURE call machine (Phase 24 / D71 §4.2 · §4.3 · §4.5). Every rule a review
// argues about lives in `callReduce`, so every rule is pinned here with no browser, no sockets and no
// fake timers: signals in, `{state, out}` out.
//
// The wiring above it (capture → socket → reducer → effects) is exercised for real by
// `e2e/liveCall.spec.ts`, which drives a mocked relay through a genuine AudioWorklet in Chromium.

/** Feed a signal sequence from a starting state; returns the final state and the effects, in order. */
function run(
  start: CallState,
  sigs: CallSignal[],
): { state: CallState; out: CallEffect[]; steps: CallEffect[][] } {
  let state = start;
  const out: CallEffect[] = [];
  const steps: CallEffect[][] = [];
  for (const sig of sigs) {
    const step = callReduce(state, sig);
    state = step.state;
    out.push(...step.out);
    steps.push(step.out);
  }
  return { state, out, steps };
}

/** A call that has connected and is listening — the state most arms start from. */
const listening = run(CALL_INITIAL, [{ type: "ready" }]).state;
/** …and one where the reply is being spoken. */
const speaking = run(listening, [
  { type: "final", text: "hello" },
  { type: "playbackStarted" },
]).state;

const submits = (out: CallEffect[]): string[] =>
  out.flatMap((e) => (e.type === "submit" ? [e.text] : []));

describe("callReduce — the phase walk", () => {
  it("connects, listens, submits a final, thinks, speaks, then listens again", () => {
    const a = run(CALL_INITIAL, [{ type: "ready" }]);
    expect(a.state.phase).toBe("listening");

    const b = run(a.state, [{ type: "speechStart" }, { type: "speechStop" }]);
    expect(b.state.userSpeechActive).toBe(false);
    expect(b.state.waitingFinal).toBe(true);

    const c = run(b.state, [{ type: "final", text: "what time is it" }]);
    expect(c.state.waitingFinal).toBe(false);
    expect(c.state.phase).toBe("thinking");
    expect(submits(c.out)).toEqual(["what time is it"]);
    expect(c.state.heard).toBe("what time is it");

    const d = run(c.state, [{ type: "playbackStarted" }]);
    expect(d.state.phase).toBe("speaking");
    const e = run(d.state, [{ type: "playbackDrained" }]);
    expect(e.state.phase).toBe("listening");
  });

  it("a turn that settles with no mouth returns to listening (a tool-only turn, TTS off)", () => {
    const thinking = run(listening, [{ type: "final", text: "run it" }]).state;
    expect(run(thinking, [{ type: "turnSettled" }]).state.phase).toBe("listening");
    // …and it is inert while the mouth is open: playback owns that transition.
    expect(run(speaking, [{ type: "turnSettled" }]).state.phase).toBe("speaking");
  });

  it("hang up works from EVERY state, and leaves nothing behind", () => {
    for (const from of [CALL_INITIAL, listening, speaking]) {
      const { state, out } = run(from, [{ type: "hangup" }]);
      expect(state.phase).toBe("ended");
      expect(out).toEqual([{ type: "teardown", close: true }]);
    }
  });
});

describe("callReduce — the orthogonal flags (§4.2)", () => {
  it("BLOCKS playback while the owner is speaking: the mouth opening IS a barge-in", () => {
    const mid = run(listening, [{ type: "speechStart" }]).state;
    const { state, out } = run(mid, [{ type: "playbackStarted" }]);
    expect(state.phase).not.toBe("speaking"); // it never got to talk
    expect(state.killing).toBe(true);
    expect(out).toEqual([{ type: "kill" }]);
  });

  it("…and while the final is still in flight (the speech-stop → transcript gap)", () => {
    const waiting = run(listening, [{ type: "speechStart" }, { type: "speechStop" }]).state;
    expect(waiting.waitingFinal).toBe(true);
    const { state, out } = run(waiting, [{ type: "playbackStarted" }]);
    expect(state.phase).not.toBe("speaking");
    expect(out).toEqual([{ type: "kill" }]);
  });

  it("…and while the phase is ALREADY `speaking` — the read-along gap scenario", () => {
    // A chunked reply pauses for synthesis mid-message and resumes: the phase never left `speaking`,
    // so the resuming chunk arrives as a `playbackStarted` on top of it. If the owner started talking
    // during that gap, the reply resuming over them is exactly the barge-in §4.2 forbids.
    const talking = run(speaking, [{ type: "speechStart" }]).state;
    const { state, out } = run(talking, [{ type: "playbackStarted" }]);
    expect(state.killing).toBe(true);
    expect(out).toEqual([{ type: "kill" }]);
  });

  it("with both flags clear, playback simply starts", () => {
    const { state, out } = run(listening, [{ type: "playbackStarted" }]);
    expect(state.phase).toBe("speaking");
    expect(out).toEqual([]);
  });

  it("an EMPTY final is discarded — nothing submits, the flag clears", () => {
    const waiting = run(listening, [{ type: "speechStart" }, { type: "speechStop" }]).state;
    const { state, out } = run(waiting, [{ type: "final", text: "   " }]);
    expect(state.waitingFinal).toBe(false);
    expect(state.pending).toEqual([]);
    expect(out).toEqual([]);
    expect(state.phase).toBe("listening");
  });
});

describe("callReduce — the ONE pending queue (§4.3)", () => {
  it("holds every utterance spoken over the reply and drains them as ONE message, in order", () => {
    const { state, out } = run(speaking, [
      { type: "final", text: "wait" },
      { type: "final", text: "actually never mind" },
    ]);
    expect(state.pending).toEqual(["wait", "actually never mind"]);
    expect(submits(out)).toEqual([]); // nothing goes out while the mouth is open

    const drained = run(state, [{ type: "playbackDrained" }]);
    expect(submits(drained.out)).toEqual(["wait actually never mind"]);
    expect(drained.state.pending).toEqual([]);
    expect(drained.state.phase).toBe("thinking");
  });

  it("a final during `thinking` goes out immediately as a steer, phase untouched", () => {
    const thinking = run(listening, [{ type: "final", text: "first" }]).state;
    const { state, out } = run(thinking, [{ type: "final", text: "and also" }]);
    expect(submits(out)).toEqual(["and also"]);
    expect(state.phase).toBe("thinking");
  });

  it("a confirm gate HOLDS submissions until it resolves, either way", () => {
    const held = run(listening, [
      { type: "confirmHold", on: true },
      { type: "final", text: "yes do it" },
    ]);
    expect(submits(held.out)).toEqual([]);
    expect(held.state.pending).toEqual(["yes do it"]);

    const released = run(held.state, [{ type: "confirmHold", on: false }]);
    expect(submits(released.out)).toEqual(["yes do it"]);
  });

  it("a HELD upload puts the utterance back at the FRONT and retries on settle", () => {
    const sent = run(listening, [{ type: "final", text: "look at this" }]);
    expect(submits(sent.out)).toEqual(["look at this"]);

    const held = run(sent.state, [{ type: "sent", outcome: "held", text: "look at this" }]);
    expect(held.state.heldUpload).toBe(true);
    expect(held.state.phase).toBe("listening");

    // Something said DURING the hold queues behind it, and the order survives the retry.
    const more = run(held.state, [{ type: "final", text: "the red one" }]);
    expect(more.state.pending).toEqual(["look at this", "the red one"]);

    const settled = run(more.state, [{ type: "uploadSettled" }]);
    expect(submits(settled.out)).toEqual(["look at this the red one"]);
  });
});

describe("callReduce — barge-in (§4.3)", () => {
  it("a tap during `speaking` fires the ordered kill and HOLDS the queue until it settles", () => {
    const bargedIn = run(speaking, [{ type: "barge" }]);
    expect(bargedIn.out).toEqual([{ type: "kill" }]);
    expect(bargedIn.state.killing).toBe(true);

    // The interrupting utterance arrives while the cancel is still in flight: it waits.
    const spoken = run(bargedIn.state, [{ type: "final", text: "stop, do the other thing" }]);
    expect(submits(spoken.out)).toEqual([]);

    // ③ only now.
    const settled = run(spoken.state, [{ type: "killSettled" }]);
    expect(submits(settled.out)).toEqual(["stop, do the other thing"]);
    expect(settled.state.phase).toBe("thinking");
  });

  it("taps OUTSIDE `speaking` are inert — nothing cancels by accident", () => {
    const thinking = run(listening, [{ type: "final", text: "hm" }]).state;
    for (const from of [listening, thinking]) {
      const { state, out } = run(from, [{ type: "barge" }]);
      expect(out).toEqual([]);
      expect(state.killing).toBe(false);
    }
  });

  it("our own kill is NOT a natural drain — the drain waits for the settlement", () => {
    const killing = run(speaking, [{ type: "barge" }]).state;
    const queued = run(killing, [{ type: "final", text: "the other thing" }]).state;
    // `dismiss()` stops the element, which looks exactly like the reply ending. It must not release
    // the queue: the turn it would steer is still being cancelled.
    const drained = run(queued, [{ type: "playbackDrained" }]);
    expect(submits(drained.out)).toEqual([]);
    expect(drained.state.killing).toBe(true);
    // …and the phase does not settle either: the ordered sequence owns the transition, and only its
    // settlement ends it (otherwise `listening` would paint while the cancel is still in flight).
    expect(drained.state.phase).toBe("speaking");
  });

  it("the cancel-settle window holds the queue on its OWN, with no other hold standing", () => {
    // The iron-rule kill fires from `listening`, so `killing` is the ONLY thing holding here — no
    // `speaking` phase, no confirm, no upload. Every release path must still refuse to submit.
    const killing = run(listening, [
      { type: "speechStart" },
      { type: "playbackStarted" }, // the mouth tried to open mid-word → the ordered kill
      { type: "speechStop" },
      { type: "final", text: "the other thing" },
    ]).state;
    expect(killing.killing).toBe(true);
    expect(killing.phase).toBe("listening");
    expect(killing.pending).toEqual(["the other thing"]);
    for (const sig of [
      { type: "turnSettled" } as const,
      { type: "confirmHold", on: false } as const,
      { type: "uploadSettled" } as const,
      { type: "playbackDrained" } as const,
    ]) {
      expect(submits(callReduce(killing, sig).out)).toEqual([]);
    }
    // …and its settlement is what lets it go.
    expect(submits(run(killing, [{ type: "killSettled" }]).out)).toEqual(["the other thing"]);
  });

  it("walkie-talkie: with no barge trigger at all, the queue drains when the reply ends", () => {
    const { state, out } = run(speaking, [
      { type: "final", text: "one" },
      { type: "playbackDrained" },
    ]);
    expect(submits(out)).toEqual(["one"]);
    expect(state.phase).toBe("thinking");
  });
});

describe("callReduce — the generation fence (F7)", () => {
  it("a callback armed under a DEAD call cannot touch it", () => {
    const gen = listening.gen;
    const after = run(listening, [{ type: "hangup" }]).state;
    expect(after.gen).toBe(gen + 1);
    // The hang-up's own C3 kill settles AFTER the hang-up and must not fire a stale drain-submit.
    // TWO mechanisms refuse it independently — the generation fence and the terminal guard — so this
    // arm goes red only when BOTH are reverted (recorded as a joint proof in the build's red-proof
    // list). The fence is F7's stated requirement and is what would still stand if a generation ever
    // bumps somewhere non-terminal.
    const stale = callReduce(after, { type: "killSettled", gen });
    expect(stale.state).toBe(after);
    expect(stale.out).toEqual([]);
  });

  it("a send outcome from a dead call cannot harvest into the composer", () => {
    const gen = speaking.gen;
    const dead = run(speaking, [{ type: "hangup" }]).state;
    const late = callReduce(dead, { type: "sent", outcome: "refused", text: "lost", gen });
    expect(late.out).toEqual([]);
  });

  it("a signal with no generation is accepted (the synchronous paths)", () => {
    expect(callReduce(listening, { type: "speechStart" }).state.userSpeechActive).toBe(true);
  });
});

describe("callReduce — terminals (§4.3/§4.5)", () => {
  it("a HANG-UP discards pending speech; an ERROR harvests it", () => {
    const queued = run(speaking, [{ type: "final", text: "unsent words" }]).state;

    const bye = run(queued, [{ type: "hangup" }]);
    expect(bye.out).toEqual([{ type: "teardown", close: true }]);
    expect(bye.state.pending).toEqual([]);

    const lost = run(queued, [{ type: "captureLost" }]);
    expect(lost.out).toEqual([
      { type: "harvest", lines: ["unsent words"] },
      { type: "teardown", close: false },
    ]);
    expect(lost.state.phase).toBe("error");
    expect(lost.state.note).toBe(CALL_COPY.micLost);
  });

  it("`busy` names the other call; `session_limit` is a clean end, not an error", () => {
    const busy = run(CALL_INITIAL, [
      { type: "serverError", code: "busy", message: "a live call is already running" },
    ]);
    expect(busy.state.phase).toBe("error");
    expect(busy.state.note).toBe(CALL_COPY.busy);

    const limit = run(listening, [
      { type: "serverError", code: "session_limit", message: "call time limit reached" },
    ]);
    expect(limit.state.phase).toBe("ended");
    expect(limit.state.note).toBe(CALL_COPY.limit);
  });

  it("`upstream_error` is NONFATAL — the relay keeps the session, so the client must too", () => {
    const { state, out } = run(listening, [
      { type: "serverError", code: "upstream_error", message: "the ear hiccuped" },
    ]);
    expect(state.phase).toBe("listening");
    expect(state.note).toBe("the ear hiccuped");
    expect(out).toEqual([]);
  });

  it("`degraded` is a line, not a state change — and it arms its own hold", () => {
    const { state, out } = run(speaking, [{ type: "degraded" }]);
    expect(state.phase).toBe("speaking");
    expect(state.note).toBe(CALL_COPY.strained);
    // The relay says the bad news ONCE and never says "recovered", so the note is held by a client
    // timer instead of standing for the rest of the call (S2b).
    expect(out).toEqual([{ type: "degradeHold" }]);
  });

  it("the strained note times out — but ONLY ever clears itself", () => {
    const strained = run(speaking, [{ type: "degraded" }]).state;
    expect(run(strained, [{ type: "degradedOver" }]).state.note).toBeNull();

    // A NEWER note standing where the degrade's used to be is newer news: a timer armed by the degrade
    // must not retract a message the owner has not read yet.
    const newer = run(strained, [{ type: "playbackFailed" }]).state;
    expect(newer.note).toBe(CALL_COPY.voiceFailed);
    expect(run(newer, [{ type: "degradedOver" }]).state.note).toBe(CALL_COPY.voiceFailed);
  });

  it("`ready` retracts only the strained note too — a reconnect must not clear unread news (F3)", () => {
    // strained → a refused send lands its own note → the socket drops → the fresh leg's `ready`:
    // the refusal is not connection news, and the owner has not read it yet.
    const strained = run(listening, [{ type: "degraded" }]).state;
    const refused = run(strained, [
      { type: "final", text: "send this" },
      { type: "sent", outcome: "refused", text: "send this" },
    ]).state;
    expect(refused.note).toBe(CALL_COPY.refused);
    const reconnected = run(refused, [{ type: "socketLost" }, { type: "ready" }]).state;
    expect(reconnected.note).toBe(CALL_COPY.refused);

    // …while a strained note alone IS connection news, and the fresh leg retracts it.
    const back = run(strained, [{ type: "socketLost" }, { type: "ready" }]).state;
    expect(back.note).toBeNull();
  });

  it("a mouth failure is nonfatal: back to listening, the ear keeps working", () => {
    const thinking = run(listening, [{ type: "final", text: "say something" }]).state;
    const { state, out } = run(thinking, [{ type: "playbackFailed" }]);
    expect(state.phase).toBe("listening");
    expect(state.note).toBe(CALL_COPY.voiceFailed);
    expect(out).toEqual([]);
  });

  it("…but OUR OWN kill is not a failure — the killing guard keeps that line off the screen", () => {
    // `dismiss()` aborts the clip, and the element reports that exactly like an engine refusing to
    // play. Telling the owner "voice failed" for a reply THEY interrupted would be a lie.
    const killing = run(speaking, [{ type: "barge" }]).state;
    const { state, out } = run(killing, [{ type: "playbackFailed" }]);
    expect(state.note).toBeNull();
    expect(state.killing).toBe(true);
    expect(out).toEqual([]);
  });

  it("two failures in a row are two events — a repeat still only notes it", () => {
    const thinking = run(listening, [{ type: "final", text: "again" }]).state;
    const once = run(thinking, [{ type: "playbackFailed" }]);
    const twice = run(once.state, [{ type: "playbackFailed" }]);
    expect(twice.state.phase).toBe("listening"); // never a terminal — the ear keeps working
    expect(twice.state.note).toBe(CALL_COPY.voiceFailed);
  });

  it("nothing reaches the machine after a terminal", () => {
    const dead = run(listening, [{ type: "captureLost" }]).state;
    for (const sig of [
      { type: "final", text: "ignored" } as const,
      { type: "playbackStarted" } as const,
      { type: "ready" } as const,
    ]) {
      expect(callReduce(dead, sig).state).toBe(dead);
    }
  });
});

describe("callReduce — reconnect (§4.5)", () => {
  it("retries with backoff, loses the utterance in flight, and gives up bounded", () => {
    let s = listening;
    const delays: number[] = [];
    // A drop mid-utterance: the flags clear because that audio is gone.
    s = run(s, [{ type: "speechStart" }]).state;
    for (let i = 0; i < 4; i++) {
      const step = run(s, [{ type: "socketLost" }]);
      s = step.state;
      expect(s.phase).toBe("connecting");
      expect(s.userSpeechActive).toBe(false);
      expect(s.waitingFinal).toBe(false);
      for (const e of step.out) if (e.type === "reconnect") delays.push(e.delayMs);
    }
    expect(delays).toEqual([400, 900, 1800, 3000]);

    const done = run(s, [{ type: "socketLost" }]);
    expect(done.state.phase).toBe("error");
    expect(done.state.note).toBe(CALL_COPY.lost);
    expect(done.out).toEqual([{ type: "teardown", close: false }]);
  });

  it("a fresh `ready` resets the budget and drains whatever is queued", () => {
    // Queued during `connecting`, which is a hold of its own: there is no leg to send it down.
    const dropped = run(listening, [
      { type: "socketLost" },
      { type: "final", text: "held over the reconnect" },
    ]).state;
    expect(dropped.attempts).toBe(1);
    expect(dropped.pending).toEqual(["held over the reconnect"]);
    const back = run(dropped, [{ type: "ready" }]);
    expect(back.state.attempts).toBe(0);
    expect(submits(back.out)).toEqual(["held over the reconnect"]);
  });
});

describe("callReduce — send outcomes (F8)", () => {
  it("a REFUSED send drops the words into the composer and says so", () => {
    const sent = run(listening, [{ type: "final", text: "did it land" }]);
    const { state, out } = run(sent.state, [
      { type: "sent", outcome: "refused", text: "did it land" },
    ]);
    expect(out).toEqual([{ type: "harvest", lines: ["did it land"] }]);
    expect(state.note).toBe(CALL_COPY.refused);
    expect(state.phase).toBe("listening");
  });

  it("an UNKNOWN send is labelled and NEVER re-sent", () => {
    const sent = run(listening, [{ type: "final", text: "maybe" }]);
    const { state, out } = run(sent.state, [{ type: "sent", outcome: "unknown", text: "maybe" }]);
    expect(out).toEqual([]);
    expect(state.note).toBe(CALL_COPY.unknown);
  });

  it("an ACCEPTED send changes nothing — the turn's own events drive the phase", () => {
    const sent = run(listening, [{ type: "final", text: "ok" }]);
    const { state, out } = run(sent.state, [{ type: "sent", outcome: "accepted", text: "ok" }]);
    expect(out).toEqual([]);
    expect(state.phase).toBe("thinking");
  });
});

describe("callReduce — MUTE (§6, the one mechanism)", () => {
  /** Mid-utterance: the ear has an open segment and its transcript is still coming. */
  const midUtterance = run(listening, [{ type: "speechStart" }, { type: "speechStop" }]).state;

  it("condemns the half-utterance: both flags clear the moment the ear closes", () => {
    expect(midUtterance.waitingFinal).toBe(true);
    const { state } = run(midUtterance, [{ type: "setMuted", on: true }]);
    expect(state.muted).toBe(true);
    expect(state.userSpeechActive).toBe(false);
    // …which is also what keeps §4.2's iron rule from killing playback forever over a final that is
    // never coming: `waitingFinal` cannot be left standing on words nobody is going to send.
    expect(state.waitingFinal).toBe(false);
  });

  it("a final arriving while muted is dropped FLAT — nothing queues, nothing is heard", () => {
    const muted = run(midUtterance, [{ type: "setMuted", on: true }]).state;
    const { state, out } = run(muted, [{ type: "final", text: "the doorbell" }]);
    expect(out).toEqual([]);
    expect(state.pending).toEqual([]);
    expect(state.heard).toBe("");
    expect(state.waitingFinal).toBe(false);
  });

  it("ignores a VAD race: a start/stop pair delivered after the mute changes nothing", () => {
    const muted = run(listening, [{ type: "setMuted", on: true }]).state;
    const { state } = run(muted, [{ type: "speechStart" }, { type: "speechStop" }]);
    expect(state.userSpeechActive).toBe(false);
    expect(state.waitingFinal).toBe(false);
  });

  it("unmuting is a FRESH utterance — the next final goes out normally", () => {
    const back = run(listening, [
      { type: "setMuted", on: true },
      { type: "final", text: "swallowed" },
      { type: "setMuted", on: false },
    ]).state;
    expect(back.muted).toBe(false);
    const { state, out } = run(back, [{ type: "final", text: "where were we" }]);
    expect(submits(out)).toEqual(["where were we"]);
    expect(state.phase).toBe("thinking");
  });

  it("tap-to-interrupt still works while muted (§6)", () => {
    const mutedSpeaking = run(speaking, [{ type: "setMuted", on: true }]).state;
    const { state, out } = run(mutedSpeaking, [{ type: "barge" }]);
    expect(out).toEqual([{ type: "kill" }]);
    expect(state.killing).toBe(true);
  });

  it("a TERMINAL releases the mute with every other flag — the ear is gone, not closed", () => {
    const muted = run(listening, [{ type: "setMuted", on: true }]).state;
    const { state } = run(muted, [{ type: "captureLost" }]);
    expect(state.phase).toBe("error");
    expect(state.muted).toBe(false); // the terminal face carries no control to reopen it
  });

  it("a REDIAL starts unmuted — `muted` rides CALL_INITIAL, like every other flag", () => {
    expect(CALL_INITIAL.muted).toBe(false);
    // A hang-up rebuilds the state from CALL_INITIAL, which is the same shape a fresh mount starts in.
    const { state } = run(run(listening, [{ type: "setMuted", on: true }]).state, [
      { type: "hangup" },
    ]);
    expect(state.muted).toBe(false);
  });
});

// ── S3: the mouth across a reconnect, the ear-hold, and the interleaving sweep ────────────────────

/** A call on a track whose AEC is NOT the subtractive mode (Fennec, §7-S0 ③) — the ear-hold's own. */
const holding = run(CALL_INITIAL, [
  { type: "captureReady", earHoldMode: true },
  { type: "ready" },
]).state;
/** …and the same call with the reply speaking, i.e. with the ear actually closed. */
const holdingSpeaking = run(holding, [
  { type: "final", text: "tell me a story" },
  { type: "playbackStarted" },
]).state;

describe("callReduce — the mouth is not the phase (S3 · mouthLive)", () => {
  it("a reply is still audible across a reconnect: `ready` lands back on SPEAKING", () => {
    // C3 rides HTTP, so the leg dropping says nothing about the voice the owner can hear. Landing on
    // `listening` would hand them a floor that is not theirs — and (below) take their interrupt away.
    const dropped = run(speaking, [{ type: "socketLost" }]).state;
    expect(dropped.phase).toBe("connecting");
    expect(dropped.mouthLive).toBe(true);
    const back = run(dropped, [{ type: "ready" }]).state;
    expect(back.phase).toBe("speaking");
    expect(back.attempts).toBe(0);
  });

  it("…and the tap STILL interrupts it, right through the reconnect window", () => {
    const dropped = run(speaking, [{ type: "socketLost" }]).state;
    const tapped = run(dropped, [{ type: "barge" }]);
    expect(tapped.out).toEqual([{ type: "kill" }]);
    expect(tapped.state.killing).toBe(true);
    // …and the ordered sequence completes as it always does, on whichever leg is up by then.
    const settled = run(tapped.state, [{ type: "ready" }, { type: "killSettled" }]);
    expect(settled.state.phase).toBe("listening");
    expect(settled.state.killing).toBe(false);
  });

  it("a kill settling under REPLACEMENT playback lands on SPEAKING and keeps the queue held (F1)", () => {
    // The barge's own `dismiss()` silenced the first reply — but something genuinely started talking
    // again while the cancel settled (`playbackStarted` during `killing` re-sets the flag by design).
    // A settlement that painted `listening` over it would also DRAIN the queue into a reply still
    // speaking (`held()` reads the phase the arm writes) — and on a held track it would do so with the
    // ear closed under a screen claiming the floor is free.
    const killing = run(holdingSpeaking, [{ type: "barge" }]).state;
    const replaced = run(killing, [
      { type: "playbackStarted" },
      { type: "final", text: "no, the other one" },
    ]);
    expect(replaced.state.mouthLive).toBe(true);
    expect(submits(replaced.out)).toEqual([]); // the kill still holds the queue
    const settled = run(replaced.state, [{ type: "killSettled" }]);
    expect(settled.state.phase).toBe("speaking"); // the mouth is audible — the screen must say so
    expect(submits(settled.out)).toEqual([]); // …and `speaking` is itself a hold: nothing drains yet
    expect(settled.state.earHeld).toBe(true); // the leak protection stands over the live audio
    const over = run(settled.state, [{ type: "playbackDrained" }]);
    expect(submits(over.out)).toEqual(["no, the other one"]); // the REAL drain is the release
    expect(over.state.phase).toBe("thinking"); // …and the submit puts the brain to work
  });

  it("playback STARTING during the reconnect leaves `connecting` standing (confirm F1)", () => {
    // `socketLost` paints `connecting` over a live mouth on purpose, and `playbackDrained` preserves
    // it — this arm must not be the one voice that disagrees. The flag lands; `ready` consults it.
    const dropped = run(speaking, [{ type: "socketLost" }, { type: "playbackDrained" }]).state;
    const started = run(dropped, [{ type: "playbackStarted" }]).state;
    expect(started.phase).toBe("connecting");
    expect(started.mouthLive).toBe(true);
    expect(run(started, [{ type: "ready" }]).state.phase).toBe("speaking");
  });

  it("…and a kill settling behind it inherits `connecting`, not a phantom repaint (confirm F1)", () => {
    // The reviewer's surviving sequence, verbatim: drop → barge (mouthLive clears at the kill) →
    // replacement playback starts with both speech flags clear → the settlement must leave the
    // reconnect owning the screen. The mouth truth survives in the flag for `ready` to read.
    const killing = run(speaking, [{ type: "socketLost" }, { type: "barge" }]).state;
    expect(killing.phase).toBe("connecting");
    const replaced = run(killing, [{ type: "playbackStarted" }, { type: "killSettled" }]).state;
    expect(replaced.phase).toBe("connecting");
    expect(replaced.mouthLive).toBe(true);
    expect(run(replaced, [{ type: "ready" }]).state.phase).toBe("speaking");
  });

  it("a reply that ENDS during the reconnect leaves the fresh leg listening", () => {
    // The drain arrives with the screen on `connecting`, so the arm declines to repaint — but the FLAG
    // lands, and it is the flag `ready` consults. Without that the call would come back claiming to be
    // speaking over silence, and never leave it until the next reply.
    const quiet = run(speaking, [{ type: "socketLost" }, { type: "playbackDrained" }]).state;
    expect(quiet.mouthLive).toBe(false);
    expect(quiet.phase).toBe("connecting");
    expect(run(quiet, [{ type: "ready" }]).state.phase).toBe("listening");
  });

  it("a mouth FAILURE during the reconnect clears it too", () => {
    const failed = run(speaking, [{ type: "socketLost" }, { type: "playbackFailed" }]).state;
    expect(failed.mouthLive).toBe(false);
    expect(run(failed, [{ type: "ready" }]).state.phase).toBe("listening");
  });

  it("the flag lands even where the arm ignores the signal — a drain under a kill", () => {
    const killing = run(speaking, [{ type: "barge" }]).state;
    const drained = run(killing, [{ type: "playbackDrained" }]).state;
    expect(drained.killing).toBe(true); // the kill still owns the transition
    expect(drained.mouthLive).toBe(false); // …but the element really did stop
  });

  it("taps stay inert while the mouth is silent — thinking and listening both", () => {
    const thinking = run(listening, [{ type: "final", text: "hm" }]).state;
    const connecting = run(listening, [{ type: "socketLost" }]).state;
    for (const from of [listening, thinking, connecting]) {
      expect(from.mouthLive).toBe(false);
      expect(run(from, [{ type: "barge" }]).out).toEqual([]);
    }
  });

  it("a terminal takes the mouth with it — the teardown's own `dismiss()`", () => {
    const { state } = run(speaking, [{ type: "captureLost" }]);
    expect(state.mouthLive).toBe(false);
  });
});

describe("callReduce — the Fennec EAR-HOLD (S3 · §5.1's `echo_workaround`)", () => {
  it("closes the ear while the reply speaks, and opens it when the reply ends", () => {
    expect(holding.earHoldMode).toBe(true);
    expect(holding.earHeld).toBe(false); // nothing is speaking yet
    expect(holdingSpeaking.earHeld).toBe(true);
    expect(run(holdingSpeaking, [{ type: "playbackDrained" }]).state.earHeld).toBe(false);
  });

  it("drops the VAD events and the FINAL heard while it is closed — the whole point", () => {
    // What the ear hears under the reply on such a track is the CHARACTER. A final from that stretch
    // would go out as the owner's next message, quoting the bot back at itself.
    const { state, out } = run(holdingSpeaking, [
      { type: "speechStart" },
      { type: "speechStop" },
      { type: "final", text: "…and then the dragon said" },
    ]);
    expect(state.userSpeechActive).toBe(false);
    expect(state.waitingFinal).toBe(false);
    expect(state.pending).toEqual([]);
    // …and the transcript line still shows what the OWNER last said, not what the phone overheard.
    expect(state.heard).toBe("tell me a story");
    expect(out).toEqual([]);
  });

  it("…and keeps taking them the moment the reply drains", () => {
    const open = run(holdingSpeaking, [{ type: "playbackDrained" }]).state;
    const { out } = run(open, [{ type: "final", text: "what happened next" }]);
    expect(submits(out)).toEqual(["what happened next"]);
  });

  it("releases the INSTANT a kill starts — the interrupting words are not eaten", () => {
    // Step ① of the kill is a synchronous `dismiss()`, so the audible part is gone before anything can
    // read this state; and `killSettled` can answer in the same breath (the turn was already terminal),
    // long before the playback store notices. A hold standing into that window swallows the first thing
    // the owner says after tapping — which is the one utterance the tap exists to make room for.
    const tapped = run(holdingSpeaking, [{ type: "barge" }]);
    expect(tapped.state.earHeld).toBe(false);
    const spoken = run(tapped.state, [
      { type: "killSettled" },
      { type: "final", text: "no, the other one" },
    ]);
    expect(submits(spoken.out)).toEqual(["no, the other one"]);
  });

  it("a track whose AEC subtracts holds NOTHING — walkie-talkie speech still transcribes", () => {
    // The Chrome branch of the S0 ruling: the ear stays open under the reply, which is what makes both
    // voice barge-in and `barge_in: false` walkie-talkie semantics possible at all.
    expect(speaking.earHoldMode).toBe(false);
    expect(speaking.earHeld).toBe(false);
    const { state } = run(speaking, [{ type: "final", text: "wait" }]);
    expect(state.pending).toEqual(["wait"]);
  });

  it("MUTE and the hold are independent rules — neither answers for the other", () => {
    const muted = run(holdingSpeaking, [{ type: "setMuted", on: true }]).state;
    expect(muted.earHeld).toBe(true);
    // Unmuting under a live hold leaves the ear closed: the reply is still speaking.
    const unmuted = run(muted, [{ type: "setMuted", on: false }]).state;
    expect(unmuted.muted).toBe(false);
    expect(unmuted.earHeld).toBe(true);
    // …and the drain opens it for real.
    expect(run(unmuted, [{ type: "playbackDrained" }]).state.earHeld).toBe(false);
  });

  it("a TERMINAL releases the hold AND forgets the mode — the track it described is gone", () => {
    const { state } = run(holdingSpeaking, [{ type: "captureLost" }]);
    expect(state.earHeld).toBe(false);
    expect(state.earHoldMode).toBe(false);
  });

  it("a REDIAL re-reads the mode from its own track — nothing is inherited", () => {
    expect(CALL_INITIAL.earHoldMode).toBe(false);
    expect(run(holdingSpeaking, [{ type: "hangup" }]).state.earHoldMode).toBe(false);
  });
});

describe("callReduce — the interleaving sweep (S3 · F4 · F5 · F6)", () => {
  it("F4: every final spoken during the cancel-settle window drains IN ORDER, as one message", () => {
    const killing = run(speaking, [{ type: "barge" }]).state;
    const queued = run(killing, [
      { type: "final", text: "stop" },
      { type: "final", text: "do the other thing" },
    ]);
    expect(submits(queued.out)).toEqual([]);
    const settled = run(queued.state, [{ type: "killSettled" }]);
    expect(submits(settled.out)).toEqual(["stop do the other thing"]);
    expect(settled.state.pending).toEqual([]);
  });

  it("F4: a SECOND barge while the first is settling is inert — one kill per interruption", () => {
    const killing = run(speaking, [{ type: "barge" }]);
    expect(killing.out).toEqual([{ type: "kill" }]);
    const again = run(killing.state, [{ type: "barge" }, { type: "barge" }]);
    expect(again.out).toEqual([]);
    // …and one settlement still ends it: nothing is left waiting on a second kill that never fired.
    expect(run(again.state, [{ type: "killSettled" }]).state.killing).toBe(false);
  });

  it("F5: the mouth opening mid-word kills BEFORE the first sample, and never twice", () => {
    const mid = run(listening, [{ type: "speechStart" }]);
    const first = run(mid.state, [{ type: "playbackStarted" }]);
    expect(first.out).toEqual([{ type: "kill" }]);
    expect(first.state.phase).not.toBe("speaking");
    // A second chunk starting while the kill is in flight must not fire another ordered sequence —
    // two kills means two `cancelTurn` settlements, and the second one drains a queue already drained.
    const second = run(first.state, [{ type: "playbackStarted" }]);
    expect(second.out).toEqual([]);
    expect(second.state.killing).toBe(true);
  });

  it("F5: …and the same in the `waitingFinal` gap, with the words arriving mid-kill", () => {
    const gap = run(listening, [{ type: "speechStart" }, { type: "speechStop" }]).state;
    const killed = run(gap, [{ type: "playbackStarted" }]);
    expect(killed.out).toEqual([{ type: "kill" }]);
    const late = run(killed.state, [{ type: "final", text: "as I was saying" }]);
    expect(submits(late.out)).toEqual([]); // the §4.3 ORDER: nothing goes before the settlement
    expect(submits(run(late.state, [{ type: "killSettled" }]).out)).toEqual(["as I was saying"]);
  });

  it("F6: a socket lost DURING the kill reconnects, and the settlement still drains in order", () => {
    const killing = run(speaking, [{ type: "barge" }]).state;
    const queued = run(killing, [{ type: "final", text: "the other thing" }]).state;
    const dropped = run(queued, [{ type: "socketLost" }]);
    expect(dropped.state.phase).toBe("connecting");
    expect(dropped.state.killing).toBe(true); // the cancel is a CHAT-side act; the leg says nothing
    expect(dropped.out).toEqual([{ type: "reconnect", delayMs: 400 }]);

    // The settlement lands while the leg is still down: the queue is held by `connecting` now…
    const settled = run(dropped.state, [{ type: "killSettled" }]);
    expect(submits(settled.out)).toEqual([]);
    expect(settled.state.phase).toBe("connecting"); // the restore does NOT repaint a leg that is down
    // …and the fresh leg is what finally releases it.
    expect(submits(run(settled.state, [{ type: "ready" }]).out)).toEqual(["the other thing"]);
  });

  it("F6: …and in the other order — the leg comes back first, the settlement releases it", () => {
    const killing = run(speaking, [{ type: "barge" }]).state;
    const queued = run(killing, [
      { type: "final", text: "the other thing" },
      { type: "socketLost" },
    ]).state;
    const back = run(queued, [{ type: "ready" }]);
    expect(submits(back.out)).toEqual([]); // still killing: the §4.3 order outranks the fresh leg
    expect(submits(run(back.state, [{ type: "killSettled" }]).out)).toEqual(["the other thing"]);
  });

  it("F6: a drop mid-utterance loses it — and `ready` never resurrects the wait", () => {
    const mid = run(listening, [{ type: "speechStart" }, { type: "speechStop" }]).state;
    expect(mid.waitingFinal).toBe(true);
    const dropped = run(mid, [{ type: "socketLost" }]).state;
    expect(dropped.waitingFinal).toBe(false);
    const back = run(dropped, [{ type: "ready" }]).state;
    expect(back.waitingFinal).toBe(false);
    expect(back.userSpeechActive).toBe(false);
    // …and a straggler final from the DEAD leg is not the owner's next message either: with the flag
    // cleared it is simply an utterance, which is what the leg fence upstairs is for. What must not
    // happen is the iron rule going on killing replies over a transcript nobody is waiting for.
    const reply = run(back, [{ type: "playbackStarted" }]);
    expect(reply.out).toEqual([]);
    expect(reply.state.phase).toBe("speaking");
  });

  it("F6: the attempt budget is exactly the backoff schedule, then the `lost` terminal", () => {
    let s = listening;
    const delays: number[] = [];
    for (let i = 0; i < 4; i++) {
      const step = run(s, [{ type: "socketLost" }]);
      s = step.state;
      for (const e of step.out) if (e.type === "reconnect") delays.push(e.delayMs);
      // Every leg that comes back resets the budget, which is why the count is per RUN of failures.
      expect(s.attempts).toBe(i + 1);
    }
    expect(delays).toEqual([400, 900, 1800, 3000]);
    const done = run(s, [{ type: "socketLost" }]);
    expect(done.state.phase).toBe("error");
    expect(done.state.note).toBe(CALL_COPY.lost);

    // …and a leg that DID come back in the middle starts the budget over.
    const recovered = run(run(listening, [{ type: "socketLost" }]).state, [
      { type: "ready" },
    ]).state;
    expect(recovered.attempts).toBe(0);
  });

  it("F6: the strained note survives its own reconnect exactly once", () => {
    const strained = run(listening, [{ type: "degraded" }]);
    expect(strained.out).toEqual([{ type: "degradeHold" }]);
    // The fresh leg retracts it — connection news a new connection makes obsolete…
    const back = run(strained.state, [{ type: "socketLost" }, { type: "ready" }]).state;
    expect(back.note).toBeNull();
    // …and the hold armed by the OLD leg, landing late, has nothing left to clear and clobbers nothing.
    const late = run(back, [{ type: "playbackFailed" }, { type: "degradedOver" }]).state;
    expect(late.note).toBe(CALL_COPY.voiceFailed);
    // A degrade on the NEW leg still says its piece, and re-arms its own hold.
    const again = run(back, [{ type: "degraded" }]);
    expect(again.state.note).toBe(CALL_COPY.strained);
    expect(again.out).toEqual([{ type: "degradeHold" }]);
  });

  it("F6: a confirm gate outstanding across a reconnect still holds — and releases ONCE", () => {
    const held = run(listening, [
      { type: "confirmHold", on: true },
      { type: "final", text: "yes" },
      { type: "socketLost" },
      { type: "final", text: "go ahead" },
    ]);
    expect(submits(held.out)).toEqual([]);
    const back = run(held.state, [{ type: "ready" }]);
    expect(submits(back.out)).toEqual([]); // the gate outranks the fresh leg
    const allowed = run(back.state, [{ type: "confirmHold", on: false }]);
    expect(submits(allowed.out)).toEqual(["yes go ahead"]);
    expect(allowed.state.pending).toEqual([]);
  });

  it("the ear-hold rides the sweep too: nothing leaks in while the reply speaks, kill or drop", () => {
    // The hold closes on the MOUTH, so it must survive everything that moves the phase around it.
    const dropped = run(holdingSpeaking, [{ type: "socketLost" }]).state;
    expect(dropped.earHeld).toBe(true); // the reply is still audible — the leg is irrelevant
    expect(run(dropped, [{ type: "final", text: "the bot's own words" }]).state.pending).toEqual(
      [],
    );
    const back = run(dropped, [{ type: "ready" }]).state;
    expect(back.phase).toBe("speaking");
    expect(back.earHeld).toBe(true);
    // Only the mouth stopping — or the owner interrupting — opens it.
    expect(run(back, [{ type: "playbackDrained" }]).state.earHeld).toBe(false);
    expect(run(back, [{ type: "barge" }]).state.earHeld).toBe(false);
  });
});

describe("callReduce — the page going away (§5.3)", () => {
  it("ends the call CLEANLY, like a hang-up and not like a failure", () => {
    const { state, out } = run(speaking, [{ type: "hidden" }]);
    expect(state.phase).toBe("ended");
    expect(out).toEqual([{ type: "teardown", close: true }]);
  });
});

describe("callReduce — the unmount fence (S2b audit — §4.3 hang-up-discards, one task late)", () => {
  it("moves the generation and discards the queue, so an in-flight callback is a ghost", () => {
    const queued = run(listening, [
      { type: "confirmHold", on: true }, // hold the queue open so a `final` stays pending
      { type: "final", text: "left unsaid" },
    ]).state;
    const { state } = run(queued, [{ type: "unmounted" }]);
    expect(state.gen).toBe(queued.gen + 1);
    expect(state.pending).toEqual([]); // a deliberate exit DISCARDS — never a harvest
    // …and the discarded final's own signals, armed under the old generation, no longer land.
    const late = callReduce(state, { type: "final", text: "too late", gen: queued.gen });
    expect(late.out).toEqual([]);
    expect(late.state).toBe(state);
  });

  it("tears down WITHOUT `close` — a redial's remount must not be endCall'd by the old machine", () => {
    const { out } = run(listening, [{ type: "unmounted" }]);
    expect(out).toEqual([{ type: "teardown", close: false }]);
  });

  it("outranks the terminal guard, exactly as hang-up does", () => {
    const dead = run(listening, [{ type: "failed", note: "x" }]).state;
    const { state } = run(dead, [{ type: "unmounted" }]);
    expect(state.gen).toBe(dead.gen + 1);
  });
});
