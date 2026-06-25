"""D27 slice B — the emotional `state.md` store (SET semantics, opt-in, auto-applies).

Exercises the third registry store end-to-end: the provider's SET write path, persona-first injection,
the `memory` tool's action↔semantics gate + the state-enabled gate + the auto-apply (propose-bypass),
and the store-keyed API route. The shared backup path is already covered by `test_memory_git_backup_d26`
(one git assertion here proves STATE.md is versioned like the others).

What's exercised:
  Provider (SET):
    1. set round-trip   — `set` writes content wholesale; a second set replaces (not appends).
    2. no §/tidy        — the stored value is verbatim markdown (no `§` framing).
    3. over cap         — a `set` past state_char_limit raises MemoryCapError.
    4. persona-first    — with state enabled, the state section leads the injected block.
    5. disabled inject  — state_enabled off → not injected even with a STATE.md present.
  Tool (through ActionService):
    6. auto-apply       — state `set` writes even with auto_write OFF (no proposal).
    7. state gate       — target=state with state_enabled off → DENIED.
    8. semantics gate   — `set` on memory → ERROR; `add` on state → ERROR.
    9. per-agent        — a specialist's STATE.md is isolated under agents/<slug>/.
  API + backup:
   10. store route      — PUT/GET /api/agents/{name}/memory/state round-trips; unknown store → 404.
   11. backed up        — a state set commits STATE.md in the memory git repo.

Each test runs in an isolated `$CTRLB_HOME` temp workspace; the real config/db are never touched.
"""

from __future__ import annotations

import asyncio
import contextlib
import os
import shutil
import subprocess
import tempfile
from pathlib import Path

_HAS_GIT = shutil.which("git") is not None


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
    return asyncio.get_event_loop().run_until_complete(coro)


def _agent(c, name: str | None = None):
    return c.app.state.settings.resolve_agent(name)


def _invoke(c, args: dict, *, agent_name: str | None = None):
    from app.domain.enums import Actor, Privilege

    return _run(
        c.app.state.actions.invoke(
            "memory", args, actor=Actor.AGENT, privilege=Privilege.CONFIRM, agent=_agent(c, agent_name)
        )
    )


def _systems(messages: list[dict]) -> list[str]:
    out: list[str] = []
    for m in messages:
        if m["role"] != "system":
            break
        out.append(m["content"])
    return out


# ── provider (SET) ────────────────────────────────────────────────────────────────────────────────


def test_set_writes_wholesale_and_replaces() -> None:
    with _workspace() as (tmp, _cfg):
        with _client() as c:
            prov, agent = c.app.state.memory, _agent(c)
            _run(prov.write(agent, "state", "set", "Mood: calm\nEnergy: steady"))
            assert prov.read_raw(agent, "state") == "Mood: calm\nEnergy: steady"
            # a second set replaces the whole value (not append)
            _run(prov.write(agent, "state", "set", "Mood: focused"))
            body = (tmp / "memories" / "STATE.md").read_text(encoding="utf-8")
            assert "Mood: focused" in body and "calm" not in body
            assert "§" not in body  # SET store gets no `§` framing


def test_set_over_cap_raises() -> None:
    from app.services.agent.memory import MemoryCapError

    with _workspace():
        with _client() as c:
            c.app.state.settings.memory.state_char_limit = 10
            prov, agent = c.app.state.memory, _agent(c)
            try:
                _run(prov.write(agent, "state", "set", "this state note is far past ten chars"))
            except MemoryCapError:
                pass
            else:
                raise AssertionError("expected MemoryCapError for a state set over the cap")


def test_state_leads_injected_block_when_enabled() -> None:
    with _workspace() as (tmp, _cfg):
        with _client() as c:
            c.app.state.settings.memory.state_enabled = True
            agent = _agent(c)
            (tmp / "memories").mkdir(parents=True, exist_ok=True)
            (tmp / "memories" / "MEMORY.md").write_text("a durable fact", encoding="utf-8")
            (tmp / "memories" / "STATE.md").write_text("Mood: bright", encoding="utf-8")
            block = c.app.state.memory.load_context(agent)
            assert "## Emotional state" in block and "## Agent memory" in block
            assert block.index("## Emotional state") < block.index("## Agent memory")  # persona-first
            assert "Mood: bright" in block


