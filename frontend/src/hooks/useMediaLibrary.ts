import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useRef, useState } from "react";

import { useMediaGalleryIndex, type MediaFile, type MediaIndex } from "./useMedia";
import { useSaveSettings, useSettings, type MediaFileEntry, type SettingsDoc } from "./useSettings";
import { del } from "../api/client";
import type { FocalPoint } from "../lib/focalPosition";
import { bindingKey, boundByKey } from "../lib/media";
import {
  appendItem,
  ladderRows,
  makeEligible,
  moveBy,
  moveToEdge,
  removeItem,
  rowId,
  setActive,
  setFocal,
  setHidden,
  type ActiveArt,
  type LibraryEntry,
  type RowId,
} from "../lib/mediaLibrary";
import { pushToast } from "../store/toast";
import { mediaSections, type MediaNsDef, type MediaSection } from "../theme-engine/mediaRegistry";

// The gallery's DATA LAYER (MEDIA_MANAGER_PLAN §12) — index + settings + registry in, SECTIONS out,
// and the one write chokepoint every media config change flows through.
//
// It exists so the components below it are renderers: `MediaGallery` maps sections to cards, the modal
// maps one section to a grid, and neither of them knows what a tier is, which query answers, or how a
// write is serialised. Three things live here and nowhere else:
//
//  ① SECTIONS — the registry's descriptors resolved against the SERVER's role list, each carrying its
//    rows, its `active` resolution (§2.4) and the pointer a section that is overridden by a seat needs.
//  ② The SERIALIZED, QUIET write queue (Emma #3 re-derived lean + defect #10). Every write is an
//    INTENT ("move this entry up one"), queued, and recomputed from the latest cached state at SEND
//    time — so two taps in the same second compose instead of the second one clobbering the first with
//    an order computed off a stale list, and two SECTIONS' writes can never replace each other's list.
//  ③ Invalidation, which is `useSaveSettings`'s already (it awaits the media refetch) — this hook only
//    has to not fight it.
//
// The two-devices-at-once lost update stays an accepted residual (single owner; server revision tokens
// are the recorded road not taken, §13).

/** One library row as the gallery reads it. */
export interface LibraryItem {
  id: RowId;
  row: MediaFile;
  /** In use per the section's §2.4 resolver. */
  active: boolean;
  /** The genuinely CURRENT one — only ever set where exactly one entry wins (`aria-current`, Emma #9). */
  current: boolean;
  hidden: boolean;
  bundled: boolean;
  /** The key this file binds to in a `named` role, and whether its own `key` field did the binding. */
  key?: string;
  keyBound: boolean;
  /** Another row already took this row's key/stem (defect #4 — the duplicate the owner cannot see). */
  duplicate: boolean;
}

/** One section, resolved: what it is, what is in it, and what is live. */
export interface SectionView {
  section: MediaSection;
  /** Every row of the section's role, in collation order — the modal narrows it by scope. */
  rows: MediaFile[];
  active: ActiveArt;
  /** The seat whose pin is currently beating this section's own pick (§2.4). */
  overriddenBy?: { sectionId: string; label: string };
  /** The pin's current value, for a section that writes one. */
  pinned?: string;
}

/** What a gallery is SCOPED to — the whole role, one key of it, or the files that bound nothing. */
export interface GalleryScope {
  key?: string;
  unassigned?: boolean;
  /** The declared keys, for the unassigned filter: static ones come from the registry, derived ones
   *  from the live list the family card already holds. */
  keys?: readonly string[];
}

/** The rows one scope shows. A KEY scope holds the file that bound it, every file SHADOWED by it (the
 *  duplicates — visible at last, defect #4) and the bundled entry carrying the same id. */
export function scopedRows(rows: readonly MediaFile[], scope: GalleryScope): MediaFile[] {
  if (scope.unassigned === true) {
    const declared = new Set(scope.keys ?? []);
    return rows.filter((r) => r.bundled == null && !declared.has(bindingKey(r)));
  }
  if (scope.key === undefined) return [...rows];
  return rows.filter((r) =>
    r.bundled != null ? r.bundled === scope.key : bindingKey(r) === scope.key,
  );
}

/** The `media.namespaces.<ns>` block one write carries. */
type NsBlock = Record<string, unknown>;

