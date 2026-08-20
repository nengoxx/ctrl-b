import { act, cleanup, render, renderHook, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// ChatThread (F4) — the reusable chat LOG extracted from AgentTab. Two things this file locks in:
//   (a) the empty-state contract: the default `// new thread` sys bubble at zero messages, and a caller's
//       custom `emptyState` node when passed (so a bespoke theme body can swap the placeholder).
//   (b) the A4 re-home: the shared plan-open flag still auto-closes when the plan clears WITHOUT AgentTab
//       mounted — `usePlanOpenAutoClose` now lives in <AppEngines/> (§14.5), decoupled from the agent view.
//
// `useActions` is mocked so ChatThread's `useActionSpecs()` needs no QueryClient (the retry catalog isn't
// under test here). ResizeObserver is stubbed — ChatThread's scroll-stick effect constructs one on mount and
// jsdom lacks it (mirrors themeContract.test.ts).

vi.mock("../../src/hooks/useActions", () => ({ useActionSpecs: () => ({ data: [] }) }));

import { ChatThread } from "../../src/components/ChatThread";
import type { AgentChat } from "../../src/hooks/useAgentChat";
import { AUTOMATIONS_GROUP_ID } from "../../src/hooks/useAutomations";
import { sendMessage, useChat } from "../../src/store/chat";
import { clearGroupScrollTarget, getGroupScrollTarget } from "../../src/store/groupScroll";
import { getUI, setUI } from "../../src/store/ui";
import {
  setPlanSheetOpen,
  usePlanOpenAutoClose,
  usePlanSheetOpen,
} from "../../src/store/planSheet";
import type { ChatMessage, Plan, ToolCallPart } from "../../src/types";

beforeAll(() => {
  class ResizeObserverStub {
    constructor(_cb: ResizeObserverCallback) {}
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  globalThis.ResizeObserver = ResizeObserverStub;
});

afterEach(() => {
  cleanup();
  setPlanSheetOpen(false); // module state — reset between cases
});

/** A minimal empty AgentChat (no messages) — enough to render ChatThread's empty state. */
function emptyChat(): AgentChat {
  return {
    messages: [],
    status: "idle",
    streamingId: null,
    resultByCall: {},
    currentPlan: null,
    resolvedDefault: undefined,
    ttsOn: false,
  };
}

describe("ChatThread empty state", () => {
  it("renders the default `// new thread` sys bubble at zero messages", () => {
    render(<ChatThread active chat={emptyChat()} />);
    expect(screen.getByText("// new thread · ask me about the fleet")).toBeTruthy();
  });

  it("renders a caller's custom emptyState node instead when provided", () => {
    render(
      <ChatThread active chat={emptyChat()} emptyState={<div data-testid="custom">nothing</div>} />,
    );
    expect(screen.getByTestId("custom")).toBeTruthy();
    expect(screen.queryByText("// new thread · ask me about the fleet")).toBeNull();
  });
});

describe("A4 chat live region (F5 Gate A)", () => {
  it("marks the chat-log as a polite log region, idle → aria-busy false", () => {
    const { container } = render(<ChatThread active chat={emptyChat()} />);
    const log = container.querySelector("#chatlog");
    expect(log?.getAttribute("role")).toBe("log");
    expect(log?.getAttribute("aria-live")).toBe("polite");
    expect(log?.getAttribute("aria-busy")).toBe("false"); // idle status → not busy
  });

  it("sets aria-busy while streaming so the reply is announced once on settle, not per token", () => {
    const streaming: AgentChat = { ...emptyChat(), status: "streaming" };
    const { container } = render(<ChatThread active chat={streaming} />);
    expect(container.querySelector("#chatlog")?.getAttribute("aria-busy")).toBe("true");
  });
});

// ── D44 W3 — the CmdBubble 'always allow' affordance. It renders ONLY when the store flagged the
// suspended call as approval-eligible (`alwaysEligibleFor`), which the reducer sets from the
// `tool.permission` event's `alwaysEligible`. We drive a real suspend through the store to set that
// module flag, then render ChatThread with an awaiting_confirm bubble for the same call_id.
function sseResponse(frames: { event: string; data: unknown }[]): Response {
  const text = frames
    .map((f) => `event: ${f.event}\r\ndata: ${JSON.stringify(f.data)}\r\n\r\n`)
    .join("");
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(new TextEncoder().encode(text));
      c.close();
    },
  });
  return {
    ok: true,
    body,
    headers: {
      get: (k: string) => (k.toLowerCase() === "content-type" ? "text/event-stream" : null),
    },
  } as unknown as Response;
}

