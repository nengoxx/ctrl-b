"""ACA Slice 3 wave 3 — durable-turn re-attach / status / cancel + shutdown drain (D39, §5 v2.5).

Wave 3 adds the read-side + control surface over the wave-2 server-owned drain task:

  1. `GET /api/agent/turns/{thread_id}` — the lightweight status probe: live handle → active+seq;
     finished → terminal cache; lingered out → bare active:false.
  2. `GET /api/agent/turns/{thread_id}/stream` — re-attach: TAIL-replay from a ring cursor, or ONE
     `turn.sync` snapshot, then live (deduped); non-live → a JSON active:false answer.
  3. `POST /api/agent/turns/{thread_id}/cancel` — writes nothing (the drain task owns all mutation);
     idempotent; the `cancelling` latch fires exactly one raw `task.cancel()`.
  4. Lifespan shutdown drain — a live detached turn is cancelled + awaited (its shielded finally
     persists) BEFORE the DB closes; no leaked-task warning.
  5. CPython #116720 re-assert around the subagent TaskGroup — external cancel unwinds the subtree.

Everything drives the REAL registry/session/DB on the shared `run_async` loop (a task created in one
call is awaited in the same call). `_inference.stream_chat` / `_actions.invoke` are stubbed per-test —
no network, real SQLite round-trips. Fixtures are reused from the wave-2 file (one source of truth).
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import uuid
from datetime import timedelta

from _async import run_async
from fastapi.responses import JSONResponse

# Reuse the wave-2 harness (workspace/client/event/handle builders) — one source of truth.
from test_durable_turns_slice3 import (
    _clear_env,
    _client,
    _ev,
    _handle,
    _NoMessages,
    _two_call_assistant,
    _workspace,
)


class _Req:
    """Minimal Request shim: the wave-3 read-only handlers only touch `request.app.state`."""

    def __init__(self, app) -> None:
        self.app = app


def _gated_gen(before, gate: asyncio.Event, after):
    """An event generator that emits `before`, PAUSES on `gate`, then emits `after` — so a test can
    freeze a turn mid-flight, re-attach/probe it, then release it to completion."""

    async def gen():
        for e in before:
            yield e
        await gate.wait()
        for e in after:
            yield e

    return gen()


async def _drive_to_seq(handle, target: int) -> None:
    """Yield to the loop until the drain task has dispatched `target` events (seq == target)."""
    for _ in range(10000):  # generous safety cap — a stalled turn should never hang the suite
        if handle.seq >= target:
            return
        await asyncio.sleep(0)
    raise AssertionError(f"turn never reached seq {target} (stuck at {handle.seq})")


def _seq_of(frame: dict) -> int:
    return int(frame["id"].rsplit(":", 1)[1])


# ── 1: status probe live → terminal → expired ──────────────────────────────────────────────────


def test_status_probe_live_then_terminal_then_expired() -> None:
    from app.api.agent import turn_status
    from app.services.agent.turns import drain_turn, record_terminal, release, reserve

    with _client() as c:
        s = c.app.state
        cfg = s.settings.agent.turns
        out: dict = {}

        async def scenario():
            handle = reserve(s.turns, "th-status", "chat", ring_size=cfg.ring_size)
            gate = asyncio.Event()
            events = _gated_gen(
                [_ev("text.delta", messageId="m", delta="a"), _ev("text.delta", messageId="m", delta="b")],
                gate,
                [_ev("done", threadId="th-status", state="completed")],
            )
            task = asyncio.create_task(drain_turn(handle, events, _NoMessages()))
            handle.task = task

            def _cb(_t):
                record_terminal(s.turn_terminals, handle, linger_s=cfg.linger_s, cap=cfg.terminal_cache_cap)
                release(s.turns, handle)

            task.add_done_callback(_cb)
            await _drive_to_seq(handle, 2)  # two deltas dispatched, turn paused
            out["live"] = await turn_status("th-status", _Req(c.app))
            out["turn_id"] = handle.turn_id
            gate.set()
            await task
            await asyncio.sleep(0)  # let the done-callback (terminal-cache move + release) run
            out["terminal"] = await turn_status("th-status", _Req(c.app))
            # simulate the linger window elapsing (deterministic — no real sleep)
            s.turn_terminals["th-status"].ended_at -= timedelta(seconds=cfg.linger_s + 1)
            out["expired"] = await turn_status("th-status", _Req(c.app))

        run_async(scenario())

        # `steer_queue` (D41) rides every probe branch — empty here (no steers queued).
        assert out["live"] == {
            "active": True,
            "turn_id": out["turn_id"],
            "seq": 2,
            "kind": "chat",
            "started_at": out["live"]["started_at"],  # isoformat present
            "steer_queue": [],
        }
        assert out["terminal"] == {
            "active": False,
            "terminal_status": "completed",
            "turn_id": out["turn_id"],
            "steer_queue": [],
        }
        assert out["expired"] == {"active": False, "steer_queue": []}  # swept out → bare answer
    _clear_env()


# ── 2: re-attach TAIL path ─────────────────────────────────────────────────────────────────────


def test_reattach_tail_replays_from_cursor_then_live_no_dupes() -> None:
    from app.api.agent import turn_stream
    from app.services.agent.turns import drain_turn, release, reserve

    with _client() as c:
        s = c.app.state
        cfg = s.settings.agent.turns
        out: dict = {}

        async def scenario():
            handle = reserve(s.turns, "th-tail", "chat", ring_size=cfg.ring_size)
            gate = asyncio.Event()
            before = [
                _ev("message.start", messageId="m", role="assistant"),
                _ev("text.delta", messageId="m", delta="1"),
                _ev("text.delta", messageId="m", delta="2"),
                _ev("text.delta", messageId="m", delta="3"),
            ]
            after = [
                _ev("text.delta", messageId="m", delta="4"),
                _ev("message.end", messageId="m"),
                _ev("done", threadId="th-tail", state="completed"),
            ]
            task = asyncio.create_task(drain_turn(handle, _gated_gen(before, gate, after), _NoMessages()))
            handle.task = task
            task.add_done_callback(lambda _t: release(s.turns, handle))
            await _drive_to_seq(handle, 4)  # seq 1..4 in the ring, turn paused
            # client last saw seq 2 → tail-replay seq 3,4 then live 5,6,7
            resp = await turn_stream("th-tail", _Req(c.app), cursor=f"{handle.turn_id}:2")
            it = resp.body_iterator
            prefix = [await it.__anext__(), await it.__anext__()]  # the two replayed ring frames
            gate.set()
            rest = [f async for f in it]
            await task
            out["prefix"] = prefix
            out["rest"] = rest

        run_async(scenario())

        prefix_seqs = [_seq_of(f) for f in out["prefix"]]
        rest_seqs = [_seq_of(f) for f in out["rest"]]
        assert prefix_seqs == [3, 4]  # strictly continues from the cursor (seq 2)
        assert [f["event"] for f in out["prefix"]] == ["text.delta", "text.delta"]
        assert rest_seqs == [5, 6, 7]  # live tail, no overlap with the replayed prefix
        all_seqs = prefix_seqs + rest_seqs
        assert all_seqs == sorted(set(all_seqs))  # strictly increasing, no duplicates
        assert out["rest"][-1]["event"] == "done"
    _clear_env()


# ── 3: re-attach SNAPSHOT path ─────────────────────────────────────────────────────────────────


def test_reattach_snapshot_first_frame_then_live() -> None:
    from app.api.agent import turn_stream
    from app.services.agent.turns import drain_turn, release, reserve

    with _client() as c:
        s = c.app.state
        cfg = s.settings.agent.turns
        out: dict = {}

        async def scenario():
            handle = reserve(s.turns, "th-snap", "chat", ring_size=cfg.ring_size)
            handle.mode = "local"  # the snapshot carries it so the client re-pins modeByCall
            gate = asyncio.Event()
            before = [
                _ev("message.start", messageId="m", role="assistant"),
                _ev("text.delta", messageId="m", delta="hel"),
                _ev("text.delta", messageId="m", delta="lo"),
                _ev(
                    "part.added",
                    messageId="m",
                    part={"call_id": "c1", "tool": "ping_host", "args": {"h": "x"}, "state": "pending"},
                ),
            ]
            after = [
                _ev("tool.result", callId="c1", result={"state": "ok"}),
                _ev("done", threadId="th-snap", state="completed"),
            ]
            task = asyncio.create_task(drain_turn(handle, _gated_gen(before, gate, after), _NoMessages()))
            handle.task = task
            task.add_done_callback(lambda _t: release(s.turns, handle))
            await _drive_to_seq(handle, 4)
            # a stale cursor (wrong turn_id) → snapshot, not tail
            resp = await turn_stream("th-snap", _Req(c.app), cursor="deadbeef:2")
            it = resp.body_iterator
            first = await it.__anext__()
            gate.set()
            rest = [f async for f in it]
            await task
            out["first"] = first
            out["rest"] = rest

        run_async(scenario())

        first = out["first"]
        assert first["event"] == "turn.sync"
        snap = json.loads(first["data"])
        assert snap["mode"] == "local"
        assert snap["seq"] == 4
        assert snap["message"]["text"] == "hello"  # joined deltas from the accumulator
        calls = {c["call_id"]: c for c in snap["calls"]}
        assert calls["c1"]["tool"] == "ping_host" and calls["c1"]["args"] == {"h": "x"}
        # then live: the after-events stream, ending on done
        assert [_seq_of(f) for f in out["rest"]] == [5, 6]
        assert out["rest"][-1]["event"] == "done"
    _clear_env()


def test_snapshot_carries_pending_steer_queue_med1() -> None:
    """MED-1 — the `turn.sync` snapshot carries the thread's PENDING steer queue (read live at
    snapshot-build time; DISJOINT from the accumulator's already-drained `steers`), so a re-attaching
    client re-renders queued bubbles instead of the FE's forced reload wiping them."""
    from app.api.agent import turn_stream
    from app.services.agent.steering import SteerEntry, enqueue
    from app.services.agent.turns import drain_turn, release, reserve

    with _client() as c:
        s = c.app.state
        cfg = s.settings.agent.turns
        out: dict = {}

        async def scenario():
            handle = reserve(s.turns, "th-sq", "chat", ring_size=cfg.ring_size)
            gate = asyncio.Event()
            before = [
                _ev("message.start", messageId="m", role="assistant"),
                _ev("text.delta", messageId="m", delta="hi"),
            ]
            after = [_ev("done", threadId="th-sq", state="completed")]
            task = asyncio.create_task(drain_turn(handle, _gated_gen(before, gate, after), _NoMessages()))
            handle.task = task
            task.add_done_callback(lambda _t: release(s.turns, handle))
            await _drive_to_seq(handle, 2)
            # two PENDING steers queued mid-turn (a 202 enqueue) — NOT drained into the accumulator
            enqueue(s, "th-sq", SteerEntry(kind="message", text="steer me"), cfg.steer_queue_max)
            enqueue(s, "th-sq", SteerEntry(kind="exec", text="ls"), cfg.steer_queue_max)
            resp = await turn_stream("th-sq", _Req(c.app), cursor="deadbeef:2")  # stale cursor → snapshot
            it = resp.body_iterator
            out["first"] = await it.__anext__()
            gate.set()
            _rest = [f async for f in it]
            await task

        run_async(scenario())

        first = out["first"]
        assert first["event"] == "turn.sync"
        snap = json.loads(first["data"])
        # the PENDING queue rides the snapshot, ordered, each with an entry_id …
        q = snap["steer_queue"]
        assert [(e["kind"], e["text"]) for e in q] == [("message", "steer me"), ("exec", "ls")]
        assert all(isinstance(e["entry_id"], str) and e["entry_id"] for e in q)
        # … and it is DISJOINT from the drained-steers fold (nothing drained → no `steers` key)
        assert "steers" not in snap
    _clear_env()


