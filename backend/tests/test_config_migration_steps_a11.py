"""The A11 fold, as a migration STEP (`app/config_migration/steps.py`) — UPDATE_PLAN slice 2.

These assertions were written against `config.py::_migrate_legacy` when the fold ran inside the config
load; they moved here with the code and are unchanged apart from `consumes` now carrying key-segment
paths. What is NEW is everything the move made possible or necessary: the `providers:`-present trigger
bug, the §3.9 unmigratable refusal, the agent fold taking its slot map as an argument, and the
end-to-end run through the runner against a real workspace.

`test_config_yaml_writer.py` holds what stayed behind in `config.py` — the comment-preserving writer.
"""

from __future__ import annotations

from pathlib import Path

import pytest
import yaml

from app import config_migration as cm
from app.config import load_settings
from app.config_migration.steps import (
    A11,
    _fold_agent_modes,
    _migrate_legacy,
    a11_applies,
    a11_apply,
)


def _ctx(config: dict, agents: dict[Path, dict] | None = None) -> cm.Context:
    """A `Context` with no filesystem behind it — enough for the pure half of the step."""
    return cm.Context(
        config_path=Path("/nonexistent/config.yaml"),
        agents_dir=Path("/nonexistent/agents"),
        config=config,
        agents=agents or {},
    )


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
    migrated, slot_map, consumed = _migrate_legacy(_legacy())
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
    assert consumed == [
        ("inference", "default_mode"),
        ("inference", "local"),
        ("inference", "cloud"),
        ("inference", "fallbacks"),
        # the ModelRef rewrites are removals too, and the runner refuses any it was not told about
        ("agent", "defaults", "model", "mode"),
        ("agent", "defaults", "compaction", "summarizer", "mode"),
        ("agent", "defaults", "routing", "lead", "mode"),
        ("agent", "compaction", "summarizer", "mode"),
    ]


def test_modelref_home_rewrites_all_four() -> None:
    migrated, _slot, _consumed = _migrate_legacy(_legacy())
    d = migrated["agent"]["defaults"]
    assert d["model"] == {"provider": "llamacpp", "model": "minig+"} and "mode" not in d["model"]
    assert d["compaction"]["summarizer"] == {"provider": "openrouter"}
    assert d["routing"]["lead"] == {"provider": "openrouter", "model": "big"}
    # the GLOBAL agent.compaction.summarizer (config.py:320 home)
    assert migrated["agent"]["compaction"]["summarizer"] == {"provider": "llamacpp"}


def test_a_second_run_changes_nothing_semantically() -> None:
    migrated, _slot, _consumed = _migrate_legacy(_legacy())
    again, slot2, del2 = _migrate_legacy(migrated)
    assert again == migrated and slot2 == {} and del2 == []  # new-shape present → no-op


def test_name_collision_suffixes() -> None:
    raw = {
        "inference": {
            "default_mode": "local",
            "local": {"base_url": "http://a/v1", "model": "x", "api_mode": "openai"},
            "cloud": {"base_url": "http://b/v1", "model": "y", "api_mode": "openai"},
        }
    }
    migrated, slot_map, _consumed = _migrate_legacy(raw)
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
    migrated, _slot, _consumed = _migrate_legacy(raw)
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


def test_agent_yaml_mode_fold_uses_the_slot_map_it_is_handed() -> None:
    raw = {
        "model": {"mode": "local", "model": "minig+"},
        "compaction": {"summarizer": {"mode": "cloud"}},
        "routing": {"lead": {"mode": "unknownprov"}},
    }
    folded = _fold_agent_modes(raw, {"local": "llamacpp", "cloud": "openrouter"})
    assert folded["model"] == {"provider": "llamacpp", "model": "minig+"}
    assert folded["compaction"]["summarizer"] == {"provider": "openrouter"}
    # an unmapped string is kept verbatim (a possibly-dangling ref → graceful default at resolve)
    assert folded["routing"]["lead"] == {"provider": "unknownprov"}
    assert raw["model"] == {"mode": "local", "model": "minig+"}  # the input is untouched


def test_a_config_with_no_legacy_keys_comes_back_unchanged() -> None:
    raw = {"inference": {"request_timeout_s": 600}}  # no local/cloud/fallbacks
    migrated, slot_map, consumed = _migrate_legacy(raw)
    assert migrated == raw and slot_map == {} and consumed == []  # equal, never the same object


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
    migrated, _slot, _consumed = _migrate_legacy(_legacy_voice())
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
    # single-endpoint section: no `fallbacks:` written at all (absence == the model's empty-list default),
    # not a cosmetic `fallbacks: []` (A-fallbacks, v1.3.1)
    assert tts["provider"] == "emma-9000" and tts["model"] == "kokoro" and "fallbacks" not in tts


