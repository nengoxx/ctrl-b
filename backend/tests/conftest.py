"""Suite-wide test-isolation backstop (QH-10, QH_AUDIT.md §R).

**pytest-only** — conftest is discovered by pytest, never imported by the app; production path
resolution (`config.home_path()`) is untouched. Scope: every test gets `CTRLB_HOME` pointed at a
per-test temp dir, and any inherited `CTRLB_CONFIG`/`CTRLB_DB` from the invoking shell is cleared.

Why: without this, a test that boots the app and forgets its own env isolation resolves
`home_path()` to the **repo root** (config.py fallback) — proven 2026-07-07 to git-init a root
`memories/` and to read whatever real `config.yaml`/`skills/`/`agents/` sit there. The existing
per-file `_client()` helpers still win (they set the env vars inside the test, after this runs);
`monkeypatch` restores everything after each test.

A test that genuinely needs the repo-root fallback behavior (none exists today) must
`monkeypatch.delenv("CTRLB_HOME")` itself — deliberately loud, not accidental.

**The module-level guard below runs BEFORE the fixture, and before any test module is imported**
(UPDATE_PLAN §3.7). It exists because the import-time config check in `main.py` (slice 4) executes
while a test module is being *imported* — that is before any fixture, autouse or not, has run, so the
fixture above cannot protect it. `setdefault` would be insufficient: the danger is precisely an
*inherited* `CTRLB_CONFIG`/`CTRLB_DB`/`CTRLB_ENV` from the invoking shell (the dev systemd unit
exports some of these), so the values are overwritten outright. `CTRLB_ENV` is pointed at a
nonexistent path inside the suite temp rather than deleted — deleting it would let `_env_file()` fall
back to the repo-root `.env`, i.e. the operator's real secrets.
"""

from __future__ import annotations

import atexit
import os
import shutil
import tempfile

import pytest

#: Suite-private workspace root, created once per pytest process. Not `tmp_path` — that is a fixture,
#: and this must exist before the first test module is imported. Removed at exit rather than left to
#: the OS: on emma `/tmp` is a RAM-backed tmpfs on a 30G box, so per-run litter is memory, not disk.
_SUITE_HOME = tempfile.mkdtemp(prefix="ctrlb-suite-")
atexit.register(shutil.rmtree, _SUITE_HOME, True)
os.environ["CTRLB_HOME"] = _SUITE_HOME
os.environ["CTRLB_ENV"] = os.path.join(_SUITE_HOME, ".env-absent")
os.environ.pop("CTRLB_CONFIG", None)
os.environ.pop("CTRLB_DB", None)


@pytest.fixture(autouse=True)
def _isolated_ctrlb_home(tmp_path, monkeypatch):
    monkeypatch.setenv("CTRLB_HOME", str(tmp_path / "ctrlb-home"))
    # Never inherit real config/db paths from the invoking shell either (e.g. a box where the
    # service env or .bashrc exports them) — tests that need one set their own explicitly.
    monkeypatch.delenv("CTRLB_CONFIG", raising=False)
    monkeypatch.delenv("CTRLB_DB", raising=False)
