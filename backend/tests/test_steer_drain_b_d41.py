"""ACA Slice 5 wave 3 — Drain B (turn-end spawn) + harvest-first cancel + the cap-shadows-steer
corner fix (D41).

Drain B fires from a drain task's SYNC done-callback (`_maybe_spawn_drain_b`): iff the turn
`completed` AND the thread has pending steers AND we are not shutting down, the marker is reserved
SYNCHRONOUSLY then an async body (`_drain_b_body`) runs — seeding a NEW turn from the head `message`
entry (the rest drain at that turn's loop top, Drain A), OR draining an all-`exec` queue with NO model
turn. `start_steer_turn` is the state-shaped mirror of the chat endpoint's turn-start internals and
shares the ONE drain-task spawn (`_spawn_drain_task`) with `_turn_response`.

Cancel harvests the queue as its FIRST statement (synchronous pop, before any await), so a `_cleanup`
racing a natural completion finds the queue absent → spawn structurally suppressed. The corner fix
steers a busy chat/resume thread BEFORE the reserve so a saturated `max_active_turns` cap can't shadow
the enqueue with a 409.

Reuses the wave-2 Drain-A harness (one source of truth): a real `AgentSession`/SQLite with a scripted
fake `stream_chat`, driven on the shared `run_async` loop so a task spawned in one call is awaited in
the same call.
"""

from __future__ import annotations

import asyncio
import contextlib

from _async import run_async

# Reuse the wave-2 Drain-A harness verbatim (the shared workspace/client/fake/enqueue helpers).
from test_steer_drain_a_d41 import (
    _client,
    _enqueue,
    _exec_entry,
    _Fake,
    _msg_entry,
    _text,
    _workspace,
)

import app.api.agent as agent_api
from app.domain.conversation import Thread
from app.domain.enums import Privilege
from app.services.agent.steering import SteerEntry
from app.services.agent.turns import TurnHandle, get_terminal, release, reserve


class _Req:
    """Minimal Request shim — `cancel_turn_endpoint` only touches `request.app.state` (+ tries
    `request.json()`, which this lacks → the legacy unscoped-cancel path)."""

    def __init__(self, app) -> None:
        self.app = app


def _completed_handle(thread_id: str, status: str) -> TurnHandle:
    """A bare, already-settled `TurnHandle` standing in for a just-finished drain task's handle (as
    `_cleanup` holds it when it calls `_maybe_spawn_drain_b`)."""
    h = TurnHandle(thread_id=thread_id, kind="chat")
    h.terminal_status = status
    return h


def _new_thread(s) -> Thread:
    return run_async(s.threads.create(Thread()))


def _run_body_directly(s, thread, cfg) -> TurnHandle:
    """Reserve the marker (as `_maybe_spawn_drain_b` does) then AWAIT `_drain_b_body` fully — plus the
    seeded turn's drain task when one is spawned. Returns the reserved handle for post-hoc assertions
    (`.mode`, release). A clean await chain (no polling): the exec subprocesses and the seeded turn all
    settle before this returns."""

    async def _go() -> TurnHandle:
        h = reserve(s.turns, thread.id, "chat", ring_size=cfg.ring_size)
        await agent_api._drain_b_body(s, thread, h, cfg)
        if h.task is not None:  # a turn was seeded — drive its drain task to completion too
            with contextlib.suppress(Exception):
                await h.task
            for _ in range(10):
                await asyncio.sleep(0)  # let the done-callback (release + terminal record) settle
        return h

    return run_async(_go())


async def _settle_thread(s, thread, iters: int = 500) -> None:
    """Yield to the loop until the thread's spawned drain-B chain (body task → seeded turn) quiesces
    and the marker is released. Used when the entry point is the sync `_maybe_spawn_drain_b` (which
    schedules the body as a bare task we can't await directly)."""
    for _ in range(iters):
        await asyncio.sleep(0)
        h = s.turns.get(thread.id)
        if h is not None and h.task is not None and not h.task.done():
            with contextlib.suppress(Exception):
                await h.task
        if thread.id not in s.turns:
            for _ in range(5):
                await asyncio.sleep(0)
            return


def _users(s, thread) -> list[str]:
    rows = run_async(s.messages.list(thread.id))
    return [m.text() for m in rows if m.role == "user"]


