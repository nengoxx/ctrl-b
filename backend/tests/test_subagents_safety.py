"""C2-L6 (D40 §9) — the subagent safety rails, pinned against the real controls in `subagents.py`.

These pin the five §5.5 safety properties directly, so a regression that weakens any of them fails
here rather than in a live fan-out:

  (a) a child's privilege is CLAMPED to never exceed the parent (`resolve_child`, `clamp=True`);
  (b) `max_subagent_depth` blocks a deeper nesting level (`spawn_subagents` depth gate);
  (c) the per-agent fan-out cap AND the process-wide global semaphore bound concurrency
      (`ParallelOrchestrator`, instrumented in-flight counter);
  (d) `subagent_child_timeout_s` cancels a hung child (`run_subagent` → TIMEOUT result);
  (e) a headless (interactive=False) child denies a confirm-requiring action in place — it never
      suspends (a subagent has no UI to confirm against).

Fakes mirror the existing subagent tests (`test_durable_turns_slice3_wave3.py` §7 monkeypatches
`sub.run_subagent`; `test_tunables_aca8.py` drives the real orchestrator); the loop-level pins reuse
the `drain_run_calls` harness. Each runs on an isolated `$CTRLB_HOME` temp workspace.
"""

from __future__ import annotations

import asyncio
import contextlib
import os
import tempfile
import uuid
from pathlib import Path

from _async import drain_run_calls, run_async


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


def _run(coro):
    return run_async(coro)


def _guard():
    from app.services.agent.session import _LoopGuard

    return _LoopGuard(max_repeat=5, max_per_tool=10)


# ── (a) child privilege is clamped to the parent ─────────────────────────────────────────────────
def test_child_privilege_clamped_to_parent() -> None:
    from app.domain.agent import AgentDef
    from app.domain.enums import Privilege
    from app.services.agent.subagents import resolve_child

    class _FakeSettings:
        """Only `resolve_child` surface `resolve_child` touches: the named-agent lookup."""

        def __init__(self, sub: AgentDef) -> None:
            self._sub = sub

        def resolve_agent(self, _name: str) -> AgentDef:
            return self._sub

    parent = AgentDef(name="parent", privilege=Privilege.CONFIRM)

    # A child whose def asks for MORE autonomy than the parent → clamped down to the parent's rung.
    hungry = AgentDef(name="child", privilege=Privilege.FULL)
    clamped = resolve_child(_FakeSettings(hungry), parent, "child", clamp=True)
    assert clamped.privilege == Privilege.CONFIRM  # never escalates above the parent

    # Clamp disabled (owner opt-out) → the child keeps its declared (higher) privilege.
    unclamped = resolve_child(_FakeSettings(hungry), parent, "child", clamp=False)
    assert unclamped.privilege == Privilege.FULL

    # A child asking for LESS is never raised up to the parent (clamp is a ceiling, not a floor).
    meek = AgentDef(name="child", privilege=Privilege.READONLY)
    assert resolve_child(_FakeSettings(meek), parent, "child", clamp=True).privilege == Privilege.READONLY


# ── (b) max_subagent_depth blocks deeper nesting ─────────────────────────────────────────────────
def test_max_subagent_depth_blocks_deeper_nesting() -> None:
    from app.core.tool import InvocationContext
    from app.domain.enums import Actor, Privilege, RunState
    from app.services.agent import subagents
    from app.services.agent.subagents import SpawnInput, SubTask, spawn_subagents

    with _workspace(), _client() as c:
        deps = c.app.state.deps
        parent = deps.settings.default_agent_def()

        # At the depth cap → the spawn is DENIED before any child is built (no tokens spent).
        at_cap = InvocationContext(
            actor=Actor.AGENT,
            privilege=Privilege.FULL,
            deps=deps,
            depth=parent.max_subagent_depth,
            agent=parent,
        )
        res = _run(spawn_subagents(SpawnInput(tasks=[SubTask(task="x")]), at_cap))
        assert res.state == RunState.DENIED
        assert "max subagent depth" in res.summary

        # Below the cap → the depth gate does NOT bite (it proceeds to the orchestrator). Fake the
        # orchestrator so no real child runs — we only assert the depth gate let it through.
        class _FakeOrch:
            def __init__(self, **_kw) -> None: ...

            async def run_many(self, deps, children, *, depth):  # noqa: ANN001
                return []

        orig = subagents.ParallelOrchestrator
        subagents.ParallelOrchestrator = _FakeOrch  # type: ignore[misc]
        try:
            below = InvocationContext(
                actor=Actor.AGENT, privilege=Privilege.FULL, deps=deps, depth=0, agent=parent
            )
            res2 = _run(spawn_subagents(SpawnInput(tasks=[SubTask(task="x")]), below))
        finally:
            subagents.ParallelOrchestrator = orig  # type: ignore[misc]
        assert res2.state != RunState.DENIED
        assert "max subagent depth" not in res2.summary


