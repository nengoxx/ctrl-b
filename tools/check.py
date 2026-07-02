#!/usr/bin/env python3
"""ctrl-b quality gate — one command that answers "is the repo green?".

The single runner behind the code-quality harness (docs/QUALITY.md, DECISIONS D33).
It is a thin **chokepoint**: it owns the OS-specific bits (venv-python + npm
resolution) in *one* place, and runs a **data-driven list** of checks — so adding a
check is appending one `Check(...)` entry, never editing a parallel shell script.

Usage (from anywhere — cwd-independent):
    python tools/check.py             # full gate: frontend + backend
    python tools/check.py --backend   # backend checks only
    python tools/check.py --frontend  # frontend checks only
    python tools/check.py --fast      # only the fast checks (skip slow tests)
    python tools/check.py --e2e       # full gate + the Playwright e2e/a11y suite (PRE-DEPLOY gate)

Exit codes: 0 = all green · 1 = a check failed · 2 = environment/setup problem
(missing venv, deps not installed) — reported with an actionable hint.

Design (docs/QUALITY.md): all selected checks run **in parallel**; each check's
output is captured and printed **grouped** (never interleaved); **every** check runs
even if one fails (run-all-and-summarise), so a single invocation surfaces *all* the
problems. The frontend half is delegated to `npm run check-all` (single source of
truth in package.json); the backend half runs the venv's tools directly.

The backend half runs ruff (lint+format), pyright (1c), and pytest; the frontend half is
`npm run check-all` (tsc + eslint + prettier + vitest, wired in 1b). `--fast` is the
pre-commit subset (the instant checks: ruff + FE prettier); the full gate runs on pre-push
(1d — `.githooks/` via `core.hooksPath`).
"""

from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
BACKEND = REPO_ROOT / "backend"
FRONTEND = REPO_ROOT / "frontend"


def venv_python() -> Path:
    """Backend venv interpreter — the ONE OS-specific branch (ARCHITECTURE §6 spirit)."""
    sub = "Scripts" if os.name == "nt" else "bin"
    exe = "python.exe" if os.name == "nt" else "python"
    return BACKEND / ".venv" / sub / exe


def npm_argv(args: list[str]) -> list[str]:
    """npm invocation, cross-platform.

    On Windows `npm` is a `.cmd` shim that CreateProcess cannot launch directly, so
    route it through `cmd /c`; POSIX runs the resolved binary directly.
    """
    npm = shutil.which("npm") or "npm"
    return ["cmd", "/c", npm, *args] if os.name == "nt" else [npm, *args]


@dataclass
class Check:
    name: str            # display label
    argv: list[str]      # command in argv form (no shell)
    cwd: Path            # working directory
    fast: bool = False   # part of the --fast subset (excludes slow tests)
    # filled in at runtime:
    code: int = field(default=0, init=False)
    output: str = field(default="", init=False)
    seconds: float = field(default=0.0, init=False)


def preflight() -> list[str]:
    """Verify the environment up front; return a list of blocking problems (with fixes)."""
    problems: list[str] = []
    if not venv_python().exists():
        problems.append(
            f"backend venv missing at {venv_python()}\n"
            f"      fix: cd backend && py -3 -m venv .venv && "
            f".venv/Scripts/python.exe -m pip install -e ."
        )
    if shutil.which("npm") is None:
        problems.append("npm not on PATH\n      fix: install Node.js (https://nodejs.org)")
    if not (FRONTEND / "node_modules").exists():
        problems.append("frontend deps not installed\n      fix: cd frontend && npm install")
    return problems


