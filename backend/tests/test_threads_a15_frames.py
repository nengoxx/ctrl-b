"""Phase 27 S3 — the `thread` frame, the server half of a conversation's live status (D84,
CONVERSATIONS_PLAN §5 / §10 "S3", DESIGN §12).

The EventBus carries `Event | ThreadFrame`; ONE producer (`_publish_thread_frame`) publishes `running`
from `_spawn_drain_task`, the terminal LAST from its `_cleanup` (`chained` = a drain-B body was
spawned), the terminal of every NON-handoff drain-B exit from `_drain_b_body`'s `finally` (§12.3 M2),
and `seen` from `PATCH /api/threads/{id}` when `seen_at` moved. Archived threads and `!cmd` exec
publish nothing. On the wire a frame is `event: thread` with NO `id`; an `Event` renders unchanged.

Each test subscribes to `app.state.event_bus` and collects what lands. Drain-B chains are driven the
way `test_steer_drain_b_d41.py` drives them (the shared `run_async` loop, the scripted `_Fake`).
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import time
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

from _async import run_async
from test_steer_drain_a_d41 import _client, _enqueue, _exec_entry, _Fake, _msg_entry, _text, _workspace
from test_steer_drain_b_d41 import _exec_outcome, _Req, _settle_thread

import app.api.agent as agent_api
from app.core.events import _QUEUE_MAXSIZE, EventBus, ThreadFrame
from app.domain.conversation import Thread
from app.domain.enums import Actor, RunState
from app.domain.event import Event
from app.services.agent.steering import SteerQueue
from app.services.agent.turns import reserve

# ── helpers ────────────────────────────────────────────────────────────────────────────────────


@contextlib.contextmanager
def _subscribed(bus: EventBus) -> Iterator[asyncio.Queue]:
    """Subscribe to the bus (its public `subscribe`, entered on the shared test loop) for the block."""
    cm = bus.subscribe()
    q = run_async(cm.__aenter__())
    try:
        yield q
    finally:
        run_async(cm.__aexit__(None, None, None))


def _take(q: asyncio.Queue) -> list:
    out = []
    while True:
        try:
            out.append(q.get_nowait())
        except asyncio.QueueEmpty:
            return out


def _frames(items: list, thread_id: str | None = None) -> list[ThreadFrame]:
    return [
        i for i in items if isinstance(i, ThreadFrame) and (thread_id is None or i.thread_id == thread_id)
    ]


def _shape(f: ThreadFrame) -> tuple:
    return (f.state, f.turn_id, f.agent, f.chained)


def _new_thread(s, **kw) -> Thread:
    return run_async(s.threads.create(Thread(agent="default", **kw)))


def _start_turn(s, thread: Thread, text: str) -> None:
    """A detached server-owned turn (no client subscriber): reserve the marker, then the drain-B seed
    path's `start_steer_turn` — the same ONE `_spawn_drain_task` every chat turn uses — and settle the
    whole chain behind it."""

    async def _go() -> None:
        reserve(s.turns, thread.id, "chat", ring_size=s.settings.agent.turns.ring_size)
        await agent_api.start_steer_turn(s, thread, [_msg_entry(text)])
        await _settle_thread(s, thread)

    run_async(_go())


def _poll(q: asyncio.Queue, thread_id: str, n: int, timeout: float = 5.0) -> list[ThreadFrame]:
    """Collect until `n` frames for `thread_id` landed — for turns that drain on the TestClient's loop
    (the done-callback can run just after the HTTP response returns)."""
    got: list = []
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        got += _take(q)
        if len(_frames(got, thread_id)) >= n:
            break
        time.sleep(0.01)
    time.sleep(0.05)  # anything extra (a duplicate) would land now
    got += _take(q)
    return _frames(got, thread_id)


# ── the producer: running → terminal ───────────────────────────────────────────────────────────


def test_a_detached_chat_turn_publishes_running_then_its_terminal() -> None:
    with _workspace(), _client() as c:
        s = c.app.state
        s.inference = _Fake([[_text("hi back")]])
        with _subscribed(s.event_bus) as q:
            r = c.post("/api/agent/chat", json={"text": "hello", "stream": False})
            assert r.status_code == 200, r.text
            tid = r.json()["threadId"]
            frames = _poll(q, tid, 2)
        home = run_async(s.threads.get(tid))
        assert home is not None and home.agent is not None
        assert [f.state for f in frames] == ["running", "completed"]
        running, done = frames
        assert running.turn_id is not None and done.turn_id == running.turn_id
        assert {running.agent, done.agent} == {home.agent}  # the HOME agent
        assert running.chained is False and done.chained is False


def test_a_drain_b_chain_marks_the_first_terminal_chained_then_the_steer_turns_own_frames() -> None:
    with _workspace(), _client() as c:
        s = c.app.state
        thread = _new_thread(s)

        async def on_call(idx, _messages):
            if idx == 0:  # a steer lands while the first turn streams → drain-B seeds a second turn
                _enqueue(s, thread.id, _msg_entry("steered"))

        s.inference = _Fake([[_text("one")], [_text("two")]], on_call=on_call)
        with _subscribed(s.event_bus) as q:
            _start_turn(s, thread, "first")
            frames = _frames(_take(q), thread.id)

        assert [(f.state, f.chained) for f in frames] == [
            ("running", False),
            ("completed", True),  # a drain-B body was spawned behind it — the client waits for the next
            ("running", False),
            ("completed", False),
        ]
        first, second = frames[0].turn_id, frames[2].turn_id
        assert first and second and first != second
        assert frames[1].turn_id == first and frames[3].turn_id == second
        assert {f.agent for f in frames} == {"default"}
        assert thread.id not in s.turns


def test_an_all_exec_drain_b_publishes_its_terminal_from_the_bodys_finally() -> None:
    with _workspace(), _client() as c:
        s = c.app.state
        s.settings.shell.user_exec_enabled = True
        thread = _new_thread(s)

        async def on_call(idx, _messages):
            if idx == 0:
                _enqueue(s, thread.id, _exec_entry("echo queued"))

        s.inference = _Fake([[_text("one")]], on_call=on_call)
        with _subscribed(s.event_bus) as q:
            _start_turn(s, thread, "first")
            items = _take(q)
        frames = _frames(items, thread.id)

        assert s.inference.calls == 1  # the all-exec drain ran NO model turn
        assert [(f.state, f.chained) for f in frames] == [
            ("running", False),
            ("completed", True),
            ("completed", False),  # the drain-B body's own terminal (M2) — no `running` of its own
        ]
        assert frames[2].turn_id not in (None, frames[0].turn_id)
        assert any(isinstance(i, Event) for i in items)  # the exec's Event still rides the same bus
        assert thread.id not in s.turns


def test_a_stop_mid_chain_publishes_cancelled_from_the_bodys_finally_exactly_once() -> None:
    with _workspace(), _client() as c:
        s = c.app.state
        s.settings.shell.user_exec_enabled = True
        thread = _new_thread(s)

        async def on_call(idx, _messages):
            if idx == 0:
                _enqueue(s, thread.id, _exec_entry("echo long"))

        s.inference = _Fake([[_text("one")]], on_call=on_call)
        gate = asyncio.Event()
        orig = agent_api.run_user_exec

        async def gated(actions, messages, tid, command):
            await gate.wait()
            return _exec_outcome()

        agent_api.run_user_exec = gated
        try:
            with _subscribed(s.event_bus) as q:

                async def _go() -> tuple[str, dict]:
                    reserve(s.turns, thread.id, "chat", ring_size=s.settings.agent.turns.ring_size)
                    await agent_api.start_steer_turn(s, thread, [_msg_entry("first")])
                    first = s.turns[thread.id]
                    assert first.task is not None
                    with contextlib.suppress(Exception):
                        await first.task
                    for _ in range(20):
                        await asyncio.sleep(0)  # the chain's body reaches the gated exec
                    body = s.turns[thread.id]
                    cancel = await agent_api.cancel_turn_endpoint(thread.id, _Req(c.app))  # Stop
                    gate.set()
                    for _ in range(20):
                        await asyncio.sleep(0)
                    return body.turn_id, cancel

                body_turn, cancel = run_async(_go())
                frames = _frames(_take(q), thread.id)
        finally:
            agent_api.run_user_exec = orig

        assert cancel["cancelled"] is True
        assert [(f.state, f.chained) for f in frames] == [
            ("running", False),
            ("completed", True),
            ("cancelled", False),
        ]
        assert frames[2].turn_id == body_turn
        assert sum(1 for f in frames if f.turn_id == body_turn) == 1  # exactly once
        assert thread.id not in s.turns


def test_the_drain_b_bodys_other_non_handoff_exits_each_publish_one_terminal() -> None:
    """The harvested-queue early return (`cancelled`), the prelude raise (`error` — the chain DID
    fail, so the client is told rather than left on an ignored `cancelled`) and the MED-4 shutdown
    bail (`cancelled`) each publish exactly one terminal for the body's `turn_id` (M2)."""
    with _workspace(), _client() as c:
        s = c.app.state
        cfg = s.settings.agent.turns
        harvested = _new_thread(s)  # no queue at all → the body's first early return
        raising = _new_thread(s)
        _enqueue(s, raising.id, _msg_entry("keep me"))
        bailing = _new_thread(s)
        _enqueue(s, bailing.id, _msg_entry("queued"))
        orig = agent_api._build_session

        def boom(*a, **k):
            raise RuntimeError("prelude boom")

        agent_api._build_session = boom
        try:
            with _subscribed(s.event_bus) as q:
                turns: dict[str, str] = {}
                for t in (harvested, raising, bailing):
                    h = reserve(s.turns, t.id, "chat", ring_size=cfg.ring_size)
                    turns[t.id] = h.turn_id
                    s.shutting_down = t is bailing  # MED-4: set after the reserve, before the body runs
                    run_async(agent_api._drain_b_body(s, t, h, cfg))
                items = _take(q)
        finally:
            agent_api._build_session = orig

        expected = {harvested.id: "cancelled", raising.id: "error", bailing.id: "cancelled"}
        for t in (harvested, raising, bailing):
            assert [_shape(f) for f in _frames(items, t.id)] == [
                (expected[t.id], turns[t.id], "default", False)
            ]
            assert t.id not in s.turns
        assert [e.text for e in s.steer_queues[raising.id].peek()] == ["keep me"]  # MED-3 requeue held


