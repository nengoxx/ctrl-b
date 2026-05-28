# Build plan — dashboard_v2

Phased, checkbox plan from empty folder to cutover. **Each phase is independently shippable and
scoped small** — it ends in something runnable you can verify before moving on; phases stack into
the whole architecture in `ARCHITECTURE.md` (don't build ahead of the phase you're in). Read
`ARCHITECTURE.md` and `DECISIONS.md` first. Keep the old Flask server running throughout.

**Two requirements that touch every phase:**
- **D7 — pixel-exact Vapor fidelity:** the UI is a faithful port of `vapor.html` (lift the CSS
  verbatim; same fonts/colors/animations/components/themes). Verify side-by-side at phone width.
- **D8 — extensible tool registry:** new tools (DNS trace, whois, …) drop in as one file. Build the
  registry, don't hardcode utilities.

Legend: `[ ]` todo · `[~]` in progress · `[x]` done.

---

## Phase 0 — Scaffolding & ground rules

- [x] `backend/` FastAPI skeleton: app factory, `/api/health`, run with `uvicorn`. `pyproject.toml`
      with **pinned** deps (fastapi, uvicorn[standard], pydantic, pydantic-settings, sse-starlette,
      paramiko, wakeonlan, openai, httpx, pyyaml, python-multipart, youtube-transcript-api,
      beautifulsoup4, aiosqlite). *(Pins resolved + frozen at scaffold; venv `backend/.venv`.)*
- [x] `frontend/` Vite + React 19 + TS scaffold (lift config from `ws_claude`): TanStack Query,
      lucide-react, vite-plugin-pwa. Vite dev proxy `/api` → uvicorn `127.0.0.1:5433` (5433 to
      coexist with the live Flask app on 5432 until cutover).
