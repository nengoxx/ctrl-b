#!/usr/bin/env bash
# Claude Code remote agent on emma — the Linux equivalent of start_claude_remote.ps1.
#
# WHY tmux: `claude --remote-control` REQUIRES a TTY (it cannot be a bare systemd/daemon process — verified:
# github.com/anthropics/claude-code/issues/29479, #30447). tmux gives it a persistent TTY you attach to from
# phone / Windows over SSH, while the --remote-control channel also drives it from claude.ai/code. The
# `while true … sleep 5` loop restarts the agent on crash / auth-timeout / network blip.
#
# Usage (owner manages sessions MANUALLY, per decision 3):
#   ./start-claude.sh                 # creates+detaches the tmux session 'ctrl-b' running the agent
#   ssh emma -t 'tmux attach -t ctrl-b'   # attach from anywhere (phone / Windows); Ctrl-b d to detach
#   tmux kill-session -t ctrl-b       # stop it
# Prereq: tmux installed (sudo apt install -y tmux) and `claude` on PATH (already: ~/.local/bin/claude).
set -euo pipefail

SESSION="ctrl-b"
PROJECT="/home/emma/github/ctrl-b"
MODEL="claude-opus-4-8"
EFFORT="high"
PERM="bypassPermissions"

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
