"""Environment overrides — UPDATE_PLAN slice 3.

Two mechanisms meet here, and the split is the design (UPDATE_PLAN §7, R6):

* `config.env_override_vars` / `_apply_env_overrides` — the LIVE one-level overlay
  (`CTRLB_<SECTION>__<KEY>`). Unchanged in behaviour by this slice; it gains a **warning** when a
  variable addresses a path the schema does not declare, because sections are `extra="allow"` and such
  a variable is otherwise indistinguishable from one that works. Warned, never refused: every peer
  project ignores an unrecognised prefixed variable (R6 §3), and a boot that dies over a stale `.env`
  line takes down the only UI there is to fix it with. **These are the mechanism's first tests** — it
  shipped in Phase 0 with none.
* `config_migration.retired_env_overrides` — the one class that IS refused: a variable naming a path a
  migration step retired, refused at the attended `--check`/`--apply` gate while prod still serves.
"""

from __future__ import annotations

import logging

import pytest
from pydantic import BaseModel

from app import config_migration as cm
from app.config import Settings, _apply_env_overrides, env_override_vars, load_settings
from app.config_migration.steps import A11_RETIRED_ENV_PATHS

_LOGGER = "ctrlb.config"


# ── the parser ───────────────────────────────────────────────────────────────────────────────────


def test_env_override_vars_parses_the_grammar_and_lowercases_the_path() -> None:
    env = {
        "CTRLB_SERVER__PORT": "5999",
        "CTRLB_Embeddings__Api_Key": "sk-x",  # case-insensitive: the overlay lower-cases both halves
        "PATH": "/usr/bin",  # unprefixed
        "CTRLB_HOME": "/somewhere",  # bootstrap, not a section override
        "CTRLB_CONFIG": "/somewhere/config.yaml",
        "CTRLB_NOSEPARATOR": "x",  # no `__` → not an override
    }
    assert sorted(env_override_vars(env)) == [
        ("CTRLB_Embeddings__Api_Key", "embeddings", "api_key"),
        ("CTRLB_SERVER__PORT", "server", "port"),
    ]


def test_env_override_vars_returns_names_only_never_values() -> None:
    """A `(var, value)` list is a secret-bearing structure that ends up logged sooner or later."""
    parsed = env_override_vars({"CTRLB_EMBEDDINGS__API_KEY": "sk-SECRET"})
    assert "sk-SECRET" not in repr(parsed)


# ── the overlay itself (first coverage) ──────────────────────────────────────────────────────────


def test_a_declared_override_wins_over_the_file_and_says_nothing(tmp_path, monkeypatch, caplog) -> None:
    cfg = tmp_path / "config.yaml"
    cfg.write_text("server:\n  port: 5433\n  poll_seconds: 5\n", encoding="utf-8")
    monkeypatch.setenv("CTRLB_SERVER__PORT", "5999")
    with caplog.at_level(logging.WARNING, logger=_LOGGER):
        settings = load_settings(cfg)
    assert settings.server.port == 5999  # env wins
    assert settings.server.poll_seconds == 5  # siblings untouched
    assert caplog.records == []  # a working override is silent


def test_a_bootstrap_variable_is_never_applied_as_a_section() -> None:
    raw: dict = {}
    _apply_env_overrides(raw)  # CTRLB_HOME/CTRLB_ENV are set by conftest for the whole suite
    assert "home" not in raw and "env" not in raw


@pytest.mark.parametrize(
    ("var", "path"),
    [
        ("CTRLB_EMBEDDINGS__KEY", "embeddings.key"),  # `.env.example` shipped this — never a field
        ("CTRLB_STT__KEY", "stt.key"),  # not even a section
        ("CTRLB_PROVIDERS__OPENROUTER__API_KEY", "providers.openrouter__api_key"),  # not addressable
    ],
)
def test_an_undeclared_override_warns_by_name_and_never_by_value(var, path, monkeypatch, caplog) -> None:
    monkeypatch.setenv(var, "sk-SECRET")
    with caplog.at_level(logging.WARNING, logger=_LOGGER):
        _apply_env_overrides({})
    assert len(caplog.records) == 1
    message = caplog.records[0].getMessage()
    assert var in message and path in message
    assert "sk-SECRET" not in message


# ── the retired-path guard ───────────────────────────────────────────────────────────────────────


def _legacy_workspace(tmp_path, monkeypatch):
    """A minimal legacy-shaped workspace the A11 step will want to migrate."""
    home = tmp_path / "home"
    home.mkdir()
    (home / "config.yaml").write_text(
        "embeddings:\n  base_url: http://e/v1\n  model: emb\n", encoding="utf-8"
    )
    monkeypatch.setenv("CTRLB_HOME", str(home))
    monkeypatch.delenv("CTRLB_CONFIG", raising=False)
    return home