/** Drive one confirm-suspend for call `c1` with the given `alwaysEligible` so the store's module flag
 *  is set (true/false/absent), mirroring a live `tool.permission`. */
async function suspendCall(alwaysEligible?: boolean) {
  const perm: Record<string, unknown> = { callId: "c1", token: "tok-1" };
  if (alwaysEligible !== undefined) perm.alwaysEligible = alwaysEligible;
  globalThis.fetch = vi.fn(() =>
    Promise.resolve(
      sseResponse([
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
        { event: "tool.permission", data: perm },
        { event: "done", data: { state: "suspended" } },
      ]),
    ),
  );
  renderHook(() => useChat());
  await act(async () => {
    await sendMessage("wake");
  });
}

/** An AgentChat holding one awaiting_confirm command bubble for call `c1`. */
function awaitingChat(): AgentChat {
  const msg: ChatMessage = {
    id: "m1",
    thread_id: "t1",
    role: "assistant",
    actor: "agent",
    ts: new Date().toISOString(),
    tokens: null,
    compacted: false,
    parts: [
      {
        type: "tool_call",
        call_id: "c1",
        tool: "wake_host",
        args: { host: "vault" },
        state: "awaiting_confirm",
      },
    ],
  };
  return { ...emptyChat(), messages: [msg] };
}

describe("D44 W3 · the CmdBubble always-allow affordance", () => {
  it("shows the `always` action when the call is approval-eligible", async () => {
    await suspendCall(true);
    render(<ChatThread active chat={awaitingChat()} />);
    // the base allow/edit/deny always render; the always-allow sibling only when eligible
    expect(screen.getByText("allow")).toBeTruthy();
    const always = screen.getByText("always");
    expect(always).toBeTruthy();
    expect(always.className).toContain("exec-always"); // reuses the allow-family `.exec` hook
  });

  it("hides the `always` action when the call is not eligible (false or absent flag)", async () => {
    await suspendCall(false);
    render(<ChatThread active chat={awaitingChat()} />);
    expect(screen.getByText("allow")).toBeTruthy(); // the row still renders
    expect(screen.queryByText("always")).toBeNull(); // but no always-allow affordance
  });
});

// ── A3 §D-3 — the question bubble's one-tap choice chips. They render off the DURABLE `call.args`
// (the same source as the prompt), so no store branch is involved: an awaiting question with `choices`
// shows a chip per option, the declared `default` is marked, free text is untouched, and a question
// that offers nothing renders exactly as before.
/** Drive one QUESTION suspend through the store, so the module has a live `threadId` (and an idle
 *  status) for the chip tap to resume against — the `suspendCall` pattern, for `tool.question`. */
async function suspendQuestion() {
  globalThis.fetch = vi.fn(() =>
    Promise.resolve(
      sseResponse([
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
              args: { prompt: "Which host?", choices: ["corsair", "emma"], default: "emma" },
              state: "awaiting_answer",
            },
          },
        },
        { event: "tool.question", data: { callId: "q1", question: "Which host?" } },
        { event: "done", data: { state: "suspended" } },
      ]),
    ),
  );
  renderHook(() => useChat());
  await act(async () => {
    await sendMessage("which host");
  });
}

function questionChat(args: Record<string, unknown>, state = "awaiting_answer"): AgentChat {
  const msg: ChatMessage = {
    id: "m1",
    thread_id: "t1",
    role: "assistant",
    actor: "agent",
    ts: new Date().toISOString(),
    tokens: null,
    compacted: false,
    parts: [
      {
        type: "tool_call",
        call_id: "q1",
        tool: "question",
        args,
        state: state as ToolCallPart["state"],
      },
    ],
  };
  return { ...emptyChat(), messages: [msg] };
}

