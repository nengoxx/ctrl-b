"""Phase 18 Slice 0 · M3 (PROMPTS_PLAN §6 C-14) — `spawn_subagents` rejects an over-cap BATCH.

`max_concurrent_subagents` bounded CONCURRENCY only: the orchestrator created one TaskGroup task and
one archived thread per requested child and let them queue on the semaphore, so a model-emitted
`tasks` array of any length was accepted (`SpawnInput` has `min_length=1`, no maximum). The check now
lives in `spawn_subagents` BEFORE `resolve_child` — the schema can't see the parent — and reuses the
SAME cap (no second knob), so an over-cap batch spends nothing at all.

Fixture style mirrors `test_subagents_safety.py` (the sibling rails: clamp / depth / semaphores /
timeout), which is where the cap belongs conceptually.
"""

from __future__ import annotations

import contextlib
import os
import tempfile
from pathlib import Path

from _async import run_async


@contextlib.contextmanager
def _workspace(config_text: str = "server:\n  port: 5433\n"):
    tmp = Path(tempfile.mkdtemp())
    cfg = tmp / "config.yaml"
    cfg.write_text(config_text, encoding="utf-8")
    os.environ["CTRLB_HOME"] = str(tmp)
    os.environ["CTRLB_CONFIG"] = str(cfg)
    os.environ["CTRLB_DB"] = str(tmp / "t.db")
    try:
        yield tmp
    finally:
        for k in ("CTRLB_HOME", "CTRLB_CONFIG", "CTRLB_DB"):
            os.environ.pop(k, None)


def _client():
    from fastapi.testclient import TestClient

    from app.main import create_app

    return TestClient(create_app())


def _ctx(deps, parent):
    from app.core.tool import InvocationContext
    from app.domain.enums import Actor, Privilege

    return InvocationContext(actor=Actor.AGENT, privilege=Privilege.FULL, deps=deps, depth=0, agent=parent)


def _spawn(deps, parent, n: int, agent: str | None = None):
    from app.services.agent.subagents import SpawnInput, SubTask, spawn_subagents

    tasks = [SubTask(task=f"t{i}", agent=agent) for i in range(n)]
    return run_async(spawn_subagents(SpawnInput(tasks=tasks), _ctx(deps, parent)))


def _write_agent(home: Path, name: str, cap: int) -> None:
    """A specialist agent folder (D14) whose own fan-out cap differs from the parent's."""
    d = home / "agents" / name
    d.mkdir(parents=True, exist_ok=True)
    (d / "agent.yaml").write_text(f"max_concurrent_subagents: {cap}\n", encoding="utf-8")


@contextlib.contextmanager
def _no_children(monkeyed: dict):
    """Flag any child resolution / orchestration so 'nothing was created' is asserted, not assumed."""
    from app.services.agent import subagents as sub

    orig_resolve, orig_orch = sub.resolve_child, sub.ParallelOrchestrator

    def _resolve(*a, **kw):  # noqa: ANN002, ANN003
        monkeyed["resolved"] = monkeyed.get("resolved", 0) + 1
        return orig_resolve(*a, **kw)

    class _Orch:
        def __init__(self, **_kw) -> None:
            monkeyed["orchestrated"] = monkeyed.get("orchestrated", 0) + 1

        async def run_many(self, deps, children, *, depth, parent_origin):  # noqa: ANN001
            monkeyed["children"] = len(children)
            return []

    sub.resolve_child, sub.ParallelOrchestrator = _resolve, _Orch  # type: ignore[misc,assignment]
    try:
        yield
    finally:
        sub.resolve_child, sub.ParallelOrchestrator = orig_resolve, orig_orch  # type: ignore[misc]


def test_batch_at_the_cap_is_accepted() -> None:
    from app.domain.enums import RunState

    with _workspace(), _client() as c:
        deps = c.app.state.deps
        parent = deps.settings.default_agent_def()
        seen: dict = {}
        with _no_children(seen):
            res = _spawn(deps, parent, parent.max_concurrent_subagents)
        assert res.state != RunState.DENIED
        assert seen["children"] == parent.max_concurrent_subagents  # every task reached the orchestrator


def test_batch_over_the_cap_is_rejected_before_anything_is_created() -> None:
    from app.domain.enums import RunState
    from app.services.agent.subagents import M3_BATCH_REJECTED

    with _workspace(), _client() as c:
        deps = c.app.state.deps
        parent = deps.settings.default_agent_def()
        cap = parent.max_concurrent_subagents
        seen: dict = {}
        with _no_children(seen):
            res = _spawn(deps, parent, cap + 1)
        assert res.state == RunState.DENIED
        assert res.output == M3_BATCH_REJECTED.format(count=cap + 1, max=cap)
        assert str(cap + 1) in res.summary and str(cap) in res.summary
        assert seen == {}  # zero children resolved, zero orchestrators, zero threads


def test_the_cap_is_the_spawning_agents_regardless_of_named_task_agents() -> None:
    """The batch ceiling is the SPAWNING agent's cap (ruled), never the per-task `agent`'s: a named
    child with a HUGE cap can't lift a batch over its parent's, and one with a TINY cap can't shrink
    a batch its parent allows."""
    from app.domain.enums import RunState

    with _workspace() as home, _client() as c:
        deps = c.app.state.deps
        default = deps.settings.default_agent_def()
        n = default.max_concurrent_subagents + 2
        _write_agent(home, "huge", cap=99)
        _write_agent(home, "tiny", cap=1)
        assert deps.settings.resolve_agent("huge").max_concurrent_subagents == 99
        seen: dict = {}
        with _no_children(seen):
            # Every task names the roomy child — the DEFAULT parent's cap still refuses the batch.
            assert _spawn(deps, default, n, agent="huge").state == RunState.DENIED
            assert seen == {}
            # …and every task names the cap-1 child — the roomy parent still admits all n.
            generous = default.model_copy(update={"max_concurrent_subagents": n})
            assert _spawn(deps, generous, n, agent="tiny").state != RunState.DENIED
            assert seen["children"] == n


if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    for fn in fns:
        fn()
        print(f"ok  {fn.__name__}")
    print(f"\n{len(fns)} passed")
