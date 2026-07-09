# Deploy to emma (Linux) — planning + conversation record

> ## 🧭 PRE-FLIGHT (updated 2026-07-09 for the D32 AMENDMENT) — READY · execute in a FRESH clean session · NOT yet run
> **Topology changed before first deploy (DECISIONS D32, amended 2026-07-09 — authoritative):** trunk-based
> (**`main` + immutable tags, NO `dev` branch**) and a workspace/runtime split — PROD runtime at
> **`~/apps/ctrl-b`** (fresh sparse clone), workspace stays **`~/github/ctrl-b`** (emma's existing checkout,
> pinned to `main` forever). **`migrate-layout.sh` is deleted — NOTHING on emma moves.** Runbook:
> `deploy/linux/README.md`. *(Everything below this block, including the old two-branch narrative, is the
> historical planning record — path/branch mentions there predate the amendment.)*
>
> **⚠ PREP — resolve these BEFORE running (updated after the 2026-07-09 read-only re-recon):**
> 1. **OWNER deletes the emma scratchpad (owner-confirmed 2026-07-09):** `~/github/ctrl-b` there is a
>    disposable pre-reorg scratchpad (incl. the local `feat/design-system-lab-interactive` branch — owner
>    ruled it deletable) and `~/.claude/projects/C--Users-rovax-Documents-github-ctrl-b` is a hand-copied
>    memory snapshot (made to show the Hermes agent) — **both get `rm -rf`'d by the owner**. The workspace
>    then arrives as a FRESH clone via `bootstrap.py --with-dev` (cleaner than fast-forwarding the old tree).
> 2. **Reachability.** config → emma LAN `192.168.1.160` (re-verified 2026-07-09; LAN can drift). If blocked,
>    set emma's `ip` to MagicDNS `emma` / tailnet `100.109.206.88` (the `vpn_host` field, ROADMAP D3, is not
>    wired yet). The Bash tool needs **`dangerouslyDisableSandbox: true`** for LAN/SSH.
> 3. **Secret out-of-band (first deploy).** `config.yaml` is gitignored; `bootstrap.py` SFTPs it from THIS
>    checkout → `~/.ctrl-b/config.yaml` (0600). Keep it current before deploying. **After** first deploy the
>    target's copy is canonical — re-runs skip it (force = `--overwrite-config`, backs up first).
> 4. **Data: fresh start (DECIDED, owner 2026-07-09):** the Windows `ctrlb.db` (dev-era chat/memory) is
>    NOT migrated — emma prod begins with an empty DB.
> 5. **Leave emma's other services alone.** The box runs the owner's open-webui/searxng/speaches/
>    open-terminal/openclaw user units and a tmux session `fable` (a Hermes-agent task in `~` —
>    UNRELATED to ctrl-b, keeps running). Our kit only ever touches `ctrl-b*` units + the `ctrl-b` tmux session.
>    *(Environment re-verified 2026-07-09: claude CLI 2.1.205 logged in · tmux 3.6 · python 3.14.4 +
>    python3-venv OK · node 24.16 at /usr/bin · linger on · ports 5433/5434/5173/443 free · sqlite3 absent —
>    installed by bootstrap step 0.)*
>
> **▶ EXACT SEQUENCE (fresh session; from the Windows checkout unless noted):**
> 0. **GATE.** ⛔ **`backend/.venv/Scripts/python.exe tools/check.py --e2e` must be GREEN** — the full gate
>    PLUS the Playwright smoke/a11y suite. Do NOT deploy on red. *(Prereqs: browsers installed once via
>    `npx playwright install` from `frontend/`; nothing stale on :4173 — `reuseExistingServer` would reuse an
>    old build. See QUALITY.md "e2e gate".)* Also run the SECURITY_MODEL.md safe-defaults checklist (bind
>    127.0.0.1 · debug off · Serve HTTPS only · shell toggles intended · no secrets tracked). Then PREP 1 + 2.
> 1. **Tag the release FIRST:** `git tag -a v1.0.0 <sha> -m "ctrl-b v1.0"` on the gated sha, `git push origin
>    v1.0.0` → the CI **release gate** runs (full gate + e2e on Linux; must be green). Tag-first means the
>    fresh prod clone pins straight to `v1.0.0` — no transitional "prod on main" state.
> 2. `backend/.venv/Scripts/python.exe deploy/bootstrap.py --dry-run` — preview (must exit 0).
> 3. `backend/.venv/Scripts/python.exe deploy/bootstrap.py --with-dev --claude-env` *(dangerouslyDisableSandbox)*
>    → prereqs → SFTP secret → clone sparse prod at `~/apps/ctrl-b` (pins to `v1.0.0`) → `install.sh prod`
>    (native-3.14 venv + aside-built dist + DB snapshot + service) → `serve-https` → fresh workspace clone +
>    `install.sh dev` (dev instance **+ the always-on `ctrl-b-agent` service** — tmux Claude agent, boots with
>    the box) → **claude-env** (memory → `~/.claude/projects/-home-emma-github-ctrl-b/memory` + settings merge).
> 4. **Verify:** `ssh emma -t 'systemctl --user status ctrl-b-dashboard ctrl-b-agent; curl -s
>    localhost:5433/api/health'`; open **`https://emma.lobster-vector.ts.net`** on the phone (mic-ready);
>    attach the agent (`tmux attach -t ctrl-b`) and confirm it recalls the migrated memory.
>
> **Decisions — ALL RULED (owner 2026-07-09):** `--with-dev` YES (development moves to emma) ·
> the agent = an always-on boot service (`ctrl-b-agent.service`, model default fable-5 high; switch via
> `~/.config/ctrl-b/agent.env` → `MODEL=opus`) · `--claude-env` YES (migrate the framework) · tag = `v1.0.0`.
>
> **Afterward — the standing procedures (runbook `deploy/linux/README.md`):** release = tag a soaked sha +
> push + re-pin prod · hotfix = worktree at the tag (`tools/add-dev-worktree.sh`), fix land-back on main is
> non-optional · rollback = previous tag (+ DB snapshot restore if migrations bit) · expand/contract compat
> policy for DB + config (D32 amendment).
>
> **Cautions:** do NOT shut down/reboot fleet hosts while testing (ping/status only); do NOT modify emma's
> system/MCP config beyond the deploy; the Windows `--reload` gotcha does NOT apply on emma; review the
> SECURITY subset (debug-off, shell-off-by-default, secrets-masked, stale-confirm-token recovery, OpenAPI
> hardening) **as part of** exposing over Tailscale. After deploy, dev sessions run ON emma (Linux) — keep
> everything OS-agnostic; the workspace never leaves `main`.
>
> ---