# ── 4: non-live stream → JSON ──────────────────────────────────────────────────────────────────


def test_non_live_stream_returns_json_active_false() -> None:
    from app.api.agent import turn_stream
    from app.services.agent.turns import TerminalRecord

    with _client() as c:
        s = c.app.state

        async def scenario():
            r_unknown = await turn_stream("nobody", _Req(c.app), cursor=None)
            s.turn_terminals["th-done"] = TerminalRecord(turn_id="tid-done", terminal_status="cancelled")
            r_lingering = await turn_stream("th-done", _Req(c.app), cursor=None)
            return r_unknown, r_lingering

        r_unknown, r_lingering = run_async(scenario())

        assert isinstance(r_unknown, JSONResponse)
        assert json.loads(r_unknown.body) == {"active": False, "terminal_status": None, "turn_id": None}
        assert json.loads(r_lingering.body) == {
            "active": False,
            "terminal_status": "cancelled",
            "turn_id": "tid-done",
        }
    _clear_env()


# ── 5: cancel endpoint mid-turn (reconcile + idempotent) ───────────────────────────────────────


def test_cancel_endpoint_mid_turn_reconciles_marks_stale_and_is_idempotent() -> None:
    from app.api.agent import cancel_turn_endpoint
    from app.domain.enums import RunState
    from app.domain.result import ToolResult
    from app.services.action_service import InvokeOutcome
    from app.services.agent.turns import drain_turn, record_terminal, release, reserve

    with _client() as c:
        s = c.app.state
        cfg = s.settings.agent.turns
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
        out: dict = {}

        async def scenario():
            handle = reserve(s.turns, thread.id, "chat", ring_size=cfg.ring_size)
            events = session._drive(thread, resume_assistant=assistant)
            task = asyncio.create_task(drain_turn(handle, events, s.messages))
            handle.task = task

            def _cb(_t):
                record_terminal(s.turn_terminals, handle, linger_s=cfg.linger_s, cap=cfg.terminal_cache_cap)
                release(s.turns, handle)

            task.add_done_callback(_cb)
            await entered_two.wait()
            out["cancel"] = await cancel_turn_endpoint(thread.id, _Req(c.app))
            await asyncio.sleep(0)  # let the done-callback run (marker release)
            out["released"] = s.turns == {}
            out["repeat"] = await cancel_turn_endpoint(thread.id, _Req(c.app))  # idle now

        run_async(scenario())

        # D41: the cancel response now carries the harvested steer queue (empty here — no steers).
        assert out["cancel"] == {"cancelled": True, "terminal_status": "cancelled", "steer_queue": []}
        assert out["released"] is True
        assert out["repeat"] == {"cancelled": False, "active": False, "steer_queue": []}

        # the REAL persisted thread: call_one survived (shielded finally); call_two → CANCELLED
        msgs = run_async(s.messages.list(thread.id))
        by_id = {cp.call_id: cp for m in msgs if m.role == "assistant" for cp in m.tool_calls()}
        assert by_id[cid1].state == RunState.OK
        assert by_id[cid2].state == RunState.CANCELLED
    _clear_env()


