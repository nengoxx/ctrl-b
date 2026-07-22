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

> **Status @ 2026-07-07 (HEAD `a9a91d5`):** Phases **0–8 are all done** —
> Fleet, Actions, Services, Agent chat + full tool-loop, Skills/subagents, **Phase 5** (guarded `!`
> shell), **Phase 6** (voice STT/TTS + mic + mini-player + HTTPS), and **Phase 7a–7e** (Conf:
> settings/hosts/services/integrations/skills/agents/prompts/memory). **7e is fully complete** —
> 7e-f-1/f-2/f-3 (per-agent skills · `skill_manage` + core-builtins · shared Approve-to-apply
> propose-UI) and **7e-g** (`AgentSelector` auto-rotate) all shipped. **A2 `question` kind** shipped
> (`bb82882`). **C1 dual-mode chat / D17** shipped (`3fb6603`). **D18 inference failover** + fallbacks
> editor shipped. The **UI performance pass** (`docs/UI_AUDIT.md` Slices 1–8) is complete (10/13; F9
> `useTransition` + F13 React Compiler deferred), and the **F14–F26 a11y/resilience backlog is also
> shipped** (Slices A–F2, the 2026-06-08 session — F14/F15/F16/F17/F18/F19/F20/F22/F23/F25/F26/F28/F29).
> **Phase 8** (Utils tool registry, D8/D22 — 8a+8b below) shipped 2026-06-24; the **pre-deploy
> hardening** (D33 quality harness + `PRE_DEPLOY.md` steps 1–5) and the **Phase-9 e2e smoke/a11y suite**
> (F24; F27 shipped 2026-06-24) landed 2026-07-02. Backend pytest **250** · frontend vitest + e2e green.
> Detail in `HANDOFF.md`.
>
> **~~Next: the emma (Linux) deploy / v1 cutover (Phases 9–10)~~ ✅ BOTH DONE** (deploy 2026-07-10;
> Phase 10 closed same day). **Theme Phase 11**: the D34 **Hardening slice v2 ✅ SHIPPED 2026-07-10**;
> the **Composer Surface ✅ SHIPPED 2026-07-11** (full 5-variant catalog + planPlacement,
> `COMPOSER_SURFACE_PLAN.md` banner has the commit map); **frontier F0 (the SECTION LAYOUT SYSTEM v1,
> D35) + F1 (shell reskin — frontier REGISTERED) + F2 (the badlands Fleet + 4 eyeball riders: sliding
> tab indicator · self-host presentation · FleetOrder · cosmos cue size) + F3 (HostDetail sheet +
> shared riders: Escape-from-anywhere · exit shadow overshoot · **the Kit tab bar = vapor's bar for ALL
> themes, fleet↔utils glyphs swapped** · kit-main[data-tab] hook) ✅ ALL SHIPPED 2026-07-12** ·
> **F4 (the Agent tab — D36/§15 chat hooks contract · shared ChatThread · the no-outlines +
> Clear-appbar + rounded-square-line-composer owner rounds) ✅ SHIPPED 2026-07-13**;
> now = frontier F5 **IN PROGRESS, re-scoped 2026-07-13** (`FRONTIER_PLAN.md` banner is authoritative;
> axes = D37/§14.16): art-override UI + asset pass PARKED · **slice A [chat `outlines` axis] ✅ SHIPPED
> 2026-07-13 `5193f4c`** · **slice B [`composerSkin` axis, 4 skins + the layout dedup — D37 AMENDED] ✅
> SHIPPED 2026-07-15 `6c78d17`+`a433c8f`** · next = the F5 perf/a11y/e2e/§0 gates. **Approved 2026-07-07 (owner):** the **ACA chat-hardening plan** = **Phase 12**
> (`AGENT_CHAT_AUDIT.md` §5 is the spec; Slice 0 landed; Slices 1–2 pre-deploy candidates, 3+
> post-deploy) and the `SYSTEM_AUDIT.md` **SYS** riders — **SYS-13** (live `fillComposer` bug) +
> **SYS-14** (Linux CI) are Phase-9 pre-deploy items below. **Still open (low / deferred):**
> QR-to-phone (`segno` dep, pending owner OK); vector memory recall; ROADMAP E2 OpenAI facade; D19
> voice streaming transports; UI_AUDIT F9/F13 (perf, until measured pressure).
>
> **⭐ GLOBAL ORDER OF WORK (cross-track, reviewed + pinned 2026-07-07 — each track's internal
> order lives in its own doc; this is the interleave):**
> 1. **~~Deploy first~~ ✅ DONE 2026-07-10 — v1.0.0 live on emma** (Phase 9 executed; everything
>    labeled post-deploy is now unblocked). Dev continues ON emma (HANDOFF banner).
> 2. **~~Phase 10 cutover~~ ✅ CLOSED 2026-07-10** — the old Flask server is retired (owner ruling; see Phase 10).
> 3. **Theme track (Phase 11):** Hardening v2 → Composer Surface → **T5 step 0 (tab-body
>    registry) → T5 frontier**. The D34 rule stands: nothing themeable ships before Hardening v2.
>    *T-numbers are build-recipe labels, NOT gates* — T4 (cosmos) shipped before T2/T3; **T2
>    phosphor + T3 observatory do not gate frontier** (T2 = anytime reskin; T3 waits on its
>    prototype). The vapor assimilation ladder (§14.15.3) is opportunistic post-hardening, also
>    not a frontier gate.
> 4. **ACA track (Phase 12):** slices in their locked order, interleavable with the theme track
>    (disjoint code territories: backend chat loop vs frontend theme engine). Riders that ride
>    specific slices: SYS-16 ruff `ASYNC`+`B` ratchet **before the ACA build waves** · SYS-1
>    `Database.transaction()` standalone-promptly or with Slice 2 · Compactor characterization
>    tests **before Slice 6** · MCP/OpenAPI adapter tests ride Slice 1 · subagent-bounds tests
>    ride Slice 3.
> 5. **Frontier planning** (the writing of the plan) may proceed anytime — planning ≠ building;
>    building waits for its slot in 3.

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
      `call_id`; med/high-risk show allow/edit/deny wired to `resumeCall()`; low-risk auto-run
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

- [x] `run_shell` action (`services/actions/shell.py`, local exec via `asyncio.create_subprocess_exec`):
      captures combined stdout/stderr, **kill-on-timeout** (`wait_for`→`proc.kill()`), per-OS shell
      (`platform.system()` → Windows `powershell -Command` · else `bash -lc` — the legitimate server-OS
      branch, like `fleet._ping_cmd`), cwd = `shell.workdir` (blank → `$CTRLB_HOME`), `risk=HIGH`,
      `ui_exposed=False`, redact (`settings.secret_values()`) + truncate (`max_output_chars`); logged
      as an `Event` via `ActionService._record`. Shared `_run` core used by both entry points.
- [x] `POST /api/exec` (gated by `shell.user_exec_enabled` → 403). Composer **`!` prefix** routes here
      (`store/chat.ts runShell` → set threadId → `reloadChat`); reuses `invoke("run_shell", FULL)` so
      the user `!` is authorized (the run is audited), then persists the result as an `assistant`
      tool_call + `tool` result pair — renders as a command bubble **and** the agent sees it next turn.
      CmdBubble gained a collapsed **output** disclosure (also surfaces agent `terminal_exec` output).
- [x] `ShellCfg` (`shell.enabled`/`user_exec_enabled`/`agent_exec_enabled`/`workdir`/`timeout_s`/
      `max_output_chars`) + a Conf **Shell** group (#06). Agent-facing `run_shell` excluded-by-default
      via `decide(run_shell_allowed=shell.agent_exec_enabled)` wired at the single ActionService gate —
      off → DENY below FULL; on → HIGH still confirms. Tests: `test_shell_5.py` (10).

## Phase 6 — Voice (STT + TTS) — **sliced 6a-1 / 6a-2 / 6b / 6c**

> **Failover is its own subsystem (D18).** Each voice service has a `primary`→`fallback` chain via
> `core/failover.py`; any error falls through (surfaced via `X-Voice-Served-By`, total fail → 502).
> The LLM inference fallback chain is the **next slice after voice**, reusing the same primitive.
>
> **Full-clip TTS, not chunked (research-backed).** A scrubbable mini-player needs a known duration +
> seekable bytes; streamed audio doesn't give that cleanly (MSE seek is bad, range-requests collapse
> into "make the full clip anyway"). So TTS returns the **whole clip** (mp3) and the PWA plays a blob
> URL — fully seekable. Chunked/sentence-pipeline streaming is a deferred ROADMAP latency optimization,
> explicitly traded against seek. (This dropped the originally-planned `tts.stream` knob.)

### Phase 6a-1 — voice backend + the shared failover primitive ✅ DONE 2026-06-22
- [x] **`core/failover.py`** — generic, value-agnostic `failover(endpoints, attempt)` (D18): walk the
      chain, first success + metadata, any-error→next, all-fail→`FailoverError`. Reused by inference later.
- [x] **`config.py`** — `voice{enabled, stt, tts}` with `VoiceServiceCfg{connect_timeout_s, timeout_s,
      format, primary, fallback}` + `.endpoints()`; `api_key` rides the existing mask/unmask machinery.
- [x] **`adapters/voice.py`** `VoiceClient` — `transcribe`/`synthesize` (full-clip) + `configured`/`status`,
      `AsyncOpenAI` per (url,timeouts), split `httpx.Timeout`, both wrapped in `failover`.
