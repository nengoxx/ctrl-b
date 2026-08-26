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
// D53 M1b lifted the GENERIC half of the resolution into `lib/media.ts` — `orderedUsable`, `cycleAt` /
// `cycleAssign` and `firstUsable` are the operations frontier's rigs and the kit's icons compose too. What
// stays here is what is gacha's alone: the wide ladder, focal crops, cutouts, and which role feeds which
// surface (the ossification fence, MEDIA_PLAN §2). Behavior is unchanged through the lift — the §9 parity
// arms in tests/themes/gachaRoster.test.ts are what say so.
//
// G5 wired the OWNER's files in (§5.4's ruled option (b)): `rosterFromIndex` below builds a `Roster` out
// of the media index's per-role listings, and `defaultRoster()` is now the FALLBACK — the bundled set a
// fresh install shows before a single file has been dropped in. Every fallback is per ROLE, so a fleet
// with owner characters and no owner reel cutout still gets the bundled cutout; only what the owner
// actually supplied is replaced.

import type { MediaFile, MediaIndex } from "../../hooks/useMedia";
import { proportionalFocal, type FocalArt } from "../../lib/focalPosition";
import { cycleAssign, cycleAt, firstUsable, orderedUsable, revUrl } from "../../lib/media";
import {
  activeIds,
  artFocal,
  ladderRows,
  offersBundled,
  rowId,
  usableLadderRows,
  type ActiveArt,
  type LibraryRow,
} from "../../lib/mediaLibrary";
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
  /** Optional landscape variant for wide-consuming slots (banner / backdrop / oracle). */
  wide?: string;
  /** Optional focal point; absent → the theme's default crop. **The entry carries its own mapping
   *  MODE** (D65 / MEDIA_MANAGER_PLAN §5, council H3): a bundled entry's is `proportional` — the
   *  hand-tuned `object-position` string below, meaning exactly what the browser has always done with
   *  it — while an owner file's is `centred`, mapped into each window's own overflow at the paint
   *  site. The mode is a property of the ITEM and never of the surface, which is what stops a rewrite
   *  of this module's consumers from silently re-cropping the theme that ships. */
  focus?: FocalArt;
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
  // NO `hero` PIN — RETIRED by the owner ruling of 2026-08-26 ("W5"). The carousel's first slide no
  // longer has art of its own to bind: it DEALS the banner pool's first usable member (`bannerScenes`
  // below), so a seat over the cast would be a second, contradictory answer to "which picture opens the
  // carousel". A clean removal, no compat rung — media v2 has never shipped to prod, so there is no
  // owner data to migrate (the no-legacy-seams rule; the `wallpaper/` role's removal at G6.3 is the
  // precedent). A hand-authored `hero:` pin is now an unknown slot key, which the config validator
  // refuses out loud rather than honouring silently (`Settings._known_media_namespaces_roles_and_slots`).
}

/** The single-pick role pools the owner's `media/gacha/<role>/` folders feed (§5.4's re-rule:
 *  drop-in = assignment). FIRST WINS in each — the owner reorders in the Conf gallery, and the index
 *  hands them over already ordered, so "first" is the owner's own pick with no pinning ceremony.
 *
 *  EMPTY is the normal state, not a defect: a role the owner has dropped nothing into leaves its
 *  consumer on the bundled default, which is what keeps a fresh install identical to G1–G4.
 *
 *  There is no `wallpaper` pool (G6.3, owner ruling): the fleet backdrop's drop-in home is the SHARED
 *  `kit/background` folder, so a gacha-only twin of it would be two homes for one idea. Its ladder is
 *  in `wallpaperArt` below and reads the kit file directly. */
export interface RolePools {
  reel: NamedArt[];
  oracle: NamedArt[];
}

export interface Roster {
  entries: RosterEntry[];
  slots: RosterSlots;
  /** The banner role's members (§6.4) — the owner's `banner/` drops, else the bundled set. Named
   *  because each slide needs a stable KEY; the visible title comes from the `SCENE_TITLES` pool by
   *  position, never from this name.
   *
   *  The FIRST usable member is the carousel's opening slide and wears the frozen hero copy; the rest
   *  are the scene slides (`bannerScenes` below is the one split). */
  scenes: NamedArt[];
  /** The owner's other role pools. See `RolePools`. */
  pools: RolePools;
}

