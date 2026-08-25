import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useRef, useState } from "react";

import { useMediaGalleryIndex, type MediaFile, type MediaIndex } from "./useMedia";
import { useSaveSettings, useSettings, type MediaFileEntry, type SettingsDoc } from "./useSettings";
import { del } from "../api/client";
import { bindingKey, boundByKey } from "../lib/media";
import {
  ladderRows,
  moveBy,
  moveToEdge,
  removeItem,
  rowId,
  setActive,
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

/** One queued write. `files` jobs are INTENTS over a role's list — recomputed at send; `slot` jobs are
 *  a single scalar and need no recomputation. */
type Job =
  | {
      kind: "files";
      role: string;
      apply: (entries: LibraryEntry[], rows: MediaFile[]) => LibraryEntry[];
    }
  | { kind: "slot"; slot: string; value: string | null };

export function useMediaLibrary(ns: string, def: MediaNsDef) {
  const { data, isLoading, error } = useMediaGalleryIndex(ns);
  // The CONFIG side of every write. A `files` entry carries per-item state the gallery does not
  // interpret (`focal`, `key`, anything a later slice adds), so a write is a read-modify-write against
  // what is persisted — rebuilding from the index would silently drop all of it. Conf-scoped and
  // already fetched by the tab this renders in: the same shared query, not a second request.
  const { data: settings } = useSettings();
  const save = useSaveSettings({ quiet: true });
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const queue = useRef<Job[]>([]);
  const draining = useRef(false);

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
        const fresh = qc.getQueryData<SettingsDoc>(["settings"]);
        const index = qc.getQueryData<MediaIndex>(["media", ns]);
        const block =
          job.kind === "slot"
            ? { slots: { [job.slot]: job.value } }
            : filesBlock(ns, job, fresh, index);
        if (block === null) continue;
        try {
          await save.mutateAsync({ media: { namespaces: { [ns]: block } } });
        } catch {
          // `useSaveSettings` has already toasted the reason. Drop the rest of the queue rather than
          // replaying intents against a list the server refused — the owner can see what happened.
          queue.current.length = 0;
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

  const write = useMemo(
    () => ({
      /** "Set as active" — move-to-front, or the PIN where the section's ladder has one above it. */
      activate: (section: MediaSection, item: LibraryItem) => {
        if (section.caps.activate === "none") return;
        if (section.caps.activate === "pin" && section.pin !== undefined) {
          enqueue({ kind: "slot", slot: section.pin, value: item.row.name });
          return;
        }
        enqueue({ kind: "files", role: section.role, apply: (e, r) => setActive(e, r, item.id) });
      },
      /** Clear a pin — the section falls back to its own ladder. */
      unpin: (section: MediaSection) => {
        if (section.pin === undefined) return;
        enqueue({ kind: "slot", slot: section.pin, value: null });
      },
      move: (section: MediaSection, item: LibraryItem, delta: number) =>
        enqueue({
          kind: "files",
          role: section.role,
          apply: (e, r) => moveBy(e, r, item.id, delta),
        }),
      moveToEdge: (section: MediaSection, item: LibraryItem, edge: "top" | "bottom") =>
        enqueue({
          kind: "files",
          role: section.role,
          apply: (e, r) => moveToEdge(e, r, item.id, edge),
        }),
      setHidden: (section: MediaSection, item: LibraryItem, hidden: boolean) =>
        enqueue({
          kind: "files",
          role: section.role,
          apply: (e, r) => setHidden(e, r, item.id, hidden),
        }),
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
        enqueue({ kind: "files", role: section.role, apply: (e, r) => removeItem(e, r, item.id) });
      },
    }),
    [enqueue],
  );

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

/** The `roles.<role>.files` block one intent produces against the freshest state — `null` when the
 *  settings snapshot is missing, which is the honest refusal: a list rebuilt without the persisted
 *  entries would drop every per-item field the owner set. */
function filesBlock(
  ns: string,
  job: Extract<Job, { kind: "files" }>,
  settings: SettingsDoc | undefined,
  index: MediaIndex | undefined,
): { roles: Record<string, { files: MediaFileEntry[] }> } | null {
  if (settings === undefined) return null;
  const entries = settings.media?.namespaces?.[ns]?.roles?.[job.role]?.files ?? [];
  const rows = index?.roles?.[job.role] ?? [];
  return { roles: { [job.role]: { files: job.apply(entries, rows) } } };
}

/** The per-row view model one grid renders (§6.3/§6.5).
 *
 *  DUPLICATES are computed here for BOTH role kinds through the one binding rule (defect #4): a row is
 *  a duplicate when an earlier usable row already claimed its key — which in a `named` role is the
 *  shadowed loser `classifyNamed` names, and in a POOL is the `a.png` / `a.webp` pair whose second half
 *  no `slots` pin could ever address. It used to be invisible in both. */
export function libraryItems(
  rows: readonly MediaFile[],
  active: ActiveArt,
  ids: ReadonlySet<RowId> = new Set(active.ids),
): LibraryItem[] {
  const claimed = new Set<string>();
  return rows.map((row) => {
    const id = rowId(row);
    const key = bindingKey(row);
    const claims = row.bundled == null && row.unusable !== true;
    const duplicate = claims && claimed.has(key);
    if (claims) claimed.add(key);
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
