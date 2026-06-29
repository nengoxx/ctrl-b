#!/usr/bin/env bash
# Create an isolated DEV-side git worktree so a SECOND agent can work a feature/audit branch IN PARALLEL,
# without disturbing the main dev tree (~/github/ctrl-b-dev on `dev`, which the dev instance serves). Run ON emma.
#
# This is the standard parallel-AI-agent layout: one worktree per agent per branch, as SIBLING dirs off the dev
# clone, sharing its .git (cheap — no re-clone). git refuses the same branch in two worktrees, so each worktree
# is its OWN branch (that's why "two agents on `dev` at once" isn't a thing — the second gets a new branch here).
# You only need this when you actually want simultaneous writers; day-to-day, both agents share the one dev tree.
#
# Usage:  add-dev-worktree.sh <name> [branch]
#   add-dev-worktree.sh authfix           # → ~/github/ctrl-b-authfix on a new branch feat/authfix
#   add-dev-worktree.sh audit dev-audit   # → ~/github/ctrl-b-audit   on a new branch dev-audit
# Remove when done (push/merge the branch first):
#   git -C ~/github/ctrl-b-dev worktree remove ~/github/ctrl-b-<name>
set -euo pipefail

NAME="${1:?usage: add-dev-worktree.sh <name> [branch]}"
BRANCH="${2:-feat/$NAME}"
DEV="$HOME/github/ctrl-b-dev"
TREE="$HOME/github/ctrl-b-$NAME"

[ -d "$DEV/.git" ] || { echo "ERROR: dev tree $DEV not found (run migrate-layout.sh first)."; exit 1; }
[ -e "$TREE" ] && { echo "ERROR: $TREE already exists — pick another name or remove it first."; exit 1; }

git -C "$DEV" fetch origin --quiet || true
# Branch off origin/dev when available (freshest), else the local dev tip.
BASE="origin/dev"; git -C "$DEV" rev-parse --verify --quiet "$BASE" >/dev/null || BASE="dev"
git -C "$DEV" worktree add -b "$BRANCH" "$TREE" "$BASE"

echo ""
echo "✓ Worktree ready: $TREE   (new branch '$BRANCH', off $BASE)"
echo "  Launch a second agent there:"
echo "      bash $TREE/dashboard_v2/deploy/emma/scripts/start-claude.sh $NAME $TREE"
echo "  When done (after pushing/merging '$BRANCH'):"
echo "      git -C $DEV worktree remove $TREE"
