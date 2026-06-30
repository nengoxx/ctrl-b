# emma deploy — runbook

Deploy the **ctrl-b dashboard** as **two isolated instances** + the **Claude Code remote agent** onto
**emma** (Ubuntu 26.04, tailnet `emma` / `100.109.206.88`). Topology + rationale: **DECISIONS.md D32** and
`../../docs/DEPLOY_EMMA.md`.

## Topology (D32) — two fully isolated instances, one repo

| | **PROD** (daily driver) | **DEV** (sandbox) |
|---|---|---|
| Code tree | `~/github/ctrl-b` — clean, **sparse**, **tag-pinned** clone (only `backend`+`frontend`+`deploy` + root files); pulls GitHub. **Never developed on.** | `~/github/ctrl-b-dev` — full tree on **`dev`**; where **ALL development happens** (1+ agents) |
| Data root | `~/.ctrl-b` (real config + db + memories/skills/agents) | `~/.ctrl-b-dev` (own copy; seeded from prod once) |
| Backend | `uvicorn :5433` serving built `dist` | `uvicorn :5434 --reload` |
| Frontend | built into `dist` | Vite `:5173` HMR → `/api` → `:5434` |
| Ingress | **Tailscale Serve HTTPS :443** (mic works) | `http://emma:5173` (HTTP, no mic) |
| Units | `ctrl-b-dashboard.service` | `ctrl-b-dashboard-dev.service` + `ctrl-b-dashboard-dev-web.service` |

Branches: **`main`** = always-deployable prod (untouched except by releases); **`dev`** = where development lives.
**Tags `vX.Y.Z`** mark releases — prod checks out a tag. **Promote** = merge `dev→main`, tag, push → prod
`git fetch --tags && checkout vX.Y && install.sh prod`.

**Who works where:** **no agent ever touches PROD** — the service runs it and the owner uses it daily. **All dev is
on the DEV side** — one or more agents share the one dev tree, **one writer at a time** (the other reads/audits).
For a *second simultaneous writer*, give it its **own** branch + sibling worktree via `tools/add-dev-worktree.sh`
(below) so it doesn't disturb the dev instance. There's no "main = one agent, dev = another" — main has no agent.

## Files (tidy layout)
```
deploy/
├── bootstrap.py              # Windows→emma orchestrator (the entry point you run)
├── README.md                 # "pick a target" overview (linux / windows / manual)
├── linux/                    # this Linux/systemd kit
│   ├── README.md             # this runbook
│   ├── install.sh            # [prod|dev] — build + enable ONE instance from the tree it's in
│   ├── serve-https.sh        # Tailscale Serve HTTPS :443 → :5433 (prod)
│   ├── migrate-layout.sh     # ONE-TIME, coordinated legacy→two-tree conversion
│   └── systemd/              # the user units (copied to ~/.config/systemd/user/ by install.sh)
│       ├── ctrl-b-dashboard.service          # PROD backend (:5433, ~/.ctrl-b)
│       ├── ctrl-b-dashboard-dev.service      # DEV backend (:5434 --reload, ~/.ctrl-b-dev)
│       └── ctrl-b-dashboard-dev-web.service  # DEV Vite (:5173 → :5434)
└── windows/                  # the double-click Windows kit (setup/start/autostart)

../tools/                     # dev launchers (NOT deploy): start-claude.{sh,ps1,cmd}, add-dev-worktree.sh
```
`bootstrap.py` (orchestrator) is at `deploy/`; the Linux install/serve/migrate helpers + `systemd/` units are flat in `deploy/linux/`. The Claude-agent launchers live in repo-root `tools/`.

