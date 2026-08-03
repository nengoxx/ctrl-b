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

**✅ Clarified 2026-06-14 (Phase 5 spec).** The `!` composer prefix is the **user-driven local
shell** — `!<cmd>` runs a real shell command **on the backend host** (the box running ctrl-b,
corsair/emma), the Claude-Code/Codex model. It is **not** open-terminal (a *separate remote box*
over REST, used as an *agent* tool). Locked: **target = local backend host only** (other fleet hosts
stay SSH actions + open-terminal); **cwd = configurable `shell.workdir`, default `$CTRLB_HOME`**;
**output feeds the agent's context** (bubble + next-turn visibility, redacted/truncated); **user `!`
enabled by default** (`shell.user_exec_enabled` toggle), while the **agent's** `run_shell` tool stays
**separate + excluded-by-default** (`decide()` already gates it). Phase 5 is **kept + built**, not
dropped. Full slice in `TODO.md` Phase 5.

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

The UI must **match `design/prototypes/variations/vapor.html` exactly** — a faithful port, not an
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
- **`config.yaml` keeps only globals** + `agent.defaults` + `agent.default_agent`. **Agents are
  folder-only** — the final schema has **no `agents:[]` list** and there is **no migration feature**
  (D15 #3): agents are read exclusively from `agents/<name>/`. Any entries in today's live config are
  relocated into folders by hand during 7e-c (a one-time dev step, likely a no-op).

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

**Session attribution — per-message agent (the consequence of agent-agnostic threads).** Today
`threads.agent` records *one* agent per thread, and the `/agent <name>` switch is a non-persistent
per-turn override (`messages.actor` is only the role-class `user`/`agent`/`system`, not the
AgentDef). With per-agent memory that loses provenance: restore a thread that switched
`default → coder` mid-conversation and the DB can't say which turn was `coder`. So 7e-c adds a
**nullable `messages.agent` column** set to the resolved AgentDef name on each assistant message
(null = legacy/default; one additive, backwards-compatible migration). Effect: **restore shows the
agent per-turn** across switches; **resume prefers the last assistant turn's agent** (natural
continuity, no need to mutate `thread.agent`); **`session_search` can filter/attribute by agent**.
`threads.agent` stays the thread's *primary/default* (what a fresh turn or bare resume starts from);
the column is the source of truth for "who said this."

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

## D15 — Loose-end specs for the 7e agent-workspace build ✅ (Phase 7e)

The concrete specs the D14 slices need before coding (surfaced by the 2026-06-14 design audit).
Each cites the existing seam it extends. **All eight were ratified one-by-one with the owner on
2026-06-14** — the decisions are marked ✅ inline.

1. **`agent.defaults` block + merge precedence.** New `config.yaml` `agent.defaults:` — an
   `AgentDef`-shaped mapping (no `name`). A specialist loads as
   `AgentDef.model_validate(deep_merge(agent.defaults, agent_yaml))` (`deep_merge` = `config.py:436`,
   the one `PUT /api/settings` uses), `name` = folder. **Static-field precedence:** `agent.yaml` →
   `agent.defaults` → `AgentDef` code default. The existing **runtime** chain still resolves the
   *dynamic* fields (`_system_prompt`: SOUL.md → `inference.system_prompt` → baked;
   `ModelRef(mode=None)` → `inference.default_mode`). The **default agent** has no `agent.yaml` → built
   from `agent.defaults` (or pure code defaults) + globals. **✅ Decided 2026-06-14:** `agent.defaults`
   **may also set `model`** (a per-agent `ModelRef` still wins; `inference.default_mode` stays the floor
   when neither sets it); persona stays on the SOUL.md → `inference.system_prompt` → baked chain.

2. **`CTRLB_HOME`.** New env root; default `Path.home() / ".ctrl-b"` (cross-OS via `pathlib`). Holds
   `config.yaml`, `ctrlb.db`, `SOUL.md`, `memories/`, `skills/`, `agents/`. **Precedence (✅ decided
   2026-06-14 — layered, default = project-root):** an explicit `CTRLB_CONFIG`/`CTRLB_DB` still
   overrides *its* path (back-compat + the temp-config test workflow keeps working); otherwise paths
   derive from `CTRLB_HOME`; if neither is set, fall back to today's `_PROJECT_ROOT` default (nothing
   breaks on corsair). emma/new installs set `CTRLB_HOME=~/.ctrl-b` (installer/docs default).
   Extend `config_path()`/`db_path()`; add `home_path()` +
   `agents_dir_path()` + `memories_dir_path()` mirroring `skills_dir_path()` (`config.py:357`).

3. **Agents are folder-only — NO migration feature (✅ decided 2026-06-14).** The final
   implementation reads agents **exclusively** from `agents/<name>/`; `config.yaml` never carries an
   `agents:[]` list — **the field is removed from the `Settings` schema**. `resolve_agent` /
   `default_agent_def` read folders; the default agent is the root + `config.yaml` globals (no
   `agents:[]`, no `agent.yaml`). The 7d `AgentsEditor` + `test_agents_7d` move to the file-per-agent
   API. **No runtime migration, no fallback read, no button.** Any `agents:[]` entries in today's
   live `config.yaml` are relocated into folders **by hand as a one-time dev step during 7e-c**
   (likely a no-op). The remaining `config.yaml` agent keys are globals only: `agent.default_agent`,
   `agent.defaults`, subagent limits.

4. **`MemoryProvider` interface + injection point.** A `core/` protocol + a `FileMemoryProvider`
   (`services/agent/memory.py`), on `Deps.memory`. Methods: `load_context() -> str` (the injected
   agent+user block), `write(target, action, content, old_text=None)` (the `memory` tool's backend;
   enforces caps → raises over-cap so the agent consolidates), `read_raw(target)`, `clear(target)`.
   **Injected in `_assemble` right after `_appends()`** → order becomes base → appends → **memory** →
   roster → skills → history; frozen per turn (compaction ignores fresh system blocks).
   **AMENDED (owner, 2026-07-20 — the A9 ruling):** memory moves AFTER the roster → the order is now
   base → appends → **roster** → **memory** → skills → history. Rationale: prefix caches (llama.cpp
   KV, cloud prefix) invalidate from the first changed byte onward; memory is the only ~static-head
   block that ever changes across a session (a `memory`-tool write), while the roster is
   config-projected — memory-last keeps a write from evicting the roster (the Hermes
   volatile-block-after-breakpoint precedent). Same ruling: per-turn memory reads STAY (the
   per-session freeze is rejected as premature — no memory `read` tool = no hatch); measure via
   `cache_n`/`prompt_n`; escalation path if ever needed = read-through with write-invalidation.
   Pinned by `test_roster_precedes_memory_in_the_static_head`. Config:
   `memory.memory_char_limit` (2200) · `memory.user_char_limit` (1375) · `memory.enabled` ·
   `memory.user_profile_enabled` · `memory.auto_write` (Hermes-named keys, for portability).
   **✅ Decided 2026-06-14:** the injected block **mirrors Hermes' format** — a per-section usage
   header (`## Agent memory (67% — 1,474/2,200)`) + `§` delimiters between entries — for parity +
   cap-pressure signalling to the model.

5. **`messages.agent` + resume resolution (✅ decided 2026-06-14 — continuity).** Nullable column,
   set to the resolved AgentDef name on each **assistant** message (null = legacy/default). `/agent`
   stays a non-persistent per-turn override (`thread.agent` unchanged), but each assistant turn records
   its agent. **Resume order:** explicit request agent → **last assistant message's `agent`** →
   `thread.agent` → default — so a continued thread keeps talking to the specialist you last used until
   you switch. Restore + `session_search` read the column for per-turn attribution. Subagent turns run
   on ephemeral threads, so they never pollute parent-thread attribution.

6. **`skill_manage` tool (✅ decided 2026-06-14 — default OFF, non-blocking).** Agent builtin
   (sibling of `memory`), `category="builtin"`, `ui_exposed=False`, **risk LOW**. **`skills.auto_write`
   setting — default OFF, toggleable in Conf.** When **ON**: writes directly. When **OFF**:
   **non-blocking** — the tool does *not* write and does *not* suspend the turn; it returns a
   "proposed skill" result (name + body) that surfaces as a UI affordance with an **Approve → create**
   action (writes via the skills file API out-of-band). The conversation continues either way —
   **never a hard confirm gate**. Actions `write`/`remove` (+ `list`), writing **only** under the
   agent's own `skills/<slug>/SKILL.md` (default agent → root `skills/`; reuse 7d-c's slug-guard,
   traversal → error). `FileSkillProvider` re-scans per call → live, no restart. Audited as Events.
   **Consistency:** the `memory` tool uses the same non-blocking-propose pattern when
   `memory.auto_write` is OFF (proposes instead of writing; never blocks) — memory stays default ON,
   skills default OFF.

7. **`session_search` scope + redaction (✅ decided 2026-06-14 — global).** **Global across all threads by default** (Hermes-like;
   optional thread-id filter arg), FTS5 over `messages` text **with tool outputs already redacted**
   (reuse `core/redact.py` — never index raw secrets). Indexes live **and** compacted messages
   (recall is the point). Returns ranked snippets with `thread_id` + `ts` + the recorded `agent`. A
   migration adds the FTS5 virtual table + sync triggers.

8. **`AgentSelector` seam (✅ decided 2026-06-14 — seam locked; default algorithm decided 2026-06-16).** A
   `SelectorProtocol` mirroring `SkillSelector`, **off unless `agent.auto_rotate`** is enabled
   (explicit `/agent` + `spawn_subagents` stay primary). **Default = `KeywordAgentSelector`** — token
   overlap on agent name + SOUL.md description, an exact mirror of `KeywordSkillSelector`
   (deterministic, model-agnostic, consistency by construction). The protocol stays **swappable** so an
   LLM router or an embeddings selector (over the 4f client) is a drop-in. Only the final keyword
   tuning happens at 7e-g build, with real agent descriptions in hand.
   **Sub-decisions locked at 7e-g pre-flight (2026-06-21, owner-confirmed):** (a) **per-turn** routing —
   each unpinned message is routed independently (stateless; no `thread.agent` write; the 7e-c per-turn
   attribution labels it), not sticky-per-thread. (b) Match on a **new `AgentDef.description`** field (the
   selector matches `name + description`) — SOUL.md stays pure persona; this refines the "SOUL.md
   description" wording above (a freeform persona is too noisy to token-match). (c) **Conservative
   threshold: ≥2** matching tokens to route, configurable via **`agent.auto_rotate_min_overlap`** (default
   2) — fewer surprise whole-agent switches than the skill selector's ≥1. (d) A **tie at the top score →
   the default agent** (don't guess between equals). (e) Precedence `/agent` → `thread.agent` → auto-rotate
   → `resolve_agent(None)`; candidates are **specialists only** (default = no-match fallback). (f) The
   keyword matcher is **extracted to `core/textmatch.py`** and shared by both `KeywordSkillSelector` +
   `KeywordAgentSelector` (one implementation). Full file-by-file plan in HANDOFF "▶ START HERE".

**Project-wide cleanups from the same audit** (tracked in `TODO.md` "Design audit"): reconcile
`ARCHITECTURE.md`/`DESIGN.md` to shipped reality + D14/D15; fix the C1 (streaming both-ways) and A2
(`question` kind) "day-one" overclaims; confirm the Utils tool registry (D8) **reuses `core/tool.py`**;
downgrade ROADMAP **A1** to "privilege-selection UX only" (the `decide()` ladder already exists);
decide Phase 5 (`run_shell`) **drop vs keep**.

---

## D16 — A1 privilege selection: reuse `agent.defaults` + a session override (no new global field) ✅

A1 (the privilege ladder) is **not a new engine** — `core/permissions.decide()` (`permissions.py:25`)
already implements the full `READONLY/CONFIRM/AUTO_LOW/FULL` ladder + the `run_shell` gate, and it's
the single seam gating both UI actions and the agent loop. This locks the remaining
**selection/persistence/UX** layer, grounded in the resolution chain that already exists, so the
build reuses seams instead of duplicating them.

**Resolution chain (most-specific wins): per-session → per-agent → global default.**

1. **Global default = `agent.defaults.privilege`** — *already wired, no new field.* `agent.defaults`
   (D15 #1) is the `AgentDef`-shaped inheritance base; the root agent (`default_agent_def()`,
   `config.py:416`) **and** every specialist inherit its `privilege` via `deep_merge` unless their
   `agent.yaml` overrides. **Explicitly rejected: a separate `agent.default_privilege` setting** — it
   would duplicate `agent.defaults` and create two sources of truth. Surface this in the
   `AgentsEditor` default-row (which already edits `agent.defaults`-backed fields).
2. **Per-agent = `AgentDef.privilege`** (`agent.py:72`) — already shipped + editable in the 7d-b
   Agents editor. Nothing to build.
3. **Per-session override = the one new field.** Add `ChatRequest.privilege: Privilege | None`
   (`api/agent.py:39`); in the `_session` builder do `agent = agent.model_copy(update={"privilege":
   override})` when set — exactly the per-turn override pattern `ChatRequest.agent` already uses
   (`session.py:154`). **No clamp** (an interactive, present owner may raise *or* lower it — the
   Claude-Code `/mode` model); a `subagent_clamp_privilege`-style ceiling is out of scope.
   **Carried across the confirm resume too** (revised at build, 2026-06-21): `ResumeRequest.privilege`
   + `resumeCall` re-send it, so a *lowered* session can't silently revert to the agent's higher
   default after one executed confirm. This is the one place A1 diverges from `mode` (which isn't
   carried) — justified because privilege is a security stance, not a routing knob.

**Surfacing.** A header/composer **chip** shows the active level; a sticky **`/privilege <level>`**
composer verb sets the session override — both reuse the sticky-session-mode plumbing `/local`/`/cloud`
already use (`lib/composer.ts` + `store/chat.ts`), not new architecture.

**Deferred (the ROADMAP §A1 "Open:" sub-questions) — not in the first A1 slice:** per-host privilege
overrides; time-boxed "full for the next N min" escalation. Both add resolution complexity for a
need that doesn't exist yet; revisit if a concrete case arises.

**Headless mapping stays elsewhere.** `decide()`'s `interactive=False` → notify-and-park policy is
owned by A2/A3 (`permissions.py:4`), not A1; A1's persistence model just leaves room for a
per-automation privilege (A3) alongside the per-session one.

**Home phase.** A standalone slice, **not** part of the 7e workspace arc. Becomes relevant when the
session quick-switch UX is wanted or when A3 (scheduled automations) forces the per-automation
override. Until then this entry is the locked spec; nothing is built ahead of its phase.

---

## D17 — Dual-mode chat (streaming + buffered) + `streaming` setting (C1) ✅ SHIPPED 2026-06-21

**Decided 2026-06-16: build it** (resolves the C1 "build vs drop" audit item); **shipped 2026-06-21**
with the per-request signal revised from the Accept header to a `stream` body field (see point 2). The
chat endpoint is now streaming-or-buffered, governed by one setting — closing the old ARCHITECTURE §1
"both from day one" overclaim by making it true.

**Boundary decision (2026-06-21, with the owner).** ctrl-b keeps its **custom stateful protocol as the
core** (threads + `AgentEvent`); the OpenAI schema stays a *boundary/adapter* format only — inbound it
already is (`adapters/inference.py`), outbound it will be a thin `POST /v1/chat/completions` facade
(deferred to ROADMAP, ~200–300 LOC reusing `run_turn` + `collect_turn` + the existing
`interactive=False` headless-confirm path). Rationale: OpenAI Chat Completions is a *stateless,
single-completion* interchange format — the wrong altitude for a stateful, server-executes-tools,
human-in-the-loop agent (OpenAI themselves moved agents to the stateful Responses API). Anti-corruption
layer / ports-and-adapters: adapt at the edge, don't pull the vendor schema into the domain.

**Core principle — reuse the turn generator, do not fork it.** `AgentSession.run_turn()` / `resume()`
are already a single async generator of `AgentEvent`s, and the SSE endpoint (`api/agent.py:126`) only
*relays* them. Buffered mode is a second **consumer** of that same generator, not a second turn
implementation: a new `collect_turn(events) -> dict` drains any `AgentEvent` stream (serves both
`run_turn` and `resume`) and folds it into `{threadId, state, messageId, permission?, error?}`. The
loop/tools/compaction/confirm-suspend/finalize code is touched **zero times**. `InferenceClient.complete`
is *not* used here — buffering is at the event layer, not the token layer (the loop still needs
`stream_chat` internally for tool-call reassembly).

**Locked choices (with the owner, 2026-06-16):**
1. **Setting** = `AgentCfg.streaming: Literal["auto","on","off"] = "auto"` (reuse `AgentCfg`,
   `config.py:118` — ROADMAP §Conf files "streaming mode" under Agent; no new config class).
2. **`auto` signal = a `stream` boolean in the request body** (revised 2026-06-21 — was the Accept
   header). `ChatRequest.stream: bool = False` + `ResumeRequest.stream`, the **OpenAI/Anthropic
   convention** (omit → non-streaming). The PWA always sends `stream: true`; the server setting is
   authoritative and only consults the field in `auto`. **Why the revision:** the project lives in the
   OpenAI-compatible ecosystem (it consumes OpenAI-compatible inference + STT/TTS), so the streaming
   toggle should look the way any future client/facade expects — the Accept header is the REST/MCP
   convention, not the LLM-API one. The signal choice is *decoupled* from the future OpenAI facade
   (that endpoint brings its own native `stream` field); the field here is for cross-endpoint
   consistency. Body field also beats a header for robustness (proxies can't strip it; always present
   after validation). **YAML gotcha handled:** `on`/`off` are YAML-1.1 booleans, so `AgentCfg.streaming`
   has a before-validator coercing `True→"on"`/`False→"off"` for hand-edited config.
3. **The setting is authoritative** — `off` buffers **everyone, including the PWA** (whole reply at
   once; legitimate for a flaky link). One global switch, no client carve-out.
4. **One endpoint, content-negotiated:** `chat()` resolves effective-streaming in one helper, then
   returns `EventSourceResponse` (today's path, unchanged) or `JSONResponse`; `text/event-stream` vs
   `application/json` is the client's discriminator. Same for `resume()`. The `active_turns` counter +
   integrations-dirty rediscover wrap both branches once (not duplicated).
5. **Frontend reuses the reload path:** `store/chat.ts` posts as today, branches on response
   `content-type` — event-stream → existing SSE parser (untouched); json → re-read the persisted
   message via the existing `reloadChat()`/GET-messages render path (no parallel rendering reducer),
   handling `state==suspended` (confirm bubble already renders from the persisted `AWAITING_CONFIRM`
   part) and `state==error`. The buffered payload stays small + authoritative (the turn persists the
   message regardless of transport, `api/agent.py:6`).
6. **Conf** exposes the selector via the existing `useSettings`/`PUT /api/settings` Seg pattern.

**Scope:** chat endpoint only. **STT/TTS streaming (also under ROADMAP C1) stays Phase 6.** On
landing: flip ARCHITECTURE §1's claim to shipped-true and tick the C1 audit line. Tests: `collect_turn`
over scripted `AgentEvent` streams (completed/suspended/error/capped) + endpoint content-negotiation +
a streaming-vs-buffered final-message parity check, all on a temp config.

---

## D18 — Failover is a shared subsystem; voice ships on it, the LLM chain reuses it ✅ SHIPPED 2026-06-22 (6a-1, backend)

**Decided 2026-06-22 (with the owner), building Phase 6 voice.** Failover (an active endpoint dies →
fall through to a configured chain until something works) is **its own cross-cutting subsystem**, not a
per-service feature. Voice (STT/TTS) is the first consumer; the **LLM inference fallback chain is the
next slice** and reuses the *same* primitive — so we never grow two failover implementations
(the project's no-duplication rule).

**The owner's mental model (locked):** the fallback chain is **independent of how the active endpoint
was chosen**. Whatever model is in play (picked by a service's config, by chat mode, by an agent, by a
composer prefix), if it fails the request walks one ordered chain — entry 1, then entry 2, … — until
one succeeds. The active endpoint just *delegates* to the chain on failure; fallback is not a property
of the primary.

**Locked choices:**
1. **One generic primitive — `core/failover.py`.** `async failover(endpoints, attempt, *, label) ->
   FailoverResult` walks the list, returns the first success + metadata (`served_index`, per-hop
   `failures`, `degraded`), raises `FailoverError` (carrying every hop's error) only if all fail or the
   chain is empty. **Value-agnostic:** `attempt(ep)` returns whatever the consumer wants — a buffered
   value (voice) or a `(first_chunk, stream)` handle (a streaming consumer) — so "success = first
   attempt that doesn't raise" lets a future *streaming* reuse (inference) fail over at stream
   *initiation* without this code assuming a buffered result.
2. **Per-subsystem config shapes feed the primitive a list.** **Voice** = fixed `primary` + `fallback`
   (two named fields, simple Conf forms — the owner's 2-tier vault/emma model); `VoiceServiceCfg.endpoints()`
   emits `[primary, fallback]` (blank `base_url` dropped). **Inference** (next slice) = an ordered
   `endpoints[]` chain (N-deep, crosses local/cloud). Same primitive, different ergonomics per
   subsystem's mental model. We generalize voice to a list only if a 3rd tier is ever wanted.
3. **Policy: any error → try the next endpoint** (the "ensure functionality" directive). Not just
   connect/timeout/5xx — **a 4xx falls through too**: for a homelab panel a working result wins, and the
   any-error chain naturally hedges format incompatibility (e.g. an STT box lacking ffmpeg 400s on webm →
   skip to the next). The error is **surfaced but functional**: each failed hop is logged + collected; a
   success-via-fallback returns an `X-Voice-Served-By: fallback` header (so you know a primary went down);
   total failure raises the aggregated error (HTTP 502). Inference's `is_retryable` can be tuned per
   consumer later (e.g. let a 404 model-not-found fall through, terminate on a 400 context-too-long) —
   the primitive doesn't hardcode the classifier.
4. **Split timeouts for snappy failover.** Each service carries a short `connect_timeout_s` (≈3s — how
   fast we give up *reaching* a dead endpoint before failing over) separate from a generous `timeout_s`
   read window (the actual STT/TTS work) — `httpx.Timeout(read, connect=…)`. Matters because we always
   try the whole chain: a dead vault costs ~3s, not 30, before emma takes over.

**Inference-chain follow-up ✅ SHIPPED 2026-06-22 (`657ba19`).** The composition question resolved:
the active endpoint is still selected as today (`/local`//`/cloud` → sticky → `ModelRef.mode` →
`default_mode`); the new part is the **chain** = `[selected, the-other-of-local/cloud, *inference.fallbacks]`
(deduped, blanks dropped, gated by `inference.failover` default-on). So local↔cloud mutual failover is
free (no config duplication) and `fallbacks[]` adds N-deep. **Model override (`ModelRef.model`) applies
to the selected endpoint only** — fallbacks use their own model. Streaming fails over at **initiation**
(open stream + pull first chunk per endpoint; research-validated "confirm alive with a first token");
**no mid-stream failover** (a partial reply can't be restarted). Fully encapsulated in `InferenceClient`
(reuses `core/failover.py`; the agent loop is unchanged), with a `StreamReport` → a `notice` breadcrumb
when degraded. **Deferred (design-compatible):** a circuit breaker (skip a known-dead endpoint ~60s).
Verified: `test_inference_failover_d18` (11) + full suite + **live** (dead cloud → real local served
"pong", degraded). **Fallbacks UI editor + audit fixes `30af624`:** Conf → Inference inline list editor
(`inference.fallbacks` add/remove/edit, saved by the Inference saveBar). A pre-build audit fixed two
bugs: (1) `endpoint_chain` with failover OFF + a blank selected endpoint silently routed to the other —
now strictly the selected (blank → error, as pre-D18); (2) `unmask_secrets` walked secret lists by
index, so removing a non-last fallback clobbered the others' api_keys with masks — now matches list
items by stable identity (base_url/url/name), surviving reorder/remove (also strictly improves mcp/openapi
secret preservation).

---

## D19 — Voice streaming transports: a fast-path over the reliable request path ✏️ DESIGNED 2026-06-22 (not built)

**Decided 2026-06-22 (with the owner), after a measured STT-latency audit** (warm STT ≈0.6s, our
backend overhead ≈0; the felt lag was the Speaches whisper model **cold-reloading after idle**, fixed
server-side by keeping it warm). Streaming voice (live dictation + progressive TTS) is **not the fix for
that lag** — it's a UX upgrade — so it's a **designed pattern, deferred**, not a Phase-6 build. This
**revises** the earlier "STT is always buffered, no toggle" stance (ROADMAP C1): streaming STT is now a
first-class, designed transport, because the server already supports it (below).

**The pattern — one principle: two transports behind one interface, fast-path over reliable-fallback.**
Each voice service (STT, TTS) has:
- a **reliable request transport** — the shipped buffered path (one-shot HTTP through `core.failover`,
  D18; full primary→fallback). The **default and the floor.**
- an optional **low-latency streaming transport** — a *session* (WebSocket for STT, chunked/MSE for TTS)
  that emits output before the whole utterance/clip is done.

The streaming transport **targets the primary endpoint only**; if the session can't establish — or drops
mid-utterance — the client **degrades to the buffered request transport**, which keeps D18's full
failover. So streaming is an **accelerator layered over the reliable path, never a replacement**: D18 is
the reliability floor, streaming is the latency win on top. This *composes* the two subsystems instead of
forcing failover into a persistent socket (the exact tension that made us defer chunked streaming in D17
— resolved here, not re-fought).

**Mode selection reuses D17's vocabulary (no new pattern).** Per-service `auto|on|off`, mirroring
`AgentCfg.streaming` exactly: `voice.stt.streaming` and `voice.tts.streaming` (`off` until built, then
`auto`). `auto` = stream iff the client supports it **and** the primary advertises the capability, else
buffered; `on` forces, `off` always buffers — same resolver shape as D17's `_effective_stream`. Surfaced
to the always-on mic/player via `GET /voice/status` (which already carries `stt_auto_send`; add
`stt_streaming`/`tts_streaming` flags) — not the Conf-scoped settings query.

**STT streaming — integration (extend, don't fork):**
1. **Backend** — a WebSocket route `/api/voice/stt/stream` bridging browser-WS ↔ the primary's Speaches
   **`/v1/realtime?intent=transcription`** (OpenAI-Realtime-compatible; **verified** your
   `deepdml/faster-whisper-large-v3-turbo-ct2` is the model in their own example). Preserves the **proxy
   invariant** (browser never holds the STT key/endpoint — the same reason the request path is a proxy,
   ARCHITECTURE §Voice). Relays audio frames up, `transcript.delta`/`.completed` down; redacts deltas via
   `Settings.secret_values()` like search snippets. Connect-failure → close with a `degrade` code so the
   client falls back. New `adapters/voice_stream.py` (`VoiceStreamSession`) reusing `VoiceEndpointCfg` +
   the cached client; **`VoiceClient` stays the request-path owner** — one sibling, no fork.
2. **Frontend** — **extend `useDictation`, add one code path, no parallel component.** The hook already
   owns the recorder lifecycle + the 4-state machine. Streaming adds an **AudioWorklet** capturing PCM16
   → the WS → `transcript.delta`s land as **provisional** draft text, finalized on `.completed`/stop. Mic
   visual states unchanged; only *how the transcript arrives* differs. `off`/unsupported → today's
   record-then-POST path. The **provisional-draft model**: the hook holds the live partial locally and
   writes the current best into the composer (a provisional region replaced as finals stabilize,
   committed on stop) — reuses `setDraft`/`appendDraft`, no new store; this absorbs the "words rewrite as
   context arrives" flicker by only committing finals. **Auto-send (6b-3) composes**: commit-on-stop
   routes the final transcript through `runComposer` exactly as today.

**TTS streaming — integration (a second source strategy on the singleton):**
1. The controller (`audioController`) already abstracts playback behind the singleton; streaming TTS is a
   **second source strategy** — `blob` (current: full-clip, natively seekable) vs `stream` (progressive
   via **MediaSource Extensions**). The controller gains a tiny strategy switch; play/pause/dismiss, the
   per-bubble button, and auto-TTS are **unchanged**.
2. **Mechanism:** the backend passes `/v1/audio/speech` through chunked (AllTalk streams), and the
   controller feeds an MSE `<audio>` so playback starts at the first chunk (time-to-first-audio ~0.5–1s
   vs the measured ~3.75s full-clip for a long line).
3. **The scrubber trade-off (explicit, owner-acknowledged):** streaming = **duration unknown until the
   stream ends**, so in `stream` mode the MiniPlayer shows elapsed + an indeterminate seek until the
   final chunk resolves duration, then becomes fully seekable. **Default stays `blob`** (seekable, great
   for short replies); `stream` is the opt-in win for long ones. The real payoff is later
   **sentence-pipelining** with the chat stream (synthesize sentence N while N-1 plays).

**Why this shape is right (the integration test):** (a) preserves D18 by making streaming
primary-only-with-buffered-fallback; (b) reuses D17's `auto|on|off` resolver vocabulary; (c) preserves
the proxy/key invariant; (d) integrates into the **hook** (STT) and **singleton** (TTS) built in 6b with
**no parallel components**; (e) config-driven + opt-in, off until built. No new failover impl, no new
state-store, no new streaming vocabulary — it slots into four patterns we already own.

**Cost / build order:** STT streaming ≈ a medium slice (WS proxy ~100–150 LOC + AudioWorklet capture +
provisional-draft handling ~150–200 LOC + config); TTS streaming ≈ smaller (chunked passthrough + the
controller's MSE strategy) but costs the seekable scrubber in `stream` mode. Both are **post-v1 polish**,
each with its own pre-flight. The cold-start lag that prompted this is fixed *for free* by keeping the
whisper model warm server-side.

---

## D20 — In-app HTTPS control: Tailscale Serve as a host-management capability (6c-2) ✏️ DESIGNED 2026-06-22 (not built)

**Decided 2026-06-22 (with the owner), after 6c-1 shipped the manual path.** `tailscale serve --bg 5173`
(documented in `HTTPS_TAILSCALE.md`, **owner-verified working on the phone**) gives the mic its
secure-context HTTPS front door. **6c-2 surfaces + controls that from the UI** — flip HTTPS on/off, see
the `https://…ts.net` URL, and **scan a QR to open it on the phone** — without a terminal. It does **not**
replace 6c-1; the manual command stays the fallback.

**The capability's nature (what it integrates as):** Tailscale Serve manages the **backend host itself**
(not a fleet host, not a remote box), so its closest precedents are `run_shell` (`services/actions/shell.py`
— runs on the backend host) and the fleet host-actions. It slots into **patterns we already own**, no new
execution path:

1. **Execution = typed host-actions (the chokepoint).** New `services/actions/tailscale.py`, reusing
   `shell.py`'s subprocess-exec core (redaction, kill-on-timeout, combined output):
   - `tailscale_status` (LOW, read) → parse `tailscale serve status --json` (+ `tailscale status --json`
     for daemon health) → `{serving, url, available, reason}`.
   - `tailscale_serve_enable` / `tailscale_serve_disable` (risk **MED**, `ui_exposed=True`) →
     `tailscale serve --bg <target_port>` / `… off`. **Hardcoded to `serve`, NEVER `funnel`** — the
     no-public-bind boundary (AGENTS §6) is preserved by construction; the action must not expose a
     public path. Same CLI on both OSes (PATH-resolved `tailscale`/`.exe`, no per-OS branch); runs
     non-elevated for an admin user on Windows (verified) + via `--operator` on Linux.
2. **Status = an always-on read (mirrors `/voice/status`).** `GET /api/access/status` →
   `{serving, url, available, reason}`, read by the Conf panel (not Conf-scoped, cheap). **tailscaled is
   the source of truth** — we read `serve status` live; we do **not** store on/off in our config (Serve
   persists in tailscaled independently, so a stored flag would drift).
3. **Config = desired-state only.** `config.py` `TailscaleCfg` (`tailscale`): `target_port: int`
   (which local port Serve fronts — covers dev 5173 / preview / prod) + `enabled: bool` (whether the
   panel/actions are active at all). The live on/off comes from tailscaled, not config.
   *(Amended 2026-07-07, QH-11 — owner decision: the default flipped `5173` → **`5433`** (the
   backend-served prod SPA); the dev-Vite default was the wrong safe-default direction (SYS-4 rider).
   Override per box via `tailscale.target_port` in config.yaml or `CTRLB_TAILSCALE__TARGET_PORT` in `.env`.)*
4. **Frontend = a Conf → Access panel** (mirrors the 7c integration panels): a status dot + the
   `https://…ts.net` URL (copy + **QR**) + an Enable/Disable toggle. The toggle POSTs to an endpoint that
   invokes the action through **`ActionService`** (USER actor, FULL privilege — the owner clicking *is*
   the authorization, like the `!` shell path; **audited as an Event**). **Graceful degrade:**
   `available:false` (CLI missing / denied) → show the manual command + the `HTTPS_TAILSCALE.md` link
   instead of a dead toggle (detect-then-degrade, like the mic's reactive "unavailable").
5. **QR generation — prefer server-side, no frontend dep.** The backend already knows the URL; render the
   QR to an **SVG** with a tiny pure-Python lib (`segno`, zero-dep) at e.g. `GET /api/access/qr.svg`, so
   the frontend just `<img>`s it — keeps the bundle clean and the tailnet hostname off any third-party
   service. (Alt: a small client QR lib; decide at build.)

**Security (explicit):**
- **Serve only, never Funnel.** The actions neither offer nor accept a public-exposure path — tailnet-only,
  the no-public-bind rule intact.
- **USER-driven, gated + audited** via `decide()` + `ActionService._record` like other host actions.
  **Not agent-exposed by default** — an agent shouldn't flip the host's HTTPS unprompted; it's
  LOW-risk/tailnet, so a later explicit grant is fine, but default-off keeps the surface tight.

**Why this shape:** reuses the typed-action chokepoint (`run_shell` core), the always-on status pattern
(`/voice/status`), the integration-panel UX (7c), and config-as-desired-state — **no new execution path,
no new security boundary**, tailscaled stays the source of truth. The only net-new dependency is a tiny
QR generator (server-side, zero-dep).

**Open before building (its own pre-flight):**
- Verify the exact `tailscale serve status --json` schema on the host (varies by tailscale version) before
  parsing — don't assume the shape.
- Confirm `target_port` matches however the app is actually served at cutover (dev vs preview vs a prod
  static server on emma).
- QR: server-SVG (`segno`) vs a client lib — pick at build (lean server-side).
- Whether to expose a one-shot "open on phone" affordance beyond the QR (probably not — QR is enough).

---

## D21 — Frontend test foundation: Vitest, logic-first, isolated from production ✅ SHIPPED 2026-06-22

**Decided 2026-06-22 (with the owner), to harden before the emma cutover.** The backend had 23 test
files; the frontend — which now holds the most intricate, recently-churned logic (the chat streaming
reducer, the audio-controller singleton, the dictation state machine, composer routing) — had **zero**.
That regression gap was the highest-leverage robustness investment, and a pure addition (zero risk to
working behavior), so it goes first — *before* the riskier inference-fallback rework, which it de-risks.

**Stack (web-researched):** **Vitest** (unanimous for Vite+React+TS — native Vite integration, ESM/TS/JSX
zero-config, far faster than Jest; Jest only for legacy/RN) + **jsdom** (chosen over happy-dom: happy-dom
is ~2–5× faster but trades edge-case completeness for speed — that only matters at hundreds of tests; for
a small suite **test reliability > test speed**, so the 10-yr battle-tested option wins; happy-dom is a
15-min swap later if needed) + **@testing-library/react** (`renderHook`, to drive the `useSyncExternalStore`
stores through their real subscription path). All **devDependencies**.

**Philosophy — mirror the backend: test the logic, eyeball the pixels.** Unit-test the load-bearing
logic (reducers, state machines, routing, helpers); **no component/pixel/snapshot tests** (brittle,
low-leverage for single-user; the owner verifies UI at 390px under D7). That's F24/Phase-9 territory —
we pulled forward the high-value *logic* net, not a full UI-test suite.

**Production isolation (the owner's hard requirement) — verified, not assumed:**
1. devDependencies → never in the bundle. 2. Tests in `tests/` (outside `src`) → never imported → never
bundled. 3. **Separate `vitest.config.ts`** → the `vite build` path is untouched. 4. `tests/tsconfig.json`
is **not referenced by the root** → `tsc -b` (the build's typecheck) never processes tests. 5. No
in-source testing (`import.meta.vitest`). **PROOF:** the production bundle is **byte-identical** before/
after (all 4 asset sha256 match the baseline); `npm run build` + `npm run typecheck` clean. Non-vacuity
proven by mutating a source fn and watching the right test go red.

**Conventions (locked for all future frontend tests):** files in **`tests/`** mirroring `src/` layout
(`tests/lib/…`, `tests/store/…`), **explicit imports from `vitest`** (no `globals` injection → no
tsconfig globals types), `tests/setup.ts` for the few unavoidable browser shims (Object URLs), richer
fakes (Audio/MediaRecorder/`fetch`) built **per-test** for isolation. Scripts: `npm test` / `npm run
test:watch`. The chat reducer is tested via a **`mockSSE` fetch** through the real public API
(`sendMessage`/`resumeCall`) — covers the byte-parser too, no reducer fork.

**Shipped — 56 tests / 9 files.** Tier-1 (`33ae459`, 27): `toSpeech` (6), `composer` routing (9), `chat`
streaming reducer (5: completed/reasoning-split/confirm-suspend/resume/error), `audioController` (7).
Tier-2 (`09fdf8b`, 22): `lib/privilege` (3), `store/composer` (5), `store/ui` (5: incl. selector
isolation), `lib/markdown` (5: parser→DOM + the `javascript:` XSS guard), `hooks/useDictation` (4: fill/
auto-send/502-unavailable/insecure-context, over a fake MediaRecorder+getUserMedia+fetch). The frontend
logic net is now substantial. **Still deferred (Phase 9 / F24):** component-render/a11y/pixel tests.

---

## Still open (decide before building the relevant phase)

**Resolved since this list was written (kept here as a pointer so the section stays honest):**
- ~~Agent tool-calling format + prompted-JSON fallback~~ → **resolved 2026-06-16: native-only,
  prompted-JSON DROPPED.** Native OpenAI `tools` shipped + proven (`inference.py:125`); the weak-model
  problem was tool *selection*, fixed by the `fleet` intent-skill (tool-narrowing) + loop guards, not a
  format change (Phase 4c). The owner runs only native-tool-capable models (local `minig+`, cloud), so
  the capability-probe + prompted-JSON path is **not built and not a deferred seam** — if a future
  tool-incapable model is ever adopted, we decide from scratch then.
- ~~Memory backend(s): none / file / vector / both~~ → **resolved in D14**: file impl first
  (`MEMORY.md` per-agent + global `USER.md` + a `memory` tool, Hermes-shaped), vector as the later
  "both" mode over the embeddings client (D9). Pluggable `MemoryProvider` (ROADMAP B1) is the seam.
- ~~Frontend routing: tab state vs `react-router`~~ → **resolved Phase 1**: lean tab state
  (`store/ui.ts`), no router (no deep-linking need). Recorded in TODO "Open questions".
- ~~MCP: how much of the client to ship in v1~~ → **resolved (Phase 4f)**: **both transports**
  (Streamable HTTP + stdio) shipped + live-verified, namespaced `mcp__<server>__<tool>`, per-server
  failure isolation, between-turn rediscovery (7c-b). Nothing left open here.
- **Auth: standing decision (not open)** — stay none (Tailscale-only) for v1; revisit only if the
  exposure model ever changes (security hardening = ROADMAP G).

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

## D22 — Tools tab = run cards + a unified-override agent-tool catalog (tri-state access) ✅ DECIDED 2026-06-24 (8a + 8b SHIPPED — eyeballed + reviewed)

The Phase-8 Utils tab becomes the **"Tools" tab** and serves two distinct concerns in two sections:

- **Section A — Run cards (8a, shipped).** Self-contained, context-free utility tools (`@tool`,
  `category="utility"`, `ui_exposed`) the owner runs directly — yt_captions / ip_info / dns_trace. A
  generic card renders each tool's flat `input_model` JSON Schema (no per-tool UI). Invoke is a
  **category-guarded facade** (`POST /api/tools/{name}`) over the one `ActionService.invoke` — not a
  second execution path; it 404s on non-utility/agent-only names so the Tools surface can't run
  `shutdown_host`/`run_shell`/`web_search`.
- **Section B — Agent-tool catalog (8b).** Manages *every* agent tool: a per-tool **description
  override** + a **tri-state agent-access mode**. NOT run buttons — actions already run from Fleet;
  builtins/MCP have no standalone meaning.

**The override model — one unified object, never sibling maps (research-backed; CLAUDE.md hard rule).**
`Settings.tool_overrides: dict[str, ToolOverride]` where `ToolOverride = {description?, agent_mode?}`.
A future per-tool **`settings`** dimension is a purely additive field (a Pydantic v2 discriminated union
keyed by tool — ROADMAP E0a), *not* a new top-level map. Deep-research (25/25 claims verified 3-0; VS
Code / ESLint / Pydantic / MCP / rjsf primary sources) found sibling name-keyed maps are the refactor
trap: each new dimension is a new map + new read/merge code, paid when the data is no longer empty.
Legacy `tool_descriptions` is folded into `tool_overrides[name].description` by a before-validator
(zero-touch migration).

**Tri-state `agent_mode` overlays the registry spec** (generalizing the shipped 7d-a description
overlay; `apply_tool_overrides` captures + restores originals): **core** → `(agent_exposed=True,
core=True)` · **enabled** → `(True, False)` · **disabled** → `(False, False)` · **absent** →
compile-time default. `for_agent`/`agent_tools` already read those fields, so there's no
registry-logic change — only the overlay sets them. The actions DTO gains `default_agent_mode` so the
catalog stores only deviations and can reset.

**Two invariants that must not blur:**
1. **Membership ≠ privilege.** `agent_mode` controls *availability* only (is the tool in the toolset).
   `risk`/`confirm`/`decide()` gate *execution* independently — a `core` HIGH tool is always available
   but still confirms. Never conflate them, or you can't have an available-but-guarded tool.
2. **core bypasses BOTH the per-agent allowlist AND per-turn skill narrowing.** Demoting a default-core
   tool (e.g. `session_search`) to `enabled` means specialists with explicit `tools` lists lose it
   unless they list it — the owner's intended trade ("I don't use it much").

**Two axes, edited at their subject (no duplicate writers).** Tool-centric global settings
(description, mode) live in the **Tools tab**; per-agent tool selection (`AgentDef.tools`) stays in
**AgentsEditor**. They compose visually: the AgentsEditor tick-grid renders a globally-**disabled** tool
locked-off and a **core** tool locked-on. Putting a tool→agents matrix in the Tools tab is rejected —
it would be a second writer of `AgentDef.tools`.

**Special cases:** `run_shell` is shown read-only in the catalog (its `decide(shell.agent_exec_enabled)`
gate + FULL-privilege requirement govern agent access — a tri-state toggle there would lie); MCP/OpenAPI
tools' tri-state sits *under* the per-server enable (server off → tool gone) and stale overrides are
ignored (rediscover re-applies the overlay). The card title/summary use the **default JetBrains Mono**
font (owner-directed override in `extras.css`; vapor.css untouched, D7) because Major Mono renders
capitalized titles + sentence summaries badly.

**Why:** the owner wants a dedicated tool surface both they and the agent use, with descriptions +
enable/disable consolidated in one place, designed so adding per-tool settings or many more tools never
forces a big refactor. Full file-level 8b plan + pre-flight in HANDOFF.

## D23 — External-store dedup: a minimal dep-free binding primitive (not a state-owning factory) + shared Switch/Seg ✅ DECIDED 2026-06-24

**Problem.** Ten module-singleton external stores hand-roll the **identical** wiring — a `listeners`
Set + `emit` + `subscribe` + a `useSyncExternalStore` call: the 9 `store/*.ts` **plus** the
`lib/audioController.ts` DOM-singleton (which even carries a comment admitting the duplication). Two
small presentational controls are also copy-pasted: `Switch` (×4, byte-identical) and `Seg` (×3,
identical modulo a `<T extends string>` generic).

**Decision — a minimal "store-binding" primitive, NOT a state-owning factory.** `store/createStore.ts`
exports `createStore()` → `{ subscribe, emit, useStore }`, where `useStore<T>(getSnapshot: () => T): T`
wraps `useSyncExternalStore(subscribe, getSnapshot, getSnapshot)`. It unifies **only** the genuinely
duplicated plumbing and imposes **zero state shape**: each store/singleton keeps its own `let state`
(object / array / `Set` / primitive / promise-bridge / DOM-mirror), its own (often guarded) update
function calling `emit()`, and supplies its own snapshot — whole (`useStore(() => state)`) or a slice
(`useStore(() => selector(state))`).

**Why minimal-binding over a `createStore<T>` that owns state (the originally-sketched plan).** Analysis
of the real code settled it:
- **`chat.ts` is the risk center** (679 lines, **66** `state.x` reads, **27** internal `set()` calls)
  and the most-evolving store. The minimal binding changes it by **~4 lines** (the `listeners` decl, the
  `emit` in `set`, the `subscribe` fn, `useChat`'s body); the reducer body + all 19 exported actions are
  untouched. A state-owning factory would force rewriting all 66 reads to `store.get().x` — high churn on
  the exact store that keeps changing, for ~1 line/store less boilerplate. Not worth the risk.
- **It's the only shape that fits all 10**, including the `audioController` DOM-singleton (its reactive
  snapshot mirrors a `<audio>` element — it is not a "state container" and doesn't fit a `setState(patch)`
  mold). One consistent pattern across every instance → no "similar code doing different things."
- **Heterogeneity is preserved, not flattened:** the `Set`-registry (`dirty`), the primitive
  (`connection`), and the promise bridges (`confirm`/`prompt`) keep their natural shapes.

**Migration is provably low-risk.** Every store's *public* surface is only hooks/actions/getters; the
plumbing is module-private, so the swap is internal to each file with **zero consumer changes** (verified:
nothing imports `subscribe`/`getSnapshot`/`state`). The three most-complex stores (`chat`/`composer`/`ui`)
have Vitest unit tests that import only the public API, so they protect the migration unchanged.

**Selector contract (unchanged).** All current selectors (`ui.useUISlice`, `audioController.usePlayback`)
return **primitives** → safe under `Object.is` with no equality machinery. The "return a primitive/stable
ref" caveat already documented in `ui.ts` carries over. **Explicitly out of scope (YAGNI):** an
object-selector + `equalityFn` variant (a hand-rolled `useSyncExternalStoreWithSelector`). It's purely
*additive* if a composite read ever appears (e.g. a future dynamic-theme slice) — not a refactor. Per
React's own docs, the primitive way to get composite reads today is one `useStore` call per field.

**Side-effects + persistence.** `emit`/`set`/snapshot is all the factory owns. Per-store side-effects
(`ui`'s `applyBodyAttrs`, the `localStorage` writes) stay as **explicit calls inside each store's action**
(preserving the exact current control flow, incl. `ui`'s synchronous body-attr apply before re-render).
The only *other* real duplication — the load/save `try/catch` in the 3 persisted stores (`ui`, `composer`,
`collapse`) — folds into a tiny shared `loadPersisted(key, defaults)` / `savePersisted(key, value)` pair
(separate from the binding; single-responsibility). No `persist`-middleware ambition.

**Build vs. buy (researched, web-sourced).** Zustand *is* this pattern (≈1–3 kB, uses
`useSyncExternalStoreWithSelector`, `persist` middleware) and is the canonical answer for large apps. For
this **single-user homelab PWA** — near feature-complete, simple stores, only the chat/agent + theme
subsystems still growing — a 10-store rewrite + a dependency to remove ~60 lines of trivial boilerplate is
disproportionate; the owner chose to **stay dep-free**. The thin binding is *not a dead-end*: its surface
(`subscribe`/`get`/`useStore`) is close enough that swapping in Zustand later is itself low-risk if client
state ever outgrows this.

**`Switch`/`Seg`.** Extract to shared `components/Switch.tsx` + `components/Seg.tsx` (the generic
`Seg<T extends string>` covers `ServerListEditor`'s string usage). Precedent this session: `ModeSeg`,
`ConfGroup`. `ModeSeg` is a *richer* specialized control — it stays separate (composing the generic `Seg`
isn't worth the indirection; re-evaluate only if a third tri-state appears).

**Slices (no behavior change; prod bundle verified behavior-identical, 57 fe tests green throughout):**
(1) `createStore` + `persist` helpers + migrate the 10 instances; (2) extract `Switch` + `Seg`. Pause between.

## D24 — Frontend e2e + a11y test layer: Playwright + axe-core, mocked-API against the built artifact ✅ DECIDED 2026-06-24

The D21 Vitest foundation tests *logic*; this adds the missing *integration/render/a11y* layer (UI_AUDIT
F24) before the emma deploy — the guard against "it built but the screen is blank / a flow throws / an
a11y fix regressed."

**Shape.** Playwright's `webServer` runs `npm run build && npm run preview`, so specs drive the **real
`dist/` artifact** (not a dev build). **`/api` is mocked at the browser level** (`page.route` + fixtures),
not via a real backend — deterministic, fast, cross-platform (no uvicorn/venv/LLM orchestration), and the
real API contract is already covered by the 25 backend test files. Projects: `mobile` (Pixel 5, the
primary target) + `desktop`. `serviceWorkers: "block"` (the PWA SW would cache-flake tests); workers
capped (axe is CPU-bound — 8-wide thrashed one preview server).

**Isolation (mirrors D21).** Specs live in `e2e/*.spec.ts` (separate from `tests/` + `src/`), own
`playwright.config.ts`, all deps are devDependencies → `npm run build` output is unaffected. `npm run
test:e2e`. The browser binaries live only on the dev/CI machine; nothing reaches `dist/` or the server.

**Scope.** (1) render smoke — each of the 4 tabs mounts, key content visible, no uncaught `pageerror`;
(2) critical flows — tool-card run, shutdown confirm + cancel, chat send, theme change; (3) a11y — axe
scan per **active panel** (the other tabs stay mounted/hidden — scanning them adds cross-tab noise),
**WCAG 2.0/2.1 A+AA**, with **`color-contrast` excluded** (the Vapor low-contrast neon-on-dark palette is
the deliberate D7 aesthetic; the gate guards the *structural* a11y — roles/names/labels/ARIA — which is
the F14–F27 work). 13 specs × 2 projects = 26.

**Harness lesson (recorded).** The API mock must apply via a `page`-fixture override, NOT a fixture only
some specs destructure — else specs taking just `{ page }` (the a11y scans) silently run unmocked. Also:
axe catches the *machine-detectable* third of WCAG; it cannot see a click handler on a plain `<div>` (so
keyboard-inaccessible div-toggles slip past — see D25). The gate is necessary, not sufficient.

**What it found:** two real WCAG violations on its first run → fixed/tracked in **D25**.

## D25 — a11y consistency: label association + accessible disclosure toggles ✅ DECIDED 2026-06-24 (gate findings fixed; broader sweep documented)

The D24 gate surfaced two real, pre-existing WCAG violations. Both **fixed** (gate now green):

1. **`label` — 25 Conf scalar inputs had no programmatic label** (a visible `<div class="label">`, not
   associated with the input). Fixed in the shared **`Field`** component via **`aria-labelledby`** (a
   `useId()` on the label `<div>` + `aria-labelledby` on the input).
2. **`nested-interactive` — the Fleet device row was `role="button"` *containing* the action buttons.**
   Fixed by making the row header a plain **`<div onClick>`** (tap-anywhere-to-toggle, unchanged — a div
   with a click handler is *not* a "button containing buttons", so it sidesteps the violation) plus the
   **chevron as a real `<button aria-expanded>`** so the toggle is keyboard-operable; the chevron and the
   action buttons `stopPropagation` so they don't double-toggle / toggle. No visual change; vapor.css
   untouched (D7). _(First tried Roselli's "breakout" `::before`-stretch — but it broke whole-row click;
   the plain `<div onClick>` + child button is simpler and robust. The owner caught the regression, so the
   e2e suite gained a "clicking the row **body** toggles it" test that the bug had slipped past.)_ Owner
   eyeball at 390px pending.

**⚠️ Deliberate labelling-mechanism inconsistency (noted for the future, owner-requested).** We use **two**
association mechanisms, chosen by container — **not** an oversight:
- **`Field` (Conf scalar rows):** `aria-labelledby`. The label is a `<div>` in `.confrow .k` **block
  flow**; swapping it to a native `<label>` (inline by default) would shift the layout, so we associate
  without changing the element. Zero layout risk, same accessible name (W3C/WAI confirms `aria-labelledby`
  pointing at a visible element is acceptable).
- **The editors (`.mform` grids + the run-time `<span>`-labelled / placeholder-only inputs):**
  **`aria-label`** on the input (and `aria-labelledby` for the `PromptModal` textarea → its title h3).
  The original plan was native `<label htmlFor>`, but across ~40 heterogeneous inputs the per-input
  `id`-pairing churn wasn't worth native's only real benefit here (label-click-to-focus — marginal for a
  single sighted user; owner's explicit call). `aria-label` is one attribute per input, zero layout risk,
  and gives the same programmatic name. The visible `<label>`/`<span>` text stays for sighted users.
Both yield a programmatic accessible name; the gate (`label` rule) checks that, not the mechanism. So the
codebase has **three** naming idioms by context — `aria-labelledby` (`Field`, `PromptModal` → reuse an
existing visible-label element's id), and `aria-label` (the editors → no single label element to point at).
**If a labelling bug ever appears, this is why the mechanism differs by file** — it's intentional, not drift.

**Disclosure-toggle pattern (the consistent rule going forward).** An expand/collapse row is keyboard-
accessible via **ARIA-button-on-the-row** (`role="button"` + `tabIndex` + Enter/Space handler +
`aria-expanded`) — **except** when the row contains nested interactive controls, where the **breakout
pattern** is used instead (the row stays a plain div; a child button is the toggle). DeviceRow is the only
breakout case (it has action buttons); the others have button-free headers.

**Consistency sweep — ✅ SHIPPED 2026-06-24 (one coherent pass).** axe didn't catch these (collapsed groups
are `display:none`; axe can't detect a click handler on a plain `<div>`), but they were real:
- **Editor input labels — done.** Every `<input>`/`<textarea>`/`<select>` in `AgentsEditor`,
  `MachineEditor`, `ServerListEditor`, `MemoryEditor`, the `ConfTab` fallback editor, `SkillsEditor`, and
  `PromptModal` got a programmatic name (`aria-label`, or `aria-labelledby` for `PromptModal`). ~40 inputs.
- **Bare-div toggles → keyboard access — done.** New **`lib/disclosure.ts`** `disclosureToggle(open,
  onToggle)` (the ARIA-button pattern), spread onto **12** toggles: `ConfGroup`, `AgentRow` + add-agent,
  `MachineEditor`'s 3 (machine row, add-machine, service-edit head), `MemoryEditor` slot, `ServerListEditor`
  row + add, `SkillsEditor` row + add, the `ConfTab` fallback row. Each header was verified button-free
  first (the body buttons live in `.mconf`/`.svc-body`, separate from the header) — no new nested-interactive.
- **Verified:** e2e gained a keyboard-toggle test (focus a `ConfGroup`, Enter toggles) and a
  findable-by-label test (`getByLabel("Hostname")` resolves only via the accessible name). 85 unit + 25
  backend + **32 e2e** green; `tsc -b` + build clean.
- **The shared `disclosureToggle` helper is the drift-guard:** new expand/collapse rows spread it (or, if
  the row contains buttons, use the `DeviceRow` plain-`<div onClick>` + child-button approach instead).

## D26 — Memory directory = a self-contained, auto-committed git repo (atomic, coupled, best-effort) ✏️ DESIGNED 2026-06-25 (Slice 2)

Extends D14's file-based memory with a **local git repo** that auto-versions every memory change — each
consolidation/edit/accidental-wipe becomes a recoverable, timestamped commit. The **app** manages the repo
(not the agent); a GitHub remote is a later opt-in. Two prior slices: **Slice 1** (shipped `ecfe762`) hardened
the consolidation path (F1 grow-only cap guard, F2 action-aware error, F3a orphan-marker cleanup, F5 invariant
doc); **Slice 2** is this git layer. Research-corroborated (deep-research + targeted searches 2026-06-25; 23
verified claims; see HANDOFF).

**Naming (owner directive):** no "vault" — that word is reserved for the owner's future Obsidian vaults. The
root is the **memory directory** (`MemoryCfg.memory_dir`, default `memories`); per-agent is an agent's
**memory dir** (`AgentDef.memory_dir`).

1. **System `git`, not a library.** Shell out to the `git` binary via `core/proc.run_capture` (argv, no
   shell). dulwich/pygit2 need hand-rolled credential callbacks (weak GitHub/SSH story); GitPython is
   maintenance-mode + Windows-unstable (DVC dropped it); the CLI gives 100% config/credential-helper
   compatibility; and git is already a runtime dependency (the agent uses it) → a library would mean *two*
   git implementations. A library would only win if we couldn't depend on the binary — we can.

2. **One consolidated memory directory = one repo, with configurable roots.** `$CTRLB_HOME` holds
   `config.yaml` (secrets) + `ctrlb.db`, and on the corsair checkout `$CTRLB_HOME` *is* the project repo — so
   the repo can't root there. Instead **all** memory consolidates under **`MemoryCfg.memory_dir`** (default
   `$CTRLB_HOME/memories/`, configurable/relocatable), which is the git repo root: default `memory_dir/MEMORY.md`
   + `memory_dir/USER.md`, specialists at **`memory_dir/agents/<slug>/MEMORY.md`** (moved from the old
   `agents/<slug>/memories/`; one-time startup migration, ~no-op). Each agent's location is overridable via
   **`AgentDef.memory_dir`** — but resolved **relative to the memory dir** (`..`/absolute rejected → safe
   default), so *every* memory file stays inside the one repo. Deliberate trade: memory leaves the agent
   workspace folder, for a single unified, versioned memory directory (the owner's framing + the Obsidian
   direction). **Secrets guard (mandatory, because the root is configurable):** refuse to enable the backup
   if `config_path()`/`db_path()` resolves *inside* the memory dir (a misconfigured `memory_dir: "."`); degrade
   to no-git, never crash, never leak. A defensive `.gitignore` (config.yaml/`*.db`/clients/`*_prompt.*`/OS
   junk/`.obsidian/workspace.json`) is written at init as belt-and-suspenders.

3. **Write + commit = one coupled, ordered, atomic unit.** All memory mutations serialize under a
   process-wide `asyncio.Lock` on the backup. Each mutation: `async with lock:` → **atomic file write**
   (temp in the *same dir* → `flush` → `os.fsync` → `os.replace`; POSIX parent-dir fsync best-effort; same-dir
   temp avoids the Windows `MoveFileEx` cross-volume non-atomic fallback) → `git add -- <path>` →
   `git commit -- <path>` (`run_capture` is async, so the subprocess never blocks the loop). The lock spanning
   write→commit guarantees the commit captures *exactly* that write's bytes. This makes `MemoryProvider.write`/
   `overwrite` **async** (`read_raw`/`load_context` stay sync). Contract: `commit()` assumes the lock is held
   (called from inside the provider's `guard()`); `reconcile()` acquires it (called from startup/sweep) — the
   lock is not reentrant.

4. **Capturing the owner's manual/external edits (the key requirement).** The owner *will* edit memory files
   directly (editor/Obsidian). Because app writes commit immediately and leave the tree **clean**, *a dirty
   tree is by definition an uncommitted external edit* — which removes the watcher's hardest problem
   (self-write suppression / infinite loops) and tilts the choice to a **dependency-free reconcile** over
   `watchdog`. Three mechanisms, all lock-serialized: (a) app writes → immediate commit; (b) **startup
   reconcile** → boot-time `git status` → commit edits made while down; (c) **periodic reconcile sweep** → a
   background `asyncio` task every `reconcile_interval_s` (default 120; 0 = off) → commit edits made while
   running. Reconcile enumerates dirty files via `git status --porcelain`, commits **per file**, dated to the
   file's **mtime** (`git commit --date=<mtime>`) so `git log` reflects when the edit actually happened.
   `watchdog` stays a documented future upgrade (only for sub-interval "instant" capture, which a backup
   doesn't need — even gitwatch/Obsidian-Git debounce to tens of seconds). Known polling limit: multiple edits
   to one file between sweeps collapse to the final state (a watcher wouldn't reliably differ).

5. **Per-change commits.** Each mutation is its own commit (max audit/restore granularity); deletions commit
   too (a blank `overwrite` → recoverable). etckeeper (change-triggered) is precedent; note-vault tools batch
   only to tame *human* edit noise, which our sparse machine-writes don't have. `git gc`/retention deferred.

6. **Reliability — best-effort, never blocks the data write.** A git failure is logged and swallowed; the
   memory write always succeeds (a partial add-without-commit just rides into the next commit/reconcile).
   Identity via `-c user.name/-c user.email` per invocation (**never** mutating global/repo config); commits
   are **content-free in the message** (`memory(<agent>): <action> <store>`) so nothing leaks via the log;
   local commits are network-free so they can't prompt; `run_capture`'s timeout is the hang backstop; lazy
   `git init -b main`; graceful no-op when `git` is absent. **Memory content is committed verbatim (NOT
   redacted)** — unlike `session_search`, redacting durable memory would corrupt it — so any future remote
   **must be private**, and `push` stays a **separate, opt-in, out-of-band** step (never in the write path).

7. **Pluggable seam + future capability.** A `MemoryBackup` protocol (default `GitMemoryBackup`; a no-git
   fallback) owns the lock + git; `FileMemoryProvider` calls it. Because the repo is the *whole* memory
   directory (the structured `memory` tool is just one writer into it) with per-path commits, a **future in-UI
   memory history / diff / restore** surface (Conf → Memory or a Tools-tab section) slots onto the same seam:
   read ops (`git log -- <file>`, `git show`, `git diff`) are additive lock-free methods, and **restore reuses
   the existing `overwrite` chokepoint** (`git show <rev>:<file>` → `overwrite`), so it needs no second
   mutating git path and inherits all the atomicity/commit guarantees. Curated typed endpoints, never a raw
   `git` passthrough (security model intact). Not built now — recorded so the seam is intentional.

**Config:** `MemoryCfg.memory_dir: str = "memories"`; `MemoryCfg.git_backup: MemoryGitCfg{enabled=True,
author_name, author_email, commit_timeout_s=10, reconcile_interval_s=120}`; `AgentDef.memory_dir: str|None=None`.
All read live (hot-toggle, no restart — the provider/backup read `Settings` per call, mirroring the rest of
the memory subsystem; no `runtime.reconfigure` wiring needed).

## D27 — Memory roadmap: store registry → `state.md` + periodic reflection (all opt-in) ✏️ DESIGNED 2026-06-25

The memory hardening (Slice 1: F1/F2/F3a/F5; Slice 1b: F6 unique-match + opt-in consolidation nudge; D26 git
backup) clears the way for two new memory subsystems the owner wants — an **emotional `state.md`** and a
**periodic "save anything worth remembering" reflection**. This entry locks their shape + the one refactor
they both need first. Web-validated 2026-06-25 (Hermes reflection mechanism, Letta/MemGPT memory-blocks, the
tanya emotional-state project). **None built yet** — recorded so the next slices slot in cleanly.

**Validation (why this shape is the robust, standard one).**
- **Hermes's every-10-turns reflection (confirmed):** *"Every 10 turns, Hermes runs an internal review of the
  recent conversation and asks whether anything should be saved to persistent memory"* — and it's **consent-aware**
  (`write_approval` stages the save for review). Maps 1:1 onto our turn-boundary nudge + `auto_write`-off→propose.
- **Letta / MemGPT** structures core memory as **labeled "memory blocks," each with its own char limit, that the
  agent self-edits via tools** — i.e. exactly the store registry below (`state.md` = a custom block). The tiered
  model (in-context core + searchable recall + archival) is what we already have (injected MEMORY.md +
  `session_search` FTS + the future vector tier).
- **tanya** (opxiahub/tanya) keeps emotional state as a **set-current-value** store (`state.json`: mood/energy +
  narrative `.md`), evolved by **scheduled background jobs**, not per turn — so `state.md` is overwrite-semantics,
  not append-facts, and is naturally driven by reflection/automation.

Three sub-slices, sequenced **A → B → C** (A is the prerequisite refactor; B/C build on it). Each is independently
shippable. The full file-level pre-flight is inline so the build can start cold.

> **Resolved sub-decisions (owner, 2026-06-25):** (1) **state writes auto-apply** — they bypass the `auto_write`
> propose-gate (an agent's own mood is not a fact-about-the-world that needs Approve; the gate is for durable
> facts). (2) **`state.md` IS backed up** in the D26 git repo like the other stores ("it's part of the memory
> system") — so `backed_up` defaults **on** for every store; the flag stays only as a future escape hatch for a
> genuinely ephemeral store. (3) Memory/state content is **never redacted** — `core/redact.py` masks config
> secrets only in *captured external output* (shell output, `session_search` snippets, event logs), which has
> untrusted provenance; the model's own curated memory/state is trusted and would be corrupted by redaction
> (D26's secrets-guard + private-remote rule cover the residual leak risk).

### A — Store registry (the prerequisite refactor; behavior-preserving, no data migration) ✅ SHIPPED 2026-06-25

**Shipped as a pure, behavior-preserving refactor — only `core/memory.py` + `services/agent/memory.py` touched.**
The two stores became registry entries (`MEMORY_STORE`/`USER_STORE`, both APPEND/FACTS); the provider iterates
the registry for path/cap/label resolution + `load_context` (PERSONA-first then FACTS, stable sort keeps
memory→user). `StoreSpec` carries **all** the fields B/C need (semantics, position, injected, writable,
backed_up) so they reopen `core/memory.py` for nothing — B just appends a SET/PERSONA `state` spec + a SET
branch in `write`. **Deliberately deferred to B (the owning slice), against this section's original pre-flight:**
the tool's `"set"` action, `state_char_limit` config, the store-keyed API route, the frontend `stateSlot` —
all dead scaffolding until a SET store exists. **Safety property held:** the four prior memory suites
(`test_memory_7e`/`_tool_7e`/`_panel_7e`/`_git_backup_d26`, 41 tests) pass **unchanged**; new
`test_memory_registry_d27.py` (5) pins the registry shape + that resolution matches the old hardcoded mapping.
Full backend suite 27 files green. Original design below (B/C still pending).

Today the two stores are hardcoded across ~6 sites. Replace that with one **registry** the code reads from. A
`StoreSpec` descriptor (pure, in `core/memory.py`):
`{key, label, scope: AGENT|GLOBAL, filename, semantics: APPEND|SET, position: PERSONA|FACTS, injected, writable,
backed_up}` — *structural* facts in code; the *tunables* (`enabled`, `cap`, `backed_up`) read live from `MemoryCfg`
so a Conf toggle hot-applies. The existing stores become two entries with **identical behavior**
(`memory`: AGENT/MEMORY.md/APPEND/FACTS; `user`: GLOBAL/USER.md/APPEND/FACTS, injection gated by
`user_profile_enabled`); the current memory tests must pass unchanged (that's the safety property). The
`MemoryProvider` protocol signatures **don't change** — `write(target,action,…)`/`overwrite(target,…)`/
`read_raw(target,…)`/`load_context` already take string `target`/`action`; only the impl generalizes.

**Pre-flight (A):**
- `core/memory.py` — add `StoreSpec` + `StoreScope`/`StoreSemantics`/`StorePosition` enums. Protocol unchanged.
- `services/agent/memory.py` `FileMemoryProvider` — new `_stores()` → `list[StoreSpec]` built from live `MemoryCfg`
  (memory, user, +state when `state_enabled`); new `_store_file(agent, spec)` generalizing
  `_memory_file`/`_user_file` (keep `_agent_memory_dir` for the per-agent path); `_target(agent, key)` → look up
  spec, return `(path, spec)`; `load_context` iterates injected stores **ordered PERSONA-first then FACTS**, header
  + nudge per store (fold the Slice-1b nudge loop in); `write` branches on `spec.semantics` (APPEND → current
  `§`/F1/F3a/F6 path; **SET → wholesale overwrite**, no `§`/cap-tidy logic — `content` *is* the new value);
  `overwrite`/`read_raw` look the spec up. **Decision: one injected block with persona-first ordering** (not a
  separate injection point) for v1 — splitting `state.md` to sit *physically* next to SOUL.md is a later `_assemble`
  refinement, not needed first.
- `services/agent/memory_tool.py` — `MemoryInput.action` gains `"set"`; `target` stays a `Literal` extended to all
  known keys (`memory|user|state`) for schema clarity, with `gate_memory` rejecting a disabled/unknown store and
  enforcing **action↔semantics** (set only on SET stores; add/replace/remove only on APPEND); the user-profile gate
  generalizes to per-store `enabled`. The tool body **skips the propose-path for SET stores** (state auto-applies).
- `config.py` `MemoryCfg` — caps stay flat for now (`memory_char_limit`, `user_char_limit`, +`state_char_limit`);
  note the future `stores: {key: {cap, enabled, backed_up}}` map as the seam if stores grow past a handful.
- `api/agent.py` — **API-shape decision:** generalize the two memory endpoints to a store-keyed route
  (`GET/PUT /api/agents/{name}/memory/{store}` for AGENT stores; keep `/api/memory/user` or move to
  `/api/memory/{store}` for GLOBAL) so the Conf panel can edit `state.md`; update the two callers. (Old routes can
  stay as aliases to avoid a frontend big-bang.)
- `services/agent/memory_backup.py` — `backed_up=False` (future) means that store's filename is added to the repo
  `.gitignore` so reconcile/commit skip it. **No change now** (all stores backed up); the `.gitignore` template is
  the seam.
- Frontend `hooks/useMemory.ts` + `components/MemoryEditor.tsx` — slots become registry-driven (add a `stateSlot`,
  gated `state_enabled`); `MemoryCfg` type gains the new fields; `MemoryEditor` renders the state row + its cap, and
  the reflection controls (C); `ConfTab` default `memoryCfg` literal gains the new fields.

### B — `state.md` (emotional/affective state, opt-in) ✅ SHIPPED 2026-06-26

**Shipped + deep-audited (independent adversarial review + a concurrency regression test).** The
registry constants moved to `core/memory.py` (`STORES` + `store_by_key`) — the single spine shared by
the provider, the `memory` tool, and the memory API. `state` is registered as SET/PERSONA, opt-in via
`MemoryCfg.state_enabled` (default off), cap `state_char_limit≈600`, auto-applies (bypasses the
`auto_write` propose-gate). `write` branches on `spec.semantics` (SET → wholesale `content`, no
`§`/`_tidy`; APPEND unchanged), sharing the F1 growth-guard. The tool gate enforces action↔semantics
(`set`↔SET, add/replace/remove↔APPEND) + the per-store enable gate. New store-keyed API route
`GET/PUT /api/agents/{name}/memory/{store}` (AGENT stores, registry+scope-validated → 404; bare
`/memory` stays the `memory` alias; `/memory/user` stays for the lone GLOBAL store). Frontend: Conf →
Memory gains an "Emotional state" toggle, a gated "State cap" field, and per-agent `· state` file rows.
Routing is decoupled from enablement — a disabled store still resolves to its own file (never
misroutes), gated only at injection (`load_context`) and writes (the tool gate).

> **Audit fix (BLOCKER, folded in): `write` is now a race-free read-modify-write.** The audit found a
> *pre-existing* (D26-introduced) lost-update: D26 moved only the file *write* under the backup lock,
> leaving the *read* outside it, so under contention (≥2 subagents writing one file, or any write
> arriving while the 120s `reconcile()` sweep holds the same lock) the second writer merged against a
> stale body and silently clobbered the first — and the F5 docstring wrongly certified it safe. Fix:
> the whole read→merge→cap-check→write→commit runs inside one `async with backup.guard()` (the merge
> extracted to a pure `_merge` staticmethod). Proven by `test_memory_concurrency_d27` (pre-holds the
> lock to force the interleaving; verified non-vacuous — it loses an update on the old code). Two MINORs
> also fixed: the cap-error remediation is now semantics-aware (a SET store says "send a shorter value",
> not "remove entries"); the `_cap_for`/`_store_enabled` per-store wiring has a **drift-guard test** +
> an "adding a store" touch-point checklist at the `STORES` registry (the flat-caps→`stores:` map stays
> the D27-deferred seam, not built — only 3 stores).

**Original design (still the spec):**

One registry entry: `state` = AGENT / `STATE.md` / **SET** / **PERSONA** position / injected + writable, gated by
`MemoryCfg.state_enabled: bool = False`, `backed_up=True`. **Free-form markdown the model rewrites** (e.g. a short
"Mood / Energy / Lately …" — tanya is hybrid JSON+md; start free-form, add a structured header later only if
wanted), small cap (`state_char_limit`, ~600). **Read** every turn via `load_context` (persona-first), fresh from
disk, gated by `state_enabled`. **Written** set-value via `memory(target="state", action="set", content=…)` →
`overwrite` under the D26 lock; **auto-applies** (no propose-gate, owner decision). When written: model-driven (the
model decides its state shifted) + reflection-driven (C) — **not** every turn (would churn the file + git). Conf →
Memory gets a state row + a cap field, gated by the toggle. Tests on a temp workspace (set round-trip, persona-first
injection, auto-apply with `auto_write` off, backed-up commit).

### C — Periodic reflection ("save anything worth remembering" every N turns, opt-in, Hermes-style) ✅ SHIPPED 2026-06-26

**Shipped.** `MemoryCfg.reflection_enabled` (default off) + `reflection_interval` (default 10, `ge=1`).
`MessageRepo.count_user_messages` counts user messages **including compacted ones** (compaction-stable —
the cadence can't drift as history folds). `AgentSession._maybe_arm_reflection` (called from `run_turn`
*after* the user message is persisted, so the count includes it → every Nth turn) sets a per-turn
`_reflect_now` flag when `enabled and reflection_enabled and count % interval == 0`; `_assemble` then
injects one reflection `system` message **after the skills note** (the existing seam). The resume path
doesn't re-arm (reflection is turn-start, not mid-turn), and `_finalize` clears the flag (its forced
wrap-up call is tool-less — it must not carry a "use the `memory` tool" nudge). The nudge's `state`
clause appears only when `state_enabled`. **No special propose handling** — reflection only *steers*;
the resulting `memory` saves ride the normal `auto_write` path (on → saved, off → proposed via the 7e-f
Approve UI), and `state` saves auto-apply, all unchanged. **Proposal-batching when `auto_write` is off
was the one open sub-decision → resolved as NOT built** (each `memory` call already yields its own
proposal bubble; batching is a UI nicety, deferred). Frontend: Conf → Memory gains a "Periodic
reflection" toggle + a gated "Reflection interval" field. Tests: `test_reflection_d27` (9). Backend 30
test files green; frontend build + 85 unit + 32 e2e clean. **D27 complete (A+B+C).**

> **Audit fixes (independent review, folded in before push).** (1) **One-shot (MAJOR).** The nudge was
> re-injected on *every* `_drive` iteration of the firing turn (the flag only cleared in `_finalize`),
> so a weak model could re-save each round-trip (a reworded save dodges the loop-guard's exact-arg
> dedup). Fixed: `_assemble` now **consumes** `_reflect_now` on first injection → exactly one model call
> per firing turn. (2) **Subagent scope (MINOR).** `run_subagent` calls `run_turn`, so a headless
> subagent (which *can* write memory) would reflect on its throwaway archived thread; at `interval=1`
> every subagent turn would fire. Fixed: `_maybe_arm_reflection` gates on `self._depth == 0` (top-level
> conversation only). Both locked by new tests (`test_reflection_is_one_shot_per_turn`,
> `test_reflection_skipped_for_subagents`). **Verified-clean by the review:** count correctness +
> compaction-stability (compaction marks `compacted=True`, never deletes; the summary is `role=system`),
> gating order (no DB query when disabled), `_finalize` exclusion, frontend field-name wiring. Accepted
> as-is: a turn that *suspends* before the model acts on the nudge drops that reflection (resume doesn't
> re-arm — consistent with "reflection is turn-start"); the "{interval} turns" wording on later firings
> (cosmetic).

**Original design (still the spec):**

`MemoryCfg.reflection_enabled: bool = False` + `reflection_interval: int = 10`. At turn start, count the thread's
**total** user turns — **stable across compaction**, so a dedicated count (e.g. `MessageRepo.count_user_messages`
or `list(include_compacted=True)`), *not* `_assemble`'s `include_compacted=False` history (which under-counts).
When `enabled and count>0 and count % interval == 0`, set a per-turn flag → `_assemble` injects a **reflection
nudge** `system` message at the existing injection seam (after the skills note): *"It's been N turns — review the
recent conversation; if anything is durably worth remembering, save it with the `memory` tool (and update your
`state` if it shifted); otherwise continue."* With `auto_write` **off**, the resulting memory saves become
**proposals** (7e-f-3 Approve UI = Hermes's `write_approval`); state saves still auto-apply. **Open sub-decision for
build:** batch a reflection's multiple proposals vs one Approve bubble each. The hardening is the safety net under
this — reflection drives *more* writes, so F1 (dig-out), F6 (unique-match), the nudge, and the git backup all matter
more. **Pre-flight (C):** `config.py` (2 fields); `services/conversation.py` (`MessageRepo` count helper);
`services/agent/session.py` (`run_turn`/`_assemble` count + conditional nudge injection); frontend toggle + interval
in `MemoryEditor`; tests (fires at the interval, silent when off/off-interval).

**Settings summary (all opt-in; the new subsystems default off, like the nudge):** `consolidation_nudge=False` +
`consolidation_nudge_pct=80` (**shipped**, Slice 1b); `state_enabled=False` + `state_char_limit≈600` (slice B);
`reflection_enabled=False` + `reflection_interval=10` (slice C). Each gets a Conf → Memory control. **Remaining open
sub-decisions, to settle at build:** the `api/agent.py` store-keyed route shape (generalize vs add aliases); the
reflection proposal-batching when `auto_write` is off.

## D28 — Theme engine: a pluggable presentation layer (registry + slots + semantic tokens) over the frozen vapor original ✏️ DESIGNED 2026-06-26

The owner built six full single-file theme prototypes (`prototypes/project/variations/*.html`) and wants the app to
switch between distinct, pixel-faithful design systems — not palette swaps. The prototypes **restructure
components** (cosmos = orbital fleet; frontier = comic art-map + beacons + bottom-sheet; observatory = SVG
topology), load **their own fonts**, define **disjoint token namespaces**, and carry **richer palette models**
(minimal = light/dark × 4 OKLCH hues). This entry locks the architecture. The full code-level spec + porting
playbook live in **[`THEME_ENGINE.md`](./THEME_ENGINE.md) §§9–10**; the TODO slices are **Phase 11 (T0–T5)**.

> **✏️ AMENDED 2026-07-06 (→D34): "frozen" is a phase, not an identity.** Owner directive — vapor will
> eventually assimilate into the engine as a normal, contract-conformant theme. Its freeze reduces to six
> enumerated legacy hooks retired by the per-component graduation ladder in `THEME_ENGINE.md` **§14.15.3**
> (standing guarantees: nothing new depends on a legacy hook; exemptions live in shrinkable waiver lists;
> engine code uses `DEFAULT_THEME`, never `"vapor"` literals). D28/D29's freeze language governs each
> surface only until it graduates.

> **✅ T0 (the engine; vapor untouched) SHIPPED 2026-06-26.** The `@layer` isolation strategy is build-verified
> (Vite preserves `@import … layer()` → no `cb-` fallback needed); `theme-engine/` (registry + slots +
> `ThemeProvider` + cached resolution), the vapor module (existing components as slots, frozen), the `App.tsx`
> slot host, the `{theme,mode,accent}` `ui` store (+ legacy remap + `data-skin`), the registry-driven Conf
> Appearance picker, the View-Transition `switchTheme` path, and **cross-device sync** (`AppearanceCfg` +
> `GET /api/appearance` + optimistic write + reconcile + no-FOUC body-top script) are all in. **Acceptance met:
> vapor renders byte-for-byte unchanged** (frozen files git-confirmed untouched; CSS bundle hash stable). Green:
> frontend 92 unit + 32 e2e, backend 31 test files. One implementation refinement beyond the spec wording: the
> reconcile keeps the local selection when the server is unwritten (`updated_at=null`) rather than reverting to
> backend defaults. **Next: T1 (minimal — BASE chrome + OKLCH mode×accent matrix).** Remaining T-slices below.

**Validation (web-cited; full citations in THEME_ENGINE.md research).** Token/provider theming covers *aesthetics
only, not structural composition* (Brad Frost's themeable-systems taxonomy) — structural divergence per theme needs a
**theme-keyed component registry / headless-core + skin** split (Harry's "Forge" ships a popup cart vs a sidebar cart
from one logic layer = our "fleet as rows vs planets vs map"). **CSS:** per-theme **plain `.css` bundles, dynamic-
`import()`'d, scoped by **`[data-skin]`** (a NEW identity attr, not `data-theme` — §13.1)** is the most prototype-faithful + lazy-loadable strategy (Vite `cssCodeSplit`
guarantees the `<link>` loads before the chunk → no FOUC); CSS Modules / CSS-in-JS both *rename selectors* → increase
drift, and CSS-in-JS is in maintenance mode + RSC-hostile. **Tokens:** three-tier semantic contract; the **flat-vs-
gradient accent** problem is real (a gradient is an `<image>`, not a `<color>`) → **two channels** (`--accent` color +
`--accent-fill` flat/gradient + a `::before` glow). **Per-host presentation:** Presenter/View-Model (derive visuals
at render, don't store) + data-viz encoding-channels + "extend, not migrate" all converge on a **theme-owned pure
`present()` + one open namespaced `host.appearance` override** (corroborated by OpenAPI `x-` extensions, K8s
annotations, Pydantic `extra='allow'`; a discriminated union keyed by themeId is the anti-pattern — it forces a server
change per theme). Zero-config defaults via **golden-angle placement (137.5°) + hash-to-palette** (GitHub-identicon
lineage).

> **Resolved decisions (owner, 2026-06-26):**
> 1. **Scope:** minimal + phosphor + cosmos + frontier in scope; **observatory low-priority (port last** — its
>    prototype isn't finished). **vapor FROZEN** (the refined "v1 / pre-themes" original); vapor-proto dropped.
> 2. **Shared base + per-theme slot overrides** (the main granularity call): **one** new token-driven *base* chrome
>    shared by all four non-vapor themes; each theme owns only what it *restructures*. Not full duplication; not
>    base-for-reskins-only. Bias to faithful duplication only where a theme genuinely restructures (its slots).
> 3. **vapor = default *selection*, NOT the structural *fallback*.** vapor is registered as a **fully self-contained
>    module that overrides every slot** with its frozen components (never leans on base); unconfigured app → vapor.
>    The **slot-resolution fallback is the BASE** (minimal is base made concrete); a missing slot on any *other* theme
>    → base, never vapor. ("vapor as-is, like a pre-themes version; all themes slot in regardless.")
> 4. **Tabs:** v1 = all themes mirror vapor's **4 tabs**, but the engine carries a **flexible tab registry** — a
>    theme can later declare more/fewer tabs (and current tabs stay editable) **without breaking other themes**.
> 5. **Per-host presentation:** theme-owned `present(host,index,override?)` + **derive-by-default** (golden-angle +
>    hash palette) + **optional `host.appearance:{<themeId>:blob}}` override** (open pass-through on the backend, no
>    migration; field defined day 1). frontier art = built-in drawing set by index **+ a per-host `image` override,
>    both built in T5** (no deferred half — owner 2026-06-26).
> 6. **Persistence + cross-device sync = BUILT DAY 1** (owner 2026-06-26 pulled this forward from a deferred seam —
>    "build the complete feature from day 1 to avoid refactors"). Backend-authoritative **server-stamped LWW**;
>    localStorage = instant cache + offline truth; `appearance` block in the Settings config (`PUT /api/settings`
>    deep-merge) + a **lightweight always-on `GET /api/appearance`** (the full settings doc is Conf-tab-scoped → can't
>    drive first-paint/reconcile); inline `<head>` no-FOUC script + compare-then-set reconcile; optimistic write,
>    `scope`-serialized PUT, offline pause/resume. No CRDT/clocks/ETag/Background-Sync (over-engineering for one user).
>    Web-researched (TanStack persistence/optimistic, offline-first SWR, next-themes). Full spec THEME_ENGINE.md §9.11.
> 7. **Theme-switch animation = BUILT DAY 1** (View Transitions API; owner 2026-06-26). Stable `flushSync` +
>    `document.startViewTransition` pattern, lazy-load **before** the transition, gated on `ui.motion` + feature
>    detection (no-support/reduced → instant swap), default full-page cross-fade. Web-researched; React's experimental
>    `<ViewTransition>` left as a future migration. Full spec THEME_ENGINE.md §9.12.

**The architecture (one line each).** A `ThemeProvider` reads `ui.{theme,mode,accent}`, lazy-loads the active theme's
CSS+fonts, and resolves component **slots** from a typed `ThemeRegistry` (`resolveSlot(name) =
registry[theme].slots[name] ?? BASE.slots[name]`); `App.tsx` becomes the slot host. **vapor's *components* +
`vapor.css` are untouched** — only the shell orchestration generalizes, so vapor renders **byte-for-byte
identically** (the T0 acceptance test). Non-vapor themes = self-contained modules: a `[data-skin]`-scoped lazy
`tokens.css` (in a CSS `@layer` above frozen vapor) mapping the **semantic contract** (`--surface*/--text*/--line*/--ok/--warn/--danger/--accent/
--accent-fill/--accent-soft/--accent-glow`), their fonts (Fontsource, FontFace-API-activated), assets
(`import.meta.glob`), a declared `palettes` axis set (mode? accent? named?), `present()`, `tabs[]`, and **slot
overrides only for surfaces they restructure** (FleetView always; HostDetail for cosmos panel / frontier bottom-sheet).
The shared **NowMonitoring + Waveform** featured-host slot is built once (recurs in minimal/cosmos/frontier).

**Why this is the robust shape (not the expedient one).** Adding or re-syncing a theme is **one registry row + one
self-contained module + one verbatim scoped `.css`** — the north star. vapor is isolated by construction (complete on
its own → the engine never substitutes a base part into it), so "frozen" is structural, not a discipline we have to
remember. The per-host `appearance` field is a single additive optional object (the precedent set by Phase-8
`tool_overrides`, the inverse of the `tool_descriptions{}`+`tool_agent_mode{}` sibling-map anti-pattern) — every future
theme's per-host visuals are additive, never a migration.

**Open sub-decisions, to settle at build (not blocking T0):** (a) the slot-component prop contracts (`HostDetailProps`/
`ChatBubbleProps`) — finalize against the base implementation in T0/T1; (b) theme-switch `<link>` teardown (Vite leaves
inactive bundles' links in place — inert under `[data-skin]` scoping; a teardown is a cheap future optimization, skip
in v1); (c) cosmos central-body identity ("moon" vs the prototype's coin/"All systems" home control — cosmetic, confirm
at T4); (d) exact `present()` derivation constants per spatial theme (golden-angle radius coefficient, palette size) —
tune at T3/T4 against the prototypes.

**Pre-flight (T0, read before building):** `THEME_ENGINE.md §§9–13`; `store/ui.ts` (the `applyBodyAttrs` chokepoint +
`loadPersisted`); `App.tsx` (the tree that becomes slot-driven); `main.tsx` (static vapor import → layered `theme/index.css`);
`tabs/ConfTab.tsx` Appearance group (`Seg<Theme>` → picker); `theme/vapor.css` + `extras.css` (read-only — the frozen
reference). **D7 pixel-fidelity now applies per theme.** Touch list: THEME_ENGINE.md §9.13; **build checklist: §13.**

**Final adversarial review (2026-06-26) — sound architecture, spec corrected.** Two streams (design-vs-code + web-cited
best-practice) **validated the architecture as the robust/efficient/reliable option** (registry+slots, `[data-skin]`-scoped
lazy CSS, semantic tokens + two-channel accent + OKLCH, `present()`+open-override). They found **two vapor-breaking bugs**
and robustness gaps in the spec *wording*, all now fixed (THEME_ENGINE.md §§9.6/9.8/11–13):
- **(CRITICAL) `data-skin`, not `data-theme`, carries the ThemeId.** vapor.css gates aqua/ember on bare
  `[data-theme="aqua"|"ember"]` — overloading the attribute would silently kill 2 of vapor's 3 palettes. ThemeId →
  new `body[data-skin]`; `data-theme` stays vapor's frozen accent axis. (§13.1 has vapor's full attribute contract.)
- **Trivial `ui`-store persisted-shape remap (low-stakes — single user).** `loadPersisted`'s field-fill merge
  can't remap a value, so legacy `theme:"aqua"` → `{theme:"vapor", accent:"aqua"}` via a ~3-line read-time
  remap. Not a robustness pillar (no returning-user base) — just so the owner's own localStorage doesn't read
  back an invalid `ThemeId`. (§13.4.)
- **(KEYSTONE hardening) CSS `@layer`** cages the always-loaded frozen vapor/extras in `layer(frozen)` so an active
  theme wins by **cascade order, not specificity** — dissolves the `--line`/`--line-2`/`--accent-glow` token collision
  *and* the global class-name collision **without editing the frozen files** (assign via `@import "./vapor.css"
  layer(frozen)`; `!important` audit = 4 rules, all vapor-only selectors → safe). **T0 must `vite build`-verify the
  bundler preserves `@import … layer()`; else fall back to `cb-` namespacing.** (§13.2–13.3.)
- **Plus:** React 19 `precedence`/`preinit` + `startTransition` for FOUC (§13.5); App.tsx must preserve the lazy-Conf /
  `--appbar-h`-ref / `showComposer`→`TabDef.hasComposer` / tab-container show-hide orchestration (§13.6); shared Waveform
  needs a `--accent-rgb` canvas channel (§13.7); BASE TabBar indicator is tab-count-driven (§13.8). Adopt container
  queries + same-document View Transitions; module-level slot map (avoid context fan-out). Full list: THEME_ENGINE.md §12.

## D29 — Theme engine v2: headless controllers + theme-owned `Root` + optional Kit (supersedes D28's fixed-slot model) ✏️ LOCKED 2026-06-26

**Why this supersedes D28's slot model.** D28 shipped T0 with the app owning the skeleton (appbar+tabs+composer+tabbar)
and themes filling **7 fixed slots**. The owner clarified the real requirement: a theme must be able to **restructure,
relocate, hide, or add** any element (e.g. "minimal hides the appbar", "frontier's chat tab has animated squares") while
**full functionality stays reachable** — the fixed-slot layout structurally prevents that. So we **invert ownership**:
the **theme owns the entire presentation tree**; the app owns **functionality as headless controllers + shared state**;
an **optional Kit** supplies reusable token-driven presenters so reskin-class themes stay cheap. Web-researched +
grounded in the headless-component pattern (Radix/TanStack/Headless UI), theme-as-plugin (layout not just color), and
3-tier design tokens (global→semantic→component). Full spec: **THEME_ENGINE.md §§14+**.

> **Owner decisions locked (2026-06-26):**
> 1. **vapor is migrated as a normal theme** (NOT frozen-and-separate) — it's just the most-complete + currently the only
>    fully-functional one, so it **stays the default until each other theme is verified**. No special-casing; vapor is a
>    peer `ThemeDef` (its own `Root` + scoped CSS + palettes).
> 2. **Only the Fleet tab deviates structurally per theme** (the signature surface), **+ frontier's Agent tab** (bespoke
>    animated chat). Everything else — appbar, nav, composer, Agent (non-frontier), Tools, Conf incl. all editors — is the
>    **same functionality/structure as vapor, restyled** per theme. Per-theme Fleet (and frontier Agent) get an **eyeball
>    pass** to decide what host data each shows.
> 3. **Robust + efficient + long-term, no future refactor** is the explicit bar. Adding a theme = one `ThemeDef` + `Root`
>    (or `DefaultRoot` config) + scoped `tokens.css` + fonts + a Fleet view. Zero app/core/backend change.

**The architecture (four layers).** (1) **Core** — TanStack hooks, stores, API client (unchanged, theme-agnostic). (2)
**Feature controllers** — headless hooks (`useFleet`/`useAgentChat`/`useComposer`/`useSections`/`useAppChrome`/…) returning
state+actions, **zero markup**, **store-backed** (so multiple presentation instances share state and it survives a theme
switch). (3) **Theme presentation** — each theme's **`Root`** owns the whole body, composing controllers + Kit + bespoke
elements. (4) **The Kit** — optional reusable token-driven presenters (`DefaultRoot` scaffold, AppBar, NavBar, Composer,
ConfShell, device rows, NowMonitoring, ChatBubble, primitives) + the **semantic token contract**. Reskin themes reuse the
Kit + a `tokens.css`; bespoke themes write their own `Root`.

**The core invariant (prevents future refactors): state ownership.** All state that must survive a theme switch or be
reachable by multiple parts of a presentation lives in a **controller/store mounted ABOVE the theme `Root`** (in `App`),
never in a theme component's `useState`. A theme switch then remounts **only** presentation — no refetch, no lost state.

**Theme contract (`ThemeDef` revised).** `{ id, label, Root, palettes, loadStyles, loadFonts?, present?, settings? }`.
`settings` is a **theme-namespaced options schema** (the "minimal hides the appbar" mechanism) — declared by the theme,
auto-rendered by the Appearance picker, stored in a `ui.themeSettings[id]` open map, **synced** via the appearance
channel; read with `useThemeSetting(id, key)`. Tabs/slots/`hasComposer` stop being engine concerns (theme-internal now).

**CSS isolation — `@scope` (Baseline Newly-Available, Dec 2025).** Each theme's CSS is wrapped in
`@scope ([data-skin=X]) { … }` so only the active skin's rules match (themes can't bleed into each other even if bundles
coexist during a switch). **vapor.css stays verbatim except a handful of scope-root selectors** (`:root`→`:scope`,
`body[data-theme=aqua]`→`:scope[data-theme=aqua]`) — far lower risk than a PostCSS prefix transform (research confirmed
prefix-plugins mishandle exactly `:root`/body-level/`@keyframes`). `@layer base, theme` still orders Kit-vs-theme
overrides. **Default theme (vapor) CSS eager** (static import, no first-paint FOUC); others lazy (Vite guarantees
async-chunk CSS loads before eval). A non-default returning user gets **one** View-Transition switch on cold load
(accepted — single user, PWA-cached, matches the §9.11 reconcile model). **`@scope` survival through the bundler gets a
build-verify gate at M1** (mirrors T0's `@layer` gate).

**What survives from T0 vs what's replaced.** *Survives:* `ThemeRegistry`, `ThemeProvider`, `ui`-store `{theme,mode,accent}`,
cross-device sync (`AppearanceCfg` + `GET /api/appearance` + reconcile), the View-Transition `switchTheme`, the inline
no-FOUC script, the `@layer` cage concept. *Replaced:* the 7-slot `ThemeSlots` + `useThemeSlot` + App-as-slot-host →
the `Root` + controllers model (the slot idea survives *inside* the Kit's `DefaultRoot` as an impl detail).

**Vapor migration — verify-at-every-step runbook (the careful part; full detail THEME_ENGINE.md §14.x).** The risk is
regressing the only working theme, so it migrates in independently-verifiable stages, full suite (92 unit + 32 e2e) +
390px eyeball green at each: **M0** shell inversion (`App`→thin host renders `<VaporRoot/>` composing existing vapor
components verbatim — **byte-identical** acceptance); **M1** the `@scope` CSS-scoping gate (scope vapor.css, byte-identical);
**M2** controller extraction **one feature at a time** (vapor's components consume them, verify after each — composer
prefix-routing + agent tool-loop get extra scrutiny); **M3** register vapor as a `ThemeDef` + per-theme settings. Only
then build the Kit + minimal on the proven framework.

> **✅ M0–M3 COMPLETE (2026-06-26) — the vapor migration runbook is done; vapor is a fully-migrated peer `ThemeDef`,
> still the default.** M3 built the **per-theme settings mechanism** (the reusable "minimal hides the appbar" machinery):
> `ThemeDef.settings` = a namespaced schema (`{type:"switch"|"seg", label, desc, default}`, the VS-Code `configuration`
> contribution-point model, web-researched + owner-confirmed); values in the open `ui.themeSettings[id]` map (additive,
> `setThemeSetting`); `useThemeSetting(id,key)` resolves override→default; the Conf Appearance picker **auto-renders** the
> active theme's settings (adding a theme's option = zero Conf/core/backend change). vapor's `skyline/loz/heroOn/waveformOn`
> moved out of core `UIState` into `vapor.settings` (VaporRoot owns the `body[data-skyline]/[data-loz]` write); a one-time
> `migrateVaporSettings` folds the legacy localStorage shape. **`motion`+`perf` now sync** cross-device (owner directive:
> device levers kept consistent) — folded ADDITIVELY into the LWW appearance channel with the new `theme_settings` map (wire
> snake / store camel, bridged). **Robustness catch (independent audit):** the new `AppearanceCfg` fields default to **`None`
> ("unseeded"), not their UI defaults** — else a pre-M3 stamped config would look *authored* and the LWW reconcile (`?? local`)
> would wipe the owner's local reduced-motion / lite-blur / migrated per-theme prefs on the first upgrade load (guarded by two
> reconcile tests). **Latent T1 follow-up deferred to its owning phase:** a self-initiated skin pick double-fires
> `switchTheme` (optimistic write re-reconciles during the async bundle-load) — unreachable while vapor is the only theme;
> gate on `useIsMutating` when the first non-vapor theme lands. **NEXT = Kit + minimal.**

> **✅ K1 DONE + Kit CSS architecture locked (research-backed, 2026-06-27).** K1 landed the engine plumbing: the semantic
> token contract (`kit/tokens.css`, `@layer base`), the `minimal` theme module (OKLCH mode×4-accent `tokens.css`,
> Fontsource fonts, `Root=DefaultRoot`, settings `hideAppbar`+`density`), and a cold-load fix (`ThemeProvider` loads the
> active theme's lazy CSS/fonts on mount). vapor verified computed-identical. **The Kit CSS model is locked (full detail
> THEME_ENGINE §14.4.1), web-researched against Radix Themes + the design-token consensus:** reskin themes contribute
> **only a `tokens.css`** (token-only theming — per-theme component-CSS overrides are the discouraged/brittle path); the
> Kit ships **one** component stylesheet scoped under a **`.kit` marker** on `DefaultRoot`'s shell (= Radix's
> `.radix-themes`), in `@layer base`, so it can't leak into vapor (the bespoke escape hatch, no marker). Kit components
> are built lazily-by-need (`NowMonitoring`/waveform deferred — minimal dropped the monitoring section). minimal: Dark/
> Light only, no Auto. **A `coding-discipline` PRE-FLIGHT hook (`UserPromptSubmit`) + a strengthened audit POST-FLIGHT
> hook (`PreToolUse` git-commit) now reliably trigger the read→research→confirm and the independent audit passes** — see
> `.claude/settings.json`.

**Edge cases locked (the systematic sweep).** Hide-a-control (capability stays in its controller); relocate composer
(keyboard-aware viewport hook); theme-specific anims (own effects/cleanup, `ui.motion`-gated); alt navigation
(`useSections`); broken theme `Root` → ErrorBoundary offers **revert to vapor**; global overlays → Kit/token-driven;
StrictMode effect-cleanup; PWA precache of lazy theme chunks; a theme omitting a section (default to first rendered).
Full table: THEME_ENGINE.md §14.

**Build order.** M0→M3 (vapor) → Kit + minimal → T2 phosphor (cheap) → T3 observatory (low-pri) → T4 cosmos → T5
frontier (bespoke Agent). D7 pixel-fidelity per theme; pause for the owner's 390px eyeball after each.

## D30 — Composer composition: a base variant + slot addons, both theme-selected (composition over configuration) ✏️ LOCKED 2026-06-28

> ⚠️ **VARIANT SELECTION SUPERSEDED by D31 (2026-06-29).** D30's *composition-over-configuration* principle (variant
> + orthogonal slot addons, all over the headless `useComposer()`) **stands**. What changed: the variant is **no
> longer chosen by a `DefaultRoot Composer=` prop** — it's a **user-selectable Surface** (a `composerVariants`
> registry + a per-theme `composer` `seg` setting + the `ThemedComposer` resolver; D31/§14.14). `composerSlots`
> (the addon axis) **stays** a `DefaultRoot` prop. Build per `COMPOSER_SURFACE_PLAN.md`. Read references to
> `Composer={…}` below as historical.
>
> ✅ **BUILT 2026-07-11 (`COMPOSER_SURFACE_PLAN.md` A1–A4 + C).** The deferred list below is done: SheetComposer
> is the real docked variant; the live user-setting exists (catalog `[stacked, borderless, ghost, sheet, line]` since Phase E;
> **F5 slice B [2026-07-15, D37] DEDUPED it to `[stacked, sheet, line]` — borderless/ghost were chrome, now the
> `glass`/`sleek` skins of the orthogonal `composerSkin` axis**).
> **Two as-built updates:** (1) "Where the plan renders, per theme" is now itself a per-theme USER SETTING —
> `planPlacement` (`inline` = the pill+sheet in the composer, composition now OWNED by `DefaultRoot`, themes no
> longer pass `composerSlots` for it · `pinned` = the Kit `PinnedPlanPanel` at the top of the Agent tab,
> mounted by `AgentTab`, generalizing vapor's pin site). Vapor's frozen `.plan-pin` is unchanged. (2) The
> `composerSlots` prop is currently UNUSED (the future theme-addon seam; a slot-merge with the inline plan
> arrives with the first second contributor — ROADMAP A7, rule of three).

**Why.** The owner wants themes to pick a **composer style** (the kit stacked composer · eventually a vapor-style "peek" composer · future styles) AND optionally layer **features** on top (the plan pill · future addons) — "either the base composer or the one with the plan pill, and use one or the other in future themes." A boolean-config composer (`<Composer plan sheet …>` with internal `if` branches) doesn't scale; the established React answer (Radix/Headless UI/React Aria, web-researched) is **composition over configuration** via **slots + variants**. It also reuses a seam this repo already has: `DefaultRoot` injects per-theme pieces by prop (`Fleet`).

**The model — two orthogonal axes, both theme-selected via `DefaultRoot` props:**
- **STYLE = the composer VARIANT** (`ComposerVariant` = `ComponentType<ComposerSlots>`). `KitComposer` (stacked, default) · the stubbed `SheetComposer` (vapor-peek, future) · … . Every variant shares the **headless `useComposer()`** controller — only markup/style differ, so a new style is a new component, never new logic. Selected via `DefaultRoot Composer={…}` (defaults to `KitComposer`).
- **ADDONS = `ComposerSlots`** composed INTO the variant: `{ controlsStart?, overlay? }`. The variant decides WHERE each slot renders (its layout); the theme decides WHAT fills it. A new addon adds a named slot — purely additive, no churn. Selected via `DefaultRoot composerSlots={…}`.

So the four cases fall out with no special-casing: base = `<DefaultRoot/>`; base+plan = `composerSlots={kitPlanComposerSlots}`; peek = `Composer={SheetComposer}`; peek+plan = both. (A future *live user-setting* to switch styles is a thin id→component registry on top — the injection is the foundation.)

**The plan-pill addon (first consumer).** Self-contained + store-backed so the slot nodes are STATIC (no state in the Root → toggling never re-renders the app shell): `PlanPill` (in `controlsStart`) + `PlanSheet` (in `overlay`, a frosted panel that PEEKS up from the composer's top edge — a *sibling* of `.kit-composer` so the composer's rounded top tucks the sheet's bottom; a child would paint in front). Both **self-subscribe** to `useCurrentPlan()` (memo-stable snapshot → the shared composer doesn't re-render per streamed token) + the `planSheet` open-store, and render `null` when there's no plan. Plan derivation stays in ONE place (`lib/plan.ts currentPlanOf`; `pairResults` delegates); the checklist is the shared `components/PlanSteps`.

**Where the plan renders, per theme.** KIT themes → the composer (this decision). **Vapor → its frozen in-tab `.plan-pin`/`.plan-drop`** (extras.css), gated in `AgentTab` by `theme === "vapor"` — D7, untouched. Moving the frosted plan OUT of the kit Agent tab is what let the Agent tab run its `kit-fade` entrance again (a `backdrop-filter` can't composite cleanly under an animating ancestor). Cosmos additionally **auto-collapses** the plan sheet when its host detail sheet opens (the sheet's downward slide-close reads as sliding away with the composer, which cosmos hides via `body[data-sheet=open]`).

**Files.** `theme-engine/kit/composer/` (`Composer.tsx` variant + `types.ts` `ComposerSlots`/`ComposerVariant` + `SheetComposer.tsx` stub + `plan/{PlanPill,PlanSheet,index}`); `components/PlanSteps.tsx`; `store/planSheet.ts`; `store/chat.ts` `useCurrentPlan`; `lib/plan.ts` `currentPlanOf`. Contract detail: **THEME_ENGINE.md** (composer variants + slots).

**Deferred (seams ready).** `SheetComposer` styling (vapor-peek look, no drag — reuse `useComposer`); a live composer-style user-setting; the keyboard+plan-sheet scroll hardening (ISSUES.md — fix only if it recurs).

## D31 — Swappable Surfaces: tokens vs component-variants vs bespoke (the element-extension routing rule) ✏️ LOCKED 2026-06-29

**Context.** We are expanding BOTH the theme set AND the themeable elements within themes (composer variants, custom Fleet views like cosmos', future surfaces). We need ONE locked rule for how a new element/variant is added, so the system stays extensible without rotting into either failure mode: over-abstraction (every region a pluggable registry — the "wrong abstraction") or hardcoded structural divergence that should be a clean variant. This generalizes D30 (composer composition) into the system-wide contract. Web-researched + verified against the actual code before locking.

**Decision — a 3-band spectrum; route each difference to the CHEAPEST band that can express it:**
1. **Tokens** — cosmetic difference (color/space/type/radius/elevation/motion) → the semantic contract, a theme's `tokens.css` under `.kit` (§14.4.1). Covers chrome, **Tools tab, Conf/settings**, and most surfaces. Tokens re-skin; they cannot restructure.
2. **Surface (variant registry)** — STRUCTURAL difference (DOM/layout/interaction) with ≥2 real implementations, backed by a shared headless controller → `createSurface` (open keyed registry + per-theme capability `seg` setting + a shared fallback-safe resolver usable by ANY Root). **Today: Fleet and Composer ONLY.**
3. **Bespoke** — a genuine one-off → the theme owns the markup (vapor's frozen hero/composer; a single-theme snowflake).

**The gate (a region earns a Surface ONLY if all three hold):** (1) structural — not cosmetic — divergence; (2) ≥2 real divergent implementations exist/imminent (a hypothetical theme does NOT count); (3) a shared headless controller backs all variants. Tools, Conf, AppBar, chrome FAIL the gate → Tokens — matching VS Code / GitHub Primer / MUI / Backstage / Polaris, none of which component-swap settings/utility surfaces. Confirmed against the code: there is NO per-theme Tools/Conf component; both are one structure reskinned by tokens.

**Mechanism.** A Surface = one headless controller + interchangeable pure-presenter variants (read ONLY the semantic contract → portable). **Variant selection has TWO mechanisms, not one:** (1) **Root-pinned** — the theme's Root passes the variant via a prop (`Fleet={CosmosFleet}`); no registry/setting; for one-variant-per-theme (this is Fleet today). (2) **User-selectable** — an open `Record<id, Component>` registry (STABLE module-level refs + a default fallback — never a render-created `lazy()`, which remounts and resets controller state) + a per-theme `seg` capability setting (offered ids + default; auto-rendered + auto-synced via the themeSettings channel; a picker appears at ≥2) + a shared fallback-safe resolver usable by DefaultRoot AND bespoke Roots (this is Composer: stacked/docked). A surface starts Root-pinned and **graduates** to user-selectable only when ≥2 variants + user choice are real — so **Fleet stays pinned (cosmos untouched) until a theme offers a fleet choice**. The generic `createSurface` factory is **concrete-first**: built per-surface today (composer), extracted on the SECOND user-selectable surface (rule of three), not speculatively. vapor registers its own bespoke variants; hosting the Kit variants under vapor is a deferred additive opt-in (a contract-alias block), not a refactor.

**Why (research-backed).** Tokens re-skin, can't restructure (W3C DTCG 2025-10 stable, Material 3, Radix Themes, shadcn). Structural swaps = slot/registry over a headless controller (MUI `slots`, Radix/React-Aria, VS Code/Backstage descriptor registries). The 3-gate prevents the "wrong abstraction"/"registry-of-one" and speculative generality (Metz "duplication is far cheaper than the wrong abstraction"; Dodds AHA; Frost Components/Recipes/Snowflakes; Rule of Three). React state-preservation rules force stable variant refs + fallback.

**Status.** LOCKED. **Generalizes/supersedes D30's `Composer`-prop injection** with the registry+setting mechanism (D30's composition-over-configuration principle stands; selection generalizes to the resolver). **Full engineering contract + how-to + anti-patterns: THEME_ENGINE.md §14.14.**

## D32 — emma deployment topology: two isolated instances (prod + dev), one repo, tags + sparse-checkout ✏️ LOCKED 2026-06-29 · AMENDED 2026-07-09 · ✅ EXECUTED 2026-07-10 (v1.0.0 = `8fa8404`) · AMENDED-2 2026-07-10 (dev on-demand · dual boot agents)

> ⚙️ **AMENDED-2 2026-07-10 (owner, same day as the deploy — supersedes two run-state clauses):**
> (1) **The dev instance is ON-DEMAND, not always-on** (revises decision #1's "BOTH, always-on"): the two
> dev dashboard units are installed but never boot-enabled — `systemctl --user start ctrl-b-dashboard-dev
> ctrl-b-dashboard-dev-web` when iterating, stop when done. Always-on = prod + the agents only.
> (2) **The Claude agent is TWO boot instances, not one env-switched unit**: template
> `ctrl-b-agent@.service` enabled as `@fable` (`claude-fable-5`) + `@opus` (`claude-opus-4-8`), both
> effort high, in the workspace. `agent.env` now carries only EFFORT/PERM overrides (shared or
> per-instance `agent-<i>.env`); the one-writer-per-tree rule stands — a simultaneous second writer still
> takes a worktree. Executed on emma the same day (install.sh self-migrates the legacy single unit).
> *Same-day addenda (owner, post-reboot):* session names simplified to **`ctrl-b-fable`/`ctrl-b-opus`**
> (easy to type, no quoting); the launcher gained a **bounded network wait** before starting claude (the
> remote-control channel registers at startup and doesn't retry — an early boot start came up invisible
> to the claude app); **PROD binds `0.0.0.0`** (owner waiver — direct `http://emma:5433` on LAN+tailnet;
> Serve HTTPS stays for mic; SECURITY_MODEL §2.1) — shipped as **v1.0.1** (unit changes reach the
> tag-pinned prod only via a release).
>
> *Addendum 2026-07-24 (owner — model layer only; the two-instance topology is UNCHANGED):* **Opus 5 on
> high is the main model.** The `@opus` instance resolves the bare `opus` alias (latest Opus) rather than
> a pinned `claude-opus-4-8`, and `start-claude.sh`'s default model is now `opus`. **Fable 5 is no longer
> the driver** — it stays enabled as `@fable` for on-request second opinions (the Codex role). Sessions
> must match their instance's model: `tmux display-message -p '#S'` → `ctrl-b-opus` ⇒ Opus 5 high.

> ⚠️ **AMENDED 2026-07-09 (before first deploy — read the amendment at the end of this entry):** the
> **`dev` branch is dropped (trunk-based: `main` + immutable release tags)** and the **prod runtime moves to
> `~/apps/ctrl-b`** (the workspace stays `~/github/ctrl-b`; `migrate-layout.sh` deleted — nothing moves).
> The two-instance isolation, sparse tag-pinned prod clone, `CTRLB_HOME` seam, and concurrency rules below
> all still stand; only the *branch model* and *paths* are superseded. "dev" now names the **instance**
> (units · `~/.ctrl-b-dev` · :5434/:5173), never a branch or tree.

**Context.** emma (Ubuntu 26.04, tailnet) is the always-on home for v2. The owner wants BOTH a **production** dashboard for daily use (stable, HTTPS via Tailscale Serve) AND an always-available **development** instance to test changes — **without** dev experiments ever touching prod's config/DB/chat. The coding happens via a **tandem Claude Code agent running on emma in tmux** (alongside the instances; its checkout is read-only to me, one canonical GitHub `main`). Best-practice research (CloudBees env-separation; git worktree-vs-clone; solo-dev branch workflow 2026; GitHub sparse-checkout) backs every choice below.

**Decision — two fully isolated instances on emma, separated on every axis:**

| Axis | PROD (daily driver) | DEV (sandbox) |
|---|---|---|
| **Code tree** | `~/github/ctrl-b` — a **CLEAN, sparse, tag-pinned clone** (only `dashboard_v2` + root docs on disk; prototypes never materialize). Pulls from **GitHub** (so prod runs only pushed+merged code). **Never developed on** — no agent, no commits. | `~/github/ctrl-b-dev` — full tree on the **`dev`** branch; where **ALL development happens** AND what the dev instance serves. |
| **Data root** (`CTRLB_HOME`) | `~/.ctrl-b` (real `config.yaml` + `ctrlb.db` + memories/skills/agents) | `~/.ctrl-b-dev` (its own copy; seeded from prod's config on first dev install) |
| **Backend** | `uvicorn :5433` serving the **built `dist`** (no `--reload`) | `uvicorn :5434 --reload` (Linux reload is safe; Windows gotcha is OS-specific) |
| **Frontend** | built into `dist`, served by uvicorn | Vite `:5173` HMR → proxies `/api` → `:5434` (via `VITE_API_TARGET`) |
| **Ingress** | **Tailscale Serve HTTPS :443** (mic works) | `http://emma:5173` (LAN/tailnet, HTTP, no mic — visual iteration) |
| **systemd user units** | `ctrl-b-dashboard.service` (enabled, always-on) | `ctrl-b-dashboard-dev.service` (backend) + `ctrl-b-dashboard-dev-web.service` (Vite) — start when iterating |
| **Agents** | **none** — prod is just the dashboard + its service + Serve; nobody develops here | **one OR MORE** agents (`start-claude.sh`): the primary on `dev`; a second on a feature/audit branch in its **own worktree** (`git worktree add` off the dev repo) so it doesn't disturb the dev instance's `dev` checkout |

**Who touches what (the mental model — NOT "one branch per agent").** PROD is a runtime, not a workspace: **no agent ever works on `main`/`~/github/ctrl-b`** — the systemd service runs it and the owner uses it daily to surface bugs. **ALL development is on the DEV side** — `dev` (and short-lived feature branches), worked by one or more agents in DEV-side trees. There is **no** "main = agent A, dev = agent B" split; main has no agent at all.

**Branches + releases.** One repo, two branches: **`main`** = always-deployable production line (untouched except by releases); **`dev`** = where development lives + drives the dev instance. Feature/audit work branches off `dev` and merges back. **Tags `vX.Y.Z`** mark releases — prod checks out a **tag** (detached, frozen, named) for reproducibility + instant rollback (`git checkout v(prev)`). **Promote** = merge `dev → main` (the owner, or a dev-side agent), tag `vX.Y`, push → prod `git fetch --tags && git checkout vX.Y && install.sh prod`. Promotion is a release action, not "developing on prod."

**Clean production = sparse-checkout, NOT a divergent branch or a separate repo.** The prod clone runs `git sparse-checkout set backend frontend deploy` (cone mode — the modern `set` default — so the app trees + all top-level files like AGENTS.md/CLAUDE.md/config.yaml are present; the non-prod dirs `docs`, `design`, `archive`, `tools`, `agents`, `skills` drop out — prod reads agents/skills from `CTRLB_HOME`, not the repo). Those folders stay in history but never appear in the prod tree — **zero merge conflicts** (nothing is deleted, just not checked out). Rejected: a `prod` branch that deletes prototypes (every dev→main merge re-collides — known anti-pattern); a separate repo (fragments history, double remotes). The eventual permanent cleanup is a **one-time** delete commit on `main` when v2 fully replaces the live Flask app ("graduation"), not an ongoing divergence.

**Clone, not worktree** for the prod tree even though both run on emma: with an autonomous agent mutating `~/github/ctrl-b-dev` and the read-only constraint, **isolation beats the marginal disk/fetch savings**; a separate clone keeps prod's git state fully decoupled and lets prod pull only from GitHub (the agent's unpushed WIP physically can't leak into the daily driver).

**`CTRLB_HOME` is the isolation seam** (D14/D15 #2) — it already existed; this just points each instance at a different root. All workspace data (`config.yaml`, `ctrlb.db`, `memories/`, `skills/`, `agents/`) resolves under it; the coarse `CTRLB_HOME` knob relocates everything together, the fine `CTRLB_CONFIG`/`CTRLB_DB` knobs override single files (test/back-compat only). Audited 2026-06-29: every data path resolves under `CTRLB_HOME` — fixed `skills_dir_path()` (was keyed to `config_path().parent` → now `home_dir()`, matching memories/agents) so a `CTRLB_CONFIG`-only override can never split skills off.

**One-time migration (coordinated with the tandem agent — NOT auto-run).** emma currently has a single full checkout at `~/github/ctrl-b` (the agent's, on `main`). To adopt this layout: (1) the agent relocates to `~/github/ctrl-b-dev` on `dev`; (2) `~/github/ctrl-b` is converted **in place** to the prod clone (`git sparse-checkout init --cone` + `set` + `checkout <tag>`) — no re-clone, no data loss (everything is on GitHub). `bootstrap.py` **detects and instructs**; it never silently mutates the agent's tree.

**Portable + clean-machine ready (NOT emma-specific).** The deploy works on emma (folder exists → migrate) AND a fresh Linux box (nothing checked out → `bootstrap.py` clones from the GitHub URL it learns from the local Windows checkout). All paths resolve against the **target user's `$HOME`** (any user, not hardcoded `/home/emma`); the systemd units are **templates** (`__REPO__`/`__CTRLB_HOME__`/`__NPM__`) rendered by `install.sh`. `install.sh` hard-checks prereqs (`git`/`python3`≥3.14/`node`/`npm`) and **fails loudly with install hints**; every `bootstrap.py` step is idempotent and stops with an actionable message + where it stopped, so a partial run can be fixed and re-run (or finished by hand — see README "If something fails").

**Concurrency rule (no data loss, stay tidy).** Git is single-process per repo: two agents writing the SAME tree race on `.git/index.lock` → corruption; git also refuses the same branch in two worktrees. So **one writer per tree at a time** — day-to-day both agents share the one dev tree (one writes, the other reads/audits or takes turns). For genuinely simultaneous writers, the second agent gets its OWN branch in a sibling **git worktree** (`scripts/add-dev-worktree.sh <name>` → `~/github/ctrl-b-<name>`, the standard parallel-AI-agent layout) — never a second tree on `dev`. Base setup = exactly two trees; worktrees are on-demand, removed when done.

**Status.** LOCKED 2026-06-29. Supersedes the earlier single-tree, shared-backend deploy sketch (dev was Vite-only proxying to the prod backend → NOT isolated). Artifacts, tidy under `deploy/linux/`: `bootstrap.py` + `README.md` at top, `systemd/` (the three units), `scripts/` (`install.sh [prod|dev]`, `serve-https.sh`, `start-claude.sh [session] [dir]`, `migrate-layout.sh`, `add-dev-worktree.sh`); rationale `docs/DEPLOY_EMMA.md`.
*(Layout note, QH deep pass 2026-07-07: after the repo reorg the shell helpers live **flat in `deploy/linux/`** — no `scripts/` subdir — with `bootstrap.py` at `deploy/` and the agent launchers in root `tools/`; earlier `dashboard_v2` path mentions in this entry's narrative are the pre-reorg dev name. The runbook `deploy/linux/README.md` + the scripts themselves are the current source of truth.)*

**Amended 2026-07-09 — trunk-based + workspace/runtime split (owner-approved after a 3-agent web-research
pass; supersedes this entry's `dev`-branch and `~/github/ctrl-b-dev` clauses; landed before the first deploy,
so nothing ever ran the old branch model).** The realization driving it: **every prod guarantee came from the
TAG pin, not the branch** — prod never tracked `main`, so a persistent second branch was pure promote ceremony
with a known decay mode (ff-only promotion breaks at the first hotfix). The 2024–26 consensus
(trunkbaseddevelopment.com, Atlassian, AWS prescriptive guidance) is trunk-based + release tags at solo scale;
persistent dev/release branches are for multi-version-in-the-field products.

- **One branch: `main`.** All work (owner + agents) lands there; the dev instance serves its HEAD. The price
  (main stays releasable) is already paid by the mandatory hooks + CI. "dev" names only the **instance**.
- **Releases = immutable annotated tags** `vX.Y.Z`, cut on the exact **sha** that soaked on the dev instance
  (not "HEAD"). Never re-point a tag — a bad release gets `vX.Y.Z+1`. Promote = tag + push (no branch dance,
  no checkout anywhere); prod = `git fetch --tags && git checkout vX.Y.Z && install.sh prod`.
- **Workspace/runtime split (paths).** PROD runtime = **`~/apps/ctrl-b`** (sparse, tag-pinned; `~/apps` is the
  user-level `/opt` analogue — FHS-style separation of deployed runtimes from source workspaces). Workspace =
  **`~/github/ctrl-b`** (full clone; emma's existing checkout stays put — `migrate-layout.sh` DELETED, nothing
  to move, no agent coordination needed for layout).
- **Invariant: the workspace never leaves `main`.** The dev instance live-serves it, so any checkout that isn't
  main-moving-forward (hotfix at a tag, prod-bug repro, second simultaneous writer) happens in a **throwaway
  sibling worktree** — `tools/add-dev-worktree.sh <name> [branch] [base]`. Mechanically checkable
  (`git branch --show-current` = main); `bootstrap.py` warns when violated.
- **Hotfix procedure (the only release edge case):** worktree at the tag → fix → tag `vX.Y.Z+1` → deploy →
  **land the fix on main and verify** (`git merge-base --is-ancestor <fix-sha> main`) → remove the worktree.
  The verify step is non-optional — "fix shipped from the release line, forgotten on trunk" is the classic
  under-pressure regression.
- **Expand/contract compatibility policy (DB AND config.yaml).** Rollback window = **1 release** (you only ever
  roll back to the previous tag), so: old code must tolerate the schema/config written by the NEXT release →
  every change ships **additive first** (new nullable column / new field with a default); a **destructive
  contraction** (drop/rename/repurpose) may land at the earliest **one release after** the code stopped using
  the old shape, and every deprecation carries a `DEPRECATED since vX, DROP in vY` note at the site.
  Additive-only-*forever* is explicitly rejected (schema/config bloat is the documented anti-pattern — Fowler
  "Parallel Change": contraction is a required phase). Precedent: `_fold_legacy_tool_descriptions` (expand);
  its contraction is now owed under this policy.
- **Deploy-time data safety.** `install.sh prod` snapshots the DB pre-cutover via `sqlite3 ".backup"` (SQLite's
  Online Backup API — WAL-safe on a **live** DB; a plain `cp` is not: committed data sits in the `-wal`
  sidecar), verifies `PRAGMA integrity_check`, gzips, keeps last N (`CTRLB_BACKUP_KEEP`, default 10). Restore
  (runbook): stop → **delete stale `ctrlb.db-wal`/`-shm`** → gunzip the snapshot over `ctrlb.db` → start.
- **Atomic-ish prod cutover.** The dist builds **aside** (`dist.next`) while the old dist keeps serving; the
  swap is a sub-second stop → `mv` → start (borrowed from the Capistrano releases/`current` idea without the
  scheme). Any pre-cutover failure (build, snapshot, integrity) leaves the running service untouched.
- **`bootstrap.py` config guard.** After the first deploy the **target's** `config.yaml` is canonical (the app
  rewrites it live; the owner edits via the settings UI) — step 1 now **skips when the file exists**;
  `--overwrite-config` forces it with a timestamped backup first. (Pre-amendment behavior silently clobbered
  the live config on every re-run — a real data-loss bug.)
- **CI (SYS-14 extended).** Every **branch** push (hotfix branches included — the flow that ships under
  pressure must get Linux verification) + PRs run the full gate; **`v*` tag** pushes additionally run the
  Playwright e2e/a11y suite — "this tag is releasable" is machine-checked, not discipline-checked.
- **GitHub-down escape hatch** (promote-time dependency): prod can fetch the release tag straight from the
  workspace over the filesystem — `git -C ~/apps/ctrl-b fetch ~/github/ctrl-b 'refs/tags/*:refs/tags/*'`.

*Research record (2026-07-09, three parallel Opus agents — deploy layout · branching consensus · SQLite
backup practice): FHS 3.0 `/opt`·`/srv`; trunkbaseddevelopment.com release-from-trunk / branch-for-release;
GitHub immutable releases; sqlite.org backup.html + wal.html; Fowler ParallelChange; PlanetScale
backward-compatible schema changes; git-worktree-for-hotfix guidance.*

**Amendment addendum (same day, 2026-07-09 — the DEV FRAMEWORK migrates too, and the agent becomes a
service; supersedes original decision 3's "sessions started manually"):** development moves to emma
after the deploy, so the Claude Code agent is now a **first-class always-on user service** —
`ctrl-b-agent.service` (oneshot+RemainAfterExit "ensure the tmux session exists"; enabled by
`install.sh dev`; boots with the box via linger; skipped with a hint if the `claude` CLI is absent).
Model/effort switch without touching tracked files: `~/.config/ctrl-b/agent.env` (`MODEL=fable|opus|<id>`,
default **fable-5 / high**; aliases resolved in `start-claude.sh`). Crash-restart of `claude` stays with
the in-tmux `while true` loop, not systemd. `bootstrap.py --start-agent` is retired; **`--claude-env`**
replaces it: migrates the per-machine half of the dev framework — project **memory** → the target's
`~/.claude/projects/<workspace-slug>/memory` (skip-if-present; target canonical after first migration)
+ a never-overwrite **settings.json key merge** — while everything project-scoped (`.agents/skills/`,
hook settings, `.githooks/`, CLAUDE/AGENTS/docs) already travels in the repo, and auth/transcripts/
`settings.local.json` deliberately do NOT migrate. emma facts (re-recon 2026-07-09): claude 2.1.205
authenticated · tmux 3.6 · the old `~/github/ctrl-b` checkout is an owner-declared disposable scratchpad
(owner deletes it; the workspace arrives as a fresh clone) · the `fable` tmux session is unrelated
Hermes work and stays.

## D33 — Code-quality harness: type-aware ESLint + Prettier, `pyright[nodejs]`, one stdlib runner, native git hooks ✏️ LOCKED 2026-07-01

**Context.** Shipping v1.0 to emma needs the quality boundary held by *tools*, not discipline (agents commit autonomously here). Owner directive 2026-07-01: **maximize code quality via robust, reliable, conventional methods, as simple as possible without trading away quality.** Audit `T1` (`external_audit/`) flagged the gaps: the frontend has **no** lint/format/typecheck gate and the backend has **no type checker** (ruff does not type-infer). Extends the testing decisions **D21** (Vitest) + **D24** (Playwright/axe); full spec + per-layer rationale in [`QUALITY.md`](./QUALITY.md); sliced rollout in [`PRE_DEPLOY.md`](./PRE_DEPLOY.md) §1 (MUST gate step 1, slices 1a–1d).

**Decision — a layered harness, each layer at its ecosystem convention:**
- **FE lint = type-aware ESLint** (typescript-eslint `recommended-type-checked` + `projectService`) + `eslint-plugin-react-hooks` (React-team; the only source of React-Compiler diagnostics, future-proofs `UI_AUDIT` F13) + `eslint-plugin-react-refresh`. **FE format = Prettier** + `eslint-config-prettier`. Non-project files get a `disableTypeChecked` override (reliability gotcha).
- **BE type check = official `pyright[nodejs]`** (pinned; `basic` → ratchet `strict`). Plain PyPI `pyright` downloads Node on first run (flaky, non-hermetic) — **fixed by the `nodejs` extra** (`pip install "pyright[nodejs]"`, `nodejs-wheel` → reliable bundled Node, version-pinnable). Chosen over the **basedpyright** fork after the caveat audit: the fork's Pylance-grade extras we don't need, its stricter defaults false-positive (`reportAny` on third-party `Any`), and it carries governance risk (smaller maintainer pool). BE lint/format = **ruff** (already in).
- **Runner = one stdlib `tools/check.py`** (subprocess/pathlib, zero new dep): resolves the venv python in a **single OS-branch** (the §6 chokepoint spirit), runs a **data-driven check list** (staged-filter via `git diff --cached`, parallel via `concurrent.futures`), delegates FE to a `npm run check-all` that **composes existing scripts**. **NOT** twin `.sh`/`.ps1` scripts (duplicated growing logic → drift, a CLAUDE.md-forbidden anti-pattern).
- **Enforcement = native `core.hooksPath=.githooks/`** (tracked hooks, git 2.9+) delegating to `check.py`: **fast staged-file pre-commit** (`check.py --staged`) + **full pre-push** (`check.py`). Calling `python` (always on PATH — the backend runtime) is more reliable than a hook framework; zero new dep. Chosen over **lefthook** after the caveat audit found documented lefthook **Windows** failures ("can't find lefthook in PATH", Git-LFS/PowerShell edges) — our env is Windows-now → Linux(emma). Speed is a reliability property (a slow pre-commit gets `--no-verify`-bypassed).
- **Adoption = warn-first baseline → burn down to clean before deploy**; the Prettier reflow lands as its own commit (never mixed with logic). Ratchets (post-baseline): pyright `strict`, `@eslint-react` broad ruleset, stylelint (✅ shipped 2026-07-10 with the Hardening slice v2 ⑨ — warn-first).

**Rejected (kept as documented alternatives, not the default).** Biome / Oxlint (single-tool elegance, but weaker React-hooks fidelity + no Compiler diagnostics); plain pyright (flaky Node fetch — solved by the `nodejs` extra); basedpyright (fork governance + stricter-default false positives); Pyrefly/ty (Pyrefly is a rule-surface swap, ty still beta); twin shell-script runner (drift); `nox`/`just`/`make` (env-matrix / global-dep overkill vs the thin stdlib chokepoint); lefthook + husky+lint-staged (hook-framework dep + Windows edges vs native `core.hooksPath` + `check.py`). Full comparison + per-tool caveats in `QUALITY.md`.

**Status.** LOCKED 2026-07-01 (deep-audited + caveat-verified). Net new dev-deps: FE `eslint @eslint/js typescript-eslint eslint-plugin-react-hooks eslint-plugin-react-refresh eslint-config-prettier prettier`; BE `pyright[nodejs]` — all official/conventional, all justified per layer; enforcement adds **zero** deps (native git hooks + `check.py`). De-risked by code facts: FE `tsconfig` already `strict`; BE already modern-typed (`from __future__ import annotations`) → pyright `basic` ≈ near-green.
**Amended at 1d (2026-07-02):** the staged-file filter (`--staged` / `git diff --cached`) was **dropped** in favour of a whole-tree `--fast` pre-commit (ruff lint+format + FE prettier, ~2s) — measured timing showed staged scoping buys nothing at this tree size while adding machinery; the locked intent (a pre-commit fast enough not to get bypassed) is met. Shipped shape + rationale: `QUALITY.md` "Enforcement (1d)" / `PRE_DEPLOY.md` 1d.

## D34 — Theme-engine final review: architecture re-confirmed; Hardening slice v2; vapor assimilation ladder ✏️ LOCKED 2026-07-06

**Context.** Before un-parking the theme engine, the owner commissioned a **final adversarial review of every
theme-engine decision** — 29 agents (6 decision clusters × web best-practices + code audit; every risk/change
finding independently attack-verified; the main session as final judge). Full outcome, slice spec, invariants,
ladder, backlog + rejected list: **[`THEME_ENGINE.md`](./THEME_ENGINE.md) §14.15** (the plan of record).

**Decision highlights (all folded into §14.15):**
- **Every architectural layer re-confirmed** — @scope/@layer/.kit isolation, semantic tokens + two-channel
  accent + OKLCH, LWW appearance sync, View-Transition switching, headless controllers + Root + Kit, the D31
  3-band model. **No decision relitigated.**
- **Hardening slice v2 supersedes the TRIAGE-3 ordering** (10 items + 2 riders, §14.15.1). Notables: the
  `--accent-ink` on-accent contrast token (the review's one product bug — minimal light mode ships 3.2:1);
  a theme-fault boundary whose **"Reset theme to default" is a genuine pick (write-through PUT)** — local-only
  reset can't escape the reconcile loop, quarantine was rejected; the in-flight guard lives **inside
  `switchTheme`** (drops the planned `useIsMutating` gate); registered-ID coercion at both doors, never
  auto-PUT; the B2 contract suite with **vapor exemptions as ONE shrinkable waiver constant**; a
  **kit-render e2e smoke** (the review's coverage hole: no test in any layer mounted DefaultRoot/kit.css).
- **New invariants (§14.15.2):** *the server appearance doc is only ever written by explicit user action*;
  the documented browser floor (Chrome 118+ / Firefox-Fennec 146+ — below it @scope-wrapped sheets drop and
  vapor renders unstyled); the two-CSS-trees rule for shared markup; the grandfathered `isVapor` exception.
- **Vapor assimilation (owner directive 2026-07-06, amends D28/D29): frozen = a phase, not an identity.**
  Six enumerated legacy hooks; a per-component graduation ladder V1–V5 ordered by **divergence (low first:
  Conf editors → overlays → chat LAST and via the D31 3-gate as a ChatSurface candidate, not tokens)**;
  standing guarantees (no new legacy-hook dependencies · shrinkable waiver lists · `DEFAULT_THEME` never
  `"vapor"` literals in engine code). Unscheduled — after the catalog stabilizes.
- **Reviewed and REJECTED** (documented so they aren't re-proposed): storage-event cross-tab listener, woff2
  SW precaching, @scope boot probe, screenshot diffing, tab body registry, quarantine subsystem, aria-live
  announcement, third perf tier (§14.15.4).

**Status.** LOCKED 2026-07-06. Sequencing unchanged: Hardening slice v2 (✅ SHIPPED 2026-07-10 — as-built §14.15.1-A) → Composer Surface
(`COMPOSER_SURFACE_PLAN.md`), post-emma-deploy. Doc pass landed same-day (§10 rewrite as-built, §13.6
superseded banner, §14.11 perf-sync correction, §14.4.1 two-trees box, §14.14 a11y invariant + isVapor
exception, ROADMAP assimilation entry).

## D35 — Section Layout System v1: body registry + curated layout presets + a device-local lever ✏️ LOCKED 2026-07-12 (frontier F0 design review)

**Context.** Frontier (T5) is the first theme that needs "a different section set" (a bespoke Agent body +
a 3-tab default), triggering the tab-body registry that D34 had parked ("no speculative registry") and that
the owner widened into the **SECTION LAYOUT SYSTEM v1** (`FRONTIER_PLAN.md` §1, ratified 2026-07-07). This
entry formally supersedes THEME_ENGINE §14.15.4's narrower "tab-body registry" wording. Principle:
**functionality = modules; layout = modes that recompose where modules live** — no theme or mode ever
removes functionality, only placement varies.

**Decision.**
- **Curated layout presets** (`theme-engine/layout.ts`), schema `{ bar: TabId[]; hosted?: Record<TabId, TabId> }`:
  `4-tab` (today) · `3-tab` (utils hosted in Conf) · `2-tab` (conf via menu, utils inside it). Hosting is
  Axis B — deliberately ONE curated pair (utils→conf), implemented concretely in ConfTab, generalized only
  if a second hosting pair ever exists (concrete-first, rule of three).
- **The lever**: `ui.layout: "auto" | LayoutId` — **device-local like `appbarMode`** (persisted locally,
  NOT in the appearance sync doc; sync = a possible later additive promotion). `auto` = the active theme's
  declared default. Picker = a Seg row beside App bar in Conf → Appearance's global levers.
- **`ThemeDef` capability declaration (additive)**: `defaultLayout?` (omit → `4-tab`) + `layouts?` (omit →
  all presets — the ratified ideal "all themes can offer all modes"). ~~**vapor declares `layouts: ["4-tab"]`**
  — a visible, ladder-owned waiver (VaporRoot never consumes the registry; byte-identity is structural).~~
  ✅ **RETIRED at D51 V6 (2026-08-02): NO registered theme restricts `layouts` any more** — the V4 pivot put
  vapor on `DefaultRoot`, so it consumes the registry/presets like every kit theme (`fleet` is on the bar in
  every preset, so its Root-pinned Fleet body is preset-independent; hosted utils lands in the shared ConfTab).
  vapor keeps `defaultLayout: "4-tab"` (its native shape). The `layouts` field stays as the seam for a future
  theme that genuinely can't express a preset; `tests/theme-engine/layout.test.ts` asserts none does today.
  Unsupported picks coerce to the nearest supported via a **dedicated warn-first layout-coercion resolver**
  keyed on the ThemeDef declaration — NOT `resolveThemeSetting` (that guards per-theme seg/switch settings;
  this guards a global lever against a per-theme capability list).
- **Reachability is Axis A**: every section is always reachable — a tab-bar button if on-bar, the NavMenu
  affordance otherwise. The menu rule generalizes from `appbarMode === "minimal"` to **"whenever any section
  is off-bar AND unhosted"**; `appbarMode: minimal` is modeled as effective `bar = []` (the "1-tab mode IS
  minimal" unification). **Hosting supersedes the menu**: the menu lists off-bar-AND-unhosted sections only;
  `navigate(hostedId)` coerces to the host section + scroll-to-group (the coercion lives in
  `useSections.navigate` — the one nav chokepoint all consumers already share).
- **The body registry — eager DATA, lazy COMPONENTS (the "option A" ruling, owner-ratified 2026-07-12
  after a detailed A/B comparison).** `TabDef` stays pure data (it gains only a generic `lazy?` flag
  generalizing the Conf latch — `tabs.ts`'s component-free invariant holds); the kit owns the id→body
  DEFAULT map in component space; `DefaultRoot` mounts bodies data-driven (keep-mounted, active-gated —
  never conditional-render), replacing the hardwired branch. Per-theme body OVERRIDES are
  injected by the theme's lazy Root chunk via ONE generalized `bodies?: Partial<Record<TabId, Component>>`
  DefaultRoot prop that **replaces and generalizes the one-off `Fleet` prop** (cosmos: `bodies={{fleet:
  CosmosFleet}}`). Rationale: keep-mounted semantics mean a theme's bodies always co-load with its Root —
  splitting them into registry-declared lazy thunks ("option B") adds chunks, re-opens the
  §14.15.1-hardened load-failure surface, and re-enters the `preloadableRoot` View-Transition flash problem
  per body, for zero user-visible gain. This codifies the existing pattern (cosmos already does exactly
  this for Fleet). **Option B stays the documented later promotion** if a real trigger appears (it's a
  mechanical per-theme migration: static imports → thunks + an `ensureThemeLoaded` leg).

**Consequences.** Deep-links/boot with a hosted-or-relocated active section coerce at the same chokepoint;
hosted utils mounts with Conf's lazy chunk (inherits the latch; force-mount + scroll on live switch);
relocation legitimately resets local input state (React remounts on tree-position change — the ratified
honest trade; query-backed data survives in external caches). `hasComposer` stays per-active-section and
is automatically correct per preset. The D31 Surface axis stays separate — variants ≠ tab composition.

**Addendum (owner eyeball + design conversation, same day — all ratified 2026-07-12):**
- **The DOCKING RULE**: the menu affordance docks to the chrome that exists — `appbarMode: visible` → an
  appbar trailing action (`.kit-iconbtn`, the M3 top-app-bar convention; KitAppBar mounts it); `off`/
  `minimal` → the floating top-right orbit launcher. Never a floating launcher next to a live appbar.
- **The COLLAPSE LADDER**: the affordance scales to the menu partition — 0 sections → nothing · 1 → a
  DIRECT section button (icon + `aria-current` when current; one tap, no popover) · >1 → the orbit
  launcher + popover. Applies to both mounts.
- **NAV-HOME**: in `appbarMode: minimal` only (the one barless chrome), a floating top-LEFT companion
  button jumps to the theme's primary section (`sections[0]`, data-driven), self-hidden while on it.
- **PARKED — swipe-to-switch-sections** (not rejected; revisit per-theme if a future theme wants it):
  Material explicitly excludes content-area swipes from bottom-nav destination switching, and this app's
  content owns the horizontal gesture space (cosmos orbital drag · frontier's F2 map pan · chat code-block
  h-scroll · BottomSheet drags · Android edge-back in both browsers). The NavHome button covers the
  underlying "get around fast without a bar" need.

**Status.** LOCKED 2026-07-12 · built as frontier **F0** (`FRONTIER_PLAN.md` §6-F0; the docking rule,
collapse ladder + NavHome landed as same-day follow-ups `ee9bea0`/`9c41ced`/`508a494`). The kit-render e2e
sweep goes layout-aware in the same slice (the pre-F0 readiness punch list).

**AMENDED 2026-07-13 (frontier F4 rider, owner-directed).** The global chrome lever `AppbarMode` gained a
4th value **`transparent`** (Conf label "Clear"): the bar still RENDERS + measures into `--appbar-h` but
paints nothing (no fill/frost/shadow), with squared frosted-glass icon buttons (perf-gated) and a
`--bg`-colored brand text halo (mode-proof); `.kit-main.appbar-clear` nulls the top seam scrim. Every
"is a bar present" test now goes through the single **`appbarShown()`** predicate (`store/ui.ts`) —
`visible | transparent` — so the docking rule reads unchanged ("a bar is present ⇒ the menu docks to it");
never scatter `=== "visible"` bar-presence checks again. Vapor participates additively (byte-identical
unless the mode is picked).

## D36 — Chat hooks + token contract: one shared chat tree, themes reskin on pinned hooks ✏️ LOCKED 2026-07-12 (frontier F4 design review)

**Context.** Frontier's F4 Agent tab is the first bespoke body that must carry the FULL chat (markdown,
code actions, confirm/question gates, plan, reasoning, streaming, TTS, retry) in a non-Kit skin. The
`FRONTIER_PLAN.md` §2 design ruled "bespoke shell, shared internals": the message log carries deep
functionality AND ACA Phase 12 grows it — a forked log pays every ACA slice twice and splits the security
UX. That requires the shared tree's styling surface to be a named, pinned contract instead of folklore.

**Decision.**
- **The contract** (full table + rules: `THEME_ENGINE.md` §15): the existing chat class names — the legacy
  vapor idiom (`.chat-log` · `.b.user/.bot/.sys/.cmd` · `.who`/`.body` · `.think` · `.cmd-detail`/
  `.cmd-result`/`.cmd-output`/`.cmd-links` · `.actions .exec/.edit/.dismiss` · `.q-*` · `.md`/`.md-code` ·
  the plan + privilege families · `.notice`) — are **formalized AS-IS** (a rename would touch frozen
  vapor). Themes reskin via `tokens.css` + theme-scoped CSS on these hooks; DOM forks are forbidden below
  the per-element 3-gate escalation valve; a second theme needing a structurally different log is what
  births a ChatSurface (D34 V4 rider), not before. Chat-only theme values = theme-private tokens, never
  new contract tokens. ACA-grown chat UI adds its hooks to the §15 table in the same change.
- **`ChatThread` extraction (build move, F4 Slice A):** AgentTab's log core (bubble components · the
  memoized per-token render isolation · the stable `resultFor` ref · retry wiring · `#app-scroll`
  stick-to-bottom) moves to shared `components/ChatThread.tsx` with `{active, chat, emptyState?}` props —
  the caller owns `useAgentChat()`. AgentTab (the default body) and any bespoke agent body compose the
  SAME ChatThread; the bespoke body only owns backdrop/empty-state/layout (frontier: rig-stack watermark +
  chips). No parallel log implementations, ever.
- **A4 re-home:** `usePlanOpenAutoClose(currentPlan)` moves from AgentTab into `<AppEngines/>` (the §14.5
  theme-independent engine host, next to `useChatInit`/`useAutoTts`) — the cleared-plan-reopens fix
  (`12f83a5`) can no longer be silently lost by a theme replacing the agent body (the F4 ⚠ in
  `FRONTIER_PLAN.md` §6-F4, resolved structurally).
- **Grandfathered exception:** AgentTab's `isVapor` gate around vapor's frozen in-tab `.plan-pin` — the
  one sanctioned theme-ID branch (§14.15.3), unchanged.

**Status.** LOCKED 2026-07-12 (owner-ratified at the F4 design review, with the F4 nuances: prototype
dusk-glow shows through a see-through frontier shell [cosmos precedent] + prototype bubble skins
[black user fill / transparent assistant]). **✅ BUILT as frontier F4, SHIPPED 2026-07-13** (commits
`61f2267`→`696842f`; the contract table is `THEME_ENGINE.md` §15; frontier consumes it as the first
non-token chat reskin — six owner eyeball rounds folded in, full record in `FRONTIER_PLAN.md`'s banner).

## D37 — Presentation axes: the `axes` cascade layer + `body[data-*]` stamps (outlines ✅ BUILT · composerSkin ✅ BUILT, AMENDED to 4 skins + layout dedup) ✏️ LOCKED 2026-07-13 · AMENDED 2026-07-15 (frontier F5 slice B as-built)

**Context.** Frontier F4 shipped an owner-ratified theme-wide no-outlines look as a frontier-private
`@layer theme` sweep. The owner activated the parked promotion (F5 re-scope, 2026-07-13): make the chat's
borderless look a cross-theme user choice, and — the new half — make the COMPOSER's chrome (cosmos's kit
outline vs frontier's bezel) user-selectable independent of the active theme, as a second axis next to the
existing composer-style (variant) seg. Both are pure-look levers → Tokens band (§14.14); no Surface/3-gate.

**Decision — the axis pattern (kit machinery, both axes).**
- An **axis** = a per-theme setting (D29 §14.3, auto-rendered in Appearance, synced `ui.themeSettings`)
  + a shared spec **factory** + a **resolver** built on `resolveThemeSetting` (theme default unless a
  validated user override; **no theme-id branching**) + a **`body[data-*]` stamp** projected in ONE place —
  a `useLayoutEffect` in `<AppEngines/>` (App.tsx). NEVER stamped from `store/ui.ts#applyBodyAttrs`: axis
  resolution reads the theme registry and the store must not import it (the store↛registry hazard).
- **New cascade layer `axes`** (`theme/index.css`: `@layer base, theme, axes, reset`): axis override CSS
  (`theme-engine/kit/axes.css`) outranks `@layer theme` — the stamp already encodes theme-default + user
  override RESOLVED, so a theme's own rules can't veto the user. **Invariant: the axes layer STRIPS/swaps
  only (borders, focus-ring replacement) — never fills.** It outranks theme CSS, so any fill there would
  clobber theme inks; fill-differentiation stays each theme's job. All selectors `.kit`-scoped (inert on
  vapor) AND gated on the stamp — belt and braces with resolvers defaulting undeclared themes to the
  kit-native look.

**Axis 1 — `outlines` (✅ BUILT 2026-07-13, frontier F5 slice A, commit `5193f4c`).** Chat-scoped (the D36
§15 hook families: bubbles · think · cmd · q-input · retry · md-code · plan family · priv chip/menu).
`outlinesSetting(defaultOn)` + `useOutlines(themeId)` (undeclared → ON) in `kit/axes.ts`; minimal/cosmos
declare ON, frontier OFF (its F4 look). `body[data-outlines="on"|"off"]`. frontier.css thinned to
fills/repaints only — owner-ratified pixel-identical. Exclusions unchanged: `:focus-visible` outlines, the
Clear-appbar squared iconbtns (kit.css ~§appbar), composer/mini-player/Conf/Utils/overlays (the non-chat
sweep stays frontier-private until a second consumer wants it — §14.14 graduation rule).

**Axis 2 — `composerSkin` (✅ BUILT 2026-07-15, F5 slice B, commits `6c78d17` + `a433c8f` [round 2];
AMENDED at the owner's 2026-07-15 pre-build review from the 2-option catalog below to FOUR skins + the
layout dedup).** A second per-theme `seg` DECLARED DIRECTLY AFTER the `composer` seg (ConfTab auto-renders
in declaration order — the two composer rows sit adjacent, owner round-2 ruling): the variant×appearance
split (the Radix/shadcn orthogonal-props pattern).
- **The layout dedup (owner 2026-07-15):** the old 5-option `composer` seg mixed layout with chrome —
  `borderless`/`ghost` were thin CSS `rootClass` wrappers around KitComposer, i.e. skins in variant
  costume. The LAYOUT catalog is now the three REAL components **`stacked` | `sheet` ("Docked") |
  `line`**; the wrapper components are DELETED. NO migration code: a stale synced `borderless`/`ghost`
  degrades to the default via `resolveThemeSetting` (owner re-picks once; single-user ruling).
- **The skin catalog: `outline` | `glass` | `bezel` | `sleek`** (resolver default `outline` for undeclared
  themes; frontier declares `bezel`, minimal/cosmos `outline`). `outline` = the un-keyed kit.css base
  chrome (zero skin rules — pre-mount renders it). `glass` = the old Borderless chrome (transparent
  border + deep ambient/contact elevation on every layout, upward on the docked sheet, light-mode
  softenings; frost kept; STACKED-only icon-forward extras incl. the blurred-square send + the arrowhead
  glyph). `bezel` = frontier's F4 sweep (transparent borders, rec-ring stripped — red icon is the cue;
  exact rgba inks, mode-invariant); **round 2 (owner eyeball "docked with bezel doesn't have a bezel")
  generalized the restrained bezel — soft dusk-ink drop + 1px inset top highlight — from line-only to
  EVERY layout** (docked inverts the drop upward; frontier's stacked bar gained the subtle highlight,
  owner-ratified). `sleek` = the old Ghost chrome (fully transparent bar + extended readability scrim on
  every layout; STACKED-only respacing + field underline; recording ring KEPT).
- **Mechanics as pinned:** stamp `body[data-composer-skin]` from the same AppEngines effect; skins are
  first-class kit chrome in kit.css `@layer base` (a dedicated "composer skins" section AFTER the layout
  variants — every rule re-homed from `@layer theme`/layout selectors was specificity-audited, annotated
  in place), NOT axes-layer strips. After slice B **no theme styles composer chrome directly** (authority
  rule: the outlines axis owns the chat thread, the skin axis owns the composer; themes contribute tokens
  + declared defaults only; a future bespoke composer look = a NEW skin id added to the catalog, not theme
  CSS). **One sanctioned TS seam:** KitComposer picks its default send glyph by the resolved skin
  (`skin === "glass"` → the shared arrowhead) — skin-id (an axis value), not theme-id, branching; an SVG
  swap can't be pure CSS. A future skin wanting a custom glyph hooks the same spot (the `sendIcon` seam
  stays for bespoke wrappers). A future "composer icon setting" was PARKED by the owner 2026-07-15
  (ROADMAP).

**Status.** LOCKED 2026-07-13; slice A eyeballed live same day. **Slice B BUILT + owner-ratified live
2026-07-15** (independent adversarial audit clean across 6 lenses; all 12 layout×skin combos verified via
a live Playwright computed-chrome matrix incl. the Appearance row adjacency; FE gate 427). F5's remaining
gates (perf pass · a11y floor · e2e render case · §0 contract row-by-row) follow. The F5 items "per-host
art override UI" + "asset format/size pass" stay PARKED (owner 2026-07-13 — revisit post-F5).

## D38 — Turn integrity: per-thread turn-marker registry + `Database.transaction()` (ACA Slice 2) ✏️ LOCKED 2026-07-17 (Slice 2 design review)

**Context.** The ACA audit found the chat stack has no per-thread busy state: concurrent posts interleave
into one thread (ACA-2), plan/apply/compact/exec race the live loop's read-modify-write pairs, a mid-turn
cancel skips `_run_calls`' persistence tail entirely (ACA-1 scenario 2), and multi-statement write
sequences commit per statement (SYS-1 — compaction's summary+flag-flips is the sharpest torn state). The
Slice 2 spec (AGENT_CHAT_AUDIT §5) was code-truth re-verified against HEAD (v2.4 amendments) and
field-verified source-level against seven agents (opencode, Goose, Codex CLI, pi, Hermes Agent, Gemini
CLI, Claude Code — 2026-07-17 four-agent research pass, recorded in the §5 Slice 2 heading).

**Decision — four mechanisms, one busy-truth.**
- **Turn marker registry:** `app.state.turns: dict[thread_id, TurnHandle]`; `TurnHandle` = frozen-ish
  dataclass `{turn_id: uuid hex, thread_id, kind: "chat"|"resume"|"exec"|"plan"|"apply"|"compact",
  started_at}`. A **registry entry, not a held lock** (the field consensus: Goose's
  `active_prompt_runs: HashMap<session_id, ActivePromptRun>`, opencode's `runners` map) — Slice 3's
  `TurnRegistry` extends the SAME entry with task/ring/seq in place; Slice 5's steer queue and
  `expected_run_id`-style optimistic concurrency (Goose) hang off `turn_id`. Reserve **synchronously** in
  the endpoint handler (check-and-set with no `await` between — TOCTOU-safe under the single-threaded
  loop), release in `_turn_response._counted`'s `finally` (the one point covering BOTH SSE and buffered
  transports; `collect_turn` has no state access) or the handler's `finally` for plain-JSON endpoints.
- **Scope + posture:** every thread-mutating endpoint — chat, resume, plan, apply, compact, exec — 409s
  while the thread's marker is held, detail actionable ("a turn is already running on this thread — wait
  for it to finish"; Goose's actionable-busy-error precedent). Interim-by-design for *messages* (Slice 5
  upgrades chat-while-busy to the steer queue — the majority field posture; Gemini walked the same
  reject→queue path); **permanent** for plan/apply/compact/second-stream (opencode's
  `BusyError`-on-destructive-ops split). The registry is the **single busy-truth**: the ACA-17
  auto-rediscover gate AND the manual rediscover endpoint's check both read `app.state.turns` (the old
  `active_turns` int misses resume turns — `count=False`; it stays as telemetry only). Handler order
  stays rediscover→reserve (reserve-first would self-block the gate); the residual
  reserve-mid-rediscovery window is narrow, serialized by `discovery_lock`, and matches the "skip,
  re-fire at the next quiet boundary" posture — accepted.
- **Shielded step persistence:** `_run_calls`' body wrapped in `try/finally`; the `finally` persists the
  accumulated `update(assistant)` + tool-results `add` inside `anyio.CancelScope(shield=True)` —
  yield-free, `CancelledError` re-raised. Field-validated shape: opencode's `Effect.ensuring` finalizer +
  Hermes's repair-then-persist-before-return; Claude Code's open #3003 (persisted `tool_use`, missing
  `tool_result` → corrupted session) is the failure mode this prevents. First direct anyio import →
  `anyio>=4.2` pinned in deps (4.14.1 installed; #642 shield bug cleared). In-flight-call marking stays
  Slice 3's A11 (fix-in-the-owning-phase).
- **`Database.transaction()`:** async CM — write lock, `BEGIN IMMEDIATE`, commit / rollback-on-error.
  Repo calls inside the block join the open transaction via a **`contextvars.ContextVar`** (the async-ORM
  atomic pattern) — `execute()` sees the marker and skips lock re-acquire + per-statement commit.
  `PRAGMA busy_timeout=5000` at connect (moot with today's single shared connection — SQLITE_BUSY is
  impossible — but future-proofs the SYS-1 reader-pool seam; opencode's `busy_timeout=0`+WAL incident is
  the cautionary precedent, its current 5000 + Goose's `BEGIN IMMEDIATE`-per-mutation + Hermes's
  `_execute_write` chokepoint are the field validation). Adopters: compaction summary+flag-flips (SYS-1
  headline), plan update-pair + fresh-pair adds, apply update-pair, exec add+add, and the `_run_calls`
  tail pair as a pure wrapper (cross-slice-contract-legal; Goose wraps its INSERT+UPDATE pair the same
  way). Rider: the db.py "WAL lock-free reads" docstring corrected (one shared connection serializes —
  SYS-1's parenthetical).
- **Client + resume:** 409 branch in `streamTurn` + plan/apply/compact paths surfaces the server detail
  as a sys-note (today any 409 renders as a generic retryable error bubble); `/clear` + plan-dot taps +
  proposal approve/dismiss gated on `status !== "streaming"` (server stays authoritative);
  `ResumeRequest` gains `mode` threaded endpoint → `session.resume` → `_drive` (ACA-16; the
  `privilege`-field pattern), frontend stashes the turn's mode and carries it on resume/answer.

**Status.** LOCKED 2026-07-17 after the owner-directed seven-agent field research; build = Opus waves
per the ratified methodology. As-built record lands on the AGENT_CHAT_AUDIT §5 Slice 2 heading.

## D39 — Durable turns: server-owned turn tasks + snapshot-primary re-attach + terminal cache (ACA Slice 3) ✏️ LOCKED 2026-07-18 (Slice 3 design review; ACA §5's "D35 proposed" pointer was stale numbering)

**Context.** ACA-1: a turn dies with its SSE socket — the response generator IS the executor, so a
phone lock/network blip kills the loop mid-work (completed steps survive via Slice 2's shielded
persistence; the turn doesn't). Design phase: full code-truth pass + a FIVE-source field pass
(opencode event-planes/#19023 · LibreChat in-memory job manager · Codex live re-attach + stale-turn
interrupt · OpenAI sequence_number/starting_after + idempotent cancel · Goose/pi/Hermes/Claude Code
absences) + an adversarial design review that found 4 HIGHs — all resolved INTO this decision.

**Decision.**
- **Server-owned turn task (the core inversion):** `_turn_response` spawns an asyncio task that
  drains `session.run_turn/resume` into the registry entry; the SSE generator becomes a subscriber.
  `_counted`'s finally = subscriber-detach; marker release rides the task's `add_done_callback`
  (idempotent cleanup ONLY — `terminal_status` is set in the task's own finally BEFORE the terminal
  sentinel is emitted, so no done-but-unmarked window). A disconnected-but-running turn keeps its
  marker → still 409s new posts. `_drive` body untouched (cross-slice contract).
- **Registry stays LIVE-ONLY (adversarial H1):** release deletes, exactly as Slice 2 — every
  `not app.state.turns` busy-read (ACA-17 gates, `max_active_turns`) stays truthful; turns.py's
  contract survives verbatim. Finished turns move to a small capped **terminal cache**
  (`app.state.turn_terminals`, linger-swept) — read-side convenience for late re-attach, NOT busy
  state. `TurnHandle` extends in place: `task`, monotonic `seq`, bounded event `ring`
  (the replay-window knob — undersizing forces snapshot, never data loss), `subscribers`
  (per-turn bounded queues; overflow DETACHES that subscriber — events are never shed; the
  detached client re-attaches via snapshot), `cancelling` flag, `terminal_status`, and an
  **event-fold accumulator** (open-message id + delta LISTS joined on snapshot [no O(n²) concat] +
  call states + the turn's `mode`) — LibreChat's aggregatedContent shape, built at the registry
  layer so snapshots are complete regardless of ring eviction, zero `_drive` edits.
- **Re-attach — snapshot-primary (field consensus: LibreChat sync-event, Codex history+subscribe;
  cursors only exist where a full server event log does):** `GET
  /api/agent/turns/{thread_id}/stream?cursor=turn_id:seq`. Live + cursor in ring → tail-replay then
  live; else ONE `turn.sync` snapshot event (accumulator; carries `mode` → client re-pins
  modeByCall) then live. **Atomicity invariant:** attach the subscriber queue synchronously, then
  build tail/snapshot synchronously — no `await` between (zero-gap join; the Slice-2 reserve
  discipline). Not live → terminal cache → terminal sentinel; else `{active:false}` → client falls
  back to reload (per-step SQLite persistence is the durable floor; the ring is a cache, never the
  only copy). Plus `GET /api/agent/turns/{thread_id}` — a lightweight status probe; **cold
  page-load re-attach (adversarial M4):** `initChat`/thread-switch probes and re-attaches to a
  live detached turn (the mobile headline case: app killed, turn still running).
- **Client (adversarial H4/M3):** ONE reducer entry gate — events are totally ordered per turn, so
  `seq ≤ lastSeq → drop` at `handle()`'s entry covers every branch (no per-branch rewrites).
  Re-attach sequence pinned: forced reload (bypasses the streaming-skip guard) → `turn.sync`
  overlay with REPLACE semantics (set accumulated text by id, never append) → live subscribe. On
  interrupt: re-attach BEFORE the `failStream`/`retryLastTurn` fallback. **Stop button** replaces
  the disabled send while streaming → `POST /api/agent/turns/{thread_id}/cancel`.
- **Cancel — single-cancel discipline (adversarial H2/H3):** the `cancelling` flag ensures
  `task.cancel()` fires EXACTLY once ever (endpoint idempotency + shutdown drain share the path;
  a second raw cancel would pierce the anyio shield inside the persistence finally → the dangling
  BEGIN the Slice-2 audit closed). Endpoint: cancel once → `await task` (suppress
  CancelledError) → return status; idempotent repeat returns current state; nothing-running →
  clean OK (opencode's unstick affordance). **Stale-call marking happens INSIDE the turn task's
  CancelledError path** — after `_drive` unwinds + the shielded persist completes, WHILE the
  marker is still held (no race with a successor turn; the cancel endpoint writes nothing, so the
  D38 turn-guard invariant test stays truthful). No between-steps flag (deviation from the §5
  sketch): Stop means now; the shielded finally saves completed work.
- **A11 + startup reconciler:** `RunState.CANCELLED` end-to-end (enum + `_RESOLVED` + `_assemble`
  synthesis KEYED STRICTLY ON PERSISTED CANCELLED [adversarial L3] + FE type/RUN_STATES/CSS/label).
  `reconcile_stale_calls(thread_id|None)` — ONE helper, two call sites: lifespan boot (all
  threads; stale PENDING/RUNNING → CANCELLED "interrupted by restart"; durable AWAITING_* suspends
  survive; best-effort, a DB hiccup never aborts startup) and the turn task's cancel path. Field
  grounding: opencode #19023 (no startup reconciler → permanent spinners, closed not-planned) vs
  Codex's interrupt-stale-turns — we take Codex's side.
- **Robustness:** chat SSE gains ping (~15s) + `send_timeout` (it has NO keepalive at HEAD);
  lifespan drains the registry under `shutdown_grace_s` (shielded terminal persistence); CPython
  #116720 cancellation re-assert lands in subagents.py; all knobs in config
  `agent.turns.{ring_size, subscriber_queue_size, linger_s, ping_s, send_timeout_s,
  shutdown_grace_s, max_active_turns}`. **`active_turns` gauge DELETED** (D38 amendment: it kept
  "telemetry" status but is write-only; the registry supersedes it — dead state mimicking a live
  signal is the trap D38 exists to kill). Buffered D17 collapses into a `collect_turn` subscriber
  (buffered turns become cancellable for free); buffered re-attach is documented DEGRADED (the PWA
  always streams). Accepted: transient sys-notes (notice/compaction) are not re-attach-recoverable.

**Status.** LOCKED 2026-07-18 (owner go after the 4-HIGH adversarial review was resolved into the
design). Build = 4 Opus waves (A11+reconciler → registry/task core → endpoints/terminal/shutdown →
client) + adversarial audit + 8-angle pre-push review. As-built record lands on AGENT_CHAT_AUDIT §5
Slice 3.

## D40 — Turn speed: parallel read-only tool prefix + per-call persistence/streaming (ACA Slice 4) ✏️ LOCKED 2026-07-19 (Slice 4 design review)

**Context.** ACA-4/5-notice/11 + adoption A2: `_run_calls` resolves a whole tool batch before the
first `tool.result` reaches the wire or the DB — N slow calls cost Σ not ≈max, and a crash loses
every in-memory result. Design phase: full code-truth pass (7 contradictions in the §5 sketch
pinned) + a SEVEN-agent source-level field pass across three topics (per-call persistence /
parallel dispatch / streaming-while-tools-run: opencode·Goose·Codex·pi·Hermes·Gemini CLI·Claude
Code) + a 3-lens adversarial design review (concurrency/cancellation · persistence/crash ·
security/contract; 3 HIGH + 9 MED) — all resolved INTO this decision. Field consensus adopted:
parallel siblings with harness-side read-only classification (Claude Code rule), model-order
persistence-as-each-call-resolves (pi/Codex/opencode; Goose/Gemini's batch-at-step-end is the
crash hole we're closing), recovery at assembly time (already ours), step-serial model↔tools
(universal — no overlap built).

**Decision.**
- **Generator inversion (the ONE sanctioned `_run_calls` structural refactor):**
  `_run_calls -> AsyncIterator[AgentEvent]`; `(suspended, made_progress)` moves to a mutable
  `_BatchOutcome` holder passed by `_drive` (async generators return no value; holder not read on
  the exception path). `_drive` re-yields per event; **zero `turns.py` changes** (fold/ring/fanout
  verified order-independent by `callId`); Slice 5's step boundary (= the `_drive` iteration)
  unchanged.
- **Parallel prefix, serial tail — single-pass classifier as sole authority:** one synchronous
  walk in model order both classifies and applies dispatch increments (the walk's increments ARE
  the dispatch increments — no second pass; at one cap slot left exactly one call admits).
  Admission = fresh (no token, not `_RESOLVED`) · unsuppressed vs the CURRENT guard
  (`denied_sigs`; per-tool cap; **repeat-cap on counts ALONE** — `last_results` is completion
  state, never read at classify; the demoted call re-checks on the serial tail AFTER its prefix
  twins completed → byte-identical verdict+echo to today) · args parse (empty-string legacy path
  included) · `decide(spec, priv, run_shell_allowed=live settings)==ALLOW` (mirrors `invoke`,
  which re-runs `decide()` internally — the classifier orders, never authorizes) ·
  **`spec.read_only` AND builtin-authored** · not `spec.suspending`. **`idempotent` is NOT
  parallel-eligible** (re-run-safe ≠ order-independent; `start_service`/`shutdown`@FULL would
  race sibling reads — deviation from the §5 sketch's "read_only or idempotent") and
  **MCP/OpenAPI tools are prefix-ineligible** (derived advisory annotations; per-server
  `parallel_ok` = the named future seam). Invariant pinned ACROSS ALL PRIVILEGES incl. FULL:
  no mutating call ever runs before a prior call completes. Prefix ≤1 → pure serial path
  (single source of truth). Resumes: prefix empty by construction (leading calls `_RESOLVED`,
  resumed call carries a token).
- **`ToolSpec.suspending: bool = False`** (+ decorator passthrough; `question`=True) — suspension
  is only observable post-invoke, so the flag is a classify-time prerequisite. Static pin:
  AST/grep arch-test scans builtin tools for `RunState.AWAITING_*` returns vs declared flags
  (adapters structurally can't suspend — verified; skills only narrow the allowlist). TWO
  symmetric fail-closed runtime belts: a prefix invoke returning AWAITING_* OR `needs_confirm`
  → error result + ERROR log + no-progress; never suspends, never None.
- **Executor:** explicitly-retained asyncio Tasks under `asyncio.Semaphore(agent.
  max_parallel_tools)`; tasks map `except Exception` → per-call error result (CancelledError
  propagates); spawned OUTSIDE any open DB txn (contextvar hazard — pinned). Primitive =
  task-list + `asyncio.wait(FIRST_COMPLETED)` loop (NOT TaskGroup [await-all can't stream;
  #116720 class stays out], NOT `as_completed` [loses task identity]). Single consumer does ALL
  completion bookkeeping + assistant/tool-Message writes (Event rows inside `invoke` stay
  concurrent — corruption-safe on the process-wide `_write_lock`). On ANY early exit the
  `finally`: cancel pending → `gather(return_exceptions=True)` await ALL (no tool task outlives
  the terminal persist) → HARVEST `.done()` results into `result_parts` (+bookkeeping) → shielded
  persist tail; never yields during GeneratorExit unwind.
- **Per-call persistence:** storage shape unchanged — ONE `tool` Message per invocation, created
  once lazily with a stable id, then ONLY `update()`d (consumer AND tail; the tail is the
  backstop, never a duplicate `add()`). **Each completion commits tool-row + `assistant.update()`
  in ONE `Database.transaction()` (BEGIN IMMEDIATE)** — no torn flip-without-result. All writes
  via the extracted `_persist_shielded` helper (= the C3-H1 dual-shield tail verbatim, one
  implementation; swallow-only-while-unwinding kept → persist failure raises BEFORE the yield:
  **persist-before-emit**, snapshots never hold a vanished row). NO pre-invoke RUNNING persist
  for prefix calls (read-only ⇒ re-issue free; C4-H1's persist stays on confirmed mutating
  resumes, serial tail). Crash matrix verified: completed+persisted survive; unresolved →
  reconciler → CANCELLED → `_assemble` synthesis → safe model re-issue. O(N²) write bytes + FTS
  re-index per completion accepted at homelab batch sizes.
- **Config:** `AgentDef.max_parallel_tools: int = 4` (`ge=1`; 1=off; per-agent, mirrors
  `max_concurrent_subagents`). **Rider (owner constraint 2026-07-19):**
  `InferenceEndpointCfg.max_concurrent_requests: int | None = None` (`ge=1`; None=unlimited) —
  the owner's llama.cpp backend has 1–2 non-queuing slots; a per-endpoint `asyncio.Semaphore` at
  the inference-client chokepoint, held for the ENTIRE streamed response, released in `finally`,
  NEVER held across tool execution/subagent fan-out (no hold-and-wait — pinned by a
  deadlock test); failover acquires per-attempt on the endpoint actually called. Concurrent
  turns/subagents/summarizer queue app-side instead of erroring at llama-server. (Slice 4's tool
  prefix itself adds ZERO model calls — all prefix-eligible builtins are non-LLM.)
  > ✏️ **AMENDED by D48 C4 (A11, 2026-07-23) — the gate is no longer inference-only and no longer
  > keyed by a raw URL.** The knob moved from `InferenceEndpointCfg` to **`ProviderCfg.
  > max_concurrent_requests`**, and the key is `(gate_identity, limit)` where `gate_identity =
  > canonical_base_url(...)` — a **SERVER** identity, not a provider name, so aliased URLs of one box
  > share ONE gate and two providers at different base_urls never block each other. It is acquired at
  > **three** chokepoints now (chat · voice · embeddings), all through the app-owned `EndpointGates`.
  > Providers sharing a gate identity must declare the same cap (`None ≠` finite): strict 422s,
  > lenient takes min-of-finite + warns. Everything else above (hold-for-the-stream, release before
  > tools, per-attempt on failover, generation-drain on a limit change) is unchanged. See D48 §C4.
- **ACA-11:** `notice` "compacting…" emitted ONLY when compaction will actually summarize (no
  no-op-iteration spam); `collect_turn` gains `notices`; accumulator does NOT fold notices (D18
  precedent, live-only breadcrumb — accepted).
- **§7 debt discharge:** C1-L5 `result_sig` → `sig|state|summary|error|sha256(full output)` (the
  per-tool cap is the AUTHORITATIVE spiral bound — byte-flapping regression test proves it) ·
  C2-L6 → `test_subagents_safety.py` (clamp/depth/semaphores/timeout/headless-deny) · C2-L7 →
  skills-zero-context assertion. `ToolSpec` docstring + SECURITY_MODEL row record that
  builtin-authored `read_only` is now load-bearing for parallel-eligibility (was "UX hint only").

**Status.** LOCKED 2026-07-19 (owner go 2026-07-19 after the 3-lens review was resolved into the
design; the llamacpp rider added at the owner's direction same day). Build = Opus waves (schema/
config+pins → classifier → generator inversion+per-call persistence → parallel executor+belts →
notices/debt riders) + fresh-eyes audit + tri-review incl. Codex (standing, structural slice).
As-built record lands on AGENT_CHAT_AUDIT §5 Slice 4. Explicit sketch deviations: read_only-only
prefix (not read_only-or-idempotent) · MCP/OpenAPI excluded · notices unfolded · prefix (not
adjacent-rebatch).

## D41 — The steering queue: mid-turn messages + `!exec` upgrade the D38 409 (ACA Slice 5) ✏️ LOCKED 2026-07-19 (Slice 5 design review)

**Context.** A1/ACA: sending during a live turn 409s (the FE can't even POST — the guard blocks at
`chat.ts:1090`); the owner must wait a whole turn to steer. Design phase: code-truth pass (8 pins,
7 gaps — headline: the queue MUST outlive the live-only `TurnHandle`) + a 6-system field pass
(Codex/pi/Claude Code/opencode/Goose/Gemini; Codex fact CORRECTED — its core drains at turn END
into a new turn, not step-boundary injection; pi/opencode are the step-boundary precedents; pi's
Esc-restores-draft is the best-regarded cancel semantic, Gemini's auto-resubmit and
Claude Code's/opencode's silent loss are the footguns) + a 2-lens adversarial design review
(5 HIGH total — one convergent — all resolved INTO this decision).

**Decision.**
- **The queue:** `app.state.steer_queues: dict[thread_id, SteerQueue]` (the `turn_terminals`
  precedent; NOT on the handle; NOT busy-state — `not app.state.turns` truth pinned by an arch
  test; the stale `turns.py:16` turn_id note reconciled). In-memory, accepted-with-reason
  (restart loses seconds-lived steers — SECURITY_MODEL residual row). **`SteerEntry` is a
  UNIFIED submission object** `{entry_id, kind: message|exec, text|cmd, mode, agent, privilege,
  skills}` (extend-not-migrate): a MID-LOOP drain contributes TEXT only (params ignored — a
  steer cannot re-route/escalate a running turn, stated security stance); a TURN-END spawn runs
  under its OWN captured params (`/cloud do X` spawns on cloud; Slice 6's `context_window`
  resolution dependency). Cap `TurnsCfg.steer_queue_max` (default 8, `ge=1`); overflow → the
  old 409 verbatim.
- **Enqueue (endpoints, NOT `_reserve_turn` — its handle-or-409 contract is untouched):** chat +
  exec catch `TurnBusy` and enqueue IFF the live holder's `kind ∈ {chat, resume}` (sync holders
  — plan/apply/compact/exec — keep 409; incoming resume/plan/apply/compact NEVER enqueue). The
  catch→append block is synchronous-atomic, no await (no orphan window; D38 TOCTOU discipline).
  202 `{queued, turn_id, entry_id, position, depth}`. Nothing persists at enqueue. Exec: the
  `user_exec_enabled` 403 checks at enqueue (UX) **AND at drain (fail-closed — review HIGH: the
  endpoint is the only home of the user-exec gate and `run_shell`@FULL is ALLOW; without the
  drain re-check, disabling the shell mid-queue would still execute)** — drain-disabled → drop +
  `notice`, pinned test + SECURITY_MODEL row.
- **Drain A (running turn):** top of every `_drive` iteration, BEFORE `should_compact`
  (compaction always sees drained steers; ordering invariant to Slice 6 — review-verified).
  `AgentSession.steer_source` = an injected peek/commit view (session stays registry-ignorant).
  **Transactional: peek → persist all messages in ONE `Database.transaction()` → commit() clears
  AFTER the txn** — a failed persist leaves the queue intact; un-persisted text has exactly ONE
  home at all times. Exec entries: gate re-check then the ONE existing exec pair implementation.
  FIFO across kinds. Wire: **`steer.applied {entryId, messageId, kind, text?}`** (`text?` = as-built,
  message kind only) per entry; **the
  accumulator FOLDS steered user messages** (durable content must survive snapshot re-attach —
  the notices live-only stance does NOT apply; turns.py's only change, additive fold + test).
  Not re-triggered: skills / reflection / static head (tail-append, cache-safe);
  `count_user_messages` bumps for messages only.
- **Drain B (turn end) — `completed` terminals ONLY** (deviation from the §5 sketch, both review
  lenses convergent: spawn-on-suspended makes the owner's Approve 409 against an invisible steer
  turn + can re-propose the pending confirm). In `_cleanup`: iff completed + queue exists +
  NOT `app.state.shutting_down` (set at the top of the lifespan finally — a natural completion
  during shutdown must not spawn past the drain snapshot): **reserve SYNCHRONOUSLY** (no await
  before it — no fresh-POST race, no loser path, FIFO chronology) then `create_task` the body.
  `start_turn(state, thread, …)` is the ONE extracted spawn path shared with the chat endpoint
  (takes state, never Request). Head message seeds the turn (its params); the rest drain at the
  new turn's loop top. All-exec queue → reserve + a small exec-drain task, no model turn.
  Suspended → NO spawn: the queue survives and drains at the next turn's loop top (resume or
  fresh message — confirm-first ordering, no starvation). Cancelled → never (below). The v1
  `_assemble` AWAITING_* rider is DROPPED (broke the aca11 pin; can't distinguish live from
  abandoned confirms at assembly altitude; motivating case vanished with completed-only spawn).
- **Cancel — harvest FIRST:** the cancel endpoint's FIRST statement is a synchronous
  `steer_queues.pop(thread_id)` — before the handle lookup (no-live-turn cancels harvest too)
  and before any await, so a `_cleanup` racing a natural completion finds no queue → spawn
  structurally suppressed; **Stop can neither auto-run nor lose a steer** (the review's
  convergent HIGH). Response gains `steer_queue: [entries]`; contract: Stop harvests
  undrained/unspawned entries — an already-spawned turn is what the cancel cancels.
  *(AMENDED as-built 2026-07-19, Codex-review FIX 3+4:* the harvest is no longer literally the
  FIRST statement — a **synchronous scope-check runs BEFORE it**. The turn-id scope moved from the
  JSON body (only readable via `await request.json()`, hence after the harvest) to a **`?turn_id=`
  QUERY PARAM** readable synchronously; the FE sends it, the legacy body is still accepted after the
  harvest for back-compat, query wins. New order: **(1)** sync — if the query `turn_id` names a turn
  OTHER than the live handle, refuse `{cancelled:false, active:true, turn_id:<live>}` **without
  harvesting** (the reviewer's D39-scoping rationale: a delayed scoped Stop for finished turn A must
  not harvest successor turn B's queue — that queue is not A's); **(2)** sync harvest-first (as
  above, now for the unscoped / scoped-match / no-live-turn cases); **(3)** cancel + settle. The
  destructive harvest also writes a **replayable receipt** to `app.state.steer_harvests`
  (`{entries, turn_id, ts}`, the `turn_terminals` linger pattern, swept by `linger_s`): a REPEAT Stop
  within the linger — a lost Stop response, socket drop — returns the SAME entries with
  `harvest_replayed:true` instead of an empty queue (superseding the old lossy "second harvest is
  empty" behaviour). The receipt is cleared on linger expiry or when a new turn starts on the
  thread.)*
- **FE:** streaming send-guard lifted; 3-exit optimistic bubble (200 normal · 202 queued chip ·
  409 rollback+sys-note); `steer.applied` swaps by entryId; **probe-on-done-with-queued-bubbles**
  re-attaches to a drain-B turn (the D39 probe; mandatory — the spawn is otherwise invisible);
  the probe response gains `steer_queue` so reloads re-render queued bubbles (no vanished-steer
  double-send); `DELETE .../steer/{entry_id}` (drained-already → `{removed:false,"already
  sent"}`); Stop restores the RAW composer lines (client entry_id→raw map; `/prefix` fidelity),
  newline-joined APPEND (an `appendDraft` separator extension — never the space-join, never
  clobber). Buffered: steer 202 = fire-and-forget, documented DEGRADED (D39 stance).

**Status.** LOCKED 2026-07-19 (owner go same day; Opus 4.8 build waves mandated). Build = 5 waves
(queue core+enqueue → drain A+accumulator → drain B+cancel+start_turn → FE → **a docs wave
sweeping DESIGN.md/SPEC.md for the Slice 4 AND 5 behavior deltas** [owner directive: docs must
reflect actual behavior] + SECURITY_MODEL rows) + fresh-eyes audit + Codex tri-review. As-built
record lands on AGENT_CHAT_AUDIT §5 Slice 5. Sketch deviations recorded: completed-only spawn ·
dropped AWAITING_* rider · queue scope messages+exec only · the Codex-fact correction.

## D42 — Context management & compaction v2: windows + trim tier + template + thrash + ModelRef call config (ACA Slice 6, absorbs A10) ✏️ LOCKED 2026-07-19 (Slice 6 design review)

**Context.** ACA A3: compaction v1 triggers on a fixed `threshold_tokens: 6000` absolute (no notion
of the model's window), summarizes free-form, has no cheap pre-summary tier, no thrash protection,
and no `/compact <instructions>`. `context_window` exists nowhere in config; ModelRef is a bare
mode/model pointer (no output cap — the summarizer runs uncapped; no reasoning control = A10).
Design pipeline (full draft + provenance: [`SLICE6_PLAN.md`](./SLICE6_PLAN.md), v3 body + v4
addendum): 2 code-truth passes + 3 field passes (compaction mechanics ×6 agents · knob exposure +
window discovery ×8 incl. llama.cpp source-verified · reasoning/output surfaces) + a 2-lens
adversarial design review (4H resolved in) + TWO owner direction rounds (① settings surface +
window discovery ② fallback windows + output budgets + reasoning ladder).

**Decision.**
- **Windows & trigger:** per-endpoint `InferenceEndpointCfg.context_window: int | None` (manual;
  may exceed the probe — the Codex silent-down-clamp is the recorded anti-pattern) + a llama.cpp
  **`/props` probe** on the InferenceClient (lazy first-use, memoized per base_url; cache
  auto-invalidates because `set_inference` rebuilds the client; NEVER raises — failure ⇒ None;
  reads `default_generation_settings.n_ctx` = the effective per-slot window, `meta.n_ctx_train`
  as sanity ceiling; cloud = no probe, manual only). **Precedence: config > probe > None ⇒ the
  `threshold_tokens` fallback trigger** (unchanged semantics as the no-window path). Trigger =
  estimated context > `window × threshold_frac` (`CompactionCfg.threshold_frac: float = 0.85`,
  `ge=0.5, le=0.95` — fraction-of-window, the field plurality; replaces/inverts v2's
  `reserve_frac`, identical math; `reserve_tokens` absolute override DROPPED — one knob, one
  unit). The trigger resolves the window per `endpoint(eff_mode)` (mode-only); **iteration 2+
  prices against the endpoint that ACTUALLY served** via a new `StreamReport.served_endpoint`
  stamp in `_record` (`chain[served_index][1]`, one-line chokepoint) — anchor + window from the
  same serve; iteration 1 uses the selected endpoint. The summarizer's overflow guard reads its
  OWN ModelRef endpoint's window.
- **Knobs (field-aligned names/units; global = `Settings.agent.compaction`, per-agent =
  `AgentDef.compaction`, resolve unchanged):** `enabled` (stays) · `threshold_frac` ·
  `threshold_tokens` (no-window fallback only) · **`keep_recent_tokens: int = 4096`** (token
  floor; two-floor `_split`: `cut = min(message-cut, token-cut)` → C5-M2 suspend-snap + task_plan
  snap → user-boundary snap; `keep_last_messages: 8` stays) · **`clear_output_min_tokens: int =
  500`** (trim floor, internally chars≈4×) · `clear_keep_steps: int = 2, ge=1` (the ge=1 IS the
  most-recent-step safety) · `max_consecutive_failures: int = 3` · `summarizer: ModelRef` (stays;
  YAML-only, no UI picker) · **`reserve_output: bool = True`** — when the effective ModelRef has
  `max_tokens`, the trigger line subtracts EXACTLY it (no global cap, no silent down-clamp — the
  two recorded opencode bugs); threading = an optional per-call `reserve_tokens: int | None`
  param on `compact`/`should_compact`/`_over_threshold` (existing callers unchanged; the session
  passes `self._agent.model.max_tokens` at its two call sites; Compactor stays stateless).
- **Anchored estimator:** per-backend TOTAL-prompt semantics — `prompt_progress.total` preferred
  (already flowing, the ACA-18 `return_progress` pin); telemetry precedence fixed;
  no-reliable-total ⇒ no anchor (heuristic only); session-held anchor + watermark, invalidated on
  fold/served-change/degraded; overhead = the A8 head+tools cache; **ONE `_over_threshold`
  predicate serves BOTH gates** (no duplicated threshold math).
- **Tier 1 — unconditional assembly-time tool-output trim (runs free before any paid summary):**
  pure shared `plan_clearing` feeds the trigger **net-of-clearing** (gain priced chars/5,
  conservative); output-only rendering keeps the `[state] summary` line; placeholder = `[output
  cleared — re-run the tool if needed]`; A12 pinned — DB stays verbatim, `_assemble`-time
  substitution only; synthesized results structurally exempt; **never-clear:** AWAITING_*-paired ·
  `task_plan` · `memory` results · the most recent `clear_keep_steps` steps.
- **Tier 2 — the summarizer:** fixed 5-section template (pending scoped to the folded head;
  rolling carry-forward re-fold); `/compact <instructions>` passthrough (`CompactRequest.
  instructions` + FE/store/Compactor threading; `CompactionResult.rejected` + endpoint JSON +
  `compactionNote` branch); task_plan joins the `_split` snap; the summarizer-overflow
  truncation-fold guard.
- **Thrash machine:** `app.state.compaction_state` view; failure = **didn't-shrink ONLY** (a
  TRUNCATION_NOTICE fold = success); per-turn backoff; latching breaker + ONE notice; `force`
  bypasses threshold/backoff/breaker but NEVER the inflation-reject; reset = not-over-threshold
  after a manual compact; restart-resets + cold-client blindness recorded residuals.
- **Reactive backstop:** `InferenceError` gains code/status pre-flattening; on a context-overflow
  error with the **nothing-streamed precondition**: ONE forced compaction + same-assistant
  re-stream (one-shot); llama.cpp silent ctx-shift = recorded residual + deploy note.
- **ModelRef extension (A10 lands here; declared fields, no extra="allow"):** `max_tokens: int |
  None` — first-class kwargs into `stream_chat`/`complete` (modeled params = kwargs; extra_body =
  unmodeled passthrough only); both consumers benefit (agent calls AND the summarizer — capped
  free) · `reasoning_effort: Literal["off","minimal","low","medium","high","xhigh","max"] | None`
  (the universal ladder) · `reasoning_tokens: int | None` (numeric where expressible, e.g.
  OpenRouter `reasoning:{max_tokens}`; advisory elsewhere). **Per-backend translation
  (silent-safe by design):** llama.cpp honours `max_tokens`, silently drops `reasoning_effort`
  (verified — harmless to send) BUT `"off"` additionally translates to `chat_template_kwargs:
  {enable_thinking: false}` merged per-call OVER the endpoint's extra_body (agent keys win);
  cloud gets `reasoning_effort` first-class + `InferenceEndpointCfg.max_tokens_field:
  Literal["max_tokens","max_completion_tokens"] = "max_tokens"` (pi's `compat.maxTokensField`
  precedent). Rule: NEVER gate behavior on a param taking effect; reasoning stays read-only
  (reasoning_content-first, <think>-parse fallback, dropped at assembly — unchanged).
- **Fallbacks free-ride (the unified-object payoff):** `fallbacks: list[InferenceEndpointCfg]`
  are full endpoint objects → `context_window`/`max_concurrent_requests`/`max_tokens_field` ride
  with zero schema work. PUT semantics verified: the list replaces wholesale; only api_key is
  secret-carried by base_url — non-secret new fields round-trip clean.
- **Settings surface (Conf UI; hot at NEXT turn — sessions build per-turn off live settings,
  verified, no new plumbing):** Inference group: `Local/Cloud context window` Fields (blank =
  auto: probe/fallback) + a `Context window` input per fallback row (both hand-written render
  paths touched). Agents group: the global-compaction block in AgentsEditor's global-settings
  area — `Auto-compact` Switch · `Compact at % of context` (`threshold_frac`×100) · `Keep recent
  (tokens)` · `Tool output trim floor (tokens)` (the inline numeric-grid precedent).
  AgentsEditor model block (the `setModel` seam): `Max output tokens` + `Reasoning effort` Seg +
  `Reasoning tokens`. FE `ModelRef` interface gains the declared fields (typed, no index
  signature). `clear_keep_steps`/`max_consecutive_failures`/per-agent compaction/summarizer
  picker stay YAML-only (the agents-UI `Omit<"compaction">` stands).
- **Invariants (v2's eight stand + three new):** 10. the probe never blocks or fails a turn;
  window chain = config > probe > fallback, upward overrides allowed. 11. settings-written
  compaction knobs apply at the next turn (no restart) — pinned by test. 12. the Conf UI edits
  GLOBAL compaction only; per-agent stays YAML.
- **Probe table recorded for future adapters (research field pass; llama.cpp source-verified, the
  rest recorded-unbuilt):** llama.cpp `GET /props` → `default_generation_settings.n_ctx` (+
  `meta.n_ctx_train` ceiling) — SHIPS · Ollama `POST /api/show` → `model_info` context_length
  (training value; effective `num_ctx` differs) · LM Studio `GET /api/v0/models` →
  `max_context_length`/`loaded_context_length` · vLLM `GET /v1/models` → `max_model_len` ·
  OpenAI-style cloud: NO window field exists (manual config only). Adapters are additive
  follow-ups on the same probe seam.

**Status.** LOCKED 2026-07-19 (owner go same session; Opus 4.8 build waves mandated). Build = ~6
waves (schema/config+probe → estimator/trigger → clearing+summarizer+thrash → reactive+ModelRef
wire → Conf UI → the DESIGN/SPEC docs sweep) + mid/post-build audits + the Codex tri-review — the
standing pipeline. Verification per SLICE6_PLAN §10 (probe matrix · settings round-trip hot pin ·
Conf UI rows · threshold bounds · live long-session watch). Out of scope recorded: per-agent
compaction UI · summarizer picker UI · cloud probing · non-llama.cpp probe adapters. As-built
record lands on AGENT_CHAT_AUDIT §5 Slice 6. *(Added 2026-07-20, lifted from SLICE6_PLAN §4 so it
outlives the plan: **"placeholder-shows-probe"** — the Conf context-window Fields were specced with
"blank = auto; the placeholder shows the probed value when live", tagged "a nicety, decide at build".
It was **never decided either way** — recorded here as an open nicety, not a deferral with a reason.
The blank-is-auto behavior itself shipped; only the live-probed placeholder hint is unresolved.)*

*(AMENDED as-built 2026-07-19, the audit + Codex fix sets — all verified CLOSED, no drift:* ① the
per-call clearing param is the PLAN object (`ClearingPlan.gains` + `gain_over`), and an ANCHORED
estimate credits only the **delta** over the plan recorded at the anchor (`cleared_at_anchor`) —
the anchor already reflects a trimmed prompt, so full-gain subtraction double-credited (the
mid-build HIGH); the inflation-reject prices the folded head net-of-clearing; clearing gain is
**net-of-placeholder** with net-positive-only eligibility (clearing can never enlarge the prompt).
② A degenerate trigger line (reserve ≥ window×frac) degrades to the `threshold_tokens` fallback +
a once-per-process warning. ③ The D40 per-endpoint gates moved to an **app-owned `EndpointGates`
registry** shared across `set_inference` client rebuilds (Codex HIGH: a mid-turn settings PUT
split the cap across client generations); keyed `(base_url, limit)`, changed limit mints a fresh
gate. ④ `_finalize` joins Tier-1 clearing AND the one-shot overflow rescue via the shared
`_overflow_fold` helper (Codex HIGH — supersedes the W3 finalize exemption: an overflow at
wrap-up folded nothing and died `capped`). ⑤ Turn pricing resolves endpoints via the CAPTURED
client's cfg (`InferenceClient.endpoint(mode)`), never the live-mutated Settings — the
hot-at-NEXT-turn pin now holds mid-turn. ⑥ The probe is single-flight (per-client lock +
double-check). ⑦ Hardening: `ModelRef.max_tokens`/`reasoning_tokens` `ge=1` (an FE-coerced 0
silently zeroed generation); `keep_recent_tokens`/`clear_output_min_tokens` `ge=0`; FE numeric
inputs are garbage-safe via the shared `lib/num.ts` helpers (junk keeps the prior value / inherits
— never 0, never a silent null on the window fields); the `reasoning_tokens` row copy says
advisory-unwired. ⑧ FE: the AgentsEditor global draft reseeds only on a genuine value change; a
delayed `/compact` note is thread-scoped (dropped if the view moved on). Accepted residuals
beyond the locked list: `reasoning_effort` exotic values ride verbatim to a strict cloud hop (a
400 there is config-inflicted + failover-absorbed; a per-endpoint effort-map is the future seam) ·
the ConfTab-WIDE draft reset on any settings save is pre-existing draft-lifecycle behavior,
DEFERRED to a Conf-surface follow-up (per-section dirty tracking). ✏️ **v1.3.1 (2026-07-28,
`0358f4c`): the two DATA-LOSS vectors inside this residual are CLOSED** — the save-diff/dirty
baseline moved to the draft's epoch snapshot (the Slice-8 LWW race), and AgentsEditor's reseed
guard now compares only the draft-managed `pickGlobals` projection (the cross-section clobber).
What remains deferred is granularity only: per-section seeding/adoption, cosmetic on a
single-PUT tab.)*

## D43 — Model routing (failure-fallback lead) + retryable classifier + typed retry/failover visibility (ACA Slice 7: A4-reduced, A6, A7) ✏️ LOCKED 2026-07-19 (Slice 7 design review)

**Context.** ACA A4/A6/A7. Post-D42 truth: the failover chain is any-error→next-hop with NO
classifier (the D18 §3 pre-authorized tuning seam, never built), NO same-endpoint retry anywhere
(`max_retries=0`, deliberate), and the only failover visibility is a post-hoc coarse degraded
`notice` — the failover loop runs inside `stream_chat` (a sub-generator), so even Slice 3's
emit-anytime cannot narrate hops live. Separately: a weak local worker can flail (iteration cap,
stall spirals) while every HTTP request succeeds — a failure class the request-scoped D18 chain
STRUCTURALLY cannot see. Design pipeline (full draft + provenance:
[`SLICE7_PLAN.md`](./SLICE7_PLAN.md)): 2 code-truth passes + a sourced field pass (×8 systems;
Goose lead/worker verbatim defaults + its consolidation-away; pi's classifier; the
retry-consensus table; the Gemini silent-downgrade footgun) + a 2-lens adversarial review
(7 HIGH / 13 MED / 4 LOW — all resolved in) + two owner discussion rounds.

**Decision.**
- **(A7) The classifier — `categorize(err)`** (adapters/inference.py, beside
  `is_context_overflow`; structured `code`/`status` first, message fallback): `transient`
  (429 · 503 · Retry-After present · the llama.cpp busy/slot-full shapes, build-verified — the
  pi #6364 local-backend lesson) · `overflow` (delegates to `is_context_overflow`; the D42
  backstop consumer unchanged) · `fatal_for_endpoint` (401/403 · 404 model-not-found ·
  quota/billing) · `other`. **`InferenceError` gains `retry_after: float | None`** parsed from
  the RAW SDK exception's headers (delta-seconds + HTTP-date) INSIDE `attempt`, pre-conversion
  (the D42 code/status-capture rationale — post-flattening the header is gone).
- **(A7) The retry tier:** `transient` → retry the SAME endpoint, then next-hop;
  `fatal_for_endpoint` → next-hop immediately, never retried-same (a different hop has
  different credentials/models — the cross-provider walk stays correct); `other`/`overflow` →
  next-hop immediately (D18 verbatim — tuned, never reversed; nothing aborts the chain early).
  Budget = resolved `retry_attempts`: **global `InferenceCfg.retry_attempts: int = 2 (ge=0)` +
  per-endpoint `InferenceEndpointCfg.retry_attempts: int | None = None`** (None = inherit,
  0 = disable; the compaction global+override pattern — the OWNER'S manage-once amendment,
  round 2). Curve = fixed module constants: base 2s ×2ⁿ, cap 30s, a larger Retry-After wins
  (the D42 one-knob-one-unit bar — the curve is not configurable). Retries fire ONLY at stream
  initiation (nothing streamed); the backoff sleep holds NO permit and NO stream (the failed
  attempt already released; retry re-enters `attempt` which re-acquires; cancel-during-sleep
  cleanup is a structural no-op). **Chat stream only** — `complete()` (summarizer) and voice
  keep straight next-hop (both latency-bound; compaction has its own fallback semantics). SDK
  `max_retries=0` stands: retries are never silent, ours are wire-visible.
- **(A6) `failover()` becomes an async GENERATOR** (core/failover.py, still value-agnostic):
  yields `HopRetry(index, attempt, max_attempts, delay_s)` / `HopFailover(from_index,
  to_index)` control items live, then the terminal `FailoverResult` as the LAST item (async
  generators can't `return` a value — the last-item contract is typed + documented). A thin
  **`failover_collect()`** drains events for buffered callers — voice/embeddings/`complete()`
  reduce byte-for-byte to today (policy defaults to always-next-hop, zero events). This is the
  slice's ONE structural change and the only clean shape (a called function cannot interleave
  events into the stream; a duplicated chain walk violates the one-source rule — review F1).
- **(A6) Wire:** `stream_chat` re-yields the items as `RetryNotice`/`FailoverNotice` BEFORE the
  first `ChatDelta`; **BOTH consumers** (the `_drive` loop AND `_finalize`) add an isinstance
  branch ABOVE the delta checks that emits + continues and NEVER touches
  `streamed_any`/text-buffers (the D42 nothing-streamed backstop flag stays honest — review
  F9). New AgentEvent kinds **`inference.retry` {endpoint, attempt, max, delaySeconds,
  category}** · **`inference.failover` {from, to, category}**; the post-hoc degraded-notice
  block is DELETED (superseded — no double-narration). Durability: live-only (the D39 notice
  stance) + `collect_turn` folds to `notices` text (buffered parity), PLUS a snapshot-carried
  **`retry_status: {endpoint, attempt, max, until_ts} | None`** set/cleared by the session
  around a backoff — a re-attach DURING a backoff renders the retry line instead of the dead
  spinner A6 exists to kill (review M4); the TurnAccumulator stays notice-free. FE: two new
  chat.ts cases (ship with the events) in the sys-note voice + `turn.sync` renders
  `retry_status`.
- **(A4, REDUCED) Failure-fallback routing — NO `lead_turns`** (both review lenses converged:
  lead-opens-thread is a coding-agent pattern transplanted without its workload, and Goose —
  the only precedent — consolidated it away; the reduction also dissolves the resume-window,
  monotonic-counter, and prune edge cases). **`RoutingCfg`** (domain/agent.py, the
  CompactionCfg placement): `lead: ModelRef` (required) · `failure_threshold: int = 2 (ge=1)`
  (CONSECUTIVE hard worker failures) · `fallback_turns: int = 2 (ge=1)` (episode length).
  `AgentDef.routing: RoutingCfg | None = None`; **the global default is
  `agent.defaults.routing`** (the D16 precedent — a separate `Settings.agent.routing` is the
  anti-pattern D16 rejected; deliberate divergence from compaction's dual-home, recorded).
  Subagents: the field copies via `model_copy` but is RUNTIME-INERT (no RoutingState) —
  documented, not sold as inheritance.
- **The machine:** decision at the top of `_drive`, once per LOGICAL turn. The router returns
  ONE routed `ModelRef` (lead during an episode, else `agent.model`) and **ALL FOUR derived
  locals read from it** — `eff_mode`/`eff_model`/`eff_reasoning`/`reserve` (the compaction
  output-reserve prices the ROUTED ref) — plus `_finalize` consumes the routed call-config via
  params (review F4/H2: the draft's two-RHS undercount is the recorded trap).
  `_over_threshold_now` (manual `/compact`, a sync-holder) keeps `agent.model` — benign, noted.
  The `/local`//`/cloud` prefix WINS and bypasses the router (the 4c lock); stated plainly: the
  prefix selects the ENDPOINT — a prefixed turn runs the WORKER ModelRef on that endpoint.
  **`RoutingState`** (per-thread `app.state.routing_state`, the CompactionState template:
  dataclass + `routing_state_for` + prune-when-default + `_build_session` injection):
  `consecutive_failures` · `fallback_remaining` · **`current_route`** (the logical-turn route
  lock: a resume READS it instead of re-deciding — the ACA-16 mode-carry parallel; no
  mid-logical-turn model flip, no double-decrement; restart loses it → post-restart resume
  re-resolves, recorded residual) · `turn_had_model_failure` (session-written per-turn flag).
- **Failure counting — session-side, structural, hard-failures ONLY** (review F2/F3:
  `_cleanup` sees neither routed-to nor degraded, and `capped` is a nearly-dead terminal —
  counting lives IN `_drive` where every signal exists): on a worker-routed turn, a failure is
  (a) the chain-level `InferenceError` ending the turn, EXCLUDING degraded-rescued serves AND
  the chain-exhausted total outage (an infra event — escalating to an equally-dead lead is
  pointless; review F12), or (b) reaching `_finalize` via ITERATION EXHAUSTION or the STALL
  GUARD (the true weak-worker signal, flowed as an explicit flag at the two known sites — never
  inferred from terminal strings). `completed` resets; `suspended`/`cancelled` neutral. At
  threshold → `fallback_remaining = fallback_turns` + ONE notice each way (`// lead model for
  the next N turns (worker failing)` / `// back to the worker model`). Honest scope: this
  catches CRASH-AND-BURN only — a confident-wrong answer is a clean turn by design
  (content-sniffing = the Goose regret, rejected).
- **The D18 ~60s dead-ENDPOINT circuit breaker stays deferred as a DISTINCT concern** (review
  M3): availability at request/endpoint granularity vs this quality-ish escalation at
  turn/model granularity — different axes; the guard is against duplicating the SAME axis.
- **Invariants:** (1) one route decision per logical turn, suspend/resume included, never
  mid-turn; (2) the prefix always wins and never mutates routing state; (3) no retry after the
  first streamed token, no mid-stream failover, permit-free/stream-free backoff; (4) every
  retry/failover/route-change is wire-visible + `retry_status` covers re-attach-during-backoff
  — nothing silent, no dead spinners; (5) with routing off + retry resolved 0, behavior is
  today's except the degraded narration becomes the live typed event; at shipped defaults the
  second sanctioned delta is the visible in-place transient retry (owner-ruled); (6)
  `failover()` stays value-agnostic; voice/embeddings/`complete()` via `failover_collect()`
  unchanged; (7) degraded-rescued and total-outage turns never count as worker failures;
  control items never touch `streamed_any`.

**Status.** LOCKED 2026-07-19 (owner go after two discussion rounds; rulings recorded in
SLICE7_PLAN §9: A4-reduced as specced · retry = global-2 + per-endpoint override · no routing
UI v1 — the AgentsEditor GLOBAL routing row is the named follow-up if routing survives real
use). Build = ~5 Opus waves (failover generator + classifier + retry + config → session
events/retry_status/notice-deletion → the routing machine → FE cases + Omit → the docs sweep)
+ mid/post-build audits + the Codex tri-review — the standing pipeline. Verification per
SLICE7_PLAN §7 (incl. the three review-added pins: suspend-inside-episode stability · all-four
locals ride the lead in BOTH call paths · a real busy llama.cpp slot reaches the retry tier).
Out of scope recorded: content-sniffing · `lead_turns` (purely additive later) · mid-stream
failover · SDK retries · summarizer/voice retry · the D18 endpoint breaker · A7 thinking
transforms (code-verified unnecessary) · subagent runtime routing · per-agent routing UI.
As-built record lands on AGENT_CHAT_AUDIT §5 Slice 7.

*(AMENDED as-built 2026-07-20, the audit + Codex fix sets — verifier: all 6 findings CLOSED at
the ruled minimal shape, 668 backend tests, no drift:* ① audit fixes (`0b46f19`): disabling
routing mid-episode resets the WHOLE RoutingState (prunable; a re-enable starts fresh — never a
silent mid-episode lead route, Invariant 4) · `categorize` runs the fatal status/code check
BEFORE the bare `retry_after` short-circuit (an auth error carrying Retry-After is fatal, never
retried; the 429/503-transient check stays first — "busy wins"). ② Codex tri-review fixes
(`c00a640`, 3 HIGH — the routing lifecycle): the thread-global `current_route`/
`turn_had_model_failure` state fields are **DELETED** — the route + failure flag are `_drive`
turn-locals (code-truth: the failure flag is only ever set at sites that terminate the turn, so
it never crosses a suspend), and the suspend carry is a per-suspended-call **snapshot map
`RoutingState.suspended_routes: dict[call_id, ModelRef]`** (lead routes only; a missing entry =
worker): an interleaved fresh or prefixed turn can no longer clobber a suspended turn's route
(D41 explicitly allows fresh-during-suspend — the Codex repro), and a mid-suspend routing edit
or disable can no longer change the resumed half (the snapshot is the FROZEN object, not a
live-config pointer); swept at the fresh decision against the live AWAITING set; chained
re-suspends re-record. The exhaustion/stall conclude moved AFTER `_finalize` via a
done-interception (`_finalize_then_conclude`: conclude events, THEN done): a Stop mid-wrap-up
now stays neutral — the "cancelled → no count either way" pin genuinely holds — and the close
notice precedes `done`. ③ Recorded as-built nuances: a cancel mid-lead-turn consumes that
episode turn (decrement-at-decision — the D41 "an already-spawned turn is what the cancel
cancels" spirit) · a single-endpoint transient exhaustion counts as a worker failure (the lead
may live elsewhere; only the >1-endpoint total outage is neutral) · a worker turn resumed after
an episode opened meanwhile finishes as WORKER (one route per logical turn; episodes govern
fresh decisions only — verifier-ruled honest) · the llama.cpp busy shapes are source-verified
(503 `no slot available` / `Loading model` / `unavailable_error`).)*

---

## D44 — Persisted approvals ("always allow") on the confirm gate (ACA Slice 8: A5) ✏️ LOCKED 2026-07-20 (Slice 8 design review)

**Context.** ACA §5 Slice 8 + §6 Q7/Q8. Design pipeline (full brief + provenance:
[`SLICE8_PLAN.md`](./SLICE8_PLAN.md)): 1 code-truth pass + 3 sourced field passes (CLI tools ·
agent frameworks/SDKs — Claude Agent SDK's un-bypassable `requiresUserInteraction` class, goose's
`permission.yaml`, opencode Once/Always · mature policy systems — XACML combining algorithms,
OPA, polkit `auth_*_keep`, sudoers NOPASSWD/last-match footguns, browser/mobile grant decay) →
five owner rulings → 2-lens adversarial review (design + security, both GO-WITH-FIXES;
3 HIGH / 6 MED / 6 LOW, all resolved into the plan) → LOCK.

**Decision.**
- **The ladder** (XACML: *ordered-deny-overrides*; an approval discharges a *discretionary*
  obligation): **policy DENY > `ToolSpec.confirm=True`** (un-downgradable below FULL; FULL's
  existing auto-run unchanged) **> persisted approval** (risk-derived CONFIRM→ALLOW only) **>
  the normal risk decision**. Q8 CLOSED: no forced-confirm bypass (field near-unanimous;
  deliberate divergence from polkit's local-overrides-vendor, recorded). Implemented INSIDE
  `decide()` via a new `approved: bool = False` param (the `run_shell_allowed` precedent —
  `invoke` computes the match, never overrides the verdict; all policy in one pure module).
- **Storage = `ToolOverride.approvals: list[ApprovalRule] | None`** — the third dimension on
  the unified per-tool object (the CLAUDE.md hard rule; NOT the ACA sketch's "approvals table").
  `ApprovalRule{args: dict[str,str] | None}` with **`extra="forbid"`** (review H1: a typo'd key
  must 422 — `args=None` means whole-action, so a silently-dropped key would fail OPEN) +
  str-coerced values. No TTL/subject/toggle in v1 (declared as real fields when built).
- **Matching:** per-field `fnmatchcase` globs against `canonical_str` of the VALIDATED
  `model_dump(mode="json")` fields (str as-is · scalars JSON-encoded · None→a sentinel (W5 ⓑ) ·
  non-scalar→unmatchable); rule = AND over listed fields, list = OR (**allow-only dissolves
  first-vs-last-match ordering** — the OPA incremental-allow idiom); unlisted fields
  unconstrained BY DESIGN (the Conf widening semantics); unknown/non-scalar → rule inert (fail
  closed). Allowlist-only: deny-shaped rules are policy-rung material (sudoers `!` anti-pattern).
- **The grant path is SERVER-SIDE** (reviews H2+H3+F1 — the slice's one structural piece):
  `ResumeRequest.decision` gains **`"execute_always"`**; the resume path builds the args-exact
  rule from the suspended call's validated args — **every top-level field pinned**, None as the
  sentinel, values glob-escaped backend-side — appends under the settings write lock, persists,
  then executes. Kills in one move: the FE list-through-deep-merge clobber, the two-device
  revoke race on the bubble path, the JS/Python canonicalization split (`String(1.0)`≠`"1.0"`),
  and the omitted-optional wildcard hole (a `{command}` grant must NOT match `{command,
  cwd:"/"}`). `tool.permission` gains **`always_eligible`** (false on non-scalar input models —
  `spawn_subagents` — the FE hides the affordance; a persisted-but-inert rule would break trust).
- **Actor-agnostic + fail-closed** (owner ruling ④): one grant covers USER/AGENT/headless;
  headless miss stays CONFIRM→DENIED. The interactive→headless crossing (a bubble-born grant
  auto-allows headless re-runs) is DELIBERATE and documented in SECURITY_MODEL; visibility = a
  **mandatory `[auto-allowed: …]` marker on the executed action's `Event.summary`** (the Event
  model has no payload column — no migration, no new kind; a queryable fire-log is the reserved
  decay-on-disuse seam).
- **R1 scoped** (review F4): `run_shell` pinned `confirm=True` (verified behavior-neutral at
  every call site) → un-approvable. NO pins on config-risk tools (`terminal_exec`/`write_file`,
  MCP/OpenAPI `risk`): owner-configured HIGH stays approvable BY STANCE (a pin would break the
  deliberate `exec_risk: low` escape).
- **FE:** bubble = the `execute_always` verb only (no settings PUT, no serialization; shown iff
  `always_eligible`; pins the ORIGINAL proposed args — the `edit` action routes to the composer,
  not an in-bubble editor). Conf = the approvals editor inside **ToolCatalog** writing through
  **`useSaveToolOverrides`** (no second write path); the ConfTab LWW draft race = the existing
  settings contract, accepted + documented.
- **Liveness verified at review:** `deps.settings` is the shared object,
  `apply_settings_inplace` mutates in place — the gate consult is live per-invocation; a revoke
  wins from the next call (no caching, no TOCTOU). `fnmatchcase` is a deliberate divergence
  from the `fnmatch` sites (no OS case folding in a security matcher) — do not "fix" it back.

**Verify** = SLICE8_PLAN §9 (`test_approvals_slice8.py` ladder/matching/grant-path/liveness/
audit suites; vitest affordance/editor; SECURITY_MODEL + DESIGN §3/§14 + config.example rows).

**Out of scope recorded** (SLICE8_PLAN §8; lifted here 2026-07-20 so the seams outlive the slice
plan): TTL / decay-on-disuse (needs the fire-log migration) · deny/ask states in the approval layer ·
rule-creation events · in-bubble arg editing (review L1). Plus the four with a shape worth keeping:
- **Subject/context scoping** (owner ruling ④ reserved it, deliberately unbuilt). The shape is an
  **additive optional field on `ApprovalRule`** — `allow_active`-style: a grant that holds only in a
  named context (a specific agent / thread / privilege) rather than universally. It is additive
  precisely because `ApprovalRule` is `extra="forbid"` with declared fields: a future `subject` field
  is a new optional key with a default, never a migration. **Today a grant is actor-agnostic by
  design** (one grant covers USER/AGENT/headless) — subject scoping is the escape hatch if that ever
  proves too wide, not a correction of it.
- **Tool-wide one-click grain from the bubble.** The bubble grants args-EXACT only; a "always allow
  *this tool*" verb beside it would need a second grain in the same affordance. Deliberately not
  shipped — widening is the Conf editor's job (write a glob rule there), where the blast radius is
  visible before you save. The seam is a second resume verb, not new storage.
- **Gate-computed rule suggestions.** `decide()` knows exactly which pins caused a re-ask, so it
  could propose the minimal widening ("this differs only in `cwd` — widen it?"). Not built: it is a
  UX layer over a security surface, and a *suggested* widening is the easiest way to talk someone
  into a rule they didn't mean. Wants deliberate design if picked up.
- **OCC on the Conf settings draft** (review F3). The race is durable above (the ConfTab LWW draft
  race, accepted as the existing settings contract) — the *remedy* is recorded here: optimistic
  concurrency on the settings draft (version/etag on read, 409 on a stale write). **Ruled
  settings-wide, not slice-scoped:** approvals just made an existing whole-settings contract more
  visible, so fixing it inside the approvals editor would be a parallel mechanism on one surface.
  If built, it goes on `PUT /api/settings` for every writer.

*(AMENDED as-built 2026-07-20 — BUILT in three waves, `08ef3c1` policy core / `919680b`
server-side grant path / `e080731` FE + editor:* ① the §6 marker also stamps the **granting run
itself** — `grant_approval` lands the rule before the resume executes and `invoke` re-consults live
settings, so that run reads as approval-covered; benign (it is also human-confirmed) and mutually
exclusive with a grant-failure note. ② `always_eligible` gained a **second gate in W3**: `not
spec.confirm`. Expressibility alone still offered "always" on the forced-confirm tools
(shutdown/reboot/`run_shell`), persisting a rule the gate never reads; the ToolCatalog approvals
editor is hidden for the same tools — so a hand-edited rule on one of them is inert AND not
UI-revocable (recorded, SECURITY_MODEL §2.5). ③ `exact_arg_pins` was factored as the ONE pin builder
shared by the eligibility flag and the grant write. ④ `GET /api/actions` DTOs carry each tool's live
`approvals` — the editor's read source; approvals are settings state, so they're read beside the live
settings, never through `spec_dto`. ⑤ The write-path re-homing is real and shared:
`settings_write_lock` + the new `apply_settings_patch` (merge→validate→persist→`reconfigure`) moved
into `runtime.py`, and `PUT /api/settings` was refactored onto both — one lock, one write sequence,
no parallel path. Full as-built narrative: AGENT_CHAT_AUDIT §5 Slice 8; banner: SLICE8_PLAN.)

*(AMENDED post-audit 2026-07-20 — the W5 fix wave closing the build audit's SHIP-WITH-FIXES:)*
ⓐ **Marker truncation** — `[auto-allowed: …]` clips each pattern VALUE to 32 chars (field names stay
whole). It is appended to every auto-allowed run's `Event.summary`, and approvable tools take large /
credential-bearing args (`terminal_write_file.content`, MCP args), so an untruncated pattern would
copy them into the audit log on every run. ⓑ **`None` gets a sentinel canonical form**
(`permissions.NONE_CANON = "\x00null"`, one constant used at BOTH pin and match time, pinned
unescaped as a module literal). `"null"` was ALSO the canonical form of the literal string `"null"`,
so a rule pinning an omitted optional matched a different call — §7 invariant 5 was literally false
(reachable via `web_search.categories`). The sentinel is verified round-tripping through the real
YAML writer + loader by test. **Documented residual:** canonicalization is type-blind inside the
string form (an `int | str` field would conflate `5` and `"5"`); no tool has such a field today.
ⓒ **`args: {}` ≠ `args: null`** — null is the whole-action grant, `{}` is the EMPTY AND (matches only
a zero-field call), in the matcher, the marker (`no args` vs `any args`) and the Tools-tab chips.
Conflated, an "exact" grant on `tailscale_serve_*` was stored as a whole-action grant that would have
silently widened if the tool ever gained a field. ⓓ **ONE settings write lock, finally** — `api/hosts`
and `api/integrations` dropped their private locks for `runtime.settings_write_lock` (hosts'
`_persist_and_reload` did `edit_config_yaml` + `reconfigure(load_settings())` with no coverage at
all), so a grant can't interleave with a host/integration write and leave `app.state.settings` stale.
Taken at the outermost site only — nothing under it re-acquires. ⓔ **Grant failures are audited** —
`ActionService.invoke` gained `summary_note`, folded into the summary BEFORE the Event is recorded, so
`[always-allow not saved: …]` reaches the audit log and not just the SSE stream. ⓕ SECURITY_MODEL §2.5's
editor-exclusion caveat now covers BOTH exclusions: forced-confirm tools (rule inert) and
`default_agent_mode: disabled` tools (rule **live** but unmanaged — revoke via `config.yaml`).
ⓖ The three untested §9 promises are covered: grant vs a concurrent settings write (asserting
non-overlap, not just the end state), the marker on a HEADLESS-subagent run, sibling
`description`/`agent_mode` preservation on grant.

## D45 — Per-dialect reasoning budgets: one ladder, translated at the wire (ACA §4 A10 remainder) ✏️ LOCKED 2026-07-20

> **Renamed by D46 (same day):** the field this decision introduced as **`reasoning_dialect`** ships as
> **`api_mode`**, widened to own the derived `max_tokens_field` too. Read "dialect" below as "api_mode";
> the values (`openai | llamacpp | openrouter | none`) and every payload rule are unchanged except
> AMENDED-2 ⓐ, which D46 **reverted** (`max` rides verbatim). No migration shim exists and none is
> needed — `reasoning_dialect` was live for hours and `config.yaml` is gitignored.

**Context.** A10's remainder — `ModelRef.reasoning_tokens` shipped **declared but unwired** in D42,
recorded as "advisory, no-op: llama.cpp has no per-request reasoning budget". A verification pass
against llama.cpp master found **both halves of that premise false**, and worse in the opposite
direction than assumed:
- **llama-server never reads `reasoning_effort`** (maintainer-confirmed; zero occurrences in the
  server source). The one reasoning knob we *did* send was being silently discarded by the owner's
  PRIMARY local endpoint — the ladder was decorative exactly where it mattered most.
- **llama-server DOES accept a per-request integer budget** — `reasoning_budget_tokens` (current) /
  `thinking_budget_tokens` (older alias), parsed in `tools/server/server-common.cpp`, and a
  per-request value OVERRIDES the `--reasoning-budget` launch flag (PR #23116). `-1` = unrestricted,
  `0` = end thinking immediately.
- Upstream is genuinely split: OpenAI/Ollama are effort-only (`max_completion_tokens` is a COMBINED
  reasoning+output cap, **not** a reasoning budget); vLLM takes `thinking_token_budget`; OpenRouter
  takes both but `reasoning.effort` and `reasoning.max_tokens` are **MUTUALLY EXCLUSIVE** — sending
  both is a hard 400.

**Decision.**
- **One primary knob stays `ModelRef.reasoning_effort`** (the `off…max` ladder), made meaningful on
  every backend by TRANSLATING it at the wire instead of hoping the server understands our spelling.
  **`reasoning_tokens` becomes an explicit OVERRIDE, not a parallel setting**: where a dialect has a
  budget it wins over the ladder-derived value; where a dialect has none it is ignored (correct, not
  a gap — there is no field to put it in).
- **The signal is a new per-endpoint `InferenceEndpointCfg.reasoning_dialect`**
  (`openai` | `llamacpp` | `openrouter` | `none`) — the `max_tokens_field` precedent, a "which wire
  shape does this server speak" field on the unified endpoint object (never a sibling map).
  **CONFIG, deliberately not a probe and not a model-name sniff:** the dialect is a property of the
  **SERVER**, not the model — the same `qwen3` behind llama-server vs behind OpenRouter needs
  *opposite* payloads, so a model sniff is structurally incapable of being right, and only whoever
  pointed `base_url` at a server knows the answer. Default **`openai` = today's payload
  byte-for-byte**: no migration, no upgrade surprise, pinned by a back-compat test.
- **The ladder→tokens table is fixed module constants** in `adapters/inference.py`, not config —
  the D43 precedent (a policy curve, like the retry backoff, is constants), and the per-agent
  `reasoning_tokens` override IS the configurability escape hatch, so a second config surface would
  be a parallel mechanism for a knob we already have. `off → 0 · minimal → 256 · low → 512 ·
  medium → 2048 · high → 8192 · xhigh → 16384 · max → -1`. **The two ends are not invented
  mappings** — `0` and `-1` are llama.cpp's OWN documented sentinels; only the middle is ours.
- **Per dialect** *(as AMENDED-2 below — this list is the shipped behaviour)*: `openai` → effort
  verbatim with `"off"` → its `"none"`, tokens dropped. `llamacpp` → **no `reasoning_effort` at all**
  (dropping a field the server provably ignores is the honest fix, not a shrug) + the resolved budget
  under **BOTH** budget keys (older builds know only the alias; unknown keys are ignored ⇒ free
  back-compat). `openrouter` → an explicit budget sends `reasoning:{max_tokens}` and **suppresses the
  effort key** (the mutual-exclusion 400 is a landmine, not a warning), else effort through
  `_OPENROUTER_EFFORT` (`"off"`→`"none"` **only** — the `"max"`→`"xhigh"` clamp was REVERTED by D46, see
  AMENDED-2 ⓐ). `none` → both dropped.
- **`"off"` carries a `chat_template_kwargs:{enable_thinking:false}` merge on the `llamacpp` dialect**:
  that is the TEMPLATE-level lever and it COMPLEMENTS the sampler-level budget `0` — two levers on two
  layers, not a duplicate. *(Originally "on every dialect"; corrected in AMENDED-2 ⓓ — it is a
  llama.cpp/vLLM key, so on a cloud dialect it is just an unknown body arg.)*
- **`"off"` is ABSOLUTE** *(AMENDED-2 ⓒ)*: it outranks an explicit `reasoning_tokens` on every dialect
  *(and, per D46's final foreign review F1, also outranks a hand-set `extra_body.reasoning` namespace —
  its controls are pruned and the off signal carried as `reasoning.effort: "none"` so nothing re-enables
  reasoning)*.
- **Transport:** the D42 rule is "params **the SDK models** ride as first-class kwargs". The OpenAI
  SDK's `AsyncCompletions.create` has a **CLOSED signature** (no `**kwargs`) and models
  `reasoning_effort` but NOT `reasoning_budget_tokens` / `thinking_budget_tokens` / `reasoning` — so
  those three ride in **`extra_body`**, the SDK's designated passthrough for un-modeled body keys (the
  `cache_prompt`/`return_progress` precedent). This is not a weakening of the invariant: passing them
  as kwargs raises `TypeError` *before a byte reaches the wire*. Caught by the build audit (see the
  amendment below) and now pinned by a signature test.
- Every other D42 wire invariant survives: unset fields contribute nothing, per-call keys win over the
  endpoint's `extra_body` while its other keys survive (**deep**-merged for the dict-valued vendor
  namespaces `chat_template_kwargs` + `reasoning` — AMENDED-2 ⓑ), and the config object is never mutated.

This **cashes in D42's reserved "a per-endpoint effort-map is the future seam"** — the seam is
spent, and `reasoning_dialect` is the shape it took (a dialect switch, not a per-endpoint mapping
table: the mapping is policy, the dialect is fact about the server).

**Verify** = `test_modelref_wire_w4_slice6.py` §A2 (per-dialect payload shapes · override precedence ·
the `off`/`max` sentinels · the extra_body merge + non-mutation across all four dialects · the
default-dialect back-compat pin); §A's pre-existing tests run on the default dialect and so pin
today's payload unchanged.

**Residual (recorded, not a bug).** `reasoning_tokens` is `ge=1`, so the `0` and `-1` sentinels are
reachable ONLY through the ladder (`off` / `max`) — deliberate: an explicit 0 would be a confusing
second spelling of `off`, and the ladder already owns both ends. vLLM (`thinking_token_budget`) has
no dialect entry yet; adding one is a new `Literal` member plus a branch, which is exactly the shape
this field was chosen for.

*(AMENDED post-audit 2026-07-20 — the build audit's one HIGH, fixed before the feature was ever
exercised:)* ⓐ **The vendor reasoning keys were emitted as TOP-LEVEL kwargs and could never have
worked.** `_call_config`'s dict is splatted into `AsyncCompletions.create`, whose signature is closed;
`reasoning_budget_tokens` / `thinking_budget_tokens` / `reasoning` are not modeled, so every
`llamacpp` call with a reasoning setting — the exact case D45 exists to fix — would have raised
`TypeError`, been wrapped by `_as_inference_error`, and **burned the whole failover chain** before
surfacing a Python error message to the user. Fixed by routing them through `extra_body` (above). The
unit tests missed it because the section-C fake client takes `**kwargs`: a dict-shape assertion cannot
catch a signature mismatch. Now pinned by `test_call_config_emits_only_keys_the_sdk_actually_models`,
which checks every dialect × rung × override against `inspect.signature(AsyncCompletions.create)` and
fails loudly if the SDK ever grows `**kwargs`. **Durable lesson:** when a wire change adds a key,
assert against the REAL client signature, not only against the payload dict you built.
ⓑ **The ladder table is now pinned TOTAL over the effort `Literal`**
(`test_reasoning_budget_table_covers_every_ladder_rung`) — `_resolve_reasoning_budget` looks up with
`.get()`, so a rung added to `ModelRef` without a table entry would have silently sent no budget.
ⓒ ~~**Recorded, not fixed:** the `openai` dialect still passes `off`/`xhigh`/`max` verbatim…~~
**SUPERSEDED by AMENDED-2 ⓓ** — this understated the blast radius: `off` on the default dialect was a
*double* 400 (out-of-enum value AND an unknown `chat_template_kwargs` body key), and the default dialect
is what every existing install runs. `off` now maps to OpenAI's `none`. `xhigh`/`max` still pass
verbatim there, deliberately: they have no OpenAI spelling at all, so silently clamping would lie about
what was asked — point that agent at a dialect that has those rungs.

*(AMENDED-2 post-adversarial-audit 2026-07-20 — five findings against the shipped code, all fixed; the
audit was empirical, every finding reproduced from a real `_call_config` payload:)*
ⓐ ~~**HIGH — the `openrouter` dialect sent `max`, which OpenRouter rejects.**~~ **WRONG — REVERTED by
D46 (2026-07-20, same day).** State it plainly: this finding was derived from a **stale docs page**
(<https://openrouter.ai/docs/api_reference/parameters>), never from the API, and the `max → xhigh` clamp
it produced fixed a **NON-BUG** while silently downgrading effort on the 22 models that *do* support
`max`. **Live experiments against the OpenRouter API (2026-07-20) measured the opposite:**
`reasoning_effort: "max"` on a model whose `supported_efforts` LACKS `max` returns **HTTP 200**, and the
provider's own error text for a genuinely invalid value reads
`Invalid option: expected one of "max"|"xhigh"|"high"|…` — i.e. **`max` is in the enum**, and the enum is
`max | xhigh | high | medium | low | minimal | none`. `_OPENROUTER_EFFORT` is back to `{"off": "none"}`
only; `max` and `xhigh` both ride verbatim. The `"off" → "none"` half survives and is still correct in
general, though it too is per-model: a mandatory-reasoning model answers `effort: none` with **HTTP 400
`"Reasoning is mandatory for this endpoint and cannot be disabled."`** **The durable lesson, and the
reason D46 exists:** `GET /api/v1/models` publishes `reasoning.supported_efforts` **per MODEL**, and
across 339 models the sets vary widely — so **no static provider-level table in this codebase can be
correct**, and adding another clamp is the wrong shape of fix. The residual is handled REACTIVELY
(D46: detect the reasoning-param 400, strip, retry once, remember, warn).
ⓑ **HIGH — an endpoint's own `extra_body.reasoning` defeated the mutual-exclusion guarantee** this
decision calls structurally impossible. `extra.update(body)` was a FLAT merge, so an endpoint with
`reasoning: {exclude: true, effort: high}` plus a per-call effort put BOTH spellings in one request (the
exact hard 400), and a per-call `reasoning_tokens` silently DROPPED the operator's `exclude`. Fixed with
the same deep-merge `chat_template_kwargs` already had, plus two precedence rules: within the merged
object a per-call `max_tokens` evicts any `effort`, and a non-empty merged `reasoning` suppresses the
top-level `reasoning_effort` kwarg — so the two spellings can no longer co-occur on any dialect.
ⓒ **MED — `off` + an explicit `reasoning_tokens` was self-contradictory** and the documented precedence
was false: `off` + 4096 told the sampler "think up to 4096" while the template lever told the model to
emit no thinking block. **Ruling: `off` is ABSOLUTE** — it outranks the override on every dialect
(budget `0`, tokens ignored). `_resolve_reasoning_budget`, the `ModelRef.reasoning_tokens` docstring and
the Conf-UI tooltip now all say the same thing. The pre-existing test
`test_call_config_dialect_branches_keep_extra_body_merge_and_no_mutation` *encoded* the contradiction
(passed `off`+77, asserted only the template half) and was updated to the ruled behaviour.
ⓓ **MED — the `off` template lever leaked to every dialect.** `chat_template_kwargs` is a
llama.cpp/vLLM concept, and this file's own ACA-18 rule is that an OpenAI backend 400s on unknown body
args (why `cache_prompt`/`return_progress` must not ride to the cloud hop); the `none` dialect —
"the server understands no reasoning control, drop both" — contradicted itself outright. The merge moved
INSIDE the `llamacpp` branch, and `openai` now maps `off` → `none`.
**Deliberate back-compat break, recorded:** this changes the default-`openai`-dialect payload for the
`off` case, which the back-compat pin protected. The pin was protecting *unchanged* behaviour, but that
behaviour 400s on any real OpenAI endpoint — a bug-for-bug pin is not a contract worth keeping. The pin
now covers every other rung, and the `off` case is pinned to the corrected payload.
**Migration note (interaction with ⓔ):** someone running llama.cpp on the still-DEFAULT dialect loses
the `off` template lever until they set `reasoning_dialect: llamacpp`. That is exactly the population
ⓔ's warning targets, and setting the dialect is the fix for both.
ⓔ **MED — the feature was inert on every existing install, silently.** `config.yaml` is gitignored and
untouched by the release, so every deployed endpoint keeps the back-compat `openai` default — including
the owner's llama.cpp `inference.local`, i.e. the feature did nothing for the person it was built for,
with zero feedback, and there is no FE surface for the field. Now `warn_suspect_reasoning_dialects`
(called from `runtime.set_inference`, the one config-load/settings-PUT boundary) logs a WARNING naming
the endpoint's config path, its `base_url`, and the exact key to set, whenever a default-dialect endpoint
has a self-hosted-looking `base_url`. The heuristic (`_looks_self_hosted`) is **purely lexical** —
loopback / private range / `.local` / a bare dotless hostname / any non-80/443 port — deliberately **no
DNS and no network probe**: a startup check must not block on the network, and the cost of a false
positive is one advisory log line. The FE `InferenceEndpoint` interface gained `reasoning_dialect?`
(YAML-only, no control yet — typed so the settings round-trip is visibly lossless), and
`deploy/linux/README.md` + `config.example.yaml` now spell out that **the example file is not the live
file**.

## D46 — One explicit `api_mode`, and a reasoning-param 400 is capability FEEDBACK ✏️ LOCKED 2026-07-20

**Context.** D45 shipped `reasoning_dialect` in the morning; live experiments against the OpenRouter API
the same day invalidated two of its premises. ⓐ `max` **is** in OpenRouter's `reasoning_effort` enum
(HTTP 200 even on a model whose `supported_efforts` lacks it; the provider's own reject text for an
invalid value reads `Invalid option: expected one of "max"|"xhigh"|"high"…`), so D45 AMENDED-2 ⓐ's
`max → xhigh` clamp fixed a non-bug and silently downgraded effort on the 22 models that support `max`.
ⓑ `reasoning_effort: "none"` on a mandatory-reasoning model is **HTTP 400 `"Reasoning is mandatory for
this endpoint and cannot be disabled."`** ⓒ The structural finding behind both: `GET /api/v1/models`
publishes `reasoning.supported_efforts` **per MODEL**, and across 339 models the sets vary widely (only
22 accept `max`; many lack `none`/`minimal`). **No static provider-level table can be correct.**

**Decision — three parts.**

**1. The clamp is REVERTED.** `_OPENROUTER_EFFORT` is `{"off": "none"}`; `max`/`xhigh` ride verbatim.
D45 AMENDED-2 ⓐ is corrected in place with the measured evidence. A comment at the constant records that
`supported_efforts` is per-MODEL, so any value can still be rejected — which part 3 handles. **The rule
this sets: never add a clamp for a limit that is per-model. Clamping lies about what was asked.**

**2. `reasoning_dialect` → `api_mode`, absorbing `max_tokens_field`.** One explicit field naming the
wire shape a server speaks, driving BOTH the reasoning translation and the output-cap field name. Values
unchanged (`openai | llamacpp | openrouter | none`, default `openai`).
- **The name** is the Hermes-Agent convention for exactly this concept (Codex's `wire_api` was the
  runner-up). "kind"/"provider" were rejected: *provider* means IDENTITY, and the same model behind
  llama-server vs behind OpenRouter needs opposite payloads.
- **NO `auto`, no hostname inference.** Field research was unanimous across 13 systems: nobody infers
  wire shape from `base_url`, and Hermes shipped URL auto-detection then **retreated** to an explicit
  field with detection demoted to a blank-value fallback. `warn_suspect_api_modes` (D45 ⓔ) stays exactly
  as it was — **advisory only, nothing branches on it**; its job is to tell a human to set the field.
- **`max_tokens_field` becomes derived-with-override**: `Literal[…] | None = None`, where `None` derives
  from `api_mode` (`openai` → `max_completion_tokens`, everything else → `max_tokens`) via the one-home
  `resolved_max_tokens_field` property; an explicit value always wins. This is the **two-layer pattern**
  every mature system uses — one enum plus retained per-capability escape hatches — not a second knob to
  keep in sync. The field only ever mattered for OpenAI reasoning models: llama.cpp aliases BOTH
  spellings (`tools/server/server-schema.cpp` `add_alias`). *Recorded behaviour change:* a default-mode
  endpoint's output cap now rides as `max_completion_tokens` (the current OpenAI name; `max_tokens` is
  deprecated there for reasoning models). Harmless on llama.cpp/vLLM, correct on OpenAI; a strict server
  that wants the old spelling sets `max_tokens_field: max_tokens`.
- **No migration shim**: `reasoning_dialect` existed for hours and `config.yaml` is gitignored, so no
  user can have persisted it. Every occurrence — backend, tests, FE `InferenceEndpoint`,
  `config.example.yaml`, `deploy/linux/README.md`, docs — was renamed. Had any user-reachable persistence
  existed, the fix would have been a pydantic validation alias, never a silent ignore.

**3. A reasoning-param 400 is CAPABILITY FEEDBACK — the app learns what it cannot predict.**
Scope is deliberately narrow: **reasoning controls only**, nothing else.
- **Detect** — `is_reasoning_param_rejection`, a sibling predicate of `is_context_overflow` in the same
  one-home classifier section. A 400 (own `status`, or a failover-flattened `error code: 400`) whose
  message matches a MEASURED param-rejection shape (`Invalid option: expected one of` ·
  `Unrecognized request argument supplied` · `Unsupported parameter` · `not supported with this model`)
  **and** names a reasoning key (`reasoning_effort`, `reasoning`, `thinking`, `*_budget_tokens`), or is
  the self-identifying `Reasoning is mandatory for this endpoint` shape. Deliberately **not** a new
  `ErrorCategory` member: this is handled *inside* a hop, so it must never become a wire-visible retry
  tier or change a hop decision.
- **Degrade** — strip the reasoning controls (`_call_config(strip_reasoning=True)`: ours AND the
  endpoint's own `extra_body` reasoning keys, scoped exactly to `_REASONING_PAYLOAD_KEYS` +
  `chat_template_kwargs.enable_thinking`; every other operator key survives, config still never mutated)
  and re-attempt the **SAME endpoint exactly ONCE**.
- **Remember** — the `(base_url, model)` demotion is kept on the `InferenceClient` for the process
  lifetime, so later turns skip the doomed attempt entirely. Client-instance state on purpose, cleared on
  a config edit by **three paths** (corrected by the final foreign review, F6 + rider — the original "for
  free on any agent edit" was FALSE): an **inference-section** edit rebuilds the whole client via
  `runtime.set_inference` (the `_window_memo` precedent), minting a fresh empty set; an **agent-file**
  edit (the folder-per-agent API) never rebuilds the client, so it clears explicitly through the
  `runtime.clear_reasoning_demotions` hook, called blanket-on-mutation from PUT/DELETE `agent`; and an
  **`agent`-SECTION settings edit** (`agent.defaults` can carry the same reasoning fields, D15 #1)
  clears through the same hook from `reconfigure` (`elif agent_changed` — the F6 rider).
- **Warn LOUDLY, once per `(endpoint, model)`** — RFC 9413 §5.1: a fault must receive attention.
  LiteLLM's silent `drop_params` is the documented anti-pattern; aider's
  `Warning: <model> does not support '<param>', ignoring.` is the model followed, extended with the
  endpoint, base_url, model, the stripped key list and **the provider's own message** so the operator can
  act. The demotion set is both the memory and the log guard — once per pair, never once per turn.
- **The D43 boundary, and it is the crux of the placement:** the re-attempt lives INSIDE `attempt` (both
  `stream_chat` and `complete`), so `failover()` never sees the rejected try. It is therefore **not a
  failover hop** (`FailoverError.failures` / `endpoints_tried` unchanged, no `FailoverNotice`) and never
  reaches `_retry_policy`, so it **cannot consume a `retry_attempts` attempt** reserved for transient
  errors — pinned by a test that degrades successfully with `retry_attempts: 0`. The **permit** is
  untouched: it was acquired before the first `create()` and is released by the single existing handler
  (failure) or handed to the consumer (success); a stripped re-attempt is just a second `create()` under
  the same permit. Bounded to ONE by construction — the second call passes `strip=True`, and the
  demotion check is skipped when already stripped, so re-entry is impossible.
- **Fall-through:** if the stripped payload 400s too, the hop fails normally and the chain moves on. A
  demotion is per `(endpoint, model)`, so the fallback still gets its own full reasoning payload.

**Why reactive at all (the ruling):** prediction requires a table; the limits are per-model; therefore
the table cannot exist. The one authority that knows a model's limits is the provider's own 400, so the
app asks once, listens, and remembers. This is the same shape as D42's reactive context-overflow
backstop, and it is why part 1 is a revert rather than a better clamp.

**Verify** = `test_modelref_wire_w4_slice6.py` §F (the classifier's message matrix + negative matrix ·
strip-only-reasoning-keys · strip-and-retry-once on the same endpoint · the remembered demotion + the
warn-once + the reset on a rebuilt client · no failover hop and no transient attempt consumed · buffered
`complete` degrades identically · persistent-400 fall-through), plus §A/§A2 for the reverted clamp
(`test_call_config_openrouter_max_rides_verbatim`, the enum-coverage test now pinning the real
`max…none` enum) and the derived `max_tokens_field`
(`test_endpoint_max_tokens_field_literal_and_derivation` in `test_compaction_v2_slice6.py`).

**Residual (recorded, not a bug).** The demotion is coarse: it strips ALL reasoning controls, not just
the one rung the provider objected to, so a model that rejects `max` but accepts `high` gets no reasoning
at all until the agent's setting or the client is changed. Deliberate — the finer fix is a per-model
`supported_efforts` fetch (`GET /api/v1/models`), which is a network call at config load and a cache to
invalidate, i.e. exactly the complexity this decision avoids. Revisit only if the coarse demotion proves
annoying in use.

*(AMENDED post-audit 2026-07-20 — an independent adversarial pass over the shipped D46 code. It
confirmed the three load-bearing invariants by EXERCISING them, not by reading: the permit is never
leaked/double-released/released-before-close across eight paths incl. cancellation during either
attempt; the re-attempt never pollutes `endpoints_tried` / `failures` / the notices; and with
`retry_attempts: 0` the degradation still works, i.e. it consumes no transient budget. Four fixes:)*
ⓐ **MED — the key gate false-positived on a model SLUG.** `_REASONING_KEY_NAMES` held the bare tokens
`reasoning` / `thinking`, and the gate substring-scans the whole FLATTENED error text — into which
OpenRouter echoes the upstream body, model id included. So `Unsupported parameter: tool_choice is not
supported with this model {"model":"qwen/qwen3-30b-a3b-thinking-2507"}` classified as a reasoning
rejection: one wasted call, a **permanent** wrong demotion, a WARNING blaming the wrong parameter, and
the real `tool_choice` fault still unfixed. Now **exact wire spellings only** (`reasoning_effort`,
`*_budget_tokens`, `reasoning.effort`, `reasoning.max_tokens`, `enable_thinking`, and the quoted
`'reasoning'` forms for `Unsupported parameter: 'reasoning'`). **Durable lesson: a substring gate over a
flattened error must match the exact wire spelling — provider errors quote your whole request back.**
ⓑ **LOW — the strip dropped `extra_body.reasoning` wholesale**, taking `exclude` with it. `reasoning` is
a NAMESPACE, not a control: `exclude` is a response-SHAPE flag, so a demotion silently started streaming
reasoning back to an operator who had explicitly excluded it. It now gets the same copy-and-replace prune
`chat_template_kwargs` already had — `_REASONING_NS_CONTROL_KEYS` (`effort`/`max_tokens`) out, siblings
survive, the object dropped only if it empties.
ⓒ **LOW — the `status == 400 or "error code: 400" in text` gate was copy-pasted** between
`is_context_overflow` and `is_reasoning_param_rejection`; extracted to `_is_400`, one home.
ⓓ **LOW — "retry the SAME endpoint once" was per-HOP, documented as per-request.** A chain whose
endpoints all reject reasoning pays one extra call PER ENDPOINT on the first request (then zero). That is
correct — each hop must learn its own `(endpoint, model)` capability — but the comment now says so.

**Recorded, NOT fixed (owner's ruling stands, flagged for visibility).** The `max_tokens_field` default
flip (part 2) changes the wire for every existing config, since `config.yaml` is gitignored and untouched
by an upgrade: an endpoint that set neither field now sends `max_completion_tokens` instead of
`max_tokens`. Harmless on llama.cpp (aliases both) and correct on OpenAI, but a **non-OpenAI cloud
endpoint left on the default `api_mode: openai` could 400 on the new spelling**, and that failure is NOT
covered by the D46 feedback path (it is not a reasoning key) — it would burn the chain. The remedy is one
line (`max_tokens_field: max_tokens`, or the right `api_mode`), and `warn_suspect_api_modes` only nags
self-hosted base_urls. Revisit if anyone hits it.

*(AMENDED 2026-07-20 — the FINAL foreign review (Codex), six findings verified against the code and
fixed in one wave. The prior post-audit pass proved the permit/notice invariants by exercising them; this
pass caught six correctness gaps in the reconciliation + classifier + invalidation logic:)*
- **F1 (HIGH) — `off` was not ABSOLUTE against a merged `reasoning` namespace.** On openrouter,
  `reasoning_effort: "off"` set the top-level `"none"`, but the mutual-exclusion tail popped that kwarg
  whenever the merged namespace was non-empty — so an endpoint's `reasoning: {exclude|effort|max_tokens|
  enabled}` silently RE-ENABLED reasoning. Now the off path prunes every control from the namespace and,
  if response-shape flags survive, carries the off signal INSIDE it as `effort: "none"` (OpenRouter's
  documented top-level↔`reasoning.effort` shorthand); an empty namespace is dropped and the top-level
  `"none"` kept.
- **F2 (HIGH) — the mutual-exclusion sweep only evicted `out["reasoning_effort"]`, not
  `extra_body`'s.** An endpoint `extra_body: {reasoning_effort: high}` + a per-call `reasoning_tokens`
  emitted BOTH `reasoning_effort` and `reasoning.max_tokens` — the exact hard-400 pair D45 promises
  impossible, and its "Only one of…" shape is not a degradation marker (deliberately NOT added — the
  emission is prevented instead). The sweep now pops `reasoning_effort` from `extra` as well.
- **F3 (HIGH) — the classifier's key gate scanned the whole flattened text for the param-NAMING
  shapes.** OpenRouter echoes the request/upstream body in `metadata.raw`, so `Unsupported parameter:
  tool_choice … {"reasoning_effort":"high"}` classified as OURS → a wasted retry + a permanent wrong
  demotion. For `Unsupported parameter:` / `Unrecognized request argument supplied:` the gate now
  isolates the token named right after the marker and requires IT to be a reasoning key; the value-shape
  markers (`Invalid option: expected one of`, a bare `not supported with this model`) keep the whole-text
  scan (documented residual). Mandatory-reasoning marker unchanged.
- **F4 (HIGH) — the demotion cache failed a concurrent request's genuine 400.**
  `_note_reasoning_demotion` returned False when the pair was already recorded ("about something else"),
  but under concurrency (no semaphore / `max_concurrent_requests > 1`) a second unstripped request's
  real reasoning-400 arrives after the first records the demotion and would skip its strip-retry. Now:
  compute `dropped` first, and an already-present key returns True (retry stripped) without a second
  warning (a debug line marks the race). Loop-safety is untouched — a stripped-built request never
  reaches `_note`.
- **F5 (MED) — `enabled` is a reasoning CONTROL, not a shape flag.** OpenRouter documents
  `reasoning.enabled: true` as "enable reasoning at the default effort", so a provider that rejected our
  controls rejects it again. Moved into `_REASONING_NS_CONTROL_KEYS`, so both the strip and the F1 off
  prune remove it; only `exclude` survives a demotion. The LOW-2 rationale comment is corrected.
- **F6 (MED) — the "agent edit clears demotions for free" claim was FALSE.** `runtime.reconfigure`
  rebuilds the inference client only when the `inference` section changes, and the file-per-agent API
  never touches runtime — so a demotion recorded for a rejected `max` kept stripping a corrected `high`.
  Made TRUE (not weakened): `InferenceClient.clear_reasoning_demotions()`, exposed through
  `runtime.clear_reasoning_demotions(app)` and called blanket-on-mutation from PUT/DELETE `agent`. The
  field comment, the "Remember" bullet above, and the demotion WARNING wording ("for the rest of the
  process" → "until a config edit clears it") are all corrected. **Rider (same day):** the orchestrator's
  review found a third door the fix wave's brief missed — `agent.defaults` (D15 #1) carries the same
  reasoning fields and rides `PUT /api/settings` → `reconfigure`, which neither rebuilds the client nor
  hit the new hook; `reconfigure` now clears on an `agent`-section change (`elif agent_changed` — an
  inference rebuild already mints an empty set).
- **Verifier NEW-2 (LOW, fixed same day) — a shape-only `reasoning` object no longer evicts the
  requested effort.** The F2 sweep evicted both `reasoning_effort` spellings whenever ANY non-empty
  namespace survived — including one carrying only the non-conflicting shape flag `exclude`, silently
  dropping an operator's/agent's effort to the provider default. Now a namespace carrying a CONTROL
  (`effort`/`max_tokens`/`enabled`) owns the config (evicts both spellings, unchanged), while a
  shape-only object FOLDS the requested effort in (the F1 off-carry pattern; per-call wins over the
  endpoint's hand-set shorthand). Verifier INFO notes accepted as residuals: the off-carry is
  dialect-blind (a hand-set namespace on an `openai` endpoint is already an unknown key there), and
  `_NAMED_PARAM_RE` keeps a trailing dot on an unquoted token (unreachable in the measured shapes).

## D47 — Multi-homed host addressing, Slice 1 (backend) ✏️ LOCKED 2026-07-20 (owner go; design = ROADMAP D3 2026-06-30 + the same-day code-truth amendments)

**What:** a host is reachable at a LAN address AND a VPN/overlay address; the backend picks
server-side with ordered failover. The full design (vantage analysis, measurements, the
hardcoding audit) lives in **ROADMAP §D3** — this entry locks the Slice-1 build contract against
HEAD (code-truth re-verified 2026-07-20; the 2026-06-30 call-site lines were stale and are
corrected in the map below).

- **Schema (additive, generic — no VPN product named in config/logic):** `ComputerCfg` +
  domain `Host` + the `Settings.hosts()` projection gain `vpn_host: str | None = None` (a MagicDNS
  name preferred, or an IP; display label may say "VPN (Tailscale)", the field stays neutral) and
  `ssh_prefer_vpn: bool = False`. The hosts CRUD round-trips both (`HostIn` → `_host_entry` /
  `_apply_fields`; `_host_dto` exposes `vpn_host` — the Conf editor fields themselves are Slice 2).
  CRUD already runs under `runtime.settings_write_lock` (2026-07-20 re-homing) — no new locking.
- **ONE chokepoint resolver:** `host_addresses(host, prefer_vpn) -> list[str]` — ordered,
  de-duplicated, blank/None-dropped candidates; `[ip, vpn_host]` by default, flipped when
  `prefer_vpn` (the `endpoint_chain` blank-drop precedent). A host with no `vpn_host` yields
  exactly `[ip]` — today's behavior, zero change. The LAN>VPN preference lives HERE only, never at
  call sites.
- **Typed SSH error category (code-truth amendment 1):** `SshResult` gains
  `kind: Literal["ok", "auth", "connect", "ssh"]`, set at the existing three `except` sites in
  `adapters/ssh.py` (`AuthenticationException` → `auth`; `SSHException` → `ssh`; `OSError` —
  which absorbs timeout/refused/gaierror/`NoValidConnectionsError` → `connect`). No string-sniffing.
- **ONE shared failover loop (amendment 3):** candidate iteration + a short per-candidate connect
  timeout (a new named const, distinct from the 30s whole-call `SSH_ACTION_TIMEOUT_S` backstop) +
  advance ONLY on `kind == "connect"` — never on `auth` (connected + wrong password is a real
  error) or `ssh`. Lives beside `run_service_command` in `_common.py` (or a thin adapter wrapper);
  the three SSH call sites (`_common.py:107` service control · `shutdown.py:69` · `reboot.py:66`)
  all use it — no triplication.
- **Unchanged on `ip` (explicit):** ping (`fleet.py:46`), port probe (`svc.py:74`), and — Slice-1
  ruling on the design's open point — `svc.url_for` (`svc.py:119`) + the `open_service_url` tool
  stay LAN: the backend has no browser vantage; vantage-aware links are inherently client-side
  (Slice 2's `serviceBase(host, location)`).
- **Interplay verified (2026-07-20):** D44 forced-confirm short-circuits BEFORE approvals for
  `shutdown_host`/`reboot_host` (approval-immune), and grants pin only tool args (`service_id`/
  `host_id`) — the address is resolved server-side, so failover can never break a grant. The
  QH-9 OS-branch allowlist is untouched (the resolver branches on host data, not server OS).
- **Tests (amendment 6):** resolver order/flip/blank-collapse · failover advances on `connect`,
  refuses on `auth` · shutdown still forced-confirms · CRUD round-trips both fields.
- **Out of scope (Slice 2/3, ROADMAP D3):** frontend vantage-aware `serviceBase`, the Conf editor
  address fields + SSH toggle, display lines (incl. the frontier/Hero consumers that postdate the
  design), and the `tailscale status --json` discovery button.
- **AMENDED (2026-07-20, Codex review) — four fixes as shipped, superseding the bullets above where
  they differ:** (1) **Phase-based classification** — the `connect` class is a PRE-connect failure
  only. `run_command` sets `connected=True` right after `client.connect` returns; both `except OSError`
  AND `except SSHException` become `kind = "connect" if not connected else "ssh"` (a post-connect read
  timeout / channel death is terminal `ssh`, never re-executed — a double-run footgun); `Authentication
  Exception` stays caught FIRST as `auth` and is never a failover. So amendment-1's flat `SSHException →
  ssh` / `OSError → connect` is refined to the phase rule. (2) **Split timeouts** — `run_command` gains
  `connect_timeout` (bounds connect + the SSH banner read, via `banner_timeout`; `auth_timeout` left at
  default so a slow-but-succeeding auth isn't cut) separate from `timeout` (exec/read phase); consts
  `SSH_CONNECT_TIMEOUT_S=6` + `SSH_EXEC_TIMEOUT_S=10`. (3) **No-late-execution — TWO layers** (verify
  round 2: the round-1 static pre-gate was insufficient — auth is deliberately unbounded, so no static
  reservation can prove an exec window remains after a slow handshake): **(a) pre-gate** in
  `run_ssh_failover` skips a LATER candidate when connect+exec no longer fits `budget_s` — a cheap
  optimization only, not the guarantee; **(b) measured exec cutoff** is the actual invariant —
  `run_command` gains `exec_cutoff_s` (seconds from call entry after which the command must not begin),
  captures `t0=monotonic()`, and after a successful connect returns `kind="ssh"` ("…not executed")
  WITHOUT calling `exec_command` if the measured handshake already overran the cutoff. The loop passes
  each attempt `exec_cutoff_s = remaining - SSH_EXEC_TIMEOUT_S`, candidate 0 INCLUDED — so the command
  never launches unless a full exec window is left however long connect+banner+auth took, and the
  pre-existing acknowledged single-candidate overrun is now closed too. (4) **Omit-preserves CRUD** — `_apply_fields` touches `vpn_host`/
  `ssh_prefer_vpn` only when the client actually sent them (`model_fields_set`), so the pre-Slice-2
  editor (which never sends them) can't wipe a hand-configured VPN address; explicit null/false still clears.
- **AMENDED-2 (2026-07-20, foreign review round 3) — total-exec budget + slack + the ACCEPTED
  RESIDUAL:** `run_command` gains `exec_budget_s` (the closures pass `SSH_EXEC_TIMEOUT_S`): because
  `exec_command(timeout=)` is only a PER-blocking-op channel timeout and our exec phase is sequential
  (stdin write · stdout.read · stderr.read), it anchors ONE deadline on the `t0` clock and re-slices
  the shared channel's timeout (`stdout.channel.settimeout(remaining)`) before each op, bounding the
  WHOLE phase to `exec_budget_s` instead of ~3×. A new `SSH_BUDGET_SLACK_S=2` is subtracted from every
  attempt's `exec_cutoff_s` and the pre-gate `need` — it absorbs the `to_thread` queue delay + the
  loop-vs-`wait_for` deadline skew (normally sub-ms; seconds only under thread-pool contention). The
  caller's TIMEOUT summary now states the command "was not cancelled and may still be completing on
  the host." **ACCEPTED RESIDUAL (owner ruling, verbatim in substance):** once `exec_command` transmits
  the command the remote host runs it regardless of any local deadline — no client-side arithmetic can
  un-execute it. The layered budget (pre-gate → measured post-connect cutoff → total-exec budget →
  slack) shrinks the late-start window to sub-slack scheduling anomalies; the remaining exposure is a
  TIMEOUT report while a just-started command completes remotely, which the TIMEOUT wording
  acknowledges and which forced-confirm gates on the destructive actions bound in practice. Ruled
  accepted 2026-07-20 (final foreign review round 3); further tightening is not planned.

---

## D48 — Unified provider registry (A11): `providers` + model catalog + flat primary/fallbacks ✏️ LOCKED 2026-07-22 (owner-signed same day)

> **AS-BUILT (Slice 1 — chat, 2026-07-23).** Built per spec through the full pipeline (3 build waves →
> fresh-eyes audit + Codex NO-GO review [3 HIGH, all verified + fixed] → Codex fix-set verification →
> fix round 2); full gate + e2e green. **Two recorded implementation interpretations — BOTH
> OWNER-RATIFIED 2026-07-23:** ① *strict-resolve gating* — C2's "PUT: any error → 422" is enforced for patches
> touching `providers`/`inference`/`agent` — **the Slice-1 set; Slice 2 extended it to `voice` +
> `embeddings`, see the 2026-07-27 amendment below** — while other patches (appearance sync, server, …) run
> lenient + surface warnings, so a hand-edited lenient-tolerated config can't brick unrelated saves.
> ② *B1 model-row typed fields* — only chat-relevant fields (context_window, max_tokens_field, id,
> extra_body) are editable in Slice 1; voice/speed/language/format/dim UI lands with Slice 2's
> consumers (they round-trip unharmed meanwhile, test-pinned). **Concurrency addendum:** the
> providers-base fingerprint rides `GET /api/settings` as the `X-Providers-Rev` response header
> (ETag-scoped-to-subtree pattern) so the Conf draft's base binds atomically to the snapshot it seeded
> from; the PUT envelope + `GET /api/providers` carry it too. **Accepted residuals (recorded):** the FE
> reference-guard blocks a raw id equal to a former catalog key the draft removes (errs toward blocking
> a still-resolvable save; no provenance state) · a hand-authored config holding BOTH `providers:` and
> stale legacy keys never migrates (legacy keys ignored, not deleted) · comments inside deleted legacy
> `inference.local/cloud` YAML blocks are lost at write-back by design.

> **AS-BUILT (Slice 2 — voice + embeddings, 2026-07-23).** Built per spec through the same pipeline
> (2-agent code-truth maps → ruled briefs → backend `e7e60bb` + frontend `29a3712` Opus waves →
> fresh-eyes audit + Codex gpt-5.6-sol high review [NO-GO: 1 HIGH + 5 MED, all verified + ruled] →
> 7-fix wave `a62faa6` → Codex fix-set verification). ONE shared `_build_section_chain` primitive
> (inference refolded, behavior-identical) + frozen `SttPolicy`/`TtsPolicy`/`EmbeddingsPolicy`; one
> registry generation per apply, rebuild-together + publish-then-drain (refcount `retire()` on
> Voice/Embeddings clients); shared FE `SectionRefEditor` (Inference refolded DOM-identically).
> **✅ ALL THREE RATIFIED BY THE OWNER 2026-07-27** ("all good"), which clears the release precondition
> D48 set for itself on 2026-07-23. ③ was ratified **conditionally on the bounded-wait fix** — the A11
> pre-release list's MED, where a capped provider serving chat + STT can park a mic transcription behind
> a long stream and failover cannot advance because the wait happens *inside* the attempt; ratifying the
> principle without bounding it would have locked in that edge. The three, as ratified: ① providers referenced ONLY by
> voice/embeddings sections are EXCLUDED from advertised composer verbs (the no-capability-tags
> principle — the referencing section determines usage — read as overriding C7's sole-model-advertising
> letter; typed routability unchanged) · ② `X-Voice-Served-By` now carries the SERVED PROVIDER NAME
> (was `primary`/`fallback`; richer for the single-user surface, no programmatic consumer; docstring
> updated) · ③ voice/embeddings attempts ACQUIRE the shared D40 gates when the target's effective cap
> is finite (read as implied by C4/C10 — the cap rides every `ResolvedTarget`; None = no acquisition).
> **Hardening shipped with the slice (review catches):** `config.yaml` is now guaranteed **0600 through
> EVERY writer** (fd-open 0600 tmp + `os.replace`; a pre-existing umask bug had been degrading it to
> 0664 — self-heals) · the migration write-back derives from **DISK-TRUTH** (the fold runs twice; an
> env-override secret is used at runtime but never materialized into YAML — one warning names the new
> `providers.*.api_key` home) · migrated model fields accrete per-field into existing catalog entries ·
> collision suffixes respect the 32-char slug cap · the FE rename cascades to voice/embeddings draft
> selectors (C1) · the FE reference-guard also mirrors the blank-primary-with-fallbacks and
> model-omitted-on-multi-model strict 422s inline.
> **Accepted residuals (extending Slice 1's):** mixed-shape hand-authored docs are subtree-level
> new-wins for voice/embeddings too (a subtree holding BOTH `provider:` and `primary:`/`fallback:`
> never folds — legacy ignored, not deleted) · a blank legacy voice endpoint `model` migrates to the
> role's effective wire default (`whisper-1`/`tts-1` — what the adapter actually sent; lossless parity)
> · `VoiceReply.degraded` was dead before this slice and stays (field kept, unconsumed) · voice
> sections have deliberately NO failover toggle (chains always walk — today's semantics preserved) ·
> **env-only LEGACY secret, transition window** (Codex verify residual, ruled accepted): the write-back
> itself is disk-truth-clean, but a provider-dirty Conf save DURING the migration window round-trips the
> runtime (env-carrying) provider map through mask→unmask and persists it — needs legacy config + env-only
> legacy key + a providers edit before migration settles; post-migration env can't address
> `providers.*.api_key` at all (one-level env paths), and the FX-B boot warning names the move; a
> provenance-tagged fix was judged disproportionate. **Codex fix-set verification: GO-with-changes**
> (1/3/5/7 + the FE guard CLOSED; 2/6/8 assessed internally consistent with the rulings; no new defects).

> **✏️ AMENDED (pre-release, 2026-07-27) — the A11 fix list, and the two clauses it changes.** The
> parked deep audit (Fable 5, the full `v1.2.1..HEAD` backend diff) returned **SHIP WITH THESE FIXES**;
> they are built (`8841386` + `4a056aa`) and this is what they change in the letter of D48. The release
> is UPDATE_PLAN slice 8.
> - **The secret write path gains a shape-only predicate.** `_is_unchanged_secret` can recognise a mask
>   only by rebuilding it from the stored value, so a mask with **no** stored counterpart was taken as a
>   new value and written to disk **as the credential** (delete-then-recreate · a rename submitted
>   without `provider_renames` · any hand-built PUT). New `looks_masked()` judges the shape alone — a
>   five-codepoint value with `…` in the middle, or `••••` — and the write path **drops** such a key; the
>   field's answer too (R6: AnythingLLM filters `"******"`). A mask means "unchanged"; with nothing to
>   keep unchanged, the honest result is no value. *(The first implementation used
>   `re.fullmatch(r".{2}….{2}")`, where `.` excludes newline, so a credential with a trailing newline
>   still round-tripped its mask onto disk — the MUST-FIX with a hole in it, found by Codex pre-release.)*
>   **Blank-keeps remains a SECRET affordance:** the credential-map branch restores a stored value only
>   for `_map_key_is_secret` entries, matching the leaf branch's `_SECRET_LEAF_KEYS` gate — a non-secret
>   `env`/`headers` entry, which is displayed raw, takes an explicit blank and stays clearable.
> - **C2/R8 fingerprint — `providers_rev` now hashes the MASKED subtree**, not the raw one. It is
>   published beside the masked values (`X-Providers-Rev`, `GET /api/providers`, the PUT envelope), so
>   hashing raw secrets made the pair an offline verification oracle. The only sensitivity lost is a
>   rotation to a same-mask value, which cannot be clobbered by the draft that missed it (a stale mask
>   restores whatever is currently stored).
> - **C4 gate — the acquire is BOUNDED for the buffered sections.** Ratification ③ was conditional on
>   this: the wait sits *inside* the failover attempt, so an unbounded one cannot fail over. A timeout is
>   a **failed hop** — the chain advances. One seam: `EndpointGates.hold(target, wait_s=…)`. **The budget
>   is short only while there is somewhere to advance to** (the ruling on the one point the two
>   pre-release reviewers split on — Codex: a 3s connect budget makes a single-provider capped chain fail
>   just before it would have succeeded; Fable: `connect_timeout_s` is the semantically right budget for
>   "cannot reach a slot". Both hold, for **different hops**): voice waits `connect_timeout_s` while a
>   next hop exists and `timeout_s` on the last one; embeddings has no connect budget, so the rule
>   collapses to `timeout_s`. **The budgets reject `inf`/`nan`** (`allow_inf_nan=False`): `timeout_s:
>   .inf` is valid YAML and passes `gt=0`, and would have restored the indefinite park the bound exists
>   to remove — a bound is only a bound if no config value disarms it. Chat keeps the unbounded wait by
>   design (queueing behind the previous turn
>   on the same box is correct) — the honest boundary is **lexical vs stream-lifetime permit scope**, not
>   voice-vs-chat: the streaming permit crosses a generator boundary and releases after a shielded close,
>   which no context manager can express. The buffered chat site is a third hand-rolled copy that
>   `hold(ep)` would replace exactly; deliberately NOT touched in a release-day commit (Fable).
> - **Interpretation ① is recorded one subtree-set out of date.** Slice 1 ratified strict-resolve
>   enforcement for patches touching `providers`/`inference`/`agent`; Slice 2 correctly extended the
>   trigger set to **`voice` and `embeddings`** (every home the registry reads) — pinned by
>   `test_strict_422_on_voice_ref_break_but_lenient_on_unrelated_put`. The consequence, worth knowing
>   before the first voice edit on prod: a dangling voice fallback now 422s **any** voice save.

**Context — what this retires.** Today inference hardwires a `local` + `cloud` pair (`InferenceEndpointCfg`
× 2) plus a third `fallbacks[]` shape; voice hardwires `primary`/`fallback` slots per role
(`VoiceEndpointCfg`); embeddings is a single endpoint with no failover. Every connection field is homed
three-plus ways, and the Conf UI renders a Local-block / Cloud-block / Fallbacks trio that does not scale
past two roles. A11 replaces all of it with **one top-level `providers:` map of CONNECTIONS**, each
carrying a name-keyed **model catalog**, and gives every consumer section (`inference`, `voice.stt`,
`voice.tts`, `embeddings`) a **flat `provider` primary + ordered `fallbacks[]`** of `{provider, model?}`
refs. This is the owner's "shape data to extend, not migrate" rule applied end-to-end: the next connection
knob is one additive field on `ProviderCfg`, the next per-model datum one additive field on `ModelCfg` — no
new parallel sibling maps. Config-only; **no DB schema change**.

**Final config shape** (the owner's real fleet; the API key is a placeholder — the real value is
gitignored in `config.yaml`):

```yaml
providers:                       # top-level name-keyed map: connection + server behavior + model catalog
  llamacpp:                      # slug ^[a-z0-9][a-z0-9_+.-]{0,31}$ (exact limit 32); the /llamacpp verb
    base_url: http://192.168.1.137:5001/v1
    api_mode: llamacpp           # openai | llamacpp | openrouter | none  (D45/D46 enum KEPT)
    max_concurrent_requests: 1   # SERVER capacity — provider-level; the D40 semaphore keys here (C4)
    models:                      # name-keyed catalog; KEY = clean display name, id defaults to key
      minig+:
        context_window: 32768    # chat; D42 precedence: explicit > /props probe > None
        extra_body:              # chat-call passthrough — MODEL-level home (never provider-wide)
          cache_prompt: true
  openrouter:                    # the /openrouter verb
    base_url: https://openrouter.ai/api/v1
    api_key: sk-…                # optional; omitted = no-auth. Masked in the API; blank-keeps on PUT
    api_mode: openrouter
    models:
      qwen3.5:
        id: qwen/qwen3.5-72b     # wire model id sent to the server (auto-hidden in UI when == key)
        context_window: 262144
      qwen-embed:
        id: qwen/qwen3-embedding-4b
        dim: 2560                # embeddings-scoped model field
  speaches:
    base_url: http://emma:9000/v1
    models:
      parakeet:
        id: istupakov/parakeet-tdt-0.6b-v3-onnx   # STT
      kokoro:
        id: speaches-ai/Kokoro-82M-v1.0-ONNX
        voice: bf_isabella       # TTS-scoped model field (voice ids are model-specific)
  vault-whisper:
    base_url: http://192.168.1.137:9000/v1
    models:
      whisper-large-v3:          # bare key → ModelCfg() defaults, id = key
  vault-alltalk:
    base_url: http://192.168.1.137:7851/v1
    models:
      tts-1:

inference:                       # request_timeout_s / system_prompt* / failover / retry_attempts STAY
  provider: llamacpp             # PRIMARY (flat); model omittable iff the catalog has exactly one model
  fallbacks:                     # ordered, N-deep; each {provider, model?}
    - provider: openrouter
      model: qwen3.5             # multi-model provider → must name the clean model
voice:
  stt:                           # language / vad_filter / hotwords / auto_send / timeouts STAY
    provider: speaches
    model: parakeet
    fallbacks:
      - provider: vault-whisper
  tts:                           # format / timeouts STAY
    provider: speaches
    model: kokoro
    fallbacks:
      - provider: vault-alltalk
embeddings:                      # enabled / timeout_s STAY
  provider: openrouter
  model: qwen-embed
  fallbacks: []
```

**Module boundary** (the layering is normative — no consumer reads live `Settings`):

- **`domain/provider.py`** — frozen value types only. `ResolvedTarget` (frozen): provider name +
  connection (base_url, `api_key: SecretStr` with `repr=False`, api_mode, resolved `max_tokens_field`) +
  wire model id + model metadata (context_window, extra_body, language / voice / speed / format / dim) +
  `gate_identity` + the effective `max_concurrent_requests` (post min-wins) + the effective
  `retry_attempts` (provider > global). Plus one frozen **`SectionPolicy`** snapshot per call-site (chat:
  request_timeout_s / failover / global retry; stt: language / vad_filter / hotwords / timeouts; tts:
  format / timeouts; embeddings: timeout_s) — captured at resolution, never live Settings.
- **`core/provider_registry.py`** — strict/lenient policies, ref resolution, chain construction. Owns the
  `(gate_identity, limit)` registry keying + generation-drain (extends `test_inference_gate_d40`) and the
  SDK-client caches. **Adapters consume `tuple[ResolvedTarget, ...]` only**, never live Settings.
- **Services** consume the SERVED target: `StreamReport.served_target` replaces `served_endpoint`, so
  compaction prices against what actually served.
- **`config.py`** keeps YAML parsing, the one quarantined `_migrate_legacy()` fold, and the
  `ProviderCfg`/`ModelCfg` schema. It owns **no** runtime caches or gates.
- **`core.failover`** stays the ONE async failover walker shared by chat/voice/embeddings — A11 changes
  what feeds it (a resolved-target tuple), not the walker.

**Generation publication** (replaces the current close-before-publish scalar swap): `runtime.py` builds ONE
immutable registry generation per settings apply. A `providers` change rebuilds inference + voice +
embeddings adapters **together** (today's per-section change detection gains the `providers_changed`
trigger). Build all three new adapters first, **publish the generation atomically, retire the old one by
DRAIN** — in-flight turns/streams finish on their captured generation; clients close only when the old
generation's refcount empties. SDK-client caches key by provider name (chat) or by provider name + immutable
transport options (voice timeout pair) and die with their generation; the D46 demotion cache keys
`(provider, wire model id)` and clears on ANY `providers_changed` edit affecting
api_mode/connection/credentials/model-resolution, in addition to today's inference/agent-edit clears.

### Normative contracts (final — C1–C11 with all round-3 (A1–A7) and round-4 (F1–F6) amendments folded in)

**C1. Rename, map mutation, secret handling.**
- The settings PUT body gains `provider_renames: {old_name: new_name}` (optional) — **PUT transport
  metadata**: a request-model field, stripped before `Settings` validation/persist; it never lands in YAML
  (`Settings` `extra=allow` cannot retain it). Only **simple bijective** renames: old must exist, new must
  not (except as its own old); no chains/swaps/cycles/duplicate destinations → **422**.
- Applied ATOMICALLY, in this exact order: **(1)** rekey the stored provider entry, restoring its secret by
  its OLD structural identity; **(2)** apply the `providers` replacement + the rest of the patch; **(3)**
  cascade every config-held ref STILL equal to the old name in the FINAL MERGED doc; **(4)** an explicit
  incoming change to a *third* provider is preserved untouched. A real (non-masked, non-blank) incoming
  secret WINS over restoration. **Mask-matching is dead** — masks are not injective, so identity, not the
  masked string, drives restore.
- **Cascade list is explicit + closed**: section primaries/fallbacks (inference / stt / tts / embeddings) +
  EVERY config-held `ModelRef` home — `agent.defaults.model`, `agent.defaults.compaction.summarizer`, the
  **global `agent.compaction.summarizer`** (config.py:320), `agent.defaults.routing.lead`, plus any nested
  `ModelRef` the domain adds later via one shared walk helper. The UI rename control ALSO rewrites the
  visible draft selectors; the **backend ordering is authoritative**.
- **`providers` uses REPLACEMENT semantics** in the PUT (the UI always submits the complete map;
  `sync_mapping`-style replace, never `deep_merge`) so deletes and renames work and absent keys are removed.
  All other subtrees keep documented-merge behavior.
- **Secret handling is PATH-AWARE inside name-keyed maps**: map KEYS never trigger secret-leaf
  masking/unmasking; only the schema `api_key` FIELD of a provider/model object does. As defense-in-depth
  the PUT **rejects** provider/model names that collide with a secret sentinel key (`api_key`,
  `ssh_password`, `password`, `token`, …). (Regression tests cover provider names `api_key`, `ssh_password`,
  `env`, `headers`.) `providers.*.api_key` joins the SECURITY_MODEL secret-leaf list.
- Dangling refs OUTSIDE `config.yaml` (`agents/*/agent.yaml`) stay graceful-degradation: warn + default
  chain at load; the agents editor shows the dangling state. **No cross-file transactions.**

**C2. Two explicit resolution policies + concurrency 409.** `core/provider_registry.py` exposes
`resolve_strict(cfg) -> Registry | list[RegistryError]` (PUT: any error → **422** with the error list) and
`resolve_lenient(cfg) -> (Registry, list[str])` (boot: warn + drop/promote per C5). Lenient warnings surface
in logs AND on `GET /api/providers`. The PUT response envelope gains `warnings: string[]` for non-fatal
notices (catalog-key-shadows-wire-id, provider-name-shadows-skill). **Concurrency safety**: the `providers`
subtree carries a **base revision/fingerprint**; a PUT whose `providers` base does not match → **409** (a
full-map replacement must not silently delete another client's addition). The existing agent-busy 409 stays;
A7's drain covers the runtime side, so **no new blanket gate** is added.

**C3. Migration** (full algorithm in the next subsection): a raw-YAML normalization BEFORE Pydantic
validation, per-subtree idempotent, `new-wins` per destination field, deterministic. Write-back of consumed
legacy keys is deferred to the ONE atomic materialization at the YAML-write chokepoint (C-b / F5) on the
first successful write.

**C4. Gate identity + generations.** `gate_identity` = the canonical full base_url (scheme+host lowercased,
default ports elided, trailing slash stripped, **path preserved** — different paths = different gates by
design). The D40 registry keeps its `(gate_identity, limit)` keying + generation-drain (pinned by
`test_inference_gate_d40`): a live limit change mints a new draining generation, exactly as today. **None =
unlimited.** All providers sharing a `gate_identity` must declare the same effective
`max_concurrent_requests`, where `None ≠` any finite value: strict PUT **422**s a conflict; lenient boot
warns and takes **min of the finite declared values** (`{None, 2} → 2`) onto every affected
`ResolvedTarget`. A future explicit `concurrency_group` is the sanctioned escape hatch for aliased URLs of
one physical server — **never inferred**.

**C5. Resolution rules.** Duplicate-target identity = (canonical base_url, credential identity [compared,
never logged], wire model id, api_mode); a PUT **422**s duplicates within one section's primary+fallbacks,
boot dedups + warns (keeps D43 budgets + `endpoints_tried` honest). **Model omission** = the
sole-catalog-model rule (0 or ≥2 models → strict error / lenient drop). **Blank/absent primary with
configured fallbacks**: PUT **422**; lenient boot **PROMOTES the first valid fallback** (runtime-only, the
persisted doc untouched — preserves today's voice "configured if any endpoint survives"). No valid targets
at all → service unconfigured (mic hidden / embeddings off / chat 422s). An **UNCATALOGED raw model id**
(ModelRef passthrough): `context_window=None` BUT still `/props`-probe-eligible iff the provider's
`api_mode == llamacpp` (D42 intact: explicit > probe > threshold-fallback); the probe key and D46 demotion
key are `(provider name, wire model id)`, **never provider alone**.

**C6. `max_tokens_field` ladder.** model explicit > provider explicit > derived-from-`api_mode` (D46).
`resolved_max_tokens_field` lives on `ResolvedTarget`; the wire boundary reads **only** that.

**C7. Mode/verb plumbing.** Request models (`ChatRequest.mode`, resume `mode`) do **syntax-only** slug
validation — they cannot see settings; resolution against the CAPTURED registry coerces unknown → None →
default (logged). DB/suspended-turn parity is KEPT and **not extended**: per-call mode is in-memory
(`TurnHandle`) and documented as not surviving cold reload (ACA-16 cross-reload persistence is not claimed
today and A11 doesn't grow it). FE `ChatMode` → `string | null`; reattach preserves arbitrary snapshot
strings. A new lightweight, non-secret **`GET /api/providers`** (names + per-section effective defaults +
the backend-canonical reserved-verb list + live skill-collision warnings) is the composer's source for
`/<provider>` verbs; the Conf-scoped settings query stays Conf-only. **Collisions**: a PUT rejects provider
names equal to backend-canonical built-in verbs; a provider name shadowed by a LATER-created skill resolves
**built-ins > skills > providers** with a warning surfaced in both editors (no hard rejection against the
moving skill set — the collision function is ONE backend-canonical helper, recomputed live, never frozen at
save time). `/⁠<provider>` selects **that provider's effective-chain model** (or its sole catalog model): the
chosen target → the normal effective chain deduped (`failover=False → [chosen]`). A provider appearing
multiple times in a section resolves to its **first configured occurrence's model**. A `ModelRef.model`
clean name is provider-relative and never carried across providers; an explicit raw-id `ModelRef` still
passes through. Providers **absent** from the inference chain are composer-routable only when their catalog
has exactly one model; multi-model non-chain providers are not advertised as verbs and coerce to default
(logged).

**C7-b. Universal pointer rule (owner, 2026-07-22).** EVERY subsystem that selects an inference
backend+model does so via the SAME `ModelRef {provider, model}` against the SAME registry — `AgentDef.model`
(per-agent + `agent.defaults`), `CompactionCfg.summarizer` (the global `agent.compaction` home + the
per-agent override, subagent-inherited), `RoutingCfg.lead` (D43) — one resolver, one `ResolvedTarget`
path, **no subsystem-private backend-selection mechanism**. Correspondingly, every FE surface that renders
a `ModelRef` selector — including `AgentsEditor`'s hardwired local/cloud backend `Seg` — becomes the shared
provider → model picker pair fed by `GET /api/providers` (model picker scoped to the chosen provider's
catalog, free-text raw-id escape kept for uncataloged models).

**C8. Voice + embeddings semantics.** TTS voice precedence = **request > model voice > protocol fallback
`"alloy"`** (no service-level voice field exists — parity); model `speed` is a TTS request param
(`model.speed > 1.0` default), consumed at the wire like voice. STT language = model > service (no
request-time language today — parity). **Format**: each failover attempt returns `(bytes,
effective_format)`; the response media type is the WINNING hop's resolved format (model format > service
format), never precomputed. **Embeddings**: strict validation requires all non-null `dim` in a chain to
AGREE (PUT **422** / boot drop-mismatched + warn); failover is otherwise identical to voice.

**C9. Effective-chain & warnings lifecycle.** Lenient promotions are runtime-only; the effective default is
what `GET /api/providers` reports. `config_warnings` are response/runtime-only (never `Settings`/YAML): each
settings apply atomically REPLACES the prior generation's warning set. `GET /api/settings` stays naked
(unchanged FE contract); warnings ride the PUT-response envelope AND `GET /api/providers` (which the Conf
page + composer already query).

**C10. Adapter/service consumption.** Adapters receive `tuple[ResolvedTarget, ...]` + the per-call frozen
`SectionPolicy`; they call `api_key.get_secret_value()` at the wire only. Services read
`StreamReport.served_target`. No layer below `config.py` parses YAML or holds a live `Settings`.

**C11. Test matrix (SYS-14 gate).** New tests: migration (shape conversion, order preservation,
idempotency, legacy-key deletion, dedup + collision suffixes, per-destination fill, first-writer-wins delete
whichever PUT lands) · rename atomicity + secret restore + replacement semantics + the cascade list incl.
the global summarizer · **secret path-awareness regression** (provider names `api_key` / `ssh_password` /
`env` / `headers`; sentinel-collision rejection) · gate (canonicalization, None-conflict, min-wins,
generation drain — extends `test_inference_gate_d40`) · dynamic mode strings end-to-end (verb → request →
resolve → breadcrumb) · voice winning-format + precedence · embeddings dim agreement · strict-vs-lenient
policy pairs · uncataloged-model probe eligibility · duplicate-target rejection · the providers-base 409 ·
generation-drain publication · and the B4 parity list asserted field-by-field in the Conf e2e (incl.
inference timeout + both prompt controls, STT controls/timeouts, TTS auto-read/format/timeouts, embeddings
dim/enabled).

### Migration algorithm (`_migrate_legacy()`, raw-YAML, pre-Pydantic, per-subtree idempotent)

1. **Chat** (runs iff `providers`/new-shape `inference` absent AND legacy keys present): the selected slot
   (`default_mode`) → `inference.provider`; the OTHER slot → `fallbacks[0]`; legacy `fallbacks[i]` →
   `fallbacks[i+1]` — preserving today's `[selected, other, *fallbacks]` chain **exactly**. Provider names
   derived from `api_mode` (llamacpp / openrouter / openai / none; collision → `-2`, `-3`…). Models: a
   catalog entry keyed by the old model string (name == id, lossless).
2. **Voice / embeddings** (each iff its subtree is legacy-shaped): endpoints deduped by (canonical base_url,
   api_key) — **against already-created providers too** (reuse, don't duplicate; this merges a speaches
   STT-primary + TTS-primary into one provider); remaining unnamed = host-port slug. Old per-endpoint
   voice/model fields land on the created model entries; service-level values are NOT copied to model
   entries.
3. **`new-wins` per DESTINATION FIELD** when both shapes are present; each missing new destination fills
   independently from its legacy source (never overwriting an explicitly present new field). Blank endpoints
   dropped. Boot normalization is deterministic + idempotent (re-running on the migrated doc is a no-op).
4. **Write-back** of consumed legacy keys is a single explicit delete-list channel that fires on ANY
   successful config write, materialized at the ONE atomic YAML-write chokepoint (F5): all materialized
   new-shape destinations + the caller's mutation + all consumed-legacy deletions are written together, so
   it covers ALL writers — including host/integration CRUD that bypass `apply_settings_patch`. A
   409-rejected request triggers **neither** cleanup **nor** backup. One-line migration report logged.

### Conf UI management spec (owner requirement: manage providers as clearly as today's Conf)

- **B1 — new "Providers" ConfGroup** directly above Inference (group numbering is render order). One card
  per provider (the D18 inline-fallbacks editor is the list-edit precedent, grown to cards): name (with an
  explicit **Rename** control feeding `provider_renames` — never a bare text edit of the key), base_url,
  api_key (masked display, blank-keeps), api_mode seg, max_concurrent_requests, retry_attempts,
  max_tokens_field (advanced row), and a **Models** sub-list: rows of clean name + id (auto-hidden when ==
  name, with an explicit **reveal/edit** affordance) + the typed per-role fields (context_window, language,
  voice, speed, format, dim) + extra_body (JSON text row, existing pattern). Add/remove provider cards;
  add/remove model rows.
- **B2 — delete/rename guard**: removing a provider (or renaming/removing a model clean name) that any
  section/agent-defaults references shows the referencing list inline and blocks the save — the same inline
  reference-guard for providers AND models, pre-checked from the same draft (the strict PUT would 422
  anyway; one source of truth).
- **B3 — section editors** (Inference / Voice STT / Voice TTS / Embeddings): primary = provider select +
  model select (scoped to the chosen provider's catalog; auto-hidden when the catalog has exactly one model
  — the terse-config rule mirrored), labeled **"Default"**; fallbacks = ordered add/remove/reorder rows of
  the same picker pair. Failover switch + every existing service knob (language / vad_filter / hotwords /
  auto_send / format / timeouts / enabled) stays exactly where it is today.
- **B4 — parity table** (nothing loses editability): `default_mode` → primary picker · local/cloud blocks →
  provider cards · D18 fallbacks editor → fallback rows · voice primary/fallback → voice pickers · embeddings
  endpoint fields → embeddings picker + its provider card. Draft / saveBar semantics unchanged (one draft,
  whole-doc save; the `providers` subtree rides it with replacement semantics + the renames metadata).
- **B5 — draft epoch + warnings**: the Conf draft gains an **epoch** — it NEVER reseeds a dirty draft, and
  reconciles only the submitted snapshot on save success (F3). PUT-response warnings render inline in the
  owning group (existing error-row pattern); boot/lenient warnings arrive via `GET /api/providers` and
  render the same way on load.

### Production rollout & rollback (owner requirement: a clean prod update)

- **Upgrade path**: prod (`~/apps/ctrl-b` tag-pinned, config at `~/.ctrl-b/config.yaml`, old shape) boots
  the A11 release → lenient in-memory migration → IDENTICAL runtime behavior (the chain order and
  voice/embeddings semantics are preserved). No DB change.
- **One-time pre-migration backup** (F5/C-b): the FIRST config write that will delete legacy keys writes
  `config.yaml.bak-a11-<UTCstamp>` beside the config, **mode 0600, before replacement** (guarded by
  legacy-keys-present; the Hermes backup convention). Logged prominently. A 409-rejected write makes no
  backup.
- **Rollback contract** (also in `deploy/linux/README §Release`): BEFORE the first write-back, rollback to a
  pre-A11 tag is free (config untouched). AFTER it (F6 ordering): **stop prod → restore the `.bak-a11-*`
  file (0600) → previous tag → start + health-check.** Old code cannot read `providers:` — by design there
  are no forward-compat seams. Dev (`:5434`, `~/.ctrl-b-dev`) and prod are **separate `CTRLB_HOME` roots**;
  no cross-race.
- **Order**: the dev instance exercises the migration + a full Conf round-trip first (the runbook's
  dev-first rule); the release gate runs e2e, so no stale selectors ship. `config.example.yaml` ships
  **new-shape only**; README config section, SECURITY_MODEL (`providers.*.api_key`), and DEPLOY_EMMA update
  in the SAME slice as the UI — no doc drift.

### NO-LEGACY-SEAMS (owner directive, normative)

Legacy awareness lives in exactly ONE quarantined place: the `_migrate_legacy()` raw-YAML fold at the
config-load boundary (+ the same `mode:`→`provider:` fold for `agent.yaml` load). Everything downstream —
schema, resolver, adapters, API, FE — knows ONLY the new shape. **Deleted outright**: the local/cloud slots,
`endpoint_chain`, `VoiceEndpointCfg` + its primary/fallback fields, `EmbeddingsCfg`'s single-endpoint
fields, the hardwired `local|cloud` literals in `_coerce_mode` / `ChatRequest` / the composer switch /
`ChatMode`, and ConfTab's three endpoint blocks.

### Research provenance

Five web-research passes informed the shape: LiteLLM / Continue / LibreChat / Crush / OpenCode / Hermes /
Codex-CLI / Home-Assistant conversation pipelines / Airflow / Grafana provider-and-connection surveys, plus
the OpenAI / Speaches / AllTalk audio-parameter specs for the per-model voice/speed/format/language homing.
Findings that hardened into rules: **no capability tags** — the referencing section determines usage
(HA-pipeline rule); **first-in-chain is the default** — no separate default pointer (LibreChat/Continue);
migration = dual-read + write-back on next save (Continue.dev precedent); the pre-migration backup follows
the Hermes convention. The `api_mode` enum values (`openai | llamacpp | openrouter | none`) were
**re-verified** as the wire-dialect convention with no canonical standard — the Crush/Goose/Cline
discriminator — so **D45/D46 are KEPT unchanged**.

### Review history

Four foreign-review rounds (Codex gpt-5.6-sol): **NO-GO** (round 1 — structural: fields wrongly homed,
rename-cascade and secret-round-trip holes) → **NO-GO** (round 2 — mask-matching not injective [HIGH-1],
gate/probe keys keyed by provider alone, model-omission ambiguity) → **GO-with-changes** (round 3 — 7
must-fix items, folded here as A1–A7: ResolvedTarget completeness, exact rename transaction,
per-destination migration, gate None semantics, effective-chain construction, warnings lifecycle, generation
publication) → **GO-with-changes, final** (round 4 — 6 must-fix items F1–F6: global-summarizer cascade +
ordering, path-aware secret handling + sentinel rejection, draft epoch + providers-base 409, model-id
reveal + model reference-guard + field-by-field parity assertions, one atomic write-back covering
CRUD writers + 0600 backup, and the stop→restore→retag→health rollback ordering). All six are folded into
C1–C11 above; the design is **CLOSED pending owner sign-off**.

### Supersedes / preserves

- **Supersedes** the local/cloud slots of D18's chain shape and `VoiceEndpointCfg`'s primary/fallback
  fields (both DELETED per NO-LEGACY-SEAMS); the explicit `default_mode` pointer (first-in-chain replaces
  it); and the single-endpoint `EmbeddingsCfg` (embeddings gains failover for free).
- **Preserves** D17 (streaming decoupled per transport), D40 (the concurrency semaphore held for the whole
  streamed response + `(gate_identity, limit)` generation-drain), D42 (context_window precedence explicit >
  probe > None + ModelRef call config), D43 (failover generator + per-provider retry override + typed retry
  visibility), and D45/D46 (`api_mode` wire-dialect enum + `max_tokens_field` derivation). `core.failover`
  stays the ONE walker.

## D49 — Scheduled agent automations (A3): SQLite records + poll-and-claim runner + origin attribution ✏️ LOCKED 2026-07-30 (owner-signed same day)

**Spec authority = [`AUTOMATIONS_PLAN.md`](./AUTOMATIONS_PLAN.md) (design v2, post-council) — build
against it, not this summary.** Evidence: R7/R8/R9 dossiers + seam map; council = Codex (15
findings) + Opus architecture (12) both SHIP-WITH-CHANGES, all folded; confirm round clean.

**Locked shape:**
- **Records in SQLite** (`automations` + `automation_runs`, migrations v4/v5 split per the
  append-only rule; v4 = attribution only). Rationale: agent-writable records must never brick the
  config-validated boot. Config gets only the `automations:` tunables section.
- **Scheduler = hand-rolled lifespan poll-and-claim loop + `cronsim`** (new pinned dep, +
  `tzdata`). Claim = one BEGIN IMMEDIATE txn (verify enabled+rev, misfire-classify against
  `misfire_grace_s` → `missed` row without invoking, advance `next_run_at` from now, freeze an
  execution snapshot). APScheduler/croniter rejected on R7 evidence.
- **Owner rulings:** question policy `skip|use_default` (default use_default; confirms ALWAYS
  follow the privilege/approvals ladder — a stored prompt is not consent) · concurrency 1 via one
  global arbiter shared with run-now (409 when busy) · misfire = skip · fresh thread per run
  default + per-automation `rolling` mode (`pinned` = future arm, single `thread_id` column) ·
  create tool ships in v1.
- **Runs ride the existing turn machinery** (reserve kind="automation" → `_build_session` →
  `_spawn_drain_task`; timeout via `cancel_turn`; honest terminals incl. `interrupted`; boot
  orphan sweep; `keep_runs` retention pruning runs + their threads).
- **Headless session options object:** `message_actor=AUTOMATION`, reflection disarmed (the
  depth>0 proxy re-expressed), explicit compaction/steer/routing state, strict agent resolution
  at claim (a missing named agent FAILS the run — never falls back to the default agent).
- **Attribution (R9):** `events` gains `origin` (required kwarg at the invoke chokepoint) +
  `origin_id` + `run_id` + `decision`; `actor` semantics unchanged; origin propagates through
  `run_subagent` in v1; ancestry predicate = non-null `run_id`.
- **`create_automation`** builtin: create-only (delete/edit withheld from the model — field
  consensus), `confirm=True`, cap in the shared write service (TOCTOU-closed), in-tool DENY for
  any non-interactive context (deliberately covers chat subagents too; interactivity is the
  predicate, not ancestry). FULL auto-allow accepted as standing consent (no new confirm
  mechanism).
- **UI:** Conf "Automations" group = list; editor in a sheet; presets + raw-cron escape hatch
  with server-side cronsim preview; dedicated `/api/automations` CRUD (MachineEditor hook
  pattern, SQLite write path).

**Supersedes** the ROADMAP §A3 sketch (`target_thread`, "APScheduler-style", last_run/last_status
fields → the runs table). **Preserves** D8 (one-file tools), D14/D15 (agents folder-only — the
automation's agent IS its blast radius), D44 (approvals ladder unchanged, gains the `decision`
column its marker lacked), the D2-B wake service (`origin=system`).

## D50 — D2-A fleet monitor loop + owner-device wake trigger: poll-and-count, plain edge, per-host wake fields ✏️ LOCKED 2026-07-31 (owner-signed in conversation; research = R12+R13)

**What:** the backend's first self-owned periodic monitor: ONE `MonitorService` lifespan loop (the
A3 `runner.loop()` shape verbatim — sleep-then-work so overlap is structurally impossible, config
re-read per tick so the master switch is live, blanket guard, cancelled+awaited at shutdown) doing
two cheap reads per tick, feeding two consumers: **fleet host up/down transitions → Events** (later
the F1 `host_up_down` notify class) and **the owner-device tailnet-presence edge → `wake_host`**
(D2-A, the second half of D2-B).

- **Tailnet reads = LocalAPI `whois` over the unix socket via httpx-over-UDS** (R12: 0.16 ms/1.2 KB,
  30× cheaper than the CLI subprocess; read needs no root/operator; socket path = config with the
  Linux default; `Host: local-tailscaled.sock`, no Origin/Referer). The **`watch-ipn-bus` stream is
  REJECTED** on evidence (unstable by its own doc, mid-rewrite at main, unknown mask bits fail
  silently, no heartbeat, cannot push endpoint changes). Config keys on the **tailnet IP** (what
  `whois` takes) — never nodekey/NodeID (rotate).
- **Fleet reads = `FleetService.status_all()`**, never raw `ping_host` (one sweep shared with the
  UI; monitor interval ≥ `server.poll_seconds` so the TTL cache dedupes).
- **State = two consecutive-counters + reported ∈ {unknown, up, down} per target, in-memory on the
  service** (R13: the field's whole machine; Gatus's asymmetric damping — down after 3, up after 2,
  both config). **UNKNOWN is sticky and first-class**: a failed CHECK (tailscaled restarting, empty
  peer map, `Self.Online=false`, ping tool error — `HostStatus.error` preserved) never counts
  toward a streak and never produces an edge. **Boot baseline is SILENT** (owner-confirmed): the
  first observation after a backend restart sets state without Events — a restart is not an
  incident. No backoff, no jitter, no per-target tasks, no queue, no reminders (R13 §5
  scale-artifact table).
- **Record ≠ notify:** transitions pass two PURE predicates (Kuma's `isImportantBeat` split) —
  "worth an Event row" and "worth notifying" — unit-testable; a flap that never confirms produces
  nothing.
- **The wake trigger (owner-ruled semantics, 2026-07-31):** the owner's phone keeps Tailscale OFF
  until they want the servers, so the connect itself carries intent. Fire on the device's
  **confirmed OFFLINE→ONLINE edge only** — never level-triggered ("phone online AND host down" is
  NOT a wake condition: a deliberately shut-down PC stays down), never on UNKNOWN→ONLINE (backend/
  tailscaled restarts fire nothing; D2-B's ruled first-connect behavior is separate and unchanged).
  At most one fire per cooldown window (default **3600 s**, distinct from D2-B's 300 s). Accepted
  corner (owner, eyes-open): a genuine reconnect after the window re-wakes a deliberately-downed
  PC — correct, since a fresh connect means "I want my servers". **R12's home-endpoint predicate is
  DROPPED** — it answers "got home", but the owner's intent is "wants servers, home or away".
- **Per-host wake config (owner directive this session):** additive optional fields on the unified
  `ComputerCfg` (the `wake_on_connect` precedent; never sibling maps) — `wake_on_presence: bool =
  False` (participates in the phone trigger) + `wake_presence_cooldown_s: int | None = None`
  (per-host override; None ⇒ the global). Global tunables join `WakeCfg` as its docstring always
  planned: `device_ips: []`, `presence_cooldown_s: 3600`, `tailscale_socket` (Linux default).
  Monitor tunables = new `monitor:` section: `enabled`, `interval_s: 30`, `down_after: 3`,
  `up_after: 2`.
- **Slices:** 15a = MonitorService + fleet up/down state/Events (+ presence state observed +
  logged, wake DISARMED). 15b = the wake edge armed through the existing audited
  `ActionService.invoke("wake_host", actor=SYSTEM, origin=system)` chokepoint + Conf/MachineEditor
  per-host fields + ROADMAP F1 residual unlock note.

**Preserves** D2-B (`wake_on_connect` untouched, its cooldown map pattern reused), the OS-branch
allowlist (`fleet._ping_cmd` untouched; the socket path is config, not an OS branch), D-4 actor
semantics (SYSTEM actor + system origin). **Supersedes** ROADMAP D2-A's sketched
"`tailscale status --json` poll / owner device node(s)" mechanism wording (CLI → LocalAPI whois;
node ids → tailnet IPs) and its offline→online-debounce framing (→ the edge + cooldown semantics
above). Research: [R12](./research/R12-tailscale-presence.md) ·
[R13](./research/R13-monitor-loop-patterns.md).

**AMENDED 2026-07-31 — Codex design round R1 (SHIP-WITH-CHANGES: 2H/5M/2L, all folded; 2 recorded
overrules).** The lean core (one loop, shared sweep, in-memory state, 3/2 damping, silent baseline,
no jitter/backoff/queue) was endorsed as-is; the amendments close concrete false-edge paths:

- **The phone gets its own ARMING machine, not the fleet's 3/2 counters (H1):** per-device
  `armed: bool` — healthy OFFLINE observed continuously ≥ `wake.presence_offline_after_s`
  (default 120, from the R12 watchdog floor) ARMS; the first healthy `Online: true` tick FIRES
  (cooldowns permitting) and disarms; **any UNKNOWN tick, monitor disable, or device reconfig
  DISARMS**; ONLINE while unarmed baselines silently. This is what makes "a tailscaled restart
  fires nothing" and "a genuine edge fires" simultaneously true — without it, a phone connecting
  during a daemon outage fires on recovery. One-tick offline blips can never fire.
- **The tailnet health gate is explicit (H2):** with devices configured, each tick first reads
  `/localapi/v0/status?peers=false` and requires `BackendState == "Running"` AND
  `Self.Online == true`; otherwise the whole tailnet side is UNKNOWN this tick (whois' cached peer
  Node is stale evidence, per R12 §4). A whois 404 logs "stale config" only when the gate is
  healthy; during restarts it is ordinary UNKNOWN. Real per-tick cost: one sweep + one health read
  + N tiny whois reads.
- **The fleet transition function is pinned, pure (M1):** UNKNOWN **resets both counters** (never
  pauses — pausing lets non-consecutive samples cross a threshold) and preserves the last
  *confirmed* `reported`; a baseline must itself meet the threshold and installs silently;
  confirmed UP after an observation gap whose last confirmed state was DOWN **is** a recovery
  Event; no prior confirmed baseline ⇒ no Event.
- **Live-config reconciliation (M2):** enabled→disabled clears counters/baselines and disarms
  (cooldown stamps are RETAINED — they gate actions, not observations); re-enable re-baselines
  silently; every tick prunes state for removed targets and silently baselines additions; phone
  state keys on the normalized IP, never reused across different IPs.
- **Cross-trigger wake dedupe (M3):** a presence fire **CHECKS and stamps** BOTH the existing
  shared 300 s `wake_cooldowns` map AND its own presence map, in an awaitless reservation pass, so
  neither interleaving can double-wake: the stamp covers presence-first (a dashboard-open seconds
  after the edge), the READ covers dashboard-first (D2-B stamps a host and parks at its invoke,
  then the edge lands); D2-B is unchanged. The shared map is the automatic-wake dedupe FLOOR across
  both triggers — it bounds even a `wake_presence_cooldown_s: 0` host to one automatic wake per
  `cooldown_s`, and only `cooldown_s: 0` removes it. Multi-device edges in one tick coalesce into
  ONE host fan-out; the presence cooldown is per-HOST, shared across devices (a per-device cooldown
  would reintroduce the duplicate). *(As first written this bullet said only "stamps" — the checks
  half of the underlying review finding was dropped in condensation and the 15b build faithfully
  implemented the incomplete text; the 15b verify round caught it. Recorded as a lesson: an
  amendment that condenses a reviewer's fix must keep BOTH halves of a read-and-write rule.)*
- **Config, final names + validation (M4/L1):** `monitor.poll_seconds: 30` (cross-field validated
  `>= server.poll_seconds` — a shorter interval would count one cached sweep as several
  "consecutive checks"), `monitor.down_after_checks: 3`, `monitor.up_after_checks: 2`;
  `wake.presence_device_ips: []` (valid, normalized, unique), `wake.presence_offline_after_s: 120`,
  `wake.presence_cooldown_s: 3600`, `wake.tailscale_socket_path` (Linux default). The LocalAPI
  read timeout is a code constant (transport property, the `SW_READY_TIMEOUT` precedent), not a
  knob. **Overrule ①:** Codex's hard `>= 120` validation floor on `presence_offline_after_s` is
  softened to default-plus-docstring — single-owner app, prefer-configurable; the rationale lives
  in the doc, not a 422.
- **Host-transition Event vocabulary (M5):** `action = "host_up" | "host_down"`,
  `target = <host_id>`, `actor = SYSTEM`, `origin = system`, **`status = OK` for both directions**
  — the monitor successfully observed a transition; DOWN is not a failed action, and `status=ERROR`
  would make the LIVE frontend classifier misfile host-downs under the `action_failed`
  notification class today. Event time is DETECTION time and the summary says so ("detected down
  after 3 consecutive misses"). **Overrule ② (of D50's own original text):** the backend "worth
  notifying" predicate is CUT as premature — record-vs-notify stays split across the stack (the
  backend's pure record predicate + the frontend's existing pure Event classifier, which gains the
  `host_up_down` class when F1 consumes it). No dead backend policy code.
- **Lifecycle (L2):** started unconditionally after fleet/events/actions (disabled = idle tick, so
  the Conf switch is live); re-check `shutting_down` after each sleep; `CancelledError` escapes,
  ordinary `Exception` is caught per tick; cancelled AND awaited before the DB closes; the UDS
  httpx client is built per tick (0.16 ms — a live socket-path edit applies next tick, and there
  is no persistent client to leak). None of A3's arbiter/claim/shield machinery is copied — that
  solves durable run ownership, which monitoring does not have.

## D51 — Vapor assimilation (Phase 16): complete migration onto the kit + cosmos default ✏️ LOCKED 2026-08-01 (owner-signed in conversation; plan = VAPOR_ASSIMILATION_PLAN.md v2; council = Codex + Opus lenses, both rounds clean)

**What:** vapor stops being a bespoke escape hatch and migrates COMPLETELY onto the kit, slice by
slice, each port deleting its legacy copy; **cosmos becomes `DEFAULT_THEME`**. The executable spec
of record is [`VAPOR_ASSIMILATION_PLAN.md`](./VAPOR_ASSIMILATION_PLAN.md) (v2, council-amended —
slices V0–V6, reconciliation R1–R24); this entry pins the rulings that survive the plan document.

- **The end state (the bar for "done"): vapor takes cosmos's shape.** A thin Root on DefaultRoot
  hosting (kit AppBar/TabBar/`sheet` composer/Conf/chat) + a **Root-pinned bespoke VaporFleet**
  (hero/skyline/waveform — bespoke-by-right under D31, owner-confirmed "Fleet stays as-is") +
  `themes/vapor/tokens.css` + a residual vapor sheet styling ONLY the frozen vapor-keeps list.
  "No bespoke remainder" means **no bespoke duplicate of a kit capability**, enforced mechanically
  at V6 (banner-set equality + VaporRoot-renders-DefaultRoot + waiver list `[]`), not by review.
- **Slice architecture:** V0 default flip (flip-only + the default-mirror allowlist — the
  "no theme literal outside resolve.ts" guarantee is AMENDED to that documented list) → V1 file/
  component hygiene (vapor-only components leave shared dirs; 20 keyframes prefixed) → V2 accent
  axis (`data-theme` → `data-accent`, atomic) → V3 tokens (real `tokens.css`, aliases on `body`
  below the accent overrides, `--accent-glow` renamed, banner classification + shrink-only
  ratchet) → **V4 the pivot: VaporRoot moves onto DefaultRoot in ONE slice** (the `.kit` marker
  lights up exactly once, owner-eyeballed once; vapor DECLARES the four kit axis/seg descriptors;
  Codex code-verified no VaporRoot behavior is lost) → V5 per-banner deletion ladder (port≠delete
  commits, rg zero-ref gates) → V6 tail (residue enforcement, waiver retirements, the lazy flip
  IF still worth it, behind `@layer`-wrap + font-loader + first-paint preconditions).
- **ChatSurface is NOT authorized.** ChatThread already renders one shared DOM for all themes;
  vapor's chat divergence was CSS + a 35-line PinnedPlan, and the owner confirmed the kit look
  (the kit's own working indicators / chevron disclosures / `planPlacement:"pinned"` +
  `PinnedPlanPanel` cover everything). A whole-surface variant would be a registry-of-one failing
  D31's own ≥2-implementations gate; if a future theme genuinely needs one, it gets its own
  design + council round.
- **Kit extensions constrained:** the AppBar gains **`brandMark?: ReactNode`** (the `brandMeta`
  slot precedent) — no `loz` enum, no ring knowledge in the kit; vapor passes its logo/ring in
  (the `loz` seg setting survives as-is). Any new composer skin must be **look-named, offered to
  every theme** — never theme-named (the D37-authority trap).
- **Recorded overrules (lean over mechanism):** cosmos stays lazy-Root at V0 — a fresh-default
  cold boot may flash browser canvas → kit base before cosmos lands (owner accepted, "no new
  weird code or seams"; the inline critical-token escalation is recorded, not built). Vapor stays
  EAGER until V6 (kills the lazy-flip cold-flash + unlayered-CSS hazards without a cold-load
  gate). First-boot mode/accent DERIVE from cosmos's declared ThemeDef (dark/violet) — no new
  triple anywhere.
- **Non-events:** the owner's live appearance selection is backend-synced (`AppearanceCfg`) and
  untouched by the flip — no device migration exists or is needed. `migrateLegacyTheme` + its
  FOUC twin keep mapping old `dark/aqua/ember` → vapor.
- **Method per slice (unchanged):** pinned Opus build brief → main-seat audit → Codex round →
  waves to WAVE CLEAN → owner D7 eyeball → pause. New default-boot e2e must await CONTENT
  selectors (the v1.4.5 flake class). Standing guarantees: nothing new depends on a legacy hook;
  waiver lists only shrink.

### D51 — BUILT ✅ (2026-08-02): slices V0–V6 all shipped; outcome deltas vs the letter above
- **Delivered end state = the §1.1 bar, enforced by EQUALITY** (extras.css ≡ the 6 frozen keeps +
  the plan-pin fidelity carve-out; VaporRoot-renders-DefaultRoot + no-resurrection pins;
  `CONTRACT_WAIVERS === {}`). Phase total, V3 baseline → V6: extras.css **3028 → 204 ln** ·
  vapor.css **1178 → 692 ln** · kit.css **5107 → 5304 ln** · net **−3113 CSS lines**. *(The
  "2981 → 205 / 1023 → 702" figures in the plan's V5 as-built were that slice's own start point,
  and two of them were mistranscribed — corrected + labelled slice-local at V6.)*
- **The lazy flip: MEASURED AND DROPPED** (vapor's whole eager slice = 5.3 KiB gz incl. fonts CSS;
  the 4 vapor woff2 files are usage-lazy regardless). The Codex-#3 preconditions would be real new
  mechanism on the owner's daily-driver path for trivial bytes — the "IF still worth it" clause
  resolves NO. Vapor stays eager permanently; numbers in the plan V6 as-built.
- **The `sections` waiver: RETIRED at V6 — the presets Just Work** (vapor declares no `layouts`
  restriction; fleet is on the bar in every preset so the Root-pinned body is preset-independent;
  live-verified at 4/3/2-tab incl. hosted-utils + stale-deep-link coercion; real 2/3-tab tests
  replaced the forced-coercion assertions per the council's Codex-#11 bar). The owner's tab-count
  setting is functional under vapor for the first time.
- **Owner-driven fidelity addendum (V4 close-out, §15-sanctioned theme CSS on kit hooks):** vapor
  keeps its centered flush hanging plan-pin tab (3 declarations + click-through) — the kit's own
  left-inset+8px geometry was the thing the owner rejected, so the ledgered delete-only plan was
  corrected. Precedent class: the brand mark.
- **Known deferral (kit-wide, pre-existing):** the `minimal`-chrome plan/mini-player overlap
  (~−17..−26px on all three kit themes) needs a kit-geometry slice of its own — recorded in
  VAPOR_BANNER_LEDGER §7.1; NOT a vapor issue.
- Commits: V0 `381250b` · V1 `9c9d718` · V2 `5f70a16`+`930a5e7`+`239449f` · V3 `7668a1d` ·
  V4 `873f85c`+`9b7fcfd`+`16d4412` · V5 `3456c03` · V6 = the close-out commit. Method note for
  successors: 100% of the review rounds (council, per-slice Codex, confirm passes, owner-requested
  sweeps) produced at least one accepted finding — the cadence carried the phase.

## D52 — The gacha theme "Capsule Arcade" (Phase 17 / H1): kit port + JP identity + the media seam ✏️ LOCKED 2026-08-02 (owner §8 rulings in conversation; spec of record = GACHA_PLAN.md incl. its §11 council reconciliation; council = fresh Opus architecture lens LOCK + Codex round 4, both confirm rounds folded)

**What:** the owner's finished standalone prototype (`design/prototypes/gacha/uploads/prot/
capsule-arcade/`, banked `37144c0`, fidelity mandate = the Vapor bar) becomes the fifth built
kit theme, built G0–G6 per [`GACHA_PLAN.md`](./GACHA_PLAN.md) §7. The plan (with its §8 ruled
answers + §10 implementation dossier + §11 reconciliation) is the executable spec; this entry
pins what must survive it. **v1.5.0 is this theme's release** (owner; prod stays v1.4.6 until
then).

- **The owner's §8 rulings (all ten, final):** roster serving = **(b) read-only owner
  directory + Conf gallery** (order/pin only, no write API) · stars = **CONFIGURED services**
  with the exact §6.1 ladders, **default 5★** (3★ one seg-tap away), zero-services floor ★1 ·
  **katakana wordmark** (exact string = eyeball pick) · card geometry/reel size = in-slice
  eyeballs · reel = **every tab switch** (cooldown pre-agreed as the eyeball valve) · palettes
  = **two families, five variants** (arcade/midnight/indigo re-tint the base ramp only; TWO
  accent-SHIFTING variants picked by the owner from the research candidates — ember/glacier/
  nebula/eridu, §4.4) · JP nav sub-labels KEPT and must be **real Japanese** (編成/案内/設定 +
  ツール) · banner = **fixed hero + live promos for EVERY host, clickable + swipeable**
  (membership narrowing is owner-only; §6.4 is the contract) · oracle ghosted entry accepted ·
  dossier = **the frontier grid** (Ping 応答 · Uptime 稼働 "—" · Services サービス =
  configured count · Seen 最終確認) **plus the host action bar** (typed-action `run`).
- **Committed SHARED-KIT extensions (closed list — anything else needs a new ruling):**
  `brandText?: ReactNode` AppBar slot (fallback `ctrl·b`) · `subLabel?: string` on tab defs
  (kit NavBar renders it; NavMenu stays icon-only) · `lib/viewTransition.ts` —
  `runViewTransition` EXTRACTED from `switchTheme` behavior-identical first, the
  `.finished`-catch + token-guarded `data-transition` cleanup as a labelled delta · the
  composer catalog gains the **look-named shared skin `arcade`** (D37 holds; theme-scoped
  composer CSS stays banned; skin authored on semantic tokens, cross-theme picker checks in
  its own G3 commit) · `BottomSheet` stays 420 ms (a `durationMs` prop only if the G2 eyeball
  rejects the deviation) · the reel's z-rung = **45** on the kit ladder (over toasts/TTS
  flash, under modals; no `.kit` stacking-context copy) · gacha's `--bg` joins the boot-script
  default-mirror allowlist (no cold-boot FOUC). All shared edits except the composer skin land
  as G0's ONE seams commit. **ADDENDUM (owner-requested at the G0 round-4 eyeball, 2026-08-02
  — beyond the original closed list): `ComposerSlots.placeholder?: string`** — a theme-fillable
  composer hint (last-defined-wins scalar on the existing theme→composer contract object; each
  variant's original string is the fallback, other themes byte-identical; gacha fills the
  prototype's コマンド入力… from `GACHA_COPY`). Shipped `0bb0b51`.
- **Config + data shape:** roster lives at **`themes: {gacha: {roster: […], slots: {…}}}`**
  — a FEATURE-named top-level map keyed by theme id (the D48 `providers` precedent; a
  `theme_gacha:` sibling key is the banned shape). One entry object per character
  (image/cutout/wide/focus, extend-don't-migrate). The theme reads ONE endpoint (the media
  index, entries + slots); **host→entry assignment is CLIENT-side in one shared resolver**
  (positional over display order + `slots` pins + ordered cycling when hosts>roster;
  placeholder only for empty/unusable). Star mode's single home = the `starMode` ThemeDef
  setting. Per-host appearance overrides are OUT of this phase.
- **The media seam + threat model (the §10.4 hardening, binding):** ONE namespace-generic
  read-only mount — `/api/media/{ns}/files/…` + a `/api/media/{ns}` JSON index — over
  **`$CTRLB_HOME/media/<ns>/`** (gacha first; frontier's art picker inherits). The app has
  **NO app-layer auth — the tailnet IS the boundary** (SECURITY_MODEL), so no upload/delete
  API ships this phase; anything writable later re-opens §5.4(c)'s full requirement list. The
  mount SUBCLASSES StaticFiles: extension→Content-Type **allowlist** (png/jpg/webp; never
  `guess_type` — an owner-dropped `evil.html` served same-origin would be stored XSS with
  full API access), 404 otherwise, `X-Content-Type-Options: nosniff`, no symlink following,
  ensure-dir before mount (`check_dir` raises), `Cache-Control: no-cache` revalidate, index
  route split from the mount, backend tests for traversal/allowlist/304/route-order at G5.
  SW `runtimeCaching` (the repo's first) also lands at G5: woff2 `CacheFirst`, `/api/media/`
  `StaleWhileRevalidate` (never `CacheFirst` — owner-mutable files).
- **Recorded rejections (lean over mechanism):** no backend load/temp/uptime collection (the
  dossier's Uptime tile stays "—" until a real seam exists) · no `gen-theme-art.mjs` build
  script (a documented one-shot `sharp` line; the FONT subset script + guard test stay on
  their measured justification) · no naive @fontsource JP (757 KB/72 req → the frozen
  62-glyph committed subset, ~140 KB est., compile-time-constants-only guard; runtime JP
  falls back to the system stack by design) · per-card `backdrop-filter` deleted by design ·
  the pre-nav transition hook dropped (passive same-frame start is prototype-faithful) · the
  prototype's global `.001ms` reduced-motion sledgehammer not ported (axes rule).
- **The one empirical unknown:** `::view-transition-new(root)` liveness on the owner's Fennec
  144+ — the G0 device spike; M2 is progressive enhancement DROPPED WITHOUT CEREMONY if it
  fights the reel (the reel alone must carry the transition).
- **Method per slice (the D51 cadence, unchanged):** pinned Opus build brief → main-seat
  audit → Codex round → waves to clean → owner eyeball → pause. The theme joins
  `themeContract`/e2e groups at G0; `CONTRACT_WAIVERS` stays `{}`.

**✏️ G1-eyeball addendum (owner rulings, 2026-08-02 evening — as-built GACHA_PLAN §7.2):**
- **The 3★ ladder's top rung re-ruled: ≥3 configured services → ★3** (supersedes the lock
  table's "two or three → ★2", which read the owner's whole real fleet as flat ★2). 5★
  re-confirmed 1:1/≥5-caps. Ladders remain design constants; `stars.ts` + plan §6.1 amended
  together.
- **The media directory is ROLE-SCOPED (amends this decision's flat-dir media seam):**
  `$CTRLB_HOME/media/<ns>/{characters,banner,wallpaper,reel}/` — a dropped file is ASSIGNED
  by its folder, no pinning ceremony; `slots` pins survive as optional overrides; the G5
  index endpoint reports per-role. Full shape: plan §5.4. The §10.4 hardening/threat model
  is unchanged and applies per subfolder.
- **The banner slide set gains SCENE slides** (hero → N scenes → per-host promos): one slide
  per image in the banner role pool (bundled `ART.scenes` until G5), inert non-buttons
  wearing hero-style TEMPLATED copy — tag 限定イベント + caption 開催中 (frozen glyphs, no
  font regen) + a title from the researched all-ASCII `SCENE_TITLES` pool (`i mod 8`;
  Genshin/HSR/Arknights register × the app's network identity). Ruled over a cycling hero.
  Slide keys stay filename-stable (`scene:<name>`); dots announce the visible title.
- **Owner-override-of-prototype-literals precedent:** the slide scrim was cut well below the
  prototype's near-opaque values at the owner's ask — fidelity is the DEFAULT, not a cage
  once the owner has seen it on device. Same class: `--gc-star-hi` pinked to `#ff8fa8`
  (the §6.2 device pick), entry-level `focus` used for the owner's own art (measured, not
  eyeballed).
- **The owner's art enters the bundled default set pre-G5** (roster recast; originals stay
  UNTRACKED pending an owner call on 80 MB in history — REC no).

**✏️ G2-eyeball addendum (owner rulings, 2026-08-02 night — as-built GACHA_PLAN §7.3):**
- **M3 (the capsule→dossier morph) PULLED FORWARD from G4 into G2, prototype-exact:** under a
  live View Transition the sheet does NOT slide — the transition carries everything (the
  prototype's own composition; the owner: image morph over sheet-slide if forced to choose).
  The slide-up survives only as the no-VT/reduced-motion/plain-open fallback. G4 re-scopes to
  the reel FIGURE + M2. Mechanism: the shared BottomSheet gains opt-in `enterInstant`+
  `upkeepKey` (other themes byte-identical, test-pinned).
- **Swaps morph too** (dossier open → tap another capsule): the mounted avatar is inline-
  suppressed for the old capture — the single-owner prep discipline in GachaFleet.
- **The visible × returns** (overrides the kit's no-visible-close for gacha — theme markup,
  prototype `.close-detail`).
- **Tap-outside closes the dossier** (cards/promos/modal layers exempt; carousel dots count as
  outside — flagged, unvetoed) and — main-seat ruling off the Codex confirm round —
  **navigation closes it too** (keyboard/programmatic now matches the pointer path; no
  resurrect-on-return).
- **The full-screen ART SHOWCASE** (owner ask): dossier portrait = button → uncropped art,
  reverse morph both ways, z-46, Escape layers art-then-dossier.
- **§4.8's held-metric dash is the literal em dash** (`metricPending` in copy.ts): the
  "font regen needed" premise was verified WRONG (latin faces carry U+2000-206F); the G1
  pill/counter keep their eyeballed ASCII hyphen.

**✏️ G3 addendum (2026-08-03 — as-built GACHA_PLAN §7.4; owner device round pending):**
- **The composer catalog gains `arcade`** (D37 held: look-named, semantic tokens only, the
  closed shared catalog's fifth value) — measured against every existing skin first, 4/5
  defining properties differ.
- **The oracle ghosts as ONE SURFACE** (owner ruling): art, scrim AND the display words ride
  the M7 ramp together; and it **pins at `var(--appbar-h)`** (owner ruling) — never under
  the bar. Both supersede §10.2's narrower recipe.
- **The bespoke-body stacking law** (Codex M2 + the builder's accepted departure): chrome
  ABOVE a runged log must be positioned WITHOUT z-index, or it traps every fixed descendant
  (the privilege menu's 60/61). The shipped ladder: oracle 0 < header (un-runged) < log 2 <
  plan 4 (kit sticky, never overridden) < appbar 5.
- **`safeRafLoop` faults latch permanently** (start() no-ops after a thrown tick) — engine-wide
  behavior change, the documented intent made real.
