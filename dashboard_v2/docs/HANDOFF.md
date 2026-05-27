# Handoff — start here for a fresh session

**Purpose:** **Phases 0 + 1 are done — the Vapor Fleet tab is ported and wired to a live FastAPI
ping fan-out.** The next session builds **Phase 2 — typed actions (WOL / shutdown / ping)**: the
wake/stop buttons in the device rows are already rendered but inert; Phase 2 makes them real
through the action registry. This doc is the orientation; canonical detail is in the other
`docs/` files. **The pixel-exact Vapor fidelity mandate (D7) still governs every new component.**

> ## ⭐ The standing Vapor-fidelity mandate (D7) — applies to every phase
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

## Current state (what Phase 1 left you)

Phase 0 pushed to `origin/main` (`510302d` scaffold, `dc9d4e9` secrets model). **Phase 1 is
implemented locally and not yet committed** — review + commit it first.

```
dashboard_v2/
  backend/app/
    domain/enums.py host.py   # ⭐ NEW — OSType + Host(SecretStr pw)/HostStatus (pure models)
    services/fleet.py         # ⭐ NEW — concurrent ping fan-out + FleetService (TTL cache)
    api/hosts.py              # ⭐ NEW — GET /api/hosts, GET /api/hosts/{id}/status
    config.py                 #   + ComputerCfg + Settings.computers{} + Settings.hosts()
    main.py                   #   lifespan builds app.state.fleet; hosts router mounted
    api/health.py             #   + poll_seconds
  frontend/src/
    theme/vapor.css           #   vapor.html <style> lifted VERBATIM — unchanged, style against it
    theme/heroScene.ts        # ⭐ NEW — sun + both skyline SVGs lifted VERBATIM (dangerouslySetInnerHTML)
    store/ui.ts               # ⭐ NEW — dep-free UI store (theme/tab/skyline/loz/tts/hero/waveform)
    api/client.ts  types.ts  hooks/useFleet.ts   # fetch + TS types + TanStack Query hooks
    components/  AppBar TabBar Composer Hero Waveform DeviceRow FleetSummary
    tabs/        FleetTab(live)  AgentTab UtilsTab ConfTab(static; Appearance wired to store)
    App.tsx                   #   shell: mirrors store→body data-attrs, mounts all 4 tabs
  config.example.yaml         #   + sample `computers:` block (live wol_server shape)
  config.yaml                 #   ⭐ local dev fleet (gitignored) — mixes reachable/unreachable IPs
```

**Run it (two terminals):**
```powershell
cd dashboard_v2/backend  ; .venv\Scripts\python.exe -m uvicorn app.main:app --reload --port 5433
cd dashboard_v2/frontend ; npm run dev      # proxies /api → 5433
```
NOTE: this dev box already has Vite servers on 5173–5175 (other workspaces: ws_codex*, ws_claude_2,
a telegram bot). Vite will drift to a free port — pin it if you want a known one:
`npm run dev -- --port 5190 --strictPort`. Open the Vapor prototype next to it at ~390px:
`ctrl-b (Vapor)/variations/vapor.html`. **Acceptance is still the human side-by-side check.**

**Verified:** backend imports + host loading; `/api/health`, `/api/hosts`, `/api/hosts/{id}/status`
return correct data with concurrent pings (127.0.0.1→1ms, 8.8.8.8/1.1.1.1 online, fake LAN IPs
offline); frontend `tsc -b` + `vite build` clean; Vite→FastAPI proxy end-to-end. **Owner confirmed
the pixel-exact side-by-side at 390px (2026-05-27).** Phase 1 is ready to commit.

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

## First action — Phase 2 (typed actions: WOL / shutdown / ping)

**Before anything:** open the app in a browser at ~390px next to `vapor.html` and do the Phase 1
acceptance check (the one thing this env couldn't). Fix any fidelity drift, then commit Phase 1.

Then open `TODO.md` → **Phase 2** and build the action registry (DESIGN §3 — the unified `Tool`
interface; actions/tools/MCP are one mechanism). In order:

1. **Registry framework** (`core/tool.py`): `ToolSpec`/`ToolResult`/`Tool` Protocol + `ToolRegistry`,
   the `@action(name, risk, confirm, ui_exposed)` decorator, and the pure `permissions.decide()`
   (DESIGN §3). Keep `risk` on every action (the post-v1 privilege ladder rides on it).
2. **Actions** in `services/actions/`: `wake_host` (wakeonlan magic packet; `mac=None`→DENIED),
   `shutdown_host` (paramiko SSH, per-OS cmd; `risk=HIGH, confirm=True`), `ping_host`. Reuse the
   live `wol_server_win.py` flows. Every invocation writes an `Event` (the audit path + SSE feed).
3. **API:** `GET /api/actions` (registry), `POST /api/actions/{name}` with the confirm-token
   dance for high-risk (DESIGN §14 "UI action"); `GET /api/events` + `GET /api/events/stream` (SSE).
4. **Frontend:** wire the already-rendered device-row wake/stop buttons → TanStack mutations with
   optimistic update + rollback; **confirmation dialog** before high-risk; surface events. Verify
   a real wake + shutdown from the UI.

The frontend seams are in place: `DeviceRow` already renders the `.act wake`/`.act stop` buttons
(currently `stopPropagation` no-ops) and the dropfoot — just attach mutations. Don't build ahead
into services/agent (Phase 3+). Each phase ends in something runnable.

**Resolved open question (frontend routing):** went with **tab state** (the `store/ui.ts` `tab`
field), not react-router — 4 tabs, no deep-linking need yet.
