# Deploy to emma (Linux) — planning + conversation record

> **Status: ✅ DECISIONS MADE · ✅ RECON DONE · ✅ ARTIFACTS READY (2026-06-29) — execute in the clean session.**
> The read-only recon of emma is complete; the deploy artifacts + runbook are written under **[`../deploy/emma/`](../deploy/emma/)**
> (start at its `README.md`). The only remaining step is **executing the bootstrap** (transfer `config.yaml` + run
> `install.sh` + Tailscale Serve + start the agent) — done in the clean session via `deploy/emma/bootstrap.py`.

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

**Artifacts (`deploy/emma/`):** `install.sh` (idempotent on-emma setup) · `ctrl-b-dashboard.service` (prod) ·
`ctrl-b-dashboard-dev.service` (dev/Vite) · `serve-https.sh` (Tailscale Serve) · `start-claude.sh` (tmux agent) ·
`bootstrap.py` (Windows→emma: SFTP secret + git pull + install) · `README.md` (the runbook).

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
backend/.venv/Scripts/python.exe deploy/emma/bootstrap.py --dry-run   # preview the plan
backend/.venv/Scripts/python.exe deploy/emma/bootstrap.py             # full deploy (prereqs→config→pull→install→https)
backend/.venv/Scripts/python.exe deploy/emma/bootstrap.py --start-agent   # also bring up the Claude agent in tmux
```
(Bash tool needs `dangerouslyDisableSandbox: true` for LAN. Idempotent — safe to re-run.)

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

1. **The dashboard** (`dashboard_v2`) — always-on so the owner can *see and use* it.
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

**Recommendation:** the always-on **systemd service runs PROD** (stable, one port, what you "use"); when actively
iterating, launch **dev** on-demand (a tmux window running `vite dev` + `uvicorn --reload`). Optionally a *second*
always-on dev service on different ports — but that's more moving parts; start simple. ❓DECISION-1 below.

## Recommended architecture (researched)

The split is forced by one fact: **Claude Code `--remote-control` requires a TTY** — it cannot be a bare
systemd/daemon process; the reliable headless pattern is **tmux/screen** (GitHub issues #29479, #30447; the
known-working stack is exactly *SSH-via-Tailscale → Linux → tmux → Claude Code*). The dashboard has no such constraint.

```
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
- **Install/run script** (`deploy/emma/` — Linux): create venv + `pip install`, `npm ci && npm run build`, install +
  enable the systemd units. Plus the Tailscale Serve wiring.

## ❓ Open decisions (need the owner)

1. **Dashboard mode for the always-on service:** PROD-only (rebuild to see changes) + dev on-demand *(recommended)*,
   or a second always-on DEV instance too (different ports)?
2. **Tailscale on emma:** is Tailscale already up on emma, and what hostname/port should the dashboard serve as
   (`https://emma.<tailnet>` via Tailscale Serve → :5433)? Mic/HTTPS depends on this.
3. **Claude Code service:** systemd-starts-the-tmux-session (boots automatically) vs you start it manually after SSH?
   And the crash-restart `while true` loop — keep it?
4. **Multiplexer:** tmux OK, or a preference (zellij/screen)?
5. **Who runs the first deploy** — me over SSH (you said the project + creds are in the repo; I can connect), the
   tandem agent, or you by hand the first time? And the **first-run config**: `config.yaml`/secrets are gitignored, so
   how do they reach emma (manual copy / scp / already present)?
6. **Repo location on emma:** confirm the path (you guessed `~/git*/ctrl-b`). My checkout vs the tandem agent's —
   should we share one checkout or keep separate ones?

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
