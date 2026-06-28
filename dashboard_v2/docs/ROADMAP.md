# Roadmap & future additions — dashboard_v2

Features the owner wants *eventually*. They're recorded here so the **v1 architecture leaves room
for them** — the "build it extensibly now, implement later" list. Nothing here is v1 scope unless
also in `TODO.md`. Each item: **what · why/UX · design implication · open questions.**

Guiding principle: build the v1 seams (pluggable memory, action risk levels, typed chat-message
kinds, streaming-or-not endpoint, a settings/policy layer) so these slot in without a rewrite.

---

## A. Agent capability & control

### A1. Agent privilege levels (like Claude Code / Codex)

> **Status (2026-06-16): policy core built; selection layer locked in D16.** `core/permissions.decide()`
> fully implements the ladder (`READONLY` / `CONFIRM` / `AUTO_LOW` / `FULL`) + the `run_shell` gate. A1
> is **selection/persistence UX only**, and its shape is now **locked in DECISIONS D16**: global default =
> `agent.defaults.privilege` (already wired — **no new global field**), per-agent = `AgentDef.privilege`
> (shipped), per-session = a new `ChatRequest.privilege` override (`model_copy`, mirrors `ChatRequest.agent`),
> surfaced via a header chip + a sticky `/privilege` composer verb (reuses the `/local`//`/cloud` plumbing).
> Standalone slice, not part of 7e. No new decision logic needed.

- **What:** a selector for how much the agent may do on its own, from read-only up to full
  autonomy. Suggested ladder:
  1. **Read-only / Plan** — can inspect + suggest, runs nothing.
  2. **Confirm each** — proposes every action as a bubble; user approves each (Claude Code "ask").
  3. **Auto low-risk** — runs `risk=low` actions automatically, confirms `med`/`high`.
  4. **Full privileges** — runs everything automatically, **including the guarded `run_shell`**
     (the "YOLO" mode; clearly labeled dangerous).
- **Design implication:** this is a **policy layer over the action registry** — every action
  already carries a `risk` level (see `ARCHITECTURE.md` §1), so privilege = "auto-run threshold +
  whether `run_shell` is unlocked." Set globally, **overridable per chat session and per
  automation** (see A3). Persist in settings; surface the active level in the composer/header.
- **Resolution + surfacing:** locked in **DECISIONS D16** (per-session → per-agent → global
  `agent.defaults.privilege`; new `ChatRequest.privilege` override; header chip + sticky `/privilege` verb).
- **Open (deferred past the first A1 slice — D16):** per-host privilege overrides? a time-boxed
  "full for next 10 min" escalation?

### A2. Agent asks questions (clarifications, not just commands)

- **What:** the agent can ask the user a question mid-task — for missing info or to disambiguate —
  exactly like Claude Code's question prompts, optionally with suggested answers.
- **Design implication:** the chat protocol must be **typed message kinds**, not just text. v1
  already has `text` / `command|action` bubbles; add a **`question`** kind (prompt + optional
  choice chips + free text), and the agent loop must **pause for the answer** and resume.
- **Locked design (✅ 2026-06-16 — reuse the confirm-suspend machinery; build deferred).** A2 is the
  *same shape* as the action-confirm flow that already works, so it **extends** that path rather than
  adding a parallel one:
  - A **`question` builtin tool** — sibling of `task_plan` (`services/agent/planning.py`,
    `category="builtin"`, `ui_exposed=False`, LOW). The agent calls it with
    `{prompt, choices?: list[str], allow_free_text?: bool}`.
  - It **suspends the turn** through the existing suspend path (a new suspend reason, e.g. a
    `RunState.AWAITING_ANSWER` alongside `AWAITING_CONFIRM`) and emits a **`tool.question`** SSE event
    (sibling of `tool.permission`) carrying `{callId, prompt, choices}`. The turn ends `done(suspended)`.
  - The UI renders a **question bubble** (prompt + choice chips + free-text), parallel to the `.b.cmd`
    confirm bubble — net-new component, same suspend/resume wiring.
  - **Resume reuses `/api/agent/resume`** (don't fork it): extend `ResumeRequest` with an
    `answer: str | None`; a new `decision="answer"` records the answer as the tool result fed back to
    the model, then the loop continues — exactly the execute/dismiss round-trip carrying text instead
    of a confirm token. An abandoned question synthesizes a "no answer"/`SKIPPED` result, like an
    abandoned confirm.
- **Notify when blocked (ties A1+A3+F1):** when the agent needs input — a clarifying **question**, or
  a **confirm** it lacks privilege for — and **no human is present** (low-privilege or headless
  automation), **fire a notification** (F1) and park the turn until answered, then resume. The key
  bridge: a low-privilege/scheduled agent that hits a decision point pings the phone, the owner
  answers, the agent continues.
- **Open (only matters once automations exist — defer to build):** timeout/abandon behavior;
  per-automation fallback when unattended (notify-and-wait / use-default / skip).

### A4. Composer as a console — prefix routing & slash commands

- **What:** the chat composer doubles as a command console (Claude-Code-style):
  - `!<cmd>` → run shell directly via guarded `run_shell`. **Only** command prefix; sigil
    **configurable in settings** (default `!`). No `$`/`>`.
  - `/<command> [args]` → **slash commands** for app/agent verbs (`/wake`, `/sleep`, `/clear`,
    `/model`, `/help`, …) → typed actions or UI ops, **including `/local` and `/cloud`** to force
    the inference backend for one message (replaces the disliked `k:`/`o:`). Extensible/custom
    slash commands managed in settings (Integrations).
- **Design implication:** a small **input router** in the composer maps prefixes → handlers; bot
  replies render **markdown** with **copy / send-to-composer** on code blocks (generalize Vapor
  `editCmd`/`cmdInto`). See `ARCHITECTURE.md` §5. *(Prefix routing + formatting + `/local`,`/cloud`
  is effectively v1; custom/extensible slash commands are the post-v1 part.)*
- **Composer autocomplete / typeahead (raised 2026-06-14):** as you type, a filtered popover above
  the composer suggests completions — `/` → slash commands; `/agent ` → agent names
  (`GET /api/agents`); `/<partial>` → matching skills (`GET /api/skills`) + commands. **Frontend-only**
  (reuses existing endpoints + a static command list), viable + cheap. Becomes useful once 7e makes
  the agent/skill lists real (folders + per-agent skills), so it lands as a small slice after that —
  off the critical path. Arrow/Tab to select; Esc to dismiss.
- **Open:** slash-command registry shape; how custom commands are defined (config vs UI);
  configurable command sigil storage; autocomplete popover styling (Vapor tokens, D7).

### A3. Scheduled agent automations (cron triggers)

- **What:** define automations that **invoke the agent on a schedule with a configurable prompt**
  (the "openclaw"-style pattern: cron + a saved prompt + a privilege level → the agent runs the
  task unattended). E.g. "every night at 2am, check the fleet and sleep idle GPU boxes," "on
  Monday 8am summarize the week's events."
- **Design implication:** a new **scheduler subsystem** — stored `Automation { id, name, cron,
  prompt, privilege_level, target_thread, enabled, last_run, last_status }` in SQLite; a runner
  (APScheduler-style or a simple async cron loop in the FastAPI process). Reuses the same agent +
  action registry as interactive chat, just headless. Results land in the Event log + a thread.
- **Open:** what happens when an automation hits a `question` (A2) or a `confirm` action with no
  human → per-automation policy (skip / use default / notify and wait). Concurrency limits. This is
  a sizeable module — likely its own post-v1 phase.

### A5. Agent runtime: compaction · built-in tools (task/plan) · skills

Round out the agent into a real system (study opencode + public Claude-Code patterns first):

- **Context compaction.** The loop tracks the token budget; near the context limit (configurable
  threshold) or on manual **`/compact`**, it **summarizes older turns** into a compact summary that
  replaces them in the *working context* while SQLite keeps full history. A `sys` notice marks it.
  Distinct from durable memory (B): compaction = live-window management; memory = long-term recall.
- **Built-in agent tools + extensibility.** Ship a **`task_plan`** tool: the agent maintains a
  structured session **plan / task list** (steps with status), TodoWrite-style, persisted per-thread
  and rendered as a live `plan` panel in chat — drives multi-step work and makes headless
  automations legible. **Adding more agent tools = one file** via the same registry (D8); the
  toolset is built to grow.
- **Skills.** Reusable named capability bundles — `skills/<name>/SKILL.md` (frontmatter
  `name`/`description`/optional `allowed_tools` + instructions) + optional bundled scripts/resources.
  **Model-invoked** (agent selects by description) and **user-invoked** via `/skill-name` (A4).
  **Adding a skill = dropping a folder**; managed in Conf → Skills. Mirrors Claude-Code/opencode
  skills.
- **Compaction summarizer is selectable in settings** — mode local/cloud + a specific model name
  (use a cheap/fast model independent of the chat model).
- **Skill auto-selection is a swappable strategy** — default informed by prior art (opencode +
  public Claude-Code), but keep it **easy to replace/switch in settings**; don't hardcode.
- **Open:** the concrete skill-selection algorithm; plan persistence shape (message `meta` vs own
  table); whether skills bundle their own MCP servers/tools; skill sandboxing for bundled scripts
  (respect privilege levels). Decide at build time (Phase 4).
- **Deferred — make the active plan SALIENT to the model each turn (owner-noted 2026-06-27).** As built,
  the `task_plan` plan round-trips correctly into the model's context (it's the model's own `task_plan`
  tool-call `args.steps`; manual tick-edits update that call in place via `/api/agent/plan` so the model
  sees them next turn) — but it's a **passive, buried prior tool call**, so the model doesn't reliably
  acknowledge or continue the active step (and compaction can drop the steps on long threads). The fix is a
  *salience* layer, NOT new storage: foreground the current plan every turn. Design options to weigh
  (deferred for a more thought-out pass): (a) a small **per-turn system message** in `session.py`
  `_build_messages`, derived from the latest `task_plan` call (alongside the existing memory/roster/
  reflection system messages), e.g. "Current plan: ✓ … / ▶ active step / ▢ … — continue from the active
  step"; (b) **prepend the plan to the current user request** instead of a standing system message; (c) a
  hybrid (compact reminder only while a plan is active/incomplete). Considerations: token cost vs salience,
  not duplicating the plan the model can already see, compaction interaction (re-inject after a fold), and
  honoring manual edits immediately. Reuse the plan already in history — no separate plan store.

### A6. Multiple agents + subagents (configurable agent design)

- **What:** the agent is a **definition**, and there can be **several** (the owner can add more) —
  each with its own system prompt, backend+model, allowed tools/skills, privilege level, and memory.
  An agent can **spawn subagents** (a `spawn_subagents` tool) to delegate scoped tasks to other
  definitions — **run concurrently** (bounded fan-out under structured concurrency) with their own
  context + tool subset, results aggregated — like Claude-Code subagents / opencode's
  coordinator/swarm. Concurrency nuances (semaphores, cancellation, isolation, deadlock avoidance)
  are designed in `DESIGN.md` §5.5/§10.
- **Design implication:** model agents as config (`agents[]` in settings; or file-based like skills),
  selectable per chat/automation; the "main" agent is just the default definition. **Orchestration
  (how subagents are spawned/coordinated) is a swappable strategy** with a sensible default — keep
  it replaceable, decide specifics at build time. Reuses the same loop/tools/registry machinery.
- **Open:** agents as YAML vs files; depth/concurrency limits for subagents; how subagent results +
  privilege inherit; UI for picking/managing agents (Conf → Agents).

### A7. Agent tool-subsetting & quick-switch (selection control) — **optional, opt-in**

- **What:** let the owner **scope which tools an agent can see** — via **preset agents** (e.g. a
  *fleet* agent, a *research* agent) and/or **ticking tools on/off per agent in settings** — plus a
  fast way to switch agent **per message/thread** (a `/agent <name>` composer verb alongside
  `/local`//`/cloud`). Motivation: a weak local model mis-selects from a large toolset (live probe:
  `minig+` reached for MCP `search_web` on a fleet task; capability layer C1/C2 *contain* the spiral
  but prompt steering can't fully prevent the mis-pick — see HANDOFF "capability layer"). Narrowing
  the visible toolset removes the temptation **by construction**.
- **Why opt-in / not now:** the agent's role is **general, not fleet-bound** — the owner explicitly
  does **not** want to restrict the default agent. So the default stays **`tools: "*"`** (everything);
  subsetting is a feature you *opt into* by defining a narrower agent, never the default.
- **Design implication (the seam already exists):** `AgentDef.tools` is an inclusion **glob allowlist**
  (`ToolRegistry.for_agent`, `fnmatch` — e.g. `*_host`, `*_service`, `mcp__web-tools__*`); the agent
  runtime already honours it. So a "fleet" agent is pure **config** today
  (`agents: [{name: fleet, tools: [...]}]` + `agent.default_agent`). **What shipped in Phase 7d-b**:
  (1) the **Conf → Agents** management UI (`AgentsEditor.tsx`) creates/edits presets with a tools
  tick-grid and skills allowlist — no hand-editing YAML; (2) a **`/agent <name>` composer switch**
  (`ChatRequest.agent` + per-turn `_session` override · `GET /api/agents` lists names + default) lets
  one thread switch agent per message. **Still open**: maybe a couple of shipped presets; whether to
  surface the active agent in the composer/header. **Constraint to remember:** a **skill can only
  narrow, never widen** the toolset (`narrow_tools`), so you can't "add search back" via a skill to
  an agent that lacks it — the clean inverse pattern is a broad agent + skills that narrow per intent.
- **Open:** shipped presets vs all-custom; whether to surface the active agent in the composer/header;
  interaction with privilege (A1) and skills (A5).

---

## B. Memory (configurable, pluggable)

### B1. Selectable memory backends

- **What:** options in settings to choose how the agent remembers — and to manage it there:
  - **None** — stateless beyond the current thread.
  - **File-based** — a human-editable markdown file (`MEMORY.md` / `CLAUDE.md`-style; pinned facts,
    durable prefs). Git-diffable, transparent, exactly like Claude Code's memory.
  - **Vector** — embeddings store for semantic recall over past conversations/events.
  - **Both** — file for durable curated facts + vector for fuzzy recall.
  - (Orthogonal) **rolling summary** — compress old turns to stay in context; can pair with any of
    the above.
- **Design implication:** define a **`MemoryProvider` interface** in v1 (`load_context()`,
  `remember(item)`, `forget(id)`, `list()`) with a `none`/`file` impl first; `vector` is a drop-in
  later (needs an embeddings endpoint — could be another OpenAI-compatible `/v1/embeddings` base
  URL, fitting the existing pattern). Don't hardcode a single memory mechanism.
- **Open:** which embeddings backend; chunking strategy; whether memory is global vs per-thread vs
  per-project; retention/pruning UI.

---

## C. Voice

### C1. Streaming with non-streaming fallback (chat + voice)

- **What:** streaming responses by default, with graceful fallback when a backend doesn't support
  streaming. **Decoupled per-transport (✅ decided 2026-06-16)** — each transport owns its own knob;
  there is **no single global streaming toggle** (the three transports have different semantics +
  failure modes; over-coupling them was an early over-simplification):
  - **Chat** — `AgentCfg.streaming: auto|on|off` (✅ shipped design **D17**: SSE vs buffered-JSON one
    endpoint, `stream` body field under `auto`, setting authoritative). Shipped.
  - **Voice (STT live dictation + TTS progressive playback)** — a **designed integration pattern, D19**
    (2026-06-22): each service has a **reliable buffered transport** (shipped in 6a — one-shot HTTP with
    full D18 failover, the default + floor) and an optional **streaming transport** layered on top as a
    *fast path that degrades to the buffered one*. Per-service `voice.{stt,tts}.streaming: auto|on|off`
    reusing D17's vocabulary. **STT** streams over the primary's Speaches `/v1/realtime?intent=transcription`
    WebSocket (verified your model is supported) via a backend WS proxy + an extension to `useDictation`
    (AudioWorklet PCM + provisional-draft) — no parallel component. **TTS** streams as a second *source
    strategy* on the `audioController` singleton (MSE progressive playback), trading the seekable scrubber
    for time-to-first-audio in `stream` mode. **Full design + cost in D19.**
- **Revision note (2026-06-22):** this supersedes the earlier "STT is always buffered, no toggle" line —
  the owner asked for streaming STT as a real, integrated pattern, and Speaches already exposes the
  realtime ASR, so it's now a first-class designed transport (D19), just deferred (post-v1 polish, not a
  Phase-6 build).
- **Design implication:** chat's dual-mode is D17; voice's two-transport pattern is **D19**. Phase 6a/6b
  shipped the **buffered** STT + TTS transports (the reliable floor); the streaming transports are the
  D19 follow-ups, each with its own pre-flight. The measured STT cold-start lag is fixed *server-side*
  (keep the whisper model warm), independent of streaming.

### C2. Wake word

- **What:** optional always-listening **wake word** ("hey ctrl-b") to start dictation hands-free.
- **Design implication:** runs **client-side in the browser** (e.g. openWakeWord / Porcupine WASM)
  so **no audio leaves the device** until the wake word fires — then it opens the mic and routes to
  the existing STT path. Off by default; a settings toggle + sensitivity.
- **Open:** browser background-listening reliability on Android (tab must be foregrounded / PWA
  active); battery; secure-context still required (same Tailscale-Serve HTTPS need as the mic).
  Feasibility flagged — "if possible."

### C3. Chunked TTS synthesis (split the reply, play it progressively) — **noted 2026-06-26 (owner)**

- **What:** instead of synthesizing a whole reply as ONE blob, split it into speakable **chunks** and
  synth+play them **sequentially with synth-ahead** (synth chunk N+1 while chunk N plays). Two triggers:
  (1) the per-bubble ▶ play button, (2) auto-TTS **as the reply streams in** — enqueue each chunk the
  moment its boundary arrives, so it reads along with generation.
- **Chunking strategy:** split on paragraph / sentence-ending punctuation; **list items individually**
  (one chunk per `- `/`1.` item); **markdown-aware** so it never splits mid-element and never reads a
  fenced code block aloud (parse the block, then decide). Tunable min/max chunk length so tiny fragments
  merge and huge paragraphs split.
- **Why it's worth it:** **time-to-first-audio** — you hear the first sentence in ~1–2s instead of waiting
  for the whole reply (the "24s for a long message" pain). It also **sidesteps the idle-connection reset**
  (each chunk is a short request, never a 24s-idle socket — see the TTS-idle note) and enables
  read-along-while-streaming.
- **vs C1/D19 (streaming TTS):** *simpler and complementary.* Chunking works with the **existing buffered
  TTS endpoint** — no streaming TTS server / MSE needed; it's a client-side strategy on `audioController`.
  D19's MSE byte-streaming is the deeper per-chunk optimization; chunking alone is the cheap, high-value
  first step. They compose (stream each chunk), but chunking is the prerequisite win.
- **v1 seams that already exist:** `lib/toSpeech` (markdown→plain text — already strips for TTS), the
  hand-rolled block parser in `lib/markdown.tsx` (reuse its element list to chunk markdown-correctly), and
  the `audioController` singleton (would gain a synth-ahead play **queue**).
- **Effort (owner asked: "big improvement or refactor?"):** big *improvement*, **moderate refactor** —
  NOT huge for the play-button case: `audioController` goes from single-blob to a small **play queue**
  (synth-ahead, advance on `ended`, per-chunk blob cache), plus a new pure **chunker** helper
  (markdown-aware split, unit-testable). The **stream-as-you-go** trigger is the larger, separable part
  (boundary detection on the streaming text + enqueue from the chat reducer). UX decision: the now-playing
  scrubber represents the whole message (concatenated) vs per-chunk.
- **Settings:** `TtsServiceCfg` gains a chunk mode (`off | paragraph | sentence`) + min/max chunk length;
  default `paragraph`. `off` = today's whole-message synth.

---

## D. Fleet automation

### D1. Idle sleep — **OS-native (✅ decided 2026-06-16); ctrl-b adds nothing for now**

- **Decision (2026-06-16):** for plain "sleep the machine when idle," **let each host's own OS power
  plan do it** (Windows power settings / Linux `systemd`/logind suspend-on-idle). The OS already
  detects input-idle correctly, locally — so ctrl-b implements **no** idle-shutdown and **no** remote
  idle detection for now. This deletes the old "⚠️ hard part" entirely: there is nothing to query over
  SSH because the decision never leaves the host.
- **What ctrl-b is NOT building (the reasons that *would* have justified it — none wanted now):**
  central shutdown-on-idle policy (full power-off vs sleep), and fleet-wide automation
  ("every night sleep idle boxes"). Revisit only if one of these becomes a real need.
- **Future maybe — compute-aware idle (the owner flagged it "later, not now"):** "don't sleep/shut
  down while a GPU/compute job is running; act once it's truly done." This is the **only** variant the
  OS power plan *can't* do (input-idle ≠ compute-idle), and it's where the genuinely hard remote
  detection lives (a compute signal — GPU utilization / job presence — not last-input time). Deferred;
  if built, design the detection mechanism then (likely a tiny per-host signal over the existing
  SSH/open-terminal channels before any persistent helper agent).

### D2. Wake-on-connection

- **What:** (from the old README TODO) auto-wake chosen hosts when the phone/owner joins the
  LAN/tailnet — walk in the door, the boxes are already coming up.
- **Mechanism (✅ decided 2026-06-16 — A primary, B as MVP; both reuse `wake_host`, no public surface):**
  - **A (the real feature) — Tailscale-status poll.** The backend (already on the tailnet, always-on)
    polls `tailscale status --json` / the local tailscaled API for the owner's **known device**
    transitioning offline→online, then fires `wake_host` on the configured targets. Reuses the tailnet
    (answers the "no public surface" worry — the check is local to the backend host) and the existing
    fleet **monitor-loop pattern**. Config: owner device node(s), wake targets, debounce/cooldown.
  - **B (near-free MVP, can ship first) — PWA-connect trigger.** When the owner's client opens its SSE
    stream (existing connect path), an endpoint wakes the configured hosts. Trivial, no new deps; weaker
    semantics ("wake when I *open the dashboard*," not "when I get home"). Not mutually exclusive with A.
  - **Rejected — C, LAN ARP/ping presence:** Android suppresses ping (battery), phone IPs churn,
    LAN-only. Strictly worse than A.
- **Timing:** post-v1; the **A** build pairs with the **A3 scheduler / monitor subsystem** (none exists
  yet). **B** can ship independently of the scheduler. Detection (A) reuses `tailscale`, never a public surface.

---

## E0. More tools (the extensible Utils registry — D8)

- **What:** the Utils tab is a **tool registry** (one file per tool → endpoint + card + optional
  agent tool; see `ARCHITECTURE.md` §1). v1 ships `yt_captions`, `ip_info`, and `dns_trace`.
- **Easy future drop-ins:** whois, reverse-DNS / PTR, port check, ping/MTR, HTTP header inspector,
  TLS-cert info, speedtest, subnet calculator, MAC-vendor lookup, "wake-and-open" combos. Each is a
  handler + Pydantic input + metadata — no routing/UI/agent wiring by hand.
- **Open:** which tools to prioritize; whether any need long-running/streaming output (reuse SSE).

### E0a. Per-tool settings (owner-configurable tool behavior) — **future, noted 2026-06-24**

Beyond the per-tool **description override** + **agent-access mode** (core/enabled/disabled) shipped
in Phase 8b, the owner wants to eventually set **tool-specific behavior knobs** from the Tools tab —
e.g. `web_search` default result count, `dns_trace` record types / timeout, `ip_info` provider,
`yt_captions` language. Recorded so the Phase-8 seam is built with this in mind.

- **Shape (the clean path):** a tool optionally declares a `settings_model: type[BaseModel]` on its
  `ToolSpec` (sibling of `input_model`). The owner's values live in a name-keyed map and are
  **validated against that tool's `settings_model`**; the catalog renders a settings form from its
  JSON Schema **reusing the same schema→form renderer built for the run cards** (no per-tool UI).
  Opt-in: most tools declare none and show only mode + description.
- **Application point (decide at build):** ActionService merges `tool_settings[name]` as **defaults
  under the call args** before `input_model` validation, *or* passes them via `InvocationContext`.
  Precedence must be explicit: **explicit call arg > owner tool-setting default > model field
  default**. Watch the overlap where a setting *is* a default for an input field vs. tool-private
  config not exposed as a call arg — keep those two notions distinct.
- **Unified override object from the start (decided 2026-06-24, research-backed):** Phase 8b stores a
  **single unified `tool_overrides: {<tool>: {description, agent_mode}}`** map (Option B), *not*
  sibling name-keyed maps. Deep-research (25/25 claims verified 3-0; VS Code / ESLint / Pydantic /
  MCP / rjsf primary sources) found sibling maps are the **refactor trap** — each new dimension is a
  new top-level map + new read/merge code, paid when the data is no longer empty. Adding per-tool
  `settings` here is therefore **purely additive**: one optional field on `ToolOverride`, typed as a
  **Pydantic v2 discriminated union keyed by tool** (`Field(discriminator=...)`), each tool declaring
  a `settings_model`. No migration. (CLAUDE.md "shape data to extend, not migrate" generalizes this.)
- **Issues:** heterogeneous per-tool schemas (no uniform typed model — hence `settings_model` per
  tool); hot-apply (most settings are read at call time → no client rebuild, but a connection-shaped
  setting would need the reconfigure path); stale keys for no-longer-discovered MCP/OpenAPI tools
  (ignored by the overlay, like `tool_descriptions` today).

## E. Alternate frontends

### E1. Discord / Telegram bots as thin clients

- **What:** revive the old `ctrl+discord.py` / `ctrl+telegram.py` stubs — but as **thin clients to
  the same FastAPI**, not separate logic. Chat with the agent / trigger actions from Discord or
  Telegram.
- **Design implication:** because all logic lives behind the typed API + action registry, a bot is
  just another client calling `/api/agent/chat` + `/api/actions/*`. Keep the API the single source
  of truth so frontends stay thin (browser PWA, native app, bots, automations all share it).
- **Open:** auth/identity for bot channels (still tailnet-only? a bot bridges *out* to Discord/TG —
  reconcile with the no-public-exposure model: the bot process runs on the tailnet and polls those
  services outbound, which is fine).

### E2. OpenAI-compatible `POST /v1/chat/completions` facade — **deferred (decided 2026-06-21, D17)**

- **What:** expose ctrl-b's agent as an **opaque "agent-as-a-smart-model"** OpenAI endpoint, so any
  OpenAI-speaking client/SDK/tool can drive it. Tools run *server-side* (invisible to the caller); the
  response is just the final answer, streamed as `chat.completion.chunk`s or returned as one
  `chat.completion`.
- **Why a facade, not a reshaping of `/api/agent/chat`:** OpenAI Chat Completions is a *stateless,
  client-executes-tools, single-completion* contract — a different altitude from ctrl-b's stateful,
  server-executes-tools, human-in-the-loop protocol. Keep the custom protocol as the core; this is a
  boundary adapter (anti-corruption layer, D17). The `stream` field already on `/api/agent/chat` (D17)
  is the same convention this endpoint uses natively, so the two stay mentally consistent.
- **Scope (~200–300 LOC):** a new `api/openai_compat.py` router + OpenAI request/response Pydantic
  models; map `model`→agent (`resolve_agent`), `messages[]`→a seeded ephemeral thread, drive
  **`run_turn`**; `stream:false`→`collect_turn`→`chat.completion`, `stream:true`→map `text.delta`
  AgentEvents→`chat.completion.chunk` + `data: [DONE]`. **Confirm policy:** run **`interactive=False`**
  (the existing headless path) so confirm-gated tools deny-in-place — an OpenAI client can't render a
  confirm bubble. Usage tokens: return zeros/omit (untracked). Conf toggle to enable; still tailnet-only.
- **Reuse already in place (from D17):** `collect_turn` + the `interactive=False` headless-confirm path
  are the foundation — this slice is mostly the OpenAI ↔ domain translation. Target **Chat Completions**
  (the widest-supported lingua franca) rather than the newer Responses API for max third-party interop.

---

## F. Notifications

### F2. Live-connection indicator when the app bar is hidden — **deferred, after the themes (owner 2026-06-27)**

- **What:** the SSE "live feed dropped / reconnecting / offline" badge currently lives ONLY in the app bar
  (`components/AppBar.tsx`, `theme-engine/kit/AppBar.tsx`, driven by `store/connection` via `useEvents`).
  The new global **Hide app bar** lever removes the bar — and with it, the only connectivity indicator.
- **Refine (later, once the theme work is done):** surface the disconnected/reconnecting state somewhere the
  hidden-app-bar layouts still show it — e.g. a brief auto-dismissing toast on transition (reuse the existing
  toast store), a small fixed corner dot, or a one-line banner. Reuse `store/connection` (no new state). Low
  priority for a single-user tailnet app; noted so it isn't forgotten.

### F1. Push to phone on fleet events

- **What:** notify when a host wakes/dies, an automation finishes, an action fails, or — key —
  **the agent needs input it can't get** (a `question` or a `confirm` it lacks privilege for, while
  unattended; see A2). That last one turns notifications into the response channel for a
  low-privilege/headless agent.
