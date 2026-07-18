"""ACA Slice 3 wave 2 — server-owned durable turns: the turn-task core (D39, AGENT_CHAT_AUDIT §5 v2.5).

Wave 2 inverts turn ownership: `_turn_response` spawns a `drain_turn` asyncio task that drives
`run_turn`/`resume` to completion INDEPENDENT of the client; the SSE generator (and the buffered
`collect_turn` wrapper) become subscribers reading a bounded queue. This file proves the core
mechanics without an LLM:

  1. `TurnAccumulator.fold`/`snapshot` — the registry-layer event fold (snapshot source for late
     re-attach) is complete over the event vocabulary.
  2. `drain_turn` runs to completion even after the consumer detaches (the ACA-1 headline: a turn
     outlives its client socket); overflow detaches a slow subscriber without touching the turn;
     `terminal_status` is set on every path.
  3. `cancel_turn` — single-cancel discipline (D39 H2/H3): mid-`_run_calls` cancel → shielded
     persistence of the completed call survives, `reconcile_stale_calls` flips the in-flight call to
     CANCELLED, `terminal_status=="cancelled"`, marker released; a DOUBLE cancel is a no-op and leaves
     no dangling transaction.
  4. Suspension invariant — a confirm/question suspend ends the task normally
     (`terminal_status=="suspended"`), marker released; resume spawns a fresh task and completes.
  5. Endpoint wiring — buffered payload shape intact (D17), the `max_active_turns` cap 409s the
     (N+1)th spawning kind, and a detached-running turn still 409s its own thread while a different
     thread runs.

Levels 1–4 drive the REAL registry/session/DB directly on the shared `run_async` loop (so a task
created in one call is awaited in the same call); level 5 uses the Slice-2 TestClient + `_FakeSession`
pattern. `session._inference.stream_chat` / `session._actions.invoke` are stubbed per-test — no
network, real SQLite round-trips.
"""

from __future__ import annotations

import asyncio
import contextlib
import os
import tempfile
import uuid
from collections import deque
from pathlib import Path

from _async import run_async

# ── shared workspace + client (mirrors the Slice-2 harnesses) ──────────────────────────────────


def _workspace(config_text: str = "server:\n  port: 5433\n") -> Path:
    tmp = Path(tempfile.mkdtemp())
    cfg = tmp / "config.yaml"
    cfg.write_text(config_text, encoding="utf-8")
    os.environ["CTRLB_HOME"] = str(tmp)
    os.environ["CTRLB_CONFIG"] = str(cfg)
    os.environ["CTRLB_DB"] = str(tmp / "t.db")
    return tmp


def _clear_env() -> None:
    for k in ("CTRLB_HOME", "CTRLB_CONFIG", "CTRLB_DB"):
        os.environ.pop(k, None)


def _client(config_text: str = "server:\n  port: 5433\n"):
    from fastapi.testclient import TestClient

    from app.main import create_app

    _workspace(config_text)
    return TestClient(create_app())


def _ev(event: str, **data):
    from app.services.agent.session import AgentEvent

    return AgentEvent(event, data)


# ── 1: accumulator fold + snapshot ─────────────────────────────────────────────────────────────


def test_accumulator_folds_text_calls_and_carries_mode() -> None:
    from app.services.agent.turns import TurnAccumulator

    acc = TurnAccumulator()
    for e in [
        _ev("message.start", messageId="m1", role="assistant", agent="default"),
        _ev("text.delta", messageId="m1", delta="Hel"),
        _ev("text.delta", messageId="m1", delta="lo"),
        _ev("reasoning.delta", messageId="m1", delta="think"),
        _ev(
            "part.added",
            messageId="m1",
            part={"call_id": "c1", "tool": "ping_host", "args": {"h": "x"}, "state": "pending"},
        ),
    ]:
        acc.fold(e)

    snap = acc.snapshot(mode="local", seq=5)
    assert snap["mode"] == "local"
    assert snap["seq"] == 5
    # open message present with JOINED text/reasoning (deltas concatenated only here)
    assert snap["message"]["id"] == "m1"
    assert snap["message"]["text"] == "Hello"
    assert snap["message"]["reasoning"] == "think"
    # the tool call is recorded with its args
    calls = {c["call_id"]: c for c in snap["calls"]}
    assert calls["c1"]["tool"] == "ping_host"
    assert calls["c1"]["args"] == {"h": "x"}


