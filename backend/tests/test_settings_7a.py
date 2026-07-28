"""Phase 7a — settings read/write round-trip tests.

The repo has no pytest harness (CLAUDE.md: "No tests, linter, or CI exist"), so this is written to
run two ways: `python tests/test_settings_7a.py` (plain `assert`s + a `__main__` runner) from the
`backend/` dir, or under pytest if one is ever added (the `test_*` functions are collected as-is).

Covers the audit fixes (see docs/AUDIT_settings.md):
- A1: `save_settings_comment_stripping_for_tests` round-trips a config carrying a `StrEnum` (an `agents[]` privilege) — the bug
  that would `RepresenterError` once agents are configured.
- A2: `unmask_secrets` preserves a real secret when the masked value is echoed back, and accepts a
  genuinely new one.
- The `PUT /api/settings` endpoint: deep-merge, secret preservation, 422 on bad input, and a live
  `poll_seconds` change applied without a restart.
"""

from __future__ import annotations

import os
import tempfile
from pathlib import Path

# --- config-layer tests (no app needed) -------------------------------------------------------
from app.config import (
    Settings,
    _mask,
    apply_patch_to_yaml,
    deep_merge,
    load_settings,
    mask_secrets,
    prune_unchanged,
    save_settings_comment_stripping_for_tests,
    unmask_secrets,
)


def test_save_roundtrips_config() -> None:
    """A1: a representative config saves + reloads cleanly (`mode='json'` keeps every section
    YAML-safe). Agents moved to folders (D14), so the StrEnum-privilege round-trip now lives in
    test_agents_7d; this guards the generic config save/reload + secret survival."""
    with tempfile.TemporaryDirectory() as d:
        p = Path(d) / "config.yaml"
        s = Settings.model_validate(
            {
                "agent": {"default_agent": "ops", "defaults": {"privilege": "full"}},
                "providers": {
                    "local": {"base_url": "http://x/v1", "api_key": "supersecret", "models": {"m": {}}}
                },
                "inference": {"provider": "local"},
            }
        )
        save_settings_comment_stripping_for_tests(s, p)  # must not raise
        reloaded = load_settings(p)
        assert reloaded.agent.default_agent == "ops"
        assert reloaded.agent.defaults["privilege"] == "full"
        assert reloaded.providers["local"].api_key == "supersecret"


def test_integration_risk_coerces_at_the_config_boundary() -> None:
    """Integration-tool `risk` fields are typed `Risk` (not `str`), so a valid low|med|high config
    string coerces to the enum at load and the adapters read `server.risk` directly (no per-adapter
    conversion). Per-field defaults hold: MCP/OpenAPI → MED; open-terminal exec/write → HIGH, read → LOW."""
    from app.domain.enums import Risk

    s = Settings.model_validate(
        {
            "mcp_servers": [{"name": "web", "transport": "streamable_http", "risk": "high"}],
            "openapi_servers": [{"name": "api", "risk": "low"}],
            "open_terminal": {"base_url": "http://x"},  # risks omitted → defaults
        }
    )
    assert s.mcp_servers[0].risk is Risk.HIGH
    assert s.openapi_servers[0].risk is Risk.LOW
    assert s.open_terminal.exec_risk is Risk.HIGH  # default
    assert s.open_terminal.write_risk is Risk.HIGH  # default
    assert s.open_terminal.read_risk is Risk.LOW  # default
    # omitted MCP risk → the field default (MED), same as the old `.get(..., Risk.MED)` fallback
    plain = Settings.model_validate({"mcp_servers": [{"name": "y", "transport": "streamable_http"}]})
    assert plain.mcp_servers[0].risk is Risk.MED


def test_invalid_risk_fails_fast() -> None:
    """A typo'd risk (`hihg`) must raise at load, not silently default — the whole point of coercing
    at the boundary (a silent default would quietly weaken the confirm gate for that server)."""
    raised = False
    try:
        Settings.model_validate(
            {"mcp_servers": [{"name": "bad", "transport": "streamable_http", "risk": "hihg"}]}
        )
    except Exception:  # pydantic ValidationError (kept broad so the test runs standalone too)
        raised = True
    assert raised, "an invalid risk string must fail validation, not silently default to MED/HIGH"