# ── spawn matrix: completed + message(s) → a seeded turn; the rest drain at its loop top ──────────
def test_drain_b_completed_message_seeds_turn_remaining_drains_at_loop_top() -> None:
    with _workspace(), _client() as c:
        s = c.app.state
        cfg = s.settings.agent.turns
        thread = _new_thread(s)
        s.inference = _Fake([[_text("ok")]])
        _enqueue(s, thread.id, _msg_entry("steered"))
        _enqueue(s, thread.id, _msg_entry("second"))

        _run_body_directly(s, thread, cfg)

        # The head seeded the turn (run_turn persisted it); "second" drained at the new turn's loop top.
        assert _users(s, thread) == ["steered", "second"]
        assert thread.id not in s.turns  # marker released after the seeded turn completed
        assert len(s.steer_queues.get(thread.id) or []) == 0


def test_drain_b_seeded_turn_runs_under_head_params() -> None:
    with _workspace(), _client() as c:
        s = c.app.state
        cfg = s.settings.agent.turns
        thread = _new_thread(s)
        s.inference = _Fake([[_text("ok")]])
        _enqueue(
            s,
            thread.id,
            SteerEntry(kind="message", text="do it", mode="cloud", agent="researcher", privilege="full"),
        )

        captured: dict = {}
        orig_build = agent_api._build_session

        def spy_build(state, thr, agent_name=None, privilege=None):
            captured["agent"] = agent_name
            captured["privilege"] = privilege
            return orig_build(state, thr, agent_name, privilege)

        agent_api._build_session = spy_build
        try:
            handle = _run_body_directly(s, thread, cfg)
        finally:
            agent_api._build_session = orig_build

        # The spawned turn runs under the head entry's OWN captured params (D41 §9), NOT ignored.
        assert captured["agent"] == "researcher"
        assert captured["privilege"] == Privilege.FULL
        assert handle.mode == "cloud"  # the snapshot mode carried from the entry (D39)


def test_drain_b_all_exec_runs_pairs_no_model_turn_releases_and_records() -> None:
    with _workspace(), _client() as c:
        s = c.app.state
        cfg = s.settings.agent.turns
        s.settings.shell.user_exec_enabled = True
        thread = _new_thread(s)
        fake = _Fake([[_text("must not be called")]])
        s.inference = fake
        _enqueue(s, thread.id, _exec_entry("echo one"))
        _enqueue(s, thread.id, _exec_entry("echo two"))

        _run_body_directly(s, thread, cfg)

        assert fake.calls == 0  # NO model turn for an all-exec queue
        rows = run_async(s.messages.list(thread.id))
        shells = [p for m in rows if m.role == "assistant" for p in m.tool_calls() if p.tool == "run_shell"]
        assert len(shells) == 2  # both pairs persisted via the shared run_user_exec
        assert thread.id not in s.turns  # marker released
        assert len(s.steer_queues.get(thread.id) or []) == 0
        rec = get_terminal(s.turn_terminals, thread.id, linger_s=cfg.linger_s)
        assert rec is not None and rec.terminal_status == "completed"  # a terminal was recorded


def test_drain_b_exec_then_message_runs_exec_first_then_seeds_turn() -> None:
    with _workspace(), _client() as c:
        s = c.app.state
        cfg = s.settings.agent.turns
        s.settings.shell.user_exec_enabled = True
        thread = _new_thread(s)
        s.inference = _Fake([[_text("ok")]])
        _enqueue(s, thread.id, _exec_entry("echo lead"))
        _enqueue(s, thread.id, _msg_entry("then chat"))

        _run_body_directly(s, thread, cfg)

        rows = run_async(s.messages.list(thread.id))
        shell_idx = next(
            i
            for i, m in enumerate(rows)
            if m.role == "assistant" and any(p.tool == "run_shell" for p in m.tool_calls())
        )
        user_idx = next(i for i, m in enumerate(rows) if m.role == "user" and m.text() == "then chat")
        assert shell_idx < user_idx  # FIFO: the leading exec ran BEFORE the message seeded the turn
        assert thread.id not in s.turns


# ── spawn gating: only `completed` spawns ────────────────────────────────────────────────────────
def test_drain_b_suspended_does_not_spawn_queue_survives() -> None:
    with _workspace(), _client() as c:
        s = c.app.state
        cfg = s.settings.agent.turns
        thread = _new_thread(s)
        _enqueue(s, thread.id, _msg_entry("queued"))
        agent_api._maybe_spawn_drain_b(s, thread, _completed_handle(thread.id, "suspended"), cfg)
        assert thread.id not in s.turns  # no new turn reserved
        assert [e.text for e in s.steer_queues[thread.id].peek()] == ["queued"]  # queue intact


