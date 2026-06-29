#!/usr/bin/env bash
# Claude Code remote agent on emma — the Linux equivalent of start_claude_remote.ps1.
#
# WHY tmux: `claude --remote-control` REQUIRES a TTY (it cannot be a bare systemd/daemon process — verified:
# github.com/anthropics/claude-code/issues/29479, #30447). tmux gives it a persistent TTY you attach to from
# phone / Windows over SSH, while the --remote-control channel also drives it from claude.ai/code. The
# `while true … sleep 5` loop restarts the agent on crash / auth-timeout / network blip.
#
# ALL development is on the DEV SIDE — one OR MORE agents. PROD (~/github/ctrl-b) is NEVER worked on by any
# agent: it's a clean sparse clone the systemd service just runs + the owner uses daily (D32). This script
# only ever launches an agent in a DEV-side tree.
#
# Usage (owner manages sessions MANUALLY):  ./start-claude.sh [session] [project_dir]
#   ./start-claude.sh                            # default: session 'ctrl-b' in the main DEV tree (~/github/ctrl-b-dev, `dev`)
#   ssh emma -t 'tmux attach -t ctrl-b'          # attach from anywhere (phone / Windows); Ctrl-b d to detach
#   tmux kill-session -t ctrl-b                  # stop it
#   MODEL=… EFFORT=… ./start-claude.sh           # override model/effort (env)
# SECOND agent (a feature or audit branch) — give it its OWN tree + session so it doesn't disturb the dev
# instance (which serves ~/github/ctrl-b-dev on `dev`). A git worktree off the dev repo is ideal:
#   git -C ~/github/ctrl-b-dev worktree add ~/github/ctrl-b-feat -b feat/x
#   ./start-claude.sh feat ~/github/ctrl-b-feat
# Prereq: tmux installed (sudo apt install -y tmux) and `claude` on PATH (already: ~/.local/bin/claude).
set -euo pipefail

SESSION="${1:-ctrl-b}"                              # tmux session + --remote-control channel name
PROJECT="${2:-/home/emma/github/ctrl-b-dev}"        # a DEV-side tree (default: the main dev tree); never prod
MODEL="${MODEL:-claude-opus-4-8}"
EFFORT="${EFFORT:-high}"
PERM="${PERM:-bypassPermissions}"

command -v tmux  >/dev/null || { echo "tmux not found — sudo apt install -y tmux"; exit 1; }
command -v claude >/dev/null || { echo "claude not found on PATH"; exit 1; }

if tmux has-session -t "$SESSION" 2>/dev/null; then
  echo "Session '$SESSION' already running — attach with:  tmux attach -t $SESSION"
  exit 0
fi

# Detached session; the inner loop keeps the agent alive across crashes. `exec bash` keeps the window open
# if the loop is ever broken so you can inspect, rather than the pane vanishing.
tmux new-session -d -s "$SESSION" -c "$PROJECT" \
  "while true; do claude --remote-control $SESSION --permission-mode $PERM --model $MODEL --effort $EFFORT; \
   echo '[claude exited — restarting in 5s; Ctrl-C to stop]'; sleep 5; done; exec bash"

echo "✓ Claude Code agent started in tmux session '$SESSION' (model $MODEL, effort $EFFORT)."
echo "  Attach:  tmux attach -t $SESSION     Drive remotely: https://claude.ai/code"