def test_risk_roundtrips_to_string_in_yaml() -> None:
    """save→reload keeps risk as its `low|med|high` string (`mode='json'` StrEnum dump), so the YAML
    stays human-editable and the reload re-coerces to the enum — the same StrEnum round-trip as A1."""
    from app.domain.enums import Risk

    with tempfile.TemporaryDirectory() as d:
        p = Path(d) / "config.yaml"
        s = Settings.model_validate({"open_terminal": {"base_url": "http://x", "exec_risk": "med"}})
        save_settings_comment_stripping_for_tests(s, p)
        assert "exec_risk: med" in p.read_text(encoding="utf-8")  # the string, not "Risk.MED"
        assert load_settings(p).open_terminal.exec_risk is Risk.MED  # re-coerced on reload


def test_unmask_preserves_and_updates() -> None:
    """A2: masked/blank secret → keep stored; a new value → take it."""
    stored = {"inference": {"local": {"api_key": "REALKEY-123", "model": "m"}}}
    masked = mask_secrets(stored)
    assert masked["inference"]["local"]["api_key"] == _mask("REALKEY-123")

    # echo the masked value back → preserve the real one
    restored = unmask_secrets(masked, stored)
    assert restored["inference"]["local"]["api_key"] == "REALKEY-123"

    # a genuinely new value → keep it
    changed = unmask_secrets({"inference": {"local": {"api_key": "NEWKEY-999", "model": "m"}}}, stored)
    assert changed["inference"]["local"]["api_key"] == "NEWKEY-999"

    # empty string → treated as unchanged (don't wipe a credential with "")
    blanked = unmask_secrets({"inference": {"local": {"api_key": ""}}}, stored)
    assert blanked["inference"]["local"]["api_key"] == "REALKEY-123"


def test_deep_merge_partial() -> None:
    base = {"server": {"port": 5433, "poll_seconds": 5}, "inference": {"default_mode": "local"}}
    out = deep_merge(base, {"server": {"poll_seconds": 9}})
    assert out["server"] == {"port": 5433, "poll_seconds": 9}  # other key untouched
    assert out["inference"] == {"default_mode": "local"}  # other section untouched


def test_prune_unchanged() -> None:
    current = {"server": {"port": 5433, "poll_seconds": 5}, "inference": {"default_mode": "local"}}
    # whole groups submitted, only poll_seconds changed
    patch = {"server": {"port": 5433, "poll_seconds": 9}, "inference": {"default_mode": "local"}}
    assert prune_unchanged(patch, current) == {"server": {"poll_seconds": 9}}


def test_apply_patch_preserves_comments() -> None:
    """C1: editing one leaf keeps comments, key order, quoting + untouched sections verbatim."""
    with tempfile.TemporaryDirectory() as d:
        p = Path(d) / "config.yaml"
        original = (
            "# top comment\n"
            "server:\n"
            "  host: 127.0.0.1   # bind\n"
            "  poll_seconds: 5\n"
            "# inference section\n"
            "inference:\n"
            "  cloud:\n"
            '    api_key: "sk-real-123"   # secret\n'
            "  model: minig+\n"
        )
        p.write_text(original, encoding="utf-8")
        apply_patch_to_yaml({"server": {"poll_seconds": 9}}, p)
        out = p.read_text(encoding="utf-8")
        assert "# top comment" in out
        assert "# inference section" in out
        assert "# bind" in out
        assert "poll_seconds: 9" in out
        assert 'api_key: "sk-real-123"   # secret' in out  # untouched secret line verbatim
        assert "host: 127.0.0.1" in out  # sibling untouched


def test_apply_patch_preserves_line_endings() -> None:
    """A Windows host must not silently rewrite an LF config to CRLF (would churn every line)."""
    with tempfile.TemporaryDirectory() as d:
        for raw, label in (
            (b"server:\n  poll_seconds: 5\n", "LF"),
            (b"server:\r\n  poll_seconds: 5\r\n", "CRLF"),
        ):
            p = Path(d) / f"cfg_{label}.yaml"
            p.write_bytes(raw)
            apply_patch_to_yaml({"server": {"poll_seconds": 9}}, p)
            data = p.read_bytes()
            crlf = data.count(b"\r\n")
            if label == "LF":
                assert crlf == 0, "LF file must stay LF"
            else:
                assert crlf == data.count(b"\n"), "CRLF file must stay CRLF"
            assert b"poll_seconds: 9" in data.replace(b"\r\n", b"\n")


# --- API tests (TestClient over a temp config + db, no network) -----------------------------


def _client():
    from fastapi.testclient import TestClient

    from app.main import create_app

    return TestClient(create_app())


