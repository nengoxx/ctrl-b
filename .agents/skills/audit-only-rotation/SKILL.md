---
name: audit-only-rotation
description: Run ONE audit pass against the next subsystem in the rotation — audit only, no fixing. Audits a different subsystem each invocation (rotating through all of them, then restarting the cycle), writes a findings report to docs/audit/, and advances the rotation. Quota-gated so it pauses when the 5-hour block hits the cost cap. Use this when the user wants to build up audit reports without touching code. Designed to be driven by `/loop` (self-paced).
license: MIT
---

# Audit-Only Rotation

The **read-only** rotation: one invocation = audit the next subsystem and write
its report; **never edit code**. It walks every subsystem, restarts when the
rotation completes, and pauses when quota is spent.

This skill is **self-contained** — the auditing is done directly in this session.
Its only external dependency is the helper `rotation.py` (rotation bookkeeping +
quota gate), which lives in the `audit-rotation` skill folder and keeps the scope
cursor coherent across runs. Run it with the repo's `.venv\Scripts\python.exe` or
any Python 3.14+. Paths are relative to repo root.

## Procedure (one pass)

### 0. Quota pre-check

```
python .agents/skills/audit-rotation/rotation.py quota --json
```

Auditing costs quota too. Exit **0**: proceed. Exit **1** (over cap) or **2**
(ccusage failed): do nothing this iteration; report and, under `/loop`, schedule
the next wake near `block_end` (the 5-hour reset).

### 1. Pick the scope

```
python .agents/skills/audit-rotation/rotation.py next --json
```

Gives `{name, paths, note}` (does not advance — step 3 does, so an interrupted
pass resumes on the same scope).

### 2. Audit (read-only)

Audit exactly `paths` per the **Auditing** section below, using `name` as the
report scope. Write `docs/audit/<scope>_audit_<YYYYMMDD>.md` (same-day re-audit →
`_v2` suffix). **Do not fix anything.** Leave every finding open (no `RESOLVED`
markers, no `**Resolution:**` lines) so a later fix pass can act on them.

Commit the report on its own:

```
git add docs/audit/<scope>_audit_<date>.md
git commit -m "docs(audit): <scope> rotation audit <date>"
```

### 3. Advance the rotation

```
python .agents/skills/audit-rotation/rotation.py complete --report docs/audit/<scope>_audit_<date>.md --fixed 0
```

(`--fixed 0` always — this variant never fixes.) Commit the state bump:

```
git add .agents/skills/audit-rotation/state.json
git commit -m "chore(audit-rotation): advance past <scope> (audit-only, cycle <c>)"
```

### 4. Report

State the scope audited, report path, severity counts, current quota
(`$cost / $cap`), and the next scope. Under `/loop`: self-pace a short delay when
quota is healthy; a long wait until `block_end` when the cap tripped at step 0.

## Auditing (read-and-reason, do not fix)

Used by step 2. Examine the code as it exists and produce a prioritized,
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

## Boundaries

- **Audit, never fix.** This variant must not edit, stage, or commit any code —
  only the report and the state bump. If you find yourself wanting to fix
  something, that belongs to a separate fix pass.
- Shares scope state (`state.json`) with the other rotations: running this
  advances the same cursor. That's intended.
- Don't commit secrets or noise (`.env`, sessions, logs, caches).
