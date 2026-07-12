import { useCurrentPlan } from "../../../../store/chat";
import { setPlanSheetOpen, usePlanSheetOpen } from "../../../../store/planSheet";

// The plan PILL — the trigger that lives in the composer's controls row (the `controlsStart` slot, left of
// mic/send). Self-subscribes to the current plan + the open flag and renders NOTHING when there's no plan,
// so it's a static slot node the theme can drop in without any wiring. Tapping toggles the plan sheet.
export function PlanPill() {
  const plan = useCurrentPlan();
  const open = usePlanSheetOpen();
  if (!plan) return null;
  const total = plan.steps.length;
  const done = plan.steps.filter((s) => s.status === "done").length;
  return (
    <button
      type="button"
      className={"plan-pill" + (open ? " open" : "")}
      onClick={() => setPlanSheetOpen()}
      aria-expanded={open}
      aria-controls="plan-sheet"
      aria-label={`plan: ${done}/${total} steps done`}
    >
      {/* The word "plan" is dropped (owner eyeball r4): the count + chevron carry the meaning; the
          `aria-label` above keeps the pill self-describing for AT. (The sheet/PinnedPlan headers keep
          their own `.plan-title` label — untouched.) */}
      <span className="plan-count">
        {done}/{total}
      </span>
      <span className="chev" aria-hidden>
        ▴
      </span>
    </button>
  );
}
