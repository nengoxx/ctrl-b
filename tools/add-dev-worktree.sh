#!/usr/bin/env bash
# Create an isolated git worktree off the WORKSPACE (~/github/ctrl-b, main) — for a SECOND simultaneous
# agent, a HOTFIX cut from a release tag, or any checkout that isn't main-moving-forward. Run ON emma.
#
# WHY: the workspace never leaves `main` (D32, amended 2026-07-09) — the dev instance live-serves it, so a
# checkout there flips the running app + tangles agent WIP. Every other ref gets a throwaway worktree:
# SIBLING dirs sharing the workspace's .git (cheap — no re-clone). git refuses the same branch in two
# worktrees, so each worktree is its OWN branch. Day-to-day (one writer) you never need this.
#
# Usage:  add-dev-worktree.sh <name> [branch] [base]
#   add-dev-worktree.sh authfix               # → ~/github/ctrl-b-authfix, new branch feat/authfix off origin/main
#   add-dev-worktree.sh hotfix fix/v101 v1.0.0 # → hotfix worktree cut from the release tag (then: fix → tag
#                                              #   vX.Y.Z+1 → deploy → land the fix on main → remove worktree)
# Remove when done (push/merge the branch first — for a hotfix, VERIFY the fix is on main):
#   git -C ~/github/ctrl-b worktree remove ~/github/ctrl-b-<name>
set -euo pipefail

NAME="${1:?usage: add-dev-worktree.sh <name> [branch] [base]}"
BRANCH="${2:-feat/$NAME}"
WORK="$HOME/github/ctrl-b"
TREE="$HOME/github/ctrl-b-$NAME"

[ -d "$WORK/.git" ] || { echo "ERROR: workspace $WORK not found."; exit 1; }
[ -e "$TREE" ] && { echo "ERROR: $TREE already exists — pick another name or remove it first."; exit 1; }

git -C "$WORK" fetch origin --tags --quiet || true
# Base: an explicit ref (e.g. a release tag for a hotfix), else origin/main when available, else local main.
BASE="${3:-origin/main}"
git -C "$WORK" rev-parse --verify --quiet "$BASE" >/dev/null || BASE="main"
git -C "$WORK" worktree add -b "$BRANCH" "$TREE" "$BASE"

echo ""
echo "✓ Worktree ready: $TREE   (new branch '$BRANCH', off $BASE)"
echo "  Launch a second agent there:"
echo "      bash $TREE/tools/start-claude.sh $NAME $TREE"
echo "  When done (after pushing/merging '$BRANCH' — hotfix: verify the fix is on main):"
echo "      git -C $WORK worktree remove $TREE"