> **Status (historical, 2026-06-29): ✅ DECISIONS MADE · ✅ RECON DONE · ✅ ARTIFACTS READY.**
> ⚠️ *Superseded on the branch model + paths by the **D32 amendment (2026-07-09)** — see the PRE-FLIGHT block
> above. No `dev` branch, no layout migration (`migrate-layout.sh` deleted); prod runtime = `~/apps/ctrl-b`,
> workspace = `~/github/ctrl-b` on `main`.* The runbook is **[`../deploy/linux/README.md`](../deploy/linux/README.md)**.
>
> **Topology in one line (amended):** PROD `~/apps/ctrl-b` (sparse, tag-pinned) → `~/.ctrl-b` → uvicorn :5433 +
> Serve HTTPS; DEV = the workspace `~/github/ctrl-b` (`main`) → `~/.ctrl-b-dev` → uvicorn :5434 + Vite :5173.
> Fully isolated data; dev experiments never touch the daily driver. The earlier single-tree/shared-backend
> sketch below is SUPERSEDED.

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
`tools/start-claude.sh` (tmux agent, **workspace** — in repo-root `tools/`, not `deploy/`) ·
`bootstrap.py` (local checkout→emma: SFTP secret → ensure prod tree → install → serve; `--with-dev`/`--claude-env`) ·
`README.md` (the runbook). *(`migrate-layout.sh` existed here pre-amendment; deleted 2026-07-09 — nothing moves.)*

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
(Bash tool needs `dangerouslyDisableSandbox: true` for LAN. Idempotent — safe to re-run; re-runs never clobber
the target's live `config.yaml` — see `--overwrite-config`. Prod is cloned fresh at `~/apps/ctrl-b`; nothing
on emma is moved.)

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
