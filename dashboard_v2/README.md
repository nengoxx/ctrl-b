# ctrl-b · dashboard_v2

A ground-up rewrite of `ctrl-b` — a single-user homelab control panel for waking,
monitoring, and managing a personal fleet of PCs over LAN + Tailscale, with a text/voice
LLM agent that drives **typed, allowlisted actions** instead of raw shell.

This folder is **self-contained and authoritative** for v2. The rest of the repo
(`wol_server/`, `ws_claude*/`, `ws_codex*/`, `ctrl-b (Vapor)/`) is the old project and
earlier prototypes — kept for reference, not imported or modified. The live Flask server
(`wol_server/wol_server_win.py`) keeps running until v2 reaches cutover.

## What v2 is

- **Frontend:** a mobile-first, installable **PWA** (React + TypeScript + Vite) that ports
  the **Vapor** design (`ctrl-b (Vapor)/variations/vapor.html`) — 4 tabs (Fleet / Agent /
  Utils / Conf), per-host services, vaporwave themes, a shared chat composer with
  push-to-talk mic and an auto-TTS toggle. Widens gracefully to desktop.
- **Backend:** a **FastAPI + Uvicorn** service exposing a typed JSON API + SSE streaming.
  Reuses the proven Python glue (`paramiko`, `wakeonlan`, `openai`, `youtube-transcript-api`).
- **Agent:** OpenAI-compatible chat (cloud, e.g. OpenRouter, **or** your local `llama.cpp`
  `llama-server`) with tool-calling wired to the typed-action registry. Voice in via
  OpenAI-compatible **STT** (faster-whisper), voice out via OpenAI-compatible **TTS**
  (Kokoro-FastAPI / openedai-speech) — each a configurable base URL.
- **Persistence:** **SQLite** for chat threads / messages / memory + the event log;
  **YAML** for human-editable config (hosts, endpoints, keys), editable in the Conf tab.
- **Security model unchanged:** Tailscale-only, single trusted user, no public bind. v2
  *strengthens* it by making typed actions the primary path and quarantining raw shell.

## Status

🚧 **Phase 0 done — scaffold runs.** FastAPI skeleton (`/api/health`), config + SQLite,
and the React/TS/Vite PWA shell with the Vapor stylesheet lifted verbatim are in place and
verified (backend health + frontend build). Next: `docs/TODO.md` **Phase 1 — Fleet read path**.
New session? Read [`docs/HANDOFF.md`](docs/HANDOFF.md) first.

## Running (dev)

Two processes; Vite proxies `/api` → the backend (single origin, no CORS). The backend uses
port **5433** so it coexists with the live Flask app on 5432 until cutover.

```powershell
# backend  (from dashboard_v2/backend)
py -3.11 -m venv .venv
.venv\Scripts\python.exe -m pip install -e .
.venv\Scripts\python.exe -m uvicorn app.main:app --reload --port 5433

# frontend (from dashboard_v2/frontend) — new terminal
npm install
npm run dev          # http://localhost:5173  (or http://<host>:5173 on the tailnet)
```

Copy `config.example.yaml` → `config.yaml` (gitignored) to override the server block; without
it, built-in defaults apply. The SQLite file (`ctrlb.db`) is created on first run.

## Docs

| File | What it covers |
|---|---|
| [`docs/HANDOFF.md`](docs/HANDOFF.md) | **Start here in a fresh session** — orientation + first action. |
| [`docs/DECISIONS.md`](docs/DECISIONS.md) | Locked-in choices and the reasoning behind each. |
| [`docs/DESIGN.md`](docs/DESIGN.md) | Concrete code design — data structures, registries, the agent loop, persistence, concurrency, flows, edge cases, extension cookbook. |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | System design: backend, frontend, data model, action registry, agent/voice, deployment profiles. |
| [`docs/RESEARCH.md`](docs/RESEARCH.md) | Framework/library survey with sources and version pins. |
| [`docs/TODO.md`](docs/TODO.md) | Phased, checkbox build plan from empty folder to cutover. |
| [`docs/ROADMAP.md`](docs/ROADMAP.md) | Future additions (privilege levels, automations, wake word, idle shutdown, bots, …) + the v1 seams to build now so they slot in. |

## Planned layout (not yet created)

```
dashboard_v2/
  backend/            # FastAPI app (Python 3.11+)
    app/
      main.py         # app factory, route mounting, SPA static serving
      config.py       # YAML load/save + Pydantic Settings
      db.py           # SQLite (threads, messages, memory, events)
      models/         # Pydantic schemas (Host, Service, Action, Event, ...)
      hosts.py        # ping / WOL / SSH, concurrent status
      actions/        # typed-action registry (wake, shutdown, start_service, ...)
      agent.py        # OpenAI-compatible chat + tool-calling + memory
      voice.py        # /voice/stt (multipart in), /voice/tts (audio out)
      utils.py        # yt-captions, ip-info
      api/            # routers grouped by resource
    pyproject.toml    # pinned deps
  frontend/           # React + TS + Vite PWA
    src/
      api/            # typed client + TanStack Query hooks
      tabs/           # Fleet, Agent, Utils, Conf
      components/     # composer, device row, command bubble, ...
      theme/          # vapor / aqua / ember CSS variables
    vite.config.ts    # + vite-plugin-pwa
    package.json
  docs/
```

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for why it's split this way.
