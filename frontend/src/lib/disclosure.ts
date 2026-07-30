import type { KeyboardEvent } from "react";

// Accessible disclosure toggle (D25). Spread onto a clickable row/header that expands/collapses content
// to make it keyboard-operable: the ARIA button pattern — announce it as a button, focusable, expose the
// expanded state, and handle Enter/Space (Space scrolls by default, so preventDefault). One source of
// truth so the project's several expand/collapse rows can't drift apart again.
//
//   <div className="conftitle" {...disclosureToggle(!collapsed, toggle)}> … </div>
//
// USE ONLY on a row WITHOUT nested interactive controls. A row that *contains* buttons/links must NOT
// become a `role="button"` (that re-creates the `nested-interactive` violation, WCAG 4.1.2); instead keep
// it a plain `<div onClick>` and give it a child toggle <button> — see `DeviceRow` / DECISIONS D25.
export function disclosureToggle(open: boolean, onToggle: () => void) {
  return { ...activation(onToggle), "aria-expanded": open };
}

// The ARIA button behaviour both helpers share — announce it as a button, make it focusable, and
// handle Enter/Space (Space scrolls by default, so preventDefault). Spelled once so the two row
// flavours below can never drift on the keyboard contract.
function activation(onActivate: () => void) {
  return {
    role: "button" as const,
    tabIndex: 0,
    onClick: onActivate,
    onKeyDown: (e: KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onActivate();
      }
    },
  };
}

/** The same keyboard-operable row for a header that OPENS A DIALOG (a sheet / modal) instead of
 *  expanding inline content: `aria-haspopup="dialog"` rather than `aria-expanded`, because the row
 *  never expands and announcing it as "collapsed" would be a lie. Same restriction as
 *  `disclosureToggle`: no nested interactive controls (A3 slice 3 / D25). */
export function dialogOpener(onOpen: () => void) {
  return { ...activation(onOpen), "aria-haspopup": "dialog" as const };
}