describe("A2/A3 · question bubble choice chips", () => {
  it("renders one chip per offered choice and marks the declared default", () => {
    render(
      <ChatThread
        active
        chat={questionChat({
          prompt: "Which host?",
          choices: ["corsair", "emma"],
          default: "emma",
        })}
      />,
    );
    expect(screen.getByText("Which host?")).toBeTruthy();
    const corsair = screen.getByText("corsair");
    const emma = screen.getByText("emma");
    expect(corsair.className).toContain("q-chip");
    expect(corsair.className).not.toContain("preferred");
    expect(emma.className).toContain("preferred"); // the answer an unattended run would assume
    expect(screen.getByPlaceholderText("type your answer…")).toBeTruthy(); // free text stays
  });

  it("drops non-string and blank options rather than rendering an empty chip", () => {
    const { container } = render(
      <ChatThread active chat={questionChat({ prompt: "Pick", choices: ["ok", "", 7, null] })} />,
    );
    expect(container.querySelectorAll(".q-chip").length).toBe(1);
  });

  it("renders no chip row at all when the question offers no choices", () => {
    const { container } = render(
      <ChatThread active chat={questionChat({ prompt: "Open one?" })} />,
    );
    expect(container.querySelector(".q-choices")).toBeNull();
    expect(screen.getByPlaceholderText("type your answer…")).toBeTruthy();
  });

  it("shows no chips once the question is resolved (the bubble renders its outcome instead)", () => {
    const chat = questionChat({ prompt: "Which host?", choices: ["corsair"] }, "ok");
    const { container } = render(<ChatThread active chat={chat} />);
    expect(container.querySelector(".q-choices")).toBeNull();
  });

  it("trims and de-duplicates the offered options before rendering", () => {
    // A trimmed chip is what makes the tap agree with the trimmed `default` (and with the headless
    // ladder, which compares against the same trimmed value); two spellings of one answer are one
    // choice, and would otherwise collide as React keys.
    const { container } = render(
      <ChatThread
        active
        chat={questionChat({
          prompt: "Which host?",
          choices: [" emma ", "emma", "corsair"],
          default: "emma",
        })}
      />,
    );
    const chips = [...container.querySelectorAll(".q-chip")];
    expect(chips.map((c) => c.textContent)).toEqual(["emma", "corsair"]);
    expect(chips[0].className).toContain("preferred"); // " emma " now matches its own default
  });

  it("caps the chips so a long list can't become a wall of buttons on a phone", () => {
    const many = Array.from({ length: 20 }, (_, i) => `option-${i}`);
    const { container } = render(
      <ChatThread active chat={questionChat({ prompt: "Pick", choices: many })} />,
    );
    expect(container.querySelectorAll(".q-chip").length).toBe(8);
  });

  it("tapping a chip sends it as the answer on the real resume path", async () => {
    // The behavioural half (post-14b review): the chip is not decoration — it must produce exactly the
    // resume payload the typed answer produces, for the same call, so the turn continues identically.
    await suspendQuestion();
    const posts: { url: string; body: Record<string, unknown> }[] = [];
    globalThis.fetch = vi.fn((url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      posts.push({ url: String(url), body });
      return Promise.resolve(sseResponse([{ event: "done", data: { state: "completed" } }]));
    }) as unknown as typeof fetch;

    render(
      <ChatThread
        active
        chat={questionChat({
          prompt: "Which host?",
          choices: ["corsair", "emma"],
          default: "emma",
        })}
      />,
    );
    await act(async () => {
      screen.getByText("emma").click();
    });

    expect(posts.length).toBe(1);
    expect(posts[0].url).toContain("/api/agent/resume");
    expect(posts[0].body).toMatchObject({
      thread_id: "t1",
      call_id: "q1",
      decision: "answer",
      answer: "emma",
    });
  });
});

describe("A4 plan-open auto-close is decoupled from AgentTab", () => {
  const plan: Plan = { steps: [{ text: "step one", status: "pending" }] };

  it("closes the shared open flag on plan→null with only ChatThread + the engine hook mounted (no AgentTab)", () => {
    // Stand in for <AppEngines/>: the auto-close hook lives beside the reusable log, NOT inside AgentTab.
    function Body({ p }: { p: Plan | null }) {
      usePlanOpenAutoClose(p);
      return <ChatThread active chat={emptyChat()} />;
    }
    setPlanSheetOpen(true);
    const { rerender } = render(<Body p={plan} />);
    // a live plan leaves the flag alone
    expect(renderHook(() => usePlanSheetOpen()).result.current).toBe(true);
    rerender(<Body p={null} />);
    expect(renderHook(() => usePlanSheetOpen()).result.current).toBe(false);
  });
});

// ── A3 §D-5 (14d) — the created-automation card. A confirmed `create_automation` returns the record in
// its result `data`, and the bubble renders it from THAT — no store branch, no refetch — so it survives a
// reload of a persisted thread. The affordance into Conf reuses the app's one navigation
// (`openConfGroup` → tab + the group-scroll handoff), never a second router.

