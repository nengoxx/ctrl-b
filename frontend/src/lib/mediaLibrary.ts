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
//   · an ORDER intent — `moveBy`, `moveToEdge`, `setActive`, and therefore the drag — SWEEPS THE WHOLE
//     SECTION into `files` in the resulting display order, unlisted disk rows and unlisted bundled rows
//     alike. The section's order becomes explicit, which is the only shape that can say it: a partial
//     listing cannot express a mid-list position at all (a downward drag inside an all-bundled section
//     had no expressible target and snapped home), and listing only the two rows of a swap SHRANK the
//     deal — `ladderRows`' own-tier-replaces-fallback rule then dealt those two portraits across the
//     whole fleet. A full sweep is THE SAME ART IN THE NEW ORDER: zero paint surprise, and the fleet
//     the owner was looking at is the fleet they keep.
//   · every OTHER intent — `setHidden`, `setFocal`, `makeEligible`, `appendItem`, `removeItem` — still
//     lists only the entry it acted on (plus the disk tier, which is free: those rows already sit in
//     the resolution prefix, so listing them changes nothing but their order). None of them is a claim
//     about the section's ORDER, so none of them may make one.
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

/** A row carrying enough to answer "is its framing still about THIS picture" — the wire's `focal` and
 *  the `revision` it is keyed to. */
