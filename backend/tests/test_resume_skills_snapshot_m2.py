"""Phase 18 Slice 0 · M2 (PROMPTS_PLAN §6 C-12) — the SERVER owns the suspended turn's skill set.

C5-M1 carried a turn's active skills across a resume, but only in frontend module state: the turn
snapshot had no skill path, so a client that reloaded before resolving the bubble fell back to
`turnSkills` — empty, or belonging to a LATER turn — and the resumed half continued on a broader
toolset than the owner confirmed against. The skills now ride the suspend event (so the accumulator
snapshot pins them under that call id, and `overlaySyncCall` can re-seed the client), the terminal
cache carries them past the turn's end, and `/agent/resume` prefers that pin over the client payload.

The chain is walked here exactly as production walks it: `_activate_skills` → the suspend event →
`TurnAccumulator.fold`/`snapshot` → `record_terminal` → `_resume_skills` → a fresh session's
`resume(...)`. Harness mirrors `test_resume_skills_c5m1.py`, whose contract this extends.
"""

from __future__ import annotations

import contextlib
import os
import tempfile
import uuid
from pathlib import Path

from _async import drain_run_calls, run_async


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


def _guard():
    from app.services.agent.session import _LoopGuard

    return _LoopGuard(max_repeat=5, max_per_tool=10)


async def _drain(agen):
    return [e async for e in agen]


def _write_skill(root: Path, name: str, allowed_tools: list[str]) -> None:
    d = root / name
    d.mkdir(parents=True, exist_ok=True)
    at = f"\nallowed_tools: [{', '.join(allowed_tools)}]" if allowed_tools else ""
    (d / "SKILL.md").write_text(
        f"---\nname: {name}\ndescription: reboot a host for a release{at}\n---\nReboot carefully.\n",
        encoding="utf-8",
    )


def _session(c):
    from app.services.agent.session import AgentSession

    s = c.app.state
    return AgentSession(
        s.threads,
        s.messages,
        s.inference,
        s.settings,
        s.actions,
        s.settings.resolve_agent(None),
        skills=s.skills,
        selector=s.skill_selector,
        interactive=True,
    )


def _suspend_under_skill(c, session):
    """Run one confirm-gated `reboot_host` call on a turn whose skill the SELECTOR chose (the client
    invoked nothing), and return `(thread, call_id, the tool.permission event)`."""
    from app.domain.conversation import Message, Thread, ToolCallPart
    from app.domain.enums import Actor, RunState

    s = c.app.state
    session._activate_skills("please reboot a host for a release", None)  # select=True — the selector picks
    thread = run_async(s.threads.create(Thread()))
    cid = uuid.uuid4().hex
    assistant = Message(
        thread_id=thread.id,
        role="assistant",
        actor=Actor.AGENT,
        agent="default",
        parts=[
            ToolCallPart(call_id=cid, tool="reboot_host", args={"host_id": "nope"}, state=RunState.PENDING)
        ],
    )
    run_async(s.messages.add(assistant))
    events, suspended, _ = drain_run_calls(session, thread, assistant, {}, _guard())
    assert suspended
    return thread, cid, next(ev for ev in events if ev.event == "tool.permission")


def _terminal(c, thread_id: str, *events):
    """Fold one turn's events exactly as the drain task does, then settle it into the terminal cache —
    i.e. the client is gone and only the server's own record remains."""
    from app.services.agent.turns import TurnHandle, record_terminal

    handle = TurnHandle(thread_id=thread_id, kind="chat")
    for event in events:
        handle.accumulator.fold(event)
    handle.terminal_status = "completed"
    record_terminal(
        c.app.state.turn_terminals,
        handle,
        linger_s=c.app.state.settings.agent.turns.linger_s,
        cap=c.app.state.settings.agent.turns.terminal_cache_cap,
    )
    return handle