def test_accumulator_drops_open_message_on_end_but_keeps_pending_suspend() -> None:
    from app.domain.enums import RunState
    from app.services.agent.turns import TurnAccumulator

    acc = TurnAccumulator()
    for e in [
        _ev("message.start", messageId="m1", role="assistant", agent="default"),
        _ev("text.delta", messageId="m1", delta="running a tool"),
        _ev(
            "part.added",
            messageId="m1",
            part={"call_id": "c1", "tool": "run_shell", "args": {}, "state": "pending"},
        ),
        _ev("message.end", messageId="m1"),
        # tool.permission is emitted AFTER message.end in _drive — it must still land on the call
        _ev(
            "tool.permission",
            callId="c1",
            tool="run_shell",
            title="Run shell",
            args={},
            risk="high",
            token="tok-xyz",
            prompt="Run it?",
        ),
    ]:
        acc.fold(e)

    snap = acc.snapshot(mode=None, seq=5)
    # the persisted message is dropped (client re-reads it from SQLite) …
    assert "message" not in snap
    # … but the pending confirm survives with its EPHEMERAL token+prompt (not persisted)
    call = {c["call_id"]: c for c in snap["calls"]}["c1"]
    assert call["state"] == RunState.AWAITING_CONFIRM.value
    assert call["permission"]["token"] == "tok-xyz"
    assert call["permission"]["prompt"] == "Run it?"


def test_accumulator_resolves_call_and_records_terminal() -> None:
    from app.services.agent.turns import TurnAccumulator

    acc = TurnAccumulator()
    for e in [
        _ev(
            "part.added",
            messageId="m1",
            part={"call_id": "c1", "tool": "ping_host", "args": {}, "state": "pending"},
        ),
        _ev(
            "tool.permission",
            callId="c1",
            tool="ping_host",
            title="Ping",
            args={},
            risk="low",
            token="t",
            prompt="p",
        ),
        _ev("tool.result", callId="c1", result={"state": "ok", "summary": "pong"}),
        _ev("done", threadId="t", state="completed"),
    ]:
        acc.fold(e)

    snap = acc.snapshot(mode="cloud", seq=4)
    call = {c["call_id"]: c for c in snap["calls"]}["c1"]
    assert call["state"] == "ok"  # resolved
    assert "permission" not in call  # the ephemeral suspend payload was cleared on resolve
    assert snap["terminal"] == {"threadId": "t", "state": "completed"}


# ── 2: drain_turn independence + terminal semantics ────────────────────────────────────────────


def _fake_gen(events, *, per_event_yield=False):
    async def gen():
        for e in events:
            if per_event_yield:
                await asyncio.sleep(0)  # let a consumer interleave / detach mid-turn
            yield e

    return gen()


class _NoMessages:
    """Stand-in MessageRepo — drain_turn only touches `messages` on the cancel path, which these
    non-cancel tests never hit, so any access is a bug we want to surface."""

    def __getattr__(self, name):  # pragma: no cover - defensive
        raise AssertionError(f"messages.{name} should not be touched on a non-cancel drain")


def _handle(kind: str = "chat", ring_size: int = 64):
    from app.services.agent.turns import TurnHandle

    return TurnHandle(thread_id="t1", kind=kind, ring=deque(maxlen=ring_size))