- [x] Copy `logo.png` + `favicon.ico` into `frontend/public/` (copy, don't import from old dirs).
- [x] `config.py`: load/save `config.yaml` (reuse current shape) → typed `Settings`; secret masking.
- [x] `db.py`: SQLite schema (threads, messages, memory, events) + tiny versioned applier.
- [x] `.gitignore` for `config.yaml`, `*.db`, `node_modules`, `dist`, `__pycache__`, `.venv`.
- [x] **Design foundation (D7):** extract `vapor.html`'s `<style>` into `frontend/src/theme/`
      verbatim (the `:root`/`[data-theme]` variables, base/component CSS) as the canonical
      stylesheet; set up `index.html` shell (JetBrains Mono + Major Mono Display fonts, favicon,
      `viewport-fit=cover`). Everything later styles against this — don't re-derive the design.
- [x] Tracking: `dashboard_v2/` is committed to the public repo (`main`).

## Phase 1 — Fleet read path (parity, done right)

- [x] Pydantic `Host` model (`domain/host.py`, `SecretStr` ssh password + `HostStatus`) +
      `domain/enums.py` `OSType`; load hosts from YAML via `Settings.hosts()` over the live
      `computers{}` map (`config.py` `ComputerCfg`, stable slug id).
- [x] `services/fleet.py`: **concurrent** `asyncio.gather` ping (semaphore + per-host `wait_for`
      timeout + `poll_seconds` TTL cache); per-OS ping shim (Windows `-n`/`-w`, POSIX `-c`/`-W`),
      TTL-confirmed online signal. `FleetService` on `app.state`.
- [x] `GET /api/hosts` (host DTO + derived status, no secrets), `GET /api/hosts/{id}/status`;
      `poll_seconds` added to `/api/health`.
- [x] Frontend **Fleet** tab: port of the Vapor hero (sun/stripes/stars/grid + skyline SVGs via
      verbatim `heroScene.ts` + live waveform canvas), device rows + expandable detail (kv +
      wake/stop mask-icon buttons — buttons inert until Phase 2), fleet summary, appbar (logo
      lozenge + TTS toggle + toast), bottom tab bar with sliding indicator. TanStack Query polling
      at `poll_seconds`; featured auto-cycle; mock `DEVICES` replaced with the API.
- [x] Theme system (`dark`/`aqua`/`ember`) + skyline city/mountains + app-mark logo/ring + hero/
      waveform toggles — dependency-free `store/ui.ts` (`useSyncExternalStore` + localStorage,
      mirrored to `document.body` data-attrs); wired via the **Conf → Appearance** group.
- [x] Agent/Utils/Conf tabs ported as faithful static shells (wired in their later phases) so the
      whole SPA + tab-bar slide is visually complete.
- [x] **Verify side-by-side against `vapor.html`** at ~390px (D7): typecheck + prod build pass;
      backend ping fan-out + Vite→FastAPI proxy verified end-to-end; **owner confirmed the visual
      side-by-side** (2026-05-27).

## Phase 2 — Actions (typed registry + WOL/shutdown)

- [x] Action registry framework: unified `Tool`/`ToolSpec`/`ToolRegistry` + `@action(name, risk,
      confirm, ui_exposed)` (`core/tool.py`), pure `permissions.decide()` (`core/permissions.py`),
      `ToolResult` (`domain/result.py`), `InvocationContext`+`Deps` (`services/deps.py`).
- [x] Implement `wake_host` (WOL; `mac=None`→DENIED), `shutdown_host` (paramiko SSH, per-OS cmd,
      `risk=HIGH, confirm=True`), `ping_host` (`services/actions/`). Every invocation writes an
      `Event` via `EventService` (persist to SQLite + publish to the in-proc `EventBus`).
- [x] `GET /api/actions` (registry + input JSON Schema), `POST /api/actions/{name}` with the
      single-use, TTL'd **confirm-token dance** for high-risk (`ActionService`; 404/422 mapped).
- [x] `GET /api/events` (audit trail) + `GET /api/events/stream` (SSE via sse-starlette, keepalive).
- [x] Frontend: device-row wake/stop (+ dropfoot wake/`$ ping`) buttons → `useFleetActions` with
      `busy` spinner, optimistic offline-flip + rollback (shutdown), outcome **toasts**;
      **confirm dialog ONLY for `shutdown`** (driven by the registry's `confirm`/`risk`, server
      token enforced underneath). `useEventStream` refreshes the fleet on any recorded event.
- [x] **Verify:** backend end-to-end exercised (registry, decide(), confirm dance + single-use
      token, 404/422, audit trail, live SSE push); `tsc -b` + `vite build` clean; **owner ran the
      live stack against the real fleet (2026-05-27) — fleet pings real hosts + a real WOL wake from
      the UI works.** (Shutdown against a real host + the confirm-dialog UX still untested — needs a
      host with SSH reachable; not a blocker.)

## Phase 3 — Services

- [x] `Service` model (`domain/service.py`) + per-OS `start/stop/restart` command maps in config
      (`config.py` `ServiceCfg`, nested under each `computers:` host; `Settings.services()` projects
      them with stable id `"{host_id}.{svc_slug}"`). State is **derived** (TCP port probe), not stored.
- [x] `start_service` / `stop_service` / `restart_service` / `open_service_url` actions
      (`services/actions/`, one file each; start/open `risk=LOW`, stop/restart `risk=MED` so they
      gate at `Privilege.CONFIRM`). `ServiceService` (`services/svc.py`) derives liveness via a
      cached concurrent port-probe sweep keyed off the fleet host status. Events as usual
      (`_record` now targets `service_id`).
- [x] `GET /api/services` (DTO + derived status + url + per-OS `controls`), `POST
      /api/services/{id}/actions/{action}` (delegates to `ActionService`, same confirm-token dance).
- [x] Frontend: Vapor `.svc-row` (led + name + `host:port` addr + ↗/— arrow → service URL) inside
      the device-row dropdown, replacing the empty state; `useServices` polls `['services']`; `· N
      svc` in the row sub; `useEventStream` now invalidates `['services']` too.
- [x] **Verify:** backend `compileall` clean + a synthetic-config `TestClient` run (registry risk/
      confirm, derived port status online/offline, url/controls DTO, open returns url, start runs /
      stop gates→token→single-use, 404s, no-command→DENIED, audit trail); boots clean against the
      real config (`/api/services` → `[]`); frontend `tsc -b` + `vite build` clean. **Not yet
      exercised against a real service host** (needs SSH reachable + a real service) — the start/
      stop/restart SSH path is identical to shutdown_host, which is also pending a live host.

## Phase 4 — Agent chat (text first)

**Sliced (handoff): each sub-slice independently runnable.** ⭐ **4a (text round-trip) + 4b (agent
tools + confirm bubbles) are DONE.**

### 4a — chat foundation (text round-trip) ✅
- [x] **Studied prior art** (`RESEARCH.md`) — adopted opencode's message-has-parts + the loop
      shape + SSE-stream contract; Claude-Code patterns from public docs only.
- [x] `adapters/inference.py` `InferenceClient`: one OpenAI-compatible `AsyncOpenAI` per mode
      (cached), `stream_chat` yields `ChatDelta(text|reasoning)` (handles thinking-model
      `reasoning_content`); `InferenceCfg` (local/cloud endpoints, `default_mode`, long timeout) in
      `config.py` + `config.yaml` (local `minig+` @ `192.168.1.137:5001`).
- [x] `domain/conversation.py` (Thread + Message + Part union: text/reasoning/error) +
      `services/conversation.py` (Thread/Message repos, parts as JSON). `GET/POST /api/threads`,
      `GET /api/threads/{id}/messages`.
- [x] `services/agent/session.py` `AgentSession.run_turn` (text-only loop) → `POST /api/agent/chat`
      streaming over SSE (`thread`/`message.start`/`reasoning.delta`/`text.delta`/`message.end`/
      `error`/`done`, DESIGN §12).
- [x] Frontend: `store/chat.ts` (dep-free streaming store + fetch-ReadableStream SSE parser),
      Agent tab renders Vapor bubbles (sys/user/bot) + dimmed reasoning disclosure + streaming
      caret, shared composer `send` → chat (+ jump to Agent tab).
- [x] **Verify:** `compileall` + `TestClient` (threads CRUD, SSE event order, reasoning+text
      persisted, error path) all pass; **live round-trip against `minig+`** works (14 `text.delta`
      over SSE, clean answer, persisted); `tsc -b` + `vite build` clean; Agent tab reviewed @390px.

### 4b — agent tools + confirm bubbles ✅
- [x] **Aggregated toolset** → OpenAI `tools`: `ToolRegistry.agent_tools()` + `to_openai_tools()`
      (`input_model` → JSON Schema). `ToolCallPart`/`ToolResultPart` added to the Part union;
      `adapters/inference.py` reassembles streamed tool-call fragments (`ChatDelta.tool_calls`).
      (MCP tools merge into the same toolset in 4f.)
- [x] **Tool-call loop + permission gate** (`AgentSession.run_turn`): assemble (incl. prior
      tool_calls/results in OpenAI shape, synth `skipped` for abandoned confirms) → call w/ tools →
      ALLOW runs via the existing `ActionService` (validates/decides/executes/records Event) · DENY +
      bad-args synth a clean result fed back · **CONFIRM suspends** (`AWAITING_CONFIRM`, `tool.permission`
      event w/ the single-use token, `done(suspended)`). `MAX_ITERATIONS=8`. `POST /api/agent/resume`
      (execute|dismiss + token) finishes the step + continues the loop over a fresh SSE stream.
- [x] **Command/action bubbles** (frontend): Vapor `.b.cmd` pairs `tool_call`+`tool_result` by
      `call_id`; med/high-risk show execute/edit/dismiss wired to `resumeCall()`; low-risk auto-run
      (agent privilege=CONFIRM). Net-new outcome line in `extras.css` (vapor.css verbatim, D7).
- [x] **Verify:** `compileall` + a `TestClient` run (stubbed scriptable inference + synthetic
      LOW/HIGH tools): ALLOW loop, CONFIRM suspend→resume(execute), persistence round-trip,
      resume(dismiss)→skipped, bad-args tolerated; `tsc -b` + `vite build` clean. **Live `minig+`
      tool-calling + the bubble @390px not yet eyeballed by the owner.**

### 4c+ — routing, plan, compaction, MCP (next)
- [ ] Capability fallback for weak local models (draft-into-bubble, no native tools). *(Eyeball
      `minig+` native tool-calling first — if unreliable, build the prompted-JSON path into the same
      `ToolCallPart` flow.)*
- [x] **MCP client (4f, D9):** **Streamable HTTP + stdio done** — `adapters/mcp_client.py` `McpClient`
      discovers each configured server's tools at startup and registers an `McpTool` wrapper per
      tool into the **same** registry (so they flow through `ActionService` + the confirm gate + the
      `.b.cmd` bubble). Names namespaced `mcp__<server>__<tool>` (OpenAI charset, ≤64); native
      `inputSchema` handed to the model via new `ToolSpec.raw_schema` (input validation is a
      permissive passthrough — the remote validates). Per-server `risk` (default `med` → gates;
      `low` auto-runs) + **failure isolation** (a down server logs + registers 0 tools, never fatal).
      Connection is **per-call** (fresh short-lived session) to dodge anyio-task-group lifecycle
      pitfalls. **Both transports wired** in `_session()`: Streamable HTTP (`url`/`headers`) and
      **stdio** (`command`/`args`/`env`, operator env merged onto the SDK default so `PATH`/`npx`
      resolve). `McpServerCfg` + `Settings.mcp_servers`; `mcp==1.27.1` pinned; wired in `main.py`
      lifespan (`app.state.mcp` + `mcp_summary`). Verified unit (fake session) + **live**: emma's
      web-tools over Streamable HTTP (5 tools, real `search_web` call) **and** a stdio
      `@modelcontextprotocol/server-filesystem` via `npx` (14 tools; its `readOnlyHint`/`destructiveHint`
      annotations drove reads→LOW/auto-run, writes→HIGH/confirm — proving annotation-aware risk).
      **Remaining:** hot re-discovery on config change (Phase 7).
- [x] **SearXNG `web_search` tool (4f, D9):** a LOW-risk `category="utility"`, agent-only `@action`
      (`services/actions/web_search.py`) over a new `adapters/searxng.py` `SearxngClient` (cached
      `httpx.AsyncClient`, hits `/search?format=json`, normalizes hits, raises `SearxngError` on
      down/non-JSON/bad-status). `SearxngCfg` (`base_url`/`enabled`/`timeout_s`/`language`) added to
      `Settings`; client wired onto `Deps.searxng` in `main.py` (closed at shutdown). Auto-runs in
      the agent loop (LOW → ALLOW); unconfigured/disabled → clean `DENIED`. Verified unit (mocked
      transport: happy/empty/HTML-not-JSON/403/unconfigured/disabled) + **live against emma's
      instance** (real results, JSON format enabled). *(Results render in the existing `.b.cmd`
      bubble via the summary/outcome line; a richer results panel is a later polish, not blocking.)*
- [x] **open-terminal tools (4f):** curated typed actions over open-webui/open-terminal's REST API
      (a Bearer-auth remote shell + file ops — *not* MCP). `adapters/openterminal.py` client +
      `services/actions/terminal.py` (`terminal_exec`/`read_file`/`list`/`grep`/`glob`/`write_file`),
      registered dynamically via `register_openterminal(registry, cfg)` so **risk is per-op and
      configurable**: reads LOW (auto-run), `exec`+writes HIGH (confirm — it's arbitrary remote
      shell). `OpenTerminalCfg` + `Settings.open_terminal`; wired on `Deps.open_terminal` + `main.py`.
      Verified unit + **live against emma** (exec confirm round-trip, single-use args-bound token,
      nonzero-exit→ERROR, read-only auto-run). The remote analog of the Phase-5 guarded shell.
- [x] **Generic OpenAPI tool provider (4f):** `adapters/openapi_tools.py` `OpenApiToolProvider` —
      fetches each configured server's OpenAPI doc and registers every operation as `api__<server>__
      <opId>` into the shared registry (HTTP sibling of the MCP client). Hands the model a
      **self-contained** JSON Schema (path/query params as top-level props + requestBody as a nested
      `body`, `#/components/schemas` `$ref`s rewritten to local `$defs`), reusing `ToolSpec.raw_schema`;
      flat args split back into path/query/header/body on call. **GET/HEAD auto-run (LOW)**, mutating
      verbs use per-server `risk` (default med → confirm). Per-server failure isolation. `OpenApiServerCfg`
      + `Settings.openapi_servers`; wired in `main.py` (`app.state.openapi` + `openapi_summary`).
      Verified live by pointing it at open-terminal's own `/openapi.json` (12 ops discovered, schema
      `$defs`/ref-rewrite correct, GET auto-ran, POST gated→token→ran). For Open WebUI tool servers etc.
