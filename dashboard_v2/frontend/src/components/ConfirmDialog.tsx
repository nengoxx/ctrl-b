import { useEffect, useId, useRef, type KeyboardEvent } from "react";

import { resolveConfirm, useConfirm } from "../store/confirm";

// The single confirm dialog host (Phase 2: gates shutdown; now also remove-agent /
// remove-skill / remove-server via the editors). Driven by store/confirm's
// requestConfirm(); styling in theme/extras.css.
//
// F17 — focus management (UI_AUDIT.md §6c). The five fixes the audit called out:
//
// 1. Keydown listener is scoped to the modal backdrop div (NOT window) — keydown
//    bubbles from focused descendants, so an Enter pressed inside the Confirm
//    button still triggers, but Enter inside an unrelated textarea on the page
//    cannot. Fixes the "Enter in any focused field could accept the confirm" bug.
//
// 2. Focus trap: Tab / Shift+Tab cycle between Cancel ↔ Confirm. There are exactly
//    two focusable elements in this dialog, so we don't need a generic
//    "all focusable elements" query — two refs do it. If a third button is ever
//    added, swap to a generic querySelectorAll('button,[href],…') focusable scan.
//
// 3. On open, capture `document.activeElement` as the trigger and explicitly focus
//    the Confirm button. (autoFocus would also work on initial mount, but the
//    explicit pattern reads more clearly alongside the restoration logic.)
//
// 4. On close, restore focus to the captured trigger. The effect cleanup runs
//    AFTER the modal has unmounted from the DOM, so .focus() lands on the original
//    button (the shutdown / remove / etc. button that opened the dialog).
//
// 5. aria-labelledby / aria-describedby wire the h3 + p so screen readers announce
//    the title and body when focus enters the dialog. useId() gives stable,
//    SSR-safe ids that don't collide across simultaneous trees.
//
// What we deliberately did NOT add: `inert` on background content. The focus trap
// + the existing `aria-modal="true"` already prevent keyboard escape; adding inert
// would need either a portal or sibling-by-sibling tagging (fragile when new
// children are added to <App>). Easy to layer in later if a real need surfaces.

export function ConfirmDialog() {
  const req = useConfirm();
  const labelId = useId();
  const descId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const goRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);

  // Capture the opening trigger, move focus to Confirm, restore on close.
  useEffect(() => {
    if (!req) return;
    triggerRef.current = document.activeElement as HTMLElement | null;
    // Defer one tick so the dialog DOM is mounted before .focus() runs.
    queueMicrotask(() => goRef.current?.focus());
    return () => {
      // Cleanup fires after the modal has unmounted from the DOM — focus lands
      // on the original trigger button.
      triggerRef.current?.focus?.();
      triggerRef.current = null;
    };
  }, [req]);

  if (!req) return null;

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      resolveConfirm(false);
    } else if (e.key === "Enter") {
      e.preventDefault();
      resolveConfirm(true);
    } else if (e.key === "Tab") {
      // Two-element cycle: Cancel ↔ Confirm.
      e.preventDefault();
      const active = document.activeElement;
      const next = active === cancelRef.current ? goRef.current : cancelRef.current;
      next?.focus();
    }
  };

  return (
    <div className="modal-backdrop" onClick={() => resolveConfirm(false)} onKeyDown={onKeyDown}>
      <div
        className="modal"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={labelId}
        aria-describedby={req.body ? descId : undefined}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id={labelId}>{req.title}</h3>
        {req.body && <p id={descId}>{req.body}</p>}
        <div className="row">
          <button className="cancel" ref={cancelRef} onClick={() => resolveConfirm(false)}>
            {req.cancelLabel ?? "Cancel"}
          </button>
          <button
            className={"go" + (req.danger ? " danger" : "")}
            ref={goRef}
            onClick={() => resolveConfirm(true)}
          >
            {req.confirmLabel ?? "Confirm"}
          </button>
        </div>
      </div>
    </div>
  );
}