def test_a_stale_head_drain_b_publishes_one_cancelled_terminal() -> None:
    """MED-2: the peeked head is no longer the live queue's → the body abandons (no turn) and its
    `finally` publishes exactly one `cancelled` for the body's `turn_id` — nothing else from the body."""
    with _workspace(), _client() as c:
        s = c.app.state
        cfg = s.settings.agent.turns
        s.settings.shell.user_exec_enabled = True
        thread = _new_thread(s)
        s.inference = _Fake([[_text("must not spawn")]])
        _enqueue(s, thread.id, _exec_entry("echo lead"))
        _enqueue(s, thread.id, _msg_entry("stale head"))
        gate = asyncio.Event()
        orig = agent_api.run_user_exec

        async def gated(actions, messages, tid, command):
            # A fresh POST harvests the whole queue + installs a NEW one while the leading exec runs.
            s.steer_queues.pop(thread.id, None)
            newq = SteerQueue()
            newq.append(_msg_entry("fresh post message"))
            s.steer_queues[thread.id] = newq
            await gate.wait()
            return _exec_outcome()

        agent_api.run_user_exec = gated
        try:
            with _subscribed(s.event_bus) as q:

                async def _go() -> str:
                    h = reserve(s.turns, thread.id, "chat", ring_size=cfg.ring_size)
                    task = asyncio.create_task(agent_api._drain_b_body(s, thread, h, cfg))
                    for _ in range(10):
                        await asyncio.sleep(0)
                    gate.set()
                    await task
                    return h.turn_id

                body_turn = run_async(_go())
                frames = _frames(_take(q), thread.id)
        finally:
            agent_api.run_user_exec = orig

        assert s.inference.calls == 0  # NO turn spawned from the stale head
        assert [_shape(f) for f in frames] == [("cancelled", body_turn, "default", False)]
        assert thread.id not in s.turns


