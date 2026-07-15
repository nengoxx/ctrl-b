// Cosmos manual-selection state (Cosmos C2a-fix). The owner's directive: cosmos uses MANUAL selection
// only — no auto-cycle. It deliberately does NOT read the global featured-host carousel (`store/fleet`'s
// `featured` / `useFleetCycle`), which auto-advances every few seconds; cosmos simply ignores it and tracks
// its own selected host here. Keyed by host ID (stable across polls/reorders), null = nothing selected.
//
// STORE-BACKED (the dep-free `createStore` factory, D23) so it survives re-renders/theme state like the
// fleet store, and so the moon (deselect) and a planet (select) share one source of truth. Camera
// zoom-follow (C2b) + the bottom sheet (C3) will read this same selection.

import { createStore } from "./createStore";

const { emit, useStore } = createStore();
let selectedId: string | null = null;

/** Set (or clear, with null) the selected host id. Idempotent — only emits on a real change. */
export function setCosmosSelection(id: string | null): void {
  if (id !== selectedId) {
    selectedId = id;
    emit();
  }
}

/** The selected host id (null = none). */
export function useCosmosSelection(): string | null {
  return useStore(() => selectedId);
}

/**
 * Neighbor of `current` in `ids`, stepping `dir` (+1 next / -1 prev) with WRAP-AROUND (the orbit is a
 * circle, so last→first and first→last). `current` missing/null → the first id (a safe fallback so the
 * chevrons always do something); empty `ids` → null. PURE — used by the host-sheet chevrons; ordering is
 * the CALLER's render order (CosmosFleet passes the same `hosts` array the planets are placed from).
 */
export function stepId(ids: string[], current: string | null, dir: 1 | -1): string | null {
  if (ids.length === 0) return null;
  const i = current == null ? -1 : ids.indexOf(current);
  if (i === -1) return ids[0]; // null / not-in-list → first (safe fallback)
  return ids[(i + dir + ids.length) % ids.length];
}