def test_drain_completes_and_sets_terminal_status_even_with_no_consumer() -> None:
    from app.services.agent.turns import drain_turn

    async def scenario():
        handle = _handle()
        events = _fake_gen(
            [
                _ev("message.start", messageId="m", role="assistant"),
                _ev("text.delta", messageId="m", delta="hi"),
                _ev("message.end", messageId="m"),
                _ev("done", threadId="t1", state="completed"),
            ]
        )
        await drain_turn(handle, events, _NoMessages())
        return handle

    handle = run_async(scenario())
    # every event was folded + ringed despite ZERO subscribers
    assert handle.seq == 4
    assert [seq for seq, _ in handle.ring] == [1, 2, 3, 4]
    assert handle.terminal_status == "completed"


def test_turn_survives_consumer_death_and_still_delivers_terminal_sentinel() -> None:
    from app.services.agent.turns import drain_turn, make_subscriber, remove_subscriber

    async def scenario():
        handle = _handle()
        q = make_subscriber(handle, 256)
        events = _fake_gen(
            [
                _ev("message.start", messageId="m", role="assistant"),
                _ev("text.delta", messageId="m", delta="a"),
                _ev("text.delta", messageId="m", delta="b"),
                _ev("message.end", messageId="m"),
                _ev("done", threadId="t1", state="completed"),
            ],
            per_event_yield=True,
        )
        task = asyncio.create_task(drain_turn(handle, events, _NoMessages()))
        # consume ONE event then the consumer "dies" (detaches) mid-turn
        first = await q.get()
        remove_subscriber(handle, q)
        # the turn keeps running to completion, independent of the gone consumer
        await task
        return handle, first

    handle, first = run_async(scenario())
    assert first[1].event == "message.start"  # (seq, event) tuple
    assert handle.seq == 5  # the full turn drained after the consumer left
    assert handle.terminal_status == "completed"
    assert handle.subscribers == []  # the consumer detached itself


def test_subscriber_overflow_detaches_slow_reader_turn_unaffected() -> None:
    from app.services.agent.turns import drain_turn, make_subscriber

    async def scenario():
        handle = _handle(ring_size=64)
        q = make_subscriber(handle, 1)  # a tiny queue — an unconsumed subscriber overflows fast
        events = _fake_gen([_ev("text.delta", messageId="m", delta=str(i)) for i in range(20)])
        await drain_turn(handle, events, _NoMessages())
        return handle, q

    handle, q = run_async(scenario())
    # the overflowing subscriber was DETACHED (removed) — never shed events for connected readers
    assert q not in handle.subscribers
    assert handle.subscribers == []
    # the turn itself drained all 20 events regardless
    assert handle.seq == 20
    assert handle.terminal_status is not None


def test_drain_error_path_synthesizes_terminal_error() -> None:
    from app.services.agent.turns import TERMINAL, drain_turn, make_subscriber

    async def boom():
        yield _ev("message.start", messageId="m", role="assistant")
        raise RuntimeError("inference exploded")
        yield  # pragma: no cover

    async def scenario():
        handle = _handle()
        q = make_subscriber(handle, 256)
        # a generic exception is captured as done{error}, NOT re-raised (a detached turn can't
        # propagate to an absent client)
        await drain_turn(handle, boom(), _NoMessages())
        drained = []
        while not q.empty():
            drained.append(q.get_nowait())
        return handle, drained

    handle, drained = run_async(scenario())
    assert handle.terminal_status == "error"
    # the last queued item is the terminal sentinel; the real events precede it as (seq, ev) tuples
    assert drained[-1] is TERMINAL
    events = [ev.event for item in drained if item is not TERMINAL for _seq, ev in [item]]
    assert "error" in events and "done" in events


# ── 3: cancel_turn single/double discipline (D39 H2/H3) ────────────────────────────────────────


