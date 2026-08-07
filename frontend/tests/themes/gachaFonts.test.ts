/// <reference types="node" />
// ^ this file reads the committed font manifest from disk (fs/path/process); the tests tsconfig pins
//   `types:["vitest"]`, so node's globals are pulled in explicitly here rather than widening the suite.
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { GACHA_COPY, gachaGlyphSet } from "../../src/themes/gacha/copy";
// ⚠ IMPORT ORDER IS LOAD-BEARING for the `loadFonts` group at the bottom of this file: `fonts.ts` reaches
// the settings through the REGISTRY, and `registry.ts` captures each theme's def by VALUE when its own body
// runs. Entering the theme cluster at `themes/gacha` (the index) first makes registry.ts evaluate mid-cycle
// and capture `gacha: undefined`, so every `resolveThemeSetting("gacha", …)` returns undefined and nothing
// is warmed. Pulling a registry-side module (fonts → settings → registry) FIRST evaluates the index inside
// registry's own dependency pass, which is how the app itself enters the cluster. Reordering these two
// lines fails the group loudly rather than silently — but it fails, so keep them as they are.
import { loadFonts, nameFaceProbes } from "../../src/themes/gacha/fonts";
import { gacha } from "../../src/themes/gacha";
import { setUI } from "../../src/store/ui";

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
  faces: { family: string; weights: number[]; subsets: string[] }[];
  files: {
    file: string;
    family: string;
    weight: number;
    subset: string;
    bytes: number;
    sha256: string;
  }[];
  totalBytes: number;
}

const manifest = JSON.parse(readFileSync(resolve(fontsDir, "manifest.json"), "utf8")) as Manifest;
const facesCss = readFileSync(resolve(fontsDir, "faces.css"), "utf8");

