"""create_automation / list_automations — the agent-facing surface on scheduled automations (A3, §D-5).

Two built-in, agent-only tools (no Utils card, no host button), the `task_plan`/`question` template:
one file, an input model per tool, registered on import by `services/actions/__init__.py`.

Neither tool implements any automation logic. `create_automation` builds an `AutomationDraft` — the
ONE write shape — and hands it to `AutomationService.create`, which is the ONE validated writer: the
cron, the zone, a named agent, the whitespace rules and the cap (counted and inserted in a single
transaction) all arrive for free, and a refusal comes back as an `AutomationError` whose message was
written to be read by the owner *and* by the model. Re-validating anything here would be a second
implementation that drifts on its first disagreement.

**The recursion guard is in-tool, off `InvocationContext.interactive`** (council R-3, the
`spawn_subagents` depth-guard precedent): a non-interactive context is refused, which covers an
automation's own run AND every subagent spawned anywhere, in one check with no registry surgery.
Deliberately broader than "is this an automation?" (ruled): creating an automation is a `confirm`
tool, and at `privilege: FULL` the gate auto-allows confirms — for an interactive chat that is the
owner's standing consent (R-2), but an unattended run has no owner to consent at all. INTERACTIVITY,
not ancestry, is therefore the honest predicate, and it is what stops a scheduled run from breeding
more scheduled runs.

`list_automations` is the read-only sibling: LOW risk, no gate, available everywhere INCLUDING
headless — an unattended run may legitimately want to know what else is scheduled.
"""

from __future__ import annotations

from pydantic import BaseModel, Field

from app.core.tool import InvocationContext, action
from app.domain.automation import Automation, AutomationDraft, ThreadMode
from app.domain.enums import Risk, RunState
from app.domain.result import ToolResult
from app.services.automations import AutomationError, AutomationService, describe

#: Mirrors `AutomationDraft`'s own bounds so an over-long name or schedule fails at the INPUT model —
#: i.e. through the repair path the loop already gives any bad tool call — instead of raising a
#: pydantic error out of the draft construction below. Declared here rather than imported off the
#: draft's fields because a `FieldInfo` metadata dig is exactly the kind of indirection that reads as
#: cleverness; the two numbers are the same two numbers, and `test_automation_tools_14d` pins that.
MAX_NAME_CHARS = 80
MAX_SCHEDULE_CHARS = 200

#: What the run history reads as when an automation has never run. Named so the listing and its test
#: agree on the string.
NEVER_RUN = "never run"


# The v1 create surface (§D-5) — deliberately NOT every field of `AutomationDraft`. `privilege`,
# `question_policy` and `timeout_s` are absent on purpose: they are the settings that decide how much an
# unattended run is allowed to do and what it assumes when nobody answers, and the owner refines those
# in Conf on a record they can see. The model proposes the *what* and the *when*; the record it creates
# starts on the safe defaults (`privilege=None` → the resolved agent's own level,
# `question_policy=use_default`, the configured default timeout).
#
# No class docstring on either input model, deliberately (the `question`/`task_plan` shape): pydantic
# puts it in the JSON Schema `description`, i.e. straight into the model's tool definition — internal
# design rationale does not belong in the prompt, only per-field instructions do.
class CreateAutomationInput(BaseModel):
    name: str = Field(
        min_length=1,
        max_length=MAX_NAME_CHARS,
        description="Short label the owner will see in the list, e.g. 'nightly fleet check'.",
    )
    schedule: str = Field(
        min_length=1,
        max_length=MAX_SCHEDULE_CHARS,
        description=(
            "When to run it, as a 5-field cron expression (minute hour day-of-month month day-of-week) "
            "— e.g. '0 3 * * *' for 03:00 every day, '*/30 * * * *' for every half hour, '0 9 * * 1' for "
            "09:00 on Mondays. A seconds field is not supported."
        ),
    )
    prompt: str = Field(
        min_length=1,
        description=(
            "The instruction the run executes, written as if you were asking the agent fresh — the run "
            "has no memory of this conversation. Say what to do and what a result looks like."
        ),
    )
    thread_mode: ThreadMode = Field(
        default="fresh",
        description=(
            "Where each run's conversation goes. 'fresh' (the default) gives every run its own thread — "
            "right for a self-contained task. 'rolling' keeps appending to one thread, so the automation "
            "accumulates context across runs — right when a run should remember what the last one saw."
        ),
    )
    agent: str | None = Field(
        default=None,
        description=(
            "Which agent runs it, by name. Omit for the owner's default agent. A name that does not "
            "exist is refused — the run must not silently fall back to a different toolset."
        ),
    )
    tz: str | None = Field(
        default=None,
        description=(
            "IANA timezone the schedule is read in, e.g. 'Europe/Madrid'. Omit for the server's own zone "
            "(the usual answer — ask the owner only if they mentioned a different one)."
        ),
    )


# No input: the roster is bounded by `automations.max_count`, so paging or filtering it would be more
# schema for the model to get wrong than it would ever save.
class ListAutomationsInput(BaseModel):
    pass


def _service(ctx: InvocationContext) -> AutomationService | None:
    """The automations service off the world handle, or `None` when this build never wired one (a
    deps-lite context in a test). Read through `Deps` rather than `app.state` on purpose — a tool's
    only legitimate handle on the world is its `InvocationContext`."""
    return ctx.require_deps().automations


