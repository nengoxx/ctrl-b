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

  it("`degraded` is a line, not a state change", () => {
    const { state, out } = run(speaking, [{ type: "degraded" }]);
    expect(state.phase).toBe("speaking");
    expect(state.note).toBe(CALL_COPY.strained);
    expect(out).toEqual([]);
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
    const dropped = run(speaking, [
      { type: "final", text: "held over the reconnect" },
      { type: "socketLost" },
    ]).state;
    expect(dropped.attempts).toBe(1);
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

describe("callReduce — the page going away (§5.3)", () => {
  it("ends the call CLEANLY, like a hang-up and not like a failure", () => {
    const { state, out } = run(speaking, [{ type: "hidden" }]);
    expect(state.phase).toBe("ended");
    expect(out).toEqual([{ type: "teardown", close: true }]);
  });
});
