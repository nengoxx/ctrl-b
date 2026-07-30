# R7 — Scheduled/unattended agent runs: what drives the schedule?

**Date of pass: 2026-07-30.** Bounded question, set by the main seat:

> For **A3 — scheduled agent automations** (`Automation { id, name, cron, prompt, privilege_level,
> target_thread, enabled, last_run, last_status }` in SQLite, executed headlessly by the *same*
> in-process agent loop the interactive chat uses): **what scheduling mechanism should drive this —
> a library (which, exactly) or a hand-rolled asyncio loop — and what are the design-deciding facts?**

Owner rulings taken as given (not researched, not relitigated): concurrency = **1 global**;
unattended-gate policy = **per-automation skip/use-default**; the runner lives **inside** the FastAPI
process (no sidecar, no external cron daemon, no celery/redis).

**Confidence key** — every claim below carries one:
- **[V]** verified: I read the source file / ran the code / probed the API in this pass.
- **[R]** reported: primary-but-secondary source (official docs, changelog, upstream commit message).
- **[U]** unverified: expected by construction or by reputation; explicitly *not* checked.

**Verdict up front:** the peer class overwhelmingly hand-rolls the *trigger* and keeps the *schedule
arithmetic* in a library. Four of the five peers that ship this feature run a **poll-and-claim loop
over their own DB table**; only one (LiteLLM) hands the whole job to APScheduler, and it does so for
fixed-interval maintenance jobs, not user-authored schedules. The one library that is genuinely
load-bearing everywhere is a **cron-expression parser**, and APScheduler 3.x's `from_crontab()` has a
verified, upstream-documented **weekday off-by-one** that disqualifies it for user-typed crontab lines.

---

## 1. Angle 1 — how the peer class actually does it

### 1.0 Scoreboard

| Project | Has scheduled agent runs? | What drives the clock | Cron parser | Where it runs | Misfire (app was down) | "Currently running" tracked in |
|---|---|---|---|---|---|---|
| **AnythingLLM** | **Yes** (Scheduled Jobs, full UI + agent tool) [V] | own `later.setInterval` timers + `p-queue` | `@breejs/later` + `cron-validate` [V] | child **process** per run | dropped (timers recomputed at boot) [V] | **DB row status** (`queued`/`running`) [V] |
| **open-webui** | **Yes** ("Automations") [V] | hand-rolled `while True` poll loop, 10 s [V] | **none — RRULE** via `dateutil.rrule` [V] | in-process `asyncio.create_task` [V] | **one catch-up run**, then back on schedule [V] | nothing — claim advances `next_run_at` [V] |
| **goose** | **Yes** (schedules + agent `schedule` tool) [V] | `tokio-cron-scheduler` 0.15 (library) [V] | that library (6-field) [V] | in-process async task | dropped; stale `currently_running` cleared at boot [V] | **persisted bool** in `schedule.json` [V] |
| **LiteLLM** | Maintenance jobs, not user agent runs [V] | **APScheduler `AsyncIOScheduler`** in the FastAPI lifespan [V] | `CronTrigger.from_crontab` [V] | in-process | `misfire_grace_time=3600` + `coalesce` [V] | `max_instances=1` + a DB pod-lock [V] |
| **Claude Code** | **Yes**, three tiers (`/loop`, Desktop, cloud Routines) [R] | **1 s poll loop**, fires between turns [R] | own 5-field parser, no extended syntax [R] | in-session / local / Anthropic cloud [R] | **no catch-up; coalesce to one** [R] | turn boundary — "waits until the current turn ends" [R] |
| **Codex CLI** | Declarative only; execution is cloud-side [V] | n/a in the OSS repo | **no cron** — structured enum [V] | ChatGPT/Codex cloud [V] | n/a | n/a |
| **opencode** | **No** — zero files matching `cron|schedul` in 6 352 [V] | — | — | — | — | — |
| **Continue.dev** | **No** — zero matching paths in 3 058 [V] | — | — | — | — | — |
| **LibreChat** | **No** agent scheduling; only a skills-sync timer [V] | self-rescheduling `setTimeout` chain [V] | none (interval minutes) | in-process | dropped | `stopped` flag [V] |

### 1.1 AnythingLLM — the closest analogue to A3 (VERIFIED, read in full)

Record shape (`server/prisma/schema.prisma:403-429`) [V] — near-identical to our proposed
`Automation`, with runs split into a child table rather than `last_run`/`last_status` columns:

```prisma
model scheduled_jobs {
  id        Int                  @id @default(autoincrement())
  name      String
  prompt    String
  tools     String? // JSON array of tool identifiers (null = use all enabled agent skills)
  schedule  String // Cron expression
  enabled   Boolean              @default(true)
  lastRunAt DateTime?
  nextRunAt DateTime?
  createdAt DateTime             @default(now())
  updatedAt DateTime             @default(now())
  runs      scheduled_job_runs[]
}

model scheduled_job_runs {
  id          Int            @id @default(autoincrement())
  jobId       Int
  status      String         @default("queued") // queued | running | completed | failed | timed_out — model always sets explicitly
  result      String? // JSON execution trace
  error       String?
  startedAt   DateTime       @default(now())
  completedAt DateTime?
  readAt      DateTime? // null = unread
  job         scheduled_jobs @relation(fields: [jobId], references: [id], onDelete: Cascade)
}
```

**They deliberately decoupled the clock from the execution** — the single most transferable design
note in this dossier. `server/utils/BackgroundWorkers/index.js` [V]:

```js
  // Scheduled Jobs — in-process cron timers + p-queue
  //
  // Bree tightly couples scheduling with worker spawning — when a
  // Bree cron fires, it directly calls run() which immediately
  // spawns a child process with no way to intercept it. We manage
  // our own cron timers (via later.setInterval) to decouple
  // scheduling from execution so we can route jobs through p-queue
  // for global concurrency control before spawning workers.
  //
  // Per-job dedup lives in the database, not in process memory: any
  // non-terminal row (`queued` or `running`) in scheduled_job_runs means
  // the job has a run in flight. ScheduledJobRun.start() does the check +
  // insert atomically and creates the row in `queued` status. ...
  // Cron-fired and manually-triggered enqueues use the same rule —
  // at most one in-flight run per job, regardless of source.
```