// The faces GACHA_PLAN §1 pins, plus the dossier NAME pair added 2026-08-06 off R17. Hard-coded HERE (not
// read from the manifest) on purpose: the manifest is the generator's output, so checking it against itself
// would prove nothing.
//
// The name faces are **latin-only**, and that is the contract rather than an omission: they are Latin-only
// designs, the role paints host names, and a `text=` request for the frozen JP glyphs against a font with
// no Japanese returns a file of .notdefs carrying a `unicode-range` that would then shadow the real JP
// faces for those codepoints. Runtime Japanese falls to the system stack by design (council L12).
const RULED_FACES = [
  { family: "Zen Kaku Gothic New", weights: [400, 500, 700, 900], subsets: ["jp", "latin"] },
  { family: "Shippori Mincho B1", weights: [600, 800], subsets: ["jp", "latin"] },
  { family: "Bungee", weights: [400], subsets: ["latin"] },
  { family: "Zen Maru Gothic", weights: [900], subsets: ["latin"] },
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
  it("ships exactly the ruled subsets for each ruled face — and nothing else", () => {
    for (const { family, weights, subsets } of RULED_FACES) {
      for (const weight of weights) {
        for (const subset of subsets) {
          const entry = manifest.files.find(
            (f) => f.family === family && f.weight === weight && f.subset === subset,
          );
          expect(entry, `no ${subset} file for ${family} ${weight}`).toBeTruthy();
        }
        // …and NO file outside them: a latin-only face that grew a `jp` sibling means someone dropped the
        // `subsets` field, and its .notdef `unicode-range` would shadow the real JP faces.
        const extra = manifest.files.filter(
          (f) => f.family === family && f.weight === weight && !subsets.includes(f.subset),
        );
        expect(
          extra.map((f) => f.file),
          `unruled subset file for ${family} ${weight}`,
        ).toEqual([]);
      }
      // The generator's own record of the face has to agree with the ruling too.
      expect(manifest.faces.find((f) => f.family === family)).toEqual({
        family,
        weights,
        subsets,
      });
    }
    expect(manifest.files).toHaveLength(
      RULED_FACES.reduce((n, f) => n + f.weights.length * f.subsets.length, 0),
    );
  });

  it("every manifest entry exists on disk at the recorded size AND the recorded hash", () => {
    for (const f of manifest.files) {
      const bytes = readFileSync(resolve(fontsDir, f.file));
      expect(statSync(resolve(fontsDir, f.file)).size, `${f.file} size drifted`).toBe(f.bytes);
      // THE CONTENT, not just its length (Codex wave-12 #4). Size + topology let a wrong-but-same-size
      // woff2 through — a truncated-then-padded download, a file swapped between two weights, or a
      // manifest that faithfully recorded a bad fetch. The hash is what makes "the committed bytes are
      // the generated bytes" checkable rather than assumed.
      expect(
        createHash("sha256").update(bytes).digest("hex"),
        `${f.file} CONTENT differs from the manifest — re-run \`npm run fonts:gacha\` and commit, or restore the file`,
      ).toBe(f.sha256);
    }
    expect(manifest.files.reduce((n, f) => n + f.bytes, 0)).toBe(manifest.totalBytes);
    // …and every entry must actually carry one, so a hand-edited manifest cannot opt a file out.
    for (const f of manifest.files)
      expect(f.sha256, `${f.file} has no sha256`).toMatch(/^[0-9a-f]{64}$/);
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

describe("the NAME face's prewarm follows the SETTING (Codex wave-12 #2)", () => {
  // A fixed probe list was wrong in both directions: every DEFAULT user downloaded and awaited a Bungee
  // they never paint, and a synced `maru` was not warmed at all — so activation could finish before Zen
  // Maru was ready and the dossier name would land in the fallback and swap under the owner, which is the
  // exact FOUT this module exists to prevent.
  //
  // Since the owner's 2026-08-07 surface split there are TWO axes (`nameFont` → dossier, `cardNameFont` →
  // capsule plate) reading ONE value-keyed map, so the cases below run over both option lists.
  const options = gacha.settings?.nameFont;
  const cardOptions = gacha.settings?.cardNameFont;
  const values = [
    ...(options?.type === "seg" ? options.options.map((o) => o.val) : []),
    ...(cardOptions?.type === "seg" ? cardOptions.options.map((o) => o.val) : []),
  ];

  it("warms exactly the selected alternate — and nothing for the default", () => {
    // `mincho` IS `--font-display`, already covered by Shippori's two weights in the primary warm list.
    expect(nameFaceProbes("mincho")).toEqual([]);
    expect(nameFaceProbes("bungee")).toEqual(["400 1em 'Bungee'"]);
    expect(nameFaceProbes("maru")).toEqual(["900 1em 'Zen Maru Gothic'"]);
  });

  it("covers EVERY declared option — a new face cannot ship unwarmed", () => {
    expect(values.length).toBeGreaterThan(0);
    // NOT `toBeDefined()` — `nameFaceProbes` returns `[]` for unknown values BY CONTRACT (the runtime
    // degradation path), so that assertion was vacuous (Codex R19 LOW-3). The real invariant: every
    // declared option except `mincho` (empty BY DESIGN — it IS `--font-display`, warmed in the primary
    // list) must map to at least one probe, so an option added without a NAME_FACE entry fails here.
    for (const v of values)
      if (v !== "mincho")
        expect(
          nameFaceProbes(v).length,
          `"${v}" is a declared option with no NAME_FACE entry — it would ship unwarmed`,
        ).toBeGreaterThan(0);
    // …and every probe it does name must be a face the manifest actually ships, at that weight.
    const shipped = new Map(manifest.faces.map((f) => [f.family, f.weights]));
    for (const v of values) {
      for (const probe of nameFaceProbes(v)) {
        const [, weight, family] = /^(\d+) 1em '(.+)'$/.exec(probe.replace(/^(\d+)/, "$1")) ?? [];
        const w = Number(/^(\d+)/.exec(probe)![1]);
        const fam = /'([^']+)'/.exec(probe)![1];
        expect(shipped.get(fam), `${v} warms ${fam}, which the manifest does not ship`).toContain(
          w,
        );
        void weight;
        void family;
      }
    }
  });

  it("warms nothing for an unknown value — it degrades with the CSS, not against it", () => {
    // A stale sync from a future build resolves to the default in `resolveThemeSetting`, and the stack
    // falls through to `--font-display`; warming a guess would fetch bytes nothing paints.
    expect(nameFaceProbes("bogus")).toEqual([]);
    expect(nameFaceProbes(undefined)).toEqual([]);
  });
});

describe("loadFonts warms the UNION of BOTH name axes (the owner's 2026-08-07 surface split)", () => {
  // The mapping above is pure; THIS is the wiring — which is where the split could regress silently, in
  // either of two directions: warming only `nameFont` leaves a picked card face unwarmed (the FOUT), and
  // warming Bungee unconditionally (as the interim card PIN required) puts a face nobody paints on the
  // activation critical path for anyone who moves both axes off it.
  //
  // jsdom has no `document.fonts`, so the real module's calls are swallowed by its own try/catch — the
  // probe recorder below is what makes them observable. Latin-only: every bilingual face in the primary
  // warm list is also probed with the frozen JP text, and the name faces are latin-only by contract.
  async function latinProbes(settings: Record<string, string>): Promise<string[]> {
    const seen: string[] = [];
    Object.defineProperty(document, "fonts", {
      configurable: true,
      value: {
        load: (font: string, text?: string) => {
          if (text === undefined) seen.push(font);
          return Promise.resolve([]);
        },
      },
    });
    setUI({ themeSettings: { gacha: settings } });
    await loadFonts();
    return seen;
  }

  afterEach(() => {
    Reflect.deleteProperty(document, "fonts");
    setUI({ themeSettings: {} });
  });

  it("warms Bungee for a DEFAULT install — the card axis ships on it", async () => {
    // An untouched install resolves `cardNameFont` to `bungee` (the extracted pin), so the plates paint
    // it on every boot and it must be ready before activation. `nameFont` still defaults to the serif,
    // which is `--font-display` and already covered by Shippori's two weights.
    const seen = await latinProbes({});
    expect(seen).toContain("400 1em 'Bungee'");
    expect(seen).not.toContain("900 1em 'Zen Maru Gothic'");
  });

  it("warms BOTH faces when the two surfaces differ, and one when they agree", async () => {
    const split = await latinProbes({ nameFont: "maru", cardNameFont: "bungee" });
    expect(split).toContain("900 1em 'Zen Maru Gothic'");
    expect(split).toContain("400 1em 'Bungee'");
    // …and the union DEDUPES: the same face asked for by both axes is one probe, not two.
    const same = await latinProbes({ nameFont: "bungee", cardNameFont: "bungee" });
    expect(same.filter((p) => p === "400 1em 'Bungee'")).toHaveLength(1);
  });

  it("warms NEITHER alternate when both axes sit on the serif — Bungee is no longer unconditional", async () => {
    // The regression guard on the pin's removal: while the plate hardcoded Bungee, the warm list carried
    // it for everyone. With both axes on `mincho` nothing outside the primary list may be fetched.
    const seen = await latinProbes({ nameFont: "mincho", cardNameFont: "mincho" });
    expect(seen).not.toContain("400 1em 'Bungee'");
    expect(seen).not.toContain("900 1em 'Zen Maru Gothic'");
  });
});
