# R53 — Truncated tool reads: why the field caps them, how it lets the model recover, and what guards a destructive op against a partial view

**Date:** 2026-08-21
**Status:** Evidence dossier — complete for the bounded question. §9 is a **proposal for the main seat
to judge**, not a decision.
**What drove it:** the 2026-08-20 consolidation incident (CORE_MEMORY_PLAN §14d lineage) — a
`core_memory` run read an 11,107-char topic clamped to `topic_char_limit` 8,192, merged from that
**73.8%** view, and deleted the original. Content loss, recoverable only from the D61 soft-delete
archive. Owner's question, verbatim: *"why do reads have to be truncated? does that happen in Claude
Code and such? what solution can you find?"*
**Drove:** (open) — no D-entry yet. Adjacent: [R44](./R44-memory-destructive-op-guards.md)
(destructive-op guards), [R43](./R43-tool-output-retention-field.md) (retention + spill-to-file),
[R38](./R38-selective-memory-recall-field.md) (index + grep recall).

**Confidence markers used on every finding:** **VERIFIED** = source read at the pinned SHA below,
probed first-hand in this session, or read in the shipped docs. **REPORTED** = secondary source.
**UNVERIFIED** = expected but not checked.

---

## 0. Sources, pinned

| Project / spec | Ref | SHA | Read |
|---|---|---|---|
| **Claude Code's own Read/Edit/Write tools** | this session's harness (client 2.1.233) | — first-hand probe | 2026-08-21 |
| openai/codex (incl. `codex-rs/ext/memories`) | main | `51ebf5b1842d44a8e2c955e8b5cd2a589d41e71e` | 2026-08-21 |
| anomalyco/opencode | main | `1b937c860b6fd8a83e69f916b1236515aa17ea0d` | 2026-08-21 |
| aaif-goose/goose | main | `45b322c1df30295caaceb23a8a043fc9fa032527` | 2026-08-21 |
| letta-ai/letta-code | main | `a992ce362726e34d8047eb4bc6202ec83f475ebf` | 2026-08-21 |
| letta-ai/letta (**`archive` branch** — the retired V1 server / MemGPT lineage) | archive | `56ba9c25552605eec89de8ed3dc6394b625c1993` | 2026-08-21 |
| Aider-AI/aider | main | `5dc9490bb35f9729ef2c95d00a19ccd30c26339c` (HEAD **2026-05-22** — quasi-dormant) | 2026-08-21 |
| Anthropic memory tool docs (`memory_20250818`) | platform.claude.com `.md` source | fetched | 2026-08-21 |
| ctrl-b working tree | `main` @ `8504c4c` | — | 2026-08-21 |

**Corrections to stale premises in the brief** (VERIFIED): `letta-ai/letta` is a landing page since
2026-08-16 — the V1 server (core-memory blocks, archival paging, `memory_replace`) lives on its
`archive` branch, and current development is `letta-ai/letta-code`. Both were read. Clones were made
under `TMPDIR=/home/emma/.cache/tmp` and deleted at the end of the pass. (Op note: four of the six
clones initially landed in the repo root from a shell-quoting slip and were moved out before any
commit; `git status` was verified clean.)

---

## 1. Headline

**Ten lines:**

1. **Every peer caps a read. The cap is not the divergence — the *recovery path* is.** 5/6 pair the
   cap with explicit paging parameters; ctrl-b's `read` has none.
2. **Anthropic's own memory tool prescribes exactly the missing half, in one sentence:** *"Consider
   capping how many characters the `view` command returns, and **let Claude page through the rest
   with `view_range`**."*
3. Numbers, per read: **Claude Code 25,000 tokens** (token-budgeted, adaptive page size, first-hand
   probe) · **Codex memory tool 20,000 tokens** + `line_offset`/`max_lines` · **Codex shell output
   10,000 bytes** (middle-truncated) · **opencode 2,000 lines / 50 KB / 2,000 chars-per-line** ·
   **letta-code 2,000 lines / 30,000 chars** · **Anthropic memory `view` 16,000 chars** ·
   **goose: no cap at all** · **aider: no read tool — refuses at the window instead**.
4. **The best truncation markers name the continuation call.** Claude Code's says
   `Call Read with offset=981 limit=980 for the next page` **and** *"Do NOT answer from this page
   alone."* Letta V1's says *"use functions to view the full content."*
5. Codex and opencode carry truncation as a **structured field**, not marker prose — `{truncated:
   bool, next: <offset>}` — and Codex feeds it to telemetry (`truncated_tag`).
6. **Letta's answer to "why truncate at all" is: don't.** Core-memory blocks are injected whole and
   uncapped; the hard block limit was deleted upstream. There is no memory read tool to truncate.
7. **A partial read never blocks a destructive op anywhere. 0/6.** Grep-verified: `truncated` never
   appears in any peer's edit/write/delete path.
8. **First-hand, in this harness:** Claude Code's read-before-edit rail is **file-granular, not
   range-granular** — I edited a line I had never seen in any returned page, and it succeeded.
