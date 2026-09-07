// The media LIBRARY's pure half (D65 / MEDIA_MANAGER_PLAN §2.3 + §6.5) — the config transforms every
// gallery write goes through, and the tier vocabulary every active resolver reads.
//
// PURE and theme-free, on exactly the `lib/media.ts` terms it sits beside: no React, no query, no
// registry import. The section DESCRIPTORS (and the per-ladder `active` resolvers) live in
// `theme-engine/mediaRegistry.ts` — the one module allowed to know themes — and are handed to these
// functions as ARGUMENTS (the council H4 rider). What lives here is only what is true of every
// namespace: how a collated row is identified, which TIER it belongs to, and what a config write may
// and may not say.
//
// ── the write rule, which is the whole reason this module exists ────────────────────────────────
//
// `media.namespaces.<ns>.roles.<role>.files` is an ORDERED list of per-item objects, and the server
// collates it into the library the gallery shows (`core/media.py#list_role`, `library-v1`): the listed
// entries in order, then unlisted files on disk, then the role's unlisted BUNDLED ids as the FALLBACK
// TIER. A write therefore has to express an order over rows that are not all listed, and what it may
// list is decided by the INTENT, not by the tier (§2.3 ③ as AMENDED by the owner 2026-08-25):
//
//   · an ORDER intent — `moveBy` and `moveToEdge`, therefore the drag, and since the 2026-08-26 ruling
//     `restoreDefaults` (which states "the defaults are the selection" as a position) — SWEEPS THE WHOLE SECTION
//     into `files` in the resulting display order, unlisted disk rows and unlisted bundled rows alike.
//     The section's order becomes explicit, which is the only shape that can say it: a partial
//     listing cannot express a mid-list position at all (a downward drag inside an all-bundled section
//     had no expressible target and snapped home), and listing only the two rows of a swap SHRANK the
//     deal — `ladderRows`' own-tier-replaces-fallback rule then dealt those two portraits across the
//     whole fleet. A full sweep is THE SAME ART IN THE NEW ORDER: zero paint surprise, and the fleet
//     the owner was looking at is the fleet they keep.
//   · SWITCHING AN ENTRY OFF, where order IS the section's priority system, is the second order intent
//     (owner ruling 2026-08-26, "W7") — and the only thing it says about order is *nothing moved*: it
//     writes the display order EXACTLY as it stands and marks its one entry `hidden`. **Membership
//     never moves a picture.** An unticked image dims where it is and stays there; re-ticking it puts
//     it back in use from the same place; arranging is the drag's job and no other gesture's. The
//     sweep is what BUYS that stillness, and the owner round is what proved it necessary: listing the
//     one bundled row the tap acted on and nothing else collated that row to the FRONT of the grid (a
//     listed entry precedes the whole fallback tier), and left a bare `{bundled: id}` behind as the
//     section's SOLE own-tier member — so un-ticking it again collapsed the deal to that one picture
//     on every host. Where order decides nothing — a named role's per-key gallery — the switch stays
//     the minimal write below: sweeping a role that binds by NAME would list other keys' bundled rows
//     for no reason at all.
//   · every OTHER intent — `setFocal`, `appendItem`, `removeItem`, and the un-hide half of the switch
//     — lists only the entry it acted on (plus the disk tier, which is free: those rows already sit in
//     the resolution prefix, so listing them changes nothing but their order). None of them is a claim
//     about the section's ORDER, so none of them may make one.
//
// The un-hide half carries the rule's one DELETION, the **bare-entry guard**: clearing `hidden` off a
// bundled entry that has nothing else left to say drops the entry from `files` entirely, rather than
// keeping a `{bundled: id}` whose only effect is to promote that row into the owner's own tier. It
// fires only where the role is NOT fully listed — i.e. where the entry would be a lone own-tier member
// beside a fallback tier that is still the live one. After a sweep every bundled row is listed, so the
// entry stays and the position with it. That is what keeps a legacy or hand-edited config (and the
// non-sweep path above) from collapsing a whole dealt role to one picture.
//
// **THERE IS NO `setActive` AND NO `makeEligible`** (owner ruling 2026-08-26, "W6"): order is the only
// priority system, so "use this one" is `moveToEdge(…, "top")` — an ordinary order intent, with no
// membership side effect. The two used to exist because activation was a second, parallel system:
// `setActive` was move-to-front *plus* an un-hide, and `makeEligible` was the `files` half a POOL PIN
// needed to make its target resolvable. Every pool pin is gone, and the two SEATS that remain refuse a
// target their source ladder does not already deal rather than repairing the source library from a
// read-only view of it (§2.1).
//
// The rule this amends said no write may ever list a bundled row it was not pointed at, so that "the
// owner's first drag must not enlist five bundled characters into the fleet". The owner overruled it:
// reordering the shipped cast IS the feature, and a drag that will not move is a worse answer than a
// config file that names the art it already paints. What the amendment does NOT touch is the VIRGIN
// section: a role nobody has reordered still has an empty `files` list, so an upload into it replaces
// the bundled tier exactly as it always did (the ladder fallback is untouched) — which is what keeps
// the config-shape migration paint-parity-free. After a sweep the defaults are owner-tier members, and
// an upload joins them at the end under the ordinary additive rule.
//
// Every arm is pinned in tests/lib/mediaLibrary.test.ts.

