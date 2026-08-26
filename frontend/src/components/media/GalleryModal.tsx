import { useEffect, useId, useRef, useState } from "react";

import { ItemDetail } from "./ItemDetail";
import { LibraryGrid } from "./LibraryGrid";
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
import { defaultsRestorable, type ActiveArt } from "../../lib/mediaLibrary";
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
  const items = libraryItems(rows, active, section.pin !== undefined);
  const selected = items.find((i) => i.id === selectedId);
  const problems = items.filter((i) => i.row.unusable).length;
  const danglingPin =
    section.pin !== undefined &&
    view.pinned != null &&
    view.pinned !== "" &&
    !view.rows.some((r) => r.name === view.pinned)
      ? view.pinned
      : undefined;
  const count = `${items.length} ${items.length === 1 ? "image" : "images"}${
    problems > 0 ? ` · ${problems} will not paint` : ""
  }`;
  // A section can only "restore" what it SHIPS, and only while the owner has said something about it.
  // A SEAT is excluded by the same fact that makes it a view: its one write is the pin, and clearing
  // that pin is the restore it already offers.
  const restorable =
    section.caps.hidden &&
    section.def.bundled.length > 0 &&
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
          <h3 id={labelId}>{title(section, scope)}</h3>
          <button className="pm-x" aria-label="Close" onClick={close}>
            ✕
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
          {upload.failure !== null && (
            <p className="mgal-fail" role="status">
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
          <p className="mgal-scope">
            <span className="path">
              media/{section.ns}/{section.role}/
            </span>
            {section.hint != null && <span className="mgal-hint">{section.hint}</span>}
            {/* What the In-use switches BUY here, in the gallery's own vocabulary — beside the role's
                own hint, never instead of it (the hint says what the pictures are for; this says how
                many of them are on screen at once). */}
            {reading(view, scope, active) !== undefined && (
              <span className="mgal-hint">{reading(view, scope, active)}</span>
            )}
          </p>
          {/* The header count is what keeps the tiles free of diagnostics text — and a live region,
              because a delete changes it while the owner is looking somewhere else (#12). */}
          <p className="mgal-count" role="status">
            {count}
            {busy && " · saving…"}
          </p>
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
          {section.builtin !== undefined && (view.pinned == null || view.pinned === "") && (
            <p className="mgal-builtin">
              <img src={section.builtin.url} alt="" loading="lazy" decoding="async" />
              <span>
                <b>Default</b>
                Nothing is bound here, so this is the picture the ladder ends on. Choose an image
                below to use that instead — clearing it brings this back.
              </span>
            </p>
          )}
          {/* RESTORE DEFAULTS (S6) — shown only where this section HAS shipped art and the owner has
              said something about it (`defaultsRestorable`), so a section still exactly as it came
              carries no control at all. Scoped to what is on screen: a key gallery restores its own
              layer. */}
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
              <small>
                Puts the default images on top and back in use. Your own images stay, switched off.
              </small>
            </p>
          )}
          {items.length === 0 ? (
            <p className="mgal-empty">
              Empty — use <b>Add an image</b> above, or copy .png/.jpg/.webp files into the folder.
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
        </div>
      </div>
    </div>
  );
}

/** THE SECTION'S READING (the W8 council's F4) — one sentence saying how this destination uses the
 *  images that are in use, DERIVED from the resolver's own mode word rather than hand-written per role.
 *
 *  It is the sentence the gallery was missing: the tiles say which entries are in use and which one is
 *  active, and nothing on the screen said whether that meant one picture, a rotation or a whole set.
 *  Hand-writing it into each role's hint would have been the same claim in twenty places, drifting from
 *  the ladders the moment one changed — so it reads `active.mode`, which IS the resolver's answer.
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
  if (active.mode === "deal") return "In-use images are dealt across the machines in this order.";
  if (active.mode === "all") return "Every in-use image is shown, in this order.";
  return "The first in-use image is the one shown.";
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
    body: "The images that came with the app go back on top, in their original order and in use. Your own images stay in the library, switched off — nothing is deleted, and their framing is untouched.",
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
  return "Saving…";
}

/** The failure row's own heading — WHICH step failed, because the answer differs completely: a
 *  refused pick means choose another file, a failed upload means try again, and a failed
 *  registration means the picture is already on the server. */
function failureTitle(phase: MediaUpload["phase"]): string {
  if (phase === "guard") return "That picture cannot be used —";
  if (phase === "export") return "The image could not be prepared —";
  if (phase === "upload") return "The upload did not finish —";
  return "Uploaded, but not saved to the list —";
}

/** The dialog's own name. A section scoped to a KEY is titled by that key plus what a file of the role
 *  IS ("jellyfin — icon"), because one key source can feed two roles and "jellyfin" alone would name
 *  two different galleries. */
function title(section: SectionView["section"], scope: GalleryScope): string {
  if (scope.key === undefined) return section.title;
  return `${scope.key} — ${section.asset ?? section.role}`;
}
