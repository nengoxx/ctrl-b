# ctrl-b · dashboard_v2

A ground-up rewrite of `ctrl-b` — a single-user homelab control panel for waking,
monitoring, and managing a personal fleet of PCs over LAN + Tailscale, with a text/voice
LLM agent that drives **typed, allowlisted actions** instead of raw shell.

This folder is **self-contained and authoritative** for v2. The rest of the repo
(`wol_server/`, `ws_claude*/`, `ws_codex*/`, `ctrl-b (Vapor)/`) is the old project and
earlier prototypes — kept for reference, not imported or modified. The live Flask server
(`wol_server/wol_server_win.py`) keeps running until v2 reaches cutover.

## What v2 is

- **Frontend:** a mobile-first, installable **PWA** (React + TypeScript + Vite) that ports
  the **Vapor** design (`ctrl-b (Vapor)/variations/vapor.html`) — 4 tabs (Fleet / Agent /
  Utils / Conf), per-host services, vaporwave themes, a shared chat composer with
  push-to-talk mic and an auto-TTS toggle. Widens gracefully to desktop.
- **Backend:** a **FastAPI + Uvicorn** service exposing a typed JSON API + SSE streaming.
  Reuses the proven Python glue (`paramiko`, `wakeonlan`, `openai`, `youtube-transcript-api`).
- **Agent:** OpenAI-compatible chat (cloud, e.g. OpenRouter, **or** your local `llama.cpp`
  `llama-server`) with tool-calling wired to the typed-action registry. Voice in via
  OpenAI-compatible **STT** (faster-whisper), voice out via OpenAI-compatible **TTS**
  (Kokoro-FastAPI / openedai-speech) — each a configurable base URL.
- **Persistence:** **SQLite** for chat threads / messages / memory + the event log;
  **YAML** for human-editable config (hosts, endpoints, keys), editable in the Conf tab.
- **Security model unchanged:** Tailscale-only, single trusted user, no public bind. v2
  *strengthens* it by making typed actions the primary path and quarantining raw shell.

## Status

🚧 **Phases 0–4.5 done.** Fleet read/action path, the live tool-using **Agent** (tool-calling,
confirm bubbles, markdown, plan panel, context compaction), the 4f integrations (SearXNG
`web_search`, MCP client over Streamable-HTTP **and** stdio, open-terminal tools, a generic OpenAPI
provider, an embeddings client), and skills + agents/subagents are all in and live-probed against the
local model. Cloud chat (`/cloud` → OpenRouter) is wired; default stays local. Next candidates:
**Phase 7 Conf tab** (settings UI incl. skills/agents management) or Phase 5 (guarded shell).
**New session? Read [`docs/HANDOFF.md`](docs/HANDOFF.md) first** — it's the living status + next-step doc.

## Running (dev)

Two processes; Vite proxies `/api` → the backend (single origin, no CORS). The backend uses
port **5433** so it coexists with the live Flask app on 5432 until cutover.

```powershell
# backend  (from dashboard_v2/backend) — Windows: do NOT pass --reload (see note below)
py -3.11 -m venv .venv
.venv\Scripts\python.exe -m pip install -e .
.venv\Scripts\python.exe -m uvicorn app.main:app --port 5433

# frontend (from dashboard_v2/frontend) — new terminal
npm install
npm run dev          # http://localhost:5173  (or http://<host>:5173 on the tailnet)
```

```bash
# Linux/macOS — same thing, `--reload` is safe here
cd dashboard_v2/backend
python3.11 -m venv .venv
.venv/bin/pip install -e .
.venv/bin/uvicorn app.main:app --reload --port 5433
```

> **Windows + `--reload` gotcha.** Don't run the backend with `--reload` on Windows: uvicorn's
> reload worker uses an event loop that doesn't properly support `asyncio.create_subprocess_exec`,
> so `fleet.ping_host` (which shells out to `ping`) captures empty output and every host shows
> offline. Linux and macOS are unaffected. Run plain (no `--reload`) on Windows, or use
> `watchfiles` externally to restart.

Config is **hybrid** (docs/DESIGN.md §9): `config.yaml` (copy from `config.example.yaml`,
gitignored) is the UI-managed source of truth incl. nested secrets; `.env` (copy from
`.env.example`, gitignored) adds bootstrap paths + optional `CTRLB_<SECTION>__<KEY>` overrides
that win over the YAML. Both are optional — built-in defaults apply without them. The SQLite
file (`ctrlb.db`) is created on first run.

## Agent subsystem

The agent is a **tool-using chat loop**: the model sees the typed-action registry as OpenAI
function-calling `tools`, and the loop runs the calls it emits through the **same `ActionService`**
(validate → risk/privilege gate → execute → audit) that the UI buttons use. There is no separate
agent execution path — every capability (fleet actions, `web_search`, MCP tools, open-terminal,
OpenAPI ops, `task_plan`, `spawn_subagents`) is one entry in one registry, so adding a tool gives the
agent the ability for free. Canonical deep design is in [`docs/DESIGN.md`](docs/DESIGN.md) (§3 registry,
§5 agent loop, §12 SSE); this section is the operational map + the configurable knobs.