def test_cancel_idle_thread_returns_active_false() -> None:
    from app.api.agent import cancel_turn_endpoint

    with _client() as c:
        r = run_async(cancel_turn_endpoint("never-existed", _Req(c.app)))
        assert r == {"cancelled": False, "active": False, "steer_queue": []}  # D41 harvest carry
    _clear_env()


def test_double_cancel_fires_exactly_one_raw_task_cancel() -> None:
    from app.services.agent.turns import cancel_turn

    out: dict = {}

    async def scenario():
        handle = _handle()
        task = asyncio.ensure_future(asyncio.sleep(3600))
        handle.task = task
        out["first"] = cancel_turn(handle)
        out["after_first"] = task.cancelling()  # exactly one raw cancel delivered
        out["second"] = cancel_turn(handle)  # latched → no second task.cancel()
        out["after_second"] = task.cancelling()
        with contextlib.suppress(asyncio.CancelledError):
            await task

    run_async(scenario())

    assert out["first"] is True and out["second"] is False
    # a second raw task.cancel() would bump cancelling() to 2 (and pierce the persistence shield)
    assert out["after_first"] == 1 and out["after_second"] == 1


# ── 6: shutdown drain (manual lifespan on the test loop) ───────────────────────────────────────


def test_shutdown_drain_persists_live_turn_and_logs_no_leak(caplog) -> None:
    import logging

    from app.db import Database
    from app.domain.conversation import Message, Thread, ToolCallPart
    from app.domain.enums import Actor, RunState
    from app.domain.result import ToolResult
    from app.main import create_app, lifespan
    from app.services.action_service import InvokeOutcome
    from app.services.agent.session import AgentSession
    from app.services.agent.turns import drain_turn, release, reserve
    from app.services.conversation import MessageRepo

    _workspace()
    caplog.set_level(logging.WARNING)
    out: dict = {}

    async def scenario():
        app = create_app()
        async with lifespan(app):
            s = app.state
            cfg = s.settings.agent.turns
            agent = s.settings.resolve_agent(None)
            session = AgentSession(
                s.threads, s.messages, s.inference, s.settings, s.actions, agent, interactive=True
            )
            thread = await s.threads.create(Thread())
            cid1, cid2 = uuid.uuid4().hex, uuid.uuid4().hex
            assistant = Message(
                thread_id=thread.id,
                role="assistant",
                actor=Actor.AGENT,
                agent="default",
                parts=[
                    ToolCallPart(call_id=cid1, tool="call_one", args={}, state=RunState.PENDING),
                    ToolCallPart(call_id=cid2, tool="call_two", args={}, state=RunState.PENDING),
                ],
            )
            await s.messages.add(assistant)
            entered_two = asyncio.Event()

            async def fake_invoke(tool, args, **kw):
                if tool == "call_one":
                    return InvokeOutcome(
                        needs_confirm=False,
                        result=ToolResult(state=RunState.OK, summary="one", output="one"),
                    )
                entered_two.set()
                await asyncio.sleep(3600)
                raise AssertionError("unreachable")

            session._actions.invoke = fake_invoke
            handle = reserve(s.turns, thread.id, "chat", ring_size=cfg.ring_size)
            events = session._drive(thread, resume_assistant=assistant)
            task = asyncio.create_task(drain_turn(handle, events, s.messages))
            handle.task = task
            task.add_done_callback(lambda _t: release(s.turns, handle))
            await entered_two.wait()  # turn is live + detached; exit → lifespan finally drains it
            out["thread_id"] = thread.id
            out["cid1"], out["cid2"] = cid1, cid2
            out["task"] = task

        # after the `async with`: the shutdown drain cancelled + awaited the turn, then closed the DB.
        out["task_done"] = out["task"].done()
        db2 = Database()  # reopen the same CTRLB_DB file to read what the shielded finally persisted
        await db2.connect()
        try:
            out["msgs"] = await MessageRepo(db2).list(out["thread_id"])
        finally:
            await db2.close()

    run_async(scenario())

    assert out["task_done"] is True
    by_id = {cp.call_id: cp for m in out["msgs"] if m.role == "assistant" for cp in m.tool_calls()}
    assert by_id[out["cid1"]].state == RunState.OK  # shielded persist of the completed call landed
    assert by_id[out["cid2"]].state == RunState.CANCELLED  # reconciled inside the drained cancel path
    assert "did not drain" not in caplog.text  # the turn drained within the grace budget
    _clear_env()


