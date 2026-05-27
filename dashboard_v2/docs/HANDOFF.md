# Handoff — start here for a fresh session

**Purpose:** **Phases 0 + 1 + 2 + 3 are done — the Vapor Fleet tab is ported, wired to a live
FastAPI ping fan-out, the wake/shutdown/ping buttons drive real typed actions, and services now
render** as the Vapor `.svc-row` inside the device-row dropdown (live port-probe status + open-URL
link), backed by `start/stop/restart/open` service actions on the same registry. The next session
builds **Phase 4 — agent chat (text first)**: the OpenAI-compatible chat client, threads/messages
in SQLite, streaming `POST /api/agent/chat` over SSE, the aggregated toolset (action registry +
MCP), and the Vapor Agent tab. **Start Phase 4 by studying the prior art in `RESEARCH.md`** before
writing the loop. This doc is the orientation; canonical detail is in the other `docs/` files.
**The pixel-exact Vapor fidelity mandate (D7) still governs every new component.**

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

## Current state (what Phase 3 left you)

Phases 0–2 are on `origin/main` (through `21781f7`). **Phase 3 is implemented locally** — review +
commit it (the owner commits when asked).

⭐ NEW in Phase 3 (`backend/app/`):
```
  domain/service.py            # ⭐ Service (+ command_for) + ServiceStatus (derived, never stored)
  config.py                    #   + ServiceCfg nested under ComputerCfg; Settings.services() projection
  services/svc.py              # ⭐ ServiceService — cached concurrent TCP port-probe off fleet status
  services/actions/_common.py  #   + ServiceTargetInput + run_service_command (shared SSH runner)
  services/actions/{start,stop,restart}_service.py · open_service_url.py   # ⭐ @action, one file each
  services/actions/__init__.py · deps.py · main.py   #   register + wire ServiceService into Deps
  services/action_service.py   #   _record target now falls back to service_id
  api/services.py              # ⭐ GET /api/services · POST /api/services/{id}/actions/{action}
```
⭐ NEW in Phase 3 (`frontend/src/`):
```
  types.ts                     #   + Service / ServiceStatus
  hooks/useServices.ts         # ⭐ useServices — polls ['services'] at poll_seconds
  hooks/useEvents.ts           #   SSE now invalidates ['services'] too
  tabs/FleetTab.tsx            #   fetch services, group by host_id, pass each row its own
  components/DeviceRow.tsx     #   ⭐ Vapor .svc-row list (led/name/host:port/↗ link) + "· N svc" sub
```
`config.example.yaml` gained a documented `services:` block under two hosts (the shape to copy).
No `vapor.css` changes (the `.svc-row` styles were already lifted in Phase 0) — D7 unaffected.

----

⭐ Phase 2 (already committed, `21781f7`) (`backend/app/`):
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

The Phase 1 surface (Fleet read path, hero scene, theme store) and Phase 2 action stack are
unchanged underneath.

**Run it (two terminals):**
```powershell
cd dashboard_v2/backend  ; .venv\Scripts\python.exe -m uvicorn app.main:app --reload --port 5433
cd dashboard_v2/frontend ; npm run dev      # proxies /api → 5433
```
NOTE: this dev box already has Vite servers on 5173–5175 (other workspaces: ws_codex*, ws_claude_2,
a telegram bot). Vite will drift to a free port — pin it if you want a known one:
`npm run dev -- --port 5190 --strictPort`. Open the Vapor prototype next to it at ~390px:
`ctrl-b (Vapor)/variations/vapor.html`. **Acceptance is still the human side-by-side check.**

**Verified (Phase 3):** `compileall` clean. A synthetic-config `TestClient` run (loopback TCP
listener as a live "service") passed end-to-end: the 4 service actions register with the right
risk/confirm (start/open LOW, stop/restart MED); `GET /api/services` derives `online` correctly
(open port → up, closed port → down) and builds `url`/`controls` from the host + per-OS cmd;
`open` returns the URL with no SSH; `start` (LOW) runs immediately, `stop` (MED) gates →
single-use token → executes; unknown service/action → 404, a service missing its OS command →
DENIED; every call lands in the `/api/events` audit trail (target = `service_id`). Boots clean
against the **real config** (`/api/services` → `[]` — no services declared yet). Frontend
`tsc -b` + `vite build` clean.