def test_no_spawn_at_completion_publishes_chained_false_and_no_body_frame() -> None:
    """`_maybe_spawn_drain_b` returning False reaches the terminal frame: a fresh POST that already won
    the thread (`TurnBusy` on the sync reserve), an empty steer queue and an absent one each leave the
    completed turn's terminal at `chained: false`, with no body frame behind it."""
    with _workspace(), _client() as c:
        s = c.app.state
        cfg = s.settings.agent.turns
        busy, empty, absent = _new_thread(s), _new_thread(s), _new_thread(s)
        winners: dict = {}

        async def on_call(idx, _messages):
            if idx == 0:
                _enqueue(s, busy.id, _msg_entry("steered"))  # pending — but the thread is lost
            elif idx == 1:
                s.steer_queues[empty.id] = SteerQueue()  # present, empty

        orig = agent_api._maybe_spawn_drain_b

        def won_by_a_fresh_post(state, thread, handle, cfg_):
            if thread.id == busy.id:  # the fresh POST holds the marker when the chain is decided
                winners[thread.id] = reserve(state.turns, thread.id, "chat", ring_size=cfg.ring_size)
            return orig(state, thread, handle, cfg_)

        s.inference = _Fake([[_text("ok")]], on_call=on_call)
        agent_api._maybe_spawn_drain_b = won_by_a_fresh_post
        try:
            with _subscribed(s.event_bus) as q:
                for t in (busy, empty, absent):
                    _start_turn(s, t, "go")
                    if t is busy:
                        assert s.turns.get(busy.id) is winners[busy.id]  # the winner's marker untouched
                        s.turns.pop(busy.id)
                items = _take(q)
        finally:
            agent_api._maybe_spawn_drain_b = orig

        for t in (busy, empty, absent):
            frames = _frames(items, t.id)
            assert [(f.state, f.chained) for f in frames] == [("running", False), ("completed", False)]
            assert frames[0].turn_id == frames[1].turn_id
        assert [e.text for e in s.steer_queues[busy.id].peek()] == ["steered"]  # left for the winner


