"""UPDATE_PLAN slice 1 — the config-migration RUNNER (`app/config_migration`).

Nothing has moved out of `config.py` yet, so the real `STEPS` tuple is empty and the runner is driven
here by **fake steps**: that is the point of the slice, and it is also its honest limit — A11 detection,
the slot map and the unmigratable-state classification are slice-2 integration tests and are NOT
covered here.

Covered: `applies()`-always · side-file detection · step chaining · the postcondition (including a
later step legitimately restoring an earlier step's consumed path) · stamp-when-unchanged ·
absent/empty never stamped · downgrade refusal (78) · the 78-vs-1 exit taxonomy · marker validation
(`true`, `null`, negative) · symlink, FIFO, anchor/alias/merge, duplicate key, unknown tag,
multi-document, non-UTF-8, non-string-key refusals · **no secret in any `--check` or error output**,
including via a duplicate key, a syntax error and a crafted tag · sanitised `ValidationError` ·
unwritable config/agent dirs · undeclared and empty-declaration removals · agent-path confinement ·
the YAML 1.1/1.2 dialect trap · type-only changes · dotted key names · partial agent write converges
on re-run · a file changed under us · backups (0600, pre-state, attributable) · `--check` creating
nothing · the repo-root fallback warning · `VERSION` == `STEPS[-1].version` · the marker never
reaching the API · the real `python -m app.config_migration` subprocess.
"""

from __future__ import annotations

import os
import stat
import subprocess
import sys
from pathlib import Path
from typing import Any

import pytest
import yaml

from app import config_migration as cm
from app.config import CONFIG_VERSION_KEY, load_settings

SECRET = "sk-DO-NOT-LEAK-ME"

LEGACY = f"""# ctrl-b config — operator's own header
server:
  port: 5433   # the port
  debug: no    # a YAML 1.1 bool; ruamel reads 1.2 and would rewrite it to `false`
oddball: 012   # 1.1 octal (=10) vs 1.2 decimal (=12)

# This block documents the legacy section and must die WITH it
inference:
  local:
    base_url: http://x/v1
    model: m
    api_key: {SECRET}

# Voice — a trailing header that must be re-homed, not destroyed
voice:
  stt: {{}}
"""


# ── helpers ──────────────────────────────────────────────────────────────────────────────────────


def _home(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, config: str | None = LEGACY, **agents: str
) -> Path:
    """A workspace root with a `config.yaml` and optional `agents/<name>/agent.yaml` files."""
    home = tmp_path / "home"
    home.mkdir(exist_ok=True)
    if config is not None:
        (home / "config.yaml").write_text(config, encoding="utf-8")
        os.chmod(home / "config.yaml", 0o600)
    for name, text in agents.items():
        (home / "agents" / name).mkdir(parents=True, exist_ok=True)
        (home / "agents" / name / "agent.yaml").write_text(text, encoding="utf-8")
    monkeypatch.setenv("CTRLB_HOME", str(home))
    monkeypatch.delenv("CTRLB_CONFIG", raising=False)
    return home


def _fold_applies(ctx: cm.Context) -> bool:
    """The stand-in trigger: a legacy `inference.local`, or an agent still holding `model.mode`."""
    inf = ctx.config.get("inference")
    if isinstance(inf, dict) and "local" in inf:
        return True
    return any("mode" in (d.get("model") or {}) for d in ctx.agents.values())


def _fold_apply(ctx: cm.Context) -> cm.Plan:
    config = dict(ctx.config)
    inf = dict(config.get("inference") or {})
    local = inf.pop("local", None)
    config["inference"] = inf
    if isinstance(local, dict):
        config["providers"] = {
            "llamacpp": {
                "base_url": local.get("base_url"),
                "api_key": local.get("api_key"),
                "models": {local.get("model", "m"): {}},
            }
        }
    agent_files = {
        p: {
            **d,
            "model": {k: v for k, v in (d.get("model") or {}).items() if k != "mode"}
            | {"provider": "llamacpp"},
        }
        for p, d in ctx.agents.items()
        if "mode" in (d.get("model") or {})
    }
    return cm.Plan(config=config, consumes=["inference.local"], agent_files=agent_files)


FOLD = (cm.Step(1, _fold_applies, _fold_apply),)