/** A resolved piece of art for a consumer to paint. `focus` is the entry's focal point when it declared
 *  one. `null` means PLACEHOLDER: the roster is empty, or the pick was unusable. Consumers render their own
 *  neutral treatment for it (a capsule card without art is still a card) — the resolver never invents a URL. */
export interface ResolvedArt {
  /** PAINT-READY (defect #1, D65): an owner file's URL already carries its `?rev=` cache-buster, so a
   *  consumer paints `art.url` and nothing else. The cache-buster used to be each call site's job and
   *  ~10 of them forgot it, which left a replaced-in-place file painting its old bytes across the fleet
   *  — a class of bug the RESOLVER contract closes once instead of ten patches (`lib/media.ts#revUrl`
   *  is still the one spelling). Bundled art is content-hashed by the build and takes no query. */
  url: string;
  /** The entry's framing, WITH its mapping mode (§5) — handed straight to the paint site's own
   *  `useFocalPosition`/`FocalImg`, which is where the window that will paint it is measured. */
  focus?: FocalArt;
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
  // Focal points (owner, 2026-08-08 — "frame at face height, like the other two"): pegasus's and 3's
  // faces sit high in their art (eyes ~17% / ~20% from the top), so the poster band's default crop
  // (50% 26%) landed on the chest and hood. Same one-value-re-aims-every-surface contract as `4` below.
  //
  // PROPORTIONAL, and stated rather than assumed (§5's council H3): these three strings were hand-tuned
  // against these exact pictures in these exact windows under the browser's own percentage rule, so
  // re-reading them as the owner's CENTRED points would re-crop the shipped theme on every surface.
  // The S4 rewrite passes them through byte-identically; `tests/lib/focalPosition.test.ts` pins that.
  { name: "pegasus", image: ART.characters[0], focus: proportionalFocal("50% 12%") },
  { name: "atlas", image: ART.characters[1] },
  // The owner's own drops (G1 eyeball round 3): dealt to display positions 2 and 3 — vault and g5 on
  // the owner's fleet. `rook` left the deal for them; the file stays bundled for the G5 gallery.
  { name: "3", image: ART.characters[2], focus: proportionalFocal("50% 14%") },
  // Focal point (owner round 3): a full-body seated composition with the face ~18% from the top — the
  // wide CARD's default crop (50% 46%, tuned for lyra's art) landed on the shirt. One per-entry value
  // re-aims every surface (card shapes + promo); measured against simulated 16:9 and banner bands.
  { name: "4", image: ART.characters[3], focus: proportionalFocal("50% 8%") },
  // The TAIL entry: never dealt on a four-host fleet, but still the one CUTOUT-bearing entry — the G4
  // reel figure's bundled option is derived from exactly this field.
  { name: "lyra", image: ART.characters[4], cutout: ART.cutout },
  // The other tail entry (S6): `rook` lost its place in the deal to the owner's `3`/`4` and kept its
  // file. It is dealt only on a fleet of six or more — and it is HERE so that the gallery can show it
  // at all, which is the whole of the owner's "nothing shipped is left behind" ruling.
  { name: "rook", image: ART.characters[5] },
];

/** The ORACLE pool's bundled member — the operator backdrop, addressed by the stem its file already
 *  has. It used to be deliberately empty: the backdrop was scene art no pin named, so it lived on the
 *  last rung of `oracleArt`'s ladder instead of in the pool. That reasoning was sound about PINS and
 *  wrong about the LIBRARY (S6): a picture in no pool is a picture in no gallery, and the owner could
 *  neither see the one image that role paints nor put another in front of it.
 *
 *  Being a pool member makes it an ordinary entry — the fallback tier deals it while `oracle/` is
 *  empty, an owner drop replaces it, and switching it off means the operator block paints no backdrop
 *  (which `GachaAgent` already renders: the block keeps its own gradient). */
