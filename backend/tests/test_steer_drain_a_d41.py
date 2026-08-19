"""ACA Slice 5 wave 2 — Drain A: the running turn's loop-top steer drain (D41).

`_drive` drains the thread's steer queue at the TOP of each iteration, BEFORE `should_compact`:
message steers persist as `role="user"` Messages (a CONTIGUOUS run in ONE `Database.transaction()`,
`commit()` only AFTER the txn — persist-before-clear), exec steers run the SHARED `run_user_exec`
(the same run_shell@FULL + atomic pair the `/exec` endpoint uses) after a LIVE `user_exec_enabled`
re-check (fail-closed). Each applied steer yields `steer.applied {entryId, messageId, kind[, text]}`,
which the `TurnAccumulator` folds so a re-attaching client renders it.

These pins drive the REAL `AgentSession` + SQLite (no LLM — a scripted fake `stream_chat`); the steer
queue is a real `SteerSource` over `app.state.steer_queues`. `_actions.invoke` is stubbed where the
turn itself calls a tool; the exec-drain tests use the REAL ActionService so the run_shell pair +
Event audit row are genuine. Cadence/atomicity/fail-closed/compaction-visibility/head-stability/count
are each isolated.
"""

from __future__ import annotations

import contextlib
import json
import os
import tempfile
from pathlib import Path

import pytest
from _async import run_async


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


# ── fake inference + session wiring ──────────────────────────────────────────────────────────────
class _Fake:
    """A scripted `stream_chat`: `scripts[i]` is the list of `ChatDelta`s yielded on the i-th call.
    `on_call(idx, messages)` fires (awaited) at the START of each stream — the seam where a test
    enqueues a steer mid-turn or snapshots the DB before the model 'sees' the payload."""

    def __init__(self, scripts, on_call=None):
        self.scripts = scripts
        self.on_call = on_call
        self.calls = 0
        self.seen: list = []

    def stream_chat(self, messages, **kw):
        idx = self.calls
        self.calls += 1
        self.seen.append(messages)
        on_call = self.on_call
        script = self.scripts[idx] if idx < len(self.scripts) else self.scripts[-1]

        async def gen():
            if on_call is not None:
                await on_call(idx, messages)
            for d in script:
                yield d

        return gen()

    async def effective_window(self, _ep):  # D42 Wave 2 — the trigger resolves the window here; a
        return None  # scripted fake has no window → the `threshold_tokens` fallback (tiny histories)

    async def min_chain_window(self, _mode=None, _model=None):  # D60 — the clearing pressure gate
        return None  # no window → always-on clearing (the pre-D60 behaviour these tests assume)

    def target_for(self, _mode=None, _model=None):  # A11 — `_drive` prices the target off the client
        from app.domain.provider import ResolvedTarget

        return ResolvedTarget(provider="fake", base_url="http://fake/v1", model="m")


def _text(s: str):
    from app.adapters.inference import ChatDelta

    return ChatDelta(text=s)


def _tool(name: str, args: dict, cid: str = "c1"):
    from app.adapters.inference import ChatDelta, ToolCallRequest

    return ChatDelta(tool_calls=[ToolCallRequest(id=cid, name=name, arguments=json.dumps(args))])


def _session(c, fake, *, steer: bool = True):
    """A real AgentSession over app.state, with parallel dispatch OFF (serial machinery), the scripted
    fake inference, and a real SteerSource (unless `steer=False`, the subagent-like None case)."""
    from app.domain.conversation import Thread
    from app.services.agent.session import AgentSession
    from app.services.agent.steering import SteerSource

    s = c.app.state
    agent = s.settings.resolve_agent(None).model_copy(update={"max_parallel_tools": 1})
    thread = run_async(s.threads.create(Thread()))
    src = SteerSource(s.steer_queues, thread.id) if steer else None
    session = AgentSession(
        s.threads, s.messages, s.inference, s.settings, s.actions, agent, interactive=True, steer_source=src
    )
    session._inference = fake
    return session, thread


def _no_compact(session) -> None:
    """Neutralize the real compactor for turns that aren't testing compaction (a tiny history never
    compacts anyway, but this keeps the tests independent of the threshold config)."""

    async def _never(_thread, **_kw):  # **_kw absorbs the D42 window/reserve/estimate kwargs
        return False

    async def _none(_thread, **_kw):
        return None

    session._compactor.should_compact = _never
    session._compactor.compact = _none


