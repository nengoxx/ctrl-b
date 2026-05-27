# Handoff — start here for a fresh session

**Purpose:** **Phase 0 is done and the scaffold runs.** The next session builds **Phase 1 — the
Fleet tab**, and the bar for it is **pixel-exact fidelity to the Vapor prototype** (D7). This doc
is the orientation; canonical detail is in the other `docs/` files.

> ## ⭐ The Phase 1 mandate: nail the Vapor port
> The owner's priority is a **faithful, pixel-exact execution of `vapor.html`** — not "inspired by."
> Before writing any component:
> 1. **Open `../../ctrl-b (Vapor)/variations/vapor.html` in a browser at ~390px** and study the real
>    thing — the hero (sun bob + retrowave stripes, twinkling stars, moving neon grid, city/mountains
>    skyline SVG, live waveform canvas), the appbar (logo lozenge + auto-TTS toggle), device rows with
>    the expandable dropdown (services + kv detail + wake/stop mask-icon buttons), the fleet summary,
>    and the bottom tab bar with its sliding indicator.
> 2. **The CSS is already lifted verbatim** into `frontend/src/theme/vapor.css` (the 1064-line
>    `<style>` block — `:root`/`[data-theme]` variables + all component CSS). **Reuse those exact
>    class names and variables; do not re-derive colors/spacing/animations.** Componentize the
>    *markup* into React, keep the *styles* as-is.
> 3. **Read `vapor.html`'s markup + JS** (the part after `</style>`, ~line 1077+) to copy the exact
>    DOM structure and the animation logic (waveform canvas draw loop, tab indicator slide, hero
>    toggles) — port it, don't reinvent it.
> 4. **Verify side-by-side** against `vapor.html` at phone width before calling any piece done.
>    "Visually indistinguishable" is the acceptance test.

## Read order (5 min)

1. `DECISIONS.md` — every locked choice + reasoning, the open items, and the future-additions list.
2. `ARCHITECTURE.md` — backend/frontend/data-model/action-registry/agent/voice/deploy design.
3. `DESIGN.md` — **concrete code design**: data structures, the unified capability/registry model,
   the agent loop state machine, concurrency (incl. concurrent subagents), persistence, the SSE
   wire protocol, end-to-end flows, edge cases, and the extension cookbook. Build against this.
4. `TODO.md` — the phased build plan. **Begin at Phase 0.**
5. `RESEARCH.md` — library/version pins + sources (incl. the secure-context/mic analysis).
6. `ROADMAP.md` — post-v1 features + the v1 seams to build now so they slot in.

The **visual source of truth** is `../../ctrl-b (Vapor)/variations/vapor.html` (mobile-first
vaporwave SPA: 4 tabs Fleet/Agent/Utils/Conf, per-host services, themes, composer w/ mic +
auto-TTS, command bubbles). Port it; copy assets (logo/favicon), don't import.

## Current state (what Phase 0 left you)

Pushed to `origin/main` (commits `510302d` scaffold, `dc9d4e9` secrets model). Both verified.

```
dashboard_v2/
  backend/                 # FastAPI + Uvicorn, Python 3.11, venv at backend/.venv
    app/main.py            #   app factory + lifespan; GET /api/health works
    app/config.py          #   YAML↔Settings, .env overlay, atomic save, secret masking
    app/db.py              #   aiosqlite WAL + versioned migrations; schema v1 applied
    app/api/health.py      #   the Phase 0 checkpoint
    pyproject.toml         #   deps PINNED to real resolved versions (openai 2.38, fastapi 0.136…)
  frontend/                # React 19 + TS + Vite 7 PWA (deps installed)
    src/theme/vapor.css    #   ⭐ vapor.html <style> lifted VERBATIM — style against this
    src/main.tsx           #   QueryClientProvider + imports vapor.css
    src/App.tsx            #   Phase-0 placeholder — REPLACE with the Fleet tab in Phase 1
    index.html             #   shell: JetBrains Mono + Major Mono Display, viewport-fit=cover
    public/                #   logo.png + favicon.ico (copied from Vapor)
    vite.config.ts         #   /api → 127.0.0.1:5433, vite-plugin-pwa
  config.example.yaml · .env.example   # templates; real config.yaml/.env are gitignored
```

**Run it (two terminals):**
```powershell
cd dashboard_v2/backend  ; .venv\Scripts\python.exe -m uvicorn app.main:app --reload --port 5433
cd dashboard_v2/frontend ; npm run dev      # http://localhost:5173 (proxies /api → 5433)
```
Open the Vapor prototype next to it: `ctrl-b (Vapor)/variations/vapor.html` at ~390px.

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
- **Secrets model (decided Phase 0) — hybrid:** `config.yaml` is the UI-managed source of truth
  **including** nested secrets (per-host SSH creds, API keys); `.env` adds bootstrap paths
  (`CTRLB_CONFIG`/`CTRLB_DB`) + optional `CTRLB_<SECTION>__<KEY>` scalar overrides that **win** over
  the YAML. The app only ever rewrites `config.yaml`, never `.env`. Both gitignored; `.example`
  templates committed. Detail in `DESIGN.md` §9.
- **Ports:** backend on **5433** (the live Flask app keeps **5432** until cutover); Vite dev on 5173.
- **LLM/voice:** all OpenAI-compatible base URLs — chat (llama.cpp `llama-server` `/v1` or cloud),
  STT (faster-whisper `/v1/audio/transcriptions`), TTS (Kokoro/openedai `/v1/audio/speech`).