### The turn loop (`backend/app/services/agent/session.py`)

`AgentSession` is built per request (state lives in SQLite, so a dropped SSE stream can reconnect).
A turn flows: `run_turn` (persist the user message, activate skills) → `_drive` (the loop) → for each
iteration: **compact if over threshold → assemble OpenAI context → stream the model → run any tool
calls via `_run_calls` → loop until the model returns text-only**. Tools stream back as `.b.cmd`
command bubbles; reasoning (thinking models) streams dimmed and is **not** replayed into context.

Terminal states (the `done` SSE event):
- **completed** — the model returned a final text answer.
- **suspended** — a med/high-risk call hit the **confirm gate**: the call is persisted
  `AWAITING_CONFIRM`, a `tool.permission` event carries a single-use TTL'd token, and the turn parks.
  The UI's execute/dismiss re-opens a stream via `resume()`.
- ~~capped~~ → **forced wrap-up**: when the loop stalls or exhausts `max_iterations`, instead of a
  silent dead-end it makes one **tool-less** model call ("give your final answer now") so the owner
  always gets a reply. `capped` now only appears if that final call itself errors.

### Risk → privilege gating (the confirm bubbles)

Every tool has a `risk` (LOW/MED/HIGH). The agent runs at a configurable **privilege** (`AgentDef.privilege`,
default `CONFIRM`): LOW auto-runs; MED/HIGH gate on a confirm bubble. Same `decide()` policy as the UI
(just `Actor.AGENT`). Change the privilege and the gating changes — no per-tool logic. Headless
subagents (no UI) **deny** a confirm-gated call in place rather than stalling.

### Loop discipline (capability layer C1) — keeps weak models from spiralling

Local models can mis-drive the loop (a live probe saw a search tool fired ~16× with trivially-varied
queries until the cap, with no answer). Four layered guards, all in `_drive`/`_run_calls`, **scoped to
one turn**:
- **Duplicate-call suppression** — an identical `(tool, args)` call past `max_repeat_calls` is *not*
  executed; the prior result is echoed back with a steering note. A threshold of 2 still allows a
  legitimate re-poll (ping → wake → ping). Suppressing a *mutating* duplicate is also the safe default.
- **Per-tool cap** — any one tool may run at most `max_calls_per_tool` times per turn regardless of
  args; beyond that it's refused with a steering note. The catch-all for a model that spams one tool
  with *varied* inputs (raise it for a research-heavy agent).
- **Result-based progress** — a call whose *outcome* repeats one already seen this turn doesn't count
  as progress, so varied-but-equivalent calls (identical results) trip the stall guard rather than
  looking like forward motion.
- **Stall detection + forced final answer** — `max_stall_iterations` consecutive no-progress
  iterations force one tool-less wrap-up call, so a turn always ends with an answer, never a dead-end.

> Note: these **contain** weak-model spinning (bounded calls, always an answer) but don't *fix tool
> selection* — see the C2 limitation below.

### Tool-selection guidance (capability layer C2)

The default system prompt carries routing rules and the tools' `description=` say *when (not) to use*
them — but **prompt steering alone does not fix a weak local model.** Live finding: with all 21 tools
visible, `minig+` hallucinates names (`mcp__fleet_ping`, `fleet.ping_host`) by over-generalizing the
`mcp__…__…` namespace, never calls `task_plan`, and spams web search. **The fix is toolset size, not
the model** — narrowing to a small, cleanly-named set makes `minig+` behave perfectly.

**Solution — intent skills with auto-selection (no global restriction):**
The agent stays general (`tools: "*"`), and an **intent skill** (`skills/<name>/SKILL.md` with
`allowed_tools`) **auto-activates when the request matches its description** (`KeywordSkillSelector`,
the deterministic little-coder approach) and **narrows the toolset for that turn**. Verified: with the
`fleet` skill present, the exact prompt that used to spam 16 searches now runs 4 clean calls —
`task_plan` → `ping_host` → `open_service_url`×2 → accurate answer, zero hallucinated names.

**Opt-out for capable models:** set **`skills: []`** on an agent → no auto-selection, it sees every
tool and chooses for itself (the Claude-Code model-invoked approach). The `SkillSelector` is a
swappable strategy (D11): deterministic keyword (weak models) vs model-invoked (capable). So tool
selection is **per-agent config**, from "auto-narrow by intent" to "full toolset, own judgment."

C1's loop discipline remains the model-agnostic safety net regardless. (The deferred **C3
prompted-JSON** strategy in `docs/HANDOFF.md` is a further lever for models with weak native calling.)

### Agents, skills, subagents

- **`AgentDef`** (`domain/agent.py`) is the configurable shape of an agent: `prompt`, `model`
  (backend+id), `tools`/`skills` allowlists (globs; `"*"` = all), `privilege`, `compaction` override,
  and the loop/subagent caps. Configured under `agents:` in `config.yaml`; the default chat agent is a
  synthesized default when none are set. A new thread's agent is named by `agent.default_agent`.
