"""J3 — stale confirm-token recovery (PRE_DEPLOY §1 step 4b).

A med/high-risk agent call suspends `AWAITING_CONFIRM` — persisted to SQLite (durable) — and mints an
in-memory confirm token (`ActionService._pending`, a UX gate per SECURITY_MODEL §2.3). That token dies
on a backend restart / 120s expiry / client reload, while the persisted bubble lives on. The old
behaviour: `execute` re-ran with the stale/missing token → the gate re-suspended (silent no-op on the
first click). The fix: `resume(execute)` re-mints the token server-side for the DURABLE pending call
(`ActionService.confirm_token_for`), so execute runs in one click regardless of token loss — the
persisted state + the explicit execute ARE the confirmation.

Drives the real `AgentSession` + `ActionService` against a temp workspace (no live config/db, no LLM),
mirroring `test_question_a2`'s harness. Token loss is simulated by clearing `_pending` between suspend
and resume. `reboot_host` (HIGH + confirm) is the gated call; an unknown host makes it resolve to a
clean ERROR result after the gate passes — enough to prove the gate opened (it ran, didn't re-suspend).
"""

from __future__ import annotations

import contextlib
import os
import tempfile
import uuid
from pathlib import Path

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


def _run(coro):
    return run_async(coro)


async def _collect(agen):
    return [e async for e in agen]


def _guard():
    from app.services.agent.session import _LoopGuard

    return _LoopGuard(max_repeat=5, max_per_tool=10)


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
    events, suspended, _ = _run(session._run_calls(thread, assistant, {}, _guard()))
    return events, suspended


# ── the mechanism: ActionService.confirm_token_for mints a token the next invoke consumes ──────
def test_confirm_token_for_mints_a_consumable_token() -> None:
    from app.domain.enums import Actor, Privilege

    with _workspace(), _client() as c:
        actions = c.app.state.actions
        args = {"host_id": "nope"}
        out = _run(actions.invoke("reboot_host", args, actor=Actor.AGENT, privilege=Privilege.CONFIRM))
        assert out.needs_confirm  # no token → the gate asks
        tok = actions.confirm_token_for("reboot_host", args)
        out2 = _run(
            actions.invoke(
                "reboot_host", args, actor=Actor.AGENT, privilege=Privilege.CONFIRM, confirm_token=tok
            )
        )
        assert not out2.needs_confirm  # gate passed → executed
        assert out2.result is not None and out2.result.state.value == "error"  # unknown host


# ── end-to-end: resume(execute) runs in one click after the token is gone ──────────────────────
def test_execute_recovers_after_token_loss() -> None:
    with _workspace(), _client() as c:
        session, thread, assistant, cid = _session_and_confirm_call(c)
        _, suspended = _suspend_on_confirm(session, thread, assistant)
        assert suspended and assistant.tool_calls()[0].state.value == "awaiting_confirm"

        c.app.state.actions._pending.clear()  # simulate restart / 120s expiry / client reload
        events = _run(_collect(session.resume(thread, cid, "execute")))

        assert any(e.event == "tool.result" for e in events)  # it RAN (gate re-opened via re-mint)
        assert not any(e.event == "tool.permission" for e in events)  # did NOT re-suspend

        # The DURABLE state resolved — no dead AWAITING_CONFIRM bubble survives to the next reload.
        msgs = _run(c.app.state.messages.list(thread.id))
        cp = next(p for m in msgs for p in m.tool_calls() if p.call_id == cid)
        assert cp.state.value != "awaiting_confirm"


def test_dismiss_still_works_after_token_loss() -> None:
    with _workspace(), _client() as c:
        session, thread, assistant, cid = _session_and_confirm_call(c)
        _suspend_on_confirm(session, thread, assistant)
        c.app.state.actions._pending.clear()
        events = _run(_collect(session.resume(thread, cid, "dismiss")))
        res = next(e for e in events if e.event == "tool.result").data["result"]
        assert res["state"] == "skipped"


def test_no_double_execute() -> None:
    with _workspace(), _client() as c:
        session, thread, assistant, cid = _session_and_confirm_call(c)
        _suspend_on_confirm(session, thread, assistant)
        c.app.state.actions._pending.clear()
        _run(_collect(session.resume(thread, cid, "execute")))  # resolves the call (leaves AWAITING_CONFIRM)
        events = _run(_collect(session.resume(thread, cid, "execute")))  # nothing pending now
        assert any(
            e.event == "error" and "no pending action" in str(e.data.get("message", "")) for e in events
        )


# ── J2 + audit-follow-up hardening of the same resume(execute) path ────────────────────────────
# The server-side re-mint (J3) drops the client's single-use token, so two guards were added:
#   • J2 — a single-flight `begin_execute`/`end_execute` reservation on ActionService blocks a
#     concurrent double-execute of one call (a non-idempotent action can't fire twice).
#   • #2 — the re-mint is wrapped so an unknown/changed tool yields a clean error, not a 500.
def _session_with_awaiting_call(c, tool: str = "reboot_host"):
    """Session + a persisted assistant message holding ONE call already AWAITING_CONFIRM for `tool`
    (crafted directly so we can point it at a tool that won't resolve at resume time)."""
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


def test_begin_execute_is_single_flight() -> None:
    with _workspace(), _client() as c:
        actions = c.app.state.actions
        assert actions.begin_execute("c1") is True  # reserved
        assert actions.begin_execute("c1") is False  # concurrent double-execute of the same call → rejected
        assert actions.begin_execute("c2") is True  # a different call is independent
        actions.end_execute("c1")
        assert actions.begin_execute("c1") is True  # released → a later sequential execute proceeds


def test_execute_releases_inflight_reservation() -> None:
    # A completed execute must leave no reservation behind (the `finally`), else a legit retry stalls.
    with _workspace(), _client() as c:
        session, thread, assistant, cid = _session_and_confirm_call(c)
        _suspend_on_confirm(session, thread, assistant)
        c.app.state.actions._pending.clear()
        _run(_collect(session.resume(thread, cid, "execute")))
        assert cid not in c.app.state.actions._inflight


def test_resume_execute_unknown_tool_yields_clean_error() -> None:
    # The tool is gone by resume time (e.g. an MCP server dropped between turns): the server-side
    # re-mint raises UnknownTool, which must become a clean error+done, NOT escape the SSE generator
    # (a 500 / permanently-stuck bubble). The in-flight reservation is still released.
    with _workspace(), _client() as c:
        session, thread, _, cid = _session_with_awaiting_call(c, tool="ghost_tool")
        events = _run(_collect(session.resume(thread, cid, "execute")))
        assert any(e.event == "error" and "cannot execute" in str(e.data.get("message", "")) for e in events)
        assert any(e.event == "done" and e.data.get("state") == "error" for e in events)
        assert cid not in c.app.state.actions._inflight  # released via finally


if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    for fn in fns:
        fn()
        print(f"ok  {fn.__name__}")
    print(f"\n{len(fns)} passed")
