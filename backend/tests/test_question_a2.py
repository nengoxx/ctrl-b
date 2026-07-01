"""A2 — the `question` builtin + the loop's ask-the-owner suspend/resume.

The `question` tool signals `AWAITING_ANSWER`, which the loop treats as a suspend (sibling of the
confirm suspend): persist the call, emit `tool.question`, stop — resumed with the owner's answer
injected as the call's result. This drives `_run_calls` directly (no model) to cover the new paths:

  1. builtin       — returns AWAITING_ANSWER with the prompt as summary; empty prompt → ERROR.
  2. suspend       — an interactive turn suspends + emits `tool.question`; the call goes AWAITING_ANSWER.
  3. find pending  — `_find_pending` matches the suspended question (so resume can resolve it).
  4. answer inject — `resume_answers` injects the reply as an OK result (`output == answer`), no suspend.
  5. headless      — interactive=False → the suspend becomes a DENIED result (the subagent carries on).
  6. dismiss       — the `_DISMISS` path skips the question (SKIPPED), like a dismissed confirm.

Each test runs in an isolated `$CTRLB_HOME` temp workspace; the real config/db are never touched.
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


def _guard():
    from app.services.agent.session import _LoopGuard

    return _LoopGuard(max_repeat=5, max_per_tool=10)


def _session_and_call(c, *, interactive: bool = True, prompt: str = "Which host — corsair or emma?"):
    """A session + a persisted thread + an assistant message holding one PENDING `question` call."""
    from app.domain.conversation import Message, Thread, ToolCallPart
    from app.domain.enums import Actor, RunState
    from app.services.agent.session import AgentSession

    s = c.app.state
    agent = s.settings.resolve_agent(None)
    session = AgentSession(
        s.threads, s.messages, s.inference, s.settings, s.actions, agent, interactive=interactive
    )
    thread = _run(s.threads.create(Thread()))
    call_id = uuid.uuid4().hex
    assistant = Message(
        thread_id=thread.id,
        role="assistant",
        actor=Actor.AGENT,
        agent="default",
        parts=[
            ToolCallPart(call_id=call_id, tool="question", args={"prompt": prompt}, state=RunState.PENDING)
        ],
    )
    _run(s.messages.add(assistant))
    return session, thread, assistant, call_id


def _result_event(events):
    return next(e for e in events if e.event == "tool.result")


def test_builtin_returns_awaiting_answer() -> None:
    from app.core.tool import InvocationContext
    from app.domain.enums import Actor, Privilege
    from app.services.agent.question import QuestionInput, question

    ctx = InvocationContext(actor=Actor.AGENT, privilege=Privilege.CONFIRM)
    ok = _run(question(QuestionInput(prompt="Which host?"), ctx))
    assert ok.state.value == "awaiting_answer" and ok.summary == "Which host?"
    empty = _run(question(QuestionInput(prompt="   "), ctx))
    assert empty.state.value == "error"


def test_question_suspends_and_emits_event() -> None:
    with _workspace():
        with _client() as c:
            session, thread, assistant, _cid = _session_and_call(c)
            events, suspended, _ = _run(session._run_calls(thread, assistant, {}, _guard()))
            assert suspended
            assert any(e.event == "tool.question" for e in events)
            q = next(e for e in events if e.event == "tool.question")
            assert q.data["question"].startswith("Which host")
            assert assistant.tool_calls()[0].state.value == "awaiting_answer"


def test_find_pending_matches_awaiting_answer() -> None:
    with _workspace():
        with _client() as c:
            session, thread, assistant, cid = _session_and_call(c)
            _run(session._run_calls(thread, assistant, {}, _guard()))  # suspends + persists
            assert _run(session._find_pending(thread, cid)) is not None


def test_answer_injects_result_without_suspend() -> None:
    with _workspace():
        with _client() as c:
            session, thread, assistant, cid = _session_and_call(c)
            events, suspended, _ = _run(session._run_calls(thread, assistant, {}, _guard(), {cid: "emma"}))
            assert not suspended
            res = _result_event(events).data["result"]
            assert res["state"] == "ok" and res["output"] == "emma"
            assert assistant.tool_calls()[0].state.value == "ok"


def test_headless_subagent_denies_instead_of_suspending() -> None:
    with _workspace():
        with _client() as c:
            session, thread, assistant, _cid = _session_and_call(c, interactive=False)
            events, suspended, _ = _run(session._run_calls(thread, assistant, {}, _guard()))
            assert not suspended
            assert _result_event(events).data["result"]["state"] == "denied"


def test_dismiss_skips_the_question() -> None:
    from app.services.agent.session import _DISMISS

    with _workspace():
        with _client() as c:
            session, thread, assistant, cid = _session_and_call(c)
            events, suspended, _ = _run(session._run_calls(thread, assistant, {cid: _DISMISS}, _guard()))
            assert not suspended
            assert _result_event(events).data["result"]["state"] == "skipped"


if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    for fn in fns:
        fn()
        print(f"ok  {fn.__name__}")
    print(f"\n{len(fns)} passed")
