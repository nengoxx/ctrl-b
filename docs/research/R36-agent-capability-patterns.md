# R36 — How capable agent systems let the agent *work*

| | |
|---|---|
| **Question** | How do the most capable agent systems handle the CAPABILITY/WORKING-STYLE layer — tool-loop efficiency (parallel calls, batching, output handling), planning/task tracking, subagent orchestration, autonomy vs approval, token/caching efficiency — and where does ctrl-b's harness diverge in ways that suggest a flaw, inconsistency, or inefficiency? |
| **Date** | 2026-08-16 |
| **Reference class** | Claude Code + Claude Agent SDK + Anthropic agent-design docs · Codex CLI (`openai/codex`, source read at HEAD) · Hermes Agent (NousResearch) · OpenClaw (owner-added; D14 lineage) · opencode (light) |
| **Scope note** | The **turn machinery** (lifecycle, streaming wire, interruption, compaction internals, durability, error recovery) is a sibling pass — deliberately out of scope here. |
| **Prior art — do NOT re-buy** | `AGENT_CHAT_AUDIT.md` §3 (8-agent comparative, 2026-07-07) covers parallel-execution *existence*, approvals two-axis validation, compaction recipe, cache doctrine, loop guards, memory parity. R30 (peer prompt internals), R31 (eval harnesses + OTel metrics taxonomy). **This dossier buys only what is new or deeper since.** |
| **Confidence key** | **VERIFIED** = I read the source/doc text myself (raw file or grepped raw markdown). **REPORTED** = a fetched page summarised by a reader model; wording may be paraphrased even where quoted. **UNVERIFIED** = expected but not checked. |

---

## 0. Verdict up front

Six findings, ordered by how much they should change a design.

