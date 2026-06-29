#!/usr/bin/env bash
# Idempotent on-emma setup for the ctrl-b dashboard. Run ON emma (not from Windows). Safe to re-run.
# It does NOT touch secrets (config.yaml must already be at $CTRLB_HOME — see bootstrap.py / README) and
# never shuts down or modifies anything outside the project + the user's own systemd.
set -euo pipefail

REPO="${REPO:-$HOME/github/ctrl-b}"
V2="$REPO/dashboard_v2"
CTRLB_HOME="${CTRLB_HOME:-$HOME/.ctrl-b}"
HERE="$V2/deploy/emma"

# `systemctl --user` needs the user bus address — NOT set on a non-interactive SSH exec (how bootstrap.py
# runs this). linger=yes keeps /run/user/UID (+ its bus) alive, so pointing at it makes --user work over SSH.
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
export DBUS_SESSION_BUS_ADDRESS="${DBUS_SESSION_BUS_ADDRESS:-unix:path=${XDG_RUNTIME_DIR}/bus}"

echo "== ctrl-b dashboard install (repo=$REPO, CTRLB_HOME=$CTRLB_HOME) =="

# 1) Prereqs that need root — DON'T auto-sudo; report so the owner runs them deliberately.
command -v tmux >/dev/null || echo "⚠ tmux missing → run:  sudo apt install -y tmux   (needed for the Claude agent)"

# 2) Backend venv — REUSE if present (recon showed a healthy py3.11 venv). Pin to python3.11 (system python3
#    is 3.14; project requires >=3.11 but the existing venv + wheels are 3.11 — keep them consistent).
if [ ! -d "$V2/backend/.venv" ]; then
  PY311="$(command -v python3.11 || true)"
  [ -n "$PY311" ] || { echo "ERROR: no python3.11 (system python3 is 3.14). Install python3.11 first."; exit 1; }
  echo "-- creating backend venv with $PY311"
  "$PY311" -m venv "$V2/backend/.venv"
fi
echo "-- ensuring backend deps (pip install -e .)"
"$V2/backend/.venv/bin/pip" install -e "$V2/backend" --quiet

# 3) Frontend — install deps if missing, then build the PROD bundle (dist served by uvicorn).
echo "-- frontend build"
( cd "$V2/frontend" && { [ -d node_modules ] || npm ci; } && npm run build )

# 4) Config presence (secrets transferred out-of-band; never via git).
if [ ! -f "$CTRLB_HOME/config.yaml" ]; then
  echo "ERROR: $CTRLB_HOME/config.yaml is missing."
  echo "       Transfer it first:  python deploy/emma/bootstrap.py  (from the Windows checkout),"
  echo "       or scp dashboard_v2/config.yaml  emma:$CTRLB_HOME/config.yaml"
  exit 1
fi

# 5) Install + enable the systemd USER units (linger=yes → they run without an active login).
mkdir -p "$HOME/.config/systemd/user"
cp "$HERE/ctrl-b-dashboard.service"     "$HOME/.config/systemd/user/"
cp "$HERE/ctrl-b-dashboard-dev.service" "$HOME/.config/systemd/user/"
systemctl --user daemon-reload
systemctl --user enable --now ctrl-b-dashboard.service
echo "-- prod service enabled. (Dev is optional: systemctl --user enable --now ctrl-b-dashboard-dev.service)"

echo ""
echo "✓ Install done. Verify:  systemctl --user status ctrl-b-dashboard   |   curl -s localhost:5433/api/health"
echo "Next:"
echo "  • HTTPS on the tailnet:   bash $HERE/serve-https.sh"
echo "  • Always-on dev server:   systemctl --user enable --now ctrl-b-dashboard-dev.service   (http://emma:5173)"
echo "  • The Claude agent:       bash $HERE/start-claude.sh   (needs tmux)"
