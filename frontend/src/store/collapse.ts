// Persisted collapse state for Conf sections (Phase 7c polish). A tiny localStorage-backed external
// store (same shape as store/ui.ts) so a section's collapsed/expanded choice survives reloads.
// Keyed by a stable section id; absent → use the caller's default (expanded).

import { createStore } from "./createStore";
import { loadPersisted, savePersisted } from "./persist";

const KEY = "ctrlb.collapsed";

const { emit, useStore } = createStore();
let state: Record<string, boolean> = loadPersisted(KEY, {});

export function toggleCollapsed(id: string, current: boolean): void {
  setCollapsed(id, !current);
}

/** Set a section's collapsed state directly (idempotent; no-op emit when unchanged). Used by the hosted
 *  utils group's scroll-to-group handoff (D35 §F0) to FORCE-EXPAND before scrolling — a plain `toggle` can't
 *  guarantee the open state when the current value is unknown. */
export function setCollapsed(id: string, collapsed: boolean): void {
  if (state[id] === collapsed) return;
  state = { ...state, [id]: collapsed };
  savePersisted(KEY, state);
  emit();
}

/** `[collapsed, toggle]` for a section. `defaultCollapsed` is used until the user toggles it. */
export function useCollapsed(id: string, defaultCollapsed = false): [boolean, () => void] {
  const all = useStore(() => state);
  const collapsed = id in all ? all[id] : defaultCollapsed;
  return [collapsed, () => toggleCollapsed(id, collapsed)];
}
