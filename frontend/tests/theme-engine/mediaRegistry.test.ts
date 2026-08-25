import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { HERO_KEY, RIG_KEYS } from "../../src/themes/frontier/art";
import { STACK_KEYS } from "../../src/themes/frontier/ownerArt";
import { gacha } from "../../src/themes/gacha";
import { defaultRoster } from "../../src/themes/gacha/roster";
import {
  applicableNs,
  MEDIA_NS,
  mediaSections,
  type MediaNsDef,
} from "../../src/theme-engine/mediaRegistry";
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
  it("is ALWAYS-ON and holds the five role folders the backend registry declares, in order", () => {
    // The server's list is `KIT_ROLES` in core/media.py. Always-on is the mechanism, not a preference:
    // no theme owns this namespace, so nothing else could reach its gallery. `brand` is G6.3's addition
    // and is APPENDED — the order is what the gallery lists sections in, so an insertion would reshuffle
    // a screen the owner already knows.
    expect(MEDIA_NS.kit.alwaysOn).toBe(true);
    expect(Object.keys(MEDIA_NS.kit.roles)).toEqual([
      "services",
      "service-banners",
      "hosts",
      "background",
      "brand",
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

  it("the two POOLS each carry a pin, and only they do — the wallpaper/hero shape, twice", () => {
    expect(MEDIA_NS.kit.roles.background.kind).toBe("pool");
    expect(MEDIA_NS.kit.roles.brand.kind).toBe("pool");
    const slots = MEDIA_NS.kit.slots ?? [];
    expect(slots.map((s) => s.key)).toEqual(["background", "brand"]);
    // A pin's options come from a real role, and a NAMED role never offers one (its stems ARE its
    // bindings) — the same two invariants the gacha and frontier rows are held to.
    for (const slot of slots) expect(MEDIA_NS.kit.roles[slot.from].kind).toBe("pool");
    // Each pin reads its OWN folder. Crossing them would let the owner pin a wallpaper as the app icon —
    // the same class of mistake the gacha reel pin is fenced against (Codex F4).
    for (const slot of slots) expect(slot.from).toBe(slot.key);
  });

  it("prices the BRAND mark as an icon, not as full-bleed art (G6.3)", () => {
    // It paints at ~18px in the app bar — the same box class as a service icon, and three orders of
    // magnitude off the background's ceiling, which would never warn on anything.
    expect(MEDIA_NS.kit.roles.brand.bounds).toEqual(MEDIA_NS.kit.roles.services.bounds);
  });

  it("the brand hint says ALPHA is the shape — the one thing the file cannot tell the owner", () => {
    // A fully opaque photo drops in happily and paints a solid accent-coloured rectangle, because the
    // surface reads the file as a MASK. The hint is the only place that can warn.
    const hint = MEDIA_NS.kit.roles.brand.hint ?? "";
    expect(hint).toMatch(/transparent/i);
    expect(hint).toMatch(/shape/i);
  });

  it("the background hint no longer promises that scenery themes IGNORE the picture (G6.3)", () => {
    // gacha made it a rung of its own backdrop ladder, so the old sentence became a lie the
    // owner caught on the device round: they dropped a file in and nothing happened under gacha. What a
    // scenery theme declines is the shared LAYER; the picture itself still reaches its own backdrop.
    const hint = MEDIA_NS.kit.roles.background.hint ?? "";
    expect(hint).not.toMatch(/ignore/i);
    expect(hint).toMatch(/layer/i);
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
    // `wallpaper` was REMOVED at G6.3 (owner ruling: one shared background home, not one per theme).
    expect(Object.keys(MEDIA_NS.gacha.roles)).toEqual(["characters", "banner", "reel", "oracle"]);
    for (const role of Object.values(MEDIA_NS.gacha.roles)) {
      expect(role.kind).toBe("pool");
      // G5's server-side WARN_BYTES/WARN_PIXELS, moved here whole when the policy went client-side.
      expect(role.bounds).toEqual({ bytes: 1_500_000, pixels: 4_000_000 });
    }
  });

  it("offers every pin the backend registry accepts, each sourced from a real role", () => {
    const slots = MEDIA_NS.gacha.slots ?? [];
    // The pin list is UNCHANGED by G6.3's role removal: a pin key and a role folder are validated
    // independently on both ends (`GACHA_SLOTS` vs `GACHA_ROLES`), and `wallpaper` survives because the
    // theme-specific half — bind a CAST portrait to the backdrop — has no kit equivalent.
    expect(slots.map((s) => s.key)).toEqual(["wallpaper", "hero", "oracle", "reel_figure"]);
    for (const slot of slots) expect(MEDIA_NS.gacha.roles[slot.from]).toBeDefined();
    expect(slots.find((s) => s.key === "wallpaper")?.from).toBe("characters");
    // The ruled shape (Codex F4): the figure's options come from the REEL role, never the cast.
    expect(slots.find((s) => s.key === "reel_figure")?.from).toBe("reel");
  });

  it("the backdrop pin carries the HINT that names its fallback — the folder it used to have is gone", () => {
    // With no `wallpaper/` role there is nowhere else in the gallery to learn where the fleet backdrop
    // comes from, and the pins section's generic copy ("overriding that folder's own first pick") is no
    // longer the whole truth for this one. It is the only gacha pin that needs a line of its own.
    const hint = MEDIA_NS.gacha.slots?.find((s) => s.key === "wallpaper")?.hint ?? "";
    expect(hint).toMatch(/shared/i);
    expect(MEDIA_NS.gacha.slots?.filter((s) => s.hint !== undefined)).toHaveLength(1);
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

// ── the per-role BUNDLED ids (D65) ───────────────────────────────────────────────────────────────────
//
// Three claims, and they are deliberately different in kind:
//   ① the lists are DERIVED from the theme ladder modules, not hand-typed (the H1 rider) — asserted by
//     comparing against the same exports the registry reads, plus the LITERALS, so a derivation that
//     silently agrees with itself on both sides still fails when the theme's shipped art changes;
//   ② shape invariants — an id is a bare stable NAME, never a filename or a path, unique in its role;
//   ③ the cross-language MIRROR: the backend hand-lists the same ids in `core/media.py`.
//
// ③ lives HERE rather than in pytest for one reason: this side is DERIVED, and deriving it needs Vite's
// asset globs — a Python test could only read literals that no longer exist. So the guard is the SYS-10
// drift-guard pattern (`test_arch_invariants_sys10.py`) pointed the other way: read the OTHER language's
// source with a pinned regex, and fail loudly if the declaration was reshaped rather than skipping.

const BACKEND_MEDIA = join(import.meta.dirname, "../../../backend/app/core/media.py");

/** The rows of one `*_ROLES` dict body → `{role: bundled[]}`.
 *
 *  **Anchored to a row's own INDENTATION** (`^ {4}"…`, multiline) rather than matched free-floating, so
 *  only a LIVE dict entry can participate: a commented-out `# "characters": MediaRole(bundled=(…))` sits
 *  behind a `#` and never reaches column 4. Un-anchored, such a line matched — and if it sat *after* the
 *  live row it overwrote the parsed value, so a guard whose whole job is catching drift would have
 *  accepted it silently. Exported as its own function purely so that failure mode is testable. */
function parseRoleEntries(body: string): Record<string, string[]> {
  const entry = /^ {4}"([^"]+)":\s*MediaRole\(\s*(?:bundled=\(\s*([^)]*?)\s*\))?\s*,?\s*\)/gm;
  const out: Record<string, string[]> = {};
  for (const m of body.matchAll(entry)) {
    out[m[1]] = [...(m[2] ?? "").matchAll(/"([^"]*)"/g)].map((s) => s[1]);
  }
  return out;
}

/** Parse one `<NAME>_ROLES: dict[str, MediaRole] = { … }` block out of `core/media.py` into
 *  `{role: bundled[]}`. Anchored on the exact declaration so a rename or a reshape fails here instead of
 *  quietly matching nothing. */
function backendRoles(constName: string): Record<string, string[]> {
  const src = readFileSync(BACKEND_MEDIA, "utf8");
  const block = new RegExp(
    `\\n${constName}: dict\\[str, MediaRole\\] = \\{\\n(.*?)\\n\\}`,
    "s",
  ).exec(src);
  expect(
    block,
    `could not find \`${constName}: dict[str, MediaRole] = { … }\` in ${BACKEND_MEDIA} — the backend ` +
      "registry was renamed or reshaped; update this guard (and confirm the bundled ids still match)",
  ).not.toBeNull();
  const out = parseRoleEntries(block![1]);
  expect(
    Object.keys(out).length,
    `${constName} parsed to no roles — the guard's entry regex is stale`,
  ).toBeGreaterThan(0);
  return out;
}

/** The bundled IDS of one role. Since D65 a role's `bundled` list holds `{id, url}` objects — one
 *  object rather than an id list beside a url map — because the gallery has to PAINT a bundled tile
 *  and the server emits no url for it. The mirror below is still about the ids. */
const ids = (role: { bundled: readonly { id: string }[] }) => role.bundled.map((b) => b.id);

describe("bundled ids — derived front-end-side, mirrored on the backend", () => {
  const roster = defaultRoster();

  it("gacha's ids are the roster's own names — cast, scenes, cutout pool AND the oracle backdrop", () => {
    // Each list is the theme's, read where the theme keeps it. The oracle is the load-bearing one, and
    // it changed direction in the S6 owner round: its backdrop used to be listed nowhere (scene art no
    // pin addresses, on the last rung of `oracleArt`'s ladder), which meant the one picture that role
    // paints was in no gallery and could be neither replaced nor retired. Shipped art is an entry.
    expect(ids(MEDIA_NS.gacha.roles.characters)).toEqual(roster.entries.map((e) => e.name));
    expect(ids(MEDIA_NS.gacha.roles.banner)).toEqual(roster.scenes.map((s) => s.name));
    expect(ids(MEDIA_NS.gacha.roles.reel)).toEqual(roster.pools.reel.map((a) => a.name));
    expect(ids(MEDIA_NS.gacha.roles.oracle)).toEqual(roster.pools.oracle.map((a) => a.name));
    // The literals the theme ships today — the half a derivation cannot catch. `rook` joined the cast
    // list in the same round: the file always shipped and no role had ever named it.
    expect(ids(MEDIA_NS.gacha.roles.characters)).toEqual([
      "pegasus",
      "atlas",
      "3",
      "4",
      "lyra",
      "rook",
    ]);
    expect(ids(MEDIA_NS.gacha.roles.banner)).toEqual(["b2", "b3"]);
    expect(ids(MEDIA_NS.gacha.roles.reel)).toEqual(["lyra"]);
    expect(ids(MEDIA_NS.gacha.roles.oracle)).toEqual(["oracle"]);
  });

  it("frontier's ids are its key tuples — and the hero vista, under its own asset stem", () => {
    expect(ids(MEDIA_NS.frontier.roles.rigs)).toEqual([...RIG_KEYS]);
    expect(ids(MEDIA_NS.frontier.roles.stack)).toEqual([...STACK_KEYS]);
    expect(ids(MEDIA_NS.frontier.roles.hero)).toEqual([HERO_KEY]);
  });

  it("the kit ships no bundled art at all, and every role SAYS so", () => {
    // Not an omission (§3): absent art means the surface renders exactly as it does without it. The field
    // is required precisely so "nothing bundled" cannot be confused with "nobody filled this in".
    for (const [role, def] of Object.entries(MEDIA_NS.kit.roles)) {
      expect(ids(def), role).toEqual([]);
    }
  });

  it("every id is a bare, stable, unique NAME — never a filename, never a path", () => {
    // An id is an IDENTITY the client maps to a hashed asset; a duplicate would make a `{bundled: …}`
    // library entry ambiguous, and a dotted or slashed one would read as a file the mount could serve.
    for (const [nsName, ns] of Object.entries(MEDIA_NS)) {
      for (const [roleName, role] of Object.entries(ns.roles)) {
        const where = `${nsName}/${roleName}`;
        expect(new Set(ids(role)).size, where).toBe(role.bundled.length);
        for (const { id, url } of role.bundled) {
          expect(id.length, where).toBeGreaterThan(0);
          expect(id, where).not.toMatch(/[/\\.]/);
          // …and every id resolves to an ASSET, because the gallery paints bundled tiles from these.
          expect(url.length, `${where} ${id}`).toBeGreaterThan(0);
        }
      }
    }
  });

  it("the mirror guard's parser IGNORES a commented-out row (it cannot be talked out of drift)", () => {
    // The failure this arm exists for: a `#`-commented entry AFTER the live one used to match and
    // overwrite it, so a stale/removed id could be smuggled past the very test that guards it. Only a
    // row at a dict entry's own indentation counts.
    const body = [
      '    "characters": MediaRole(bundled=("pegasus", "lyra")),',
      '    # "characters": MediaRole(bundled=("ghost",)),',
      '    # was: "banner": MediaRole(bundled=("b1",)),',
      '    "oracle": MediaRole(),',
    ].join("\n");
    expect(parseRoleEntries(body)).toEqual({ characters: ["pegasus", "lyra"], oracle: [] });
  });

  it("the BACKEND's hand-listed ids match this registry's derived ones, role for role", () => {
    // The mirror the collation depends on: the server emits `{bundled: <id>}` index rows and the client
    // maps the id to its asset, so a name that exists on only one side is a row nothing can paint.
    for (const [constName, ns] of [
      ["GACHA_ROLES", "gacha"],
      ["FRONTIER_ROLES", "frontier"],
      ["KIT_ROLES", "kit"],
    ] as const) {
      const backend = backendRoles(constName);
      const frontend = Object.fromEntries(
        Object.entries(MEDIA_NS[ns].roles).map(([role, def]) => [role, ids(def)]),
      );
      // Role NAMES too, in declaration order — the two registries have always mirrored row for row, and
      // the bundled lists are only meaningful if the roles they hang off agree.
      expect(Object.keys(backend), ns).toEqual(Object.keys(frontend));
      expect(backend, ns).toEqual(frontend);
    }
  });
});

// ── SECTIONS + the §2.4 active resolvers (D65, council H1/H5/M1) ─────────────────────────────────
//
// A SECTION is one art destination; the capability descriptor on it is what makes the two kinds (a
// library-backed folder, a pin-backed seat) ONE gallery instead of two behaviours sharing a label.
// These arms pin the two things a renderer must not have to re-derive: which destinations exist, and
// which of them can do what.

/** The role list the SERVER would send for one namespace (the authority on which folders exist). */
const rolesOf = (ns: string) => Object.keys(MEDIA_NS[ns].roles);

describe("mediaSections — the destinations the Conf tab shows", () => {
  it("gacha: one card per role folder, then the three character-bound SEATS", () => {
    const out = mediaSections("gacha", MEDIA_NS.gacha, rolesOf("gacha"));
    expect(out.map((s) => s.id)).toEqual([
      "gacha:characters",
      "gacha:banner",
      "gacha:reel",
      "gacha:oracle",
      "gacha:@wallpaper",
      "gacha:@hero",
      "gacha:@oracle",
    ]);
    // `reel_figure` is NOT a seat: it pins the reel role's own first-wins pick, so it is that role's
    // ladder rather than a destination of its own — one destination, one card.
    const reel = out.find((s) => s.id === "gacha:reel");
    expect(reel?.pin).toBe("reel_figure");
    expect(reel?.caps.activate).toBe("pin");
    // …while a pool with no pin above it activates by ORDER (move-to-front).
    expect(out.find((s) => s.id === "gacha:characters")?.caps.activate).toBe("order");
  });

  it("a SEAT is a read-only view: pin only, and nothing that would write the source library", () => {
    const seat = mediaSections("gacha", MEDIA_NS.gacha, rolesOf("gacha")).find(
      (s) => s.id === "gacha:@wallpaper",
    );
    expect(seat?.role).toBe("characters"); // it VIEWS the cast
    expect(seat?.caps).toEqual({
      reorder: false,
      // A seat is a VIEW: framing edits the item, which belongs to the source role's own gallery
      // (§5) — offering it here would write into a library this section is read-only over.
      frame: false,
      activate: "pin",
      hidden: false,
      remove: false,
      upload: false,
    });
  });

  it("frontier: each STATIC key is its own destination, with its own shape", () => {
    const out = mediaSections("frontier", MEDIA_NS.frontier, rolesOf("frontier"));
    expect(out.filter((s) => s.kind === "key").map((s) => s.key)).toEqual([...STACK_KEYS]);
    const cube = out.find((s) => s.key === "cube");
    expect(cube?.aspect).toBeCloseTo(353 / 364, 5);
    // Order buys nothing but the duplicate tie-break in a named role, so the ↑/↓ pair is hidden (#11).
    expect(cube?.caps.reorder).toBe(false);
    expect(cube?.caps.activate).toBe("order"); // move-to-front IS how a duplicate wins its key
  });

  it("kit: ONE family card per data-derived role, plus its Unassigned bucket (H5)", () => {
    const out = mediaSections("kit", MEDIA_NS.kit, rolesOf("kit"));
    expect(out.filter((s) => s.kind === "family").map((s) => s.role)).toEqual([
      "services",
      "service-banners",
      "hosts",
    ]);
    // Every named role gets a bucket for the files that bound nothing — otherwise a rename's orphan is
    // invisible AND undeletable, the one state a manager must not be able to produce.
    expect(out.filter((s) => s.kind === "unassigned").map((s) => s.id)).toEqual([
      "kit:services#",
      "kit:service-banners#",
      "kit:hosts#",
    ]);
    expect(out.find((s) => s.kind === "unassigned")?.caps).toEqual({
      reorder: false,
      // …and a file bound to no key paints in no window, so there is nothing to frame it for.
      frame: false,
      activate: "none", // a file bound to no key paints nowhere; there is nothing to activate
      hidden: true,
      remove: true,
      upload: false,
    });
  });

  it("a role the SERVER lists and this registry does not describe still gets a gallery", () => {
    const out = mediaSections("gacha", MEDIA_NS.gacha, ["characters", "mystery"]);
    const mystery = out.find((s) => s.role === "mystery");
    expect(mystery?.kind).toBe("pool");
    expect(mystery?.active).toBeUndefined(); // no ladder to claim — so it claims nothing
  });

  it("every declared destination has a SHAPE and a bounds policy", () => {
    for (const ns of Object.keys(MEDIA_NS)) {
      for (const s of mediaSections(ns, MEDIA_NS[ns], rolesOf(ns))) {
        expect(s.bounds.bytes, s.id).toBeGreaterThan(0);
        expect(s.aspect, s.id).toBeGreaterThan(0);
      }
    }
  });
});

describe("the §2.4 active resolvers are PURE in the index (§11's purity arm)", () => {
  /** One collated row, minimal. */
  const row = (file: string, over = {}) => ({
    name: file.replace(/\.\w+$/, ""),
    file,
    url: `/api/media/x/files/r/${file}`,
    revision: "1:1",
    unusable: false,
    ...over,
  });

  it("takes the ROWS and the wire's SLOTS — never config, never settings", () => {
    // The seam that makes the gallery incapable of claiming a binding the render will not honour: the
    // resolver is the theme's own ladder, and its whole input is the payload both ends already share.
    // A third parameter would be a config side-channel — §2.3 ④ exists precisely so none is needed.
    for (const ns of Object.keys(MEDIA_NS)) {
      for (const s of mediaSections(ns, MEDIA_NS[ns], rolesOf(ns))) {
        if (s.active === undefined) continue;
        expect(s.active.length, s.id).toBeLessThanOrEqual(2);
      }
    }
  });

  it("every id it returns is a row it was GIVEN — no invented entry, ever", () => {
    const rows = [row("a.webp"), row("b.webp")];
    for (const ns of Object.keys(MEDIA_NS)) {
      for (const s of mediaSections(ns, MEDIA_NS[ns], rolesOf(ns))) {
        const out = s.active?.(rows, {});
        for (const id of out?.ids ?? []) {
          expect(["f:a.webp", "f:b.webp"], s.id).toContain(id);
        }
      }
    }
  });

  it("the oracle POOL reports the SEAT that overrides it, rather than a phantom of its own", () => {
    const pool = mediaSections("gacha", MEDIA_NS.gacha, rolesOf("gacha")).find(
      (s) => s.id === "gacha:oracle",
    );
    expect(pool?.active?.([row("eye.webp")], {})?.ids).toEqual(["f:eye.webp"]);
    const beaten = pool?.active?.([row("eye.webp")], { oracle: "kira" });
    expect(beaten?.ids).toEqual([]);
    expect(beaten?.overriddenBySlot).toBe("oracle");
  });
});