# ── 7: CPython #116720 — external cancel unwinds the subagent TaskGroup subtree ─────────────────


def test_subagent_taskgroup_propagates_external_cancel() -> None:
    """Cancelling the enclosing task while a subagent batch runs unwinds the whole TaskGroup subtree
    and CancelledError propagates out — i.e. the #116720 re-assert never SUPPRESSES a real cancel and
    the normal-propagation path (where the group re-raises CancelledError itself) is intact.

    What this can PROVE: a live external cancel cancels every child and surfaces as CancelledError.
    What it can NOT deterministically prove: the exact race #116720 patches — a child ERROR arriving
    at the same instant as the external cancel during `__aexit__`, so the group's propagation logic
    (`raise … and not self._errors`) SWALLOWS the cancel and its `uncancel()` bookkeeping clears it.
    That timing is not scriptable from userland; the `cancelling() > 0` re-assert is the documented
    remedy (CPython #116720 + the asyncio Task.uncancel docs) for exactly that swallowed case."""
    import app.services.agent.subagents as sub
    from app.services.agent.subagents import ParallelOrchestrator

    out: dict = {}

    async def scenario():
        started = asyncio.Event()
        cancelled = {"n": 0}

        async def fake_run_subagent(deps, cdef, task, *, index, depth, timeout_s):
            started.set()
            try:
                await asyncio.sleep(3600)
            except asyncio.CancelledError:
                cancelled["n"] += 1
                raise
            return None  # pragma: no cover

        orig = sub.run_subagent
        sub.run_subagent = fake_run_subagent
        try:
            orch = ParallelOrchestrator(per_agent=4, global_sem=None, child_timeout_s=30)
            children = [(object(), "t1"), (object(), "t2")]

            async def run():
                return await orch.run_many(None, children, depth=1)

            task = asyncio.create_task(run())
            await started.wait()
            task.cancel()
            try:
                await task
                out["raised"] = False
            except asyncio.CancelledError:
                out["raised"] = True
            out["cancelled_children"] = cancelled["n"]
        finally:
            sub.run_subagent = orig

    run_async(scenario())

    assert out["raised"] is True  # the subtree cancellation propagated out (not swallowed)
    assert out["cancelled_children"] == 2  # both children were cancelled + unwound


