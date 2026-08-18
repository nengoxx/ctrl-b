// Generate PWA icon fan-out from src/assets/vapor-logo.png.
//
// Sources one logo (any aspect), centers it on a square transparent canvas, exports the sizes
// the manifest references (into public/). The in-app logo itself is untouched — since D51 V4 it is a
// BUNDLED asset (`src/assets/vapor-logo.png`, imported by themes/vapor/VaporMark.tsx → hashed, and
// SW-precached via the targeted `assets/vapor-logo-*.png` workbox glob in vite.config.ts) rather
// than a bare public/ file, so this generator sources it from there.
// Cross-platform (Linux/macOS/Windows) — sharp ships per-platform native binaries via npm.
//
// Run from frontend/:  npm run icons   (or `node scripts/gen-pwa-icons.mjs`)

import { createHash } from "node:crypto";
import { stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = join(__dirname, "..", "public");
const src = join(__dirname, "..", "src", "assets", "vapor-logo.png");

await stat(src).catch(() => {
  throw new Error(`missing source icon: ${src}`);
});

/** `#rrggbb` → sharp's opaque background object (its `alpha` is 0–1, not 0–255). */
function opaque(hex) {
  const n = parseInt(hex.slice(1), 16);
  return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff, alpha: 1 };
}

const TRANSPARENT = { r: 0, g: 0, b: 0, alpha: 0 };

/**
 * Render one icon to a PNG buffer: square `size×size`, centered logo at `scale` of canvas, padded with
 * `bg`. `scale = 1.0` fills canvas; `0.78` leaves room for Android's maskable safe zone.
 *
 * `bg` fills the CANVAS — transparent for the `any` icons (favicon-style, per web.dev: they serve tabs,
 * bookmark tiles, desktop installs and the splash), opaque for the maskable BACKDROP variants: the W3C
 * spec REQUIRES a UA to composite a transparent maskable icon onto a solid fill of its choice, and
 * Chrome's WebAPK shell hard-codes that fill to #FFFFFF (R28 §2/§3.2 — the white box the owner sees).
 *
 * Buffer-first (not `.toFile`) so the stable-URL guard below can hash a candidate WITHOUT writing it.
 */
function renderIcon(size, scale, bg = TRANSPARENT) {
  const inner = Math.round(size * scale);
  return (
    sharp(src)
      // The contain-pad stays TRANSPARENT whatever `bg` is: the fill belongs to the canvas below, so the
      // logo's own aspect padding never paints a second, differently-sized rectangle of backdrop.
      .resize(inner, inner, { fit: "contain", background: TRANSPARENT })
      .toBuffer()
      .then((resized) =>
        sharp({ create: { width: size, height: size, channels: 4, background: bg } })
          .composite([{ input: resized, gravity: "center" }])
          .png({ compressionLevel: 9 })
          .toBuffer(),
      )
  );
}

async function emit(buf, outName, size) {
  await writeFile(join(publicDir, outName), buf);
  console.log(
    `wrote ${outName.padEnd(28)} (${size}x${size})  ${buf.length.toLocaleString()} bytes`,
  );
}

/** Render + write. */
async function writeIcon(size, scale, outName, bg = TRANSPARENT) {
  await emit(await renderIcon(size, scale, bg), outName, size);
}

// ── The STABLE-URL GUARD (D59 / W5) — runs FIRST, before anything is written ────────────────────────
//
// `icon-maskable-512.png` is the DEFAULT variant, and its BYTES are load-bearing: Chrome 144+ never
// re-downloads an icon URL it has already minted, so an owner who stays on "Clear" must keep both the
// filename and the exact bytes, or nothing happens on their phone while the repo quietly disagrees with
// what is installed. This hash pins the committed file. A mismatch means the SOURCE LOGO or the sharp/
// libpng encoder moved under us — a real event that needs a decision (re-pin + accept one icon-update
// prompt for every owner on Clear), never a silent regenerate. So: refuse, write nothing, exit 1.
const STABLE_MASKABLE = "icon-maskable-512.png";
const STABLE_MASKABLE_SHA256 = "688c929de6b245821f31fa3c8552ca38381d9713ac0bed2874c1766aa8170459";
const stableCandidate = await renderIcon(512, 0.78, TRANSPARENT);
const stableSha = createHash("sha256").update(stableCandidate).digest("hex");
if (stableSha !== STABLE_MASKABLE_SHA256) {
  console.error(
    `\n${STABLE_MASKABLE}: the committed transparent maskable is the stable-URL guarantee — ` +
      `encoder/source drift detected; investigate before regenerating.\n` +
      `  expected ${STABLE_MASKABLE_SHA256}\n  rendered ${stableSha}\n` +
      `Nothing was written. If the new bytes are intended, re-pin STABLE_MASKABLE_SHA256 in this ` +
      `script and expect every installed app on "Clear" to show one "Review app update" prompt.\n`,
  );
  process.exit(1);
}

// 48px: Chrome-Android's bookmark/home-screen shortcut tiles want explicit PNG `rel=icon` sizes
// (48 + 192, multiples of 48 per the Chrome guidance) — it ignores the .ico for those tiles
// (Firefox uses the .ico, which is why the gap only showed in Chrome). Declared in index.html.
await writeIcon(48, 0.96, "icon-48.png");
await writeIcon(192, 0.96, "icon-192.png");
await writeIcon(256, 0.96, "icon-256.png");
await writeIcon(512, 0.96, "icon-512.png");
// Maskable: Android crops icons into circle/squircle — keep the brand mark inside the 80%
// safe zone (W3C maskable spec) so the crop never clips it. This is the hash-verified buffer from the
// guard above — do not retune its scale; a new look is a new variant below, with a new filename.
await emit(stableCandidate, STABLE_MASKABLE, 512);

// The opaque BACKDROP variants (D59 / W5) — same art, one baked-in background each, selected by the owner
// in Conf → Appearance and served through `/manifest.webmanifest` (backend `app/core/pwa.py` holds the
// id → filename map; the ids here ARE those keys). 0.62 — not the legal maximum 0.78 — is what shipped
// maskable icons actually do (R28 §6: X 0.615, Squoosh 0.598); a full-bleed backdrop wants a smaller mark.
const MASKABLE_BACKDROPS = {
  ink: "#0a0a0d", // the manifest's own background_color/theme_color (a mirror of cosmos `--bg`)
  night: "#0a0b19", // gacha's arcade near-black (its tokens.css `--bg`, index.html's bootBg literal)
  orchid: "#2a1336", // a deep violet, for the mark to sit on colour rather than on black
  paper: "#e5e3df", // the light option — the only one that reads on a light launcher wallpaper
};
for (const [id, hex] of Object.entries(MASKABLE_BACKDROPS)) {
  await writeIcon(512, 0.62, `icon-maskable-512-${id}.png`, opaque(hex));
}

// iOS composites a transparent apple-touch-icon onto BLACK (R28 §8), so bake the background in. Apple
// ignores the manifest entirely, which is why this is one fixed file rather than a fifth variant: the
// selector only reaches the WebAPK path. Linked from index.html.
await writeIcon(180, 0.75, "apple-touch-icon-180.png", opaque(MASKABLE_BACKDROPS.ink));
