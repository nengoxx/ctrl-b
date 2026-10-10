"""D84 / Phase 27 S2b — conversations per agent: the agents side (CONVERSATIONS_PLAN §4, §10 "S2").

  1. Roster status (R25) — `GET /api/agents` gives each `summaries[<name>]` (the root under `"default"`)
     a `status: {running, awaiting, unread}` = the OR over that agent's NON-archived conversations,
     computed through `ThreadRepo.summaries`; an agent with no conversations is all-False;
  2. R40 / F2 (reading A) — a RESPONDER answering in another agent's conversation runs on the HOME
     agent's AgentDef `model` + `privilege` (an explicit `privilege` override wins), keeps its own tools;
     the home answering, a thread-less build and an automation run are untouched;
  3. `DELETE /api/agents/{name}?conversations=true` (F6, M1) — the guard pass (409 `busy`, nothing
     deleted, every marker released), ONE transaction for the rows THEN the filesystem, every
     filesystem failure surfaced, the idempotent re-runs, the absent-folder memory recovery, the boot
     sweep reclaiming an attachment dir the cascade could not remove; without the flag, today's route.

The loop is a scripted `_drive` (no model); every case runs on a temp `$CTRLB_HOME`.
"""

from __future__ import annotations

import os
import shutil
import time
from datetime import UTC, datetime
from pathlib import Path

import pytest
from _async import run_async
from test_threads_a15_routes import _chat, _client, _msgs, _say, _thread

from app.domain.conversation import Message, ToolCallPart
from app.domain.enums import Actor, Privilege, RunState

T0 = datetime(2026, 10, 1, 12, 0, tzinfo=UTC)
ALL_FALSE = {"running": False, "awaiting": False, "unread": False}

LYN = "model:\n  model: lyn-model\nprivilege: auto_low\n"
EMMA = "model:\n  model: emma-model\nprivilege: readonly\ntools: [ping_host]\n"


def _status(c) -> dict[str, dict[str, bool]]:
    r = c.get("/api/agents")
    assert r.status_code == 200, r.text
    return {name: summary["status"] for name, summary in r.json()["summaries"].items()}


def _parked(c, thread_id: str) -> None:
    m = Message(
        thread_id=thread_id,
        role="assistant",
        actor=Actor.AGENT,
        agent="nyx",
        parts=[
            ToolCallPart(call_id="c1", tool="question", args={"prompt": "?"}, state=RunState.AWAITING_CONFIRM)
        ],
        ts=T0,  # at the thread's `seen_at` — parked, not unread
    )
    run_async(c.app.state.messages.add(m))


# ── 1. roster status ───────────────────────────────────────────────────────────────────────────


def test_each_summary_carries_the_or_of_its_agents_conversations() -> None:
    import asyncio

    from app.services.agent.turns import release, reserve

    with _client(agents={"nyx": "", "lyn": "", "fresh": "", "old": ""}) as c:
        s = c.app.state
        _thread(c, agent="nyx", created_at=T0, updated_at=T0)  # a quiet one beside the flagged ones
        unread = _thread(c, agent="nyx", created_at=T0, updated_at=T0)
        _say(c, unread.id, "a reply the owner has not seen", agent="nyx")
        awaiting = _thread(c, agent="lyn", created_at=T0, updated_at=T0)
        _parked(c, awaiting.id)
        root = _thread(c, agent="default", created_at=T0, updated_at=T0)
        _say(c, root.id, "the root spoke")
        archived = _thread(c, agent="old", created_at=T0, updated_at=T0, archived=True)
        _say(c, archived.id, "an automation run's reply", agent="old")
        _parked(c, archived.id)

        status = _status(c)
        assert status["nyx"] == {"running": False, "awaiting": False, "unread": True}
        assert status["lyn"] == {"running": False, "awaiting": True, "unread": False}
        assert status["default"] == {"running": False, "awaiting": False, "unread": True}  # the root
        assert status["fresh"] == ALL_FALSE  # no conversations
        assert status["old"] == ALL_FALSE  # archived threads never count

        handle = reserve(s.turns, awaiting.id, "chat")
        try:

            async def _spin() -> None:
                handle.task = asyncio.get_running_loop().create_future()  # type: ignore[assignment]

            run_async(_spin())
            assert _status(c)["lyn"] == {"running": True, "awaiting": True, "unread": False}
            assert _status(c)["nyx"]["running"] is False
        finally:
            release(s.turns, handle)
        assert _status(c)["lyn"]["running"] is False


