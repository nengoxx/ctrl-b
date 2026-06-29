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
3. **Config = desired-state only.** `config.py` `TailscaleCfg` (`tailscale`): `target_port: int = 5173`
   (which local port Serve fronts — covers dev 5173 / preview / prod) + `enabled: bool` (whether the
   panel/actions are active at all). The live on/off comes from tailscaled, not config.
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

## D32 — emma deployment topology: two isolated instances (prod + dev), one repo, tags + sparse-checkout ✏️ LOCKED 2026-06-29

**Context.** emma (Ubuntu 26.04, tailnet) is the always-on home for v2. The owner wants BOTH a **production** dashboard for daily use (stable, HTTPS via Tailscale Serve) AND an always-available **development** instance to test changes — **without** dev experiments ever touching prod's config/DB/chat. The coding happens via a **tandem Claude Code agent running on emma in tmux** (alongside the instances; its checkout is read-only to me, one canonical GitHub `main`). Best-practice research (CloudBees env-separation; git worktree-vs-clone; solo-dev branch workflow 2026; GitHub sparse-checkout) backs every choice below.

**Decision — two fully isolated instances on emma, separated on every axis:**

| Axis | PROD (daily driver) | DEV (sandbox) |
|---|---|---|
| **Code tree** | `~/github/ctrl-b` — a **CLEAN, sparse, tag-pinned clone** (only `dashboard_v2` + root docs on disk; prototypes never materialize). Pulls from **GitHub** (so prod runs only pushed+merged code). | `~/github/ctrl-b-dev` — full tree on the **`dev`** branch; where the tandem agent works AND what the dev instance serves. |
| **Data root** (`CTRLB_HOME`) | `~/.ctrl-b` (real `config.yaml` + `ctrlb.db` + memories/skills/agents) | `~/.ctrl-b-dev` (its own copy; seeded from prod's config on first dev install) |
| **Backend** | `uvicorn :5433` serving the **built `dist`** (no `--reload`) | `uvicorn :5434 --reload` (Linux reload is safe; Windows gotcha is OS-specific) |
| **Frontend** | built into `dist`, served by uvicorn | Vite `:5173` HMR → proxies `/api` → `:5434` (via `VITE_API_TARGET`) |
| **Ingress** | **Tailscale Serve HTTPS :443** (mic works) | `http://emma:5173` (LAN/tailnet, HTTP, no mic — visual iteration) |
| **systemd user units** | `ctrl-b-dashboard.service` (enabled, always-on) | `ctrl-b-dashboard-dev.service` (backend) + `ctrl-b-dashboard-dev-web.service` (Vite) — start when iterating |
| **Agent files** | **none** — prod is just the dashboard + its service + Serve | the tmux Claude agent (`start-claude.sh`) lives here (`PROJECT=~/github/ctrl-b-dev`) |

**Branches + releases.** One repo, two branches: **`main`** = always-deployable production line; **`dev`** = WIP (the agent's branch, drives the dev instance). **Tags `vX.Y.Z`** mark releases — prod checks out a **tag** (detached, frozen, named) for reproducibility + instant rollback (`git checkout v(prev)`). **Promote** = agent merges `dev → main`, tags `vX.Y`, pushes → prod `git fetch --tags && git checkout vX.Y && install.sh prod`.

**Clean production = sparse-checkout, NOT a divergent branch or a separate repo.** The prod clone runs `git sparse-checkout set dashboard_v2 AGENTS.md CLAUDE.md` so only those paths exist on disk; the prototype folders (`ws_claude*`, `ctrl-b (Vapor)`, `wol_server`, `ws_codex*`) stay in history but never appear in the prod tree — **zero merge conflicts** (nothing is deleted, just not checked out). Rejected: a `prod` branch that deletes prototypes (every dev→main merge re-collides — known anti-pattern); a separate repo (fragments history, double remotes). The eventual permanent cleanup is a **one-time** delete commit on `main` when v2 fully replaces the live Flask app ("graduation"), not an ongoing divergence.

**Clone, not worktree** for the prod tree even though both run on emma: with an autonomous agent mutating `~/github/ctrl-b-dev` and the read-only constraint, **isolation beats the marginal disk/fetch savings**; a separate clone keeps prod's git state fully decoupled and lets prod pull only from GitHub (the agent's unpushed WIP physically can't leak into the daily driver).

**`CTRLB_HOME` is the isolation seam** (D14/D15 #2) — it already existed; this just points each instance at a different root. All workspace data (`config.yaml`, `ctrlb.db`, `memories/`, `skills/`, `agents/`) resolves under it; the coarse `CTRLB_HOME` knob relocates everything together, the fine `CTRLB_CONFIG`/`CTRLB_DB` knobs override single files (test/back-compat only). Audited 2026-06-29: every data path resolves under `CTRLB_HOME` — fixed `skills_dir_path()` (was keyed to `config_path().parent` → now `home_dir()`, matching memories/agents) so a `CTRLB_CONFIG`-only override can never split skills off.

**One-time migration (coordinated with the tandem agent — NOT auto-run).** emma currently has a single full checkout at `~/github/ctrl-b` (the agent's, on `main`). To adopt this layout: (1) the agent relocates to `~/github/ctrl-b-dev` on `dev`; (2) `~/github/ctrl-b` is converted **in place** to the prod clone (`git sparse-checkout init --cone` + `set` + `checkout <tag>`) — no re-clone, no data loss (everything is on GitHub). `bootstrap.py` **detects and instructs**; it never silently mutates the agent's tree.

**Status.** LOCKED 2026-06-29. Supersedes the earlier single-tree, shared-backend deploy sketch (dev was Vite-only proxying to the prod backend → NOT isolated). Artifacts: `deploy/emma/` (`install.sh [prod|dev]`, the three service units, `bootstrap.py`, `serve-https.sh`, `start-claude.sh`); runbook `deploy/emma/README.md`; rationale `docs/DEPLOY_EMMA.md`.
