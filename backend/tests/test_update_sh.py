"""update.sh's marker precheck vs the marker the migrator ACTUALLY writes (the v1.3.1 refusal).

The v1.3.1 release was refused pre-cutover: the migrator stamps
`config_version: 1  # config shape version — managed by ...` (ruamel end-of-line comment), and
update.sh fed the raw remainder of that line to `parse_version`, which rightly rejects anything
that is not a plain integer. The v1.3.0 bootstrap run passed only because the config was still
UNSTAMPED — the first stamp broke the first shipped-script run. `marker_value()` now cuts the
value at the first `#`; these tests run the REAL script's functions (extracted, under
`set -euo pipefail` — the recorded lesson: a fragment must be exercised under the options of the
script that will run it) against a config stamped by the REAL writer, so neither side of the
contract can drift silently again.
"""

from __future__ import annotations

import subprocess
from pathlib import Path

from app import config_migration as cm

UPDATE_SH = Path(__file__).resolve().parents[2] / "deploy" / "linux" / "update.sh"

MINIMAL_NEW_SHAPE = "server:\n  port: 5433\n"


def _home(tmp_path, monkeypatch, config: str) -> Path:
    home = tmp_path / "home"
    home.mkdir(exist_ok=True)
    (home / "config.yaml").write_text(config, encoding="utf-8")
    (home / "config.yaml").chmod(0o600)
    monkeypatch.setenv("CTRLB_HOME", str(home))
    monkeypatch.delenv("CTRLB_CONFIG", raising=False)
    return home


def _shell_functions() -> str:
    """Extract `parse_version` + `marker_value` from the REAL update.sh — fails loudly if either
    is renamed/removed, which is exactly the drift this file exists to catch."""
    text = UPDATE_SH.read_text(encoding="utf-8")
    parts: list[str] = []
    for name in ("parse_version", "marker_value"):
        start = text.index(f"{name}()")
        end = text.index("\n}", start)
        parts.append(text[start : end + 2])
    return "\n".join(parts)


def _precheck(cfg: Path) -> subprocess.CompletedProcess[str]:
    """update.sh's disk-marker extraction, verbatim in shape, under the script's own options."""
    script = (
        "set -euo pipefail\n"
        + _shell_functions()
        + "\n"
        + 'marker_line="$(grep -m1 \'^config_version:\' "$1" 2>/dev/null || true)"\n'
        + '[ -n "$marker_line" ] || { echo "NOMARKER"; exit 3; }\n'
        + 'parse_version "$(marker_value "$marker_line")"\n'
    )
    return subprocess.run(["bash", "-c", script, "_", str(cfg)], capture_output=True, text=True, timeout=30)


def test_precheck_parses_the_marker_the_migrator_writes(tmp_path, monkeypatch) -> None:
    home = _home(tmp_path, monkeypatch, MINIMAL_NEW_SHAPE)
    assert cm.apply(cm.context_from_env(), ()).wrote is True  # the real stamp, real writer
    cfg = home / "config.yaml"
    marker_line = next(
        line for line in cfg.read_text(encoding="utf-8").splitlines() if line.startswith("config_version:")
    )
    assert "#" in marker_line  # the premise: ruamel stamps the managed-by comment on the marker
    res = _precheck(cfg)
    assert res.returncode == 0, res.stderr
    assert res.stdout == str(cm.CONFIG_VERSION)


def test_precheck_rejects_a_garbage_marker(tmp_path, monkeypatch) -> None:
    home = _home(tmp_path, monkeypatch, "config_version: banana  # not a shape version\n")
    res = _precheck(home / "config.yaml")
    assert res.returncode != 0
    assert res.stdout == ""  # rejected, not coerced — `tr -dc` history must not repeat


def test_precheck_still_accepts_a_bare_uncommented_marker(tmp_path, monkeypatch) -> None:
    home = _home(tmp_path, monkeypatch, "config_version: 1\nserver:\n  port: 5433\n")
    res = _precheck(home / "config.yaml")
    assert res.returncode == 0
    assert res.stdout == "1"