def build_checks() -> list[Check]:
    py = str(venv_python())
    return [
        # --- backend: the venv's tools, run from backend/ (ruff config lives there) ---
        Check("ruff  (lint)", [py, "-m", "ruff", "check", "."], BACKEND, fast=True),
        Check("ruff  (format)", [py, "-m", "ruff", "format", "--check", "."], BACKEND, fast=True),
        Check("pyright", [py, "-m", "pyright"], BACKEND, fast=False),
        Check("pytest", [py, "-m", "pytest", "-q"], BACKEND, fast=False),
        # --- frontend: delegated to the single npm entry point (package.json) ---
        Check("frontend check-all", npm_argv(["run", "check-all"]), FRONTEND, fast=False),
        # The instant FE half of the --fast (pre-commit) gate: prettier only (eslint is ~10s → too slow
        # for a commit hook, so it stays on pre-push via check-all). This re-runs prettier inside a FULL
        # gate (also in check-all) — an intentional ~2s overlap, kept for a simpler runner (no FE split).
        Check("prettier (fe)", npm_argv(["run", "format:check"]), FRONTEND, fast=True),
    ]


def run_check(c: Check) -> Check:
    start = time.perf_counter()
    try:
        proc = subprocess.run(
            c.argv,
            cwd=c.cwd,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",  # tool output may contain non-cp1252 bytes on Windows
        )
        c.code = proc.returncode
        c.output = (proc.stdout or "") + (proc.stderr or "")
    except FileNotFoundError as exc:
        c.code = 127
        c.output = f"command not found: {c.argv[0]} ({exc})"
    c.seconds = time.perf_counter() - start
    return c


def main() -> int:
    # Tool output (ruff, tsc, ...) can contain non-cp1252 chars (e.g. U+2192 "->");
    # force UTF-8 so printing never crashes on a legacy Windows console.
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError):
            pass

    ap = argparse.ArgumentParser(description="ctrl-b quality gate (docs/QUALITY.md)")
    ap.add_argument("--fast", action="store_true", help="only fast checks (skip slow tests)")
    ap.add_argument(
        "--e2e", action="store_true", help="also run the Playwright e2e/a11y suite (PRE-DEPLOY gate; heavy)"
    )
    scope = ap.add_mutually_exclusive_group()
    scope.add_argument("--backend", action="store_true", help="backend checks only")
    scope.add_argument("--frontend", action="store_true", help="frontend checks only")
    args = ap.parse_args()

    problems = preflight()
    if problems:
        print("[FAIL] environment not ready:")
        for p in problems:
            print(f"  - {p}")
        return 2

    checks = build_checks()
    if args.backend:
        checks = [c for c in checks if c.cwd == BACKEND]
    elif args.frontend:
        checks = [c for c in checks if c.cwd == FRONTEND]
    if args.fast:
        checks = [c for c in checks if c.fast]
    # e2e (`--e2e`, PRE-DEPLOY gate) runs SEQUENTIALLY after the parallel batch — never in the pool: it
    # builds the dist + boots a preview server + a headless browser, which starves/races the other checks
    # (concurrent pytest flaked with async RuntimeErrors under the contention). Skipped for --fast/--backend.
    run_e2e = args.e2e and not args.fast and not args.backend

    results: list[Check] = []
    if checks:
        print(f"running {len(checks)} checks in parallel...\n")
        with ThreadPoolExecutor(max_workers=len(checks)) as ex:
            results = list(ex.map(run_check, checks))
    if run_e2e:
        print("running e2e (playwright) sequentially — build + preview + browser...\n")
        results.append(
            run_check(Check("e2e (playwright)", npm_argv(["run", "test:e2e"]), FRONTEND, fast=False))
        )
    if not results:
        print("no checks selected")
        return 0

    for c in results:
        mark = "PASS" if c.code == 0 else "FAIL"
        print(f"[{mark}] {c.name}  ({c.seconds:.1f}s)")

    failed = [c for c in results if c.code != 0]
    if failed:
        for c in failed:
            print("\n" + "-" * 70)
            print(f"[FAIL] {c.name} (exit {c.code}):\n")
            print(c.output.rstrip())
        print("\n" + "=" * 70)
        print(f"FAILED - {len(failed)}/{len(results)} checks did not pass")
        return 1

    print(f"\nAll {len(results)} checks passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
