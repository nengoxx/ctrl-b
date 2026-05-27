---
name: commit-after-fix
description: Checkpoint a fix into a Git commit right after resolving an audit finding or debugging a bug. Use this when you have just fixed an issue raised in an audit (docs/audit/*.md, reports/audits/*.md, finding IDs like M1/L2) or root-caused and fixed a reported bug, and the change is verified and ready to record. Captures the symptom, root cause, fix, and audit/issue reference in the commit message, then commits and pushes the change.
license: MIT
---

# Commit After Fix

Turn a just-completed bug fix or audit-finding resolution into one clean,
traceable commit. The point is that each fix is recorded on its own, with a
message that explains *what was broken and why the change is correct* — never
swept into a vague "misc fixes" commit.

Trigger this after you have either:
- Resolved a finding from an audit (`docs/audit/*.md`, `reports/audits/*.md`, or
  an `Mx`/`Lx`-style finding ID), or
- Root-caused and fixed a reported or observed bug.

## Workflow

### 1. Confirm the fix is real and scoped

State it in one line to yourself: the **symptom**, the **root cause**, and the
**fix**. If you can't, you haven't finished debugging — do that first.

Then clean up the change: no leftover debug prints, commented-out code, or
temporary instrumentation. Strip those before going further.

### 2. Verify before committing — do not skip

Prefer adding or extending a regression test that fails before your fix and
passes after it, then run it:

```powershell
.\.venv\Scripts\python.exe -m pytest tests/<the_relevant_test>.py -q
```

For changes on the trading path (parser, execution, backtest, optimizer,
routing, position management), also run the full suite:

```powershell
.\.venv\Scripts\python.exe -m pytest tests -q
```

If verification is genuinely impossible or you chose to skip it, say so plainly
in your final response. Never describe an unverified fix as validated.

### 3. Update the issue record, if one exists

If the fix closes a tracked finding, mark it resolved in the audit document or in
`TODO.md`, and stage that edit together with the code so the record and the fix
land in the same commit.

### 4. Inspect and stage only this fix

```powershell
git status --short
git diff --stat
```

Stage just the files belonging to this fix (plus the audit/`TODO.md` edit from
step 3). Leave unrelated local changes alone — never revert or discard them.
Treat `.env`, session files, logs, and large caches as suspicious; do not stage
them as part of a fix.

```powershell
git add <files>
```

### 5. Write a fix-focused commit message

Conventional Commit style; the type is almost always `fix`. Reference the
finding ID or issue in the subject when there is one, and use the body to record
root cause and impact when they aren't obvious from the subject.

```text
fix(parser): reject incidental two-number entry zones (audit M4)

Bare-number entry fallback matched values like "valid 5 min" as an entry
zone. Now requires same-magnitude numbers. Adds regression test.
```

Keep the subject specific and under ~72 characters. Commit non-interactively:

```powershell
git commit -m "fix(scope): summary"
```

### 6. Push safely

```powershell
git push
```

If the branch has no upstream:

```powershell
git push -u origin <branch>
```

Do not force-push. If the push is rejected because the branch is behind, stop
and report it — do not auto-rebase or merge unless asked.

### 7. Report

Run `git status --short` once more and report the commit hash, message, branch,
push result, and any files intentionally left uncommitted.

## Rules

- **One fix per commit.** Several independent findings or bugs get separate
  commits, so each can be reverted on its own.
- **A fix never weakens a safety check.** Do not loosen validation,
  position-sizing caps, or `require_sl`/`require_tp` to make a test pass — that
  is hiding the bug, not fixing it.
- **Don't commit secrets or noise** — no `.env`, sessions, logs, or large caches.
- **If the fix is mid-flight** and the user hasn't asked you to commit, update
  `docs/AGENT_HANDOFF.md` instead of committing partial work.
- **Don't bypass push protection.** If secret-scanning blocks the push, remove
  the secret from history with the user's approval — never force past it.