def _run(session, thread, user_text: str = "hi"):
    async def _collect():
        return [ev async for ev in session.run_turn(thread, user_text)]

    return run_async(_collect())


def _enqueue(s, thread_id: str, entry) -> None:
    from app.services.agent.steering import enqueue

    enqueue(s, thread_id, entry, s.settings.agent.turns.steer_queue_max)


def _msg_entry(text: str):
    from app.services.agent.steering import SteerEntry

    return SteerEntry(kind="message", text=text)


def _exec_entry(cmd: str):
    from app.services.agent.steering import SteerEntry

    return SteerEntry(kind="exec", text=cmd)


def _ok_invoke_factory():
    async def _ok(tool, args, **kw):
        from app.domain.enums import RunState
        from app.domain.result import ToolResult
        from app.services.action_service import InvokeOutcome

        return InvokeOutcome(needs_confirm=False, result=ToolResult(state=RunState.OK, summary=f"ran {tool}"))

    return _ok


# ── 1: drains at the loop top BEFORE the next model call; FIFO across entries ─────────────────────
def test_drains_at_loop_top_before_next_model_call_fifo() -> None:
    with _workspace(), _client() as c:
        s = c.app.state
        snap: dict = {}

        async def on_call(idx, messages):
            if idx == 0:
                # Enqueue two steers DURING the first model call → they drain at iteration 1's loop top.
                _enqueue(s, thread.id, _msg_entry("s1"))
                _enqueue(s, thread.id, _msg_entry("s2"))
            if idx == 1:
                rows = await s.messages.list(thread.id)
                snap["users"] = [m.text() for m in rows if m.role == "user"]

        # iteration 0 makes a tool call (progress → loop continues); iteration 1 finishes text-only.
        fake = _Fake([[_tool("ping_host", {"host_id": "a"})], [_text("done")]], on_call=on_call)
        session, thread = _session(c, fake)
        _no_compact(session)
        session._actions.invoke = _ok_invoke_factory()

        events = _run(session, thread)

        # The steered user rows are persisted BEFORE the second model call saw the payload.
        assert snap["users"] == ["hi", "s1", "s2"]
        # The second model call's assembled messages carry them as user turns.
        second_users = [m["content"] for m in fake.seen[1] if m.get("role") == "user"]
        assert "s1" in second_users and "s2" in second_users
        # steer.applied FIFO, and both precede the SECOND message.start.
        applied = [e for e in events if e.event == "steer.applied"]
        assert [e.data["text"] for e in applied] == ["s1", "s2"]  # FIFO
        assert all(e.data["kind"] == "message" and e.data["messageId"] and e.data["entryId"] for e in applied)
        starts = [i for i, e in enumerate(events) if e.event == "message.start"]
        applied_idx = [i for i, e in enumerate(events) if e.event == "steer.applied"]
        assert max(applied_idx) < starts[1]  # both applied before the 2nd model turn begins


# ── 2: transactional — a persist failure leaves the queue intact + no partial rows ───────────────
def test_persist_failure_leaves_queue_intact_no_partial_rows() -> None:
    with _workspace(), _client() as c:
        s = c.app.state
        fake = _Fake([[_text("done")]])
        session, thread = _session(c, fake)
        _no_compact(session)
        _enqueue(s, thread.id, _msg_entry("s1"))
        _enqueue(s, thread.id, _msg_entry("s2"))

        real_add = s.messages.add

        async def bad_add(msg):
            if msg.role == "user" and msg.text() == "s2":
                raise RuntimeError("boom persist")  # fail the 2nd add INSIDE the one txn
            return await real_add(msg)

        s.messages.add = bad_add

        with pytest.raises(RuntimeError, match="boom persist"):
            _run(session, thread)

        s.messages.add = real_add  # restore before reading back
        # Queue intact (commit() never ran — persist-before-clear).
        q = s.steer_queues[thread.id]
        assert [e.text for e in q.peek()] == ["s1", "s2"]
        # No partial user rows: the whole contiguous-run txn rolled back (s1 gone too), only "hi" remains.
        rows = run_async(s.messages.list(thread.id))
        assert [m.text() for m in rows if m.role == "user"] == ["hi"]
        assert fake.calls == 0  # the drain raised at the loop top, before any model call


