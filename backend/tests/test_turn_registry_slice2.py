"""ACA Slice 2 — per-thread turn-marker registry (D38, AGENT_CHAT_AUDIT §5 v2.4).

Two layers:
  1. Unit tests on `app.services.agent.turns` — reserve/release semantics, the TOCTOU-safe
     check-and-set, and the stale-release identity guard.
  2. Endpoint tests — every thread-mutating route (chat/resume/plan/apply/compact/exec) 409s while a
     marker is held on its thread; the marker is released when a turn completes (SSE + buffered) or a
     handler raises; and the busy-truth switch (auto-rediscover gate + manual rediscover endpoint)
     now reads `app.state.turns`.

The endpoint tests reuse the D17 pattern: `_fake_session` spies on `api.agent._session` to feed a
scripted event stream (no LLM). Collisions are set up by reserving a marker directly on
`app.state.turns` (stands in for a concurrently-live turn — TestClient is synchronous). All on a temp
`$CTRLB_HOME`.
"""

from __future__ import annotations

import contextlib
import os
import tempfile
from pathlib import Path

# ── 1: turns module unit tests ─────────────────────────────────────────────────────────────────


def test_reserve_inserts_and_returns_handle() -> None:
    from app.services.agent.turns import TurnHandle, reserve

    turns: dict[str, TurnHandle] = {}
    h = reserve(turns, "t1", "chat")
    assert h.thread_id == "t1" and h.kind == "chat"
    assert len(h.turn_id) == 32  # uuid4 hex
    assert turns == {"t1": h}


def test_reserve_busy_same_thread_raises_carrying_existing() -> None:
    from app.services.agent.turns import TurnBusy, TurnHandle, reserve

    turns: dict[str, TurnHandle] = {}
    first = reserve(turns, "t1", "chat")
    try:
        reserve(turns, "t1", "plan")
        raise AssertionError("expected TurnBusy")
    except TurnBusy as e:
        assert e.handle is first  # carries the live handle
    assert turns["t1"] is first  # unchanged


def test_reserve_different_threads_coexist() -> None:
    from app.services.agent.turns import TurnHandle, reserve

    turns: dict[str, TurnHandle] = {}
    a = reserve(turns, "t1", "chat")
    b = reserve(turns, "t2", "resume")
    assert turns == {"t1": a, "t2": b}


def test_release_removes_matching_handle() -> None:
    from app.services.agent.turns import TurnHandle, release, reserve

    turns: dict[str, TurnHandle] = {}
    h = reserve(turns, "t1", "chat")
    release(turns, h)
    assert turns == {}
    release(turns, h)  # idempotent — releasing again is a no-op


def test_release_is_identity_guarded_stale_release_noop() -> None:
    # A stale handle (an old turn that already yielded ownership) must NOT evict a newer turn's
    # marker on the same thread.
    from app.services.agent.turns import TurnHandle, release, reserve

    turns: dict[str, TurnHandle] = {}
    old = reserve(turns, "t1", "chat")
    release(turns, old)  # old turn ends
    new = reserve(turns, "t1", "chat")  # a fresh turn claims the thread
    assert new.turn_id != old.turn_id
    release(turns, old)  # the stale release fires late
    assert turns == {"t1": new}  # newer marker survives


# ── 2: endpoint fixtures (mirrors test_dual_mode_d17) ──────────────────────────────────────────


def _client(config_text: str = "server:\n  port: 5433\n"):
    from fastapi.testclient import TestClient

    from app.main import create_app

    tmp = Path(tempfile.mkdtemp())
    cfg = tmp / "config.yaml"
    cfg.write_text(config_text, encoding="utf-8")
    os.environ["CTRLB_HOME"] = str(tmp)
    os.environ["CTRLB_CONFIG"] = str(cfg)
    os.environ["CTRLB_DB"] = str(tmp / "t.db")
    return TestClient(create_app())


@contextlib.contextmanager
def _env_cleanup():
    try:
        yield
    finally:
        for k in ("CTRLB_HOME", "CTRLB_CONFIG", "CTRLB_DB"):
            os.environ.pop(k, None)


def _ev(event: str, **data):
    from app.services.agent.session import AgentEvent

    return AgentEvent(event, data)


def _completed_events():
    return [
        _ev("message.start", messageId="m-x", role="assistant"),
        _ev("text.delta", messageId="m-x", delta="hello"),
        _ev("message.end", messageId="m-x"),
        _ev("done", threadId="t", state="completed"),
    ]


class _FakeSession:
    """Scripted stream for both run_turn and resume. If given `snapshots`/`turns_ref`, it records the
    live turn-registry contents at each yield — so a test can assert a marker is held mid-turn."""

    def __init__(self, events, snapshots=None, turns_ref=None, raise_after=False):
        self._events = events
        self._snapshots = snapshots
        self._turns_ref = turns_ref
        self._raise_after = raise_after

    async def _drive(self):
        for e in self._events:
            if self._snapshots is not None and self._turns_ref is not None:
                self._snapshots.append(dict(self._turns_ref()))
            yield e
        if self._raise_after:
            raise RuntimeError("boom mid-turn")

    async def run_turn(self, *a, **k):
        async for e in self._drive():
            yield e

    async def resume(self, *a, **k):
        async for e in self._drive():
            yield e


@contextlib.contextmanager
def _fake_session(events, **kw):
    import app.api.agent as agent_api

    orig = agent_api._session
    agent_api._session = lambda *a, **k: _FakeSession(events, **kw)
    try:
        yield
    finally:
        agent_api._session = orig


def _new_thread(c) -> str:
    return c.post("/api/threads").json()["id"]


# ── 2a: chat × chat ────────────────────────────────────────────────────────────────────────────


