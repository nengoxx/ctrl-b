"""Phase 7e-a — system-prompt append layer + show-the-baked-default tests.

Covers the additive axis without disturbing the existing replace axis. `_assemble` is exercised
directly through `AgentSession` (constructed from `app.state` deps) so we verify the actual
message order: **base → global append → per-agent append → roster → skills note → history**.

What's exercised:
  1. Baseline    — empty config → exactly one `system` message (the baked default).
  2. Global add  — `inference.system_prompt_append` → a 2nd `system` message after the base.
  3. Per-agent   — `AgentDef.prompt_append` on a configured agent → a 3rd message after global.
  4. Opt-out     — `inherit_append=False` on the agent → global is skipped (only per-agent).
  5. Replace+add — `inference.system_prompt` (replace) coexists with the append in the right slots.
  6. Whitespace  — a whitespace-only append is treated as empty (no extra `system` message).
  7. Clear       — clearing the global append via PUT="" falls back to no extra message.
  8. Built-in default agent picks up the global append (no `agents[]` configured at all).
  9. YAML        — multi-line append + the appendant comments survive a round-trip to disk
                   (the 7a ruamel writer preserves block style + comments).
 10. GET shape  — `/api/settings` reflects the new fields (so the editor can read+write them).
 11. Two agents — each AgentDef carries its own append; the right one is emitted per session.
 12. Endpoint   — `GET /api/agent/default-prompt` returns the baked text.

Writes go through `PUT /api/settings` on a **temp** config (audit E3); the real `config.yaml` is
never touched.
"""

from __future__ import annotations

import asyncio
import os
import tempfile
from pathlib import Path


def _client():
    from fastapi.testclient import TestClient

    from app.main import create_app

    return TestClient(create_app())


def _session(c, agent_name: str | None = None):
    """Mirror `api.agent._session` without going through a request — same deps, optionally a named
    agent so we can test a configured agent's `prompt_append` / `inherit_append`."""
    from app.services.agent.session import AgentSession

    s = c.app.state
    agent = s.settings.resolve_agent(agent_name)
    return AgentSession(
        s.threads, s.messages, s.inference, s.settings, s.actions, agent,
        skills=getattr(s, "skills", None),
        selector=getattr(s, "skill_selector", None),
    )


def _make_thread(c):
    """Create a thread with one user message so `_assemble` has *some* history (the new system
    messages live in front of it). Returns the Thread."""
    from app.domain.conversation import Message, TextPart, Thread
    from app.domain.enums import Actor

    s = c.app.state

    async def go():
        t = await s.threads.create(Thread())
        await s.messages.add(Message(
            thread_id=t.id, role="user", actor=Actor.USER, parts=[TextPart(text="hi")]
        ))
        return t

    return asyncio.get_event_loop().run_until_complete(go())


def _systems(messages: list[dict]) -> list[str]:
    """Return the leading run of `role=system` message contents — the ordered prefix of system
    blocks `_assemble` emits before any history. The order is what 7e-a's behaviour is about."""
    out: list[str] = []
    for m in messages:
        if m["role"] != "system":
            break
        out.append(m["content"])
    return out


def _assemble(c, thread, agent_name: str | None = None) -> list[dict]:
    return asyncio.get_event_loop().run_until_complete(_session(c, agent_name)._assemble(thread))


def test_prompt_append_round_trip() -> None:
    """The canonical happy path: each PUT shifts the system-message prefix as predicted, in order."""
    tmp = Path(tempfile.mkdtemp())
    cfg = tmp / "config.yaml"
    cfg.write_text("# homelab\nserver:\n  port: 5433\n", encoding="utf-8")
    os.environ["CTRLB_CONFIG"] = str(cfg)
    os.environ["CTRLB_DB"] = str(tmp / "t.db")
    try:
        with _client() as c:
            from app.services.agent.session import DEFAULT_SYSTEM_PROMPT

            thread = _make_thread(c)

            # 1. empty config → exactly one system message (the baked default)
            assert _systems(_assemble(c, thread)) == [DEFAULT_SYSTEM_PROMPT]

            # 2. global append → emitted as a second system message, after the base
            r = c.put("/api/settings", json={"inference": {"system_prompt_append": "GLOBAL-X"}})
            assert r.status_code == 200, r.text
            assert _systems(_assemble(c, thread)) == [DEFAULT_SYSTEM_PROMPT, "GLOBAL-X"]

            # 3. add an agent with prompt_append → three system messages (base, global, per-agent)
            r = c.put("/api/settings", json={
                "agents": [{"name": "writer", "prompt_append": "AGENT-Y"}],
                "agent": {"default_agent": "writer"},
            })
            assert r.status_code == 200, r.text
            assert _systems(_assemble(c, thread, "writer")) == [
                DEFAULT_SYSTEM_PROMPT, "GLOBAL-X", "AGENT-Y"
            ]

            # 4. flip inherit_append=False → global is skipped; only per-agent appears
            r = c.put("/api/settings", json={
                "agents": [{"name": "writer", "prompt_append": "AGENT-Y", "inherit_append": False}],
            })
            assert r.status_code == 200, r.text
            assert _systems(_assemble(c, thread, "writer")) == [DEFAULT_SYSTEM_PROMPT, "AGENT-Y"]

            # 5. replace axis (inference.system_prompt) coexists with the append — base becomes the
            #    override; the append still appears as its own message after it
            r = c.put("/api/settings", json={
                "inference": {"system_prompt": "REPLACED-BASE"},
                "agents": [],  # clear the writer agent → fall back to the built-in default
                "agent": {"default_agent": ""},
            })
            assert r.status_code == 200, r.text
            assert _systems(_assemble(c, thread)) == ["REPLACED-BASE", "GLOBAL-X"]
    finally:
        os.environ.pop("CTRLB_CONFIG", None)
        os.environ.pop("CTRLB_DB", None)