- **Agent integrations (D9), all configurable in Conf:** **MCP client** (multiple servers over
  **stdio** + **Streamable HTTP**, tools merged/namespaced), **SearXNG** endpoint → `web_search`
  tool, **embeddings** endpoint (llama.cpp `/v1/embeddings`) → vector memory.
- **Agent runtime (D10):** **context compaction** (auto + `/compact`), a built-in **`task_plan`**
  tool (+ extensible toolset — new tool = one file), and **skills** (`skills/<name>/SKILL.md`,
  model- or `/skill-name`-invoked). Study `RESEARCH.md` prior art (opencode + public Claude-Code).
- **Configurable agent design (D11):** **selectable summarizer model** (local/cloud + name);
  **multiple agents** as definitions (`agents[]`, add more) + **subagents** via a `spawn_subagent`
  tool; **skill-selection + orchestration are swappable strategies** — sensible default, easy to
  switch in settings, **concrete approach decided at Phase 4** with prior art in hand.
- **Composer prefixes:** `!<cmd>` (configurable sigil) → guarded shell; `/<cmd>` → slash commands
  incl. `/local`,`/cloud`; else → agent. Markdown bot replies + copy/send-to-composer on code blocks.
- **Mic needs a secure context → serve over HTTPS via Tailscale Serve** (tailnet-only, not Funnel).
- **Deploy profiles:** Windows / Ubuntu / Termux off one Python codebase.
- **Notifications:** optional (master toggle); default PWA-native (foreground + Web Push, auto);
  ntfy / Telegram-Discord optional; per-event toggles. No native app required.

## Build now so the post-v1 backlog slots in (the "seams")

Pluggable `MemoryProvider` · action `risk` levels on every action · typed chat-message kinds
(`text`/`action`/`question`/`plan`) + turn-based agent loop · chat endpoint supports streaming
**and** buffered · a settings/policy layer (privilege rides on `risk`) · **agents/skills/orchestration
behind swappable strategy interfaces** (don't hardcode) · Conf tab in functional groups
(Inference·Agent·Agents·Skills·Memory·Voice·Automations·Fleet·Server·Notifications·Appearance·Integrations).

## Open questions to resolve in-phase

- Agent tool-calling format + weak-local-model fallback (Phase 4).
- Embeddings backend specifics for vector memory (when B1 vector lands).
- **Agent privilege ladder** exact steps + escalation UX — least pinned down.
- **Agent design specifics (D11), deliberately deferred to Phase 4** — skill auto-selection
  algorithm, subagent orchestration, agents-as-YAML-vs-files, subagent depth/concurrency +
  privilege inheritance. Decide then, with the `RESEARCH.md` prior art (opencode + public
  Claude-Code) in hand; keep them swappable.
- **Real idle detection** mechanism (helper agent per host?) — the hard part of D1; optional/opt-in.
- Frontend routing: tab state vs react-router.

## Environment / running

- Host: **Windows 11**, shell **PowerShell** (`$null`, `$env:VAR`, backtick continuation); Bash
  tool also available. Python **3.11**. Backend venv already exists at `backend/.venv`; frontend
  deps already installed (`npm install` done).
- The **live Flask app** (`../../wol_server/wol_server_win.py`, port 5432) **keeps running** until
  cutover (TODO Phase 10). Do **not** modify it or the old prototype folders.
- Repo is **public** (`github.com/nengoxx/ctrl-b`); `dashboard_v2/` is tracked. Secrets
  (`config.yaml`, `.env`, `clients`, `*_prompt.*`) are gitignored — keep them out of commits/logs.
  The root `config.yaml` still holds a real OpenRouter key (gitignored, never committed) — the owner
  may rotate it.

## First action — Phase 1 (Fleet read path), Vapor-faithful

Open `TODO.md` → **Phase 1**. Build, in order, verifying against `vapor.html` at ~390px each step:

1. **Backend:** Pydantic `Host` model (DESIGN §2, with `SecretStr` SSH password + stable slug `id`);
   load hosts from YAML; `hosts.py` with **concurrent** `asyncio.gather` ping (per-OS flag shim,
   semaphore + per-host timeout); `GET /api/hosts` (+ derived status) and `GET /api/hosts/{id}/status`.
   Use the live `config.yaml` `computers{}` shape as the migration reference.
2. **Frontend Fleet tab (the ⭐ deliverable):** replace `App.tsx` with the ported Vapor shell —
   appbar, hero, device rows + expandable detail, fleet summary, bottom tab bar with sliding
   indicator — **reusing `theme/vapor.css`'s exact classes** and porting `vapor.html`'s markup + JS
   (waveform canvas, animations) faithfully. Wire to TanStack Query polling (interval from settings);
   replace the mock `DEVICES` with the API.
3. **Themes + toggles** (`vapor`/`aqua`/`ember`, skyline city/mountains, hero/waveform on/off) ported
   so they behave identically; a tiny zustand/context UI store persisted to `localStorage`.
4. **Decide:** tab state vs react-router (open question — lean tab state for 4 tabs).

Acceptance: **side-by-side visually indistinguishable from `vapor.html`** at phone width. Each phase
ends in something runnable. Don't build ahead into actions/agent (Phase 2+).
