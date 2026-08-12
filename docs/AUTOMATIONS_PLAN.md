# AUTOMATIONS_PLAN — A3 scheduled agent automations (design v2, LOCKED)

> **Status: design LOCKED 2026-07-30 (owner-signed same day); ✅ BUILT + SHIPPED same day as
> v1.4.4 (TODO Phase 14; record: [`HANDOFF_ARCHIVE.md`](./HANDOFF_ARCHIVE.md) 2026-07-30 blocks).
> Spec authority:**
> this file + [`DECISIONS.md` D49](./DECISIONS.md). Build against this, not the ROADMAP sketch.
> **Provenance:** owner design conversation (rulings below) → three research dossiers
> ([R7](./research/R7-scheduled-agent-runs.md) scheduler ·
> [R8](./research/R8-automation-authoring.md) authoring + addendum ·
> [R9](./research/R9-action-attribution.md) attribution) + a full codebase seam map → council
> round (Codex gpt-5.6-sol correctness, 15 findings; Opus 5 architecture, 12 findings — both
> SHIP-WITH-CHANGES; all folded or overruled with reasoning) → confirm round (architecture
> reviewer: "v2 resolves all twelve as intended", 3 residual flags ruled in §Rulings).

## Owner rulings (LOCKED)

1. Unattended question policy: per-automation `skip | use_default`, default `use_default`.
2. Concurrency = 1, global (loop AND run-now share one arbiter).
3. Misfire = skip to the next slot — never fire a missed slot late (`misfire_grace_s` window).
4. Results: fresh thread per run (default) + per-automation `rolling` mode; `pinned` = future arm.
5. The agent-facing create tool ships in v1 (slice 4).
6. `cronsim` approved as a pinned dep (`tzdata` rides along for the Windows profile).

## D-1. Data model — two migrations (append-only rule)

**Migration v4 (slice 1 — attribution only):** `events` gains
`origin` TEXT NOT NULL DEFAULT 'user_chat' (`user_chat|automation|subagent|system`) ·
`origin_id` TEXT NULL · `run_id` TEXT NULL · `decision` TEXT NULL
(why-allowed: `auto|confirmed|approval|policy` — the column D44's summary-string marker lacked;
the shipped marker is left alone).

**Migration v5 (slice 2):**

