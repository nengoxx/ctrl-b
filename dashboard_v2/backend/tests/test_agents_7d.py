"""Phase 7d-b — agents management round-trip tests.

Same dual-run convention as the other suites. Covers the agents-via-PUT-/api/settings path: the whole
`agents` list is replaced + validated (the StrEnum privilege round-trips — audit A1), the `agent`
section deep-merges, the change hot-applies (`resolve_agent` reflects it), and `GET /api/agents`
reports the names + resolved default. Then clearing the list falls back to the built-in default.
Writes are on a **temp** config (audit E3), never the real one.
"""

from __future__ import annotations

import os
import tempfile
from pathlib import Path

from app.config import load_settings


def _client():
    from fastapi.testclient import TestClient

    from app.main import create_app

    return TestClient(create_app())


def test_agents_crud_and_default() -> None:
    tmp = Path(tempfile.mkdtemp())
    cfg = tmp / "config.yaml"
    cfg.write_text("# homelab\nserver:\n  port: 5433\n", encoding="utf-8")
    os.environ["CTRLB_CONFIG"] = str(cfg)
    os.environ["CTRLB_DB"] = str(tmp / "t.db")
    try:
        with _client() as c:
            assert c.get("/api/agents").json() == {"agents": [], "default": "default"}

            # add an agent + make it the default (whole-list replace + section deep-merge in one PUT)
            r = c.put(
                "/api/settings",
                json={
                    "agents": [
                        {"name": "ops", "privilege": "full", "tools": ["wake_host", "ping_host"], "skills": []}
                    ],
                    "agent": {"default_agent": "ops", "global_subagent_limit": 9},
                },
            )
            assert r.status_code == 200, r.text
            body = r.json()
            assert body["settings"]["agents"][0]["name"] == "ops"
            assert body["settings"]["agents"][0]["privilege"] == "full"  # StrEnum → str (A1)

            # GET /api/agents reflects the new names + resolved default
            assert c.get("/api/agents").json() == {"agents": ["ops"], "default": "ops"}

            # hot-applied: the running app resolves the default agent live (no restart)
            resolved = c.app.state.settings.resolve_agent(None)
            assert resolved.name == "ops" and resolved.privilege.value == "full"
            assert c.app.state.settings.agent.global_subagent_limit == 9

            # persisted to disk (comment preserved), privilege as a plain string
            disk = cfg.read_text(encoding="utf-8")
            assert "# homelab" in disk
            assert "privilege: full" in disk
            assert "default_agent: ops" in disk
            # reloads cleanly from disk
            assert load_settings(cfg).agents[0].name == "ops"

            # a bad privilege value → 422 (not 500)
            assert c.put("/api/settings", json={"agents": [{"name": "x", "privilege": "god"}]}).status_code == 422

            # clear the list → resolve falls back to the built-in default
            r2 = c.put("/api/settings", json={"agents": [], "agent": {"default_agent": ""}})
            assert r2.status_code == 200, r2.text
            assert c.get("/api/agents").json() == {"agents": [], "default": "default"}
            assert c.app.state.settings.resolve_agent(None).name == "default"
    finally:
        os.environ.pop("CTRLB_CONFIG", None)
        os.environ.pop("CTRLB_DB", None)


if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    for fn in fns:
        fn()
        print(f"ok  {fn.__name__}")
    print(f"\n{len(fns)} passed")
