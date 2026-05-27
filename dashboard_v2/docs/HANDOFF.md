# Handoff — start here for a fresh session

**Purpose:** **Phases 0 + 1 + 2 are done — the Vapor Fleet tab is ported, wired to a live FastAPI
ping fan-out, and the wake/shutdown/ping buttons now drive real typed actions** through the
unified action registry (confirm-gated shutdown, optimistic flip, toasts, live SSE activity feed).
The next session builds **Phase 3 — services**: a `Service` model + per-OS start/stop/restart
command maps, service actions, and the Vapor `.svc-row` rendering inside the device-row dropdown
(currently the "no services declared" empty state). This doc is the orientation; canonical detail
is in the other `docs/` files. **The pixel-exact Vapor fidelity mandate (D7) still governs every
new component.**

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
> 5. **Read [`VAPOR_PATTERNS.md`](./VAPOR_PATTERNS.md) before styling anything** — the distilled
>    design language (tokens, button taxonomy, the per-theme danger-color philosophy, and the
>    per-component decisions from the `ctrl-b (Vapor)/chats/`). It exists so net-new components
>    (which have no `vapor.html` markup to copy) stay consistent by construction.

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

## Current state (what Phase 2 left you)

Phases 0 + 1 are on `origin/main` (`510302d`, `dc9d4e9`, `1fabed9`). **Phase 2 is implemented
locally** — review + commit it (the owner commits when asked).

⭐ NEW in Phase 2 (`backend/app/`):
```
  domain/enums.py        #   + Risk / Privilege / Actor / RunState
  domain/result.py       # ⭐ ToolResult (+ Artifact) — the one outcome shape for every capability
  domain/event.py        # ⭐ Event — the single audit record (mirrors the `events` table)
  core/tool.py           # ⭐ ToolSpec / Tool / InvocationContext / ToolRegistry + @action + registry
  core/permissions.py    # ⭐ Decision + pure decide()  (CONFIRM-priv → wake/ping ALLOW, shutdown CONFIRM)
  core/events.py         # ⭐ in-proc EventBus (pub/sub → SSE; drops oldest, never back-pressures)
  core/redact.py         # ⭐ redact(text, secrets) — scrubs the SSH password from any output
  adapters/wol.py ssh.py # ⭐ wakeonlan + paramiko, blocking → called via asyncio.to_thread
  services/actions/      # ⭐ wake.py shutdown.py ping.py + _common.py (HostTargetInput); @action-registered
  services/action_service.py  # ⭐ validate → decide → confirm-token dance → execute → record Event
  services/events.py     # ⭐ EventService — persist to SQLite + publish to EventBus
  services/deps.py       # ⭐ Deps (settings + fleet + events) handed to InvocationContext
  api/actions.py events.py    # ⭐ GET/POST /api/actions[/{name}] · GET /api/events[/stream] (SSE)
  db.py                  #   + execute()/query() helpers (serialized write / WAL read)
  main.py                #   lifespan builds EventBus→EventService→ActionService; routers mounted
```
⭐ NEW in Phase 2 (`frontend/src/`):
```
  types.ts               #   + Risk/RunState/ToolResult/ActionSpec/CtrlEvent/InvokeResponse
  api/client.ts          #   + postJSON (surfaces FastAPI `detail`)
  hooks/useActions.ts    # ⭐ useActionSpecs + useFleetActions (confirm→optimistic→toast→invalidate)
  hooks/useEvents.ts     # ⭐ useEventStream — EventSource → refresh fleet on any recorded event
  store/toast.ts confirm.ts   # ⭐ dep-free stores (activity toasts + imperative requestConfirm())
  components/Toasts.tsx ConfirmDialog.tsx   # ⭐ toast stack + the lone (shutdown) confirm dialog
  components/DeviceRow.tsx     #   buttons wired to onAction; `busy` drives the ◐ spinner
  tabs/FleetTab.tsx App.tsx    #   FleetTab uses useFleetActions; App mounts Toasts+ConfirmDialog+SSE
  theme/extras.css       # ⭐ net-new toast/modal CSS — built from vapor tokens; vapor.css stays verbatim
```

The Phase 1 surface is unchanged underneath (Fleet read path, hero scene, theme store, etc.).

