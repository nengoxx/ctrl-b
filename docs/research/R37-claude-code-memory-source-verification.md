# R37 — Claude Code's memory system, verified against source

| | |
|---|---|
| **Question** | Do the source-level claims that the "Hermes Core Memory" spec rests on actually hold in the Claude Code source? Adversarial, independent (non-Codex) corroboration of a Codex-authored evidence base. |
| **Date** | 2026-08-16 |
| **Primary source** | `/home/emma/github/claude-code` pinned at **`a371abbe75ffa0d0a3c92290e2bbf56a7ef54367`** (verified `git rev-parse HEAD`, clean tree). This is the 2026-03-31 npm-sourcemap leak of the original TypeScript — real source, not decompiled. Repo commit date **2026-04-05**. |
| **Secondary source** | Live corpora at `~/.claude/projects/-home-emma-github-ctrl-b/memory` (56 topics) and `~/.claude/projects/-home-emma/memory` (5 topics), read-only. Official docs at <https://code.claude.com/docs/en/memory>. |
| **Spec under test** | `/home/emma/Documents/Maia/40 Projects/2026-08-11-project-scoped-profile-memory-architecture/` — `SPEC.md` + `LOG.md` (sections "Initial Claude Code evidence", "Reconciled Claude Code findings", "Adversarial Claude source re-audit with Luna", "Claude-native interchangeable-root requirement"). |
| **Confidence key** | **VERIFIED** = I opened the file and read the cited lines myself. **REPORTED** = from a fetched doc page (reader-model summary). **UNVERIFIABLE** = runtime state not present in source. |
| **Standing caveat** | The pin is **~4.5 months stale** relative to the installed client (`claude --version` → **2.1.233**). §13 shows this is not academic: the live corpus is written in a frontmatter shape that **does not exist anywhere in the pinned source**. |

---

## 0. Verdict table

| # | Claim (compressed) | Verdict |
|---|---|---|
| 1 | `MEMORY.md` = concise index, 200 lines / 25,000 bytes; entries `- [Title](file.md) — hook` | **CONFIRMED** (two byte-cap nuances, §1) |
| 2 | Frontmatter = top-level `name`/`description`/`type` ∈ {user,feedback,project,reference}; unknown type degrades gracefully | **CONFIRMED** |
| 3 | Recursive `.md` scan, excludes basename `MEMORY.md`, first ~30 lines, keeps 200 newest | **CONFIRMED** |
| 4 | Side-model selector (default Sonnet), filename/description manifest, ≤5 exact filenames, closed structured output, precision-biased, fails closed | **CONFIRMED-WITH-QUALIFICATION** — schema is *not* closed over filenames; manifest carries more than the spec says; a `recentTools` rule the spec never mentions |
| 5 | ≤200 lines / 4,096 B per file; ≤5 files / ~20 KiB per turn; 60 KiB per uncompacted session; dedup; state rebuilt from transcript so compaction re-permits | **CONFIRMED** |
| 6 | **Recall prefetch starts before the first model iteration but never blocks it; consumed only after a tool phase; a tool-free first response gets no topic memory; unsettled selection aborted at turn end** | **CONFIRMED** — and *stronger* than the spec states (§6). One material qualification: the whole recall path is **cohort-gated** and mutually exclusive with the index. |
| 7 | Index loads via the CLAUDE.md pipeline ("AutoMem") as a hidden user `<system-reminder>` under instruction-like authority framing; `tengu_moth_copse` suppresses it | **CONFIRMED** — with a self-contradicting double wrapper the spec never notes (§7) |
| 8 | Root = canonical git root → stable project root; trusted settings/Cowork overrides; project settings can **not** choose an arbitrary path | **CONFIRMED** (and the official docs are **wrong** here — §15) |
| 9 | Main-model direct writes (two-step) + feature/GrowthBook-gated background extractor (5-turn fork, cursor advances on success only, skips main-model-written ranges, silent failure, forbidden to verify) | **CONFIRMED-WITH-QUALIFICATION** — silent on *failure*, but it **does** notify on success |
| 10 | Exclusions override explicit "remember this" | **CONFIRMED** (verbatim, §10) |
| 11 | Dream: optional, ~24 h + 5 sessions, 10-min scan throttle, per-corpus lock, rollback on failure; merge-not-duplicate, delete contradicted, bound the index | **CONFIRMED** |
| 12 | KAIROS append-only daily logs; team memory = second corpus/index, private-vs-team routing, server-wins sync that never propagates deletion | **CONFIRMED** |
| 13 | Live corpora use **historical** nested `metadata.type` rather than top-level `type` | **CORRECTED** — the *shape* is confirmed (61/61 files), but "historical" is **wrong**: it is what the **current** client wrote **today**, and the pinned source contains **no writer that emits it** |