import { centredFocal, type FocalArt, type FocalPoint } from "./focalPosition";
import { orderedUsable, revUrl, type MediaNamed } from "./media";
// TYPE-ONLY, and the one vocabulary this module borrows: `ActiveArt.outranked` reports the agent
// backdrop's own ladder (D70 §8.3), whose words are declared once beside the mode they belong to. No
// runtime edge is added — the purity above is untouched.
import type { BackdropOutrank } from "../theme-engine/kit/agentBackdrop";

/** One collated LIBRARY row, structurally — the wire's `MediaFile` and anything derived from one.
 *  A local interface rather than the wire type for the reason `MediaUsable` is one: this module must
 *  stay reachable from a theme module without dragging the query layer in behind it. */
export interface LibraryRow extends MediaNamed {
  /** The filename inside the role folder — the identity a config `files` entry's `name` holds. Empty
   *  on a bundled row, whose identity is its registry id instead. */
  file: string;
  /** The registry id when this row IS one of the role's bundled entries. */
  bundled?: string | null;
  /** True when the owner's `files` list holds this entry (§2.3 ④). */
  listed?: boolean;
  /** The owner excluded it from resolution while keeping it in the library. */
  hidden?: boolean;
}

/** The stored framing point, structurally — `MediaFile["focal"]` without the import. */
export interface StoredFocal extends FocalPoint {
  /** The `revision` these coordinates were set against (§2.2). */
  rev: string;
}

/** A row carrying enough to answer "is its framing still about THIS picture" — the wire's `focal`, the
 *  `revision` it is keyed to, and whether the row is BUNDLED (which is what decides whether the keying
 *  applies at all — see `focalState`). */
export interface FocalRow {
  focal?: StoredFocal | null;
  revision?: string;
  width?: number | null;
  height?: number | null;
  /** The registry id when this row is one of the role's bundled entries. */
  bundled?: string | null;
}

/** One `files` entry, structurally — `hooks/useSettings.ts#MediaFileEntry` without the import. Open,
 *  because an entry carries fields this module neither reads nor may drop (`focal`, `key`, and
 *  whatever a later slice adds): every transform here is a read-modify-WRITE over the persisted
 *  object, never a rebuild from the index. */
export interface LibraryEntry {
  name?: string;
  bundled?: string;
  [k: string]: unknown;
}

/** A `slots` PIN as persisted — the SAME identity union a `files` entry carries (the 2026-08-26 owner
 *  ruling, "W9"), which is the whole point of the shape: ONE identity idiom config-wide, read by ONE
 *  parser. `null`/absent is unpinned.
 *
 *  A type alias rather than a second interface: a pin and a `files` entry are structurally the same
 *  reference, and duplicating the shape would invite the two to drift into two parsers — which is
 *  exactly the bug the ruling closed. It has its own NAME because it is its own concept (a binding,
 *  not a list member) and because the two will grow different optional fields; the day one does, this
 *  alias splits into an interface and nothing else moves. */
export type PinRef = LibraryEntry;

/** The wire's `slots` map, structurally: pin key -> the entry it binds. Absent or `null` = unpinned. */
export type SlotPins = Readonly<Record<string, PinRef | null | undefined>>;

/** A row's IDENTITY as one comparable string — `f:<filename>` for a file on disk, `b:<id>` for a
 *  bundled entry. The two spaces are kept apart on purpose (the config identity is a discriminated
 *  union, §2.2): a role may hold a file called `lyra.webp` AND the bundled id `lyra`, and they are two
 *  different library entries with two different priorities. Doubles as the React key. */
export type RowId = string;

export function rowId(row: LibraryRow): RowId {
  return row.bundled != null ? `b:${row.bundled}` : `f:${row.file}`;
}

/** The row as a PIN — what "use this one here" persists (§2.1). The inverse of `entryId` over the same
 *  union, and here rather than at the write site so the two spellings can never disagree about which
 *  field a bundled row goes in. */
export function pinRef(row: LibraryRow): PinRef {
  return row.bundled != null ? { bundled: row.bundled } : { name: row.file };
}

/** The same identity for a BUNDLED id the registry names — the one caller is the restore, which has to
 *  state the shipped order and only the registry knows it. Here because the `b:` spelling lives in this
 *  module and nowhere else. */
export function bundledRowId(id: string): RowId {
  return `b:${id}`;
}

/** The same identity for a CONFIG entry — `null` for a malformed one (neither field, or both), which
 *  the server's validator refuses but a hand-edited config could still carry into a read. */
export function entryId(entry: LibraryEntry): RowId | null {
  if (typeof entry?.bundled === "string") {
    return typeof entry.name === "string" ? null : `b:${entry.bundled}`;
  }
  return typeof entry?.name === "string" ? `f:${entry.name}` : null;
}

/** Whether an id names a BUNDLED entry (the tier that is never swept). */
export function isBundledId(id: RowId): boolean {
  return id.startsWith("b:");
}

/** The identity one `slots` PIN names, or `null` for unpinned/cleared/malformed — the ONE place a pin
 *  is read, through the very parser a `files` entry is read by ("W9").
 *
 *  It replaced a `slotEntryName` that answered with a NAME, and the difference is the whole ruling: a
 *  name had to be matched against `MediaFile.name`, which is one string standing for two identity
 *  spaces (a file's stem and a bundled id), so `lyra` reached whichever the collation listed first. An
 *  id names one entry, so a pin either resolves to that entry or resolves to nothing. */
