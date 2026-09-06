# R65 — Lorebook / world-info systems: full activation semantics, data model, budgeting, interchange, and keyword-triggered injection as a general mechanism

**Date:** 2026-09-06 · **Author:** Opus 5 research subagent (bounded single-agent pass)
**Question (owner-directed):** the owner has ruled that lorebooks become **their own first-class
ctrl-b feature, useful beyond roleplay**. R64 §3 bought "enough to judge a v1 seam"; this pass buys
the field knowledge at **specification grade** — how shipping lorebook systems actually work end to
end, and what the field knows about **keyword-triggered context injection as a general mechanism**.
**Consumer:** the roleplay/characters + lorebook spec (open). **Nothing here is a decision** — §9
maps findings onto ctrl-b seams only.

**Supersedes** R64 §3 (which was deliberately shallow) and **corrects two of its statements** (§8).

## Confidence key

- **[V]** verified — I read the source at the pinned SHA, or the shipped default file.
- **[R]** reported — secondary source (docs site, issue thread, spec prose). Not code-verified.
- **[U]** unverified — expected but not checked.

## Sources (pinned)

| Repo / doc | SHA or URL | Version / date | Notes |
|---|---|---|---|
| SillyTavern/SillyTavern | `8172dcd0ee672d3cd9a5e5f7af134f91a45cd2b8` | `release`, **1.18.0**, commit 2026-07-07 | primary subject; `public/scripts/world-info.js` = 6,289 lines |
| SillyTavern-Docs (`Usage/worldinfo.md`) | `raw.githubusercontent.com/SillyTavern/SillyTavern-Docs/main/Usage/worldinfo.md` | fetched 2026-09-06, 456 lines | **[R]** — cached at `~/.cache/ctrl-b-research/stdocs/worldinfo.md` |
| malfoyslastname/character-card-spec-v2 | `8083fb388615ccbce768e97cbbd49d2b3214632c` | 2023-06-22 (frozen) | `character_book` normative |
| kwaroran/character-card-spec-v3 | `f3a86af019fbd99f788f7a1155f399655b34ab35` | 2024-07-20 (frozen) | lorebook + decorators normative |
| kwaroran/RisuAI | `c454df882aaf32e02a22da26d3718c8cadc97814` | 2026-09-05 HEAD | `src/ts/process/lorebook.svelte.ts` |
| agnaistic/agnai | `fccee00f5f7628d150760c787c4be87e6b1a652c` | 2026-06-13 | `common/memory.ts` (complete, 1 file) |
| LostRuins/lite.koboldai.net | `66883337de1bbc1ece06965a2c5e29ceb8dca833` | 2026-09-05 HEAD | `index.html` (single file) |
| Claude Code (local clone) | `a371abbe75ffa0d0a3c92290e2bbf56a7ef54367` | 2026-04-05 | `src/utils/claudemd.ts`, `src/utils/attachments.ts` — the path-glob cousin |
| ST issues #5622, #2615 | GitHub API, fetched 2026-09-06 | 2026-05 / 2024-08 | **[R]** sizing + perf in the wild |
| Cline rules docs · agents.md · open-webui Knowledge docs | fetched 2026-09-06 | — | **[R]** contrast mechanisms |

Clones live at `~/.cache/ctrl-b-research/{st,ccv2,ccv3,risu,agnai,lite,stdocs}` (reused from R64;
`stdocs` added by this pass). ⚠ ST's default branch is `release`; `staging` moves faster.

---

# 1. SillyTavern World Info — the complete semantics at 1.18.0

## 1.1 The entry data model, every field with its default **[V]**

`world-info.js:4002-4046` is the single source of truth — `newWorldInfoEntryDefinition`. Fields are
grouped below by role; the `default` and `type` columns are verbatim from that object.

**Identity / content**

| field | default | type | meaning |
|---|---|---|---|
| `uid` | assigned | number | key within the book's `entries` map |
| `comment` | `''` | string | title/memo. *"not utilized by the AI or any of the trigger logics"* (docs) |
| `addMemo` | `false` | boolean | whether the memo is shown |
| `content` | `''` | string | **the only field that reaches the prompt** |
| `disable` | `false` | boolean | inverted `enabled` |

**Triggering**

| field | default | type | meaning |
|---|---|---|---|
| `key` | `[]` | array | primary keys. A key that parses as `/…/flags` is used **as a regex and overrides every other matching option** (`:334-338`) |
| `keysecondary` | `[]` | array | the "optional filter" |
| `selective` | `true` | boolean | gate for `keysecondary` (the source comment says *"all entries are selective now"*, `:4800`) |
| `selectiveLogic` | `AND_ANY` (0) | enum | `{AND_ANY:0, NOT_ALL:1, NOT_ANY:2, AND_ALL:3}` (`:33-38`) |
| `constant` | `false` | boolean | activate regardless of keys ("🔵 blue circle") |
| `vectorized` | `false` | boolean | eligible for embedding activation ("🔗 chain link") — §1.14 |
| `caseSensitive` | `null` | boolean? | `null` = inherit the global |
| `matchWholeWords` | `null` | boolean? | `null` = inherit the global |
| `scanDepth` | `null` | number? | per-entry override of the global scan depth |
| `triggers` | `[]` | array | generation types this entry may fire on; empty = all. Allowed set = `['normal','continue','impersonate','swipe','regenerate','quiet']` (`constants.js:36-43`) |
| `characterFilterNames` / `…Tags` / `…Exclude` | `[]`/`[]`/`false` | array/array/boolean | per-character allow/deny (folded at runtime into `entry.characterFilter = {isExclude, names, tags}`, `:2125-2131`) |
| `probability` | `100` | number | roll gate |
| `useProbability` | `true` | boolean | whether to roll at all |

**Matching sources beyond the chat** (all default `false`) — `matchPersonaDescription`,
`matchCharacterDescription`, `matchCharacterPersonality`, `matchCharacterDepthPrompt`,
`matchScenario`, `matchCreatorNotes`. Each appends that text to the scanned haystack for **that entry
only** (`:299-320`).

**Recursion**

| field | default | type | meaning |
|---|---|---|---|
| `excludeRecursion` | `false` | boolean | this entry cannot be activated **by** other entries |
| `preventRecursion` | `false` | boolean | this entry's content is not added to the recursion buffer |
| `delayUntilRecursion` | `0` | number | 0/false = normal; `true`→level 1; N = only eligible at recursion delay-level ≥ N |

**Placement**

| field | default | type | meaning |
|---|---|---|---|
| `order` | `100` | number | insertion order (higher = later in context = more impact) |
| `position` | `0` (`before`) | number | the 8-value position enum, §1.11 |
| `depth` | `4` (`DEFAULT_DEPTH`) | number | for `atDepth` entries |
| `role` | `0` (SYSTEM) | enum | role for `atDepth` entries: system / user / assistant |
| `outletName` | `''` | string | named slot for `position: outlet` |
| `ignoreBudget` | `false` | boolean | exempt from the token budget |

**Grouping**

| field | default | type | meaning |
|---|---|---|---|
| `group` | `''` | string | comma-separated inclusion-group labels |
| `groupOverride` | `false` | boolean | "prioritize inclusion" — deterministic winner |
| `groupWeight` | `100` (`DEFAULT_WEIGHT`) | number | weight for the random draw |
| `useGroupScoring` | `null` | boolean? | `null` = inherit the global |

**Timed effects + automation**

| field | default | type | meaning |
|---|---|---|---|
| `sticky` | `null` | number? | stay active N messages after firing |
| `cooldown` | `null` | number? | cannot fire for N messages after firing |
| `delay` | `null` | number? | cannot fire until the chat has ≥ N messages |
| `automationId` | `''` | string | fires a matching Quick Reply script on activation — §1.13 |

