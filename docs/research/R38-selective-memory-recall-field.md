# R38 — Selective long-term-memory recall in the peer class

**Date of pass: 2026-08-16.** Commissioned to review a proposed second memory lane (design under
review: `40 Projects/2026-08-11-project-scoped-profile-memory-architecture/SPEC.md` + `LOG.md` in the
owner's vault — read-only, unmodified). The design: one shared markdown corpus (`MEMORY.md` routing
index + semantic topic files with `name`/`description`/`type` frontmatter, Claude-Code-native), with
**one bounded PRE-ANSWER semantic selector call per substantive turn** (an auxiliary LLM picks exact
filenames from a metadata manifest; empty valid; finite timeout), selected topics injected as
delimited fallible user-side data, plus one mutation tool. v1 explicitly excludes embeddings/vector,
BM25, SQLite, graphs, background extraction, scheduled consolidation, scoring/decay, approval queues.

**Question bought:** is that direction sound and best-in-class for a single-user self-hosted agent app
(ctrl-b: FastAPI, local llama.cpp + optional cloud, corpus expected tens→few hundred topics)?

**Drove:** nothing yet — evidence for the owner's ruling on the second memory lane. No D-entry.

## Confidence key

- **[V]** verified — I read the source at the recorded SHA, or ran the measurement myself.
- **[R]** reported — secondary source (blog, docs page, issue summary) not cross-checked in source.
- **[U]** unverified — expected but not checked; called out as such.

## Sources and SHAs (all resolved 2026-08-16)

| Project | Repo | HEAD SHA | HEAD date | Memory feature? |
|---|---|---|---|---|
| Claude Code | local mirror `yasasbanukaofficial/claude-code` @ `/home/emma/github/claude-code` | `a371abbe75ffa0d0a3c92290e2bbf56a7ef54367` | 2026-04-05 | ✅ memdir + LLM selector |
| Codex CLI | `openai/codex` | `9ded177ce7c1` | 2026-08-16 | ✅ `ext/memories` (new) |
| Kilo Code | `Kilo-Org/kilocode` | `90a93a7aa259` | 2026-08-16 | ✅ `packages/kilo-memory` (new) |
| open-webui | `open-webui/open-webui` | `01f4282f1ffe` | 2026-07-27 | ✅ memories + vector |
| AnythingLLM | `Mintplex-Labs/anything-llm` | `3aec848f2885` | 2026-08-13 | ✅ memories + reranker |
| LibreChat | `danny-avila/LibreChat` | `eaef87fa2684` | 2026-08-14 | ✅ key/value memory agent |
| goose | `aaif-goose/goose` | `3810898a7447` | 2026-08-14 | ✅ memory MCP extension |
| opencode | `anomalyco/opencode` | `a0f8dccbfe13` | 2026-08-16 | ❌ **none** |
| Continue.dev | `continuedev/continue` | `5522c6f44ca0` | 2026-07-21 | ❌ **none** |
| aider | `Aider-AI/aider` | `5dc9490bb35f` | 2026-05-22 | ❌ **none** |
| llama.cpp | `ggml-org/llama.cpp` | `4df29be4f4c3` | 2026-08-16 | (prompt-cache evidence) |
| Letta | `letta-ai/letta` | `87fd37aab68c` | 2026-08-16 | docs only (supplement) |

**Repo-rename correction (2026-08-16) [V]:** `sst/opencode` now 301-redirects to
**`anomalyco/opencode`** and `block/goose` to **`aaif-goose/goose`**. Prior dossiers (R27, R30, R33,
R35, R36) cite the old paths; the GitHub API returns `Moved Permanently` with a null body for the old
names, which silently yields empty results in scripted passes. Use the new names.

**Caveat on the Claude Code mirror [V]:** the local checkout is a third-party de-obfuscated mirror
whose HEAD is **2026-04-05 — four months stale**. Everything I quote from it I read directly, so the
quotes are accurate *for that build*; treat live-Claude-Code behavior as **[U]** unless re-verified.
The vault's LOG already maps this checkout in depth, so this dossier only re-reads the parts that
answer Q1–Q4, plus what the vault did not record.

**Companion dossier:** [R37](./R37-claude-code-memory-source-verification.md) (same date, separate
pass) verifies the vault's *Claude-Code-specific* claims against that same pin in depth. R38 is the
**peer-comparative** half — what everyone else does, and whether the selector is the right mechanism.
Read R37 for "is the Claude evidence true", R38 for "is it the right thing to copy". Where they
overlap (§1.3 here), they agree.

---

## 1. Answer to Q1 — what the field actually ships for selective recall

### 1.1 The inventory

| Project | Recall mechanism | Bound | Failure mode |
|---|---|---|---|
| **Claude Code** | **LLM selector over metadata manifest** (Sonnet side-query, exact filenames) | ≤200 candidate files, ≤5 selected, 200 lines/4 KiB per file, 20 KB/turn, 60 KiB/session | fails **closed** → empty; **non-blocking, so a tool-free first answer can miss entirely** |
| **Codex CLI** | always-injected `memory_summary.md` (developer instructions) + **main-model-driven lexical search tools** over `~/.codex/memories/` | summary token-capped; "≤ 4-6 search steps"; `MAX_SEARCH_RESULTS` | model may skip the pass; prose "decision boundary" + citation block are the mitigations |
| **Kilo Code** | always-injected index block (8 KiB) + **keyword recall tool** (4 modes: typed/digest/search/catalog) | `maxProjectIndexBytes: 8192`, 5 recent sessions, 480 char/session line | index truncates → appends a note telling the model to call the recall tool |
| **open-webui** | **hybrid, blocking**: all `user`-type memories always injected + deterministic path-hint "neighborhood" + **vector top-k=8** | char limits `user_char_limit`/`context_char_limit` (2000 each default) | vector query wrapped in `try/except` → silently degrades to the always-inject + path lanes |
| **AnythingLLM** | **always-inject-everything under a hard corpus cap**, with a local cross-encoder rerank only when over cap | `GLOBAL_LIMIT: 5`, `WORKSPACE_LIMIT: 20`, `MAX_INJECTED_WORKSPACE_LIMIT: 5` | reranker failure → falls back to most-recent |
| **LibreChat** | **always-inject-everything** (all keys formatted into the prompt) under a global token limit | `tokenLimit` per config; per-value token accounting | none needed — it is a DB read |
| **goose** | **always-inject-everything** (all global memories pushed into the MCP extension `instructions`) + voluntary `retrieve_memories` tool | none visible | none |
| **Anthropic memory tool** (platform) | **tool-mediated voluntary recall**, with a platform-injected *mandatory-first-call* instruction | client-side; caps are the integrator's job | the instruction is the only guarantee |
| **Letta** | pinned in-context memory blocks + agent-driven archival retrieval tools | block size | agent-driven |
| **opencode / Continue / aider** | **no long-term memory feature at all** | — | — |