- **Skills** (`skills/<name>/SKILL.md`) inject instructions and narrow the toolset for a turn —
  model-invoked by description match (`KeywordSkillSelector`) or user-invoked via `/skill-name`. Both
  the provider and the selector are swappable interfaces (D11).
- **Subagents** — `spawn_subagents` (MED) delegates independent tasks to children run in bounded
  parallel, **headless**, depth-capped (`max_subagent_depth`), privilege-clamped to the parent. A child
  **inherits every parameter from its parent** (model, compaction, caps, allowlists); a *named*
  subagent def overlays only the fields it sets.

### Context compaction

Before each model call, if the working context exceeds `compaction.threshold_tokens`, the oldest
complete turns fold into a summary system message (full history kept in SQLite). Turn-boundary-safe
(an assistant `tool_calls` is never split from its results). Manual `/compact` forces it. The
summarizer model is independently selectable (`compaction.summarizer`).

### Configurable knobs (no hard-coding — tune in `config.yaml`)

Per-agent, on each `AgentDef` (under `agents:`), inherited by its subagents:

| Knob | Default | Effect |
|---|---|---|
| `prompt` / `model` | built-in / chat default | system prompt; inference backend + model id |
| `tools` / `skills` | `"*"` | allowlists (names/globs) |
| `privilege` | `confirm` | gating: `confirm` gates MED/HIGH; other rungs land post-v1 |
| `max_iterations` | 16 | tool-call loop hard cap (→ forced wrap-up) |
| `max_repeat_calls` | 2 | identical `(tool,args)` calls before suppression (C1) |
| `max_calls_per_tool` | 6 | total calls to any one tool per turn before refusal (C1) |
| `max_stall_iterations` | 2 | no-progress iterations before forced wrap-up (C1) |
| `max_subagent_depth` / `max_concurrent_subagents` | 2 / 3 | subagent tree limits |
| `compaction.*` | global `agent.compaction` | per-agent context-window override |

Global agent settings live under `agent:` (`default_agent`, `global_subagent_limit`,
`subagent_clamp_privilege`, `skills_dir`, `skills_enabled`, `compaction`). Inference endpoints +
`default_mode` under `inference:`; integrations under `searxng:` / `mcp_servers:` / `open_terminal:` /
`openapi_servers:` / `embeddings:`.

### SSE event vocabulary (client ↔ `/api/agent/chat` · `/resume`)

`thread` · `message.start` · `reasoning.delta` · `text.delta` · `part.added` (tool_call) ·
`tool.permission` (confirm gate) · `tool.result` · `compaction` · `message.end` · `error` ·
`done {state}`. Full contract in `docs/DESIGN.md` §12.

## Docs

| File | What it covers |
|---|---|
| [`docs/HANDOFF.md`](docs/HANDOFF.md) | **Start here in a fresh session** — orientation + first action. |
| [`docs/DECISIONS.md`](docs/DECISIONS.md) | Locked-in choices and the reasoning behind each. |
| [`docs/DESIGN.md`](docs/DESIGN.md) | Concrete code design — data structures, registries, the agent loop, persistence, concurrency, flows, edge cases, extension cookbook. |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | System design: backend, frontend, data model, action registry, agent/voice, deployment profiles. |
| [`docs/RESEARCH.md`](docs/RESEARCH.md) | Framework/library survey with sources and version pins. |
| [`docs/TODO.md`](docs/TODO.md) | Phased, checkbox build plan from empty folder to cutover. |
| [`docs/ROADMAP.md`](docs/ROADMAP.md) | Future additions (privilege levels, automations, wake word, idle shutdown, bots, …) + the v1 seams to build now so they slot in. |

## Layout (approximate — the real tree is layered `domain/ · services/ · adapters/ · api/`; see `docs/ARCHITECTURE.md`)

```
dashboard_v2/
  backend/            # FastAPI app (Python 3.11+)
    app/
      main.py         # app factory, route mounting, SPA static serving
      config.py       # YAML load/save + Pydantic Settings
      db.py           # SQLite (threads, messages, memory, events)
      models/         # Pydantic schemas (Host, Service, Action, Event, ...)
      hosts.py        # ping / WOL / SSH, concurrent status
      actions/        # typed-action registry (wake, shutdown, start_service, ...)
      agent.py        # OpenAI-compatible chat + tool-calling + memory
      voice.py        # /voice/stt (multipart in), /voice/tts (audio out)
      utils.py        # yt-captions, ip-info
      api/            # routers grouped by resource
    pyproject.toml    # pinned deps
  frontend/           # React + TS + Vite PWA
    src/
      api/            # typed client + TanStack Query hooks
      tabs/           # Fleet, Agent, Utils, Conf
      components/     # composer, device row, command bubble, ...
      theme/          # vapor / aqua / ember CSS variables
    vite.config.ts    # + vite-plugin-pwa
    package.json
  docs/
```

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for why it's split this way.