# ── (c) per-agent + global semaphores bound concurrency ──────────────────────────────────────────
def test_concurrency_bounded_by_per_agent_and_global_sems() -> None:
    import app.services.agent.subagents as sub
    from app.domain.enums import RunState
    from app.services.agent.subagents import ParallelOrchestrator, SubResult

    async def peak_in_flight(per_agent: int, global_n: int | None, n_children: int, expected: int) -> int:
        """Run `n_children` fake children and return the observed peak concurrency. A `Barrier(expected)`
        inside each child makes concurrency a REQUIREMENT, not just a ceiling: a child cannot return until
        `expected` of them are simultaneously in flight, so an execution that accidentally became SERIAL
        (or whose binding cap regressed below `expected`) DEADLOCKS at the barrier — caught by the outer
        `wait_for` as a TimeoutError instead of silently passing at peak 1. The binding cap == `expected`,
        so the shared semaphore keeps the peak from EXCEEDING it → the peak is exactly `expected`."""
        live = {"cur": 0, "max": 0}
        barrier = asyncio.Barrier(expected)

        async def fake_run_subagent(deps, cdef, task, *, index, depth, timeout_s):  # noqa: ANN001
            live["cur"] += 1
            live["max"] = max(live["max"], live["cur"])
            await barrier.wait()  # blocks until `expected` children are concurrently here — or deadlocks
            live["cur"] -= 1
            return SubResult(index=index, agent="x", state=RunState.OK, summary="ok")

        orig = sub.run_subagent
        sub.run_subagent = fake_run_subagent
        try:
            gsem = asyncio.Semaphore(global_n) if global_n is not None else None
            orch = ParallelOrchestrator(per_agent=per_agent, global_sem=gsem, child_timeout_s=5)
            children = [(object(), f"t{i}") for i in range(n_children)]
            # wait_for turns a serial-regression deadlock at the barrier into a clean test failure.
            results = await asyncio.wait_for(orch.run_many(None, children, depth=1), timeout=5)
        finally:
            sub.run_subagent = orig
        assert len(results) == n_children  # every child produced a result
        return live["max"]

    # per-agent cap 2, global 5, 6 children → the per-agent cap binds: EXACTLY 2 must be in flight at once
    # (the barrier(2) proves ≥2 are concurrent; the semaphore proves ≤2) — a serial regression deadlocks.
    assert asyncio.run(peak_in_flight(2, 5, 6, expected=2)) == 2
    # per-agent 10 (loose), global 3, 6 children → the process-wide global cap binds: EXACTLY 3 concurrent.
    assert asyncio.run(peak_in_flight(10, 3, 6, expected=3)) == 3


# ── (d) subagent_child_timeout_s cancels a hung child ────────────────────────────────────────────
def test_child_timeout_cancels_a_hung_child() -> None:
    import app.services.agent.session as sess_mod
    from app.domain.enums import RunState
    from app.services.agent.subagents import run_subagent

    class _HangingSession:
        def __init__(self, *_a, **_kw) -> None: ...

        async def run_turn(self, thread, task):  # noqa: ANN001
            await asyncio.sleep(3600)  # never completes → the child_timeout must cancel it
            yield  # unreachable — makes this an async generator like the real run_turn

    with _workspace(), _client() as c:
        deps = c.app.state.deps
        agent_def = deps.settings.default_agent_def()
        orig = sess_mod.AgentSession
        sess_mod.AgentSession = _HangingSession  # type: ignore[misc,assignment]
        try:
            res = _run(run_subagent(deps, agent_def, "hang forever", index=0, depth=1, timeout_s=0.05))
        finally:
            sess_mod.AgentSession = orig  # type: ignore[misc]
        assert res.state == RunState.TIMEOUT  # the timeout fired — never raised, never hung the parent
        assert "timed out" in res.summary


# ── (e) headless confirm-requiring action → DENY, not suspend ────────────────────────────────────
def test_headless_confirm_denies_in_place_not_suspend() -> None:
    from app.domain.conversation import Message, Thread, ToolCallPart
    from app.domain.enums import Actor, RunState
    from app.services.action_service import InvokeOutcome
    from app.services.agent.session import AgentSession

    async def _needs_confirm(name, args, **kw):  # noqa: ANN001, ANN202
        return InvokeOutcome(needs_confirm=True, result=None, confirm_token="tok", confirm_prompt="proceed?")

    def _call(c):
        s = c.app.state
        thread = _run(s.threads.create(Thread()))
        cid = uuid.uuid4().hex
        assistant = Message(
            thread_id=thread.id,
            role="assistant",
            actor=Actor.AGENT,
            agent="default",
            parts=[
                ToolCallPart(call_id=cid, tool="ping_host", args={"host_id": "a"}, state=RunState.PENDING)
            ],
        )
        _run(s.messages.add(assistant))
        return thread, assistant

    with _workspace(), _client() as c:
        s = c.app.state
        agent = s.settings.resolve_agent(None)

        # Headless child (interactive=False): a confirm-gated call is DENIED in place, no suspension.
        headless = AgentSession(
            s.threads, s.messages, s.inference, s.settings, s.actions, agent, interactive=False
        )
        headless._actions.invoke = _needs_confirm  # type: ignore[method-assign]
        t1, a1 = _call(c)
        events, suspended, _ = drain_run_calls(headless, t1, a1, {}, _guard())
        assert not suspended  # a headless subagent never suspends the turn
        res = next(e for e in events if e.event == "tool.result").data["result"]
        assert res["state"] == "denied"
        assert "headless subagent" in res["summary"]
        assert not any(e.event == "tool.permission" for e in events)  # no confirm bubble emitted

        # Contrast: an INTERACTIVE session with the SAME confirm-needing call suspends instead —
        # pinning that the difference is exactly the `interactive` flag, not the tool.
        live = AgentSession(
            s.threads, s.messages, s.inference, s.settings, s.actions, agent, interactive=True
        )
        live._actions.invoke = _needs_confirm  # type: ignore[method-assign]
        t2, a2 = _call(c)
        events2, suspended2, _ = drain_run_calls(live, t2, a2, {}, _guard())
        assert suspended2
        assert any(e.event == "tool.permission" for e in events2)


if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    for fn in fns:
        fn()
        print(f"ok  {fn.__name__}")
    print(f"\n{len(fns)} passed")
