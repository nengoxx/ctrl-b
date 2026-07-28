"""SYS-5 — the SPA catch-all must not mask an unknown `/api/...` as a 200 index.html.

A mistyped or removed API path used to fall through to the SPA fallback and return `index.html` with
HTTP 200, so a client bug looked like a working page. The fallback now returns a JSON 404 for any path
under `api/` (and `api` itself), while every genuine SPA route still serves the app shell.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def spa_client(tmp_path, monkeypatch):
    import app.main as main

    dist = tmp_path / "dist"
    (dist / "assets").mkdir(parents=True)
    (dist / "index.html").write_text("<!doctype html><title>ctrl-b</title>", encoding="utf-8")
    monkeypatch.setattr(main, "_FRONTEND_DIST", dist)
    return TestClient(main.create_app())


def test_unknown_api_path_returns_json_404(spa_client: TestClient) -> None:
    r = spa_client.get("/api/nonexistent")
    assert r.status_code == 404
    assert r.headers["content-type"].startswith("application/json")
    assert r.json() == {"detail": "Not Found"}


def test_bare_api_returns_json_404(spa_client: TestClient) -> None:
    r = spa_client.get("/api")
    assert r.status_code == 404
    assert r.json() == {"detail": "Not Found"}


def test_a_real_spa_route_still_serves_index(spa_client: TestClient) -> None:
    r = spa_client.get("/somepage")
    assert r.status_code == 200
    assert "ctrl-b" in r.text
    # a path that merely CONTAINS "api" later is an SPA route, not an API path
    assert spa_client.get("/settings/api-keys").status_code == 200
