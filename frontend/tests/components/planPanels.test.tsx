import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { setPlanSheetOpen } from "../../src/store/planSheet";
import { PinnedPlanPanel } from "../../src/theme-engine/kit/composer/plan/PinnedPlanPanel";
import { PlanSheet } from "../../src/theme-engine/kit/composer/plan/PlanSheet";
import type { Plan } from "../../src/types";

// The two PLAN panels' closed/open contract. Both are mounted-while-closed overlays that animate open and
// shut on opacity+transform, and both hold FOCUSABLE step dots (`PlanSteps`' `.tick-btn`, role=button +
// tabIndex 0) — so the closed state must be `inert` (out of tab order AND the a11y tree) and must NOT use
// `aria-hidden`, which over focusable content is the `aria-hidden-focus` violation. Pinned here because the
// panels shipped with `aria-hidden={!open}` and the fix is invisible to every other test (2026-07-30).
//
// The plan itself comes from the chat thread's last `task_plan` call (`currentPlanOf`, covered in
// tests/lib/plan.test.ts); stubbing the selector keeps this file about the a11y contract alone.
const PLAN: Plan = {
  steps: [
    { text: "wake vault", status: "done" },
    { text: "start llama.cpp", status: "active" },
  ],
};
vi.mock("../../src/store/chat", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/store/chat")>()),
  useCurrentPlan: () => PLAN,
}));

// jsdom shim — PinnedPlanPanel watches its header with a ResizeObserver (the `--plan-head-h` publication).
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);

afterEach(() => {
  cleanup();
  setPlanSheetOpen(false); // module state — reset between cases
});

/** The closed contract, shared by both panels (and by the composer popovers — see composerToolsMenu). */
function expectClosed(el: HTMLElement) {
  expect(el.classList.contains("open")).toBe(false);
  expect(el.hasAttribute("inert")).toBe(true);
  expect(el.getAttribute("aria-hidden")).toBe(null);
  expect(el.querySelectorAll(".tick-btn").length).toBeGreaterThan(0); // the reason inert is required
}
function expectOpen(el: HTMLElement) {
  expect(el.classList.contains("open")).toBe(true);
  expect(el.hasAttribute("inert")).toBe(false);
  expect(el.getAttribute("aria-hidden")).toBe(null);
}

describe("PlanSheet — mounted while closed, inert (never aria-hidden)", () => {
  it("renders closed + inert, and opens on the shared plan flag", () => {
    const { container } = render(<PlanSheet />);
    const sheet = container.querySelector<HTMLElement>(".plan-sheet")!;
    expect(sheet).not.toBe(null);
    expectClosed(sheet);

    act(() => setPlanSheetOpen(true));
    expectOpen(container.querySelector<HTMLElement>(".plan-sheet")!);

    act(() => setPlanSheetOpen(false));
    expectClosed(container.querySelector<HTMLElement>(".plan-sheet")!);
  });
});

describe("PinnedPlanPanel — same contract on the drop", () => {
  it("renders the drop closed + inert, and opens with the header disclosure", () => {
    const { container } = render(<PinnedPlanPanel />);
    const drop = container.querySelector<HTMLElement>(".plan-pin-drop")!;
    const head = container.querySelector<HTMLButtonElement>(".plan-pin-head")!;
    expect(drop).not.toBe(null);
    expectClosed(drop);
    expect(head.getAttribute("aria-expanded")).toBe("false");
    expect(head.getAttribute("aria-controls")).toBe(drop.id); // the disclosure names the drop

    act(() => setPlanSheetOpen(true));
    expectOpen(container.querySelector<HTMLElement>(".plan-pin-drop")!);
    expect(
      container.querySelector<HTMLButtonElement>(".plan-pin-head")!.getAttribute("aria-expanded"),
    ).toBe("true");
  });
});

describe("PinnedPlanPanel — publishes the header height as `--plan-head-h` (W1)", () => {
  // The mini-player's yield reads this variable instead of a hard-coded clearance, so the panel MUST
  // publish it while mounted and drop it on unmount (a stale value would push the player off a band that
  // no longer has a header in it). jsdom reports 0 for every offsetHeight, so the head's is stubbed —
  // which also exercises the `h > 0` guard's input.
  it("sets the var on mount and removes it on unmount", () => {
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(30);
    const { unmount } = render(<PinnedPlanPanel />);
    expect(document.documentElement.style.getPropertyValue("--plan-head-h")).toBe("30px");
    unmount();
    expect(document.documentElement.style.getPropertyValue("--plan-head-h")).toBe("");
  });
});