export function slotPin(slots: SlotPins, key: string): RowId | null {
  const pin = slots?.[key];
  return pin == null ? null : entryId(pin);
}

/** The HUMAN half of a pin — the filename, or the bundled id — for a sentence the owner reads. The
 *  `f:`/`b:` spelling is an internal identity and never leaves the code (`""` for a pin holding
 *  neither, which only a hand-edited config can produce). */
export function pinLabel(pin: PinRef): string {
  return typeof pin.name === "string"
    ? pin.name
    : typeof pin.bundled === "string"
      ? pin.bundled
      : "";
}

// ── the tiers a resolver reads (§2.3 ④ — every fact is on the wire) ──────────────────────────────

/** The rows resolution may consider: everything the owner has not switched OFF.
 *
 *  `hidden` and `unusable` take OPPOSITE treatments and must never fold into one predicate (§2.2):
 *  a hidden row is FILTERED OUT of the set (re-dealing is the point of the switch), while an unusable
 *  row HOLDS its position (`cycleAt`'s shipped rule — one bad file must not re-deal the fleet). This
 *  function is the first half; `lib/media.ts#orderedUsable` is the second, and pool ladders compose
 *  them in that order. */
export function shown<T extends LibraryRow>(rows: readonly T[]): T[] {
  return rows.filter((r) => !r.hidden);
}

/** The OWNER's own tier: files on disk plus any bundled entry they explicitly listed. */
export function ownTier<T extends LibraryRow>(rows: readonly T[]): T[] {
  return rows.filter((r) => r.bundled == null || r.listed === true);
}

/** The FALLBACK tier: the role's bundled ids that no `files` entry names. They participate in
 *  resolution only where a ladder already fell through to bundled art — which is exactly what makes
 *  the config-pure migration paint-parity-free (§2.4). */
export function fallbackTier<T extends LibraryRow>(rows: readonly T[]): T[] {
  return rows.filter((r) => r.bundled != null && r.listed !== true);
}

/** Whether this payload OFFERED the role's bundled tier at all.
 *
 *  The predicate that separates *"the owner retired the shipped art"* from *"this payload never
 *  described it"* — and every theme ladder's last rung hangs off it (Emma's S2 review #2). A ladder
 *  ends in the theme's own bundled asset, and restoring that rung after the role RESOLVED to nothing
 *  would resurrect art the owner explicitly switched OFF: the gallery says "nothing in use" while the
 *  surface keeps painting it. But the rung must stay for a STUB payload — an e2e mock, a proxy
 *  answering `{}`, a partial response — which is what these render paths have always degraded to, and
 *  the one thing that keeps a theme from painting holes while the backend is unreachable.
 *
 *  A bundled ROW is what tells the two apart. The real server emits every role's bundled ids, hidden
 *  ones included and marked (§2.3 ④), so a payload carrying none is one that never described the
 *  tier — while a bundled row the owner switched off is still an ENTRY, and hiding it means what it
 *  says. */
export function offersBundled(rows: readonly LibraryRow[]): boolean {
  return rows.some((r) => r.bundled != null);
}

/** The ONE shape every "the owner's drops, else the bundled art" ladder has (gacha's cast, its scene
 *  slides and its reel pool; frontier's rigs): the owner's tier when it holds anything at all, else
 *  the fallback tier. Hidden rows are skipped first, so switching the last owner file OFF falls the
 *  role back to its bundled art rather than blanking it. */
export function ladderRows<T extends LibraryRow>(rows: readonly T[]): T[] {
  const visible = shown(rows);
  const own = ownTier(visible);
  return own.length > 0 ? own : fallbackTier(visible);
}

/** `ladderRows` for a ladder that SKIPS broken files rather than dealing them (a first-wins pool, the
 *  banner's slide set): the tier falls back when the owner's tier holds nothing USABLE, not merely
 *  nothing at all.
 *
 *  The pair is deliberate and each half is a shipped semantic (§2.4 — ladders keep their predicates):
 *  in a DEALT role a broken file holds its position, so its mere presence means "the owner supplied a
 *  cast"; in a first-wins role its position buys only a blank surface, so a folder holding nothing but
 *  broken files still falls through to the bundled art. */
export function usableLadderRows<T extends LibraryRow>(rows: readonly T[]): T[] {
  const visible = shown(rows);
  const own = orderedUsable(ownTier(visible));
  return own.length > 0 ? own : orderedUsable(fallbackTier(visible));
}

// ── the framing point, rev-keyed (§2.2 / §5) ─────────────────────────────────────────────────────
//
// ONE predicate, here, because "does this row have a framing point" is asked in four places that must
// never disagree: the paint sites (through `artFocal`), the framing sheet (which has to SAY why the
// point it is not showing is gone), the item detail's affordance, and the write that replaces it.

