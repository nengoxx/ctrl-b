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
  (`index_char_limit`, default **10,240 chars** — the owner's ~10K sizing, D61 ④; was 8,192,
  Kilo's bound, until 2026-08-19; the truncation warning line is
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
- `delete(path, content_hash, superseded_by | reason)` — whole topic + its index line; the token is
  the hash `read` returned (council Codex-3 — a description token both fails CAS, since a body can
  change under an unchanged description, and is unusable on the copied corpus, whose p100
  description is 6,337 chars against a 4,096-char read cap). **D60 ③ adds the INTENT gate + the soft
  delete**: exactly one of `superseded_by` (a topic that must already exist on disk — create-before-
  delete, self-reference refused) or a sanitized one-line `reason`; the topic is then RENAMED into
  `<root>/.archive/<its relative path>` rather than unlinked (the scan skips dotted components, so
  nothing else changes), and the index replace rolls that rename back if it fails.

**Crash-tolerant two-file mutations — ordering + idempotent retry, explicitly NOT a transaction**
(council Codex-4): create writes topic first, index second — a retry that finds the exact topic
with a missing index line completes it; delete (since D60 ③) archives the topic first and replaces
the index second, ROLLING THE ARCHIVE BACK if the index write fails, and a crash between the two
leaves a dangling index line the reader already ignores and a retry cleans up; a metadata-changing
update carries the same topic-first/index-
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

**The procedure, as amended by D60 ④ — dry-run → owner eyeball → live run:**
1. **Dry run.** Turn `memory.auto_write` OFF (Conf → Memory), open a fresh thread and send the
   `Consolidation Dryrun` prompt. Every write-class action is refused by the existing autonomy gate,
   so the pass is read-only *structurally* — not by asking the model to behave — and it reports the
   plan instead.
2. **Eyeball.** Read the plan: the family, the sources by path, what the merged topic would say,
   which deletes name which `superseded_by`, and what the model says it could not see.
3. **Live run.** Turn `memory.auto_write` back on and send the `Consolidation` prompt in a fresh
   thread. It does ONE family and stops; run it again for the next one.

**Recovering an archived topic** (§15b-12; a `restore` action is a recorded non-build): move
`<root>/.archive/<path>` back to `<root>/<path>` and re-add its index line in `MEMORY.md` — the two
halves of the §3 write path, by hand. **Check the live destination first**: if a topic has since
been recreated at that path, the restore would overwrite live work — resolve that by hand (keep one,
rename the other) before moving. The corpus enforces the same rule from its side: a second delete of
that path is refused while an earlier archived copy sits there, and `create` refuses to overwrite a
differing topic. `.archive/` is never pruned automatically — it is the owner's to clear.

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
      index_char_limit: 10240  # D61 ④ (was 8192)
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
- **Measured (the llama.cpp `cache_n` re-prefill across a corpus write — emma → the local
  gemma-4-12B host, llama.cpp b10069, 2026-08-19; replay method: the real app lifespan against a
  byte-copy of the dev `CTRLB_HOME`, `_static_prefix()`/`_tools()` dumped and replayed verbatim
  with `cache_prompt:true`, token geometry from the server's own `/apply-template`+`/tokenize`):**
  the **assembly** does what §4 designed — a corpus write's first differing byte is always inside
  the core-index block; everything ahead (system prompt + the 34 tool declarations the gemma
  template folds into the first system turn + roster, and the tier-1 block when present) is
  byte-stable, and a `create`→`delete` round-trip restores the head **byte-identically**.
  **The cache payoff does not survive the local server.** Real prompts (57-topic index at 99% cap;
  head + one turn = 9,177 tok, 6,289 preceding the index block, 2,888 from the block onward): an
  unchanged corpus reuses 99.6% (`prompt_n` 40 / `cache_n` 9,173; a repeat 1/9,212). An index
  change at the block's **head** (`update`/`delete` of an early entry) yields **`cache_n` = 0 — a
  full re-prefill** (9,194 tok ≈ 11 s; 4/4 samples, and again at 12,639 tok with history). A
  change at the block's **tail** (a `create`, which appends) reuses only while it sits inside the
  last ~2,048 tokens: 7,129/9,213 cached on a fresh thread, 7,164/12,640 once ~3.4K tokens of
  history follow. A synthetic depth sweep pins the cause server-side: a one-token edit
  200/1,000/1,800/2,000 tokens from the end reuses **exactly**, while 2,100/2,200/3,000/5,000
  collapse to `cache_n` 0 — the model's 2,048-token sliding-attention window. Gemma is an SWA
  model and this llama-server runs without `--swa-full`, so SWA layers keep only the last window
  and a deeper rewind is served only from a context checkpoint, else the whole cache drops.
  **Verdict: D15 #4's expectation holds in ctrl-b's assembly and fails in the local backend; the
  remedy is host-side (`--swa-full` / more context checkpoints on the llama.cpp box), not
  repo-side, and cloud prefix caching is unaffected.** Routed to Phase 19 (D58) as a known-open
  perf item. Incidental findings, both real: ① `_core_index_block` prepends the
  `core_memory_policy` frame inside the block, so head-case divergence lands ~172 tok into the
  block (immaterial to the verdict); ② at 99% of `index_char_limit` a `create` is **not listed at
  all** — only the `N more topics not listed` counter moves, so a new topic is invisible to the
  model until consolidation runs.

**Feature state at close:** OFF by default everywhere (`memory.longterm.backend: null`);
byte-identical prompt assembly while off (family 5 holds at every slice's gate). Enabling =
one Conf switch; the §3b copy-in procedure is the migration path. Owner-court next steps: enable
on prod when wanted · ~~the live `cache_n` measure~~ (✅ 2026-08-19, the Measured bullet above) ·
first real consolidation run (the `consolidation` prompt id) · ~~push the commit stack~~ (✅).

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
expect it immediately on prod, or raise the cap / consolidate early. ~~Still deferred: the
`cache_n` re-prefill measure~~ (✅ run 2026-08-19 — §14's Measured bullet holds the record; it
also confirmed this fill gotcha live: at 99% the probe's `create` never appeared in the rendered
index, only the `N more topics not listed` counter moved).


### 14c. The first consolidation run (2026-08-19, dev) — FAILED, informatively; the redesign brief

**The exercise.** Owner-approved first real run of the §5 consolidation procedure: a fresh dev
thread, the registry-default `consolidation` prompt verbatim (`is_customized: false`), the default
agent on the local gemma-4-12B host, `memory.auto_write: true`, the 58-topic corpus at 99% index
fill. One prompt + the two allowed "continue" nudges. Full SSE captures, tool traces and
before/after snapshots are banked in the session scratchpad (`consolidation/`); the thread
(`608814b0…`) remains on dev for inspection.

**Result: zero writes, zero commits — the corpus is byte-identical** (58 topics, MEMORY.md
15,334 chars, index 8,121/8,192 before and after; worktree clean, nothing to roll back).

**The rails all held — one of them prevented real data loss.** Turn 1 read 4 topics cleanly, hit
the per-turn recall budget on the 5th, and stopped to narrate. Turn 2 read 2 more, then twice
issued a malformed `update`: **a whole-file rewrite reconstructed from a TRUNCATED 4,096-char read
of a 5,146-char topic** — its tail ran off mid-sentence and leaked the next JSON key as prose.
Had the tool accepted it, ~1,050 chars of `d2a-monitor-progress.md` (including its live closing
hook) would have been silently destroyed. The mandatory-`path` + CAS-`old_text` design refused
both calls — **keep both requirements; they are load-bearing against exactly this failure.**
Turn 2 then degenerated into a 7,241-char answer ending in ~60 literal repetitions of
`(Actually, I'll do 3).`; turn 3 compacted away the entire read working set and emitted an empty
message. All three turns reported `state: completed`. No secret-gate events (no write ever
reached it); `prompt_stamps` carried the right ids throughout.

**§5 scorecard:** merge overlaps — identified the right family (the three `*-progress` topics),
never attempted a write · absolutize dates — not attempted · delete superseded — not attempted ·
index bounded — unchanged at 99%. Nothing hallucinated or lost, because nothing was written.

**The finding that reshapes the redesign: the prompt is not the only problem — the task as worded
is structurally impossible under the shipped per-turn budgets.** The eleven observations, grouped:

*Runtime limits (wording cannot fix these):*
1. `recall_char_limit` 20,480 ÷ `topic_char_limit` 4,096 ⇒ **4–5 reads/turn** against 58 topics —
   ≥14 turns of reading before any write; the prompt says "work through the index topic by topic".
2. `max_calls_per_tool = 6` caps a turn at ~2 read+write merge pairs (never reached — the model
   gave up first).
3. **17 of 58 topics exceed the 4,096-char read cap and there is no paging** — the largest
   (53,277 chars) is visible 7.7% at a time, forever; and the model's instinct on a truncated
   read is a whole-file rewrite from the fragment (the near-miss above).
4. **At 99% fill the index hides 5 topics** (4 truncated + 1 unindexed); the header said
   "53 topics" and the model believed it — a pass driven off the index can never reach exactly
   the topics cap pressure most needs it to reach.
5. Compaction evicts the read working set right when a multi-turn pass would start writing —
   the nudge chain is self-defeating.

*Prompt/steering gaps:*
6. `DEFAULT_SYSTEM_PROMPT`'s "carry the task through this turn; do NOT stop to narrate" directly
   contradicts a necessarily multi-turn task — the model quoted it back, then spiralled when the
   budget forced the narration it was told not to do. Consolidation needs an explicit
   bounded-batch carve-out ("one topic family per run, finish it, report").
7. The prompt never names the merge mechanics; the model reached for whole-file `update` (which
   CAS cannot express). It should state: read both → `create` the merged topic → `delete` the
   originals; `update`/`remove` take an exact quoted passage + `path`, never a full-file body.
8. The prompt never invokes `task_plan`, and the model never planned.
9. The arg-gate error ("`path` is required") named the missing field but not the shape error, so
   the model reissued the identical call; the steering text should restate the correct call shape.

*Automation safety:*
10. Degenerate outcomes (the repetition spiral; the empty turn) terminate as `completed` — an
    unattended scheduled run would log clean successes having done nothing. Automation needs an
    outcome signal derived from actual writes, not turn state.
11. Long tool-call payload generation streams nothing (50s+ SSE gaps) — a watching owner sees a
    frozen turn.

**Disposition (owner direction 2026-08-19: the consolidation mechanism — especially the prompt —
gets a real design pass before it is ever automated).** The redesign brief is therefore two-sided:
the `consolidation` prompt rewrite (batch discipline, named mechanics, delta report) AND a small
set of runtime seams (a paged/offset read, a task-scoped recall budget, a writes-derived outcome
signal). Field patterns to consult: R39/R40 + Letta's sleep-time-agent pattern (dossiers already
bought). Un-owned until the owner's design session rules; nothing here changes shipped behavior.

### 14d. The second consolidation run (2026-08-19 afternoon, dev, qwen3.6-max) — failed DIFFERENTLY, and it answers §14c's open question

**Setup.** Identical procedure to §14c (same registry prompt verbatim, two nudges), but the
executor changed: dev's primary is now `qwen3.6-max` on corsair (248k ctx; the wire-level
system-message normalization `5678c08`/`8575ae2` in place). Wire gate passed first: corsair
provably served (persisted `usage.model`), zero failover lines, zero 400s — the comparison is
valid. Two `spawn_subagents` confirms were operator-approved (logged); everything else untouched.

**Result: one write landed, and it was DESTRUCTIVE — a correctly-formed `delete` of a LIVE topic
(`core-memory-tier2-progress.md`) whose merged replacement was never created** (the `create` had
been cap-denied one turn earlier; the model deleted anyway on the next nudge). Reverted by the
main seat post-run (`git revert` — the corpus is git-backed, nothing permanently lost; the run
commit stays in history). Index fill UNCHANGED at 99% — the freed line was backfilled by a
previously-hidden topic. Also: the drafted merged topic contained **hallucinated status claims**
("Phase 19 … Live", "Phase 20 … Live", an invented date) that would have replaced accurate hooks
had the cap not blocked it.

**§14c's open question — was run 1 partly model capability? ANSWERED: yes, and fixing it made
things WORSE, not better.** Qwen showed every discipline gemma lacked (trace-backed): correct
create+delete merge mechanics unprompted (no whole-file rewrites), real error recovery (fixed its
path format, re-read for a mis-typed hash, re-batched a denied fan-out), novel workarounds
(subagent fan-out; a cross-turn tracker in agent memory), no degeneracy (no spiral, no empty
turns, no compaction), graceful budget stops, honest self-reports. And precisely BECAUSE it got
further, it reached the destructive step. **A stronger model converts "fails safely" into
"fails dangerously" — the protection must be structural.**

**The decisive NEW mechanical finding (model-independent): unconditional Tier-1 output clearing
makes any read→read→merge pass impossible at ANY context size.** `plan_clearing` (D42,
compaction.py) replaces tool outputs >~500 tokens older than `clear_keep_steps = 2` rounds with
`[output cleared]` on EVERY loop iteration — context pressure irrelevant. Every 4,096-char recall
qualifies, so the recalls a merge depends on are erased two tool-steps after they arrive (the one
surviving read was the one topic under the size floor — exactly what the model reported).
`core_memory` is NOT in `_NEVER_CLEAR_TOOLS` (only `task_plan` + `memory` are — which is why the
model's agent-memory tracker persisted). §14c mis-attributed this class to compaction.

**Structural limits confirmed identical across both models:** 4–5 reads/turn (recall budget) ·
**`max_calls_per_tool = 6` funds reads AND writes from one counter — the turn that reads cannot
write** (this is what cap-denied the `create`) · 4,096-char reads with no paging (17/58 topics
never fully visible) · the 99%-fill index hides 5 topics and the model believes its count · the
subagent escape hatch inherits every per-agent limit + a 180s child timeout (0/3 completed) ·
budgets reset only on owner round-trips. New qwen-specific hazard: PARALLEL tool batching burns
the whole per-tool cap on one malformed batch before any feedback arrives.

**Normalization under load: clean.** ~4,800 SSE events, 5 legs, nested subagent sessions, 6
suspend/resume boundaries — zero 400s, zero failover, zero `<system-update>` leakage into any
transcript, stamps correct throughout.

**The redesign brief (supersedes §14c's list where sharper) — three runtime items are now
MANDATORY, no prompt can substitute:**
1. **Exempt `core_memory` reads from Tier-1 clearing** (add to `_NEVER_CLEAR_TOOLS`, or a
   task-scoped exemption) — without this the pass is impossible by construction.
2. **Split the read budget from the write budget** (or a task-scoped `max_calls_per_tool`) — a
   merge must be able to read its sources and write its result in one turn.
3. **Make destructive ordering tool-enforced, not model-disciplined:** a `delete` whose stated
   reason is a merge must require the replacement to EXIST (create-before-delete), or deletes
   become tombstones reversible without git surgery. CAS validates form; run 2 proves form is
   not enough.
Plus the §14c prompt items (bounded batches · named mechanics · delta report) and a fourth
runtime candidate: paged reads. Raw captures: `~/.ctrl-b-dev/consolidation-run2-2026-08-19/`
(TRACE/OPERATOR_LOG/SSE per leg); the run thread is inspectable on dev.

### 14e. Run 3, the D60 dry-run (2026-08-19, dev, qwen3.6-max) — the first run that PRODUCED A PLAN

**The exercise.** The §5 D60 procedure, step 1: `memory.auto_write` OFF (config edit, units
restarted), fresh dev thread, the registry-default `consolidation_dryrun` prompt verbatim
(`is_customized: false`), qwen3.6-max on corsair (the owner's primary). One prompt, NO nudges.
Captures in the session scratchpad (`consolidation-run3/`); thread `93f6210b…` on dev.

**Result: SUCCESS — a complete, reviewable consolidation plan in ONE turn (289s), zero writes
(corpus byte-identical, sha-verified), state `completed`.** 13 `core_memory` calls: 4 full reads +
1 search succeeded; the other 8 were refused by the per-turn recall budget (20,480 ÷ 4,096-cap
reads ≈ 5) — and the model **recovered gracefully every time**: narrated the refusal, adapted,
and closed with the plan instead of run 1's repetition spiral. No write was ever attempted (the
prompt's "writes are off" framing worked — the autonomy gate never had to fire). D60 ② visibly
held: 13 calls in one turn, zero per-tool cap denials on reads. **D60 ①'s pressure gate was NOT
exercised by this run** (2026-08-19 audit): at run time the dev chain's openrouter fallback had no
`context_window`, so `min_chain_window` was `None` and clearing stayed on the pre-D60 always-on
fallback — the zero clearing observed is fully explained by the current-turn immunity in a
one-turn run. Fixed post-audit: dev's `google/gemma-4-31b-it:free` now carries
`context_window: 262144` (the OpenRouter-published value), arming the gate; **the prod config
flip must carry the same key** or the gate stays dormant there too.

**The plan itself** (banked at `consolidation-run3/turn1-text.md`): family = themes/theme-engine
(9 topics); MERGE 1 = the 2026-07-10 hardening/deploy cluster (4 → 1, each delete naming its
`superseded_by`); MERGE 2 = the theme-timeline cluster (4 → 1); KEEP `theme-engine-swappable-
surfaces` as the living design contract; a 40-row don't-touch table with per-topic reasons; an
honest "what I could not see" list naming every truncated/unread source. Exactly the §5 eyeball
shape D60 ④ asked for.

**The supervisor read (main seat), for the owner eyeball:**
- **MERGE 1 is live-runnable as-is except one source**: `predeploy-hardening-progress.md` is
  7,990 chars against the 4,096 `topic_char_limit` — a merge written from a truncated read loses
  its tail. Remedy: raise `topic_char_limit` to 8,192 for the run (config, no code); the four
  sources then total 17,183 chars, inside the 20,480 recall budget, and 1 create + 4 deletes fit
  the write-class cap. Textbook acceptance-① shape.
- **MERGE 2 is NOT soundly live-runnable**: `gacha-theme-progress.md` is 54,405 chars — no sane
  cap makes it fully readable (§14c #3, the no-paging residual). The soft delete would keep the
  original in `.archive/`, but the merged topic would be written from a ~7.7% view. Hold it
  pending the banked paged-read arm or an explicit owner ruling.
- Plan-quality nits (don't invalidate the pass): it slotted `qh-audit-next-session.md` into
  MERGE 1 without having read it (the live prompt's read-before-delete mechanics + the CAS hash
  would force the read anyway), and it misglossed `a11-provider-registry-design` as
  "accessibility" (untouched, harmless).

**NEXT: owner eyeball of the plan → the live run (§5 step 3) scoped to MERGE 1 only**, with
`topic_char_limit: 8192` and `memory.auto_write` back ON for that run. Dev units left running,
`auto_write` still OFF, for the owner's inspection.

### 14f. Run 3 LIVE (2026-08-19, dev, qwen3.6-max) — the first consolidation that WORKED

**The exercise.** §5 step 3, owner-approved: `auto_write` ON, `topic_char_limit` raised to 8192
(config; the caps are live-read), fresh thread, the registry `consolidation` prompt + a two-line
scope pin to the §14e-eyeballed MERGE 1 family (the theme-timeline family explicitly held).
Corpus snapshotted first; SSE + before-tree banked in the session scratchpad
(`consolidation-run3/live-*`); thread `b136495f…`.

**Result: SUCCESS — the §15 acceptance-① shape exactly, live.** ONE turn (283s), 9 calls:
4 full reads → 1 `create` → 4 `delete`s, every one OK; zero cap denials, zero clearing, zero
budget refusals (17,183 chars of reads inside the 20,480 budget at the 8192 cap). On disk:
`predeploy-hardening-consolidated.md` created (12,288 chars from ~17,183 of sources), all four
sources archived to `.archive/` (restorable), the index lost exactly the 4 lines and gained
exactly 1 (every other line byte-untouched), and the memory repo carries 5 clean commits — the
create + four `superseded_by` deletes. The delta report matched the disk truth.

**The supervisor grade (main seat, content-diffed against the archived sources):**
- **Fidelity: high.** Every load-bearing fact spot-checked survived — the two-rule secret
  design, QH-1..16, the 9+2 hardening items, the durable gotchas (store↛registry cycle,
  self-contained crash screens, waiver tracker), the invariants, commit SHAs, and the v1.1.0
  release fact (verified against the source — not an error).
- **Blemishes (2, hand-fixed post-run, curation-committed):** the model duplicated a
  pseudo-frontmatter block at the top of the BODY (the service renders the real one from the
  structured fields — the prompt could say "don't write frontmatter; the fields are the
  frontmatter"), and it invented one see-also filename (`theme-engine-hardening-v1.md`, never
  existed). Delta-report nit: it claimed ≈8.5 KB for a 12.3 KB merge.
- **A finding, not a flaw: consolidation does NOT relieve index pressure at cap.** Rendered
  index 8,121 → 8,181 chars (99% → 100%): freeing 4 lines let previously-HIDDEN topics flow
  back into the rendered block (§14c #4's truncation working in reverse). Topics 58 → 55, but
  CM-2 (the permanently-hot nudge at real scale) stands until the cap is resized.

**Disposition:** the D60 mechanism is judged WORKING end to end (dry-run → eyeball → live).
Remaining families are ordinary owner-paced curation; MERGE 2 stays held on the §14c #3
paged-read residual. Dev keeps `topic_char_limit: 8192` (17 topics exceed 4096; the higher cap
is simply truer reads) and `auto_write: true` (the pre-run posture). **CM-2 CLOSED for this
corpus (owner sizing ruling, 2026-08-19): `index_char_limit: 10240`** — the owner's ~10K-chars
number (Claude Code's own default is 200 lines / 25,000 chars, soft-clipped exactly like ours —
R37 §1/R40 §4.2); at 10,240 this corpus renders UNCLIPPED at 8,127 chars = 79%, under the 80%
nudge, all topics routable. The consolidation + the resize together are what cleared it.
Consolidation stays OWNER-INVOKED, not automated — Claude Code ships autoDream default-OFF, the
Hermes vault spec keeps consolidation out of v1, and §14c #10 (degenerate runs terminate
`completed`) still gates any unattended arm on the banked writes-derived outcome signal.
Proportional-to-context sizing (the "10% of ctx for memory+skills" idea) is recorded as a D58
DP-B design question — field precedent is proportional CONTEXT budgets (MemGPT 70%/Letta
75%/goose 0.8/our D60 gate), never proportional durable-index sizing, and a chain-anchored
percentage either starves (smallest member) or bloats (primary). Prompt-tuning candidates
banked from the blemishes: the no-frontmatter line + "reference only topics you verified exist"
— **✅ APPLIED 2026-08-20** (`32ec0e0`: both folded into step 2 of the `consolidation` default,
golden mirrored).

## 15. The consolidation-hardening slice (D60) — spec of record (owner-confirmed 2026-08-19)

> **✅ BUILT 2026-08-19** (Opus, from this section + §15b as the pinned brief; three commits, all
> four parts + the Conf exposure + the §15/§15b test list). Not yet reviewed (the Codex diff round)
> and not yet exercised — **run 3 on dev is owner-court, dry-run first, per the procedure in §5**.

Evidence base: §14c + §14d (both live runs) · R43 (retention/budgets field) · R44 (destructive-op
guards field). Owner rulings R1–R4 as amended by the research, confirmed in conversation
2026-08-19. Four parts, one slice; every tunable is config with a safe default and Conf exposure.

**① The D42 Tier-1 clearing revision (the chat-defaults tuning; R43 recs 1–4).**
Current: `plan_clearing` (compaction.py:191) runs unconditionally every loop iteration; keep
window = `clear_keep_steps` (2) loop rounds; exclusions = the hardcoded `_NEVER_CLEAR_TOOLS`
frozenset (compaction.py:97). Changes:
- **Pressure gate** — clearing runs only when the estimated prompt exceeds
  `clear_trigger_pct` × the serving model's `context_window` (registry `ModelCfg.context_window`;
  when unset, fall back to today's always-on behavior so an unconfigured model keeps its
  protection). Default **0.5**. (Field: 5/5 clearers pressure-gate; goose 0.8×ctx, OpenClaw 0.3 —
  0.5 splits the observed range; gemma-16k gates at ~8k so small-model safety is preserved.)
- **The keep window's unit becomes THE CURRENT TURN** — outputs produced within the running turn
  are never cleared (goose's "since kickoff" shape; closes §14d's read→merge impossibility);
  `clear_keep_steps` keeps its name/meaning for PRIOR-turn rounds.
- **`clear_exclude_tools`** — the frozenset becomes a config list, default
  `[task_plan, memory, core_memory]` (R1 survives as the default value; Anthropic
  `exclude_tools` / OpenClaw allow-deny precedent).
- **`clear_min_reclaim_tokens`** — skip the trim when `ClearingPlan.gain` (already priced) is
  below it. Default **1024** (Hermes ships 4096; Anthropic `clear_at_least` — we start lower
  because our outputs are already 6k-capped).
Config home: the same cfg model as `clear_output_min_tokens`/`clear_keep_steps`
(domain/agent.py) → surfaced in the existing Conf agent-turns group beside them.

**② The call-budget split (R2; R43 rec 5 + R44 Kilo precedent).**
`core_memory` **read-class actions (read/search — the tool has no `status` action; corpus fill
lives on the HTTP status route) stop counting** against
`max_calls_per_tool` — they are already bounded by `recall_char_limit` (the honest read budget);
write-class actions keep the cap. Classification lives in the tool (one set of action names
beside the dispatcher), not in the loop. Plus: `tool_overrides.<tool>.max_calls` — an ADDITIVE
optional per-tool override of the blanket cap (the Phase 8 unified-object shape; default absent =
today's 6; blanket default unchanged). The loop-guard/`max_repeat_calls` dedup is untouched.

**③ The delete guard (R3 as ruled + the R44 soft-delete amendment).**
`core_memory delete` requires exactly one of: `superseded_by: <topic>` — resolved on disk
(`.archive/` excluded), **refused if absent** with steering text "create <topic> first, then
retry", **self-reference refused** (Hermes #29912's exact guard) — or `reason: <text>` (free
text; becomes part of the D26 commit subject, letta-code's shape). And **every delete is SOFT**:
an atomic rename to `<root>/.archive/<relative path>` (mirrored, not flattened; `root` already
defaults to `core`) (+ its index-line removal, both gates ahead of
both writes per the §14b ordering). The scan already ignores dotted path components — zero
scan/render changes; recovery = a file move. `.archive/` pruning is manual/owner (recorded
non-build). Known residual (R44, recorded): the target could itself be deleted later in the same
run — the delta report + dry-run are the mitigations; an end-of-pass re-verify is banked, not built.

**④ The prompt rewrite + the dry-run procedure (R4).**
The `consolidation` registry prompt is REWRITTEN (owner-editable as ever): ONE overlapping topic
family per run, finish it, stop · the named mechanics (read every source fully → `create` the
merged topic → `delete` each source WITH `superseded_by`) · tool-call batches of at most 3 ·
the index may be truncated at high fill — verify coverage via `search`, don't trust the
count · absolutize dates · translate model-specific framing for whatever model drives ctrl-b ·
close with a delta report (merged/rewrote/deleted, with paths). A sibling registry id
**`consolidation_dryrun`** = the same pass with ALL writes forbidden, reporting the full plan
instead (Hermes's dry-run banner, the only-peer-shipping-one precedent). Documented procedure
(§5 gains it): dry-run → owner eyeballs the plan → live run.

**Deliberate non-builds (recorded):** the forked-actor curation regime (5/5 peers; → the D58
hardening design pass, DP-B) · verified delta-report reconciliation + writes-derived outcome
signal (→ the future automation slice) · paged reads (config `topic_char_limit` covers the need
today) · `.archive/` auto-pruning · end-of-pass supersedes re-verify.

**Acceptance:** ① a consolidation-shaped fresh thread performs read→read→create→delete in ONE
turn with zero clearing and zero cap denials on reads; ② run 2's exact failure (delete whose
`superseded_by` does not exist) is REFUSED; ③ a delete lands in `.archive/` and is restored by a
file move; ④ chat behavior at small-model pressure is preserved (gemma-16k still clears above the
gate; the family-5 byte-identity gate holds while tier 2 is off); ⑤ the dry-run prompt produces a
plan and zero corpus writes. Build = Opus from this section as the pinned brief; council = Emma
(Codex-backed) design round before build + diff round after; then supervised RUN 3 on dev
(dry-run first).

### 15b. The D60 council round (Emma/gpt-5.6-sol, 2026-08-19) — BUILD WITH CHANGES, all 14 folded

Verdict BUILD WITH CHANGES; every finding accepted, two with leaner fixes (main-seat rulings).
The spec in §15 is amended by the following, which the builder treats as part of the pinned brief:

1. **Failover gating (HIGH):** the pressure gate uses the SMALLEST `context_window` among the
   turn's eligible chain entries; if ANY eligible model has it unset → today's always-on clearing.
   One assembly, no per-hop re-plan.
2. **Dry-run is structural (HIGH), via existing machinery:** the documented dry-run procedure runs
   with `memory.auto_write` OFF so every write-class action suspends into the existing confirm
   flow (owner inspects/denies) — no new capability flag. BUILD-TIME VERIFY: auto_write actually
   gates core_memory write actions; if not, extending it to them is in-scope. The acceptance test
   attempts a write and asserts the suspension/refusal, never a cooperative model.
3. **Reads get a structural bound (HIGH):** every read-class call charges a MINIMUM unit
   (`recall_min_charge_chars`, default 256) against the cumulative per-turn `recall_char_limit`
   (confirmed cumulative + carried across resume — the resume half landed in the 2026-08-19
   audit fix wave: `_seed_recall` re-charges the floor for no-output read-class calls), so
   zero-char refused-read/empty-search loops terminate (~80 calls/turn worst case).
   `max_repeat_calls` stays as an independent guard.
4. **Archive atomicity (HIGH):** under the existing corpus lock: validate everything → rename to
   `.archive/` → atomic-replace the index; on index failure, rename back. Reuses `_atomic_write`
   + `MemoryBackup.guard()`. Fault-injection tests after each write step.
5. **Archive no-clobber (HIGH):** refuse a delete whose exact archive destination exists
   (steering: restore/rename it first). No versioned naming.
6. **Current-turn identity (HIGH):** "the current turn" = the durable server-owned turn id
   (D39), NOT loop-iteration offsets — pre-suspend outputs of a confirmation-resumed turn stay
   immune (the recall budget already carries across the same boundary; same identity).
7. **All lossy tiers honor the current-turn immunity (MED):** Tier-2/3 folds must not summarize
   away current-turn tool outputs; verify the fold boundary already excludes them + pin by test.
8. **`superseded_by` resolution (MED):** the canonical topic resolver shared with read/create;
   normalize `.md` once; canonical-path self-reference refusal; must be a regular file in the
   live root (`.archive/` excluded); validation + mutation under the same lock (no TOCTOU).
   Index discoverability NOT required (a fresh `create` always indexes; parseable-but-unindexed
   stays legal per §3).
9. **`max_calls` override = REPLACE semantics (MED):** absent → the blanket cap; present → that
   tool's cap. Named `max_calls`; documented in the Conf hint.
10. **Config boundaries (MED):** `clear_trigger_pct` finite 0<x≤1 · `clear_min_reclaim_tokens`
    ≥0 · `clear_keep_steps` ≥1 (unchanged) · `max_calls` ≥1 · **`recall_min_charge_chars` int ≥1
    (confirm-round close: 0/negative would disable the read-loop bound)** · `clear_exclude_tools`
    deduped nonblank strings (unknown names allowed) · same pydantic model validates boot and
    Conf PUT.
11. **The authoritative estimate (MED):** the gate consumes the SAME assembled-prompt estimate
    compaction already prices (post-injection), never a partial figure.
12. **Restore (MED):** documented as move-back + re-add the index line (the §3 write path),
    **NO-CLOBBER: the move refuses if a live topic now exists at the destination (confirm-round
    close — a recreated topic must never be overwritten by a restore)**; acceptance asserts
    post-restore index discoverability AND the live-destination collision refusal. A `restore`
    action = recorded non-build.
13. **`reason` sanitation (LOW):** nonblank, collapsed to one line, control chars rejected,
    subject-length capped, passed as an argument (never shell).
14. **Keep-window aging (LOW), mechanical:** current turn always retained; otherwise an output is
    retained while its existing loop-round age ≤ `clear_keep_steps` (reuse the current age calc).

The reviewer's missing-acceptance list (19 cases incl. failover-window straddles, suspend/resume
turn identity, dry-run attempted-write, archive collision, fault injection, config extremes,
old-config back-compat) is adopted VERBATIM into the slice's test plan.

*(Confirm round, same day: 11/14 CLOSED on first read; #3/#10 closed by the `recall_min_charge_chars ≥1`
boundary above, #12 by the restore no-clobber; deviation A ACCEPTED, deviation B accepted as amended.
Reviewer's own words: "two small spec fixes make it BUILD" — both applied verbatim. FINAL: BUILD.)*

### 15c. D60 as-built + review close (2026-08-19)

**BUILT + REVIEW-CLOSED, all in one day.** Opus-built from the §15/§15b pinned brief in 4 commits
(`bdff95d` clearing revision · `798ed4b` budgets + delete guard · `0f85b33` prompts + Conf ·
`df95ade` a self-caught Conf fix) + the review wave `6063b40`. Council (the Hermes `emma` lane =
gpt-5.6-sol, Codex CLI auth being down): design round 14 findings → §15b; diff round SHIP WITH
FIXES (2 MED: the anchored-gate lift-by-gain — stateless, one shared pricing formula — and
`superseded_by` subject sanitation via the canonical resolver; 1 LOW recorded as a code comment);
test-audit round INSUFFICIENT → 7 additions + over-pinning fixes (one reviewer item overruled:
`clear_keep_steps` keeps `ge=1`, zero pinned as REJECTED at boot + Conf PUT); final confirm:
**all CLOSED, no new defects, SHIP**. Build-time verifies: `auto_write` CONFIRMED gating all four
mutations (dry-run structural, zero new machinery); the §15b-7 verify FAILED and fixed a REAL
pre-existing Tier-2 bug (the fold boundary could snap to a mid-turn steer row). Leanest-reading
calls (all reviewer-ACCEPTED): current-turn identity = the logical-turn boundary (not the per-HTTP
`TurnHandle.turn_id`); read-class = explicit `{read, search}` allowlist; restore stays documented
manual with archive-side no-clobber; the prompt names `search` for coverage checks. Numbers:
backend tests 1724 → **1798** · FE 2086 → 2089 · full gate 6/6 at every commit. **NEXT: RUN 3 on
dev — `consolidation_dryrun` with `memory.auto_write` OFF → owner eyeballs the plan → the live
run (§5 procedure). Unreleased until the next release; prod behavior unchanged until then.**

### 15d. The post-push verification audit (2026-08-19, owner-ordered "every nuance" pass)

Independent Opus auditor over both packages (D60 + the `5678c08` qwen wire normalization),
main-seat ruled. **Re-verified in code, all CONFIRMED:** the 14 §15b folds, both review-wave
MEDs + the recorded LOW comment (the no-clobber scope note in `core_memory.py`), the five
acceptance families' test pins, all four tunables config-and-Conf-exposed, zero leftover
instrumentation. **The wire normalization audited fully closed:** single chokepoint
(`complete`/`stream_chat` in `adapters/inference.py`) with no bypass path (summarizer,
automations, subagents all route through it), both `8575ae2` review findings folded with
wire-level test pins, no doc still describing the old multi-system shape, nothing hardcoding
qwen/corsair (the primary flip is pure config). **Findings, acted on same day:**
- **The ① pressure gate was INERT on both live configs** — no `context_window` on the
  openrouter fallback ⇒ `min_chain_window` `None` ⇒ the documented always-on fallback. Dev
  armed (`google/gemma-4-31b-it:free` → 262144, the OpenRouter-published value); the prod
  config flip must carry the same key; §14e corrected (run 3 exercised ②, not ①).
- **The recall floor was refunded across a suspend/resume** — `_seed_recall` counted only
  framed output, so a confirm round-trip refunded every failed read's floor, contradicting
  §15b-3's "carried across resume". Fixed (the reseed re-charges the floor for no-output
  read-class calls via `is_recall_call`); pinned by
  `test_the_floor_survives_a_suspend_resume_reseed`. Backend tests 1798 → 1799.
- **Doc drift fixed in place:** §15 ②'s phantom `status` action · §15 ③'s archive path ·
  DECISIONS' pre-amendment gate denominator · DESIGN §recall bullet (floor + cap exemption) ·
  QUALITY.md counts · HANDOFF's stale "unpushed" status.
- **Recorded LOW, non-build:** `MemoryEditor.tsx` has no FE test pinning the D60 Conf fields
  (consistent with the repo's existing FE coverage shape; noted, not padded).

## 16. The consolidation-UX slice (D61 — council-amended 2026-08-19, pre-build)

> Evidence base: the §15d/§14f records + the 2026-08-19 limitations crosswalk (Claude Code vs
> ours) + the owner's UX rulings in conversation: consolidation stays OFF-by-default and
> human-triggered; pressure alerts the OWNER (not the model); a command triggers the procedure;
> "literally just asking" must work. Five parts, one slice; frontend-heavy; no migration.
> Council: the Hermes `emma` lane (gpt-5.6-sol high, blind `--ignore-rules` read-only round) —
> **BUILD WITH CHANGES, 9 findings, ALL folded below (§16b)**.

**① The `/consolidate [dry]` composer verb.** One new row in `BUILTIN_VERBS`
(frontend/src/lib/composer.ts — the same table as `/compact`), args `[dry]`, help line, shown in
`/help` + first-token completion (the `[dry]` argument is a help hint only — no argument
completion machinery). `run`: validate the argument (blank or `dry`, anything else → note);
fetch the prompt registry (the existing `/api/prompts` shape), take `consolidation` (bare) or
`consolidation_dryrun` (`dry`) `current` text — the command and a hand-sent prompt end at the
SAME owner-editable text — clear any armed composer scope (matching explicit skill/provider
sends), and send via `sendMessage(current, { raw: "/consolidate…" })` (store/chat.ts:1922); the
thread shows the real prompt as the user message. Fetch failure → `pushSystemNote`, nothing
sent. **The §16b-1 guard: the command checks `memory.auto_write` first** — `dry` with writes ON
is refused with an actionable note (the dry run is dry STRUCTURALLY, §5 step 1, not by asking
the model), and bare `/consolidate` with writes OFF gets a note suggesting the dry form (every
write would be refused mid-run). One settings fetch, both directions.

**② The pressure hint = a system note in chat, owner-facing.** Hook = the ONE cross-transport
terminal helper (`notifyTurnTerminal`, store/chat.ts:289 — §16b-3: NOT the `compaction` handler,
and not `done` alone, which misses buffered turns and reattach/`active:false` completions): on a
real non-suspended terminal state, run ONE in-flight-deduped check — fetch
`GET /api/memory/core/status` (silent best-effort on failure) and, when `enabled` and
`index_pct ≥ consolidation_nudge_pct`, push ONCE per pressure episode:
`// memory index at NN% — run /consolidate when convenient`. Latch: module-level, re-arms when
fill drops below the threshold; **accepted semantic: once per PAGE LIFETIME per episode** (a
reload also removed the prior client-only note — no persistence). Backend delta: `CoreStatus`
gains `consolidation_nudge_pct` so config stays the single threshold source. Recorded limit:
backend-only automation turns produce no note unless this client observes/reattaches.

**③ The model-facing pressure clause is REMOVED (§16b-5 — the council took the owner's ruling
further than the draft).** Any pressure imperative in the injected header — including the
draft's "suggest a run to the owner" — is still mid-task steering and a second channel beside ②.
The header keeps the fill percentage as plain DATA; the clause goes entirely, and `nudge_pct`
leaves `_header`/`_fit` and the render-cache key (no remaining render role). The config field
stays — ② and the backend latch consume it.

**④ Shipped default `index_char_limit` 8192 → 10240** (config.py; the owner's ~10K sizing).
Semantics stated: deployments that OMIT the key adopt 10240 on upgrade; an explicitly-pinned
8192 stays (and stays pressured — ②'s note then fires, correctly). §16b-6 consistency sweep in
the same commit: the ConfTab fallback literal (frontend/src/tabs/ConfTab.tsx:1039),
`config.example.yaml`, and the DESIGN/SPEC default rows — one default, no stragglers.

**⑤ The `search` omission counter** (crosswalk D3; §16b-7 shape). `search` returns a small
structured result `{hits, omitted}`; every budget-skipped match is COUNTED, displayed hits are
evicted until the tail note fits INSIDE `topic_char_limit` (the note reserves in-band, like the
index truncation note), and an omitted-only result is NOT "no matches" — the tool renders the
note either way, charged through the existing `_recalled` path. Wording (§16b-8, no path
promises): `… N more matching topic(s) not shown — narrow the search to reveal them.`

**Deliberate non-builds (recorded, next-slice candidates):** paged/offset reads (the 53K-topic
residual, §14c #3 — still holds MERGE 2) · a `modified` freshness stamp on topics (crosswalk D4)
· the automation arm (banked behind the writes-derived outcome signal, §14c #10).

**Acceptance (§16b-9 set):** composer — bare/dry registry resolution · invalid args · missing/
non-OK/malformed prompt responses · exact `sendMessage` body + raw line · armed-scope clearing ·
`/help` + verb completion · the auto_write guard both directions; chat — streaming, buffered,
snapshot and `active:false` terminals all trigger the one deduped check · disabled/below/above
threshold · re-arm on drop · failed fetch silent · replay + concurrent dedupe; backend — the
status field · NO pressure clause in the header at any fill · the 10240 default · omission
count with some AND zero visible hits · the note inside the budget. Plus:
`CoreMemoryStatus` in frontend/src/hooks/useMemory.ts gains the field. No new Conf control, no
browser e2e (already exposed / store-level covered). Build = Opus from this section as the
pinned brief; the `emma` lane diff round after; full gate per commit.

### 16b. The D61 council round (Emma/gpt-5.6-sol, blind, 2026-08-19) — BUILD WITH CHANGES, all folded

1 HIGH `/consolidate dry` wasn't structurally dry → the auto_write pre-check (①; + the
main-seat symmetric hint for the bare form). 2 LOW mechanism confirmed (client-side registry
fetch is right; no `prompt_id` on ChatRequest, no skill, no server expansion) + the exact send
seam. 3 HIGH the draft's ② chokepoint was WRONG (chat.ts:982 is the `compaction` handler;
`done` alone misses buffered/reattach terminals) → `notifyTurnTerminal` + in-flight dedup.
4 LOW threshold-in-CoreStatus confirmed; latch = once per page lifetime, accepted explicitly;
silent best-effort fetch. 5 HIGH the draft's softened clause still steered the model mid-task →
clause removed entirely, pct stays as data. 6 MED default-change consistency (ConfTab fallback
literal + example + doc rows in the same commit). 7 HIGH the tail note must reserve INSIDE the
budget and an omitted-only search must not read as "no matches" → `{hits, omitted}` + evict-to-
fit. 8 MED the draft note promised paths it couldn't show → the narrow-the-search wording.
9 MED the acceptance list, adopted verbatim. Overrules: none.

### 16c. As-built (D61, 2026-08-19 — commit `fb2a995`, review-closed)

Built by an Opus 5 subagent from §16 as the pinned brief; one commit, amended twice (a
supervisor ruling, then the review fix wave), full gate green at every step. 14 files,
+609/−109 net at first gate. **FINAL SHIP** from the Emma lane (gpt-5.6-sol high, blind) after
a 4-MED SHIP-WITH-FIXES round + an all-RESOLVED confirm round.

**Where each part landed:** ① `BUILTIN_VERBS` row + `runConsolidate`
(frontend/src/lib/composer.ts — `BuiltinVerb.run` gained the raw line; existing rows ignore
it) · ② `checkMemoryPressure` hooked inside `notifyTurnTerminal` (store/chat.ts);
`CoreStatus.consolidation_nudge_pct` rides the existing `asdict` route; FE type in
useMemory.ts · ③ `_header`/`_fit`/`_assemble` take no `nudge_pct`; the render-cache key is
`(scan signature, cap)` · ④ config.py default 10240 + the §16b-6 sweep (ConfTab fallback ·
config.example.yaml · DESIGN row · this file's §3/§6.1) · ⑤ `CoreSearch{hits, omitted}`,
eviction inside `search`, `render_hits(found, cap)` + `_omission_note`; the tool's
omitted-only branch. Tests: BE 1799→1801, FE 2108→2129.

**Supervisor rulings on build deviations (recorded):** the bare-form guard REFUSES (the §16
"note suggesting the dry form" is only actionable pre-send; a writes-OFF live run is
structurally broken — every step-2/3 write refused) — both mismatched directions refuse,
nothing sent · settings-fetch failure fails closed · the `_hits_result` summary reworded to
"N shown[, M not shown]" (the old wording became false once hits could be omitted) · the
per-turn status GET fires even with the feature off — accepted recorded cost, no gating
mechanism (single-user) · replay-dedupe coverage is store-level only (reattach transports
call `reloadChat`, which drops client-only notes — the latch is what is actually testable).

**The review round (4 MED, all folded):** F1 a latch re-arm race — a calm terminal (typically
the consolidation turn's own) discarded during an in-flight pressured check left the latch
down for the next episode → `memoryPressurePending` + ONE coalesced follow-up in the
`finally` (mutation-verified: removing the drain fails both tests) · F2 `clearComposerScope()`
sat after two awaits and could spend an arm made DURING the reads → moved synchronous after
arg validation; a later refusal deliberately also spends the arm (the explicit slash attempt
supersedes the menu, one-shot like the other verbs) · F3 an omitted-only search body EXCEEDED
`topic_char_limit` (reproduced at cap 1: 72-char note; the build's comment claimed `_fit`
parity but `_fit` hard-clamps and search didn't) → `render_hits(found, cap)` clamps `[:cap]`
as its last act, cap threaded via a `topic_char_limit()` accessor (the `recall_char_limit()`
idiom) · F4 the auto_write guard trusted a malformed 200 → stricter than prescribed:
`typeof value === "boolean" ? value : null` — `/api/settings` model-dumps the full config, so
an absent key is shape skew, not a default, and skew must not choose which form runs. Plus
the reviewer's acceptance-gap note: exact equality at the threshold now pinned.

~~**Owed:** the live/device exercise~~ **→ ✅ EXERCISED 2026-08-20** (browser-driven on the live
dev app, screenshots banked in the session scratchpad; zero corpus writes, sha-verified; settings
restored): the **pressure note fired in a real thread** with the exact wording — notably on an
*error* terminal (all endpoints failed), a real non-suspended terminal per design — with the
threshold proven config-driven end-to-end (lowering `consolidation_nudge_pct` 80→75 via
`PUT /api/settings` flipped the behavior live; dev sits at 79–81% of the 10240 cap, not the
pre-resize "100%"). **Both guard refusals verified at the UI** (dry+writes-ON · bare+writes-OFF,
each with its note; the raw `/consolidate` line renders as the user chip). **The real send is
proven mechanically**: the verb resolved the registry `consolidation_dryrun` text, rendered it as
the user message, and drove a real turn through the whole failover chain (corsair → llamacpp →
openrouter, retries included). The below-threshold quiet side (79% < 80, no note) and `/help`
(the `[dry]` row renders fine — gacha lays help out as flowing prose, so column alignment is
moot there) also passed. **One thin residual:** no model *answered* — corsair was offline and
openrouter's free gemma pool was upstream-rate-limited (429) throughout — so "a real plan reply
through the verb" closes itself the first time `/consolidate dry` runs with a serveable model
(§14e already proved this exact prompt yields a plan on a real model; only the send mechanics
were new, and they held). Rider closed the same day: the `testing-parked-wing-it.md` status
anomaly (a topic file with no `MEMORY.md` line — likely the pre-fix §14b half-write orphan) was
re-indexed by hand + committed in the dev memory repo; anomalies now `[]`, and the restored line
puts dev at 81% — OVER the 80% threshold, so the owner-facing note now fires organically on dev
(correct: the index really is that full).

