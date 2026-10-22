"""`deploy/linux/update.sh` — its marker reader, its VERSION reader, its restore advice, and the REAL
script end to end in a stubbed sandbox.

History (why this file looks the way it does):

* **v1.3.1 (2026-07-28)** — the release was refused pre-cutover: the migrator stamps
  `config_version: 1  # config shape version — managed by ...` (ruamel end-of-line comment), and
  update.sh fed the raw remainder of that line to `parse_version`, which rightly rejects anything that
  is not a plain integer. The v1.3.0 bootstrap run passed only because the config was still UNSTAMPED —
  the first stamp broke the first shipped-script run. `marker_value()` cut the value at the first `#`,
  and this file (then `test_update_sh_marker.py`) ran the precheck on a config stamped by the REAL
  writer — but through a RE-TYPED copy of the precheck's read, under `set -euo pipefail`.
* **ISS-90 (2026-10-22)** — the same omission at a THIRD read site: the failure report parsed the
  marker without `marker_value`, so after a run that migrated it said "the config was NOT migrated
  (still shape 0) — the tag revert alone is sufficient". `0f87652b` had fixed "both call sites" while
  three existed, and the re-typed fragment test could not see a call site it did not copy; no test ran
  `main()` at all. The fix (UPDATE_PLAN §18) is ONE reader (`config_shape`), ONE VERSION reader
  (`build_version`), ONE restore printer, and this file now pins them three ways:

  - **unit** — the REAL script's functions, extracted and run under the script's own options (the
    recorded lesson: a fragment must be exercised under the options of the script that runs it): the
    marker spellings table, the `build_version` rc ladder (incl. a real `--filter=blob:none` clone with
    the blob unavailable), the backup-set pick against decoys, the restore block's wording;
  - **structural** — tripwires against the regression CLASS: a fourth marker read, a second VERSION
    read, a `|| echo 0` on the recovery path, a one-argument `print_config_restore`, backticks inside a
    double-quoted echo (`bash -n` cannot see that one);
  - **end to end** — the oracle the suite lacked: the REAL `update.sh` in a sandbox HOME (a bare
    origin, tags vOLD/vNEW with their own VERSION, `systemctl`/`curl`/`gh` stubbed FIRST on PATH, vNEW's
    stub `install.sh` running the REAL migrator `--apply`), asserting the report's text AND executing
    the `cp` lines it prints. Cases E1–E11 are the council's, E5b and E12 the review rounds'
    (`UPDATE_PLAN` §18).
"""

from __future__ import annotations

import json
import os
import re
import shlex
import shutil
import stat
import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path

import pytest

from app import config_migration as cm

REPO_ROOT = Path(__file__).resolve().parents[2]
UPDATE_SH = REPO_ROOT / "deploy" / "linux" / "update.sh"
BACKEND = REPO_ROOT / "backend"
BASE_PATH = "/usr/local/bin:/usr/bin:/bin"

MINIMAL_NEW_SHAPE = "server:\n  port: 5433\n"
SHAPE4 = "config_version: 4  # config shape version — managed by `python -m app.config_migration`\nserver:\n  port: 5433\n"
AGENT_LEGACY = "user_name: Ari\n"  # step 5 renames it to `persona:` and derives the persona library

FUNCTIONS = (
    "parse_version",
    "marker_value",
    "config_shape",
    "build_version",
    "backup_stamps",
    "agent_backups",
    "restore_stamp",
    "latest_backup",
    "config_backup",
    "records",
    "record_stamp",
    "record_pairs",
    "record_state",
    "open_run",
    "superseded_for",
    "offer_set",
    "reflog_from",
    "q",
    "print_config_restore",
)


# ── helpers: the real script's functions ─────────────────────────────────────────────────────────


def _script() -> str:
    return UPDATE_SH.read_text(encoding="utf-8")


def _function_spans(text: str) -> dict[str, tuple[int, int]]:
    """Line spans (0-based, inclusive) of every top-level `name() {` … `}` block in the script."""
    spans: dict[str, tuple[int, int]] = {}
    lines = text.splitlines()
    for i, line in enumerate(lines):
        one = re.match(r"^([a-z_]+)\(\) \{ .* \}$", line)
        if one:
            spans[one.group(1)] = (i, i)
            continue
        m = re.match(r"^([a-z_]+)\(\) \{$", line)
        if m:
            end = next(j for j in range(i + 1, len(lines)) if lines[j] == "}")
            spans[m.group(1)] = (i, end)
    return spans


def _shell_functions(*names: str) -> str:
    """The REAL definitions, extracted — fails loudly if one is renamed or removed, which is exactly the
    drift this file exists to catch."""
    text = _script()
    lines = text.splitlines()
    spans = _function_spans(text)
    return "\n".join("\n".join(lines[spans[n][0] : spans[n][1] + 1]) for n in names) + "\n"


def _clean_env(tmp: Path, **extra: str) -> dict[str, str]:
    """A hand-built environment: nothing inherited (no GIT_DIR from a hook, no CTRLB_*), git identity
    set, temp files kept inside the test's own folder."""
    tdir = tmp / "tmp"
    tdir.mkdir(parents=True, exist_ok=True)
    env = {
        "HOME": str(tmp),
        "PATH": BASE_PATH,
        "LANG": "C.UTF-8",
        "TMPDIR": str(tdir),
        "GIT_CONFIG_NOSYSTEM": "1",
        "GIT_AUTHOR_NAME": "sandbox",
        "GIT_AUTHOR_EMAIL": "sandbox@example.invalid",
        "GIT_COMMITTER_NAME": "sandbox",
        "GIT_COMMITTER_EMAIL": "sandbox@example.invalid",
    }
    env.update(extra)
    return env


def _bash(tmp: Path, snippet: str, *args: str) -> subprocess.CompletedProcess[str]:
    """Run `snippet` after the real functions, under the script's own `set -euo pipefail`."""
    script = "set -euo pipefail\n" + _shell_functions(*FUNCTIONS) + snippet
    return subprocess.run(
        ["bash", "-c", script, "_", *args],
        capture_output=True,
        text=True,
        timeout=60,
        env=_clean_env(tmp),
    )


def _git(env: dict[str, str], *args: str, cwd: Path | None = None) -> str:
    return subprocess.run(
        ["git", *args], cwd=cwd, env=env, check=True, capture_output=True, text=True, timeout=60
    ).stdout.strip()


def _home(tmp_path: Path, monkeypatch: pytest.MonkeyPatch, config: str, **agents: str) -> Path:
    home = tmp_path / "home"
    home.mkdir(exist_ok=True)
    (home / "config.yaml").write_text(config, encoding="utf-8")
    (home / "config.yaml").chmod(0o600)
    for name, text in agents.items():
        (home / "agents" / name).mkdir(parents=True, exist_ok=True)
        (home / "agents" / name / "agent.yaml").write_text(text, encoding="utf-8")
    monkeypatch.setenv("CTRLB_HOME", str(home))
    monkeypatch.delenv("CTRLB_CONFIG", raising=False)
    return home


def _shape(tmp: Path, path: Path) -> subprocess.CompletedProcess[str]:
    return _bash(tmp, 'config_shape "$1"\n', str(path))


# ── unit: config_shape — the ONE marker reader ────────────────────────────────────────────────────


def test_config_shape_reads_the_marker_the_migrator_writes(tmp_path, monkeypatch) -> None:
    home = _home(tmp_path, monkeypatch, MINIMAL_NEW_SHAPE)
    assert cm.apply(cm.context_from_env(), ()).wrote is True  # the real stamp, real writer
    cfg = home / "config.yaml"
    marker_line = next(
        line for line in cfg.read_text(encoding="utf-8").splitlines() if line.startswith("config_version:")
    )
    assert "#" in marker_line  # the premise: ruamel stamps the managed-by comment on the marker
    res = _shape(tmp_path, cfg)
    assert res.returncode == 0, res.stderr
    assert res.stdout == str(cm.CONFIG_VERSION)


def test_config_shape_reads_a_restamped_commented_marker(tmp_path, monkeypatch) -> None:
    """The ISS-90 trigger: a re-stamp keeps the existing end-of-line comment (4 → 5)."""
    home = _home(tmp_path, monkeypatch, SHAPE4)
    assert cm.apply(cm.context_from_env(), ()).wrote is True
    res = _shape(tmp_path, home / "config.yaml")
    assert (res.returncode, res.stdout) == (0, str(cm.CONFIG_VERSION))


#: The council's spelling table (design v3.1 §1, adversary §8.1): (file bytes, expected) where expected
#: is an int or None = FAIL (rc 1, nothing printed). FAIL = a line that NAMES the key at column 0 but is
#: not the exact marker the migrator writes; 0 = no such line (the migrator's own "absent").
SPELLINGS: list[tuple[str, bytes, int | None]] = [
    ("commented", b"config_version: 5  # c\n", 5),
    ("crlf", b"config_version: 5\r\n", 5),
    ("tab-comment", b"config_version:\t5\t# c\n", None),  # the YAML scanner refuses a TAB there
    ("tab-after-colon", b"config_version:\t5\n", None),
    ("tab-before-comment", b"config_version: 5\t# c\n", None),
    ("trailing-space", b"config_version: 5 \n", 5),
    ("hash-glued", b"config_version: 5#c\n", None),
    (
        "no-space",
        b"config_version:5\n",
        None,
    ),  # not a mapping to YAML: the migrator refuses the file  # YAML: the string '5#c' — the migrator refuses
    ("letter", b"config_version: 5t\n", None),
    ("leading-zero", b"config_version: 05\n", None),  # not an int to the migrator
    ("extra-word", b"config_version: 5 extra\n", None),
    ("ten-digits", b"config_version: 1234567890\n", None),
    ("empty", b"config_version:\n", None),
    ("null", b"config_version: null\n", None),
    ("negative", b"config_version: -3\n", None),
    ("float", b"config_version: 5.0\n", None),
    ("quoted-value", b'config_version: "5"\n', None),
    ("plus", b"config_version: +5\n", None),
    ("hex", b"config_version: 0x5\n", None),
    ("space-before-colon", b"config_version : 5\n", None),
    ("bom", b"\xef\xbb\xbfconfig_version: 5\n", None),
    ("bom-crlf", b"\xef\xbb\xbfconfig_version: 5\r\n", None),
    ("double-quoted-key", b'"config_version": 5\n', None),
    ("single-quoted-key", b"'config_version': 5\n", None),
    ("other-case", b"Config_Version: 5\n", 0),  # YAML keys are case-sensitive
    ("indented", b"  config_version: 3\n", 0),
    ("nested", b"server:\n  config_version: 3\n", 0),
    ("literal-block", b"x: |\n  config_version: 9\n", 0),
    ("comment", b"# config_version: 7 old\nserver: {}\n", 0),
    ("prefix-key", b"config_version_old: 3\n", 0),
    ("flow", b"{config_version: 5, a: 1}\n", 0),  # accepted residual (design §1): reads 0
    ("absent", b"a: 1\n", 0),
    ("zero", b"config_version: 0\n", 0),
    ("all-whitespace-kinds", b"config_version: 5 \t# c \r\n", None),  # a TAB before the `#`
    ("spaces-comment-crlf", b"config_version: 5  # c \r\n", 5),
]


@pytest.mark.parametrize(
    ("raw", "expected"), [(r, e) for _, r, e in SPELLINGS], ids=[n for n, _, _ in SPELLINGS]
)
def test_config_shape_spellings(tmp_path, raw: bytes, expected: int | None) -> None:
    f = tmp_path / "config.yaml"
    f.write_bytes(raw)
    res = _shape(tmp_path, f)
    if expected is None:
        assert res.returncode != 0
        assert res.stdout == ""  # rejected, not coerced — `tr -dc` history must not repeat
    else:
        assert (res.returncode, res.stdout) == (0, str(expected)), res.stderr


