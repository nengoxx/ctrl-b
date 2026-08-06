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
  // Against the LIVE registry, which since M3 holds the always-on `kit` row — so every expectation here
  // is "the theme's own namespace, then kit". The mechanism itself is exercised against an injected
  // registry below, where the two axes can be varied independently.
  it("renders the active theme's own namespace", () => {
    expect(applicableNs(gacha)).toEqual(["gacha", "kit"]);
  });

  it("renders only the always-on row for a theme that links none, and with no theme at all", () => {
    expect(applicableNs(def({ media: undefined }))).toEqual(["kit"]);
    expect(applicableNs(undefined)).toEqual(["kit"]);
  });

  it("a link naming a namespace the registry does not hold adds NOTHING", () => {
    // The gallery's first act is to fetch `/api/media/<ns>`; a section that can only ever say "media index
    // unreachable" is worse than no section.
    expect(applicableNs(def({ media: { ns: "nope" } }))).toEqual(["kit"]);
  });

  it("an ALWAYS-ON row renders beside the theme's own — and for a theme that links nothing", () => {
    // The mechanism the `kit` service-icon row needs (M3): it belongs to no theme, so it cannot be reached
    // through a ThemeDef link. Exercised against an injected registry because the live one holds exactly one
    // row until that slice lands.
    expect(applicableNs(def({ media: { ns: "themed" } }), ROWS)).toEqual(["themed", "shared"]);
    expect(applicableNs(def({ media: undefined }), ROWS)).toEqual(["shared"]);
  });

  it("holds the two art namespaces plus the always-on kit row — and EVERY theme sees the kit one", () => {
    expect(Object.keys(MEDIA_NS)).toEqual(["gacha", "frontier", "kit"]);
    // Every LINK a registered theme declares must resolve to a row — a theme linking a namespace this
    // registry does not hold would silently lose its gallery. Since M3 every theme also gets `kit`,
    // including the three that link nothing: their service rows paint icons from it, so the gallery that
    // says what to NAME those files has to be reachable from under them (the draft bug, Opus H2).
    for (const theme of registeredThemes()) {
      expect(applicableNs(theme)).toEqual([...(theme.media ? [theme.media.ns] : []), "kit"]);
    }
  });
});

