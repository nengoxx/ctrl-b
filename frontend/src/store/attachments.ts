// STAGED COMPOSER ATTACHMENTS (D68 / ATTACHMENTS_PLAN §7) — what the owner has attached to the
// message they have not sent yet.
//
// A module store beside the draft (`store/composer.ts`), on the same dep-free `createStore` binding
// (D23), and for the same two reasons: the composer is conditionally rendered (switching to
// Conf/Utils unmounts it), and the SEND path — `lib/composer#runComposer` → `store/chat#sendMessage`
// — has to read the staged ids from outside React entirely.
//
// **IT IS PERSISTED, exactly like the draft beside it (the S6 fix wave, owner finding F3 — this
// OVERRULES the original "deliberately NOT persisted" ruling).** That ruling weighed a staged file's
// server-side lifetime (`staging_orphan_hours`, 24h) and the object URL that dies with the page, and
// concluded a restored chip might be showing a thumbnail for bytes nobody can claim. The owner's phone
// round settled the frequency question the other way: **Android Chrome discards a backgrounded tab**,
// and switching to the camera app is the ORDINARY way to attach a photo — so losing the rail is the
// common case and a stale id is the rare one. A stale id is also cheap: it refuses at send with the
// server's own 409 sentence, which the chat path already surfaces verbatim, and the chips are released
// (§3's refuse-on-consumed contract, no validation round-trip needed). The dead object URL is answered
// by `thumb` below — a small data URL the export worker produced, which is what a restored chip wears.
//
// ONE RAIL PER CONVERSATION (Phase 27 S8, D84 §6 R31/R34): the rails are keyed by THREAD ID — `""` is
// the thread-less view — beside the drafts (`store/composer`), and the current SLOT is the view's
// conversation (`setRailSlot`, mirrored from `store/composer#setComposerSlot`, which the three identity
// writers in `store/chat` call). The public functions keep their signatures: the composer's VIEW of the
// rail and the reads that BUILD a send are the current slot's; every ID-ADDRESSED mutation finds its row
// across ALL rails (§12.3 H4), so a hop mid-send or mid-upload never strands a chip.
//
// STATE ONLY. The pipeline that fills it (admit → downscale → PUT) is `lib/attachments.ts`, and the
// React surface is `hooks/useAttachments.ts` — same split as draft ↔ composer routing.

import { createStore } from "./createStore";
import { isRecord, loadPersisted, patchPersisted } from "./persist";
import type { PendingAttachment } from "../types";

/** What the BYTES turned out to be, in the server's own vocabulary (`AttachmentKind`). Pre-upload it
 *  is the client's guess from the extension tier; once staged it is the server's sniff. */
export type AttachKind = "image" | "text" | "pdf";

/** Where one chip is in its life — THE LADDER, in one place (the S3 fix wave's interplay note):
 *
 *      uploading → staged → sending → (consumed | back to staged)
 *
 *  with `failed` terminal but removable. In words:
 *
 *   · `uploading` — admitted and on its way. Covers the ADMISSION window too (MED-3: the chip exists
 *     from the gesture, not from the first `await`), and it is the ONE status that HOLDS a send
 *     (`isUploading`, the gate `lib/composer` enforces for every send path).
 *   · `staged`    — the server minted an id and this row is READY. The only status that counts as
 *     sendable (`stagedIds`/`hasStaged`, MED-5), so a rail holding nothing else never arms a send.
 *   · `sending`   — a send has RESERVED this row and its POST is in flight (MED-1). Spoken for: it
 *     contributes no id to the NEXT send, it is not removable, and it is either consumed on the
 *     accept or released back to `staged` on a refusal.
 *   · `failed`    — carries the named sentence saying why. Blocks nothing, arms nothing, removable. */
export type AttachStatus = "uploading" | "staged" | "sending" | "failed";

