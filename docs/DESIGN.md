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

### Permission policy (pure)

```python
# core/permissions.py
class Decision(StrEnum): ALLOW="allow"; CONFIRM="confirm"; DENY="deny"

def decide(spec: ToolSpec, privilege: Privilege, *, interactive: bool,
           run_shell_allowed: bool) -> Decision:
    if spec.name == "run_shell" and not run_shell_allowed and privilege != Privilege.FULL:
        return Decision.DENY
    if privilege == Privilege.READONLY and spec.category in ("action",) and spec.risk != Risk.LOW:
        return Decision.DENY
    if spec.confirm or spec.risk == Risk.HIGH:
        return Decision.CONFIRM if privilege != Privilege.FULL else Decision.ALLOW
    if spec.risk == Risk.MED:
        return Decision.ALLOW if privilege in (Privilege.AUTO_LOW, Privilege.FULL) else Decision.CONFIRM
    return Decision.ALLOW   # low risk
```

Headless (`interactive=False`): `CONFIRM` becomes **notify-and-park** (F1) or the automation's
fallback (skip / default), never an interactive prompt.

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

class ModelRef(BaseModel): mode: Literal["local","cloud"]; model: str
```

`AgentSession` (shipped name; the sketch says `AgentRunner`) is constructed per turn from an
`AgentDef`. Subagents reuse the same machinery at greater depth.

> **Updated by D14/D15 (2026-06-14).** The `AgentDef` above is illustrative; the shipped + folder
> shape: agents are **folders** (`$CTRLB_HOME/agents/<name>/`), not `settings.agents` entries —
> **there is no `agents:[]` list**. `agent.yaml` = `AgentDef` **minus `name`** (= folder) and **minus
> `prompt`** (= `SOUL.md`), carrying **only overrides**; absent fields inherit a `config.yaml`
> **`agent.defaults`** block via `deep_merge` (D15 #1). The **default agent** has no folder/`agent.yaml`
> — it's the root + `config.yaml` globals. There is **no `AgentDef.memory` field** (memory is the file
> model, §6); real fields include `prompt_append`/`inherit_append` (7e-a), `compaction`, the loop
> guards (`max_repeat_calls`/`max_calls_per_tool`/`max_stall_iterations`), and `max_iterations=16`.
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

### 5.3 Suspension & resumption (the nuance that makes it robust)

A turn can **suspend** (awaiting confirm or an answer). The session state persists in the DB, so:
- ▹ *Target (ACA Slice 3/5):* the SSE stream can drop and **reconnect**, replaying from the last
  event id. *Today:* no event ids are emitted and a dropped stream cancels the in-flight step
  (ACA-1); persisted state re-reads via `GET /api/threads/{id}/messages`.
- The user can navigate away / close the PWA; the pending state lives in the thread.
- Resumption is a normal API call (`POST /threads/{id}/resume` with the confirm-token or the
  answer) that re-enters `run_turn` from the suspended point.
- **Headless** automations never suspend interactively: a gated call triggers notify-and-park
  (write a pending record + fire F1) or the automation's fallback policy.

### 5.4 Compaction

```python
class Compactor(Protocol):
    async def compact(self, msgs: list[Message], budget: Tokens,
                      summarizer: ModelRef) -> CompactionResult: ...
