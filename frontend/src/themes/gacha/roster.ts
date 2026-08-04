// The gacha ROSTER — schema + the CLIENT-side resolver (D52 / GACHA_PLAN §5.2 / §5.3).
//
// R3: the roster is VISUAL ONLY and is never linked to a specific PC. It is an ORDERED LIST, and the order
// IS the default assignment: host i (in the fleet's DISPLAY order) gets entry i. That ordering is exactly
// why the assignment lives HERE, on the client, and not in the config or the media endpoint — the display
// order is a client concern (`useHosts` sorts `self` first), so a server-side assignment would have to
// duplicate it (§5.2, Opus confirm).
//
// This module is PURE: no store reads, no queries, no React. Everything takes its inputs as arguments so
// the acceptance-matrix rows (0/1/many hosts · hosts>roster · roster>hosts · a missing slot reference) are
// ordinary unit tests. Its consumers — capsule cards (G1), promo slides (G1), the dossier (G2) and the reel
// figure (G4) — must ALL resolve through it, because a host's card art and its promo art disagreeing would
// read as a bug (Codex R4-3: one deterministic behavior, one shared resolver).
//
// G5 wired the OWNER's files in (§5.4's ruled option (b)): `rosterFromIndex` below builds a `Roster` out
// of the media index's per-role listings, and `defaultRoster()` is now the FALLBACK — the bundled set a
// fresh install shows before a single file has been dropped in. Every fallback is per ROLE, so a fleet
// with owner characters and no owner wallpaper still gets the bundled wallpaper; only what the owner
// actually supplied is replaced.

import type { MediaFile, MediaIndex } from "../../hooks/useMedia";
import { ART } from "./art";

/** One roster entry — one object per character, extended with optional fields rather than grown into
 *  sibling maps (the owner's extend-don't-migrate directive). `image`/`cutout`/`wide` are resolved URLs by
 *  the time they reach here: bundled assets are hashed build URLs, owner files are `/api/media/gacha/files/…`
 *  URLs the G5 adapter fills in. */
export interface RosterEntry {
  /** Display + reference name — what a `slots` pin points at. */
  name: string;
  /** The main art (capsule cards, dossier portrait). */
  image: string;
  /** Optional transparent cutout — the ONLY entries eligible for the reel figure. */
  cutout?: string;
  /** Optional landscape variant for wide-consuming slots (banner / wallpaper / oracle). */
  wide?: string;
  /** Optional `object-position` focal point; absent → the theme's default crop. */
  focus?: string;
  /** The entry exists in the roster but its file cannot be used — missing on disk, an unreadable or
   *  disallowed format, a zero-byte upload (the G5 index endpoint's magic-byte reader decides).
   *
   *  It is a FLAG rather than an omission on purpose (Codex G0 #2): the roster's order IS the host
   *  assignment, so dropping a broken entry from the list would silently RE-DEAL every host after it —
   *  one bad file and half the fleet changes character. Flagged, the entry keeps its position and only
   *  its own slot falls back to the placeholder. The Conf gallery is where the owner is told about it
   *  (§5.3: "placeholder + a Conf gallery warning; render stays silent"). */
  unusable?: boolean;
}

/** Optional pinned bindings. Each names an ENTRY; an unpinned (or dangling) slot falls back — never a hole. */
export interface RosterSlots {
  /** Must resolve to an entry WITH a cutout, else the fallback applies. */
  reel_figure?: string;
  oracle?: string;
  wallpaper?: string;
  /** The fixed hero slide's art; defaults to the wallpaper pick (§5.2). */
  hero?: string;
}

/** The single-pick role pools the owner's `media/gacha/<role>/` folders feed (§5.4's re-rule:
 *  drop-in = assignment). FIRST WINS in each — the owner reorders in the Conf gallery, and the index
 *  hands them over already ordered, so "first" is the owner's own pick with no pinning ceremony.
 *
 *  EMPTY is the normal state, not a defect: a role the owner has dropped nothing into leaves its
 *  consumer on the bundled default, which is what keeps a fresh install identical to G1–G4. */
export interface RolePools {
  wallpaper: NamedArt[];
  reel: NamedArt[];
  oracle: NamedArt[];
}

