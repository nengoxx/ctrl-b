# Deploy to emma (Linux) — planning + conversation record

> **Status: ✅ DECISIONS MADE · ✅ RECON DONE · ✅ ARTIFACTS READY (2026-06-29).**
> **Authoritative topology: [DECISIONS.md **D32**](./DECISIONS.md) — two fully isolated instances (PROD + DEV),
> one repo, `main`/`dev` branches + release **tags**, prod a clean **sparse** clone.** The runbook is
> **[`../deploy/linux/README.md`](../deploy/linux/README.md)**. Remaining: the **one-time, agent-coordinated layout
> migration** (`migrate-layout.sh`) then `bootstrap.py` (transfer `config.yaml` → ensure prod tree → `install.sh
> prod` → Tailscale Serve; `--with-dev` for the sandbox; `--start-agent` for the tmux agent).
>
> **Topology in one line:** PROD `~/github/ctrl-b` (sparse, tag-pinned) → `~/.ctrl-b` → uvicorn :5433 + Serve HTTPS;
> DEV `~/github/ctrl-b-dev` (`dev` branch) → `~/.ctrl-b-dev` → uvicorn :5434 + Vite :5173. Fully isolated data;
> dev experiments never touch the daily driver. The earlier single-tree/shared-backend sketch below is SUPERSEDED.

## ✅ Verified emma environment (read-only recon, 2026-06-29 — via paramiko + config.yaml creds)

| Fact | Value | Deploy impact |
|---|---|---|
| Address | tailnet **`emma`** / `100.109.206.88` (LAN `192.168.1.160`); `.138` was the OLD decommissioned box | use `.160` / MagicDNS `emma` |
| OS | Ubuntu 26.04 LTS, kernel 7.0, x86_64 · 16 cores · 30 GiB RAM · 392 GB free | ample |
| Backend venv | recon found a 3.11.15 venv, but the **deploy now targets native 3.14** — the whole stack ships cp314 wheels + the suite passes 229/229 on 3.14 (verified 2026-06-29) | `install.sh` builds with `python3` (3.14), rebuilds the old 3.11 venv |
| Node | v24.16 / npm 11.13 | fine |
| `claude` CLI | **installed** (2.1.177, `~/.local/bin/claude`) | agent ready |
| tmux | **NOT installed** | `sudo apt install -y tmux` (prereq) |
| systemd user-linger | **ON** | user services persist w/o login ✓ |
| Tailscale | up, 1.98.4 | `tailscale serve --bg --https=443 5433` |
| Repo | `/home/emma/github/ctrl-b`, clean on `main` @ `4f277b5`; **node_modules + dist present** | mostly prepped |
| **`config.yaml`** | **MISSING** (CTRLB_HOME default `~/.ctrl-b`) | **must transfer** (gitignored secret) |
| Ports | 5433 / 5173 / 443 **free**; 8888/9999/3003/9000 = emma's SearXNG/terminal/MCP/voice | no collision |

**Config path (from `config.py`):** `CTRLB_HOME` holds `config.yaml`+db+workspace; the code documents *"emma / new
installs set `CTRLB_HOME=~/.ctrl-b`"* → config at `/home/emma/.ctrl-b/config.yaml`; the systemd service sets that env.

**Artifacts (`deploy/linux/`) — D32 two-tree:** `install.sh [prod|dev]` (idempotent per-instance setup) ·
`ctrl-b-dashboard.service` (PROD backend :5433) · `ctrl-b-dashboard-dev.service` (DEV backend :5434, `--reload`) ·
`ctrl-b-dashboard-dev-web.service` (DEV Vite :5173 → :5434) · `serve-https.sh` (Tailscale Serve 443→5433) ·
`start-claude.sh` (tmux agent, **dev tree**) · `migrate-layout.sh` (one-time legacy→two-tree conversion) ·
`bootstrap.py` (Windows→emma: SFTP secret → ensure prod tree → install → serve; `--with-dev`/`--start-agent`) ·
`README.md` (the runbook).

## Execution plan + ownership — I can self-deploy END-TO-END (verified 2026-06-29)

