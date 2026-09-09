import { useId, useRef } from "react";

import { DeleteIcon, UseIcon } from "./icons";
import type { LibraryItem } from "../../hooks/useMediaLibrary";
import { tileUrl } from "../../lib/mediaLibrary";
import type { MediaSection } from "../../theme-engine/mediaRegistry";
import { useDragReorder } from "../useDragReorder";

// The library GRID (MEDIA_MANAGER_PLAN §6.3, R59 §11.3) — three columns of destination-shaped tiles,
// and the ONE place a library row becomes a picture.
//
// Everything a tile can say, it says in a CORNER, and each corner means one thing (R59's explicit
// anti-recommendation: never share a corner without a priority rule):
//   · bottom-end   = the IN-USE toggle — a real button, one tap, tick on / hollow ring off;
//   · top-end      = a PROBLEM — the file will not paint, or another file already took its name;
//                    …or, where no problem can arise, the DELETE corner (see `onRemove`);
//   · bottom-start = ORIGIN — the "Default" chip, so "why can I not delete this one" is answered
//                    before the owner asks.
// The ACTIVE entry — the one the section's §2.4 resolver says is painted right now — wears an accent
// RING on the tile itself rather than a corner, because it is a fact about the whole picture and
// because the corners were full. Diagnostics TEXT never rides a 110px tile (R59 §11.6 ⑤): the count is
// in the header, the rest is in the detail panel a tap away.
//
// **THE TWO WORDS ARE DIFFERENT THINGS, and this is where the owner meets them** (owner ruling
// 2026-08-26): *in use* is MEMBERSHIP — the entry is part of what this destination may paint, which is
// what the corner toggles — and *active* is what is on screen right now, which order decides. A
// first-wins section has one active entry among however many are in use; a dealt one has several.
//
// **The corner is a SIBLING of the tile, never a child** (HTML forbids a button inside a button, and
// the tile is a plain detail-opening button by the Emma #9 ruling — `aria-checked` stays off it). That
// also settles the gesture: `useDragReorder`'s press activation is bound to the TILE's own
// `onPointerDown`, so a press that starts on the corner reaches no drag handler at all and can never
// lift a tile the owner meant to switch off.
//
// **Decode budget** (Opus M3). The grid paints ORIGINALS — there are no server-side thumbnails by
// ruling — and a library only grows, so the cost of arriving at a section has to be bounded by
// something other than hope: `loading="lazy"` + `decoding="async"` on every tile, `content-visibility:
// auto` on the cell (kit.css) so off-screen tiles are not laid out or painted at all, and the eager
// budget below capping how many decodes can be in flight from the first frame.

/** How many tiles decode EAGERLY on open. Everything past it is lazy, so at most this many full-size
 *  decodes are ever in flight at once from a cold open — which is the in-flight cap the design asks
 *  for, expressed in the one currency the platform actually gives us (the browser will not start a
 *  lazy image before it is near the viewport). Nine is three rows: the phone's first screenful. */
const EAGER_TILES = 9;

