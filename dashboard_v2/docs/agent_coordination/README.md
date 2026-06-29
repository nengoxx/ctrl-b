# Agent coordination

Lightweight protocol for **multiple agents working the same project in tandem** (e.g. this Claude Code agent +
a second agent on emma developing/auditing). Goal: avoid stepping on each other, and leave a legible trail.

## Channels
- **Audits → [`../external_audit/`](../external_audit/).** Any agent drops a systematic audit there as a dated
  markdown file; another agent reads it, writes a `TRIAGE.md`-style response (route each finding: adopt / backlog /
  defensible / reject), and folds the adopted items into the plan. (Precedent: `external_audit/TRIAGE.md`.)
- **Active-work log → this folder.** Before starting a non-trivial change, append a line to `LOG.md` (below):
  who, what area, status. Check it first so two agents don't edit the same files at once.
- **Source of truth → GitHub `main`.** One canonical branch. Agents push there (coordinated); never commit into
  another agent's working checkout. On a shared checkout (emma `~/github/ctrl-b`), use `git pull --ff-only`.

## Rules
1. **Don't commit into another agent's checkout.** Push to `main`; let the other pull.
2. **Claim before you touch.** A `LOG.md` line ("WIP: <area> — <agent>") for anything spanning multiple files or a
   subsystem; clear it when done. Trivial leaf edits don't need a claim.
3. **Read the other's audits before re-auditing.** Build on `external_audit/`, don't duplicate.
4. **Respect parked vs active.** Current: theme engine PARKED, emma deploy ACTIVE (see `../HANDOFF.md` priorities).
5. **Operational cautions carry over** (don't shut down fleet hosts, don't touch emma's system/MCP, secrets out of git).

## LOG.md
A running, append-only claim/status log. Format: `- [YYYY-MM-DD] <agent> · <area> · <WIP|DONE> · <note>`.
Create it when the second agent comes online; keep it short (it's a coordination scratchpad, not a changelog —
durable decisions still go to `DECISIONS.md` / `HANDOFF.md`).
