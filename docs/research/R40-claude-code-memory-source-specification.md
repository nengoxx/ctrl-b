# R40 — Claude Code memory: source-derived implementation specification

| | |
|---|---|
| **Question** | What does the available Claude Code source actually implement for persistent memory, selective recall, capture, consolidation, session memory, agent memory, and team sync — independently of ctrl-b's intended design? What does that source settle, qualify, or contradict in [`CORE_MEMORY_PLAN.md`](../CORE_MEMORY_PLAN.md)? |
| **Date** | 2026-08-17 |
| **Primary source** | `/home/emma/github/claude-code` at **`a371abbe75ffa0d0a3c92290e2bbf56a7ef54367`** (clean tree during this pass). This is the leaked/de-obfuscated original TypeScript mirror already pinned by R37, not current installed-client source. |
| **Companion evidence** | [R37](./R37-claude-code-memory-source-verification.md) verifies prior Claude-specific claims and the live-corpus format mismatch. [R38](./R38-selective-memory-recall-field.md) compares the peer class. [R39](./R39-cap-triggered-tier-promotion.md) studies promotion and the separate SessionMemory subsystem. This dossier is different: it specifies the code's complete observable design in one place, then crosswalks ctrl-b's plan against it. |
| **Confidence key** | **VERIFIED** = traced in the pinned source during this pass. **INFERRED** = direct consequence of traced control flow, but not executed in the absent product runtime. **UNVERIFIABLE AT THIS PIN** = current/live behavior or remote configuration not present in the checkout. |
| **Checkout limitation** | The mirror tracks 1,906 files but **zero executable `*.test.ts` / `*.spec.ts` / `__tests__` paths**. Source comments refer to tests, but those tests are not in this checkout. Verification here therefore means control-flow tracing plus focused static assertions, not a runnable upstream test suite. |

---

## 0. Executive answer

The source does **not** implement one memory system. It implements five related but separately gated
systems:

1. **Auto memory (`memdir`)** — project-scoped, cross-session markdown memory: bounded `MEMORY.md`
   index plus topic files. The normal cohort injects the index and lets the main model use ordinary
   file/search tools for detail.
2. **Selective auto-memory recall (`tengu_moth_copse`)** — an experimental replacement cohort. It
   removes the index from startup context, runs a Sonnet filename selector asynchronously, and may
   inject up to five capped topic files after a tool phase. It is not layered on top of the index.
3. **SessionMemory** — a separate per-session working-notes file maintained by a forked agent and used
   as an alternative compaction summary. It never promotes into auto memory.
4. **Persistent agent memory** — optional per-agent `MEMORY.md`, scoped user/project/local, injected
   wholesale into that agent's prompt. It reuses the memdir prompt format but not auto-memory recall.
5. **Team memory** — a second shared corpus nested below auto memory, with server sync, secret scanning,
   optimistic concurrency, and server-wins pull semantics.

Two write-side variants sit beside those:

- **background extraction** converts completed turns into auto-memory topics with a five-turn fork;
- **autoDream** periodically consolidates the existing auto-memory corpus after time/session gates.

A compile/runtime variant, **KAIROS**, changes new writes from topic/index maintenance to append-only
daily logs, leaving nightly distillation to a separate process.

The most important source truth for ctrl-b is simple:

> Claude Code's ordinary design is **bounded index + ordinary Read/Grep/Glob/Write/Edit tools**. The
> LLM selector is a mutually exclusive experiment, not the default architecture. Its selective
> recall is deliberately non-blocking and can never affect a tool-free first response.

That corroborates ctrl-b's v1 mechanism ruling (index + literal search, no selector), while showing
that several proposed safeguards — tolerant current-format reads, data-not-instructions framing,
expected-state writes, deterministic secret rejection, and byte-preserving edit behavior — are
**ctrl-b improvements**, not Claude parity.

---

## 1. Component map and ownership boundaries

| Component | Durable artifact | Scope | Reader | Writer | Trigger |
|---|---|---|---|---|---|
| Auto memory | `<autoMemPath>/MEMORY.md` + topic `*.md` | canonical git root/project | initial-context loader or selective prefetch; ordinary file tools | main model; optional extraction fork; optional dream fork | session/turn activity |
| Team memory | `<autoMemPath>/team/MEMORY.md` + topics | repository + authenticated organization | same context/recall machinery | main/extractor/dream plus remote sync | local edits, watcher, startup/periodic sync |
| KAIROS logs | `<autoMemPath>/logs/YYYY/MM/YYYY-MM-DD.md` | project | ordinary tools; later dream process | main model append-only | assistant-mode activity |
| SessionMemory | session-private markdown file | one session | compaction path | restricted forked agent | context growth + activity |
| Agent memory | one `MEMORY.md` under user/project/local agent dir | agent type + configured scope | spawned agent prompt | that agent via ordinary tools | agent activity |
| CLAUDE.md/rules | existing instruction files | user/project/local/managed | startup/nested-context loader | user/model through ordinary tools | context construction |

The source shares helpers and tools but **not one store abstraction**. `memdir` has corpus-specific
policy, scanning, and gates; SessionMemory has independent state and compaction integration; agent
memory is prompt-only; team memory adds network state. There is no generic memory-provider interface
at this pin.

### 1.1 What is explicitly *not* connected

- SessionMemory never references `getAutoMemPath`; auto memory and autoDream do not inspect the
  SessionMemory file or context-pressure state. They are parallel lanes, not tiers with promotion.
- Agent memory has its own directory and prompt. It does not participate in auto-memory index loading,
  selector recall, extraction, dream, or team sync.
- Team memory requires auto memory and is nested under it, but KAIROS takes precedence because the
  append-only log paradigm is declared incompatible with team sync
  (`src/memdir/memdir.ts:318–369, 409–438`).
- The selective-recall cohort removes both AutoMem and TeamMem indexes from startup context; the source
  does not run index plus selector together (`src/utils/claudemd.ts:1136–1150`).

---

## 2. Gates and operating modes

The exact behavior depends on compile-time features, GrowthBook flags, settings, invocation mode, and
agent depth. "Claude Code memory" without a gate matrix is not a specification.

### 2.1 Auto memory

`isAutoMemoryEnabled()` is the foundational runtime gate. When false:

- no auto-memory `MEMORY.md` is added to `getMemoryFiles`;
- no memory-policy prompt is emitted;
- selective prefetch does not start;
- background extraction and autoDream return without work;
- team memory is also unavailable because it depends on auto memory.

### 2.2 Ordinary versus selective-recall cohort

