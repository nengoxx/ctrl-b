import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  cancelTurn,
  confirmAwaiting,
  confirmOutstanding,
  getLiveTurn,
  sendMessage,
  startNewThread,
  stopTurn,
  useChat,
  type SendOutcome,
} from "../../src/store/chat";
import { clearDraft, getDraft } from "../../src/store/composer";

// store/chat — THE LIVE-TURN SEAM (D71 §4.2's council F3) and the two things built on it: the send
// OUTCOME (F8) and normalize-on-202 (§4.5's recorded pre-existing defect). Driven through the real
// public API against a mocked `fetch`, exactly like `chat.test.ts` — so the real reducer, the real seq
// gate and the real cancel contract run, and the assertions are on what the owner would see.

type Frame = { event: string; data: unknown; id?: string };

/** An SSE response body that stays OPEN until the test releases it — what a live turn actually is. */
function openStream(frames: Frame[]): { res: Response; push: (f: Frame) => void; end: () => void } {
  const enc = new TextEncoder();
  let controller: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
      for (const f of frames) c.enqueue(enc.encode(frameText(f)));
    },
  });
  return {
    res: {
      ok: true,
      status: 200,
      body,
      headers: {
        get: (k: string) => (k.toLowerCase() === "content-type" ? "text/event-stream" : null),
      },
    } as unknown as Response,
    push: (f) => controller.enqueue(enc.encode(frameText(f))),
    end: () => controller.close(),
  };
}

const frameText = (f: Frame): string =>
  `event: ${f.event}\r\n${f.id ? `id: ${f.id}\r\n` : ""}data: ${JSON.stringify(f.data)}\r\n\r\n`;

function closedStream(frames: Frame[]): Response {
  const bytes = new TextEncoder().encode(frames.map(frameText).join(""));
  return {
    ok: true,
    status: 200,
    body: new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(bytes);
        c.close();
      },
    }),
    headers: {
      get: (k: string) => (k.toLowerCase() === "content-type" ? "text/event-stream" : null),
    },
  } as unknown as Response;
}

const json = (status: number, payload: unknown): Response =>
  ({
    ok: status < 300,
    status,
    // Truthy, like a real JSON response's stream: `streamTurn` treats a body-less OK as a transport
    // failure, and the buffered (D17) branch is reached THROUGH that check.
    body: {},
    headers: {
      get: (k: string) => (k.toLowerCase() === "content-type" ? "application/json" : null),
    },
    json: async () => payload,
  }) as unknown as Response;

/** Route `fetch` by URL so a cancel POST can answer differently from the chat POST. */
function routes(map: Record<string, (url: string) => Response | Promise<Response>>): void {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    for (const [needle, make] of Object.entries(map)) if (url.includes(needle)) return make(url);
    return json(200, {});
  });
}

beforeEach(() => {
  startNewThread();
  clearDraft();
});

