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
//     ["lyra-cutout.png","lyra-cutout.webp",720,1000,72,"inside",true],
//     ["bg-fleet.jpg","banner.webp",1240,700,70,"cover",false],
//     ["bg-eye.png","oracle.webp",1240,700,70,"cover",false]];
//   for (const [s,o,w,h,q,fit,alpha] of jobs)
//     await sharp(`${S}/${s}`).resize(w,h,{fit,withoutEnlargement:true})
//       .webp(alpha?{quality:q,alphaQuality:90}:{quality:q}).toFile(`${O}/${o}`);'
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

export const ART = {
  characters: CHARACTER_KEYS.map(byName),
  /** The transparent cutout the reel figure uses (G4) — a different asset KIND, not a crop. */
  cutout: byName("lyra-cutout"),
  /** Landscape scene art: the pickup banner / fleet wallpaper, and the agent oracle's backdrop. */
  banner: byName("banner"),
  oracle: byName("oracle"),
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
