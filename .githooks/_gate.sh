#!/usr/bin/env sh
# Shared launcher for the ctrl-b git hooks (QUALITY.md / DECISIONS D33). Resolves a Python
# interpreter, then runs the quality gate with whatever args the hook passes ("$@").
#
# Interpreter order matters: prefer the backend venv (always present after install) — it is the
# reliable interpreter AND it sidesteps the Windows "python from Microsoft Store" PATH stub that
# hijacks a bare `python`/`python3` on a machine that only uses the venv. Fall back to PATH python
# for a not-yet-built tree (check.py then reports the missing venv with an actionable hint).
if   [ -f backend/.venv/Scripts/python.exe ]; then PY=backend/.venv/Scripts/python.exe   # Windows
elif [ -f backend/.venv/bin/python ];        then PY=backend/.venv/bin/python            # POSIX
elif command -v python3 >/dev/null 2>&1;     then PY=python3
else PY=python
fi
exec "$PY" tools/check.py "$@"
