import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ChatMessage } from "../../src/types";

// Phase 27 S7a — THE RESPONDER MODEL, THE OVERRIDES, THE NAVIGATION KERNEL (CONVERSATIONS_PLAN §2, §6;
// D84). Through the real `store/chat` (+ `lib/composer`'s one roster installer and `lib/roster`) against a
// routed `fetch`:
//   · the RESPONDER (`/agent <name>`, R45): §2's notes, its lifetime (leaving clears it, the same
//     conversation keeps it), the normalisation (§12.2 a), the roster judgement (H1, M3, §12.1 ③);
//   · the OVERRIDES per HOME agent (R40, ON4): what every send and carry sends, persisted per device;
//   · the ROSTER DOOR (`openAgentConversation`): B3/B4/B5, Q2, L8; `/new` = the home (R22b);
//   · `ctrlb.chat` = `{thread, home, responder, overrides}`: the one load-boundary fold + the one boot
//     rule (N1, H7);
//   · the live-call refusals (R20); the roster sweep (N2 + M7); THE INVARIANT (R22).
// Setup is the plan's: Lynette (the configured default) and Emma; Lynette's L2 is her newest, L1 older;
// Emma's newest is E1.

const h = vi.hoisted(() => ({
  /** Is a call up (`store/liveCall#callLive`)? */
  call: false,
  /** Every toast pushed — the unknown-name answer (§12.1 ③) and the boot's "deleted" (H7). */
  toasts: [] as string[],
}));
vi.mock("../../src/store/liveCall", () => ({ callLive: () => h.call }));
vi.mock("../../src/store/toast", () => ({
  pushToast: (text: string) => h.toasts.push(text),
  useToasts: () => [],
}));

type ThreadRow = { id: string; agent: string | null; archived?: boolean };

/** What the boot list (`GET /api/threads?include_archived=true`) answers. */
let threadList: ThreadRow[];
/** Each agent's conversations, newest first — what the roster door's `?agent=` read answers. */
let byAgent: Record<string, string[]>;
/** What the chat POST's `thread` frame names as the home of a LAZY mint (seam ② pins the default). */
let lazyHome: string;
/** Every request, `<METHOD> <url>`. */
let calls: string[];
/** Every POST body, by URL. */
let bodies: { url: string; body: Record<string, unknown> }[];
/** Keys whose requests are parked until released. */
let held: Map<string, (() => void)[]>;
let holdKeys: Set<string>;
/** How `POST /api/exec` answers: `null` → a 200 that RAN it in the sent thread (or a fresh mint, homed on
 *  `lazyHome`); `"queued"` → a 202 exec steer; an object → a 200 naming that thread + home. */
let execAnswer: null | "queued" | "busy" | "down" | { threadId: string; agent: string | null };

const assistant = (id: string, thread: string, extra: Partial<ChatMessage> = {}): ChatMessage => ({
  id,
  thread_id: thread,
  role: "assistant",
  parts: [{ type: "text", text: `${id} says hi` }],
  actor: "agent",
  ts: "2026-01-01T00:00:00Z",
  tokens: null,
  compacted: false,
  ...extra,
});
const owner = (id: string, thread: string): ChatMessage => ({
  ...assistant(id, thread),
  role: "user",
  actor: "user",
});
/** Every conversation the owner has TALKED in (so `/new` has a reason to leave it), the tail reply a
 *  regenerate host. */
const history = (thread: string): ChatMessage[] => [
  owner(`${thread}-u`, thread),
  assistant(`${thread}-a`, thread, { reply: { ids: [`${thread}-a`], n: 1, count: 1 } }),
];

const json = (v: unknown): Response =>
  ({ ok: true, status: 200, json: async () => v }) as unknown as Response;
const sse = (frames: { event: string; data: unknown }[]): Response => {
  const text = frames
    .map((f) => `event: ${f.event}\r\ndata: ${JSON.stringify(f.data)}\r\n\r\n`)
    .join("");
  const bytes = new TextEncoder().encode(text);
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
};

function route(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = String(input);
  const method = init?.method ?? "GET";
  const key = method === "GET" ? url : `${method} ${url}`;
  calls.push(key);
  const answer = (): Response => {
    if (method === "POST") {
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
      bodies.push({ url, body });
      if (url === "/api/threads") {
        const agent = String(body.agent);
        return json({ id: `new-${agent}`, title: null, agent, archived: false });
      }
      if (url.endsWith("/cancel"))
        // a Stop's harvest: the queue holds e1, whose stored text is NOT the raw line
        return json({
          cancelled: true,
          active: false,
          steer_queue: [{ entry_id: "e1", kind: "exec", text: "OTHER" }],
        });
      if (url === "/api/exec") {
        if (execAnswer === "busy")
          return {
            ok: false,
            status: 409,
            json: async () => ({ detail: "a turn is already running on this thread" }),
          } as unknown as Response;
        if (execAnswer === "down") throw new Error("backend down");
        if (execAnswer === "queued")
          return {
            ok: true,
            status: 202,
            json: async () => ({ entry_id: "e1", turn_id: "t" }),
          } as unknown as Response;
        const ran = execAnswer ?? {
          threadId: (body.thread_id as string | null) ?? "x-new",
          agent: (body.thread_id as string | null) ? null : lazyHome,
        };
        return json({ ...ran, callId: "c", state: "ok" });
      }
      if (url.startsWith("/api/agent/")) {
        const thread = (body.thread_id as string | null) ?? "lazy";
        return sse([
          { event: "thread", data: { threadId: thread, agent: lazyHome } },
          { event: "message.start", data: { messageId: `r-${calls.length}` } },
          { event: "done", data: { state: "completed" } },
        ]);
      }
      return json({});
    }
    if (url === "/api/threads?include_archived=true") return json(threadList);
    if (url.startsWith("/api/threads?agent=")) {
      const agent = decodeURIComponent(url.slice("/api/threads?agent=".length).split("&")[0]);
      return json((byAgent[agent] ?? []).slice(0, 1).map((id) => ({ id, agent })));
    }
    if (url.startsWith("/api/threads/") && url.endsWith("/messages"))
      return json(history(url.split("/")[3]));
    if (url.includes("/api/agent/turns/")) return json({ active: false });
    return { ok: false, status: 404, json: async () => ({}) } as unknown as Response;
  };
  if (holdKeys.has(key))
    return new Promise((resolve, reject) => {
      (held.get(key) ?? held.set(key, []).get(key)!).push(() => {
        try {
          resolve(answer());
        } catch (e) {
          reject(e instanceof Error ? e : new Error(String(e))); // a transport failure (`execAnswer = "down"`) rejects, as fetch does
        }
      });
    });
  return Promise.resolve().then(answer);
}
const hold = (key: string) => holdKeys.add(key);
const release = (key: string) => {
  holdKeys.delete(key);
  for (const r of held.get(key) ?? []) r();
  held.delete(key);
};

