# Design — data structures & system flow (dashboard_v2)

The concrete engineering design behind the decisions in `DECISIONS.md` and the shape in
`ARCHITECTURE.md`. This is the **authoritative detail** for models, classes, flows, and edge
cases; where it sharpens an earlier sketch (e.g. the message model), **this doc wins** and the
sketch is a summary. Python 3.14+, Pydantic v2, FastAPI. Read alongside `ARCHITECTURE.md`.

> **⚠️ Reconciliation note (2026-06-14).** This doc predates **D14/D15**. For the **agent-workspace
> and memory** areas, **D14/D15 supersede the sketches here**: agents are **folder-only**
> (`$CTRLB_HOME/agents/<name>/` = `agent.yaml` + `SOUL.md` + `memories/` + `skills/`; **no `agents:[]`
> list**, no `AgentDef.memory` field); memory is the **Hermes file model** (§6 updated below);
> `messages` gains an **`agent`** column (D15 #5). The §1 package layout is **aspirational** — the
> shipped tree is leaner (inference is an *adapter*, the loop lives in `session.py` not a `runner.py`,
> no `tools/`/`voice.py`/`automations.py`/`notify/`/`memory/` yet). Conceptual designs (capability
> model, loop state machine) remain accurate — but parts of **§10** (per-thread queueing, `/cancel`)
> and **§12** (event `id:` / `Last-Event-ID` replay) are **target design, not yet built** — each is
> marked **▹** inline (ACA Slice 0); see `AGENT_CHAT_AUDIT.md` ACA-1/ACA-2 (fix plan: ACA Slices
> 2/3/5). The §12 *event inventory* is the shipped contract (reconciled against `session.py`
> 2026-07-07).

---

## 0. Design principles

1. **One extension mechanism per axis, via registries + Protocols.** Everything the owner wants to
   "add more of" — actions, tools, skills, agents, memory backends, notification channels,
   inference backends, MCP servers — is a **registered implementation of a `Protocol`**. Adding a
   feature = add a file + register; never edit a switch statement.
2. **Dependency points inward.** `domain` (pure models, no I/O) ← `core` (registries, policies,
   protocols) ← `services` (orchestration) ← `adapters` (SSH/WOL/OpenAI/MCP/DB) ← `api` (FastAPI).
   The agent depends on the *capability Protocol*, never on a concrete tool.
3. **Pure where possible.** Permission decisions, prompt assembly, plan diffs, redaction, model
   resolution are pure functions — trivially testable, no I/O.
4. **One unified "capability" abstraction.** Typed actions, utility tools, built-in agent tools,
   and MCP tools are all the *same interface* (`Tool`); the UI uses a subset, the agent uses the
   union. This collapses the "action registry vs tool registry" into one mechanism (refines D3/D8).
5. **Everything privileged emits an `Event`.** Single audit path + single SSE feed.
6. **Secrets are typed (`SecretStr`) and redacted centrally** — never logged, never streamed, never
   returned unmasked.
7. **Async-first, blocking-isolated.** Blocking libs (paramiko, wakeonlan, subprocess) run in a
   threadpool; everything else is `async`. SQLite writes are serialized.

---

## 1. Package layout

```
backend/app/
  domain/            # pure models + enums (no I/O, no framework imports)
    host.py service.py event.py conversation.py agent.py result.py enums.py
  core/              # protocols, registries, policies (the seams)
    tool.py          # Tool protocol, ToolSpec, ToolResult, ToolRegistry
    memory.py        # MemoryProvider protocol
    notify.py        # NotificationChannel protocol
    inference.py     # InferenceClient protocol + ModelRef resolution
    skills.py        # SkillProvider + SkillSelector protocol
    permissions.py   # PermissionPolicy (pure)
    events.py        # EventBus (in-proc pub/sub for SSE)
    errors.py        # exception taxonomy
    redact.py        # secret redaction
  services/
    fleet.py         # ping/status fan-out, wake, shutdown (uses adapters)
    actions/         # built-in actions register into the ToolRegistry
    tools/           # built-in utility tools (yt_captions, ip_info, dns_trace)
    agent/
      session.py     # AgentSession + the loop state machine  ← heart of the system
      runner.py      # AgentRunner (per AgentDef: toolset build + loop)
      compaction.py  # Compactor
      subagents.py   # spawn_subagent tool + orchestration strategy
      planning.py    # task_plan tool + Plan model
    voice.py automations.py settings_service.py
  adapters/
    ssh.py wol.py ping.py subprocess.py            # fleet
    openai_client.py mcp_client.py searxng.py      # inference + integrations
    db/  (schema.sql, repositories.py, unit_of_work.py)
    notify/ (webpush.py ntfy.py bot.py foreground.py)
    memory/ (none.py file.py vector.py)
  config.py main.py
  api/ (routers; thin — validate, call a service, stream)
```

Frontend layout per `ARCHITECTURE.md` §README; TS types in §14 below.

---

## 2. Core domain models

```python
# domain/enums.py
class OSType(StrEnum): WINDOWS="windows"; LINUX="linux"
class Risk(StrEnum): LOW="low"; MED="med"; HIGH="high"
class Privilege(StrEnum):           # the ladder (A1)
    READONLY="readonly"; CONFIRM="confirm"; AUTO_LOW="auto_low"; FULL="full"
class Actor(StrEnum): USER="user"; AGENT="agent"; SYSTEM="system"; AUTOMATION="automation"
class RunState(StrEnum):            # an action/tool invocation lifecycle
    PENDING="pending"; AWAITING_CONFIRM="awaiting_confirm"; RUNNING="running"
    OK="ok"; ERROR="error"; DENIED="denied"; SKIPPED="skipped"; TIMEOUT="timeout"
```

```python
# domain/host.py
class Host(BaseModel):
    id: str                          # stable slug; never the mutable name
    name: str
    ip: str
    mac: str | None = None           # WOL impossible if None — surfaced, not crashed
    ssh_username: str | None = None
    ssh_password: SecretStr | None = None
    ssh_port: int = 22
    os_type: OSType
    role: str | None = None
    vpn_host: str | None = None      # D47: VPN/overlay address (MagicDNS name preferred); generic, no vendor string
    ssh_prefer_vpn: bool = False     # D47: per-host VPN-first SSH failover toggle (order lives in host_addresses)
    tags: list[str] = []
    idle_action: Literal["none","sleep","shutdown"] = "none"   # D1 (opt-in)
    idle_minutes: int | None = None

class HostStatus(BaseModel):         # derived, never persisted in YAML
    host_id: str
    online: bool
    ping_ms: float | None = None
    last_seen: datetime | None = None
    checked_at: datetime
    error: str | None = None         # e.g. "name resolution failed"

class Service(BaseModel):
    id: str
    host_id: str
    name: str
    kind: str | None = None          # "jellyfin","ollama",...
    port: int | None = None
    path: str = ""
    autostart: bool = False
    cmd: dict[str, dict[OSType, str]] = {}   # {"start":{windows:..,linux:..}, "stop":..}
    # state is derived (port reachable / process check), not stored
```

`Host.id` is a **stable slug** decoupled from `name` so renames don't orphan services/events.
`mac=None` and `ssh_*=None` are first-class: actions needing them fail with a clear `ToolResult`
(`DENIED`, "no MAC configured"), never an exception to the user.

---

## 3. The unified capability model (actions + tools + MCP, one interface)

```python
# core/tool.py
class ToolResult(BaseModel):
    state: RunState
    summary: str                       # one-line, human + agent readable
    data: dict[str, Any] = {}          # structured (for UI panels / agent reasoning)
    output: str | None = None          # captured stdout/long text (already redacted+truncated)
    error: str | None = None
    artifacts: list[Artifact] = []     # files (e.g. captions .json) for download
    duration_ms: int | None = None

class ToolSpec(BaseModel):
    name: str                          # unique, namespaced for MCP ("mcp:server:tool")
    title: str; description: str; icon: str | None = None
    category: Literal["action","utility","builtin","mcp"]
    input_model: type[BaseModel]       # → JSON Schema for the agent + validation
    risk: Risk = Risk.LOW
    confirm: bool = False              # force confirmation regardless of privilege
    agent_exposed: bool = True
    ui_exposed: bool = False           # shows as a Utils card / host button
    timeout_s: float | None = None
    describe: Callable[[Settings], str] | None = None   # live description from Settings (D57)

class Tool(Protocol):
    spec: ToolSpec
    async def run(self, inp: BaseModel, ctx: "InvocationContext") -> ToolResult: ...

@dataclass
class InvocationContext:               # passed to every tool — the "world handle"
    actor: Actor
    privilege: Privilege
    interactive: bool                  # False for headless automations (A3)
    confirm_token: str | None          # present once the user approved
    settings: "Settings"
    deps: "Deps"                       # adapters: ssh, wol, db, clients, event_bus...
    recall: "RecallBudget | None"      # the turn's Core Memory recall budget (D57 §4) — None outside a turn
    cancel: anyio.CancelScope
```

```python
# the registry — the single source feeding UI buttons AND the agent toolset
class ToolRegistry:
    def register(self, tool: Tool) -> None: ...
    def get(self, name: str) -> Tool: ...                 # raises UnknownTool
    def for_agent(self, agent: "AgentDef") -> list[Tool]: # filtered by allowlist+exposed+enabled
    def ui_tools(self) -> list[Tool]: ...                 # ui_exposed subset
    def to_openai_tools(self, tools: list[Tool]) -> list[dict]: ...   # JSON-Schema fn defs
```

Decorator sugar registers built-ins:

```python
@action("shutdown_host", risk=Risk.HIGH, confirm=True, ui_exposed=True)
async def shutdown_host(inp: ShutdownHostInput, ctx) -> ToolResult: ...

@tool("dns_trace", title="DNS / traceroute", icon="globe")   # category="utility"
async def dns_trace(inp: DnsTraceInput, ctx) -> ToolResult: ...
```

MCP tools are wrapped at connect time into the same interface:

```python
class McpTool:                          # adapter: remote MCP tool → Tool
    spec: ToolSpec                       # name="mcp:<server>:<tool>", risk from config/default HIGH
    async def run(self, inp, ctx): ...   # round-trips to the MCP server, normalizes to ToolResult
```

**Why unified:** the agent never special-cases "is this an action or a tool or MCP" — it sees one
list. UI buttons render `ui_tools()`. Permission logic is identical for all. Adding any capability
is one registration.

**Live descriptions & feature hiding (D57).** `ToolSpec.describe(settings)` renders a spec's
description from **live `Settings`** when a feature flips (the `memory` tool's tier-aware wording);
`tool_overrides` still wins over both. `ToolRegistry.for_agent(..., hidden=…)` drops the tools of a
**disabled feature** *after* the core/allowlist union — so a `core` builtin can be hidden too — and
the session passes the same set at both consumers (the schema set and the availability guard), so
what the model is offered and what it may run can never disagree.

### Permission policy (pure)

```python
# core/permissions.py
class Decision(StrEnum): ALLOW="allow"; CONFIRM="confirm"; DENY="deny"

def decide(spec: ToolSpec, privilege: Privilege, *, interactive: bool,
           run_shell_allowed: bool, approved: bool = False) -> Decision:   # `approved` = D44
    if spec.name == "run_shell" and not run_shell_allowed and privilege != Privilege.FULL:
        return Decision.DENY
    if privilege == Privilege.READONLY and spec.category in ("action",) and spec.risk != Risk.LOW:
        return Decision.DENY
    if spec.confirm:                                       # designer forced-confirm — `approved` ignored
        return Decision.ALLOW if privilege == Privilege.FULL else Decision.CONFIRM
    if spec.risk == Risk.HIGH:
        return Decision.ALLOW if privilege == Privilege.FULL or approved else Decision.CONFIRM
    if spec.risk == Risk.MED:
        return Decision.ALLOW if privilege in (Privilege.AUTO_LOW, Privilege.FULL) or approved else Decision.CONFIRM
    return Decision.ALLOW   # low risk
```

Headless (`interactive=False`): `CONFIRM` becomes **notify-and-park** (F1) or the automation's
fallback (skip / default), never an interactive prompt.

> **Persisted approvals (Slice 8, D44).** `decide()` owns the WHOLE ladder — the caller computes a
> match, never a verdict (the `run_shell_allowed` precedent). Order: **policy DENY > `spec.confirm`
> (un-downgradable) > `approved` > the risk decision**, so an approval can only turn a *risk-derived*
> CONFIRM into ALLOW.
>
> The rest of the policy is pure and lives in the same module: `canonical_str(value)` (the one
> match form — `str` as-is · other scalars JSON-encoded · `None` → `"null"` · list/dict → `None`,
> unmatchable) · `glob_escape(s)` · `exact_arg_pins(args)` (the args-EXACT pin map: every top-level
> field → `glob_escape(canonical_str(v))`, or `None` if any value is non-scalar — the ONE builder
> shared by the grant write and the eligibility flag) · `approval_match(rules, args) -> ApprovalRule
> | None` (OR across rules, AND within one, `fnmatchcase`; unlisted fields unconstrained by design =
> the Conf widening semantics; unknown field / non-scalar → the rule is inert, fail closed).
>
> Storage is the third dimension on the existing unified per-tool object:
> `ToolOverride.approvals: list[ApprovalRule] | None` (`ApprovalRule{args: dict[str,str] | None}`,
> `extra="forbid"`, pattern values str-coerced). Approvals are **settings state, never a spec
> overlay** — `runtime.apply_tool_overrides` doesn't touch them.
>
> **In `ActionService.invoke`:** after arg validation, consult `self._deps.settings.tool_overrides`
> live — `rule = approval_match(override.approvals, inp.model_dump(mode="json"))`, computed **only**
> when the tool has rules AND `not spec.confirm` (skip the matcher when it can't apply) — then pass
> `approved=rule is not None` into `decide()`. On a matched run, the mandatory audit marker
> `" [auto-allowed: …]"` is appended to `result.summary` **before** `_record`, so the one Event per
> action carries it (no new event kind, no migration). Because settings is the shared object mutated
> in place by `apply_settings_inplace`, a revoke wins from the very next invoke — no cache, no TOCTOU.
> `ActionService.approval_eligible(name, raw_args)` answers whether a bubble grant here would be both
> *expressible* (`exact_arg_pins` non-None) and *ever able to fire* (`not spec.confirm`) — it drives
> `always_eligible` / `alwaysEligible` on the `tool.permission` event so the FE hides a dead affordance.
>
> **The grant path is server-side.** `ResumeRequest.decision` gains **`execute_always`**: a
> `resume`-local branch (invisible to `_drive`) calls `runtime.grant_approval(app, tool, args)` BEFORE
> running the call, then proceeds byte-identically to `execute`. `grant_approval` re-validates the
> suspended call's args, builds the rule via `exact_arg_pins`, and appends it under the shared
> **`runtime.settings_write_lock`** through the shared **`runtime.apply_settings_patch`** (the
> merge→validate→persist→`reconfigure` core, **re-homed from `api/settings.py` — the PUT now shares
> both**, so there is exactly one lock and one write sequence). It is idempotent (an identical rule is
> a no-op) and **never blocks the run**: inexpressible args or a persist failure return a short
> breadcrumb note that `_run_calls` appends to that call's summary (`resume_notes`), and the call
> still executes as a human-confirmed run.



---

## 4. Conversation model (message-parts — refines the flat sketch)

Adopt opencode's **message-has-parts** shape — far more flexible than a single `content` string and
the right substrate for tool calls, plans, questions, and streaming.

```python
# domain/conversation.py
class Thread(BaseModel):
    id: str; title: str | None; agent: str            # which AgentDef
    created_at: datetime; updated_at: datetime
    archived: bool = False

# Parts: a discriminated union on `type`
class TextPart(BaseModel):      type: Literal["text"]="text"; text: str
class ToolCallPart(BaseModel):  type: Literal["tool_call"]="tool_call"
                                call_id: str; tool: str; args: dict; state: RunState
class ToolResultPart(BaseModel):type: Literal["tool_result"]="tool_result"
                                call_id: str; result: ToolResult
class QuestionPart(BaseModel):  type: Literal["question"]="question"
                                question: str; choices: list[str] = []; answer: str | None = None
class PlanPart(BaseModel):      type: Literal["plan"]="plan"; plan: "Plan"
class ErrorPart(BaseModel):     type: Literal["error"]="error"; message: str; retryable: bool

Part = Annotated[TextPart|ToolCallPart|ToolResultPart|QuestionPart|PlanPart|ErrorPart,
                 Field(discriminator="type")]

class Message(BaseModel):
    id: str; thread_id: str
    role: Literal["user","assistant","system","tool"]
    parts: list[Part]
    actor: Actor = Actor.USER
    agent: str | None = None           # D15 #5: which AgentDef produced this assistant turn
                                       # (null = legacy/default). Resume prefers the last turn's agent;
                                       # session_search/restore read it for per-turn attribution.
    ts: datetime
    tokens: int | None = None          # for compaction budgeting
    compacted: bool = False            # excluded from working context once summarized
```

```python
class PlanItem(BaseModel): id: str; text: str; status: Literal["pending","active","done","dropped"]
class Plan(BaseModel):     items: list[PlanItem]; updated_at: datetime
```

A `ToolCallPart` and its matching `ToolResultPart` share `call_id`. The UI renders a command/action
bubble from the pair; a `confirm`-gated call sits in `AWAITING_CONFIRM` until the user acts.

---

## 5. Agent subsystem (the heart)

### 5.1 Agent definitions & runner

```python
# domain/agent.py
class AgentDef(BaseModel):
    name: str
    prompt: str                         # system prompt
    model: ModelRef                     # {mode: local|cloud, model: str}
    tools: list[str] | Literal["*"] = "*"   # allowlist of tool names/globs
    skills: list[str] | Literal["*"] = "*"
    privilege: Privilege = Privilege.CONFIRM
    memory: MemoryConfig
    max_iterations: int = 16
    max_subagent_depth: int = 2
    max_concurrent_subagents: int = 3      # per-agent fan-out cap (global cap lives in settings)

class ModelRef(BaseModel):              # "pointer + call config" (D42/A10)
    mode: str | None = None             # local|cloud|None → inference.default_mode
    model: str | None = None            # None → the endpoint's configured model
    max_tokens: int | None = None       # output budget → per-endpoint max_tokens_field kwarg
    reasoning_effort: Literal["off","minimal","low","medium","high","xhigh","max"] | None = None
    reasoning_tokens: int | None = None # numeric budget; declared, v1-untranslated (advisory)
```

`AgentSession` (shipped name; the sketch says `AgentRunner`) is constructed per turn from an
`AgentDef`. Subagents reuse the same machinery at greater depth.

> **Updated by D14/D15 (2026-06-14).** The `AgentDef` above is illustrative; the shipped + folder
> shape: agents are **folders** (`$CTRLB_HOME/agents/<name>/`), not `settings.agents` entries —
> **there is no `agents:[]` list**. `agent.yaml` = `AgentDef` **minus `name`** (= folder) and **minus
> `prompt`** (= `SOUL.md`), carrying **only overrides**; absent fields inherit a `config.yaml`
> **`agent.defaults`** block via `deep_merge` (D15 #1). The **default agent** has no folder/`agent.yaml`
> — it's the root + `config.yaml` globals. There is **no `AgentDef.memory` field** (memory is the file
> model, §6); real fields include `prompt_append`/`inherit_append` (7e-a), `compaction`, `routing` (D43 —
> failure-fallback lead model; global default via `agent.defaults.routing`, no `Settings.agent.routing`),
> the loop guards (`max_repeat_calls`/`max_calls_per_tool`/`max_stall_iterations`), and `max_iterations=16`.
> `ModelRef.mode`/`model` are **both optional** (None → inherit `inference.default_mode`/the endpoint).

### 5.2 The loop as an explicit state machine

```
                 ┌────────────────────────── user message / automation trigger
                 ▼
   ASSEMBLE ──► CALL_MODEL ──► (stream deltas) ──► parse model output
     ▲              │                                   │
     │              │                       ┌───────────┴───────────┐
     │              │                  text-only                tool_call(s)
     │              ▼                       │                       │
     │           (no tools) ──► DONE        │                 PERMISSION_GATE
     │                                      │                  │    │     │
     │                                  emit text         ALLOW │ CONFIRM │ DENY
     │                                      │                  │    │     │
     │                                      ▼              EXECUTE  │   tool_result(denied)
   COMPACT? ◄──────────────────────────────┴───────── persist ◄────┘        │
 (token budget)                                          │       AWAIT_CONFIRM (interactive)
                                                         │         / NOTIFY_PARK (headless)
                                                         ▼
                                            append tool_result ──► loop (CALL_MODEL)
   QUESTION ──► AWAIT_ANSWER ──► (resume) ;  max_iterations exceeded ──► DONE(capped)
```

```python
# services/agent/session.py
class AgentSession:
    def __init__(self, thread: Thread, agent: AgentDef, deps: Deps): ...
    async def run_turn(self, user_msg: Message) -> AsyncIterator[AgentEvent]:
        """Drives the loop, yielding AgentEvents (→ SSE). Persists every part as it lands."""
```

Loop responsibilities, in order, per iteration:
1. **Assemble context** = system prompt (+ skill instructions if selected) + memory context +
   *working* messages (non-`compacted`) within the token budget.
2. **Compaction check** *before* calling the model: if projected tokens > threshold → run
   `Compactor` (§5.4), mark old messages `compacted`, insert a summary system message, emit
   `compaction` event.
3. **Call model** (streaming or buffered per setting) with `to_openai_tools(runner.toolset)`.
4. **Parse**: text deltas stream out; tool calls collected. Models may emit **several** tool calls
   per step — handle as a list.
5. **For each tool call**: validate args against `input_model` (on failure → feed a
   `tool_result(error, retryable)` back so the model can self-correct, don't crash); run
   `decide(...)`; ALLOW→execute, CONFIRM→emit `tool.permission_required` and suspend, DENY→synthesize
   a denied `ToolResult`.
6. **Execute** via `tool.run(inp, ctx)` with a `timeout_s` cancel scope; append `ToolResultPart`;
   emit `Event`.
7. **Loop** until the model returns text-only (done), `max_iterations` hit (emit a capped notice),
   or a `question`/`confirm` suspends the turn.

> **As-built loop (Slices 3–5, D39/D40/D41).** The sketch above is the shape; the shipped `_drive`
> iteration runs, in order:
> 1. **Drain A** — apply any steers queued mid-turn (§10) at the loop **top**, *before* the compaction
>    check, so compaction always sees them as ordinary history. Message steers persist as `user`
>    messages (one `Database.transaction()` per contiguous run, **persist-before-clear**: the queue
>    clears only after the txn commits); `!exec` steers re-check `shell.user_exec_enabled` **live**
>    (fail-closed, commit-before-run) then run the shared `run_user_exec`. Each yields `steer.applied`.
> 2. **Compaction** — a free Tier-1 tool-output clearing plan is computed, then the **window-aware
>    trigger** (D42, §5.4): `should_compact` gates a `// compacting…` `notice` breadcrumb (emitted
>    **only** when compaction will actually summarize), then `compact` runs and may emit `compaction`.
>    The reactive context-overflow backstop (§5.4) wraps the model call one iteration lower.
> 3. **Assemble + call model** — the cached static head + non-compacted history stream through the
>    per-server **request gate** (`ProviderCfg.max_concurrent_requests`, held for the whole
>    streamed response, released before any tool runs — no hold-and-wait).
> 4. **`_run_calls` is an ASYNC GENERATOR** (not an end-of-step buffer). `_classify_batch` splits the
>    batch into a **parallel read-only prefix** — the maximal *leading* run of builtin-authored
>    `read_only`, non-`suspending`, `decide()==ALLOW` calls (≥2, else the batch stays serial) — and a
>    **verbatim serial tail**. The prefix dispatches under `asyncio.Semaphore(AgentDef.
>    max_parallel_tools)` with a **single consumer** doing all bookkeeping; the tail keeps today's
>    confirm/question **suspension** semantics unchanged. **Per-call persistence:** each resolved call
>    commits its tool-row upsert + the assistant state-flip in ONE transaction and only THEN yields its
>    `tool.result` (**persist-before-emit** — a subscriber never holds a row that later vanished). Both
>    the per-call persists and the `finally` **backstop** run through the one `_persist_shielded`
>    dual-shield helper (defeats a raw `Task.cancel()` and anyio scope-cancel; swallow-only-while-
>    unwinding).
> 5. **Loop** until text-only (`done(completed)`), a suspend (`done(suspended)`), or the stall/iteration
>    guards force a tool-less `_finalize`.

> **Failure-fallback routing & failover visibility (Slice 7, D43).** The loop now resolves ONE routed
> `ModelRef` per **logical** turn at the top of `_drive` (the `eff_mode`/`eff_model`/`eff_reasoning`/`reserve`
> seam), and narrates the failover chain live:
> - **The routing machine** (`services/agent/routing.py` `RoutingState`, the `CompactionState` template —
>   per-thread `app.state.routing_state`, lazy-mint + `routing_state_for` + `prune_routing_state`).
>   `RoutingCfg` (`lead: ModelRef` · `failure_threshold=2` · `fallback_turns=2`) is an `AgentDef.routing`
>   field; the global default is **`agent.defaults.routing`** (D16 — deliberately NO `Settings.agent.routing`,
>   the divergence from compaction's dual home). On a FRESH turn the router returns `lead` while a fallback
>   episode is live (`fallback_remaining > 0`) else `agent.model` (the WORKER); **all four derived locals
>   read the routed ref**, and `_finalize` takes `routed` too (so a lead turn's `max_tokens`/`reasoning`/the
>   compaction output-reserve all price the lead). A **resume READS `current_route`** instead of re-deciding
>   (the ACA-16 mode-carry parallel — no mid-logical-turn flip, no double-decrement; a restart loses it →
>   re-resolves to the worker, a recorded residual). The `/local`//`/cloud` prefix **wins and bypasses** the
>   router (selects the ENDPOINT, runs the WORKER ref on it). Subagents copy the field but are runtime-inert
>   (no `RoutingState`).
> - **Structural failure counting** (session-side, in `_drive` — `_conclude_routing` settles it at the
>   completed/error/capped terminals, never a suspend): a worker-routed turn counts a HARD failure for (a) a
>   single-endpoint chain `InferenceError` (`InferenceError.endpoints_tried == 1` — a multi-endpoint total
>   outage / ambiguous shape is NEUTRAL, review F12) or (b) reaching `_finalize` via the STALL guard or
>   ITERATION EXHAUSTION (explicit flags, never inferred from terminal strings). A clean `completed` resets;
>   `suspended`/`cancelled` are neutral. At `failure_threshold` → open an episode + ONE `// lead model for
>   the next N turns (worker failing)` notice; the episode's last lead turn emits `// back to the worker
>   model`. Crash-and-burn only — a confident-wrong answer is a clean turn by design (content-sniffing
>   rejected).
> - **The retry tier & typed events** (A6/A7). `core/failover.failover()` is now an **async generator**:
>   it yields `HopRetry`/`HopFailover` control items live then the terminal `FailoverResult` as its LAST
>   item (buffered callers — voice/embeddings/`complete()` — drain it via `failover_collect()`, byte-for-byte
>   unchanged). `adapters/inference.categorize()` (beside `is_context_overflow`) classifies a failure
>   `transient`/`overflow`/`fatal_for_endpoint`/`other`; a `transient` chat-stream init failure retries the
>   SAME endpoint up to its resolved `retry_attempts` (fixed curve base 2s×2ⁿ capped 30s, a larger
>   `Retry-After` — parsed pre-flattening into `InferenceError.retry_after` — wins; the permit-free backoff
>   sleeps INSIDE the generator), then hops. `stream_chat` re-yields the items as `RetryNotice`/`FailoverNotice`
>   before the first `ChatDelta`; **both** session consumers (`_drive` + `_finalize`) map them via one
>   `_control_event` helper to the `inference.retry`/`inference.failover` AgentEvents ABOVE the delta checks,
>   never touching `streamed_any` (the D42 nothing-streamed backstop stays honest). The **post-hoc degraded
>   `notice` is DELETED** — a fallback serve is narrated live by the typed event (no double-narration); a
>   snapshot-carried `retry_status` (on the `TurnAccumulator`) renders the retry line on a re-attach mid-backoff
>   instead of a dead spinner; `collect_turn` folds both kinds to `notices` text for buffered parity.

### 5.3 Suspension & resumption (the nuance that makes it robust)

A turn can **suspend** (awaiting confirm or an answer). The session state persists in the DB, so:
- **Shipped (ACA Slice 3, D39):** the turn is a server-owned task, so the SSE stream can drop and
  **reconnect** via `GET /api/agent/turns/{id}/stream`, replaying from the last `turn_id:seq` event
  id (tail-replay or a `turn.sync` snapshot). A dropped stream detaches a *subscriber* — the loop and
  its remaining steps still run + persist; persisted state also re-reads via
  `GET /api/threads/{id}/messages`.
- The user can navigate away / close the PWA; the pending state lives in the thread.
- Resumption is a normal API call (`POST /threads/{id}/resume` with the confirm-token or the
  answer) that re-enters `run_turn` from the suspended point.
- **Headless** automations never suspend interactively: a gated call triggers notify-and-park
  (write a pending record + fire F1) or the automation's fallback policy.

### 5.4 Compaction

```python
class Compactor:                          # services/agent/compaction.py — stateless, one per session
    def __init__(self, inference, messages, cfg: CompactionCfg): ...
    async def compact(self, thread, *, force=False, window=None, reserve_tokens=None,
                      estimated_tokens=None, clearing=None, cleared_at_anchor=None,
                      instructions=None) -> CompactionResult | None: ...
# folds the oldest COMPLETE turns into one summary `system` message with the SELECTED summarizer
# model (D11), keeps a recent floor verbatim, flips the folded rows `compacted` (never deleted — DB
# stays the audit trail). Summarizer failure → a truncation placeholder (the context still shrinks).
```

> **As-built (D42, ACA Slice 6 — context management & compaction v2).** The v1 sketch above still
> holds (summary-as-system-message, `compacted` overlay, turn-boundary safety, never-lose-history);
> Slice 6 makes the *trigger* window-aware, adds a free pre-summary trim tier, a structured
> template, a thrash breaker, and a reactive backstop. The **Compactor stays stateless** — the
> per-turn `AgentSession` owns all window/anchor/thrash state and passes decisions in (all new
> `compact`/`should_compact` params are defaulted, so every existing caller is unchanged). The
> single `_over_threshold` predicate serves *both* `compact()` and the `should_compact()` ACA-11
> pre-check, so the trigger math lives in exactly one place.
>
> - **Context windows & the trigger.** A per-target window resolves on the `InferenceClient` via
>   the ladder **`ModelCfg.context_window` (config, per-model since D48/A11) > llama.cpp `/props`
>   probe > `None`**
>   (`effective_window`). The **probe** (`probed_context_window`) is a raw `GET {base_url}/props` →
>   `default_generation_settings.n_ctx` (with `meta.n_ctx_train` kept as a sanity ceiling; an upward
>   override is honoured + logged), on a lazily-built httpx client (no new dep), **lazy + memoized
>   per `base_url` — failed probes memoized too, single-flight (a per-client lock, concurrent
>   first-uses issue ONE GET) — and it NEVER raises or blocks a turn** (any
>   failure/non-200/malformed ⇒ `None`). No cache-invalidation bookkeeping: `runtime.set_inference`
>   rebuilds the whole client on any inference-settings change, so a config edit re-probes for free.
>   Only the configured **local** endpoint is probe-eligible (`_is_probe_eligible`, matched by
>   `base_url`) — cloud/OpenAI has no `/props`, fallbacks rely on manual `context_window`. The
>   trigger fires when the estimate exceeds **`window × threshold_frac − reserve`** (`threshold_frac`
>   default 0.85; `reserve` = the effective `ModelRef.max_tokens` output budget when
>   `reserve_output`), or the absolute **`threshold_tokens`** when no window resolves (v1's
>   no-regression path). A degenerate line (`reserve ≥ window × threshold_frac`, i.e. ≤ 0) degrades
>   to the `threshold_tokens` fallback and warns once. Iteration 1 prices against the *selected*
>   endpoint; **iteration 2+ prices against the endpoint that actually served** — `_record` stamps
>   `StreamReport.served_endpoint` (`chain[served_index][1]`), so the anchor + window come from the
>   same serve.
> - **The anchored estimator** (`ContextEstimator`, session-held) fixes the v1 blind spot — the
>   char/4 heuristic misses the system head + tool schemas the model prefills each call. It anchors
>   on the real **total prompt tokens** of the last call (`StreamReport.prompt_tokens`: llama.cpp
>   `prompt_progress.total`, else cloud `usage.prompt_tokens`) and adds a heuristic only of the
>   messages appended *after* that call's watermark. With no reliable total it falls back to
>   `estimate_tokens(history)` + the A8 head+tools `overhead`. The anchor is dropped on a **fold**
>   (explicit `invalidate()`), a **served-endpoint change** (a different backend tokenizes
>   differently), **degraded/absent telemetry** (`record(total=None)`), or the watermark falling out
>   of history. A backend that reports no total (no `return_progress`/`include_usage`) runs
>   heuristic-only — the client logs an *anchoring-inactive* INFO once naming the exact remedy.
> - **Tier 1 — assembly-time tool-output clearing** runs free before any paid summary: the pure,
>   shared `plan_clearing(history, cfg) → ClearingPlan` selects tool-result OUTPUTS to blank
>   (`OUTPUT_CLEARED_PLACEHOLDER`), keeping the `[state] summary` line + any error. One selection per
>   iteration feeds **both** `_assemble` (renders the placeholder for each `call_id` — a
>   rendering-time substitution only, the DB row stays verbatim, A12) and the trigger (priced
>   net-of-clearing at a conservative **chars/5**, below the estimator's chars/4; the gain is the
>   **net difference over the placeholder** and only net-positive outputs are eligible — clearing can
>   never enlarge the prompt, even at `clear_output_min_tokens: 0`). Structural
>   never-clear: a call in a suspend state, a `task_plan`/`memory` result, a *synthesized* result
>   (`duration_ms is None` — never a real tool run), an output at/below `clear_output_min_tokens`, or
>   one within the most-recent `clear_keep_steps` steps (a **step** = one assistant-tool-call round).
>   The forced tool-less `_finalize` assembles under the same clearing plan (its recent-step
>   protection keeps what an honest wrap-up needs).
>   The credit is exact per estimator mode (R1): heuristic mode credits the full priced gain;
>   anchored mode credits only `cleared_now − cleared_at_anchor` (the anchor total already reflects
>   the anchor-time trim — no double-count).
> - **`_split` two floors.** `cut = min(message-cut, token-cut)` — the `keep_last_messages` message
>   floor AND a `keep_recent_tokens` token floor (walk the tail back until it holds ≥
>   `keep_recent_tokens`); whichever keeps *more* recent context wins. Then three snaps that only
>   ever *grow* the tail: the suspend-snap (an `AWAITING_*` call + its resume siblings/result stay
>   verbatim), the **active-`task_plan` snap** (the most-recent `task_plan` pair round-trips in the
>   tail; superseded older pairs may fold), and the user-boundary snap (the tail starts at a `user`
>   message, so a `tool` result is never orphaned).
> - **Tier 2 — the summarizer** fills a fixed **five-section template** (Goals & Requests · Key Facts
>   & State · Actions Taken & Outcomes · Rules & Constraints · Next Steps), scoped to the folded
>   head (a prior rolling summary re-folds). `/compact <instructions>` rides as an extra emphasis
>   block (manual path only). An **overflow guard** reads the summarizer's *own* endpoint window and
>   reserves `max(summarizer.max_tokens, window × 0.2)`; a transcript that won't fit falls back to
>   the truncation-fold instead of a doomed call. The **inflation-reject** abandons a fold whose
>   summary wouldn't shrink the *live* (net-of-clearing) head — `CompactionResult.rejected`, no DB
>   write; `force` bypasses threshold/backoff/breaker but **never** the reject.
> - **The thrash machine** (`app.state.compaction_state`, a per-thread `CompactionState` injected
>   like the steer-queue view — the Compactor stays stateless) counts **only** the inflation-reject
>   as a failure (a truncation-fold that shrinks is a *success*). A failed fold backs auto-compaction
>   off for the rest of the turn (a turn-local flag); at `max_consecutive_failures` the **breaker
>   latches** (auto-compaction stops on the thread) and emits exactly one `// …` notice. A manual
>   `/compact` that leaves the thread under threshold resets it (and `prune_compaction_state` drops
>   the now-inert entry). In-memory → a restart resets it (recorded residual).
> - **The reactive backstop** catches the case the estimate missed. `InferenceError` carries
>   structured `code`/`status` captured *pre-flattening* (`_as_inference_error`, before the failover
>   chain collapses each hop to a string) — D43 adds `retry_after` (from the raw `Retry-After` header) and
>   `endpoints_tried` (from `FailoverError.failures`) to that same pre-flattening capture. `is_context_overflow`
>   is the overflow classifier (OpenAI 400 + `context_length_exceeded`, else a 400-gated substring scan for
>   the llama.cpp shapes / failover-flattened case); D43's `categorize()` sits beside it and delegates the
>   `overflow` tier to it (consumer unchanged). On an overflow **where nothing streamed yet** (`streamed_any` false)
>   and once per turn, the loop runs one **forced** compaction — via the shared `_overflow_fold`
>   helper, passing the iteration's clearing plan so the inflation-reject prices the head net — and
>   re-streams into the *same* assistant slot (no duplicate bubble); a reject or a second overflow
>   falls to the normal error path. `_finalize` gets the same one-shot rescue through the same
>   helper (an overflow at wrap-up folds once and re-attempts instead of dying `capped`).
>   Residual: with context-shift *enabled*, llama.cpp may silently truncate instead of erroring
>   — the backstop can't fire, so the deploy note recommends disabling it (see the deploy runbook).
> - **ModelRef is now "pointer + call config"** (A10 lands here). `InferenceClient._call_config` is
>   the one wire builder: `max_tokens` rides under the *serving* endpoint's `max_tokens_field`
>   (`max_tokens` | `max_completion_tokens`); `reasoning_effort` is sent to every backend (llama.cpp
>   drops it silently — verified harmless; cloud honours it) and its `"off"` value additionally
>   merges `chat_template_kwargs: {enable_thinking: false}` *over* the endpoint's `extra_body` for
>   that call only (agent keys win, the config object is never mutated). Modeled params are
>   first-class kwargs on `stream_chat`/`complete`; `extra_body` stays unmodeled-passthrough only.
>   `reasoning_tokens` is declared but v1 ships it **untranslated** (no OpenRouter-shape detection
>   exists — advisory no-op, recorded residual). Both consumers benefit: the agent's own calls *and*
>   the compaction summarizer (capped for free). Rule: never gate behaviour on a param taking effect.

### 5.5 Subagents & orchestration (concurrent, swappable)

Subagents run **concurrently** — the parent can fan out several at once and gather results — under
**structured concurrency** so the whole subtree is awaited and cancelled as a unit. One tool spawns
a *batch*; a single subagent is just a batch of one.

```python
class SpawnInput(BaseModel):
    tasks: list[SubTask]               # batch → run in parallel; len==1 is the single case
    agent: str | None = None           # which AgentDef per task (default: a "worker" agent)

@builtin_tool("spawn_subagents", risk=Risk.MED)        # gated by privilege + depth
async def spawn_subagents(inp: SpawnInput, ctx) -> ToolResult:
    if ctx.depth >= ctx.agent.max_subagent_depth:
        return ToolResult(state=DENIED, summary="max subagent depth reached")
    children = [AgentRunner(resolve_agent(t.agent or inp.agent), deps=ctx.deps,
                            depth=ctx.depth + 1,
                            privilege=min_priv(ctx.privilege))   # never escalate above parent
                for t in inp.tasks]
    results = await orchestrator.run_many(children, inp.tasks, ctx)   # strategy is swappable
    return aggregate(results)          # partial success preserved; per-child errors isolated
```

```python
class Orchestrator(Protocol):
    async def run_many(self, children: list[AgentRunner], tasks: list[SubTask],
                       ctx: InvocationContext) -> list[SubResult]: ...
```

**Default `ParallelOrchestrator` semantics (the nuances):**
- **Bounded parallelism.** A per-agent `max_concurrent_subagents` (e.g. 3) *and* a process-wide
  `global_subagent_limit` semaphore (in `Deps`) cap fan-out so the LLM backend, SSH, and the box
  aren't swamped. The global cap holds **across the whole tree**, not per level.
- **Structured concurrency.** Children run inside one `asyncio.TaskGroup()` (stdlib structured
  concurrency; the doc originally said anyio — the shipped code is asyncio); the group is the
  unit of lifetime — if the parent turn is cancelled (client disconnect; `/cancel`, shipped Slice 3) or one child
  raises a fatal error, the group **cancels all siblings** and unwinds cleanly (no orphans).
- **Isolation + partial results.** Each child gets its **own ephemeral thread id + working set**;
  a child failing yields a `SubResult(state=ERROR)` rather than killing siblings (the group only
  hard-cancels on cancellation/fatal, not on a normal tool/agent error). The aggregate reports
  "3 ok, 1 failed" so the parent model can reason about it.
- **Per-child timeout** (shipped: 180 s per child). *(A batch-total wall-clock budget and a
  per-turn spawned-subagent counter are named-but-unbuilt guards — the shipped bounds are the
  per-child timeout + depth cap + the two semaphores. QH deep pass 2026-07-07.)*
- **Shared-resource fairness.** Subagents reuse the *same* fleet/SSH/ping semaphores from `Deps`,
  so 8 concurrent subagents can't open 8× the SSH connections — global limits are honored tree-wide.
- **Deadlock avoidance.** The parent's **per-thread turn marker** (§10, ▹ ACA Slice 2) covers only
  the *parent's* thread; children use distinct thread ids, so spawning + awaiting children never
  contends with it. The parent `await`s the task group without holding anything a child needs.
- **Streaming.** By default each child surfaces a single summarized `SubResult`; a verbose mode can
  nest child events under a `subagent` SSE channel (off by default to keep the UI legible).

`Orchestrator` and `SkillSelector` are **`Protocol`s with a default impl** (D11) — the concrete
algorithm (sequential vs parallel vs map-reduce, retry/voting, etc.) is decided in Phase 4 with
`RESEARCH.md` prior art; the interface keeps them replaceable.

### 5.6 Skills

```python
class Skill(BaseModel):
    name: str; description: str; instructions: str
    allowed_tools: list[str] | None; resources_dir: Path | None
class SkillProvider(Protocol):
    def list(self) -> list[Skill]: ...           # scans skills/<name>/SKILL.md
class SkillSelector(Protocol):
    def select(self, user_msg: str, skills: list[Skill]) -> list[Skill]: ...  # default: model-picks
```
Selected skills inject their `instructions` into the assembled prompt and may **narrow** the
toolset to `allowed_tools` (never widen beyond the agent's allowlist or privilege).

### 5.7 Capability fallback (weak local models)

If a backend can't do native tool-calling reliably (configurable / probed once), the runner switches
to **prompted JSON**: the model emits a fenced action block, parsed into the same `ToolCallPart`
path → identical downstream handling. Worst case it degrades to draft-into-bubble (the old UX).

---

## 6. Memory (D14/D15 — Hermes file model)

> Replaces the earlier none/file/vector sketch. v1 = **file-based, Hermes-shaped** (D14, D15 #4).
> *Pattern lineage:* the cap-usage headers / `§`-entry / self-curated-file patterns originate in
> **MemGPT (arXiv 2310.08560) → Letta memory blocks**; **Hermes Agent** is the implementation style
> we mirror, not the originator (ACA §0 attribution correction).

```python
class MemoryProvider(Protocol):
    def load_context(self) -> str: ...                          # the injected agent+user block
    async def write(self, target: Literal["memory","user"],
                    action: Literal["add","replace","remove"],
                    content: str, old_text: str | None = None) -> ToolResult: ...  # cap-enforced
    def read_raw(self, target) -> str: ...                      # for the Conf Memory panel
    async def clear(self, target) -> None: ...
# v1 impl: FileMemoryProvider, on Deps.memory.
```

- **Files (under `$CTRLB_HOME`):** per-agent `agents/<name>/memories/MEMORY.md` (default agent →
  root `memories/MEMORY.md`) + a **global** `memories/USER.md`. `memories/` is gitignored.
- **Injection:** `load_context()` output is emitted in `_assemble` **right after the appends**
  (as-built order: SOUL.md → appends → roster → **memory** → core index (D57) → skills → history),
  frozen per turn. Rendered **Hermes-style** — per-section usage header
  (`## Agent memory (67% — 1,474/2,200)`) + `§` between entries (D15 #4).
- **`memory` tool** (builtin, sibling of `skill_manage`): `add`/`replace`/`remove`, `target:
  memory|user`, substring `old_text`, **no read** (memory is in the prompt). **Autonomous auto-write**
  (`memory.auto_write` default ON; OFF → non-blocking *propose*, never gates the turn). Caps
  `memory.memory_char_limit` (2200) / `memory.user_char_limit` (1375) — over-cap raises so the agent
  consolidates (no silent drop). Audited as Events.
- **Recall tier:** `session_search` (FTS5 over `messages`, redacted, global; D15 #7) — *not* a memory
  file. **Vector** = a *future tier-2 backend* behind the D57 slot below (the earlier "both" mode is
  superseded by the tier model), on the SQLite `memory` table + the embeddings client.

### 6.1 Tier 2 — Core Memory (D57; spec of record: [`CORE_MEMORY_PLAN.md`](./CORE_MEMORY_PLAN.md))

> The memory above is **tier 1** (always on, capped, fully injected). **Tier 2** is *one selectable
> long-term backend at a time*; Core Memory is the first: one **shared, Claude-Code-shaped markdown
> corpus** (a `MEMORY.md` routing index + semantic topic files) that is **read on demand**, never
> injected whole. `memory.longterm.backend` (`null` = off, `"core"` = on) is the **only** switch;
> its settings live in `memory.longterm.core` (`root` = `core` under `memories/` → versioned by the
> D26 repo · `index_char_limit` 8192 · `topic_char_limit` 4096 · `recall_char_limit` 20480 ·
> `consolidation_nudge_pct` 80 — all **characters**, all read live, no restart). Off ⇒ prompt
> assembly is byte-identical to tier-1-only.

- **Not a `MemoryProvider`** (no query param, no store keys — the D27 "adding a store" checklist does
  not apply). `CoreMemoryCorpus` (`services/agent/core_memory.py`) is a **sibling subsystem**: one
  lifespan singleton handed to `AgentSession` as a **`core_memory=` kwarg** (both construction sites),
  sharing tier 1's `MemoryBackup.guard()` lock + D26 commits. It owns the recursive scan (tolerant
  frontmatter — top-level wins over nested `metadata.*`), the signature-cached index render/clamp,
  per-operation path confinement, and the CAS writes.
- **Injection:** `_core_index_block()` = the `core_memory_policy` prompt + `render_index()` (the
  clamped, normalized entries under a tier-1-style usage header that names cap pressure at
  `consolidation_nudge_pct`), appended in `_static_prefix` **between the memory block and the skills
  note** — same cache class as memory (memory-adjacent, so a write re-prefills from there on) and
  frozen per turn, so a mid-turn corpus write reaches the model through its *tool result* and the
  head on the next turn.
- **`core_memory` tool** (`services/agent/core_memory_tool.py`, `Risk.LOW`, `core=False`,
  `timeout_s=30`) — six actions: `read(path)` (capped, returns the content hash) · `search(query)`
  (literal case-insensitive grep over bodies + frontmatter) · `create(name, description, type,
  content)` (structured fields; the service renders the frontmatter) · `update(path, old_text,
  new_text)` / `remove(path, old_text)` (exact unique-substring CAS) · `delete(path, content_hash)`.
  Topic content enters as ordinary **tool results** framed by `core_memory_recall` (visible,
  persisted, replay-stable). Mutations honor `memory.auto_write` (off ⇒ steering error) and a
  `Settings.secret_values()` containment gate evaluated over the **complete resulting file**;
  topic+index writes are ordered for idempotent retry, deliberately **not** transactional.
- **Recall budget:** one `RecallBudget` per **logical turn**, owned by the session and threaded onto
  `InvocationContext.recall` through `ActionService.invoke` (exactly like the prompt stamps); every
  read/search adds the length of its *complete framed* output, and a resume re-seeds `used` from that
  turn's persisted core-memory results, so a confirm round-trip is not a fresh allowance.
- **Exposure = two layers:** deny-at-invoke when disabled, plus `for_agent(hidden=…)` applied at both
  the schema set and the availability guard (§3).
- **Promotion (tier-1 cap pressure → tier 2):** the standing routing clause in `core_memory_policy` ·
  the `{{longterm}}` clause (`consolidation_promote`) rendered into tier 1's `consolidation_nudge`,
  latched once per pressure episode per `(agent, store)` on the `FileMemoryProvider` singleton and
  cleared only on a fill drop · `memory_cap_error` resolved at the `memory` tool boundary · and tier
  1's `memory` description / `reflection_nudge` switching to short-horizon wording — each rendered
  only while the tool is effectively available. Curation is an **owner-invoked chat procedure** (the
  `consolidation` prompt id), not a background pass.
- **Conf:** an enable switch (it writes `backend`) + the five `core.*` fields, plus a derived status
  line from `GET /api/memory/core/status` (topics parsed / skipped / anomalies / index fill) — the
  settings GET carries config, never derived data.

---

## 7. Integrations (adapters behind Protocols)

```python
class InferenceClient(Protocol):
    def resolve(self, ref: ModelRef) -> tuple[OpenAI, str]: ...     # client + model id
    async def chat(self, ref, messages, tools=None, stream=True) -> ...: ...
    async def embed(self, ref, texts) -> list[list[float]]: ...
# one OpenAI-compatible client; base_url/key/model per purpose (chat / summarizer / embeddings).
# As-built: the client delegates endpoint failover to `core/failover.failover()` — an async generator
# (D43) that yields live retry/failover control items then the winning `FailoverResult` last. `stream_chat`
# re-yields them as typed RetryNotice/FailoverNotice before the first ChatDelta; buffered callers
# (complete()/embeddings/voice) drain via `failover_collect()`, unchanged. `categorize()` classifies a
# failure (transient/overflow/fatal_for_endpoint/other) — only `transient` earns a bounded same-endpoint
# retry (`inference.retry_attempts`, §5.2); everything else is today's straight next-hop.

class McpClient:                       # manages many servers, both transports
    async def connect_all(self, cfgs: list[McpServerCfg]) -> None: ...  # stdio + Streamable HTTP
    def tools(self) -> list[McpTool]: ...   # namespaced; per-server failures isolated
    # health-checked; a down server marks its tools unavailable (not an agent crash)

class NotificationChannel(Protocol):
    async def send(self, n: Notification) -> None: ...
# impls: ForegroundSSE, WebPush(VAPID), Ntfy, Bot.  NotificationService dispatches to ENABLED
# channels filtered by per-event-type config (F1). De-dupes; failures per-channel are swallowed+logged.
```

---

## 8. Persistence (SQLite)

Tables: `threads`, `messages` (parts as JSON column; **+ a nullable `agent` column**, D15 #5),
`memory` (**reserved for the later vector store — unused in v1**, D14/D15), `events` (**+ the D49
attribution quartet since migration v4: `origin` [immediate initiator, NOT NULL default
`user_chat`] · `origin_id` · `run_id` [the transitive automation-ancestry key] · `decision` [why
the gate allowed/denied]; reads coerce unknown values — `EventOriginKind`'s `unknown` sentinel is
read-side only**), `automations`,
`push_subscriptions`, `pending_actions` (for suspended confirms / notify-park), `schema_version`.
Migration application is **atomic per migration** (script + version stamp in one explicit
transaction composed inside the script text; migrations author DDL/DML only — the runner owns
transaction control, pinned by a statement-aware invariant test).
A **`messages_fts` FTS5 virtual table** (+ sync triggers) backs `session_search`, indexed over
**redacted** message text, covering live **and** compacted rows (D15 #7).

```python
class UnitOfWork:                      # one place that owns the connection + write serialization
    # WAL mode; ONE shared aiosqlite connection (its worker thread serializes all ops, so WAL's
    # read concurrency is currently unused — SYS-1 rider); ALL writes also take a single asyncio.Lock
    # to avoid SQLITE_BUSY under async fan-out. Repositories hang off the UoW.
    threads: ThreadRepo; messages: MessageRepo; events: EventRepo
    memory: MemoryRepo; automations: AutomationRepo
```

Migrations: numbered `schema.sql` blocks applied in order, tracked in `schema_version`. No ORM —
hand-written SQL is enough at this scale and keeps the dep surface small (D2).

---

## 9. Config & secrets

```python
# config.py — pydantic-settings, source = config.yaml (+ env overrides)
class Settings(BaseSettings):
    inference: InferenceCfg; embeddings: EmbeddingsCfg
    stt: SttCfg; tts: TtsCfg; searxng: SearxngCfg
    mcp_servers: list[McpServerCfg] = []
    agent: AgentCfg; agents: list[AgentDef] = []
    hosts: list[Host] = []; services: list[Service] = []
    server: ServerCfg; appearance: AppearanceCfg
    notifications: NotificationsCfg
```
> **Reconciliation (D14/D15 + shipped):** **no `agents: list[AgentDef]`** — agents are folders
> (D15 #3); `AgentCfg` gains **`defaults`** (the AgentDef-shaped inheritance base, D15 #1). Add
> **`memory`** (`enabled`/`user_profile_enabled`/`auto_write`/`memory_char_limit`/`user_char_limit`)
> and **`skills`** (`enabled`/`auto_write`). `hosts`/`services` aren't flat lists — they're **nested
> under `computers{}`** in YAML and projected by `Settings.hosts()`/`services()`. **`stt`/`tts`
> shipped nested inside `voice:`** (`VoiceCfg`, Phase 6); **`notifications` doesn't exist yet** (F1).
> Shipped sections the sketch above omits (the real `Settings` has 15): `memory`, `voice`,
> `open_terminal`, `shell`, `tailscale`, `openapi_servers`, `tool_overrides` (D22), `computers`.
> Path resolution is rooted at **`$CTRLB_HOME`** (D15 #2). The hybrid secrets model below is
> accurate and shipped (7a).
> **New tunables (Slices 4/5):** `AgentDef.max_parallel_tools` (default 4; `1` = off — the D40
> parallel read-only tool prefix) · `ProviderCfg.max_concurrent_requests` (`None` = unlimited — the
> per-server request gate for a non-queuing llama.cpp, D40 rider as re-homed by D48 §C4) ·
> `TurnsCfg.steer_queue_max` (default 8 — per-thread steer-queue depth, D41) · `ToolSpec.suspending`
> (marks a confirm/question tool prefix-**ineligible**, D40).
- **Secrets model = hybrid (decided Phase 0).** `config.yaml` is the **single UI-managed source
  of truth, including nested secrets** (per-host SSH creds, per-endpoint API keys, per-MCP-server
  env/headers) — because they're structured/repeating and the Conf tab edits + round-trips them,
  which a flat `.env` can't do. A `.env` file adds a **bootstrap + override** layer:
  - **Bootstrap knobs** the UI never edits: `CTRLB_CONFIG`, `CTRLB_DB`, `CTRLB_ENV` (paths).
  - **Optional scalar overrides** `CTRLB_<SECTION>__<KEY>` that **win over** `config.yaml`
    (e.g. `CTRLB_SERVER__PORT`, `CTRLB_TAILSCALE__TARGET_PORT`). **One level only, declared fields
    only** — it cannot reach a provider credential (`providers.<name>.api_key`), and an undeclared
    path is warned about at startup rather than silently ignored (UPDATE_PLAN slice 3). Keeping a
    credential out of the YAML is therefore **not** supported: secrets live in `config.yaml` (0600,
    gitignored, UI-managed). The designed seam if that ever changes is an explicit `api_key_env:`
    field on the provider, resolved at the registry — [`ROADMAP.md`](./ROADMAP.md) §I2, evidence in
    [`research/R6`](./research/R6-env-overrides-and-secret-provenance.md). `.env` is operator-owned;
    the app **never rewrites it** (only `config.yaml`).
  Real environment variables take precedence over `.env`. Templates: `config.example.yaml` +
  `.env.example` (both committed, commented, no real secrets).
- Secrets are `SecretStr`; `GET /api/settings` returns them **masked** (`"sk…34"`); a `PUT`
  leaves a field unchanged if it's the masked sentinel (so editing other fields can't wipe a key).
- **Atomic writes**: write `config.yaml.tmp` then `os.replace`. Validate before persisting; reject
  with field-level errors. A successful `PUT` triggers a **hot reload** (rebuild affected
  singletons: clients, MCP connections, registries) without a restart where feasible.

---

## 10. Concurrency model

- **Status fan-out**: `asyncio.gather` over hosts with a `Semaphore` + per-host `timeout`; one slow
  host can't stall the fleet. Results cached briefly (`poll_seconds`) so N clients share one sweep.
- **Blocking libs** (paramiko, wakeonlan, `subprocess`): `run_in_executor` / `anyio.to_thread`.
  `run_shell` uses `asyncio.create_subprocess_exec` with a kill-on-timeout.
- **Per-thread serialization (shipped).** One turn owns a thread at a time via a per-thread turn
  marker (D38); a second chat message or `!exec` to a busy chat/resume thread **steers** — it is
  enqueued (**202**, capped by `TurnsCfg.steer_queue_max`) instead of the old 409 (D41/Slice 5) and
  drained at the running turn's loop top (Drain A) or, on a `completed` turn end, spawns the next turn
  (Drain B). Sync kinds (plan/apply/compact) and a queue over the cap still get the 409. No tool calls
  ever interleave.
- **Parallel read-only tool prefix (shipped, D40/Slice 4).** Within one tool batch, a leading run of
  builtin-authored `read_only`, non-`suspending`, ALLOW-gated calls dispatches concurrently under
  `asyncio.Semaphore(AgentDef.max_parallel_tools)` (default 4; `1` = off); the rest run serially. No
  **mutating** call ever runs before a prior call completes — invariant across every privilege incl.
  `FULL`. MCP/OpenAPI tools are prefix-ineligible (derived, advisory annotations).
- **Per-server request gate (shipped, D40 rider; re-homed by D48 §C4).** `ProviderCfg.
  max_concurrent_requests` (`None` = unlimited) caps in-flight requests to a backend that doesn't
  queue (the owner's llama.cpp has 1–2 slots). The gate identity is a **server**, not a provider:
  the key is `(gate_identity, limit)` where `gate_identity = canonical_base_url(...)` (scheme+host
  lowercased, default ports elided, trailing slash stripped, **path preserved**), so aliased URLs of
  one box share ONE gate while two providers at different base_urls never contend. Providers sharing
  a gate identity must declare the same cap (`None ≠` any finite value): a strict PUT 422s the
  conflict, lenient boot warns and takes min-of-finite. It is acquired at **three** chokepoints —
  chat, voice (`voice.attempt`) and embeddings — each holding the permit for the whole streamed
  response and releasing it **before** any tool / subagent runs (no hold-and-wait → no deadlock at
  limit 1). **The WAIT is bounded for the two buffered sections** (D48 amendment 2026-07-27): the
  acquire happens *inside* the failover attempt, so an unbounded one cannot fail over
  (`EndpointGates.hold(target, wait_s=…)`, raising `GateWaitTimeout`, which the chain treats as a failed
  hop). **The budget is short only while there is somewhere to advance to** — voice waits
  `connect_timeout_s` on a hop that has a next hop and `timeout_s` on the last one, where failing fast
  converts a slow success into a failure and buys nothing; embeddings has no connect budget, so the rule
  collapses to `timeout_s` everywhere. Chat waits unbounded on purpose: queueing behind the previous
  turn on the same box is the correct behaviour there. Two consequences worth knowing: the gate wait and
  the SDK timeout are **sequential** (neither is a total wall-clock budget), and raising a voice
  `connect_timeout_s` to tolerate a slow server now also lengthens how long it will queue. The gates live in an **app-owned `EndpointGates` registry** shared across `set_inference`
  client rebuilds, so a mid-turn settings PUT can't split the cap across generations (same
  `(gate_identity, limit)` → the same semaphore; a changed limit mints a fresh gate and old holders
  drain on the old one).
- **Subagent concurrency**: parent fans out children inside one `asyncio.TaskGroup` (structured
  concurrency) under a per-agent cap **and** a process-wide `global_subagent_limit` semaphore;
  children run on distinct ephemeral thread ids (so the parent's per-thread turn marker — ▹ Slice 2
  — can't deadlock the fan-out) and reuse the shared fleet/SSH/inference semaphores so global
  limits hold tree-wide.
  Cancelling the parent cancels the whole subtree. (Full nuances in §5.5.)
- **SQLite**: WAL + single write-lock (§8).
- **Cancellation (shipped, ACA Slice 3, D39).** The turn task is cancellable via
  `POST /api/agent/turns/{id}/cancel` (idempotent, single-fire latch); a client disconnect only
  detaches a subscriber. A cancel reconciles the in-flight call to `cancelled` and persists a terminal
  marker; a `Stop` additionally **harvests** the thread's steer queue back to the caller (D41), so it
  can neither auto-run nor lose a queued steer.

---

## 11. Error handling & result taxonomy

- **Expected, user-facing outcomes** → a `ToolResult` with `state ∈ {ERROR, DENIED, TIMEOUT}` and a
  clear `summary`. These are *data*, not exceptions (the agent reads them and can react).
- **Exceptions** (`core/errors.py`): `UnknownTool`, `ValidationFailed`, `BackendUnavailable`,
  `McpServerError`, `ConfigError` — caught at the service boundary, converted to a `ToolResult` or
  an HTTP error + an `ErrorPart`/SSE `error` event. Nothing leaks a stack trace to the client.
- **Backend 5xx / network**: the `InferenceClient` failover chain walks endpoints on any error; a
  genuinely-**transient** chat-stream init failure (`categorize` = 429/503/`Retry-After`/llama.cpp busy)
  gets a bounded, wire-visible same-endpoint retry first (`inference.retry_attempts`, fixed backoff curve —
  D43), then hops. On chain exhaustion → an `InferenceError`/`BackendUnavailable` → friendly chat error,
  turn ends recoverably. `complete()`/voice keep straight next-hop (no retry tier).
- **Redaction** (`core/redact.py`) runs on every `output`, `summary`, log line, and SSE payload.

---

## 12. SSE wire protocol (chat + events)

`POST /api/agent/chat` (or `/threads/{id}/stream`) emits ordered, id'd events the client reduces into
the message list:

```
event: message.start      data: {messageId, role, agent}       # agent = resolved AgentDef name (7e-c)
event: reasoning.delta    data: {messageId, delta}             # thinking-model CoT (rendered dimmed)
event: text.delta         data: {messageId, delta}
event: part.added         data: {messageId, part}              # a tool_call part → command bubble
event: tool.permission    data: {callId, tool, args, risk, token, prompt, alwaysEligible}  # confirm bubble; single-use token; alwaysEligible gates the "always" grant (D44)
event: tool.question      data: {callId, tool, question, args} # A2 `question` builtin → answer bubble
event: tool.result        data: {callId, result}               # per-call; under the parallel prefix arrives in COMPLETION order (persistence keeps model order)
event: steer.applied      data: {entryId, messageId, kind, text?}  # a mid-turn steer drained at the loop top (D41); text = message kind only, folded into turn.sync as steers[]
event: notice             data: {text}                         # breadcrumbs: "// compacting…" (ACA-11) · routing notes (D43)
event: inference.retry    data: {endpoint, attempt, max, delaySeconds, category}  # a transient same-endpoint retry, live (D43/A6)
event: inference.failover data: {from, to, category}           # the chain dropped to the next endpoint, live (D43/A6; supersedes the D18 degraded notice)
event: compaction         data: {removed, summaryId, truncated}
event: message.end        data: {messageId}
event: error              data: {message, retryable}
event: done               data: {threadId, state}              # completed | suspended | capped | error
```

Plan updates have **no dedicated event** — they ride the `task_plan` tool's `tool.result` (manual
edits go through `POST /api/agent/plan`). This inventory mirrors `session.py`'s emitter docstring —
keep the two in lockstep when adding events.

**Shipped (ACA Slice 3/5, D39/D41):** every frame carries a monotonic `id: turn_id:seq` cursor, so a
reconnect **replays** missed events (tail-replay from the ring, or a `turn.sync` snapshot for a cold
join). The durable-turn REST surface: `GET /api/agent/turns/{id}` (status probe — every branch
carries the thread's `steer_queue`), `GET /api/agent/turns/{id}/stream` (re-attach),
`POST /api/agent/turns/{id}/cancel` (idempotent Stop; the response carries the **harvested**
`steer_queue`), and `DELETE /api/agent/turns/{id}/steer/{entry_id}` (unsend a still-queued steer →
`{removed}`). Sending during a live chat/resume turn returns **202** `{queued, turn_id, entry_id,
position, depth}` (both `POST /api/agent/chat` and `POST /api/exec`), not the old 409 (D41).
`GET /api/events/stream` (fleet activity) is a separate feed off the EventBus.

---

## 13. Frontend data & state (TS)

> **Visual fidelity is fixed (D7):** this section governs *data/state only*. The rendered UI must
> be a **pixel-exact port of `design/prototypes/variations/vapor.html`** — CSS lifted verbatim, same
> fonts/colors/animations/components/themes, verified side-by-side at phone width. State plumbing
> never justifies deviating from the prototype's look. See `ARCHITECTURE.md` §5 + `DECISIONS.md` D7.

```ts
// types mirror the domain; generated from OpenAPI where practical
type Part = TextPart | ToolCallPart | ToolResultPart | QuestionPart | PlanPart | ErrorPart;
interface Message { id:string; role:Role; parts:Part[]; ts:string; }
```
- **Server state** via TanStack Query. Query keys: `['hosts']`, `['hosts',id,'status']`,
  `['services']`, `['tools']`, `['threads']`, `['thread',id,'messages']`, `['settings']`,
  `['events']`. Status polls at `poll_seconds`; mutations (`useWakeHost`, `useRunTool`) invalidate.
- **Chat streaming** is *not* Query — a dedicated SSE reducer appends/patches parts by id into the
  active thread cache; confirm/question parts render interactive controls that POST back.
- **UI-only state** (zustand): `activeTab`, `theme`, `skyline`, `ttsAuto`, `activeThread`,
  composer draft — persisted to `localStorage`, mirrored to `settings.appearance`.
- **Optimistic** wake/stop with rollback on error; **confirm dialog** before high-risk mutations.

---

## 14. End-to-end flows

**Fleet status:** client polls `GET /api/hosts` → `FleetService.status()` fan-out (gather+sem+timeout)
→ `HostStatus[]` (cached) → rows re-render; the hero "now monitoring" picks the featured host.

**UI action (shutdown):** button → confirm dialog → `POST /api/tools/shutdown_host` `{host_id}` →
`decide()` = CONFIRM → server returns `{needs_confirm, token}` → client confirms → re-POST w/ token →
execute → `ToolResult` + `Event` (→ activity SSE) → row updates.

**Agent chat turn:** `POST /api/agent/chat {threadId, text}` → `AgentSession.run_turn` streams SSE
(§12). If the model calls `shutdown_host`: `tool.permission` event → bubble → user confirms via
`resume` → `tool.result` → model summarizes → `message.end`/`done`. If tokens spike mid-thread →
`compaction` first. If the model needs info → `tool.question` → user answers → resume.

**"Always allow" grant (D44, Slice 8):** the `tool.permission` frame carries `alwaysEligible`
(`ActionService.approval_eligible`) → the bubble renders an **always** action beside allow/deny →
`POST /api/agent/resume {decision:"execute_always"}` → the resume branch calls
`runtime.grant_approval` (validate args → `exact_arg_pins` → append to
`tool_overrides[tool].approvals` under `settings_write_lock` via `apply_settings_patch` → persist +
`reconfigure`) → the call then runs exactly as `execute`. The rule is live *before* that execute, so
`invoke` re-consults it and the run's own `Event.summary` already carries `[auto-allowed: …]`
(benign — the run is both human-confirmed and now approval-covered). Every later identical call skips
the bubble. Management: `GET /api/actions` carries each tool's live `approvals` list, and Conf → Tools
(`ToolCatalog`) lists / revokes / widens them through the one `useSaveToolOverrides` write.

**Voice:** push-to-talk → `MediaRecorder` blob → `POST /voice/stt` → text fills composer → normal
chat turn → if auto-TTS, each finalized assistant text → `POST /voice/tts` → audio playback.

**Automation:** scheduler fires → `AgentSession` with `interactive=False`, the automation's agent +
privilege → gated calls hit notify-park/fallback → results to a thread + Event → optional F1 notify.

---

## 15. Edge cases & nuances (checklist to honor)

- **Fleet:** host offline / DNS fail (status `error`, not crash); WOL with `mac=None` → DENIED;
  WOL to an already-on host (idempotent, report no-op); SSH auth fail / unknown host key / timeout →
  typed `ToolResult`; partial fleet (some pings time out) still returns the rest.
- **run_shell:** kill on timeout (terminate process tree); **truncate** huge output (head+tail, note
  bytes elided); redact secrets; per-OS shell (`cmd`/`pwsh` vs `bash`); never a detached GUI window.
- **Agent:** malformed tool args → error result fed back for self-correction; call to
  unknown/disabled tool → DENIED with reason; **multiple** tool calls per step; tool exception vs
  tool error-result both normalized; `max_iterations` cap → graceful stop; **context overflow
  mid-turn** → compact then retry once; streaming-unsupported backend → buffered fallback; backend
  down → bounded retry then friendly error; **duplicate/parallel user messages** to one thread →
  **202 steer-enqueue** then drained at the loop top / turn end (shipped, ACA Slices 2/5, D38/D41);
  client disconnect → completed **and remaining** steps persist; **full turn survival + replay**
  shipped (ACA Slice 3, D39).
- **Confirm/question:** stale confirm (host/world changed since proposal) → re-validate at execute,
  re-confirm if drifted; confirm token single-use + TTL; headless + needs-input → notify-park or
  fallback, with a max wait then auto-skip.
- **Compaction (D42):** summarizer backend down / transcript won't fit the summarizer window →
  truncation fallback; a fold that wouldn't shrink the live context → inflation-reject (no write);
  repeated rejects latch a per-thread breaker (one notice; manual `/compact` resets); never lose DB
  history; two floors (recent messages + `keep_recent_tokens`) plus suspend/`task_plan`/user-boundary
  snaps keep the tail intact.
- **Subagents (concurrent):** bounded parallelism (per-agent + global semaphore, tree-wide); depth
  **and** breadth limits + total-spawn counter to prevent fan-out explosion; **structured
  concurrency** (one task group → parent cancel cancels all children, no orphans); one child's
  failure is isolated (partial results aggregated, siblings continue); per-child timeout + batch
  wall-clock budget; no privilege escalation beyond parent; result size cap; cycle guard; children
  share the parent's resource semaphores (no SSH/connection multiplication); distinct child thread
  ids to avoid per-thread-lock deadlock.
- **MCP:** server slow/down → per-call timeout + tools marked unavailable (agent informed, not
  broken); **tool-name collisions** across servers → namespacing; arg schema drift → validate.
- **Memory:** UI edit vs agent write race → file lock; vector store unavailable → degrade to file/none.
- **Settings:** masked-secret sentinel preserves keys on PUT; invalid config rejected pre-write;
  backend switched mid-stream → applies next turn, current turn finishes on the old client.
- **Time:** store **UTC**; format client-side. **IDs**: slugs/uuids, never display names.
- **Automations:** overlapping schedules → skip if previous run still active (or queue, configurable).
- **Secrets:** central redaction on outputs/logs/SSE; SSH passwords/keys never in `Event.output`.

---

## 16. Extension cookbook (how to add a feature)

| Add a… | Do this |
|---|---|
| **Action** | new fn in `services/actions/` with `@action(name, risk, confirm, ui_exposed)` + an input `BaseModel`. Auto: endpoint, UI button, agent tool, events. |
| **Utility tool** | `@tool(name, title, icon)` in `services/tools/` + input model. Auto: `/api/tools/{name}`, Utils card, agent tool. |
| **Built-in agent tool** | register a `Tool` (e.g. `task_plan`); appears in the toolset, gated by privilege. |
| **MCP server** | add an entry to `settings.mcp_servers`; `McpClient` connects + wraps its tools. Zero code. |
| **Skill** | drop `skills/<name>/SKILL.md` (+ resources). Discovered automatically. |
| **Agent** | create a folder `$CTRLB_HOME/agents/<name>/` (`agent.yaml` + `SOUL.md`) — discovered automatically, **folder-only, no config list** (D14/D15); selectable per chat/automation; usable as a subagent. |
| **Memory backend** | implement `MemoryProvider`, register under a key; select in settings. |
| **Long-term (tier-2) memory backend** | one new `memory.longterm.backend` value + its nested cfg object beside `core` (D57 §6); the slot's interface is what the loop consumes — a static-head block + a tool surface — formalized only when backend #2 is real. |
| **Notification channel** | implement `NotificationChannel`, register; toggle in settings. |
| **Inference/STT/TTS/embeddings backend** | it's just another OpenAI-compatible `base_url` in settings — no code. |
| **Strategy swap** (skill-select / orchestration) | implement the `Protocol`, register, select in settings. |

Each row touches **one file + config** — the property the owner asked for, enforced by the
registry/Protocol design rather than hoped for.

---

## 17. Open design questions (deferred to their phase)

- ✅ **Resolved — skill-selection**: shipped as `KeywordSkillSelector` (token overlap, model-agnostic);
  the `SkillSelector` Protocol keeps an LLM selector a drop-in. **Subagent orchestration**: shipped as
  `ParallelOrchestrator` (asyncio.TaskGroup + semaphores).
- ✅ **Resolved — tokenizer**: the char/4 heuristic remains the fallback, but D42 (Slice 6) anchors
  the estimate on the backend's real **total prompt tokens** telemetry when available (no
  model-specific tokenizer dep); see §5.4.
- ✅ **Resolved — plan persistence**: the latest `task_plan` call **rides the message history** (no
  `plans` table); reload + the model's context recover it.
- ⏳ **AgentSelector auto-rotate algorithm** (D15 #8) — seam locked (off-by-default `agent.auto_rotate`,
  `KeywordAgentSelector` default lean); concrete algorithm decided at the 7e-g build.
- ⏳ **Real idle detection** mechanism for D1 (helper agent vs heuristic) — still the hard one.
- ⏳ **OpenAPI→TS** type generation vs hand-written types.
