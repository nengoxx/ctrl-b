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
   roster → skills → history; frozen per turn (compaction ignores fresh system blocks). Config:
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

**Inference-chain follow-up (not built here):** turning `inference.local/cloud + default_mode` into an
ordered chain crossing local→cloud is a rework of a shipped subsystem (how do `/local`//`/cloud`
prefixes + per-agent `ModelRef` compose with "start here, then fall down the chain"?). It's the next
slice, gets its own pre-flight, and reuses `core/failover.py` unchanged.

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
