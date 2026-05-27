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

📋 **Planning.** No code yet. Start with the docs below, in order.

## Docs

| File | What it covers |
|---|---|
| [`docs/DECISIONS.md`](docs/DECISIONS.md) | Locked-in choices and the reasoning behind each. |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | System design: backend, frontend, data model, action registry, agent/voice, deployment profiles. |
| [`docs/RESEARCH.md`](docs/RESEARCH.md) | Framework/library survey with sources and version pins. |
| [`docs/TODO.md`](docs/TODO.md) | Phased, checkbox build plan from empty folder to cutover. |

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
