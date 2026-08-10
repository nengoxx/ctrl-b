"""Prod single-origin frontend serving (D55) + the SYS-5 `/api` boundary.

Two contracts, one route table, so they are pinned together:

**D55 — every file in `dist` is served AS A FILE.** The original block mounted only `/assets` and let a
catch-all answer everything else with `index.html`, so every root-level build artifact — `favicon.ico`,
the PWA icons, `manifest.webmanifest`, `sw.js`, `workbox-*.js` — came back as `text/html` with a 200.
Nothing 404'd and nothing looked broken server-side; the damage was entirely in the client, which
cannot parse a manifest or register a service worker from an HTML body. Chrome-Android drew a letter
tile for the bookmark. **The load-bearing assertion here is the CONTENT-TYPE, not the status code** — a
status-only test passes happily against the broken behaviour.

**SYS-5 — an unmatched `/api/...` returns a JSON 404, never the SPA shell.** A mistyped or removed API
path used to fall through and return `index.html` with 200, so a client bug looked like a working page.
This still matters under `app.frontend()`: its routes are low-priority, so an unmatched `/api/...`
reaches them and, having no file extension, would be answered with the shell.
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
    (dist / "workbox-test.js").write_text("/* workbox */", encoding="utf-8")
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
        ("/workbox-test.js", "text/javascript"),
        ("/assets/app.js", "text/javascript"),
    ],
)
def test_dist_files_are_served_with_their_own_content_type(spa_client, path, media_type) -> None:
    """THE regression test. Each of these returned `text/html` + the app shell before D55."""
    r = spa_client.get(path)
    assert r.status_code == 200
    assert r.headers["content-type"].startswith(media_type)
    assert "<title>ctrl-b</title>" not in r.text


def test_dist_files_answer_conditional_requests(spa_client) -> None:
    """A revalidated icon costs a 304, not a re-download — the old bare `FileResponse` always re-sent."""
    first = spa_client.get("/icon-192.png")
    assert "etag" in first.headers
    cached = spa_client.get("/icon-192.png", headers={"if-none-match": first.headers["etag"]})
    assert cached.status_code == 304


def test_a_missing_asset_404s_instead_of_returning_the_shell(spa_client) -> None:
    """A filename-like path is an ASSET request: answering it with HTML is what broke the icons."""
    r = spa_client.get("/icon-typo.png")
    assert r.status_code == 404
    assert r.headers["content-type"].startswith("application/json")


def test_head_is_supported(spa_client) -> None:
    """`@app.get` registers GET only, so the old catch-all answered every HEAD with a 405."""
    assert spa_client.head("/icon-192.png").status_code == 200
    head = spa_client.head("/somepage", headers={"accept": "text/html"})
    assert head.status_code == 200
    assert head.content == b""


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


def test_a_real_api_route_is_not_shadowed(spa_client: TestClient) -> None:
    """The guard route is a catch-all under `/api`, so it must stay LAST. If a router is ever
    registered below it, this fails — which is the entire point of asserting against a real endpoint.

    The assertion is "not the guard's 404", not "200": this fixture builds the app without running the
    lifespan (by design — it is a routing test), so `/api/health` reaches its real handler and then
    fails on the `app.state.db` the lifespan would have set. Reaching the handler at all is exactly the
    invariant under test; a shadowed route would never get there — hence `raise_server_exceptions=False`,
    which turns that downstream failure into a 500 we can distinguish from a 404.
    """
    routed = TestClient(spa_client.app, raise_server_exceptions=False, follow_redirects=False)
    assert routed.get("/api/health").status_code != 404


def test_unknown_api_method_stays_405(spa_client: TestClient) -> None:
    """The guard is GET-only by design. Were HEAD added, the partial match a real GET-only endpoint
    produces would become a FULL match here and answer 404 — claiming a live endpoint does not exist."""
    r = spa_client.post("/api/nonexistent")
    assert r.status_code == 405
    assert r.headers["allow"] == "GET"
    assert spa_client.head("/api/health").status_code == 405


def test_the_guard_routes_stay_out_of_the_openapi_schema(spa_client: TestClient) -> None:
    paths = spa_client.get("/openapi.json").json()["paths"]
    assert "/api/{rest}" not in paths
    assert "/api/health" in paths


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
