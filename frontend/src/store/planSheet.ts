// Composer plan-sheet open/closed state. The plan pill (in the composer's controls row) and the plan sheet
// (the frosted panel that peeks up from the composer's top edge) are mounted in DIFFERENT DOM locations but
// share this ONE flag — so neither needs a common parent holding state, and toggling the sheet never
// re-renders the app shell (the pill/sheet self-subscribe; see kit/composer/plan). Dep-free `createStore`
// (D23), exactly like `cosmosDive`. `false` = collapsed.

import { createStore } from "./createStore";

const { emit, useStore } = createStore();
let open = false;

/** Open/close (or, with no arg, toggle) the composer plan sheet. Idempotent — only emits on a real change. */
export function setPlanSheetOpen(next?: boolean): void {
  const value = next ?? !open;
  if (value !== open) {
    open = value;
    emit();
  }
}

/** Whether the composer plan sheet is open. */
export function usePlanSheetOpen(): boolean {
  return useStore(() => open);
}
