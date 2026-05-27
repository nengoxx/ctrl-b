// Transient activity toasts (Phase 2 event surfacing). Dependency-free external store, same
// shape as store/ui.ts. Action outcomes push a toast; the <Toasts/> host renders + auto-dismisses.

import { useSyncExternalStore } from "react";

export type ToastKind = "ok" | "err" | "info";

export interface Toast {
  id: number;
  kind: ToastKind;
  text: string;
}

const TTL_MS = 3200;

let toasts: Toast[] = [];
let seq = 0;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

export function pushToast(text: string, kind: ToastKind = "info"): void {
  const id = ++seq;
  toasts = [...toasts, { id, kind, text }];
  emit();
  setTimeout(() => dismissToast(id), TTL_MS);
}

export function dismissToast(id: number): void {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function useToasts(): Toast[] {
  return useSyncExternalStore(
    subscribe,
    () => toasts,
    () => toasts,
  );
}