def test_whitespace_only_append_treated_as_empty() -> None:
    """`.strip()` defends against the user saving "   \\n  " in a textarea — the append should
    be silently treated as unset rather than emitting a useless blank system message."""
    tmp = Path(tempfile.mkdtemp())
    cfg = tmp / "config.yaml"
    cfg.write_text("server:\n  port: 5433\n", encoding="utf-8")
    os.environ["CTRLB_CONFIG"] = str(cfg)
    os.environ["CTRLB_DB"] = str(tmp / "t.db")
    try:
        with _client() as c:
            from app.services.agent.session import DEFAULT_SYSTEM_PROMPT

            thread = _make_thread(c)
            r = c.put("/api/settings", json={
                "inference": {"system_prompt_append": "   \n\t  "},
                "agents": [{"name": "writer", "prompt_append": "\n  \n"}],
                "agent": {"default_agent": "writer"},
            })
            assert r.status_code == 200, r.text
            # neither whitespace-only value should produce a system message
            assert _systems(_assemble(c, thread, "writer")) == [DEFAULT_SYSTEM_PROMPT]
    finally:
        os.environ.pop("CTRLB_CONFIG", None)
        os.environ.pop("CTRLB_DB", None)


def test_clear_global_append_falls_back() -> None:
    """Setting the global append then clearing it (PUT "") returns to a single system message —
    the editor's `[Restore default]` flow on the inline append field."""
    tmp = Path(tempfile.mkdtemp())
    cfg = tmp / "config.yaml"
    cfg.write_text("server:\n  port: 5433\n", encoding="utf-8")
    os.environ["CTRLB_CONFIG"] = str(cfg)
    os.environ["CTRLB_DB"] = str(tmp / "t.db")
    try:
        with _client() as c:
            from app.services.agent.session import DEFAULT_SYSTEM_PROMPT

            thread = _make_thread(c)
            c.put("/api/settings", json={"inference": {"system_prompt_append": "X"}})
            assert _systems(_assemble(c, thread)) == [DEFAULT_SYSTEM_PROMPT, "X"]

            r = c.put("/api/settings", json={"inference": {"system_prompt_append": ""}})
            assert r.status_code == 200, r.text
            assert _systems(_assemble(c, thread)) == [DEFAULT_SYSTEM_PROMPT]
    finally:
        os.environ.pop("CTRLB_CONFIG", None)
        os.environ.pop("CTRLB_DB", None)


def test_builtin_default_agent_inherits_global_append() -> None:
    """The built-in default agent (used when `agents[]` is empty) has `inherit_append=True` —
    i.e. the global append applies out of the box, no agents[] entry needed."""
    tmp = Path(tempfile.mkdtemp())
    cfg = tmp / "config.yaml"
    cfg.write_text("server:\n  port: 5433\n", encoding="utf-8")
    os.environ["CTRLB_CONFIG"] = str(cfg)
    os.environ["CTRLB_DB"] = str(tmp / "t.db")
    try:
        with _client() as c:
            from app.services.agent.session import DEFAULT_SYSTEM_PROMPT

            thread = _make_thread(c)
            c.put("/api/settings", json={"inference": {"system_prompt_append": "GLOBAL"}})
            # no agents[] → default_agent_def() → the built-in
            assert c.app.state.settings.resolve_agent(None).name == "default"
            assert _systems(_assemble(c, thread)) == [DEFAULT_SYSTEM_PROMPT, "GLOBAL"]
    finally:
        os.environ.pop("CTRLB_CONFIG", None)
        os.environ.pop("CTRLB_DB", None)


