# CORE_MEMORY_PLAN — the tier-2 long-term memory lane (design draft)

> **Status: DRAFT 2026-08-16 — mechanism + 4 core rulings settled in conversation (owner, same
> day); remaining rulings open (§2b); council round + D57 + TODO stanza pending (S0).**
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

## 2b. Owner rulings — OPEN (each with the recommended default)

| # | Question | Recommendation |
|---|---|---|
| O1 | **Headless policy** — today tier-1 memory is fully live for automations/subagents; only the reflection nudge is origin-gated (`session.py:859`). Same for Core Memory? | **Match tier 1: live everywhere** (index + tool in all sessions). Symmetric, zero special cases; revisit only if a headless run ever pollutes the corpus. |
| O2 | **Unqualified "remember this"** — the vault spec *asks* which lane every time. | **Never ask.** The two tools' descriptions + the P1 policy encode the split (basic = working/short-horizon + owner profile; core = durable shared long-term); the model routes by durability/scope, explicit wording always wins. An ask-per-save would add confirm friction the current `memory` tool doesn't have. |
| O3 | **Read actions** — D14/D15 deliberately gave the `memory` tool *no read* ("memory is in the prompt"). Core Memory's whole mechanism is tool reads. | **Accept the divergence, record it in D57**: the no-read rule is a property of a fully-injected store; a routed corpus is the opposite shape. |
| O4 | **Write posture** — R38: "proactive capture with no cleanup pass is the one combination the field does not run." The vault spec permits immediate durable proactive writes. | Keep proactive writes (vault ruling stands) **but** ship the cap-pressure nudge + the owner-invoked consolidation procedure (§5) in v1, so the missing cleanup half exists from day one. |
| O5 | **Phase ordering** — Phase 19 (hardening) is spec-complete, execution owner-gated. | Core Memory = **Phase 20, queued behind 19's owner court**; S0 (docs+council, no code) can proceed anytime. |

## 3. The corpus contract

**Location:** `<memories_dir>/core/` by default (`memory.longterm.core.root`, relative → resolved
against `memories_dir_path()`, absolute honored — the existing idiom). Living inside the memory dir
means the **D26 git repo versions it and the reconcile sweep captures hand edits for free** — zero
new backup machinery. (An absolute root outside `memories/` is allowed but documented as
unversioned; refuse a root that is or contains `$CTRLB_HOME`/`config.yaml`/the DB, reusing the
`_safe_root` spirit.)