### 1.2 The headline

**Claude Code is alone in the reference class in running an auxiliary-LLM selector over topic
metadata.** [V] Every other project with a memory feature resolves the same problem one of three
other ways:

1. **always-inject a hard-capped corpus** (LibreChat, goose, AnythingLLM — AnythingLLM caps the
   *store itself* at 25 items so retrieval is unnecessary);
2. **always-inject a bounded index/summary and let the MAIN model pull detail with deterministic
   search tools** (Codex CLI, Kilo Code, Anthropic's platform memory tool, Letta);
3. **blocking deterministic retrieval** — vector and/or lexical, no auxiliary completion (open-webui,
   AnythingLLM's reranker).

Family (2) is where the two newest in-class implementations landed, both shipped since the vault's
pass: **Codex CLI's `codex-rs/ext/memories` and Kilo Code's `packages/kilo-memory` did not exist in
the vault's survey.** Both are 2026-08 HEAD. Both chose index-plus-tool over a selector.

### 1.3 Per-project evidence

**Claude Code — the selector, verbatim** [V]
`src/memdir/findRelevantMemories.ts:18-24`:

> `You are selecting memories that will be useful to Claude Code as it processes a user's query. You
> will be given the user's query and a list of available memory files with their filenames and
> descriptions.`
> `Return a list of filenames for the memories that will clearly be useful … (up to 5). Only include
> memories that you are certain will be helpful based on their name and description.`
> `- If you are unsure … do not include it in your list. Be selective and discerning.`
> `- If there are no memories in the list that would clearly be useful, feel free to return an empty list.`

Mechanics [V]: `getDefaultSonnetModel()`, `max_tokens: 256`, closed `json_schema` output
(`selected_memories: string[]`), returned names filtered against `validFilenames`
(`findRelevantMemories.ts:98-130`), any throw → `return []` (`:131-140`). Scan is
`MAX_MEMORY_FILES = 200`, `FRONTMATTER_MAX_LINES = 30`, recursive, excludes any basename `MEMORY.md`,
**sorted newest-first then sliced** (`memoryScan.ts:21,22,40-73`). Manifest line format is
`- [type] path (ISO-timestamp): description` (`memoryScan.ts:84-93`).

Two mechanisms the vault's map does **not** record, both interesting [V]:

- **`recentTools` negative filter** (`findRelevantMemories.ts:87-95`) — a shipped fix for a real
  selector failure: *"The selector otherwise matches on keyword overlap ("spawn" in query + "spawn"
  in a memory description → false positive)."* The prompt therefore carries a carve-out:
  *"do not select memories that are usage reference or API documentation for those tools … DO still
  select memories containing warnings, gotchas, or known issues about those tools."*
- **`alreadySurfaced` pre-filter** (`:44-48`) — surfaced paths are removed *before* the call
  *"so the selector spends its 5-slot budget on fresh candidates."*

Injection [V]: `src/utils/messages.ts:3708-3721` — selected topics become `createUserMessage(...,
isMeta: true)` wrapped by `wrapMessagesInSystemReminder`, i.e. **user-side hidden context, not system
prompt**. The rendered header is stored at attachment-creation time explicitly *"so the rendered
bytes are stable across turns (prompt-cache hit)"*. Freshness prose lives in `memdir/memoryAge.ts`:

> `This memory is ${d} days old. Memories are point-in-time observations, not live state — claims
> about code behavior or file:line citations may be outdated. Verify against current code before
> asserting as fact.`

…with a recorded motivation: *"Motivated by user reports of stale code-state memories (file:line
citations to code that has since changed) being asserted as fact — the citation makes the stale claim
sound more authoritative, not less."* (`memoryAge.ts:22-31`).

**Codex CLI — index + agentic lexical search** [V]
`codex-rs/ext/memories/src/prompts.rs:26-51` builds `memory_summary.md` into **developer
instructions**, truncated at `MEMORY_TOOL_DEVELOPER_INSTRUCTIONS_SUMMARY_TOKEN_LIMIT`. The template
`templates/memories/read_path.md` is the whole recall policy, and is worth reading in full; the
load-bearing lines:

> `Decision boundary: should you use memory for a new user query?`
> `- Skip memory ONLY when the request is clearly self-contained …`
> `- Hard skip examples: current time/date, simple translation, simple sentence rewrite, one-line
>   shell command, trivial formatting.`
> `- If unsure, do a quick memory pass.`
> `- {{ base_path }}/MEMORY.md (searchable registry; primary file to query)`
> `Quick-pass budget: … ideally <= 4-6 search steps before main work.`
> `You can update the memories **only** when explicitly asked by the user.`