export interface StagedAttachment {
  /** This client's own handle — the chip's React key and the address every update goes to. The
   *  server's `attachment_id` cannot serve: it does not exist until the PUT answers, and a failed
   *  upload never gets one. */
  localId: string;
  /** What the chip shows — the name the file will be stored under (already sanitised for the
   *  server's admission tier, and carrying the EXPORT's extension for a re-encoded image). */
  name: string;
  kind: AttachKind;
  status: AttachStatus;
  /** The claim credential, once the mint answers (§3). Only a `staged` row has one. */
  attachmentId?: string;
  /** An object URL of the picked file, for an image chip's thumbnail. Revoked when the chip goes.
   *  LIFETIME UNCHANGED by the S6 wave: this is still the live preview with its existing ownership
   *  transfer (`consumeStaged`), and `thumb` is a SEPARATE field rather than a replacement — the
   *  moment the two were folded together, the bubble's object-URL hand-off would have to be re-ruled. */
  previewUrl?: string;
  /** THE PERSISTED FACE (S6/F3) — a small JPEG data URL of an image row, produced by the export
   *  worker's optional thumbnail arm. Unlike `previewUrl` it survives the page, which is what makes a
   *  restored chip a picture instead of a glyph. Absent for text/PDF rows, for a picture the platform
   *  could not thumbnail, and for one whose data URL came back over the persist budget (MED-6). */
  thumb?: string;
  /** The NAMED refusal a `failed` chip renders (R62 §3.2's three-toasts lesson: say which rule). */
  error?: string;
  bytes?: number;
}

// ── the persisted projection (S6/F3; per conversation since Phase 27 S8) ─────────────────────────

const KEY = "ctrlb.attachments";

/** One persisted row — the FIVE facts a chip can be rebuilt from. Everything else is either live
 *  (`previewUrl`, `localId`) or meaningless after a reload (`status`, `error`). */
interface PersistedRow {
  attachmentId: string;
  name: string;
  kind: AttachKind;
  bytes?: number;
  thumb?: string;
}

/** THE SHAPE (Phase 27 S8, R31): `{rails: {<thread id | "">: PersistedRow[]}}` — an OBJECT wrapping a
 *  map of lists, never a bare list (`loadPersisted`'s defaults-over-merge refuses a top-level array
 *  outright — it would spread to junk numeric keys). The legacy single rail `{files}` folds under `""`
 *  at the load boundary (`foldRails`) and is deleted by the next write; it is never written back.
 *
 *  WHAT IS WORTH KEEPING — `staged` rows and only those.
 *
 *   · `uploading`/`failed` are not restorable: one has no id yet, the other never will have.
 *   · **`sending` rows are DELIBERATELY DROPPED (reviewer MED-1).** A row is `sending` while a POST
 *     naming its id is in flight; restoring one whose POST actually got its 202 would DOUBLE-SEND the
 *     file — the steer drain claims one copy of the ids server-side while the restored copy's text
 *     persists here without them. A reservation is a promise made to a request that is no longer in
 *     this page's memory, so the honest answer after a discard is to forget it. `reserveStaged`
 *     therefore drops those rows from the projection for free, and `releaseStaged` writes them back. */
/** …and of what IS kept, how much may be PICTURES. The row facts are a couple hundred characters
 *  each; the thumbnails are the only thing in the blob that GROWS, and `max_files_per_message` is a
 *  config knob with no ceiling (confirm-round MED-6: a count-based bound is no bound at all — 80
 *  files at the 64KB per-thumb ceiling reach the ~5MB origin quota, and `savePersisted` swallows the
 *  quota error BY DESIGN, taking the whole rail down silently). So the projection carries its own
 *  budget: thumbnails are included IN ORDER until this many characters are spent, and every row
 *  past that persists WITHOUT its picture — restorable, wearing the kind's glyph. 1M characters is
 *  ~2MB of the quota in UTF-16 terms, headroom for every other `ctrlb.*` key at any configuration.
 *
 *  THE BUDGET IS GLOBAL ACROSS RAILS (Phase 27 §12.3 M5): it was sized for ONE rail, and one budget per
 *  conversation would let three full rails pass the quota and push every later write into silent
 *  failure. It is spent over the whole blob — the CURRENT slot's rail first, then the other rails in
 *  last-used order (`budgeted`, over the blob being saved). */
const THUMB_BUDGET_CHARS = 1024 * 1024;

/** One rail's persisted rows — the `staged` ones, as their five facts (the budget trims `thumb`
 *  later, over the whole blob). */