def test_the_summary_fields_beside_status_are_unchanged() -> None:
    with _client(agents={"nyx": ""}) as c:
        body = c.get("/api/agents").json()
        assert body["agents"] == ["nyx"] and body["default"] == "default"
        for summary in body["summaries"].values():
            assert summary["status"] == ALL_FALSE
            assert "title" in summary  # the `_SUMMARY_FIELDS` stay where they were


# ── 2. R40 / F2 (reading A) ──────────────────────────────────────────────────────────────────────


def test_a_responder_runs_on_the_home_model_and_privilege_and_keeps_its_own_tools() -> None:
    from app.api.agent import _build_session

    with _client(agents={"lyn": LYN, "emma": EMMA}) as c:
        s = c.app.state
        home = _thread(c, agent="lyn")
        agent = _build_session(s, home, agent_name="emma")._agent
        assert agent.name == "emma"
        assert agent.model.model == "lyn-model" and agent.privilege == Privilege.AUTO_LOW
        assert agent.tools == ["ping_host"]  # the responder's own — only model + privilege inherit
        own = s.settings.resolve_agent("emma")
        assert agent.model_dump(exclude={"model", "privilege"}) == own.model_dump(
            exclude={"model", "privilege"}
        )

        # an explicit session override still wins on a responder turn — the home's model stays
        agent = _build_session(s, home, agent_name="emma", privilege=Privilege.FULL)._agent
        assert agent.privilege == Privilege.FULL and agent.model.model == "lyn-model"


@pytest.mark.parametrize("configured", ["nyx", ""])
def test_a_responder_in_a_conversation_whose_home_folder_is_gone(configured: str) -> None:
    """The home folds by ISS-51's rungs — the configured default, else the root — and the responder
    runs on THAT fallback's `model` + `privilege`, keeping its own tools."""
    from app.api.agent import _build_session

    nyx = "model:\n  model: nyx-model\nprivilege: full\n"
    config = f"server:\n  port: 5433\nagent:\n  default_agent: '{configured}'\n"
    with _client(config, agents={"lyn": LYN, "emma": EMMA, "nyx": nyx}) as c:
        s = c.app.state
        home = _thread(c, agent="lyn")
        shutil.rmtree(s.settings.agents_dir_path() / "lyn")
        fallback = s.settings.resolve_agent("nyx" if configured else "default")
        assert s.settings.resolve_agent("lyn").name == fallback.name
        agent = _build_session(s, home, agent_name="emma")._agent
        assert agent.name == "emma" and agent.tools == ["ping_host"]
        assert agent.model == fallback.model and agent.privilege == fallback.privilege
        if configured:
            assert agent.model.model == "nyx-model" and agent.privilege == Privilege.FULL


def test_the_home_answering_and_a_thread_less_build_are_untouched() -> None:
    from app.api.agent import _build_session

    with _client(agents={"lyn": LYN, "emma": EMMA}) as c:
        s = c.app.state
        home = _thread(c, agent="lyn")
        lyn = s.settings.resolve_agent("lyn").model_dump()
        assert _build_session(s, home)._agent.model_dump() == lyn
        assert _build_session(s, home, agent_name="lyn")._agent.model_dump() == lyn
        emma = s.settings.resolve_agent("emma").model_dump()
        assert _build_session(s, None, agent_name="emma")._agent.model_dump() == emma
        # the explicit override on the home is today's `resolve_session_agent`, nothing more
        agent = _build_session(s, home, privilege=Privilege.READONLY)._agent
        assert agent.model_dump() == {**lyn, "privilege": Privilege.READONLY}


