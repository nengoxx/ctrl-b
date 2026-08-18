/// <reference types="node" />
// ^ reads sources from disk (fs/path/process); the tests tsconfig pins `types:["vitest"]`, so node's
//   globals are pulled in explicitly here (the themeContract.test.ts precedent).
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

// ── THE ENGINE-WIDE SVG-FILTER WAIVER SWEEP (§14.11) ──────────────────────────────────────────────
//
// A per-element SVG `filter` is an offscreen rasterization — the cost class §14.11 budgets, and the
// reason each use ships as an OWNER-GRANTED, scoped waiver rather than a styling choice. The waiver
// used to be counted by `tests/themes/gachaChrome.test.ts`, which read exactly ONE stylesheet: a
// `url(#…)` filter appearing in any other sheet or component widened the closed list silently. That
// was the gap (GACHA_PLAN §7.7 R21 ③) — and the sweep found it had already been walked through, by
// cosmos's carved moon button, unnoticed since it shipped.
//
// So the fence is now ENGINE-WIDE and DECLARATIVE: scan every source file, and assert the found set
// EQUALS `SVG_FILTER_WAIVERS`. A dumb source scan deliberately — the failure mode is a filter
// declaration existing at all, which reading the source proves directly, while a browser test would
// have to boot every theme in every state to observe the same line.
//
// Scope note: APPLIED filters only. `url(#…)` also spells gradients (`fill="url(#cosmosCoinGrad)"`)
// and masks, which are ordinary paint with none of this cost — the needle anchors on the `filter`
// property/attribute so they never reach the list. The fence covers DIRECT LITERAL applications
// (the only spelling this codebase uses); a runtime-assembled filter string would slip a lexical
// scan by construction — that is a convention line, not a gap to parse our way across (Codex W3 MED).

const SRC = "src";

/** Every source file under `src` (recursive), path relative to `src` — the allowlist's key shape. */
const files = readdirSync(resolve(process.cwd(), SRC), { recursive: true, encoding: "utf8" })
  .filter((f) => /\.(tsx?|css)$/.test(f))
  .map((f) => f.replace(/\\/g, "/"))
  .sort();

/** APPLIED SVG filters, both spellings: the CSS property and the JSX/SVG attribute — with the
 *  fragment URL bare or quoted (`url(#x)` / `url("#x")`), case-insensitive (Codex W3 MED). */
const NEEDLE = /\bfilter\s*[:=]\s*\{?\s*["'`]?\s*url\(\s*["']?\s*#[\w-]+/gi;

// ── SVG_FILTER_WAIVERS — the closed, owner-granted list (§14.11). One entry per ALLOWED OCCURRENCE,
//    keyed by the file's path under `src/`. ──
export const SVG_FILTER_WAIVERS: Record<string, readonly string[]> = {
  // ① gacha's carved fleet stars (2026-08-07, R19 variant E) — one grouped rule.
  "themes/gacha/gacha.css": ["filter: url(#gc-star-carve"],
  // ② cosmos's carved moon button — static, one element; owner-ratified 2026-08-18
  //    (discovered retroactively by this sweep; shipped since 735a852).
  "themes/cosmos/CosmosMoon.tsx": ['filter="url(#cosmosCarve'],
};

/** `file → needle` lines, one per occurrence — multiplicity kept, so a SECOND reference to an already
 *  waived def still fails (that is what the retired per-sheet counter guaranteed). */
const expected = Object.entries(SVG_FILTER_WAIVERS)
  .flatMap(([file, needles]) => needles.map((n) => `${file} → ${n}`))
  .sort();

/** Comments stripped in BOTH spellings first: §14.11 prose about a waiver, and GachaStar.tsx's own
 *  construction notes, quote the declaration verbatim — documentation must not read as a filter. */
function found(): string[] {
  return files
    .flatMap((file) => {
      const src = readFileSync(resolve(process.cwd(), SRC, file), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
      return [...src.matchAll(NEEDLE)].map((m) => `${file} → ${m[0].replace(/\s+/g, " ").trim()}`);
    })
    .sort();
}

describe("§14.11 — the SVG-filter waiver list is closed, engine-wide", () => {
  it("the needle recognises every direct-literal spelling, and only filters", () => {
    // Pin the extractor itself so a spelling drift can't silently hollow the fence out.
    const hits = (s: string) => [...s.matchAll(NEEDLE)].length;
    expect(hits("filter: url(#carve);")).toBe(1); //          CSS property
    expect(hits('filter: url("#carve");')).toBe(1); //        CSS, quoted fragment
    expect(hits('filter="url(#carve)"')).toBe(1); //          SVG/JSX attribute
    expect(hits("filter={'url(#carve)'}")).toBe(1); //        JSX expression / style object
    expect(hits("FILTER: URL(#carve)")).toBe(1); //           case-insensitive
    expect(hits('fill="url(#grad)" mask="url(#m)"')).toBe(0); // paint servers are not this class
  });

  it("sweeps the whole source tree (the fence is not vacuously passing)", () => {
    // Both halves matter: a broken walk yields an empty file list and then an empty found set, which
    // would pass the equality below only by ALSO emptying the allowlist — so pin the two waived files
    // are reachable, not merely that some files were read.
    expect(files.length).toBeGreaterThan(100);
    expect(files).toContain("themes/gacha/gacha.css");
    expect(files).toContain("themes/cosmos/CosmosMoon.tsx");
  });

  it("every applied `url(#…)` filter in src/ is one the owner granted — and no others", () => {
    expect(
      found(),
      "An applied SVG filter appeared outside SVG_FILTER_WAIVERS (or a granted one moved/vanished).\n" +
        "  Each one is an offscreen rasterization — the cost class docs/THEME_ENGINE.md §14.11 budgets —\n" +
        "  so it ships as an OWNER-GRANTED, scoped waiver, never as a styling choice.\n" +
        "  Do NOT just widen this list. The granting idiom, in order:\n" +
        "    1. an OWNER RULING on the specific use (static? one element? star-sized buffer, not\n" +
        "       surface-sized? never inside an animation — the hard ban on filters in loops stands),\n" +
        "    2. a numbered ¶ for it in docs/THEME_ENGINE.md §14.11, naming the def, its consumers and\n" +
        "       its REVERT path (every entry there carries one),\n" +
        "    3. THEN the entry here, keyed by the file's path under src/.\n" +
        "  A filter that vanished is the happy case: retire its §14.11 ¶ and its entry together.",
    ).toEqual(expected);
  });
});
