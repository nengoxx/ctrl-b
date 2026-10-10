import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ChatMessage } from "../../src/types";

// Phase 27 S10 — THE `thread` FRAME's POLICY (`store/chat#applyThreadFrame`, D84 §5) and THE NAMES (R37),
// through the REAL store (+ `lib/composer`'s roster installer, `lib/notifyBus`) against a routed `fetch`,
// and — for B6 — the REAL notification engine (`useForegroundNotifications`) over a fake Notifications API.
// The LISTENER half (the two invalidations, first and unconditional) is `useEventStream.test.tsx`'s.
//
// Setup = the plan's: Lynette (the configured default, titled "Lynette") with L2 (newest) and L1; Emma
// with E1. The owner is IN E1 (they tapped Emma while L2's reply was streaming — B6).

const h = vi.hoisted(() => ({
  call: false,
  prefs: {
    enabled: true,
    events: { agent_input: true, turn_done: true, action_failed: true },
  },
}));
vi.mock("../../src/store/liveCall", () => ({ callLive: () => h.call }));
vi.mock("../../src/store/toast", () => ({ pushToast: () => undefined, useToasts: () => [] }));
vi.mock("../../src/hooks/useNotificationPrefs", () => ({
  useNotificationPrefs: () => ({ data: h.prefs }),
}));

const L2 = "a2".repeat(16);
const L1 = "a1".repeat(16);
const E1 = "e1".repeat(16);
/** A conversation the next THREAD-LESS send mints (S10-C01's tests). */
const L3 = "a3".repeat(16);

type Frame = { event: string; data: unknown; id?: string };
let calls: string[];
/** Frames the NEXT chat POST streams back; `null` = the POST hangs (the view stays "streaming"). */
let chatFrames: Frame[] | null;
/** A BUFFERED chat answer (`agent.streaming: off` — JSON, not SSE); wins over `chatFrames` when set. */
let chatJson: Record<string, unknown> | null;
/** Is a turn live on the server — what the probe (`GET /api/agent/turns/<id>`) answers. */
let turnActive: boolean;
/** The probe answer's `steer_queue` (the server's still-pending steers — `SteerQueueEntry`), when set. */
let probeQueue: { entry_id: string; kind: string; text: string }[] | null;
/** Frames a re-attach's `…/stream` delivers — and then the stream stays OPEN (the turn still runs). */
let attachFrames: Frame[];
/** History reads parked until released, by thread id. */
let heldHistory: Map<string, () => void>;
/** A CONTROLLED stream the next chat POST answers with (wins over `chatJson`/`chatFrames` when set). */
let chatStream: Response | null;
/** A CONTROLLED stream a re-attach's `…/stream` answers with (wins over `attachFrames` when set). */
let attachStream: Response | null;

const json = (v: unknown): Response =>
  ({ ok: true, status: 200, json: async () => v }) as unknown as Response;
const sseBytes = (frames: Frame[]): Uint8Array =>
  new TextEncoder().encode(
    frames
      .map(
        (f) =>
          `event: ${f.event}\r\n${f.id ? `id: ${f.id}\r\n` : ""}data: ${JSON.stringify(f.data)}\r\n\r\n`,
      )
      .join(""),
  );
/** An SSE answer the test drives frame by frame — `push` delivers, `close` ends the stream. */
function controlled() {
  let ctl!: ReadableStreamDefaultController<Uint8Array>;
  const res = {
    ok: true,
    status: 200,
    body: new ReadableStream<Uint8Array>({ start: (c) => void (ctl = c) }),
    headers: {
      get: (k: string) => (k.toLowerCase() === "content-type" ? "text/event-stream" : null),
    },
  } as unknown as Response;
  return {
    res,
    push: (frames: Frame[]) => ctl.enqueue(sseBytes(frames)),
    close: () => ctl.close(),
  };
}
const sse = (frames: Frame[], keepOpen = false): Response => {
  const bytes = sseBytes(frames);
  return {
    ok: true,
    status: 200,
    body: new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(bytes);
        if (!keepOpen) c.close();
      },
    }),
    headers: {
      get: (k: string) => (k.toLowerCase() === "content-type" ? "text/event-stream" : null),
    },
  } as unknown as Response;
};
const msg = (id: string, thread: string, role: "user" | "assistant"): ChatMessage => ({
  id,
  thread_id: thread,
  role,
  parts: [{ type: "text", text: id }],
  actor: role === "user" ? "user" : "agent",
  ts: "2026-01-01T00:00:00Z",
  tokens: null,
  compacted: false,
});