Retrieval is **literal text search, not embeddings** [V]: `ext/memories/src/local/search.rs` walks
the directory, matches multiple literal queries with `SearchMatchMode` (incl.
`AllWithinLines { line_count }`), case-sensitivity and normalization flags, context lines, and cursor
pagination — a grep, exposed as a tool alongside `list`, `read`, `add_ad_hoc_note`
(`ext/memories/src/tools/mod.rs:29-53`).

Two more Codex mechanisms with no equivalent in the spec [V]:
- **Citations**: the model must append `<oai-mem-citation>` with `citation_entries`
  (`<file>:<line_start>-<line_end>|note=[…]`) and `rollout_ids` — machine-readable provenance for
  *which memory was actually used*.
- **A verification policy**, not just a staleness label: *"If a fact is likely to drift and is cheap
  to verify, verify it before answering… Do not present unverified memory-derived facts as
  confirmed-current."*
- Writes never touch memory files: the model drops **one note file** into
  `extensions/ad_hoc/notes/`, and a background two-stage pipeline consolidates
  (`state/memory_migrations/0001_memories.sql`: `stage1_outputs(thread_id, raw_memory,
  rollout_summary, …, selected_for_phase2)` + a `jobs` table with `lease_until` / `retry_remaining`).

**Kilo Code — index + keyword tool, with the ceiling handled** [V]
`packages/kilo-memory/src/recall/budget.ts` wraps the injected block as
```
```kilo-memory-v1 context_not_instruction
scope: project
root: …
limits: 8192/5/480
```
— note the fence tag **`context_not_instruction`** carries the authority boundary inline (the same job
as the spec's P3 wrapper). Defaults `schema.ts:76-81`: `maxProjectIndexBytes: 8192`,
`maxRecentSessions: 5`, `maxSessionLineChars: 480`. Overflow is explicit:

> `note: index truncated; call kilo_memory_recall mode=typed|digest|search query=<topic> to search
> omitted memory`

and the tool description (`src/prompts/tool-memory-recall.txt`) states the failure mode of lexical
matching to the model outright:

> `Matching is keyword-based, not semantic. The query scores on words literally present in stored
> entries; there is no synonym expansion, so unrelated wording will not match`
> `The injected startup memory block is an index and continuity summary, not the full memory store.
> If it shows a matching key, topic, summary, truncated record, or session digest but not the exact
> detail needed, use this tool before answering.`
> `If a search returns nothing, use mode=catalog to scan stored keys for the right entry, then recall
> it by its own words.`

**open-webui — the only blocking hybrid** [V]
`backend/open_webui/utils/memory.py::add_memory_context` is called from
`utils/middleware.py:2542-2543`, i.e. **before** the model call:
```python
if 'memory' in features and features['memory'] and await Config.get('memories.system_context.enable'):
    form_data = await add_memory_context(request, form_data, user, model)
```
It builds a query from the **last 7 user messages, joined, `[-4000:]` chars**, then composes three
lanes: every `type == 'user'` memory (unconditional), a deterministic **path-hint neighborhood**
(`memory_path_hints` — substring match of path segments ≥3 chars against the query), and a vector
`query_memory(..., k=8)` wrapped in `try/except Exception: log.debug(e)`. Output goes into the
**system message** via `add_or_update_system_message(memory_context, messages, append=True)`, with the
previous `<memory_context>…</memory_context>` block excised first — i.e. the system prefix changes
every turn (see §4). Background capture exists but is off by default and cadence-gated:
`memories.background_review.enable`, `review_interval_turns` default 10, fired as a detached
`asyncio.create_task` after the turn.

**AnythingLLM — cap the store, don't retrieve** [V]
`server/models/memory.js:23-25`: `GLOBAL_LIMIT: 5`, `WORKSPACE_LIMIT: 20`,
`MAX_INJECTED_WORKSPACE_LIMIT: 5`. `server/utils/memories/index.js` reranks only when
`workspaceMemories.length > MAX_INJECTED_WORKSPACE_LIMIT`, using a local cross-encoder
(`NativeEmbeddingReranker`), query = `prompt + last 3 history prompts`, `catch → memories.slice(0,5)`.
Injection is `${systemPrompt}\n\n## Things I Remember About You\n- …`. Capture is a background job
(`server/jobs/extract-memories.js`) with a two-phase **Observer → Reflector** design, an idle
threshold (`MEMORY_IDLE_THRESHOLD_MS`, default 20 min) and `MIN_CHATS_TO_PROCESS = 5`.

**LibreChat — explicit-only writes, always-inject reads** [V]
`packages/api/src/agents/memory.ts:84-113`, the default memory-agent instructions:

> `Use the \`set_memory\` tool to save important information about the user, but ONLY when the user
> has requested you to remember something.`
> `2. NEVER store information just because the user mentioned it in conversation.`
> `When in doubt, and the user hasn't asked to remember or forget anything, END THE TURN IMMEDIATELY.`

and `memoryToolUsageGuard` (`:349`) repeats it. Reads: `createMemoryProcessor` returns
`withoutKeys` — the whole formatted memory set — for prompt insertion, with `totalTokens` accounting
against a configured `tokenLimit`. No selection step at all.

**goose — everything, in the extension instructions** [V]
`crates/goose-mcp/src/memory/mod.rs:115-142`: at construction it calls `retrieve_all(true, None)` and
appends `"\n\nGlobal Memories:\n"` plus every category and entry to the server `instructions`. Its
save policy: *"Save proactively when users share preferences, project configurations, workflow
patterns, or recurring commands. Always confirm with the user before saving."*

**Negatives worth recording** [V]: `anomalyco/opencode` at HEAD has no memory subsystem (the only
`memor` hit in 7,273 paths is `packages/app/src/context/tab-memory.ts`, UI tab state).
`continuedev/continue` (3,575 paths) and `Aider-AI/aider` (780 paths) have **zero** `memor*` source
files. Three of the eleven in-class peers deliberately ship no long-term memory.

---

## 2. Answer to Q2 — is an LLM filename-selector defensible at 30–300 topics?

