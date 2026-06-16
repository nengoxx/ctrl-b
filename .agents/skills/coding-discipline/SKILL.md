---
name: coding-discipline
description: >
  The default engineering loop for ANY coding work in this repo — wrap every
  implementation, feature, addition, fix, or refactor in it. Use this skill
  whenever you are about to write or change code: it forces a read-the-code-first
  design pass (architecture fit, reuse existing data structures/patterns, no
  duplicated or near-duplicate logic, a named/well-defined design pattern, no
  hardcoding), clean-code implementation, and a post-change review → audit →
  debug → verify pass. Trigger phrases: "implement", "add a feature", "write
  this", "build X", "wire up", "create endpoint/component", "fix", "refactor",
  "integrate", "make it do Y", or any task that ends with code changing on disk
  — even small one-liners. This is the orchestrator; it delegates depth to the
  audit, debug, karpathy-guidelines, refactor-small-pass, and commit-after-fix
  skills at the right moments.
license: MIT
---

# Coding Discipline

The standing rule: **no code lands without passing through this loop.** It exists
because the expensive mistakes in this codebase aren't typos — they're code that
*works* but bypasses an existing chokepoint, reinvents a structure we already own,
hardcodes a tunable, or solves a problem a second slightly-different way so the two
copies drift apart. Those are design failures, and they're cheap to prevent before
the first line and ruinous to unwind after.

```
PRE-FLIGHT (read & design)  →  BUILD (clean code)  →  POST-FLIGHT (review · audit · debug · verify)
```

Scale the *effort* to the change. Most changes get the full loop — and "it looks
like a one-liner" is **not** a reason to skip it, because a one-line change in the
wrong layer is still in the wrong layer. But genuinely trivial edits don't need
full audit mode; see the fast-path below.

## Trivial fast-path

Some edits carry no design risk, and dragging them through subsystem audit + design
notes is just friction. If a change is **all** of the following, take the fast-path:

- **No behavior change** — typo/comment/docstring fixes, formatting, a string or
  log-message wording tweak, a renamed local variable, a version bump in a doc.
- **No new control flow, data structure, dependency, or config key**, and it doesn't
  touch the security boundary, an execution path, or secrets.
- **Confined to a leaf** — one spot, no new call sites, nothing else depends on the
  shape of what you changed.

Fast-path = **read the line in context → make the surgical edit → re-read it → a
quick sanity check (does it still parse/build/run?).** That's the whole loop for
trivial work. No pre-flight design note, no subsystem audit, no formal verify.

The moment a "trivial" edit grows a real consequence — it changes behavior, adds a
branch, touches a tunable, crosses a layer, or you find yourself copy-pasting — it
is no longer trivial. Stop and run the full loop. When genuinely unsure which side
of the line you're on, treat it as non-trivial; the full loop is the safe default.

This skill is the conductor. It does the integration/design/duplication thinking
itself, and **delegates depth** to the specialist skills:

| When you need to… | Use |
|---|---|
| Apply surgical-change & simplicity discipline while writing | `karpathy-guidelines` |
| Examine an existing module for latent bugs/design smells (read, don't fix) | `audit` |
| Find a bug with runtime evidence instead of guessing | `debug` |
| Do a behavior-preserving cleanup / rename / file-split | `refactor-small-pass` |
| Checkpoint a verified fix into one traceable commit | `commit-after-fix` |

---

## Phase 1 — Pre-flight: read the code, then design the fit

This is the phase that pays for itself. **A feature starts by reading the code it
touches, not by writing code** (owner directive; `AGENTS.md` §9, `CLAUDE.md` Hard
rules). Produce a short pre-flight note *before* editing — to yourself, and surface
it to the user when the change is non-trivial or deviates from an existing pattern.

1. **Map what it touches.** Read the actual files in scope: entry points, the
   data-flow path, the data structures, and the layer boundaries it crosses. For
   v2 work, anchor in the doc map (`HANDOFF` → `ROADMAP` → `DECISIONS` →
   `DESIGN`/`ARCHITECTURE` → `TODO`). Don't infer behavior from a name or a
   comment — verify it in the code.

2. **Find the existing way.** Before writing new code or adding a dependency for
   X, locate how X (or its nearest sibling) is already done here and plan to
   extend it. Name the concrete seams you will reuse: which class, function,
   registry entry, config key, hook, or component.

3. **Guard both duplication directions** (the rule that bites most here):
   - *Different code for the same thing* — a parallel implementation that bypasses
     an existing pattern (e.g. an OS-`@media` reduced-motion block when `UIState` +
     the Appearance Switch already model the preference). One concept → **one
     source of truth.**
   - *Similar code for something we already own* — pulling in a new dep / writing a
     new helper that replicates ours (e.g. `react-error-boundary` when
     `ErrorBoundary.tsx` already exposes the same API). Reuse before you add.

4. **Choose a named design pattern, don't improvise structure.** Decide the shape
   deliberately: registry, adapter, strategy, factory, observer/pub-sub,
   repository, dependency injection, state machine, etc. Prefer the pattern this
   codebase already uses for that kind of problem (e.g. the **typed-action
   registry** is the primary execution path — extend it, don't add a side channel).
   If the right pattern is genuinely unclear or novel for this domain, **research
   it** (WebSearch/WebFetch for the canonical form and trade-offs) rather than
   inventing an idiosyncratic one — then write down which pattern you picked and
   why. A pattern chosen on purpose is reviewable; ad-hoc structure is not.

5. **No hardcoding.** Tunables (timeouts, limits, model ids, paths, feature
   toggles) go to `config.yaml` / `AgentDef` / Settings — never magic numbers in
   the body. If a value could reasonably change per host/deploy/user, it's config.

6. **Confirm before coding.** State the seams you'll reuse, the pattern you'll
   apply, and any deviation from an existing pattern. For anything non-trivial,
   get the go-ahead before writing. (Pause-between-phases is the house style — see
   the owner's review cadence.)

> If a deviation from an existing pattern is justified, that's allowed — but it
> must be a *decided* deviation surfaced in this note, not a silent fork. New
> architectural choices belong in `DECISIONS.md` as a D-entry before coding.

## Phase 2 — Build: clean code that reads like its neighbors

Apply `karpathy-guidelines` here for the moment-to-moment discipline (simplicity
first, surgical changes, goal-driven). On top of that:

- **Match the local idiom.** Write code that reads like the surrounding code —
  naming, comment density, error/return conventions, file layout. The goal is that
  a reviewer can't tell which lines are new by style alone.
- **Smallest change that satisfies the design.** No speculative abstraction, no
  configurability nobody asked for, no error handling for impossible states.
- **Honor the boundary.** Route execution through the established chokepoint
  (typed-action registry; never widen `/execute` or weaken the tailnet boundary).
  Never commit or echo secrets (`config.yaml`, `clients`, `*_prompt.*`).
- **Keep one source of truth** as you go — if you're about to copy a block, extract
  or reuse instead.

## Phase 3 — Post-flight: review → audit → debug → verify

A change isn't done when it compiles. Run this gate on every diff:

1. **Self-review the diff.** Re-read every changed line and ask: does each line
   trace to the request? Did I match the layer and pattern from the pre-flight
   note? Any duplication I introduced? Any tunable I hardcoded? Any orphaned
   import/var my change left behind? This is the built-in pass; for a focused
   external pass on a diff, the `code-review` command exists.
2. **Audit when the change is structural.** If the change touched a subsystem's
   design, concurrency, data structures, or boundaries — not just a leaf — run the
   `audit` skill over the affected module to catch latent issues the diff view
   hides. Audit *finds and documents*; it doesn't fix.
3. **Debug with evidence, never by guessing.** If something doesn't behave, switch
   to the `debug` skill (hypothesize → instrument → reproduce → analyze) rather
   than spray-and-pray edits. State the symptom, root cause, and fix in one line
   before you call it fixed.
4. **Verify against a real criterion.** Turn the task into a checkable goal and
   check it: run the relevant tests with the venv's `pytest`
   (`dashboard_v2/backend/tests/`), or run the app and observe (`run`/`verify`).
   Never live-test config writes against the real `config.yaml` — point
   `CTRLB_CONFIG`/`CTRLB_DB` at a temp copy. On Windows, don't run the v2 backend
   with `--reload` (breaks subprocess pings). If you couldn't verify, **say so
   plainly** — never describe an unverified change as validated.
5. **Strip instrumentation** (debug prints, temp logging, commented-out code)
   before declaring done.
6. **Commit only when asked.** When you do, scope it tightly; for a verified fix,
   `commit-after-fix` captures symptom/root-cause/fix in one traceable commit.

---

## Compact checklist

Pre-flight
- [ ] Read the files the change touches (not inferred from names)
- [ ] Identified the existing seam to reuse (class/fn/registry/config/component)
- [ ] No duplication either direction (one concept → one source of truth)
- [ ] Picked a named design pattern; researched it if novel; matches house pattern
- [ ] Tunables → config/AgentDef/Settings, no hardcoding
- [ ] Surfaced the design + any deviation; got go-ahead for non-trivial work

Build
- [ ] Smallest change that satisfies the design; surgical, no adjacent churn
- [ ] Reads like neighboring code; honors the security boundary; no secrets

Post-flight
- [ ] Self-reviewed the diff line by line
- [ ] Audited the subsystem if the change was structural
- [ ] Debugged with runtime evidence (not guesses) if anything misbehaved
- [ ] Verified against a real criterion (tests/run) on a temp config; or said it's unverified
- [ ] Removed instrumentation; committed only if asked, scoped tightly

## Boundaries

- This skill governs *process*, not *permission*. It never licenses weakening the
  security model, exposing `/execute`, or committing without being asked.
- Delegate, don't duplicate: when depth is needed, invoke the specialist skill
  above instead of re-deriving its workflow here.
- Match effort to the change. For non-trivial work the smallest legitimate run is
  still: read what it touches → make the surgical change → re-read the diff →
  verify. For genuinely trivial edits, the fast-path above is enough — but when in
  doubt, run the full loop.