def test_an_automation_run_keeps_the_agent_it_was_authorized_for() -> None:
    from test_automations_14b import _snapshot

    from app.api.agent import _build_session

    with _client(agents={"lyn": LYN, "emma": EMMA}) as c:
        s = c.app.state
        rolling = _thread(c, agent="lyn", archived=True)  # its automation was re-pointed to emma since
        agent = _build_session(
            s, rolling, agent_name="emma", automation=_snapshot(agent="emma", thread_mode="rolling")
        )._agent
        assert agent.model_dump() == s.settings.resolve_agent("emma").model_dump()


def test_a_chat_turn_by_a_responder_runs_on_the_home_values(monkeypatch) -> None:
    """The same rule through the route: `body.agent` answers in lyn's conversation on lyn's model +
    privilege; the explicit `privilege` on the body wins over the home's."""
    from app.services.agent.session import AgentEvent, AgentSession

    seen: list[tuple[str, str | None, Privilege]] = []

    async def _drive(self, thread, *, mode=None, **kw):
        seen.append((self._agent.name, self._agent.model.model, self._agent.privilege))
        yield AgentEvent("done", {"threadId": thread.id, "state": "completed"})

    monkeypatch.setattr(AgentSession, "_drive", _drive)
    with _client(agents={"lyn": LYN, "emma": EMMA}) as c:
        home = _thread(c, agent="lyn")
        assert _chat(c, thread_id=home.id, agent="emma").status_code == 200
        assert _chat(c, thread_id=home.id, agent="emma", privilege="full").status_code == 200
        assert _chat(c, thread_id=home.id).status_code == 200
    assert seen == [
        ("emma", "lyn-model", Privilege.AUTO_LOW),
        ("emma", "lyn-model", Privilege.FULL),
        ("lyn", "lyn-model", Privilege.AUTO_LOW),
    ]


# ── 3. the agent delete cascade ──────────────────────────────────────────────────────────────────


def _memory(c, name: str = "nyx") -> Path:
    d = c.app.state.settings.memories_dir_path() / "agents" / name
    d.mkdir(parents=True, exist_ok=True)
    (d / "MEMORY.md").write_text("- met the owner\n", encoding="utf-8")
    return d


def _attachment_dir(c, thread_id: str) -> Path:
    from app.core.attachments import attachments_root

    d = attachments_root(c.app.state.settings.home_dir()) / thread_id
    d.mkdir(parents=True)
    (d / "photo.png").write_bytes(b"\x89PNG")
    return d


def _folder(c, name: str = "nyx") -> Path:
    return c.app.state.settings.agents_dir_path() / name


def _gone(c, thread_id: str) -> bool:
    return run_async(c.app.state.threads.get(thread_id)) is None


def test_the_flag_deletes_the_conversations_then_the_agent() -> None:
    from app.services.agent.routing import routing_state_for

    with _client(agents={"nyx": "", "lyn": ""}) as c:
        s = c.app.state
        a = _thread(c, agent="nyx")
        b = _thread(c, agent="nyx")
        _say(c, a.id, "q", role="user")
        _say(c, a.id, "a", agent="nyx")
        photos = _attachment_dir(c, a.id)
        routing_state_for(s, a.id).fallback_remaining = 2
        run = _thread(c, agent="nyx", archived=True)  # an automation's run thread — not a conversation
        other = _thread(c, agent="lyn")
        memory = _memory(c)

        r = c.delete("/api/agents/nyx", params={"conversations": "true"})
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["deleted"] == 2
        assert (body["folder"], body["memory"], body["attachments"]) == ("ok", "ok", "ok")
        assert body["name"] == "nyx" and body["removed"] == ["agents/nyx", "memories/agents/nyx"]
        assert body["kept"] == {"books": [], "art": [], "memory": []}
        assert body["broken"] == {"automations": []}
        assert _gone(c, a.id) and _gone(c, b.id) and _msgs(c, a.id) == []
        assert not photos.exists() and not memory.exists() and not _folder(c).exists()
        assert a.id not in s.routing_state
        assert not _gone(c, run.id)  # archived history homed here survives, and `deleted` never counted it
        assert not _gone(c, other.id)
        assert not s.turns  # every marker released