def test_drain_b_cancelled_does_not_spawn() -> None:
    with _workspace(), _client() as c:
        s = c.app.state
        cfg = s.settings.agent.turns
        thread = _new_thread(s)
        _enqueue(s, thread.id, _msg_entry("queued"))
        agent_api._maybe_spawn_drain_b(s, thread, _completed_handle(thread.id, "cancelled"), cfg)
        assert thread.id not in s.turns
        assert [e.text for e in s.steer_queues[thread.id].peek()] == ["queued"]


def test_drain_b_shutting_down_does_not_spawn() -> None:
    with _workspace(), _client() as c:
        s = c.app.state
        cfg = s.settings.agent.turns
        thread = _new_thread(s)
        _enqueue(s, thread.id, _msg_entry("queued"))
        s.shutting_down = True  # a completion during shutdown must not spawn into a closing DB
        agent_api._maybe_spawn_drain_b(s, thread, _completed_handle(thread.id, "completed"), cfg)
        assert thread.id not in s.turns
        assert [e.text for e in s.steer_queues[thread.id].peek()] == ["queued"]


def test_maybe_spawn_drain_b_completed_reserves_and_runs() -> None:
    with _workspace(), _client() as c:
        s = c.app.state
        cfg = s.settings.agent.turns
        thread = _new_thread(s)
        s.inference = _Fake([[_text("ok")]])
        _enqueue(s, thread.id, _msg_entry("go"))
        holder: dict = {}

        async def _go() -> None:
            agent_api._maybe_spawn_drain_b(s, thread, _completed_handle(thread.id, "completed"), cfg)
            holder["reserved"] = thread.id in s.turns  # a new marker was reserved SYNCHRONOUSLY
            await _settle_thread(s, thread)

        run_async(_go())
        assert holder["reserved"] is True
        assert "go" in _users(s, thread)  # the seeded turn actually ran
        assert thread.id not in s.turns  # released after it completed


# ── harvest-first cancel ─────────────────────────────────────────────────────────────────────────
def test_cancel_harvests_entries_and_drops_the_queue() -> None:
    with _workspace(), _client() as c:
        s = c.app.state
        cfg = s.settings.agent.turns
        thread = _new_thread(s)
        handle = reserve(s.turns, thread.id, "chat", ring_size=cfg.ring_size)
        _enqueue(s, thread.id, _msg_entry("q1"))
        _enqueue(s, thread.id, _exec_entry("echo q2"))

        async def _go() -> dict:
            handle.task = asyncio.create_task(asyncio.sleep(3600))  # a live (blocked) turn to cancel
            return await agent_api.cancel_turn_endpoint(thread.id, _Req(c.app))

        out = run_async(_go())
        assert out["cancelled"] is True
        assert [(e["kind"], e["text"]) for e in out["steer_queue"]] == [
            ("message", "q1"),
            ("exec", "echo q2"),
        ]
        assert thread.id not in s.steer_queues  # the queue is GONE (harvested)


def test_cancel_harvest_suppresses_a_racing_cleanup_spawn() -> None:
    with _workspace(), _client() as c:
        s = c.app.state
        cfg = s.settings.agent.turns
        thread = _new_thread(s)
        handle = reserve(s.turns, thread.id, "chat", ring_size=cfg.ring_size)
        _enqueue(s, thread.id, _msg_entry("q1"))

        async def _go() -> tuple[dict, bool]:
            handle.task = asyncio.create_task(asyncio.sleep(3600))
            out = await agent_api.cancel_turn_endpoint(thread.id, _Req(c.app))
            # A natural-completion `_cleanup` now races in AFTER the harvest: the queue is gone, so
            # drain-B must find nothing and reserve nothing (spawn structurally suppressed).
            release(s.turns, handle)
            agent_api._maybe_spawn_drain_b(s, thread, _completed_handle(thread.id, "completed"), cfg)
            return out, thread.id in s.turns

        out, spawned = run_async(_go())
        assert [(e["kind"], e["text"]) for e in out["steer_queue"]] == [("message", "q1")]
        assert thread.id not in s.steer_queues
        assert spawned is False  # queue absent → no drain-B spawn


def test_no_live_turn_cancel_still_harvests() -> None:
    with _workspace(), _client() as c:
        s = c.app.state
        thread = _new_thread(s)
        _enqueue(s, thread.id, _msg_entry("orphan"))
        out = run_async(agent_api.cancel_turn_endpoint(thread.id, _Req(c.app)))
        assert out["cancelled"] is False and out["active"] is False
        assert [(e["kind"], e["text"]) for e in out["steer_queue"]] == [("message", "orphan")]
        assert thread.id not in s.steer_queues