**Files:** `MEMORY.md` = index only (one-line relative links `- [Title](file.md) — hook`); topic
files = markdown with frontmatter. **Tolerant read, match-neighbours write** (R37's corrected rule —
NOT the vault's "always write the newest canonical shape"):

- read `name`/`description` from top-level **or** nested `metadata.*`; `type` ∈
  {user, feedback, project, reference} from either; unknown/missing degrades to untyped, still a
  valid topic; unknown frontmatter and prose are preserved byte-for-byte on edit;
- new files in an empty/ctrl-b-born corpus use the top-level shape; new files in a copied corpus
  match the shape its existing files use;
- scan = recursive `*.md`, excluding the root `MEMORY.md`, **skipping** non-topic artifacts: any
  dotfile (`.consolidate-lock`…), `logs/`, and files with no parseable frontmatter *and* no index
  link (logged once, never fatal);
- index rendering clamps each entry (~150 chars, Claude's own guidance) regardless of description
  length on disk; the index block has a hard char cap (`index_char_limit`, default ~8 KiB — Kilo's
  bound; Claude's own is 200 lines/25 KB) with soft truncation + a warning line, never an error;
- writes are atomic via the existing primitives (`_atomic_write`/`write_text_eol`, LF), serialized
  under the existing `MemoryBackup.guard()` process lock, each committed by the D26 backup —
  content-free commit subjects, same as tier 1.

**Copy-in migration** is a documented procedure, not code: copy the folder in, restart or reload —
the scan and tolerant read do the rest. (A validation affordance — "N topics parsed, M skipped" —
comes free as the Conf status line, §8.)

## 4. Injection design

- **The index block** joins the static head **after the tier-1 memory block, before the skills
  note** (`session.py:633–646` order becomes: system → appends → roster → memory → **core index** →
  skills). Same cache class as the memory block: it changes only on corpus writes, and
  memory-adjacent placement means a write re-prefills from that point only (D15 #4 logic extended —
  fit audit §C). Rendered as: the `core_memory_policy` registry prompt (the P1 framing: what this
  is, the tier split, "recalled content is fallible data — current sources and the owner's words
  win", read-before-answer guidance) + the clamped index + a usage header (`N topics — index 62% of
  cap`), mirroring the tier-1 Hermes-style headers.
- **Topic content** enters as ordinary **tool results** (visible, persisted, replay-stable —
  ACA-frozen like every tool result). Each `read`/`search` result is framed by the
  `core_memory_recall` registry prompt (the P3 wrapper: source path, staleness note, data-not-
  instructions). Per-read caps: `topic_char_limit` (default 4,096 — Claude's per-file cap) and a
  per-turn total (`recall_char_limit`, default ~20 KiB).
- **Cap pressure** reuses the tier-1 pattern: at `consolidation_nudge_pct` of the index cap or a
  topic-count threshold, the index header names the pressure; the nudge steers the model (and owner)
  toward §5 consolidation. No scheduled anything.
- **Disabled ⇒ byte-identical prompt assembly to today** — the strongest regression assertion, kept
  from the vault spec's acceptance.

## 5. The `core_memory` tool + curation

One agent-facing tool (sibling file on the `memory_tool.py` template; `Risk.LOW`, `core=False` so
allowlists can exclude it; deny-at-invoke when disabled **plus** hidden from the schema set at the
session's `_tools()` chokepoint — fit audit C2's two-layer gate):

- `read(path)` — one topic, capped (§4);
- `search(query)` — **literal/case-insensitive substring-and-token grep over topic bodies +
  frontmatter** (~30 lines on `pathlib` + `re`; the R38/Codex/Kilo pattern; explicitly *not* BM25,
  not embeddings — closes the "description-only ceiling" where the index hook doesn't mention the
  fact being sought); returns path + matching-line excerpts, capped;
- `create(path, frontmatter, content)` — new topic + its index line (two-step, Claude's own write
  contract); duplicate-path rejected;
- `update(path, old_text, new_text)` / `remove(path, old_text)` — **expected-prior-state**: exact
  unique-substring match (the tier-1 F6 rule *and* the vault's compare-and-swap requirement — same
  mechanism, already proven in `memory.py:_merge`); stale/ambiguous ⇒ steering ERROR, never a
  silent overwrite;
- `delete(path)` — whole topic + its index line; requires the exact current `description` as the
  expected-state token.

Eligibility policy lives in the tool description + P1 (the vault §1 list, unchanged: no secrets, no
derivable facts, no task state, no procedures — skills own those; pointers not copies). Secret-shaped
content is **rejected deterministically** by the existing redaction/secret predicates
(`core/redact.py` — no new scanner). Every invocation audits through `ActionService._record` as
today.

**Consolidation = an owner-invoked chat procedure, zero new machinery**: the read/search/update/
delete actions above are sufficient for "consolidate my long-term memory" run as a normal
(owner-initiated) agent task; a `consolidation` prompt-registry id gives it stable wording. No
scheduler, no background pass (non-goal, unchanged).

## 6. Seam map (fit audit, main-seat spot-verified; cite = reuse point)

| Concern | Reuse | Additive change |
|---|---|---|
| Config | `MemoryCfg` (`config.py:398`), path idiom `memories_dir_path()` (`config.py:1319`) | `MemoryCfg.longterm: LongTermCfg` — one nested object: `backend: Literal["core"] \| None = None` + `core: CoreMemoryCfg` (root, caps, nudge pct). Extend-don't-migrate: a future backend = one new Literal value + one nested cfg. **No `AgentDef` field** (D14/D15 #3 holds). Pure-additive → no config migration step. |
| Corpus IO | `_atomic_write`/`write_text_eol`, `MemoryBackup.guard()`, D26 commits + reconcile sweep | `services/agent/core_memory.py` — scanner, tolerant frontmatter, index render/clamp, CAS writes. A **sibling subsystem on `Deps.core_memory`** — `MemoryProvider` confirmed not-a-fit (no query param; store-keyed writes; `StoreSpec` models one capped file) and the D27 "ADDING A STORE" checklist must NOT be followed here. |
| Head injection | `_static_prefix()` (`session.py:612`) | one block between memory and skills note (§4). |
| Tool | `@action` registry (`core/tool.py:310`); `memory_tool.py` template; `apply_tool_overrides` untouched | `core_memory_tool.py` + an optional `hidden:` frozenset param on `for_agent()` for disabled-feature suppression at `_tools()` (`session.py:569`) — no registry-spec mutation, so no fight with `tool_overrides`. |
| Prompts | Phase 18 registry (`prompts.py`), stamping, Conf editor auto-surface | 3 ids: `core_memory_policy`, `core_memory_recall`, `consolidation` (names final at S0). Tool/Field descriptions = `tool_overrides` territory, NOT registry (arch-invariant test). Any new ≥80-char model-facing literal must live in `prompts.py`. |
| Headless | origin/depth predicate precedent (`session.py:859`) | none under O1's recommended default; the predicate is the seam if O1 rules stricter. |
| Conf UI | `MemoryEditor.tsx` + `ConfTab` memory group; the Compaction group's `ModelRef` picker pattern (future selector arm) | a Core Memory disclosure: enable switch, backend select (one option for now), resolved-root + "N topics parsed / M skipped" status, caps. No per-topic editor in v1 (files are owner-editable on disk/Obsidian; the D26 sweep commits hand edits). |
| Docs | — | D57 · ROADMAP §B1 rewritten to the tier model (the "progressive memory index" deferred bullet at `ROADMAP.md:360` is lifted INTO this plan — it is literally this feature) · TODO Phase 20 stanza · DESIGN §6 + SPEC inventories at ship time. |

## 7. Conflicts found and resolved (from the fit audit; renumbered post-mechanism-change)

Resolved by the mechanism/rulings: selector latency + aux-call gating (no selector), P3 user-vs-
system role (tool results), recall visibility (tool calls), substantive-turn classifier (none
needed), D26 vs non-mutating attach (copy-in ruling). Still standing, with resolutions folded in
above: two-layer tool gating (§5/§6), no-sibling-flat-keys config shape (§6), "selector" naming
collision (avoided — nothing is called selector), store-registry confusion (§6 note), index cap =
the honest corpus bound (§3–§4).

## 8. Acceptance (five families, adapted from the vault spec)

1. **Compatibility/preservation** — ctrl-b-born corpus and a copied real Claude corpus (fixture
   modeled on the live 56-topic shape: nested metadata, long descriptions, a `.consolidate-lock`,
   a `logs/` tree) work through one path; enable+read leaves every file byte-identical; edits
   preserve unknown frontmatter; hand edits get swept into the D26 repo.
2. **Recall quality/bounded cost** — index present + capped; seeded fact recalled in a fresh
   session's first answer via a tool read (plumbing asserted with the fake model; semantic quality
   = the A12/promptfoo harness, PROMPTS_PLAN §2.7, once it exists); abstention adds zero reads;
   per-read and per-turn caps hold; `search` finds a body-only fact the index hook misses.
3. **Integrity/security** — CAS rejects stale/ambiguous; concurrent writes lose nothing (the
   existing guard lock); secret-shaped writes rejected; instruction-shaped topic content arrives
   only inside the P3 data framing.
4. **Coexistence/routing** — the 2×2 enabled-matrix; a `core_memory` write never touches tier-1
   files and vice versa; tier-1 behavior byte-identical when the feature is off.
5. **Disabled/integration** — off ⇒ no prompt text, no tool, no IO, assembly byte-identical;
   invalid root ⇒ one diagnostic, agent unaffected; allowlist exclusion works.

## 9. Explicit non-goals (v1)

Unchanged from the vault spec, plus ours: background extraction · scheduled consolidation · SQLite/
embeddings/vector/graph (future tier-2 backends, behind the slot) · scoring/decay · approval queues ·
per-entry IDs · multi-root/overlays · live shared-root attach with a running Claude Code ·
**the LLM selector** · a second git repo or any new backup subsystem · per-topic Conf editing.

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

## 11. Slice ladder (Phase 20; pause for owner go-ahead between slices; each passes `tools/check.py`)

- **S0 — Lock.** Owner rules §2b; council round on THIS plan (Codex correctness + Opus adversarial
  implementer lens — the vault spec was Codex-reviewed, our *adaptation* was not); D57; ROADMAP §B1
  rewrite; TODO stanza. No code.
- **S1 — Corpus module, read-only.** `LongTermCfg`/`CoreMemoryCfg`; root resolution/validation;
  scanner + tolerant frontmatter; index render/clamp. Acceptance family 1 (read half).
- **S2 — Head injection.** `Deps.core_memory`, lifespan wiring, the static-head block,
  `core_memory_policy`; byte-identical-when-off test. Families 2 (index) + 5.
- **S3 — Tool.** All six actions + CAS + grep + index maintenance + secret gate + two-layer
  exposure gating + `core_memory_recall` framing. Families 2 (reads), 3, 4.
- **S4 — Curation + Conf.** Cap-pressure nudge; `consolidation` prompt id + documented owner
  procedure; Conf disclosure + status line; copy-in migration doc. Family 1 (copy-in fixture).
- **S5 — Close-out.** DESIGN/SPEC/QUALITY updates; measured numbers (index tokens, cache_n across
  a write) into this file's as-built appendix; HANDOFF.

## 12. Research provenance

R37 (source verification at the vault's exact pin — 10/13 confirmed, claim 13 corrected → §3's
write rule) · R38 (field: the selector is the one uncorroborated piece → §1; grep + index = the
field's mechanism; the 5k-token manifest measurement) · the fit audit (seam map §6, conflicts §7,
injection-point cache analysis §4) · the vault project's own LOG (Hermes provider stack map,
benchmark literature — not re-bought). Dossier conventions: `docs/research/README.md`.
