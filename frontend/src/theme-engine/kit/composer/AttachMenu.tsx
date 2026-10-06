import { useEffect, useRef, type KeyboardEvent } from "react";

import type { AttachController, AttachDoor } from "../../../hooks/useAttachments";
import { useOutsideDismiss } from "../../../hooks/useOutsideDismiss";
import { releaseComposerOverlay, useComposerOverlayOpen } from "../../../store/composerOverlay";

// THE CLIP'S TWO DOORS (ISS-47 ⓔ-images, owner-ruled 2026-10-06: "that's the usual thing all of these apps
// do" — the Telegram/WhatsApp/Signal clip opens a Gallery/File chooser). The clip no longer opens the
// picker itself; it opens this two-row menu:
//   • PHOTOS — an image-only MIME `accept`, which on Android is Chrome's OWN grid picker: multi-select, and
//     a picked file's real size. The generic picker a mixed list gets reports size 0 for a Downloads file,
//     and an image's in-page re-encode cannot read 0 bytes.
//   • FILES — today's mixed list: text, PDF, and the escape hatch for an image MediaStore does not index.
// Desktop gets the SAME menu — no browser sniffing (owner: "one code path"). It costs the field no width
// (the S6 F1 finding): the clip is still the only visible button, and the menu hovers above the composer.
//
// SHELL + SLOT, both reused. It claims the ONE composer overlay slot (`store/composerOverlay`, "attach"), so
// opening it closes the plan sheet / suggest popover / tools menu and vice versa. Its chrome IS the tools
// menu's: the element carries `.tools-sheet`, so the popover shell, the composer-anchored geometry, every
// skin's dress (§14.16), the perf-lite gate, the open/close slide and the overlay HANDOFF SNAP all apply
// with no rule restated — kit.css adds only the row glyph. Mounted per composer variant beside
// `<SuggestPopover>` (a positioned SIBLING of `.kit-composer`, like every composer overlay).
//
// Mount policy and a11y follow ToolsMenuSheet: the panel stays MOUNTED and toggles `.open` (so the close
// gets the slide too), and the closed panel is `inert` — out of tab order AND the a11y tree — never
// `aria-hidden` over focusable buttons. Like the tools panel it is a labelled REGION of plain buttons, not a
// `role="menu"`: that role would promise the arrow-key menu widget this deliberately is not.
//
// The ids are document-unique by the tools menu's rule: one composer is mounted at a time, and exactly one
// clip within it (the S6 rail/field placement).

/** The panel's id — the trigger's `aria-controls` and the outside-tap test. */
export const ATTACH_MENU_ID = "composer-attach";
/** The clip's id — counts as INSIDE for the outside tap (its own click toggles), and takes focus back. */
export const ATTACH_TRIGGER_ID = "composer-attach-trigger";

/** lucide `image` — the photos door. Inlined, not graduated to `icons.tsx` (one consumer). */
function PhotoGlyph() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="9" cy="9" r="2" />
      <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
    </svg>
  );
}

/** lucide `file` — the files door. */
function FileGlyph() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
      <path d="M14 2v4a2 2 0 0 0 2 2h4" />
    </svg>
  );
}

const DOORS: readonly { door: AttachDoor; glyph: () => React.JSX.Element }[] = [
  { door: "photos", glyph: PhotoGlyph },
  { door: "files", glyph: FileGlyph },
];

export function AttachMenu({ attach }: { attach: AttachController }) {
  const open = useComposerOverlayOpen("attach");
  const panelRef = useRef<HTMLDivElement>(null);
  // Hand the slot back on UNMOUNT (the tools menu's Codex round-2 rule): a layout swap drops this composer,
  // and a slot still naming "attach" would spring the menu open on the next mount. Owner-checked, so a
  // surface that displaced us keeps the slot.
  useEffect(() => () => releaseComposerOverlay("attach"), []);
  // LIGHT DISMISS — the shared hook (NavMenu, the tools menu): a pointer going down outside closes it and
  // still does its own job. The CLIP counts as inside: its click toggles, and a close on its pointerdown
  // would have that click re-open the menu.
  useOutsideDismiss(
    open,
    (t) =>
      !!panelRef.current?.contains(t) || !!document.getElementById(ATTACH_TRIGGER_ID)?.contains(t),
    () => releaseComposerOverlay("attach"),
  );
  // Focus the first door on open (NavMenu's rule): the panel sits BEFORE the composer in document order —
  // it is a positioned sibling above it — so without this a keyboard user would have to Shift+Tab back
  // through the whole bar to reach it. `preventScroll`: the panel is still mid-slide.
  useEffect(() => {
    if (open) panelRef.current?.querySelector("button")?.focus({ preventScroll: true });
  }, [open]);

  /** Close, and put focus back on the clip — the row it sat on is about to be inside an inert panel. */
  const close = (): void => {
    releaseComposerOverlay("attach");
    document.getElementById(ATTACH_TRIGGER_ID)?.focus();
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.key !== "Escape") return;
    e.preventDefault();
    close();
  };

  return (
    <div
      ref={panelRef}
      className={"tools-sheet attach-sheet" + (open ? " open" : "")}
      id={ATTACH_MENU_ID}
      role="region"
      aria-label="attach from"
      inert={!open}
      onKeyDown={onKeyDown}
    >
      {DOORS.map(({ door, glyph: Glyph }) => (
        <button
          key={door}
          type="button"
          className="tools-row"
          onClick={() => {
            // Close FIRST, then open the chooser — still inside the tap's user activation, which is what
            // lets `input.click()` open it at all.
            close();
            attach.pick(door);
          }}
        >
          <span className="attach-glyph">
            <Glyph />
          </span>
          <span className="tools-name">{door}</span>
        </button>
      ))}
    </div>
  );
}