function route(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = String(input);
  const method = init?.method ?? "GET";
  calls.push(`${method} ${url}`);
  if (method === "POST" && url === "/api/agent/chat") {
    if (chatStream !== null) return Promise.resolve(chatStream);
    if (chatJson !== null)
      return Promise.resolve({
        ok: true,
        status: 200,
        body: {},
        headers: {
          get: (k: string) => (k.toLowerCase() === "content-type" ? "application/json" : null),
        },
        json: async () => chatJson,
      } as unknown as Response);
    if (chatFrames === null) return new Promise(() => undefined); // hangs: the turn streams on
    return Promise.resolve(sse(chatFrames));
  }
  if (url.startsWith("/api/agent/turns/") && url.includes("/stream"))
    return Promise.resolve(attachStream ?? sse(attachFrames, true));
  const history = (id: string) =>
    json([msg(`${id}-u`, id, "user"), msg(`${id}-a`, id, "assistant")]);
  if (url.startsWith("/api/threads/") && url.endsWith("/messages")) {
    const id = url.split("/")[3];
    if (heldHistory.has(id) || holdNext.delete(id))
      return new Promise((resolve) => heldHistory.set(id, () => resolve(history(id))));
  }
  return Promise.resolve().then(() => {
    if (url.startsWith("/api/threads/") && url.endsWith("/messages"))
      return history(url.split("/")[3]);
    if (url.startsWith("/api/agent/turns/"))
      return json(
        probeQueue ? { active: turnActive, steer_queue: probeQueue } : { active: turnActive },
      );
    return json({});
  });
}
/** Thread ids whose NEXT history read parks (`heldHistory`) until released. */
const holdNext = new Set<string>();

async function fresh() {
  vi.resetModules();
  const chat = await import("../../src/store/chat");
  const composer = await import("../../src/lib/composer");
  const bus = await import("../../src/lib/notifyBus");
  const view = renderHook(() => chat.useChat());
  const signals: import("../../src/lib/notifyBus").NotifySignal[] = [];
  const unsub = bus.onNotify((s) => signals.push(s));
  act(() =>
    composer.installAgents(
      {
        agents: ["lynette", "emma"],
        default: "lynette",
        summaries: { lynette: { title: "Lynette" }, emma: { title: "Emma" } },
      },
      composer.beginAgentsLoad(),
    ),
  );
  /** The owner opens E1 (Emma's conversation) — the view every frame below is judged against. */
  await act(async () => {
    await chat.openThread(E1, "emma");
  });
  calls = [];
  const frame = (over: Partial<import("../../src/store/chat").ThreadFrame> = {}) =>
    act(() =>
      chat.applyThreadFrame({
        threadId: L2,
        state: "completed",
        turnId: "t9",
        agent: "lynette",
        chained: false,
        ...over,
      }),
    );
  const probes = () =>
    calls.filter((c) => c.startsWith("GET /api/agent/turns/") && !c.includes("/stream"));
  return { chat, view, signals, unsub, frame, probes, state: () => view.result.current };
}

let teardown: (() => void)[] = [];
beforeEach(() => {
  localStorage.clear();
  h.call = false;
  calls = [];
  chatFrames = null;
  chatJson = null;
  turnActive = false;
  probeQueue = null;
  attachFrames = [];
  chatStream = null;
  attachStream = null;
  heldHistory = new Map();
  holdNext.clear();
  vi.stubGlobal("fetch", vi.fn(route));
});
afterEach(() => {
  for (const t of teardown) t();
  teardown = [];
  cleanup();
  vi.unstubAllGlobals();
});
async function setup() {
  const f = await fresh();
  teardown.push(f.unsub);
  return f;
}

