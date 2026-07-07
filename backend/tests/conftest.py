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
"""

from __future__ import annotations

import pytest


@pytest.fixture(autouse=True)
def _isolated_ctrlb_home(tmp_path, monkeypatch):
    monkeypatch.setenv("CTRLB_HOME", str(tmp_path / "ctrlb-home"))
    # Never inherit real config/db paths from the invoking shell either (e.g. a box where the
    # service env or .bashrc exports them) — tests that need one set their own explicitly.
    monkeypatch.delenv("CTRLB_CONFIG", raising=False)
    monkeypatch.delenv("CTRLB_DB", raising=False)
