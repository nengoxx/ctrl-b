# R43 — Tool-output retention in context + per-turn tool-call budgets, vs ctrl-b

| | |
|---|---|
| **Bounded question** | How do peer agent harnesses manage **tool-output retention in context** (clearing / eviction / pruning) and **per-turn tool-call budgets** — and are ctrl-b's chat defaults in line with the field or an outlier? |
| **Reference class** | Anthropic platform (context editing) · Claude Code (docs) · Codex CLI · opencode · goose · OpenClaw · Hermes Agent · letta-code |
| **Pins (resolved 2026-08-19)** | `openai/codex` @ `f5a3dc55404ddc066a4e4a65602fee166ecc46b3` · `anomalyco/opencode` @ `da4730e4a41dcbb2cb2d907dd2b06ac481b8f962` · `aaif-goose/goose` @ `9f941fbfc5f479d26747d13147457138163ab94e` · `letta-ai/letta-code` @ `ee230f304a1a9415d949420c0835ff8583df26f7` · **Hermes Agent** local read-only `/home/emma/.hermes/hermes-agent` @ `efc8ffa2743ff7b95b6694a56aa5a127eb8ee4a9` · **OpenClaw** `openclaw/openclaw` docs @ `main` (docs only — no source read) · Anthropic docs `platform.claude.com/docs/en/build-with-claude/context-editing` · Claude Code docs `code.claude.com/docs/en/how-claude-code-works` · ctrl-b @ working tree `main` (2026-08-19) |
| **Date** | 2026-08-19 |
| **Not re-bought** | **R35** (compaction *triggers*: pre-call estimate vs measured post-response usage) · **R36** (tool-result cap-and-spill; the four homes of `max_output_chars`) · **R39** (Anthropic context-editing + memory tool as a cap-pressure promotion trigger). This dossier is the **delta**: the clearing TRIGGER, the RETENTION shape, and per-tool call budgets. |
| **Drove** | CORE_MEMORY_PLAN §14d redesign items 1 + 2 (the two mandatory runtime seams) — and the owner's open question of whether the **chat defaults themselves** should be tuned. No D-entry yet. |

---

## 1. Answer to the bounded question (≤10 lines)

1. **TRIGGER — ctrl-b is alone in the class.** 5/5 systems that clear tool outputs gate on **context pressure** (Anthropic 100k input tokens · Claude Code "as you approach the limit" · OpenClaw >30% of window *and* an expired prompt cache · Hermes a token threshold that ships **off** · goose a tool-call count scaled to `context_limit × 0.8`). 3/3 of the rest (Codex, opencode, letta-code) **never** clear — they cap at record time and let compaction do the rest. **Nobody clears unconditionally on every loop iteration at any context size.** (VERIFIED)
2. **RETENTION — "keep last N" is universal, but N is measured in *turns*, not steps.** goose protects **every tool call since the current turn's kickoff**; OpenClaw protects the **last three assistant turns**; Anthropic keeps the **last 3 tool_use pairs**. ctrl-b's `clear_keep_steps = 2` **loop iterations** is the tightest window in the class and the only one that can erase a result the *same turn* produced it. (VERIFIED)
3. **Two mechanisms the field ships that ctrl-b has no equivalent of**: a **minimum-reclaim gate** before a cache-invalidating trim (Anthropic `clear_at_least`, Hermes `proactive_prune_min_reclaim_tokens = 4096` + a re-arm runway), and a **configurable per-tool exclusion list** (Anthropic `exclude_tools`, OpenClaw `contextPruning.tools.{allow,deny}`) where ctrl-b has a hardcoded 2-name frozenset. Both are motivated in-source by **prompt-cache invalidation cost**. (VERIFIED)
4. **PER-TOOL-PER-TURN CALL CAPS — nobody ships a blanket one.** 0/7 peers cap *every* tool. Two ship **selective** caps on runaway-prone tools: Hermes `max_web_searches = 50` / `max_subagents = 50` **per turn**, explicitly modelled on Claude Code v2.1.212's WebSearch/subagent caps. The rest use *no-progress* keying (identical result hash) or nothing. ctrl-b's blanket `max_calls_per_tool = 6` across every tool is an outlier by both **shape** (blanket vs selective) and **magnitude** (6 vs 50). (VERIFIED for the 7 repos; the Claude Code attribution is REPORTED, second-hand via a Hermes source comment.)

