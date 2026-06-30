// Fleet presentation state (D29 §14.2/§14.5) — the featured-host carousel + the expanded-row set.
// STORE-BACKED (not component useState) so it survives a theme switch and is shared across any
// presentation instances that render the fleet. The auto-advance ENGINE lives in `useFleetCycle`
// (hooks/useFleet) because it needs React-Query host data; it writes here via `featureAuto` and reads
// the hold via `holdRemainingMs`. User actions go through `feature`/`toggleRow`, which also "hold" the
// carousel (defer auto-advance) so a manual pick isn't cycled away.

import { createStore } from "./createStore";

// After a manual selection, hold the carousel this long before auto-advance resumes (owner: ~8s).
const HOLD_MS = 8000;

const { emit, useStore } = createStore();
let featured = 0;
let open: ReadonlySet<string> = new Set();
let holdUntil = 0;

/** Non-reactive snapshot, for the cycle engine. */
export function fleetState(): { featured: number; open: ReadonlySet<string> } {
  return { featured, open };
}

/** Auto-advance (the cycle engine) — sets the featured host WITHOUT touching the hold. */
export function featureAuto(i: number): void {
  if (i !== featured) {
    featured = i;
    emit();
  }
}

/** A user selection (a now-dot) — features a host + holds the carousel so it isn't advanced away. */
export function feature(i: number): void {
  featured = i;
  holdUntil = Date.now() + HOLD_MS;
  emit();
}

/** A user row tap — features + holds (like `feature`) AND toggles the row's expanded state. */
export function toggleRow(id: string, i: number): void {
  featured = i;
  holdUntil = Date.now() + HOLD_MS;
  const next = new Set(open);
  next.has(id) ? next.delete(id) : next.add(id);
  open = next;
  emit();
}

/** Milliseconds remaining on the manual hold (0 if not held). The cycle engine reschedules to this so
 *  the picked host holds a clean N seconds from the tap (no fixed-grid quantization). */
export function holdRemainingMs(): number {
  return Math.max(0, holdUntil - Date.now());
}

export function useFeatured(): number {
  return useStore(() => featured);
}

export function useOpenRows(): ReadonlySet<string> {
  return useStore(() => open);
}