- [x] **Embeddings client (4f, D9):** `adapters/embeddings.py` `EmbeddingsClient` — OpenAI-compatible
      `/v1/embeddings` (local llama.cpp or cloud), `embed(texts)→vectors` (input order preserved).
      `EmbeddingsCfg` (base_url/api_key/model/dim) + `Settings.embeddings`; on `Deps.embeddings` +
      `main.py`. Wired to **OpenRouter `qwen/qwen3-embedding-4b`** (same key as cloud chat — OpenRouter
      *does* serve embeddings); verified live (2560-dim vectors, cosine sanity). No consumer yet — the
      vector `MemoryProvider` + semantic recall land in Phase 7; this is the tested seam they plug into.
- [x] **Composer prefix routing (4c):** `!` (configurable sigil, const in `lib/composer.ts`) →
      guarded exec — **routed + Phase-5-stubbed** (echoes the intent + a "not wired yet" note, no
      fake exec); `/` → slash commands (`/local`,`/cloud` force the backend per-message *or* set a
      sticky session mode when bare; `/clear` new thread; `/help`), else → agent. Per-message `mode`
      plumbed `ChatRequest.mode` (sanitized to local|cloud) → `run_turn` → `_drive` → `stream_chat`.
      **Markdown** bot replies via a hand-rolled dep-free `lib/markdown.tsx` (headings/lists/quote/
      hr/bold/italic/inline+fenced code/links) — fenced blocks get **copy + send-to-composer**
      (generalizes Vapor `editCmd`/`cmdInto`). Net-new `.md` CSS in `extras.css` (vapor.css verbatim).
