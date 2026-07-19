"""ACA Slice 5 wave 1 — the steer queue core + enqueue (D41).

Wave 1 upgrades the D38 per-thread busy 409 to a 202 ENQUEUE when the live holder is a chat/resume
turn: a mid-turn message or `!exec` is captured as a UNIFIED `SteerEntry` on the thread-id-keyed
`app.state.steer_queues` (NOT on the live-only handle, NOT busy-state). This file proves the queue
core, the enqueue-vs-409 matrix, the enqueue atomicity code-shape, the DELETE dequeue, the probe's
`steer_queue` carry, and the queue-is-not-busy-state arch invariant. Drains (points A/B) are waves
2–3 and are NOT exercised here.

Reuses the Slice-3 TestClient harness (one source of truth): `_client` boots the REAL app against a
temp workspace; `reserve()` plants a live holder to make a thread "busy"; `_patch_session` stubs the
session so a NORMAL start needs no LLM.
"""

from __future__ import annotations

import inspect

# Reuse the wave-3 harness + the D38 tripwire's code-only source stripper (one source of truth).
from test_durable_turns_slice3 import (
    _clear_env,
    _client,
    _completed_events,
    _patch_session,
    _restore_session,
)
from test_turn_guard_invariant import _code_only

import app.api.agent as agent_api
from app.services.agent.steering import (
    SteerEntry,
    SteerQueue,
    SteerQueueFull,
    enqueue,
)
from app.services.agent.turns import active_task_turns, reserve

_EXEC_ON = "server:\n  port: 5433\nshell:\n  user_exec_enabled: true\n"


# ── unit: the SteerQueue helpers ───────────────────────────────────────────────────────────────


def test_steerqueue_append_peek_remove_commit_popall() -> None:
    q = SteerQueue()
    a = SteerEntry(kind="message", text="a")
    b = SteerEntry(kind="exec", text="ls")
    assert q.append(a) == 1  # 1-based position == new depth
    assert q.append(b) == 2
    assert [e.text for e in q.peek()] == ["a", "ls"]  # FIFO order preserved
    assert q.remove(a.entry_id) is True
    assert q.remove("nope") is False
    assert [e.entry_id for e in q.peek()] == [b.entry_id]
    # commit-by-count pops from the FRONT; commit-by-ids removes exactly those.
    q.append(SteerEntry(kind="message", text="c"))
    q.commit(1)
    assert [e.text for e in q.peek()] == ["c"]
    q.append(SteerEntry(kind="message", text="d"))
    ids = [e.entry_id for e in q.peek()]
    q.commit(ids)
    assert q.peek() == []
    # pop_all drains + empties.
    q.append(SteerEntry(kind="message", text="e"))
    drained = q.pop_all()
    assert [e.text for e in drained] == ["e"]
    assert len(q) == 0


def test_enqueue_creates_on_first_use_and_caps() -> None:
    class _S:
        steer_queues: dict[str, SteerQueue] = {}

    state = _S()
    state.steer_queues = {}
    assert enqueue(state, "t1", SteerEntry(kind="message", text="1"), cap=2) == 1
    assert enqueue(state, "t1", SteerEntry(kind="message", text="2"), cap=2) == 2
    try:
        enqueue(state, "t1", SteerEntry(kind="message", text="3"), cap=2)
        raise AssertionError("expected SteerQueueFull")
    except SteerQueueFull as e:
        assert e.thread_id == "t1" and e.cap == 2


# ── the enqueue-vs-409 matrix (holder-kind keyed) ──────────────────────────────────────────────


def _busy_thread(c, kind: str):
    """Create a REAL thread + plant a live `kind` holder on it; return its id."""
    tid = c.post("/api/threads").json()["id"]
    reserve(c.app.state.turns, tid, kind)
    return tid


