# Decisions log — dashboard_v2

Locked-in choices for the rebuild, with the reasoning. Anything not listed here is open and
should be decided in `TODO.md` / `ARCHITECTURE.md` before it's built. Log opened 2026-05-27; D1–D13
are locked. Latest project status (which decisions have shipped vs are pending) lives in
[`HANDOFF.md`](./HANDOFF.md) / [`TODO.md`](./TODO.md) — this file is the decisions log, not a
status board.

---

## D1 — Target: mobile-first PWA, desktop too ✅

One responsive React SPA, **mobile-first** (it ports the already-mobile-first Vapor design),
widening gracefully on desktop. Shipped as an **installable PWA** (`vite-plugin-pwa`: web
manifest + service-worker app-shell cache).

**Why:** every privileged operation (WOL, SSH, ping, LLM/STT/TTS) is server-side, so the
client is thin — Android support is a UI concern, not an architectural one, and the Vapor
design is already mobile-first, so "Android" costs almost nothing extra.

**The one real constraint — secure context for the mic:** browser mic capture (`getUserMedia` /
`MediaRecorder`) only works in a **secure context**, which means **HTTPS** *or* **loopback**
(`localhost`/`127.0.0.1`/`*.localhost`). A Tailscale IP (`100.x.x.x`) and LAN IPs (`192.168.x`)
are **not** loopback, so plain `http://100.x:5432` is **not** secure → mic blocked on the phone.

