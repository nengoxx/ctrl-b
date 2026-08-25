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
//
// THE IMPORT DIRECTION IS PINNED (D65 / MEDIA_MANAGER_PLAN §2.4, the H1 rider). This module MAY import the
// theme ladder modules (`themes/*/roster.ts`, `themes/*/ownerArt.ts`, `themes/*/art.ts`); those modules must
// NEVER import this registry back. One arrow, always this way — which is the same store↛registry lesson
// stated as a rule rather than as a hazard. It buys the thing hand-mirroring could not: the per-role BUNDLED
// ids below are DERIVED from `defaultRoster()` / `ART` / the key tuples, so a theme that changes its shipped
// art cannot leave a stale name in this registry. (The other half of that mirror — the BACKEND's hand-listed
// copy in `core/media.py` — is held in step by a drift guard in tests/theme-engine/mediaRegistry.test.ts.)

import type { ExportOverride } from "../lib/imageExport";
import type { GuardLimits } from "../lib/imageProbe";
import type { ActiveResolver } from "../lib/mediaLibrary";
import type { NameLimits } from "../lib/uploadName";
import {
  ART as FRONTIER_ART,
  HERO_KEY as FRONTIER_HERO_KEY,
  RIG_KEYS,
} from "../themes/frontier/art";
import {
  activeHero,
  activeRigs,
  activeStackLayer,
  STACK_ART,
  STACK_KEYS,
} from "../themes/frontier/ownerArt";
import { ART as GACHA_ART } from "../themes/gacha/art";
import {
  activeCast,
  activeOraclePool,
  activePool,
  activeScenes,
  activeSeat,
  defaultRoster,
} from "../themes/gacha/roster";
import { activeBannerSet, SERVICE_BANNER_SET } from "../themes/cosmos/serviceBanners";
import { activeNamedKey, activePool as activeKitPool } from "./kit/ownerArt";
import type { ThemeDef } from "./types";

/** The bundled ids of one gacha role, read off the roster the theme actually falls back to. `defaultRoster()`
 *  builds a fresh object per call, so it is called ONCE here and the three lists are taken from that. */
const BUNDLED_ROSTER = defaultRoster();
/** `{name, url-ish}` pairs from a theme's own list → the registry's `{id, url}` entries. The url getter
 *  is per list because a roster entry's art hangs off a different field than a scene's. */
const bundle = <T>(entries: readonly T[], id: (e: T) => string, url: (e: T) => string) =>
  entries.map((e) => ({ id: id(e), url: url(e) }));

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

// ── the UPLOAD policy (D65 / MEDIA_MANAGER_PLAN §4) ──────────────────────────────────────────────

/** Every tunable the client's upload path judges against, in ONE object — the standing customizable
 *  principle ("tunables in config or the registry, never magic numbers", §0) applied to a pipeline
 *  whose numbers are otherwise scattered across a guard, a name minter and an export.
 *
 *  It lives HERE rather than in `lib/` for the reason the section descriptors do (the council H4
 *  rider): `lib/imageProbe`, `lib/uploadName` and `lib/imageExport` are pure and take their policy as
 *  ARGUMENTS, so the numbers have exactly one home and every test can state its own.
 *
 *  The one number that is NOT here is the byte cap: `media.write.max_bytes` is the SERVER's setting
 *  (`MediaWriteCfg`, owner-ruled 15 MB) and the client reads it off the settings snapshot, so the two
 *  ends cannot disagree about what a 413 means. `maxBytesFallback` below is only what the guard uses
 *  before that snapshot has landed. */
export interface UploadLimits extends Omit<GuardLimits, "maxBytes">, NameLimits {
  /** What the guard uses for `maxBytes` until the settings snapshot supplies the real one. */
  maxBytesFallback: number;
  /** How many `409` name races one upload answers before giving up. */
  raceRetries: number;
}

export const UPLOAD_LIMITS: UploadLimits = {
  /** The DECODE guard, and the one number the owner's own hardware chose: an Honor 20 shoots 48 MP
   *  (8000×6000), so a cap that refused it would refuse the phone this app is used from. 64 MP admits
   *  it with room and still refuses the 108/200 MP modes, whose 432–800 MB of RGBA is past what
   *  Chrome Android will decode on any device (its cap is `totalRAM / 25`) and what Gecko — which has
   *  no cap at all — would survive attempting (R54 §4.1). Owner ruling ④. */
  maxPixels: 64_000_000,
  /** `MediaWriteCfg.max_bytes`'s default, mirrored for the window before settings arrive. 15 MB,
   *  owner ruling ③ — a phone JPEG at 12–50 MP is 3–15 MB. */
  maxBytesFallback: 15 * 1024 * 1024,
  /** How much of a picked file the header reader is handed. 64 KB reaches the SOF of every conforming
   *  JPEG (only EXIF thumbnails and ICC profiles sit in front of it) and is a `Blob.slice` view, so
   *  the cost is the read, not a copy. */
  headBytes: 65_536,
  /** `core/media.py#MAX_NAME_BYTES` — the POSIX/NTFS budget, in UTF-8 BYTES. */
  maxNameBytes: 255,
  /** How far the `-2`, `-3`, … walk runs before the timestamp fallback (§2.5). Ninety-nine because
   *  the walk is O(n) over a folder listing the gallery already holds, and a hundredth copy of one
   *  picture is a library, not a collision. */
  attempts: 99,
  /** How many times a `409` from the server's race guard is answered with the next suffix before the
   *  upload gives up and says so (§2.5 — "never a dialog"). A 409 means another writer took the name
   *  between our listing and our PUT, which needs a second device uploading in the same instant; a
   *  handful of retries is generous for that and still bounded, because an unbounded walk against a
   *  server that answers 409 to everything is an infinite upload loop. */
  raceRetries: 5,
};

