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
import { createHash } from "node:crypto";
import { mkdir, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { gachaGlyphSet } from "../src/themes/gacha/copy.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, "..", "src", "themes", "gacha", "fonts");
// ── ATOMIC OUTPUT (Codex wave-12 #3) ─────────────────────────────────────────────────────────────────
// Everything is generated into a TEMP SIBLING and swapped in only once every fetch, write and format has
// succeeded. The old shape emptied the committed directory FIRST and then went to the network, so a failed
// request, a 4xx, or a prettier that would not start left tracked faces missing or half-updated — a state
// the guard test can only report after the damage, and one that is easy to commit by accident. A sibling
// (not /tmp) keeps the swap on the same filesystem, so the final `rename` is atomic.
const stageDir = `${outDir}.staging`;

// A desktop-Chrome UA is what makes the API answer with woff2 rather than a legacy format.
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) " +
  "Chrome/120.0.0.0 Safari/537.36";
const API = "https://fonts.googleapis.com/css2";

// A face that says nothing else takes both halves — the frozen JP subset AND the font's full latin.
const BOTH_SUBSETS = ["jp", "latin"];

// The faces the theme ships (GACHA_PLAN §1): Zen Kaku Gothic New carries body + the heavy display weights;
// Shippori Mincho B1 is the serif JP accent face (subtitles, headings, nav sub-labels).
//
// `subsets` is OPTIONAL and defaults to both (the extend-don't-migrate shape: one face object grows a
// field rather than the table splitting into two lists). It exists for the DOSSIER NAME face, added
// 2026-08-06 off R17: that role paints host names and hostnames, which are Latin, and its candidates are
// Latin-only designs — asking the CSS2 API for a JP `text=` subset of a font with no Japanese returns a
// file of .notdefs, i.e. dead bytes plus a `unicode-range` that would shadow the real JP faces for those
// codepoints. Runtime Japanese in a host name falls to the system stack by design (council L12), exactly
// as it already does for every non-frozen glyph.
const FACES = [
  { family: "Zen Kaku Gothic New", slug: "zen-kaku-gothic-new", weights: [400, 500, 700, 900] },
  { family: "Shippori Mincho B1", slug: "shippori-mincho-b1", weights: [600, 800] },
  // The dossier NAME face (`--gc-dossier-name-font`) and its switchable alternate. Bungee is the shipped
  // pick (owner, 2026-08-06); Zen Maru Gothic 900 is the one-line switch documented beside the token —
  // declared here so the swap is a token edit, never a regeneration. An unused @font-face costs nothing:
  // the browser fetches a face only when something paints in it.
  { family: "Bungee", slug: "bungee", weights: [400], subsets: ["latin"] },
  { family: "Zen Maru Gothic", slug: "zen-maru-gothic", weights: [900], subsets: ["latin"] },
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

// Start from a clean STAGING directory so a REMOVED face can't leave an orphan woff2 behind (the manifest
// would then disagree with what's on disk, and the guard test would be measuring a ghost).
await rm(stageDir, { recursive: true, force: true });
await mkdir(stageDir, { recursive: true });

const files = [];
for (const { family, slug, weights, subsets = BOTH_SUBSETS } of FACES) {
  // Reject an unknown subset rather than silently treating it as `latin` (Codex wave-12 #3): the branch
  // below is `subset === "jp" ? … : latin`, so a typo would quietly ship a Latin file labelled something
  // else — and the manifest would faithfully record the wrong thing.
  for (const subset of subsets) {
    if (!BOTH_SUBSETS.includes(subset))
      throw new Error(
        `${family}: unknown subset "${subset}" (expected ${BOTH_SUBSETS.join(" | ")})`,
      );
  }
  const famParam = family.replace(/ /g, "+");
  for (const weight of weights) {
    for (const subset of subsets) {
      const params =
        `family=${famParam}:wght@${weight}&display=swap` +
        (subset === "jp" ? `&text=${encodeURIComponent(text)}` : "");
      const css = await fetchCss(params);
      const face = subset === "jp" ? firstFace(css) : latinFace(css);
      const buf = await download(face.url);
      const file = `${slug}-${weight}-${subset}.woff2`;
      await writeFile(join(stageDir, file), buf);
      files.push({
        file,
        family,
        weight,
        subset,
        bytes: buf.length,
        // The CONTENT, not just its length (Codex wave-12 #4): a wrong-but-same-size woff2 — or a manifest
        // that faithfully records a bad download — passes every size/topology check. The guard asserts
        // these against the bytes on disk, so the committed files are pinned to what was generated.
        sha256: createHash("sha256").update(buf).digest("hex"),
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
await writeFile(join(stageDir, "faces.css"), css);

const totalBytes = files.reduce((n, f) => n + f.bytes, 0);
await writeFile(
  join(stageDir, "manifest.json"),
  JSON.stringify(
    {
      generatedBy: "scripts/gen-theme-fonts.mjs",
      source: "Google Fonts CSS2 API (text= subsetting for jp, the /* latin */ block for latin)",
      glyphSource: "src/themes/gacha/copy.ts#gachaGlyphSet",
      glyphs: text,
      glyphCount: glyphs.length,
      faces: FACES.map(({ family, weights, subsets = BOTH_SUBSETS }) => ({
        family,
        weights,
        subsets,
      })),
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
  ["--write", join(stageDir, "faces.css"), join(stageDir, "manifest.json")],
  { stdio: "inherit" },
);
if (fmt.status !== 0) {
  throw new Error(
    "prettier --write failed on the generated files (run `npm install` in frontend/)",
  );
}

// EVERYTHING SUCCEEDED — swap the staging directory in. `rename` cannot merge onto an existing path, so
// the old directory goes first; both live on the same filesystem, so this is two metadata operations and
// the window where neither exists is not a network round-trip wide.
await rm(outDir, { recursive: true, force: true });
await rename(stageDir, outDir);

const onDisk = (await readdir(outDir)).length;
console.log(
  `\n${files.length} woff2 + faces.css + manifest.json (${onDisk} files) — ` +
    `${totalBytes.toLocaleString()} bytes total, ${glyphs.length} frozen JP glyphs`,
);
await stat(join(outDir, "faces.css")); // fail loudly if the write silently produced nothing