Missing fields are backfilled from the template at load (`addMissingWorldInfoFields`, `:2104-2135`),
so an old or foreign book is normalized on read rather than migrated on disk.

## 1.2 Global settings — and a code-default vs shipped-default split **[V]**

Module initializers (`world-info.js:69-82`):

| setting | module init | **shipped `default/content/settings.json`** |
|---|---|---|
| `world_info_depth` (messages scanned) | 2 | **2** |
| `world_info_budget` (% of max context) | 25 | **25** |
| `world_info_budget_cap` (absolute token cap, 0 = off) | 0 | **0** |
| `world_info_include_names` | true | **true** |
| `world_info_recursive` | **false** | **true** ⚠ |
| `world_info_case_sensitive` | false | **false** |
| `world_info_match_whole_words` | **false** | **true** ⚠ |
| `world_info_character_strategy` | `character_first` (1) | **1** |
| `world_info_overflow_alert` | false | **false** |
| `world_info_min_activations` | 0 | (absent → module init 0) |
| `world_info_min_activations_depth_max` | 0 | (absent) |
| `world_info_max_recursion_steps` | 0 (unlimited) | (absent) |

`default/content/settings.json:10-23` is **seeded to every new user** (it is a `"type": "settings"`
row in `default/content/index.json:3`, consumed by `seedContent`, `content-manager.js:127+`), so
**a fresh SillyTavern install ships recursive scanning ON and whole-word matching ON**. The docs
agree with the shipped file, not the module (*"Match whole words … Enabled by default"*).

Non-obvious constants: `DEFAULT_DEPTH = 4`, `DEFAULT_WEIGHT = 100`, `MAX_SCAN_DEPTH = 1000`
(`:96-98`).

**Two settings pairs are declared mutually exclusive** by the docs: *"**This setting is mutually
exclusive with Max Recursion Steps.**"* (Min Activations) — and the code enforces it by structure,
not by validation: `world_info_max_recursion_steps` breaks the loop before the min-activations check
can run (`:4656-4659`).

## 1.3 Book sources and their precedence **[V]**

Four independent sources, loaded in parallel and then ordered (`getSortedEntries`, `:4478-4530`):

1. **Chat lore** — one book bound to this chat (`chat_metadata['world_info']`).
2. **Persona lore** — one book bound to the active user persona.
3. **Character lore** — the card-embedded `extensions.world` plus any number of extra books linked
   via `world_info.charLore[].extraBooks`.
4. **Global lore** — the `selected_world_info[]` multi-select.

Ordering:

```js
entries = [...chatLore.sort(sortFn), ...personaLore.sort(sortFn), ...entries];   // :4513
```

…where `entries` is character+global merged under one of three strategies
(`world_info_insertion_strategy`, `:27-31`): `evenly` (0, merge then sort as one pool),
`character_first` (1, **the shipped default**), `global_first` (2). `sortFn = (a,b) => b.order -
a.order` (`:88`) — **descending order**, i.e. this list is the *evaluation* order, not the final
prompt order (§1.11 reverses it).

**Deduplication is by name, and it is source-priority-ordered**: `getCharacterLore` skips a book
already active as global / chat / persona lore, `getChatLore` skips one already global, `getPersonaLore`
skips one already chat or global (`:4386-4400`, `:4436-4441`, `:4457-4470`). So the same book linked
twice contributes its entries once, from the higher-priority slot.

Every entry is stamped `{world: <bookName>}` on load, and the activation key everywhere is
`` `${entry.world}.${entry.uid}` `` — that composite is the identity used for dedup, timed-effect
metadata, and external activation.

## 1.4 What text is actually scanned **[V]**

The haystack is built per entry, per scan state (`WorldInfoBuffer.get`, `:274-326`):

- **Chat**: `chatForWI = coreChat.map(x => world_info_include_names ? `${x.name}: ${x.mes}` : x.mes).reverse()`
  (`script.js:4565`) — **reversed, so index 0 is the newest message**, then sliced `[0, depth)`.
- Messages are joined with `'\n' + '\x01'` and the buffer is **prefixed** with `\x01` (`:295-297`).
  That control character is a documented feature: the docs show `/\x01{{user}}:[^\x01]*?hello/` as the
  way to write a regex key that matches only one speaker's messages.
- **Per-entry global sources** are appended when the corresponding `match*` flag is set: persona
  description, character description, personality, depth prompt, scenario, creator notes.
- **Extension prompts marked `scan: true` are appended for every entry** (`:4605-4613` collects them
  via `buffer.addInject`) — this is how the Author's Note, the persona-description injection, and the
  quiet prompt become scannable. So the scan corpus is *not* only chat: **injected system content is
  scanned when its injector opts in**.
- **The recursion buffer** (contents of entries activated on earlier passes) is appended — except
  during a `MIN_ACTIVATIONS` pass, which deliberately excludes it (`:322-324`).

⚠ **`scanDepth = 0` yields an empty haystack, not "recursion only"** [V, source-read]. `get()` opens
with `if (depth <= this.#startDepth) return '';` (`:281-283`) and `#startDepth` is `0` and never
mutated (`:233`, only other use `:297`). So at depth 0 **no** entry can match — not by chat, not by
injection, not by recursion. The docs claim the opposite: *"If set to 0, then only recursed entries and
Author's Note are evaluated."* Recorded as a doc/code divergence at this pin, not run-verified.

## 1.5 The scan algorithm **[V]**

`checkWorldInfo` (`:4597-5145`) is a state machine over four states (`scan_state`, `:43-61`):
`NONE(0)` stop · `INITIAL(1)` · `RECURSION(2)` · `MIN_ACTIVATIONS(3)`.

Per outer loop pass:

1. **Guard**: `if (world_info_max_recursion_steps && world_info_max_recursion_steps <= count) break`
   (`:4656`).
2. **Inner pass over `sortedEntries` in order**, per entry, in this exact precedence
   (`:4675-4869`) — this ordering *is* the semantics:
   - already-activated or already-failed-probability → skip
   - `disable` → skip
   - `triggers` filter (generation type) → skip
   - character-name filter, then character-tag filter → skip
   - **delay** active → skip
   - **cooldown** active **and not sticky** → skip
   - `delayUntilRecursion` and not a RECURSION pass → skip
   - `delayUntilRecursion > currentRecursionDelayLevel` → skip
   - RECURSION pass + global recursion on + `excludeRecursion` → skip
   - `@@activate` decorator → **activate** · `@@dont_activate` → skip
   - externally activated (§1.13) → activate
   - `constant` → activate
   - **sticky** active → activate
   - no keys → skip
   - primary key match? no → skip (silently, no log)
   - no secondary keys → activate
   - selective logic over secondary keys → activate or skip
3. **Order the newly activated set**: sticky-first, then by position in `sortedEntries`
   (`:4872-4878`).
4. **Inclusion-group filtering** (`filterByInclusionGroups`, `:4893`) — §1.8.
5. **Probability rolls + budget accumulation** — §1.10.
6. **Decide the next state** (`:4977-5015`), in this order:
   - recursion on + not overflowed + ≥1 new recursable entry → `RECURSION`
   - recursion on + not overflowed + this was `MIN_ACTIVATIONS` + recursion buffer non-empty →
     `RECURSION` (*"Min Activations run done, whill will always be followed by a recursive scan"*)
   - else, if min-activations unmet and not overflowed and depth is under both `min_activations_depth_max`
     and `chat.length` → `MIN_ACTIVATIONS` and `buffer.advanceScan()` (**skew += 1: the scan window
     grows by one message per pass**)
   - else, if delayed-recursion levels remain → `RECURSION` at the next level
