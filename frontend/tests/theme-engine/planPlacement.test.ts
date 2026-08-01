import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  setPlanSheetOpen,
  usePlanOpenAutoClose,
  usePlanSheetOpen,
} from "../../src/store/planSheet";
import { setThemeSetting, setUI } from "../../src/store/ui";
import {
  planPlacementSetting,
  usePlanPlacement,
} from "../../src/theme-engine/kit/composer/plan/placement";
import type { Plan } from "../../src/types";

// COMPOSER_SURFACE_PLAN §0 (A4) — plan-PLACEMENT axis characterization. Mirrors composerSurface.test.ts: the
// shared seg spec factory, the per-theme resolver (declared default · stored value · undeclared-theme +
// corrupt-value fallbacks — validated through `resolveThemeSetting` for free), and the shared open-flag
// auto-close that folds the audited "cleared-then-new plan reopens unbidden" bug.

beforeEach(() => {
  setUI({ themeSettings: {} }); // clear overrides (module state persists between tests)
});
afterEach(() => {
  setUI({ themeSettings: {} });
  setPlanSheetOpen(false); // the open flag is module state — reset between cases
});

describe("planPlacementSetting", () => {
  it("builds the shared seg spec (options Inline/Pinned, default from the arg)", () => {
    const spec = planPlacementSetting();
    expect(spec).toMatchObject({
      type: "seg",
      label: "Plan",
      desc: "task plan placement",
      default: "inline",
      options: [
        { val: "inline", label: "Inline" },
        { val: "pinned", label: "Pinned" },
      ],
    });
    expect(planPlacementSetting("pinned").default).toBe("pinned");
  });
});

describe("usePlanPlacement", () => {
  it("undeclared theme (an unregistered id) → inline", () => {
    // A theme with no registry row declares nothing — a synced/stale override must not resolve:
    // `resolveThemeSetting` returns undefined for the unknown key → the hook's fallback holds. (This arm
    // used to be vapor; D51 V4 made vapor DECLARE `pinned`, so the undeclared case moved to `phosphor`, a
    // valid ThemeId with no registry row.)
    setUI({ theme: "phosphor", themeSettings: {} });
    setThemeSetting("phosphor", "planPlacement", "pinned");
    const { result } = renderHook(() => usePlanPlacement());
    expect(result.current).toBe("inline");
  });

  it("vapor resolves its DECLARED `pinned` (D51 V4 — the kit PinnedPlanPanel replaced its in-tab plan)", () => {
    setUI({ theme: "vapor", themeSettings: {} });
    const { result } = renderHook(() => usePlanPlacement());
    expect(result.current).toBe("pinned");
  });

  it("declaring theme (cosmos) resolves its declared default → inline", () => {
    setUI({ theme: "cosmos", themeSettings: {} });
    const { result } = renderHook(() => usePlanPlacement());
    expect(result.current).toBe("inline");
  });

  it("a stored value resolves on a declaring theme (cosmos → pinned)", () => {
    setUI({ theme: "cosmos", themeSettings: {} });
    setThemeSetting("cosmos", "planPlacement", "pinned");
    const { result } = renderHook(() => usePlanPlacement());
    expect(result.current).toBe("pinned");
  });

  it("an unknown stored value coerces to the declared default (validation via the option list) → inline", () => {
    setUI({ theme: "cosmos", themeSettings: {} });
    setThemeSetting("cosmos", "planPlacement", "not-a-placement");
    const { result } = renderHook(() => usePlanPlacement());
    expect(result.current).toBe("inline");
  });
});

describe("usePlanOpenAutoClose", () => {
  const plan: Plan = { steps: [{ text: "step one", status: "pending" }] };

  it("closes the shared open flag when the plan goes to null", () => {
    setPlanSheetOpen(true);
    const { rerender } = renderHook<void, { p: Plan | null }>(({ p }) => usePlanOpenAutoClose(p), {
      initialProps: { p: plan },
    });
    // a live plan leaves the flag alone
    expect(renderHook(() => usePlanSheetOpen()).result.current).toBe(true);
    rerender({ p: null });
    expect(renderHook(() => usePlanSheetOpen()).result.current).toBe(false);
  });

  it("leaves an open flag alone while a live plan is present", () => {
    setPlanSheetOpen(true);
    renderHook(() => usePlanOpenAutoClose(plan));
    expect(renderHook(() => usePlanSheetOpen()).result.current).toBe(true);
  });
});
