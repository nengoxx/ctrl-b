import { PlanSteps } from "../../../../components/PlanSteps";
import { advanceStep } from "../../../../lib/plan";
import { editPlan, useCurrentPlan } from "../../../../store/chat";
import { setPlanSheetOpen, usePlanSheetOpen } from "../../../../store/planSheet";

// The Kit-tokened PINNED plan (A4 · placement "pinned") — a sticky disclosure at the top of the agent tab's
// scroll flow. This is the Kit counterpart to vapor's frozen in-tab `PinnedPlan` (AgentTab): a collapsed
// header that drops the live checklist down when tapped, pinned so it stays reachable while the transcript
// scrolls. Mounted by AgentTab (the always-present, plan-aware host) — NOT by DefaultRoot, whose shared
// scroller would leak the sticky node onto non-agent tabs.
//
// Self-subscribes to the current plan + the SHARED plan-sheet open flag (`usePlanSheetOpen`), the same flag
// the inline pill/sheet use — the two placements are mutually exclusive per theme, so sharing one flag is
// free and keeps a single "plan is open" state. Renders null when there's no plan (AgentTab also gates on
// `currentPlan` to avoid a dead sticky node, matching the vapor guard). The open/close slide + the sticky/
// frosted geometry live in kit.css (`.plan-pin-panel`/`.plan-pin-drop`); this owns only content + state.
//
// Tapping a step's dot advances its status (pending → active → done → pending) via `advanceStep` + `editPlan`
// — EXACTLY the same edit path as `PlanSheet`, so exactly one step is active at a time (the agent's invariant).
export function PinnedPlanPanel() {
  const plan = useCurrentPlan();
  const open = usePlanSheetOpen();
  if (!plan) return null;
  const total = plan.steps.length;
  const done = plan.steps.filter((s) => s.status === "done").length;
  const cycle = (i: number) => void editPlan(advanceStep(plan.steps, i));
  return (
    <div className="plan-pin-panel">
      <button
        type="button"
        className={"plan-pin-head" + (open ? " open" : "")}
        onClick={() => setPlanSheetOpen()}
        aria-expanded={open}
        aria-controls="plan-pin-panel-drop"
      >
        <span className="plan-title">plan</span>
        <span className="plan-count">
          {done}/{total}
        </span>
        <span className="chev" aria-hidden>
          ▾
        </span>
      </button>
      <div
        className={"plan-pin-drop" + (open ? " open" : "")}
        id="plan-pin-panel-drop"
        role="region"
        aria-label="task plan"
        aria-hidden={!open}
      >
        <PlanSteps plan={plan} onCycle={cycle} />
      </div>
    </div>
  );
}
