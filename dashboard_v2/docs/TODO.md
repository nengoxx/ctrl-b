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

- [ ] `backend/` FastAPI skeleton: app factory, `/api/health`, run with `uvicorn`. `pyproject.toml`
      with **pinned** deps (fastapi, uvicorn[standard], pydantic, pydantic-settings, sse-starlette,
      paramiko, wakeonlan, openai, httpx, pyyaml, python-multipart, youtube-transcript-api,
      beautifulsoup4, aiosqlite). Consider `uv`.
- [ ] `frontend/` Vite + React 19 + TS scaffold (lift config from `ws_claude`): TanStack Query,
      lucide-react, vite-plugin-pwa. Vite dev proxy `/api` → uvicorn.
- [ ] Copy `logo.png` + `favicon.ico` into `frontend/public/` (copy, don't import from old dirs).
- [ ] `config.py`: load/save `config.yaml` (reuse current shape) → typed `Settings`; secret masking.
- [ ] `db.py`: SQLite schema (threads, messages, memory, events) + tiny versioned applier.
- [ ] `.gitignore` for `config.yaml`, `*.db`, `node_modules`, `dist`, `__pycache__`, `.venv`.
- [ ] **Design foundation (D7):** extract `vapor.html`'s `<style>` into `frontend/src/theme/`
      verbatim (the `:root`/`[data-theme]` variables, base/component CSS) as the canonical
      stylesheet; set up `index.html` shell (JetBrains Mono + Major Mono Display fonts, favicon,
      `viewport-fit=cover`). Everything later styles against this — don't re-derive the design.
- [x] Tracking: `dashboard_v2/` is committed to the public repo (`main`).

## Phase 1 — Fleet read path (parity, done right)

- [ ] Pydantic `Host` model; load hosts from YAML.
- [ ] `hosts.py`: **concurrent** `asyncio.gather` ping status; per-OS ping shim.
- [ ] `GET /api/hosts`, `GET /api/hosts/{id}/status`.
- [ ] Frontend **Fleet** tab: **pixel-exact port** of the Vapor hero (sun/stripes/stars/grid +
      skyline SVG + live waveform), device rows + expandable detail (services + kv + wake/stop
      mask-icon buttons), fleet summary, appbar (logo lozenge + TTS toggle), bottom tab bar with
      sliding indicator — all animations intact. Wire to TanStack Query polling (interval from
      settings); replace mock `DEVICES` with API.
- [ ] Theme system (`vapor`/`aqua`/`ember`) + skyline city/mountains + app-mark logo/ring + hero/
      waveform toggles — ported from Vapor, behaving identically.
- [ ] **Verify side-by-side against `vapor.html`** at ~390px (D7): visually indistinguishable.

## Phase 2 — Actions (typed registry + WOL/shutdown)

- [ ] Action registry framework: `@action(name, risk, confirm)` + Pydantic inputs + `ActionResult`.
- [ ] Implement `wake_host`, `shutdown_host`, `ping_host`. Write each invocation to `Event`.
- [ ] `GET /api/actions` (registry/toolset), `POST /api/actions/{name}` (+ confirm token).
- [ ] `GET /api/events` + `GET /api/events/stream` (SSE).
- [ ] Frontend: device-row wake/stop buttons → mutations; **confirmation dialog** for high-risk;
      activity/event surfacing.
- [ ] **Verify:** wake + shutdown a real host from the UI.

## Phase 3 — Services

- [ ] `Service` model + per-OS `start/stop/restart` command maps in config.
- [ ] `start_service` / `stop_service` / `restart_service` / `open_service_url` actions.
- [ ] `GET /api/services`, `POST /api/services/{id}/actions/{action}`.
- [ ] Frontend: services inside the device-row dropdown (port Vapor `.svc-row`), state + open-URL.

## Phase 4 — Agent chat (text first)

- [ ] **First: study prior art** (`RESEARCH.md` → "Prior art for the agent/chat subsystem") —
      opencode's loop/session/permission patterns + public Claude-Code interaction patterns. (Do
      **not** use the leaked `claude-code` repo; use the Agent SDK + public docs.)
- [ ] `agent.py`: `openai` client → configured backend (local llama.cpp `/v1` or cloud).
- [ ] Threads/messages persisted in SQLite; `GET/POST /api/threads`, `GET messages`.
- [ ] `POST /api/agent/chat` streaming over SSE.
- [ ] **Aggregated toolset** → OpenAI `tools`: action registry + `agent_exposed` tools + MCP tools
      (namespaced). high-risk/confirm actions → **command/action bubble** (execute/edit/dismiss),
      low-risk configurable to auto-run.
- [ ] Capability fallback for weak local models (draft-into-bubble, no native tools).
- [ ] **MCP client (D9):** connect to configured MCP servers over **stdio** + **Streamable HTTP**
      (official Python MCP SDK); discover + merge tools; per-server enable + failure isolation.
      Start with one server end-to-end, then generalize.
- [ ] **SearXNG `web_search` tool (D9):** hits the configured local SearXNG `format=json`.
- [ ] **Embeddings client (D9):** wire the configured llama.cpp `/v1/embeddings` (powers the vector
      `MemoryProvider` when that lands).
- [ ] Composer prefix routing: `!` (configurable sigil) → guarded exec, `/` → slash commands
      (incl. `/local`,`/cloud` for backend), else → agent. Markdown rendering of bot replies +
      copy / send-to-composer on code blocks (generalize Vapor `editCmd`/`cmdInto`).
- [ ] **`task_plan` built-in tool (D10):** agent maintains a per-thread plan/task list (steps +
      status); render as a `plan` message-kind panel in chat. Extensible — more agent tools = one file.
- [ ] **Context compaction (D10/D11):** summarize older turns into the working context near the
      token limit (configurable threshold) + manual `/compact`; keep full history in SQLite; `sys`
      notice. **Summarizer model selectable** (local/cloud + name), independent of the chat model.
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