function projectRail(rows: readonly StagedAttachment[]): PersistedRow[] {
  return rows.flatMap((file) =>
    file.status !== "staged" || file.attachmentId === undefined
      ? []
      : [
          {
            attachmentId: file.attachmentId,
            name: file.name,
            kind: file.kind,
            ...(file.bytes === undefined ? {} : { bytes: file.bytes }),
            ...(file.thumb === undefined ? {} : { thumb: file.thumb }),
          },
        ],
  );
}

/** THE ONE BUDGET, over the blob about to be SAVED (M5; the S8 fix wave's S8-02 — never over this
 *  tab's memory alone, which another tab's rails are not in): thumbnails are kept in order — the
 *  current slot's rail first, then the slots most recently current (`mru`), then every other stored
 *  rail — until the budget is spent, and every row past that loses ONLY its `thumb` (never the row).
 *  The first thumbnail that would overflow CLOSES the window — a later, smaller one is not admitted
 *  either (micro-confirm, MED-6 round 3): a rail whose later chip is pictured while an earlier one is
 *  not reads as a bug, and the PREFIX is what the owner can predict. Entries keep their position. */
function budgeted(blob: Record<string, unknown>): Record<string, unknown> {
  const out = { ...blob };
  let spent = 0;
  let open = true;
  const order = [slot, ...mru, ...Object.keys(blob)].filter((k, at, all) => all.indexOf(k) === at);
  for (const k of order) {
    const list = blob[k];
    if (!Array.isArray(list)) continue;
    out[k] = list.map((row: unknown) => {
      if (!isRecord(row) || typeof row.thumb !== "string") return row;
      if (open && spent + row.thumb.length <= THUMB_BUDGET_CHARS) {
        spent += row.thumb.length;
        return row;
      }
      open = false;
      const { thumb: _dropped, ...rest } = row;
      return rest;
    });
  }
  return out;
}

/** A restored row's local id — unique across EVERY rail of the page (the pipeline's ids are
 *  `att-<time>-<seq>`, and these are never in that sequence). */
let restoredSeq = 0;

/** Rebuild one row, or drop it (reviewer LOW-7). Nothing is CAST: a blob written by an older build, a
 *  half-truncated quota write, or a hand-edited localStorage entry must produce chips that are missing
 *  rather than chips that are wrong — a row with a non-string `attachmentId` would reach the send path
 *  and post junk. Its `localId` is minted here with its own prefix: the pipeline's ids are
 *  `att-<time>-<seq>` and these are never in that sequence. */
function restoreRow(raw: unknown): StagedAttachment[] {
  if (raw === null || typeof raw !== "object") return [];
  const row = raw as Partial<PersistedRow>;
  const { attachmentId, name, kind, bytes, thumb } = row;
  if (typeof attachmentId !== "string" || attachmentId === "") return [];
  if (typeof name !== "string" || name === "") return [];
  if (kind !== "image" && kind !== "text" && kind !== "pdf") return [];
  return [
    {
      localId: `att-restored-${restoredSeq++}`,
      name,
      kind,
      status: "staged",
      attachmentId,
      // A field that is not what it claims to be is DROPPED, not repaired — the row survives without it.
      ...(typeof bytes === "number" && Number.isFinite(bytes) ? { bytes } : {}),
      ...(typeof thumb === "string" && thumb !== "" ? { thumb } : {}),
    },
  ];
}

/** THE LOAD-BOUNDARY FOLD (Phase 27 S8): the stored `rails` map, with the legacy single rail `{files}`
 *  under `""` (unless `""` already has one). Applied to the blob at load AND to the fresh blob inside
 *  every write, so a write that lands before the legacy rail was ever re-written carries it instead of
 *  deleting it with the old key. Entries are kept as stored here — `restoreRow` judges them at load. */
function foldRails(blob: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = isRecord(blob.rails) ? { ...blob.rails } : {};
  if (Array.isArray(blob.files) && blob.files.length && !("" in out)) out[""] = blob.files;
  return out;
}

/** The rails as they were when the tab went away. Runs at module init — before any mutation can reach
 *  the store, so there is no window in which a write could be lost or a restored row could clobber a
 *  live one (the pipeline cannot run before the module that holds it exists). */