### 2.1 The strongest new external evidence

**arXiv 2605.15184, "Is Grep All You Need? How Agent Harnesses Reshape Agentic Search"** (Sen,
Kasturi, Lumer, Gulati, Subbiah; submitted 2026-05-14; PwC) [V, read via arXiv HTML]. Experiment 1
runs a 116-question LongMemEval-S subset through a custom harness (Chronos) *and the provider CLIs
themselves* — Claude Code, Codex CLI, Gemini CLI — comparing grep vs vector retrieval, inline vs
file-based tool results. Table 1 overall accuracy (%):

| Model | Harness | Grep | Vector | Grep (programmatic) | Vector (programmatic) |
|---|---|---|---|---|---|
| Claude Opus 4.6 | Chronos | **93.1** | 83.6 | 80.2 | 81.9 |
| Claude Opus 4.6 | Claude Code | **76.7** | 75.0 | 68.1 | 79.3 |
| Claude Haiku 4.5 | Chronos | **83.6** | 76.7 | 83.6 | 81.9 |
| Claude Haiku 4.5 | Claude Code | **55.2** | 44.0 | 37.1 | 32.8 |
| GPT-5.4 | Chronos | **89.7** | 81.9 | 87.1 | 75.0 |
| GPT-5.4 | Codex CLI | **93.1** | 75.9 | 55.2 | 67.2 |
| Gemini 3.1 Pro | Chronos | **91.4** | 82.8 | 79.3 | 76.7 |
| Gemini 3.1 Flash-Lite | Chronos | **86.2** | 62.9 | 85.3 | 72.4 |

> *"Inline grep exceeds inline vector for every harness–model pair"* — and the authors' own limit:
> *"Conclusions are tied to long-memory conversational QA"* where answers depend on verbatim spans,
> lexical tools *"may be disproportionately helpful"*, and they *"do not claim that grep 'beats'
> vector in general."*

Experiment 2 (progressively mixing unrelated conversation history, s5→s30→Full) shows grep accuracy
essentially flat (e.g. Claude Code + Opus 4.6: 91.4 / 94.0 / 95.7 / 90.5 / 94.0) — **noise volume is
not the thing that breaks lexical recall at this scale.** Note honestly: vector on Chronos+Opus was
*higher* than grep in Experiment 2 (94.0 at s5 vs 89.3), so the effect is harness-conditional, exactly
as the authors say.

**Reading for our question:** the strongest published result does not compare "LLM selector over
metadata" against anything — it compares two *deterministic* retrievers driven agentically. What it
establishes is (a) **no-embeddings is a defensible v1 for a small text corpus**, which supports the
spec, and (b) **the harness matters more than the retrieval mechanism**, which is a caution: the
selector is a harness decision, and the paper's best configurations all put the search *in the main
model's loop*, not in a pre-answer side call.

Supporting, lower-weight: arXiv 2607.26637, *"Filesystem-Based Memory for LLM Agents: Organization,
Evolution, and Sustainability"* (Zhou et al., 2026-07-29) [R, abstract read] — *"organized stores
roughly halve retrieval cost where material is large"* but *"organization erodes for all but the
strongest management agent"* and **no tested agent converted organizational structure into better
answers.** That is a direct caution against assuming the index/topic topology pays for itself.

The vault's citation of LongMemEval / LoCoMo / Mem0 / A-Mem is **fairly represented** [V, re-read the
vault text] — it uses them to justify behavioral evaluation and to refuse graphs, which is what those
papers support. Nothing found contradicts that use. What is missing from the vault is 2605.15184,
which is a *stronger* argument for the same conclusion and additionally argues for a **lexical search
tool**, which the spec's non-goal list currently excludes ("BM25 index" — though a grep needs no
index, and Codex's shipped implementation is exactly that).

### 2.2 The strongest argument AGAINST the selector

**Measured on the owner's real corpus, 2026-08-16** [V]
(`/home/emma/.claude/projects/-home-emma-github-ctrl-b/memory`, read-only):

| Metric | Value |
|---|---|
| topic files (excl. `MEMORY.md`) | 56 |
| Claude-format manifest (`- name (ts): description` per topic) | **20,338 chars ≈ 5,084 tokens** |
| mean description length | **299 chars** |
| `MEMORY.md` index | 14,362 chars ≈ 3,590 tokens |
| corpus total | 302 KB, mean topic 5,395 bytes |

Three consequences:

1. **The manifest is the cost, and it is linear in corpus size and paid every substantive turn.**
   At 56 topics the selector's input is already ~5.1k tokens. At 200 topics with these description
   habits it is ~18k tokens; at 300, ~27k. Claude Code's `MAX_MEMORY_FILES = 200` is the ceiling
   that keeps this finite — and it is a **recency** cut (`sort((a,b) => b.mtimeMs - a.mtimeMs)
   .slice(0, 200)`), which the vault's own reviewers already flagged as able to hide old durable
   memory. **The spec inherits the problem but has removed the cap**, replacing it with "bounded
   candidate manifest … without excluding a durable topic solely because it is old" — a requirement
   with no stated mechanism. This is the design's largest unresolved number.
2. **Mean topic size (5.4 KB) exceeds Claude Code's per-topic surfacing cap (4,096 bytes)** — real
   topics in this corpus would arrive truncated. Whatever payload ceiling the spec picks, it should
   be picked against ~5 KB topics, not against a hypothetical 1 KB one.
3. **Ordering bug worth copying-in-reverse** [V]: Claude Code sends
   `` `Query: ${query}\n\nAvailable memories:\n${manifest}${toolsSection}` ``
   (`findRelevantMemories.ts:105`) — **query first, manifest last.** On a prefix-caching backend that
   means the selector call's prefix changes every turn and the (large, stable) manifest is
   re-processed from scratch each time. Reversing the order — manifest first, query last — makes the
   manifest a cacheable static prefix. For a local llama.cpp deployment this is the single cheapest
   optimisation available to the design, and it is a *divergence from* the reference implementation,
   not a copy of it.