**Not yet exercised against a real service host** (no env blocker — just untested): the
**start/stop/restart SSH path** (needs a host with SSH reachable + a real service to control) and
the **confirm-dialog UX for a MED service action** — but the SSH path is identical to
`shutdown_host` and the confirm dance is the same code as Phase 2. To see services in the UI, add
a `services:` block to `config.yaml` (shape in `config.example.yaml`). The `.svc-row` markup ports
verbatim from `vapor.html` and reuses CSS already lifted in Phase 0, so D7 fidelity is unaffected
(still worth the human side-by-side once a service is declared).

**Phase 2 stays verified** (committed `21781f7`): registry/`decide()`/confirm dance/audit/SSE all
checked; **owner ran the live stack against the real fleet (2026-05-27)** — fleet pings real hosts
+ a real WOL wake from the UI works. Still untested on a real host: `shutdown_host` end-to-end +
the confirm-dialog UX (Windows hosts need OpenSSH Server; Linux needs passwordless `sudo`).

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

## First action — Phase 4 (agent chat, text first)

Phase 3 is implemented locally (commit it when asked). Small follow-ups you can fold in
opportunistically, none blocking Phase 4:
- exercise **shutdown** AND **start/stop/restart_service** end-to-end once a host has SSH reachable
  (Windows: OpenSSH Server; Linux: passwordless `sudo`) — they share one SSH path,
- declare a `services:` block in `config.yaml` (shape in `config.example.yaml`) and do the human
  **side-by-side** of the `.svc-row` against `vapor.html` at 390px (D7) — also glance at it in
  aqua/ember.

Open `TODO.md` → **Phase 4** and build the agent. **First read `RESEARCH.md` → "Prior art for the
agent/chat subsystem"** (opencode loop/session/permission + public Claude-Code patterns; do NOT
use the leaked claude-code repo). Then, roughly in order: the `openai`-client `agent.py` →
threads/messages in SQLite (`GET/POST /api/threads`, `GET messages`) → streaming `POST
/api/agent/chat` over SSE → the aggregated toolset feeding OpenAI `tools` (the action registry is
already the source — high-risk/confirm actions surface as command/action bubbles, reusing the
confirm dance) → MCP client (one server end-to-end first) + SearXNG `web_search` + embeddings →
composer prefix routing (`!`/`/`/agent) → the `task_plan` builtin + context compaction → the Vapor
**Agent** tab. Keep agents/skills/orchestration behind swappable strategy interfaces (D11). Each
sub-step should stay runnable; don't build all of Phase 4 in one shot.

**Resolved open question (frontend routing):** went with **tab state** (the `store/ui.ts` `tab`
field), not react-router — 4 tabs, no deep-linking need yet.

**Phase 2/3 design notes worth carrying forward:** the UI invokes actions as `Actor.USER` /
`Privilege.CONFIRM`, so `risk` alone decides gating — `shutdown_host` (HIGH) and
`stop_service`/`restart_service` (MED) gate; wake/ping/`start_service`/`open_service_url` (LOW) run
immediately. Change the privilege and the gating changes, no per-button logic — the agent (Phase 4)
reuses the **same `ActionService`** with its own actor/privilege. The frontend reads `confirm`/`risk`
from the registry rather than hardcoding. Confirm tokens are in-memory + single-use + 120s TTL (a
two-step gate, not CSRF). Service liveness is **derived** (TCP port probe, cached at `poll_seconds`
off the fleet host status), never stored; service ids are `"{host_id}.{svc_slug}"`. `vapor.css`
stayed verbatim; net-new component CSS lives in `theme/extras.css`.