/** One queued write, as an INTENT — and THE QUEUE'S ONE INVARIANT (Emma's S2 confirm round):
 *
 *  > **every write is computed from AUTHORITATIVE state at SEND time; no authoritative state, no
 *  > write.**
 *
 *  It used to be stated only of the `files` half, and the carve-out was where the hole was: a PIN's
 *  eligibility — whether its target is `hidden`, whether it is a fallback-tier bundled row that has to
 *  be listed — was decided when the owner TAPPED, off the rendered item. Toggle an entry off and
 *  activate it before the refetch lands and the pin was minted "already eligible", so it wrote onto a
 *  hidden entry and could never resolve. A scalar is simple; whether it may RESOLVE is not, and that
 *  is a fact about the index. So there is one rule and no kinds: a job is a function of the freshest
 *  cached settings + index, and `null` is its honest refusal. */
interface Job {
  patch: (settings: SettingsDoc | undefined, index: MediaIndex | undefined) => NsBlock | null;
  /** What to tell the owner if THIS write fails — for a job whose other half already happened and
   *  cannot be undone (the DELETE cleanup). Absent ⇒ the ordinary save error. */
  failNote?: string;
  /** How this job ENDED, for the one caller that has to know: the upload's REGISTER phase (§4's
   *  two-phase job). Every other gesture here is fire-and-forget — its outcome is the next repaint,
   *  and its failure is the queue's own toast. An upload is different because the bytes are already
   *  on the server: the failure row has to say which phase failed and offer a retry that never
   *  re-uploads, and it can only do that if the queue tells it. */
  settle?: (outcome: JobOutcome) => void;
}

/** `written` — the server took it · `skipped` — the queue refused to compute it (no authoritative
 *  state, or the refetch-bound discard) · `failed` — the save was refused. */
export type JobOutcome = "written" | "skipped" | "failed";

