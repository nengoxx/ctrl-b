import { useEffect, useId, useRef, useState } from "react";

import { ItemDetail } from "./ItemDetail";
import { LibraryGrid } from "./LibraryGrid";
import { XIcon } from "../icons";
import {
  libraryItems,
  scopedRows,
  type GalleryScope,
  type LibraryItem,
  type SectionView,
} from "../../hooks/useMediaLibrary";
import { useOverlayBackGuard } from "../../hooks/useOverlayBackGuard";
import type { MediaUpload } from "../../hooks/useMediaUpload";
import { modalKeyDown } from "../../lib/focusTrap";
import { defaultsRestorable, rowId, type ActiveArt } from "../../lib/mediaLibrary";
import { requestConfirm } from "../../store/confirm";
import { UPLOAD_ACCEPT } from "../../theme-engine/mediaRegistry";

// The full-screen GALLERY (MEDIA_MANAGER_PLAN §6.2, R59 §11.2) — one section's whole library, on the
// HOUSE dialog shell.
//
// Not a new modal: `.pm-backdrop`/`.pm` is the shell PromptModal and the automations editor already
// use, with `lib/focusTrap`'s Escape+Tab contract, the trigger captured on open and focus restored on
// close. Never `BottomSheet` — that primitive is deliberately non-modal and untrapped, and this
// surface deletes files. It sits at the sheet's z-index rather than PromptModal's because the confirm
// dialog it opens must be able to cover it.
//
// The ANDROID BACK gesture is `useOverlayBackGuard`, and it owns the only way out: the ✕ and Escape
// both call `close()`, which is `history.back()`, and the hook's `popstate` handler is what actually
// closes. One entry pushed, one entry consumed — no orphans (Emma #5).
//
// The labelled **Add an image** row is the ONE ADMISSION PATH for uploads (§4, Opus M8): exactly one
// section is ever on screen, so one row, one job, one latch. The desktop riders — a drop onto the
// panel, a paste — are the same entrance, not a second one: both hand their file to `upload.offer`.

