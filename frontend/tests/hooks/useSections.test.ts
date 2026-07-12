import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { useSections } from "../../src/hooks/useSections";
import {
  clearGroupScrollTarget,
  getGroupScrollTarget,
  setGroupScrollTarget,
} from "../../src/store/groupScroll";
import { setUI } from "../../src/store/ui";
import { HOSTED_UTILS_GROUP_ID } from "../../src/theme-engine/layout";

// hooks/useSections — the navigation controller (D29 §14.2 / D35 §F0). It exposes the active theme's section
// list + the layout partitions (bar/menu/hosted/layout) + the active section + navigate + `hasComposer`
// (which replaced the old `tab==='fleet'||'agent'` hardcode and the core `.no-composer` write). Drives the
// real `ui` + `groupScroll` stores so the wiring is end-to-end.

beforeEach(() => {
  // module state persists between cases → reset every lever this file touches (theme/tab/layout/appbar) + the
  // transient scroll-handoff store.
  setUI({ theme: "vapor", tab: "fleet", layout: "auto", appbarMode: "visible" });
  clearGroupScrollTarget();
});

describe("useSections", () => {
  it("exposes vapor's 4 sections + the active one + its composer flag", () => {
    const { result } = renderHook(() => useSections());
    expect(result.current.sections.map((s) => s.id)).toEqual(["fleet", "agent", "utils", "conf"]);
    expect(result.current.active).toBe("fleet");
    expect(result.current.hasComposer).toBe(true); // fleet has a composer
  });

  it("defaults (vapor, layout auto) are render-identical to the old shape: bar = all four, menu/hosted empty", () => {
    const { result } = renderHook(() => useSections());
    expect(result.current.layout).toBe("4-tab"); // vapor's waivered default
    expect(result.current.bar.map((s) => s.id)).toEqual(["fleet", "agent", "utils", "conf"]);
    expect(result.current.menu).toEqual([]);
    expect(result.current.hosted).toEqual({});
  });

  it("navigate() switches the active section and re-derives hasComposer", () => {
    const { result } = renderHook(() => useSections());
    act(() => result.current.navigate("conf"));
    expect(result.current.active).toBe("conf");
    expect(result.current.hasComposer).toBe(false); // conf has no composer

    act(() => result.current.navigate("agent"));
    expect(result.current.active).toBe("agent");
    expect(result.current.hasComposer).toBe(true);
  });

  it("under a 3-tab layout, navigate(hosted id) coerces to the host + arms the scroll-to-group handoff", () => {
    // minimal supports all presets → "3-tab" is honored → utils is hosted in conf.
    setUI({ theme: "minimal", layout: "3-tab" });
    const { result } = renderHook(() => useSections());
    expect(result.current.hosted).toEqual({ utils: "conf" });

    act(() => result.current.navigate("utils"));
    expect(result.current.active).toBe("conf"); // landed on the host, not utils
    expect(getGroupScrollTarget()).toBe(HOSTED_UTILS_GROUP_ID); // scroll-to-group armed
  });

  it("navigate(unhosted id) DISARMS a stale scroll-to-group target (the review fix)", () => {
    const { result } = renderHook(() => useSections());
    // Arm a handoff (as if a coerced hosted navigate had, but the user then tapped away mid-load).
    act(() => setGroupScrollTarget(HOSTED_UTILS_GROUP_ID));
    expect(getGroupScrollTarget()).toBe(HOSTED_UTILS_GROUP_ID);

    act(() => result.current.navigate("fleet")); // an ordinary (unhosted) navigation
    expect(result.current.active).toBe("fleet");
    expect(getGroupScrollTarget()).toBeNull(); // stale target cleared
  });

  it("appbarMode 'minimal' → empty bar; the menu lists the unhosted sections", () => {
    setUI({ appbarMode: "minimal" }); // vapor, 4-tab → nothing hosted
    const { result } = renderHook(() => useSections());
    expect(result.current.bar).toEqual([]);
    expect(result.current.menu.map((s) => s.id)).toEqual(["fleet", "agent", "utils", "conf"]);
  });
});