export interface FocalRow {
  focal?: StoredFocal | null;
  revision?: string;
  width?: number | null;
  height?: number | null;
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

/** A row's IDENTITY as one comparable string — `f:<filename>` for a file on disk, `b:<id>` for a
 *  bundled entry. The two spaces are kept apart on purpose (the config identity is a discriminated
 *  union, §2.2): a role may hold a file called `lyra.webp` AND the bundled id `lyra`, and they are two
 *  different library entries with two different priorities. Doubles as the React key. */
export type RowId = string;

export function rowId(row: LibraryRow): RowId {
  return row.bundled != null ? `b:${row.bundled}` : `f:${row.file}`;
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
 *     "framing was reset — the file changed" rather than silently cropping to a stranger's shoulder. */
export type FocalState = "unset" | "set" | "stale";

export function focalState(row: FocalRow): FocalState {
  const focal = row.focal;
  if (focal == null || !Number.isFinite(focal.x) || !Number.isFinite(focal.y)) return "unset";
  // An empty `rev` matches no revision, which is what makes the field safely additive: a point
  // written by anything that did not know about the keying degrades rather than lying.
  return focal.rev !== "" && focal.rev === (row.revision ?? "") ? "set" : "stale";
}

/** The row's LIVE point, or `undefined` for unset AND for stale — the one place that fold happens. */
export function rowFocal(row: FocalRow): FocalPoint | undefined {
  const focal = row.focal;
  return focal != null && focalState(row) === "set" ? { x: focal.x, y: focal.y } : undefined;
}

/** The row as a paint-site input (§5's council H3): an owner file with a live point is CENTRED, and
 *  carries the source pixels the centred mapping needs. Everything else has no framing of its own and
 *  leaves the surface on its own default crop. Bundled rows never come through here — their
 *  proportional strings live in the theme's own ladder module. */
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
}

/** A section's `active` resolver: PURE in the index rows + the wire's `slots`, never in config
 *  (§2.4 — the wire carries `listed`/`hidden`/`key` precisely so this is sufficient). */
export type ActiveResolver = (
  rows: readonly LibraryRow[],
  slots: Readonly<Record<string, string>>,
) => ActiveArt;

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
  /** Per-entry field edits (the In-use switch writes `hidden` here). */
  edit?: { id: RowId; fields: LibraryEntry };
  /** An id to drop from the list entirely (a delete's config half). */
  drop?: RowId;
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
  const out: LibraryEntry[] = [];
  for (const id of spec.order) {
    if (!known.has(id) || id === spec.drop) continue;
    const held = persisted.get(id);
    // The tier rule: outside an ORDER intent, a bundled row this write did not act on stays in the
    // fallback tier, whatever position the requested order gave it. The server appends it after
    // everything listed, which is where it already was — and a write that is not about order has no
    // business moving it there. An order intent sweeps it in, because the order it states is the
    // whole section's.
    if (spec.sweep !== true && isBundledId(id) && held === undefined && !touched.has(id)) continue;
    const base: LibraryEntry =
      held ?? (isBundledId(id) ? { bundled: id.slice(2) } : { name: id.slice(2) });
    out.push(spec.edit?.id === id ? prune({ ...base, ...spec.edit.fields }) : base);
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

/** **Set as active** = move-to-front (§6.5). The list order IS the priority, so the explicit intent
 *  the owner expresses in the detail panel is stored as the thing every ladder already reads.
 *
 *  ACTIVATION GUARANTEES ELIGIBILITY, in the same write (Emma's S2 review #1). Moving a `hidden`
 *  entry to the front changes nothing an owner can see: resolution skips hidden rows everywhere, so
 *  the tile would sit first and stay excluded while the card kept painting someone else. "Set as
 *  active" therefore switches it back on too — one gesture, one write, one outcome the owner asked
 *  for.
 *
 *  It is an ORDER intent, so it SWEEPS: picking one of five bundled defaults writes all five, that one
 *  first. Listing only the pick would have made it the owner's entire tier and retired the other four
 *  — the deal-shrinking half of the 2026-08-25 amendment, in its most literal form. */
export function setActive(
  entries: readonly LibraryEntry[] | undefined,
  rows: readonly LibraryRow[],
  id: RowId,
): LibraryEntry[] {
  const order = displayOrder(rows);
  const from = order.indexOf(id);
  if (from < 0) return writeFiles(entries, rows, { order, touched: [], sweep: true });
  return writeFiles(entries, rows, {
    order: reordered(order, from, 0),
    touched: [id],
    sweep: true,
    edit: { id, fields: { hidden: undefined } },
  });
}

/** Make ONE entry eligible WHERE IT STANDS — the `files` half of a PIN write (Emma's S2 review #1 ②).
 *
 *  A pin resolves against the list its own ladder deals, so pinning an entry that ladder does not
 *  offer writes a value nothing can honour: the card would claim the pick while the render kept
 *  painting the previous winner, and the detail panel would offer to "clear a pin" for an entry that
 *  was never active. Two states need repairing, and both are repaired here rather than by a second
 *  queued write, so the pin and its eligibility land in one patch or not at all:
 *
 *   · a `hidden` entry — resolution skips it, so it is switched back on;
 *   · a FALLBACK-TIER bundled entry — the ladder falls through to that tier only while the owner's
 *     own tier is empty, so the entry is LISTED. That is the tier rule's own escape (§2.3 ③): only
 *     the entry the owner explicitly ACTED ON becomes listed, and a pin is as explicit as it gets.
 *
 *  The ORDER is untouched: the pin is what this gesture means, not the priority. */
export function makeEligible(
  entries: readonly LibraryEntry[] | undefined,
  rows: readonly LibraryRow[],
  id: RowId,
): LibraryEntry[] {
  return writeFiles(entries, rows, {
    order: displayOrder(rows),
    touched: [id],
    edit: { id, fields: { hidden: undefined } },
  });
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
  if (from < 0) return writeFiles(entries, rows, { order, touched: [], sweep: true });
  const to = edge === "top" ? 0 : order.length - 1;
  return writeFiles(entries, rows, { order: reordered(order, from, to), touched: [], sweep: true });
}

/** The **In use** switch (§2.2's `hidden`). The order is untouched — but every disk row is still
 *  written, because listing ONE entry into an otherwise-empty `files` list would move it to the front
 *  of the collation and silently re-prioritise the role. */
export function setHidden(
  entries: readonly LibraryEntry[] | undefined,
  rows: readonly LibraryRow[],
  id: RowId,
  hidden: boolean,
): LibraryEntry[] {
  return writeFiles(entries, rows, {
    order: displayOrder(rows),
    touched: [id],
    // `hidden: false` is the DEFAULT, so switching an entry back on removes the field rather than
    // persisting a redundant `false` — the config stays the shape a human would have written.
    edit: { id, fields: hidden ? { hidden: true } : { hidden: undefined } },
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
  return writeFiles(entries, rows, { order: displayOrder(rows), touched: [], drop: id });
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
  oversize: { text: "large file" },
  dimensions: { text: "very large image" },
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