describe("applyThreadFrame — a BACKGROUND conversation's terminal (§5)", () => {
  it("`completed` of a conversation that is NOT the open view → ONE turn-done signal, named for its HOME, carrying the tap", async () => {
    const f = await setup();
    f.frame();
    expect(f.signals).toEqual([
      {
        cls: "turn_done",
        key: `turn-done:${L2}:t9`,
        title: "Lynette finished",
        body: "your reply is ready in the chat",
        focus: "agent",
        thread: L2,
        home: "lynette",
      },
    ]);
  });

  it("⑨ a background terminal runs NO memory-pressure check — the hint would land in the OPEN view (Q8)", async () => {
    const f = await setup();
    f.frame();
    f.frame({ state: "error", turnId: "t2" });
    await act(async () => {});
    expect(f.signals.map((s) => s.key)).toEqual([`turn-done:${L2}:t9`, `turn-error:${L2}:t2`]);
    expect(calls.filter((c) => c.includes("/api/memory/core/status"))).toEqual([]);
  });

  it('`capped` → "<Name> hit the step limit"; `error` → "<Name> stopped" under the error key — bodies unchanged', async () => {
    const f = await setup();
    f.frame({ state: "capped", turnId: "t1" });
    f.frame({ state: "error", turnId: "t2" });
    expect(f.signals.map((s) => [s.key, s.title, s.body])).toEqual([
      [`turn-done:${L2}:t1`, "Lynette hit the step limit", "send a message to continue"],
      [`turn-error:${L2}:t2`, "Lynette stopped", "the turn ended with an error"],
    ]);
  });

  it("a `chained: true` completion does NOT notify (the steer turn's own frames follow)", async () => {
    const f = await setup();
    f.frame({ chained: true });
    f.frame({ state: "suspended", chained: true });
    expect(f.signals).toEqual([]);
  });

  it("`suspended` → the `agent_input` signal keyed `agent-input:<thread>:<turn>`, named for the home", async () => {
    const f = await setup();
    f.frame({ state: "suspended" });
    expect(f.signals).toEqual([
      {
        cls: "agent_input",
        key: `agent-input:${L2}:t9`,
        title: "Lynette needs you",
        body: "open the conversation to continue",
        focus: "agent",
        thread: L2,
        home: "lynette",
      },
    ]);
  });

  it("`cancelled` / `seen` → no signal (their effect is the invalidation)", async () => {
    const f = await setup();
    f.frame({ state: "cancelled" });
    f.frame({ state: "seen", turnId: null });
    f.frame({ state: "something-new" }); // a state this build does not know — nothing
    expect(f.signals).toEqual([]);
    expect(f.probes()).toEqual([]);
  });

  it("NO DUPLICATE when the finishing conversation IS the open view: its stream announced it, the frame adds nothing", async () => {
    const f = await setup();
    chatFrames = [
      { event: "thread", data: { threadId: E1, agent: "emma" } },
      { event: "message.start", data: { messageId: "m1" }, id: "tE:1" },
      { event: "done", data: { state: "completed" }, id: "tE:2" },
    ];
    await act(async () => {
      await f.chat.sendMessage("hello");
    });
    f.frame({ threadId: E1, turnId: "tE", agent: "emma" });
    expect(f.signals.map((s) => [s.key, s.title])).toEqual([
      [`turn-done:${E1}:tE`, "Emma finished"], // the stream's — the frame's would have been this very key
    ]);
  });
});

describe("R37 — every agent-class title names the HOME (bodies unchanged)", () => {
  it("the open view's own stream: approval + question name ITS home (`threadAgent`)", async () => {
    const f = await setup();
    chatFrames = [
      { event: "thread", data: { threadId: E1, agent: "emma" } },
      { event: "message.start", data: { messageId: "m1" } },
      {
        event: "part.added",
        data: { messageId: "m1", part: { type: "tool_call", callId: "c1", name: "x", args: {} } },
      },
      {
        event: "tool.permission",
        data: { callId: "c1", tool: "shutdown_host", prompt: "confirm it", token: "k" },
      },
      {
        event: "part.added",
        data: { messageId: "m1", part: { type: "tool_call", callId: "q1", name: "question" } },
      },
      { event: "tool.question", data: { callId: "q1", question: "which host?" } },
      { event: "done", data: { state: "suspended" } },
    ];
    await act(async () => {
      await f.chat.sendMessage("go");
    });
    expect(f.signals.map((s) => [s.key, s.title, s.body, s.thread, s.home])).toEqual([
      [`perm:${E1}:c1`, "Emma needs approval", "confirm it", E1, "emma"],
      [`ask:${E1}:q1`, "Emma has a question", "which host?", E1, "emma"],
    ]);
  });

  it("a VANISHED home (off the landed roster) → the configured default's name — the ONE fallback; so does an unknown one", async () => {
    const f = await setup();
    f.frame({ agent: "ghost", turnId: "a" });
    f.frame({ agent: null, turnId: "b" });
    expect(f.signals.map((s) => s.title)).toEqual(["Lynette finished", "Lynette finished"]);
    // …while the tap still hands the frame's own home (the M7 sweep moves a view whose home left).
    expect(f.signals.map((s) => s.home)).toEqual(["ghost", undefined]);
  });
});

