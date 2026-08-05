"""Phase 11 / D28 — appearance (theme-engine cross-device sync) backend tests.

Runs two ways like the rest of the suite: `python tests/test_appearance_d28.py` from `backend/`, or
under pytest. Covers (§9.11/§9.9):
- `AppearanceCfg` defaults mirror the frontend `ui` store (cosmos/dark/violet, no timestamp).
- `GET /api/appearance` returns just the selection block; `PUT /api/settings {appearance}` round-trips,
  server-stamps `updated_at`, persists it to YAML (survives restart), and applies live.
- `ComputerCfg.appearance` (the open per-host override blob) round-trips through save/load unchanged
  (no per-theme schema on the server — open pass-through).

All file I/O is against a temp config (never the real `config.yaml`) via `CTRLB_CONFIG`/`CTRLB_DB`.
"""

from __future__ import annotations

import os
import tempfile
from pathlib import Path

from app.config import Settings, load_settings, save_settings_comment_stripping_for_tests


def test_appearance_defaults_config_layer() -> None:
    s = Settings()
    assert s.appearance.theme == "cosmos"  # D51 V0 — mirrors the FE DEFAULT_THEME (was vapor)
    assert s.appearance.mode == "dark"
    assert s.appearance.accent == "violet"
    assert s.appearance.motion is None  # M3: unseeded → client keeps local until first authored
    assert s.appearance.perf is None
    assert s.appearance.theme_settings is None  # M3: open per-theme options map, unseeded until written
    assert s.appearance.updated_at is None  # stamped only on first write


def test_computer_appearance_field_roundtrips() -> None:
    """The open per-host override blob (D28 §9.9) survives save/load with arbitrary theme keys — proves
    the pass-through (no per-theme Pydantic union that would force a server change per theme).

    The frontier arm is `{x, y}` since D53 M2 RETIRED `appearance.frontier.image` (the owner's
    `media/frontier/rigs/` pool replaces it). Nothing on this side typed the blob, so a config still
    carrying an `image` key round-trips too — it simply reaches no reader."""
    with tempfile.TemporaryDirectory() as d:
        p = Path(d) / "config.yaml"
        s = Settings.model_validate(
            {
                "computers": {
                    "corsair": {
                        "ip": "10.0.0.5",
                        "appearance": {
                            "frontier": {"x": 40, "y": 55},
                            "cosmos": {"color": "#aabbcc", "size": 3},
                        },
                    }
                }
            }
        )
        save_settings_comment_stripping_for_tests(s, p)
        reloaded = load_settings(p)
        appearance = reloaded.computers["corsair"].appearance
        assert appearance["frontier"] == {"x": 40, "y": 55}
        assert appearance["cosmos"] == {"color": "#aabbcc", "size": 3}


# --- API tests (TestClient over a temp config + db, no network) -----------------------------


def _client():
    from fastapi.testclient import TestClient

    from app.main import create_app

    return TestClient(create_app())


def test_api_appearance_get_and_put_roundtrip() -> None:
    tmp = Path(tempfile.mkdtemp())
    cfg = tmp / "config.yaml"
    # Minimal config (no mcp/searxng) → lifespan does no network discovery. No appearance block yet.
    cfg.write_text(
        "# homelab\nserver:\n  port: 5433\n  poll_seconds: 5\n",
        encoding="utf-8",
    )
    os.environ["CTRLB_CONFIG"] = str(cfg)
    os.environ["CTRLB_DB"] = str(tmp / "t.db")
    try:
        with _client() as c:
            # Defaults before any write.
            got = c.get("/api/appearance").json()
            assert got == {
                "theme": "cosmos",
                "mode": "dark",
                "accent": "violet",
                "motion": None,  # unseeded → client keeps local until first authored
                "perf": None,
                "theme_settings": None,
                "updated_at": None,
            }

            # Client writes the full selection incl. the open per-theme map (M3 §14.3) + levers.
            r = c.put(
                "/api/settings",
                json={
                    "appearance": {
                        "theme": "minimal",
                        "mode": "light",
                        "accent": "indigo",
                        "motion": "reduced",
                        "perf": "lite",
                        "theme_settings": {"minimal": {"hideAppbar": True}},
                    }
                },
            )
            assert r.status_code == 200, r.text
            saved = r.json()["settings"]["appearance"]
            assert saved["theme"] == "minimal"
            assert saved["mode"] == "light"
            assert saved["accent"] == "indigo"
            assert saved["motion"] == "reduced"
            assert saved["perf"] == "lite"
            assert saved["theme_settings"] == {"minimal": {"hideAppbar": True}}
            assert saved["updated_at"] is not None  # server-stamped

            # GET reflects it (the cheap always-on read the ui store reconciles against).
            assert c.get("/api/appearance").json()["theme"] == "minimal"
            # Applied live to the running app.
            assert c.app.state.settings.appearance.theme == "minimal"

            # Persisted to YAML *with* the stamp → survives a restart (the LWW timestamp isn't lost).
            reloaded = load_settings(cfg)
            assert reloaded.appearance.theme == "minimal"
            assert reloaded.appearance.accent == "indigo"
            assert reloaded.appearance.updated_at is not None

            # A second write re-stamps a newer time (monotonic-ish; at least not older).
            first_stamp = reloaded.appearance.updated_at
            r2 = c.put(
                "/api/settings", json={"appearance": {"theme": "vapor", "mode": "dark", "accent": "aqua"}}
            )
            assert r2.status_code == 200, r2.text
            assert load_settings(cfg).appearance.updated_at >= first_stamp
    finally:
        os.environ.pop("CTRLB_CONFIG", None)
        os.environ.pop("CTRLB_DB", None)


if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    for fn in fns:
        fn()
        print(f"ok  {fn.__name__}")
    print(f"\n{len(fns)} passed")