**Run it (two terminals):**
```powershell
cd dashboard_v2/backend  ; .venv\Scripts\python.exe -m uvicorn app.main:app --reload --port 5433
cd dashboard_v2/frontend ; npm run dev      # proxies /api → 5433
```
NOTE: this dev box already has Vite servers on 5173–5175 (other workspaces: ws_codex*, ws_claude_2,
a telegram bot). Vite will drift to a free port — pin it if you want a known one:
`npm run dev -- --port 5190 --strictPort`. Open the Vapor prototype next to it at ~390px:
`ctrl-b (Vapor)/variations/vapor.html`. **Acceptance is still the human side-by-side check.**

**Verified (Phase 2):** registry loads 3 actions with correct risk/confirm; `decide()` at
`Privilege.CONFIRM` → wake/ping ALLOW, shutdown CONFIRM. Full `TestClient` run: ping/wake execute
immediately; shutdown without a token → `needs_confirm`+token, with the token → executes (SSH
fails on the dev fleet → clean ERROR result), token is single-use; unknown action → 404, bad args
→ 422, unknown host → ERROR result; every call lands in the `/api/events` audit trail; a live
`/api/events/stream` subscriber received the pushed event. `compileall` clean; frontend `tsc -b` +
`vite build` clean. **⭐ Owner ran the live stack against the real fleet (2026-05-27): the fleet
pings real hosts, and a real WOL wake from the UI works** (toast + the host comes online on a
later poll).

**Not yet exercised against a real host** (no env blocker — just untested): **shutdown** (the
Windows hosts need OpenSSH Server running; the Linux host needs passwordless `sudo`) and the
**confirm-dialog UX**; the toast/confirm components weren't separately checked at 390px — but
Phase 2 added **no vapor-ported markup** (only net-new toast/modal built from vapor tokens), and
`vapor.css` is untouched, so D7 fidelity is unaffected.

(Phase 1 stays verified: `/api/health|hosts|hosts/{id}/status` correct under concurrent pings;
owner confirmed the pixel-exact side-by-side at 390px on 2026-05-27.)

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

## First action — Phase 3 (services)

Phase 2 is committed and confirmed working against the real fleet (wake verified live). Two small
follow-ups you can fold in opportunistically, neither blocking Phase 3:
- exercise **shutdown** end-to-end once a host has SSH reachable (Windows: OpenSSH Server; Linux:
  passwordless `sudo`) — confirm the dialog → token → offline-flip path on a real box,
- glance at the toast/confirm dialog in **aqua/ember** themes (they use vapor tokens, should be fine).

Open `TODO.md` → **Phase 3** and build services (DESIGN §2 `Service`; the same `@action`
registry — service start/stop/restart are just more actions). In order:

1. **`Service` model** + per-OS `start/stop/restart` command maps in config (`config.yaml`); load
   like hosts. State is derived (port reachable / process check), not stored.
2. **Actions** in `services/actions/`: `start_service` / `stop_service` / `restart_service` /
   `open_service_url` — one file each, `@action`-registered; reuse the SSH adapter. Events as usual.
3. **API:** `GET /api/services`, `POST /api/services/{id}/actions/{action}`.
4. **Frontend:** render the Vapor `.svc-row` inside the device-row dropdown (replace the
   "no services declared" empty state in `DeviceRow.tsx`), wire state + the open-URL link.

The action framework + confirm/event/toast plumbing from Phase 2 is the template — services slot
straight in. Don't build ahead into the agent (Phase 4+). Each phase ends in something runnable.

**Resolved open question (frontend routing):** went with **tab state** (the `store/ui.ts` `tab`
field), not react-router — 4 tabs, no deep-linking need yet.

**Phase 2 design notes worth carrying forward:** the UI invokes actions as `Actor.USER` /
`Privilege.CONFIRM`, which is what makes shutdown (the lone `risk=HIGH, confirm=True` action)
gate while wake/ping run immediately — change the privilege and the gating changes, no per-button
logic. The frontend reads `confirm`/`risk` from `GET /api/actions` rather than hardcoding which
action confirms. Confirm tokens are in-memory + single-use + 120s TTL (a deliberate two-step gate,
not CSRF). `vapor.css` stayed verbatim; net-new component CSS lives in `theme/extras.css`.
