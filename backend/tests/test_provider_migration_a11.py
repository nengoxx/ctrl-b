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


# ══════════════════════════ Slice 2 — voice + embeddings folds ══════════════════════════
def _legacy_voice() -> dict:
    return {
        "providers": {  # a Slice-1-migrated chat config already present — voice must merge INTO it
            "llamacpp": {"base_url": "http://l/v1", "api_mode": "llamacpp", "models": {"minig+": {}}}
        },
        "inference": {"provider": "llamacpp"},
        "voice": {
            "enabled": True,
            "stt": {
                "language": "en",
                "primary": {"base_url": "http://emma:9000/v1", "model": "parakeet"},
                "fallback": {"base_url": "http://vault:9000/v1", "model": "whisper-large-v3"},
            },
            "tts": {
                "format": "mp3",
                "primary": {"base_url": "http://emma:9000/v1", "model": "kokoro", "voice": "bf_isabella"},
            },
        },
        "embeddings": {
            "base_url": "https://openrouter.ai/api/v1",
            "api_key": "sk-emb",
            "model": "qwen/embed",
            "dim": 2560,
            "enabled": True,
        },
    }


def test_voice_fold_shape_order_and_speaches_merge() -> None:
    migrated, _slot, _dl = _migrate_legacy(_legacy_voice())
    prov = migrated["providers"]
    # STT primary + TTS primary share http://emma:9000/v1 → ONE provider (host-port slug), TWO models
    assert set(prov["emma-9000"]["models"]) == {"parakeet", "kokoro"}
    assert prov["emma-9000"]["models"]["kokoro"] == {"voice": "bf_isabella"}  # TTS voice on the model entry
    assert set(prov["vault-9000"]["models"]) == {"whisper-large-v3"}
    # merges INTO the pre-existing chat providers map (llamacpp survives)
    assert "llamacpp" in prov
    stt, tts = migrated["voice"]["stt"], migrated["voice"]["tts"]
    assert stt["provider"] == "emma-9000" and stt["model"] == "parakeet"  # 2-model provider → named
    assert [f["provider"] for f in stt["fallbacks"]] == ["vault-9000"]  # order kept
    assert stt["language"] == "en"  # service knob rides through
    assert tts["provider"] == "emma-9000" and tts["model"] == "kokoro" and tts["fallbacks"] == []


def test_embeddings_fold_dim_on_model_and_ref() -> None:
    migrated, _slot, _dl = _migrate_legacy(_legacy_voice())
    prov = migrated["providers"]
    # openrouter.ai slug (no explicit port); the legacy dim lands on the model entry
    assert prov["openrouter.ai"]["models"]["qwen/embed"] == {"dim": 2560}
    assert prov["openrouter.ai"]["api_key"] == "sk-emb"  # secret carried onto the provider
    emb = migrated["embeddings"]
    assert emb["provider"] == "openrouter.ai" and "model" not in emb  # sole model → omitted
    assert emb["enabled"] is True  # service knob rides through
    assert "base_url" not in emb and "dim" not in emb  # legacy endpoint fields gone from the section


def test_voice_embeddings_delete_list() -> None:
    _m, _slot, dl = _migrate_legacy(_legacy_voice())
    assert "voice.stt.primary" in dl and "voice.stt.fallback" in dl
    assert (
        "voice.tts.primary" in dl and "voice.tts.fallback" not in dl
    )  # no tts fallback present → not listed
    assert set(dl) >= {"embeddings.base_url", "embeddings.api_key", "embeddings.model", "embeddings.dim"}


def test_voice_only_legacy_with_newshape_chat_is_per_subtree() -> None:
    # chat already new-shape; only voice legacy → chat untouched, voice folds, idempotent re-run is a no-op
    migrated, slot_map, _dl = _migrate_legacy(_legacy_voice())
    assert slot_map == {}  # no chat fold → no slot map
    assert migrated["inference"] == {"provider": "llamacpp"}  # chat section unchanged
    again, s2, d2 = _migrate_legacy(migrated)
    assert again is migrated and s2 == {} and d2 == []


def test_voice_both_shapes_keeps_new_pointer_untouched() -> None:
    # subtree-level new-wins (the chat/embeddings rule, mirrored): a doc holding BOTH the new `provider`
    # pointer AND stale `primary`/`fallback` slots does NOT fold — the new pointer is never clobbered
    # (legacy ignored, not deleted; the recorded Slice-1 residual class).
    raw = {
        "providers": {"spch": {"base_url": "http://s/v1", "models": {"kokoro": {}}}},
        "inference": {"provider": "spch"},
        "voice": {
            "tts": {
                "provider": "spch",
                "model": "kokoro",
                "primary": {"base_url": "http://old/v1", "model": "tts-1"},
            },
        },
    }
    migrated, _slot, dl = _migrate_legacy(raw)
    assert migrated is raw and dl == []  # no fold fired; the mixed subtree is left as-is


