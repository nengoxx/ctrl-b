#!/usr/bin/env bash
# Idempotent on-emma setup for a ctrl-b dashboard INSTANCE. Run ON emma (not from Windows). Safe to re-run.
# It does NOT create/clone trees (that's bootstrap.py — see README) — it builds + enables the
# instance from the tree it's run in. It never touches secrets beyond the one-time dev seed-copy, and only
# ever manages the user's own systemd.
#
# Usage:  bash deploy/linux/install.sh [prod|dev]      (default: prod)
#
#   prod →  PROD instance (D32, amended 2026-07-09).  Tree: ~/apps/ctrl-b (CLEAN, sparse, tag-pinned —
#           the deployed RUNTIME, never a workspace).  Data: ~/.ctrl-b.  Builds the native-3.14 venv +
#           the PROD dist (built aside, swapped in atomically at cutover; served by uvicorn :5433);
#           snapshots the DB before restarting; enables ctrl-b-dashboard.service.
#           Requires ~/.ctrl-b/config.yaml to already be present.
#   dev  →  DEV instance (isolated sandbox).  Tree: ~/github/ctrl-b (the WORKSPACE, pinned to `main` —
#           the only branch; all development happens here).  Data: ~/.ctrl-b-dev.
#           Builds the venv + installs npm deps (Vite serves live — no dist build); installs the two dev
#           dashboard units ON-DEMAND (backend :5434 + Vite :5173 — start when iterating) and enables the
#           TWO boot agent instances ctrl-b-agent@{fable,opus} (tmux ctrl-b-fable / ctrl-b-opus).
#           Seeds ~/.ctrl-b-dev/config.yaml from ~/.ctrl-b the first time so dev has the same fleet but
#           its OWN db/chat.
set -euo pipefail

ROLE="${1:-prod}"
# RENDER_UNITS = unit FILES rendered to ~/.config/systemd/user (the agent file is a systemd TEMPLATE,
# ctrl-b-agent@.service). BOOT_UNITS = enabled --now (boot + start). ONDEMAND_UNITS = installed but NOT
# enabled — the dev dashboards are on-demand (owner amendment 2026-07-10, revises the earlier "BOTH
# always-on"): start them only when iterating. The agents ARE boot services: two template instances,
# fable 5 + opus 4.8, both effort high (tmux sessions ctrl-b-fable / ctrl-b-opus).
case "$ROLE" in
  prod) REPO="${REPO:-$HOME/apps/ctrl-b}";   CTRLB_HOME="${CTRLB_HOME:-$HOME/.ctrl-b}"
        RENDER_UNITS=(ctrl-b-dashboard.service)
        BOOT_UNITS=(ctrl-b-dashboard.service)
        ONDEMAND_UNITS=() ;;
  dev)  REPO="${REPO:-$HOME/github/ctrl-b}"; CTRLB_HOME="${CTRLB_HOME:-$HOME/.ctrl-b-dev}"
        RENDER_UNITS=(ctrl-b-dashboard-dev.service ctrl-b-dashboard-dev-web.service ctrl-b-agent@.service)
        BOOT_UNITS=(ctrl-b-agent@fable.service ctrl-b-agent@opus.service)
        ONDEMAND_UNITS=(ctrl-b-dashboard-dev.service ctrl-b-dashboard-dev-web.service) ;;
  *)    echo "usage: install.sh [prod|dev]"; exit 2 ;;
esac
BACKUP_KEEP="${CTRLB_BACKUP_KEEP:-10}"   # pre-cutover DB snapshots retained (prod)
APP="$REPO"                       # the app IS the repo root now (backend/ + frontend/ + deploy/)
DEPLOY="$APP/deploy/linux"        # install/serve/migrate + systemd/ live here; bootstrap.py is at deploy/
UNIT_DIR="$DEPLOY/systemd"
SCRIPTS="$DEPLOY"                  # shell helpers are flat in deploy/linux/ (no scripts/ subdir)

# `systemctl --user` needs the user bus address — NOT set on a non-interactive SSH exec (how bootstrap.py
# runs this). linger=yes keeps /run/user/UID (+ its bus) alive, so pointing at it makes --user work over SSH.
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
export DBUS_SESSION_BUS_ADDRESS="${DBUS_SESSION_BUS_ADDRESS:-unix:path=${XDG_RUNTIME_DIR}/bus}"