Load-bearing facts:
- **Global concurrency defaults to 1** [V] — `#scheduledJobQueue = new PQueue({ concurrency: Number(process.env.SCHEDULED_JOB_MAX_CONCURRENT) || 1 })`. Independent corroboration of the owner's ruling.
- **The in-flight guard is a DB transaction, not memory** [V] — `ScheduledJobRun.start()` is `prisma.$transaction(... findFirst({status: {in: nonTerminalStatuses}}) → if (existing) return null; → create({status: queued}))`. `enqueueScheduledJob()` skips when it returns null: *"if start returns null, skip enqueuing, schueduled job already has a run in flight"* (sic).
- **Crash recovery at boot** [V] — `BackgroundService.boot()` calls `ScheduledJobRun.failOrphanedRuns()`, which does `updateMany({status: {in: nonTerminalStatuses}}, {status: failed, error: "Server restarted during execution", completedAt: now})`.
- **`queued` vs `running` are distinct on purpose** [V] — the parent inserts `queued`, the *worker* flips to `running` as its first DB write "so `startedAt` reflects actual execution start rather than queue-claim time", via a filtered `updateMany` that no-ops if the row already went terminal.
- **Misfire = dropped.** Timers are `later.setInterval(...)` registered at boot from `ScheduledJob.allEnabled()` after `recomputeNextRunAt(job.id)`; nothing looks at whether a fire was missed while the process was down [V].
- **UTC by decree** [V] — `later.date.UTC()` at module top in both the model and the worker service, with the comment: *"Use UTC time for cron interpretation. This ensures consistent behavior regardless of server timezone (e.g., when running in containers). The frontend is responsible for converting user's local time to UTC."*
- **Cron validation is a separate library** [V] — `isValidCron()` wraps `cron-validate`; `computeNextRunAt()` wraps `later.parse.cron` + `later.schedule(...).next(1)`.

The unattended gate (`server/jobs/run-scheduled-job.js`) [V] — they auto-approve *everything* and
contain the run with a per-job tool allowlist plus a hard timeout:

```js
    // Auto-approve all tool invocations when running a scheduled job
    agentHandler.aibitat.requestToolApproval = async () => {
      log("Tool approval requested for scheduled job, auto-approving");
      return { approved: true, message: "Auto-approved by scheduled job runner." };
    };
```
```js
    // Tool overrides control which tools the agent can use:
    // - Array with items: only those specific tools are loaded
    // - Empty array: no tools are loaded
    const toolOverrides = safeJsonParse(job.tools, []);
```
`SCHEDULED_JOB_TIMEOUT_MS = Number(process.env.SCHEDULED_JOB_TIMEOUT_MS) || 5 * 60 * 1000` [V],
enforced with `Promise.race([startAgentCluster(), timeout])`; timeout maps to the distinct
`timed_out` status. Results surface three ways: the run row (unread via `readAt`), a web-push
notification, and `ScheduledJobRun.continueInThread(runId)` which *"will create a new workspace and
thread specific for the run if they do not exist, and add the run's response to the thread"* [V] —
i.e. their equivalent of our `target_thread` is materialised lazily, at read time.

### 1.2 open-webui — "Automations", a hand-rolled poll loop + DB claim (VERIFIED)

`backend/open_webui/utils/automations.py` module docstring [V]:

```
Automation utilities and unified scheduler.

RRULE helpers, scheduler worker loop, and execution logic.
Follows the utils/<feature>.py pattern (cf. utils/channels.py, utils/task.py).

The scheduler_worker_loop handles all time-based background work:
  - Automation execution (claim_due → execute)
  - Calendar event alerts (upcoming events → socket + webhook notifications)
  - One-shot chat timers

Environment:
    SCHEDULER_POLL_INTERVAL             – seconds between polls (default: 10)
```

- **The loop is ~55 lines of plain asyncio** [V]: `while True:` → poll timers each `TIMER_POLL_INTERVAL` (1 s) → every `SCHEDULER_POLL_INTERVAL` (10 s) `+ random.uniform(0, 2)` jitter, `claim_due(now_ns, limit=10)` and `asyncio.create_task(execute_automation(app, automation))` per row. Every stage is wrapped in its own `try/except Exception: log.exception(...)` so one bad automation can't kill the loop.
- **Started fire-and-forget in the lifespan** — `backend/open_webui/main.py:374-376` [V]:
  ```python
  from open_webui.utils.automations import scheduler_worker_loop

  asyncio.create_task(scheduler_worker_loop(app))
  ```
  No task reference is retained (a documented CPython GC hazard); we already keep engine task refs, so this is a pattern to *not* copy.
- **No cron at all — iCalendar RRULE** [V], parsed with `dateutil.rrule.rrulestr`. `validate_rrule()` raises on malformed *and on exhausted* rules (`if rule.after(now) is None: raise ValueError(... AUTOMATION_NO_FUTURE_RUNS)`), and `next_n_runs_ns(s, n=5, tz)` exists purely to render a **next-N-fires preview in the UI** [V].
- **The claim is the concurrency/misfire mechanism.** `models/automations.py:282+` [V]:
  ```python
  async def claim_due(self, now_ns: int, limit: int = 10, db=None) -> list[AutomationModel]:
      """
      Atomically claim due automations for execution.

      Advances next_run_at immediately so the row can never be
      double-claimed. On PostgreSQL, uses FOR UPDATE SKIP LOCKED
      for zero-contention distributed work claiming.
      """
  ```
  …then `row.last_run_at = now_ns; row.next_run_at = next_run_ns(row.data.get('rrule',''), tz=...)`.
  **Misfire semantics fall out of this for free: exactly one catch-up run after downtime**, then the
  row re-aligns to the schedule (because `next_run_at` is recomputed from *now*, not from the missed
  slot). There is no `running` flag and no global concurrency cap — up to 10 automations can execute
  concurrently per poll.
