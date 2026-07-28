---
name: second-opinion
description: How to get an independent review or investigation — the Codex CLI as an adversarial second pair of eyes, and Claude subagents for bounded research/implementation. Use when about to run `codex exec`, spawn agents, or delegate any investigation. Covers the exact invocations, output-capture pitfalls that silently lose results, prompt scoping, and how to judge what comes back.
---

# Second opinion — Codex review + subagent delegation

Two delegation mechanisms, one discipline: **bound the question, capture the output reliably, and
judge the result rather than adopting it.**

## Which mechanism

> **▶ MODEL LAYER INVERTED (owner, 2026-07-28).** The MAIN seat is now **Fable 5 on high** — it
> designs, supervises, rules and audits. **Opus 5 (high) subagents carry the heavy token work**:
> implementation, research, mechanical and operational tasks. The table below is written for that
> arrangement. *(Until 2026-07-28 it was the other way round — Opus main, Fable an on-request
> reviewer. The mechanics in this file did not change; only who sits where.)*

| Situation | Use | Cost posture |
|---|---|---|
| Review of code/design **we wrote** — correctness, edge cases, failure modes | **Codex** (`gpt-5.6-sol`, high) | cheap — use freely |
| Reading many files to answer a question | **`Explore`** subagent | cheap |
| Bounded research on external projects / the field | **`general-purpose`** subagent (Opus 5 high) | the workforce — use freely |
| Well-specified implementation from a pinned brief | **`general-purpose`** subagent (Opus 5 high) | the workforce — use freely |
| Mechanical / operational work, runbook procedures, releases | **`general-purpose`** subagent (Opus 5 high) | the workforce — use freely |
| An independent CLAUDE lens on the main seat's own design | **ONE Opus 5 subagent** briefed adversarially | occasional — the mirror of the old Fable tier |
| **Design, architecture, supervision, audits, a judgement call, a ruling** | **the MAIN SEAT (Fable 5) — never delegate** | — |

**Standing owner directive (2026-07-22, reaffirmed 2026-07-26):** launch a Codex review **whenever
warranted, small slices included** — a quick pass is the minimum. It co-found the D3s3 HIGH and caught
a MED in the fix.

### The senior-engineer lens — now the MAIN SEAT's own job (2026-07-28)