9. The field's real guards are a different shape: **uniqueness-checked `old_str`** (4/4 memory
   systems), **whole-file byte CAS at write time** (opencode), **required `reason`** (letta-code),
   **no delete verb at all** (Codex).
10. **Codex's memory tool exposes zero mutations to the model** — *"Do not try to edit the memory
    files yourself, only add one update note"* — which makes the partial-read-then-delete hazard
    structurally impossible rather than guarded.

---

## 2. ctrl-b's seams as they stand (VERIFIED — read at `8504c4c`)

Read first, so the findings land on real code.

| Seam | File:line | Shape today |
|---|---|---|
| The cap | `backend/app/config.py:412` | `topic_char_limit: int = Field(default=4096, ge=1)` — dev runs **8192** (HANDOFF) |
| The read | `services/agent/core_memory.py:546-570` | `read_topic()` → `CoreRead(path, text=raw[:cap], content_hash=sha256(**full bytes**), chars=len(raw), truncated=len(raw)>cap)` |
| **No paging** | `services/agent/core_memory_tool.py:60-125` | The tool schema has `path/query/name/description/type/content/old_text/new_text/content_hash/superseded_by/reason` — **no `offset`, no `limit`** |
| The marker | `core_memory_tool.py:264-267` | `f"{read.path} — content_hash: {read.content_hash}"` + `f" (truncated: showing {len(read.text):,} of {read.chars:,} characters)"` |
| Delete CAS | `core_memory_tool.py:107-109, 252` | `delete` requires `content_hash` = *"the `content_hash` the last `read` of this topic returned"*, plus `superseded_by` **XOR** `reason` |
| Search clamp | `core_memory.py:577-620` | Per-hit cost accounting against the same `topic_char_limit`, oversized hits **skipped not fatal**, `omitted` counted (D61 ⑤) |

**Premise correction, and it matters for the fix:** the brief says the read *"silently truncates."*
It does not. The marker has shipped since `ced9056` (S3, 2026-08-17) and states both figures. The
defect is narrower and more actionable:

> **ctrl-b's truncation is announced but *unrecoverable*.** The model is told 2,915 characters are
> missing and given no verb that can fetch them. The only in-band escapes are a `search` for a
> phrase it cannot see, or an owner config edit. The full-file `content_hash` then certifies a
> delete of bytes the model never received.

The field's fix for this exact shape is uniformly the same: **add the page parameter, not a bigger
cap.** §3 is the evidence; §9 the proposal.

---

## 3. Claude Code's Read tool — first-hand contract (VERIFIED, probed this session)

The most direct answer to the owner's *"does that happen in Claude Code and such?"* — **yes, and
this is what it looks like from the model's side.**

Reading `backend/app/services/agent/session.py` (2,886 lines) with no parameters returned lines
1–980, then, verbatim:

```
[Truncated: PARTIAL view — /home/emma/github/ctrl-b/backend/app/services/agent/session.py:
showing lines 1-980 of 2886 total (62516 tokens, cap 25000). Call Read with offset=981 limit=980
for the next page, or Grep to find a specific section. Do NOT answer from this page alone if the
answer may be further in the file.]
```

Everything load-bearing about the field's best-in-class design is in that one marker:

| Property | Value | Why it matters |
|---|---|---|
| Cap unit | **tokens** (`cap 25000`), not lines or bytes | The tool description separately advertises *"Reads up to 2000 lines by default"* — but the observed cut was token-driven at line 980. The **binding** cap is the context budget; the line cap is a secondary ceiling. |
| Page size | **adaptive** — `limit=980` is exactly what fit | The tool computes the page, then hands the model the number. No arithmetic on the model's side. |
| Both totals | `980 of 2886` lines **and** `62516 tokens` | Two units, so the model can price the remaining work. |
| **The continuation call is spelled out** | `Call Read with offset=981 limit=980` | Not "you can page" — the literal next invocation. |
| An alternative is offered | `or Grep to find a specific section` | Paging is not the only escape; targeted retrieval is named beside it. |
| **A behavioral instruction rides the marker** | *"Do NOT answer from this page alone if the answer may be further in the file."* | The marker is not just metadata; it carries the *rule the incident violated.* |

Further probes, all VERIFIED first-hand:

- **`offset` alone works and needs no `limit`** — `Read(offset=2900)` on a 3,000-line file returned
  2900–3000 cleanly.
- **The marker appears only when content was cut.** A read that reaches EOF carries no marker at
  all — no "complete" affirmation, so *absence of the marker is the completeness signal.*
- **A 5,000-character single line was returned intact** — no per-line clamp fired at that length in
  this harness version (opencode and letta-code both clamp at 2,000 chars/line; ctrl-b clamps
  excerpt lines at `_EXCERPT_CHARS` in `search` only).
- **The external-modification notice truncates too** (`... [2068 lines truncated] ...`) — the same
  discipline applied to the harness's own out-of-band messages.

### 3b. Claude Code's read-before-mutate rail — and its granularity (VERIFIED, probed)

The Edit tool's contract states: *"You must Read the file in this conversation before editing, or
the call will fail."* That is a genuine read-before-write rail. **It is file-granular.**