describe("M11 — a `running` frame for the OPEN view from the OTHER device", () => {
  it("this view NOT streaming, the page VISIBLE → probe + RE-ATTACH: the other device's reply streams into the open view", async () => {
    const f = await setup();
    turnActive = true; // the desktop's turn is live on the server
    attachFrames = [
      { event: "message.start", data: { messageId: "m-desk" }, id: "tD:1" },
      { event: "text.delta", data: { messageId: "m-desk", delta: "from the desktop" }, id: "tD:2" },
    ]; // …and the stream stays open: the turn is still running
    f.frame({ threadId: E1, state: "running", agent: "emma" });
    await vi.waitFor(() =>
      expect(f.state().messages.at(-1)?.parts).toEqual([
        { type: "text", text: "from the desktop" },
      ]),
    );
    expect(f.probes()).toEqual([`GET /api/agent/turns/${E1}`]);
    expect(calls.some((c) => c.startsWith(`GET /api/agent/turns/${E1}/stream`))).toBe(true);
    expect(f.state().threadId).toBe(E1);
  });

  it("…the same frame while the page is HIDDEN → nothing (S10 fix ⑥ — the bridge probes on return)", async () => {
    const f = await setup();
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    teardown.push(() =>
      Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true }),
    );
    f.frame({ threadId: E1, state: "running", agent: "emma" });
    await act(async () => {});
    expect(f.probes()).toEqual([]);
  });

  it("…the same frame while THIS view streams → nothing (it is this device's own turn)", async () => {
    const f = await setup();
    chatFrames = null; // the POST hangs — the view is streaming
    void f.chat.sendMessage("hello");
    await act(async () => {});
    expect(f.chat.getChatStatus()).toBe("streaming");
    f.frame({ threadId: E1, state: "running", agent: "emma" });
    await act(async () => {});
    expect(f.probes()).toEqual([]);
  });

  it("a `running` frame for ANOTHER conversation → nothing (the dots carry it)", async () => {
    const f = await setup();
    f.frame({ state: "running" });
    await act(async () => {});
    expect(f.probes()).toEqual([]);
    expect(f.signals).toEqual([]);
  });
});

// ── B6 end to end: the frame → the engine's gate → the OS notification → its tap ────────────────────

interface FakeNotification {
  title: string;
  options: NotificationOptions;
  onclick: (() => void) | null;
}
let shown: FakeNotification[];
function installNotificationApi() {
  shown = [];
  class Fake {
    onclick: (() => void) | null = null;
    close = vi.fn();
    constructor(
      public title: string,
      public options: NotificationOptions = {},
    ) {
      shown.push(this);
    }
    static permission: NotificationPermission = "granted";
    static requestPermission = vi.fn(() => Promise.resolve("granted"));
  }
  Object.defineProperty(window, "Notification", {
    value: Fake,
    configurable: true,
    writable: true,
  });
  teardown.push(() => delete (window as unknown as Record<string, unknown>).Notification);
}
const setVisibility = (v: DocumentVisibilityState) =>
  Object.defineProperty(document, "visibilityState", { value: v, configurable: true });

describe("B6 — leave mid-reply, then the reply lands", () => {
  it("page VISIBLE (the owner is in E1): the signal is published, the gate drops it — the dots only", async () => {
    installNotificationApi();
    setVisibility("visible");
    const f = await setup();
    const engine = await import("../../src/hooks/useForegroundNotifications");
    renderHook(() => engine.useForegroundNotifications());
    f.frame();
    expect(f.signals).toHaveLength(1); // published…
    expect(shown).toEqual([]); // …and dropped by the gate (R39)
  });

  it("page HIDDEN: ONE notification named for the HOME, body unchanged, `data.thread` + `data.home` set — its tap opens L2 SPECIFICALLY", async () => {
    installNotificationApi();
    setVisibility("hidden");
    teardown.push(() => setVisibility("visible"));
    vi.spyOn(window, "focus").mockImplementation(() => undefined);
    const f = await setup();
    const ui = await import("../../src/store/ui");
    ui.setUI({ tab: "fleet" });
    const engine = await import("../../src/hooks/useForegroundNotifications");
    renderHook(() => engine.useForegroundNotifications());
    act(() => f.chat.setResponder("lynette")); // a responder in E1 — the device then LEAVES E1
    f.frame();
    f.frame(); // a re-delivered frame — the engine's seen-set keeps it to one
    expect(shown).toHaveLength(1);
    expect(shown[0].title).toBe("Lynette finished");
    expect(shown[0].options.body).toBe("your reply is ready in the chat");
    expect(shown[0].options.data).toMatchObject({ focus: "agent", thread: L2, home: "lynette" });
    await act(async () => {
      shown[0].onclick?.();
    });
    expect(ui.getUI().tab).toBe("agent");
    // L2 specifically, Lynette talking (its home, no responder — the device left E1).
    expect(f.state()).toMatchObject({ threadId: L2, threadAgent: "lynette", responder: null });
  });

  it("…and the tap on the conversation ALREADY open keeps the responder (the same-id branch — R45)", async () => {
    installNotificationApi();
    const f = await setup();
    act(() => f.chat.setResponder("lynette"));
    const engine = await import("../../src/hooks/useForegroundNotifications");
    await act(async () => {
      engine.applyNotificationFocus("agent", E1, "emma");
    });
    expect(f.state()).toMatchObject({ threadId: E1, responder: "lynette" });
  });

  it("a tap during a live call only switches the tab — the view stays (R20)", async () => {
    installNotificationApi();
    const f = await setup();
    h.call = true;
    const engine = await import("../../src/hooks/useForegroundNotifications");
    await act(async () => {
      engine.applyNotificationFocus("agent", L1, "lynette");
    });
    expect(f.state().threadId).toBe(E1);
  });
});

