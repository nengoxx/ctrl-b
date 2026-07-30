# R8 — How peer apps let scheduled automations be **authored and managed** (agent-self-creation · edit UI · record shape · results surface)

**Date:** 2026-07-30 · **Bought for:** the **A3** design conversation (`ROADMAP.md` §A3, lines 116–128;
`HANDOFF.md` item 2) · **Method:** one bounded Opus 5 (high) pass. Peer sources read at HEAD on
2026-07-30 via the GitHub contents API (no clones needed — see §0 for the exact SHAs). Claude Code's
contract was read out of the **installed binary** (`strings` over
`~/.local/share/claude/versions/2.1.220`) — first-party, not a leak. ChatGPT's tool contract comes
from published system-prompt archives + `learn.chatgpt.com`, marked accordingly.

**Reference class:** ChatGPT Tasks/automations · Claude Code (`CronCreate` + `/schedule` routines) ·
open-webui · AnythingLLM · goose · Codex CLI · LibreChat · opencode · Continue.dev.

**Explicitly out of scope (a separate agent has it):** the scheduler *mechanism* — APScheduler vs a
hand-rolled loop, cron parsing libraries, misfire/catch-up policy. Where a mechanism detail is
unavoidable to explain an *authoring* decision (e.g. `next_run_at` being a persisted field, or the
`claim_due` write that makes it safe) it is noted and flagged as adjacent.

**Drove:** the A3 design conversation. No D-entry yet — link one back here when A3 locks.

---

## 0. Provenance (what "HEAD" means here)

| Project | HEAD SHA read | HEAD date |
|---|---|---|
| open-webui/open-webui | `01f4282f` | 2026-07-27 |
| Mintplex-Labs/anything-llm | `a3c9a262` | 2026-07-29 |
| aaif-goose/goose *(the repo `block/goose` now redirects to)* | `2694fff7` | 2026-07-30 |
| openai/codex | `5decb399` | 2026-07-30 |
| danny-avila/LibreChat | `f7bc50ae` | 2026-07-28 |
| sst/opencode | `ff0382e9` | 2026-07-30 |
| continuedev/continue | `5522c6f4` | 2026-07-21 |
| Claude Code | installed build **2.1.220** | 2026-07-25 |

---

## 1. Does the peer have the feature at all?

| Project | User-authored scheduled automations | Agent can create them | Management UI | Conf. |
|---|---|---|---|---|
| **ChatGPT (Tasks / automations)** | **YES** — "Scheduled" view | **YES** — `automations.create/update/list`; skills can too | Yes (web) | REPORTED |
| **Claude Code — local cron** | No form; **only** via the agent's tool (or hand-editing `.claude/scheduled_tasks.json`) | **YES** — `CronCreate`/`CronDelete`/`CronList` | No — `CronList` output only | **VERIFIED** |
| **Claude Code — remote routines** | YES (claude.ai `/code/routines`) | **YES** — `RemoteTrigger` (create/update/run, **no delete**) | Yes (web only) | **VERIFIED** |
| **open-webui** | **YES** — `/automations` route + folders | **YES** — 5 builtin tools (`create/update/list/toggle/delete_automation`) + a separate one-shot `timer` | Yes | **VERIFIED** |
| **AnythingLLM** | **YES** — Settings → Scheduled Jobs | **YES** — `create-scheduled-job` agent skill (**create only**) | Yes, incl. run history + run detail | **VERIFIED** |
| **goose** | **YES** — Desktop `SchedulesView`/`ScheduleModal` + `goose schedule` CLI | **YES** — one `platform__manage_schedule` tool, 10 actions | Yes (Desktop) | **VERIFIED** |
| **Codex CLI** | **NO** — `scheduled_tasks` exist only as a **plugin-manifest field** (suggested tasks a plugin ships) | No | No | **VERIFIED** |
| **LibreChat** | **NO** — the only "scheduler" is an internal GitHub *skills-sync* poller | No | No | **VERIFIED** |
| **opencode** | **NO** — grep for `cron` over the repo returns nothing | No | No | **VERIFIED** |
| **Continue.dev** | **NO** — and it classifies `crontab`/`at`/`schtasks` as **high-risk** shell commands | No | No | **VERIFIED** |

**The split that matters:** the three peers that *are* agent-chat apps like ctrl-b (open-webui,
AnythingLLM, goose) have all built this, all three within the last release cycle, and all three
converged on the same skeleton. The three *coding* CLIs (opencode, Codex, Continue) have not built it
at all — Claude Code is the coding-CLI outlier and it solved it twice, differently.

---

## 2. Per-project evidence

### 2.1 ChatGPT — `automations` (Tasks / "Scheduled")

**Tool contract (REPORTED — verbatim from a published system-prompt archive,
`jujumilk3/leaked-system-prompts@openai-chatgpt5_20250807.md` and
`asgeirtj/system_prompts_leaks@OpenAI/gpt-5.5-thinking.md`; not first-party, but the two archives agree
on structure and the 2026 one is materially richer):**

```ts
type create = (_: {
  prompt: string,          // "the instruction that will be sent back to you on future runs"
  title: string,           // "a short card headline, usually 2–5 words"
  timing_mode: "exact_schedule" | "flexible_schedule" | "condition_watch",
  schedule?: string,       // iCal VEVENT; "Prefer RRULE when possible"
  dtstart_offset_json?: string,  // JSON args to Python dateutil.relativedelta
}) => any;

type update = (_: {
  jawbone_id: string, schedule?, dtstart_offset_json?, prompt?, title?,
  is_enabled?: boolean, timing_mode?,
}) => any;

type list = () => any;
```

Load-bearing lines, quoted:

- **Schedule grammar is iCal, not cron.** *"Schedules must use iCal VEVENT format. Prefer RRULE when
  possible. Do not specify SUMMARY or DTEND."* Relative one-shots go through
  `dtstart_offset_json` (*"'in 15 minutes' would be: schedule="" dtstart_offset_json='{"minutes":15}'"*).
- **Three prose fields, three audiences** (2026 version only): `title` (card headline), `prompt`
  (*"a clear imperative to yourself… Do not include scheduling cadence"*), and
  **`display_description`** — *"natural user-facing card copy… It should add meaning beyond the title
  rather than restating it."*
- **`timing_mode` is the interesting invention.** `exact_schedule` when the user named a clock time;
  `flexible_schedule` for dayparts ("morning"); **`condition_watch`** when *"the user asks to be
  notified when a future condition becomes true"*. In `condition_watch` the run itself decides whether
  to surface: the example prompt ends *"If conditions are not good yet, do not notify me."* — i.e. a
  scheduled run may legitimately produce **no output**.
- **Floor on frequency:** *"The highest frequency at which it is possible to schedule automations or
  tasks is once an hour. If the user asks for a schedule at a higher frequency than that, explain that
  it is not possible and do not call the automations tool."*
- **The cap is a server-side error string the model must relay verbatim-ish** (2025 version):
  *"If the error is 'Too many active automations,' say something like: 'You're at the limit for active
  tasks. To create a new task, you'll need to delete one.'"* — and, crucially,
  *"When you get an ERROR back from the automations tool, EXPLAIN that error to the user… Do NOT say
  you've successfully made the automation."*
- **Confirmation style is prescribed and deliberately un-feature-y:** *"When creating a task, give a
  SHORT confirmation, like: 'Got it! I'll remind you in an hour.'"* and *"DO NOT refer to tasks as a
  feature separate from yourself. Say things like: 'I can remind you tomorrow, if you'd like.'"*
- **Restraint is prescribed:** *"Lean toward NOT suggesting tasks. Only offer to remind the user about
  something if you're sure it would be helpful."* Elsewhere in the same prompt:
  *"Never promise to do background work unless calling the automations tool."*
- **No `delete`** in the tool namespace — only `create`/`update`(+`is_enabled`)/`list`. Deletion is a
  human-only action in the UI.

**Authoring UI + results surface (REPORTED, `learn.chatgpt.com/docs/automations`):** the edit surface
exposes **schedule** (preset cadences plus raw RFC 5545 RRULE, e.g. `RRULE:FREQ=MONTHLY;BYMONTHDAY=1`),
**destination** (*standalone → new chat per run*, or *inside an existing chat → "return to that chat"
with existing context*), **model + reasoning effort**, and **tools/skills**. Results:
*"The Scheduled view acts as your inbox. Scheduled task runs with findings appear there, and an unread
indicator shows when a run needs your attention."* And — directly answering our recursion question —
*"Skills can also create or update scheduled tasks."*

**Caps (REPORTED, secondary/tier-dependent):** active-task limits by plan, reported as 3 (Go) / 5
(Plus) / 10 (Business, Edu) / 15 (Pro, Enterprise). Treat the numbers as soft; the *mechanism* (a cap
on **active**, surfaced as a tool error) is the finding.

### 2.2 Claude Code — **two** mechanisms, deliberately different

Read from the installed 2.1.220 binary. Both are **VERIFIED**.

#### (a) Local `CronCreate` / `CronDelete` / `CronList` — the agent's own scheduler

```
CronCreate inputSchema (zod, strictObject):
  cron:      string  — 'Standard 5-field cron expression in local time: "M H DoM Mon DoW"'
  prompt:    string  — "The prompt to enqueue at each fire time."
  recurring: boolean? — "true (default) = fire on every cron match until deleted or auto-expired
                         after 7 days. false = fire once at the next match, then auto-delete.
                         Use false for 'remind me at X' one-shot requests"
  durable:   boolean? — "true = persist to .claude/scheduled_tasks.json and survive restarts.
                         false (default) = in-memory only, dies when this Claude session ends."
```

- **Cron is in the user's LOCAL time, by design:** *"'0 9 * * *' means 9am local — no timezone
  conversion needed."*