/** Three states, not two (`set`/`unset` would swallow the third and it is the one the owner needs
 *  told about):
 *
 *   · `unset` — no point was ever stored. Every surface uses its own default crop.
 *   · `set`   — stored, and still about these bytes.
 *   · `stale` — stored against a DIFFERENT `revision`. Owner media is mutable in place under a stable
 *     name (an SSH overwrite is the ordinary repair), so a point set on the old picture describes a
 *     spot in a picture that is gone. It reads as UNSET everywhere, and the framing sheet says
 *     "framing was reset — the file changed" rather than silently cropping to a stranger's shoulder.
 *
 *  **A BUNDLED row is keyed to nothing, and that is not a special case but the absence of the one this
 *  is for** ("W10"). Rev-keying exists because owner media CHANGES under a stable name; a bundled
 *  entry's bytes are content-hashed by the build and cannot change under a running app, so there is no
 *  revision for a point to go stale against — the server sends none (`bundled_row` has no file to
 *  stat), and a point stored on one reads `set` for as long as that asset ships. The residual is
 *  recorded rather than guarded: a future release that re-arts a bundled id under the same name
 *  inherits the owner's point un-warned, which is exactly the acceptance the hand-tuned focal strings
 *  in the themes' own ladders have always carried. */
export type FocalState = "unset" | "set" | "stale";

export function focalState(row: FocalRow): FocalState {
  const focal = row.focal;
  if (focal == null || !Number.isFinite(focal.x) || !Number.isFinite(focal.y)) return "unset";
  if (row.bundled != null) return "set";
  // An empty `rev` matches no revision, which is what makes the field safely additive: a point
  // written by anything that did not know about the keying degrades rather than lying.
  return focal.rev !== "" && focal.rev === (row.revision ?? "") ? "set" : "stale";
}

/** The row's LIVE point, or `undefined` for unset AND for stale — the one place that fold happens. */
export function rowFocal(row: FocalRow): FocalPoint | undefined {
  const focal = row.focal;
  return focal != null && focalState(row) === "set" ? { x: focal.x, y: focal.y } : undefined;
}

/** The row as a paint-site input (§5's council H3): a row with a live point is CENTRED, and carries the
 *  source pixels the centred mapping needs. Everything else has no framing of its own and leaves the
 *  surface on its own default crop.
 *
 *  A BUNDLED row's dimensions are not on the wire — the server has never seen that asset — so a theme
 *  composes `rowFocal` with its own asset record's `width`/`height` instead of calling this (see
 *  `themes/gacha/roster.ts`). The FOLD is still only here: `rowFocal` is what both paths ask. */
export function artFocal(row: FocalRow): FocalArt | undefined {
  const point = rowFocal(row);
  return point === undefined ? undefined : centredFocal(point, row.width, row.height);
}

// ── active resolution (§2.4) ─────────────────────────────────────────────────────────────────────

/** How MANY of a section's entries are live at once, in the owner's words (R59 §11.1 — the field
 *  expresses rotation as a word, never as an invented badge vocabulary):
 *   · `first` — one entry wins (a first-usable pool, a pin, a named key);
 *   · `all`   — every entry is on screen (the banner's scene slides);
 *   · `deal`  — the entries are dealt positionally across the fleet (the cast, the rigs). */
export type ActiveMode = "first" | "all" | "deal";

/** What a section's `active` resolver answers: which library rows are LIVE, in how many places, and
 *  — when the winner lives in another section — which one (Opus confirm ②).
 *
 *  `overriddenBySlot` names a `slots` PIN, not a section, because a theme ladder must never know
 *  section ids (the registry mints those). `useMediaLibrary` turns it into the pointer the card
 *  renders: "Currently set by <seat> →". */
export interface ActiveArt {
  ids: readonly RowId[];
  mode: ActiveMode;
  overriddenBySlot?: string;
  /** The winner lives OUTSIDE this gallery entirely, so there is no section to point at — today the two
   *  ways the AGENT BACKDROP beats a theme's operator-art ladder (D70 §8.3: the active agent's own
   *  picture, or the mode being `off`). MINTED BY THE WIRING, never by a resolver: those are facts about
   *  the app's state, and a resolver is pure in its role's rows and the wire's `slots` (§2.4). Same
   *  consequence as `overriddenBySlot`'s honoured claim — the ids are blanked — plus the WORD the card
   *  needs, because "nothing in use" would name the wrong reason. */
  outranked?: BackdropOutrank;
}

/** A section's `active` resolver: PURE in the index rows + the wire's `slots`, never in config
 *  (§2.4 — the wire carries `listed`/`hidden`/`key` precisely so this is sufficient). */
export type ActiveResolver = (rows: readonly LibraryRow[], slots: SlotPins) => ActiveArt;

/** `ids` for however many rows a ladder resolved — the adapter every resolver ends in. */
export function activeIds(rows: readonly LibraryRow[]): RowId[] {
  return rows.map(rowId);
}

// ── the config transforms (§2.3 ③ / §6.5) ────────────────────────────────────────────────────────

/** What ONE write says about the role's `files` list. Built by the named operations below — never
 *  hand-assembled at a call site, so the tier rule has exactly one implementation. */
