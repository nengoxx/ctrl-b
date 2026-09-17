# Agent coordination

How several agents share this one tree without stepping on each other. Current as of 2026-09.

## Who is on the box

Two Claude Code agents boot with emma as systemd user services (`ctrl-b-agent@.service` instances —
see `deploy/linux/README.md` §"The Claude agent services" for the units, env overrides and attach
commands):

| Instance | tmux session | Model | Seat |
|---|---|---|---|
| `ctrl-b-agent@fable` | `ctrl-b-fable` | `claude-fable-5`, effort high | **MAIN** (owner, 2026-07-28) — designs the work, rules on conflicts, audits |
| `ctrl-b-agent@opus` | `ctrl-b-opus` | `opus` alias (latest), effort high | the subagent **workforce** — implementation from pinned briefs, research, ops |

Reviewers are not seats on the box: **Codex `gpt-5.6-sol` high** is the standing co-reviewer and the
**Emma/Hermes lane** is a first-class blind reviewer. Mechanics for both — invocation, output capture,
how to judge what comes back — live in the [`second-opinion`](../../.claude/skills/second-opinion/SKILL.md)
skill, which is canonical. Don't re-derive them here.

## The rules that actually matter

1. **One workspace, one writer.** `~/github/ctrl-b` is the only development tree and it never leaves
   `main`. Both sessions share it, so use one agent per task. A genuinely **simultaneous** second
   writer takes a throwaway worktree: `tools/add-dev-worktree.sh <name> [branch] [base]`, removed when
   done. A checkout in the workspace flips the running dev instance and tangles the other agent's WIP.
2. **Never develop in prod.** `~/apps/ctrl-b` only ever checks out released tags (`deploy/linux/README.md`
   §Release). No agent commits there.
3. **GitHub `main` is the source of truth.** Coordinate pushes; never commit into another agent's
   worktree — push and let them pull (`git pull --ff-only`).
4. **Findings are advisory; the main seat rules.** A subagent or reviewer reports; Fable decides and
   says so explicitly, asking the owner where the spec is genuinely unsettled.
5. **Operational cautions carry over.** Don't shut down or reboot fleet hosts while testing (the DEV
   instance seeds prod's fleet config — it is isolated for *data*, not for the real machines). Don't
   modify emma's system/MCP config beyond the deploy. Secrets stay out of git, logs and commit messages.

## Where the trail goes

- **Status / what's next** → `docs/HANDOFF.md` (the single source; read first every session).
- **Durable choices** → `docs/DECISIONS.md` (a D-entry), plus the owning feature plan's as-built record.
- **A systematic audit** → its own `docs/<NAME>_AUDIT.md` with its own finding-id prefix, or the review
  section of the plan it belongs to. **Not** `docs/external_audit/` — that folder is a frozen 2026-06
  archive (pre-reorg audits + their TRIAGE responses), kept for provenance and never added to.
- There is **no `LOG.md`** and no claim file. It was proposed in 2026-06, never used, and the commit
  log plus HANDOFF carry the trail instead. Announce a long-running claim in the session, not a file.
