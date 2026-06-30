"""task_plan — the agent's working plan/task list (D10, Phase 4d).

A built-in, agent-only tool (no Utils card, no host button). The model calls it to lay out a
multi-step task and again to update statuses as it progresses; it rewrites the *entire* step list
each call (TodoWrite-style), so the most recent call is the live plan. The tool has no side effects
and reaches for no deps — it validates the steps and echoes the structured plan back in
`ToolResult.data["plan"]`, which the loop persists as a `tool_result` part and the UI renders as a
plan panel. Because the plan lives in the message history, reload and the agent's own context both
recover it without any extra per-thread state.

LOW risk → auto-runs under the agent's CONFIRM privilege (no confirm gate), like ping/wake.
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field, field_validator

from app.core.tool import InvocationContext, action
from app.domain.enums import Risk, RunState
from app.domain.plan import Plan, PlanStep
from app.domain.result import ToolResult


class TaskPlanInput(BaseModel):
    steps: list[PlanStep] = Field(
        default_factory=list,
        description=(
            "The full ordered task list, rewritten in its entirety every call (TodoWrite-style). "
            "Each step has `text` and `status` (pending|active|done). Keep exactly one step "
            "`active` while you work it; flip it to `done` and set the next to `active` as you go. "
            "Pass an empty list to clear the plan."
        ),
    )

    @field_validator("steps", mode="before")
    @classmethod
    def _as_list(cls, v: Any) -> Any:
        """Tolerate a model that passes a single step (dict/str) or null instead of a list — the
        per-step coercion (PlanStep) then repairs each item."""
        if v is None:
            return []
        if isinstance(v, (str, dict)):
            return [v]
        return v


@action(
    "task_plan",
    title="Plan",
    description=(
        "Create or update your working plan for a multi-step task BEFORE doing the work — use this "
        "first whenever a request has two or more steps (e.g. wake a host then start a service). Lay "
        "out the steps up front, then call again to advance their status as you complete each. Always "
        "pass the complete ordered list (it replaces the previous plan). Skip this for a single quick "
        "action. This does not perform the steps; it only records the plan."
    ),
    icon="list-checks",
    category="builtin",
    risk=Risk.LOW,
    ui_exposed=False,
    core=True,  # cognitive builtin — always reachable regardless of an agent's tools allowlist
)
async def task_plan(inp: TaskPlanInput, ctx: InvocationContext) -> ToolResult:
    """Create or update your working plan for a multi-step task. Lay out the steps up front, then
    call again to advance their status. Always pass the complete list."""
    plan = Plan(steps=inp.steps)
    total = len(plan.steps)
    summary = f"plan · {plan.done}/{total} done" if total else "plan cleared"
    return ToolResult(state=RunState.OK, summary=summary, data={"plan": plan.model_dump()})
