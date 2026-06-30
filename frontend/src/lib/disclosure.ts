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
  return {
    role: "button" as const,
    tabIndex: 0,
    "aria-expanded": open,
    onClick: onToggle,
    onKeyDown: (e: KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onToggle();
      }
    },
  };
}