Probe: read a 3,000-line file with `offset=2900` (returning lines 2900–3000 only), then
`Edit(old_string="L5\n", …)` — a line that appeared in **no** returned page. Result:

> `The file … has been updated successfully.`

So the rail answers *"has this file been read at all in this conversation?"*, never *"did the model
see the bytes it is replacing?"* A second probe found `Write` overwriting a 3,000-line file created
in-session without a prior Read — the documented overwrite rail did not fire there (ambiguous:
the file was created by this session's own Bash, so the harness may already consider it known;
recorded as **UNVERIFIED** for the general case).

A third probe: modifying a read file externally mid-session produced a system notice that **re-synced
the model's view** rather than refusing the next edit. **Claude Code refreshes; it does not refuse.**

**The lesson for ctrl-b is a negative one, and it is the most important single line in this dossier:**
the state-of-the-art coding harness ships an excellent *communication* contract on truncated reads
and **no completeness precondition whatsoever on the mutation that follows.** Guarding delete on
read-completeness would be a ctrl-b invention. §9 proposes it anyway, and says so plainly.

---

## 4. Anthropic's memory tool (`memory_20250818`) — the closest official prescription (VERIFIED, docs)

The `memory` tool type is the API-level analogue of ctrl-b's `core_memory`: commands
`view · create · str_replace · insert · delete · rename` over a `/memories` directory, executed
client-side.

**`view` takes a range parameter:**

```json
{ "command": "view", "path": "/memories/notes.txt", "view_range": [1, 10] }
```

> *"`view_range` is optional and applies to text-file views: `[start_line, end_line]` returns those
> lines, and `[start_line, -1]` returns everything from `start_line` to the end of the file."*

**The cap and the paging are prescribed together.** From §Security considerations → File storage size:

> *"Track memory file sizes and cap how large a file can grow. **Consider capping how many characters
> the `view` command returns, and let Claude page through the rest with `view_range`.**"*

That single sentence is the field's answer to the owner's question, from the vendor of the model
ctrl-b's memory design was reverse-engineered from (R37/R40).

**The number the model is told:**

> *"Claude's tool description also says that `view` displays image files (.jpg, .jpeg, and .png) and
> **truncates the text view of files longer than 16,000 characters**. Expect `view` calls on image
> paths and **follow-up ranged views of long files**."*

So **16,000 characters** is the model's trained expectation, and *the docs explicitly anticipate the
follow-up ranged read* — i.e. the model is trained to page when it sees the cut.

**What makes `view_range` addressable:** `view` returns line-numbered content — 6-char right-aligned,
tab-separated, 1-indexed, with a `"Here's the content of {path} with line numbers:"` header, and a
hard error above 999,999 lines. The numbers exist *so the next call can reference them.* (Letta V1
does the same and pairs it with a `CORE_MEMORY_LINE_NUMBER_WARNING` telling the model the numbers are
display-only — see §6.)

**And the destructive side (VERIFIED):**

| Command | Precondition |
|---|---|
| `str_replace` | `old_str` must appear **exactly once**. Zero → ``"No replacement was performed, old_str `…` did not appear verbatim in {path}."`` More than one → ``"…Multiple occurrences of old_str `…` in lines: {line_numbers}. Please ensure it is unique"`` |
| `delete` | **None.** `"Successfully deleted {path}"`. Recursive on directories. Only guard: reject deleting the `/memories` root. No hash, no version, no completeness check. |
| `rename` | Refuses if destination exists (no silent overwrite) |

So Anthropic's own memory tool: **paged reads, uniqueness-checked edits, unguarded deletes.**

---

## 5. Codex CLI — two separate systems, and the memory one is the good analogue

### 5a. `ext/memories` — a memory read tool with paging parameters (VERIFIED)

The closest structural twin to ctrl-b's `core_memory` read. Its argument struct, verbatim
(`ext/memories/src/tools/read.rs:25-32`):

```rust
struct ReadArgs {
    path: String,
    #[schemars(range(min = 1))]
    line_offset: Option<usize>,
    #[schemars(range(min = 1))]
    max_lines: Option<usize>,
}
```

Tool description: *"Read a Codex memory file by relative path, **optionally starting at a 1-indexed
line offset and limiting the number of lines returned**."*

| Constant | Value | Source |
|---|---|---|
| `DEFAULT_READ_MAX_TOKENS` | **20,000** | `ext/memories/src/lib.rs:15` |
| `DEFAULT_LIST_MAX_RESULTS` / `MAX_LIST_RESULTS` | 2,000 / 2,000 | `lib.rs:11-12` |
| `DEFAULT_SEARCH_MAX_RESULTS` / `MAX_SEARCH_RESULTS` | 200 / 200 | `lib.rs:13-14` |
| `MEMORY_TOOL_DEVELOPER_INSTRUCTIONS_SUMMARY_TOKEN_LIMIT` | 2,500 | `lib.rs:16` |

**Truncation is a structured response field, not marker prose** (`backend.rs:70-77`):

```rust
pub struct ReadMemoryResponse { pub path: String, pub start_line_number: usize,
                                pub content: String, pub truncated: bool }
```