/** What the PICKER asks for. EXPLICIT types rather than `image/*`, on R54's source reading of both
 *  browsers: Chrome routes to the Android 13+ system photo picker as long as every entry starts with
 *  `image/`, and both engines put exactly this list into `EXTRA_MIME_TYPES`, so HEIC drops out of the
 *  default view. It is a HINT, never a guarantee (MDN says so in as many words) — the guard is what
 *  actually decides. `capture` is deliberately absent: both engines add the camera to the chooser for
 *  an image accept list anyway, and `capture` would make the camera the ONLY option. */
export const UPLOAD_ACCEPT = "image/png,image/jpeg,image/webp";

/** A role's per-destination override of the export's format policy (`lib/imageExport#exportPolicy`).
 *
 *  Declared per ROLE for the same reason the size bounds are (Opus M6): what a file of this role IS
 *  decides how it may be encoded, and one global answer serves neither a photograph nor a mask. Absent
 *  ⇒ the source decides (alpha-capable source ⇒ webp, else jpeg). */
export type MediaExportDef = ExportOverride;

/** ONE bundled entry a role ships: the stable ID the server emits as an index row, and the CLIENT-side
 *  asset it stands for (a Vite-hashed build url — the server has never seen the bytes and emits no url
 *  for them, §2.3).
 *
 *  One object rather than an id list beside a `{id: url}` map (the 2026-06-24 extend-don't-migrate
 *  directive): the two would be keyed by the same names, and the second dimension — the gallery needing
 *  to PAINT a bundled tile — is exactly the growth that makes sibling maps expensive. Both halves are
 *  DERIVED from the theme's own ladder module, so neither can name art the theme would refuse. */