**Chosen fix: Tailscale Serve.** `tailscale serve` fronts the local app as
`https://<host>.<tailnet>.ts.net` with a **real, auto-renewed Let's Encrypt cert** — no cert
management. It is **tailnet-only** (you must be connected to the tailnet to reach it; nothing is
exposed to the public internet — that's *Funnel*, which we do **not** enable). Because FastAPI
serves the SPA **and** `/api` on that single origin, there's **no mixed-content** issue. FastAPI
binds `127.0.0.1:5432`; Serve exposes HTTPS on the `ts.net` name. First-class task in `TODO.md`.

**No-HTTPS alternatives (narrower, documented for completeness):**
- *Phone-as-server (Termux profile):* open `http://localhost:5432` on the phone → loopback →
  secure context → mic works with **no HTTPS, no flag**. Only when the phone hosts the server.
- *Native wrapper:* WebView runs from a secure-context origin (mic works) but then needs
  cleartext-to-API config. Only worth it if going native anyway.
- *Chrome `unsafely-treat-insecure-origin-as-secure` flag:* **not viable on stock Android**
  (needs a rooted/dev device; the flag is being removed). Don't design around it.

See `RESEARCH.md` → "Secure context for the mic" for the full breakdown + sources.

**Deferred:** a native wrapper (Capacitor/Tauri). Only worth it for app-store APK / push /
background. The API is designed client-agnostic so a native client can consume it later
without backend changes. See D5.

## D2 — Backend: Python + FastAPI + Uvicorn ✅

**Why (and why not Node):** the workload is I/O-bound (SSH round-trips, fleet pings, LLM/audio
streaming) — FastAPI's async handles it as well as Node; the framework is never the
bottleneck, the network is. The deciding factor is the **existing, working Python glue**
(`paramiko`, `wakeonlan`, `openai`, `youtube-transcript-api`, `beautifulsoup4`) — rewriting it
in Node buys nothing at one-user/~5-host scale. Pydantic models map 1:1 onto the typed-action
registry (validation + OpenAPI + agent tool schemas from one definition). Go/Rust would be
throughput overkill never approached here.

Concrete win over the old server: pings run **concurrently** (async) instead of the current
serial `is_awake()` loop that blocks status for the whole fleet.

## D3 — Execution model: hybrid (typed actions + guarded `$`) ✅

- **Primary path = a typed-action registry.** Each action is a Python function + Pydantic input
  model + risk level + optional confirmation, returning **structured, captured** output. UI
  buttons *and* agent tool-calls route through the same registry. Everything is logged to an
  Event table.
- **Escape hatch = one guarded raw-exec action.** Redesigned vs today's
  `subprocess.Popen(['cmd','/k', …])`: it **captures stdout/stderr with a timeout**, can target
  the local host or a remote host (SSH), is explicitly **dangerous-flagged**, is logged, and is
  **off-limits to the agent by default** (gated by a setting). This preserves the Vapor `$`
  power-user UX without making arbitrary shell the agent's casual default.

**Why:** today's `/execute` is Windows-only (`cmd /k` pops a GUI window — meaningless headless
on Ubuntu), captures no output (the agent can't see results), and is RCE-by-design. Typed
actions are OS-abstracted, validatable, loggable, and streamable.

**Honest limitation:** actions that wrap shell underneath (`start_service` → `systemctl` vs
`Start-Service`) still need **per-OS command maps**, and "services" are **net-new modeling** —
they don't exist in the current `config.yaml` (the Vapor design already anticipates them).

## D4 — Persistence: SQLite (chat/memory/events) + YAML (config) ✅

- **SQLite** for chat threads, messages, agent memory, and the event/audit log — easy querying,
  history pruning/management from the Conf tab, single-file, cross-OS, no server process.
- **YAML** for human-editable config (hosts, inference/STT/TTS endpoints + keys, server, voice),
  staying compatible with the current `config.yaml` shape so migration is mechanical. Editable
  in the Conf tab *and* in a text editor.

**Why not all-SQLite:** keeps config hand-editable outside the UI (matches current workflow,
good for headless/Termux). **Why not all-files:** chat history search/prune gets clumsy as it
grows.

## D5 — Deployment profiles, not forks ✅

The same pure-Python server targets three profiles; only launch + power notes differ:

1. **Windows 11** — `uvicorn`, autostart via Task Scheduler / `.bat`.
2. **Ubuntu 26 LTS** — `uvicorn` under a `systemd` unit (mirrors the existing
   `wol_server.service`).
3. **Android / Termux (experimental)** — phone *is* the dashboard host, broadcasting WOL on its
   own LAN. Needs `termux-wake-lock` + a foreground service + the phone plugged in; high port
   bind (5432) avoids root. Documented as a profile, not a separate build.

Keeping the backend dependency-light and OS-abstracted (no hard Windows/Linux-only imports at
import time) is what keeps profile 3 feasible. A future **native Android client** is a separate,
optional track that consumes the same API.

## D6 — Don't touch the old project ✅

`wol_server/` keeps running until cutover. `ws_claude*/`, `ws_codex*/`, `ctrl-b (Vapor)/` are
reference only. All v2 work lives under `dashboard_v2/`. The Vapor HTML is the **visual source
of truth**; copy assets (logo/favicon), don't import.

## D7 — Pixel-exact Vapor visual fidelity ✅ (hard requirement)

The UI must **match `ctrl-b (Vapor)/variations/vapor.html` exactly** — a faithful port, not an
interpretation. **Lift the CSS verbatim** (the `:root`/`[data-theme]` variable system), keep all
three palettes (vapor/aqua/ember), the exact fonts (JetBrains Mono + Major Mono Display), **all
animations** (hero sun/stripes/stars/grid, skyline SVGs, LED heartbeat, equalizer, live waveform,
sliding tab indicator), and every component (appbar+TTS toggle, hero panel, device rows + dropdown,
fleet summary, chat/command bubbles, `.util` cards, Conf rows/segments/switches, fixed composer).
Componentize into React, but the rendered result must be **visually indistinguishable** from the
prototype; verify side-by-side at phone width. Full checklist in `ARCHITECTURE.md` §5. **Why:** the
owner designed this deliberately and wants it preserved precisely — design is a fixed spec, not a
v1 approximation.

## D8 — Extensible tool registry (Utils) ✅

Utilities are a **pluggable registry**, not one-off endpoints. A tool = handler + Pydantic input
+ display metadata + `agent_exposed` flag; registering it auto-creates the REST endpoint
(`/api/tools/{name}`), the Utils-tab card (rendered generically), and (optionally) an agent tool —
**from one file**. v1 ports `yt_captions` + `ip_info` and adds **`dns_trace`** as the first new
tool to prove the path. **Why:** the owner wants to add tools (DNS trace, whois, port check,
speedtest, …) "relatively easily" — so make extension a first-class pattern, mirroring the action
registry. Detail in `ARCHITECTURE.md` §1 (Tools/Utils).

## D9 — Configurable agent integrations: MCP, SearXNG, embeddings ✅

The owner already runs these and wants them **all configurable in Conf**:

- **MCP client** — the agent connects to multiple **MCP servers** over **stdio** *and* **Streamable
  HTTP** transports; their tools merge (namespaced) into the agent's aggregated toolset. Per-server
  config (`name`, transport, `command+args+env` or `url+headers`, `enabled`), tool discovery, and
  failure isolation so one bad server can't break the agent. Use an MCP client lib (official Python
  MCP SDK).