---

## 2. What ctrl-b does today (code-verified at HEAD)

| Behaviour | Cite | Value |
|---|---|---|
| Tier-1 clearing runs **every loop iteration**, gated only on the master switch | `backend/app/services/agent/compaction.py:215-217` (*"Gated on `cfg.enabled` … the run is otherwise UNCONDITIONAL (not gated on being over threshold)"*), called at `session.py:1354-1358` (*"the unconditional assembly-time tool-output clearing plan for THIS iteration"*) | no pressure gate |
| Size floor | `domain/agent.py:104` `clear_output_min_tokens = 500` | ≈2,000 chars |
| Age window | `domain/agent.py:107` `clear_keep_steps = 2` | 2 assistant-tool-call **rounds** |
| Exclusions | `compaction.py:97` `_NEVER_CLEAR_TOOLS = frozenset({"task_plan", "memory"})` | hardcoded, 2 names |
| Replacement | `compaction.py:78` `"[output cleared — re-run the tool if needed]"`; the `[state] summary` line + error survive (`session.py:311-315`) | placeholder, not a summary |
| Per-tool call cap | `domain/agent.py:202` `max_calls_per_tool = 6`; guard built per `_drive` at `session.py:1223`, enforced at `session.py:2096` / `2524` | blanket, per **tool name** |
| Consequence for `core_memory` | `core_memory_tool.py:49` — **one** tool with an `action: Literal["read","search","create","update","remove","delete"]` arg | reads and writes share one 6-call counter |
| Recall budgets | `config.py:409-410` `topic_char_limit = 4096`, `recall_char_limit = 20480` | 4–5 reads/turn |

So a 4,096-char `core_memory` read (≈1,024 tokens > the 500-token floor, not in `_NEVER_CLEAR_TOOLS`) is replaced with the placeholder **two tool rounds after it arrives**, regardless of context fill. §14d's mechanical finding is confirmed exactly as written.

---

## 3. The TRIGGER convention — clear-on-pressure vs clear-unconditionally

| Project | Clears old tool outputs? | Trigger | Confidence |
|---|---|---|---|
| **Anthropic context editing** (`clear_tool_uses_20250919`) | yes | `trigger: {type: "input_tokens", value: 100000}` by default; also accepts `tool_uses`. Docs: *"Clearing is **NOT unconditional**"* | VERIFIED (docs) |
| **Claude Code** | yes | *"manages context automatically **as you approach the limit**. It clears older tool outputs first, then summarizes the conversation if needed"* | REPORTED (docs; no threshold published) |
| **OpenClaw** (`contextPruning`) | yes, when enabled | **Two gates, both required**: the prompt-cache TTL has expired (`ttl` 1h Anthropic default) **and** context usage >~30% of window. Escalates to hard-clear only at ≥50% context **and** ≥50,000 prunable chars | REPORTED (docs) |
| **Hermes Agent** | yes | Two paths: (a) `prune_tool_results_only` gated on `proactive_prune_tokens` — **default `0` = off** (`context_compressor.py:2531`); (b) `_prune_old_tool_results` as **Phase 1 of compression**, i.e. behind `should_compress` at `threshold_percent = 0.50` of the window | VERIFIED (source) |
| **goose** | yes (summarizes) | `ToolPairCompactionOperation`, **on by default** (`GOOSE_TOOL_PAIR_SUMMARIZATION`, default `true`). Trigger is a tool-call **count** derived from the window: `compute_tool_call_cutoff = (3 × context_limit × 0.8 / 20_000).clamp(10, 500)`; fires only when eligible calls > `cutoff + 10` | VERIFIED (source) |
| **Codex CLI** | **no** | History items are recorded once, already truncated (`ContextHistory::record_items(items, policy: TruncationPolicy)`); no age- or pressure-based clearing of past outputs. Auto-compaction is the only reducer | VERIFIED (source) |
| **opencode** | **no** | `isOverflow()` on **measured** `tokens.total` vs `usable()` → compaction. No tool-output eviction pass | VERIFIED (source) |
| **letta-code** | **no (client-side)** | Delegates to the Letta server: `compaction_settings: {model}` on agent create | VERIFIED (source, light) |
| **ctrl-b** | yes | **none — every iteration, any context size** | VERIFIED |