# ── the drain-B body's never-started window (the `_cleanup` C4-M3 mirror) ──────────────────────


@contextlib.contextmanager
def _spy_drain_b(*, cancel_first: bool = False) -> Iterator[list]:
    """Wrap the real `_maybe_spawn_drain_b` (looked up as a module global by `_cleanup` and the body's
    `finally`) to collect each spawned body `(handle, task)`; `cancel_first` cancels the FIRST body
    task synchronously right after its spawn — before the loop ever steps it."""
    orig = agent_api._maybe_spawn_drain_b
    bodies: list = []

    def spy(state, thread, handle, cfg) -> bool:
        spawned = orig(state, thread, handle, cfg)
        if spawned:
            h = state.turns[thread.id]
            bodies.append((h, h.task))
            if cancel_first and len(bodies) == 1:
                h.task.cancel()
        return spawned

    agent_api._maybe_spawn_drain_b = spy
    try:
        yield bodies
    finally:
        agent_api._maybe_spawn_drain_b = orig


def test_a_drain_b_body_cancelled_before_its_first_step_releases_and_publishes_cancelled() -> None:
    with _workspace(), _client() as c:
        s = c.app.state
        thread = _new_thread(s)

        async def on_call(idx, _messages):
            if idx == 0:
                _enqueue(s, thread.id, _msg_entry("steered"))

        s.inference = _Fake([[_text("one")], [_text("never")]], on_call=on_call)
        with _subscribed(s.event_bus) as q, _spy_drain_b(cancel_first=True) as bodies:
            _start_turn(s, thread, "first")
            frames = _frames(_take(q), thread.id)

        assert len(bodies) == 1
        body, task = bodies[0]
        assert task.cancelled()  # it never ran a step
        assert thread.id not in s.turns  # the marker is released — the thread does not 409 forever
        assert body.terminal_status == "cancelled"
        assert s.inference.calls == 1  # no seeded turn
        assert [(f.state, f.turn_id, f.chained) for f in frames] == [
            ("running", frames[0].turn_id, False),
            ("completed", frames[0].turn_id, True),
            ("cancelled", body.turn_id, False),  # exactly one, from the backstop
        ]
        assert [e.text for e in s.steer_queues[thread.id].peek()] == ["steered"]  # nothing lost