const BUNDLED_ORACLE: NamedArt[] = [{ name: "oracle", url: ART.oracle }];

/** The BANNER pool's bundled members, in the order the carousel deals them — and the ONE list both
 *  `defaultRoster()` and `sceneUrl` read, so a bundled id the gallery offers can never be one this
 *  module fails to map back to an asset.
 *
 *  `banner` is the FIRST member (owner ruling 2026-08-26, "W5"; order corrected same day — the owner's
 *  "backdrop and first slide differ" was about the MECHANISM, not the shipped pictures). It is the
 *  picture the fleet backdrop's ladder ends on, and until W5 it reached the carousel only as the fixed
 *  first slide's last fallback — art in no pool, therefore in no gallery, unorderable and un-retirable.
 *  It is an ordinary library entry now, on exactly the terms `rook` and the oracle backdrop became ones
 *  at S6 — and putting it FIRST keeps a fresh install's carousel byte-identical to what always shipped
 *  (banner opens, b2/b3 follow; the fence snapshot says so). The BACKDROP still ends on it
 *  independently (`wallpaperArt`), which is a different surface with a different ladder — switching
 *  this entry off takes its SLIDE out of the carousel and leaves the backdrop alone. */
const BUNDLED_SCENES: NamedArt[] = [
  { name: "banner", url: ART.banner },
  ...ART.scenes.map((s) => ({ name: s.name, url: s.url })),
];

export function defaultRoster(): Roster {
  return {
    entries: BUNDLED_ENTRIES,
    slots: {},
    scenes: BUNDLED_SCENES,
    pools: {
      oracle: BUNDLED_ORACLE,
      // The reel pool is different, and the difference is the PIN (§5.2 / Codex F4): the figure can be
      // chosen, so its bundled option needs a name the owner can select — and it has to survive the
      // owner replacing the cast, which is exactly what an entries-only fallback got wrong (drop in four
      // portraits and the tab transition silently lost its figure). DERIVED from the entries' `cutout`
      // field so the schema stays the one source — and since D65 the MEDIA REGISTRY derives its
      // `roles.reel.bundled` ids from THIS list in turn (`theme-engine/mediaRegistry.ts` imports
      // `defaultRoster()`; the arrow never points back), so the gallery cannot offer a name this pool
      // would refuse. The backend's hand-listed copy is held in step by a drift test.
      reel: BUNDLED_ENTRIES.filter((e) => e.cutout !== undefined).map((e) => ({
        name: e.name,
        url: e.cutout as string,
      })),
    },
  };
}

// ── the §2.4 ACTIVE RESOLVERS (D65, council H1) ──────────────────────────────────────────────────
//
// "Which image is live" is LADDER knowledge, and the ladders are gacha's. Each role's rule is ONE
// exported function over the collated index rows, imported by BOTH the paint site (`rosterFromIndex`
// below) and the Conf gallery (through `theme-engine/mediaRegistry.ts`, which imports this module —
// the arrow never points back). That is what stops the gallery claiming a binding the render will not
// honour: there is only one rule to claim.
//
// Every one of them is PURE in the rows (plus the wire's `slots` where a pin is involved) and reads
// only facts the wire carries — `listed`, `hidden`, `unusable` — so no resolver ever touches config
// (§2.3 ④). The BUNDLED rows they may return are mapped back to this theme's own assets by
// `bundledEntry` below; the server emits an id, never a url.

/** The dealt CAST. `ladderRows` is the presence-based tier rule, which is exactly what shipped: an
 *  owner `characters/` folder replaces the bundled cast even when every file in it is broken (each
 *  broken entry keeps its position and only ITS host gets the placeholder — dropping it would re-deal
 *  every host after it). */
export function castRows(rows: readonly MediaFile[]): MediaFile[] {
  return ladderRows(rows);
}

/** The banner POOL — every usable entry, in order (the first opens the carousel, the rest are scene
 *  slides). Usability decides the tier here (the `usableLadderRows` half of the pair): a folder holding
 *  nothing but broken slides falls back to the bundled set rather than showing an empty carousel. */
