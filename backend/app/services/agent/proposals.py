"""Proposable builtins — the shared Approve-to-apply registry (7e-f-3, D15 #6).

Some builtins propose instead of writing when their auto-write switch is off (`memory.auto_write` /
`agent.skills_auto_write`): they return a non-blocking OK result carrying the pending edit in
`data["proposed"]`. The owner then approves it from the chat bubble, which calls `POST /api/agent/apply`
→ `apply_proposal`, performing the *same* write the tool would have, the auto-write gate aside.

Each proposable tool contributes its `(input_model, gate, apply)` triple — the same `gate_*`/`apply_*`
pieces the tool itself uses on the auto-write-on path — so the write logic lives in exactly one place
and a third proposable tool is one entry here. `gate` re-checks every rail except auto-write (master
switches, arg validity); `apply` performs the write and may itself return ERROR (over cap / stale
`old_text`), in which case the endpoint leaves the proposal pending so the owner can retry or dismiss.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING, Awaitable, Callable, cast

from pydantic import BaseModel

from app.domain.enums import RunState
from app.domain.result import ToolResult
from app.services.agent.memory_tool import MemoryInput, apply_memory, gate_memory
from app.services.agent.skill_tool import SkillManageInput, apply_skill, gate_skill

if TYPE_CHECKING:
    from app.domain.agent import AgentDef
    from app.services.deps import Deps

_Gate = Callable[["Deps | None", BaseModel], "ToolResult | None"]
_Apply = Callable[["Deps", "AgentDef", BaseModel], Awaitable[ToolResult]]


@dataclass(frozen=True)
class Proposable:
    """One proposable tool's write path: its input model + the shared gate/apply functions."""

    input_model: type[BaseModel]
    gate: _Gate
    apply: _Apply


#: Tools whose `data["proposed"]` the Approve-to-apply endpoint can carry out. Keyed by tool name (the
#: `tool` on the stored `ToolCallPart`), so the endpoint stays tool-agnostic.
#
#: Each tool's `gate_*`/`apply_*` narrows its input to a concrete model (`MemoryInput`, …); storing
#: them in one registry erases that to the common `BaseModel`-input `_Gate`/`_Apply` — the same
#: heterogeneous-registry contravariance as `ToolFn` (see `core/tool.py`). The `cast`s are that single
#: erasure and are runtime-safe: `apply_proposal` validates `args` into the entry's own `input_model`
#: before calling gate/apply, so each only ever sees its concrete type.
PROPOSABLE: dict[str, Proposable] = {
    "memory": Proposable(MemoryInput, cast(_Gate, gate_memory), cast(_Apply, apply_memory)),
    "skill_manage": Proposable(SkillManageInput, cast(_Gate, gate_skill), cast(_Apply, apply_skill)),
}


def is_proposable(tool: str) -> bool:
    return tool in PROPOSABLE


async def apply_proposal(deps: "Deps", agent: "AgentDef", tool: str, args: dict) -> ToolResult:
    """Carry out a previously-proposed write: validate `args` against the tool's input model, re-run
    its gate (every rail except auto-write), then apply. Returns the write's `ToolResult` — OK on a
    successful write, or a DENIED/ERROR the endpoint surfaces while keeping the proposal pending."""
    p = PROPOSABLE.get(tool)
    if p is None:
        return ToolResult(state=RunState.ERROR, summary=f"'{tool}' is not a proposable tool")
    inp = p.input_model.model_validate(args)
    gated = p.gate(deps, inp)
    if gated is not None:
        return gated
    return await p.apply(deps, agent, inp)
