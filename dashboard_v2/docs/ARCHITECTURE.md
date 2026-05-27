# Architecture — dashboard_v2

How the pieces fit. Reflects the locked decisions in `DECISIONS.md`. The Vapor prototype
(`ctrl-b (Vapor)/variations/vapor.html`) is the visual source of truth; this maps its UI onto a
real, typed backend.

```
┌────────────────────────────── Android / Desktop browser ──────────────────────────────┐
│  React + TS PWA  (mobile-first; Fleet · Agent · Utils · Conf)                            │
│   TanStack Query ──poll/mutate──┐     MediaRecorder ──audio──┐     <audio> ◀──tts audio  │
└─────────────────────────────────┼────────────────────────────┼──────────────────────────┘
                                   │  HTTPS (Tailscale Serve)    │
┌──────────────────────────────── FastAPI + Uvicorn ────────────┼──────────────────────────┐
│  /api/hosts /services /events(SSE) /agent/chat(SSE) /voice/* /settings /prompts /utils    │
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
  utils).

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

- Uses the `openai` SDK against the configured backend (`local` = llama.cpp `llama-server`
  `/v1`, or `cloud` = OpenRouter et al.). **Supports both streaming (SSE) and buffered (single
  JSON) responses** from day one — a `streaming: auto|on|off` setting + graceful fallback when a
  backend can't stream (ROADMAP C1). Non-streaming is a first-class path, not an afterthought.
- Tools = the action registry. Whether the model's proposed action **auto-runs or waits for
  confirmation is governed by the agent privilege level** (a policy layer over the registry's
  `risk` field — ROADMAP A1): Read-only / Confirm-each / Auto-low-risk / Full. `confirm` actions
  always surface as a **command/action bubble** (Vapor `.b.cmd`) with execute / edit / dismiss.
- **Turn-based chat loop with typed message kinds** — `text`, `command|action`, and **`question`**
  (the agent can ask the user for clarification mid-task, with optional choice chips, then resume —
  ROADMAP A2). Build the loop turn-based and the message kinds extensible from the start, even if
  `question` ships later.
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

### Utils (`app/utils.py`)

- Port `yt_caption` (transcript → JSON download) and `ip_info` from the old server, as
  `/api/utils/yt-captions` and `/api/utils/ip-info`.

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
POST   /api/agent/chat                  SSE token stream; may emit action/command bubbles
GET    /api/memory                      list memory items     (Conf)
POST   /api/memory / DELETE /api/memory/{id}
# Voice
POST   /api/voice/stt                   multipart audio  -> { text }
POST   /api/voice/tts                   { text, voice } -> audio stream
# Settings / prompts
GET    /api/settings  /  PUT /api/settings        (config.yaml-backed; secrets masked)
GET    /api/prompts   /  PUT /api/prompts/{name}  (command_prompt, system_prompt, ...)
```

---

## 3. Data model

YAML config (hosts/services/endpoints/keys/server/voice) + SQLite (chat/memory/events).

```
Host      id, name, ip, mac, ssh_username, ssh_password*, ssh_port=22, os_type, role, tags[],
          idle_action(none|sleep|shutdown), idle_minutes   # idle fields = ROADMAP D1
Service   id, host_id, name, kind, port, path, autostart, cmd_start/stop/restart (per-OS)
Action    name, inputs(schema), risk, confirm   (code-defined, not stored)
Event     id, ts, actor(user|agent), action, target, status, summary, output     [SQLite]
Thread    id, title, created_at, updated_at                                       [SQLite]
Message   id, thread_id, kind(text|action|question), role, content, ts, meta      [SQLite]
Memory    id, kind(fact|summary), text, created_at, pinned                        [SQLite]
Automation id, name, cron, prompt, privilege, thread_id, enabled, last_run, status [SQLite]  # ROADMAP A3
Settings  inference{mode, local_url, cloud_url, cloud_key*, model},
          stt{url, key*, model}, tts{url, key*, model, voice},
          server{host, port, poll_seconds, debug}, appearance{theme, skyline, ...}  [YAML]
```
`*` = secret: gitignored in YAML, masked in API responses, never logged.

Migration from the current `config.yaml`: `computers{}` → `Host` rows is mechanical; `services`
and per-OS service commands are net-new (additive, optional).

---

## 4. Agent memory (pluggable — configurable in Conf)

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

- **Tabs** = Vapor's four: **Fleet** (hero + device rows w/ expandable services + fleet
  summary), **Agent** (chat log, shares composer), **Utils** (YT captions, IP lookup), **Conf** —
  organized into **functional groups** (Inference · Agent · Memory · Voice · Automations ·
  Fleet/Hosts · Server · Notifications · Appearance · Integrations) so future toggles land in
  obvious homes; full layout in `ROADMAP.md` → "Settings tab".
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
| **Windows 11** | `uvicorn app.main:app` via `.bat` / Task Scheduler | primary today |
| **Ubuntu 26 LTS** | `systemd` unit (model on `wol_server/wol_server.service`) | headless server |
| **Android / Termux** *(exp.)* | `uvicorn` in Termux + `termux-wake-lock` + foreground service, charger | phone = host; WOL only on its LAN; high port (no root) |

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