1. **Tool-result handling is ctrl-b's biggest capability-layer gap.** The field has converged on *cap-and-spill*: truncate what reaches the model, but hand it a **recoverable handle** (a file path, a pagination cursor) so the agent can go get the rest. Claude Code spills a Bash result past ~30,000 chars to a file and gives Claude the path; Managed Agents auto-offloads any tool output past 100,000 chars the same way. ctrl-b truncates at 6,000 chars **terminally** — head-only, no tail, no handle, and the number is written in three places (one config field + two module constants).
2. **Parallel dispatch: ctrl-b's "leading read-only prefix" is the field's weakest form of the same idea.** Codex implements the identical safety property with a **readers-writer lock** — parallel-safe tools take a read lock, mutating tools take a write lock — which parallelises *any* arrangement of a mixed batch. ctrl-b parallelises only a maximal **leading** run of ≥2 read-only calls, so `[reboot, ping, ping, check]` runs fully serial.
3. **Subagents: 3/3 peers ship asynchronous, addressable, resumable children; ctrl-b ships a blocking fire-and-gather batch.** Codex exposes nine agent-management tools (`spawn_agent`, `send_input`, `followup_task`, `wait_agent`, `interrupt_agent`, `close_agent`, …); OpenClaw's `sessions_spawn` "returns a run id immediately"; Claude Code has background subagents plus `SendMessage`/resume-by-id. ctrl-b's `spawn_subagents` awaits a TaskGroup and returns one aggregate — the parent cannot steer, interrupt, or follow up a child.
4. **The field has adopted LLM-mediated approval as a *default*, which ACA §3.13 explicitly rejected in 2026-07.** Claude Code's **auto mode** (default on Pro/Max/Team) has "a classifier decide most of these prompts instead of you"; OpenClaw's `auto` permission mode "send[s] misses through auto-review before falling back to human approval". This does not make ctrl-b's ruling wrong — its actions shut down real machines — but the ruling's premise ("redundant with static typed-action risk") is now a minority position and deserves a re-read, not a re-litigation by default.
5. **Two independent, *measured* token-efficiency mechanisms exist that ctrl-b has no analogue for:** deferred tool schemas (`defer_loading` + a search tool — Anthropic, Codex, OpenClaw all ship it) and **Code Mode** (the model writes a program that calls tools inside a sandbox; only the program's output enters context). OpenClaw reports Code Mode "reduced total token usage by roughly 30-50% at equal-or-better task pass rates". ctrl-b's own live finding — `minig+` "confused by the 21-tool namespaced set" — is the exact problem these solve, and ACA A8 parked the mechanism at "measure first".
6. **Where ctrl-b is at or ahead of the field:** the unified capability model (one `ToolSpec` for actions/utilities/builtins/MCP/OpenAPI) is cleaner than any peer's; `core=True` cognitive builtins that survive allowlist narrowing has no peer equivalent I found; the per-tool `timeout_s` **deadline policy with a fail-closed test** (`test_deadline_policy_aca67`) is stricter than anything in the field; and the D14 Hermes-lineage cognitive set (plan/memory/session-search/skills/delegate/ask) is confirmed still one-for-one with Hermes at HEAD.

---

## 1. The ctrl-b baseline (bounded — read for comparison, not audited)

All **VERIFIED** by reading source on `main` @ `cdfd48d`, 2026-08-16.

- **Tool surface.** ~24 registered builtins/actions (`ping_host`, `wake_host`, `check_service`, `start/stop/restart_service`, `open_service_url`, `shutdown_host`, `reboot_host`, `run_shell`, `tailscale_serve_{enable,disable}`, `web_search`, `ip_info`, `dns_trace`, `yt_captions`, `terminal_*`, `task_plan`, `memory`, `session_search`, `skill_manage`, `question`, `create_automation`, `list_automations`, `spawn_subagents`) plus dynamically registered MCP + OpenAPI + open-terminal tools. `AgentDef.tools` defaults to `"*"`.
- **One interface for everything** (`core/tool.py:ToolSpec`): `risk`, `confirm`, `read_only`, `idempotent`, `suspending`, `agent_exposed`, `ui_exposed`, `core`, `timeout_s`, `input_model`/`raw_schema`.
- **Gate** (`core/permissions.py:decide`): pure function; order **policy DENY > `spec.confirm` (un-downgradable) > `approved` (D44 persisted arg-glob grants) > risk×privilege**. `run_shell` denied unless `shell.agent_exec` or `Privilege.FULL`.
- **Parallel dispatch (D40).** `_classify_batch` takes the **maximal leading run** of parallel-eligible calls; eligibility = spec exists AND *builtin-authored* `read_only` AND `not suspending` AND `category != "mcp"`. `<2` eligible ⇒ no parallel machinery. Bound: `AgentDef.max_parallel_tools` (default 4; `1` = off). Tail runs serially.
- **Tool result → model** (`_tool_content`): `[state] summary\n{output}\nerror: …`. D42 Tier-1 clearing replaces *only* the output payload with a placeholder at assembly time.
- **Output caps:** `ShellCfg.max_output_chars = 6000` (applied in `actions/shell.py` only); `_MAX_OUTPUT_CHARS = 6000` hardcoded separately in `adapters/mcp_client.py` and `adapters/openapi_tools.py`. Head-only slice + `"… [truncated]"`. **No central cap; no spill; no pagination.**
- **Planning:** `task_plan`, `core=True`, TodoWrite-style whole-list rewrite, `data["plan"]` persisted as a `tool_result` part.
- **Subagents:** `spawn_subagents(tasks=[...], agent=…)` → `ParallelOrchestrator` inside one `asyncio.TaskGroup`; depth ≤ `max_subagent_depth` (2), per-agent `max_concurrent_subagents` (3), process-wide `global_subagent_limit` (6), per-child 180 s; privilege clamped to parent; children get ephemeral thread ids; result = one aggregate `ToolResult`.
- **Skills:** `FileSkillProvider` scans `SKILL.md`; `KeywordSkillSelector(min_overlap=1, max_skills=2)`; active skills inject instructions and may **narrow** the toolset (`narrow_tools`), never widen; `core=True` tools survive narrowing.
- **Loop guards:** repeat 2 · per-tool 6 · result-signature stall 2 · `max_iterations` 16 → forced tool-less `_finalize`.
- **Cache:** `_static_prefix` + `_tools_cache`, token cost measured (`_head_tokens`/`_tools_tokens`), hit rate logged (`_fmt_cache`).

---

## 2. Tool surface & granularity — how many tools, and why

### 2.1 The field's stated philosophy (VERIFIED — Anthropic `shared/agent-design.md`, shipped in the `claude-api` skill, read 2026-08-16)

The clearest articulation of *when to promote an action to a typed tool* comes from Anthropic's own agent-design guidance, and it independently derives ctrl-b's D8 typed-action doctrine:

> "A **bash tool** gives Claude broad programmatic leverage — it can perform almost any action. But it gives the harness only an opaque command string, the same shape for every action. Promoting an action to a **dedicated tool** gives the harness an action-specific hook with typed arguments it can intercept, gate, render, or audit."

Four listed reasons to promote — and the fourth is the one ctrl-b under-exploits:

> "**Scheduling.** Read-only tools like `glob` and `grep` can be marked parallel-safe. When the same actions run through bash, the harness can't tell a parallel-safe `grep` from a parallel-unsafe `git push`, so it must serialize."

> "**Rule of thumb:** Start with bash for breadth. Promote to dedicated tools when you need to gate, render, audit, or parallelize the action."

Counter-pressure from the same corpus: "**Limit tool count**: Too many tools can confuse the model — keep the set focused" — and, from the tool-description guidance, the opposite failure is more common: "the most common failure is *under*-description. Detailed descriptions are by far the most important factor in tool performance."

### 2.2 Measured tool counts (2026-08-16)

| System | Agent-visible tools | Shape | Confidence |
|---|---:|---|---|
| **Claude Code** | **44 built-ins** (`Agent`, `Artifact`, `AskUserQuestion`, `Bash`, `Cron{Create,Delete,List}`, `Edit`, `EndConversation`, `Enter/ExitPlanMode`, `Enter/ExitWorktree`, `Glob`, `Grep`, `ListAgents`, `List/ReadMcpResource*`, `LSP`, `Monitor`, `NotebookEdit`, `PowerShell`, `PushNotification`, `Read`, `RemoteTrigger`, `ReportFindings`, `ScheduleWakeup`, `SendMessage`, `SendUserFile`, `ShareOnboardingGuide`, `Skill`, `Task{Create,Get,List,Output,Stop,Update}`, `TodoWrite`, `ToolSearch`, `WaitForMcpServers`, `WebFetch`, `WebSearch`, `Workflow`, `Write`) + MCP | Broad `Bash` **plus** many typed tools; skills add capability *without* adding tool entries ("a skill … runs through the existing `Skill` tool rather than adding a new tool entry") | VERIFIED (grepped raw `tools-reference.md`) |
| **Codex CLI** | ~20 handlers: `shell`, `unified_exec`, `apply_patch`, `view_image`, `plan` (`update_plan`), `mcp`, `mcp_resource`, `tool_search`, `request_permissions`, `request_user_input`, `get_context_remaining`, `new_context`, `multi_agents`(9 sub-tools), `current_time`, `sleep`, `wait_for_environment`, plugin install tools | Shell-centric core + a **meta** layer (context, permissions, tool discovery, agent management) | VERIFIED (GitHub API dir listing + raw `.rs` spec files) |
| **Hermes Agent** | **~86 tools across 29 toggleable toolsets** (browser 12, kanban 14, spotify 7, desktop_ui 7, file 4, homeassistant 4, …) | Very large, but **toolset-gated**; MCP tools namespaced `mcp__<server>__` | REPORTED (docs `tools-reference.md` at HEAD) |
| **OpenClaw** | ~11 categories: `exec`/`process`/`terminal`/`code_execution`, `read`/`write`/`edit`/`apply_patch`, `ask_user`, web/browser/screen, `message`, `sessions_*`/`subagents`/`agents_*`/goal tools, `cron`, `gateway`/`nodes`, media | Shell + typed, with policy-time filtering | REPORTED |
| **ctrl-b** | ~24 + dynamic | All typed; `run_shell` is the one broad escape hatch, HIGH-risk and off by default | VERIFIED |

**Reading:** ctrl-b's ~24 is not an outlier on count. What is unusual is that **every peer with a big surface also ships a mechanism to stop the whole surface reaching the model every turn** (§4), and ctrl-b does not. Hermes gates by *toolset*; OpenClaw enforces "Tool policy … before the model call. If policy removes a tool, the model does not receive that tool's schema for the turn" (REPORTED) — which is exactly ctrl-b's `for_agent` + `narrow_tools`, so this seam exists; it is the *dynamic* half (search / defer) that is missing.

### 2.3 The cognitive-builtin set is a genuine convergence (VERIFIED for ctrl-b, REPORTED for peers)

| Capability | ctrl-b | Hermes | Codex | Claude Code |
|---|---|---|---|---|
| Plan / todo | `task_plan` | `todo` | `update_plan` | `TodoWrite` |
| Memory | `memory` | `memory` | — (AGENTS.md) | auto-memory + `memory` scope |
| Past-session search | `session_search` | `session_search` | — | — |
| Skills | `skill_manage` | `skill_manage`/`skill_view`/`skills_list` | skills (docs/skills.md) | `Skill` |
| Ask the human | `question` | `clarify` | `request_user_input` | `AskUserQuestion` |
| Delegate | `spawn_subagents` | `delegate_task` | `spawn_agent` (+8) | `Agent` |

Six-for-six with Hermes. D14's lineage claim still holds at HEAD. **This is a non-risk worth writing down** (ATAM non-risk register, R33 §): the cognitive set is not under-specified, it is field-standard.

---

## 3. Tool-loop efficiency: parallelism, batching, and result handling

### 3.1 Parallel-by-default is the API-level norm (VERIFIED — Anthropic `shared/tool-use-concepts.md`)

> "**Parallel tool use (default on):** one assistant message may contain multiple `tool_use` blocks. Execute them concurrently, then return **all** `tool_result` blocks in a **single** user message — splitting them across multiple messages silently trains Claude to stop making parallel calls."

Two operational corollaries ctrl-b should check itself against: (a) the *opt-out* is `disable_parallel_tool_use: true` on `tool_choice` — i.e. the default is concurrent, and (b) **for a failed tool, return `tool_result` with `is_error: true` — don't drop it**, or the model is trained away from batching.

### 3.2 Codex's readers-writer gate — the mechanism ctrl-b should compare against (VERIFIED, raw source)

`codex-rs/core/src/tools/parallel.rs`:

```rust
let supports_parallel = router.tool_supports_parallel(&call);
…
let _guard = if supports_parallel {
    Either::Left(lock.read().await)      // many parallel-safe tools concurrently
} else {
    Either::Right(lock.write().await)    // a mutating tool runs alone
};
```

Every tool call is spawned immediately; admission through a single `RwLock` *is* the ordering discipline. Consequences:

- A mixed batch `[read, read, mutate, read, read]` runs the first two concurrently, drains, runs the mutation alone, then the last two concurrently. **No prefix restriction, no lost parallelism.**
- Eligibility is declared per handler: default false; `view_image` returns `true`; **MCP tools derive it from the annotation** —
  > "Correctly implemented MCP servers should tolerate parallel calls to tools that advertise themselves as read-only." (`handlers/mcp.rs`, with tests `mcp_read_only_hint_supports_parallel_calls_without_server_opt_in` and `mcp_parallel_calls_require_read_only_hint_or_server_opt_in`)
- `shell`, `unified_exec`, `apply_patch` declare nothing ⇒ default false ⇒ exclusive.

**Two clean divergences from D40.** (i) *Shape*: leading-prefix vs RW-lock. (ii) *MCP trust*: ctrl-b marks `category == "mcp"` prefix-**INELIGIBLE** on the grounds that a derived `readOnlyHint` is advisory; Codex trusts the same hint (gated by a server opt-in path) and ships tests for both directions. Both positions are defensible — ctrl-b's is stricter — but ctrl-b's stance means **an MCP-heavy agent gets zero parallelism, ever**.

### 3.3 Tool-result handling: cap-and-spill, head-**and-tail**, and a recoverable handle

The concrete numbers the field ships (VERIFIED unless noted):

| System | Inline cap | Over-cap behaviour |
|---|---|---|
| **Claude Code — Bash** | ~30,000 chars (valid) / ~10,000 chars (failure); `BASH_MAX_OUTPUT_LENGTH` default 30,000, ceiling 150,000 | Valid: "the path of a file saved to the session directory … plus a short preview from the start, and Claude reads or searches the file when it needs the rest". Failure: "a **head-and-tail excerpt** of that size". A command over 5 GB of output is killed. |
| **Claude Code — Glob** | 100 files | "Claude sees a truncation flag in the result and can narrow the pattern" |
| **Claude Code — Grep** | `head_limit`/`offset` params | Match **total** is reported even when the listing is truncated |
| **Claude Code — WebSearch** | 200 calls per session, counted across subagents | At the cap, "further calls return a notice telling Claude to continue with the information it already gathered, rather than an error that would invite a retry" |
| **Managed Agents (all tools, incl. MCP)** | **100,000 characters (~25,000 tokens)** | "the output is automatically offloaded to a file in the sandbox — the agent receives a truncated preview plus the file path and can `read` the full content. No configuration required." |
| **OpenClaw Code Mode** | 64 KB serialized output budget | "oversized results are truncated with guidance" (REPORTED) |
| **OpenClaw `tokenjuice`** | n/a | Opt-in plugin that "compacts noisy `exec` and `bash` tool results **after** the command has already run", with a "safe-inventory policy: exact file-content reads stay raw" (REPORTED) |
| **ctrl-b** | **6,000 chars**, `run_shell` + MCP + OpenAPI only | Head-only slice + `"… [truncated]"`. **Terminal — no path, no cursor, no tail.** Native actions (`check_service`, `tailscale_*`, `web_search`, `ip_info`, `dns_trace`, `yt_captions`, `terminal_*`) have **no cap at all**. |

Three separate deltas here, and they are independent of each other:

1. **No handle.** Every peer that truncates gives the model a way back to the data. ctrl-b's truncation is information destruction.
2. **Head-only on failures.** Claude Code deliberately switches to head-and-tail for failures because the diagnostic lives at the end of stderr. ctrl-b's `_clip` keeps the head — so a 6,001-char failing command shows the model the banner and hides the error.
3. **Three homes for one number.** `ShellCfg.max_output_chars` (config, tunable) + two `_MAX_OUTPUT_CHARS = 6000` module constants (hardcoded). This is the "prefer configurable, no hardcoding" directive and the "one source of truth" rule, both violated in the same value.

### 3.4 Batching and round-trip elimination (the mechanism above parallelism)

**Programmatic tool calling** (Anthropic, GA — VERIFIED) and **Code Mode** (OpenClaw, experimental — REPORTED) are the same idea: the model writes a *program* that calls tools; the calls execute out-of-context and only the program's final output returns.

> "When the script calls a tool, the container pauses, the call is executed … and the result returns to the running code — not to Claude's context. … Only the script's final output returns to Claude." (Anthropic)

> "code mode reduced total token usage by roughly 30-50% at equal-or-better task pass rates, mostly by replacing many full tool schemas and per-tool round trips with one compact program surface." (OpenClaw, A/B evaluation — REPORTED, no methodology published)

Limits OpenClaw ships with it: 10 s default timeout (clamped 100–60000 ms), 64 MB memory, 64 KB output budget, **max 16 concurrent nested tool calls**, 900 s snapshot TTL.

*Relevance to ctrl-b is low today* (a fleet agent makes 2–6 calls a turn, not 200), but the **number** is the useful part: the field's measured headroom from schema+round-trip elimination is 30–50%, which sets the scale for what ACA A8's "measure the manifest" is measuring against.

---

## 4. Token/context economy at the capability layer

### 4.1 Deferred tool schemas are now table stakes (VERIFIED across three systems)

- **Anthropic API:** `tool_search_tool_regex_20251119` / `..._bm25_20251119` server tools + `"defer_loading": true` on user tools. "Claude searches the tool set and loads only relevant schemas. **Tool definitions are appended, not swapped — preserves cache.**" Guard: "at least one tool in `tools` must be non-deferred, or the API returns 400 `All tools have defer_loading set`."
- **Claude Code:** ships `ToolSearch` as a built-in; `WaitForMcpServers` "Only appears when tool search is disabled, since `ToolSearch` handles the wait when it's enabled" (VERIFIED) — i.e. the tool surface itself is conditional on the discovery mode.
- **Codex:** `tool_search` handler over "deferred tool metadata with BM25", and `ToolSpec` carries a `defer_loading` field (VERIFIED, raw source). Instruction text: "Some of the tools may not have been provided to you upfront, and you should use this tool (`tool_search`) to search for the required tools."
- **OpenClaw:** Tool Search + Code Mode; Code Mode supersedes Tool Search when active (REPORTED).

**ctrl-b has none of this**, and has an *observed* failure mode that it addresses (the `minig+` 21-tool confusion, HANDOFF). The mitigation it shipped instead — the `fleet` intent-skill narrowing the toolset — is a **static, author-time** version of the same idea. That is a legitimate design point at N=24 tools, and the cache argument actually favours static narrowing (see §4.3). But it is a *choice*, and nothing in the docs records it as one.

### 4.2 Codex hands context management to the model as tools (VERIFIED, raw source)

Two tools with no analogue anywhere else I looked:

```rust
name: "get_context_remaining"
description: "Get the remaining tokens in the current context window."
output_schema: { "tokens_left": integer | null }
```
```rust
name: "new_context"
description: "Start a new context window. Does not clear, reset, or otherwise affect environment state."
```

The model can *ask* how much context is left and *decide* to start a fresh window. Compare Anthropic's **task budgets** (VERIFIED): a token ceiling for an agentic loop where "The server injects a countdown marker Claude sees during generation" — advisory, model-visible, minimum 20,000 — explicitly contrasted with `max_tokens`, "an enforced per-response ceiling the model is not aware of".

And a countervailing warning from the same corpus, worth quoting because it cuts against naive adoption:

> "**Rare: context anxiety.** In very long sessions it can worry about running out of context — suggesting a new session or trimming its own work — **most often when the harness surfaces a remaining-token countdown.** Avoid showing explicit context-budget counts."

So the field is split: Codex exposes the counter as a tool; Anthropic ships a server-side countdown *and* warns against surfacing raw counts. ctrl-b exposes neither — its budget is entirely harness-side (`max_iterations`, per-tool cap, reserve-headroom compaction). The open question is not "should we copy Codex" but "**is the agent's total spend bounded by anything it can perceive?**" — today, no.

### 4.3 Caching-aware capability design (VERIFIED — Anthropic `shared/prompt-caching.md` + `agent-design.md`)

The doctrine ACA §3.8 said ctrl-b already implements, now with the *invalidation hierarchy* spelled out:

| Change | Tools cache | System cache | Messages cache |
|---|---|---|---|
| Tool definitions (add/remove/reorder) | ✗ | ✗ | ✗ |
| Model switch | ✗ | ✗ | ✗ |
| System prompt content | ✓ | ✗ | ✗ |
| `tool_choice`, images, thinking on/off | ✓ | ✓ | ✗ |

Three agent-specific escape hatches Anthropic names explicitly:

| Constraint | Workaround |
|---|---|
| Editing the system prompt mid-session invalidates the cache | Append a `{"role":"system"}` message to `messages[]` instead |
| Switching models mid-session invalidates the cache | "Spawn a **subagent** with the cheaper model for the sub-task; keep the main loop on one model" |
| Adding/removing tools mid-session invalidates the cache | Use tool search — "it appends tool schemas rather than swapping them" |

**This is directly load-bearing for two ctrl-b features.** (a) ACA A4 / D-entry lead-worker routing (Goose-style): the field's answer to "cheap model for part of the work" is *a subagent*, precisely because an in-loop model swap costs the whole cache. (b) Skill-driven `narrow_tools` **changes the tool list mid-thread** — which, by this table, invalidates tools+system+messages. Whether llama.cpp's prefix cache behaves the same way is unverified, but the *shape* of the risk is real and is not recorded anywhere in ctrl-b's docs.

Also: the 20-block cache lookback window ("Each breakpoint walks backward **at most 20 content blocks**… common in agentic loops with many tool_use/tool_result pairs") and the concurrency note ("N parallel requests with identical prefixes all pay full price — none can read what the others are still writing") — the latter applies directly to a subagent fan-out.

---

## 5. Planning & task tracking

Convergence is near-total on the **rewrite-the-whole-list** primitive:

- **Codex `update_plan`** (VERIFIED, raw): "Updates the task plan. Provide an optional explanation and a list of plan items, each with a step and status. **At most one step can be in_progress at a time.**"
- **ctrl-b `task_plan`** (VERIFIED): "the full ordered task list, rewritten in its entirety every call (TodoWrite-style) … **Keep exactly one step `active` while you work it**". Byte-for-byte the same contract, arrived at independently.
- **Claude Code `TodoWrite`** + a *separate* durable task layer (`TaskCreate/Get/List/Update/Output/Stop`) shared across an agent team.
- **Hermes `todo`** — "Manage session task lists for complex multi-step work"; plus a whole **`kanban` toolset (14 tools)** with `kanban_request_review`, `kanban_block`, `kanban_heartbeat`, `kanban_create`, `kanban_link` for multi-agent hand-off.

**The delta is not the plan tool — it is the second tier.** Claude Code and Hermes both grew a *durable, shared, multi-agent* task store above the ephemeral in-context todo list, because a todo list that lives in one context is invisible to a sibling agent. ctrl-b's plan "lives in the message history … reload and the agent's own context both recover it" — correct and elegant for a single-threaded turn, and silently absent for its subagents (children get their own ephemeral threads and cannot see or update the parent's plan).

Also worth noting against pi's objection (ACA §3.13, "todos confuse models"): every system in this pass ships one. The objection has not aged well.

---

## 6. Subagent orchestration

### 6.1 The async/addressable convergence

| | ctrl-b | Codex | OpenClaw | Claude Code |
|---|---|---|---|---|
| Spawn | `spawn_subagents(tasks=[…])`, **blocking** | `spawn_agent` | `sessions_spawn` — "non-blocking; it returns a run id immediately" | `Agent` (foreground or `background: true`) |
| Address a running child | ✗ | `send_input`, `send_message`, `followup_task`, `interrupt_agent`, `resume_agent` | `sessions_send`, `agents_wait` | `SendMessage`, resume by agent id/name |
| Await | implicit (TaskGroup) | `wait_agent` (returns *which* agents have updates; ends early on steered input) | `agents_wait` | implicit / team messages |
| Enumerate | ✗ | `list_agents` | `agents_list` | `ListAgents` |
| Close/reap | ✗ (TaskGroup unwinds) | `close_agent` — "Completed agents remain open and count toward the concurrency limit until closed" | lane + backlog caps | session-scoped |
| Concurrency caps | per-agent 3, global 6, depth 2, 180 s/child | concurrency limit + explicit close | `maxChildrenPerAgent` 5, lane `maxConcurrent` 8, backlog warn 25 / **block at 50** | `CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS=20`, spawn depth 3 |
| Context mode | isolated only | isolated | `isolated` (default) or `fork` | non-fork or **fork** (`/subtask`) |
| Result to parent | one aggregate `ToolResult` | per-agent status + final message | "latest visible `assistant` reply text"; "tool/toolResult output is **not** promoted into child results" | "a single text result … The parent doesn't see the subagent's intermediate tool calls or outputs" |

(Codex rows VERIFIED from raw `multi_agents_spec.rs`; OpenClaw + Claude Code REPORTED.)

**The `fork` mode is the one mechanism ctrl-b lacks that has an immediate cost argument.** Claude Code: forks inherit the full history, same system prompt, same tools, same model — and therefore a **shared prompt cache (cheaper)**; "Tool calls stay isolated; only final result returns". OpenClaw ships the same axis and warns: "Use `fork` sparingly. It is for context-sensitive delegation, not a replacement for writing a clear task prompt." ctrl-b's children always start cold, so every delegation re-prefills a fresh prefix.

### 6.2 What the field says about *when* to delegate — the direction reversed

The most striking prompt-level finding, from Anthropic's Opus 5 migration guidance (VERIFIED), is that the recommended guidance **inverted between model generations**: Opus 4.8 under-reached for subagents and needed "delegate more" prompting; Opus 5 over-reaches and needs a cap. The shipped counter-prompt is worth reading in full as a design statement:

> "Subagents multiply cost and time: each one re-establishes context, re-explores, and reports back, and you then re-read its report. Delegate rarely and only when the payoff clearly exceeds that overhead. … **Do NOT use subagents for:** Work you could finish yourself in a handful of tool calls … **Review, verification, or to double check your work. Verification belongs in your main agent loop.** … If you delegate, commit to the delegation. Never redo the subagent's work … **Never use more than 20 parallel agents unless the user explicitly requests it.**"

And the fan-out instruction that matters for any harness: "If you launch multiple agents for independent work, **send them in a single message with multiple tool uses** so they run concurrently."

ctrl-b's `SpawnInput(tasks=[…])` **already enforces this by shape** — one call *is* the batch — which is a genuinely better ergonomic than "hope the model batches its calls". Keep it; the gap is only that the batch is also the unit of *waiting*.

### 6.3 Isolation invariants worth stealing (REPORTED)

- Claude Code removes an explicit filter-list from every subagent's tool pool: `Agent` (at depth limit), `AskUserQuestion`, `EndConversation`, `Enter/ExitPlanMode`, `ScheduleWakeup`, `TaskOutput`, `WaitForMcpServers`, `Workflow`. ctrl-b's equivalent is depth-checking inside `spawn_subagents` plus the privilege clamp; it does **not** subtract `question` (AWAITING_ANSWER inside a headless child) or the automation tools.
- OpenClaw: "Sub-agents always lose `gateway`, `agents_list`, `session_status`, `cron`, `message`, `sessions_send`"; leaf subagents also lose spawn tools.
- Claude Code, on messages between agents: "A receiver never treats a message from another agent as your consent or approval." ctrl-b's D44 approvals are settings-state, so a child inherits grants it never saw a human make — same class of concern, no equivalent statement recorded.

---

## 7. Autonomy vs approval

### 7.1 Claude Code (VERIFIED, grepped raw `permissions.md`)

- Three-tier default table: read-only within the working directory = no prompt; Bash = prompt "except a built-in set of read-only commands"; file modification = prompt.
- Rule resolution: **"Rules are evaluated in order: deny, then ask, then allow. The first match in that order determines the outcome, and rule specificity doesn't change the order."** And the sharp edge: **"a deny rule can't carry allowlist exceptions"**; a matching ask rule prompts "even when a more specific allow rule also matches".
- Modes: `default`, `acceptEdits`, `plan`, `auto`, `dontAsk`, `bypassPermissions` — with a circuit breaker: even `bypassPermissions` still prompts for root/home `rm -rf`, `ask`-forced connector tools, and MCP tools marked `requiresUserInteraction`.
- The trust statement ctrl-b's SECURITY_MODEL makes in prose, stated as a rule: **"Permission rules are enforced by Claude Code, not by the model. Instructions in your prompt or `CLAUDE.md` shape what Claude tries to do, but they don't change what Claude Code allows."**
- Hooks compose *below* the rules: "Hook decisions don't bypass permission rules… a matching deny rule blocks the call, and a matching ask rule still prompts even when the hook returned `"allow"`." But a hook exiting 2 "stops the tool call before permission rules are evaluated" — so hooks can only ever *tighten*.

### 7.2 The LLM-classifier turn (the finding that most challenges a locked ctrl-b ruling)

- **Claude Code auto mode** — default on Pro/Max/Team plans: "a classifier decides most of these prompts instead of you" (VERIFIED). It is disable-able org-wide via `permissions.disableAutoMode`.
- **OpenClaw `auto`** — "Run allowlist matches; **send misses through auto-review** before falling back to human approval", recommended as the default "for coding agents that need useful host access without making every miss a human prompt" (REPORTED).
- **goose `smart_approve`** — the instance ACA §3.13 rejected in 2026-07 as "redundant with static typed-action risk; an LLM judging its own escalations is a weaker rail than the existing gate".

Two of the three most capable harnesses now ship it *on by default*. The ctrl-b ruling remains defensible on its own terms (typed actions with static risk **are** a stronger rail than a classifier reading a shell string — and that is exactly the asymmetry: a classifier is what you need when the action is an opaque command string, per §2.1). But the ruling's stated reason has become a claim about *ctrl-b's* action shape, not a general truth, and the docs should say so.

### 7.3 Codex (REPORTED, docs) and the two-axis shape

Approval policies `untrusted` / `on-request` (default in version-controlled folders) / `never`, crossed with sandbox modes `read-only` / `workspace-write` (default) / `danger-full-access` — the same *policy × environment* split ACA §3.6 already matched ctrl-b's risk × privilege against. What is new is the **model-initiated escalation path**: Codex ships a `request_permissions` tool (VERIFIED, raw handler) letting the model *ask for* additional sandbox permissions mid-turn, normalising them through `normalize_additional_permissions`. ctrl-b's `question` tool is the human-facing analogue; there is no capability-escalation request path (by design — D8 says the gate decides, not the model).

- **opencode**: allow/deny/ask with input-pattern matching where **"the last matching rule wins"** (REPORTED) — a third resolution philosophy, distinct from both Claude Code's class ordering and ctrl-b's OR-across-rules/allow-only D44 matcher.

---

## 8. Loop, spend, and runaway guards

| System | Mechanism | Confidence |
|---|---|---|
| **ctrl-b** | repeat 2 · per-tool 6 (authoritative spiral bound) · result-signature stall 2 · `max_iterations` 16 → forced tool-less `_finalize` | VERIFIED |
| **Claude Code** | `maxTurns` (per subagent), `maxBudgetUsd`, **WebSearch capped at 200 calls per session counted across subagents**, with the notice-not-error design ("rather than an error that would invite a retry") | VERIFIED |
| **OpenClaw** | rolling-history repeated-pattern + unknown-tool-retry detection; a **post-compaction guard** on identical `(toolName, argsHash, resultHash)` triples, comparing "stable command outcomes (status, exit code, timed-out flag, output)" while filtering volatile metadata (duration, PIDs); warn → block the whole batch → `compaction_loop_persisted` error | REPORTED |
| **Anthropic API** | `task_budget` — advisory, model-visible countdown, min 20,000 tokens | VERIFIED |

Two ideas ctrl-b's four-layer guard does not have:

1. **Volatile-field filtering in the repeat signature.** OpenClaw explicitly *excludes* duration and PIDs before hashing a result. ctrl-b's ACA-12 note already flags that its `result_sig` can false-positive on generic summaries; the mirror-image bug — a *timestamp or duration in the summary defeating the stall guard* — is the same defect from the other side, and OpenClaw's fix is the general one.
2. **A cap counted across the subtree.** Claude Code's WebSearch limit spans "the main conversation and every subagent it spawns, so searches made by parallel research fan-outs count against the same limit". ctrl-b's per-tool cap of 6 is **per session**, so a fan-out of 3 children × 6 = 18 `web_search` calls with no tree-wide bound. (`global_subagent_limit` bounds concurrency, not spend.)

---

## 9. Implications for ctrl-b (short, separate, and mine — not evidence)

Ordered by value/effort. None of these is a recommendation to build; each is an input to the design-review packet.

- **Highest value, lowest risk:** give tool output a *handle*. Even without a filesystem spill, `ToolResult` already has `artifacts: list[Artifact]` and `data: dict` — a truncated `output` plus a `data["output_ref"]` the model can re-read through a bounded tool would close the gap. Pair with head-**and-tail** on `state != OK`.
- **One home for the cap.** Fold `_MAX_OUTPUT_CHARS` (×2) and `ShellCfg.max_output_chars` into one `Settings` field consumed at the `ActionService._execute` chokepoint, so *every* tool including native actions is bounded.
- **The RW-lock re-shape of D40** is a smaller change than it looks (the classifier already computes per-call eligibility; the loop would spawn all calls and gate on `asyncio.Lock`-vs-semaphore rather than partition the batch) — and it removes the "leading prefix" concept entirely, which is a net simplification.
- **Async subagents are a Phase-scale item**, not a slice; but the *cheap* half — a `fork` context mode reusing the parent's prefix — is a cache win with no lifecycle change.
- **Tree-wide spend counters** (per-tool cap and iteration cap shared down the subtree) are a small `Deps`-level change and close a real hole.
- **Do not adopt** the model-visible context counter without the Anthropic caveat; do not adopt Code Mode / PTC at N=24 tools; do not re-litigate LLM-judge approvals — record the ruling's *revised* rationale instead.

---

## 10. What I could not determine

- **Whether llama.cpp's prefix cache follows the Anthropic invalidation hierarchy** (does a mid-thread tool-list change from `narrow_tools` invalidate the whole prefix, or only from the tool block onward?). The doctrine is Anthropic-specific; ctrl-b's local path is unmeasured. *This is the single highest-value unverified claim in this dossier.*
- **Codex's tool-output truncation limits** — I read the parallel gate and the specs, not the output pipeline; a `MODEL_FORMAT_MAX_BYTES`-style constant probably exists but the GitHub code-search API required auth.
- **OpenClaw's numeric loop-detection thresholds** — the doc says "enough times within that window" without a number (REPORTED, explicitly flagged by the reader).
- **Hermes's approval/permission model** — the tools reference lists ~86 tools but I did not read its permission or per-toolset gating docs; whether Hermes has anything like a risk×privilege gate is unknown.
- **goose and aider at HEAD** — deliberately not re-bought; ACA §3 covers goose's modes/`smart_approve`/`select_all` and aider's posture as of 2026-07, and R31 covers aider's benchmark harness. Treat both as one release stale.
- **Whether Claude Code executes independent tool calls concurrently in-process** — the *model-side* contract is documented (parallel by default) and the Anthropic guidance says read-only tools "can be marked parallel-safe", but I found no harness-side statement of the scheduling rule, so ACA §3.5's "read-only concurrent, mutating sequential" attribution to Claude Code remains REPORTED, not re-verified.

---

## 11. The divergence questions (my synthesis — for the design-review packet)

Each phrased as a question, with the evidence pointer. **These are not findings; they are the agenda.**

**Q1 — Output caps: is 6,000 chars, head-only, terminal, and thrice-defined the right contract?**
Field: Claude Code 30,000 valid / 10,000 failure with **head-and-tail** on failures and a file path past the cap; Managed Agents 100,000 chars → file + preview, "No configuration required". ctrl-b: 6,000 head-only, no handle, and only on `run_shell` + MCP + OpenAPI (native actions uncapped). §3.3.

**Q2 — Should truncation ever be terminal?**
Every peer that truncates leaves the model a way back (file path, `head_limit`/`offset`, "narrow the pattern" flag). Does ctrl-b want a bounded `read_output(ref)` affordance, or is "the summary is enough" a deliberate ruling? §3.3.

**Q3 — Parallel dispatch: leading prefix, or readers-writer lock?**
Codex's `RwLock` (read = parallel-safe, write = exclusive) parallelises *any* mixed batch; D40's leading prefix gives `[reboot, ping, ping]` zero parallelism and needs a ≥2 threshold to be worth it at all. Is the prefix restriction protecting anything the lock wouldn't? §3.2.

**Q4 — Is `category == "mcp"` → prefix-ineligible still right?**
Codex trusts `readOnlyHint` for parallelism, with tests for both the hint path and a server opt-in path, on the reasoning that "correctly implemented MCP servers should tolerate parallel calls to tools that advertise themselves as read-only". ctrl-b's stricter stance means an MCP-heavy agent never parallelises. §3.2.

**Q5 — Do we need a dynamic tool-manifest mechanism, or is skill-narrowing the answer?**
Anthropic, Codex, and OpenClaw all ship deferred schemas + a search tool; ctrl-b observed the failure they solve (`minig+` / 21 tools) and shipped *static* skill narrowing instead. Note the cache argument **favours** static narrowing at author time and **penalises** mid-thread narrowing (§4.3). Is `narrow_tools` firing mid-thread today, and what does it cost? §4.1, §4.3.

**Q6 — Does anything the agent can perceive bound its spend?**
Codex ships `get_context_remaining` + `new_context` as *tools*; Anthropic ships a model-visible `task_budget` countdown — and simultaneously warns that surfacing raw counts causes "context anxiety". ctrl-b's bounds (`max_iterations` 16, per-tool 6) are invisible to the model until `_finalize` yanks the toolset. Is a soft, model-visible budget worth the anxiety risk? §4.2.

**Q7 — Are our spiral bounds tree-wide or per-session?**
Claude Code counts WebSearch across "the main conversation and every subagent it spawns". ctrl-b's per-tool cap of 6 is per session, so a 3-child fan-out multiplies it. Should the caps live in `Deps` beside `global_subagent_limit`? §8.

**Q8 — Should the stall guard's `result_sig` filter volatile fields?**
OpenClaw hashes `(toolName, argsHash, resultHash)` after "filtering volatile metadata like duration and PIDs". ACA-12 already flags the false-*positive* direction; this is the false-*negative* direction (a duration in a summary makes an identical outcome look like progress). §8.

**Q9 — Blocking batch vs addressable children: which failure are we accepting?**
3/3 peers ship async spawn + address + interrupt + follow-up (Codex has nine agent tools; OpenClaw "returns a run id immediately"; Claude Code has background subagents + `SendMessage`). ctrl-b's parent cannot steer a child that is going wrong, and one 180 s straggler holds the whole batch. Is that acceptable at fleet scale (3 children max), or is it the seam that will hurt when automations grow? §6.1.

**Q10 — Is a `fork` context mode worth it purely for the cache?**
Claude Code forks share the parent's prompt cache ("cheaper"); OpenClaw ships `fork` with the warning to use it sparingly. ctrl-b children always prefill cold. §6.1.

**Q11 — Should subagents lose a named tool set, the way peers do?**
Claude Code strips 8 named tools from every subagent (incl. `AskUserQuestion`); OpenClaw strips 6+. ctrl-b relies on depth checks + privilege clamp and leaves `question` (a *suspending* tool) reachable in a headless child. What happens when a subagent calls `question`? §6.3.

**Q12 — Does the plan need a tier that outlives one context?**
Claude Code grew `Task{Create,Get,List,Update}` above `TodoWrite`; Hermes grew a 14-tool kanban above `todo` — both because a sibling agent can't see an in-context list. ctrl-b's plan is invisible to its own subagents. Is that a gap or a scope boundary? §5.

**Q13 — Does the ACA §3.13 rejection of LLM-judge approvals still read the same way?**
Claude Code's auto mode (classifier, default on Pro/Max/Team) and OpenClaw's `auto` mode (auto-review before human) both ship it as the recommended default. The ctrl-b ruling stands on typed actions being a stronger rail than a classifier reading a shell string — which is *the same reasoning Anthropic gives for promoting bash to typed tools*. Should the ruling be restated with that rationale rather than "redundant"? §7.2, §2.1.

**Q14 — Is `run_shell`'s off-by-default posture costing the agent capability the field considers baseline?**
Anthropic's rule of thumb is "Start with bash for breadth. Promote to dedicated tools when you need to gate, render, audit, or parallelize" — ctrl-b starts at the other end and keeps bash disabled. That is the right call for a machine-controlling agent; the question is whether the **typed** surface is complete enough that the escape hatch is genuinely unnecessary, or whether "run_shell off" is quietly load-bearing for capability today. §2.1.

**Q15 — One number, three homes: is the cap a config concern or a module constant?**
`ShellCfg.max_output_chars = 6000` + `_MAX_OUTPUT_CHARS = 6000` × 2. Owner directives say tunables live in config and there is one source of truth. §3.3.

---

## 12. Sources

**Primary, read directly (VERIFIED)**
- Anthropic agent-design + tool-use + prompt-caching + migration guidance, as shipped in the `claude-api` skill bundle, 2026-08-16: `shared/agent-design.md`, `shared/tool-use-concepts.md`, `shared/prompt-caching.md`, `shared/model-migration.md` (Opus 5 §), `shared/managed-agents-{core,tools,multiagent,events}.md`.
- Claude Code docs (raw markdown, grepped): `https://code.claude.com/docs/en/tools-reference.md`, `https://code.claude.com/docs/en/permissions.md`.
- `openai/codex` @ `main`, 2026-08-16 — `codex-rs/core/src/tools/{parallel.rs, router.rs, registry.rs}`, `codex-rs/core/src/tools/handlers/{plan_spec.rs, get_context_remaining_spec.rs, new_context_window_spec.rs, request_permissions.rs, tool_search_spec.rs, multi_agents_spec.rs, mcp.rs, view_image.rs}`; handler directory listing via the GitHub contents API.
- ctrl-b @ `cdfd48d` — `backend/app/core/{tool.py,permissions.py}`, `backend/app/services/agent/{session.py,planning.py,subagents.py,skills.py}`, `backend/app/services/actions/`, `backend/app/adapters/{mcp_client.py,openapi_tools.py}`, `backend/app/config.py`, `backend/app/domain/agent.py`.

**Fetched and summarised by a reader model (REPORTED)**
- `https://code.claude.com/docs/en/sub-agents.md`
- `NousResearch/hermes-agent` → `website/docs/reference/tools-reference.md`
- `openclaw/openclaw` → `docs/tools/{index,permission-modes,subagents,code-mode,tokenjuice,loop-detection}.md`, `AGENTS.md`
- `https://learn.chatgpt.com/codex/agent-approvals-security`
- opencode permissions/agents docs (via search result summaries — weakest sourcing in this dossier)

**Deliberately not re-bought:** `docs/AGENT_CHAT_AUDIT.md` §3 (8-agent comparative, 2026-07-07); `docs/research/R30` (peer prompt-system internals); `docs/research/R31` (eval harnesses + the OTel `gen_ai.*` metrics taxonomy — R31 covers efficiency *measurement*, this dossier covers efficiency *design*).
