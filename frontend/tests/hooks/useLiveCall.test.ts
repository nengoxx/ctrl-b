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

  it("VOICE outside `speaking` is inert — speech during `thinking` steers, it never cancels", () => {
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

describe("callReduce — tap = STOP (LIVE-001 · D71 amendment №3)", () => {
  const thinking = run(listening, [{ type: "final", text: "wrong question" }]).state;

  it("`stop` in `speaking` is the same ordered kill a barge fires", () => {
    const stopped = run(speaking, [{ type: "stop" }]);
    const barged = run(speaking, [{ type: "barge" }]);
    expect(stopped.out).toEqual([{ type: "kill" }]);
    expect(stopped.state).toEqual(barged.state);
  });

  it("`stop` in `thinking` cancels the turn: `killing` + `kill`, nothing audible to fall", () => {
    expect(thinking.phase).toBe("thinking");
    const { state, out } = run(thinking, [{ type: "stop" }]);
    expect(out).toEqual([{ type: "kill" }]);
    expect(state.killing).toBe(true);
    expect(state.phase).toBe("thinking"); // the settlement owns the transition, as for every kill
    expect(state.mouthLive).toBe(false);
  });

  it("a thinking stop never holds the ear — no tail arms, the ear stays open for the re-say", () => {
    // Even under a HOLDING policy: the mouth never rose, so nothing reached the car to wait out.
    const held = run(listening, [
      { type: "captureReady", holdMode: "on", ecAll: false, route: "media", deviceId: "d" },
      { type: "final", text: "wrong question" },
    ]).state;
    const { state } = run(held, [{ type: "stop" }]);
    expect(state.killing).toBe(true);
    expect(state.tail).toBe(false);
    expect(state.earHeld).toBe(false);
  });

  it("`stop` in `listening` (and before the call connects) is inert", () => {
    for (const from of [listening, CALL_INITIAL]) {
      const { state, out } = run(from, [{ type: "stop" }]);
      expect(out).toEqual([]);
      expect(state).toBe(from);
    }
  });

  it("`barge` in `thinking` is STILL inert — voice interrupts only an audible reply", () => {
    const { state, out } = run(thinking, [{ type: "barge" }]);
    expect(out).toEqual([]);
    expect(state.killing).toBe(false);
  });

  it("`stop` during `killing` is inert — one kill per interruption", () => {
    const killing = run(thinking, [{ type: "stop" }]).state;
    const again = run(killing, [{ type: "stop" }, { type: "barge" }]);
    expect(again.out).toEqual([]);
    expect(again.state).toBe(killing);
  });

  it("`killSettled` from a thinking stop lands on `listening` and drains what was said meanwhile", () => {
    const killing = run(thinking, [{ type: "stop" }]).state;
    // The re-say arrives while the cancel is in flight: it waits (a steer into the dying turn would be
    // harvested with it).
    const queued = run(killing, [{ type: "final", text: "the right question" }]);
    expect(submits(queued.out)).toEqual([]);
    const settled = run(queued.state, [{ type: "killSettled" }]);
    expect(submits(settled.out)).toEqual(["the right question"]);
    expect(settled.state.phase).toBe("thinking"); // …which is the NEXT turn, thinking
    expect(settled.state.killing).toBe(false);
    // …and with nothing queued the settlement simply hands the floor back.
    const bare = run(killing, [{ type: "killSettled" }]).state;
    expect(bare.phase).toBe("listening");
    expect(bare.killing).toBe(false);
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
  it("a HANG-UP harvests pending speech to the draft, exactly as an ERROR does (ISS-61)", () => {
    const queued = run(speaking, [{ type: "final", text: "unsent words" }]).state;

    // The owner's ruling (2026-10-06): a draft costs a delete, lost words cost the conversation.
    const bye = run(queued, [{ type: "hangup" }]);
    expect(bye.out).toEqual([
      { type: "harvest", lines: ["unsent words"] },
      { type: "teardown", close: true },
    ]);
    expect(bye.state.pending).toEqual([]);
    // Never twice: the arm consumed the queue, so a second exit on the same instance harvests nothing.
    expect(run(bye.state, [{ type: "hangup" }]).out).toEqual([{ type: "teardown", close: true }]);

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
        message: "uplink allowance exceeded (ms budget): a 40 ms frame against 12 ms of credit — …",
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

describe("callReduce — the slot takeover's old leg (Phase 26 D5)", () => {
  it("`ended{superseded}` is a TERMINAL that says why — and never redials", () => {
    const queued = run(listening, [{ type: "final", text: "said before the takeover" }]).state;
    const { state, out } = run(queued, [{ type: "serverEnded", reason: "superseded" }]);
    expect(state.phase).toBe("ended");
    expect(state.note).toBe(CALL_COPY.superseded);
    // NEUTRAL copy (the D5 code round): the newer leg may be a duplicated tab's DICTATION, so the words
    // claim no continuity — only that the call was taken over.
    expect(CALL_COPY.superseded).toBe("the call was taken over by another ctrl-b session");
    // The ordinary terminal tail (ISS-61's harvest included) — and no `reconnect`: a duplicated tab
    // redialling would supersede the copy that superseded it, back and forth.
    expect(out.some((e) => e.type === "reconnect")).toBe(false);
    expect(out.at(-1)).toEqual({ type: "teardown", close: false });
    // …and the 1000 close that follows the frame is swallowed by the terminal guard, not a ladder rung.
    const after = callReduce(state, { type: "socketLost" });
    expect(after.state).toBe(state);
    expect(after.out).toEqual([]);
  });

  it("…while a plain `ended` (the relay's `stop` tail) is unchanged: the standing note, or none", () => {
    expect(run(listening, [{ type: "serverEnded" }]).state.note).toBe("");
    const strained = run(listening, [{ type: "degraded" }]).state;
    const ended = run(strained, [{ type: "serverEnded" }]).state;
    expect([ended.phase, ended.note]).toEqual(["ended", CALL_COPY.strained]);
    // An unknown reason is not the takeover: the same plain terminal.
    expect(run(listening, [{ type: "serverEnded", reason: "whatever" }]).state.note).toBe("");
  });

  it("the busy arms stay the COMPAT path, untouched (a pre-D5 relay, an id-less tab)", () => {
    expect(
      run(CALL_INITIAL, [{ type: "serverError", code: "busy", message: "taken" }]).state.note,
    ).toBe(CALL_COPY.busy);
    const redial = run(listening, [{ type: "socketLost" }]).state;
    const refused = run(redial, [{ type: "serverError", code: "busy", message: "taken" }]);
    expect([refused.state.phase, refused.state.note]).toEqual([
      "connecting",
      CALL_COPY.busyRetrying,
    ]);
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

  it("voice barge stays inert while the mouth is silent — thinking and listening both", () => {
    const thinking = run(listening, [{ type: "final", text: "hm" }]).state;
    const connecting = run(listening, [{ type: "socketLost" }]).state;
    for (const from of [listening, thinking, connecting]) {
      expect(from.mouthLive).toBe(false);
      expect(run(from, [{ type: "barge" }]).out).toEqual([]);
    }
  });

  it("the owner's STOP follows the MOUTH across the reconnect window, like the barge", () => {
    // Speaking, the leg drops: the screen says `connecting`, the reply is still audible — the tap kills.
    const dropped = run(speaking, [{ type: "socketLost" }]).state;
    expect(dropped.phase).toBe("connecting");
    const tapped = run(dropped, [{ type: "stop" }]);
    expect(tapped.out).toEqual([{ type: "kill" }]);
    expect(tapped.state.mouthLive).toBe(false);
    // …and a SILENT connecting (no mouth, no turn to stop) is inert.
    const silent = run(listening, [{ type: "socketLost" }]).state;
    expect(run(silent, [{ type: "stop" }]).out).toEqual([]);
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
    // with `background` off — but the rule it lands on is the hang-up's (with nothing queued, the
    // very same effects; the queue is the one difference, below).
    const { state, out } = run(speaking, [{ type: "hidden" }]);
    expect(state.phase).toBe("ended");
    expect(out).toEqual([{ type: "teardown", close: true }]);
  });

  it("…and HARVESTS what was queued — as a hang-up and an unmount do, on EVERY exit (ISS-61)", () => {
    // Words queued behind a reply, and words held behind a confirm gate (the owner's 13:02 call: 13
    // utterances lost at an `unmounted` exit), all land in the draft — never a send, never twice.
    const behindReply = run(speaking, [{ type: "final", text: "wait" }]).state;
    expect(behindReply.pending).toEqual(["wait"]);
    const confirmHeld = run(listening, [
      { type: "confirmHold", on: true },
      { type: "final", text: "held one" },
      { type: "final", text: "held two" },
    ]).state;
    expect(confirmHeld.pending).toEqual(["held one", "held two"]);
    for (const queued of [behindReply, confirmHeld]) {
      for (const exit of [
        { type: "hidden" },
        { type: "hangup" },
        { type: "unmounted" },
      ] as CallSignal[]) {
        const first = run(queued, [exit]);
        expect(first.out).toEqual([
          { type: "harvest", lines: queued.pending },
          { type: "teardown", close: exit.type !== "unmounted" },
        ]);
        expect(run(first.state, [exit]).out).toEqual([
          { type: "teardown", close: exit.type !== "unmounted" },
        ]);
      }
    }
    // An EMPTY queue harvests nothing — no blank draft on a plain hang-up.
    for (const exit of [
      { type: "hidden" },
      { type: "hangup" },
      { type: "unmounted" },
    ] as CallSignal[])
      expect(run(listening, [exit]).out).toEqual([
        { type: "teardown", close: exit.type !== "unmounted" },
      ]);
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

describe("callReduce — the unmount fence (S2b audit; the queue's disposition amended by ISS-61)", () => {
  it("moves the generation and harvests the queue, so an in-flight callback is a ghost", () => {
    const queued = run(listening, [
      { type: "confirmHold", on: true }, // hold the queue open so a `final` stays pending
      { type: "final", text: "left unsaid" },
    ]).state;
    const { state, out } = run(queued, [{ type: "unmounted" }]);
    expect(state.gen).toBe(queued.gen + 1);
    expect(out[0]).toEqual({ type: "harvest", lines: ["left unsaid"] }); // every exit HARVESTS (ISS-61)
    expect(state.pending).toEqual([]);
    // …and the harvested final's own signals, armed under the old generation, no longer land.
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
      // An id-less stop's placeholder (D9): the bit is DERIVED from the set, so a seeded bit alone would
      // be normalized away before the assertion below could fail (D9 design round Opus L4).
      const waiting: CallState = { ...listening, awaiting: [""] };
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
    // call (EC on) → media (EC off) LEAVES comm mode: the mouth must re-tag (ISS-18 / R81). The media
    // route's ear opens at once — the stream it leaves behind is harmless off comm mode (ISS-54).
    expect(out).toEqual([
      {
        type: "recapture",
        route: "media",
        deviceId: "",
        leavesComm: true,
        freshSink: false,
      },
    ]);
  });

  it("…and the device half alone, against the standing route", () => {
    const { state, out } = run(routed, [{ type: "routeChange", deviceId: "bt-headset" }]);
    expect(state.route).toBe("call");
    // the route did not move, so comm mode was neither left nor entered — but a fresh ear ON the call
    // route still waits the output pool out (ISS-54 design round, Maya M2: a comm-device switch re-routes VOICE streams)
    expect(out).toEqual([
      {
        type: "recapture",
        route: "call",
        deviceId: "bt-headset",
        leavesComm: false,
        freshSink: true,
      },
    ]);
  });

  // ISS-18 (R81): only an EC-on → EC-off flip leaves comm mode. A device move on the EC-off route,
  // or a flip INTO comm mode, does not LEAVE it — since ISS-54 every recapture onto the call route is a
  // `freshSink` one instead (pinned in the dead-ear suite below).
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
    expect(out).toEqual([
      {
        type: "recapture",
        route: "media",
        deviceId: "",
        leavesComm: true,
        freshSink: false,
      },
    ]);
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

// ── ISS-54: THE EAR THAT NEVER HEARD (evidence docs/research/R99 §1.4–§1.5 · §3) ─────────────────

/** A connected call on the MEDIA route, whose ear came back EC-off — the seed of the flip into comm mode. */
const mediaRouted = run(CALL_INITIAL, [
  {
    type: "captureReady",
    holdMode: "auto",
    ecAll: false,
    route: "media",
    deviceId: "",
    ecOn: false,
  },
  { type: "ready" },
]).state;

describe("callReduce — the dead ear's rebuild (ISS-54)", () => {
  const dead: CallSignal = { type: "earDead", reason: "noFrame", heard: false };

  it("rebuilds the ear on the SAME route + device, after the pool's wait, and says so", () => {
    const { state, out } = run(routed, [{ ...dead }]);
    expect(state.phase).toBe("connecting");
    expect(state.note).toBe(CALL_COPY.earStalled);
    expect(state.gen).toBe(routed.gen + 1); // the leg in flight is fenced
    expect(state.attempts).toBe(0);
    expect(state.priorLeg).toBe(true); // the redial may meet our own unreaped slot (R86 LC-4)
    expect(state.earRetried).toBe(true);
    // the route cycle's own reset: the hold dies with the track, the fresh capture decides it again
    expect(state.holdMode).toBe("off");
    expect(state.route).toBe("call");
    expect(out).toEqual([
      {
        type: "recapture",
        route: "call",
        deviceId: "",
        leavesComm: false,
        freshSink: true,
      },
    ]);
  });

  it("is legal in EVERY non-terminal phase — `connecting` included — and inert on a terminal", () => {
    const thinking = run(routed, [{ type: "final", text: "hi" }]).state;
    expect(thinking.phase).toBe("thinking");
    const speakingRouted = run(routed, [{ type: "playbackStarted" }]).state;
    const reconnecting = run(routed, [{ type: "socketLost" }]).state;
    expect(reconnecting.phase).toBe("connecting");
    for (const from of [CALL_INITIAL, reconnecting, routed, thinking, speakingRouted]) {
      const { state, out } = run(from, [{ ...dead }]);
      expect(state.phase).toBe("connecting");
      expect(state.gen).toBe(from.gen + 1);
      expect(out.map((e) => e.type)).toEqual(["recapture"]);
    }
    const ended = run(routed, [{ type: "hangup" }]).state;
    const after = run(ended, [{ ...dead }]);
    expect(after.out).toEqual([]);
    expect(after.state).toBe(ended);
  });

  it("a death armed under another generation is a ghost", () => {
    const { state, out } = run(routed, [{ ...dead, gen: routed.gen + 7 }]);
    expect(out).toEqual([]);
    expect(state).toBe(routed);
  });

  it("ONE rebuild per route (ISS-54 design round, Maya M1): a second death — heard or not — ends the call `micLost`", () => {
    for (const heard of [false, true]) {
      const once = run(routed, [{ ...dead, heard }, { type: "ready" }]).state;
      expect(once.phase).toBe("listening");
      const twice = run(once, [{ type: "earDead", reason: "error", heard: !heard }]);
      expect(twice.state.phase).toBe("error");
      expect(twice.state.note).toBe(CALL_COPY.micLost);
      expect(twice.out).toEqual([{ type: "teardown", close: false }]);
    }
  });

  it("…and the second death HARVESTS what was queued, like every failure terminal", () => {
    // Queued BEFORE the first death: a final taken after the rebuild would earn the bound back
    // (ISS-54 code round, Opus 2), and the second death would rebuild instead.
    const queued = run(routed, [
      { type: "playbackStarted" },
      { type: "final", text: "keep this" },
      { ...dead },
      { type: "ready" },
    ]).state;
    expect(queued.pending).toEqual(["keep this"]);
    const { out } = run(queued, [{ ...dead }]);
    expect(out).toEqual([
      { type: "harvest", lines: ["keep this"] },
      { type: "teardown", close: false },
    ]);
  });

  it("a ROUTE CYCLE resets the bound — the owner's own move earns the new route its own rebuild", () => {
    const retried = run(routed, [{ ...dead }, { type: "ready" }]).state;
    expect(retried.earRetried).toBe(true);
    const moved = run(retried, [{ type: "routeChange", route: "media" }]).state;
    expect(moved.earRetried).toBe(false);
    const again = run(moved, [
      { type: "captureReady", holdMode: "auto", ecAll: false, route: "media", deviceId: "" },
      { type: "ready" },
      { ...dead },
    ]);
    expect(again.state.phase).toBe("connecting"); // rebuilt, not ended
    expect(again.out.at(-1)).toMatchObject({ type: "recapture", route: "media", freshSink: true });
  });

  it("the note STANDS past the fresh leg — what the dead ear missed is not connection news", () => {
    const back = run(routed, [{ ...dead }, { type: "ready" }]).state;
    expect(back.phase).toBe("listening");
    expect(back.note).toBe(CALL_COPY.earStalled);
  });

  it("leaves the MOUTH and the queue alone — a reply still playing lands `speaking` on the fresh leg", () => {
    const talking = run(routed, [{ type: "playbackStarted" }]).state;
    const { state } = run(talking, [{ ...dead }]);
    expect(state.mouthLive).toBe(true);
    expect(run(state, [{ type: "ready" }]).state.phase).toBe("speaking");
  });

  it("releases a kill in flight — the route cycle's rule, shared", () => {
    const killing = run(routed, [{ type: "playbackStarted" }, { type: "barge" }]).state;
    expect(killing.killing).toBe(true);
    expect(run(killing, [{ ...dead }]).state.killing).toBe(false);
  });
});

describe("callReduce — the flip INTO the call route waits the pool out (ISS-54 ②)", () => {
  it("media → call: a `freshSink` recapture, and the screen says why it takes this long", () => {
    const { state, out } = run(mediaRouted, [{ type: "routeChange", route: "call" }]);
    expect(out).toEqual([
      {
        type: "recapture",
        route: "call",
        deviceId: "",
        leavesComm: false,
        freshSink: true,
      },
    ]);
    expect(state.note).toBe(CALL_COPY.switchingRoute);
    // …and the fresh leg ends the wait, so it retracts the line (connection news, `CONNECTION_NOTES`)
    expect(run(state, [{ type: "ready" }]).state.note).toBeNull();
  });

  it("a device move WITHIN the call route waits too, but is not 'switching to call mode' (ISS-54 lane D2, RULINGS)", () => {
    const { state, out } = run(routed, [{ type: "routeChange", deviceId: "bt-headset" }]);
    expect(out[0]).toMatchObject({ freshSink: true });
    expect(state.note).toBe(routed.note);
  });

  it("a stuck media ear (EC came back ON) never left comm mode — no switching note, still a fresh sink", () => {
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
    const flipped = run(stuck, [{ type: "routeChange", route: "call" }]);
    expect(flipped.out[0]).toMatchObject({ freshSink: true });
    expect(flipped.state.note).toBe(stuck.note); // it was already in call mode — nothing to announce
  });

  it("a media-route device move opens at once, and keeps the note line as it was", () => {
    const { state, out } = run(mediaRouted, [{ type: "routeChange", deviceId: "usb" }]);
    expect(out[0]).toMatchObject({ leavesComm: false, freshSink: false });
    expect(state.note).toBe(mediaRouted.note);
  });
});

describe("callReduce — the MOUTH waits for the fresh ear on the call route (ISS-54 code round, Opus 1)", () => {
  it("a flip INTO the call route holds the mouth until `captureReady` — comm mode is off until the gUM", () => {
    const thinking = run(mediaRouted, [{ type: "final", text: "what time is it" }]).state;
    expect(thinking.phase).toBe("thinking");
    expect(mouthMayOpen(thinking)).toBe(true);
    const waiting = run(thinking, [{ type: "routeChange", route: "call" }]).state;
    expect(waiting.sinkWait).toBe(true);
    expect(mouthMayOpen(waiting)).toBe(false);
    const opened = run(waiting, [
      { type: "captureReady", holdMode: "auto", ecAll: true, route: "call", deviceId: "" },
    ]).state;
    expect(opened.sinkWait).toBe(false);
    expect(mouthMayOpen(opened)).toBe(true); // before `ready` even: the ear's gUM is what it waited for
  });

  it("a device move within the call route and an `earDead` rebuild there hold it too", () => {
    expect(run(routed, [{ type: "routeChange", deviceId: "bt" }]).state.sinkWait).toBe(true);
    const dead = run(routed, [{ type: "earDead", reason: "noFrame", heard: false }]).state;
    expect(dead.sinkWait).toBe(true);
    expect(mouthMayOpen(dead)).toBe(false);
  });

  it("…but nothing off the call route: a flip to media, a media device move, a media `earDead`", () => {
    expect(run(routed, [{ type: "routeChange", route: "media" }]).state.sinkWait).toBe(false);
    expect(run(mediaRouted, [{ type: "routeChange", deviceId: "usb" }]).state.sinkWait).toBe(false);
    const dead = run(mediaRouted, [{ type: "earDead", reason: "error", heard: true }]);
    expect(dead.state.sinkWait).toBe(false);
    expect(dead.out[0]).toMatchObject({ freshSink: true }); // the ear still waits the pool out
  });

  it("a terminal during the wait clears it — no recapture is coming to", () => {
    const waiting = run(routed, [{ type: "routeChange", deviceId: "bt" }]).state;
    expect(run(waiting, [{ type: "captureLost" }]).state.sinkWait).toBe(false);
    expect(run(waiting, [{ type: "hangup" }]).state.sinkWait).toBe(false);
  });
});

describe("callReduce — a TAKEN final earns the rebuild back (ISS-54 code round, Opus 2)", () => {
  const dead: CallSignal = { type: "earDead", reason: "noFrame", heard: false };

  it("rebuild → a taken final → a second death REBUILDS again instead of `micLost`", () => {
    const heard = run(routed, [
      { ...dead },
      { type: "ready" },
      { type: "final", text: "still here" },
    ]);
    expect(submits(heard.out)).toEqual(["still here"]);
    expect(heard.state.earRetried).toBe(false);
    const again = run(heard.state, [{ ...dead }]);
    expect(again.state.phase).toBe("connecting");
    expect(again.out.map((e) => e.type)).toEqual(["recapture"]);
  });

  it("rebuild → no taken final → the second death ends the call `micLost`", () => {
    // A final that is DROPPED (empty, here) proves nothing about the ear end-to-end.
    const quiet = run(routed, [{ ...dead }, { type: "ready" }, { type: "final", text: "" }]).state;
    expect(quiet.earRetried).toBe(true);
    const twice = run(quiet, [{ ...dead }]);
    expect(twice.state.phase).toBe("error");
    expect(twice.state.note).toBe(CALL_COPY.micLost);
  });
});

// ── Phase 26 D9: THE AWAITED-ID SET (ASR_PLAN §3.9 ①; closes LIVE_VOICE_PLAN OPEN-2) ───────────────

const seg = (type: "speechStart" | "speechStop", itemId?: string): CallSignal =>
  itemId === undefined ? { type } : { type, itemId };
/** Two segments stopped, neither transcript in yet: the ear owes A then B. */
const owed = run(listening, [
  seg("speechStart", "A"),
  seg("speechStop", "A"),
  seg("speechStart", "B"),
  seg("speechStop", "B"),
]).state;

describe("callReduce — the awaited-id set (Phase 26 D9)", () => {
  it("stop(A) → start(B) → stop(B) → final(A) keeps the mouth shut until B's final (L5 §1.3)", () => {
    expect(owed.awaiting).toEqual(["A", "B"]);
    expect(owed.waitingFinal).toBe(true);
    const afterA = run(owed, [{ type: "final", text: "one", itemId: "A" }]).state;
    // The one bit this replaces cleared here, and the mouth opened over B's words in flight.
    expect(afterA.awaiting).toEqual(["B"]);
    expect(afterA.waitingFinal).toBe(true);
    expect(mouthMayOpen(afterA)).toBe(false);
    const afterB = run(afterA, [{ type: "final", text: "two", itemId: "B" }]).state;
    expect(afterB.awaiting).toEqual([]);
    expect(afterB.waitingFinal).toBe(false);
    expect(mouthMayOpen(afterB)).toBe(true);
  });

  it("stop(A) → start(B) → final(A) → stop(B) → final(B) follows the pre-D9 flags (E-N3's routine order)", () => {
    const a = run(listening, [
      seg("speechStart", "A"),
      seg("speechStop", "A"),
      seg("speechStart", "B"),
    ]);
    const afterA = run(a.state, [{ type: "final", text: "one", itemId: "A" }]).state;
    expect(afterA.waitingFinal).toBe(false);
    expect(mouthMayOpen(afterA)).toBe(false); // B is open: the segment flag holds it, as ever
    const stopped = run(afterA, [seg("speechStop", "B")]).state;
    expect(stopped.awaiting).toEqual(["B"]);
    expect(mouthMayOpen(stopped)).toBe(false);
    const done = run(stopped, [{ type: "final", text: "two", itemId: "B" }]).state;
    expect(done.waitingFinal).toBe(false);
    expect(mouthMayOpen(done)).toBe(true);
  });

  it("an id-LESS final clears the whole set — the pre-D9 belt", () => {
    const { state } = run(owed, [{ type: "final", text: "one" }]);
    expect(state.awaiting).toEqual([]);
    expect(mouthMayOpen(state)).toBe(true);
  });

  it("a final for a KNOWN id settles it AND every id ahead of it — a stranded stop heals (design round Opus M1)", () => {
    const { state } = run(owed, [{ type: "final", text: "two", itemId: "B" }]);
    expect(state.awaiting).toEqual([]);
    expect(mouthMayOpen(state)).toBe(true);
  });

  it("an UNKNOWN id settles only the id-less placeholders (design round Opus M2 / Maya M1)", () => {
    // [A, B] awaited by name: a late or evicted final was never one of them, so both stay owed.
    const late = run(owed, [{ type: "final", text: "old", itemId: "Z" }]).state;
    expect(late.awaiting).toEqual(["A", "B"]);
    expect(mouthMayOpen(late)).toBe(false);
    // An id-less stop leaves a placeholder, which an answer naming a segment nobody named settles.
    const unnamed = run(listening, [seg("speechStart"), seg("speechStop")]).state;
    expect(unnamed.awaiting).toEqual([""]);
    expect(run(unnamed, [{ type: "final", text: "hi", itemId: "X" }]).state.awaiting).toEqual([]);
    // …and only the placeholders: a named id beside one stays owed.
    const mixed = run(unnamed, [seg("speechStart", "A"), seg("speechStop", "A")]).state;
    expect(mixed.awaiting).toEqual(["", "A"]);
    expect(run(mixed, [{ type: "final", text: "hi", itemId: "X" }]).state.awaiting).toEqual(["A"]);
  });

  it("a DROPPED final settles its id exactly as a taken one does — muted, held, empty, echo, too quiet", () => {
    const drops: [string, CallState, CallSignal][] = [
      ["muted", { ...owed, muted: true }, { type: "final", text: "one", itemId: "A" }],
      [
        "held",
        { ...holdingSpeaking, awaiting: ["A", "B"] },
        { type: "final", text: "one", itemId: "A" },
      ],
      ["empty", owed, { type: "final", text: "  ", itemId: "A" }],
      ["echo", owed, { type: "final", text: "one", itemId: "A", echo: 1, echoMin: 0.75 }],
      [
        "tooQuiet",
        owed,
        { type: "final", text: "one", itemId: "A", energyMs: 10, minFinalMs: 200 },
      ],
      ["taken", owed, { type: "final", text: "one", itemId: "A" }],
    ];
    for (const [why, from, sig] of drops) {
      const { state } = run(from, [sig]);
      expect(state.awaiting, why).toEqual(["B"]);
      expect(state.waitingFinal, why).toBe(true);
      expect(mouthMayOpen(state), why).toBe(false);
    }
  });

  it("`upstream_error` WITH an id settles that segment like its final would; WITHOUT one it clears all (design round Maya H1)", () => {
    const err = (itemId?: string): CallSignal => ({
      type: "serverError",
      code: "upstream_error",
      message: "the ear hiccuped",
      ...(itemId === undefined ? {} : { itemId }),
    });
    const named = run(owed, [err("A")]).state;
    expect(named.awaiting).toEqual(["B"]);
    expect(named.note).toBe("the ear hiccuped");
    expect(mouthMayOpen(named)).toBe(false);
    expect(run(owed, [err("B")]).state.awaiting).toEqual([]); // …and every id ahead of it
    expect(run(owed, [err("Z")]).state.awaiting).toEqual(["A", "B"]); // unknown: never awaited by name
    const belt = run(owed, [err()]).state;
    expect(belt.awaiting).toEqual([]);
    expect(belt.note).toBe("the ear hiccuped");
    expect(mouthMayOpen(belt)).toBe(true);
  });

  it("every clear path empties the set — ready, socketLost, mute, a route cycle, a rebuild, a terminal, a hang-up", () => {
    const routedOwed = run(routed, [
      seg("speechStart", "A"),
      seg("speechStop", "A"),
      seg("speechStart", "B"),
      seg("speechStop", "B"),
    ]).state;
    expect(routedOwed.awaiting).toEqual(["A", "B"]);
    const clears: [string, CallSignal][] = [
      ["ready", { type: "ready" }],
      ["socketLost", { type: "socketLost" }],
      ["mute", { type: "setMuted", on: true }],
      ["routeChange", { type: "routeChange", route: "media" }],
      ["earDead", { type: "earDead", reason: "noFrame", heard: false }],
      ["terminal", { type: "serverEnded" }],
      ["hangup", { type: "hangup" }],
      ["unmounted", { type: "unmounted" }],
    ];
    for (const [why, sig] of clears) {
      const { state } = run(routedOwed, [sig]);
      expect(state.awaiting, why).toEqual([]);
      expect(state.waitingFinal, why).toBe(false);
    }
  });

  it("a HELD stop owes nothing, and an unmute never restores what the mute settled", () => {
    const reopened = run(holding, [
      { type: "final", text: "tell me a story" },
      seg("speechStart", "A"),
      { type: "playbackStarted" },
      seg("speechStop", "A"),
    ]).state;
    expect(reopened.awaiting).toEqual([]);
    const back = run(owed, [
      { type: "setMuted", on: true },
      { type: "setMuted", on: false },
    ]).state;
    expect(back.awaiting).toEqual([]);
    expect(mouthMayOpen(back)).toBe(true);
  });
});

describe("callReduce — THE TURN HOLD (ISS-55, `turn_hold_ms`)", () => {
  const HOLD = 5000;
  /** A TAKEN-shaped final with the hold on, as the wiring stamps it. */
  const fin = (text: string, itemId?: string): Extract<CallSignal, { type: "final" }> => ({
    type: "final",
    text,
    turnHoldMs: HOLD,
    ...(itemId === undefined ? {} : { itemId }),
  });
  /** One whole segment: start, stop, its final. */
  const said = (id: string, text: string): CallSignal[] => [
    seg("speechStart", id),
    seg("speechStop", id),
    fin(text, id),
  ];
  const over = (s: CallState): CallSignal => ({ type: "turnHoldOver", seq: s.turnHoldSeq });

  it("a taken final OPENS the hold: queued, nothing sent, the phase unmoved", () => {
    const { state, out } = run(routed, said("A", "a"));
    expect(state.turnHold).toBe(true);
    expect(state.turnHoldSeq).toBe(routed.turnHoldSeq + 1);
    expect(state.turnHoldMs).toBe(HOLD);
    expect(state.turnHoldDue).toBe(false);
    expect(state.pending).toEqual(["a"]);
    expect(state.heard).toBe("a");
    expect(state.phase).toBe("listening");
    expect(submits(out)).toEqual([]);
  });

  it("its expiry over a settled ear sends the WHOLE queue as one message — a second final restarted and joined it", () => {
    const a = run(routed, said("A", "a")).state;
    const b = run(a, said("B", "b")).state;
    expect(b.turnHoldSeq).toBe(a.turnHoldSeq + 1); // restarted
    expect(b.pending).toEqual(["a", "b"]);
    const { state, out } = run(b, [over(b)]);
    expect(submits(out)).toEqual(["a b"]);
    expect(state.turnHold).toBe(false);
    expect(state.phase).toBe("thinking");
  });

  it("a THIRD segment after two pauses is still ONE turn — every taken final restarts (the §3.5 ⑤ amendment)", () => {
    const a = run(routed, said("A", "a")).state;
    const b = run(a, said("B", "b")).state;
    const c = run(b, said("C", "c")).state;
    // The two clocks the restarts replaced are ghosts — neither sends half the turn.
    const ghosts = run(c, [over(a), over(b)]);
    expect(submits(ghosts.out)).toEqual([]);
    expect(ghosts.state.turnHold).toBe(true);
    expect(ghosts.state.turnHoldDue).toBe(false);
    const { out } = run(ghosts.state, [over(c)]);
    expect(submits(out)).toEqual(["a b c"]);
  });

  it("speech INSIDE the hold makes its expiry DUE, and that segment's taken final starts it over", () => {
    const a = run(routed, said("A", "a")).state;
    const talking = run(a, [seg("speechStart", "B")]).state;
    const due = run(talking, [over(talking)]);
    expect(submits(due.out)).toEqual([]);
    expect(due.state.turnHold).toBe(true);
    expect(due.state.turnHoldDue).toBe(true);
    const restarted = run(due.state, [seg("speechStop", "B"), fin("b", "B")]);
    expect(submits(restarted.out)).toEqual([]); // answered by a taken final: no release, a restart
    expect(restarted.state.turnHoldDue).toBe(false);
    expect(restarted.state.turnHoldSeq).toBe(a.turnHoldSeq + 1);
    expect(submits(run(restarted.state, [over(restarted.state)]).out)).toEqual(["a b"]);
  });

  it("a DUE hold is released by whatever settles the ear — the segment's EMPTY final (C1, driven, not seeded)", () => {
    const a = run(routed, said("A", "a")).state;
    const due = run(a, [seg("speechStart", "B"), over(a)]).state;
    expect(due.turnHoldDue).toBe(true);
    const stopped = run(due, [seg("speechStop", "B")]);
    expect(submits(stopped.out)).toEqual([]); // B is still owed
    const { state, out } = run(stopped.state, [{ ...fin("", "B") }]);
    expect(submits(out)).toEqual(["a"]);
    expect(state.turnHold).toBe(false);
    expect(state.turnHoldDue).toBe(false);
  });

  it("…and every other settle path releases a due hold through the same one site", () => {
    const a = run(routed, said("A", "a")).state;
    const open = run(a, [seg("speechStart", "B"), over(a)]).state; // B open, hold due
    const owedB = run(open, [seg("speechStop", "B")]).state; // B owed, hold due
    const paths: [string, CallState, CallSignal[]][] = [
      ["too quiet", owedB, [{ ...fin("b", "B"), energyMs: 50, minFinalMs: 200 }]],
      ["echo", owedB, [{ ...fin("b", "B"), echo: 0.9, echoMin: 0.75 }]],
      ["upstream_error", owedB, [{ type: "serverError", code: "upstream_error", message: "x" }]],
      ["noise verdict", open, [{ type: "segmentNoise" }]],
      // MUTE while due (TH design round, Maya H2): the half-utterance is condemned, the held text goes.
      ["mute", open, [{ type: "setMuted", on: true }]],
    ];
    for (const [why, from, sigs] of paths) {
      const { state, out } = run(from, sigs);
      expect(submits(out), why).toEqual(["a"]);
      expect(state.turnHold, why).toBe(false);
    }
  });

  it("a DROPPED final leaves a RUNNING hold untouched — echo, noise or a TV must not hold the turn open", () => {
    const a = run(routed, said("A", "a")).state;
    for (const dropped of [
      fin("", "Z"),
      { ...fin("tv", "Z"), energyMs: 10, minFinalMs: 200 },
      { ...fin("reply", "Z"), echo: 1, echoMin: 0.75 },
    ]) {
      const { state, out } = run(a, [dropped]);
      expect(out.filter((e) => e.type === "submit")).toEqual([]);
      expect(state.turnHold).toBe(true);
      expect(state.turnHoldSeq).toBe(a.turnHoldSeq);
      expect(state.pending).toEqual(["a"]);
    }
  });

  it("a lost leg RELEASES it, and the fresh leg's `ready` sends the words", () => {
    const a = run(routed, said("A", "a")).state;
    const lost = run(a, [{ type: "socketLost" }]);
    expect(lost.state.turnHold).toBe(false);
    expect(lost.state.phase).toBe("connecting");
    expect(lost.state.pending).toEqual(["a"]);
    expect(submits(lost.out)).toEqual([]);
    // the old clock finds no hold standing
    expect(submits(run(lost.state, [over(a)]).out)).toEqual([]);
    expect(submits(run(lost.state, [{ type: "ready" }]).out)).toEqual(["a"]);
  });

  it("a route cycle or an earDead rebuild CLEARS it and keeps the queue — the old clock is a ghost", () => {
    const a = run(routed, said("A", "a")).state;
    for (const sig of [
      { type: "routeChange", route: "media" },
      { type: "earDead", reason: "noFrame", heard: true },
    ] as CallSignal[]) {
      const moved = run(a, [sig]).state;
      expect(moved.turnHold).toBe(false);
      expect(moved.turnHoldDue).toBe(false);
      expect(moved.pending).toEqual(["a"]);
      expect(moved.gen).toBe(a.gen + 1);
      const ghost = run(moved, [{ ...over(a), gen: a.gen }]);
      expect(submits(ghost.out)).toEqual([]);
      expect(submits(run(moved, [{ type: "ready", gen: moved.gen }]).out)).toEqual(["a"]);
    }
  });

  it("a terminal or a page going away HARVESTS the held words", () => {
    const a = run(routed, said("A", "a")).state;
    const failed = run(a, [{ type: "serverError", code: "protocol", message: "" }]);
    expect(failed.out[0]).toEqual({ type: "harvest", lines: ["a"] });
    expect(failed.state.turnHold).toBe(false);
    expect(run(a, [{ type: "hidden" }]).out[0]).toEqual({ type: "harvest", lines: ["a"] });
  });

  it("a HANG-UP inside the hold harvests the held words too — ONCE, never a submit (TH code round, Opus M1)", () => {
    const ab = run(run(routed, said("A", "a")).state, said("B", "b")).state;
    for (const exit of [{ type: "unmounted" }, { type: "hangup" }] as CallSignal[]) {
      const first = run(ab, [exit]);
      expect(first.out).toEqual([
        { type: "harvest", lines: ["a", "b"] },
        { type: "teardown", close: exit.type !== "unmounted" },
      ]);
      // A second exit on the same instance (a doubled cleanup) finds the queue consumed.
      expect(run(first.state, [{ type: "unmounted" }]).out).toEqual([
        { type: "teardown", close: false },
      ]);
    }
    // …and with the knob at 0 (no hold standing) words queued behind a reply are harvested
    // too (ISS-61 — every exit harvests).
    const queued = run(routed, [
      { type: "final", text: "hello" },
      { type: "playbackStarted" },
      { type: "final", text: "wait" },
    ]).state;
    expect(queued.pending).toEqual(["wait"]);
    expect(run(queued, [{ type: "unmounted" }]).out).toEqual([
      { type: "harvest", lines: ["wait"] },
      { type: "teardown", close: false },
    ]);
  });

  it("an ear outage mid-hold: the expiry in `connecting` lets go, the lost leg redials, `ready` sends ONCE", () => {
    const a = run(routed, said("A", "a")).state;
    const asleep = run(a, [{ type: "earOutage" }]);
    expect(asleep.out).toEqual([{ type: "closeLeg" }]);
    const expired = run(asleep.state, [over(a)]);
    expect(submits(expired.out)).toEqual([]); // `connecting` holds the queue
    expect(expired.state.turnHold).toBe(false);
    const back = run(expired.state, [{ type: "socketLost" }, { type: "ready" }]);
    expect(submits(back.out)).toEqual(["a"]);
  });

  it("a stale or homeless `turnHoldOver` is inert", () => {
    const a = run(routed, said("A", "a")).state;
    for (const sig of [
      { type: "turnHoldOver", seq: a.turnHoldSeq - 1 },
      { type: "turnHoldOver", seq: a.turnHoldSeq, gen: a.gen - 1 },
    ] as CallSignal[]) {
      const { state, out } = run(a, [sig]);
      expect(out).toEqual([]);
      expect(state).toBe(a);
    }
    // …and with no hold standing at all.
    const none = run(routed, [{ type: "turnHoldOver", seq: routed.turnHoldSeq }]);
    expect(none.out).toEqual([]);
    expect(none.state.turnHoldDue).toBe(false);
  });

  it("MUTE keeps the held text (the main seat's Q1): only the half-utterance in flight is condemned", () => {
    const a = run(routed, said("A", "a")).state;
    const muted = run(a, [{ type: "setMuted", on: true }]).state;
    expect(muted.turnHold).toBe(true);
    expect(muted.pending).toEqual(["a"]);
    expect(submits(run(muted, [over(muted)]).out)).toEqual(["a"]);
  });

  it("the MOUTH stays shut while it stands — over a settled ear — and opens on its release", () => {
    const a = run(routed, said("A", "a")).state;
    expect(a.waitingFinal).toBe(false);
    expect(a.userSpeechActive).toBe(false);
    expect(mouthMayOpen(a)).toBe(false);
    expect(mouthMayOpen(run(a, [over(a)]).state)).toBe(true);
  });

  it("a hold taken while the reply SPEAKS waits for the drain as well — and a drain inside it sends nothing", () => {
    const routedSpeaking = run(routed, [
      { type: "final", text: "hello" },
      { type: "playbackStarted" },
    ]).state;
    const a = run(routedSpeaking, [fin("wait")]).state;
    expect(a.turnHold).toBe(true);
    // expiry first: the hold lets go, `speaking` still holds the queue, the drain sends it
    const expired = run(a, [over(a)]);
    expect(submits(expired.out)).toEqual([]);
    expect(expired.state.turnHold).toBe(false);
    expect(submits(run(expired.state, [{ type: "playbackDrained" }]).out)).toEqual(["wait"]);
    // drain first: the reply ends, the hold still stands, its expiry sends it
    const drained = run(a, [{ type: "playbackDrained" }]);
    expect(submits(drained.out)).toEqual([]);
    expect(drained.state.phase).toBe("listening");
    expect(submits(run(drained.state, [over(a)]).out)).toEqual(["wait"]);
  });

  it("E-N3, both orders, is ONE turn — even with a clock running out between the two finals", () => {
    // stop(A) → start(B) → final(A) → stop(B) → final(B): Speaches' routine overlap.
    const routine = run(routed, [
      seg("speechStart", "A"),
      seg("speechStop", "A"),
      seg("speechStart", "B"),
      fin("a", "A"),
    ]);
    const mid = run(routine.state, [over(routine.state)]).state; // B is open: due, nothing sent
    expect(mid.turnHoldDue).toBe(true);
    const r = run(mid, [seg("speechStop", "B"), fin("b", "B")]);
    expect(submits([...routine.out, ...r.out])).toEqual([]);
    expect(submits(run(r.state, [over(r.state)]).out)).toEqual(["a b"]);
    // stop(A) → start(B) → stop(B) → final(A) → final(B): the order D9's set exists for.
    const owedBoth = run(routed, [
      seg("speechStart", "A"),
      seg("speechStop", "A"),
      seg("speechStart", "B"),
      seg("speechStop", "B"),
      fin("a", "A"),
    ]).state;
    const dueOwed = run(owedBoth, [over(owedBoth)]).state; // B still owed
    expect(dueOwed.turnHoldDue).toBe(true);
    const both = run(dueOwed, [fin("b", "B")]);
    expect(submits(both.out)).toEqual([]);
    expect(submits(run(both.state, [over(both.state)]).out)).toEqual(["a b"]);
  });

  it("a backgrounded call is not IDLE while a hold stands (TH design round, Opus L1)", () => {
    const a = run(routed, said("A", "a")).state;
    const { state, out } = run(a, [{ type: "idleExpired" }]);
    expect(out).toEqual([]);
    expect(state.phase).toBe("listening");
    expect(state.pending).toEqual(["a"]);
  });

  it("`turnHoldMs` absent or 0 is today's call, state for state and effect for effect", () => {
    const today: CallSignal[] = [
      { type: "final", text: "first" },
      { type: "playbackStarted" },
      seg("speechStart", "A"),
      seg("speechStop", "A"),
      { type: "final", text: "wait", itemId: "A" },
      { type: "final", text: "actually never mind" },
      { type: "playbackDrained" },
      { type: "turnSettled" },
      { type: "final", text: "" },
      { type: "final", text: "quiet", energyMs: 10, minFinalMs: 200 },
      { type: "final", text: "last" },
    ];
    const absent = run(routed, today);
    const zero = run(
      routed,
      today.map((sig) => (sig.type === "final" ? { ...sig, turnHoldMs: 0 } : sig)),
    );
    expect(zero.steps).toEqual(absent.steps);
    expect(zero.state).toEqual(absent.state);
    expect(submits(absent.out)).toEqual(["first", "wait actually never mind", "last"]);
    expect(absent.state.turnHold).toBe(false);
    expect(absent.state.turnHoldSeq).toBe(routed.turnHoldSeq);
  });
});

// ── S7a: THE CLIENT HALF OF THE NEW WIRE (ASR_PLAN §3.5 ⑤ ⑨ · §7.2 S7a) ────────────────────────────

describe("callReduce — the leg clock, the cap join and the awaited-id TTL (S7a)", () => {
  const TTL = 21000;
  const HOLD = 5000;
  /** A leg whose relay declared the clock (§3.2), on the call route like `routed`. */
  const clocked = run(CALL_INITIAL, [
    { type: "captureReady", holdMode: "auto", ecAll: true, route: "call", deviceId: "" },
    { type: "ready", clock: "leg", answerTtlMs: TTL },
  ]).state;
  type Fin = Extract<CallSignal, { type: "final" }>;
  /** A capability final: `reason`/`outcome` as the relay stamps them, the knob as the wiring does. */
  const fin = (
    text: string,
    itemId: string,
    reason: Fin["reason"] = "endpoint",
    outcome: Fin["outcome"] = text ? "ok" : "no_speech",
    holdMs = 0,
  ): Fin => ({
    type: "final",
    text,
    itemId,
    reason,
    outcome,
    ...(holdMs > 0 ? { turnHoldMs: holdMs } : {}),
  });
  const cut = (text: string, itemId: string, holdMs = 0): Fin =>
    fin(text, itemId, "max_segment", "ok", holdMs);
  const ttl = (itemId: string, gen?: number): CallSignal => ({
    type: "answerExpired",
    itemId,
    ...(gen === undefined ? {} : { gen }),
  });

  it("`ready` carries the capability per leg — and a later bare `ready` turns it OFF (a rolled-back relay)", () => {
    expect(clocked.answerTtlMs).toBe(TTL);
    expect(routed.answerTtlMs).toBeNull();
    const rolled = run(clocked, [{ type: "socketLost" }, { type: "ready" }]).state;
    expect(rolled.answerTtlMs).toBeNull();
  });

  it("INERT without the clock: a `max_segment` final drains at hold 0, opens no join, and a TTL is a ghost", () => {
    const { state, out } = run(routed, [
      seg("speechStart", "A"),
      seg("speechStop", "A"),
      { type: "final", text: "a", itemId: "A", reason: "max_segment", outcome: "ok" },
    ]);
    expect(submits(out)).toEqual(["a"]);
    expect(state.capJoin).toBe(false);
    expect(state.turnHold).toBe(false);
    const owedA = run(routed, [seg("speechStart", "A"), seg("speechStop", "A")]).state;
    expect(run(owedA, [ttl("A")]).state).toBe(owedA);
  });

  it("a 25 s turn — cut at the cap, continued — submits ONE turn (hold 0)", () => {
    const cutA = run(clocked, [
      seg("speechStart", "A"),
      seg("speechStop", "A"), // the cap cut: stop(A) …
      seg("speechStart", "B"), // … and B starts AT the cut
      cut("the first twenty seconds", "A"),
    ]);
    expect(submits(cutA.out)).toEqual([]);
    expect(cutA.state.turnHold).toBe(true);
    expect(cutA.state.capJoin).toBe(true);
    expect(cutA.state.turnHoldSeq).toBe(clocked.turnHoldSeq); // no 0-ms clock
    expect(mouthMayOpen(cutA.state)).toBe(false);
    const { state, out } = run(cutA.state, [seg("speechStop", "B"), fin("and the rest", "B")]);
    expect(submits(out)).toEqual(["the first twenty seconds and the rest"]);
    expect(state.turnHold).toBe(false);
    expect(state.capJoin).toBe(false);
  });

  it("E-N3, the cap variant at hold 0, both orders ⇒ ONE turn", () => {
    const routine = run(clocked, [
      seg("speechStart", "A"),
      seg("speechStop", "A"),
      seg("speechStart", "B"),
      cut("a", "A"),
      seg("speechStop", "B"),
      fin("b", "B"),
    ]);
    expect(submits(routine.out)).toEqual(["a b"]);
    const owedFirst = run(clocked, [
      seg("speechStart", "A"),
      seg("speechStop", "A"),
      seg("speechStart", "B"),
      seg("speechStop", "B"),
      cut("a", "A"),
      fin("b", "B"),
    ]);
    expect(submits(owedFirst.out)).toEqual(["a b"]);
  });

  it("EM-1: a three-segment capped turn (`max_segment → max_segment → endpoint`) ⇒ ONE turn", () => {
    const { out, steps } = run(clocked, [
      seg("speechStart", "A"),
      seg("speechStop", "A"),
      seg("speechStart", "B"),
      cut("a", "A"),
      seg("speechStop", "B"),
      seg("speechStart", "C"),
      cut("b", "B"),
      seg("speechStop", "C"),
      fin("c", "C"),
    ]);
    expect(submits(out)).toEqual(["a b c"]);
    expect(submits(steps[steps.length - 1])).toEqual(["a b c"]); // on C's final, not before
  });

  it("EM-1: an absorbed cap final CONTINUES the join whatever its fate (empty, too quiet) — H4: a dropped one opens none", () => {
    const a = run(clocked, [seg("speechStart", "A"), seg("speechStop", "A"), cut("a", "A")]).state;
    const quietB = run(a, [
      seg("speechStart", "B"),
      seg("speechStop", "B"),
      { ...cut("um", "B"), energyMs: 5, minFinalMs: 200 },
    ]);
    expect(submits(quietB.out)).toEqual([]);
    expect(quietB.state.capJoin).toBe(true);
    const emptyC = run(quietB.state, [
      seg("speechStart", "C"),
      seg("speechStop", "C"),
      fin("", "C", "max_segment", "no_speech"),
    ]).state;
    expect(emptyC.capJoin).toBe(true);
    expect(
      submits(run(emptyC, [seg("speechStart", "D"), seg("speechStop", "D"), fin("d", "D")]).out),
    ).toEqual(["a d"]);
    // H4 — a DROPPED cap final with no hold standing has nothing to join
    const lone = run(clocked, [
      seg("speechStart", "A"),
      seg("speechStop", "A"),
      fin("", "A", "max_segment", "no_speech"),
    ]).state;
    expect(lone.capJoin).toBe(false);
    expect(lone.turnHold).toBe(false);
  });

  it("R3-1: several absorbed segments release on the LAST absorbed non-`max_segment` final", () => {
    // A is cut; B ends at an endpoint while C is already open — the release waits for C's answer.
    const b = run(clocked, [
      seg("speechStart", "A"),
      seg("speechStop", "A"),
      seg("speechStart", "B"),
      cut("a", "A"),
      seg("speechStop", "B"),
      seg("speechStart", "C"),
      fin("b", "B"),
    ]);
    expect(submits(b.out)).toEqual([]);
    expect(b.state.capJoin).toBe(false);
    expect(b.state.turnHoldDue).toBe(true);
    const { out } = run(b.state, [seg("speechStop", "C"), fin("", "C", "short", "skipped")]);
    expect(submits(out)).toEqual(["a b"]); // the retraction released it — its own text was none
  });

  // N-2 — every other reason and outcome ends the join, a gate-dropped or echo-dropped one included.
  const releases: [string, Fin][] = [
    ["endpoint/ok", fin("b", "B", "endpoint", "ok")],
    ["endpoint/no_speech", fin("", "B", "endpoint", "no_speech")],
    ["endpoint/asr_error", fin("", "B", "endpoint", "asr_error")],
    ["flush/ok", fin("b", "B", "flush", "ok")],
    ["flush/no_speech", fin("", "B", "flush", "no_speech")],
    ["flush/asr_error", fin("", "B", "flush", "asr_error")],
    ["short/skipped", fin("", "B", "short", "skipped")],
    ["D74 too quiet", { ...fin("b", "B"), energyMs: 5, minFinalMs: 200 }],
    ["the echo backstop", { ...fin("b", "B"), echo: 0.95, echoMin: 0.8 }],
  ];
  for (const [name, last] of releases)
    it(`N-2: the join is released by a ${name} final`, () => {
      const a = run(clocked, [
        seg("speechStart", "A"),
        seg("speechStop", "A"),
        cut("a", "A"),
        seg("speechStart", "B"),
        seg("speechStop", "B"),
      ]).state;
      const { state, out } = run(a, [last]);
      const taken = last.outcome === "ok" && last.energyMs === undefined && last.echo === undefined;
      expect(submits(out)).toEqual([taken ? "a b" : "a"]);
      expect(state.turnHold).toBe(false);
      expect(state.capJoin).toBe(false);
    });

  it("an `asr_error` final settles SILENTLY and takes no text even with some (H6) — its `upstream_error` sets the one note", () => {
    const owedA = run(clocked, [seg("speechStart", "A"), seg("speechStop", "A")]).state;
    const errored = run(owedA, [fin("ghost words", "A", "endpoint", "asr_error")]);
    expect(errored.state.awaiting).toEqual([]);
    expect(errored.state.pending).toEqual([]);
    expect(errored.state.note).toBeNull();
    expect(errored.out).toEqual([]);
    const noted = run(errored.state, [
      { type: "serverError", code: "upstream_error", message: "asr failed", itemId: "A" },
    ]).state;
    expect(noted.note).toBe("asr failed");
    expect(noted.phase).toBe("listening");
  });

  it("H1: an ANOMALOUS final settles its id, takes no text, and its reason is no evidence (no join)", () => {
    const owedA = run(clocked, [seg("speechStart", "A"), seg("speechStop", "A")]).state;
    const { state, out } = run(owedA, [{ ...cut("words", "A"), anomaly: "order" }]);
    expect(state.awaiting).toEqual([]);
    expect(state.pending).toEqual([]);
    expect(state.capJoin).toBe(false);
    expect(state.turnHold).toBe(false);
    expect(out).toEqual([]);
    expect(mouthMayOpen(state)).toBe(true);
  });

  it("socket loss with a join standing submits ONCE, at the fresh leg's `ready`", () => {
    const a = run(clocked, [
      seg("speechStart", "A"),
      seg("speechStop", "A"),
      seg("speechStart", "B"),
      cut("a", "A"),
    ]).state;
    const lost = run(a, [{ type: "socketLost" }]);
    expect(lost.state.capJoin).toBe(false);
    expect(lost.state.turnHold).toBe(false);
    expect(submits(lost.out)).toEqual([]);
    // B's segment died with the old socket (§4.5): `ready` sends the held words ONCE, and nothing waits
    // on a continuation that cannot come
    const back = run(lost.state, [{ type: "ready", clock: "leg", answerTtlMs: TTL }]);
    expect(submits(back.out)).toEqual(["a"]);
    expect(back.state.turnHold).toBe(false);
  });

  it("mute KEEPS the held words and CLEARS the join (audit §C.6) — at 0 they go out at once, with the knob on the clock decides", () => {
    const a = run(clocked, [
      seg("speechStart", "A"),
      seg("speechStop", "A"),
      seg("speechStart", "B"),
      cut("a", "A"),
    ]).state;
    const muted = run(a, [{ type: "setMuted", on: true }]);
    expect(muted.state.capJoin).toBe(false);
    expect(submits(muted.out)).toEqual(["a"]); // hold 0: due at once over the ear mute settled
    const timed = run(clocked, [
      seg("speechStart", "A"),
      seg("speechStop", "A"),
      seg("speechStart", "B"),
      cut("a", "A", HOLD),
    ]).state;
    const mutedTimed = run(timed, [{ type: "setMuted", on: true }]);
    expect(mutedTimed.state.capJoin).toBe(false);
    expect(mutedTimed.state.pending).toEqual(["a"]);
    expect(submits(mutedTimed.out)).toEqual([]);
    expect(
      submits(run(mutedTimed.state, [{ type: "turnHoldOver", seq: timed.turnHoldSeq }]).out),
    ).toEqual(["a"]);
  });

  it("the pause CANNOT release a join — the joined id's TTL can (§3.5 ⑤)", () => {
    const a = run(clocked, [
      seg("speechStart", "A"),
      seg("speechStop", "A"),
      cut("a", "A", HOLD),
      seg("speechStart", "B"),
      seg("speechStop", "B"),
    ]).state;
    expect(a.turnHoldSeq).toBe(clocked.turnHoldSeq + 1); // the ordinary clock runs beside the join
    const over = run(a, [{ type: "turnHoldOver", seq: a.turnHoldSeq }]);
    expect(over.state.turnHoldDue).toBe(true);
    expect(submits(over.out)).toEqual([]); // the pause ran out — the sentence did not
    const expired = run(over.state, [ttl("B")]);
    expect(expired.state.awaiting).toEqual([]);
    expect(expired.state.note).toBe(CALL_COPY.answerLate);
    expect(submits(expired.out)).toEqual(["a"]);
    // …and at hold 0 (no clock at all) the TTL is the only expiry the join has
    const zero = run(clocked, [
      seg("speechStart", "A"),
      seg("speechStop", "A"),
      cut("a", "A"),
      seg("speechStart", "B"),
      seg("speechStop", "B"),
    ]).state;
    expect(submits(run(zero, [ttl("B")]).out)).toEqual(["a"]);
  });

  it("the TTL drops the HEAD only, notes it quietly (H8 — no cue), and is a ghost for any other id or generation", () => {
    const both = run(clocked, [
      seg("speechStart", "A"),
      seg("speechStop", "A"),
      seg("speechStart", "B"),
      seg("speechStop", "B"),
    ]).state;
    expect(run(both, [ttl("B")]).state).toBe(both); // B is not the head
    expect(run(both, [ttl("A", both.gen + 1)]).state).toBe(both); // a stale generation
    const { state, out } = run(both, [ttl("A")]);
    expect(state.awaiting).toEqual(["B"]);
    expect(state.note).toBe(CALL_COPY.answerLate);
    expect(out).toEqual([]);
    expect(mouthMayOpen(state)).toBe(false); // B is still owed
    expect(mouthMayOpen(run(state, [ttl("B")]).state)).toBe(true);
  });

  it("a join waiting on an expired id with a segment still OPEN keeps waiting for that segment's final", () => {
    const a = run(clocked, [
      seg("speechStart", "A"),
      seg("speechStop", "A"),
      seg("speechStart", "B"),
      cut("a", "A"),
      seg("speechStop", "B"),
      seg("speechStart", "C"),
    ]).state;
    const expired = run(a, [ttl("B")]);
    expect(expired.state.capJoin).toBe(true); // C is open — its final ends the join
    expect(submits(expired.out)).toEqual([]);
    expect(submits(run(expired.state, [seg("speechStop", "C"), fin("c", "C")]).out)).toEqual([
      "a c",
    ]);
  });

  it("R3-2: a LATE final with text is taken; an empty one, or an `asr_error` one carrying text, is dropped", () => {
    const owedA = run(clocked, [seg("speechStart", "A"), seg("speechStop", "A")]).state;
    const expired = run(owedA, [ttl("A")]).state;
    const late = (f: Fin): Fin => ({ ...f, late: true });
    const taken = run(expired, [late(fin("there you are", "A"))]);
    expect(submits(taken.out)).toEqual(["there you are"]);
    expect(run(expired, [late(fin("", "A"))]).out).toEqual([]);
    const err = run(expired, [late(fin("garbled", "A", "endpoint", "asr_error"))]);
    expect(err.out).toEqual([]);
    expect(err.state.pending).toEqual([]);
  });

  it("`ear_failed` is note-only; the 1011 close's `socketLost` RECONNECTS — not a terminal (R2-1) — and the fresh leg retracts the note (H7)", () => {
    const failed = run(clocked, [
      { type: "serverError", code: "ear_failed", message: "vad behind" },
    ]);
    expect(failed.state.phase).toBe("listening");
    expect(failed.state.note).toBe(CALL_COPY.earFailed);
    expect(failed.out).toEqual([]);
    const lost = run(failed.state, [{ type: "socketLost" }]);
    expect(lost.state.phase).toBe("connecting");
    expect(lost.out).toEqual([{ type: "reconnect", delayMs: 400 }]);
    const back = run(lost.state, [{ type: "ready", clock: "leg", answerTtlMs: TTL }]).state;
    expect(back.phase).toBe("listening");
    expect(back.note).toBeNull();
  });

  it("review LOW-2: the TTL's `answerLate` note is retracted by the next TAKEN final (the D80 W6 `tooQuiet` pattern)", () => {
    const owedA = run(clocked, [seg("speechStart", "A"), seg("speechStop", "A")]).state;
    const late = run(owedA, [ttl("A")]).state;
    expect(late.note).toBe(CALL_COPY.answerLate);
    // a DROPPED final leaves it standing — only words the ear took disprove it
    expect(
      run(late, [seg("speechStart", "B"), seg("speechStop", "B"), fin("", "B")]).state.note,
    ).toBe(CALL_COPY.answerLate);
    const back = run(late, [seg("speechStart", "B"), seg("speechStop", "B"), fin("hello", "B")]);
    expect(back.state.note).toBeNull();
    expect(submits(back.out)).toEqual(["hello"]);
  });

  it("review LOW-3: on a clock leg an ID-LESS anomalous final settles NOTHING — the owed ids wait for their TTL", () => {
    const both = run(clocked, [
      seg("speechStart", "A"),
      seg("speechStop", "A"),
      seg("speechStart", "B"),
      seg("speechStop", "B"),
    ]).state;
    const idless: Fin = { type: "final", text: "words", anomaly: "item_id" };
    const { state, out } = run(both, [idless]);
    expect(state.awaiting).toEqual(["A", "B"]);
    expect(mouthMayOpen(state)).toBe(false);
    expect(out).toEqual([]);
    expect(run(state, [ttl("A"), ttl("B")]).state.awaiting).toEqual([]); // the TTL's to expire
    // …while a leg WITHOUT the clock keeps today's id-less belt: the whole set clears
    const legacy = run(routed, [
      seg("speechStart", "A"),
      seg("speechStop", "A"),
      seg("speechStart", "B"),
      seg("speechStop", "B"),
      { type: "final", text: "" },
    ]).state;
    expect(legacy.awaiting).toEqual([]);
  });

  it("every clear path takes the join with it — a route cycle and a terminal", () => {
    const a = run(clocked, [
      seg("speechStart", "A"),
      seg("speechStop", "A"),
      seg("speechStart", "B"),
      cut("a", "A"),
    ]).state;
    const cycled = run(a, [{ type: "routeChange", route: "media" }]).state;
    expect(cycled.capJoin).toBe(false);
    expect(cycled.turnHold).toBe(false);
    expect(cycled.pending).toEqual(["a"]);
    const ended = run(a, [{ type: "captureLost" }]);
    expect(ended.state.capJoin).toBe(false);
    expect(ended.out).toContainEqual({ type: "harvest", lines: ["a"] });
  });
});