export interface MediaBundledDef {
  id: string;
  url: string;
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
  /** This layer's own destination shape, when it differs from the role's (see `MediaRoleDef.aspect`).
   *  The frontier stack is three very different boxes under one role, which is the whole reason the
   *  hints below spell their geometry out. */
  aspect?: number;
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

/** ONE framing-preview window for a role: a small box the framing sheet paints the image into so the owner
 *  can see roughly where their focal point lands on a real destination (MEDIA_MANAGER_PLAN §5).
 *
 *  ⚠ **COARSE, EXAMPLES ONLY — by design (council M4).** These aspects are APPROXIMATIONS of the surfaces
 *  that consume the role, and the previews are captioned as examples for exactly that reason. **The real
 *  surfaces' CSS remains the paint authority**: a card that grows a different aspect, a theme that crops
 *  differently, a responsive box that changes shape at another width — none of that is knowable here, and a
 *  registry that pretended otherwise would be lying in a place the owner cannot check. Where one preview's
 *  aspect really must be exact, that surface gets the house invariant-test treatment instead of a promise.
 *  Never compute a stored value from these numbers; they exist to be looked at.
 *
 *  Two to four per role, never nine (R57 §9③): each one is a real window on a 390 px phone, and the
 *  useful set is the one that SPANS the shapes — two previews a finger apart in aspect teach nothing. */
export interface MediaPreviewDef {
  /** What this window IS, in the owner's words ("capsule card", "promo slide") — the caption. */
  label: string;
  /** width / height. Coarse, per the warning above. */
  aspect: number;
}

/** A `named` role whose BUNDLED tier is a dealt SET rather than one entry per key — a theme layering a
 *  ROTATION on a kit role (cosmos's twelve service banners, S6).
 *
 *  DECLARED, never inferred, for the reason `keySource` is: "are these bundled ids keys or a set" is
 *  knowledge about the theme that paints them, and a generic gallery that guessed would be right for
 *  frontier's stack (whose ids ARE its keys) and wrong here. Its presence is what makes the gallery
 *  emit a rotation SECTION beside the role-family card — one destination, one card, the H5 shape.
 *
 *  The three fields are the section's own: what it is called, what the owner needs told about it, and
 *  the §2.4 ladder that says which of its entries are live (supplied by the theme module that owns the
 *  rotation, imported here — the H1 arrow, never back). */
export interface MediaRotationDef {
  title: string;
  hint: string;
  active: ActiveResolver;
}

/** One role folder under `media/<ns>/`. The server's index is the authority on which roles EXIST; this
 *  supplies the words and the policy for them, because "what does `reel/` mean" is knowledge no generic
 *  gallery could invent. */
export interface MediaRoleDef {
  kind: MediaKind;
  /** The ids of the BUNDLED art this role ships — the entries a theme paints with no owner file present,
   *  each addressable by a stable name. D65 makes them first-class library entries: they appear in the
   *  role's gallery, they can be listed and ordered among the owner's own files, and the client maps an id
   *  to its Vite-hashed asset (the server emits the id, never a url).
   *
   *  **DERIVED, never hand-typed** (the H1 rider, see the header): every list below is read off the theme's
   *  own ladder module, so this registry cannot hold a name the theme would refuse. **REQUIRED**, empty
   *  included — a role that ships nothing must say so, because "no bundled art" is a real answer (the whole
   *  kit namespace) and an omitted field would make it indistinguishable from a forgotten one.
   *
   *  **Everything a theme ships is listed** (the S6 owner ruling): gacha's oracle backdrop and frontier's
   *  hero vista were the two exceptions — art on the last rung of a ladder that nothing addressed by name
   *  — and the consequence was that the one picture each of those roles paints appeared in no gallery and
   *  could not be reordered, replaced or retired. They carry the stem their own asset file has. An empty
   *  list now means only what the kit means by it: this role ships nothing. */
  bundled: readonly MediaBundledDef[];
  /** Shown under the role's heading in the gallery. A role with no hint still renders. */
  hint?: string;
  bounds: MediaBounds;
  /** How an UPLOAD to this role is encoded, when the source's own type is not the right answer (see
   *  `MediaExportDef`). Absent for every role whose files are ordinary pictures. */
  export?: MediaExportDef;
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
  /** Whether this role's items offer a FRAMING point (D65 / MEDIA_MANAGER_PLAN §5). It is declared per
   *  ROLE and not inferred, because the answer is a fact about the DESTINATIONS and nothing generic can
   *  see them. Two conditions, both required:
   *
   *   · **every surface that paints the role COVERS.** On a `contain` surface a focal point is not merely
   *     useless but actively wrong (R57 §5.5①): with no crop, `object-position` moves the LETTERBOXED
   *     picture into a corner and puts the empty space on the other two sides. frontier's rig stack is
   *     `contain` and the kit's brand mark is painted as an alpha MASK — neither is framable, ever.
   *   · **every one of those surfaces resolves its position per-window** (`hooks/useFocalPosition.ts`).
   *     Offering framing for a surface still on the old published-once path would let the gallery promise
   *     a framing the render cannot keep, which is the same lie §2.4 exists to prevent about activation.
   *
   *  Absent = false. **v1 ships it for gacha's three cover roles only** — the multi-window case the
   *  feature exists for (one cast painted into a 3/4 card, a wide promo band, a portrait and a
   *  full-viewport cover). frontier's `rigs`/`hero` and the kit's cover roles hand their consumers a bare
   *  URL with no focal channel at all, so making them framable is a per-theme SEAM change rather than the
   *  paint-site rewrite S4 owns; recorded in MEDIA_MANAGER_PLAN §12's S4 as-built. */
  framable?: boolean;
  /** The framing sheet's preview windows for this role — see `MediaPreviewDef` for what they are and are
   *  NOT. Absent = no previews (a role that offers no focal point, or one whose destinations are not worth
   *  approximating). */
  previews?: readonly MediaPreviewDef[];
  /** width / height of the DESTINATION, for the gallery's entry card and its grid tiles (§6.1/§6.3 —
   *  "shaped like the destination", four independent confirmations in R59). **Coarse on exactly the
   *  terms `MediaPreviewDef` states**: the real surfaces' CSS is the paint authority, and this number
   *  only decides how the owner's own picture is framed while they choose it. Absent ⇒ square tiles,
   *  the field's answer for "shape unknown". */
  aspect?: number;
  /** §2.4 — the ladder that decides which of this role's entries is LIVE, supplied by the theme module
   *  that already owns it and imported by BOTH the paint site and the gallery (council H1). A POOL
   *  declares one resolver; a `named` role declares `activeForKey` instead, because every key is its
   *  own destination with its own ladder. Absent ⇒ the gallery says nothing about what is in use. */
  active?: ActiveResolver;
  /** §2.4 for a `named` role: the resolver for ONE key. */
  activeForKey?: (key: string) => ActiveResolver;
  /** The role's bundled tier as a dealt SET — see `MediaRotationDef`. Absent for every role whose
   *  bundled ids are keys or pool members, which is every other one. */
  rotation?: MediaRotationDef;
}

/** A `slots` pin the gallery offers: binding one named file INTO a role, overriding that role folder's own
 *  first-wins pick.
 *
 *  `from` names the role whose files are the OPTIONS — which is not always the role being pinned, and the
 *  difference is load-bearing (ruled, Codex F4): the gacha reel figure needs a transparent CUTOUT, so its
 *  options come from `reel/`, never from the cast. Offering a character portrait there would let the owner
 *  pick something that sweeps across the screen as a rectangle.
 *
 *  There is no per-slot `bundled` list any more (**RETIRED at D65**, the M4 rider): the names a pin may
 *  offer while `from` is still empty are the SOURCE ROLE's own bundled ids, so keeping a second hand-typed
 *  copy on the slot was one list in two places — and the copy was the one that could go stale. The pin
 *  reads `roles[slot.from].bundled` instead.
 *
 *  `hint` is the per-pin line under the select, on exactly the terms `MediaRoleDef.hint` is (G6.3): the
 *  section's own copy describes what a pin GENERALLY is, and a pin whose ladder differs from that needs a
 *  sentence of its own or the owner reads the generic one as the whole truth. Optional — a pin without one
 *  renders as it always has. */
export interface MediaSlotDef {
  key: string;
  label: string;
  from: string;
  hint?: string;
  /** True when this pin is **its own destination** — a SEAT (§2.1): a surface fed FROM another role's
   *  library, whose only write is the pin. gacha's three character-bound pins are seats (a portrait
   *  bound into the fleet backdrop, the hero slide, the operator's backdrop); every other shipped pin
   *  is the source role's own first-wins OVERRIDE and therefore belongs to that role's section rather
   *  than to a section of its own — one destination, one card. */
  seat?: boolean;
  /** §2.4 — a SEAT's own ladder (what the pin resolves to, and what it falls through to). Pins that
   *  are not seats need none: their role's `active` resolver already reads them. */
  active?: ActiveResolver;
  /** The BUILT-IN picture this seat's ladder bottoms out on — shown on the card and in the seat's
   *  gallery so the owner can SEE what "none pinned" looks like (the S6 owner ruling: no shipped art
   *  is left behind).
   *
   *  It is a DISPLAY channel and deliberately not a library entry (`MediaBundledDef` is reused for the
   *  shape, not for the tier): a seat is a view over ANOTHER role's library, and this picture belongs
   *  to no role folder at all — gacha's `banner.webp` is scene art the backdrop ladder ends on. So it
   *  has no config identity: it cannot be hidden, ordered or deleted, and "restore the default" is the
   *  unpin the seat already offers.
   *
   *  It says what the ladder ENDS on, never what is painted right now: a rung in between (the shared
   *  kit background, for gacha's two backdrop seats) may be answering instead, which is why the card
   *  captions it `built-in` rather than "in use" and the slot's own `hint` names the middle rung. */
  builtin?: MediaBundledDef;
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
        // A 3/4 portrait: the capsule card's own shape, and the crop every other consumer takes it
        // through (the dossier portrait, the wide promo band).
        aspect: 3 / 4,
        // THE role a framing point exists for: one cast, eight windows, no two the same shape.
        framable: true,
        // Three windows that SPAN those shapes rather than sample them evenly — a tall portrait, a wide
        // band and the full frame. The numbers are the shipped surfaces' own (gacha.css: `.gc-card`
        // `aspect-ratio: 3/4`; `.gc-banner` 232px tall at the viewport's width; the cover fills the fleet
        // frame), taken at the owner's 390px phone where a height is involved — which is exactly the
        // approximation `MediaPreviewDef` warns about, and why the sheet captions them as examples.
        // Deliberately NOT here: the dossier portrait (104x138 ≈ 3/4 — the capsule card already shows
        // that shape) and the poster's sheared slice (its clip-path is not an aspect at all).
        previews: [
          { label: "capsule card", aspect: 3 / 4 },
          { label: "promo slide", aspect: 390 / 232 },
          { label: "magazine cover", aspect: 9 / 16 },
        ],
        active: activeCast,
        // The bundled cast, in the order the default roster deals it — the entry names a `slots` pin
        // addresses and `slotEntry` resolves against while `characters/` is still empty.
        bundled: bundle(
          BUNDLED_ROSTER.entries,
          (e) => e.name,
          (e) => e.image,
        ),
      },
      banner: {
        kind: "pool",
        hint: "One extra pickup-banner slide per image.",
        bounds: FULL_ART,
        aspect: 16 / 9,
        // One destination, one window (`.gc-slide img`, `object-fit: cover`) — but a slide is much wider
        // than it is tall, so a portrait photo dropped here crops hard and the framing point is what
        // decides where. The preview is the band's real geometry (232px at the phone's width).
        framable: true,
        previews: [{ label: "banner slide", aspect: 390 / 232 }],
        active: activeScenes,
        // The bundled scene slides (`b2`/`b3`) — named because each slide needs a stable key.
        bundled: bundle(
          BUNDLED_ROSTER.scenes,
          (s) => s.name,
          (s) => s.url,
        ),
      },
      // NO `wallpaper` ROLE — removed at G6.3 on the owner's ruling ("just having the background in the
      // kit is the better approach — no duplicated systems"). The fleet backdrop's drop-in home is the
      // SHARED `kit/background` pool: one folder for "a big picture behind the app", not one per theme
      // that wants one. What stays gacha's is the `wallpaper` PIN below — binding a CAST portrait to the
      // backdrop, which is a theme-specific idea the kit has no equivalent for.
      // The G4 carry, put where the owner will actually meet it: the bundled cutout has its two shadows
      // BAKED INTO the file (a runtime `drop-shadow()` on a large moving image re-rasterizes every frame on
      // Gecko — the §10.1 rider), and nothing bakes one for a drop-in. See gacha/art.ts for the recipe.
      reel: {
        kind: "pool",
        hint: "The cutout that rides the tab transition. Dropped-in cutouts are painted as-is: the bundled one has its glow baked into the file, so a plain transparent PNG will look flatter.",
        bounds: FULL_ART,
        aspect: 3 / 4,
        // The `reel_figure` pin is this pool's OWN first-wins override (not a seat), so the pool's
        // ladder is the one that reads it — which is why "Set as active" here writes the pin.
        active: activePool("reel_figure"),
        // The bundled reel POOL, which the roster derives from the entries carrying a `cutout` — today
        // exactly `lyra`. This is the list the `reel_figure` pin offers while `reel/` is empty; it used to
        // be hand-typed on the slot (`MediaSlotDef.bundled`, retired at D65).
        bundled: bundle(
          BUNDLED_ROSTER.pools.reel,
          (a) => a.name,
          (a) => a.url,
        ),
      },
      oracle: {
        kind: "pool",
        hint: "The agent operator's backdrop. The first image wins.",
        bounds: FULL_ART,
        aspect: 16 / 9,
        // The 300px operator block (`--gc-oracle-h`), which covers — and which a `characters` entry can
        // also be bound into through the `oracle` seat, so the two roles have to agree about framing.
        framable: true,
        previews: [{ label: "operator backdrop", aspect: 390 / 300 }],
        // The one ladder whose winner can live in ANOTHER section: the `oracle` SEAT pin (a character
        // bound into the backdrop) outranks this folder entirely, and the card says so with a pointer
        // rather than painting a phantom (§2.4).
        active: activeOraclePool,
        // The bundled backdrop, as an ordinary pool member (S6). It used to be EMPTY on the reasoning
        // that scene art no pin addresses belongs on the last rung of `oracleArt`'s ladder rather than
        // in a library — which was right about pins and wrong about the gallery: the owner could see
        // neither the picture this role paints nor a way to replace it. Derived, like every other list
        // here, so the roster stays the one source.
        bundled: bundle(
          BUNDLED_ROSTER.pools.oracle,
          (a) => a.name,
          (a) => a.url,
        ),
      },
    },
    // The §5.2 pins that survived the role re-rule. Three of them bind a CHARACTER into a role — a
    // portrait crops fine as a backdrop. The FIGURE does not (Codex F4, above). Each one's bundled
    // fallback options are its SOURCE ROLE's `bundled` ids (D65 — no per-slot copy).
    //
    // `wallpaper` is the one whose ROLE FOLDER no longer exists (G6.3), and it is therefore the one pin
    // that is not merely an override of a folder's first pick: it is now the TOP of gacha's backdrop
    // ladder, above the shared kit background. Its hint says so, because the pins section's own copy
    // ("bind one image into a role, overriding that folder's own first pick") is no longer the whole
    // truth for it and the owner has nowhere else to read where their backdrop comes from.
    slots: [
      {
        key: "wallpaper",
        label: "Fleet backdrop",
        from: "characters",
        hint: "Unpinned, the fleet uses your Shared art background — then the bundled scene below.",
        seat: true,
        active: activeSeat("wallpaper"),
        // The bundled scene the backdrop ladder ends on. Both backdrop seats show it and each is
        // customized on its own (they hold independent pins) — surfacing the shared default is not the
        // same as merging the two surfaces.
        builtin: { id: "banner", url: GACHA_ART.banner },
      },
      {
        key: "hero",
        label: "Hero slide",
        from: "characters",
        hint: "Unpinned, the hero slide follows the fleet backdrop — then the bundled scene below.",
        seat: true,
        // Its own pin, else the WALLPAPER's (`heroArt` falls through to the whole backdrop ladder):
        // the hero slide and the fleet backdrop resolving to two different pictures is the
        // disagreement §5.3's one-resolver ruling exists to prevent, so the seat says so too.
        active: activeSeat("hero", "wallpaper"),
        builtin: { id: "banner", url: GACHA_ART.banner },
      },
      {
        key: "oracle",
        label: "Operator backdrop",
        from: "characters",
        // NO `builtin`: this seat's ladder falls through to the `oracle` ROLE, whose own section holds
        // the bundled backdrop as an ordinary library entry since S6 — and a second, uneditable copy of
        // a picture that has a real home would be the duplicate the card's `overriddenBy` pointer
        // exists to avoid.
        seat: true,
        active: activeSeat("oracle"),
      },
      // `bundled` mirrors the cutout-bearing entries of `defaultRoster()` (themes/gacha/roster.ts) — a
      // roster test fails if the two ever drift.
      // Its bundled option is the `reel` ROLE's own list above (D65 retired the per-slot copy).
      { key: "reel_figure", label: "Transition figure", from: "reel" },
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
        aspect: 1.18,
        active: activeRigs,
        // The bundled rig pool, addressed by ASSET KEY: `present()` names position i's rig
        // `RIG_KEYS[i % 6]` and the card paints `assets[key]` when the owner has dropped none.
        bundled: bundle(
          RIG_KEYS,
          (k) => k,
          (k) => FRONTIER_ART.rigs[RIG_KEYS.indexOf(k)],
        ),
      },
      hero: {
        kind: "pool",
        hint: "The badlands map cover. The first image wins.",
        bounds: FULL_ART,
        aspect: 16 / 9,
        active: activeHero,
        // The bundled vista, under the stem the manifest already addresses it by (S6) — the same change
        // as gacha's oracle, for the same reason: art nothing names is art the owner cannot see.
        bundled: bundle(
          [FRONTIER_HERO_KEY],
          (k) => k,
          () => FRONTIER_ART.hero,
        ),
      },
      stack: {
        kind: "named",
        // Named files, owner-ruled (§10.1). The extension is free — `cube.png`, `cube.webp` and
        // `Cube.PNG` all reach the same layer; only the stem is read.
        hint: "The floating stack on Comms — one file per LAYER, named for it. Transparent PNGs; each is fitted into its box, so a wrong shape letterboxes rather than stretches. A layer you drop nothing for keeps its bundled art.",
        bounds: LAYER_ART,
        // FORCED PNG. Three transparent layers are composited over each other at small sizes, where a
        // lossy encoder's ringing shows up as a halo along every edge — and the layers are tiny (the
        // biggest box is 196×33 CSS px), so lossless costs kilobytes. Being lossless, it also skips
        // the byte step-down: there is no quality to lower, and the advisory badge is the honest
        // answer for a layer that lands over `LAYER_ART`'s bound.
        export: { type: "image/png" },
        // One bundled layer per KEY — the ids ARE `STACK_KEYS`, which is why a partial drop composites
        // owner over bundled instead of blanking the other two.
        bundled: bundle(
          STACK_KEYS,
          (k) => k,
          (k) => STACK_ART[k],
        ),
        activeForKey: activeStackLayer,
        // The ROLE's own shape is square — i.e. "unknown", the field's answer when there is no single
        // one: the three layers are three very different boxes and each declares its own below. It is
        // what the Unassigned bucket (a file matching no layer) frames its tiles in.
        aspect: 1,
        keys: [
          // The aspect ratios are the bundled art's own, and the boxes they are painted into agree
          // with them (frontier.css `.fr-rigstack .cube/.mid/.base`).
          {
            key: "cube",
            hint: "the floating cube — roughly square (bundled 353×364)",
            aspect: 353 / 364,
          },
          {
            key: "platform-mid",
            hint: "the small slab under it — wide and flat, about 5:1 (bundled 222×45)",
            aspect: 222 / 45,
          },
          {
            key: "platform-base",
            hint: "the ground slab — widest and flattest, about 6:1 (bundled 558×94)",
            aspect: 558 / 94,
          },
        ],
      },
    },
    // The one pin: a pool with a first-wins default the owner may override by name (the kit background
    // pin is the same shape). The stack needs none — its stems ARE its bindings (§4).
    slots: [{ key: "hero", label: "Map cover", from: "hero" }],
  },
  // kit (D53 M3, extended by the Kit Art System): the art that belongs to no theme, which is exactly why
  // this row is ALWAYS-ON. All five service-row surfaces read the icons (kit Fleet, vapor, cosmos,
  // frontier, gacha), so gating its gallery on the active theme would have hidden the only place the
  // owner can learn what to name a file — while three of those five themes painted icons from it (the
  // draft bug, Opus H2).
  //
  // The kit ITSELF ships no art (§3) — an absent file means the surface renders exactly as it does
  // without one — with one exception that is not the kit's own: `service-banners` carries cosmos's
  // twelve-banner ROTATION as its bundled tier (S6), because that is the role those pictures are about
  // and a theme's set has to live in the library the owner manages it from.
  //
  // Three of the five roles are NAMED with DATA-derived keys and therefore carry no pin: the keys are the
  // FLEET's own identities (a service's `kind`-else-`name`, a machine's name), so they live in
  // `config.yaml` and the gallery derives them from the live lists. The two POOLS — the shared background
  // and the app-bar brand mark — take the ordinary first-wins pin, exactly like the frontier map cover.
  //
  // WHERE each role paints is the THEME's choice, and the hints say so rather than promising a surface a
  // theme may not have adopted (the surface-scoped precedence matrix, Codex A5): a theme's own art wins on
  // a theme's own surfaces, and a theme with its own full-app scenery declines the shared background
  // LAYER — which is not the same as ignoring the picture (G6.3): gacha reads that file as the last owner
  // drop-in rung of its OWN backdrop ladder (G6.3 removed gacha's twin folder for exactly that reason),
  // so a shared drop dresses every theme, each through its own surface and its own switch.
  kit: {
    title: "Shared art",
    alwaysOn: true,
    roles: {
      services: {
        // The kit ships NO fallback art (§3): absent = the surface renders exactly as it does
        // without it. Empty, and stated rather than omitted — "nothing bundled" is a real answer.
        bundled: [],
        kind: "named",
        keySource: "services",
        asset: "icon",
        aspect: 1,
        activeForKey: activeNamedKey,
        hint: "One file per service, named after its KIND (the `kind:` field of a machine's service) — or after its NAME when it declares no kind. Services that share a kind share one icon. A service you drop nothing for keeps today's icon-less row.",
        bounds: ICON_ART,
      },
      "service-banners": {
        // The ONE kit role that carries bundled art, and it is not the kit's: cosmos layers a
        // twelve-banner ROTATION on this role, dealt across a host's service rows (S6 — before it,
        // those twelve pictures lived in a private array outside the media system entirely, so no
        // gallery could show them and nothing could reorder or retire one). Derived from the theme's
        // own set, like every other list here.
        bundled: bundle(
          SERVICE_BANNER_SET,
          (b) => b.id,
          (b) => b.url,
        ),
        // …and it is a SET, not one entry per key — which is why the role declares a rotation rather
        // than letting the per-key machinery try to bind `banner-01` to a service called that.
        rotation: {
          title: "Built-in rotation",
          hint: "The banner set cosmos deals across a machine's service rows — a different one per service, in this order. Switch one off to take it out of the rotation. A service you drop your own banner for above uses that instead, whatever the rotation says.",
          active: activeBannerSet,
        },
        kind: "named",
        keySource: "services",
        asset: "banner",
        aspect: 1000 / 300,
        activeForKey: activeNamedKey,
        // Same keys as the icons above, deliberately: one identity per service, two pictures of it.
        hint: "The wide art behind a service's row, named exactly like its icon above (KIND, else NAME). Wide and short — it is cropped to the row and dimmed under the text. A service you drop nothing for keeps whatever that theme already paints behind it — under cosmos, one of the built-in rotation below.",
        bounds: BANNER_ART,
      },
      hosts: {
        // The kit ships NO fallback art (§3): absent = the surface renders exactly as it does
        // without it. Empty, and stated rather than omitted — "nothing bundled" is a real answer.
        bundled: [],
        kind: "named",
        keySource: "hosts",
        asset: "picture",
        aspect: 16 / 9,
        activeForKey: activeNamedKey,
        hint: "One picture per MACHINE, named after it. Themes that adopt it paint it faded behind that machine's detail sheet. Renaming a machine leaves its old file unmatched here — rename the file to match.",
        bounds: FULL_ART,
      },
      background: {
        // The kit ships NO fallback art (§3): absent = the surface renders exactly as it does
        // without it. Empty, and stated rather than omitted — "nothing bundled" is a real answer.
        bundled: [],
        kind: "pool",
        // Re-worded at G6.3 (owner device round). The old sentence ended "Themes with scenery of their
        // own ignore it", which stopped being true the moment gacha made this image the last rung of its
        // OWN wallpaper ladder — the owner dropped a file here, saw nothing change under gacha, and read
        // the copy as a promise the app was breaking. The truth now has two halves and the hint says
        // both: the shared LAYER is what a scenery theme declines to mount, and that theme may still use
        // the picture on its own backdrop, under its own switch.
        aspect: 9 / 16,
        active: activeKitPool("background"),
        hint: "A shared background for the whole app. The first image wins (or pin one below), and the Appearance switch turns off the shared layer. A theme with scenery of its own paints this picture on its own backdrop instead, under its own switch.",
        bounds: FULL_ART,
      },
      brand: {
        // The kit ships NO fallback art (§3): absent = the surface renders exactly as it does
        // without it. Empty, and stated rather than omitted — "nothing bundled" is a real answer.
        bundled: [],
        kind: "pool",
        // ALPHA is the shape (G6.3): the file is painted as a CSS mask, never as an image, so only its
        // transparency is read and every theme tints the result with its own accent. Said plainly in the
        // hint because it is the one thing an owner cannot discover by looking at the file — a fully
        // opaque photo drops in happily and paints a solid accent-coloured rectangle.
        aspect: 1,
        active: activeKitPool("brand"),
        hint: "Your own mark beside the app title. A transparent PNG or WebP — only the SHAPE is used, and each theme colours it with its own accent, so a flat silhouette works best. The first image wins (or pin one below).",
        bounds: ICON_ART,
        // FORCED PNG, and here it is not a quality preference but a correctness one: the file is
        // painted as a CSS MASK, so only its ALPHA is ever read. A lossy encode blurs the alpha edge
        // into a fringe of partial coverage, which the mask turns into a soft halo of accent colour
        // around the mark. Lossless keeps the silhouette exact — and at 512×512 it costs nothing.
        export: { type: "image/png" },
      },
    },
    // One pin per POOL, each the same shape as the frontier map cover's: a first-wins default the owner
    // may override by name. The three NAMED roles need none — their stems ARE their bindings.
    slots: [
      { key: "background", label: "Background", from: "background" },
      { key: "brand", label: "App icon", from: "brand" },
    ],
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

// ── SECTIONS (D65 / MEDIA_MANAGER_PLAN §2.1 + §6.1) ──────────────────────────────────────────────
//
// A SECTION is one art DESTINATION: one card in Conf, one full-screen gallery behind it. The two
// kinds the plan names are ONE UI driven by a capability descriptor (council M1 — the difference is
// data, never an implicit branch):
//
//   · LIBRARY-BACKED  — a role folder (or one KEY of a named role). Upload · reorder · set-active ·
//     In-use · delete.
//   · PIN-BACKED SEAT — a read-only VIEW over another role's library whose one write is the pin. The
//     tile action reads "Use here"; there is no upload, no reorder, no delete, no In-use.
//
// The card count is the H5 refinement, OWNER-RATIFIED: pool roles and STATIC named keys get their own
// card; a role whose keys come from live DATA (kit's services/machines) gets ONE role-family card
// carrying the key list, because a fleet of twelve services must not put twelve cards in Conf.

/** What ONE section can DO — the capability descriptor the generic gallery reads instead of asking
 *  which kind of section it is rendering. */
export interface MediaCaps {
  /** ↑/↓ and move-to-top/bottom. FALSE where order decides nothing (defect #11): a named key is
   *  answered by ONE file, and a seat is a view. */
  reorder: boolean;
  /** How "this one, please" is written: `order` = move-to-front (the list order IS the priority);
   *  `pin` = write `slots[pin]` ("Use here", and the same for a pool whose own first pick has a pin
   *  above it); `none` = nothing to activate (the Unassigned bucket paints nowhere). */
  activate: "order" | "pin" | "none";
  hidden: boolean;
  remove: boolean;
  upload: boolean;
  /** "Set framing" (§5). The ROLE decides (`MediaRoleDef.framable`), but a section can still refuse it:
   *  a SEAT is a read-only view whose one write is the pin, and the UNASSIGNED bucket holds files that
   *  paint nowhere — framing either would be an edit with no destination. */
  frame: boolean;
}

/** One art destination, resolved from the registry + the server's role list. */
export interface MediaSection {
  /** Stable and unique per namespace — the modal's key, and what `overriddenBy` points at. */
  id: string;
  ns: string;
  /** The role folder this section's LIBRARY is (a seat's is its `from` role). */
  role: string;
  kind: "pool" | "key" | "family" | "rotation" | "seat" | "unassigned";
  /** The card's heading. Role sections keep the FOLDER's own name (the owner-facing contract of a
   *  namespace, spelled out beside it); a key section is titled by its key; a seat by its label. */
  title: string;
  hint?: string;
  /** The named-role key this section is scoped to (`kind: "key"`). */
  key?: string;
  /** The live source a family card's key rows come from (`kind: "family"`, and the UNASSIGNED bucket
   *  of a derived role — which cannot know what "assigned" means until that list arrives). */
  keySource?: MediaKeySource;
  /** The DECLARED keys of a static-key role — what the unassigned bucket subtracts. */
  keys?: readonly string[];
  /** What ONE file of this role IS, as a bare noun — the word the copy composes with. */
  asset?: string;
  /** The `slots` key this section's activation writes (a seat, or a pool with an in-role pin). */
  pin?: string;
  /** The role's registry row — bounds, bundled ids, the static key list. */
  def: MediaRoleDef;
  aspect?: number;
  bounds: MediaBounds;
  caps: MediaCaps;
  active?: ActiveResolver;
  /** A SEAT's built-in fallback picture — see `MediaSlotDef.builtin`. Never a library row. */
  builtin?: MediaBundledDef;
}

/** A role the SERVER lists and this registry does not describe. It still gets a gallery — the server
 *  is the authority on which roles exist — it just carries no hint, no bounds policy and no ladder. */
const UNDESCRIBED: MediaRoleDef = { kind: "pool", bundled: [], bounds: FULL_ART };

const LIBRARY_CAPS: MediaCaps = {
  reorder: true,
  activate: "order",
  hidden: true,
  remove: true,
  upload: true,
  // Per ROLE, never per kind — every library section below folds in its own `row.framable`.
  frame: false,
};

/** The UNASSIGNED bucket of a `named` role (§6.1): the files that bound NO key — a rename's aftermath,
 *  a typo, art for a service that is gone. Without it they are invisible in a per-key gallery and
 *  therefore undeletable, which is the one state a manager must not be able to produce.
 *
 *  Emitted for BOTH key sources (a static-key role has typos too) and shown only when it holds
 *  something — an empty bucket is a card about nothing. Nothing here is ACTIVATABLE: a file bound to no
 *  key paints nowhere, so the honest capability set is "look, hide, delete". */
function unassigned(
  ns: string,
  role: string,
  common: Omit<MediaSection, "id" | "kind" | "title" | "caps">,
  keys: { keys?: readonly string[]; keySource?: MediaKeySource },
): MediaSection {
  return {
    ...common,
    ...keys,
    id: `${ns}:${role}#`,
    kind: "unassigned",
    title: "Unassigned",
    hint: "Files here match no name this role uses, so nothing paints them. Rename one to a key above — or delete it.",
    caps: {
      reorder: false,
      activate: "none",
      hidden: true,
      remove: true,
      upload: false,
      frame: false,
    },
  };
}

/** Every destination one namespace offers, in the order the Conf tab shows them: the role folders
 *  first (the server's own list — a role the registry never heard of still lists), then the seats.
 *
 *  `roles` comes from the INDEX rather than from `def.roles` for the reason the gallery has always
 *  read it that way: the server is the authority on which folders exist. */
export function mediaSections(
  ns: string,
  def: MediaNsDef,
  roles: readonly string[],
): MediaSection[] {
  const out: MediaSection[] = [];
  for (const role of roles) {
    const row = def.roles[role] ?? UNDESCRIBED;
    const common = {
      ns,
      role,
      def: row,
      hint: row.hint,
      asset: row.asset,
      bounds: row.bounds,
      aspect: row.aspect,
    };
    if (row.kind === "named" && row.keys !== undefined) {
      // A STATIC key list: each layer is its own destination, with its own shape and its own ladder.
      for (const k of row.keys) {
        out.push({
          ...common,
          id: `${ns}:${role}#${k.key}`,
          kind: "key",
          title: k.key,
          hint: k.hint,
          key: k.key,
          aspect: k.aspect ?? row.aspect,
          // Order buys nothing here but the duplicate tie-break, so the ↑/↓ pair is hidden (#11) —
          // "Set as active" is how a shadowed duplicate wins its key, and that is move-to-front.
          caps: { ...LIBRARY_CAPS, reorder: false, frame: row.framable === true },
          active: row.activeForKey?.(k.key),
        });
      }
      out.push(unassigned(ns, role, common, { keys: row.keys.map((k) => k.key) }));
      continue;
    }
    if (row.kind === "named" && row.keySource !== undefined) {
      out.push({
        ...common,
        id: `${ns}:${role}`,
        kind: "family",
        title: role,
        keySource: row.keySource,
        caps: { ...LIBRARY_CAPS, reorder: false, frame: row.framable === true },
      });
      // The role's bundled tier as a dealt SET, where a theme declared one (`MediaRotationDef`). Its
      // own card, because it is its own destination: the family card above is about per-service files
      // and this is about the set behind the ones nobody dropped a file for. ORDER is the rotation
      // order and the In-use switch is what takes a banner out of it, so it reorders and hides — but
      // it neither uploads nor deletes: a file dropped here binds to a SERVICE, never to the set.
      if (row.rotation !== undefined) {
        out.push({
          ...common,
          id: `${ns}:${role}@`,
          kind: "rotation",
          title: row.rotation.title,
          hint: row.rotation.hint,
          caps: {
            reorder: true,
            activate: "order",
            hidden: true,
            remove: false,
            upload: false,
            frame: false,
          },
          active: row.rotation.active,
        });
      }
      out.push(unassigned(ns, role, common, { keySource: row.keySource }));
      continue;
    }
    // A POOL. Its own `slots` pin (one that is not a seat) is the top rung of its ladder, so "this
    // one, please" is written as the PIN — move-to-front would leave a pin above it silently winning.
    const pin = def.slots?.find((s) => s.from === role && s.seat !== true);
    out.push({
      ...common,
      id: `${ns}:${role}`,
      kind: "pool",
      title: role,
      pin: pin?.key,
      caps: { ...LIBRARY_CAPS, activate: pin ? "pin" : "order", frame: row.framable === true },
      active: row.active,
    });
  }
  for (const slot of def.slots ?? []) {
    if (slot.seat !== true) continue;
    const row = def.roles[slot.from];
    // A seat over a role the server does not list has no library to view — skip it rather than open
    // an empty gallery on a folder that is not there.
    if (row === undefined || !roles.includes(slot.from)) continue;
    out.push({
      id: `${ns}:@${slot.key}`,
      ns,
      role: slot.from,
      kind: "seat",
      title: slot.label,
      hint: slot.hint,
      asset: row.asset,
      def: row,
      bounds: row.bounds,
      aspect: row.aspect,
      pin: slot.key,
      caps: {
        reorder: false,
        activate: "pin",
        hidden: false,
        remove: false,
        upload: false,
        frame: false,
      },
      active: slot.active,
      builtin: slot.builtin,
    });
  }
  return out;
}
