# Roadmap & future additions — dashboard_v2

Features the owner wants *eventually*. They're recorded here so the **v1 architecture leaves room
for them** — the "build it extensibly now, implement later" list. Nothing here is v1 scope unless
also in `TODO.md`. Each item: **what · why/UX · design implication · open questions.**

Guiding principle: build the v1 seams (pluggable memory, action risk levels, typed chat-message
kinds, streaming-or-not endpoint, a settings/policy layer) so these slot in without a rewrite.

> **ID namespace.** Item ids here (A1, C1, **D1–D3**, E0…) are **ROADMAP-local** — section letter +
> number. They are a *different namespace* from `DECISIONS.md`'s **D#** entries, and the two collide
> on D1/D2/D3 (e.g. **ROADMAP D3** = multi-homed host addressing; **DECISIONS D3** = the hybrid
> execution model). When citing from another doc, always prefix: "ROADMAP D3" vs "DECISIONS D3".
>
> **Shipped since drafting** (carry inline ✅ markers below; listed here so the doc isn't mistaken
> for a pure futures list): **A1** privilege levels (as the `decide()` gate + AgentDef privilege) ·
> **A2** `question` kind · **C1** streaming `auto|on|off` (D17) · **D1** Tailscale Serve HTTPS ·
> **D2** access panel/QR core · the **theme engine** (D28–D34; vapor/minimal/cosmos) · **ROADMAP D3
> Slice 1** multi-homed addressing (backend, D47) — and **D3 is now COMPLETE**: slice 2 (frontend
> vantage-aware links + Conf editor) shipped 2026-07-21, slice 3 (VPN discovery) 2026-07-22. Still
> future: A3 automations, B-series memory backends.

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
- **Composer autocomplete / typeahead (raised 2026-06-14) — ✅ SHIPPED 2026-07-29 (`39a7fdd`, QoL
  cluster Slice 1):** a filtered popover above the composer — first token → built-ins > skills >
  providers (the routing precedence, one shared `BUILTIN_VERBS` table); `/agent ` → agent names;
  `/priv[ilege] ` → the privilege ladder. Kit-only (frozen vapor stays verb-only, owner ruling);
  APG-derived list-autocomplete ARIA on the native textbox role (no `role="combobox"`/`aria-expanded`
  — neither is conforming on a `<textarea>`; Codex round, fixed `a0bfdfa`); tap-accept on
  pointerdown; Arrow/Tab/Enter + Esc on desktop.
  - **Follow-up (owner, 2026-07-29 device eyeball) — ✅ SHIPPED 2026-07-30:** the popover no longer
    renders base outline chrome regardless of the resolved `composerSkin`. As built: the A2 popover
    and the A6 tools panel share ONE popover shell recipe in kit.css (the `.priv-menu` copy folded
    into it — base chrome only, no skin participation: it is header chrome), and the two
    composer-anchored occupants take a per-skin block off `body[data-composer-skin]` (glass frost +
    perf-lite fallback · bezel edge · sleek flat · outline = the base). Both also gained the plan
    sheet's full open/close slide — mounted-when-closed + `inert` (the plan sheet's own latent
    `aria-hidden`-over-focusable trap was fixed to `inert` in the same pass). →THEME_ENGINE §14.16/§15.
- **Open:** slash-command registry shape; how custom commands are defined (config vs UI);
  configurable command sigil storage. *(Popover styling — CLOSED 2026-07-30: the Kit shell recipe +
  the `composerSkin` per-skin blocks above; vapor stays verb-only with no popover at all, D7.)*

### A3. Scheduled agent automations (cron triggers) — **✏️ design LOCKED 2026-07-30 (D49) · spec = [`AUTOMATIONS_PLAN.md`](./AUTOMATIONS_PLAN.md) · build = TODO Phase 14**

- **What:** define automations that **invoke the agent on a schedule with a configurable prompt**
  (cron + a saved prompt + an agent/privilege → the agent runs the task unattended). E.g. "every
  night at 2am, check the fleet and sleep idle GPU boxes," "Monday 8am summarize the week's events."
- **Locked shape (supersedes the earlier sketch here):** `automations` + `automation_runs` in
  SQLite (v4/v5 migrations) · hand-rolled poll-and-claim lifespan loop + `cronsim` (R7) · runs
  ride the existing turn machinery (reserve/drain/cancel) headless via the subagent pattern ·
  question policy `skip|use_default` per automation, confirms follow the privilege/approvals
  ladder · concurrency 1 (one arbiter incl. run-now) · misfire = skip (`misfire_grace_s`) ·
  fresh-thread-per-run default + `rolling` mode (`pinned` future) · origin/run_id attribution
  (R9) · create-only `create_automation` agent tool (R8) · Conf list + sheet editor with cron
  presets + escape hatch. All open questions from the old sketch are ruled in D49/the plan.
- **Still-future extensions (recorded in the plan §Out of v1):** `pinned` thread mode ·
  notify-and-wait (the A1+A3+F1 tie below) · rolling-thread takeover · pause-after-N-failures.

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

#### A5-x. Deferred chat-loop items inherited from the ACA (re-homed 2026-07-20)

The agent-chat audit ([`AGENT_CHAT_AUDIT.md`](./AGENT_CHAT_AUDIT.md)) shipped as `TODO.md` Phase 12
(Slices 0–8, all built). Its "Backlog (explicitly not scheduled)" items lived only in that closing
document; they are re-homed here so they survive the chapter. Each keeps its ACA id as the pointer
back to the analysis.

- **A8 — deferred tool schemas.** Send lean tool manifests and fetch a tool's full JSON schema only
  when the model actually reaches for it (Claude-Code pattern). *Deferred because:* Slice 1 shipped
  the measurement rider (per-turn tools+head token cost is logged) and it has **not** shown pressure —
  build it when the log says the manifest is expensive, not before. ACA §4 A8.
- ~~**A10 — hard reasoning budget** for local thinking models (a `</think>` cap).~~ **CLOSED / BUILT
  2026-07-20 (D45).** D42 (Slice 6) had absorbed the call-config half (per-agent `max_tokens` + the
  `reasoning_effort` ladder); this entry's deferral rested on "a real cap needs a llama.cpp control
  surface that doesn't exist yet" — **which turned out to be false**: llama-server parses a
  per-request `reasoning_budget_tokens` (and ignores `reasoning_effort` entirely, so the knob we were
  sending was the no-op). D45 wires it via the per-endpoint `api_mode` field: the ladder is
  translated per backend and `ModelRef.reasoning_tokens` is now a live explicit override. ACA §4 A10.
- **Gemini-style content-chant detector** — spot a model looping the same narration and break it.
  *Deferred because:* purely speculative; build it only if narration loops actually appear in use.
  ACA §5 Backlog.
- **pi-style provider-portable thinking-block transforms** — normalize reasoning blocks so a thread
  can hand off mid-conversation between providers. *Deferred because:* D43 (Slice 7) **code-verified
  it unnecessary today** — our local model emits no reasoning blocks to normalize. Revisit when a
  reasoning local model lands. ACA §4 A7 (transforms half).
- **Turn-status DB fallback after cache eviction** (2026-07-20 live-test find, LOW). A completed
  thread whose terminal-cache entry evicted (`linger_s`=60s / cap 32) reports `terminal_status:
  null` from `GET /api/agent/turns/{thread}` — indistinguishable from "unknown/lost", though the
  messages are durably in SQLite (a tester misread it as turn loss). Optional hardening: fall back
  to a cheap DB check (trailing assistant message for the last user turn) before returning bare
  `{active: false}`. Display-surface only; D39 persistence itself verified end-to-end.
