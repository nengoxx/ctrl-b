"""ACA Slice 4 wave 3 — per-call persistence & the generator inversion (D40 §2/§6).

`_run_calls` is now an async generator: each resolved call commits its tool-row upsert + the
`assistant.update()` state-flip in ONE `Database.transaction()`, THEN yields its `tool.result`
(**persist-before-emit**), all against ONE `tool` Message per invocation (create-once, update-after;
the finally is the backstop, never a duplicate row). This wave is still SERIAL (the parallel prefix is
wave 4). These pins cover:

  • per-call cadence + persist-before-emit — a 3-call batch: mid-batch (inside call 2's invoke) call 1's
    result is ALREADY durable (tool row with 1 part; assistant shows call 1 resolved); and a recording
    repo wrapper proves each call's DB write precedes its yielded event;
  • single tool Message — a batch of N → exactly ONE tool row, parts in model order; a resume after a
    mid-batch confirm-suspend → the resumed invocation creates its OWN (2nd) tool row, never a duplicate
    within one invocation;
  • cancel mid-batch — call 1's row survives (finally backstop), unresolved calls stay PENDING for the
    reconciler;
  • single-txn atomicity — a COMMIT failure on call 2 → call 2's event is NOT emitted, call 1 intact,
    the error propagates (swallow-only-while-unwinding preserved).

The dual-shield property on the extracted `_persist_shielded` helper under BOTH cancellation sources is
pinned by the ADAPTED C3-H1 tests: `test_formal_audit_wave_b.py::test_b1_raw_cancel_inside_tail...`
(raw `task.cancel()`, now landing in a PER-CALL persist) and
`test_shielded_persistence_slice2.py::test_cancel_mid_batch...` (anyio scope cancel, per-call + backstop).

Drives the REAL `AgentSession` + SQLite persistence path against a temp workspace (no LLM);
`_actions.invoke` is stubbed per-call. Assertions read back through the message repo (real round-trip).
"""

from __future__ import annotations

import asyncio
import contextlib
import os
import tempfile
import uuid
from pathlib import Path

import anyio
import pytest
from _async import drain_run_calls, run_async


def _client():
    from fastapi.testclient import TestClient

    from app.main import create_app

    return TestClient(create_app())


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


def _guard():
    from app.services.agent.session import _LoopGuard

    return _LoopGuard(max_repeat=5, max_per_tool=10)


def _session_with_calls(c, n: int):
    """Session + a persisted assistant message holding `n` PENDING `ping_host` calls (distinct args so
    each is a distinct signature). Returns (session, thread, assistant, [call_ids])."""
    from app.domain.conversation import Message, Thread, ToolCallPart
    from app.domain.enums import Actor, RunState
    from app.services.agent.session import AgentSession

    s = c.app.state
    agent = s.settings.resolve_agent(None)
    session = AgentSession(s.threads, s.messages, s.inference, s.settings, s.actions, agent, interactive=True)
    thread = run_async(s.threads.create(Thread()))
    cids = [uuid.uuid4().hex for _ in range(n)]
    parts = [
        ToolCallPart(
            call_id=cid, tool="ping_host", args={"host_id": chr(ord("a") + i)}, state=RunState.PENDING
        )
        for i, cid in enumerate(cids)
    ]
    assistant = Message(
        thread_id=thread.id, role="assistant", actor=Actor.AGENT, agent="default", parts=parts
    )
    run_async(s.messages.add(assistant))
    return session, thread, assistant, cids


def _ok_outcome(tool: str):
    from app.domain.enums import RunState
    from app.domain.result import ToolResult
    from app.services.action_service import InvokeOutcome

    return InvokeOutcome(needs_confirm=False, result=ToolResult(state=RunState.OK, summary=f"ran {tool}"))