def test_single_endpoint_section_omits_empty_fallbacks() -> None:
    # A legacy inference with ONE endpoint and no fallbacks must not fold to a cosmetic `fallbacks: []`.
    raw = {
        "inference": {
            "default_mode": "local",
            "local": {"base_url": "http://only/v1", "model": "m", "api_mode": "llamacpp"},
        }
    }
    migrated, _slot, _consumed = _migrate_legacy(raw)
    inf = migrated["inference"]
    assert inf["provider"] and "fallbacks" not in inf
    # idempotent: the folded doc is not legacy (it has `provider`), so a re-run changes nothing
    again, _s2, _d2 = _migrate_legacy(migrated)
    assert again == migrated


def test_embeddings_fold_dim_on_model_and_ref() -> None:
    migrated, _slot, _consumed = _migrate_legacy(_legacy_voice())
    prov = migrated["providers"]
    # openrouter.ai slug (no explicit port); the legacy dim lands on the model entry
    assert prov["openrouter.ai"]["models"]["qwen/embed"] == {"dim": 2560}
    assert prov["openrouter.ai"]["api_key"] == "sk-emb"  # secret carried onto the provider
    emb = migrated["embeddings"]
    assert emb["provider"] == "openrouter.ai" and "model" not in emb  # sole model → omitted
    assert emb["enabled"] is True  # service knob rides through
    assert "base_url" not in emb and "dim" not in emb  # legacy endpoint fields gone from the section


def test_voice_embeddings_consumed() -> None:
    _m, _slot, dl = _migrate_legacy(_legacy_voice())
    assert ("voice", "stt", "primary") in dl and ("voice", "stt", "fallback") in dl
    assert ("voice", "tts", "primary") in dl and (
        "voice",
        "tts",
        "fallback",
    ) not in dl  # no tts fallback present → not listed
    assert set(dl) >= {("embeddings", k) for k in ("base_url", "api_key", "model", "dim")}


def test_voice_only_legacy_with_newshape_chat_is_per_subtree() -> None:
    # chat already new-shape; only voice legacy → chat untouched, voice folds, idempotent re-run is a no-op
    migrated, slot_map, _consumed = _migrate_legacy(_legacy_voice())
    assert slot_map == {}  # no chat fold → no slot map
    assert migrated["inference"] == {"provider": "llamacpp"}  # chat section unchanged
    again, s2, d2 = _migrate_legacy(migrated)
    assert again == migrated and s2 == {} and d2 == []


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
    assert migrated == raw and dl == []  # no fold fired; the mixed subtree is left as-is


def test_blank_model_voice_uses_role_default_key() -> None:
    raw = {
        "providers": {"llamacpp": {"base_url": "http://l/v1", "api_mode": "llamacpp", "models": {"m": {}}}},
        "inference": {"provider": "llamacpp"},
        "voice": {
            "stt": {"primary": {"base_url": "http://w/v1"}},  # blank model → "whisper-1"
            "tts": {"primary": {"base_url": "http://t/v1"}},  # blank model → "tts-1"
        },
    }
    migrated, _slot, _consumed = _migrate_legacy(raw)
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
    assert ("embeddings", "base_url") in dl  # the legacy key is still scheduled for deletion


def test_fx_c_accretes_dim_into_existing_model_entry() -> None:
    # FX-C: the legacy embeddings endpoint dedups onto a Slice-1 chat provider (same base_url+key) whose
    # model KEY already exists — its `dim` must accrete into the EXISTING entry, not be dropped.
    raw = {
        "providers": {"p": {"base_url": "http://e/v1", "api_key": "k", "models": {"m": {}}}},
        "inference": {"provider": "p"},
        "embeddings": {"base_url": "http://e/v1", "api_key": "k", "model": "m", "dim": 2560},
    }
    migrated, _slot, _consumed = _migrate_legacy(raw)
    assert migrated["providers"]["p"]["models"]["m"] == {"dim": 2560}


def test_fx_c_does_not_overwrite_an_existing_field() -> None:
    raw = {
        "providers": {"p": {"base_url": "http://e/v1", "api_key": "k", "models": {"m": {"dim": 999}}}},
        "inference": {"provider": "p"},
        "embeddings": {"base_url": "http://e/v1", "api_key": "k", "model": "m", "dim": 2560},
    }
    migrated, _slot, _consumed = _migrate_legacy(raw)
    assert migrated["providers"]["p"]["models"]["m"]["dim"] == 999  # existing field kept (new-value ignored)


def test_fx_d_collision_suffix_fits_the_32_char_slug_cap() -> None:
    from app.config import is_provider_slug
    from app.config_migration.steps import _provider_name_from_host_port

    host = "a" * 32  # a maximal 32-char host slug already taken
    name = _provider_name_from_host_port(f"http://{host}/v1", {host})
    assert name != host and len(name) <= 32 and is_provider_slug(name)  # suffixed, still ≤32 + valid


