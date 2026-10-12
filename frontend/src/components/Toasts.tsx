import { dismissToast, type ToastAction, useToasts } from "../store/toast";

// Renders the transient activity-toast stack (action outcomes). Styling in themes/vapor/extras.css.
//
// F26 — toasts can carry an optional `action` button (e.g. "refresh" for the SW update prompt).
// The action's onClick stops propagation so the body-click dismiss handler doesn't also fire;
// the handler runs, then the toast is dismissed in the same gesture — unless the handler answers
// `false`, which keeps it (ISS-84: a refused Retry still holds its clip). Body taps anywhere else
// still dismiss (including for sticky toasts — a body tap is the "later, not now" gesture), EXCEPT on
// a `persist` toast, which only its own actions can end (ISS-84: a stray tap must not drop a clip).
// ISS-84 also adds a `secondary` pill beside `action`, rendered by the same one button below.

function ActionPill({ id, action }: { id: number; action: ToastAction }) {
  return (
    <button
      type="button"
      className="toast-action"
      onClick={(e) => {
        e.stopPropagation();
        if (action.onClick() !== false) dismissToast(id);
      }}
    >
      {action.label}
    </button>
  );
}

export function Toasts() {
  const toasts = useToasts();
  if (!toasts.length) return null;
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`toast ${t.kind}`}
          onClick={t.persist ? undefined : () => dismissToast(t.id)}
        >
          <span className="toast-text">{t.text}</span>
          {t.action && <ActionPill id={t.id} action={t.action} />}
          {t.secondary && <ActionPill id={t.id} action={t.secondary} />}
        </div>
      ))}
    </div>
  );
}