# ── 8: done-but-unreleased window — status/stream report terminal, never live (review item 3) ─────


def test_status_and_stream_treat_done_but_unreleased_as_terminal() -> None:
    """A handle whose drain task finished (`terminal_status` set + sentinel pushed) but whose
    `_cleanup` done-callback hasn't run yet — still in `state.turns`, not yet in the terminal cache —
    must be reported NOT live by BOTH the probe and the re-attach stream. Otherwise a re-attach in
    that one-tick window attaches a fresh queue that never receives TERMINAL → wedged SSE + leaked
    subscriber. The window is reproduced deterministically by driving the drain to completion WITHOUT
    registering the cleanup callback: the handle lingers in the registry, terminal_status set, cache
    empty — exactly the state between the terminal sentinel and the `call_soon` done-callback."""
    from app.api.agent import turn_status, turn_stream
    from app.services.agent.turns import drain_turn, reserve

    with _client() as c:
        s = c.app.state
        cfg = s.settings.agent.turns
        out: dict = {}

        async def scenario():
            handle = reserve(s.turns, "th-window", "chat", ring_size=cfg.ring_size)

            async def gen():
                yield _ev("text.delta", messageId="m", delta="a")
                yield _ev("done", threadId="th-window", state="completed")

            task = asyncio.create_task(drain_turn(handle, gen(), _NoMessages()))
            handle.task = task
            # NO done-callback registered → after the task finishes the handle stays in state.turns
            # with terminal_status set and the terminal cache empty (the done-but-unreleased window).
            await task
            out["turn_id"] = handle.turn_id
            out["still_registered"] = s.turns.get("th-window") is handle
            out["terminal_status"] = handle.terminal_status
            out["cache_empty"] = "th-window" not in s.turn_terminals
            out["probe"] = await turn_status("th-window", _Req(c.app))
            out["stream"] = await turn_stream("th-window", _Req(c.app), cursor=None)

        run_async(scenario())

        assert out["still_registered"] is True  # not released yet
        assert out["terminal_status"] == "completed"
        assert out["cache_empty"] is True  # record_terminal hasn't run
        assert out["probe"] == {
            "active": False,  # NOT live despite being in state.turns
            "terminal_status": "completed",
            "turn_id": out["turn_id"],
            "steer_queue": [],  # D41 carry (empty)
        }
        # the re-attach returns the JSON terminal shape (not an SSE stream) → the client reloads
        assert isinstance(out["stream"], JSONResponse)
        assert json.loads(out["stream"].body) == {
            "active": False,
            "terminal_status": "completed",
            "turn_id": out["turn_id"],
        }
    _clear_env()