`automations`: `id` uuid pk · `name` · `enabled` bool · `schedule` (5-field cron; validated by
the ONE shared write service used by POST, PUT, and the agent tool) · `tz` (validated IANA key,
NOT NULL; default = server zone resolved at save) · `prompt` · `agent` (NULL = default agent,
resolved dynamically; a NON-NULL name is validated at write AND re-checked **strictly** at claim —
a missing named agent fails the run, never falls back to the default agent's toolset) ·
`privilege` (NULL = the agent's own) · `question_policy` (`skip|use_default`; named for what it
governs — confirms always follow the privilege/approvals ladder, and the UI copy says so) ·
`thread_mode` (`fresh|rolling`; `pinned` = future third arm) · `thread_id` (NULL; the single
thread column all modes share — rolling: lazily owned, recreated if deleted; pinned later:
owner-chosen) · `timeout_s` (NULL = config default) · `next_run_at` (UTC epoch, indexed;
invariants: POST computes a future value; enable and any schedule/tz edit recompute
strictly-future; disabled rows are never claimed and enable never reuses a stale value) ·
`rev` (int, bumped on every definition change — the claim verifies it) · `created_at` ·
`updated_at`.

`automation_runs`: `id` · `automation_id` (indexed) · `trigger` (`scheduled|manual`) ·
`scheduled_for` (the slot; NULL for manual) · `started_at` · `finished_at` · `status`
(`running|ok|error|timed_out|interrupted|missed`) · `error` · `thread_id` · `read_at` (unread).

- **Retention from day one:** `automations.keep_runs` — the runner prunes old run rows AND their
  fresh threads+messages in the same loop. (Hourly automation ≈ 8.7k archived, invisible,
  otherwise-unprunable threads/year.)
- **DELETE:** 409 while a run is active; idle delete cascades run rows and their threads (incl.
  the rolling thread). Events are never deleted (append-only audit; dangling `run_id` is explicit
  and acceptable).
- **Cap:** `max_count` counts ALL definitions; count+insert in ONE transaction in the shared
  service (TOCTOU-closed); the refusal says "delete one first".
- **Why SQLite:** agent-writable records must never be able to brick the config-validated boot
  (the service crash-loops on bad config); mutable runtime state belongs in the DB, not the
  hand-edited file.

## D-2. Scheduler — poll-and-claim loop + cronsim

- One lifespan loop (the `_memory_sweep` pattern: `poll_seconds` re-read live, blanket exception
  guard, cancel+await shutdown). Started ONLY AFTER both startup sweeps (stale-call reconcile +
  the run-orphan sweep). Naming matches `server.poll_seconds`.
- **The claim is one `BEGIN IMMEDIATE` transaction:** re-read the row; verify `enabled` and `rev`
  unchanged; classify lateness — `now - next_run_at > misfire_grace_s` → insert a terminal
  `missed` row, advance `next_run_at`, DO NOT invoke (skip-misfire, honestly: a server asleep at
  09:00 does not run the 09:00 job at noon); within grace → advance `next_run_at` from now,
  insert the `running` row, and return an immutable execution snapshot (prompt/agent/privilege/
  policy frozen at claim — a mid-flight edit affects only the NEXT run). The agent is invoked
  strictly OUTSIDE the transaction (no task spawns inside `Database.transaction()`).
- **Concurrency 1 = one explicit global arbiter** honored by BOTH entry points. Run-now while any
  run is active → 409 "runner busy". Run-now on a currently-due automation consumes that slot
  atomically; otherwise the schedule is untouched.
- **Runs ride the turn machinery, not around it** (the steer-turn precedent:
  `reserve(kind="automation")` → `_build_session` → `_spawn_drain_task`; the loop awaits the
  handle's task, shielded so shutdown cancels only through the sanctioned path). Buys: cancel via
  the ONE `cancel_turn` · `max_active_turns` sees automation turns · live watch/re-attach · no
  second turn-marker lifecycle · collision-proof threads (fresh AND rolling carry markers).
- **Timeout** = `cancel_turn` after `timeout_s`, await reconciliation, label `timed_out` — never
  a raw task cancel around a half-persisted tool call.
- **Honest terminals:** drain terminal → completed=`ok` · error/capped=`error` ·
  deadline-cancel=`timed_out` · shutdown-cancel=`interrupted` ("external effects may be unknown",
  + an Event) · headless suspended=invariant error. Every claimed run is terminalized in a
  shielded finalizer; the boot orphan sweep marks stale `running` rows `interrupted`.
- Shutdown: automation handles drain with the same grace as chat turns, before the idle loop is
  cancelled, before adapters/DB close.
- `cronsim` for parse/validate/next-fire/human-echo; storage in UTC epoch; tz only to evaluate
  cron fields (the R7 DST trap: no wall-clock timedelta arithmetic across folds). APScheduler
  rejected (4.x parked at alpha; 3.x `from_crontab` weekday-0-is-Monday bug); croniter rejected
  (autumn-fold double-fire, no 3.14 CI, life-support maintenance).

## D-3. The headless session — explicit automation options

`_build_session`/`AgentSession` grow ONE options object (not scattered bools):
`interactive=False` · `message_actor=Actor.AUTOMATION` (`run_turn` stops hardcoding USER on the
injected prompt message; the UI badges automation-authored turns) · **reflection disarmed** (the
`depth>0` proxy would let a depth-0 cron run write the owner's durable memory from a throwaway
thread — re-expressed off the session's origin) · no steer source · explicit compaction state
(rolling threads get a REAL one — they grow; fresh get none) · routing per config ·
`origin=Origin(automation, id, run_id)`.

- `question_policy=skip`: question → DENIED/skipped (today's headless behavior); confirm →
  skipped (unchanged).
- `question_policy=use_default`: `QuestionInput` gains optional `choices` + `default` (additive —
  exactly ROADMAP §A2's locked bubble shape). Ladder: declared `default` → first of `choices` →
  neither → synthesize "no owner is available; proceed on your best judgement and state the
  assumption you made" as the tool result. The run CONTINUES in all three cases. The headless
  result resolves before the call's terminal Event is recorded (no AWAITING_* audit rows).
  The minimal interactive rendering of `choices` (chips in the existing question bubble) ships in
  the SAME slice as the fields — they reach the model's tool schema the moment they exist.
- Confirm gates: always the privilege/approvals ladder — stated out loud: a D44 approval rule
  auto-allows headless exactly as interactively, and `privilege: full` auto-runs confirms. THAT
  is the sanctioned mechanism for privileged automations; consent happens at authoring time
  (Claude Code principle: a stored prompt is not consent).
- Rolling threads: interactive chat against an automation-owned rolling thread is rejected
  server-side in v1 (takeover/detach = recorded future). Fresh run threads are free to
  continue-in-chat after the run is terminal (the AnythingLLM pattern).

## D-4. Attribution

`origin` is a REQUIRED kwarg at the `ActionService.invoke` chokepoint (pyright forces all 9 call
sites; a default lets future sites mislabel silently — R9's structural-omission warning), carried
on `InvocationContext`, and **propagated through `run_subagent` in v1** (child sessions:
`origin=subagent`, parent `run_id` preserved — required for the recursion guard to be transitive;
subagent attribution becomes real, not "later"). The wake service passes `system` explicitly.
`actor` semantics unchanged (AGENT for the loop's tool calls; AUTOMATION only for acts of the
automation machinery itself, e.g. the injected prompt message).

**Ancestry semantics (ruled):** `origin.kind` records the IMMEDIATE initiator only — an
automation's subagent's calls read `origin=subagent` (R9: the current actor is authoritative,
priors are informational). The authoritative "descended from an automation" predicate is a
**non-null `run_id`**, preserved through all descendants. Nothing load-bearing keys on
origin-kind ancestry (the D-5 guard keys on interactivity).

## D-5. The agent-facing tools

- `create_automation` builtin (one file, the `task_plan`/`question` template): input
  `{name, schedule, prompt, thread_mode?=fresh, agent?, tz?}`; `confirm=True`, `risk=MED`,
  `ui_exposed=False`, `core=False`; routes through the SAME write service as REST (validation +
  cap in one transaction).
- **Recursion guard in-tool, off `InvocationContext`** (the `spawn_subagents` depth-guard
  precedent): DENIED whenever the context is non-interactive — covering automation runs AND all
  spawned subagents in one check. No registry surgery (no exclude vocabulary; omission wasn't
  transitive). **Deliberately broader than "automation" (ruled):** an ordinary chat-spawned
  subagent is also denied, by intent — creating an automation requires a live owner to confirm,
  and ANY non-interactive context lacks one; interactivity, not ancestry, is the honest predicate.
- At `privilege: FULL`, `decide()` auto-allows confirm-tools — for an INTERACTIVE full-privilege
  chat this is accepted as the owner's explicit standing consent (ruling R-2; no new
  "unbypassable confirm" mechanism).
- `list_automations` read-only sibling (`risk=LOW, read_only=True`), available everywhere incl.
  headless.
- After a confirmed create, the assistant turn renders a card/summary of the created automation
  (R8's persisted-card pattern; slice 4).

## D-6. REST + Conf UI

- `/api/automations` router: GET list (+ next-fire echo, last run) · POST · PUT/{id} ·
  DELETE/{id} (409 while running) · POST/{id}/run-now (409 while busy) · GET/{id}/runs ·
  mark-read · schedule-preview (server-side cronsim: validity + next N fires + human echo;
  advisory — write-path validation lives in the shared service).
- Conf: a numbered "Automations" ConfGroup = the LIST (name, enable switch, last-status chip,
  next-fire echo) + run-history access; the EDITOR opens in a sheet (kit overlay contract), not
  inline — ConfTab is 2300 lines and phone-width is primary. Editor: name · prompt textarea ·
  schedule presets + raw-cron escape hatch with live preview + not-representable warning · agent
  picker · privilege chip · question-policy seg · results seg ("New thread each run" / "One
  continuing thread") · timeout · run-now · history with unread markers + open-thread.
- Hooks mirror `useHostMutations` (dedicated CRUD + invalidate + toast; `useScopedQuery`). The
  write path deliberately differs (SQLite service, not `settings_write_lock`) — recorded so the
  two record-editor patterns don't drift blindly.
- Vapor stays frozen; Kit styling per VAPOR_PATTERNS/THEME_ENGINE gates.

## D-7. Config — `automations:` section

`{enabled: true, poll_seconds: 10, default_timeout_s: 300, max_count: 20, misfire_grace_s: 300,
keep_runs: 50}` — all tunables, no magic numbers. Records in SQLite (rationale D-1).

## D-8. Slices (each: pinned Opus brief → gate 6/6 → Codex round → owner pause)

1. **Attribution (v4):** the four `events` columns · required-`origin` threading incl.
   `run_subagent` · `InvocationContext.origin` · tests. Zero behavior change.
2. **Engine (v5):** schema + `AutomationRepo` + cronsim + the claim protocol + turn-machinery
   integration + the session options object + `question_policy` (incl. the additive
   `QuestionInput` fields AND the minimal choice-chips rendering in the existing bubble) +
   orphan sweep + retention + strict agent resolution.
3. **Surface:** REST router + Conf group/sheet + the config section.
4. **Tools:** `create_automation`/`list_automations` + the created-card + F1/unread polish.

## Council rulings record (main seat, 2026-07-30)

- **R-1** (use_default shape): Codex's "extend QuestionInput with choices/default" ACCEPTED (it
  is A2's already-locked shape, additive); its "neither declared → DENIED" tail OVERRULED for the
  synthesized-best-judgement arm — use_default must keep the run moving or it collapses into skip
  for every default-less question.
- **R-2** (create at FULL): Codex's unbypassable-confirm mechanism OVERRULED as over-mechanism
  for a single-user tailnet — FULL is the owner's explicit standing consent; the honest fix for
  unattended paths is the in-tool non-interactive DENY (accepted). Documented semantics.
- **R-3** (recursion): registry-omission (the v1 idea) REPLACED by the in-tool
  `InvocationContext` guard both reviewers converged on.
- Confirm-round flags (all ruled): guard breadth = deliberate (interactivity predicate) ·
  ancestry = non-null `run_id`, origin.kind = immediate initiator · choice-chips ship with the
  fields in slice 2.
- Convergent independent findings (question contract, turn-machinery bypass, strict agent
  resolution, run-now arbiter, reflection proxy, origin propagation) are treated as confirmed.

## As-built deltas (slices 1–2, 2026-07-30 — the spec above stands; these are the concrete forms)

- **Slice 1 (14a):** `decision` also stamps `policy` on DENY (NULL = written outside the gate) ·
  subagent `origin.id` = the child agent's name · migration application made **atomic per
  migration** in the runner (rider — closes a pre-existing crash-window class) · events reads are
  **lenient**: `EventOriginKind`'s `unknown` is a structurally read-side-only sentinel;
  `Actor`/`RunState` pass raw text through on unrecognized values.
- **Slice 2 (14b):** `schedule.py` filters cron candidates to **strictly-greater epoch** (the DST
  fold otherwise regresses `next_run_at` — R7's trap in live form) · 5-field cron ONLY (cronsim's
  6-field seconds form refused) · the runner's post-cancel deadline wait is **unbounded** (honest
  wedge; shutdown stays bounded → `interrupted`) · thread deletion (retention/delete) reserves the
  thread's turn marker via a non-task-bearing **`prune` TurnKind**, released only after COMMIT;
  interactive endpoints **revalidate existence + rolling ownership after reserving** · mode
  switches take the same marker · unknown stored privilege floors to **READONLY** · the question
  offer rides `result.data`; `choices` capped 8×60 chars, FE trims/dedupes · `run_now` lives at
  the service level (14c wires the endpoint onto the shared arbiter) · shielded claim/finalizer
  drains consume **repeated** raw cancels (asyncio does NOT queue cancels — two `cancel()` before
  a resume collapse into one delivery; tests must space them by a scheduling step) ·
  `AutomationService.turns` is a required dependency. Ruled residual: the unattended question's
  audit Event reads `awaiting_answer` (subagent-consistent; no concrete harm — Codex-confirmed).

- **Slice 3 (14c):** run-now is **202-DETACHED** — the claim happens inline (it decides 409-vs-started
  and is the row the response carries), the run executes on a tracked task the lifespan drains;
  holding an HTTP handler open across a full agent turn is what D39 exists to avoid. `runner.run_now`
  = `start_now` awaited (in-process/tests; caller-cancel abandons the rendezvous, not the run).
  `start_now` refuses on `shutting_down`; `shutdown()`'s backstop for a task cancelled before its
  first step (body/finally never run) is `sweep_orphans()` while the DB is still open. The list is a
  typed envelope (`AutomationsDoc`: rows + enabled/busy/max_count/server_tz/default_timeout_s) over
  FOUR fixed reads (list · latest-runs window · unread GROUP BY · open runs). One `_mapped()`
  chokepoint: NotFound→404 · Invalid/AgentMissing→422 `[{path,message}]` · Cap/Busy→409.
  Whitespace-only name/prompt rejected in the SERVICE (`_validated` — the 14d tool inherits it);
  name stored stripped. `schedule-preview` is always-200 advisory incl. blank input. The Conf editor
  sheet is the **PromptModal shell, NOT `<BottomSheet>`** (BottomSheet CSS is kit-scoped; vapor —
  the frozen default — would render it unstyled) on its own `auto-pm` **z-45 layer** (ladder: sheet
  45 < ConfirmDialog 50 < PromptModal 60 — the sheet opens confirms) with the shared `modalKeyDown`
  focus trap (extracted from PromptModal into `lib/focusTrap.ts`). Run history open = the read event
  (marks unread; atomic `COALESCE(read_at, ?)`). Staleness while a detached run finishes: the list
  polls at a named FE cadence only while `busy` (zero idle cost). "Open thread" from a run =
  `openThread()` in the chat store — fetch-first-swap-second, guarded by `loadGen`
  (completion-ordered reconciliation) + `openSeq` (intent-ordered explicit opens; `/clear` claims a
  ticket too). Presets (hourly/daily/weekly/custom) are a pure VIEW over the one stored cron
  (`lib/cronPreset.ts`); a non-representable expression shows a standing note.

- **Slice 4 (14d):** the tools live in ONE file (`services/agent/automation_tools.py`, the
  planning/question template) reaching the service via a new `Deps.automations` handle (back-filled
  in the lifespan) — never `app.state`. `create_automation` input = {name, schedule, prompt,
  thread_mode, agent?, tz?} ONLY (privilege/question_policy/timeout are owner-only in Conf);
  `enabled=True` on create; retry-UNSAFE; the guard is `if not ctx.interactive → DENIED`, first.
  The created-card rides `result.data.automation` (id/name/schedule_text/tz/next_fire from the
  STORED `next_run_at`/thread_mode/enabled/agent), shape-validated in the bubble with a
  tz-formatting backstop; Open-in-Conf = `openConfGroup` (both theme Roots honor an armed scroll
  target). **Every run terminal now records ONE Event** (was interrupted-only; `missed` stays
  event-less — written inside the claim's transaction) via **first-writer-wins terminalization**
  (`finish_run` transitions only a `running` row inside BEGIN IMMEDIATE and returns whether it won;
  the shutdown sweep and a late finalizer can no longer double-write; `sweep_orphans` closes through
  the same op). **The headless confirm→DENIED conversion is audited** at its one session chokepoint
  through `ActionService.record_policy_denial` (`decision="policy"`, full origin/run_id) — placed in
  the SESSION, not `invoke`, because `decide()` documents the headless mapping as the caller's.
  FE: `automation_done` = the additive 4th `NotificationEventsCfg` field (default true) + Conf row;
  the run-terminal predicate is `action=="automation_run" AND run_id AND status ∈ {ok,error,timeout,
  cancelled}` (the action name is load-bearing — tool calls inside a run carry the same run_id);
  key `run:<run_id>`; one notification per run, never also `action_failed` (tool failures INSIDE
  runs keep riding `action_failed` as before); the stream invalidates `["automations"]` +
  `["automation-runs", id]` off the same predicate, invalidation-first; the group header shows the
  unread sum. Tool description states recurring-only (decline one-shots) and standing-consent-at-FULL.

## Out of v1 (recorded, additive later)

`pinned` thread mode (+ its pre-bought failure semantics: deleted destination → fail loudly,
never retarget; busy → queue; append at current leaf) · notify-and-wait question policy (F1
carries the ping; needs park/resume design) · rolling-thread takeover/detach · the D2-A
tailscale monitor loop (shares only the lifecycle convention) · Web Push deep-links into run
threads · pause-after-N-failures (nobody in the field has it).
