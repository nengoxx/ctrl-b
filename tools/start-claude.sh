#!/usr/bin/env bash
# Claude Code remote agent on emma — the Linux equivalent of start_claude_remote.ps1.
#
# WHY tmux: `claude --remote-control` REQUIRES a TTY (it cannot be a bare systemd/daemon process — verified:
# github.com/anthropics/claude-code/issues/29479, #30447). tmux gives it a persistent TTY you attach to from
# phone / Windows over SSH, while the --remote-control channel also drives it from claude.ai/code. The
# `while true … sleep 5` loop restarts the agent on crash / auth-timeout / network blip.
#
# ALL development happens in the WORKSPACE (~/github/ctrl-b, pinned to `main` — the only branch). PROD
# (~/apps/ctrl-b) is NEVER worked on by any agent: it's a clean sparse tag-pinned clone the systemd service
# just runs + the owner uses daily (D32, amended 2026-07-09). This script only ever launches an agent in a
# workspace-side tree.
#
# Usage:  ./start-claude.sh [session] [project_dir] [model]     (also runs as ctrl-b-agent.service on boot)
#   ./start-claude.sh                            # default: session 'ctrl-b' in the workspace (~/github/ctrl-b, main)
#   ./start-claude.sh ctrl-b ~/github/ctrl-b opus   # pick the model: fable | opus | any full model id
#   ssh emma -t 'tmux attach -t ctrl-b'          # attach from anywhere (phone / Windows); Ctrl-b d to detach
#   tmux kill-session -t ctrl-b                  # stop it
#   MODEL=… EFFORT=… ./start-claude.sh           # env overrides (the agent service reads ~/.config/ctrl-b/agent.env)
# SECOND simultaneous agent — give it its OWN branch + worktree so it doesn't disturb the dev instance
# (which serves the workspace on main). Use tools/add-dev-worktree.sh, or by hand:
#   git -C ~/github/ctrl-b worktree add ~/github/ctrl-b-feat -b feat/x
#   ./start-claude.sh feat ~/github/ctrl-b-feat
# Prereq: tmux installed (sudo apt install -y tmux) and `claude` on PATH (already: ~/.local/bin/claude).
set -euo pipefail

SESSION="${1:-ctrl-b}"                              # tmux session + --remote-control channel name
PROJECT="${2:-$HOME/github/ctrl-b}"                 # a workspace-side tree (default: the workspace); never prod
MODEL="${3:-${MODEL:-fable}}"                       # positional > env > default; alias or full model id
EFFORT="${EFFORT:-high}"
PERM="${PERM:-bypassPermissions}"

# Friendly aliases (owner decision 2026-07-09: fable 5 or opus 4.8, both on high). Full ids pass through.
case "$MODEL" in
  fable) MODEL="claude-fable-5" ;;
  opus)  MODEL="claude-opus-4-8" ;;
esac

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
