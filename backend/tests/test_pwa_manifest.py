"""D59 / W5 — the installed-icon backdrop: the manifest rewrite, its route, and the config gate.

The load-bearing property is that the SERVED manifest changes when the owner picks a variant — Chrome
144+ never re-downloads an icon URL it already minted, so a same-URL byte change is invisible to an
installed app and only a changed `src` (and the ETag that moves with it) can ever reach the phone.

Four layers, in order: the pure rewrite, the id → filename lookup, the route (fake dist, no build), and
the config write on a TEMP config (never the real `config.yaml`).
"""

from __future__ import annotations

import json
import os
import re
import tempfile
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.config import Settings, load_settings
from app.core.pwa import (
    DEFAULT_PWA_ICON_BG,
    PWA_ICON_VARIANTS,
    if_none_match_matches,
    maskable_src,
    patch_manifest,
)

#: A manifest shaped like the built one (`frontend/vite.config.ts`): three `any` icons + one maskable.
BASE_MANIFEST = {
    "name": "ctrl-b",
    "short_name": "ctrl-b",
    "theme_color": "#0a0a0d",
    "display": "standalone",
    "icons": [
        {"src": "/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any"},
        {"src": "/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any"},
        {
            "src": "/icon-maskable-512.png",
            "sizes": "512x512",
            "type": "image/png",
            "purpose": "maskable",
        },
    ],
}


# ── the pure rewrite ───────────────────────────────────────────────────────────────────────────────


@pytest.mark.parametrize("variant", sorted(PWA_ICON_VARIANTS))
def test_patch_manifest_rewrites_only_the_maskable_icon(variant: str) -> None:
    out = patch_manifest(BASE_MANIFEST, variant)
    assert out["icons"][0] == BASE_MANIFEST["icons"][0]  # the `any` icons stay transparent (R28 §9.1)
    assert out["icons"][1] == BASE_MANIFEST["icons"][1]
    maskable = out["icons"][2]
    assert maskable["src"] == f"/{PWA_ICON_VARIANTS[variant]}"
    # Everything else about the entry — and the rest of the doc — is carried through untouched.
    assert {k: v for k, v in maskable.items() if k != "src"} == {
        k: v for k, v in BASE_MANIFEST["icons"][2].items() if k != "src"
    }
    assert {k: v for k, v in out.items() if k != "icons"} == {
        k: v for k, v in BASE_MANIFEST.items() if k != "icons"
    }
    assert BASE_MANIFEST["icons"][2]["src"] == "/icon-maskable-512.png"  # the input is never mutated


def test_patch_manifest_default_keeps_todays_filename() -> None:
    """`None` (unseeded) must yield the PRE-W5 file — an owner who never touches the setting gets the
    same URL and the same bytes, so Chrome has no update to suggest."""
    assert patch_manifest(BASE_MANIFEST, None) == BASE_MANIFEST
    assert patch_manifest(BASE_MANIFEST, DEFAULT_PWA_ICON_BG) == BASE_MANIFEST


@pytest.mark.parametrize(
    "doc",
    [
        {"name": "ctrl-b"},  # no icons key at all — the shape `test_frontend_serving_sys5` fixtures
        {"name": "ctrl-b", "icons": []},
        {"name": "ctrl-b", "icons": [{"src": "/icon-192.png", "purpose": "any"}]},
    ],
)
def test_patch_manifest_is_a_noop_without_a_maskable_entry(doc: dict) -> None:
    assert patch_manifest(doc, "ink") == doc


# ── the lookup ─────────────────────────────────────────────────────────────────────────────────────

_SRC_RE = re.compile(r"^/icon-maskable-512(-[a-z]+)?\.png$")


@pytest.mark.parametrize("variant", sorted(PWA_ICON_VARIANTS))
def test_maskable_src_derives_a_root_relative_icon_url(variant: str) -> None:
    assert _SRC_RE.match(maskable_src(variant)), maskable_src(variant)


@pytest.mark.parametrize(
    ("header", "expected"),
    [
        (None, False),
        ("", False),
        ('"abc"', True),
        ('W/"abc"', True),  # weak comparison — the right one for a GET precondition
        ("*", True),
        ('"x", W/"abc"', True),  # a list, and the match is not the first entry
        ('"x"', False),
        ('"abcd"', False),  # no prefix matching
    ],
)
def test_if_none_match_matches_uses_weak_comparison(header: str | None, expected: bool) -> None:
    assert if_none_match_matches(header, '"abc"') is expected


def test_maskable_src_falls_back_instead_of_raising() -> None:
    """Degrade, never brick: `AppearanceCfg`'s validator is the input gate (see the 422 test below), so
    anything reaching here with a bad id is a bug we would rather serve a WORKING manifest through — a
    500 on this one file is an installed app that can never update itself again."""
    assert maskable_src("nope") == maskable_src(None) == "/icon-maskable-512.png"


# ── the route ──────────────────────────────────────────────────────────────────────────────────────


@pytest.fixture
def manifest_client(tmp_path, monkeypatch):
    """A prod-shaped serve over a FAKE dist (the `test_frontend_serving_sys5` fixture pattern) — no
    frontend build needed, and the variant PNGs are zero-byte stand-ins: the route only stats them."""
    import app.main as main

    dist = tmp_path / "dist"
    dist.mkdir()
    (dist / "index.html").write_text("<!doctype html><title>ctrl-b</title>", encoding="utf-8")
    (dist / "manifest.webmanifest").write_text(json.dumps(BASE_MANIFEST), encoding="utf-8")
    for filename in PWA_ICON_VARIANTS.values():
        (dist / filename).write_bytes(b"png")
    monkeypatch.setattr(main, "_FRONTEND_DIST", dist)
    app = main.create_app()
    # The route reads `app.state.settings`, which lifespan normally fills. Seeding a bare `Settings`
    # keeps this test off the real config AND off the DB/network the full lifespan would start.
    app.state.settings = Settings()
    return TestClient(app), dist


