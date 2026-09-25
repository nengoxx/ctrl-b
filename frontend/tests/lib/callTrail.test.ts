import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CALL_INITIAL, type CallState, trailSig } from "../../src/hooks/useLiveCall";
import {
  createCallTrail,
  TRAIL_FLUSH_BYTES,
  TRAIL_INTERVAL_MS,
  TRAIL_MAX_ENTRIES,
  TRAIL_MAX_ENTRY_BYTES,
} from "../../src/lib/callTrail";

// lib/callTrail — THE CALL TRAIL's browser buffer (D77), and `trailSig`, the one function that turns a
// machine signal into a trail line. The buffer's contract is small and all of it is here: what a line
// is stamped with, the three flush triggers (count, bytes — the keepalive quota, council F3 — and the
// interval), which flushes ride `keepalive`, the 200-entry split, the oversized-entry marker, and that a
// failing POST is dropped and never reaches the call.

interface Posted {
  body: { call_id: string; entries: Record<string, unknown>[] };
  keepalive: boolean;
}

let posted: Posted[] = [];
let stamp = { leg: 1, gen: 0 };
let clock = 1000;

function trail(post?: (body: unknown, keepalive: boolean) => Promise<void>) {
  return createCallTrail({
    callId: "call-1",
    post:
      post ??
      ((body, keepalive) => {
        posted.push({ body: body as Posted["body"], keepalive });
        return Promise.resolve();
      }),
    stamp: () => stamp,
    now: () => clock,
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  posted = [];
  stamp = { leg: 1, gen: 0 };
  clock = 1000;
});
afterEach(() => {
  vi.useRealTimers();
});

describe("callTrail — the buffer", () => {
  it("stamps every line with t · leg · gen · ev, read at PUSH time (council F4)", () => {
    const t = trail();
    t.push("sig", { type: "ready" });
    stamp = { leg: 2, gen: 1 };
    clock = 2000;
    t.push("sample", { level: -50 });
    t.flush("interval");
    expect(posted).toHaveLength(1);
    expect(posted[0].body).toEqual({
      call_id: "call-1",
      entries: [
        { t: 1000, leg: 1, gen: 0, ev: "sig", type: "ready" },
        { t: 2000, leg: 2, gen: 1, ev: "sample", level: -50 },
      ],
    });
  });

  it("flushes on COUNT at 50 entries", () => {
    const t = trail();
    for (let i = 0; i < TRAIL_MAX_ENTRIES - 1; i++) t.push("x", { i });
    expect(posted).toHaveLength(0);
    t.push("x", { i: 49 });
    expect(posted).toHaveLength(1);
    expect(posted[0].body.entries).toHaveLength(TRAIL_MAX_ENTRIES);
    expect(posted[0].keepalive).toBe(false);
  });

  it("flushes on BYTES before a batch would pass 32 KiB — the entry that would pass it opens the NEXT batch", () => {
    const t = trail();
    const blob = "b".repeat(1900); // inside the per-entry bound; ~17 of them fill the budget
    let pushed = 0;
    while (posted.length === 0) t.push("big", { i: pushed++, blob });
    expect(pushed).toBeLessThan(TRAIL_MAX_ENTRIES); // BYTES tripped it, not the count
    // everything before the last push went; the last one waits in the next batch
    expect(posted[0].body.entries.map((e) => e.i)).toEqual([...Array(pushed - 1).keys()]);
    expect(JSON.stringify(posted[0].body).length).toBeLessThan(TRAIL_FLUSH_BYTES);
    t.flush("end");
    expect(posted[1].body.entries.map((e) => e.i)).toEqual([pushed - 1]);
  });

  it("an entry past the server's per-entry bound becomes an `oversize` marker — its batch still ships", () => {
    const t = trail();
    t.push("sig", { type: "ready" });
    t.push("sig", { type: "serverError", message: "x".repeat(3000) }); // an unbounded upstream text
    t.push("sig", { type: "failed" });
    t.flush("interval");
    expect(posted).toHaveLength(1);
    const [before, marker, after] = posted[0].body.entries;
    expect(before).toMatchObject({ ev: "sig", type: "ready" });
    expect(marker).toEqual({
      t: 1000,
      leg: 1,
      gen: 0,
      ev: "sig",
      type: "serverError", // the marker keeps WHICH signal it stood for
      oversize: expect.any(Number) as number,
    });
    expect(marker.oversize).toBeGreaterThan(3000);
    expect(after).toMatchObject({ ev: "sig", type: "failed" });
    // …so no entry of the batch is one the server would refuse it over
    for (const e of posted[0].body.entries)
      expect(JSON.stringify(e).length).toBeLessThanOrEqual(TRAIL_MAX_ENTRY_BYTES);
  });

  it("flushes on the 2 s INTERVAL, started lazily and stopped when empty", () => {
    const t = trail();
    vi.advanceTimersByTime(TRAIL_INTERVAL_MS * 3);
    expect(posted).toHaveLength(0); // nothing pushed ⇒ no clock at all
    t.push("x");
    vi.advanceTimersByTime(TRAIL_INTERVAL_MS - 1);
    expect(posted).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(posted).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0); // an empty buffer stops the clock — an idle call posts nothing
  });

  it("`hidden` and `end` ride keepalive; `interval` and `count` do not", () => {
    const t = trail();
    t.push("a");
    t.flush("hidden");
    t.push("b");
    t.flush("end");
    t.push("c");
    t.flush("interval");
    expect(posted.map((p) => p.keepalive)).toEqual([true, true, false]);
  });

  it("a flush of an empty buffer posts nothing", () => {
    trail().flush("end");
    expect(posted).toHaveLength(0);
  });

  it("SPLITS a flush past 200 entries into several POSTs", () => {
    const t = createCallTrail({
      callId: "call-1",
      post: (body, keepalive) => {
        posted.push({ body: body as Posted["body"], keepalive });
        return Promise.resolve();
      },
      stamp: () => stamp,
      maxEntries: 1000, // a caller-raised count bound, so one flush carries more than a POST may
    });
    for (let i = 0; i < 450; i++) t.push("x", { i });
    t.flush("end");
    expect(posted.map((p) => p.body.entries.length)).toEqual([200, 200, 50]);
    expect(posted.every((p) => p.body.call_id === "call-1" && p.keepalive)).toBe(true);
  });

  it("a REJECTED POST drops its batch, logs once, never retries, never throws", async () => {
    const debug = vi.spyOn(console, "debug").mockImplementation(() => {});
    let calls = 0;
    const t = trail(() => {
      calls += 1;
      return Promise.reject(new Error("503"));
    });
    t.push("a");
    expect(() => t.flush("end")).not.toThrow();
    t.push("b");
    t.flush("end");
    await Promise.resolve();
    await Promise.resolve();
    expect(calls).toBe(2); // one per batch — the first was not retried
    expect(debug).toHaveBeenCalledTimes(1);
    // …and a post that throws SYNCHRONOUSLY is contained the same way
    const u = trail(() => {
      throw new Error("sync");
    });
    u.push("a");
    expect(() => u.flush("end")).not.toThrow();
  });

  it("`dispose` stops the timer and ignores every later push and flush", () => {
    const t = trail();
    t.push("a");
    expect(vi.getTimerCount()).toBe(1);
    t.dispose();
    expect(vi.getTimerCount()).toBe(0);
    t.push("b");
    t.flush("end");
    vi.advanceTimersByTime(TRAIL_INTERVAL_MS * 2);
    expect(posted).toHaveLength(0);
  });
});

