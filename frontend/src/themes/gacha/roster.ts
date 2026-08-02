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
// Until G5 lands the media index endpoint, `defaultRoster()` supplies the bundled set — same resolver, no
// config. The G5 adapter's whole job is to build a `Roster` out of the endpoint's payload; nothing below
// changes.

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

export interface Roster {
  entries: RosterEntry[];
  slots: RosterSlots;
}

/** A resolved piece of art for a consumer to paint. `focus` is the entry's focal point when it declared
 *  one. `null` means PLACEHOLDER: the roster is empty, or the pick was unusable. Consumers render their own
 *  neutral treatment for it (a capsule card without art is still a card) — the resolver never invents a URL. */
export interface ResolvedArt {
  url: string;
  focus?: string;
}

/** The bundled default roster (§5.5) — the prototype's own four characters, in its own order, so a fresh
 *  install looks right before any owner art exists. `lyra` carries the cutout, which is what makes it the
 *  default reel figure without a pin. The scene art (banner/oracle) is deliberately NOT an entry: it would
 *  otherwise enter the per-host cycle and be dealt to a machine as its capsule portrait (the frontier
 *  partition rule, art.ts). Slots left empty on purpose — the fallbacks below are the intended defaults, so
 *  shipping pins would only be a second place to change them. */
export function defaultRoster(): Roster {
  return {
    entries: [
      { name: "pegasus", image: ART.characters[0] },
      { name: "atlas", image: ART.characters[1] },
      { name: "rook", image: ART.characters[2] },
      { name: "lyra", image: ART.characters[3], cutout: ART.cutout },
    ],
    slots: {},
  };
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

/** The fleet wallpaper / pickup-banner backdrop: the pinned entry's wide art, else the bundled scene art.
 *  The bundled scene is the FALLBACK rather than an entry, so it can't be dealt to a host (art.ts). */
export function wallpaperArt(roster: Roster): ResolvedArt {
  return toWideArt(slotEntry(roster, "wallpaper")) ?? { url: ART.banner };
}

/** The fixed hero slide's art — its own pin, else the wallpaper pick (§5.2's stated default). */
export function heroArt(roster: Roster): ResolvedArt {
  return toWideArt(slotEntry(roster, "hero")) ?? wallpaperArt(roster);
}

/** The agent oracle's backdrop: the pinned entry's wide art, else the bundled scene art. */
export function oracleArt(roster: Roster): ResolvedArt {
  return toWideArt(slotEntry(roster, "oracle")) ?? { url: ART.oracle };
}

/** The reel figure (G4) — a CUTOUT, not a crop, so the ladder is stricter: the pinned entry only counts if
 *  it actually has one, else the first entry that does, else `null` (no figure; the slats carry the
 *  transition alone, which is the design's own posture — the reel must be complete without the figure). */
export function reelFigureArt(roster: Roster): ResolvedArt | null {
  const pinned = slotEntry(roster, "reel_figure");
  const usable = (e: RosterEntry | undefined) => e?.cutout !== undefined && !e.unusable;
  const entry = usable(pinned) ? pinned : roster.entries.find(usable);
  if (!entry?.cutout) return null;
  return { url: entry.cutout, ...(entry.focus !== undefined && { focus: entry.focus }) };
}