export function sceneRows(rows: readonly MediaFile[]): MediaFile[] {
  return usableLadderRows(rows);
}

/** A single-pick POOL (`reel`, `oracle`): presence-based tier, then first-wins at the call site. */
export function poolRows(rows: readonly MediaFile[]): MediaFile[] {
  return orderedUsable(ladderRows(rows));
}

/** The gallery's reading of a dealt role — every member is in use, and the mode word says how. */
export function activeCast(rows: readonly LibraryRow[]): ActiveArt {
  return { ids: activeIds(castRows(rows as readonly MediaFile[])), mode: "deal" };
}

export function activeScenes(rows: readonly LibraryRow[]): ActiveArt {
  return { ids: activeIds(sceneRows(rows as readonly MediaFile[])), mode: "all" };
}

/** A first-wins pool with an in-role PIN (`reel` ← `reel_figure`): the pin, else the pool's first
 *  usable member. `slot` is the pin's key, so the one function serves every pool of this shape. */
export function activePool(slot?: string) {
  return (rows: readonly LibraryRow[], slots: Readonly<Record<string, string>>): ActiveArt => {
    const pick = firstUsable(
      poolRows(rows as readonly MediaFile[]),
      slot ? slots[slot] : undefined,
    );
    return { ids: pick ? [rowId(pick)] : [], mode: "first" };
  };
}

/** The ORACLE pool, whose winner may live in ANOTHER section: `oracleArt` reads the `oracle` SEAT pin
 *  (a character bound into the backdrop) before it ever looks here. When that pin is set, this pool
 *  paints nothing — and the card must say so with a pointer to the seat rather than marking a tile
 *  that is not on screen (Opus confirm ②, the pin-beats-pool phantom). */
export function activeOraclePool(
  rows: readonly LibraryRow[],
  slots: Readonly<Record<string, string>>,
): ActiveArt {
  if (slotEntryName(slots, "oracle") !== undefined) {
    return { ids: [], mode: "first", overriddenBySlot: "oracle" };
  }
  return activePool()(rows, slots);
}

/** A SEAT (§2.1's pin-backed section): a read-only view over the source role where the ONE write is
 *  the pin. Active = the row the pin names, resolved against this same list — a dangling pin marks
 *  nothing, exactly as the ladder falls through.
 *
 *  It took a chain of FALLBACK pin keys until 2026-08-26, for the one seat that read another's pin (the
 *  hero slide followed the fleet backdrop's). That seat is gone with the ruling that retired it, and the
 *  parameter went with it rather than sitting unused — every remaining seat reads its own pin alone. */
export function activeSeat(slot: string) {
  return (rows: readonly LibraryRow[], slots: Readonly<Record<string, string>>): ActiveArt => {
    const name = slotEntryName(slots, slot);
    const row = name === undefined ? undefined : rows.find((r) => r.name === name && !r.unusable);
    return { ids: row === undefined ? [] : [rowId(row)], mode: "first" };
  };
}

/** A pin's value, or `undefined` for unset/blank — the one place the empty-string case is handled, so
 *  a cleared pin can never read as a pin on an entry called "". */
function slotEntryName(slots: Readonly<Record<string, string>>, key: string): string | undefined {
  const value = slots?.[key];
  return typeof value === "string" && value !== "" ? value : undefined;
}

/** Build the live roster from the media index (§5.4) — the ONE adapter between the endpoint and the
 *  resolver. `undefined` (the query has not answered, or failed) is the bundled set, so first paint and
 *  a backend hiccup both show art rather than placeholders.
 *
 *  The fallback is PER ROLE, not all-or-nothing: an empty `characters/` keeps the bundled cast while an
 *  owner-filled `banner/` still wins its own slides. That is what makes "drop one file in" a complete,
 *  useful action instead of an all-or-nothing switch to a half-empty theme.
 *
 *  Since D65 the FALLBACK is the index's own bundled tier rather than a second list held here: the
 *  resolvers above return rows, `toEntry`/`toNamed` map a bundled row back to this theme's asset, and a
 *  bundled entry the owner LISTED mixes into the deal at the priority they gave it. A fresh install is
 *  byte-identical to `defaultRoster()` by construction — the fallback tier is the whole bundled set, in
 *  the registry's order, which is derived from `defaultRoster()` in the first place. */
