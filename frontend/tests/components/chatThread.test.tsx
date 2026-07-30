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
import { sendMessage, useChat } from "../../src/store/chat";
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
