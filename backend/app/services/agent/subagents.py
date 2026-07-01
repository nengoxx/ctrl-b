"""Subagents — delegate scoped tasks to other agent definitions (DESIGN §5.5, D11).

`spawn_subagents` is a normal builtin tool: the model hands it a *batch* of tasks (a single
subagent is a batch of one), each optionally targeting a named `AgentDef`. The tool builds a child
`AgentSession` per task — each on its own ephemeral, archived thread, run **headless**
(`interactive=False`, so a confirm-gated call denies in place rather than stalling) — and runs them
**concurrently** through a swappable `Orchestrator`. The default `ParallelOrchestrator` uses an
`asyncio.TaskGroup` (structured concurrency: cancelling the parent cancels the whole subtree) under
a per-agent fan-out cap *and* a process-wide semaphore so the box/LLM backend isn't swamped.

Safety rails (§5.5): depth is bounded by the parent's `max_subagent_depth`; a child's privilege is
**clamped to never exceed the parent's** (no escalation); a child *error* yields a `SubResult(ERROR)`
rather than killing siblings (partial success is preserved + reported back to the parent model).

The tool runs through the same `ActionService` as everything else — at the default agent's CONFIRM
privilege it's MED-risk so the owner confirms a fan-out before tokens are spent; an `auto_low`/`full`
agent spawns without a prompt.
"""

from __future__ import annotations

import asyncio
import logging
from contextlib import AsyncExitStack
from dataclasses import dataclass
from typing import TYPE_CHECKING, Protocol

from pydantic import BaseModel, Field

from app.core.tool import InvocationContext, action
from app.domain.agent import AgentDef
from app.domain.conversation import Thread
from app.domain.enums import Privilege, Risk, RunState
from app.domain.result import ToolResult

if TYPE_CHECKING:
    from app.services.deps import Deps

log = logging.getLogger(__name__)

#: Privilege ordered by autonomy (READONLY < CONFIRM < AUTO_LOW < FULL). A child is clamped so it
#: can never run at a higher rung than its parent (DESIGN §5.5 "never escalate above parent").
_PRIV_ORDER = {
    Privilege.READONLY: 0,
    Privilege.CONFIRM: 1,
    Privilege.AUTO_LOW: 2,
    Privilege.FULL: 3,
}

#: Per-child wall-clock cap so a stuck child can't hold the batch open forever (§5.5).
_CHILD_TIMEOUT_S = 180.0


def _clamp(child: Privilege, parent: Privilege) -> Privilege:
    return child if _PRIV_ORDER[child] <= _PRIV_ORDER[parent] else parent


def resolve_child(settings, parent: AgentDef, name: str | None, *, clamp: bool) -> AgentDef:
    """Resolve the `AgentDef` for one subagent (§5.5). A subagent **inherits every parameter from
    its parent** — model, context-window/compaction, privilege, tool/skill allowlists, iteration &
    fan-out caps — and a *named* subagent def overlays only the fields it explicitly sets (so
    "configure just the prompt" inherits everything else). No name → the subagent is a full clone of
    the parent (its prompt included). Privilege is clamped to never exceed the parent unless the
    owner disabled `agent.subagent_clamp_privilege`."""
    if not name:
        child = parent
    else:
        sub = settings.resolve_agent(name)
        # Overlay only the fields the subagent def explicitly set (pydantic tracks them); the rest
        # inherit the parent's values. `name` always comes from the subagent.
        overlay = {f: getattr(sub, f) for f in sub.model_fields_set if f != "name"}
        child = parent.model_copy(update={**overlay, "name": sub.name})
    if clamp:
        child = child.model_copy(update={"privilege": _clamp(child.privilege, parent.privilege)})
    return child


@dataclass
class SubResult:
    """One child's outcome, aggregated back into the tool result the parent model reads."""

    index: int
    agent: str
    state: RunState
    summary: str
    output: str = ""


class SubTask(BaseModel):
    task: str = Field(min_length=1, description="The instruction for this subagent.")
    agent: str | None = Field(
        default=None, description="Name of the AgentDef to run this task (defaults to the batch agent)."
    )


class SpawnInput(BaseModel):
    """A batch of subtasks run in parallel. `agent` is the default AgentDef for tasks that don't
    name their own; omit it to reuse the spawning agent."""

    tasks: list[SubTask] = Field(min_length=1, description="Subtasks to delegate, run concurrently.")
    agent: str | None = Field(default=None, description="Default AgentDef name for the batch.")


class Orchestrator(Protocol):
    """How a batch of children is executed — the swappable strategy (D11). The default runs them in
    bounded parallel; a sequential or map-reduce strategy is a drop-in."""

    async def run_many(
        self, deps: "Deps", children: list[tuple[AgentDef, str]], *, depth: int
    ) -> list[SubResult]: ...


