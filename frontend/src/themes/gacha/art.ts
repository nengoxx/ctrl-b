// gacha bundled art manifest (D52 / GACHA_PLAN §5.5) — the DEFAULT roster the theme falls back to, so it
// looks right on first boot before the owner has dropped a single file into `$CTRLB_HOME/media/gacha/`
// (the G5 runtime directory). Frontier's `art.ts` is the precedent, down to the eager-glob mechanics.
//
// EAGER URL STRINGS (not lazy thunks), `query: "?url"`: Vite's non-eager globs don't reach the build
// manifest (the URLs would be undefined in a production build), and `?url` pins each asset as a hashed URL
// rather than letting `assetsInlineLimit` flip a small file to a base64 data-URI between builds.
//
// PARTITIONED, the frontier rule: `characters` is the ONLY pool the per-host resolver cycles through, so the
// scene art (banner/wallpaper + the oracle backdrop) can never be dealt to a host as its capsule card. The
// roster SCHEMA (§5.2) lets a `slots` pin name any entry — this partition is about the DEFAULTS, not a
// restriction on what the owner may pin.
//
// ── REGENERATING THE COMMITTED WEBP SET ──────────────────────────────────────────────────────────────────
// Council M8 ruled OUT a maintained build script for seven fallback images that change only when the owner
// swaps art (unlike the FONT subset, whose script earns its keep on a measured 757 KB). The one-shot line
// that produced the files below, from the prototype's originals (6.5 MB of JPEG/PNG → 328 KB of WebP), run
// from `frontend/` with the repo's own `sharp` devDependency — targets per §10.4's table:
//
//   node --input-type=module -e '
//   import sharp from "sharp";
//   const S = "../design/prototypes/gacha/uploads/prot/assets/gacha", O = "src/themes/gacha/art";
//   const jobs = [
//     ["pegasus.jpg","pegasus.webp",640,854,72,"cover",false],
//     ["atlas.jpg","atlas.webp",640,854,72,"cover",false],
//     ["rook.png","rook.webp",640,854,72,"cover",false],
//     ["lyra.png","lyra.webp",640,854,72,"cover",false],
//     ["bg-fleet.jpg","banner.webp",1240,700,70,"cover",false],
//     ["bg-eye.png","oracle.webp",1240,700,70,"cover",false]];
//   for (const [s,o,w,h,q,fit,alpha] of jobs)
//     await sharp(`${S}/${s}`).resize(w,h,{fit,withoutEnlargement:true})
//       .webp(alpha?{quality:q,alphaQuality:90}:{quality:q}).toFile(`${O}/${o}`);'
//
// ── AND THE CUTOUT, which is a different job (G4) ─────────────────────────────────────────────────────────
// `lyra-cutout.webp` is not a resize: it is the reel FIGURE, and its glow is baked in at export time
// because the §10.1 rider bans the prototype's runtime `filter: drop-shadow(0 10px 30px #0009)
// drop-shadow(0 0 22px #ff6cae66)` — two static shadows on a large moving image re-rasterize every frame
// on Gecko. The bake reproduces those two shadows at the figure's DISPLAY scale (0.622 css px per asset px:
// a 460 px character from a 740 px source, the `--gc-figure-h` default), so what lands on screen matches
// what the prototype's CSS would have painted.
//
// THE SIGMA, settled by measurement (the G4 Codex round — the first bake halved it, and the halo shipped at
// half its intended reach). `drop-shadow()`'s blur length IS the Gaussian sigma; it does NOT follow
// box-shadow's sigma = R/2, which is what the two looking alike invites you to assume. On a hard-edged
// square, `drop-shadow(0 0 30px)` is PIXEL-IDENTICAL to `blur(30px)` (RMSE 0.0000, alpha under 0.01 at
// 62.4 px) in BOTH Chromium and Gecko, and nothing like `blur(15px)` (RMSE 0.0586, under 0.01 at 30.5 px).
// So the css sigmas here are 30 and 22 — not 15 and 11 — and in asset space 30/0.622→48 and 22/0.622→35,
// with the dark shadow's 10 px y-offset becoming 16.
//
// What that was worth, profiled against the prototype's real CSS at the same on-screen character size (mean
// composite alpha in distance bands around the silhouette): the halved bake held ~0.8x of the prototype's
// glow within 16 px and then collapsed — 0.19x in the 16-24 px band, 0.04x at 24-32, ZERO past 32 px, where
// the prototype still paints out to ~64. With the sigmas above it tracks the prototype through the bands
// that carry the look (1.25 / 1.24 / 1.07 / 0.87 out to 32 px) and keeps a thinner far tail (0.51x at
// 32-48 px, where alpha is ~0.03) — the one visible residue of Skia's tighter blur approximation.
//
// Filters do CHAIN — the pink `drop-shadow()` sees the dark one's OUTPUT, so it is technically cast by the
// figure PLUS its dark shadow. Baking that faithfully was tried and REJECTED on the same measurement: two
// true-Gaussian stages compound, and it overshoots to 1.4-1.5x the prototype's mean alpha in every near band
// (1.39x total glow ink, against 1.12x for the two-independent-shadows form below). Reproducing what the
// prototype PAINTS is the only thing this bake is for, so the simpler form stays.
//
// `PAD` is the canvas the blur needs (3 sigma + offset), added at the top and sides only — the figure is
// bottom-anchored, so a bottom margin would just lift it off its floor. 855x900, ~107 KB. Growing the pad is
// what moved `--gc-figure-h` (tokens.css): the character is now 0.82 of the element, so the token rose to
// keep it exactly the size the eyeball round settled on.
//
//   node --input-type=module -e '
//   import sharp from "sharp";
//   const S = "../design/prototypes/gacha/uploads/prot/assets/gacha/lyra-cutout.png";
//   const O = "src/themes/gacha/art/lyra-cutout.webp";
//   const PAD = 160, SHADOWS = [{s:48,o:.6,dy:16,c:{r:0,g:0,b:0}},{s:35,o:.4,dy:0,c:{r:255,g:108,b:174}}];
//   const fig = await sharp(S).ensureAlpha()
//     .extend({top:PAD,left:PAD,right:PAD,bottom:0,background:{r:0,g:0,b:0,alpha:0}}).png().toBuffer();
//   const {width:W,height:H} = await sharp(fig).metadata();
//   const glow = async ({s,o,c}) => sharp({create:{width:W,height:H,channels:3,background:c}})
//     .joinChannel(await sharp(fig).extractChannel("alpha").blur(s).linear(o,0).toColourspace("b-w")
//       .toBuffer()).png().toBuffer();
//   await sharp({create:{width:W,height:H,channels:4,background:{r:0,g:0,b:0,alpha:0}}})
//     .composite([...await Promise.all(SHADOWS.map(async g => ({input: await glow(g), top: g.dy, left: 0}))),
//                 {input: fig, top: 0, left: 0}])
//     .webp({quality:72,alphaQuality:90}).toFile(O);'
//
// The DECODE, not the transfer, is what this defends against: the prototype's atlas.jpg is 3000×4257 and
// decodes to ~51 MB of bitmap on the phone (§10.4). The owner's own runtime art gets no re-encode — the G5
// index endpoint warns about oversized files instead (no server-side decoder surface).
//
// ── AND THE CONSEQUENCE FOR OWNER DROPS (the G4 carry, settled at G5) ─────────────────────────────────────
// Nothing bakes a glow for a file dropped into `$CTRLB_HOME/media/gacha/reel/`: it is painted exactly as
// supplied. That is the deliberate trade — baking would mean a server-side decoder (rejected above) and the
// runtime `drop-shadow()` alternative is what the §10.1 rider bans — so a plain transparent PNG will read
// FLATTER than lyra does. The owner meets this where it matters rather than here: the Conf gallery's `reel`
// hint says so in the theme's own descriptor (index.tsx). Anyone wanting the bundled look can run the recipe
// above against their own cutout and drop the RESULT in.

