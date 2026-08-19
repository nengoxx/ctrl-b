# R44 — Guarding destructive memory operations + shaping curation passes

| | |
|---|---|
| **Question** | How does the field guard DESTRUCTIVE memory operations (delete/overwrite), and how does it shape CURATION/CONSOLIDATION passes? Specifically: is a **supersedes-existence check** precedented, or is the answer tombstones/trash, review queues, or nothing-but-git? What is the pass shape (batch size, delta report, actor, human-in-the-loop)? Does anyone split **read vs write budgets** inside memory tooling? |
| **Asked for** | [`CORE_MEMORY_PLAN.md`](../CORE_MEMORY_PLAN.md) §14d redesign item 3 — the owner's ruling that `delete` grows a `superseded_by: <topic>` arg (tool verifies existence) **or** an explicit logged `reason`, after run 2 executed a correctly-formed, hash-verified delete of a live topic whose merged replacement had been cap-blocked. |
| **New ground only** | R37/R40 (Claude Code memory at pin `a371abb`), R38 (peer recall field), R39 (cap-triggered promotion; Kilo/Codex/Letta postures) are **already bought and not re-reported** except where this pass corrects or extends them. |
| **Date** | 2026-08-19 |
| **Primary sources** | Hermes Agent local checkout `efc8ffa2` (owner's daily driver, read-only) · OpenAI Codex `f5a3dc5` · letta-code `ee230f30` · Kilo Code `26cbcf47` · open-webui `01f4282f` · LibreChat `0ab3414c` · Anthropic memory-tool docs (fetched 2026-08-19) · arXiv 2606.27472 |
| **Drove** | (open) the §14d redesign — delete-guard shape + the consolidation-pass redesign |
| **Index row** | ⚠ **owed** — not added (this pass was told not to edit `README.md`); add a row when this dossier drives a decision. |

Confidence markers: **[V]** = read the source / probed it myself · **[R]** = reported by a secondary source · **[U]** = expected but unverified.

---

## 1. Headline answers

1. **The supersedes-existence check IS precedented — once, in-class, and it exists because the exact
   failure ctrl-b hit happened there first.** Hermes Agent's `skill_manage(action="delete")` takes
   `absorbed_into=<target>`; the tool resolves the target on disk and refuses the delete if it does
   not exist, *"so the model can't claim an umbrella that doesn't exist"*. The guard was added in
   response to issue #29912, whose description is ctrl-b run 2 verbatim: *"the consolidation pass
   archived whole clusters of active skills with zero verified consolidations"*. **[V]**
2. **A required free-text `reason` on every destructive memory op is also precedented** — letta-code's
   `memory` tool schema has `"required": ["command", "reason"]` and the reason becomes the git commit
   message. **[V]**
3. **Nobody relies on "git-backed, therefore recoverable, no further guard."** Every git-backed
   corpus in the field adds at least one semantic guard on top (Codex: evidence-linkage +
   post-run artifact validation; letta-code: required reason + approval UI + worktree-branch
   isolation for the defrag pass; Hermes: existence check + archive-not-delete + tar.gz snapshot).
   0/5. **[V]**
4. **Archive-instead-of-delete for the AUTOMATED actor is the strongest single pattern.** Hermes
   makes it a hard invariant in code (a curator delete routes to `.archive/`, not `rmtree`; the
   foreground user-directed delete keeps hard-delete semantics). Letta's reflection prompt ships the
   same idea as `ARCHIVE.md` + a `deprecated: true` / `replaced_by: <name>` marker mode. **[V]**
5. **The curation pass is a forked/background actor with its own budget regime in 5/5 systems**
   that have one. ctrl-b's "owner-invoked chat procedure in the main thread" is a genuine field
   divergence — and §14c/§14d show it failing on exactly the properties that separate a chat turn
   from a curation pass (per-turn call caps, output clearing, no delta report).
6. **Read-vs-write budgets ARE split — by one project, cleanly.** Kilo Code's consolidation config
   carries `maxConsolidationInputBytes: 24_000` (what the pass may READ) beside
   `maxOpsPerRun: 16` (what it may WRITE), plus `timeoutMs` and `minIntervalMs`. **[V]**

---

## 2. Behavior counts (the bounded question, tallied)

| Behavior | Systems | Count |
|---|---|---|
| **Delete requires a supersedes target the tool VERIFIES exists** | Hermes `absorbed_into` | **1/9** |
| Delete requires a logged free-text `reason` (schema-required) | letta-code `memory(reason=…)` → git commit msg | **1/9** |
| Delete by an AUTOMATED pass is soft (archive/tombstone), hard delete reserved for the user | Hermes (code) · letta-code reflection `ARCHIVE.md` + `deprecated:`/`replaced_by:` (prompt) | **2/9** |
| Delete forbidden entirely for the auto/model path | Kilo (`trigger !== "explicit"` filters `remove` ops in code) · Codex (model has no delete on the durable corpus; append-only staging notes, *"Never delete a note file"*) | **2/9** |
| Delete allowed only where PROVENANCE is gone (evidence-linked forgetting) | Codex phase-2 consolidation prompt | **1/9** |
| Key-space closure (may only delete keys from a configured allowlist) | LibreChat `validKeys` | **1/9** |
| Opt-in approval/review queue covering deletes | Hermes `write_approval` → `/memory pending` · letta-code inline approval (`Delete memory?` + deny-reason) · Claude Code `/remember` proposal flow **[R, R40]** | **3/9** (all default-off) |
| Recoverability substrate: snapshot or git, with restore/rollback UX | Hermes (tar.gz pre-run, `curator rollback`, `curator restore`) · Codex (git baseline, reset only on success) · letta-code (git repo + worktree branch) | **3/9** |
| **Nothing at all beyond a path/existence check** | Anthropic memory tool (platform reference impl) · Claude Code AutoMem/dream (**no git, no backup, no write journal** — R40 §915) · open-webui (`remove` by id, no guard) | **3/9** |

Reference class (9): Hermes Agent · Claude Code AutoMem · Codex CLI `ext/memories` + `memories/write` ·
letta-code · Kilo Code `kilo-memory` · open-webui · LibreChat · AnythingLLM **[R, R39: hard item cap +
refuse, no delete-guard]** · Anthropic memory tool (platform).

---

## 3. Evidence — the supersedes check (Hermes, the direct precedent)

`tools/skill_manager_tool.py` at `efc8ffa2`. Two layers, both **[V]**:

**Layer 1 — the target must exist** (`_delete_skill`, :1221–1245):

```python
if is_consolidation:
    target_name = absorbed_target
    if target_name == name:
        return {"success": False, "error": f"absorbed_into='{target_name}' cannot equal the skill being deleted."}
    target = _find_skill(target_name)
    if not target:
        return {"success": False, "error": (
            f"absorbed_into='{target_name}' does not exist. "
            f"Create or patch the umbrella skill first, then retry the delete.")}
```

Note three things ctrl-b should copy verbatim: **self-reference is rejected**, the error names the
**correct next action** (create-before-delete, in order), and the docstring states the threat model
plainly — *"Validated here so the model can't claim an umbrella that doesn't exist."*

**Layer 2 — during a consolidation pass, a bare prune is refused outright**
(`_curator_consolidation_delete_guard`, :463–510):

> *"The curator's forked review agent … Its only legitimate `skill_manage(delete)` is a **verified
> consolidation** … A delete with no forwarding target — `absorbed_into` omitted (`None`) or empty
> (`""`) — is the fail-open behavior reported in #29912: the consolidation pass archived whole
> clusters of active skills with zero verified consolidations (`consolidated_this_run == 0`),
> leaving active automations pointing at names that no longer resolve. The deterministic inactivity
> prune is the only legitimate prune path … Refuse it; keep the skill active."*

So the escape hatch (`absorbed_into=""` = "truly pruning, no target") exists in the **tool** but is
**closed for the automated curation actor**; unsupervised pruning is delegated to a *deterministic,
time-based, non-LLM* path instead. The discriminator is `is_background_review()` — a **trigger/origin
check**, not a model-discipline rule.

**Layer 3 — the destructive act is soft for that actor** (:1253–1278):

> *"During the curator consolidation pass, a verified consolidation must be RECOVERABLE … Route
> through the recoverable archive primitive instead of permanent `rmtree` so a misjudged
> consolidation can be undone (#29912). Foreground, user-directed deletes keep their existing
> hard-delete semantics."*

**A residual Hermes names itself and ctrl-b would inherit** (`curator.py:943`): the existence check
is evaluated *at delete time*, so *"the umbrella was deleted LATER in the same run"* can still leave
a broken reference. Their reconciler falls through to other signals rather than trusting it. For
ctrl-b: either re-verify every `superseded_by` target at end-of-pass, or refuse deleting a topic that
was named as a `superseded_by` target earlier in the same run.

Also **[V]**: `_validate_delete_target` is a separate defence-in-depth layer before any recursive
delete (reject symlinked dirs, reject a path not strictly inside a known root, reject a root itself)
— explicitly a port of Kilo Code's #11227, where a sentinel path resolved to the server cwd and a
recursive delete wiped a user's working directory. ctrl-b's §5 path-confinement rule already covers
this class; this is corroboration, not a gap.

---

## 4. Evidence — the `reason` half (letta-code)

`src/tools/schemas/Memory.json` at `ee230f30` **[V]**:

```json
"reason": { "type": "string",
  "description": "Required commit message for this memory change. Used as the git commit message." },
...
"required": ["command", "reason"]
```

Commands: `str_replace | insert | delete | rename | update_description | create`. `delete` deletes
files *or directories recursively* and its implementation (`src/tools/impl/memory.ts:249–265`) is a
plain `rm`/`unlink` — **no supersedes check, no tombstone**. The safety net is entirely: (a) the
schema-required reason, (b) auto-commit to the memory git repo, (c) an opt-in inline approval UI
(`InlineMemoryApproval.tsx` renders `"Delete memory?"` with a deny-reason field). This is the
closest thing in the field to the "git-backed + a logged reason" posture — and note it is *both*
halves of the owner's ruling at once, not one or the other.

The tool description adds a referential-integrity rule ctrl-b's index makes relevant **[V]**:
> *"When creating or deleting files, check for `[[path]]` references in other memory files that may
> need to be added or updated."*

---

## 5. Evidence — the trigger gate (Kilo) and the no-delete posture (Codex)

**Kilo Code**, `packages/kilo-memory/src/memory.ts:187–192` at `26cbcf47` **[V]** — R39's finding
holds at HEAD, and here is the mechanism verbatim:

```ts
const trigger = input.trigger ?? "explicit"
const inputOps = trigger === "explicit" ? input.ops : input.ops.filter((item) => item.action !== "remove")
```

`Trigger = "explicit" | "turn-close" | "rebuild"`. Automatic passes may **add but never remove**, and
it is enforced by a code-level filter, not a prompt. This is the cheapest guard in the field.
*(Correction to R39 §5.6: the package has been restructured — `prompts/typed-consolidation.txt` is
gone; HEAD ships `session-digest.txt` + `tool-memory-save.txt` and a `capture/` pipeline with
`plan/operations/reject/redact/diff`. The `forget` action now lives only on the explicit
user-driven save tool.)* **[V]**

**Codex CLI** — the model that writes memory has **no delete** on the durable corpus at all (R39
§5.2, re-verified at `f5a3dc5`: tools are `list`/`read`/`search`/`add_ad_hoc_note`). Deletion happens
only inside the phase-2 consolidation sub-agent, and its licence to delete is **provenance-scoped**
(`templates/memories/consolidation.md`, verbatim) **[V]**:

> *"For deleted `rollout_summaries/*.md` or `extensions/*/resources/*.md` files, search their
> filenames, paths, and thread ids (when present) in `MEMORY.md`. **Delete only memory supported by
> deleted inputs.** … If a `MEMORY.md` block contains both deleted and still-present evidence, **do
> not delete the whole block.** Remove only stale references and stale local guidance, preserve
> shared or still-supported content, and split or rewrite the block only if needed."*

This is a different shape from `superseded_by`: it links deletion to the *disappearance of the
evidence that justified the memory*, not to the existence of a replacement. It is the right shape
for a corpus derived from transcripts; ctrl-b's corpus is hand/agent-authored, so the replacement
link is the applicable one. Worth knowing both exist.

---

## 6. The curation pass — shape, actor, batch, delta report

### 6.1 Actor: nobody runs it in the conversation thread

| System | Actor | Trigger | Isolation |
|---|---|---|---|
| Claude Code | forked "dream" agent, cache-reusing | 24 h **and** 5 sessions; 10-min scan throttle | best-effort `.consolidate-lock` inside the corpus **[R40]** |
| Codex CLI | internal consolidation **sub-agent**, no approvals, no network, local write only, collab disabled (no recursive delegation) | root-session start, background, only if the memory git worktree is dirty | **global phase-2 lock** + git baseline **[V]** |
| Hermes | background fork of `AIAgent`, own prompt cache | `interval_hours: 168` **and** `min_idle_hours: 2`; never touches the live conversation | pre-run tar.gz snapshot; separate aux-model slot **[V]** |
| letta-code | `memory` (defrag) and `reflection` subagents | post-turn / on demand | **git worktree on a branch, merged to main at the end** **[V]** |
| open-webui | detached per-turn aux call | after each assistant turn | none; ops applied via one API call tagged `source: 'background_review'` **[V]** |
| Kilo | separate typed pass | `turn-close` / `explicit` / `rebuild`, 5-min floor | 30 s timeout **[V]** |
| **ctrl-b (§5, shipped)** | **the main model, in the owner's chat turn** | owner asks | none — inherits the chat turn's budgets and D42 output clearing |

The divergence is not the *model* (R39 already ruled that at N=1 the main model is the right brain).
It is the **budget regime**: in the field the curation actor is *defined* by having different
budgets, different clearing rules and a different output contract from a chat turn. §14d items 1–2
are therefore the field-shaped fixes, and this dossier supports them.

Two field mechanisms make the "keep the main model, change the regime" reconciliation concrete:
- **Hermes's batch op** — `MemoryStore.apply_batch(target, operations)`: a *single* tool call
  applying a sequence of add/replace/remove, *"validated and applied against the FINAL budget —
  intermediate overflow is irrelevant. This lets the model free space (remove/replace) and add new
  entries in a SINGLE tool call instead of the multi-turn consolidate-then-retry dance."*
  All-or-nothing; one poisoned op rejects the whole batch. **[V]** This is a leaner answer to
  "the turn that reads cannot write" than raising `max_calls_per_tool`.
- **Kilo's split budgets** (§6.3 below).

### 6.2 Batch size: whole-corpus, but diff-scoped

Nobody chunks the corpus into fixed-size batches. Instead:
- Codex reads a **git diff since the last successful baseline** and says *"Spend most of your
  deep-dive budget on added/modified inputs and on mixed blocks touched by deleted inputs. Do not
  re-read unchanged older threads unless you need them."* The diff file itself is byte-bounded and
  truncates with a marker. **[V]**
- Hermes's prompt sets a *cluster*-shaped unit (*"Identify PREFIX CLUSTERS … Expect 10-25 clusters"*)
  and an explicit floor (*"If you end the pass with fewer than 10 archives, you stopped too early"*)
  — the opposite of ctrl-b's problem, but the same insight: name the unit of work. **[V]**
- Kilo bounds it numerically: `maxConsolidationInputBytes: 24_000`, `maxOpsPerRun: 16`,
  `maxSessionFiles: 20`, `maxRecentSessions: 5`. **[V]**
- letta-code's defrag prompt explicitly **refuses** a count target: *"no hard file-count target …
  Optimize for clarity and retrieval quality, not arbitrary quotas."* **[V]**

For ctrl-b's §14c item 6 ("one topic family per run, finish it, report"), the field's support is
Hermes's cluster framing, not a numeric batch: **name the unit (a topic family), bound the ops, let
the signal set the depth.**

### 6.3 Read-vs-write budget accounting — the only clean split

Kilo Code `packages/kilo-memory/src/schema.ts:70–81` **[V]**:

| Knob | Value | Governs |
|---|---|---|
| `maxConsolidationInputBytes` | 24 000 | **read** — how much corpus + transcript the pass may ingest |
| `maxOpsPerRun` | 16 | **write** — how many mutations one pass may apply |
| `timeoutMs` | 30 000 | wall clock for the pass |
| `minIntervalMs` | 300 000 | floor between passes |
| `maxProjectIndexBytes` | 8 192 | the always-injected index cap (ctrl-b's `index_char_limit` = the same number) |

Adjacent, weaker instances: LibreChat caps `tokenLimit` on **write values only** (no read budget)
**[V]**; Codex gates the *whole pass* on remaining API quota
(`config.memories.min_rate_limit_remaining_percent`, `guard.rs`) — a pass-level budget, not a
read/write split **[V]**; Hermes caps *write failures* per turn
(`_MAX_CONSOLIDATION_FAILURES_PER_TURN = 3`, then returns a terminal "stop retrying, answer the
user" result — issue #42405) with no read cap at all **[V]**.

**Nobody funds reads and writes from one shared counter the way ctrl-b's `max_calls_per_tool` does.**
That is the anomaly §14d item 2 identified, and it is anomalous in the field too.

### 6.4 Delta reports — the convention exists and Hermes has the strongest form

- **Hermes** writes `~/.hermes/logs/curator/<ts>/{run.json, REPORT.md}` per run, plus a user-visible
  **rename map** (`old-name → new-name`) in the end-of-run summary. The prompt *requires* a
  structured YAML block with two lists — `consolidations: [{from, into, reason}]` and
  `prunings: [{name, reason}]` — and the binding rule: *"Every skill you moved to `.archive/` MUST
  appear in exactly one of the two lists."* The report generator then **reconciles the model's
  claims against tool-call evidence**, with `absorbed_into` declared at delete time as the
  authoritative signal and a model-declared destination that doesn't exist downgraded as *"the model
  hallucinated an umbrella"*. **[V]** This is a delta report that is *checked*, not trusted.
- **letta-code** reflection: report = Summary · Memory changes (created/modified/**deleted**/moved/
  **archived**) · Skill changes (operation chosen) · **Skipped, and why** · Commit confirmation ·
  Issues. The defrag report adds Splits/Merges/New-files tables with reasons and before/after
  char deltas. **[V]**
- **Codex**: the git diff *is* the report, and it is also the next run's input. Baseline resets only
  after the agent completes successfully, and `validate_consolidation_artifacts()` runs a structural
  check afterwards (required files exist, `memory_summary.md` starts with `v1`, zero symlinks in the
  tree). **[V]**
- **Claude Code**: a user-visible "Improved" notification + progress/kill controls; no itemized
  delta. **[R40]**

**Directly applicable to §14c item 10** (degenerate runs reported `state: completed`): Hermes's
report derives its counts from **actual tool calls and filesystem state**, not from what the model
said; ctrl-b's writes-derived outcome signal is the same move.

### 6.5 Human-in-the-loop points

- **Dry run as a first-class mode** — Hermes ships `hermes curator run --dry-run` with a dedicated
  banner prompt (*"DRY-RUN — REPORT ONLY … Your output IS the deliverable … describe the actions you
  WOULD take … A downstream reviewer will read the report and decide whether to approve a live run"*)
  and even *"If you accidentally take a mutating action, say so explicitly."* **[V]** Nothing else in
  the class ships a dry run.
- **First-run deferral** — Hermes seeds `last_run_at` to "now" on first observation and defers the
  first real pass by one full interval, *"so you have a full interval to review your skill library,
  pin anything important, or opt out entirely before the curator ever touches it."* **[V]**
- **Pin / jurisdiction** — `pinned: true` blocks both the automated pass and the agent's own delete;
  `created_by` is consumed as a policy flag (*"may autonomous curation touch this?"*) and is
  **declared, never inferred**: *"An automatic 'looks agent-made, adopt it' heuristic would
  eventually archive something you hand-wrote."* Plus a hardcoded never-touch set of protected
  built-ins that back load-bearing UX, filtered out of the candidate list entirely. **[V]**
- **Rollback** — pre-run tar.gz snapshot, `keep: 5`, and the rollback itself snapshots first so a
  mistaken rollback can be rolled forward. **[V]**
- **Approval queues** — Hermes `write_approval: true` stages every write (foreground *and*
  background) to `/memory pending` with approve/reject; letta-code prompts inline per memory command
  with a deny-reason. Both **default off**. **[V]**

### 6.6 Overwrite guards (the other half of "destructive")

- Anthropic's memory tool spec: `rename` **must refuse** an existing destination (*"do not
  overwrite"*), `create`'s reference behavior errors on an existing file, `str_replace` refuses when
  `old_str` is absent *or* ambiguous. **`delete` has no equivalent guard — only an existence check
  and "cannot delete the memory root."** The asymmetry is explicit in the spec. **[V]**
- Hermes's memory tool has two refusals worth stealing wholesale **[V]**: **drift** — if the on-disk
  file wouldn't round-trip through the tool's parser (a hand edit, a sister session, a shell append),
  refuse the write, snapshot to `.bak.<ts>`, and hand the operator a remediation script (*"This guard
  exists to prevent silent data loss (issue #26045)"*); and **unreadable ≠ empty** — *"A file that
  exists but cannot be read is NOT an empty store. Reading it as `[]` and then persisting would
  rewrite the whole file from an empty entry list — wiping the user's memory."* ctrl-b's D26
  reconcile sweep covers the first case for *versioning* but not for *refusing the write*.
- LibreChat's prompt closes the delete-then-recreate path that ctrl-b's run-2 model took: *"For
  updating existing memories, use the `set_memory` tool instead of deleting and re-adding."* **[V]**

---

## 7. Out-of-class prior art (one look, as briefed)

- **Soft-delete/tombstone is the norm one tier up, in managed/graph memory platforms**: Zep
  soft-deletes with timestamps so a superseded fact stays auditable but stops surfacing in
  retrieval; AWS AgentCore's extract→consolidate→store pipeline marks old entries **invalid rather
  than deleted**. **[R — secondary source only; not source-verified in this pass.]** This is the
  general form of Hermes's `.archive/` and letta's `ARCHIVE.md`.
- **The failure is named in the literature.** arXiv 2606.27472 ("Supersede: Diagnosing and Training
  the Memory-Update Gap in LLM Agents") measures agents dropping an old value without preserving the
  new one — *"the model responds with 'no information about Rachel', indicating the old value was
  dropped without the new value being preserved"* — and finds the gap persists with stronger models
  and bigger buffers. Its proposed remedy is **RL training, not a structural guard**. **[R]**
  Read together with §14d's "a stronger model converts *fails safely* into *fails dangerously*",
  this is independent support for making the protection structural.
- **open-webui community guidance** tells the model that clearing all memories is a high-risk
  operation to be performed by the user in Settings rather than by the model — a prompt-level
  refusal that routes bulk destruction to the human. **[R — community tool docs, not core
  source; core `remove` has no such guard.]**

---

## 8. Implications for ctrl-b (short, separate, ages fast)

**Verdict on the owner's ruled shape: SOUND AS RULED, with one lean amendment and two riders.**

- ✅ `superseded_by: <topic>` with **tool-verified existence** — precedented exactly (Hermes
  `absorbed_into`), and adopted there *after* the identical incident. Copy three details: reject
  `superseded_by == path`; make the error name the correct next action (*"create the merged topic
  first, then retry the delete"*); and record the same-run residual (a target created earlier in the
  pass can itself be deleted later — re-verify at end-of-pass, or forbid deleting a topic that was
  named as a target earlier in the run).
- ✅ The `reason` escape hatch — precedented (letta-code, schema-required, becomes the commit
  message). ctrl-b's D26 commits are content-free by design, so land the reason in the
  `ActionService._record` audit row rather than the commit subject.
- ⚠ **Amendment (the one thing to add): make a consolidation delete SOFT.** Three independent
  precedents (Hermes code-level, letta prompt-level, Zep/AgentCore platform-level) and it is close to
  free here: §3's scan already excludes *"any path with a dotted or `logs` component"*, so
  `delete` = atomic rename into `<root>/.archive/<path>` is invisible to the index, the render and
  `search` with **zero scan-rule changes**, and it is versioned by D26 like everything else. Run 2's
  recovery needed main-seat `git revert`; an archive makes recovery an owner-visible file move. Keep
  hard delete for an explicit owner-directed "delete this permanently" — the field consistently
  splits *automated actor = soft* from *user-directed = hard*.
- ⚠ **Rider — the existence check does not cover run 2's second defect.** The drafted merged topic
  carried hallucinated status claims; had the `create` succeeded, the existence check would have
  *approved* the delete. What catches that is the delta report + dry-run + archive, not the guard.
  Say so in the plan so the guard isn't over-trusted.
- ⚠ **Rider — ctrl-b has no trigger discriminator.** Hermes's fail-closed rule ("a bare prune is
  refused for the automated pass") and Kilo's op filter both hang off *who/what triggered the write*
  (`is_background_review()`, `trigger === "explicit"`). ctrl-b's consolidation runs in the ordinary
  chat turn, so there is nothing to hang it on. If §14d's task-scoped consolidation mode is built
  (for the budget/clearing exemptions anyway), it becomes the natural home for a stricter delete
  policy — one seam, two payoffs. Without it, `reason` is an escape any turn can take.

**Pass-shape items the field supports** (all already candidates in §14c/§14d — this dossier says
which have precedent):
1. Exempt core-memory reads from clearing / give the pass its own regime — **supported**: 5/5
   peers run curation under a different budget regime than a chat turn (§6.1).
2. Split read from write budgets — **supported, with a concrete model**: Kilo's
   `maxConsolidationInputBytes` vs `maxOpsPerRun` (§6.3). Cheaper alternative worth costing first:
   Hermes's **all-or-nothing batch op** (one call, N ops, validated against the final state), which
   makes "the turn that reads cannot write" disappear without touching the counter.
3. Delta report — **supported, and it must be verified against tool-call evidence, not trusted**
   (Hermes reconciles the model's YAML against the actual deletes; §6.4). This is also the
   writes-derived outcome signal §14c item 10 asks for.
4. Bounded batches — **partially supported**: name the unit (topic family / cluster) and bound the
   ops; nobody chunks by fixed count, and letta explicitly refuses quotas (§6.2).
5. **Not yet on ctrl-b's list, and cheap:** a `--dry-run` consolidation mode. Hermes is the only
   peer that ships one, and its banner prompt is a ready-made template (§6.5). For a procedure that
   has now failed twice, a preview run the owner approves before a live one is the highest-value
   human-in-the-loop point available.
6. Also not on the list: Hermes's **drift refusal** (a hand-edited topic that wouldn't round-trip
   ⇒ refuse the write + snapshot) and **unreadable ≠ empty**. ctrl-b's tolerant-read contract makes
   the first largely moot; the second is worth a look at the atomic-write path.

---

## 9. Corrections to prior beliefs

1. **R39 §5.6 (Kilo) is structurally stale**: `prompts/typed-consolidation.txt` no longer exists at
   `26cbcf47`; HEAD ships `session-digest.txt` + `tool-memory-save.txt` and a `capture/` pipeline.
   The *finding* survives intact and is now visible as one line of code (§5). **[V]**
2. **`letta-ai/letta` is now a landing page.** At HEAD it contains only README/LICENSE/docs — the
   V1 server source is preserved on the `archive` branch, and current source lives in
   `letta-ai/letta-code`. R39 anticipated this ("future cites go to `letta-code`"); it is now
   complete, so *any* letta path cite in an older dossier is dead unless it points at the `archive`
   branch. **[V]**
3. **R40 §915's "no Git versioning of auto memory" is load-bearing for this question**, not just a
   detail: it means Claude Code's dream pass can delete a topic irrecoverably. Claude Code is
   therefore the *weakest* reference for delete safety, not the default to copy — which matters
   because CORE_MEMORY_PLAN treats it as the source-of-truth shape elsewhere.

---

## 10. What I could not determine

- **Whether Hermes's `absorbed_into` guard is enforced anywhere other than the background-review
  path.** A foreground, user-directed `skill_manage(delete)` accepts `absorbed_into=None` with only
  a logged warning (the docstring says "accepted for backward compat"). So the "verified
  consolidation" contract is *pass-scoped*, not universal — I did not find a variant that requires
  it everywhere. **[V on the code, U on whether that's deliberate policy or debt.]**
- **Whether letta-code's memory approval prompt is on by default, or which permission mode gates
  it.** I read the component and the schema but not the permission wiring
  (`src/agent/check-approval.ts`, `src/cli/helpers/approval-classification.ts` returned no memory
  hits on a grep). Treat "opt-in" as **[U]**.
- **Any newer Claude Code AutoMem/dream source than R37/R40's `a371abb` pin.** No newer source was
  available to read in this pass; §6.1's Claude Code row is **[R]** via R40, not re-verified.
- **Zep and AWS AgentCore soft-delete mechanics** — secondary source only; if that pattern is ever
  going to drive a ctrl-b decision it needs a source-read pass of its own.
- **Whether any system re-verifies supersedes targets at end-of-pass.** Hermes explicitly does *not*
  (it degrades to other signals); I found no system that does. The end-of-pass re-verification
  suggested in §8 is therefore **an original proposal, not a field pattern** — flagged as such.
- **Empirical effect of any of these guards.** Hermes's #29912 and the arXiv paper document the
  *failure*; nobody publishes a before/after on the guard's effectiveness.