/** A FRESH copy of the store (and routing's roster) per test — the app's cross-generation state is
 *  module-level by design; re-importing is the only honest reset, and it is also what a RELOAD is. */
async function fresh() {
  vi.resetModules();
  const chat = await import("../../src/store/chat");
  const composer = await import("../../src/lib/composer");
  const view = renderHook(() => chat.useChat());
  /** Land a roster through the ONE installer (which runs the sweep). Titles: "Lynette", "Emma". */
  const land = (agents: string[], dflt = "lynette") =>
    act(() =>
      composer.installAgents(
        {
          agents,
          default: dflt,
          summaries: Object.fromEntries(
            agents.map((a) => [a, { title: a[0].toUpperCase() + a.slice(1) }]),
          ),
        },
        composer.beginAgentsLoad(),
      ),
    );
  const notes = () =>
    view.result.current.messages
      .filter((m) => m.role === "system")
      .map((m) => (m.parts[0].type === "text" ? m.parts[0].text : ""));
  const lastNote = () => notes().at(-1);
  const posted = (path: string) => bodies.filter((b) => b.url === path).map((b) => b.body);
  const stored = () => JSON.parse(localStorage.getItem("ctrlb.chat") ?? "null") as unknown;
  return { chat, composer, view, land, notes, lastNote, posted, stored };
}
type F = Awaited<ReturnType<typeof fresh>>;

/** Open L2 (Lynette's newest) through the roster door, the way the owner gets there. */
async function inL2(f: F) {
  await act(async () => {
    await f.chat.openAgentConversation("lynette");
  });
  expect(f.view.result.current.threadId).toBe("L2");
}
async function send(f: F, text = "hi") {
  await act(async () => {
    await f.chat.sendMessage(text);
  });
}