const urls: Record<string, string> = import.meta.glob("./art/*.webp", {
  eager: true,
  import: "default",
  query: "?url",
});

/** name → hashed URL for a bare filename like `lyra` / `banner`. Throws at module load on a typo, which is
 *  what makes the glob a manifest rather than a source of silent `undefined` src attributes. */
function byName(name: string): string {
  const key = Object.keys(urls).find((k) => k.endsWith(`/${name}.webp`));
  if (key === undefined) throw new Error(`gacha art: missing ./art/${name}.webp`);
  return urls[key];
}

/** The bundled CHARACTERS, in the order the default roster deals them. `3`/`4` are the owner's own drops
 *  (G1 eyeball round 3 — "change both vault and g5"), converted through the same one-shot targets:
 *
 *    ["chars/3.jpg","3.webp",640,854,72,"cover",false],
 *    ["chars/4.png","4.webp",640,854,72,"cover",false],
 *    ["banner images/b2.png","b2.webp",1240,700,70,"cover",false],
 *    ["banner images/b3.png","b3.webp",1240,700,70,"cover",false]   // (b2/b3 = banner scene drops)
 *
 *  (sources under design/prototypes/gacha/). `lyra` stays LAST rather than leaving: with four hosts the
 *  tail entry is never dealt, but she is still the one entry carrying a cutout — removing her would
 *  silently kill the G4 reel figure's default. `rook` left the deal entirely; the file stays bundled for
 *  the G5 gallery. */
export const CHARACTER_KEYS = ["pegasus", "atlas", "3", "4", "lyra"] as const;

/** The owner's banner-art drops (G1 eyeball round 3), which ride the pickup carousel as EXTRA SLIDES
 *  beside the hero and the per-host promos — the owner's pick over cycling the hero's art. NAMED rather
 *  than a bare URL list because each one needs a stable slide KEY; what a scene's dot announces is its
 *  VISIBLE title, picked from the `SCENE_TITLES` pool by position, not this name.
 *  When G5's role-scoped media folders land, its banner folder feeds this same list: a one-line source
 *  swap, exactly like the roster's. */
export const SCENE_KEYS = ["b2", "b3"] as const;

export const ART = {
  characters: CHARACTER_KEYS.map(byName),
  /** The transparent cutout the reel figure uses (G4) — a different asset KIND, not a crop, and the one
   *  bundled image with its own lighting baked in (see the recipe above). */
  cutout: byName("lyra-cutout"),
  /** Landscape scene art: the pickup banner / fleet wallpaper, and the agent oracle's backdrop. */
  banner: byName("banner"),
  oracle: byName("oracle"),
  /** The banner's extra scene slides. PARTITIONED like `banner`/`oracle` and for the same reason: scene
   *  art is never an entry in the per-host cycle, so it can never be dealt to a machine as its capsule
   *  portrait (the frontier partition rule; the roster's own test pins it). */
  scenes: SCENE_KEYS.map((name) => ({ name, url: byName(name) })),
} as const;

/** The raw name→url map for `ThemeDef.assets` (§9.3), keyed by bare filename. */
export const assets: Record<string, string> = Object.fromEntries(
  Object.keys(urls).map((k) => [
    k
      .split("/")
      .pop()!
      .replace(/\.webp$/, ""),
    urls[k],
  ]),
);
