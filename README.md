# ctrl-b

Easy control over your fleet. A **single-user homelab control panel** for waking, monitoring, and
managing a personal fleet of PCs over LAN + Tailscale, with a text/voice **LLM agent** that drives
**typed, allowlisted actions** instead of raw shell.

![Demo](./assets/demo.gif)

> **v1.0** — a ground-up rewrite (React + TypeScript + Vite PWA · FastAPI + Uvicorn backend). The
> earlier hand-built Flask dashboard is archived under [`archive/v0.1-flask/`](./archive/v0.1-flask/).
> *(Internal dev docs call this rewrite "v2"/"dashboard_v2" — that's the development name for what
> ships here as ctrl-b v1.0.)*

## What it is

- **Frontend** — a mobile-first, installable **PWA** (React + TS + Vite) porting the **Vapor** design
  ([`design/prototypes/variations/vapor.html`](./design/prototypes/variations/vapor.html)): 4 tabs
  (Fleet / Agent / Utils / Conf), per-host services, swappable themes, a shared chat composer with
  push-to-talk mic + auto-TTS. Widens gracefully to desktop.
- **Backend** — a **FastAPI + Uvicorn** service exposing a typed JSON API + SSE streaming (`paramiko`,
  `wakeonlan`, `openai`, …). Serves the built frontend on **:5433**.
- **Agent** — OpenAI-compatible chat (cloud, e.g. OpenRouter, **or** local `llama.cpp`) with
  tool-calling wired to the typed-action registry; voice via OpenAI-compatible **STT**/**TTS**.
- **Persistence** — **SQLite** (`ctrlb.db`) for chat / memory / events; **YAML** (`config.yaml`) for
  human-editable config, round-tripped by the Conf tab.
- **Security** — Tailscale-only, single trusted user, **no public bind**. Typed actions are the
  primary execution path; raw shell is quarantined. See [`AGENTS.md`](./AGENTS.md) §6.

## Quickstart

Config is optional (built-in defaults apply): copy `config.example.yaml` → `config.yaml` and
`.env.example` → `.env` (both gitignored) to set hosts / endpoints / secrets. `ctrlb.db` is created
on first run.

**Windows (double-click):**
```
deploy\windows\setup.cmd     # once: backend venv (3.14) + deps + frontend build
deploy\windows\start.cmd     # PROD on http://127.0.0.1:5433   (-Dev / -Tailscale / -Build)
```

**Linux/macOS (manual, no systemd):**
```bash
deploy/linux/run.sh prod     # build + uvicorn :5433 serving the dist
deploy/linux/run.sh dev      # uvicorn :5433 (--reload) + Vite :5173 HMR
```

**Linux server (systemd, always-on + HTTPS):** from a Windows checkout, `python deploy/bootstrap.py`
sets up the two-instance topology over SSH. Full runbook: [`deploy/linux/README.md`](./deploy/linux/README.md).

**From source, by hand:**
```bash
cd backend && python3 -m venv .venv && .venv/bin/pip install -e .   # Windows: .venv\Scripts\python.exe
cd ../frontend && npm install
# backend (Windows: do NOT pass --reload — see note), then frontend:
.venv/bin/uvicorn app.main:app --port 5433        # http://127.0.0.1:5433
npm run dev                                        # http://localhost:5173 (proxies /api → 5433)
```

> **Windows + `--reload` gotcha.** Don't run the backend with `--reload` on Windows — uvicorn's reload
> worker uses an event loop that breaks `asyncio.create_subprocess_exec`, so `fleet.ping_host` returns
> empty and every host shows offline. Linux/macOS are unaffected.

## Layout

```
backend/    FastAPI + Uvicorn service (the typed-action registry, agent loop, SSE API)
frontend/   React + TS + Vite PWA (the Vapor UI)
docs/       architecture, decisions, handoff, design — START at docs/HANDOFF.md
deploy/     bootstrap.py + linux/ (systemd) + windows/ (double-click)
tools/      dev launchers (Claude Code agent, dev worktrees)
design/     source design prototypes + the Vapor visual spec (reference only)
agents/  skills/   bundled agent definitions + skills
archive/    v0.1 Flask (v0.1-flask), the dead inference helpers, and earlier UI prototypes
```

**Contributing / agents:** read [`AGENTS.md`](./AGENTS.md) (canonical guide) and
[`docs/HANDOFF.md`](./docs/HANDOFF.md) (living status + next steps).