- **SearXNG** — configurable endpoint of the owner's local instance powers a built-in `web_search`
  tool (`format=json`); optionally consumable via a SearXNG MCP server instead. Settles the old
  "SearXNG MCP v1 or later?" open item: **in, and configurable.**
- **Embeddings** — configurable OpenAI-compatible `/v1/embeddings` base URL (the owner's llama.cpp
  embedding model) feeds the **vector** `MemoryProvider` (D4/B1) and future semantic search.

Config shape in `ARCHITECTURE.md` §3 (`searxng{}`, `embeddings{}`, `mcp_servers[]`); UI in Conf →
Inference (embeddings) + Integrations (MCP servers, SearXNG). **Why:** these are existing,
owner-operated services — wiring them as first-class configurable integrations (not hardcoded) is
what makes the agent genuinely useful and keeps secrets in masked YAML.

## D10 — Agent runtime: compaction, task/plan tool (extensible), skills ✅

Make the agent a real system (informed by opencode + public Claude-Code patterns — D-ref RESEARCH):

- **Context compaction** — auto-summarize older turns into the working context near the token limit
  (configurable threshold) + manual `/compact`; SQLite keeps full history. Distinct from durable
  memory (D4): compaction = live window, memory = recall.
- **Built-in `task_plan` tool + extensible toolset** — the agent maintains a structured session
  plan/task list (TodoWrite-style), rendered as a `plan` message-kind panel; **adding more agent
  tools = one file** via the §1/D8 registry.
- **Skills** — reusable `skills/<name>/SKILL.md` bundles (frontmatter + instructions + optional
  resources); model-invoked or user-invoked via `/skill-name` (A4); **adding a skill = dropping a
  folder**; managed in Conf → Skills. File-based, like the file MemoryProvider.

Detail in `ARCHITECTURE.md` §Agent + ROADMAP A5. **Why:** the owner wants compaction, an
extensible tool system with a task/plan tool, and skills — the same primitives that make
Claude-Code/opencode effective. Build the seams (message kinds incl. `plan`, the tool registry,
file-discovered skills) in v1 even where full behavior lands in v1.x.

## D11 — Multiple agents, subagents, selectable models, swappable strategies ✅

The agent design is **configurable and pluggable**, not hardcoded:

- **Selectable summarizer model** — compaction's summarizer is set in settings (mode local/cloud +
  specific model name), independent of the chat model.
- **Multiple agents** — an Agent is a **definition** (`agents[]`: prompt, backend+model, tools,
  skills, privilege, memory); the owner can **add more**; one is the default. Selectable per
  chat/automation.
- **Subagents** — a `spawn_subagent` tool delegates a scoped task to another agent definition (own
  context + tool subset), returning a result (Claude-Code subagents / opencode coordinator).
- **Swappable strategies** — **skill auto-selection** and **subagent orchestration** sit behind
  small strategy interfaces with a sensible default (informed by `RESEARCH.md` prior art) and are
  **easy to replace/switch in settings**. **Specifics deliberately deferred to Phase 4** — tackle
  the concrete approach then, with prior art in hand; just don't hardcode it now.