export function useMediaLibrary(ns: string, def: MediaNsDef) {
  const { data, isLoading, error } = useMediaGalleryIndex(ns);
  // The CONFIG side of every write. A `files` entry carries per-item state the gallery does not
  // interpret (`focal`, `key`, anything a later slice adds), so a write is a read-modify-write against
  // what is persisted — rebuilding from the index would silently drop all of it. Conf-scoped and
  // already fetched by the tab this renders in: the same shared query, not a second request.
  const { data: settings } = useSettings();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const queue = useRef<Job[]>([]);
  const draining = useRef(false);
  /** The last save's media refetch did not land inside its bound — the cached index is no longer
   *  known-authoritative (§4's recompute-at-send has nothing trustworthy to recompute from). */
  const stale = useRef(false);
  /** The job being sent, so its own wording reaches the error toast. */
  const sending = useRef<Job | null>(null);
  const save = useSaveSettings({
    quiet: true,
    onMediaStale: () => {
      stale.current = true;
    },
    // The queue words its own failures: a config write that follows an already-successful DELETE is a
    // PARTIAL success and has to be said as one (Emma's S2 review #7).
    onError: (e) => {
      pushToast(sending.current?.failNote ?? e.message ?? "Save failed", "err");
      return true;
    },
  });

  const sections = useMemo((): SectionView[] => {
    if (data === undefined || data.disabled === true) return [];
    const roles = Object.keys(data.roles ?? {});
    const declared = mediaSections(ns, def, roles);
    const seats = new Map(
      declared
        .filter((s) => s.kind === "seat" && s.pin !== undefined)
        .map((s) => [s.pin as string, s]),
    );
    return declared.map((section) => {
      const all = data.roles?.[section.role] ?? [];
      // A SEAT shows what its source ladder can actually RESOLVE, not every row in the folder: the pin
      // names an entry the theme looks up in the list it deals, so offering a bundled entry beside the
      // owner's own files would let the owner pick one the render then falls straight through — the
      // gallery claiming a binding it cannot honour, which is the one thing §2.4 exists to prevent.
      const rows = section.kind === "seat" ? ladderRows(all) : all;
      const active = section.active?.(rows, data.slots ?? {}) ?? {
        ids: [],
        mode: "first" as const,
      };
      const seat =
        active.overriddenBySlot === undefined ? undefined : seats.get(active.overriddenBySlot);
      return {
        section,
        rows,
        active,
        // A resolver may only name a SLOT (a theme module never knows section ids); the pointer is
        // minted here, and only when that seat is actually a section on screen — a claim the owner
        // cannot follow is worse than none.
        overriddenBy: seat && { sectionId: seat.id, label: seat.title },
        pinned: section.pin === undefined ? undefined : (data.slots?.[section.pin] ?? undefined),
      };
    });
  }, [data, def, ns]);

  const drain = useCallback(async () => {
    if (draining.current) return;
    draining.current = true;
    setBusy(true);
    try {
      while (queue.current.length > 0) {
        const job = queue.current.shift() as Job;
        // RECOMPUTE AT SEND (Emma #3). The cache is the truth the previous job left behind —
        // `useSaveSettings` adopts the PUT's echo and awaits the media refetch — so a queued intent is
        // applied to the list as it is NOW, never to the snapshot the tap was made against.
        const block = job.patch(
          qc.getQueryData<SettingsDoc>(["settings"]),
          qc.getQueryData<MediaIndex>(["media", ns]),
        );
        // The honest refusal: without the state this write needs, the only safe patch is none.
        if (block === null) {
          job.settle?.("skipped");
          continue;
        }
        try {
          sending.current = job;
          await save.mutateAsync({ media: { namespaces: { [ns]: block } } });
          job.settle?.("written");
        } catch {
          // The reason is already toasted (`onError` above). Drop the rest of the queue rather than
          // replaying intents against a list the server refused — the owner can see what happened.
          job.settle?.("failed");
          for (const dropped of queue.current) dropped.settle?.("skipped");
          queue.current.length = 0;
        } finally {
          sending.current = null;
        }
        // The authoritative refetch did not land inside its bound, so the cached index is no longer
        // known to be the server's (Emma's S2 review #4) — and the invariant above says: no
        // authoritative state, no write. EVERY remaining job goes, with no carve-out for the scalar
        // ones (her confirm round). The carve-out looked safe because a pin value needs no
        // recomputation, and it was not: whether that pin can RESOLVE is a fact about the index, so a
        // retained pin could be written onto an entry the queue had just hidden. A dropped write costs
        // the owner one re-tap; a retained one writes a binding nothing honours.
        if (stale.current) {
          stale.current = false;
          if (queue.current.length > 0) {
            for (const dropped of queue.current) dropped.settle?.("skipped");
            queue.current.length = 0;
            pushToast(
              "The art list did not come back in time — the rest of your changes were not saved. Try again.",
              "err",
            );
          }
        }
      }
    } finally {
      draining.current = false;
      setBusy(false);
    }
  }, [ns, qc, save]);

  const enqueue = useCallback(
    (job: Job) => {
      queue.current.push(job);
      void drain();
    },
    [drain],
  );

  const write = useMemo(() => {
    /** A write over ONE role's `files` list, recomputed from the freshest state at send. */
    const listJob = (
      role: string,
      apply: (entries: LibraryEntry[], rows: MediaFile[]) => LibraryEntry[],
      failNote?: string,
    ): Job => ({
      patch: (settings, index) => {
        const roles = filesBlock(ns, role, apply, settings, index);
        return roles === null ? null : { roles };
      },
      failNote,
    });
    return {
      /** "Set as active" — move-to-front, or the PIN where the section's ladder has one above it.
       *
       *  Either way the write GUARANTEES the entry is eligible (Emma's S2 review #1): move-to-front
       *  switches a hidden entry back on inside `setActive`, and a pin carries whatever `files` half
       *  makes its target resolvable — otherwise the card claims a pick the render walks past.
       *
       *  The pin's half is decided INSIDE the patch, i.e. at SEND, against the authoritative index —
       *  never here, off the rendered item (her confirm round). The tap only records the INTENT:
       *  "activate this identity in this section". Between the tap and the send the queue may have
       *  hidden that very entry, and a job minted "already eligible" would then pin something nothing
       *  can resolve. */
      activate: (section: MediaSection, item: LibraryItem) => {
        if (section.caps.activate === "none") return;
        if (section.caps.activate !== "pin" || section.pin === undefined) {
          enqueue(listJob(section.role, (e, r) => setActive(e, r, item.id)));
          return;
        }
        const pin = section.pin;
        enqueue({
          patch: (settings, index) => {
            const rows = index?.roles?.[section.role];
            // No authoritative index ⇒ no write. Whether this pin can RESOLVE is a fact about the
            // library, and writing one that cannot is the claim §2.4 exists to prevent.
            if (rows === undefined) return null;
            const repair = eligibility(section, item.id, rows);
            // The target cannot be MADE resolvable from here. Write nothing at all: a pin is a claim
            // about what paints, and the one thing worse than not honouring the tap is honouring it
            // with a binding the render walks past.
            if (repair === "refuse") return null;
            const block: NsBlock = { slots: { [pin]: item.row.name } };
            if (repair !== "ready") {
              const roles = filesBlock(ns, section.role, repair, settings, index);
              // Half of a pin-plus-eligibility write is the very thing it was written to prevent.
              if (roles === null) return null;
              block.roles = roles;
            }
            return block;
          },
        });
      },
      /** The REGISTER phase of an upload (§4): the freshly stored file joins `files` at the END,
       *  keeping every other entry's priority — uploads are purely ADDITIVE, and nothing an owner
       *  arranged may be re-ordered by one arriving.
       *
       *  It is the same queued, recompute-at-send chokepoint every other gesture uses — there is no
       *  second write path for uploads (§4's write serialization). What it adds is an ANSWER: the
       *  bytes are already on the server by the time this runs, so the upload's failure row has to
       *  know whether the list write landed, and a retry of it must never re-upload anything. */
      append: (section: MediaSection, filename: string, fields: LibraryEntry = {}) =>
        new Promise<JobOutcome>((resolve) => {
          enqueue({
            ...listJob(section.role, (e, r) => appendItem(e, r, filename, fields)),
            settle: resolve,
          });
        }),
      /** The **framing point** (§5). The owner's `{x, y}`, or `null` to clear it.
       *
       *  `expectedRev` is the revision the SHEET rendered — the bytes the owner was actually looking
       *  at while they placed the point. It is the whole of Emma's S4 review #2, and the hole it
       *  closes is subtle: the `rev` a point is stored under has to be read at SEND time (the queue's
       *  one invariant), but the COORDINATES were chosen at open time. If the file is replaced under
       *  its stable name in between — an SSH overwrite, the ordinary repair — a send-time `rev` would
       *  marry the OLD picture's coordinates to the NEW picture's revision, and `focalState` would
       *  then call that pair live forever. Rev-keying exists to fold exactly that pair to "unset", so
       *  the one writer that must never mint it is this one.
       *
       *  So the two are checked against each other and a disagreement REFUSES rather than guesses: the
       *  owner is told, and framing the new bytes is a new look at a new picture. CLEARING is
       *  revision-independent — "no framing" is true of whatever is there now.
       *
       *  A row GONE by send time is the same honest refusal: no authoritative row, no write. */
      setFocal: (
        section: MediaSection,
        item: LibraryItem,
        point: FocalPoint | null,
        expectedRev: string,
      ) => {
        if (!section.caps.frame || item.bundled) return;
        enqueue({
          patch: (settings, index) => {
            const rows = index?.roles?.[section.role];
            if (rows === undefined) return null;
            const row = rows.find((r) => rowId(r) === item.id);
            if (row === undefined) return null;
            if (point !== null && row.revision !== expectedRev) {
              // The REASON is toasted here rather than through the queue's `failNote`, because this is
              // the only place that knows which of the refusals happened — the queue's other `null`s
              // (no index, no row) are states the owner cannot act on and are rightly silent.
              pushToast(
                "The picture changed while you were framing it — nothing was saved. Open it again to frame the new one.",
                "err",
              );
              return null;
            }
            // Equal to `expectedRev` by the guard above; read off the row so "the stored rev is the
            // authoritative one" stays literally true rather than true by argument.
            const focal = point === null ? null : { ...point, rev: row.revision };
            const roles = filesBlock(
              ns,
              section.role,
              (e, r) => setFocal(e, r, item.id, focal),
              settings,
              index,
            );
            return roles === null ? null : { roles };
          },
        });
      },
      /** Clear a pin — the section falls back to its own ladder. The one write that genuinely needs
       *  no state: removing a binding cannot produce an unresolvable one. */
      unpin: (section: MediaSection) => {
        if (section.pin === undefined) return;
        const pin = section.pin;
        enqueue({ patch: () => ({ slots: { [pin]: null } }) });
      },
      /** Move one entry by `delta` positions — the ↑/↓ buttons AND the drag, which produces a target
       *  index and hands it over as the same relative intent (§7). Relative, not absolute, because the
       *  queue recomputes at SEND: the position the owner dropped it at is a fact about the list they
       *  were looking at, and by send time an interleaved write may have moved everything under it.
       *
       *  It ANSWERS, like the upload's register phase does, because the drag's held commit has to know
       *  when to let go: the transform stays on the dropped tile until this settles (or until the
       *  authoritative order arrives, whichever is first), and a refusal releases it back to where the
       *  owner picked it up. */
      move: (section: MediaSection, item: LibraryItem, delta: number) =>
        new Promise<JobOutcome>((resolve) => {
          enqueue({
            ...listJob(section.role, (e, r) => moveBy(e, r, item.id, delta)),
            settle: resolve,
          });
        }),
      moveToEdge: (section: MediaSection, item: LibraryItem, edge: "top" | "bottom") =>
        enqueue(listJob(section.role, (e, r) => moveToEdge(e, r, item.id, edge))),
      setHidden: (section: MediaSection, item: LibraryItem, hidden: boolean) =>
        enqueue(listJob(section.role, (e, r) => setHidden(e, r, item.id, hidden))),
      /** DELETE-first, then ONE config write that also promotes whatever was next (§3/§6.4).
       *
       *  The order is the ruled one: the bytes go first, and a failure between the two steps leaves a
       *  DANGLING entry that the collation drops harmlessly on the next read. The reverse would leave
       *  a file on disk that nothing lists — invisible and undeletable. A cleanup failure is reported
       *  as the partial success it is. */
      remove: async (section: MediaSection, item: LibraryItem) => {
        if (!section.caps.remove || item.bundled) return;
        try {
          await del(item.row.url);
        } catch (e) {
          pushToast(e instanceof Error ? e.message : "Delete failed", "err");
          return;
        }
        enqueue(
          listJob(
            section.role,
            (e, r) => removeItem(e, r, item.id),
            // The bytes are already gone, so this write's failure is a PARTIAL success and must read
            // as one (Emma's S2 review #7): a bare "Save failed" here says the delete failed, which
            // sends the owner looking for a file the server no longer has.
            `${item.row.file} was deleted, but the library entry could not be cleaned up — it will drop on its own the next time the folder is read.`,
          ),
        );
      },
    };
  }, [enqueue, ns]);

  return {
    index: data,
    isLoading,
    error,
    sections,
    /** A write is in flight. The controls stay LIVE through it (the queue is what makes rapid taps
     *  safe); this only drives the status line and the busy attribute. */
    busy,
    /** The settings snapshot is here, so a read-modify-write is possible. Until then the write
     *  affordances are refused: writing a list rebuilt from the index alone would destroy every
     *  per-item field the owner set, on a tap that looks like it only moved a row. */
    ready: settings !== undefined,
    write,
  };
}

