---
name: audit-rotation
description: Run ONE quota-gated audit-and-fix cycle against the next subsystem in a rotation. First drains any open findings left over from previous audits (debug before auditing), then audits a different subsystem each invocation (rotating through all of them, then restarting the cycle), then — if usage quota allows — fixes ALL of that subsystem's findings inline, most important first, committing after each, until the 5-hour quota block reaches a cost cap (~80% of plan). Use this when the user wants an automated, rotating codebase-hardening loop. Designed to be driven by `/loop` (self-paced) so it repeats across cycles.
license: MIT
---

# Audit Rotation

One invocation = **one cycle**: first fix any findings still open from earlier
audits, then pick the next subsystem in the rotation, audit it once, then fix
**all** of that audit's findings — most important first, one commit each — until
the findings run out or the quota budget is spent. Then advance the rotation.
Driven by `/loop` (self-paced), it walks every subsystem, restarts when the
rotation completes, and pauses fixing whenever quota is spent.

**Audit once, then fix the whole report in one go** — do *not* re-audit between
fixes (no "audit, bugfix, audit, bugfix" churn). All auditing and fixing happens
**directly in this session**.

This skill is **self-contained**. Its only external dependency is the helper
`rotation.py` next to this file (rotation bookkeeping + quota gate); never
hand-roll ccusage parsing or cursor math. All paths below are relative to the
repo root. Run the helper with the repo's `.venv\Scripts\python.exe` or any
Python 3.11+.

## Procedure (one cycle)

### 0. Quota pre-check — bail early if spent

```
python .agents/skills/audit-rotation/rotation.py quota --json
```

- Exit **0** (under cap): proceed to step 1.
- Exit **1** (at/over cap): do **not** debug, audit, or fix this iteration.
  Report that quota is spent, note the `block_end` from the JSON, and end the
  cycle. If driven by `/loop`, schedule the next wake near `block_end` (the
  5-hour block reset), not sooner — auditing also costs quota.
- Exit **2** (unknown — ccusage failed): treat as spent. Skip fixing; you may
  still run the audit if the user wants read-only progress, but default to
  pausing and report the error.

### 1. Debug leftovers FIRST — drain the existing backlog before any new audit

Before auditing anything new, check whether previous audits left findings that
still need debugging:

```
python .agents/skills/audit-rotation/rotation.py findings --json
```

- Empty / exit **1** → no backlog. Go to step 2.
- Non-empty → there is unfinished debugging from a prior audit. **Fix it now,
  before auditing anything new.** Run the **Fix procedure** (below) over these
  findings, most-important-first, re-checking quota before each. If the quota
  gate trips while draining the backlog, **stop the cycle here**: report the
  remaining backlog and do *not* start a new audit (auditing also costs quota).

Only once the backlog is empty (or there was none) do you proceed to a fresh
audit. Track how many backlog findings you fixed.

### 2. Pick the scope

```
python .agents/skills/audit-rotation/rotation.py next --json
```

Gives `{name, paths, note}` for the subsystem to audit now (this does **not**
advance the cursor — that happens in step 5, so an interrupted cycle resumes on
the same scope).

### 3. Audit (read-only)

Audit exactly `paths` per the **Auditing** section below. Write the report to
`docs/audit/<scope>_audit_<YYYYMMDD>.md`, using the scope `name` so filenames
stay stable across cycles (a same-day re-audit gets a `_v2` suffix). Do not fix
anything in this step.

Commit the report on its own:

```
git add docs/audit/<scope>_audit_<date>.md
git commit -m "docs(audit): <scope> rotation audit <date>"
```

If the audit found **no actionable findings** (only N/design notes), skip to
step 5 with `--fixed 0` (plus any backlog fixes from step 1).

### 4. Fix EVERY finding from this audit — most important first, quota-gated

Run the **Fix procedure** (below) over the findings in the report from step 3,
repeating until the findings run out or the quota gate trips. Fix the whole
report in this one cycle, **in-session** — do not re-audit between fixes.

Keep a count of findings fixed this cycle (backlog + this report).

### 5. Advance the rotation

```
python .agents/skills/audit-rotation/rotation.py complete --report docs/audit/<scope>_audit_<date>.md --fixed <N>
```

`<N>` is the number fixed from **this cycle's audit** (step 4). This records
history and advances the cursor (wrapping to the next cycle when the last
subsystem is done). Commit the state bump on its own:

```
git add .agents/skills/audit-rotation/state.json
git commit -m "chore(audit-rotation): advance past <scope> (cycle <c>, fixed <N>)"
```

### 6. Report the cycle

State: how many backlog findings were drained first (and from which reports),
which scope was audited, the report path, severity counts, which findings were
fixed (by ID) with commit hashes, how many were left unfixed and why (quota vs
none-actionable), current quota (`$cost / $cap`), and the next scope.

If driven by `/loop`: when quota is healthy, self-pace a short delay before the
next cycle; when quota tripped mid-cycle, self-pace a long wait until `block_end`.

## Auditing (read-and-reason, do not fix)

Used by step 3. Examine the code as it exists and produce a prioritized,
evidence-backed report of what could break, what is fragile, and what could be
designed better. Every finding must point at real code (`file:line`) and explain
*why* it matters.

1. **Scope.** Audit exactly the given `paths`; note what is out of scope.
2. **Map.** Identify entry points, data flow, core data structures, external
   boundaries (I/O, network, DB, subprocess, the MT5 C extension), and
   concurrency points. Breadth before depth — don't read every line.