def test_check_refuses_while_a_retired_override_is_set(tmp_path, monkeypatch) -> None:
    _legacy_workspace(tmp_path, monkeypatch)
    monkeypatch.setenv("CTRLB_EMBEDDINGS__API_KEY", "sk-SECRET")
    with pytest.raises(cm.MigrationRefused) as exc:
        cm.check(cm.context_from_env())
    assert "CTRLB_EMBEDDINGS__API_KEY" in str(exc.value)
    assert "embeddings.api_key" in str(exc.value)
    assert exc.value.exit_code == cm.EXIT_REFUSE  # no restart fixes an operator's environment
    assert "sk-SECRET" not in str(exc.value) + exc.value.remedy


def test_apply_refuses_before_writing_anything(tmp_path, monkeypatch) -> None:
    home = _legacy_workspace(tmp_path, monkeypatch)
    before = (home / "config.yaml").read_bytes()
    monkeypatch.setenv("CTRLB_EMBEDDINGS__API_KEY", "sk-SECRET")
    with pytest.raises(cm.MigrationRefused):
        cm.apply(cm.context_from_env())
    assert (home / "config.yaml").read_bytes() == before
    assert not (home / "backups").exists()  # refused before the backup, so nothing is left behind


def test_the_match_is_case_insensitive_like_the_overlay(tmp_path, monkeypatch) -> None:
    """`CTRLB_Embeddings__Api_Key` is applied by the overlay, so it must be caught by the guard."""
    _legacy_workspace(tmp_path, monkeypatch)
    monkeypatch.setenv("CTRLB_Embeddings__Api_Key", "sk-SECRET")
    with pytest.raises(cm.MigrationRefused, match="CTRLB_Embeddings__Api_Key"):
        cm.check(cm.context_from_env())


def test_a_still_live_path_is_not_retired(tmp_path, monkeypatch) -> None:
    """`embeddings.model` is CONSUMED by the fold and still DECLARED by the new schema — same
    spelling, new meaning (a provider-relative model selector). Refusing it would break a valid
    override, which is why `retires` is declared rather than derived from `Plan.consumes`."""
    _legacy_workspace(tmp_path, monkeypatch)
    monkeypatch.setenv("CTRLB_EMBEDDINGS__MODEL", "text-embedding-3-large")
    assert cm.check(cm.context_from_env()).needs_migration  # no refusal


def test_detect_does_not_refuse_so_the_boot_check_can_warn(tmp_path, monkeypatch) -> None:
    """Slice 4's import-time check reads `detect()` and must be free to LOG rather than exit: an old
    line in `.env` must not take down the only UI there is to fix it with (R6 §3 — the field warns;
    Grafana, the sole hard-failer, fails only where continuing disables a subsystem)."""
    _legacy_workspace(tmp_path, monkeypatch)
    monkeypatch.setenv("CTRLB_EMBEDDINGS__API_KEY", "sk-SECRET")
    assert cm.detect(cm.context_from_env()).needs_migration  # reports, does not raise
    assert cm.retired_env_overrides() == [("CTRLB_EMBEDDINGS__API_KEY", "embeddings.api_key")]


def test_nothing_is_reported_when_no_override_is_set() -> None:
    assert cm.retired_env_overrides(environ={}) == []


# ── the invariant that keeps the next step honest ────────────────────────────────────────────────


def test_no_retired_path_names_a_live_field() -> None:
    """A step may only retire a path the CURRENT schema no longer declares.

    Asserted against the live models rather than reviewed by eye: `embeddings.model` and
    `inference.fallbacks` are both consumed by the A11 fold and both still exist, so the tempting
    derivation (`retires` = what the step consumed) produces a guard that refuses valid overrides.
    """
    for section, key in A11_RETIRED_ENV_PATHS:
        field = Settings.model_fields.get(section)
        assert field is not None, f"`{section}` is not a config section at all"
        model = field.annotation
        assert isinstance(model, type) and issubclass(model, BaseModel)
        assert key not in model.model_fields, f"`{section}.{key}` is still a declared field"


def test_every_retired_path_is_addressable_by_the_one_level_grammar() -> None:
    """Retiring a path the grammar cannot reach would be theatre — the voice slots
    (`voice.stt.primary.api_key`) sit two levels down and were never reachable by an env var."""
    for path in A11_RETIRED_ENV_PATHS:
        assert len(path) == 2
        var = "CTRLB_" + "__".join(p.upper() for p in path)
        assert env_override_vars({var: "x"}) == [(var, *path)]