- [x] **`api/voice.py`** — `POST /voice/stt` (`{text}`), `POST /voice/tts` (full audio + Content-Length +
      `X-Voice-Served-By`), `GET /voice/status` probe. HTTP contract: all-fail→502, unconfigured→503,
      empty→422. Wired in `main.py` + `runtime.set_voice` (lifespan build/close + `reconfigure` hot-apply).
- [x] **Tests** `test_voice_6a.py` (12): failover truth-table (incl. 4xx-falls-through), `endpoints()`
      pruning, nested-secret round-trip, `VoiceClient` transcribe/synthesize/unconfigured, API status/stt/tts
      + status codes. Full backend suite green (22 files); live boot confirms the route + 503-when-unconfigured.

### Phase 6a-2 — Conf **Voice** group (frontend) ✅ DONE 2026-06-22
- [x] Two Conf groups — **Voice · STT** (#07) + **Voice · TTS** (#08) — following the existing scalar
      `Draft`/`saveBar` pattern (rides the shared dirty flag + `PUT /api/settings`). STT: master Enabled
      Switch + language Field + vad_filter Switch + hotwords Field + primary/fallback (base_url/model/key)
      + timeouts. TTS: format Seg (mp3/opus/wav) + primary/fallback (base_url/model/voice/key) + timeouts.
      `extra_body` round-trips untouched through the draft (no editor — advanced/rare). `SettingsDoc`
      gained typed `VoiceEndpoint`/`VoiceStt`/`VoiceTts`. Editor groups renumbered 09–16. vapor.css
      untouched (D7). tsc clean; eyeballed at 390px (Puppeteer, zero console errors); settings GET/PUT
      round-trips the masked nested keys.

### Phase 6b — mic state machine + scrubbable mini-player (frontend) — **sliced 6b-1 (mic ✅) / 6b-2 (TTS player)**

#### 6b-1 — mic STT + state machine ✅ DONE 2026-06-22
- [x] Frontend: tap-to-start/tap-to-stop mic (MediaRecorder) → `/voice/stt` → appends transcript to the
      composer draft. The recorder's mimeType + the upload filename extension **agree** — derived from the
      recorder's *actual* `mimeType` post-start (`extFromMime`), since a browser may fall back to a
      different container than requested. **Always buffered** record-then-send (no streaming toggle, C1).
      Recording logic is a custom hook (`hooks/useDictation.ts`), **not** a store — recording state is
      read by one place (the Composer mic), so a hook is the idiomatic home; no duplication of the
      chat/ui store boilerplate (the TTS *playback* singleton in 6b-2 is the genuinely-shared piece).
- [x] **Mic-button state machine** (folds in UI_AUDIT.md F21; visual states owner-locked 2026-06-22):
      built off `hooks/useVoiceStatus.ts` (capability probe `GET /api/voice/status`, always-on, Conf-save
      invalidated). Dropped the stub's `useState(rec)`; the button is driven by the recorder's real phase.
      idle (vapor `.mic`) · recording (vapor `.mic.rec` pulse) · disabled-in-settings `stt:false` (mic
      **hidden**) · unavailable (reactive — only after a recording attempt 502s the whole chain → muted
      `.mic.unavail` + inert + tooltip; re-arms on the next `/voice/status` probe, no proactive liveness
      probe). One new CSS rule in extras.css; **vapor.css untouched (D7)**. `tsc -b` clean; TTS→STT
      round-trip verified live (502 vs 422 contracts confirmed). **Eyeball at 390px pending** (needs a
      secure context — owner to test at home; 6c HTTPS unblocks the phone).

#### 6b-2 — scrubbable TTS mini-player + auto-TTS (frontend) ✅ DONE 2026-06-22
- [x] **Per-bubble read-aloud toggle** + **auto-TTS** (the existing AppBar `ttsAuto` now gates *real*
      playback). `lib/toSpeech.ts` strips markdown → prose; `hooks/useAutoTts.ts` speaks the just-finished
      reply on the streaming→idle transition (only the latest assistant turn, never an old/historical
      reply; buffered-mode auto-TTS is a documented best-effort gap — the manual toggle always works).
      Per-bubble toggle in the bot who-line (`tts-play`, play↔pause icon), gated on `/voice/status`
      `tts:true`. AppBar auto-TTS button now hidden when TTS unconfigured; muting it stops current playback.
- [x] **Scrubbable TTS mini-player** (owner-refined minimal spec 2026-06-22): docked bar above the composer
      (App.tsx, self-hides) — play/pause + draggable+clickable seek (`<input type=range>`, robust on
      touch) + **remaining time only** + dismiss ✕. **No skip ±10s, no speed** (owner trimmed it to
      minimal). `<audio>` over a blob URL (native seek); **per-message blob cache** (one synth/message,
      revoked on `/clear`). **Playback = a DOM-backed singleton audio controller** (`lib/audioController.ts`)
      subscribed via `useSyncExternalStore` (one `<audio>`, reactive `playingId` + time/duration; selector
      hook so per-bubble buttons don't re-render on `timeupdate`), NOT a new `store/voice.ts`. Net-new
      components styled entirely from vapor tokens (extras.css, ~118 lines) so they adapt across
      dark/aqua/ember; **vapor.css untouched (D7)**. `tsc -b` + `vite build` clean; controller race/lifecycle
      bugs (switch-mid-play, pause-clobbers-loading, dismiss-during-load) found + fixed in self-audit.
      **Eyeball at 390px pending** (needs a browser — owner to test; audio playback can't be verified headless).
- [x] _(backlog) — collapse the duplicated external-store boilerplate into a shared binding. **DONE
      2026-06-24 (DECISIONS D23):** dep-free `store/createStore.ts` + `persist.ts` deduped **10**
      instances (9 `store/*` + `lib/audioController`); shared `Switch`/`Seg` extracted. 85 fe tests._

#### 6b-3 — mic auto-send setting ✅ DONE 2026-06-22
- [x] **Conf → Voice · STT → "Auto-send" toggle** (owner request 2026-06-22, **default off**): off → the
      mic fills the composer for review-before-send (the only prior behavior); on → it sends the transcript
      immediately (routed like a typed+sent message via `runComposer`, combining with any existing draft).
      `SttServiceCfg.auto_send: bool = False` (backend). Surfaced to the **always-on mic** via
      `GET /voice/status` → `stt_auto_send` (the Conf settings query is tab-scoped, so the mic can't read
      it there; a Conf save invalidates `["voice-status"]`, already wired in 6b-1, so the toggle takes effect
      without a reload). Guards against auto-sending into an in-flight turn (would be dropped — leaves it in
      the composer instead). `tsc -b` clean; live-verified `/voice/status` + `/api/settings` round-trip the
      field. Auto-play stays as the AppBar toggle (owner's call — unchanged).

### Phase 6c — HTTPS + Android verification — **sliced 6c-1 (manual + doc ✅) / 6c-2 (settings panel)**

#### 6c-1 — manual Tailscale Serve setup + doc ✅ DONE 2026-06-22 (doc)
- [x] **Setup doc:** [`HTTPS_TAILSCALE.md`](./HTTPS_TAILSCALE.md) — `tailscale serve --bg 5173` puts the
      app behind a real TLS cert at the device's `*.ts.net` name (tailnet-only, **not** Funnel), so the
      mic's secure-context requirement is met on the phone. Coexists with the plain `http://corsair:5173`
      path (the Firefox-flag workaround stays). **No app change needed** — `vite.config.ts` already has
      `allowedHosts: true` (added anticipating the `*.ts.net` FQDN). Doc covers prerequisites (admin-console
      HTTPS enable, operator/elevation per OS), the on/off/reset commands, a QR-to-phone tip, the HMR-over-
      proxy caveat (use `npm run preview` for a clean serve), and the phone-verify checklist.
- [x] **Verify on the phone** ✅ 2026-06-22 — owner ran `tailscale serve --bg 5173` (non-elevated, Windows)
      and confirmed the voice UX works over the `https://…ts.net` URL on Android ("it works well").
- [ ] **(server-side, independent)** keep the Speaches whisper model warm (model TTL) — fixes the measured
      STT cold-start lag; do it around the phone test so dictation feels snappy.

#### 6c-2 — in-app "Enable HTTPS" control (settings panel) — ✅ CORE DONE 2026-06-22 (backend + frontend); QR remaining
- [x] **Backend** (`7e3dfe3`): `core/proc.py run_capture()` (shared subprocess core; `shell.py` refactored
      onto it, test_shell_5 green), `services/actions/tailscale.py` (`resolve_status()` live read +
      audited `tailscale_serve_enable`/`disable` MED actions, **`serve` only, never `funnel`**, binary
      PATH-resolved), `api/access.py` (`GET /access/status` + `POST /access/serve`), `TailscaleCfg`
      (`target_port`, tailscaled = source of truth). **Live-verified** against the active Serve (status +
      idempotent enable) + `test_tailscale_6c2.py` (5: port-match, serving/not/logged-out/CLI-missing).
- [x] **Frontend** (`56e87a4`): `hooks/useAccess.ts` + a `TailscaleAccessCard` in the **Server** conf
      group (no renumbering) — live Enable/Disable toggle + status + URL + copy; degrades to a hint when
      the CLI is unavailable. `tsc -b` + `vite build` clean. **Eyeball at 390px pending** (owner).
- [ ] **QR-to-phone** (the one remaining D20 piece): server-rendered QR SVG (`GET /api/access/qr.svg`)
      via **`segno`** (zero-dep, pure-Python) so the panel `<img>`s it — keeps the tailnet hostname off
      any third-party service. Deferred pending the **owner's OK on adding the `segno` backend dep**.

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
- [x] **7e-d — file memory: `FileMemoryProvider` + `memory` tool (D14). ✅2026-06-20** All three sub-slices shipped + pushed.
  - [x] **7e-d-1 — read path ✅2026-06-16 (`16bde75`).** `MemoryCfg` (`Settings.memory`: enabled /
        user_profile_enabled / auto_write / caps 2200/1375) + `MemoryProvider` protocol (`core/memory.py`,
        mirrors `SkillProvider`) + `FileMemoryProvider.load_context` (`services/agent/memory.py`):
        per-agent `memories/MEMORY.md` (default → root `memories/`; specialist → `agents/<slug>/memories/`)
        + global `memories/USER.md`, injected as a `system` message right after `_appends()` (D15 #4) with
        Hermes usage headers. Wired on `Deps.memory` + `app.state.memory`; `AgentSession.memory=` +
        `_memory_block()`; subagents pass it. `memories/` + `agents/*/memories/` gitignored. Tests:
        `test_memory_7e.py` (6).
  - [x] **7e-d-2 — `memory` tool / write path ✅2026-06-20 (`e5ebcaa`, hardened `ed1dfa8`).** A
        `@action("memory", category="builtin", ui_exposed=False, risk=LOW)` (`services/agent/memory_tool.py`,
        registered alongside `planning`/`subagents`): `add`/`replace`/`remove`, `target: memory|user`,
        substring `old_text`, **no read**. `FileMemoryProvider.write(agent, target, action, content,
        old_text)` — `add` = `§`-delimited entry, replace/remove on the first substring match (rejects
        empty `old_text`), blank-run collapse. **Cap enforcement:** over-cap → `MemoryCapError` → tool
        returns an ERROR `ToolResult` steering consolidation. **`auto_write` OFF = propose-only,
        non-blocking** (returns `data["proposed"]`; Approve-UI deferred to 7e-f). Auto-audited via
        `ActionService._record`. `user` target gated by `user_profile_enabled`; master switch + gating in
        the tool, not the provider. Tests: `test_memory_tool_7e.py` (11).
  - [x] **7e-d-3 — Conf Memory panel ✅2026-06-20 (`2e18638`).** `FileMemoryProvider.read_raw` +
        `overwrite` (blank clears; **uncapped** — manual owner edits, soft cap) + protocol additions;
        file API `GET/PUT /api/agents/{name}/memory` (incl. default → root) + `GET/PUT /api/memory/user`,
        mirroring the skills/SOUL.md endpoints (slug-guarded, provider-delegated paths). Frontend:
        `hooks/useMemory` (`MemorySlot` abstraction + `useMemoryContent`/`useSaveMemory`),
        `components/MemoryEditor` (toggles direct-mutate `memory.*`, caps draft+Save, one row per file
        reusing `.kv-text.skill-md` + a cap-usage counter), new Conf **Memory** group (#10). Tests:
        `test_memory_panel_7e.py` (8). `tsc` clean; net-new CSS in `extras.css` (D7).
  - Vector recall = the later "both" mode over the unused `memory` table + the 4f embeddings client.
- [x] **7e-e — `session_search` (Hermes Tier 2). ✅2026-06-20 (`003bad3`).** Migration #3: FTS5
      `messages_fts` over user/assistant message text, kept in sync by triggers that extract the
      `TextPart` text from the JSON `parts` via `json_each` (reasoning/tool/system excluded; archived
      filtered at *query* time) + a one-pass backfill. `MessageRepo.search` (MATCH + `rank` + `snippet`,
      excludes archived, `_fts_query` sanitizer). `session_search` builtin (LOW, ui_exposed=False),
      **global + redacted** (D15 #7 — snippets run through `core.redact` against `Settings.secret_values()`).
      Tests `test_session_search_7e.py` (8). Live: migration applied to the real db (schema_version 3,
      backfill 368/368). **Audit nuances surfaced (see HANDOFF):** specialists with explicit `tools`
      allowlists don't receive new builtins (no always-on-builtin notion — owner decision); FTS triggers
      key on `rowid` (VACUUM-fragile, but `INNER JOIN message_id` protects query correctness); snippet
      truncation could leak a secret *fragment* across tokens (low). Hardening: `MemoryCfg` caps floored `ge=1`.
- [x] **7e-f — per-agent skills + `skill_manage` + shared propose-UI (D14).** Sub-sliced f-1/f-2/f-3 — all shipped.
  - [x] **7e-f-1 — per-agent skills + inheritance ✅2026-06-20 (`6dc06db`).** **No new `skills_inherit`
        field** — the existing `AgentDef.skills` allowlist *is* the global-inheritance knob (`*`/list/`[]`
        = all/subset/none); a specialist's own `agents/<name>/skills/` is always available on top
        (own-overrides-inherited by name). `available_skills(global_provider, settings, agent)` +
        `resolve_skills` refactored to take the precomputed set; `_activate_skills` rewired. Default-agent
        byte-identical; AgentsEditor tick-grid (bound to `agent.skills`) now reads as inheritance — no FE
        change. Tests `test_skills_per_agent_7e.py` (6).
  - [x] **7e-f-2 — `skill_manage` + core-builtin reachability ✅ (shipped).** (a) **`core: bool`
        on `ToolSpec`** + `@action(core=)`; mark **`task_plan`/`memory`/`session_search`** core (owner's
        cognitive set — resolves deep-audit #1); `for_agent` always unions core tools (survive allowlist +
        skill narrowing). (b) **`skill_manage`** builtin (mirror `memory_tool.py`, **not** core):
        `save`/`remove` a SKILL.md in the agent's own folder; gated `skills_enabled` → **`skills_auto_write`**
        (OFF → propose-only `data["proposed"]`); slug-validated; auto-audited. (c) **`AgentCfg.skills_auto_write`**.
        (d) De-dup: `_write_text_eol` → **`core/fsutil.py`**; `write_skill_md`/`remove_skill_md` + shared slug
        in `services/agent/skills.py`; refactor `/api/skills` to use them.
  - [x] **7e-f-3 — shared Approve-to-apply propose-UI (frontend) ✅ (shipped, `4b63f59`).** Render `data["proposed"]` from *both*
        `memory` and `skill_manage` as an Approve/Dismiss affordance on the tool bubble + an apply endpoint.
        Needs its own pre-flight over the AgentTab `.b.cmd` command bubble + confirm-resume flow.
- [x] **7e-g — optional `AgentSelector` auto-rotate (D14) ✅ (shipped, `b7ce996`).** A swappable selector (mirrors
      `SkillSelector`) that auto-routes a turn to a specialist **when enabled** in settings — default
      off; explicit `/agent` + `spawn_subagents` stay primary. **Default algorithm =
      `KeywordAgentSelector`** (name + SOUL.md token overlap, mirroring `KeywordSkillSelector`; D15 #8);
      protocol swappable (LLM/embeddings drop-ins). Final keyword tuning at build.

## Phase 8 — Tool registry + Tools tab (extensible, D8/D22) — sliced 8a / 8b

### Phase 8a — utility registry + run cards ✅ DONE 2026-06-24 (`ef569af` + `a339d6a`, pushed)
- [x] **`@tool` framework** — thin sugar over `@action` (`category="utility"` + `ui_exposed=True`);
      `GET /api/tools` + category-guarded `POST /api/tools/{name}` (facade over `ActionService.invoke`,
      USER/audited; 404s on non-utility/agent-only names). No parallel registry, no 2nd exec path.
- [x] Ported **`yt_captions`** (transcript → `data.download` for UI + bounded text in `output` for the
      agent) and net-new **`ip_info`** (ip-api.com lookup). Both `agent_exposed=True`.
- [x] **`dns_trace`** — the first net-new tool (dep-free getaddrinfo + reverse PTR) — proves "one file."
- [x] Generic Vapor `.util` card (`UtilCard.tsx`, schema→form, client-side Blob download). Tab relabeled
      **"Tools"**; card order yt → ip → dns. **Per-tool `ToolSpec.timeout_s` enforced** (default None =
      unbounded; generous per-tool). Tests `test_tools_8.py` (12). Owner-eyeballed at 390px.

### Phase 8b — tool manage layer: tri-state access + descriptions (D22) ✅ BUILT 2026-06-24 (eyeball at 390px pending)
- [x] **Unified `tool_overrides: dict[str, ToolOverride{description, agent_mode}]`** (Option B, not sibling
      maps) replacing `tool_descriptions`; `@model_validator(before)` folds the legacy key in (zero-touch).
- [x] **Tri-state `agent_mode` (core/enabled/disabled)** via a generalized `apply_tool_overrides` overlay
      (capture+restore `description`/`agent_exposed`/`core`); `api/actions` DTO gains `default_agent_mode`.
- [x] **Tools-tab Section B catalog** (`ToolCatalog.tsx`): per-tool tri-state `.seg` + inline description
      override; `default`-mode dot-marked, `run_shell` read-only→Conf·Shell. State reconstructed from the
      actions DTO (no Conf-scoped settings query); current-state derivation centralized in `agentModeOf`.
- [x] **Retire Conf → Agent tools** (`ToolDescriptionsEditor` deleted) — descriptions moved to the catalog;
      Conf #14 left as a one-line pointer.
- [x] **AgentsEditor `TickGrid` mirror** — disabled→locked-off, core→locked-on, enabled→interactive.
- [x] Tests `test_tool_overrides_8b.py` (11: migration both directions, overlay truth table, core survives
      empty allowlist + narrowing, DTO default vs live, clear→default, run_shell membership≠privilege, PUT
      round-trip + legacy-on-disk). Backend suite **25/25 files**; frontend `tsc`+build clean, **57/57**.
- _Deferred (don't build unless asked): bool/enum form widgets (when first tool needs them); per-tool
  `settings` (ROADMAP E0a — additive field on `ToolOverride`, discriminated union, same schema→form path)._

## Phase 9 — PWA, packaging, deploy  (**✅ COMPLETE — executed 2026-07-10: v1.0.0 live on emma**)

- [x] vite-plugin-pwa manifest + service worker (build emits `dist/sw.js` + workbox precache). _Minimal
      manifest/precache — fine to ship; tune (icons/screenshots/offline polish) only if wanted._
- [x] Prod: FastAPI serves `frontend/dist` (StaticFiles `/assets` mount + SPA `FileResponse` fallback,
      gated on the dist dir existing so dev is unaffected) — `main.py`. Single origin.
- [x] `debug=False` default (config.py); backend deps pinned (`pyproject.toml`, exact versions).
- [x] **Deploy profile for emma (Linux): systemd units + install/runbook — ✅ EXECUTED 2026-07-10
      (v1.0.0 = `8fa8404`; maiden CI release gate green).** `bootstrap.py --with-dev --claude-env` ran
      end-to-end: prod `~/apps/ctrl-b` @tag → https://emma.lobster-vector.ts.net (Serve HTTPS) · dev
      :5434 + Vite :5173 · always-on `ctrl-b-agent.service` (tmux, workspace) · Claude framework
      migrated (memory/settings/git-identity). Verified 11/12 (the one finding — the first-clone claude
      trust prompt — cleared + recorded in the runbook). As-executed record: [`DEPLOY_EMMA.md`](./DEPLOY_EMMA.md);
      living procedures: `deploy/linux/README.md`.
- [x] Minimal smoke tests — **shipped 2026-07-02** as the full Playwright e2e suite
      (`frontend/e2e/{render,flows,a11y}.spec.ts` — desktop + Android viewport + axe WCAG A/AA),
      wired as the opt-in deploy gate `python tools/check.py --e2e` (PRE_DEPLOY step 5 / UI_AUDIT F24).
- [x] **SYS-13 fix ✅ 2026-07-07:** `fillComposer` = `setDraft(text)` + focus (the DOM `.value` write
      React's controlled composers swallowed since F28 is gone); 3 jsdom regression tests assert the
      *store* draft (+ focus + unmounted-composer no-crash) via a controlled harness bound exactly like
      the real composers. The confirm-bubble e2e line was skipped — it needs streamed-tool-call seeding
      the smoke e2e suite doesn't have (noted in `SYSTEM_AUDIT.md` SYS-13; the jsdom test covers the
      broken contract). check-all green (212 vitest / 33 files).
- [x] **SYS-14 ✅ GREEN 2026-07-07 — the codebase's first Linux run:** `.github/workflows/ci.yml` —
      ubuntu-latest, Python 3.14 + Node 24, venv at `backend/.venv` + `pip -e ".[dev]"` + `npm ci`,
      then the full `python tools/check.py` gate (NOT `--e2e` — that stays the opt-in deploy gate).
      Triggers: push to main/dev + PRs. Run #1 immediately caught a real defect — ruff/pytest were
      hand-installed, never declared in pyproject (fixed: pinned in the `dev` extra, `32f03c4`);
      run #2 fully green (all 6 checks incl. pytest 250 on Linux). Spec: `SYSTEM_AUDIT.md` SYS-14.
- [x] **Quality-harness audit (QH) ✅ 2026-07-07 — VERDICT: GO** ([`QH_AUDIT.md`](./QH_AUDIT.md) §R).
      Ran the whole gate as-deployed (`--fast` 1.9s · full+`--e2e` 7/7 1m12s · CI green · hooks
      verified); drift hunt + invariant ladder → **9 findings fixed** (highest: QH-1 install.sh
      enabled hooks without installing the `[dev]` toolchain — emma dev-tree commits would have
      died; QH-2 undocumented `npx playwright install` deploy-gate prereq) + 4 new drift-guard
      tests (SSE-event lockstep · config.example validity · OS-branch allowlist · core-layering);
      pytest 250 → **254**. Owner decisions ruled + landed same day: QH-10 conftest auto-isolation
      (pytest-only) · QH-11 `target_port` default → 5433 (config/.env override documented).
      **Nothing blocks `DEPLOY_EMMA.md`.**

## Phase 10 — Cutover — ✅ CLOSED (owner ruling 2026-07-10: the Flask-app rewrite is long complete)

- [x] Feature-parity check vs `wol_server_win.py` — superseded in practice: v1.0.1 is the live
      daily driver on emma; the owner confirms nothing is missed from the old app.
- [x] Run v2 alongside the old server; migrate `config.yaml` — overtaken by the emma deploy
      (fresh DB + owner-managed `config.yaml`, 2026-07-10).
- [x] Flip the default; retire `wol_server/` — retired: code archived in `archive/v0.1-flask/`
      (2026-06-30 reorg), the corsair Flask instance is down (probe of corsair:5432 dead
      2026-07-10), README/AGENTS were rewritten at the reorg. No Linux-WOL fallback kept
      (v2 owns WOL natively).

## Phase 11 — Theme engine (pluggable presentation layer, D28) — **THEME CATALOG COMPLETE 2026-07-15: T0 + M0–M3 + Kit/minimal + cosmos (feature-CLOSED 2026-07-15) + Hardening v2 (D34) + Composer Surface + axes (D37) + frontier T5 (owner-signed 2026-07-15) ALL SHIPPED; the population is CLOSED (owner) — remaining Phase-11 work = the vapor-assimilation ladder (§14.15.3) only (Bucket-A shipped 2026-06-27 — stale row caught 2026-07-16; the frontier asset pass shipped 2026-07-16 `6e7a29a` [hero.png 1.9MB→551KB] and the art-override UI was dropped — owner 2026-07-16, the backend override field suffices)**

Spec: `THEME_ENGINE.md §§9–10` · decision: `DECISIONS.md D28`. Build the engine on the cheapest theme
first, hardest last; the foundation is paid once in T0. **D7 pixel-fidelity applies per theme.** Each Tn is
an independently shippable slice — pause for the owner's 390px eyeball after each (per the standing review
rule). **vapor stays byte-for-byte unchanged throughout.**

- [x] **T0 — Foundation (the engine; vapor untouched). ✅ SHIPPED 2026-06-26** — green: frontend `tsc`+
      `vite build` clean (CSS bundle hash unchanged), **92 unit** + **32 e2e**, backend **31 test files**
      (new `test_appearance_d28.py`). Frozen files git-confirmed untouched. Live `GET /api/appearance` ✓.
      _Built against THEME_ENGINE.md §13 (final-review checklist)._
  - [x] **FIRST: `vite build`-verify CSS `@layer` survives the bundler.** ✅ Vite 7.3.3 preserves
        `@import … layer()` — emits `@layer frozen,base,theme;` + wraps vapor.css/extras.css each in
        `@layer frozen{…}`; the frozen-layer content is byte-identical to the pre-change baseline (only a
        trailing `\n` repositioned). **No `cb-` fallback needed.** `theme/index.css` added; `main.tsx`'s two
        CSS imports swapped for it.
  - [x] `theme-engine/` dir: `types.ts`, `registry.ts`, `tabs.ts` (pure tab data — no component imports, so
        `store/ui` can read `hasComposer` without a runtime cycle), `base.ts` (empty BASE stub — real BASE is
        T1), `vapor.tsx`, `resolve.ts` (module-level cached slot map → stable identity, no context fan-out),
        `ThemeProvider.tsx` (+`useThemeSlot`/`useThemeSlots`).
  - [x] Register the **vapor module as-is** (slots → existing AppBar/Composer/TabBar/FleetTab/AgentTab/
        UtilsTab/ConfTabLazy). No edits to vapor components or `vapor.css`/`extras.css` (caged in `layer(frozen)`).
  - [x] `App.tsx` → **slot host** — renders resolved slots; preserves the §13.6 orchestration: lazy-Conf
        `confMounted`+Suspense (ConfShell renders inside it); `--appbar-h` via a `.appbar, .cb-appbar`-scoped
        selector (a wrapper-ref is impossible on the frozen `position:sticky` AppBar — this is the
        theme-robust realization of "stable ref"); `showComposer` reads `hasComposer()` (App **and** ui.ts).
  - [x] `store/ui.ts`: `{theme}`→`{theme,mode,accent}`; `applyBodyAttrs` sets `body[data-skin]=theme`, keeps
        `body[data-theme]`=accent when skin=vapor + **clears it for non-vapor** (no leak), sets
        `data-mode`/`data-accent` otherwise (§13.1). **Dedicated `migrateLegacyTheme`** (`dark|aqua|ember` →
        `{vapor,accent}`), exported + unit-tested (§13.4).
  - [x] **Cross-device sync — BUILT DAY 1 (§9.11):** typed `AppearanceCfg{theme,mode,accent,updated_at}`
        Settings block (`config.py`, server-stamped on each `PUT /api/settings {appearance}` — persisted to
        YAML so it survives restart) + always-on **`GET /api/appearance`** (plain `useQuery`, not Conf-scoped);
        `useAppearanceSync` reconciles on mount (**pure `reconcileAppearance`: server wins only when
        `updated_at != null` — an unwritten server keeps local, no revert**); inline **no-FOUC script at the
        TOP of `<body>`** (not `<head>` — body is null there) in `index.html`; Conf picker → `setUI` +
        optimistic `useSaveAppearance` (`scope`-serialized, `onMutate` cancels in-flight GET to dodge revert).
  - [x] **Theme-switch animation — BUILT DAY 1 (§9.12):** `switchTheme` — `ensureThemeLoaded` → `flushSync(
        setUI)` inside `document.startViewTransition` (defensively typed for any TS DOM lib), gated on
        `ui.motion` + feature detection. Wired to the skin picker; within-theme accent/mode stay instant `setUI`.
        (Dormant in T0 — only vapor registered — but built ready for T1.)
  - [x] Conf → Appearance: registry-driven **Theme** seg + declared-axis **Mode**/**Palette** segs
        (`ThemeDef.palettes`; vapor → named accents only, no mode axis). Adding a theme surfaces it automatically.
  - [x] Flexible **tab registry** (`theme-engine/tabs.ts` `TabDef[]` + `hasComposer`); v1 every theme returns
        the standard 4. (BASE TabBar count-driven indicator is a T1 concern — BASE is built then.)
  - [x] Backend per-host override blob: **`ComputerCfg.appearance: dict[str,dict[str,Any]] = {}`** (config
        schema, §9.9) — day-1, settles the YAML shape once. _Per §9.9/§9.13 the runtime `Host`/`_host_dto`
        wiring is additive at T3/T5 (avoids a dead unwired field); the TODO's earlier "domain/host.py day-1"
        wording is superseded by §9.9's reasoning._
  - [x] FOUC defended: Vite prod `<link>` guarantee + the inline body-top script. (React 19 `precedence`/
        `preinit`-in-`startTransition` is folded into `switchTheme`'s load-before-commit; `cssCodeSplit:true`
        kept, `modulePreload` untouched.)
  - [x] **Acceptance met: with only vapor registered, the app is byte-for-byte unchanged.** Unit-tested slot
        resolution path + the ui migration (legacy remap) + the appearance reconcile; backend test for
        `GET /api/appearance` + the PUT round-trip + per-host blob (temp config). e2e green. **Owner eyeballed
        at 390px.** ⚠️ **The 7-slot model T0 shipped is SUPERSEDED by D29** (theme-owned `Root` + controllers);
        T0's other infra (registry/provider/sync/VT/`@layer`/no-FOUC script) survives. Build T1+ against §14.

### Phase 11 v2 (D29) — re-sliced 2026-06-26: vapor migrated as a theme, then Kit + minimal, then the rest
_Build against THEME_ENGINE.md **§14** (headless controllers + theme-owned `Root` + Kit), NOT the §§9–13 slot model.
Full suite (92 unit + 32 e2e) + 390px eyeball green at EVERY milestone. Audit each change before continuing._

- [x] **M0 — shell inversion ✅.** `App`→thin host rendering the active theme's `Root` (`useActiveRoot`); vapor's body →
      `themes/vapor/VaporRoot`; `ThemeDef.Root` replaced the 7 slots. **Byte-identical** (CSS hash unchanged). (`cf7e9d4`)
- [x] **M1 — `@scope` CSS-scoping gate ✅.** `vapor.css`+`extras.css` wrapped verbatim in `@scope([data-skin="vapor"])`;
      **`data-skin` on `<html>`**; `:root`→`:scope`, `html,body`→`:scope,body` (the scoped-selectors-don't-match-the-root
      gotcha); `@layer base,theme`. Bundler preserves `@scope`+`@keyframes`; e2e asserts the computed page bg = vapor `--bg`.
      (`8280ef7`; THEME_ENGINE §14.6 updated)
- [x] **M2 — controller extraction, ONE feature per step** ✅ (all 5 controllers extracted; audited + verified + committed
      after each). Pattern held: store-backed state · a singleton engine in `<AppEngines/>` (NOT App's body — re-render
      isolation) · a pure consumer hook · full suite green throughout.
  - [x] **M2.1 `useFleet`** ✅ — `store/fleet.ts` (featured/open/hold) + singleton `useFleetCycle` engine + `useFleet`
        consumer; `FleetTab` pure presentation. + audit fix: isolated the engines into `<AppEngines/>` so the hosts poll
        doesn't re-render the whole theme tree. (`a746624`, `9487010`)
  - [x] **M2.2 `useComposer`** ✅ — draft + prefix-routed `send` + streaming gate + mic; `Composer` pure presentation. (`9ea7e8c`)
  - [x] **M2.3 `useAgentChat`** ✅ — COMPOSES `store/chat.ts`; `resultByCall`/`currentPlan` derivations in `lib/plan`;
        `useChatInit`/`useAutoTts` mounted in `<AppEngines/>`; bubbles + `#app-scroll` stick stay in vapor's AgentTab.
  - [x] **M2.4 `useSections`** ✅ — active functional area + navigate (generalizes `ui.tab`; TabBar's duplicate `TABS`
        deleted); the vapor-specific `.no-composer` body class is now theme-owned in VaporRoot. (`491f960`)
  - [x] **M2.5 `useAppChrome`** ✅ — auto-TTS toggle + `useNowPlaying` mini-player transport (split so the AppBar doesn't
        re-render on the player's ~4×/sec progress). (`2edfcdd`)
- [x] **M3 — register vapor as a `ThemeDef`** ✅ (`Root=VaporRoot`, eager scoped CSS, named-accent palettes) + the
      **per-theme settings** mechanism (`ThemeDef.settings` → `ui.themeSettings[id]` open map · `setThemeSetting` ·
      `useThemeSetting` override→default · Appearance picker auto-renders). vapor's `skyline/loz/heroOn/waveformOn`
      migrated into `vapor.settings` (VaporRoot owns the `body[data-*]` write; `migrateVaporSettings` folds legacy
      localStorage). **`motion`+`perf` now sync** cross-device — folded additively into the LWW channel with the new
      `theme_settings` map (backend fields default **`None`/unseeded** so a pre-M3 stamped doc can't wipe local prefs;
      reconcile-tested). Latent T1 double-`switchTheme` documented in `useAppearanceSync` (unreachable while vapor is the
      only theme). vapor = default selection.
- [x] **Kit + minimal** — chrome + Fleet AND the shared BODIES + OVERLAYS (Bucket-A) DONE (2026-06-27). Kit CSS model LOCKED:
      token-only reskins + ONE stylesheet under the `.kit` marker (= Radix `.radix-themes`), `@layer base`; vapor =
      bespoke escape hatch (§14.4.1, web-researched). NowMonitoring + waveform DEFERRED (minimal dropped monitoring;
      build when a theme needs a featured card).
  - [x] **K1** semantic token contract (`kit/tokens.css`, `@layer base`) + the `minimal` module (`themes/minimal/`:
        OKLCH dark/light×4-accent `tokens.css`, Fontsource `loadFonts`, `ThemeDef` Root=`DefaultRoot`, settings
        `hideAppbar`+`density`) + registry row + a `ThemeProvider` cold-load fix (lazy CSS/fonts on mount). (`39c9068`)
  - [x] **K2** token-driven Kit chrome (`kit/AppBar`/`NavBar`/`Composer` + `kit/kit.css`) under the `.kit` marker;
        reuses the existing controllers (no new logic). (`7d47a25`)
  - [x] **K4** minimal Fleet (`kit/Fleet.tsx` — device list + 3-stat summary, **REAL host data**: ping/last-seen/mac/
        services, no Hero/monitoring) as DefaultRoot's `Fleet` seam; + `lib/relativeTime.ts`; + the eyeball polish:
        floating composer (content scrolls behind it), perf-gated frosted glass (§14.11), body-margin reset. (`07063d2`)
  - [x] **Bucket-A** ✅ **SHIPPED 2026-06-27** — token-drove the shared BODIES + global OVERLAYS under `.kit` (extended
        the one Kit stylesheet; section banners live in `kit/kit.css`). All three sub-slices, each + a 390px eyeball:
        **A.1** (`7067bc3`) — overlays (`ConfirmDialog` `.modal`, `PromptModal` `.pm-*`, `Toasts`, `MiniPlayer`) +
        primitives (`Seg`/`Switch`) + the Conf shell — **closed the reachable unstyled-ConfirmDialog UX**; **A.2**
        (`a419c47`, `b44415d`, `8c33dc9`, `f29feeb`, `da6ac44`, `f938eb1`) — the deep Conf editors (Machine/Service,
        inference fallbacks, Integrations kv, prompt-rows, Agents tri-state allowlist + limits, tool descriptions,
        Memory/Skills raw editors) + the Utils/Tools tab; **A.3** (`ccc611f`, `57f8902`, `a5ba22f`, `848dd85`,
        `19b87b8`) — the entire Agent chat (bubbles, markdown, tool/command bubbles, question bubble, per-bubble TTS,
        plan panel, privilege chip/menu). The **⛔ RESEARCH-the-pattern-first** owner directive (2026-06-27) was
        honored — A.1/A.3 were web-researched + owner-confirmed before building. Stale `[ ]` checkbox only caught
        2026-07-16 (the 2026-07-15 open-work sweep propagated it into HANDOFF's ▶NEXT). Surviving carry-forward = the
        **SettingRow consistency sweep** across the remaining Conf groups (only Appearance adopted the `SettingRow`
        primitive; owner ruled "incremental") — ✅ SHIPPED 2026-07-16 `0d32e35` (28 rows: ConfTab groups
        01–08 + TailscaleAccessCard + the Agents/Memory/Skills editors; DOM-identical by construction —
        skips = disclosure spreads, Field-domain inputs, one styled row).
- [x] **Hardening slice v2 (D34 — THEME_ENGINE §14.15.1) — ✅ SHIPPED 2026-07-10** (all 10 items +
      riders a/b/c; as-built deltas §14.15.1-A; commits `bdaf511…9e21cdc`). The 29-agent final review's reshaped slice (supersedes the TRIAGE-3 ordering);
      behavior-preserving except ①. Ships BEFORE the Composer Surface and any themeable-UI feature wave.
      **Plan of record: §14.15** (each item's full shape + rationale lives there — build against it, not this list).
  - [x] ① `--accent-ink` on-accent contrast token + minimal light-mode near-black ink (the review's one
        product bug: light mode ships 3.2:1 on accent controls; 9 kit.css accent-fill sites)
  - [x] ② theme-fault ErrorBoundary around `<ActiveRoot/>` (keyed by theme) — Reload primary + **"Reset theme
        to default" = a genuine pick (write-through PUT)**; no quarantine, no safe-mode flag
  - [x] ③ `ensureThemeLoaded` rejection eviction (side-channel catch → evict; return the ORIGINAL promise)
  - [x] ④ ThemeProvider cold-load `.catch` → toast only (no auto-revert; Kit base tokens keep the app usable)
  - [x] ⑤ in-flight/latest-target guard INSIDE `switchTheme` (full `SwitchTarget`, not just the id — replaces
        the planned `useIsMutating` gate) + fix the stale `useAppearance.ts:132` comment
  - [x] ⑥ registered-ID coercion at both doors (load door → `DEFAULT_THEME` AFTER the legacy migrations;
        reconcile door holds the skin-triple but still applies motion/perf/themeSettings; **NEVER auto-PUT**)
  - [x] ⑦ `resolveThemeSetting` (B4 — spec in COMPOSER_SURFACE_PLAN §2.0; the Composer Surface assumes it)
  - [x] ⑧ `themeContract.test.ts` (B2): token list + behavioral + structural hooks (`#app-scroll` ·
        `#composer`/`.kit-composer` · `.kit-appbar` under `appbarMode="visible"`) + Fleet-a11y assertion +
        the contrast group; vapor exemptions = ONE shrinkable waiver constant (decide the palette-resolution
        strategy up front — jsdom can't replay the @layer/@scope cascade)
  - [x] ⑨ stylelint micro-slice (warn-first: keyframe-prefix · high-perf-animation · token-only colors ·
        `--accent-fill` only in background/mask + `--accent` must parse as a `<color>`)
  - [x] ⑩ kit-render e2e smoke (`e2e/kit-render.spec.ts`: seed minimal AND cosmos via `addInitScript`, poll a
        kit-only class, crash/ErrorBoundary smoke — a SPEC, not a Playwright project)
  - [x] riders: persisted `v` schema stamp on `ctrlb.ui` (one-shot prunable migrations; deletes
        `rawHasAppbarMode`) · order-insensitive `themeSettings` compare in `reconcileAppearance`
- [x] **Composer Surface (D31 / §14.14) ✅ SHIPPED 2026-07-11 — the FULL feature, beyond this line's original
      scope:** the 5-variant catalog `[stacked, borderless, ghost, sheet, line]` (registry + `ThemedComposer`
      resolver + shared `composerLayoutSetting`, picker on minimal+cosmos default `stacked`) + the A4
      `planPlacement` inline/pinned axis + the plan-clear fix. As-built record + commit map:
      [`COMPOSER_SURFACE_PLAN.md`](./COMPOSER_SURFACE_PLAN.md) banner. **Non-breaking held: vapor untouched,
      cosmos orbit untouched, Fleet stays Root-pinned.** Still deferred (plan §6/Phase D): Fleet→registry
      migration, the `createSurface` factory, vapor wiring.
- ~~**T2 — phosphor** · **T3 — observatory**~~ **SUPERSEDED (owner ruling 2026-07-15, at the F5 close): the
  theme population is CLOSED** — no new themes; the existing four (vapor · minimal · cosmos · frontier)
  formalize onto the kit and future theme work = variations within them (ROADMAP §Appearance, the amended
  vapor-assimilation entry). The T2/T3 prototype notes stay in `design/prototypes/` as reference only.
- [x] **T4 — cosmos** ✅ DONE (2026-06-28, pushed `2639ea2`→`88bfa84`): own Fleet `Root`/orbital — WAAPI orbit +
      rAF camera zoom-follow, per-host `present()` (golden-angle), canvas starfield, liveness pulse/halo, service-cue;
      `HostDetail` = a **draggable multi-snap bottom sheet** (the slide-panel idea, upgraded) on the reusable
      `BottomSheet` primitive + sheet-aware camera-lift. Gated by `ui.motion`. See `COSMOS_HANDOFF.md`.
      (C4 per-host `appearance.cosmos` override = PARKED future idea, not planned — owner 2026-06-28.)
- [x] **T5 step 0 — the SECTION LAYOUT SYSTEM v1 ✅ SHIPPED 2026-07-12** (engine slice; **D35 + its
      same-day addendum**; commits `b7f63d4…76c0d74`, owner-eyeballed at 390px): body registry (eager DATA /
      lazy COMPONENTS — the generalized `bodies` DefaultRoot prop replaces the `Fleet` prop) + curated
      4/3/2-tab presets + the global **device-local** layout lever (`auto` = theme default; this line's
      earlier "synced" wording was pre-build — the `appbarMode` precedent won at the design review) + the
      menu DOCKING RULE (appbar trailing action under `visible`, floating otherwise) + the COLLAPSE LADDER
      (one off-bar section → a direct button) + NavHome (minimal quick-jump) + utils-in-Conf hosting.
      Swipe-nav PARKED (D35 addendum). Three audit-caught defects fixed pre-ratification.
- [x] **T5 — frontier ✅ COMPLETE (owner sign-off 2026-07-15 — F5 gates A/B/C/D all closed; as-built record
      = the `FRONTIER_PLAN.md` banner + §9)** (HIGH; **plan = [`FRONTIER_PLAN.md`](./FRONTIER_PLAN.md), design LOCKED 2026-07-07,
      slices F1–F5 — build against it, not this line**; **F1 shell reskin + F2 badlands Fleet + F3
      HostDetail sheet ✅ 2026-07-12 · F4 Agent tab ✅ 2026-07-13 · F5 axes+gates ✅ 2026-07-15** — frontier registered, night/day palette +
      brandMeta subtitle + 3-tab default, the art-map/beacons/rig-grid live w/ appearance overrides
      end-to-end, the honest-stat host sheet over the shared BottomSheet, the bespoke Agent body over the
      shared ChatThread (D36/§15 contract; the no-outlines + Clear-appbar owner rulings);
      *(parked post-F5: per-host art-override UI + the asset format/size pass)*): own Fleet (art-map + GPS beacons, `x/y` via `present()`) + **bespoke Agent tab**
      (the 3-layer bobbing rig-stack empty state — the one non-Fleet structural deviation) + bottom-sheet `HostDetail` (**reuse cosmos's
      `components/BottomSheet.tsx` primitive** — multi-snap, see THEME_ENGINE §14.13 #9) + asset strategy
      (`import.meta.glob`; built-in Mœbius drawing set by index + per-host `host.appearance.frontier.image` override).

**Per-theme Fleet eyeball passes (owner directive):** each theme's Fleet (and frontier's Agent) gets a 390px design pass
to decide what host data to show / how to structure it — only the Fleet (+ frontier Agent) deviate; everything else is
vapor's functionality restyled via the Kit + tokens.

**Deferred within Phase 11 (don't build unless asked):** theme-switch `<link>` teardown (`@scope` makes coexisting
bundles harmless); a non-4 tab set (a theme can declare its own nav, none needs it in v1); a multi-device write-conflict
UI (LWW + reconcile suffices for one user).

## Phase 12 — Chat hardening & adoption (ACA) — **APPROVED 2026-07-07 · spec = [`AGENT_CHAT_AUDIT.md`](./AGENT_CHAT_AUDIT.md) §5 (build against it, NOT this list)**

Sequencing: *truth → hangs → integrity → durable turns → speed → steering → compaction v2 → routing →
approvals*. **Slices 1–2 are small/safe pre-deploy candidates; Slice 3+ is post-deploy** (4/5 reshape the
same event flow as 3 — don't reorder). Every slice ends with `python tools/check.py` + targeted pytest +
an owner-review pause. **New D-entries are drafted at each slice's design review, not
retroactively** — as built they landed as **D38 (Slice 2) · D39 (Slice 3) · D40 (Slice 4) · D41
(Slice 5) · D42 (Slice 6) · D43 (Slice 7) · D44 (Slice 8)**; the original "D35–D37" placeholders were
stale numbering (D35–D37 went to the frontier theme track). The cross-slice contract (ACA §5) governs which slice may touch which seam
(`_run_calls` internals · the per-thread turn marker · the append-only message log · suspension semantics).

- [x] **Slice 0 — doc truth** (no behavior change) ✅ PRE-LANDED 2026-07-07 (`ee23209`): api/agent.py +
      session.py docstrings → actual semantics; DESIGN ▹ target-design markers; MemGPT→Letta lineage notes.
- [x] **Slice 1 — hang-proofing & hardening batch** · M — MCP handshake/call deadline both transports
      (ACA-3, incl. the stdio-`__aexit__` cleanup-hang nuance) · timeout-normalizer `None` guard (ACA-6) ·
      backstop deadlines on SSH-backed actions + MCP/OpenAPI specs (ACA-7) · de-hardcode
      `subagent_child_timeout_s` + skill-selector tunables (ACA-8) · confirm-token hygiene on re-mint
      (ACA-9, owner call) · stall-guard call-sig (ACA-12) · malformed-args steering (ACA-13) · A8
      context-size debug measurement.
      ✅ BUILT 2026-07-16 (as-built record = ACA §5 Slice 1). 5 build commits `423b8e4` (ACA-3 MCP
      deadline) · `6ede3b5` (ACA-6/7) · `d693c00` (ACA-8/9) · `1223a79` (ACA-12/13/15e/20) · `1b5cbc8`
      (ACA-18/21 + A8) + the adversarial-audit fixes `69cddd7`+`c5097cd` (MED-1 `ToolCallPart.invalid_raw`)
      + the record `6c32368`.
- [x] **Slice 2 — turn integrity** · M — per-thread **turn marker** + 409s on every thread-mutating
      endpoint (chat/resume/plan/apply/compact/exec; ACA-2 interim) · rediscovery gated on quiet
      boundaries (ACA-17) · shielded-`finally` step persistence on cancel (ACA-1 scenario 2) · frontend
      guards: `/clear` while streaming (ACA-10), plan/apply gating, `mode` on resume (ACA-16).
      ✅ BUILT 2026-07-17 (design LOCKED = **D38**, `868cf8a`; as-built = ACA §5 Slice 2). 4 waves
      `afb5e22` (`Database.transaction()`, SYS-1) · `e228089` (the turn-marker registry) · `26a0bdb`
      (shielded-`finally`) · `dfd42d2` (FE 409 surfacing) + audit follow-ups `1d2c002`, record `0e1d057`,
      pre-push round `24015e5`.
- [x] **Slice 3 — durable turns** (ACA-1 + A11) · L — **flagship; design review first → D39** *(the
      "drafts D35" plan text was stale numbering)*. TurnRegistry + replayable per-turn event log
      (`turn_id:seq` cursor + snapshot fallback), SSE as subscriber, explicit cancel + Stop button,
      `cancelled` marker.
      ✅ BUILT 2026-07-18 (design LOCKED = **D39**, `0cb9e09`; as-built = ACA §5 Slice 3). 4 waves
      `fc500ef` (RunState.CANCELLED + `reconcile_stale_calls`) · `622f258` (server-owned turn tasks) ·
      `5a135aa` (re-attach/status/cancel + terminal cache) · `d7ea3a7` (FE re-attach + Stop) + `b7b4ca6`,
      the pre-push review rounds `aa83acf`+`5175756` (+ records `9669955`/`3d82e17`/`9ef46e9`) and the
      formal functionality audit `9cc7e93`+`0583507`+`a9e5199` (record `23b2098`, ACA §7).
- [x] **Slice 4 — interaction speed** · M — parallel read-only tool dispatch + per-call result streaming
      (the one structural `_run_calls` refactor; ACA-4) · `notice` in buffered mode (ACA-11) · A2 riders.
      ✅ BUILT 2026-07-19 (design LOCKED = **D40**, `44bdfdd`; as-built = ACA §5 Slice 4). 5 waves
      `dbd016b` (`ToolSpec.suspending` + `max_parallel_tools` + the llamacpp request gate) · `aad3366`
      (`_classify_batch`) · `63f0398` (**the** `_run_calls` async-generator inversion) · `dd86c33` (the
      parallel head) · `6427ded` (ACA-11 notice + debt discharge) + Codex fixes `df5ce7a`+`c961e8d`+
      `62ab584`, record `1e112b5`.
- [x] **Slice 5 — steering queue** (A1) · M — after Slice 3; upgrades the Slice-2 409 for *messages*
      (queue-then-inject); the 409 stays for plan/apply/compact collisions.
      ✅ BUILT 2026-07-19 (design LOCKED = **D41**, `0d000d4`; as-built = ACA §5 Slice 5). 5 waves
      `855c661` (queue core) · `1c7e5f8` (drain A) · `7ff227e` (drain B + harvest-first cancel) ·
      `e8a26f8` (the steering FE) · `dbdaee4` (DESIGN/SPEC sweep) + `ec50eae`/`6dfdcae` audit fixes and
      the Codex rounds `7adf8b2`+`5e383d6`, record `f80c1d9`.
- [x] **Slice 6 — compaction v2** (A3, absorbs ACA-5 riders) · M–L — design review first.
      ✅ BUILT 2026-07-19 (design LOCKED = **D42**, `d8c6744`; as-built = ACA §5 Slice 6). 6 waves
      `681310f` (v2 knobs + ModelRef call config + the `/props` probe) · `76b4a85` (window ladder +
      anchored estimator) · `f9c43bb` (clearing tier + summarizer template + thrash machine) · `7313155`
      (ModelRef wire + overflow backstop) · `c3d1dec` (Conf UI) · `c04e1f4`+`08ade3e` (docs/config sweep)
      + audits `483dc6a`/`2acd592` and the Codex fix waves `b1d0262`+`2e4dac9`, record `0ed9d80`.
- [x] **Slice 7 — model routing & retry visibility** (A4, A6, A7) · M — design review first (new D-entry).
      ✅ BUILT 2026-07-20 (design LOCKED = **D43**, `8c4a7b2`, draft `a7faef1`; as-built = ACA §5 Slice 7).
      5 waves `de88a54` (failover generator + retryable classifier) · `c748b58` (typed retry/failover
      events + `retry_status`) · `fa50a09` (the failure-fallback routing machine) · `4a62857` (FE) ·
      `77ea3a9` (DESIGN/SPEC sweep) + `1d8d520`, post-audit `0b46f19` and the Codex 3-HIGH unified fix
      `c00a640`, record `0977e91`. **`lead_turns` was DROPPED at review** (A4 reduced to failure-fallback).
- [x] **Slice 8 — approvals evolution** (A5) · M — aligns with ROADMAP privilege levels (D16/A1).
      ✅ BUILT 2026-07-20 (design LOCKED same day = **D44**; brief = [`SLICE8_PLAN.md`](./SLICE8_PLAN.md);
      as-built record = ACA §5 Slice 8). 3 waves: `08ef3c1` policy core (`ApprovalRule` +
      `ToolOverride.approvals` · `canonical_str`/`glob_escape`/`approval_match` · `decide(approved=…)`
      with `spec.confirm` split into its own un-downgradable rung · the `[auto-allowed: …]` summary
      marker · R1 `run_shell` pinned `confirm=True`) · `919680b` the server-side `execute_always` grant
      path (`runtime.grant_approval` + the shared `settings_write_lock`/`apply_settings_patch`, re-homed
      from `api/settings.py`; `always_eligible`) · `e080731` FE (the **always** bubble action + the
      `ApprovalsEditor` in `ToolCatalog` through the one `useSaveToolOverrides` write).

## Phase 13 — Unified provider registry (A11) — **design LOCKED 2026-07-22 (owner sign-off pending) · spec = [`DECISIONS.md` D48](./DECISIONS.md) (build against it, NOT this list)**

Retire the hardwired `inference.local`/`inference.cloud` pair + `VoiceEndpointCfg` slots + single-endpoint
`EmbeddingsCfg`; replace with one top-level `providers:` registry (connections + name-keyed model catalog)
and flat `provider` primary + ordered `fallbacks[]` per consumer section. **Config-only, no DB change.**
**NO LEGACY SEAMS** (D48): legacy awareness lives ONLY in the quarantined `_migrate_legacy()` fold; the
deleted classes go outright. Slice 1 = chat; Slice 2 = voice + embeddings. Both end with the full gate + a
Codex review; each ends with an owner-review pause. Test the migration + write-back on a **temp**
`CTRLB_CONFIG`/`CTRLB_DB`, never the real `config.yaml`.

- [x] **Slice 1 — chat: registry + resolver + Conf editors** · L ✅ **BUILT 2026-07-23** (uncommitted→committed same day; full pipeline: 2-agent pre-flight code-truth maps → 3 Opus build waves [backend core · backend API · frontend] → fresh-eyes Opus audit + Codex gpt-5.6-sol high review [NO-GO, 3 HIGH] → 18-fix wave → Codex fix-set verification [10/14 CLOSED, NO-GO residual] → fix round 2 [ETag-style `X-Providers-Rev` base binding] → full gate + e2e green. **Owner-review items: the strict-resolve gating interpretation + the Slice-2 deferral of voice-scoped model-field UI** — see the HANDOFF session block + D48 AS-BUILT note).
  - [x] `config.py`: `ProviderCfg` + `ModelCfg` schema; top-level `providers:` map + flat
        `inference.provider`/`fallbacks[]`; delete the local/cloud slots + `endpoint_chain` + the
        `local|cloud` literals in `_coerce_mode`/`ChatRequest`/`ChatMode`.
  - [x] `_migrate_legacy()`: the ONE quarantined raw-YAML fold (chat subtree — `[selected, other, *fallbacks]`
        order preserved; names derived from `api_mode`, collision-suffixed; catalog keyed by old model string) +
        the `mode:`→`provider:` fold for `agent.yaml`; idempotent; the explicit delete-list write-back channel.
  - [x] `domain/provider.py`: `ResolvedTarget` + `SectionPolicy` (frozen; `api_key: SecretStr`, `repr=False`).
  - [x] `core/provider_registry.py`: `resolve_strict` (422 on any error) + `resolve_lenient` (warn +
        drop/promote); `gate_identity` canonicalization + None-conflict min-wins; `(gate_identity, limit)`
        keying preserved (extend `test_inference_gate_d40`); chat adapter re-keyed to consume
        `tuple[ResolvedTarget, ...]`; `StreamReport.served_target` replaces `served_endpoint`.
  - [x] Rename transaction: `provider_renames` PUT transport metadata (bijective, stripped pre-persist);
        atomic rekey → replacement → cascade (incl. the **global** `agent.compaction.summarizer`, config.py:320)
        → third-provider preservation; path-aware secret handling + sentinel-key rejection; `providers`
        replacement semantics + base-revision **409**.
  - [x] `ModelRef {mode,model}` → `{provider,model}` plumbing across EVERY consumer (D48 C7-b: agent
        models + `agent.defaults` + compaction summarizer global/per-agent + routing lead) + `/⁠<provider>`
        verb resolution (built-ins > skills > providers); `GET /api/providers` (names + effective defaults +
        reserved verbs + live skill-collision warnings); `ChatMode` → `string | null` on the FE; **every FE
        `ModelRef` selector → the shared provider→model picker** (incl. `AgentsEditor`'s local/cloud `Seg`,
        raw-id escape kept).
  - [x] Conf UI: the **Providers** ConfGroup (provider cards + Rename control + Models sub-list, id
        reveal/edit affordance) + the **Inference** section editor (provider/model pickers + fallback rows +
        delete/rename reference-guard) + draft epoch (never reseed a dirty draft); warnings render inline.
  - [x] Tests (C11): migration shape/order/idempotency/legacy-delete/dedup+suffix · rename atomicity + secret
        restore + cascade · secret path-awareness (names `api_key`/`ssh_password`/`env`/`headers` + sentinel
        rejection) · gate canonicalization/None-conflict/generation-drain · dynamic mode strings end-to-end ·
        uncataloged-model probe eligibility · duplicate-target rejection · providers-base 409 · updated Conf
        e2e (no stale selectors).
  - [x] `python tools/check.py` (ruff · pyright · pytest · FE check-all) green → **Codex review** → owner-review pause.

- [ ] **Slice 2 — voice + embeddings: resolver reuse + parity** · M — mechanical over Slice 1's registry.
  - [ ] `config.py`: `voice.stt`/`voice.tts`/`embeddings` gain flat `provider`/`model?`/`fallbacks[]`; delete
        `VoiceEndpointCfg` primary/fallback + `EmbeddingsCfg` single-endpoint fields (service knobs STAY);
        `_migrate_legacy()` voice/embeddings folds (dedup by (canonical base_url, api_key) against
        already-created providers; per-endpoint voice/model fields → catalog entries).
  - [ ] Voice + embeddings adapters re-keyed to `resolve_lenient`/`resolve_strict`; **winning-format** media
        type from the served hop (model format > service format); TTS voice precedence request > model >
        `"alloy"`, `model.speed` at the wire; STT language model > service; embeddings **dim agreement** (422 /
        drop-mismatched+warn) + failover free.
  - [ ] Generation publication: `providers_changed` rebuilds inference + voice + embeddings together, atomic
        publish + DRAIN; voice SDK-client cache keys include the immutable transport (timeout pair); D46
        demotions clear on `providers_changed`.
  - [ ] Conf UI: **Voice STT / Voice TTS / Embeddings** section editors (provider/model pickers + fallback
        rows; every existing service knob stays put); the **B4 parity list asserted field-by-field** in the
        Conf e2e (inference timeout + both prompt controls · STT controls/timeouts · TTS auto-read/format/
        timeouts · embeddings dim/enabled).
  - [ ] Prod rollout artifacts (D48 §rollout): `config.example.yaml` new-shape only; SECURITY_MODEL secret
        list (`providers.*.api_key`), README config section, DEPLOY_EMMA updated same slice; the one-time
        0600 `.bak-a11-<stamp>` backup at the first write-back; `deploy/linux/README §Release` rollback
        ordering (stop → restore .bak → previous tag → start + health-check).
  - [ ] Tests (C11): voice winning-format + precedence · embeddings dim agreement · generation-drain
        publication · voice/embeddings migration dedup + collision · strict-vs-lenient policy pairs.
  - [ ] `python tools/check.py` green (+ release gate e2e, which the tag release runs) → **Codex review** → owner-review pause.

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
- [x] **Streaming `auto|on|off` + buffered chat (C1) ✅ SHIPPED 2026-06-21 (`3fb6603`, DECISIONS D17).** `session.collect_turn(events)` drains the existing `run_turn`/`resume` generator into a buffered JSON payload (loop NOT forked); `AgentCfg.streaming` (`auto|on|off`) is authoritative; the signal is a `stream` body field (OpenAI convention, revised from the original Accept-header plan); the client branches on response content-type and reuses the reload render path. A buffered confirm stays resumable (the token rides `collect_turn`). The OpenAI `/v1/chat/completions` facade stays deferred (ROADMAP E2).
- [x] **`question` message kind (A2) ✅ SHIPPED 2026-06-21 (`bb82882`).** A `question` builtin (`services/agent/question.py`, sibling of `task_plan`) suspends via the existing suspend path (`RunState.AWAITING_ANSWER`) + `tool.question` SSE event + a question bubble; `/api/agent/resume` is **extended** with `decision="answer"` + an `answer` field (no parallel endpoint) — the owner's reply is injected as the call's result. Reuses the confirm-suspend machinery as designed.
- [x] **D8 tool registry / Tools tab ✅ SHIPPED 2026-06-24 (Phase 8a + 8b, DECISIONS D8/D22).** `@tool` sugar over `@action`, `GET/POST /api/tools` (category-guarded facade over the one `ActionService`), the Tools tab = run cards (user+agent) + the agent-only catalog with per-tool description + tri-state agent-access mode (unified `tool_overrides`). Reuses `core/tool.py` (no parallel registry), as designed.

**Found *better* than documented:**
- [x] **A1 privilege ladder already implemented** ✓2026-06-14 in `core/permissions.decide()` (READONLY/CONFIRM/AUTO_LOW/FULL + `run_shell` gating); **ROADMAP A1 downgraded** to "selection/persistence UX only". **Selection layer specced ✓2026-06-16 in DECISIONS D16:** global default = `agent.defaults.privilege` (no new field), per-agent = `AgentDef.privilege` (shipped), per-session = new `ChatRequest.privilege` override, surfaced via header chip + sticky `/privilege` verb. Standalone slice (not 7e); per-host + time-boxed escalation deferred.

**Decisions to formalize:**
- [x] **Phase 5 (`run_shell`/`/api/exec`)** ✓2026-06-14 — **decided: KEEP + build.** The `!` prefix is the
  local-shell UX on the backend host (Claude-Code model), distinct from open-terminal. Full spec in the
  Phase 5 section (local-only · `shell.workdir` default `$CTRLB_HOME` · output→context · enabled-by-default).
- [x] **Voice config block ✅ SHIPPED (Phase 6a, 2026-06-22).** `config.py` now has `voice{enabled, stt:SttServiceCfg, tts:TtsServiceCfg}` over a base `VoiceServiceCfg` (primary→fallback chain + split timeouts), wired through `mask`/`unmask` and `runtime.set_voice` hot-apply. Conf → Voice · STT/TTS forms drive it.

**§2 blocking specs for the 7e build → locked in `DECISIONS.md` D15:** `agent.defaults` shape + merge precedence · `CTRLB_HOME` path + precedence · **agents folder-only (no migration; `agents:[]` removed from schema)** · `MemoryProvider` interface + injection point · `messages.agent` + resume resolution · `skill_manage` schema/scope · `session_search` scope + redaction · `AgentSelector` seam.

## Post-v1 backlog (see ROADMAP.md — build v1 seams now)

Not v1 scope, but the owner wants these; v1 must leave room. Detail + design notes in `ROADMAP.md`.

- [ ] **v1 seams (do these *during* v1 so the backlog slots in cheaply):** pluggable
      `MemoryProvider` interface; action `risk` levels on every action; **typed chat-message kinds**
      (`text`/`action`/`question`) + turn-based agent loop; chat endpoint supports **streaming AND
      buffered**; a settings/policy layer; Conf tab in **functional groups**.
- [x] Agent **privilege levels** (read-only → confirm-each → auto-low-risk → full) — policy over
      `risk` (ROADMAP A1). **✅ SHIPPED** — the ladder itself lives in `core/permissions.decide()`
      (audited 2026-06-14, see "Found *better* than documented" above); the selection/persistence layer
      is DECISIONS **D16** (`agent.defaults.privilege` · `AgentDef.privilege` · `ChatRequest.privilege`
      + the header chip / sticky `/privilege` verb). ACA Slice 8 (**D44**, `08ef3c1`) added the
      persisted-approvals rung inside the same `decide()`. *Still open (ROADMAP A1 tail): per-host +
      time-boxed escalation.*
- [x] Agent **clarifying questions** (`question` bubble, pause/resume) (A2) **✅ SHIPPED 2026-06-21
      (`bb82882`)** — `services/agent/question.py` suspends via the existing `RunState.AWAITING_ANSWER`
      path + a `tool.question` SSE event; `/api/agent/resume` extended with `decision="answer"` (no
      parallel endpoint). *Still open:* **notify-and-wait** when unattended/low-privilege (bridges
      A1+A3+F1).
- [ ] **Slash commands** registry + custom/extensible commands (A4). *(Basic `!`/`/` prefix routing
      + markdown/copy is in Phase 4 above.)*
- [ ] **Scheduled automations**: `Automation` table + cron runner + headless agent runs (A3).
- [x] **Streaming, decoupled per-transport (C1, 2026-06-16):** chat = `AgentCfg.streaming` auto|on|off
      (decided D17); TTS = own chunked-playback knob (Phase 6); STT = always buffered, no toggle. **Not**
      one global toggle. **✅ SHIPPED 2026-06-21 (`3fb6603`, D17)** — `session.collect_turn()` drains the
      one `run_turn`/`resume` generator into a buffered payload (loop not forked); the signal is the
      `stream` body field, `AgentCfg.streaming` authoritative. *(ROADMAP C3 chunked TTS synthesis remains
      the open sibling; the OpenAI `/v1/chat/completions` facade stays deferred — ROADMAP E2.)*
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
