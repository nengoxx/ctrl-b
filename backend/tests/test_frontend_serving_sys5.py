"""Prod single-origin frontend serving (D55) + the SYS-5 `/api` boundary — one route table, so the
two contracts are pinned together.

Every root-level `dist` file used to come back as `text/html` 200 from the SPA catch-all. Nothing
404'd and nothing looked broken server-side, so **the load-bearing assertion is the CONTENT-TYPE, not
the status code** — a status-only test passes happily against the bug.
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
    # One representative of every root-level artifact class the real build emits.
    (dist / "favicon.ico").write_bytes(b"ico")
    (dist / "icon-192.png").write_bytes(b"png")
    (dist / "manifest.webmanifest").write_text('{"name":"ctrl-b"}', encoding="utf-8")
    (dist / "sw.js").write_text("self.addEventListener('fetch', () => {})", encoding="utf-8")
    (dist / "assets" / "app.js").write_text("export {}", encoding="utf-8")
    monkeypatch.setattr(main, "_FRONTEND_DIST", dist)
    # `follow_redirects=False` on purpose: a redirect must be an assertion, not something the client
    # silently resolves. `/api` passed the old test only because TestClient followed a 307 to `/api/`.
    return TestClient(main.create_app(), follow_redirects=False)


# ── D55: dist files are served as files ────────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    ("path", "media_type"),
    [
        ("/favicon.ico", "image/vnd.microsoft.icon"),
        ("/icon-192.png", "image/png"),
        ("/manifest.webmanifest", "application/manifest+json"),
        ("/sw.js", "text/javascript"),
        ("/assets/app.js", "text/javascript"),
    ],
)
def test_dist_files_are_served_with_their_own_content_type(spa_client, path, media_type) -> None:
    """THE regression test. Each of these returned `text/html` + the app shell before D55."""
    r = spa_client.get(path)
    assert r.status_code == 200
    assert r.headers["content-type"].startswith(media_type)
    assert "<title>ctrl-b</title>" not in r.text


def test_a_missing_asset_404s_instead_of_returning_the_shell(spa_client) -> None:
    """A filename-like path is an ASSET request: answering it with HTML is what broke the icons."""
    r = spa_client.get("/icon-typo.png")
    assert r.status_code == 404
    assert r.headers["content-type"].startswith("application/json")


# ── SYS-5: the `/api` boundary ─────────────────────────────────────────────────────────────────────


def test_unknown_api_path_returns_json_404(spa_client: TestClient) -> None:
    r = spa_client.get("/api/nonexistent")
    assert r.status_code == 404
    assert r.headers["content-type"].startswith("application/json")
    assert r.json() == {"detail": "Not Found"}


@pytest.mark.parametrize("path", ["/api", "/api/"])
def test_bare_api_returns_json_404_without_redirecting(spa_client: TestClient, path: str) -> None:
    """Both spellings answer directly. `/api/{rest:path}` alone does not match bare `/api`, which
    would 307 to `/api/` and echo the proxy-visible host into `Location`."""
    r = spa_client.get(path)
    assert r.status_code == 404
    assert r.json() == {"detail": "Not Found"}


def test_the_api_guard_stays_registered_last(spa_client: TestClient) -> None:
    """The guard is a catch-all under `/api`, so every real `/api` route must be registered BEFORE it.

    Asserted structurally, over the route table, because the obvious behavioural version does not
    actually test this: requesting an existing endpoint like `/api/health` passes whatever happens
    below the guard, since that route is already above it. Only ordering catches a router appended
    later — which is the failure this pins.
    """
    routes = spa_client.app.routes
    assert [getattr(r, "path", None) for r in routes[-2:]] == ["/api/{rest:path}", "/api"], (
        "the SYS-5 guard routes must be the LAST entries in the route table — anything registered "
        "under /api after them is silently shadowed for GET"
    )
    # Sanity, so the ordering above means something: the real API IS registered, ahead of the guard.
    # `include_router` keeps its routes inside `_IncludedRouter` entries rather than flattening them
    # onto `app.routes`, so the endpoints are confirmed through the schema rather than by path match.
    assert "/api/health" in spa_client.get("/openapi.json").json()["paths"]


def test_unknown_api_method_stays_405(spa_client: TestClient) -> None:
    """The guard is GET-only by design. Were HEAD added, the partial match a real GET-only endpoint
    produces would become a FULL match here and answer 404 — claiming a live endpoint does not exist."""
    r = spa_client.post("/api/nonexistent")
    assert r.status_code == 405
    assert r.headers["allow"] == "GET"
    assert spa_client.head("/api/health").status_code == 405


# ── The SPA shell still resolves ───────────────────────────────────────────────────────────────────


def test_a_real_spa_route_still_serves_index(spa_client: TestClient) -> None:
    r = spa_client.get("/somepage", headers={"accept": "text/html"})
    assert r.status_code == 200
    assert "ctrl-b" in r.text
    # a path that merely CONTAINS "api" later is an SPA route, not an API path
    assert spa_client.get("/settings/api-keys", headers={"accept": "text/html"}).status_code == 200


def test_the_root_serves_the_shell(spa_client: TestClient) -> None:
    r = spa_client.get("/", headers={"accept": "text/html"})
    assert r.status_code == 200
    assert "<title>ctrl-b</title>" in r.text
