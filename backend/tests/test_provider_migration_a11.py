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
    diff = s.agent_from("x", folder, {"model": {"provider": "b"}})
    assert diff.model.provider == "b" and diff.model.model is None  # inherited m1 dropped
    same = s.agent_from("x", folder, {"model": {"reasoning_effort": "high"}})
    assert same.model.provider == "a" and same.model.model == "m1"  # provider unchanged → keep
    own = s.agent_from("x", folder, {"model": {"provider": "b", "model": "m2"}})
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
            assert stat.S_IMODE(cfg.stat().st_mode) == 0o600  # FX-A: the REPLACED config is 0600 too
            assert "default_mode: local" in baks[0].read_text(encoding="utf-8")  # backup is the OLD file
            # the running app reloaded the new shape
            assert c.app.state.settings.inference.provider == "llamacpp"
            assert c.app.state.settings.providers["openrouter"].api_key == "sk-REAL"
    finally:
        for k in ("CTRLB_HOME", "CTRLB_CONFIG", "CTRLB_DB"):
            os.environ.pop(k, None)


# ══════════════════════════ Slice-2 review fixes (FX-A..FX-D) ══════════════════════════
def test_fx_a_config_write_lands_0600_via_patch_and_selfheals() -> None:
    # FX-A: a plain patch write (no migration) must leave config.yaml at 0600, self-healing a file a
    # past umask-affected write left at 0664 — the secret-bearing file's deployment contract.
    config._PENDING_MIGRATION = None  # ensure no stale write-back leaks from a prior test
    tmp = Path(tempfile.mkdtemp())
    cfg = tmp / "config.yaml"
    cfg.write_text("server:\n  poll_seconds: 5\n", encoding="utf-8")
    os.chmod(cfg, 0o664)  # degrade it, as a `write_bytes`-at-umask write would
    config.apply_patch_to_yaml({"server": {"poll_seconds": 7}}, path=cfg)
    assert stat.S_IMODE(cfg.stat().st_mode) == 0o600
    assert "poll_seconds: 7" in cfg.read_text(encoding="utf-8")


def test_fx_a_save_settings_lands_0600() -> None:
    from app.config import Settings, save_settings

    tmp = Path(tempfile.mkdtemp())
    cfg = tmp / "config.yaml"
    save_settings(Settings(), path=cfg)  # the temp+replace writer must also land 0600
    assert stat.S_IMODE(cfg.stat().st_mode) == 0o600


def test_fx_b_env_only_embeddings_secret_is_not_materialized(caplog) -> None:  # noqa: ANN001
    # FX-B: an env-only secret (CTRLB_EMBEDDINGS__API_KEY) sits on a legacy path the fold consumes. It is
    # used THIS boot but must NOT be written into config.yaml on the first save (the write-back is built
    # from the DISK-truth fold). A warning fires naming the env var + the provider home.
    config._PENDING_MIGRATION = None
    tmp = Path(tempfile.mkdtemp())
    cfg = tmp / "config.yaml"
    cfg.write_text(
        "embeddings:\n  base_url: https://openrouter.ai/api/v1\n  model: qwen/embed\n",  # NO api_key on disk
        encoding="utf-8",
    )
    os.environ["CTRLB_HOME"] = str(tmp)
    os.environ["CTRLB_CONFIG"] = str(cfg)
    os.environ["CTRLB_DB"] = str(tmp / "t.db")
    os.environ["CTRLB_EMBEDDINGS__API_KEY"] = "sk-envonly"
    try:
        with caplog.at_level("WARNING", logger="ctrlb.config.migration"):
            s = config.load_settings(cfg)
        # the running Settings carries the env value this boot
        assert s.embeddings.provider == "openrouter.ai"
        assert s.providers["openrouter.ai"].api_key == "sk-envonly"
        # the FX-B warning fired, naming the env var + the provider home
        assert any(
            "CTRLB_EMBEDDINGS__API_KEY" in r.getMessage() and "FX-B" in r.getMessage() for r in caplog.records
        )
        # materialize the write-back onto disk (first write, identity mutate) — the env secret stays OUT
        config.edit_config_yaml(lambda doc: doc, path=cfg)
        disk = cfg.read_text(encoding="utf-8")
        assert "sk-envonly" not in disk
        assert "api_key" not in disk  # the disk-truth fold materialized the provider WITHOUT a key
    finally:
        for k in ("CTRLB_HOME", "CTRLB_CONFIG", "CTRLB_DB", "CTRLB_EMBEDDINGS__API_KEY"):
            os.environ.pop(k, None)
        config._PENDING_MIGRATION = None


