# emma deploy — runbook

Deploy the **ctrl-b dashboard** as **two isolated instances** + the **Claude Code remote agent** onto
**emma** (Ubuntu 26.04, tailnet `emma` / `100.109.206.88`). Topology + rationale: **DECISIONS.md D32** and
`../../docs/DEPLOY_EMMA.md`.

## Topology (D32) — two fully isolated instances, one repo

| | **PROD** (daily driver) | **DEV** (sandbox) |
|---|---|---|
| Code tree | `~/github/ctrl-b` — clean, **sparse**, **tag-pinned** clone (only `dashboard_v2` + root files); pulls GitHub. **Never developed on.** | `~/github/ctrl-b-dev` — full tree on **`dev`**; where **ALL development happens** (1+ agents) |
| Data root | `~/.ctrl-b` (real config + db + memories/skills/agents) | `~/.ctrl-b-dev` (own copy; seeded from prod once) |
| Backend | `uvicorn :5433` serving built `dist` | `uvicorn :5434 --reload` |
| Frontend | built into `dist` | Vite `:5173` HMR → `/api` → `:5434` |
| Ingress | **Tailscale Serve HTTPS :443** (mic works) | `http://emma:5173` (HTTP, no mic) |
| Units | `ctrl-b-dashboard.service` | `ctrl-b-dashboard-dev.service` + `ctrl-b-dashboard-dev-web.service` |

Branches: **`main`** = always-deployable prod (untouched except by releases); **`dev`** = where development lives.
**Tags `vX.Y.Z`** mark releases — prod checks out a tag. **Promote** = merge `dev→main`, tag, push → prod
`git fetch --tags && checkout vX.Y && install.sh prod`.

**Who works where:** **no agent ever touches PROD** — the service runs it and the owner uses it daily. **All dev is
on the DEV side** — one or more agents on `dev`; a *second* agent (feature/audit) gets its **own** tree so it doesn't
disturb the dev instance: `git -C ~/github/ctrl-b-dev worktree add ~/github/ctrl-b-feat -b feat/x` then
`start-claude.sh feat ~/github/ctrl-b-feat`. There's no "main = one agent, dev = another" — main has no agent.

## Files (tidy layout)
```
deploy/emma/
├── README.md                 # this runbook
├── bootstrap.py              # Windows→emma orchestrator (the entry point you run)
├── systemd/                  # the user units (copied to ~/.config/systemd/user/ by install.sh)
│   ├── ctrl-b-dashboard.service          # PROD backend (:5433, ~/.ctrl-b)
│   ├── ctrl-b-dashboard-dev.service      # DEV backend (:5434 --reload, ~/.ctrl-b-dev)
│   └── ctrl-b-dashboard-dev-web.service  # DEV Vite (:5173 → :5434)
└── scripts/                  # the on-emma shell helpers
    ├── install.sh            # [prod|dev] — build + enable ONE instance from the tree it's in
    ├── serve-https.sh        # Tailscale Serve HTTPS :443 → :5433 (prod)
    ├── start-claude.sh       # [session] [dir] — claude --remote-control in tmux (DEV-side only)
    ├── migrate-layout.sh     # ONE-TIME, coordinated legacy→two-tree conversion
    └── add-dev-worktree.sh   # <name> [branch] — sibling worktree for a SECOND parallel dev agent
```
`bootstrap.py` (orchestrator) + `README.md` stay at the top; units live in `systemd/`, shell helpers in `scripts/`.