/** What a PIN write has to do about its target's ELIGIBILITY — THREE answers, because "no `files`
 *  half" was two opposite facts wearing one value (Emma's final confirm):
 *
 *   · `"ready"`  — the target already resolves; the pin alone is the whole write;
 *   · a TRANSFORM — it can be made to resolve, and this is the `files` half that does it;
 *   · `"refuse"` — it cannot be made to resolve FROM HERE. The two states used to return the same
 *     `undefined` the ready case does, and the caller read that as "pin-only is safe" — writing a
 *     binding nothing can honour, which is the one thing §2.4 exists to prevent. */
type Eligibility =
  "ready" | "refuse" | ((entries: LibraryEntry[], rows: MediaFile[]) => LibraryEntry[]);

/** Decide it, from the AUTHORITATIVE `rows`, at send (her confirm round — the rendered item is a
 *  snapshot, and between the tap and the send the queue may have hidden the very entry being pinned).
 *
 *  A pin is looked up in the list its ladder DEALS, so `ladderRows` — the shared §2.3 tier rule every
 *  resolver reads — IS the question: is the target in the tier this section actually deals? It cannot
 *  drift from what the pin will be looked up in, because it is the same function.
 *
 *  Two repairs exist for a target that is not: switch a `hidden` entry back on, and LIST a
 *  fallback-tier bundled id. **A SEAT may make neither on a BUNDLED row** — it is a read-only VIEW
 *  over ANOTHER destination's library (§2.1), and both repairs put that row into the SOURCE role's own
 *  tier, which collapses that role's whole bundled deal to the single entry (judgment A, Emma-grounded
 *  — and un-hiding an already-listed bundled row collapses it exactly as listing an unlisted one
 *  does). So a seat refuses there rather than writing a pin it knows will not resolve. A `hidden` DISK
 *  row is a different write and stays available to it: that is the only thing that makes such a pin
 *  honest, and it is the truthful consequence of "use this here". */