def _two_call_assistant(session_state):
    from app.domain.conversation import Message, Thread, ToolCallPart
    from app.domain.enums import Actor, RunState
    from app.services.agent.session import AgentSession

    agent = session_state.settings.resolve_agent(None)
    session = AgentSession(
        session_state.threads,
        session_state.messages,
        session_state.inference,
        session_state.settings,
        session_state.actions,
        agent,
        interactive=True,
    )
    thread = run_async(session_state.threads.create(Thread()))
    cid1, cid2 = uuid.uuid4().hex, uuid.uuid4().hex
    assistant = Message(
        thread_id=thread.id,
        role="assistant",
        actor=Actor.AGENT,
        agent="default",
        parts=[
            ToolCallPart(call_id=cid1, tool="call_one", args={"n": 1}, state=RunState.PENDING),
            ToolCallPart(call_id=cid2, tool="call_two", args={"n": 2}, state=RunState.PENDING),
        ],
    )
    run_async(session_state.messages.add(assistant))
    return session, thread, assistant, cid1, cid2


def test_cancel_turn_mid_run_calls_shielded_persist_reconcile_and_double_cancel_noop() -> None:
    from app.domain.enums import RunState
    from app.domain.result import ToolResult
    from app.services.action_service import InvokeOutcome
    from app.services.agent.turns import cancel_turn, drain_turn, release, reserve

    with _client() as c:
        s = c.app.state
        session, thread, assistant, cid1, cid2 = _two_call_assistant(s)
        entered_two = asyncio.Event()

        async def fake_invoke(tool, args, **kw):
            if tool == "call_one":
                return InvokeOutcome(
                    needs_confirm=False, result=ToolResult(state=RunState.OK, summary="ran one", output="one")
                )
            entered_two.set()
            await asyncio.sleep(3600)  # block until the drain task is cancelled
            raise AssertionError("unreachable")

        session._actions.invoke = fake_invoke

        turns: dict = {}
        results: dict = {}

        async def scenario():
            handle = reserve(turns, thread.id, "chat", ring_size=64)
            events = session._drive(thread, resume_assistant=assistant)
            task = asyncio.create_task(drain_turn(handle, events, s.messages))
            handle.task = task
            task.add_done_callback(lambda _t: release(turns, handle))
            await entered_two.wait()
            results["first_cancel"] = cancel_turn(handle)  # THE single cancel
            results["second_cancel"] = cancel_turn(handle)  # a raw double-cancel would pierce the shield
            with contextlib.suppress(asyncio.CancelledError):
                await task
            await asyncio.sleep(0)  # let the done-callback (marker release) run
            results["terminal_status"] = handle.terminal_status

        run_async(scenario())

        assert results["first_cancel"] is True
        assert results["second_cancel"] is False  # latched — exactly one cancel ever
        assert results["terminal_status"] == "cancelled"
        assert turns == {}  # marker released via the task's done-callback

        # the REAL persisted thread: call_one survived (shielded finally), call_two reconciled → CANCELLED
        msgs = run_async(s.messages.list(thread.id))
        by_id = {cp.call_id: cp for m in msgs if m.role == "assistant" for cp in m.tool_calls()}
        assert by_id[cid1].state == RunState.OK
        assert by_id[cid2].state == RunState.CANCELLED  # A11 reconcile inside the cancel path
        tool_rows = [m for m in msgs if m.role == "tool"]
        assert [r.call_id for tr in tool_rows for r in tr.tool_results()] == [cid1]

        # no dangling BEGIN: a fresh transaction works (the Slice-2 hole D39 keeps closed)
        async def _txn_ok():
            async with s.db.transaction():
                return True

        assert run_async(_txn_ok()) is True
    _clear_env()


def test_cancel_turn_returns_false_when_nothing_to_cancel() -> None:
    from app.services.agent.turns import cancel_turn

    handle = _handle()
    assert handle.task is None
    assert cancel_turn(handle) is False  # no task → nothing to cancel


# ── 4: suspension invariant + resume spawns a fresh task ───────────────────────────────────────