def test_fx_c_accretes_dim_into_existing_model_entry() -> None:
    # FX-C: the legacy embeddings endpoint dedups onto a Slice-1 chat provider (same base_url+key) whose
    # model KEY already exists — its `dim` must accrete into the EXISTING entry, not be dropped.
    raw = {
        "providers": {"p": {"base_url": "http://e/v1", "api_key": "k", "models": {"m": {}}}},
        "inference": {"provider": "p"},
        "embeddings": {"base_url": "http://e/v1", "api_key": "k", "model": "m", "dim": 2560},
    }
    migrated, _slot, _dl = _migrate_legacy(raw)
    assert migrated["providers"]["p"]["models"]["m"] == {"dim": 2560}


def test_fx_c_does_not_overwrite_an_existing_field() -> None:
    raw = {
        "providers": {"p": {"base_url": "http://e/v1", "api_key": "k", "models": {"m": {"dim": 999}}}},
        "inference": {"provider": "p"},
        "embeddings": {"base_url": "http://e/v1", "api_key": "k", "model": "m", "dim": 2560},
    }
    migrated, _slot, _dl = _migrate_legacy(raw)
    assert migrated["providers"]["p"]["models"]["m"]["dim"] == 999  # existing field kept (new-value ignored)


def test_fx_d_collision_suffix_fits_the_32_char_slug_cap() -> None:
    from app.config import _provider_name_from_host_port, is_provider_slug

    host = "a" * 32  # a maximal 32-char host slug already taken
    name = _provider_name_from_host_port(f"http://{host}/v1", {host})
    assert name != host and len(name) <= 32 and is_provider_slug(name)  # suffixed, still ≤32 + valid


def test_fx_d_suffix_fits_as_the_counter_grows_digits() -> None:
    from app.config import _provider_name_from_host_port

    host = "a" * 32
    taken = {host} | {f"{host[: 32 - len(f'-{i}')]}-{i}" for i in range(2, 12)}  # -2..-11 taken
    name = _provider_name_from_host_port(f"http://{host}/v1", taken)
    assert len(name) <= 32 and name not in taken


# ── comment-preserving key removal (the orphaned-comment bug) ─────────────────────────────────────
# ruamel parks a key's trailing comment on the PRECEDING entry, so a bare `del` destroys the
# operator's prose for whatever came after the deleted region. Verified live before the fix: the
# migration's `inference.cloud` delete took the whole `# Voice …` section header with it.


def _rewrite(src: str, mutate) -> str:
    """Round-trip `src` through the real write chokepoint (`edit_config_yaml`) and return the file."""
    tmp = Path(tempfile.mkdtemp())
    cfg = tmp / "config.yaml"
    cfg.write_text(src, encoding="utf-8")
    config.edit_config_yaml(mutate, path=cfg)
    return cfg.read_text(encoding="utf-8")


def _delete(*dotted: str):
    return lambda doc: [config.delete_dotted(doc, d) for d in dotted]