Other arguments against, ranked:

- **Recall is capped by description quality, and only description quality.** The selector never sees
  topic bodies. A fact buried in a topic whose `description` doesn't mention it is unreachable — the
  vault records this as "description quality therefore becomes part of recall policy"; the field's
  answer (Kilo, Codex) is to let the model *search bodies* as a second step. The spec has no second
  step.
- **Precision bias is a deliberate recall sacrifice.** "Only include memories that you are certain
  will be helpful" + "empty is preferable" means silent misses are the *designed* failure. With no
  index injected (see §5) and no search tool, a miss is total: the model cannot even know the topic
  exists.
- **Latency and one extra call per turn** — see §3.
- **Keyword-overlap false positives are real enough that Anthropic shipped a carve-out for them**
  (`recentTools`, §1.3). A selector reading 300 one-line descriptions is doing fuzzy string matching
  with an LLM; it inherits lexical failure modes without lexical predictability.

### 2.3 Where it breaks down

- **≤ ~60 topics**: the mechanism is fine but arguably unnecessary — AnythingLLM's answer (cap the
  store, inject it all) is cheaper and lossless. At 56 topics × 299-char descriptions the *manifest
  alone* is 5k tokens; the whole `MEMORY.md` index is 3.6k. Injecting the index once into a cached
  prefix costs less than sending the manifest every turn.
- **~100–200 topics**: the selector is doing real work and the manifest (10–18k tokens/turn) is the
  dominant cost. This is the band where a selector genuinely beats always-inject.
- **≥ ~200–300 topics**: the manifest approaches the size of the thing it is avoiding loading, and
  Claude Code's own answer is a hard 200-file recency cut. Beyond this the design needs either a
  deterministic pre-filter (which is a lexical index by another name) or hierarchical routing.

**Verdict on Q2:** defensible, but not on the grounds the spec gives. It is defensible as *"no
embeddings, no index to maintain, markdown stays the source of truth"* — a claim 2605.15184 supports.
It is **not** well-supported as *"the selector is what makes first-answer recall reliable"*, because
the field's two newest implementations get first-answer recall from an always-injected index plus an
in-loop search, at zero extra completions per turn.

---

## 3. Answer to Q3 — pre-answer blocking recall and latency

### 3.1 Who blocks the first token

| Project | Blocks first token? | On what |
|---|---|---|
| Claude Code | **No** [V] | prefetch runs concurrently; consumed post-tools |
| Codex CLI | No (in-loop tool calls delay the answer, but the model chooses) [V] | — |
| Kilo Code | No [V] | — |
| goose / LibreChat / Letta | No (DB/file read only) [V] | — |
| AnythingLLM | **Yes** [V] | local cross-encoder rerank (no LLM completion) |
| open-webui | **Yes** [V] | embedding + vector query (no LLM completion for *memory*) |
| open-webui (RAG/web-search path) | **Yes** [V] | `generate_queries` — a genuine blocking **task-model completion** before retrieval |

**No project in the reference class blocks the first token on an auxiliary LLM completion for memory
selection.** The nearest thing in the field is open-webui's `generate_queries` for web-search/RAG —
which proves the pattern is shippable, and also shows how it is done badly: I found **no timeout at
all** on that call [V, grep of `middleware.py`]; the only guard is `try/except` with a fallback to
"use the raw user message as the search query". The spec's *finite timeout* is therefore **stricter
than field practice**, not looser.

### 3.2 Claude Code's deliberate non-blocking, and its instrumentation

`src/utils/attachments.ts:2334-2422` [V]:

> `A memory relevance-selector prefetch handle. The promise is started once per user turn and runs
> while the main model streams and tools execute. At the collect point (post-tools), the caller reads
> settledAt to consume-if-ready or skip-and-retry-next-iteration — the prefetch never blocks the turn.`

And, crucially, they **measure the miss**:

```ts
logEvent('tengu_memdir_prefetch_collected', {
  hidden_by_first_iteration:
    handle.settledAt !== null && handle.consumedOnIteration === 0,
  consumed_on_iteration: handle.consumedOnIteration,
  latency_ms: (handle.settledAt ?? Date.now()) - firedAt,
})
```

`hidden_by_first_iteration` is a named telemetry field for exactly the defect the spec exists to fix.
So: the miss is known, quantified, and accepted upstream — the spec's decision to block instead is a
**real, defensible divergence**, but it trades a known-and-measured recall miss for an
unknown-and-unmeasured latency tax. Whichever way it goes, ctrl-b should carry the equivalent metric.