def test_config_shape_absent_file_is_zero_and_unreadable_file_fails(tmp_path) -> None:
    assert _shape(tmp_path, tmp_path / "nope.yaml").stdout == "0"
    f = tmp_path / "locked.yaml"
    f.write_text("config_version: 5\n", encoding="utf-8")
    f.chmod(0)
    try:
        if os.access(f, os.R_OK):  # pragma: no cover — root reads anything
            pytest.skip("running as a user that ignores file modes")
        res = _shape(tmp_path, f)
        assert res.returncode != 0 and res.stdout == ""  # it exists: "absent → 0" would be a guess
    finally:
        f.chmod(0o600)


# ── unit: build_version — the ONE VERSION reader and its rc ladder ────────────────────────────────


def _version_repo(tmp: Path) -> tuple[Path, dict[str, str]]:
    env = _clean_env(tmp)
    src = tmp / "src"
    _git(env, "init", "-q", "-b", "main", str(src))
    _git(env, "config", "uploadpack.allowFilter", "true", cwd=src)
    vdir = src / "backend" / "app" / "config_migration"
    vdir.mkdir(parents=True)
    (src / "f").write_text("x\n", encoding="utf-8")
    for tag, content in (("vpre", None), ("vgood", "5\n"), ("vbad", "banana\n"), ("vlazy", "7\n")):
        if content is not None:
            (vdir / "VERSION").write_text(content, encoding="utf-8")
        _git(env, "add", "-A", cwd=src)
        _git(env, "commit", "-qm", tag, cwd=src)
        _git(env, "tag", "-a", tag, "-m", tag, cwd=src)
    return src, env


def _build_version(tmp: Path, repo: Path, rev: str) -> tuple[int, str]:
    res = _bash(
        tmp, 'r=0; v="$(build_version "$1" "$2")" || r=$?; printf "%s %s" "$r" "$v"\n', str(repo), rev
    )
    assert res.returncode == 0, res.stderr
    rc, _, value = res.stdout.partition(" ")
    return int(rc), value


def test_build_version_rc_ladder(tmp_path) -> None:
    src, _ = _version_repo(tmp_path)
    assert _build_version(tmp_path, src, "vgood") == (0, "5")
    assert _build_version(tmp_path, src, "vbad") == (1, "")  # damaged
    assert _build_version(tmp_path, src, "nosuch") == (2, "")  # unknown rev
    assert _build_version(tmp_path, src, "vpre") == (3, "")  # pre-runner tree


def test_build_version_blob_not_local_is_rc4_never_pre_runner(tmp_path) -> None:
    """Prod is a `--filter=blob:none` clone: offline, a missing blob fails `git show` exactly like a
    missing file. The tree still lists the file, so it must be rc 4 — never "predates the runner"."""
    src, env = _version_repo(tmp_path)
    cl = tmp_path / "blobless"
    _git(env, "clone", "-q", "--filter=blob:none", "--no-checkout", f"file://{src}", str(cl))
    _git(env, "checkout", "-q", "vgood", cwd=cl)  # fetches vgood's blobs; vlazy's stay remote
    _git(env, "remote", "set-url", "origin", "file:///nonexistent-origin", cwd=cl)  # offline
    assert _build_version(tmp_path, cl, "vgood") == (0, "5")
    assert _build_version(tmp_path, cl, "vlazy") == (4, "")
    assert _build_version(tmp_path, cl, "vpre") == (3, "")  # trees are local: absence is still provable
    assert _build_version(tmp_path, cl, "nosuch") == (2, "")


def test_build_version_unlistable_tree_is_rc2_not_absent(tmp_path) -> None:
    """A tree that cannot be listed (here: a `tree:0` clone, offline) is decided on ls-tree's EXIT
    status — its empty output must not read as "the file is absent" (rc 3)."""
    src, env = _version_repo(tmp_path)
    cl = tmp_path / "treeless"
    _git(env, "clone", "-q", "--filter=tree:0", "--no-checkout", f"file://{src}", str(cl))
    _git(env, "remote", "set-url", "origin", "file:///nonexistent-origin", cwd=cl)
    _git(env, "cat-file", "-e", "vgood^{commit}", cwd=cl)  # the commit IS here: rc 2 comes from ls-tree
    assert _build_version(tmp_path, cl, "vgood") == (2, "")


# ── unit: the backup set — restore_stamp, the run records, print_config_restore ──────────────────