def test_delete_keeps_the_following_sections_comment() -> None:
    """The live regression: the deleted key is LAST in its map and its value is a subtree, so the
    next section's header is parked on the deepest-last leaf inside the region being removed."""
    out = _rewrite(
        "inference:\n"
        "  request_timeout_s: 600\n"
        "  cloud:\n    base_url: https://x/v1\n    api_mode: openrouter\n"
        "# Voice (Phase 6, D18 failover). STT on VAULT.\n"
        "# A blank fallback is dropped from the chain.\n"
        "voice:\n  enabled: true\n",
        _delete("inference.cloud"),
    )
    assert "# Voice (Phase 6, D18 failover). STT on VAULT." in out
    assert "# A blank fallback is dropped from the chain." in out
    assert "cloud:" not in out
    # re-homed at its original position: still directly above `voice:`, still at column 0
    assert out.index("# Voice") < out.index("voice:") < out.index("enabled")


def test_delete_takes_the_deleted_keys_own_comments_with_it() -> None:
    """The symmetric rule: the block ABOVE the key documents that key and dies with it (owner ruling),
    as does its end-of-line comment; only the block trailing the region is re-homed."""
    out = _rewrite(
        "inference:\n"
        "  keep: 1   # eol on keep\n"
        "  # doc for legacy\n"
        "  legacy: 2   # eol on legacy\n"
        "  # doc for max_steps\n"
        "  max_steps: 3\n",
        _delete("inference.legacy"),
    )
    assert "# eol on legacy" not in out  # dies with the line it annotated
    assert "# doc for legacy" not in out  # dies with the key it documented
    assert "# eol on keep" in out  # the surviving neighbour keeps its own
    assert "  # doc for max_steps\n  max_steps: 3\n" in out  # re-homed, indentation intact


def test_delete_of_the_first_key_drops_its_leading_block_and_rehomes_the_trailing_one() -> None:
    out = _rewrite(
        "inference:\n  # doc for legacy\n  legacy: 1\n  # doc for max_steps\n  max_steps: 12\n",
        _delete("inference.legacy"),
    )
    assert out == "inference:\n  # doc for max_steps\n  max_steps: 12\n"


def test_delete_of_the_first_root_key_drops_its_leading_block() -> None:
    """At the document root the leading block lives on the doc itself, not on a parent entry."""
    out = _rewrite(
        "# doc for legacy\nlegacy: 1\n# doc for server\nserver:\n  poll_seconds: 5\n",
        _delete("legacy"),
    )
    assert out == "# doc for server\nserver:\n  poll_seconds: 5\n"


def test_consecutive_deletes_each_drop_their_own_block() -> None:
    """Deleting a run of documented keys leaves only the surviving key's own documentation — the block
    re-homed by one delete is recognised as the next key's and dropped when that key goes too."""
    out = _rewrite(
        "inference:\n"
        "  # doc for default_mode\n"
        "  default_mode: local\n"
        "  # doc for local\n"
        "  local:\n    base_url: http://l/v1\n"
        "  # doc for max_steps\n"
        "  max_steps: 12\n",
        _delete("inference.default_mode", "inference.local"),
    )
    assert out == "inference:\n  # doc for max_steps\n  max_steps: 12\n"


def test_delete_preserves_blank_lines_and_nonstandard_comment_spacing() -> None:
    out = _rewrite(
        "inference:\n  keep: 0\n  legacy: 1\n\n  # line one\n  #no-space line\n  #   aligned    trailer\n  max_steps: 12\n",
        _delete("inference.legacy"),
    )
    assert (
        out
        == "inference:\n  keep: 0\n\n  # line one\n  #no-space line\n  #   aligned    trailer\n  max_steps: 12\n"
    )


def test_delete_that_empties_a_map_rehomes_one_level_up_and_stays_valid_yaml() -> None:
    """An emptied mapping renders as `{}` and has no entry left to hang a comment on — attaching to it
    anyway would emit the comment BETWEEN the key and its `{}`, which no longer parses."""
    out = _rewrite(
        "voice:\n  stt:\n    primary: a\n# trailing doc\nother: 1\n",
        _delete("voice.stt.primary"),
    )
    assert "# trailing doc" in out
    assert config.yaml_rt().load(out)["other"] == 1  # still parses, and the comment didn't move inside
    assert out.index("stt: {}") < out.index("# trailing doc") < out.index("other: 1")


