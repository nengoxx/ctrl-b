#!/usr/bin/env sh
# Shared launcher for the ctrl-b git hooks (QUALITY.md / DECISIONS D33). Resolves a Python
# interpreter, then runs the quality gate with whatever args the hook passes ("$@").
#
# Interpreter order matters: prefer the backend venv (always present after install) — it is the
# reliable interpreter AND it sidesteps the Windows "python from Microsoft Store" PATH stub that
# hijacks a bare `python`/`python3` on a machine that only uses the venv. Fall back to PATH python
# for a not-yet-built tree (check.py then reports the missing venv with an actionable hint).
#
# Hooks run with GIT_DIR exported. From the normal workspace it is the RELATIVE `.git` and re-resolves
# per-cwd — harmlessly; from a LINKED WORKTREE it is ABSOLUTE, so any `git -C <elsewhere>` that a
# test's product code runs is silently retargeted at THIS repo (proven 2026-08-11: the v1.5.1 pre-push
# gate, run from a release worktree, committed test junk onto the release branch — SYS-20). The gate
# judges the TREE, and check.py itself runs no git — drop the hook's git context entirely.
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE
if   [ -f backend/.venv/Scripts/python.exe ]; then PY=backend/.venv/Scripts/python.exe   # Windows
elif [ -f backend/.venv/bin/python ];        then PY=backend/.venv/bin/python            # POSIX
elif command -v python3 >/dev/null 2>&1;     then PY=python3
else PY=python
fi
exec "$PY" tools/check.py "$@"