def _step(version: int, trigger: str, transform: Any, consumes: list[str] | None = None) -> cm.Step:
    """A one-key fake step: applies while `trigger` is a top-level key; `transform(config)` rewrites."""
    return cm.Step(
        version,
        lambda ctx: trigger in ctx.config,
        lambda ctx: cm.Plan(config=transform(dict(ctx.config)), consumes=consumes or [trigger]),
    )


def _read(home: Path) -> str:
    return (home / "config.yaml").read_text(encoding="utf-8")


# ── the step contract ────────────────────────────────────────────────────────────────────────────


def test_version_literal_matches_the_last_step() -> None:
    """§3.6 — declared for machines (`update.sh` reads the file), asserted for humans."""
    assert cm.CONFIG_VERSION == (cm.STEPS[-1].version if cm.STEPS else 0)
    assert (Path(cm.__file__).parent / "VERSION").read_text(encoding="utf-8").strip().isdigit()


def test_applies_is_evaluated_even_when_the_file_is_stamped(tmp_path, monkeypatch) -> None:
    """§3.1 — the marker orders and detects downgrades; it never gates the trigger."""
    home = _home(tmp_path, monkeypatch, f"{CONFIG_VERSION_KEY}: {cm.CONFIG_VERSION}\n" + LEGACY)
    ctx = cm.context_from_env()
    assert cm.read_marker(ctx.config) == cm.CONFIG_VERSION
    assert cm.needs_migration(ctx, FOLD) is True
    cm.apply(ctx, FOLD)
    assert "local:" not in _read(home)


def test_steps_chain_in_version_order(tmp_path, monkeypatch) -> None:
    """Each step sees the document as the previous one left it (the `db.py::MIGRATIONS` shape)."""
    _home(tmp_path, monkeypatch, "a: 1\n")
    second = _step(2, "b", lambda c: {k: v for k, v in c.items() if k != "b"} | {"c": c["b"] + 1})
    first = _step(1, "a", lambda c: {k: v for k, v in c.items() if k != "a"} | {"b": c["a"] + 1})
    plan = cm.build_plan(cm.context_from_env(), (second, first))  # deliberately out of order
    assert plan is not None and plan.config == {"c": 3}


def test_side_file_alone_triggers_a_migration(tmp_path, monkeypatch) -> None:
    """§3.1 (Codex B1) — an agent still holding a legacy key can never be stamped "verified"."""
    home = _home(tmp_path, monkeypatch, "server:\n  port: 5433\n", fable="# notes\nmodel:\n  mode: local\n")
    ctx = cm.context_from_env()
    assert cm.needs_migration(ctx, FOLD) is True
    cm.apply(ctx, FOLD)
    agent = (home / "agents" / "fable" / "agent.yaml").read_text(encoding="utf-8")
    assert "mode:" not in agent and "provider: llamacpp" in agent
    assert "# notes" in agent  # the operator's prose survives the rewrite
    assert cm.needs_migration(cm.context_from_env(), FOLD) is False


def test_undeclared_removal_is_refused_before_anything_is_written(tmp_path, monkeypatch) -> None:
    """A step that drops an unrelated section is a step bug — caught in `--check`, before backups."""
    home = _home(tmp_path, monkeypatch, "keep_me:\n  a: 1\ndrop_trigger: 1\n")
    bad = _step(1, "drop_trigger", lambda c: {"drop_trigger_done": 1}, consumes=["drop_trigger"])
    with pytest.raises(cm.MigrationRefused, match="keep_me"):
        cm.check(cm.context_from_env(), (bad,))
    with pytest.raises(cm.MigrationRefused, match="keep_me"):
        cm.apply(cm.context_from_env(), (bad,))
    assert "keep_me" in _read(home)
    assert not (home / "backups").exists()  # a refused run leaves nothing behind


def test_an_empty_declaration_authorises_nothing(tmp_path, monkeypatch) -> None:
    """`()` is a prefix of every path, so tolerating it would let one malformed declaration authorise
    every removal in the document — defeating the guard entirely."""
    _home(tmp_path, monkeypatch, "keep_me: 1\ntrigger: 1\n")
    for bad_decl in ((), "", ["", "x"]):
        step = _step(1, "trigger", lambda c: {"done": 1}, consumes=[bad_decl])
        with pytest.raises(cm.MigrationRefused, match="not a usable key path"):
            cm.check(cm.context_from_env(), (step,))
    assert "keep_me" in _read(tmp_path / "home")