function eligibility(section: MediaSection, id: RowId, rows: readonly MediaFile[]): Eligibility {
  const row = rows.find((r) => rowId(r) === id);
  // Gone from the library between the tap and the send (deleted out of band, dropped by a collation
  // that self-healed). A pin naming it is dangling by construction and there is nothing to repair.
  if (row === undefined) return "refuse";
  if (ladderRows(rows).some((r) => rowId(r) === id)) return "ready";
  if (section.kind === "seat" && row.bundled != null) return "refuse";
  return (e, r) => makeEligible(e, r, id);
}

/** The `roles.<role>.files` block one intent produces against the freshest state — `null` when the
 *  settings snapshot is missing, which is the honest refusal: a list rebuilt without the persisted
 *  entries would drop every per-item field the owner set. */
function filesBlock(
  ns: string,
  role: string,
  apply: (entries: LibraryEntry[], rows: MediaFile[]) => LibraryEntry[],
  settings: SettingsDoc | undefined,
  index: MediaIndex | undefined,
): Record<string, { files: MediaFileEntry[] }> | null {
  if (settings === undefined) return null;
  const entries = settings.media?.namespaces?.[ns]?.roles?.[role]?.files ?? [];
  const rows = index?.roles?.[role] ?? [];
  return { [role]: { files: apply(entries, rows) } };
}