def test_a_busy_conversation_refuses_the_whole_cascade_and_releases_every_marker() -> None:
    from app.services.agent.turns import release, reserve

    with _client(agents={"nyx": ""}) as c:
        s = c.app.state
        idle = [_thread(c, agent="nyx") for _ in range(3)]
        busy = _thread(c, agent="nyx")
        handle = reserve(s.turns, busy.id, "chat")
        try:
            r = c.delete("/api/agents/nyx", params={"conversations": "true"})
            assert r.status_code == 409
            assert r.json() == {
                "detail": "1 of nyx's conversations are busy — nothing was deleted",
                "busy": 1,
            }
            assert set(s.turns) == {busy.id}  # only the running turn's own marker remains
        finally:
            release(s.turns, handle)
        assert not any(_gone(c, t.id) for t in [*idle, busy]) and _folder(c).is_dir()
        assert c.delete(f"/api/threads/{idle[0].id}").status_code == 200  # nothing left reserved


def test_an_automations_rolling_conversation_never_blocks_the_cascade_and_is_named_broken() -> None:
    """The rolling conversation is BORN archived (the runner), so the guard pass — exactly the rows the
    cascade deletes — never reaches it: it survives, the cascade proceeds, and `broken.automations`
    names its automation, as without the flag (a guard would 409 forever once the automation is
    re-pointed elsewhere, since a home never moves — Opus N1)."""
    with _client(agents={"nyx": ""}) as c:
        s = c.app.state
        owned = _thread(c, agent="nyx", archived=True)
        free = _thread(c, agent="nyx")

        class _Auto:
            name = "auto-1"
            agent = "nyx"

        class _Owned:
            async def rolling_owner(self, thread_id):
                return "auto-1" if thread_id == owned.id else None

            async def list(self):
                return [_Auto()]

        s.automations = _Owned()
        r = c.delete("/api/agents/nyx", params={"conversations": "true"})
        assert r.status_code == 200
        body = r.json()
        assert body["deleted"] == 1 and body["broken"] == {"automations": ["auto-1"]}
        assert not _gone(c, owned.id) and _gone(c, free.id) and not s.turns


def test_a_folder_failure_is_surfaced_after_the_rows_went_and_a_rerun_finishes(monkeypatch) -> None:
    from app.api import agent as agent_api

    real = shutil.rmtree
    with _client(agents={"nyx": ""}) as c:
        a = _thread(c, agent="nyx")
        memory = _memory(c)
        folder = _folder(c)

        def _refuse(path, *args, **kw):
            if Path(path) == folder:
                raise PermissionError("the folder is locked")
            return real(path, *args, **kw)

        monkeypatch.setattr(agent_api.shutil, "rmtree", _refuse)
        body = c.delete("/api/agents/nyx", params={"conversations": "true"}).json()
        assert body["deleted"] == 1 and body["folder"] == "the folder is locked"
        assert body["memory"].startswith("skipped") and body["attachments"] == "ok"
        assert _gone(c, a.id)  # the transaction committed BEFORE the filesystem step
        assert folder.is_dir() and memory.is_dir()
        monkeypatch.setattr(agent_api.shutil, "rmtree", real)

        body = c.delete("/api/agents/nyx", params={"conversations": "true"}).json()
        assert (body["deleted"], body["folder"], body["memory"]) == (0, "ok", "ok")
        assert not folder.exists() and not memory.exists()

        body = c.delete("/api/agents/nyx", params={"conversations": "true"}).json()
        assert (body["deleted"], body["folder"], body["memory"]) == (0, "absent", "absent")
        assert body["removed"] == [] and not c.app.state.turns


def test_an_absent_folder_still_clears_the_default_memory_dir() -> None:
    with _client() as c:
        memory = _memory(c, "ghost")  # the folder went, its memory removal did not (M1)
        body = c.delete("/api/agents/ghost", params={"conversations": "true"}).json()
        assert (body["deleted"], body["folder"], body["memory"]) == (0, "absent", "ok")
        assert body["removed"] == ["memories/agents/ghost"] and not memory.exists()