// ── S10 fix ① + ⑦ — the BUFFERED transport (`agent.streaming: off`) never double-announces ────────────

describe("the buffered transport and the frame — ONE key per occurrence", () => {
  it("① the owner LEFT before the buffered floor resolved: the frame's terminal and the buffered one share `turn-done:<thread>:<turn>`", async () => {
    const f = await setup();
    await act(async () => {
      await f.chat.openThread(L2, "lynette");
    });
    chatJson = { threadId: L2, agent: "lynette", title: null, state: "completed", turn_id: "t9" };
    holdNext.add(L2); // the buffered branch's floor reload parks
    let sent!: Promise<unknown>;
    act(() => {
      sent = f.chat.sendMessage("hello");
    });
    await vi.waitFor(() => expect(heldHistory.has(L2)).toBe(true));
    await act(async () => {
      await f.chat.openThread(E1, "emma"); // the owner taps Emma meanwhile
    });
    f.frame(); // L2's terminal frame lands — L2 is not the open view now
    await act(async () => {
      heldHistory.get(L2)?.();
      await sent;
    });
    const done = f.signals.filter((s) => s.cls === "turn_done");
    expect(done.length).toBe(2); // both transports announce it…
    expect(new Set(done.map((s) => s.key))).toEqual(new Set([`turn-done:${L2}:t9`])); // …under ONE key
  });

  it("⑦ the lazy-mint window: a frame landing BEFORE the buffered answer adopts the thread is the view's own — one key per terminal, one per parked confirm", async () => {
    const f = await setup();
    act(() => f.chat.resetToThreadless());
    let answer!: (r: Response) => void;
    vi.mocked(fetch).mockImplementationOnce(
      () => new Promise<Response>((resolve) => (answer = resolve)),
    );
    let sent!: Promise<unknown>;
    act(() => {
      sent = f.chat.sendMessage("hello"); // thread-less → the server mints L2
    });
    expect(f.chat.getChatStatus()).toBe("streaming");
    f.frame({ state: "suspended" }); // the parked turn's frame races the JSON answer
    f.frame({ state: "completed", turnId: "t8" }); // (a terminal the same way)
    expect(f.signals).toEqual([]);
    await act(async () => {
      answer({
        ok: true,
        status: 200,
        body: {},
        headers: { get: () => "application/json" },
        json: async () => ({
          threadId: L2,
          agent: "lynette",
          title: null,
          state: "suspended",
          turn_id: "t9",
          permission: { callId: "c1", token: "k", prompt: "confirm it", tool: "x" },
        }),
      } as unknown as Response);
      await sent;
    });
    expect(f.signals.map((s) => s.key)).toEqual([`perm:${L2}:c1`]); // the buffered branch's, alone
  });
});

// ── S10-C01 — THE LAZY-MINT HOLD: frames of a thread-less STREAMING window are held, then replayed ──────

/** The needs-you signal an E1 `suspended` frame (turn `tE5`) owes — Sol's reproduction's expectation. */
const EMMA_NEEDS_YOU = {
  cls: "agent_input",
  key: `agent-input:${E1}:tE5`,
  title: "Emma needs you",
  body: "open the conversation to continue",
  focus: "agent",
  thread: E1,
  home: "emma",
};