- **Anti-thundering-herd is a *prompt-level* instruction**, not a code detail. Verbatim:
  *"## Avoid the :00 and :30 minute marks when the task allows it … Every user who asks for '9am' gets
  `0 9` … which means requests from across the planet land on the API at the same instant… Only use
  minute 0 or 30 when the user names that exact time and clearly means it."* Code then adds a
  deterministic jitter on top: `{recurringFrac:0.5, recurringCapMs:1800000, oneShotMaxMs:90000,
  oneShotMinuteMod:30, recurringMaxAgeMs:604800000, cacheLeadMs:15000}` — recurring jobs fire up to
  10 % of their period late (cap 30 min per the config, 15 min per the prompt text — the prompt and
  the constant disagree), one-shots landing on :00/:30 fire up to 90 s **early**.
- **Hard caps, enforced in `validateInput` before the model's call lands:** max **50** jobs
  (*"Too many scheduled jobs (max 50). Cancel one first."*); invalid cron rejected
  (*"Expected 5 fields: M H DoM Mon DoW."*); a cron that *"does not match any calendar date in the
  next year"* rejected; recurring jobs **auto-expire after 7 days** — they *"fire one final time, then
  are deleted. This bounds session lifetime. Tell the user about the 7-day limit when scheduling
  recurring jobs."*
- **Creating a cron is NOT auto-approvable.** `checkPermissions` returns
  `{behavior:"passthrough", message:"Scheduling a cron prompt requires classifier review."}` in auto
  mode — i.e. even the permissive mode routes it through review.
- **Ownership scoping:** each job may carry an `agentId`; `CronDelete` refuses cross-owner deletes
  (*"Cannot delete cron job '<id>': owned by another agent"*), and `durable` is refused for teammates
  (*"teammates do not persist across sessions"*).
- **Persisted record** (`.claude/scheduled_tasks.json`, `{tasks:[…]}`, atomically staged write):
  `{id (8-char uuid slice), cron, prompt, createdAt, lastFiredAt?, recurring?, permanent?,
  createdBySessionId, createdByPid, createdByProcStart}`. The reader **drops malformed rows
  individually** rather than failing the file (*"[ScheduledTasks] skipping malformed task"*,
  *"skipping task <id> with invalid cron"*). A sibling `.claude/scheduled_tasks.lock`
  (`{sessionId,pid,procStart,acquiredAt}`) elects one scheduler across concurrent sessions and
  recovers stale locks.
- **Results land in the live conversation.** On fire, the prompt is enqueued into the current session
  (`mode:"prompt"`, `isMeta:true`, `priority:"later"`, `wakeupSource:"schedule_wakeup"`) preceded by a
  synthetic marker message `Running scheduled task (<time>)`. Jobs *"only fire while the REPL is idle
  (not mid-query)"*.
- **Missed one-shots get an explicit human gate.** The catch-up notification reads:
  *"The following one-shot scheduled task was missed while Claude was not running. It has already been
  removed from .claude/scheduled_tasks.json. **Do NOT execute this prompt yet. First use the
  AskUserQuestion tool to ask whether to run it now. Only execute if the user confirms.**"*
- **Scope discipline in the tool prompt:** *"## Not for live watching — `CronCreate` re-runs a prompt
  at fixed wall-clock intervals. To watch a log file, process, or command output and be notified the
  moment something changes, use the `<Monitor>` tool instead."*

#### (b) `RemoteTrigger` + the `/schedule` skill — cloud "routines"

- **One tool, action-dispatched**, with a deliberately thin schema — the *body* is free-form JSON and
  the *skill prompt* teaches its shape:
  `{action: "list"|"get"|"create"|"update"|"run", trigger_id?: string, body?: record<string,unknown>}`.
  Description: *"Manage scheduled remote Claude Code agents (routines) via the claude.ai CCR API. Auth
  is handled in-process — the token never reaches the shell."* / *"Use this instead of curl."*
- **`delete` is deliberately absent.** The skill says so out loud: *"You CANNOT delete routines. If the
  user asks to delete, direct them to: https://claude.ai/code/routines."*
- **Create body:** `name`, exactly one of `cron_expression` (5-field, **UTC**, *"Minimum interval is
  1 hour… `*/30 * * * *` will be rejected"*) or `run_once_at` (RFC3339 UTC, *"Must be in the future.
  Fires once, then auto-disables"*), `enabled` (default true), `job_config.ccr{environment_id,
  session_context{model, sources[{git_repository:{url}}], **allowed_tools**}, events[{data:{uuid,
  session_id, type:"user", message:{content, role}}}]}`, `mcp_connections[]`,
  `clear_mcp_connections`. **The prompt is buried inside `events[].data.message.content`** and
  **`allowed_tools` is part of the record** — the privilege decision is stored per routine.
- **Timezone is handled in the conversation, not the record.** *"The user's local timezone is
  {tz}. Cron expressions … are always in UTC. When the user says a local time, convert it to UTC but
  confirm with them: '9am {tz} = Xam UTC, so the cron would be `0 X * * 1-5`.'"* For one-offs the skill
  forces a fresh clock read: *"**Before computing any `run_once_at` value, you MUST re-check the
  current time** by running `date -u +%Y-%m-%dT%H:%M:%SZ`… Do not guess or infer today's date from
  conversation context… If the resolved time is already in the past, ask the user to clarify rather
  than silently rolling forward."*
- **The confirmation is generated by code, not left to the model.** `buildScheduleSummary` appends to
  every create/update result:
  `→ Scheduled: next run (cron 0 9 * * 1-5) in 3 hours (2026-07-30T09:00:00Z UTC)` ·
  `⚠ next_run_at is in the past — confirm the date/timezone is intended.` ·
  `→ Disabled (next run would be …)` · `→ View/manage: https://claude.ai/code/routines/{id}`.
  The tool prompt then *orders the relay*: *"a summary line is appended with the server-parsed run time
  and the routine's claude.ai URL — relay both to the user so they can confirm the time is right and
  know where the result will appear."*