| `tengu_moth_copse` | Startup `MEMORY.md` index | Query-time selector/topics |
|---|---:|---:|
| false (ordinary/default at the pin) | yes | no |
| true | no AutoMem/TeamMem index | yes, if all further gates pass |

The same flag is read when building memory policy (`skipIndex`) and when filtering injected memory
files. It also gates `startRelevantMemoryPrefetch`
(`src/memdir/memdir.ts:419–437`; `src/utils/claudemd.ts:1136–1150`;
`src/utils/attachments.ts:2361–2386`).

The selector additionally skips:

- no real user message;
- empty or single-word prompts (implemented as "contains no whitespace");
- a session already at 60 KiB of surfaced topic content;
- aborted turns;
- already surfaced files and files already touched through ordinary file tools.

### 2.3 Background extraction

Extraction requires all of:

- compile-time `EXTRACT_MEMORIES`;
- active extract mode;
- not bare/SIMPLE mode;
- main agent only (`agentId` absent);
- GrowthBook `tengu_passport_quail`;
- auto memory enabled;
- not remote mode;
- turn cadence `tengu_bramble_lintel` (default every eligible turn).

It is launched fire-and-forget from stop hooks after a completed query loop; print/SDK shutdown code is
expected to drain it (`src/query/stopHooks.ts:133–156`;
`src/services/extractMemories/extractMemories.ts:527–586`).

### 2.4 autoDream

AutoDream requires:

- auto memory enabled;
- `autoDreamEnabled` setting or its remote flag;
- not KAIROS;
- not remote mode;
- at least 24 hours since the lock mtime by default;
- at least five other sessions touched since then by default;
- no live lock holder.

A ten-minute scan throttle prevents repeated transcript scans when the time gate passes but the session
gate does not (`src/services/autoDream/autoDream.ts:54–99, 122–189`).

### 2.5 SessionMemory

SessionMemory:

- is main-REPL-thread only;
- is disabled in remote mode;
- respects auto-compact settings;
- is controlled by an experiment/remote gate;
- starts only after estimated context reaches 10,000 tokens by default;
- updates after another 5,000 tokens **and** either three tool calls or a tool-free assistant turn.

The token threshold is always required (`src/services/SessionMemory/sessionMemoryUtils.ts:31–53,
169–195`; `src/services/SessionMemory/sessionMemory.ts:134–180, 267–325`).

### 2.6 Team memory

Team memory is build-gated by `TEAMMEM`, requires auto memory, repository identity, first-party OAuth
with inference/profile scopes, and its own feature gate. Sync is unavailable without an identified GitHub
repository (`src/services/teamMemorySync/index.ts:1–25, 146–180, 889–913`).

### 2.7 KAIROS precedence

When compiled and active, KAIROS replaces ordinary new-memory instructions with append-only daily-log
instructions. It takes precedence over TEAMMEM. The index may still be loaded as a distilled read
artifact unless the selective-recall flag suppresses it (`src/memdir/memdir.ts:318–369, 419–438`).

---

## 3. Identity, root selection, and path permissions

### 3.1 Auto-memory identity

Default identity is the **canonical Git root**, falling back to the stable project root. Worktrees of the
same repository therefore share one memory directory. The default path is:

```text
<memoryBase>/projects/<sanitized-canonical-git-root>/memory/
```

Resolution order:

1. `CLAUDE_COWORK_MEMORY_PATH_OVERRIDE` (absolute full-path override);
2. `autoMemoryDirectory` from trusted policy/flag/local/user settings;
3. the default project-derived path.

Project settings are deliberately excluded so a repository cannot redirect silent memory writes to a
sensitive directory. Validation rejects relative, root/near-root, drive-root, UNC, null-byte, and bare
home/ancestor paths; output is NFC-normalized with one trailing separator
(`src/memdir/paths.ts:100–186, 198–235`).

### 3.2 Read/write permission asymmetry

- All auto-memory paths receive an internal **read allow**.
- The normal/settings-derived auto-memory root receives an internal **write allow**, bypassing the
  dangerous-directory check under `~/.claude`.
- A Cowork environment override does **not** receive that silent write carve-out; the SDK caller must
  supply normal allow rules (`src/utils/permissions/filesystem.ts:1565–1581, 1715–1724`).

This is a permission exception around the ordinary file tools, not a dedicated memory mutation API.

### 3.3 Containment semantics

`isAutoMemPath` normalizes and performs a prefix check against a root that carries a trailing separator.
It does not resolve symlinks (`src/memdir/paths.ts:261–278`).

Team memory has stronger helpers: `validateTeamMemWritePath` and `validateTeamMemKey` resolve the deepest
existing ancestor and reject symlink escape (`src/memdir/teamMemPaths.ts:208–283`). However, the source
search in this pass found `validateTeamMemWritePath` **defined but not called** by FileWriteTool or
FileEditTool; their inline team check uses `isTeamMemPath` plus secret scanning. Server-origin keys do use
`validateTeamMemKey`. Therefore the stronger local-write helper is not part of the observed local tool
path at this pin.

---

## 4. Corpus contract

### 4.1 Entrypoint

`MEMORY.md` is an index, not a content file. The model-facing contract is a two-step write:

1. write/update one semantic topic file with frontmatter;
2. add/update one index pointer:
   `- [Title](file.md) — one-line hook`.

The prompt says one line under approximately 150 characters and never put memory content directly in
`MEMORY.md` (`src/memdir/memdir.ts:199–257`).

### 4.2 Entrypoint limits

The loader caps the index at:

- 200 lines;
- 25,000 JavaScript string code units, despite naming this value "bytes".

Line truncation happens first, then length truncation at the last newline where possible. The loader
appends a warning naming the triggered cap and continues; over-limit memory does not break context
construction (`src/memdir/memdir.ts:34–103`).

This is **soft read truncation**, not write rejection.

### 4.3 Topic frontmatter

The pinned writer guidance uses top-level:

```yaml
---
name: ...
description: ...
type: user | feedback | project | reference
---
```

Unknown or absent type parses as `undefined` and does not invalidate the file. There are no source-level
IDs, confidence values, provenance records, schema versions, or per-entry timestamps in this shape.

Important currency limit: R37 verified that the installed current client writes nested
`metadata.type`, `originSessionId`, and `modified`, a shape absent from this pin. Thus this section
specifies the pin, **not current Claude corpus authorship**.

### 4.4 Topic scan

Selective recall and extraction share one scanner:

- recursive filesystem walk;
- every lowercase `*.md`;
- exclude any file whose basename is exactly `MEMORY.md`;
- read only the first 30 lines for frontmatter;
- parse top-level `description` and `type`;
- per-file failures are dropped;
- whole-directory failure returns `[]`;
- sort by `mtimeMs` newest first;
- retain at most 200 files.