def test_state_not_injected_when_disabled() -> None:
    with _workspace() as (tmp, _cfg):
        with _client() as c:
            # state_enabled defaults False
            (tmp / "memories").mkdir(parents=True, exist_ok=True)
            (tmp / "memories" / "STATE.md").write_text("Mood: hidden", encoding="utf-8")
            block = c.app.state.memory.load_context(_agent(c))
            assert "Emotional state" not in block and "Mood: hidden" not in block


# ── tool (through ActionService) ────────────────────────────────────────────────────────────────


def test_tool_state_set_auto_applies_even_with_auto_write_off() -> None:
    from app.domain.enums import RunState

    with _workspace() as (tmp, _cfg):
        with _client() as c:
            c.app.state.settings.memory.state_enabled = True
            c.app.state.settings.memory.auto_write = False  # would propose for memory/user — but state auto-applies
            out = _invoke(c, {"target": "state", "action": "set", "content": "Mood: resolved"})
            assert out.result.state == RunState.OK
            assert "proposed" not in (out.result.summary or "")
            assert "Mood: resolved" in (tmp / "memories" / "STATE.md").read_text(encoding="utf-8")


def test_tool_state_gated_when_disabled() -> None:
    from app.domain.enums import RunState

    with _workspace():
        with _client() as c:
            # state_enabled defaults False
            out = _invoke(c, {"target": "state", "action": "set", "content": "x"})
            assert out.result.state == RunState.DENIED


def test_tool_action_semantics_mismatch_errors() -> None:
    from app.domain.enums import RunState

    with _workspace():
        with _client() as c:
            c.app.state.settings.memory.state_enabled = True
            # set on an APPEND store → ERROR
            out = _invoke(c, {"target": "memory", "action": "set", "content": "nope"})
            assert out.result.state == RunState.ERROR and "set" in (out.result.error or "")
            # add on a SET store → ERROR
            out = _invoke(c, {"target": "state", "action": "add", "content": "nope"})
            assert out.result.state == RunState.ERROR


def test_tool_specialist_state_is_isolated() -> None:
    from app.domain.enums import RunState

    with _workspace() as (tmp, _cfg):
        with _client() as c:
            c.app.state.settings.memory.state_enabled = True
            assert c.put("/api/agents/coder", json={"agent": {}}).status_code == 200
            out = _invoke(c, {"target": "state", "action": "set", "content": "Mood: coding"}, agent_name="coder")
            assert out.result.state == RunState.OK
            assert "Mood: coding" in (tmp / "memories" / "agents" / "coder" / "STATE.md").read_text(encoding="utf-8")
            assert not (tmp / "memories" / "STATE.md").exists()  # root agent untouched


# ── API + backup ──────────────────────────────────────────────────────────────────────────────────


def test_api_state_store_route_roundtrip_and_unknown_404() -> None:
    with _workspace():
        with _client() as c:
            r = c.put("/api/agents/default/memory/state", json={"content": "Mood: api"})
            assert r.status_code == 200 and r.json()["store"] == "state"
            assert c.get("/api/agents/default/memory/state").json()["content"] == "Mood: api"
            # the bare alias still maps to the memory store (distinct file)
            assert c.get("/api/agents/default/memory").json()["content"] == ""
            # unknown store + a GLOBAL store via the agent route → 404
            assert c.get("/api/agents/default/memory/bogus").status_code == 404
            assert c.get("/api/agents/default/memory/user").status_code == 404


def test_state_set_is_backed_up() -> None:
    if not _HAS_GIT:
        return
    with _workspace() as (tmp, _cfg):
        from app.config import load_settings
        from app.services.agent.memory import FileMemoryProvider
        from app.services.agent.memory_backup import GitMemoryBackup

        async def go():
            settings = load_settings()
            settings.memory.state_enabled = True
            prov = FileMemoryProvider(settings, backup=GitMemoryBackup(settings))
            await prov.write(settings.resolve_agent(None), "state", "set", "Mood: versioned")

        _run(go())  # use the file's shared loop (asyncio.run would close it for later tests)
        root = tmp / "memories"
        log = subprocess.run(
            ["git", "-C", str(root), "show", "HEAD:STATE.md"], capture_output=True, text=True, check=False
        ).stdout
        assert "Mood: versioned" in log


if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    for fn in fns:
        fn()
        print(f"ok  {fn.__name__}")
    print(f"\n{len(fns)} passed")