def test_a_type_only_change_is_still_written(tmp_path, monkeypatch) -> None:
    """Python says `True == 1 == 1.0` and `[True] == [1]`, so plain `!=` would drop a step's type
    normalisation, write the rest of its plan, pass the postcondition and stamp a document the step
    never computed."""
    _home(tmp_path, monkeypatch, "flag: true\nnum: 1.0\nlist:\n  - true\ntrigger: 1\n")
    normalise = _step(
        1,
        "trigger",
        lambda c: {k: v for k, v in c.items() if k != "trigger"} | {"flag": 1, "num": 1, "list": [1]},
    )
    cm.apply(cm.context_from_env(), (normalise,))
    written = cm.context_from_env().config
    assert written["flag"] == 1 and type(written["flag"]) is int
    assert type(written["num"]) is int
    assert type(written["list"][0]) is int


def test_a_step_may_only_rewrite_agent_files_the_runner_parsed(tmp_path, monkeypatch) -> None:
    """An arbitrary path had no symlink/parse preflight and no backup — the runner would be writing
    somewhere nobody checked."""
    home = _home(tmp_path, monkeypatch, "trigger: 1\n")
    outside = tmp_path / "outside.yaml"
    step = cm.Step(
        1,
        lambda ctx: "trigger" in ctx.config,
        lambda ctx: cm.Plan(
            config={k: v for k, v in ctx.config.items() if k != "trigger"},
            consumes=["trigger"],
            agent_files={outside: {"a": 1}},
        ),
    )
    with pytest.raises(cm.MigrationRefused, match="never parsed"):
        cm.check(cm.context_from_env(), (step,))
    assert not outside.exists()
    assert not (home / "backups").exists()


@pytest.mark.skipif(
    os.name == "nt" or getattr(os, "geteuid", lambda: 1)() == 0,
    reason="root ignores directory permissions; Windows chmod cannot revoke write",
)
def test_a_read_only_agent_directory_fails_the_check_not_the_apply(tmp_path, monkeypatch) -> None:
    home = _home(tmp_path, monkeypatch, LEGACY, fable="model:\n  mode: local\n")
    ctx = cm.context_from_env()
    os.chmod(home / "agents" / "fable", 0o500)
    try:
        with pytest.raises(cm.MigrationRefused, match="not writable"):
            cm.check(ctx, FOLD)
    finally:
        os.chmod(home / "agents" / "fable", 0o700)


def test_a_marker_that_is_present_but_null_is_refused(tmp_path, monkeypatch) -> None:
    """`config_version:` with no value normalises to 0 — which at VERSION 0 would read as "verified"
    and skip the rewrite that would have fixed it."""
    _home(tmp_path, monkeypatch, f"{CONFIG_VERSION_KEY}:\na: 1\n")
    with pytest.raises(cm.MigrationRefused, match="must be an integer"):
        cm.read_marker(cm.context_from_env().config)


def test_a_negative_marker_is_read_as_zero_but_not_as_verified(tmp_path, monkeypatch) -> None:
    home = _home(tmp_path, monkeypatch, f"{CONFIG_VERSION_KEY}: -3\na: 1\n")
    ctx = cm.context_from_env()
    assert cm.read_marker(ctx.config) == 0
    assert cm.is_stamped(ctx.config) is False
    assert cm.apply(ctx, ()).wrote is True  # the malformed marker gets corrected, not left alone
    assert yaml.safe_load(_read(home))[CONFIG_VERSION_KEY] == cm.CONFIG_VERSION


def test_a_secret_shaped_yaml_tag_is_not_echoed(tmp_path, monkeypatch) -> None:
    """`exc.problem` quotes the tag verbatim, and a tag is operator-written text."""
    _home(tmp_path, monkeypatch, f"api_key: !{SECRET} value\n")
    with pytest.raises(cm.MigrationRefused) as exc:
        cm.context_from_env()
    assert SECRET not in str(exc.value)


