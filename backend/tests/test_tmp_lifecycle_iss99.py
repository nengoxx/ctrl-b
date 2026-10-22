"""ISS-99 — the suite's temp-directory lifecycle (conftest's `route_temp`, both halves).

Before the fix ~98 helpers called an unqualified `tempfile.mkdtemp()` and nothing ever removed the
result: 875 roots per run, 140k roots / 46 GiB / 8.3 M inodes in emma's temp root (ISSUES.md ISS-99).
Now every unqualified allocation made during a test lands in `tmp_path/"tmp"` (pytest owns it), and
every allocation made outside a test lands in conftest's `_SUITE_HOME/tmp` (removed at exit), while
pytest's own basetemp stays in the real temp root so a failed test's evidence survives.

The second and third tests drive the REAL conftest in whole child pytest sessions under a private
temp root: plain `subprocess`, never `pytester` (it re-points `PYTEST_DEBUG_TEMPROOT` itself) and never
`--basetemp` (pytest wipes a given basetemp before each run, which would hide accumulation). The child
inherits no `PYTEST_*` key — the outer conftest's `PYTEST_DEBUG_TEMPROOT` would send its basetemp to the
outer temp root and turn the pin under test into a no-op, and `PYTEST_ADDOPTS` would change its run —
except `PYTEST_DISABLE_PLUGIN_AUTOLOAD`, re-added when the parent has it, so a developer running with
plugin autoload disabled gets the same plugin set in the child.
"""

from __future__ import annotations

import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path

import conftest

BACKEND = Path(__file__).resolve().parents[1]

_CHILD = "import os, tempfile; print(tempfile.mkdtemp()); print(os.environ.get('TEMP', ''))"


def test_an_allocation_during_a_test_lands_under_its_tmp_path(tmp_path: Path) -> None:
    managed = tmp_path / "tmp"
    assert tempfile.gettempdir() == str(managed)
    assert all(os.environ[k] == str(managed) for k in conftest.TEMP_ENV_KEYS)
    assert Path(tempfile.mkdtemp()).parent == managed
    fd, name = tempfile.mkstemp()
    os.close(fd)
    assert Path(name).parent == managed
    with tempfile.NamedTemporaryFile(delete=False) as f:
        assert Path(f.name).parent == managed
    with tempfile.TemporaryDirectory() as d:
        assert Path(d).parent == managed
    # A child interpreter started the ordinary way (inherited env) allocates there too.
    out = subprocess.run(
        [sys.executable, "-c", _CHILD], capture_output=True, text=True, check=True, timeout=60
    )
    child_dir, child_temp = out.stdout.splitlines()
    assert Path(child_dir).parent == managed
    assert child_temp == str(managed)
    # pytest's basetemp is in the REAL temp root, not under `_SUITE_HOME` (whose atexit would delete it).
    assert not tmp_path.is_relative_to(conftest._SUITE_HOME)


_PROBE = """
import subprocess, sys, tempfile
from tempfile import mkdtemp as mk   # an aliased allocator
from pathlib import Path

import pytest

def _home():                          # the house style: a helper that allocates
    return Path(tempfile.mkdtemp())

HOME = _home()                        # import time
ALIASED = mk()

@pytest.fixture(scope="session")
def session_home():
    return _home()

@pytest.fixture(scope="module")
def module_home():
    return _home()

def test_allocates_and_passes(tmp_path, session_home, module_home):
    assert Path(tempfile.mkdtemp()).parent == tmp_path / "tmp"
    out = subprocess.run([sys.executable, "-c", "import tempfile; print(tempfile.mkdtemp())"],
                         capture_output=True, text=True, check=True).stdout
    assert Path(out.strip()).parent == tmp_path / "tmp"

def test_allocates_and_fails():
    (_home() / "evidence").write_text("kept")
    raise AssertionError("deliberate: a failing test leaks nothing either, and keeps its evidence")
"""


