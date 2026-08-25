import { Switch } from "../Switch";
import type { LibraryItem } from "../../hooks/useMediaLibrary";
import { ADVISORIES, advisoriesOf, metaText, tileUrl } from "../../lib/mediaLibrary";
import { requestConfirm } from "../../store/confirm";
import type { MediaSection } from "../../theme-engine/mediaRegistry";

// The ITEM DETAIL panel (MEDIA_MANAGER_PLAN §6.4/§6.5) — everything about ONE library entry, and every
// action that acts on one. It exists because the alternative is diagnostics text on a 110px tile
// (R59 §11.6 ⑤): the grid keeps two corners and a count, and the words live here.
//
// The actions are CAPABILITY-GATED, never label-swapped: a seat can only pin ("Use here"), a library
// section can activate/reorder/hide/delete, the Unassigned bucket can only hide and delete. A bundled
// entry has NO delete at all — absent, not disabled, which is GNOME's rule and the honest one (a
// disabled control invites the owner to look for the way to enable it).
//
// Framing ("Set framing") is deliberately ABSENT until S4 builds the focal point. There is no stub, no
// disabled row: the plan's own instruction is not to fake what the next slice owns.

export function ItemDetail({
  section,
  item,
  pinned,
  busy,
  ready,
  canReorder,
  first,
  last,
  onBack,
  onActivate,
  onUnpin,
  onMove,
  onMoveToEdge,
  onHidden,
  onDelete,
}: {
  section: MediaSection;
  item: LibraryItem;
  /** The section's current pin value, when it writes one — what makes "Clear this pin" appear on the
   *  entry that holds it (a seat, or a pool whose own `slots` override is set). */
  pinned?: string;
  busy: boolean;
  ready: boolean;
  /** Order means something here AND this scope holds more than one entry to order. */
  canReorder: boolean;
  first: boolean;
  last: boolean;
  onBack: () => void;
  onActivate: () => void;
  onUnpin: () => void;
  onMove: (delta: number) => void;
  onMoveToEdge: (edge: "top" | "bottom") => void;
  onHidden: (hidden: boolean) => void;
  onDelete: () => void;
}) {
  const url = tileUrl(item.row, section);
  const badges = advisoriesOf(item.row, section.bounds);
  const seat = section.kind === "seat";
  // The entry this section's PIN names — the only one that can clear it, and the reason "Set as
  // active" disappears there (it is already the answer).
  const pinnedHere = section.pin !== undefined && pinned === item.row.name;
  return (
    <div className="mgal-detail">
      <button type="button" className="mgal-back" onClick={onBack}>
        ‹ All images
      </button>
      <div className="mgal-detail-art">
        {url !== undefined && <img src={url} alt="" decoding="async" />}
      </div>
      <h4 className="mgal-detail-name">{item.bundled ? item.row.name : item.row.file}</h4>
      <p className="mgal-detail-meta">
        {item.bundled ? "Bundled with the app" : metaText(item.row)}
        {/* WHICH rule bound this file, spelled out (§2.2): an upload sets the entry's `key`, an SSH
            drop binds by its stem, and the two are indistinguishable from the filename alone. */}
        {bindingNote(section, item)}
      </p>
      <div className="mgal-detail-badges">
        {item.hidden && <span className="badge dim">not in use</span>}
        {item.duplicate && <span className="badge dim">duplicate name</span>}
        {badges.map((code) => (
          <span className={"badge" + (ADVISORIES[code]?.bad ? " stale" : " dim")} key={code}>
            {/* The PROBED format rides the mismatch badge: the bytes are a jpeg however the name
                reads, and that is the whole of what the owner has to act on. */}
            {(ADVISORIES[code]?.text ?? code) +
              (code === "format-mismatch" && item.row.format != null
                ? ` (${item.row.format})`
                : "")}
          </span>
        ))}
      </div>
      {/* The duplicate's own sentence, with the TIE-BREAK in it (§2.3, Emma's S2 review #6). A badge
          alone says there is a clash; what the owner needs is which entry answers to the name and how
          to change that — and the answer is the same one rule everywhere here: the library's own
          order decides, so "Set as active" is the fix. */}
      {item.duplicate && <p className="mgal-detail-note">{duplicateNote(section, item)}</p>}

      <div className="mgal-actions">
        {section.caps.activate !== "none" && !pinnedHere && (
          <button type="button" className="mgal-act primary" disabled={!ready} onClick={onActivate}>
            {seat ? "Use here" : "Set as active"}
          </button>
        )}
        {pinnedHere && (
          <button type="button" className="mgal-act" disabled={!ready} onClick={onUnpin}>
            Clear this pin
          </button>
        )}
        {section.caps.hidden && (
          <label className="mgal-act-row">
            <span>In use</span>
            {/* The ONE `aria-checked` in this gallery (Emma #9) — a real switch for a real two-state
                setting, rather than a tile pretending to be one. */}
            <Switch
              on={!item.hidden}
              disabled={!ready}
              onToggle={() => onHidden(!item.hidden)}
              label={`In use — ${item.bundled ? item.row.name : item.row.file}`}
            />
          </label>
        )}
        {canReorder && (
          <div className="mgal-act-move">
            <button
              type="button"
              className="mgal-act"
              disabled={!ready || first}
              onClick={() => onMove(-1)}
            >
              ↑ Move up
            </button>
            <button
              type="button"
              className="mgal-act"
              disabled={!ready || last}
              onClick={() => onMove(1)}
            >
              ↓ Move down
            </button>
            <button
              type="button"
              className="mgal-act"
              disabled={!ready || first}
              onClick={() => onMoveToEdge("top")}
            >
              Move to top
            </button>
            <button
              type="button"
              className="mgal-act"
              disabled={!ready || last}
              onClick={() => onMoveToEdge("bottom")}
            >
              Move to bottom
            </button>
          </div>
        )}
        {/* Absent on a bundled entry rather than disabled (§6.6) — there is nothing on disk to delete. */}
        {section.caps.remove && !item.bundled && (
          <button
            type="button"
            className="mgal-act danger"
            disabled={busy || !ready}
            onClick={() => {
              void confirmDelete(item, onDelete);
            }}
          >
            Delete
          </button>
        )}
      </div>
    </div>
  );
}