def test_fx_d_suffix_fits_as_the_counter_grows_digits() -> None:
    from app.config_migration.steps import _provider_name_from_host_port

    host = "a" * 32
    taken = {host} | {f"{host[: 32 - len(f'-{i}')]}-{i}" for i in range(2, 12)}  # -2..-11 taken
    name = _provider_name_from_host_port(f"http://{host}/v1", taken)
    assert len(name) <= 32 and name not in taken


# ── what the move to a STEP changed ───────────────────────────────────────────────────────────────


def test_the_a11_step_is_the_registered_one() -> None:
    """`VERSION` is 1 because THIS step is version 1 — the file `update.sh` reads and the tuple the
    runner walks must not drift apart."""
    assert cm.STEPS == (A11,)
    assert A11.version == cm.CONFIG_VERSION == 1


def test_a_providers_key_no_longer_blocks_the_chat_fold(tmp_path, monkeypatch) -> None:
    """Item-6 defect: the old trigger required `"providers" not in raw`, so the mere PRESENCE of the
    key — `providers: {}`, or a bare `providers:` line, which YAML parses to `None` — silently and
    permanently disabled the chat migration. A partially migrated config is now migrated."""
    for providers in ({}, None, {"someone-else": {"base_url": "http://p/v1", "models": {"m": {}}}}):
        raw = {
            "providers": providers,
            "inference": {"local": {"base_url": "http://l/v1", "model": "minig+", "api_mode": "llamacpp"}},
        }
        assert a11_applies(_ctx(raw)) is True
        migrated, slot_map, _consumed = _migrate_legacy(raw)
        assert slot_map == {"local": "llamacpp"}
        assert migrated["inference"]["provider"] == "llamacpp"
        assert "local" not in migrated["inference"]
        if providers:  # an existing provider is kept alongside the freshly folded one
            assert "someone-else" in migrated["providers"]


def test_an_agent_file_alone_keeps_the_step_applying(tmp_path) -> None:
    """§3.1 — a workspace is not migrated until its side files are, so the config cannot be stamped
    while an agent still names a legacy slot."""
    agent = tmp_path / "agents" / "fable" / "agent.yaml"
    new_shape_config = {"providers": {"p": {"base_url": "http://p/v1", "models": {"m": {}}}}}
    assert a11_applies(_ctx(new_shape_config)) is False
    assert a11_applies(_ctx(new_shape_config, {agent: {"model": {"mode": "local"}}})) is True


def test_a_stranded_mode_is_refused_rather_than_guessed(tmp_path) -> None:
    """§3.9 — `mode: local` only means something against the slot map the LEGACY config produces. If
    the config is already new-shape, that map is unreconstructible, and converting anyway would invent
    a provider name pointing at nothing."""
    agent = tmp_path / "agents" / "fable" / "agent.yaml"
    new_shape = {
        "providers": {"p": {"base_url": "http://p/v1", "models": {"m": {}}}},
        "inference": {"provider": "p"},
    }
    with pytest.raises(cm.MigrationRefused, match="cannot be reconstructed") as exc:
        a11_apply(_ctx(new_shape, {agent: {"model": {"mode": "local"}}}))
    assert "agents/fable/agent.yaml" in str(exc.value)
    assert "provider: <name>" in exc.value.remedy
    assert exc.value.exit_code == cm.EXIT_REFUSE  # no restart fixes it


def test_a_stranded_config_ref_is_refused_the_same_way(tmp_path) -> None:
    """Item-6 defect: a stale `mode:` in a CONFIG-held ref used to be a hard boot `ValidationError`
    (`ModelRef` forbids extras) while an agent file degraded silently — two behaviours for one
    mistake. Both are now the same refusal, with the same remedy."""
    new_shape = {
        "providers": {"p": {"base_url": "http://p/v1", "models": {"m": {}}}},
        "inference": {"provider": "p"},
        "agent": {"defaults": {"model": {"mode": "cloud"}}},
    }
    with pytest.raises(cm.MigrationRefused, match="cannot be reconstructed") as exc:
        a11_apply(_ctx(new_shape))
    assert "agent.defaults.model" in str(exc.value)


def test_a_legacy_config_maps_its_own_stray_modes_without_refusing() -> None:
    """The refusal is scoped to the unreconstructible case: while the legacy block is still there, the
    fold is about to produce the very map those `mode:`s need."""
    raw = {
        "inference": {"local": {"base_url": "http://l/v1", "model": "m", "api_mode": "llamacpp"}},
        "agent": {"defaults": {"model": {"mode": "local"}}},
    }
    plan = a11_apply(_ctx(raw))
    assert plan.config["agent"]["defaults"]["model"] == {"provider": "llamacpp"}