def test_api_get_put_roundtrip() -> None:
    tmp = Path(tempfile.mkdtemp())
    cfg = tmp / "config.yaml"
    # Minimal config: no mcp_servers/searxng/etc., so lifespan does zero network discovery.
    cfg.write_text(
        "# my homelab config\n"
        "server:\n  port: 5433\n  poll_seconds: 5\n"
        "providers:\n  local:\n    base_url: http://x/v1\n    api_key: REALKEY-123\n    models:\n      m: {}\n"
        "inference:\n  provider: local\n",
        encoding="utf-8",
    )
    os.environ["CTRLB_CONFIG"] = str(cfg)
    os.environ["CTRLB_DB"] = str(tmp / "t.db")
    try:
        with _client() as c:
            got = c.get("/api/settings").json()
            assert got["providers"]["local"]["api_key"] == _mask("REALKEY-123")  # masked on read
            rev = c.get("/api/providers").json()["rev"]  # A11/D48 C2: the providers base fingerprint

            # change poll_seconds + echo the masked providers map back unchanged (replacement semantics).
            # A `providers`-carrying PUT must present the current base fingerprint (concurrency 409 guard).
            r = c.put(
                "/api/settings",
                json={
                    "server": {"poll_seconds": 9},
                    "providers_base": rev,
                    "providers": {
                        "local": {
                            "base_url": "http://x/v1",
                            "api_key": got["providers"]["local"]["api_key"],
                            "models": {"m": {}},
                        }
                    },
                },
            )
            assert r.status_code == 200, r.text
            body = r.json()
            assert body["settings"]["server"]["poll_seconds"] == 9
            assert body["restart_required"] == []  # poll_seconds applies live

            # the real secret survived on disk (not overwritten with the mask)
            assert load_settings(cfg).providers["local"].api_key == "REALKEY-123"
            # the comment + the untouched secret line survived the save (C1)
            disk = cfg.read_text(encoding="utf-8")
            assert "# my homelab config" in disk
            assert "api_key: REALKEY-123" in disk
            # and it applied live to the running app's shared settings
            assert c.app.state.settings.server.poll_seconds == 9

            # changing the port flags a restart
            r2 = c.put("/api/settings", json={"server": {"port": 5500}})
            assert r2.json()["restart_required"] == ["server.port"]

            # a bad value → 422, not 500
            r3 = c.put("/api/settings", json={"server": {"port": "not-a-number"}})
            assert r3.status_code == 422, r3.text
    finally:
        os.environ.pop("CTRLB_CONFIG", None)
        os.environ.pop("CTRLB_DB", None)


def test_tool_overrides_put_is_gated_on_a_live_turn() -> None:
    """SYS-3 / ACA-17: a `tool_overrides` PUT mutates the live registry (`apply_tool_overrides`), so it
    is refused 409 while ANY thread holds a turn marker (D38/S2-B busy-truth) — and nothing is written
    to disk. Non-registry writes (appearance) pass through mid-turn: the gate is key-scoped on purpose,
    because appearance sync is frequent + cross-device."""
    tmp = Path(tempfile.mkdtemp())
    cfg = tmp / "config.yaml"
    cfg.write_text("server:\n  poll_seconds: 5\n", encoding="utf-8")
    os.environ["CTRLB_CONFIG"] = str(cfg)
    os.environ["CTRLB_DB"] = str(tmp / "t.db")
    try:
        with _client() as c:
            from app.services.agent.turns import reserve

            before = cfg.read_text(encoding="utf-8")
            reserve(c.app.state.turns, "some-thread", "chat")  # a live turn on some thread

            r = c.put("/api/settings", json={"tool_overrides": {"web_search": {"description": "nope"}}})
            assert r.status_code == 409, r.text
            assert r.json()["detail"] == "agent is busy — try again in a moment"
            assert cfg.read_text(encoding="utf-8") == before  # nothing persisted
            assert "web_search" not in c.app.state.settings.tool_overrides

            # anti-regression: a NON-tool_overrides write still succeeds mid-turn
            r_app = c.put("/api/settings", json={"appearance": {"theme": "vapor"}})
            assert r_app.status_code == 200, r_app.text
            assert c.app.state.settings.appearance.theme == "vapor"

            # turn over → the same tool_overrides PUT applies
            c.app.state.turns.clear()
            r2 = c.put("/api/settings", json={"tool_overrides": {"web_search": {"description": "nope"}}})
            assert r2.status_code == 200, r2.text
            assert c.app.state.settings.tool_overrides["web_search"].description == "nope"
            assert "tool_overrides" in cfg.read_text(encoding="utf-8")
    finally:
        os.environ.pop("CTRLB_CONFIG", None)
        os.environ.pop("CTRLB_DB", None)


if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    for fn in fns:
        fn()
        print(f"ok  {fn.__name__}")
    print(f"\n{len(fns)} passed")