7. Append the new (non-`preventRecursion`) contents to the recursion buffer, emit
   `WORLDINFO_SCAN_DONE` with a mutable args object (extensions may rewrite scan state, budget, and
   the overflow flag), loop.

**Delayed recursion is level-banded, not depth-counted** (`:4642-4650`): the distinct
`delayUntilRecursion` values across all entries are collected, sorted ascending, and consumed one at
a time — each level opens only after the previous produced no more matches.

## 1.6 Key matching **[V]**

`matchKeys` (`:329-361`), in order:

1. If the key parses as a JS regex literal (`/pattern/flags` — `parseRegexFromString`, `:2821`), run
   `regex.test(haystack)` and **return; case-sensitivity and whole-words are ignored**.
2. Else lowercase both sides unless case-sensitive.
3. If whole-words: a **multi-word** key falls back to plain `includes()`; a **single-word** key uses
   `` new RegExp(`(?:^|\\W)(${escapeRegex(key)})(?:$|\\W)`) `` — non-alphanumeric boundaries, not `\b`.
4. Else plain `includes()`.

Keys are macro-substituted before matching (`substituteParams(key)`, `:4791`), so `{{user}}` /
`{{char}}` work in keys. Plaintext keys **cannot contain commas** (comma is the separator); regex keys
can.

## 1.7 Selective logic **[V]**

`matchSecondaryKeys` (`:4820-4856`) with `selectiveLogic` defaulting to `AND_ANY`:

| mode | value | activates when |
|---|---|---|
| `AND_ANY` | 0 | primary matched **and any** secondary matched |
| `NOT_ALL` | 1 | primary matched **and at least one** secondary did **not** match |
| `NOT_ANY` | 2 | primary matched **and no** secondary matched |
| `AND_ALL` | 3 | primary matched **and all** secondaries matched |

## 1.8 Inclusion groups **[V]**

`filterByInclusionGroups` (`:5269-5352`). An entry may belong to several groups
(`item.group.split(/,\s*/)`). Resolution order per group:

1. **Sticky wins outright** — if any member is sticky-active, every non-sticky member is dropped and
   all further group logic is skipped (`filterGroupsByTimedEffects`, `:5218-5257`).
2. Members on cooldown or delay are dropped.
3. **Group scoring** (`filterGroupsByScoring`, `:5173-5208`), when enabled globally or per entry:
   `buffer.getScore()` counts **1 point per matching primary key**, plus secondaries under
   `AND_ANY` (1 per match) and `AND_ALL` (all-or-nothing); `NOT_*` contribute nothing (`:433-477`).
   Only the max-score subset survives.
4. If the group already has an activated member from an earlier pass, **every candidate is dropped**
   (a group fires at most once per generation).
5. **`groupOverride` ("Prioritize Inclusion")** — the highest-`order` overriding member wins
   deterministically (`:5325-5330`).
6. Otherwise a **weighted random draw** over `groupWeight` (`:5333-5346`).

## 1.9 Timed effects **[V]**

`WorldInfoTimedEffects` (`:479-793`). State lives in **chat metadata**, keyed
`` `${world}.${uid}` ``, as `{hash, start, end, protected}` where `start = chat.length` at
activation and `end = start + N`. The `hash` is a hash of the whole entry object
(`getStringHash(JSON.stringify(entry))`, `:4517-4520`) — which is how *"Making any changes to the
entry that is currently on timed effect will cause the effect to be forcibly removed"* is
implemented: the hash no longer resolves to an entry (`:620-628`).

- **`sticky`** — while active the entry activates unconditionally and **skips the probability roll**
  (`:4916-4919`).
- **`cooldown`** — suppresses activation; **a sticky that expires immediately installs the cooldown**
  in the same evaluation (`#onEnded.sticky`, `:511-527`).
- **`delay`** — pure predicate on `chat.length < entry.delay`; the only effect evaluated during a dry
  run (`checkTimedEffects`, `:672-678`).
- *"Active timed effects are removed if the chat doesn't advance"* is `:624-628`
  (`chat.length <= value.start && !value.protected` → delete).

## 1.10 Budget and eviction **[V]**

```js
let budget = Math.round(world_info_budget * maxContext / 100) || 1;          // :4624
if (world_info_budget_cap > 0 && budget > world_info_budget_cap) budget = world_info_budget_cap;  // :4626
```

Then, walking the pass's ordered candidate list (`:4900-4957`):

- Entries with `ignoreBudget` are exempt. Once overflow is latched, the loop `continue`s past
  non-exempt entries **only while exempt entries remain ahead**, then `break`s (`:4901-4907`).
- Each candidate's `content` is macro-substituted, appended to `newContent`, and the test is
  `textToScanTokens + tokens(newContent) >= budget` — where `textToScanTokens` is the token count of
  `allActivatedText`, the accumulated text of **previous passes' recursable entries only**.
- Overflow sets `token_budget_overflowed = true` (optionally toasting), and that flag **also stops
  recursion and min-activations** on the next-state decision (`:4977-4995`).

Two consequences worth naming, both source-level:

- **There is no eviction.** Over-budget entries are never inserted; already-inserted entries are never
  removed. The docs state the rule as *"If the budget is exhausted, then no more entries are activated
  even if the keys are present"*. The V3 spec's `priority`-based *removal* model (§2) is **not
  implemented by ST** — ST has no `priority` field at all.
- **The accounting is approximate**: `preventRecursion` entries never enter `allActivatedText`, so
  their tokens are counted only within the pass that inserted them, not against later passes.

Effective priority order under pressure, per the docs: *"Constant entries will be inserted first. Then
entries with larger order numbers. Entries inserted by directly mentioning their keys have higher
priority than those that were mentioned in other entries' contents."* — the last clause is a
consequence of the pass structure (direct matches land in pass 1, recursed ones in pass 2+).

## 1.11 Insertion positions and final assembly **[V]**

```js
export const world_info_position = {
    before: 0, after: 1, ANTop: 2, ANBottom: 3, atDepth: 4, EMTop: 5, EMBottom: 6, outlet: 7,
};                                                                              // :855-864
```

Assembly (`:5065-5140`): the activated set is sorted **descending by `order`** and each entry
`unshift`ed into its bucket — so the final arrays run **ascending by `order`**, i.e. *"an entry with
Order number 100 will appear in the context before an entry with Order number 250"* (docs).

| position | destination |
|---|---|
| `before` / `after` | `worldInfoBefore` / `worldInfoAfter` strings → the `{{wiBefore}}`/`{{wiAfter}}` (aliases `loreBefore`/`loreAfter`) story-string slots around the character definitions (`script.js:4652-4655`) |
| `EMTop` / `EMBottom` | parsed as **example-dialogue blocks** and spliced before/after the card's own examples (`script.js:4579-4595`) |
| `ANTop` / `ANBottom` | concatenated around the Author's Note text, then re-injected through `setExtensionPrompt(NOTE_MODULE_NAME, …)` (`:5130-5134`). **Silently dropped if the Author's Note is disabled** (docs). |
| `atDepth` | grouped by `(depth, role)` and injected as `setExtensionPrompt(CUSTOM_WI_DEPTH_ROLE(depth, role), …, IN_CHAT, depth, false, role)` — i.e. **a message inserted N from the tail with a chosen system/user/assistant role** (`script.js:4609-4613`) |
| `outlet` | **not injected at all** — stored under a name and pulled by an `{{outlet::Name}}` macro the user places anywhere in the Prompt Manager / formatting fields (`script.js:4615-4618`) |

Per-entry regex post-processing runs on the content just before bucketing
(`getRegexedString(..., regex_placement.WORLD_INFO, {depth, isPrompt:true})`, `:5067`), and **empty
content after that is dropped with a log** — the V3 spec mandates the same (§2).