Two more deterministic gates worth copying [V]: the prefetch is skipped when the prompt has no
whitespace (`if (!input || !/\s/.test(input.trim())) return undefined` — *"Single-word prompts lack
enough context for meaningful term extraction"*), and when the session's cumulative surfaced bytes
hit `MAX_SESSION_BYTES: 60 * 1024`. The session cap comment records a measured production number:
*"over a long session the selector keeps surfacing distinct files — **~26K tokens/session observed in
prod**."*

### 3.3 Latency budgets

Field numbers for interactive voice [R — secondary sources, converging]:
human turn-taking gap ≈ **239 ms** median across languages; **<500 ms** reads as conversational;
500–800 ms is a noticeable but tolerable pause; >1,500 ms "feels broken"; typical stitched pipelines
budget **150–400 ms for LLM time-to-first-token** inside a ~600 ms total, and production voice agents
today sit at P50 **1.4–1.7 s**.

Applied to a pre-answer selector on ctrl-b's local stack: the selector call is prefill-dominated
(≈5k manifest tokens at 56 topics) plus ≤256 output tokens. On a 3060-class box that is realistically
**several hundred ms to >1 s of pure added TTFT**, on the front of every substantive turn, and it
lands entirely inside the voice budget. **The design's finite timeout is therefore load-bearing, and
the timeout value should be derived from the voice budget (a few hundred ms), not from a
"the call usually finishes" intuition** — meaning the common case must be *fast*, not merely bounded.

Failure handling in the field [V]: Claude Code → `return []` (fail closed, no recall);
open-webui → swallow, keep the always-inject lanes; AnythingLLM → fall back to most-recent-N.
Note the shape: **two of three degrade to a non-empty fallback, not to nothing.** The spec's
"empty is valid" is the strictest of the three and pairs badly with also not injecting the index.

---

## 4. Answer to Q4 — prompt-cache interaction

### 4.1 llama.cpp mechanics, verified at HEAD

From `tools/server/README.md` @ `ggml-org/llama.cpp` `4df29be4f4c3` (2026-08-16) [V]:

- `cache_prompt` default **true**: *"Re-use KV cache from a previous request if possible. This way the
  common prefix does not have to be re-processed, only the suffix that differs between the requests."*
  Matching is **prefix** matching — any byte change in the head invalidates everything after it.
- `-cram, --cache-ram N` — *"set the maximum cache size in MiB (**default: 8192**, -1 - no limit,
  0 - disable)"* — a **host-RAM prompt cache**, on by default.
- `--cache-idle-slots` — *"save idle slots to the prompt cache on new task … (**default: enabled**,
  requires cache-ram)"*.
- `-sps, --slot-prompt-similarity` default **0.10**.
- Per-response telemetry: `timings.cache_n` — *"number of prompt tokens reused from cache"* — beside
  `prompt_n`; `prompt_n + cache_n + predicted_n` = total context tokens.

**This is a correction to a likely premise.** The host-memory cache (PR #16391) was built for
precisely this workload; the PR states the feature *"significantly improves the experience"* for
agentic workflows like Claude Code where *"a single large context with various auxiliary calls … are
interleaved"*, and it keeps **"extra slots" in host memory selected by prefix similarity** [R — PR
description read via fetch, not source-verified]. So on a current llama-server, a per-turn auxiliary
selector call does **not** permanently destroy the main conversation's KV cache the way a single-slot
mental model suggests. The residual costs are the selector's own prefill (§2.2) and RAM.

### 4.2 Where to put per-turn variable context

The field splits cleanly, and the split is the whole answer:

| Placement | Who | Cache consequence |
|---|---|---|
| **User-message side, hidden/meta** | Claude Code (`wrapMessagesInSystemReminder` + `isMeta` user messages), Hermes (`api_content` sidecar, per vault) | static system prefix survives; each turn appends |
| **System-prompt tail, rewritten each turn** | open-webui (`add_or_update_system_message(..., append=True)` after excising the previous `<memory_context>`), AnythingLLM (`${systemPrompt}\n\n## Things I Remember About You`) | **full re-prefill every turn** on a prefix-matching backend |
| **Developer instructions, stable across the session** | Codex (`memory_summary.md` built once) | fine — it is static |

Field failure report [R]: `openclaw/openclaw#20430`, *"Per-message metadata in system prompt
invalidates llama.cpp KV cache every turn"* — *"the KV cache works by matching the token prefix
byte-for-byte. Any change in the system prompt (first message in the conversation) shifts the entire
token sequence and forces a full reprocessing of the entire context."* Accepted remedies listed:
move per-message metadata **to the final user message**, or a provider-level `stableSystemPrompt`
flag. (Issue closed; the merged fix was not identifiable from the page. open-claw is general
reference only per the owner's standing note — cited here for the *mechanism*, not its design
choices.)

Claude Code additionally freezes the rendered bytes of an already-surfaced memory attachment
*"so the rendered bytes are stable across turns (prompt-cache hit)"* (`messages.ts:3712-3715`) — i.e.
even user-side injection must be **byte-stable on replay**, or the cache breaks one message later.
Note the interaction with the spec's freshness/age labelling: a header computed as "47 days ago" at
render time would change bytes on a later turn. Claude Code solves this by storing the header at
attachment-creation time and only recomputing for resumed sessions that predate the stored field.

**Verdict on Q4:** the spec's choice — inject selected topics as *user-side delimited data* — is the
field-correct one and matches both Claude Code and Hermes. Two riders: (a) the injected block must be
**byte-stable across replays** (freeze the freshness header at creation), and (b) order the
*selector's own* prompt manifest-first/query-last so the aux call is itself cacheable.

---

## 5. Answer to Q5 — gaps and risks

### 5.1 Things the field does that v1 excludes and would genuinely be missed

1. **An always-injected bounded routing index.** [V] This is the biggest divergence and the one I
   would change. `SPEC.md` §2: *"`MEMORY.md` is retrieval-routing input. V1 does not automatically
   inject the full index into the main model's context."* **Every peer with an index injects it**:
   Codex (`memory_summary.md` → developer instructions), Kilo (8 KiB block), Claude Code in the
   ordinary cohort (`AutoMem` via the CLAUDE.md pipeline as hidden user context — the vault records
   this correctly). Suppressing the index is a *feature-flagged experimental variant*
   (`tengu_moth_copse`) in the one system that has it, and the vault's own audit records that this
   variant "magnif[ies] that first-response timing gap". The spec has therefore adopted the
   experimental half of Claude Code's design while fixing only its other half. Cost of the omission:
   when the selector abstains or times out, the model has **no idea the memory exists** — it cannot
   ask, cannot search, cannot tell the user "I may have something on that". An always-injected index
   is also *cache-friendly*: it sits once in the static prefix rather than being re-sent as a manifest
   every turn.