- [x] **`task_plan` built-in tool (4d, D10):** agent maintains a per-thread plan/task list (steps +
      status); rendered as a `plan` panel in chat. `domain/plan.py` (Plan + PlanStep) · agent-only
      builtin `services/agent/planning.py` (LOW, `category="builtin"`, `ui_exposed=False`) — rewrites
      the whole list each call (TodoWrite-style), echoes it in `ToolResult.data["plan"]`; no extra
      per-thread state (the plan rides the message history, so reload + the model's context recover it).
      Frontend: `AgentTab` renders the **latest** task_plan call as a checklist panel (per-step
      pending/active/done ticks), earlier ones collapse to a "plan revised" breadcrumb. Net-new
      `.b.plan` CSS from vapor tokens. *(Capability fallback for weak local tool-calling: still TODO.)*
- [x] **Context compaction (4e, D10/D11):** before each model call the loop estimates the
      working-context tokens; over `agent.compaction.threshold_tokens` (or on manual `/compact`,
      `force=True`) it folds the oldest **complete turns** into a single summary `system` message and
      flips the originals `compacted` (kept verbatim in SQLite — reload + audit see them). Cut snaps
      back to a `user` boundary so an assistant `tool_calls` is never split from its `tool` results;
      `keep_last_messages` is the recent floor. **Summarizer selectable** via
      `agent.compaction.summarizer{mode,model}` (`None` inherits the chat backend) over a new buffered
      `InferenceClient.complete`. Failure → truncation placeholder (still shrinks context, never drops
      DB rows). New `compaction` SSE event + `POST /api/agent/compact`; `/compact` slash verb +
      breadcrumb sys note. Files: `config.py` (AgentCfg/CompactionCfg/ModelRef), `adapters/inference.py`
      (`complete`), `services/agent/compaction.py` (`Compactor`), `services/agent/session.py` (loop
      check + `compact()`), `api/agent.py` (`/agent/compact`), `lib/composer.ts` + `store/chat.ts`.
- [ ] Frontend **Agent** tab: chat log + shared composer + streaming render + command/plan bubbles.

## Phase 4.5 — Skills + agents (D10/D11)

- [ ] Skill loader: discover `skills/<name>/SKILL.md` (frontmatter `name`/`description`/`allowed_tools`
      + instructions) + optional resources. Adding a skill = dropping a folder.
- [ ] **Skill auto-selection as a swappable strategy** (default informed by prior art; easy to
      replace/switch in settings). Decide the concrete algorithm here, with opencode/Claude-Code in hand.
- [ ] Invocation: **model-invoked** (select by description) + **user-invoked** via `/skill-name` (A4).
- [ ] **Agent definitions (D11):** `agents[]` config (prompt, backend+model, tools, skills,
      privilege, memory); select default; pick per chat/automation. The "main" agent is one definition.
- [ ] **Subagents (D11):** `spawn_subagent` tool → delegate scoped task to another agent definition
      (own context + tool subset), return result. **Orchestration = swappable strategy**, sensible
      default; decide specifics here. Depth/concurrency + privilege inheritance limits.
- [ ] Conf → **Skills** (list/enable/edit/add) + **Agents** (manage definitions, default, subagent
      settings).

## Phase 5 — Guarded shell (`$` escape hatch)

- [ ] `run_shell` action: capture stdout/stderr, **timeout**, target local or remote (SSH),
      `risk=high`, **excluded from agent tools by default** (setting), always logged.
- [ ] `POST /api/exec` (setting-gated). Frontend: `$` prefix routes here; result shown as a
      done command bubble.

## Phase 6 — Voice (STT + TTS)

- [ ] `POST /api/voice/stt` (multipart → OpenAI-compatible `/v1/audio/transcriptions`).
- [ ] `POST /api/voice/tts` ({text,voice} → `/v1/audio/speech` → audio stream).
- [ ] Frontend: push-to-talk mic (MediaRecorder) → STT → fills composer; auto-TTS toggle
      (`#ttsToggle`) plays assistant replies.
- [ ] **HTTPS via Tailscale Serve** so the mic works on Android (secure-context). Document it.
- [ ] **Verify** mic + playback on a real Android phone over the tailnet.

## Phase 7 — Conf tab (settings, prompts, memory, hosts CRUD)

- [ ] `GET/PUT /api/settings` (YAML-backed, secrets masked); `GET/PUT /api/prompts/{name}`.
- [ ] Hosts CRUD: `POST/PUT/DELETE /api/hosts/{id}` + Conf machine forms (port Vapor `machineFormHTML`).
- [ ] Memory mgmt: `GET /api/memory`, `POST`, `DELETE`; rolling-summary + pinned-facts; clear
      thread / clear all.
- [ ] Conf tab: inference/STT/TTS endpoints + models + voices, **embeddings endpoint**, server
      (host/port/poll/debug), appearance (theme/skyline/hero/waveform), prompt-file editors, memory panel.
- [ ] **Integrations panel (D9):** MCP servers manager (add/edit/enable; stdio `command+args+env`
      or Streamable-HTTP `url+headers`; show discovered tools per server) + **SearXNG** endpoint.

## Phase 8 — Tool registry + Utils (extensible, D8)

- [ ] **Tool registry framework:** `@tool(name, title, icon, input, agent_exposed)` → auto-exposes
      `GET /api/tools`, `POST /api/tools/{name}`, a generic Utils-tab card, and (optional) agent tool.
- [ ] Port `yt_captions` (transcript → JSON download) and `ip_info` (lookup) as registry tools.
- [ ] Add **`dns_trace`** as the first *new* tool — proves "add a tool = one file."
- [ ] Generic Vapor `.util` card component (uhead glyph + field + result kv/download), driven by
      each tool's declared input/result shape.

## Phase 9 — PWA, packaging, deploy

- [ ] vite-plugin-pwa manifest + service worker (app-shell precache; never cache `/api` writes).
- [ ] Prod: FastAPI serves `frontend/dist` (StaticFiles + SPA fallback), single origin.
- [ ] Deploy profiles: Windows `.bat`/Task Scheduler; Ubuntu `systemd` unit; Termux notes
      (`termux-wake-lock`, foreground service, high port).
- [ ] `debug=False` default; pinned deps; install scripts for both OSes.
- [ ] Minimal smoke tests (Playwright desktop + Android viewport; a couple of backend action tests).

## Phase 10 — Cutover

- [ ] Feature-parity check vs `wol_server_win.py` (WOL, monitor, shutdown, command box, chat, YT,
      IP lookup) + the new extensions.
- [ ] Run v2 alongside the old server; migrate `config.yaml`.
- [ ] Flip the default; retire `wol_server/` (or keep as Linux-WOL fallback). Update README/AGENTS.

---

## Post-v1 backlog (see ROADMAP.md — build v1 seams now)

Not v1 scope, but the owner wants these; v1 must leave room. Detail + design notes in `ROADMAP.md`.

- [ ] **v1 seams (do these *during* v1 so the backlog slots in cheaply):** pluggable
      `MemoryProvider` interface; action `risk` levels on every action; **typed chat-message kinds**
      (`text`/`action`/`question`) + turn-based agent loop; chat endpoint supports **streaming AND
      buffered**; a settings/policy layer; Conf tab in **functional groups**.
- [ ] Agent **privilege levels** (read-only → confirm-each → auto-low-risk → full) — policy over
      `risk` (ROADMAP A1).
- [ ] Agent **clarifying questions** (`question` bubble, pause/resume) (A2); **notify-and-wait**
      when unattended/low-privilege (bridges A1+A3+F1).
- [ ] **Slash commands** registry + custom/extensible commands (A4). *(Basic `!`/`/` prefix routing
      + markdown/copy is in Phase 4 above.)*
- [ ] **Scheduled automations**: `Automation` table + cron runner + headless agent runs (A3).
- [ ] **Streaming toggle** (`auto|on|off`) + non-streaming fallback wired through chat/STT/TTS (C1).
- [ ] **Wake word** (client-side, openWakeWord/Porcupine WASM, off by default) (C2).
- [ ] **Idle shutdown/sleep** per host (Win+Linux), **optional/opt-in**, incl. **real-idle
      detection mechanism** (helper agent?) — decide before building (D1). **Wake-on-connection** (D2).
- [ ] **Notifications** (F1): master toggle + per-event; default PWA-native (foreground
      Notifications API via SSE + **Web Push**/VAPID when closed, auto); optional **ntfy** /
      **Telegram-Discord** channels. **Discord/Telegram bots** as thin API clients (E1).
- [ ] **Security hardening**: known_hosts pinning, per-action tokens, secret encryption-at-rest (G).

## Cross-cutting / don't-forget

- [ ] Secrets: gitignore YAML + `*.db`; mask in API; never log SSH passwords / keys.
- [ ] Per-OS abstraction lives in the action layer / `platform` shim — no Windows/Linux-only
      imports at module import time (keeps Termux profile alive).
- [ ] Every privileged action writes an `Event` (audit trail visible in UI).
- [ ] Keep the Tailscale-only, no-auth, no-public-bind boundary intact (AGENTS.md §6).

## Open questions to resolve in-phase (from DECISIONS.md)

- [ ] Agent tool-call format + weak-model fallback specifics (Phase 4).
- [ ] SearXNG MCP: v1 or post-v1? (Phase 4+).
- [ ] Memory strategy final shape (Phase 7).
- [ ] Frontend routing: tab state vs react-router (Phase 1).
- [ ] Is `dashboard_v2/` tracked in git, and when to first commit? (Phase 0 — ask owner.)