The scan does **not** exclude dotfiles, `logs/`, malformed/no-frontmatter markdown, or nested KAIROS logs.
Such files remain candidates with missing metadata unless their basename is `MEMORY.md`
(`src/memdir/memoryScan.ts:21–76`).

### 4.5 Eligibility policy

The prompt directs the model to retain stable, surprising, future-useful user/context knowledge and
reject derivable project state, Git history, current task state, plans, and duplicate memories. Explicit
"remember" requests are immediate **only after** this eligibility policy; the exclusion section says its
rules override explicit requests. Plans/tasks are named as separate persistence mechanisms
(`src/memdir/memdir.ts:187–263`; policy details in `src/memdir/memoryTypes.ts`).

---

## 5. Read path A — ordinary cohort: inject the index, model pulls detail

### 5.1 Startup/context construction

`getMemoryFiles` loads ordinary CLAUDE.md/rules files, then reads auto-memory `MEMORY.md` as type
`AutoMem`, and optionally team `MEMORY.md` as `TeamMem`. Each is deduplicated by normalized path
(`src/utils/claudemd.ts:979–1007`).

The rendered block labels auto memory as persistent across conversations. Team content receives a
`<team-memory-content source="shared">` wrapper; private auto memory does not. Both join the same
CLAUDE.md-derived user-context block (`src/utils/claudemd.ts:1153–1194`).

`getMemoryFiles` is memoized. Correctness depends on explicit invalidation via
`clearMemoryFileCaches` / `resetGetMemoryFilesCache`; a manual external edit is not watched by the
ordinary private-memory lane (`src/utils/claudemd.ts:1110–1130`).

### 5.2 Authority and placement

The memory content is not a dedicated system message. It enters the hidden user-context message used for
CLAUDE.md-family material, under `MEMORY_INSTRUCTION_PROMPT`, whose inner framing says the shown
instructions override defaults. The outer hidden-context wrapper elsewhere says the context may not be
relevant. R37 §7 records that contradiction.

The behavioral memory policy is separately emitted from the system-prompt memory section. In other
words:

- **policy**: cached system-prompt section;
- **index content**: hidden user-side startup context.

### 5.3 Topic recall

There is no dedicated memory-read tool in the ordinary cohort. The policy tells the model where the
memory directory is; optional `tengu_coral_fern` text explicitly teaches literal Grep over topic files
and transcript JSONL as a last resort (`src/memdir/memdir.ts:372–406`). The model uses ordinary
Read/Grep/Glob tools, just as it would for project files.

Therefore normal-cohort recall is voluntary and main-model-driven:

```text
startup index -> model notices candidate -> Read/Grep topic -> tool result -> answer
```

There is no deterministic guarantee that the model reads before answering.

---

## 6. Read path B — selective-recall cohort

### 6.1 Start

At the beginning of a user turn, `query.ts` starts one `MemoryPrefetch` from the full message state. It
runs concurrently with main-model streaming and tools. A disposable handle couples it to the turn abort
and terminal telemetry (`src/query.ts:297–304`; `src/utils/attachments.ts:2334–2409`).

### 6.2 Candidate selection

1. Resolve search roots: an explicitly mentioned memory-enabled agent's directory, otherwise auto
   memory.
2. Scan at most 200 newest topic headers per root.
3. Remove paths surfaced in prior transcript attachments before selection.
4. Format each candidate as:
   `- [type] relative/path.md (ISO-mtime): description`.
5. Ask the default Sonnet model for `selected_memories: string[]`, max 256 output tokens.
6. Post-filter returned strings against the exact offered filename set.
7. Remove files already in `readFileState`; flatten and cap to five.

The selector is precision-biased, may return empty, and gets recently used tool names with a rule that
suppresses usage/API-reference memories for those tools but retains warnings/gotchas. Query text is
placed before the manifest, so the large stable manifest is not a cacheable prefix at this pin
(`src/memdir/findRelevantMemories.ts:18–140`; `src/memdir/memoryScan.ts:79–94`;
`src/utils/attachments.ts:2196–2241`).

Any directory, scan, selector, parse, validation, or topic-read failure degrades to an empty result.

### 6.3 Payload limits and framing

Each selected topic is read with:

- first 200 lines;
- 4,096-byte cap;
- partial content retained with a pointer to Read the full file;
- freshness prose derived from `mtimeMs`;
- absolute source path.

The turn cap is five selected files (approximately 20 KiB). The session cap is 60 KiB, reconstructed by
walking prior `relevant_memories` attachments. Because the state comes from transcript messages,
compaction naturally permits old memories to be surfaced again
(`src/utils/attachments.ts:2231–2332, 2383–2386`).

Rendered selected topics become hidden user-side `<system-reminder>` attachments. The header is stored
with the attachment so replay bytes stay stable rather than recomputing a changing age string.

### 6.4 Timing — the material limitation

The consume point is after tool execution. It polls `settledAt` with zero wait. If unresolved, it tries
again only if another tool-loop iteration occurs. If settled, the memory attachment is appended to tool
results and therefore influences the **next** model call
(`src/query.ts:1592–1614`).

Consequences:

- a tool-free first response returns before the consume point and cannot receive selected memory;
- even when tools run, selected memory arrives one model iteration late;
- an unsettled selector is aborted when the turn ends;
- telemetry records whether memory was hidden by the first iteration.

This is not an incidental race. The type and comments explicitly say prefetch never blocks the turn.

---

## 7. Main-model write path

### 7.1 Tool surface

The main model writes auto memory through ordinary FileWriteTool/FileEditTool. There is no typed memory
transaction or dedicated create/update/delete API. The prompt supplies the corpus discipline.

Existing-file writes require prior full reads and mtime/content freshness. FileEditTool rejects missing
or ambiguous `old_string` unless `replace_all` is explicit
(`src/tools/FileWriteTool/FileWriteTool.ts:153–221`;
`src/tools/FileEditTool/FileEditTool.ts:275–343`).

This gives some expected-prior-state protection, but it is tool-generic rather than corpus-aware:

- Write replaces the complete file after a read/staleness check;
- Edit can uniquely replace a substring or replace all;
- no operation atomically updates a topic and its index pointer together;
- no rollback couples the two-step write;
- no topic path/schema/index invariant is deterministically enforced.

### 7.2 Filesystem semantics

Writes are synchronous at the final write point and use LF for FileWriteTool full replacement. Edit
preserves the file's detected line-ending/encoding policy. Parent directories are created first. Tool
state is updated after success (`src/tools/FileWriteTool/FileWriteTool.ts:249–305, 331–337`;
`src/tools/FileEditTool/FileEditTool.ts:470–525`).