def test_chat_same_thread_second_steers_202() -> None:
    # D41 (Slice 5): a second chat during a LIVE chat/resume turn no longer 409s — it STEERS (202,
    # enqueued on `steer_queues`). The D38 409 survives only for sync holders / cap / overflow
    # (covered in test_steering_queue_d41.py). This asserts the upgraded busy contract.
    from app.services.agent.turns import reserve

    with _env_cleanup(), _client() as c:
        tid = _new_thread(c)
        reserve(c.app.state.turns, tid, "chat")  # a turn is already live on this thread
        r = c.post("/api/agent/chat", json={"text": "hi", "thread_id": tid, "stream": False})
        assert r.status_code == 202
        assert r.json()["queued"] is True
        assert len(c.app.state.steer_queues[tid]) == 1


def test_chat_different_threads_both_accepted() -> None:
    with _env_cleanup(), _client() as c:
        t1, t2 = _new_thread(c), _new_thread(c)
        with _fake_session(_completed_events()):
            r1 = c.post("/api/agent/chat", json={"text": "hi", "thread_id": t1, "stream": False})
        with _fake_session(_completed_events()):
            r2 = c.post("/api/agent/chat", json={"text": "hi", "thread_id": t2, "stream": False})
        assert r1.status_code == 200 and r2.status_code == 200
        assert c.app.state.turns == {}  # both released


# ── 2b: chat-while-live blocks every other thread-mutating route ───────────────────────────────


def test_live_turn_blocks_plan_apply_compact_and_steers_exec() -> None:
    from app.services.agent.turns import reserve

    # exec needs the `!` gate open to reach the reserve (the 403 check precedes it).
    with _env_cleanup(), _client("server:\n  port: 5433\nshell:\n  user_exec_enabled: true\n") as c:
        tid = _new_thread(c)
        reserve(c.app.state.turns, tid, "chat")  # a live turn holds the marker

        # The STRUCTURAL ops still 409 during a live turn (they never enqueue — D41).
        assert c.post("/api/agent/plan", json={"thread_id": tid, "steps": []}).status_code == 409
        assert (
            c.post(
                "/api/agent/apply", json={"thread_id": tid, "call_id": "x", "decision": "dismiss"}
            ).status_code
            == 409
        )
        assert c.post("/api/agent/compact", json={"thread_id": tid}).status_code == 409
        # exec is STEERABLE (D41): a `!cmd` during a live chat/resume turn enqueues (202), not 409.
        assert c.post("/api/exec", json={"thread_id": tid, "command": "echo hi"}).status_code == 202
        # the collision doesn't disturb the held marker
        assert set(c.app.state.turns) == {tid}


# ── 2c: resume holds a marker of kind "resume" and releases it ─────────────────────────────────


def test_resume_holds_resume_marker_then_releases() -> None:
    with _env_cleanup(), _client() as c:
        tid = _new_thread(c)
        snaps: list[dict] = []
        with _fake_session(_completed_events(), snapshots=snaps, turns_ref=lambda: c.app.state.turns):
            r = c.post(
                "/api/agent/resume",
                json={"thread_id": tid, "call_id": "c1", "decision": "dismiss", "stream": False},
            )
        assert r.status_code == 200
        # mid-turn the thread held a "resume" marker …
        assert snaps and snaps[0][tid].kind == "resume"
        # … and it's gone once the turn completed (buffered path releases in _counted's finally).
        assert c.app.state.turns == {}


# ── 2d: release on completion (both transports) + on error ─────────────────────────────────────


def test_marker_released_after_completed_turn_sse_and_buffered() -> None:
    with _env_cleanup(), _client() as c:
        # buffered
        tb = _new_thread(c)
        with _fake_session(_completed_events()):
            c.post("/api/agent/chat", json={"text": "hi", "thread_id": tb, "stream": False})
        assert c.app.state.turns == {}
        # SSE — draining r.text consumes the generator to completion, firing _counted's finally
        ts = _new_thread(c)
        with _fake_session(_completed_events()):
            r = c.post("/api/agent/chat", json={"text": "hi", "thread_id": ts, "stream": True})
            assert r.status_code == 200
            _ = r.text
        assert c.app.state.turns == {}


def test_marker_released_when_turn_raises() -> None:
    with _env_cleanup(), _client() as c:
        tid = _new_thread(c)
        # buffered: collect_turn drains the generator inside the handler, so the mid-turn raise
        # propagates and _counted's finally must still release the marker.
        with _fake_session(_completed_events(), raise_after=True):
            with contextlib.suppress(Exception):
                c.post("/api/agent/chat", json={"text": "hi", "thread_id": tid, "stream": False})
        assert c.app.state.turns == {}


# ── 2e: busy-truth switch — rediscovery reads app.state.turns ──────────────────────────────────


def test_auto_rediscover_skipped_while_any_marker_held() -> None:
    from app.services.agent.turns import reserve

    with _env_cleanup(), _client() as c:
        c.app.state.integrations_dirty = True
        reserve(c.app.state.turns, "other-thread", "chat")  # a live turn on some OTHER thread
        tid = _new_thread(c)
        with _fake_session(_completed_events()):
            r = c.post("/api/agent/chat", json={"text": "hi", "thread_id": tid, "stream": False})
        assert r.status_code == 200
        # the gate saw a held marker → auto-rediscover skipped → the flag persists to re-fire later.
        assert c.app.state.integrations_dirty is True


def test_manual_rediscover_409_on_held_marker_then_ok() -> None:
    from app.services.agent.turns import reserve

    with _env_cleanup(), _client() as c:  # no servers configured → rediscover is a fast no-op
        reserve(c.app.state.turns, "t1", "chat")
        assert c.post("/api/integrations/rediscover").status_code == 409
        c.app.state.turns.clear()
        assert c.post("/api/integrations/rediscover").status_code == 200
