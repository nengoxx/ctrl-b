"""ACA Slice 4 wave 4 — the parallel prefix EXECUTOR (D40 §5), wired as `_run_calls`' head.

`_classify_batch` (wave 3) splits a batch into a parallel read-only prefix + a serial tail; this wave
runs the prefix as bounded `asyncio.Task`s under a single completion consumer, persists each result as
it resolves (persist-before-emit, model-order layout), then the verbatim serial loop runs the tail
(prefix calls are `_RESOLVED` → `continue`). These pins cover:

  • THE AUDIT PIN — a [read_a, read_b, read_a(repeat-demoted), mutating] batch run twice, once parallel
    (max_parallel_tools≥2) and once all-serial (max_parallel_tools=1), must land IDENTICAL guard state
    (counts / tool_counts / last_results / seen_results), invoke each call exactly once (the demoted
    twin is suppressed, never re-run), and produce exactly ONE tool message with parts in model order;
  • wall-clock ≈ max not Σ (two 0.2s fake reads finish < 0.35s at max_parallel_tools≥2);
  • the semaphore bound (4 slow reads at max_parallel_tools=2 → observed max concurrency == 2);
  • [read, read, question] → both reads parallel, exactly ONE suspension on the question in the tail;
  • the D40 §4 belts (a read-only-declared tool whose invoke returns needs_confirm / AWAITING_ANSWER)
    → a loud error result, no suspension, the turn continues — and its model-facing `output` is the
    registry's `parallel_misdeclared` (Phase 18 Slice 3.5), so a `prompts:` entry reaches it;
  • cancel mid-prefix → the completed call persists + harvests, pending tasks are cancelled AND awaited
    (their cleanup runs — no orphans), unresolved calls stay PENDING for the reconciler;
  • made_progress semantics — a belt result never flips it; a normal new result does.

Drives the REAL `AgentSession` + SQLite path against a temp workspace (no LLM); `_actions.invoke` is
stubbed per-call. Fixture style mirrors `test_percall_persistence_d40.py`.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import os
import tempfile
import time
import uuid
from pathlib import Path

import anyio
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


def _guard(*, max_repeat: int = 5, max_per_tool: int = 10):
    from app.services.agent.session import _LoopGuard

    return _LoopGuard(max_repeat=max_repeat, max_per_tool=max_per_tool)


def _session(c, specs: list[dict], *, max_parallel: int = 4, interactive: bool = True):
    """Session + a persisted assistant holding `specs` as PENDING `ToolCallPart`s. Each spec:
    `{tool, args?}`. Returns (session, thread, assistant, [call_ids])."""
    from app.domain.conversation import Message, Thread, ToolCallPart
    from app.domain.enums import Actor, RunState
    from app.services.agent.session import AgentSession

    s = c.app.state
    agent = s.settings.resolve_agent(None).model_copy(update={"max_parallel_tools": max_parallel})
    session = AgentSession(
        s.threads, s.messages, s.inference, s.settings, s.actions, agent, interactive=interactive
    )
    thread = run_async(s.threads.create(Thread()))
    cids = [uuid.uuid4().hex for _ in specs]
    parts = [
        ToolCallPart(call_id=cid, tool=spec["tool"], args=spec.get("args", {}), state=RunState.PENDING)
        for cid, spec in zip(cids, specs, strict=True)
    ]
    assistant = Message(
        thread_id=thread.id, role="assistant", actor=Actor.AGENT, agent="default", parts=parts
    )
    run_async(s.messages.add(assistant))
    return session, thread, assistant, cids


def _ok(tool: str, args: dict) -> object:
    """A deterministic OK InvokeOutcome (result depends only on tool+args → parallel and serial runs
    of the same call produce EQUAL ToolResults, so last_results/seen_results compare cleanly)."""
    from app.domain.enums import RunState
    from app.domain.result import ToolResult
    from app.services.action_service import InvokeOutcome

    return InvokeOutcome(
        needs_confirm=False,
        result=ToolResult(state=RunState.OK, summary=f"ran {tool}", output=json.dumps(args, sort_keys=True)),
    )


def _drive(session, thread, assistant, guard, resume_tokens=None):
    """Drain the async-generator `_run_calls`, returning (events, outcome)."""
    from app.services.agent.session import _BatchOutcome

    outcome = _BatchOutcome()

    async def _collect():
        return [
            ev
            async for ev in session._run_calls(thread, assistant, resume_tokens or {}, guard, outcome=outcome)
        ]

    events = run_async(_collect())
    return events, outcome


def _tool_rows(c, thread):
    msgs = run_async(c.app.state.messages.list(thread.id))
    return [m for m in msgs if m.role == "tool"]


def _states(c, thread):
    msgs = run_async(c.app.state.messages.list(thread.id))
    a = next(m for m in msgs if m.role == "assistant")
    return {cp.call_id: cp.state for cp in a.tool_calls()}


# ── THE AUDIT PIN: parallel guard-state == a reference all-serial run of the same batch ───────────
def test_audit_pin_parallel_equals_serial_reference() -> None:
    from app.domain.enums import RunState

    specs = [
        {"tool": "ping_host", "args": {"host_id": "a"}},
        {"tool": "ping_host", "args": {"host_id": "b"}},
        {"tool": "ping_host", "args": {"host_id": "a"}},  # repeat of call 1 → demoted to the tail
        {"tool": "start_service", "args": {"service_id": "s"}},  # mutator → serial tail
    ]

    def make_fake(log: list):
        async def fake_invoke(tool, args, **kw):
            log.append((tool, json.dumps(args, sort_keys=True)))
            return _ok(tool, args)

        return fake_invoke

    def run(max_parallel: int) -> tuple:
        with _workspace(), _client() as c:
            session, thread, assistant, cids = _session(c, specs, max_parallel=max_parallel)
            log: list = []
            session._actions.invoke = make_fake(log)
            guard = _guard(max_repeat=1, max_per_tool=10)  # repeat-cap 1 → the 3rd call is demoted
            events, outcome = _drive(session, thread, assistant, guard)
            rows = _tool_rows(c, thread)
            return log, guard, outcome, events, rows, cids

    p_log, p_guard, p_out, p_events, p_rows, p_cids = run(4)  # parallel
    s_log, s_guard, s_out, s_events, s_rows, s_cids = run(1)  # all-serial reference

    # (a) no call invoked twice — and the same invoke multiset in both runs (the demoted twin, args a,
    #     is SUPPRESSED in both, so invoked exactly once total).
    assert sorted(p_log) == sorted(s_log)
    assert len(p_log) == 3  # a, b, start_service — the repeat is suppressed, never invoked
    assert p_log.count(("ping_host", json.dumps({"host_id": "a"}))) == 1

    # (b) final guard state EQUAL to the serial reference.
    assert p_guard.counts == s_guard.counts
    assert p_guard.tool_counts == s_guard.tool_counts
    assert p_guard.last_results == s_guard.last_results
    assert p_guard.seen_results == s_guard.seen_results
    assert p_guard.denied_sigs == s_guard.denied_sigs
    # concrete: ping_host twice + start_service once; the repeat sig capped at 1.
    assert p_guard.tool_counts == {"ping_host": 2, "start_service": 1}

    # (c) exactly ONE tool message, parts in model order (matching the serial reference's order).
    assert len(p_rows) == 1
    assert [r.call_id for r in p_rows[0].tool_results()] == p_cids  # model order, all four parts
    assert [r.call_id for r in s_rows[0].tool_results()] == s_cids
    # the demoted twin's part is the repeat-suppressed echo (present, in order, both runs)
    assert p_rows[0].tool_results()[2].result.state == s_rows[0].tool_results()[2].result.state
    # every call is resolved (prefix OK, twin suppressed, mutator OK) — none left PENDING.
    p_result_states = {r.call_id: r.result.state for r in p_rows[0].tool_results()}
    assert all(st != RunState.PENDING for st in p_result_states.values())


# ── wall-clock ≈ max not Σ ────────────────────────────────────────────────────────────────────────
def test_wall_clock_is_max_not_sum() -> None:
    with _workspace(), _client() as c:
        specs = [
            {"tool": "ping_host", "args": {"host_id": "a"}},
            {"tool": "ping_host", "args": {"host_id": "b"}},
        ]
        session, thread, assistant, cids = _session(c, specs, max_parallel=2)

        async def fake_invoke(tool, args, **kw):
            await asyncio.sleep(0.2)
            return _ok(tool, args)

        session._actions.invoke = fake_invoke
        t0 = time.monotonic()
        events, outcome = _drive(session, thread, assistant, _guard())
        elapsed = time.monotonic() - t0

        # both resolved (events stream in completion order — UI-only, D40); the wall clock is the point.
        assert {e.data["callId"] for e in events if e.event == "tool.result"} == set(cids)
        assert elapsed < 0.35, f"expected ~0.2s (parallel), got {elapsed:.3f}s (Σ would be ~0.4s)"


# ── the semaphore bound: observed max concurrency == max_parallel_tools ───────────────────────────
def test_semaphore_bounds_concurrency() -> None:
    with _workspace(), _client() as c:
        specs = [{"tool": "ping_host", "args": {"host_id": h}} for h in "abcd"]
        session, thread, assistant, cids = _session(c, specs, max_parallel=2)
        cur = {"n": 0, "max": 0}

        async def fake_invoke(tool, args, **kw):
            cur["n"] += 1
            cur["max"] = max(cur["max"], cur["n"])
            await asyncio.sleep(0.05)  # hold the slot so overlap is observable
            cur["n"] -= 1
            return _ok(tool, args)

        session._actions.invoke = fake_invoke
        _drive(session, thread, assistant, _guard())
        assert cur["max"] == 2, f"semaphore(2) must cap concurrency at 2, saw {cur['max']}"


# ── [read, read, question] → reads parallel, ONE suspension in the tail ───────────────────────────
def test_reads_parallel_then_single_question_suspension() -> None:
    from app.domain.enums import RunState
    from app.domain.result import ToolResult
    from app.services.action_service import InvokeOutcome

    with _workspace(), _client() as c:
        specs = [
            {"tool": "ping_host", "args": {"host_id": "a"}},
            {"tool": "ping_host", "args": {"host_id": "b"}},
            {"tool": "question", "args": {"prompt": "which host?"}},
        ]
        session, thread, assistant, cids = _session(c, specs, max_parallel=4)
        cid_a, cid_b, cid_q = cids

        async def fake_invoke(tool, args, **kw):
            if tool == "question":
                return InvokeOutcome(
                    needs_confirm=False,
                    result=ToolResult(state=RunState.AWAITING_ANSWER, summary="which host?"),
                )
            return _ok(tool, args)

        session._actions.invoke = fake_invoke
        events, outcome = _drive(session, thread, assistant, _guard())

        results = [e.data["callId"] for e in events if e.event == "tool.result"]
        questions = [e for e in events if e.event == "tool.question"]
        # both reads ran (parallel prefix); tool.result EVENTS stream in COMPLETION order (UI-only, D40
        # — model order is preserved in the persisted PARTS), so compare as a set.
        assert set(results) == {cid_a, cid_b}
        assert cid_q not in results  # the question is NOT in the prefix
        # persisted parts ARE in model order (the two reads, then the question resolved in the tail).
        rows = _tool_rows(c, thread)
        assert [r.call_id for r in rows[0].tool_results()][:2] == [cid_a, cid_b]
        assert len(questions) == 1 and questions[0].data["callId"] == cid_q  # exactly ONE suspension
        assert outcome.suspended is True


# ── belts: a read-only-declared tool whose invoke suspends → error, no suspension, turn continues ──
def test_belts_misdeclared_suspension_degrades_loudly() -> None:
    from app.core.tool import FunctionTool, ToolSpec
    from app.domain.enums import Risk, RunState
    from app.domain.result import ToolResult
    from app.services.action_service import InvokeOutcome

    class _NoArgs(__import__("pydantic").BaseModel):
        pass

    async def _noop(inp, ctx):
        return ToolResult(state=RunState.OK, summary="ok")

    # "running" = audit LOW-4: a non-`_RESOLVED`, non-AWAITING return (a state no tool may hand back)
    # must ALSO belt — an unresolved `cp.state` would make the serial loop re-invoke the call.
    for misdeclare in ("needs_confirm", "awaiting_answer", "running"):
        with _workspace(), _client() as c:
            reg = c.app.state.actions.registry
            # read_only builtin, NOT suspending → admitted to the prefix; but its invoke misbehaves.
            spec = ToolSpec(
                name="_belt_probe_d40",
                title="belt probe",
                category="builtin",
                read_only=True,
                risk=Risk.LOW,
                input_model=_NoArgs,
            )
            reg.register(FunctionTool(spec=spec, fn=_noop))
            try:
                specs = [{"tool": "_belt_probe_d40"}, {"tool": "ping_host", "args": {"host_id": "a"}}]
                session, thread, assistant, cids = _session(c, specs, max_parallel=4)
                cid_belt, cid_ping = cids

                async def fake_invoke(tool, args, _md=misdeclare, **kw):
                    if tool == "_belt_probe_d40":
                        if _md == "needs_confirm":
                            return InvokeOutcome(needs_confirm=True, confirm_token="t", confirm_prompt="?")
                        state = RunState.RUNNING if _md == "running" else RunState.AWAITING_ANSWER
                        return InvokeOutcome(
                            needs_confirm=False,
                            result=ToolResult(state=state, summary="?"),
                        )
                    return _ok(tool, args)

                session._actions.invoke = fake_invoke
                events, outcome = _drive(session, thread, assistant, _guard())

                assert outcome.suspended is False  # a belt NEVER suspends the turn
                assert [e.event for e in events] == ["tool.result", "tool.result"]  # both, no question
                rows = _tool_rows(c, thread)
                by_id = {r.call_id: r.result for r in rows[0].tool_results()}
                assert by_id[cid_belt].state == RunState.ERROR
                assert "misdeclared" in by_id[cid_belt].summary
                assert by_id[cid_ping].state == RunState.OK  # the normal read still completed
            finally:
                reg.remove("_belt_probe_d40")


def test_belt_text_honours_a_prompts_override() -> None:
    """Phase 18 Slice 3.5: the belt's `output` — the part the MODEL reads — is the registry's
    `parallel_misdeclared`, so an owner `prompts:` entry reaches it. The `summary` beside it is
    per-call outcome text and deliberately stays code (it names the tool)."""
    from app.config import PromptOverride
    from app.core.tool import FunctionTool, ToolSpec
    from app.domain.enums import Risk, RunState
    from app.domain.result import ToolResult
    from app.services.action_service import InvokeOutcome

    class _NoArgs(__import__("pydantic").BaseModel):
        pass

    async def _noop(inp, ctx):
        return ToolResult(state=RunState.OK, summary="ok")

    with _workspace(), _client() as c:
        reg = c.app.state.actions.registry
        spec = ToolSpec(
            name="_belt_probe_p18",
            title="belt probe",
            category="builtin",
            read_only=True,
            risk=Risk.LOW,
            input_model=_NoArgs,
        )
        reg.register(FunctionTool(spec=spec, fn=_noop))
        try:
            specs = [{"tool": "_belt_probe_p18"}, {"tool": "ping_host", "args": {"host_id": "a"}}]
            session, thread, assistant, cids = _session(c, specs, max_parallel=4)
            cid_belt, _cid_ping = cids
            c.app.state.settings.prompts["parallel_misdeclared"] = PromptOverride(
                override="Excluded — send it on its own."
            )

            async def fake_invoke(tool, args, **kw):
                if tool == "_belt_probe_p18":
                    return InvokeOutcome(needs_confirm=True, confirm_token="t", confirm_prompt="?")
                return _ok(tool, args)

            session._actions.invoke = fake_invoke
            _drive(session, thread, assistant, _guard())

            rows = _tool_rows(c, thread)
            by_id = {r.call_id: r.result for r in rows[0].tool_results()}
            assert by_id[cid_belt].output == "Excluded — send it on its own."
            assert "misdeclared" in by_id[cid_belt].summary  # the code-owned half is untouched
        finally:
            reg.remove("_belt_probe_p18")


# ── cancel mid-prefix: completed call harvested+persisted, pending cancelled AND awaited ───────────
def test_cancel_mid_prefix_persists_completed_awaits_pending() -> None:
    from app.domain.enums import RunState
    from app.services.agent.session import _BatchOutcome

    with _workspace(), _client() as c:
        specs = [{"tool": "ping_host", "args": {"host_id": h}} for h in "abc"]
        session, thread, assistant, cids = _session(c, specs, max_parallel=4)
        cid_a, cid_b, cid_c = cids
        cleanup_ran: set[str] = set()  # hosts whose task cleanup ran (proves cancel was awaited)

        async def fake_invoke(tool, args, **kw):
            h = args["host_id"]
            if h == "a":
                return _ok(tool, args)  # completes immediately
            try:
                await asyncio.sleep(3600)  # b, c block until cancelled
            finally:
                cleanup_ran.add(h)
            raise AssertionError("unreachable")

        session._actions.invoke = fake_invoke
        cancelled = {"v": False}
        first_result = asyncio.Event()

        async def runner():
            try:
                outcome = _BatchOutcome()
                async for ev in session._run_calls(thread, assistant, {}, _guard(), outcome=outcome):
                    if ev.event == "tool.result":
                        first_result.set()
            except anyio.get_cancelled_exc_class():
                cancelled["v"] = True
                raise

        async def drive():
            async with anyio.create_task_group() as tg:
                tg.start_soon(runner)
                await first_result.wait()  # call a completed + persisted + emitted
                tg.cancel_scope.cancel()

        run_async(drive())
        assert cancelled["v"] is True
        assert cleanup_ran == {"b", "c"}  # both pending tasks were cancelled AND awaited (cleanup ran)

        states = _states(c, thread)
        assert states[cid_a] == RunState.OK  # completed call survived (per-call persist + harvest)
        assert states[cid_b] == RunState.PENDING  # in-flight, cancelled → reconciler's job (A11)
        assert states[cid_c] == RunState.PENDING
        rows = _tool_rows(c, thread)
        assert len(rows) == 1
        assert [r.call_id for r in rows[0].tool_results()] == [cid_a]  # only the completed call durable


# ── made_progress: a belt result never flips it; a normal new result does ─────────────────────────
def test_made_progress_belt_vs_normal() -> None:
    from app.core.tool import FunctionTool, ToolSpec
    from app.domain.enums import Risk, RunState
    from app.domain.result import ToolResult
    from app.services.action_service import InvokeOutcome

    class _NoArgs(__import__("pydantic").BaseModel):
        pass

    async def _noop(inp, ctx):
        return ToolResult(state=RunState.OK, summary="ok")

    # normal: two fresh reads → made_progress True.
    with _workspace(), _client() as c:
        specs = [{"tool": "ping_host", "args": {"host_id": h}} for h in "ab"]
        session, thread, assistant, _ = _session(c, specs, max_parallel=4)

        async def fake_invoke(tool, args, **kw):
            return _ok(tool, args)

        session._actions.invoke = fake_invoke
        _, outcome = _drive(session, thread, assistant, _guard())
        assert outcome.made_progress is True

    # belt-only: two misdeclared reads → made_progress stays False (belts are no-progress).
    with _workspace(), _client() as c:
        reg = c.app.state.actions.registry
        spec = ToolSpec(
            name="_belt_np_d40",
            title="belt",
            category="builtin",
            read_only=True,
            risk=Risk.LOW,
            input_model=_NoArgs,
        )
        reg.register(FunctionTool(spec=spec, fn=_noop))
        try:
            # two calls of the belt tool (distinct call_ids; same no-arg sig — both admit under max_repeat).
            specs = [{"tool": "_belt_np_d40"}, {"tool": "_belt_np_d40"}]
            session, thread, assistant, _ = _session(c, specs, max_parallel=4)

            async def fake_invoke(tool, args, **kw):
                return InvokeOutcome(needs_confirm=True, confirm_token="t", confirm_prompt="?")

            session._actions.invoke = fake_invoke
            _, outcome = _drive(session, thread, assistant, _guard())
            assert outcome.made_progress is False
        finally:
            reg.remove("_belt_np_d40")


# ── incremental streaming: a fast call's result + row land WHILE a sibling is still gated ─────────
def test_prefix_streams_incrementally_fast_lands_while_slow_still_blocked() -> None:
    """Pins per-call INCREMENTAL streaming (not await-all-then-emit-all — a regression the wall-clock
    test would NOT catch). Two prefix calls: `a` FAST, `b` blocked on an unset gate. Driving the
    generator by hand, the FIRST `__anext__` MUST yield `a`'s `tool.result` AND commit `a`'s durable
    row while `b` is still blocked. Were the executor to gather all tasks before emitting, that first
    `__anext__` would block on `b`'s gate → the `wait_for` fires and the test fails."""
    from app.domain.enums import RunState
    from app.services.agent.session import _BatchOutcome

    with _workspace(), _client() as c:
        specs = [
            {"tool": "ping_host", "args": {"host_id": "a"}},  # fast
            {"tool": "ping_host", "args": {"host_id": "b"}},  # gated
        ]
        session, thread, assistant, cids = _session(c, specs, max_parallel=4)
        cid_a, cid_b = cids
        gate = asyncio.Event()  # starts UNSET → call b cannot resolve until we release it

        async def fake_invoke(tool, args, **kw):
            if args["host_id"] == "b":
                await gate.wait()  # blocks the slow call
            return _ok(tool, args)

        session._actions.invoke = fake_invoke

        async def scenario():
            outcome = _BatchOutcome()
            gen = session._run_calls(thread, assistant, {}, _guard(), outcome=outcome)
            # If streaming regressed to await-all, this blocks on b's gate → wait_for raises.
            first = await asyncio.wait_for(gen.__anext__(), timeout=2)
            assert first.event == "tool.result"
            assert first.data["callId"] == cid_a  # the FAST call streamed first, mid-batch
            assert not gate.is_set()  # …and b is provably still blocked (nothing released it)

            # a's durable row EXISTS now (persist-before-emit), while b is still PENDING and unpersisted.
            msgs = await c.app.state.messages.list(thread.id)
            trows = [m for m in msgs if m.role == "tool"]
            assert len(trows) == 1
            assert [r.call_id for r in trows[0].tool_results()] == [cid_a]
            assert trows[0].tool_results()[0].result.state == RunState.OK
            a = next(m for m in msgs if m.role == "assistant")
            st = {cp.call_id: cp.state for cp in a.tool_calls()}
            assert st[cid_a] == RunState.OK and st[cid_b] == RunState.PENDING

            gate.set()  # release the slow call and drain the rest
            rest = [ev async for ev in gen]
            return first, rest

        _first, rest = run_async(scenario())
        assert cid_b in {e.data["callId"] for e in rest if e.event == "tool.result"}
        rows = _tool_rows(c, thread)
        assert len(rows) == 1
        by_id = {r.call_id: r.result.state for r in rows[0].tool_results()}
        assert by_id == {cid_a: RunState.OK, cid_b: RunState.OK}  # both durable + resolved after drain