# ── per-call cadence + persist-before-emit ───────────────────────────────────────────────────────
def test_percall_cadence_call1_durable_before_call2_and_persist_precedes_emit() -> None:
    from app.domain.enums import RunState

    with _workspace(), _client() as c:
        session, thread, assistant, cids = _session_with_calls(c, 3)
        cid1, cid2, cid3 = cids

        # Mid-batch snapshot taken INSIDE call 2's invoke — call 1 must already be durable.
        snapshot: dict = {}

        async def fake_invoke(tool, args, **kw):
            if args["host_id"] == "b":  # call 2 — read the DB before returning
                rows = await c.app.state.messages.list(thread.id)
                a = next(m for m in rows if m.role == "assistant")
                tools = [m for m in rows if m.role == "tool"]
                snapshot["assistant_states"] = {cp.call_id: cp.state for cp in a.tool_calls()}
                snapshot["tool_parts"] = [r.call_id for tr in tools for r in tr.tool_results()]
                snapshot["tool_rows"] = len(tools)
            return _ok_outcome(tool)

        session._actions.invoke = fake_invoke

        # Record the interleaving of DB writes and yielded events to prove persist-before-emit.
        timeline: list[tuple] = []
        real_add, real_update = session._messages.add, session._messages.update

        async def rec_add(msg):
            if msg.role == "tool":
                timeline.append(("db", tuple(r.call_id for r in msg.tool_results())))
            return await real_add(msg)

        async def rec_update(msg):
            if msg.role == "tool":
                timeline.append(("db", tuple(r.call_id for r in msg.tool_results())))
            return await real_update(msg)

        session._messages.add = rec_add
        session._messages.update = rec_update

        from app.services.agent.session import _BatchOutcome

        outcome = _BatchOutcome()

        async def _drain():
            async for ev in session._run_calls(thread, assistant, {}, _guard(), outcome=outcome):
                if ev.event == "tool.result":
                    timeline.append(("ev", ev.data["callId"]))

        run_async(_drain())

        # 1) mid-batch: when call 2 ran, call 1's result was ALREADY committed + call 1 flipped OK.
        assert snapshot["tool_rows"] == 1
        assert snapshot["tool_parts"] == [cid1]
        assert snapshot["assistant_states"][cid1] == RunState.OK
        assert snapshot["assistant_states"][cid2] == RunState.PENDING  # call 2 not yet resolved

        # 2) persist-before-emit: each call's DB write (a tool row CONTAINING that call) precedes its
        #    yielded tool.result event.
        for cid in (cid1, cid2, cid3):
            db_i = next(i for i, e in enumerate(timeline) if e[0] == "db" and cid in e[1])
            ev_i = next(i for i, e in enumerate(timeline) if e == ("ev", cid))
            assert db_i < ev_i, f"{cid}: DB write must precede its event ({timeline})"


# ── single tool Message per invocation (parts in model order) ────────────────────────────────────
def test_single_tool_message_parts_in_model_order() -> None:
    from app.domain.enums import RunState

    with _workspace(), _client() as c:
        session, thread, assistant, cids = _session_with_calls(c, 3)

        async def fake_invoke(tool, args, **kw):
            return _ok_outcome(tool)

        session._actions.invoke = fake_invoke

        events, suspended, made_progress = drain_run_calls(session, thread, assistant, {}, _guard())
        assert suspended is False and made_progress is True
        assert [e.data["callId"] for e in events if e.event == "tool.result"] == cids

        msgs = run_async(c.app.state.messages.list(thread.id))
        tool_rows = [m for m in msgs if m.role == "tool"]
        assert len(tool_rows) == 1  # exactly ONE tool message for the whole invocation
        assert [r.call_id for r in tool_rows[0].tool_results()] == cids  # parts in model order
        a = next(m for m in msgs if m.role == "assistant")
        assert all(cp.state == RunState.OK for cp in a.tool_calls())


# ── resume after a mid-batch confirm-suspend → the resumed invocation gets its OWN tool row ───────
def test_resume_after_suspend_creates_own_tool_message_never_duplicates() -> None:
    from app.domain.enums import RunState
    from app.domain.result import ToolResult
    from app.services.action_service import InvokeOutcome

    with _workspace(), _client() as c:
        session, thread, assistant, cids = _session_with_calls(c, 2)
        cid1, cid2 = cids

        def fake_invoke_factory(confirm_second: bool):
            async def fake_invoke(tool, args, confirm_token=None, **kw):
                if args["host_id"] == "b" and confirm_second and confirm_token is None:
                    return InvokeOutcome(needs_confirm=True, confirm_token="tok", confirm_prompt="ok?")
                return InvokeOutcome(
                    needs_confirm=False, result=ToolResult(state=RunState.OK, summary=f"ran {tool}")
                )

            return fake_invoke

        # First invocation: call 1 resolves, call 2 suspends on confirm.
        session._actions.invoke = fake_invoke_factory(confirm_second=True)
        events, suspended, _ = drain_run_calls(session, thread, assistant, {}, _guard())
        assert suspended is True
        assert [e.event for e in events] == ["tool.result", "tool.permission"]

        msgs = run_async(c.app.state.messages.list(thread.id))
        tool_rows = [m for m in msgs if m.role == "tool"]
        assert len(tool_rows) == 1  # ONE tool row from invocation #1
        assert [r.call_id for r in tool_rows[0].tool_results()] == [cid1]
        a = next(m for m in msgs if m.role == "assistant")
        by_id = {cp.call_id: cp.state for cp in a.tool_calls()}
        assert by_id[cid1] == RunState.OK and by_id[cid2] == RunState.AWAITING_CONFIRM

        # Resume: the confirmed call 2 runs in a NEW _run_calls invocation → its OWN (2nd) tool row.
        session._actions.invoke = fake_invoke_factory(confirm_second=False)
        events2, suspended2, _ = drain_run_calls(session, thread, assistant, {cid2: "tok"}, _guard())
        assert suspended2 is False
        assert [e.data["callId"] for e in events2 if e.event == "tool.result"] == [cid2]

        msgs = run_async(c.app.state.messages.list(thread.id))
        tool_rows = [m for m in msgs if m.role == "tool"]
        assert len(tool_rows) == 2  # invocation #2 created its own row (legit) — never duplicated #1's
        assert [r.call_id for r in tool_rows[1].tool_results()] == [cid2]
        a = next(m for m in msgs if m.role == "assistant")
        assert {cp.call_id: cp.state for cp in a.tool_calls()}[cid2] == RunState.OK