Config in `ARCHITECTURE.md` §3 (`agent{compaction.summarizer}`, `agents[]`); UI in Conf → Agent +
Agents. **Why:** the owner wants control over agent design and the option to add agents — keep these
as data + pluggable strategies so they evolve without a rewrite.

---

## D12 — Services: nested under hosts, derived liveness, control = more actions ✅ (Phase 3)

Services are declared **nested under their host** in `config.yaml` (`computers.<host>.services.<name>`),
not as a flat top-level list — everything about a machine lives together, and the stable id is
`"{host_slug}.{service_slug}"` so renaming the host re-slugs host + services in lockstep. Liveness
is **derived, never stored** (DESIGN §2): a cached concurrent **TCP port probe** keyed off the fleet
host status (offline host → service offline without wasting a probe; port-less service → tracks the
host). Control is just **more typed actions** on the Phase 2 registry —
`start_service`/`stop_service`/`restart_service` (per-OS `cmd` maps, SSH adapter) + `open_service_url`
(URL only, no SSH, `ui_exposed=False`). **Risk:** start/open `LOW`, **stop/restart `MED`** so they
gate at `Privilege.CONFIRM` (the seam: privilege rides on `risk`). The Vapor `.svc-row` is link-only
(no buttons) — Phase 3 renders status + the open-URL link; control buttons in the UI come later.
**Why:** reuses the whole action/confirm/event/toast machinery, keeps "add a service" a config edit,
and keeps the data model faithful to DESIGN §2.

---

## D13 — Agent chat: sliced build, text-first, streamed over SSE ✅ (Phase 4a)