The source contains no auto-memory-specific Git backup, write journal, or corpus transaction.

### 7.3 Cache invalidation

The direct Write/Edit bodies do **not** clear `getMemoryFiles`. A source-wide callsite check found cache
clear/reset at lifecycle boundaries (setup/worktree restore, `/clear`/resume, and compaction) and after
settings/team **pulls**, but no private AutoMem write callsite. Thus a main-model memory write updates disk,
`readFileState`, and the transcript, but does not rebuild the already injected startup index in the same
session. The next session/clear/compaction reloads it. In the selector cohort, the per-turn scanner reads
disk directly, although files in `readFileState` are deliberately excluded from automatic re-surfacing.

Out-of-band private corpus edits likewise have no dedicated watcher in this pin. Team memory has a watcher
for synchronization, and a remote pull explicitly clears memory-file caches; that is not a general
private-memory live-reload mechanism.

### 7.4 Secret policy

FileWriteTool and FileEditTool deterministically scan **team-memory** writes and reject detected secrets
because the data will sync to collaborators (`src/tools/FileWriteTool/FileWriteTool.ts:153–160`;
`src/tools/FileEditTool/FileEditTool.ts:137–147`;
`src/services/teamMemorySync/teamMemSecretGuard.ts:3–44`).

The private auto-memory lane has no equivalent deterministic secret gate at this pin; it relies on prompt
policy and ordinary permissions.

---

## 8. Background extraction

### 8.1 Purpose and source window

At completed-turn stop hooks, a forked agent reviews only messages since an in-memory cursor. It is told
to derive memory exclusively from that recent window and not investigate or verify externally. The
existing topic manifest is pre-injected so the fork does not spend a turn listing files.

### 8.2 Mutual exclusion with main-model writes

Before extraction, `hasMemoryWritesSince` scans the new range. If the main conversation already wrote
memory, the fork is skipped and the cursor advances past that range. This makes direct and extracted
capture mutually exclusive per processed range (`src/services/extractMemories/extractMemories.ts:329–371`).

### 8.3 Fork contract

The fork:

- reuses cache-safe parent parameters;
- gets Read/Grep/Glob and read-only Bash broadly;
- gets Write/Edit only inside the auto/team memory directories;
- skips transcript persistence;
- has `maxTurns: 5` (expected read phase then write phase).

The prompt directs parallel reads first and parallel writes second, avoiding alternating tool phases.

### 8.4 Cursor, failure, and overlap

- Cursor advances only after a successful fork.
- Failure logs/telemetry but does not notify the user; the range is reconsidered next time.
- Success filters mechanical `MEMORY.md` writes out of the human memory count and emits a "Saved N
  memories" system message.
- Concurrent triggers do not queue unbounded runs. One latest context is stashed and executed as a
  trailing run; intermediate contexts are subsumed because the latest contains the full newer history.
- A drain API waits up to 60 seconds during graceful shutdown.

Evidence: `src/services/extractMemories/extractMemories.ts:280–320, 395–503, 506–586`.

---

## 9. Consolidation (`autoDream`)

### 9.1 Schedule and lock

The default gate is 24 hours **and** five other sessions since the previous consolidation. Transcript
scan attempts are throttled to once per ten minutes. A `.consolidate-lock` file lives **inside the corpus**:

- body = holder PID;
- mtime = last-consolidated time;
- live holder blocks;
- holder older than one hour is reclaimable (PID-reuse guard);
- failure rewinds the previous mtime or removes a newly created lock;
- crash recovery reclaims a dead PID.

Evidence: `src/services/autoDream/autoDream.ts:54–99, 122–189`;
`src/services/autoDream/consolidationLock.ts:1–108`.

### 9.2 Actor and permissions

AutoDream is another cache-reusing forked agent with the same auto-memory write confinement as extraction.
It receives transcript/session hints, read-only Bash, and ordinary Write/Edit inside memory. It runs as a
background task with progress, kill, completion, failure, and user-visible "Improved" reporting
(`src/services/autoDream/autoDream.ts:192–270`).

### 9.3 Prompt behavior

The consolidation prompt tells the model to:

- merge new signal into existing topic files;
- avoid near-duplicates;
- normalize relative dates into absolute dates when possible;
- delete contradicted facts at the source;
- keep frontmatter current;
- keep `MEMORY.md` below both index caps;
- inspect recent sessions and current memory before editing.

This is best-effort model behavior, not deterministic merge logic.

---

## 10. KAIROS append-only variant

KAIROS changes the **write protocol**, not the corpus root:

```text
<autoMemPath>/logs/YYYY/MM/YYYY-MM-DD.md
```

The main model appends timestamped bullets, never rewrites or reorganizes the log, and leaves topic/index
distillation to a nightly process. The prompt uses a date pattern rather than today's literal date so its
cached bytes survive midnight; the model receives date-change context separately
(`src/memdir/memdir.ts:318–369`).

KAIROS and team sync are mutually incompatible by explicit precedence. The general recursive scanner does
not exclude `logs/`, so enabling selective recall against a corpus containing daily logs can treat them as
untyped topic candidates. That is an emergent edge, not an intended topic contract.

---

## 11. Team memory and sync

### 11.1 Corpus and model policy

Team memory is a second corpus under auto memory with its own `MEMORY.md`. The prompt distinguishes
private and team routing by memory type: user facts remain private; project/reference material leans team;
feedback depends on whether it is individual or project-wide. Team content gets explicit shared-source
framing in injected context.

### 11.2 Sync state

A caller-owned `SyncState` tracks:

- last server checksum/ETag;
- per-key SHA-256 content hashes;
- server entry cap learned only from a structured 413.

No module-global sync state is required (`src/services/teamMemorySync/index.ts:93–136`).

### 11.3 Pull

Pull is server-wins per key:

- 404/empty means no server data;
- server entries overwrite local files;
- server checksums replace the local view of server state;
- cache is cleared after files are written;
- server absence does not delete local files.

Remote keys are validated for traversal and symlink escape before writing.

### 11.4 Push

Push:

1. recursively reads local team files;
2. skips unreadable files;
3. skips files above 250,000 bytes;
4. scans each file for secrets and excludes matches;
5. hashes local UTF-8 content;
6. computes a delta against server checksums;
7. batches request bodies at approximately 200,000 bytes;
8. sends conditional PUTs with ETag;
9. on 412, fetches current hashes, recomputes the delta, and retries at most twice.

For same-key conflicts, the locally edited value eventually overwrites the server. No content merge is
attempted. Server-only keys discovered during hash conflict resolution are downloaded on the next pull,
not during the push (`src/services/teamMemorySync/index.ts:430–552, 555–649, 869–1029`).

