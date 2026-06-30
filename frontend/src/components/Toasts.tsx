import { dismissToast, useToasts } from "../store/toast";

// Renders the transient activity-toast stack (action outcomes). Styling in theme/extras.css.
//
// F26 — toasts can carry an optional `action` button (e.g. "refresh" for the SW update prompt).
// The action's onClick stops propagation so the body-click dismiss handler doesn't also fire;
// the handler runs, then the toast is dismissed in the same gesture. Body taps anywhere else
// still dismiss (including for sticky toasts — a body tap is the "later, not now" gesture).

export function Toasts() {
  const toasts = useToasts();
  if (!toasts.length) return null;
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`} onClick={() => dismissToast(t.id)}>
          <span className="toast-text">{t.text}</span>
          {t.action && (
            <button
              type="button"
              className="toast-action"
              onClick={(e) => {
                e.stopPropagation();
                t.action!.onClick();
                dismissToast(t.id);
              }}
            >
              {t.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