Phase 4 is **sliced into runnable steps** (4a text round-trip → 4b tools → 4c routing → 4d plan →
4e compaction → 4f MCP); 4a ships chat with **no tools**. Adopted opencode's **message-has-parts**
model (`domain/conversation.py`: a discriminated `Part` union) so a turn grows from text → reasoning
→ tool calls/plans without a schema change (`messages.parts` stays one JSON column). Inference is
**one OpenAI-compatible `AsyncOpenAI` client** with per-mode `base_url`/`key`/`model` (DESIGN §7) —
no provider abstraction beyond that. Streaming is **SSE over a `POST`** (`POST /api/agent/chat` →
`EventSourceResponse`; the client reads it with `fetch` + `ReadableStream`, since `EventSource`
can't POST a body) using the DESIGN §12 event names. The turn **persists regardless of client
disconnect** (state lives in the DB; reconnect re-reads). **Reasoning** (thinking models —
`minig+`) is a first-class `ReasoningPart`: streamed + stored + shown **dimmed**, but **not replayed**
into the model's next context (scratchpad, not durable content) — a small, justified addition to the
DESIGN §4 part list. Backend default = **local llama.cpp `minig+` @ 192.168.1.137:5001** (thinking
model, slow cold load → 600s client timeout). **Why:** smallest verifiable step first; the parts
model + SSE contract + `ActionService` are the seams 4b–4f slot into without rework.

---

## D14 — Agent workspaces: per-agent folders, file-based persona + memory (Hermes/OpenClaw layout) ✅ (Phase 7e)

The agent is becoming a **general-purpose assistant** (a generalist default + specialist agents it
can invoke or delegate to), with **portable, file-based** persona and memory modelled on
**Hermes Agent** and **OpenClaw** — but on **our** runtime, not theirs.

**Runtime model — in-process multi-agent, NOT separate instances (the key distinction).** Hermes
"profiles" and OpenClaw "workspaces" are both *single-agent-per-process*: each agent is a separate
OS instance (Hermes: its own `HERMES_HOME`, gateway **process**, and bot token; OpenClaw: one agent
per Gateway). ctrl-b stays **one FastAPI process running multiple `AgentDef`s**, selected per-turn
(`resolve_agent`) with `spawn_subagents` running specialists **in-process, concurrently**. We keep
that — it's *more* capable for the goal ("a generalist that *uses* specialists"); Hermes profiles
literally can't spawn each other. We adopt their **folder *convention*, not their process model.**

**Per-agent workspace folder (the layout we adopt).** Modelled on the Hermes home (`~/.hermes/`),
which is *one agent's* home — so **our root is the default-agent / global home**, and specialists are
lighter override-folders under `agents/`. A single **relocatable root `$CTRLB_HOME`** (env var,
default `~/.ctrl-b/`, composes with `CTRLB_CONFIG`/`CTRLB_DB`) holds everything; agents are
**discovered by scanning** (drop a folder = add an agent — same ethos as the skill loader, D8/D10):

```
$CTRLB_HOME/             # relocatable root (env CTRLB_HOME, default ~/.ctrl-b/) — mirrors HERMES_HOME
├── config.yaml          # globals + `agent.defaults` (inheritance base) + default_agent  (agents:[] REMOVED at completion)
├── ctrlb.db             # threads/messages/events/(vector memory) — agent-AGNOSTIC, central
├── SOUL.md              # the DEFAULT/generalist agent's persona (scaffold-if-missing)
├── memories/            # MEMORY.md (default agent) + USER.md (GLOBAL, shared)   [gitignored]
├── skills/              # the DEFAULT agent's skills
└── agents/              # SPECIALISTS only (distinct identity/model/memory)
    └── coder/
        ├── agent.yaml   # ONLY the overrides — absent fields inherit config.yaml `agent.defaults`
        ├── SOUL.md      # persona override (optional)
        ├── memories/    # MEMORY.md (its own)
        └── skills/      # its own skills
```

- **Skill vs. agent (the distinction).** A **skill** is a *capability* (instructions + tool-narrowing)
  the running agent activates for a task — e.g. **`fleet` stays a skill**, not an agent; the generalist
  activates it on a fleet request. An **agent** is an *identity* — its own persona, model, privilege,
  **memory**, and allowlists. Spin up a separate agent only for a different identity/model/memory, not
  merely a different toolset (that's what a skill is for). `agents/` holds specialists like a `coder`,
  not capability bundles.
- **The default/generalist agent needs NO `agent.yaml`** — it *is* the config.yaml globals.
  `resolve_agent(None)` → `default_agent_def()` already falls its fields back to `inference.*`/`agent.*`
  (`_system_prompt()`: agent.prompt → `inference.system_prompt` → baked; `ModelRef(mode=None)` →
  `inference.default_mode`). Its persona/memory/skills are the **root-level** `SOUL.md` / `MEMORY.md` /
  `skills/` (consistent with "global `skills/` = the default agent's set").
- **`agent.yaml`** = today's `AgentDef` **minus `name`** (= folder name) and **minus `prompt`**
  (= `SOUL.md`): model, tool/skill allowlists, privilege, loop/subagent limits, compaction, append.
  Loaded fresh per turn → live edit, no restart.
- **Inheritance (config.yaml is the base).** A specialist's `agent.yaml` carries **only overrides**;
  absent fields inherit a config.yaml **`agent.defaults`** block (an `AgentDef`-shaped template),
  resolved at load by `AgentDef.model_validate(deep_merge(agent.defaults, agent_yaml))` — the **same
  `deep_merge` used by `PUT /api/settings`**. Absent → `agent.defaults` → the `AgentDef` code default.
  No architectural change; one merge at load.
- **`config.yaml` keeps only globals** + `agent.defaults` + `agent.default_agent`. The current
  `agents:[]` list (built in 7d) is migrated into specialist folders **non-destructively** (scaffold
  from each entry, read it as a transitional fallback), and **`agents:[]` is fully removed once the
  folders are the source of truth** — not left dangling.

**Persona — `SOUL.md` (portable).** Feeds `_system_prompt()`. **Scaffold-if-missing** from the baked
`DEFAULT_SYSTEM_PROMPT` template; a setting disables the baked default entirely (empty = empty, no
fallback). Plain markdown so it copy-pastes to/from a Hermes `SOUL.md` or an OpenClaw workspace. The
baked string becomes a *scaffold template*, not a permanent runtime fallback.

**Memory — the file impl of the ROADMAP B1 `MemoryProvider`.**
- **`memories/MEMORY.md` per-agent** (isolated — a specialist accumulates its own notes whether
  invoked directly or spawned as a subagent); **`memories/USER.md` global** (one shared user profile,
  at the root only). The `memories/` subdir mirrors Hermes and leaves room for daily logs/archives.
- A **`memory` builtin tool** (Hermes-shaped): `add` / `replace` / `remove`, `target: memory|user`,
  substring `old_text` for replace/remove, **no `read`** (memory is auto-injected). Injected via
  7e-a's separate-`system`-message machinery, **frozen at session start** (preserves prefix cache;
  compaction provably ignores fresh system blocks).
- **Autonomous auto-write** (the agent is the primary user — no confirm), with a **`memory.auto_write`
  kill switch** (off → the agent *suggests* the write instead of persisting). Every write is still an
  audited `Event`.
- **Configurable hard caps** (defaults from Hermes: agent 2,200 / user 1,375 chars); over-cap →
  the tool **errors with current entries** and the agent **consolidates** (no silent drop, no
  auto-compact).
- **Vector recall = the later "both" mode**: the (currently unused) SQLite `memory` table + the
  already-built embeddings client (4f) become a semantic provider alongside the files — Hermes'
  external-provider tier. Deferred, not dropped.

**`session_search` (Hermes Tier 2).** An **FTS5** index over the existing `messages` table + a
builtin tool the agent invokes autonomously ("did we discuss X"). Keeps the durable files small.
**Sessions stay in central `ctrlb.db` (agent-agnostic threads) — NOT per-agent folders**: a thread
can `/agent`-switch mid-conversation, and `session_search` spans everything. This is a **deliberate
divergence** from Hermes/OpenClaw (who store sessions per profile/workspace); copying them here
would break thread-switching and cross-agent search.

**Skills — per-agent, with inheritance + agent self-authoring.** The global `skills/` dir is the
**default agent's** set; every other agent has its **own folder `skills/`**. An agent's `agent.yaml`
carries a **`skills_inherit`** setting: inherit **all** global skills · a **specific subset** · or
**none** (own folder only). And — Hermes' self-improvement angle — a **`skill_manage` agent tool**
(sibling of the `memory` tool: create/edit/remove a `SKILL.md` under the agent's own `skills/`,
**autonomous auto-write** + a `skills.auto_write` kill switch, audited as Events) lets the agent
author its own skills. Built in 7e (not deferred).

**Adopted / skipped vs the Hermes home.** We mirror Hermes' `config.yaml`, `SOUL.md`, `memories/`,
and `skills/`. We **skip** `auth.json` (no OAuth — OpenAI-compatible API keys live in masked
`config.yaml`), keep secrets in **masked `config.yaml`** rather than a `.env` (the 7a mask/unmask
round-trip + `CTRLB_*__*` env overrides already cover it; a `.env` split is optional future
hardening, ROADMAP G), and **drop `sessions/` and `logs/`**: sessions live in the central
agent-agnostic `ctrlb.db`, and the **`events` table** (queryable, UI-visible, redacted) plus the
process journal (systemd/Task Scheduler) replace file logs. Hermes' `cron/` maps to ROADMAP **A3**
(scheduled automations) — reserve the seam, build later. **Gitignore policy:** `memories/` and any
`USER.md` hold personal data → **gitignored** (extends the no-secrets rule); `SOUL.md`/`skills/` are
persona/capability → trackable if the owner wants them in the repo.

**Invocation — explicit first, optional auto-rotate.** `/agent <name>` (sticky per session) and the
generalist's `spawn_subagents` are the primary paths. An optional **`AgentSelector`** (mirrors the
existing `SkillSelector` strategy) can auto-route a turn to a specialist **only when enabled** in
settings — default off, predictable.

