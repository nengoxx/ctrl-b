import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ALL_LAYOUTS,
  HOSTED_UTILS_GROUP_ID,
  LAYOUT_PRESETS,
  partitionSections,
  resolveLayout,
} from "../../src/theme-engine/layout";
import { registeredThemes } from "../../src/theme-engine/registry";
import { STANDARD_TABS } from "../../src/theme-engine/tabs";
import type { LayoutPreset, TabDef } from "../../src/theme-engine/types";

// theme-engine/layout — the SECTION LAYOUT SYSTEM v1 (D35 / FRONTIER_PLAN §6-F0): the curated presets, the
// warn-first layout-coercion resolver (a global lever resolved against a per-theme capability set), and the
// pure partition. `resolveLayout` reads the REAL registry at call time; `partitionSections` is pure.
//
// ⚠ MODULE-LEVEL STATE: `resolveLayout`'s one-time-warn `warned` Set persists across the tests in THIS file.
// Since D51 V6 NO registered theme restricts `layouts` (vapor's `["4-tab"]` waiver retired), so the
// real-registry block below can no longer trigger a coercion warn at all — every warn assertion, including
// the one-time DEDUPE, lives in the ISOLATED-module block (`vi.resetModules` + `vi.doMock` on the registry,
// the switchTheme.test.ts / App.test.tsx precedent), which gets a FRESH `warned` Set per test.

describe("LAYOUT_PRESETS + constants", () => {
  it("declares the curated 4-/3-/2-tab presets (bar count + hosted utils→conf)", () => {
    // 4-tab = today: all four on the bar, nothing hosted.
    expect(LAYOUT_PRESETS["4-tab"].bar).toEqual(["fleet", "agent", "utils", "conf"]);
    expect(LAYOUT_PRESETS["4-tab"].hosted).toBeUndefined();
    // 3-tab = a bar of three + utils hosted inside conf.
    expect(LAYOUT_PRESETS["3-tab"].bar).toEqual(["fleet", "agent", "conf"]);
    expect(LAYOUT_PRESETS["3-tab"].hosted).toEqual({ utils: "conf" });
    // 2-tab = a bar of two + utils still hosted in conf (conf itself falls off-bar → the menu).
    expect(LAYOUT_PRESETS["2-tab"].bar).toEqual(["fleet", "agent"]);
    expect(LAYOUT_PRESETS["2-tab"].hosted).toEqual({ utils: "conf" });
  });

  it("ALL_LAYOUTS is the widest→narrowest ordering", () => {
    expect(ALL_LAYOUTS).toEqual(["4-tab", "3-tab", "2-tab"]);
  });

  it("HOSTED_UTILS_GROUP_ID is a non-empty shared constant (one source, no string dup)", () => {
    expect(typeof HOSTED_UTILS_GROUP_ID).toBe("string");
    expect(HOSTED_UTILS_GROUP_ID.length).toBeGreaterThan(0);
  });
});

