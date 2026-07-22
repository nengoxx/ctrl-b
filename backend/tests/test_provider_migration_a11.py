"""A11/D48 — the quarantined legacy->new inference migration (`_migrate_legacy`) + the write-back.

shape conversion · [selected, other, *fallbacks] order · name derivation + collision suffixes ·
dedup-by-identity merge · idempotency · delete-list · the four ModelRef home rewrites (incl. the global
summarizer) · the agent.yaml mode->provider fold + slot_map · the legacy-key write-back + 0600
`.bak-a11-*` backup on a tmp CTRLB_CONFIG.
"""

from __future__ import annotations

import os
import stat
import tempfile
from pathlib import Path

import app.config as config
from app.config import _fold_agent_yaml_modes, _migrate_legacy, walk_model_refs


def _legacy() -> dict:
    return {
        "inference": {
            "default_mode": "local",
            "request_timeout_s": 600,
            "local": {
                "base_url": "http://192.168.1.137:5001/v1",
                "model": "minig+",
                "api_mode": "llamacpp",
                "max_concurrent_requests": 1,
                "context_window": 32768,
                "extra_body": {"cache_prompt": True},
            },
            "cloud": {
                "base_url": "https://openrouter.ai/api/v1",
                "api_key": "sk-x",
                "model": "qwen/qwen3.5-72b",
                "api_mode": "openrouter",
            },
            "fallbacks": [{"base_url": "http://fb/v1", "model": "fbm"}],
        },
        "agent": {
            "defaults": {
                "model": {"mode": "local", "model": "minig+"},
                "compaction": {"summarizer": {"mode": "cloud"}},
                "routing": {"lead": {"mode": "cloud", "model": "big"}},
            },
            "compaction": {"summarizer": {"mode": "local"}},
        },
    }


def test_shape_conversion_and_slot_map() -> None:
    migrated, slot_map, delete_list = _migrate_legacy(_legacy())
    assert set(migrated["providers"]) == {"llamacpp", "openrouter", "openai"}  # names derived from api_mode
    assert slot_map == {"local": "llamacpp", "cloud": "openrouter"}
    prov = migrated["providers"]
    assert prov["llamacpp"]["base_url"] == "http://192.168.1.137:5001/v1"
    assert prov["llamacpp"]["api_mode"] == "llamacpp" and prov["llamacpp"]["max_concurrent_requests"] == 1
    assert prov["llamacpp"]["models"]["minig+"] == {
        "context_window": 32768,
        "extra_body": {"cache_prompt": True},
    }
    assert prov["openrouter"]["api_key"] == "sk-x"  # secret carried onto the provider
    # inference section: provider primary + [selected, other, *fallbacks] order, models omitted (sole)
    inf = migrated["inference"]
    assert inf["provider"] == "llamacpp" and "model" not in inf  # llamacpp has one model → omitted
    assert [f["provider"] for f in inf["fallbacks"]] == ["openrouter", "openai"]
    assert inf["request_timeout_s"] == 600  # a preserved section knob rides through
    assert delete_list == ["inference.default_mode", "inference.local", "inference.cloud"]


def test_modelref_home_rewrites_all_four() -> None:
    migrated, _slot, _del = _migrate_legacy(_legacy())
    d = migrated["agent"]["defaults"]
    assert d["model"] == {"provider": "llamacpp", "model": "minig+"} and "mode" not in d["model"]
    assert d["compaction"]["summarizer"] == {"provider": "openrouter"}
    assert d["routing"]["lead"] == {"provider": "openrouter", "model": "big"}
    # the GLOBAL agent.compaction.summarizer (config.py:320 home)
    assert migrated["agent"]["compaction"]["summarizer"] == {"provider": "llamacpp"}


def test_idempotent_second_run_is_a_noop() -> None:
    migrated, _slot, _del = _migrate_legacy(_legacy())
    again, slot2, del2 = _migrate_legacy(migrated)
    assert again is migrated and slot2 == {} and del2 == []  # new-shape present → no-op


def test_name_collision_suffixes() -> None:
    raw = {
        "inference": {
            "default_mode": "local",
            "local": {"base_url": "http://a/v1", "model": "x", "api_mode": "openai"},
            "cloud": {"base_url": "http://b/v1", "model": "y", "api_mode": "openai"},
        }
    }
    migrated, slot_map, _del = _migrate_legacy(raw)
    assert set(migrated["providers"]) == {"openai", "openai-2"}
    assert slot_map == {"local": "openai", "cloud": "openai-2"}


def test_dedup_by_identity_merges_models() -> None:
    raw = {
        "inference": {
            "default_mode": "local",
            "local": {"base_url": "http://l/v1", "model": "m", "api_mode": "llamacpp"},
            "cloud": {"base_url": "http://o/v1", "api_key": "k", "model": "c1", "api_mode": "openrouter"},
            "fallbacks": [
                {"base_url": "http://o/v1", "api_key": "k", "model": "c2", "api_mode": "openrouter"}
            ],
        }
    }
    migrated, _slot, _del = _migrate_legacy(raw)
    # cloud + the fallback share (canonical base_url, api_key) → ONE provider carrying both models
    assert set(migrated["providers"]["openrouter"]["models"]) == {"c1", "c2"}
    inf = migrated["inference"]
    # chain order [selected=local, other=cloud/c1, fallback/c2] preserved; the merged provider has 2
    # models so each openrouter ref NAMES its model (identity dedup is a RESOLUTION concern, not migration)
    assert inf["provider"] == "llamacpp"
    assert inf["fallbacks"] == [
        {"provider": "openrouter", "model": "c1"},
        {"provider": "openrouter", "model": "c2"},
    ]


