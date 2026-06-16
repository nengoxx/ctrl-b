"""Phase 7e-d-1 — file memory read path (`FileMemoryProvider.load_context` + `_assemble` injection).

Exercises the read path only (the `memory` tool + Conf panel are 7e-d-2/7e-d-3): the saved files are
injected as their own `system` message, after the prompt appends and before the roster (D15 #4), with
Hermes-style usage headers, and the toggles/caps behave.

What's exercised:
  1. Inject order  — MEMORY.md → a `system` message right after the base, before any roster.
  2. Usage header  — the section header shows chars/cap and a percentage.
  3. User profile   — USER.md is a second section; agent memory leads.
  4. Profile toggle — `memory.user_profile_enabled=False` drops USER.md, keeps agent memory.
  5. Master switch  — `memory.enabled=False` injects nothing even with files present.
  6. Empty          — no files → no memory message at all.
  7. Per-agent      — a specialist reads its own `agents/<slug>/memories/MEMORY.md`, isolated from root.

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


def _write(p: Path, text: str) -> None:
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(text, encoding="utf-8")


def _session(c, agent_name: str | None = None):
    """Mirror `api.agent._session`, including the memory provider (the seam under test)."""
    from app.services.agent.session import AgentSession

    s = c.app.state
    return AgentSession(
        s.threads, s.messages, s.inference, s.settings, s.actions,
        s.settings.resolve_agent(agent_name),
        skills=getattr(s, "skills", None),
        selector=getattr(s, "skill_selector", None),
        memory=getattr(s, "memory", None),
    )


def _make_thread(c):
    from app.domain.conversation import Message, TextPart, Thread
    from app.domain.enums import Actor

    async def go():
        t = await c.app.state.threads.create(Thread())
        await c.app.state.messages.add(
            Message(thread_id=t.id, role="user", actor=Actor.USER, parts=[TextPart(text="hi")])
        )
        return t

    return asyncio.get_event_loop().run_until_complete(go())


def _systems(messages: list[dict]) -> list[str]:
    out: list[str] = []
    for m in messages:
        if m["role"] != "system":
            break
        out.append(m["content"])
    return out


def _assemble(c, thread, agent_name: str | None = None) -> list[dict]:
    return asyncio.get_event_loop().run_until_complete(_session(c, agent_name)._assemble(thread))


def test_memory_injected_after_base_with_usage_header() -> None:
    with _workspace() as (tmp, _cfg):
        with _client() as c:
            from app.services.agent.session import DEFAULT_SYSTEM_PROMPT

            _write(tmp / "memories" / "MEMORY.md", "Owner prefers dark mode.")
            thread = _make_thread(c)
            systems = _systems(_assemble(c, thread))
            assert systems[0] == DEFAULT_SYSTEM_PROMPT
            assert len(systems) == 2  # base + memory (no roster — no hosts)
            block = systems[1]
            assert "Owner prefers dark mode." in block
            # header: chars/cap + percentage (24 chars vs 2200 cap → 1%)
            assert "## Agent memory (1% — 24/2,200)" in block


def test_user_profile_is_second_section() -> None:
    with _workspace() as (tmp, _cfg):
        with _client() as c:
            _write(tmp / "memories" / "MEMORY.md", "agent note")
            _write(tmp / "memories" / "USER.md", "owner is on Android")
            block = _systems(_assemble(c, _make_thread(c)))[1]
            assert "## Agent memory" in block and "## User profile" in block
            assert block.index("## Agent memory") < block.index("## User profile")
            assert "owner is on Android" in block


def test_user_profile_disabled_drops_user_keeps_agent() -> None:
    with _workspace() as (tmp, _cfg):
        with _client() as c:
            _write(tmp / "memories" / "MEMORY.md", "agent note")
            _write(tmp / "memories" / "USER.md", "owner profile")
            assert c.put("/api/settings", json={"memory": {"user_profile_enabled": False}}).status_code == 200
            block = _systems(_assemble(c, _make_thread(c)))[1]
            assert "## Agent memory" in block
            assert "User profile" not in block and "owner profile" not in block


def test_master_switch_off_injects_nothing() -> None:
    with _workspace() as (tmp, _cfg):
        with _client() as c:
            from app.services.agent.session import DEFAULT_SYSTEM_PROMPT

            _write(tmp / "memories" / "MEMORY.md", "agent note")
            assert c.put("/api/settings", json={"memory": {"enabled": False}}).status_code == 200
            assert _systems(_assemble(c, _make_thread(c))) == [DEFAULT_SYSTEM_PROMPT]


def test_no_files_no_memory_block() -> None:
    with _workspace():
        with _client() as c:
            from app.services.agent.session import DEFAULT_SYSTEM_PROMPT

            assert _systems(_assemble(c, _make_thread(c))) == [DEFAULT_SYSTEM_PROMPT]


def test_specialist_memory_is_isolated_from_root() -> None:
    with _workspace() as (tmp, _cfg):
        with _client() as c:
            assert c.put("/api/agents/coder", json={"agent": {}}).status_code == 200  # scaffold folder
            _write(tmp / "memories" / "MEMORY.md", "ROOT note")
            _write(tmp / "agents" / "coder" / "memories" / "MEMORY.md", "CODER note")
            thread = _make_thread(c)

            coder = _systems(_assemble(c, thread, "coder"))[1]
            assert "CODER note" in coder and "ROOT note" not in coder

            root = _systems(_assemble(c, thread))[1]
            assert "ROOT note" in root and "CODER note" not in root


if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    for fn in fns:
        fn()
        print(f"ok  {fn.__name__}")
    print(f"\n{len(fns)} passed")