**Count: clear-on-pressure 5 · never-clear 3 · clear-unconditionally 1 (ctrl-b).** Note that goose's count-based cutoff *is* a pressure proxy — it is computed from `context_limit × compaction_threshold`, so a bigger window means more tool calls survive.

---

## 4. The RETENTION shape

**4.1 What is protected (the "keep" window).** Every system protects recent work; the unit differs, and ctrl-b's is the smallest:

| Project | Protected window | Cite |
|---|---|---|
| goose | **every tool call since the current turn's kickoff** (`messages_since_kickoff` → `protected`) | `ops_tool_pair_compaction.rs` |
| OpenClaw | last **3 assistant turns**; nothing before the session's first user message | docs/concepts/session-pruning.md |
| Anthropic | last **3 tool_use/result pairs** (`keep: {type: "tool_uses", value: 3}`) | context-editing docs |
| Hermes | `protect_last_n` **messages** (6 in the shipped agent config; 20 in the compressor default), with an `_MAX_TAIL_MESSAGE_FLOOR = 8` | `context_engine.py:123`, `context_compressor.py:2518` |
| **ctrl-b** | last **2 assistant-tool-call rounds** | `domain/agent.py:107` |

**4.2 What replaces a cleared output.** Three shapes in the field, and ctrl-b uses the least informative:
- **Placeholder** — Anthropic (*"placeholder text indicating to Claude that it was removed"*, exact text undocumented); OpenClaw `[Old tool result content cleared]` (**configurable**: `contextPruning.hardClear.placeholder`); ctrl-b `[output cleared — re-run the tool if needed]`.
- **Head+tail soft-trim before any hard clear** — OpenClaw: results >4,000 chars keep the **first and last 1,500 chars** and are only hard-cleared under the escalated gate. Codex applies the same idea at record time (`truncate_middle_*`).
- **A summary that carries information** — Hermes replaces the body with a deterministic 1-line description built from the call itself (`_summarize_tool_result` → `[terminal] ran \`npm test\` -> exit 0, 47 lines output`, *"rather than a generic placeholder that carries zero information"*); goose spends an **LLM call** to summarize the whole request/response pair, in async batches of `TOOLCALL_SUMMARIZATION_BATCH_SIZE = 10`.

**4.3 Cap-and-spill (ties to R36, fresh numbers at these pins).**
- **opencode** `tool/truncate.ts`: `MAX_LINES = 2000`, `MAX_BYTES = 50 * 1024`; over-limit output is written to a truncation dir (7-day retention) and the model gets a preview **plus the file path** and an explicit hint — *"Full output saved to: {file}. Use the Task tool to have explore agent process this file with Grep and Read (with offset/limit). Do NOT read the full file yourself - delegate to save context."*
- **Codex**: per-model `truncation_policy` — `{mode: "tokens", limit: 10000}` for every current model in `models-manager/models.json` (one legacy model uses `bytes`), applied **at record time** with middle-truncation; `unified_exec` `DEFAULT_MAX_OUTPUT_TOKENS = 10_000`.
- **letta-code**: `DEFAULT_MAX_OUTPUT_TOKENS = 10_000` (`src/tools/impl/exec-command.ts:37`).
- ctrl-b: `max_output_chars = 6000` head-only, no handle, shell/MCP/OpenAPI only (R36 — not re-bought).

