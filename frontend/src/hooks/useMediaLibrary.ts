import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useRef, useState } from "react";

import { useActiveBackdrop } from "./useActiveBackdrop";
import { useMediaGalleryIndex, type MediaFile, type MediaIndex } from "./useMedia";
import { useSaveSettings, useSettings, type MediaFileEntry, type SettingsDoc } from "./useSettings";
import { del } from "../api/client";
import type { FocalPoint } from "../lib/focalPosition";
import { bindingKey, boundByKey } from "../lib/media";
import {
  appendItem,
  bundledRowId,
  entryId,
  ladderRows,
  moveBy,
  moveToEdge,
  pinLabel,
  pinRef,
  removeItem,
  restoreDefaults,
  rowId,
  setFocal,
  toggleHidden,
  type ActiveArt,
  type LibraryEntry,
  type PinRef,
  type RowId,
} from "../lib/mediaLibrary";
import { pushToast } from "../store/toast";
import {
  backdropOutrank,
  useAgentBackdropMode,
  type BackdropOutrank,
} from "../theme-engine/kit/agentBackdrop";
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
//    The queue is per NAMESPACE and the send step is exclusive APP-WIDE (`exclusive` below), because
//    the hazard has two scopes: a role's list is one namespace's, and the settings snapshot every
//    intent recomputes from is shared by all of them.
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
  /** An earlier usable row already claimed this row's BINDING KEY, so this one paints nowhere
   *  (defect #4 — the duplicate the owner cannot see). Only ever true in a role that binds by name;
   *  a pool has no such question to ask. */
  duplicate: boolean;
}

/** Why an agent-backdrop destination is painting none of its own pictures, in the owner's words (D70
 *  §8.3's two outrankings). It lives beside the wiring that MINTS `ActiveArt.outranked` — the same
 *  place the seat pointer's label is minted — so the card's status line and the gallery's reading line
 *  say one sentence rather than two that can drift. */
export const OUTRANKED: Record<BackdropOutrank, string> = {
  agent: "the active character's own art is used",
  off: "the agent backdrop is off",
};

/** One section, resolved: what it is, what is in it, and what is live. */
export interface SectionView {
  section: MediaSection;
  /** Every row of the section's role, in collation order — the modal narrows it by scope. */
  rows: MediaFile[];
  active: ActiveArt;
  /** §2.4 for ONE KEY of a `named` role — the role's own per-key resolver, already bound to these rows
   *  and the wire's `slots`.
   *
   *  It exists because a FAMILY card (kit's services, machines) is a list of keys and has to say what
   *  answers each one. It used to re-derive that with the generic binding classifier over the visible
   *  rows, which is a second implementation of a ladder question — and the two agreed only while no
   *  bundled id happened to match a service key (`activeNamedKey` excludes the bundled tier; the
   *  classifier does not). Absent for every role that is not `named`. */
  activeForKey?: (key: string) => ActiveArt;
  /** The seat whose pin is currently beating this section's own pick (§2.4). */
  overriddenBy?: { sectionId: string; label: string };
  /** The pin this section currently holds, for a section that writes one — ABSENT when nothing is
   *  pinned, which is what the seat's built-in default is shown for. See `PinView`. */
  pinned?: PinView;
}

/** One held pin, as everything on the gallery screen needs it: the IDENTITY to compare a row against,
 *  and the human half to print. Both, because they answer different questions and neither can be
 *  derived from the other at the point of use — `f:lyra.webp` must never reach a sentence, and
 *  `lyra.webp` must never be compared against a row.
 *
 *  `id` is `null` for a pin the parser cannot read (a hand-edited config naming both fields, or
 *  neither — the server refuses to write one). That is deliberately still a PRESENT pin: it resolves
 *  to no row, so the gallery says "the bound image is missing" and offers the Clear that removes it,
 *  which is the only way the owner could act on it at all. */
export interface PinView {
  id: RowId | null;
  label: string;
}

/** What a gallery is SCOPED to — the whole role, one key of it, the files that bound nothing, or a
 *  role's bundled ROTATION set. */
export interface GalleryScope {
  key?: string;
  unassigned?: boolean;
  /** The role's bundled tier, as a dealt set (`MediaRotationDef` — cosmos's service banners). */
  rotation?: boolean;
  /** The declared keys, for the unassigned filter: static ones come from the registry, derived ones
   *  from the live list the family card already holds. */
  keys?: readonly string[];
}