@pytest.mark.skipif(os.name == "nt", reason="no mkfifo on Windows")
def test_a_fifo_is_refused_rather_than_read(tmp_path, monkeypatch) -> None:
    """`read_bytes` on a FIFO blocks forever — and slice 4 runs this check at import time inside the
    systemd unit, so the service would hang instead of failing."""
    home = _home(tmp_path, monkeypatch, config=None)
    os.mkfifo(home / "config.yaml")
    with pytest.raises(cm.MigrationRefused, match="not a regular file"):
        cm.context_from_env()


# ── the write protocol ───────────────────────────────────────────────────────────────────────────


def test_a_key_whose_name_contains_a_dot_is_still_removable(tmp_path, monkeypatch) -> None:
    """Model and provider keys legitimately contain dots — `qwen/qwen3.5-72b` is in the live config —
    so removals travel as key segments. A dotted path would split the name and silently no-op."""
    home = _home(
        tmp_path,
        monkeypatch,
        "providers:\n  p:\n    models:\n      qwen3.5-72b: {}\n      keep-me: {}\n",
    )
    dotted_key = ("providers", "p", "models", "qwen3.5-72b")

    def drop(ctx: cm.Context) -> cm.Plan:
        config = {"providers": {"p": {"models": {"keep-me": {}}}}}
        return cm.Plan(config=config, consumes=[dotted_key])

    step = cm.Step(1, lambda ctx: "qwen3.5-72b" in ctx.config["providers"]["p"]["models"], drop)
    cm.apply(cm.context_from_env(), (step,))
    out = _read(home)
    assert "qwen3.5-72b" not in out and "keep-me" in out


def test_apply_preserves_comments_and_kills_the_consumed_block(tmp_path, monkeypatch) -> None:
    home = _home(tmp_path, monkeypatch)
    cm.apply(cm.context_from_env(), FOLD)
    out = _read(home)
    assert "# ctrl-b config — operator's own header" in out
    assert "# the port" in out
    assert "# Voice — a trailing header that must be re-homed, not destroyed" in out
    assert "local:" not in out and "providers:" in out


def test_untouched_leaves_survive_the_yaml_dialect_gap(tmp_path, monkeypatch) -> None:
    """The runner writes the DIFF, not the document: `edit_config_yaml` parses YAML 1.2 while the plan
    is built from `safe_load`'s 1.1, so a whole-document sync would rewrite `no` → `false` and
    `012` → `10` in config the migration was never asked to touch."""
    home = _home(tmp_path, monkeypatch)
    cm.apply(cm.context_from_env(), FOLD)
    out = _read(home)
    assert "debug: no" in out
    assert "oddball: 012" in out


def test_stamp_is_written_even_when_nothing_changed(tmp_path, monkeypatch) -> None:
    """§3.2 — the stamp means "verified at level N", not "changed at level N"."""
    home = _home(tmp_path, monkeypatch, "server:\n  port: 5433   # keep me\n")
    applied = cm.apply(cm.context_from_env(), ())
    assert applied.wrote is True
    out = _read(home)
    assert out.startswith(f"{CONFIG_VERSION_KEY}: {cm.CONFIG_VERSION}")
    assert "# keep me" in out


def test_reapply_on_a_verified_config_touches_nothing(tmp_path, monkeypatch) -> None:
    home = _home(tmp_path, monkeypatch, "server:\n  port: 5433\n")
    cm.apply(cm.context_from_env(), ())
    before = (home / "config.yaml").read_bytes()
    n_backups = len(list((home / "backups").iterdir()))
    applied = cm.apply(cm.context_from_env(), ())
    assert applied.wrote is False
    assert (home / "config.yaml").read_bytes() == before
    assert len(list((home / "backups").iterdir())) == n_backups  # no backup churn either


def test_absent_and_empty_configs_are_never_created_or_stamped(tmp_path, monkeypatch) -> None:
    home = _home(tmp_path, monkeypatch, config=None)
    assert cm.apply(cm.context_from_env(), ()).wrote is False
    assert not (home / "config.yaml").exists()
    (home / "config.yaml").write_text("", encoding="utf-8")
    assert cm.apply(cm.context_from_env(), ()).wrote is False
    assert _read(home) == ""