**`bootstrap.py` from the Windows checkout does the WHOLE deploy in one command** — I run it; no owner steps needed.
Why this works: the Windows checkout has **both** the gitignored `config.yaml` *and* SSH access to emma, and **`emma`
has `sudo` via the SSH password** (verified — `emma` is in the `sudo` group; `sudo -S <pw>` → root, the same mechanism
the backend uses). So the orchestrator can also do the two root prereqs itself. The tandem agent on emma takes over
ongoing dev/audit afterward (coordination via `docs/agent_coordination/` + `external_audit/`).

**`bootstrap.py` steps (each flag-gated so any can be handed off):**
`0 prereqs (sudo: apt tmux + tailscale operator)` → `1 SFTP config.yaml → ~/.ctrl-b/ (0600)` →
`2 git pull --ff-only` → `3 install.sh (native-3.14 venv + pip install -e . + npm build + enable prod service)` →
`4 serve-https (Tailscale HTTPS 443→5433)`. The Claude agent (`start-claude.sh`, tmux) is a separate step (`--start-agent`
or run later) since it's the interactive runtime, not the dashboard.

**The command (I run it):**
```
backend/.venv/Scripts/python.exe deploy/bootstrap.py --dry-run     # preview the plan
backend/.venv/Scripts/python.exe deploy/bootstrap.py               # prod deploy (prereqs→config→prod-tree→install→https)
backend/.venv/Scripts/python.exe deploy/bootstrap.py --with-dev    # also stand up the isolated DEV instance
backend/.venv/Scripts/python.exe deploy/bootstrap.py --start-agent # also bring up the Claude agent in tmux (dev tree)
```
(Bash tool needs `dangerouslyDisableSandbox: true` for LAN. Idempotent — safe to re-run.) **First run only:** if the
prod tree hasn't been migrated yet, bootstrap stops and points at the one-time `migrate-layout.sh` (§ below).

**Options / who-runs-what (flexible):**
- **Me, fully (default, recommended):** `bootstrap.py` does 0–4 end-to-end; I verify health; I start the agent
  (`--start-agent`) when ready. This is the "deploy by yourself" path.
- **Me + owner does sudo:** you run `sudo apt install -y tmux` + `sudo tailscale set --operator=emma`, I run
  `bootstrap.py --no-prereqs`.
- **On-emma tandem agent runs it locally:** works too, but then the secret must reach emma first (I SFTP it, or you
  scp `config.yaml`), since that agent has no Windows access.

