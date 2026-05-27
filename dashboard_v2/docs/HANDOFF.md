# Handoff — start here for a fresh session

**Purpose:** **Phases 0–3 are done, and Phase 4a (agent chat — text round-trip) is done** — the
Vapor Fleet tab drives real fleet/action/service typed-actions, and the **Agent tab now holds a
live streaming chat** with the local `minig+` llama.cpp backend (threads/messages persisted to
SQLite, SSE token streaming, thinking-model reasoning shown dimmed). The next session continues
**Phase 4b — tools**: expose the action registry as OpenAI `tools`, add the tool-call loop +
permission gate, and render command/action **confirm bubbles** (reusing Phase 2's `ActionService`/
`decide`). Then 4c routing · 4d `task_plan` · 4e compaction · 4f MCP/SearXNG/embeddings — each a
runnable slice (don't build it all at once). This doc is the orientation; canonical detail is in
the other `docs/` files. **The pixel-exact Vapor fidelity mandate (D7) still governs every new
component.**

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

## Current state (what Phase 4a left you)

Phases 0–3 are on `origin/main` (through `2675f82`). **Phase 4a is implemented locally** — review +
commit it (the owner commits when asked).

⭐ NEW in Phase 4a (`backend/app/`):
```
  adapters/inference.py        # ⭐ InferenceClient — AsyncOpenAI per mode; stream_chat → ChatDelta(text|reasoning)
  config.py                    #   + InferenceCfg (local/cloud endpoints, default_mode, timeout); config.yaml local=minig+
  domain/conversation.py       # ⭐ Thread + Message + Part union (text/reasoning/error)
  services/conversation.py     # ⭐ ThreadRepo + MessageRepo (parts as JSON over db.py)
  services/agent/session.py    # ⭐ AgentSession.run_turn — text-only loop, yields SSE AgentEvents
  api/agent.py                 # ⭐ GET/POST /api/threads · GET /threads/{id}/messages · POST /api/agent/chat (SSE)
  main.py                      #   wires InferenceClient + Thread/Message repos onto app.state; mounts agent router
```
⭐ NEW in Phase 4a (`frontend/src/`):
```
  types.ts                     #   + Role/Part/ChatMessage/Thread
  store/chat.ts                # ⭐ dep-free streaming store: messages + status + sendMessage (fetch ReadableStream SSE parser)
  tabs/AgentTab.tsx            #   live chat log (Vapor bubbles + dim reasoning disclosure + streaming caret), initChat history load
  components/Composer.tsx      #   send → sendMessage + jump to Agent tab; disabled while streaming
  theme/extras.css             # ⭐ net-new: reasoning disclosure + caret + chat-error (vapor tokens; vapor.css verbatim)
```
The model `minig+` is a **thinking** model and **cold-loads slowly (2–3 min)** — the client timeout
is 600s. Reasoning is streamed/persisted as a `ReasoningPart` (dimmed, NOT replayed into the
model's next context). One thread for now (Vapor's "one agent · one thread"); thread-list UI later.

----

⭐ Phase 3 (already committed, `2675f82`) (`backend/app/`):
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

**Verified (Phase 4a):** `compileall` clean. A `TestClient` run (stubbed inference) passed: threads
CRUD, the SSE event order (`thread`→`message.start`→`reasoning.delta`/`text.delta`→`message.end`→
`done`), reasoning+text persisted as distinct parts, unknown-thread 404, and the backend-error path
(clean `error`+`done(error)`, `ErrorPart` persisted). **Live round-trip against `minig+`** worked
end-to-end: 14 `text.delta` events streamed over SSE, a clean sensible answer ("I help you monitor
and manage your fleet of homelab PCs remotely."), persisted + reloaded via `initChat()`. Frontend
`tsc -b` + `vite build` clean. Agent tab reviewed @390px — Vapor chat bubbles (teal user / magenta
bot, `who` dots) used verbatim; reasoning disclosure + caret are net-new in `extras.css`.

**Live-render fix (post-review):** the first cut only showed replies after a reload — the client
SSE parser split on `\n\n`, but `sse-starlette` frames end in `\r\n\r\n`, so no frame ever parsed.
Parser now tolerates `\r\n`/`\n` (`store/chat.ts`). Confirmed streaming live in-browser against
`minig+`, including the **reasoning disclosure live** (it's a thinking model — chain-of-thought
streams dimmed). Added a **working indicator**: on send, an assistant placeholder appears instantly
with animated "…" dots + a `thinking`/`working` tag in the who-line until the first answer token
lands (covers the slow cold-load / reasoning wait). Two more review fixes: **auto-scroll** now
sticks to the bottom on the **window** scroller (the `.chat-log` div isn't the scroller — `body` has
`padding-bottom` for the fixed composer) so the view follows the bot while it types (unless you've
scrolled up); and the **reasoning persists** after the turn as a collapsed **"▸ thinking · tap to
view"** dropdown chip (was auto-collapsing too subtly and felt lost) — tap to re-expand it. All CSS
net-new in `extras.css`. **Mobile layout — app-shell (the real fix):** the original window-scroll +
`position:fixed` composer/tab bar broke on Android Firefox — the dynamic toolbar shrinks the visual
viewport, so at the bottom of the chat the fixed bars and the body's bottom padding misaligned
(colored gaps / vanishing tab icons). (An earlier `--vv-bottom` "pin to visual viewport" attempt
double-counted Firefox's own fixed-positioning and made it worse — reverted.) Now the app is a
**`100dvh` flex column** (`extras.css`): a scrolling content pane `.app-scroll` (appbar + tabs),
then the composer + tab bar in **normal flow** at the bottom. `100dvh` tracks the toolbar/keyboard,
the bars are always at the visible bottom, and the chat scrolls in its own pane — **no body padding,
no fixed/viewport mismatch** by construction. `App` restructured to the shell; `AgentTab`
stick-to-bottom scrolls `#app-scroll` (not the window). **Keyboard:** `100dvh` tracks the browser
toolbar but NOT the on-screen keyboard, so the shell height is driven by `--app-h` =
`window.visualViewport.height` (App effect) which DOES shrink when the keyboard opens — the composer
rides up above it instead of being hidden (`dvh` is the CSS fallback). Desktop verified (layouts
unchanged, pane scroll + pin-to-bottom; shrinking `--app-h` lifts the composer); **owner to confirm
the Android toolbar + keyboard behaviour on the phone**.

**Not yet exercised:** the **cloud backend** (only `local` configured). The cold-load is now
visibly indicated (dots) rather than a dead spinner. No `vapor.css` changes — D7 unaffected.

**Phase 3 stays verified** (committed `2675f82`): service actions register with right risk/confirm,
`GET /api/services` derives port-probe status + url/controls, confirm dance + audit trail all
checked; owner has g5/emma services declared in `config.yaml` and the `.svc-row` reviewed @390px.

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

## First action — Phase 4b (agent tools + confirm bubbles)

Phase 4a is implemented locally (commit it when asked). The chat foundation is in place; **4b adds
tools to the loop**. Optional 4a follow-ups, none blocking 4b:
- trigger a **reasoning turn** on `minig+` (a harder prompt) to eyeball the dimmed `thinking`
  disclosure live, and confirm cloud-mode once a `cloud` endpoint is configured,
- the SSH service/shutdown path is still untested against a real host (shared one SSH path).

Open `TODO.md` → **Phase 4 → 4b+** and extend `AgentSession.run_turn`:
1. **Aggregated toolset → OpenAI `tools`:** add `ToolRegistry.to_openai_tools(...)` (Pydantic
   `input_model` → JSON Schema is already there via `spec_to_dict`); pass the `agent_exposed` subset
   on the chat call. Add `ToolCallPart`/`ToolResultPart` to `domain/conversation.py` (the union is
   built for this).
2. **Tool-call loop + permission gate:** parse tool calls from the stream, validate args (bad args →
   `tool_result(error)` back to the model, don't crash), run `permissions.decide(...)`; ALLOW →
   execute via the **existing `ActionService`/registry**, CONFIRM → emit `tool.permission` and
   suspend (reuse the single-use confirm-token), DENY → synthesize a denied result. Loop until
   text-only or `max_iterations`.
3. **Confirm/command bubbles (frontend):** render `ToolCallPart`+`ToolResultPart` as the Vapor
   `.b.cmd` bubble (execute/edit/dismiss — markup at `vapor.html:1934`); a `tool.permission` event
   shows the execute/dismiss controls that POST the confirm-token back to resume.
4. Then **4c** composer prefix routing (`!`/`/`, `/local`//`/cloud`) + markdown replies, **4d**
   `task_plan` builtin + plan panel, **4e** compaction (selectable summarizer), **4f** MCP +
   SearXNG + embeddings (D9). Keep agents/skills/orchestration behind swappable strategies (D11).
   Each sub-slice stays runnable — don't build all of 4b–4f at once.

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
