import type { ComposerSlots } from "../types";
import { PlanPill } from "./PlanPill";
import { PlanSheet } from "./PlanSheet";

// The plan-pill ADDON, packaged as composer slots (D30). A theme opts in with
// `DefaultRoot composerSlots={kitPlanComposerSlots}`. The nodes are static — `PlanPill`/`PlanSheet`
// self-subscribe to the chat/plan stores and render null when there's no plan — so dropping them into a
// composer variant adds zero wiring and the slot identities stay stable across renders.
export const kitPlanComposerSlots: ComposerSlots = {
  controlsStart: <PlanPill />,
  overlay: <PlanSheet />,
};