### 11.5 Deletion semantics

Deletion does not propagate. A local deletion is absent from the delta, the server keeps the old key, and
a later pull restores it (`src/services/teamMemorySync/index.ts:14–19`).

### 11.6 Failure posture

Network/auth/repo/limit errors are returned and logged; local memory remains usable. Server entry-count
limits are learned from structured errors rather than duplicated as a stale client constant. Partial
multi-batch pushes are possible: successful earlier batches remain committed if a later batch fails.

---

## 12. SessionMemory: bounded working notes and compaction

### 12.1 Artifact and permissions

SessionMemory creates a private file/directory with `0700` directory and `0600` file modes. A template is
written only on first creation. A separate restricted fork may Edit that one file; it cannot use arbitrary
tools (`src/services/SessionMemory/sessionMemory.ts:183–232, 315–325`).

### 12.2 Trigger state

Mutable process state tracks:

- initialized/not initialized;
- tokens at last extraction;
- last summarized message ID;
- extraction start time;
- last processed message UUID.

Defaults are 10,000 tokens to initialize, 5,000 more between updates, and three tool calls. Extraction is
serialized. Compaction waits up to 15 seconds for an active extraction, but treats one older than 60
seconds as stale and continues (`src/services/SessionMemory/sessionMemoryUtils.ts:12–53, 85–105`).

### 12.3 Update actor and content policy

A cache-reusing fork receives current notes and an update prompt. It is told to maintain named sections,
keep each around 2,000 tokens, condense older/lower-value detail, and prioritize current state plus errors
and corrections. A total budget of 12,000 tokens triggers stronger prompt wording.

The source does not enforce these section caps on every write. They are model-steered until compaction.

### 12.4 Compaction use

When enabled and non-empty, SessionMemory can replace traditional compaction:

- wait for in-flight extraction;
- locate the last summarized message boundary, or handle resumed session without one;
- retain enough recent messages without splitting tool-use/result pairs;
- run session-start hooks to restore current instructions;
- deterministically truncate oversized SessionMemory sections for the post-compact budget;
- emit the resulting content as the compact summary;
- point to the full file if truncation occurred.

If the remembered boundary is missing or the file is absent/template-only, it falls back to legacy
compaction (`src/services/compact/sessionMemoryCompact.ts:434–598`).

### 12.5 No promotion

No code promotes SessionMemory facts into auto memory. Under pressure it condenses **in place**, and a
last-resort deterministic truncator protects the compacted context. Durable auto memory is captured by
other actors and triggers.

---

## 13. Persistent agent memory

An agent definition may choose one memory scope:

- `user`: `<memoryBase>/agent-memory/<agentType>/`;
- `project`: `<cwd>/.claude/agent-memory/<agentType>/`;
- `local`: project-local non-VCS directory, or a remote-memory mount namespace.

The agent type is path-sanitized. The spawned agent receives the complete memdir-style policy plus its
`MEMORY.md` content and a scope-specific note. Directory creation is fire-and-forget, with FileWriteTool
parent creation as fallback (`src/tools/AgentTool/agentMemory.ts:12–65, 106–176`).

Agent memory has no selective topic scan of its own in normal operation. It is one fully injected index
file. An explicitly mentioned memory-enabled agent can, however, redirect the experimental selector's
search root to that agent directory (`src/utils/attachments.ts:2204–2213`).

### 13.1 Operator surface

The `/memory` command clears/primes the memory-file cache, then opens a selector/editor. It can open
ordinary instruction files, the auto-memory folder, the team-memory folder, and configured agent-memory
folders. It exposes toggles for auto memory and autoDream plus dream status/last-run time
(`src/commands/memory/memory.tsx:21–88`;
`src/components/memory/MemoryFileSelector.tsx:112–238`). It is an editor/setting surface, not a corpus
validator: there is no parsed/skipped topic count, per-topic schema report, cap-usage dashboard, backend
picker, or typed topic editor in this source.

---

## 14. Cache and consistency model

### 14.1 Cache layers

| Cache/state | Scope | Invalidation/rebuild |
|---|---|---|
| `getAutoMemPath` memo | project root/session-stable env/settings | cache clear/tests; production assumes stable configuration |
| `getMemoryFiles` memo | process/context loader | lifecycle clear/reset; settings/team pulls; not direct private AutoMem writes |
| system prompt memory section | session/prompt-section cache | session construction; date pattern avoids midnight churn |
| surfaced-memory set/bytes | reconstructed from transcript | compaction drops old attachments and naturally resets |
| `readFileState` | session/tool context | Read/Write/Edit updates; prevents stale edits and duplicate recall |
| extractor cursor | process closure | advances on success or direct-memory-write skip |
| dream schedule | corpus lock mtime | success keeps new mtime; failure rolls back |
| team sync state | session watcher/service | pull/push responses update hashes/ETag |
| SessionMemory counters | process session | reset at session/test lifecycle |

### 14.2 Prompt-cache consequences

- Ordinary index bytes are stable startup context until memory changes.
- A memory write invalidates the context suffix from its injection point on subsequent calls.
- Selective topic attachments are append-only user-side messages; stored headers preserve replay bytes.
- Query-time selector prompts place the changing query first, forfeiting prefix reuse for the manifest.
- KAIROS uses a date-path pattern specifically to keep the system section stable across midnight.
- Extraction, dream, and SessionMemory forks use cache-safe parent parameters to reuse the main prefix.

### 14.3 Consistency guarantees

Guaranteed by code:

- read-before-write and stale-file rejection for ordinary tools;
- ambiguous edit rejection unless `replace_all` is explicit;
- topic payload and index read caps;
- selector filename post-filter;
- fork tool confinement;
- team remote-key path validation;
- team secret filtering and ETag conflict loops;
- one dream lock per corpus.

Not guaranteed by code:

- atomic topic + index update;
- valid/unique frontmatter;
- index pointer exactly matches the topic tree;
- private-memory secret rejection;
- immediate observation of out-of-band private corpus edits;
- semantic deduplication or contradiction removal;
- successful memory selection before first answer;
- promotion between SessionMemory and auto memory.

---

## 15. Exact constants at this pin