**4.4 Per-tool exclusion.** Anthropic `exclude_tools: [...]` (per request) and OpenClaw `agents.defaults.contextPruning.tools.{allow,deny}` (per config) both make "never clear this tool" **data**. ctrl-b makes it a source-level `frozenset` (`compaction.py:97`), which is why the ruled `core_memory` exemption is a code change rather than a setting.

---

## 5. Per-turn tool-call budgets

| Project | Blanket per-tool-per-turn cap? | What it ships instead | Cite |
|---|---|---|---|
| **Hermes** | **no** | **Selective per-turn caps on runaway-prone tools**: `max_web_searches = 50`, `max_subagents = 50`, counters reset per agent loop, `0` disables. Plus a *no-progress* detector keyed on `(signature, result_hash)`: warn at 2 identical results, block at 5; identical **failures** blocked at 5 | `agent/tool_guardrails.py:135-160, 75-79` |
| **Claude Code** | no | Caps on WebSearch calls and subagent spawns, added v2.1.212 (Week 29, July 2026) | REPORTED — second-hand, quoted in the Hermes source comment above; not verified against Claude Code itself |
| **Codex CLI** | **no** | Nothing per-tool; only `MAX_PENDING_EXECUTED_TOOL_CALLS` (a nested-call queue bound) | `tools/executed_tool_calls.rs:157` |
| **goose** | **no** | `MaxTurnsOperation(max_turns)` — an **iteration** cap, not a per-tool one | `agents/agent.rs:1642` |
| **OpenClaw** | **no** | `tools.loopDetection.enabled`, **default `false`**; pattern-based on repeated `(tool, args, result)` triples — *"The guard never aborts while results are changing; only byte-identical results across the window trigger it"* | docs/tools/loop-detection.md |
| **opencode** | **no** | nothing found | grep, VERIFIED-negative |
| **letta-code** | **no** | nothing found | grep, VERIFIED-negative |
| **ctrl-b** | **yes — every tool, 6/turn** | plus `max_repeat_calls = 2` (identical `(tool, args)`), `max_stall_iterations = 2`, `max_iterations = 16` | `domain/agent.py:201-203` |

**Distinguish the two things the field conflates in casual reading.** *Turn/iteration caps* (goose `max_turns`, Hermes `IterationBudget` — parent 500, subagent 50; ctrl-b `max_iterations = 16`) are universal. *Per-tool call caps* are not: they exist in exactly 2/7 systems, only on `web_search`/subagent spawns, at 50 — an order of magnitude above ctrl-b's blanket 6, and applied to the two tools that are expensive **outside** the process, never to a local read.

---

## 6. The cost the field prices and ctrl-b does not: prompt-cache invalidation

Every system that rewrites already-sent history names cache invalidation as the reason for its gates:

- **Anthropic** (docs, verbatim): *"Tool result clearing: **Invalidates cached prompt prefixes** when content is cleared. To account for this, clear enough tokens to make the cache invalidation worthwhile. Use the `clear_at_least` parameter to ensure a minimum number of tokens is cleared each time. You'll incur cache write costs each time content is cleared."*
- **Hermes** (source, verbatim): *"PROMPT-CACHE CONTRACT: a committed prune rewrites message bodies the provider has already seen, **invalidating the cached prefix from the earliest rewritten message forward** — exactly like a compression boundary. A prune therefore commits only when it reclaims `proactive_prune_min_reclaim_tokens` and **disarms until message history has regrown a full trigger-sized runway**."*
- **OpenClaw**: the entire default mode is `cache-ttl` — pruning is allowed **only once the cache has already lapsed**, which makes the invalidation free by construction.