## ⚠️ First time only: the layout migration (coordinated with the agent)
emma currently has ONE full checkout at `~/github/ctrl-b` (the tandem agent's). Convert it ONCE to the
two-tree layout — **stop the agent first** (the script refuses while the tmux session runs):
```bash
tmux kill-session -t ctrl-b 2>/dev/null            # stop/detach the agent (coordinate!)
cd ~/github/ctrl-b && git pull --ff-only           # make sure work is pushed
bash dashboard_v2/deploy/emma/scripts/migrate-layout.sh   # → ~/github/ctrl-b-dev (dev) + clean sparse ~/github/ctrl-b
```
`bootstrap.py` detects the un-migrated state and points you here; it never moves the agent's tree itself.

## Deploy — two paths

### A) Automated, one command from the Windows checkout (recommended)
```bash
# from C:\Users\rovax\Documents\github\ctrl-b\dashboard_v2  (Bash tool needs dangerouslyDisableSandbox for LAN)
backend/.venv/Scripts/python.exe deploy/emma/bootstrap.py --dry-run     # preview the plan
backend/.venv/Scripts/python.exe deploy/emma/bootstrap.py               # prod: prereqs→config→prod-tree→install→https
backend/.venv/Scripts/python.exe deploy/emma/bootstrap.py --with-dev    # also stand up the isolated DEV instance
backend/.venv/Scripts/python.exe deploy/emma/bootstrap.py --start-agent # also start the Claude agent (tmux, dev tree)
#   --no-prereqs  skip sudo (you ran them)   --no-serve  skip Tailscale Serve
```
Reads SSH creds from `config.yaml`; never prints the password; idempotent; writes only without `--dry-run`.
If the prod tree isn't migrated yet, it stops with the migrate-layout step above.

### B) Manual, on emma (after the one-time migration)
```bash
sudo apt install -y tmux && sudo tailscale set --operator="$USER"          # prereqs
scp dashboard_v2/config.yaml emma:~/.ctrl-b/config.yaml                    # the secret (from Windows)
cd ~/github/ctrl-b/dashboard_v2     && CTRLB_HOME=~/.ctrl-b     bash deploy/emma/scripts/install.sh prod
bash deploy/emma/scripts/serve-https.sh                                    # HTTPS on the tailnet
cd ~/github/ctrl-b-dev/dashboard_v2 && CTRLB_HOME=~/.ctrl-b-dev bash deploy/emma/scripts/install.sh dev   # optional sandbox
```

## After install
```bash
systemctl --user status ctrl-b-dashboard          # prod: active (running)
curl -s localhost:5433/api/health                 # {"status":"ok",...}
# dev (optional):
systemctl --user status ctrl-b-dashboard-dev ctrl-b-dashboard-dev-web
curl -s localhost:5434/api/health                 # dev backend
bash ~/github/ctrl-b-dev/dashboard_v2/deploy/emma/scripts/start-claude.sh   # the agent → tmux attach -t ctrl-b
```

## Update later
```bash
# PROD — promote a release (run from the dev tree, which has write):
cd ~/github/ctrl-b-dev && git checkout main && git merge --ff-only dev && git tag -a vX.Y.Z -m "..." && git push --tags origin main
# then update the prod tree + restart:
cd ~/github/ctrl-b && git fetch --tags && git checkout vX.Y.Z && cd dashboard_v2 && bash deploy/emma/scripts/install.sh prod
systemctl --user restart ctrl-b-dashboard
# DEV — just pull on dev; the backend --reloads and Vite hot-reloads:
cd ~/github/ctrl-b-dev && git pull --ff-only
```

## ⚠️ Cautions
- Both instances can **shut down / reboot fleet hosts** (DEV seeds prod's fleet config). Do NOT trigger
  shutdown/reboot actions while testing — DEV is isolated for *data*, not for the real machines it controls.
- Don't modify emma's system/MCP config beyond the prereqs. Bind both backends to **127.0.0.1**.
- `~/github/ctrl-b-dev` is the **DEV side** — where the agent(s) develop; coordinate before moving/migrating it
  (the agents' working state lives there). **PROD is never developed on** — no agent, no commits; the prod sparse
  clone only ever checks out released tags. One canonical GitHub `main`.
- `config.yaml` holds SSH/API secrets — 0600, never commit it, never echo it.

## Rollback / stop
```bash
systemctl --user disable --now ctrl-b-dashboard ctrl-b-dashboard-dev ctrl-b-dashboard-dev-web
tailscale serve --https=443 off        # remove the HTTPS proxy
tmux kill-session -t ctrl-b            # stop the agent
# prod rollback to a previous release:  cd ~/github/ctrl-b && git checkout v(prev) && install.sh prod && restart
```