| Concern | Value | Source |
|---|---:|---|
| `MEMORY.md` line cap | 200 lines | `memdir/memdir.ts:34–38` |
| `MEMORY.md` length cap | 25,000 JS code units | `memdir/memdir.ts:57–103` |
| scanner candidates | 200 newest | `memdir/memoryScan.ts:21–22, 66–73` |
| frontmatter scan | first 30 lines | `memdir/memoryScan.ts:21–22, 48–54` |
| selector output budget | 256 tokens | `memdir/findRelevantMemories.ts:97–122` |
| selected topics per turn | 5 | `utils/attachments.ts:2231–2234` |
| selected topic read | 200 lines / 4,096 bytes | `utils/attachments.ts:2268–2307` |
| selective session payload | 60 KiB | `utils/attachments.ts:2383–2386` + config definition |
| extraction fork | 5 turns | `extractMemories.ts:415–426` |
| extraction cadence | every eligible turn by default | `extractMemories.ts:374–386` |
| dream schedule | 24 h + 5 sessions | `autoDream.ts:58–66` |
| dream scan throttle | 10 min | `autoDream.ts:54–56` |
| dream stale-holder guard | 1 h | `consolidationLock.ts:16–19` |
| team per-file upload cap | 250,000 bytes | `teamMemorySync/index.ts:71–89` |
| team PUT target | 200,000 bytes | `teamMemorySync/index.ts:80–90` |
| team HTTP timeout | 30 s | `teamMemorySync/index.ts:71` |
| team general retries | 3 | `teamMemorySync/index.ts:90` |
| team conflict retries | 2 | `teamMemorySync/index.ts:91` |
| SessionMemory init | 10,000 tokens | `SessionMemory/sessionMemoryUtils.ts:31–36` |
| SessionMemory update growth | 5,000 tokens | same |
| SessionMemory tool threshold | 3 calls | same |
| SessionMemory extraction wait | 15 s | `sessionMemoryUtils.ts:12–13, 85–105` |
| SessionMemory stale extraction | 60 s | same |
| SessionMemory section guidance | ~2,000 tokens | `SessionMemory/prompts.ts` |
| SessionMemory total guidance | 12,000 tokens | `SessionMemory/prompts.ts` |

---

## 16. What Claude Code does **not** do at this pin

1. No generic pluggable long-term-memory provider.
2. No embedding/vector/BM25/graph retrieval.
3. No dedicated ordinary-cohort memory read/search tool.
4. No dedicated typed memory write transaction.
5. No atomic topic/index pair update.
6. No deterministic private-memory secret scanner.
7. No confidence, provenance, per-entry ID, or schema version in pinned topic frontmatter.
8. No index plus LLM selector in the same cohort.
9. No pre-answer wait for selective recall.
10. No promotion from SessionMemory to auto memory.
11. No Git versioning of auto memory in this source.
12. No remote deletion propagation for team memory.
13. No universal headless behavior: extraction, dream, SessionMemory, remote, bare, and subagent paths
    have different gates.
14. No complete current-client source: nested current frontmatter and post-pin behavior remain outside
    this checkout.

---

## 17. Source-derived concerns and defects worth preserving as evidence

### C1. "Bytes" are not bytes

The index `byteCount` is `trimmed.length`, i.e. UTF-16 code units. Multi-byte Unicode can exceed the
nominal byte limit materially (`memdir/memdir.ts:57–66`).

### C2. Index and selector are alternatives

Any design claim that Claude layers bounded index context with automatic selector recall is false at this
pin. One flag swaps them (`src/utils/claudemd.ts:1136–1150`;
`src/utils/attachments.ts:2361–2369`).

### C3. Selective recall misses first answers by construction

The zero-wait consume point is post-tools. A tool-free first answer cannot see selected topic memory
(`query.ts:1592–1614`).

### C4. Scanner accepts artifacts

Recursive scan excludes only basename `MEMORY.md`; `.consolidate-lock` is not markdown, but KAIROS
`logs/**/*.md` and unrelated markdown artifacts are candidates (`memoryScan.ts:35–75`).

### C5. Frontmatter source is stale relative to the current client

The pin reads top-level `type`; the current installed client writes nested `metadata.type`. Copying only
this source shape would reduce interoperability (R37 §13).

### C6. Private and team safety differ

Team writes and uploads have deterministic secret checks. Private auto memory does not. This is an
intentional sharing-boundary defense, not a general memory-security layer.

### C7. Strong team symlink helper is not wired into local tools

`validateTeamMemWritePath` exists and resolves symlinks, but source search found no callsite beyond its
definition/comments. Local FileWrite/Edit use the weaker `isTeamMemPath` for deciding whether to scan
secrets. Server-origin keys use `validateTeamMemKey`.

### C8. Deletion cannot converge through team sync

Local deletion is explicitly restored by future pull. Forgetting a shared fact therefore requires a
server-side protocol or overwriting the key, not deleting the local file.

### C9. Private index writes are intentionally stale in the injected session head

`getMemoryFiles` is memoized and private auto memory has no watcher in this source. Direct AutoMem
Write/Edit does not clear that cache, either. The current conversation already knows what it wrote;
new sessions, clear/resume, or compaction reload the index. Arbitrary external edits share that delayed
visibility unless another lifecycle event clears the cache. The selector cohort is different because its
scanner reads disk per turn.

### C10. Model policy owns corpus integrity

Duplicate avoidance, two-step index maintenance, contradiction repair, and consolidation are prompt
rules. The deterministic layer cannot prove the corpus is coherent after a partial tool sequence or fork
failure.

---

## 18. Crosswalk: `CORE_MEMORY_PLAN.md` against source truth

Legend:

- **MATCH** — same mechanism/invariant at the pin.
- **SEMANTIC MATCH** — same user-visible job, different API/placement.
- **DELIBERATE DIVERGENCE** — ctrl-b intentionally differs and should say so.
- **HARDENING** — ctrl-b is stricter than Claude source.
- **NOT SOURCE-DERIVED** — a ctrl-b product decision, not settled by Claude.

