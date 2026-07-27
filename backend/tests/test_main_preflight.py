"""The import-time config preflight — UPDATE_PLAN slice 4.

`app.main._preflight_config()` runs at **module import**, before `create_app()`, because that is the
only place `sys.exit(78)` survives: the same call inside the FastAPI lifespan is swallowed by uvicorn's
`except BaseException` and becomes 3 (§3.7). The unit pairs it with `RestartPreventExitStatus=78`.

The function is tested directly rather than by re-importing `app.main`: importing it a second time
under a mangled environment would leave a half-initialised module in `sys.modules` for every later
test. The *wiring* (that it is called at import at all) is asserted by reading the module source, which
is cheap and cannot itself break the suite.
"""

from __future__ import annotations

import logging
from pathlib import Path

import pytest

from app import config_migration as cm
from app import main

_LEGACY = "inference:\n  default_mode: local\n  local:\n    base_url: http://l/v1\n    model: m\n"


def _home(tmp_path, monkeypatch, text: str | None) -> Path:
    home = tmp_path / "home"
    home.mkdir()
    if text is not None:
        (home / "config.yaml").write_text(text, encoding="utf-8")
    monkeypatch.setenv("CTRLB_HOME", str(home))
    monkeypatch.delenv("CTRLB_CONFIG", raising=False)
    return home


def test_it_is_wired_at_import_before_the_app_object() -> None:
    """Order is the whole point: after `create_app()` the check would run too late to stop the boot."""
    src = Path(main.__file__).read_text(encoding="utf-8")
    assert src.index("_preflight_config()  # ←") < src.index("app = create_app()")


def test_a_legacy_config_stops_the_boot_with_78_and_the_venv_command(tmp_path, monkeypatch, capsys) -> None:
    _home(tmp_path, monkeypatch, _LEGACY)
    with pytest.raises(SystemExit) as exc:
        main._preflight_config()
    assert exc.value.code == cm.EXIT_REFUSE  # RestartPreventExitStatus=78 → terminal, no crash-loop
    err = capsys.readouterr().err
    assert "inference.default_mode" in err  # names the legacy keys…
    assert "-m app.config_migration --apply" in err  # …and the exact command that fixes it
    assert str(Path(main.sys.executable).name) in err  # venv-qualified: plain `python` cannot import app


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