## ⚠️ First time only: the layout migration (coordinated with the agent)
emma currently has ONE full checkout at `~/github/ctrl-b` (the tandem agent's). Convert it ONCE to the
two-tree layout — **stop the agent first** (the script refuses while the tmux session runs):
```bash
tmux kill-session -t ctrl-b 2>/dev/null            # stop/detach the agent (coordinate!)
cd ~/github/ctrl-b && git pull --ff-only           # make sure work is pushed
bash deploy/linux/migrate-layout.sh   # → ~/github/ctrl-b-dev (dev) + clean sparse ~/github/ctrl-b
```
`bootstrap.py` detects the un-migrated state and points you here; it never moves the agent's tree itself.

## Deploy — two paths

### A) Automated, one command from the Windows checkout (recommended)
```bash
# from C:\Users\rovax\Documents\github\ctrl-b  (Bash tool needs dangerouslyDisableSandbox for LAN)
backend/.venv/Scripts/python.exe deploy/bootstrap.py --dry-run     # preview the plan
backend/.venv/Scripts/python.exe deploy/bootstrap.py               # prod: prereqs→config→prod-tree→install→https
backend/.venv/Scripts/python.exe deploy/bootstrap.py --with-dev    # also stand up the isolated DEV instance
backend/.venv/Scripts/python.exe deploy/bootstrap.py --start-agent # also start the Claude agent (tmux, dev tree)
#   --no-prereqs  skip sudo (you ran them)   --no-serve  skip Tailscale Serve
```
Reads SSH creds from `config.yaml`; never prints the password; idempotent; writes only without `--dry-run`.
If the prod tree isn't migrated yet, it stops with the migrate-layout step above.

### B) Manual, on emma (after the one-time migration)
```bash
sudo apt install -y tmux && sudo tailscale set --operator="$USER"          # prereqs
scp config.yaml emma:~/.ctrl-b/config.yaml                    # the secret (from Windows)
cd ~/github/ctrl-b     && CTRLB_HOME=~/.ctrl-b     bash deploy/linux/install.sh prod
bash deploy/linux/serve-https.sh                                    # HTTPS on the tailnet
cd ~/github/ctrl-b-dev && CTRLB_HOME=~/.ctrl-b-dev bash deploy/linux/install.sh dev   # optional sandbox
```

## After install
```bash
systemctl --user status ctrl-b-dashboard          # prod: active (running)
curl -s localhost:5433/api/health                 # {"status":"ok",...}
# dev (optional):
systemctl --user status ctrl-b-dashboard-dev ctrl-b-dashboard-dev-web
curl -s localhost:5434/api/health                 # dev backend
bash ~/github/ctrl-b-dev/tools/start-claude.sh   # the agent → tmux attach -t ctrl-b
```

## Update later
```bash
# PROD — promote a release (run from the dev tree, which has write):
cd ~/github/ctrl-b-dev && git checkout main && git merge --ff-only dev && git tag -a vX.Y.Z -m "..." && git push --tags origin main
# then update the prod tree + restart:
cd ~/github/ctrl-b && git fetch --tags && git checkout vX.Y.Z && bash deploy/linux/install.sh prod
systemctl --user restart ctrl-b-dashboard
# DEV — just pull on dev; the backend --reloads and Vite hot-reloads:
cd ~/github/ctrl-b-dev && git pull --ff-only
```

## Fresh machine vs. emma (the installer handles both)
The scripts are **portable** — every path resolves against the target user's `$HOME` and the systemd units are
**templates** (`__REPO__`/`__CTRLB_HOME__`/`__NPM__`) that `install.sh` renders to real paths, so this works for
any user/host, not just `emma`.
- **emma (folder already exists, legacy checkout):** run the one-time `migrate-layout.sh` (above), then `bootstrap.py`.
- **clean Linux box (nothing checked out):** just run `bootstrap.py` — it learns the GitHub URL from this Windows
  checkout and **clones** the prod tree (and the dev tree with `--with-dev`); no migration needed.
- **Prereqs on a fresh box:** `bootstrap.py` step 0 installs `git`+`tmux`, enables linger, sets the tailscale
  operator (apt/Ubuntu). It does **not** install Python/Node (versions matter) — `install.sh` checks for
  `git` / `python3` ≥3.11 / `node` / `npm` and **fails loudly with the exact install hint** if any is missing.
  On a non-apt distro, install git+tmux yourself and pass `--no-prereqs`.

## If something fails (debug / finish manually)
Every step is **idempotent** — fix the cause and re-run `bootstrap.py`; completed steps no-op. On failure it prints
where it stopped + an actionable hint. To finish by hand on the box:
```bash
systemctl --user status ctrl-b-dashboard                 # is the prod service up?
journalctl --user -u ctrl-b-dashboard -n 50 --no-pager   # why did it fail to start?
curl -s localhost:5433/api/health                        # backend reachable?
cd ~/github/ctrl-b && CTRLB_HOME=~/.ctrl-b bash deploy/linux/install.sh prod   # re-run install
ls ~/.config/systemd/user/ctrl-b-dashboard.service       # was the unit rendered? (no __REPO__ placeholders)
```
Common causes: missing prereq (install.sh names it), `~/.ctrl-b/config.yaml` absent (SFTP/scp it), user-linger off
(`sudo loginctl enable-linger $USER`), or `tailscale serve` needing the operator (`sudo tailscale set --operator=$USER`).

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
