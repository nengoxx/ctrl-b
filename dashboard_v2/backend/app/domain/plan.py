"""Plan — the agent's structured per-task step list (D10, Phase 4d).

TodoWrite-style: the `task_plan` tool rewrites the *whole* step list each call, so the latest plan
is the live one. A `Plan` is never persisted on its own — it rides in a `task_plan` ToolResult's
`data` (and thus in the message history), so reload + the agent's context both get it for free.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

PlanStepStatus = Literal["pending", "active", "done"]


class PlanStep(BaseModel):
    text: str = Field(description="One concrete step, phrased as a short imperative.")
    status: PlanStepStatus = Field(
        default="pending", description="pending | active | done — exactly one step is `active`."
    )


class Plan(BaseModel):
    steps: list[PlanStep] = Field(default_factory=list)

    @property
    def done(self) -> int:
        return sum(1 for s in self.steps if s.status == "done")