def test_the_step_never_mutates_the_context(tmp_path) -> None:
    """Codex: the original shallow-copied the top level and then let the ModelRef rewrite mutate nested
    dicts it shared with its input. A step that did that would corrupt the runner's `Context` — and the
    diff would compare the migrated document against itself and see nothing to write."""
    agent = tmp_path / "agents" / "fable" / "agent.yaml"
    raw = {
        "inference": {"local": {"base_url": "http://l/v1", "model": "m", "api_mode": "llamacpp"}},
        "agent": {"defaults": {"model": {"mode": "local"}}},
    }
    agents = {agent: {"model": {"mode": "local"}}}
    ctx = _ctx(raw, agents)
    a11_apply(ctx)
    assert ctx.config["agent"]["defaults"]["model"] == {"mode": "local"}
    assert ctx.config["inference"]["local"]["base_url"] == "http://l/v1"
    assert ctx.agents[agent]["model"] == {"mode": "local"}


def test_every_removal_the_fold_makes_is_declared() -> None:
    """The runner refuses an undeclared removal, so this is the property that keeps the real step
    runnable at all — asserted here against the full legacy shape rather than trusted."""
    raw = {
        "inference": {
            "default_mode": "local",
            "local": {"base_url": "http://l/v1", "model": "m", "api_mode": "llamacpp"},
            "cloud": {"base_url": "http://c/v1", "model": "c"},
            "fallbacks": [{"base_url": "http://f/v1", "model": "f"}],
        },
        "voice": {
            "stt": {"primary": {"base_url": "http://s/v1", "model": "w"}},
            "tts": {"primary": {"base_url": "http://s/v1", "model": "k", "voice": "bf_isabella"}},
        },
        "embeddings": {"base_url": "http://e/v1", "model": "emb", "dim": 768, "api_key": "sk-x"},
        "agent": {
            "defaults": {"model": {"mode": "local"}, "routing": {"lead": {"mode": "cloud"}}},
            "compaction": {"summarizer": {"mode": "local"}},
        },
    }
    ctx = _ctx(raw)
    plan = a11_apply(ctx)
    removals = cm._diff(ctx.config, plan.config)[1]
    assert cm._undeclared_removals(removals, plan.consumes) == []


# ── end to end, through the runner, against a real workspace ──────────────────────────────────────


LEGACY_YAML = """# ctrl-b config
server:
  port: 5433   # keep this comment

# Inference (Phase 4) — this header documents the legacy block and dies with it
inference:
  default_mode: local
  request_timeout_s: 600
  local:
    base_url: http://192.168.1.137:5001/v1
    model: minig+
    api_mode: llamacpp
  cloud:
    base_url: https://openrouter.ai/api/v1
    api_key: sk-SECRET
    model: qwen/qwen3.5-72b
    api_mode: openrouter

# Voice (Phase 6, D18 failover) — the header the first fix wave rescued
voice:
  stt:
    primary:
      base_url: http://emma:9000/v1
      model: parakeet
agent:
  defaults:
    model:
      mode: local
"""


def _workspace(tmp_path, monkeypatch) -> Path:
    home = tmp_path / "home"
    (home / "agents" / "fable").mkdir(parents=True)
    (home / "config.yaml").write_text(LEGACY_YAML, encoding="utf-8")
    (home / "agents" / "fable" / "agent.yaml").write_text(
        "# fable's own notes\nmodel:\n  mode: cloud\n  model: qwen/qwen3.5-72b\n", encoding="utf-8"
    )
    monkeypatch.setenv("CTRLB_HOME", str(home))
    monkeypatch.delenv("CTRLB_CONFIG", raising=False)
    return home


def test_the_real_step_migrates_a_real_workspace(tmp_path, monkeypatch) -> None:
    home = _workspace(tmp_path, monkeypatch)
    applied = cm.apply(cm.context_from_env())  # the REAL STEPS tuple, not a fake
    assert applied.wrote is True

    text = (home / "config.yaml").read_text(encoding="utf-8")
    assert "# keep this comment" in text
    assert "# Voice (Phase 6, D18 failover) — the header the first fix wave rescued" in text
    assert "default_mode" not in text and "local:" not in text and "primary:" not in text
    assert "sk-SECRET" in text  # the credential moved, it did not evaporate

    fresh = cm.context_from_env()
    assert cm.needs_migration(fresh) is False
    assert cm.read_marker(fresh.config) == cm.CONFIG_VERSION
    assert fresh.config["inference"]["provider"] == "llamacpp"
    assert fresh.config["voice"]["stt"]["provider"] == "emma-9000"
    assert fresh.config["agent"]["defaults"]["model"] == {"provider": "llamacpp"}

    agent_text = (home / "agents" / "fable" / "agent.yaml").read_text(encoding="utf-8")
    assert "# fable's own notes" in agent_text  # a hand-written agent file keeps its prose
    assert "mode:" not in agent_text and "provider: openrouter" in agent_text

    settings = load_settings(home / "config.yaml")  # and the app can read what the migration wrote
    assert set(settings.providers) == {"llamacpp", "openrouter", "emma-9000"}
    assert settings.providers["openrouter"].api_key == "sk-SECRET"


