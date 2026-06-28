// Pure task_plan helpers (Phase 4d) — shared by the agent-chat controller (hooks/useAgentChat) and the
// vapor Agent-tab presentation (PlanBubble), so plan derivation lives in ONE place. Dependency-free +
// React-free, so it's directly unit-testable (tests/lib/plan.test.ts).

import type { ChatMessage, Plan, PlanStep, PlanStepStatus, ToolCallPart, ToolResult } from "../types";

/** The status a tap advances a plan step to — pending → active → done → pending. Mirrors the three
 *  states the agent itself sets, so a manual tap reads identically (used for the dot + its aria-label). */
export const NEXT_STATUS: Record<PlanStepStatus, PlanStepStatus> = {
  pending: "active",
  active: "done",
  done: "pending",
};

/** Advance step `i` to its next status (the click cycle), preserving the agent's "exactly one active"
 *  invariant: when `i` becomes active, any OTHER active step drops back to pending. Pure — the panel
 *  calls it then persists via editPlan. Self-heals a pre-existing multi-active plan on the next tap. */
export function advanceStep(steps: PlanStep[], i: number): PlanStep[] {
  const next = NEXT_STATUS[steps[i].status];
  return steps.map((s, j) => {
    if (j === i) return { ...s, status: next };
    if (next === "active" && s.status === "active") return { ...s, status: "pending" };
    return s;
  });
}

/** Pull the plan from a task_plan pair — prefer the executed result's `data.plan`, fall back to the
 *  call args so it renders the instant the call streams in (before the result lands). */
export function planFrom(call: ToolCallPart, result: ToolResult | undefined): Plan | null {
  const fromResult = (result?.data as { plan?: Plan } | undefined)?.plan;
  if (fromResult && Array.isArray(fromResult.steps)) return fromResult;
  const fromArgs = call.args as { steps?: PlanStep[] };
  if (Array.isArray(fromArgs.steps)) return { steps: fromArgs.steps };
  return null;
}

/**
 * The *current* plan: the most-recent task_plan call's plan (the model rewrites the whole list each call),
 * or null. THE single plan-extraction point — `pairResults` (agent view) and `useCurrentPlan` (the composer
 * pill) both go through here, so plan derivation lives in ONE place. Scans from the END so it stops at the
 * first task_plan (cheap when only the plan is needed — `useCurrentPlan` runs per streamed token), then
 * pairs just that call's result (results can land in a separate reloaded `tool` message). Reuses `planFrom`.
 */
export function currentPlanOf(messages: ChatMessage[]): Plan | null {
  let call: ToolCallPart | null = null;
  outer: for (let i = messages.length - 1; i >= 0; i--) {
    const parts = messages[i].parts;
    for (let j = parts.length - 1; j >= 0; j--) {
      const p = parts[j];
      if (p.type === "tool_call" && p.tool === "task_plan") {
        call = p;
        break outer;
      }
    }
  }
  if (!call) return null;
  let result: ToolResult | undefined;
  for (const m of messages) {
    for (const p of m.parts) {
      if (p.type === "tool_result" && p.call_id === call.call_id) result = p.result;
    }
  }
  return planFrom(call, result);
}

/**
 * Pair every tool result to its call by id across the whole thread (live appends + reloaded separate
 * `tool` messages both land here), and resolve the current plan (delegated to `currentPlanOf` so there's a
 * single derivation). One linear scan for the pairing — the Agent tab memoizes it on `messages`.
 */
export function pairResults(messages: ChatMessage[]): {
  resultByCall: Record<string, ToolResult>;
  currentPlan: Plan | null;
} {
  const byCall: Record<string, ToolResult> = {};
  for (const m of messages) {
    for (const p of m.parts) {
      if (p.type === "tool_result") byCall[p.call_id] = p.result;
    }
  }
  return { resultByCall: byCall, currentPlan: currentPlanOf(messages) };
}