def test_agent_yaml_mode_fold_uses_slot_map() -> None:
    config._SLOT_MAP = {"local": "llamacpp", "cloud": "openrouter"}
    try:
        raw = {
            "model": {"mode": "local", "model": "minig+"},
            "compaction": {"summarizer": {"mode": "cloud"}},
            "routing": {"lead": {"mode": "unknownprov"}},
        }
        folded = _fold_agent_yaml_modes(raw)
        assert folded["model"] == {"provider": "llamacpp", "model": "minig+"}
        assert folded["compaction"]["summarizer"] == {"provider": "openrouter"}
        # an unmapped string is kept verbatim (a possibly-dangling ref → graceful default at resolve)
        assert folded["routing"]["lead"] == {"provider": "unknownprov"}
    finally:
        config._SLOT_MAP = {}


def test_walk_model_refs_visits_the_closed_list() -> None:
    seen: list[dict] = []
    doc = {
        "agent": {
            "defaults": {
                "model": {"provider": "a"},
                "compaction": {"summarizer": {"provider": "b"}},
                "routing": {"lead": {"provider": "c"}},
            },
            "compaction": {"summarizer": {"provider": "d"}},
        }
    }
    walk_model_refs(doc, seen.append)
    assert sorted(r["provider"] for r in seen) == ["a", "b", "c", "d"]


def test_agent_from_pointer_half_atomic_merge() -> None:
    # FX8 (audit L2): a `ModelRef.model` clean name is provider-relative. When agent.yaml points
    # `model.provider` at a DIFFERENT provider than the default and does NOT set its own model, the
    # inherited model must be DROPPED (never carried across providers as a raw wire id).
    from app.config import Settings

    s = Settings(agent={"defaults": {"model": {"provider": "a", "model": "m1"}}})
    folder = Path(tempfile.mkdtemp())
    diff = s._agent_from("x", folder, {"model": {"provider": "b"}})
    assert diff.model.provider == "b" and diff.model.model is None  # inherited m1 dropped
    same = s._agent_from("x", folder, {"model": {"reasoning_effort": "high"}})
    assert same.model.provider == "a" and same.model.model == "m1"  # provider unchanged → keep
    own = s._agent_from("x", folder, {"model": {"provider": "b", "model": "m2"}})
    assert own.model.provider == "b" and own.model.model == "m2"  # override sets its own → keep


def test_no_op_when_no_legacy_keys() -> None:
    raw = {"inference": {"request_timeout_s": 600}}  # no local/cloud/fallbacks
    migrated, slot_map, delete_list = _migrate_legacy(raw)
    assert migrated is raw and slot_map == {} and delete_list == []


# ── the write-back + 0600 backup on a tmp CTRLB_CONFIG (F5) ───────────────────────────────────────
def _client():
    from fastapi.testclient import TestClient

    from app.main import create_app

    return TestClient(create_app())


def test_writeback_materializes_new_shape_and_writes_0600_backup() -> None:
    tmp = Path(tempfile.mkdtemp())
    cfg = tmp / "config.yaml"
    cfg.write_text(
        "# homelab\n"
        "server:\n  port: 5433\n  poll_seconds: 5\n"
        "inference:\n"
        "  default_mode: local\n"
        "  local:\n    base_url: http://l/v1\n    model: minig+\n    api_mode: llamacpp\n"
        "  cloud:\n    base_url: http://o/v1\n    api_key: sk-REAL\n    model: qwen\n    api_mode: openrouter\n",
        encoding="utf-8",
    )
    os.environ["CTRLB_HOME"] = str(tmp)
    os.environ["CTRLB_CONFIG"] = str(cfg)
    os.environ["CTRLB_DB"] = str(tmp / "t.db")
    try:
        with _client() as c:
            # boot migrated in memory; a trivial PUT triggers the ONE atomic write-back + backup.
            r = c.put("/api/settings", json={"server": {"poll_seconds": 9}})
            assert r.status_code == 200, r.text
            disk = cfg.read_text(encoding="utf-8")
            assert "providers:" in disk and "provider: llamacpp" in disk  # new shape materialized
            assert "default_mode" not in disk and "\n  local:" not in disk  # legacy keys deleted
            assert "sk-REAL" in disk  # the real secret was carried onto the provider, not lost
            assert "# homelab" in disk  # comment preserved (ruamel round-trip)
            baks = list(tmp.glob("config.yaml.bak-a11-*"))
            assert len(baks) == 1
            assert stat.S_IMODE(baks[0].stat().st_mode) == 0o600  # 0600 pre-migration backup
            assert "default_mode: local" in baks[0].read_text(encoding="utf-8")  # backup is the OLD file
            # the running app reloaded the new shape
            assert c.app.state.settings.inference.provider == "llamacpp"
            assert c.app.state.settings.providers["openrouter"].api_key == "sk-REAL"
    finally:
        for k in ("CTRLB_HOME", "CTRLB_CONFIG", "CTRLB_DB"):
            os.environ.pop(k, None)