| Ctrl-b plan item | Claude source answer | Classification / consequence |
|---|---|---|
| Tier 2 = bounded index + topic tree | Ordinary auto memory is exactly bounded `MEMORY.md` + topic files | **MATCH** |
| No selector in v1 | Ordinary cohort has no selector; selector is mutually exclusive experiment | **MATCH**, strongly corroborated |
| Main model recalls with read/search tools | Main model uses ordinary Read/Grep/Glob; optional policy teaches literal Grep | **SEMANTIC MATCH**; dedicated `core_memory` tool is ctrl-b API choice |
| One shared corpus across all ctrl-b agents | Auto memory is project-shared; persistent agent memory is separately partitioned | **PARTIAL**; source offers both patterns, does not settle ctrl-b's choice |
| Core root inside ctrl-b `memories/core/` | Claude root is project identity under memory base; no ctrl-b D26 repo | **DELIBERATE DIVERGENCE** |
| Copy-in migration | Claude supports path override/live root; source has no copy-in procedure | **NOT SOURCE-DERIVED**; compatibility is corpus-format work |
| Read top-level or nested `metadata.*` | Pin reads only top-level; current live corpus uses nested metadata | **HARDENING/CURRENCY FIX**, required by R37 evidence |
| Skip dotfiles, `logs/`, no-frontmatter non-index artifacts | Source excludes only basename `MEMORY.md` | **HARDENING**, closes C4 |
| Match-neighbours writes | Pin writes top-level shape; current writer is absent from source | **DELIBERATE INTEROP RULE**, justified by source staleness |
| Clamp each rendered index entry ~150 chars | Source only prompts ~150 and does not clamp each line deterministically | **HARDENING** |
| Index hard char cap ~8 KiB | Source reads 200 lines/25,000 code units | **DELIBERATE DIVERGENCE**; ctrl-b chooses Kilo-like smaller budget |
| Soft truncation + warning | Source does exactly this for the entrypoint | **MATCH** |
| Policy + index in static system head | Source policy is system-side, index is hidden user context | **DELIBERATE DIVERGENCE**; cache behavior similar, authority placement different |
| Place core index after tier-1 memory and before skills | Source has no ctrl-b-style tier-1 block/skills-note ordering; AutoMem rides the CLAUDE.md user-context path | **NOT SOURCE-DERIVED**; ctrl-b placement is a local prefix-cache decision |
| Recalled content = fallible data, not instructions | Source freshness warns about staleness, but startup index inherits contradictory instruction authority | **HARDENING**, do not "restore parity" |
| Dedicated `read(path)` with 4,096-char cap | Selector attachment uses 4,096 bytes; manual Read is ordinary tool behavior | **SEMANTIC MATCH** with unit/API divergence |
| Per-turn recall cap ~20 KiB | Selector cohort: 5 × 4 KiB | **MATCH** to experiment, not ordinary cohort |
| No 60 KiB session cap in plan | Selector cohort stops at 60 KiB and resets through compaction | **DELIBERATE DIVERGENCE**; decide whether tool-result persistence already bounds ctrl-b |
| `search` = literal body/frontmatter grep | Optional source policy tells main model to Grep full markdown | **SEMANTIC MATCH**, no BM25/vector needed |
| `create` writes topic + index | Source prompt requires the same two steps through generic tools | **SEMANTIC MATCH**; ctrl-b tool can enforce more |
| CAS unique-substring update/remove | FileEditTool requires a unique match unless replace-all; stale mtime/read checks | **MATCH/HARDENING** when made corpus-specific |
| Whole-topic delete with expected description | Source uses ordinary deletion/file editing; no equivalent expected-description token | **HARDENING** |
| Deterministic secret rejection for all core writes | Source deterministically scans team memory only | **HARDENING** |
| Writes serialized under D26 `MemoryBackup.guard()` | Source has no general corpus write lock; only dream lock and tool stale-write checks | **DELIBERATE DIVERGENCE/HARDENING** |
| Git commit each write + reconcile hand edits | Source has no auto-memory Git backup | **CTRL-B REUSE**, not Claude parity |
| Disabled means no prompt/tool/IO | Auto-memory gate removes policy/index/prefetch and writers return; ordinary file tools still exist globally | **SEMANTIC MATCH**; hiding dedicated ctrl-b tool is cleaner |
| Tool hidden from schema when disabled | Source has no dedicated memory tool to hide | **NOT SOURCE-DERIVED**, valid ctrl-b gating |
| `Risk.LOW`, non-core, allowlist-excludable tool | Source relies on ordinary filesystem tool permissions and the AutoMem write carve-out | **DELIBERATE CTRL-B SECURITY/OPERABILITY SHAPE** |
| Core memory live in all headless/subagent sessions (O1) | Source varies: selector can run broadly, extraction/main only, dream/main only, SessionMemory REPL-only, bare/remote exclusions | **DELIBERATE CTRL-B POLICY**, not "match Claude" |
| Never ask which tier for unqualified remember (O2) | Claude says save immediately into its one active auto-memory lane, subject to exclusions | **PARTIAL MATCH**; two-tier routing remains ctrl-b policy |
| Dedicated read actions despite tier-1 no-read rule (O3) | Claude ordinary recall already depends on file reads/search | **MATCH IN PURPOSE** |
| Proactive writes, prompt-steered cleanup, no separate consolidator v1 (O4) | Claude combines proactive main writes, optional extraction fork, and optional autoDream consolidator | **DELIBERATE LEAN SUBSET**; not full Claude parity |
| Cap-pressure promotion from tier 1 | SessionMemory condenses in place and never promotes | **NOT SOURCE-DERIVED**; R39 supplies external precedent and caveat |
| Owner-invoked consolidation via same tool | Claude ships manual `/dream` plus optional autoDream fork | **SEMANTIC MATCH** for manual path; actor/tool differ |
| Byte-identical assembly when off | Auto-memory gate makes memory-specific context absent, but source does not state ctrl-b's exact byte assertion | **GOOD ACCEPTANCE INVARIANT**, stronger than source comments |
| Recall visible as tool calls | Ordinary source recall uses visible Read/Grep; selector attachments are hidden/meta | **MATCH ordinary cohort**, divergence from selector cohort |
| Fresh first answer can recall after a voluntary tool read | Ordinary main loop can read before final answer; selector cannot help tool-free first response | **MATCH**, provided model policy reliably calls the tool |
| No background extraction/scheduled consolidation v1 | Source has both behind gates | **DELIBERATE NON-GOAL**, not omission by ignorance |
| One future tier-2 backend slot | Source has no provider slot or interface | **NOT SOURCE-DERIVED**; keep protocol deferred until backend #2, as plan says |
| Nested `LongTermCfg` / one active backend | Source exposes auto-memory settings and path override, not a backend slot | **NOT SOURCE-DERIVED**; ctrl-b config shape remains local architecture |
| All feature-added model text owner-editable | Source prompts are compiled literals; only Cowork extra guidelines provide an append seam | **DELIBERATE CTRL-B PRODUCT RULE**, not Claude parity |
| Prompt registry ids + prompt stamping | Source uses system-prompt sections and telemetry, not ctrl-b's registry/stamp contract | **CTRL-B REUSE**, preserve existing architecture |
| Conf status: resolved root + parsed/skipped counts + caps | `/memory` opens folders, toggles auto memory/dream, and shows dream status; no parser/cap status | **DELIBERATE CTRL-B DISCLOSURE** |
| No per-topic Conf editor | Source opens the corpus in an external editor/folder | **MATCH IN POSTURE** |
| Agent identity retained only as provenance | Pinned auto-memory frontmatter has no provenance; current live writer adds `originSessionId` but not readable here | **NOT SOURCE-DERIVED**; decide ctrl-b provenance separately |
| Every invocation audits through `ActionService` | Generic file tools emit file-operation/telemetry events; no memory-specific durable action audit | **CTRL-B HARDENING/REUSE** |
| Usage header: topic count and index-cap percentage | Source logs counts/lengths and appends truncation warnings, but does not inject this usage header | **DELIBERATE CTRL-B UX** |
| Invalid root yields one diagnostic and leaves agent unaffected | Source rejects invalid configured paths by falling back to another resolution path; runtime read failures fail empty | **SEMANTIC MATCH**, but test ctrl-b's exact diagnostic contract |

