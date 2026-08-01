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
    expect(result.current.layout).toBe("4-tab"); // vapor's declared DEFAULT (not a restriction — D51 V6)
    expect(result.current.bar.map((s) => s.id)).toEqual(["fleet", "agent", "utils", "conf"]);
    expect(result.current.menu).toEqual([]);
    expect(result.current.hosted).toEqual({});
  });

  // ── vapor at 3-/2-tab — the REAL partition tests that replaced the forced-four-tab waiver assertions
  //    (D51 V6 / R13, Codex #11: "kit chrome alone does not make it just work" → prove it does). vapor's
  //    only per-theme piece here is the Root-pinned FleetTab BODY, and `fleet` is on the bar in every
  //    preset — so what these pin is that the relocation vapor now honors is the same one minimal gets.
  it("vapor · 3-tab: the pick is HONORED (no coercion) — bar of three, utils hosted in Conf", () => {
    setUI({ layout: "3-tab" }); // theme is vapor (beforeEach)
    const { result } = renderHook(() => useSections());
    expect(result.current.layout).toBe("3-tab"); // ← the waiver would have bounced this to "4-tab"
    expect(result.current.bar.map((s) => s.id)).toEqual(["fleet", "agent", "conf"]);
    expect(result.current.menu).toEqual([]); // utils is hosted, conf is on-bar
    expect(result.current.hosted).toEqual({ utils: "conf" });
  });

  it("vapor · 3-tab: navigate(utils) lands on Conf + arms the scroll-to-group handoff", () => {
    setUI({ layout: "3-tab" });
    const { result } = renderHook(() => useSections());
    act(() => result.current.navigate("utils"));
    expect(result.current.active).toBe("conf");
    expect(result.current.hasComposer).toBe(false); // the HOST's flag, not the hosted section's
    expect(getGroupScrollTarget()).toBe(HOSTED_UTILS_GROUP_ID);
  });

  it("vapor · 2-tab: bar of two, conf falls to the menu, utils still hosted — and Fleet stays on-bar", () => {
    setUI({ layout: "2-tab" });
    const { result } = renderHook(() => useSections());
    expect(result.current.layout).toBe("2-tab");
    expect(result.current.bar.map((s) => s.id)).toEqual(["fleet", "agent"]);
    expect(result.current.menu.map((s) => s.id)).toEqual(["conf"]); // off-bar AND unhosted
    expect(result.current.hosted).toEqual({ utils: "conf" });
    // The Root-pinned VaporFleet's section is on the bar under EVERY preset — the reason vapor's bespoke
    // body override is preset-independent and needed no waiver.
    expect(result.current.bar[0].id).toBe("fleet");
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