- **`/compact`-on-small-thread UX** (2026-07-20 live-test find, LOW). A forced `/compact` on a
  thread too small to fold correctly inflation-rejects (`removed: 0, rejected: true` — a real
  5-section summary would GROW the context), but the response reads like a failure. Surface a
  "thread too small to compact" message instead. Semantics are correct; signal is confusing.

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
- **Composer tools/skills MENU — ✅ SHIPPED 2026-07-29** (QoL cluster Slice 2, `ad8ef82` + review
  waves `0b0aad2`/`04247c7`): trigger at the controls leading edge (kit-only), one-shot tri-state
  agent radio (native inputs) + skill ticks riding the existing `ChatRequest.agent`/`skills` fields,
  `mergeComposerSlots` (the DefaultRoot inline slot-drop limitation is dead), and the
  `store/composerOverlay` one-overlay-at-a-time coordinator. Typed verbs beat menu picks; arming is
  spent on send. Residual (LOW, recorded): a 409/Stop-harvest after dispatch loses the armed pick.
  Original seam note kept below for provenance — noted 2026-07-11 (owner, at the A2
  composer-surface eyeball): surface the selection control as a **menu in the composer**, at the
  controls **leading edge beside the plan pill**. The layout seam already exists and is additive:
  the D30 slot contract (`ComposerSlots.controlsStart` — `kit/composer/types.ts`) takes any node, so
  a menu trigger composes in next to `PlanPill` with zero contract change (a new named slot is also
  reserved-additive if independent placement is ever wanted); the popover reuses the plan-sheet
  `overlay` idiom or the existing bottom-sheet. A4's `planPill` placement setting moves the whole
  `controlsStart` composition, so the menu follows that lever for free. **Data side:** per-message
  scope rides the shipped per-turn `ChatRequest.agent` override (pick a preset from the menu); true
  per-message tool/skill *ticking* would add an optional narrowing-override field to `ChatRequest`
  (mirror `narrow_tools` semantics — narrow-only, never widen; design at build time). Selection
  state = a small store beside `store/composer.ts` (draft precedent).

### A8. Composer attachments (files/images to the agent) — **noted 2026-07-11 (owner)**

- **What:** attach files/images to a chat message from the composer — an **attach button next to the
  mic** — so the agent can read configs/logs/screenshots (multimodal when the model supports it).
- **Design implication (the seam is the mic precedent):** attach is core composer **chrome, NOT a
  theme slot-addon** — same class as mic/send. Behavior lives in the headless `useComposer()`
  controller (file picking, upload state), and **each variant renders the button in its own
  arrangement** in parity (Kit's controls row · the docked sheet's field trailing edge beside the
  mic · the future `line` variant, whose Phase-E spec already reserves `[attach] [mic/send]`).
  Render on capability, like the mic's `sttReady` gate. Slots stay for theme-optional decoration;
  attach is functionality every variant must offer once it exists.
- **Backend (its own design pass at build time):** upload endpoint + storage/retention, an
  attachment message-part in the chat schema, size/type limits (single-user tailnet keeps the threat
  model small — but SECURITY_MODEL still gates what the agent may *do* with a file), and feeding
  attachments to the model (multimodal vs text-extraction fallback).
- **Open:** storage location + retention; image-only vs any-file first slice; whether attachments
  persist in thread history (DB) or are turn-scoped.

### A9. Composer model indicator — **✗ DROPPED 2026-08-20 (owner ruling): superseded by D62**

- **What it was:** a small live "which model is serving" label in the composer controls row.
- **Why parked originally (2026-07-12, frontier F1 pre-flight):** an honest label needs a backend
  resolved-model signal the client doesn't have, and D18 failover means a static label would lie.
- **Why dropped:** **D62 per-message serve attribution (v1.7.4) ships the honest version of this
  fact where it is true** — `Message.source {served, degraded, from}` persisted per assistant turn,
  rendered as the who-line endpoint chip with a degraded warn + tap disclosure. A composer-side
  *predictive* label would still have to guess (failover resolves only when the backend answers),
  so it stays the dishonest half; the owner ruled the D62 chip covers the need. Don't re-propose;
  if a predictive label is ever wanted anyway, the D62 `SourceInfo` machinery is the seam.

---

### A11. Unified provider registry — retire the local/cloud dichotomy (**design LOCKED 2026-07-22 → DECISIONS D48 · BOTH SLICES ✅ BUILT 2026-07-23 — chat, and voice+embeddings — plus the 2026-07-27 pre-release fix wave; still UNRELEASED, it ships with UPDATE_PLAN slice 8**)
*(numbered A11, skipping A10, so the heavily-cited "ACA §4 A10" reasoning-budget id stays unambiguous)*

- **Status:** the design session ran 2026-07-22 and the design is **LOCKED — owner-signed the same
  day**; both slices are built and every interpretation call was ratified 2026-07-27. The **full normative spec is [`DECISIONS.md` D48](./DECISIONS.md)** — config
  shape, contracts C1–C11, module boundary, Conf UI spec, migration, and the prod rollout/rollback.
  Build plan = **[`TODO.md`](./TODO.md) Phase 13** (Slice 1 chat, Slice 2 voice+embeddings).
- **Evolution (why the scope grew):** the session started at "one list of named custom endpoints +
  a default pointer" and converged, over four foreign-review rounds (Codex: NO-GO → NO-GO →
  GO-with-changes → GO-with-changes final), on a **unified `providers:` registry** — a name-keyed
  map of *connections*, each carrying a name-keyed **model catalog**; consumer sections hold a
  **flat `provider` primary + ordered `fallbacks[]`** (first-in-chain is the default — no separate
  pointer). **Voice STT/TTS and embeddings were unified into the same registry** (their endpoint
  slots deleted), so one shape and one failover walker serve chat + voice + embeddings. `/local`
  `/cloud` generalize to `/<provider>` verbs.

### A12. Prompt-eval harness (promptfoo) — deferred from Phase 18 (2026-08-15)

- **What:** a regression harness for prompt edits — now that all 18 registry prompts are
  owner-editable (Conf → Prompts, D56), there is no way to tell whether an edit helps or degrades
  the agent except vibes. This is Phase 18's "Slice 4", deliberately deferred to its own phase.
- **Design (sketched, [`PROMPTS_PLAN.md`](./PROMPTS_PLAN.md) §2.7 + the §7 slice table):**
  promptfoo's `http` provider against ctrl-b's real chat API; a scenario corpus of 20–50 tasks
  promoted from real transcripts; **scripted-tool mode** so eval runs never touch real hosts;
  grading on **outcomes, not tool sequences** (Anthropic guidance, R31 ⑪); a local judge via
  `llm-rubric`/`select-best` with `apiBaseUrl` (llama.cpp-compatible); per-run report = the
  aider-row shape (terminal-state counts · `invalid_raw` · per-call token usage, all persisted
  since Slice 2).
- **Open questions:** corpus curation/promotion flow; judge quality with a local model; where
  scripted-tool mode hooks in (the registry seam vs a fake `ActionService`); whether the deferred
  `cause` taxonomy (PROMPTS_PLAN §2.7 recorded non-build) becomes needed once runs are graded.

### A13. OpenAI-Codex OAuth provider (device-code flow) — owner ask 2026-08-19

- **What:** let ctrl-b's chat ride the owner's ChatGPT/Codex subscription as a provider — the
  same `openai-codex` OAuth the owner's Hermes agent uses (device-code sign-in: a short code +
  https://auth.openai.com/codex/device on the phone, no localhost redirect, no API key). Chosen
  as a future feature the day the Hermes credential was re-authorized exactly this way.
- **Seams already in place:** the D48 provider registry models everything but the credential
  refresh — a provider entry is `base_url + api_mode + models{}`; the wire-normalization layer
  (DESIGN §7, R41/R42) already makes strict templates safe; failover chains take any provider.
  **The one genuinely new piece is a credential TYPE:** today `api_key` is a static string —
  this needs an oauth record (access/refresh tokens + expiry) with a refresh-before-use hook at
  the adapter's client construction, plus a `hermes auth add`-style device-code CLI/Conf flow to
  mint it. Secret handling follows the existing config-secrets model (SECURITY_MODEL; masked,
  never echoed/committed).
- **Reference implementations, both on this machine:** Hermes `hermes_cli/auth.py`
  `_codex_device_code_login()` (device-code request → poll → token store; the client_id +
  endpoints are public constants) and the Codex CLI's auth manager. Field caveat learned
  2026-08-19: refresh tokens for the account die together across consumers when the account's
  sessions are revoked — surface a clear re-auth error, not a silent failover.