/** An assistant message holding one settled `create_automation` call + its result. */
function createdChat(data: Record<string, unknown> | undefined): AgentChat {
  const msg: ChatMessage = {
    id: "m1",
    thread_id: "t1",
    role: "assistant",
    actor: "agent",
    ts: new Date().toISOString(),
    tokens: null,
    compacted: false,
    parts: [
      {
        type: "tool_call",
        call_id: "a1",
        tool: "create_automation",
        args: { name: "nightly", schedule: "0 3 * * *", prompt: "check the fleet" },
        state: "ok",
      },
    ],
  };
  return {
    ...emptyChat(),
    messages: [msg],
    resultByCall: {
      a1: { call_id: "a1", state: "ok", summary: "created automation 'nightly'", data },
    } as unknown as AgentChat["resultByCall"],
  };
}

const CARD = {
  id: "auto-1",
  name: "nightly",
  schedule: "0 3 * * *",
  schedule_text: "At 03:00 every day",
  tz: "UTC",
  next_fire: "2026-07-31T03:00:00+00:00",
  thread_mode: "fresh",
  enabled: true,
  agent: null,
};

describe("A3 14d · the created-automation card", () => {
  it("renders the saved record from the result payload", () => {
    const { container } = render(<ChatThread active chat={createdChat({ automation: CARD })} />);
    expect(screen.getByText("nightly")).toBeTruthy();
    expect(screen.getByText(/At 03:00 every day · UTC · next /)).toBeTruthy();
    expect(screen.getByText(/new thread each run/)).toBeTruthy();
    expect(container.querySelector(".svc-card.auto-made")).toBeTruthy();
  });

  it("says so when the automation runs as a named agent on one continuing thread", () => {
    render(
      <ChatThread
        active
        chat={createdChat({ automation: { ...CARD, thread_mode: "rolling", agent: "scout" } })}
      />,
    );
    expect(screen.getByText("one continuing thread · scout")).toBeTruthy();
  });

  it("renders no card for a result that carries no automation payload", () => {
    const { container } = render(<ChatThread active chat={createdChat(undefined)} />);
    expect(container.querySelector(".auto-made")).toBeNull();
    // …nor for a payload too partial to render (a row from a build before this shape existed).
    const partial = render(<ChatThread active chat={createdChat({ automation: { tz: "UTC" } })} />);
    expect(partial.container.querySelector(".auto-made")).toBeNull();
  });

  // `data` is persisted JSON replayed from the DB, so EVERY field is proved before the cast — a
  // shape-matching payload with a bad field would otherwise render `undefined` into the transcript, or
  // (for `tz`) feed `Intl` something it throws a RangeError on (post-14d review, MED).
  it.each([
    ["a non-string schedule_text", { schedule_text: 42 }],
    ["a non-string tz", { tz: null }],
    ["a non-string thread_mode", { thread_mode: 1 }],
    ["a non-boolean enabled", { enabled: "yes" }],
    ["a next_fire that is neither a string nor null", { next_fire: 1750000000 }],
    ["an agent that is neither a string nor null", { agent: 7 }],
  ])("renders no card when the payload has %s", (_label, over) => {
    const { container } = render(
      <ChatThread active chat={createdChat({ automation: { ...CARD, ...over } })} />,
    );
    expect(container.querySelector(".auto-made")).toBeNull();
  });

  it("degrades to the raw instant when the stored zone is one this browser cannot resolve", () => {
    // A valid-shaped card whose `tz` `Intl` refuses: the bubble must still render (the whole transcript
    // used to go down with it), just without the localized moment.
    render(
      <ChatThread active chat={createdChat({ automation: { ...CARD, tz: "Mars/Olympus" } })} />,
    );
    expect(screen.getByText(/next 2026-07-31T03:00:00\+00:00/)).toBeTruthy();
  });

  it("jumps to the Conf group that owns it, through the app's one navigation", () => {
    render(<ChatThread active chat={createdChat({ automation: CARD })} />);
    screen.getByRole("button", { name: /Open in Conf/ }).click();
    expect(getUI().tab).toBe("conf");
    expect(getGroupScrollTarget()).toBe(AUTOMATIONS_GROUP_ID);
    // Both stores are module state — leave them as they were found.
    clearGroupScrollTarget();
    setUI({ tab: "fleet" });
  });
});