def test_double_cancel_second_harvest_is_empty() -> None:
    with _workspace(), _client() as c:
        s = c.app.state
        thread = _new_thread(s)
        _enqueue(s, thread.id, _msg_entry("once"))
        first = run_async(agent_api.cancel_turn_endpoint(thread.id, _Req(c.app)))
        second = run_async(agent_api.cancel_turn_endpoint(thread.id, _Req(c.app)))
        assert [(e["kind"], e["text"]) for e in first["steer_queue"]] == [("message", "once")]
        assert second["steer_queue"] == []  # already harvested by the first cancel


# ── the cap-shadows-steer corner fix ─────────────────────────────────────────────────────────────
def test_corner_fix_steer_busy_thread_under_saturated_cap_returns_202() -> None:
    cfg_text = "server:\n  port: 5433\nagent:\n  turns:\n    max_active_turns: 1\n"
    with _workspace(cfg_text), _client() as c:
        s = c.app.state
        rs = s.settings.agent.turns.ring_size
        # Saturate the cap with ANOTHER thread's live task-bearing turn (task=None counts, D39), AND
        # plant a chat holder on the target thread so it is genuinely busy.
        reserve(s.turns, "other-thread", "chat", ring_size=rs)
        tid = c.post("/api/threads").json()["id"]
        reserve(s.turns, tid, "chat", ring_size=rs)

        # Without the corner fix, `_reserve_or_busy`'s cap check would 409 BEFORE learning the thread
        # is busy. The fix steers first → 202 enqueue.
        r = c.post("/api/agent/chat", json={"text": "steer under cap", "thread_id": tid})
        assert r.status_code == 202
        assert [e.text for e in s.steer_queues[tid].peek()] == ["steer under cap"]


def test_corner_fix_mirrored_in_exec_endpoint() -> None:
    cfg_text = (
        "server:\n  port: 5433\nshell:\n  user_exec_enabled: true\n"
        "agent:\n  turns:\n    max_active_turns: 1\n"
    )
    with _workspace(cfg_text), _client() as c:
        s = c.app.state
        rs = s.settings.agent.turns.ring_size
        reserve(s.turns, "other-thread", "chat", ring_size=rs)
        tid = c.post("/api/threads").json()["id"]
        reserve(s.turns, tid, "chat", ring_size=rs)

        r = c.post("/api/exec", json={"command": "uptime", "thread_id": tid})
        assert r.status_code == 202
        assert [e.text for e in s.steer_queues[tid].peek()] == ["uptime"]


# ── reserve race: a fresh POST won the thread between completion and the drain-B callback ─────────
def test_reserve_race_leaves_queue_intact_no_crash() -> None:
    with _workspace(), _client() as c:
        s = c.app.state
        cfg = s.settings.agent.turns
        thread = _new_thread(s)
        _enqueue(s, thread.id, _msg_entry("q1"))
        # A NEW turn already holds the thread marker (the fresh POST that won the race).
        winner = reserve(s.turns, thread.id, "chat", ring_size=cfg.ring_size)
        # Firing drain-B must hit TurnBusy on the sync reserve → leave the queue for the winner.
        agent_api._maybe_spawn_drain_b(s, thread, _completed_handle(thread.id, "completed"), cfg)
        assert s.turns.get(thread.id) is winner  # winner's marker untouched
        assert [e.text for e in s.steer_queues[thread.id].peek()] == ["q1"]  # queue intact


# ── mid-build audit fix wave (MED-1..4) ──────────────────────────────────────────────────────────
def _exec_outcome():
    """A canned `ExecOutcome` for a gated `run_user_exec` stub (the command's real body is irrelevant —
    these tests exercise commit/spawn ORDERING around the run, not the shell)."""
    from app.domain.enums import RunState
    from app.domain.result import ToolResult
    from app.services.agent.exec import ExecOutcome

    return ExecOutcome(call_id="x", assistant_id="a", result=ToolResult(state=RunState.OK, summary="ran"))