def test_backup_holds_the_pre_migration_state_at_0600(tmp_path, monkeypatch) -> None:
    _home(tmp_path, monkeypatch, LEGACY, fable="model:\n  mode: local\n")
    applied = cm.apply(cm.context_from_env(), FOLD)
    assert len(applied.backups) == 2
    config_bak = next(b for b in applied.backups if b.name.startswith("config.yaml"))
    agent_bak = next(b for b in applied.backups if b.name.startswith("fable--"))  # names stay attributable
    assert config_bak.read_text(encoding="utf-8") == LEGACY
    assert "mode: local" in agent_bak.read_text(encoding="utf-8")
    for b in applied.backups:
        assert stat.S_IMODE(b.stat().st_mode) == 0o600


def test_a_file_changed_since_it_was_read_is_refused(tmp_path, monkeypatch) -> None:
    """The plan was computed against a snapshot; applying it over someone else's write is a lost update."""
    home = _home(tmp_path, monkeypatch)
    ctx = cm.context_from_env()
    (home / "config.yaml").write_text(LEGACY + "someone_else: 1\n", encoding="utf-8")
    with pytest.raises(cm.MigrationRefused, match="changed on disk"):
        cm.apply(ctx, FOLD)
    assert "someone_else" in _read(home)


def test_a_partial_agent_write_converges_on_re_run(tmp_path, monkeypatch) -> None:
    """§3.4 — no rollback for step 4 by design: the config is the commit point, so a crash between the
    agent write and the commit leaves a state nobody can observe, and re-running converges."""
    home = _home(tmp_path, monkeypatch, LEGACY, fable="model:\n  mode: local\n")

    def boom(*_a: Any, **_k: Any) -> None:
        raise RuntimeError("crash after the agent write, before the commit")

    monkeypatch.setattr(cm, "_write_config", boom)
    with pytest.raises(RuntimeError):
        cm.apply(cm.context_from_env(), FOLD)
    agent = home / "agents" / "fable" / "agent.yaml"
    assert "provider: llamacpp" in agent.read_text(encoding="utf-8")  # agent already rewritten
    assert "local:" in _read(home)  # config still legacy → the app would refuse to boot
    monkeypatch.undo()
    cm.apply(cm.context_from_env(), FOLD)  # re-run converges
    assert cm.needs_migration(cm.context_from_env(), FOLD) is False


def test_postcondition_failure_says_it_was_committed(tmp_path, monkeypatch) -> None:
    """§3.3 — a step whose transform does not actually clear its own trigger must fail loudly."""
    _home(tmp_path, monkeypatch, "trigger: 1\n")
    lazy = cm.Step(1, lambda ctx: "trigger" in ctx.config, lambda ctx: cm.Plan(config=dict(ctx.config)))
    with pytest.raises(cm.MigrationRefused, match="verification FAILED") as exc:
        cm.apply(cm.context_from_env(), (lazy,))
    assert "WAS committed" in str(exc.value)
    assert "backups" in exc.value.remedy


# ── the marker ───────────────────────────────────────────────────────────────────────────────────


def test_marker_absent_or_negative_reads_as_zero(tmp_path, monkeypatch) -> None:
    _home(tmp_path, monkeypatch, "a: 1\n")
    assert cm.read_marker(cm.context_from_env().config) == 0
    _home(tmp_path, monkeypatch, f"{CONFIG_VERSION_KEY}: -3\na: 1\n")
    assert cm.read_marker(cm.context_from_env().config) == 0


def test_marker_true_is_not_version_one(tmp_path, monkeypatch) -> None:
    """`bool` is an `int` in Python — `isinstance` would read `true` as version 1 and skip a migration."""
    _home(tmp_path, monkeypatch, f"{CONFIG_VERSION_KEY}: true\na: 1\n")
    with pytest.raises(cm.MigrationRefused, match="must be an integer"):
        cm.read_marker(cm.context_from_env().config)


def test_a_newer_config_is_refused_with_78(tmp_path, monkeypatch, capsys) -> None:
    _home(tmp_path, monkeypatch, f"{CONFIG_VERSION_KEY}: {cm.CONFIG_VERSION + 5}\na: 1\n")
    assert cm.main(["--check"], ()) == cm.EXIT_REFUSE
    assert cm.main(["--apply"], ()) == cm.EXIT_REFUSE
    err = capsys.readouterr().err
    assert "newer build" in err and "Rollback" in err  # the remedy points at the runbook section


