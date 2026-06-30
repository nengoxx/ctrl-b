"""question — the agent asks the owner a clarifying question and waits for the answer (A2, D16-sibling).

A built-in, agent-only tool (no Utils card, no host button), sibling of `task_plan`. When the model
needs a decision it can't safely guess — which host the owner meant, whether to proceed a certain way —
it calls `question(prompt=…)` instead of guessing or giving up. The tool does no I/O: it returns an
`AWAITING_ANSWER` result, which the agent loop treats as a **suspend** — it persists the call
`AWAITING_ANSWER`, emits a `tool.question` event to the UI, and ends the turn `done(suspended)`. The
owner's reply reopens the stream via `resume(decision="answer", answer=…)`, which injects the answer as
this call's result (the model reads it like any tool output) and continues the loop.

`core=True` (the cognitive set, like `task_plan`/`memory`): asking for clarification is a fundamental
capability every agent should have. A **headless subagent** has no one to ask, so the loop converts the
suspend into a DENIED result there — the subagent reports it couldn't ask and carries on, never hanging.

LOW risk → auto-runs under the agent's privilege (no confirm gate); the suspend is the whole point.
"""

from __future__ import annotations

from pydantic import BaseModel, Field

from app.core.tool import InvocationContext, action
from app.domain.enums import Risk, RunState
from app.domain.result import ToolResult


class QuestionInput(BaseModel):
    prompt: str = Field(
        description=(
            "The question to ask the owner — a single, specific thing you need decided before you can "
            "proceed (e.g. 'Which host did you mean — corsair or emma?'). Ask only when you genuinely "
            "can't resolve it yourself from the roster/context; don't ask permission for risky actions "
            "(those are confirmed automatically)."
        ),
    )


@action(
    "question",
    title="Ask the owner",
    description=(
        "Ask the owner a clarifying question and wait for their answer before continuing. Use it when a "
        "request is genuinely ambiguous and you can't resolve it from the fleet roster or context — ask "
        "instead of guessing. Don't use it to ask permission for a risky action (those are confirmed for "
        "you) or to narrate progress. The turn pauses until the owner replies; then you get their answer."
    ),
    icon="help-circle",
    category="builtin",
    risk=Risk.LOW,
    ui_exposed=False,
    core=True,
)
async def question(inp: QuestionInput, ctx: InvocationContext) -> ToolResult:
    """Ask the owner a clarifying question and wait for their answer. The loop suspends the turn on
    this AWAITING_ANSWER result and resumes with the owner's reply injected as this call's result."""
    text = inp.prompt.strip()
    if not text:
        return ToolResult(
            state=RunState.ERROR, summary="empty question", error="`prompt` is required — what do you want to ask?"
        )
    return ToolResult(state=RunState.AWAITING_ANSWER, summary=text)