def test_a_memory_failure_is_surfaced_after_the_folder_went(monkeypatch) -> None:
    from app.api import agent as agent_api

    real = shutil.rmtree
    with _client(agents={"nyx": ""}) as c:
        a = _thread(c, agent="nyx")
        memory = _memory(c)

        def _refuse(path, *args, **kw):
            if Path(path) == memory:
                raise PermissionError("the memory dir is locked")
            return real(path, *args, **kw)

        monkeypatch.setattr(agent_api.shutil, "rmtree", _refuse)
        body = c.delete("/api/agents/nyx", params={"conversations": "true"}).json()
        assert (body["deleted"], body["folder"], body["memory"]) == (1, "ok", "the memory dir is locked")
        assert _gone(c, a.id) and not _folder(c).exists() and memory.is_dir()
        assert body["removed"] == ["agents/nyx"]


def test_a_custom_memory_dir_is_kept_and_answered_kept() -> None:
    with _client(agents={"nyx": "memory_dir: shared/nyx\n"}) as c:
        shared = c.app.state.settings.memories_dir_path() / "shared" / "nyx"
        shared.mkdir(parents=True)
        body = c.delete("/api/agents/nyx", params={"conversations": "true"}).json()
        assert (body["folder"], body["memory"]) == ("ok", "kept")
        assert body["kept"]["memory"] == ["memories/shared/nyx"] and shared.is_dir()


def test_a_failing_transaction_deletes_nothing_and_releases_every_marker(monkeypatch) -> None:
    from app.services.conversation import ThreadRepo

    async def _boom(self, ids):
        raise RuntimeError("the database is gone")

    monkeypatch.setattr(ThreadRepo, "delete_many", _boom)
    with _client(agents={"nyx": ""}) as c:  # TestClient re-raises a server exception
        threads = [_thread(c, agent="nyx") for _ in range(2)]
        photos = _attachment_dir(c, threads[0].id)
        memory = _memory(c)
        with pytest.raises(RuntimeError, match="the database is gone"):
            c.delete("/api/agents/nyx", params={"conversations": "true"})
        assert not c.app.state.turns  # every marker released
        assert not any(_gone(c, t.id) for t in threads)
        assert _folder(c).is_dir() and memory.is_dir() and photos.is_dir()  # the filesystem untouched


def test_an_attachment_failure_is_surfaced_and_the_boot_sweep_reclaims_the_dir(monkeypatch) -> None:
    """The REAL `remove_thread_attachments`, failing at the filesystem op: the suppressed OSError is
    surfaced, never an `"ok"` with the bytes left behind."""
    import errno

    from fastapi.testclient import TestClient

    from app.main import create_app

    real_unlink = Path.unlink
    with _client(agents={"nyx": ""}) as c:
        a = _thread(c, agent="nyx")
        photos = _attachment_dir(c, a.id)

        def _refuse(self, *args, **kw):
            if self == photos / "photo.png":
                raise PermissionError(errno.EACCES, "Permission denied")
            return real_unlink(self, *args, **kw)

        with monkeypatch.context() as m:
            m.setattr(Path, "unlink", _refuse)
            body = c.delete("/api/agents/nyx", params={"conversations": "true"}).json()
        assert body["deleted"] == 1
        assert body["attachments"].startswith("photo.png: Permission denied")  # then the rmdir's ENOTEMPTY
        assert body["folder"] == "ok" and _gone(c, a.id) and (photos / "photo.png").is_file()

        old = time.time() - 2 * c.app.state.settings.attachments.staging_orphan_s
        os.utime(photos / "photo.png", (old, old))
        with TestClient(create_app()):  # the next boot — its lifespan runs the attachment sweep
            pass
        assert not photos.exists()  # the rowless dir's arm reclaimed it


def test_without_the_flag_the_route_is_todays() -> None:
    with _client(agents={"nyx": ""}) as c:
        a = _thread(c, agent="nyx")
        r = c.delete("/api/agents/nyx")
        assert r.status_code == 200
        assert r.json() == {
            "name": "nyx",
            "deleted": True,
            "removed": ["agents/nyx"],
            "kept": {"books": [], "art": [], "memory": []},
            "broken": {"automations": []},
        }
        assert not _gone(c, a.id)  # the conversation stays …
        assert c.get("/api/threads", params={"agent": "nyx"}).json() == []  # … listed nowhere (M7)
        assert c.delete("/api/agents/nyx").status_code == 404  # an absent folder still 404s
        assert c.delete("/api/agents/default", params={"conversations": "true"}).status_code == 422