def test_the_marker_never_reaches_the_settings_model(tmp_path, monkeypatch) -> None:
    """§3.8 — `Settings` is `extra="allow"`, so an un-popped marker would ride `model_dump` out to
    `GET /api/settings` and back in through a PUT."""
    home = _home(tmp_path, monkeypatch, f"{CONFIG_VERSION_KEY}: 0\nserver:\n  port: 5433\n")
    settings = load_settings(home / "config.yaml")
    assert CONFIG_VERSION_KEY not in settings.model_dump()


# ── refusals ─────────────────────────────────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    ("name", "text", "match"),
    [
        ("anchor", "a: &x 1\nb: *x\n", "anchors/aliases"),
        ("anchored merge", "base: &b {k: 1}\nc:\n  <<: *b\n", "anchors/aliases"),
        ("inline merge", "c:\n  <<: {k: 1}\n", "merge keys"),
        ("duplicate", f"api_key: {SECRET}\napi_key: other\n", "duplicate key"),
        ("unknown tag", "a: !mystery {b: 1}\n", "unsupported YAML tag"),
        ("multi-document", "a: 1\n---\nb: 2\n", "another document"),
        ("not a mapping", "- 1\n- 2\n", "mapping at the top level"),
        ("non-string key", "1: a\n", "not a string"),
    ],
)
def test_unusable_configs_are_refused(tmp_path, monkeypatch, name, text, match) -> None:
    _home(tmp_path, monkeypatch, text)
    with pytest.raises(cm.MigrationRefused, match=match):
        cm.context_from_env()


def test_a_duplicate_key_error_does_not_echo_its_values(tmp_path, monkeypatch) -> None:
    """ruamel's message is *"found duplicate key "x" with value …(original value: …)"* — for a
    duplicated `api_key:` that is the secret, in the console and in the journal."""
    _home(tmp_path, monkeypatch, f"api_key: {SECRET}\napi_key: {SECRET}2\n")
    with pytest.raises(cm.MigrationRefused) as exc:
        cm.context_from_env()
    assert SECRET not in str(exc.value)
    assert "line 2" in str(exc.value)


def test_a_syntax_error_does_not_echo_the_offending_line(tmp_path, monkeypatch) -> None:
    _home(tmp_path, monkeypatch, f'api_key: "{SECRET}\nbroken\n')
    with pytest.raises(cm.MigrationRefused) as exc:
        cm.context_from_env()
    assert SECRET not in str(exc.value)


def test_non_utf8_is_refused_cleanly(tmp_path, monkeypatch) -> None:
    home = _home(tmp_path, monkeypatch, "a: 1\n")
    (home / "config.yaml").write_bytes(b"a: \xff\xfe\n")
    with pytest.raises(cm.MigrationRefused, match="not valid UTF-8"):
        cm.context_from_env()


def test_a_symlinked_config_is_refused(tmp_path, monkeypatch) -> None:
    """`config_path()` calls `.resolve()`, erasing symlink-ness — the check must `lstat` the operator's
    own path, or `os.replace` silently swaps the link for a regular file."""
    home = _home(tmp_path, monkeypatch, config=None)
    real = tmp_path / "elsewhere.yaml"
    real.write_text("a: 1\n", encoding="utf-8")
    (home / "config.yaml").symlink_to(real)
    with pytest.raises(cm.MigrationRefused, match="symlink"):
        cm.context_from_env()


def test_a_symlinked_agent_file_is_refused(tmp_path, monkeypatch) -> None:
    home = _home(tmp_path, monkeypatch, "a: 1\n")
    (home / "agents" / "fable").mkdir(parents=True)
    real = tmp_path / "shared-agent.yaml"
    real.write_text("model:\n  mode: local\n", encoding="utf-8")
    (home / "agents" / "fable" / "agent.yaml").symlink_to(real)
    with pytest.raises(cm.MigrationRefused, match="symlink"):
        cm.context_from_env()


