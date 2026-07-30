"""FORMAL-AUDIT FIX WAVE A — the confirm-flow/security batch (Codex-audit findings, all verified).

Pinning tests, one (or more) per item:

  A1 [C1-H1]  resume decisions fail closed — junk 422s at the API + errors at the session layer;
              a padded valid decision still passes; `answer` against a confirm is refused (no state
              change).
  A2 [C1-H2 + C2-M1]  confirm-token lifecycle — dismiss REVOKES the pending token; a re-mint keeps
              single-liveness (at most one live token per (action, args)).
  A3 [C1-M3]  unknown proposal decision no longer applies the write — `reject` 422s, nothing written,
              the proposal stays pending.
  A4 [C4]     a 0 per-tool cap is rejected at the AgentDef boundary AND a legacy-persisted 0 no longer
              KeyErrors the suppression message.
  A5 [C4-H1]  a confirmed resume flips the persisted call PENDING→RUNNING BEFORE invoking, so a death
              post-effect reconciles to CANCELLED (never re-executable) instead of staying a resumable
              AWAITING_CONFIRM bubble.

(A6 [C4-H2] — cancel is turn-scoped — lives in `test_cancel_turn_scope_a6.py`.)

Drives the real `AgentSession`/`ActionService`/DB against a temp workspace (no live config/db, no LLM),
mirroring `test_confirm_recovery_j3`'s harness.
"""

from __future__ import annotations

import contextlib
import os
import tempfile
import uuid
from pathlib import Path

from _async import drain_run_calls, run_async

from app.domain.event import ORIGIN_USER_CHAT


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


def _run(coro):
    return run_async(coro)


async def _collect(agen):
    return [e async for e in agen]


def _guard(max_repeat: int = 5, max_per_tool: int = 10):
    from app.services.agent.session import _LoopGuard

    return _LoopGuard(max_repeat=max_repeat, max_per_tool=max_per_tool)


def _session_and_confirm_call(c):
    """Session + a persisted assistant message holding one PENDING confirm-gated `reboot_host` call."""
    from app.domain.conversation import Message, Thread, ToolCallPart
    from app.domain.enums import Actor, RunState
    from app.services.agent.session import AgentSession

    s = c.app.state
    agent = s.settings.resolve_agent(None)
    session = AgentSession(s.threads, s.messages, s.inference, s.settings, s.actions, agent, interactive=True)
    thread = _run(s.threads.create(Thread()))
    call_id = uuid.uuid4().hex
    assistant = Message(
        thread_id=thread.id,
        role="assistant",
        actor=Actor.AGENT,
        agent="default",
        parts=[
            ToolCallPart(
                call_id=call_id, tool="reboot_host", args={"host_id": "nope"}, state=RunState.PENDING
            )
        ],
    )
    _run(s.messages.add(assistant))
    return session, thread, assistant, call_id


def _suspend_on_confirm(session, thread, assistant):
    """Run the pending call with no token → it suspends AWAITING_CONFIRM + mints a token in _pending."""
    events, suspended, _ = drain_run_calls(session, thread, assistant, {}, _guard())
    return events, suspended


def _awaiting_state(c, thread, call_id):
    from app.domain.enums import RunState

    msgs = _run(c.app.state.messages.list(thread.id))
    cp = next(p for m in msgs for p in m.tool_calls() if p.call_id == call_id)
    return cp.state, RunState


# ── A1 [C1-H1] resume decisions fail closed ─────────────────────────────────────────────────────
def test_a1_junk_decision_422_at_api() -> None:
    with _workspace(), _client() as c:
        r = c.post(
            "/api/agent/resume",
            json={"thread_id": "t", "call_id": "c", "decision": "frobnicate"},
        )
        assert r.status_code == 422  # Literal rejects junk BEFORE the handler runs


def test_a1_padded_dismiss_is_stripped_to_valid() -> None:
    from app.api.agent import ResumeRequest

    req = ResumeRequest(thread_id="t", call_id="c", decision="dismiss ")
    assert req.decision == "dismiss"  # the before-validator strips, then the Literal accepts