`start_line_number` echoes back where the page began — the response is self-describing, so the model
never has to track its own cursor. `list` and `search` use **opaque cursors** instead
(`MemoriesBackendError::invalid_cursor`), with `truncated = next_cursor.is_some()`.

Two details worth stealing:

- **Past-EOF offsets are refused, not silently empty** — `MemoriesBackendError::LineOffsetExceedsFileLength`
  (`local/read.rs:63-70`). A model that mis-pages gets an error, not a false "nothing more here."
- **Truncation rate is measured.** `record_tool_call(..., truncated_tag(response.truncated))`
  (`tools/read.rs:80-88`) — Codex instruments how often reads get cut. ctrl-b's `omitted` counter
  (D61 ⑤) is the same instinct on the search half.

**The mutation surface is empty.** The backend trait has exactly four methods —
`add_ad_hoc_note · list · read · search` (`backend.rs:13-33`) — and the memory instruction template
tells the model, verbatim (`templates/memories/read_path.md`):

> *"You can update the memories **only** when explicitly asked by the user. … **Do not try to edit
> the memory files yourself, only add one update note** in `{{ base_path }}/extensions/ad_hoc/notes/`."*

Codex's memory agent is **read-mostly by construction**: the partial-read-then-delete hazard cannot
occur because there is no delete. It also requires **line-range citations** for anything it used
(`MEMORY.md:234-236|note=[…]`) — evidence of use, addressed by the same coordinates `read` pages on.

### 5b. Codex's *file* reads — shell output, middle-truncated, no paging (VERIFIED)

Codex has no general `read_file` tool; files are read via `shell` (`sed -n '1,200p'`) and
`unified_exec`. The cap is therefore the **tool-output** cap:

- Default policy: `TruncationPolicyConfig::bytes(/*limit*/ 10_000)` — **10,000 bytes**
  (`models-manager/src/model_info.rs:167`, mirrored `protocol/src/openai_models.rs:928`).
- Shape: `truncate_middle_with_token_budget` — half the budget from the head, half from the tail
  (`split_budget: (budget/2, budget-left)`), joined by `…{N} tokens truncated…` /
  `…{N} chars truncated…` (`utils/string/src/truncate.rs:126-137`).
- Header on the whole payload (`utils/output-truncation/src/lib.rs:12-22`):
  `"Warning: truncated output (original token count: {n})\nTotal output lines: {n}\n\n{result}"`
- Token approximation is a flat `APPROX_BYTES_PER_TOKEN = 4`.

So Codex's *file* path is head-and-tail with no in-band continuation — recovery is the model
re-running `sed` with a different range, which the prompt does not spell out (`gpt_5_2_prompt.md:251`
only says *"Do not use python scripts to attempt to output larger chunks of a file."*). **Codex's
memory tool is the well-designed one; its file path is not.**

---

## 6. Letta — the system that answered "why truncate?" with "don't"

### 6a. Core memory blocks: uncapped, in-context, no read tool (VERIFIED)

Letta V1's base function set (`letta/functions/function_sets/base.py` @ `56ba9c2`) has
`core_memory_append · core_memory_replace · rethink_memory · memory_replace · memory_insert ·
memory_apply_patch · memory_rethink · memory_finish_edits`. **There is no `view`, `read`, or `get`
for a core-memory block** — blocks are rendered into the system prompt whole. Nothing to truncate,
so nothing to page.

Constants (`letta/constants.py`), all VERIFIED:

| Constant | Value |
|---|---|
| `CORE_MEMORY_PERSONA_CHAR_LIMIT` / `_HUMAN_CHAR_LIMIT` | 20,000 / 20,000 |
| `CORE_MEMORY_BLOCK_CHAR_LIMIT` | 100,000 |
| `FUNCTION_RETURN_CHAR_LIMIT` / `BASE_FUNCTION_RETURN_CHAR_LIMIT` | 50,000 / 50,000 |
| `TOOL_RETURN_TRUNCATION_CHARS` | 5,000 |
| `RETRIEVAL_QUERY_DEFAULT_PAGE_SIZE` | 5 |
| `DEFAULT_MAX_FILES_OPEN` | 5 |
| `DEFAULT_CORE_MEMORY_SOURCE_CHAR_LIMIT` | 50,000 |
| `MAX_PER_FILE_VIEW_WINDOW_CHAR_LIMIT` | `MAX_INT32` (2,147,483,647) — **effectively unbounded** |

