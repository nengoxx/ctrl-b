// Transient activity toasts (Phase 2 event surfacing). Dependency-free external store, same
// shape as store/ui.ts. Action outcomes push a toast; the <Toasts/> host renders + auto-dismisses.
//
// F26 — `opts` extends the API for *interactive* toasts: pass `action` to render an inline
// button (e.g. "refresh" for the SW update prompt), and/or `sticky: true` to skip the
// auto-dismiss timer (useful when the toast asks the user to choose, like the SW update).
// All existing call sites stay unchanged — `opts` is a third positional arg with a default
// of "no options," so `pushToast("foo", "ok")` still works exactly as before.

import { createStore } from "./createStore";

export type ToastKind = "ok" | "err" | "info";

/** Action button attached to a toast — renders as a small inline pill (see Toasts.tsx). `onClick` may
 *  answer `false` to KEEP its toast (ISS-84: a parked clip's Retry that is refused while the mic is busy
 *  must not destroy the clip it is holding); any other answer — `undefined` included, i.e. every
 *  action written before this — dismisses it, as it always has. */
export interface ToastAction {
  label: string;
  onClick: () => void | boolean;
}

export interface ToastOptions {
  /** Inline button; clicking it runs `onClick` and dismisses the toast (unless it answers `false`). */
  action?: ToastAction;
  /** A SECOND inline button beside `action`, same contract (ISS-84: the parked clip's Retry + Discard —
   *  two explicit choices, because the toast is holding something the owner said). */
  secondary?: ToastAction;
  /** Skip the auto-dismiss timer. The toast persists until tapped (body → dismiss, action → run+dismiss). */
  sticky?: boolean;
  /** Stronger than `sticky`: no timer AND no body-tap dismiss — only an action ends it (ISS-84: a stray
   *  tap in a moving car must not destroy a parked clip; Discard is the explicit way to drop it). */
  persist?: boolean;
}

export interface Toast {
  id: number;
  kind: ToastKind;
  text: string;
  action?: ToastAction;
  secondary?: ToastAction;
  sticky?: boolean;
  persist?: boolean;
}

const TTL_MS = 3200;

const { emit, useStore } = createStore();
let toasts: Toast[] = [];
let seq = 0;

export function pushToast(text: string, kind: ToastKind = "info", opts?: ToastOptions): void {
  const id = ++seq;
  toasts = [
    ...toasts,
    {
      id,
      kind,
      text,
      action: opts?.action,
      secondary: opts?.secondary,
      sticky: opts?.sticky,
      persist: opts?.persist,
    },
  ];
  emit();
  if (!opts?.sticky && !opts?.persist) {
    setTimeout(() => dismissToast(id), TTL_MS);
  }
}

export function dismissToast(id: number): void {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

export function useToasts(): Toast[] {
  return useStore(() => toasts);
}