# ── 9: continuity guard — a force_put eviction gap stops the consumer before `done` (review item 8) ─


def test_stream_live_breaks_on_force_put_eviction_gap_without_done() -> None:
    """`turns._push_terminal`→`_force_put` evicts the OLDEST real event from an exactly-full but
    still-connected subscriber queue. `_stream_live`'s continuity guard must detect the resulting seq
    gap and BREAK before yielding the post-gap `done`, so the consumer never settles a damaged stream
    (a permanent text gap) — the client recovers via re-attach/reload (items 3+7) instead."""
    from app.api.agent import _stream_live
    from app.services.agent.turns import _push_terminal, make_subscriber

    out: dict = {}

    async def scenario():
        handle = _handle()
        q = make_subscriber(handle, 2)  # maxsize 2
        gen = _stream_live(handle, q)
        # Baseline: the consumer reads seq 1 → its internal `expected` is now 2.
        q.put_nowait((1, _ev("text.delta", messageId="m", delta="a")))
        out["first"] = await gen.__anext__()
        # Fill the queue full ([2, 3]) then force the terminal sentinel in: `_force_put` evicts the
        # OLDEST real event (seq 2), leaving [seq3=done, TERMINAL] — a seq gap past the baseline.
        q.put_nowait((2, _ev("text.delta", messageId="m", delta="b")))
        q.put_nowait((3, _ev("done", threadId="t1", state="completed")))
        _push_terminal(handle)
        out["rest"] = [f async for f in gen]  # resumes: reads (3,done) → 3 > expected 2 → BREAK
        out["detached"] = q not in handle.subscribers  # the finally ran

    run_async(scenario())

    assert _seq_of(out["first"]) == 1
    assert out["rest"] == []  # broke on the gap → NO further frames, and crucially no `done`
    assert all(f["event"] != "done" for f in [out["first"], *out["rest"]])
    assert out["detached"] is True  # subscriber detached on break (no leak)


