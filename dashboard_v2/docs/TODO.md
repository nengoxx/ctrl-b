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

> **Status @ 2026-06-02:** Phases **0–4.5 + 7a–7d are done**, and the **UI performance pass
> (`docs/UI_AUDIT.md` Slices 1–8) is complete** — 10 of 13 findings shipped (F9 `useTransition`
> and F13 React Compiler deferred until measured pressure). 7a–7c are on `origin/main`; 7d +
> the perf pass + a follow-up a11y/resilience audit are committed locally (eight commits ahead,
> HEAD `bf549c4`, push pending owner go-ahead). Plus the capability/UX session — cloud chat
> wired; agent **loop-discipline guards** + tool-selection routing; the **`fleet` intent-skill**
> that fixes weak-model tool-selection (auto tool-narrowing; `skills: []` opts a capable model
> out); lenient `task_plan`; **`check_service`** + **`reboot_host`** (+ device-row button);
> **clickable plan-step dots** (persistent, agent-aware); an **OS-compatibility pass**
> (ping/commands detect the host OS — ready for emma/Linux); the **Windows `--reload` ping
> gotcha** documented (`fleet.ping_host` returns empty under reload — run plain on Windows);
> **sub-millisecond ping precision** (Windows `time<1ms` distinguished from `time=1ms`);
> **configurable hero feature-cycle** (`server.feature_cycle_seconds`); **Vapor-themed busy
> spinner** (conic-gradient ring). Detail in `HANDOFF.md`'s 2026-05-28 through **2026-06-02**
> blocks.
>
> **Recommended next sequence (advisory — phases below are NOT reordered):** three live
> candidates — (1) the **F14–F26 a11y/resilience backlog** documented in `docs/UI_AUDIT.md`
> §6c (F25 + F14 + F15 are the WCAG-critical ones; recommended order in the doc footer);
> (2) the **7e slice** (prompt-append + show/load the baked default + `<PromptModal>`
> full-page editor + Conf-sizing refine — planned 2026-05-30) → then 7e proper (prompt-file
> editors + memory panel); (3) a **thin emma/Linux deploy + Tailscale-Serve HTTPS** (the
> migration target; HTTPS also unblocks the mic) → **voice (6)** → **utils (8)**. **Phase 5
> (guarded shell) is back in scope (decided 2026-06-14):** the `!` composer prefix is the
> **local-shell UX** on the backend host (Claude-Code/Codex model — `!git status`), **not**
> open-terminal (which is a *separate remote box* over REST, an agent tool). See the Phase 5 section.

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
- [x] **`reboot_host`** (2026-05-28): restart sibling of `shutdown_host` — per-OS command (Windows
      `/r`, POSIX `shutdown -r now`), `risk=HIGH, confirm=True`, OS-command lookup degrades cleanly.
      Frontend: a device-row reboot button beside shutdown (wake-accent gradient, rotate glyph),
      shown with shutdown when online / wake-only when offline.

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
- [x] **`check_service`** (2026-05-28): live **TCP-probe** a service (reuses `ServiceService.status_of`;
      reports DOWN if the host is offline) so the agent can actually confirm a service is up. Fixes a
      correctness bug where the model treated `open_service_url` (which only *builds* the link, no
      probe) as proof of liveness; both descriptions updated. Verified live with emma off.

## Phase 4 — Agent chat (text first)

**Sliced (handoff): each sub-slice independently runnable.** ⭐ **4a (text round-trip) + 4b (agent
tools + confirm bubbles) are DONE.**

### 4a — chat foundation (text round-trip) ✅
- [x] **Studied prior art** (`RESEARCH.md`) — adopted opencode's message-has-parts + the loop
      shape + SSE-stream contract; Claude-Code patterns from public docs only.