def test_chat_during_live_chat_turn_enqueues_202() -> None:
    try:
        with _client() as c:
            tid = _busy_thread(c, "chat")
            r = c.post(
                "/api/agent/chat",
                json={
                    "text": "steer me",
                    "thread_id": tid,
                    "mode": "cloud",
                    "agent": "researcher",
                    "privilege": "full",
                    "skills": ["ping"],
                },
            )
            assert r.status_code == 202
            body = r.json()
            assert body["queued"] is True
            assert body["position"] == 1 and body["depth"] == 1
            assert body["entry_id"] and body["turn_id"]
            # SteerEntry captured the request params (unified object).
            e = c.app.state.steer_queues[tid].peek()[0]
            assert e.kind == "message" and e.text == "steer me"
            assert e.mode == "cloud" and e.agent == "researcher"
            assert e.privilege == "full" and e.skills == ["ping"]
            assert e.entry_id == body["entry_id"]
    finally:
        _clear_env()


def test_exec_during_live_chat_turn_enqueues_202() -> None:
    try:
        with _client(_EXEC_ON) as c:
            tid = _busy_thread(c, "chat")
            r = c.post("/api/exec", json={"command": "uptime", "thread_id": tid})
            assert r.status_code == 202
            body = r.json()
            assert body["queued"] is True and body["depth"] == 1
            e = c.app.state.steer_queues[tid].peek()[0]
            assert e.kind == "exec" and e.text == "uptime"
            assert e.mode is None and e.skills is None  # exec carries no params
    finally:
        _clear_env()


def test_chat_during_live_sync_holder_409s_never_enqueues() -> None:
    try:
        with _client() as c:
            tid = _busy_thread(c, "compact")  # a SYNC holder — steering behind it is incoherent
            r = c.post("/api/agent/chat", json={"text": "x", "thread_id": tid})
            assert r.status_code == 409
            assert "already running" in r.json()["detail"]
            assert tid not in c.app.state.steer_queues  # nothing queued
    finally:
        _clear_env()


def test_resume_during_live_turn_409s_never_enqueues() -> None:
    try:
        with _client() as c:
            tid = _busy_thread(c, "chat")
            r = c.post(
                "/api/agent/resume",
                json={"thread_id": tid, "call_id": "c1", "decision": "dismiss"},
            )
            assert r.status_code == 409  # resume never enqueues — you can't queue a resume
            assert tid not in c.app.state.steer_queues
    finally:
        _clear_env()


def test_cap_overflow_returns_the_busy_409_verbatim() -> None:
    cfg = "server:\n  port: 5433\nagent:\n  turns:\n    steer_queue_max: 1\n"
    try:
        with _client(cfg) as c:
            tid = _busy_thread(c, "chat")
            r1 = c.post("/api/agent/chat", json={"text": "one", "thread_id": tid})
            assert r1.status_code == 202
            r2 = c.post("/api/agent/chat", json={"text": "two", "thread_id": tid})
            assert r2.status_code == 409
            assert "already running" in r2.json()["detail"]  # the busy detail verbatim
            assert len(c.app.state.steer_queues[tid]) == 1  # the overflow was refused, not stored
    finally:
        _clear_env()


def test_no_live_turn_starts_normally_and_queues_nothing() -> None:
    try:
        with _client() as c:
            tid = c.post("/api/threads").json()["id"]
            orig = _patch_session(_completed_events())
            try:
                r = c.post("/api/agent/chat", json={"text": "hi", "thread_id": tid, "stream": False})
            finally:
                _restore_session(orig)
            assert r.status_code == 200
            assert tid not in c.app.state.steer_queues  # a fresh start never touches the queue
            assert c.app.state.turns == {}
    finally:
        _clear_env()


# ── enqueue atomicity (the code-shape pin — mirrors the D38 turn-guard tripwire) ────────────────


def _catch_to_append_region(fn) -> str:
    """The handler source between `except TurnBusy` and the steer append (`_steer_202(`), with
    comments/strings blanked (the D38 tripwire's `_code_only`) so a marker in prose can't hide a real
    `await`. If either anchor is missing the endpoint isn't wired for steering → fail loud."""
    src = _code_only(inspect.getsource(fn))
    start = src.index("except TurnBusy")
    tail = src[start:]
    return tail[: tail.index("_steer_202(")]


