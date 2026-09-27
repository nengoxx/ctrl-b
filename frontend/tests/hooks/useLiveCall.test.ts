import { describe, expect, it } from "vitest";

import {
  CALL_COPY,
  CALL_INITIAL,
  callReduce,
  type CallEffect,
  type CallSignal,
  type CallState,
  type HoldMode,
  mouthMayOpen,
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
  // §4.2's iron rule — no playback while either flag holds — is enforced at the controller's gate by
  // WAITING (the owner's 2026-09-26 ruling): `mouthMayOpen` is the gate's whole answer.
  it("HOLDS the mouth while the owner is speaking", () => {
    const mid = run(listening, [{ type: "speechStart" }]).state;
    expect(mouthMayOpen(mid)).toBe(false);
  });

  it("…and while the final is still in flight (the speech-stop → transcript gap)", () => {
    const waiting = run(listening, [{ type: "speechStart" }, { type: "speechStop" }]).state;
    expect(waiting.waitingFinal).toBe(true);
    expect(mouthMayOpen(waiting)).toBe(false);
    // …and the transcript landing is what lets it go.
    expect(mouthMayOpen(run(waiting, [{ type: "final", text: "hi" }]).state)).toBe(true);
  });

  it("…and while the phase is ALREADY `speaking` — the read-along gap scenario", () => {
    // A chunked reply pauses for synthesis mid-message and resumes: the phase never left `speaking`.
    // If the owner started talking during that gap, the resume waits for them (the controller gates
    // the post-gap edge) — and nothing is cancelled.
    const talking = run(speaking, [{ type: "speechStart" }]).state;
    expect(mouthMayOpen(talking)).toBe(false);
    expect(talking.killing).toBe(false);
  });

  it("with both flags clear, playback simply starts", () => {
    expect(mouthMayOpen(listening)).toBe(true);
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
    // A tap across the reconnect window, then the fresh leg: the kill silenced the mouth, so `ready`
    // lands on `listening` and `killing` is the ONLY thing holding here — no `speaking` phase, no
    // confirm, no upload. Every release path must still refuse to submit.
    const killing = run(speaking, [
      { type: "socketLost" },
      { type: "barge" },
      { type: "ready" },
      { type: "speechStart" },
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

  it("`busy` on the FIRST dial names the other call; `session_limit` is a clean end, not an error", () => {
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
    // …and the same CLASS from the relay's uplink-idle reaper (R86 LC-8) carries its own sentence.
    const reaped = run(listening, [
      {
        type: "serverError",
        code: "session_limit",
        message: "no audio from the phone for 15s — the call was ended",
      },
    ]);
    expect(reaped.state.phase).toBe("ended");
    expect(reaped.state.note).toBe("no audio from the phone for 15s — the call was ended");
  });

  it("a `protocol` terminal says so plainly — never the relay's internal sentence (A-F2)", () => {
    const { state } = run(listening, [
      {
        type: "serverError",
        code: "protocol",
        message: "uplink frame rate exceeded: 4040 ms of audio in 2s (2× realtime is 4000 ms)",
      },
    ]);
    expect(state.phase).toBe("error");
    expect(state.note).toBe(CALL_COPY.protocol);
    // …and the default arm still echoes, because an unknown code has nothing better to say.
    expect(
      run(listening, [{ type: "serverError", code: "weird_new_code", message: "something else" }])
        .state.note,
    ).toBe("something else");
  });

  it("`upstream_error` is NONFATAL — the relay keeps the session, so the client must too", () => {
    const { state, out } = run(listening, [
      { type: "serverError", code: "upstream_error", message: "the ear hiccuped" },
    ]);
    expect(state.phase).toBe("listening");
    expect(state.note).toBe("the ear hiccuped");
    expect(out).toEqual([]);
  });

  it("`upstream_error` is what arrives INSTEAD of the final — the wait clears (R86 LC-2)", () => {
    // Speaches answers a transcription that raised with `error` and never `…completed`. A
    // `waitingFinal` left standing was an iron-rule kill of every reply for the rest of the call.
    const thinking = run(listening, [{ type: "final", text: "what's the weather" }]).state;
    const errored = run(thinking, [
      { type: "speechStart" },
      { type: "speechStop" },
      { type: "serverError", code: "upstream_error", message: "the ear hiccuped" },
    ]).state;
    expect(errored.waitingFinal).toBe(false);
    const { state, out } = run(errored, [{ type: "playbackStarted" }]);
    expect(out).toEqual([]); // no `kill`
    expect(state.phase).toBe("speaking");
    // …and only THAT flag: a segment still live when the error lands is the owner, mid-word.
    const live = run(listening, [
      { type: "speechStart" },
      { type: "serverError", code: "upstream_error", message: "x" },
    ]).state;
    expect(live.userSpeechActive).toBe(true);
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
    for (let i = 0; i < 6; i++) {
      const step = run(s, [{ type: "socketLost" }]);
      s = step.state;
      expect(s.phase).toBe("connecting");
      expect(s.userSpeechActive).toBe(false);
      expect(s.waitingFinal).toBe(false);
      for (const e of step.out) if (e.type === "reconnect") delays.push(e.delayMs);
    }
    expect(delays).toEqual([400, 900, 1800, 3000, 4000, 4000]);

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

  // ── `busy` mid-reconnect (A-F3, evidence docs/research/R72) ─────────────────────────────────────
  //
  // A first, user-initiated dial that gets `busy` really is another device on the call, and it stays
  // terminal (pinned above, and by `e2e/liveCall.spec.ts`). The same refusal DURING a reconnect is the
  // opposite fact: one user, one install, so the session holding the slot is this phone's own dead leg
  // that the relay has not reaped yet — and ending the call there tells the owner something both wrong
  // and unactionable.

  /** A call whose leg has just dropped: `attempts` is 1 and a redial is armed. */
  const reconnecting = run(listening, [{ type: "socketLost" }]).state;

  it("mid-reconnect it is a NOTE, not a terminal — the ladder keeps its own counsel", () => {
    const { state, out } = run(reconnecting, [
      { type: "serverError", code: "busy", message: "a live call is already running" },
    ]);
    expect(state.phase).toBe("connecting"); // not `error`: the redial is still the plan
    expect(state.note).toBe(CALL_COPY.busyRetrying);
    expect(out).toEqual([]); // …and it drives NOTHING — see the case below for why
    expect(state.attempts).toBe(1); // no counter of its own, and no rung burned here
  });

  it("H2: a busy refusal + its close consume exactly ONE attempt", () => {
    // A busy refusal is TWO events on the wire: the typed frame, then the 1013 close that always
    // follows it. The close is what the existing `socketLost` arm reconnects from — so if the busy arm
    // ALSO reconnected, every refusal would burn two rungs and the ladder would end in half the time
    // it is sized for.
    const refused = run(reconnecting, [
      { type: "serverError", code: "busy", message: "a live call is already running" },
    ]).state;
    const closed = run(refused, [{ type: "socketLost" }]);
    expect(closed.state.attempts).toBe(2);
    expect(closed.out).toEqual([{ type: "reconnect", delayMs: 900 }]); // the SECOND rung, not the third
  });

  it("…and a ladder spent on busy refusals still ends — bounded, on the BUSY truth", () => {
    // Bounded is half of it; the other half is WHICH story it ends on. Every rung here was answered,
    // not lost, so `lost` would point the owner at their own link for a slot the relay is holding.
    let s = reconnecting;
    for (let i = 0; i < 5; i++) {
      s = run(s, [
        { type: "serverError", code: "busy", message: "still busy" },
        { type: "socketLost" },
      ]).state;
    }
    expect(s.attempts).toBe(6);
    const done = run(s, [
      { type: "serverError", code: "busy", message: "still busy" },
      { type: "socketLost" },
    ]);
    expect(done.state.phase).toBe("error");
    expect(done.state.note).toBe(CALL_COPY.busyHeld);
    // …while a ladder spent on genuine DROPS still ends on `lost`: the note is what tells them apart.
    let dropped = reconnecting;
    for (let i = 0; i < 5; i++) dropped = run(dropped, [{ type: "socketLost" }]).state;
    expect(run(dropped, [{ type: "socketLost" }]).state.note).toBe(CALL_COPY.lost);
  });

  it("…and a leg that comes back retracts the busy note: it is connection news", () => {
    const refused = run(reconnecting, [
      { type: "serverError", code: "busy", message: "a live call is already running" },
    ]).state;
    expect(run(refused, [{ type: "ready" }]).state.note).toBeNull();
    // …while anything that is NOT connection news still survives the fresh leg (S2b confirm F3).
    const failed = run(refused, [{ type: "playbackFailed" }]).state;
    expect(run(failed, [{ type: "ready" }]).state.note).toBe(CALL_COPY.voiceFailed);
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
    // …which is also what keeps §4.2's iron rule from holding the mouth forever for a final that is
    // never coming: `waitingFinal` cannot be left standing on words nobody is going to send.
    expect(state.waitingFinal).toBe(false);
    expect(mouthMayOpen(state)).toBe(true);
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

/** A call on a track whose AEC is NOT the subtractive mode (Fennec, §7-S0 ③) under `mic_hold: auto` —
 *  the ear-hold's own: the D73 rule holds the WHOLE reply (D80 ⑤). */
const holding = run(CALL_INITIAL, [
  { type: "captureReady", holdMode: "auto", ecAll: false, route: "call", deviceId: "" },
  { type: "ready" },
]).state;
/** …and the same call with the reply speaking, i.e. with the ear actually closed. */
const holdingSpeaking = run(holding, [
  { type: "final", text: "tell me a story" },
  { type: "playbackStarted" },
]).state;
/** The wiring's verdict on the tail standing now (D80 ①): the room went quiet. */
const release = (st: CallState): CallState =>
  run(st, [{ type: "tailOver", seq: st.tailSeq, reason: "quiet" }]).state;

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
    // (A SUBTRACTIVE track, so the words spoken over the replacement are the owner's and queue — on a
    // held one they would be the replacement's own leak, dropped flat since D80 took `!killing` out of
    // the hold: see the held half below.)
    const open = run(CALL_INITIAL, [
      { type: "captureReady", holdMode: "auto", ecAll: true, route: "call", deviceId: "" },
      { type: "ready" },
      { type: "final", text: "tell me a story" },
      { type: "playbackStarted" },
    ]).state;
    const killing = run(open, [{ type: "barge" }]).state;
    const replaced = run(killing, [
      { type: "playbackStarted" },
      { type: "final", text: "no, the other one" },
    ]);
    expect(replaced.state.mouthLive).toBe(true);
    expect(submits(replaced.out)).toEqual([]); // the kill still holds the queue
    const settled = run(replaced.state, [{ type: "killSettled" }]);
    expect(settled.state.phase).toBe("speaking"); // the mouth is audible — the screen must say so
    expect(submits(settled.out)).toEqual([]); // …and `speaking` is itself a hold: nothing drains yet
    const over = run(settled.state, [{ type: "playbackDrained" }]);
    expect(submits(over.out)).toEqual(["no, the other one"]); // the REAL drain is the release
    expect(over.state.phase).toBe("thinking"); // …and the submit puts the brain to work
    // …and on a HELD track the same settlement keeps the leak protection standing over the live audio.
    const heldSettled = run(holdingSpeaking, [
      { type: "barge" },
      { type: "playbackStarted" },
      { type: "killSettled" },
    ]).state;
    expect(heldSettled.phase).toBe("speaking");
    expect(heldSettled.earHeld).toBe(true);
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

describe("callReduce — the Fennec EAR-HOLD (S3 · `mic_hold`, D76 §B)", () => {
  it("closes the ear while the reply speaks, and opens it when the reply's TAIL is over (D80 ①)", () => {
    expect(holding.holdMode).toBe("auto");
    expect(holding.ecAll).toBe(false);
    expect(holding.earHeld).toBe(false); // nothing is speaking yet
    expect(holdingSpeaking.earHeld).toBe(true);
    const drained = run(holdingSpeaking, [{ type: "playbackDrained" }]).state;
    expect(drained.earHeld).toBe(true); // the element is done; the car may not be
    expect(drained.tail).toBe(true);
    expect(release(drained).earHeld).toBe(false);
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

  it("…and keeps taking them the moment the tail releases", () => {
    const open = release(run(holdingSpeaking, [{ type: "playbackDrained" }]).state);
    const { out } = run(open, [{ type: "final", text: "what happened next" }]);
    expect(submits(out)).toEqual(["what happened next"]);
  });

  it("a KILL passes the hold to the TAIL — a tap silences the element, not the car's buffer (D80 ①)", () => {
    // The `!killing` release this replaces opened the ear the instant the owner tapped — into ~2.3 s of
    // reply the car had already buffered (the trail's two `barge` taps under a loud tail). The queue's
    // ORDERING is untouched: the kill still holds it until the cancel settles; the tail only keeps the
    // EAR closed, and the interrupting words land once the room is quiet.
    const tapped = run(holdingSpeaking, [{ type: "barge" }]);
    expect(tapped.state.killing).toBe(true);
    expect(tapped.state.tail).toBe(true);
    expect(tapped.state.earHeld).toBe(true);
    const settled = run(tapped.state, [{ type: "killSettled" }]).state;
    expect(settled.phase).toBe("listening");
    const inTail = run(settled, [{ type: "final", text: "the car's buffered tail" }]);
    expect(submits(inTail.out)).toEqual([]); // still the reply, dropped flat
    const spoken = run(release(settled), [{ type: "final", text: "no, the other one" }]);
    expect(submits(spoken.out)).toEqual(["no, the other one"]);
  });

  it("a track whose AEC subtracts holds NOTHING — walkie-talkie speech still transcribes", () => {
    // The Chrome branch of the S0 ruling: the ear stays open under the reply, which is what makes both
    // voice barge-in and `barge_in: false` walkie-talkie semantics possible at all.
    const subtracting = run(CALL_INITIAL, [
      { type: "captureReady", holdMode: "auto", ecAll: true, route: "call", deviceId: "" },
      { type: "ready" },
      { type: "final", text: "hello" },
      { type: "playbackStarted" },
    ]).state;
    expect(subtracting.mouthLive).toBe(true);
    expect(subtracting.earHeld).toBe(false);
    const { state } = run(subtracting, [{ type: "final", text: "wait" }]);
    expect(state.pending).toEqual(["wait"]);
  });

  it("MUTE and the hold are independent rules — neither answers for the other", () => {
    const muted = run(holdingSpeaking, [{ type: "setMuted", on: true }]).state;
    expect(muted.earHeld).toBe(true);
    // Unmuting under a live hold leaves the ear closed: the reply is still speaking.
    const unmuted = run(muted, [{ type: "setMuted", on: false }]).state;
    expect(unmuted.muted).toBe(false);
    expect(unmuted.earHeld).toBe(true);
    // …and the drain hands it to the tail, whose release opens it for real.
    expect(release(run(unmuted, [{ type: "playbackDrained" }]).state).earHeld).toBe(false);
  });

  it("a TERMINAL releases the hold AND forgets the mode — the track it described is gone", () => {
    const { state } = run(holdingSpeaking, [{ type: "captureLost" }]);
    expect(state.earHeld).toBe(false);
    expect(state.holdMode).toBe("off");
    expect(state.ecAll).toBe(false);
  });

  it("a REDIAL re-reads the mode from its own track — nothing is inherited", () => {
    expect(CALL_INITIAL.holdMode).toBe("off");
    expect(run(holdingSpeaking, [{ type: "hangup" }]).state.holdMode).toBe("off");
  });
});

// ── D80 ⑤: `mic_hold: auto` IS THE D73 RULE — the per-chunk leak probe is deleted ────────────────

/** A connected call on a capture under the given policy, optionally with a reply speaking. */
function holdCall(holdMode: HoldMode, ecAll: boolean, speakingNow = true): CallState {
  const ready = run(CALL_INITIAL, [
    { type: "captureReady", holdMode, ecAll, route: "media", deviceId: "" },
    { type: "ready" },
  ]).state;
  if (!speakingNow) return ready;
  return run(ready, [{ type: "final", text: "tell me a story" }, { type: "playbackStarted" }])
    .state;
}

describe("callReduce — `mic_hold` is the D73 rule (D80 ⑤, the probe deleted)", () => {
  it("the `earHeld` truth table: holdMode × ecAll, while the mouth is live", () => {
    // The probe judged each chunk in its first 600 ms — before a car had emitted a sample (D80 ③).
    // What is left is a policy read ONCE from the track: `auto` holds wherever the canceller does not
    // subtract, exactly like `on`; `on` outranks even a subtractive canceller; `off` never holds.
    const rows: [HoldMode, boolean, boolean][] = [
      // holdMode, ecAll → earHeld (mouth LIVE)
      ["on", false, true],
      ["on", true, true],
      ["off", false, false],
      ["off", true, false],
      ["auto", false, true], // a leaking readback holds — like `on`
      ["auto", true, false], // the canceller subtracts the reply: never held
    ];
    for (const [holdMode, ecAll, held] of rows) {
      const st = holdCall(holdMode, ecAll);
      const label = `${holdMode}/${ecAll ? "all" : "leaky"}`;
      expect(st.mouthLive, label).toBe(true);
      expect(st.earHeld, label).toBe(held);
      // …and with the mouth silent and nothing armed, nothing is held whatever the policy says.
      expect(holdCall(holdMode, ecAll, false).earHeld, `${label}/silent`).toBe(false);
    }
  });

  it("`auto` without a subtractive canceller holds the WHOLE reply — every chunk, no verdict", () => {
    const held = holdCall("auto", false);
    // A synthesis gap's edge (the mouth re-starting mid-reply) changes nothing: it is still held.
    expect(run(held, [{ type: "playbackStarted" }]).state.earHeld).toBe(true);
    // …and what the ear hears under it is dropped flat.
    const { state } = run(held, [{ type: "final", text: "…and then the dragon said" }]);
    expect(state.pending).toEqual([]);
  });

  it("a RECAPTURE mid-reply re-reads the policy from the FRESH track (§5.1)", () => {
    const cycled = run(holdCall("auto", false), [{ type: "routeChange", route: "call" }]).state;
    expect(cycled.holdMode).toBe("off"); // the hold belongs to the track, and that track is gone
    const fresh = run(cycled, [
      { type: "captureReady", holdMode: "auto", ecAll: false, route: "call", deviceId: "" },
    ]).state;
    expect(fresh.mouthLive).toBe(true);
    expect(fresh.earHeld).toBe(true); // held at once under the reply still speaking
  });

  it("a fresh capture that comes back SUBTRACTIVE is never held, mid-reply or not", () => {
    const released = run(holdCall("auto", false), [{ type: "routeChange", route: "call" }]).state;
    const fresh = run(released, [
      { type: "captureReady", holdMode: "auto", ecAll: true, route: "call", deviceId: "" },
    ]).state;
    expect(fresh.mouthLive).toBe(true);
    expect(fresh.earHeld).toBe(false);
  });
});

describe("callReduce — THE TAIL HOLD (D80 ①: the ear reopens on observed quiet, never on the element)", () => {
  it("every fall of the mouth under a holding policy ARMS a tail — drain, failure and kill alike", () => {
    for (const end of [
      { type: "playbackDrained" },
      { type: "playbackFailed" },
      { type: "barge" },
    ] as CallSignal[]) {
      const after = run(holdCall("on", false), [end]).state;
      expect(after.mouthLive, end.type).toBe(false);
      expect(after.tail, end.type).toBe(true);
      expect(after.tailSeq, end.type).toBe(1);
      expect(after.earHeld, end.type).toBe(true);
    }
  });

  it("the policy decides whether there is a tail at all — `off` never, `auto` + a subtractive canceller never", () => {
    const rows: [HoldMode, boolean, boolean][] = [
      ["on", false, true],
      ["on", true, true],
      ["auto", false, true],
      ["auto", true, false], // the canceller subtracted the reply — there is no tail to hold
      ["off", false, false],
      ["off", true, false],
    ];
    for (const [holdMode, ecAll, tail] of rows) {
      const after = run(holdCall(holdMode, ecAll), [{ type: "playbackDrained" }]).state;
      expect(after.tail, `${holdMode}/${ecAll}`).toBe(tail);
      expect(after.earHeld, `${holdMode}/${ecAll}`).toBe(tail);
    }
  });

  it("`tailOver` for THIS arming releases it; a stale arming or a dead generation frees nothing", () => {
    const tail = run(holdCall("on", false), [{ type: "playbackDrained" }]).state;
    const stale = run(tail, [{ type: "tailOver", seq: tail.tailSeq - 1, reason: "quiet" }]).state;
    expect(stale.earHeld).toBe(true);
    const ghost = callReduce(tail, {
      type: "tailOver",
      seq: tail.tailSeq,
      reason: "cap",
      gen: tail.gen - 1,
    }).state;
    expect(ghost.earHeld).toBe(true);
    for (const reason of ["quiet", "cap"] as const) {
      const over = callReduce(tail, { type: "tailOver", seq: tail.tailSeq, reason, gen: tail.gen });
      expect(over.state.tail).toBe(false);
      expect(over.state.earHeld).toBe(false);
      expect(over.out).toEqual([]);
    }
  });

  it("every release reason ends its own arming alike — the measured `lag`/`noleak` (D80 ⑦) as the rest", () => {
    const tail = run(holdCall("on", false), [{ type: "playbackDrained" }]).state;
    for (const reason of ["lag", "noleak", "kill", "quiet", "cap"] as const) {
      const over = run(tail, [{ type: "tailOver", seq: tail.tailSeq, reason }]).state;
      expect(over.earHeld, reason).toBe(false);
      expect(over.tail, reason).toBe(false);
    }
  });

  it("a mouth that RE-STARTS during the tail takes it back; its next fall arms a NEW one", () => {
    const first = run(holdCall("on", false), [{ type: "playbackDrained" }]).state;
    const again = run(first, [{ type: "playbackStarted" }]).state;
    expect(again.tail).toBe(false);
    expect(again.earHeld).toBe(true); // held by the mouth now
    const second = run(again, [{ type: "playbackDrained" }]).state;
    expect(second.tail).toBe(true);
    expect(second.tailSeq).toBe(first.tailSeq + 1);
    // …and the FIRST tail's release, measured late, frees nothing.
    expect(
      run(second, [{ type: "tailOver", seq: first.tailSeq, reason: "quiet" }]).state.earHeld,
    ).toBe(true);
  });

  it("a ROUTE CYCLE and every TERMINAL clear it — the ear it held is gone", () => {
    const tail = run(holdCall("on", false), [{ type: "playbackDrained" }]).state;
    expect(tail.phase).toBe("listening");
    const cycled = run(tail, [{ type: "routeChange", route: "call" }]).state;
    expect(cycled.tail).toBe(false);
    expect(cycled.earHeld).toBe(false);
    for (const end of [{ type: "captureLost" }, { type: "hangup" }] as CallSignal[]) {
      const after = run(tail, [end]).state;
      expect(after.tail, end.type).toBe(false);
      expect(after.earHeld, end.type).toBe(false);
    }
  });

  it("a KILL on a policy that does not hold arms nothing — there is no ear to keep closed", () => {
    for (const [holdMode, ecAll] of [
      ["off", false],
      ["auto", true],
    ] as [HoldMode, boolean][]) {
      const tapped = run(holdCall(holdMode, ecAll), [{ type: "barge" }]).state;
      expect(tapped.killing, holdMode).toBe(true);
      expect(tapped.tail, holdMode).toBe(false);
      expect(tapped.earHeld, holdMode).toBe(false);
    }
  });

  it("the KILL's own step is the one where `killing` rises — the wiring's deadline bit reads that edge", () => {
    const tapped = run(holdCall("on", false), [{ type: "barge" }]);
    expect(tapped.state.tail && tapped.state.killing).toBe(true);
    expect(tapped.state.tailSeq).toBe(1);
    // …and a `tailOver` reason `kill` releases it like any other, for its own arming only.
    const over = run(tapped.state, [
      { type: "tailOver", seq: tapped.state.tailSeq, reason: "kill" },
    ]).state;
    expect(over.earHeld).toBe(false);
  });

  it("MUTE leaves it standing — a muted ear uplinks silence either way, and the tail is about the room", () => {
    const tail = run(holdCall("on", false), [{ type: "playbackDrained" }]).state;
    const muted = run(tail, [{ type: "setMuted", on: true }]).state;
    expect(muted.tail).toBe(true);
    const unmuted = run(muted, [{ type: "setMuted", on: false }]).state;
    expect(unmuted.tail).toBe(true);
    expect(unmuted.earHeld).toBe(true);
  });

  it("finals and VAD events inside the tail are the reply's, dropped flat — the phase is already `listening`", () => {
    const tail = run(holdCall("on", false), [{ type: "playbackDrained" }]).state;
    expect(tail.phase).toBe("listening"); // the machine's phase does not change — only the face does
    const { state, out } = run(tail, [
      { type: "speechStart", itemId: "echo" },
      { type: "speechStop", itemId: "echo" },
      { type: "final", text: "Text me when you can. I'll be here.", itemId: "echo" },
    ]);
    expect(state.userSpeechActive).toBe(false);
    expect(state.waitingFinal).toBe(false);
    expect(submits(out)).toEqual([]);
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

  it("F5: the owner talking on while the reply is READY holds the mouth — and their words go FIRST", () => {
    // The reply to "what's the weather" is ready, but the owner is still talking: the mouth waits
    // (nothing cancelled, the reply persists), their follow-up lands and goes out as the running turn's
    // steer (D41), and only then does the reply start — no kill anywhere in the sequence.
    const thinking = run(listening, [{ type: "final", text: "what's the weather" }]).state;
    const mid = run(thinking, [{ type: "speechStart" }]).state;
    expect(mouthMayOpen(mid)).toBe(false);
    const gap = run(mid, [{ type: "speechStop" }]).state;
    expect(mouthMayOpen(gap)).toBe(false); // …and through the transcript's round-trip
    const heard = run(gap, [{ type: "final", text: "and tomorrow" }]);
    expect(submits(heard.out)).toEqual(["and tomorrow"]);
    expect(mouthMayOpen(heard.state)).toBe(true);
    const reply = run(heard.state, [{ type: "playbackStarted" }]);
    expect(reply.out).toEqual([]);
    expect(reply.state.phase).toBe("speaking");
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
    for (let i = 0; i < 6; i++) {
      const step = run(s, [{ type: "socketLost" }]);
      s = step.state;
      for (const e of step.out) if (e.type === "reconnect") delays.push(e.delayMs);
      // Every leg that comes back resets the budget, which is why the count is per RUN of failures.
      expect(s.attempts).toBe(i + 1);
    }
    // THE LADDER SPANS THE RELAY'S SLOT (A-F3 / R72 §4): the relay holds a dead phone's session until
    // its ws ping times out — 10.0 s worst case at the 5/5 the launch sites now run — so a ladder that
    // gave up at 6.1 s spent every rung inside the window where its own zombie slot answers `busy`.
    expect(delays).toEqual([400, 900, 1800, 3000, 4000, 4000]);
    expect(delays.reduce((a, b) => a + b, 0)).toBeGreaterThan(10_000);
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
    // Only the mouth stopping — or the owner interrupting — ends the reply, and even then the TAIL
    // holds (D80 ①): the ear reopens on the room going quiet, never on the element.
    for (const end of [{ type: "playbackDrained" }, { type: "barge" }] as CallSignal[]) {
      const after = run(back, [end]).state;
      expect(after.tail).toBe(true);
      expect(after.earHeld).toBe(true);
      const quiet = run(after, [{ type: "tailOver", seq: after.tailSeq, reason: "quiet" }]).state;
      expect(quiet.earHeld).toBe(false);
    }
  });
});

describe("callReduce — the page going away (§5.3)", () => {
  it("ends the call CLEANLY, like a hang-up and not like a failure", () => {
    // Since D73 S6 the WIRING decides who sends this — `pagehide` always, `visibilitychange` only
    // with `background` off — but the rule it lands on is unchanged, and still shared with hang-up.
    const { state, out } = run(speaking, [{ type: "hidden" }]);
    expect(state.phase).toBe("ended");
    expect(out).toEqual([{ type: "teardown", close: true }]);
  });
});

describe("callReduce — THE BACKGROUND WAVE (D73 S6, evidence docs/research/R75)", () => {
  // ② THE EAR-OUTAGE. The freeze is SILENT: the audio graph is paused, so no frames are minted, while
  // the track stays live, the socket stays open and the overlay goes on saying Listening. The machine's
  // whole job here is to stop presenting a resumed call as if it heard.

  it("② lands on the reconnect, says what was missed, and closes the leg — nothing more", () => {
    const { state, out } = run(listening, [{ type: "earOutage" }]);
    expect(state.phase).toBe("connecting");
    expect(state.note).toBe(CALL_COPY.earAsleep);
    expect(out).toEqual([{ type: "closeLeg" }]);
    // The LADDER keeps its own accounting: the close this effect asks for is what the existing
    // `socketLost` arm reconnects from, and it is that arm — not this one — that spends a rung.
    expect(state.attempts).toBe(0);
    const closed = run(state, [{ type: "socketLost" }]);
    expect(closed.state.attempts).toBe(1);
    expect(closed.out).toEqual([{ type: "reconnect", delayMs: 400 }]);
  });

  it("② is a NO-OP once the reconnect owns the phase — one outage closes one leg", () => {
    // Freeze recovery overlaps the track's own mute events and the socket's death by nature, so
    // `visible`, the Lifecycle `resume` and a close can all land at about the same instant.
    const reconnecting = run(listening, [{ type: "earOutage" }]).state;
    const again = run(reconnecting, [{ type: "earOutage" }]);
    expect(again.out).toEqual([]);
    expect(again.state).toBe(reconnecting);
    // …and a call that already ended is not redialled by a wake event either.
    const dead = run(listening, [{ type: "hangup" }]).state;
    expect(run(dead, [{ type: "earOutage" }]).out).toEqual([]);
  });

  it("② leaves the MOUTH alone — a reply mid-sentence keeps speaking through it (S3)", () => {
    const { state } = run(speaking, [{ type: "earOutage" }]);
    expect(state.mouthLive).toBe(true); // C3 rides HTTP; the ear's outage says nothing about it
    expect(state.phase).toBe("connecting");
  });

  it("② the note SURVIVES the fresh leg — what was missed is not connection news", () => {
    // `ready` retracts connection news because a live connection has just made it false. This is a
    // statement about a stretch of conversation the ear never heard, which reconnecting cannot undo —
    // and a note retracted 400 ms later is one the owner never read.
    const back = run(run(listening, [{ type: "earOutage" }]).state, [{ type: "ready" }]);
    expect(back.state.phase).toBe("listening");
    expect(back.state.note).toBe(CALL_COPY.earAsleep);
  });

  // ④ THE BACKGROUND IDLE END. The wiring owns the clock (only while hidden, paused by a confirm
  // gate); what the reducer owns is the disposition.

  it("④ the idle expiry is a clean END with the reason on it, never an error", () => {
    const { state, out } = run(listening, [{ type: "idleExpired" }]);
    expect(state.phase).toBe("ended"); // a hot mic in a pocket is not a failure
    expect(state.note).toBe(CALL_COPY.idleBackground);
    expect(out).toEqual([{ type: "teardown", close: false }]);
  });

  it('④ …but NOT over a reply still talking — the window is "no speech AND no reply" (R86 LC-6)', () => {
    // A seamless chunked reply publishes no edge between chunks, so a long answer can outlast a short
    // window. The arm declines; the wiring re-arms on the same signal.
    const { state, out } = run(speaking, [{ type: "idleExpired" }]);
    expect(out).toEqual([]);
    expect(state).toBe(speaking);
    // …and once the mouth has drained, the next expiry ends it as ever.
    const drained = run(speaking, [{ type: "playbackDrained" }, { type: "idleExpired" }]);
    expect(drained.state.phase).toBe("ended");
  });

  it("④ …nor over the OWNER still talking, or their final still in flight (R88 E-2)", () => {
    // A sentence can outlast a short window (`speechStart` re-armed it once), and a final can still be
    // in the air after the stop — ending there loses the utterance.
    for (const from of [
      run(listening, [{ type: "speechStart" }]).state,
      run(listening, [{ type: "speechStart" }, { type: "speechStop" }]).state,
    ]) {
      const { state, out } = run(from, [{ type: "idleExpired" }]);
      expect(out).toEqual([]);
      expect(state).toBe(from);
    }
    // …and once the final has landed and nothing is talking, the next expiry ends it.
    const settled = run(listening, [
      { type: "speechStart" },
      { type: "speechStop" },
      { type: "final", text: "   " }, // an empty final: consumed, nothing submitted
      { type: "idleExpired" },
    ]);
    expect(settled.state.phase).toBe("ended");
  });

  it("④ …and it is a terminal like the others: anything queued is HARVESTED, not lost", () => {
    const queued = run(listening, [
      { type: "confirmHold", on: true },
      { type: "final", text: "held words" },
    ]).state;
    const { out } = run(queued, [{ type: "idleExpired" }]);
    expect(out).toEqual([
      { type: "harvest", lines: ["held words"] },
      { type: "teardown", close: false },
    ]);
  });

  // ⑦ THE TAB'S MARKER. Ownership of the relay's slot is never inferred from `attempts` — two tabs or
  // a second device make "another call is active" a real story (Maya F5). The marker is the evidence.

  it("⑦ a first dial's `busy` stays TERMINAL without the marker", () => {
    const { state } = run(CALL_INITIAL, [
      { type: "serverError", code: "busy", message: "a live call is already running" },
    ]);
    expect(state.phase).toBe("error");
    expect(state.note).toBe(CALL_COPY.busy);
  });

  it("⑦ `unmounted` PRESERVES priorLeg, and the re-arm carries it (S6 review F3, reshaped)", () => {
    // StrictMode's simulated cleanup funnels through `unmounted`, whose teardown clears the
    // sessionStorage marker — so the STATE's copy is the only carrier left when `remount` re-arms
    // the second setup. A reset that dropped it would eat exactly the crashed-tab recovery this
    // mechanism exists for, on the very server (dev) where that recovery gets exercised.
    const marked = run(CALL_INITIAL, [{ type: "priorLeg" }]).state;
    const dead = run(marked, [{ type: "unmounted" }]).state;
    expect(dead.priorLeg).toBe(true);
    const rearmed = run(dead, [{ type: "remount" }]).state;
    expect(rearmed.priorLeg).toBe(true);
    // …and the re-armed machine's first-dial busy still takes the recovery path.
    const busy = run(rearmed, [
      { type: "serverError", code: "busy", message: "a live call is already running" },
    ]);
    expect(busy.state.phase).toBe("connecting");
  });

  it("⑦ …and WITH it takes the note-only ladder path — this phone's own unreaped slot", () => {
    const back = run(CALL_INITIAL, [
      { type: "priorLeg" },
      { type: "serverError", code: "busy", message: "a live call is already running" },
    ]);
    expect(back.state.phase).toBe("connecting"); // the 1013 close drives the redial, as ever
    expect(back.state.note).toBe(CALL_COPY.busyRetrying);
    expect(back.out).toEqual([]); // note-only: the arm drives nothing (H2 — one rung per refusal)
    expect(back.state.attempts).toBe(0);
  });

  it("⑦ …and it changes nothing else: a ladder spent on refusals still ends, on the busy truth", () => {
    let s = run(CALL_INITIAL, [
      { type: "priorLeg" },
      { type: "serverError", code: "busy", message: "still busy" },
    ]).state;
    for (let i = 0; i < 6; i++) {
      s = run(s, [
        { type: "socketLost" },
        { type: "serverError", code: "busy", message: "still busy" },
      ]).state;
    }
    // …and the rung after the last one: the ladder is spent, and the note it ends on is the one the
    // refusals put up, not `lost` — the owner is not being sent to look at their Wi-Fi.
    const done = run(s, [{ type: "socketLost" }]);
    expect(done.state.phase).toBe("error");
    expect(done.state.note).toBe(CALL_COPY.busyHeld);
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

describe("callReduce — the remount re-arm (StrictMode's setup→cleanup→setup)", () => {
  it("re-arms a terminal machine to a fresh call, PRESERVING the moved generation", () => {
    // The terminal it faces is the one the cleanup's `unmounted` wrote a moment earlier; the
    // generation must NOT rewind, or every callback the fence turned into a ghost comes back.
    const dead = run(listening, [{ type: "unmounted" }]).state;
    const { state, out } = run(dead, [{ type: "remount" }]);
    expect(state).toEqual({ ...CALL_INITIAL, gen: dead.gen });
    expect(out).toEqual([]);
    // …and the re-armed machine actually answers a fresh leg.
    expect(run(state, [{ type: "ready" }]).state.phase).toBe("listening");
  });

  it("is a no-op on a live machine — the genuine first mount", () => {
    const { state, out } = run(listening, [{ type: "remount" }]);
    expect(state).toBe(listening);
    expect(out).toEqual([]);
  });
});

// ── D74 S5: THE TRANSCRIPT GATE (evidence docs/research/R76) ─────────────────────────────────────

describe("callReduce — THE TEXT BACKSTOP (D80 ②)", () => {
  /** A final the wiring judged against the reply the mouth just spoke. */
  const judged = (text: string, echo: number | undefined, energyMs?: number): CallSignal => ({
    type: "final",
    text,
    energyMs,
    minFinalMs: 200,
    echo,
    echoMin: 0.75,
  });

  it("a final AT or ABOVE the knob is the reply's own words: dropped, shown, and NOT cued", () => {
    for (const sim of [0.75, 0.946, 1]) {
      const waiting = { ...listening, waitingFinal: true };
      const { state, out } = run(waiting, [judged("Text me when you can. I'll be here.", sim)]);
      expect(out, String(sim)).toEqual([]); // no submit, and no drop cue for the car to play back
      expect(state.pending).toEqual([]);
      expect(state.heard).toBe(CALL_COPY.ownWords); // the heard line says what happened
      expect(state.waitingFinal).toBe(false); // …and nothing is in flight any more
      expect(state.note).toBeNull();
    }
  });

  it("a final BELOW it, or one the wiring never stamped (outside the window, too short), is taken", () => {
    for (const echo of [0.74, 0.5, undefined]) {
      const { out } = run(listening, [judged("It's okay, no worries.", echo, 400)]);
      expect(submits(out), String(echo)).toEqual(["It's okay, no worries."]);
    }
  });

  it("an echo that is ALSO too quiet is an echo — the more specific diagnosis, and no cue", () => {
    const { state, out } = run(listening, [judged("Was that okay? Yes.", 1, 0)]);
    expect(out).toEqual([]);
    expect(state.heard).toBe(CALL_COPY.ownWords);
    expect(state.note).toBeNull();
  });

  it("the HELD and MUTED drops still outrank it — nothing about the backstop reopens a closed ear", () => {
    const held = { ...listening, earHeld: true, heard: "before" };
    expect(run(held, [judged("the reply's words", 1)]).state.heard).toBe("before");
  });
});

describe("callReduce — the transcript gate (D74 S5)", () => {
  /** A final carrying the ear's own accrual for it, against the owner's floor. */
  const heard = (text: string, energyMs?: number): CallSignal => ({
    type: "final",
    text,
    energyMs,
    minFinalMs: 200,
  });

  it("cues only a SUSTAINED drop — a zero-accrual hallucination gets the note and no sound (D80 ⑥)", () => {
    const flap = run(listening, [heard("Mm-hmm.", 0)]);
    expect(flap.state.note).toBe(CALL_COPY.tooQuiet);
    expect(flap.out).toEqual([]); // nothing was heard, so nothing is said — and no cue echo to feed
    expect(run(listening, [heard("Mm-hmm.", 20)]).out).toEqual([{ type: "dropCue" }]);
  });

  it("\"too quiet\" clears on the next TAKEN final — and never clears anybody else's note (D80's W6)", () => {
    const dropped = run(listening, [heard("Thank you for watching.", 40)]).state;
    expect(dropped.note).toBe(CALL_COPY.tooQuiet);
    expect(run(dropped, [heard("what time is it", 600)]).state.note).toBeNull();
    // another drop keeps it; a taken final over a DIFFERENT note leaves that note standing
    expect(run(dropped, [heard("Mm.", 0)]).state.note).toBe(CALL_COPY.tooQuiet);
    const strained = { ...listening, note: CALL_COPY.strained };
    expect(run(strained, [heard("what time is it", 600)]).state.note).toBe(CALL_COPY.strained);
  });

  it("DISCARDS a final the ear cannot account for, and says so", () => {
    // Whisper does not answer noise with nothing — it answers with a plausible sentence, which on a
    // call is submitted to the agent as if the owner had said it.
    const { state, out } = run(listening, [heard("Thank you for watching.", 40)]);
    // …and says so OUT LOUD (D76 §C.5): the one effect is the drop cue — the note line is useless to
    // an owner who is driving.
    expect(out).toEqual([{ type: "dropCue" }]);
    expect(state.pending).toEqual([]);
    expect(state.heard).toBe(""); // …and the transcript line does not show words nobody said
    expect(state.waitingFinal).toBe(false);
    expect(state.note).toBe(CALL_COPY.tooQuiet);
  });

  it("takes one the ear DID hear", () => {
    const { state, out } = run(listening, [heard("what time is it", 900)]);
    expect(submits(out)).toEqual(["what time is it"]);
    expect(state.note).toBeNull();
  });

  it("FAILS OPEN with no epoch-matched evidence — unmeasured is not quiet", () => {
    // A final arriving across a reconnect belongs to a leg whose accrual is gone. Absence of
    // evidence must never cost the owner their words.
    expect(submits(run(listening, [heard("still there?")]).out)).toEqual(["still there?"]);
  });

  it("is OFF when the knob is 0 or absent — the pre-D74 backend, and the owner's own switch", () => {
    for (const minFinalMs of [0, undefined]) {
      const { out } = run(listening, [{ type: "final", text: "barely", energyMs: 1, minFinalMs }]);
      expect(submits(out)).toEqual(["barely"]);
    }
  });

  it("never fires on an EMPTY final — that one is already handled, and deserves no note", () => {
    const { state, out } = run(listening, [heard("   ", 0)]);
    expect(out).toEqual([]);
    expect(state.note).toBeNull();
  });

  it("the cue is the GATE's alone — a muted or held drop is silent, and a taken final too", () => {
    // Muted and held are the owner's and the machine's own closes — nothing was "too quiet" there, so
    // a beep would be the call contradicting the owner's own tap (or the reply's own leak).
    const muted = run(listening, [{ type: "setMuted", on: true }]).state;
    expect(run(muted, [heard("the doorbell", 0)]).out).toEqual([]);
    const held = run(listening, [
      { type: "captureReady", holdMode: "on", ecAll: false, route: "media", deviceId: "" },
      { type: "final", text: "hello" },
      { type: "playbackStarted" },
    ]).state;
    expect(held.earHeld).toBe(true);
    expect(run(held, [heard("the reply's own words", 0)]).out).toEqual([]);
    expect(run(listening, [heard("what time is it", 900)]).out.map((e) => e.type)).toEqual([
      "submit",
    ]);
  });

  it("the MUTED drop still outranks it — one rule, no window where the words go out", () => {
    const muted = run(listening, [{ type: "setMuted", on: true }]).state;
    const { state } = run(muted, [heard("the doorbell", 900)]);
    expect(state.pending).toEqual([]);
    expect(state.note).toBeNull(); // muted is not "too quiet" — the ear was closed on purpose
  });
});

describe("callReduce — the mouth WAITS (the owner's 2026-09-26 ruling on R86 LC-1 · R88 E-1)", () => {
  /** Thinking on a question, with a speech-start raised under it — the owner, or a TV… */
  const noisy = run(listening, [
    { type: "final", text: "what's the weather" },
    { type: "sent", outcome: "accepted", text: "what's the weather" },
    { type: "speechStart" },
  ]).state;
  /** …and the same segment STOPPED: its final is in flight. */
  const noiseDone = run(noisy, [{ type: "speechStop" }]).state;

  it("the gate is CLOSED on an open segment and on a final in flight — whatever `barge_in` is", () => {
    expect(noisy.phase).toBe("thinking");
    expect(mouthMayOpen(noisy)).toBe(false);
    expect(mouthMayOpen(noiseDone)).toBe(false);
    // …and a NEW segment live over a pending final is closed too.
    expect(mouthMayOpen(run(noiseDone, [{ type: "speechStart" }]).state)).toBe(false);
  });

  it("a NOISE VERDICT on the open segment opens it — and its final still meets the gate on its own arm", () => {
    const judged = run(noisy, [{ type: "segmentNoise" }]).state;
    expect(judged.noiseOpen).toBe(true);
    expect(mouthMayOpen(judged)).toBe(true);
    const started = run(judged, [{ type: "playbackStarted" }]);
    expect(started.out).toEqual([]); // no `kill` ⇒ no `cancelTurn` — the reply plays
    expect(started.state.phase).toBe("speaking");
    // The TV stops: the verdict goes with its segment, and the final it leaves meets the gate.
    const stopped = run(started.state, [{ type: "speechStop" }]).state;
    expect(stopped.noiseOpen).toBe(false);
    const dropped = run(stopped, [{ type: "final", text: "yeah", energyMs: 40, minFinalMs: 200 }]);
    expect(dropped.out).toEqual([{ type: "dropCue" }]);
    expect(dropped.state.pending).toEqual([]);
  });

  it("a verdict with NO segment open is ignored — it is about one segment, never a standing permit", () => {
    const { state } = run(listening, [{ type: "segmentNoise" }]);
    expect(state.noiseOpen).toBe(false);
    // …and it does not outlive its segment into the next one.
    const next = run(noisy, [
      { type: "segmentNoise" },
      { type: "speechStop" },
      { type: "final", text: "" },
      { type: "speechStart" },
    ]).state;
    expect(next.userSpeechActive).toBe(true);
    expect(next.noiseOpen).toBe(false);
    expect(mouthMayOpen(next)).toBe(false);
  });

  it("the verdict ends with its segment's FINAL, even one that lands without a stop (Emma F2)", () => {
    // A final before/without `speech_stopped` leaves the segment open; the verdict must not ride on.
    const judged = run(noisy, [{ type: "segmentNoise" }]).state;
    expect(mouthMayOpen(judged)).toBe(true);
    for (const sig of [
      { type: "final", text: "" },
      { type: "final", text: "yeah", energyMs: 40, minFinalMs: 200 },
      { type: "final", text: "turn it off" },
    ] as CallSignal[]) {
      const after = run(judged, [sig]).state;
      expect(after.noiseOpen).toBe(false);
      expect(after.userSpeechActive).toBe(true); // the segment is still open: unjudged again
      expect(mouthMayOpen(after)).toBe(false);
    }
    // …and under the held ear's flat drop too, where the segment stays open as well.
    const heldJudged = { ...judged, earHeld: true };
    expect(run(heldJudged, [{ type: "final", text: "leak" }]).state.noiseOpen).toBe(false);
  });

  it("…but ANOTHER segment's final leaves it standing — Speaches overlaps segments (D80 ③)", () => {
    // `speech_started(B)` lands before `transcript(A)`: A's final is not B's, and ending B's verdict on
    // it would put a judged TV segment back in front of the mouth until B happens to stop.
    const b = run(listening, [{ type: "speechStart", itemId: "B" }]).state;
    expect(b.speechItem).toBe("B");
    const judged = run(b, [{ type: "segmentNoise" }]).state;
    const afterA = run(judged, [{ type: "final", text: "what's the weather", itemId: "A" }]);
    expect(afterA.state.noiseOpen).toBe(true);
    expect(mouthMayOpen(afterA.state)).toBe(true);
    expect(submits(afterA.out)).toEqual(["what's the weather"]); // A itself is taken as ever
    // …while B's OWN final still ends it, and so does an unnamed one (the pre-D80 rule).
    expect(run(judged, [{ type: "final", text: "", itemId: "B" }]).state.noiseOpen).toBe(false);
    expect(run(judged, [{ type: "final", text: "" }]).state.noiseOpen).toBe(false);
    // The id goes with its segment: a stop clears it.
    expect(run(b, [{ type: "speechStop", itemId: "B" }]).state.speechItem).toBeNull();
  });

  it("a STOP naming another segment closes nothing — matching and id-less stops behave as ever (Maya)", () => {
    const b = run(listening, [{ type: "speechStart", itemId: "B" }]).state;
    const stray = run(b, [{ type: "speechStop", itemId: "A" }]).state;
    expect(stray.userSpeechActive).toBe(true);
    expect(stray.waitingFinal).toBe(false);
    expect(stray.speechItem).toBe("B");
    for (const stop of [
      { type: "speechStop", itemId: "B" },
      { type: "speechStop" },
    ] as CallSignal[]) {
      const after = run(b, [stop]).state;
      expect(after.userSpeechActive).toBe(false);
      expect(after.waitingFinal).toBe(true);
    }
    // an id-less START matches any stop, the pre-ledger rule
    const unnamed = run(listening, [{ type: "speechStart" }, { type: "speechStop", itemId: "A" }]);
    expect(unnamed.state.userSpeechActive).toBe(false);
  });

  it("the verdict clears wherever its segment closes or is condemned — stop, mute, a lost or fresh leg", () => {
    const judged = run(noisy, [{ type: "segmentNoise" }]).state;
    for (const sig of [
      { type: "speechStop" },
      { type: "setMuted", on: true },
      { type: "socketLost" },
      { type: "ready" },
    ] as CallSignal[]) {
      expect(run(judged, [sig]).state.noiseOpen).toBe(false);
    }
  });

  it("`playbackStarted` NEVER kills — the rule is enforced before it, at the gate", () => {
    // What reaches this edge over an unsettled ear is the owner's own gesture (a resume tap, a seek):
    // theirs to make. The mouth lands, and the phase follows it.
    for (const from of [noisy, noiseDone, run(noiseDone, [{ type: "speechStart" }]).state]) {
      const { state, out } = run(from, [{ type: "playbackStarted" }]);
      expect(out).toEqual([]);
      expect(state.killing).toBe(false);
      expect(state.mouthLive).toBe(true);
      expect(state.phase).toBe("speaking");
    }
  });

  it("a stop with no ACCEPTED start raises nothing — mute→unmute before the relay's stop (A2)", () => {
    // The mute condemned the segment; its `speech_stopped` arrives after the unmute. A `waitingFinal`
    // raised for it would hold the mouth for a final that was condemned and is never coming.
    const back = run(noisy, [
      { type: "setMuted", on: true },
      { type: "setMuted", on: false },
      { type: "speechStop" },
    ]).state;
    expect(back.waitingFinal).toBe(false);
    expect(mouthMayOpen(back)).toBe(true);
  });

  it("a HELD ear lowers the flags left up under it — no reply held for a final that was dropped", () => {
    // A segment opens, the mouth opens over it (the owner's resume), and the hold engages with its
    // final still to come — then drops it as leak. `waitingFinal` must not be left standing.
    const spared = run(holding, [
      { type: "final", text: "tell me a story" },
      { type: "speechStart" },
      { type: "speechStop" },
      { type: "playbackStarted" },
    ]).state;
    expect(spared.earHeld).toBe(true);
    expect(spared.waitingFinal).toBe(true);
    const heard = run(spared, [{ type: "final", text: "mm" }]).state;
    expect(heard.waitingFinal).toBe(false);
    expect(heard.pending).toEqual([]); // still dropped as leak — nothing about the hold changed
    expect(mouthMayOpen(heard)).toBe(true);
    // An OPEN segment under a hold: its stop LOWERS the flag and never raises the wait.
    const reopened = run(holding, [
      { type: "final", text: "tell me a story" },
      { type: "speechStart" },
      { type: "playbackStarted" },
    ]).state;
    expect(reopened.earHeld).toBe(true);
    expect(reopened.userSpeechActive).toBe(true);
    const stopped = run(reopened, [{ type: "speechStop" }]).state;
    expect(stopped.userSpeechActive).toBe(false);
    expect(stopped.waitingFinal).toBe(false);
    expect(mouthMayOpen(stopped)).toBe(true);
  });
});

// ── D74 S2: THE ROUTE LEG CYCLE (evidence docs/research/R77 · R78 §8) ────────────────────────────

/** A connected call that has said which ear it opened — the seed every route case starts from. */
const routed = run(CALL_INITIAL, [
  { type: "captureReady", holdMode: "auto", ecAll: true, route: "call", deviceId: "" },
  { type: "ready" },
]).state;

describe("callReduce — the route cycle (D74 S2)", () => {
  it("seeds the pair from the capture that actually opened", () => {
    expect(routed.route).toBe("call");
    expect(routed.inputDevice).toBe("");
  });

  it("moves the route: a fresh leg on a fresh ear, with the generation moved", () => {
    const { state, out } = run(routed, [{ type: "routeChange", route: "media" }]);
    expect(state.route).toBe("media");
    expect(state.inputDevice).toBe(""); // the half not sent is kept
    expect(state.phase).toBe("connecting");
    expect(state.gen).toBe(routed.gen + 1);
    expect(state.attempts).toBe(0);
    // The HOLD belongs to the released track; the fresh `captureReady` decides it again.
    expect(state.holdMode).toBe("off");
    expect(state.ecAll).toBe(false);
    // call (EC on) → media (EC off) LEAVES comm mode: the mouth must re-tag (ISS-18 / R81).
    expect(out).toEqual([{ type: "recapture", route: "media", deviceId: "", leavesComm: true }]);
  });

  it("…and the device half alone, against the standing route", () => {
    const { state, out } = run(routed, [{ type: "routeChange", deviceId: "bt-headset" }]);
    expect(state.route).toBe("call");
    // the route did not move, so comm mode was not left
    expect(out).toEqual([
      { type: "recapture", route: "call", deviceId: "bt-headset", leavesComm: false },
    ]);
  });

  // ISS-18 (R81): only an EC-on → EC-off flip leaves comm mode. A device move on the EC-off route,
  // or a flip INTO comm mode, opens nothing stale — the reverse direction re-routes on its own (R81 §3).
  it("`leavesComm` is the EC-on → EC-off edge only", () => {
    const onMedia = run(routed, [{ type: "routeChange", route: "media" }]);
    expect(onMedia.out[0]).toMatchObject({ type: "recapture", leavesComm: true });
    const mediaState = run(onMedia.state, [
      { type: "captureReady", holdMode: "auto", ecAll: false, route: "media", deviceId: "" },
      { type: "ready" },
    ]).state;
    expect(run(mediaState, [{ type: "routeChange", deviceId: "bt" }]).out[0]).toMatchObject({
      leavesComm: false,
    });
    expect(run(mediaState, [{ type: "routeChange", route: "call" }]).out[0]).toMatchObject({
      leavesComm: false,
    });
  });

  // Review F3: the edge is measured against the EAR's EC TRUTH (the readback), not the route it asked
  // for — an EC-off ask that came back EC-on (`ecStuck`) is still in comm mode, and leaving it later IS
  // a comm-mode exit; a route that asked for EC and did not get it never entered.
  it("`leavesComm` reads the readback's `ecOn`, not the requested route", () => {
    const stuck = run(CALL_INITIAL, [
      {
        type: "captureReady",
        holdMode: "auto",
        ecAll: true,
        route: "media",
        deviceId: "",
        ecOn: true,
      },
      { type: "ready" },
    ]).state;
    // A device move keeps the (EC-off) route, and the stuck ear's comm mode is still left by it.
    expect(run(stuck, [{ type: "routeChange", deviceId: "bt" }]).out[0]).toMatchObject({
      leavesComm: true,
    });
    const neverIn = run(CALL_INITIAL, [
      {
        type: "captureReady",
        holdMode: "auto",
        ecAll: false,
        route: "call",
        deviceId: "",
        ecOn: false,
      },
      { type: "ready" },
    ]).state;
    expect(run(neverIn, [{ type: "routeChange", route: "media" }]).out[0]).toMatchObject({
      leavesComm: false,
    });
  });

  it("a flip out of comm mode MID-REPLY leaves the note line alone — the picker's footer carries that fact", () => {
    // Owner ruling 2026-09-24: "the new route takes effect from the next reply" is not an alarm and
    // does not belong on the overlay's note line; it is a static footer in the Sound picker.
    const speaking = run(routed, [{ type: "playbackStarted" }]).state;
    expect(speaking.mouthLive).toBe(true);
    const mid = run(speaking, [{ type: "routeChange", route: "media" }]).state;
    expect(mid.note).toBe(speaking.note);
  });

  it("KEEPS the queue and the mute — a route change is not the owner leaving", () => {
    // Never-lose-speech is about what the owner said, and they did not choose to discard it; the
    // closed ear is their standing answer and the fresh capture takes it the moment it exists.
    const held = run(routed, [
      { type: "playbackStarted" }, //          the mouth holds the queue
      { type: "final", text: "keep this" },
    ]).state;
    expect(held.pending).toEqual(["keep this"]);
    const { state } = run(held, [
      { type: "setMuted", on: true },
      { type: "routeChange", route: "media" },
    ]);
    expect(state.pending).toEqual(["keep this"]);
    expect(state.muted).toBe(true);
    expect(state.mouthLive).toBe(true); // C3 rides HTTP — the reply is still audible
  });

  it("releases a kill in flight: its settlement was armed under the old generation", () => {
    // Without this the flag would stand for the rest of the call and every utterance after it would
    // queue behind a hold nothing can clear.
    const killing = run(routed, [{ type: "playbackStarted" }, { type: "barge" }]).state;
    expect(killing.killing).toBe(true);
    expect(run(killing, [{ type: "routeChange", route: "media" }]).state.killing).toBe(false);
  });

  it("a redial refused `busy` by OUR OWN old leg is a retry, not the other-call terminal (R86 LC-4)", () => {
    // The old leg's slot is released only after its close crosses Serve and the relay's upstream
    // teardown runs — so the recapture's dial can lose that race, on a congested uplink especially.
    expect(routed.priorLeg).toBe(false); // a settled call, attempts 0, no marker at mount
    const { state, out } = run(routed, [
      { type: "routeChange", route: "media" },
      { type: "serverError", code: "busy", message: "a live call is already running" },
    ]);
    expect(state.phase).toBe("connecting");
    expect(state.note).toBe(CALL_COPY.busyRetrying);
    expect(out).toEqual([{ type: "recapture", route: "media", deviceId: "", leavesComm: true }]);
    // …and the 1013 close that follows drives the ladder, as for every note-only refusal.
    expect(run(state, [{ type: "socketLost" }]).out).toEqual([{ type: "reconnect", delayMs: 400 }]);
  });

  it("is INERT outside the settled phases, and when nothing actually moved", () => {
    // `connecting` is already opening a leg; a terminal has no ear left to move.
    for (const from of [CALL_INITIAL, run(routed, [{ type: "socketLost" }]).state]) {
      const { state, out } = run(from, [{ type: "routeChange", route: "media" }]);
      expect(out).toEqual([]);
      expect(state.route).toBe(from.route); // …and the pair is not quietly moved either
    }
    expect(run(routed, [{ type: "hangup" }, { type: "routeChange", route: "x" }]).out).toEqual([
      { type: "teardown", close: true },
    ]);
    // …and re-picking what is already live costs no reconnect.
    expect(run(routed, [{ type: "routeChange", route: "call" }]).out).toEqual([]);
  });
});
