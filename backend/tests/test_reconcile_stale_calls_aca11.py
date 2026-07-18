"""ACA Slice 3 wave 1 — A11 + the startup reconciler (D39).

Drives the reconciler / `_assemble` synthesis / `_run_calls` resume-skip directly (no model):

  reconciler — `reconcile_stale_calls` flips tool calls stranded in an OPEN state
               (PENDING/RUNNING) to CANCELLED and persists them, returning the flipped count; the
               durable suspends (AWAITING_CONFIRM/AWAITING_ANSWER) and terminal states (OK) survive
               untouched. A `thread_id`-scoped call only touches that thread.
  _assemble  — a persisted-CANCELLED call with no result synthesizes a `cancelled` tool message in
               the OpenAI payload (keyed STRICTLY on the persisted CANCELLED state, adversarial L3).
  resume     — CANCELLED is in `_RESOLVED`, so `_run_calls` skips a cancelled call (never re-runs).
  boot       — the lifespan reconcile is best-effort: a raising reconciler never aborts startup.

Each test runs in an isolated `$CTRLB_HOME` temp workspace; the real config/db are never touched.
"""

from __future__ import annotations

import contextlib
import os
import tempfile
import uuid
from pathlib import Path

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


def _run(coro):
    return run_async(coro)


def _session(c):
    from app.services.agent.session import AgentSession

    s = c.app.state
    agent = s.settings.resolve_agent(None)
    return AgentSession(s.threads, s.messages, s.inference, s.settings, s.actions, agent)


def _thread(c):
    from app.domain.conversation import Thread

    return _run(c.app.state.threads.create(Thread()))


def _assistant_with_calls(c, thread, calls):
    """Persist an assistant message holding one `tool_call` part per `(tool, args, state)` triple.
    Returns `(message, [call_id, ...])` in the same order."""
    from app.domain.conversation import Message, ToolCallPart
    from app.domain.enums import Actor

    parts = []
    ids = []
    for tool, args, state in calls:
        cid = uuid.uuid4().hex
        ids.append(cid)
        parts.append(ToolCallPart(call_id=cid, tool=tool, args=args, state=state))
    msg = Message(thread_id=thread.id, role="assistant", actor=Actor.AGENT, agent="default", parts=parts)
    _run(c.app.state.messages.add(msg))
    return msg, ids


def _states(c, message_id):
    """Re-read a message from the DB and return its call_id → state map (as strings)."""
    msg = _run(c.app.state.messages.get(message_id))
    return {cp.call_id: cp.state.value for cp in msg.tool_calls()}


# ── reconciler ──────────────────────────────────────────────────────────────────────────────────


def test_reconcile_flips_only_open_states() -> None:
    from app.domain.enums import RunState
    from app.services.agent.turns import reconcile_stale_calls

    with _workspace():
        with _client() as c:
            thread = _thread(c)
            # An in-flight message (no suspend) — PENDING + RUNNING flip, its OK terminal survives.
            open_msg, (c_pending, c_running, c_ok) = _assistant_with_calls(
                c,
                thread,
                [
                    ("ping_host", {"host_id": "a"}, RunState.PENDING),
                    ("ping_host", {"host_id": "b"}, RunState.RUNNING),
                    ("ping_host", {"host_id": "d"}, RunState.OK),
                ],
            )
            # A SEPARATE suspended message — its durable AWAITING_CONFIRM survives (message-level skip).
            confirm_msg, (c_confirm,) = _assistant_with_calls(
                c, thread, [("shutdown_host", {"host_id": "c"}, RunState.AWAITING_CONFIRM)]
            )
            n = _run(reconcile_stale_calls(c.app.state.messages))
            assert n == 2  # only PENDING + RUNNING (in the non-suspended message) flipped
            open_states = _states(c, open_msg.id)
            assert open_states[c_pending] == "cancelled"
            assert open_states[c_running] == "cancelled"
            assert open_states[c_ok] == "ok"  # terminal survives
            assert _states(c, confirm_msg.id)[c_confirm] == "awaiting_confirm"  # durable suspend survives