def test_blank_model_voice_uses_role_default_key() -> None:
    raw = {
        "providers": {"llamacpp": {"base_url": "http://l/v1", "api_mode": "llamacpp", "models": {"m": {}}}},
        "inference": {"provider": "llamacpp"},
        "voice": {
            "stt": {"primary": {"base_url": "http://w/v1"}},  # blank model → "whisper-1"
            "tts": {"primary": {"base_url": "http://t/v1"}},  # blank model → "tts-1"
        },
    }
    migrated, _slot, _dl = _migrate_legacy(raw)
    assert "whisper-1" in migrated["providers"]["w"]["models"]
    assert "tts-1" in migrated["providers"]["t"]["models"]
    assert migrated["voice"]["stt"]["provider"] == "w"  # sole model → model omitted in the ref
    assert "model" not in migrated["voice"]["stt"]


def test_blank_model_embeddings_drops() -> None:
    raw = {
        "providers": {"llamacpp": {"base_url": "http://l/v1", "api_mode": "llamacpp", "models": {"m": {}}}},
        "inference": {"provider": "llamacpp"},
        "embeddings": {"base_url": "http://e/v1", "enabled": True},  # no model → never configured → drop
    }
    migrated, _slot, dl = _migrate_legacy(raw)
    # the endpoint is dropped (no provider created for it); the section has no provider pointer
    assert "provider" not in migrated["embeddings"]
    assert not any(p.get("base_url") == "http://e/v1" for p in migrated["providers"].values())
    assert "embeddings.base_url" in dl  # the legacy key is still scheduled for deletion


# ── the voice/embeddings write-back through a settings PUT (F5), on a tmp CTRLB_CONFIG ──
def test_writeback_materializes_voice_embeddings_and_deletes_legacy() -> None:
    tmp = Path(tempfile.mkdtemp())
    cfg = tmp / "config.yaml"
    cfg.write_text(
        "# homelab\n"
        "providers:\n"
        "  llamacpp:\n    base_url: http://l/v1\n    api_mode: llamacpp\n    models:\n      minig+: {}\n"
        "inference:\n  provider: llamacpp\n"
        "voice:\n"
        "  stt:\n    primary:\n      base_url: http://emma:9000/v1\n      model: parakeet\n"
        "  tts:\n    primary:\n      base_url: http://emma:9000/v1\n      model: kokoro\n      voice: bf_isabella\n"
        "embeddings:\n  base_url: https://openrouter.ai/api/v1\n  api_key: sk-EMB\n  model: qwen/embed\n  dim: 2560\n",
        encoding="utf-8",
    )
    os.environ["CTRLB_HOME"] = str(tmp)
    os.environ["CTRLB_CONFIG"] = str(cfg)
    os.environ["CTRLB_DB"] = str(tmp / "t.db")
    try:
        with _client() as c:
            r = c.put("/api/settings", json={"server": {"poll_seconds": 9}})
            assert r.status_code == 200, r.text
            disk = cfg.read_text(encoding="utf-8")
            assert "provider: emma-9000" in disk  # voice sections materialized onto the merged provider
            assert "provider: openrouter.ai" in disk  # embeddings section materialized
            assert "primary:" not in disk  # the legacy voice primary/fallback slots are gone
            assert "sk-EMB" in disk  # the embeddings secret carried onto its provider (base_url stays there)
            assert "# homelab" in disk  # comment preserved
            baks = list(tmp.glob("config.yaml.bak-a11-*"))
            assert len(baks) == 1 and stat.S_IMODE(baks[0].stat().st_mode) == 0o600
            # the running app resolved the merged shape
            s = c.app.state.settings
            assert s.voice.stt.provider == "emma-9000" and s.voice.tts.provider == "emma-9000"
            assert set(s.providers["emma-9000"].models) == {"parakeet", "kokoro"}
            assert s.embeddings.provider == "openrouter.ai"
            assert s.providers["openrouter.ai"].api_key == "sk-EMB"
    finally:
        for k in ("CTRLB_HOME", "CTRLB_CONFIG", "CTRLB_DB"):
            os.environ.pop(k, None)


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