def _real_backup_set(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> tuple[Path, str]:
    """A shape-4 config + an agent holding `user_name`, migrated by the REAL migrator: the backup names
    are the writer's, not this file's idea of them."""
    home = _home(tmp_path, monkeypatch, SHAPE4, maya=AGENT_LEGACY)
    applied = cm.apply(cm.context_from_env())
    names = sorted(b.name for b in applied.backups)
    m = re.fullmatch(r"config\.yaml\.(\d{8}T\d{6}Z)", names[0])
    assert m, names
    stamp = m.group(1)
    assert names == [f"config.yaml.{stamp}", f"maya--agent.yaml.{stamp}"]
    return home, stamp


def test_restore_stamp_picks_by_name_and_shape_ignoring_decoys(tmp_path, monkeypatch) -> None:
    home, real = _real_backup_set(tmp_path, monkeypatch)
    bk = home / "backups"
    (bk / "config.yaml.20980101T000000Z").write_text("config_version: 5\n", encoding="utf-8")
    (bk / "config.yaml.20990101T000000Z").write_text(
        "config_version: 9\n", encoding="utf-8"
    )  # newer, too new
    (bk / "config.yaml.20990102T000000Z").write_text(
        "config_version: banana\n", encoding="utf-8"
    )  # never offered
    for decoy in (
        "config.yaml.manual-prerelease-20990103T000000Z",
        "config.yaml.20990104T000000Z.manual",
        "config.yaml.20990105T000000Z.pre-v1.7.12",
        "config.yaml.20990106T000000Z-2.manual",
    ):
        (bk / decoy).write_text("config_version: 0\n", encoding="utf-8")  # shape 0 would qualify for ANY max

    def pick(max_: int) -> tuple[int, str]:
        res = _bash(tmp_path, 'restore_stamp "$1" "$2"\n', str(home), str(max_))
        return res.returncode, res.stdout

    assert pick(9) == (0, "20990101T000000Z")
    assert pick(5) == (0, "20980101T000000Z")
    assert pick(4) == (0, real)
    assert pick(3)[0] != 0


def test_backup_stamps_skip_non_files_and_record_names(tmp_path) -> None:
    bk = tmp_path / "home" / "backups"
    bk.mkdir(parents=True)
    (bk / "config.yaml.20261022T090000Z").write_text("config_version: 4\n", encoding="utf-8")
    (bk / "config.yaml.20261022T110000Z").mkdir()  # a directory would read as shape 0 for any max
    for name in ("config.yaml.20261022T120000Z.run", "config.yaml.20261022T130000Z-2.run.committed"):
        (bk / name).write_text("stamp=20261022T120000Z\n", encoding="utf-8")  # records are never backups
    res = _bash(tmp_path, 'backup_stamps "$1"\n', str(bk.parent))
    assert res.stdout.split() == ["20261022T090000Z"]


def test_a_crlf_marker_value_parses(tmp_path) -> None:
    """`marker_value` no longer strips `\r` itself (dead code, wave 5): `parse_version` strips whitespace,
    a CRLF file's `\r` included — this pins THAT."""
    res = _bash(tmp_path, 'parse_version "$(marker_value "$1")"\n', "config_version: 5\r")
    assert (res.returncode, res.stdout) == (0, "5")


def test_a_same_second_collision_set_is_found_and_restored_whole(tmp_path, monkeypatch) -> None:
    """`_backup` appends `-N` per FILE when a name exists: a second apply in one UTC second writes
    `config.yaml.<T>-2` (an earlier strict-only rule hid it and the report failed OPEN — adversary G2)."""
    import datetime as dt

    class Fixed(dt.datetime):
        @classmethod
        def now(cls, tz=None):  # type: ignore[override]
            return dt.datetime(2030, 1, 1, tzinfo=dt.UTC)

    stamp = "20300101T000000Z"
    home = _home(tmp_path, monkeypatch, SHAPE4, maya=AGENT_LEGACY)
    (home / "backups").mkdir()
    decoy = home / "backups" / f"config.yaml.{stamp}"  # the earlier apply of the same second
    decoy.write_text("config_version: 3\n", encoding="utf-8")
    monkeypatch.setattr(cm, "datetime", Fixed)
    names = sorted(b.name for b in cm.apply(cm.context_from_env()).backups)
    assert names == [f"config.yaml.{stamp}-2", f"maya--agent.yaml.{stamp}"]  # the premise, from the writer
    res = _bash(tmp_path, 'backup_stamps "$1"; echo; config_backup "$1" "$2"\n', str(home), stamp)
    assert res.stdout.split() == [stamp, str(home / "backups" / f"config.yaml.{stamp}-2")]
    decoy.unlink()  # the restore pick by shape must see the -2 set, not the shape-3 decoy
    res = _bash(tmp_path, 'print_config_restore "$1" 4\n', str(home))
    assert f"cp -p {home}/backups/config.yaml.{stamp}-2 {home}/config.yaml" in res.stdout
    assert f"cp -p {home}/backups/maya--agent.yaml.{stamp} {home}/agents/maya/agent.yaml" in res.stdout
    assert "shape 4." in res.stdout  # the -2 file, not the decoy (shape 3)


def test_print_config_restore_names_every_file_of_the_set(tmp_path, monkeypatch) -> None:
    home, stamp = _real_backup_set(tmp_path, monkeypatch)
    # an agent name containing `--` maps back to its own folder, not a truncated one
    (home / "backups" / f"a--b--agent.yaml.{stamp}").write_text("x: 1\n", encoding="utf-8")
    res = _bash(tmp_path, 'print_config_restore "$1" 4\n', str(home))
    assert res.returncode == 0, res.stderr
    out = res.stdout
    date = f"{stamp[0:4]}-{stamp[4:6]}-{stamp[6:8]} {stamp[9:11]}:{stamp[11:13]} UTC"
    assert f"backup set {stamp} — taken earlier — {date}, shape 4." in out
    assert "Config + 2 agent file(s) — all of them, never the config alone:" in out
    assert f"cp -p {home}/backups/config.yaml.{stamp} {home}/config.yaml" in out
    assert f"cp -p {home}/backups/maya--agent.yaml.{stamp} {home}/agents/maya/agent.yaml" in out
    assert f"cp -p {home}/backups/a--b--agent.yaml.{stamp} {home}/agents/a--b/agent.yaml" in out
    assert "&&" not in out  # one command per line: a failing line must not silently skip the rest
    assert "retrying a failed attempt of this same update" in out
    # the real migrator committed this set: its record is renamed, never open
    assert (home / "backups" / f"config.yaml.{stamp}.run.committed").is_file()
    assert _bash(tmp_path, 'open_run "$1"\n', str(home)).returncode != 0


def test_print_config_restore_quotes_paths_so_the_lines_run_as_printed(tmp_path) -> None:
    home = tmp_path / "my home"
    (home / "backups").mkdir(parents=True)
    (home / "agents" / "maya").mkdir(parents=True)
    stamp = "20261022T090000Z"
    (home / "backups" / f"config.yaml.{stamp}").write_text("config_version: 4\n", encoding="utf-8")
    (home / "backups" / f"maya--agent.yaml.{stamp}").write_text("user_name: Ari\n", encoding="utf-8")
    res = _bash(tmp_path, 'print_config_restore "$1" 4\n', str(home))
    assert res.returncode == 0, res.stderr
    lines = [ln.strip() for ln in res.stdout.splitlines() if ln.strip().startswith("cp -p ")]
    assert len(lines) == 2
    for line in lines:
        subprocess.run(["bash", "-c", line], check=True, env=_clean_env(tmp_path), timeout=30)
    assert (home / "config.yaml").read_text(encoding="utf-8") == "config_version: 4\n"
    assert (home / "agents" / "maya" / "agent.yaml").read_text(encoding="utf-8") == "user_name: Ari\n"


def test_print_config_restore_refuses_a_missing_max(tmp_path) -> None:
    res = _bash(tmp_path, 'r=0; print_config_restore "$1" || r=$?; echo "rc=$r"\n', str(tmp_path))
    assert "print_config_restore needs <home> <max>" in res.stdout
    assert res.stdout.rstrip().endswith("rc=1")


def test_print_config_restore_with_nothing_to_offer_prints_no_cp(tmp_path) -> None:
    home = tmp_path / "home"
    (home / "backups").mkdir(parents=True)
    (home / "backups" / "config.yaml.20990101T000000Z").write_text("config_version: 9\n", encoding="utf-8")
    res = _bash(tmp_path, 'r=0; print_config_restore "$1" 4 || r=$?; echo "rc=$r"\n', str(home))
    assert res.returncode == 0, res.stderr
    assert res.stdout.rstrip().endswith("rc=1")  # it FAILS, so no caller can print a continuation after it
    assert "✗ no backup taken by the config migration holds a config at shape 4 or below" in res.stdout
    assert not any("cp " in line for line in res.stdout.splitlines())


def test_print_config_restore_says_config_only_when_no_agent_shares_the_stamp(tmp_path) -> None:
    home = tmp_path / "home"
    (home / "backups").mkdir(parents=True)
    (home / "backups" / "config.yaml.20261022T090000Z").write_text("a: 1\n", encoding="utf-8")
    res = _bash(tmp_path, 'print_config_restore "$1" 0\n', str(home))
    assert (
        "Config only — if the run that took it also rewrote agent files, their backups are missing:"
        in res.stdout
    )
    assert "Config +" not in res.stdout


def _record_home(
    tmp_path: Path, lines: list[str], *, live_agent: str = "persona: ari\n"
) -> tuple[Path, Path]:
    """A home with a hand-written run record (`lines` after the `stamp=` line) and the files it names."""
    home = tmp_path / "home"
    (home / "backups").mkdir(parents=True)
    (home / "agents" / "maya").mkdir(parents=True)
    stamp = "20261022T090000Z"
    (home / "config.yaml").write_text("config_version: 4\n", encoding="utf-8")
    (home / "agents" / "maya" / "agent.yaml").write_text(live_agent, encoding="utf-8")
    (home / "backups" / f"config.yaml.{stamp}").write_text("config_version: 4\n", encoding="utf-8")
    (home / "backups" / f"maya--agent.yaml.{stamp}").write_text("user_name: Ari\n", encoding="utf-8")
    rec = home / "backups" / f"config.yaml.{stamp}.run"
    rec.write_text("\n".join([f"stamp={stamp}", *lines]) + "\n", encoding="utf-8")
    return home, rec


GOOD_PAIRS = [
    "backups/config.yaml.20261022T090000Z\tconfig.yaml",
    "backups/maya--agent.yaml.20261022T090000Z\tagents/maya/agent.yaml",
]


def test_an_open_record_is_open_until_its_files_are_back(tmp_path) -> None:
    home, rec = _record_home(tmp_path, GOOD_PAIRS)
    res = _bash(tmp_path, 'open_run "$1"\n', str(home))
    assert (res.returncode, res.stdout) == (0, f"{rec}\topen")
    res = _bash(tmp_path, 'print_config_restore "$1" 4 "$2"\n', str(home), str(rec))
    assert "the set of a migration that rewrote agent files and never committed" in res.stdout
    assert (
        f"cp -p {home}/backups/maya--agent.yaml.20261022T090000Z {home}/agents/maya/agent.yaml" in res.stdout
    )
    guard = [ln.strip() for ln in res.stdout.splitlines() if ln.strip().startswith("cmp -s ")]
    assert guard == [
        f"cmp -s {home}/backups/config.yaml.20261022T090000Z {home}/config.yaml && "
        f"cmp -s {home}/backups/maya--agent.yaml.20261022T090000Z {home}/agents/maya/agent.yaml && "
        f"mv -- {rec} {rec}.resolved"
    ]
    env = _clean_env(tmp_path)
    subprocess.run(["bash", "-c", guard[0]], env=env, timeout=30)  # files NOT back yet: it must not close
    assert rec.is_file()
    for line in [ln.strip() for ln in res.stdout.splitlines() if ln.strip().startswith("cp -p ")]:
        subprocess.run(["bash", "-c", line], check=True, env=env, timeout=30)
    subprocess.run(["bash", "-c", guard[0]], check=True, env=env, timeout=30)
    assert not rec.exists() and (rec.parent / (rec.name + ".resolved")).is_file()
    assert _bash(tmp_path, 'open_run "$1"\n', str(home)).returncode != 0
    # closed BY NAME: a later edit to a listed file cannot reopen it (wave 5, the reviewers' HIGH)
    (home / "agents" / "maya" / "agent.yaml").write_text("persona: edited\n", encoding="utf-8")
    assert _bash(tmp_path, 'open_run "$1"\n', str(home)).returncode != 0


def test_open_run_closes_by_rename_what_its_contents_prove(tmp_path) -> None:
    """Every file back without the guard line → `open_run` renames it `.run.resolved` itself; the live
    config above the record's config shape → the commit happened (a crash before the rename) →
    `.run.committed`."""
    home, rec = _record_home(tmp_path, GOOD_PAIRS, live_agent="user_name: Ari\n")
    assert _bash(tmp_path, 'open_run "$1"\n', str(home)).returncode != 0
    assert (rec.parent / (rec.name + ".resolved")).is_file() and not rec.exists()
    home2, rec2 = _record_home(tmp_path / "b", GOOD_PAIRS)
    (home2 / "config.yaml").write_text("config_version: 5\n", encoding="utf-8")
    assert _bash(tmp_path, 'open_run "$1"\n', str(home2)).returncode != 0
    assert (rec2.parent / (rec2.name + ".committed")).is_file() and not rec2.exists()


@pytest.mark.parametrize(
    "bad",
    [
        "/etc/passwd\tconfig.yaml",
        "backups/config.yaml.20261022T090000Z\t../../.bashrc",
        "backups/../x--agent.yaml.20261022T090000Z\tagents/maya/agent.yaml",
        "backups/maya--agent.yaml.20261022T090000Z\tagents/ma ya/agent.yaml",
        "backups/maya--agent.yaml.20261022T090000Z\tagents/maya/agent.yaml\textra",
        "backups/maya--agent.yaml.20261022T090000Z agents/maya/agent.yaml",
        "backups/maya--agent.yaml.20261022T090000Z\tconfig.yaml",  # the adversary's mismatched pair
        "backups/maya--agent.yaml.20261022T090000Z\tagents/zed/agent.yaml",  # another agent's file
        "backups/maya--agent.yaml.20261023T090000Z\tagents/maya/agent.yaml",  # another run's stamp
        "backups/..--agent.yaml.20261022T090000Z\tagents/../agent.yaml",  # only the `..` rule refuses it
    ],
)
def test_a_hostile_record_is_never_turned_into_cp_lines(tmp_path, bad: str) -> None:
    home, rec = _record_home(tmp_path, [GOOD_PAIRS[0], bad])
    res = _bash(tmp_path, 'open_run "$1"\n', str(home))
    assert res.returncode == 0 and "\tbroken:" in res.stdout  # never "closed": it blocks, loudly
    res = _bash(
        tmp_path, 'r=0; print_config_restore "$1" 4 "$2" || r=$?; echo "rc=$r"\n', str(home), str(rec)
    )
    assert "is not one the migrator wrote" in res.stdout and res.stdout.rstrip().endswith("rc=1")
    assert "cp " not in res.stdout


def test_a_record_whose_backup_is_missing_prints_the_stop_line_not_a_cp(tmp_path) -> None:
    home, rec = _record_home(tmp_path, GOOD_PAIRS)
    (home / "backups" / "maya--agent.yaml.20261022T090000Z").unlink()
    res = _bash(tmp_path, 'open_run "$1"\n', str(home))
    assert "\tbroken:backup " in res.stdout and "listed by the record is missing" in res.stdout
    res = _bash(
        tmp_path, 'r=0; print_config_restore "$1" 4 "$2" || r=$?; echo "rc=$r"\n', str(home), str(rec)
    )
    assert "listed by the record is missing — README §Rollback step 2." in res.stdout
    assert "cp " not in res.stdout and res.stdout.rstrip().endswith("rc=1")


def test_a_record_without_an_agent_pair_is_broken(tmp_path) -> None:
    """A config-only plan writes no record, so a record with fewer than two pairs is not the migrator's."""
    home, _rec = _record_home(tmp_path, [GOOD_PAIRS[0]])
    res = _bash(tmp_path, 'open_run "$1"\n', str(home))
    assert res.returncode == 0 and "\tbroken:" in res.stdout


def test_open_run_names_the_oldest_open_record(tmp_path) -> None:
    """No commit in between ⇒ every later attempt started from the first one's half state."""
    home, rec = _record_home(tmp_path, GOOD_PAIRS)
    later = "20261022T100000Z"
    (home / "backups" / f"config.yaml.{later}").write_text("config_version: 4\n", encoding="utf-8")
    (home / "backups" / f"maya--agent.yaml.{later}").write_text("persona: other\n", encoding="utf-8")
    (home / "backups" / f"config.yaml.{later}.run").write_text(
        f"stamp={later}\nbackups/config.yaml.{later}\tconfig.yaml\n"
        f"backups/maya--agent.yaml.{later}\tagents/maya/agent.yaml\n",
        encoding="utf-8",
    )
    res = _bash(tmp_path, 'open_run "$1"\n', str(home))
    assert (res.returncode, res.stdout) == (0, f"{rec}\topen")


def test_a_record_whose_first_pair_is_not_the_config_is_broken(tmp_path) -> None:
    """M10: the FIRST pair must restore `config.yaml` — the config backup onto an agent file is not a record."""
    home, _rec = _record_home(
        tmp_path,
        ["backups/config.yaml.20261022T090000Z\tagents/maya/agent.yaml", GOOD_PAIRS[1]],
    )
    res = _bash(tmp_path, 'open_run "$1"\n', str(home))
    assert res.returncode == 0 and "\tbroken:" in res.stdout


def test_a_record_whose_stamp_line_disagrees_with_its_name_is_broken(tmp_path) -> None:
    """M11: `stamp=` must equal the record's own name (pairs alone would follow the name)."""
    home, rec = _record_home(tmp_path, GOOD_PAIRS)
    rec.write_text(
        rec.read_text(encoding="utf-8").replace("stamp=20261022T090000Z", "stamp=20261023T090000Z")
    )
    res = _bash(tmp_path, 'open_run "$1"\n', str(home))
    assert res.returncode == 0 and "\tbroken:" in res.stdout


def test_a_superseded_record_whose_set_is_back_is_resolved_and_never_offered(tmp_path) -> None:
    """Wave 6 (b): `open_run` renames a restored SUPERSEDED record `.run.resolved` (never `committed` —
    that commit was another run's); one still differing stays superseded; a broken one is left alone."""
    home, rec = _record_home(tmp_path, GOOD_PAIRS, live_agent="user_name: Ari\n")  # every file back
    sup = rec.with_name(rec.name + ".superseded")
    rec.rename(sup)
    (home / "config.yaml").write_text("config_version: 4\n", encoding="utf-8")
    assert _bash(tmp_path, 'open_run "$1"\n', str(home)).returncode != 0
    assert not sup.exists() and (home / "backups" / "config.yaml.20261022T090000Z.run.resolved").is_file()
    home2, rec2 = _record_home(tmp_path / "b", GOOD_PAIRS)  # the agent still differs
    sup2 = rec2.with_name(rec2.name + ".superseded")
    rec2.rename(sup2)
    (home2 / "config.yaml").write_text("config_version: 5\n", encoding="utf-8")  # a later run committed
    assert _bash(tmp_path, 'open_run "$1"\n', str(home2)).returncode != 0
    assert sup2.is_file()  # never renamed committed, never resolved
    home3, rec3 = _record_home(tmp_path / "c", [GOOD_PAIRS[0]])  # broken
    sup3 = rec3.with_name(rec3.name + ".superseded")
    rec3.rename(sup3)
    assert _bash(tmp_path, 'open_run "$1"\n', str(home3)).returncode != 0 and sup3.is_file()


def test_records_order_by_stamp_then_collision_suffix(tmp_path) -> None:
    bk = tmp_path / "home" / "backups"
    bk.mkdir(parents=True)
    for name in (
        "config.yaml.20261022T090000Z-10.run",
        "config.yaml.20261022T090000Z-2.run",
        "config.yaml.20261022T090000Z.run",
        "config.yaml.20261021T090000Z-10.run",
    ):
        (bk / name).write_text("x\n", encoding="utf-8")
    res = _bash(tmp_path, 'records "$1" .run\n', str(bk.parent))
    assert [Path(x).name for x in res.stdout.split()] == [
        "config.yaml.20261021T090000Z-10.run",
        "config.yaml.20261022T090000Z.run",
        "config.yaml.20261022T090000Z-2.run",
        "config.yaml.20261022T090000Z-10.run",
    ]


# ── migrator: the run record (ISS-90 option C) ───────────────────────────────────────────────────


def _boom_config_write(monkeypatch: pytest.MonkeyPatch) -> None:
    def boom(*_a, **_k):
        raise OSError(28, "No space left on device", "config.yaml")

    monkeypatch.setattr(cm, "_write_config", boom)


def test_the_migrator_leaves_an_open_record_when_the_commit_fails_after_an_agent_write(
    tmp_path, monkeypatch
) -> None:
    home = _home(tmp_path, monkeypatch, SHAPE4, maya=AGENT_LEGACY)
    _boom_config_write(monkeypatch)
    with pytest.raises(OSError):
        cm.apply(cm.context_from_env())
    (rec,) = (home / "backups").glob("*.run")
    stamp = rec.name.removeprefix("config.yaml.").removesuffix(".run")
    assert rec.read_text(encoding="utf-8").splitlines() == [
        f"stamp={stamp}",
        f"backups/config.yaml.{stamp}\tconfig.yaml",
        f"backups/maya--agent.yaml.{stamp}\tagents/maya/agent.yaml",
    ]
    assert stat.S_IMODE(rec.stat().st_mode) == 0o600
    assert not list((home / "backups").glob("*.committed"))
    res = _bash(tmp_path, 'open_run "$1"\n', str(home))
    assert (res.returncode, res.stdout) == (0, f"{rec}\topen")


def test_a_normal_apply_renames_its_record_committed(tmp_path, monkeypatch) -> None:
    home, stamp = _real_backup_set(tmp_path, monkeypatch)
    assert sorted(p.name for p in (home / "backups").glob("*.run*")) == [f"config.yaml.{stamp}.run.committed"]


def test_no_record_when_the_plan_has_no_agent_files(tmp_path, monkeypatch) -> None:
    home = _home(tmp_path, monkeypatch, MINIMAL_NEW_SHAPE)
    assert cm.apply(cm.context_from_env(), ()).wrote is True
    assert not list((home / "backups").glob("*.run*"))


def test_the_record_is_removed_when_the_first_agent_write_fails(tmp_path, monkeypatch) -> None:
    home = _home(tmp_path, monkeypatch, SHAPE4, maya=AGENT_LEGACY)

    def boom(*_a, **_k):
        raise OSError(28, "No space left on device", "agent.yaml")

    monkeypatch.setattr(cm, "_write_agent", boom)
    with pytest.raises(OSError):
        cm.apply(cm.context_from_env())
    assert not list((home / "backups").glob("*.run*"))  # nothing half-applied, so nothing claims it
    assert len(list((home / "backups").glob("config.yaml.*"))) == 1  # the backups themselves stay


def test_a_later_commit_supersedes_an_open_record(tmp_path, monkeypatch) -> None:
    home = _home(tmp_path, monkeypatch, SHAPE4, maya=AGENT_LEGACY)
    _boom_config_write(monkeypatch)
    with pytest.raises(OSError):
        cm.apply(cm.context_from_env())
    (rec,) = (home / "backups").glob("*.run")
    monkeypatch.undo()
    monkeypatch.setenv("CTRLB_HOME", str(home))
    monkeypatch.delenv("CTRLB_CONFIG", raising=False)
    assert cm.apply(cm.context_from_env()).wrote is True  # the re-apply (ISS-114: a stamp-only commit)
    assert not list((home / "backups").glob("*.run"))
    assert (rec.parent / (rec.name + ".superseded")).is_file()


def test_a_same_second_second_apply_writes_its_own_record(tmp_path, monkeypatch) -> None:
    import datetime as dt

    class Fixed(dt.datetime):
        @classmethod
        def now(cls, tz=None):  # type: ignore[override]
            return dt.datetime(2030, 1, 1, tzinfo=dt.UTC)

    stamp = "20300101T000000Z"
    home = _home(tmp_path, monkeypatch, SHAPE4, maya=AGENT_LEGACY)
    (home / "backups").mkdir()
    (home / "backups" / f"config.yaml.{stamp}").write_text("config_version: 3\n", encoding="utf-8")
    monkeypatch.setattr(cm, "datetime", Fixed)
    cm.apply(cm.context_from_env())
    assert sorted(p.name for p in (home / "backups").glob("*.run*")) == [
        f"config.yaml.{stamp}-2.run.committed"
    ]


# ── migrator: the A-7 status line ────────────────────────────────────────────────────────────────


def test_a_stamp_only_apply_says_so_and_offers_no_restore(tmp_path, monkeypatch, capsys) -> None:
    """ISS-90 A-7: "not needed" on a run that moved the stamp read as "nothing changed", yet every
    runner-era build below the new stamp now refuses the file."""
    _home(tmp_path, monkeypatch, MINIMAL_NEW_SHAPE)
    assert cm.main(["--apply"], ()) == cm.EXIT_OK
    out = capsys.readouterr().out
    v = cm.CONFIG_VERSION
    assert (
        f"migration:      stamp only (0 → {v}) — runner-era builds below {v} refuse this file; "
        "pre-runner builds (no config_migration) read it blind" in out
    )
    assert "not needed" not in out
    assert "restore" not in out.lower()  # a stamp-only run strands nothing the migrator should undo
    assert cm.main(["--apply"], ()) == cm.EXIT_OK  # already verified: no write, the plain wording
    assert "migration:      not needed" in capsys.readouterr().out


# ── structural tripwires (the e2e below is the oracle; these catch the regression CLASS early) ────


def _code_lines() -> list[tuple[int, str]]:
    """(index, line) of every line that is neither a comment nor an `echo` — i.e. that can READ."""
    out = []
    for i, line in enumerate(_script().splitlines()):
        s = line.strip()
        if not s or s.startswith("#") or s.startswith("echo ") or s.startswith("|| echo "):
            continue
        out.append((i, line))
    return out


def _inside(i: int, *names: str) -> bool:
    spans = _function_spans(_script())
    return any(spans[n][0] <= i <= spans[n][1] for n in names)


def test_config_version_is_read_in_one_place() -> None:
    offenders = [
        line
        for i, line in _code_lines()
        if "config_version" in line and not _inside(i, "config_shape", "marker_value")
    ]
    assert offenders == [], (
        "update.sh reads `config_version` outside config_shape/marker_value — call config_shape instead "
        f"(the v1.3.1 refusal and ISS-90 were each a hand-copied read): {offenders}"
    )


def test_version_file_is_read_in_one_place() -> None:
    offenders = [
        line
        for i, line in _code_lines()
        if re.search(r"\bgit\b.*\b(show|ls-tree|cat-file)\b", line) and not _inside(i, "build_version")
    ]
    assert offenders == [], f"a second VERSION read — call build_version instead: {offenders}"


def test_the_recovery_path_never_defaults_an_unknown_to_zero() -> None:
    assert not re.search(r"\|\|\s*echo\s+0\b", _script()), (
        "`|| echo 0` turns 'unknown' into the permissive answer"
    )


def test_every_print_config_restore_call_passes_home_and_max() -> None:
    calls = [
        line.strip()
        for i, line in _code_lines()
        if "print_config_restore " in line and not line.strip().startswith("print_config_restore() {")
    ]
    assert calls, "no call sites found — the extraction is broken"
    for call in calls:
        tokens = shlex.split(call)
        args: list[str] = []
        for tok in tokens[tokens.index("print_config_restore") + 1 :]:
            if tok in ("||", "&&", "then", ";"):
                break
            args.append(tok.removesuffix(";"))
            if tok.endswith(";"):
                break
        assert len(args) >= 2, f"one-argument call dies on `set -u` mid-message: {call}"
        assert call.startswith("if ") or "||" in call, (
            f"print_config_restore returns 1 when nothing qualifies; a bare call aborts under set -e: {call}"
        )


def test_no_backticks_inside_a_double_quoted_echo() -> None:
    """A-6: backticks inside "…" run as a command (`providers:: command not found`, and the word
    vanishes from the message); `bash -n` cannot see it."""
    pattern = re.compile(r'echo +"[^"]*[^\\]`')
    files = sorted((REPO_ROOT / "deploy" / "linux").glob("*.sh")) + sorted((REPO_ROOT / "tools").glob("*.sh"))
    assert UPDATE_SH in files
    hits = [
        f"{f.relative_to(REPO_ROOT)}:{n}"
        for f in files
        for n, line in enumerate(f.read_text(encoding="utf-8").splitlines(), 1)
        if pattern.search(line)
    ]
    assert hits == []


def test_update_sh_parses() -> None:
    res = subprocess.run(["bash", "-n", str(UPDATE_SH)], capture_output=True, text=True, timeout=30)
    assert res.returncode == 0, res.stderr


# ── end to end: the REAL update.sh in a stubbed sandbox ──────────────────────────────────────────

PY = shlex.quote(sys.executable)
MIGRATE = (
    f'( cd {shlex.quote(str(BACKEND))} && CTRLB_HOME="$HOME/.ctrl-b" CTRLB_CONFIG="$HOME/.ctrl-b/config.yaml"'
    f" PYTHONDONTWRITEBYTECODE=1 {PY} -m app.config_migration --apply )"
)
#: The REAL migrator with ONE injected failure: the config write (the commit point) raises AFTER the agent
#: files were written — a full disk at the wrong moment (the adversary's run-r2; UPDATE_PLAN §3.4 step 5).
MIGRATE_FAILING_COMMIT = (
    f'( cd {shlex.quote(str(BACKEND))} && CTRLB_HOME="$HOME/.ctrl-b" CTRLB_CONFIG="$HOME/.ctrl-b/config.yaml"'
    f" PYTHONDONTWRITEBYTECODE=1 {PY} -c '"
    "import sys\n"
    "from app import config_migration as cm\n"
    "def boom(*_a, **_k):\n"
    '    raise OSError(28, "No space left on device", "config.yaml")\n'
    "cm._write_config = boom\n"
    'sys.exit(cm.main(["--apply"]))\' )'
)


def _migrator(
    *, fail_commit: bool = False, utc: str = "", fail_agent: str = "", crash_after_commit: bool = False
) -> str:
    """The REAL migrator, optionally with its config write failing AFTER the agent writes (a full disk at
    the wrong moment) and/or its clock fixed at `utc` (ISO, to force a same-second backup collision)."""
    lines = ["import sys", "from app import config_migration as cm"]
    if fail_commit:
        lines += [
            "def boom(*_a, **_k):",
            '    raise OSError(28, "No space left on device", "config.yaml")',
            "cm._write_config = boom",
        ]
    if fail_agent:
        lines += [
            "_orig_write_agent = cm._write_agent",
            "def _agent(ctx, path, doc):",
            f"    if path.parent.name == {fail_agent!r}:",
            '        raise OSError(28, "No space left on device", "agent.yaml")',
            "    return _orig_write_agent(ctx, path, doc)",
            "cm._write_agent = _agent",
        ]
    if crash_after_commit:
        lines += ["import os", "cm._close_run_record = lambda record: os._exit(1)"]
    if utc:
        lines += [
            "import datetime as dt",
            "class Fixed(dt.datetime):",
            "    @classmethod",
            "    def now(cls, tz=None):",
            f"        return dt.datetime.fromisoformat({utc!r})",
            "cm.datetime = Fixed",
        ]
    lines.append('sys.exit(cm.main(["--apply"]))')
    code = "\n".join(lines)
    return (
        f'( cd {shlex.quote(str(BACKEND))} && CTRLB_HOME="$HOME/.ctrl-b" CTRLB_CONFIG="$HOME/.ctrl-b/config.yaml"'
        f" PYTHONDONTWRITEBYTECODE=1 {PY} -c {shlex.quote(code)} )"
    )


#: A `git` FIRST on PATH that fails exactly the invocation named by FAKE_GIT_FAIL and forwards the rest:
#: the one way to make ONE object unreadable (a blob not local, a tree not listable) for one revision.
GIT_SHIM = """#!/usr/bin/env bash
if [ -n "${FAKE_GIT_FAIL:-}" ] && [[ " $* " == *"$FAKE_GIT_FAIL"* ]]; then exit 128; fi
exec REAL_GIT "$@"
"""

SYSTEMCTL_STUB = """#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$FAKE_LOG_DIR/systemctl.log"
case "$*" in
  *is-active*) echo "${FAKE_STATE:-failed}"; [ "${FAKE_STATE:-failed}" = active ] && exit 0; exit 3 ;;
  *MainPID*) echo "${FAKE_MAINPID:-0}" ;;
esac
exit 0
"""
CURL_STUB = """#!/usr/bin/env bash
[ -n "${FAKE_HEALTH:-}" ] || exit 7
printf '%s' "$FAKE_HEALTH"
"""
GH_STUB = """#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$FAKE_LOG_DIR/gh.log"
printf '%s' "$FAKE_GH_JSON"
"""


@dataclass
class Run:
    rc: int
    out: str
    gh_argv: list[str] = field(default_factory=list)

    def guard_lines(self) -> list[str]:
        return [line.strip() for line in self.out.splitlines() if line.strip().startswith("cmp -s ")]

    def cp_lines(self) -> list[str]:
        return [line.strip() for line in self.out.splitlines() if line.strip().startswith("cp -p ")]


@dataclass
class Sandbox:
    root: Path
    home: Path
    repo: Path
    ctrlb: Path
    stubs: Path
    origin: Path

    @property
    def path(self) -> str:
        return f"{self.stubs}:{BASE_PATH}"

    def env(self, **extra: str) -> dict[str, str]:
        return _clean_env(self.home, **extra)

    def git(self, *args: str) -> str:
        return _git(self.env(), *args, cwd=self.repo)

    def run(
        self,
        tag: str,
        *args: str,
        state: str = "failed",
        health: str = "",
        mainpid: str = "0",
        git_fail: str = "",
    ) -> Run:
        sha = _git(self.env(), "rev-list", "-n1", f"refs/tags/{tag}", cwd=self.origin)
        gh_json = json.dumps(
            [
                {
                    "headBranch": tag,
                    "headSha": sha,
                    "event": "push",
                    "conclusion": "success",
                    "status": "completed",
                }
            ]
        )
        logs = self.root / "logs"
        logs.mkdir(exist_ok=True)
        (logs / "gh.log").write_text("", encoding="utf-8")
        env = self.env(
            PATH=self.path,
            FAKE_LOG_DIR=str(logs),
            FAKE_GH_JSON=gh_json,
            FAKE_STATE=state,
            FAKE_HEALTH=health,
            FAKE_MAINPID=mainpid,
            FAKE_GIT_FAIL=git_fail,
        )
        res = subprocess.run(
            ["bash", str(UPDATE_SH), tag, *args],
            env=env,
            capture_output=True,
            text=True,
            timeout=120,
        )
        gh = [line for line in (logs / "gh.log").read_text(encoding="utf-8").splitlines() if line]
        return Run(res.returncode, res.stdout + res.stderr, gh)

    def backups(self) -> list[str]:
        d = self.ctrlb / "backups"
        return sorted(p.name for p in d.iterdir()) if d.is_dir() else []

    def run_stamps(self) -> list[str]:
        return [
            n.removeprefix("config.yaml.")
            for n in self.backups()
            if re.fullmatch(r"config\.yaml\.\d{8}T\d{6}Z(-\d+)?", n)
        ]

    def execute(self, lines: list[str]) -> None:
        """Run the printed lines EXACTLY as printed — the advice, not a paraphrase of it."""
        for line in lines:
            subprocess.run(["bash", "-c", line], env=self.env(), check=True, timeout=30)


def _write_exec(p: Path, text: str) -> None:
    p.write_text(text, encoding="utf-8")
    p.chmod(0o755)


def _sandbox(
    tmp_path: Path,
    *,
    old_version: int | None,
    new_version: int = 5,
    new_install: str = "exit 1",
    config: str = SHAPE4,
    agents: dict[str, str] | None = None,
) -> Sandbox:
    """prod at `vOLD` in `$HOME/apps/ctrl-b`, cloned from a bare origin holding vOLD and vNEW."""
    if (REPO_ROOT / ".env").exists():
        pytest.skip("the repo has a .env, which the migrator's pinning could follow out of the sandbox")
    for tool in ("git", "flock"):
        if shutil.which(tool, path=BASE_PATH) is None:
            pytest.skip(f"{tool} is not on {BASE_PATH}")
    root = tmp_path / "sb"
    home = root / "home"
    stubs = root / "stubs"
    stubs.mkdir(parents=True)
    home.mkdir()
    _write_exec(stubs / "systemctl", SYSTEMCTL_STUB)
    _write_exec(stubs / "curl", CURL_STUB)
    _write_exec(stubs / "gh", GH_STUB)
    real_git = shutil.which("git", path=BASE_PATH)
    assert real_git
    _write_exec(stubs / "git", GIT_SHIM.replace("REAL_GIT", shlex.quote(real_git)))
    sb = Sandbox(root, home, home / "apps" / "ctrl-b", home / ".ctrl-b", stubs, root / "origin.git")
    for tool in ("systemctl", "curl", "gh", "git"):  # the §17.4 R1 lesson: never reach the real unit or port
        assert shutil.which(tool, path=sb.path) == str(stubs / tool)
    env = sb.env()

    src = root / "src"
    _git(env, "init", "-q", "-b", "main", str(src))
    (src / ".gitignore").write_text("backend/.venv/\n", encoding="utf-8")
    vdir = src / "backend" / "app" / "config_migration"
    vdir.mkdir(parents=True)
    (src / "deploy" / "linux").mkdir(parents=True)
    if old_version is not None:
        (vdir / "VERSION").write_text(f"{old_version}\n", encoding="utf-8")
    _write_exec(
        src / "deploy" / "linux" / "install.sh",
        '#!/usr/bin/env bash\necho "[stub install.sh vOLD]"; touch "$HOME/ran-install-vOLD"; exit 0\n',
    )
    _git(env, "add", "-A", cwd=src)
    _git(env, "commit", "-qm", "old", cwd=src)
    _git(env, "tag", "-a", "vOLD", "-m", "vOLD", cwd=src)
    (vdir / "VERSION").write_text(f"{new_version}\n", encoding="utf-8")
    _write_exec(
        src / "deploy" / "linux" / "install.sh",
        '#!/usr/bin/env bash\necho "[stub install.sh vNEW]"; touch "$HOME/ran-install-vNEW"\n'
        + new_install
        + "\n",
    )
    _git(env, "add", "-A", cwd=src)
    _git(env, "commit", "-qm", "new", cwd=src)
    _git(env, "tag", "-a", "vNEW", "-m", "vNEW", cwd=src)
    _git(env, "clone", "-q", "--bare", str(src), str(sb.origin))

    _git(env, "clone", "-q", str(sb.origin), str(sb.repo))
    _git(env, "checkout", "-q", "vOLD", cwd=sb.repo)
    venv_bin = sb.repo / "backend" / ".venv" / "bin"
    venv_bin.mkdir(parents=True)
    (venv_bin / "python").symlink_to(sys.executable)  # the CI JSON filter and probe_health call it

    sb.ctrlb.mkdir()
    (sb.ctrlb / "config.yaml").write_text(config, encoding="utf-8")
    (sb.ctrlb / "config.yaml").chmod(0o600)
    for name, text in (agents or {}).items():
        (sb.ctrlb / "agents" / name).mkdir(parents=True)
        (sb.ctrlb / "agents" / name / "agent.yaml").write_text(text, encoding="utf-8")
        (sb.ctrlb / "agents" / name / "agent.yaml").chmod(0o600)
    return sb


def _assert_gate_per_tag(run: Run, tag: str) -> None:
    """E11 / N-1: the CI gate looks the run up PER TAG, so an old tag's run never falls out of the window."""
    assert run.gh_argv, run.out
    for argv in run.gh_argv:
        assert f"--branch {tag} " in argv + " ", argv


def _assert_restore_puts_back(sb: Sandbox, run: Run, pre: dict[Path, bytes]) -> None:
    lines = run.cp_lines()
    assert len(lines) == len(pre), run.out
    sb.execute(lines)
    for path, content in pre.items():
        assert path.read_bytes() == content, path
        assert stat.S_IMODE(path.stat().st_mode) == 0o600, path


def _pre(sb: Sandbox) -> dict[Path, bytes]:
    files = [sb.ctrlb / "config.yaml", *sorted((sb.ctrlb / "agents").glob("*/agent.yaml"))]
    return {f: f.read_bytes() for f in files}


def test_e1_a_failed_migrating_run_prints_the_whole_set_and_it_restores(tmp_path) -> None:
    sb = _sandbox(tmp_path, old_version=4, new_install=f"{MIGRATE}\nexit 1", agents={"maya": AGENT_LEGACY})
    pre = _pre(sb)
    run = sb.run("vNEW")
    assert run.rc == 1, run.out
    _assert_gate_per_tag(run, "vNEW")
    (stamp,) = sb.run_stamps()
    assert "-- updating prod: vOLD → vNEW" in run.out
    assert "⚠ config: shape 5 now (it was 4 when this run started); vOLD reads 4 or below." in run.out
    assert "vOLD's installer refuses this config at its preflight" in run.out
    assert "revert alone is enough" not in run.out
    assert f"backup set {stamp} — taken during this run, shape 4." in run.out
    assert "Config + 1 agent file(s)" in run.out
    assert f"cp -p {sb.ctrlb}/backups/maya--agent.yaml.{stamp} {sb.ctrlb}/agents/maya/agent.yaml" in run.out
    assert sb.git("describe", "--tags", "--exact-match") == "vNEW"  # no auto-revert
    _assert_restore_puts_back(sb, run, pre)


def test_e2_a_failed_run_that_migrated_nothing_says_the_revert_alone_is_enough(tmp_path) -> None:
    sb = _sandbox(tmp_path, old_version=4, new_install="exit 1", agents={"maya": AGENT_LEGACY})
    run = sb.run("vNEW")
    assert run.rc == 1
    assert "config: shape 4, which vOLD reads (4 or below) — the tag revert alone is enough:" in run.out
    assert f"cd {sb.repo} && git checkout vOLD && bash deploy/linux/install.sh prod" in run.out
    assert run.cp_lines() == []


def test_e3_a_pre_runner_from_gets_the_pre_runner_wording_and_its_shape0_backup(tmp_path) -> None:
    sb = _sandbox(tmp_path, old_version=None, new_install=f"{MIGRATE}\nexit 1", config=MINIMAL_NEW_SHAPE)
    pre = _pre(sb)
    run = sb.run("vNEW")
    assert run.rc == 1
    assert "migration:      stamp only (0 → 5)" in run.out  # A-7, from the real migrator inside the run
    assert "⚠ config: shape 5 now (it was 0 when this run started); vOLD reads 0 or below." in run.out
    assert "vOLD predates the shape check" in run.out
    (stamp,) = sb.run_stamps()
    assert f"backup set {stamp} — taken during this run, shape 0." in run.out
    assert "Config only" in run.out
    _assert_restore_puts_back(sb, run, pre)


def test_e4_a_stamp_only_run_from_a_build_that_reads_it_needs_no_restore(tmp_path) -> None:
    """A-2 and the adversary's N1: the stamp-only run takes a (config-only) backup, which must NOT make
    the report demand a restore — $from reads shape 5."""
    sb = _sandbox(tmp_path, old_version=5, new_install=f"{MIGRATE}\nexit 1", config=MINIMAL_NEW_SHAPE)
    run = sb.run("vNEW")
    assert run.rc == 1
    assert len(sb.run_stamps()) == 1  # the config-only backup this run took IS there
    assert "config: shape 5, which vOLD reads (5 or below) — the tag revert alone is enough:" in run.out
    assert run.cp_lines() == []
    assert "A tag revert ALONE fails" not in run.out


def test_e5_rolling_back_refuses_and_prints_the_right_set_past_decoys(tmp_path) -> None:
    sb = _sandbox(tmp_path, old_version=4, new_install=f"{MIGRATE}\nexit 1", agents={"maya": AGENT_LEGACY})
    pre = _pre(sb)
    assert sb.run("vNEW").rc == 1
    (stamp,) = sb.run_stamps()
    bk = sb.ctrlb / "backups"
    (bk / "config.yaml.20990101T000000Z").write_text("config_version: 9\n", encoding="utf-8")
    (bk / "config.yaml.20990101T000000Z.manual").write_text("config_version: 0\n", encoding="utf-8")
    (bk / "config.yaml.manual-prerelease-20990101T000000Z").write_text(
        "config_version: 0\n", encoding="utf-8"
    )
    run = sb.run("vOLD")
    assert run.rc == 78, run.out
    _assert_gate_per_tag(run, "vOLD")
    assert "✗ refusing: your config is at shape 5, but vOLD understands shape 4 or below." in run.out
    assert "then re-run this same command" in run.out
    assert f"backup set {stamp} — taken earlier" in run.out
    assert f"bash {sb.repo}/deploy/linux/update.sh vOLD" in run.out
    _assert_restore_puts_back(sb, run, pre)
    again = sb.run("vOLD")
    assert "-- updating prod: vNEW → vOLD" in again.out, again.out  # step 5 passes after the restore


def test_e6_success_hints_follow_the_same_predicate(tmp_path) -> None:
    health = json.dumps({"status": "ok", "version": "NEW", "pid": 1})
    migrated = _sandbox(
        tmp_path / "a", old_version=4, new_install=f"{MIGRATE}\nexit 0", agents={"maya": AGENT_LEGACY}
    )
    run = migrated.run("vNEW", state="active", health=health)
    assert run.rc == 0, run.out
    (stamp,) = migrated.run_stamps()
    assert "✓ prod updated: vOLD → vNEW" in run.out
    assert "NOT a one-liner — your config is now shape 5 (was 4)" in run.out
    assert f"the backup set it will name: {stamp}" in run.out
    plain = _sandbox(tmp_path / "b", old_version=4, new_install="exit 0")
    run = plain.run("vNEW", state="active", health=health)
    assert run.rc == 0, run.out
    assert f"roll back with:     bash {plain.repo}/deploy/linux/update.sh vOLD" in run.out


def test_e7_an_unreadable_marker_after_the_run_is_unknown_never_revert_alone(tmp_path) -> None:
    sb = _sandbox(
        tmp_path,
        old_version=4,
        new_install='printf "config_version: banana\\n" > "$HOME/.ctrl-b/config.yaml"\nexit 1',
    )
    run = sb.run("vNEW")
    assert run.rc == 1
    assert "its config_version line cannot be read" in run.out
    assert "so this report cannot tell whether vOLD" in run.out
    assert "revert alone is enough" not in run.out
    _assert_stops_after_the_cross(run, "vOLD")


def _assert_stops_after_the_cross(run: Run, rev: str) -> None:
    """The ✗ path of the restore printer: the caller prints the stop line, never a step that proceeds."""
    after = run.out.split("✗ no backup taken by the config migration", 1)[1]
    assert (
        "stop here: resolve the backup first (README §Rollback step 2) — do not check out "
        f"{rev} until the config it reads is in place"
    ) in after
    assert "git checkout" not in after
    assert "update.sh" not in after  # no "re-run this same command" step either
    assert run.cp_lines() == []


def test_e5b_a_rollback_refusal_with_no_backup_to_offer_stops(tmp_path) -> None:
    """The step-5 refusal reaches the ✗ path when no migration backup holds a readable-enough config."""
    sb = _sandbox(
        tmp_path, old_version=4, new_install="exit 0", config="config_version: 5\nserver:\n  port: 5433\n"
    )
    sb.git("checkout", "-q", "vNEW")
    run = sb.run("vOLD")
    assert run.rc == 78, run.out
    assert "✗ refusing: your config is at shape 5, but vOLD understands shape 4 or below." in run.out
    _assert_stops_after_the_cross(run, "vOLD")


def test_e8_a_retry_finds_where_it_came_from_in_the_reflog(tmp_path) -> None:
    sb = _sandbox(tmp_path, old_version=4, new_install=f"{MIGRATE}\nexit 1", agents={"maya": AGENT_LEGACY})
    pre = _pre(sb)
    assert sb.run("vNEW").rc == 1
    (stamp,) = sb.run_stamps()
    run = sb.run("vNEW")  # "fix the cause, re-run": the tree is already at vNEW
    assert run.rc == 1
    assert (
        "-- retrying vNEW (the tree is already at vNEW but the service is not serving it — a previous run of"
        in run.out
    )
    assert (
        "this update did not finish, or the service is down; you came from vOLD per the git reflog" in run.out
    )
    assert "tree: at vNEW (not moved by this run; the reflog's previous version: vOLD)" in run.out
    assert "⚠ config: shape 5 now (it was 5 when this run started); vOLD reads 4 or below." in run.out
    # the retry took no backup of its own; the first attempt's set is THIS UPDATE's
    assert f"backup set {stamp} — taken " in run.out and "shape 4." in run.out
    assert "git checkout vNEW && bash" not in run.out  # never the self-referential revert
    assert len(sb.run_stamps()) == 1
    _assert_restore_puts_back(sb, run, pre)


def test_e8b_a_tree_already_at_the_tag_and_serving_it_is_nothing_to_do(tmp_path) -> None:
    sb = _sandbox(tmp_path, old_version=4, new_install="exit 1")
    sb.git("checkout", "-q", "vNEW")  # a manual landing on the tag, serving (adversary case C)
    health = json.dumps({"status": "ok", "version": "NEW", "pid": 4242})
    run = sb.run("vNEW", state="active", health=health, mainpid="4242")
    assert run.rc == 0, run.out
    assert "✓ already at vNEW and serving it — nothing to update" in run.out
    assert "-- retrying" not in run.out and "-- updating" not in run.out and "════" not in run.out
    assert not (sb.home / "ran-install-vNEW").exists()


def test_e8b_a_stale_process_answering_for_the_tag_is_still_a_retry(tmp_path) -> None:
    """Adversary §9 N2: install.sh's identity gate fails when another pid holds the port; the same
    observation here must not turn that failed run into "nothing to update"."""
    sb = _sandbox(tmp_path, old_version=4, new_install="exit 1")
    sb.git("checkout", "-q", "vNEW")
    health = json.dumps({"status": "ok", "version": "NEW", "pid": 999})
    run = sb.run("vNEW", state="active", health=health, mainpid="4242")
    assert run.rc == 1, run.out
    assert "-- retrying vNEW" in run.out
    assert (sb.home / "ran-install-vNEW").exists()


def test_e8c_an_expired_reflog_makes_from_unknown_never_self_referential(tmp_path) -> None:
    sb = _sandbox(tmp_path, old_version=4, new_install=f"{MIGRATE}\nexit 1", agents={"maya": AGENT_LEGACY})
    assert sb.run("vNEW").rc == 1
    sb.git("reflog", "expire", "--expire=now", "--all")
    run = sb.run("vNEW")
    assert run.rc == 1
    assert "the version you came from is unknown (no reflog entry) — README §Rollback step 2" in run.out
    assert "tree: at vNEW (not moved by this run; the reflog's previous version: unknown)" in run.out
    assert "git checkout vNEW" not in run.out
    assert "revert alone" not in run.out


def test_e9_a_partial_apply_prints_the_whole_set_and_no_rerun_advice(tmp_path) -> None:
    """G2: the agent file is rewritten, the config commit fails, the shape did not move. The report must
    name the run's whole set — and must NOT say a re-run converges (false for step 5: ISS-114)."""
    sb = _sandbox(
        tmp_path,
        old_version=4,
        new_install=f"{MIGRATE_FAILING_COMMIT}\nexit 1",
        agents={"maya": AGENT_LEGACY},
    )
    pre = _pre(sb)
    run = sb.run("vNEW")
    assert run.rc == 1
    agent = sb.ctrlb / "agents" / "maya" / "agent.yaml"
    assert "persona:" in agent.read_text(encoding="utf-8")  # the premise: the agent write happened
    assert (sb.ctrlb / "config.yaml").read_bytes() == pre[sb.ctrlb / "config.yaml"]  # the commit did not
    (stamp,) = sb.run_stamps()
    assert f"⚠ a migration started at {stamp} rewrote 1 file(s) and never committed" in run.out
    assert "a re-run does NOT repair this" in run.out and "ISS-114" in run.out
    assert "converge" not in run.out
    assert "revert alone is enough" not in run.out
    assert f"cp -p {sb.ctrlb}/backups/config.yaml.{stamp} {sb.ctrlb}/config.yaml" in run.out
    assert f"cp -p {sb.ctrlb}/backups/maya--agent.yaml.{stamp} {sb.ctrlb}/agents/maya/agent.yaml" in run.out
    _assert_restore_puts_back(sb, run, pre)


def test_e10_when_the_runs_backup_is_gone_the_pick_is_labelled_as_taken_earlier(tmp_path) -> None:
    old = "20200101T000000Z"
    delete_runs_backup = f'for f in "$HOME"/.ctrl-b/backups/config.yaml.2*; do [ "$f" = "$HOME/.ctrl-b/backups/config.yaml.{old}" ] || rm -f "$f"; done'
    sb = _sandbox(
        tmp_path,
        old_version=4,
        new_install=f"{MIGRATE}\n{delete_runs_backup}\nexit 1",
        agents={"maya": AGENT_LEGACY},
    )
    bk = sb.ctrlb / "backups"
    bk.mkdir()
    (bk / f"config.yaml.{old}").write_bytes((sb.ctrlb / "config.yaml").read_bytes())
    (bk / f"maya--agent.yaml.{old}").write_text(AGENT_LEGACY, encoding="utf-8")
    run = sb.run("vNEW")
    assert run.rc == 1
    assert sb.run_stamps() == [old]
    assert f"backup set {old} — taken earlier — 2020-01-01 00:00 UTC, shape 4." in run.out
    assert "taken by this run" not in run.out


def test_e11_the_ci_gate_is_looked_up_per_tag(tmp_path) -> None:
    sb = _sandbox(tmp_path, old_version=4, new_install="exit 1")
    run = sb.run("vNEW")
    _assert_gate_per_tag(run, "vNEW")
    assert run.gh_argv[0].startswith("run list --branch vNEW --limit 30 --json ")


def test_e12_a_retry_after_a_partial_write_is_refused_until_the_set_is_back(tmp_path) -> None:
    """Attempt 1 rewrites the agent file and fails before the config commit; its record stays OPEN. The
    retry is refused at step 5 (78) with the record's exact set; once the set is back, the record is
    closed by the restore itself and the same command proceeds."""
    sb = _sandbox(
        tmp_path,
        old_version=4,
        new_install=f"{MIGRATE_FAILING_COMMIT}\nexit 1",
        agents={"maya": AGENT_LEGACY},
    )
    pre = _pre(sb)
    assert sb.run("vNEW").rc == 1
    (stamp,) = sb.run_stamps()
    run = sb.run("vNEW")
    assert run.rc == 78, run.out
    assert f"✗ refusing: a migration started at {stamp} rewrote 1 file(s) and never committed" in run.out
    assert "then re-run this same command" in run.out
    assert f"bash {sb.repo}/deploy/linux/update.sh vNEW" in run.out
    assert "revert alone" not in run.out
    _assert_restore_puts_back(sb, run, pre)  # the cp lines only, NOT the guarded close line
    again = sb.run("vNEW")
    assert "-- retrying vNEW" in again.out and "✗ refusing: a migration" not in again.out, again.out
    # the restored record is closed by name; the retry's own stub half-writes again (a NEW open record)
    assert (sb.ctrlb / "backups" / f"config.yaml.{stamp}.run.resolved").is_file()


# ── the adversary's surviving mutants and missing states (wave 3) ───────────────────────────────


def test_e13_from_with_an_unreadable_version_blob_is_unknown_not_shape0(tmp_path) -> None:
    """M9b: `$from`'s VERSION blob not local (rc 4) must never read as shape 0."""
    sb = _sandbox(tmp_path, old_version=4, new_install=f"{MIGRATE}\nexit 1", agents={"maya": AGENT_LEGACY})
    run = sb.run("vNEW", git_fail="show vOLD:backend/app/config_migration/VERSION")
    assert run.rc == 1, run.out
    assert "! vOLD's config_migration/VERSION is not local in this blob:none clone" in run.out
    assert "⚠ vOLD's config_migration/VERSION is not local" in run.out
    assert "the tag revert alone is enough" not in run.out and "git checkout vOLD" not in run.out


def test_e13b_from_with_an_unreadable_tree_is_unknown_not_shape0(tmp_path) -> None:
    """M9: `$from`'s tree unreadable (rc 2) must never read as shape 0."""
    sb = _sandbox(tmp_path, old_version=4, new_install=f"{MIGRATE}\nexit 1", agents={"maya": AGENT_LEGACY})
    run = sb.run("vNEW", git_fail="cat-file -e vOLD^{commit}")
    assert run.rc == 1, run.out
    assert "⚠ vOLD's tree cannot be read here" in run.out
    assert "the tag revert alone is enough" not in run.out and "git checkout vOLD" not in run.out


def test_e14_a_malformed_marker_refuses_at_step5(tmp_path) -> None:
    """M14: a malformed marker before the run is a refusal (78), never shape 0."""
    sb = _sandbox(tmp_path, old_version=4, new_install="exit 0", config="config_version: banana\n")
    run = sb.run("vNEW")
    assert run.rc == 78, run.out
    assert "has a malformed config_version line. Fix or remove it, then re-run." in run.out
    assert not (sb.home / "ran-install-vNEW").exists()


def test_e15_a_target_whose_version_blob_is_not_local_is_refused_not_pre_runner(tmp_path) -> None:
    """M15: the tag's rc 4 must name the fetch, never take the pre-runner (manual sequence) branch."""
    sb = _sandbox(tmp_path, old_version=4, new_install="exit 0")
    run = sb.run("vNEW", git_fail="show vNEW:backend/app/config_migration/VERSION")
    assert run.rc == 1, run.out
    assert "vNEW's config_migration/VERSION is not local in this blob:none clone" in run.out
    assert "fetch origin tag vNEW" in run.out
    assert "predates the safe installer" not in run.out
    assert not (sb.home / "ran-install-vNEW").exists()


def test_e16_the_reflog_skips_hops_from_the_tags_own_commit(tmp_path) -> None:
    """M16: hops whose X is the tag's commit under another name (a branch, a bare sha) are not `$from`."""
    sb = _sandbox(tmp_path, old_version=4, new_install="exit 1")
    assert sb.run("vNEW").rc == 1  # vOLD → vNEW, failed: the tree stays at vNEW
    sb.git("checkout", "-q", "main")  # main == vNEW's commit in the sandbox
    sb.git("checkout", "-q", "vNEW")
    run = sb.run("vNEW")
    assert "you came from vOLD per the git reflog" in run.out, run.out


def test_e17_a_service_serving_another_version_is_not_already_serving(tmp_path) -> None:
    """M18: active + pid == MainPID but the OLD version answering is a retry, never "nothing to update"."""
    sb = _sandbox(tmp_path, old_version=4, new_install="exit 1")
    sb.git("checkout", "-q", "vNEW")
    health = json.dumps({"status": "ok", "version": "OLD", "pid": 4242})
    run = sb.run("vNEW", state="active", health=health, mainpid="4242")
    assert run.rc == 1, run.out
    assert "-- retrying vNEW" in run.out and "nothing to update" not in run.out


def test_e18_after_a_re_apply_over_a_half_write_the_superseded_set_is_the_rollback(tmp_path) -> None:
    """Attempt 1 half-writes (record open); a by-hand re-apply commits over it (a config-only backup, the
    record superseded — ISS-114's state); a retry then fails before migrating. The forward path is not
    blocked, and the rollback set is attempt 1's (it holds the agent pre-image), restored byte-for-byte."""
    attempts = (
        '[ ! -e "$HOME/attempt-1" ] || { echo "[stub] fails before migrating"; exit 1; }\n'
        'touch "$HOME/attempt-1"\n' + _migrator(fail_commit=True) + "\nexit 1"
    )
    sb = _sandbox(tmp_path, old_version=4, new_install=attempts, agents={"maya": AGENT_LEGACY})
    pre = _pre(sb)
    assert sb.run("vNEW").rc == 1
    reapply = subprocess.run(
        ["bash", "-c", MIGRATE], env=sb.env(), capture_output=True, text=True, timeout=120
    )
    assert reapply.returncode == 0, reapply.stdout + reapply.stderr
    assert list((sb.ctrlb / "backups").glob("*.run.superseded"))
    run = sb.run("vNEW")
    assert run.rc == 1, run.out
    assert "[stub] fails before migrating" in run.out  # step 5 did not refuse: nothing is open any more
    assert (
        "a migration that rewrote agent files and never committed (a later run committed over it" in run.out
    )
    assert "revert alone" not in run.out
    _assert_restore_puts_back(sb, run, pre)


def test_e19_a_same_second_collision_partial_write_is_not_revert_alone(tmp_path) -> None:
    """Adversary G2: an earlier set of the SAME second exists, so this run's set is `config.yaml.<T>-2`;
    with the commit failing after the agent write, the report must name the `-2` set, never revert alone."""
    stamp = "20300101T000000Z"
    sb = _sandbox(
        tmp_path,
        old_version=4,
        new_install=_migrator(fail_commit=True, utc="2030-01-01T00:00:00+00:00") + "\nexit 1",
        agents={"maya": AGENT_LEGACY},
    )
    pre = _pre(sb)
    (sb.ctrlb / "backups").mkdir()
    (sb.ctrlb / "backups" / f"config.yaml.{stamp}").write_text("config_version: 3\n", encoding="utf-8")
    run = sb.run("vNEW")
    assert run.rc == 1, run.out
    assert "revert alone" not in run.out
    assert f"cp -p {sb.ctrlb}/backups/config.yaml.{stamp}-2 {sb.ctrlb}/config.yaml" in run.out
    assert f"cp -p {sb.ctrlb}/backups/maya--agent.yaml.{stamp} {sb.ctrlb}/agents/maya/agent.yaml" in run.out
    assert f"⚠ a migration started at {stamp} rewrote 1 file(s) and never committed" in run.out
    _assert_restore_puts_back(sb, run, pre)


def test_e20_the_chain_hedge_prints_on_a_normal_failure(tmp_path) -> None:
    """Review #10 / adversary gap 3: `$from` = the tree's tag may itself be a failed target."""
    sb = _sandbox(tmp_path, old_version=4, new_install="exit 1")
    run = sb.run("vNEW")
    assert "(if vOLD itself never finished deploying, go back further: README §Rollback step 2)" in run.out


def test_e21_rolling_back_after_a_partial_write_names_the_set(tmp_path) -> None:
    """`update.sh vOLD` after a half-applied run: the shape did not move, but the open record refuses."""
    sb = _sandbox(
        tmp_path,
        old_version=4,
        new_install=_migrator(fail_commit=True) + "\nexit 1",
        agents={"maya": AGENT_LEGACY},
    )
    pre = _pre(sb)
    assert sb.run("vNEW").rc == 1
    run = sb.run("vOLD")
    assert run.rc == 78, run.out
    assert "maya--agent.yaml." in run.out
    _assert_restore_puts_back(sb, run, pre)


def test_e22_a_manual_hop_away_and_back_does_not_hide_the_half_applied_set(tmp_path) -> None:
    """Adversary gap 2: after a half-applied run, `git checkout vOLD` then `update.sh vNEW`."""
    sb = _sandbox(
        tmp_path,
        old_version=4,
        new_install=_migrator(fail_commit=True) + "\nexit 1",
        agents={"maya": AGENT_LEGACY},
    )
    assert sb.run("vNEW").rc == 1
    sb.git("checkout", "-q", "vOLD")
    run = sb.run("vNEW")
    assert run.rc == 78, run.out
    assert "revert alone" not in run.out
    assert "rewrote 1 file(s) and never committed" in run.out


def test_e23_a_record_whose_backup_is_gone_blocks_with_the_stop_line(tmp_path) -> None:
    """A broken open record (a listed backup deleted) is never closed and never turned into a `cp`: step 5
    refuses, names why, and prints the stop line instead of the re-run."""
    sb = _sandbox(
        tmp_path,
        old_version=4,
        new_install=_migrator(fail_commit=True) + "\nexit 1",
        agents={"maya": AGENT_LEGACY},
    )
    assert sb.run("vNEW").rc == 1
    (agent_bak,) = (sb.ctrlb / "backups").glob("maya--agent.yaml.*")
    agent_bak.unlink()
    run = sb.run("vOLD")
    assert run.rc == 78, run.out
    assert "left a run record that cannot be used (backup " in run.out
    assert "listed by the record is missing" in run.out
    assert "stop here: resolve the backup first" in run.out
    assert run.cp_lines() == [] and "update.sh vOLD" not in run.out.split("✗ refusing", 1)[1]


# ── wave 5: closure by name, the oldest superseded set, a commit proven by shape ─────────────────


def _half_write(tmp_path: Path, **agents: str) -> Sandbox:
    """A sandbox whose first `update.sh vNEW` half-writes: agent files rewritten, the commit failed."""
    sb = _sandbox(
        tmp_path,
        old_version=4,
        new_install=_migrator(fail_commit=True) + "\nexit 1",
        agents=agents or {"maya": AGENT_LEGACY},
    )
    assert sb.run("vNEW").rc == 1
    return sb


def test_e24_a_restore_closed_by_its_guard_line_survives_a_later_edit(tmp_path) -> None:
    """(i) half-write → the printed restore executed WITH its last line → `git checkout vOLD` + a config
    edit → `update.sh vNEW` proceeds: the closure is a rename, not a byte comparison redone later."""
    sb = _half_write(tmp_path)
    run = sb.run("vNEW")
    assert run.rc == 78 and len(run.guard_lines()) == 1, run.out
    sb.execute(run.cp_lines() + run.guard_lines())
    assert list((sb.ctrlb / "backups").glob("*.run.resolved"))
    sb.git("checkout", "-q", "vOLD")
    cfg = sb.ctrlb / "config.yaml"
    cfg.write_text(cfg.read_text(encoding="utf-8") + "# an operator edit\n", encoding="utf-8")
    again = sb.run("vNEW")
    assert "✗ refusing: a migration" not in again.out and "-- updating prod: vOLD → vNEW" in again.out, (
        again.out
    )


def test_e25_a_restore_without_the_guard_line_is_resolved_by_the_next_run(tmp_path) -> None:
    """(ii) half-write → the cp lines only → the next `update.sh` sees every file back, renames the record
    `.run.resolved` itself and proceeds in the same run."""
    sb = _half_write(tmp_path)
    run = sb.run("vNEW")
    sb.execute(run.cp_lines())
    again = sb.run("vNEW")
    assert "✗ refusing: a migration" not in again.out and "-- retrying vNEW" in again.out, again.out
    assert list((sb.ctrlb / "backups").glob("*.run.resolved"))


def test_e26_a_manually_resolved_record_is_never_offered_again(tmp_path) -> None:
    """(iii) half-write → an agent edit → the manual `mv` (fix forward) → a successful re-update →
    `update.sh vOLD` never prints that record's set (Opus F2)."""
    # distinct fixed clocks: the same-second name-grouping merge is a separate, documented residual
    attempts = (
        '[ ! -e "$HOME/attempt-1" ] || { ' + _migrator(utc="2030-01-01T00:00:05+00:00") + "; exit $?; }\n"
        'touch "$HOME/attempt-1"\n'
        + _migrator(fail_commit=True, utc="2030-01-01T00:00:00+00:00")
        + "\nexit 1"
    )
    sb = _sandbox(tmp_path, old_version=4, new_install=attempts, agents={"maya": AGENT_LEGACY})
    assert sb.run("vNEW").rc == 1
    (rec,) = (sb.ctrlb / "backups").glob("*.run")
    stamp = rec.name.removeprefix("config.yaml.").removesuffix(".run")
    (sb.ctrlb / "agents" / "maya" / "agent.yaml").write_text("persona: ari\nnote: kept\n", encoding="utf-8")
    subprocess.run(["mv", "--", str(rec), f"{rec}.resolved"], check=True)
    health = json.dumps({"status": "ok", "version": "NEW", "pid": 1})
    ok = sb.run("vNEW", state="active", health=health)
    assert ok.rc == 0, ok.out
    back = sb.run("vOLD")
    assert back.rc == 78, back.out
    assert f"maya--agent.yaml.{stamp}" not in back.out and f"backup set {stamp} " not in back.out


def test_e27_with_two_agents_the_oldest_superseded_set_restores_both_originals(tmp_path) -> None:
    """Item 2 / the adversary's `supers2`: apply 1 rewrites maya and fails on zed; apply 2 rewrites zed and
    fails at the commit; apply 3 commits. Only the FIRST record holds both originals."""
    sb = _sandbox(
        tmp_path, old_version=4, new_install="exit 1", agents={"maya": AGENT_LEGACY, "zed": AGENT_LEGACY}
    )
    pre = _pre(sb)
    sb.git("checkout", "-q", "vNEW")
    for cmd in (_migrator(fail_agent="zed"), _migrator(fail_commit=True), MIGRATE):
        subprocess.run(["bash", "-c", cmd], env=sb.env(), capture_output=True, timeout=120)
    assert len(list((sb.ctrlb / "backups").glob("*.run.superseded"))) == 2
    run = sb.run("vOLD")
    assert run.rc == 78, run.out
    assert (
        "by a migration that rewrote agent files and never committed (a later run committed over it"
        in run.out
    )
    _assert_restore_puts_back(sb, run, pre)


def test_e28_a_crash_between_the_commit_and_the_rename_reads_as_committed(tmp_path) -> None:
    """Item 3: the migrator dies after the config's `os.replace` and before the rename — the record stays
    `.run` while the config is at the new shape. The next `update.sh` renames it `.run.committed` and
    proceeds; nothing is refused."""
    sb = _sandbox(tmp_path, old_version=4, new_install="exit 1", agents={"maya": AGENT_LEGACY})
    sb.git("checkout", "-q", "vNEW")  # the crashed run left the tree at the tag
    crash = subprocess.run(
        ["bash", "-c", _migrator(crash_after_commit=True)], env=sb.env(), capture_output=True, timeout=120
    )
    assert crash.returncode == 1
    assert list((sb.ctrlb / "backups").glob("*.run"))  # the premise: committed, but still named open
    again = sb.run("vNEW")
    assert "✗ refusing: a migration" not in again.out and "-- retrying vNEW" in again.out, again.out
    assert list((sb.ctrlb / "backups").glob("*.run.committed")) and not list(
        (sb.ctrlb / "backups").glob("*.run")
    )


@pytest.mark.parametrize(
    "folder",
    ["My Agent", "ma\tya", "ma\x1fya", "ma\x7fya", "ma..ya"],
    ids=["space", "tab", "C0-US", "DEL", "dotdot"],
)
def test_the_migrator_refuses_an_unrecordable_agent_folder_in_check_and_apply(
    tmp_path, monkeypatch, capsys, folder: str
) -> None:
    """The reader's class (bash `[[:space:][:cntrl:]]` under `LC_ALL=C`: U+0000–U+0020, U+007F) and `..`,
    refused by the SHARED preflight: `--check` exits 78 with the remedy exactly like `--apply`, before
    anything is written (wave 6 — a refusal only `--apply` saw would fire at the cutover)."""
    home = _home(tmp_path, monkeypatch, SHAPE4, **{folder: AGENT_LEGACY})
    assert cm.main(["--check"]) == cm.EXIT_REFUSE
    check_err = capsys.readouterr().err
    assert "which a run record cannot carry" in check_err and "rename the agent folder" in check_err
    assert cm.main(["--apply"]) == cm.EXIT_REFUSE
    assert capsys.readouterr().err == check_err  # refused identically
    assert not (home / "backups").exists() or not list((home / "backups").iterdir())


@pytest.mark.parametrize(
    "folder",
    ["ma\u00a0ya", "ma\u3000ya", "ma\x85ya"],
    ids=["NBSP", "ideographic-space", "C1-NEL"],
)
def test_a_folder_name_bash_reads_is_recorded_and_readable(tmp_path, monkeypatch, folder: str) -> None:
    """Names OUTSIDE the pinned class \u2014 NBSP (Python's `\\s` would over-refuse it), an ideographic space
    and a C1 control (a UTF-8 locale's bash class would refuse both; `record_pairs` pins `LC_ALL=C`):
    the migrator records them, and the reader reads that record in the caller's own locale."""
    home = _home(tmp_path, monkeypatch, SHAPE4, **{folder: AGENT_LEGACY})
    _boom_config_write(monkeypatch)
    with pytest.raises(OSError):
        cm.apply(cm.context_from_env())
    (rec,) = (home / "backups").glob("*.run")
    res = _bash(tmp_path, 'record_pairs "$1" "$2"\n', str(home), str(rec))
    assert res.returncode == 0, res.stdout
    assert f"{home}/agents/{folder}/agent.yaml" in res.stdout


def test_the_record_paths_are_lexical_under_a_symlinked_agents_dir(tmp_path, monkeypatch) -> None:
    """A symlinked `agents/` (its target outside the home) still records `agents/<x>/agent.yaml` — a
    `resolve()` in `_rel_home` would write the target's absolute path, which the reader refuses."""
    home = _home(tmp_path, monkeypatch, SHAPE4, maya=AGENT_LEGACY)
    outside = tmp_path / "agents-elsewhere"
    (home / "agents").rename(outside)
    (home / "agents").symlink_to(outside)
    _boom_config_write(monkeypatch)
    with pytest.raises(OSError):
        cm.apply(cm.context_from_env())
    (rec,) = (home / "backups").glob("*.run")
    assert rec.read_text(encoding="utf-8").splitlines()[2].endswith("\tagents/maya/agent.yaml")


def test_the_record_paths_are_lexical_under_a_symlinked_home(tmp_path, monkeypatch) -> None:
    real = tmp_path / "real-home"
    _home(tmp_path, monkeypatch, SHAPE4, maya=AGENT_LEGACY)
    (tmp_path / "home").rename(real)
    link = tmp_path / "home-link"
    link.symlink_to(real)
    monkeypatch.setenv("CTRLB_HOME", str(link))
    _boom_config_write(monkeypatch)
    with pytest.raises(OSError):
        cm.apply(cm.context_from_env())
    (rec,) = (real / "backups").glob("*.run")
    stamp = rec.name.removeprefix("config.yaml.").removesuffix(".run")
    assert rec.read_text(encoding="utf-8").splitlines()[1:] == [
        f"backups/config.yaml.{stamp}\tconfig.yaml",
        f"backups/maya--agent.yaml.{stamp}\tagents/maya/agent.yaml",
    ]
    res = _bash(tmp_path, 'open_run "$1"\n', str(link))  # the reader, through the operator's own path
    assert res.stdout.endswith("\topen"), res.stdout


def test_a_failure_after_one_agent_write_keeps_the_record(tmp_path, monkeypatch) -> None:
    """Item 4: the except path keeps the record once ANY listed file differs (maya written, zed failed)."""
    home = _home(tmp_path, monkeypatch, SHAPE4, maya=AGENT_LEGACY, zed=AGENT_LEGACY)
    orig = cm._write_agent

    def agent(ctx, path, doc):
        if path.parent.name == "zed":
            raise OSError(28, "No space left on device", "agent.yaml")
        return orig(ctx, path, doc)

    monkeypatch.setattr(cm, "_write_agent", agent)
    with pytest.raises(OSError):
        cm.apply(cm.context_from_env())
    assert len(list((home / "backups").glob("*.run"))) == 1


def test_e29_a_superseded_set_put_back_is_never_offered_again(tmp_path) -> None:
    """Wave 6 (Opus confirm round 3, N1): a half-write (R1) → a by-hand re-apply commits (R1 superseded) →
    `update.sh vOLD` offers R1's set; it is put back (the cp lines only) → the re-run proceeds (and closes
    R1) → an agent edit on vOLD → `update.sh vNEW` succeeds → `update.sh vOLD` must offer the NEW set,
    never R1's again (running R1's would lose the edit)."""
    attempts = (
        '[ ! -e "$HOME/attempt-1" ] || { ' + _migrator(utc="2030-01-01T00:00:10+00:00") + "; exit $?; }\n"
        'touch "$HOME/attempt-1"\n'
        + _migrator(fail_commit=True, utc="2030-01-01T00:00:00+00:00")
        + "\nexit 1"
    )
    sb = _sandbox(tmp_path, old_version=4, new_install=attempts, agents={"maya": AGENT_LEGACY})
    r1 = "20300101T000000Z"
    assert sb.run("vNEW").rc == 1  # 1. the half-write: R1 open
    reapply = subprocess.run(  # 2. a by-hand re-apply commits over it: R1 superseded
        ["bash", "-c", _migrator(utc="2030-01-01T00:00:05+00:00")],
        env=sb.env(),
        capture_output=True,
        timeout=120,
    )
    assert reapply.returncode == 0
    assert (sb.ctrlb / "backups" / f"config.yaml.{r1}.run.superseded").is_file()
    back = sb.run("vOLD")  # 3. offered R1's set (with its guarded close line, ending .run.resolved)
    assert back.rc == 78 and f"backup set {r1} " in back.out, back.out
    assert back.guard_lines() and back.guard_lines()[0].endswith(f"config.yaml.{r1}.run.resolved")
    sb.execute(back.cp_lines())  # put back WITHOUT the guarded line
    proceed = sb.run("vOLD")  # 4. the re-run proceeds — and closes R1 by name
    assert "-- updating prod: vNEW → vOLD" in proceed.out, proceed.out
    assert (sb.ctrlb / "backups" / f"config.yaml.{r1}.run.resolved").is_file()
    agent = sb.ctrlb / "agents" / "maya" / "agent.yaml"  # 5. an agent edit on vOLD
    agent.write_text(agent.read_text(encoding="utf-8") + "note: kept\n", encoding="utf-8")
    health = json.dumps({"status": "ok", "version": "NEW", "pid": 1})
    assert sb.run("vNEW", state="active", health=health).rc == 0  # 6. a successful update
    again = sb.run("vOLD")
    assert again.rc == 78, again.out
    assert f"backup set {r1} " not in again.out and f"maya--agent.yaml.{r1}" not in again.out
    (cp_agent,) = [line for line in again.cp_lines() if "maya--agent.yaml." in line]
    bak = Path(shlex.split(cp_agent)[2])
    assert "note: kept" in bak.read_text(encoding="utf-8")  # the offered set holds the edit
