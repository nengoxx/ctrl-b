/// <reference types="node" />
// ^ reads sources from disk (fs/path/process); the tests tsconfig pins `types:["vitest"]`, so node's
//   globals are pulled in explicitly here (the themeContract.test.ts / svgFilterWaivers.test.ts precedent).
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

// ── THE `--skin-*` VOCABULARY IS CLOSED, KIT-OWNED, AND DECLARED IN ONE PLACE (D37 amendment / §14.16) ──
//
// W2 widened the `composerSkin` axis past the composer: the input bar, its popovers, the TTS mini-player
// and the pinned plan head now all read ONE override vocabulary of eleven custom properties. That form has
// three failure modes a rendering test cannot see, because each of them still PAINTS something plausible:
//
//   ① a TYPO. `var(--skin-elve, <literal>)` renders the literal — i.e. exactly the `outline` look — so a
//      misspelled slot silently un-skins a surface and every screenshot still looks like a valid skin.
//   ② the §14.6 SUBSTITUTION TRAP. A custom property substitutes its own `var()`s where it is DECLARED and
//      is inherited already-substituted. Arcade's elevation reads `var(--accent)`, which the THEME declares
//      on <body> — so declaring the slot on `:root`/`html` would bake in the kit's base accent and paint
//      every theme's cabinet drop teal. It renders; it is just the wrong colour, everywhere.
//   ③ a THEME declaring a slot. That inverts D37's authority (a catalog skin belongs to every theme's
//      picker): the theme layer beats the base layer, so one theme would pin chrome for skins it does not
//      own — the very coupling frontier's graduated mini-player rule was deleted to end.
//
// So the fence is a SOURCE scan, like the SVG-filter sweep: the failure mode is a name or a selector being
// wrong in the sheet, which reading the sheet proves directly. What the vocabulary LOOKS like when it runs
// is measured in e2e/layout.spec.ts, where the cascade actually executes.

const SRC = "src";
const read = (p: string) => readFileSync(resolve(process.cwd(), SRC, p), "utf8");
/** Comments stripped everywhere: this file's own subject is quoted verbatim in kit.css's prose. */
const decomment = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "");

/** Every source file under `src` (recursive), path relative to `src`. */
const files = readdirSync(resolve(process.cwd(), SRC), { recursive: true, encoding: "utf8" })
  .filter((f) => /\.(tsx?|css)$/.test(f))
  .map((f) => f.replace(/\\/g, "/"))
  .sort();

const kit = decomment(read("theme-engine/kit/kit.css"));

/** THE VOCABULARY — eleven slots, and no twelfth without a D37 amendment. (`--skin-radius` was ruled OUT:
 *  no skin re-corners a panel, so the slot had no declarer; re-addable if one is ever minted.) */
const VOCABULARY = [
  "--skin-border",
  "--skin-fill",
  "--skin-frost",
  "--skin-elev",
  "--skin-bar-fill",
  "--skin-bar-frost",
  "--skin-bar-elev",
  "--skin-bar-elev-up",
  "--skin-chip-edge",
  "--skin-chip-elev",
  "--skin-lift",
] as const;

/** A DECLARATION of a slot (`--skin-x: …`), as opposed to a READ of one (`var(--skin-x, …)`). */
const DECLARES = /(^|[;{\s])--skin-[\w-]+\s*:/;

/** Flat `selector { declarations }` pairs. kit.css nests nothing, and the `[^{}]` classes make an at-rule
 *  wrapper (`@media …`) fall out of the match while its inner rules still pair up correctly. */
function rules(css: string): { sel: string; body: string }[] {
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
    sel: m[1].replace(/\s+/g, " ").trim(),
    body: m[2],
  }));
}

const declarers = rules(kit).filter(({ body }) => DECLARES.test(body));

/** Every OTHER stylesheet is fenced too (Codex W2 LOW): kit.css is the vocabulary's ONLY legitimate
 *  declarer — a `--skin-*:` landing in axes.css, a tokens sheet, or any future sheet is the same
 *  authority violation as a theme declaring one, and the theme-authority arm below cannot see it. */