def _probe_sessions(tmp_path: Path) -> tuple[list[str], dict[str, str], Path]:
    """The child pytest command, its env and its private temp root: the REAL conftest (as a plugin) and
    the REAL pytest config (`-c pyproject.toml`) run `_PROBE` with every temp key pointed at `root`."""
    probe = tmp_path / "probe"
    probe.mkdir()
    (probe / "test_probe.py").write_text(_PROBE, encoding="utf-8")
    root = tmp_path / "root"
    root.mkdir()
    # No `PYTEST_*` key is inherited (PYTEST_DEBUG_TEMPROOT, PYTEST_ADDOPTS, …) except the plugin-autoload
    # switch (the module docstring says why both); no cache, no bytecode: the child writes nothing into
    # the tree or the developer's --lf state.
    env = {k: v for k, v in os.environ.items() if not k.startswith("PYTEST_")}
    if "PYTEST_DISABLE_PLUGIN_AUTOLOAD" in os.environ:
        env["PYTEST_DISABLE_PLUGIN_AUTOLOAD"] = os.environ["PYTEST_DISABLE_PLUGIN_AUTOLOAD"]
    env |= {k: str(root) for k in conftest.TEMP_ENV_KEYS} | {"PYTHONDONTWRITEBYTECODE": "1"}
    argv = [
        sys.executable,
        "-m",
        "pytest",
        "-q",
        "-c",
        str(BACKEND / "pyproject.toml"),
        "--rootdir",
        str(probe),
        # pytest collects an argument through each of its ancestors that is not also an ancestor of the
        # confcutdir (default: the config's directory, here `backend/`), listing every entry of each: a
        # crowded temp root costs seconds per session (9 s each beside emma's 141k leaked roots, measured
        # 2026-10-22). Cut it at `probe`; this also keeps a stray `conftest.py` above it out of the child.
        "--confcutdir",
        str(probe),
    ]
    argv += ["-p", "no:cacheprovider", "-p", "tests.conftest", str(probe / "test_probe.py")]
    return argv, env, root


def _run(argv: list[str], env: dict[str, str], *, green: bool) -> None:
    """One child session: `-k passes` runs only the passing test, otherwise both run and one fails."""
    run = subprocess.run(
        [*argv, *(["-k", "passes"] if green else [])],
        cwd=BACKEND,
        env=env,
        capture_output=True,
        text=True,
        timeout=180,
    )
    assert run.returncode == (0 if green else 1), run.stdout + run.stderr


def _kept_sessions(temproot: Path) -> list[Path]:
    """The numbered session dirs pytest kept under `temproot`, which must hold nothing else."""
    (only,) = temproot.iterdir()
    assert only.name.startswith("pytest-of-")
    return [p for p in only.iterdir() if re.fullmatch(r"pytest-\d+", p.name)]


def _assert_evidence_kept(session: Path) -> None:
    """The failing test's allocation survives as evidence; nothing of the passing test does."""
    (evidence,) = session.glob("test_allocates_and_fails0/tmp/*/evidence")
    assert evidence.read_text() == "kept"
    assert not list(session.glob("test_allocates_and_passes*"))


def test_sessions_leave_nothing_but_pytests_basetemp(tmp_path: Path) -> None:
    """The ISS-99 acceptance, end to end: whole pytest sessions allocating at import, in session/module
    fixtures, in a passing test, its child and a failing test, leave nothing in the temp root but
    `pytest-of-<user>`; a green session's basetemp is gone and a failing one keeps the failed test's
    allocation."""
    argv, env, root = _probe_sessions(tmp_path)
    failed = 0
    for green in (False, True, False):  # a green session's basetemp is removed, a failing one's kept
        _run(argv, env, green=green)
        failed += not green
        kept = _kept_sessions(root)
        assert len(kept) == failed
        for session in kept:
            _assert_evidence_kept(session)


def test_a_developers_temproot_wins_and_an_empty_one_is_pinned(tmp_path: Path) -> None:
    """conftest pins pytest's basetemp only when `PYTEST_DEBUG_TEMPROOT` is unset or EMPTY: a developer's
    own value wins (the session lands there, the temp root stays empty), and an exported-but-empty one —
    which pytest reads as unset — is pinned like an unset one (the evidence is kept in the temp root,
    not deleted with the suite home at exit)."""
    argv, env, root = _probe_sessions(tmp_path)
    own = tmp_path / "own"
    own.mkdir()
    _run(argv, env | {"PYTEST_DEBUG_TEMPROOT": str(own)}, green=False)
    assert not list(root.iterdir())
    (session,) = _kept_sessions(own)
    _assert_evidence_kept(session)

    # On Windows an empty environment variable is deleted, so this half degenerates into the unset
    # case there (still a pass; the empty-string hole is a POSIX-only shape).
    _run(argv, env | {"PYTEST_DEBUG_TEMPROOT": ""}, green=False)
    (session,) = _kept_sessions(root)
    _assert_evidence_kept(session)