`outlet` is the newest and most general: it turns a lorebook entry into a **named, user-placed prompt
fragment**. Documented limitations [R]: outlet macros cannot nest, cannot appear inside WI content,
and cannot be expanded from character-card fields or the Author's Note editor (*"This conflicts with
the evaluation order of World Info and may lead to infinite loops."*).

## 1.12 Decorators in ST **[V]**

ST implements exactly **two** of the V3 decorators:

```js
const KNOWN_DECORATORS = ['@@activate', '@@dont_activate'];                     // :100
```

`parseDecorators` (`:4540-4592`) strips a leading `@@…` block from `content`, honours the `@@@`
fallback-chain convention (§2), and stops at the first non-`@@` line. Unknown decorators mark
`fallbacked = true`, which lets the next `@@@` line be taken instead — i.e. **ST implements the
fallback protocol even though it implements almost none of the decorators**.

## 1.13 Three escape hatches worth naming **[V]**

- **`automationId` — a lorebook entry that runs a script.** On activation, ST emits
  `WORLD_INFO_ACTIVATED` with the entry set; the Quick Reply extension collects
  `entries.map(e => e.automationId).filter(Boolean)` and executes every Quick Reply whose
  `automationId` matches, from the global, chat, and character QR sets
  (`quick-reply/src/AutoExecuteHandler.js:85-100`). Docs: *"The script command will run only once if
  multiple entries with the same Automation ID are activated."* **This is keyword-triggered *action*,
  not just keyword-triggered *text*.**
- **External activation** — a `static externalActivations` map on the buffer class (`:203`, `:412`,
  `:1025`) lets any extension force an entry active for one evaluation, cleared after each scan
  (`resetExternalEffects`, `:419`). This is the seam the vector lane rides.
- **`WORLDINFO_SCAN_DONE`** fires after every loop pass with a **mutable** args object; an extension
  may rewrite `state.next`, `budget.current`, `budget.overflowed`, and the entry arrays in place
  (`:5030-5060`).

## 1.14 The vector lane — ST ships keyword AND embedding activation over the same corpus **[V]**

The Vector Storage extension (`extensions/vectors/index.js:1620-1726`) synchronizes WI entries into
per-book collections (`world_${hash(worldName)}`, one vector per entry `content`), queries them with
the recent chat, and force-activates the hits through `WORLDINFO_FORCE_ACTIVATE` → the
`externalActivations` map above.

Defaults (`:58-119`): `include_wi: false`, `enabled_world_info: false`, `enabled_for_all: false`,
`max_entries: 5`, `score_threshold: 0.25`, `query: 2` messages. **Both the feature and the per-entry
opt-in are off by default.**

The docs are explicit about the trade [R]:

> *"This feature only replaces the check for keywords. All additional checks must be met for the entry
> to be inserted: trigger%, character filters, inclusion groups, etc."*
> *"The 'Scan Depth' setting … is not used. The Vector Storage 'Query messages' value is utilized
> instead … This allows for a configuration like 'Scan Depth' set to 0, so no regular keyword matches
> will be made, but entries still can be activated by vectors."*
> *"Since the retrieval quality depends entirely on the outputs of the embedding model, it's impossible
> to predict exactly what entries will be inserted. **If you want deterministic and predictable
> results, stick to keyword matching.**"*

That last sentence is the field's own stated rationale for keyword triggering over embedding
retrieval, from the project that shipped both.

---

# 2. Character Card V3 — `character_book` and the decorator system **[V]**

## 2.1 The standardized entry