describe("resolveLayout (real registry)", () => {
  it("`auto` adopts the theme's declared default (vapor → 4-tab, frontier → 3-tab)", () => {
    // vapor's `defaultLayout` survived its `layouts` waiver's V6 retirement: four tabs is vapor's NATIVE
    // shape (what `auto` should land on), which is a different claim from "four tabs is all it can do".
    expect(resolveLayout("vapor", "auto")).toBe("4-tab");
    expect(resolveLayout("frontier", "auto")).toBe("3-tab");
  });

  it("an unregistered/omitted theme resolves `auto` to the 4-tab fallback", () => {
    // "phosphor" is in the ThemeId union but NOT registered → no ThemeDef → supported = ALL_LAYOUTS,
    // rawDefault = "4-tab" (the omitted-default fallback).
    expect(resolveLayout("phosphor", "auto")).toBe("4-tab");
  });

  it("a theme that omits `layouts` (supports all) honors any explicit pick", () => {
    // minimal declares no `layouts` → supports every preset; an unregistered id likewise.
    expect(resolveLayout("minimal", "3-tab")).toBe("3-tab");
    expect(resolveLayout("minimal", "2-tab")).toBe("2-tab");
    expect(resolveLayout("minimal", "4-tab")).toBe("4-tab");
    expect(resolveLayout("phosphor", "2-tab")).toBe("2-tab"); // omitted layouts → honored, not coerced
  });

  it("EVERY registered theme honors every preset — no theme restricts `layouts` (D51 V6)", () => {
    // The end-state assertion the vapor waiver's retirement earns (D51 V6 / R13). vapor used to be the one
    // restriction (`layouts: ["4-tab"]`, which bounced a 3-/2-tab pick back to four); it now consumes the
    // shared registry/presets like every other kit theme, so a pick is a pick everywhere. A theme that
    // re-adds a `layouts` restriction fails HERE, with the reason — it is a capability regression, not a
    // detail: it silently overrides the user's Conf → Layout choice.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    for (const { id } of registeredThemes()) {
      for (const preset of ALL_LAYOUTS) {
        expect(
          resolveLayout(id, preset),
          `theme "${id}" coerced the "${preset}" pick — it declares a restricted ThemeDef.layouts. Since ` +
            `D51 V6 no theme restricts the set (the D35 ideal, "themes default, never restrict"); a theme ` +
            `that genuinely cannot express a preset needs an explicit ruling before re-adding the field.`,
        ).toBe(preset);
      }
    }
    // …and therefore nothing warned: a coercion warn IS the restriction's fingerprint.
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("heals a garbage/unknown persisted lever to the theme default instead of crashing (audit F0#1)", () => {
    // The persist loader's defaults-merge passes any stored `layout` string through UNTYPED — a rolled-back
    // newer preset id or hand-edited localStorage reaches resolveLayout at render time. It must heal, not
    // deref LAYOUT_PRESETS[garbage].bar (the pre-fix TypeError took down the whole render tree at boot).
    expect(resolveLayout("minimal", "1-tab" as never)).toBe("4-tab"); // unknown id → theme default
    expect(resolveLayout("vapor", "" as never)).toBe("4-tab");
    expect(resolveLayout("minimal", "garbage" as never)).toBe("4-tab");
  });
});

describe("resolveLayout — nearest-supported math (isolated module, mocked registry)", () => {
  // The real registry can't exercise "tie → the larger tab count" (vapor is a single-entry set; minimal/
  // unregistered support all → no coercion). Mock the registry for a FRESH `layout` module — same precedent
  // as switchTheme.test.ts / App.test.tsx — with synthetic capability sets. The isolated module carries its
  // own `warned` Set, so warn assertions here are independent of the real-registry block above.
  //   phosphor    → supports {4-tab, 2-tab}, default 4-tab (valid)
  //   observatory → supports {3-tab, 2-tab}, default 3-tab (valid)
  //   frontier    → supports {3-tab, 2-tab}, default 4-tab (deliberately OUTSIDE its own set → auto coerces)
  beforeEach(() => {
    vi.resetModules();
    vi.doMock("../../src/theme-engine/registry", () => ({
      registry: {
        phosphor: { id: "phosphor", layouts: ["4-tab", "2-tab"], defaultLayout: "4-tab" },
        observatory: { id: "observatory", layouts: ["3-tab", "2-tab"], defaultLayout: "3-tab" },
        frontier: { id: "frontier", layouts: ["3-tab", "2-tab"], defaultLayout: "4-tab" },
      },
    }));
  });
  // vi.doMock isn't undone by clearMocks/restoreMocks; unmock + reset so the real-registry block (and any
  // later file) sees the genuine module graph again.
  afterEach(() => {
    vi.doUnmock("../../src/theme-engine/registry");
    vi.resetModules();
  });

  it("warns ONCE per (theme, lever) — the one-time dev-console line, deduped", async () => {
    // Moved here from the real-registry block at D51 V6: with vapor's waiver retired NO real theme coerces,
    // so the dedupe can only be exercised against the mocked capability sets. The isolated module carries a
    // virgin `warned` Set (fresh per `beforeEach`), which is what makes the counts assertable.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { resolveLayout: resolve } = await import("../../src/theme-engine/layout");

    expect(resolve("observatory", "4-tab")).toBe("3-tab");
    expect(warn).toHaveBeenCalledTimes(1); // first "observatory:4-tab" → one line

    // A SECOND identical call is deduped by the module-level `warned` Set — no second warn.
    expect(resolve("observatory", "4-tab")).toBe("3-tab");
    expect(warn).toHaveBeenCalledTimes(1);

    // A DIFFERENT lever key ("phosphor:3-tab") warns again (once).
    expect(resolve("phosphor", "3-tab")).toBe("4-tab");
    expect(warn).toHaveBeenCalledTimes(2);

    warn.mockRestore();
  });

  it("breaks a distance tie toward the LARGER tab count", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { resolveLayout: resolve } = await import("../../src/theme-engine/layout");
    // "3-tab" is equidistant from 4-tab and 2-tab (|4-3| = |2-3| = 1) → tie → the larger count (4-tab).
    expect(resolve("phosphor", "3-tab")).toBe("4-tab");
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("picks the strictly-closer preset when there is no tie", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { resolveLayout: resolve } = await import("../../src/theme-engine/layout");
    // {3-tab, 2-tab} + pick "4-tab": |3-4|=1 < |2-4|=2 → nearest is 3-tab.
    expect(resolve("observatory", "4-tab")).toBe("3-tab");
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("coerces `auto` when a theme mis-declares a default outside its own supported set", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { resolveLayout: resolve } = await import("../../src/theme-engine/layout");
    // frontier's default "4-tab" isn't in {3-tab, 2-tab} → the default itself coerces to the nearest (3-tab).
    expect(resolve("frontier", "auto")).toBe("3-tab");
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});

describe("partitionSections (pure)", () => {
  // fleet, agent, utils, conf + `agents` — which no preset's bar names (D70 §8.4: the presets are
  // the CURATED bar and the Conf picker labels them with that literal count), so the gallery is
  // off-bar-and-unhosted under every one of them and lands in the menu. That is the assertion each
  // case below carries now.
  const defs = STANDARD_TABS;
  const ids = (list: TabDef[]) => list.map((d) => d.id);

  it("4-tab / not-minimal → the full bar, empty menu, no hosting", () => {
    const { bar, menu, hosted } = partitionSections(defs, LAYOUT_PRESETS["4-tab"], false);
    expect(ids(bar)).toEqual(["fleet", "agent", "utils", "conf"]);
    expect(ids(menu)).toEqual(["agents"]); // the gallery: off-bar under every preset
    expect(hosted).toEqual({});
  });

  it("3-tab → bar of three, utils hosted in conf, the gallery in the menu", () => {
    const { bar, menu, hosted } = partitionSections(defs, LAYOUT_PRESETS["3-tab"], false);
    expect(ids(bar)).toEqual(["fleet", "agent", "conf"]);
    expect(ids(menu)).toEqual(["agents"]); // utils is hosted (not menu); conf is on-bar
    expect(hosted).toEqual({ utils: "conf" });
  });

  it("2-tab → bar of two, conf + the gallery in the menu, utils hosted in conf", () => {
    const { bar, menu, hosted } = partitionSections(defs, LAYOUT_PRESETS["2-tab"], false);
    expect(ids(bar)).toEqual(["fleet", "agent"]);
    expect(ids(menu)).toEqual(["conf", "agents"]); // off-bar AND unhosted, in def order
    expect(hosted).toEqual({ utils: "conf" });
  });

  it("appbarMinimal=true → empty bar; every UNHOSTED def falls to the menu (def order), hosting passes through", () => {
    // 4-tab preset + minimal: nothing hosted → all four in the menu.
    const four = partitionSections(defs, LAYOUT_PRESETS["4-tab"], true);
    expect(four.bar).toEqual([]);
    expect(ids(four.menu)).toEqual(["fleet", "agent", "utils", "conf", "agents"]);
    expect(four.hosted).toEqual({});

    // 3-tab preset + minimal: the effective bar is [] but hosting still supersedes the menu → utils excluded.
    const three = partitionSections(defs, LAYOUT_PRESETS["3-tab"], true);
    expect(three.bar).toEqual([]);
    expect(ids(three.menu)).toEqual(["fleet", "agent", "conf", "agents"]); // utils hosted → not in the menu
    expect(three.hosted).toEqual({ utils: "conf" }); // passthrough
  });

  it("a preset naming an id the theme lacks is skipped without error", () => {
    const partial: TabDef[] = [
      { id: "fleet", glyph: "◆", lbl: "fleet", hasComposer: true },
      { id: "agent", glyph: "▲", lbl: "chat", hasComposer: true },
    ];
    // 4-tab's bar names utils + conf, which `partial` doesn't declare → they're simply skipped.
    const { bar, menu, hosted } = partitionSections(partial, LAYOUT_PRESETS["4-tab"], false);
    expect(ids(bar)).toEqual(["fleet", "agent"]);
    expect(menu).toEqual([]);
    expect(hosted).toEqual({});
  });

  it("defs not named by the preset land in the menu (off-bar-and-unhosted)", () => {
    const onlyFleet: LayoutPreset = { bar: ["fleet"] };
    const { bar, menu } = partitionSections(defs, onlyFleet, false);
    expect(ids(bar)).toEqual(["fleet"]);
    expect(ids(menu)).toEqual(["agent", "utils", "conf", "agents"]); // everything the bar omits, in def order
  });
});
