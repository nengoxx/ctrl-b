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

import { stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = join(__dirname, "..", "public");
const src = join(__dirname, "..", "src", "assets", "vapor-logo.png");

await stat(src).catch(() => {
  throw new Error(`missing source icon: ${src}`);
});

/**
 * Write one icon: square `size×size`, centered logo at `scale` of canvas, transparent padding.
 * `scale = 1.0` fills canvas; `0.78` leaves room for Android's maskable safe zone.
 */
async function writeIcon(size, scale, outName) {
  const inner = Math.round(size * scale);
  const resized = await sharp(src)
    .resize(inner, inner, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .toBuffer();

  const out = join(publicDir, outName);
  await sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([{ input: resized, gravity: "center" }])
    .png({ compressionLevel: 9 })
    .toFile(out);

  const { size: bytes } = await stat(out);
  console.log(`wrote ${outName.padEnd(28)} (${size}x${size})  ${bytes.toLocaleString()} bytes`);
}

await writeIcon(192, 0.96, "icon-192.png");
await writeIcon(256, 0.96, "icon-256.png");
await writeIcon(512, 0.96, "icon-512.png");
// Maskable: Android crops icons into circle/squircle — keep the brand mark inside the 80%
// safe zone (W3C maskable spec) so the crop never clips it.
await writeIcon(512, 0.78, "icon-maskable-512.png");
