"""The import-time config preflight — UPDATE_PLAN slice 4.

`app.main._preflight_config()` runs at **module import**, before `create_app()`, because that is the
only place `sys.exit(78)` survives: the same call inside the FastAPI lifespan is swallowed by uvicorn's
`except BaseException` and becomes 3 (§3.7). The unit pairs it with `RestartPreventExitStatus=78`.

Most tests call the function directly: re-importing `app.main` under a mangled environment would leave
a half-initialised module in `sys.modules` for every later test. The two properties that cannot be
reached that way get their own shapes — the wiring is asserted over the **AST** (a source-substring
check passes with the call under `if False:`), and the real process exit code by a **subprocess** that
genuinely imports the module.
"""

from __future__ import annotations

import ast
import logging
import os
import subprocess
import sys
from pathlib import Path

import pytest

from app import config_migration as cm
from app import main

_LEGACY = (
    "inference:\n  default_mode: local\n  local:\n"
    "    base_url: http://l/v1\n    model: m\n    api_key: sk-LEGACY-CANARY\n"
)


def _home(tmp_path, monkeypatch, text: str | None) -> Path:
    home = tmp_path / "home"
    home.mkdir()
    if text is not None:
        (home / "config.yaml").write_text(text, encoding="utf-8")
    monkeypatch.setenv("CTRLB_HOME", str(home))
    monkeypatch.delenv("CTRLB_CONFIG", raising=False)
    return home


def test_it_is_wired_at_import_before_the_app_object() -> None:
    """Order is the whole point: after `create_app()` the check would run too late to stop the boot.

    Asserted over the **AST**, not the source text: a substring check passes just as happily when the
    call sits inside `if False:`, in another function, or commented out with the marker intact (Codex —
    the first version of this test was theatre). Here the call must be a top-level statement, and it
    must precede the top-level binding of `app`.
    """
    tree = ast.parse(Path(main.__file__).read_text(encoding="utf-8"))
    calls = [
        i
        for i, node in enumerate(tree.body)
        if isinstance(node, ast.Expr)
        and isinstance(node.value, ast.Call)
        and getattr(node.value.func, "id", None) == "_preflight_config"
    ]
    binds = [
        i
        for i, node in enumerate(tree.body)
        if isinstance(node, ast.Assign) and any(getattr(t, "id", None) == "app" for t in node.targets)
    ]
    assert calls and binds, "the preflight call or the `app` binding is no longer top-level"
    assert calls[0] < binds[0]


def test_a_genuine_import_of_app_main_exits_78(tmp_path) -> None:
    """The property the AST test can only approximate: a REAL `import app.main` against a legacy config
    ends the process with 78 and a sanitised message. Run in a subprocess because an import that calls
    `sys.exit` cannot be repeated inside this one — and because only a real process has an exit code."""
    home = tmp_path / "home"
    home.mkdir()
    (home / "config.yaml").write_text(_LEGACY, encoding="utf-8")
    env = {**os.environ, "CTRLB_HOME": str(home)}
    env.pop("CTRLB_CONFIG", None)
    done = subprocess.run(
        [sys.executable, "-c", "import app.main"],
        cwd=Path(main.__file__).resolve().parents[1],
        env=env,
        capture_output=True,
        text=True,
    )
    assert done.returncode == cm.EXIT_REFUSE
    assert "config migration required" in done.stderr
    assert "-m app.config_migration --apply" in done.stderr
    # "sanitised" asserted, not claimed (Codex): the fixture carries a credential, and a real import
    # is the only place a stray traceback would surface it.
    assert "sk-LEGACY-CANARY" not in done.stderr + done.stdout


@pytest.mark.parametrize(
    ("name", "config"),
    [
        # Stamped, migration-free, and still unloadable: `detect()` never validates, so without the
        # `load_settings()` proof this reached the lifespan and became uvicorn exit 3 — which
        # `RestartPreventExitStatus=78` does NOT cover, i.e. a crash-loop (measured).
        ("a value the schema rejects", "config_version: 1\nserver:\n  port: not-a-number\n"),
        # Both YAML parsers let a CONSTRUCTOR failure escape as a bare `ValueError` whose message quotes
        # the input ("day 99 must be in range 1..31 …") — not a YAML error class, so the parse handler
        # missed it entirely.
        ("an impossible date", "config_version: 1\nproviders:\n  p:\n    api_key: 2026-01-99\n"),
    ],
)
def test_an_unloadable_config_is_terminal_and_quiet(name, config, tmp_path, monkeypatch, capsys) -> None:
    _home(tmp_path, monkeypatch, config)
    with pytest.raises(SystemExit) as exc:
        main._preflight_config()
    assert exc.value.code == cm.EXIT_REFUSE, name
    err = capsys.readouterr().err
    assert "not-a-number" not in err and "day 99" not in err  # locations, never values
    assert "2026" not in err


