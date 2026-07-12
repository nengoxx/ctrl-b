import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// FrontierAgent (F4) — the bespoke Agent body. It COMPOSES the shared <ChatThread/> (never forks it), so this
// suite exercises only the bespoke composition: the empty-state hero (title + suggestion chips), the
// `data-thread` recede attr, chips filling the composer draft, and the planPlacement gate mounting the kit
// PinnedPlanPanel. `useAgentChat` is mocked to control messages/plan without a QueryClient (the FrontierFleet
// test pattern); `useActions` is mocked so ChatThread's `useActionSpecs()` needs none; `PinnedPlanPanel` is
// stubbed to a marker so we assert FrontierAgent's MOUNT decision, not the panel's own store-driven render
// (that lives in planPlacement.test.ts). ResizeObserver is stubbed — ChatThread's scroll-stick effect
// constructs one on mount (mirrors chatThread.test.tsx).

const chat = vi.hoisted(() => {
  const view = {} as import("../../src/hooks/useAgentChat").AgentChat; // seeded in beforeEach
  return { view };
});
vi.mock("../../src/hooks/useAgentChat", () => ({ useAgentChat: () => chat.view }));
vi.mock("../../src/hooks/useActions", () => ({ useActionSpecs: () => ({ data: [] }) }));
vi.mock("../../src/theme-engine/kit/composer/plan/PinnedPlanPanel", () => ({
  PinnedPlanPanel: () => <div data-testid="pinned-panel" />,
}));

import { FrontierAgent } from "../../src/themes/frontier/FrontierAgent";
import { getDraft, setDraft } from "../../src/store/composer";
import { setThemeSetting, setUI } from "../../src/store/ui";
import type { AgentChat } from "../../src/hooks/useAgentChat";
import type { ChatMessage } from "../../src/types";

beforeAll(() => {
  class ResizeObserverStub {
    constructor(_cb: ResizeObserverCallback) {}
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  globalThis.ResizeObserver = ResizeObserverStub;
});

/** A minimal AgentChat with a controllable message list + plan (all other fields inert). */
function view(messages: ChatMessage[], currentPlan: AgentChat["currentPlan"] = null): AgentChat {
  return {
    messages,
    status: "idle",
    streamingId: null,
    resultByCall: {},
    currentPlan,
    resolvedDefault: undefined,
    ttsOn: false,
  };
}

const userMsg = (text: string): ChatMessage => ({
  id: "m1",
  thread_id: "t1",
  role: "user",
  parts: [{ type: "text", text }],
  actor: "user",
  ts: "2026-01-01T00:00:00Z",
  tokens: null,
  compacted: false,
});

beforeEach(() => {
  setUI({ theme: "frontier", themeSettings: {} });
  setDraft("");
  chat.view = view([]);
});
afterEach(() => {
  setUI({ themeSettings: {} });
  setDraft("");
  cleanup();
});

describe("FrontierAgent empty state", () => {
  it("renders the hero (title + 3 chips) at zero messages; data-thread='empty'", () => {
    const { container } = render(<FrontierAgent active />);
    expect(screen.getByRole("heading", { name: "Frontier Comms" })).toBeTruthy();
    expect(container.querySelectorAll(".fr-empty .chip2")).toHaveLength(3);
    expect(container.querySelector("#tab-agent")?.getAttribute("data-thread")).toBe("empty");
  });

  it("a chip click FILLS the composer draft (never sends)", () => {
    const { container } = render(<FrontierAgent active />);
    const chips = container.querySelectorAll<HTMLButtonElement>(".fr-empty .chip2");
    fireEvent.click(chips[0]);
    expect(getDraft()).toBe(chips[0].textContent);
    expect(getDraft().length).toBeGreaterThan(0);
  });
});

describe("FrontierAgent with messages", () => {
  it("data-thread='active'; the empty-state hero is gone; the log renders the thread", () => {
    chat.view = view([userMsg("hello agent")]);
    const { container } = render(<FrontierAgent active />);
    expect(container.querySelector("#tab-agent")?.getAttribute("data-thread")).toBe("active");
    expect(screen.queryByRole("heading", { name: "Frontier Comms" })).toBeNull();
    expect(container.querySelector(".fr-empty")).toBeNull();
    // the shared log rendered the thread bubble
    expect(container.querySelector(".chat-log")).not.toBeNull();
    expect(screen.getByText("hello agent")).toBeTruthy();
  });
});

describe("FrontierAgent plan placement", () => {
  const plan = { steps: [{ text: "wake pegasus", status: "pending" as const }] };

  it("planPlacement='pinned' mounts PinnedPlanPanel in the bespoke body", () => {
    setThemeSetting("frontier", "planPlacement", "pinned");
    chat.view = view([userMsg("go")], plan);
    render(<FrontierAgent active />);
    expect(screen.getByTestId("pinned-panel")).toBeTruthy();
  });

  it("planPlacement='inline' does NOT mount PinnedPlanPanel (DefaultRoot owns the composer pill)", () => {
    setThemeSetting("frontier", "planPlacement", "inline");
    chat.view = view([userMsg("go")], plan);
    render(<FrontierAgent active />);
    expect(screen.queryByTestId("pinned-panel")).toBeNull();
  });
});
