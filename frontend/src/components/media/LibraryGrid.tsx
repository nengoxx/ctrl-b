import { useId } from "react";

import type { LibraryItem } from "../../hooks/useMediaLibrary";
import { tileUrl } from "../../lib/mediaLibrary";
import type { MediaSection } from "../../theme-engine/mediaRegistry";

// The library GRID (MEDIA_MANAGER_PLAN §6.3, R59 §11.3) — three columns of destination-shaped tiles,
// and the ONE place a library row becomes a picture.
//
// Everything a tile can say, it says in a CORNER, and each corner means one thing (R59's explicit
// anti-recommendation: never share a corner without a priority rule):
//   · bottom-end   = IN USE — a check disc plus a 2px accent ring on the tile;
//   · top-end      = a PROBLEM — the file will not paint, or another file already took its name;
//   · bottom-start = ORIGIN — the bundled glyph, so "why can I not delete this one" is answered
//                    before the owner asks.
// Diagnostics TEXT never rides a 110px tile (R59 §11.6 ⑤): the count is in the header, the rest is in
// the detail panel a tap away.
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
  selectedId,
  onSelect,
}: {
  section: MediaSection;
  items: LibraryItem[];
  selectedId?: string;
  onSelect: (item: LibraryItem) => void;
}) {
  const descId = useId();
  return (
    <ul
      className="mgal-grid"
      style={{ ["--mgal-tile-aspect" as string]: String(section.aspect ?? 1) }}
    >
      {items.map((item, i) => {
        const url = tileUrl(item.row, section);
        const problem = item.row.unusable || item.duplicate;
        return (
          <li key={item.id}>
            <button
              type="button"
              // The tile is a plain button that opens this item's detail — never a toggle (Emma #9):
              // `aria-checked` belongs to the real In-use SWITCH in that panel, and membership is
              // something the description says rather than something a role pretends to model.
              className={
                "mgal-tile" +
                (item.active ? " on" : "") +
                (item.hidden ? " off" : "") +
                (item.id === selectedId ? " sel" : "")
              }
              aria-label={item.bundled ? `${item.row.name} (bundled)` : item.row.file}
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
                  // Defect #9: alpha art on a dark tile was invisible. `contain` (never `cover`) keeps a
                  // silhouette whole, and the checkerboard behind it is what makes transparency READ as
                  // transparency instead of as a missing picture.
                  className={"mgal-tile-img" + (item.hidden ? " dim" : "")}
                />
              )}
              {item.active && (
                <span className="mgal-corner end" aria-hidden>
                  ✓
                </span>
              )}
              {problem && (
                <span className="mgal-corner top" aria-hidden>
                  !
                </span>
              )}
              {item.bundled && (
                <span className="mgal-corner start" aria-hidden>
                  ◆
                </span>
              )}
              <span className="mgal-sr" id={`${descId}-${i}`}>
                {describe(item)}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** What a tile SAYS to a screen reader, and the only place membership is stated (Emma #9). */
function describe(item: LibraryItem): string {
  const parts: string[] = [];
  parts.push(item.active ? "in use" : item.hidden ? "not in use" : "in the library, not in use");
  if (item.bundled) parts.push("bundled");
  if (item.row.unusable) parts.push("will not paint");
  if (item.duplicate) parts.push("another file already took this name");
  return parts.join(" · ");
}