export function LibraryGrid({
  section,
  items,
  ready,
  canReorder = false,
  onSelect,
  onToggleUse,
  onRemove,
  onReorder,
  describeItem = describe,
}: {
  section: MediaSection;
  items: LibraryItem[];
  /** The write path can compute a patch (the settings snapshot has landed). The corner toggle is
   *  disabled without it, for the reason every other affordance is: a write with nothing authoritative
   *  to recompute from is refused, and a control that silently does nothing is worse than a dim one. */
  ready: boolean;
  /** Order MEANS something here, and there is more than one entry to order (§7 — the drag and the ↑/↓
   *  pair are hidden by the same fact, in the same breath). */
  canReorder?: boolean;
  onSelect: (item: LibraryItem) => void;
  /** What ONE tile says to a screen reader. Absent ⇒ the gallery's own vocabulary (`describe` below).
   *
   *  It is a parameter because the vocabulary is the SCREEN's, not the grid's (the wave-2 review's F2):
   *  *active · in use · not in use* are answers about what a destination PAINTS, and a picker is not
   *  asking that — its tiles are a choice, and announcing "in use" over a library the owner is picking
   *  FROM contradicts the very binding they are about to make. The visual half was already per-consumer
   *  by construction (the corners and the ring are drawn from what the caller passes); this makes the
   *  spoken half match. */
  describeItem?: (item: LibraryItem) => string;
  /** One tap on the corner — membership, through the same queued `setHidden` intent the detail panel's
   *  switch enqueues. Absent where the section has no In-use to give (a seat). */
  onToggleUse?: (item: LibraryItem) => void;
  /** Delete this file — the TOP-END corner, and the affordance-by-presence contract again: absent ⇒ no
   *  corner at all, which is what keeps this grid generic.
   *
   *  **Only `LibraryPicker` passes it, and the gallery must not** (D70 §13-S6b wave-3 feel round). The
   *  corner grammar above gives top-end to a PROBLEM, and in the manage screen a problem really can
   *  arise — so there the delete verb stays in the detail panel's pill and the top corner stays the
   *  problem badge. A PICKER is handed only rows that are shown and usable, and it builds its items
   *  un-`named`, so neither half of `problem` (`row.unusable`, `duplicate`) can be true there: the
   *  corner is free, and the two uses can never collide.
   *
   *  ABSENT, NOT DISABLED, on both rungs — the GNOME rule the delete verb already follows in
   *  `ItemDetail`: the CALLER hands this only where `section.caps.remove`, and the grid draws no corner
   *  on a `bundled` item (there is nothing on disk to delete). Same predicate, split across the two
   *  places that each know their own half of it. */
  onRemove?: (item: LibraryItem) => void;
  /** Commit a drag. The subject arrives as the ITEM that was picked up, not as an index to look up
   *  again — an index is only a name for a row while the order holds still (Emma's S5 review #1). The
   *  returned promise is what the HELD commit waits on: the tile stays where the owner dropped it until
   *  the authoritative order lands, and snaps back if the write is refused. */
  onReorder?: (item: LibraryItem, from: number, to: number) => Promise<unknown> | void;
}) {
  const descId = useId();
  /** WHAT is being dragged, resolved once when the gesture takes hold. The hook aborts an in-flight
   *  gesture the moment the rendered order changes, so this can never disagree with `from` — capturing
   *  it is how that stays true by construction rather than by argument. */
  const picked = useRef<LibraryItem | null>(null);
  // THE DRAG (MEDIA_MANAGER_PLAN §7 / R58) — the house hook in its GRID + PRESS shape: three columns, so
  // the insertion slot is reading order rather than a column of midpoints, and the tile is its own
  // handle, so touch activates on a long press and a swipe still scrolls the grid. The ↑/↓ + move-to-edge
  // pair in the detail panel stays exactly where it was: this is the primary gesture, not the only one.
  //
  // `orderKey` is both halves of "the list moved under us": the FIRST render carrying a different order
  // releases a held transform, and it ABORTS a gesture still in flight — a same-length reorder from an
  // interleaved write is invisible to the count check, and the frozen rects would be describing a list
  // nobody is looking at any more.
  const drag = useDragReorder(
    items.length,
    (from, to) => {
      const item = picked.current;
      return item === null ? undefined : onReorder?.(item, from, to);
    },
    {
      axis: "grid",
      activation: "press",
      disabled: !canReorder || onReorder === undefined,
      orderKey: items.map((i) => i.id).join(" "),
      onPick: (i) => {
        picked.current = items[i] ?? null;
      },
    },
  );
  return (
    <>
      <ul
        className="mgal-grid"
        style={{ ["--mgal-tile-aspect" as string]: String(section.aspect ?? 1) }}
      >
        {items.map((item, i) => {
          const url = tileUrl(item.row, section);
          const problem = item.row.unusable || item.duplicate;
          const name = item.bundled ? item.row.name : item.row.file;
          return (
            <li key={item.id} className="mgal-cell" {...drag.rowProps(i)}>
              <button
                type="button"
                {...drag.handleProps(i)}
                // The tile is a plain button that opens this item's detail — never a toggle (Emma #9):
                // `aria-checked` belongs to the real In-use SWITCH in that panel, and membership is
                // something the description says rather than something a role pretends to model.
                className={"mgal-tile" + (item.active ? " on" : "") + (item.hidden ? " off" : "")}
                aria-label={item.bundled ? `${item.row.name} (default)` : item.row.file}
                aria-describedby={`${descId}-${i}`}
                // Only where ONE entry genuinely wins. A dealt pool has no current member.
                aria-current={item.current ? "true" : undefined}
                onClick={() => onSelect(item)}
              >
                {url === undefined ? (
                  <span className="mgal-tile-none" aria-hidden />
                ) : (
                  <img
                    src={url}
                    alt=""
                    loading={i < EAGER_TILES ? "eager" : "lazy"}
                    decoding="async"
                    // Defect #9: alpha art on a dark tile was invisible. `contain` (never `cover`) keeps
                    // a silhouette whole, and the checkerboard behind it is what makes transparency READ
                    // as transparency instead of as a missing picture.
                    className={"mgal-tile-img" + (item.hidden ? " dim" : "")}
                  />
                )}
                {problem && (
                  <span className="mgal-corner top" aria-hidden>
                    !
                  </span>
                )}
                {item.bundled && <span className="mgal-corner start">Default</span>}
                <span className="mgal-sr" id={`${descId}-${i}`}>
                  {describeItem(item)}
                </span>
              </button>
              {/* THE DELETE CORNER, outside the tile button for the same two reasons the In-use one is
                  (invalid HTML, and a press that starts here must reach no drag handler). It is a plain
                  button with no state to press: one tap, then the caller's confirm. */}
              {onRemove !== undefined && !item.bundled && (
                <button
                  type="button"
                  className="mgal-del"
                  aria-label={`Delete ${name}`}
                  // The same gate the In-use corner takes: a write with nothing authoritative to
                  // recompute from is refused, and the cleanup half of a delete is exactly that write.
                  disabled={!ready}
                  onClick={() => onRemove(item)}
                >
                  <DeleteIcon size={12} />
                </button>
              )}
              {/* THE IN-USE TOGGLE, outside the tile button. `aria-pressed` rather than `aria-checked`:
                  the one `checked` control in this gallery is the detail panel's real Switch (Emma #9),
                  and a pressed-state button is what a two-state icon control IS. */}
              {onToggleUse !== undefined && (
                <button
                  type="button"
                  className={"mgal-use" + (item.hidden ? "" : " on")}
                  aria-pressed={!item.hidden}
                  aria-label={`In use — ${name}`}
                  disabled={!ready}
                  onClick={() => onToggleUse(item)}
                >
                  {/* Sized to the 24px disc "W7" trimmed it to — the glyph keeps the same air around
                      it that it had at 30px, and the disc's `::after` is what keeps the TARGET big. */}
                  <UseIcon on={!item.hidden} size={12} />
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {/* Where the drag SAYS what it did. The gesture is a pointer one, but a pointer user with a screen
          reader is a real reader of this — and the commit announcement is the one the field usually
          swallows (R58 G10). */}
      {/* `aria-live` WITHOUT `role="status"` — the same shape SectionRefEditor's region has, and for a
          reason beyond consistency: the header count above is the section's one `status`, and a second
          one would make "the live region" ambiguous to anything that goes looking for it. */}
      <p className="mgal-sr" aria-live="polite">
        {drag.announce}
      </p>
    </>
  );
}

/** What a tile SAYS to a screen reader, on the gallery's one vocabulary (owner ruling 2026-08-26):
 *  **active** = what this destination is painting right now · **in use** = a member of what it may
 *  paint · **not in use** = switched off. The old middle state read "in the library, not in use",
 *  which was the same words as the OFF state plus a preamble — the two that most needed telling apart
 *  were the two that sounded alike. */
function describe(item: LibraryItem): string {
  const parts: string[] = [];
  parts.push(item.active ? "active" : item.hidden ? "not in use" : "in use");
  if (item.bundled) parts.push("default");
  if (item.row.unusable) parts.push("will not paint");
  if (item.duplicate) parts.push("another file already took this name");
  return parts.join(" · ");
}