- **A native app is NOT required.** Three delivery channels, by scenario:
  1. **App open/foregrounded → Notifications API** triggered by the existing SSE stream. Pure
     client-side, no external dependency. *(v1-trivial.)*
  2. **App closed/backgrounded → Web Push** (service worker + VAPID; server sends outbound to the
     push service, FCM on Android). Survives a closed tab on an **installed Android PWA**. Delivers
     even when the phone is off the tailnet; no inbound exposure (server→FCM is outbound, payloads
     E2E-encrypted). Cost: depends on Google FCM + subscription plumbing. Needs HTTPS (already have
     it via Tailscale Serve).
  3. **Self-hosted ntfy or Telegram/Discord bot (recommended for background).** ntfy: tiny
     pub/sub on the tailnet, server POSTs, ntfy Android app receives — **instant delivery without
     Google FCM** (its app holds a persistent connection; phone must be on the tailnet to receive).
     Bot (E1): runs on the tailnet, connects outbound to Telegram/Discord → rock-solid background
     push anywhere, zero new infra, doubles as an alternate frontend.
- **Decided defaults:** the whole notifications feature is **optional — master toggle in
  settings** (off = nothing fires). When enabled, the **PWA-native stack is the default and is
  wired automatically**:
  - **app open → foreground** Notifications API driven by the SSE stream;
  - **app closed → Web Push** (service worker + VAPID).
  Both on by default once notifications are enabled; no extra infra beyond generating VAPID keys.
  **ntfy (self-hosted)** and the **Telegram/Discord bot** are **optional** extra channels (for
  no-FCM / off-tailnet / chat-app delivery), off unless configured. **Per-event toggles** in
  settings decide *which* events notify. A native app is never required.

