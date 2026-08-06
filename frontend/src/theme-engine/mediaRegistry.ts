// The FRONT-END media registry (D53 / MEDIA_PLAN §5 — the descriptor INVERSION). One module mirroring the
// backend's `MEDIA_NAMESPACES` (`core/media.py`): per namespace, the gallery copy that describes it, its
// roles (kind + hint + advisory bounds), and the `slots` pins it offers.
//
// It is the REGISTRY that owns this, not the ThemeDef (Opus H2). The descriptors used to hang off
// `ThemeDef.media`, which made "does this namespace have a gallery" a question about the active THEME — and
// the `kit` namespace belongs to no theme, so its row would have been unreachable under vapor/cosmos/minimal
// (three of five themes) while their service rows painted icons from it. A ThemeDef now carries only the
// LINK (`ThemeMedia.ns`); `applicableNs` below resolves what the Conf tab renders.
//
// Every row lives HERE rather than in its theme's module, exactly as the backend keeps every namespace in one
// dict. The alternative — each theme exporting its own row — would have the theme modules importing the
// shared bound constants back out of this module, and a registry↔theme import cycle is the one shape a
// module-scope map cannot survive (the store↛registry lesson).

import type { ThemeDef } from "./types";

/** What a role's files ARE, publicly (MEDIA_PLAN §2's two kinds). `pool` = the ordered list the server
 *  collates and the gallery reorders, where POSITION is the assignment. `named` = files binding to KEYS
 *  by casefolded stem (`lib/media.ts#resolveNamed`), where the FILENAME is the assignment and order
 *  buys nothing but the collision tie-break. */
export type MediaKind = "pool" | "named";

/** Advisory-only ceilings for the gallery's "consider resizing" badges. PER ROLE, because one global
 *  constant serves neither end (Opus M6): an icon role is oversized at kilobytes, a wallpaper role only at
 *  megapixels. They change nothing about what is served — which is why they are named constants here rather
 *  than config knobs (a setting for when to show a hint is a knob nobody would ever turn). */
export interface MediaBounds {
  bytes: number;
  pixels: number;
}

/** One KEY a `named` role's files can bind to, plus the words the owner needs to name a file for it.
 *
 *  The hint carries per-key GUIDANCE — for frontier's stack that is GEOMETRY (Codex MED: the three
 *  layers are painted into three very different boxes, so "any image" is a lie). It is hint TEXT rather
 *  than a structured `ref` field because nothing COMPUTES on it: the layers paint `background-size:
 *  contain`, so a wrong aspect letterboxes rather than distorts, and the only actor who can fix it is
 *  the person reading the sentence.
 *
 *  Declared keys are a STATIC list here; the other key source is data-derived (M3's service identities),
 *  which is why this is optional on the role rather than required by the kind. */
export interface MediaKeyDef {
  key: string;
  hint: string;
}

/** The live data a `named` role's keys are DERIVED from, when they are not a static list (MEDIA_PLAN §2's
 *  second key source). The gallery dispatches on this to fetch that data and annotate the keys with it —
 *  a descriptor field rather than an inference from "named with no `keys`", so the generic gallery never
 *  has to invent the knowledge of WHICH data a derived role means.
 *
 *  Two sources: the fleet's SERVICES (`lib/media.ts#keyFor` — kind, else name) and the fleet's MACHINES
 *  (`hostKeyFor` — the name). Each is one row in `theme-engine/mediaKeySources.ts`, which is where the
 *  data-fetch and the gallery's per-source wording live; the gallery itself branches on neither (Codex
 *  A1 — the third source must be a row, not a third branch). */
export type MediaKeySource = "services" | "hosts";

/** One role folder under `media/<ns>/`. The server's index is the authority on which roles EXIST; this
 *  supplies the words and the policy for them, because "what does `reel/` mean" is knowledge no generic
 *  gallery could invent. */