# ── 3: enqueue-during-drain survives — commit removes ONLY the peeked ids ─────────────────────────
def test_commit_removes_only_peeked_enqueue_during_drain_survives() -> None:
    from app.services.agent.steering import SteerQueue, SteerSource

    queues: dict = {}
    src = SteerSource(queues, "t")
    assert src.peek() == []  # missing queue → empty peek, commit is a no-op
    src.commit(["nope"])

    q = SteerQueue()
    queues["t"] = q
    e1, e2, e3 = _msg_entry("a"), _msg_entry("b"), _msg_entry("c")
    q.append(e1)
    q.append(e2)
    peeked = src.peek()
    assert [e.entry_id for e in peeked] == [e1.entry_id, e2.entry_id]
    q.append(e3)  # a THIRD arrives mid-drain (after the peek snapshot)
    src.commit([e1.entry_id, e2.entry_id])  # commit ONLY the peeked ids
    assert [e.entry_id for e in src.peek()] == [e3.entry_id]  # e3 survives to the next loop top


# ── 4: exec entry drains via the SHARED helper (pair persisted atomically; Event audit row) ──────
def test_exec_entry_drains_via_shared_helper_persists_pair_and_event() -> None:
    with _workspace(), _client() as c:
        s = c.app.state
        s.settings.shell.user_exec_enabled = True

        fake = _Fake([[_text("done")]])
        session, thread = _session(c, fake)
        _no_compact(session)
        _enqueue(s, thread.id, _exec_entry("echo steer-exec"))

        events = _run(session, thread)

        rows = run_async(s.messages.list(thread.id))
        call = next(p for m in rows if m.role == "assistant" for p in m.tool_calls() if p.tool == "run_shell")
        res = next(p for m in rows if m.role == "tool" for p in m.tool_results())
        assert res.result.state.value == "ok"
        assert "steer-exec" in (res.result.output or "")
        assert res.call_id == call.call_id  # the atomic assistant+tool pair
        # steer.applied(exec) carries the assistant message id (id-only — no text).
        applied = next(e for e in events if e.event == "steer.applied")
        assert applied.data["kind"] == "exec"
        exec_assistant = next(m for m in rows if m.role == "assistant" and m.tool_calls())
        assert applied.data["messageId"] == exec_assistant.id
        assert "text" not in applied.data
        # The privileged invocation is audited as an Event.
        audit = run_async(s.events.recent())
        assert any(ev.action == "run_shell" for ev in audit)


# ── 5: exec fail-closed — disabled between enqueue and drain → dropped + notice, NEVER invoked ────
def test_exec_fail_closed_disabled_at_drain_drops_and_never_invokes() -> None:
    with _workspace(), _client() as c:
        s = c.app.state
        s.settings.shell.user_exec_enabled = True  # valid at enqueue (UX gate)

        fake = _Fake([[_text("done")]])
        session, thread = _session(c, fake)
        _no_compact(session)
        _enqueue(s, thread.id, _exec_entry("echo should-not-run"))

        # Disable AFTER enqueue, BEFORE the drain — the drain must re-check LIVE and fail closed.
        s.settings.shell.user_exec_enabled = False
        invoked: list[str] = []
        real_invoke = s.actions.invoke

        async def rec_invoke(tool, args, **kw):
            invoked.append(tool)
            return await real_invoke(tool, args, **kw)

        s.actions.invoke = rec_invoke

        events = _run(session, thread)

        assert "run_shell" not in invoked  # command NEVER ran
        assert any(e.event == "notice" and "shell disabled" in e.data.get("text", "") for e in events)
        assert not any(e.event == "steer.applied" for e in events)  # dropped, not applied
        assert len(s.steer_queues.get(thread.id) or []) == 0  # committed away (dropped); queue pruned (FIX 5)
        rows = run_async(s.messages.list(thread.id))
        assert not any(p.tool == "run_shell" for m in rows if m.role == "assistant" for p in m.tool_calls())