2. **A deterministic search escape hatch.** [V] Codex ships literal multi-query search with match
   windows; Kilo ships a 4-mode keyword tool and *documents its own failure mode to the model*;
   Anthropic's platform memory tool ships `view`/`view_range` over the directory. The spec's tool
   list includes "explicit recall through the same retrieval path as automatic recall" — i.e. explicit
   recall is *another selector call*, which inherits the description-only ceiling. A grep over topic
   bodies is ~30 lines of Python, adds no index, no dependency, and no migration, and is exactly what
   the strongest published evidence (§2.1) endorses. It is not "BM25" and should not be barred by that
   non-goal.
3. **Consolidation, in some form.** [V] Every system that accepts model-written memory pairs it with
   either consolidation or a hard cap: Claude Code (`autoDream`), Codex (stage1 → phase2 + jobs
   table), Kilo (`typed-consolidation.txt`), open-webui (background review every N turns),
   AnythingLLM (Observer → Reflector, *plus* a 25-item hard cap). **5/5.** The spec bans *scheduled*
   consolidation, which is the right call at N=1 — but it should not leave the corpus with no
   compaction path at all. The cheapest field-compatible substitutes, in order: (a) a **hard corpus
   cap** with an explicit over-cap failure (AnythingLLM's answer, and it makes the manifest bound
   *provable* rather than aspirational); (b) an **owner-invoked** consolidation command (not
   scheduled, not background — the owner runs it, the model rewrites topics under the same write
   contract).
4. **Pre-feeding the manifest to the WRITE path.** [V] "Update rather than duplicate" only works if
   the writer knows what exists. Claude Code makes this explicit in `memoryScan.ts:26-28`: the scan is
   *"Shared by findRelevantMemories (query-time recall) and extractMemories (**pre-injects the listing
   so the extraction agent doesn't spend a turn on `ls`**)"*. The spec lists "bounded inspection of
   the index/topics" as a tool capability but does not require the manifest to be present at write
   time. It should — otherwise update-over-duplicate degrades to create-a-near-duplicate, and with
   no consolidation nothing ever repairs it.
5. **Use-provenance.** [V] Codex requires a `<oai-mem-citation>` block naming file + line range +
   how the memory was used; Claude Code fires `logMemoryRecallShape(memories, selected)` on *every*
   selection *"even on empty selection: selection-rate needs the denominator"*. Neither is a v1
   requirement, but the second is nearly free and is the only way to answer "is this lane earning its
   tokens?" — which at 5k tokens/turn is the question that decides whether the lane stays.
6. **A verification policy, not just a staleness label.** [V] Codex's read_path.md reasons about
   *drift risk vs verification effort* and requires the model to say when an answer is memory-derived
   and unverified. The spec's authority ladder is correct but purely ordinal; this is the operational
   half.

### 5.2 Things the spec includes that the field has moved away from

- **Proactive model-judged capture.** The spec's P1 covers "eligibility … remember/forget/ignore
  intent" as semantic judgments. Two peers have explicitly reversed to **explicit-request-only**:
  LibreChat (*"NEVER store information just because the user mentioned it in conversation"*, and a
  second `memoryToolUsageGuard` repeating it) and Codex (*"You can update the memories **only** when
  explicitly asked by the user"*). goose sits in between (*"Save proactively … Always confirm with
  the user before saving"*). Claude Code remains proactive — but it is also the only one with a
  consolidation pass to clean up after itself. Given that the spec bans consolidation, the
  explicit-only posture is the coherent pairing. **Proactive capture + no consolidation is the one
  combination nobody in the field runs.**
- **Selector-only recall with no index and no search.** Covered above; nobody ships this shape.

### 5.3 Things the spec gets right that the field mostly doesn't

- **Fallible-data delimiting with an explicit authority boundary** — Kilo independently arrived at
  the same idea, encoding it in the fence tag itself (`kilo-memory-v1 context_not_instruction`).
- **A finite timeout on the auxiliary call** — stricter than open-webui, which has none [V].
- **Expected-prior-state (compare-and-swap) on destructive writes** — no peer does this; Anthropic's
  platform tool gets the same effect from `str_replace` semantics with a "did not appear verbatim"
  error, which is the same idea in a smaller shape [V].
- **`skip_memory` suppressing the whole lane including the selector call** — matches the field's
  layered gating (Claude Code: `isAutoMemoryEnabled()` **and** a feature flag **and** a session-byte
  cap, all checked before the prefetch is created).

---

## 6. Corrections to premises in the vault spec

| # | Premise in `SPEC.md` / `LOG.md` | Correction (all 2026-08-16) |
|---|---|---|
| 1 | §4 rationale table: *"Voluntary recall misses; full-corpus injection bloats prompts"* justifies the pre-answer selector as the only alternative to those two | **False dichotomy.** The field's dominant third option is *bounded index always injected + model-driven search*: Codex CLI, Kilo Code, Anthropic's platform memory tool, Letta. Anthropic's productized answer to "voluntary recall misses" is a platform-injected mandatory instruction — *"IMPORTANT: ALWAYS VIEW YOUR MEMORY DIRECTORY BEFORE DOING ANYTHING ELSE"* — not a selector. [V, docs] |
| 2 | §2: *"V1 does not automatically inject the full index"* | Diverges from **every** peer with an index, and adopts the behavior of Claude Code's experimental `tengu_moth_copse` cohort — the one the vault's own audit says *magnifies* the first-response gap. [V] |
| 3 | The survey treats Codex CLI and Kilo Code as having no memory system (both absent from the LOG) | Both shipped one since. `codex-rs/ext/memories` (summary-in-developer-instructions + literal search tools + SQLite-backed two-stage background consolidation + citation protocol) and `packages/kilo-memory` (8 KiB index + 4-mode keyword recall tool + typed consolidation). Both are **in-class, current, and chose the opposite mechanism**. [V] |
| 4 | Selector cost is treated qualitatively ("bounded manifest") | Measured on the owner's own 56-topic Claude corpus: manifest = **20,338 chars ≈ 5,084 tokens per turn**, mean description 299 chars, mean topic body 5,395 bytes (i.e. above Claude Code's 4 KiB per-topic injection cap). Linear extrapolation: 200 topics ≈ 18k tokens/turn. [V] |
| 5 | "Bounded candidate manifest … without excluding a durable topic solely because it is old" is stated as a requirement | Claude Code's bound **is** a recency cut (`sort by mtime desc → slice(0, 200)`). Removing the recency cut while keeping the manifest bounded requires a mechanism the spec does not name. Open. [V] |
| 6 | Prompt-cache risk of the auxiliary call | llama.cpp ships a host-RAM prompt cache **on by default** (`-cram` 8192 MiB) with `--cache-idle-slots` enabled, added explicitly for *"a single large context with various auxiliary calls … interleaved"*. The aux call is much cheaper than a single-slot model predicts. The real cache risks are (a) any per-turn rewrite of the system prefix and (b) the selector's own query-first prompt ordering. [V for the flags, R for the PR rationale] |
| 7 | "one logical selector invocation" copies Claude Code's prompt shape | Copying it verbatim copies a cache-hostile ordering: `Query: …\n\nAvailable memories:\n{manifest}` puts the volatile part first. Invert it. [V] |
| 8 | The LOG's citation of LongMemEval / LoCoMo / Mem0 / A-Mem | Fairly represented — no contradiction found. But **newer and more decisive**: arXiv 2605.15184 (2026-05) measures grep vs vector *inside Claude Code and Codex CLI* on LongMemEval-S; inline grep beats inline vector for every harness–model pair. It strengthens "no embeddings", and simultaneously argues for a lexical **search tool** the spec's non-goals appear to bar. [V] |
| 9 | Repo identities used throughout the vault/dossier corpus | `sst/opencode` → **`anomalyco/opencode`**; `block/goose` → **`aaif-goose/goose`** (301, API returns a null body under the old names). [V] |

