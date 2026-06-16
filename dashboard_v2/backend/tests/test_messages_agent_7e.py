"""Phase 7e-c — per-turn agent attribution (`messages.agent`, D15 #5).

Covers the additive column end-to-end without driving the model (the loop's streaming is out of
scope for a unit test): the migration applied, the repo round-trips the new field, the restore API
exposes it, and the resume endpoint resolves the **last assistant turn's agent** (explicit → last
assistant `agent` → thread.agent → default).

What's exercised:
  1. Migration   — schema is at version ≥ 2 and the column round-trips (assistant set, user NULL).
  2. Restore API — `GET /threads/{id}/messages` carries `agent` per message.
  3. Resume order— resume resolves the last assistant message's agent, over `thread.agent`.
  4. Resume tail — the *latest* assistant agent wins when a thread switched mid-conversation.
  5. Resume base — no assistant agent yet → resolution falls through (agent_name None → thread/default).

Each test runs in an isolated `$CTRLB_HOME` temp workspace; the real config/db are never touched.
"""

from __future__ import annotations

import asyncio
import contextlib
import os
import tempfile
from pathlib import Path


def _client():
    from fastapi.testclient import TestClient

    from app.main import create_app

    return TestClient(create_app())


@contextlib.contextmanager
def _workspace(config_text: str = "server:\n  port: 5433\n"):
    """An isolated `$CTRLB_HOME` temp workspace (config + db all under it)."""
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
    return asyncio.get_event_loop().run_until_complete(coro)


async def _thread(c, agent: str | None = None):
    from app.domain.conversation import Thread

    return await c.app.state.threads.create(Thread(agent=agent))


async def _add(c, thread_id: str, role: str, *, agent: str | None = None, text: str = "x"):
    """Add one message straight through the repo (no model), with an optional `agent` stamp."""
    from app.domain.conversation import Message, TextPart
    from app.domain.enums import Actor

    actor = Actor.AGENT if role == "assistant" else Actor.USER
    await c.app.state.messages.add(
        Message(thread_id=thread_id, role=role, actor=actor, agent=agent, parts=[TextPart(text=text)])
    )


def test_migration_and_column_round_trip() -> None:
    """The migration applied (schema ≥ 2) and the column round-trips: an assistant turn keeps its
    agent, a user turn stays NULL (the default)."""
    with _workspace():
        with _client() as c:
            async def go():
                s = c.app.state
                assert await s.db.schema_version() >= 2
                t = await _thread(c)
                await _add(c, t.id, "user", text="hi")
                await _add(c, t.id, "assistant", agent="coder", text="yo")
                return await s.messages.list(t.id)

            msgs = _run(go())
            assert [m.agent for m in msgs] == [None, "coder"]


def test_restore_api_exposes_agent() -> None:
    """`GET /threads/{id}/messages` (the restore path) surfaces `agent` so the UI can attribute each
    turn after a reload — the spec's core requirement."""
    with _workspace():
        with _client() as c:
            t = _run(_thread(c))
            _run(_add(c, t.id, "user", text="hi"))
            _run(_add(c, t.id, "assistant", agent="writer", text="hello"))

            body = c.get(f"/api/threads/{t.id}/messages").json()
            assert [m["agent"] for m in body] == [None, "writer"]


@contextlib.contextmanager
def _capture_session(agent_api):
    """Spy on `api.agent._session` to capture the `agent_name` the resume endpoint resolves with,
    without driving the loop. resume() bails fast on a bogus call_id (no pending confirm → it yields
    an error + done and returns, never calling the model), so this isolates just the resolution."""
    captured: dict[str, str | None] = {}
    orig = agent_api._session

    def spy(request, thread=None, agent_name=None):
        captured["agent_name"] = agent_name
        return orig(request, thread, agent_name)

    agent_api._session = spy
    try:
        yield captured
    finally:
        agent_api._session = orig


def _resume_agent_name(c, thread_id: str) -> str | None:
    """POST a resume with a non-existent call_id and return the agent_name the endpoint resolved.
    The resume errors out gracefully (nothing pending) — we only assert the resolution that ran
    before that."""
    import app.api.agent as agent_api

    with _capture_session(agent_api) as captured:
        r = c.post(
            "/api/agent/resume",
            json={"thread_id": thread_id, "call_id": "nope", "decision": "dismiss"},
        )
        assert r.status_code == 200, r.text
    return captured.get("agent_name")


def test_resume_prefers_last_assistant_agent_over_thread() -> None:
    """Resume continues as the last assistant turn's agent even when `thread.agent` differs — a
    thread keeps talking to the specialist you last used (D15 #5)."""
    with _workspace():
        with _client() as c:
            t = _run(_thread(c, agent="default"))
            _run(_add(c, t.id, "user", text="hi"))
            _run(_add(c, t.id, "assistant", agent="coder", text="on it"))
            assert _resume_agent_name(c, t.id) == "coder"


def test_resume_uses_latest_assistant_agent_after_switch() -> None:
    """When a thread switched agents mid-conversation, the *latest* assistant turn's agent wins."""
    with _workspace():
        with _client() as c:
            t = _run(_thread(c))
            _run(_add(c, t.id, "assistant", agent="coder", text="a"))
            _run(_add(c, t.id, "user", text="now you"))
            _run(_add(c, t.id, "assistant", agent="writer", text="b"))
            assert _resume_agent_name(c, t.id) == "writer"


def test_resume_falls_through_when_no_assistant_agent() -> None:
    """No assistant turn has an agent yet (only a user message) → no override; the resolution falls
    through to thread.agent / default (agent_name resolved as None)."""
    with _workspace():
        with _client() as c:
            t = _run(_thread(c))
            _run(_add(c, t.id, "user", text="hi"))
            assert _resume_agent_name(c, t.id) is None


if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    for fn in fns:
        fn()
        print(f"ok  {fn.__name__}")
    print(f"\n{len(fns)} passed")
