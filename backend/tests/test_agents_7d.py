"""Phase 7e-c — agents-as-folders (D14) management round-trip tests.

Agents are folder-only now (`$CTRLB_HOME/agents/<name>/` = agent.yaml + SOUL.md); the 7d
`agents:[]`-via-settings path is gone. This covers the file-per-agent API:
- `PUT /api/agents/{name}` writes agent.yaml (+ scaffolds SOUL.md) and validates the merged def
  (a bad privilege → 422, not 500 — the StrEnum round-trip the old A1 test guarded);
- `GET /api/agents` lists discovered names + the resolved default;
- the change is live (`resolve_agent` reflects it, no restart);
- `agent.defaults` is the inheritance base (an absent field falls back to it);
- SOUL.md is the persona (read into `AgentDef.prompt`), editable via the soul endpoint incl. the
  default/root agent; blank SOUL → fall back to the baked default;
- `DELETE` removes the folder; the default agent can't be created/deleted via this API.

Everything runs in an isolated `$CTRLB_HOME` temp workspace (audit E3) — never the real config.
"""

from __future__ import annotations

import contextlib
import os
import tempfile
from pathlib import Path

from app.config import load_settings


@contextlib.contextmanager
def _workspace(config_text: str = "# homelab\nserver:\n  port: 5433\n"):
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


def _client():
    from fastapi.testclient import TestClient

    from app.main import create_app

    return TestClient(create_app())


def test_agent_folder_crud_and_default() -> None:
    with _workspace() as (tmp, cfg):
        with _client() as c:
            # empty workspace → no folder agents; the default resolves to the root "default"
            assert c.get("/api/agents").json() == {"agents": [], "default": "default"}

            # create a specialist via the file API; a new folder scaffolds agent.yaml + SOUL.md
            r = c.put(
                "/api/agents/ops",
                json={
                    "agent": {
                        "title": "Ops Bot",
                        "privilege": "full",
                        "tools": ["wake_host", "ping_host"],
                        "skills": [],
                    }
                },
            )
            assert r.status_code == 200, r.text
            body = r.json()
            assert body["name"] == "ops" and body["is_default"] is False
            assert body["agent"]["privilege"] == "full"  # StrEnum → str (the A1 round-trip)
            assert body["agent"]["name"] == "ops"  # folder slug wins
            assert body["agent"]["title"] == "Ops Bot"  # display name round-trips
            assert c.app.state.settings.resolve_agent("ops").title == "Ops Bot"

            # the default agent's display name comes from agent.default_title (slug stays "default")
            assert c.put("/api/settings", json={"agent": {"default_title": "Atlas"}}).status_code == 200
            assert c.get("/api/agents/default").json()["agent"]["title"] == "Atlas"
            # title never leaks from defaults into specialists
            assert c.put("/api/settings", json={"agent": {"defaults": {"title": "LEAK"}}}).status_code == 200
            assert c.get("/api/agents/ops").json()["agent"]["title"] == "Ops Bot"
            assert body["soul"]  # SOUL.md scaffolded from the baked default

            # on disk: a folder with agent.yaml + SOUL.md
            folder = tmp / "agents" / "ops"
            assert (folder / "agent.yaml").is_file() and (folder / "SOUL.md").is_file()
            assert "privilege: full" in (folder / "agent.yaml").read_text(encoding="utf-8")
            # agent.yaml carries overrides only — never name/prompt
            assert "name:" not in (folder / "agent.yaml").read_text(encoding="utf-8")

            # make it the default (a config.yaml global — still via PUT /api/settings)
            assert c.put("/api/settings", json={"agent": {"default_agent": "ops"}}).status_code == 200

            # GET /api/agents reflects the discovered name + resolved default
            assert c.get("/api/agents").json() == {"agents": ["ops"], "default": "ops"}

            # hot-applied: the running app resolves it live (no restart), SOUL.md → prompt
            resolved = c.app.state.settings.resolve_agent(None)
            assert resolved.name == "ops" and resolved.privilege.value == "full"
            assert resolved.prompt.startswith("You are ctrl-b")  # the scaffolded persona

            # reloads cleanly from disk (folder discovery, not config)
            assert load_settings(cfg).resolve_agent("ops").privilege.value == "full"

            # a bad privilege value → 422 (not 500)
            assert c.put("/api/agents/ops", json={"agent": {"privilege": "god"}}).status_code == 422
            # a bad slug → 422
            assert c.put("/api/agents/Bad Name", json={"agent": {}}).status_code == 422
            # the default agent can't be created/deleted via this API
            assert c.put("/api/agents/default", json={"agent": {}}).status_code == 422
            assert c.delete("/api/agents/default").status_code == 422

            # delete → folder gone. `agent.default_agent` is still "ops" in config, but resolving it
            # finds no folder and falls back gracefully to the root "default" (no 500, no stale agent).
            assert c.delete("/api/agents/ops").status_code == 200
            assert not folder.exists()
            assert c.get("/api/agents").json() == {"agents": [], "default": "default"}
            assert c.app.state.settings.resolve_agent(None).name == "default"
            # delete again → 404 (idempotent surface)
            assert c.delete("/api/agents/ops").status_code == 404


