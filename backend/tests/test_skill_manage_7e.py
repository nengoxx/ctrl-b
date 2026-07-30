"""Phase 7e-f-2 — the `skill_manage` self-author tool (+ the shared skill-file helpers).

Drives the tool through the real `ActionService` (gating, the `skills_auto_write` kill switch's
propose-only mode, slug/empty-body ERRORs, audit Event) and confirms it writes to the *agent's own*
skills folder — the global `skills/` for the default agent, `agents/<slug>/skills/` for a specialist
(the same roots `available_skills` reads). The de-dup'd `/api/skills` editor path is covered by the
existing 7d skills tests; here we check the tool + the per-agent root resolution.

What's exercised:
  1. save        — OK result, SKILL.md written under the global skills dir, an audit Event recorded.
  2. remove      — deletes the file (and empty folder); OK result.
  3. propose     — skills_auto_write off → OK "proposed" result with data["proposed"], nothing written.
  4. master off  — agent.skills_enabled off → DENIED.
  5. bad slug    — an unsafe name → ERROR (not a crash, not a write).
  6. empty save  — save with blank content → ERROR.
  7. missing rm  — remove a non-existent skill → ERROR.
  8. specialist  — a specialist writes agents/<slug>/skills/, the global dir untouched.

Each test runs in an isolated `$CTRLB_HOME` temp workspace; the real config/skills are never touched.
"""

from __future__ import annotations

import contextlib
import os
import tempfile
from pathlib import Path

from _async import run_async

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
        yield tmp, cfg
    finally:
        for k in ("CTRLB_HOME", "CTRLB_CONFIG", "CTRLB_DB"):
            os.environ.pop(k, None)


def _run(coro):
    return run_async(coro)


def _agent(c, name: str | None = None):
    return c.app.state.settings.resolve_agent(name)


def _invoke(c, args: dict, *, agent_name: str | None = None):
    from app.domain.enums import Actor, Privilege

    return _run(
        c.app.state.actions.invoke(
            "skill_manage",
            args,
            origin=ORIGIN_USER_CHAT,
            actor=Actor.AGENT,
            privilege=Privilege.CONFIRM,
            agent=_agent(c, agent_name),
        )
    )


_BODY = "---\nname: triage\ndescription: triage a host\n---\n\nDo the triage.\n"


def test_save_writes_and_audits() -> None:
    from app.domain.enums import RunState

    with _workspace() as (tmp, _cfg):
        with _client() as c:
            out = _invoke(c, {"action": "save", "name": "triage", "content": _BODY})
            assert out.result.state == RunState.OK
            md = tmp / "skills" / "triage" / "SKILL.md"
            assert md.read_text(encoding="utf-8").strip() == _BODY.strip()
            assert out.event is not None and out.event.action == "skill_manage"  # auto-audited


def test_remove_deletes_file_and_folder() -> None:
    from app.domain.enums import RunState

    with _workspace() as (tmp, _cfg):
        with _client() as c:
            _invoke(c, {"action": "save", "name": "triage", "content": _BODY})
            out = _invoke(c, {"action": "remove", "name": "triage"})
            assert out.result.state == RunState.OK
            assert not (tmp / "skills" / "triage").exists()  # empty folder cleaned up


def test_auto_write_off_proposes_without_writing() -> None:
    from app.domain.enums import RunState

    with _workspace() as (tmp, _cfg):
        with _client() as c:
            c.app.state.settings.agent.skills_auto_write = False
            out = _invoke(c, {"action": "save", "name": "triage", "content": _BODY})
            assert out.result.state == RunState.OK
            assert "proposed" in out.result.summary
            assert out.result.data["proposed"]["name"] == "triage"
            assert not (tmp / "skills" / "triage").exists()  # nothing written


def test_master_switch_off_denies() -> None:
    from app.domain.enums import RunState

    with _workspace():
        with _client() as c:
            c.app.state.settings.agent.skills_enabled = False
            out = _invoke(c, {"action": "save", "name": "triage", "content": _BODY})
            assert out.result.state == RunState.DENIED


def test_bad_slug_errors_without_writing() -> None:
    from app.domain.enums import RunState

    with _workspace() as (tmp, _cfg):
        with _client() as c:
            out = _invoke(c, {"action": "save", "name": "Bad Name", "content": _BODY})
            assert out.result.state == RunState.ERROR
            assert not (tmp / "skills").exists()


def test_empty_save_errors() -> None:
    from app.domain.enums import RunState

    with _workspace():
        with _client() as c:
            out = _invoke(c, {"action": "save", "name": "triage", "content": "   "})
            assert out.result.state == RunState.ERROR


def test_remove_missing_errors() -> None:
    from app.domain.enums import RunState

    with _workspace():
        with _client() as c:
            out = _invoke(c, {"action": "remove", "name": "nope"})
            assert out.result.state == RunState.ERROR


def test_specialist_writes_own_folder() -> None:
    from app.domain.enums import RunState

    with _workspace() as (tmp, _cfg):
        with _client() as c:
            assert c.put("/api/agents/coder", json={"agent": {}}).status_code == 200
            out = _invoke(c, {"action": "save", "name": "triage", "content": _BODY}, agent_name="coder")
            assert out.result.state == RunState.OK
            assert (tmp / "agents" / "coder" / "skills" / "triage" / "SKILL.md").is_file()
            assert not (tmp / "skills" / "triage").exists()  # global dir untouched


if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    for fn in fns:
        fn()
        print(f"ok  {fn.__name__}")
    print(f"\n{len(fns)} passed")
