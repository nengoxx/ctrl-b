# CORE_MEMORY_PLAN — the tier-2 long-term memory lane (spec of record, D57)

> **Status: LOCKED as D57 2026-08-17 (owner) — ✅ S0–S5 COMPLETE, BUILT END TO END 2026-08-17**
> (S1 `6b16545` · S2 `bd6b9fd` · S3 `ced9056` · S4 `30f00b4`; per-slice review records in §11,
> the as-built appendix in §14; **shipped OFF by default — enabling is the §3b procedure**).
> All rulings settled (§2a 2026-08-16 + §2b 2026-08-17); the O4 promotion design grounded in
> [R39](./research/R39-cap-triggered-tier-promotion.md) (§4b); council round CLOSED (§13 — Codex
> + adversarial Opus, both BUILD WITH CHANGES, every finding folded in place; confirm round
> clean) and corroborated by [R40](./research/R40-claude-code-memory-source-specification.md)'s
> source crosswalk.
> **Provenance:** the owner's external "Hermes Core Memory" design
> (`~/Documents/Maia/40 Projects/2026-08-11-project-scoped-profile-memory-architecture/` —
> SPEC/DECISIONS/LOG; Codex-authored + twice-adversarially-audited there; **read-only, never
> modified from this repo**) → three independent verification passes commissioned 2026-08-16:
> [R37](./research/R37-claude-code-memory-source-verification.md) (Claude Code source
> verification at the spec's exact pin) · [R38](./research/R38-selective-memory-recall-field.md)
> (peer-class + literature corroboration) · a full ctrl-b seam map (fit audit, folded into §6–§7).
> On conflict, `DECISIONS.md` wins; this file becomes spec-of-record at LOCK (D57).

## 0. What this is

A **second, optional memory tier** beside the existing file memory: one **shared, Claude-Code-native
markdown corpus** — a concise `MEMORY.md` routing index plus semantic topic files — holding durable,
long-term, cross-agent knowledge (preferences, stable facts, corrections, references). The existing
lane (per-agent `MEMORY.md` + global `USER.md`/`STATE.md`, capped, fully injected every turn — D14/
D15/D27) is **untouched** and becomes, in the owner's framing, the *basic/short-horizon* tier; Core
Memory is the *long-term shared* tier — "like the skill system, but for memories" (owner,
2026-08-16).

**The tier model (owner ruling, reshapes ROADMAP §B1):** ctrl-b memory = **tier 1** (built-in file
memory, always on as today) + **tier 2** (one *selectable* long-term backend at a time — Core Memory
is the first; embeddings/vector, Hindsight, Honcho etc. are possible later drop-ins into the same
slot, à la Hermes's one-external-provider model). B1's "vector / both" sketch is superseded by this
tier framing; the vector idea survives as a *future tier-2 backend*, not a parallel mode.

**Core purpose** (inherited from the vault spec's owner decision): *reliable continuity across
sessions without bloating every prompt* — a fresh session recalls relevant prior facts without the
owner repeating them, and irrelevant memory is not injected.

## 1. The judged mechanism — index + tool reads, no selector

The vault spec's central mechanism was a **pre-answer auxiliary-LLM selector** (one bounded side
call per substantive turn picks topic filenames from a metadata manifest). **We do not adopt it in
v1.** The evidence, in order of weight:

1. **R37 (verified at the spec's own pin):** Claude Code's index injection and its LLM-selector
   recall are **mutually exclusive feature cohorts** behind one flag. The shipping default is:
   inject the bounded index, main model reads topic files on demand. The selector cohort is the
   experiment — and its async form ships with telemetry (`hidden_by_first_iteration`) measuring its
   own first-response miss.
2. **R38 (peer class, 12 repos at HEAD):** *nobody else* runs an LLM selector for memory — the two
   newest in-class memory systems (Codex CLI `ext/memories`, Kilo `kilo-memory`) both chose
   **always-injected index + literal search tools**; nobody blocks the first token on an auxiliary
   LLM call; and the strongest current benchmark evidence (arXiv 2605.15184, grep-vs-vector *inside*
   Claude Code/Codex CLI) favors lexical search over both vector and, implicitly, manifest routing.
3. **Measured on the owner's real 56-topic corpus (R38):** the selector manifest is ~5k tokens *per
   substantive turn*; ~18k at 200 topics. An injected index is a bounded block sitting in the cached
   prefix instead. The selector also serializes ahead of the first token behind D40's per-endpoint
   gate on a single local llama.cpp (fit audit C12) — the entire voice-latency budget.
4. **Owner ruling (2026-08-16):** stay close to what Claude Code actually ships; don't add an LLM
   hop unless it's proven necessary.

**So v1 recall =** a bounded **index block in the static head** (policy framing + the rendered
index) and a **`core_memory` tool** whose `read`/`search` actions let the main model pull topic
content mid-turn, before its first user-visible answer (ctrl-b's loop already iterates on tool
calls — a voluntary read is *synchronous within the turn*, so the fresh-session first-answer
acceptance holds without any aux call). Recall is thereby **visible in the transcript as ordinary
tool calls** — solving the recall-visibility question for free.

The selector is **banked, not dead** (§10): a future opt-in precision/latency arm behind a measured
trigger, on the existing aux-call seam (`InferenceClient.complete` + a `ModelRef`, the compaction-
summarizer shape). R38 §8 names the cheap local experiment (selector-vs-grep on the real corpus)
that would justify it.

## 2a. Owner rulings — SETTLED (conversation, 2026-08-16)

1. **Claude-corpus interoperability = copy-in migration, not live attach.** The format is adopted;
   a copied Claude memory dir (MEMORY.md + topic tree) must *just work*. Live shared-root attach is
   NOT a v1 requirement → the vault's "non-mutating attach" constraint and its D26 conflict drop
   out. The three copy-in hazards (all handled by §3's tolerant read): nested-`metadata.type`
   frontmatter (what the current Claude client writes — R37 claim 13 CORRECTED), foreign non-topic
   files (`.consolidate-lock`, `logs/`), oversized descriptions (live p100: 6,337 chars).
2. **Tier model** as in §0 — tier 2 is a selectable slot; Core Memory first, others later; never
   more than one active.
3. **No LLM selector in v1** (§1). If one is ever justified, it defaults to the main model route.
4. **One shared corpus across all agents.** Agent identity is provenance, never a partition. Basic
   memory = short-horizon/per-agent; Core Memory = long-term, system-wide.

## 2b. Owner rulings — SETTLED (conversation, 2026-08-17)

| # | Question | Ruling |
|---|---|---|
| O1 | **Headless policy** — tier-1 memory is fully live for automations/subagents; only the reflection nudge is origin-gated (`session.py:859`). Same for Core Memory? | **Live everywhere** (index + tool in all sessions). Symmetric, zero special cases; revisit only if a headless run ever pollutes the corpus. Recorded as a **ctrl-b product choice, not Claude parity** — Claude's automatic memory actors are mode/depth/remote gated (R40 §18.1). |
| O2 | **Unqualified "remember this"** — the vault spec *asks* which lane every time. | **Never ask.** The tool descriptions + the P1 policy encode the split (basic = working/short-horizon + owner profile; core = durable shared long-term — workflows, conventions, stable facts); the model routes by durability/scope, explicit wording always wins. **Owner rider:** every model-facing text this feature adds must be owner-editable — the five registry ids (§6) surface in Conf → Prompts (Phase 18); routing guidance in tool descriptions is `tool_overrides`-editable. |
| O3 | **Read actions** — D14/D15 deliberately gave the `memory` tool *no read* ("memory is in the prompt"). Core Memory's whole mechanism is tool reads. | **Accept the divergence, record it in D57.** The owner's bar is "as close as possible to what Claude Code ships", and R37 confirms the shipping shape IS index-in-head + on-demand topic reads; the no-read rule was a property of a fully-injected store. |
| O4 | **Write posture + cleanup** — R38: "proactive capture with no cleanup pass is the one combination the field does not run." | **Proactive writes stay; cleanup v1 is prompt-steered, main-model, in-session — no separate consolidator** (owner, 2026-08-17). Concretely: the standing routing rule in `core_memory_policy` + the tier-aware cap-pressure nudge + `MemoryCapError` clause (§4b) + the owner-invoked consolidation procedure (§5). An autoDream-style scheduled pass is **banked** (§10) as a future optional arm riding the A3 automations scheduler. Field basis: R39 (the trigger is the field's modern default; the main-model actor is the correct small-scale form — Letta alerts on reflections >10 min/>100 steps, which is the bloat being refused). |
| O5 | **Phase ordering** | **Core Memory = Phase 20 and executes FIRST**; Phase 19 (hardening) stays parked, owner-gated (owner, 2026-08-17). Consequence: **Core Memory takes D57**; the hardening charter renumbers to D58 when it wakes. |

## 3. The corpus contract

**Location:** `<memories_dir>/core/` by default (`memory.longterm.core.root`, relative → resolved
against `memories_dir_path()`, absolute honored — the existing idiom). Living inside the memory dir
means the **D26 git repo versions it and the reconcile sweep captures hand edits for free** — zero
new backup machinery; `MemoryBackup._GITIGNORE` gains `logs/` + `.consolidate-lock` so copied-in
foreign artifacts are never versioned (council M7). (An absolute root outside `memories/` is
allowed but documented as unversioned — **a recorded D26 divergence for D57**, not just a
consequence; refuse a root that is or contains `$CTRLB_HOME`/`config.yaml`/the DB, reusing the
`_safe_root` spirit. **Additionally refuse, after symlink resolution, any root whose index or scan
tree overlaps a tier-1 store path** — e.g. `root: "."` would make core's index the root agent's
`MEMORY.md`; relative roots must be non-empty strict children of `memories_dir` avoiding the
reserved tier-1 locations — council Codex-1.)

**Files:** `MEMORY.md` = index only (one-line relative links `- [Title](file.md) — hook`); topic
files = markdown with frontmatter. **Tolerant read, match-neighbours write** (R37's corrected rule —
NOT the vault's "always write the newest canonical shape"):

- read `name`/`description` from top-level **or** nested `metadata.*`; **on conflict top-level
  wins** (deterministic — it is Claude's own canonical shape); `type` ∈
  {user, feedback, project, reference} from either; unknown/missing degrades to untyped, still a
  valid topic; **preservation contract (weakened from "byte-for-byte" — council Codex-9):**
  enable+read leaves every file byte-identical; an app *edit* preserves untouched decoded content,
  key order, comments and unknown fields, but normalizes the file to LF on first write (the
  existing primitives force LF). CAS matching stays exact-Unicode, no normalization fallback;
- new files in an empty/ctrl-b-born corpus use the top-level shape; new files in a copied corpus
  match neighbours **deterministically**: directory majority → corpus majority → top-level on tie.
  `create` takes **structured fields** (name/description/type/content) and the service renders the
  frontmatter — the model never supplies raw YAML (council Codex-8);
- scan = recursive `*.md`, **excluding every basename `MEMORY.md`** (R37 §3 — Claude excludes by
  basename, not just the root) and any path with a dotted or `logs` component
  (`.consolidate-lock`…), plus files with no parseable frontmatter *and* no index link (logged
  once, never fatal);
- **the index is the routing source, never repaired on read**: dangling/duplicate index links are
  omitted from the rendered view, parseable-but-unindexed topics stay `search`-able, anomalies are
  reported in the Conf status line — repairs happen only through explicit writes/consolidation;
- index rendering clamps each entry (~150 chars, Claude's own guidance) regardless of description
  length on disk; entry text is **normalized before injection** (newlines/control chars → spaces,
  link syntax escaped, clamped at entry boundaries) since descriptions are model/foreign-written
  text entering a system message (council Codex-13); the index block has a hard char cap
  (`index_char_limit`, default **8,192 chars** — Kilo's bound; the truncation warning line is
  reserved *inside* the cap; Claude's own is 200 lines/25 KB) with soft truncation, never an
  error. No separate topic-count threshold (one honest bound — council Codex-14);
- **the rendered index is cached** keyed by the scan signature (paths + mtimes): the per-turn cost
  is a stat sweep, parses only on change (the render sits on the synchronous per-turn path —
  council M3);
- writes are atomic via the existing atomic-replace primitive (**hoisted from
  `services/agent/memory.py:_atomic_write` into `core/fsutil.py`** — `write_text_eol` alone is not
  atomic; council M7), serialized under the existing `MemoryBackup.guard()` **in-process
  `asyncio.Lock`** (it does not guard against external editors — the D26 reconcile sweep is the
  answer there), each committed by the D26 backup — content-free commit subjects, same as tier 1.

**Copy-in migration** is a documented procedure, not code: copy the folder in, restart or reload —
the scan and tolerant read do the rest. (A validation affordance — "N topics parsed, M skipped" —
comes free as the Conf status line, §8.)

### 3b. Copy-in procedure (owner-facing, S4)

Adopting an existing Claude-shaped corpus is five steps and no code path of its own:

0. **On a deployment whose memory repo predates this feature: fix the `.gitignore` FIRST** (the
   one-time step below) — the D26 reconcile sweep runs every couple of minutes, so a copy that
   lands before the ignore lines would version `logs/`/`.consolidate-lock` in the interval.
1. **Copy the folder** to `<memories_dir>/core/` — `MEMORY.md` plus the topic tree, exactly as it
   sits. Foreign artifacts (`.consolidate-lock`, `logs/`, a nested `MEMORY.md`) may come along; the
   scan excludes them and the `.gitignore` keeps the first two out of the D26 repo.
2. **Switch tier 2 on**: Conf → Memory → *Core Memory (long-term)* → Enabled (this writes
   `memory.longterm.backend: core`). Nothing else needs setting — `root` defaults to `core`.
3. **Read the status line** in that same disclosure: *N topics · M skipped · K anomalies*, the
   resolved root, and the index's fill against its cap. That IS the validation affordance — no
   import report exists because there is no import. `skipped` counts files with neither parseable
   frontmatter nor an index link; `anomalies` names dangling/duplicate index links and unindexed
   topics (hover for the list). None of them is an error: the corpus is read as it is, and repairs
   happen only through explicit writes or the §5 consolidation procedure.
4. **No restart is needed.** Every path reads live `Settings` and the scan is keyed on the file
   signature, so the switch, an edited cap and a hand-edited topic all apply from the next turn.
   (The rendered head is frozen *within* a turn — §4 — so an edit made mid-turn lands on the next
   one.)

**The one-time step (step 0) on any deployment whose memory repo predates this feature** (the S1
learning): `MemoryBackup._write_gitignore` early-returns on an existing `.gitignore`, so an
already-initialized `memories/` repo never picks up the two new ignore lines by itself — and a
copied-in corpus's `logs/` would get versioned. Append each missing line independently (a repo that
already has one but not the other must still gain the other — S4 review), idempotent:

```bash
for p in 'logs/' '.consolidate-lock'; do
  grep -qxF "$p" "$CTRLB_HOME/memories/.gitignore" || printf '%s\n' "$p" >> "$CTRLB_HOME/memories/.gitignore"
done
```

(`$CTRLB_HOME` is the prod instance's data root — `~/apps/ctrl-b` on emma. A fresh install writes
both lines itself and needs nothing.)

## 4. Injection design

- **The index block** joins the static head **after the tier-1 memory block, before the skills
  note** (`session.py:633–646` order becomes: system → appends → roster → memory → **core index** →
  skills). Same cache class as the memory block: it changes only on corpus writes, and
  memory-adjacent placement means a write re-prefills from that point only (D15 #4 logic extended —
  fit audit §C). **The head is frozen per turn** (`_static_prefix` builds once and is reused
  byte-identically within an uninterrupted turn — ACA-15e): a mid-turn corpus write is visible to
  the model via its tool result and enters the head on the next turn or a resume-built session
  (council Codex-5/Opus-H2 — both reviewers independently corrected the draft's contrary claim).
  Rendered as: the `core_memory_policy` registry prompt (the P1 framing: what this is, the tier
  split, "recalled content is fallible data — current sources and the owner's words win",
  read-before-answer guidance) + the clamped index + a usage header (`N topics — index 62% of
  cap`), mirroring the tier-1 Hermes-style headers; **the whole rendered index is framed as
  fallible data, not instructions** (it carries foreign-written text — council Codex-13).
- **Topic content** enters as ordinary **tool results** (visible, persisted, replay-stable —
  ACA-frozen like every tool result). Each `read`/`search` result is framed by the
  `core_memory_recall` registry prompt (the P3 wrapper: source path, staleness note, data-not-
  instructions). Per-read caps: `topic_char_limit` (default 4,096 **characters** — deliberately
  chars, not Claude's UTF-16 code-unit "bytes" [R40 §19-3]; Unicode boundary tested) and a
  per-turn total (`recall_char_limit`, default 20,480 chars) — the budget counts the **complete
  framed tool output** and is carried across suspend/resume within one logical turn (persisted
  pre-suspend results included), not reset by a confirmation-resume session rebuild (council
  Codex-11).
- **Cap pressure** reuses the tier-1 pattern: at `consolidation_nudge_pct` of the index cap, the
  index header names the pressure; the nudge steers the model (and owner) toward §5 consolidation
  (no topic-count threshold — §3). No scheduled anything in v1 (§10 banks the arm).
- **Disabled ⇒ byte-identical prompt assembly to today** — the strongest regression assertion, kept
  from the vault spec's acceptance.

### 4b. The promotion design (O4 — tier-1 pressure feeds tier 2; R39-grounded)

The owner's mechanism: ctrl-b differs from Claude Code in having **two** tiers, so tier-1 cap
pressure is not just "make space" — it is an **eviction event with a durable tier available to
catch what matters** (MemGPT's queue-eviction rescue, Anthropic's pre-clearing warning, Cline's
fill-up workflow — R39 §11's reframe). The main model handles where to store and when; no
background pass, no aux LLM call. Four pieces, in order of primacy:

1. **The standing routing rule is the mechanism** (R39 ①): one clause in `core_memory_policy`
   teaches the tier split as a permanent fact — durable/shared material (workflows, conventions,
   stable preferences, corrections) belongs in core memory *whenever learned*; tier 1 is
   working/short-horizon and may be trimmed at any time (Anthropic's "ASSUME INTERRUPTION";
   Letta's "data that doesn't fit into the core memory" framing). Promotion thereby happens
   continuously and cheaply; the pressure paths below are **backstops**. This also closes an R39
   finding: `consolidation_nudge` defaults **off** (`config.py:414`), so a nudge-only design
   would ship unsteered.
2. **The tier-1 nudge becomes tier-aware via one placeholder** (R39 ③): the existing
   `consolidation_nudge` prompt gains `{{longterm}}` — rendered empty when Core Memory is off
   (tier-1 wording byte-identical), one clause when on: *promote durable, generally-useful
   entries to `core_memory` before dropping them; drop task state rather than promoting it* (the
   priority direction — a model told only "make space" cuts whatever is longest, R39 §7-2). The
   clause itself is a ≥80-char model-facing literal, so it is **its own registry id,
   `consolidation_promote`**, resolved and passed in as the `{{longterm}}` value — "no second
   prompt id" was unbuildable against the Phase-18 arch-invariant sweep (council Opus-H1); the
   *nudge* still has no second variant, which is what R39's precedent supports. The `longterm`
   key is always present in the nudge's placeholder ctx (`""` when off — the registry test
   asserts placeholders ⊆ ctx). Rendered **only when `core_memory` is in the session's effective
   tool schema** (an allowlist/skill may have removed it — council Codex-10).
3. **Latch the nudge** (R39 ②, field-unanimous — Letta's once-per-pressure-period latch, Kilo's
   5-min floor, autoDream's 10-min throttle): fire once per pressure episode. **Home and key
   (council Opus-H4 + the one reviewer conflict, ruled):** a `dict[(agent_name, store_key),
   bool]` on the `FileMemoryProvider` lifespan singleton (per-agent stores — a bare store key
   would cross-suppress agents), set in `load_context` when pressure first renders, **cleared
   only when fill falls back below `consolidation_nudge_pct`** — not on write (Codex: a
   non-shrinking write would un-latch mid-episode; a shrinking write clears it via the fill check
   anyway; ruling = fill-drop only, the simpler and correct form). The clear is evaluated for
   **every enabled store, empty ones included** — `load_context` currently `continue`s on an
   empty body before the pct check, which would leave a blanked store latched forever (council
   confirm-round residual). Restart ⇒ at most one fresh warning; documented, harmless. Today the nudge re-renders into the **cached static prefix
   every turn** while pressured — an ignored suggestion becomes a permanent standing order (the
   one unmitigated failure mode found).
4. **`MemoryCapError` names the promotion path** (R39's higher-signal point): the hard-boundary
   rejection (`memory.py:56–60`) steers durable content to `core_memory` when enabled —
   deterministic, fires exactly at the cap, once per attempt, zero prefix cost (MemGPT's "runtime
   errors … fed back to the processor"). **Mechanics (council Codex-12/Opus-M6):** the exception
   stays data-only; the remediation text is resolved **at the tool boundary** (where
   `ctx.stamps` exists, as `memory_proposal_pending` already is) from a new registry id
   `memory_cap_error`; the promotion clause renders only for eligible stores (never `state`) and
   only when the tool is effectively available.
5. **The tier-1 surfaces stop pointing durable facts at tier 1 when core is on** (council
   Codex-10/Opus-M1): the `memory` tool's *tool-level* description and the `reflection_nudge`
   prompt both currently say "save lasting facts/preferences with `memory`" — with core enabled
   they render short-horizon wording + a routing clause instead (conditional at render, exact
   current text when off). Routing/eligibility wording lives in **tool-level `description=`**
   (owner-editable via `tool_overrides`); Pydantic `Field` descriptions stay mechanical (they are
   not owner-editable and are arch-test-exempt as ruled won't-build).

**Deliberate properties** (each a recorded non-fix): promote-then-trim is **not transactional** —
promoted-but-untrimmed leaves fill unchanged, so the always-rendered usage header keeps showing
the pressure and the next episode re-fires the nudge (the latch stays down while fill stays high —
correction rides the *header*, not a re-fired nudge); an atomic cross-store transaction would
couple two subsystems the vault spec keeps independent (R39 §7-4: nobody in the field has one).
**No hard ceiling on tier 2** and tier 1 keeps F1's reject-growth/allow-shrink — Letta *removed*
its hard block cap (`d3f3a38f`) because a hard cap on an always-injected store turns a memory
edit into a prompt-assembly failure. A mid-turn promotion write does **not** touch the current
turn's head (frozen per turn, §4); its tool result is the in-turn record and the index catches up
next turn. The nudge stays advisory so the model can defer writes to the end of its answer.

## 5. The `core_memory` tool + curation

One agent-facing tool (sibling file on the `memory_tool.py` template; `Risk.LOW`, `core=False` so
allowlists can exclude it; declares `timeout_s` — the fail-closed deadline test requires it
(council M2); deny-at-invoke when disabled **plus** hidden from the schema set at the session's
`_tools()` chokepoint — fit audit C2's two-layer gate):

- **Path confinement on every operation** (council Codex-2): a path argument must be a normalized
  relative `.md` path; reject `MEMORY.md`, dotted/`logs` components and any symlink component;
  resolve and verify it stays strictly inside the core root before any IO. Parsed index links get
  the same rule.
- `read(path)` — one topic, capped (§4); the result includes the file's **content hash**, which is
  the expected-state token for `delete`;
- `search(query)` — **literal/case-insensitive substring-and-token grep over topic bodies +
  frontmatter** (~30 lines on `pathlib` + `re`; the R38/Codex/Kilo pattern; explicitly *not* BM25,
  not embeddings — closes the "description-only ceiling" where the index hook doesn't mention the
  fact being sought); returns path + matching-line excerpts, capped;
- `create(name, description, type, content)` — structured fields, service-rendered frontmatter
  (§3); new topic + its index line; duplicate-path rejected;
- `update(path, old_text, new_text)` / `remove(path, old_text)` — **expected-prior-state**: exact
  unique-substring match (the tier-1 F6 rule *and* the vault's compare-and-swap requirement — same
  mechanism, already proven in `memory.py:_merge`); stale/ambiguous ⇒ steering ERROR, never a
  silent overwrite;
- `delete(path, content_hash)` — whole topic + its index line; the token is the hash `read`
  returned (council Codex-3 — a description token both fails CAS, since a body can change under
  an unchanged description, and is unusable on the copied corpus, whose p100 description is 6,337
  chars against a 4,096-char read cap).

**Crash-tolerant two-file mutations — ordering + idempotent retry, explicitly NOT a transaction**
(council Codex-4): create writes topic first, index second — a retry that finds the exact topic
with a missing index line completes it; delete removes the index line first, topic second — a
retry completes either remainder; a metadata-changing update carries the same topic-first/index-
second *ordering* (rewriting its own index line — title from the new name, a custom hook
preserved) but deliberately NOT a repair-on-retry: a crash between its two writes leaves a
diverged hook that the custom-hook rule then preserves until a hand edit (recorded S3 residual —
cosmetic routing text, one line, and the self-healing alternative needs render-history state the
plan refuses). Each step is individually atomic; the D26 commit is best-effort after the writes.
Family 3 fault-injects between every step.

**Autonomy gate:** all four mutations honor the existing `memory.auto_write` switch (council
Codex-6): when off, core mutations are **denied with a steering error** naming the switch
(adapting the tier-1 proposal queue to the corpus is deliberate non-machinery for v1);
reads/search are unaffected. Never a silent write.

Eligibility policy lives in the tool description + P1 (the vault §1 list, unchanged: no secrets, no
derivable facts, no task state, no procedures — skills own those; pointers not copies). **Secret
gate (council Opus-H3 — the draft's "existing predicates" don't exist as shape checks, and D27 #3
deliberately never redacts memory content):** a write whose text **contains a value from
`Settings.secret_values()`** is rejected deterministically — evaluated over the **complete
resulting file content**, never just the delta (R40 §7.4: Claude's edit tool scans only the
replacement string, so a secret assembled across successive edits slips its local check); shape
detection is an explicit non-goal. This is a containment check on known secrets, not a scanner — and it is a **recorded
D27 divergence for D57** (tier 1 trusts curated memory; a shared long-term corpus gets the rail
the vault spec required). Every invocation audits through `ActionService._record` as today.

**Consolidation = an owner-invoked chat procedure, zero new machinery**: the read/search/update/
delete actions above are sufficient for "consolidate my long-term memory" run as a normal
(owner-initiated) agent task; a `consolidation` prompt-registry id gives it stable wording
(porting autoDream's four behaviors — merge-don't-duplicate, absolutize dates, delete
contradicted, bound the index — R37 §11). No scheduler, no background pass in v1; the scheduled
arm is banked (§10).

## 6. Seam map (fit audit, main-seat spot-verified; cite = reuse point)

| Concern | Reuse | Additive change |
|---|---|---|
| Config | `MemoryCfg` (`config.py:398`), path idiom `memories_dir_path()` (`config.py:1319`) | `MemoryCfg.longterm: LongTermCfg` — one nested object: `backend: Literal["core"] \| None = None` + `core: CoreMemoryCfg` (root, caps, nudge pct). **`backend` is the ONLY switch** (null = off; the Conf enable switch writes it — no sibling bool; council M4); the module reads **live Settings per call** → no `reconfigure` branch, no restart; `config.example.yaml` updated (pinned by `test_config_example_qh8`). Extend-don't-migrate: a future backend = one new Literal value + one nested cfg. **No `AgentDef` field** (D14/D15 #3 holds). Pure-additive → no config migration step. |
| Corpus IO | the atomic-replace primitive (hoisted to `core/fsutil.py`, §3), `MemoryBackup.guard()` (in-process lock), D26 commits + reconcile sweep | `services/agent/core_memory.py` — scanner, tolerant frontmatter, index render/clamp/cache, CAS writes. A **sibling subsystem: a lifespan singleton passed to `AgentSession` as a `core_memory=` kwarg** (the session takes `memory=` directly, it has no `Deps` — council M5; construction sites: `api/agent.py:268`, `subagents.py:214`). `MemoryProvider` confirmed not-a-fit (no query param; store-keyed writes; `StoreSpec` models one capped file) and the D27 "ADDING A STORE" checklist must NOT be followed here. |
| Head injection | `_static_prefix()` (`session.py:612`) | one block between memory and skills note (§4). |
| Tool | `@action` registry (`core/tool.py:310`); `memory_tool.py` template; `apply_tool_overrides` untouched | `core_memory_tool.py` + an optional `hidden:` frozenset param on `for_agent()` for disabled-feature suppression — applied **after** the core-tools allowlist bypass and at **both** consumers: the `_tools()` schema set (`session.py:569`) and the M1 availability guard (`session.py:2107`), else schema and guard disagree (council M5). No registry-spec mutation, so no fight with `tool_overrides`; no override may resurrect a hidden tool. |
| Prompts | Phase 18 registry (`prompts.py`), stamping, Conf editor auto-surface | **5 ids**: `core_memory_policy`, `core_memory_recall`, `consolidation`, `consolidation_promote` (the `{{longterm}}` clause, §4b-2), `memory_cap_error` (§4b-4) — names final at S0. Registry tests: `_GOLDEN` + per-id placeholder ctx updated; `consolidation_nudge` ctx always carries `longterm` (`""` when off). Tool-level descriptions = `tool_overrides` territory, NOT registry (arch-invariant test); Field descriptions stay mechanical (not owner-editable — ruled won't-build). Any new ≥80-char model-facing literal must live in `prompts.py`. |
| Headless | origin/depth predicate precedent (`session.py:859`) | none under O1's recommended default; the predicate is the seam if O1 rules stricter. |
| Conf UI | `MemoryEditor.tsx` + `ConfTab` memory group; the Compaction group's `ModelRef` picker pattern (future selector arm) | a Core Memory disclosure: enable switch (writes `backend`), resolved-root + "N topics parsed / M skipped / anomalies" status via a **new read-only status endpoint** — **`GET /api/memory/core/status`** (S4), beside the other `/memory/*` panel routes, serving `CoreMemoryCorpus.status()` (settings GET carries no derived data — council M8) — plus the five §6.1 caps. No per-topic editor in v1 (files are owner-editable on disk/Obsidian; the D26 sweep commits hand edits). |
| Docs | — | D57 · ROADMAP §B1 rewritten to the tier model (the "progressive memory index" deferred bullet at `ROADMAP.md:360` is lifted INTO this plan — it is literally this feature) · TODO Phase 20 stanza · DESIGN §6 + SPEC inventories at ship time. |

### 6.1 The config shape, concretely (normative for S1)

Everything lives **inside the existing `memory:` section** — no new top-level key, no sibling
switch. Off by default; enabling = setting `backend`:

```yaml
memory:
  # ... existing tier-1 fields, untouched ...
  longterm:                    # the tier-2 slot (D57)
    backend: null              # null = OFF (default) | "core"; future backends = new values
    core:
      root: core               # relative → under memories_dir; absolute honored (unversioned)
      index_char_limit: 8192
      topic_char_limit: 4096
      recall_char_limit: 20480
      consolidation_nudge_pct: 80
```

All tunables in config (no constants); pure-additive so no migration step; `config.example.yaml`
carries the commented block; the Conf disclosure edits exactly these fields and nothing else.

## 7. Conflicts found and resolved (from the fit audit; renumbered post-mechanism-change)

Resolved by the mechanism/rulings: selector latency + aux-call gating (no selector), P3 user-vs-
system role (tool results), recall visibility (tool calls), substantive-turn classifier (none
needed), D26 vs non-mutating attach (copy-in ruling). Still standing, with resolutions folded in
above: two-layer tool gating (§5/§6), no-sibling-flat-keys config shape (§6), "selector" naming
collision (avoided — nothing is called selector), store-registry confusion (§6 note), index cap =
the honest corpus bound (§3–§4).

## 8. Acceptance (five families, adapted from the vault spec)

1. **Compatibility/preservation** — ctrl-b-born corpus and a copied Claude-shaped corpus (fixture
   **synthesized** to the live 56-topic shape — never a copy of the owner's real vault: nested
   metadata, long descriptions, a `.consolidate-lock`, a `logs/` tree, a **nested `MEMORY.md`**,
   mixed/conflicting frontmatter, orphan/dangling/duplicate index entries, a CRLF file) work
   through one path; enable+read leaves every file byte-identical; edits preserve unknown
   frontmatter per §3's contract; hand edits get swept into the D26 repo **and appear in the next
   turn's index** (the paths+mtimes cache key is the reload boundary — R40 §19-8); foreign
   artifacts stay un-versioned (`_GITIGNORE`).
2. **Recall quality/bounded cost** — index present + capped (warning line inside the cap); seeded
   fact recalled in a fresh session's first answer via a tool read (plumbing asserted with the
   fake model; semantic quality = the A12/promptfoo harness, PROMPTS_PLAN §2.7, once it exists);
   abstention adds zero reads; per-read and per-turn caps hold **including across
   suspend/resume** and counting the P3 framing; `search` finds a body-only fact the index hook
   misses.
3. **Integrity/security** — CAS rejects stale/ambiguous (incl. a stale-body `delete` under an
   unchanged description — the hash token catches it); **fault injection between every
   topic/index step** of create/delete/update proves the §5 orderings repair on retry; path
   traversal + symlink escape rejected on every operation; cooperating in-process writes lose
   nothing (the guard lock — external-editor concurrency is out of scope, the reconcile sweep
   owns it); writes containing a known secret value rejected; `memory.auto_write` off ⇒ mutations
   denied, reads live; instruction-shaped topic content arrives only inside the P3 data framing,
   and instruction-shaped *frontmatter* is neutralized by the §3 index normalization.
4. **Coexistence/routing** — the 2×2 enabled-matrix; **no code path writes both tiers**
   (`FileMemoryProvider` never touches the corpus; `core_memory` never touches the tier-1 store
   paths — its own `core/MEMORY.md` index is legitimately its to write) — stated as a *code-path*
   invariant, asserted by an AST test in the `test_arch_invariants_*` family, because a single
   **turn** legitimately writes both via two tool calls under §4b promotion (R39 §8's mandatory
   rewording; the per-write phrasing would forbid the feature); tier-1 behavior byte-identical
   when the feature is off (incl. `{{longterm}}` rendering empty); the latch fires once per
   episode, is keyed per (agent, store), clears on fill drop, and one agent's latch never
   suppresses another's.
5. **Disabled/integration** — off ⇒ no prompt text, no tool, no IO, assembly byte-identical;
   invalid root ⇒ one diagnostic, agent unaffected; the full exposure matrix works: disabled ·
   explicit agent allowlist exclusion · skill narrowing · `tool_overrides` — `hidden` filtering
   applies after the core/allowlist union at both consumers, and no override resurrects the tool.

## 9. Explicit non-goals (v1)

Unchanged from the vault spec, plus ours: background extraction · scheduled consolidation (a
future optional A3-automation arm — §10) · SQLite/
embeddings/vector/graph (future tier-2 backends, behind the slot) · scoring/decay · approval queues ·
per-entry IDs · multi-root/overlays · live shared-root attach with a running Claude Code ·
**the LLM selector** · a second git repo or any new backup subsystem · per-topic Conf editing ·
a cumulative per-session recall cap (per-turn only — tool results persist in the transcript and
compaction bounds accumulation; Claude's 60 KiB session cap belongs to the selector cohort, R40
§19-4 — a deliberate non-risk, not an omission).

## 10. Banked future arms

- **Selector arm:** opt-in, on the compaction-summarizer aux seam (`InferenceClient.complete` +
  `ModelRef` + `asyncio.timeout`, fail-open to index-only). Trigger: the R38 §8 local experiment
  showing selector recall beats index+grep on the real corpus, or corpus growth making the index
  clamp lossy. Manifest ordered manifest-first/query-last (cache-friendly — R38's inversion note).
- **Other tier-2 backends:** Hindsight/Honcho/vector as new `backend:` values; the slot interface
  is *derived from what the loop consumes* (head block + tool surface), to be formalized only when
  backend #2 is real (no speculative Protocol — vault anti-bloat gate).
- **Track P hand-off:** the tier-1 mid-session `STATE.md` write → full-history re-prefill measure
  (R38 implication 3, already ruled A9; measurement only).
- **Scheduled consolidation ("dream") arm:** an autoDream-style pass as an **owner-created A3
  automation** using the `consolidation` prompt id — none exists by default (matches autoDream's
  default-off, R37 §11); rides the shipped D49 scheduler, zero new machinery. Stays banked at N=1
  because the pass is expensive at scale (Letta alerts on reflections >10 min/>100 steps — R39
  §2.4). Nuance to design at pickup: tier-1 is per-agent, so a scheduled run consolidates *its
  own* agent's tier-1 + the shared corpus.
- **Disuse signal for tier-2 pruning:** Codex's `max_unused_days`/`usage_count` ranking and
  Anthropic's "delete files not accessed in a long time" (R39 §7-5). ctrl-b's free approximation:
  the D26 git repo already records every topic's last-modified time. Only if the corpus outgrows
  the owner-invoked procedure.

## 11. Slice ladder (Phase 20; pause for owner go-ahead between slices; each passes `tools/check.py`)

- **S0 — Lock. ✅ 2026-08-17.** Owner ruled §2b; R39/R40 bought; council round run + folded (§13);
  D57 locked; ROADMAP §B1 rewritten; TODO stanza added. No code.
- **S1 — Corpus module, read-only. ✅ 2026-08-17** (`6b16545`). `LongTermCfg`/`CoreMemoryCfg`; root
  resolution/validation; scanner + tolerant frontmatter; index render/clamp. Acceptance family 1
  (read half), 26 tests. Review: Codex SHIP WITH FIXES (4 MED, 5 LOW), all folded lean + confirm
  round. Two S1 learnings for the record: **`AgentDef.memory_dir` makes the reserved tier-1 set
  dynamic** — closed on the tier-1 side (`_agent_memory_dir` yields to an active corpus root), not
  by static refusal; and **`_write_gitignore` early-returns on an existing repo**, so prod's memory
  repo won't pick up the new `logs/`/`.consolidate-lock` lines → S4's copy-in doc owes the one-time
  reconcile step.
- **S2 — Head injection. ✅ 2026-08-17** (`bd6b9fd`). The lifespan singleton + `core_memory=`
  kwarg wiring (both construction sites, §6), the static-head block, `core_memory_policy`;
  byte-identical-when-off test. Families 2 (index) + 5. Review: Codex SHIP WITH FIXES (3 LOW,
  folded — no-IO contract stubs · frozen-head/resume regression test · docstring precision).
  As-built notes: the policy default carries the §4b-1 routing clause (written final at S2, so S4
  never edits it); exactly two `AgentSession(` sites exist and both wire the kwarg; the shared
  singleton is re-entrancy-safe (no await inside `render_index`/`scan`, one event loop).
- **S3 — Tool. ✅ 2026-08-17** (`ced9056`). All six actions + CAS + grep + index maintenance +
  secret gate + two-layer exposure gating + `core_memory_recall` framing. Families 2 (reads), 3,
  4. Review: Codex adversarial security pass DO NOT SHIP (2 HIGH — unreadable-index clobber,
  read/hash race — + 8 MED + 2 LOW) → all reconciled + fixed; confirm round's 3 residuals folded.
  As-built notes for later slices: **steer rows now carry `Message.steer`** (the meta one-more-key
  path) so the recall seed finds the true turn boundary; the recall budget threads
  `invoke(recall=)` like stamps; mutations run in a shielded guarded task (deadline-cancel-proof);
  metadata edits refresh their index line (custom hooks preserved; the crash residual is recorded
  in §5); 3 overrules recorded in code (no secret gate on writes that don't happen / removal-only
  index writes; no filesystem-identity path check — lexical closure only).
- **S4 — Curation + Conf. ✅ 2026-08-17** (`30f00b4`). The §4b promotion backstops
  (`consolidation_promote` resolved into `consolidation_nudge`'s `{{longterm}}` · the provider
  latch · `memory_cap_error` at the tool boundary · the conditional tier-1
  tool-description/`reflection_nudge` wording); index cap-pressure nudge; `consolidation` prompt
  id + the §3b owner procedure; Conf disclosure + `GET /memory/core/status`; copy-in migration
  doc. Family 1 (copy-in fixture at the 56-topic scale) + family 4 (latch). Review: Codex SHIP
  WITH FIXES (2 MED, 3 LOW — all folded). As-built notes: availability = the session's
  `_longterm_available()` (rides `_tool_allowed`, so skill narrowing is exact there; the
  `memory`-tool cap-error boundary uses `Deps.longterm_available()`, allowlist-level — the one
  recorded approximation); `ToolSpec.describe` is the generic live-description seam
  (`apply_tool_overrides` re-runs on every save while any spec carries it); the reflection
  routing clause is a sub-80-char precomputed literal (the `state_clause` precedent — NOT a 6th
  id; the arch sweep's 80-char floor is the codified owner-editability boundary);
  `MemoryCfg.core_memory_on()` is THE tier-2 predicate. *(Re-scoped at the council round — this
  slice carried most of the buildability gaps.)*
- **S5 — Close-out. ✅ 2026-08-17.** DESIGN/SPEC/QUALITY updates; measured numbers into §14;
  HANDOFF. The llama.cpp `cache_n`-across-a-write measure needs the live model host and is
  **deferred to the owner's live round** (recorded in §14, not silently dropped).

## 12. Research provenance

R37 (source verification at the vault's exact pin — 10/13 confirmed, claim 13 corrected → §3's
write rule) · R38 (field: the selector is the one uncorroborated piece → §1; grep + index = the
field's mechanism; the 5k-token manifest measurement) ·
[R39](./research/R39-cap-triggered-tier-promotion.md) (cap-triggered tier promotion: the trigger
is field-established — MemGPT 70% warning, Letta 75% latch, Anthropic's context-editing
pre-clearing warning; the main-model in-session actor is the correct small-scale form; the three
lean adjustments + the §8 family-4 rewording → §4b) ·
[R40](./research/R40-claude-code-memory-source-specification.md) (the complete source spec of
Claude Code's five memory systems + the 50-row crosswalk — the plan's mechanism corroborated;
§19's narrow clarifications folded, §13) · the fit audit (seam map §6, conflicts §7,
injection-point cache analysis §4) · the vault project's own LOG (Hermes provider stack map,
benchmark literature — not re-bought; **its `letta-ai/letta` docs citation now points at an
archived repo** — R39 §12). Dossier conventions: `docs/research/README.md`.

## 13. Council record (2026-08-17)

Two independent reviews of this plan post-§4b, distinct lenses, run in parallel; findings folded
**in place** above (tagged `council Codex-N` / `council Opus-XN`), no separate errata list.

- **Codex `gpt-5.6-sol` high (correctness/edge cases): BUILD WITH CHANGES**, 14 findings — all
  accepted, most as specified (its fixes were lean this round). Load-bearing: root/tier-1 overlap
  rejection (§3) · per-operation path confinement (§5) · **content-hash delete replaces the
  description token** (§5 — also fixes the copy-in 6,337-char case) · crash-tolerant two-file
  orderings with idempotent retry (§5) · `memory.auto_write` honored by core mutations (§5,
  resolved as deny-with-steering rather than adapting the proposal queue — lean re-derivation) ·
  frontmatter/index determinism + structured `create` (§3) · LF/preservation contract weakened
  honestly (§3) · index as an instruction channel → normalization + data framing (§3/§4) · recall
  budget defined across suspend/resume (§4) · cap-error rendered at the tool boundary (§4b-4) ·
  8,192-char cap wording, topic-count threshold dropped (§3).
- **Opus 5 high, adversarial implementer lens (buildability): BUILD WITH CHANGES** — S1–S3
  buildable with sentences added, S4 re-specced. Load-bearing: **H1** the `{{longterm}}` clause
  fails the Phase-18 arch sweep as an inline literal → own registry id `consolidation_promote`
  (5 ids total, §6) · **H3** the draft's secret gate cited predicates that don't exist and
  silently diverged from D27 #3 → resolved as the `secret_values()` containment check, divergence
  recorded for D57 (§5) · **H4** the latch's home/key (`FileMemoryProvider` singleton,
  per-(agent, store) — a bare store key cross-suppresses agents, §4b-3) · session wiring is a
  `core_memory=` kwarg, not `Deps` (§6) · `hidden:` applies at both consumers after the
  core-allowlist bypass (§6) · `backend` as the single config switch, live-read (§6) · the status
  endpoint named as new API surface (§6) · test-surface notes (synthesized fixture, `_GOLDEN`,
  `longterm` always in ctx, S5 manual numbers — §8/§11).
- **Both independently corrected the same defect**: §4b's claim that a mid-turn corpus write
  invalidates the head mid-turn — the head is frozen per turn (`_static_prefix`, ACA-15e); the
  plan now states the frozen-head model (§4, §4b).
- **One reviewer conflict, ruled (main seat):** latch re-arm — Opus had it clear on `write()`,
  Codex showed a non-shrinking write would un-latch mid-episode. **Ruling: clear on fill-drop
  only**; a shrinking write clears it through the fill check anyway (§4b-3).
- **Overrules: none.** Every finding either folded as given or lean-re-derived with the reviewer's
  failure scenario preserved (the two re-derivations: auto_write deny-vs-proposals; latch
  fill-drop-only).
- **Confirm round (Opus, same agent):** all resolutions verified, latch ruling endorsed as the
  better form; one residual LOW found in the fold itself (empty-store `continue` skips the latch
  clear — `memory.py:147–150`) — folded into §4b-3.
- **Post-council corroboration —
  [R40](./research/R40-claude-code-memory-source-specification.md)** (commissioned independently
  by the owner from their personal agent, same day): a full source specification of Claude Code's five memory systems
  at R37's pin + a 50-row crosswalk of this plan. Verdict: *"the source pass does not overturn
  the plan's core mechanism — it supports it"*; its §19 clarifications folded where new (O1 as
  product-choice wording · chars-not-code-units on the read cap · the per-session recall cap as
  a §9 deliberate non-risk · the hand-edit reload boundary in §8-1); the rest were already
  council-covered or already the plan's posture.

## 14. As-built appendix (S5, 2026-08-17)

**The whole ladder shipped in ONE session, 2026-08-17** (owner amendment mid-run: continue
autonomously between slices while context/budget allow; every slice still individually
Codex-reviewed + full-gated): S1 `6b16545` · S2 `bd6b9fd` · S3 `ced9056` · S4 `30f00b4` (+ the
per-slice docs commits). Review verdicts: S1 SHIP WITH FIXES (4 MED/5 LOW + 1 confirm residual) ·
S2 SHIP WITH FIXES (3 LOW) · S3 **DO NOT SHIP** (2 HIGH/8 MED/2 LOW + 3 confirm residuals — the
unreadable-index clobber and the read/hash race were real data-integrity bugs caught by review) ·
S4 SHIP WITH FIXES (2 MED/3 LOW). Every finding folded or explicitly overruled in place; overrule
reasoning lives in code comments at the flagged sites.

**Measured (synthetic 56-topic corpus, hooks ~90 chars, emma, 2026-08-17):**
- Rendered index: **5,688 chars (~1.4K tokens)**; with the `core_memory_policy` frame:
  **6,301 chars (~1.6K tokens)** — 69% of the 8,192-char cap at the owner's real corpus scale.
- Scan cache: 100 consecutive renders = **1 parse** (stat sweep only); one `create` = exactly
  **1 re-parse**. The per-turn cost of the head block on an unchanged corpus is a stat sweep.
- **Deferred:** the llama.cpp `cache_n` re-prefill measure across a corpus write (needs the live
  local model + a dev instance; the design expectation from D15 #4/§4 is re-prefill from the
  memory block onward only — verify at the owner's live round).

**Feature state at close:** OFF by default everywhere (`memory.longterm.backend: null`);
byte-identical prompt assembly while off (family 5 holds at every slice's gate). Enabling =
one Conf switch; the §3b copy-in procedure is the migration path. Owner-court next steps: enable
on prod when wanted · the live `cache_n` measure · first real consolidation run (the
`consolidation` prompt id) · push the commit stack.

### 14b. First live drive + the secret-gate fix wave (2026-08-17, dev)

**The §3b procedure was exercised end-to-end on the dev instance** (step 0 gitignore reconcile ·
a 57-topic real Claude corpus copied in · switch flipped · no restart): status read *57 topics ·
0 skipped · 1 anomaly* — a genuinely unindexed file, correctly named. A live turn (gemma4 on the
local host) resolved the right topic from the injected index on the first read; `prompt_stamps`
carried `core_memory_policy`; the recall arrived in the P3 frame with its content hash.

**Two defects found by the first `create`, fixed the same session (post-S5 fix wave):**
1. **The secret gate false-positived on short configured secrets** — the real config carries two
   1-char placeholder API keys and a 4-char SSH password; substring containment on those matches
   ordinary prose, so **every index write refused** (create/edit bricked on any realistic corpus —
   prod would have hit the same wall on day one). Fix: `_SECRET_MIN_CHARS = 8` floor (raw length,
   matching the raw value it contains-checks — measuring the stripped length would open an
   edge-whitespace bypass, Codex MED). The gate is now *documented* best-effort: a real ≤7-char
   credential is knowingly outside the rail — routed to Phase 19 Packet ③'s SECURITY_MODEL §5
   re-walk (HARDENING_PLAN); a per-short-secret config warning was considered and declined (the
   4-char SSH password is real and unchangeable — it would be a permanent nag).
2. **A refused `create` half-wrote** — the old order wrote the topic file, then gated the merged
   index, so an index-side refusal left an orphan topic behind a "create refused". Fix: both gates
   hoisted above both writes (pure content checks; the topic-first WRITE ordering and both S3
   OVERRULEs unchanged). A pre-existing index leak now refuses with `MEMORY.md` named as the
   carrier instead of blaming the proposed content.

Review: Codex high **SHIP WITH FIXES** (2 MED/2 LOW, no HIGH; the hoist judged sound) → wave-2 →
confirm round **all four CONFIRMED, nothing new**. +2 tests (boundary pin 7-raw-passes/8-refuses/
8-with-edge-whitespace-refuses · zero-write + byte-identical index + carrier message). The re-run
of the same live `create` on dev: `[ok] created dev-live-test.md and listed it in the index`.

**Live observation for the owner round:** this realistic 57-topic corpus renders at **8,121/8,192
chars — 99% of the default `index_char_limit`** (the §14 69% figure was measured with ~90-char
hooks; real hooks run longer). At that fill the §4b consolidation nudge (80%) is permanently on —
expect it immediately on prod, or raise the cap / consolidate early. Still deferred: the
`cache_n` re-prefill measure (needs a measured turn pair on the local host).

