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
import os
from pathlib import Path

import conftest
import pytest
from pydantic import BaseModel, ValidationError

from app import config as cm_config
from app import config_migration as cm
from app.config import Settings, _apply_env_overrides, env_override_vars, load_settings
from app.config_migration.steps import A11_RETIRED_ENV_PATHS, a11_apply

_LOGGER = "ctrlb.config"


def _declared(section: str, key: str) -> bool:
    """Whether `<section>.<key>` is a field the LIVE schema still declares. Spelled out here rather
    than imported from `config`, so the invariants below check the models rather than re-run the
    implementation they are supposed to police."""
    field = Settings.model_fields.get(section)
    model = field.annotation if field is not None else None
    return isinstance(model, type) and issubclass(model, BaseModel) and key in model.model_fields


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


def test_the_suite_strips_inherited_overrides() -> None:
    """Pins conftest's guard by its RULE, not by its effect: the stripping runs at import time, before
    any test exists, so asserting on `os.environ` here would pass in a clean shell whether or not the
    guard was there — which is exactly what it did before this test."""
    assert conftest.inherited_override_names(
        {"CTRLB_HOME": "/x", "CTRLB_SERVER__PORT": "1", "CTRLB_Embeddings__Api_Key": "k", "PATH": "/b"}
    ) == ["CTRLB_SERVER__PORT", "CTRLB_Embeddings__Api_Key"]
    assert conftest.inherited_override_names(os.environ) == []  # …and it actually ran


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


def test_apply_touches_nothing_at_all_when_it_refuses(tmp_path, monkeypatch) -> None:
    """Stronger than "the file is unchanged": every writing primitive is replaced by a bomb, so the
    claim "nothing was written" is pinned rather than inferred from the absence of a backups dir."""
    _legacy_workspace(tmp_path, monkeypatch)
    monkeypatch.setenv("CTRLB_EMBEDDINGS__API_KEY", "sk-SECRET")

    def boom(*_a, **_k):  # pragma: no cover — the point is that it is never reached
        raise AssertionError("the refusal path wrote something")

    for name in ("_backup", "_write_config", "_write_agent", "edit_config_yaml", "_probe_writable"):
        monkeypatch.setattr(cm, name, boom)
    with pytest.raises(cm.MigrationRefused, match="retired"):  # the INTENDED refusal, not any refusal
        cm.apply(cm.context_from_env())


def test_the_remedy_names_the_right_home_on_each_side_of_the_migration(tmp_path, monkeypatch) -> None:
    home = _legacy_workspace(tmp_path, monkeypatch)
    monkeypatch.setenv("CTRLB_EMBEDDINGS__API_KEY", "sk-SECRET")
    with pytest.raises(cm.MigrationRefused) as legacy:
        cm.check(cm.context_from_env())
    assert "legacy key" in legacy.value.remedy  # not migrated yet → the fold will carry it across

    monkeypatch.delenv("CTRLB_EMBEDDINGS__API_KEY")
    cm.apply(cm.context_from_env())  # migrate, then the variable comes back
    monkeypatch.setenv("CTRLB_EMBEDDINGS__API_KEY", "sk-SECRET")
    with pytest.raises(cm.MigrationRefused) as migrated:
        cm.check(cm.context_from_env())
    assert "provider that section now points at" in migrated.value.remedy
    assert (home / "config.yaml").exists()


@pytest.mark.parametrize(
    "bad",
    [
        ("embeddings.api_key",),  # dotted, one segment — never matches a parsed (section, key)
        ("voice", "stt", "primary"),  # three segments — the grammar cannot address it
        ("Embeddings", "API_KEY"),  # upper case — the parser lower-cases, so this is unreachable
        ("embeddings", ""),  # empty segment
    ],
)
def test_a_malformed_retires_declaration_is_a_step_bug_not_a_silent_no_op(bad) -> None:
    """A declaration that cannot match reads exactly like "no retired variable is set" — the
    protection would be off for a path the step believed it had retired. Same class as slice 1's empty
    `consumes` entry, and refused the same way."""
    step = cm.Step(version=1, applies=lambda _c: False, apply=lambda _c: cm.Plan(config={}), retires=(bad,))
    with pytest.raises(cm.MigrationRefused, match="step 1 bug"):
        cm.retired_env_overrides([step], {"CTRLB_EMBEDDINGS__API_KEY": "x"})


# ── the boot path must not print what it validated ───────────────────────────────────────────────


def test_load_settings_never_echoes_a_rejected_value(tmp_path, monkeypatch) -> None:
    """A pydantic `ValidationError` renders `input_value=…` for every failing field — for a provider,
    the whole dict including its `api_key`. Uncaught at `main.py` that traceback lands in the systemd
    journal, which the security model forbids. The env path reaches it easily: an override onto an
    undeclared provider key is warned about and still applied, and then fails validation."""
    cfg = tmp_path / "config.yaml"
    cfg.write_text("server:\n  port: 5433\n", encoding="utf-8")
    monkeypatch.setenv("CTRLB_PROVIDERS__OPENROUTER__API_KEY", "sk-SYNTHETIC-CANARY")
    with pytest.raises(cm_config.ConfigValidationError) as exc:
        load_settings(cfg)
    rendered = f"{exc.value}{exc.value.__cause__ or ''}{exc.value.__context__ or ''}"
    assert "sk-SYNTHETIC-CANARY" not in rendered
    assert "providers" in str(exc.value) and str(cfg) in str(exc.value)  # location, not value
    tb = exc.tb
    assert tb is not None and "raw" not in (tb.tb_frame.f_locals if tb.tb_next is None else {})