function restore(): Record<string, StagedAttachment[]> {
  const out: Record<string, StagedAttachment[]> = {};
  for (const [k, list] of Object.entries(
    foldRails(loadPersisted<Record<string, unknown>>(KEY, {})),
  )) {
    if (!Array.isArray(list)) continue;
    const rows = list.flatMap(restoreRow);
    if (rows.length) out[k] = rows;
  }
  return out;
}

const { emit, useStore } = createStore();
/** Every conversation's rail, by thread id (`""` = the thread-less view). A rail that empties is
 *  deleted, so a key here always holds at least one row. */
let rails: Record<string, StagedAttachment[]> = restore();
/** The view's conversation — not persisted; set only through `setRailSlot`. */
let slot = "";
/** Slots most recently current first (in memory only) — the budget's order after the current one. */
let mru: string[] = [];
const NO_ROWS: readonly StagedAttachment[] = Object.freeze([]);

/** WRITE-THROUGH + NOTIFY, as one call — the single exit from every mutation in this file, which is
 *  what makes "every mutating export persists" a structural property rather than a rule to remember:
 *  there is no `emit()` left to reach without writing. `touched` = the rails THIS mutation changed.
 *  The patch is computed over the FRESH stored blob (S8 fix wave — Sol S8-01/S8-02, Opus F3): the
 *  touched rails are written from memory (an emptied one deletes its key); every other stored rail is
 *  kept AS STORED — another tab's newer rows are never replaced by this tab's snapshot (§12.3 M4) —
 *  and then the one budget trims thumbnails across the union (`budgeted`). */
function commit(touched: readonly string[]): void {
  if (touched.length)
    patchPersisted(KEY, (stored) => {
      const merged = foldRails(stored);
      for (const k of touched) {
        const rows = projectRail(rails[k] ?? NO_ROWS);
        if (rows.length) merged[k] = rows;
        else delete merged[k];
      }
      return { files: undefined, rails: budgeted(merged) }; // the legacy key goes with the first write
    });
  emit();
}

/** Replace one conversation's rail (an empty list deletes its key) — no write; the caller commits. */
function putRail(k: string, rows: StagedAttachment[]): void {
  const next = { ...rails };
  if (rows.length) next[k] = rows;
  else delete next[k];
  rails = next;
}

/** Map EVERY row of EVERY rail (the id-addressed mutations, H4). A rail none of whose rows changed keeps
 *  its array (the composer's snapshot stays stable); returns the rails that changed. */
function mapRows(fn: (f: StagedAttachment) => StagedAttachment): string[] {
  const changed: string[] = [];
  const next: Record<string, StagedAttachment[]> = {};
  for (const [k, rows] of Object.entries(rails)) {
    const mapped = rows.map(fn);
    if (mapped.some((f, at) => f !== rows[at])) {
      changed.push(k);
      next[k] = mapped;
    } else next[k] = rows;
  }
  if (changed.length) rails = next;
  return changed;
}

/** Drop the rows `gone` matches from EVERY rail (an emptied rail loses its key); returns them and the
 *  rails they left. */
function dropRows(gone: (f: StagedAttachment) => boolean): {
  rows: StagedAttachment[];
  keys: string[];
} {
  const dropped: StagedAttachment[] = [];
  const keys: string[] = [];
  for (const [k, rows] of Object.entries(rails)) {
    if (!rows.some(gone)) continue;
    dropped.push(...rows.filter(gone));
    keys.push(k);
    putRail(
      k,
      rows.filter((f) => !gone(f)),
    );
  }
  return { rows: dropped, keys };
}

/** THE SLOT (Phase 27 S8, H2) — the view's conversation (`""` thread-less). Called ONLY by
 *  `store/composer#setComposerSlot`, the one setter `store/chat`'s three identity writers call, so the
 *  draft and the rail can never point at two different conversations. Not persisted. */
export function setRailSlot(next: string): void {
  slot = next;
  mru = [next, ...mru.filter((k) => k !== next)];
  emit();
}

/** Is `k`'s rail empty — in memory (any status: an uploading chip is content) AND in fresh storage
 *  (another tab's rail, Qwen F1)? The `""` move's test. */
export function railEmpty(k: string): boolean {
  const stored = foldRails(loadPersisted<Record<string, unknown>>(KEY, {}))[k];
  return !(rails[k]?.length ?? 0) && !(Array.isArray(stored) && stored.length);
}