def test_the_migrated_workspace_is_idempotent(tmp_path, monkeypatch) -> None:
    home = _workspace(tmp_path, monkeypatch)
    cm.apply(cm.context_from_env())
    before = (home / "config.yaml").read_bytes()
    assert cm.apply(cm.context_from_env()).wrote is False
    assert (home / "config.yaml").read_bytes() == before


def test_an_env_only_legacy_secret_is_refused_rather_than_silently_dropped(tmp_path, monkeypatch) -> None:
    """Item-6 defect, CLOSED by slice 3 (this test was its pin, and asserted the hole).

    The migration reads DISK TRUTH (§3.1), so an api_key living only in `CTRLB_EMBEDDINGS__API_KEY` was
    never folded into the provider — and once the disk is new-shape that one-level override cannot
    address `providers.*.api_key` either, so the credential silently stopped being applied. Slice 3
    refuses at the gate instead, while the legacy key is still the right place to put the value. The
    fold itself is unchanged: it still carries only what is on disk (see the assertions after the fix).
    """
    home = tmp_path / "home"
    home.mkdir()
    (home / "config.yaml").write_text(
        "embeddings:\n  base_url: http://e/v1\n  model: emb\n", encoding="utf-8"
    )
    monkeypatch.setenv("CTRLB_HOME", str(home))
    monkeypatch.delenv("CTRLB_CONFIG", raising=False)
    monkeypatch.setenv("CTRLB_EMBEDDINGS__API_KEY", "sk-env-only")
    with pytest.raises(cm.MigrationRefused, match="CTRLB_EMBEDDINGS__API_KEY") as exc:
        cm.apply(cm.context_from_env())
    assert "sk-env-only" not in str(exc.value) + exc.value.remedy

    # The operator follows the remedy: the value goes under the legacy key, the variable goes away.
    (home / "config.yaml").write_text(
        "embeddings:\n  base_url: http://e/v1\n  model: emb\n  api_key: sk-env-only\n", encoding="utf-8"
    )
    monkeypatch.delenv("CTRLB_EMBEDDINGS__API_KEY")
    cm.apply(cm.context_from_env())
    assert load_settings(home / "config.yaml").providers["e"].api_key == "sk-env-only"


def test_legacy_voice_does_not_license_a_stranded_chat_mode(tmp_path) -> None:
    """The refusal keys on the CHAT subtree, not on "any legacy shape". A config with legacy voice but
    a migrated `inference` produces an EMPTY slot map, so a stranded `mode: local` would otherwise sail
    through and land as a provider literally named `local` — a dangling ref, silently."""
    agent = tmp_path / "agents" / "fable" / "agent.yaml"
    config = {
        "providers": {"p": {"base_url": "http://p/v1", "models": {"m": {}}}},
        "inference": {"provider": "p"},  # chat already migrated
        "voice": {"stt": {"primary": {"base_url": "http://s/v1", "model": "w"}}},  # voice still legacy
    }
    with pytest.raises(cm.MigrationRefused, match="cannot be reconstructed"):
        a11_apply(_ctx(config, {agent: {"model": {"mode": "local"}}}))


@pytest.mark.parametrize(
    ("name", "config", "expect_applies"),
    [
        # not mappings → no step can read them; they are the RUNNER's problem (it validates them)
        ("inference is a string", {"inference": "nonsense"}, False),
        ("voice is a string", {"voice": "nonsense"}, False),
        ("embeddings is null", {"embeddings": None}, False),
        ("voice.stt is null", {"voice": {"stt": None}}, False),
        # legacy-shaped but degenerate → the fold fires and must still converge
        ("local is a string", {"inference": {"local": "http://l/v1"}}, True),
        ("fallbacks is empty", {"inference": {"fallbacks": []}}, True),
        ("fallbacks is a string", {"inference": {"fallbacks": "x"}}, True),
        ("default_mode alone", {"inference": {"default_mode": "local"}}, True),
        (
            "mode is not a string",
            {
                "inference": {"local": {"base_url": "http://l/v1", "model": "m"}},
                "agent": {"defaults": {"model": {"mode": 3}}},
            },
            True,
        ),
        (
            "agent.defaults is a string",
            {"inference": {"local": {"base_url": "http://l/v1", "model": "m"}}, "agent": {"defaults": "x"}},
            True,
        ),
    ],
)
def test_malformed_config_converges_or_is_left_to_the_runner(name, config, expect_applies) -> None:
    """The property the runner leans on: after `apply`, `applies` must be False. A shape the fold does
    not understand may be dropped (the backup keeps it) but must never leave the step re-firing, which
    the runner would report as a post-commit verification failure."""
    ctx = _ctx(config)
    assert a11_applies(ctx) is expect_applies
    if not expect_applies:
        return
    plan = a11_apply(ctx)
    assert a11_applies(_ctx(plan.config)) is False
    assert cm._undeclared_removals(cm._diff(ctx.config, plan.config)[1], plan.consumes) == []