export function rosterFromIndex(index: MediaIndex | undefined): Roster {
  if (index === undefined) return defaultRoster();
  // Defensive against the PAYLOAD, not against our own types: this is wire data, and a stub/partial
  // response (an e2e mock, a proxy answering `{}`) must degrade to the bundled set rather than throw
  // inside a theme's render.
  const role = (name: string): MediaFile[] => {
    const files = index.roles?.[name];
    return Array.isArray(files) ? files : [];
  };
  const bundled = defaultRoster();
  const characters = role("characters");
  const banner = role("banner");
  const reelFiles = role("reel");
  const oracleFiles = role("oracle");
  const cast = castRows(characters).map(toEntry);
  const scenes = sceneRows(banner).map((f) => toNamed(f, sceneUrl(f.bundled)));
  const reel = poolRows(reelFiles).map((f) => toNamed(f, cutoutUrl(f.bundled)));
  // The last DEGRADE rung, and only that (Emma's S2 review #2). A role that resolved to nothing may
  // fall back to the shipped set ONLY while this payload never described the bundled tier — a stub, a
  // partial mock, a proxy answering `{}` — because the real server emits every role's bundled ids and
  // marks the hidden ones. Once the tier IS on the wire, "nothing resolved" is the owner's own answer:
  // they switched the entries off, and a fleet that kept painting them would make the In-use switch a
  // lie. `offersBundled` is the one predicate; the tier rules above decide everything after it.
  const shipped = <T>(resolved: T[], rows: readonly MediaFile[], fallback: T[]): T[] =>
    resolved.length > 0 || offersBundled(rows) ? resolved : fallback;
  return {
    entries: shipped(cast, characters, bundled.entries),
    slots: index.slots ?? {},
    scenes: shipped(scenes, banner, bundled.scenes),
    pools: {
      reel: shipped(reel, reelFiles, bundled.pools.reel),
      oracle: shipped(
        poolRows(oracleFiles).map((f) => toNamed(f, oracleUrl(f.bundled))),
        oracleFiles,
        bundled.pools.oracle,
      ),
    },
  };
}

/** The bundled CAST by id — the same objects `defaultRoster()` deals, so a bundled row that reaches
 *  the fleet keeps its hand-tuned focal point and its cutout. */
const BUNDLED_BY_ID = new Map(BUNDLED_ENTRIES.map((e) => [e.name, e]));

/** One library row as a roster ENTRY. A bundled row resolves to this theme's own asset (the server
 *  emits the id and never a url); one it cannot resolve keeps its POSITION as an unusable entry rather
 *  than vanishing, because vanishing would re-deal every host after it. An owner file has no
 *  `wide`/`cutout`: the folder a file sits in is the whole of the rest of its assignment.
 *
 *  Its FRAMING is its own, though (§5): `artFocal` is the one predicate that folds "no point set" and
 *  "set against bytes that have since been replaced" into the same answer, so a stale point can never
 *  reach a surface. */
function toEntry(f: MediaFile): RosterEntry {
  if (f.bundled != null)
    return BUNDLED_BY_ID.get(f.bundled) ?? { name: f.bundled, image: "", unusable: true };
  const focus = artFocal(f);
  return {
    name: f.name,
    image: revUrl(f.url, f.revision),
    ...(focus !== undefined && { focus }),
    ...(f.unusable && { unusable: true }),
  };
}

/** One library row as a POOL member. `bundledUrl` is the theme asset that id stands for, per role. */
function toNamed(f: MediaFile, bundledUrl: string | undefined): NamedArt {
  if (f.bundled != null) return { name: f.bundled, url: bundledUrl ?? "" };
  const focus = artFocal(f);
  return {
    name: f.name,
    url: revUrl(f.url, f.revision),
    rev: f.revision,
    ...(focus !== undefined && { focus }),
  };
}