**UI.** The 7d `AgentsEditor` is repointed to a **file-per-agent API** (like the skills
`GET/PUT/DELETE`), with a first-class **add-agent flow** (scaffolds the folder: `agent.yaml` +
`SOUL.md` + `MEMORY.md`), plus edit/delete — well-designed at 390px (D7).

**Why:** the owner wants a portable, transparent, editable agent (copy a `SOUL.md`/`MEMORY.md`
between ctrl-b, Hermes, and OpenClaw), each agent self-contained in a folder, while keeping our
superior in-process multi-agent + subagent runtime and our agent-agnostic central conversation
store. This refines D10/D11 (file MemoryProvider, multiple agents) and resolves the open memory item
below. Detail + slices in `TODO.md` Phase 7e; `ARCHITECTURE.md` §Agent gains the workspace layout.

---

## Still open (decide before building the relevant phase)

- Agent tool-calling format: OpenAI `tools`/function-calling vs a lightweight JSON protocol for
  models that don't support tools well (some local GGUFs). Likely: detect capability, fall back.
- ~~Memory backend(s): none / file / vector / both~~ → **resolved in D14**: file impl first
  (`MEMORY.md` per-agent + global `USER.md` + a `memory` tool, Hermes-shaped), vector as the later
  "both" mode over the embeddings client (D9). Pluggable `MemoryProvider` (ROADMAP B1) is the seam.