# default impl: summarize the oldest run of messages with the SELECTED summarizer model (D11),
# keep the last N verbatim, store the summary as Memory(kind=summary) + a system message.
# Failure → fall back to head/tail truncation; NEVER drop DB history (only flips `compacted`).
```

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
  unit of lifetime — if the parent turn is cancelled (client disconnect; `/cancel` ▹ Slice 3) or one child
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
  (order: SOUL.md → appends → **memory** → roster → skills → history), frozen per turn. Rendered
  **Hermes-style** — per-section usage header (`## Agent memory (67% — 1,474/2,200)`) + `§` between
  entries (D15 #4).
- **`memory` tool** (builtin, sibling of `skill_manage`): `add`/`replace`/`remove`, `target:
  memory|user`, substring `old_text`, **no read** (memory is in the prompt). **Autonomous auto-write**
  (`memory.auto_write` default ON; OFF → non-blocking *propose*, never gates the turn). Caps
  `memory.memory_char_limit` (2200) / `memory.user_char_limit` (1375) — over-cap raises so the agent
  consolidates (no silent drop). Audited as Events.
- **Recall tier:** `session_search` (FTS5 over `messages`, redacted, global; D15 #7) — *not* a memory
  file. **Vector** ("both" mode) = the SQLite `memory` table + the embeddings client, a later drop-in.

---

## 7. Integrations (adapters behind Protocols)

```python
class InferenceClient(Protocol):
    def resolve(self, ref: ModelRef) -> tuple[OpenAI, str]: ...     # client + model id
    async def chat(self, ref, messages, tools=None, stream=True) -> ...: ...
    async def embed(self, ref, texts) -> list[list[float]]: ...
# one OpenAI-compatible client; base_url/key/model per purpose (chat / summarizer / embeddings).

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
`memory` (**reserved for the later vector store — unused in v1**, D14/D15), `events`, `automations`,
`push_subscriptions`, `pending_actions` (for suspended confirms / notify-park), `schema_version`.
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
- **Secrets model = hybrid (decided Phase 0).** `config.yaml` is the **single UI-managed source
  of truth, including nested secrets** (per-host SSH creds, per-endpoint API keys, per-MCP-server
  env/headers) — because they're structured/repeating and the Conf tab edits + round-trips them,
  which a flat `.env` can't do. A `.env` file adds a **bootstrap + override** layer:
  - **Bootstrap knobs** the UI never edits: `CTRLB_CONFIG`, `CTRLB_DB`, `CTRLB_ENV` (paths).
  - **Optional scalar overrides** `CTRLB_<SECTION>__<KEY>` that **win over** `config.yaml`
    (e.g. `CTRLB_INFERENCE__CLOUD_KEY`) — so a key *can* be kept out of the YAML without breaking
    the UI. `.env` is operator-owned; the app **never rewrites it** (only `config.yaml`).
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
- **Per-thread serialization** ▹ *target (nothing built today — ACA-2; Slice 2 ships an interim
  409 turn-marker, Slice 5 the steer queue)*: a second message to a thread mid-turn is **queued**
  behind the active turn — no interleaved tool calls.
- **Subagent concurrency**: parent fans out children inside one `asyncio.TaskGroup` (structured
  concurrency) under a per-agent cap **and** a process-wide `global_subagent_limit` semaphore;
  children run on distinct ephemeral thread ids (so the parent's per-thread turn marker — ▹ Slice 2
  — can't deadlock the fan-out) and reuse the shared fleet/SSH/inference semaphores so global
  limits hold tree-wide.
  Cancelling the parent cancels the whole subtree. (Full nuances in §5.5.)
- **SQLite**: WAL + single write-lock (§8).
- **Cancellation** ▹ *target (ACA Slice 3, D35 proposed)*: each turn/tool runs in an
  `anyio.CancelScope`; client disconnect or a `POST /threads/{id}/cancel` cancels cleanly,
  persisting a `cancelled` marker. *Today:* disconnect just cancels the SSE generator mid-step;
  there is no cancel endpoint and no `cancelled` marker (ACA-1).

---

## 11. Error handling & result taxonomy

- **Expected, user-facing outcomes** → a `ToolResult` with `state ∈ {ERROR, DENIED, TIMEOUT}` and a
  clear `summary`. These are *data*, not exceptions (the agent reads them and can react).
- **Exceptions** (`core/errors.py`): `UnknownTool`, `ValidationFailed`, `BackendUnavailable`,
  `McpServerError`, `ConfigError` — caught at the service boundary, converted to a `ToolResult` or
  an HTTP error + an `ErrorPart`/SSE `error` event. Nothing leaks a stack trace to the client.
- **Backend 5xx / network**: bounded retry w/ backoff in `InferenceClient`; on exhaustion →
  `BackendUnavailable` → friendly chat error, turn ends recoverably.
- **Redaction** (`core/redact.py`) runs on every `output`, `summary`, log line, and SSE payload.

---

## 12. SSE wire protocol (chat + events)

`GET /api/agent/chat` (or `/threads/{id}/stream`) emits ordered, id'd events the client reduces into
the message list:

```
event: message.start      data: {messageId, role, agent}       # agent = resolved AgentDef name (7e-c)
event: reasoning.delta    data: {messageId, delta}             # thinking-model CoT (rendered dimmed)
event: text.delta         data: {messageId, delta}
event: part.added         data: {messageId, part}              # a tool_call part → command bubble
event: tool.permission    data: {callId, tool, args, risk, token, prompt}  # confirm bubble; single-use token
event: tool.question      data: {callId, tool, question, args} # A2 `question` builtin → answer bubble
event: tool.result        data: {callId, result}
event: notice             data: {text}                         # breadcrumbs (e.g. D18 failover)
event: compaction         data: {removed, summaryId, truncated}
event: message.end        data: {messageId}
event: error              data: {message, retryable}
event: done               data: {threadId, state}              # completed | suspended | capped | error
```

Plan updates have **no dedicated event** — they ride the `task_plan` tool's `tool.result` (manual
edits go through `POST /api/agent/plan`). This inventory mirrors `session.py`'s emitter docstring —
keep the two in lockstep when adding events.

▹ *Target (ACA Slice 3/5, D35 proposed):* every event carries a monotonic id (app-level
`turn_id:seq` cursor) so reconnect **replays** missed events. *Today:* no `id:` field is emitted —
a dropped chat stream is not replayable (ACA-1). `GET /api/events/stream` (fleet activity) is a
separate feed off the EventBus.

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
  ▹ 409-guard then steer-queue (ACA Slices 2/5; unguarded today); client disconnect → completed
  steps persist; ▹ full turn survival + replay is ACA Slice 3 (today the in-flight step cancels).
- **Confirm/question:** stale confirm (host/world changed since proposal) → re-validate at execute,
  re-confirm if drifted; confirm token single-use + TTL; headless + needs-input → notify-park or
  fallback, with a max wait then auto-skip.
- **Compaction:** summarizer backend down → truncation fallback; never lose DB history; don't
  compact below a floor of recent turns.
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
- ✅ **Resolved — tokenizer**: a **heuristic char/4 estimate** is used for compaction budgeting (no
  model-specific tokenizer dep).
- ✅ **Resolved — plan persistence**: the latest `task_plan` call **rides the message history** (no
  `plans` table); reload + the model's context recover it.
- ⏳ **AgentSelector auto-rotate algorithm** (D15 #8) — seam locked (off-by-default `agent.auto_rotate`,
  `KeywordAgentSelector` default lean); concrete algorithm decided at the 7e-g build.
- ⏳ **Real idle detection** mechanism for D1 (helper agent vs heuristic) — still the hard one.
- ⏳ **OpenAPI→TS** type generation vs hand-written types.
