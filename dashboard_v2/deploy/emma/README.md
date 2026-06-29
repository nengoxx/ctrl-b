# emma deploy — runbook

Deploy the **ctrl-b dashboard** + the **Claude Code remote agent** onto **emma** (Ubuntu 26.04, tailnet
`emma` / `100.109.206.88`, repo `/home/emma/github/ctrl-b`). Design rationale + decisions: `../../docs/DEPLOY_EMMA.md`.

## What gets stood up
- **Prod dashboard** — `ctrl-b-dashboard.service` (systemd *user* service): uvicorn serves API + built `dist` on
  `127.0.0.1:5433`. Fronted by **Tailscale Serve** → `https://emma.<tailnet>.ts.net` (mic needs HTTPS).
- **Dev dashboard** (optional, always-on) — `ctrl-b-dashboard-dev.service`: Vite hot-reload on `:5173`
  (`http://emma:5173`), proxying `/api` → the prod backend. Watch latest frontend changes.
- **Claude agent** — `start-claude.sh`: `claude --remote-control` inside **tmux** (it needs a TTY), crash-restart loop.

## Verified emma facts (recon 2026-06-29)
Ubuntu 26.04 · 16 cores / 30 GiB · **deploy builds a native Python 3.14 venv** (whole stack ships cp314 wheels;
backend suite 229/229 green on emma's 3.14) · Node 24 / npm 11 · `claude` 2.1.177 installed · `emma` has sudo (SSH
pw) · user-linger ON · Tailscale up · repo present · **`config.yaml` NOT yet on emma** · ports 5433/5173/443 free.

## Prerequisites
**`bootstrap.py` now does the root prereqs itself** (`emma` has sudo via the SSH password). No manual root steps —
unless you prefer to run them yourself (then use `bootstrap.py --no-prereqs`):
```bash
sudo apt install -y tmux                 # the agent's TTY host
sudo tailscale set --operator="$USER"    # let the emma user run `tailscale serve` without sudo
```

## Deploy — two paths

### A) Automated, one command from the Windows checkout (recommended — the full self-deploy)
```bash
# from C:\Users\rovax\Documents\github\ctrl-b\dashboard_v2  (Bash tool needs dangerouslyDisableSandbox for LAN)
backend/.venv/Scripts/python.exe deploy/emma/bootstrap.py --dry-run     # preview the plan
backend/.venv/Scripts/python.exe deploy/emma/bootstrap.py               # prereqs→config→pull→install→https
backend/.venv/Scripts/python.exe deploy/emma/bootstrap.py --start-agent # also start the Claude agent (tmux)
#   --no-prereqs  skip sudo (you ran them)   --no-serve  skip Tailscale Serve
```
`bootstrap.py` runs: **(0)** sudo `apt install tmux` + `tailscale set --operator` · **(1)** SFTP `config.yaml` →
`~/.ctrl-b/config.yaml` (0600) · **(2)** `git pull --ff-only` · **(3)** `install.sh` (native-3.14 venv + `pip install
-e .` + `npm build` + enable the prod user service) · **(4)** `serve-https.sh`. Reads SSH creds from `config.yaml`;
never prints the password; idempotent (safe to re-run); makes writes only without `--dry-run`.

### B) Manual, on emma
```bash
sudo apt install -y tmux && sudo tailscale set --operator="$USER"     # prereqs
# put the secret on emma (from Windows):  scp dashboard_v2/config.yaml emma:~/.ctrl-b/config.yaml
cd ~/github/ctrl-b && git pull --ff-only
cd dashboard_v2 && CTRLB_HOME=~/.ctrl-b bash deploy/emma/install.sh
```

## After install
```bash
systemctl --user status ctrl-b-dashboard         # should be active (running)
curl -s localhost:5433/api/health                # {"status":"ok",...}
bash deploy/emma/serve-https.sh                  # HTTPS on the tailnet
systemctl --user enable --now ctrl-b-dashboard-dev.service   # optional always-on dev (http://emma:5173)
bash deploy/emma/start-claude.sh                 # the Claude agent in tmux  →  tmux attach -t ctrl-b
```

## Update later (after pushing new code)
```bash
cd ~/github/ctrl-b && git pull --ff-only
cd dashboard_v2 && bash deploy/emma/install.sh            # rebuilds dist + restarts is manual:
systemctl --user restart ctrl-b-dashboard                # pick up backend changes
# dev (vite) hot-reloads automatically; no restart needed for frontend.
```

## ⚠️ Cautions
- The dashboard can **shut down / reboot fleet hosts**. Do NOT trigger shutdown/reboot actions while testing.
- Don't modify emma's system/MCP config beyond the prereqs above. Bind prod to **127.0.0.1** (tailnet-only via Serve).
- The repo at `~/github/ctrl-b` is shared with the **tandem agent** — `git pull --ff-only` only; never commit there;
  one canonical GitHub `main`.
- `config.yaml` holds SSH/API secrets — keep it 0600, never commit it, never echo it.

## Rollback / stop
```bash
systemctl --user disable --now ctrl-b-dashboard ctrl-b-dashboard-dev
tailscale serve --https=443 off        # remove the HTTPS proxy
tmux kill-session -t ctrl-b            # stop the agent
```