# ── harvest: a completed-but-UNCONSUMED prefix task is persisted on early generator close ─────────
def test_harvest_completed_but_unconsumed_prefix_task_persists() -> None:
    """Exercises the head `finally`'s HARVEST sweep (the `.done()`-and-unconsumed branch) — untouched
    by the cancel test (there the pending calls are cancelled, never completed-but-unconsumed). Both
    prefix fakes complete together (a `Barrier(2)`), so when the consumer yields the FIRST result the
    SECOND task is already DONE but not yet consumed. Closing the generator right after that first
    `__anext__` must still HARVEST + persist the second result. Drop the harvest sweep and the second
    part never lands → this fails (row has one part, not two)."""
    from app.domain.enums import RunState
    from app.services.agent.session import _BatchOutcome

    with _workspace(), _client() as c:
        specs = [
            {"tool": "ping_host", "args": {"host_id": "a"}},
            {"tool": "ping_host", "args": {"host_id": "b"}},
        ]
        session, thread, assistant, cids = _session(c, specs, max_parallel=4)
        cid_a, cid_b = cids
        barrier = asyncio.Barrier(2)  # neither fake returns until BOTH are in flight → both done together

        async def fake_invoke(tool, args, **kw):
            await barrier.wait()
            return _ok(tool, args)

        session._actions.invoke = fake_invoke

        async def scenario():
            outcome = _BatchOutcome()
            gen = session._run_calls(thread, assistant, {}, _guard(), outcome=outcome)
            first = await gen.__anext__()  # consumes ONE of the two already-completed tasks
            assert first.event == "tool.result"
            await gen.aclose()  # GeneratorExit → head finally must harvest the unconsumed twin
            return first

        first = run_async(scenario())
        consumed = first.data["callId"]
        other = cid_b if consumed == cid_a else cid_a

        # BOTH parts are durable + resolved even though only ONE tool.result was ever consumed.
        rows = _tool_rows(c, thread)
        assert len(rows) == 1
        by_id = {r.call_id: r.result.state for r in rows[0].tool_results()}
        assert by_id == {cid_a: RunState.OK, cid_b: RunState.OK}, "harvest must persist the unconsumed twin"
        st = _states(c, thread)
        assert st[consumed] == RunState.OK and st[other] == RunState.OK  # the harvested twin resolved too


if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    for fn in fns:
        fn()
        print(f"ok  {fn.__name__}")
    print(f"\n{len(fns)} passed")
