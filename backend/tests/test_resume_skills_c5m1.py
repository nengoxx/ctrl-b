"""Formal-audit wave C · C5-M1 — a turn's active skills are carried across a confirm resume.

A skill narrows the toolset + injects instructions only while active (progressive disclosure). Before
this fix, `resume` built a fresh `AgentSession` and re-activated NOTHING, so the resumed half of a
turn ran on a BROADER toolset than the owner confirmed under. The fix threads
`ResumeRequest.skills` → `session.resume(..., skills=...)` → `_activate_skills(select=False)`
(re-activate the carried skills verbatim, no selector re-run — there's no user message on a resume).

Mirrors `test_resume_mode_aca16.py`'s harness (real `AgentSession`/`ActionService` on a temp
workspace, `_drive` spied so no model iteration runs), with the skills provider + selector wired.
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


def _write_skill(root: Path, name: str, allowed_tools: list[str]) -> None:
    d = root / name
    d.mkdir(parents=True, exist_ok=True)
    at = f"\nallowed_tools: [{', '.join(allowed_tools)}]" if allowed_tools else ""
    (d / "SKILL.md").write_text(
        f"---\nname: {name}\ndescription: deploy a release{at}\n---\nDeploy carefully.\n",
        encoding="utf-8",
    )


def _session_with_skills(c):
    """A session wired with the app's skills provider + selector (unlike the mode-test harness)."""
    from app.services.agent.session import AgentSession

    s = c.app.state
    agent = s.settings.resolve_agent(None)
    return AgentSession(
        s.threads,
        s.messages,
        s.inference,
        s.settings,
        s.actions,
        agent,
        skills=s.skills,
        selector=s.skill_selector,
        interactive=True,
    )


def _suspend_confirm_call(c, session):
    """Persist + suspend one PENDING confirm-gated `reboot_host` call → AWAITING_CONFIRM."""
    from app.domain.conversation import Message, Thread, ToolCallPart
    from app.domain.enums import Actor, RunState

    s = c.app.state
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
    _run(session._run_calls(thread, assistant, {}, _guard()))  # no token → suspends AWAITING_CONFIRM
    return thread, call_id


def _spy_drive(session):
    async def _spy(thread, *, mode=None, **kw):
        return
        yield  # unreachable — makes _spy an async generator matching the real _drive

    session._drive = _spy  # type: ignore[method-assign]


def test_resume_reactivates_carried_skills() -> None:
    with _workspace(), _client() as c:
        _write_skill(c.app.state.settings.skills_dir_path(), "deploy", allowed_tools=["ping_host"])
        session = _session_with_skills(c)
        thread, cid = _suspend_confirm_call(c, session)
        _spy_drive(session)
        _run(_collect(session.resume(thread, cid, "dismiss", skills=["deploy"])))
        # The carried skill is active on the resumed session: its instructions are injected …
        assert session._skills_note is not None and "deploy" in session._skills_note
        # … and its `allowed_tools` narrowed the effective toolset (the confirm-time toolset).
        assert session._tool_allow == ["ping_host"]


def test_resume_without_skills_leaves_toolset_broad() -> None:
    """No carried skills → no narrowing (the default agent's `"*"`), no injected note — the regression
    baseline (a resume that carries nothing must not accidentally activate a skill)."""
    with _workspace(), _client() as c:
        _write_skill(c.app.state.settings.skills_dir_path(), "deploy", allowed_tools=["ping_host"])
        session = _session_with_skills(c)
        thread, cid = _suspend_confirm_call(c, session)
        _spy_drive(session)
        _run(_collect(session.resume(thread, cid, "dismiss")))  # no skills=
        assert session._skills_note is None
        assert session._tool_allow == session._agent.tools  # unchanged (broad)


def test_resume_request_defaults_skills_to_empty_list() -> None:
    from app.api.agent import ResumeRequest

    assert ResumeRequest(thread_id="t", call_id="c").skills == []
    assert ResumeRequest(thread_id="t", call_id="c", skills=["deploy"]).skills == ["deploy"]


if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    for fn in fns:
        fn()
        print(f"ok  {fn.__name__}")
    print(f"\n{len(fns)} passed")