def _real_session(c, stream_responses):
    """A real AgentSession whose `stream_chat` is stubbed to replay `stream_responses` (a list of
    ChatDelta lists, one per model call) — no network. Returns (session, thread)."""
    from app.domain.conversation import Thread
    from app.services.agent.session import AgentSession

    s = c.app.state
    agent = s.settings.resolve_agent(None)
    session = AgentSession(s.threads, s.messages, s.inference, s.settings, s.actions, agent, interactive=True)
    thread = run_async(s.threads.create(Thread()))

    calls = {"n": 0}

    async def fake_stream(messages, **kw):
        idx = min(calls["n"], len(stream_responses) - 1)
        calls["n"] += 1
        for delta in stream_responses[idx]:
            yield delta

    session._inference.stream_chat = fake_stream
    return session, thread


def test_suspension_ends_task_normally_then_resume_completes() -> None:
    from app.adapters.inference import ChatDelta, ToolCallRequest
    from app.domain.enums import RunState
    from app.domain.result import ToolResult
    from app.services.action_service import InvokeOutcome
    from app.services.agent.turns import drain_turn, make_subscriber, release, reserve, subscribe_events

    with _client() as c:
        s = c.app.state
        # call 1 → the `question` builtin (suspends via AWAITING_ANSWER); call 2 → a plain text reply
        responses = [
            [
                ChatDelta(
                    tool_calls=[ToolCallRequest(id="q1", name="question", arguments='{"prompt":"which?"}')]
                )
            ],
            [ChatDelta(text="done")],
        ]
        session, thread = _real_session(c, responses)

        async def fake_invoke(tool, args, **kw):
            # `question` returns AWAITING_ANSWER → the turn suspends (no spec lookup on this branch)
            return InvokeOutcome(
                needs_confirm=False, result=ToolResult(state=RunState.AWAITING_ANSWER, summary="which?")
            )

        session._actions.invoke = fake_invoke

        turns: dict = {}
        recorded: dict = {}

        async def run_and_drain(handle, events):
            q = make_subscriber(handle, 256)
            task = asyncio.create_task(drain_turn(handle, events, s.messages))
            handle.task = task
            task.add_done_callback(lambda _t: release(turns, handle))
            seen = [ev.event async for _seq, ev in subscribe_events(q)]
            await task
            await asyncio.sleep(0)
            return seen

        async def scenario():
            h1 = reserve(turns, thread.id, "chat", ring_size=64)
            recorded["turn"] = await run_and_drain(h1, session.run_turn(thread, "hello"))
            recorded["turn_status"] = h1.terminal_status
            recorded["released_after_suspend"] = turns == {}
            # resume spawns a NEW task on a NEW handle (same as chat) — dismiss the question
            h2 = reserve(turns, thread.id, "resume", ring_size=64)
            recorded["resume"] = await run_and_drain(h2, session.resume(thread, "q1", "dismiss"))
            recorded["resume_status"] = h2.terminal_status
            recorded["released_after_resume"] = turns == {}

        run_async(scenario())

        assert "tool.question" in recorded["turn"]
        assert recorded["turn"][-1] == "done"
        assert recorded["turn_status"] == "suspended"
        assert recorded["released_after_suspend"] is True
        # resume ran end-to-end to a normal completion
        assert recorded["resume_status"] == "completed"
        assert recorded["released_after_resume"] is True
    _clear_env()


# ── 5: endpoint wiring (TestClient + the Slice-2 _FakeSession pattern) ─────────────────────────


class _FakeSession:
    def __init__(self, events):
        self._events = events

    async def _drive(self):
        for e in self._events:
            yield e

    async def run_turn(self, *a, **k):
        async for e in self._drive():
            yield e

    async def resume(self, *a, **k):
        async for e in self._drive():
            yield e


def _patch_session(events):
    import app.api.agent as agent_api

    orig = agent_api._session
    agent_api._session = lambda *a, **k: _FakeSession(events)
    return orig


def _restore_session(orig) -> None:
    import app.api.agent as agent_api

    agent_api._session = orig