# ── 10: sync-kind marker is not live for probe/stream (review item 4) ──────────────────────────


def test_sync_kind_marker_is_not_live_for_probe_or_stream() -> None:
    """A SYNC-kind marker (exec/plan/apply/compact) holds the per-thread marker but spawns NO drain
    task (task=None, terminal_status stays None forever). Both the status probe and the re-attach
    stream must treat it as NOT live — otherwise the live checks pass and a re-attach subscriber waits
    forever on a queue nothing ever dispatches to (review MED-4). The fallthrough JSON/terminal path
    handles it: active:false, the handle's (null) terminal_status + its turn_id."""
    from app.api.agent import turn_status, turn_stream
    from app.services.agent.turns import reserve

    with _client() as c:
        s = c.app.state

        async def scenario():
            handle = reserve(s.turns, "th-plan", "plan", ring_size=8)  # sync kind → no task spawned
            probe = await turn_status("th-plan", _Req(c.app))
            stream = await turn_stream("th-plan", _Req(c.app), cursor=None)
            return handle, probe, stream

        handle, probe, stream = run_async(scenario())
        assert handle.task is None
        assert probe["active"] is False  # reserved but no live task → inactive
        assert isinstance(stream, JSONResponse)  # JSON terminal answer, not an SSE stream
        body = json.loads(stream.body)
        assert body["active"] is False
        assert body["turn_id"] == handle.turn_id  # falls back to the handle's fields
        assert body["terminal_status"] is None
    _clear_env()


# ── 11: continuity guard — a LEADING-edge eviction also breaks the consumer (review item 5) ──────


def test_stream_live_breaks_on_leading_edge_eviction() -> None:
    """`_stream_live` seeds `expected` to `after_seq + 1`, not the first RECEIVED pair — so an eviction
    of the queue's very FIRST event (the leading-edge gap: e.g. message.start evicted, later events
    retained) also trips the continuity guard. Otherwise the consumer would baseline AFTER the gap and
    settle a stream the reducer can't attach the parts to (review MED-5)."""
    from app.api.agent import _stream_live
    from app.services.agent.turns import make_subscriber

    out: dict = {}

    async def scenario():
        handle = _handle()
        q = make_subscriber(handle, 4)
        gen = _stream_live(handle, q)  # fresh stream: after_seq defaults to 0 → expected seeds to 1
        # seq 1 was evicted before we read; the queue's first item is seq 2, then done at seq 3.
        q.put_nowait((2, _ev("text.delta", messageId="m", delta="b")))
        q.put_nowait((3, _ev("done", threadId="t1", state="completed")))
        out["frames"] = [f async for f in gen]  # first item seq 2 > expected 1 → BREAK, no yield
        out["detached"] = q not in handle.subscribers

    run_async(scenario())
    assert out["frames"] == []  # leading-edge gap → nothing yielded, and crucially no `done`
    assert out["detached"] is True  # subscriber detached on break (no leak)


if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    for fn in fns:
        try:
            fn()
        except TypeError:  # caplog-taking tests need pytest — skip in the bare runner
            print(f"skip {fn.__name__} (needs a pytest fixture)")
            continue
        print(f"ok  {fn.__name__}")
    print(f"\n{len(fns)} tests")
