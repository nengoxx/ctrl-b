// Frontier manual-selection state (F2). Clones the cosmos manual-selection pattern verbatim (the owner's
// directive for the bespoke fleets): frontier uses MANUAL selection only — it deliberately does NOT read the
// global featured-host carousel (`store/fleet`'s `featured`/`useFleetCycle`, which auto-advances). Keyed by
// host ID (stable across polls/reorders), null = nothing selected.
//
// STORE-BACKED (the dep-free `createStore` factory, D23) — NOT component state — for the SAME reason cosmos
// is: F2 makes the beacon ↔ rig-card selection two-way (both read/write this one source of truth), and F3's
// bottom sheet will read this SAME store to know which rig is open. One store, no prop-drilling across the
// map/grid/sheet.

import { createStore } from "./createStore";

const { emit, useStore } = createStore();
let selectedId: string | null = null;

/** Set (or clear, with null) the selected host id. Idempotent — only emits on a real change. */
export function setFrontierSelection(id: string | null): void {
  if (id !== selectedId) {
    selectedId = id;
    emit();
  }
}

/** The selected host id (null = none). */
export function useFrontierSelection(): string | null {
  return useStore(() => selectedId);
}