/** E6 / the `""` move (Phase 27 S8): append `from`'s rail to `to`'s — the chips keep their ids and their
 *  status (an `uploading` row moves too; its `updateStaged` by `localId` still finds it, H4) — and delete
 *  `from`'s key. Called through `store/composer#moveSlots`, which carries the draft with it. */
export function moveRail(from: string, to: string): void {
  const carried = rails[from];
  if (from === to || !carried?.length) return;
  putRail(to, [...(rails[to] ?? []), ...carried]);
  putRail(from, []);
  commit([from, to]);
}

/** THE BOOT PRUNE's rail half (§12.2 ⑦): every rail whose key `keep` refuses goes — from memory (its
 *  previews revoked, as every other exit that drops a row which nothing else holds) and from storage,
 *  including a key only storage knows (a conversation deleted elsewhere this page never visited).
 *  Called through `store/composer#pruneSlots`. */
export function pruneRails(keep: (slot: string) => boolean): void {
  const dead = Object.keys(rails).filter((k) => !keep(k));
  const storedDead = Object.keys(foldRails(loadPersisted<Record<string, unknown>>(KEY, {}))).filter(
    (k) => !keep(k),
  );
  if (!dead.length && !storedDead.length) return;
  for (const k of dead) {
    for (const f of rails[k]) revoke(f);
    putRail(k, []);
  }
  patchPersisted(KEY, (stored) => {
    const kept = foldRails(stored);
    for (const k of Object.keys(kept)) if (!keep(k)) delete kept[k];
    return { files: undefined, rails: kept };
  });
  emit();
}

/** The snapshot, for the non-React readers (the send path, the admission cap) — the CURRENT slot's. */
export function stagedFiles(): readonly StagedAttachment[] {
  return rails[slot] ?? NO_ROWS;
}

/** Subscribe to the staged set — the rail, the clip's counter, the send gate. */
export function useStagedFiles(): readonly StagedAttachment[] {
  return useStore(stagedFiles);
}

/** The claim credentials of everything that actually landed, in chip order (§3: the chat POST names
 *  ids and nothing else). `uploading`/`failed` rows contribute nothing — a send never waits for one
 *  and never pretends one is there. The CURRENT slot's: a send carries its own conversation's files. */
export function stagedIds(): string[] {
  return stagedFiles().flatMap((f) =>
    f.status === "staged" && f.attachmentId ? [f.attachmentId] : [],
  );
}

/** Is there anything READY to send besides text? The other half of the attachment-only send gate
 *  (§7) — and READY is the whole point (MED-5): a rail holding only a failed chip must not arm a send
 *  that would carry nothing, and a row already reserved by a send in flight is not the next send's to
 *  offer. One predicate, so `stagedIds()` and this can never disagree about what is sendable. */
export function hasStaged(): boolean {
  return stagedFiles().some((f) => f.status === "staged");
}

/** RESERVE every ready row for ONE send (MED-1) — the snapshot and the flip happen together and
 *  SYNCHRONOUSLY, which is what closes the accept window: a second Enter (or a dictation auto-send)
 *  landing while the first POST is in flight finds those rows `sending`, so it can neither re-name
 *  their ids nor be armed by them. `store/chat#sendMessage` owns the other end of the reservation:
 *  it consumes them on the accept and calls `releaseStaged` on anything the server did not take.
 *  The snapshot is the current slot's; the flip is by id (H4 — the ids are unique across rails). */
export function reserveStaged(): string[] {
  const ids = stagedIds();
  if (ids.length === 0) return ids;
  const spoken = new Set(ids);
  commit(
    mapRows((f) =>
      f.status === "staged" && f.attachmentId !== undefined && spoken.has(f.attachmentId)
        ? { ...f, status: "sending" as const }
        : f,
    ),
  );
  return ids;
}

/** Hand a reservation back — a send that was refused (409), failed, or never reached the server. The
 *  chips become the owner's again, exactly as they were, rather than being stranded spoken-for —
 *  in whichever rail they are now (a hop since the send, H4). */