/** The per-row view model one grid renders (§6.3/§6.5).
 *
 *  DUPLICATES are computed here for BOTH role kinds through the one binding rule (defect #4): a row is
 *  a duplicate when an earlier usable row already claimed its key — which in a `named` role is the
 *  shadowed loser `classifyNamed` names, and in a POOL is the `a.png` / `a.webp` pair whose second half
 *  no `slots` pin could ever address. It used to be invisible in both.
 *
 *  `pinnable` adds the STEM/ID collision §2.3 owes the owner (Emma's S2 review #6). Where a section
 *  writes a PIN, the value is a bare name and BOTH identity spaces answer to it: a file called
 *  `lyra.webp` and the bundled id `lyra` are two different library entries (`f:` / `b:` — that split is
 *  right and stays), but one pin value reaches whichever the collation lists FIRST. That ambiguity is
 *  invisible from the grid, so it is surfaced as the same duplicate note the shadowed-key case uses;
 *  the pin name is `MediaFile.name` for both kinds, which is exactly what `firstUsable` compares. */
export function libraryItems(
  rows: readonly MediaFile[],
  active: ActiveArt,
  pinnable = false,
  ids: ReadonlySet<RowId> = new Set(active.ids),
): LibraryItem[] {
  const claimed = new Set<string>();
  const pinned = new Set<string>();
  return rows.map((row) => {
    const id = rowId(row);
    const key = bindingKey(row);
    const claims = row.bundled == null && row.unusable !== true;
    let duplicate = claims && claimed.has(key);
    if (claims) claimed.add(key);
    if (pinnable && row.unusable !== true) {
      if (pinned.has(row.name)) duplicate = true;
      pinned.add(row.name);
    }
    return {
      id,
      row,
      active: ids.has(id),
      // `aria-current` only where ONE entry genuinely wins (Emma #9): a dealt pool has no current
      // member to point at, and saying otherwise in the accessibility tree is a lie a screen reader
      // cannot check.
      current: ids.has(id) && active.mode === "first" && active.ids.length === 1,
      hidden: row.hidden === true,
      bundled: row.bundled != null,
      key: row.bundled == null ? key : undefined,
      keyBound: boundByKey(row),
      duplicate,
    };
  });
}
