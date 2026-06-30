// Persisted collapse state for Conf sections (Phase 7c polish). A tiny localStorage-backed external
// store (same shape as store/ui.ts) so a section's collapsed/expanded choice survives reloads.
// Keyed by a stable section id; absent → use the caller's default (expanded).

import { createStore } from "./createStore";
import { loadPersisted, savePersisted } from "./persist";

const KEY = "ctrlb.collapsed";

const { emit, useStore } = createStore();
let state: Record<string, boolean> = loadPersisted(KEY, {});

export function toggleCollapsed(id: string, current: boolean): void {
  state = { ...state, [id]: !current };
  savePersisted(KEY, state);
  emit();
}

/** `[collapsed, toggle]` for a section. `defaultCollapsed` is used until the user toggles it. */
export function useCollapsed(id: string, defaultCollapsed = false): [boolean, () => void] {
  const all = useStore(() => state);
  const collapsed = id in all ? all[id] : defaultCollapsed;
  return [collapsed, () => toggleCollapsed(id, collapsed)];
}
