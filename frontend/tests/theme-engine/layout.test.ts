import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ALL_LAYOUTS,
  HOSTED_UTILS_GROUP_ID,
  LAYOUT_PRESETS,
  partitionSections,
  resolveLayout,
} from "../../src/theme-engine/layout";
import { STANDARD_TABS } from "../../src/theme-engine/tabs";
import type { LayoutPreset, TabDef } from "../../src/theme-engine/types";

// theme-engine/layout — the SECTION LAYOUT SYSTEM v1 (D35 / FRONTIER_PLAN §6-F0): the curated presets, the
// warn-first layout-coercion resolver (a global lever resolved against a per-theme capability set), and the
// pure partition. `resolveLayout` reads the REAL registry at call time (vapor waivers to `["4-tab"]`, minimal
// omits `layouts` → supports all, an unregistered id → falls to ALL_LAYOUTS); `partitionSections` is pure.
//
// ⚠ MODULE-LEVEL STATE: `resolveLayout`'s one-time-warn `warned` Set persists across the tests in THIS file.
// So the ONLY test that coerces a real theme (vapor) is the dedupe test below — no other case triggers a warn
// on the real registry, so its first assertion is guaranteed to see a virgin `${theme}:${lever}` key. The
// nearest-math cases run against an ISOLATED module (`vi.resetModules` + `vi.doMock` on the registry, the
// switchTheme.test.ts / App.test.tsx precedent), which gets its OWN fresh `warned` Set.

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
  it("`auto` adopts the theme's declared default (vapor → 4-tab)", () => {
    expect(resolveLayout("vapor", "auto")).toBe("4-tab");
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

  it("coerces an unsupported pick to the nearest supported preset, warning ONCE per (theme, lever)", () => {
    // THE only real-registry coercion in this file (see the module-level-state note at the top). vapor's
    // waiver `layouts:["4-tab"]` coerces every 3-/2-tab pick back to 4-tab.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    expect(resolveLayout("vapor", "2-tab")).toBe("4-tab");
    expect(warn).toHaveBeenCalledTimes(1); // first "vapor:2-tab" → one dev-console line

    // A SECOND identical call is deduped by the module-level `warned` Set — no second warn.
    expect(resolveLayout("vapor", "2-tab")).toBe("4-tab");
    expect(warn).toHaveBeenCalledTimes(1);

    // A DIFFERENT lever key ("vapor:3-tab") warns again (once).
    expect(resolveLayout("vapor", "3-tab")).toBe("4-tab");
    expect(warn).toHaveBeenCalledTimes(2);

    warn.mockRestore();
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
  const defs = STANDARD_TABS; // fleet, agent, utils, conf
  const ids = (list: TabDef[]) => list.map((d) => d.id);

  it("4-tab / not-minimal → the full bar, empty menu, no hosting", () => {
    const { bar, menu, hosted } = partitionSections(defs, LAYOUT_PRESETS["4-tab"], false);
    expect(ids(bar)).toEqual(["fleet", "agent", "utils", "conf"]);
    expect(menu).toEqual([]);
    expect(hosted).toEqual({});
  });

  it("3-tab → bar of three, empty menu, utils hosted in conf", () => {
    const { bar, menu, hosted } = partitionSections(defs, LAYOUT_PRESETS["3-tab"], false);
    expect(ids(bar)).toEqual(["fleet", "agent", "conf"]);
    expect(menu).toEqual([]); // utils is hosted (not menu); conf is on-bar
    expect(hosted).toEqual({ utils: "conf" });
  });

  it("2-tab → bar of two, conf in the menu, utils hosted in conf", () => {
    const { bar, menu, hosted } = partitionSections(defs, LAYOUT_PRESETS["2-tab"], false);
    expect(ids(bar)).toEqual(["fleet", "agent"]);
    expect(ids(menu)).toEqual(["conf"]); // off-bar AND unhosted
    expect(hosted).toEqual({ utils: "conf" });
  });

  it("appbarMinimal=true → empty bar; every UNHOSTED def falls to the menu (def order), hosting passes through", () => {
    // 4-tab preset + minimal: nothing hosted → all four in the menu.
    const four = partitionSections(defs, LAYOUT_PRESETS["4-tab"], true);
    expect(four.bar).toEqual([]);
    expect(ids(four.menu)).toEqual(["fleet", "agent", "utils", "conf"]);
    expect(four.hosted).toEqual({});

    // 3-tab preset + minimal: the effective bar is [] but hosting still supersedes the menu → utils excluded.
    const three = partitionSections(defs, LAYOUT_PRESETS["3-tab"], true);
    expect(three.bar).toEqual([]);
    expect(ids(three.menu)).toEqual(["fleet", "agent", "conf"]); // utils hosted → not in the menu
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
    expect(ids(menu)).toEqual(["agent", "utils", "conf"]); // everything the bar omits, in def order
  });
});