def _completed_events():
    return [
        _ev("message.start", messageId="m-x", role="assistant"),
        _ev("text.delta", messageId="m-x", delta="hello"),
        _ev("message.end", messageId="m-x"),
        _ev("done", threadId="t", state="completed"),
    ]


def test_buffered_payload_shape_unchanged() -> None:
    try:
        with _client() as c:
            tid = c.post("/api/threads").json()["id"]
            orig = _patch_session(_completed_events())
            try:
                r = c.post("/api/agent/chat", json={"text": "hi", "thread_id": tid, "stream": False})
            finally:
                _restore_session(orig)
            assert r.status_code == 200
            body = r.json()
            assert body["threadId"] == tid
            assert body["state"] == "completed"
            assert body["messageId"] == "m-x"
            assert "title" in body
            assert c.app.state.turns == {}  # released after the buffered turn
    finally:
        _clear_env()


def _pending_task():
    """A real, never-run asyncio.Task on the shared test loop → `.done()` is False (stands in for a
    detached, still-running drain task). Cleaned up via `_drop_task`."""

    async def _mk():
        return asyncio.ensure_future(asyncio.sleep(3600))

    return run_async(_mk())


def _drop_task(task) -> None:
    task.cancel()

    async def _drain():
        with contextlib.suppress(asyncio.CancelledError):
            await task

    with contextlib.suppress(Exception):
        run_async(_drain())


def test_max_active_turns_caps_the_nplus1_spawning_kind() -> None:
    from app.services.agent.turns import reserve

    # cap = 2 task-bearing turns
    tasks = []
    try:
        with _client("server:\n  port: 5433\nagent:\n  turns:\n    max_active_turns: 2\n") as c:
            # two live detached task-bearing turns on other threads
            for t in ("thread-a", "thread-b"):
                h = reserve(c.app.state.turns, t, "chat")
                task = _pending_task()
                h.task = task
                tasks.append(task)

            # a NEW chat on a fresh thread is refused by the cap (not the per-thread busy check)
            tid = c.post("/api/threads").json()["id"]
            r = c.post("/api/agent/chat", json={"text": "hi", "thread_id": tid, "stream": False})
            assert r.status_code == 409
            assert "too many turns" in r.json()["detail"]

            # drop one below the cap → a new chat is accepted again
            gone = c.app.state.turns.pop("thread-a")
            _drop_task(gone.task)
            tasks.remove(gone.task)
            orig = _patch_session(_completed_events())
            try:
                r2 = c.post("/api/agent/chat", json={"text": "hi", "thread_id": tid, "stream": False})
            finally:
                _restore_session(orig)
            assert r2.status_code == 200
    finally:
        for task in tasks:
            _drop_task(task)
        _clear_env()


def test_detached_running_turn_409s_its_thread_but_not_another() -> None:
    from app.services.agent.turns import reserve

    task = None
    try:
        with _client("server:\n  port: 5433\nagent:\n  turns:\n    max_active_turns: 8\n") as c:
            # a detached, still-running turn on a REAL thread A (holds its marker + a live task)
            tid_a = c.post("/api/threads").json()["id"]
            ha = reserve(c.app.state.turns, tid_a, "chat")
            task = _pending_task()
            ha.task = task

            # same thread → per-thread busy 409
            r_same = c.post("/api/agent/chat", json={"text": "hi", "thread_id": tid_a, "stream": False})
            assert r_same.status_code == 409
            assert "already running" in r_same.json()["detail"]

            # a DIFFERENT (fresh) thread still runs (under the cap)
            tid = c.post("/api/threads").json()["id"]
            orig = _patch_session(_completed_events())
            try:
                r_other = c.post("/api/agent/chat", json={"text": "hi", "thread_id": tid, "stream": False})
            finally:
                _restore_session(orig)
            assert r_other.status_code == 200
    finally:
        if task is not None:
            _drop_task(task)
        _clear_env()


if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    for fn in fns:
        fn()
        print(f"ok  {fn.__name__}")
    print(f"\n{len(fns)} passed")