def test_med1_exec_commit_before_run_harvest_midexec_no_double_run() -> None:
    """MED-1: `_run_steer_exec` commits the entry OFF the queue BEFORE run_user_exec. A harvest landing
    mid-execution therefore sees an EMPTY queue for that entry — it can't hand the running command back
    to the composer (the double-run window). The command still runs exactly once."""
    with _workspace(), _client() as c:
        s = c.app.state
        s.settings.shell.user_exec_enabled = True
        thread = _new_thread(s)
        entry = _exec_entry("echo once")
        _enqueue(s, thread.id, entry)

        gate = asyncio.Event()
        calls = {"n": 0}
        orig = agent_api.run_user_exec

        async def gated(actions, messages, tid, command):
            calls["n"] += 1
            await gate.wait()  # block "mid-execution" so the harvest races us
            return _exec_outcome()

        agent_api.run_user_exec = gated
        try:

            async def _go() -> list[str]:
                q = s.steer_queues[thread.id]
                task = asyncio.create_task(agent_api._run_steer_exec(s, thread, q, entry))
                for _ in range(10):
                    await asyncio.sleep(0)  # let the task reach the gate (PAST the commit)
                harvested = s.steer_queues.pop(thread.id, None)  # Stop harvests mid-execution
                snap = [e.entry_id for e in harvested.peek()] if harvested else []  # snapshot BEFORE the gate
                gate.set()
                await task
                return snap

            snap = run_async(_go())
        finally:
            agent_api.run_user_exec = orig

        assert snap == []  # committed before the run → the harvest saw no exec entry
        assert calls["n"] == 1  # ran exactly once


def test_med2_stale_head_no_double_spawn_new_queue_untouched() -> None:
    """MED-2: the drain-B head commit is load-bearing. If the queue is harvested + recreated by a fresh
    POST while a leading exec runs, the stale peeked head no longer belongs to the live queue, so
    `commit` removes nothing (returns 0) and NO turn spawns — the new queue is untouched."""
    from app.services.agent.steering import SteerQueue

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

            async def _go() -> None:
                h = reserve(s.turns, thread.id, "chat", ring_size=cfg.ring_size)
                task = asyncio.create_task(agent_api._drain_b_body(s, thread, h, cfg))
                for _ in range(10):
                    await asyncio.sleep(0)
                gate.set()
                await task

            run_async(_go())
        finally:
            agent_api.run_user_exec = orig

        assert s.inference.calls == 0  # NO turn spawned from the stale head
        assert thread.id not in s.turns  # marker released
        assert [e.text for e in s.steer_queues[thread.id].peek()] == [
            "fresh post message"
        ]  # new queue intact


def test_med3_spawn_prelude_raise_requeues_head_at_front() -> None:
    """MED-3: a raise in the spawn prelude (`_auto_route_agent`) AFTER the head is committed off the
    queue must not lose the message — it is re-enqueued at the FRONT, the marker is released, and nothing
    is persisted. The body swallows the exception (no crash)."""
    with _workspace(), _client() as c:
        s = c.app.state
        cfg = s.settings.agent.turns
        thread = _new_thread(s)
        s.inference = _Fake([[_text("unused")]])
        _enqueue(s, thread.id, _msg_entry("keep me"))

        orig = agent_api._auto_route_agent

        def boom(*a, **k):
            raise RuntimeError("prelude boom")

        agent_api._auto_route_agent = boom
        try:
            _run_body_directly(s, thread, cfg)  # the body catches internally → no raise here
        finally:
            agent_api._auto_route_agent = orig

        assert [e.text for e in s.steer_queues[thread.id].peek()] == ["keep me"]  # requeued at the front
        assert thread.id not in s.turns  # marker released
        assert _users(s, thread) == []  # nothing persisted


def test_med4_shutdown_recheck_releases_before_body_runs() -> None:
    """MED-4: `shutting_down` set AFTER the drain-B reserve but BEFORE the body runs → the body's first
    statement releases the marker and bails, so a natural completion can't spawn a turn into a closing
    DB."""
    with _workspace(), _client() as c:
        s = c.app.state
        cfg = s.settings.agent.turns
        thread = _new_thread(s)
        s.inference = _Fake([[_text("must not run")]])
        _enqueue(s, thread.id, _msg_entry("queued"))
        h = reserve(s.turns, thread.id, "chat", ring_size=cfg.ring_size)
        s.shutting_down = True  # set AFTER the reserve, BEFORE the body runs

        run_async(agent_api._drain_b_body(s, thread, h, cfg))

        assert thread.id not in s.turns  # released by the shutdown re-check (no spawn, marker not held)
        assert s.inference.calls == 0  # nothing ran
        assert [e.text for e in s.steer_queues[thread.id].peek()] == ["queued"]  # queue untouched


if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    for fn in fns:
        fn()
        print(f"ok  {fn.__name__}")
    print(f"\n{len(fns)} passed")