**After deploy:** dashboard at `https://emma.<tailnet>.ts.net` (mic-ready); optional always-on dev with
`systemctl --user enable --now ctrl-b-dashboard-dev.service` (→ `http://emma:5173`); attach the agent with
`ssh emma -t 'tmux attach -t ctrl-b'`. Backend is **native Python 3.14** (229/229 suite green on emma's 3.14).

## ✅ Decisions (owner, 2026-06-29)

1. **Dashboard mode: BOTH, always-on.** A **prod** instance (behind **Tailscale Serve**, HTTPS) to use, AND an
   **always-on dev** instance (hot-reload) to watch what we're changing. → two services, different ports.
2. **Tailscale: already up on emma.** Recon the tailnet name + emma's MagicDNS host/URL during the environment check.
3. **Claude Code agent: tmux + crash-restart `while true` loop, sessions managed MANUALLY** by the owner (start/attach
   by hand). Provide the launcher; auto-boot systemd unit optional (owner starts it manually).
4. **First deploy: I plan AND execute over SSH.** Secrets are copied from **this Windows checkout** (which has a
   ready `config.yaml`/`clients`) to emma's correct folder. SSH keys are configured here.
5. **Repo path on emma:** confirm during recon (owner guessed `~/git*/ctrl-b`).
6. **Two-agent coordination:** **`external_audit/`** is the audit drop folder; **`docs/agent_coordination/`** log
   approved (lightweight who's-doing-what). The other agent's checkout stays read-only to me; one canonical GitHub `main`.

## Goal

Run the project on **emma** — the Linux (Kubuntu / KDE) server on the LAN/tailnet, headless-by-habit (SSH only, no
remote desktop) — as a durable setup the owner reaches from **phone + a Windows SSH client**. Two distinct things:

1. **The dashboard** (the ctrl-b v1.0 app) — always-on so the owner can *see and use* it.
2. **The Claude Code remote agent** — so development + auditing continue *on the target machine* (a second agent also
   works there in tandem; see Coordination).

This subsumes TODO **Phase 9** (dashboard systemd unit + Linux install/run script + smoke tests) and adds the agent service.

## What the code already gives us (verified)

- **Prod serving is built in.** `backend/app/main.py` mounts the built `frontend/dist` (StaticFiles `/assets` +
  SPA `FileResponse` fallback), gated on the dist dir existing. So **prod = ONE uvicorn process on `5433` serving both
  the API and the SPA** (single origin, no CORS, no separate web server).
- **Dev is two processes.** uvicorn `5433` + Vite dev `5173` (Vite proxies `/api` → backend). Hot-reload.
- **The Windows `--reload` gotcha does NOT apply on Linux** — `uvicorn --reload` is safe on emma (the gotcha is a
  Windows event-loop/subprocess issue only). So a dev instance on emma can hot-reload.
- **The Claude Code launcher today** (`start_claude_remote.ps1`, Windows): `claude --remote-control ctrl-b
  --permission-mode bypassPermissions --model claude-opus-4-8 --effort high`. emma needs a **Linux equivalent**.

## Dev vs prod, explained (since frontend build/serve isn't obvious)

A Vite/React app is **built** (`npm run build`) into static files (`frontend/dist`). There are two ways to run it:

| | **Production** | **Development** |
|---|---|---|
| How | `npm run build` once → uvicorn serves `dist` on **5433** | uvicorn `5433` + `vite dev` on **5173** (proxies `/api`) |
| Processes | **one** (uvicorn) | two (uvicorn + vite) |
| See a code change | **rebuild** (`npm run build`) | **instant** (hot-reload) |
| Use for | *using* the dashboard (stable, fast, one port) | *iterating* on the dashboard (live edits) |

**Decided (D32, supersedes the "start simple" note):** run BOTH as **fully isolated** instances — PROD (built
`dist`, :5433, `~/.ctrl-b`, Serve HTTPS) AND a separate DEV stack (own backend `uvicorn --reload :5434` + Vite
:5173, `~/.ctrl-b-dev`). Separate data roots mean dev experiments — backend edits, config changes, chat — never
touch the daily driver. The earlier "dev = Vite-only proxying to the prod backend" idea is dropped (it shared
prod's backend + data → not isolated). Per-instance control via the three systemd user units.

## Recommended architecture (researched)

> ⚠️ **The single-`ctrl-b` diagram below is the EARLY sketch — superseded by D32 (two isolated instances).** The
> TTY/tmux reasoning still holds; only the dashboard side grew from one service to two trees + three units. The
> current, authoritative picture is in **D32** and `deploy/linux/README.md`:
> ```
> emma
> ├─ PROD: ~/github/ctrl-b (sparse, tag-pinned) → ~/.ctrl-b → uvicorn :5433 → Tailscale Serve HTTPS :443   [no agent]
> ├─ DEV : ~/github/ctrl-b-dev (dev branch)      → ~/.ctrl-b-dev → uvicorn :5434 --reload + Vite :5173
> └─ tmux "ctrl-b": claude --remote-control … IN THE DEV TREE (1+ agents; 2nd writer → its own worktree)
> ```

The split is forced by one fact: **Claude Code `--remote-control` requires a TTY** — it cannot be a bare
systemd/daemon process; the reliable headless pattern is **tmux/screen** (GitHub issues #29479, #30447; the
known-working stack is exactly *SSH-via-Tailscale → Linux → tmux → Claude Code*). The dashboard has no such constraint.

```
[EARLY SKETCH — superseded by D32; see the box above]
emma (Kubuntu, SSH-only)
├─ systemd: ctrl-b-dashboard.service     [Type=simple, Restart=on-failure, boot]
│     └─ uvicorn app.main:app --port 5433   (PROD: serves API + built SPA)
├─ Tailscale Serve  →  HTTPS in front of :5433   (mic needs a secure context)
└─ tmux session "ctrl-b"                  [the agent's TTY home]
      └─ while true; do claude --remote-control ctrl-b --permission-mode bypassPermissions \
                               --model claude-opus-4-8 --effort high; sleep 10; done
         ↳ attach from phone / Windows:  ssh emma -t 'tmux attach -t ctrl-b'
         ↳ or drive from the web/phone:  claude.ai/code  (the --remote-control channel)
```

- **Dashboard = real systemd daemon** (`Restart=on-failure`, `WantedBy=multi-user.target`, runs as the owner's user
  so it can SSH/ping/WOL the fleet). Starts on boot.
- **Claude Code = tmux session** with a `while true … sleep 10` crash-restart loop (survives crash/auth-timeout/blip).
  Started either (a) by a tiny `Type=forking` systemd unit that runs `tmux new-session -d -s ctrl-b '…'` so it comes
  up on boot, or (b) manually at login. ❓DECISION-3.
- **Multiplexer = tmux** (required by the TTY constraint; ubiquitous; trivial `tmux attach` from phone + Windows;
  proven for exactly this). zellij/screen are alternatives but tmux is the safe default. ❓DECISION-4.
- **Install/run script** (`deploy/linux/` — Linux): create venv + `pip install`, `npm ci && npm run build`, install +
  enable the systemd units. Plus the Tailscale Serve wiring.

## ✅ Decisions — ALL RESOLVED (see D32); kept as a record

1. **Dashboard mode** → BOTH, **fully isolated** (D32): PROD built-`dist` + a separate always-available DEV stack
   (own backend :5434 + Vite :5173, own `~/.ctrl-b-dev`). Not the earlier "PROD-only + dev-on-demand" nor a
   shared-backend dev.
2. **Tailscale** → up on emma; serves `https://emma.<tailnet>.ts.net` via Tailscale Serve → :5433 (mic-ready).
3. **Claude Code service** → tmux + `while true` crash-restart loop, **started manually** (`start-claude.sh`), in the
   **dev** tree. Kept the loop.
4. **Multiplexer** → tmux.
5. **First deploy** → I run it over SSH via `bootstrap.py` (the one-time `migrate-layout.sh` is agent-coordinated);
   the secret is SFTP'd from the Windows checkout to `~/.ctrl-b/config.yaml`.
6. **Repo location / checkouts** → two trees (D32): PROD `~/github/ctrl-b` (clean sparse, no agent) + DEV
   `~/github/ctrl-b-dev` (the agent(s) work here). Separate, not shared.

## Two-agent coordination (conversation point)

A second agent runs on emma (developing specific parts / auditing). To avoid stepping on each other:
- **Cross-agent comms via files** — the `external_audit/` folder is a natural drop for that agent's audits (it can
  auto-populate there; I triage them like I did the first audit). A short `docs/agent_coordination/` log (who's doing
  what, locks) could help if we touch overlapping areas. ❓DECISION (how formal?).
- **Boundaries:** the other agent's checkout is **read-only to me** unless told otherwise; I never commit into it.
  One canonical `main` on GitHub is the source of truth; both agents push there (coordinated), not into each other's trees.

## ⚠️ Operational cautions (every emma session)

- The dashboard can **shut down / reboot fleet hosts** (WOL/SSH/typed-actions). Do **NOT** shut down PCs while testing
  — use ping/status, not shutdown/reboot, unless explicitly intended.
- Do **NOT** modify emma's system config / MCP setup beyond what the deploy strictly needs.
- Don't run uvicorn with `--reload` for the PROD service (build once, serve static). Dev instances may `--reload`.
- Security: the audit's `SECURITY_MODEL.md` + safe-defaults (debug off, shell off-by-default, secrets masked) should
  be reviewed *as part of* exposing the dashboard over Tailscale (TRIAGE 🔵 → pulled forward).

## Sources
- Claude Code remote-control needs a TTY / tmux on headless Linux: https://github.com/anthropics/claude-code/issues/29479 · https://github.com/anthropics/claude-code/issues/30447
- systemd service + uvicorn (no `--reload` in prod): FastAPI/uvicorn deployment docs.