def test_a1_session_unknown_decision_errors_and_leaves_state() -> None:
    with _workspace(), _client() as c:
        session, thread, assistant, cid = _session_and_confirm_call(c)
        _suspend_on_confirm(session, thread, assistant)
        events = _run(_collect(session.resume(thread, cid, "frobnicate")))
        assert any(
            e.event == "error" and "unknown resume decision" in str(e.data.get("message", "")) for e in events
        )
        assert any(e.event == "done" and e.data.get("state") == "error" for e in events)
        state, RunState = _awaiting_state(c, thread, cid)
        assert state == RunState.AWAITING_CONFIRM  # no state change — the call is still resolvable


def test_a1_answer_against_confirm_errors_and_leaves_state() -> None:
    with _workspace(), _client() as c:
        session, thread, assistant, cid = _session_and_confirm_call(c)
        _suspend_on_confirm(session, thread, assistant)  # AWAITING_CONFIRM, not AWAITING_ANSWER
        events = _run(_collect(session.resume(thread, cid, "answer", answer="oops")))
        assert any(
            e.event == "error" and "not awaiting an answer" in str(e.data.get("message", "")) for e in events
        )
        assert any(e.event == "done" and e.data.get("state") == "error" for e in events)
        state, RunState = _awaiting_state(c, thread, cid)
        assert state == RunState.AWAITING_CONFIRM  # the confirm was NOT marked OK


# ── A2 [C1-H2 + C2-M1] confirm-token lifecycle ──────────────────────────────────────────────────
def test_a2_dismiss_revokes_the_pending_token() -> None:
    from app.domain.enums import Actor, Privilege

    with _workspace(), _client() as c:
        session, thread, assistant, cid = _session_and_confirm_call(c)
        _suspend_on_confirm(session, thread, assistant)  # mints a token in _pending
        actions = c.app.state.actions
        # the token the confirm gate minted for this exact (action, args)
        tokens = [t for t, p in actions._pending.items() if p.action == "reboot_host"]
        assert len(tokens) == 1
        token = tokens[0]

        _run(_collect(session.resume(thread, cid, "dismiss")))  # owner denies → revoke

        assert token not in actions._pending  # the token is gone
        # …and it no longer redeems via /api/actions: the gate re-asks instead of executing.
        stale = _run(
            actions.invoke(
                "reboot_host",
                {"host_id": "nope"},
                origin=ORIGIN_USER_CHAT,
                actor=Actor.AGENT,
                privilege=Privilege.CONFIRM,
                confirm_token=token,
            )
        )
        assert stale.needs_confirm  # rejected → the action did NOT run


def test_a2_single_liveness_on_remint() -> None:
    from app.domain.enums import Actor, Privilege

    with _workspace(), _client() as c:
        actions = c.app.state.actions
        args = {"host_id": "nope"}
        # the gate mints a token (the outstanding Allow), then the resume re-mint consumes it …
        out = _run(
            actions.invoke(
                "reboot_host", args, origin=ORIGIN_USER_CHAT, actor=Actor.AGENT, privilege=Privilege.CONFIRM
            )
        )
        orphan = out.confirm_token
        fresh = actions.confirm_token_for("reboot_host", args)
        assert fresh != orphan
        assert orphan not in actions._pending  # the previous live token is dead
        assert fresh in actions._pending
        # … so exactly ONE live token remains for this (action, args)
        live = [p for p in actions._pending.values() if p.action == "reboot_host"]
        assert len(live) == 1


# ── A3 [C1-M3] unknown proposal decision no longer applies the write ────────────────────────────
def _seed_proposal(c, tool: str, args: dict) -> tuple[str, str]:
    from app.domain.conversation import Message, Thread, ToolCallPart, ToolResultPart
    from app.domain.enums import Actor, RunState
    from app.domain.result import ToolResult

    threads, messages = c.app.state.threads, c.app.state.messages
    thread = _run(threads.create(Thread()))
    call_id = uuid.uuid4().hex
    _run(
        messages.add(
            Message(
                thread_id=thread.id,
                role="assistant",
                actor=Actor.AGENT,
                agent="default",
                parts=[ToolCallPart(call_id=call_id, tool=tool, args=args, state=RunState.OK)],
            )
        )
    )
    _run(
        messages.add(
            Message(
                thread_id=thread.id,
                role="tool",
                actor=Actor.AGENT,
                parts=[
                    ToolResultPart(
                        call_id=call_id,
                        result=ToolResult(
                            state=RunState.OK, summary="proposed (not written)", data={"proposed": args}
                        ),
                    )
                ],
            )
        )
    )
    return thread.id, call_id