def test_agents_already_migrated_are_left_alone(tmp_path) -> None:
    """Only the files that still name a legacy slot are rewritten — an already-migrated sibling is not
    touched, so it keeps its formatting and never appears in the plan."""
    done = tmp_path / "agents" / "done" / "agent.yaml"
    todo = tmp_path / "agents" / "todo" / "agent.yaml"
    ctx = _ctx(
        {"inference": {"local": {"base_url": "http://l/v1", "model": "m", "api_mode": "llamacpp"}}},
        {done: {"model": {"provider": "llamacpp"}}, todo: {"model": {"mode": "local"}}},
    )
    plan = a11_apply(ctx)
    assert set(plan.agent_files) == {todo}


def test_half_migrated_voice_folds_only_the_legacy_half() -> None:
    """`voice.stt` on the new shape next to a legacy `voice.tts`: the fold is per-subtree, so the
    migrated half must come through untouched."""
    config = {
        "providers": {"spch": {"base_url": "http://s/v1", "models": {"parakeet": {}}}},
        "voice": {
            "stt": {"provider": "spch", "model": "parakeet"},
            "tts": {"primary": {"base_url": "http://s/v1", "model": "kokoro"}},
        },
    }
    plan = a11_apply(_ctx(config))
    assert plan.config["voice"]["stt"] == {"provider": "spch", "model": "parakeet"}
    assert plan.config["voice"]["tts"]["provider"] == "spch"  # deduped onto the SAME provider
    assert a11_applies(_ctx(plan.config)) is False


def test_a_lone_default_mode_still_triggers_the_fold() -> None:
    """The postcondition IS `applies`, so a key the fold strips but never triggers on would be left on
    disk under a "verified" stamp — a zero-legacy-keys violation nothing downstream could see."""
    config = {"inference": {"default_mode": "local", "request_timeout_s": 600}}
    ctx = _ctx(config)
    assert a11_applies(ctx) is True
    plan = a11_apply(ctx)
    assert ("inference", "default_mode") in plan.consumes
    assert plan.config["inference"] == {"request_timeout_s": 600}
    assert "providers" not in plan.config  # and no empty `providers:` key is introduced
    assert a11_applies(_ctx(plan.config)) is False


def test_a_blank_api_key_is_the_same_endpoint_as_none() -> None:
    """`""` and absent are both "no credential". Left distinct, one endpoint splits into two
    byte-identical providers, the second suffixed `-2`, and the operator sees a phantom in Conf."""
    config = {
        "inference": {
            "local": {"base_url": "http://s/v1", "model": "a", "api_key": ""},
            "cloud": {"base_url": "http://s/v1", "model": "b"},
        }
    }
    migrated, _slot, _consumed = _migrate_legacy(config)
    assert len(migrated["providers"]) == 1
    assert set(next(iter(migrated["providers"].values()))["models"]) == {"a", "b"}


# ── the slot map is the only authority on what a `mode:` can become ───────────────────────────────


@pytest.mark.parametrize(
    ("name", "inference"),
    [
        ("empty fallbacks", {"fallbacks": []}),
        ("an empty slot", {"local": {}}),
        ("a slot with no base_url", {"local": {"model": "m"}}),
        ("a scalar slot", {"local": "http://l/v1"}),
        ("default_mode only", {"default_mode": "local"}),
    ],
)
def test_a_legacy_block_that_produces_no_slot_still_refuses(tmp_path, name, inference) -> None:
    """A legacy-SHAPED `inference` is not the same as a reconstructible one. Each of these is legacy
    enough to trigger the fold and still yields an EMPTY slot map, so a `mode: local` next to it would
    have been converted to a provider literally named `local` — syntactically valid, so validation and
    the postcondition both pass, and the operator only finds out when a model quietly answers from the
    default chain instead of the endpoint they meant."""
    agent = tmp_path / "agents" / "fable" / "agent.yaml"
    ctx = _ctx({"inference": inference}, {agent: {"model": {"mode": "local"}}})
    with pytest.raises(cm.MigrationRefused, match="cannot be reconstructed") as exc:
        a11_apply(ctx)
    assert "mode: local" in str(exc.value)


