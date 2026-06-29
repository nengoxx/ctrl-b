#!/usr/bin/env bash
# Idempotent on-emma setup for a ctrl-b dashboard INSTANCE. Run ON emma (not from Windows). Safe to re-run.
# It does NOT create/clone/migrate trees (that's bootstrap.py — see README) — it builds + enables the
# instance from the tree it's run in. It never touches secrets beyond the one-time dev seed-copy, and only
# ever manages the user's own systemd.
#
# Usage:  bash deploy/emma/scripts/install.sh [prod|dev]      (default: prod)
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
DEPLOY="$V2/deploy/emma"          # README + bootstrap.py live here; units in systemd/, shell helpers in scripts/
UNIT_DIR="$DEPLOY/systemd"
SCRIPTS="$DEPLOY/scripts"

# `systemctl --user` needs the user bus address — NOT set on a non-interactive SSH exec (how bootstrap.py
# runs this). linger=yes keeps /run/user/UID (+ its bus) alive, so pointing at it makes --user work over SSH.
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
export DBUS_SESSION_BUS_ADDRESS="${DBUS_SESSION_BUS_ADDRESS:-unix:path=${XDG_RUNTIME_DIR}/bus}"

echo "== ctrl-b dashboard install [$ROLE]  (repo=$REPO, CTRLB_HOME=$CTRLB_HOME) =="
[ -d "$V2" ] || { echo "ERROR: $V2 not found — is the $ROLE tree cloned? (see bootstrap.py / README)"; exit 1; }

# 1) Prerequisites. HARD-require the build tools — clear error + install hint if missing, so a CLEAN machine
#    fails loudly HERE rather than cryptically mid-build. tmux + linger are soft (needed later / for persistence).
miss=0
req() { command -v "$1" >/dev/null || { echo "  ✗ missing: $1 — $2"; miss=1; }; }
req git     "sudo apt install -y git"
req python3 "sudo apt install -y python3 python3-venv   (need 3.11+)"
req node    "install Node 20+ (nodesource.com / nodejs.org)"
req npm     "comes with Node (nodesource.com / nodejs.org)"
[ "$miss" = 1 ] && { echo "→ install the missing prerequisite(s) above, then re-run."; exit 1; }
command -v tmux >/dev/null || echo "⚠ tmux missing (only needed for the Claude agent later) → sudo apt install -y tmux"
[ "$(loginctl show-user "$(id -un)" -p Linger --value 2>/dev/null)" = yes ] || \
  echo "⚠ user-linger is OFF → services won't survive logout/reboot. Enable: sudo loginctl enable-linger $(id -un)"

# 2) Backend venv — NATIVE Python 3.14 where available (the whole pinned stack is 3.14-wheel-ready; verified on
#    emma 2026-06-29), else any python3 ≥ 3.11. REBUILD if an existing venv is a different version.
VENV="$V2/backend/.venv"
PY="$(command -v python3.14 || command -v python3 || true)"
[ -n "$PY" ] || { echo "✗ no python3 on PATH — sudo apt install -y python3 python3-venv"; exit 1; }
"$PY" -c 'import sys; raise SystemExit(0 if sys.version_info >= (3,11) else 1)' \
  || { echo "✗ $PY is too old ($("$PY" -V 2>&1)) — need Python 3.11+"; exit 1; }
"$PY" -c 'import venv' 2>/dev/null || { echo "✗ python venv module missing — sudo apt install -y python3-venv"; exit 1; }
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

# 5) Render + install + enable the systemd USER units. The units are TEMPLATES — render __REPO__/__CTRLB_HOME__/
#    __NPM__ to this machine's real paths so they work for ANY user/host, not just emma.
mkdir -p "$HOME/.config/systemd/user"
NPM="$(command -v npm)"
for u in "${UNITS[@]}"; do
  sed -e "s#__REPO__#$REPO#g" -e "s#__CTRLB_HOME__#$CTRLB_HOME#g" -e "s#__NPM__#$NPM#g" \
      "$UNIT_DIR/$u" > "$HOME/.config/systemd/user/$u"
done
systemctl --user daemon-reload
if ! systemctl --user enable --now "${UNITS[@]}"; then
  echo "✗ systemctl --user enable failed. Common causes: user bus not reachable over SSH (need linger:"
  echo "    sudo loginctl enable-linger $(id -un)), or a unit error → inspect:  systemctl --user status ${UNITS[0]}"
  exit 1
fi
echo "-- [$ROLE] units rendered + enabled: ${UNITS[*]}"

echo ""
if [ "$ROLE" = prod ]; then
  echo "✓ PROD install done. Verify:  systemctl --user status ctrl-b-dashboard  |  curl -s localhost:5433/api/health"
  echo "Next:"
  echo "  • HTTPS on the tailnet:   bash $SCRIPTS/serve-https.sh"
  echo "  • Set up the DEV sandbox: clone ~/github/ctrl-b-dev (dev branch), then  bash deploy/emma/scripts/install.sh dev"
else
  echo "✓ DEV install done. Verify:  systemctl --user status ctrl-b-dashboard-dev  |  curl -s localhost:5434/api/health"
  echo "  Dev UI: http://emma:5173 (Vite → :5434).  The Claude agent runs here:  bash $SCRIPTS/start-claude.sh"
fi
