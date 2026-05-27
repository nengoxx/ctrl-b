import { useEffect } from "react";

import { resolveConfirm, useConfirm } from "../store/confirm";

// The single confirm dialog host (Phase 2: gates shutdown). Driven by store/confirm's
// requestConfirm(); styling in theme/extras.css. Esc cancels, Enter confirms.

export function ConfirmDialog() {
  const req = useConfirm();

  useEffect(() => {
    if (!req) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") resolveConfirm(false);
      else if (e.key === "Enter") resolveConfirm(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [req]);

  if (!req) return null;

  return (
    <div className="modal-backdrop" onClick={() => resolveConfirm(false)}>
      <div className="modal" role="alertdialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <h3>{req.title}</h3>
        {req.body && <p>{req.body}</p>}
        <div className="row">
          <button className="cancel" onClick={() => resolveConfirm(false)}>
            {req.cancelLabel ?? "Cancel"}
          </button>
          <button
            className={"go" + (req.danger ? " danger" : "")}
            onClick={() => resolveConfirm(true)}
            autoFocus
          >
            {req.confirmLabel ?? "Confirm"}
          </button>
        </div>
      </div>
    </div>
  );
}
