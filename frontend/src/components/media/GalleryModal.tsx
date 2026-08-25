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
import { modalKeyDown } from "../../lib/focusTrap";

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
// The labelled **Add an image** row is PRESENT AND INERT. Uploading is S3b's slice; a row that looked
// live and did nothing would be worse than a row that says when it arrives, and hiding it entirely
// would hide the layout the next slice lands in.

export function GalleryModal({
  view,
  scope,
  busy,
  ready,
  write,
  onClose,
}: {
  view: SectionView;
  scope: GalleryScope;
  busy: boolean;
  ready: boolean;
  write: {
    activate: (section: SectionView["section"], item: LibraryItem) => void;
    unpin: (section: SectionView["section"]) => void;
    move: (section: SectionView["section"], item: LibraryItem, delta: number) => void;
    moveToEdge: (
      section: SectionView["section"],
      item: LibraryItem,
      edge: "top" | "bottom",
    ) => void;
    setHidden: (section: SectionView["section"], item: LibraryItem, hidden: boolean) => void;
    remove: (section: SectionView["section"], item: LibraryItem) => Promise<void>;
  };
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
  const items = libraryItems(rows, view.active);
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
        <div className="pm-body mgal-body">
          {section.caps.upload && (
            <button type="button" className="mgal-add" disabled aria-disabled="true">
              <span aria-hidden>＋</span> Add an image
              <small>uploading arrives in the next slice — copy files in over SSH for now</small>
            </button>
          )}
          <p className="mgal-scope">
            <span className="path">
              media/{section.ns}/{section.role}/
            </span>
            {section.hint != null && <span className="mgal-hint">{section.hint}</span>}
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
              The pinned image <b>{danglingPin}</b> is missing.
              <button type="button" className="mgal-act" onClick={() => write.unpin(section)}>
                Clear the pin
              </button>
            </p>
          )}
          {items.length === 0 ? (
            <p className="mgal-empty">
              Empty — copy .png/.jpg/.webp files into the folder above, or use Add an image once it
              lands.
            </p>
          ) : selected !== undefined ? (
            <ItemDetail
              section={section}
              item={selected}
              pinned={view.pinned}
              busy={busy}
              ready={ready}
              canReorder={section.caps.reorder && items.length > 1}
              first={items[0]?.id === selected.id}
              last={items[items.length - 1]?.id === selected.id}
              onBack={() => setSelectedId(null)}
              onActivate={() => write.activate(section, selected)}
              onUnpin={() => write.unpin(section)}
              onMove={(delta) => write.move(section, selected, delta)}
              onMoveToEdge={(edge) => write.moveToEdge(section, selected, edge)}
              onHidden={(hidden) => write.setHidden(section, selected, hidden)}
              onDelete={() => {
                void write.remove(section, selected);
                setSelectedId(null);
              }}
            />
          ) : (
            <LibraryGrid
              section={section}
              items={items}
              onSelect={(item) => {
                cameFrom.current = item.bundled ? `${item.row.name} (bundled)` : item.row.file;
                setSelectedId(item.id);
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}

/** The dialog's own name. A section scoped to a KEY is titled by that key plus what a file of the role
 *  IS ("jellyfin — icon"), because one key source can feed two roles and "jellyfin" alone would name
 *  two different galleries. */
function title(section: SectionView["section"], scope: GalleryScope): string {
  if (scope.key === undefined) return section.title;
  return `${scope.key} — ${section.asset ?? section.role}`;
}