3. **Hunt.** Trace inputs to outputs and follow error/edge paths, not just the
   happy path. Verify behavior against the code — never assume from a name or a
   comment. Look for: unhandled/swallowed errors and half-updated state; edge
   cases (empty/None/zero, boundaries, unicode, large inputs, missing fields);
   off-by-one / inverted conditions / unit mismatches; resource leaks and
   unbounded growth; time/ordering assumptions; shared mutable state without a
   lock, locks held across `await`, blocking calls on the event loop,
   fire-and-forget tasks, check-then-act races; wrong data structure for the
   access pattern, unenforced invariants, duplicated logic that can drift; dead
   code, contradicting docs, magic numbers, missing tests on risky paths.
4. **Triage.** Give each finding a severity and confirm it's real (name the
   trigger and the consequence); drop speculation you can't ground in code.

**Severity scale** (number within severity: `C1, C2, H1, M1, L1, …`):
- **C** Critical — data loss, crash, corruption, or silent wrong results in
  normal operation.
- **H** High — breaks under realistic inputs; wrong results on a known path.
- **M** Medium — edge-case bug or reliability gap that needs a trigger.
- **L** Low — minor correctness/robustness/clarity issue.
- **N** Nit/Design — improvement or smell with no current bug.

**Report structure** (`docs/audit/<scope>_audit_<YYYYMMDD>.md`):

```markdown
# <Scope> Audit — YYYY-MM-DD

## Summary
1–3 sentences: scope, overall health, headline risks. Counts per severity.

## Scope
- In scope: <files / modules>
- Out of scope: <what was not examined>
- Method: <how you searched; commands run, if any>

## Findings

### C1 — <short title>
- **Location:** `path/to/file.py:123`
- **Severity:** Critical
- **Status:** confirmed | suspected
- **Issue:** what is wrong.
- **Trigger:** the condition under which it bites.
- **Impact:** the consequence.
- **Recommendation:** concrete fix or direction (do not apply it here).

### H1 — ...
(repeat, ordered by severity)

## Design notes (N)
Non-blocking suggestions.

## Open questions
Things needing the author's intent to resolve.
```

Keep each finding tight — one issue, evidence first. A short report of real
findings beats a long list of maybes.

## Fix procedure (one finding)

Used by step 1 (backlog) and step 4 (fresh audit). For the single
highest-severity open finding (Critical → High → Medium → Low → Nit; ties broken
by impact/confidence):

1. **Re-check quota:** `rotation.py quota`. If exit ≠ 0, **stop fixing** — the
   quota gate is the stop condition.
2. **Fix it yourself, in this session.** Locate the code at the cited
   `file:line`, find the root cause, and apply a correct, **minimal** fix —
   don't paper over it, and don't fix "while you're in there". Respect every
   project safety constraint: never weaken validation, sizing caps, or
   `require_sl`/`require_tp`; never touch secrets.
3. **Verify.** Prefer adding/extending a regression test that fails before the
   fix and passes after. Run the relevant tests; for any trading-path change
   (parser, execution, backtest, optimizer, routing, sizing) run the full suite:

   ```powershell
   .\.venv\Scripts\python.exe -m pytest tests -q
   ```

   If verification is genuinely impossible, say so plainly — never call an
   unverified fix validated.
4. **Commit just this fix.** Stage only the files for this finding (plus the
   report edit from step 5); never sweep in unrelated changes or secrets/noise.
   One fix = one commit, Conventional-Commit style, subject referencing the
   finding ID; record root cause in the body when not obvious. Then `git push`
   (use `-u origin <branch>` if no upstream); do not force-push — if rejected,
   stop and report.

   ```text
   fix(parser): reject incidental two-number entry zones (audit M4)

   Bare-number entry fallback matched values like "valid 5 min". Now
   requires same-magnitude numbers. Adds regression test.
   ```
5. **Mark the finding resolved** in the report so later passes skip it. Append a
   RESOLVED marker to the finding's heading, matching the existing reports'
   convention:
   `### H2 — …existing title… — RESOLVED <YYYY-MM-DD> (fix <short-hash>)`.
   A finding is **open** until its heading/block carries `RESOLVED` (or a
   `**Resolution:**` line). Stage that report edit **with the fix commit** so
   code + record land together.

## Configuration

- **Cost cap (the "~80% quota" gate):** edit `cost_cap_usd` in
  `state.json`, or set `AUDIT_ROTATION_COST_CAP` in the environment. It is the
  USD consumption *within the active 5-hour block* at which fixing stops. Set it
  to roughly 80% of your plan's 5-hour limit. The gate reads live consumption via
  `ccusage`; it cannot know your plan's exact ceiling, so this number is your
  knob.
- **Rotation scopes:** the 12 subsystems live in `state.json` under `scopes`
  (seeded from `DEFAULT_SCOPES` in `rotation.py`). Add/remove/re-path freely;
  `cursor` and `cycle` adapt to the list length. `rotation.py status` shows where
  you are.

## Boundaries

- **Debug the existing backlog before auditing.** Don't pile a fresh report on
  top of findings that still need fixing — drain step 1 first.
- **One fix per commit; audit before fix; never weaken validation, sizing caps,
  or `require_sl`/`require_tp`.** These come straight from the project's safety
  constraints — do not relax them to make progress.
- **The quota gate is the stop condition for *fixing*, not a license to ignore
  it.** When over cap, pause; do not keep spending to "finish the cycle".
- **Don't commit secrets or noise** (`.env`, sessions, logs, caches). The report,
  each fix (+ its RESOLVED marker), and the state bump are the only things this
  cycle should commit.
- Requires a clean-ish working tree on a version-controlled branch. If the tree
  has unrelated uncommitted changes, stop and report rather than sweeping them
  into commits.