export function releaseStaged(ids: readonly string[]): void {
  if (ids.length === 0) return;
  const held = new Set(ids);
  const changed = mapRows((f) =>
    f.status !== "sending" || f.attachmentId === undefined || !held.has(f.attachmentId)
      ? f
      : { ...f, status: "staged" as const },
  );
  if (changed.length) commit(changed);
}

/** The PRESENTATIONAL snapshot of the rows one send reserved (MED-6): what the optimistic bubble
 *  shows while the durable message is being built. Facts the CHIP already has — no id, no bytes, no
 *  path — because this is a picture of the composer, not a claim about the store. By id, across every
 *  rail (H4).
 *
 *  `previewUrl ?? thumb` (S6/F3): a RESTORED row has no object URL — it was minted by a page that no
 *  longer exists — so its persisted thumbnail is the picture the bubble shows for the round trip until
 *  the durable part lands. Resolved HERE rather than in the bubble so `PendingAttachment` keeps one
 *  field and `components/ChatThread` needs no second fallback. */
export function stagedPreviews(ids: readonly string[]): PendingAttachment[] {
  const wanted = new Set(ids);
  return Object.values(rails).flatMap((rows) =>
    rows.flatMap((f) => {
      if (f.attachmentId === undefined || !wanted.has(f.attachmentId)) return [];
      const shown = f.previewUrl ?? f.thumb;
      return [
        { name: f.name, kind: f.kind, ...(shown === undefined ? {} : { previewUrl: shown }) },
      ];
    }),
  );
}

/** Is a PUT still in flight? The send is HELD while one is (the R61 field convention) — a `failed`
 *  chip deliberately does not count: it will never land, and blocking on it would strand the send.
 *  The CURRENT slot's: a send waits for ITS conversation's upload, never another's. */
export function isUploading(): boolean {
  return stagedFiles().some((f) => f.status === "uploading");
}

/** A new chip joins the CURRENT slot's rail. */
export function addStaged(file: StagedAttachment): void {
  putRail(slot, [...stagedFiles(), file]);
  commit([slot]);
}

/** Patch one row by `localId`, in whichever rail it is (H4 — an upload that finishes after a hop) — a
 *  no-op when it is gone (the owner removed the chip mid-upload, which is the ordinary way this races). */
export function updateStaged(localId: string, patch: Partial<StagedAttachment>): void {
  const changed = mapRows((f) => (f.localId === localId ? { ...f, ...patch } : f));
  if (changed.length) commit(changed);
}

/** Drop one chip and release its thumbnail. The staged file on the server is left for the sweep —
 *  there is no un-stage call, and inventing one would be a write path for a file that expires by
 *  itself in `staging_orphan_hours`. */
export function removeStaged(localId: string): void {
  const gone = dropRows((f) => f.localId === localId);
  if (!gone.rows.length) return;
  gone.rows.forEach(revoke);
  commit(gone.keys);
}

/** Everything in the CURRENT slot's rail goes — the owner cleared the composer. */
export function clearStaged(): void {
  const rows = rails[slot];
  if (!rows?.length) return;
  rows.forEach(revoke);
  putRail(slot, []);
  commit([slot]);
}

/** Drop exactly the rows whose ids a send CONSUMED (§3: a claimed id can never be claimed again), and
 *  keep everything else — a chip added while the POST was in flight is still the owner's to send. By
 *  id, across every rail (H4). Called on the 200/202 only: a refused send (409) keeps its chips so the
 *  owner can act on the server's own sentence.
 *
 *  OBJECT-URL OWNERSHIP TRANSFERS HERE (MED-6): the previews of the rows this drops are deliberately
 *  NOT revoked — the optimistic bubble `store/chat` just pushed is rendering them, and it is the
 *  caller (the one place that knows the send was accepted) that takes ownership and later revokes.
 *  Every OTHER exit from this store — `removeStaged`, `clearStaged`, the prune — still revokes, because
 *  on those paths nothing else ever held the URL. */
export function consumeStaged(ids: readonly string[]): void {
  const spent = new Set(ids);
  const gone = dropRows((f) => f.attachmentId !== undefined && spent.has(f.attachmentId));
  if (gone.keys.length) commit(gone.keys);
}

function revoke(file: StagedAttachment): void {
  if (file.previewUrl !== undefined) URL.revokeObjectURL(file.previewUrl);
}
