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
# Usage:  ./start-claude.sh [session] [project_dir] [model]   (also runs as ctrl-b-agent@{fable,opus} on boot)
#   ./start-claude.sh                            # default: session 'ctrl-b' in the workspace (~/github/ctrl-b, main)
#   ./start-claude.sh ctrl-b-opus ~/github/ctrl-b opus   # model: fable | opus | any full model id
#   ssh emma -t 'tmux attach -t ctrl-b-fable'    # attach; Ctrl-b d detaches
#   tmux kill-session -t '=ctrl-b-fable'         # stop one ('=' = exact match, since names share a prefix)
#   EFFORT=… ./start-claude.sh                   # env overrides (the agent units read ~/.config/ctrl-b/agent[-<i>].env)
# SECOND simultaneous agent — give it its OWN branch + worktree so it doesn't disturb the dev instance
# (which serves the workspace on main). Use tools/add-dev-worktree.sh, or by hand:
#   git -C ~/github/ctrl-b worktree add ~/github/ctrl-b-feat -b feat/x
#   ./start-claude.sh feat ~/github/ctrl-b-feat
# Prereq: tmux installed (sudo apt install -y tmux) and `claude` on PATH (already: ~/.local/bin/claude).
set -euo pipefail

SESSION="${1:-ctrl-b}"                              # tmux session + --remote-control channel name
PROJECT="${2:-$HOME/github/ctrl-b}"                 # a workspace-side tree (default: the workspace); never prod
MODEL="${3:-${MODEL:-opus}}"                        # positional > env > default; alias or full model id
EFFORT="${EFFORT:-high}"
PERM="${PERM:-bypassPermissions}"

# Friendly aliases. Opus (the DEFAULT + main model, owner 2026-07-24) tracks Claude Code's latest Opus
# alias; Fable remains pinned and available as an on-request second opinion. Full ids pass through.
case "$MODEL" in
  fable) MODEL="claude-fable-5" ;;
  opus)  MODEL="opus" ;;
esac

command -v tmux  >/dev/null || { echo "tmux not found — sudo apt install -y tmux"; exit 1; }
command -v claude >/dev/null || { echo "claude not found on PATH"; exit 1; }

# Exact-match ('=') targeting: session names like "ctrl-b (fable)" share the "ctrl-b" prefix, and
# tmux -t otherwise prefix-matches — a bare name could hit the wrong session.
if tmux has-session -t "=$SESSION" 2>/dev/null; then
  echo "Session '$SESSION' already running — attach with:  tmux attach -t '=$SESSION'"
  exit 0
fi

# Detached session; the inner loop keeps the agent alive across crashes. `exec bash` keeps the window open
# if the loop is ever broken so you can inspect, rather than the pane vanishing. The session name is
# escaped-quoted into the inner command (defensive — custom names may contain spaces). Two boot instances
# can race to start the shared tmux server — retry once so the loser of that race still comes up.
# NETWORK WAIT (post-reboot finding 2026-07-10): the --remote-control channel registers at claude STARTUP
# and claude does NOT exit when that fails — at boot the unit fires seconds before the network is up, so
# the session came up WITHOUT remote control (invisible in the claude app) and the crash-loop never
# retried. Wait for connectivity first (bounded ~60s; instant when the network is already up).
INNER="n=0; until curl -sI -m2 https://claude.ai >/dev/null 2>&1 || [ \$n -ge 30 ]; do n=\$((n+1)); sleep 2; done; \
 while true; do claude --remote-control \"$SESSION\" --permission-mode $PERM --model $MODEL --effort $EFFORT; \
 echo '[claude exited — restarting in 5s; Ctrl-C to stop]'; sleep 5; done; exec bash"
if ! tmux new-session -d -s "$SESSION" -c "$PROJECT" "$INNER" 2>/dev/null; then
  sleep 1
  tmux has-session -t "=$SESSION" 2>/dev/null || tmux new-session -d -s "$SESSION" -c "$PROJECT" "$INNER"
fi

echo "✓ Claude Code agent started in tmux session '$SESSION' (model $MODEL, effort $EFFORT)."
echo "  Attach:  tmux attach -t '=$SESSION'     Drive remotely: https://claude.ai/code"
