# Run ctrl-b dashboard (v2) on Windows

Quick local/daily-driver run on a Windows machine. It listens on **:5433**, so it **coexists** with the legacy
Flask app on **:5432** — no conflict. (This is the early, hand-built Windows path; the general multi-OS deploy
lands in the repo reorg — see `docs/REORG_PLAN.md`.)

## One-time setup
**Double-click `setup.cmd`** (or `start.cmd` will tell you if it's needed). It:
- creates the backend venv (`backend\.venv`, Python 3.14 preferred — any 3.11+ works),
- installs backend deps (`pip install -e backend`),
- installs frontend deps + builds the production bundle (`frontend\dist`).

Prereqs it checks for: **Node 20+** (`npm`) and **Python 3.11+** (ideally 3.14, with the `py` launcher). It
warns if `config.yaml` (fleet/integrations/secrets) is missing from the app root.

## Start it
| Command | What it does |
|---|---|
| **`start.cmd`** (double-click) | **PROD** — serves the built UI on `http://127.0.0.1:5433` |
| `start.cmd -Tailscale` | PROD **+** `tailscale serve` HTTPS on your tailnet (reach it from your phone; the **mic needs HTTPS**) |
| `start.cmd -Dev` | **DEV** — Vite hot-reload UI (`:5173`) in a new window + backend (`:5433`) |
| `start.cmd -Build` | force a fresh frontend build first |

Stop it with **Ctrl-C** in its window.

## Notes
- **Never `--reload` on Windows** (the scripts don't): the uvicorn reload worker breaks `asyncio` subprocesses,
  so fleet pings return empty and every host shows offline. Backend code changes need a manual restart; the
  **frontend** still hot-reloads via Vite in `-Dev`.
- Config + DB default to the **app root** (`config.yaml`, `ctrlb.db`) since `CTRLB_HOME` is unset on Windows.
- Paths are resolved relative to these scripts, so they keep working after the repo reorg.