> **This section described hiring Fable as a subagent. Fable now holds the main seat, so its content
> is what the MAIN SESSION is for** — read it as the job description of the chair you are sitting in,
> not as a delegation recipe. The parts that still describe delegation (brief discipline, "tell it
> what is already known", bounded reading, an explicit verdict) transfer verbatim to briefing an
> **Opus 5** subagent for an adversarial review of your own design.

#### Historical form — "the senior software engineer" (owner directive, 2026-07-26)

**The role, in the owner's framing:** Fable is the senior engineer you ask *"is this a good design?"* —
the second opinion for technical questions of **broader scope**: how the app integrates with the
systems around it (deploy, systemd, git/tags, installers, the DB, the OS), and the **blind spots** that
open up there. The reason it exists: *"sometimes the context doesn't let you see the whole picture"* —
the main session is deep in the slice and structurally cannot see across the whole system at once.

Fable is *"very smart"* but **expensive**. Rules:

- ~~**NEVER automatic.**~~ **(Obsolete since 2026-07-28 — Fable is the main seat, so its judgement is
  always "on".)** Codex and Opus subagents are launched on judgement, freely.
- **No self-spawning, and ONE agent per audit scope.** The brief must say *"Do NOT spawn subagents…
  a fan-out is a process failure."* Two Fable agents in parallel are fine **only** when they audit
  genuinely different artifacts or genuinely different lenses — and the brief of each must say what the
  other is covering so they do not re-tread. Never two agents on the same scope hoping for luck.
- **Tell it what is ALREADY KNOWN.** List the findings already in hand and say *"do not spend budget
  re-reporting these — I want NEW findings."* Without that, an expensive audit spends most of its
  reasoning rediscovering what you already fixed. This is the single highest-leverage line in the brief.
- **Give it a real verdict question.** "SHIP / SHIP WITH FIXES / DO NOT SHIP, and why" forces a
  commitment instead of a list of hedges.
- **Reasoning effort HIGH — state it in the first line of the brief.** The `Agent` tool exposes `model`
  but **no effort parameter**, so effort is set by writing `Reasoning effort: HIGH.` into the prompt
  (same convention as Opus subagents). An audit at default effort is not worth its cost.
- **Its home axis is design**: architecture, layer fit, systems integration, right-sizedness
  (over/under-engineering), consistency with existing patterns, how the design will age, naming/API
  quality, whether the whole thing hangs together as a system.
- **But it is also a correctness reviewer (owner, 2026-07-26): *"fable can also check correctness,
  it's also a smart model for that."*** Use it for defect hunting too — it is not design-only. What
  stays true is that two reviewers must not re-tread the same ground: give Fable and Codex
  **different lenses or different artifacts**, and say in each brief what the other is covering.
  The cheapest correctness pass is a **follow-up to a Fable agent that already audited the design**
  (`SendMessage`, context intact — ~60s and a fraction of the tokens of a fresh agent), telling it
  what Codex already found so it hunts for what Codex missed rather than re-deriving it.
- **Bound the reading.** Name the exact files and the order to read them; state *"do NOT crawl the
  repository — you are an expensive model being used for judgement, not breadth."*
- **Give it the context it cannot infer** — deployment shape, the standing owner rules, what is already
  locked, and the owner's stated concerns in his own words. It has no memory of the conversation.
- **Bound the output** (~1200 words), demand severities + concrete alternatives, forbid padding, and
  require an explicit verdict: SHIP AS DESIGNED / SHIP WITH CHANGES / RETHINK.
- Invocation: the `Agent` tool with `model: "fable"` and `subagent_type: "general-purpose"`. *(Distinct
  from the `ctrl-b-fable` tmux session, which is the owner-driven interactive second opinion.)*
- **Confirm agreement with `SendMessage`, don't re-audit.** After applying its findings, send the same
  agent a short follow-up (its context is intact) asking whether the revisions actually resolve what it
  raised. A fresh Fable agent would re-read everything and re-bill for it.

### The council rule — three-way agreement before building

**Owner directive (2026-07-26): the main session, Fable and Codex must be IN LINE on the design,
architecture and coding patterns before implementation starts.** Practically:

1. Main session writes the design.
2. **Codex** reviews it for correctness/edge cases/failure modes; **Fable** reviews it for
   architecture/integration/maintainability. Run them in parallel — they're independent.
3. Main session **reconciles**: accept, or overrule with stated reasoning. Findings are evidence, not
   verdicts ([[claude-is-final-judge]]) — but an unexplained overrule is a process failure.
4. **Disagreements get resolved, not averaged.** Where two reviewers conflict, rule on it and record
   why. Where a reviewer contradicts a locked decision, the decision wins unless the reviewer has
   found a fact that breaks it.
5. Apply the changes, then **confirm with the reviewer that raised them** (§SendMessage above).
6. Only then build — and report to the owner what each reviewer found and what was overruled.

This is not ceremony: on the A11 update plan, Fable found two HIGH design holes the main session had
missed (a step contract broken by its own first step, and a rollback goal that failed across the exact
release motivating it), both of which would have been discovered mid-build.

---

## Codex — the invocation

```bash
S=<scratchpad>
codex exec \
  --model gpt-5.6-sol \
  -c model_reasoning_effort=high \
  --sandbox read-only \
  -C /home/emma/github/ctrl-b \
  --output-last-message "$S/codex-review.md" \
  "$(cat "$S/codex-prompt.txt")" \
  < /dev/null \
  > "$S/codex-full.log" 2>&1
```

Run it with `run_in_background: true`. A high-effort review over a real codebase takes **10–40 minutes**.

> ### ⚠ `< /dev/null` IS NOT OPTIONAL — without it Codex hangs forever
> `codex exec` reads the prompt from stdin when stdin looks piped: *"If stdin is piped and a prompt is
> also provided, stdin is appended as a `<stdin>` block."* A backgrounded run inherits a pipe nobody
> writes to and nobody closes, so Codex prints `Reading additional input from stdin...` and **blocks
> indefinitely** — 0 CPU, no output, looking exactly like a slow high-effort review.
> **This cost two full runs (~75 min) on 2026-07-26 and was twice misdiagnosed as "high effort is slow".**
> Redirect stdin from `/dev/null` so it reaches EOF immediately and the prompt argument is used.

| Flag | Why it matters |
|---|---|
| `--output-last-message FILE` | **The review lands in a file directly.** Without it you are scraping stdout, which is how results get lost. Read *this* file, not the log. |
| `--sandbox read-only` | A reviewer must not edit the tree. Always, for reviews. |
| `-C <dir>` | Working root. Set it explicitly; don't rely on cwd. |
| `-c model_reasoning_effort=high` | Effort is a config override, not a flag. |
| `--json` | Only if you need to parse events; noisier and not needed for a review. |

`--skip-git-repo-check` is only for running **outside** a git repo. Inside the repo it is noise — drop it.

### Capture pitfalls — both of these have already cost a full review

1. **Never pipe Codex through `tail`/`head`/`grep`.** Those buffer. If the command is killed or times
   out, the pipe dies and **everything is lost** — you get an empty file and nothing to show for
   30 minutes of work. Redirect to a file; filter the file afterwards.
2. **Budget the timeout generously (≥ 3000 s) and write output as you go.** A `timeout` that fires
   mid-run is not a Codex failure — it is an invocation bug. If a run is killed, say so plainly rather
   than reporting it as the tool failing.
3. **VERIFY it is actually working before waiting on it — the signal is LOG GROWTH.** ~45 s after
   launch, `wc -c` the log twice a minute apart. A live review writes **hundreds of KB within a
   minute** (it echoes every file it reads). Hung looks like: log frozen with
   `Reading additional input from stdin...` as the last line.
   *Do not use CPU time as the discriminator* — a healthy run sits near `00:00:02` because it is
   I/O-bound on the API, so low CPU proves nothing either way. Never report "still running" without
   having compared two log sizes.
4. **Killing it: match by PID, not by pattern.** `pkill -f "codex exec …"` also matches the wrapper
   shell of the command you are running it from, so it kills its own invocation (exit 144). Get the PID
   from the `ps` line above and kill that.

### Scoping the prompt

Codex **can spawn its own subagents and read widely** — an unscoped prompt turns into an expensive,
unfocused crawl. Every review prompt states:

1. **The artifact** — exact paths to review, and the paths to read *for context* before judging.
2. **The context it cannot infer** — deployment shape, constraints, what is already ruled, what the
   owner has rejected. Codex has no memory of the conversation.
3. **A numbered list of questions**, and *"judge specifically, and be adversarial"*.
4. **`Do NOT write or modify any files.`** Belt and braces with `--sandbox read-only`.
5. **The output contract** — prioritised findings, each with severity (HIGH/MED/LOW), a concrete
   failure scenario, and a specific fix.
6. **An anti-padding clause** — *"If a section is sound, say so briefly rather than padding."*

Keep the prompt in a file (`codex-prompt.txt`) so the exact brief is re-runnable and reviewable.

---

## Subagents — the scoping rules

From the owner directive of 2026-07-25, after one unscoped launch became a ~55-task tree:

- **Plan before spawning.** Write down the split first; each agent gets a distinct, non-overlapping slice.
- **Max 5 concurrent.**
- **ONE bounded question per agent.** Not a topic — a question with an answer.
- **The brief MUST forbid nested subagents.** `general-purpose` agents can spawn their own and *will*.
  State it: *"Do NOT spawn subagents or use the Agent/Task tool — do the work yourself."*
- **Use `Explore` for read-only searching.** Cheaper and it cannot wander into edits.
- **File writes: one dossier file per agent, nothing else (revised 2026-07-28).** A research agent
  writes its OWN draft dossier (`docs/research/R<n>-<slug>.md`, following that folder's README
  conventions) — the heavy write-up is workforce work, not main-seat work. Still forbidden: two
  agents touching the same file, writes anywhere outside `docs/research/`, and editing the index —
  the main seat reviews/curates the draft, rules on its claims, and adds the README index row.
- **Demand confidence markers**: VERIFIED (read the source) / REPORTED (secondary) / UNVERIFIED, plus
  an explicit *"what I could not determine"*. A brief that omits this gets folklore back.
- **Ask for the number that decides the design** (line counts, sizes, versions) — not just prose.
- **Environment notes to include**: `/tmp` here is RAM-backed tmpfs — clones and heavy work go in
  `/home/emma/.cache/tmp` (`TMPDIR=`), and clean up after.

### Research specifically

Research findings go into **`docs/research/`** in the **same session** they land — see that folder's
README for the dossier conventions and the peer-project reference class. A finding that never reaches
the folder was bought for nothing. **The research agent drafts the dossier itself** (owner, 2026-07-28
— it has the findings in context and the main seat should not burn tokens transcribing); the main
seat then verifies the load-bearing claims, trims, and indexes it.

---

## Judging what comes back

**Findings are advisory evidence, never a verdict.** The main session is the final judge.

### Known reviewer biases — correct for these

- **Codex over-engineers** (owner, 2026-07-26). Its *diagnoses* are excellent and its failure scenarios
  are usually real; its *prescriptions* tend to add mechanisms. Treat "add X" as a hypothesis, then ask:
  **what is the leanest thing that closes this named failure?** Often the answer is a check rather than a
  subsystem, or an ordering rather than a rollback path. Take the finding, not necessarily the fix.
  Worked example: Codex asked for a cutover trap, multi-file restore-on-failure, and a
  service-active refusal. All three were cut — the trap had undefined end states, the restore guarded a
  state made unobservable by idempotency plus a commit point, and one `flock` covered the third case and
  worked on Windows too. Same guarantees, three fewer moving parts.
- **A finding accepted is not a fix accepted.** Re-derive the minimal fix yourself, and re-run the lean
  pass over everything already accepted from a reviewer — the simplification often resolves *other*
  open findings at the same time.
- The owner's standing priority is **maintainability, reliability, seamless updates — and no technical
  debt.** When a reviewer's fix and that priority conflict, the priority wins and the trade is recorded.

- **Cross-check against the code and the locked decisions** before acting. Reviewers confidently
  assert things that are wrong.
- **Rule explicitly on conflicts** — between two agents, or between an agent and a prior decision —
  and record the ruling with its reasoning. Agents disagreed in R5; the rulings are in R5 §6.
- **A recommendation that contradicts a locked D-entry** does not win by default. Say which wins, and why.
- **Report honestly**: what was verified, what was assumed, what is still open. If a run was killed or
  produced nothing, say that — do not imply a clean result.
- **Ask the owner** when the conflict is about an unsettled spec rather than a fact.