- [x] `adapters/inference.py` `InferenceClient`: one OpenAI-compatible `AsyncOpenAI` per mode
      (cached), `stream_chat` yields `ChatDelta(text|reasoning)` (handles thinking-model
      `reasoning_content`); `InferenceCfg` (local/cloud endpoints, `default_mode`, long timeout) in
      `config.py` + `config.yaml` (local `minig+` @ `192.168.1.137:5001`). *(2026-05-28:
      `inference.cloud` wired to OpenRouter `gemma-4-31b-it:free` — same key as embeddings;
      `default_mode` stays `local`, `/cloud` opt-in; free tier is rate-limited.)*
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
- [x] Capability fallback for weak local models. **Resolved (2026-05-28 finding, prompted-JSON
      DROPPED 2026-06-16):** `minig+`'s *native* tool-calling works fine; the real weak-model problem (it
      hallucinates names / mis-picks from the big namespaced toolset) is fixed by the **`fleet`
      intent-skill** (auto tool-narrowing) + **loop-discipline guards** (`max_repeat_calls` /
      `max_calls_per_tool` / `max_stall_iterations` + forced final answer) + **lenient `task_plan`**.
      **The prompted-JSON path is dropped** (native-only — the owner runs only native-tool-capable
      models; revisit from scratch if that ever changes).
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
- [x] Frontend **Agent** tab: chat log + shared composer + streaming render + command/plan bubbles.
      *(Done across 4a–4d. 2026-05-28: **clickable plan-step dots** — tap a dot in the pinned panel to
      toggle done/undone; `POST /api/agent/plan` updates the latest `task_plan` call's args + result
      in place, so it's persistent AND the agent sees it next turn; reuses message history.)*

## Phase 4.5 — Skills + agents (D10/D11)  ⭐ backend DONE

- [x] Skill loader: discover `skills/<name>/SKILL.md` (frontmatter `name`/`description`/`allowed_tools`
      + instructions) + optional resources. Adding a skill = dropping a folder. *(`core/skills.py`
      protocols + `services/agent/skills.py` `FileSkillProvider`; re-scans per call; example skill
      shipped at `skills/web-research/`.)*
- [x] **Skill auto-selection as a swappable strategy.** Default = `KeywordSkillSelector`
      (token-overlap on name+description — deterministic, model-agnostic so it works with a weak
      local model). The `SkillSelector` protocol keeps an LLM-based selector a drop-in.
- [x] Invocation: **model-invoked** (description match) + **user-invoked** via `/skill-name` (A4) —
      composer routes a `/verb` matching a discovered skill; `ChatRequest.skills` + `GET /api/skills`.
      Active skills inject instructions into the system prompt + **narrow** the toolset to their
      `allowed_tools` (intersected with the agent allowlist; never widened).
- [x] **`fleet` intent-skill + the weak-model finding (2026-05-28).** Proven live that `minig+` isn't
      too weak — the full 21-tool *namespaced* set confused it (hallucinated names, spammed search).
      `skills/fleet/SKILL.md` (fleet tools only) **auto-activates** on a fleet ask and narrows the
      toolset → went from a 16-search spiral to 4 clean calls + accurate answer. **Opt-out for a
      capable model: `skills: []`** (full toolset, own judgment). Documented in `config.example.yaml`.
- [x] **Agent definitions (D11):** `domain/agent.py` `AgentDef` (prompt, backend+model via `ModelRef`,
      tool/skill allowlists, privilege, loop + subagent limits); `Settings.agents[]` +
      `resolve_agent(name)` (named/default/built-in fallback). The loop is driven by an `AgentDef`
      (`AgentSession`); the default chat agent is a synthesized definition. *(Memory config: Phase 7.)*
- [x] **Subagents (D11):** `spawn_subagents` builtin (`services/agent/subagents.py`) → delegate a
      **batch** of scoped tasks to other agent definitions (own ephemeral thread, headless), run via
      a swappable `Orchestrator` (default `ParallelOrchestrator`: `asyncio.TaskGroup` + per-agent &
      tree-wide semaphores). Depth bounded by `max_subagent_depth`; child privilege **clamped** to
      the parent; per-child error/timeout isolated (partial success preserved).
- [x] Conf → **Skills** (list/enable/edit/add) + **Agents** (manage definitions, default, subagent
      settings). **Done in Phase 7d** (`AgentsEditor`/`SkillsEditor`); skill files edited via new
      `GET/PUT/DELETE /api/skills/{name}`, agents via `PUT /api/settings`.

## Phase 5 — Guarded local shell (the `!` escape hatch) — **specced 2026-06-14**

> The Claude-Code/Codex `!` model: the **user** types `!<cmd>` to run a real shell command **on the
> backend host** (the box running ctrl-b — corsair/emma). Distinct from open-terminal (a *remote* box
> over REST, used as an agent tool). Decisions locked 2026-06-14:
> - **Target = local backend host only** (other fleet hosts stay the job of SSH actions + open-terminal).
> - **Workdir = configurable `shell.workdir`, default `$CTRLB_HOME`** (Conf-editable).
> - **Output feeds the agent's context** (Claude-Code behavior: `!git log` → bubble *and* available to
>   the next turn) — redacted + truncated like any tool output.
> - **User `!` enabled by default**, `shell.user_exec_enabled` toggle to disable. The **agent's**
>   `run_shell` tool stays **separate + excluded-by-default** (D3 / `permissions.decide` already gates it).