# ── 6: drained BEFORE compaction — should_compact sees the steered messages ──────────────────────
def test_drained_before_compaction_should_compact_sees_steers() -> None:
    with _workspace(), _client() as c:
        s = c.app.state
        fake = _Fake([[_text("done")]])
        session, thread = _session(c, fake)
        _enqueue(s, thread.id, _msg_entry("steer-before-compact"))

        seen: dict = {}

        async def spy_should_compact(_thread, **_kw):  # **_kw absorbs the D42 trigger kwargs
            rows = await s.messages.list(_thread.id)
            seen["texts"] = [m.text() for m in rows if m.role == "user"]
            return False

        async def _none(_thread, **_kw):
            return None

        session._compactor.should_compact = spy_should_compact
        session._compactor.compact = _none

        _run(session, thread)

        # The drain (loop top) ran BEFORE should_compact, so the steered message is already history.
        assert "steer-before-compact" in seen["texts"]


# ── 7: static-head byte-stability across a drain ─────────────────────────────────────────────────
def test_static_head_byte_stable_across_drain() -> None:
    with _workspace(), _client() as c:
        s = c.app.state
        fake = _Fake([[_text("done")]])
        session, thread = _session(c, fake)
        _no_compact(session)

        before = json.dumps(session._static_prefix(), sort_keys=True)
        _enqueue(s, thread.id, _msg_entry("a steer that adds history"))
        _run(session, thread)
        after = json.dumps(session._static_prefix(), sort_keys=True)

        assert before == after  # the drain appends history; it never rebuilds the cached head


# ── 8: count_user_messages bumps for message steers, NOT exec steers ──────────────────────────────
def test_count_user_messages_bumps_for_messages_not_execs() -> None:
    with _workspace(), _client() as c:
        s = c.app.state
        s.settings.shell.user_exec_enabled = True
        fake = _Fake([[_text("done")]])
        session, thread = _session(c, fake)
        _no_compact(session)
        _enqueue(s, thread.id, _msg_entry("a message steer"))
        _enqueue(s, thread.id, _exec_entry("echo x"))

        _run(session, thread)

        # "hi" + the one message steer = 2 user rows; the exec steer (assistant+tool) adds ZERO.
        count = run_async(s.messages.count_user_messages(thread.id))
        assert count == 2
        rows = run_async(s.messages.list(thread.id))
        assert any(p.tool == "run_shell" for m in rows if m.role == "assistant" for p in m.tool_calls())


# ── 9: a subagent-shaped session (steer_source=None) never drains ─────────────────────────────────
def test_none_steer_source_never_drains() -> None:
    with _workspace(), _client() as c:
        s = c.app.state
        fake = _Fake([[_text("done")]])
        session, thread = _session(c, fake, steer=False)
        _no_compact(session)
        # Even with a queue present on the thread, a None steer_source ignores it entirely.
        _enqueue(s, thread.id, _msg_entry("ignored"))

        events = _run(session, thread)
        assert not any(e.event == "steer.applied" for e in events)
        assert [e.text for e in s.steer_queues[thread.id].peek()] == ["ignored"]  # untouched


# ── FIX 1: an exec DELETEd during the preceding message txn is never run (atomic claim) ───────────
def test_fix1_delete_exec_during_preceding_message_txn_never_runs() -> None:
    """FIX 1: the exec drain claims its entry atomically (`commit([id]) != 1` → skip). A DELETE that
    lands while the preceding message run's txn is awaiting removes the exec from the queue, so its
    claim returns 0 at the drain and run_shell is NEVER invoked."""
    with _workspace(), _client() as c:
        s = c.app.state
        s.settings.shell.user_exec_enabled = True
        fake = _Fake([[_text("done")]])
        session, thread = _session(c, fake)
        _no_compact(session)
        e = _exec_entry("echo should-not-run")
        _enqueue(s, thread.id, _msg_entry("m1"))
        _enqueue(s, thread.id, e)

        real_add = s.messages.add

        async def hook_add(msg):
            # While the preceding message "m1" is persisting inside its txn, a DELETE removes the exec.
            if msg.role == "user" and msg.text() == "m1":
                s.steer_queues[thread.id].remove(e.entry_id)
            return await real_add(msg)

        s.messages.add = hook_add
        try:
            events = _run(session, thread)
        finally:
            s.messages.add = real_add

        applied = [ev for ev in events if ev.event == "steer.applied"]
        assert [a.data["kind"] for a in applied] == ["message"]  # only the message applied
        rows = run_async(s.messages.list(thread.id))
        assert not any(p.tool == "run_shell" for m in rows if m.role == "assistant" for p in m.tool_calls())


if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    for fn in fns:
        fn()
        print(f"ok  {fn.__name__}")
    print(f"\n{len(fns)} passed")