@action(
    "create_automation",
    title="Create automation",
    description=(
        "Save a RECURRING instruction the agent will run unattended on a repeating schedule (e.g. 'every "
        "morning at 8, check which hosts are offline and summarise'). Use it only when the owner wants "
        "something to happen again and again — never for work you can do right now. One-off future "
        "scheduling ('remind me tomorrow at 9', 'do it once tonight') is NOT supported: say so instead of "
        "faking it with a cron that would then repeat forever. The automation stays active until someone "
        "deletes it; the owner can edit, disable or delete it in Conf → Automations."
    ),
    icon="calendar-clock",
    category="builtin",
    risk=Risk.MED,
    # A confirm gate: this writes a record that will run the agent again, unattended, until someone
    # deletes it. NOT an unbypassable one — at `privilege: full` the gate auto-allows confirms, which for
    # an interactive chat is the owner's standing consent (council R-2). The description therefore does
    # NOT promise the owner is asked every time; the honest guarantee is the in-tool guard below (no
    # unattended context can reach this at all).
    confirm=True,
    ui_exposed=False,
    core=False,
)
async def create_automation(inp: CreateAutomationInput, ctx: InvocationContext) -> ToolResult:
    """Save a recurring instruction the agent runs unattended on a cron schedule. Recurring only — a
    one-off future task is not what this is. The owner manages it in Conf → Automations."""
    # The recursion guard, FIRST — before any validation, so an unattended caller gets the reason it was
    # refused rather than a critique of its cron expression (see the module docstring for why
    # interactivity is the predicate).
    if not ctx.interactive:
        return ToolResult(
            state=RunState.DENIED,
            summary=(
                "creating an automation needs a live owner to confirm — not available to automation "
                "runs or subagents"
            ),
        )
    service = _service(ctx)
    if service is None:  # pragma: no cover — every real app wires one in the lifespan
        return ToolResult(state=RunState.DENIED, summary="automations are not available")
    draft = AutomationDraft(
        name=inp.name,
        schedule=inp.schedule,
        prompt=inp.prompt,
        tz=inp.tz,
        agent=inp.agent,
        thread_mode=inp.thread_mode,
        # The rest of the draft stays at its defaults — see `CreateAutomationInput` for why the tool
        # does not expose them. `enabled=True`: an automation the owner just confirmed should be armed.
        enabled=True,
    )
    try:
        created = await service.create(draft)
    except AutomationError as exc:
        # Every refusal the service raises carries an owner-readable message naming the remedy ("the
        # automation limit (20) is reached — delete one first"). Surfaced verbatim, as a failed result:
        # the model can act on it (ask which one to delete, fix the field) and the owner reads the same
        # sentence in the bubble. A traceback would give neither of them anything.
        return ToolResult(
            state=RunState.ERROR,
            summary=f"could not create the automation {inp.name!r}",
            error=str(exc),
        )
    card = _card(created)
    return ToolResult(
        state=RunState.OK,
        summary=(
            f"created automation {created.name!r} · {card['schedule_text']} ({created.tz}) · "
            f"next run {card['next_fire'] or 'not scheduled'}"
        ),
        # The CARD rides `data` (the `question` offer's pattern, under a named key like `plan`/`results`
        # so the bubble identifies it by SHAPE and not by tool name): the assistant turn renders the
        # created record instead of the raw call line, and it is persisted with the message, so it
        # survives a reload with no extra state.
        data={"automation": card},
    )


def _card(row: Automation) -> dict[str, object]:
    """The created-card payload the chat bubble renders (§D-5 "a card/summary of the created
    automation"). The derived echoes are the same two the REST list computes — `describe` for the human
    schedule, and the stored `next_run_at` for the next fire, which is the value the scheduler will
    actually claim rather than a second computation that could disagree with it."""
    return {
        "id": row.id,
        "name": row.name,
        "schedule": row.schedule,
        "schedule_text": describe(row.schedule),
        "tz": row.tz,
        "next_fire": row.next_run_at.isoformat() if row.next_run_at else None,
        "thread_mode": row.thread_mode,
        "enabled": row.enabled,
        "agent": row.agent,
    }


@action(
    "list_automations",
    title="List automations",
    description=(
        "List the scheduled automations: what each one is called, when it runs, whether it is armed, "
        "and how its last run went. Use it before creating one (to avoid a duplicate), when the owner "
        "asks what is scheduled, or to name the one they want changed."
    ),
    icon="calendar-check",
    category="builtin",
    risk=Risk.LOW,
    read_only=True,  # pure read → retry-safe, and eligible for the D40 read-only prefix
    ui_exposed=False,
    core=False,
)
async def list_automations(inp: ListAutomationsInput, ctx: InvocationContext) -> ToolResult:
    """List the scheduled automations with their schedule, armed state and last run. Read-only, and
    available to unattended runs too — a run may legitimately need to know what else is scheduled."""
    service = _service(ctx)
    if service is None:  # pragma: no cover — every real app wires one in the lifespan
        return ToolResult(state=RunState.DENIED, summary="automations are not available")
    rows = await service.repo.list()
    if not rows:
        return ToolResult(state=RunState.OK, summary="no automations are scheduled")
    latest = await service.repo.latest_runs()
    lines = []
    for row in rows:
        run = latest.get(row.id)
        # `next_run_at` is NULL for a disabled row by construction (§D-1), so the two columns can never
        # contradict each other here.
        when = row.next_run_at.isoformat() if row.next_run_at else "—"
        lines.append(
            f"{row.name} · {describe(row.schedule)} ({row.tz}) · "
            f"{'enabled' if row.enabled else 'disabled'} · next {when} · "
            f"last {run.status if run else NEVER_RUN}"
        )
    return ToolResult(
        state=RunState.OK,
        summary=f"{len(rows)} automation{'' if len(rows) == 1 else 's'}",
        output="\n".join(lines),
    )
