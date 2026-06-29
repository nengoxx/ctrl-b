#!/usr/bin/env bash
# Idempotent on-emma setup for a ctrl-b dashboard INSTANCE. Run ON emma (not from Windows). Safe to re-run.
# It does NOT create/clone/migrate trees (that's bootstrap.py — see README) — it builds + enables the
# instance from the tree it's run in. It never touches secrets beyond the one-time dev seed-copy, and only
# ever manages the user's own systemd.
#
# Usage:  bash deploy/emma/install.sh [prod|dev]      (default: prod)
#
#   prod →  PROD instance (D32).  Tree: ~/github/ctrl-b (CLEAN, sparse, tag-pinned).  Data: ~/.ctrl-b.
#           Builds the native-3.14 venv + the PROD dist (served by uvicorn :5433); enables
#           ctrl-b-dashboard.service.  Requires ~/.ctrl-b/config.yaml to already be present.
#   dev  →  DEV instance (isolated).  Tree: ~/github/ctrl-b-dev (`dev` branch).  Data: ~/.ctrl-b-dev.
#           Builds the venv + installs npm deps (Vite serves live — no dist build); enables the two dev
#           units (backend :5434 + Vite :5173).  Seeds ~/.ctrl-b-dev/config.yaml from ~/.ctrl-b the first
#           time so dev has the same fleet but its OWN db/chat.
set -euo pipefail

ROLE="${1:-prod}"
case "$ROLE" in
  prod) REPO="${REPO:-$HOME/github/ctrl-b}";     CTRLB_HOME="${CTRLB_HOME:-$HOME/.ctrl-b}";     UNITS=(ctrl-b-dashboard.service) ;;
  dev)  REPO="${REPO:-$HOME/github/ctrl-b-dev}"; CTRLB_HOME="${CTRLB_HOME:-$HOME/.ctrl-b-dev}"; UNITS=(ctrl-b-dashboard-dev.service ctrl-b-dashboard-dev-web.service) ;;
  *)    echo "usage: install.sh [prod|dev]"; exit 2 ;;
esac
V2="$REPO/dashboard_v2"
HERE="$V2/deploy/emma"

# `systemctl --user` needs the user bus address — NOT set on a non-interactive SSH exec (how bootstrap.py
# runs this). linger=yes keeps /run/user/UID (+ its bus) alive, so pointing at it makes --user work over SSH.
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
export DBUS_SESSION_BUS_ADDRESS="${DBUS_SESSION_BUS_ADDRESS:-unix:path=${XDG_RUNTIME_DIR}/bus}"

echo "== ctrl-b dashboard install [$ROLE]  (repo=$REPO, CTRLB_HOME=$CTRLB_HOME) =="
[ -d "$V2" ] || { echo "ERROR: $V2 not found — is the $ROLE tree cloned? (see bootstrap.py / README)"; exit 1; }

# 1) Prereqs that need root — DON'T auto-sudo; report so the owner runs them deliberately.
command -v tmux >/dev/null || echo "⚠ tmux missing → run:  sudo apt install -y tmux   (needed for the Claude agent)"

# 2) Backend venv — NATIVE Python 3.14 (the whole pinned stack is 3.14-wheel-ready; verified on emma
#    2026-06-29). Use the system python3 (3.14 on emma); REBUILD if an existing venv is a different version.
VENV="$V2/backend/.venv"
PY="$(command -v python3.14 || command -v python3)"
WANT="$("$PY" -c 'import sys;print(f"{sys.version_info.major}.{sys.version_info.minor}")')"
if [ -d "$VENV" ]; then
  HAVE="$("$VENV/bin/python" -c 'import sys;print(f"{sys.version_info.major}.{sys.version_info.minor}")' 2>/dev/null || echo none)"
  [ "$HAVE" = "$WANT" ] || { echo "-- existing venv is Python $HAVE, want $WANT → rebuilding"; rm -rf "$VENV"; }
fi
[ -d "$VENV" ] || { echo "-- creating backend venv with $PY (Python $WANT)"; "$PY" -m venv "$VENV"; }
echo "-- ensuring backend deps (pip install -e .)"
"$VENV/bin/pip" install -e "$V2/backend" --quiet

# 3) Frontend deps — both roles need node_modules. PROD also builds the dist (uvicorn serves it); DEV does
#    NOT build (Vite serves live with hot-reload).
echo "-- frontend deps"
( cd "$V2/frontend" && { [ -d node_modules ] || npm ci; } )
if [ "$ROLE" = prod ]; then
  echo "-- frontend build (PROD dist)"
  ( cd "$V2/frontend" && npm run build )
fi

# 4) Config presence. PROD requires the real secret already transferred (bootstrap.py / scp). DEV seeds its
#    OWN config from prod's the first time, then is independent (its own db/chat under ~/.ctrl-b-dev).
mkdir -p "$CTRLB_HOME"
if [ ! -f "$CTRLB_HOME/config.yaml" ]; then
  if [ "$ROLE" = dev ] && [ -f "$HOME/.ctrl-b/config.yaml" ]; then
    echo "-- seeding DEV config from prod (~/.ctrl-b/config.yaml → $CTRLB_HOME/config.yaml; dev keeps its own db/chat)"
    install -m 600 "$HOME/.ctrl-b/config.yaml" "$CTRLB_HOME/config.yaml"
  else
    echo "ERROR: $CTRLB_HOME/config.yaml is missing."
    echo "       PROD: transfer it first — python deploy/emma/bootstrap.py  (from the Windows checkout),"
    echo "             or scp dashboard_v2/config.yaml  emma:$CTRLB_HOME/config.yaml"
    echo "       DEV : run the PROD install first (so ~/.ctrl-b/config.yaml exists to seed from)."
    exit 1
  fi
fi

# 5) Install + enable the systemd USER units (linger=yes → they run without an active login).
mkdir -p "$HOME/.config/systemd/user"
for u in "${UNITS[@]}"; do cp "$HERE/$u" "$HOME/.config/systemd/user/"; done
systemctl --user daemon-reload
systemctl --user enable --now "${UNITS[@]}"
echo "-- [$ROLE] units enabled: ${UNITS[*]}"

echo ""
if [ "$ROLE" = prod ]; then
  echo "✓ PROD install done. Verify:  systemctl --user status ctrl-b-dashboard  |  curl -s localhost:5433/api/health"
  echo "Next:"
  echo "  • HTTPS on the tailnet:   bash $HERE/serve-https.sh"
  echo "  • Set up the DEV sandbox: clone ~/github/ctrl-b-dev (dev branch), then  bash deploy/emma/install.sh dev"
else
  echo "✓ DEV install done. Verify:  systemctl --user status ctrl-b-dashboard-dev  |  curl -s localhost:5434/api/health"
  echo "  Dev UI: http://emma:5173 (Vite → :5434).  The Claude agent runs here:  bash $HERE/start-claude.sh"
fi
