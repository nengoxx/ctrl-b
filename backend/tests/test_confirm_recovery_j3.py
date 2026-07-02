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


if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    for fn in fns:
        fn()
        print(f"ok  {fn.__name__}")
    print(f"\n{len(fns)} passed")
