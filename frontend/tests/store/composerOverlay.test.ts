import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import {
  getComposerOverlay,
  releaseComposerOverlay,
  setComposerOverlay,
  toggleComposerOverlay,
  useComposerOverlayOpen,
} from "../../src/store/composerOverlay";
import { setPlanSheetOpen, usePlanSheetOpen } from "../../src/store/planSheet";

// A6 — the "one composer overlay at a time" coordinator that replaced A2's pairwise close rule. Three
// surfaces hover over the composer's top edge (plan sheet · suggest popover · tools menu) and exactly one
// may own the slot. The suggest half of the wiring is covered in tests/hooks/useComposerSuggest.test.ts;
// here we pin the slot mechanics and that `store/planSheet`'s public API still behaves as it always did.

beforeEach(() => setComposerOverlay(null));

describe("composerOverlay — the single owner slot", () => {
  it("claiming displaces the previous owner (every pairing)", () => {
    const pairs = [
      ["plan", "suggest"],
      ["plan", "menu"],
      ["suggest", "menu"],
      ["menu", "plan"],
      ["suggest", "plan"],
      ["menu", "suggest"],
    ] as const;
    for (const [first, second] of pairs) {
      setComposerOverlay(first);
      expect(getComposerOverlay()).toBe(first);
      setComposerOverlay(second);
      expect(getComposerOverlay()).toBe(second);
    }
  });

  it("release closes only the CURRENT owner — a displaced surface can't close its successor", () => {
    setComposerOverlay("suggest");
    setComposerOverlay("menu"); // the menu displaced the popover
    releaseComposerOverlay("suggest"); // the popover's own close-up runs late
    expect(getComposerOverlay()).toBe("menu"); // …and must not have closed the menu
    releaseComposerOverlay("menu");
    expect(getComposerOverlay()).toBe(null);
  });

  it("toggle opens, then closes the same surface", () => {
    toggleComposerOverlay("menu");
    expect(getComposerOverlay()).toBe("menu");
    toggleComposerOverlay("menu");
    expect(getComposerOverlay()).toBe(null);
    toggleComposerOverlay("menu");
    toggleComposerOverlay("plan"); // toggling a DIFFERENT one claims (it isn't the owner)
    expect(getComposerOverlay()).toBe("plan");
  });

  it("subscribers see only their own slot flip", () => {
    const menu = renderHook(() => useComposerOverlayOpen("menu"));
    const plan = renderHook(() => useComposerOverlayOpen("plan"));
    act(() => setComposerOverlay("menu"));
    expect(menu.result.current).toBe(true);
    expect(plan.result.current).toBe(false);
    act(() => setComposerOverlay("plan"));
    expect(menu.result.current).toBe(false);
    expect(plan.result.current).toBe(true);
  });
});

describe("planSheet on the coordinator — the public API is unchanged", () => {
  it("set(true)/set(false)/bare-toggle behave exactly as before", () => {
    const { result } = renderHook(() => usePlanSheetOpen());
    expect(result.current).toBe(false);
    act(() => setPlanSheetOpen(true));
    expect(result.current).toBe(true);
    act(() => setPlanSheetOpen()); // bare = toggle
    expect(result.current).toBe(false);
    act(() => setPlanSheetOpen()); // …and back
    expect(result.current).toBe(true);
    act(() => setPlanSheetOpen(false));
    expect(result.current).toBe(false);
  });

  it("opening the menu closes the plan sheet, and closing the plan sheet then can't reopen it", () => {
    const { result } = renderHook(() => usePlanSheetOpen());
    act(() => setPlanSheetOpen(true));
    act(() => setComposerOverlay("menu"));
    expect(result.current).toBe(false);
    // a late `setPlanSheetOpen(false)` (e.g. the plan cleared) must not clear the menu's claim
    act(() => setPlanSheetOpen(false));
    expect(getComposerOverlay()).toBe("menu");
  });
});
