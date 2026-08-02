import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// GachaAgent (D52 G3) — the bespoke Agent body. It COMPOSES the shared <ChatThread/> (never forks it), so
// this suite exercises only the bespoke composition: the ORACLE art block, the privilege row that the
// prototype's headerless design has no slot for, the empty state (hint + chips that FILL the composer), and
// the planPlacement gate mounting the kit PinnedPlanPanel. The mocking shape is frontierAgent.test.tsx's,
// because the obligations are the same: `useAgentChat` mocked to control messages/plan without a
// QueryClient, `useActions` mocked so ChatThread's `useActionSpecs()` needs none, `PinnedPlanPanel` stubbed
// to a marker so we assert the MOUNT decision, and a ResizeObserver stub for ChatThread's scroll-stick.

const chat = vi.hoisted(() => {
  const view = {} as import("../../src/hooks/useAgentChat").AgentChat; // seeded in beforeEach
  return { view };
});
vi.mock("../../src/hooks/useAgentChat", () => ({ useAgentChat: () => chat.view }));
vi.mock("../../src/hooks/useActions", () => ({ useActionSpecs: () => ({ data: [] }) }));
vi.mock("../../src/theme-engine/kit/composer/plan/PinnedPlanPanel", () => ({
  PinnedPlanPanel: () => <div data-testid="pinned-panel" />,
}));

import { GachaAgent } from "../../src/themes/gacha/GachaAgent";
import { ART } from "../../src/themes/gacha/art";
import { GACHA_COPY } from "../../src/themes/gacha/copy";
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
  setUI({ theme: "gacha", themeSettings: {} });
  setDraft("");
  chat.view = view([]);
});
afterEach(() => {
  setUI({ themeSettings: {} });
  setDraft("");
  cleanup();
});

describe("GachaAgent — the oracle block", () => {
  it("renders the ORACLE art (the partitioned scene slot, never a roster character) + its name plate", () => {
    const { container } = render(<GachaAgent active />);
    const art = container.querySelector<HTMLImageElement>(".gc-oracle .gc-oracle-art");
    expect(art?.getAttribute("src")).toBe(ART.oracle);
    // the partition is the point: the oracle must not be one of the per-host cycle's characters
    expect(ART.characters).not.toContain(ART.oracle);
    expect(art?.getAttribute("alt")).toBe(""); // decorative
    expect(screen.getByRole("heading", { name: /Lucky Relay/ })).toBeTruthy();
    expect(container.querySelector(".gc-oracle-name em")?.textContent).toBe(GACHA_COPY.oracleName);
    // M6's scanline layer exists and is decorative (its gates are CSS — see e2e/layout.spec.ts)
    expect(container.querySelector(".gc-oracle-scan")?.getAttribute("aria-hidden")).toBe("true");
  });

  it("keeps the privilege chip OUTSIDE the oracle (the M7 ghost must never fade a live control)", () => {
    const { container } = render(<GachaAgent active />);
    const chip = container.querySelector(".priv-chip");
    expect(chip).not.toBeNull();
    expect(container.querySelector(".gc-agent-bar .priv-chip")).not.toBeNull();
    expect(container.querySelector(".gc-oracle .priv-chip")).toBeNull();
  });

  it("composes the SHARED thread (the log tree is the kit's, not a fork)", () => {
    chat.view = view([userMsg("wake rook")]);
    const { container } = render(<GachaAgent active />);
    // #chatlog + role=log are ChatThread's own markup — proof the shared component mounted
    const log = container.querySelector("#chatlog");
    expect(log?.getAttribute("role")).toBe("log");
    expect(log?.classList.contains("chat-log")).toBe(true);
    expect(screen.getByText("wake rook")).toBeTruthy();
    // …and the tab wrapper keeps the kit's contract (tabpanel wired to its bar button)
    const tab = container.querySelector("#tab-agent");
    expect(tab?.getAttribute("role")).toBe("tabpanel");
    expect(tab?.getAttribute("aria-labelledby")).toBe("tabbtn-agent");
    expect(tab?.classList.contains("active")).toBe(true);
  });
});

describe("GachaAgent — the empty state", () => {
  it("renders the hint + two chips at zero messages, and NO second heading beside the oracle's", () => {
    const { container } = render(<GachaAgent active />);
    expect(container.querySelectorAll(".gc-empty .gc-chip")).toHaveLength(2);
    expect(container.querySelector(".gc-empty-hint")).not.toBeNull();
    // the oracle's h1 is the tab's ONE heading — the empty state deliberately adds none
    expect(container.querySelectorAll("#tab-agent h1, #tab-agent h2")).toHaveLength(1);
  });

  it("a chip click FILLS the composer draft (never sends)", () => {
    const { container } = render(<GachaAgent active />);
    const chips = container.querySelectorAll<HTMLButtonElement>(".gc-empty .gc-chip");
    fireEvent.click(chips[0]);
    expect(getDraft()).toBe(chips[0].textContent);
    expect(getDraft().length).toBeGreaterThan(0);
  });

  it("disappears once the thread has messages (the oracle stays)", () => {
    chat.view = view([userMsg("hello")]);
    const { container } = render(<GachaAgent active />);
    expect(container.querySelector(".gc-empty")).toBeNull();
    expect(container.querySelector(".gc-oracle")).not.toBeNull();
  });
});

describe("GachaAgent — plan placement", () => {
  const plan = { steps: [{ text: "wake pegasus", status: "pending" as const }] };

  it("planPlacement='pinned' mounts PinnedPlanPanel in the bespoke body", () => {
    setThemeSetting("gacha", "planPlacement", "pinned");
    chat.view = view([userMsg("go")], plan);
    render(<GachaAgent active />);
    expect(screen.getByTestId("pinned-panel")).toBeTruthy();
  });

  it("planPlacement='inline' (gacha's declared default) mounts no panel — the composer owns the pill", () => {
    chat.view = view([userMsg("go")], plan);
    render(<GachaAgent active />);
    expect(screen.queryByTestId("pinned-panel")).toBeNull();
  });
});