export interface MediaRoleDef {
  kind: MediaKind;
  /** Shown under the role's heading in the gallery. A role with no hint still renders. */
  hint?: string;
  bounds: MediaBounds;
  /** `named` roles with a STATIC key list (frontier's stack). Absent for a pool, and absent for a named
   *  role whose keys are derived from live data — which declares `keySource` instead. */
  keys?: readonly MediaKeyDef[];
  /** `named` roles whose keys come from live DATA (kit's services). Mutually exclusive with `keys`. */
  keySource?: MediaKeySource;
  /** What ONE file of this role IS, as a bare noun ("icon", "banner", "picture") — the word the gallery
   *  composes its per-key sentences from. It belongs to the ROLE and not to the `keySource`, because two
   *  roles can share a source and mean different pictures (the kit's icons and its service banners are
   *  both keyed by service identity). Article-free by contract: every sentence that uses it is phrased so
   *  no "a/an" is needed. Required in practice for a `keySource` role (a registry invariant test pins
   *  it); the static-key and pool roles say what they are in their own `hint`. */
  asset?: string;
}

/** A `slots` pin the gallery offers: binding one named file INTO a role, overriding that role folder's own
 *  first-wins pick.
 *
 *  `from` names the role whose files are the OPTIONS — which is not always the role being pinned, and the
 *  difference is load-bearing (ruled, Codex F4): the gacha reel figure needs a transparent CUTOUT, so its
 *  options come from `reel/`, never from the cast. Offering a character portrait there would let the owner
 *  pick something that sweeps across the screen as a rectangle.
 *
 *  `bundled` names what the THEME can supply for the slot while `from` is still empty, so the pin is useful
 *  on a fresh install instead of an empty select. They must be names that theme's own resolver would
 *  accept — a theme test keeps the two in step. */
export interface MediaSlotDef {
  key: string;
  label: string;
  from: string;
  bundled?: string[];
}

export interface MediaNsDef {
  /** The Conf group's heading for this namespace's gallery. */
  title: string;
  /** Rendered for EVERY theme rather than only for the one that links this namespace — the shape the `kit`
   *  service-icon row needs (M3), since no theme owns it. Namespaces flagged here must exist in the
   *  BACKEND registry too: a gallery whose index 404s is worse than no gallery. */
  alwaysOn?: boolean;
  roles: Record<string, MediaRoleDef>;
  slots?: MediaSlotDef[];
}

/** Full-bleed art: the bound for anything painted as a card, slide, backdrop or cutout. The two numbers are
 *  G5's server-side `WARN_BYTES`/`WARN_PIXELS` moved here WHOLE when the advisory policy went client-side,
 *  so the gallery says exactly what it said before. Anchored on GACHA_PLAN §10.4's own target table, whose
 *  largest entry is 1240x700 (0.87 MP) at ~120 KB: a file over these is far outside every target. */
const FULL_ART: MediaBounds = { bytes: 1_500_000, pixels: 4_000_000 };

/** Small transparent LAYERS: frontier's rig stack. Its three boxes are 150×155, 132×27 and 196×33 CSS
 *  px (frontier.css), so even authored at 4× for a dense phone the whole stack is well under 0.4 MP —
 *  a megapixel is already generous headroom, and half a megabyte is a large transparent PNG at that
 *  size. Priced apart from `FULL_ART` for exactly the reason the bounds went per-role (Opus M6): a
 *  4 MP ceiling on a 155px box would never warn, which is the same as having no advisory at all. */
const LAYER_ART: MediaBounds = { bytes: 500_000, pixels: 1_000_000 };

/** Service ICONS: the smallest art the app paints, and priced against the box it lands in rather than
 *  against the picture the owner may have downloaded. Every service row paints it at ~20 CSS px (kit's
 *  `.srow`, vapor's `.svc-row`, cosmos' `.hd-svc`, frontier's `.svc`, gacha's `.gc-svc` all sit on a
 *  40-42px row), so 512x512 is already 6x the linear size a 4x-DPR phone can use — generous headroom,
 *  and still an advisory the owner will actually meet if they drop a 1024px press logo in. 200 KB is a
 *  large transparent PNG at that ceiling. The advisory changes nothing about what is served: an oversize
 *  icon still paints (MEDIA_PLAN §5 — these are the gallery's badges, not a gate). */
const ICON_ART: MediaBounds = { bytes: 200_000, pixels: 262_144 };

