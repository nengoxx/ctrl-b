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

type Frame = { event: string; data: unknown; id?: string };
let calls: string[];
/** Frames the NEXT chat POST streams back; `null` = the POST hangs (the view stays "streaming"). */
let chatFrames: Frame[] | null;
/** A BUFFERED chat answer (`agent.streaming: off` — JSON, not SSE); wins over `chatFrames` when set. */
let chatJson: Record<string, unknown> | null;
/** Is a turn live on the server — what the probe (`GET /api/agent/turns/<id>`) answers. */
let turnActive: boolean;
/** Frames a re-attach's `…/stream` delivers — and then the stream stays OPEN (the turn still runs). */
let attachFrames: Frame[];
/** History reads parked until released, by thread id. */
let heldHistory: Map<string, () => void>;

const json = (v: unknown): Response =>
  ({ ok: true, status: 200, json: async () => v }) as unknown as Response;
const sse = (frames: Frame[], keepOpen = false): Response => {
  const text = frames
    .map(
      (f) =>
        `event: ${f.event}\r\n${f.id ? `id: ${f.id}\r\n` : ""}data: ${JSON.stringify(f.data)}\r\n\r\n`,
    )
    .join("");
  const bytes = new TextEncoder().encode(text);
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
    return Promise.resolve(sse(attachFrames, true));
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
    if (url.startsWith("/api/agent/turns/")) return json({ active: turnActive });
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
  attachFrames = [];
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