describe("trailSig — one signal, one line (D77, council F5/F1)", () => {
  const live: CallState = { ...CALL_INITIAL, phase: "listening", gen: 2 };

  it("a `final` carries textLen and NO text, plus the PRE-reduce ear snapshot", () => {
    const prev: CallState = {
      ...live,
      earHeld: true,
      mouthLive: true,
      probeOpen: false,
      probeIdx: 3,
    };
    const next: CallState = { ...prev, phase: "thinking", earHeld: false };
    const line = trailSig(
      { type: "final", text: "wake up corsair", energyMs: 400, minFinalMs: 200, gen: 2 },
      prev,
      next,
    );
    expect(line).toEqual({
      type: "final",
      textLen: 15,
      energyMs: 400,
      minFinalMs: 200,
      pre: { earHeld: true, mouthLive: true, probeOpen: false, probeIdx: 3, muted: false },
      phase: "listening→thinking",
    });
    expect(JSON.stringify(line)).not.toContain("wake up");
  });

  it("`sent` loses its text the same way; `chunkStarted` keeps its idx", () => {
    expect(trailSig({ type: "sent", outcome: "accepted", text: "hi there" }, live, live)).toEqual({
      type: "sent",
      outcome: "accepted",
      textLen: 8,
    });
    expect(trailSig({ type: "chunkStarted", idx: 4, gen: 2 }, live, live)).toEqual({
      type: "chunkStarted",
      idx: 4,
    });
  });

  it("names a FENCED signal's generation, and a note only when the reduce moved it", () => {
    expect(trailSig({ type: "speechStart", gen: 1 }, live, live)).toEqual({
      type: "speechStart",
      staleGen: 1,
    });
    const noted: CallState = { ...live, note: "connection strained" };
    expect(trailSig({ type: "degraded", gen: 2 }, live, noted)).toEqual({
      type: "degraded",
      note: "connection strained",
    });
  });

  it("names a generation MOVE — the line is stamped with the new one, so it says which it ran under", () => {
    const ended: CallState = { ...CALL_INITIAL, phase: "ended", gen: 3 };
    expect(trailSig({ type: "unmounted" }, live, ended)).toEqual({
      type: "unmounted",
      phase: "listening→ended",
      genMove: "2→3",
    });
    expect(trailSig({ type: "speechStart", gen: 2 }, live, live)).not.toHaveProperty("genMove");
  });
});
