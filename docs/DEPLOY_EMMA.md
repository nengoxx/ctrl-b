# Deploy to emma (Linux) — planning + conversation record

> ## 🧭 PRE-FLIGHT (2026-07-01) — REVIEWED + READY · execute in a FRESH clean session · NOT yet run
> The v1.0 reorg shipped + verified (commit `7503fcf` on `main`; dual audit green). The whole deploy kit was
> re-reviewed end-to-end against the current tree. This block is the **execution handoff** — read it, do the PREP,
> then run the sequence. The planning record below is rationale; **DECISIONS D32 is authoritative** for topology.
>
> **✅ Verified ready (re-checked at `7503fcf`):** `deploy/bootstrap.py --dry-run` → exit 0 (resolves `emma@192.168.1.160:22`
> from the root `config.yaml`; emma entry has `os_type: linux` + ip + ssh_* + password). All deploy paths correct
> post-reorg: `WIN_CONFIG` → repo-root `config.yaml`; sparse-checkout → `set backend frontend deploy`; the 3 systemd units
> → `__REPO__/backend|frontend`; `install.sh`/`migrate-layout.sh` cross-refs → `tools/start-claude.sh` + `deploy/linux/`.
> Every shell script `bash -n` clean; both `.ps1` launchers parse. **History was NOT rewritten** → emma's existing clone
> **fast-forwards with a plain `git pull`** (no re-clone). App proven bootable from the new layout (pytest 229 · live
> API+SPA on :5433).
>
> **⚠ PREP — resolve these BEFORE running (gaps found in pre-flight):**
> 1. **No `dev` branch exists yet** — origin has only `main`. D32 needs `main`(prod) + `dev`(dev). **Create it from the
>    reorg'd main first:** `git checkout -b dev && git push -u origin dev && git checkout main`. Without `origin/dev`,
>    `migrate-layout.sh` creates a *local* `dev` from whatever emma's HEAD is → risks a **pre-reorg** dev tree.
> 2. **emma's checkout is pre-reorg** (recon @ `4f277b5`). On emma, BEFORE migrate: `cd ~/github/ctrl-b && git checkout
>    main && git pull --ff-only` (→ `7503fcf`), so the moved DEV tree carries the new layout — else `install.sh dev`
>    looks for `backend/` that isn't there yet.
> 3. **Tandem-agent coordination (mandatory).** `migrate-layout.sh` ABORTS if the tmux `ctrl-b` session runs OR the tree
>    has uncommitted changes. So (a) coordinate + stop the other agent (`tmux kill-session -t ctrl-b`), (b) ensure its
>    work is committed + pushed, (c) THEN migrate. Never lose its unpushed work.
> 4. **Reachability.** config → emma LAN `192.168.1.160` (Linux sshd; recon connected OK, but LAN can drift). Confirm
>    reachable at deploy time; if LAN is blocked, set emma's `ip` to MagicDNS `emma` / tailnet `100.109.206.88`
>    (`vpn_host` D3 field is not wired yet). The Bash tool needs **`dangerouslyDisableSandbox: true`** for LAN/SSH.
> 5. **Secret out-of-band.** `config.yaml` is gitignored; `bootstrap.py` SFTPs it from THIS Windows checkout →
>    `~/.ctrl-b/config.yaml` (0600). Keep the checkout's `config.yaml` current before deploying.
>
> **▶ EXACT SEQUENCE (fresh session; from the Windows checkout unless noted):**
> 0. **GATE + prep.** ⛔ **`backend/.venv/Scripts/python.exe tools/check.py --e2e` must be GREEN** — the full
>    gate PLUS the Playwright smoke/a11y suite (builds the real dist, boots preview, headless browser). Do NOT
>    deploy on red. Also run the SECURITY_MODEL.md safe-defaults checklist (bind 127.0.0.1 · debug off · Serve
>    HTTPS only · shell toggles intended · no secrets tracked). Then do gaps 1 (push `dev`), 3 (stop+drain the
>    tandem agent), 4 (confirm emma reachable).
> 1. `backend/.venv/Scripts/python.exe deploy/bootstrap.py --dry-run` — preview (must exit 0, no `dashboard_v2`).
> 2. **ON EMMA (one-time, agent-coordinated):** `cd ~/github/ctrl-b && git checkout main && git pull --ff-only` (gap 2),
>    then `bash deploy/linux/migrate-layout.sh` → moves the tree → `~/github/ctrl-b-dev` (`dev`) + fresh sparse prod at
>    `~/github/ctrl-b`.
> 3. `backend/.venv/Scripts/python.exe deploy/bootstrap.py` *(dangerouslyDisableSandbox)* → SFTP secret → ensure prod
>    tree → `install.sh prod` (native-3.14 venv + `npm run build` + enable service) → `serve-https`. Add **`--with-dev`**
>    for the isolated DEV instance, **`--start-agent`** for the tmux agent.
> 4. **Verify:** `ssh emma -t 'systemctl --user status ctrl-b-dashboard; curl -s localhost:5433/api/health'`; open
>    **`https://emma.lobster-vector.ts.net`** on the phone (mic-ready).
> 5. **Tag the release:** `git tag -a v1.0.0 -m "ctrl-b v1.0" && git push origin v1.0.0`; then pin prod:
>    on emma `cd ~/github/ctrl-b && git fetch --tags && git checkout v1.0.0 && bash deploy/linux/install.sh prod`.
>
> **Decisions to confirm at deploy:** `--with-dev` (stand up DEV now — recommended) · `--start-agent` (tmux agent now vs
> start manually later) · tag = `v1.0.0`.
>
> **Cautions:** do NOT shut down/reboot fleet hosts while testing (ping/status only); do NOT modify emma's system/MCP
> config beyond the deploy; the Windows `--reload` gotcha does NOT apply on emma; the second agent's checkout is
> read-only to you (never commit there); review the SECURITY subset (debug-off, shell-off-by-default, secrets-masked,
> stale-confirm-token recovery, OpenAPI hardening) **as part of** exposing over Tailscale. After deploy, dev sessions
> run ON emma (Linux) — keep everything OS-agnostic.
>
> ---

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
`tools/start-claude.sh` (tmux agent, **dev tree** — now in repo-root `tools/`, not `deploy/`) · `migrate-layout.sh` (one-time legacy→two-tree conversion) ·
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
- **The Claude Code launcher today** (`tools/start-claude.ps1`, Windows; the Linux twin is `tools/start-claude.sh`): `claude --remote-control ctrl-b
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