const sceneUrl = (id: string | null | undefined): string | undefined =>
  BUNDLED_SCENES.find((s) => s.name === id)?.url;
const cutoutUrl = (id: string | null | undefined): string | undefined =>
  id == null ? undefined : BUNDLED_BY_ID.get(id)?.cutout;
const oracleUrl = (id: string | null | undefined): string | undefined =>
  BUNDLED_ORACLE.find((a) => a.name === id)?.url;

/** The entry a host at `index` (its position in the fleet's DISPLAY order) is assigned.
 *
 *  ORDERED CYCLING when there are more hosts than entries (`i mod N`, ruled at lock — Codex R4-3): the
 *  alternative, leaving the overflow hosts art-less, would make the placeholder a NORMAL state on any fleet
 *  bigger than the roster. `cycleAt` is that operation, and it deals the list WHOLE — an unusable entry
 *  holds its position and only `toArt` below turns it into the placeholder. */
export function entryForHost(roster: Roster, index: number): RosterEntry | null {
  return cycleAt(roster.entries, index);
}

/** The card/portrait art for a host at `index`. `null` → the consumer's placeholder treatment. */
export function artForHost(roster: Roster, index: number): ResolvedArt | null {
  return toArt(entryForHost(roster, index));
}

/** The whole fleet's assignment in one call, in display order — what a Fleet body maps over. */
export function assignArt(roster: Roster, hostCount: number): (ResolvedArt | null)[] {
  return cycleAssign(roster.entries, hostCount).map(toArt);
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
//    naming an entry (the owner binding a character into a role) → the owner's DROP-IN pick → the BUNDLED
//    default. The bundled art is the fallback rather than a roster entry so it can never be dealt to a
//    host as a capsule portrait (the art.ts partition rule).
//
//    The middle rung is a gacha role FOLDER for every ladder but one: the fleet backdrop's is the SHARED
//    `kit/background` pool, since G6.3 removed gacha's twin of it (owner ruling — one home per idea).

/** The SHARED kit background as a rung of a gacha ladder (G6.3, owner ruling 2026-08-06). Already resolved
 *  by `kit/ownerArt.ts#backgroundArtFrom` — i.e. the kit's own pin-then-first-usable pick — so this only
 *  restates it as `ResolvedArt`. `undefined` in, `null` out: the rung is simply absent.
 *
 *  No focal point: the kit role has none to declare, so the surface keeps tokens.css's default crop.
 *
 *  PAINT-READY like every other rung (Emma's S2 review #8): `ResolvedArt.url` carries its own `?rev=`,
 *  so a consumer paints it and nothing else. This rung used to hand back the bare mount URL and leave
 *  the stamping to its two call sites — which is exactly the split that made one of them stamp a
 *  string another rung had already stamped, giving the same bytes two cache keys. One contract, one
 *  spelling, one key. */
function toKitArt(file: MediaFile | undefined): ResolvedArt | null {
  if (file === undefined) return null;
  return { url: revUrl(file.url, file.revision), rev: file.revision };
}

/** The fleet wallpaper / pickup-banner backdrop — THREE rungs, and only the first is gacha's own folder:
 *
 *    ① the `wallpaper:` PIN, which names a CHARACTER (the theme-specific mechanism: bind a cast portrait
 *       to the backdrop, through the wide ladder so it crops as a landscape);
 *    ② the SHARED kit background (`media/kit/background/`) — the owner's drop-in home for "a big picture
 *       behind the app", for every theme;
 *    ③ the bundled scene.
 *
 *  gacha used to own a `wallpaper/` drop folder here, and G6.3 REMOVED it outright (owner ruling
 *  2026-08-06: "just having the background in the kit is the better approach — no duplicated systems").
 *  The two folders were one idea with two homes, and the confusion was real: the owner dropped a file
 *  into the shared one, saw nothing change under gacha — whose scenery is exclusive, so `GachaRoot`
 *  passes `kitBackground={false}` and the kit's own layer never mounts (D54 A5) — and read the app as
 *  broken. Now the shared folder IS the drop-in rung, and what stays gacha's is the half the kit has no
 *  equivalent for: pinning a character. Clean removal, no compat rung — media v2 never shipped to prod.
 *
 *  The kit file arrives as an ARGUMENT (`useKitBackgroundArt()` at the two call sites) rather than being
 *  read here, because this module is pure — no store, no queries, no React — which is what makes the whole
 *  ladder an ordinary unit test. Omitted ⇒ pin, else the bundled scene.
 *
 *  VISIBILITY stays split, deliberately: gacha's own "Banner wallpaper" switch governs this surface (it is
 *  gacha's), and the kit's "Shared background" switch governs the kit LAYER, which gacha does not mount. A
 *  theme's own switch owning its own surface is the same rule §4.4 already runs on.
 *
 *  **THIS SURFACE IS THE BACKDROP'S ALONE** (owner ruling 2026-08-26, "W5"). It used to be shared with the
 *  carousel's first slide — §5.3's "two pictures disagreeing reads as a bug" applied to the fleet screen —
 *  and the owner REVERSED that: the carousel now deals its own opening slide out of the banner pool
 *  (`bannerScenes`), so setting a kit background moves the backdrop and leaves the carousel where it is.
 *  The two are different destinations with different libraries, and showing two pictures at once is what
 *  the screen is for. */
export function wallpaperArt(roster: Roster, kitBackground?: MediaFile): ResolvedArt {
  return (
    toWideArt(slotEntry(roster, "wallpaper")) ?? toKitArt(kitBackground) ?? { url: ART.banner }
  );
}

/** The pickup carousel's two art sources (§6.4, owner ruling 2026-08-26 "W5") — ONE split, here, because
 *  "which member opens the carousel" is ladder knowledge and every other ladder lives in this module:
 *
 *    · `lead` — the banner pool's FIRST usable member, which wears the frozen PICKUP / NETWORK PRIZE POOL
 *      copy. An EMPTY pool (every entry switched off, or every file broken) keeps the slide and paints the
 *      fleet backdrop's own resolution instead: the carousel must never lose its first slide, and the
 *      backdrop is the only other picture this screen is certain to have.
 *    · `rest` — the scene slides, titled from the `SCENE_TITLES` pool by their position in THIS list.
 *
 *  The members are passed WHOLE rather than as bare urls: a `banner` item is `framable` (§5), so its focal
 *  point and its `?rev=` identity have to reach the paint site with it.
 *
 *  No usability filter here, and that is the schema's doing rather than an omission: `sceneRows` is the
 *  role's tier rule and it is the `usableLadderRows` half of the pair, so what reaches `Roster.scenes` is
 *  already only what can paint — which is why a scene member carries no `unusable` flag to re-check. */
export function bannerScenes(
  roster: Roster,
  kitBackground?: MediaFile,
): { lead: ResolvedArt; rest: NamedArt[] } {
  const [first, ...rest] = roster.scenes;
  return { lead: first ?? wallpaperArt(roster, kitBackground), rest };
}

/** The agent oracle's backdrop — the `oracle` SEAT pin (a character bound into the block), else the
 *  role's own first usable member, else NOTHING.
 *
 *  The bundled backdrop is a pool MEMBER now (`BUNDLED_ORACLE`), so it reaches this ladder through the
 *  same rung an owner drop does and `rosterFromIndex`'s `shipped` guard is what keeps a stub payload
 *  painting it. A hard-coded last rung here would have outranked the In-use switch: the gallery would
 *  say "nothing in use" while the block kept painting the retired picture — Emma's S2 review #2, in the
 *  one place the pool had no member to be honest with. `null` = paint no backdrop. */
export function oracleArt(roster: Roster): ResolvedArt | null {
  return toWideArt(slotEntry(roster, "oracle")) ?? firstUsable(roster.pools.oracle) ?? null;
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
  // `firstUsable`'s pin resolves within THIS pool and nothing else, which is exactly the F4 ruling: a
  // legacy pin naming a plain character finds no member here and falls through to the pool's own first.
  return firstUsable(roster.pools.reel, roster.slots.reel_figure) ?? null;
}