describe("the live-turn seam (F3)", () => {
  it("is null with nothing streaming, and composes the three slots while one is", async () => {
    expect(getLiveTurn()).toBeNull();

    const live = openStream([
      { event: "thread", data: { threadId: "t1" } },
      { event: "message.start", data: { messageId: "m1" }, id: "turn-7:1" },
    ]);
    routes({ "/api/agent/chat": () => live.res });
    const { result } = renderHook(() => useChat());
    let sent: Promise<SendOutcome>;
    await act(async () => {
      sent = sendMessage("hello");
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current.status).toBe("streaming");
    expect(getLiveTurn()).toEqual({
      threadId: "t1",
      turnId: "turn-7", // the seq gate's current turn, not a second copy of it
      assistantMessageId: "m1",
    });

    await act(async () => {
      live.push({ event: "done", data: { state: "completed" }, id: "turn-7:2" });
      live.end();
      await sent;
    });
    // Settled: nothing to cancel any more.
    expect(getLiveTurn()).toBeNull();
  });

  it("`confirmOutstanding` sees a suspended call and stops seeing it once it resolves", async () => {
    const call = (state: string) => ({
      type: "tool_call",
      call_id: "c1",
      tool: "wake_host",
      args: {},
      state,
    });
    routes({
      "/api/agent/chat": () =>
        closedStream([
          { event: "thread", data: { threadId: "t1" } },
          { event: "message.start", data: { messageId: "m1" } },
          { event: "part.added", data: { messageId: "m1", part: call("pending") } },
          { event: "tool.permission", data: { callId: "c1", token: "tok" } },
          { event: "done", data: { state: "suspended" } },
        ]),
    });
    await act(async () => {
      await sendMessage("wake vault");
    });
    expect(confirmOutstanding()).toBe(true);

    routes({
      "/messages": () => json(200, []),
      "/api/agent/resume": () =>
        closedStream([
          {
            event: "tool.result",
            data: {
              messageId: "m1",
              callId: "c1",
              result: { state: "ok", summary: "done", data: {}, output: null, error: null },
            },
          },
          { event: "done", data: { state: "completed" } },
        ]),
    });
    const { resumeCall } = await import("../../src/store/chat");
    await act(async () => {
      await resumeCall("c1", "execute");
    });
    expect(confirmOutstanding()).toBe(false);
  });

  it("`confirmAwaiting` names the waiting call for the overlay's row — and is reference-stable", async () => {
    const call = (state: string) => ({
      type: "tool_call",
      call_id: "c1",
      tool: "wake_host",
      args: {},
      state,
    });
    routes({
      "/api/agent/chat": () =>
        closedStream([
          { event: "thread", data: { threadId: "t1" } },
          { event: "message.start", data: { messageId: "m1" } },
          { event: "part.added", data: { messageId: "m1", part: call("pending") } },
          { event: "tool.permission", data: { callId: "c1", token: "tok" } },
          { event: "done", data: { state: "suspended" } },
        ]),
    });
    await act(async () => {
      await sendMessage("wake vault");
    });
    expect(confirmAwaiting()).toEqual({ callId: "c1", tool: "wake_host" });
    // THE STORE CONTRACT: a snapshot must be a primitive or a STABLE reference — a fresh object per
    // read makes `useSyncExternalStore` loop forever. Same gate, same object.
    expect(confirmAwaiting()).toBe(confirmAwaiting());

    routes({
      "/messages": () => json(200, []),
      "/api/agent/resume": () =>
        closedStream([
          {
            event: "tool.result",
            data: {
              messageId: "m1",
              callId: "c1",
              result: { state: "ok", summary: "done", data: {}, output: null, error: null },
            },
          },
          { event: "done", data: { state: "completed" } },
        ]),
    });
    const { resumeCall } = await import("../../src/store/chat");
    await act(async () => {
      await resumeCall("c1", "execute");
    });
    expect(confirmAwaiting()).toBeNull();
  });

  it("a suspended QUESTION holds the queue but earns NO Allow/Deny row", async () => {
    // `awaiting_answer` wants typed words, and the chat card is where those are given. The overlay
    // still holds its utterances for it (that is `confirmOutstanding`'s job) — it just has no row.
    routes({
      "/api/agent/chat": () =>
        closedStream([
          { event: "thread", data: { threadId: "t1" } },
          { event: "message.start", data: { messageId: "m1" } },
          {
            event: "part.added",
            data: {
              messageId: "m1",
              part: {
                type: "tool_call",
                call_id: "q1",
                tool: "question",
                args: {},
                state: "pending",
              },
            },
          },
          { event: "tool.question", data: { callId: "q1", question: "which host?" } },
          { event: "done", data: { state: "suspended" } },
        ]),
    });
    await act(async () => {
      await sendMessage("wake it");
    });
    expect(confirmOutstanding()).toBe(true);
    expect(confirmAwaiting()).toBeNull();
  });
});

describe("cancelTurn — the harvest disposition", () => {
  const harvestResponse = json(200, {
    cancelled: true,
    active: false,
    steer_queue: [{ entry_id: "e1", kind: "message", text: "the queued steer" }],
  });

  /** Start a turn and leave it streaming, so there is something to cancel. */
  async function liveTurn() {
    const live = openStream([
      { event: "thread", data: { threadId: "t1" } },
      { event: "message.start", data: { messageId: "m1" }, id: "turn-1:1" },
    ]);
    routes({
      "/api/agent/chat": () => live.res,
      "/cancel": () => harvestResponse,
      "/messages": () => json(200, []),
    });
    await act(async () => {
      void sendMessage("hi");
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    return live;
  }

  it("`draft` restores the harvested steers to the composer (today's text Stop)", async () => {
    await liveTurn();
    const ref = getLiveTurn()!;
    await act(async () => {
      await cancelTurn(ref, "draft");
    });
    expect(getDraft()).toBe("the queued steer");
  });

  it("`discard` CONSUMES them — a call-origin steer is not restored behind the live conversation", async () => {
    await liveTurn();
    const ref = getLiveTurn()!;
    await act(async () => {
      await cancelTurn(ref, "discard");
    });
    expect(getDraft()).toBe("");
  });

  it("scopes the POST to the ref's own turn id", async () => {
    await liveTurn();
    await act(async () => {
      await cancelTurn(getLiveTurn()!, "draft");
    });
    const calls = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    const cancel = calls.map((c) => String(c[0])).find((u) => u.includes("/cancel"));
    expect(cancel).toContain("turn_id=turn-1");
  });

  it("a concurrent cancel SHARES the first one's settlement instead of resolving early", async () => {
    // `cancelTurn` resolving means SETTLED — D71 §4.3 step ② submits the interrupting utterance on
    // that promise. A re-entry that returned immediately would submit into a turn still being killed.
    const live = openStream([
      { event: "thread", data: { threadId: "t1" } },
      { event: "message.start", data: { messageId: "m1" }, id: "turn-1:1" },
    ]);
    let release: (() => void) | null = null;
    const slowCancel = new Promise<Response>((r) => (release = () => r(harvestResponse)));
    let posts = 0;
    routes({
      "/api/agent/chat": () => live.res,
      "/cancel": () => {
        posts += 1;
        return slowCancel;
      },
      "/messages": () => json(200, []),
    });
    await act(async () => {
      void sendMessage("hi");
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    const ref = getLiveTurn()!;
    const settled: string[] = [];
    await act(async () => {
      void cancelTurn(ref, "discard").then(() => settled.push("first"));
      void cancelTurn(ref, "draft").then(() => settled.push("second"));
      await Promise.resolve();
    });
    expect(posts).toBe(1); // one cancel in flight, not two
    expect(settled).toEqual([]); // …and NOBODY is told it is done while it is not

    await act(async () => {
      release!();
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(settled).toEqual(["first", "second"]);
    // The FIRST caller's disposition is the one that applied: a `discard` racing a `draft` cannot
    // un-consume what the first already took.
    expect(getDraft()).toBe("");
  });

  it("`stopTurn` IS the seam plus its guard — same harvest, and inert with nothing live", async () => {
    const idle = vi.fn();
    globalThis.fetch = idle;
    await stopTurn(); // nothing streaming: the guard refuses before any POST
    expect(idle).not.toHaveBeenCalled();

    await liveTurn();
    await act(async () => {
      await stopTurn();
    });
    expect(getDraft()).toBe("the queued steer");
  });
});

describe("the send outcome (F8)", () => {
  it("a streamed 200 is ACCEPTED", async () => {
    routes({
      "/api/agent/chat": () =>
        closedStream([
          { event: "message.start", data: { messageId: "m1" } },
          { event: "done", data: { state: "completed" } },
        ]),
    });
    await expect(sendMessage("hi")).resolves.toBe("accepted");
  });

  it("a buffered JSON turn is ACCEPTED", async () => {
    routes({
      "/api/agent/chat": () => json(200, { threadId: "t1", state: "completed" }),
      "/messages": () => json(200, []),
    });
    await expect(sendMessage("hi")).resolves.toBe("accepted");
  });

  it("a 202 WITH an entry id is ACCEPTED; one without is REFUSED", async () => {
    routes({ "/api/agent/chat": () => json(202, { entry_id: "e9", turn_id: "t9" }) });
    await expect(sendMessage("steer")).resolves.toBe("accepted");

    routes({ "/api/agent/chat": () => json(202, {}) });
    await expect(sendMessage("steer")).resolves.toBe("refused");
  });

  it("a 409 is REFUSED", async () => {
    routes({ "/api/agent/chat": () => json(409, { detail: "a turn is already running" }) });
    await expect(sendMessage("hi")).resolves.toBe("refused");
  });

  it("a 5xx is REFUSED — the server ANSWERED, it just did not take it", async () => {
    routes({ "/api/agent/chat": () => json(503, {}), "/messages": () => json(200, []) });
    await expect(sendMessage("hi")).resolves.toBe("refused");
  });

  it("a native fetch failure is UNKNOWN — never re-sent, because it may have landed", async () => {
    globalThis.fetch = vi.fn(() => Promise.reject(new TypeError("Failed to fetch")));
    await expect(sendMessage("hi")).resolves.toBe("unknown");
  });

  it("nothing to send is REFUSED, not silently accepted", async () => {
    await expect(sendMessage("   ")).resolves.toBe("refused");
  });
});

describe("normalize-on-202 (§4.5 — the pre-existing defect, both modes)", () => {
  /** Suspend a turn on a confirm gate: chat status is `idle` while the turn still HOLDS the thread. */
  async function suspended() {
    routes({
      "/api/agent/chat": () =>
        closedStream([
          { event: "thread", data: { threadId: "t1" } },
          { event: "message.start", data: { messageId: "m1" } },
          {
            event: "part.added",
            data: {
              messageId: "m1",
              part: {
                type: "tool_call",
                call_id: "c1",
                tool: "wake_host",
                args: {},
                state: "pending",
              },
            },
          },
          { event: "tool.permission", data: { callId: "c1", token: "tok" } },
          { event: "done", data: { state: "suspended" } },
        ]),
    });
    const view = renderHook(() => useChat());
    await act(async () => {
      await sendMessage("wake vault");
    });
    expect(view.result.current.status).toBe("idle");
    return view;
  }

  it("TYPED text during `awaiting_confirm` leaves no orphan placeholder and no stuck status", async () => {
    const view = await suspended();
    const before = view.result.current.messages.length;
    routes({ "/api/agent/chat": () => json(202, { entry_id: "e1", turn_id: "t-held" }) });
    await act(async () => {
      await sendMessage("actually, do it");
    });

    // The ONE thing that should have been added is the user's own bubble, marked QUEUED.
    const msgs = view.result.current.messages;
    expect(msgs).toHaveLength(before + 1);
    expect(msgs[msgs.length - 1]).toMatchObject({ role: "user", queued: "e1" });
    // …and the view is not pretending a turn is streaming (which wedged the composer on Stop).
    expect(view.result.current.status).toBe("idle");
    expect(view.result.current.streamingId).toBeNull();
  });

  it("a CALL's fresh send heals the same way — one seam, both modes", async () => {
    await suspended();
    routes({ "/api/agent/chat": () => json(202, { entry_id: "e2", turn_id: "t-held" }) });
    const { result } = renderHook(() => useChat());
    await act(async () => {
      const outcome = await sendMessage("what about the other one");
      expect(outcome).toBe("accepted");
    });
    expect(result.current.status).toBe("idle");
    expect(
      result.current.messages.some((m) => m.role === "assistant" && m.parts.length === 0),
    ).toBe(false);
  });

  it("a STEER's 202 is untouched by the fix — it never had a placeholder to strand", async () => {
    const live = openStream([
      { event: "thread", data: { threadId: "t1" } },
      { event: "message.start", data: { messageId: "m1" }, id: "turn-3:1" },
    ]);
    let first = true;
    routes({
      "/api/agent/chat": () => {
        if (first) {
          first = false;
          return live.res;
        }
        return json(202, { entry_id: "e5", turn_id: "turn-3" });
      },
    });
    const { result } = renderHook(() => useChat());
    await act(async () => {
      void sendMessage("first");
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current.status).toBe("streaming");
    await act(async () => {
      await sendMessage("and this too");
    });
    // The live turn still owns the view: a steer must not settle it.
    expect(result.current.status).toBe("streaming");
    expect(result.current.messages.find((m) => m.queued === "e5")).toBeTruthy();
  });
});
