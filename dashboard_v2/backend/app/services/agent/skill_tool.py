"""skill_manage — the agent's write path to its own skills (7e-f-2, D14 Hermes-style self-improvement).

A built-in, agent-only tool (no Utils card, no host button) that lets the model author or update a
`SKILL.md` in its OWN skills folder: the default/root agent edits the global `skills/`, a specialist
edits `agents/<slug>/skills/`. Those are exactly the folders `available_skills` reads, so a skill the
agent writes is live on its next turn (the provider re-scans each call).

Gating, in order: the subsystem master switch (`agent.skills_enabled`), then the `skills_auto_write`
kill switch — when **off** the tool neither writes nor blocks: it returns a non-blocking "proposed
(not written)" result carrying the edit in `data["proposed"]`, for the Approve-to-apply UI (7e-f-3,
shared with the `memory` tool). A bad slug or an empty body for `save` comes back as an ERROR result
the model can fix, not a crash. Every invocation is audited by `ActionService._record` — no manual
Event.

This is **not** a `core` builtin: self-authoring skills is an explicit grant (an agent only gets it
if its `tools` allowlist includes `skill_manage`), unlike the always-on cognitive set.

LOW risk → auto-runs under the agent's CONFIRM privilege (no confirm gate), like `task_plan`/`memory`.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

from app.core.tool import InvocationContext, action
from app.domain.enums import Risk, RunState
from app.domain.result import ToolResult
from app.services.agent.skills import (
    agent_skills_root,
    remove_skill_md,
    valid_skill_slug,
    write_skill_md,
)


class SkillManageInput(BaseModel):
    action: Literal["save", "remove"] = Field(
        description=(
            "`save` to create or overwrite a skill, or `remove` to delete one of yours by `name`."
        ),
    )
    name: str = Field(
        description=(
            "The skill's slug — lowercase letters, digits, '-' or '_' (e.g. `triage-host`). This is "
            "the folder name and the id used to invoke it; reuse an existing name to overwrite it."
        ),
    )
    content: str = Field(
        default="",
        description=(
            "For `save`: the full SKILL.md — optional `---` YAML frontmatter (`name`, `description`, "
            "optional `allowed_tools`) then the markdown instructions the agent follows when the "
            "skill is active. Keep `description` sharp: it's what the selector matches to activate it."
        ),
    )


@action(
    "skill_manage",
    title="Manage skill",
    description=(
        "Author or update one of your own reusable skills — a SKILL.md of standing instructions for a "
        "recurring kind of task, optionally narrowing your tools while active. Use it to capture a "
        "procedure you want to reuse later (the description you give steers when it activates). `save` "
        "to create/overwrite by `name`, `remove` to delete one. Writes to your own skills folder; the "
        "new skill is available on your next turn."
    ),
    icon="book-plus",
    category="builtin",
    risk=Risk.LOW,
    ui_exposed=False,
)
async def skill_manage(inp: SkillManageInput, ctx: InvocationContext) -> ToolResult:
    """Author or update one of your own skills (a reusable SKILL.md). `save` to create/overwrite by
    `name`, `remove` to delete one. Writes to your own skills folder; live on your next turn."""
    deps = ctx.deps
    if deps is None or deps.settings is None:
        return ToolResult(state=RunState.DENIED, summary="skill management is not available")

    if not deps.settings.agent.skills_enabled:
        return ToolResult(state=RunState.DENIED, summary="the skills subsystem is disabled")

    # Arg checks the model can fix → ERROR (data, not an exception).
    if not valid_skill_slug(inp.name):
        return ToolResult(
            state=RunState.ERROR,
            summary="invalid skill name",
            error="`name` must be a lowercase slug (letters, digits, '-' or '_'), e.g. `triage-host`.",
        )
    if inp.action == "save" and not inp.content.strip():
        return ToolResult(
            state=RunState.ERROR,
            summary="nothing to save",
            error="`content` is the full SKILL.md text — it can't be empty for save.",
        )

    agent = ctx.agent or deps.settings.default_agent_def()

    # Kill switch (mirrors memory.auto_write, D15 #6): off → propose, never write, never block. The
    # Approve-to-apply UI is 7e-f-3, shared with the `memory` tool via the same `data["proposed"]`.
    if not deps.settings.agent.skills_auto_write:
        return ToolResult(
            state=RunState.OK,
            summary=f"proposed {inp.action} of skill '{inp.name}' (not written — auto-write is off)",
            data={"proposed": inp.model_dump()},
        )

    root = agent_skills_root(deps.settings, agent)
    if inp.action == "save":
        write_skill_md(root, inp.name, inp.content)
        return ToolResult(state=RunState.OK, summary=f"saved skill '{inp.name}'")
    if not remove_skill_md(root, inp.name):
        return ToolResult(
            state=RunState.ERROR,
            summary=f"no skill '{inp.name}' to remove",
            error="`name` doesn't match one of your skills.",
        )
    return ToolResult(state=RunState.OK, summary=f"removed skill '{inp.name}'")