### 18.1 Answers to the five owner rulings, stated precisely

**O1 — headless policy.** Claude source does not establish a single "live everywhere" rule. Read access
and ordinary file tools are broad; automatic writers and SessionMemory are carefully restricted by mode,
agent depth, remote/bare state, and feature gates. Ctrl-b may choose symmetric all-session availability,
but should label it a product simplification, not source parity.

**O2 — unqualified remember.** Claude's instruction is immediate save without asking, after eligibility
filters. This supports no-dialog capture. It does not answer how a two-tier product should route; ctrl-b's
durability/scope policy remains its own decision.

**O3 — read actions.** Source decisively supports read/search capability for long-term topic memory. It
uses ordinary tools rather than a memory-specific tool. The important behavior is on-demand detail, not
the tool name.

**O4 — proactive writes and cleanup.** Claude combines three postures: main-model proactive writes,
background extraction, and optional periodic dream consolidation. A v1 with proactive writes but only
prompt/manual cleanup is a deliberate reduction. The source's repeated two-step and duplicate warnings
show why cleanup pressure exists; they do not require ctrl-b to copy the background machinery.

**O5 — phase ordering.** No answer exists in Claude source. This is exclusively ctrl-b planning.

---

## 19. What should change in the ctrl-b plan before implementation

The source pass does **not** overturn the plan's core mechanism. It supports it. The useful changes are
narrow clarifications, not a redesign:

1. **Stop calling O1 "match tier 1" or implying Claude parity.** Say Core Memory is enabled in all
   ctrl-b session origins by product choice; Claude's automatic memory actors are mode/depth gated.
2. **Distinguish API parity from behavior parity.** Claude uses standard Read/Grep/Write/Edit. Ctrl-b's
   dedicated `core_memory` tool preserves the behavior while enforcing corpus invariants.
3. **State that the 4,096 cap changes unit.** Claude's selective surfacer uses bytes; the plan says
   characters. Pick one deliberately and test Unicode.
4. **Decide whether ctrl-b needs a cumulative per-session recall cap.** Claude uses 60 KiB only in the
   selector cohort. A visible tool-result design can still accumulate payload across a long transcript.
5. **Preserve the scanner exclusions.** They are confirmed improvements over source, not speculative
   complexity: the source really will consider `logs/**/*.md`.
6. **Keep data-not-instructions framing.** Claude's startup authority wrapper is internally
   contradictory; parity would be a regression.
7. **Record the stronger write guarantees as ctrl-b hardening.** CAS, secret rejection, backup lock,
   byte preservation, and topic/index integrity are not source behavior.
8. **Add one cache invalidation acceptance for hand edits/reload.** Source's private lane is memoized
   without a watcher; ctrl-b promises copy-in/reload and D26 hand-edit reconciliation, so the exact
   reload boundary should be testable.
9. **Do not add SessionMemory promotion machinery to imitate Claude.** Claude has no such path.
10. **Do not add extractor/dream machinery for "completeness."** They are independent optional actors,
    and the plan already banks the background consolidator.

Everything else in the current plan — no selector, bounded index, literal search, one corpus, one tool,
no embeddings, no new backup subsystem, no speculative provider interface — remains consistent with the
source and with ponytail's shortest path.

---

## 20. Verification record

### 20.1 Repository baselines

- Claude source HEAD: `a371abbe75ffa0d0a3c92290e2bbf56a7ef54367`.
- Claude source working tree: clean before and after read-only inspection.
- Ctrl-b baseline before this dossier already contained unrelated/user work:
  `docs/CORE_MEMORY_PLAN.md` modified; `docs/research/R39-cap-triggered-tier-promotion.md` and several
  design-prototype directories untracked. This pass did not modify those artifacts.

### 20.2 Focused static assertions

A read-only Python check asserted the following symbols/contracts in the pinned source and passed:

- 200-line / 25,000-length index caps;
- 200-candidate / 30-line header scan;
- 5-file / 4,096-byte / 60-KiB selective caps;
- same `tengu_moth_copse` gate on selector and inverse index filtering;
- prefetch start plus zero-wait consume in `query.ts`;
- extraction five-turn cap, direct-write exclusion, coalesced trailing context;
- dream 24-hour / five-session / scan-throttle gates;
- team deletion non-propagation;
- SessionMemory deterministic truncation and compact-message construction.

Result: **10/10 checks passed**. The first draft of the check used three wrong symbol names and failed;
those names were corrected against the actual source before the passing run. No source behavior was
changed to make the check pass.

### 20.3 Test limitation

The source checkout exposes no executable TypeScript test files. Claims about runtime behavior are
therefore source-derived at this exact pin. Current Claude Code behavior remains unverified where the live
client has moved beyond the leaked source, especially frontmatter authorship and any post-pin memory
changes.

---

## 21. Final synthesis

Claude Code's core durable-memory architecture at this pin is deliberately boring:

```text
project-derived markdown corpus
  -> bounded always-loaded routing index
  -> ordinary main-model grep/read for detail
  -> ordinary write/edit for mutation
  -> prompt policy carries schema and hygiene
```

Around that small center, Anthropic experiments with or adds separate actors: async selective prefetch,
background extraction, periodic dream consolidation, team sync, append-only daily logs, per-agent
memory, and SessionMemory compaction. Those actors are not evidence that ctrl-b needs one unified memory
framework. They are evidence that the center stayed file-and-tool based while optional behavior was added
at the edges.

For ctrl-b, the source-backed implementation target is therefore:

- copy the **center**: bounded index, topic files, literal search, ordinary in-loop recall, fail-open reads;
- keep ctrl-b's existing infrastructure where it is already stronger: backup guard, audit path, prompt
  registry, tool gating, CAS, secret checks;
- reject source accidents: contradictory authority framing, code-unit "bytes", log ingestion, stale
  frontmatter assumptions, async first-answer miss;
- leave the optional actors out until a measured failure asks for one.

That is not a loose adaptation. It is the closest faithful implementation of what the ordinary Claude
Code cohort actually does, minus the parts the source itself reveals as experiments, variants, or bugs.