echo "== ctrl-b dashboard install [$ROLE]  (repo=$REPO, CTRLB_HOME=$CTRLB_HOME) =="
[ -d "$APP" ] || { echo "ERROR: $APP not found — is the $ROLE tree cloned? (see bootstrap.py / README)"; exit 1; }

# 1) Prerequisites. HARD-require the build tools — clear error + install hint if missing, so a CLEAN machine
#    fails loudly HERE rather than cryptically mid-build. tmux + linger are soft (needed later / for persistence).
miss=0
req() { command -v "$1" >/dev/null || { echo "  ✗ missing: $1 — $2"; miss=1; }; }
req git     "sudo apt install -y git"
req python3 "sudo apt install -y python3 python3-venv   (need 3.14+)"
req node    "install Node 20+ (nodesource.com / nodejs.org)"
req npm     "comes with Node (nodesource.com / nodejs.org)"
# DEV runs the always-on Claude agent instances (ctrl-b-agent@{fable,opus}, tmux-wrapped) → tmux is a
# HARD requirement there; prod never runs an agent, so it stays a soft note.
if [ "$ROLE" = dev ]; then req tmux "sudo apt install -y tmux"; fi
[ "$miss" = 1 ] && { echo "→ install the missing prerequisite(s) above, then re-run."; exit 1; }
command -v tmux >/dev/null || echo "⚠ tmux missing (only needed for the Claude agent later) → sudo apt install -y tmux"
# The agent instances need the claude CLI — if it's not there yet, install the dashboards WITHOUT the
# agent units (re-run after installing claude to add them) rather than failing the whole instance.
if [ "$ROLE" = dev ] && ! command -v claude >/dev/null; then
  echo "⚠ claude CLI not found — installing the dev dashboard units only; install claude, then re-run to add ctrl-b-agent@{fable,opus}."
  BOOT_UNITS=()
fi
[ "$(loginctl show-user "$(id -un)" -p Linger --value 2>/dev/null)" = yes ] || \
  echo "⚠ user-linger is OFF → services won't survive logout/reboot. Enable: sudo loginctl enable-linger $(id -un)"

# 2) Backend venv — NATIVE Python 3.14 (the codebase uses 3.14-only syntax; the whole pinned stack is
#    3.14-wheel-ready; verified on emma 2026-06-29). REBUILD if an existing venv is a different version.
VENV="$APP/backend/.venv"
PY="$(command -v python3.14 || command -v python3 || true)"
[ -n "$PY" ] || { echo "✗ no python3 on PATH — sudo apt install -y python3 python3-venv"; exit 1; }
"$PY" -c 'import sys; raise SystemExit(0 if sys.version_info >= (3,14) else 1)' \
  || { echo "✗ $PY is too old ($("$PY" -V 2>&1)) — need Python 3.14+"; exit 1; }
WANT="$("$PY" -c 'import sys;print(f"{sys.version_info.major}.{sys.version_info.minor}")')"
if [ -d "$VENV" ]; then
  HAVE="$("$VENV/bin/python" -c 'import sys;print(f"{sys.version_info.major}.{sys.version_info.minor}")' 2>/dev/null || echo none)"
  [ "$HAVE" = "$WANT" ] || { echo "-- existing venv is Python $HAVE, want $WANT → rebuilding"; rm -rf "$VENV"; }
fi
# No `import venv` pre-probe — on Debian/Ubuntu it passes even when python3-venv (ensurepip) is missing;
# the real operation is the reliable check, so make ITS failure actionable instead.
[ -d "$VENV" ] || { echo "-- creating backend venv with $PY (Python $WANT)"; "$PY" -m venv "$VENV" \
  || { echo "✗ venv creation failed — Debian/Ubuntu ships python3 without ensurepip: sudo apt install -y python3-venv"; exit 1; }; }
# DEV also needs the check.py toolchain ([dev] = ruff/pyright/pytest) — step 4.5 enables the git
# hooks, which run tools/check.py on every commit/push in the tree where agents commit. PROD stays
# lean (sparse, tag-pinned, never commits; check.py's preflight reports the missing toolchain
# actionably if it's ever invoked there).
EXTRA=""; [ "$ROLE" = dev ] && EXTRA="[dev]"
echo "-- ensuring backend deps (pip install -e .$EXTRA)"
"$VENV/bin/pip" install -e "$APP/backend$EXTRA" --quiet