/** Service BANNERS: the strip of art behind a service ROW, priced against that box rather than against
 *  a full-bleed surface. Every row that paints one is ~40-42px tall and at most a phone wide (cosmos's
 *  `.hd-svc` is the shipped reference), so ~1000x300 is already comfortably past what a 3x screen can
 *  use — half of `FULL_ART`'s pixels, and 400 KB is a generous WebP at that size. Between `ICON_ART` and
 *  `FULL_ART` for the same reason the bounds are per-role at all (Opus M6): a 4 MP ceiling on a 42px row
 *  would never warn. Advisory only — an oversize banner still paints. */
const BANNER_ART: MediaBounds = { bytes: 400_000, pixels: 2_000_000 };

/** ns -> its row. The single front-end authority the Conf tab and the gallery read, mirroring the backend
 *  registry row-for-row. A new namespace is one row here + one row there. */
export const MEDIA_NS: Record<string, MediaNsDef> = {
  // gacha (G5 / §5.4's ruled option (b)): the owner drops files into `$CTRLB_HOME/media/gacha/<role>/` from
  // any machine and the FOLDER is the assignment. ASCII prose, like the theme's settings labels — this is
  // gallery copy, not the theme's frozen Japanese copy, so it must not enlarge the font subset.
  gacha: {
    title: "Theme art",
    roles: {
      characters: {
        kind: "pool",
        hint: "Capsule cards + the dossier portrait, dealt to machines in this order.",
        bounds: FULL_ART,
      },
      banner: { kind: "pool", hint: "One extra pickup-banner slide per image.", bounds: FULL_ART },
      wallpaper: {
        kind: "pool",
        hint: "The fleet backdrop. The first image wins.",
        bounds: FULL_ART,
      },
      // The G4 carry, put where the owner will actually meet it: the bundled cutout has its two shadows
      // BAKED INTO the file (a runtime `drop-shadow()` on a large moving image re-rasterizes every frame on
      // Gecko — the §10.1 rider), and nothing bakes one for a drop-in. See gacha/art.ts for the recipe.
      reel: {
        kind: "pool",
        hint: "The cutout that rides the tab transition. Dropped-in cutouts are painted as-is: the bundled one has its glow baked into the file, so a plain transparent PNG will look flatter.",
        bounds: FULL_ART,
      },
      oracle: {
        kind: "pool",
        hint: "The agent operator's backdrop. The first image wins.",
        bounds: FULL_ART,
      },
    },
    // The §5.2 pins that survived the role re-rule. The role folders cover the ordinary case on their own,
    // so these stay optional in every sense. Three of them bind a CHARACTER into a role — a portrait crops
    // fine as a backdrop. The FIGURE does not (Codex F4, above).
    slots: [
      { key: "wallpaper", label: "Fleet backdrop", from: "characters" },
      { key: "hero", label: "Hero slide", from: "characters" },
      { key: "oracle", label: "Operator backdrop", from: "characters" },
      // `bundled` mirrors the cutout-bearing entries of `defaultRoster()` (themes/gacha/roster.ts) — a
      // roster test fails if the two ever drift.
      { key: "reel_figure", label: "Transition figure", from: "reel", bundled: ["lyra"] },
    ],
  },
  // frontier (D53 M2): the badlands theme's three art surfaces. Two POOLS and the first NAMED role —
  // and the split is not stylistic. Rigs and the map cover are interchangeable pictures where the
  // ORDER is the whole assignment; the rig stack is three fixed LAYERS of one composition, each with
  // its own box and its own z-position, so "which file is the cube" cannot be answered by position
  // (drop one file into a pool of three and the layers would silently rotate). The owner names them.
  frontier: {
    title: "Theme art",
    roles: {
      rigs: {
        kind: "pool",
        hint: "The rig cards and the host sheet, dealt to machines in this order — your own rig first.",
        bounds: FULL_ART,
      },
      hero: {
        kind: "pool",
        hint: "The badlands map cover. The first image wins.",
        bounds: FULL_ART,
      },
      stack: {
        kind: "named",
        // Named files, owner-ruled (§10.1). The extension is free — `cube.png`, `cube.webp` and
        // `Cube.PNG` all reach the same layer; only the stem is read.
        hint: "The floating stack on Comms — one file per LAYER, named for it. Transparent PNGs; each is fitted into its box, so a wrong shape letterboxes rather than stretches. A layer you drop nothing for keeps its bundled art.",
        bounds: LAYER_ART,
        keys: [
          // The aspect ratios are the bundled art's own, and the boxes they are painted into agree
          // with them (frontier.css `.fr-rigstack .cube/.mid/.base`).
          { key: "cube", hint: "the floating cube — roughly square (bundled 353×364)" },
          {
            key: "platform-mid",
            hint: "the small slab under it — wide and flat, about 5:1 (bundled 222×45)",
          },
          {
            key: "platform-base",
            hint: "the ground slab — widest and flattest, about 6:1 (bundled 558×94)",
          },
        ],
      },
    },
    // The one pin: the same shape as the gacha wallpaper pin (a pool with a first-wins default the
    // owner may override by name). The stack needs none — its stems ARE its bindings (§4).
    slots: [{ key: "hero", label: "Map cover", from: "hero" }],
  },
  // kit (D53 M3, extended by the Kit Art System): the art that belongs to no theme, which is exactly why
  // this row is ALWAYS-ON. All five service-row surfaces read the icons (kit Fleet, vapor, cosmos,
  // frontier, gacha), so gating its gallery on the active theme would have hidden the only place the
  // owner can learn what to name a file — while three of those five themes painted icons from it (the
  // draft bug, Opus H2).
  //
  // Three of the four roles are NAMED with DATA-derived keys and therefore carry no pin: the keys are the
  // FLEET's own identities (a service's `kind`-else-`name`, a machine's name), so they live in
  // `config.yaml` and the gallery derives them from the live lists. The one POOL — the shared background —
  // takes the ordinary first-wins pin, exactly like the gacha wallpaper and the frontier map cover.
  //
  // WHERE each role paints is the THEME's choice, and the hints say so rather than promising a surface a
  // theme may not have adopted (the surface-scoped precedence matrix, Codex A5): a theme's own art wins on
  // a theme's own surfaces, and a theme with its own full-app scenery ignores the shared background.
  kit: {
    title: "Shared art",
    alwaysOn: true,
    roles: {
      services: {
        kind: "named",
        keySource: "services",
        asset: "icon",
        hint: "One file per service, named after its KIND (the `kind:` field of a machine's service) — or after its NAME when it declares no kind. Services that share a kind share one icon. A service you drop nothing for keeps today's icon-less row.",
        bounds: ICON_ART,
      },
      "service-banners": {
        kind: "named",
        keySource: "services",
        asset: "banner",
        // Same keys as the icons above, deliberately: one identity per service, two pictures of it.
        hint: "The wide art behind a service's row, named exactly like its icon above (KIND, else NAME). Wide and short — it is cropped to the row and dimmed under the text. A service you drop nothing for keeps whatever that theme already paints behind it.",
        bounds: BANNER_ART,
      },
      hosts: {
        kind: "named",
        keySource: "hosts",
        asset: "picture",
        hint: "One picture per MACHINE, named after it. Themes that adopt it paint it faded behind that machine's detail sheet. Renaming a machine leaves its old file unmatched here — rename the file to match.",
        bounds: FULL_ART,
      },
      background: {
        kind: "pool",
        hint: "A shared background for the whole app. The first image wins (or pin one below), and the Appearance switch turns it off. Themes with scenery of their own ignore it.",
        bounds: FULL_ART,
      },
    },
    // The one pin, and the same shape as the gacha wallpaper pin: a pool with a first-wins default the
    // owner may override by name. The three NAMED roles need none — their stems ARE their bindings.
    slots: [{ key: "background", label: "Background", from: "background" }],
  },
};

/** The namespaces whose galleries the Conf tab renders for `def`: the theme's own LINKED namespace, plus
 *  every always-on row — in registry declaration order.
 *
 *  A link naming a namespace this registry does not hold yields nothing, deliberately: the gallery's first
 *  act is to fetch `/api/media/<ns>`, and a section that can only ever show "media index unreachable" is
 *  worse than no section.
 *
 *  `rows` is a parameter with the registry as its default — the roster.ts convention, so the multi-row case
 *  (which the registry itself will not have until the `kit` row lands at M3) is an ordinary unit test rather
 *  than something first exercised in production. */
export function applicableNs(
  def: ThemeDef | undefined,
  rows: Record<string, MediaNsDef> = MEDIA_NS,
): string[] {
  const linked = def?.media?.ns;
  return Object.keys(rows).filter((ns) => ns === linked || rows[ns].alwaysOn === true);
}
