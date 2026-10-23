"""ISS-88 — `POST /api/actions/{name}` honours `ui_exposed`: the UI's door runs only the tools the UI
shows; a hidden tool 404s exactly like an unknown name, BEFORE `invoke` (no gate, no audit row).
`GET /api/actions` still lists everything (the ToolCatalog renders every tool's agent mode).
"""

from __future__ import annotations

import contextlib

import yaml


@contextlib.contextmanager
def _client(tmp_path, monkeypatch):
    from fastapi.testclient import TestClient

    from app.main import create_app

    cfg = tmp_path / "config.yaml"
    cfg.write_text(yaml.safe_dump({"server": {"port": 5433}}), encoding="utf-8")
    monkeypatch.setenv("CTRLB_CONFIG", str(cfg))
    monkeypatch.setenv("CTRLB_DB", str(tmp_path / "t.db"))
    with TestClient(create_app()) as c:
        yield c


def test_hidden_tools_404_like_unknown_names(tmp_path, monkeypatch) -> None:
    with _client(tmp_path, monkeypatch) as c:
        # Open every shell door, so a 404 can only be the route guard (not the shell gate).
        shell = c.app.state.settings.shell
        shell.user_exec_enabled = shell.agent_exec_enabled = True
        unknown = c.post("/api/actions/no_such_tool_iss88", json={"args": {}})
        assert unknown.status_code == 404
        for name in ("run_shell", "tailscale_serve_enable"):
            assert not c.app.state.actions.registry.get(name).spec.ui_exposed
            body = {"args": {"command": "echo hi"} if name == "run_shell" else {}}
            r = c.post(f"/api/actions/{name}", json=body)
            assert r.status_code == 404, name
            assert r.json()["detail"] == f"unknown action '{name}'"  # the same shape as an unknown name


def test_an_exposed_action_still_reaches_the_gate(tmp_path, monkeypatch) -> None:
    with _client(tmp_path, monkeypatch) as c:
        assert c.app.state.actions.registry.get("wake_host").spec.ui_exposed
        r = c.post("/api/actions/wake_host", json={"args": {"host_id": "no-such-host"}})
        assert r.status_code == 200
        out = r.json()
        assert out["needs_confirm"] is False and out["result"] is not None and out["event"] is not None


def test_the_listing_still_shows_hidden_tools(tmp_path, monkeypatch) -> None:
    with _client(tmp_path, monkeypatch) as c:
        names = {a["name"] for a in c.get("/api/actions").json()}
        assert {"run_shell", "wake_host"} <= names
