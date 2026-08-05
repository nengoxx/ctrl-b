// Frontier art manifest (F2, D29 §9.9). THIS FILE IS THE PLACEHOLDER→FINAL-ART SWAP CONTRACT: the ten PNGs
// under ./art/ (hero, rig1..rig6, cube-only, platform-mid, platform-base) are the current placeholders; the
// finished Mœbius art drops in under the SAME filenames with ZERO code changes. Aspect expectations the art
// is authored to: hero ≈ the map-card cover (a wide badlands vista, 248px-tall card), rigs ≈ 1.18 (the grid
// card's aspect-ratio). All art is consumed as `background-image` on an explicitly-dimensioned box (never a
// bare <img>) — so a slow decode can't reflow the page (no CLS), and the fixed card/grid geometry holds
// through load. cube-only + platform-{mid,base} are the F4 rig-STACK layers, exported now so F4 needs no new
// manifest (Open/Closed — one asset source of truth for the whole theme).
//
// EAGER URL STRINGS (not lazy thunks): Vite 8's non-eager `import.meta.glob` maps don't reach the build
// manifest (the URLs would be undefined in a production build), so this glob is `eager`. `query:"?url"` pins
// each asset as a hashed URL string — without it a small PNG could be inlined as a base64 data-URI on one
// build and a URL on the next (Vite's `assetsInlineLimit`), flipping the manifest shape between builds.

// Vite already types an eager `import:"default"` + `?url` glob as Record<string, string>, so the annotation
// is documentary — no cast needed (the review's intent: the map is string URLs, not lazy thunks).
const urls: Record<string, string> = import.meta.glob("./art/*.png", {
  eager: true,
  import: "default",
  query: "?url",
});

/** name → hashed URL, for a filename like `rig1`/`hero`/`cube-only`. */
function byName(name: string): string {
  const key = Object.keys(urls).find((k) => k.endsWith(`/${name}.png`));
  if (key === undefined) throw new Error(`frontier art: missing ./art/${name}.png`);
  return urls[key];
}

// The bundled rig pool's key order: present() names position i's rig as `RIG_KEYS[i % 6]`, and that key
// is the LAST rung of a card's art ladder (an owner `media/frontier/rigs/` file for the position wins —
// ownerArt.ts). It was also the `appearance.frontier.image` per-host override's vocabulary until D53 M2
// RETIRED that override; the owner's own rig pool replaces it.
export const RIG_KEYS = ["rig1", "rig2", "rig3", "rig4", "rig5", "rig6"] as const;

// The PARTITIONED manifest (adversarial-review rule): the modulo pool present() cycles through is `rigs`
// ONLY — hero + the F4 stack layers live in their own partitions and can NEVER be assigned to a beacon/card
// by `index % RIG_KEYS.length`. `rigs` is in NUMERIC order (RIG_KEYS is already ordered) so `index → rig`
// is stable and legible.
export const ART = {
  hero: byName("hero"),
  rigs: RIG_KEYS.map(byName),
  stack: {
    cube: byName("cube-only"),
    mid: byName("platform-mid"),
    base: byName("platform-base"),
  },
} as const;

// The raw name→url map for `ThemeDef.assets` (the eager glob URL map, §9.3). Keyed by bare filename (no
// extension) so a consumer can address any asset by name; the theme's CSS references these URLs.
export const assets: Record<string, string> = Object.fromEntries(
  Object.keys(urls).map((k) => [
    k
      .split("/")
      .pop()!
      .replace(/\.png$/, ""),
    urls[k],
  ]),
);