export interface Roster {
  entries: RosterEntry[];
  slots: RosterSlots;
  /** The banner role's slides (§6.4) — the owner's `banner/` drops, else the bundled pair. Named
   *  because each slide needs a stable KEY; the visible title comes from the `SCENE_TITLES` pool by
   *  position, never from this name. */
  scenes: NamedArt[];
  /** The owner's other role pools. See `RolePools`. */
  pools: RolePools;
}

/** A resolved piece of art for a consumer to paint. `focus` is the entry's focal point when it declared
 *  one. `null` means PLACEHOLDER: the roster is empty, or the pick was unusable. Consumers render their own
 *  neutral treatment for it (a capsule card without art is still a card) — the resolver never invents a URL. */
export interface ResolvedArt {
  url: string;
  focus?: string;
  /** The index's change token for these bytes, when the art came from the owner's media folder. Absent
   *  for bundled art, which is content-hashed and cannot change under a running app. Only a consumer
   *  that REMEMBERS something about one file needs it (the reel figure's failure latch, G4/F6). */
  rev?: string;
}

/** A pool member: art that also carries the NAME a `slots` pin can address it by. */
export interface NamedArt extends ResolvedArt {
  name: string;
}

/** The bundled default roster (§5.5) — the prototype's own four characters, in its own order, so a fresh
 *  install looks right before any owner art exists. `lyra` carries the cutout, which is what makes it the
 *  default reel figure without a pin. The scene art (banner/oracle) is deliberately NOT an entry: it would
 *  otherwise enter the per-host cycle and be dealt to a machine as its capsule portrait (the frontier
 *  partition rule, art.ts). Slots left empty on purpose — the fallbacks below are the intended defaults, so
 *  shipping pins would only be a second place to change them. */
const BUNDLED_ENTRIES: RosterEntry[] = [
  { name: "pegasus", image: ART.characters[0] },
  { name: "atlas", image: ART.characters[1] },
  // The owner's own drops (G1 eyeball round 3): dealt to display positions 2 and 3 — vault and g5 on
  // the owner's fleet. `rook` left the deal for them; the file stays bundled for the G5 gallery.
  { name: "3", image: ART.characters[2] },
  // Focal point (owner round 3): a full-body seated composition with the face ~18% from the top — the
  // wide CARD's default crop (50% 46%, tuned for lyra's art) landed on the shirt. One per-entry value
  // re-aims every surface (card shapes + promo); measured against simulated 16:9 and banner bands.
  { name: "4", image: ART.characters[3], focus: "50% 8%" },
  // The TAIL entry: never dealt on a four-host fleet, but still the one CUTOUT-bearing entry — the G4
  // reel figure's bundled option is derived from exactly this field.
  { name: "lyra", image: ART.characters[4], cutout: ART.cutout },
];

export function defaultRoster(): Roster {
  return {
    entries: BUNDLED_ENTRIES,
    slots: {},
    scenes: ART.scenes.map((s) => ({ name: s.name, url: s.url })),
    pools: {
      // Wallpaper and oracle are EMPTY on purpose: their bundled art is SCENE art, addressed by no name
      // and pinnable through no slot, so it belongs on the last rung of each ladder below rather than in
      // a pool.
      wallpaper: [],
      oracle: [],
      // The reel pool is different, and the difference is the PIN (§5.2 / Codex F4): the figure can be
      // chosen, so its bundled option needs a name the owner can select — and it has to survive the
      // owner replacing the cast, which is exactly what an entries-only fallback got wrong (drop in four
      // portraits and the tab transition silently lost its figure). DERIVED from the entries' `cutout`
      // field so the schema stays the one source; `ThemeDef.media.slots[].bundled` mirrors these names
      // for the gallery, and a test keeps the two in step.
      reel: BUNDLED_ENTRIES.filter((e) => e.cutout !== undefined).map((e) => ({
        name: e.name,
        url: e.cutout as string,
      })),
    },
  };
}

