import { describe, expect, it } from "vitest";

import { gacha } from "../../src/themes/gacha";
import { applicableNs, MEDIA_NS, type MediaNsDef } from "../../src/theme-engine/mediaRegistry";
import { registeredThemes } from "../../src/theme-engine/registry";
import type { ThemeDef } from "../../src/theme-engine/types";

// The front-end media registry (D53 / MEDIA_PLAN §5's inversion). What `applicableNs` decides is which
// galleries the Conf tab renders, and the two ways to get that wrong are opposite: rendering a gallery whose
// index would 404, or hiding one that belongs to no theme (the draft bug — gating on `ThemeDef.media` made
// the `kit` row unreachable under vapor/cosmos/minimal while their rows painted icons from it).

const def = (over: Partial<ThemeDef>): ThemeDef => ({ id: "gacha", ...over }) as ThemeDef;

const ROWS: Record<string, MediaNsDef> = {
  themed: { title: "Theme art", roles: {} },
  shared: { title: "Service icons", alwaysOn: true, roles: {} },
};

describe("applicableNs", () => {
  it("renders the active theme's own namespace", () => {
    expect(applicableNs(gacha)).toEqual(["gacha"]);
  });

  it("renders nothing for a theme that links none, and nothing with no theme at all", () => {
    expect(applicableNs(def({ media: undefined }))).toEqual([]);
    expect(applicableNs(undefined)).toEqual([]);
  });

  it("a link naming a namespace the registry does not hold renders NOTHING", () => {
    // The gallery's first act is to fetch `/api/media/<ns>`; a section that can only ever say "media index
    // unreachable" is worse than no section.
    expect(applicableNs(def({ media: { ns: "nope" } }))).toEqual([]);
  });

  it("an ALWAYS-ON row renders beside the theme's own — and for a theme that links nothing", () => {
    // The mechanism the `kit` service-icon row needs (M3): it belongs to no theme, so it cannot be reached
    // through a ThemeDef link. Exercised against an injected registry because the live one holds exactly one
    // row until that slice lands.
    expect(applicableNs(def({ media: { ns: "themed" } }), ROWS)).toEqual(["themed", "shared"]);
    expect(applicableNs(def({ media: undefined }), ROWS)).toEqual(["shared"]);
  });

  it("holds exactly the gacha row today — every other theme sees no gallery", () => {
    // The row count is the slice fence (M1b): `kit` has no BACKEND namespace yet, so declaring its row here
    // would render a gallery whose index 404s.
    expect(Object.keys(MEDIA_NS)).toEqual(["gacha"]);
    for (const theme of registeredThemes()) {
      expect(applicableNs(theme)).toEqual(theme.id === "gacha" ? ["gacha"] : []);
    }
  });
});

describe("the gacha row", () => {
  it("describes every role folder the backend registry declares, and prices them all as full-bleed art", () => {
    // The two registries mirror each other: a role the server lists with no row here would render hintless
    // and unbounded. (The server's list is `GACHA_ROLES` in core/media.py.)
    expect(Object.keys(MEDIA_NS.gacha.roles)).toEqual([
      "characters",
      "banner",
      "wallpaper",
      "reel",
      "oracle",
    ]);
    for (const role of Object.values(MEDIA_NS.gacha.roles)) {
      expect(role.kind).toBe("pool");
      // G5's server-side WARN_BYTES/WARN_PIXELS, moved here whole when the policy went client-side.
      expect(role.bounds).toEqual({ bytes: 1_500_000, pixels: 4_000_000 });
    }
  });

  it("offers every pin the backend registry accepts, each sourced from a real role", () => {
    const slots = MEDIA_NS.gacha.slots ?? [];
    expect(slots.map((s) => s.key)).toEqual(["wallpaper", "hero", "oracle", "reel_figure"]);
    for (const slot of slots) expect(MEDIA_NS.gacha.roles[slot.from]).toBeDefined();
    // The ruled shape (Codex F4): the figure's options come from the REEL role, never the cast.
    expect(slots.find((s) => s.key === "reel_figure")?.from).toBe("reel");
  });
});