- [ ] `run_shell` action (local exec via `asyncio.create_subprocess_exec`): capture stdout/stderr,
      **kill-on-timeout**, per-OS shell (Windows pwsh/cmd · Linux bash — a legitimate server-OS branch),
      cwd = `shell.workdir`, `risk=HIGH`, redact + truncate output, always logged as an `Event`.
- [ ] `POST /api/exec` (gated by `shell.user_exec_enabled`). Composer **`!` prefix** routes here;
      result shown as a done command bubble **and** appended to the thread so the agent sees it.
- [ ] `shell.workdir` + `shell.user_exec_enabled` config + Conf controls; keep the agent-facing
      `run_shell` tool excluded-by-default (separate setting).

## Phase 6 — Voice (STT + TTS)

- [ ] `POST /api/voice/stt` (multipart → OpenAI-compatible `/v1/audio/transcriptions`). **Always
      buffered** (push-to-talk record-then-send) — no streaming toggle (C1 decision 2026-06-16).
- [ ] `POST /api/voice/tts` ({text,voice} → `/v1/audio/speech` → audio stream). **Own streaming knob**
      in the voice config block (full-clip vs chunked playback; the latency win is sentence-pipelining
      with the chat stream) — decoupled from chat's `AgentCfg.streaming` (C1 decision 2026-06-16, D17).
- [ ] Frontend: push-to-talk mic (MediaRecorder) → STT → fills composer; auto-TTS toggle
      (`#ttsToggle`) plays assistant replies.