describe("S10-C01 — the hold-and-replay of `thread` frames during a thread-less streaming send", () => {
  /** The view thread-less, then the owner's send — its POST answered by `answer` (or left hanging). */
  async function threadlessSend(f: Awaited<ReturnType<typeof setup>>) {
    act(() => f.chat.resetToThreadless());
    let sent!: Promise<unknown>;
    act(() => {
      sent = f.chat.sendMessage("hello"); // thread-less → the server mints L3
    });
    await act(async () => {});
    expect(f.chat.getChatStatus()).toBe("streaming");
    expect(f.state().threadId).toBeNull();
    return { sent }; // boxed — an async function returning the promise itself would await it
  }

  it('Sol\'s reproduction: an E1 `suspended` during an L mint is HELD, then "Emma needs you" publishes ONCE at adoption', async () => {
    const f = await setup();
    const live = controlled();
    chatStream = live.res;
    await threadlessSend(f);
    f.frame({ threadId: E1, state: "suspended", turnId: "tE5", agent: "emma" });
    expect(f.signals).toEqual([]); // held — not judged, not lost
    await act(async () => {
      live.push([{ event: "thread", data: { threadId: L3, agent: "lynette" } }]);
    });
    await vi.waitFor(() => expect(f.state().threadId).toBe(L3));
    expect(f.signals).toEqual([EMMA_NEEDS_YOU]);
  });

  it("the ADOPTED id's own frames drop at replay with no filter: L's `running` + `completed` → no turn-done for L, no probe; the stream's own terminal is the one signal", async () => {
    const f = await setup();
    const live = controlled();
    chatStream = live.res;
    await threadlessSend(f);
    f.frame({ threadId: L3, state: "running", turnId: "tL", agent: "lynette" });
    f.frame({ threadId: L3, state: "completed", turnId: "tL", agent: "lynette" });
    f.frame({ threadId: E1, state: "suspended", turnId: "tE5", agent: "emma" });
    await act(async () => {
      live.push([{ event: "thread", data: { threadId: L3, agent: "lynette" } }]);
    });
    await vi.waitFor(() => expect(f.state().threadId).toBe(L3));
    expect(f.signals).toEqual([EMMA_NEEDS_YOU]); // L's frames: the open view's — nothing
    expect(f.probes()).toEqual([]); // L's `running` found the view streaming
    await act(async () => {
      live.push([
        { event: "message.start", data: { messageId: "mL" }, id: "tL:1" },
        { event: "done", data: { state: "completed" }, id: "tL:2" },
      ]);
      live.close();
    });
    await vi.waitFor(() => expect(f.chat.getChatStatus()).toBe("idle"));
    const done = f.signals.filter((s) => s.cls === "turn_done");
    expect(done.map((s) => [s.key, s.title])).toEqual([
      [`turn-done:${L3}:tL`, "Lynette finished"], // the stream's — once
    ]);
  });

  it('the BUFFERED variant: the E1 `suspended` is held through the whole first turn, published once the JSON adopts; L\'s own `completed` (frame AND answer) → ONE "Lynette finished"', async () => {
    const f = await setup();
    let answer!: (r: Response) => void;
    vi.mocked(fetch).mockImplementationOnce(
      () => new Promise<Response>((resolve) => (answer = resolve)),
    );
    const { sent } = await threadlessSend(f);
    f.frame({ threadId: E1, state: "suspended", turnId: "tE5", agent: "emma" });
    f.frame({ threadId: L3, state: "completed", turnId: "t9", agent: "lynette" });
    expect(f.signals).toEqual([]);
    await act(async () => {
      answer({
        ok: true,
        status: 200,
        body: {},
        headers: { get: () => "application/json" },
        json: async () => ({
          threadId: L3,
          agent: "lynette",
          title: null,
          state: "completed",
          turn_id: "t9",
        }),
      } as unknown as Response);
      await sent;
    });
    expect(f.state().threadId).toBe(L3);
    expect(f.signals.map((s) => [s.key, s.title])).toEqual([
      [`agent-input:${E1}:tE5`, "Emma needs you"], // replayed at the mint (adopt runs before the idle write)
      [`turn-done:${L3}:t9`, "Lynette finished"], // the buffered branch's, alone
    ]);
  });

  it("the FAILURE variant: the POST rejects before any id → the held E1 frame replays as a background frame → the signal publishes", async () => {
    const f = await setup();
    let fail!: (e: Error) => void;
    vi.mocked(fetch).mockImplementationOnce(
      () => new Promise<Response>((_, reject) => (fail = reject)),
    );
    const { sent } = await threadlessSend(f);
    f.frame({ threadId: E1, state: "suspended", turnId: "tE5", agent: "emma" });
    expect(f.signals).toEqual([]);
    await act(async () => {
      fail(new TypeError("network down"));
      await sent;
    });
    expect(f.state().threadId).toBeNull();
    expect(f.chat.getChatStatus()).not.toBe("streaming");
    expect(f.signals).toEqual([EMMA_NEEDS_YOU]);
  });

  it("the NAVIGATION variant: opening another conversation inside the window replays against the NEW view", async () => {
    const f = await setup();
    chatFrames = null; // the POST hangs — the window stays open
    await threadlessSend(f);
    f.frame({ threadId: L1, state: "completed", turnId: "t1", agent: "lynette" }); // the view-to-be's
    f.frame({ threadId: E1, state: "suspended", turnId: "tE5", agent: "emma" });
    expect(f.signals).toEqual([]);
    await act(async () => {
      await f.chat.openThread(L1, "lynette");
    });
    expect(f.state().threadId).toBe(L1);
    expect(f.signals).toEqual([EMMA_NEEDS_YOU]); // L1 is open now — its terminal is the view's, nothing
  });

  it("no hold OUTSIDE the window: a thread-less IDLE view acts at once", async () => {
    const f = await setup();
    act(() => f.chat.resetToThreadless());
    expect(f.chat.getChatStatus()).toBe("idle");
    f.frame({ threadId: E1, state: "suspended", turnId: "tE5", agent: "emma" });
    expect(f.signals).toEqual([EMMA_NEEDS_YOU]);
  });

  it("no hold OUTSIDE the window: a view WITH a thread that streams judges an unrelated frame at once (the plain `open` rule)", async () => {
    const f = await setup(); // the view is E1
    chatFrames = null;
    void f.chat.sendMessage("hello");
    await act(async () => {});
    expect(f.chat.getChatStatus()).toBe("streaming");
    f.frame({ state: "suspended" }); // L2 — not the open view
    f.frame({ threadId: E1, state: "completed", turnId: "tE" }); // E1 — the open view: nothing
    expect(f.signals.map((s) => [s.key, s.title])).toEqual([
      [`agent-input:${L2}:t9`, "Lynette needs you"],
    ]);
  });
});

