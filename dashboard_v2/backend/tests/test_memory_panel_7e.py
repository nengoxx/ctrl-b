"""Phase 7e-d-3 — Conf Memory panel backend (FileMemoryProvider.read_raw/overwrite + the file API).

The raw read/overwrite path behind the panel, mirroring the skills/SOUL.md file API: per-agent
MEMORY.md (incl. default → root) + the global USER.md, blank-content-clears, uncapped (manual owner
edits, soft cap). The agent's structured write path (the `memory` tool) is 7e-d-2.

What's exercised:
  Provider:
    1. read_raw/overwrite round-trip on agent memory + global user.
    2. blank overwrite clears (removes) the file.
    3. overwrite is uncapped — content past the cap is stored (the cap governs the tool, not edits).
  API:
    4. GET/PUT /api/agents/{default}/memory  → root memories/MEMORY.md.
    5. GET/PUT /api/agents/{specialist}/memory → its own folder, 404 for an absent specialist.
    6. PUT with blank content clears the file (subsequent GET → "").
    7. bad slug → 422.
    8. GET/PUT /api/memory/user → global USER.md.

Each test runs in an isolated `$CTRLB_HOME` temp workspace; the real config/db are never touched.
"""

from __future__ import annotations

import asyncio
from _async import run_async
import contextlib
import os
import tempfile
from pathlib import Path


def _run(coro):
    return run_async(coro)


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


def _default(c):
    return c.app.state.settings.default_agent_def()


# ── provider ──────────────────────────────────────────────────────────────────────────────────


def test_read_raw_overwrite_roundtrip() -> None:
    with _workspace() as (tmp, _cfg):
        with _client() as c:
            prov, agent = c.app.state.memory, _default(c)
            assert prov.read_raw(agent, "memory") == ""  # nothing yet
            _run(prov.overwrite(agent, "memory", "line one\nline two"))
            assert prov.read_raw(agent, "memory") == "line one\nline two"
            assert (tmp / "memories" / "MEMORY.md").is_file()


def test_blank_overwrite_clears_file() -> None:
    with _workspace() as (tmp, _cfg):
        with _client() as c:
            prov, agent = c.app.state.memory, _default(c)
            _run(prov.overwrite(agent, "memory", "something"))
            assert (tmp / "memories" / "MEMORY.md").is_file()
            _run(prov.overwrite(agent, "memory", "   "))  # blank → remove
            assert not (tmp / "memories" / "MEMORY.md").exists()
            assert prov.read_raw(agent, "memory") == ""


def test_overwrite_is_uncapped() -> None:
    with _workspace():
        with _client() as c:
            c.app.state.settings.memory.memory_char_limit = 10
            prov, agent = c.app.state.memory, _default(c)
            big = "x" * 200
            _run(prov.overwrite(agent, "memory", big))  # no raise despite cap=10
            assert prov.read_raw(agent, "memory") == big


# ── API ───────────────────────────────────────────────────────────────────────────────────────


def test_api_default_agent_memory_roundtrip() -> None:
    with _workspace() as (tmp, _cfg):
        with _client() as c:
            assert c.get("/api/agents/default/memory").json()["content"] == ""
            r = c.put("/api/agents/default/memory", json={"content": "root note"})
            assert r.status_code == 200 and r.json()["content"] == "root note"
            assert (tmp / "memories" / "MEMORY.md").read_text(encoding="utf-8").strip() == "root note"
            assert c.get("/api/agents/default/memory").json()["content"] == "root note"


def test_api_specialist_memory_and_404() -> None:
    with _workspace() as (tmp, _cfg):
        with _client() as c:
            assert c.get("/api/agents/coder/memory").status_code == 404  # no folder yet
            assert c.put("/api/agents/coder", json={"agent": {}}).status_code == 200  # scaffold
            r = c.put("/api/agents/coder/memory", json={"content": "coder note"})
            assert r.status_code == 200
            # D26: specialist memory under the memory dir, not the agent workspace folder.
            assert "coder note" in (tmp / "memories" / "agents" / "coder" / "MEMORY.md").read_text(encoding="utf-8")
            assert not (tmp / "memories" / "MEMORY.md").exists()  # root agent untouched


def test_api_blank_put_clears() -> None:
    with _workspace() as (tmp, _cfg):
        with _client() as c:
            c.put("/api/agents/default/memory", json={"content": "temp"})
            assert (tmp / "memories" / "MEMORY.md").is_file()
            assert c.put("/api/agents/default/memory", json={"content": ""}).json()["content"] == ""
            assert not (tmp / "memories" / "MEMORY.md").exists()


def test_api_bad_slug_422() -> None:
    with _workspace():
        with _client() as c:
            assert c.get("/api/agents/Bad__Name!/memory").status_code == 422


def test_api_user_memory_roundtrip() -> None:
    with _workspace() as (tmp, _cfg):
        with _client() as c:
            assert c.get("/api/memory/user").json()["content"] == ""
            r = c.put("/api/memory/user", json={"content": "owner is on Android"})
            assert r.status_code == 200 and "Android" in r.json()["content"]
            assert (tmp / "memories" / "USER.md").is_file()
            assert c.put("/api/memory/user", json={"content": ""}).json()["content"] == ""
            assert not (tmp / "memories" / "USER.md").exists()


if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    for fn in fns:
        fn()
        print(f"ok  {fn.__name__}")
    print(f"\n{len(fns)} passed")
