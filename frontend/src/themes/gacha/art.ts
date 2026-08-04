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
// on Gecko. The bake reproduces exactly those two shadows, pre-divided by the figure's DISPLAY scale
// (~0.65 of the asset at the `--gc-figure-h` default), so what lands on screen matches the prototype's
// CSS: a CSS blur radius R is a Gaussian of sigma R/2, hence 30px→15→23 and 22px→11→17 in asset space,
// and the dark shadow's 10px y-offset becomes 15. `PAD` is the canvas the blur needs (3 sigma + offset),
// added at the top and sides only — the figure is bottom-anchored, so a bottom margin would just lift it
// off its floor. 711x828, ~97 KB.
//
//   node --input-type=module -e '
//   import sharp from "sharp";
//   const S = "../design/prototypes/gacha/uploads/prot/assets/gacha/lyra-cutout.png";
//   const O = "src/themes/gacha/art/lyra-cutout.webp";
//   const PAD = 88, SHADOWS = [{s:23,o:.6,dy:15,c:{r:0,g:0,b:0}},{s:17,o:.4,dy:0,c:{r:255,g:108,b:174}}];
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