def test_enqueue_is_synchronous_atomic_no_await_between_catch_and_append() -> None:
    for fn in (agent_api.chat, agent_api.exec_shell):
        region = _catch_to_append_region(fn)
        assert "await" not in region, (
            f"{fn.__name__}: an `await` sits between the TurnBusy catch and the steer append — "
            "the D38 TOCTOU discipline requires the catch→append block be synchronous-atomic"
        )


# ── DELETE .../steer/{entry_id} — present / absent ─────────────────────────────────────────────


def test_delete_steer_present_then_absent() -> None:
    try:
        with _client() as c:
            tid = _busy_thread(c, "chat")
            eid = c.post("/api/agent/chat", json={"text": "x", "thread_id": tid}).json()["entry_id"]
            r1 = c.delete(f"/api/agent/turns/{tid}/steer/{eid}")
            assert r1.status_code == 200 and r1.json() == {"removed": True}
            assert len(c.app.state.steer_queues[tid]) == 0
            # A second DELETE (already gone) → graceful 200, not 404.
            r2 = c.delete(f"/api/agent/turns/{tid}/steer/{eid}")
            assert r2.status_code == 200
            assert r2.json() == {"removed": False, "reason": "already sent"}
            # Unknown thread → same graceful shape.
            r3 = c.delete("/api/agent/turns/nope/steer/nope")
            assert r3.status_code == 200 and r3.json()["removed"] is False
    finally:
        _clear_env()


# ── the status probe carries steer_queue ───────────────────────────────────────────────────────


def test_probe_carries_steer_queue_ordered_and_empty_when_none() -> None:
    try:
        with _client() as c:
            # empty when no queue
            tid_empty = c.post("/api/threads").json()["id"]
            assert c.get(f"/api/agent/turns/{tid_empty}").json()["steer_queue"] == []
            # a live chat holder + two queued steers → ordered [{entry_id, kind, text}]
            tid = _busy_thread(c, "chat")
            c.post("/api/agent/chat", json={"text": "first", "thread_id": tid})
            c.post("/api/exec", json={"command": "ls", "thread_id": tid})  # 403 (exec off) — no enqueue
            c.post("/api/agent/chat", json={"text": "second", "thread_id": tid})
            probe = c.get(f"/api/agent/turns/{tid}").json()
            sq = probe["steer_queue"]
            assert [(e["kind"], e["text"]) for e in sq] == [("message", "first"), ("message", "second")]
            assert all(set(e) == {"entry_id", "kind", "text"} for e in sq)
    finally:
        _clear_env()


# ── arch pin: the queue is NOT busy-state ──────────────────────────────────────────────────────


def test_queued_entries_are_not_busy_state() -> None:
    """With entries queued but NO live turn, `not app.state.turns` stays truthful, the
    `max_active_turns` gauge is unaffected, and a fresh chat POST starts normally (not steered)."""
    try:
        with _client() as c:
            tid = c.post("/api/threads").json()["id"]
            q = SteerQueue()
            q.append(SteerEntry(kind="message", text="orphan steer"))
            c.app.state.steer_queues[tid] = q
            assert not c.app.state.turns  # the queue is NOT a busy signal
            assert active_task_turns(c.app.state.turns) == 0
            # Drop the orphan before the fresh turn: the busy-truth property above is already proven
            # with it present, and the fake `run_turn` bypasses `_drive` so it would NOT drain the
            # orphan mid-turn — leaving it to (correctly) trigger Drain B at completion (D41 wave 3,
            # covered in test_steer_drain_b_d41). This test only checks the fresh turn releases cleanly.
            c.app.state.steer_queues.pop(tid, None)
            orig = _patch_session(_completed_events())
            try:
                r = c.post("/api/agent/chat", json={"text": "go", "thread_id": tid, "stream": False})
            finally:
                _restore_session(orig)
            assert r.status_code == 200  # started normally, NOT a 202 steer
            assert c.app.state.turns == {}  # released after the turn
    finally:
        _clear_env()
