import { useEffect, useId, useRef } from "react";

import { LibraryGrid } from "./LibraryGrid";
import { AddImageRow, UploadFailureRow } from "./UploadRow";
import { XIcon } from "../icons";
import type { MediaFile } from "../../hooks/useMedia";
import { libraryItems, type SectionView } from "../../hooks/useMediaLibrary";
import { useOverlayBackGuard } from "../../hooks/useOverlayBackGuard";
import type { MediaUpload } from "../../hooks/useMediaUpload";
import { modalKeyDown } from "../../lib/focusTrap";
import type { RowId } from "../../lib/mediaLibrary";

// THE LIBRARY IN **PICK MODE** (D70 §13-S6b wave 2) — one role's library, on the house dialog shell, for
// a surface that is CHOOSING a picture rather than managing one.
//
// It exists because the owner's round found the old binding row confusing, and because the answer the
// field is unanimous about is *image-as-button → the library* (SillyTavern, open-webui, LibreChat,
// Telegram, WhatsApp; Material and HIG say the same): tap the picture, get the pictures, put a new one in
// from inside the same screen, and take the binding off from inside it too. What it replaces is a thumb,
// a `choose` button that unfolded a hand-rolled tile strip, and two sibling pills.
//
// **It is a SIBLING of `GalleryModal`, not a mode of it** — and the split is the house pattern rather
// than a preference. The shell here (`.pm-backdrop`/`.pm` + `lib/focusTrap`'s Escape/Tab contract +
// `useOverlayBackGuard`) is the same shell PromptModal, the automations editor, the crop modal, the
// framing sheet and the gallery each compose for themselves — six consumers of shared primitives, no
// shared wrapper. What the two screens genuinely SHARE is what is imported above: the GRID (identical
// tiles, identical ring, identical decode budget) and the UPLOAD row (one admission path, one set of
// phase words). What they do not share is the whole manage half — the detail panel, the drag, the In-use
// corners, the delete, the restore, the dangling-pin and seat notices — none of which has any meaning in
// a pick, and every one of which would have become a `pick === undefined &&` in a component that is
// already the largest on this surface. RE-CROP stays a Conf-gallery job (§8.2's ruling): it re-encodes
// the file itself. FRAMING crossed over at wave 3 — see `onFrame` — because it is about the picture
// this binding paints and the owner asked to reach it from here; the SHEET is still the one framing UI.
//
// The rows it offers are the caller's: a BINDING must not point at an entry the owner switched off or at
// bytes the server cannot read, which is what `AgentArtRow` filters through the two shipped predicates
// before handing them here.

