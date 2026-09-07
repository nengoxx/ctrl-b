import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { useSections } from "../../src/hooks/useSections";
import {
  clearGroupScrollTarget,
  getGroupScrollTarget,
  setGroupScrollTarget,
} from "../../src/store/groupScroll";
import { setUI } from "../../src/store/ui";
import { HOSTED_AGENTS_GROUP_ID, HOSTED_UTILS_GROUP_ID } from "../../src/theme-engine/layout";

// hooks/useSections — the navigation controller (D29 §14.2 / D35 §F0). It exposes the active theme's section
// list + the layout partitions (bar/menu/hosted/layout) + the active section + navigate + `hasComposer`
// (which replaced the old `tab==='fleet'||'agent'` hardcode and the core `.no-composer` write). Drives the
// real `ui` + `groupScroll` stores so the wiring is end-to-end.

beforeEach(() => {
  // module state persists between cases → reset every lever this file touches (theme/tab/layout/appbar/the
  // D70 §8.4a satellite placements) + the transient scroll-handoff store.
  setUI({
    theme: "vapor",
    tab: "fleet",
    layout: "auto",
    appbarMode: "visible",
    sectionPlacement: {},
  });
  clearGroupScrollTarget();
});

describe("useSections", () => {
  it("exposes vapor's sections + the active one + its composer flag", () => {
    const { result } = renderHook(() => useSections());
    // Five since D70 §8.4 — the agents gallery is a section like any other; it simply stands off-bar.
    expect(result.current.sections.map((s) => s.id)).toEqual([
      "fleet",
      "agent",
      "utils",
      "conf",
      "agents",
    ]);
    expect(result.current.active).toBe("fleet");
    expect(result.current.hasComposer).toBe(true); // fleet has a composer
  });

  it("defaults (vapor, layout auto): the bar is the curated four; the gallery is HOSTED in Conf", () => {
    const { result } = renderHook(() => useSections());
    expect(result.current.layout).toBe("4-tab"); // vapor's declared DEFAULT (not a restriction — D51 V6)
    expect(result.current.bar.map((s) => s.id)).toEqual(["fleet", "agent", "utils", "conf"]);
    // D70 §8.4a — no preset's bar names `agents` (the preset NAMES are the bar count the Conf picker
    // prints); it is a SATELLITE, and its default placement is `conf`. Hosting supersedes the menu, so
    // the affordance carries nothing at all and the menu is empty — the owner's "hidden by default".
    expect(result.current.menu.map((s) => s.id)).toEqual([]);
    expect(result.current.hosted).toEqual({ agents: "conf" });
    expect(result.current.placementKey).toBe("agents:conf");
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
    expect(result.current.menu.map((s) => s.id)).toEqual([]); // utils hosted, conf on-bar, agents hosted
    expect(result.current.hosted).toEqual({ utils: "conf", agents: "conf" });
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
    expect(result.current.hosted).toEqual({ utils: "conf", agents: "conf" });
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
    expect(result.current.hosted).toEqual({ utils: "conf", agents: "conf" });

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

  // ── the SAME-TAB guard (G6.3, owner device round) — re-tapping the active tab must not re-run the
  //    navigation transition. Under gacha `runNavTransition` starts a real root View Transition, so an
  //    unguarded same-tab tap replayed the cross-fade over a screen that never changed.
  it("navigate(active id) still disarms a stale scroll target, and leaves the section alone", () => {
    const { result } = renderHook(() => useSections());
    expect(result.current.active).toBe("fleet");
    act(() => setGroupScrollTarget(HOSTED_UTILS_GROUP_ID)); // a stale handoff is still cleared…
    act(() => result.current.navigate("fleet")); // …and that is ALL a same-tab tap does
    expect(result.current.active).toBe("fleet");
    expect(getGroupScrollTarget()).toBeNull();
  });

  it("navigate(active id) under gacha does NOT run the nav transition (the replayed cross-fade)", () => {
    setUI({ theme: "gacha", tab: "fleet", motion: "full" });
    const { result } = renderHook(() => useSections());
    const started: (() => void)[] = [];
    // The structural shape `runViewTransition` actually calls (lib.dom's `ViewTransition` carries members
    // the wrapper never touches) — the same minimal-typing stance viewTransition.ts itself takes.
    const doc = document as unknown as { startViewTransition?: (cb: () => void) => unknown };
    const prev = doc.startViewTransition;
    doc.startViewTransition = (cb: () => void) => {
      started.push(cb);
      cb();
      return { ready: Promise.resolve(), finished: Promise.resolve() };
    };
    try {
      act(() => result.current.navigate("fleet")); // same tab → no transition at all
      expect(started).toHaveLength(0);
      act(() => result.current.navigate("agent")); // a real move → exactly one
      expect(started).toHaveLength(1);
    } finally {
      doc.startViewTransition = prev; // jsdom has none, so this restores "absent" too
    }
  });

  it("appbarMode 'minimal' → empty bar; the menu lists the unhosted sections", () => {
    setUI({ appbarMode: "minimal" }); // vapor, 4-tab → only the satellite is hosted
    const { result } = renderHook(() => useSections());
    expect(result.current.bar).toEqual([]);
    expect(result.current.menu.map((s) => s.id)).toEqual(["fleet", "agent", "utils", "conf"]);
  });

  // ── SATELLITE PLACEMENT (D70 §8.4a) — the lever composed over the resolved preset. The pure
  //    composition has its own unit suite (theme-engine/layout.test.ts); these pin what the CONTROLLER
  //    hands its consumers in each state, including the nav chokepoint's hosted branch.
  describe("satellite placement (D70 §8.4a)", () => {
    it("`button` → off-bar and unhosted: the menu affordance carries the gallery", () => {
      setUI({ sectionPlacement: { agents: "button" } });
      const { result } = renderHook(() => useSections());
      expect(result.current.bar.map((s) => s.id)).toEqual(["fleet", "agent", "utils", "conf"]);
      expect(result.current.menu.map((s) => s.id)).toEqual(["agents"]);
      expect(result.current.hosted).toEqual({});
      expect(result.current.placementKey).toBe("agents:button");
    });

    it("`tab` → spliced onto the bar right AFTER chat, and out of both other buckets", () => {
      setUI({ sectionPlacement: { agents: "tab" } });
      const { result } = renderHook(() => useSections());
      expect(result.current.bar.map((s) => s.id)).toEqual([
        "fleet",
        "agent",
        "agents",
        "utils",
        "conf",
      ]);
      expect(result.current.menu).toEqual([]);
      expect(result.current.hosted).toEqual({});
    });

    it("`tab` under appbarMode minimal degrades to the menu with everything else (no special case)", () => {
      setUI({ sectionPlacement: { agents: "tab" }, appbarMode: "minimal" });
      const { result } = renderHook(() => useSections());
      expect(result.current.bar).toEqual([]);
      expect(result.current.menu.map((s) => s.id)).toEqual([
        "fleet",
        "agent",
        "utils",
        "conf",
        "agents",
      ]);
    });

    it("a MALFORMED persisted placement heals to the default (the lever's parse-don't-validate stance)", () => {
      setUI({ sectionPlacement: { agents: "sidebar" as never } });
      const { result } = renderHook(() => useSections());
      expect(result.current.hosted).toEqual({ agents: "conf" });
      expect(result.current.placementKey).toBe("agents:conf");
    });

    it("navigate(agents) under the `conf` default lands on Conf + arms the GALLERY's group", () => {
      const { result } = renderHook(() => useSections());
      act(() => result.current.navigate("agents"));
      expect(result.current.active).toBe("conf");
      // The hosted-id → group-id map, not the one utils constant it used to be.
      expect(getGroupScrollTarget()).toBe(HOSTED_AGENTS_GROUP_ID);
      expect(HOSTED_AGENTS_GROUP_ID).not.toBe(HOSTED_UTILS_GROUP_ID);
    });

    it("navigate(agents) under `button`/`tab` is an ordinary navigation (no coercion, no handoff)", () => {
      for (const placement of ["button", "tab"] as const) {
        setUI({ sectionPlacement: { agents: placement }, tab: "fleet" });
        const { result, unmount } = renderHook(() => useSections());
        act(() => result.current.navigate("agents"));
        expect(result.current.active, placement).toBe("agents");
        expect(getGroupScrollTarget(), placement).toBeNull();
        unmount();
      }
    });
  });
});