def test_a_body_that_ran_or_handed_off_never_gets_a_second_terminal_from_the_backstop() -> None:
    with _workspace(), _client() as c:
        s = c.app.state
        s.settings.shell.user_exec_enabled = True
        handed, ran = _new_thread(s), _new_thread(s)

        async def on_call(idx, _messages):
            if idx == 0:  # handed: a message steer → the body seeds a turn (call 1) and hands off
                _enqueue(s, handed.id, _msg_entry("steered"))
            elif idx == 2:  # ran: an exec steer → the all-exec body runs to its own terminal
                _enqueue(s, ran.id, _exec_entry("echo queued"))

        s.inference = _Fake([[_text("one")], [_text("two")], [_text("three")]], on_call=on_call)
        with _subscribed(s.event_bus) as q, _spy_drain_b() as bodies:
            _start_turn(s, handed, "first")
            _start_turn(s, ran, "first")

            async def _quiesce() -> None:
                for _ in range(20):
                    await asyncio.sleep(0)  # every body's done-callback has had its turn

            run_async(_quiesce())
            items = _take(q)

        assert [t.done() for _h, t in bodies] == [True, True]
        (h_handed, _), (h_ran, _) = bodies
        handed_terminals = [f.state for f in _frames(items, handed.id) if f.turn_id == h_handed.turn_id]
        ran_terminals = [f.state for f in _frames(items, ran.id) if f.turn_id == h_ran.turn_id]
        assert handed_terminals == ["running", "completed"]  # the seeded turn's own pair, nothing more
        assert ran_terminals == ["completed"]  # the all-exec body's one terminal, nothing more
        assert handed.id not in s.turns and ran.id not in s.turns


# ── seen ───────────────────────────────────────────────────────────────────────────────────────


def test_seen_publishes_on_a_moved_seen_at_and_nothing_on_a_no_op() -> None:
    with _workspace(), _client() as c:
        s = c.app.state
        t0 = datetime(2026, 10, 1, 12, 0, tzinfo=UTC)  # in the past, so the write is never clamped to now
        thread = _new_thread(s, created_at=t0, updated_at=t0)
        at = (t0 + timedelta(minutes=1)).isoformat()
        with _subscribed(s.event_bus) as q:
            assert c.patch(f"/api/threads/{thread.id}", json={"seen_at": at}).status_code == 200
            moved = _poll(q, thread.id, 1)
            c.patch(f"/api/threads/{thread.id}", json={"seen_at": at})  # unmoved → nothing
            c.patch(f"/api/threads/{thread.id}", json={"title": "renamed"})  # no seen_at → nothing
            after = _poll(q, thread.id, 1, timeout=0.2)

        assert [_shape(f) for f in moved] == [("seen", None, "default", False)]
        assert after == []


# ── never: archived · exec ─────────────────────────────────────────────────────────────────────


def test_an_archived_thread_publishes_nothing() -> None:
    """An automation's thread is archived; its turn spawns through the SAME `_spawn_drain_task`."""
    with _workspace(), _client() as c:
        s = c.app.state
        thread = _new_thread(s, archived=True)
        s.inference = _Fake([[_text("ok")]])
        with _subscribed(s.event_bus) as q:
            _start_turn(s, thread, "run")
            frames = _frames(_take(q))
        assert s.inference.calls == 1  # the turn ran
        assert frames == []