/** Build the live roster from the media index (§5.4) — the ONE adapter between the endpoint and the
 *  resolver. `undefined` (the query has not answered, or failed) is the bundled set, so first paint and
 *  a backend hiccup both show art rather than placeholders.
 *
 *  The fallback is PER ROLE, not all-or-nothing: an empty `characters/` keeps the bundled cast while an
 *  owner-filled `wallpaper/` still wins its own slot. That is what makes "drop one file in" a complete,
 *  useful action instead of an all-or-nothing switch to a half-empty theme.
 *
 *  UNUSABLE files are treated differently in the two positions, and deliberately (§5.3): a broken
 *  CHARACTER keeps its slot in the list — the order IS the host assignment, so dropping it would
 *  silently re-deal every host after it — while a broken file in a first-wins POOL is skipped, because
 *  there the only thing its position buys is a blank surface. */
export function rosterFromIndex(index: MediaIndex | undefined): Roster {
  const bundled = defaultRoster();
  if (index === undefined) return bundled;
  // Defensive against the PAYLOAD, not against our own types: this is wire data, and a stub/partial
  // response (an e2e mock, a proxy answering `{}`) must degrade to the bundled set rather than throw
  // inside a theme's render.
  const role = (name: string): MediaFile[] => {
    const files = index.roles?.[name];
    return Array.isArray(files) ? files : [];
  };
  const characters = role("characters");
  const scenes = role("banner").filter((f) => !f.unusable);
  return {
    entries: characters.length > 0 ? characters.map(toEntry) : bundled.entries,
    slots: index.slots ?? {},
    scenes: scenes.length > 0 ? scenes.map((f) => ({ name: f.name, url: f.url })) : bundled.scenes,
    pools: {
      wallpaper: pool(role("wallpaper")),
      // Per-role fallback, the same rule the cast and the scenes follow: an empty `reel/` keeps the
      // BUNDLED cutout, whatever the owner did to the other roles.
      reel: role("reel").length > 0 ? pool(role("reel")) : bundled.pools.reel,
      oracle: pool(role("oracle")),
    },
  };
}

/** One owner file as a roster ENTRY. No `wide`/`cutout`/`focus`: under the role re-rule those fields
 *  describe the BUNDLED defaults only — an owner's landscape art lives in `wallpaper/`, their cutout in
 *  `reel/`, and the folder a file sits in is the whole of its assignment. */
function toEntry(f: MediaFile): RosterEntry {
  return { name: f.name, image: f.url, ...(f.unusable && { unusable: true }) };
}

function pool(files: MediaFile[]): NamedArt[] {
  return files
    .filter((f) => !f.unusable)
    .map((f) => ({ name: f.name, url: f.url, rev: f.revision }));
}

/** The entry a host at `index` (its position in the fleet's DISPLAY order) is assigned.
 *
 *  ORDERED CYCLING when there are more hosts than entries (`i mod N`, ruled at lock — Codex R4-3): the
 *  alternative, leaving the overflow hosts art-less, would make the placeholder a NORMAL state on any fleet
 *  bigger than the roster. The placeholder (`null`) is reserved for the genuinely degenerate case: an EMPTY
 *  roster. A negative or fractional index is treated as unassigned rather than throwing — the caller is a
 *  render path. */
export function entryForHost(roster: Roster, index: number): RosterEntry | null {
  const n = roster.entries.length;
  if (n === 0 || !Number.isInteger(index) || index < 0) return null;
  return roster.entries[index % n];
}

/** The card/portrait art for a host at `index`. `null` → the consumer's placeholder treatment. */
export function artForHost(roster: Roster, index: number): ResolvedArt | null {
  return toArt(entryForHost(roster, index));
}

/** The whole fleet's assignment in one call, in display order — what a Fleet body maps over. */
export function assignArt(roster: Roster, hostCount: number): (ResolvedArt | null)[] {
  return Array.from({ length: Math.max(0, hostCount) }, (_, i) => artForHost(roster, i));
}

/** The LANDSCAPE art for a host at `index` — the banner's per-host promo slide (§6.4).
 *
 *  Same entry as `artForHost` (same index basis, the fleet's display order): a host's capsule card and its
 *  promo slide showing two different characters would read as a bug, which is the whole reason §5.3 rules
 *  ONE resolver. Only the CROP differs — a promo is a wide slide, a card is a 3/4 portrait — so this walks
 *  the same assignment through the wide ladder (`wide` variant, else `image` + the entry's focal point).
 *  `null` → the consumer's placeholder treatment, on exactly the same terms as `artForHost`. */