const OTHER_CSS_DECLARERS = files
  .filter((f) => f.endsWith(".css") && f !== "theme-engine/kit/kit.css")
  .filter((f) => DECLARES.test(decomment(read(f))));

/** Every rule whose selector LIST contains `needle`, bodies joined — so a consumer split across rules
 *  (the popover shell and its anchoring block share a selector) is read as one. */
function blocksFor(css: string, needle: string): string {
  const hits = rules(css).filter((r) => r.sel.split(",").some((s) => s.trim() === needle));
  expect(hits.length, `no rule found for selector \`${needle}\``).toBeGreaterThan(0);
  return hits.map((h) => h.body).join("\n");
}

describe("§14.16 — the `--skin-*` vocabulary is a CLOSED name list", () => {
  it("every `--skin-*` token in kit.css is one of the eleven", () => {
    const used = [...new Set([...kit.matchAll(/--skin-[\w-]+/g)].map((m) => m[0]))].sort();
    expect(
      used,
      "A `--skin-*` name outside the vocabulary appeared in kit.css.\n" +
        "  This is the TYPO fence: the override form `var(--skin-X, <literal>)` renders the literal when\n" +
        "  X is misspelled, so a bad name silently un-skins a surface and still looks like a valid skin.\n" +
        "  A REAL twelfth slot means amending D37 + docs/THEME_ENGINE.md §14.16 first, then this list.",
    ).toEqual([...VOCABULARY].sort());
  });
});

describe("§14.6 — the slots are declared on `.kit`, never on `:root`/`html`", () => {
  it("every declaration block is a skin stamp (or the priv-menu opt-out)", () => {
    // (0,2,1) `body[data-composer-skin="X"] .kit`, its (0,3,1) light-mode compound, or the one OPT-OUT.
    const SKIN = '(glass|bezel|sleek|arcade)"\\] \\.kit$';
    const OK = new RegExp(
      `^body\\[data-composer-skin="${SKIN}|^body\\[data-mode="light"\\]\\[data-composer-skin="${SKIN}|^\\.kit \\.priv-menu$`,
    );
    expect(
      declarers.map((r) => r.sel).filter((s) => !OK.test(s)),
      "A `--skin-*` slot is declared outside the skin stamps.\n" +
        "  §14.6: a custom property substitutes its `var()`s WHERE IT IS DECLARED and is inherited\n" +
        "  already-substituted — and arcade's elevation reads `var(--accent)`, which the THEME declares on\n" +
        "  <body>. Declared any higher (`:root`/`html`) it would bake in the kit's base accent instead.",
    ).toEqual([]);
    // …and the blocks really were found (a broken parse would pass the emptiness check above vacuously).
    expect(declarers.length).toBeGreaterThanOrEqual(6);
    expect(declarers.map((r) => r.sel)).toContain('body[data-composer-skin="arcade"] .kit');
  });

  it("`outline` declares nothing — it IS the fallbacks", () => {
    expect(declarers.map((r) => r.sel).join("\n")).not.toContain('data-composer-skin="outline"');
  });
});

describe("the arcade signature (owner ruling 2026-08-18: SOLID `--accent`, 4px)", () => {
  const DROP = "var(--skin-lift) var(--skin-lift) 0 var(--accent)";
  const arcade = () => blocksFor(kit, 'body[data-composer-skin="arcade"] .kit');

  it("one distance, spelled once", () => {
    expect(arcade()).toMatch(/--skin-lift:\s*4px/);
  });

  it("every elevation slot is that distance in the FLAT accent — no mix", () => {
    for (const slot of ["--skin-elev", "--skin-bar-elev", "--skin-bar-elev-up", "--skin-chip-elev"])
      expect(arcade(), `${slot} must repeat the one signature`).toContain(`${slot}: ${DROP}`);
    // It shipped for a fortnight as a 60%-transparent mix, which reads as a washed accent rather than the
    // accent (the same correction gacha's own `--gc-lift-color` took at G6). Pin the regression shut.
    const elevations = arcade()
      .split(";")
      .filter((d) => /--skin-(bar-|chip-)?elev/.test(d))
      .join(";");
    expect(elevations, "the drop must not be a washed mix again").not.toContain("color-mix");
  });

  it("`--arcade-lift` is gone from the tree — renamed, not aliased", () => {
    expect(
      files.filter((f) => read(f).includes("--arcade-lift")),
      "the vocabulary replaced it; no alias, no shim, and no stale prose pointing at a dead name",
    ).toEqual([]);
  });
});

