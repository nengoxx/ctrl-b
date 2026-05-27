---
name: refactor-small-pass
description: Keep cleanup and refactor work surgical, behavior-preserving, testable, and easy to review in this Telegram signal bot project.
license: MIT
---

# Refactor Small Pass

Use this skill before cleanup, file-splitting, renaming, deduplication, or
structure-only changes.

## Rules

- Preserve behavior. If behavior changes, call it a feature or bug fix and test it explicitly.
- Do one small refactor per pass.
- Prefer moving code before rewriting logic.
- Keep public config keys, report schemas, cache formats, and API payloads compatible unless the task is a migration.
- Match the local style instead of introducing a new abstraction style.
- Remove only dead code made dead by this pass, unless the user explicitly asked for cleanup.

## Checklist

1. Name the narrow goal.
   - Example: "Move optimizer parameter parsing into one module."

2. Identify the behavior lock.
   - Which tests, reports, or commands prove the behavior stayed the same?

3. Edit surgically.
   - Avoid formatting churn.
   - Avoid adjacent cleanups.
   - Keep imports and call sites simple.

4. Verify.
   - Run targeted tests first when useful.
   - Finish with `.\.venv\Scripts\python.exe -m pytest tests -q`.

5. Report clearly.
   - List changed files.
   - Say what did not change.
   - Mention any remaining risks or follow-up cleanup.