# 3) Frontend deps — both roles need node_modules. PROD also builds the dist (uvicorn serves it); DEV does
#    NOT build (Vite serves live with hot-reload). PROD builds ASIDE (dist.next) while the old dist keeps
#    serving — it's swapped in at cutover (step 5.5) so a mid-build page load never sees a half-built tree.
echo "-- frontend deps"
if [ "$ROLE" = prod ]; then
  # ALWAYS npm ci on prod: a new tag may change package-lock.json, and `[ -d node_modules ]` would build
  # against stale deps. npm ci is deterministic-per-deploy (that's its job); dev keeps the fast path.
  ( cd "$APP/frontend" && npm ci )
  echo "-- frontend build (PROD dist → dist.next, swapped at cutover)"
  ( cd "$APP/frontend" && npm run build -- --outDir dist.next --emptyOutDir )
else
  ( cd "$APP/frontend" && { [ -d node_modules ] || npm ci; } )
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
    echo "       PROD: transfer it first — python deploy/bootstrap.py  (from the Windows checkout),"
    echo "             or scp config.yaml  emma:$CTRLB_HOME/config.yaml"
    echo "       DEV : run the PROD install first (so ~/.ctrl-b/config.yaml exists to seed from)."
    exit 1
  fi
fi

# 4.5) Git-hook quality gate (D33). Point git at the tracked .githooks/ so a bad commit (fast: ruff +
#      prettier) / push (full: tools/check.py) is blocked at the source. Essential for the dev tree where
#      agents commit. Idempotent; the exec bit is tracked in git but re-ensured here in case a checkout
#      dropped it. The sparse PROD tree never materializes .githooks/ (cone mode: root FILES only) and
#      never commits — skip it there instead of claiming hooks that don't exist.
if git -C "$APP" rev-parse --git-dir >/dev/null 2>&1 && [ -d "$APP/.githooks" ]; then
  git -C "$APP" config core.hooksPath .githooks
  chmod +x "$APP/.githooks/"* 2>/dev/null || true
  echo "-- git hooks enabled (core.hooksPath=.githooks)"
fi

# 5) Render + install + enable the systemd USER units. The units are TEMPLATES — render __REPO__/__CTRLB_HOME__/
#    __NPM__ to this machine's real paths so they work for ANY user/host, not just emma.
mkdir -p "$HOME/.config/systemd/user"
# The agent units' EnvironmentFile home (effort/perm overrides: agent.env shared, agent-<i>.env
# per-instance) — ensure the dir so the documented one-liners can't fail with "No such file or directory".
if [ "$ROLE" = dev ]; then mkdir -p "$HOME/.config/ctrl-b"; fi
NPM="$(command -v npm)"
NODEBIN="$(dirname "$NPM")"   # npm's bin dir → rendered into the dev-web unit's PATH so `node` resolves
TMUX_BIN="$(command -v tmux || echo /usr/bin/tmux)"   # agent unit's ExecStop (absolute path required)
for u in "${RENDER_UNITS[@]}"; do
  sed -e "s#__REPO__#$REPO#g" -e "s#__CTRLB_HOME__#$CTRLB_HOME#g" -e "s#__NPM__#$NPM#g" \
      -e "s#__NODEBIN__#$NODEBIN#g" -e "s#__HOME__#$HOME#g" -e "s#__TMUX__#$TMUX_BIN#g" \
      "$UNIT_DIR/$u" > "$HOME/.config/systemd/user/$u"
done
# LEGACY migration (pre-2026-07-10 layouts): (a) the single agent.env-switched ctrl-b-agent.service is
# superseded by the two template instances — retire it (its ExecStop kills the old 'ctrl-b' session);
# (b) the short-lived parenthesized session names ("ctrl-b (fable)") were simplified to ctrl-b-<i> —
# kill any lingering old-format sessions so the renamed instances recreate them cleanly.
if [ "$ROLE" = dev ]; then
  if [ -f "$HOME/.config/systemd/user/ctrl-b-agent.service" ]; then
    systemctl --user disable --now ctrl-b-agent.service 2>/dev/null || true
    rm -f "$HOME/.config/systemd/user/ctrl-b-agent.service"
    tmux kill-session -t '=ctrl-b' 2>/dev/null || true
    echo "-- retired the legacy ctrl-b-agent.service (+ old 'ctrl-b' tmux session) → replaced by ctrl-b-agent@{fable,opus}"
  fi
  for old in 'ctrl-b (fable)' 'ctrl-b (opus)'; do
    tmux kill-session -t "=$old" 2>/dev/null && echo "-- killed old-format session '$old' (renamed to ctrl-b-<model>)" || true
  done
