/// <reference types="node" />
// ^ this file reads the committed font manifest from disk (fs/path/process); the tests tsconfig pins
//   `types:["vitest"]`, so node's globals are pulled in explicitly here rather than widening the suite.
import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { GACHA_COPY, gachaGlyphSet } from "../../src/themes/gacha/copy";

// The FROZEN-SUBSET GUARD (D52 / GACHA_PLAN §10.4 — "a guard test re-derives the glyph set from the theme's
// copy constants and fails if a glyph is missing from the subset manifest — that's what keeps 'frozen copy'
// changeable later").
//
// gacha does NOT ship a whole Japanese font: `scripts/gen-theme-fonts.mjs` subsets each weight to exactly
// the characters `src/themes/gacha/copy.ts` uses, and the outputs are committed. So a new JP string in the
// copy module is a string the shipped font cannot draw — it would silently fall back to the system JP face,
// mid-sentence, at the wrong weight. This suite is the tripwire: edit the copy, re-run `npm run fonts:gacha`,
// commit the outputs.
//
// It deliberately checks the MANIFEST (what the generator recorded) against the SOURCE (what the theme
// says) and against DISK (what git actually holds) — three places that must agree. Parsing the woff2 cmaps
// would need a font parser in the unit suite for no extra signal: the manifest's glyph string IS the `text=`
// argument the subsetter was given.

const fontsDir = resolve(process.cwd(), "src/themes/gacha/fonts");

interface Manifest {
  glyphs: string;
  glyphCount: number;
  faces: { family: string; weights: number[] }[];
  files: { file: string; family: string; weight: number; subset: string; bytes: number }[];
  totalBytes: number;
}

const manifest = JSON.parse(readFileSync(resolve(fontsDir, "manifest.json"), "utf8")) as Manifest;
const facesCss = readFileSync(resolve(fontsDir, "faces.css"), "utf8");

// The six faces GACHA_PLAN §1 pins. Hard-coded HERE (not read from the manifest) on purpose: the manifest
// is the generator's output, so checking it against itself would prove nothing.
const RULED_FACES = [
  { family: "Zen Kaku Gothic New", weights: [400, 500, 700, 900] },
  { family: "Shippori Mincho B1", weights: [600, 800] },
];

describe("gacha font subset — the frozen glyph set", () => {
  it("covers every non-ASCII character the theme's copy module uses", () => {
    const covered = new Set(manifest.glyphs);
    const missing = gachaGlyphSet().filter((g) => !covered.has(g));
    expect(
      missing,
      `The committed gacha font subsets are missing ${missing.length} glyph(s) that src/themes/gacha/copy.ts\n` +
        `  now uses: ${missing.join(" ")}\n` +
        `  The shipped font physically cannot draw them — they would fall back to the system JP face.\n` +
        `  Fix: run \`npm run fonts:gacha\` from frontend/ and COMMIT src/themes/gacha/fonts/.`,
    ).toEqual([]);
  });

  it("carries no glyph the copy module has dropped (the subset never drifts wider than the copy)", () => {
    // Not fatal in production — a spare glyph is only wasted bytes — but it means the manifest is stale,
    // which is the same staleness the arm above catches in the dangerous direction. Kept symmetric so one
    // re-run fixes both.
    const used = new Set(gachaGlyphSet());
    const orphans = [...manifest.glyphs].filter((g) => !used.has(g));
    expect(orphans, `stale glyph(s) in the subset — re-run \`npm run fonts:gacha\``).toEqual([]);
  });

  it("records the glyph count it actually subset", () => {
    expect(manifest.glyphCount).toBe([...manifest.glyphs].length);
    expect(manifest.glyphCount).toBe(gachaGlyphSet().length);
  });

  it("excludes ASCII — Latin coverage comes from the full `latin` subsets, not the frozen list", () => {
    expect([...manifest.glyphs].every((c) => c.codePointAt(0)! > 0x7f)).toBe(true);
    // A spot check that the frozen list really is the theme's copy and not a hand-kept duplicate.
    for (const ch of GACHA_COPY.tabFleet) expect(manifest.glyphs).toContain(ch);
    for (const ch of GACHA_COPY.brandMeta) expect(manifest.glyphs).toContain(ch);
  });
});

describe("gacha font subset — the committed files", () => {
  it("ships a jp AND a latin file for each of the six ruled faces", () => {
    for (const { family, weights } of RULED_FACES) {
      for (const weight of weights) {
        for (const subset of ["jp", "latin"]) {
          const entry = manifest.files.find(
            (f) => f.family === family && f.weight === weight && f.subset === subset,
          );
          expect(entry, `no ${subset} file for ${family} ${weight}`).toBeTruthy();
        }
      }
    }
    expect(manifest.files).toHaveLength(12);
  });

  it("every manifest entry exists on disk at the recorded size", () => {
    for (const f of manifest.files) {
      const { size } = statSync(resolve(fontsDir, f.file));
      expect(size, `${f.file} changed on disk without a manifest update`).toBe(f.bytes);
    }
    expect(manifest.files.reduce((n, f) => n + f.bytes, 0)).toBe(manifest.totalBytes);
  });

  it("faces.css declares every committed file, with a unicode-range on the JP faces", () => {
    for (const f of manifest.files) {
      expect(facesCss, `faces.css does not reference ${f.file}`).toContain(`./${f.file}`);
    }
    // `unicode-range` is what keeps the JP file from being fetched for a Latin-only paint (and vice
    // versa) — without it one of the two files per weight is always dead weight.
    expect(facesCss.match(/unicode-range:/g)?.length).toBe(manifest.files.length);
    expect(facesCss).toContain("font-display: swap");
  });

  it("stays inside the measured budget the @fontsource path was rejected for", () => {
    // The rejected path measured ~757 KB over ~72 requests on first render. This is the whole committed
    // font layer, of which a first paint fetches only the faces it actually draws (unicode-range split).
    // A generous ceiling — it fails on a REGRESSION (someone adding a full JP subset), not on drift.
    expect(manifest.totalBytes).toBeLessThan(300_000);
  });
});