@pytest.mark.parametrize(
    "doc",
    [
        {"providers": {"p": {"base_url": "http://x", "api_key": ["sk-VALUE-CANARY"]}}},  # wrong type
        {"providers": {"p": {"base_url": "http://x", "models": {"m": {"dim": "sk-VALUE-CANARY"}}}}},
        {"inference": {"request_timeout_s": "sk-VALUE-CANARY"}},
    ],
)
def test_no_rejected_VALUE_survives_sanitising(doc) -> None:
    """The property, across error shapes rather than one canary: pydantic's `msg` and `loc` may name a
    field or a mapping KEY, never the rejected VALUE. A key is public in this system (masking is
    value-side; provider names are `/<provider>` composer verbs), a value may be a credential."""
    with pytest.raises(ValidationError) as exc:
        Settings.model_validate(doc)
    assert "sk-VALUE-CANARY" in str(exc.value)  # pydantic itself leaks it…
    assert "sk-VALUE-CANARY" not in cm_config.sanitise_validation_error(exc.value, "config.yaml")


def test_a_hostile_variable_name_cannot_forge_a_log_line(monkeypatch, caplog) -> None:
    """Variable NAMES are operator-supplied text on their way to the journal, and `env(1)`/`execve`
    accept a newline in one even though no shell can produce it."""
    monkeypatch.setenv("CTRLB_EVIL\n2026-01-01 CRITICAL forged__KEY", "x")
    with caplog.at_level(logging.WARNING, logger=_LOGGER):
        _apply_env_overrides({})
    assert "\n" not in caplog.records[0].getMessage()
    assert "\\n" in caplog.records[0].getMessage()


# ── the invariant that keeps the next step honest ────────────────────────────────────────────────


def test_no_retired_path_names_a_live_field() -> None:
    """A step may only retire a path the CURRENT schema no longer declares.

    Asserted against the live models rather than reviewed by eye: `embeddings.model` and
    `inference.fallbacks` are both consumed by the A11 fold and both still exist, so the tempting
    derivation (`retires` = what the step consumed) produces a guard that refuses valid overrides.
    """
    for section, key in A11_RETIRED_ENV_PATHS:
        assert Settings.model_fields.get(section) is not None, f"`{section}` is not a config section"
        assert not _declared(section, key), f"`{section}.{key}` is still a declared field"


def test_the_retired_list_is_exactly_what_the_fold_kills_and_the_schema_forgot() -> None:
    """COMPLETENESS, derived — the soundness test above passes for an empty list, so it cannot catch a
    path that is missing.

    The membership rule is mechanical, so assert it mechanically instead of pinning six hand-written
    tuples: a path is retired iff the fold **consumes** it, the one-level grammar can **address** it
    (two segments — the voice slots are three and were never reachable by an env var), and the new
    schema no longer **declares** it. Add a fold that eats a two-segment key without listing it here
    and this fails; list one the schema still declares and the soundness test fails.
    """
    plan = a11_apply(
        cm.Context(
            config_path=Path("/nonexistent/config.yaml"),
            agents_dir=Path("/nonexistent/agents"),
            # MAXIMAL by necessity: the fold only declares what it actually found, so a fixture
            # missing one legacy key silently shrinks the derived set. (It caught exactly that on the
            # first run — `inference.cloud` was absent here and therefore never consumed.)
            config={
                "inference": {
                    "default_mode": "local",
                    "local": {"base_url": "http://l/v1", "model": "m"},
                    "cloud": {"base_url": "http://c/v1", "model": "m2", "api_key": "sk-c"},
                    "fallbacks": [{"base_url": "http://fb/v1", "model": "fbm"}],
                },
                "voice": {
                    "stt": {
                        "primary": {"base_url": "http://s/v1", "model": "w"},
                        "fallback": {"base_url": "http://s2/v1", "model": "w2"},
                    },
                    "tts": {
                        "primary": {"base_url": "http://t/v1", "model": "t"},
                        "fallback": {"base_url": "http://t2/v1", "model": "t2"},
                    },
                },
                "embeddings": {"base_url": "http://e/v1", "model": "emb", "dim": 8, "api_key": "sk-x"},
            },
        )
    )
    consumed = {tuple(cm.as_path(c)) for c in plan.consumes}
    assert {p for p in consumed if len(p) == 2 and not _declared(*p)} == set(A11_RETIRED_ENV_PATHS)
    # …and every one of them is genuinely addressable by the grammar it guards.
    for path in A11_RETIRED_ENV_PATHS:
        var = "CTRLB_" + "__".join(p.upper() for p in path)
        assert env_override_vars({var: "x"}) == [(var, *path)]
