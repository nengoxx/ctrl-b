// Cosmos moon-dive state (minimal-nav Slice 2a). Tapping the central moon "dives" the camera INTO it (a
// center-zoom flourish) while the orbital stage fades, then navigates to the Agent chat — the same camera
// machinery the planets use on select, just targeting the system center where the moon sits.
//
// STORE-BACKED (the dep-free `createStore` factory, D23) — like `cosmosSelection` — so the moon (the trigger,
// in CosmosMoon) and CosmosFleet (which owns the camera + the stage fade) share ONE source of truth without
// prop-drilling through the camera. `false` = at rest; `true` = mid-dive.

import { createStore } from "./createStore";

const { emit, useStore } = createStore();
let diving = false;

/** Begin/end the moon-dive. Idempotent — only emits on a real change. */
export function setCosmosDive(on: boolean): void {
  if (on !== diving) {
    diving = on;
    emit();
  }
}

/** Whether a moon-dive is in progress (CosmosFleet reads this to drive the camera + stage fade). */
export function useCosmosDive(): boolean {
  return useStore(() => diving);
}
