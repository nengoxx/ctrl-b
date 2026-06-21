"""memory — the agent's write path to its durable file memory (7e-d-2, D14/D15 #4/#6).

A built-in, agent-only tool (no Utils card, no host button) that lets the model persist a note it
should remember across sessions. There is **no read action** — the saved memory is injected into
every turn by `FileMemoryProvider.load_context` (7e-d-1), so the model already sees the current
content (and each store's cap usage) and writes against it.

Gating, in order: the subsystem master switch (`memory.enabled`), the `user` target's own switch
(`memory.user_profile_enabled`), then the `auto_write` kill switch — when **off** the tool neither
writes nor blocks: it returns a non-blocking "proposed (not written)" result carrying the edit in
`data["proposed"]`, for the Approve-to-apply UI deferred to 7e-f (shared with `skill_manage`). A
write that would exceed the store's char cap comes back as an ERROR result steering the model to
consolidate, not a crash. Every invocation is audited by `ActionService._record` — no manual Event.

LOW risk → auto-runs under the agent's CONFIRM privilege (no confirm gate), like `task_plan`.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Literal

from pydantic import BaseModel, Field

from app.core.tool import InvocationContext, action
from app.domain.enums import Risk, RunState
from app.domain.result import ToolResult
from app.services.agent.memory import MemoryCapError, MemoryWriteError

if TYPE_CHECKING:
    from app.domain.agent import AgentDef
    from app.services.deps import Deps


class MemoryInput(BaseModel):
    target: Literal["memory", "user"] = Field(
        default="memory",
        description=(
            "Which store to edit. `memory` = your own working memory (facts about ongoing tasks, "
            "decisions, project context). `user` = the durable profile of the person you're helping "
            "(their preferences, identity, standing instructions) — shared across all agents."
        ),
    )
    action: Literal["add", "replace", "remove"] = Field(
        description=(
            "`add` a new entry, or `replace`/`remove` an existing one. For replace/remove, give the "
            "exact text to match in `old_text`."
        ),
    )
    content: str = Field(
        default="",
        description=(
            "The note to store (for `add`) or the new text (for `replace`). Keep it short and "
            "durable — a single fact or preference worth remembering, not transient chatter."
        ),
    )
    old_text: str | None = Field(
        default=None,
        description=(
            "For `replace`/`remove`: an exact substring of the current memory to act on. Copy it "
            "verbatim from the memory block injected this turn."
        ),
    )


@action(
    "memory",
    title="Memory",
    description=(
        "Save something to your durable memory so you remember it in future sessions. Use it when "
        "you learn a lasting fact, preference, or decision worth keeping — not for transient chat. "
        "`add` a new note, or `replace`/`remove` an existing one by its exact `old_text`. You do not "
        "need to read first: your current memory is shown to you each turn. Set `target` to `user` to "
        "record a durable fact about the person you're helping."
    ),
    icon="brain",
    category="builtin",
    risk=Risk.LOW,
    ui_exposed=False,
    core=True,  # cognitive builtin — always reachable regardless of an agent's tools allowlist
)
async def memory(inp: MemoryInput, ctx: InvocationContext) -> ToolResult:
    """Save something to your durable memory so you remember it across sessions. `add` a note, or
    `replace`/`remove` one by its exact `old_text`. No read needed — your memory is injected each
    turn. Use `target=user` for a durable fact about the person you're helping."""
    deps = ctx.deps
    gated = gate_memory(deps, inp)
    if gated is not None:
        return gated
    agent = ctx.agent or deps.settings.default_agent_def()

    # Kill switch (D15 #6): off → propose, never write, never block. The owner approves it later via
    # the Approve-to-apply UI (7e-f-3), which re-runs the gate + `apply_memory` below, auto-write
    # aside — shared with `skill_manage` through `services/agent/proposals.py`.
    if not deps.settings.memory.auto_write:
        return ToolResult(
            state=RunState.OK,
            summary=f"proposed {inp.action} to {inp.target} memory (not written — auto-write is off)",
            data={"proposed": inp.model_dump()},
        )
    return await apply_memory(deps, agent, inp)


def gate_memory(deps: "Deps | None", inp: MemoryInput) -> ToolResult | None:
    """The shared gate for the memory write path — used by the `memory` tool *and* the Approve-to-apply
    endpoint (proposals.py). Enforces availability + the master/user-profile switches + the arg checks
    the model can fix; returns a short-circuit `ToolResult` (DENIED/ERROR) or `None` to proceed. The
    only thing it does NOT check is `auto_write` — that gate is the tool's alone (off → propose), so an
    owner-approved apply legitimately bypasses it while every other rail still holds."""
    if deps is None or deps.memory is None:
        return ToolResult(state=RunState.DENIED, summary="memory is not available")
    cfg = deps.settings.memory
    if not cfg.enabled:
        return ToolResult(state=RunState.DENIED, summary="memory subsystem is disabled")
    if inp.target == "user" and not cfg.user_profile_enabled:
        return ToolResult(state=RunState.DENIED, summary="user-profile writes are disabled")
    # Arg checks the model can fix → ERROR (data, not an exception).
    if inp.action == "add" and not inp.content.strip():
        return ToolResult(
            state=RunState.ERROR, summary="nothing to add", error="`content` is required for add."
        )
    if inp.action in ("replace", "remove") and not (inp.old_text or "").strip():
        return ToolResult(
            state=RunState.ERROR,
            summary=f"{inp.action} needs old_text",
            error="`old_text` must be an exact substring of the current memory.",
        )
    return None


async def apply_memory(deps: "Deps", agent: "AgentDef", inp: MemoryInput) -> ToolResult:
    """Perform the memory write (assumes `gate_memory` passed). Called by the tool when `auto_write`
    is on, and by the Approve-to-apply endpoint on owner approval. A cap/write failure comes back as
    an ERROR result (the caller keeps a pending proposal so the owner can retry/dismiss)."""
    try:
        summary = deps.memory.write(agent, inp.target, inp.action, inp.content, inp.old_text)
    except MemoryCapError as exc:
        return ToolResult(state=RunState.ERROR, summary="memory over its cap", error=str(exc))
    except MemoryWriteError as exc:
        return ToolResult(state=RunState.ERROR, summary="memory write failed", error=str(exc))
    return ToolResult(state=RunState.OK, summary=summary)