export function wideArtForHost(roster: Roster, index: number): ResolvedArt | null {
  return toWideArt(entryForHost(roster, index) ?? undefined);
}

/** The entry a `slots` pin names, or `undefined` when the slot is unpinned OR names an entry that no longer
 *  exists (a deleted/renamed character). A dangling pin must degrade to the slot's default, never crash and
 *  never blank the surface (§5.3). */
export function slotEntry(roster: Roster, slot: keyof RosterSlots): RosterEntry | undefined {
  const name = roster.slots[slot];
  if (name === undefined) return undefined;
  return roster.entries.find((e) => e.name === name);
}

/** Landscape art for a wide-consuming slot: the entry's `wide` variant when it has one, else its `image`
 *  with the entry's focal crop — never a hole (§5.2). */
function toWideArt(entry: RosterEntry | undefined): ResolvedArt | null {
  if (!entry || entry.unusable) return null;
  return {
    url: entry.wide ?? entry.image,
    ...(entry.focus !== undefined && { focus: entry.focus }),
  };
}

function toArt(entry: RosterEntry | null | undefined): ResolvedArt | null {
  if (!entry || entry.unusable) return null;
  return { url: entry.image, ...(entry.focus !== undefined && { focus: entry.focus }) };
}

// ── the slot ladders. Every one reads the same three rungs, in the same order (§5.4): a `slots` PIN
//    naming an entry (the owner binding a character into a role) → the role FOLDER's first file (the
//    owner's drop-in assignment) → the BUNDLED default. The bundled art is the fallback rather than a
//    roster entry so it can never be dealt to a host as a capsule portrait (the art.ts partition rule).

/** First-wins on a role pool, honestly typed: indexing an empty array yields `undefined` at runtime, and
 *  this project does not run `noUncheckedIndexedAccess` — so the middle rung of every ladder below would
 *  otherwise claim to always match and make its bundled fallback look like dead code. */
function first(pool: NamedArt[]): NamedArt | undefined {
  return pool.length > 0 ? pool[0] : undefined;
}

/** The fleet wallpaper / pickup-banner backdrop. */
export function wallpaperArt(roster: Roster): ResolvedArt {
  return (
    toWideArt(slotEntry(roster, "wallpaper")) ??
    first(roster.pools.wallpaper) ?? { url: ART.banner }
  );
}

/** The fixed hero slide's art — its own pin, else the wallpaper pick (§5.2's stated default). */
export function heroArt(roster: Roster): ResolvedArt {
  return toWideArt(slotEntry(roster, "hero")) ?? wallpaperArt(roster);
}

/** The agent oracle's backdrop. */
export function oracleArt(roster: Roster): ResolvedArt {
  return (
    toWideArt(slotEntry(roster, "oracle")) ?? first(roster.pools.oracle) ?? { url: ART.oracle }
  );
}

/** The reel figure (G4) — a CUTOUT, not a crop, and therefore the ONE ladder that reads a single pool:
 *  the pin, else that pool's first member, else `null` (no figure — the reel must be complete without
 *  one, the slats carry the transition alone).
 *
 *  **The pin addresses the REEL POOL, not the cast** (ruled, Codex F4). A character portrait is a
 *  rectangle: pinned here it would sweep across the screen as a rectangle mid-transition, so it must not
 *  even be resolvable — and the Conf gallery correspondingly offers `reel/` files and nothing else. A
 *  LEGACY config pin naming a plain character finds no pool member and falls through to the default,
 *  per §5.3: never a hole, never a crash.
 *
 *  The pool holds the owner's `reel/` drops when there are any, else the bundled cutout (see
 *  `defaultRoster`) — so dropping a cutout in wins over art that ships in the binary, and NOT dropping
 *  one still leaves a figure. Owner cutouts have NO baked glow: see the `reel/` gallery hint
 *  (index.tsx) and the bake recipe in art.ts. */
export function reelFigureArt(roster: Roster): ResolvedArt | null {
  const pin = roster.slots.reel_figure;
  const pinned = pin === undefined ? undefined : roster.pools.reel.find((a) => a.name === pin);
  return pinned ?? first(roster.pools.reel) ?? null;
}