class ParallelOrchestrator(Orchestrator):
    """Bounded-parallel default (§5.5): each child runs inside one `asyncio.TaskGroup` under a
    per-agent fan-out semaphore *and* the process-wide `global_sem` (held across the whole tree).
    Children catch their own errors (so a failure doesn't cancel siblings); cancelling the parent
    cancels the group."""

    def __init__(
        self,
        per_agent: int,
        global_sem: asyncio.Semaphore | None,
        child_timeout_s: float = _CHILD_TIMEOUT_S,
    ) -> None:
        self._per = asyncio.Semaphore(max(1, per_agent))
        self._global = global_sem
        self._timeout = child_timeout_s

    async def run_many(
        self, deps: "Deps", children: list[tuple[AgentDef, str]], *, depth: int
    ) -> list[SubResult]:
        results: list[SubResult | None] = [None] * len(children)

        async def one(i: int, cdef: AgentDef, task: str) -> None:
            async with AsyncExitStack() as stack:
                # Global cap before per-agent so the tree-wide limit is honored first (§5.5).
                if self._global is not None:
                    await stack.enter_async_context(self._global)
                await stack.enter_async_context(self._per)
                results[i] = await run_subagent(
                    deps, cdef, task, index=i, depth=depth, timeout_s=self._timeout
                )

        async with asyncio.TaskGroup() as tg:
            for i, (cdef, task) in enumerate(children):
                tg.create_task(one(i, cdef, task))

        # `one` always assigns (run_subagent never raises); fall back defensively just in case.
        return [
            r or SubResult(index=i, agent="?", state=RunState.ERROR, summary="no result")
            for i, r in enumerate(results)
        ]


async def run_subagent(
    deps: "Deps",
    agent_def: AgentDef,
    task: str,
    *,
    index: int,
    depth: int,
    timeout_s: float,
) -> SubResult:
    """Run one child agent to completion on its own ephemeral (archived) thread, headless, and
    return its final answer as a `SubResult`. Never raises — any failure/timeout becomes a result
    state the parent model can reason about (partial success preserved, §5.5)."""
    # Local import: session.py → action_service.py → deps.py, so importing at module load would
    # cycle through this module's `Deps` typing. Imported here, the cycle is broken.
    from app.services.agent.session import AgentSession

    thread = Thread(title=f"[subagent:{agent_def.name}] {task[:48]}", agent=agent_def.name, archived=True)
    await deps.threads.create(thread)
    session = AgentSession(
        deps.threads,
        deps.messages,
        deps.inference,
        deps.settings,
        deps.actions,
        agent=agent_def,
        skills=deps.skills,
        selector=deps.selector,
        memory=deps.memory,
        interactive=False,
        depth=depth,
    )
    try:
        async with asyncio.timeout(timeout_s):
            async for _ in session.run_turn(thread, task):
                pass
    except asyncio.CancelledError, KeyboardInterrupt:
        raise  # let cancellation propagate so the TaskGroup unwinds the subtree
    except TimeoutError:
        return SubResult(
            index=index,
            agent=agent_def.name,
            state=RunState.TIMEOUT,
            summary=f"subagent timed out after {int(timeout_s)}s",
        )
    except Exception as exc:  # noqa: BLE001 — a child failure must not crash the parent turn
        log.warning("subagent %s failed: %s", agent_def.name, exc)
        return SubResult(index=index, agent=agent_def.name, state=RunState.ERROR, summary=str(exc)[:200])

    msgs = await deps.messages.list(thread.id)
    text = next((m.text() for m in reversed(msgs) if m.role == "assistant" and m.text().strip()), "")
    return SubResult(
        index=index,
        agent=agent_def.name,
        state=RunState.OK if text else RunState.ERROR,
        summary=(text[:160] + "…") if len(text) > 160 else (text or "subagent produced no answer"),
        output=text,
    )


def _aggregate(results: list[SubResult]) -> ToolResult:
    """Fold the children's results into one `ToolResult` for the parent model: a one-line tally as
    the summary, each child's answer in the output, and the structured list in `data` (§5.5)."""
    ok = sum(1 for r in results if r.state == RunState.OK)
    n = len(results)
    state = RunState.OK if ok else RunState.ERROR
    lines = []
    for r in results:
        lines.append(f"[{r.index}] {r.agent} ({r.state.value}):\n{r.output or r.summary}")
    return ToolResult(
        state=state,
        summary=f"{ok}/{n} subagent{'s' if n != 1 else ''} completed",
        output="\n\n".join(lines),
        data={"subagents": [r.__dict__ for r in results]},
    )


@action(
    "spawn_subagents",
    title="Spawn subagents",
    description=(
        "Delegate two or more INDEPENDENT sub-tasks to subagents that run in parallel, each with its "
        "own context, and return their results. Use only when sub-tasks are independent of each other "
        "(e.g. research several separate topics at once). Do NOT use it for a single task or for "
        "sequential steps that depend on each other — do those yourself with the relevant tools."
    ),
    category="builtin",
    risk=Risk.MED,
    ui_exposed=False,
    agent_exposed=True,
)
async def spawn_subagents(inp: SpawnInput, ctx: InvocationContext) -> ToolResult:
    deps = ctx.deps
    if deps is None or deps.threads is None or deps.inference is None or deps.actions is None:
        return ToolResult(state=RunState.DENIED, summary="subagents are not available")

    parent = ctx.agent or deps.settings.default_agent_def()
    if ctx.depth >= parent.max_subagent_depth:
        return ToolResult(
            state=RunState.DENIED,
            summary=f"max subagent depth ({parent.max_subagent_depth}) reached — not spawning",
        )

    clamp = deps.settings.agent.subagent_clamp_privilege
    children: list[tuple[AgentDef, str]] = [
        (resolve_child(deps.settings, parent, t.agent or inp.agent, clamp=clamp), t.task) for t in inp.tasks
    ]

    orchestrator = ParallelOrchestrator(
        per_agent=parent.max_concurrent_subagents, global_sem=deps.subagent_sem
    )
    results = await orchestrator.run_many(deps, children, depth=ctx.depth + 1)
    return _aggregate(results)