def test_agent_defaults_inheritance() -> None:
    """A specialist's absent fields inherit `agent.defaults`; its own agent.yaml overrides win."""
    with _workspace("server:\n  port: 5433\n") as (_tmp, _cfg):
        with _client() as c:
            # set an inheritance base
            assert (
                c.put(
                    "/api/settings",
                    json={"agent": {"defaults": {"privilege": "readonly", "max_iterations": 30}}},
                ).status_code
                == 200
            )

            # an agent that overrides only max_iterations → privilege inherits the default
            r = c.put("/api/agents/coder", json={"agent": {"max_iterations": 99}})
            assert r.status_code == 200, r.text
            a = r.json()["agent"]
            assert a["max_iterations"] == 99  # override wins
            assert a["privilege"] == "readonly"  # inherited from agent.defaults

            resolved = c.app.state.settings.resolve_agent("coder")
            assert resolved.max_iterations == 99 and resolved.privilege.value == "readonly"


def test_soul_editing_and_fallback() -> None:
    """SOUL.md is the persona (read into prompt). Editing it (incl. the default/root agent) is live;
    blanking it falls the prompt back to the baked default."""
    with _workspace("server:\n  port: 5433\n") as (tmp, _cfg):
        with _client() as c:
            from app.services.agent.session import DEFAULT_SYSTEM_PROMPT

            # the default/root agent: no SOUL.md yet → empty content, prompt falls back to baked
            assert c.get("/api/agents/default/soul").json()["content"] == ""
            assert c.app.state.settings.resolve_agent(None).prompt == ""  # → _system_prompt() baked

            # write the root SOUL.md → becomes the default agent's persona, live
            assert c.put("/api/agents/default/soul", json={"content": "ROOT PERSONA"}).status_code == 200
            assert (tmp / "SOUL.md").read_text(encoding="utf-8").strip() == "ROOT PERSONA"
            assert c.app.state.settings.resolve_agent(None).prompt == "ROOT PERSONA"

            # blank it → file removed → prompt falls back again
            assert c.put("/api/agents/default/soul", json={"content": "   "}).status_code == 200
            assert not (tmp / "SOUL.md").exists()
            assert c.app.state.settings.resolve_agent(None).prompt == ""

            # a specialist's SOUL.md edit is isolated to its folder
            c.put("/api/agents/coder", json={"agent": {}})
            assert c.put("/api/agents/coder/soul", json={"content": "I write code."}).status_code == 200
            assert (tmp / "agents" / "coder" / "SOUL.md").read_text(
                encoding="utf-8"
            ).strip() == "I write code."
            assert c.app.state.settings.resolve_agent("coder").prompt == "I write code."
            # unknown specialist soul → 404
            assert c.get("/api/agents/ghost/soul").status_code == 404
            # DEFAULT_SYSTEM_PROMPT is the scaffold/baked source (sanity)
            assert "ctrl-b" in DEFAULT_SYSTEM_PROMPT


if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    for fn in fns:
        fn()
        print(f"ok  {fn.__name__}")
    print(f"\n{len(fns)} passed")
