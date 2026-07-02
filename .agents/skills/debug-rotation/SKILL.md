---
name: debug-rotation
description: Quota-gated loop that fixes the open findings already written in docs/audit/ reports — fix only, no auditing. Each pass picks the single most important unresolved finding across all reports, fixes it inline, verifies, and commits, then re-checks quota; it keeps going until the 5-hour block hits the cost cap or no open findings remain. Use this when the user wants to drain the audit backlog without generating new reports. Designed to be driven by `/loop` (self-paced).
license: MIT
---

# Debug Rotation

The **fix-only** rotation: it never audits and never picks a subsystem scope —
it consumes the findings that already exist in `docs/audit/*.md`, fixing the most
important open one each pass, committing each, until quota runs out or the
backlog is empty.

This skill is **self-contained** — all fixing and committing happens directly in
this session. Its only external dependency is the helper `rotation.py` (finding
scan + quota gate); never hand-roll the open/resolved scan or ccusage parsing.
Paths are relative to repo root; run the helper with the repo's
`.venv\Scripts\python.exe` or any Python 3.14+.

## What counts as "open"

A finding is **open** unless its heading or block carries a `RESOLVED` marker or a
`**Resolution:**` line. `rotation.py findings` already applies this and returns
open findings **most-important-first** (Critical → High → Medium → Low → Nit,
then by report). Trust it instead of grepping yourself.

## Procedure (one pass = one fix)

### 0. Quota pre-check

```
python .agents/skills/audit-rotation/rotation.py quota --json
```

Exit **0**: proceed. Exit **1** (over cap) or **2** (ccusage failed): fix nothing
this iteration; report and, under `/loop`, schedule the next wake near
`block_end` (the 5-hour reset).

### 1. Pick the most important open finding

```
python .agents/skills/audit-rotation/rotation.py findings --json
```

Exit **1** / empty list → **no backlog**: report "no open findings" and stop the
loop (under `/loop`, this is the natural end — wait for new reports to appear, or
end). Otherwise take the **first** entry: `{report, id, severity, title, line}`.

### 2. Fix exactly that finding, in this session

Open the cited `report` and read finding `id`. Locate the code at the cited
`file:line`, find the root cause, and apply a correct, **minimal** fix — fix only
that finding ID, leave every other finding and unrelated code alone, and do not
fix "while you're in there". Respect every project safety constraint: never
weaken validation, sizing caps, or `require_sl`/`require_tp`; never touch
secrets.

### 3. Verify

Prefer adding/extending a regression test that fails before your fix and passes
after. Run the relevant tests; for any trading-path change (parser, execution,
backtest, optimizer, routing, position sizing) run the full suite:

```powershell
.\.venv\Scripts\python.exe -m pytest tests -q
```

If verification is genuinely impossible, say so plainly — never describe an
unverified fix as validated.

### 4. Commit just this fix

Inspect and stage only the files belonging to this finding (plus the report edit
from step 5). Leave unrelated local changes alone; treat `.env`, sessions, logs,
and caches as suspicious and never stage them. Commit non-interactively, one
fix = one commit, Conventional-Commit style, subject referencing the finding ID;
use the body for root cause/impact when not obvious. Then `git push` (use
`-u origin <branch>` if there is no upstream). Do not force-push — if the push is
rejected because the branch is behind, stop and report.

```text
fix(parser): reject incidental two-number entry zones (audit M4)

Bare-number entry fallback matched values like "valid 5 min". Now
requires same-magnitude numbers. Adds regression test.
```

### 5. Mark the finding resolved

Append the RESOLVED marker to that finding's heading so the scanner skips it next
pass, matching the existing report convention:

```
### H2 — …existing title… — RESOLVED <YYYY-MM-DD> (fix <short-hash>)
```

Stage this report edit **with the fix commit** (step 4), so code + record land
together.

### 6. Loop

Go back to step 0. Stop when quota trips (exit 1/2) or `findings` is empty.

### 7. Report

Per pass and at the end: which findings were fixed (ID + report + commit hash),
how many open remain (`rotation.py findings` count), and current quota
(`$cost / $cap`). Under `/loop`: short self-paced delay when quota is healthy and
backlog remains; long wait until `block_end` when the cap tripped; end the loop
when the backlog is empty.

## Boundaries

- **Fix only — never audit.** This variant does not generate reports or go
  looking for new things to audit. If there are no open findings, it stops.
- **One fix per commit; never weaken a safety check** to make a fix or test pass.
- **Most-important-first.** Always take the top of `rotation.py findings`; don't
  cherry-pick easy ones.
- Don't commit secrets or noise (`.env`, sessions, logs, caches). Only the fix +
  the report's RESOLVED marker should be committed each pass.
- Requires a version-controlled, clean-ish tree. If the tree has unrelated
  uncommitted changes, stop and report rather than sweeping them into commits.