---

## 7. Implications for ctrl-b (short; ages fast)

1. **The direction is sound; the selector is the weakest link, and it is optional.** A shared markdown
   corpus with `name`/`description` frontmatter, one mutation tool with expected-prior-state,
   user-side delimited injection, no DB/vector/graph — that is field-correct and matches where the
   newest in-class peers landed. What the peers did *not* do is put an auxiliary LLM completion in
   front of the first token.
2. **The cheapest change with the largest expected gain: inject the index, add a grep.** An
   always-injected `MEMORY.md` (capped — Kilo says 8 KiB, Claude Code caps its entrypoint at
   200 lines / 25,000 bytes) sits in ctrl-b's *cached* system/prefix once, not 5k tokens per turn;
   a literal-search tool over topic bodies closes the description-only recall ceiling. Together they
   are strictly cheaper than the selector and cover its failure modes. If the selector still earns its
   place after that, keep it — but it becomes a latency optimisation, not the mechanism.
3. **ctrl-b already has a prompt-cache problem the new lane must not join.** `session.py:633–646`
   (`_static_prefix`; *main-seat corrected cite — the dossier originally said 520–526*)
   injects the memory block as its own `system` message, read fresh per turn from live files —
   and `STATE.md` (D27 `StoreSemantics.SET`) can change mid-session. On llama.cpp that is a full
   re-prefill of the conversation on every memory write. *(Main-seat note: this is a **known, ruled**
   trade-off, not a discovery — ROADMAP §B1's A9 rider records the owner's 2026-07-20 ruling to keep
   per-turn reads, with `cache_n`/`prompt_n` measurement as the escalation trigger. Still worth the
   Track P measurement.)* A second lane should inject byte-stable content and never rewrite the
   system head per-turn.
4. **Bound the corpus explicitly, or the manifest bound is fiction.** AnythingLLM's 5+20 cap is the
   honest version. Pair it with an owner-invoked consolidation command (not scheduled — that stays a
   non-goal) and pre-feed the manifest to the write path so update-over-duplicate can actually work.
5. **Pair the write posture to the consolidation posture.** No consolidation ⇒ explicit-request-only
   writes (LibreChat/Codex posture). Proactive capture without a cleanup pass is the one combination
   the field does not run.
6. **Instrument from day one, cheaply**: selection rate with its denominator (Claude Code fires
   telemetry *"even on empty selection"*), selector latency, tokens spent on manifest+payload per
   turn, and `timings.cache_n`. At ~5k tokens/turn the lane must be able to prove it earns them.
7. **Latency budget is the voice budget.** Human turn gap ≈239 ms; <500 ms reads as conversational.
   A pre-answer selector on a 3060 spends its whole allowance on prefill. If the selector ships, its
   timeout should be a few hundred ms with fail-open-to-index behavior, not a generous ceiling.

## 8. Not bought / still open

- **[U] Live Claude Code behavior in 2026-08.** The local mirror is 2026-04-05. Whether the selector,
  the 200/5/4 KiB caps, the `tengu_moth_copse` index-suppression cohort, or `autoDream` still look
  like this upstream is unverified.
- **[U] Measured selector latency on ctrl-b's own local models.** Nobody publishes this; it needs a
  probe: 5k-token manifest prefill + 256 output tokens against the owner's llama.cpp route, cold and
  warm, with `timings.cache_n` captured.
- **[U] Whether llama.cpp's host-RAM cache actually holds two interleaved prefixes** under ctrl-b's
  server flags. The PR says it is designed to; not probed here. One `curl` loop would settle it.
- **[R only] Mem0 / Zep / LangMem internals.** Treated as supplements per the brief; not source-read.
  The relevant field fact — nobody in the *in-class* set uses them — is verified.
- **arXiv 2607.26637** read at abstract level only; its per-configuration numbers were not extracted.
- No timing/accuracy comparison exists anywhere, that I could find, between an **LLM-selector over
  metadata** and **grep over bodies** on the same corpus. That is the experiment this design would
  most benefit from, and it is cheap to run locally on the 56-topic corpus measured in §2.2.