beforeEach(() => {
  localStorage.clear();
  h.call = false;
  h.toasts = [];
  threadList = [
    { id: "L2", agent: "lynette" },
    { id: "E1", agent: "emma" },
    { id: "L1", agent: "lynette" },
  ];
  byAgent = { lynette: ["L2", "L1"], emma: ["E1"] };
  lazyHome = "lynette";
  calls = [];
  bodies = [];
  held = new Map();
  holdKeys = new Set();
  execAnswer = null;
  vi.stubGlobal("fetch", vi.fn(route));
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("B1 — `/agent <name>`: switch who answers (the §2 notes, verbatim)", () => {
  it("sets the responder, the note, the HOME unmoved — the send carries it at the HOME's overrides", async () => {
    const f = await fresh();
    f.land(["lynette", "emma"]);
    await inL2(f);
    act(() => {
      f.chat.setHomePrivilege("full"); // Lynette's overrides (R40)
      f.chat.setHomeMode("local");
    });
    act(() => f.chat.setResponder("emma"));
    expect(f.lastNote()).toBe(
      "// Emma answers in Lynette's conversation — /agent lynette switches back",
    );
    expect(f.view.result.current.responder).toBe("emma");
    expect(f.view.result.current.threadAgent).toBe("lynette"); // the home never moves (R17)
    await send(f);
    const body = f.posted("/api/agent/chat").at(-1)!;
    expect(body).toMatchObject({
      thread_id: "L2",
      agent: "emma",
      privilege: "full",
      mode: "local",
    });
  });

  it("the home's own name clears it; the others say what is already true", async () => {
    const f = await fresh();
    f.land(["lynette", "emma"]);
    await inL2(f);
    act(() => f.chat.reportResponder());
    expect(f.lastNote()).toBe("// talking to Lynette");
    act(() => f.chat.setResponder("lynette"));
    expect(f.lastNote()).toBe("// Lynette already answers here");
    act(() => f.chat.setResponder("emma"));
    act(() => f.chat.setResponder("emma"));
    expect(f.lastNote()).toBe("// Emma already answers here");
    act(() => f.chat.reportResponder());
    expect(f.lastNote()).toBe("// talking to Emma in Lynette's conversation");
    act(() => f.chat.setResponder("lynette"));
    expect(f.lastNote()).toBe("// Lynette answers again");
    expect(f.view.result.current.responder).toBeNull();
  });

  it("THE ROSTER (H1): an off-roster name toasts and changes nothing (§12.1 ③); `/agent default` is valid", async () => {
    const f = await fresh();
    f.land(["lynette", "emma"]);
    await inL2(f);
    const before = f.notes().length;
    act(() => f.chat.setResponder("xyz"));
    expect(h.toasts).toEqual(['No agent named "xyz"']);
    expect(f.notes()).toHaveLength(before);
    expect(f.view.result.current.responder).toBeNull();
    act(() => f.chat.setResponder("default")); // the root — never in `agents`, always on the roster
    expect(f.view.result.current.responder).toBe("default");
  });

  it("before the roster LANDS a name passes unjudged — the first landing judges it (M3, N2)", async () => {
    const f = await fresh();
    await inL2(f);
    act(() => f.chat.setResponder("xyz"));
    expect(h.toasts).toEqual([]);
    expect(f.view.result.current.responder).toBe("xyz");
    f.land(["lynette", "emma"]);
    expect(f.view.result.current.responder).toBeNull();
    expect(f.lastNote()).toBe("// xyz is gone — Lynette answers");
  });
});

describe("B2 — `/new` while switched", () => {
  it("a fresh HOME conversation, the responder gone; with no owner turn: the note, the responder stays", async () => {
    const f = await fresh();
    f.land(["lynette", "emma"]);
    await inL2(f);
    act(() => f.chat.setResponder("emma"));
    await act(async () => {
      await f.chat.newConversation();
    });
    expect(f.posted("/api/threads")).toEqual([{ agent: "lynette" }]); // never Emma's (R22)
    expect(f.view.result.current).toMatchObject({
      threadId: "new-lynette",
      threadAgent: "lynette",
      responder: null,
    });
    // The minted conversation holds only its greeting — no owner turn: `/new` is a no-op there.
    vi.mocked(globalThis.fetch).mockImplementation((input, init) =>
      String(input) === "/api/threads/new-lynette/messages"
        ? Promise.resolve(json([assistant("greet", "new-lynette")]))
        : route(input, init),
    );
    await act(async () => {
      await f.chat.openThread("L1", "lynette");
      await f.chat.openThread("new-lynette", "lynette");
    });
    act(() => f.chat.setResponder("emma"));
    await act(async () => {
      await f.chat.newConversation();
    });
    expect(f.lastNote()).toBe("// this conversation is already new");
    expect(f.posted("/api/threads")).toHaveLength(1);
    expect(f.view.result.current.responder).toBe("emma");
  });
});

describe("B3/B4/B5 — the roster door (`openAgentConversation`)", () => {
  it("B3: another agent's latest opens with its home installed — leaving clears the responder", async () => {
    const f = await fresh();
    f.land(["lynette", "emma"]);
    await inL2(f);
    act(() => f.chat.setResponder("emma"));
    await act(async () => {
      expect(await f.chat.openAgentConversation("emma")).toBe(true);
    });
    expect(f.view.result.current).toMatchObject({
      threadId: "E1",
      threadAgent: "emma",
      responder: null,
    });
    expect(calls).toContain("/api/threads?agent=emma&limit=1");
    // the home was HANDED to the open (H6) — no late list read for it
    expect(calls.filter((c) => c === "/api/threads?include_archived=true")).toHaveLength(0);
  });

  it("B4: back to Lynette → her latest (L2), Lynette answering — the device entered from elsewhere", async () => {
    const f = await fresh();
    f.land(["lynette", "emma"]);
    await act(async () => {
      await f.chat.openAgentConversation("emma");
      await f.chat.openAgentConversation("lynette");
    });
    expect(f.view.result.current).toMatchObject({ threadId: "L2", threadAgent: "lynette" });
  });

  it("an agent with no conversation gets a fresh one minted for it (seam ①)", async () => {
    byAgent.emma = [];
    const f = await fresh();
    f.land(["lynette", "emma"]);
    await act(async () => {
      await f.chat.openAgentConversation("emma");
    });
    expect(f.posted("/api/threads")).toEqual([{ agent: "emma" }]);
    expect(f.view.result.current).toMatchObject({ threadId: "new-emma", threadAgent: "emma" });
  });

  it("B5: the home's own row on its LATEST clears the responder IN PLACE — no reload", async () => {
    const f = await fresh();
    f.land(["lynette", "emma"]);
    await inL2(f);
    act(() => f.chat.setResponder("emma"));
    const reads = calls.filter((c) => c === "/api/threads/L2/messages").length;
    const before = f.view.result.current.messages;
    await act(async () => {
      expect(await f.chat.openAgentConversation("lynette")).toBe(true);
    });
    expect(f.view.result.current.responder).toBeNull();
    expect(f.view.result.current.threadId).toBe("L2");
    expect(calls.filter((c) => c === "/api/threads/L2/messages")).toHaveLength(reads);
    expect(f.view.result.current.messages).toBe(before); // nothing reloaded
    expect(f.stored()).toMatchObject({ thread: "L2", home: "lynette", responder: null });
  });

  it("…while on an OLDER conversation of the same agent it is navigation (L1 → L2)", async () => {
    const f = await fresh();
    f.land(["lynette", "emma"]);
    await act(async () => {
      await f.chat.openThread("L1", "lynette");
    });
    await act(async () => {
      await f.chat.openAgentConversation("lynette");
    });
    expect(f.view.result.current.threadId).toBe("L2");
  });

  it("Q2: a name OFF the landed roster resolves to the configured default BEFORE the read — never a mint for it", async () => {
    byAgent = { lynette: [] };
    const f = await fresh();
    f.land(["lynette"]);
    await act(async () => {
      await f.chat.openAgentConversation("ghost");
    });
    expect(calls).toContain("/api/threads?agent=lynette&limit=1");
    expect(calls.some((c) => c.includes("agent=ghost"))).toBe(false);
    expect(f.posted("/api/threads")).toEqual([{ agent: "lynette" }]);
  });

  it("L8: a slow roster door superseded by a later open ABANDONS — the later intent wins", async () => {
    const f = await fresh();
    f.land(["lynette", "emma"]);
    hold("/api/threads?agent=emma&limit=1");
    let slow!: Promise<boolean>;
    act(() => {
      slow = f.chat.openAgentConversation("emma");
    });
    await act(async () => {
      await f.chat.openThread("L1", "lynette"); // a sheet-row tap, after the roster tap
    });
    release("/api/threads?agent=emma&limit=1");
    await act(async () => {
      expect(await slow).toBe(false);
    });
    expect(f.view.result.current.threadId).toBe("L1");
    expect(calls).not.toContain("/api/threads/E1/messages");
  });

  it("a failed read → the unreachable note, the view untouched", async () => {
    const f = await fresh();
    f.land(["lynette", "emma"]);
    await inL2(f);
    vi.mocked(globalThis.fetch).mockImplementationOnce(() => Promise.reject(new Error("down")));
    await act(async () => {
      expect(await f.chat.openAgentConversation("emma")).toBe(false);
    });
    expect(f.lastNote()).toBe("// could not open that thread — the backend is unreachable");
    expect(f.view.result.current.threadId).toBe("L2");
  });
});

describe("THE INVARIANT (R22) — no door writes another agent's conversation", () => {
  it("`/agent`, a send and `/new` act on the open conversation (or mint for its HOME) only", async () => {
    const f = await fresh();
    f.land(["lynette", "emma"]);
    await inL2(f);
    act(() => f.chat.setResponder("emma"));
    await send(f);
    await act(async () => {
      await f.chat.newConversation();
    });
    expect(f.posted("/api/agent/chat").map((b) => b.thread_id)).toEqual(["L2"]);
    expect(f.posted("/api/threads")).toEqual([{ agent: "lynette" }]);
    expect(calls.some((c) => c.includes("E1"))).toBe(false);
  });
});

describe("B9/B15 — `ctrlb.chat` restores the tuple; the responder only on the SAME conversation", () => {
  it("a reload reopens L2 with Emma still answering, at Lynette's persisted overrides", async () => {
    const a = await fresh();
    a.land(["lynette", "emma"]);
    await inL2(a);
    act(() => {
      a.chat.setHomePrivilege("full");
      a.chat.setHomeMode("local");
      a.chat.setResponder("emma");
    });
    expect(a.stored()).toEqual({
      thread: "L2",
      home: "lynette",
      responder: "emma",
      overrides: { lynette: { privilege: "full", mode: "local" } },
    });
    // …the PWA is killed and relaunched:
    const b = await fresh();
    await act(async () => {
      await b.chat.initChat();
    });
    expect(b.view.result.current).toMatchObject({
      threadId: "L2",
      threadAgent: "lynette",
      responder: "emma",
    });
    await send(b);
    expect(b.posted("/api/agent/chat").at(-1)).toMatchObject({
      agent: "emma",
      privilege: "full",
      mode: "local",
    });
  });

  it("M3: a stored responder is KEPT until the roster lands, then judged by the first landing", async () => {
    localStorage.setItem(
      "ctrlb.chat",
      JSON.stringify({ thread: "L2", home: "lynette", responder: "ghost", overrides: {} }),
    );
    const f = await fresh();
    await act(async () => {
      await f.chat.initChat();
    });
    expect(f.view.result.current.responder).toBe("ghost"); // unjudged — no roster yet
    f.land(["lynette", "emma"]);
    expect(f.view.result.current.responder).toBeNull();
    expect(f.lastNote()).toBe("// ghost is gone — Lynette answers");
    expect(f.stored()).toMatchObject({ responder: null });
  });

  it("…and a roster that landed BEFORE the boot judges it at the boot", async () => {
    localStorage.setItem(
      "ctrlb.chat",
      JSON.stringify({ thread: "L2", home: "lynette", responder: "ghost", overrides: {} }),
    );
    const f = await fresh();
    f.land(["lynette", "emma"]);
    await act(async () => {
      await f.chat.initChat();
    });
    expect(f.view.result.current.responder).toBeNull();
  });

  it("H7: the stored conversation deleted elsewhere → the toast, then its HOME's latest — no responder", async () => {
    localStorage.setItem(
      "ctrlb.chat",
      JSON.stringify({ thread: "GONE", home: "emma", responder: "lynette", overrides: {} }),
    );
    const f = await fresh();
    await act(async () => {
      await f.chat.initChat();
    });
    expect(h.toasts).toEqual(["this conversation was deleted"]);
    expect(f.view.result.current).toMatchObject({ threadId: "E1", responder: null });
  });

  it("no stored thread → the newest NON-archived conversation, with no responder", async () => {
    threadList = [{ id: "RUN", agent: "ops", archived: true }, ...threadList];
    const f = await fresh();
    await act(async () => {
      await f.chat.initChat();
    });
    expect(f.view.result.current).toMatchObject({ threadId: "L2", responder: null });
  });

  it("an ARCHIVED conversation the owner left open still counts as present (H3)", async () => {
    threadList = [{ id: "RUN", agent: "ops", archived: true }, ...threadList];
    localStorage.setItem(
      "ctrlb.chat",
      JSON.stringify({ thread: "RUN", home: "ops", responder: null, overrides: {} }),
    );
    const f = await fresh();
    await act(async () => {
      await f.chat.initChat();
    });
    expect(h.toasts).toEqual([]);
    expect(f.view.result.current).toMatchObject({ threadId: "RUN", threadAgent: "ops" });
  });

  it("nothing at all → the thread-less view, where a stored responder survives (stored thread null)", async () => {
    threadList = [];
    localStorage.setItem(
      "ctrlb.chat",
      JSON.stringify({ thread: null, home: null, responder: "emma", overrides: {} }),
    );
    const f = await fresh();
    await act(async () => {
      await f.chat.initChat();
    });
    expect(f.view.result.current).toMatchObject({ threadId: null, responder: "emma" });
  });
});

describe("the `ctrlb.chat` load-boundary fold (R4, ON4)", () => {
  it("the legacy D75 `{agent}` sticky pick is DROPPED — never carried into the responder — and never written again", async () => {
    localStorage.setItem("ctrlb.chat", JSON.stringify({ agent: "emma" }));
    const f = await fresh();
    expect(f.view.result.current.responder).toBeNull();
    expect(f.stored()).toEqual({ thread: null, home: null, responder: null, overrides: {} });
  });

  it("the overrides are guarded ENTRY BY ENTRY — a bad entry drops alone, never the blob", async () => {
    localStorage.setItem(
      "ctrlb.chat",
      JSON.stringify({
        thread: "L2",
        home: 42, // not a slug → null
        responder: "",
        overrides: {
          lynette: { privilege: "full", mode: "local" },
          emma: { mode: "local" },
          bad1: 5,
          bad2: { privilege: "root" },
          bad3: { mode: "Not A Mode!" },
          bad4: { privilege: "full", mode: 7 },
        },
      }),
    );
    const f = await fresh();
    expect(f.view.result.current.overrides).toEqual({
      lynette: { privilege: "full", mode: "local" },
      emma: { mode: "local" },
    });
    expect(f.stored()).toMatchObject({ thread: "L2", home: null, responder: null });
  });

  it("an unreadable or non-object blob loads as nothing", async () => {
    localStorage.setItem("ctrlb.chat", JSON.stringify("emma"));
    const f = await fresh();
    expect(f.view.result.current.overrides).toEqual({});
    expect(f.stored()).toEqual({ thread: null, home: null, responder: null, overrides: {} });
  });

  it("writers patch their OWN field (M4): an override write never rewrites the tuple, and vice versa", async () => {
    const f = await fresh();
    f.land(["lynette", "emma"]);
    await inL2(f);
    // another tab wrote its own override for Emma meanwhile:
    const s = f.stored() as Record<string, unknown>;
    localStorage.setItem(
      "ctrlb.chat",
      JSON.stringify({ ...s, overrides: { emma: { privilege: "readonly" } } }),
    );
    act(() => {
      f.chat.setHomePrivilege("full");
    });
    expect((f.stored() as { overrides: unknown }).overrides).toEqual({
      emma: { privilege: "readonly" },
      lynette: { privilege: "full" },
    });
  });
});

describe("B10 — in a live call (R20)", () => {
  it("the four doors refuse with their notes; `/privilege` and the mode stay allowed (Q4)", async () => {
    const f = await fresh();
    f.land(["lynette", "emma"]);
    await inL2(f);
    const before = calls.length;
    h.call = true;
    act(() => f.chat.setResponder("emma"));
    expect(f.lastNote()).toBe("// hang up to switch who answers");
    expect(f.view.result.current.responder).toBeNull();
    for (const door of [
      () => f.chat.openThread("E1", "emma"),
      () => f.chat.openAgentConversation("emma"),
      () => f.chat.mintAndOpen("emma"),
      () => f.chat.newConversation(),
    ]) {
      await act(async () => {
        await door();
      });
      expect(f.lastNote()).toBe("// hang up to switch conversations");
    }
    expect(calls.slice(before)).toEqual([]); // not one request — nothing swapped, nothing minted
    expect(f.view.result.current.threadId).toBe("L2");
    act(() => {
      expect(f.chat.setHomePrivilege("full")).toBe("lynette");
      expect(f.chat.setHomeMode("local")).toBe("lynette");
    });
    expect(f.view.result.current.overrides).toEqual({
      lynette: { privilege: "full", mode: "local" },
    });
  });
});

describe("B16 — privilege and mode per HOME agent (R40)", () => {
  it("set in L2; absent in E1; back in L2 and L1; a responder's send in L2 carries Lynette's", async () => {
    const f = await fresh();
    f.land(["lynette", "emma"]);
    await inL2(f);
    act(() => {
      f.chat.setHomePrivilege("full");
      f.chat.setHomeMode("local");
    });
    await act(async () => {
      await f.chat.openAgentConversation("emma");
    });
    await send(f);
    expect(f.posted("/api/agent/chat").at(-1)).toMatchObject({
      thread_id: "E1",
      privilege: null,
      mode: null,
    });
    await act(async () => {
      await f.chat.openAgentConversation("lynette");
    });
    act(() => f.chat.setResponder("emma"));
    await send(f);
    expect(f.posted("/api/agent/chat").at(-1)).toMatchObject({
      thread_id: "L2",
      agent: "emma",
      privilege: "full",
      mode: "local",
    });
    await act(async () => {
      await f.chat.openThread("L1", "lynette");
    });
    await send(f);
    expect(f.posted("/api/agent/chat").at(-1)).toMatchObject({
      thread_id: "L1",
      privilege: "full",
    });
  });

  it("a one-shot `/<provider> msg` stays per message; the carries re-send the HOME's privilege", async () => {
    const f = await fresh();
    f.land(["lynette", "emma"]);
    await inL2(f);
    act(() => {
      f.chat.setHomePrivilege("auto_low");
    });
    // (the regenerate first: this harness's floor never echoes a send back, which would leave it unsent)
    await act(async () => {
      await f.chat.regenerate("L2-a", () => true);
    });
    expect(f.posted("/api/agent/regenerate").at(-1)).toMatchObject({ privilege: "auto_low" });
    await act(async () => {
      await f.chat.sendMessage("once", { mode: "cloud" });
    });
    expect(f.posted("/api/agent/chat").at(-1)).toMatchObject({
      mode: "cloud",
      privilege: "auto_low",
    });
    await send(f, "next"); // the one-shot was not sticky
    expect(f.posted("/api/agent/chat").at(-1)).toMatchObject({ mode: null });
    await act(async () => {
      await f.chat.resumeCall("c1", "execute");
    });
    await act(async () => {
      await f.chat.answerQuestion("c1", "yes");
    });
    for (const b of f.posted("/api/agent/resume")) expect(b.privilege).toBe("auto_low");
    expect(f.posted("/api/agent/resume")).toHaveLength(2);
  });

  it("H6: with the open conversation's home UNKNOWN no override rides the send, and the chip reads unknown", async () => {
    const f = await fresh();
    f.land(["lynette", "emma"]);
    act(() => {
      f.chat.setHomePrivilege("full"); // thread-less: keyed by the configured default (lynette)
      f.chat.setHomeMode("local"); // …a mode too, so `mode: null` below pins that half of H6
    });
    // a door that knew nothing, and a late read that never finds the home:
    threadList = [];
    await act(async () => {
      await f.chat.openThread("X");
    });
    expect(f.view.result.current.threadAgent).toBeNull();
    const chip = renderHook(() => f.chat.useHomePrivilege());
    expect(chip.result.current).toBeUndefined();
    act(() => {
      expect(f.chat.setHomePrivilege("readonly")).toBeNull(); // nothing keyed by a guess
    });
    await send(f);
    expect(f.posted("/api/agent/chat").at(-1)).toMatchObject({
      thread_id: "X",
      privilege: null,
      mode: null,
    });
  });
});

describe("B17 — no conversation open", () => {
  it("`/agent emma` thread-less: the note; the send mints LYNETTE's conversation and Emma keeps answering", async () => {
    const f = await fresh();
    f.land(["lynette", "emma"]);
    act(() => f.chat.setResponder("emma"));
    expect(f.lastNote()).toBe("// Emma will answer — the conversation starts as Lynette's");
    await send(f);
    expect(f.posted("/api/agent/chat").at(-1)).toMatchObject({ thread_id: null, agent: "emma" });
    expect(f.view.result.current).toMatchObject({
      threadId: "lazy",
      threadAgent: "lynette",
      responder: "emma", // the device never left
    });
    expect(f.stored()).toMatchObject({ thread: "lazy", home: "lynette", responder: "emma" });
  });

  it("picking the configured default thread-less is no responder at all (§12.2 a)", async () => {
    const f = await fresh();
    f.land(["lynette", "emma"]);
    act(() => f.chat.setResponder("lynette"));
    expect(f.lastNote()).toBe("// Lynette will answer");
    expect(f.view.result.current.responder).toBeNull();
  });

  it("the NORMALISATION at `setWireThread`: a responder equal to the minted home is dropped", async () => {
    const f = await fresh(); // no roster yet — the home-to-be is the root, so `lynette` is kept…
    act(() => f.chat.setResponder("lynette"));
    expect(f.view.result.current.responder).toBe("lynette");
    await send(f); // …until the lazy mint's head names the home: Lynette
    expect(f.view.result.current).toMatchObject({ threadAgent: "lynette", responder: null });
  });

  it("…and at the late home read (the `installHome` on the same conversation)", async () => {
    const f = await fresh();
    hold("/api/threads?include_archived=true");
    await act(async () => {
      await f.chat.openThread("L2"); // a door that knew nothing — the home read is parked
    });
    act(() => f.chat.setResponder("lynette")); // the home is unknown, so this is a responder…
    expect(f.view.result.current.responder).toBe("lynette");
    release("/api/threads?include_archived=true");
    await waitFor(() => expect(f.view.result.current.threadAgent).toBe("lynette"));
    expect(f.view.result.current.responder).toBeNull(); // …until the home lands and equals it
  });
});

describe("B18 — the roster sweep (N2 + M7)", () => {
  it("a roster without the RESPONDER clears it with the note and prunes its slot — the HOME's untouched", async () => {
    const f = await fresh();
    f.land(["lynette", "emma"]);
    await act(async () => {
      await f.chat.openAgentConversation("emma");
    });
    act(() => {
      f.chat.setHomePrivilege("full");
    }); // Emma's own slot
    await act(async () => {
      await f.chat.openAgentConversation("lynette");
    });
    act(() => {
      f.chat.setHomePrivilege("auto_low"); // Lynette's slot
      f.chat.setResponder("emma");
    });
    f.land(["lynette"]); // Emma deleted (here, or on another device: the roster refresh)
    expect(f.view.result.current.responder).toBeNull();
    expect(f.lastNote()).toBe("// emma is gone — Lynette answers");
    expect(f.view.result.current.overrides).toEqual({ lynette: { privilege: "auto_low" } });
    expect((f.stored() as { overrides: unknown }).overrides).toEqual({
      lynette: { privilege: "auto_low" },
    });
    expect(f.view.result.current.threadId).toBe("L2"); // the view stays
  });

  it("a VIEW whose HOME left the roster moves to the configured default's latest", async () => {
    const f = await fresh();
    f.land(["lynette", "emma"]);
    await act(async () => {
      await f.chat.openAgentConversation("emma");
    });
    f.land(["lynette"]);
    await waitFor(() => expect(f.view.result.current.threadId).toBe("L2"));
    expect(f.view.result.current.threadAgent).toBe("lynette");
  });

  it("…but not inside a live call (the move latches to the hang-up — S7b)", async () => {
    const f = await fresh();
    f.land(["lynette", "emma"]);
    await act(async () => {
      await f.chat.openAgentConversation("emma");
    });
    h.call = true;
    f.land(["lynette"]);
    expect(f.view.result.current.threadId).toBe("E1");
  });

  it("the ROOT is on every roster: its overrides survive a refresh that never lists it (H1)", async () => {
    byAgent.default = ["R1"];
    const f = await fresh();
    f.land(["lynette"]);
    await act(async () => {
      await f.chat.openAgentConversation("default");
    });
    act(() => {
      f.chat.setHomePrivilege("full");
    });
    f.land(["lynette"]);
    expect(f.view.result.current.overrides).toEqual({ default: { privilege: "full" } });
    expect(f.view.result.current.threadId).toBe("R1");
  });
});

describe("the responder's lifetime across swaps (R45)", () => {
  it("a same-id open keeps it (a notification tap); another conversation clears it", async () => {
    const f = await fresh();
    f.land(["lynette", "emma"]);
    await inL2(f);
    act(() => f.chat.setResponder("emma"));
    await act(async () => {
      await f.chat.openThread("L2", "lynette");
    });
    expect(f.view.result.current.responder).toBe("emma");
    await act(async () => {
      await f.chat.openThread("L1", "lynette");
    });
    expect(f.view.result.current.responder).toBeNull();
    expect(f.stored()).toMatchObject({ thread: "L1", home: "lynette", responder: null });
  });

  it("`mintAndOpen` while another view STREAMS still swaps (O7)", async () => {
    const f = await fresh();
    f.land(["lynette", "emma"]);
    await inL2(f);
    vi.mocked(globalThis.fetch).mockImplementation((input, init) =>
      String(input) === "/api/agent/chat" ? new Promise(() => {}) : route(input, init),
    );
    act(() => {
      void f.chat.sendMessage("still going");
    });
    expect(f.view.result.current.status).toBe("streaming");
    await act(async () => {
      expect(await f.chat.mintAndOpen("emma")).toBe(true);
    });
    expect(f.view.result.current).toMatchObject({
      threadId: "new-emma",
      threadAgent: "emma",
      status: "idle",
    });
  });
});

// ── the S7a fix wave (the Sol ∥ Opus review round) ───────────────────────────────────────────────────

describe("S7A-01 + F2 — the `!cmd` exec path", () => {
  it("a 200 that lands after a hop writes NOTHING into the view swapped in", async () => {
    const f = await fresh();
    f.land(["lynette", "emma"]);
    await inL2(f);
    hold("POST /api/exec");
    let ran!: Promise<void>;
    act(() => {
      ran = f.chat.runShell("ls");
    });
    await act(async () => {
      await f.chat.openAgentConversation("emma"); // the hop, with the exec in flight
    });
    act(() => f.chat.setResponder("lynette"));
    const reads = calls.length;
    release("POST /api/exec");
    await act(async () => {
      await ran;
    });
    expect(f.view.result.current).toMatchObject({
      threadId: "E1",
      threadAgent: "emma",
      responder: "lynette",
    });
    expect(calls.slice(reads)).toEqual([]); // no forced floor read either
    expect(f.stored()).toMatchObject({ thread: "E1", home: "emma" });
  });

  it("a 202 (an exec steer) after a hop puts no bubble in the moved view", async () => {
    execAnswer = "queued";
    const f = await fresh();
    f.land(["lynette", "emma"]);
    await inL2(f);
    hold("POST /api/exec");
    let ran!: Promise<void>;
    act(() => {
      ran = f.chat.runShell("ls");
    });
    await act(async () => {
      await f.chat.openAgentConversation("emma");
    });
    release("POST /api/exec");
    await act(async () => {
      await ran;
    });
    expect(f.view.result.current.threadId).toBe("E1");
    expect(f.view.result.current.messages.some((m) => m.queued)).toBe(false);
  });

  it("F2: a `!cmd` on a thread-less view mints with its HOME installed — the chip is not unknown", async () => {
    const f = await fresh();
    f.land(["lynette", "emma"]);
    await act(async () => {
      await f.chat.runShell("ls");
    });
    expect(f.view.result.current).toMatchObject({ threadId: "x-new", threadAgent: "lynette" });
    expect(renderHook(() => f.chat.useHomePrivilege()).result.current).toBeNull();
  });

  it("a wire adoption from a NON-thread-less view clears the responder (only the lazy mint keeps it)", async () => {
    execAnswer = { threadId: "OTHER", agent: "lynette" };
    const f = await fresh();
    f.land(["lynette", "emma"]);
    await inL2(f);
    act(() => f.chat.setResponder("emma"));
    await act(async () => {
      await f.chat.runShell("ls");
    });
    expect(f.view.result.current).toMatchObject({ threadId: "OTHER", responder: null });
  });
});

describe("S7A-02 + F1 — the thread-less home is UNKNOWN until a roster lands", () => {
  it("no override rides the lazy mint, the writer says so, the chip reads unknown — until the landing", async () => {
    localStorage.setItem(
      "ctrlb.chat",
      JSON.stringify({
        thread: null,
        home: null,
        responder: null,
        overrides: { default: { privilege: "full", mode: "local" } }, // the ROOT's — never the mint's
      }),
    );
    const f = await fresh();
    const chip = renderHook(() => f.chat.useHomePrivilege());
    expect(chip.result.current).toBeUndefined();
    act(() => {
      f.composer.runComposer("/privilege readonly");
    });
    expect(f.lastNote()).toBe(
      "// this conversation's agent isn't known yet — try again in a moment",
    );
    await act(async () => {
      await f.chat.sendMessage("hi", { mode: "cloud" }); // a one-shot still applies
    });
    expect(f.posted("/api/agent/chat").at(-1)).toMatchObject({ privilege: null, mode: "cloud" });
    // a fresh thread-less view again, and the roster lands: the home is the configured default now
    act(() => f.chat.resetToThreadless());
    f.land(["lynette"], "default");
    expect(chip.result.current).toBe("full"); // the landing's emit repainted it
  });
});

describe("S7A-03 — a door that lands after `startCall()` commits nothing", () => {
  it("an open whose history lands during the call: refused at the commit point, the view untouched", async () => {
    const f = await fresh();
    f.land(["lynette", "emma"]);
    await inL2(f);
    act(() => f.chat.setResponder("emma"));
    hold("/api/threads/E1/messages");
    let open!: Promise<boolean>;
    act(() => {
      open = f.chat.openThread("E1", "emma");
    });
    h.call = true; // the call starts while the open is in flight
    release("/api/threads/E1/messages");
    await act(async () => {
      expect(await open).toBe(false);
    });
    expect(f.lastNote()).toBe("// hang up to switch conversations");
    expect(f.view.result.current).toMatchObject({ threadId: "L2", responder: "emma" });
  });

  it("a mint landing during the call does not swap", async () => {
    const f = await fresh();
    f.land(["lynette", "emma"]);
    await inL2(f);
    hold("POST /api/threads");
    let mint!: Promise<boolean>;
    act(() => {
      mint = f.chat.mintAndOpen("emma");
    });
    h.call = true;
    release("POST /api/threads");
    await act(async () => {
      expect(await mint).toBe(false);
    });
    expect(f.view.result.current.threadId).toBe("L2");
    expect(f.lastNote()).toBe("// hang up to switch conversations");
  });

  it("B5's roster read landing during the call leaves the responder alone", async () => {
    const f = await fresh();
    f.land(["lynette", "emma"]);
    await inL2(f);
    act(() => f.chat.setResponder("emma"));
    hold("/api/threads?agent=lynette&limit=1");
    let door!: Promise<boolean>;
    act(() => {
      door = f.chat.openAgentConversation("lynette");
    });
    h.call = true;
    release("/api/threads?agent=lynette&limit=1");
    await act(async () => {
      expect(await door).toBe(false);
    });
    expect(f.view.result.current).toMatchObject({ threadId: "L2", responder: "emma" });
  });

  it("the live-call TRANSCRIPT carries the HOME's override, the responder answering", async () => {
    const f = await fresh();
    f.land(["lynette", "emma"]);
    await inL2(f);
    act(() => {
      f.chat.setHomePrivilege("full");
      f.chat.setResponder("emma");
    });
    h.call = true;
    await act(async () => {
      await f.composer.sendCallTranscript("hello");
    });
    expect(f.posted("/api/agent/chat").at(-1)).toMatchObject({
      thread_id: "L2",
      agent: "emma",
      privilege: "full",
    });
  });
});

describe("F3 — a roster door tapped DURING the boot read outranks the boot's R29 fallback", () => {
  it("no toast, no fallback open — the owner's tap wins", async () => {
    localStorage.setItem(
      "ctrlb.chat",
      JSON.stringify({ thread: "GONE", home: "lynette", responder: null, overrides: {} }),
    );
    const f = await fresh();
    f.land(["lynette", "emma"]);
    hold("/api/threads?include_archived=true");
    hold("/api/threads?agent=emma&limit=1");
    let init!: Promise<void>;
    let door!: Promise<boolean>;
    act(() => {
      init = f.chat.initChat(); // the boot reads its list…
      door = f.chat.openAgentConversation("emma"); // …and the owner taps Emma meanwhile
    });
    release("/api/threads?include_archived=true");
    await act(async () => {
      await init;
    });
    expect(h.toasts).toEqual([]);
    expect(calls).not.toContain("/api/threads?agent=lynette&limit=1");
    release("/api/threads?agent=emma&limit=1");
    await act(async () => {
      expect(await door).toBe(true);
    });
    expect(f.view.result.current.threadId).toBe("E1");
  });
});

describe("the review round's remaining gaps", () => {
  it("a swap onto a conversation whose home IS the responder leaves no responder (every swap clears)", async () => {
    const f = await fresh();
    f.land(["lynette", "emma"]);
    await inL2(f);
    act(() => f.chat.setResponder("emma"));
    await act(async () => {
      await f.chat.openThread("E1", "emma");
    });
    expect(f.view.result.current).toMatchObject({ threadAgent: "emma", responder: null });
  });

  it("the cold boot normalises a stored responder equal to the opened record's home", async () => {
    localStorage.setItem(
      "ctrlb.chat",
      JSON.stringify({ thread: "L2", home: "lynette", responder: "lynette", overrides: {} }),
    );
    const f = await fresh();
    await act(async () => {
      await f.chat.initChat();
    });
    expect(f.view.result.current).toMatchObject({ threadId: "L2", responder: null });
    expect(f.stored()).toMatchObject({ responder: null });
  });

  it("a roster door's FAILED mint keeps the current view (the unreachable note)", async () => {
    byAgent.emma = [];
    const f = await fresh();
    f.land(["lynette", "emma"]);
    await inL2(f);
    vi.mocked(globalThis.fetch).mockImplementation((input, init) =>
      String(input) === "/api/threads" && init?.method === "POST"
        ? Promise.reject(new Error("down"))
        : route(input, init),
    );
    await act(async () => {
      expect(await f.chat.openAgentConversation("emma")).toBe(false);
    });
    expect(f.view.result.current.threadId).toBe("L2");
    expect(f.lastNote()).toBe("// could not open that thread — the backend is unreachable");
  });
});

// ── the S7a micro-wave (the confirms' leftovers) ─────────────────────────────────────────────────────

describe("the `!cmd` exec path after a hop — the rest of M1", () => {
  it("the 409 and transport-failure arms print NOTHING into the view swapped in", async () => {
    for (const answer of ["busy", "down"] as const) {
      execAnswer = answer;
      const f = await fresh();
      f.land(["lynette", "emma"]);
      await inL2(f);
      hold("POST /api/exec");
      let ran!: Promise<void>;
      act(() => {
        ran = f.chat.runShell("ls");
      });
      await act(async () => {
        await f.chat.openAgentConversation("emma");
      });
      release("POST /api/exec");
      await act(async () => {
        await ran;
      });
      expect(f.view.result.current.threadId).toBe("E1");
      expect(f.notes(), answer).toEqual([]);
    }
  });

  it("a 202 after a hop files its raw line under the ORIGIN thread — and none under the new view's", async () => {
    execAnswer = "queued";
    const f = await fresh();
    const draft = await import("../../src/store/composer");
    f.land(["lynette", "emma"]);
    await inL2(f);
    hold("POST /api/exec");
    let ran!: Promise<void>;
    act(() => {
      ran = f.chat.runShell("ls -la");
    });
    await act(async () => {
      await f.chat.openAgentConversation("emma");
    });
    release("POST /api/exec");
    await act(async () => {
      await ran;
    });
    // A Stop on E1 harvests e1 with NO raw line of its own → the entry's stored text is reconstructed.
    await act(async () => {
      await f.chat.cancelTurn({ threadId: "E1", turnId: null, assistantMessageId: null }, "draft");
    });
    expect(draft.getDraft()).toBe("!OTHER");
    draft.clearDraft();
    // Back on L2, the same harvest restores the RAW line the 202 filed under L2.
    await act(async () => {
      await f.chat.openThread("L2", "lynette");
    });
    await act(async () => {
      await f.chat.cancelTurn({ threadId: "L2", turnId: null, assistantMessageId: null }, "draft");
    });
    expect(draft.getDraft()).toBe("!ls -la");
  });
});

describe("the first thread-less send after the roster LANDS carries the configured default's overrides", () => {
  it("Lynette's persisted override rides her lazy mint once she is known as the default", async () => {
    localStorage.setItem(
      "ctrlb.chat",
      JSON.stringify({
        thread: null,
        home: null,
        responder: null,
        overrides: { lynette: { privilege: "full", mode: "local" } },
      }),
    );
    const f = await fresh();
    f.land(["lynette", "emma"], "lynette");
    await send(f);
    expect(f.posted("/api/agent/chat").at(-1)).toMatchObject({
      thread_id: null,
      privilege: "full",
      mode: "local",
    });
  });
});

describe("Qwen F6 — the landing normalises a THREAD-LESS view's responder (§12.2 a)", () => {
  for (const [stored, after] of [
    ["lynette", null], // equal to the configured default the landing reveals → redundant, dropped
    ["emma", "emma"], // not equal → it survives
  ] as const) {
    it(`a stored thread-less responder ${stored} → ${String(after)} once the roster lands`, async () => {
      threadList = [];
      localStorage.setItem(
        "ctrlb.chat",
        JSON.stringify({ thread: null, home: null, responder: stored, overrides: {} }),
      );
      const f = await fresh();
      await act(async () => {
        await f.chat.initChat();
      });
      expect(f.view.result.current.responder).toBe(stored); // unjudged before the landing (M3)
      f.land(["lynette", "emma"], "lynette");
      expect(f.view.result.current.responder).toBe(after);
      expect(f.stored()).toMatchObject({ thread: null, responder: after });
    });
  }
});
