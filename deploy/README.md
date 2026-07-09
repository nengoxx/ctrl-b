# deploy/ — run ctrl-b v1.0 on your target

Pick the target that matches where you're running the dashboard. Every path here resolves relative to
the repo root (`backend/` + `frontend/` + `config.yaml`), so these work from any clone location.

| Target | Use it when | Start here |
|---|---|---|
| **Linux (systemd)** | Always-on server on a tailnet/LAN box (the **emma** daily-driver model — two isolated instances + HTTPS). | [`linux/README.md`](./linux/README.md) — the full runbook. From Windows: `python deploy/bootstrap.py`. |
| **Windows (double-click)** | Run it on a Windows PC (e.g. corsair) without systemd. | [`windows/README.md`](./windows/README.md) — `setup.cmd` once, then `start.cmd`. |
| **Manual (no systemd)** | Quick foreground run on Linux/macOS without installing services. | `linux/run.sh prod` (build + uvicorn[+Serve]) · `linux/run.sh dev` (uvicorn + Vite). |

## Files
- **`bootstrap.py`** — the local-checkout→Linux SSH orchestrator (reads the target host from `config.yaml`,
  clones/updates the trees, runs `linux/install.sh`, sets up Tailscale Serve). The recommended Linux path.
- **`linux/`** — `install.sh` (systemd, `[prod|dev]`; prod adds the pre-cutover DB snapshot + dist swap),
  `run.sh` (manual), `serve-https.sh`, and `systemd/` unit templates. Topology + rationale:
  [`../docs/DEPLOY_EMMA.md`](../docs/DEPLOY_EMMA.md) + DECISIONS **D32 (amended 2026-07-09: trunk-based —
  prod runtime `~/apps/ctrl-b` tag-pinned; workspace `~/github/ctrl-b` on `main`)**.
- **`windows/`** — `setup.{ps1,cmd}`, `start.{ps1,cmd}` (PROD :5433; `-Dev`/`-Tailscale`/`-Build`), and
  `autostart-{enable,disable}.{ps1,cmd}` (run at logon via a Scheduled Task).

> Development launchers (Claude Code agent, dev worktrees) are **not** deployment — they live in repo-root
> [`../tools/`](../tools/) (`start-claude.{sh,ps1,cmd}`, `add-dev-worktree.sh`).