def test_an_exec_publishes_no_thread_frame() -> None:
    with _workspace(), _client() as c:
        s = c.app.state
        s.settings.shell.user_exec_enabled = True
        thread = _new_thread(s)
        with _subscribed(s.event_bus) as q:
            r = c.post("/api/exec", json={"thread_id": thread.id, "command": "echo hi"})
            assert r.status_code == 200, r.text
            time.sleep(0.05)
            items = _take(q)
        assert any(isinstance(i, Event) for i in items)  # the run_shell Event landed on the bus
        assert _frames(items) == []


# ── the wire ───────────────────────────────────────────────────────────────────────────────────


def _drive_stream(*items: object) -> list[dict]:
    """Run `stream_events`' generator far enough to render the published items (the
    `test_notifications_f1` pattern: the first `is_disconnected()` publishes, the second ends it)."""
    import app.api.events as events_api
    from app.services import wake_on_connect

    app = SimpleNamespace(state=SimpleNamespace(event_bus=EventBus()))

    class _FakeRequest:
        def __init__(self) -> None:
            self.app = app
            self._checks = 0

        async def is_disconnected(self) -> bool:
            self._checks += 1
            if self._checks == 1:
                for item in items:
                    app.state.event_bus.publish(item)
                return False
            return self._checks > len(items)

    async def drive() -> list[dict]:
        response = await events_api.stream_events(_FakeRequest())  # type: ignore[arg-type]
        return [frame async for frame in response.body_iterator]

    real_schedule = wake_on_connect.schedule
    try:
        wake_on_connect.schedule = lambda _app: None  # type: ignore[assignment]
        return asyncio.run(drive())
    finally:
        wake_on_connect.schedule = real_schedule  # type: ignore[assignment]


def test_the_wire_renders_a_thread_frame_without_an_id_and_an_event_unchanged() -> None:
    frame = ThreadFrame(thread_id="t1", state="completed", turn_id="u1", agent="lyn", chained=True)
    event = Event(actor=Actor.USER, action="run_shell", target="alpha", status=RunState.OK, summary="ok")

    rendered = _drive_stream(frame, event)

    assert rendered == [
        {"event": "thread", "data": frame.model_dump_json()},  # NO `id` — never replayed
        {"event": "event", "id": event.id, "data": event.model_dump_json(exclude={"output"})},
    ]
    assert json.loads(rendered[0]["data"]) == {
        "thread_id": "t1",
        "state": "completed",
        "turn_id": "u1",
        "agent": "lyn",
        "chained": True,
    }


# ── a slow subscriber drops; the producer never blocks ─────────────────────────────────────────


def test_a_full_subscriber_queue_drops_the_oldest_and_never_blocks_the_producer() -> None:
    bus = EventBus()
    with _subscribed(bus) as q:
        for i in range(_QUEUE_MAXSIZE + 5):
            bus.publish(ThreadFrame(thread_id=f"t{i}", state="running"))
        bus.publish(Event(actor=Actor.USER, action="x", target="y", status=RunState.OK))
        got = _take(q)
    assert len(got) == _QUEUE_MAXSIZE
    assert isinstance(got[-1], Event)  # the newest always lands
    assert got[0].thread_id == "t6"  # the six oldest were shed


def test_a_turn_completes_with_a_full_subscriber_and_its_frames_land_newest() -> None:
    with _workspace(), _client() as c:
        s = c.app.state
        thread = _new_thread(s)
        s.inference = _Fake([[_text("ok")]])
        with _subscribed(s.event_bus) as q:
            for i in range(_QUEUE_MAXSIZE):  # a subscriber that never reads
                s.event_bus.publish(ThreadFrame(thread_id=f"filler{i}", state="seen"))
            _start_turn(s, thread, "go")
            got = _take(q)
        assert thread.id not in s.turns  # the turn ran to completion and released
        assert len(got) == _QUEUE_MAXSIZE
        assert [f.state for f in _frames(got[-2:], thread.id)] == ["running", "completed"]