def test_reconcile_is_thread_scoped() -> None:
    from app.domain.enums import RunState
    from app.services.agent.turns import reconcile_stale_calls

    with _workspace():
        with _client() as c:
            t_a = _thread(c)
            t_b = _thread(c)
            msg_a, (a_call,) = _assistant_with_calls(
                c, t_a, [("ping_host", {"host_id": "a"}, RunState.PENDING)]
            )
            msg_b, (b_call,) = _assistant_with_calls(
                c, t_b, [("ping_host", {"host_id": "b"}, RunState.RUNNING)]
            )
            n = _run(reconcile_stale_calls(c.app.state.messages, t_a.id))
            assert n == 1
            assert _states(c, msg_a.id)[a_call] == "cancelled"
            assert _states(c, msg_b.id)[b_call] == "running"  # other thread untouched


def test_reconcile_no_stale_returns_zero() -> None:
    from app.domain.enums import RunState
    from app.services.agent.turns import reconcile_stale_calls

    with _workspace():
        with _client() as c:
            thread = _thread(c)
            _assistant_with_calls(c, thread, [("ping_host", {"host_id": "a"}, RunState.OK)])
            assert _run(reconcile_stale_calls(c.app.state.messages)) == 0


def test_reconcile_skips_message_with_a_suspended_sibling() -> None:
    """MESSAGE-LEVEL suspend exclusion (review HIGH-1): a multi-call assistant message suspended on
    ONE call leaves its later PENDING siblings as legitimate resume work (they run after the confirm
    resolves). A full-scan reconcile must skip the WHOLE message so those siblings are NOT flipped to
    CANCELLED (which `_RESOLVED` would then skip forever)."""
    from app.domain.enums import RunState
    from app.services.agent.turns import reconcile_stale_calls

    with _workspace():
        with _client() as c:
            thread = _thread(c)
            msg, (c_ok, c_confirm, c_pending) = _assistant_with_calls(
                c,
                thread,
                [
                    ("ping_host", {"host_id": "a"}, RunState.OK),
                    ("shutdown_host", {"host_id": "b"}, RunState.AWAITING_CONFIRM),
                    ("ping_host", {"host_id": "c"}, RunState.PENDING),  # a resumable sibling
                ],
            )
            n = _run(reconcile_stale_calls(c.app.state.messages))
            assert n == 0  # the whole message was skipped — nothing flipped
            states = _states(c, msg.id)
            assert states[c_ok] == "ok"
            assert states[c_confirm] == "awaiting_confirm"
            assert states[c_pending] == "pending"  # the resumable PENDING sibling SURVIVES


def test_reconcile_scoped_flips_only_the_non_suspended_message() -> None:
    """Scoped (cancel-path) reconcile in a thread that ALSO holds an older suspended message: only the
    non-suspended in-flight message flips to CANCELLED; the suspended message (incl. its own PENDING
    sibling) survives — the exclusion is per-MESSAGE, not thread-wide (review HIGH-1)."""
    from app.domain.enums import RunState
    from app.services.agent.turns import reconcile_stale_calls

    with _workspace():
        with _client() as c:
            thread = _thread(c)
            suspended_msg, (s_confirm, s_sibling) = _assistant_with_calls(
                c,
                thread,
                [
                    ("shutdown_host", {"host_id": "a"}, RunState.AWAITING_CONFIRM),
                    ("ping_host", {"host_id": "b"}, RunState.PENDING),
                ],
            )
            live_msg, (live_call,) = _assistant_with_calls(
                c, thread, [("ping_host", {"host_id": "c"}, RunState.RUNNING)]
            )
            n = _run(reconcile_stale_calls(c.app.state.messages, thread.id))
            assert n == 1  # only the live (non-suspended) message's call flipped
            assert _states(c, live_msg.id)[live_call] == "cancelled"
            surv = _states(c, suspended_msg.id)
            assert surv[s_confirm] == "awaiting_confirm"
            assert surv[s_sibling] == "pending"  # the suspended message's PENDING sibling survives


# ── _assemble synthesis ─────────────────────────────────────────────────────────────────────────


