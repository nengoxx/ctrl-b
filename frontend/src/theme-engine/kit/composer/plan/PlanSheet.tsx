import { PlanSteps } from "../../../../components/PlanSteps";
import { advanceStep } from "../../../../lib/plan";
import { editPlan, useCurrentPlan } from "../../../../store/chat";
import { usePlanSheetOpen } from "../../../../store/planSheet";

// The plan SHEET — the frosted panel that peeks up from the composer's top edge (the `overlay` slot). A
// sibling of `.kit-composer` so the composer's rounded top can tuck the sheet's bottom edge (a child would
// paint in front). Self-subscribes; renders nothing when there's no plan. The open/closed slide + the
// "tuck behind the composer" geometry live in kit.css (`.plan-sheet`); this owns only content + state.
//
// Tapping a step's dot advances its status (pending → active → done → pending), persists, and the agent sees
// it next turn — reusing `advanceStep` + `editPlan` (the same edit path the in-tab plan uses), so EXACTLY
// ONE step is active at a time (the agent's invariant).
export function PlanSheet() {
  const plan = useCurrentPlan();
  const open = usePlanSheetOpen();
  if (!plan) return null;
  const cycle = (i: number) => void editPlan(advanceStep(plan.steps, i));
  return (
    <div
      className={"plan-sheet" + (open ? " open" : "")}
      id="plan-sheet"
      role="region"
      aria-label="task plan"
      // `inert`, not `aria-hidden` (2026-07-30): the closed sheet stays mounted for its slide and holds
      // focusable `.tick-btn` dots — `aria-hidden` over focusable content is the `aria-hidden-focus`
      // violation (invisible-but-tabbable). `inert` removes them from tab order AND the a11y tree.
      inert={!open}
    >
      <PlanSteps plan={plan} onCycle={cycle} />
    </div>
  );
}
