import { cleanup, render, renderHook, screen } from "@testing-library/react";
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
import {
  setPlanSheetOpen,
  usePlanOpenAutoClose,
  usePlanSheetOpen,
} from "../../src/store/planSheet";
import type { Plan } from "../../src/types";

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
