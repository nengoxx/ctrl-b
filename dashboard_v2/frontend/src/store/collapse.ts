// Persisted collapse state for Conf sections (Phase 7c polish). A tiny localStorage-backed external
// store (same shape as store/ui.ts) so a section's collapsed/expanded choice survives reloads.
// Keyed by a stable section id; absent → use the caller's default (expanded).

import { useSyncExternalStore } from "react";

const KEY = "ctrlb.collapsed";

function load(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "{}") as Record<string, boolean>;
  } catch {
    return {};
  }
}

let state: Record<string, boolean> = load();
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

export function toggleCollapsed(id: string, current: boolean): void {
  state = { ...state, [id]: !current };
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* storage disabled — keep in-memory only */
  }
  emit();
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** `[collapsed, toggle]` for a section. `defaultCollapsed` is used until the user toggles it. */
export function useCollapsed(id: string, defaultCollapsed = false): [boolean, () => void] {
  const all = useSyncExternalStore(subscribe, () => state, () => state);
  const collapsed = id in all ? all[id] : defaultCollapsed;
  return [collapsed, () => toggleCollapsed(id, collapsed)];
}