- **The authoring "form" is a scripted conversation.** The `/schedule` skill's CREATE workflow is a
  7-step interview: understand the goal → **craft the prompt** (*"the cloud agent starts with zero
  context, so the prompt must be self-contained"*) → set the schedule (+ confirm the UTC conversion) →
  choose the model (default `claude-sonnet-5`, *"Tell the user which model you're defaulting to"*) →
  **validate connections** (infer needed MCP connectors from the description, warn about missing ones)
  → *"**Review and confirm** — Show the full configuration before creating. Let them adjust."* →
  create + always print the routine URL. The skill's very first action is an `AskUserQuestion` with
  four options (create/list/update/run).
- **Results land in a fresh isolated cloud session per run**, surfaced at
  `claude.ai/code/routines/{id}`. One-shots that already fired report
  `ended_reason: "run_once_fired"` (*"shows as 'Ran' in the web UI. The user can re-arm it by updating
  with a new `run_once_at`"*).
- LIST is spec'd for the model: *"Show: name, schedule (human-readable), enabled/disabled, next run,
  repo(s)"* + *"Always convert cron to human-readable when displaying."*

### 2.3 open-webui — `Automations` (the closest analogue to our sketch)

All **VERIFIED** from source.

**Record** (`backend/open_webui/models/automations.py:19-54`) — note the **two tables**:

```python
class Automation(Base):
    id, user_id, folder_id, name
    data = Column(JSON, nullable=False)   # {prompt, model_id, rrule}
    meta, is_active, last_run_at, next_run_at, created_at, updated_at
    Index('ix_automation_next_run', 'next_run_at')

class AutomationRun(Base):
    id, automation_id, chat_id, status  # success | error
    error, created_at
```

`AutomationData` is the typed inner object: `{prompt: str, model_id: str, rrule: str,
terminal: {server_id, cwd} | None}` — i.e. **one nested payload object that grows fields**, exactly the
shape our own "shape data to extend, not to migrate" directive prefers. The response type adds
computed, non-persisted fields: `AutomationResponse{…, last_run: AutomationRunModel|None,
next_runs: list[int]|None}`.

- **RRULE, not cron** — and validated up front: `validate_rrule` raises on a malformed rule *and* on an
  exhausted one (`if rule.after(now) is None: raise ValueError(AUTOMATION_NO_FUTURE_RUNS)`). Only one
  `RRULE` per rule, `EXRULE` rejected. Sub-daily frequencies are re-anchored to a fixed epoch DTSTART
  *"so intervals snap to clock boundaries (e.g. every 5min = :00, :05, :10)"* — the **opposite** of
  Claude Code's deliberate off-minute jitter.
- **Timezone lives on the user, not the automation:** every validate/next-run/preview call takes
  `tz=user.timezone` (`ZoneInfo`), with a logged fallback *"Unknown timezone %r — falling back to
  server time"*.
- **Three configurable caps, admin-bypassed** (`routers/automations.py:67-93`):
  `automations.enable` (feature flag + a per-user `features.automations` permission),
  `automations.max_count` (**count**, create only), `automations.min_interval` (checked on create *and*
  update via `rrule_interval_seconds`, which returns `None` for `COUNT=1` one-shots so they're exempt).
- **API surface:** `GET /list` (paginated 30, `query`/`status`/`folder_id` filters, batched
  latest-run join to avoid N+1) · `POST /create` · `GET /{id}` · `POST /{id}/update` ·
  `POST /{id}/toggle` · `POST /{id}/run` · `DELETE /{id}/delete` (cascades runs first) ·
  `GET /{id}/runs`.
- **Agent-facing tools** — five, in `backend/open_webui/tools/builtin.py`:
  `create_automation(name, prompt, rrule, folder_id?)` · `update_automation(automation_id, name?,
  prompt?, rrule?, model_id?, folder_id?)` · `list_automations(status?, folder_id?, count=10)` ·
  `toggle_automation` · `delete_automation`. The model **never picks the model**:
  *"The automation will use the current chat model"* — `model_id` is lifted from
  `__metadata__.model_id`. The docstring teaches RRULE by example, including the one-shot idiom
  (*"Once at a specific time: `DTSTART:20250415T140000\nRRULE:FREQ=DAILY;COUNT=1`"* and
  *"Use COUNT=1 for one-time automations"*). The tools re-enter the **same** `check_automation_limits`
  the HTTP route uses and return `json.dumps({'error': …})` on rejection — errors are data, not
  exceptions. Return payload for the model: `{status, id, name, folder_id, model_id, is_active,
  next_runs}` — i.e. it hands back the computed next-run list so the assistant can confirm the time.
- **A separate one-shot primitive:** `timer(prompt, at, cancel_on)` where `at` is
  *"Relative time like 10s, 5m, 1h, 2d, or a timezone-aware RFC 3339 timestamp"* and
  **`cancel_on: ['chat.read', 'chat.user_message']`** — a self-cancelling reminder. Implemented as
  *"Durable one-shot timers backed by internal child chats"* (`utils/timers.py:1`). Guardrail:
  *"Error: timers cannot be set from internal chats."* (blocks sub-agent recursion).
- **The headless run is where the real design is** (`utils/automations.py:412-605`):
  - it creates a **brand-new chat per run** — `chat_id = str(uuid4())`, title = the automation's name,
    `meta: {'automation_id': automation.id}`, placed in the automation's `folder_id`; then it calls
    `app.state.CHAT_COMPLETION_HANDLER` with the **exact payload the frontend would send** including
    `session_id = f'automation:{automation.id}'`;
  - **it mints a scoped, expiring token to run as the owner**:
    `create_token(data={'id': user.id, 'typ': 'automation'}, expires_delta=parse_duration(
    Config.get('automations.auth_token_expires_in', '1h')))` — attached as `request.state.token` so
    *"session-auth tool servers and terminals can authenticate headless scheduled runs as the
    automation owner"*;
  - **it re-gates the owner at fire time**, not just at create time — a demoted/deactivated owner
    yields a run record with `error='Owner no longer permitted to run automations'`;
  - **it re-resolves what the frontend normally resolves** (`tool_ids`, `features`, `filter_ids`,
    `terminal_id` from the model's `info.meta`), and documents the headless capability gap:
    *"code_interpreter is excluded: it requires the frontend event emitter and does not work in
    headless backend execution."*
  - surfacing: `sio.emit('chat:list')` to refresh the sidebar, then
    `sio.emit('automation:result', {automation_id, name, chat_id, status:'success'})` to
    `room=f'user:{user_id}'`, plus lifecycle events on the generic bus
    (`AUTOMATION_RUN_STARTED/COMPLETED/FAILED`) which fan out to configured webhooks. Errors are
    truncated to 4000 chars into `AutomationRun.error`.
- *(adjacent to the other agent's brief, but it shapes the record:)* `claim_due` selects due rows and
  **advances `next_run_at` in the same transaction** — *"Advances next_run_at immediately so the row
  can never be double-claimed"* — with `FOR UPDATE SKIP LOCKED` on Postgres. `next_run_at` being a
  persisted, indexed column is what makes that possible.

**Edit form** (`AutomationModal.svelte` + `automations/*Dropdown.svelte`) — it is shaped like a
**composer**, not a settings form:

- borderless title `<input placeholder="Automation title">` at the top;
- an **Instructions** `<textarea rows=8 min-h-[12rem]>` (plain textarea, no editor);
- a bottom **pill toolbar** of dropdowns: `ScheduleDropdown` · `ModelDropdown` · `FolderDropdown`
  (+ `TerminalDropdown` exists in the same folder);
- Cancel / **Create**|**Save**. Validation is client-side and minimal:
  *"Name, prompt, and model are required"*, plus *"Scheduled time must be in the future"* for `ONCE`.
- The modal doubles as the **clone** entry point (`cloneFrom` prop) — copy an automation's fields into
  a new one.

**Schedule entry — the pattern to steal.** `ScheduleDropdown.svelte` presents
`ONCE | HOURLY | DAILY | WEEKLY | MONTHLY | CUSTOM`. For `ONCE`: a `<input type=date>` (min = today) +
`<input type=time>`, pre-seeded to *now + 5 min*. For the recurring presets: a time input, a
day-of-month spinner (1–31), and a 7-button Mo–Su toggle strip. `CUSTOM` reveals **one raw RRULE text
input** (`placeholder="RRULE:FREQ=DAILY;BYHOUR=9;BYMINUTE=0"`). The component is **round-trippable**:
`buildRrule()` serialises, `parseRrule(s)` restores — and when the stored rule is not representable it
degrades gracefully rather than lying:

```js
if (!['HOURLY','DAILY','WEEKLY','MONTHLY'].includes(freq)) { frequency = 'CUSTOM'; customRrule = s; return; }
```

**Detail view** (`AutomationEditor.svelte`): a 6-row label/value block — Status (Active/Paused with a
coloured dot) · Schedule (**humanised** from the RRULE by `formatSchedule`) · Folder · Model · Next run
(*"Today at 9:00 AM"* / *"Not scheduled"*) · Last run (*"Never"*) — then the **Prompt** rendered
read-only in `font-mono whitespace-pre-wrap`, then **Runs**: an infinite-scrolling list of
`● timestamp · [View chat →] · error-text`, green dot for success, red for error. Header actions:
toggle · run now · edit (opens the modal) · delete (confirm dialog).

### 2.4 AnythingLLM — `Scheduled Jobs` (the richest run-history model)

All **VERIFIED** from source. Note: the whole feature is gated
`[validatedRequest, isSingleUserMode]` on **every** endpoint — **it only exists in single-user mode.**
For a single-user app like ctrl-b that is the most directly transferable design in the class.

**Record** (`server/prisma/schema.prisma:403-429`), verbatim:

```prisma
model scheduled_jobs {
  id Int @id @default(autoincrement())
  name      String
  prompt    String
  tools     String?  // JSON array of tool identifiers (null = use all enabled agent skills)
  schedule  String   // Cron expression
  enabled   Boolean  @default(true)
  lastRunAt DateTime?
  nextRunAt DateTime?
  createdAt DateTime @default(now())
  updatedAt DateTime @default(now())
  runs      scheduled_job_runs[]
}

model scheduled_job_runs {
  id Int @id @default(autoincrement())
  jobId       Int
  status      String   @default("queued") // queued | running | completed | failed | timed_out
  result      String?  // JSON execution trace
  error       String?
  startedAt   DateTime @default(now())
  completedAt DateTime?
  readAt      DateTime? // null = unread
  job         scheduled_jobs @relation(..., onDelete: Cascade)
}
```

**Correction to record (VERIFIED):** the schema comment *"null = use all enabled agent skills"* is
**wrong**. The runner does `const toolOverrides = safeJsonParse(job.tools, [])`
(`server/jobs/run-scheduled-job.js:70`), `safeJsonParse` returns the `[]` fallback for `null`
(`server/utils/http/index.js:79`), and `ephemeral.js:576` gates on `if (args.toolOverrides)` — an empty
array is truthy in JS, so `#funcsToLoad = []`. **`tools: null` means NO tools**, which is what both the
runner's own comment (*"Empty array: no tools are loaded"*) and the agent skill say. Don't copy the
schema comment's semantics.

- **`schedule` is stored in UTC and converted at the edges.** `later.date.UTC()` at module load, with
  the contract spelled out: *"The frontend is responsible for converting user's local time to UTC when
  creating/editing schedules, and converting UTC back to local time when displaying."* Two libraries:
  `cron-validate` for `isValidCron`, `@breejs/later` for `computeNextRunAt`.
- **`nextRunAt` is maintained in three places:** on create, on every run (`updateRunTimestamps` sets
  `lastRunAt` + recomputes `nextRunAt`), and via `recomputeNextRunAt` *"on cold startup to correct
  stale nextRunAt values"*.
- **The cap is on ACTIVE jobs, not total** — `MAX_ACTIVE` (currently `null` = unlimited, with a
  `@todo: add a configuration option for this`), checked by `canActivate({excludeId})` at **three**
  call sites: create, `enabled:true` on update, and toggle-on. `excludeId` exists *"so a re-save of an
  already-enabled job is not double-counted"*. The error text tells the user the remedy:
  *"Cannot enable: maximum of N active scheduled jobs reached. Disable another job first."*
- **Run-level actions, not just job-level:** `POST /scheduled-jobs/runs/:runId/:action` with
  `action ∈ {read, continue, kill}`. `kill` is refused unless the run is `queued`/`running`, and
  *"Killing a run will also mark it as read (user killed it, so dont bother with unread status)"*.
  There is also `failOrphanedRuns()` for runs stranded by a crash.
- **`continueInThread(runId)` is the standout pattern.** Runs are **log-only by default**; when the
  user wants to talk to a result, the app **lazily materialises a chat**: upsert a dedicated workspace
  `{slug:'scheduled-jobs', name:'Scheduled Jobs', chatMode:'automatic'}`, create a **new thread**, and
  seed it with one `WorkspaceChats.new({prompt: run.job.prompt, response: {text, sources, outputs,
  type:'chat'}})`. So: log by default, thread on demand, and the thread starts pre-loaded with the run.
- **Execution (`server/jobs/run-scheduled-job.js`):** an `EphemeralAgentHandler` (no workspace/thread),
  `toolOverrides` from the record, a hard timeout
  `SCHEDULED_JOB_TIMEOUT_MS = Number(process.env.SCHEDULED_JOB_TIMEOUT_MS) || 5*60*1000` raced against
  the agent, and — the load-bearing line for our privilege question:

  ```js
  // Auto-approve all tool invocations when running a scheduled job
  agentHandler.aibitat.requestToolApproval = async () => {
    log("Tool approval requested for scheduled job, auto-approving");
    return { approved: true, message: "Auto-approved by scheduled job runner." };
  };
  ```

  **All safety therefore rests on the stored `tools` allowlist.** The persisted `result` is a full
  trace: `{text, thoughts, toolCalls[{toolName, arguments, result, timestamp}], outputs, metrics,
  duration}`.
- **Notification:** a Web Push to `"primary"` — title `` `${job.name} completed` ``, body = the response
  with thinking stripped and truncated to 100 chars, `data.onClickUrl =
  /settings/scheduled-jobs/{jobId}/runs/{runId}`.
- **Agent-facing tool: `create-scheduled-job` — create ONLY.** No update/delete/list for the model;
  the closing line of its success message is *"The user can manage it from Settings > Scheduled Jobs."*
  Four design moves worth copying verbatim:
  1. **A discovery phase inside the same tool.** `listTools: true` returns the catalog; the description
     insists: *"Tool IDs for scheduled jobs are NOT the same as agent plugin names - you MUST call this
     tool with `listTools: true` first to get the exact valid IDs, then call it again with your chosen
     `tools`. Never guess tool IDs - always discover them via `listTools: true` first."* The tool even
     ships two-step `examples` (`{listTools:true}`, then the real create).
  2. **Only *ready* tools are offered** — `readyToolsCatalog(fullCatalog)` filters anything needing
     setup, *"exactly like the manual Scheduled Jobs UI"*; unknown IDs are rejected with a message that
     distinguishes "not a tool" from "needs setup".
  3. **Local-time cron in, UTC out** — *"Provide `schedule` as a standard 5-field cron expression in
     the USER'S LOCAL TIME - the server automatically converts to UTC"*, using the tz from the
     `X-Timezone` header cache (`UserMetaCache`).
  4. **An explicit human approval gate before the write**:
     `requestToolApproval({skillName, payload:{name, schedule, tools}, description: 'Create scheduled
     job "X" (0 9 * * 1-5)'})`.
  Plus the self-containment warning the model must internalise: *"the job runs later on its own with
  NO chat context and can ONLY use the tools you list in `tools`."*
- **Anti-recursion, by allowlist omission (VERIFIED):** `create-scheduled-job` is **not** in
  `ScheduledJob.availableTools()` — the catalog enumerates agent-skills, filesystem, create-files,
  gmail, gcal, outlook, imported skills, agent flows, and MCP servers, and nothing else. A scheduled
  job therefore **cannot be granted the job-creating tool**, so a run cannot spawn more jobs. This is
  enforced by what the catalog contains, not by a check.
- **Confirmation card in chat:** `ScheduledJobCreatedCard` — a calendar icon, `jobName`,
  `"Scheduled job created · 0 9 * * 1-5"`, and a **View job** button routing to the run-history page.
  Delivered twice on purpose: `socket.send('scheduledJobCreated', payload)` for the live chat **and**
  pushed onto `_pendingOutputs` *"so it persists and re-renders when the chat is reloaded"*.

**Manual form** (`JobFormModal/`): default state
`{name:'', prompt:'', schedule:'0 9 * * *', scheduleMode:'builder', selectedTools:[]}`. Four
sub-components — `JobDescription` (name + prompt) · `JobSchedule` · `ToolsSelector` · `FormActions`.
`JobSchedule` is a **two-tab segmented control**: **Builder** (`Run [minute|hour|day|week|month]`,
`every N`, `at HH:MM`, weekday chips, day-of-month) vs **Custom** (a raw cron text input) — and below
both, always, a live echo: `` `Current schedule: <code>0 9 * * *</code> — every day at 9:00 AM` ``
(`humanizeCron`). The builder tracks `wasFallback` and shows a yellow warning when the incoming cron
couldn't be represented, clearing it on first edit. `ToolsSelector` renders the categorised catalog
with `requiresSetup` flags.

**List/detail views:** `JobRow` shows name · latest-run status text · `lastRunAt` · `nextRunAt`
(*only when `enabled`*, else `—`) and four icon actions (delete · edit · run-now · toggle), with
run-now/edit disabled while `latestRun.status ∈ {running, queued}`. Separate `RunHistoryPage` and
`RunDetailPage` (with `ToolCallCard`, `GeneratedFileCard`, `StatusBadge`, `CollapsibleSection`) render
the stored trace.

### 2.5 goose — scheduled **recipes**

All **VERIFIED**. goose's distinguishing choice: **the prompt is not a field on the automation.** An
automation is `(recipe file, cron)`; the prompt/instructions/parameters live in a reusable **recipe**
(YAML/JSON) on disk.

**Agent tool** — one tool, ten actions (`crates/goose/src/agents/platform_tools.rs:4-41`):

```
platform__manage_schedule
  "Manage goose's internal scheduled recipe execution."
  action: list | create | run_now | pause | unpause | delete | kill | inspect | sessions | session_content
  job_id?         "Job identifier for operations on existing jobs"
  recipe_path?    "Path to recipe file for create action"
  cron_expression? "Supports both 5-field … and 6-field (second minute hour day month weekday)
                    formats. 5-field expressions are automatically converted to 6-field by
                    prepending '0' for seconds."
  limit?  (default 50)   session_id?
  annotations: read_only(false) destructive(true) idempotent(false) open_world(false)
```

The MCP `ToolAnnotations` are how goose signals the approval posture — `destructive(true)` on a
schedule-management tool.

- **Record** (`crates/goose/src/scheduler.rs` via `schedule_tool.rs:176-187`):
  `ScheduledJob { id, source (canonical recipe path), cron, last_run, currently_running, paused,
  current_session_id, process_start_time, parameters, recipe_base_dir }`. Agent-created jobs are
  namespaced: `let job_id = format!("agent_created_{}", Utc::now().timestamp())` — provenance encoded
  in the ID. Note `paused` (not `enabled`) and the two liveness fields
  (`currently_running`, `process_start_time`) that make `kill`/`inspect` possible.
- **The guardrails are all about the recipe *file*** (`read_schedule_recipe`, and
  `crates/goose/tests/schedule_tool_security.rs`): canonicalise the path; reject non-regular files
  (*"Recipe path must reference a regular file"* — the test `rejects_fifo_without_blocking` proves it
  won't hang on a FIFO); enforce `MAX_SCHEDULE_RECIPE_BYTES` = 1 MiB (*"Recipe file exceeds the 1048576
  byte limit"*); require valid UTF-8; parse-validate as `Recipe` before storing; accept symlinks but
  **store the canonical path** (`accepts_symlink_to_regular_recipe_with_canonical_provenance`). And the
  test our own repo should recognise: **`parse_errors_do_not_reflect_recipe_contents`** — a malformed
  recipe must yield `"Invalid YAML recipe"`, never an error that echoes the file. *(We have the same
  class of bug on record: "three YAML error types leak file content" in the update-migration memory.)*
- **Results land in goose sessions** — one session per run; `run_now` returns the session id
  (*"Successfully started job 'x'. Session ID: y"*), and the agent can read history itself via
  `sessions` / `session_content`.
- **Manual form** (`ui/desktop/src/components/schedule/ScheduleModal.tsx`): `Name:`
  (placeholder *"e.g., daily-summary-job"* — it *is* the job id) · `Source:` a **YAML|Deep link**
  toggle (browse for a `.yaml`/`.yml`, or paste a `goose://recipe` link) with a parsed-recipe preview
  (*"Recipe parsed successfully / Title: … / Description: …"*) · `Schedule:` the CronPicker. **No prompt
  textarea at all.**
- **Schedule entry** (`CronPicker.tsx` + `utils/cronSchedule.ts`): the same
  presets-plus-escape-hatch shape as the other two —
  `Period = 'minute'|'hour'|'day'|'week'|'month'|'quarter'|'year'|'custom'`, round-trippable
  (`buildCronForPeriod` / `parseCron`), 5-field input normalised to 6-field by prepending `'0'`, and a
  human-readable echo via the **`cronstrue`** library (`describeCron`). Default `'0 0 14 * * *'`.
- **Detail view** (`ScheduleDetailView.tsx`) labels tell the whole model: *Currently Running* ·
  *Paused* · *Cron Expression* · *Recipe Source* · *Last Run* · *Current Session* · *Process Started*;
  actions *Run Schedule Now* · *Edit Schedule* · *Pause/Unpause Schedule* · *Inspect Running Job* ·
  *Kill Running Job*; guards *"Cannot trigger or modify a schedule while it's already running."* and
  *"This schedule is paused and will not run automatically. Use 'Run Schedule Now' to trigger it
  manually or unpause to resume automatic execution."*; then *Recent Sessions* (`Session ID` ·
  `Created` · `Messages: N` · `Dir`).
- **CLI** (`goose schedule add|list|remove|sessions`) validates the cron shape conversationally and
  warns on foot-guns: *"⚠ This will run every minute! Did you mean: '0 * * * *' for every hour?"*

### 2.6 Codex CLI — a **restricted schedule type**, and no authoring surface

**VERIFIED.** `scheduled_tasks` in Codex is `Option<Vec<ScheduledTaskSummary>>` on `PluginDetail` /
`RemotePluginRelease` — a **plugin manifest field**: a plugin ships suggested tasks. There is no
create/update/delete op, no agent tool, and no TUI authoring view (the TUI only carries the field
through the plugin-detail popup). But the *type* is the single most interesting data point in the
pass, because the newest peer in the class **deliberately did not use cron**:

```ts
export type ScheduledTaskSummary = { key: string, name: string, prompt: string, schedule: ScheduledTaskSchedule };

export type ScheduledTaskSchedule =
  | { type: "hourly",   intervalHours: number, days: Array<ScheduledTaskWeekday> | null }
  | { type: "daily",    time: string }
  | { type: "weekdays", time: string }
  | { type: "weekly",   days: Array<ScheduledTaskWeekday>, time: string };

export type ScheduledTaskWeekday = "MO"|"TU"|"WE"|"TH"|"FR"|"SA"|"SU";
```

A closed tagged union with exactly four arms and an explicit `weekdays` arm (the single most-requested
cadence). It is trivially round-trippable to a picker, has no unrepresentable states, and needs no
"custom" escape hatch — at the cost of not expressing "the 3rd Monday of the month".

### 2.7 The three that do **not** have it (VERIFIED negatives)

- **LibreChat** — no user-facing automations, no agent scheduling tool. The only scheduler in the repo
  is `packages/api/src/skills/sync/scheduler.ts`, a fixed-interval GitHub **skills-sync** poller
  (`SKILL_SYNC_MIN_INTERVAL_MINUTES = 5`, clamped against `NODE_TIMER_MAX_MS`) with a shutdown hook.
  A repo-wide code search for `cron` returns one hit: an Italian translation string.
- **opencode** — nothing. Path search returns only `test/plugin/trigger.test.ts` (plugin event hooks,
  not time triggers); a code search for `cron` returns zero results.
- **Continue.dev** — nothing, and the inverse signal: `packages/terminal-security/src/
  evaluateTerminalCommandSecurity.ts:854-859` defines `isHighRiskScheduledTask(baseCommand)` returning
  true for `crontab`, `at`, `schtasks`. Continue's docs recommend an *external* cron for RAG
  re-indexing. So the class's position on "let the agent shell out to cron" is: that's the high-risk
  path; a first-class typed record is the safe one.

---

## 3. What the field converged on

### 3.1 The agent-facing tool contract

| Dimension | Convergent answer | Dissent |
|---|---|---|
| **Shape** | Either **CRUD-ish verbs** (ChatGPT `create/update/list`; open-webui 5 tools; Claude Code `CronCreate/Delete/List`) or **one action-dispatched tool** (goose 10 actions; Claude Code `RemoteTrigger` 5) | AnythingLLM: **create only** — everything else is human-only |
| **Prompt field** | A plain `prompt`/`prompt`-in-body string, with an explicit *self-containment* warning | goose: no prompt field at all — a `recipe_path` |
| **Title field** | Always present and always constrained (*"2–5 words"*, *"short, imperative, start with a verb"*, *"DO NOT include the date or time"*) | — |
| **Schedule grammar the model writes** | Split down the middle: **cron** (Claude Code, AnythingLLM, goose) vs **iCal RRULE/VEVENT** (ChatGPT, open-webui) | Codex: a closed union, but no model writes it |
| **Timezone** | The model writes **local time** and the server converts (Claude Code local cron, AnythingLLM), *or* the model writes **UTC** and is told to confirm the conversion in prose (Claude Code routines) | open-webui: tz is a property of the **user**, applied at evaluation |
| **Delete** | **Withheld from the model** by ChatGPT, Claude Code routines, and AnythingLLM | open-webui and goose expose it |
| **Cap enforcement** | Server-side, re-checked in the *same* function the HTTP route calls, returned to the model as a **plain error string naming the remedy** ("Disable another job first" / "you'll need to delete one") | — |
| **Approval** | Creation is gated: AnythingLLM `requestToolApproval` · Claude Code *"requires classifier review"* even in auto mode | — |
| **Frequency floor** | ChatGPT 1 h; Claude Code routines 1 h; open-webui `min_interval` config | Claude Code local cron allows `*/5` but jitters it |
| **Tool discovery** | AnythingLLM's `listTools: true` in-tool discovery phase is unique — and is the only mechanism in the class that stops the model inventing capability names | — |

### 3.2 The schedule-entry widget (near-total convergence)

**Three of three peers with a manual form built the same thing:** a small set of **named frequency
presets** with per-preset widgets, **plus one raw-expression escape hatch**, **round-trippable**, with
a **human-readable echo of the effective schedule**, and an explicit **degradation path** when the
stored expression can't be represented in the presets (open-webui silently switches to `CUSTOM`;
AnythingLLM shows a `wasFallback` warning; goose has a `custom` period).

| | Presets | Escape hatch | Humaniser | Fallback signal |
|---|---|---|---|---|
| open-webui | Once/Hourly/Daily/Weekly/Monthly | `CUSTOM` raw RRULE input | hand-rolled `formatSchedule` | switches to CUSTOM silently |
| AnythingLLM | minute/hour/day/week/month | **Custom** tab, raw cron | `humanizeCron` | yellow `fallbackWarning` |
| goose | minute/hour/day/week/month/**quarter**/year | `custom` period | `cronstrue` | `custom` period |
| ChatGPT | "custom cadence options" | raw RFC 5545 RRULE | — | — (REPORTED) |

### 3.3 The record shape

**Everyone splits the record in two: the definition and its runs.** open-webui and AnythingLLM both
have a second table; goose uses its existing session store as the run log; Claude Code's local cron is
the only one that keeps a single row (`lastFiredAt` and nothing else) — and it is also the only one
with no history UI.

**Fields the field converged on that our sketch is missing:**

| Field | Who has it | Why they added it |
|---|---|---|
| **`next_run` (persisted, indexed)** | open-webui `next_run_at`, AnythingLLM `nextRunAt`, Claude Code routines `next_run_at` | it's what the list/detail UI shows, what "Not scheduled" is computed from, and (adjacent) what makes claim-and-advance safe. AnythingLLM recomputes it on cold start *"to correct stale nextRunAt values"* |
| **timezone** | open-webui (on the **user**), AnythingLLM (per-request `X-Timezone`), Claude Code (local-time cron by convention) | a cron/RRULE without a tz is a latent bug the moment the server's tz differs from the user's |
| **tool/skill allowlist on the record** | AnythingLLM `tools`, Claude Code routines `allowed_tools`, ChatGPT "tools/skills" | it *is* the privilege mechanism for a headless run — see §3.5 |
| **model / reasoning effort** | open-webui `model_id`, Claude Code routines `session_context.model`, ChatGPT | a nightly job shouldn't silently follow whatever the chat default became |
| **a per-run row** (`status`, `error`, `started/completed`, trace, `chat_id`) | open-webui, AnythingLLM | `last_status` on the definition can't answer "what happened three nights ago" |
| **`read_at` / unread** | AnythingLLM `readAt`, ChatGPT ("unread indicator") | the automation surface becomes an inbox; without it there is nothing to badge |
| **timeout** | AnythingLLM `SCHEDULED_JOB_TIMEOUT_MS` (5 min default, env-overridable) | a headless run has nobody to hit Stop |
| **liveness** (`currently_running`, `process_start_time`, `current_session_id`) | goose | prerequisites for `kill`/`inspect` and for "cannot modify while running" |
| **provenance** (who/what created it) | Claude Code (`createdBySessionId/Pid/ProcStart`, `agentId`), goose (`agent_created_*` id prefix) | ownership scoping on delete, and honest attribution in the UI |
| **a folder/grouping key** | open-webui `folder_id`, AnythingLLM's `scheduled-jobs` workspace | keeps N automations × M runs from drowning the chat list |

**Nobody in the class has "pause after N consecutive failures."** Not one of the six. The closest
things are Claude Code's **age-based** auto-expiry (recurring jobs die after 7 days regardless of
outcome) and one-shot auto-delete-after-fire, plus AnythingLLM's `failOrphanedRuns()` cleanup. If we
want failure-based auto-pause we are inventing it, not copying it — which is worth knowing before
spending a field on it.

### 3.4 Where results land

Four distinct answers; the split is real, not incidental.

1. **A new conversation per run** — open-webui (new `chat_id`, title = automation name,
   `meta.automation_id`, filed into the automation's folder); Claude Code routines (a fresh isolated
   cloud session); ChatGPT "standalone" tasks. Surfacing: the chat list refreshes + a socket/inbox
   event.
2. **Back into the originating conversation** — Claude Code **local** cron enqueues the prompt into the
   live session behind a `Running scheduled task (<time>)` marker; ChatGPT tasks bound to an existing
   chat *"return to that chat"* with its context. Cheap and contextual; unusable for anything the user
   isn't currently looking at.
3. **Log-only, with a chat materialised on demand** — AnythingLLM. `scheduled_job_runs.result` holds
   the full trace; `continueInThread` creates the workspace+thread lazily, seeded with (prompt,
   result). **The best of the three for a mobile single-user app:** no chat-list pollution, full
   history, and one tap to talk to any result.
4. **The existing session store as the log** — goose. Every run is a session; the agent itself can read
   them back (`sessions`, `session_content`).

**Unread/notification, across the class:** an **inbox with an unread indicator** (ChatGPT "Scheduled";
AnythingLLM `readAt` + an explicit `read` action) · **Web Push** with a deep link to the run
(AnythingLLM: `/settings/scheduled-jobs/{jobId}/runs/{runId}`, body = first 100 chars, thinking
stripped) · **socket events + a generic event bus → webhooks** (open-webui). ChatGPT's
`condition_watch` adds a fourth mode: **the run decides whether to notify at all.**

### 3.5 The guardrail that every peer had to solve: no human at the gate

A headless run cannot answer a confirmation prompt. The class has exactly two answers, and they are
the same answer:

- **AnythingLLM:** auto-approve *everything*, and make the stored **tool allowlist** the only control
  (`requestToolApproval = async () => ({approved:true, …})`, with `tools` narrowing what exists).
- **Claude Code routines:** `allowed_tools` on the record; the cloud session is sandboxed to it.
- **open-webui:** a scoped, **1-hour-expiring** `typ: 'automation'` token so tool servers see a real
  but time-boxed identity, plus a **re-check of the owner's permission at fire time**, plus an explicit
  documented capability exclusion (`code_interpreter` needs the frontend emitter → dropped).

And the recursion question, answered per peer:

| Peer | Can a scheduled run create more automations? |
|---|---|
| **AnythingLLM** | **No** — `create-scheduled-job` is absent from `availableTools()`, so it cannot appear in a job's allowlist (VERIFIED by omission) |
| **open-webui** | **Probably yes** — `_build_request` never sets `state.internal`, and only `timer` guards on it; `create_automation` has no such guard. Bounded only by `max_count`. (VERIFIED that the guard is absent; UNVERIFIED end-to-end) |
| **ChatGPT** | **Yes, explicitly** — *"Skills can also create or update scheduled tasks"* (REPORTED) |
| **Claude Code local cron** | **Yes** — the fired prompt is enqueued into the same session with the same tools; only the 50-job cap and the 7-day expiry bound it |
| **goose** | Yes if the recipe grants the tool; nothing blocks it |

---

## 4. Implications for ctrl-b (short, and separate from the evidence)

1. **Our `Automation` sketch is ~70 % of the convergent record.** The gaps the field agreed on:
   `next_run` (persisted + indexed), a **timezone**, an explicit **timeout**, a **per-run row**, and an
   **unread marker**. Add those before adding anything clever. `last_run`/`last_status` on the
   definition should become a *derived* view over the run table, not the source of truth (open-webui's
   `AutomationResponse.last_run` is exactly this).
2. **`privilege_level` alone is not what the field stores — it stores a *tool allowlist*.** Every peer
   that runs headless concluded the same thing: with no human at the gate you auto-approve and let the
   *stored capability set* be the control. We already have the better version of this: `AgentDef`
   carries `tools`/`skills` allowlists **plus** `privilege` **plus** `max_iterations`. Strongly
   consider making the automation point at an **agent** (or an inline AgentDef override) rather than
   growing a parallel privilege field — that is the "one unified object you extend" directive applied,
   and it inherits routing/compaction/limits for free.
3. **We already have `Actor.AUTOMATION`** in `backend/app/domain/enums.py` — the audit seam is built.
   The open-webui pattern to copy is **re-gating at fire time**, not only at create time (config could
   have changed, a host could have been removed, `shell.*_exec` could have been turned off since).
4. **On the `question`/`confirm` gate (the ROADMAP §A3 open question):** the field's answer is
   *don't reach the gate*. Compute the automation's effective permission set up front so any action
   that would confirm is either pre-allowed or absent; if a gate is still hit, the two precedents are
   *fail the run and record it* (open-webui's error row) or *notify and hold* — and F1 can now carry
   the "waiting" ping. ChatGPT's **`condition_watch`** is worth stealing as a *third* per-automation
   mode: a run that legitimately produces no output and posts nothing.
5. **Schedule entry: build presets + one raw-expression escape hatch, round-trippable, with a live
   human-readable echo, and a visible fallback warning.** Three of three peers built exactly this; the
   AnythingLLM variant (segmented Builder|Custom tab + a permanent
   `Current schedule: <code> — every day at 9:00 AM` line + `wasFallback`) is the most complete and the
   cheapest to port. Codex's closed union is the alternative worth weighing if we'd rather not own a
   cron parser at all — it costs "3rd Monday of the month" and buys zero unrepresentable states.
6. **The edit form should be a composer, not a settings panel.** open-webui's is literally
   title-input + big instructions textarea + a bottom pill toolbar (Schedule · Model · Folder) —
   which maps directly onto our **Composer Surface** and its `composerSkin` axis, and stays usable at
   phone width. Our Conf list entry (`ROADMAP.md:763` — "list, cron, prompt, privilege,
   enable/disable") should therefore be a **list + detail**, with the detail carrying the run history.
7. **Results: prefer AnythingLLM's log-first, thread-on-demand model.** A new thread per nightly run
   would bury a single-user mobile chat list within a week. Persist the run + trace, badge it unread,
   and offer a "continue in a thread" action that materialises a thread seeded with (prompt, result) —
   we already have threads, the Event log, and F1 notifications, so the pieces exist. Their deep-linked
   push notification (`…/runs/{runId}`, 100-char body) is the model for F1's automation channel.
8. **The agent-facing tool: copy the AnythingLLM contract, not the ChatGPT one.** Concretely:
   `create` only (management stays human — it removes a whole class of accidental deletion);
   a **discovery phase** for valid tool names (we have a one-file tool registry per D8, so a
   `list_tools: true` mode is nearly free, and it prevents the model inventing tool names);
   **local-time cron** in, converted at the boundary; a **confirm gate** on creation (we already have
   confirm-tokens — an automation-creating tool is exactly a `confirm`-class action); a **cap** checked
   in the same function the HTTP route calls, returned as an error string that names the remedy; and
   a **card in the chat** that links to the automation, persisted with the message so it survives
   reload.
9. **Two anti-recursion options, both cheap.** Either omit the automation-creating tool from what an
   automation's allowlist can contain (AnythingLLM's approach — enforced by construction), or mark the
   run's context so the tool refuses (open-webui's `timer` does this:
   *"timers cannot be set from internal chats"*). Pick one deliberately; open-webui shows what happens
   when you only do it for one of two tools.
10. **Two prompt-level guardrails are free and clearly earned:** ChatGPT's *"Lean toward NOT suggesting
    tasks"* + *"Never promise to do background work unless calling the automations tool"*, and the
    self-containment warning every peer ships (*"the job runs later with no chat context"*). Both belong
    in the tool description, not in docs.
11. **Two mechanism-adjacent findings the other agent should get:** a persisted+indexed `next_run` with
    **claim-and-advance in one transaction** is what makes double-firing impossible (open-webui
    `claim_due`); and `next_run` must be **recomputed at boot** (AnythingLLM `recomputeNextRunAt`,
    *"to correct stale nextRunAt values"*) because a row written before downtime is stale by definition.
12. **One borrowed test, for free:** goose's `parse_errors_do_not_reflect_recipe_contents` — a malformed
    schedule/prompt must never produce an error that echoes file content. We already own this bug class
    ("three YAML error types leak file content", update-migration memory). If A3 ever accepts a prompt
    from a file, that test comes with it.

---

## 5. What I could not determine

- **ChatGPT's actual tool schema.** Everything in §2.1 is from published system-prompt archives, not
  from OpenAI. The two archives I compared agree on structure and the 2026 one is internally
  consistent, but a hallucinated or drifted field cannot be ruled out. `display_description` appears in
  the 2026 archive's prose and **not** in its own `create` signature — one of the two is wrong.
  Everything ChatGPT here is **REPORTED**, never VERIFIED.
- **ChatGPT's exact per-tier caps** and whether the cap is on *active* or *total* tasks. The error
  string is "Too many active automations" (suggesting active) but the tier numbers are all secondary
  sources.
- **The ChatGPT "Scheduled" UI's actual edit-form fields.** `learn.chatgpt.com` describes them in prose
  (schedule / destination / model+reasoning effort / tools+skills); I could not see the form, and
  `help.openai.com` returns 403 to WebFetch.
- **Whether an open-webui automation run can in fact create another automation.** I verified the
  *guard is absent* (`_build_request` never sets `state.internal`; `create_automation` has no internal
  check) but did not run it. UNVERIFIED as behaviour, VERIFIED as code shape.
- **Claude Code's jitter cap discrepancy.** The tool prompt says recurring tasks fire *"up to 10 % of
  their period late (max 15 min)"*; the config constant is `recurringFrac: 0.5, recurringCapMs:
  1800000` (50 %, 30 min). One is stale. I did not determine which is authoritative at runtime (the
  values are also overridable by a `tengu_kairos_cron_config` gate).
- **goose's full `ScheduledJob` serde/persistence** — I read the struct through its construction site
  in `schedule_tool.rs` and the mock in the security test, not `scheduler.rs` itself (that file is the
  other agent's territory). Field *names* are verified; storage format and defaults are not.
- **AnythingLLM's `RunDetailPage` / `ToolCallCard` rendering detail** — I confirmed the files and the
  stored trace shape, but did not read the components; how much of a trace is shown by default is
  unknown.
- **Whether any peer offers per-automation *retry* on failure** (as opposed to notify/record). I found
  no retry field or code path in any of the six, but I did not exhaustively search for one.
- **Nobody's answer to "pause after N failures"** — see §3.3. Confirmed absent in AnythingLLM,
  open-webui, Claude Code and Codex's schema; **UNVERIFIED** for goose and ChatGPT.

---

## 6. Sources

**Read directly (VERIFIED):**

- Claude Code 2.1.220 (installed binary): `CronCreate`/`CronDelete`/`CronList` schemas + prompts
  (`buildCronCreatePrompt`, `DEFAULT_MAX_AGE_DAYS`, jitter config `Tpe`), the `.claude/scheduled_tasks.json`
  reader/writer + lock, `buildMissedTaskNotification`, `RemoteTrigger` tool (`kIe`/`H0d`/`I0d`,
  `buildScheduleSummary`), the `/schedule` skill prompt template.
- open-webui `01f4282f`: `backend/open_webui/models/automations.py`, `routers/automations.py`,
  `utils/automations.py`, `utils/timers.py`, `tools/builtin.py` (§AUTOMATION TOOLS, `timer`),
  `migrations/versions/d4e5f6a7b8c9_add_automation_tables.py`, `events.py`,
  `src/lib/components/AutomationModal.svelte`, `src/lib/components/automations/{AutomationEditor,ScheduleDropdown}.svelte`,
  `src/routes/(app)/automations/+page.svelte`, `src/lib/apis/automations/index.ts`.
- AnythingLLM `a3c9a262`: `server/prisma/schema.prisma` (§scheduled_jobs / scheduled_job_runs),
  `server/models/scheduledJob.js`, `server/models/scheduledJobRun.js`, `server/endpoints/scheduledJobs.js`,
  `server/jobs/run-scheduled-job.js`, `server/jobs/helpers/scheduled-job-helper.js`,
  `server/utils/agents/aibitat/plugins/create-scheduled-job/index.js`, `server/utils/agents/ephemeral.js`,
  `server/utils/http/index.js`, `frontend/src/pages/GeneralSettings/ScheduledJobs/**`,
  `frontend/src/components/WorkspaceChat/ChatContainer/ChatHistory/ScheduledJobCreatedCard/index.jsx`.
- goose `2694fff7`: `crates/goose/src/agents/platform_tools.rs`, `crates/goose/src/agents/schedule_tool.rs`,
  `crates/goose/tests/schedule_tool_security.rs`, `crates/goose-cli/src/commands/schedule.rs`,
  `ui/desktop/src/components/schedule/{CronPicker,ScheduleModal,ScheduleDetailView}.tsx`,
  `ui/desktop/src/utils/cronSchedule.ts`.
- Codex `5decb399`: `codex-rs/app-server-protocol/src/protocol/v2/plugin.rs`,
  `codex-rs/app-server-protocol/schema/typescript/v2/ScheduledTask*.ts`, `codex-rs/core-plugins/src/remote.rs`.
- LibreChat `f7bc50ae`: `packages/api/src/skills/sync/scheduler.ts` (+ repo-wide `cron` search).
- opencode `ff0382e9`, Continue `5522c6f4`: repo-wide searches;
  `packages/terminal-security/src/evaluateTerminalCommandSecurity.ts:854`.

**Secondary (REPORTED):**

- `learn.chatgpt.com/docs/automations` (schedule/destination/model/tools fields; "The Scheduled view acts
  as your inbox…"; "Skills can also create or update scheduled tasks").
- `github.com/asgeirtj/system_prompts_leaks` → `OpenAI/gpt-5.5-thinking.md` §Namespace: automations.
- `github.com/jujumilk3/leaked-system-prompts` → `openai-chatgpt5_20250807.md` §automations.
- `simonwillison.net/2025/Jan/15/chatgpt-tasks/` (the original disclosure of the tasks prompt).
- Web search consensus on ChatGPT per-tier active-task limits (3/5/10/15) — no primary source obtained.

---

# Addendum: per-task **results placement** (2026-07-30)

**Asked because:** the owner wants a **per-automation, set-at-create/edit-time** control over where runs
land — fresh thread per run vs one continuing/rolling thread, possibly pinned to an existing thread
later. Question: does any peer expose placement as a per-task user-visible option, and what is the
control and its vocabulary? Same source set as the body; three files re-fetched (open-webui
`utils/timers.py`, goose `scheduler.rs` + `session/session_manager.rs`) plus one re-read of
`learn.chatgpt.com/docs/automations`. Clones/temp cleaned.

## A.1 The one-line answer

**Exactly one peer exposes placement as a per-task choice: ChatGPT.** Every other peer hard-codes a
single placement per *primitive* and, where they wanted the other behaviour, they built a **second
primitive** rather than a field on the first. So the field's answer to "fresh vs rolling" is
**"two features, not one enum"** — and nobody in the class ships a *rolling* thread for a recurring
automation at all.

| Peer | Per-task placement control? | What actually happens | Conf. |
|---|---|---|---|
| **ChatGPT Tasks** | **YES** — a create/edit-time choice | *standalone* → new chat per run, results in **Scheduled**; or *inside an existing chat* → returns to that chat | REPORTED |
| **open-webui `Automation`** | **No** | **always** a brand-new chat per run; `folder_id` only files it | VERIFIED |
| **open-webui `timer`** (separate tool) | n/a — placement is inherent | **pinned to the originating chat**: writes back into `parent_chat_id` | VERIFIED |
| **AnythingLLM** | **No** | log-only; `continueInThread` is an on-demand action per *run*, and makes a **new** thread each press | VERIFIED |
| **Claude Code local cron** | **No** | fires into the **owning session** (creator's, else the lock holder's) | VERIFIED |
| **Claude Code cloud routines** | **No** | fresh isolated cloud session per run | VERIFIED |
| **goose** | **No** | unconditional `create_session(…, SessionType::Scheduled)` per run | VERIFIED |

**Nobody has a rolling/continuing thread for a recurring task.** The two "same conversation" mechanisms
in the class (open-webui `timer`, Claude Code local cron) are both **one-shot-oriented** and both target
a conversation that *already exists for another reason* — they are pins, not rolling logs. If ctrl-b
wants "one rolling automation thread", that is a **net-new design**, not a port. (What does exist and is
close: AnythingLLM's dedicated `scheduled-jobs` **workspace** as a container for automation output —
§A.3.)

## A.2 ChatGPT — the only per-task control (REPORTED)

Vocabulary, verbatim from `learn.chatgpt.com/docs/automations`:

> "**Standalone scheduled tasks start a new chat for each scheduled run and report results in
> Scheduled.**"
> "Use a **standalone** scheduled task when each run should be independent or when one scheduled task
> should run across one or more projects."
> "**Schedule a task inside an existing chat** when you want ChatGPT to return to that chat on a
> schedule."
> "Describe the work, the schedule, and **whether each scheduled run should return to the current chat
> or start a new chat.**"

So the user-facing vocabulary is a binary: **standalone** (new chat per run; results collect in the
**Scheduled** inbox) vs **inside an existing chat / return to the current chat**. The doc's own summary
of the edit form lists **"Destination"** among the fields (that word is the doc-page label, not a quoted
API field name).

**Important asymmetry:** the *tool* the model calls has **no placement parameter** —
`create(prompt, title, timing_mode, schedule?, dtstart_offset_json?)` (§2.1). Placement is therefore
**implicit in the creation context** (created inside a chat → bound to that chat) and adjustable by the
human in the UI, but **not model-selectable**. No field name or enum value is available; this is the
one sub-answer that stays REPORTED, since the API surface is not published.

## A.3 open-webui — placement is a **hard-coded property of each primitive** (VERIFIED)

**`Automation`: always a new chat.** `AutomationData` has no destination field at all —
`{prompt, model_id, rrule, terminal}` (`backend/open_webui/models/automations.py:67-71`), and
`execute_automation` unconditionally mints one:

```python
chat_id = str(uuid4())
chat = await Chats.insert_new_chat(chat_id, automation.user_id, ChatForm(
    folder_id=folder_id,
    chat={'title': automation.name, 'models': [model_id], 'history': {...},
          'meta': {'automation_id': automation.id}}))
```
`backend/open_webui/utils/automations.py:460-499`

**What the "Folder" pill actually controls (the coordinator's Q1):** `folder_id` is a **destination
folder for the per-run chats** — nothing more. It is a real FK on the automation
(`Automation.folder_id`, indexed `ix_automation_user_folder`), validated as owner-owned on create/update
(`check_automation_folder_access`), passed straight into the new chat's `ChatForm(folder_id=…)`, and
**self-healing**: if the folder was deleted between create and fire,
`Automations.clear_folder_ids(...)` nulls it and the run proceeds into no folder
(`utils/automations.py:452-454`). It also doubles as a list filter and as a scoping arg on the agent
tools (`create_automation(..., folder_id?)`, `list_automations(folder_id?)`). **It is grouping, not
placement** — there is no new-chat-vs-same-chat choice anywhere on `Automation`.

**`timer`: pinned to the originating chat — and this is the only real "land in an existing conversation"
implementation I found in any peer's source.** Mechanism (`backend/open_webui/utils/timers.py`, file
docstring: *"Durable one-shot timers backed by internal child chats"*):

1. `create_timer` makes a **hidden child chat** whose `internal_meta` carries the pin:
   `{'internal': True, 'type': 'timer', 'parent_chat_id': …, 'parent_message_id': …, 'timer_at': …,
   'status': 'pending', 'timer_model_id': …, 'timer_task_message_id': …, 'cancel_on': [...], 'run': …}`
   (`timers.py:144-157`).
2. On fire, `execute_due_timer` **writes the user+assistant pair into the parent chat**:
   `await ChatMessages.upsert_message(user_message_id, parent_chat_id, timer.user_id, user_message)`
   (`timers.py:357-358`), and the streamed run uses
   `'session_id': run.get('session_id') or f'timer:{parent_chat_id}'` (`timers.py:381`).
3. **It attaches at the parent's current leaf, not at the message that created it** — the fallback is
   what's recorded:
   ```python
   parent_id = (max(done_assistants, key=lambda m: m.get('timestamp', 0)).get('id')
                if done_assistants else meta.get('parent_message_id'))
   ```
   (`timers.py:311-315`).
4. **The injected user turn is marked as machine-origin:**
   `'meta': {'internal': True, 'type': 'timer', 'timer_id': timer_id}` (`timers.py:325`).

**The three failure modes a pinned/rolling thread must handle — all already solved here, all VERIFIED:**

- **Parent gone** → the timer does not retarget, it fails loudly:
  `_set_timer_state(timer_id, 'error', timer_error='parent chat no longer exists')` (`timers.py:247`,
  re-checked under lock at 289).
- **Parent busy** → it does **not** interleave; it re-queues itself:
  `if await has_active_tasks(app.state.redis, parent_chat_id): … status = 'pending', timer_claim_id =
  None, timer_started_at = None` (`timers.py:290-301`), guarded by a per-parent
  `asyncio.Lock` (`_parent_locks.setdefault(parent_chat_id, …)`) **plus** `SELECT … FOR UPDATE` on
  Postgres.
- **Concurrent/duplicate fire** → a claim id (`timer_claim_id`) checked before doing anything.

Also relevant to a *rolling* design: the timer can be **cancelled by conversation activity** —
`cancel_on: ['chat.read', 'chat.user_message']`, matched against the pin
(`.where(Chat.meta['parent_chat_id'].as_string() == parent_chat_id)`, `timers.py:212`). That is the
inverse coupling of a rolling thread: the destination's state can retire the pending run.

## A.4 AnythingLLM — placement is a **per-run on-demand action**, never a setting (VERIFIED)

The job record's mutable surface is `writable: ["name", "prompt", "tools", "schedule", "enabled"]`
(`server/models/scheduledJob.js:13`) — **no destination field**, and the `scheduled_jobs` table has none
either (§2.4). Runs are log rows; nothing is placed anywhere until the human asks.

`continueInThread(runId)` (`server/models/scheduledJobRun.js:304-355`) is reachable only via
`POST /scheduled-jobs/runs/:runId/:action` with `action ∈ {read, continue, kill}` — i.e. **per run, not
per job**. And it is emphatically *not* a rolling thread:

```js
const { workspace } = await Workspace.upsert({ slug: "scheduled-jobs" },
  { name: "Scheduled Jobs", slug: "scheduled-jobs", chatMode: "automatic" });
const { thread } = await WorkspaceThread.new(workspace);   // NEW thread, unconditionally
await WorkspaceChats.new({ workspaceId: workspace.id, prompt: run.job.prompt,
  response: { text: responseText, sources, outputs, type: "chat" }, threadId: thread.id, include: true });
```

So: the **workspace** is stable and shared (`slug: "scheduled-jobs"`, upserted — the container is the
rolling thing), the **thread is fresh per press**, and pressing *Continue* on two runs of the same job
yields two threads. **A job cannot be configured to always continue one thread** — VERIFIED by the
absence of any destination field plus the unconditional `WorkspaceThread.new`.

Worth stealing regardless: the seeded thread starts with the *original prompt* as the user turn and the
*run's result* as the assistant turn, so the conversation reads correctly from message one.

## A.5 Claude Code — placement is implied by ownership, not chosen (VERIFIED)

**Local cron:** `CronCreate` takes `{cron, prompt, recurring?, durable?}` — **no destination
parameter**. The fired prompt is enqueued into a live session (`mode:"prompt"`, `isMeta:true`,
`priority:"later"`, `wakeupSource:"schedule_wakeup"`) behind the synthetic marker
`Running scheduled task (<time>)`. *Which* session is decided by an **ownership predicate**, not a
setting: a job with `createdBySessionId === <this session>` fires here; a job with no recorded creator
fires in whichever session holds `.claude/scheduled_tasks.lock`; a job whose creator's PID is dead or
recycled falls through to the lock holder. So a durable job created in session A can fire into session B
after a restart. Nearest thing to a "channel" in the class: `onFireTask` routes a job carrying an
`agentId` to that **teammate's** task notification instead
(`ean(p.id, d.prompt, …, {kind:"task-notification"})`), and deletes the cron if the teammate is gone
(*"teammate <id> gone, removing orphaned cron"*).

**Cloud routines:** placement is a fresh isolated session per run, surfaced at
`claude.ai/code/routines/{id}`. There is no destination field — but note one suggestive detail: the
create body's event payload contains `"session_id": ""` (the `/schedule` skill prescribes the empty
string, alongside a self-generated `uuid`). A non-empty `session_id` *might* be the server-side pin
mechanism; the skill never mentions it and I could not test it. **UNVERIFIED.** The stable, documented
reuse dimension is `job_config.ccr.environment_id` — the *environment* persists across runs, the
session does not.

## A.6 goose — one session per run, unconditionally; but a typed **provenance** marker (VERIFIED)

`scheduler.rs` always creates a new session; there is no resume/append path:

```rust
let session = agent.config.session_manager.create_session(
    std::env::current_dir()?,
    format!("Scheduled job: {}", job.id),
    SessionType::Scheduled,
    agent.config.goose_mode,
).await?;
```
`crates/goose/src/scheduler.rs:1023-1032`

`ScheduledJob.current_session_id` is **transient liveness state**, not a destination — it is set here,
cleared on kill, and cleared on load (`scheduler.rs:254-257, 386, 479, 829`, with tests asserting a
stale value is dropped at startup). The tool's undeclared `execution_mode` argument
(`unwrap_or("background")`, `schedule_tool.rs:156-159`) is **read and then only interpolated into the
success message** — it is not stored on `ScheduledJob` and is not in the declared schema, so it is not a
placement control either (VERIFIED).

The transferable idea is the discriminator on the **conversation container**:

```rust
pub enum SessionType { User, Scheduled, SubAgent, Hidden, Terminal, Gateway, Acp }
```
`crates/goose/src/session/session_manager.rs:45-54` (`#[serde(rename_all = "snake_case")]`, default `User`)

## A.7 Pinning to an existing conversation — the full picture

| Mechanism | Peer | Pin field | Conf. |
|---|---|---|---|
| Task created inside a chat "returns to that chat" | ChatGPT | unknown (no published field) | REPORTED |
| `timer` → parent chat | open-webui | `Chat.meta.parent_chat_id` (+ `parent_message_id` as leaf fallback) | VERIFIED |
| cron → owning session | Claude Code local | `createdBySessionId` (+ `createdByPid`/`ProcStart`), not user-set | VERIFIED |
| cron → teammate inbox | Claude Code local | `agentId` on the task | VERIFIED |
| possible session pin | Claude Code routines | `events[].data.session_id` (prescribed `""`) | **UNVERIFIED** |
| stable *container* (not thread) | AnythingLLM | `Workspace{slug:"scheduled-jobs"}` upsert | VERIFIED |
| stable *folder* for per-run chats | open-webui | `Automation.folder_id` | VERIFIED |

## A.8 Naming vocabulary on the table

Nobody publishes an enum for this, so there is no field name to copy — only word choices:

- **ChatGPT (user-facing, the only real precedent):** **`standalone`** vs *"return to the current chat"*;
  the collection surface is **"Scheduled"** and it *"acts as your inbox"*.
- **goose (provenance, code-level):** `SessionType::{User, Scheduled, SubAgent, …}` — mark the
  *conversation*, not the automation.
- **Claude Code (marker on the injected turn):** `isMeta: true`, `wakeupSource: "schedule_wakeup"`,
  visible text `Running scheduled task (<time>)`.
- **open-webui (marker on the injected turn):** `meta: {internal: true, type: 'timer', timer_id}`;
  the pin itself is `parent_chat_id`.
- **Container words used for grouping automation output:** `folder_id` (open-webui),
  `slug: "scheduled-jobs"` workspace (AnythingLLM).

## A.9 Implications for the owner's per-automation setting (short)

1. **A per-task placement field is legitimate but unprecedented in this exact form.** Only ChatGPT gives
   the user the choice, and even it withholds it from the model. Recommendation: make placement a
   **human-set field on the record, not a tool parameter** — mirrors ChatGPT, and keeps the
   agent-facing contract as small as §4.8 argues.
2. **Model it as a tagged destination, not a boolean**, because arm 3 (pin to an existing thread) is
   already anticipated and every peer that hard-coded a boolean had to grow a second primitive. Codex's
   closed-union style (§2.6) applied here: `{kind:"new_thread"} | {kind:"rolling", thread_id?} |
   {kind:"pinned", thread_id}` — one field, additive arms, no unrepresentable states. Put it inside the
   existing nested payload (open-webui's `AutomationData` precedent) so it's an additive field, per our
   own "extend, don't migrate" directive.
3. **A rolling thread is net-new — budget for the three failure modes open-webui already solved for
   pins:** destination deleted (fail the run and record it; do **not** silently retarget), destination
   busy (re-queue, don't interleave — they use a per-parent lock + `has_active_tasks`), and attach-point
   drift (append at the thread's *current leaf*, keeping the recorded id only as a fallback). Any of the
   three, missed, produces a corrupted thread rather than a failed run.
4. **Mark the injected turn, in both the rolling and pinned arms.** All three peers that inject do it
   (`isMeta`/`internal`+`type`+source id) and Claude Code additionally shows a visible
   `Running scheduled task (<time>)` marker. Without it a rolling thread reads as if the *user* said the
   automation's prompt. Our `Actor.AUTOMATION` already carries the audit half; the message-level marker
   is the UI half.
5. **Two cheap wins independent of the enum:** goose's `SessionType::Scheduled`-style discriminator on
   the **thread** (so an automation-produced thread is filterable/badgeable without joining through the
   automation), and AnythingLLM's **stable container** — a single "Automations" grouping for
   `new_thread` output, which is what actually keeps a nightly job from drowning the thread list.
6. **`folder_id` answers a different question than placement** — grouping. If we want ChatGPT's
   *inbox* behaviour, the run table + an unread flag (§3.3) is the mechanism, not the destination field.

## A.10 What I could not determine (addendum)

- **ChatGPT's field name and values** for destination, and whether "return to the current chat" stores a
  conversation id or a weaker back-reference. No published API surface; the word *"Destination"* is a
  doc-page label. REPORTED throughout §A.2.
- **Whether ChatGPT's placement is editable after creation** (the doc lists it among edit-form fields,
  which implies yes, but does not say so).
- **Whether a non-empty `events[].data.session_id` pins a Claude Code routine** to an existing cloud
  session. The skill prescribes `""` and never explains the field. UNVERIFIED.
- **Whether any peer offers a *rolling* destination at all.** Confirmed absent in open-webui,
  AnythingLLM, goose and both Claude Code mechanisms; **UNVERIFIED** for ChatGPT (its "return to that
  chat" on a *recurring* task is arguably rolling-into-a-pre-existing-thread, but the doc frames it as a
  pin to a chat the user already had, and says nothing about how repeated runs stack in it).
- **AnythingLLM's `include: true`** on the seeded `WorkspaceChats.new` — presumably "include in LLM
  context"; not chased.

**Addendum sources re-read:** open-webui `01f4282f` `backend/open_webui/utils/timers.py` (418 L, full),
`backend/open_webui/models/automations.py`, `backend/open_webui/utils/automations.py`;
AnythingLLM `a3c9a262` `server/models/scheduledJob.js`, `server/models/scheduledJobRun.js`,
`server/endpoints/scheduledJobs.js`; goose `2694fff7` `crates/goose/src/scheduler.rs`,
`crates/goose/src/session/session_manager.rs`, `crates/goose/src/agents/schedule_tool.rs`;
Claude Code 2.1.220 (`useScheduledTasks`/`onFireTask`, `/schedule` skill body);
`learn.chatgpt.com/docs/automations` (re-read 2026-07-30).