describe("the CONSUMERS read the vocabulary", () => {
  // One needle per surface FAMILY — the fence is "this surface still joins the axis", not a paint diff.
  it("the input bar", () => {
    expect(blocksFor(kit, ".kit-composer")).toContain("var(--skin-bar-elev,");
    expect(blocksFor(kit, ".kit-composer.sheet")).toContain("var(--skin-bar-elev-up,");
  });
  it("the composer popovers (the shared shell)", () => {
    expect(blocksFor(kit, ".kit .kit-suggest")).toContain("var(--skin-fill,");
  });
  it("the mini player", () => {
    expect(blocksFor(kit, ".kit .mini-player")).toContain("var(--skin-elev,");
  });
  it("the plan chip pair", () => {
    expect(blocksFor(kit, ".kit .plan-pill")).toContain("var(--skin-chip-edge,");
  });

  it("the priv-menu OPTS OUT of all four panel slots", () => {
    // It shares the popover shell but is chat-HEADER chrome (§14.16 exclusions). `initial` on a custom
    // property is the guaranteed-invalid value, so each `var()` in the shell falls back to its own literal.
    const optOut = rules(kit).find((r) => r.sel === ".kit .priv-menu" && DECLARES.test(r.body));
    expect(
      optOut,
      "the opt-out block is missing — the menu would wear the composer's skin",
    ).toBeTruthy();
    for (const slot of ["--skin-fill", "--skin-frost", "--skin-border", "--skin-elev"])
      expect(optOut!.body).toContain(`${slot}: initial`);
  });
});

describe("D37 authority — the vocabulary is KIT-owned", () => {
  it("no theme declares a `--skin-*` slot", () => {
    const themeSheets = files.filter((f) => f.startsWith("themes/") && f.endsWith(".css"));
    expect(themeSheets.length).toBeGreaterThan(5); // the walk is not vacuous
    expect(
      themeSheets.filter((f) => DECLARES.test(decomment(read(f)))),
      "A theme declared a composer-skin slot. The theme layer BEATS the base layer, so this pins chrome\n" +
        "  for skins the theme does not own — the coupling frontier's mini-player rule was deleted to end\n" +
        "  (§14.14 graduation). A theme wanting different chrome asks for a new CATALOG skin.",
    ).toEqual([]);
  });

  it("no stylesheet outside kit.css declares one either", () => {
    expect(
      OTHER_CSS_DECLARERS,
      "kit.css is the vocabulary's only legitimate declarer — a slot declared in any other sheet\n" +
        "  bypasses the per-skin declaration blocks and their scope rules.",
    ).toEqual([]);
  });
});

describe("the geometry boundary — the player's `:has()` rules move it, never paint it", () => {
  it("no paint property in the three clearance rules", () => {
    const clearances = rules(kit).filter(
      (r) => r.sel.includes(".mini-player") && r.sel.includes(":has("),
    );
    expect(clearances).toHaveLength(3); // the launcher inset, the plan-band yield, the NavHome mirror
    for (const r of clearances)
      expect(
        r.body,
        `\`${r.sel}\` paints. Placement is the KIT's (it composes with every skin); resting chrome is the ` +
          `AXIS's — a paint here would fight the vocabulary instead of composing with it.`,
      ).not.toMatch(/(^|[;{\s])(background|box-shadow|border|backdrop-filter)\s*:/);
  });
});
