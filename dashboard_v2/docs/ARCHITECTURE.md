# Architecture — dashboard_v2

How the pieces fit. Reflects the locked decisions in `DECISIONS.md`. The Vapor prototype
(`ctrl-b (Vapor)/variations/vapor.html`) is the visual source of truth; this maps its UI onto a
real, typed backend.

> **⚠️ Reconciliation note (2026-06-14).** This doc is a pre-build sketch; it predates Phases 7a–7d
> and **D14/D15**. Where it conflicts with shipped code or those decisions, **`DECISIONS.md`
> D14/D15 and `DESIGN.md` win.** Specifically: (1) **agents are folder-only** (`$CTRLB_HOME/agents/<name>/`
> = `agent.yaml` + `SOUL.md` + `memories/` + `skills/`) — there is **no `agents:[]` list** in config
> (D14/D15 #3); (2) **memory** follows the Hermes file model (§4 below is superseded by D14/D15 #4–#7);
> (3) module/file names here are **illustrative** — the real layout is `services/` + `adapters/` +
> `api/` (see `DESIGN.md` §1); (4) **C1 streaming `auto|on|off` + buffered chat** (D17) and the **A2
> `question` message kind** are now **shipped** (the `stream` body field + `agent.streaming` setting +
> `collect_turn`); (5) endpoints `/api/prompts`, `/api/memory`, `/api/exec`, `/api/tools` are **not built** —
> the real routers are `/api/agents`, `/api/integrations`, `/api/skills`, `/api/agent/default-prompt`.

```
┌────────────────────────────── Android / Desktop browser ──────────────────────────────┐
│  React + TS PWA  (mobile-first; Fleet · Agent · Utils · Conf)                            │
│   TanStack Query ──poll/mutate──┐     MediaRecorder ──audio──┐     <audio> ◀──tts audio  │
└─────────────────────────────────┼────────────────────────────┼──────────────────────────┘
                                   │  HTTPS (Tailscale Serve)    │
┌──────────────────────────────── FastAPI + Uvicorn ────────────┼──────────────────────────┐
│  /api/hosts /services /events(SSE) /agent/chat(SSE) /voice/* /settings /prompts /tools    │
│        │                  │                    │                    │                      │
│   Host layer         Action registry      Agent (openai)      Voice (openai)               │
│   ping/WOL/SSH       typed + guarded-$     tools=registry      STT in / TTS out            │
│        │                  │                    │                    │                      │
│   ┌────┴──────────────────┴────────────────────┴────────────────────┴────┐                │
│   │ SQLite: threads · messages · memory · events    YAML: hosts · keys ·  │                │
│   │                                                  endpoints · server   │                │
│   └───────────────────────────────────────────────────────────────────────┘               │
└───────────┬───────────────────────┬───────────────────────┬───────────────────────────────┘
            │ SSH/ping/WOL           │ /v1/chat/completions   │ /v1/audio/{transcriptions,speech}
        the fleet (LAN)        llama.cpp / OpenRouter      whisper / kokoro servers
```

---

## 1. Backend (FastAPI)

### App shape

- `app/main.py` — app factory; mounts routers under `/api`; serves the built SPA
  (`StaticFiles` + SPA fallback) in prod. Dev: Vite proxies `/api` to uvicorn.
- `app/config.py` — load/save `config.yaml`; expose as a typed `Settings` (pydantic-settings).
  Secrets (SSH passwords, API keys) never logged, never returned in full (mask on read).
- `app/db.py` — SQLite schema + helpers (`aiosqlite`). Migrations: a tiny versioned `schema.sql`
  applier is enough; no ORM needed for this size.
- `app/models/` — Pydantic schemas shared by API, registry, and agent tool-schemas.
- `app/api/` — routers grouped by resource (hosts, services, agent, voice, settings, events,
  tools).

### Host layer (`app/hosts.py`)

- `status()` pings **all hosts concurrently** with `asyncio.gather` (fix for the old serial
  blocking loop). Per-OS ping flags behind a `platform` shim.
- `wake(host)` → `wakeonlan`. `shutdown(host)` → SSH (`paramiko`) with the per-OS command.
- Results normalize into `HostStatus { online, ping_ms, last_seen }`, cached briefly.

### Action registry (`app/actions/`) — the core of the security model

```python
@action("shutdown_host", risk="high", confirm=True)
async def shutdown_host(inp: ShutdownHostInput) -> ActionResult:
    ...
```

- Each action = function + Pydantic input model + `risk` (low/med/high) + `confirm` flag.
- One registry feeds **both** the UI (buttons map to action names) and the **agent**
  (registry → OpenAI `tools` schema). Every invocation writes an `Event` row.
- Initial actions (from SPEC + Vapor): `wake_host`, `shutdown_host`, `ping_host`,
  `start_service`, `stop_service`, `restart_service`, `open_service_url`, `run_health_check`,
  `switch_gpu_workload` (inference box), and the guarded `run_shell`.
- **`run_shell` (guarded `$` escape hatch):** captures stdout/stderr with a **timeout**, targets
  `local` or a remote host (SSH), `risk="high"`, **excluded from the agent's tool set by
  default** (setting-gated), always logged. Replaces the old detached `cmd /k` window with
  captured, cross-OS, headless-safe execution.
- **Services need per-OS command maps:** `start/stop/restart` resolve to `systemctl --user`/
  `systemctl` on Linux vs `Start-Service`/`nssm`/scheduled task on Windows, declared per service
  in config.

### Agent (`app/agent.py`)

> **Prior art:** this subsystem is large enough to be its own project — before building it, study
> `RESEARCH.md` → "Prior art for the agent/chat subsystem" (opencode's session/loop/permission
> patterns + public Claude-Code interaction patterns via the Agent SDK; the leaked `claude-code`
> repo is intentionally excluded).

- Uses the `openai` SDK against the configured backend (`local` = llama.cpp `llama-server`
  `/v1`, or `cloud` = OpenRouter et al.). **Supports both streaming (SSE) and buffered (single
  JSON) responses** from day one — a `streaming: auto|on|off` setting + graceful fallback when a
  backend can't stream (ROADMAP C1). Non-streaming is a first-class path, not an afterthought.
- Tools = an **aggregated toolset** from four sources, all surfaced to the model uniformly:
  (1) the **typed-action registry** (§1), (2) `agent_exposed` **utility tools** from the tool
  registry (§Tools, e.g. `dns_trace`, `web_search`), (3) **built-in agent tools** (below), and
  (4) **tools from connected MCP servers** (see Integrations). Whether a proposed action
  **auto-runs or waits for confirmation is governed by the agent privilege level** (policy over
  each tool's `risk` — ROADMAP A1): Read-only / Confirm-each / Auto-low-risk / Full. `confirm`
  actions always surface as a **command/action bubble** (Vapor `.b.cmd`) with execute / edit /
  dismiss. **Adding a new agent tool = one file** (same registry as §Tools — D8) — the toolset is
  designed to grow.
- **Built-in agent tools (ship in v1):**
  - **`task_plan`** — the agent maintains a structured **plan / task list** for the session (steps
    with status: pending/active/done), à la Claude Code's TodoWrite. Persisted per-thread; rendered
    in the chat UI as a live plan panel (a `plan` message kind). Drives multi-step work and makes
    headless automations (A3) legible. The model calls it to (re)write the plan as it progresses.
  - more built-ins slot in via the registry as needed.
- **Skills (ROADMAP A5):** reusable, named capability bundles — a `SKILL.md`-style file (frontmatter
  `name`/`description`/optional `allowed_tools` + instructions) plus optional bundled scripts/
  resources. **Model-invoked** (the agent picks a skill when its description matches the task) and/or
  **user-invoked** via `/skill-name` (ties to A4 slash commands). Discovered from a `skills/` dir;
  **adding a skill = dropping a folder**; managed in Conf → Skills. Mirrors Claude-Code/opencode
  skills.
- **Integrations (all configurable in Conf — D9):**
  - **MCP client** — the agent connects to multiple **MCP servers** over **stdio** *and*
    **Streamable HTTP** transports; their tools merge into the aggregated toolset (namespaced to
    avoid collisions). Each server is configured in settings: `name`, `transport`, `command+args+env`
    (stdio) or `url+headers` (http), `enabled`. Tool discovery + per-server enable/disable; failures
    isolated so one bad server doesn't break the agent. (Use an MCP client lib, e.g. the official
    Python MCP SDK.)
  - **SearXNG** — a configurable endpoint powers a built-in **`web_search`** tool (hits SearXNG's
    `format=json` API). *(Alternatively/additionally usable via a SearXNG MCP server — both paths
    supported; pick per taste in settings.)*
  - **Embeddings** — a configurable OpenAI-compatible **`/v1/embeddings`** base URL (your llama.cpp
    embedding model) feeds the **vector** `MemoryProvider` (§4) and any future semantic search.
- **Turn-based chat loop with typed message kinds** — `text`, `command|action`, **`question`**
  (clarify mid-task, optional choice chips, then resume — ROADMAP A2), and **`plan`** (the
  `task_plan` panel). Build the loop turn-based and the message kinds extensible from the start.
- **Context compaction (ROADMAP A5/B2):** the loop tracks the token budget and, when nearing the
  model's context limit (configurable threshold) — or on a manual **`/compact`** — **summarizes
  older turns into a compact summary** that replaces them in the *working context*, while SQLite
  keeps the **full history** untouched. The **summarizer model is separately selectable in settings**
  (mode local/cloud + a specific model name), so a cheap/fast model can compact independently of the
  chat model. Distinct from durable memory (§4): compaction manages the live window; memory is
  long-term recall. Surfaced as a `sys` notice ("// compacted N messages").
- **Agents are definitions; subagents are agents-as-tools (ROADMAP A6).** An **Agent** = a named
  config: system prompt, backend+model, allowed tools/skills, privilege level, memory settings.
  There can be **several** (the owner can add more), with one default chat agent. A **`spawn_subagent`**
  built-in tool lets an agent **delegate** a scoped task to another agent definition (own context +
  tool subset), returning a result — à la Claude-Code subagents / opencode's coordinator. The
  "main" agent is just one definition; subagents reuse the same machinery.
- **Pluggable strategies (decided at build time, swappable in settings):** **skill auto-selection**
  and **subagent orchestration** are behind small strategy interfaces with a sensible default
  (informed by the prior art in `RESEARCH.md`). Keep them **easy to replace or switch** — don't
  hardcode one approach. Specifics intentionally deferred to Phase 4 (see ROADMAP A5/A6).
- Capability fallback for weak local models: if tool-calling is unreliable, the model just
  drafts a shell/action into a reviewable bubble (the current command-box behavior).
- The same agent + registry run **headless** for scheduled automations (ROADMAP A3), with a
  per-automation privilege level and a no-human policy for `question`/`confirm` cases.
- **Memory** (see §4) is injected into the system prompt per request via a pluggable provider;
  managed from Conf.

### Voice (`app/voice.py`)

- `POST /api/voice/stt` — multipart audio in → forwards to the OpenAI-compatible STT
  (`/v1/audio/transcriptions`) → returns `{ text }`.
- `POST /api/voice/tts` — `{ text, voice? }` → forwards to TTS (`/v1/audio/speech`) → streams
  audio back. Voice/model/format configurable.
- Both are thin proxies so the browser never holds STT/TTS keys and CORS/secure-context stays
  simple (single origin).

### Tools / Utils (`app/tools/`) — an extensible tool registry

Utilities are **not one-off endpoints** — they're a **pluggable tool registry** so adding a new
tool (DNS trace, whois, port check, speedtest, …) is a small, self-contained drop-in. Mirror the
action-registry pattern:

```python
@tool("dns_trace", title="DNS / traceroute", icon="globe",
      input=DnsTraceInput, agent_exposed=True)
async def dns_trace(inp: DnsTraceInput) -> ToolResult: ...
```

- Each tool = a **handler** + a Pydantic **input model** + display metadata (title, icon, desc) +
  an `agent_exposed` flag. Registering it **auto-exposes three things from one definition**:
  1. a REST endpoint under **`/api/tools/{name}`** (input validated by the model),
  2. a **Utils-tab card** (the frontend renders cards generically from `GET /api/tools`),
  3. optionally an **agent tool** (same registry feeding the agent — so the bot can "trace DNS for
     X" or "grab captions for this video").
- **Adding a tool = one file** (handler + input model + metadata) — no routing, no UI, no agent
  wiring by hand. This is the "extensible with new tools easily" requirement.
- **v1 tools (ported from the old server):** `yt_captions` (transcript → JSON download) and
  `ip_info` (lookup). **`dns_trace`** is the first *new* tool, proving the extension path. Result
  shapes support file downloads (captions) and key/value result panels (ip/dns) per the Vapor
  Utils cards.
- Tool results render in the Vapor `.util` card layout (`.uhead` glyph + `.ubody` field + `.result`
  kv grid / download link); the frontend card component is generic over the tool's declared
  result shape.

---

## 2. API surface

```text
# Fleet
GET    /api/hosts                       list hosts (+ derived status)
POST   /api/hosts                       create host          (Conf)
GET    /api/hosts/{id}
PUT    /api/hosts/{id}                  edit host            (Conf)
DELETE /api/hosts/{id}
GET    /api/hosts/{id}/status
POST   /api/hosts/{id}/wake
POST   /api/hosts/{id}/shutdown
# Services
GET    /api/services
POST   /api/services/{id}/actions/{action}
# Actions (generic) + guarded shell
GET    /api/actions                     registry (names, inputs, risk) — also the agent toolset
POST   /api/actions/{name}              invoke a typed action (with confirm token if required)
POST   /api/exec                        guarded run_shell (dangerous; setting-gated)
# Events / audit
GET    /api/events                      recent events
GET    /api/events/stream               SSE live feed
# Agent + memory
GET    /api/threads                     list chat threads
POST   /api/threads                     new thread
GET    /api/threads/{id}/messages
DELETE /api/threads/{id}
POST   /api/agent/chat                  SSE token stream OR buffered JSON (D17 `stream` field); may emit action/command bubbles
GET    /api/memory                      list memory items     (Conf)
POST   /api/memory / DELETE /api/memory/{id}
# Voice
POST   /api/voice/stt                   multipart audio  -> { text }
POST   /api/voice/tts                   { text, voice } -> audio stream
# Settings / prompts
GET    /api/settings  /  PUT /api/settings        (config.yaml-backed; secrets masked)
GET    /api/prompts   /  PUT /api/prompts/{name}  (command_prompt, system_prompt, ...)
# Tools (extensible registry — see §1 Tools/Utils)
GET    /api/tools                       list registered tools (name, title, icon, input schema)
POST   /api/tools/{name}                run a tool (yt_captions, ip_info, dns_trace, ...)
```

---

## 3. Data model

> Summary view. The **authoritative, detailed** models (message-parts, the unified `Tool`
> abstraction, `AgentDef`, result/event types, SQLite schema) live in **`DESIGN.md`** — where the
> two differ, `DESIGN.md` wins (e.g. `Message` uses a typed `parts[]` list, not a flat `content`).

YAML config (hosts/services/endpoints/keys/server/voice) + SQLite (chat/memory/events).

```
Host      id, name, ip, mac, ssh_username, ssh_password*, ssh_port=22, os_type, role, tags[],
          idle_action(none|sleep|shutdown), idle_minutes   # idle fields = ROADMAP D1
Service   id, host_id, name, kind, port, path, autostart, cmd_start/stop/restart (per-OS)
Action    name, inputs(schema), risk, confirm   (code-defined, not stored)
Event     id, ts, actor(user|agent|system|automation), action, target, status, summary, output  [SQLite]
Thread    id, title, agent, created_at, updated_at, archived                      [SQLite]
Message   id, thread_id, role, parts[](JSON; DESIGN §4), actor, agent(D15 #5), ts, tokens, compacted [SQLite]
Skill     file-based: $CTRLB_HOME/skills/ (default agent) + agents/<n>/skills/ (per-agent, D14)  [disk]
Memory    files: $CTRLB_HOME/memories/{MEMORY.md,USER.md} + agents/<n>/memories/MEMORY.md (D14)  [disk]
          (the SQLite `memory` table is UNUSED — reserved for the later vector store, D15 #4)
Automation id, name, cron, prompt, privilege, thread_id, enabled, last_run, status [SQLite]  # ROADMAP A3
Settings  inference{mode, local_url, cloud_url, cloud_key*, model},
          embeddings{url, key*, model},                       # llama.cpp /v1/embeddings (D9)
          stt{url, key*, model}, tts{url, key*, model, voice},
          searxng{url, enabled},                              # web_search tool (D9)
          mcp_servers[]{name, transport(stdio|http), command, args, env*, url, headers*, enabled},  # D9
          agent{default_agent, defaults{…AgentDef-shaped…}, global_subagent_limit, clamp_subagent_privilege,
                compaction{enabled, threshold_tokens, keep_last_messages, summarizer{mode,model}}},  # D10/D11/D15#1
          # NO agents[] list — agents are folder-only under $CTRLB_HOME/agents/<name>/ (D14/D15 #3)
          memory{enabled, user_profile_enabled, auto_write, memory_char_limit, user_char_limit},  # D14/D15 #4
          skills{enabled, auto_write},   # skill_manage self-authoring, default off (D15 #6)
          server{host, port, poll_seconds, feature_cycle_seconds, debug}, appearance{theme, skyline, ...}  [YAML]
          # Paths resolve from $CTRLB_HOME (env; default project-root); CTRLB_CONFIG/CTRLB_DB still override (D15 #2)
```
`*` = secret: gitignored in YAML, masked in API responses, never logged.

Migration from the current `config.yaml`: `computers{}` → `Host` rows is mechanical; `services`
and per-OS service commands are net-new (additive, optional).

---

## 4. Agent memory (pluggable — configurable in Conf)

> **⚠️ Superseded by D14/D15 (2026-06-14).** v1 memory is the **Hermes-style file model**, not the
> generic none/file/vector sketch below: per-agent `memories/MEMORY.md` + a global
> `memories/USER.md` (under `$CTRLB_HOME`), injected into the system prompt (Hermes-formatted: usage
> header + `§` delimiters), self-curated by an autonomous `memory` tool (add/replace/remove · target
> memory|user · `memory.auto_write` kill switch · configurable caps 2200/1375). `session_search`
> (FTS5 over `messages`, redacted, global) is the recall tier. The **vector** store (the SQLite
> `memory` table + embeddings client) is the later "both" mode. See **DECISIONS.md D14 + D15 #4–#7**;
> the `MemoryProvider` Protocol below is still the seam, with `FileMemoryProvider` as the v1 impl.

Memory is a **`MemoryProvider` interface** (`load_context()`, `remember()`, `forget()`, `list()`)
so the backend is **selectable in settings**, not hardcoded (ROADMAP B1):

- **None** — stateless beyond the current thread.
- **File-based** — a human-editable markdown file (`MEMORY.md` / `CLAUDE.md`-style): curated,
  pinned, durable facts; git-diffable. *(v1 target — simplest, transparent.)*
- **Vector** — embeddings store for semantic recall (drop-in later; uses an OpenAI-compatible
  `/v1/embeddings` base URL, same pattern as chat/STT/TTS).
- **Both** — curated file facts + fuzzy vector recall.
- **Rolling summary** (orthogonal) — compress old turns to stay in context; pairs with any backend.

Conf → Memory section: pick backend, toggle rolling summary, view/edit file memory, prune/clear
(per-thread / all), vector-store status. This is the "memory management in settings" requirement.
v1 ships the `none` + `file` providers behind the interface; vector slots in without a rewrite.

---

## 5. Frontend (React PWA)

> ### ⭐ HARD REQUIREMENT — pixel-exact Vapor fidelity
> The UI must **match `ctrl-b (Vapor)/variations/vapor.html` exactly** — same look, feel, and
> motion. This is not "inspired by"; it is a faithful port. Concretely:
> - **Lift the CSS verbatim** from `vapor.html` (the `:root` + `[data-theme]` variable system) —
>   don't re-derive colors/spacing/radii. Keep all three palettes (**vapor / aqua / ember**).
> - **Fonts:** JetBrains Mono (UI/body) + Major Mono Display (display) — same weights/sizes.
> - **All animations preserved:** hero sun bob + retrowave stripes, twinkling stars, moving neon
>   grid, `city`/`mountains` skyline SVGs, status LED heartbeat, mini-equalizer bars, the live
>   waveform canvas, the sliding tab-bar indicator, shimmer/glow effects.
> - **Exact components:** appbar w/ logo lozenge + auto-TTS toggle; hero "now monitoring" panel +
>   dots; device rows w/ expandable dropdown (services + kv details + wake/stop mask-icon buttons);
>   fleet summary; chat bubbles incl. command bubble; `.util` tool cards; Conf rows/segments/
>   switches; the fixed composer (textarea + mic + send) above the bottom tab bar.
> - **Same toggles** the prototype exposes (theme, app-mark logo/ring, skyline city/mountains, hero
>   on/off, live waveform) live in Conf → Appearance and behave identically.
> - Verify side-by-side against the prototype at phone width before a tab is "done." Componentize
>   into React, but the rendered result should be visually indistinguishable from `vapor.html`.

- **Tabs** = Vapor's four: **Fleet** (hero + device rows w/ expandable services + fleet
  summary), **Agent** (chat log, shares composer), **Utils** (extensible tool cards — YT captions,
  IP lookup, DNS trace, …), **Conf** —
  organized into **functional groups** (Inference · Agent · Agents · Skills · Memory · Voice ·
  Automations · Fleet/Hosts · Server · Notifications · Appearance · Integrations) so future toggles
  land in obvious homes; full layout in `ROADMAP.md` → "Settings tab".
- **Composer** (shared by Fleet + Agent): textarea + push-to-talk mic + send. **Prefix routing**
  (Claude-Code-style), command sigil **configurable in settings**:
  - `!<cmd>` → **run shell directly** via the guarded `run_shell` action (the Claude-Code "bang"
    mode). Default sigil `!`, configurable; this is the **only** command prefix (no `$`/`>`).
  - `/<command> [args]` → **slash commands**: app/agent verbs → typed actions or UI ops. Includes
    **`/local` and `/cloud`** to force the inference backend for one message (replacing the old
    `k:`/`o:`), plus `/wake titan`, `/sleep`, `/clear`, `/model`, `/help`, and custom/extensible ones.
  - anything else → natural language to the **agent**.
- **Bot output formatting + copy-to-composer:** assistant messages render **markdown** (code
  blocks, lists, etc.) neatly. Any **code/command block gets a copy button *and* a
  "send-to-composer" action** that drops the text into the input field for tweak-then-run —
  generalizing Vapor's `editCmd`/`cmdInto`. So the bot can hand you a command and you edit/run it
  inline.
- **Command/action bubbles** (`.b.cmd`): execute / edit / dismiss; `confirm`/high-risk actions
  always confirm (gated by the privilege level — ROADMAP A1).
- **Header:** brand + **auto-TTS toggle** (`#ttsToggle`) — when on, assistant replies are sent
  to `/api/voice/tts` and played.
- **Server state** via TanStack Query (status poll interval from settings); **streaming** chat
  via SSE; **theme/skyline/tts** in a tiny UI store, persisted to `localStorage` and mirrored to
  the server settings.
- **PWA:** `vite-plugin-pwa` manifest + service worker (app-shell precache; never cache `/api`
  mutations).

---

## 6. Deployment profiles

| Profile | Launch | Notes |
|---|---|---|
| **Windows 11** | `uvicorn app.main:app` via `.bat` / Task Scheduler — **no `--reload`** | primary today; see gotcha below |
| **Ubuntu 26 LTS** *(emma — target host)* | `systemd` unit (model on `wol_server/wol_server.service`); `--reload` ok for dev | headless server |
| **macOS** | `uvicorn app.main:app` (`--reload` ok for dev) | sibling POSIX path |
| **Android / Termux** *(exp.)* | `uvicorn` in Termux + `termux-wake-lock` + foreground service, charger | phone = host; WOL only on its LAN; high port (no root) |

**Data root (`$CTRLB_HOME`, D15 #2).** All data — `config.yaml`, `ctrlb.db`, `SOUL.md`, `memories/`,
`skills/`, `agents/` — lives under one relocatable root (env `CTRLB_HOME`; mirrors Hermes' `HERMES_HOME`).
Resolution: explicit `CTRLB_CONFIG`/`CTRLB_DB` override their specific path (back-compat + temp-config
tests) → else derive from `CTRLB_HOME` → else today's project-root default. **emma/new installs set
`CTRLB_HOME=~/.ctrl-b`**; corsair keeps working with nothing set.

**OS-agnostic by design.** All target-OS branching keys off `host.os_type` (the *managed* host),
never the server's OS — so an Ubuntu server on emma running a Windows host is the same code path
as a Windows server on corsair running a Linux host. The single server-OS branch is the ping
command syntax (`fleet._ping_cmd` — Windows `-n`/`-w`, Linux `-c`/`-W`, BSD/macOS `-c`/`-t`),
decided at call time so a Termux profile stays alive. Paths use `pathlib`; the YAML writer
preserves the existing file's CRLF/LF so a Windows host can't churn an LF config to CRLF.

**Gotcha — Windows + `uvicorn --reload`.** On Windows, uvicorn's reload worker uses an event
loop that does not properly support `asyncio.create_subprocess_exec`. `fleet.ping_host` shells
out to `ping`, captures empty output under reload, and every host reports offline (no error,
just silent failure). **Run plain `uvicorn app.main:app --port 5433` on Windows** (or use
`watchfiles` externally to restart). Linux/macOS reload mode is fine — those loops have full
subprocess support.

**HTTPS for mic:** front any profile the phone reaches with **Tailscale Serve** so the PWA gets
a secure context (`https://<host>.<tailnet>.ts.net`) → `getUserMedia` works. Without it, voice
input is desktop/localhost-only.

A future **native Android client** (Capacitor/Tauri) consumes this same API — no backend change.

---

## 7. Security model (unchanged boundary, strengthened internals)

- Tailscale-only, single trusted user, **no public bind, no auth** (per AGENTS.md §6). Don't
  weaken this.
- v2 *improves* internals: typed actions are the primary path; raw shell is one quarantined,
  logged, agent-excluded-by-default action with captured output + timeout.
- Secrets stay in gitignored YAML, masked in API, never logged. SSH still `AutoAddPolicy`
  (LAN-trusted) — note it, consider known_hosts pinning as a later hardening.
- `debug=True` off by default in v2 (it's a Werkzeug/Uvicorn RCE surface if ever reachable).
