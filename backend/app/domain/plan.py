"""Plan — the agent's structured per-task step list (D10, Phase 4d).

TodoWrite-style: the `task_plan` tool rewrites the *whole* step list each call, so the latest plan
is the live one. A `Plan` is never persisted on its own — it rides in a `task_plan` ToolResult's
`data` (and thus in the message history), so reload + the agent's context both get it for free.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field, model_validator

PlanStepStatus = Literal["pending", "active", "done"]

#: Weak local models phrase a plan loosely — map common status synonyms onto the 3 valid values
#: instead of erroring (the "broken task_plan call" bug). Unknown → "pending".
_STATUS_ALIASES = {
    "pending": "pending", "todo": "pending", "to-do": "pending", "to_do": "pending",
    "not_started": "pending", "not-started": "pending", "notstarted": "pending",
    "planned": "pending", "queued": "pending", "waiting": "pending", "open": "pending", "": "pending",
    "active": "active", "in_progress": "active", "in-progress": "active", "in progress": "active",
    "inprogress": "active", "doing": "active", "current": "active", "running": "active",
    "started": "active", "ongoing": "active", "wip": "active",
    "done": "done", "complete": "done", "completed": "done", "finished": "done",
    "success": "done", "ok": "done", "resolved": "done", "closed": "done", "x": "done", "[x]": "done",
}
#: Alternate field names a model might use for the step text.
_TEXT_KEYS = ("text", "step", "task", "description", "desc", "title", "name", "content",
              "label", "action", "detail", "item", "summary")


class PlanStep(BaseModel):
    text: str = Field(default="", description="One concrete step, phrased as a short imperative.")
    status: PlanStepStatus = Field(
        default="pending", description="pending | active | done — exactly one step is `active`."
    )

    @model_validator(mode="before")
    @classmethod
    def _coerce(cls, v: Any) -> Any:
        """Repair common malformed shapes rather than erroring: a bare string becomes the step
        text; alternate field names (`task`/`step`/`description`/…) map to `text`; status synonyms
        (`in_progress`/`completed`/`todo`/…) map onto the 3 valid values."""
        if isinstance(v, str):
            return {"text": v}
        if not isinstance(v, dict):
            return v
        d = dict(v)
        if not isinstance(d.get("text"), str) or not d["text"].strip():
            for k in _TEXT_KEYS:
                val = d.get(k)
                if isinstance(val, str) and val.strip():
                    d["text"] = val
                    break
        st = d.get("status")
        if isinstance(st, str):
            d["status"] = _STATUS_ALIASES.get(st.strip().lower().strip("[]"), "pending")
        elif st is not None:  # non-string status → drop it, use the default
            d.pop("status", None)
        return d


class Plan(BaseModel):
    steps: list[PlanStep] = Field(default_factory=list)

    @property
    def done(self) -> int:
        return sum(1 for s in self.steps if s.status == "done")