R39 already recorded that Letta deleted its hard block cap (`d3f3a38f`, "block limit as metadata
only"); `letta-code` at HEAD confirms the direction — its memory tool
(`src/tools/impl/memory.ts`, 580 lines) has commands
`create · str_replace · insert · delete · rename · update_description` and **zero truncation logic**
(grep for `truncat|LIMITS` → 0 hits).

**Two markers worth stealing verbatim:**

```python
FILE_IS_TRUNCATED_WARNING = "# NOTE: This block is truncated, use functions to view the full content."
```

— a truncation marker whose entire content is *the recovery path*. And:

```python
CORE_MEMORY_LINE_NUMBER_WARNING = "# NOTE: Line numbers shown below (with arrows like '1→') are to help during editing. Do NOT include line number prefixes in your memory edit tool calls."
```

— because once you render line numbers to make ranges addressable, the model starts pasting them into
`old_str`. `memory_replace` enforces this in code, rejecting `\nLine \d+: ` and the warning text
itself in either `old_string` or `new_string`.

Also (`constants.py:200-204`), the generic tool-return marker:

```python
f"{return_str}... [NOTE: function output was truncated since it exceeded the character limit: {return_char} > {return_char_limit}]"
```

— both figures, same as ctrl-b's, and no continuation hint. ctrl-b's marker is already at parity with
Letta's *generic* one and behind Claude Code's and Letta's *block* one.

### 6b. Where Letta *does* page: files and archival (VERIFIED)

`letta/functions/function_sets/files.py`:

- `open_files(file_requests=[FileOpenRequest(file_name, offset, length)], close_all_others=False)` —
  line-range paging, *"Maximum of 5 files can be opened simultaneously"*. Crucially the paged content
  is **loaded into a files section of core memory**, not returned as a transient tool result: the
  page becomes durable context with an explicit eviction verb (`close_all_others`).
- `grep_files(pattern, include, context_lines=1, offset=None)` — *"Results are paginated - shows 20
  matches per call"*, and the docstring names the contract: *"Navigation hint for next page if more
  matches exist"* and **"The tool will tell you the exact offset to use for the next page."** Same
  design principle as Claude Code's marker — the tool computes the cursor, the model doesn't.
- `archival_memory_search(query, tags, tag_match_mode, top_k=10, start_datetime, end_datetime)` —
  the paging device here is **top-k ranking**, not offsets. `conversation_search(limit=…)` defaults
  to `RETRIEVAL_QUERY_DEFAULT_PAGE_SIZE = 5`.

### 6c. Letta's destructive guards (VERIFIED)

`memory_replace` (V1) is ctrl-b's `old_text` CAS with two extra rails:

```python
occurences = current_value.count(old_string)
if occurences == 0:  raise ValueError("No replacement was performed, old_string `…` did not appear verbatim in memory block with label `…`.")
elif occurences > 1: raise ValueError(f"No replacement was performed. Multiple occurrences of old_string `…` in lines {lines}. Please ensure it is unique.")
```

…and the docstring carries a **scale ceiling on the edit itself**:

> *"Do NOT attempt to replace long strings, e.g. **do not attempt to replace the entire contents of a
> memory block with a new string**."*

The function then **returns the full updated block value** — a post-write echo that re-syncs the
model to complete, current content. That is a cheap, uncapped anti-drift device: after every edit the
model's view is authoritative again.

`letta-code`'s `delete` (`src/tools/impl/memory.ts:249-266`): resolve label → `loadEditableMemoryFile`
(existence check) → `unlink`. **No hash, no size check, no completeness check.** The guards are
`validateRequiredParams(args, ["command", "reason"], "memory")` — **`reason` is required on every
memory command at HEAD**, confirming R44's "required-reason-becomes-commit-message" finding — plus a
git commit per write, a repo-clean precondition (`assertMemoryRepoCleanForWrite`), a
no-effective-change refusal (*"Memory {command} made no effective changes; nothing was committed"*),
and a redis-backed repo lock (`MEMORY_REPO_LOCK_TTL_SECONDS = 60`).

---

## 7. opencode — the cleanest paging contract in the class (VERIFIED)

`packages/core/src/tool/read.ts` + `read-filesystem.ts`.

Input schema: `{ path, offset, limit }` — described to the model as *"The 1-based directory entry or
text line offset to start reading from"* / *"The maximum number of directory entries or text lines to
read"*. The tool description leads with the capability: *"Read a text file or supported image, **page
through a large UTF-8 text file by line offset**, or list a directory page."*

| Constant | Value | Line |
|---|---|---|
| `MAX_READ_LINES` | **2,000** — both the default *and* a schema-enforced ceiling (`limit` is `isLessThanOrEqualTo(MAX_READ_LINES)`) | `read-filesystem.ts:11` |
| `MAX_READ_BYTES` | **51,200** (50 KB) | `:12` |
| `MAX_LINE_LENGTH` | **2,000** chars, suffixed `"... (line truncated to 2000 chars)"` | `:14-15` |
| `MAX_MEDIA_INGEST_BYTES` | 20 MB | `:13` |

**The output type carries an explicit cursor** (`:80-90`):

```ts
TextPage { content…, offset: PositiveInt, truncated: Schema.Boolean, next: PositiveInt (optional) }
ListPage { entries…, truncated: Schema.Boolean, next: PositiveInt (optional) }
```

`next` is set at whichever bound trips first — line count *or* byte budget (`:247`, `:253`, `:287`) —
so a file of few enormous lines pages correctly too. Paging engages automatically for big files even
when the model passes nothing: `const paged = info.size > MAX_READ_BYTES || page.offset !== undefined
|| page.limit !== undefined` (`:214`). And a past-EOF offset is an error, not silence:
`if (lines.length === 0 && offset !== 1) return yield* Effect.fail(new OffsetOutOfRangeError({offset}))`
(`:311`).

**Its mutation guard is a whole-file byte CAS — but scoped to the wrong window.** `FileMutation.writeIfUnchanged`
(`file-mutation.ts:144-156`) re-reads the file under a per-target lock and compares **all** bytes to
an `expected` buffer; a mismatch is `StaleContentError`, surfaced to the model as *"File changed
after permission approval. Read it again before editing."* Note the wording: `expected` is the
content captured at **permission-approval** time, not what the model saw. It defends against
concurrent writers, not against a partial view. `FileMutation.remove` (`:159-168`) has **no
precondition at all** — and is not exposed as a model-facing tool (the tool list is
`bash · edit · glob · grep · read · webfetch · websearch · write · skill · todowrite · question ·
apply-patch · http-body`; there is no delete verb).

---

## 8. goose, letta-code file reads, aider — the remaining three

**goose is the outlier: no cap on file reads at all** (VERIFIED,
`crates/goose/src/agents/platform_extensions/developer/edit.rs`). `FileReadParams { path, line:
Option<u32>, limit: Option<u32> }` exists — but `apply_line_limit` opens with:

```rust
if line.is_none() && limit.is_none() { return content.to_string(); }
```

A parameterless read returns the **entire file**, with no marker and no default. Paging params exist
purely as an opt-in. (Its *shell* output is capped — *"output of each stream is limited to up to 2000
lines, and longer outputs …"*, `developer/mod.rs:140`; images at 20 MB.) `FileEditParams { path,
before, after }` references truncation **zero times** — grep-verified. goose pays for this at the
context layer instead: R43 recorded its 0.8×-context-scaled tool-output clearing.

**letta-code's file reads** inherit the Claude Code lineage (`src/tools/impl/truncation.ts:11-35`):

```ts
READ_MAX_LINES: 2_000,            // Max lines per file read
READ_MAX_CHARS_PER_LINE: 2_000,   // Max characters per line
READ_OUTPUT_CHARS: 30_000,        // 30K total characters for file read output
GREP_OUTPUT_CHARS: 10_000,  GLOB_MAX_FILES: 2_000,  LS_MAX_ENTRIES: 1_000,
TOOL_RETURN_MAX_CHARS: 32_000,    // backstop for any model-facing tool return
BASH_NOTIFICATION_CHARS: 10_000,
```

with a per-line marker `"\n\n[Some lines exceeded 2,000 characters and were truncated.]"`
(`impl/read.ts:208`). The 30K/32K pair corroborates R36's ~30k figure for Claude Code's cap-and-spill.
Its **memory** tool, as noted, has none of this.

**aider has no read tool** (VERIFIED @ `5dc9490`, HEAD 2026-05-22 — treat as quasi-dormant). Whole
files enter the chat context via `/add`; there is no truncation anywhere in that path. Its guard is a
**pre-send refusal with human confirmation** (`aider/coders/base_coder.py:1396-1417`):

```python
if max_input_tokens and input_tokens >= max_input_tokens:
    self.io.tool_error(f"Your estimated chat context of {input_tokens:,} tokens exceeds the {max_input_tokens:,} token limit for {self.main_model.name}!")
    self.io.tool_output("To reduce the chat context:")   # /drop, /clear, smaller files
    if not self.io.confirm_ask("Try to proceed anyway?"): return False
```

**aider never silently truncates a file.** It refuses, explains, offers three named remedies, and asks
a human. That is the fourth distinct strategy in the field: **cap+page** (Claude Code, Codex memories,
opencode, Anthropic memory), **cap+middle-truncate** (Codex shell), **no cap** (goose, Letta blocks),
**refuse-with-hint** (aider).

---

## 8b. The completeness-guard negative, stated precisely (VERIFIED by grep)

The brief's question 7 — *any peer that guards a destructive op on read-completeness.* The answer is
**none, and it is not close.** Grep across the pinned clones:

| Path | `truncat*` hits |
|---|---|
| opencode `tool/edit.ts` + `tool/write.ts` + `file-mutation.ts` | **0** |
| goose `developer/edit.rs` | **0** |
| letta-code `tools/impl/memory.ts` (`truncat` or `LIMITS`) | **0** |
| Codex `ext/memories/src/**` (non-test) | 20 hits — **all** in `read`/`list`/`search` responses, `backend` structs, `metrics`, or the summary-prompt builder. **Zero in any write path** (there is no write path). |
| Claude Code | Read-before-edit rail is **file-granular** (probed §3b) — a never-viewed line was editable. |

Anthropic's memory-tool `delete` spec likewise carries no precondition beyond existence.

**So a completeness rail on `core_memory.delete` would be a ctrl-b invention with no field
precedent.** That is not automatically an argument against it — R44 already found ctrl-b's
`superseded_by|reason` guard was sound-as-ruled and that Hermes independently converged on the same
shape after the same incident — but the main seat should rule on it knowing it is a divergence, not a
catch-up.

---

## 8c. The field's synthesis table

| System | Read cap | Unit | Paging params | Truncation signal | Names the recovery? | Destructive precondition |
|---|---|---|---|---|---|---|
| **Claude Code Read** | 25,000 (obs.) / 2,000 lines | tokens | `offset` + `limit` | Marker w/ both totals + next call + behavioral rule | **Yes, literally** | Edit: file-read-in-session (**not** range) |
| **Anthropic memory `view`** | 16,000 | chars | `view_range [s,e]`, `[s,-1]` | *(model-side; docs prescribe cap+page)* | Yes — docs anticipate ranged follow-up | `str_replace`: unique `old_str`. `delete`: **none** |
| **Codex `memories.read`** | 20,000 | tokens | `line_offset` + `max_lines` | `{truncated: bool, start_line_number}` field | Schema-implicit; past-EOF errors | **No mutations exposed at all** |
| **Codex shell output** | 10,000 | bytes | — (model re-runs `sed`) | Head+tail, `…N tokens truncated…` + warning header | No | n/a |
| **opencode `read`** | 2,000 lines / 50 KB / 2,000 ch/line | mixed | `offset` + `limit` (≤2,000) | `{truncated, next}` cursor field | **Yes — `next` is the offset** | `writeIfUnchanged` whole-file byte CAS (approval-scoped); `remove` unguarded + untooled |
| **letta-code file read** | 2,000 lines / 30,000 ch | mixed | (Claude-Code-lineage) | Per-line marker | Partial | memory `delete`: **`reason` required** + git commit + repo lock |
| **Letta V1 core memory** | **none** (block cap deleted) | — | none (no read tool) | `FILE_IS_TRUNCATED_WARNING` on source blocks | Yes — *"use functions to view the full content"* | `memory_replace`: unique `old_string`; returns full block |
| **Letta files/archival** | 5 files open; 20 grep hits/page; `top_k` 10 | — | `offset`+`length`; `offset`; `top_k` | *"tool will tell you the exact offset"* | **Yes** | n/a |
| **goose `file_read`** | **none** | — | `line` + `limit` (opt-in only) | **none** | n/a | none |
| **aider** | **none** (no read tool) | — | — | **refuses at the window**, names 3 remedies, asks a human | n/a | n/a |
| **ctrl-b `core_memory.read`** | 4,096 (8,192 dev) | chars | **none** | Marker with both totals | **No** | `delete`: full-file sha256 CAS + `superseded_by`\|`reason` |

Read the last two columns together: **ctrl-b is simultaneously the strictest in the field on the
delete precondition and the only capped reader with no way to page.** The incident sits exactly in
that gap — a hash strong enough to authorize a delete, computed over bytes the model was never given.

---

## 9. §Recommendation — a proposal for the main seat to judge, not a decision

The leanest design consistent with the field, in dependency order. Items ① and ② are the fix; ③–⑤ are
riders the main seat can take or drop independently.

### ① Add `offset`/`limit` to `core_memory.read` — the field's answer, ~15 lines

5/6 peers that cap a read pair it with paging; Anthropic's own memory docs prescribe the pair in one
sentence. ctrl-b already has every other piece.

- **Unit: lines, not characters.** Every peer with paging pages on lines (Claude Code, Codex
  memories, opencode, Letta `open_files`, goose). Lines survive UTF-8, are stable across an edit that
  changes byte counts, and are what the model can reason about. Keep `topic_char_limit` as the
  **budget** — the page ends at whichever of `limit` lines or `topic_char_limit` chars trips first
  (opencode's dual-bound at `read-filesystem.ts:247-254` is the precedent, and it is what keeps one
  1,000-line paragraph-free topic from defeating the cap).
- Schema (Codex's shape, `min=1` on both): `offset: int = 1` (1-indexed), `limit: int | None`.
- **Refuse a past-EOF offset** rather than returning empty — Codex `LineOffsetExceedsFileLength`,
  opencode `OffsetOutOfRangeError`. Silence reads as "nothing more here," which is the incident's
  failure mode in miniature.
- **Charge each page against `RecallBudget` as today.** The budget, not the cap, is what bounds a
  runaway pager — and D60's `is_recall_call` exemption from the per-tool cap already anticipates
  multi-read turns. Worth a main-seat check: 11,107 chars at 8,192/page is 2 reads, well inside
  `recall_char_limit` 20,480; at cap 4,096 it is 3 reads and still fits. **A model that pages a
  large topic can exhaust the turn budget before it can write** — the exact failure §14d fixed once.
  If ① lands, re-check that arithmetic against the largest live topic.

### ② Rewrite the truncation marker to name the continuation call

The current marker states the loss and offers no exit. Claude Code's states the loss **and the exact
next invocation and a behavioral rule**; Letta's block marker is *entirely* a recovery instruction.
This is a one-line change to `core_memory_tool.py:264-267` and is the highest value-per-byte item in
the dossier:

```
<path> — content_hash: <sha>  (PARTIAL: lines 1-120 of 289, 8,192 of 11,107 characters)
Call read with offset=121 to continue. Do NOT merge, supersede, or delete this topic from a
partial view — read every page first.
```

Three properties, each with a named precedent: **both totals in both units** (Claude Code) · **the
literal next call, computed server-side** (Claude Code; Letta grep_files *"the tool will tell you the
exact offset"*) · **a behavioral rule riding the marker** (Claude Code's *"Do NOT answer from this
page alone"*). The second clause is ctrl-b-specific and does the incident-prevention work in prose,
for free, before any code rail exists.

### ③ The completeness rail on `delete` — genuinely optional, and unprecedented

**0/6 peers gate a destructive op on read-completeness** (§8b). Two honest framings for the ruling:

- **Against:** it is an invention; ① + ② may fully close the incident (the model would have both a
  reason and a means to page); it adds a per-turn read-state that the D57 design has so far avoided;
  and a resume/suspend boundary would need to carry it (ACA-15e — a fresh session forgets).
- **For:** ctrl-b's `delete` is *already* the strictest in the field, and the rail would make the
  existing CAS honest rather than adding a new concept. Today `content_hash` certifies *"this file is
  unchanged since a read"* while the model may have seen 74% of it — the token over-promises. The
  cheapest honest form is **not** new state: **make the hash the read emitted a hash of what was
  actually returned when the read was partial**, so a delete after a partial read simply fails the
  existing CAS with the existing error path. Zero new machinery; the guard becomes a property of the
  token rather than a new check. (This inverts today's deliberate one-buffer design in
  `read_topic`'s docstring — the main seat should rule on that trade explicitly, since that docstring
  argues the *full*-file hash is what makes the token safe against interleaved writes.)
- Middle option, if a rail is wanted without touching the hash: refuse `delete`/`update` when
  **this turn's** last read of that path was `truncated`, message naming the pages still unread.
  ~10 lines on `RecallBudget`, which is already the per-turn threaded object.

### ④ Two cheap riders with precedent

- **Post-write echo (Letta).** `memory_replace` returns the full updated block, re-syncing the model
  to authoritative content after every edit. ctrl-b's `_WriteOutcome` already carries the resulting
  `chars` — returning the (capped, marked) new body costs one field and kills a whole class of drift.
  Cheap; independent of ①–③.
- **Instrument the cut (Codex `truncated_tag`).** ctrl-b already counts `omitted` on `search`
  (D61 ⑤). Counting truncated `read`s tells the owner whether `topic_char_limit` is sized right —
  the number nobody currently has. The incident was invisible until it wasn't.

### ⑤ What NOT to do

- **Do not just raise `topic_char_limit`.** It is what dev already did (4,096 → 8,192) and the
  incident happened at 8,192. A cap without a page is a cliff wherever you put it; every peer that
  raised its cap also shipped a page.
- **Do not remove the cap** (the goose/Letta answer). It only works because goose clears tool output
  under context pressure and Letta puts blocks in the system prompt with no tool-result path at all.
  ctrl-b has neither property, and D42/D60 pressure-gating is what stands between the corpus and the
  context window.
- **Do not add a `read_full` escape verb.** No peer has one; it re-creates the uncapped read behind a
  different name and defeats `recall_char_limit`.

---

## 10. What I could not determine

1. **Claude Code's exact default line cap and its interaction with the token cap.** The tool
   description says *"Reads up to 2000 lines by default"*; the observed cut was token-driven at line
   980 with `cap 25000`. Whether 2,000 lines is a hard second ceiling or advisory prose is
   **UNVERIFIED** — the source is not available at this pin (R37/R40 read a leaked pin, `a371abb`,
   which predates this harness build).
2. **Whether Claude Code's Write tool truly refuses an unread pre-existing file.** The probe
   overwrote a 3,000-line file created earlier in the same session by Bash and succeeded; the file's
   in-session provenance makes it an inconclusive test of the documented rail. **UNVERIFIED.**
3. **Claude Code's per-line character clamp.** A 5,000-char line came back whole; whether a clamp
   exists at a higher threshold was not bisected.
4. **Anthropic memory `view`'s 16,000-char truncation is docs-reported, not source-verified** — the
   docs describe what *Claude's tool description* says, i.e. the model's trained expectation. The
   actual clamp lives in each customer's handler (the SDK ships `BetaLocalFilesystemMemoryTool` /
   `BetaAbstractMemoryTool` reference implementations that were **not** read at a pinned SHA).
   **REPORTED.**
5. **Whether any peer's *prompt* (as opposed to tool schema) instructs paging before a destructive
   op.** Codex's memory template forbids model edits entirely; opencode's and goose's prompts were
   not read in full for this. Not bought.
6. **Hermes' read/paging contract** was not examined this pass (R44 covered its `curator` and delta
   reports; its file-read caps are a separate buy). Likely the highest-value gap if the main seat
   wants a seventh data point — it is the one peer that hit ctrl-b's exact incident class (#29912).
7. **The `RecallBudget` arithmetic under paging** is reasoned in §9①, not measured. A paged read of
   the corpus's largest topics against `recall_char_limit` 20,480 should be checked on real data
   before ① is specced.
8. **Whether ctrl-b's incident model actually read the marker.** The transcript was not examined —
   so whether ② alone would have prevented it (model ignored an unactionable marker) or whether ①
   is load-bearing (model saw it and had no verb) is **undetermined**, and it is the single cheapest
   thing the main seat could check before ruling.
