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

/** Action button attached to a toast — renders as a small inline pill (see Toasts.tsx). */
export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastOptions {
  /** Inline button; clicking it runs `onClick` and dismisses the toast. */
  action?: ToastAction;
  /** Skip the auto-dismiss timer. The toast persists until tapped (body → dismiss, action → run+dismiss). */
  sticky?: boolean;
}

export interface Toast {
  id: number;
  kind: ToastKind;
  text: string;
  action?: ToastAction;
  sticky?: boolean;
}

const TTL_MS = 3200;

const { emit, useStore } = createStore();
let toasts: Toast[] = [];
let seq = 0;

export function pushToast(text: string, kind: ToastKind = "info", opts?: ToastOptions): void {
  const id = ++seq;
  toasts = [...toasts, { id, kind, text, action: opts?.action, sticky: opts?.sticky }];
  emit();
  if (!opts?.sticky) {
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