def test_suspend_disconnect_resume_keeps_the_exact_skill_set() -> None:
    from app.api.agent import _resume_skills

    with _workspace(), _client() as c:
        _write_skill(c.app.state.settings.skills_dir_path(), "release", allowed_tools=["reboot_host"])
        session = _session(c)
        thread, cid, perm = _suspend_under_skill(c, session)
        # Captured right after selection — the selector's pick, which the client never asked for.
        assert session._active_skills == ["release"]
        assert perm.data["skills"] == ["release"]

        # The server-owned snapshot pins it under THIS call id (what a live re-attach replays) …
        handle = _terminal(c, thread.id, perm)
        snap = handle.accumulator.snapshot(mode=None, seq=1)
        assert snap["calls"][0]["permission"]["skills"] == ["release"]
        # … and the terminal-linger record carries it past the turn's end (what a resume reads).
        assert _resume_skills(c.app.state, thread.id, cid, []) == ["release"]

        # The resumed half therefore runs under EXACTLY the confirmed set, even though the reloaded
        # client sent nothing: the skill's instructions are injected and its narrowing still binds.
        resumed = _session(c)
        pinned = _resume_skills(c.app.state, thread.id, cid, [])
        run_async(_drain(resumed.resume(thread, cid, "dismiss", skills=pinned)))
        assert resumed._skills_note is not None and "release" in resumed._skills_note
        assert resumed._tool_allow == ["reboot_host"]
        names = {t.spec.name for t in c.app.state.actions.registry.for_agent(resumed._tool_allow)}
        assert "reboot_host" in names and "ping_host" not in names  # narrowed, core builtins aside


def test_a_later_turn_on_the_thread_does_not_erase_the_parked_pin() -> None:
    """The record is per-thread but a bubble outlives its turn: turn A suspends under a skill, turn B
    comes and goes on the same thread, and only THEN does the owner resolve A. B's record must carry
    A's still-unresolved pin forward — otherwise the resume silently broadens to the base toolset."""
    from app.api.agent import _resume_skills
    from app.services.agent.session import AgentEvent

    with _workspace(), _client() as c:
        _write_skill(c.app.state.settings.skills_dir_path(), "release", allowed_tools=["reboot_host"])
        thread, cid, perm = _suspend_under_skill(c, _session(c))
        _terminal(c, thread.id, perm)  # turn A ends suspended on `cid`
        # Turn B: an ordinary un-skilled turn that resolves its OWN call and ends.
        other = uuid.uuid4().hex
        _terminal(
            c,
            thread.id,
            AgentEvent("part.added", {"part": {"call_id": other, "tool": "ping_host", "args": {}}}),
            AgentEvent("tool.result", {"callId": other, "result": {"state": "ok"}}),
        )
        assert _resume_skills(c.app.state, thread.id, cid, []) == ["release"]

        # …and the carry-forward EXPIRES with the call: once a turn resolves the bubble, its pin goes.
        _terminal(c, thread.id, AgentEvent("tool.result", {"callId": cid, "result": {"state": "denied"}}))
        assert _resume_skills(c.app.state, thread.id, cid, []) == []


def test_server_pin_beats_a_client_payload_from_another_turn() -> None:
    """The failure M2 names: a later turn overwrote the client's module state. The pin wins anyway."""
    from app.api.agent import _resume_skills

    with _workspace(), _client() as c:
        _write_skill(c.app.state.settings.skills_dir_path(), "release", allowed_tools=["reboot_host"])
        session = _session(c)
        thread, cid, perm = _suspend_under_skill(c, session)
        _terminal(c, thread.id, perm)
        assert _resume_skills(c.app.state, thread.id, cid, ["some-later-turns-skill"]) == ["release"]


def test_without_a_pin_the_resume_falls_back_to_the_client() -> None:
    """No server record (the linger expired, or the process restarted) — the deliberately unbuilt
    persisted class. The resume proceeds on what the client still holds: nothing after a cold reload,
    i.e. the agent's base toolset."""
    from app.api.agent import _resume_skills

    with _workspace(), _client() as c:
        assert _resume_skills(c.app.state, "no-such-thread", "no-such-call", []) == []
        assert _resume_skills(c.app.state, "no-such-thread", "no-such-call", ["release"]) == ["release"]


def test_a_resolved_call_carries_no_pin() -> None:
    """The fold drops a suspend payload when its call resolves, so the terminal record only ever
    pins calls that are actually still awaiting the owner."""
    from app.services.agent.session import AgentEvent
    from app.services.agent.turns import TurnAccumulator

    acc = TurnAccumulator()
    acc.fold(AgentEvent("tool.permission", {"callId": "c1", "tool": "reboot_host", "skills": ["release"]}))
    assert acc.suspended_skills() == {"c1": ["release"]}
    acc.fold(AgentEvent("tool.result", {"callId": "c1", "result": {"state": "denied"}}))
    assert acc.suspended_skills() == {}


if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    for fn in fns:
        fn()
        print(f"ok  {fn.__name__}")
    print(f"\n{len(fns)} passed")