`ccv3/SPEC_V3.md:209-250` gives the whole Lorebook interface. **Book level**: `name?`,
`description?`, `scan_depth?`, `token_budget?`, `recursive_scanning?`, `extensions`, `entries[]`.
**Entry level, required**: `keys[]`, `content`, `extensions`, `enabled`, `insertion_order`,
`use_regex` (V3 addition), `case_sensitive?`, `constant?` (*"On V2 it was optional, but on V3 it is
required to implement"*). **Optional**: `name?`, `priority?`, `id?`, `comment?`, `selective?`,
`secondary_keys?`, `position?: 'before_char' | 'after_char'`.

Normative behaviours worth quoting:

> `content`: *"This does not mean if the lorebook field matches multiple times, the content field
> would be added multiple times. The application **MUST** only add the content field once."* and
> *"If the content field is empty, the application **MUST** not add anything to the prompt, regardless
> of the lorebook field matches or not."* (`:310-318`)

> `token_budget`: *"the application **SHOULD** remove the lowest priority lorebook fields if the total
> token count of the lorebook fields exceeds the value of this field"* (`:278`) — and with no
> `priority`, *"application **MAY** remove the lowest `insertion_order` lorebook fields first"*
> (`:334`). **The spec's budget model is eviction; ST's is refusal (§1.10).**

> `recursive_scanning`: *"if this field is true, the application **MAY** consider the lorebook entries
> as a match if other lorebook entries' `content` field is a match, regardless of `scan_depth`"*
> (`:282`)

> `use_regex`: *"Applications **MAY** use only one regex pattern in the `keys` field which is in the
> first index of the array for performance reasons."* (`:324`)

> `insertion_order`: *"the lower the number, it would be added to the prompt earlier"* (`:330`)

**Standalone book interchange is specified** (`:250-262`):

```ts
{ spec: 'lorebook_v3', data: Lorebook }
```

with a forward-compatibility rule that is the load-bearing interop clause:

> *"the application **SHOULD** ignore the fields that are not present in the specification, but not
> reject the import of Lorebook object. The application **MAY** save the fields that are not present
> in the specification so it can be exported safely."*
> *"This **MUST** not taken to mean that the application can add their own fields to the Lorebook
> object. … for application specific data, the application **MAY** save the data in the `extensions`
> field"*

## 2.2 Decorators — the extension mechanism instead of more fields **[V]**

> *"decorators are a way to add more complex features to the lorebook entries **without adding more
> fields**. Decorators are added to the content field … Decorators are a string that starts with `@@`
> and ends with a newline."* (`:374-380`)

Handling rules: unknown decorator or invalid value → **ignore it** (never reject the entry); custom
decorators must be `@@snake_case` latin+underscore; duplicates → only the first counts; and the
**fallback chain** — a `@@@`-prefixed line immediately after is used if the preceding decorator was
unrecognized, chainable to *"at least 5"* levels. *"On backfilling V2, the application **SHOULD**
remove all decorators."*

The full defined set (`:420-560`), 19 decorators:

| decorator | value | effect |
|---|---|---|
| `@@activate` | — | force match **IN ANY CASE** |
| `@@dont_activate` | — | force no-match unless `@@activate` present |
| `@@activate_only_after` | n | suppressed until assistant message count ≥ n |
| `@@activate_only_every` | n | only when message count % n == 0 |
| `@@keep_activate_after_match` | — | once matched, always matches thereafter |
| `@@dont_activate_after_match` | — | once matched, never matches again |
| `@@depth` | n | insert n messages from the tail (0 + `@@role assistant` = **prefill**) |
| `@@reverse_depth` | n | `@@depth (total − n)` |
| `@@instruct_depth` / `@@reverse_instruct_depth` | n | the same, counted in **tokens**, for non-chat contexts |
| `@@role` | system\|user\|assistant | role of the injected message |
| `@@scan_depth` | n | per-entry scan window in messages |
| `@@instruct_scan_depth` | n | per-entry scan window in tokens |
| `@@is_greeting` | n | only when greeting index == n |
| `@@position` | `before_desc`\|`after_desc`\|`personality`\|`scenario` | named prompt slot |
| `@@ignore_on_max_context` | — | first to be trimmed / not matched at max context |
| `@@additional_keys` | csv | extra required keys (repeatable) |
| `@@exclude_keys` | csv | keys that *prevent* activation |
| `@@is_user_icon` | name | only when that user icon is active |
| `@@disable_ui_prompt` | `system_prompt`\|`post_history_instructions` | **an entry that switches off a UI prompt block** |

Precedence is spelled out between them (`@@position` beats `@@depth` beats `@@reverse_depth`, etc.).

Note what the decorator design buys: **the entry schema stays a six-field object and everything
situational lives in the content**, which is why V3 books survive importers that implement none of
it — the decorators are just leading lines of text.

**V2 (`ccv2/spec_v2.md:85-110`)** is the same shape minus `use_regex`, minus decorators, and with the
same two positions; its inline comments name the Agnai↔ST field gaps directly (*"FIELDS WITH NO
CURRENT EQUIVALENT IN SILLY" / "…IN AGNAI"*) — the V2 spec was written as a **crosswalk between two
existing implementations**, not as a green-field design.

---

# 3. RisuAI **[V]**

`src/ts/process/lorebook.svelte.ts` (765 lines) + `loreBook` in `src/ts/storage/database.svelte.ts:1320-1341`.

**The entry model is deliberately thin** — nine fields:

```ts
export interface loreBook{
    key:string            // comma-separated, NOT an array
    secondkey:string
    insertorder: number
    comment: string
    content: string
    mode: 'multiple'|'constant'|'normal'|'child'|'folder',
    alwaysActive: boolean
    selective:boolean
    extentions?:{ risu_case_sensitive:boolean }
    activationPercent?:number
    loreCache?:{ key:string; data:string[] }
    useRegex?:boolean
    bookVersion?:number
    id?:string
    folder?:string
}
```

Everything else — depth, role, position, priority, probability, per-entry recursion, key algebra — is
a **decorator inside `content`**, parsed via `CCardLib.decorator.parse` (`:294-509`). Risu is the
V3 reference implementation and implements essentially the whole decorator set plus its own:

- `@@inject_lore <source>` / `@@inject_at` / `@@inject_replace` / `@@inject_prepend` — **an entry that
  mutates another activated entry's text** (append / prepend / string-replace), resolved after
  budgeting (`:607-640`). No other system read here has this.
- `@@probability n`, `@@priority n`, `@@end` (≡ `@@depth 0`)
- `@@unrecursive` / `@@recursive` — per-entry override of the global recursion setting
- `@@no_recursive_search` — this entry is matched against chat only, never the recursion buffer
- `@@exclude_keys_all` — the AND-form of `@@exclude_keys`
- `@@match_full_word` / `@@match_partial_word`
- `@@position pt_*` — Risu's own named prompt-template slots, alongside the four spec positions

**Beyond-ST structure:**

- **Folders are first-class**: `mode: 'folder'` with a sentinel key `'folder:' + uuid`, and
  `mode: 'child'` entries that inherit the parent's activation (`:44-72`, `:280-292`).
- **Three book scopes** merged flat: character `globalLore`, chat `localLore`, and **module
  lorebooks** (`getModuleLorebooks()`, `:78-81`) — Risu's "modules" are shareable bundles, which is
  how R64 §5.2 found the MCP operator text riding an always-active lorebook entry.

**Scan differences from ST:**

- Defaults: `loreBookDepth = 5`, `loreBookToken = 800` (`database.svelte.ts:73-78`) — **an absolute
  token budget, not a percentage**; `recursiveScanning` defaults **true** (`:85`).
- The haystack is `messages.slice(len - searchDepth)` — **not reversed**, and matching strips
  `{{//comment}}` macros first (`:174-179`).
- Non-full-word matching **deletes all spaces from both sides** before `includes()` (`:204-206`) — so
  `"black cat"` matches `"blackcat"`. ST does not do this.
- Recursion is an outer `while(matching)` with **no step limit** — every activation sets
  `matching = true` and pushes its content onto `recursivePrompt`.
- **Budget then order, as two separate sorts** (`:601-620`): sort by `priority` descending, greedily
  keep while `usedTokens + tokens <= loreToken`, then **re-sort the survivors by `order`** descending
  and reverse. So Risu implements the V3 eviction model ST does not.

---

# 4. Agnai "memory books" and KoboldAI Lite world info

## 4.1 Agnai — the minimal complete implementation **[V]**

`common/memory.ts` is the entire feature in ~280 lines. Entry (`common/types/memory.ts`):

```ts
export interface MemoryEntry {
  name: string
  entry: string                 // The text injected into the prompt
  keywords: string[]            // Keywords that trigger the entry to be injected
  priority: number              // When choosing which memories to discard, lowest priority will be discarded first
  weight: number                // When determining what order to render the memories, the highest will be at the bottom
  enabled: boolean
  // currently unsupported V2 fields which are here so that we don't destroy them
  id?, comment?, secondaryKeys?, constant?, position?
  // V2 props
  probability?, useProbability?, selective?, selectiveLogic?, excludeRecursion?
}
```

Load-bearing points:

- **Two independent orderings**: `priority` decides *what survives the budget*, `weight` decides
  *where it lands*. `buildMemoryPrompt` sorts `byPriorityThenAge`, truncates to budget, then re-sorts
  `byWeightThenAge` and reverses. **Age is the documented tiebreaker in both** — the entry whose
  keyword appeared in the *most recent* message wins.
- **Keywords are globs, not substrings**: `createRegexForKeyword` strips regex metacharacters except
  `*` and `?`, maps `*`→`\w*` and `?`→`\w`, and wraps in `` `\\b(${pattern})\\b` `` with flags
  `giu` — so Agnai is **always whole-word and always case-insensitive**, with wildcards.
- **No recursion, no constant, no secondary-key logic, no positions.** Those fields are *stored and
  round-tripped but not honoured* — the comment says so in three places: *"currently unsupported V2
  fields which are here so that we don't destroy them"*. This is an explicit **lossless-passthrough
  policy** for a spec you only partially implement.
- Defaults: `memoryDepth: 50`, `memoryContextLimit: 500` (`common/default-preset.ts:57-58`); the
  budget falls back to `500` and the depth to `Infinity` if unset.
- The block is **labelled** in the prompt template: ``{{#if memory}}"{{char}}'s" memories:\n{{memory}}{{/if}}``
  (`common/prompt-order.ts:92`) or `Facts:` in the older mode template — corroborating R64's
  "Agnai keeps labels" finding.
- One bundled character book is folded in under a reserved id
  (`BUNDLED_CHARACTER_BOOK_ID = '__bundled__characterbook__'`).

## 4.2 KoboldAI Lite — the floor **[V]**

`index.html`. Entry (`add_wi`, `:28239-28253`):

```js
{ key, keysecondary, keyanti, content, comment, folder, selective:false,
  constant:false, probability:100, wigroup, widisabled:false }
```

- **`keyanti` is a first-class anti-key field** — ST expresses the same idea as `NOT ANY` selective
  logic, Lite gives it its own input. Combined truth table (`:21449-21462`): all three valid →
  `t1 && t2 && !t3`; no anti-key → `t1 && t2`; no secondary → `t1 && !t3`.
- **Scan depth is in characters, not messages**, and defaults to **0 = full context**
  (`var wi_searchdepth = 0; //search everything`, `:4285`); the UI offers `Full Context, 16384, 8192,
  … 256` (`:31121-31130`).
- **No budget, no order, no recursion, no positions.** Matching entries are concatenated in array
  order and *"injected right after the memory"* — the top of the context (`:21376`).
- `wigroup` = named, individually toggleable groups (*"WorldInfo Groups can be used to segment data,
  e.g. entries for a specific place, person or event. Each entire group can be toggled on/off on
  demand."*).
- Probability has an off-by-one: `roll = floor(random()*100)+1` (1..100) then `if (roll < probability)`
  — 50% actually inserts 49% of the time. Cosmetic; recorded because it is the kind of bug this
  feature class attracts.

---

# 5. Interchange formats — what maps, what is lost

## 5.1 The four shapes ST reads **[V]**

`importWorldInfo` (`:5731-5772`) sniffs by a single discriminating field, and PNG files are read as
NovelAI `naidata`:

| detector | format | converter |
|---|---|---|
| `jsonData.lorebookVersion !== undefined` | NovelAI lorebook | `convertNovelLorebook` `:5448` |
| `jsonData.kind === 'memory'` | Agnai memory book | `convertAgnaiMemoryBook` `:5358` |
| `jsonData.type === 'risu'` | RisuAI lorebook | `convertRisuLorebook` `:5403` |
| (else) | assumed native ST book | passed through |

**What each conversion carries — everything else is reset to template defaults:**

- **NovelAI** → `key ← entry.keys`, `content ← entry.text`, `comment ← entry.displayName`,
  `order ← entry.contextConfig?.budgetPriority ?? 0`, `disable ← !entry.enabled`. Five fields. NAI's
  own `contextConfig` (prefix/suffix/insertion position/reserved tokens/etc.) is dropped.
- **Agnai** → `key ← entry.keywords`, `content ← entry.entry`, `comment ← entry.name`,
  `order ← entry.weight`, `disable ← !entry.enabled`. **`priority` is dropped** — Agnai's
  eviction axis has no ST home.
- **Risu** → `key ← entry.key.split(',')`, `keysecondary ← secondkey.split(',')`,
  `constant ← alwaysActive`, `selective`, `order ← insertorder`, `probability ← activationPercent`,
  `comment`, `content`. **Every decorator inside `content` survives as text but is inert** (ST knows
  two of them), and Risu's `mode`/`folder`/`useRegex` are dropped.

## 5.2 The `character_book` path is the lossless one **[V]**

`convertCharacterBook` (`:5498-5548`) maps **35 fields**, reading ST's whole extended model out of
`entry.extensions.*` (`position`, `depth`, `role`, `scan_depth`, `case_sensitive`,
`match_whole_words`, `group`, `group_weight`, `group_override`, `use_group_scoring`, `probability`,
`sticky`, `cooldown`, `delay`, `automation_id`, `vectorized`, `exclude_recursion`,
`prevent_recursion`, `delay_until_recursion`, `outlet_name`, `triggers`, `ignore_budget`, the six
`match_*` sources, `display_index`, `selectiveLogic`) — exactly the V3 `extensions` escape hatch used
as designed.

Round-tripping is **not** reconstructed on export; it is **maintained continuously**. The imported
book is stored with `originalData: characterBook` alongside the native entries, and every editor
control writes through `setWIOriginalDataValue` using a declared crosswalk
(`originalWIDataKeyMap`, `:2607-2644`) that maps each native field to its dotted spec path
(`'excludeRecursion': 'extensions.exclude_recursion'`, `'order': 'insertion_order'`,
`'key': 'keys'`, …). So a card imported, edited, and re-exported keeps its V2/V3 shape byte-for-byte
except where edited.

**Standalone export is the raw internal object**: `JSON.stringify(data)` with the entries keyed by
uid (`:2539-2544`) — i.e. `{entries: {"0": {...}, "1": {...}}, originalData?: ...}`, **not** the V3
`{spec: 'lorebook_v3', data: …}` envelope. The shipped example book
(`default/content/Eldoria.json`) confirms the shape and shows the on-disk default set verbatim
(`sticky: 0, cooldown: 0, delay: 0, role: null, useProbability: true, …`).

## 5.3 Risu's importer is a union-of-field-names duck type **[V]**

`convertExternalLorebook` (`:727-745`) does not sniff a format at all — it tries every known name:

```ts
key: currentLore.key ? … : currentLore.keys ? … : currentLore.keywords ? … : '',
insertorder: currentLore.order ?? currentLore.priority ?? currentLore?.contextConfig?.budgetPriority ?? 0,
comment: currentLore.comment || currentLore.name || currentLore.displayName || '',
content: currentLore.content || currentLore.entry || currentLore.text || '',
alwaysActive: currentLore.constant ?? currentLore.forceActivation ?? false,
```

It produces **six fields** — position, depth, probability, groups, timed effects and regex are all
lost. Risu's own export is `{type:'risu', ver:1, data: loreBook[]}`.

## 5.4 The round-trip picture

| direction | fidelity |
|---|---|
| ST ↔ ST standalone JSON | lossless (it is the internal object) |
| ST ↔ V2/V3 `character_book` | **lossless in practice** via `extensions.*` + the maintained `originalData` shadow |
| ST → V3 standalone `lorebook_v3` | **not implemented** — ST exports the raw shape, no envelope |
| NAI / Agnai / Risu → ST | 5–8 fields survive; everything situational is defaulted |
| Anything → Risu | 6 fields survive; decorators survive only because they are text inside `content` |
| Anything → Agnai | 6 honoured + ~10 stored-but-inert (explicit no-destroy policy) |
| Anything → Lite | keys/content only |

The one design lesson that recurs: **the fields that survive an import are the ones two systems
already agreed on; everything else has to ride in `extensions` or inside the content text.** V3's
decorators exist precisely because content-borne configuration is the only thing that reliably
crosses an implementation boundary.

---

# 6. The non-roleplay angle — keyword-triggered injection as a general mechanism

## 6.1 SillyTavern's own positioning is explicitly general **[R, docs]**

The opening of the World Info doc, verbatim:

> **"World Info (also known as Lorebooks or Memory Books) is a powerful tool available in ST to
> insert prompts dynamically into your chat to help guide the AI replies."**
>
> "Commonly, World Info (WI for short) is used to enhance the AI's understanding of the details in
> your fictional world, **however you could use a World Info entry to insert ANYTHING that you would
> like to insert into the prompt.**"
>
> "It functions like **a dynamic dictionary that only inserts relevant information from World Info
> entries when keywords associated with the entries are present in the message text.**"

And in the Pro Tips:

> "The World Info engine is a very powerful prompt management tool. **Don't fixate on adding character
> lore alone, feel free to experiment.**"
> "Activation keywords, titles, and other information that is not in the **Content** field is not
> inserted into context, so **each World Info entry should have a comprehensive, standalone
> description.**"
> "To conserve prompt tokens, it is advisable to **keep entry contents concise.**"

Note the third bullet is a *design* constraint, not style advice: keys and titles never reach the
model, so an entry must read correctly with no surrounding context.

The docs also frame the honest limit:

> "It is important to note that while World Info helps guide the AI toward the desired content, **it
> does not guarantee its appearance in the generated output messages.**"

## 6.2 The non-roleplay use is already happening in the wild **[R]**

ST issue **#5622** (2026-05-11, open) is a performance report whose author describes his own book,
unprompted:

> "The lorebook have about **32 Constant Strategy** which is ranging from **50 lines to 400 lines max
> per entry**. **It's not lore inside the entry, but a logic engine to drive the AI.**"

That is a lorebook used as a **rule/behaviour library**, with the keyword layer mostly bypassed
(`constant`) and the *book* acting as a modular prompt store. The same use shows up structurally in
Risu, where an **MCP server's operator instructions ride an always-active lorebook entry** rather than
a separate prompt block (R64 §5.2).

The two ST features that most clearly leave roleplay behind are both recent: **`outlet`** (an entry
becomes a named fragment the user places anywhere in the prompt, §1.11) and **`automationId`** (an
entry becomes a *trigger for a script*, §1.13). Neither has anything to do with fiction.

## 6.3 The cousins in our peer class — the same mechanism, different key

**Claude Code — path-glob-scoped rules** [V, `a371abb`]. A rules `.md` file may declare
`paths:` in YAML frontmatter; those become globs on `MemoryFileInfo.globs`
(`src/utils/claudemd.ts:229-243`, `:252-280`). At the moment a tool touches a file path, matching
rules are loaded and injected as `type: 'nested_memory'` attachments
(`src/utils/attachments.ts:1792-1858`), in a fixed order: managed/user conditional rules matching the
target, then nested `CLAUDE.md` + unconditional + conditional rules walking CWD→target, then
conditional rules only walking root→CWD. Matching is `ignore().add(globs).ignores(relativePath)` —
gitignore semantics against a base that differs by rule type (`:1369-1396`). Two properties matter
for us:

- **`**` means "no globs"** — an all-match pattern is normalized away so the file is treated as
  unconditional (`:272-276`). Conditional and unconditional rules are *partitioned*, not merged:
  `files.filter(f => (conditionalRule ? f.globs : !f.globs))` (`:773`).
- **Injection is once per session, not per turn**: `loadedNestedMemoryPaths` is *"a non-evicting Set"*
  guarding against re-injection, backed by `readFileState` for cross-turn dedup
  (`:1719-1745`). The hook event even labels the reason:
  `loadReason = memoryFile.globs ? 'path_glob_match' : memoryFile.parent ? 'include' : 'nested_traversal'`.

That is the same shape as a lorebook — *predicate over recent context → inject a text block* — with
the predicate moved from "keywords in the last N messages" to "globs against the path this tool is
about to touch", and with **the injection latched once** where ST re-evaluates every turn.

**Cline — `paths` frontmatter, and the stated rationale** [R, docs]:

> "Currently, `paths` is the supported conditional. It takes an array of glob patterns"
> "No frontmatter: Rules without frontmatter are always active."
> "**As your rule library grows, loading every rule for every request wastes context tokens and can
> dilute Cline's focus.**"

The second clause — *dilute focus* — is the same argument the lorebook world makes, arrived at
independently from the coding-agent side.

**AGENTS.md — proximity, not keywords** [R, agents.md]:

> "Large monorepo? Use nested AGENTS.md files for subprojects. Place another AGENTS.md inside each
> package."
> "Agents automatically read the nearest file in the directory tree, so **the closest one takes
> precedence** and every subproject can ship tailored instructions."
> "at time of writing the main OpenAI repo has **88 AGENTS.md files**"

No conditional predicate at all: the selector is *location*, resolved by proximity. This is the
cheapest possible version of the same idea and the one with the largest deployed footprint.

**open-webui Knowledge — the embedding contrast, with an explicit escape hatch** [R, docs]:

> Focused Retrieval (default): *"Uses RAG to find and inject the most relevant chunks based on the
> user's query"* … *"works best for large document sets where only specific sections are relevant."*
> Full Context Mode: *"Injects the complete content of the file into every message. No chunking, no
> semantic search."* … *"Always injected regardless of native function calling settings, so the model
> doesn't need to call any tools to access it."* … suits *"short reference documents, style guides, or
> context that's always relevant."*
> And the 2026 default's caveat: with native function calling on, *"attached knowledge is **not
> automatically injected**. The model must call the knowledge tools to search and retrieve."*

## 6.4 When the field reaches for which mechanism

Collecting the *stated* rationales rather than inferring them:

| mechanism | who ships it | stated reason |
|---|---|---|
| **always-on injection** | ST `constant`, Cline no-frontmatter rules, open-webui Full Context, AGENTS.md | short, always relevant; no tool call needed; deterministic |
| **keyword / glob trigger** | ST WI, Risu, Agnai, Lite, Claude Code path rules, Cline `paths` | *"only inserts relevant information … when keywords are present"*; *"loading every rule for every request wastes context tokens and can dilute focus"*; **predictability**: *"If you want deterministic and predictable results, stick to keyword matching."* |
| **embedding retrieval** | ST Vector Storage (off by default), open-webui Knowledge (default), Agnai chat/user embeds | *"large document sets where only specific sections are relevant"*; ST's own counter-warning: *"it's impossible to predict exactly what entries will be inserted"* |
| **model-driven tool retrieval** | ctrl-b Core Memory, Codex `ext/memories`, Kilo, open-webui with native FC | R38/R40: bounded always-injected index + literal search tools is the 2026 convention; nobody blocks the first token on an aux LLM call |

Two corroborations from dossiers already bought, not re-bought here:

- **R38** measured the same trade in our own class: 12 repos at HEAD, *"the two newest in-class memory
  systems (Codex CLI `ext/memories`, Kilo `kilo-memory`) both chose always-injected index + literal
  search tools"*, and arXiv 2605.15184 found grep beating vector retrieval *inside* Claude
  Code/Codex harnesses. R38 also records open-webui's **`memory_path_hints`** — a deterministic
  substring match of path segments ≥3 chars against the query, running *beside* its vector lane. That
  is a keyword trigger under another name, shipped by a project that also ships embeddings.
- **R40** established that Claude Code's ordinary shape is a bounded index plus ordinary file/search
  tools, with the LLM-selector cohort as a mutually exclusive experiment.

The distinguishing axis is **who decides**: keyword/glob triggers decide *in code, before the model
sees anything*, which buys determinism, zero latency, and zero tool-call budget, and costs recall on
paraphrase. Tool retrieval decides *in the model, mid-turn*, which buys recall and visibility and
costs a round trip. Embedding retrieval decides *in an embedding model, before the turn*, which buys
paraphrase recall and costs predictability and an extra service. **ST is the only system read here
that ships all three over one corpus**, and it defaults to the first.

---

# 7. Sizes, limits, and performance in the wild

- **ST's own shipped example book** (`default/content/Eldoria.json`): 4 entries, 3–5 keys each,
  content 710–1,551 characters (median 934), 4,129 characters total. Notably its entries are
  **Ali:Chat-style `{{user}}:`/`{{char}}:` dialogue exchanges, not encyclopedia facts** — the shipped
  reference for "what an entry looks like" is example dialogue.
- **KoboldAI Lite's shipped "Rubicon" scenario**: 34 entries, each one bracketed PList-style fact
  line (`[Gaius Julius Caesar: Prominent Roman general, statesman, writer; …]`), 1–3 keys each. A
  different house style at a similar entry count.
- **A maintainer's sizing baseline** [R]: ST PR #2615 (2024-08) benchmarks *"a very normal lorebook
  with **140 entries**, page size set to 50"*, and the fix was purely UI (2.0 s → 1.0 s initial editor
  render). **The reported ST performance problems in this area are editor-render, not scan.**
- **The one live scan-cost report** [R]: issue #5622 — 56 entries activated against **2,116 messages**,
  a 5 s typical / 30 s+ occasional stall before generation. The maintainer's triage is instructive:
  *"With 2k messages it can simply take a while for WI matching to go through everything. What is your
  WI scan depth setting? … I don't think this is a bug, it's more of a setup issue."* — and the
  profile ultimately pointed at a third-party extension and an autocomplete re-render, not the scan
  loop. **No confirmed WI-scan performance defect exists at this pin.** Note the structural reason:
  the scan window is `world_info_depth` messages (default 2), so chat length is nearly free; the cost
  scales with `entries × keys × passes`, and the expensive per-pass call is `getTokenCountAsync` on
  the accumulated content, not the matching.
- **Hard caps in code**: `MAX_SCAN_DEPTH = 1000` messages; `MAX_COMMENT_LENGTH = 100` (memo display
  only). There is **no cap on entry count, key count, or content length** in any of the four systems.
- **Budget defaults across the field**: ST 25% of max context (uncapped absolute by default); Risu
  **800 tokens absolute**; Agnai **500 tokens absolute**; Lite **none**. Scan depth: ST 2 messages,
  Risu 5 messages, Agnai 50 messages, Lite full context (in characters).

---

# 8. Corrections to premises

1. **⚠ R64 §3 says "`world_info_recursive` default false" and lists it as a module default.** True of
   the module initializer, **false of a shipped install**: `default/content/settings.json:17` sets
   `world_info_recursive: true` and `:20` sets `world_info_match_whole_words: true`, and that file is
   seeded to every new user. Any claim about "ST's default" must say *which* default. (§1.2)
2. **⚠ R64 §3 says "`world_info_max_recursion_steps` = 0 (unlimited when recursion on)".** Correct,
   but incomplete in a way that matters: it is **mutually exclusive with Min Activations**, and
   setting it non-zero silently disables the min-activations sweep because the `break` precedes that
   branch. (§1.2, §1.5)
3. **⚠ R64 §3's minimum-viable-seam verdict (`{keys[], content, enabled, insertion_order, constant,
   position}` + two ints) understates two things.** First, `position` is not a two-value field in any
   modern implementation — `atDepth` **with a role** is the position that does the work that
   `before`/`after` cannot, and `outlet` is the one that generalizes past roleplay. Second, the
   *ordering* axis is two numbers in three of four systems (Agnai `priority` vs `weight`, Risu
   `priority` vs `order`, V3 `priority` vs `insertion_order`) — eviction order and render order are
   **separate concerns**, and ST is the outlier for collapsing them into `order` (and consequently has
   no eviction at all, only refusal).
4. **⚠ The ST docs' "Sorted Evenly (default)" is wrong at this pin.** The module default and the
   shipped settings file are both `world_info_character_strategy: 1` = **Character Lore First**
   (`:80`, `settings.json:21`).
5. **⚠ The ST docs' "scan depth 0 → only recursed entries and Author's Note are evaluated" does not
   match the code at 1.18.0.** `WorldInfoBuffer.get` returns `''` for any depth ≤ 0 before it appends
   the inject or recursion buffers (`:281-283`), so depth 0 disables keyword matching entirely.
   Source-read, not run-verified. (§1.4)
6. **The V3 spec's budget model and ST's are different mechanisms.** V3 says *remove the lowest
   priority entries*; ST never removes an inserted entry — it stops inserting. Risu implements V3's
   model; Agnai implements a greedy variant. Do not read "token_budget" as one behaviour across the
   field.

---

# 9. Implications for ctrl-b — seams only, no decisions

Mapping the mechanism onto seams that already exist. **These are attachment points, not proposals.**

- **The injected-context layer.** `AgentSession._static_prefix` (`session.py:734-776`) is the ordered
  system head — system prompt → appends → roster → tier-1 memory → tier-2 core index → skills note —
  built once per turn and reused byte-identically, with the documented cache rule that mutable blocks
  sit **last among stable blocks**. A lorebook block whose content changes per turn is by construction
  the *most* volatile block in the head and would belong after both memory blocks, or outside the head
  entirely. ctrl-b already owns exactly one **ephemeral tail layer** — the reflection nudge, appended
  after history in `_assemble` and deliberately kept out of the cached head (`session.py:877-883`).
  That is the structural twin of ST's `atDepth` position, and it is currently the only depth-injection
  machinery in the codebase.
- **The prefix-cache constraint is the sharpest difference from the field.** Every system read here
  re-runs its scan every generation and rebuilds the block; none of them has a KV-cache invariant to
  protect. ctrl-b's head is explicitly engineered so that a memory write re-prefills *from that block
  onward only*. Any per-turn-varying injected block trades against that.
- **Core Memory (D57/D64) is the contrast, not the competitor.** Its mechanism is *always-inject a
  bounded routing index into the static head, and let the model pull topic bodies mid-turn as ordinary
  tool results* (`CORE_MEMORY_PLAN §1`, §4; `core_memory.py` module docstring). Precisely stated, the
  differences from a lorebook are: **who decides** (code-side keyword predicate vs model-side tool
  call), **when** (before the first token vs mid-turn), **what arrives** (a system block vs a `tool`
  message), **visibility** (invisible in the transcript vs a visible tool call — the property D57
  explicitly bought), **replay stability** (recomputed per turn vs frozen in the DB row), and
  **budget accounting** (a token budget over activated entries vs `topic_char_limit` per page and
  `recall_char_limit` per turn). They are complementary lanes over different corpora; the one place
  they would collide is the static head's byte budget and its cache boundary.
- **The Phase 18 prompt registry** (`services/agent/prompts.py`, 24 `PromptDef`s) owns *the words*
  while features own *the data* — `fleet_roster`/`skills_note`/`memory_intro` are framings with no
  placeholders, concatenated ahead of their data. A lorebook block's framing sentence is the same
  shape and would be a registry id; the entries are feature data. Note the registry's live-resolve,
  infallible-render, derived-placeholder contract already covers per-entry macro substitution of the
  `{{name}}` form — ST/Risu/V3 all use `{{char}}`/`{{user}}` CBS inside entry content and keys.
- **Config / `AgentDef`.** The 2026-06-24 extend-don't-migrate directive points hard at **one
  name-keyed object per entry** (the `tool_overrides: {<tool>: {description, agent_mode, settings?}}`
  precedent) rather than parallel maps — which is also what the whole field does (§1.1: one flat entry
  object with ~35 optional fields, every extension additive). R60's Picard precedent (an ordered
  `[(name, enabled)]` list) is the shape ctrl-b already reaches for when order and enablement co-exist.
  V3's `extensions: Record<string, any>` + decorator design is the field's answer to "how do you add a
  dimension without breaking other readers"; ctrl-b has no interop constraint, so the decorator half of
  that answer is cost without benefit — but the *reason* it exists (content-borne config survives every
  boundary) is worth carrying.
- **`AgentDef` / per-agent scope.** All four systems scope books by *context* — global, character,
  chat, persona — with a documented precedence and name-dedup (§1.3). ctrl-b's equivalent axes are
  global config, `AgentDef`, and thread. The field's rule is worth noting: the same book bound twice
  contributes once, from the higher-priority slot.
- **Tool-call adjacency.** ST's `automationId` (activation fires a script) and Risu's MCP-operator-text-
  as-a-constant-entry are the two places the field lets a lorebook touch *behaviour* rather than
  *text*. ctrl-b's tool registry + `run_shell` gate + the A3 automations scheduler are the seams a
  "keyword fires an action" feature would land on; both are privilege-gated, which the field's versions
  are not.
- **A note the security model would care about**: in every system read here, entry content is
  **unframed text spliced directly into the prompt**, and in ST it is macro-substituted before
  insertion (`substituteParams(entry.content)`, `:4938`). ctrl-b's own convention for foreign-authored
  text is the opposite — CORE_MEMORY_PLAN §4 frames the entire rendered index *"as fallible data, not
  instructions"* because it carries foreign-written text. A lorebook whose entries the owner writes is
  a weaker case than an imported book, and imported books are the field's primary distribution unit.

---

## Gaps this pass did not buy

- No **runtime measurement** of scan cost at scale (entries × keys × messages); the numbers in §7 are
  a maintainer's editor benchmark and one user report, both [R].
- ST `staging` was not read — everything here is `release` 1.18.0.
- **NovelAI's own lorebook semantics** were read only through ST's importer; NAI's `contextConfig`
  (prefix/suffix/reserved tokens/insertion position/trim direction) is a real model with its own
  budgeting that nobody here implements. If NAI import matters, it needs its own look.
- The **`{{outlet::}}` macro's** resolution site in the prompt-manager/formatting pipeline was not
  traced end to end; §1.11's description of it is from the position enum plus the docs.
- Chub/JannyAI/Character.AI and the wider card-hosting ecosystem's *distribution* conventions
  (how books are shared, versioned, and merged) were out of scope.