/** The rows one scope shows. A KEY scope holds the file that bound it, every file SHADOWED by it (the
 *  duplicates — visible at last, defect #4) and the bundled entry carrying the same id. */
export function scopedRows(rows: readonly MediaFile[], scope: GalleryScope): MediaFile[] {
  // The ROTATION scope is the role's bundled tier and nothing else: the owner's own files in this
  // folder bind to SERVICES and are the family card's business, so putting them here would offer a
  // reorder that decides nothing about them.
  if (scope.rotation === true) return rows.filter((r) => r.bundled != null);
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
 *  It used to be stated only of the `files` half, and the carve-out was where the hole was: whether a
 *  SEAT's pin can RESOLVE — is its target in the tier that seat's ladder deals? — was decided when the
 *  owner TAPPED, off the rendered item. Toggle an entry off and pin it before the refetch lands and the
 *  pin was minted "already eligible", so it wrote onto a hidden entry and could never resolve. A scalar
 *  is simple; whether it may RESOLVE is not, and that is a fact about the index. So there is one rule
 *  and no kinds: a job is a function of the freshest cached settings + index, and `null` is its honest
 *  refusal. */
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

/** The media write LANE — ONE settings PUT (and the refetch it awaits) in flight across every mounted
 *  namespace, module-scoped because that is the scope the hazard has.
 *
 *  Each namespace owns its own queue, which is right: a `gacha` intent and a `kit` one touch different
 *  blocks and neither can clobber the other's list. What they DO share is the `["settings"]` cache the
 *  PUT's whole-doc echo is adopted into, and a Conf tab mounts all three namespaces at once. Two drains
 *  overlapping therefore had a window the per-queue serialization could not see: the later PUT's echo
 *  landing BEFORE the earlier one's left the shared snapshot describing an older document, and the next
 *  intent — which is recomputed at SEND, from exactly that snapshot — read per-item fields (`hidden`,
 *  `focal`, `key`) that had already been superseded.
 *
 *  So the recompute-and-send step is exclusive app-wide. A rejected job must not stall the lane, hence
 *  the swallow: the queue words its own failures, and this only decides WHEN the next send may compute. */
let lane: Promise<unknown> = Promise.resolve();

function exclusive(run: () => Promise<void>): Promise<void> {
  const next = lane.then(run);
  lane = next.catch(() => undefined);
  return next;
}

export function useMediaLibrary(ns: string, def: MediaNsDef) {
  const { data, isLoading, error } = useMediaGalleryIndex(ns);
  // The AGENT BACKDROP's own ladder (D70 §8.3), for the sections that declare themselves that surface
  // (`MediaSection.agentBackdrop`). It is read HERE for the same reason the seat's claim is judged here:
  // this is the one place holding both the library and the app state, and a §2.4 resolver is pure in its
  // rows + the wire's `slots` — it cannot see which agent is active or what the owner set the mode to.
  // Two cheap reads: a store selector, and the SHARED `["agents"]`/`["media","agents"]` queries every
  // backdrop consumer already observes (one request, not a second).
  const backdropMode = useAgentBackdropMode();
  const hasAgentArt = useActiveBackdrop() !== undefined;
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
      let active = section.active?.(rows, data.slots ?? {}) ?? {
        ids: [],
        mode: "first" as const,
      };
      let seat =
        active.overriddenBySlot === undefined ? undefined : seats.get(active.overriddenBySlot);
      // An override is a CLAIM until the seat RESOLVES (the W6 confirm-2 catch): the paint ladder
      // falls through a dangling/hidden/unusable pin to the pool below, so a pointer honoured on the
      // pin's mere presence hid the pool's real active image and said "set by the seat" about a seat
      // painting nothing. This is the one place holding BOTH roles, so the judgment lands here: the
      // seat's own resolver over its own dealt tier — the same call its own card makes — says whether
      // the claim is real. Real ⇒ this section marks nothing and points; void ⇒ the pool answers for
      // itself and the pointer is dropped.
      if (seat !== undefined) {
        const resolved = seat.active?.(
          ladderRows(data.roles?.[seat.role] ?? []),
          data.slots ?? {},
        ) ?? {
          ids: [],
        };
        if (resolved.ids.length > 0) active = { ...active, ids: [] };
        else {
          active = { ...active, overriddenBySlot: undefined };
          seat = undefined;
        }
      }
      // …and the surface that outranks BOTH of them (D70 §8.3, the S6 fix wave): where the section IS
      // the agent-backdrop destination, the active agent's own picture wins its art and `off` paints
      // nothing — so neither the theme's ladder NOR a seat that resolves is what stands there. Same
      // consequence as an honoured seat claim (the ids are blanked, and the seat pointer goes with it,
      // because the pointer would send the owner to a section that is not painting either), plus the
      // WORD the card needs: "nothing in use" is the sentence for an owner who switched every entry
      // off, and it would be the wrong reason here.
      const outranked =
        section.agentBackdrop === true ? backdropOutrank(backdropMode, hasAgentArt) : null;
      if (outranked !== null) {
        active = { ...active, ids: [], overriddenBySlot: undefined, outranked };
        seat = undefined;
      }
      // The per-key resolver, bound HERE for the reason `active` is resolved here: the wire's `slots`
      // are the wiring's to hold, and a component passing an empty map in their place would be a
      // second, quieter answer to the same question.
      const forKey = section.def.activeForKey;
      return {
        section,
        rows,
        active,
        activeForKey: forKey && ((key: string) => forKey(key)(rows, data.slots ?? {})),
        // A resolver may only name a SLOT (a theme module never knows section ids); the pointer is
        // minted here, and only when that seat is actually a section on screen — a claim the owner
        // cannot follow is worse than none.
        overriddenBy: seat && { sectionId: seat.id, label: seat.title },
        pinned: section.pin === undefined ? undefined : pinView(data.slots?.[section.pin]),
      };
    });
  }, [data, def, ns, backdropMode, hasAgentArt]);

  const drain = useCallback(async () => {
    if (draining.current) return;
    draining.current = true;
    setBusy(true);
    try {
      while (queue.current.length > 0) {
        const job = queue.current.shift() as Job;
        // THE LANE (see `exclusive`): the recompute and the send it feeds are one indivisible step,
        // app-wide. Computing outside it would read a `["settings"]` snapshot another namespace's PUT
        // is in the middle of replacing, which is the very staleness the recompute exists to avoid.
        await exclusive(async () => {
          // RECOMPUTE AT SEND (Emma #3). The cache is the truth the previous job left behind —
          // `useSaveSettings` adopts the PUT's echo and awaits the media refetch — so a queued intent
          // is applied to the list as it is NOW, never to the snapshot the tap was made against.
          const block = job.patch(
            qc.getQueryData<SettingsDoc>(["settings"]),
            qc.getQueryData<MediaIndex>(["media", ns]),
          );
          // The honest refusal: without the state this write needs, the only safe patch is none.
          if (block === null) {
            job.settle?.("skipped");
            return;
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
          // recomputation, and it was not: whether that pin can RESOLVE is a fact about the index, so
          // a retained pin could be written onto an entry the queue had just hidden. A dropped write
          // costs the owner one re-tap; a retained one writes a binding nothing honours.
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
        });
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
      /** **"Use here"** — a SEAT's one write (§2.1), and the only pin left anywhere since the
       *  2026-08-26 ruling ("W6" — order is the only priority system). Every POOL's answer to "this
       *  one, please" is `moveToEdge(…, "top")` now, so there is no second spelling to branch on and
       *  this function no longer has an order half.
       *
       *  It REFUSES rather than repairs, and that is the ruling's own shape rather than a lost
       *  guarantee. The pin is looked up in the list its ladder DEALS, so `ladderRows` — the shared
       *  §2.3 tier rule every resolver reads — IS the question, asked at SEND against the authoritative
       *  index (Emma's S2 confirm round: the rendered item is a snapshot, and between the tap and the
       *  send the queue may have hidden the very entry being pinned). A target that is not in that tier
       *  cannot be put there from HERE: a seat is a read-only VIEW over another destination's library
       *  (§2.1), and both repairs the old three-valued `Eligibility` offered — un-hiding an entry, and
       *  LISTING a fallback-tier bundled row — write into the SOURCE role's own tier, which is a write
       *  this section's capability set says it cannot make (`caps.hidden` is false on a seat) and which
       *  for a bundled row collapses that role's whole bundled deal to one entry (judgment A). So the
       *  answer is `null`: nothing is written, and the owner fixes it in the source role's own gallery.
       *  Writing a binding the render walks past is the one thing §2.4 exists to prevent. */
      pin: (section: MediaSection, item: LibraryItem) => {
        if (section.pin === undefined) return;
        const pin = section.pin;
        enqueue({
          patch: (_settings, index) => {
            const rows = index?.roles?.[section.role];
            // No authoritative index ⇒ no write. Whether this pin can RESOLVE is a fact about the
            // library, and writing one that cannot is the claim §2.4 exists to prevent.
            if (rows === undefined) return null;
            // The whole send-time check, and since "W9" it is the whole truth: is this ROW in the tier
            // the seat deals, and can it paint? The pin persists the row's IDENTITY, so there is
            // nothing to resolve back — no earlier namesake to lose the binding to, no second identity
            // space answering to the same word. (It used to re-resolve the bare NAME the pin held and
            // refuse unless the answer came back as the tapped row; that dance was the collision's
            // cost, and the collision is gone.)
            const row = ladderRows(rows).find((r) => rowId(r) === item.id);
            if (row === undefined || row.unusable === true) return null;
            return { slots: { [pin]: pinRef(row) } };
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
       *  A row GONE by send time is the same honest refusal: no authoritative row, no write.
       *
       *  **A BUNDLED entry is framable too since "W10"**, and it needs no arm of its own: its row
       *  carries `revision: ""` and the sheet hands back the same `""`, so the guard below passes and
       *  the point is stored with `rev: ""` — which `focalState` reads as LIVE for a bundled row,
       *  because build-hashed bytes have no revision to go stale against. The refusal that used to sit
       *  here was Emma #6's, and it was about the MAPPING MODE rather than about the write: putting a
       *  hand-tuned proportional string through a centred reticle would have moved the shipped art. The
       *  item-mode design (council H3) is what made that unrepresentable — a stored point is centred by
       *  construction and the shipped string only answers where there is no point. */
      setFocal: (
        section: MediaSection,
        item: LibraryItem,
        point: FocalPoint | null,
        expectedRev: string,
      ) => {
        if (!section.caps.frame) return;
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
                "The picture changed while you were setting its focus — nothing was saved. Open it again to set focus on the new one.",
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
      /** **Restore defaults** (the S6 affordance, on the 2026-08-26 owner ruling) — the section's
       *  shipped art goes to the TOP, in use and in the registry's own order, and the owner's own files
       *  stay in the library below it, switched off. Nothing is deleted; deleting uploads is what
       *  Delete is for. The whole rule is `lib/mediaLibrary.ts#restoreDefaults`.
       *
       *  The REGISTRY ORDER is passed down from here because that is where the registry is: the
       *  transform is namespace-agnostic and cannot know which ids a role ships, let alone in what
       *  order (the same split `toggleHidden`'s `ordered` flag runs on).
       *
       *  `ids` scopes it to the rows the affordance was offered for, so a KEY gallery restores its own
       *  layer rather than the whole role — computed at the TAP because it is a fact about the scope
       *  the owner is looking at, not about the list at send time (which is what every other job here
       *  recomputes). The transform still runs against the authoritative rows, so an id that has since
       *  left the library simply falls out. */
      restoreDefaults: (section: MediaSection, ids: ReadonlySet<RowId>) =>
        enqueue(
          listJob(section.role, (e, r) =>
            restoreDefaults(
              e,
              r,
              section.def.bundled.map((b) => bundledRowId(b.id)),
              ids,
            ),
          ),
        ),
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
      /** A TOGGLE, not an absolute write (the W6 review's fix #2): the target state is derived at
       *  SEND from the authoritative rows, so rapid taps compose instead of repeating the state the
       *  first tap rendered. Both In-use controls (the tile corner and the detail switch) enqueue
       *  exactly this — one intent, one derivation.
       *
       *  `caps.reorder` rides along because switching an entry OFF where ORDER is the priority system
       *  is itself an order intent — one that states the order unchanged (the owner ruling of
       *  2026-08-26, "W7": an unticked image dims in place and does not move). The transform owns what
       *  that means; this passes the one fact it cannot see, which is whether this section arranges at
       *  all. A per-key gallery does not, and keeps the minimal write. */
      toggleHidden: (section: MediaSection, item: LibraryItem) =>
        enqueue(listJob(section.role, (e, r) => toggleHidden(e, r, item.id, section.caps.reorder))),
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

/** One wire pin as the screen reads it, or `undefined` for "nothing is pinned" — which is both the key
 *  being absent and the value being `null` (the server does not send a cleared pin, but this is wire
 *  data and degrading is the posture everywhere it is read). */
function pinView(pin: PinRef | null | undefined): PinView | undefined {
  return pin == null ? undefined : { id: entryId(pin), label: pinLabel(pin) };
}

/** The `roles.<role>.files` block one intent produces against the freshest state — `null` when either
 *  half of the authoritative state is missing, which is the queue's one invariant applied to a list
 *  write:
 *
 *   · no SETTINGS snapshot — a list rebuilt without the persisted entries would drop every per-item
 *     field the owner set;
 *   · no ROLE on the wire — the transforms compute the whole list from the index rows, so an absent
 *     role would compute against `[]` and persist `files: []`, wiping the order, the switched-off
 *     entries, the framing points and the binding keys in one save. The index can genuinely stop
 *     carrying a role between the tap and the send: the namespace flips DISABLED (`disabled_index`
 *     answers with no roles at all) or the registry row shrank under a config that named it.
 *
 *  The test is KEY PRESENCE, never non-emptiness. An empty-but-present role is a real, writable state —
 *  it is what the first upload's register phase writes into — and the server emits every registry
 *  role's key whatever the folder holds (`core/media.py#build_index`, pinned by
 *  `test_role_dirs_are_created_at_app_construction`), so "the key is missing" means exactly "this
 *  payload does not describe the role". */
function filesBlock(
  ns: string,
  role: string,
  apply: (entries: LibraryEntry[], rows: MediaFile[]) => LibraryEntry[],
  settings: SettingsDoc | undefined,
  index: MediaIndex | undefined,
): Record<string, { files: MediaFileEntry[] }> | null {
  if (settings === undefined) return null;
  const entries = settings.media?.namespaces?.[ns]?.roles?.[role]?.files ?? [];
  const rows = index?.roles?.[role];
  if (rows === undefined) return null;
  return { [role]: { files: apply(entries, rows) } };
}

/** The per-row view model one grid renders (§6.3/§6.5).
 *
 *  DUPLICATES are the shadowed-KEY case and only that (defect #4): in a role that BINDS BY NAME, a row
 *  whose binding key an earlier usable row already claimed paints nowhere at all — the loser
 *  `classifyNamed` names — and nothing on the grid said so. `named` is that precondition, handed down
 *  from the section descriptor (`MediaRoleDef.kind`) for the reason every other theme fact is: this
 *  module holds no registry import, and "does this role bind by name" is registry knowledge.
 *
 *  **It is a precondition rather than a detail, and the W9 rider is what proved it.** The arm used to
 *  run for every section, so a POOL holding `a.png` and `a.webp` was told its two entries "answer to
 *  the same name" and that "the one higher in the list wins". Both sentences were about a MECHANISM: a
 *  bare-stem `slots` pin, which reached whichever of them the collation listed first. Typed pins
 *  ("W9") removed that mechanism — a pool binds by POSITION and nothing addresses its entries by name
 *  — leaving a warning about a collision no reader consumes, which is noise wearing a warning's
 *  clothes. Where the mechanism survives (a `named` role's per-key ladder) the behaviour here is
 *  byte-identical.
 *
 *  The same wave deleted the arm's other half outright: a `pinnable` flag that reported the STEM/ID
 *  collision a bare-name pin created (a file `lyra.webp` and the bundled id `lyra` both answering to
 *  `lyra`). That state is unrepresentable now rather than merely visible, so its detector went with
 *  it. */
export function libraryItems(
  rows: readonly MediaFile[],
  active: ActiveArt,
  named = false,
  ids: ReadonlySet<RowId> = new Set(active.ids),
): LibraryItem[] {
  const claimed = new Set<string>();
  return rows.map((row) => {
    const id = rowId(row);
    const key = bindingKey(row);
    const claims = named && row.bundled == null && row.unusable !== true;
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