// ── D62 — the who-line's serve attribution: the always-on endpoint chip (warn-coloured when a fallback
// saved the turn) and the tap-anywhere metrics disclosure. The data half (the reducer fold, the
// formatters, the segment rules) lives in tests/store/chatAttribution.test.ts; this is the render half.
function botChat(over: Partial<ChatMessage> = {}): AgentChat {
  const msg: ChatMessage = {
    id: "m1",
    thread_id: "t1",
    role: "assistant",
    actor: "agent",
    ts: "2026-08-20T14:32:00.000Z",
    tokens: null,
    compacted: false,
    parts: [{ type: "text", text: "pong" }],
    ...over,
  };
  return { ...emptyChat(), messages: [msg] };
}

const FULL: Partial<ChatMessage> = {
  source: { served: "corsair", degraded: false, context_window: 262144 },
  usage: {
    model: "qwen3.6-max",
    input_tokens: 8100,
    output_tokens: 512,
    cached_tokens: 6900,
    duration_ms: 12300,
  },
};

describe("D62 · the endpoint chip", () => {
  it("names the endpoint that served, in the who-line", () => {
    const { container } = render(<ChatThread active chat={botChat(FULL)} />);
    const chip = container.querySelector(".b.bot .who .who-ep");
    expect(chip?.textContent).toContain("corsair"); // uppercased by the caption's text-transform
  });

  it("takes the warn class on a fallback serve — the segment, not the whole line", () => {
    const degraded = { source: { served: "openrouter", degraded: true, from: "corsair" } };
    const { container } = render(<ChatThread active chat={botChat(degraded)} />);
    expect(container.querySelector(".b.bot .who .who-ep")?.className).toContain("degraded");
    expect(container.querySelector(".b.bot .who")?.className).toBe("who"); // the line stays plain
  });

  it("renders the pre-D62 who-line for a message with no attribution, and no toggle", () => {
    const { container } = render(<ChatThread active chat={botChat()} />);
    const who = container.querySelector(".b.bot .who");
    expect(who?.querySelector(".who-ep")).toBeNull();
    expect(who?.querySelector("button")).toBeNull(); // not tappable
    // one contiguous text run, exactly as before the slice (the local-clock hh:mm is the app's own)
    expect(who?.textContent).toMatch(/^assistant · \d\d:\d\d$/);
  });
});

describe("D62 · the metrics disclosure", () => {
  it("is closed until the who-line is tapped, and toggles back", () => {
    const { container } = render(<ChatThread active chat={botChat(FULL)} />);
    const who = container.querySelector(".b.bot .who") as HTMLElement;
    const toggle = who.querySelector("button") as HTMLButtonElement;
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(container.querySelector(".who-meta")).toBeNull();

    act(() => who.click()); // tap ANYWHERE on the line (the owner's ruling)
    expect(container.querySelector(".who-meta")).toBeTruthy();
    expect(who.querySelector("button")?.getAttribute("aria-expanded")).toBe("true");

    act(() => who.click());
    expect(container.querySelector(".who-meta")).toBeNull();
  });

  it("reads the call, the cost and — only on a fallback — what was lost", () => {
    const rows = (c: HTMLElement) =>
      [...c.querySelectorAll(".who-meta-row")].map((r) => r.textContent);
    const plain = render(<ChatThread active chat={botChat(FULL)} />);
    act(() => (plain.container.querySelector(".b.bot .who") as HTMLElement).click());
    const lines = rows(plain.container);
    expect(lines[0]).toContain("qwen3.6-max");
    expect(lines[0]).toContain("8.1k (6.9k cached)");
    expect(lines[1]).toContain("12.3s");
    expect(plain.container.querySelector(".who-meta-row.warn")).toBeNull(); // nothing was lost
    cleanup();

    const degraded = render(
      <ChatThread
        active
        chat={botChat({
          source: { served: "openrouter", degraded: true, from: "corsair", failed_hops: 2 },
          usage: { duration_ms: 4200 },
        })}
      />,
    );
    act(() => (degraded.container.querySelector(".b.bot .who") as HTMLElement).click());
    const warn = degraded.container.querySelector(".who-meta-row.warn");
    expect(warn?.textContent).toContain("fallback from corsair");
    expect(warn?.textContent).toContain("2 failed hops");
  });

  it("carries the arrows' words for a screen reader", () => {
    const { container } = render(<ChatThread active chat={botChat(FULL)} />);
    act(() => (container.querySelector(".b.bot .who") as HTMLElement).click());
    const sr = [...container.querySelectorAll(".who-meta .who-sr")].map((s) =>
      s.textContent?.trim(),
    );
    expect(sr).toEqual(["input tokens", "output tokens"]);
  });
});