- Auth: stay none (Tailscale-only) for v1; revisit only if exposure model ever changes.
- Frontend routing: simple tab state vs `react-router` (lean tab state unless deep-linking is wanted).
- MCP: how much of the client to ship in v1 vs v1.x (transports both wanted; start with one server
  working end-to-end, then generalize). Tool-namespacing + per-server failure isolation.

## Future additions (design-shaping, captured in ROADMAP.md)

These are **not v1 scope**, but v1 must leave the seams for them (see `ROADMAP.md` for detail).
The owner explicitly wants them eventually:

- **Agent privilege levels** (read-only → full, Claude-Code/Codex-style) — policy layer over the
  action `risk` field (A1).
- **Agent asks clarifying questions** — typed `question` message kind + turn-based loop (A2). When
  unattended/low-privilege, **notify and wait** for the answer (bridges A1+A3+F1).
- **Scheduled agent automations** (cron + saved prompt + privilege) — new scheduler subsystem (A3).
- **Composer-as-console** (A4): `!` (configurable sigil, the only command prefix) → guarded shell;
  `/` → slash commands incl. **`/local`,`/cloud`** for backend (replacing the disliked `k:`/`o:`);
  markdown bot replies + copy/send-to-composer on code blocks. *(Prefix routing + formatting +
  `/local`,`/cloud` ≈ v1; custom slash commands post-v1.)*
- **Streaming + non-streaming fallback** — endpoint supports both from day one (C1).
- **Wake word** — client-side, audio stays local until trigger (C2).
- **Idle shutdown/sleep per host** (Win + Linux) — **optional/opt-in**; needs a real-idle detection
  mechanism, the hard part (D1). **Wake-on-connection** (D2).
- **Discord/Telegram bots** as thin clients to the same API (E1).
- **Notifications** (F1): whole feature **optional (master toggle)**; when on, **PWA-native is the
  default, auto** — foreground (Notifications API via SSE) when open + **Web Push** (VAPID) when
  closed. **ntfy** + **Telegram/Discord** are optional extra channels. Per-event toggles. Includes
  the agent-needs-input channel. No native app required.
- **Security hardening** (G) — known_hosts pinning, per-action tokens, secret encryption-at-rest.

→ v1 seams to build now so these slot in: pluggable `MemoryProvider`, action `risk` levels,
typed chat-message kinds, streaming-or-buffered chat endpoint, a settings/policy layer, and a
functionally-grouped Conf tab.