def test_a_broken_agent_file_is_refused_not_skipped(tmp_path, monkeypatch) -> None:
    """Skipping would leave a file the new reader rejects — and would let the config be stamped."""
    _home(tmp_path, monkeypatch, "a: 1\n", fable="model:\n  - [\n")
    with pytest.raises(cm.MigrationRefused, match="agents/fable/agent.yaml"):
        cm.context_from_env()


@pytest.mark.skipif(
    os.name == "nt" or getattr(os, "geteuid", lambda: 1)() == 0,
    reason="root ignores directory permissions; Windows chmod cannot revoke write",
)
def test_an_unwritable_directory_fails_the_check(tmp_path, monkeypatch) -> None:
    home = _home(tmp_path, monkeypatch)
    ctx = cm.context_from_env()
    os.chmod(home, 0o500)
    try:
        with pytest.raises(cm.MigrationRefused, match="not writable"):
            cm.check(ctx, FOLD)
    finally:
        os.chmod(home, 0o700)


def test_a_validation_error_is_rendered_without_the_rejected_values(tmp_path, monkeypatch) -> None:
    """A pydantic `ValidationError` prints the rejected dict — for a provider that is its `api_key`."""
    _home(tmp_path, monkeypatch, "trigger: 1\n")
    bad = _step(
        1,
        "trigger",
        lambda c: (
            {k: v for k, v in c.items() if k != "trigger"}
            | {"providers": {"p": {"base_url": "http://x", "api_key": SECRET, "models": "not-a-map"}}}
        ),
    )
    with pytest.raises(cm.MigrationRefused) as exc:
        cm.check(cm.context_from_env(), (bad,))
    assert SECRET not in str(exc.value)
    assert "providers.p.models" in str(exc.value)


# ── the CLI ──────────────────────────────────────────────────────────────────────────────────────


def test_check_reports_names_and_never_values(tmp_path, monkeypatch, capsys) -> None:
    _home(tmp_path, monkeypatch, LEGACY, fable="model:\n  mode: local\n")
    assert cm.main(["--check"], FOLD) == cm.EXIT_OK  # a needed-but-valid migration is exit 0
    out = capsys.readouterr()
    assert SECRET not in out.out and SECRET not in out.err
    assert "http://x/v1" not in out.out  # not even non-secret values
    assert "inference.local" in out.out and "fable" in out.out
    assert str(tmp_path / "home" / "config.yaml") in out.out
    assert "local:" in _read(tmp_path / "home")  # --check wrote nothing


def test_apply_reports_what_it_wrote_and_where_the_backup_is(tmp_path, monkeypatch, capsys) -> None:
    home = _home(tmp_path, monkeypatch)
    assert cm.main(["--apply"], FOLD) == cm.EXIT_OK
    out = capsys.readouterr().out
    assert SECRET not in out
    assert "backup:" in out and str(home / "backups") in out
    assert cm.main(["--check"], FOLD) == cm.EXIT_OK
    assert "not needed" in capsys.readouterr().out


@pytest.mark.parametrize(
    ("name", "config"),
    [
        ("anchors", "a: &x 1\nb: *x\n"),
        ("symlink-free garbage", "\ta: 1\n"),
        ("bad marker", f"{CONFIG_VERSION_KEY}: true\na: 1\n"),
    ],
)
def test_a_config_this_build_cannot_migrate_exits_78_not_1(tmp_path, monkeypatch, name, config) -> None:
    """The taxonomy slice 4 freezes: 78 = "no restart fixes this" (the unit stops with a message the
    operator can act on), 1 = environmental and worth retrying. Without it, `RestartPreventExitStatus=78`
    would leave every bad config crash-looping at `RestartSec=5` forever — `ctrl-b-dashboard.service`
    has no burst limit, so systemd's own guard never trips."""
    _home(tmp_path, monkeypatch, config)
    assert cm.main(["--check"], ()) == cm.EXIT_REFUSE


def test_an_environmental_failure_exits_1_so_a_retry_is_worth_it(tmp_path, monkeypatch) -> None:
    home = _home(tmp_path, monkeypatch)
    ctx = cm.context_from_env()
    (home / "config.yaml").write_text(LEGACY + "someone_else: 1\n", encoding="utf-8")
    with pytest.raises(cm.MigrationRefused) as exc:
        cm.apply(ctx, FOLD)
    assert exc.value.exit_code == cm.EXIT_FAIL


