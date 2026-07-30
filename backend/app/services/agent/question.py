"""question — the agent asks the owner a clarifying question and waits for the answer (A2, D16-sibling).

A built-in, agent-only tool (no Utils card, no host button), sibling of `task_plan`. When the model
needs a decision it can't safely guess — which host the owner meant, whether to proceed a certain way —
it calls `question(prompt=…)` instead of guessing or giving up. The tool does no I/O: it returns an
`AWAITING_ANSWER` result, which the agent loop treats as a **suspend** — it persists the call
`AWAITING_ANSWER`, emits a `tool.question` event to the UI, and ends the turn `done(suspended)`. The
owner's reply reopens the stream via `resume(decision="answer", answer=…)`, which injects the answer as
this call's result (the model reads it like any tool output) and continues the loop.

`core=True` (the cognitive set, like `task_plan`/`memory`): asking for clarification is a fundamental
capability every agent should have. A **headless** session has no one to ask, so the loop resolves the
suspend itself and the turn never hangs: a subagent gets a DENIED result and carries on, while an
unattended automation run follows its `question_policy` (§D-3) — `skip` is that same DENIED, and
`use_default` answers from the `default`/`choices` offered below so the run keeps moving.

LOW risk → auto-runs under the agent's privilege (no confirm gate); the suspend is the whole point.
"""

from __future__ import annotations

from typing import Annotated

from pydantic import BaseModel, Field, StringConstraints

from app.core.tool import InvocationContext, action
from app.domain.enums import Risk, RunState
from app.domain.result import ToolResult

#: Bounds on the offered answers (post-14b review, LOW). A `question` renders as one-tap chips on a
#: PHONE, so an unbounded list is a wall of buttons, not a choice — and the offer also has to fit in the
#: model's own tool schema. Enforced at the input model, so an over-long list fails validation with the
#: repair path the loop already gives any bad tool call, instead of being silently truncated somewhere
#: downstream. Deliberately not configurable: this is a property of a phone-sized bubble, not a policy.
MAX_CHOICES = 8
MAX_CHOICE_CHARS = 60


class QuestionInput(BaseModel):
    prompt: str = Field(
        description=(
            "The question to ask the owner — a single, specific thing you need decided before you can "
            "proceed (e.g. 'Which host did you mean — corsair or emma?'). Ask only when you genuinely "
            "can't resolve it yourself from the roster/context; don't ask permission for risky actions "
            "(those are confirmed automatically)."
        ),
    )
    #: A2's locked bubble shape, additive (§D-3 / council R-1). Both optional: every call that worked
    #: before still works, and a call that fills them in is strictly better — the owner gets one-tap
    #: chips instead of typing, and an UNATTENDED run (an automation with `question_policy:
    #: use_default`) can resolve the question itself from `default` → `choices[0]` instead of skipping it.
    #: They reach the model's tool schema the moment they exist, which is why the interactive rendering
    #: ships in the same slice.
    choices: list[Annotated[str, StringConstraints(max_length=MAX_CHOICE_CHARS)]] | None = Field(
        default=None,
        max_length=MAX_CHOICES,
        description=(
            "Optional short answer options, if the question is a choice between a few known ones (e.g. "
            f"['corsair', 'emma']). At most {MAX_CHOICES}, each under {MAX_CHOICE_CHARS} characters. The "
            "owner gets them as one-tap buttons and can still type something else. Omit for a genuinely "
            "open question."
        ),
    )
    default: str | None = Field(
        default=None,
        max_length=MAX_CHOICE_CHARS,
        description=(
            "Optional answer to assume if the owner is not there to reply (an unattended scheduled run "
            "may proceed with it instead of skipping the step). Set it whenever one answer is the "
            "sensible, safe assumption; omit it when guessing would be wrong."
        ),
    )


@action(
    "question",
    title="Ask the owner",
    description=(
        "Ask the owner a clarifying question and wait for their answer before continuing. Use it when a "
        "request is genuinely ambiguous and you can't resolve it from the fleet roster or context — ask "
        "instead of guessing. Don't use it to ask permission for a risky action (those are confirmed for "
        "you) or to narrate progress. The turn pauses until the owner replies; then you get their answer. "
        "Offer `choices` when the answer is one of a few known options (the owner gets one-tap buttons), "
        "and `default` when one answer is a safe assumption — a scheduled run with no owner present can "
        "then proceed with it instead of skipping the step."
    ),
    icon="help-circle",
    category="builtin",
    risk=Risk.LOW,
    read_only=True,  # just prompts the owner; no external effect → retry-safe
    suspending=True,  # returns AWAITING_ANSWER → suspends the turn (D40: excluded from the read-only prefix)
    ui_exposed=False,
    core=True,
)
async def question(inp: QuestionInput, ctx: InvocationContext) -> ToolResult:
    """Ask the owner a clarifying question and wait for their answer. The loop suspends the turn on
    this AWAITING_ANSWER result and resumes with the owner's reply injected as this call's result."""
    text = inp.prompt.strip()
    if not text:
        return ToolResult(
            state=RunState.ERROR,
            summary="empty question",
            error="`prompt` is required — what do you want to ask?",
        )
    # The OFFER rides in `data` (§D-3): the tool declares what it is willing to have assumed, and the
    # loop's unattended ladder reads it from there rather than from the model's raw args — so the session
    # stays ignorant of this input model's field names and any future suspending tool can offer the same.
    # Blank/empty values are dropped, so "offered nothing" and "offered an empty string" can't be
    # confused. The interactive path is untouched: it renders the durable `args` on the question bubble.
    offer: dict[str, object] = {}
    choices = [c.strip() for c in (inp.choices or []) if c and c.strip()]
    if choices:
        offer["choices"] = choices
    if inp.default and inp.default.strip():
        offer["default"] = inp.default.strip()
    return ToolResult(state=RunState.AWAITING_ANSWER, summary=text, data=offer)
