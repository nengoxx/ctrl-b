---
name: audit
description: Systematically audit a codebase (or a scoped subsystem) for reliability, correctness, and design quality, then write a structured findings report to docs/audit/. Use this when the user asks to audit, review the health of, harden, or assess a module/system; to hunt latent bugs, race conditions, or fragile assumptions; or to surface improvements in software design, data structures, error handling, or maintainability. Not for line-by-line PR review of a single diff — this is for examining existing code as it stands.
license: MIT
---

# Audit

Examine code as it currently exists and produce a prioritized, evidence-backed report of what could break, what is fragile, and what could be designed better. An audit is read-and-reason, not refactor: **find and document, do not fix** unless the user explicitly asks. Each finding must point at real code (`file:line`) and explain *why* it matters, not just *what* it is.

## When to use

- "Audit the optimizer / the parser / the whole project."
- "Is this module reliable? What could go wrong here?"
- "Find bugs, races, or design smells in X."
- Pre-release hardening, or assessing inherited/unfamiliar code.

For reviewing the changes in a single pending diff/PR, prefer a diff-review flow instead.

## Methodology

Work top-down, breadth before depth. Don't read every line — map the surface, then drill into risk.

1. **Scope & confirm.** State exactly what is in scope (one module, a subsystem, or whole repo) and what is not. If ambiguous, ask. Note the audit lens(es): reliability, correctness, design, performance, security.
2. **Map.** Identify entry points, the data-flow path, the core data structures, external boundaries (I/O, network, DB, subprocess, C extensions), and concurrency points. A quick structural pass beats reading files front-to-back.
3. **Hunt.** For each unit in scope, ask the audit questions below. Trace inputs to outputs. Follow error paths and edge cases, not just the happy path. Verify claims against the code — never assume behavior from a name or a comment.
4. **Triage.** Assign each finding a severity (see scale). Confirm it's real: can you name the trigger condition and the consequence? Drop speculation you can't ground in code.
5. **Report.** Write findings to `docs/audit/` using the structure below. Order by severity. Be specific and actionable.
6. **Validate before claiming.** If you ran anything (tests, a repro, a grep that proves a pattern), record the command and result. Distinguish *confirmed* from *suspected*.

## What to look for

**Reliability & correctness**
- Unhandled errors, swallowed exceptions, bare `except`, error paths that leave state half-updated.
- Edge cases: empty/None/zero, boundary values, unicode, very large inputs, missing optional fields.
- Off-by-one, inverted conditions, wrong operator, sign errors, unit/precision mismatches.
- Resource leaks: unclosed files/sockets/locks, tasks never awaited, unbounded growth (caches, queues, maps).
- Time/ordering assumptions: timezones, monotonic vs wall clock, retry/timeout correctness.

**Concurrency**
- Shared mutable state without a lock; lock held across `await` or blocking I/O; lock ordering / deadlock.
- Blocking calls on an async event loop; fire-and-forget tasks whose failures vanish.
- Check-then-act races (TOCTOU), non-atomic read-modify-write.

**Data structures & design**
- Wrong structure for the access pattern (linear scan where a map fits; mutable default args).
- Invariants that aren't enforced where they're assumed; primitive obsession; god objects.
- Duplicated logic that can drift out of sync; leaky or unclear module boundaries.
- API shapes that invite misuse; implicit coupling through globals or shared config.

**Maintainability**
- Dead code, contradicting comments/docs, magic numbers, inconsistent error/return conventions.
- Missing tests on risky paths; tests that assert nothing meaningful.

## Severity scale

- **C (Critical):** can cause data loss, crash, corruption, or incorrect-but-silent results in normal operation.
- **H (High):** breaks under realistic inputs/conditions; wrong results on a known path.
- **M (Medium):** edge-case bug, fragile design, or reliability gap that needs a trigger.
- **L (Low):** minor correctness, robustness, or clarity issue.
- **N (Nit/Design):** improvement, smell, or suggestion with no current bug.

Number findings within severity: `C1, C2, H1, M1, M2, L1, …`. These IDs are referenced later when fixing.

## Report

Path: `docs/audit/<scope>_audit_<YYYYMMDD>.md` (e.g. `parser_audit_20260524.md`, `full_project_audit_20260524.md`). Match this convention to existing reports in `docs/audit/`. If a same-day report for the same scope exists, append a `_v2` suffix rather than overwriting.

Structure:

```markdown
# <Scope> Audit — YYYY-MM-DD

## Summary
1–3 sentences: scope, overall health, headline risks. Counts per severity.

## Scope
- In scope: <files / modules>
- Out of scope: <what was not examined>
- Lens: reliability | correctness | design | performance | security
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
Non-blocking suggestions: structural improvements, simplifications, better data structures.

## Open questions
Things needing the author's intent or domain knowledge to resolve.
```

Keep each finding tight — one issue per finding, evidence first. A short report of real findings beats a long list of maybes.

## Boundaries

- **Audit, don't fix.** Document findings; only change code if the user asks. If they then ask to fix, address findings by ID.
- Respect project safety constraints (e.g. never weaken validation, never touch secrets) — flag risks, don't introduce them.
- If a finding can't be grounded in specific code, label it *suspected* or move it to Open questions.