export function LibraryPicker({
  view,
  rows,
  current,
  title,
  ready,
  upload,
  onPick,
  onClear,
  onFrame,
  onClose,
}: {
  view: SectionView;
  /** The rows this picker may offer — already narrowed to what the caller can legally bind. */
  rows: readonly MediaFile[];
  /** The entry bound right now, as the identity the grid keys on; `null` = nothing bound. */
  current: RowId | null;
  /** The dialog's own name, in the CALLER's words ("Choose avatar") — a picker is named by what it is
   *  choosing FOR, not by the folder it is reading. */
  title: string;
  /** The write path can compute a patch — `LibraryGrid`'s own gate, passed through. */
  ready: boolean;
  upload: MediaUpload;
  /** Take this entry (the row's `file`). The caller closes. */
  onPick: (entry: string) => void;
  /** Bind nothing — offered ONLY while something is bound, which is the one state it can act on. */
  onClear: () => void;
  /** THE SECOND DOOR ON THE FRAMING SHEET (D70 §13-S6b wave 3, the owner's amendment to §8.2's
   *  framing-stays-in-Conf scoping) — absent ⇒ no such affordance, which is what keeps this component
   *  generic. It sits beside "Use no picture" and answers the same shape of question: it acts on the
   *  BINDING that is already made, so like that one it is offered only while there is one.
   *
   *  The sheet itself is still the sheet — one framing UI, opened from two places — and the caller
   *  mounts it as a SIBLING of this dialog, never inside it (an Escape in a nested overlay would ride
   *  this one's keydown trap and close the picker underneath it). */
  onFrame?: () => void;
  onClose: () => void;
}) {
  const { section } = view;
  const labelId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const close = useOverlayBackGuard(true, onClose);

  // Capture the opening trigger, land focus inside, restore it on close — the ConfirmDialog/PromptModal
  // contract (F17), the same twelve lines the gallery copies rather than reinventing.
  useEffect(() => {
    triggerRef.current = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    queueMicrotask(() => panel?.querySelector<HTMLElement>("button")?.focus());
    return () => {
      triggerRef.current?.focus?.();
      triggerRef.current = null;
    };
  }, []);

  // THE CURRENT BINDING IS THE "ACTIVE" ENTRY, said in the grid's own vocabulary rather than in a second
  // one: `libraryItems` takes an `ActiveArt` and marks exactly those ids, so the bound tile wears the
  // accent ring every gallery uses for "this is what is painted", and `aria-current` lands on it because
  // one entry genuinely wins. Nothing about the tile is picker-specific.
  const items = libraryItems(rows, {
    ids: current === null ? [] : [current],
    mode: "first",
  });

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
        tabIndex={-1}
      >
        <div className="pm-head">
          <div className="mgal-title">
            <h3 id={labelId}>{title}</h3>
            {/* The section's ONE live region, exactly as the gallery's header is: what is in here, and
                whether a job is writing. */}
            <p className="mgal-count" role="status">
              {items.length} {items.length === 1 ? "image" : "images"}
            </p>
          </div>
          <button className="pm-x" aria-label="Close" onClick={close}>
            <XIcon />
          </button>
        </div>
        {/* The DESKTOP riders, on the same admission path as the Add row below (R54 §5.4) — a drop and a
            paste hand their file to `offer`, which is the gallery's own entrance. */}
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
          <UploadFailureRow upload={upload} />
          {items.length === 0 ? (
            // Promise only what is rendered (Emma W10 #3), the gallery's own rule and its own sentence:
            // a section that cannot take an upload must not point at a row it does not have.
            <p className="mgal-empty">
              {section.caps.upload ? (
                <>
                  Empty — use <b>Add an image</b> below.
                </>
              ) : (
                "Empty."
              )}
            </p>
          ) : (
            <LibraryGrid
              section={section}
              items={items}
              ready={ready}
              // NO manage affordances, by ABSENCE rather than by a flag: the grid draws the In-use
              // corner and arms the drag only when handed the callbacks for them, so a picker that
              // passes neither gets tiles that do exactly one thing. Which is the whole contract here —
              // a tap IS the pick.
              onSelect={(item) => onPick(item.row.file)}
              // …and the tiles SPEAK the picker's vocabulary, not the gallery's (the wave-2 review's
              // F2). *active · in use · not in use* answer "what does this destination paint", which is
              // the manage screen's question; here the ring means THE ONE THIS AGENT IS BOUND TO and the
              // rest are choices — announcing "in use" over them would contradict the binding the tap is
              // about to make. The other three words the gallery can say cannot arise: the caller hands
              // this screen only rows that are shown and usable, and a pool has no key to shadow.
              describeItem={(item) => (item.active ? "selected" : "available")}
            />
          )}
          {section.caps.upload && <AddImageRow upload={upload} />}
          {/* THE WAY BACK TO NOTHING, and only while there is something to undo (the researched
              destructive row: present, last, and never offered against an empty binding). It reads
              "picture" rather than "remove": the file stays in the library — this unbinds it. */}
          {current !== null && (
            <p className="mgal-restore">
              {/* "Focus" is the app's word for this — the plainer one the owner chose over "framing"
                  in the media manager's S6 round — and it is the SAME sheet the gallery's own Focus
                  button opens, so it says the same thing in both places. */}
              {onFrame !== undefined && (
                <button type="button" className="mgal-act" onClick={onFrame}>
                  Focus
                </button>
              )}
              <button type="button" className="mgal-act" onClick={onClear}>
                Use no picture
              </button>
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
