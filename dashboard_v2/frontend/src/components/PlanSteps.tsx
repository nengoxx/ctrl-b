import { NEXT_STATUS } from "../lib/plan";
import type { Plan } from "../types";

// The task_plan checklist — the shared list-of-steps view (Phase 4d). ONE implementation, reused by both
// vapor's in-tab pinned plan (`AgentTab`) and the kit composer's plan sheet (`kit/composer/plan`). Pure +
// presentational: the `.plan-steps`/`.plan-step` classes are skinned per theme (extras.css for vapor,
// kit.css under `.kit`).
//
// When `onCycle` is given (the live, editable panels) each step's dot is a button that advances its status
// (pending → active → done → pending); read-only contexts (historical breadcrumbs) omit it.
export function PlanSteps({ plan, onCycle }: { plan: Plan; onCycle?: (i: number) => void }) {
  return (
    <ul className="plan-steps">
      {plan.steps.map((s, i) => (
        <li key={i} className={"plan-step " + s.status}>
          {onCycle ? (
            <span
              className="tick tick-btn"
              role="button"
              tabIndex={0}
              aria-label={`step "${s.text}": ${s.status} — tap to set ${NEXT_STATUS[s.status]}`}
              onClick={() => onCycle(i)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onCycle(i);
                }
              }}
            />
          ) : (
            <span className="tick" aria-hidden />
          )}
          <span className="txt">{s.text}</span>
        </li>
      ))}
    </ul>
  );
}
