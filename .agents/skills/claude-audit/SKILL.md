---
name: claude-audit
description: Drive the Claude Code CLI (headless) to debug and fix a codebase by working through an existing audit report in docs/audit/. Use this when the user wants to act on audit findings, fix the bugs an audit identified, or run an autonomous debugging pass against a report. Launches `claude` as a non-interactive subprocess pinned to Opus 4.7 / medium reasoning / bypass-all-permissions, fixing findings by ID and verifying as it goes.
license: MIT
---

# Claude Audit

Spawn a headless Claude Code CLI session that reads an audit report from `docs/audit/`, fixes **the single most important finding**, and verifies it. This is a meta-skill: it builds the right `claude` command and prompt, then hands the actual debugging to that subprocess.

**One pass, one fix.** Each run targets exactly one finding — the highest-severity / highest-impact open issue. Do not fix multiple findings in a single pass. To address more, run the skill again.

## Fixed invocation parameters

Always launch with exactly these (do not substitute weaker settings):

- **Model:** `claude-opus-4-7`
- **Reasoning effort:** `medium` (`--effort medium`)
- **Permissions:** bypass all (`--permission-mode bypassPermissions`, equivalent to `--dangerously-skip-permissions`)
- **Mode:** headless / print (`-p`) for an autonomous pass.

## Steps

1. **Locate the report.** Look in `docs/audit/`. If the user named one, use it. Otherwise pick the most recent `*_audit_*.md` and confirm the choice. If the folder is empty, stop and say so — this skill needs a report to act on.

2. **Read the report yourself first, then pick ONE finding.** Skim it to know the severities and finding IDs (`C1/H1/M1/L1…`). Select the single most important open finding — highest severity, then highest impact / most confident within that tier (Critical → High → Medium → Low). If it's a close call, state your choice and reasoning before launching. Everything else is out of scope for this pass.

3. **Build the debugging prompt.** Reference the report path and the one finding ID to fix. Be explicit that the subprocess must: fix only that single finding, leave all other findings and unrelated code alone, respect any project safety constraints (e.g. don't weaken validation, never touch secrets), run the project's tests, and report the outcome by ID. Tell it *not* to edit the audit report itself.

4. **Launch the CLI.** Run from the project root:

   ```bash
   claude -p "<debugging prompt>" \
     --model claude-opus-4-7 \
     --effort medium \
     --permission-mode bypassPermissions
   ```

   PowerShell (use the call operator with an args array to avoid quoting pain):

   ```powershell
   $prompt = @'
   <debugging prompt>
   '@
   $args = @("-p", $prompt,
             "--model", "claude-opus-4-7",
             "--effort", "medium",
             "--permission-mode", "bypassPermissions")
   & claude @args
   ```

   Run it in the background if it's a long pass, and capture stdout so the result is reviewable. Add `--output-format stream-json --verbose` if you want to watch progress; default text output is fine for a single pass.

5. **Verify after it returns.** Run the project's test suite yourself (the subprocess may claim success — confirm it). Re-read the diff for the one finding that was supposed to be fixed. If it wasn't addressed or a test fails, launch one more pass scoped to that same finding.

6. **Report back.** State the finding ID, whether it's fixed, and the evidence (test result, diff location). Don't claim it's resolved without verification. Note which finding would be the next most important if the user wants another pass.

## Prompt template

```
Read the audit report at docs/audit/<file>. Fix ONLY finding <ID> — nothing else.
Locate the code at the cited file:line, apply a correct, minimal fix, and explain
the root cause. Do not touch any other finding or unrelated code, and do not edit
the audit report. Respect all project safety constraints. Then run the test suite
(<test command, e.g. pytest -q>) and confirm it passes. Report finding <ID> with
status (fixed/partial/skipped) and the reason.
```

## Boundaries & cautions

- **`bypassPermissions` lets the subprocess edit files and run commands without prompting.** That is intended here, but it means you are responsible for verification — always run tests and review the diff afterward. Only run in a repo under version control so changes are recoverable.
- Fix by **finding ID**, not vague intent — keeps the pass scoped and auditable.
- **One finding per pass.** Resist the urge to fix "while you're in there" — a single verifiable fix beats a sprawling change. Run the skill again for the next finding.
- If the `claude` CLI isn't on PATH, stop and tell the user to install it.