- **Record shape** (`Automation` table) [V]: `id, user_id, folder_id, name, data (JSON: {prompt, model_id, rrule}), meta, is_active, last_run_at, next_run_at, created_at, updated_at`, with `Index('ix_automation_next_run', 'next_run_at')`. Runs go to a sibling `AutomationRun { id, automation_id, chat_id, status (success|error), error, created_at }`.
- **Headless execution reuses the interactive path** [V] — exactly our A3 premise:
  ```python
  async def execute_automation(app, automation: AutomationModel) -> None:
      """Execute an automation through the full chat completion pipeline.

      Creates a real chat, then calls chat_completion exactly like the frontend:
      session_id + chat_id + message_id → async task → pipeline handles everything
      (filters, model params, knowledge/RAG, tools, DB saves, webhooks).
      """
  ```
  It fabricates an ASGI scope to build a `Request` and mints a token so tool servers can
  authenticate *as the automation owner* — "`request.state.token` so session-auth tool servers and
  terminals can authenticate headless scheduled runs as the automation owner".
- **The headless-gap gotcha, in their own words** [V]: `code_interpreter` is excluded from
  automation runs because *"it requires the frontend event emitter and does not work in headless
  backend execution."* Any of our tools that assume a live SSE consumer needs the same audit.
- **APScheduler is pinned but appears unused.** `backend/requirements.txt:39` and `pyproject.toml:48`
  both pin `APScheduler==3.11.2` [V], yet a GitHub code search across the repo for `AsyncIOScheduler`
  and `CronTrigger` returns **zero** hits and `APScheduler` matches only the three manifest files
  [V, search-based — *not* clone-verified; code search can under-index]. Read as: a dependency kept
  for user pipelines/legacy, not the mechanism.

### 1.3 goose — a real scheduler library, in-process (VERIFIED)

The repo moved (`block/goose` → **`aaif-goose/goose`**, 51 957 stars, pushed 2026-07-30) [V].
`crates/goose/Cargo.toml:142` [V]: `tokio-cron-scheduler = { version = "0.15", default-features = false }`.
`bin/temporal` and `bin/.temporal-cli-1.3.0.pkg` survive as tiny stubs and there is **no
`temporal_scheduler.rs`** — the earlier Temporal-backed scheduler is gone [V]; `scheduler_trait.rs`
(46 lines, 14 methods) is the seam it left behind, and the only implementation is the in-process one.

The persisted record (`crates/goose/src/scheduler.rs:215-236`) is our `Automation` plus liveness [V]:

```rust
pub struct ScheduledJob {
    pub id: String,
    pub source: String,
    pub cron: String,
    pub last_run: Option<DateTime<Utc>>,
    #[serde(default)] pub currently_running: bool,
    #[serde(default)] pub paused: bool,
    #[serde(default)] pub current_session_id: Option<String>,
    #[serde(default)] pub process_start_time: Option<DateTime<Utc>>,
    #[serde(default)] pub parameters: Vec<(String, String)>,
    #[serde(default)] pub recipe_base_dir: Option<String>,
}
```

- **A 5-field cron is silently upconverted to 6** because the library wants seconds [V]:
  ```rust
  let cron = match cron_parts.len() {
      5 => { tracing::warn!("Job '{}' has legacy 5-field cron '{}', converting to 6-field", job.id, job.cron);
             format!("0 {}", job.cron) }
      6 => job.cron.clone(),
      _ => return Err(SchedulerError::CronParseError(format!("Invalid cron expression '{}': expected 5 or 6 fields, got {}", job.cron, cron_parts.len()))),
  };
  ```
- **Liveness is written through to disk on both edges of a run** [V]: the task body sets
  `last_run`/`currently_running`/`process_start_time`, calls `persist_jobs()`, runs, then clears them
  and persists again. Cancellation is a `CancellationToken` per running job in a
  `HashMap<String, CancellationToken>` (`kill_running_job`).
- **Crash recovery is the same idea as AnythingLLM's, in a file** [V]: on load, every job goes
  through `clear_running_state(job)` (clears `currently_running`, `current_session_id`,
  `process_start_time`) and, if anything changed, the file is rewritten before any job is registered.
- **Misfire = dropped** [V]: load re-registers each job with the library; nothing consults the
  missed window. `paused` is checked *inside* the fire callback (`if !should_execute { return; }`),
  so pausing does not need to touch the trigger.
- Per-job serialisation exists (`run_now` refuses when `currently_running`; pause/update refuse
  while running) but there is **no global concurrency cap** [V].
- Its UI is worth stealing from: a period-based builder (`minute|hour|day|week|month|quarter|year|custom`)
  over a 6-field cron, with `cronstrue` for the human-readable line, and the same
  5-field→6-field normalisation duplicated in TS (`ui/desktop/src/utils/cronSchedule.ts`) [V].
- The agent can manage schedules **as a tool** (`crates/goose/src/agents/schedule_tool.rs`,
  501 lines, with a dedicated `schedule_tool_security.rs` test file) [V].

### 1.4 LiteLLM — the one peer that hands it to APScheduler (VERIFIED)

`pyproject.toml:54` [V]: `"apscheduler>=3.11.2,<4.0"` — i.e. a maintained project's judgement, in
mid-2026, that **4.x is not for production**. Wired inside the FastAPI lifespan
(`proxy_startup_event` at `litellm/proxy/proxy_server.py:869` → `initialize_scheduled_background_jobs`
at :7928 → `scheduler.start(paused=False)` at :8215) [V].

The instructive part is what they had to do to keep it healthy [V]:

```python
        # MEMORY LEAK FIX: Configure scheduler with optimized settings
        # Memray analysis showed APScheduler's normalize() and _apply_jitter() causing
        # massive memory allocations (35GB with 483M allocations)
        # Key fixes:
        # 1. Remove/minimize jitter to avoid normalize() memory explosion
        # 2. Use larger misfire_grace_time to prevent backlog calculations
        # 3. Set replace_existing=True to avoid duplicate jobs
        scheduler = AsyncIOScheduler(
            job_defaults={ "coalesce": APSCHEDULER_COALESCE,
                           "misfire_grace_time": APSCHEDULER_MISFIRE_GRACE_TIME,
                           "max_instances": APSCHEDULER_MAX_INSTANCES },
            jobstores={"default": MemoryJobStore()},  # explicitly use memory job store
            executors={"default": AsyncIOExecutor()},
            timezone=None,   # Disable timezone awareness to reduce computation
        )
```

with, in `litellm/constants.py:1483-1494` [V]:

```python
# APScheduler Configuration - MEMORY LEAK FIX
# These settings prevent memory leaks in APScheduler's normalize() and _apply_jitter() functions
APSCHEDULER_COALESCE = ...  # collapse many missed runs into one
APSCHEDULER_MISFIRE_GRACE_TIME = int(os.getenv("APSCHEDULER_MISFIRE_GRACE_TIME", 3600))  # ignore runs older than 1 hour (was 120)
APSCHEDULER_MAX_INSTANCES = int(os.getenv("APSCHEDULER_MAX_INSTANCES", 1))  # prevent concurrent job instances
```

Caveats to that datapoint: the pathology was at *their* scale (a proxy with hundreds of jobs and
`jitter`), the jobs are fixed-interval maintenance, and **they hand-rolled the jitter themselves**
(`budget_interval = min_time + random.randint(0, min(30, max_time-min_time))`) rather than use the
library's. The only *user-authored* cron in LiteLLM is a spend-log cleanup schedule, and it shows the
right shape for our validation story [V]:

```python
            if cleanup_cron:
                from apscheduler.triggers.cron import CronTrigger
                try:
                    cron_trigger = CronTrigger.from_crontab(cleanup_cron)
                    scheduler.add_job(..., id="spend_log_cleanup_job", replace_existing=True,
                                      misfire_grace_time=APSCHEDULER_MISFIRE_GRACE_TIME)
                except ValueError:
                    verbose_proxy_logger.error(f"Invalid maximum_spend_logs_cleanup_cron value: {cleanup_cron}")
```

Multi-instance dedup is *not* APScheduler's job here: they added `pod_lock_manager.py` with
`DEFAULT_CRON_JOB_LOCK_TTL_SECONDS` [V]. Single-process installs (us) don't need it.

### 1.5 Claude Code — three tiers, and the most explicit policy write-up (REPORTED, official docs)

From `code.claude.com/docs/en/scheduled-tasks` (in-session `/loop` + `CronCreate`/`CronList`/`CronDelete`) [R]:

- **The clock is a poll loop and firing is turn-aligned** — *"The scheduler checks every second for
  due tasks and enqueues them at low priority. A scheduled prompt fires between your turns, not while
  Claude is mid-response. If Claude is busy when a task comes due, the prompt waits until the current
  turn ends."*
- **Misfire policy stated flatly** — *"No catch-up for missed fires. If a task's scheduled time
  passes while Claude is busy on a long-running request, it fires once when Claude becomes idle, not
  once per missed interval."*
- **Local timezone, not UTC** — *"All times are interpreted in your local timezone. A cron expression
  like `0 9 * * *` means 9am wherever you're running Claude Code, not UTC."*
- **A deliberately narrow cron dialect** — *"`CronCreate` accepts standard 5-field cron expressions…
  All fields support wildcards (`*`), single values (`5`), steps (`*/15`), ranges (`1-5`), and
  comma-separated lists (`1,15,30`). … Day-of-week uses `0` or `7` for Sunday through `6` for
  Saturday. Extended syntax like `L`, `W`, `?`, and name aliases such as `MON` or `JAN` is not
  supported."* Plus vixie OR semantics: *"When both day-of-month and day-of-week are constrained, a
  date matches if either field matches."*
- **Deterministic jitter, derived from the ID** — *"Recurring tasks fire up to 30 minutes after the
  scheduled time (or up to half the interval, for tasks that run more often than hourly)… The offset
  is derived from the task ID, so the same task always gets the same offset."* Rationale: *"To avoid
  every session hitting the API at the same wall-clock moment."*