describe("the kit row (D53 M3 + the Kit Art System)", () => {
  it("is ALWAYS-ON and holds the four role folders the backend registry declares, in order", () => {
    // The server's list is `KIT_ROLES` in core/media.py. Always-on is the mechanism, not a preference:
    // no theme owns this namespace, so nothing else could reach its gallery.
    expect(MEDIA_NS.kit.alwaysOn).toBe(true);
    expect(Object.keys(MEDIA_NS.kit.roles)).toEqual([
      "services",
      "service-banners",
      "hosts",
      "background",
    ]);
  });

  it("the three NAMED roles have DATA-derived keys — no static list — and no pin of their own", () => {
    for (const [role, source] of [
      ["services", "services"],
      ["service-banners", "services"],
      ["hosts", "hosts"],
    ] as const) {
      const def = MEDIA_NS.kit.roles[role];
      expect(def.kind, role).toBe("named");
      expect(def.keySource, role).toBe(source);
      // The keys are the fleet's own identities, which live in config.yaml — a static list here would
      // be a second, always-wrong copy of them.
      expect(def.keys, role).toBeUndefined();
    }
    // The two service roles share ONE identity on purpose: one service, one name to remember, two
    // pictures of it. What differs is the ASSET each is (the word the gallery composes sentences from).
    expect(MEDIA_NS.kit.roles["service-banners"].asset).not.toBe(MEDIA_NS.kit.roles.services.asset);
  });

  it("the shared BACKGROUND is the one pool, and the one pin — the wallpaper/hero shape", () => {
    expect(MEDIA_NS.kit.roles.background.kind).toBe("pool");
    const slots = MEDIA_NS.kit.slots ?? [];
    expect(slots.map((s) => s.key)).toEqual(["background"]);
    // A pin's options come from a real role, and a NAMED role never offers one (its stems ARE its
    // bindings) — the same two invariants the gacha and frontier rows are held to.
    for (const slot of slots) expect(MEDIA_NS.kit.roles[slot.from].kind).toBe("pool");
  });

  it("prices a service BANNER between an icon and full-bleed art (the per-role bounds' whole point)", () => {
    const banner = MEDIA_NS.kit.roles["service-banners"].bounds;
    const icon = MEDIA_NS.kit.roles.services.bounds;
    const full = MEDIA_NS.kit.roles.background.bounds;
    for (const axis of ["bytes", "pixels"] as const) {
      expect(banner[axis]).toBeGreaterThan(icon[axis]);
      expect(banner[axis]).toBeLessThan(full[axis]);
    }
  });

  it("every DERIVED-key role names the asset its files ARE (the gallery composes sentences from it)", () => {
    // The generic derived-key renderer (Codex A1) has no per-source copy: the SOURCE supplies the words
    // for the list, and the ROLE supplies the word for the picture. A role that declared none would
    // silently render "no file" where it means "no banner".
    for (const [nsName, ns] of Object.entries(MEDIA_NS)) {
      for (const [roleName, role] of Object.entries(ns.roles)) {
        if (role.keySource !== undefined) {
          expect(role.asset, `${nsName}/${roleName}`).toBeTruthy();
          // Article-free by contract — every sentence using it reads "no <asset>", "this <asset>".
          expect(role.asset, `${nsName}/${roleName}`).not.toMatch(/^(a|an|the)\s/i);
        }
      }
    }
  });

  it("prices icons far below every art role — the reason bounds went per-role at all", () => {
    const icons = MEDIA_NS.kit.roles.services.bounds;
    for (const art of [MEDIA_NS.gacha.roles.characters, MEDIA_NS.frontier.roles.stack]) {
      expect(icons.bytes).toBeLessThan(art.bounds.bytes);
      expect(icons.pixels).toBeLessThan(art.bounds.pixels);
    }
    // A ~20 CSS px box: 512x512 is already 6x the linear size a 4x-DPR phone can use.
    expect(icons.pixels).toBe(512 * 512);
  });

  it("a role declares EITHER a static key list or a key source, never both and never on a pool", () => {
    for (const [nsName, ns] of Object.entries(MEDIA_NS)) {
      for (const [roleName, role] of Object.entries(ns.roles)) {
        const where = `${nsName}/${roleName}`;
        if (role.keySource !== undefined) {
          expect(role.kind, where).toBe("named");
          expect(role.keys, where).toBeUndefined();
        }
      }
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

describe("the frontier row (D53 M2)", () => {
  it("describes the three role folders the backend registry declares", () => {
    // The server's list is `FRONTIER_ROLES` in core/media.py; a role it lists with no row here would
    // render hintless and unbounded.
    expect(Object.keys(MEDIA_NS.frontier.roles)).toEqual(["rigs", "hero", "stack"]);
  });

  it("the two POOLS are priced as full-bleed art; the LAYER role is priced far lower", () => {
    expect(MEDIA_NS.frontier.roles.rigs.kind).toBe("pool");
    expect(MEDIA_NS.frontier.roles.hero.kind).toBe("pool");
    for (const role of [MEDIA_NS.frontier.roles.rigs, MEDIA_NS.frontier.roles.hero]) {
      expect(role.bounds).toEqual(MEDIA_NS.gacha.roles.characters.bounds);
    }
    // The stack's boxes are ≤196×155 CSS px, so a 4 MP ceiling would never warn — which is the whole
    // reason the bounds went per-role (Opus M6).
    const stack = MEDIA_NS.frontier.roles.stack;
    expect(stack.bounds.pixels).toBeLessThan(MEDIA_NS.frontier.roles.hero.bounds.pixels);
    expect(stack.bounds.bytes).toBeLessThan(MEDIA_NS.frontier.roles.hero.bounds.bytes);
  });

  it("the stack is the NAMED role, and its keys carry per-key guidance", () => {
    const stack = MEDIA_NS.frontier.roles.stack;
    expect(stack.kind).toBe("named");
    expect(stack.keys?.map((k) => k.key)).toEqual(["cube", "platform-mid", "platform-base"]);
    // Every key says something about its own geometry — the layers are painted into three very
    // different boxes, so a shared hint would be a lie for two of them (Codex MED).
    for (const k of stack.keys ?? []) expect(k.hint.length).toBeGreaterThan(0);
  });

  it("only the POOL roles offer a pin — a named role's stems ARE its bindings", () => {
    const slots = MEDIA_NS.frontier.slots ?? [];
    expect(slots.map((s) => s.key)).toEqual(["hero"]);
    for (const slot of slots) expect(MEDIA_NS.frontier.roles[slot.from].kind).toBe("pool");
  });

  it("no role declares static keys unless it is named (and vice versa where keys exist)", () => {
    // The registry-wide shape rule: `keys` is meaningless on a pool, and a named role without them is
    // one whose keys come from live data (M3's services) — neither exists in the same row by accident.
    for (const ns of Object.values(MEDIA_NS)) {
      for (const role of Object.values(ns.roles)) {
        if (role.keys !== undefined) expect(role.kind).toBe("named");
      }
    }
  });

  it("every static key list is UNIQUE after normalization (Codex M2 LOW-1)", () => {
    // Two declared keys that normalize identically ("Café"/"Café") would race for one file and render
    // duplicate React rows; `resolveNamed` collapses them first-declared-wins defensively, but a STATIC
    // registry list has no excuse — this invariant makes the collapse unreachable for every row.
    for (const [nsName, ns] of Object.entries(MEDIA_NS)) {
      for (const [roleName, role] of Object.entries(ns.roles)) {
        const keys = (role.keys ?? []).map((k) => k.key.normalize("NFC").toLowerCase());
        expect(new Set(keys).size, `${nsName}/${roleName}`).toBe(keys.length);
      }
    }
  });
});
