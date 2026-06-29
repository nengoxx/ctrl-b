#!/usr/bin/env bash
# ONE-TIME, coordinated layout migration to the D32 two-tree topology. Run ON emma. Idempotent + resumable.
# Converts the legacy single full checkout (~/github/ctrl-b on `main`, the tandem agent's) into:
#   ~/github/ctrl-b-dev  → full tree on `dev`  (the DEV side — where all dev agents work + the DEV instance source)
#   ~/github/ctrl-b      → CLEAN sparse, tag-pinned PROD clone (cone mode: dashboard_v2 + top-level files;
#                          the legacy prototype DIRS — ws_claude*, ctrl-b (Vapor), wol_server — are excluded)
# SAFE: everything is on GitHub; it REFUSES on uncommitted changes (never loses unpushed work) and REFUSES if
# the Claude agent tmux session is running — coordinate first (stop it / detach it from this box).
set -euo pipefail

PROD="$HOME/github/ctrl-b"
DEV="$HOME/github/ctrl-b-dev"
# Cone mode (the modern `set` default): args are DIRECTORIES; top-level files (AGENTS.md, CLAUDE.md, …) are
# always included. So `set dashboard_v2` = the app tree + root files; only the legacy prototype dirs drop out.
SPARSE=(dashboard_v2)

is_sparse() { [ -d "$1/.git" ] && [ "$(git -C "$1" config --get core.sparseCheckout 2>/dev/null)" = "true" ]; }

# 0) Guard: the agent must be stopped (a tree is about to move).
if command -v tmux >/dev/null && tmux has-session -t ctrl-b 2>/dev/null; then
  echo "ABORT: the Claude agent tmux session 'ctrl-b' is running — its tree is about to move. Stop it first:"
  echo "       tmux kill-session -t ctrl-b      # (coordinate with whoever's driving the agent)"
  exit 3
fi

# 1) Already migrated? (PROD sparse + DEV present) → nothing to do.
if is_sparse "$PROD" && [ -d "$DEV/.git" ]; then
  echo "✓ Already migrated — PROD is sparse and the DEV tree exists. Nothing to do."
  exit 0
fi

# 2) Find the source checkout to learn origin from + guard against losing unpushed work.
SRC=""
[ -d "$PROD/.git" ] && ! is_sparse "$PROD" && SRC="$PROD"
[ -z "$SRC" ] && [ -d "$DEV/.git" ] && SRC="$DEV"
[ -n "$SRC" ] || { echo "ERROR: no full checkout at $PROD or $DEV to migrate from."; exit 1; }
GH="$(git -C "$SRC" remote get-url origin)"
echo "Migrating to the D32 two-tree layout (source: $SRC, origin: $GH)"
if [ -n "$(git -C "$SRC" status --porcelain)" ]; then
  echo "ABORT: $SRC has uncommitted changes — commit & push (or stash) them first, then re-run."; exit 4
fi

# 3) Ensure the DEV tree exists (full, `dev` branch). If only PROD exists, MOVE it (preserves everything).
if [ ! -d "$DEV/.git" ]; then
  echo "-- moving $PROD → $DEV"
  mv "$PROD" "$DEV"
fi
git -C "$DEV" fetch origin --tags --quiet
git -C "$DEV" checkout dev 2>/dev/null || git -C "$DEV" checkout -b dev
echo "-- DEV tree ready: $DEV (branch dev)"

# 4) Ensure PROD is a CLEAN sparse clone. Replace any leftover non-sparse checkout (redundant — DEV holds the
#    work, and we verified it's clean + on GitHub).
if [ -d "$PROD/.git" ] && ! is_sparse "$PROD"; then
  echo "-- removing redundant full checkout at $PROD (work is preserved in $DEV + GitHub)"
  rm -rf "$PROD"
fi
if [ ! -d "$PROD/.git" ]; then
  echo "-- creating clean sparse PROD clone at $PROD"
  git clone --filter=blob:none --sparse "$GH" "$PROD" --quiet
  git -C "$PROD" sparse-checkout set "${SPARSE[@]}"
fi
TAG="$(git -C "$PROD" describe --tags --abbrev=0 2>/dev/null || true)"
if [ -n "$TAG" ]; then
  git -C "$PROD" checkout --quiet "$TAG"; echo "-- PROD pinned to tag $TAG"
else
  git -C "$PROD" checkout --quiet main
  echo "-- PROD on main (no tags yet — cut the first release from dev:  git -C $DEV tag -a v0.1.0 -m '...' && git push --tags)"
fi

echo ""
echo "✓ Migration done."
echo "   PROD: $PROD   (sparse$( [ -n "$TAG" ] && echo ", $TAG" || echo ", main" ))   → bash deploy/emma/install.sh prod"
echo "   DEV : $DEV   (branch dev, full)               → bash deploy/emma/install.sh dev   + start-claude.sh"
echo "   Re-launch the agent IN THE DEV TREE:  bash $DEV/dashboard_v2/deploy/emma/start-claude.sh"