# ── cancel mid-batch: completed call survives, unresolved stay PENDING for the reconciler ────────
def test_cancel_mid_batch_generator_backstop_persists_call1_leaves_rest_pending() -> None:
    from app.domain.enums import RunState
    from app.services.agent.session import _BatchOutcome

    with _workspace(), _client() as c:
        session, thread, assistant, cids = _session_with_calls(c, 3)
        cid1, cid2, cid3 = cids
        entered_two = asyncio.Event()

        async def fake_invoke(tool, args, **kw):
            if args["host_id"] == "a":
                return _ok_outcome(tool)
            entered_two.set()
            await asyncio.sleep(3600)  # block until cancelled
            raise AssertionError("unreachable")

        session._actions.invoke = fake_invoke
        cancelled = {"v": False}

        async def runner():
            try:
                outcome = _BatchOutcome()
                async for _ev in session._run_calls(thread, assistant, {}, _guard(), outcome=outcome):
                    pass
            except anyio.get_cancelled_exc_class():
                cancelled["v"] = True
                raise

        async def drive():
            async with anyio.create_task_group() as tg:
                tg.start_soon(runner)
                await entered_two.wait()
                tg.cancel_scope.cancel()

        run_async(drive())
        assert cancelled["v"] is True

        msgs = run_async(c.app.state.messages.list(thread.id))
        a = next(m for m in msgs if m.role == "assistant")
        by_id = {cp.call_id: cp.state for cp in a.tool_calls()}
        assert by_id[cid1] == RunState.OK  # completed call survived (per-call persist + backstop)
        assert by_id[cid2] == RunState.PENDING  # in-flight — reconciler's job (A11)
        assert by_id[cid3] == RunState.PENDING  # never reached
        tool_rows = [m for m in msgs if m.role == "tool"]
        assert len(tool_rows) == 1
        assert [r.call_id for r in tool_rows[0].tool_results()] == [cid1]


# ── single-txn atomicity: a COMMIT failure on call 2 → its event NOT emitted, call 1 intact ──────
def test_single_txn_commit_failure_on_call2_not_emitted_call1_intact_error_propagates() -> None:
    from app.domain.enums import RunState
    from app.services.agent.session import _BatchOutcome

    with _workspace(), _client() as c:
        session, thread, assistant, cids = _session_with_calls(c, 3)
        cid1, cid2, cid3 = cids

        db = session._messages.db
        orig_commit = db.conn.commit
        armed = {"v": False}

        async def flaky_commit():
            if armed["v"]:
                raise RuntimeError("injected commit failure (call 2)")
            return await orig_commit()

        db.conn.commit = flaky_commit

        async def fake_invoke(tool, args, **kw):
            if args["host_id"] == "b":
                armed["v"] = True  # call 2's persist COMMIT will now fail
            return _ok_outcome(tool)

        session._actions.invoke = fake_invoke

        emitted: list = []

        async def _drain():
            outcome = _BatchOutcome()
            async for ev in session._run_calls(thread, assistant, {}, _guard(), outcome=outcome):
                if ev.event == "tool.result":
                    emitted.append(ev.data["callId"])

        with pytest.raises(RuntimeError, match="injected commit failure"):
            run_async(_drain())

        armed["v"] = False  # disarm before the read-back / teardown
        db.conn.commit = orig_commit

        # call 2's event was NOT emitted (persist raised before the yield); call 3 never reached.
        assert emitted == [cid1]

        msgs = run_async(c.app.state.messages.list(thread.id))
        a = next(m for m in msgs if m.role == "assistant")
        by_id = {cp.call_id: cp.state for cp in a.tool_calls()}
        assert by_id[cid1] == RunState.OK  # call 1 committed before the failure
        tool_rows = [m for m in msgs if m.role == "tool"]
        assert len(tool_rows) == 1
        assert [r.call_id for r in tool_rows[0].tool_results()] == [cid1]  # only call 1 durable


if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    for fn in fns:
        fn()
        print(f"ok  {fn.__name__}")
    print(f"\n{len(fns)} passed")