ctrl-b's clearing shifts its own boundary forward on every iteration (`keep_from = n_steps − clear_keep_steps`), so each new tool round rewrites the prefix at the position of the newly-expired output. Whether llama.cpp's prefix cache actually charges us for that at our sizes is **UNVERIFIED** (R36 flagged the same open question for `narrow_tools`), but ctrl-b is the only system here that performs the rewrite with **no gate of any kind** — no pressure trigger, no minimum reclaim, no cache-state check.

---

## 7. Implications for ctrl-b's chat defaults (short, and separable from the evidence)

Ordered by evidence strength. Items 1–2 are the same two seams §14d already ruled mandatory — the field says they should be fixed **generically**, not by special-casing `core_memory`.

| # | Change | Evidence line |
|---|---|---|
| 1 | **Pressure-gate Tier-1 clearing** — add a trigger (fraction of window, or an absolute token line) below which nothing is cleared. Anthropic's shape is the closest published analogue: a `trigger` with a generous default. | 5/5 clearing systems gate on pressure; 0/8 clear unconditionally. Anthropic's own docs say the clearing *"is NOT unconditional"*. Under a gate, a consolidation pass on a fresh thread never clears at all. |
| 2 | **Protect the current turn, not 2 rounds** — change the keep window's unit from "assistant-tool-call rounds" to "since this turn's kickoff" (or raise the default well above 2). | goose protects every call since kickoff; OpenClaw 3 assistant turns; Anthropic 3 pairs. ctrl-b's 2 *iterations* is the only window that can erase a result the same turn produced — the exact mechanism that made read→read→merge impossible (§14d). |
| 3 | **Make the exclusion list config** (`clear_exclude_tools: [...]`), defaulting to today's `{task_plan, memory}` + `core_memory`. | Anthropic `exclude_tools`; OpenClaw `contextPruning.tools.{allow,deny}`. Makes the ruled `core_memory` exemption a setting rather than a source edit, and covers the next tool that needs it. **Interaction with the ruled fixes:** with (1)+(2) in place the `core_memory` exemption stops being load-bearing for consolidation, but it stays cheap insurance for a single very long turn — keep it, demote its urgency. |
| 4 | **Add a minimum-reclaim gate** before committing a trim (the `clear_at_least` / `proactive_prune_min_reclaim_tokens` shape). | Anthropic + Hermes both ship it, both for the cache reason (§6). Cheap: `ClearingPlan.gain` is already computed and priced. |
| 5 | **`max_calls_per_tool = 6` blanket → raise substantially, and/or make it per-tool.** The field's cap on the *most* runaway-prone tools is **50**; nobody caps a local read at all. A per-tool override map (or a `read`-vs-`mutate` split for multi-action tools) is the shape that matches. | 0/7 peers ship a blanket cap. Hermes/Claude Code cap only `web_search` + subagent spawns, at 50. §14d proved the blanket 6 is what cap-denied the merge `create`. |
| 6 | *(lower confidence)* **Replace the placeholder with an informative one-liner** — ctrl-b already keeps `[state] summary`, which is a partial version of Hermes's idea; the gap is that the summary is the tool's own, not a description of what was dropped. Consider a soft-trim tier (head+tail) before hard-clear, as OpenClaw does at 4,000 chars. | Hermes deterministic summary; goose LLM pair-summary; OpenClaw two-tier soft-then-hard. Cost/benefit at N=1 is not obviously positive — flagged, not recommended. |
| 7 | *(adjacent, confirms §14c item 4)* **Paged `core_memory` reads** are the field's cap-and-spill pattern applied to our own tool: opencode returns a preview + a path + *"use Grep / Read with offset/limit; delegate"*. Our 4,096-char clamp with no offset is the same problem the field solved with a handle. | opencode `truncate.ts`; Codex `truncate_middle`; R36's ~30k cap-and-spill finding. |

---

## 8. What I could not determine