def _result_data(c, thread_id: str, call_id: str) -> dict:
    msgs = c.get(f"/api/threads/{thread_id}/messages").json()
    for m in msgs:
        for p in m["parts"]:
            if p["type"] == "tool_result" and p["call_id"] == call_id:
                return p["result"]["data"]
    raise AssertionError("result part not found")


def test_a3_reject_decision_422_and_proposal_kept() -> None:
    with _workspace():
        with _client() as c:
            tid, cid = _seed_proposal(c, "memory", {"target": "memory", "action": "add", "content": "x"})
            r = c.post(
                "/api/agent/apply",
                json={"thread_id": tid, "call_id": cid, "decision": "reject"},
            )
            assert r.status_code == 422  # not "dismiss" → rejected, the write never runs
            # the proposal is untouched — still pending (still approvable/dismissable)
            assert "proposed" in _result_data(c, tid, cid)
            assert "applied" not in _result_data(c, tid, cid)


def test_a3_padded_dismiss_is_stripped_to_valid() -> None:
    from app.api.agent import ApplyRequest

    assert ApplyRequest(thread_id="t", call_id="c", decision=" dismiss ").decision == "dismiss"


# ── A4 [C4] a zero per-tool cap ─────────────────────────────────────────────────────────────────
def test_a4_zero_cap_rejected_at_agentdef_boundary() -> None:
    from pydantic import ValidationError

    from app.domain.agent import AgentDef

    for field in ("max_calls_per_tool", "max_repeat_calls"):
        try:
            AgentDef(name="x", **{field: 0})
            raise AssertionError(f"{field}=0 should have been rejected (ge=1)")
        except ValidationError:
            pass
    # the boundary value is accepted
    assert AgentDef(name="x", max_calls_per_tool=1).max_calls_per_tool == 1


def _one_call_assistant(c, tool: str = "ping_host", args: dict | None = None):
    from app.domain.conversation import Message, Thread, ToolCallPart
    from app.domain.enums import Actor, RunState
    from app.services.agent.session import AgentSession

    s = c.app.state
    agent = s.settings.resolve_agent(None)
    session = AgentSession(s.threads, s.messages, s.inference, s.settings, s.actions, agent, interactive=True)
    thread = _run(s.threads.create(Thread()))
    cid = uuid.uuid4().hex
    assistant = Message(
        thread_id=thread.id,
        role="assistant",
        actor=Actor.AGENT,
        agent="default",
        parts=[ToolCallPart(call_id=cid, tool=tool, args=args or {"host_id": "h1"}, state=RunState.PENDING)],
    )
    _run(s.messages.add(assistant))
    return session, thread, assistant, cid


def test_a4_legacy_zero_cap_suppresses_without_keyerror() -> None:
    # A model persisted with the old 0 cap: build the guard directly (bypasses AgentDef validation)
    # exactly as `_drive` would from a legacy AgentDef. The first call is suppressed by the per-tool
    # cap BEFORE the tool is ever counted, so the suppression message reads `tool_counts` for a key
    # that was never inserted — it must NOT KeyError (defensive `.get`).
    with _workspace(), _client() as c:
        session, thread, assistant, cid = _one_call_assistant(c)
        events, suspended, made_progress = drain_run_calls(
            session, thread, assistant, {}, _guard(max_per_tool=0)
        )
        assert not suspended and not made_progress
        res = next(e for e in events if e.event == "tool.result").data["result"]
        assert res["state"] == "denied" and "call limit" in res["summary"]  # suppressed, not crashed


