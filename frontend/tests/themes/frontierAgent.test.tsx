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
vi.mock("../../src/hooks/useAgentArt", () => ({
  // D70 §8.5/§8.4 — the agent-art resolver is a QUERY PAIR (roster + media index), so it is mocked to the
  // NO-ART answer here (which is the state every assertion in this file is about) rather than dragging a
  // QueryClient in — the same reason `useActionSpecs` is mocked in these suites.
  useAgentArt: () => (name: string | null) => ({
    name: name ?? "default",
    title: name ?? "default",
  }),
}));
// D53 M2 — the rig-stack's layers now come from `GET /api/media/frontier`. The index hook is mocked
// rather than wrapped in a QueryClientProvider (the `useAgentChat` precedent above); the default —
// no owner files — is also the assertion that the F4 stack is unchanged on a fresh install.
const media = vi.hoisted(() => ({
  data: undefined as import("../../src/hooks/useMedia").MediaIndex | undefined,
}));
vi.mock("../../src/hooks/useMedia", () => ({ useMediaIndex: () => media }));
vi.mock("../../src/theme-engine/kit/composer/plan/PinnedPlanPanel", () => ({
  PinnedPlanPanel: () => <div data-testid="pinned-panel" />,
}));

import { FrontierAgent } from "../../src/themes/frontier/FrontierAgent";
import { ART } from "../../src/themes/frontier/art";
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
  media.data = undefined; // no owner files — the fresh-install state
});
afterEach(() => {
  setUI({ themeSettings: {} });
  setDraft("");
  cleanup();
});

describe("FrontierAgent empty state", () => {
  it("renders the hero (title + 2 chips) at zero messages; data-thread='empty'", () => {
    const { container } = render(<FrontierAgent active />);
    expect(screen.getByRole("heading", { name: "Frontier Comms" })).toBeTruthy();
    expect(container.querySelectorAll(".fr-empty .chip2")).toHaveLength(2);
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

describe("FrontierAgent rig-stack art (D53 M2)", () => {
  const layerUrls = (container: HTMLElement) =>
    [".layer.base", ".layer.mid", ".layer.cube"].map(
      (sel) =>
        /url\(["']?(.*?)["']?\)/.exec(
          container.querySelector<HTMLElement>(sel)?.style.backgroundImage ?? "",
        )?.[1],
    );

  it("with no owner files the three layers are the BUNDLED art (byte-identical to F4)", () => {
    const { container } = render(<FrontierAgent active />);
    expect(layerUrls(container)).toEqual([ART.stack.base, ART.stack.mid, ART.stack.cube]);
  });

  it("a single named drop replaces ONLY its layer — owner over bundled, composited", () => {
    media.data = {
      ns: "frontier",
      collation: "library-v1",
      roles: {
        rigs: [],
        hero: [],
        stack: [
          {
            name: "cube",
            file: "cube.png",
            url: "/api/media/frontier/files/stack/cube.png",
            format: "png",
            size_bytes: 10,
            revision: "1:10",
            width: 10,
            height: 10,
            unusable: false,
            unusable_reason: null,
          },
        ],
      },
      slots: {},
    };
    const { container } = render(<FrontierAgent active />);
    expect(layerUrls(container)).toEqual([
      ART.stack.base,
      ART.stack.mid,
      // PAINT-READY (D65 defect #1) — the `?rev=` rides the resolver.
      "/api/media/frontier/files/stack/cube.png?rev=1%3A10",
    ]);
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