interface WriteSpec {
  /** The display order the owner asked for, as row ids. */
  order: readonly RowId[];
  /** The ids the owner explicitly ACTED ON — the only bundled rows a NON-order write may list. */
  touched: readonly RowId[];
  /** This write is an ORDER INTENT: `order` above is a statement about the whole section, so every
   *  bundled row in it is listed too (the 2026-08-25 amendment — see the header). Absent ⇒ the write
   *  says nothing about order and lists only what it acted on. */
  sweep?: boolean;
  /** The one entry this write may DROP when its edit leaves it with nothing left to say — the
   *  BARE-ENTRY GUARD (the header's last paragraph). Set by the un-hide half of the switch, and
   *  honoured only while the role's bundled tier is NOT fully listed. */
  bare?: RowId;
  /** Per-entry field edits, for a write about ONE item (the In-use switch writes `hidden` here). */
  edit?: { id: RowId; fields: LibraryEntry };
  /** Which entries this write drops from the list entirely — a delete's config half. A PREDICATE
   *  rather than an id so a write that means several entries needs no second field. */
  drop?: (id: RowId) => boolean;
  /** Field edits over MANY entries — the shape a write about the SECTION needs, where `edit` is the
   *  shape a write about ONE item needs. It answers per id with the fields to merge, or `undefined`
   *  for "this entry is not this write's business"; a field set to `undefined` is UNSET (`prune`),
   *  which is how the restore both switches its own files off and clears `hidden` off the defaults in
   *  one pass. */
  bulk?: (id: RowId) => LibraryEntry | undefined;
}

/** The next `files` list for a role, under the tier-preserving rule.
 *
 *  Read-modify-write: every surviving entry is the object that was PERSISTED, so `focal`, `key`,
 *  `hidden` and anything a later slice adds ride along untouched. A row with no entry yet joins as a
 *  bare `{name}`/`{bundled}` — which is exactly what listing it means.
 *
 *  A config entry naming something the index does not hold (a file deleted out of band) simply falls
 *  out: the collation already drops it and self-heals, so persisting it would only keep a dangling
 *  name alive. */
function writeFiles(
  entries: readonly LibraryEntry[] | undefined,
  rows: readonly LibraryRow[],
  spec: WriteSpec,
): LibraryEntry[] {
  const persisted = new Map<RowId, LibraryEntry>();
  for (const entry of entries ?? []) {
    const id = entryId(entry);
    if (id !== null && !persisted.has(id)) persisted.set(id, entry);
  }
  const known = new Set(rows.map(rowId));
  const touched = new Set(spec.touched);
  // Is the role's bundled tier fully listed once this write lands? The bare-entry guard's condition,
  // computed here because "which tier is live" is this module's own question and asking it anywhere
  // else would be a second implementation of the rule.
  const fullyListed = spec.sweep === true || fallbackTier(rows).length === 0;
  const out: LibraryEntry[] = [];
  for (const id of spec.order) {
    if (!known.has(id) || spec.drop?.(id) === true) continue;
    const held = persisted.get(id);
    // The tier rule: outside an ORDER intent, a bundled row this write did not act on stays in the
    // fallback tier, whatever position the requested order gave it. The server appends it after
    // everything listed, which is where it already was — and a write that is not about order has no
    // business moving it there. An order intent sweeps it in, because the order it states is the
    // whole section's.
    if (spec.sweep !== true && isBundledId(id) && held === undefined && !touched.has(id)) continue;
    const base: LibraryEntry =
      held ?? (isBundledId(id) ? { bundled: id.slice(2) } : { name: id.slice(2) });
    const fields = spec.bulk?.(id);
    const bulked = fields === undefined ? base : prune({ ...base, ...fields });
    const entry = spec.edit?.id === id ? prune({ ...bulked, ...spec.edit.fields }) : bulked;
    // THE BARE-ENTRY GUARD. `{bundled: id}` says exactly one thing — "this default is in the owner's
    // own tier" — and that is a claim only an ORDER write is entitled to make. Left behind by an
    // un-hide in a role whose other defaults are still unlisted, it made the un-hidden entry the sole
    // own-tier member, and `ladderRows`' own-replaces-fallback rule dealt that one picture everywhere.
    // Dropping it returns the row to the fallback tier at its registry position, which is where it was
    // before the owner ever touched the switch. A fully-listed role keeps it: there the entry is one
    // member of the section's stated order, and dropping it would move the picture.
    if (spec.bare === id && !fullyListed && isBundledId(id) && Object.keys(entry).length === 1)
      continue;
    out.push(entry);
  }
  return out;
}

/** Drop the keys an edit set to `undefined` — the spelling for "unset this field". A persisted
 *  `hidden: false` would be a redundant default in a file the owner may open, and the settings PUT
 *  serialises `undefined` away anyway, so the two must not disagree. */
function prune(entry: LibraryEntry): LibraryEntry {
  const out: LibraryEntry = {};
  for (const [k, v] of Object.entries(entry)) if (v !== undefined) out[k] = v;
  return out;
}

/** The rows as the owner sees them, as ids — the starting order for every operation. */
export function displayOrder(rows: readonly LibraryRow[]): RowId[] {
  return rows.map(rowId);
}

