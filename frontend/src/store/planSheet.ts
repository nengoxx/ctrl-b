// Composer plan-sheet open/closed state. The plan pill (in the composer's controls row) and the plan sheet
// (the frosted panel that peeks up from the composer's top edge) are mounted in DIFFERENT DOM locations but
// share this ONE flag — so neither needs a common parent holding state, and toggling the sheet never
// re-renders the app shell (the pill/sheet self-subscribe; see kit/composer/plan).
//
// The flag itself now LIVES in `store/composerOverlay` (A6): the plan sheet is one of three surfaces that
// hover over the composer's top edge, and only one may be open. This module stays the plan sheet's public
// face — same three exports, same semantics — and simply addresses the `"plan"` slot of the shared
// coordinator, so every existing caller (pill, sheet, pinned panel, cosmos/frontier Fleet) is untouched.

import { useEffect } from "react";

import type { Plan } from "../types";
import {
  getComposerOverlay,
  releaseComposerOverlay,
  setComposerOverlay,
  useComposerOverlayOpen,
} from "./composerOverlay";

/** Open/close (or, with no arg, toggle) the composer plan sheet. Idempotent — only emits on a real change.
 *  Opening CLAIMS the shared composer-overlay slot (closing the suggest popover / tools menu); closing
 *  RELEASES it only if the plan sheet still holds it. */
export function setPlanSheetOpen(next?: boolean): void {
  const value = next ?? getComposerOverlay() !== "plan";
  if (value) setComposerOverlay("plan");
  else releaseComposerOverlay("plan");
}

/** Whether the composer plan sheet is open. */
export function usePlanSheetOpen(): boolean {
  return useComposerOverlayOpen("plan");
}

/** Reset the open flag when the plan goes away (A4). The flag is SHARED across plan changes so it survives
 *  a plan edit — but a cleared-then-new plan must NOT reopen the panel unbidden (audited bug: the flag never
 *  reset on plan→null, so the next plan appeared already-open). Whichever component is always mounted and
 *  plan-aware calls this once; AppEngines hosts it (D29 §14.5 — the theme-independent engine spot, always
 *  mounted above the theme Root). Homed there rather than AgentTab so a bespoke theme body that REPLACES the
 *  agent section can never lose the reset. Works for BOTH placements (inline sheet + pinned panel) since they
 *  share this one flag. */
export function usePlanOpenAutoClose(currentPlan: Plan | null): void {
  useEffect(() => {
    if (!currentPlan) setPlanSheetOpen(false);
  }, [currentPlan]);
}