def test_assemble_synthesizes_cancelled_result() -> None:
    from app.domain.enums import RunState
    from app.services.agent.turns import reconcile_stale_calls

    with _workspace():
        with _client() as c:
            thread = _thread(c)
            _, (cid,) = _assistant_with_calls(c, thread, [("ping_host", {"host_id": "a"}, RunState.PENDING)])
            _run(reconcile_stale_calls(c.app.state.messages))  # → CANCELLED, no result persisted
            session = _session(c)
            messages = _run(session._assemble(thread))
            tool_msgs = [m for m in messages if m.get("role") == "tool"]
            hit = next(m for m in tool_msgs if m["tool_call_id"] == cid)
            assert "cancelled" in hit["content"]
            assert "cancelled — not completed" in hit["content"]


def test_assemble_abandoned_confirm_still_skipped() -> None:
    """The cancelled synthesis is keyed STRICTLY on the persisted CANCELLED state — a plain
    unresolved call (never cancelled) still gets the legacy `skipped`/'not executed' synthesis. The
    two calls live in SEPARATE messages: the PENDING one (no suspend) reconciles → CANCELLED, while the
    abandoned confirm sits in its own message the reconciler skips (message-level exclusion)."""
    from app.domain.enums import RunState
    from app.services.agent.turns import reconcile_stale_calls

    with _workspace():
        with _client() as c:
            thread = _thread(c)
            _, (cancelled_id,) = _assistant_with_calls(
                c,
                thread,
                [("ping_host", {"host_id": "a"}, RunState.PENDING)],  # → cancelled
            )
            _, (confirm_id,) = _assistant_with_calls(
                c,
                thread,
                [("shutdown_host", {"host_id": "b"}, RunState.AWAITING_CONFIRM)],  # abandoned
            )
            _run(reconcile_stale_calls(c.app.state.messages))
            session = _session(c)
            messages = _run(session._assemble(thread))
            tool_msgs = {m["tool_call_id"]: m["content"] for m in messages if m.get("role") == "tool"}
            assert "cancelled" in tool_msgs[cancelled_id]
            assert "not executed" in tool_msgs[confirm_id]  # legacy skipped path, NOT cancelled
            assert "cancelled" not in tool_msgs[confirm_id]


def test_cancelled_call_skipped_on_resume() -> None:
    """CANCELLED ∈ `_RESOLVED`, so `_run_calls` skips it: the tool is never invoked and no
    tool.result event is emitted for it."""
    from app.domain.enums import RunState
    from app.services.agent.session import _LoopGuard

    with _workspace():
        with _client() as c:
            thread = _thread(c)
            msg, (cid,) = _assistant_with_calls(
                c, thread, [("ping_host", {"host_id": "a"}, RunState.CANCELLED)]
            )
            session = _session(c)
            invoked: list[str] = []

            async def _fake(name, args, **kw):  # would record if the cancelled call re-ran
                invoked.append(name)
                raise AssertionError("cancelled call must not be invoked")

            session._actions.invoke = _fake  # type: ignore[method-assign]
            guard = _LoopGuard(max_repeat=5, max_per_tool=10)
            events, suspended, made_progress = _run(session._run_calls(thread, msg, {}, guard))
            assert invoked == []
            assert not suspended and not made_progress
            assert not any(e.event == "tool.result" and e.data.get("callId") == cid for e in events)


# ── boot best-effort ────────────────────────────────────────────────────────────────────────────


def test_boot_reconcile_best_effort() -> None:
    """A raising reconciler at boot must NOT abort the lifespan — the app still comes up + serves."""
    import app.main as main_mod

    async def _boom(messages, thread_id=None):
        raise RuntimeError("db hiccup at boot")

    with _workspace():
        original = main_mod.reconcile_stale_calls
        main_mod.reconcile_stale_calls = _boom  # type: ignore[assignment]
        try:
            with _client() as c:  # entering the context runs the lifespan
                assert c.get("/api/health").status_code == 200
        finally:
            main_mod.reconcile_stale_calls = original