- **Blast-radius bounds:** recurring tasks self-delete after 7 days (*"This bounds how long a
  forgotten loop can run"*); max 50 tasks per session; a global kill switch
  `CLAUDE_CODE_DISABLE_CRON=1`.

From `code.claude.com/docs/en/routines` (the cloud tier) [R]:
- **Presets first, cron as an escape hatch** — *"Pick a preset frequency… hourly, daily, weekdays, or
  weekly"*; *"For a custom interval… pick the closest preset in the form, then run `/schedule update`
  in the CLI to set a specific cron expression. The minimum interval is one hour; expressions that
  run more frequently are rejected."*
- **Wall-clock intent survives the timezone** — *"Times are entered in your local zone and converted
  automatically, so the routine runs at that wall-clock time regardless of where the cloud
  infrastructure is located."* Plus a *"consistent for each routine"* stagger.
- **The unattended-gate framing we should adopt** — *"Routines run autonomously as full Claude Code
  cloud sessions: there is no permission-mode picker and no approval prompts during a run"*, and
  crucially: *"the trigger attests only that the prompt was stored ahead of time by an authorized
  session on your account, so the fired prompt is not live user input and can't act as approval or
  consent for actions during the run."* Any run-time payload arrives wrapped as untrusted data
  (`<routine-fire-payload>`), and a routine's prompt must *opt in* to acting on it.
- Green status ≠ success: *"A green status in the run list means the session started and exited
  without an infrastructure error. It does not mean the task in your prompt succeeded."* — a direct
  argument for `last_status` being richer than a boolean.

### 1.6 Codex CLI — a structured schedule, no cron string, no local scheduler (VERIFIED)

`codex-rs/app-server-protocol/src/protocol/v2/plugin.rs:706-755` [V]:

```rust
    pub scheduled_tasks: Option<Vec<ScheduledTaskSummary>>,
...
pub struct ScheduledTaskSummary { pub key: String, pub name: String, pub prompt: String, pub schedule: ScheduledTaskSchedule }

pub enum ScheduledTaskSchedule {
    Hourly { interval_hours: u32, days: Option<Vec<ScheduledTaskWeekday>> },
    Daily { time: String },
    Weekdays { time: String },
    Weekly { days: Vec<ScheduledTaskWeekday>, time: String },
}

pub enum ScheduledTaskWeekday { Mo, Tu, We, Th, Fr, Sa, Su }
```

`ScheduledTask*` appears **only** in the plugin protocol + generated TS/JSON schema — the whole
`codex-rs` tree has no cron parser and no scheduler; execution belongs to the cloud tasks backend
(`codex-rs/cloud-tasks-client/`), whose `api.rs` has no schedule surface at all [V]. Reading: a
plugin *declares* task templates; the schedule vocabulary is closed and machine-checkable, exactly
the opposite bet from a free-text cron field.

### 1.7 Clear negatives (a "does not have it" is a finding)

- **opencode** (now `anomalyco/opencode`): **0 of 6 352 files** match `cron|schedul` [V, path-level].
- **Continue.dev**: **0 of 3 058** [V, path-level].
- **LibreChat**: no agent scheduling. The only scheduler is
  `packages/api/src/skills/sync/scheduler.ts` (103 lines) for GitHub skill sync [V] — a
  self-rescheduling `setTimeout` chain worth one note, because it names a hazard the Node world has
  and Python doesn't: `const NODE_TIMER_MAX_MS = 2147483647;` with
  `SKILL_SYNC_MAX_TIMER_INTERVAL_MINUTES = Math.floor(NODE_TIMER_MAX_MS / 60_000)` (≈24.8 days) —
  a JS timer silently fires *immediately* past that bound. It also clamps the interval
  (`min 5 minutes`), calls `timer.unref?.()`, and re-reads config on every tick so edits take effect
  without a restart.
- **Healthchecks** (out of the reference class, but it is *the* cron-domain Python app and cronsim's
  home): `hc/api/management/commands/sendalerts.py` is a `while not self.shutdown:` loop with
  `time.sleep(2)` and compare-and-swap claiming — `q = Check.objects.filter(id=check.id,
  status=old_status); num_updated = q.update(...)` [V]. Same poll-and-claim shape as open-webui, in
  Python, in a codebase whose entire product is cron correctness.

---

## 2. Angle 2 — the Python mechanism, with numbers

All numbers below measured **on this box, 2026-07-30, CPython 3.14.4**, in throwaway `uv` venvs
(`uv venv -p 3.14`; baseline empty `site-packages` = 16 KB) [V].

### 2.1 Dependency weight and Python 3.14 status

| Package | Latest | Released | Pkgs added | `site-packages` | Transitive | 3.14 classifier | 3.14 in CI | Dev status |
|---|---|---|---|---|---|---|---|---|
| **APScheduler** | **3.11.3** | 2026-06-28 | 2 | **464 KB** | `tzlocal>=3.0` (→ `tzdata` on Windows only) | **yes** | yes (3.8→3.14 matrix; gevent/twisted excluded ≥3.14) | Production/Stable |
| APScheduler 4.x | **4.0.0a6** | **2025-04-27** | — | 3.1 MB sdist | anyio, attrs, tenacity… | — | — | **alpha, 15 months stale** |
| **croniter** | **6.2.4** | 2026-07-10 | **3** | **896 KB** | `python-dateutil` → `six` | **no** (3.9→3.13) | **no** (matrix tops at 3.13) | 4 - Beta |
| **cronsim** | **2.7** | 2025-10-21 | **1** | **104 KB** | **none** | no | **yes** (3.10→3.14, `allow-prereleases`) | Production/Stable |
| cron-converter | 1.3.1 | 2025-12-02 | 3 | 704 KB | `python-dateutil` → `six` | no | not checked [U] | Production/Stable |

All three candidates import and compute correctly on 3.14.4 [V]; `AsyncIOScheduler` + `CronTrigger`
fired twice in a 2.2 s asyncio smoke test [V]. Note we currently ship **no** `python-dateutil`, so
croniter is a genuine +3 packages / +880 KB, while cronsim is +1 / +88 KB and APScheduler is +2 / +448 KB.

### 2.2 APScheduler 4.x is not a candidate in mid-2026 [V]

- PyPI's latest non-prerelease is **3.11.3**; the newest 4.x artifact is **4.0.0a6 (2025-04-27)** [V].
- `master` (the 4.x line) has had **no feature commits since 2026-04-04** — the last five are
  `Bump actions/checkout from 6 to 7` (2026-07-12), a pre-commit autoupdate, two dependabot bumps and
  "Added a security policy" [V]. Meanwhile the `3.x` branch shipped real fixes in June 2026 (DST
  spring-forward with ZoneInfo #1114, job-store link fix, the release) [V].
- LiteLLM, a large production consumer, pins `apscheduler>=3.11.2,<4.0` [V].
- Repo is alive and not archived (7 584 stars, pushed 2026-07-12) [V] — this is a *maintained 3.x,
  parked 4.x*, not an abandoned project.

### 2.3 The disqualifier for `CronTrigger.from_crontab()`: weekday numbers

Upstream added this warning to the 3.x docstring on **2026-06-28** (`ff68780d`,
`src/apscheduler/triggers/cron/__init__.py`) [V, read the commit patch]:

```
.. warning:: Due to a historical mistake, there is a mismatch between weekday
    numbers, as APScheduler treats 0 as Monday while the original crontab treats
    it as Sunday. This has been rectified in the v4.x series but cannot be
    changed in the 3.x series due to backwards compatibility. See
    `issue 286 <https://github.com/agronholm/apscheduler/issues/286>`_ for more
    information.
```

Measured, same expression, same tz (`Europe/Madrid`), base 2026-07-30 12:00 [V]:

| Expression | APScheduler 3.11.3 | croniter 6.2.4 | cronsim 2.7 |
|---|---|---|---|
| `0 9 * * 0` | **Mon 2026-08-03** ❌ | Sun 2026-08-02 | Sun 2026-08-02 |
| `0 9 * * 7` | **ValueError** ❌ | Sun 2026-08-02 | Sun 2026-08-02 |
| `*/15 * * * *` @12:00:00 | 12:00 (**inclusive of now**) | 12:15 | 12:15 |
| `@daily` | ValueError | Fri 00:00 ✅ | CronSimError |
| `0 9 L * *` | ValueError | Fri 2026-07-31 | Fri 2026-07-31 |
| `0 9 * * 5#2` | ValueError | Fri 2026-08-14 | Fri 2026-08-14 |
| `61 * * * *` | ValueError ✅ | CroniterBadCronError ✅ | CronSimError("Bad minute") ✅ |

So: a user (or an LLM) typing the standard `0 9 * * 0` for "Sunday 9am" gets **Monday** under
APScheduler 3.x, silently, and `7` is rejected outright though real cron accepts it. The third row is
a semantics note rather than a bug — APS's `get_next_fire_time(None, now)` is *inclusive* of `now`
while croniter/cronsim are strictly-after; a hand-rolled loop that mixes the two conventions
double-fires.

### 2.4 DST behaviour differs between all three [V]

`30 2 * * *` in `Europe/Madrid`, spring-forward 2027-03-28 (02:00 CET → 03:00 CEST):

| | fire instant | local |
|---|---|---|
| APScheduler | `2027-03-28T02:30:00+01:00` = 01:30 Z | **03:30 CEST** (an hour late) |
| croniter | `2027-03-28T03:00:00+02:00` = 01:00 Z | **03:00 CEST** |
| cronsim | `2027-03-28T03:00:00+02:00` = 01:00 Z | **03:00 CEST** |

Fall-back 2026-10-25 (03:00 CEST → 02:00 CET), the ambiguous 02:30:

| | fires |
|---|---|
| APScheduler | 02:30 CEST **and** 02:30 CET (**twice**) |
| croniter | 02:30 CEST **and** 02:30 CET (**twice**) |
| cronsim | 02:30 CEST only, then next day (**once**) |

cronsim is explicit that this is the goal — README §"DST Transitions" [V]: *"CronSim handles Daylight
Saving Time transitions the same as Debian's cron"*, quoting Debian's man page: *"If time has moved
forward, those jobs that would have run in the interval that has been skipped will be run
immediately. Conversely, if time has moved backward, care is taken to avoid running jobs twice."*
(Its development priorities, verbatim: *"Correctness. CronSim tries to match Debian's cron as closely
as possible, including its quirky behaviour during DST transitions."*)

### 2.5 croniter's maintenance scare: real, and resolved [V]

The premise in the brief is correct and now superseded — the full arc, from the changelog [V]:

- **6.0.0 (2024-12-17):** *"Announce for now that croniter dev is ended (CRA)."* (the original
  maintainer, kiorky, stepping back, citing the EU Cyber Resilience Act.)
- **6.1.0 (2026-03-14):** *"Announce back that croniter is maintained now as part of pallets-eco."*
  — same release rewrote the DST logic (*"Fix DST handling by rewriting the DST logic"*) and removed
  two global-dict memory leaks.
- **Today:** `github.com/kiorky/croniter` **redirects to `pallets-eco/croniter`** [V, via API
  redirect]; not archived; last push 2026-07-28; 2 open issues; releases 6.2.3 (2026-07-02) and
  6.2.4 (2026-07-10) with real bugfixes. README carries the Pallets banner: *"This project is part of
  the Pallets Community Ecosystem… If you are interested in helping maintain this project, please
  reach out on the Pallets Discord server."*

So croniter is alive, but on **community life support**, still classified `4 - Beta`, with **no 3.14
in its CI matrix** and no 3.14 trove classifier [V].

### 2.6 cronsim's other feature: `explain()` [V]

```
>>> CronSim('*/15 9-17 * * MON-FRI', now).explain()
'Every 15th minute from 09:00 through 17:59 on Monday through Friday'
>>> CronSim('0 9 * * 0', now).explain()
'At 09:00 on Sunday'
```

That is the whole reason goose ships `cronstrue` in its frontend — with cronsim it comes free on the
backend, and the UI can render a server-computed description plus a next-N-fires preview (open-webui's
`next_n_runs_ns`) with no JS dependency. Feature matrix from its README [V]: cronsim supports
seconds-in-6th-field, `L`, `LW`, `{weekday}L`, `{weekday}#{nth}`; it does **not** support `@daily`
nicknames (verified above), and it accepts `MON#1`-style names.

### 2.7 The hand-rolled pattern, and the trap that actually bites

The established shape, as found in the field, is **not** "sleep until the next fire time". It is
**poll on a fixed tick, claim due rows in the DB, advance `next_run_at`**:

- open-webui: 10 s tick + `claim_due` + immediate `next_run_at` advance [V]
- Healthchecks: 2 s tick + compare-and-swap `update()` claim [V]
- Claude Code: 1 s tick, enqueued at low priority, fires at a turn boundary [R]
- AnythingLLM: timers per job, but the **dedup and the crash recovery live in the DB** [V]

Why the field prefers a tick over a long sleep: a sleeping task holds a *computed* wake time, which
is invalidated by every edit, pause, delete, clock step and DST change, and it must be cancelled and
recomputed on each; a tick loop re-reads truth from the table every N seconds and needs no
invalidation protocol at all. On a homelab box a 5–10 s tick is free.

**Verified trap for anyone computing the next fire in aware local time** [V] — the ZoneInfo fold:

```python
a = datetime(2026,10,25,2,30, tzinfo=ZoneInfo("Europe/Madrid"), fold=1)  # the SECOND 02:30, 01:30Z
b = a + timedelta(seconds=1)                                            # -> 02:30:01+02:00 = 00:30:01Z
# absolute delta = -1 day, 23:00:01   → went backwards: True
```

Adding a timedelta to an aware ZoneInfo datetime is **wall-clock arithmetic**; during the autumn fold
`x + 1s` can move the *absolute* instant back by an hour, so a loop of the form
`next = trigger.next_after(prev + 1s)` re-fires the same slot forever. (I hit exactly this while
probing APScheduler and briefly mistook it for a library bug.) Mitigation, and the reason
open-webui stores `next_run_at` as **epoch nanoseconds** [V] and Healthchecks compares against
`now()` in UTC: do all arithmetic on UTC/timestamps; convert to local only to *evaluate the cron
fields*.

### 2.8 uvicorn / lifespan notes for the library option [V]

- `AsyncIOScheduler.start()` does `self._eventloop = asyncio.get_running_loop()` (3.11.3 source) —
  it must be started from *inside* the loop, i.e. in the lifespan, not at import time. It then drives
  itself with `self._eventloop.call_later(wait_seconds, self.wakeup)` and marshals external calls
  with `call_soon_threadsafe` [V].
- `shutdown()` raises `SchedulerNotRunningError` if not running — a lifespan teardown must guard [V].
- With a `MemoryJobStore` (the only sane choice when our SQLite table is the source of truth) there
  is **no persisted misfire information**: after a restart, jobs are re-added and the trigger is
  recomputed from now, so "the app was down when it was due" is *silently a skip*, and
  `misfire_grace_time`/`coalesce` only cover *within-process* lateness (event-loop starvation, a
  long-running previous job). Verbatim, from the installed 3.11.3 `schedulers/base.py:470-475` [V]:
  *"misfire_grace_time: seconds after the designated runtime that the job is still allowed to be run
  (or None to allow the job to run no matter how late it is)"*; *"coalesce: run once instead of many
  times if the scheduler determines that the job should be run more than once in succession"*;
  *"max_instances: maximum number of concurrently running instances allowed for this job"*.
  **Consequence: any catch-up policy we want, we implement ourselves either way.** The library buys
  the trigger arithmetic and a per-job `max_instances`, not the misfire policy we care about.
- `max_instances` is **per job**, so "concurrency = 1 globally" is not expressible in APScheduler 3.x
  configuration — it needs our own semaphore/queue regardless [V, by API].
- Multi-worker duplication (`--workers N` → N schedulers → N fires) applies to any in-process
  scheduler, library or hand-rolled; our prod runs a single uvicorn process, so it's a documentation
  item, not a design constraint. LiteLLM's random per-process offsets are their mitigation [V].

---

## 3. Implications for ctrl-b (short, and separable from the evidence above)

1. **Don't use APScheduler for A3.** It would buy us: `CronTrigger` arithmetic and a per-job
   `max_instances`. It would cost us: the `from_crontab` weekday-0 mismatch on the exact field the
   owner will type, a 4.x line that is parked while we'd be pinning `<4.0`, its own timer machinery
   duplicating a loop we already know how to run, and *still* our own misfire policy and our own
   global-concurrency gate. The only peer using it uses it for interval maintenance jobs, not
   user-authored schedules.
2. **Buy the parser, hand-roll the trigger.** A `SCHEDULER_TICK` loop in the lifespan (5–10 s,
   configurable — no magic number), `SELECT … WHERE enabled AND next_run_at <= now ORDER BY
   next_run_at`, claim by writing `last_run`/advancing `next_run_at` in the same transaction, then run
   through a single global gate. That is open-webui's and Healthchecks' shape and it composes with the
   engines we already run in-process.
3. **`cronsim` is the parser that fits us**: zero dependencies, 88 KB, 3.14 in CI, `Production/Stable`,
   correct crontab weekday semantics, Debian-compatible DST (no double-fire on the fold), a validation
   exception we can surface in the API, and `explain()` for the UI. croniter is the alternative but
   costs +3 packages / 880 KB, has no 3.14 CI, and is on community life support after a real
   end-of-development announcement.
4. **The A3 record needs two fields it doesn't have yet**: `next_run_at` (indexed — it *is* the claim
   predicate, and it's what makes "next run" cheap to render) and a run-liveness marker. Every peer
   that survived a crash has the second one: AnythingLLM's `queued|running` rows +
   `failOrphanedRuns()`, goose's `currently_running` + `clear_running_state()` at load. Ours must
   sweep at startup, or a crash mid-run leaves an automation permanently "running" and it never fires
   again.
5. **Pick the misfire policy explicitly; it's a one-line consequence of the claim.** Advance
   `next_run_at` from *now* → exactly one catch-up run after downtime (open-webui). Advance to the
   next occurrence *after the missed slot* and skip if the slot is older than a grace window → skip
   (goose, Claude Code). Claude Code's phrasing is the useful default to copy: *"fires once …, not
   once per missed interval"*.
6. **`last_status` should not be a boolean.** AnythingLLM has five states
   (`queued|running|completed|failed|timed_out`), and Claude Code's docs warn that a green status only
   means the session didn't crash. A per-run timeout (theirs: 5 min, env-tunable) with its own
   terminal state is cheap now and impossible to retrofit into a boolean.
7. **Cron dialect: narrow it, and describe it back.** Claude Code accepts 5 fields and explicitly
   rejects `L`/`W`/`?`/name-aliases; Codex refuses free-text cron entirely in favour of a closed enum;
   open-webui uses RRULE with a next-5-fires preview; goose and AnythingLLM ship a builder UI over
   cron. Whatever we accept, validate on write (the API should reject, not store-and-fail-later) and
   render `explain()` + the next N fires back to the owner — a mistyped schedule is otherwise
   invisible until it doesn't happen.
8. **Timezone: decide, document, store UTC.** AnythingLLM forces UTC interpretation and pushes the
   conversion to the frontend; Claude Code interprets in local time and says so. We are single-user,
   single-box — local-time evaluation matches the owner's intent ("09:00 means 09:00 here"), but the
   stored `next_run_at` must be UTC/epoch, and all arithmetic must be done in UTC (§2.7).
9. **The unattended gate has good prior art.** AnythingLLM auto-approves every tool call and contains
   the run with a per-job tool allowlist plus a timeout. Claude Code's routines run with no approval
   prompts at all, and its docs supply the principle our `privilege_level` field should encode: the
   trigger *"attests only that the prompt was stored ahead of time by an authorized session"* — a
   fired prompt **is not consent**. Our per-automation skip/use-default ruling is squarely in class;
   what's missing from the A3 record by comparison is a per-automation *tool* restriction, which is
   how both peers actually bound the blast radius.
10. **Audit our tools for headless assumptions before wiring the runner.** open-webui had to exclude
    `code_interpreter` from automations because *"it requires the frontend event emitter and does not
    work in headless backend execution"* — we have SSE-emitting paths and a confirm-token flow with
    the same shape.
11. **Two cheap bounds the field considers worth it:** a global kill switch
    (`CLAUDE_CODE_DISABLE_CRON=1`) and a per-run timeout. Claude Code additionally auto-expires
    recurring in-session tasks at 7 days *specifically* to bound a forgotten loop — probably wrong for
    a homelab panel, but the reasoning ("bound the damage a forgotten automation can do") should land
    somewhere, e.g. consecutive-failure auto-disable.

---

## 4. What I could not determine

- **open-webui's APScheduler pin.** I established that nothing in the repo appears to import it
  (code search returns only the three manifests) but did **not** clone and grep the tree, and GitHub
  code search can under-index large repos. Treat "declared but unused" as strong-but-unconfirmed [V-search].
- **`tokio-cron-scheduler`'s internals** (how it computes the next tick, whether it drifts, its DST
  behaviour). I verified goose's *use* of it, not the library. It's Rust, so the finding doesn't
  transfer to our choice — noted only so nobody re-reads goose expecting a Python answer.
- **When goose dropped Temporal, and why.** I verified that no `temporal_scheduler.rs` exists today,
  that `scheduler_trait.rs` is a 14-method trait with one in-process implementation, and that
  `bin/temporal` survives as a 23-byte stub. I did **not** dig the git history for the removal commit
  or its rationale — that would be the single highest-value follow-up if the main seat wants a
  library-vs-own-loop *narrative* from a peer that tried both.
- **Claude Code's implementation** is docs-only [R] — the CLI is closed-source, so every claim in
  §1.5 is the documented behaviour, not read code. The 1-second tick, the deterministic
  ID-derived jitter and the turn-boundary firing are exactly the kind of detail that could differ
  from the implementation.
- **Codex's cloud-side scheduler.** The OSS repo only carries the declarative types; whatever runs
  them is not public.
- **`cron-converter`'s 3.14 status** — no CI matrix checked; it lost on dep weight anyway.
- **APScheduler 4.x's actual quality.** I judged it on release cadence and commit activity, not by
  using it; it may well be fine in practice. The point stands regardless: nothing in our position
  justifies depending on a 15-month-old alpha.
- **Whether a 5–10 s tick is measurably cheaper or dearer than APScheduler's `call_later` chain on
  our hardware.** Not measured; at our scale (a handful of automations) both are noise, but I did not
  prove it.

---

## Appendix — reproducing the measurements

```bash
export TMPDIR=/home/emma/.cache/tmp
uv venv -p 3.14 v && VIRTUAL_ENV=$PWD/v uv pip install apscheduler croniter cronsim
du -sh v/lib/python3.14/site-packages     # baseline empty venv = 16K
# semantics matrix: CronTrigger.from_crontab / croniter / CronSim over
#   "0 9 * * 0", "0 9 * * 7", "*/15 * * * *", "@daily", "0 9 L * *", "0 9 * * 5#2", "61 * * * *"
#   with tz=Europe/Madrid, and the 2027-03-28 / 2026-10-25 DST bases (§2.3, §2.4)
```

Sources read in this pass (all raw files on `main`/`master`, 2026-07-30):
`Mintplex-Labs/anything-llm`: `server/utils/BackgroundWorkers/index.js`, `server/jobs/run-scheduled-job.js`,
`server/jobs/helpers/scheduled-job-helper.js`, `server/models/scheduledJob.js`,
`server/models/scheduledJobRun.js`, `server/prisma/schema.prisma`, `server/package.json` ·
`open-webui/open-webui`: `backend/open_webui/utils/automations.py`, `backend/open_webui/models/automations.py`,
`backend/open_webui/main.py`, `backend/requirements.txt`, `pyproject.toml` ·
`aaif-goose/goose`: `crates/goose/src/scheduler.rs`, `crates/goose/src/scheduler_trait.rs`,
`crates/goose/src/agents/schedule_tool.rs`, `crates/goose/Cargo.toml`, `ui/desktop/src/utils/cronSchedule.ts` ·
`BerriAI/litellm`: `litellm/proxy/proxy_server.py`, `litellm/constants.py`, `pyproject.toml` ·
`openai/codex`: `codex-rs/app-server-protocol/src/protocol/v2/plugin.rs` + generated v2 schema ·
`danny-avila/LibreChat`: `packages/api/src/skills/sync/scheduler.ts` ·
`healthchecks/healthchecks`: `hc/api/management/commands/sendalerts.py` ·
`agronholm/apscheduler`: commit `ff68780d` (3.x), installed 3.11.3 `schedulers/{base,asyncio}.py` ·
`pallets-eco/croniter`: `CHANGELOG.rst`, `README.rst`, `.github/workflows/cicd.yml` ·
`cuu508/cronsim`: `README.md`, `.github/workflows/pytest.yml` ·
docs: `code.claude.com/docs/en/scheduled-tasks`, `code.claude.com/docs/en/routines`.