- **Claude Code's exact clearing thresholds and keep-window.** The public docs state the ordering (*clear tool outputs first, then summarize*) and the trigger qualitatively (*as you approach the limit*) but publish no numbers. No source read this pass (R37/R40 pinned a leaked tree at `a371abb`, but that pass covered the memory subsystem; the retention code was not read here).
- **Claude Code's per-tool caps** (WebSearch, subagent spawns) — REPORTED only, via a Hermes source comment citing "v2.1.212 (Week 29, July 2026)". Not verified against Claude Code itself; the numbers are not quoted there.
- **OpenClaw is docs-only.** Every OpenClaw claim (cache-TTL gate, 30%/50% thresholds, 4,000/1,500-char soft-trim, `[Old tool result content cleared]`) comes from `docs/concepts/session-pruning.md` and `docs/tools/loop-detection.md` at `main`, not from source. Treat the numbers as REPORTED.
- **Whether llama.cpp's prefix cache actually charges ctrl-b for the per-iteration prefix rewrite** — unmeasured (same open question R36 recorded for `narrow_tools`). The §7 item-4 recommendation rests on field practice, not on a measurement of our stack.
- **Hermes `protect_last_n` as actually configured in the owner's deployment** — the compressor default is 20, `context_engine.py` declares 6, and `agent_init.py` wires `compression_protect_last` from config; I did not resolve the live value.
- **opencode's compaction internals** (`session/compaction.ts`, 608 lines) were not read — only `overflow.ts` (the trigger) and `tool/truncate.ts` (the cap). R35 already owns opencode's trigger.
- **Anthropic's exact placeholder string** is not published.

---

## 9. Sources

**Source-read at the pins in the header (VERIFIED)**
- Hermes Agent: `agent/context_compressor.py` (`prune_tool_results_only`, `_prune_old_tool_results`, `_summarize_tool_result`, `should_compress_info`, constructor defaults ~L2516-2590), `agent/context_engine.py:123`, `agent/agent_init.py:1999-2010, 2533-2548`, `agent/tool_guardrails.py:75-79, 128-175`, `agent/iteration_budget.py`.
- Codex CLI: `codex-rs/core/src/context_manager/history.rs`, `codex-rs/core/src/compact.rs`, `codex-rs/utils/output-truncation/src/lib.rs`, `codex-rs/protocol/src/protocol.rs:3103` (`TruncationPolicy`), `codex-rs/protocol/src/openai_models.rs:913`, `codex-rs/models-manager/models.json`, `codex-rs/core/src/unified_exec/mod.rs:72`, `codex-rs/core/src/tools/executed_tool_calls.rs:157`.
- goose: `crates/goose/src/context_mgmt/mod.rs:25-31, 369-411, 495-531`, `crates/goose/src/agents/state_machine/ops_tool_pair_compaction.rs`, `crates/goose/src/agents/agent.rs:1628-1660`, `crates/goose-context-management/src/lib.rs:32`.
- opencode: `packages/opencode/src/session/overflow.ts`, `packages/opencode/src/tool/truncate.ts`.
- letta-code: `src/agent/create-agent-request.ts:63-80,176-178`, `src/tools/impl/exec-command.ts:37,161-165`.
- ctrl-b: as cited in §2.

**Docs, fetched (REPORTED)**
- `https://platform.claude.com/docs/en/build-with-claude/context-editing.md` — full `clear_tool_uses_20250919` parameter set + the cache caveat quoted in §6.
- `https://code.claude.com/docs/en/how-claude-code-works` — §"When context fills up".
- `https://raw.githubusercontent.com/openclaw/openclaw/main/docs/concepts/session-pruning.md`, `.../concepts/compaction.md`, `.../concepts/context-engine.md`, `.../tools/loop-detection.md`, `.../tools/tokenjuice.md` (the last is a plugin that reformats noisy `exec`/`bash` results — **not** a retention mechanism; recorded so the next reader does not re-check it).

**Deliberately not re-bought:** R35 §(compaction triggers), R36 §(cap-and-spill; `max_output_chars`'s four homes; MCP prefix-eligibility), R39 §(cap-pressure promotion; Anthropic memory tool).