/** The delete confirm (§6.5 — `requestConfirm`, no undo toast). The sentence names what goes and what
 *  survives: the file leaves the disk, the library keeps everything else, and whatever was next takes
 *  over in the same write. */
async function confirmDelete(item: LibraryItem, onDelete: () => void): Promise<void> {
  const ok = await requestConfirm({
    title: `Delete ${item.row.file}?`,
    body: item.active
      ? "It is in use — the next entry takes over. The file is removed from the server; this cannot be undone."
      : "The file is removed from the server. This cannot be undone.",
    confirmLabel: "Delete",
    danger: true,
  });
  if (ok) onDelete();
}

/** What the duplicate MEANS here, in the section's own terms. Two shapes share one note because they
 *  share one tie-break: a `named` role where two files claim one key, and a PIN-capable section where a
 *  file stem and a bundled id answer to the same name (§2.3's stem/id note — the `f:`/`b:` identities
 *  stay separate, but one pin VALUE can only reach one of them). */
function duplicateNote(section: MediaSection, item: LibraryItem): string {
  const pinned = section.pin !== undefined;
  const name = pinned || item.bundled ? item.row.name : (item.key ?? item.row.name);
  const what = pinned
    ? `Another entry here answers to the name “${name}”, so the pin can only reach one of them.`
    : `Another file here binds to “${name}” too.`;
  return `${what} The one the library lists FIRST is the one that answers — use “Set as active” on this entry to make it that one.`;
}

/** How this file found its destination — the wire's `key` field, or its own filename stem. Only said
 *  where it MEANS something: a pool assigns by position, and there is no binding to name. */
function bindingNote(section: MediaSection, item: LibraryItem): string {
  if (item.bundled || section.kind === "pool" || section.kind === "seat") return "";
  if (item.keyBound) return ` · bound by its key “${item.key ?? ""}”`;
  return ` · bound by its filename`;
}