- [ ] **HTTPS via Tailscale Serve** so the mic works on Android (secure-context). Document it.
- [ ] **Verify** mic + playback on a real Android phone over the tailnet.
- [ ] **Mic-button state machine** (folded in from UI_AUDIT.md F21, deferred 2026-06-08):
      The Composer mic today is a visual stub — taps toggle a local `rec` boolean + a
      `micrec` keyframe pulse but no MediaRecorder is wired, so users tap it expecting
      dictation and nothing happens. Phase 6 owns the full lifecycle: capability probe
      (secure-context + permission state), disabled-with-tooltip when unsupported / denied,
      `aria-disabled` + muted Vapor styling for the inert state, then the active recording
      states when STT actually runs. Re-using the existing `.rec` class for the recording
      state is fine — drop the local `useState(rec)` and drive it from the recorder's
      actual state. Do NOT ship a "honest disable" intermediate slice — the disable would
      be undone the moment the recorder lands. Keep the button visible the whole time
      (it's part of the Vapor composer layout — D7).

## Phase 7 — Conf tab (settings, prompts, memory, hosts CRUD) — **sliced 7a–7e**

> **Pre-slice audit (2026-05-29):** see [`AUDIT_settings.md`](./AUDIT_settings.md). It found a
> latent blocker (`save_settings` can't serialize a `StrEnum` → crashes the moment a config carries
> an agent's `privilege`) + a secret round-trip data-loss edge + the hot-reload scalability seam.
> Those fixes are folded into **7a** below.

### Phase 7a — settings read/write foundation + Inference & Server groups ✅ DONE
- [x] **`GET /api/settings`** → `mask_secrets(settings.model_dump(mode="json"))`. (`api/settings.py`)
- [x] **`PUT /api/settings`** — partial deep-merge patch → `unmask_secrets` → `model_validate`
      (422 on `ValidationError`) → comment-preserving patch write → `reconfigure` → masked echo.
- [x] **(audit A1)** `save_settings` enum-safe via `mode="json"` (StrEnum→str). *Was a latent blocker.*
- [x] **(audit A2)** `unmask_secrets(incoming, stored)` — masked/empty secret = unchanged → keep stored.
- [x] **(audit B1/B2)** `app/runtime.py` `reconfigure()` seam — single-source `set_*` builders shared
      by lifespan + reconfigure (no drift); in-place shared-`Settings` update for live readers; rebuild
      `InferenceClient`; cache invalidation (B4); PUT `asyncio.Lock`. Extends toward `build_runtime` (7c).
- [x] **(audit B3)** `restart_required` paths (`server.host/port/debug`) in the PUT response + UI note.
- [x] **(audit E1/E2)** **comment-/EOL-preserving patch writer** (`apply_patch_to_yaml`, `ruamel.yaml`):
      a UI save edits only changed leaves in place — comments/order/quoting/minimal-style + LF/CRLF kept.
- [x] **(audit C2)** `tests/test_settings_7a.py` (7 cases): enum round-trip, secret preserve/update,
      deep-merge, prune-unchanged, comment-preserve, EOL-preserve, + TestClient GET/PUT/422/live-apply.
- [x] Conf tab: **Inference** group (mode, local/cloud base_url·model·api_key, timeout, system prompt)
      + new **Server** group (host/port/poll/debug) wired to live data; `useSettings`/`useSaveSettings`
      + `putJSON`; dirty-tracked Save + toast. Appearance stays UI-store-only. **Owner D7 eyeball pending.**

### Phase 7b — hosts/services CRUD ✅ DONE (commit pending)
- [x] Hosts CRUD: `POST/PUT/DELETE /api/hosts/{id}` (`api/hosts.py`) + Conf machine forms ported from
      Vapor (`components/MachineEditor.tsx`) + **net-new services sub-editor** (name/kind/port/path/
      autostart + per-host-OS start/stop/restart cmd; add/remove). **Dedicated endpoints** (not the
      scalar settings merge — audit A2). Blank password keeps the stored secret; rename re-keys the
      entry (preserving inner field comments) + re-slugs the id; removed services synced away.
- [x] Generalized the comment/EOL-preserving writer: `edit_config_yaml(mutate)` + `sync_mapping`
      (`config.py`) — one chokepoint for every YAML write; reused by 7a's patch path + hosts CRUD,
      and the seam 7c's list editors build on. `reconfigure(app, load_settings())` hot-applies +
      invalidates fleet/service caches (audit B4) → new/edited machine shows next poll, no restart.
- [x] `tests/test_hosts_7b.py` (TestClient on a **temp** config, audit E3): list DTO (has_password,
      no secret, services), add + 409 collision, edit (blank-pw kept, comments preserved, services
      add/remove synced), multi-OS `cmd` preserved, rename (re-keyed id + carried services + secret),
      delete + 404, 422 on missing ip. Frontend: `useHostMutations` + `del()`; delete confirms.
- **Known limitation:** a comment physically *trailing a deleted element* is dropped with it (ruamel);
  leading section comments (the owner's style) survive. **Owner D7 eyeball pending** (@390px ×3 themes).

### Phase 7c — integrations panel (D9) ✅ DONE (commit pending)
- [x] **7c-a — scalar integrations:** SearXNG / embeddings / open-terminal Conf groups via the
      existing `PUT /api/settings`; `reconfigure` extended with async `set_searxng`/`set_embeddings`/
      `set_open_terminal` single-source builders (rebuild client + repoint `app.state.*`/`deps.*`,
      await old `aclose`) → **hot-apply, no restart**.
- [x] **7c-b — MCP + OpenAPI managers + rediscover** (`api/integrations.py`, `components/
      ServerListEditor.tsx`): list CRUD keyed by name (comment/secret-safe via `edit_config_yaml`+
      `sync_mapping`), `GET /integrations/status` (per-server discovered-tool summaries + dirty flag),
      add/edit/enable/delete (stdio `command+args+env` or HTTP `url+headers`; OpenAPI base/spec/auth/
      include). **Apply between turns** (owner's design): a write flips `integrations_dirty` →
      `POST /agent/chat` re-discovers before building the toolset; a manual **Rediscover** button
      (`POST /integrations/rediscover`, 409 while a turn is active) applies on demand. No process
      restart. `ToolRegistry.remove`/`remove_category("mcp")` clears MCP+OpenAPI tools before re-run.
- Tests: `test_integrations_7c.py` (scalar hot-apply, MCP CRUD + dirty + 409/404, rediscover busy/empty,
  registry removal). STT/TTS endpoints still deferred to Phase 6 voice. **Owner D7 eyeball pending.**

### Phase 7d — skills/agents management (the A7 deferral) + per-tool descriptions ✅ DONE (commit pending)
- [x] **7d-a — per-tool description overrides:** `Settings.tool_descriptions` + `runtime.apply_tool_descriptions`
      overlay onto the live registry specs (capturing originals so clearing restores the built-in),
      wired in lifespan/reconfigure/rediscover. Conf → **Agent tools** group edits them via `PUT
      /api/settings`. Tests: `test_tool_descriptions_7d.py` 2/2.
- [x] **7d-b — Agents management** (`components/AgentsEditor.tsx`): manage `agents[]` (name/backend/model/
      privilege/prompt, **tools-per-agent tick-grid**, skills all/none/custom, loop+subagent limit grid),
      the **default agent**, and subagent settings (fan-out limit, clamp-privilege). Saved through `PUT
      /api/settings` (whole-list replace + section deep-merge; full objects round-trip). **`/agent <name>`
      composer switch** (`ChatRequest.agent` + `_session` override; `GET /api/agents` for names+default).
      Tests: `test_agents_7d.py` 1/1 (StrEnum privilege round-trip — A1, hot-apply, 422, clear→built-in).
- [x] **7d-c — Skills management** (`components/SkillsEditor.tsx`): master `skills_enabled` toggle, list +
      raw `SKILL.md` editor + add/remove via new `GET/PUT/DELETE /api/skills/{name}` (slug-guarded,
      EOL-preserving, scaffold template; provider re-scans → live, no restart). Tests: `test_skills_7d.py`
      1/1. **Owner D7 eyeball pending:** the Agents/Skills/Agent-tools forms @390px ×3 themes.

### Phase 7e — agent workspaces: append/persona/memory (file-based, portable) — **D14**

> **Reshaped 2026-06-14 (D14).** The agent becomes a general-purpose assistant with **portable,
> file-based** persona + memory modelled on **Hermes Agent / OpenClaw**, on our **in-process**
> multi-agent runtime (NOT their separate-process model). Per-agent **workspace folders**
> (`agents/<name>/ = agent.yaml + SOUL.md + MEMORY.md + skills/`); `config.yaml` keeps only globals,
> and **`agents:[]` is fully removed once folders are the source of truth.** Conversations stay in
> central `ctrlb.db` (agent-agnostic). See D14 for the full rationale + the deliberate divergences.

- [x] **7e-a — system-prompt append layer + show/load the baked default** (shipped `d4cd25c`).
      `Settings.inference.system_prompt_append` + `AgentDef.prompt_append` + `inherit_append` emitted
      as **separate `system` messages** by `_assemble`; `GET /api/agent/default-prompt` returns the
      baked `DEFAULT_SYSTEM_PROMPT`. The injection seam every persona/memory block below reuses.
- [x] **7e-b — `<PromptModal>` full-page editor + Conf-sizing refine** ✅2026-06-14 (`d92aff6`,
      `62935af`). One reusable full-viewport modal opened imperatively via `requestPrompt()`
      (`store/prompt.ts` + `components/PromptModal.tsx`, same store/host pattern as `ConfirmDialog`);
      inline rows shrank to preview (`lib/promptPreview.ts`) + opener. `[Load default]`/`[Restore
      default]` fed by `useDefaultPrompt` → `/api/agent/default-prompt`; char counter only; text seeded
      during render (no flash). Wired System prompt (+append), per-agent Prompt (+append +
      `inherit_append`), Skills SKILL.md (inline + fullscreen opener). Conf-sizing refine bundled
      separately. Net-new CSS in `extras.css`; vapor.css untouched (D7).
- [x] **7e-c — per-agent workspace foundation (D14). COMPLETE ✅2026-06-16.** **Agents-as-folders DONE ✅2026-06-14**
      (`0a30375` backend, `3e34d9c` frontend, `fc15ceb`/`e417859` refine/fix): `$CTRLB_HOME` +
      `agent.defaults` merge + folder discovery + SOUL.md→prompt + `agents:[]` removed (no migration,
      no-op confirmed) + file API (`GET/PUT/DELETE /api/agents/{name}` + `…/soul`) + **display names**
      (`AgentDef.title` / `agent.default_title`, slug stays the `/agent` id) + `AgentsEditor` repointed
      as the unified list (default row + specialists; Skills control now matches Tools). Also added
      `agents_dir_path()`/`memories_dir_path()` (the 7e-d seam). **`messages.agent` DONE ✅2026-06-16**
      (`680b310`): nullable migration #2 + per-turn attribution (loop + finalize) + resume order
      (last-assistant → thread → default) + `message.start` live label + frontend label
      (`useAgentRoster`) + `test_messages_agent_7e` (5 tests). The original full spec follows for reference:
- [x] **7e-c (cont.) — `$CTRLB_HOME` reference + `messages.agent` (DONE ✅2026-06-16).** Define the relocatable **`$CTRLB_HOME`** root
      (env var, default `~/.ctrl-b/`; composes with `CTRLB_CONFIG`/`CTRLB_DB`) holding `config.yaml` +
      `ctrlb.db` + `SOUL.md` + `memories/` + `skills/` + `agents/`. The **default agent lives at the
      root** (root `SOUL.md`/`memories/`/`skills/`, no `agent.yaml` — it *is* the config.yaml globals);
      **`agents/<name>/` holds specialists only** (distinct identity/model/memory — `fleet` stays a
      *skill*, not an agent). Configurable base dir, scan-based discovery + live reload. **`agent.yaml`**
      = `AgentDef` minus `name`/`prompt`, carrying **only overrides** — absent fields inherit a
      config.yaml **`agent.defaults`** block via `deep_merge(agent.defaults, agent.yaml)` at load (the
      same merge `PUT /api/settings` uses). **`SOUL.md`** = persona, **scaffold-if-missing** from
      `DEFAULT_SYSTEM_PROMPT` + a setting to disable the baked default entirely (empty = empty).
      File-per-agent API (`GET/PUT/DELETE /api/agents/{name}/...` — SOUL.md editor + `agent.yaml`
      wiring). **Agents are folder-only (D15 #3):** remove the `agents:[]` field from the `Settings`
      schema; `resolve_agent`/`default_agent_def` read folders. **No migration feature** — relocate any
      existing live-config `agents:[]` entries to folders by hand during this slice (likely a no-op).
      Repoint `AgentsEditor` (+ `test_agents_7d`) to the file API with a first-class **add-agent flow**
      (scaffolds the folder) + edit/delete, well-designed @390px (D7). Tests on a temp workspace dir.
      **Session attribution (D14):** add a nullable **`messages.agent`** column (additive migration;
      null = legacy/default) set to the resolved AgentDef name on each assistant message → restore
      shows the per-turn agent across mid-thread `/agent` switches, **resume prefers the last
      assistant turn's agent**, and `session_search` (7e-e) can attribute/filter by agent.
      `threads.agent` stays the thread's primary/default.
- [~] **7e-d — file memory: `FileMemoryProvider` + `memory` tool (D14).** Sub-sliced d-1/d-2/d-3.
  - [x] **7e-d-1 — read path ✅2026-06-16 (`16bde75`).** `MemoryCfg` (`Settings.memory`: enabled /
        user_profile_enabled / auto_write / caps 2200/1375) + `MemoryProvider` protocol (`core/memory.py`,
        mirrors `SkillProvider`) + `FileMemoryProvider.load_context` (`services/agent/memory.py`):
        per-agent `memories/MEMORY.md` (default → root `memories/`; specialist → `agents/<slug>/memories/`)
        + global `memories/USER.md`, injected as a `system` message right after `_appends()` (D15 #4) with
        Hermes usage headers. Wired on `Deps.memory` + `app.state.memory`; `AgentSession.memory=` +
        `_memory_block()`; subagents pass it. `memories/` + `agents/*/memories/` gitignored. Tests:
        `test_memory_7e.py` (6).
  - [ ] **7e-d-2 — `memory` tool / write path (NEXT).** A `@action(category="builtin",
        ui_exposed=False, risk=LOW)`: `add`/`replace`/`remove`, `target: memory|user`, substring
        `old_text`, **no read**. Extend `FileMemoryProvider` with `write(agent, target, action, content,
        old_text)` (`add` = `§`-delimited entry; replace/remove on substring). **Cap enforcement:**
        over-cap → provider raises → tool returns an ERROR `ToolResult` so the agent consolidates.
        **`auto_write` kill switch (default ON):** OFF = **propose-only, non-blocking** (no write, no
        suspend); the Approve-to-apply UI is **deferred to 7e-f** (shared with `skill_manage`). Writes
        auto-audited via `ActionService._record`. `user` target gated by `user_profile_enabled`.
  - [ ] **7e-d-3 — Conf Memory panel (frontend).** View/edit/clear the files + caps + toggles; needs
        `read_raw`/`clear` on the provider + small read/write API endpoints (mirror the skills file API).
  - Vector recall = the later "both" mode over the unused `memory` table + the 4f embeddings client.
- [ ] **7e-e — `session_search` (Hermes Tier 2).** An **FTS5** index over the `messages` table + a
      builtin tool the agent invokes autonomously. Sessions stay agent-agnostic in `ctrlb.db` (D14).
- [ ] **7e-f — per-agent skills (inheritance) + `skill_manage` self-authoring (D14).** Wire per-agent
      `skills/` (global `skills/` = the default agent's set; each agent its own folder), with
      `agent.yaml` **`skills_inherit`**: inherit **all** global skills · a **specific subset** · or
      **none**. Add a **`skill_manage` agent tool** (sibling of the `memory` tool): create/edit/remove
      a `SKILL.md` under the agent's own `skills/`, **autonomous auto-write** + a `skills.auto_write`
      kill switch, audited as Events — Hermes-style self-improvement. The `FileSkillProvider` re-scans
      per call, so authored skills are live with no restart.
- [ ] **7e-g — optional `AgentSelector` auto-rotate (D14).** A swappable selector (mirrors
      `SkillSelector`) that auto-routes a turn to a specialist **when enabled** in settings — default
      off; explicit `/agent` + `spawn_subagents` stay primary. **Default algorithm =
      `KeywordAgentSelector`** (name + SOUL.md token overlap, mirroring `KeywordSkillSelector`; D15 #8);
      protocol swappable (LLM/embeddings drop-ins). Final keyword tuning at build.

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

## Design audit — 2026-06-14 (loose ends + doc drift)

A whole-project review (docs vs the shipped backend code). Findings, tracked.
**Reconciliation done 2026-06-14:** `ARCHITECTURE.md` + `DESIGN.md` got status banners + targeted
D14/D15 fixes (data model, agents folder-only, memory file model, `CTRLB_HOME`, `messages.agent`,
FTS5); the C1/A2 doc "day-one" overclaims are corrected (flagged as future, not shipped). Remaining
*build/decision* items below stay open.

**Doc↔code drift — `ARCHITECTURE.md` predates 7a–7d + D14 (highest priority):**
- [x] **Reconcile `ARCHITECTURE.md`** ✓2026-06-14: §3 still listed YAML `agents[]` (D14 removes it) + `agent.memory_backend`/per-agent `memory` (superseded by D14); §3 data model is stale (`Message kind|content` → real code is `parts[]` JSON + `actor`, no `kind`; `Event actor(user|agent)` → real `user|agent|system|automation`); §2 lists unbuilt endpoints (`/api/prompts`, `/api/memory`, `/api/exec`, `/api/tools`) and omits the real ones (`/api/agents`, `/api/integrations`, `/api/skills`, `/api/agent/default-prompt`); §4 memory predates D14; §6 lacks `CTRLB_HOME`.
- [x] **Module names in `ARCHITECTURE.md` are illustrative + drifted** ✓2026-06-14 (banner caveat added) (`app/hosts.py`/`app/agent.py`/`app/voice.py`/`app/tools/`/`app/models/` vs the real `services/`/`adapters/`/`api/`). Add a caveat or refresh.
- [x] **Reconcile `DESIGN.md`** ✓2026-06-14 (banner + §4 `messages.agent` · §5.1 folder model · §6 file memory · §8 FTS5 · §9 settings · §17 resolved).

**Documented "day-one" seams that were never built (contradiction to fix — doc or code):**
- [ ] **Streaming `auto|on|off` + buffered chat (C1) — DECIDED 2026-06-16: BUILD (spec in DECISIONS D17).** ARCHITECTURE §1 claimed "both from day one"; `/api/agent/chat` is SSE-only today. Build = a `collect_turn(events)` collector that drains the existing `run_turn`/`resume` `AgentEvent` generator into a buffered JSON payload (the loop is NOT forked), `AgentCfg.streaming` setting, Accept-header negotiation under `auto`, setting authoritative (off buffers the PWA too), client branches on response content-type and reuses the reload render path. Chat endpoint only — STT/TTS streaming stays Phase 6. On landing, flip the ARCHITECTURE §1 claim to true.
- [ ] **`question` message kind (A2)** (doc framing corrected ✓; **design locked 2026-06-16 in ROADMAP A2**, build deferred): ARCHITECTURE listed it as a v1 kind; the Part union has no `question` part / pause-for-answer flow. Locked shape: a `question` builtin (sibling of `task_plan`) that suspends via the existing suspend path (`RunState.AWAITING_ANSWER`) + `tool.question` SSE event + a question bubble + **extends** `/api/agent/resume` with `decision="answer"` (no parallel endpoint). Cheap when built because it reuses the confirm-suspend machinery.
- [ ] **D8 tool registry / Utils (Phase 8) unbuilt:** no `@tool`, no `/api/tools`, Utils is a static shell. **Confirmed (DESIGN §0.4 + §16):** the Utils tool registry **reuses `core/tool.py`** (the unified capability model) — not a parallel registry. Build remains (Phase 8).

**Found *better* than documented:**
- [x] **A1 privilege ladder already implemented** ✓2026-06-14 in `core/permissions.decide()` (READONLY/CONFIRM/AUTO_LOW/FULL + `run_shell` gating); **ROADMAP A1 downgraded** to "selection/persistence UX only". **Selection layer specced ✓2026-06-16 in DECISIONS D16:** global default = `agent.defaults.privilege` (no new field), per-agent = `AgentDef.privilege` (shipped), per-session = new `ChatRequest.privilege` override, surfaced via header chip + sticky `/privilege` verb. Standalone slice (not 7e); per-host + time-boxed escalation deferred.

**Decisions to formalize:**
- [x] **Phase 5 (`run_shell`/`/api/exec`)** ✓2026-06-14 — **decided: KEEP + build.** The `!` prefix is the
  local-shell UX on the backend host (Claude-Code model), distinct from open-terminal. Full spec in the
  Phase 5 section (local-only · `shell.workdir` default `$CTRLB_HOME` · output→context · enabled-by-default).
- [ ] **Voice config block:** `config.py` has no `stt`/`tts`/`voice` section yet (ARCHITECTURE §3 lists it). **Confirmed 2026-06-14: voice (Phase 6) is still planned as designed** — the config block lands when Phase 6 is built (nothing to do now).

**§2 blocking specs for the 7e build → locked in `DECISIONS.md` D15:** `agent.defaults` shape + merge precedence · `CTRLB_HOME` path + precedence · **agents folder-only (no migration; `agents:[]` removed from schema)** · `MemoryProvider` interface + injection point · `messages.agent` + resume resolution · `skill_manage` schema/scope · `session_search` scope + redaction · `AgentSelector` seam.

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
- [ ] **Streaming, decoupled per-transport (C1, 2026-06-16):** chat = `AgentCfg.streaming` auto|on|off
      (decided D17); TTS = own chunked-playback knob (Phase 6); STT = always buffered, no toggle. **Not**
      one global toggle.
- [ ] **Wake word** (client-side, openWakeWord/Porcupine WASM, off by default) (C2).
- [ ] **Idle sleep → OS-native (decided 2026-06-16, D1):** let each host's own OS power plan
      suspend on idle; ctrl-b builds nothing for now (no remote idle detection). **Compute-aware idle**
      (don't sleep during GPU jobs) is a deferred future maybe — the only variant the OS can't do.
      **Wake-on-connection** (D2): mechanism decided 2026-06-16 — Tailscale-status poll (primary,
      pairs with A3 scheduler) + PWA-connect trigger (near-free MVP); both reuse `wake_host`, no public surface.
- [ ] **Notifications** (F1): master toggle + per-event; default PWA-native (foreground
      Notifications API via SSE + **Web Push**/VAPID when closed, auto); optional **ntfy** /
      **Telegram-Discord** channels. **Discord/Telegram bots** as thin API clients (E1).
- [ ] **Security hardening**: known_hosts pinning, per-action tokens, secret encryption-at-rest (G).

## Cross-cutting / don't-forget

- [ ] Secrets: gitignore YAML + `*.db`; mask in API; never log SSH passwords / keys.
- [x] Per-OS abstraction lives in the action layer / `platform` shim — no Windows/Linux-only
      imports at module import time (keeps Termux profile alive). *(OS-compat pass 2026-05-28: ping
      is a 3-way `platform.system()` branch (Win/Linux/macOS); shutdown/reboot OS-command lookups
      degrade cleanly; WOL/paths/SSH/sockets/HTTP already portable. Ready for emma/Linux.)*
- [ ] Every privileged action writes an `Event` (audit trail visible in UI).
- [ ] Keep the Tailscale-only, no-auth, no-public-bind boundary intact (AGENTS.md §6).

## Open questions to resolve in-phase (from DECISIONS.md)

- [x] Agent tool-call format + weak-model fallback → **native OpenAI tools**; weak-model fallback is
      the `fleet` intent-skill (tool-narrowing) + loop guards; **prompted-JSON dropped 2026-06-16**
      (native-only — see Phase 4c + DECISIONS "Still open").
- [x] SearXNG → done as the built-in **`web_search`** tool (4f) **and** available via emma's
      `mcp__web-tools__*` MCP server; both live.
- [ ] Memory strategy final shape (Phase 7) — embeddings client built (4f), vector `MemoryProvider`
      + recall still TODO.
- [x] Frontend routing → **tab state** (`store/ui.ts`), not react-router (decided Phase 1).
- [x] `dashboard_v2/` is tracked on the public `main` (decided Phase 0; committing throughout).