def test_check_creates_nothing_at_all(tmp_path, monkeypatch) -> None:
    """ "Writes nothing" has to include directories — an operator diffing their home after a read-only
    check should see it untouched."""
    home = _home(tmp_path, monkeypatch)
    before = sorted(p.name for p in home.iterdir())
    assert cm.main(["--check"], FOLD) == cm.EXIT_OK
    assert sorted(p.name for p in home.iterdir()) == before
    assert not (home / "backups").exists()


def test_a_later_step_may_restore_a_path_an_earlier_step_consumed(tmp_path, monkeypatch) -> None:
    """The ageing case: in two years a step 3 correction restores a key step 1 consumed. That is a
    correct migration, and it must not trip the post-commit leftover assertion."""
    _home(tmp_path, monkeypatch, "old:\n  legacy: 1\n")
    consume = cm.Step(  # step 1: folds `old` (identified by its legacy leaf) into `new`
        1,
        lambda ctx: "legacy" in (ctx.config.get("old") or {}),
        lambda ctx: cm.Plan(
            config={k: v for k, v in ctx.config.items() if k != "old"} | {"new": {"k": 1}},
            consumes=["old"],
        ),
    )
    restore = cm.Step(  # step 3: that fold was wrong — put it back, without the legacy leaf
        3,
        lambda ctx: "new" in ctx.config,
        lambda ctx: cm.Plan(
            config={k: v for k, v in ctx.config.items() if k != "new"} | {"old": {"k": 1}},
            consumes=["new"],
        ),
    )
    applied = cm.apply(cm.context_from_env(), (consume, restore))  # no MigrationRefused
    assert applied.wrote is True
    assert cm.context_from_env().config["old"] == {"k": 1}


def test_a_bare_shell_run_says_it_fell_back_to_the_repo_root(tmp_path, monkeypatch, capsys) -> None:
    """`CTRLB_HOME` is unexported by design, so the 1am human running this from a plain shell would
    otherwise be told "not needed" about a config that is not prod's."""
    _home(tmp_path, monkeypatch, "server:\n  port: 5433\n")
    monkeypatch.delenv("CTRLB_HOME")
    monkeypatch.delenv("CTRLB_CONFIG", raising=False)
    cm.main(["--check"], ())
    assert "repo-root fallback" in capsys.readouterr().out


def test_the_suite_isolation_guard_is_active() -> None:
    """§3.7 / Codex B9 — the module-level half of `conftest.py`. The import-time boot check (slice 4)
    runs while a test module is being *imported*, before any fixture; an inherited `CTRLB_ENV` would
    otherwise send `load_dotenv()` at the operator's real `.env`."""
    assert os.environ["CTRLB_ENV"].endswith(".env-absent")
    assert not Path(os.environ["CTRLB_ENV"]).exists()
    assert "CTRLB_CONFIG" not in os.environ and "CTRLB_DB" not in os.environ


def test_the_cli_requires_a_mode(tmp_path, monkeypatch) -> None:
    _home(tmp_path, monkeypatch)
    with pytest.raises(SystemExit):
        cm.main([], FOLD)


def test_module_entrypoint_runs_as_a_real_process(tmp_path, monkeypatch) -> None:
    """`install.sh` and `update.sh` invoke `python -m app.config_migration` — so the thing under test
    is the actual subprocess, not `main()` called in-process. This is the only test that would catch a
    broken `__main__.py`, a missing `VERSION` file in the installed tree, or an import that only works
    once pytest has already imported the app."""
    home = _home(tmp_path, monkeypatch, "server:\n  port: 5433\n")
    env = {**os.environ, "CTRLB_HOME": str(home), "PYTHONPATH": str(Path(cm.__file__).parents[2])}
    run = subprocess.run(
        [sys.executable, "-m", "app.config_migration", "--apply"],
        capture_output=True,
        text=True,
        env=env,
        cwd=str(Path(cm.__file__).parents[2]),
    )
    assert run.returncode == cm.EXIT_OK, run.stderr
    assert "wrote:" in run.stdout
    assert yaml.safe_load(_read(home))[CONFIG_VERSION_KEY] == cm.CONFIG_VERSION