// ── the owner's ruling 2026-10-10 — a VISIBLE M11 attach is a FOREIGN turn: silent for auto-TTS ─────────

describe("`foreignTurn` — set ONLY by the visible M11 attach", () => {
  /** M11: the desktop's turn on E1 attaches here (a `turn.sync` → live), then ends. */
  async function foreignAttach(f: Awaited<ReturnType<typeof setup>>) {
    turnActive = true;
    const live = controlled();
    attachStream = live.res;
    f.frame({ threadId: E1, state: "running", agent: "emma" });
    await act(async () => {
      live.push([
        {
          event: "turn.sync",
          data: { message: { id: "m-desk", text: "from the desktop" }, calls: [], seq: 1 },
          id: "tD:1",
        },
      ]);
    });
    await vi.waitFor(() => expect(f.chat.getChatStatus()).toBe("streaming"));
    expect(f.probes()).toEqual([`GET /api/agent/turns/${E1}`]);
    expect(f.state().foreignTurn).toBe(true);
    await act(async () => {
      live.push([{ event: "done", data: { state: "completed" }, id: "tD:2" }]);
      live.close();
    });
    await vi.waitFor(() => expect(f.chat.getChatStatus()).toBe("idle"));
    attachStream = null;
  }

  it("the M11 attach leaves `foreignTurn === true`; the owner's next OWN send flips it to false at the streaming edge", async () => {
    const f = await setup();
    expect(f.state().foreignTurn).toBe(false);
    await foreignAttach(f);
    chatFrames = null; // the owner's own turn streams on
    void f.chat.sendMessage("my turn");
    await act(async () => {});
    expect(f.chat.getChatStatus()).toBe("streaming");
    expect(f.state().foreignTurn).toBe(false);
  });

  it("Opus F1 — the owner's OWN drain-B steer turn stays LOUD: its `running` frame lands inside the settle's floor read, on an idle + visible view holding a QUEUED steer → the attach lands with `foreignTurn === false`", async () => {
    const f = await setup();
    await act(async () => {
      await f.chat.openThread(L2, "lynette");
    });
    const own = controlled();
    chatStream = own.res; // the owner's own turn on L2
    void f.chat.sendMessage("first");
    await act(async () => {
      own.push([{ event: "message.start", data: { messageId: "mO" }, id: "tO:1" }]);
    });
    expect(f.chat.getChatStatus()).toBe("streaming");
    chatStream = null;
    vi.mocked(fetch).mockImplementationOnce(() =>
      Promise.resolve({
        ok: true,
        status: 202,
        headers: { get: () => "application/json" },
        json: async () => ({ entry_id: "q1", turn_id: "tO" }),
      } as unknown as Response),
    );
    await act(async () => {
      await f.chat.sendMessage("and also this"); // a STEER — enqueued (202), a queued bubble
    });
    expect(f.state().messages.some((m) => m.queued === "q1")).toBe(true);
    holdNext.add(L2); // the settle's `reloadFloor` parks — the drain-B frame lands inside it
    await act(async () => {
      own.push([{ event: "done", data: { state: "completed" }, id: "tO:2" }]);
      own.close();
    });
    await vi.waitFor(() => expect(heldHistory.has(L2)).toBe(true));
    expect(f.chat.getChatStatus()).toBe("idle");
    turnActive = true; // the drain-B steer turn is live
    const drainB = controlled();
    attachStream = drainB.res;
    f.frame({ threadId: L2, state: "running", turnId: "tB", agent: "lynette" }); // → the M11 branch
    await vi.waitFor(() =>
      expect(calls.some((c) => c.startsWith(`GET /api/agent/turns/${L2}/stream`))).toBe(true),
    );
    // The attach's own forced reload answers at once (the NEXT fetch); the settle's floor stays parked,
    // so the attach goes live INSIDE the owner's settle — the window F1 names.
    vi.mocked(fetch).mockImplementationOnce(() =>
      Promise.resolve(json([msg(`${L2}-u`, L2, "user"), msg(`${L2}-a`, L2, "assistant")])),
    );
    await act(async () => {
      drainB.push([
        {
          event: "turn.sync",
          data: { message: { id: "mB", text: "the steered reply" }, calls: [], seq: 1 },
          id: "tB:1",
        },
      ]);
    });
    await vi.waitFor(() => expect(f.chat.getChatStatus()).toBe("streaming"));
    expect(f.state().streamingId).toBe("mB");
    expect(f.state().foreignTurn).toBe(false); // the owner's own steered reply speaks
    await act(async () => heldHistory.get(L2)?.()); // the parked floor lands on a live view: discarded
    expect(f.state().foreignTurn).toBe(false);
  });

  it("the plain M11 case whose probe carries the OTHER device's `steer_queue` stays FOREIGN: the reconcile renders its queued bubbles here DURING the probe, after the `queued` read", async () => {
    const f = await setup();
    await act(async () => {
      await f.chat.openThread(L2, "lynette");
    });
    expect(f.state().messages.some((m) => m.queued)).toBe(false); // nothing queued on this device
    turnActive = true; // the desktop's turn is live…
    probeQueue = [{ entry_id: "qD", kind: "message", text: "the desktop's steer" }]; // …with its steer
    const live = controlled();
    attachStream = live.res;
    calls = [];
    f.frame({ threadId: L2, state: "running", turnId: "tD", agent: "lynette" });
    await vi.waitFor(() =>
      expect(calls.some((c) => c.startsWith(`GET /api/agent/turns/${L2}/stream`))).toBe(true),
    );
    expect(f.state().messages.some((m) => m.queued === "qD")).toBe(true); // rendered by the reconcile
    await act(async () => {
      live.push([
        {
          event: "turn.sync",
          data: {
            message: { id: "m-desk", text: "from the desktop" },
            calls: [],
            seq: 1,
            steer_queue: probeQueue,
          },
          id: "tD:1",
        },
      ]);
    });
    await vi.waitFor(() => expect(f.chat.getChatStatus()).toBe("streaming"));
    expect(f.state().foreignTurn).toBe(true); // the other device's turn — silent here
  });

  it("a cold-load / reconnect re-attach (`reconcileChat`) stays LOUD — `foreignTurn` false", async () => {
    const f = await setup();
    await foreignAttach(f); // the flag is up from the last (foreign) turn…
    turnActive = true;
    attachFrames = [
      {
        event: "turn.sync",
        data: { message: { id: "m-own", text: "my own turn" }, calls: [], seq: 1 },
        id: "tO:1",
      },
    ];
    await act(async () => {
      await f.chat.reconcileChat();
    });
    await vi.waitFor(() => expect(f.chat.getChatStatus()).toBe("streaming"));
    expect(f.state().foreignTurn).toBe(false); // …and the owner's own re-attached turn is loud again
  });
});