fi
systemctl --user daemon-reload

# 5.5) PROD cutover — the only moment the running instance is touched, kept sub-second:
#      (a) snapshot the DB via SQLite's Online Backup API (WAL-safe on a LIVE db — plain `cp` is NOT:
#          committed data sits in the -wal sidecar; see docs/DECISIONS.md D32 amendment) + verify it,
#      (b) stop the service, (c) swap the aside-built dist into place, (d) start (below).
#      Migrations run forward-only at app startup, so this snapshot is THE rollback point for data:
#      restore = stop → rm stale ctrlb.db-wal/-shm → gunzip snapshot over ctrlb.db → start (README).
if [ "$ROLE" = prod ]; then
  DB="$CTRLB_HOME/ctrlb.db"
  if [ -f "$DB" ]; then
    command -v sqlite3 >/dev/null || { echo "✗ sqlite3 missing — needed to snapshot the DB before cutover:  sudo apt install -y sqlite3"; exit 1; }
    BKD="$CTRLB_HOME/backups"; mkdir -p "$BKD"
    SNAP="$BKD/ctrlb-$(date +%Y%m%d-%H%M%S).db"
    sqlite3 "$DB" ".backup '$SNAP'"
    [ "$(sqlite3 "$SNAP" 'PRAGMA integrity_check;')" = "ok" ] \
      || { echo "✗ DB snapshot failed integrity_check — aborting cutover (service untouched)"; rm -f "$SNAP"; exit 1; }
    gzip -f "$SNAP"
    ls -1t "$BKD"/ctrlb-*.db.gz 2>/dev/null | tail -n +"$((BACKUP_KEEP + 1))" | xargs -r rm -f
    echo "-- DB snapshot: $SNAP.gz (keeping last $BACKUP_KEEP; CTRLB_BACKUP_KEEP overrides)"
  fi
  systemctl --user stop ctrl-b-dashboard.service 2>/dev/null || true
  rm -rf "$APP/frontend/dist"
  mv "$APP/frontend/dist.next" "$APP/frontend/dist"
fi

if [ "${#BOOT_UNITS[@]}" -gt 0 ] && ! systemctl --user enable --now "${BOOT_UNITS[@]}"; then
  echo "✗ systemctl --user enable failed. Common causes: user bus not reachable over SSH (need linger:"
  echo "    sudo loginctl enable-linger $(id -un)), or a unit error → inspect:  systemctl --user status ${BOOT_UNITS[0]}"
  exit 1
fi
# On-demand units: installed, NEVER boot-enabled. `disable` (no --now) converges an older always-on
# install to on-demand without killing a live dev session mid-iteration.
if [ "${#ONDEMAND_UNITS[@]}" -gt 0 ]; then
  systemctl --user disable "${ONDEMAND_UNITS[@]}" >/dev/null 2>&1 || true
  echo "-- on-demand units installed (not boot-enabled): ${ONDEMAND_UNITS[*]}"
  echo "   start when iterating:  systemctl --user start ${ONDEMAND_UNITS[*]%.service}"
fi
echo "-- [$ROLE] units rendered: ${RENDER_UNITS[*]}  |  boot-enabled: ${BOOT_UNITS[*]:-'(none)'}"

echo ""
if [ "$ROLE" = prod ]; then
  echo "✓ PROD install done. Verify:  systemctl --user status ctrl-b-dashboard  |  curl -s localhost:5433/api/health"
  echo "Next:"
  echo "  • HTTPS on the tailnet:   bash $SCRIPTS/serve-https.sh"
  echo "  • Set up the DEV sandbox: from the workspace (~/github/ctrl-b, main)  bash deploy/linux/install.sh dev"
else
  echo "✓ DEV install done."
  echo "  Dev instance (ON-DEMAND):  systemctl --user start ctrl-b-dashboard-dev ctrl-b-dashboard-dev-web"
  echo "                             then http://emma:5173 (Vite → :5434); stop them when done iterating."
  echo "  Agents (boot):  systemctl --user status ctrl-b-agent@fable ctrl-b-agent@opus"
  echo "                  attach:  tmux attach -t ctrl-b-fable   |   tmux attach -t ctrl-b-opus"
  echo "                  effort/perm overrides: ~/.config/ctrl-b/agent.env (shared) or agent-<i>.env (per-instance)"
fi