function reordered(order: readonly RowId[], from: number, to: number): RowId[] {
  const next = [...order];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/** Move one entry by `delta` positions (the ↑/↓ buttons — the WCAG floor, and S5's drag lands on the
 *  same transform).
 *
 *  EXACT: whatever the mix of listed, unlisted-disk and unlisted-bundled rows, the collation of what
 *  this writes IS the order asked for. That is the whole of the 2026-08-25 amendment — the previous
 *  rule could express a move only where the destination was already listed, so inside a section of
 *  bundled defaults (every theme section of a fresh install) a downward move had no expressible
 *  target and an upward one landed short. */
export function moveBy(
  entries: readonly LibraryEntry[] | undefined,
  rows: readonly LibraryRow[],
  id: RowId,
  delta: number,
): LibraryEntry[] {
  const order = displayOrder(rows);
  const from = order.indexOf(id);
  const to = from + delta;
  // A move off either end is REFUSED rather than clamped into a surprise — and refusing it writes the
  // order unchanged rather than nothing, because the ↑/↓ pair is disabled at the ends and only a race
  // reaches here. `sweep` stays off: nothing moved, so this states no new order.
  if (from < 0 || to < 0 || to >= order.length)
    return writeFiles(entries, rows, { order, touched: [] });
  return writeFiles(entries, rows, { order: reordered(order, from, to), touched: [], sweep: true });
}

/** Move one entry to the top or the bottom of the list (the detail panel's pair). The bottom is the
 *  BOTTOM now: every position is expressible, so there is no shorter honest answer to clamp to. */
export function moveToEdge(
  entries: readonly LibraryEntry[] | undefined,
  rows: readonly LibraryRow[],
  id: RowId,
  edge: "top" | "bottom",
): LibraryEntry[] {
  const order = displayOrder(rows);
  const from = order.indexOf(id);
  // The row is gone by send time: REFUSED, and a refusal states no new order — `moveBy`'s own rule.
  // Sweeping here would promote the whole fallback tier as the side effect of a gesture that moved
  // nothing, and tier membership decides what a later upload replaces.
  if (from < 0) return writeFiles(entries, rows, { order, touched: [] });
  const to = edge === "top" ? 0 : order.length - 1;
  return writeFiles(entries, rows, { order: reordered(order, from, to), touched: [], sweep: true });
}

/** The **In-use TOGGLE** (§6.5; the W6 review's fix #2). The target state is derived HERE, from the
 *  authoritative send-time rows — never from the boolean a control rendered. Two rapid taps are two
 *  queued toggles that COMPOSE (on→off→on nets on), where two captured-state writes were the same
 *  write twice and left the switch where the second tap did not mean it. A row gone by send time
 *  toggles nothing and states no change — `moveBy`'s own refusal shape.
 *
 *  `ordered` is the SECTION's fact, handed down by the caller (`hooks/useMediaLibrary.ts` passes
 *  `caps.reorder`): is order this section's priority system? Where it is, switching an entry OFF is
 *  an order intent that states the order UNCHANGED — see the header's second bullet, and §2.3 ③. This
 *  module cannot ask that question itself, for the reason it holds no registry import: a section is
 *  theme knowledge and only what is true of every namespace lives here. */
export function toggleHidden(
  entries: readonly LibraryEntry[] | undefined,
  rows: readonly LibraryRow[],
  id: RowId,
  ordered = false,
): LibraryEntry[] {
  const row = rows.find((r) => rowId(r) === id);
  if (row === undefined)
    return writeFiles(entries, rows, { order: displayOrder(rows), touched: [] });
  return setHidden(entries, rows, id, row.hidden !== true, ordered);
}

/** The **In use** write (§2.2's `hidden`), the absolute half `toggleHidden` derives its target for.
 *
 *  THE ORDER IS UNTOUCHED, in both directions and whatever `ordered` says — membership moves nothing
 *  (the owner ruling of 2026-08-26). Every disk row is written regardless, because listing ONE entry
 *  into an otherwise-empty `files` list would move it to the front of the collation and silently
 *  re-prioritise the role; and switching OFF in an order-priority section writes the bundled tier with
 *  them, which is the same stillness bought for the tier that needed it more (a listed bundled row
 *  precedes every unlisted one, so the half-listing was itself the jump).
 *
 *  Switching back ON is the minimal write it always was, plus the bare-entry guard: after a
 *  switch-off sweep the entry is already listed among the whole section and simply loses its `hidden`,
 *  and in a role that was never swept a bundled entry left saying nothing is dropped rather than
 *  promoted. */
export function setHidden(
  entries: readonly LibraryEntry[] | undefined,
  rows: readonly LibraryRow[],
  id: RowId,
  hidden: boolean,
  ordered = false,
): LibraryEntry[] {
  return writeFiles(entries, rows, {
    order: displayOrder(rows),
    touched: [id],
    sweep: hidden && ordered,
    // `hidden: false` is the DEFAULT, so switching an entry back on removes the field rather than
    // persisting a redundant `false` — the config stays the shape a human would have written.
    edit: { id, fields: hidden ? { hidden: true } : { hidden: undefined } },
    bare: hidden ? undefined : id,
  });
}

/** The **framing point** write (§5). Order untouched — framing is not priority — and the whole disk
 *  tier is written for the reason `setHidden` writes it: listing ONE entry into an otherwise-empty
 *  `files` list would move it to the front of the collation and silently re-prioritise the role.
 *
 *  `null` CLEARS it, and clearing removes the field rather than persisting a `{0.5, 0.5}` that means
 *  the same thing — R57 §5.5⑤'s finding (every product in the field treats centre as unset) applied to
 *  a config file the owner may open.
 *
 *  The `rev` is the CALLER's: it has to be read from the authoritative index row at SEND time, not
 *  from the tile the owner tapped, or a point could be keyed to a revision the file no longer has.
 *  `hooks/useMediaLibrary.ts#setFocal` is where that happens — the same recompute-at-send rule the
 *  pin's eligibility runs on. */
export function setFocal(
  entries: readonly LibraryEntry[] | undefined,
  rows: readonly LibraryRow[],
  id: RowId,
  focal: StoredFocal | null,
): LibraryEntry[] {
  return writeFiles(entries, rows, {
    order: displayOrder(rows),
    touched: [id],
    edit: { id, fields: { focal: focal ?? undefined } },
  });
}

/** The config half of a DELETE (§6.4): the entry drops, and every other disk row is written in its
 *  current order — so whatever was second becomes first in the SAME write (delete-active-promotes-
 *  next, one write, no window in which the role has no active entry). */
export function removeItem(
  entries: readonly LibraryEntry[] | undefined,
  rows: readonly LibraryRow[],
  id: RowId,
): LibraryEntry[] {
  return writeFiles(entries, rows, {
    order: displayOrder(rows),
    touched: [],
    drop: (x) => x === id,
  });
}

// ── restore defaults (the S6 owner ruling) ───────────────────────────────────────────────────────

/** Whether this section has anything to restore — i.e. whether what it shows differs from what it
 *  shipped. Three states qualify under the 2026-08-26 ruling (see `restoreDefaults`), and they are the
 *  three ways the section can be showing something other than its defaults:
 *
 *   · a bundled entry is LISTED (an order write swept the section, §2.3 ③ as amended) — the defaults
 *     are in the owner's own tier at the order they gave them;
 *   · any entry is HIDDEN — switched out of the deal;
 *   · the library holds a file of the OWNER's own — the restore would switch it off (and if it is
 *     already off, the arm above has it), so there is a difference to put back.
 *
 *  Decidable from the INDEX alone, like every other question the gallery asks (§2.3 ④). It is a
 *  DIFFERENCE test, not an equality one: comparing the exact order would make the affordance vanish on
 *  a section restored a moment ago and re-arranged into the same order, and a spurious control that
 *  writes what is already there costs nothing. */
export function defaultsRestorable(rows: readonly LibraryRow[]): boolean {
  // A file of the owner's own qualifies whichever way it stands, which is why the third arm needs no
  // visibility test: in use, the restore switches it off; already off, it is the `hidden` arm.
  return rows.some((r) => r.bundled == null || r.listed === true || r.hidden === true);
}

/** **Restore defaults** — put the section back on its shipped art, in the owner's own words (ruling of
 *  2026-08-26): *"put them first and activate them and you deactivate the other ones — as if the
 *  defaults are the one selected, and I just uploaded the other images that are there."*
 *
 *  So it is an ORDER INTENT, and the order it states is the whole point: the section's own bundled
 *  entries go to the TOP in the REGISTRY's shipped order, listed and in use — which under the one
 *  priority system (order, "W6") is what "these are the selection" means in every mode at once: a
 *  first-wins section paints the first default, a dealt one deals the default set, an `all` one shows
 *  the default slides. The owner's own files keep their relative order BELOW them and are switched
 *  OFF — they stay in the library exactly as if they had just been uploaded into a section already
 *  showing its defaults, with their framing, their `key` and everything else untouched. Nothing is
 *  deleted; deleting uploads is what Delete is for.
 *
 *  It used to DROP the bundled entries out of `files` instead, letting the fallback tier answer — which
 *  put the defaults back in the registry's order only for as long as the owner had no files of their
 *  own, because the owner's tier outranks the fallback one whole. That mechanism could not express the
 *  ruling at all: with one upload present the restore left the upload painting.
 *
 *  `shipped` is the registry's own id order (`MediaRoleDef.bundled`), handed down by the caller for the
 *  reason `toggleHidden`'s `ordered` flag is: this module holds only what is true of every namespace,
 *  and which ids a role ships — and in what order — is registry knowledge.
 *
 *  `within` scopes it to the ids the affordance was shown for — a KEY gallery restores its own layer,
 *  not the whole role — and the entries outside it keep their fields and their relative order. Absent =
 *  the whole section, which is what a pool's own gallery means.
 *
 *  **A SCOPED restore does not SWEEP** (both confirm lenses, independently, on the same prescription).
 *  The sweep is what makes an order intent's stated order the whole SECTION's, and a scoped restore
 *  states no such thing: it speaks for one key's layer. Sweeping anyway listed every OTHER key's
 *  bundled row into the owner's own tier as a side effect — a tier change is what decides what a later
 *  upload replaces, so restoring `cube` quietly re-tiered `platform-mid` and `platform-base`. Listing
 *  the covered defaults is `touched`'s job instead, which is exactly what it is for: the ids this write
 *  explicitly acted on. Out-of-scope bundled rows that were ALREADY listed survive untouched — they
 *  are held entries, and `writeFiles` only skips the ones with nothing persisted. The unscoped restore
 *  still sweeps, because there the stated order genuinely is the whole section's. */
export function restoreDefaults(
  entries: readonly LibraryEntry[] | undefined,
  rows: readonly LibraryRow[],
  shipped: readonly RowId[],
  within?: ReadonlySet<RowId>,
): LibraryEntry[] {
  const covers = (id: RowId) => within === undefined || within.has(id);
  const order = displayOrder(rows);
  const present = new Set(order);
  // The defaults this restore is about, in the REGISTRY's order — an id the library no longer holds
  // simply falls out, exactly as it does in every other transform here.
  const first = shipped.filter((id) => present.has(id) && covers(id));
  const lifted = new Set(first);
  return writeFiles(entries, rows, {
    order: [...first, ...order.filter((id) => !lifted.has(id))],
    touched: first,
    sweep: within === undefined,
    bulk: (id) =>
      !covers(id) ? undefined : isBundledId(id) ? { hidden: undefined } : { hidden: true },
  });
}

/** Append a freshly uploaded file at the END of the list, keeping every other row's priority (S3b's
 *  register phase; here because the tier rule is here). `fields` carries what the upload knows —
 *  its binding `key`, its seeded `focal`. */
export function appendItem(
  entries: readonly LibraryEntry[] | undefined,
  rows: readonly LibraryRow[],
  filename: string,
  fields: LibraryEntry = {},
): LibraryEntry[] {
  const id = `f:${filename}`;
  const listed = writeFiles(entries, rows, { order: displayOrder(rows), touched: [id] });
  const at = listed.findIndex((e) => entryId(e) === id);
  // Present already = the index has caught up with the upload (or the retry ran twice): patch the
  // entry where it stands rather than listing the same file twice.
  if (at >= 0) return listed.map((e, i) => (i === at ? prune({ ...e, ...fields }) : e));
  return [...listed, prune({ name: filename, ...fields })];
}

// ── what a row LOOKS like: the three view rules the card, the grid and the detail panel share ────

/** The wire facts a picture is made of — `MediaFile`, structurally (this module stays wire-free for
 *  the reason `lib/media.ts` does). */
export interface ArtRow extends LibraryRow, FocalRow {
  url: string;
  format?: string | null;
  size_bytes: number;
  unusable_reason?: string | null;
}

/** One bundled entry's id and the client asset it stands for (`MediaBundledDef`, structurally). */
export interface BundledArt {
  id: string;
  url: string;
}

/** The advisory ceilings of one role (`MediaBounds`, structurally). */
export interface SizeBounds {
  bytes: number;
  pixels: number;
}

/** The picture one row paints, in the gallery.
 *
 *  Two sources, and the split is the wire's (§2.3): a file on disk is served from the mount, with its
 *  `?rev=` so a replaced-in-place file cannot show its old bytes (defect #1, the same spelling every
 *  paint site uses); a BUNDLED row carries only an id, and the client maps it to its own hashed asset
 *  through the registry's `{id, url}` pairs — the server has never seen those bytes. */
export function tileUrl(
  row: ArtRow,
  section: { def: { bundled: readonly BundledArt[] } },
): string | undefined {
  if (row.bundled != null) return section.def.bundled.find((b) => b.id === row.bundled)?.url;
  return row.url === "" ? undefined : revUrl(row.url, row.revision);
}

/** Advisory code → what the owner should read. Two come from the server's `unusable_reason` (only it
 *  read the bytes); the other two are derived from the file's numbers against the role's bounds,
 *  because "too big" is per-role policy and the server ships facts (MEDIA_PLAN §5). An unrecognised
 *  server reason is shown verbatim rather than swallowed, so a new one is never invisible. */
export const ADVISORIES: Record<string, { text: string; bad?: boolean }> = {
  // Defect #7: the server's `unreadable` covers truncated/corrupt bytes AND a readable format this
  // surface does not serve (a GIF, a HEIC the phone produced). "unreadable file" sent the owner
  // hunting for a corruption that was never there; the truthful sentence names both causes.
  unreadable: { text: "unreadable or unsupported format", bad: true },
  "format-mismatch": { text: "wrong extension", bad: true },
  // The two ADVISORIES state their CONSEQUENCE (owner ruling 2026-08-26): "large file" is a
  // measurement the owner already has — the meta line above says how large — and says nothing about
  // why it is on screen. The picture still paints; what it costs is time.
  oversize: { text: "large file — slower to load" },
  dimensions: { text: "very large image — slower to load" },
};

/** The advisory codes for one file, in severity order: what makes it unusable first, then the size
 *  advisories. A role the registry does not describe still shows the server's verdict. */
export function advisoriesOf(f: ArtRow, bounds: SizeBounds | undefined): string[] {
  const out: string[] = [];
  if (f.unusable_reason != null) out.push(f.unusable_reason);
  if (bounds != null && f.bundled == null) {
    if (f.size_bytes > bounds.bytes) out.push("oversize");
    if (f.width != null && f.height != null && f.width * f.height > bounds.pixels)
      out.push("dimensions");
  }
  return out;
}

/** `640×854 · 88 KB` — the two numbers the size hints are about, and nothing else. */
export function metaText(f: ArtRow): string {
  const size =
    f.size_bytes >= 1_000_000
      ? `${(f.size_bytes / 1e6).toFixed(1)} MB`
      : `${Math.round(f.size_bytes / 1000)} KB`;
  return f.width && f.height ? `${f.width}×${f.height} · ${size}` : size;
}
