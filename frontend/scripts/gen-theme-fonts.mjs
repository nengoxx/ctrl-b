// Generate the gacha theme's COMMITTED font subsets (D52 / GACHA_PLAN §10.4).
//
// Run from frontend/:  npm run fonts:gacha   (or `node scripts/gen-theme-fonts.mjs`)
// Outputs (all COMMITTED — this script is not part of the build):
//   src/themes/gacha/fonts/*.woff2        the subset files
//   src/themes/gacha/fonts/faces.css      the generated @font-face block the theme lazy-imports
//   src/themes/gacha/fonts/manifest.json  what was generated, from what, at what size
//
// ── WHY A SCRIPT AT ALL ───────────────────────────────────────────────────────────────────────────
// The naive path — importing @fontsource's Japanese CSS — was REJECTED on measurement (§10.4): the
// numbered JP splits × the needed weights are ~757 KB of woff2 over ~72 requests on first render, and
// ~31 MB / 1,188 files added to `dist`. The theme's Japanese is a FROZEN, compile-time set of 68
// characters (`src/themes/gacha/copy.ts`), so it ships as a frozen build-time subset instead. The
// Latin half is NOT frozen (host names, English UI copy), so each face also gets the font's full
// `latin` subset — the same file @fontsource repackages, ~10 KB (Zen Kaku) / ~32 KB (Shippori).
//
// ── REPRODUCIBILITY (the honest contract) ─────────────────────────────────────────────────────────
// Both halves are fetched from the Google Fonts CSS2 API at GENERATION time — the JP half via its
// `text=` parameter (Google's own subsetter, which returns a woff2 containing exactly those glyphs),
// the Latin half by picking the `/* latin */` block out of the normal response. Nothing is fetched at
// build time or at runtime: the outputs are committed and self-hosted, so the app makes no
// third-party request and works offline, exactly like the @fontsource themes.
//   · The INPUT is fully determined by `gachaGlyphSet()` + the FACES table below — re-running with an
//     unchanged copy module asks Google for the same subset.
//   · The OUTPUT bytes are whatever font version Google serves that day. That is why the files are
//     COMMITTED: what ships is pinned by git, not by a fetch. Regenerate deliberately, and read the
//     size diff in the manifest before committing.
//   · Chosen over the @fontsource packages (§10.4's letter) because those two packages weigh 112 MB
//     of node_modules — and therefore of every CI install — for 6 Latin files totalling ~104 KB that
//     git can hold directly. Same upstream bytes, same self-hosting, none of the dependency weight.
//
// ── EDITING THE THEME'S JAPANESE ──────────────────────────────────────────────────────────────────
// Add the string to `src/themes/gacha/copy.ts`, re-run this script, commit the outputs. If you skip
// the re-run, `tests/themes/gachaFonts.test.ts` fails: it re-derives the glyph set from the copy
// module and checks it against the committed manifest. That guard is what keeps "frozen" changeable.
// RUNTIME Japanese (host names, roster names, chat text) falls back to the system JP stack in
// `--font-body`'s tail BY DESIGN (council L12) — it is not in scope for this subset.

import { spawnSync } from "node:child_process";
import { mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { gachaGlyphSet } from "../src/themes/gacha/copy.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, "..", "src", "themes", "gacha", "fonts");

// A desktop-Chrome UA is what makes the API answer with woff2 rather than a legacy format.
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) " +
  "Chrome/120.0.0.0 Safari/537.36";
const API = "https://fonts.googleapis.com/css2";

// The six faces the theme uses (GACHA_PLAN §1): Zen Kaku Gothic New carries body + the heavy display
// weights; Shippori Mincho B1 is the serif JP accent face (subtitles, headings, nav sub-labels).
const FACES = [
  { family: "Zen Kaku Gothic New", slug: "zen-kaku-gothic-new", weights: [400, 500, 700, 900] },
  { family: "Shippori Mincho B1", slug: "shippori-mincho-b1", weights: [600, 800] },
];

/** Fetch a CSS2 response as text, or throw with the status (a silent 4xx would write a broken file). */
async function fetchCss(params) {
  const url = `${API}?${params}`;
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return res.text();
}

/** Pull `{ url, unicodeRange }` out of the FIRST @font-face in a CSS2 response (the `text=` form
 *  always returns exactly one). */
function firstFace(css) {
  const url = css.match(/url\((https:[^)]+)\)/)?.[1];
  const unicodeRange = css.match(/unicode-range:\s*([^;]+);/)?.[1]?.trim();
  if (!url) throw new Error(`no @font-face url in:\n${css}`);
  return { url, unicodeRange };
}