> **How Web Push works (and why FCM + VAPID).** Four actors: the **PWA**, its **service worker**
> (background script that survives the tab closing and shows the notification), the **push
> service** (run by the *browser vendor* — FCM for Chrome/Android, Mozilla for Firefox, Apple for
> Safari; you don't choose it), and your **backend**. A phone can't be reached directly (NAT,
> asleep, battery), so the OS keeps **one** persistent push connection to the vendor's service and
> every site shares it — on Android that pipe is **FCM**, which is why it's unavoidable there.
> Flow: (1) PWA requests permission; service worker `subscribe()`s → browser returns a
> **subscription** = an endpoint URL at FCM + encryption keys; (2) PWA stores that on your backend;
> (3) to notify, backend **encrypts** the payload with the subscription key, **signs** with its
> **VAPID** private key, POSTs to the FCM endpoint; (4) FCM wakes the service worker →
> `showNotification()`. **VAPID** = a self-issued identity keypair so the push service trusts your
> messages (rejects spoofers) and — crucially — lets you send **without a Firebase project**, just
> your own keys (`pywebpush`/`web-push`). Server calls are **outbound-only** (no inbound exposure),
> payloads are **E2E-encrypted** (FCM relays ciphertext), needs HTTPS (Tailscale Serve covers it),
> and it delivers **even when the phone is off the tailnet** — the main edge over self-hosted ntfy.
- **Open:** which channel(s) to wire first; which events are notify-worthy (user-configurable);
  ntfy tailnet-only vs needing off-tailnet delivery (→ Web Push or bot for that).

---

## G. Security hardening (post-v1)

- SSH `known_hosts` pinning instead of `AutoAddPolicy` (note in `ARCHITECTURE.md` §7).
- Per-action confirmation tokens / signed action requests.
- Audit-log export + retention controls.
- Optional encryption-at-rest for secrets in `config.yaml` (vs plaintext today).

---

## Settings tab — organized by functionality (informs v1 Conf layout)

Even pre-implementation, lay out the Conf tab in **functional groups** so these land in obvious
homes later:

- **Inference** — backend mode (local llama.cpp / cloud), endpoints, keys, models, **embeddings
  endpoint** (llama.cpp `/v1/embeddings` — D9).
- **Agent** — privilege level (A1), streaming mode (C1), prompts (system/command/post), tool/action
  allowlist, ask-questions behavior (A2), compaction threshold + `/compact` + **summarizer model**
  (local/cloud + name) (A5).
- **Agents** (A6) — manage multiple agent definitions (prompt, backend+model, tools/skills,
  privilege, memory); pick default; subagent settings. Add more agents.
- **Skills** (A5) — list/enable/disable/view/edit skills (`skills/` dir); add new skill; show which
  tools each skill is allowed.
- **Memory** — backend selector (B1: none/file/vector/both), rolling-summary toggle, view/edit
  file memory, prune/clear, vector store status.
- **Voice** — STT endpoint/model, TTS endpoint/voice/model, auto-TTS, wake word (C2).
- **Automations** — scheduled agent tasks (A3): list, cron, prompt, privilege, enable/disable.
- **Fleet / Hosts** — host CRUD + per-host idle action & threshold (D1), wake-on-connection (D2).
- **Server** — host/port, poll interval, debug, Tailscale-Serve/HTTPS status.
- **Notifications** — master on/off; default PWA-native (foreground + Web Push, auto); optional
  ntfy / Telegram-Discord channels; per-event toggles (F1).
- **Appearance** — theme, skyline, hero, waveform (from Vapor). **Now the Theme Engine (DECISIONS D28,
  TODO Phase 11, design in `THEME_ENGINE.md`):** a pluggable presentation layer — a `ThemeRegistry` of
  `ThemeDef`s resolved via slots over the shared data/logic core, switching between distinct, pixel-faithful
  design systems (vapor [frozen default] · minimal · phosphor · cosmos · frontier · observatory) each with its
  own `[data-theme]`-scoped lazy CSS bundle, fonts, palette axes (`{theme,mode,accent}`), and `present(host)`
  per-host visual encoding. **v1 seams to build now (Phase 11 T0):** the registry + slot system, the
  `{theme,mode,accent}` `ui` store with an **injectable initial value** (the cross-device sync seam — a
  `config.yaml appearance` block synced via the settings API, designed + deferred), the semantic-token contract
  for non-vapor themes, and the per-host `host.appearance:{<themeId>:blob}}` override field (additive,
  no-migration). Adding a future theme = one registry row + one self-contained module + one verbatim scoped CSS.
- **Icon tooling (DX, noted 2026-06-28)** — icons are currently **hand-inlined SVGs** (the shared Kit chrome,
  the NavMenu, action buttons), which is fine at this scale but tedious + easy to mis-trace. Future: adopt
  **`unplugin-icons` + Iconify** (build-time, on-demand, tree-shaken, **offline-friendly** — inlined at build,
  no runtime CDN) so any Lucide/Material/etc. icon is `import X from "~icons/<set>/<name>"`. Purely additive —
  migrate the **shared Kit icons** opportunistically for consistency; **leave frozen vapor + the bespoke cosmos
  art alone** (`lucide-react` is the Lucide-only alternative). Until then: inline the *exact* official SVG
  (never a path into `docs/screenshot/`, which is reference-only).
- **Integrations** (D9) — **MCP servers** manager (add/edit/enable; stdio `command+args+env` or
  Streamable-HTTP `url+headers`; tool discovery per server); **SearXNG** endpoint (powers
  `web_search`); custom slash commands; Discord/Telegram bots (E1).