def _maskable(body: str) -> str:
    return next(i["src"] for i in json.loads(body)["icons"] if i["purpose"] == "maskable")


def test_manifest_route_serves_the_default_with_its_headers(manifest_client) -> None:
    client, _ = manifest_client
    r = client.get("/manifest.webmanifest")
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("application/manifest+json")
    assert r.headers["cache-control"] == "no-cache"
    assert r.headers["x-content-type-options"] == "nosniff"
    assert r.headers["etag"].startswith('"')
    assert _maskable(r.text) == "/icon-maskable-512.png"


def test_a_variant_change_is_hot_and_moves_the_etag(manifest_client) -> None:
    """No restart: the route reads the LIVE settings object `reconfigure` rebinds on every save."""
    client, _ = manifest_client
    before = client.get("/manifest.webmanifest")
    client.app.state.settings.appearance.pwa_icon_background = "orchid"
    after = client.get("/manifest.webmanifest")
    assert _maskable(after.text) == "/icon-maskable-512-orchid.png"
    assert after.headers["etag"] != before.headers["etag"]  # or the phone keeps revalidating to 304


@pytest.mark.parametrize("sent", ["{etag}", "W/{etag}", "*", '"other", {etag}'])
def test_if_none_match_round_trips_to_304(manifest_client, sent: str) -> None:
    """Weak comparison is the correct one for a GET precondition (RFC 9110 §13.1.2), so a `W/`-prefixed
    tag, `*`, and a comma-separated list all have to hit the 304."""
    client, _ = manifest_client
    etag = client.get("/manifest.webmanifest").headers["etag"]
    r = client.get("/manifest.webmanifest", headers={"if-none-match": sent.format(etag=etag)})
    assert r.status_code == 304
    assert r.content == b""
    assert r.headers["etag"] == etag
    assert r.headers["cache-control"] == "no-cache"
    assert "content-type" not in r.headers  # a 304 carries no body → no Content-Type (RFC 9110 §15.4.5)


def test_a_non_matching_if_none_match_still_serves_200(manifest_client) -> None:
    client, _ = manifest_client
    r = client.get("/manifest.webmanifest", headers={"if-none-match": '"stale"'})
    assert r.status_code == 200


def test_head_answers_with_the_gets_headers_and_no_body(manifest_client) -> None:
    """A HEAD must not 405 (an installed app's update check may probe it) and must not carry a body —
    Starlette does not strip one for us."""
    client, _ = manifest_client
    get, head = client.get("/manifest.webmanifest"), client.head("/manifest.webmanifest")
    assert head.status_code == 200
    assert head.content == b""
    for header in ("content-type", "cache-control", "etag", "x-content-type-options", "content-length"):
        assert head.headers[header] == get.headers[header]


def test_a_variant_missing_from_the_build_falls_back_to_the_default(tmp_path, monkeypatch) -> None:
    """A build that shipped without one of the PNGs must degrade to the old look, not point an installed
    app at a 404 (the startup `is_file` check)."""
    import app.main as main

    dist = tmp_path / "dist"
    dist.mkdir()
    (dist / "index.html").write_text("<!doctype html>", encoding="utf-8")
    (dist / "manifest.webmanifest").write_text(json.dumps(BASE_MANIFEST), encoding="utf-8")
    (dist / PWA_ICON_VARIANTS[DEFAULT_PWA_ICON_BG]).write_bytes(b"png")  # only the default shipped
    monkeypatch.setattr(main, "_FRONTEND_DIST", dist)
    app = main.create_app()
    app.state.settings = Settings.model_validate({"appearance": {"pwa_icon_background": "paper"}})
    r = TestClient(app).get("/manifest.webmanifest")
    assert r.status_code == 200
    assert _maskable(r.text) == "/icon-maskable-512.png"


# ── the config write (TEMP config — never the real one) ────────────────────────────────────────────


def test_settings_put_accepts_a_known_variant_and_rejects_anything_else() -> None:
    from app.main import create_app

    tmp = Path(tempfile.mkdtemp())
    cfg = tmp / "config.yaml"
    cfg.write_text("server:\n  port: 5433\n", encoding="utf-8")  # minimal → no discovery in lifespan
    os.environ["CTRLB_CONFIG"] = str(cfg)
    os.environ["CTRLB_DB"] = str(tmp / "t.db")
    try:
        with TestClient(create_app()) as c:
            r = c.put("/api/settings", json={"appearance": {"pwa_icon_background": "ink"}})
            assert r.status_code == 200, r.text
            assert r.json()["restart_required"] == []  # the manifest is rebuilt per request
            assert load_settings(cfg).appearance.pwa_icon_background == "ink"  # persisted to YAML
            got = c.get("/api/appearance").json()
            assert got["pwa_icon_background"] == "ink"
            assert got["updated_at"] is not None  # rides the appearance LWW stamp

            # A closed allowlist: the value names a variant, never a path.
            for bad in ("../../etc/passwd", "nope"):
                assert (
                    c.put("/api/settings", json={"appearance": {"pwa_icon_background": bad}}).status_code
                    == 422
                )
            assert load_settings(cfg).appearance.pwa_icon_background == "ink"  # unchanged by the 422s
    finally:
        os.environ.pop("CTRLB_CONFIG", None)
        os.environ.pop("CTRLB_DB", None)