def test_a_mode_that_is_not_a_legacy_slot_is_never_refused() -> None:
    """The mirror-image mistake: `mode: null`, `mode: 3` and `mode: openrouter` need no slot map, so a
    migrated `inference` beside them must not be refused. They are dropped, dropped and kept as a
    provider name — exactly what the fold did before it moved."""
    config = {
        "providers": {"openrouter": {"base_url": "http://o/v1", "models": {"m": {}}}},
        "inference": {"provider": "openrouter"},
        "agent": {
            "defaults": {"model": {"mode": "openrouter"}, "routing": {"lead": {"mode": None}}},
            "compaction": {"summarizer": {"mode": 3}},
        },
    }
    ctx = _ctx(config)
    assert a11_applies(ctx) is True  # a stray `mode:` is legacy data in its own right
    plan = a11_apply(ctx)
    assert plan.config["agent"]["defaults"]["model"] == {"provider": "openrouter"}
    assert plan.config["agent"]["defaults"]["routing"]["lead"] == {}
    assert plan.config["agent"]["compaction"]["summarizer"] == {}
    assert a11_applies(_ctx(plan.config)) is False


def test_a_broken_new_shape_config_is_refused_not_stamped(tmp_path, monkeypatch) -> None:
    """Codex: a config that is merely BROKEN rather than legacy is invisible to every step. Without a
    validation pass it would sail through `--check`, be stamped "verified", and fail on the next boot —
    i.e. during an update: preflight says go, service stopped, restart fails on a file we certified."""
    home = tmp_path / "home"
    home.mkdir()
    (home / "config.yaml").write_text("inference: nonsense\n", encoding="utf-8")
    monkeypatch.setenv("CTRLB_HOME", str(home))
    monkeypatch.delenv("CTRLB_CONFIG", raising=False)
    assert cm.main(["--check"], cm.STEPS) != cm.EXIT_OK
    assert cm.main(["--apply"], cm.STEPS) != cm.EXIT_OK
    assert "config_version" not in (home / "config.yaml").read_text(encoding="utf-8")
    assert not (home / "backups").exists()


def test_a_non_mapping_providers_key_is_refused_not_crashed_on(tmp_path) -> None:
    """Codex: `.items()` on a string is an `AttributeError` that escapes `MigrationRefused` entirely,
    so the runner's own validation never gets to speak — and coercing a falsey one to `{}` would
    overwrite the operator's data with an empty map."""
    for bad in ("nonsense", [], 3):
        with pytest.raises(cm.MigrationRefused, match="must be a mapping"):
            a11_apply(_ctx({"providers": bad, "agent": {"defaults": {"model": {"mode": "openrouter"}}}}))


def test_a_bare_providers_key_is_not_a_malformed_one(tmp_path) -> None:
    """`providers:` written bare parses to `None` — a key waiting to be filled, not a broken one."""
    plan = a11_apply(
        _ctx({"providers": None, "inference": {"local": {"base_url": "http://l/v1", "model": "m"}}})
    )
    assert set(plan.config["providers"]) == {"openai"}


def test_a_ref_holding_both_shapes_keeps_the_new_one(tmp_path) -> None:
    """D48's new-wins rule, which the unconditional rewrite would otherwise invert: a ref carrying both
    `provider:` and `mode:` had the LEGACY field silently overwrite the new one."""
    agent = tmp_path / "agents" / "fable" / "agent.yaml"
    ctx = _ctx(
        {
            "inference": {"local": {"base_url": "http://l/v1", "model": "m", "api_mode": "llamacpp"}},
            "agent": {"defaults": {"model": {"provider": "kept", "mode": "local"}}},
        },
        {agent: {"model": {"provider": "kept-too", "mode": "local"}}},
    )
    plan = a11_apply(ctx)
    assert plan.config["agent"]["defaults"]["model"] == {"provider": "kept"}
    assert plan.agent_files[agent]["model"] == {"provider": "kept-too"}
    assert a11_applies(_ctx(plan.config, plan.agent_files)) is False


def test_an_existing_blank_key_provider_is_the_same_identity(tmp_path) -> None:
    """The seed side of the `""`-vs-absent normalisation: an existing provider carrying `api_key: ""`
    must present the same identity as a legacy endpoint with no key, or they split into duplicates."""
    config = {
        "providers": {"p": {"base_url": "http://s/v1", "api_key": "", "models": {"a": {}}}},
        "voice": {"stt": {"primary": {"base_url": "http://s/v1", "model": "w"}}},
    }
    migrated, _slot, _consumed = _migrate_legacy(config)
    assert set(migrated["providers"]) == {"p"}
    assert migrated["voice"]["stt"]["provider"] == "p"