- **Research ✅ BOUGHT 2026-08-20 = [R49](./research/R49-openai-oauth-provider.md)** (owner go
  2026-08-20; codex-rs + Hermes local source + LiteLLM + opencode plugins, load-bearing Hermes
  claims spot-verified). Headlines that reshape the entry above: the flow half is CHEAP (3
  device-code calls, one public client_id, server-side PKCE; a ChatGPT security-settings beta
  toggle is a prerequisite) but **the wire half is the real cost — the token buys the
  Responses-only `chatgpt.com/backend-api/codex` endpoint** (codex-rs dropped `wire_api="chat"`),
  so the adapter needs a Chat→Responses bridge or a second wire mode, NOT just a credential type.
  Access JWT = 10 days; **refresh ROTATES with server-side reuse detection** — ctrl-b mints its
  OWN login (never share the Hermes/Codex-CLI credential; the "dies together on account
  revocation" caveat above stands) and single-flights the refresh; all peers refresh proactively
  (60–300 s skew), never on-401. Standing risks (R49 §4/§6): a Cloudflare originator allow-list
  (working = fingerprinting as the vendor CLI) and no on-record ToS permit/prohibition.
- **Next step: the DESIGN SESSION → D-entry before build** (credential shape = one additive
  `oauth:` object on `ProviderCfg` per the shape-to-extend directive; R49 §5 = the recommended
  shape incl. refresh placement + a narrow token write-back that avoids a full `reconfigure()`).

## B. Memory (configurable, pluggable)

### B1. Selectable memory backends — ✏️ RESHAPED to the TIER MODEL (D57, 2026-08-17)

- **The ruling (owner, 2026-08-16/17; spec = [`CORE_MEMORY_PLAN.md`](./CORE_MEMORY_PLAN.md), locked
  D57):** ctrl-b memory = **tier 1** (the built-in per-agent file stores, always on, short-horizon —
  exactly today's D14/D15/D27 lane, untouched) + **tier 2** (ONE selectable *long-term* backend at a
  time, `memory.longterm.backend`). **Core Memory** — a shared Claude-Code-native corpus (bounded
  `MEMORY.md` index + topic files, index-in-head + `core_memory` tool recall, NO LLM selector) — is
  the first tier-2 backend, built as **Phase 20**. This section's earlier "None / File / Vector /
  Both" sketch is **superseded**: "file" is tier 1 + Core Memory; "vector" survives as a *future
  tier-2 backend value* of the same slot (with Hindsight/Honcho etc.), never a parallel mode; the
  slot interface is derived from what the loop consumes (head block + tool surface) and gets
  formalized only when backend #2 is real.
  - *(The "Claude-Code-style progressive memory index" bullet that lived here was lifted INTO
    `CORE_MEMORY_PLAN.md` — it is literally this feature.)*
- **Open (unchanged):** which embeddings backend if vector ever premises; retention/pruning UI
  beyond the owner-invoked consolidation procedure.
- **Deferred memory items inherited from the ACA (re-homed 2026-07-20)** — from
  [`AGENT_CHAT_AUDIT.md`](./AGENT_CHAT_AUDIT.md)'s closing backlog, which was that document's only home:
  - **A9 — per-session memory-snapshot freeze knob** (Hermes): read memory once per *session* instead
    of once per *turn*, trading fresher edits for a stronger prompt-cache stance. **RULED (owner,
    2026-07-20): keep per-turn reads; the freeze is REJECTED as premature** — ctrl-b has no memory
    `read` tool, so a freeze buys Hermes's "I told it to remember X" defect with no hatch, and prefix
    caches invalidate only from the change point onward anyway. **Shipped with the ruling:** memory
    moved AFTER the roster in the static head (D15 #4 AMENDED) so a memory write re-prefills only
    memory + the skills note. **Open rider: measure** turn-boundary cache hits via the already-parsed
    `cache_n`/`prompt_n` (`inference.py`); if measurement ever shows real pressure, the escalation is
    **read-through with write-invalidation** (reuse the snapshot unless THIS thread's agent wrote),
    never the blind freeze. *(The "no memory read tool" premise now holds for tier 1 only — D57
    records the tier-2 divergence.)*

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

### C2. Wake word — **feasibility RESEARCHED 2026-07-31 ([R14](./research/R14-wake-word-android-browser.md)); owner: not now, someday possibly BOTH tiers**

The 2026-07-31 research pass replaced the old single-feature sketch. Two facts reshape it:
**Porcupine is ruled out** (Picovoice revoked its free tier 2026-06-30 — verified in their FAQ;
enterprise-only now), and **the background ceiling is an Android OS rule, not a web-platform one**
(a background app needs a `microphone`-typed foreground service to capture; a web page can't create
one — only the browser binary can). That splits C2 into two features that must be sized separately:

- **C2a — foreground wake word (pure web; SHIP-VIABLE in both browsers).** Client-side detection in
  an **AudioWorklet** (never main-thread timers — Chrome throttles hidden timers to 1/min), WASM
  inference, **one** `getUserMedia` stream fanned out to the detector worklet + the existing
  `useDictation` MediaRecorder (a wake word is a new *trigger* for the existing dictation flow, not
  a parallel flow). Screen Wake Lock while armed; **disarm on `document.hidden`** (honest UX — never
  pretend to listen). Covers "phone docked showing the dashboard". Off by default + sensitivity, per
  the original sketch. Engine options (post-Porcupine): **openWakeWord via onnxruntime-web**
  (~3.7 MB models, community ports, needs a Colab-trained "hey ctrl-b" classifier; models
  CC BY-NC-SA — fine for homelab) or **sherpa-onnx official `wasm/kws` build** (~19 MB, arbitrary
  keyword `@hey_ctrl_b` with ZERO training — the no-training-pipeline property may decide it).
  Constraints: single-threaded WASM+SIMD (no COOP/COEP for the whole PWA); read
  `audioCtx.sampleRate` and resample, never assume 16 kHz (the one known Gecko divergence).
- **C2b — true always-listening (screen off) → needs the native wrapper.** Firefox Android is
  **structurally DEAD** for background capture (the Fenix manifest declares no FOREGROUND_SERVICE
  permission at all — re-verified in source); Chrome is architected for it (mic-typed FGS +
  freeze exemption) but field-unproven vs OEM battery policy. The wrapper the owner prefers is the
  proven shape (Home Assistant 2026, still "experimental"): a **Capacitor WebView shell** pointing
  at the existing tailnet HTTPS URL + a **mic-typed foreground service** running a native engine
  (**microWakeWord**, 52–60 KB — HA's pick) that foregrounds the WebView / signals `?wake=1` on
  detection. **≈1 week** + ~1 day/yr Android SDK tax; the wrapper stays dumb — all UI keeps
  shipping via `update.sh`. Gotchas already known: Android 14+ forbids mic-FGS start from
  `BOOT_COMPLETED` (re-arm by opening the app once after reboot, or a notification action);
  `microphone` FGS has **no** Android 15 timeout. Battery mitigation = HA's: gate listening on a
  condition — we already own the R12 presence signal + D2-A monitor to arm/disarm it.
- **Pre-build device round (cheap, gates both tiers):** which Firefox build the owner runs · does
  Firefox's mic grant survive an app restart (evidence conflicts — R14 §4) · optionally the
  5-minute Chrome screen-lock capture test (decides how much C2b must rely on the wrapper).
- **Open:** engine pick (train-a-classifier vs 19 MB no-training); C2a arming UX (manual toggle vs
  presence-gated); whether C2b is ever wanted given C2a + the docked scenario.

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
- **Research ✅ BOUGHT 2026-08-20 = [R48](./research/R48-chunked-tts-synthesis.md)** (owner go
  2026-08-20; 4 in-class peers source-read + Speaches/Kokoro source + MEASURED format probes on
  emma). **Four corrections to the sketch above** (the entry stands otherwise; the design session
  rules on these): ① `lib/markdown.tsx` has NO reusable element list — `blocks()` emits ReactNodes
  directly, so the chunker is its own pure helper (extend `toSpeech`), not a renderer reuse ·
  ② the one peer shipping the three-way mode defaults to **sentence**, not paragraph (merge floor
  <4 words/<50 chars is where quality lives, per Kokoro's own prosody note) · ③ MSE is NOT "the
  deeper per-chunk optimization" — it's the OTHER strategy's transport and Gecko-hostile as shipped
  (audio/mpeg-only; Firefox gets zero benefit in LibreChat's build) · ④ chunking and streaming-TTS
  are latency ALTERNATIVES, not complements — either alone kills the 24 s. **Field mechanism: 4/4
  peers play via HTMLAudioElement src-swap-on-`ended` (zero Web Audio), synth-ahead depth 1 with a
  waiting latch (AnythingLLM's shape). ⚠ Format: the shipped `mp3` default breaks under chunking —
  Speaches' pipe-muxed mp3 carries ~46 ms dead air per chunk (measured); `opus`/`wav` are
  sample-exact.** Riders the build must carry (R48 §7): `max_text_chars` semantics under chunking ·
  per-chunk failover × the D62 `X-Voice-Served-By` chip · the blob cache going N-per-message
  (SYS-17c gets worse). ~~Pre-build gate: the 20-min device probe of the real src-swap gap on
  Fennec + Chrome Android (only that result could justify Web Audio).~~
- **→ DESIGN LOCKED as [D63] 2026-08-21** (owner rulings + the
  [R50](./research/R50-c3-playback-probes.md) probe pass; council efficiency round SHIP AS
  DESIGNED after 2 HIGH + 6 MED folded — the full spec lives in the D-entry). Headlines:
  element src-swap queue, depth-1 latch (desktop seam MEASURED 4–6 ms — Web Audio/MSE dead;
  the Android seam check moves to the first device round) · `chunking: sentence` shipped ON ·
  `chunk_format: opus` with request>model>service precedence · failover PIN via
  `X-Voice-Target` echo → `prefer` · single-message blob retention · `toSpeech` goes
  newline-preserving + table/emoji strips · read-along = slice 2 behind a triple-gated resplit
  + one turn-end ownership entry point. **Single-stream progressive mode = recorded NON-BUILD**
  (R50 P2/P4: slower TTFA than chunking and Chromium never becomes seekable) — the queue's
  ordered source list is the seam if ever revisited. Build pends the owner S1 go.
- **S1 ✅ BUILT 2026-08-21** — chunker (`lib/ttsChunks`) + the element queue + the `TtsServiceCfg`
  `chunk_*` block + client-policy delivery on `GET /voice/status` + the `X-Voice-Target`/`prefer`
  failover pin, serving the per-bubble ▶ and the existing turn-end auto-TTS (`useAutoTts` still calls
  `toggle`, which under chunking simply starts the queue). **S2 — read-along-while-streaming and the
  single turn-end ownership entry point — is still open.**

---

### C4. Live voice mode (continuous conversation) — **noted 2026-08-21 (owner); FUTURE, not scheduled**

- **What:** always-listening mic → VAD/endpointing → streaming or per-utterance STT → the existing
  agent turn → C3 chunked TTS, with barge-in (speaking over the bot kills playback + cancels the
  turn). The owner pointed at their RealtimeVoiceChat fork as the reference shape.
- **Research ✅ BOUGHT 2026-08-21 = [R51](./research/R51-realtime-voice-chat.md)** (the fork +
  upstream source-read; pipecat/LiveKit cross-checks; browser-half verified; Speaches live-probed).
  The load-bearing findings: Speaches **already ships `/v1/realtime`** (Silero VAD,
  `intent=transcription`) · silence-only endpointing is dead field-wide (Smart Turn v3 = 8.7 MB CPU
  ONNX) · **Chromium's AEC does not reference same-page `<audio>`** — the echo probe is the #1
  pre-design gate · LiveKit persists the interrupted turn truncated to what was PLAYED (pairs with
  R35 divergence ④ — design once for text + voice).
- **Ranked architecture (R51 §9.3):** ① Speaches-realtime as the ear + ctrl-b agent loop as the
  brain + **C3 as the mouth** (zero new models/hosts; the agent loop untouched) · ② own the ear
  (client Silero + server Smart Turn, backend-portable) · ③ porting RVC wholesale = ruled out.
  **C3 (D63) is the hard prerequisite and needs NO changes for this** — its cancel path is the
  kill verb barge-in needs (R51 §9.1).
- **Tier 0 quick win, buildable anytime:** auto-stop dictation (~1 day — energy detector +
  config silence timeout on the field's 3.0–3.2 s number + the existing `stt_auto_send`).
- **Scope when built:** screen-on / app-foreground / Wake Lock ("docked on a stand") — screen-off
  always-listening needs a Capacitor shell (R14 §5) and Firefox cannot do it at all. Needs a
  D-entry + the AEC device probe before any build.

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

> **✅ B (PWA-connect MVP) SHIPPED 2026-07-29** (QoL cluster Slice 3, `0bfaf34`): per-host
> `wake_on_connect` flag (unified host object, MachineEditor switch) + `wake: {cooldown_s: 300}` ·
> the SSE stream connect fires `wake_host` through `ActionService.invoke(actor=SYSTEM)` — audited,
> detached, guarded, per-host cooldown, cached-online skip. First connect after a backend restart
> wakes all flagged hosts (owner-ruled: intended). **A** (the Tailscale-status poll) ✅ **SHIPPED as
> D2-A / Phase 15 (D50), live in v1.4.6 2026-07-31** — same `wake:` section + action path.

- **What:** (from the old README TODO) auto-wake chosen hosts when the phone/owner joins the
  LAN/tailnet — walk in the door, the boxes are already coming up.
- **Mechanism (✅ decided 2026-06-16 — A primary, B as MVP; both reuse `wake_host`, no public surface):**
  - **A (the real feature) — tailnet-presence trigger. ✏️ design LOCKED 2026-07-31 as [`D50`](./DECISIONS.md)
    (owner-signed; research = R12+R13 in `docs/research/`) — build ✅ SHIPPED Phase 15, live v1.4.6
    2026-07-31.** The backend's
    first self-owned monitor loop (A3 `runner.loop()` shape) polls the **LocalAPI `whois`** over the
    tailscaled unix socket (httpx-over-UDS; 0.16 ms/1.2 KB — the CLI subprocess and the unstable
    `watch-ipn-bus` are both rejected in D50) for the owner device's **confirmed OFFLINE→ONLINE
    edge** — the owner keeps Tailscale OFF until they want the servers, so the connect itself is the
    intent signal (home or away; R12's home-endpoint predicate deliberately dropped). Strictly
    edge-triggered (a deliberately shut-down PC stays down), UNKNOWN never edges (restarts fire
    nothing), one fire per `presence_cooldown_s` (3600 default). Per-host participation +
    cooldown override = additive `ComputerCfg` fields (`wake_on_presence`,
    `wake_presence_cooldown_s`). The same loop is the **fleet up/down monitor** (3-down/2-up
    damping, silent boot baseline, record≠notify predicates) that unlocks the F1 host-up/down
    notify toggle.
  - **B (near-free MVP, can ship first) — PWA-connect trigger.** When the owner's client opens its SSE
    stream (existing connect path), an endpoint wakes the configured hosts. Trivial, no new deps; weaker
    semantics ("wake when I *open the dashboard*," not "when I get home"). Not mutually exclusive with A.
  - **Rejected — C, LAN ARP/ping presence:** Android suppresses ping (battery), phone IPs churn,
    LAN-only. Strictly worse than A.
- **Timing:** ~~post-v1; the **A** build pairs with the A3 scheduler / monitor subsystem~~ → **BOTH
  SHIPPED: B 2026-07-29, A (D50/Phase 15) live in v1.4.6 2026-07-31** (per-host switches OFF pending
  the owner's daily-use round). Detection (A) reuses the tailnet locally, never a public surface.

### D3. Multi-homed host addressing (LAN + VPN) — **designed 2026-06-30 (external_audit: Corsair shutdown)**

A host is **multi-homed** — reachable at a LAN address *and* a VPN/overlay address — and the right one depends on the
**consumer's vantage**: the backend (always on LAN + VPN) picks/fails-over server-side; the **browser's** vantage
varies (LAN / VPN app / TS Serve), so a service link's correct host depends on *how the SPA was reached* — no static
config value can be right. Web-researched: [MagicDNS — prefer names over IPs](https://tailscale.com/docs/features/magicdns),
[vantage via `window.location`](https://medium.com/@neocities_1123/making-my-homelab-services-available-to-me-anywhere-in-the-world-with-nginx-proxy-manager-13f04b7835d7),
[`tailscale status --json` peer map](https://tailscale.com/docs/reference/tailscale-cli). (Homepage/Homarr make the
user configure URLs manually + split `href`/`siteMonitor`; this design auto-resolves instead.)

- **Why (verified):** Corsair's LAN SSH (`192.168.1.128:22`) **times out** while Tailscale MagicDNS (`corsair:22`)
  works — Windows Firewall almost certainly allows sshd on the Tailscale interface but blocks the LAN profile (same on
  G5; Vault was just off). Over MagicDNS the **existing** shutdown path succeeds end-to-end (238 ms vs a 10 s timeout)
  — **not a code bug**; `ip` is just overloaded (LAN/service/display **and** SSH/ping target — 5 uses, one field:
  `_common.py:107` SSH, `svc.py:119` URLs, `svc.py:74` probe, `fleet.py:46` ping, `CosmosHostDetail.tsx:127` display).
  Also: service links are built from `ip`, so when browsing over MagicDNS / TS Serve they point at an unreachable LAN
  IP. Blocks controlling the Windows hosts from emma post-migration.
- **Data model (additive on the unified `Host`/`ComputerCfg`; generic naming — owner directive "shape data to extend,
  not migrate" + "don't hardcode the VPN name"):**
  - `ip` (existing) = **LAN address** (display line 1, service URLs, port probe, ping — unchanged).
  - `vpn_host: str | None` (new) = **VPN/overlay address**: a name (MagicDNS — *preferred*) or IP. **Generic** —
    Tailscale is today's VPN but neither the field nor the resolver names it. (Display line 2.)
  - `ssh_prefer_vpn: bool = False` (new) = the per-host **SSH toggle**. `False` ⇒ the general **LAN > VPN** order;
    `True` ⇒ VPN-first for SSH (Corsair). No third `ssh_host` field — the toggle + failover cover it.
- **Resolution — ONE chokepoint helper, no per-call-site duplication:** `host_addresses(host, prefer_vpn) ->
  list[str]` returns ordered non-empty candidates — general default `[ip, vpn_host]`, flipped to `[vpn_host, ip]` when
  `prefer_vpn`. **Single source of truth for the LAN>VPN preference** (never hardcoded at call sites).
  - **SSH** → `host_addresses(host, host.ssh_prefer_vpn)`, tried in order with a short **connect timeout**, failing
    over to the next candidate on a **connection** error only (timeout/refused) — **never** on auth (connected +
    wrong-password is a real error, not a retry). Reuses `adapters/ssh.py`.
    - **Measured (2026-06-30, corsair→emma, same LAN):** LAN IP avg **0 ms**; MagicDNS name + Tailscale IP both
      avg **1 ms** (`tailscale ping` → `direct 192.168.1.160:41641 in 1 ms`, NOT relayed). The VPN path adds ~1 ms
      (WireGuard + interface hop) when peers are direct on the LAN; **name vs IP is identical** steady-state (the
      name is just a one-time DNS lookup). ⇒ **no meaningful latency cost** to a VPN-first SSH target or to the
      stopgap of typing the MagicDNS name as `ip`. (Remote/DERP-relayed would add real latency — but that's the only
      path that works remotely anyway.)
  - **Service links (frontend)** → **vantage-aware**: if the SPA's `window.location.hostname` is a VPN origin
    (`*.ts.net` or `100.64.0.0/10`) use the target host's `vpn_host` (the **name**), else `ip`, other as fallback.
    Requires exposing both `ip` + `vpn_host` in the host DTO. (An `http://host:port` link opened as a top-level
    navigation from the HTTPS Serve origin is fine — mixed-content blocking only hits subresources.)
  - **Ping / port-probe** → stay on `ip` (LAN). Corsair's LAN ping works, so status stays accurate. (A
    LAN-unreachable host could later fall back to probing `vpn_host` — minor future refinement.)
  - **Display** → both `ip` + `vpn_host` in the sheet / PC info / Kit DeviceRow.
- **⚠️ Hardcoding note (owner asked; verified 2026-06-30):** the **only** `tailscale` coupling in the codebase is the
  **Serve / HTTPS-access integration** (`TailscaleCfg`, `actions/tailscale.py`, `api/access.py`, the Conf Access panel,
  `useAccess`/`useDictation` — 81 refs) — *legitimately* product-specific (it drives the real `tailscale serve`
  binary). The **host-addressing / SSH / link path has ZERO VPN coupling today** (all `ip`), so the new field +
  resolver are introduced **generic** (`vpn_host`, no "tailscale" string in logic). Keep the Serve integration as-is;
  the UI may *label* `vpn_host` "VPN (Tailscale)" while config/logic stay neutral.
- **Slices (1 unblocks Corsair on its own):**
  1. **Backend** ✅ **SHIPPED 2026-07-20 (D47)** — `vpn_host` + `ssh_prefer_vpn` on `ComputerCfg`/`Host`/`hosts()` +
     the hosts CRUD (`HostIn`/`_host_entry`/`_apply_fields`/`_host_dto`); the `host_addresses()` chokepoint helper
     (`domain/host.py`); a typed `SshResult.kind` (`ok`/`auth`/`connect`/`ssh`); and ONE shared `run_ssh_failover`
     loop (`_common.py`, short `SSH_CONNECT_TIMEOUT_S` per candidate) the three SSH call sites (shutdown/reboot/
     `_common` service control) route through — advance on `connect` only, never `auth`. Tests: `test_multihome_d47`
     (order/flip/collapse + failover-on-connect + no-failover-on-auth + `SshResult.kind` + shutdown-still-confirms)
     and `test_hosts_7b::test_vpn_host_fields_roundtrip`.
  2. **Frontend** ✅ **SHIPPED 2026-07-21 (D3 slice 2)** — the host DTO already exposes `ip`+`vpn_host` (Slice 1);
     new `lib/serviceBase.ts` (`serviceBase(host, location)` name-preferred + vantage-aware `isVpnOrigin` for
     `*.ts.net` / `100.64.0.0/10`, + `rebaseServiceUrl`) drives DeviceRow's outbound links (host-open + svc-row
     hrefs); VPN display lines added to `DeviceRow` (kv `vpn` row), `CosmosHostDetail` (hd-ids), `FrontierHostDetail`
     (meta); the Conf host editor (`MachineEditor`) gains the `VPN host` field + `SSH via VPN first` Switch (Draft →
     PUT, always-sent) + a ` · vpn` row-summary tag; `Host` type gains `vpn_host?`/`ssh_prefer_vpn?`. Tests:
     `serviceBase.test` (vantage matrix + CGNAT /10 boundaries + rebase) · `machineEditor.test` (fields + round-trip
     + omit-preserves-regression) · `deviceRowVpn.test`. Frontier/Cosmos svc-row hrefs were retargeted through
     `rebaseServiceUrl`/`serviceBase` in the same-day follow-up (the VPN-vantage phone case is exactly the spatial
     themes' daily use), so ALL service links are vantage-aware.
  3. **VPN discovery** ✅ **SHIPPED 2026-07-22 (D3 slice 3 — D3 IS NOW COMPLETE)** — backend
     `resolve_vpn_candidates()` beside `resolve_status` in `services/actions/tailscale.py` (same
     `_bin`/`run_capture`/error ladder; skips `Location` [Mullvad/geo] + foreign-suffix peers — NOT
     `ExitNodeOption`, an own-fleet host may advertise it; MagicDNS short label preferred, `TailscaleIPs[0]`
     fallback; lenient parse, never logs the raw blob) → provider-NEUTRAL candidates `{name, address,
     hostname, online}`; `GET /api/hosts/vpn-discovery` (read-only, 403 when disabled, error-envelope
     passthrough) joins by casefolded host name — DNS label primary, HostName fallback only when unique
     (HostName is documented non-unique; the corsair/corsair-1 dedup case) → `{results:[{id, name, current,
     proposed, online}], unmatched}`. Conf → Computers "Discover from Tailscale" button (`useDiscoverVpn`,
     on-demand only): fills ONLY empty `vpn_host` via the existing per-host PUT with the **FULL host body**
     (`hostToPayload` from a FRESH `/api/hosts` fetch — the PUT is NOT a PATCH: `_apply_fields`
     omit-preserves only the two D47 fields, a partial body would wipe mac/os_type/services [audit HIGH-1]);
     differing values NEVER overwritten (case-insensitive compare); open editor row skipped (draft seeds at
     mount); per-host inline result lines + one summary toast; a failed individual PUT downgrades to a
     per-host `failed` line, never poisons the batch. Provider seam: all Tailscale-shaped knowledge dies in
     the tailscale module; a future VPN = one new source fn returning the same candidate shape + a UI label.
     Accepted residual: concurrent edits in the sub-second fetch→PUT window are last-writer-wins (single-user,
     same as the manual editor). Tests: `test_tailscale_d3s3` (parse/filter ladder) ·
     `test_hosts_vpn_discovery_d3s3` (join/contract + the full-body preserve pin) ·
     `machineEditorDiscoverVpn.test` (6 FE cases incl. the full-body assertion). Commits
     `cced768`+`ebca9eb`+`542005b` (2 Opus waves + the orchestrator review-fix wave; fresh-eyes audit +
     quick Codex both converged on HIGH-1).
- **Stopgap now typeable (2026-07-20, `fb59c83`).** The interim workaround — put the MagicDNS *name* in `ip` — was
  reachable only by paste on Android: the Conf host editor's IP field carried `inputMode="decimal"`, which opens the
  number pad. `ComputerCfg.ip` is a plain `str` and a DNS name has always been valid there, so the numeric hint was
  simply wrong; it's dropped, and the label/placeholder now say a hostname is accepted. **This changes nothing about
  the design above** — one overloaded field is still one overloaded field, and D3 remains the proper LAN-vs-VPN split.
- **Resolved:** slice 1 did ship as its own backend slice (2026-07-20), and D3 completed 2026-07-22.
  Original framing, kept for the diagnosis it points at: Full diagnosis:
  [`external_audit/CTRL-B Corsair Shutdown Audit 2026-06-29.md`](./external_audit/CTRL-B%20Corsair%20Shutdown%20Audit%202026-06-29.md) · routing in [`external_audit/TRIAGE-3.md`](./external_audit/TRIAGE-3.md).

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

### F2. Live-connection indicator when the app bar is hidden — **⏸ DEMOTED 2026-08-20 (owner): not a standalone slice; a candidate THEME ELEMENT only**

- **What:** the SSE "live feed dropped / reconnecting / offline" badge currently lives ONLY in the app bar
  (`components/AppBar.tsx`, `theme-engine/kit/AppBar.tsx`, driven by `store/connection` via `useEvents`).
  The global **Hide app bar** lever removes the bar — and with it, the only connectivity indicator.
- **Owner ruling (2026-08-20):** don't build it as chrome. Reasoning: backend-down mostly presents as
  app-down anyway, so a dedicated indicator reads redundant. *(The technical nuance, recorded: the PWA
  shell serves from SW cache, so the UI can render fine while the backend is unreachable — the badge is
  not strictly redundant; the owner still judges it not worth standalone chrome.)* If it ever exists, it
  arrives as a **designed element of a theme's fleet tab** — a plainer theme (frontier-class), NOT gacha,
  which needs no more fleet clutter. Reuse `store/connection` (no new state) whenever a theme adopts it.

### F1. Push to phone on fleet events

> **✅ CHANNEL 1 (foreground) SHIPPED 2026-07-29** (QoL cluster Slice 3, `0bfaf34` + the review wave
> `7168521`): `notifications: {enabled=False, events:{agent_input, turn_done, action_failed}}` (master
> OFF = the owner's spam guard) · one engine in `<AppEngines/>` gated on hidden-page + permission,
> fed by BOTH streams **on every transport** (live, buffered, `turn.sync`, re-attach — thread-namespaced
> dedupe keys) · Conf group 11 with honest denied/no-HTTPS states · Android delivers via the existing
> SW registration (`Notification` constructor throws there; SW-path taps inform but don't navigate —
> the click handler belongs to channel 2's custom worker). **Recorded residuals:** cross-device prefs
> staleness on a hidden page (PUT-echo seeding fixed same-device; polling/SSE-invalidation declined) ·
> id-less-transport turns share a thread-scoped dedupe key (bounded, tested) · ~~host up/down events need
> the D2-A/A3 monitor loop before that toggle can exist~~ → **UNBLOCKED 2026-07-31 (D50 / TODO Phase 15):**
> the monitor emits `host_up`/`host_down` Events (SYSTEM actor, system origin, **status OK both
> directions** — a host going down is an observation, not a failed action). The residual is now purely
> frontend: F1's pure Event classifier gains a `host_up_down` class + its Conf toggle, and it must key
> on the ACTION name, never on `status` (D50 M5 / overrule ② — the backend deliberately owns no notify
> policy). **→ GREENLIT 2026-08-20 (owner): build the `host_up_down` toggle slice. Tap ruling: a
> host up/down notification's tap opens the FLEET tab (no per-host focus)** — one more `focus`
> value (`"fleet"`) through the shipped R45 router (`data:{focus}` → `applyNotificationFocus` →
> `?tab=fleet` fallback); no new research needed, R45 + D50 M5 already bought the whole design.
> Channels 2/3 (Web Push · ntfy/bot) stay future.
> **Device round 2026-07-30 (owner, Fennec/Android): NOT delivering.** A reboot-confirm (the flagship
> `agent_input` case) produced no notification — including a retest that backgrounded the app only
> seconds before the confirm, which rules out the long-background freeze theory. Cause unconfirmed
> (Conf permission state not yet verified on-device); prime suspects: the Fennec SW-registration
> `showNotification` path, or Android page throttling. **Owner ruling: note-and-observe** — they'll
> watch whether it fires in some cases during daily use; revisit with the Web Push channel (2), whose
> custom worker replaces this path anyway.
> **→ SUPERSEDED 2026-08-19 (owner retest): notifications DELIVER** — SYS-19 (no worker had ever
> registered) was the whole mystery; the two Fennec checks are moot.
>
> **CHANNEL 1 CLOSE-OUT — the TAP now routes (built 2026-08-19, `R45`).** The one documented
> trade-off left in the slice ("a SW-shown notification's activation goes to the worker, and the
> generated Workbox worker has none — the tap informs but doesn't navigate", which on Android landed
> the owner on the home screen) is closed. `frontend/public/notify-sw.js` holds a `notificationclick`
> listener pulled into the GENERATED worker by `workbox.importScripts` — **no `injectManifest`
> migration**, so the `registerType:"prompt"` update path is byte-identical (R45 §6.4 priced both;
> the "a custom worker is required anyway" premise was FALSE). Shape: `data:{focus,key}` onto the
> notification → tap → `postMessage` FIRST, then a best-effort `client.focus()` → the page's ONE
> `applyNotificationFocus` router, the same one the desktop constructor path calls; no live client
> falls back to `openWindow("/?tab=agent")`, read and stripped at boot by `store/ui#consumeTabParam`
> (a bare `/` would restore the PERSISTED last-used tab). The import URL carries a build-time content
> hash — `updateViaCache` defaults to `"imports"` and dist files ship no `Cache-Control`, so a
> heuristically-fresh cached copy could otherwise be frozen into a new worker for its whole life
> (R45 §2). ~~Owed: the manual device round~~ **✅ DEVICE ROUND PASSED 2026-08-20 (owner, on prod
> v1.7.4): tapping a notification lands on the agent tab.** (Playwright cannot click an OS
> notification — microsoft/playwright#23954 — so unit coverage + this on-device confirm is the
> full acceptance. The Fennec caveat stays recorded for reference: Bugzilla **1880000** is `NEW`,
> `client.focus()` may not foreground an installed PWA there — the routing deliberately does not
> ride on `focus()` succeeding.) **Channel 1 is fully closed — delivery AND tap routing.**
>
> **HOST UP/DOWN CLASS ✅ BUILT 2026-08-21** (council-closed, Hermes emma lane; 1 MED folded — all
> three frontend read boundaries (prefs query · Conf draft pick · PUT-echo cache seed) field-merge
> the events dict against the class defaults, so a payload that
> predates a class reads as ON, not silently OFF): `host_up_down` — ONE class for both directions,
> matched on the Event ACTION name (never `status`), default ON, a Conf group-11 row, tap → the
> FLEET tab through the R45 router (`focus:"fleet"` → `/?tab=fleet`). Backend = one additive
> `NotificationEventsCfg` field, no migration. **F1 channel 1 now has no open items.**
>
> **CHANNEL 2 (Web Push) — RESEARCHED, then PARKED 2026-07-31 (owner).** The design research is
> bought and banked: **R10** (stack/standards) + **R11** (peer field pass) in `docs/research/`.
> The owner's two stated concerns both dissolved on evidence (no real contact address needed — the
> VAPID `sub` is unverified, a `mailto:…@localhost` literal is fine; and a **+0-dependency** path
> exists — ~65 lines of RFC 8291 on the already-installed `cryptography`+`PyJWT`, R10 §1.3).
> **Parked because of what R10 found instead:** Web Push terminates in the SAME `showNotification()`
> call that failed the channel-1 device round, so it does not route around that mystery — and the two
> 30-second on-device checks that decide viability are still unanswered: (1) Android → Apps →
> Firefox → Notifications → **"Site notifications" channel importance** (a Mozilla engineer's own
> diagnosis of our exact symptom; plus open Bugzilla **1807379**), (2) **which Firefox build** the
> owner runs — official (rides FCM like Chrome → clean win) vs F-Droid/relan Fennec (rides
> **UnifiedPush** → needs a distributor app, typically ntfy, + an open swiped-away bug → channel 3
> is likely the better spend there). **Resume =** do those two checks, then read R10 §9 + R11 §7;
> the sketched rulings (main-seat, not yet council-reviewed): vendored 65-line encryptor or
> `webpush==1.0.6` · `injectManifest` custom `sw.ts` (typed, in the gate) over LibreChat's
> `importScripts` trick · dedupe = same `tag` (`NotifySignal.key`) both channels + SW skips only on
> a *focused* client (the one suppression web.dev sanctions) · endpoint-PK SQLite table (ntfy's
> schema) · prune on 404/410 · ntfy's push-service host allowlist on subscribe (SSRF) · VAPID PEM
> once into `$CTRLB_HOME` fd-0600, never regenerated implicitly · a **test-push button in slice 1**.

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

## H. Themes (post-T5 additions)

### H1. "gacha" — an anime-styled theme in the frontier mold (**owner, 2026-07-21 — design wanted**)

- **What:** a fifth theme, structurally like **frontier** (kit-based, tokens + axis declarations +
  an optional bespoke body layer) but with an **anime / gacha-game visual identity** — the owner's
  naming: "gacha".
- **Ruling note:** this AMENDS the 2026-07-15 "theme population is CLOSED" ruling (which closed the
  population *at the time* — the four themes formalizing onto the kit). The kit is exactly why a
  fifth is now cheap: a new theme = a tokens file + axis declarations (`outlines`, `composerSkin`,
  appbar/layout prefs) + per-theme art, with a bespoke body ONLY where the design demands it
  (frontier's Agent tab is the precedent and the budget ceiling).
- **How to design it (when scheduled):** follow the frontier playbook — `FRONTIER_PLAN.md` is the
  template (design lock → F-slices → gates incl. the on-device Gecko round); THEME_ENGINE §14.11
  (smoothness allowlist), §14.15.1 (hardening invariants incl. the contrast gate — gradient/`<image>`
  tokens need the §14.15.1-⑨ probe), §15 (the chat hooks contract: reskin the ONE shared chat tree,
  never fork), D37 (axes own composer chrome — a gacha look = new *skins/tokens*, not new layouts).
  Reference art should come from real gacha-game UI references the owner points at (per the
  use-real-reference-images rule) — collect those at design time.
- **Prototype BANKED (owner, 2026-08-02 — the look is settled):** the owner iterated the design
  standalone and committed the result at `design/prototypes/gacha/`. **The FINAL prototype is
  `design/prototypes/gacha/uploads/prot/capsule-arcade/index.html`** — everything else in the
  folder (magical-guild, `ctrl-b-gacha-prototypes/`, loose reference art in `uploads/`) is a prior
  iteration kept for provenance. The design session starts FROM the final prototype + the real
  reference images beside it (per the use-real-reference-images rule). Reference-only like all of
  `design/prototypes/` — don't import from it.
- **Plan DRAFTED (2026-08-02): [`GACHA_PLAN.md`](./GACHA_PLAN.md)** — full prototype inventory +
  the owner's requirements round (R1–R10) pinned + the kit translation map (seam-verified + two
  Codex rounds). **This is now Phase 17 in TODO.md**; the lock session takes the plan's §8 owner
  questions → council → D52.
- **Open (for the design session):** how the capsule-arcade look maps onto the kit (tokens + axes
  vs any bespoke body layer, per the budget ceiling above); whether hosts get the character-card
  treatment (the cosmos planet precedent says a bespoke Fleet body is viable); art
  sourcing/licensing for any baked-in imagery. **v1.5.0 is RESERVED for this theme (owner ruling
  re-confirmed 2026-08-02).**
- **Follow-on: the ENSEMBLE fleet layout — ✅ SHIPPED (alt-fleet E0–E5, released in v1.6.0
  2026-08-11).** The capsule grid becomes ONE poster of interlocking sheared bands (ZZZ-roster /
  True-Damage grammar), switched by the `fleetLayout` theme-settings axis (`capsule` default).
  Evidence = [R18](./research/R18-ensemble-collage-fleet.md) + R22–R26; the build record + per-slice
  as-builts = **GACHA_PLAN §12** (Phase 17 DONE end to end).

### H2. Visual art manager — upload + crop/focal-point editing (**owner, 2026-08-08 — future, unscheduled**)

- **What (owner's words, condensed):** an in-app, visual way to edit every selectable image — the
  per-PC portraits, the banner/scene art, "every single image that you can select." Upload a file
  and **cut/frame it beforehand, so you know exactly how it will look** on the surfaces that
  consume it (capsule card, poster slice, promo slide, dossier mark, wallpaper…), like any image
  software with a crop tool.
- **The v1 seams already in place (build against these, don't reinvent):** ① the gacha roster's
  per-entry `focus` (an `object-position` string, `roster.ts`) — ONE value re-aims every consuming
  surface via the single-resolver contract, proven by hand-tuned bundled entries (`4` 2026-08-05,
  `pegasus`/`3` 2026-08-08); a crop editor's output is exactly this field, so the editor is UI over
  an existing data path. ② G5's role-scoped media folders + the Conf gallery = the upload/manage
  surface to extend. ③ The known GAP the feature closes: owner runtime drops deliberately carry
  **no** `focus` today (the role rule, `roster.ts` `toEntry`) — bundled art can be framed, owner
  art cannot; the editor is what makes per-owner-file focus data worth storing (likely a sidecar in
  the media index, a design question for then).
- **Scope note:** this is the *bigger feature* behind the 2026-08-08 quick fix (framing pegasus/3
  at face height). Interim policy stands: bundled-entry focus values are hand-tuned in `roster.ts`;
  owner drops rely on each surface's tuned default crop.

### H3. Installed-app icon backdrop — **✅ SHIPPED 2026-08-18 (D59; research = [R28](./research/R28-pwa-installed-icon-backdrop.md))**

- **What shipped:** Conf → Appearance → *App icon backdrop* — five baked-in backdrops for the
  installed home-screen icon (Clear · Ink · Night · Orchid · Paper), synced like the rest of the
  appearance doc. The backend serves `/manifest.webmanifest` and rewrites the maskable icon's `src`
  from `appearance.pwa_icon_background`; the PNGs are build artifacts from `gen-pwa-icons.mjs`.
  Answers the owner's "why is my app icon a white box" (R28 §0: the WebAPK shell composites white
  under a transparent maskable icon).
- **The non-obvious constraint, recorded for anything else that touches the manifest:** Chrome 144+
  treats an icon URL as immutable, so repainting a file in place reaches no installed app — only a
  CHANGED URL does (and it surfaces as a "Review app update" suggestion under the app's ⋮ menu).
  That is why the manifest is served dynamically rather than rebuilt. See R28 §12.

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
- **Appearance** — theme, skyline, hero, waveform (from Vapor). **Now the Theme Engine (DECISIONS D28–D31 +
  D34, design in `THEME_ENGINE.md` §14 — BUILT):** a pluggable presentation layer — a `ThemeRegistry` of
  `ThemeDef`s, each theme owning its whole **`Root`** over the shared headless controllers + the optional
  token-driven **Kit**, switching between distinct, pixel-faithful design systems (vapor [default] · minimal ·
  cosmos SHIPPED; phosphor · frontier · observatory to port) each with its own `@scope([data-skin])`-isolated
  lazy CSS bundle, fonts, palette axes (`{theme,mode,accent}`, cross-device LWW-synced via the `config.yaml`
  `appearance` block), per-theme `settings`, and `present(host)` per-host visual encoding (+ the per-host
  `host.appearance:{<themeId>:blob}` override field, additive). Adding a reskin theme = one registry row + one
  self-contained module + a scoped `tokens.css` (recipe: `THEME_ENGINE` §14.4.1/§10). **Next when un-parked:**
  the **Hardening slice v2 → Composer Surface** (`THEME_ENGINE` §14.15.1, D34).
- **Vapor assimilation (owner directive 2026-07-06 — D34, `THEME_ENGINE` §14.15.3).** vapor's "frozen" status
  is a phase, not an identity: port it from frozen-bespoke to a fully engine-native, contract-conformant theme
  via the per-component graduation ladder (V1 file/keyframe hygiene → V2 `data-theme`→`data-accent` axis →
  V3 semantic-token mapping → V4 per-surface Kit/Surface participation, low-divergence first, chat last via
  the D31 3-gate → V5 chrome dedup). Unscheduled — after the theme catalog stabilizes. Standing guarantees
  already in force: nothing new depends on vapor's legacy hooks; test/lint exemptions are shrinkable waiver
  lists; engine code uses `DEFAULT_THEME`, never `"vapor"` literals.
  **AMENDED at the F5 close (owner, 2026-07-15): the theme population is CLOSED** — no new themes; the
  existing four (vapor · minimal · cosmos · frontier) all formalize onto the kit, and future theme work =
  variations within them. Two consequences already acted on: rule-of-three waits are moot for cross-theme
  duplication (the K1 composer hide/slide promotion, owner directive), and **gradient accents** are a wanted
  capability — the two-channel seam (`--accent` flat / `--accent-fill` may be a gradient `<image>`, §14.15.1 ⑨)
  is already wired at every kit fill site; K2 exercises it for frontier, and vapor's gradients take the same
  route at its V3 token-mapping rung.
- **Composer icon setting (owner, parked 2026-07-15 at the F5 slice-B review)** — a user-facing setting for
  the composer's control glyphs (e.g. the send icon), on top of the D37 `composerSkin` axis. The seam already
  exists: KitComposer picks its default send glyph by resolved skin (glass → the shared arrowhead) and the
  `sendIcon` prop seam remains — an icon setting would generalize that pick into a per-theme/user choice.
  Unscheduled; revisit after the frontier F5 gates.
- **~~Cosmos host-sheet planet switcher~~ ✅ SHIPPED 2026-07-15 (`d26a498`)** — chevrons flanking the sheet's
  host name step prev/next through the orbit's host order (wrap-around) via the same `cosmosSelection` swap
  path; pure `stepId()` helper (+tests); hidden on a single-planet fleet. Build-caught fix worth keeping: the
  BottomSheet handle's invisible 16px drag hit-strip (z 1) swallowed the chevron taps — interactive content
  near a sheet handle needs `z-index` above the strip (a precise control beats a fuzzy drag zone). **With
  this, cosmos is feature-CLOSED (owner, 2026-07-15)** — the one standing deferral stays: the uptime/"alive"
  stat shows "—" until a backend boot-time seam exists (memory `cosmos-uptime-deferred`; additive).
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

---

## I. Deployment & operations

### I1. Release-worktree deploy — rollback as a symlink flip (**deferred 2026-07-26, owner-ruled; see [`UPDATE_PLAN.md`](./UPDATE_PLAN.md) §8②**)

**The pain today.** `§Rollback` is `git checkout v(prev) && install.sh prod` — an in-place checkout
plus a **full rebuild** (npm + pip). It needs the network reachable, takes minutes, and rebuilds
artifacts that already existed at the previous tag. For a "seamless updates" goal, rollback is the
weakest link.

**The shape.** The classic releases-plus-symlink layout: `~/apps/ctrl-b/releases/<tag>/` as a fresh
git worktree per release, each with its own venv and built `dist`; `current` → symlink to the active
release; the unit's `ExecStart`/`WorkingDirectory` resolve through `current`. Cutover = build the new
release **completely**, verify it, flip the symlink, restart. **Rollback = flip the symlink back and
restart — seconds, offline, no rebuild.**

**Secondary benefit** (Codex, 2026-07-26): it closes a real if narrow window. `pip install -e` today
mutates the tree the *running* process points at, so a failed install can crash the old process via a
lazy import of an upgraded dependency, and restarting cannot restore the former backend. Accepted and
documented rather than fixed, because the consequence is downtime starting minutes earlier during an
update already in progress — not corruption.

**Why deferred.** Deferring costs **one line** of rework (the keep-old-`dist` scaffolding, which
`UPDATE_PLAN.md` §4 therefore does not build). Nothing in the config-migration design changes under
either layout — the migration operates on `$CTRLB_HOME`, outside the tree. Doing both at once would
change the config path *and* the update path in a single release, i.e. two risky changes to the thing
that must never break.

**What it touches when built.** `install.sh` build/cutover · the systemd unit paths · release pruning
(keep last N) · a careful one-time migration of the existing prod install to the new layout ·
`deploy/linux/README.md` §Release/§Rollback/§Hotfix · rollback testing on dev first. Comparable in
size to the migration work itself — its own plan, not a rider.

### I2. Provider credentials from the environment — the ruled seam (**declined 2026-07-26; see [`UPDATE_PLAN.md`](./UPDATE_PLAN.md) §13**)

**Not built, and the shape is already decided** — so if the need ever appears this is an additive
slice, not a design round.

**The need it would serve.** Today every credential lives in `config.yaml` (0600, gitignored,
UI-managed), which is correct for one operator on one box. It stops being enough with an immutable or
read-only config deployment, container secret injection, an external secret manager, automated
credential rotation, or a wish to distribute the config independently of its secrets. **None of those
exists here** — there is no `.env` on either box — which is why this is declined rather than built.

**The shape, ruled by Fable in the slice-3 round table.** An **explicit optional field** on the
provider:

```yaml
providers:
  openrouter:
    base_url: https://openrouter.ai/api/v1
    api_key_env: OPENROUTER_KEY     # names WHERE the key is; `api_key:` names WHAT it is
```

- **Never a magic string** (`api_key: env:NAME`). A value-encoded union inside the one field the secret
  machinery owns forces carve-outs into audited code: `mask_secrets` must learn not to mask a *name*,
  `secret_values` would redact the name while missing the real key, and the Conf tab's password input
  becomes sometimes-a-name. A sibling field says a different thing and needs **none** of that — it
  isn't in `_SECRET_LEAF_KEYS`, so it displays, round-trips and PUTs as ordinary data, and
  `providers_rev` picks it up for free. Cost: one line in the drift-guard allowlist
  (`tests/test_secret_hygiene.py:142`, since the name matches a secret hint).
- **Resolved at the registry, never in `load_settings`.** Resolving at the config layer puts the secret
  into `model_dump`, which the PUT chokepoint writes — materialising the env value into the very file
  it was meant to stay out of, and (LiteLLM's own bug report) the copy then *shadows the env source on
  every restart*. `ProviderCfg.api_key` has exactly two consumers today
  (`core/provider_registry.py:252-269` and `272-337`); the seam ships as **one
  `resolve_api_key(pcfg)` helper** so a third consumer cannot bypass it.
- **A missing variable must invalidate the provider's targets**, not degrade to no-auth: a strict 422
  on a resolution-relevant PUT and a names-only lenient warning at boot, through the channel that
  already exists.
- **`Settings.secret_values()` must return the resolved value**, or shell-output and session-search
  redaction stops protecting the real key (`services/actions/shell.py:72`,
  `agent/session_search.py:68-70`).

**Explicitly NOT the shape:** `CTRLB_PROVIDERS__<name>__<field>` env→path addressing. It cannot deliver
its own capability without per-field provenance, it makes an env-addressed provider un-renameable, and
6 of 8 peer projects abandoned the pattern ([R6](./research/R6-env-overrides-and-secret-provenance.md)).

---

## P. Parked — not planned

> **What this section is (owner directive, 2026-07-28):** ideas the owner has explicitly ruled OUT of
> the plan — not deferred, not "later", just **not wanted unless a need actually arises**. They are
> recorded here only so their design thinking isn't lost and so they stop resurfacing in sweeps.
> **Agents: do not propose, triage, or schedule anything in this section.** The only way an item
> leaves this list is the owner asking for it by name.

- **QR-to-phone** (ex-TODO 6c-2, the last D20 piece; deleted by the owner 2026-07-28 — "just not
  something I want to do or need"). Shelved design, should it ever return: server-rendered QR SVG at
  `GET /api/access/qr.svg` via `segno` (zero-dep, pure-Python) so the access panel `<img>`s it,
  keeping the tailnet hostname off any third-party QR service.
- **Provider/embeddings picker disclosure** (ex-v1.3.1 device findings #4/#5; skipped by the owner
  2026-07-28 — the single user knows their own providers; "let the user be the judge"). Shelved
  design: widen `PickerCatalog` per provider to `{models, apiMode, roles?}` (roles derived in the
  same walk as `referenceReport.byProvider`), render provider options as `name · role-summary` with
  a quiet current-usage hint line on cross-role selection; embeddings model picker sorts and
  annotates `dim`-carrying catalog entries — disclosure only, never a hard filter (R1: no portable
  capability probe exists; D48 no-capability-tags stands).