def test_a_step_bug_at_boot_is_terminal_not_retryable(tmp_path, monkeypatch, capsys) -> None:
    """A malformed `retires` declaration raises `MigrationRefused` (78). It is reported through the
    boundary, not left to escape as a bare exception — which would have become exit 1 and retried
    forever at RestartSec=5 (Codex)."""
    _home(tmp_path, monkeypatch, "server:\n  port: 5433\n")
    cm.apply(cm.context_from_env())

    def raises_a_step_bug(*_a, **_k):
        raise cm.MigrationRefused("step 1 bug: `retires` entry ('x',) is not a lower-case pair")

    # Injected at the call, not by patching `STEPS`: `retired_env_overrides(steps=STEPS)` binds STEPS as
    # a DEFAULT ARGUMENT at import, so patching the module attribute would not reach it and the test
    # would pass while exercising nothing. What is being pinned here is the boundary, not the step.
    monkeypatch.setattr(cm, "retired_env_overrides", raises_a_step_bug)
    with pytest.raises(SystemExit) as exc:
        main._preflight_config()
    assert exc.value.code == cm.EXIT_REFUSE  # its own code — NOT an escaped exception's exit 1
    assert "config migration:" in capsys.readouterr().err  # …and routed through the shared reporter


def test_a_broken_bootstrap_variable_is_terminal_and_sanitised(tmp_path, monkeypatch, capsys) -> None:
    """`CTRLB_HOME=~nosuchuser` raises `RuntimeError` out of `Path.expanduser()` — a type no handler
    anticipated. The catch-all names the TYPE only (the same structural answer as the runner's
    `_call_step`) and exits 78, because no restart repairs an environment variable."""
    monkeypatch.setenv("CTRLB_HOME", "~definitely_no_such_user_here/ctrl-b")
    monkeypatch.delenv("CTRLB_CONFIG", raising=False)
    with pytest.raises(SystemExit) as exc:
        main._preflight_config()
    assert exc.value.code == cm.EXIT_REFUSE
    err = capsys.readouterr().err
    assert "RuntimeError" in err and "CTRLB_HOME" in err
    assert "definitely_no_such_user_here" not in err  # the environment is not echoed back


def test_a_legacy_config_stops_the_boot_with_78_and_the_venv_command(tmp_path, monkeypatch, capsys) -> None:
    _home(tmp_path, monkeypatch, _LEGACY)
    with pytest.raises(SystemExit) as exc:
        main._preflight_config()
    assert exc.value.code == cm.EXIT_REFUSE  # RestartPreventExitStatus=78 → terminal, no crash-loop
    err = capsys.readouterr().err
    assert "inference.default_mode" in err  # names the legacy keys…
    assert "-m app.config_migration --apply" in err  # …and the exact command that fixes it
    assert str(Path(sys.executable).name) in err  # venv-qualified: plain `python` cannot import app


def test_a_downgrade_reports_through_the_shared_reporter(tmp_path, monkeypatch, capsys) -> None:
    """A config from a NEWER build is refused by `detect()`; the preflight must render it through the
    same `report_refusal` the CLI uses, not invent a second wording."""
    _home(tmp_path, monkeypatch, "config_version: 99\nserver:\n  port: 5433\n")
    with pytest.raises(SystemExit) as exc:
        main._preflight_config()
    assert exc.value.code == cm.EXIT_REFUSE
    out = capsys.readouterr().err
    assert "written by a newer build" in out and "config migration:" in out


def test_a_migrated_config_boots_silently(tmp_path, monkeypatch, capsys) -> None:
    home = _home(tmp_path, monkeypatch, "server:\n  port: 5433\n")
    cm.apply(cm.context_from_env())  # stamp it, as an update would
    main._preflight_config()  # no SystemExit
    assert capsys.readouterr().err == ""
    assert (home / "config.yaml").exists()


def test_an_absent_config_is_a_no_op(tmp_path, monkeypatch) -> None:
    """First install: nothing to migrate, and the preflight must not create anything."""
    home = _home(tmp_path, monkeypatch, None)
    main._preflight_config()
    assert not (home / "config.yaml").exists()


def test_a_retired_override_is_LOGGED_not_fatal(tmp_path, monkeypatch, caplog) -> None:
    """The §13.1 ruling, pinned where it is easiest to get wrong later: refusals live at the attended
    gates; at boot this only logs, because an unauthenticated provider fails visibly at call time while
    a refusing unit takes down the only UI there is to diagnose it from."""
    _home(tmp_path, monkeypatch, "server:\n  port: 5433\n")
    cm.apply(cm.context_from_env())
    monkeypatch.setenv("CTRLB_EMBEDDINGS__API_KEY", "sk-SECRET")
    with caplog.at_level(logging.ERROR, logger="app.main"):
        main._preflight_config()  # emphatically NOT SystemExit
    assert len(caplog.records) == 1
    message = caplog.records[0].getMessage()
    assert "CTRLB_EMBEDDINGS__API_KEY" in message and "embeddings.api_key" in message
    assert "sk-SECRET" not in message
    assert "systemctl --user show" in message  # where a service-only variable hides


def test_the_units_prevent_the_crash_loop() -> None:
    """The code half is useless without the unit half: exit 78 with `Restart=on-failure` and no
    `StartLimitBurst` is an infinite loop at RestartSec=5 (measured: 5 restarts in 8s)."""
    units = Path(main.__file__).resolve().parents[2] / "deploy" / "linux" / "systemd"
    for unit in ("ctrl-b-dashboard.service", "ctrl-b-dashboard-dev.service"):
        text = (units / unit).read_text(encoding="utf-8")
        assert "RestartPreventExitStatus=78" in text, unit