def test_repeated_deletes_are_idempotent_and_keep_rescuing() -> None:
    """The migration deletes several keys from one map; each delete re-runs the rescue, so the block
    hops along the survivors regardless of order — and a second pass over gone keys is a no-op."""
    src = (
        "inference:\n"
        "  request_timeout_s: 600\n"
        "  default_mode: local\n"
        "  local:\n    base_url: http://l/v1\n"
        "  cloud:\n    base_url: http://c/v1\n"
        "# next section\n"
        "voice:\n  enabled: true\n"
    )
    dotted = ("inference.default_mode", "inference.local", "inference.cloud")
    once = _rewrite(src, _delete(*dotted))
    assert once == "inference:\n  request_timeout_s: 600\n# next section\nvoice:\n  enabled: true\n"
    assert _rewrite(once, _delete(*dotted)) == once  # idempotent
    assert _rewrite(src, _delete(*reversed(dotted))) == once  # order-independent


def test_sync_mapping_rescues_comments_when_it_removes_keys() -> None:
    """The same deleter serves the hosts/integrations CRUD, where a removed service really disappears."""
    out = _rewrite(
        "computers:\n"
        "  corsair:\n"
        "    services:\n      web: {port: 80}\n      old: {port: 99}\n"
        "# fleet-wide notes\n"
        "server:\n  poll_seconds: 5\n",
        lambda doc: config.sync_mapping(doc["computers"]["corsair"]["services"], {"web": {"port": 80}}),
    )
    assert "# fleet-wide notes" in out and "old:" not in out and "web:" in out


def test_sync_mapping_emptying_a_child_rehomes_the_comment() -> None:
    out = _rewrite(
        "computers:\n"
        "  corsair:\n"
        "    services:\n      old: {port: 99}\n"
        "# fleet-wide notes\n"
        "server:\n  poll_seconds: 5\n",
        lambda doc: config.sync_mapping(doc["computers"]["corsair"], {"services": {}}),
    )
    assert "# fleet-wide notes" in out and "old:" not in out
    assert config.yaml_rt().load(out)["server"]["poll_seconds"] == 5


def test_delete_on_a_plain_dict_config_is_a_no_op_not_a_crash() -> None:
    """A fresh/empty config file yields plain dicts, which carry no ruamel comment structure."""
    doc = {"inference": {"legacy": 1, "max_steps": 2}}
    config.delete_dotted(doc, "inference.legacy")
    assert doc == {"inference": {"max_steps": 2}}


def test_delete_rehomes_across_a_sequence_valued_sibling() -> None:
    """The anchor search walks into lists too (`inference.fallbacks` is one), where entries are
    addressed positionally rather than by key."""
    out = _rewrite(
        "inference:\n  fallbacks:\n    - a\n    - b\n  legacy: 1\n  # doc for max_steps\n  max_steps: 2\n",
        _delete("inference.legacy"),
    )
    assert "# doc for max_steps" in out and "legacy" not in out
    assert config.yaml_rt().load(out)["inference"]["fallbacks"] == ["a", "b"]
    assert out.index("- b") < out.index("# doc for max_steps") < out.index("max_steps: 2")


def test_delete_rehomes_when_the_sequence_ends_in_an_empty_entry() -> None:
    out = _rewrite(
        "inference:\n  fallbacks:\n    - {}\n  legacy: 1\n  # doc for max_steps\n  max_steps: 2\n",
        _delete("inference.legacy"),
    )
    assert "# doc for max_steps" in out
    assert config.yaml_rt().load(out)["inference"]["max_steps"] == 2
    assert out.index("# doc for max_steps") < out.index("max_steps: 2")