def test_a4_cap_one_boundary_allows_one_then_suppresses() -> None:
    from app.domain.enums import RunState
    from app.domain.result import ToolResult
    from app.services.action_service import InvokeOutcome

    with _workspace(), _client() as c:
        from app.domain.conversation import Message, Thread, ToolCallPart
        from app.domain.enums import Actor
        from app.services.agent.session import AgentSession

        s = c.app.state
        agent = s.settings.resolve_agent(None)
        session = AgentSession(
            s.threads, s.messages, s.inference, s.settings, s.actions, agent, interactive=True
        )
        thread = _run(s.threads.create(Thread()))
        cid1, cid2 = uuid.uuid4().hex, uuid.uuid4().hex
        assistant = Message(
            thread_id=thread.id,
            role="assistant",
            actor=Actor.AGENT,
            agent="default",
            parts=[
                ToolCallPart(call_id=cid1, tool="ping_host", args={"host_id": "a"}, state=RunState.PENDING),
                ToolCallPart(call_id=cid2, tool="ping_host", args={"host_id": "b"}, state=RunState.PENDING),
            ],
        )
        _run(s.messages.add(assistant))

        async def fake_invoke(tool, args, **kw):
            return InvokeOutcome(needs_confirm=False, result=ToolResult(state=RunState.OK, summary="pong"))

        session._actions.invoke = fake_invoke

        events, _suspended, _progress = drain_run_calls(
            session, thread, assistant, {}, _guard(max_per_tool=1)
        )
        by_call = {e.data["callId"]: e.data["result"] for e in events if e.event == "tool.result"}
        assert by_call[cid1]["state"] == "ok"  # the first (cap=1) runs
        assert by_call[cid2]["state"] == "denied" and "call limit" in by_call[cid2]["summary"]


# ── A5 [C4-H1] a confirmed resume flips PENDING→RUNNING before invoking ──────────────────────────
def _session_with_awaiting_call(c, tool: str = "reboot_host"):
    from app.domain.conversation import Message, Thread, ToolCallPart
    from app.domain.enums import Actor, RunState
    from app.services.agent.session import AgentSession

    s = c.app.state
    agent = s.settings.resolve_agent(None)
    session = AgentSession(s.threads, s.messages, s.inference, s.settings, s.actions, agent, interactive=True)
    thread = _run(s.threads.create(Thread()))
    call_id = uuid.uuid4().hex
    assistant = Message(
        thread_id=thread.id,
        role="assistant",
        actor=Actor.AGENT,
        agent="default",
        parts=[
            ToolCallPart(
                call_id=call_id, tool=tool, args={"host_id": "nope"}, state=RunState.AWAITING_CONFIRM
            )
        ],
    )
    _run(s.messages.add(assistant))
    return session, thread, assistant, call_id


def test_a5_confirmed_resume_persists_running_then_reconciles_to_cancelled() -> None:
    import asyncio

    from app.domain.enums import RunState
    from app.services.agent.turns import reconcile_stale_calls

    with _workspace(), _client() as c:
        session, thread, assistant, cid = _session_with_awaiting_call(c)

        async def boom(*a, **k):
            # The turn dies just after the pre-invoke persist (audit-write raise / Stop right after the
            # side effect) — simulated as the invoke itself being cancelled AFTER we flip to RUNNING.
            raise asyncio.CancelledError

        session._actions.invoke = boom

        try:
            drain_run_calls(session, thread, assistant, {cid: "a-real-confirm-token"}, _guard())
            raise AssertionError("the CancelledError should have propagated")
        except asyncio.CancelledError:
            pass

        # Pre-reconcile: the persisted call is RUNNING (the pre-invoke persist), NOT AWAITING_CONFIRM.
        msgs = _run(c.app.state.messages.list(thread.id))
        cp = next(p for m in msgs for p in m.tool_calls() if p.call_id == cid)
        assert cp.state == RunState.RUNNING

        # The message-level suspend exclusion no longer protects it (no AWAITING_* left), so the
        # reconciler flips RUNNING → CANCELLED — the bubble is never re-executable.
        flipped = _run(reconcile_stale_calls(c.app.state.messages, thread.id))
        assert flipped == 1
        msgs = _run(c.app.state.messages.list(thread.id))
        cp = next(p for m in msgs for p in m.tool_calls() if p.call_id == cid)
        assert cp.state == RunState.CANCELLED


if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    for fn in fns:
        fn()
        print(f"ok  {fn.__name__}")
    print(f"\n{len(fns)} passed")
