# Handoff — start here for a fresh session

**Purpose:** planning for `dashboard_v2` is **complete**. No application code exists yet. The next
session **starts building**. This doc is the orientation; the canonical detail is in the other
`docs/` files.

## Read order (5 min)

1. `DECISIONS.md` — every locked choice + reasoning, the open items, and the future-additions list.
2. `ARCHITECTURE.md` — backend/frontend/data-model/action-registry/agent/voice/deploy design.
3. `TODO.md` — the phased build plan. **Begin at Phase 0.**
4. `RESEARCH.md` — library/version pins + sources (incl. the secure-context/mic analysis).
5. `ROADMAP.md` — post-v1 features + the v1 seams to build now so they slot in.

The **visual source of truth** is `../../ctrl-b (Vapor)/variations/vapor.html` (mobile-first
vaporwave SPA: 4 tabs Fleet/Agent/Utils/Conf, per-host services, themes, composer w/ mic +
auto-TTS, command bubbles). Port it; copy assets (logo/favicon), don't import.

## What this is

Single-user homelab control panel — wake/monitor/manage a PC fleet over LAN + Tailscale, with a
text/voice LLM agent that drives **typed, allowlisted actions** (not raw shell). **Tailscale-only,
no public bind, no auth** — never weaken that boundary.

## Locked decisions (one-liners — detail in DECISIONS.md)

- **Frontend:** mobile-first **PWA** — React 19 + TS + Vite 7 + TanStack Query + lucide-react +
  vite-plugin-pwa. Ports the Vapor design; widens to desktop.
- **⭐ Visual fidelity (D7):** the UI must be a **pixel-exact port of `vapor.html`** — lift the CSS
  verbatim, same fonts/colors/animations/components/themes; verify side-by-side. Not negotiable.
- **Extensible tools (D8):** Utils is a **tool registry** — a new tool (DNS trace, whois, …) is one
  file (handler + input + metadata) that auto-creates its endpoint, Utils card, and agent tool.
- **Backend:** **Python + FastAPI + Uvicorn**. Reuse paramiko / wakeonlan / openai /
  youtube-transcript-api. Async concurrent pings.
- **Execution:** **hybrid** — typed-action registry (UI + agent) is primary; one guarded
  `run_shell` (captured output, timeout, dangerous-flagged, agent-excluded by default) for the
  command escape hatch.
- **Persistence:** **SQLite** (threads / messages / memory / events) + **YAML** config
  (`config.yaml` shape preserved, secrets gitignored + masked).
- **LLM/voice:** all OpenAI-compatible base URLs — chat (llama.cpp `llama-server` `/v1` or cloud),
  STT (faster-whisper `/v1/audio/transcriptions`), TTS (Kokoro/openedai `/v1/audio/speech`).
- **Agent integrations (D9), all configurable in Conf:** **MCP client** (multiple servers over
  **stdio** + **Streamable HTTP**, tools merged/namespaced), **SearXNG** endpoint → `web_search`
  tool, **embeddings** endpoint (llama.cpp `/v1/embeddings`) → vector memory.
- **Agent runtime (D10):** **context compaction** (auto + `/compact`), a built-in **`task_plan`**
  tool (+ extensible toolset — new tool = one file), and **skills** (`skills/<name>/SKILL.md`,
  model- or `/skill-name`-invoked). Study `RESEARCH.md` prior art (opencode + public Claude-Code).
- **Composer prefixes:** `!<cmd>` (configurable sigil) → guarded shell; `/<cmd>` → slash commands
  incl. `/local`,`/cloud`; else → agent. Markdown bot replies + copy/send-to-composer on code blocks.
- **Mic needs a secure context → serve over HTTPS via Tailscale Serve** (tailnet-only, not Funnel).
- **Deploy profiles:** Windows / Ubuntu / Termux off one Python codebase.
- **Notifications:** optional (master toggle); default PWA-native (foreground + Web Push, auto);
  ntfy / Telegram-Discord optional; per-event toggles. No native app required.

## Build now so the post-v1 backlog slots in (the "seams")

Pluggable `MemoryProvider` · action `risk` levels on every action · typed chat-message kinds
(`text`/`action`/`question`) + turn-based agent loop · chat endpoint supports streaming **and**
buffered · a settings/policy layer (agent privilege levels ride on `risk`) · Conf tab in
functional groups (Inference·Agent·Memory·Voice·Automations·Fleet·Server·Notifications·Appearance·
Integrations).

## Open questions to resolve in-phase

- Agent tool-calling format + weak-local-model fallback (Phase 4).
- SearXNG MCP: v1 or post-v1?
- Embeddings backend for vector memory (when B1 vector lands).
- **Agent privilege ladder** exact steps + escalation UX — least pinned down.
- **Real idle detection** mechanism (helper agent per host?) — the hard part of D1; optional/opt-in.
- Frontend routing: tab state vs react-router.

## Environment / running

- Host: **Windows 11**, shell **PowerShell** (`$null`, `$env:VAR`, backtick continuation); Bash
  tool also available. Python **3.11**.
- The **live Flask app** (`../../wol_server/wol_server_win.py`, port 5432) **keeps running** until
  cutover (TODO Phase 10). Do **not** modify it or the old prototype folders.
- Repo is **public** (`github.com/nengoxx/ctrl-b`); `dashboard_v2/` is now tracked. Secrets
  (`config.yaml`, `clients`, `*_prompt.*`) are gitignored — keep them out of commits/logs.
- When scaffolding, add a `.gitignore` for `node_modules`, `dist`, `*.db`, `__pycache__`, `.venv`
  (the repo root `.gitignore` does **not** cover node_modules).

## First action

Open `TODO.md` → **Phase 0 — Scaffolding**: stand up the FastAPI skeleton (`/api/health`) with
pinned deps, the Vite/React PWA scaffold (lift config from `../../ws_claude`), copy logo/favicon,
wire `config.py` (YAML) + `db.py` (SQLite), add the `.gitignore`. Each phase ends in something
runnable; keep changes testable at ~390px width.