export function GalleryModal({
  view,
  scope,
  busy,
  ready,
  write,
  upload,
  onFrame,
  onEdit,
  onClose,
}: {
  view: SectionView;
  scope: GalleryScope;
  busy: boolean;
  ready: boolean;
  write: {
    /** A SEAT's one write ("Use here") — the only pin left since "W6". */
    pin: (section: SectionView["section"], item: LibraryItem) => void;
    unpin: (section: SectionView["section"]) => void;
    /** Returns when the write has SETTLED — what the drag's held commit waits on (§7). The ↑/↓ buttons
     *  ignore it: their affordance is the disabled state `busy` already drives. */
    move: (section: SectionView["section"], item: LibraryItem, delta: number) => Promise<unknown>;
    moveToEdge: (
      section: SectionView["section"],
      item: LibraryItem,
      edge: "top" | "bottom",
    ) => void;
    toggleHidden: (section: SectionView["section"], item: LibraryItem) => void;
    remove: (section: SectionView["section"], item: LibraryItem) => Promise<void>;
    restoreDefaults: (section: SectionView["section"], ids: ReadonlySet<string>) => void;
  };
  upload: MediaUpload;
  /** Open the FRAMING sheet for one entry. Like the crop step, that sheet is a SIBLING of this dialog
   *  rather than a child (`MediaGallery` renders both) — a nested dialog would ride this one's keydown
   *  trap, so its Escape would close the gallery underneath it. Hence a callback rather than state. */
  onFrame: (item: LibraryItem) => void;
  /** Re-crop ONE entry's stored bytes ("W10"). Like the framing sheet and the crop step, the job lives
   *  a level above this dialog — it outlives the modal, and its crop step is a SIBLING of it. */
  onEdit: (item: LibraryItem) => void;
  onClose: () => void;
}) {
  const { section } = view;
  const labelId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const close = useOverlayBackGuard(true, onClose);
  /** The tile the detail panel was opened from, so leaving it lands back where the owner was. */
  const cameFrom = useRef<string | null>(null);

  // Capture the opening trigger, land focus inside, restore it on close — the ConfirmDialog/PromptModal
  // contract (F17), copied rather than reinvented.
  useEffect(() => {
    triggerRef.current = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    queueMicrotask(() => panel?.querySelector<HTMLElement>("button")?.focus());
    return () => {
      triggerRef.current?.focus?.();
      triggerRef.current = null;
    };
  }, []);

  // Focus can be ORPHANED by an ordinary action here: the control that had it (the detail panel's
  // back button, its Delete) stops existing the moment the panel closes, and the tile it came from can
  // disappear under it too when the authoritative refetch lands. Focus then falls to `document.body`,
  // OUTSIDE the panel — where Escape no longer reaches the backdrop's handler and Tab no longer cycles
  // the trap. So the trap re-lands it: on the tile the detail was opened from, else on the dialog.
  //
  // Runs on every render, and ONLY when focus is genuinely orphaned (`body`) — never when it merely
  // moved somewhere else, because the somewhere else is the confirm dialog this panel opens and
  // stealing focus back out of it would break the very flow it guards.
  useEffect(() => {
    // A task later, not this commit: `ConfirmDialog`'s own close restores focus to the trigger it
    // captured — a button this panel may have just unmounted — and that restore must not land after
    // ours.
    const at = setTimeout(() => {
      const panel = panelRef.current;
      const active = document.activeElement;
      if (panel === null || (active !== null && active !== document.body)) return;
      const label = cameFrom.current;
      const tile =
        label === null ? null : panel.querySelector<HTMLElement>(`[aria-label="${label}"]`);
      (tile ?? panel).focus();
    }, 0);
    return () => clearTimeout(at);
  });

  const rows = scopedRows(view.rows, scope);
  // WHAT IS LIVE IN THIS SCOPE, derived ONCE for everything on this screen — the grid's rings, the
  // detail panel's switch, and the reading line below (W8+).
  //
  // A KEY gallery is answered by the role's own per-key ladder, and a FAMILY role's section has no
  // resolver of its own to fall back on: its keys come from the live fleet, so there is one section
  // for the whole family and `active` on it would have to mean all of them at once. The grid was
  // therefore reading an empty answer and ringing nothing at all — the owner's "the ring shows what is
  // used" contract, silently broken in exactly the galleries where a file's binding is the least
  // obvious. A STATIC-key role (frontier's stack) is unaffected: its section carries
  // `activeForKey(key)` already, so this resolves the same answer through the same function.
  const active =
    scope.key !== undefined ? (view.activeForKey?.(scope.key) ?? view.active) : view.active;
  // `def.kind` is the ROLE's own fact, which is the one the duplicate arm needs: every section over a
  // `named` role — a key gallery, the family card, the unassigned bucket — asks "who claimed this
  // key", and no section over a pool does (a seat's `def` is its SOURCE role's, so it inherits the
  // right answer for free).
  const items = libraryItems(rows, active, section.def.kind === "named");
  const selected = items.find((i) => i.id === selectedId);
  const problems = items.filter((i) => i.row.unusable).length;
  // A pin naming nothing this seat's tier holds. By IDENTITY since "W9" — the pin says `{name}` or
  // `{bundled}`, so "is it here" is one comparison against the same ids the grid keys on. What the
  // NOTICE prints is the human half (`pinLabel`), never the `f:`/`b:` spelling.
  const danglingPin =
    section.pin !== undefined &&
    view.pinned !== undefined &&
    !view.rows.some((r) => rowId(r) === view.pinned?.id)
      ? view.pinned.label
      : undefined;
  const count = `${items.length} ${items.length === 1 ? "image" : "images"}${
    problems > 0 ? ` · ${problems} will not paint` : ""
  }`;
  /** How this destination uses what is in use — the header line's second half, or `undefined` where
   *  there is nothing honest to say (see `reading`). */
  const mode = reading(view, scope, active);
  // A section can only "restore" what it SHIPS, and only while the owner has said something about it.
  // A SEAT is excluded by the same fact that makes it a view: its one write is the pin, and clearing
  // that pin is the restore it already offers.
  //
  // "What it ships" is asked of THIS SCOPE, not of the role (design-lens NC1). The role's registry list
  // is the wrong question wherever a scope narrows it: the kit's `service-banners` role carries cosmos's
  // twelve-banner rotation, so every per-service KEY gallery of it passed a role-level test while
  // holding no bundled row of its own — offering a "Restore defaults" whose only reachable effect was
  // to switch the owner's banner off and put nothing back. The rows on screen answer it exactly.
  const restorable =
    section.caps.hidden &&
    rows.some((r) => r.bundled != null) &&
    scope.unassigned !== true &&
    defaultsRestorable(rows);

  return (
    <div
      className="pm-backdrop mgal-pm"
      onKeyDown={(e) => modalKeyDown(e, panelRef.current, close)}
    >
      <div
        className="pm mgal-modal"
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelId}
        // Focusable only PROGRAMMATICALLY (never a tab stop): the last-resort landing place when the
        // control focus was on has just been deleted — see the effect above.
        tabIndex={-1}
      >
        <div className="pm-head">
          {/* THE HEADER SAYS WHAT THIS SECTION IS AND WHAT IS IN IT, and nothing else does ("W10"). The
              body used to open with five stacked text blocks — the folder path, the role hint (verbatim
              on the card underneath), the reading sentence, the count and the restore explainer — so the
              owner scrolled past a paragraph to reach the pictures they came for. What survives is one
              line: the count, and how this destination uses what is in use.

              It stays the section's ONE `role="status"` live region (#12): a delete changes the count
              while the owner is looking somewhere else, and a second status would make "the live region"
              ambiguous to anything that goes looking for it (the grid's drag announcer is a bare
              `aria-live` for exactly that reason). `· saving…` rides it because it is the same fact
              about the same list. */}
          <div className="mgal-title">
            <h3 id={labelId}>{title(section, scope)}</h3>
            <p className="mgal-count" role="status">
              {count}
              {mode !== undefined && ` · ${mode}`}
              {busy && " · saving…"}
            </p>
          </div>
          <button className="pm-x" aria-label="Close" onClick={close}>
            <XIcon />
          </button>
        </div>
        {/* The DESKTOP riders (R54 §5.4): `preventDefault` on dragover is what makes an element a drop
            target at all, and a paste handler reading `clipboardData.files` gets "copy image → paste"
            for three lines. Neither costs anything on the phone, and both go through the same
            `offer` — one admission path, one latch. */}
        <div
          className="pm-body mgal-body"
          onDragOver={(e) => {
            if (!section.caps.upload) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = "copy";
          }}
          onDrop={(e) => {
            if (!section.caps.upload) return;
            e.preventDefault();
            upload.offer(e.dataTransfer.files[0]);
          }}
          onPaste={(e) => upload.offer(e.clipboardData.files[0])}
        >
          {/* ── ABOVE THE GRID: only the EXCEPTIONAL ("W10") ────────────────────────────────────────
              Three notices, and each one is a state the owner has to act on rather than a standing
              description: a job that failed, a pin naming nothing, a seat painting its built-in. Every
              sentence that was merely TRUE — the path, the hint, the reading — moved out of the way of
              the pictures (the header line above, the card underneath, the folder line below). */}
          {/* An ALERT, not a second status (Emma W10 #4): the header line above is the section's ONE
              `role="status"`, and a failure is the assertive kind of news anyway — it interrupts a job
              the owner started, rather than describing the list they are looking at. */}
          {upload.failure !== null && (
            <p className="mgal-fail" role="alert">
              <b>{failureTitle(upload.failure.phase)}</b> {upload.failure.message}
              {upload.failure.retry !== undefined && (
                <button type="button" className="mgal-act" onClick={upload.failure.retry}>
                  Try again
                </button>
              )}
              <button type="button" className="mgal-act" onClick={upload.dismiss}>
                Dismiss
              </button>
            </p>
          )}
          {/* A pin naming something the library no longer holds. The theme has already degraded to its
              own next rung, but the VALUE is still in config and nothing else on this screen can reach
              it — there is no tile to select. So the notice carries its own way out. */}
          {danglingPin !== undefined && (
            <p className="mgal-dangling">
              The bound image <b>{danglingPin}</b> is missing.
              <button type="button" className="mgal-act" onClick={() => write.unpin(section)}>
                Clear it
              </button>
            </p>
          )}
          {/* A SEAT's built-in default (S6). It is not a library row — it belongs to no role folder and
              has no config identity — so it sits ABOVE the grid rather than in it, with no tile
              actions: the way back to it is the unpin the detail panel already offers. Shown only
              while nothing is pinned, which is exactly when it is the answer. */}
          {section.builtin !== undefined && view.pinned === undefined && (
            <p className="mgal-builtin">
              <img src={section.builtin.url} alt="" loading="lazy" decoding="async" />
              <span>
                <b>Default</b>
                Nothing is bound here, so this is the picture the ladder ends on. Choose an image
                below to use that instead — clearing it brings this back.
              </span>
            </p>
          )}
          {/* ── THE GRID LEADS ("W10") ─────────────────────────────────────────────────────────────
              The pictures are what this screen is, and they are the first thing in it. */}
          {items.length === 0 ? (
            <p className="mgal-empty">
              {/* Promise only what is rendered (Emma W10 #3): a section with no Add row must not point
                  at one. The folder line below is the way in it can still name. */}
              {section.caps.upload ? (
                <>
                  Empty — use <b>Add an image</b> below.
                </>
              ) : (
                "Empty."
              )}
            </p>
          ) : selected !== undefined ? (
            <ItemDetail
              section={section}
              item={selected}
              pinned={view.pinned}
              busy={busy}
              ready={ready}
              canReorder={section.caps.reorder && items.length > 1}
              canPromote={section.caps.promote && items.length > 1}
              first={items[0]?.id === selected.id}
              last={items[items.length - 1]?.id === selected.id}
              onBack={() => setSelectedId(null)}
              onPin={() => write.pin(section, selected)}
              onUnpin={() => write.unpin(section)}
              onMove={(delta) => void write.move(section, selected, delta)}
              onMoveToEdge={(edge) => write.moveToEdge(section, selected, edge)}
              onToggleHidden={() => write.toggleHidden(section, selected)}
              onFrame={() => onFrame(selected)}
              onEdit={() => onEdit(selected)}
              jobBusy={upload.busy}
              onDelete={() => {
                void write.remove(section, selected);
                setSelectedId(null);
              }}
            />
          ) : (
            <LibraryGrid
              section={section}
              items={items}
              ready={ready}
              // ONE TAP on the tile's corner, through the very intent the detail panel's switch
              // enqueues (§6.5) — the queue is the one write chokepoint, and a second path to
              // `hidden` would be a second place for the tier rule to be got wrong. Absent where the
              // section has no In-use to give: a seat is a view.
              onToggleUse={
                section.caps.hidden ? (item) => write.toggleHidden(section, item) : undefined
              }
              // The SAME fact that shows the ↑/↓ pair in the detail panel (§7: both affordances, one
              // condition) — plus `ready`, because a drag whose write the queue would refuse is a drag
              // that snaps back for a reason the owner cannot see.
              //
              // …and NOT WHILE A WRITE IS IN FLIGHT. A drag encodes its drop as a RELATIVE delta
              // against the order it was picked up in, and the queue replays that delta at SEND: admit
              // a second gesture while the first move is still going and the tile lands beside a
              // neighbour the gesture never saw. The ↑/↓ pair is different by construction and keeps
              // its own behaviour — a ±1 step composes with whatever moved under it, which is exactly
              // what the queue's recompute is for.
              canReorder={section.caps.reorder && items.length > 1 && ready && !busy}
              // The subject is the item the GESTURE picked up, handed over rather than looked up again:
              // resolving `items[from]` here would read the order as it is at DROP time, and a write
              // that landed in between would make that a different row than the one under the finger
              // (Emma's S5 review #1). The drag produces a TARGET; the transform owns the tier rule
              // (§2.3 ③); and it is the very same `moveBy` intent the ↑/↓ buttons enqueue — recomputed
              // at send, one write path.
              onReorder={(item, from, to) => write.move(section, item, to - from)}
              onSelect={(item) => {
                cameFrom.current = item.bundled ? `${item.row.name} (default)` : item.row.file;
                setSelectedId(item.id);
              }}
            />
          )}
          {/* ── BELOW THE GRID: how to PUT SOMETHING IN IT ("W10") ─────────────────────────────────
              The three ways to change what is above, in the order they are reached for: the picker,
              the folder (the same library, over SSH), and the way back to what shipped. */}
          {section.caps.upload && (
            <>
              {/* HIDDEN, `accept`ed by explicit types, and NO `capture` (R54 §5.1/§5.4): both engines
                  already offer the camera in the chooser for an image accept list, and `capture`
                  would make the camera the only option. `input.value` is reset in the handler. */}
              <input
                ref={upload.inputRef}
                type="file"
                accept={UPLOAD_ACCEPT}
                hidden
                onChange={upload.onInputChange}
              />
              <button
                type="button"
                className="mgal-add"
                disabled={!upload.ready || upload.busy}
                onClick={upload.pick}
              >
                <span aria-hidden>＋</span> {upload.busy ? working(upload.phase) : "Add an image"}
                <small>
                  {upload.busy
                    ? "keep this open until it finishes"
                    : "a photo or a picture — you can crop it next"}
                </small>
              </button>
            </>
          )}
          {/* THE FOLDER, as the OTHER way in rather than as a fact about the section — one line doing
              the work of two ("W10"): the standalone path paragraph said where the files live without
              saying why the owner would care, and the empty state repeated the same instruction in
              words. An SSH drop is addressed by folder and nothing else, so the path itself stays
              verbatim; what changed is that it now reads as the sentence it always was.

              NOT on a ROTATION scope (Emma W10 #3): that gallery shows only the theme's bundled set —
              a file copied into the role folder binds by its own name and never joins this screen, so
              the instruction would be false exactly where the owner followed it. */}
          {scope.rotation !== true && (
            <p className="mgal-scope">
              <span className="path">
                {section.caps.upload ? "or copy" : "Copy"} .png/.jpg/.webp files into media/
                {section.ns}/{section.role}/
              </span>
            </p>
          )}
          {/* RESTORE DEFAULTS (S6) — shown only where this section HAS shipped art and the owner has
              said something about it (`defaultsRestorable`), so a section still exactly as it came
              carries no control at all. Scoped to what is on screen: a key gallery restores its own
              layer.

              Its explainer is GONE ("W10"): the confirm dialog this opens says the same two sentences,
              and saying them twice put a paragraph above the pictures to describe a button the owner
              had not pressed yet. */}
          {restorable && (
            <p className="mgal-restore">
              <button
                type="button"
                className="mgal-act"
                disabled={busy || !ready}
                onClick={() => {
                  void confirmRestore(section, () =>
                    write.restoreDefaults(section, new Set(items.map((i) => i.id))),
                  );
                }}
              >
                Restore defaults
              </button>
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

/** THE SECTION'S READING (the W8 council's F4) — how this destination uses the images that are in use,
 *  DERIVED from the resolver's own mode word rather than hand-written per role.
 *
 *  It is the sentence the gallery was missing: the tiles say which entries are in use and which one is
 *  active, and nothing on the screen said whether that meant one picture, a rotation or a whole set.
 *  Hand-writing it into each role's hint would have been the same claim in twenty places, drifting from
 *  the ladders the moment one changed — so it reads `active.mode`, which IS the resolver's answer.
 *
 *  A PHRASE rather than a sentence since "W10": it is the second half of the header's one status line
 *  (`8 images · dealt to machines in this order`) rather than a paragraph of its own above the grid.
 *  It stays this module's, deliberately un-shared with the card's own status line (`SectionCard#status`)
 *  — the two answer different questions of the same resolver: the card says what is live in the section
 *  ("all 3 shown", "1 active"), this says how the destination CONSUMES its set, and folding them would
 *  distort both to save one word.
 *
 *  `undefined` where there is nothing honest to say: a SEAT has no In-use and no order (its reading is
 *  the pin, and its own hint states the ladder), the UNASSIGNED bucket paints nowhere, and a role the
 *  registry never described has no ladder to speak for. */
function reading(view: SectionView, scope: GalleryScope, active: ActiveArt): string | undefined {
  const { section } = view;
  if (section.kind === "seat" || section.kind === "unassigned") return undefined;
  // Only where a resolver actually answers for what is ON SCREEN: a key gallery is answered by the
  // role's per-key ladder, everything else by the section's own. `active` is that answer, resolved by
  // the caller — the mode word this sentence reads and the ring the grid draws are one derivation.
  const answers =
    scope.key !== undefined ? view.activeForKey !== undefined : section.active !== undefined;
  if (!answers) return undefined;
  if (active.mode === "deal") return "dealt to machines in this order";
  if (active.mode === "all") return "every in-use image is shown, in this order";
  return "the first in-use image is the one shown";
}

/** The restore confirm (§6.5 — `requestConfirm`, the house pattern the delete uses). The sentence says
 *  the owner ruling of 2026-08-26 in the gallery's own words: the defaults become the selection, and
 *  the owner's own pictures go back to being what they were before they chose them — library members,
 *  switched off. Nothing is deleted, which is the half a "restore" most needs to promise. */
async function confirmRestore(
  section: SectionView["section"],
  onRestore: () => void,
): Promise<void> {
  const ok = await requestConfirm({
    title: `Restore the default images for ${section.title}?`,
    body: "The images that came with the app go back on top, in their original order and in use. Your own images stay in the library, switched off — nothing is deleted, and their focus points are untouched.",
    confirmLabel: "Restore",
  });
  if (ok) onRestore();
}

/** What the Add row says while a job runs. Per PHASE, because they take visibly different amounts of
 *  time on a phone and "working…" for four seconds reads as a hang. */
function working(phase: MediaUpload["phase"]): string {
  // `null` while the CROP step is open: the job holds the latch, but nothing is running — the app is
  // waiting for the owner, behind a modal that covers this row anyway.
  if (phase === null) return "Working…";
  if (phase === "guard") return "Opening the picture…";
  if (phase === "export") return "Preparing the image…";
  if (phase === "upload") return "Uploading…";
  if (phase === "replace") return "Saving the change…";
  return "Saving…";
}

/** The failure row's own heading — WHICH step failed, because the answer differs completely: a
 *  refused pick means choose another file, a failed upload means try again, a failed REPLACE means the
 *  stored picture is untouched (Emma W10 #2 — an edit is not an upload and must not borrow its copy),
 *  and a failed registration means the picture is already on the server. */
function failureTitle(phase: MediaUpload["phase"]): string {
  if (phase === "guard") return "That picture cannot be used —";
  if (phase === "export") return "The image could not be prepared —";
  if (phase === "upload") return "The upload did not finish —";
  if (phase === "replace") return "The change was not saved —";
  return "Uploaded, but not saved to the list —";
}

/** The dialog's own name. A section scoped to a KEY is titled by that key plus what a file of the role
 *  IS ("jellyfin — icon"), because one key source can feed two roles and "jellyfin" alone would name
 *  two different galleries. */
function title(section: SectionView["section"], scope: GalleryScope): string {
  if (scope.key === undefined) return section.title;
  return `${scope.key} — ${section.asset ?? section.role}`;
}
