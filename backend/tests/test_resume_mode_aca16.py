"""ACA-16 / S2-D — the `/local`//`/cloud` mode is carried across a confirm resume.

`ChatRequest.mode` forces the inference backend per message (4c). Historically a resume dropped it
(the continuation ran on the configured default). Slice 2 threads a `mode` param
endpoint → `session.resume` → `_drive` so a `/local` turn *resumes* local. We spy `_drive` (an async
generator) and assert the mode reaches it on both the dismiss and execute paths, and that the default
(no override) stays `None`.

Mirrors `test_confirm_recovery_j3.py`'s harness: the real `AgentSession` + `ActionService` against a
temp workspace (no live config/db, no LLM). A `reboot_host` (HIGH + confirm) call is suspended
AWAITING_CONFIRM, then resumed with a spied `_drive` so no model iteration actually runs.
"""

from __future__ import annotations

import contextlib
import os
import tempfile
import uuid
from pathlib import Path

from _async import drain_run_calls, run_async


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
    return session, thread, call_id, assistant


def _suspend_on_confirm(session, thread, assistant):
    """Run the pending call with no token → it suspends AWAITING_CONFIRM + mints a token in _pending."""
    drain_run_calls(session, thread, assistant, {}, _guard())


def _spy_drive(session):
    """Replace `session._drive` with a recorder that captures kwargs and yields nothing (so the resume
    completes without a real model iteration). Returns the dict the spy writes into."""
    recorded: dict = {}

    async def _spy(thread, *, mode=None, **kw):
        recorded["mode"] = mode
        recorded["kw"] = kw
        return
        yield  # unreachable — makes _spy an async generator matching the real _drive

    session._drive = _spy  # type: ignore[method-assign]
    return recorded


def test_resume_dismiss_threads_mode_to_drive() -> None:
    with _workspace(), _client() as c:
        session, thread, cid, assistant = _session_and_confirm_call(c)
        _suspend_on_confirm(session, thread, assistant)
        recorded = _spy_drive(session)
        _run(_collect(session.resume(thread, cid, "dismiss", mode="cloud")))
        assert recorded["mode"] == "cloud"


def test_resume_execute_threads_mode_to_drive() -> None:
    with _workspace(), _client() as c:
        session, thread, cid, assistant = _session_and_confirm_call(c)
        _suspend_on_confirm(session, thread, assistant)
        recorded = _spy_drive(session)
        _run(_collect(session.resume(thread, cid, "execute", mode="local")))
        assert recorded["mode"] == "local"


def test_resume_without_mode_leaves_drive_default_none() -> None:
    with _workspace(), _client() as c:
        session, thread, cid, assistant = _session_and_confirm_call(c)
        _suspend_on_confirm(session, thread, assistant)
        recorded = _spy_drive(session)
        _run(_collect(session.resume(thread, cid, "dismiss")))
        assert recorded["mode"] is None


def test_resume_request_coerces_mode_syntax_only() -> None:
    """A11/D48 C7/R14: `mode` is a PROVIDER NAME, validated SYNTAX-ONLY (the request model can't see
    settings). Any valid slug — an arbitrary provider name — passes through unchanged and is resolved
    LATER against the captured registry (an unknown provider → the default chain, logged). Only truly
    junk (non-slug: uppercase / spaces / empty / non-string) coerces to None here. `/local` + `/cloud`
    are now ordinary provider-name slugs (the retired-verb literals are gone), so they pass through too —
    they resolve to a provider named that IF one exists, else the default chain."""
    from app.api.agent import ResumeRequest

    assert (
        ResumeRequest(thread_id="t", call_id="c", mode="openrouter").mode == "openrouter"
    )  # arbitrary provider
    assert ResumeRequest(thread_id="t", call_id="c", mode="minig+").mode == "minig+"  # slug allows + . - _
    assert ResumeRequest(thread_id="t", call_id="c", mode="local").mode == "local"  # ordinary slug now
    assert (
        ResumeRequest(thread_id="t", call_id="c", mode="Bad Name").mode is None
    )  # space/upper → junk → None
    assert ResumeRequest(thread_id="t", call_id="c", mode="").mode is None  # empty → None