**One CORRECTED claim (#13), two qualified (#4, #9), one qualified-upward (#6).** Nothing the spec relies on collapses; the corrected item does invert one of the spec's write rules.

---

## 1. `MEMORY.md` as a bounded index — CONFIRMED

`src/memdir/memdir.ts:34–38` — **VERIFIED**:

```ts
export const ENTRYPOINT_NAME = 'MEMORY.md'
export const MAX_ENTRYPOINT_LINES = 200
// ~125 chars/line at 200 lines. At p97 today; catches long-line indexes that
// slip past the line cap (p100 observed: 197KB under 200 lines).
export const MAX_ENTRYPOINT_BYTES = 25_000
```

The entry form, `memdir.ts:227` — **VERIFIED**, verbatim:

> `**Step 2** — add a pointer to that file in \`${ENTRYPOINT_NAME}\`. \`${ENTRYPOINT_NAME}\` is an index, not a memory — each entry should be one line, under ~150 characters: \`- [Title](file.md) — one-line hook\`. It has no frontmatter. Never write memory content directly into \`${ENTRYPOINT_NAME}\`.`

Two nuances the spec's "200 lines / 25,000 bytes" summary flattens:

- **The "byte" cap is not bytes.** `truncateEntrypointContent` (`memdir.ts:57–103`) computes `byteCount = trimmed.length` — a JS UTF-16 code-unit count, not UTF-8 bytes. An index full of em-dashes and emoji (ctrl-b's live index is exactly that) is measured *under* its true byte size. A reimplementation in Python should decide deliberately whether to mirror the loose semantics or use real bytes.
- **The per-entry length guidance is internally inconsistent.** The prompt says "under ~150 characters" (`memdir.ts:227`, `extractMemories/prompts.ts:76`); the truncation *warning* says "Keep index entries to one line under ~200 chars" (`memdir.ts:97`); the dream prompt says "one line under ~150 characters" *and* "if an index line is over ~200 chars … shorten the line" (`autoDream/consolidationPrompt.ts:55,58`). Three numbers, one rule. Don't mirror the inconsistency.

Truncation is **soft and warned, never rejected** — over-cap content is cut and a `> WARNING:` line naming which cap fired is appended (`memdir.ts:87–97`). Reading the index never fails.

---

## 2. Topic frontmatter — CONFIRMED

`src/memdir/memoryTypes.ts:14–31` — **VERIFIED**:

```ts
export const MEMORY_TYPES = ['user','feedback','project','reference'] as const
…
export function parseMemoryType(raw: unknown): MemoryType | undefined {
  if (typeof raw !== 'string') return undefined
  return MEMORY_TYPES.find(t => t === raw)
}
```

with the comment (`:23–27`): *"Invalid or missing values return undefined — legacy files without a `type:` field keep working, files with unknown types degrade gracefully."*

The written shape, `memoryTypes.ts:261–271` (`MEMORY_FRONTMATTER_EXAMPLE`) — **VERIFIED**: top-level `name`, `description` (*"one-line description — used to decide relevance in future conversations, so be specific"*), `type`. Nothing else. No IDs, no confidence, no provenance, no schema version.

Degradation is real, not aspirational: an untyped file still becomes a scan candidate (`memoryScan.ts:61` sets `type: parseMemoryType(frontmatter.type)` and nothing filters on it) and still reaches the selector, just without its `[type]` manifest tag (`memoryScan.ts:87`).

---

## 3. Scan — CONFIRMED

`src/memdir/memoryScan.ts:21–22, 40–43, 66–73` — **VERIFIED**:

```ts
const MAX_MEMORY_FILES = 200
const FRONTMATTER_MAX_LINES = 30
…
const entries = await readdir(memoryDir, { recursive: true })
const mdFiles = entries.filter(f => f.endsWith('.md') && basename(f) !== 'MEMORY.md')
…
  .sort((a, b) => b.mtimeMs - a.mtimeMs)
  .slice(0, MAX_MEMORY_FILES)
```

All four sub-claims hold exactly. Note the exclusion is by **basename**, so `team/MEMORY.md` and any nested index is excluded too — and a nested corpus's index is invisible to recall.

Worth mirroring: the scan is **single-pass** — `readFileInRange` stats internally and returns `mtimeMs`, so it reads-then-sorts rather than stat-sort-reads (`memoryScan.ts:29–34`). Failures are per-file and swallowed (`Promise.allSettled` + `.filter(fulfilled)`); a whole-directory failure returns `[]` (`:74–76`). Recall degrades to nothing, never to an error.

---

## 4. The selector — CONFIRMED-WITH-QUALIFICATION

**Model: confirmed.** `findRelevantMemories.ts:99` → `model: getDefaultSonnetModel()`, which is `sonnet46` first-party / `sonnet45` for 3P, overridable by `ANTHROPIC_DEFAULT_SONNET_MODEL` (`src/utils/model/model.ts:119–128`). **VERIFIED.**

**The prompt, verbatim** (`findRelevantMemories.ts:18–24`) — this is the artifact the spec's §"selector contract" paraphrases, and it is worth mirroring more closely than the spec does:

```
You are selecting memories that will be useful to Claude Code as it processes a user's query. You will be given the user's query and a list of available memory files with their filenames and descriptions.

Return a list of filenames for the memories that will clearly be useful to Claude Code as it processes the user's query (up to 5). Only include memories that you are certain will be helpful based on their name and description.
- If you are unsure if a memory will be useful in processing the user's query, then do not include it in your list. Be selective and discerning.
- If there are no memories in the list that would clearly be useful, feel free to return an empty list.
- If a list of recently-used tools is provided, do not select memories that are usage reference or API documentation for those tools (Claude Code is already exercising them). DO still select memories containing warnings, gotchas, or known issues about those tools — active use is exactly when those matter.
```

**The structured output, verbatim** (`:108–119`):

```ts
max_tokens: 256,
output_format: {
  type: 'json_schema',
  schema: {
    type: 'object',
    properties: { selected_memories: { type: 'array', items: { type: 'string' } } },
    required: ['selected_memories'],
    additionalProperties: false,
  },
},
```

**Qualification 1 — "closed structured output" is only half true.** The *envelope* is closed (`additionalProperties: false`), but `selected_memories` is `array of string` — **not** an enum over the offered filenames. Closure is enforced *after* the call, in code: `parsed.selected_memories.filter(f => validFilenames.has(f))` (`:130`). A hallucinated filename is silently dropped; there is no cap of 5 enforced in code either (the `.slice(0, 5)` lives downstream at `attachments.ts:2234`). For a reimplementation this matters: the closure is a **post-filter**, not a schema guarantee, and that is the cheaper and more portable choice across providers.

**Qualification 2 — the manifest carries more than "filename + description."** `formatMemoryManifest` (`memoryScan.ts:84–94`) emits `- [type] relative/path.md (2026-08-16T15:52:44.811Z): description`. The **ISO mtime** and the **type tag** are both selector inputs the spec's manifest description omits.

**Qualification 3 — a de-noising rule the spec never mentions.** `recentTools` is threaded in (`:92–95`, `collectRecentSuccessfulTools` at the call site) precisely to suppress the keyword false-positive of surfacing a tool's own reference doc while that tool is in active use. That is field-earned and cheap; a reimplementation that omits it will hit the same false positive.

**Fails closed: confirmed.** Any throw → `return []` with a warn-level debug log (`:131–140`); abort → `return []` silently. Empty candidate set short-circuits before the model call (`:49–51`) — matching the spec's "no selector call when deterministic code finds no candidates."

**Pre-filter before the call: confirmed and load-bearing.** `alreadySurfaced` is filtered *before* the selector runs (`:46–48`) so "Sonnet spends its 5-slot budget on fresh candidates."

**Cost, measured on the live corpus (VERIFIED).** 56 topics → ~20 KB manifest (~5k tokens) per selector call. One description is **6,337 characters** (`gacha-theme-progress.md`); the median is 157. **Nothing in the source caps `description` length.** At the 200-file cap with unbounded descriptions the manifest is unbounded. If ctrl-b builds this, cap the description at read time — that is a constant Claude Code is missing, not one to mirror.

---

## 5. Surfacing caps — CONFIRMED

All **VERIFIED** in `src/utils/attachments.ts`:

- `:269` `const MAX_MEMORY_LINES = 200`
- `:277` `const MAX_MEMORY_BYTES = 4096`, with the reasoning verbatim at `:270–276`: *"Line cap alone doesn't bound size (200 × 500-char lines = 100KB). The surfacer injects up to 5 files per turn via `<system-reminder>`, bypassing the per-message tool-result budget, so a tight per-file byte cap keeps aggregate injection bounded (5 × 4KB = 20KB/turn)."*
- `:279–289` `RELEVANT_MEMORIES_CONFIG.MAX_SESSION_BYTES: 60 * 1024`, with the empirical justification verbatim: *"over a long session the selector keeps surfacing distinct files — ~26K tokens/session observed in prod. Cap the cumulative bytes: once hit, stop prefetching entirely."*
- `:2234` `.slice(0, 5)` — the ≤5-files-per-turn cap.
- Dedup against **both** already-surfaced paths and `readFileState` (files the model itself Read/Wrote/Edited) — `:2231–2234`, described in-source as "belt-and-suspenders."
- **Surfaced state reconstructed from the transcript**: `collectSurfacedMemories` (`:2251–2265`) walks `messages` for `relevant_memories` attachments. Verbatim rationale (`:2245–2250`): *"Scanning messages rather than tracking in toolUseContext means compact naturally resets both — old attachments are gone from the compacted transcript, so re-surfacing is valid again."* The compaction-permits-re-surfacing claim is **explicitly designed**, not incidental.
- Truncation is soft: the file still surfaces with an appended `> This memory file was truncated (…). Use the Read tool to view the complete file at: <path>` (`:2303–2307`).

**Beyond the spec:** every surfaced memory is prefixed with a **freshness header** (`memoryHeader`, `:2327–2332` → `src/memdir/memoryAge.ts`). For anything >1 day old the injected text leads with, verbatim:

> `This memory is ${d} days old. Memories are point-in-time observations, not live state — claims about code behavior or file:line citations may be outdated. Verify against current code before asserting as fact.`

The in-source motivation (`memoryAge.ts:32–36`): *"user reports of stale code-state memories (file:line citations to code that has since changed) being asserted as fact — the citation makes the stale claim sound more authoritative, not less."* The spec's P3 surface names "freshness" but not this failure mode; the *reason* is the useful part.

---

## 6. The timing claim — CONFIRMED, and stronger than stated

This is the claim the spec's whole core divergence rests on, so it got the hardest look. It holds, on three independent structural facts.

**(a) The prefetch is fired once per turn, before the loop, and is explicitly non-blocking.** `src/query.ts:297–303` — **VERIFIED**, verbatim comment + code:

```ts
// Fired once per user turn — the prompt is invariant across loop iterations,
// so per-iteration firing would ask sideQuery the same question N times.
// Consume point polls settledAt (never blocks). `using` disposes on all
// generator exit paths — see MemoryPrefetch for dispose/telemetry semantics.
using pendingMemoryPrefetch = startRelevantMemoryPrefetch(
  state.messages,
  state.toolUseContext,
)
```

The type's own docstring (`attachments.ts:2334–2344`): *"The promise is started once per user turn and runs while the main model streams and tools execute. At the collect point (post-tools), the caller reads settledAt to consume-if-ready or skip-and-retry-next-iteration — **the prefetch never blocks the turn**."*

**(b) The consume point is unreachable on a tool-free response.** Traced end to end — **VERIFIED**:

- `needsFollowUp` is set `true` **only** when the assistant emitted `tool_use` blocks (`query.ts:832–834`).
- `if (!needsFollowUp) { … return { reason: 'completed' } }` (`query.ts:1062` … `:1357`).
- The memory consume block lives at `query.ts:1596–1614`, i.e. **after** tool execution, inside the follow-up path.

So a tool-free first response returns from the loop before the memory attachments are ever read. Not "may arrive late" — **structurally cannot arrive**.

**(c) Even when tools do run, the memory lands one model call late.** The consume block yields the attachments into `toolResults` (`:1605–1612`), which are sent on the *next* API call. So the earliest a selected topic can influence generation is the **second** model call of the turn. And the consume is zero-wait — verbatim (`query.ts:1591–1595`): *"only if settled and not already consumed on an earlier iteration. If not settled yet, skip (zero-wait) and retry next iteration — the prefetch gets as many chances as there are loop iterations before the turn ends."*

**(d) Unsettled selection is aborted at turn end: confirmed.** `[Symbol.dispose]()` calls `controller.abort()` and logs `hidden_by_first_iteration` telemetry (`attachments.ts:2410–2419`). Anthropic is *measuring* this miss — the metric name is the admission.

### The qualification that matters more than the claim

**The recall path only exists inside the `tengu_moth_copse` cohort.** `attachments.ts:2361–2369` — **VERIFIED**:

```ts
export function startRelevantMemoryPrefetch(…): MemoryPrefetch | undefined {
  if (
    !isAutoMemoryEnabled() ||
    !getFeatureValue_CACHED_MAY_BE_STALE('tengu_moth_copse', false)
  ) {
    return undefined
  }
```

That is the **same flag** that removes the index from initial context (`claudemd.ts:1143–1150`, `filterInjectedMemoryFiles`). Therefore, in the pinned source:

| Cohort | `MEMORY.md` in context | Query-time topic recall |
|---|---|---|
| ordinary (flag off) | **yes** | **none at all** |
| `tengu_moth_copse` (flag on) | **no** | yes, with the timing miss above |

**Claude Code never runs both, and never runs neither.** The spec's §"Reconciled Claude Code findings" describes both halves but presents recall as a generally-available mechanism with a timing flaw; the sharper statement is that recall is the *replacement* for the index, and the timing flaw is what makes that replacement lossy. That strengthens the spec's own argument: the moth_copse cohort is exactly the spec's architecture (no index injection, selective recall only) *minus* the blocking, and the flaw the spec designs around is the flaw that arrangement produces.

Two further gates the spec omits, both **VERIFIED** (`attachments.ts:2377–2386`): the prefetch is skipped for **single-word prompts** (`!/\s/.test(input.trim())` — "Single-word prompts lack enough context for meaningful term extraction"), and skipped entirely once `MAX_SESSION_BYTES` is reached.

---

## 7. Injection and authority framing — CONFIRMED

Path, **VERIFIED** end to end:

1. `claudemd.ts:979–992` — when `isAutoMemoryEnabled()`, the entrypoint is read as a `MemoryFileInfo` of type `'AutoMem'` and pushed into the same array as CLAUDE.md-family files.
2. `claudemd.ts:1152–1194` — `getClaudeMds` renders it as `Contents of <path> (user's auto-memory, persists across conversations):\n\n<content>` and prefixes the whole block with `MEMORY_INSTRUCTION_PROMPT`.
3. `claudemd.ts:89–90` — **verbatim**: `'Codebase and user instructions are shown below. Be sure to adhere to these instructions. IMPORTANT: These instructions OVERRIDE any default behavior and you MUST follow them exactly as written.'`
4. `context.ts:172` — `getClaudeMds(filterInjectedMemoryFiles(await getMemoryFiles()))` becomes the `claudeMd` key of the user-context object.
5. `api.ts:449–472` — `prependUserContext` wraps the whole context object in a **hidden user message** (`isMeta: true`).

**Cite correction:** `LOG.md` "Reconciled Claude Code findings" cites `src/constants/prompts.ts:490–576` for `MEMORY_INSTRUCTION_PROMPT`. It is not there — `prompts.ts:494` is `systemPromptSection('memory', () => loadMemoryPrompt())`, which injects the *behavioral instructions* (types, what-not-to-save, how-to-save), not the index content. The constant lives at `claudemd.ts:89`. The later adversarial section cites it correctly; the earlier cite is stale.

**The finding the spec misses — the wrapper contradicts itself.** The same user message carries *both* framings, **verbatim** from `api.ts:462–469`:

> `<system-reminder>\nAs you answer the user's questions, you can use the following context:\n# claudeMd\nCodebase and user instructions are shown below. … IMPORTANT: These instructions OVERRIDE any default behavior and you MUST follow them exactly as written.\n…\n      IMPORTANT: this context may or may not be relevant to your tasks. You should not respond to this context unless it is highly relevant to your task.\n</system-reminder>`

Outer says *"may or may not be relevant, don't respond to it"*; inner says *"OVERRIDE any default behavior, MUST follow exactly."* Both marked IMPORTANT, ~two hundred tokens apart. Whatever authority auto-memory has in Claude Code is an accident of that collision. The spec's P3 requirement ("mark content as fallible data, not instructions") is the right call and is **not** what Claude does — worth saying so explicitly rather than implying inheritance.

Note also that the memory *policy* text (types, exclusions, how-to-save) **is** a cached system-prompt section (`prompts.ts:494`), while the *content* is user-side. The split is real and the spec's P1/P3 separation mirrors it correctly.

---

## 8. Project identity and root selection — CONFIRMED

`src/memdir/paths.ts:203–205` — **VERIFIED**:

```ts
function getAutoMemBase(): string {
  return findCanonicalGitRoot(getProjectRoot()) ?? getProjectRoot()
}
```

with the comment (`:198–202`) naming the reason: *"Uses findCanonicalGitRoot so all worktrees of the same repo share one auto-memory directory (anthropics/claude-code#24382)."*

Resolution order (`:207–235`): `CLAUDE_COWORK_MEMORY_PATH_OVERRIDE` env → `autoMemoryDirectory` setting → `<memoryBase>/projects/<sanitized-git-root>/memory/`.

**The "project settings cannot choose the path" claim is confirmed, verbatim** (`paths.ts:168–186`):

```ts
/**
 * SECURITY: projectSettings (.claude/settings.json committed to the repo) is
 * intentionally excluded — a malicious repo could otherwise set
 * autoMemoryDirectory: "~/.ssh" and gain silent write access to sensitive
 * directories via the filesystem.ts write carve-out …
 */
function getAutoMemPathSetting(): string | undefined {
  const dir =
    getSettingsForSource('policySettings')?.autoMemoryDirectory ??
    getSettingsForSource('flagSettings')?.autoMemoryDirectory ??
    getSettingsForSource('localSettings')?.autoMemoryDirectory ??
    getSettingsForSource('userSettings')?.autoMemoryDirectory
  return validateMemoryPath(dir, true)
}
```

**Directly reusable — the path validator.** `validateMemoryPath` (`:109–150`) rejects: non-absolute, length < 3 (`/`, `/a`), Windows drive-root (`C:`), UNC (`\\server`, `//server`), embedded `\0`, and bare-`~` expansions that would resolve to `$HOME` or an ancestor. It NFC-normalizes and guarantees exactly one trailing separator. That is five real attack classes closed in forty lines, and it is a better starting point than writing one fresh. **It does not reject symlinks or non-regular files** — the spec's production reviewer added those; that addition is a genuine improvement over Claude, not a mirror of it.

Also note `isAutoMemPath` (`:274–278`) is a `normalize().startsWith(root)` prefix test — the containment invariant every write is checked against (§9). Prefix tests on normalized strings have a known sibling-directory failure mode (`/memory` vs `/memory-old`); here the root always carries a trailing `sep`, which closes it. Keep the trailing separator if you copy this.

---

## 9. Writes — CONFIRMED-WITH-QUALIFICATION

**Main-model two-step: confirmed** — §1's `memdir.ts:227` quote, plus the proactivity/explicit-request line (`memdir.ts:243`), verbatim:

> `If the user explicitly asks you to remember something, save it immediately as whichever type fits best. If they ask you to forget something, find and remove the relevant entry.`

and the update-over-duplicate rule (`memdir.ts:233`), verbatim:

> `- Do not write duplicate memories. First check if there is an existing memory you can update before writing a new one.`

**Background extractor: confirmed on every sub-claim.** All **VERIFIED**:

| Sub-claim | Evidence |
|---|---|
| Runs at turn end, only on a complete loop | `query/stopHooks.ts:141–152`, fired from `handleStopHooks` |
| Compile-time + GrowthBook + mode gates | `feature('EXTRACT_MEMORIES')` + `!agentId` + `isExtractModeActive()` (`stopHooks.ts:141–145`); `tengu_passport_quail` (`paths.ts:70`, re-checked `extractMemories.ts:536`); `!isBareMode()` (`stopHooks.ts:136`); `!getIsRemoteMode()` (`:551`) |
| Per-N-turn throttle | `tengu_bramble_lintel`, default 1 (`extractMemories.ts:374–385`) |
| 5-turn fork | `maxTurns: 5` — *"Well-behaved extractions complete in 2-4 turns (read → write). A hard cap prevents verification rabbit-holes from burning turns."* (`:424–426`) |
| Cursor advances only on success | `:428–435`, *"Advance the cursor only after a successful run. If the agent errors out (caught below), the cursor stays put so those messages are reconsidered on the next extraction."* |
| Skips ranges the main model already wrote | `hasMemoryWritesSince` (`:107–140`) + the skip branch (`:344–359`), *"making the main agent and the background agent mutually exclusive per turn"* |
| Confined to the memory dir | `createAutoMemCanUseTool` (`:166–222`): Read/Grep/Glob unrestricted, Bash only if `isReadOnly`, Edit/Write only if `isAutoMemPath(file_path)`, everything else denied |
| Forbidden to verify externally | `extractMemories/prompts.ts:41`, **verbatim**: `You MUST only use content from the last ~${newMessageCount} messages to update your persistent memories. Do not waste any turns attempting to investigate or verify that content further — no grepping source files, no reading code to confirm a pattern exists, no git commands.` |

**Qualification: "silent failure" is only true of failure.** On error: `logForDebugging` + a telemetry event, no user message — *"Extraction is best-effort — log but don't notify on error"* (`:496–501`). But on **success** it *does* notify: `appendSystemMessage(createMemorySavedMessage(memoryPaths))` (`:490–495`), and index-only writes are filtered out of that count (`:465–468`) so the user sees "Saved 2 memories," not "3 files written." The spec's LOG says "fails silently to the user," which is right; the SPEC's mental model of a wholly invisible writer is not. **Observability asymmetry — loud on success, silent on failure — is a deliberate design choice worth copying or rejecting on purpose.**

Two more reusable details: the extractor **pre-injects the manifest** so the fork doesn't burn a turn on `ls` (`:397–401`), and it gives an explicit turn-budget strategy — *"turn 1 — issue all Read calls in parallel … turn 2 — issue all Write/Edit calls in parallel. Do not interleave reads and writes across multiple turns."* (`prompts.ts:39`). Concurrent runs coalesce to a single trailing run rather than queueing (`:555–564`).

---

## 10. Eligibility overrides explicit requests — CONFIRMED

`memoryTypes.ts:183–195` — **VERIFIED**, verbatim:

```
## What NOT to save in memory

- Code patterns, conventions, architecture, file paths, or project structure — these can be derived by reading the current project state.
- Git history, recent changes, or who-changed-what — `git log` / `git blame` are authoritative.
- Debugging solutions or fix recipes — the fix is in the code; the commit message has the context.
- Anything already documented in CLAUDE.md files.
- Ephemeral task details: in-progress work, temporary state, current conversation context.

These exclusions apply even when the user explicitly asks you to save. If they ask you to save a PR list or activity summary, ask what was *surprising* or *non-obvious* about it — that is the part worth keeping.
```

The last line carries an eval provenance comment (`:192–193`): *"H2: explicit-save gate. Eval-validated (memory-prompt-iteration case 3, 0/2 → 3/3): prevents 'save this week's PR list' → activity-log noise."* Several of these prompt sections carry similar receipts (H1/H5/H6 at `:206–239`), including a **negative** result worth knowing: the same text scored 3/3 as its own `## Before recommending from memory` section and **0/3** when demoted to a bullet under "When to access memories." Section placement was worth three eval points. If ctrl-b ports this guidance, port the sectioning too.

---

## 11. Consolidation ("dream") — CONFIRMED

All **VERIFIED**:

- Enabled gate: `autoDreamEnabled` setting overrides GrowthBook `tengu_onyx_plover.enabled`, default off (`autoDream/config.ts:13–21`).
- Thresholds: `const DEFAULTS: AutoDreamConfig = { minHours: 24, minSessions: 5 }`, GrowthBook-overridable with per-field type validation (`autoDream.ts:63–90`).
- Scan throttle: `const SESSION_SCAN_INTERVAL_MS = 10 * 60 * 1000` (`:56`), existing because *"when time-gate passes but session-gate doesn't, the lock mtime doesn't advance, so the time-gate keeps passing every turn."*
- Excluded in KAIROS and remote mode (`isGateOpen`, `:93–98`).
- Lock: `.consolidate-lock` **inside the memory directory**, whose **mtime *is* `lastConsolidatedAt`** and whose body is the holder PID; 1-hour staleness guard against PID reuse; rollback rewinds the mtime on failure (`consolidationLock.ts:1–60`; `autoDream.ts:182, 270`).
- Prompt behavior — merge, absolutize dates, delete contradicted, bound the index (`consolidationPrompt.ts:44–61`), verbatim highlights: *"Merging new signal into existing topic files rather than creating near-duplicates"*; *"Deleting contradicted facts — if today's investigation disproves an old memory, fix it at the source"*; *"Update `MEMORY.md` so it stays under 200 lines AND under ~25KB. It's an **index**, not a dump."*
- Writes confined by the same `createAutoMemCanUseTool` as extraction.

**Direct conflict with a spec invariant.** SPEC §2 requires: *"Hermes-only configuration, locks, caches, or metadata must live outside an attached corpus so that enabling and reading an existing Claude root does not modify it."* Claude Code does the **opposite** — its lock lives at `join(getAutoMemPath(), '.consolidate-lock')`, deliberately: *"Lives inside the memory dir (getAutoMemPath) so it keys on git-root like memory does, and so it's writable even when the memory path comes from an env/settings override whose parent may not be."* (`consolidationLock.ts:3–5`). The spec's rule is the better one for an *attached* corpus, but implementers should know the corpus they attach may **already** contain a `.consolidate-lock` and (from `paths.ts:246–251`) a `logs/YYYY/MM/` tree, and that Claude's own writability argument is a real constraint if the corpus root is somewhere the parent directory isn't writable.

---

## 12. Variants are separate — CONFIRMED

**KAIROS** (`memdir.ts:318–370`, `paths.ts:237–251`) — **VERIFIED**: append-only `<autoMemPath>/logs/YYYY/MM/YYYY-MM-DD.md`; the model is told *"Do not rewrite or reorganize the log — it is append-only. A separate nightly process distills these logs into `MEMORY.md` and topic files."* Precedence over TEAMMEM is explicit in code and comment (`memdir.ts:427–438`): *"the append-only log paradigm does not compose with team sync."*

**Team memory** — **VERIFIED**: second corpus at `join(getAutoMemPath(), 'team')` with its own `MEMORY.md` (`teamMemPaths.ts:82–93`); gated on `tengu_herring_clock` **and** auto memory (`:73–78`); per-type private/team routing baked into `TYPES_SECTION_COMBINED` (`memoryTypes.ts:37–104`) — `user` "always private", `feedback` "default to private … team only when clearly a project-wide convention", `project` "strongly bias toward team", `reference` "usually team"; a team-only sensitive-data prohibition (`teamMemPrompts.ts`, `extractMemories/prompts.ts:150`).

Sync semantics, **verbatim** from `services/teamMemorySync/index.ts:14–19`:

```
 * Sync semantics:
 *   - Pull overwrites local files with server content (server wins per-key).
 *   - Push uploads only keys whose content hash differs from serverChecksums
 *     (delta upload). Server uses upsert: keys not in the PUT are preserved.
 *   - File deletions do NOT propagate: deleting a local file won't remove it
 *     from the server, and the next pull will restore it locally.
```

Server-wins + non-propagating deletion, exactly as claimed. Team content also gets a **distinct** context wrapper — `<team-memory-content source="shared">` (`claudemd.ts:1181–1184`) — a provenance marker the private lane does not get.

---

## 13. Live-format compatibility — **CORRECTED**

**The shape claim is confirmed.** Census across both local corpora (read-only, **VERIFIED**):

| Corpus | Topic files | Top-level `type:` | `metadata:` block | Top-level `name`/`description` |
|---|---|---|---|---|
| `-home-emma-github-ctrl-b/memory` | 56 | **0** | 56 | 56 / 56 |
| `-home-emma/memory` | 5 | **0** | 5 | 5 / 5 |

Both `MEMORY.md` files use plain relative Markdown links (`- [Title](file.md) — hook`); ctrl-b's is 68 lines / 14,596 bytes — inside both caps. The observed frontmatter:

```yaml
---
name: hardening-initiative-progress
description: "…"
metadata: 
  node_type: memory
  type: project
  originSessionId: 5041bdb8-34c0-40ab-81ff-5c21cae8ed42
  modified: 2026-08-16T15:52:44.811Z
---
```

Against the pinned scanner (`memoryScan.ts:61`, `frontmatter.type`), **every one of these 61 files parses as `type: undefined`** and reaches the selector with no `[type]` tag. Graceful degradation is not a corner case here — it is 100% of the live corpus.

**What the spec got wrong: "historical."** `LOG.md` §"Live-format compatibility evidence" calls the nested form *historical* and SPEC §"Topic files" instructs: *"tolerate missing/unknown `type` and historical nested metadata"* while *"New Core Memory topics use Claude-compatible frontmatter"* with top-level `type`. Three findings break that framing:

1. The newest file in the ctrl-b corpus was written **today, 2026-08-16 15:52 UTC**, and uses the nested form.
2. `grep -rn "node_type\|originSessionId" src/` over the pinned checkout returns **nothing**. The pinned source has **no writer that produces this shape.**
3. The installed client is **2.1.233**; the pin is from **2026-04-05**.

So the nested `metadata` block is not a legacy remnant that the current shape replaced — it is what the **current** client writes, produced by code **absent from the leak**. The pinned source's top-level `type` is the *older or divergent* form of the two.

**Consequence for the spec's write rule.** "Write new files in Claude's current top-level `type` format" would make the implementing product the **odd writer in a live corpus**: its `type` would sit where the current client neither writes nor (as far as this evidence shows) reads, and files would visibly differ from every neighbour. The safe rules are (a) read both shapes — `type` and `metadata.type`; (b) on **update**, preserve whichever shape the file already has; (c) for **new** files in an attached corpus, match the shape of the existing files rather than a constant from a stale pin. The spec's own "conservative on write / never normalize / leave untouched files byte-identical" instincts are right; only the direction of "current" is inverted.

Note also the fields the pin doesn't know about: `node_type`, `originSessionId`, `modified`. The official docs (**REPORTED**) describe the `modified` stamp as *"Claude Code records the write time in a `modified` frontmatter field as an ISO 8601 timestamp … requires Claude Code v2.1.214 or later"* — post-dating the pin. `modified` is a **content-derived freshness signal** that would beat `mtimeMs` for a corpus under git or rsync (where mtime is destroyed). Worth adopting deliberately: the pinned recall path keys freshness entirely on filesystem mtime (`memoryScan.ts:59`, `memoryAge.ts`), which is fragile for any corpus that gets copied.

---

## 14. What a reimplementation should know that the spec direction omits

1. **Index and recall are alternatives, not layers.** One flag chooses between them (§6). A design that does both pays twice; a design that does neither has no continuity. The spec picks recall-only — the same bet as the `tengu_moth_copse` cohort — which is defensible, but it should be stated as *the same bet Anthropic is A/B testing*, not as a novel arrangement.
2. **The selector's closure is a post-filter, not a schema.** `array of string` + `validFilenames.has(f)` (§4). Cheaper, portable across providers, and the one place a reimplementation is *free* to be stricter (a real enum) if the provider supports it.
3. **Cap the description.** 6,337 characters in one live file, ~20 KB of manifest for 56 files, no cap anywhere in the source (§4). Manifest cost is the selector's whole cost, and it is unbounded upstream.
4. **The `recentTools` suppression rule** — don't surface a tool's own reference docs while that tool is in active use, but *do* surface its gotchas (§4, verbatim). Field-earned; free to copy.
5. **Freshness text, not timestamps.** *"Models are poor at date arithmetic — a raw ISO timestamp doesn't trigger staleness reasoning the way '47 days ago' does"* (`memoryAge.ts:11–13`). The injected header uses "47 days ago" plus a verify-before-asserting sentence; the *manifest* uses ISO. Two audiences, two formats, on purpose.
6. **The authority framing is a bug, not a model.** Claude's own wrapper says both "MUST follow exactly" and "may or may not be relevant" in one message (§7). The spec's "fallible data, not instructions" is a *correction* of Claude, and should be documented as such so nobody later "restores Claude parity."
7. **Prompt-section placement is eval-load-bearing.** Same text, own section = 3/3; demoted to a bullet = 0/3 (`memoryTypes.ts:224–239`). If prompt text is ported, port its structure.
8. **The two-step write has a failure mode the source names.** *"Never write memory content directly into `MEMORY.md`"* appears in every variant of the prompt — main, extraction, dream — which is what a rule looks like after it has been violated repeatedly. Index-only writes are also filtered out of the user-visible "saved N memories" count (`extractMemories.ts:465–468`).
9. **Constants worth mirroring:** 200 scan candidates · 30 header lines · ≤5 selections · 200 lines/4 KiB per surfaced file · ~20 KiB per turn · 60 KiB per session · 5-turn extraction fork. **Constants worth *not* mirroring:** the 25,000 "bytes" measured as UTF-16 length; the 150-vs-200 char per-entry inconsistency; the absent description cap.
10. **Every read path fails to empty, never to an error.** Directory unreadable → `[]`; per-file read failure → dropped; selector throw → `[]`; over-cap file → truncated with a pointer to the full path. There is no state in which memory breaks the turn. That is the single most copyable property of the whole subsystem.
11. **Locks and logs live *inside* the corpus** in Claude Code (§11). An attached corpus may already contain `.consolidate-lock` and `logs/`. A recursive `.md` scan that excludes only basename `MEMORY.md` **will pick up KAIROS daily logs as topic files** — worth an explicit exclusion.

---

## 15. Docs vs source — source wins

Checked against <https://code.claude.com/docs/en/memory> (**REPORTED**, fetched 2026-08-16).

| Topic | Docs say | Source at the pin | Reading |
|---|---|---|---|
| `autoMemoryDirectory` scope | *"read from any settings scope: user, project, local, policy, or `--settings`"* | `paths.ts:179–186` reads policy/flag/local/user; **projectSettings explicitly excluded** with a named attack (`autoMemoryDirectory: "~/.ssh"`) | **Direct contradiction.** Either the docs are loose about `.claude/settings.json` vs `.claude/settings.local.json`, or the rule changed post-pin under the "workspace trust" mechanism the docs mention. The spec's claim tracks the source and is the safe one to design against. |
| Index caps | *"first 200 lines … or the first 25KB, whichever comes first"* | `MAX_ENTRYPOINT_LINES = 200`, `MAX_ENTRYPOINT_BYTES = 25_000` | Agrees. Docs also describe a **post-write over-limit error** telling Claude to rewrite the index — **absent from the pin** (no match for "read limit" in `src/`). Post-pin addition. |
| `modified` frontmatter | *"records the write time in a `modified` frontmatter field … v2.1.214 or later"* | No stamping code anywhere in `src/` | Post-pin addition; present in the live corpus (§13). |
| Topic-file recall | *"Topic files … are not loaded at startup. Claude reads them on demand using its standard file tools when it needs the information."* | The `tengu_moth_copse` selector path loads them automatically, without a tool call | **The docs describe only the ordinary cohort.** The whole selector/prefetch mechanism the spec is modelled on is **undocumented**. |
| Memory types | Not mentioned at all | Four-type closed taxonomy driving prompt policy | Undocumented. |
| Background extraction / dream / team memory | Not mentioned | All three present and gated | Undocumented. |
| Framing | *"Both are loaded at the start of every conversation. Claude treats them as **context, not enforced configuration**."* | `MEMORY_INSTRUCTION_PROMPT` says *"OVERRIDE any default behavior and you MUST follow them exactly"* | The docs describe the intent; the prompt says the opposite (§7). |

The gap is large enough to state plainly: **the public documentation covers roughly the ordinary-cohort surface of this subsystem and none of its machinery.** Anyone designing against Claude Code's memory from the docs alone would build the wrong thing.

---

## 16. Implications for ctrl-b

*Short and separate, per this folder's conventions. This dossier was commissioned to verify an external spec; ctrl-b implications are secondary and none of them are decisions.*

1. **ctrl-b already has the "memory" problem in a different shape** — `docs/PROMPTS_PLAN.md`'s registry and the SQLite chat/memory store. Nothing here argues for adopting a file-corpus memory. What *is* portable regardless of backend: the **fail-to-empty** discipline (§14.10), the **freshness-text-not-timestamp** rule (§14.5), and the **exclusion list that overrides explicit user requests** (§10) — the last is a policy question ctrl-b's agent prompts have never had to answer.
2. **If a memory feature ever reaches ROADMAP**, the load-bearing design fork is §6's: pre-answer blocking recall vs. post-first-response async recall. Claude Code demonstrates the async form's failure mode with its own telemetry (`hidden_by_first_iteration`). A single-user LAN app with a local model has a very different latency budget than a hosted CLI — the blocking form the external spec chose is likely the right one here too, and this dossier is the evidence for it.
3. **The selector pattern is cheap and provider-agnostic** (§4): a manifest of names+descriptions, one small-model call, a post-filter against the valid set, fail closed. That shape would fit ctrl-b's existing side-call seams without a new abstraction — *if* a use case ever justifies it.
4. **Nothing here justifies a D-entry.** The dossier's value to ctrl-b is R37 as evidence in a future memory conversation, plus the §15 lesson that Claude Code's public docs are a poor model of its actual behavior — relevant every time we compare our harness to Claude Code from documentation.

---

## 17. What the spec got wrong

1. **"Historical nested `metadata.type`" (CORRECTED, §13).** It is the current shape from the current client, and the pinned source contains no writer for it. The write rule that follows from the mischaracterization — new files in top-level `type` form — would make the implementing product the odd writer in any live corpus it attaches. This is the one finding that should change the spec text.
2. **`MEMORY_INSTRUCTION_PROMPT` cited to `src/constants/prompts.ts:490–576` (§7).** It lives at `src/utils/claudemd.ts:89–90`. The later adversarial section has it right; the earlier one is stale and would send a reader to the wrong file.
3. **Recall presented as a general mechanism with a timing flaw, rather than as the index's replacement (§6).** Not wrong, but under-stated: `tengu_moth_copse` gates *both* halves, so Claude never runs index-plus-recall. This makes the spec's own architecture *more* precedented than it claims — and makes the timing miss a property of that specific arrangement rather than of Claude's memory generally.
4. **"Fails silently" applied to the whole extractor (§9).** Silent on failure, but it emits a user-visible "Saved N memories" on success. Minor, but it changes the observability contract a reimplementation would inherit.
5. **Under-specified: the selector manifest (§4).** The spec says "filenames/descriptions"; the source sends `[type] path (ISO-mtime): description` plus a recently-used-tools block with an explicit suppression rule. If the spec is meant to be implementable from its own text, the manifest fields belong in it.
6. **Silent on the `.consolidate-lock`-inside-the-corpus conflict (§11).** The spec forbids product metadata inside an attached corpus; Claude Code puts its lock there deliberately, and any attached Claude corpus may already contain one, plus a `logs/` tree that a naive recursive `.md` scan will ingest as topic files.

**What the spec got right that deserves saying:** the timing claim — the one load-bearing claim, the one I scrutinized hardest, and the one that survives contact with the control flow better than it was stated. The core divergence is justified.