def test_per_agent_append_is_isolated() -> None:
    """Two agents, each with their own `prompt_append`. Each session sees its own — the per-agent
    string never leaks across agents (a regression-guard for any future global-state shortcut)."""
    tmp = Path(tempfile.mkdtemp())
    cfg = tmp / "config.yaml"
    cfg.write_text("server:\n  port: 5433\n", encoding="utf-8")
    os.environ["CTRLB_CONFIG"] = str(cfg)
    os.environ["CTRLB_DB"] = str(tmp / "t.db")
    try:
        with _client() as c:
            from app.services.agent.session import DEFAULT_SYSTEM_PROMPT

            thread = _make_thread(c)
            r = c.put("/api/settings", json={
                "agents": [
                    {"name": "a1", "prompt_append": "FROM-A1"},
                    {"name": "a2", "prompt_append": "FROM-A2"},
                ],
            })
            assert r.status_code == 200, r.text
            assert _systems(_assemble(c, thread, "a1")) == [DEFAULT_SYSTEM_PROMPT, "FROM-A1"]
            assert _systems(_assemble(c, thread, "a2")) == [DEFAULT_SYSTEM_PROMPT, "FROM-A2"]
    finally:
        os.environ.pop("CTRLB_CONFIG", None)
        os.environ.pop("CTRLB_DB", None)


def test_get_settings_reflects_new_fields() -> None:
    """`GET /api/settings` should round-trip the new fields so the Conf editor can read+write
    them (7e-b will wire that UI; this test guards the API shape today)."""
    tmp = Path(tempfile.mkdtemp())
    cfg = tmp / "config.yaml"
    cfg.write_text("server:\n  port: 5433\n", encoding="utf-8")
    os.environ["CTRLB_CONFIG"] = str(cfg)
    os.environ["CTRLB_DB"] = str(tmp / "t.db")
    try:
        with _client() as c:
            # defaults present on GET (GET returns the masked settings dict directly; PUT wraps it
            # in {settings, restart_required})
            body = c.get("/api/settings").json()
            assert body["inference"]["system_prompt_append"] == ""
            # write + read back
            r = c.put("/api/settings", json={
                "inference": {"system_prompt_append": "GX"},
                "agents": [{"name": "w", "prompt_append": "AY", "inherit_append": False}],
            })
            assert r.status_code == 200, r.text
            # PUT's own response carries the post-validation settings shape too
            assert r.json()["settings"]["inference"]["system_prompt_append"] == "GX"
            body = c.get("/api/settings").json()
            assert body["inference"]["system_prompt_append"] == "GX"
            agent = next(a for a in body["agents"] if a["name"] == "w")
            assert agent["prompt_append"] == "AY"
            assert agent["inherit_append"] is False
    finally:
        os.environ.pop("CTRLB_CONFIG", None)
        os.environ.pop("CTRLB_DB", None)


def test_multiline_append_yaml_roundtrip() -> None:
    """The 7a ruamel writer must preserve multi-line append text (block scalar) AND the
    surrounding comments. Catches any quoting/escaping regression in the YAML round-trip path."""
    tmp = Path(tempfile.mkdtemp())
    cfg = tmp / "config.yaml"
    cfg.write_text(
        "# homelab\n"
        "server:\n"
        "  port: 5433\n"
        "inference:\n"
        "  default_mode: local\n",
        encoding="utf-8",
    )
    os.environ["CTRLB_CONFIG"] = str(cfg)
    os.environ["CTRLB_DB"] = str(tmp / "t.db")
    try:
        with _client() as c:
            text = "line one\nline two\n  indented line\nline four"
            r = c.put("/api/settings", json={"inference": {"system_prompt_append": text}})
            assert r.status_code == 200, r.text

            # Comment + structure preserved on disk
            disk = cfg.read_text(encoding="utf-8")
            assert "# homelab" in disk
            assert "system_prompt_append" in disk
            # The append value survives byte-equivalent through a re-load + re-assemble
            from app.config import load_settings
            reloaded = load_settings(cfg)
            assert reloaded.inference.system_prompt_append == text
            # And the loop sees the exact stored content in the assembled messages
            from app.services.agent.session import DEFAULT_SYSTEM_PROMPT
            thread = _make_thread(c)
            assert _systems(_assemble(c, thread)) == [DEFAULT_SYSTEM_PROMPT, text]
    finally:
        os.environ.pop("CTRLB_CONFIG", None)
        os.environ.pop("CTRLB_DB", None)


def test_default_prompt_endpoint() -> None:
    """The endpoint that backs `[Load default]` / `[Restore default]` in the editor."""
    tmp = Path(tempfile.mkdtemp())
    cfg = tmp / "config.yaml"
    cfg.write_text("server:\n  port: 5433\n", encoding="utf-8")
    os.environ["CTRLB_CONFIG"] = str(cfg)
    os.environ["CTRLB_DB"] = str(tmp / "t.db")
    try:
        with _client() as c:
            from app.services.agent.session import DEFAULT_SYSTEM_PROMPT

            r = c.get("/api/agent/default-prompt")
            assert r.status_code == 200, r.text
            body = r.json()
            assert body == {"text": DEFAULT_SYSTEM_PROMPT}
            # Sanity-check the baked text actually contains something recognizable so a regression
            # to an empty/wrong constant is caught.
            assert "ctrl-b" in body["text"] and len(body["text"]) > 200
    finally:
        os.environ.pop("CTRLB_CONFIG", None)
        os.environ.pop("CTRLB_DB", None)


if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    for fn in fns:
        fn()
        print(f"ok  {fn.__name__}")
    print(f"\n{len(fns)} passed")
