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
