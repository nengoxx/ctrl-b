#!/usr/bin/env bash
# Manual FOREGROUND runner (no systemd) — quick local runs on Linux/macOS. Run from anywhere; paths resolve
# from this script's location (repo root = backend/ + frontend/ + config.yaml). For the always-on server
# install use install.sh (systemd) instead. CTRLB_HOME defaults to the repo root (override to relocate data).
#   run.sh prod   # npm build → uvicorn :5433 serving the built dist        (the "use it" path)
#   run.sh dev    # uvicorn :5433 (--reload) + Vite :5173 HMR (proxies /api → :5433)
set -euo pipefail

ROLE="${1:-prod}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
VENV="$ROOT/backend/.venv"
[ -d "$VENV" ] || { echo "✗ no backend venv at $VENV — create it first:"; \
  echo "    cd $ROOT/backend && python3 -m venv .venv && .venv/bin/pip install -e ."; exit 1; }
[ -f "$ROOT/config.yaml" ] || echo "⚠ $ROOT/config.yaml not found — fleet/secrets live there; add it before relying on the app."

case "$ROLE" in
  prod)
    ( cd "$ROOT/frontend" && { [ -d node_modules ] || npm ci; } && npm run build )
    echo "-- PROD: uvicorn http://127.0.0.1:5433  (serving frontend/dist; Ctrl-C to stop)"
    cd "$ROOT/backend" && exec "$VENV/bin/uvicorn" app.main:app --host 127.0.0.1 --port 5433
    ;;
  dev)
    ( cd "$ROOT/frontend" && { [ -d node_modules ] || npm ci; } )
    ( cd "$ROOT/frontend" && npm run dev ) &     # Vite :5173 → proxies /api → :5433
    VITE=$!; trap 'kill "$VITE" 2>/dev/null || true' EXIT
    echo "-- DEV: backend :5433 (--reload) + Vite http://127.0.0.1:5173  (Ctrl-C to stop)"
    cd "$ROOT/backend" && exec "$VENV/bin/uvicorn" app.main:app --host 127.0.0.1 --port 5433 --reload
    ;;
  *) echo "usage: run.sh [prod|dev]"; exit 2 ;;
esac