# ── the class of defect three review rounds kept finding ──────────────────────────────────────────

#: Operator-authored shapes that a step reads but might not anticipate. Every review round of this
#: migration found one of these; the list is the empirical closure, and the runner's crash-wrapper is
#: the structural one. Guarding node-by-node inside the fold would grow the legacy-schema machinery
#: R5 warned about (a peer project's converter reached 1229 lines that way).
MALFORMED = [
    {"providers": "nonsense", "inference": {"local": {"base_url": "http://l/v1"}}},
    {"providers": [], "inference": {"local": {"base_url": "http://l/v1"}}},
    {"providers": {"p": {"base_url": 7, "models": {}}}, "agent": {"defaults": {"model": {"mode": "x"}}}},
    {"providers": {"p": {"base_url": "http://h:notaport/v1"}}, "inference": {"local": {}}},
    {"providers": {"p": {"base_url": "http://s/v1", "api_key": ["a"]}}, "inference": {"local": {}}},
    {"inference": {"local": {"base_url": 7, "model": "m"}}},
    {"inference": {"local": {"base_url": "http://l/v1", "api_key": {"a": 1}, "model": "m"}}},
    {"inference": {"local": [1, 2]}},
    {"voice": {"stt": {"primary": 7}}},
    {"embeddings": {"base_url": 7, "model": "m"}},
    {"agent": {"defaults": {"model": {"mode": "local"}}}, "inference": {"fallbacks": {}}},
]


@pytest.mark.parametrize("config", MALFORMED, ids=range(len(MALFORMED)))
def test_a_malformed_config_is_refused_or_converged_never_raised(tmp_path, monkeypatch, config) -> None:
    """The invariant that closes the class: for ANY operator-authored input, the runner either refuses
    with a `MigrationRefused` the operator can act on, or converges. It never escapes as a traceback —
    which, for exceptions like `urlsplit`'s "Port could not be cast to integer value as '…'", would
    also print the offending value out of a file full of credentials."""
    home = tmp_path / "home"
    home.mkdir()
    (home / "config.yaml").write_text(yaml.safe_dump(config), encoding="utf-8")
    monkeypatch.setenv("CTRLB_HOME", str(home))
    monkeypatch.delenv("CTRLB_CONFIG", raising=False)
    try:
        cm.apply(cm.context_from_env(), cm.STEPS)
    except cm.MigrationRefused:
        return  # refused cleanly — the operator gets a message, not a stack trace
    assert cm.needs_migration(cm.context_from_env(), cm.STEPS) is False  # or it converged


def test_a_crashing_step_is_reported_as_a_step_bug_without_its_message(tmp_path, monkeypatch) -> None:
    """The wrapper reports the exception TYPE and withholds the message: exception text quotes its
    input, and this input is a file holding API keys and SSH passwords."""
    home = tmp_path / "home"
    home.mkdir()
    (home / "config.yaml").write_text("a: 1\n", encoding="utf-8")
    monkeypatch.setenv("CTRLB_HOME", str(home))
    monkeypatch.delenv("CTRLB_CONFIG", raising=False)

    def boom(_ctx: cm.Context) -> bool:
        raise ValueError("Port could not be cast to integer value as 'sk-SECRET'")

    bad = cm.Step(1, boom, lambda ctx: cm.Plan(config=dict(ctx.config)))
    with pytest.raises(cm.MigrationRefused) as exc:
        cm.check(cm.context_from_env(), (bad,))
    assert "ValueError" in str(exc.value) and "step 1 crashed" in str(exc.value)
    assert "sk-SECRET" not in str(exc.value) and "sk-SECRET" not in exc.value.remedy


def test_a_ref_with_both_shapes_is_not_refused_as_stranded(tmp_path) -> None:
    """Fable: the rewrite exempts a both-shapes ref (new wins), so the refusal must exempt it too —
    otherwise the operator is told to "set `provider:` explicitly" on a ref where it already is."""
    agent = tmp_path / "agents" / "fable" / "agent.yaml"
    config = {
        "providers": {"openrouter": {"base_url": "http://o/v1", "models": {"m": {}}}},
        "inference": {"provider": "openrouter"},  # migrated: the slot map will be empty
        "agent": {"defaults": {"model": {"provider": "openrouter", "mode": "local"}}},
    }
    plan = a11_apply(_ctx(config, {agent: {"model": {"provider": "openrouter", "mode": "cloud"}}}))
    assert plan.config["agent"]["defaults"]["model"] == {"provider": "openrouter"}
    assert plan.agent_files[agent]["model"] == {"provider": "openrouter"}