/** Pull the `/* latin *\/`-commented @font-face out of a multi-subset CSS2 response. */
function latinFace(css) {
  const block = [...css.matchAll(/\/\*\s*([a-z0-9-]+)\s*\*\/\s*@font-face\s*\{([\s\S]*?)\}/g)].find(
    (m) => m[1] === "latin",
  );
  if (!block) throw new Error(`no /* latin */ block in:\n${css}`);
  return firstFace(block[2]);
}

async function download(url) {
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

const glyphs = gachaGlyphSet();
if (glyphs.length === 0) throw new Error("gachaGlyphSet() is empty — nothing to subset");
const text = glyphs.join("");

// Start from a clean directory so a REMOVED face can't leave an orphan woff2 behind (the manifest
// would then disagree with what's on disk, and the guard test would be measuring a ghost).
await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });

const files = [];
for (const { family, slug, weights } of FACES) {
  const famParam = family.replace(/ /g, "+");
  for (const weight of weights) {
    for (const subset of ["jp", "latin"]) {
      const params =
        `family=${famParam}:wght@${weight}&display=swap` +
        (subset === "jp" ? `&text=${encodeURIComponent(text)}` : "");
      const css = await fetchCss(params);
      const face = subset === "jp" ? firstFace(css) : latinFace(css);
      const buf = await download(face.url);
      const file = `${slug}-${weight}-${subset}.woff2`;
      await writeFile(join(outDir, file), buf);
      files.push({
        file,
        family,
        weight,
        subset,
        bytes: buf.length,
        unicodeRange: face.unicodeRange ?? null,
      });
      console.log(`wrote ${file.padEnd(38)} ${buf.length.toLocaleString().padStart(8)} bytes`);
    }
  }
}

// The @font-face sheet the theme lazy-imports. `unicode-range` is carried through verbatim so the
// browser fetches the JP file ONLY when JP text is painted (and the Latin file only for Latin) —
// without it, one of the two would always be dead weight. `font-display: swap` matches the repo's
// other themes: `loadFonts()` awaits `document.fonts.load` before the skin flips, so the swap window
// is normally never seen.
const css =
  `/* GENERATED by scripts/gen-theme-fonts.mjs — DO NOT EDIT BY HAND.\n` +
  ` * Regenerate with \`npm run fonts:gacha\` after editing src/themes/gacha/copy.ts.\n` +
  ` * The JP faces are frozen subsets of the theme's compile-time copy (${glyphs.length} glyphs);\n` +
  ` * the latin faces are the fonts' full latin subsets. Self-hosted — no third-party request. */\n\n` +
  files
    .map(
      ({ file, family, weight, unicodeRange }) =>
        `@font-face {\n` +
        `  font-family: "${family}";\n` +
        `  font-style: normal;\n` +
        `  font-weight: ${weight};\n` +
        `  font-display: swap;\n` +
        `  src: url("./${file}") format("woff2");\n` +
        (unicodeRange ? `  unicode-range: ${unicodeRange};\n` : "") +
        `}\n`,
    )
    .join("\n");
await writeFile(join(outDir, "faces.css"), css);

const totalBytes = files.reduce((n, f) => n + f.bytes, 0);
await writeFile(
  join(outDir, "manifest.json"),
  JSON.stringify(
    {
      generatedBy: "scripts/gen-theme-fonts.mjs",
      source: "Google Fonts CSS2 API (text= subsetting for jp, the /* latin */ block for latin)",
      glyphSource: "src/themes/gacha/copy.ts#gachaGlyphSet",
      glyphs: text,
      glyphCount: glyphs.length,
      faces: FACES.map(({ family, weights }) => ({ family, weights })),
      files,
      totalBytes,
    },
    null,
    2,
  ) + "\n",
);

// The generated text files are checked by the repo's `prettier --check .` gate like any other source,
// so format them here rather than hand-tuning the serializer to prettier's line-breaking rules.
const fmt = spawnSync(
  join(__dirname, "..", "node_modules", ".bin", "prettier"),
  ["--write", join(outDir, "faces.css"), join(outDir, "manifest.json")],
  { stdio: "inherit" },
);
if (fmt.status !== 0) {
  throw new Error(
    "prettier --write failed on the generated files (run `npm install` in frontend/)",
  );
}

const onDisk = (await readdir(outDir)).length;
console.log(
  `\n${files.length} woff2 + faces.css + manifest.json (${onDisk} files) — ` +
    `${totalBytes.toLocaleString()} bytes total, ${glyphs.length} frozen JP glyphs`,
);
await stat(join(outDir, "faces.css")); // fail loudly if the write silently produced nothing
