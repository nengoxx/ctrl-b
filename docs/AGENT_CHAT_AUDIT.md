# Agent Chat Architecture Audit & Improvement Plan (ACA)

> **What this is.** Three things in one document, in order: (§0–2) a deep, code-verified **audit**
> of ctrl-b's agent chat stack; (§3) a **comparative analysis** of how eight reference agents —
> Codex CLI, opencode, Claude Code, pi, Hermes Agent, Gemini CLI, Goose, Cline — solve the same
> problems; (§4–5) an **adoption ledger + execution plan** that merges the audit fixes with the
> best externally-proven ideas. Finding ids are **ACA-#** (defects) and **ACA-A#** (adoption
> ideas); use them in commits and discussion so nothing collides with `UI_AUDIT.md` (F#) or
> `PRE_DEPLOY.md` items.
>
> **Status:** audit verified · comparative research complete (8 agents, 2026-07-07) · consistency
> pass done (v2.1: +ACA-17, cross-slice contract, per-slice edge-case specs) · **plan APPROVED by
> the owner 2026-07-07** — tracked as `TODO.md` **Phase 12**; Slice 0 pre-landed (`ee23209`);
> D-entries (D35–D37) are drafted at each slice's design review, per §5 · DB/context/cache pass
> done (v2.2, 2026-07-08: +ACA-18–21 and the ACA-5/ACA-15 riders, folded into Slices 1/2/6 —
> no new slices, no re-sequencing) · **pre-build re-verification pass done (v2.3, 2026-07-16,
> three-agent code-truth + research refresh): every Slice 1–2 item HOLDS against HEAD; ACA-7
> premise updated; build-time amendments pinned in §5 "v2.3 amendments" — no scope change.**
> **Method:** every load-bearing ctrl-b file read directly by the main session (≈6,400 lines:
> `api/agent.py`, `services/agent/*`, `core/{tool,permissions,memory,events}.py`,
> `action_service.py`, `adapters/{inference,mcp_client,ssh}.py`, `db.py`, `conversation.py`,
> `runtime.py`, `store/chat.ts`, `AgentTab.tsx`, `useAgentChat.ts`, `useEvents.ts`, `lib/plan.ts`).
> External-agent research ran as eight scoped web-research subagents under a "cite or say
> *unknown — not confirmed*" rule; all findings were treated as advisory and cross-checked by the
> main session ([[claude-is-final-judge]]). `sse-starlette` behavior verified against the
> **installed** package source.

---

## 0. False positives (dismissed — do NOT "fix")

Two independent audit agents flagged `except asyncio.TimeoutError, TimeoutError:`
(`action_service.py:162`) and `except OSError, ValueError:` (`memory_backup.py:158`) as
"CRITICAL Python-2 syntax / module cannot import." **Both are PEP 758 unparenthesized `except`,
valid on this repo's Python 3.14 floor.** Verified: both modules compile on the venv's 3.14.4
(`py_compile`, 2026-07-07). Any future tooling that flags these is wrong; the fix would be a
style regression against the repo's declared 3.14 syntax baseline.

**Attribution correction (doc-level, folded into Slice 0):** the memory cap-usage-header and
`§`-entry patterns ctrl-b's docs attribute to "Hermes" are confirmed in the Hermes Agent docs
verbatim, but the *lineage* is **MemGPT (arXiv 2310.08560) → Letta memory blocks**; Hermes is the
implementation style, not the originator. Same for "ephemeral tail layers": Hermes names the tiers
(`stable → context → volatile`), but the underlying rule is general prompt-cache practice
(Anthropic prompt-caching docs). Cite accordingly.

---

## 1. What is architecturally sound (verified — preserve these)

These patterns were checked and are correct; future slices must not regress them. The comparative
research (§3) additionally shows several are **at or ahead of the field** — marked ⭐.

| Area | What's right | Where |
|---|---|---|
| Execution chokepoint | The agent loop's capabilities (builtin/action/MCP/OpenAPI/terminal) all flow registry → `decide()` → `ActionService.invoke` → Event audit; `!` exec reuses it (at FULL). **Approve-to-apply is a SEPARATE authorized path** (C3-M1): `POST /api/agent/apply` → `proposals.apply_proposal` re-runs only the tool's own `gate_*`/`apply_*` (every rail except the auto-write switch) — it does NOT go through `decide()`/`ActionService.invoke`; the owner's Approve *click* is the authorization, standing in for the confirm gate — then audits the write (and now gate-denials/failed applies) as a USER Event. | `core/tool.py`, `action_service.py`, `api/agent.py` (`apply_proposal_endpoint`), `proposals.py` |
| Prompt-cache discipline ⭐ | Static head (system+appends+memory+roster+skills) built once per turn, byte-stable across iterations; tools list cached; ephemeral reflection nudge appended at the tail, one-shot. Matches Codex/Claude-Code stability-layer doctrine (§3.8). Cross-turn determinism also verified in v2.2 (memory-section order, roster projection, registration-order tools, args re-serialization). *One reliance gap: ACA-18.* | `session.py:228‑357, 419‑427` |
| Loop discipline ⭐ | Exact-repeat suppression (cap 2), per-tool cap (6), result-signature stall guard, forced tool-less `_finalize`. Richer than Codex (none confirmed), Claude Code (turn/budget caps only), and pi (none by philosophy); comparable to opencode (threshold 3) and Gemini's tier-1 (threshold 5) — see §3.9. | `session.py:130‑156, 581‑686, 797‑835` |
| Confirm flow | Durable `AWAITING_CONFIRM` + server-side token re-mint (J3) + single-flight `begin_execute` (J2) + `(action,args)`-bound single-use TTL tokens + risk-aware retry (I4). Two-axis risk×privilege gating parallels Codex's sandbox∧approval split (§3.6). | `action_service.py:184‑238`, `session.py:505‑532`, `store/chat.ts:736‑767` |
| Wire robustness | Frame validators both ends; client drops bad frames without failing the turn; unknown events ignored (forward-compatible). `done` already carries a reason state (`completed/suspended/capped/error`) — the "result subtype" pattern Claude Code ships. | `store/chat.ts:279‑354`, `session.py:943‑952` |
| Error normalization | Tool/adapter failures become `ToolResult(ERROR)` fed to the model (`is_error`-style), never exceptions escaping the SSE generator; `InferenceError` → clean `error` event + persisted `ErrorPart`; resume re-validates a stale call. | `action_service.py:167‑168`, `mcp_client.py:229‑248`, `session.py:505‑528, 618‑624` |
| Failover | Stream-initiation-only failover (first-chunk probe), degradation surfaced as `notice`, mid-stream drop = clean error, generic `failover()` primitive reused. | `adapters/inference.py:185‑250`, `core/failover.py` |
| Compaction | Turn-boundary-safe split, rolling summary re-folds prior summaries, truncation fallback, rows never deleted. (§3.7 lists the upgrade package.) | `compaction.py:94‑157` |
| Memory ⭐ | Atomic write, whole read-modify-write-commit under one lock, growth-only cap, unique-`old_text` edits, error-driven consolidation, content-free commits, traversal containment, best-effort git backup. **Feature parity with Hermes Agent confirmed** (§3.11), incl. the no-`read` tool and cap headers. | `services/agent/memory.py`, `memory_backup.py` |
| Subagents | `asyncio.TaskGroup` structured concurrency, privilege clamped to parent, depth + per-agent + global-semaphore bounds, per-child timeout, children never raise, headless confirm→DENY. Isolation model (fresh context, final-message-only return) matches Claude Code's documented design. | `subagents.py` |
| Skills ⭐ | Instructions injected only when a skill is *active* (user-invoked or selector-matched); inactive skills cost zero context. This is Claude Code's progressive-disclosure pattern, already ours. | `services/agent/skills.py`, `session.py:317‑331` |
| Frontend streaming | Per-message `memo`; sliced store subscriptions; ref-stable `resultFor`; plan snapshot with content-signature stability; EventSource reconnect w/ backoff + reconciliation. | `AgentTab.tsx:335‑456`, `store/chat.ts:63‑101`, `useEvents.ts` |

---

## 2. Findings ledger (audit — all CONFIRMED against code)

Severity reflects impact on the goal: *fast and reliable chat across all agent capabilities*.

### ACA-1 · Turn lifetime is coupled to the SSE transport; three docs promise the opposite — **HIGH**

**Evidence.**
- `api/agent.py:5‑7` (module docstring): *"The turn keeps running server-side even if the client
  disconnects mid-stream — the assistant message is persisted regardless."*
- `DESIGN.md` §5.3 (≈365‑371): client "replays from the last event id"; §6 (≈689): *"client
  disconnect → turn persists, resumes on reconnect via Last-Event-ID"*; §12 (≈624‑628): *"Every
  event carries a monotonic `id:`"*; ≈590‑591: *"each turn/tool runs in an `anyio.CancelScope`;
  client disconnect or a `POST /threads/{id}/cancel` cancels cleanly, persisting a `cancelled`
  marker."*
- **Reality:** `_turn_response.gen()` (`api/agent.py:200‑205`) emits only `event`+`data` — no
  `id:` is ever sent; there is no `/cancel` endpoint, no `cancelled` marker, no replay. The
  installed `sse-starlette` runs `_listen_for_disconnect` in a task group and **cancels the body
  generator on `http.disconnect`** (verified in package source). Cancellation propagates through
  `_counted` into `run_turn` at its current await.
- The frontend already knows: `store/chat.ts:716‑734` (`retryLastTurn`): *"Phase B (server-side
  Last-Event-Id) would close that gap but is not in this slice."*
- The seam was even reserved: `api/events.py:4‑7`: *"The same EventBus powers the agent chat
  stream later."*

**Failure scenarios (all real on the mobile-first PWA):**
1. **Mid-model-call disconnect** (Android backgrounds the app / screen off / tailnet flake): the
   in-flight iteration is lost — the assistant message is persisted only *after* the stream loop
   (`session.py:641/654`); the F20 retry re-runs from scratch.
2. **Mid-`_run_calls` disconnect — executed-but-unrecorded mutation.** Step persistence happens at
   the END of the step (`session.py:935‑939`). Cancellation while a later call in the batch is
   awaited loses the *already-completed* results of that step: the tool ran, its Event is in the
   audit log, but no `tool` message exists — next turn `_assemble` synthesizes `skipped: "not
   executed"` (`session.py:403`) and the model is told a restart/shutdown didn't happen when it did.
3. **No stop affordance (inverse gap).** No cancel button, no `AbortController` in
   `store/chat.ts`, no cancel endpoint. The only way to abort a runaway turn is to kill the
   connection — i.e. the only cancel mechanism *is* failure mode 1.
4. Asymmetry: **buffered turns (D17 `stream:false`) DO survive disconnects** — the guarantee
   exists on exactly the transport the PWA doesn't use.

**External corroboration (§3.1):** every server-shaped reference agent decouples generation from
the connection — opencode's `prompt_async` returns 204 and "sessions survive terminal disconnects";
Claude Code web sessions "continue running in the background" after tab close; Codex's core is
built to outlive any UI via SQ/EQ. **Resolution:** Slice 3 + Slice 0 (doc truth, immediately).

### ACA-2 · No per-thread turn serialization — DESIGN §6 "queued" is unimplemented — **MED**

No per-thread lock/queue exists anywhere (`session.py`, `api/agent.py` — grep-verified;
`active_turns` is a gauge; the frontend `status==="streaming"` guard is per-client only). Phone +
desktop posting to the same thread interleave two `_drive` loops over the same history.
**External corroboration (§3.4):** the field answers this with a *steering queue* (Codex
`turn/steer`, Claude Code queue-then-inject, pi `pendingMessages`, Goose `pending_steers`, Gemini
Tab-queue); only opencode rejects with `BusyError`. **Resolution:** Slice 2 (per-thread turn
marker + 409 interim, covering ALL thread-mutating endpoints — see the plan-edit/apply/compact
races in Slice 2's spec) → Slice 5 (steering queue, ACA-A1) upgrades the 409 into the
field-standard behavior for messages.

### ACA-3 · MCP session handshake has no deadline; stdio can hang a turn indefinitely — **MED-HIGH when stdio MCP is configured, else LOW**

`mcp_client.py`: only the operation is bounded (`wait_for` on `call_tool`/`list_tools`,
:193/:235‑237). The `async with self._session(server)` entry — `await session.initialize()`
(:167 HTTP, :180 stdio) — is outside every timeout; streamable HTTP is incidentally covered by the
httpx client timeout (:163), **stdio has nothing**. MCP `ToolSpec`s set no `timeout_s`
(:204‑216) so `ActionService._execute` applies no outer bound (`action_service.py:151‑161`). The
same unbounded entry sits in `discover()`, which runs at startup **and at the turn boundary** via
`rediscover_integrations` (`api/agent.py:239‑240`).
**Rider ACA-3b:** `connect_timeout_s` doubles as the *call* budget (:236) — a legitimately slow
crawl is killed at the connect budget. **Resolution:** Slice 1.

### ACA-4 · Tool calls execute serially and results are batched until the step ends — **MED (perceived speed)**

`_run_calls` (`session.py:747‑940`) awaits `invoke` per call in a for-loop and accumulates all
`tool.result` events into a list `_drive` yields only after the entire step returns (:662‑664),
while the system prompt *instructs* the model to batch multi-target calls (:72‑75). The docstring's
justification (:762‑763 "Tool execution is fast") predates web_search/crawl/terminal/
`spawn_subagents` (up to 180 s of `// running…`).
**External corroboration (§3.5):** parallel execution of safe calls + per-call result streaming is
the field standard — Codex (`FuturesOrdered` + `ExecCommandOutputDelta`), Claude Code (read-only
concurrent / stateful sequential, keyed on the same MCP `readOnlyHint` annotation ctrl-b already
stores as `ToolSpec.read_only`), pi (`Promise.all` default), Goose (`stream::select_all`).
**Resolution:** Slice 4.

### ACA-5 · Compaction blocks the turn's critical path; the estimator ignores the static head — **LOW-MED**

`_drive` awaits `_compactor.compact(thread)` before **each** model call (`session.py:585`); the
summarizer is a buffered `complete()` (`compaction.py:138‑157`) — dead air before the visible turn
starts. Rider: `estimate_tokens` (`compaction.py:64‑82`) counts history only — static head + tools
schemas are invisible to the fixed `threshold_tokens` (default 6000, `domain/agent.py:43`).
**External corroboration (§3.7):** the field triggers on *reserve headroom against the model's
window* (pi: `window − 16384`; Gemini: 70%; Goose: 80%; Codex: ~90%), not a fixed count.
**v2.2 riders:** (a) the estimator docstring's "slightly conservative (overestimating)" claim is
backwards for tool-heavy history — JSON runs ~3 chars/token, not 4, so it *under*-triggers exactly
when tool traffic dominates; (b) `messages.tokens` (`domain/conversation.py:87`, "for compaction
budgeting (4e)") is written `NULL` everywhere and only round-tripped — a dead column. Slice 6
should either populate it (persist per-message estimates so `estimate_tokens` stops re-walking the
full history every iteration) or drop the comment's claim.
**Resolution:** Slice 4 (notice) + Slice 6 (compaction v2, ACA-A3 — absorbs both riders).

### ACA-6 · Latent `TypeError` in the timeout normalizer — **LOW (latent)**

`action_service.py:162‑166`: the timeout arm formats `{timeout:.0f}` but `timeout` is `None`
whenever the spec sets no `timeout_s` — and the arm also catches a `TimeoutError` raised *inside*
the tool (`socket.timeout` **is** `TimeoutError` since 3.10). A `TypeError` inside an except
handler escapes `_execute` un-normalized. Currently unreachable (`ssh.py:67` catches `OSError`;
MCP self-normalizes; `run_capture` returns `timed_out`), but the handler exists precisely to catch
escapes. **Resolution:** Slice 1.

### ACA-7 · The per-tool deadline seam is barely used; SSH DNS is unbounded — **LOW-MED**

*(Premise re-verified 2026-07-16: the original "no `@action`/`@tool` passes `timeout_s`" is now
stale — `dns_trace.py:53` (20 s) and `yt_captions.py:84` (60 s) declare `ToolSpec.timeout_s`, so
the `ActionService` `wait_for` seam is live for those two. The gap below still holds for every
fleet action.)* No **fleet/SSH-backed** action declares a bound — their only protection is
adapter-internal (paramiko `timeout=10` covers TCP connect + channel reads but **not
`getaddrinfo`**; httpx timeouts; `run_capture` timeouts). One adapter gap (ACA-3) already slipped
through this implicit policy.
**Resolution:** Slice 1 (backstop `timeout_s` on SSH-backed fleet actions + MCP/OpenAPI specs;
policy: every registered tool declares its bound or documents which adapter bound covers it).

### ACA-8 · Hardcoded tunables in the chat path — **LOW (owner directive violation)**

`_CHILD_TIMEOUT_S = 180.0` (`subagents.py:51`); `KeywordSkillSelector()` built bare
(`main.py:168` — `min_overlap=1, max_skills=2` defaults, `skills.py:113`) while the *agent*
selector's threshold is config-driven (`auto_rotate_min_overlap`, `config.py:221`). The asymmetry
is the bug. **Resolution:** Slice 1.

### ACA-9 · Orphaned confirm token after a resume re-mint — **LOW (accepted-risk candidate)**

The original token minted at suspend stays valid ≤120 s after `resume(execute)` re-mints
(`session.py:521`, `action_service.py:108‑112, 235‑238`), `(action,args)`-bound, redeemable via
`/api/actions`. Not a double-execute in the agent flow. **Resolution:** Slice 1
(consume-or-comment).

### ACA-10 · `/clear` mid-stream leaks the live turn into the fresh view — **LOW**

`lib/composer.ts` case `"clear"` → `startNewThread()` unconditionally (`store/chat.ts:180‑183`, no
status check). The still-open stream keeps reducing: a later `message.start` **appends a fresh
assistant bubble into the cleared view** (`chat.ts:395`). **Resolution:** Slice 2 (guard;
trivially subsumed by Slice 3's turn ids).

### ACA-11 · Buffered mode (D17) drops `notice` breadcrumbs — **LOW**

`collect_turn` (`session.py:105‑127`) folds only `message.*`, `tool.permission`, `tool.question`,
`error`, `done`. A buffered client never learns the turn failed over (D18 `notice`).
**Resolution:** Slice 4 rider.

### ACA-12 · Stall-guard result signature can false-positive on generic summaries — **LOW (fragility)**

`result_sig = state|summary|output[:300]` (`session.py:154‑156`); two *different* calls returning
identical text count as "no progress" → premature `_finalize`. Safe today (summaries embed
host/service ids); fragile if a future tool returns generic summaries. **Resolution:** Slice 1
(include the call sig in the progress key, or document the invariant on `ToolResult.summary`).

### ACA-13 · Malformed tool-call JSON is erased to `{}`, weakening model self-correction — **LOW**

`_parse_args` (`session.py:943‑952`): a malformed blob becomes `{}` → the model is steered by
"field required" errors instead of "your arguments JSON was malformed: &lt;raw&gt;". Weak local models
repair JSON better than they guess schemas (Hermes 4 is explicitly trained to repair malformed
JSON — give it the material). **Resolution:** Slice 1.

### ACA-14 · Frontend per-token work is O(messages) — **INFO (watch, don't fix yet)**

`appendDelta` rebuilds the array per token (`chat.ts:200‑217`); `useAgentChat`'s `useMemo` is
keyed on `messages` so `pairResults` re-pairs per token (`useAgentChat.ts:54‑55` — the comment
overstates the memo). Render cost is contained by `Bubbles` memo. Fine at homelab thread lengths;
owning item is the deferred F13 wave.

### ACA-15 · Memory subsystem riders — **INFO/LOW**

(a) Conf `overwrite` deliberately uncapped (`memory.py:261‑274`) + whole-file injection each turn;
mitigated by the >100 % header + consolidation nudge. (b) Startup `reconcile()` commits dirty
files serially inside lifespan (`main.py:193`) — slow only after mass external edits.
(c) `load_context` sync reads ≤3 small files once per turn — negligible. (d) Embeddings client is
a wired-but-unconsumed seam (by design, ROADMAP B1). (e — v2.2) the `_static_prefix` docstring's
"a mid-turn `memory`-tool write now lands next turn" (`session.py:341‑344`) doesn't hold across a
confirm/question suspend: resume constructs a **new** `AgentSession` (`api/agent.py:711`), which
re-reads the memory files into the resumed half's head — the write surfaces mid-turn after all,
and the prefix diverges from the pre-suspend one (cache re-prefill from the memory block onward).
Behaviourally harmless; the docstring is what's wrong. The full answer is A9's per-session freeze
(§6 Q5). **Resolution:** document (a); fix the (e) docstring in Slice 1's doc sweep; defer the rest.

### ACA-16 · Resume doesn't carry the per-message `mode` — **INFO (documented)**

`session.py:556‑559` owns this. Cheap to carry in `ResumeRequest` like `privilege`; Slice 2.

### ACA-17 · Auto-rediscovery is not gated on `active_turns` — mid-turn registry rebuild race — **LOW-MED (found in the v2.1 consistency pass)**

The **manual** `POST /integrations/rediscover` correctly refuses while a turn is iterating
(`api/integrations.py:97‑98`: `active_turns > 0` → 409, "the registry is never mutated under a
live loop"). But the **auto** path has no such check: `POST /agent/chat` calls
`rediscover_integrations` whenever `integrations_dirty` is set (`api/agent.py:239‑240`) — with no
`active_turns` guard. Two threads can run turns concurrently today (ACA-2), so: owner edits an MCP
server while thread A is mid-turn → thread B's next chat request rebuilds the registry
(`remove_category("mcp")` + re-`discover` + `apply_tool_overrides` mutating specs in place,
`runtime.py:147‑182`) **under A's live loop**. A's `_tools_cache` (already-rendered dicts) keeps
the model's view consistent, but A's next `registry.get(cp.tool)` can now raise `UnknownTool`
(→ spurious DENIED result for a tool that was valid when the model called it), and
`apply_tool_overrides` mutates spec objects A may still be reading. Degradation is graceful (no
crash — the `UnknownTool` handler catches it) but wrong, and the "only ever between turns"
invariant documented in `runtime.py:151‑153` and `main.py:148‑150` is not actually enforced on
this path. **Gets worse under Slice 3** (turns run detached, so "some turn is active" becomes more
common). **Resolution:** Slice 2 (the busy-marker makes the check trivial: skip auto-rediscovery
when any turn is active — it re-fires at the next quiet turn boundary; the dirty flag persists).

### ACA-18 · The prompt-cache design relies on llama.cpp `cache_prompt` but never sends it; zero cache observability — **LOW-MED (found in the v2.2 DB/context pass)**

The whole §3.8 discipline banks on the local KV cache — `session.py:223` credits "`cache_prompt`"
by name — but the inference adapter never sends the parameter (grep-verified: no
`extra_body`/`cache_prompt` anywhere in `adapters/inference.py`). Current llama-server builds
default it to `true` ([server README](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md)),
but older builds defaulted `false` — on one of those, the carefully engineered stable prefix buys
*nothing, silently*. And there is no way to notice: no cache-hit telemetry exists on the main loop
(Slice 7's "cache-hit telemetry" verify line covers routing churn only). **Caveat for the fix:**
the pin must be **per-endpoint** — OpenAI's API rejects unrecognized request arguments (400), so a
blanket `extra_body` would break the cloud chain. The voice adapter already owns the exact pattern
to reuse: a config-driven `extra_body` passthrough merged into the SDK call
(`adapters/voice.py:104‑109`, `VoiceCfg.extra_body`). **Resolution:** Slice 1 — `extra_body` field
on `InferenceEndpointCfg` (same convention), `cache_prompt: true` in the local endpoint's config
template, plus debug-level cache telemetry where the endpoint reports it (llama.cpp `timings`
fields; cloud `usage.prompt_tokens_details.cached_tokens` via `stream_options: {include_usage}` —
exact surfaces verified at build). Pairs naturally with the A8 measurement rider: together they
turn "should be caching" into "provably caching".

### ACA-19 · Multi-statement write sequences aren't transactional — compaction can persist half-applied — **LOW**

`Database.execute` commits per statement (`db.py:168‑173`); the write lock serializes statements,
not sequences. Compaction does `add(summary)` then N separate `update(m)` flag flips
(`compaction.py:119‑123`): a crash mid-sequence leaves the summary inserted with part of the head
still un-flipped — the next assembled context contains **both** the summary and some of the
verbatim turns it summarizes. Not corrupting (rows are never lost; the model just reads
duplicates), and the same window in `_run_calls`' `update(assistant)` + `add(tool_msg)` pair
already degrades gracefully (the synthesized-`skipped` path — though note it synthesizes "not
executed" for calls whose persisted state says OK). **Resolution:** Slice 2 (turn integrity) — a
`Database.transaction()` async context manager batching statements under the existing write lock
(`BEGIN`…`COMMIT`, one commit); the compactor's summary+flip sequence and the plan/apply
read-modify-write pairs adopt it. Complements, not replaces, Slice 2's shielded-`finally`
persistence (that solves *cancellation*; this solves *atomicity*).

### ACA-20 · Message ordering has no tiebreaker — a `ts` collision can invalidate the assembled context — **LOW**

`MessageRepo.list` orders by `ts` alone (`conversation.py:132`). Messages within a step are
created microseconds apart, and the compaction boundary is *manufactured* at `tail[0].ts − 1 µs`
(`compaction.py:117`) — a collision makes relative order **undefined**, and the worst case (an
assistant `tool_calls` message sorting after its `tool` results) breaks the assembled OpenAI
context and jitters the cache prefix. Unlikely, but the fix is free. **Resolution:** Slice 1 —
`ORDER BY ts, rowid` (insertion order is the natural tiebreaker; applies to `list` and any future
ts-ordered reads).

### ACA-21 · `_finalize` drops the toolset — the forced wrap-up call re-prefills the entire context — **LOW**

The forced final answer calls `stream_chat(…, tools=None)` (`session.py:721`). Tools sit at the
**top** of the prompt-cache hierarchy (the chat template renders a different preamble without
them — the exact churn the `_tools_cache` docstring warns about at `session.py:303‑316`), so the
one call designed to cheaply wrap up a long turn is the single largest avoidable cache miss in the
loop: full re-prefill of system+memory+roster+history. **Resolution:** Slice 1 — send the same
cached `self._tools()` list with `tool_choice: "none"` (equally binding server-side, prefix
intact). Verify at build that llama.cpp honors `tool_choice: "none"` for the target template;
if a server chokes, fall back to today's `tools=None` per-endpoint.

---

## 3. Comparative analysis — how the reference agents solve it

Eight agents researched (2026-07-07), each against the same questionnaire, "cite or mark
unconfirmed" rule. Full source packs in §7. Summary matrix, then per-dimension synthesis with
ctrl-b's position.

| Dimension | Codex CLI | opencode | Claude Code | pi | Goose | Gemini CLI | ctrl-b today |
|---|---|---|---|---|---|---|---|
| Loop owner | core (SQ/EQ) | server session | harness (CLI local / web VM) | in-process lib | Agent struct | in-process | **SSE response generator (ACA-1)** |
| Survives disconnect | core outlives UI | ✅ (204 + replay) | web ✅ / CLI transcript | transcript | token-cancel | transcript | ❌ streaming / ✅ buffered |
| Resume/replay | rollout JSONL replay | SQLite `seq` log + replay | JSONL append + `--resume` | tree JSONL fork | SQLite resume/fork | chat files + `/restore` | reload persisted msgs only |
| Cancel | `Op::Interrupt` | `/abort` + orphan-marking | Esc | Esc (restores queue) | `CancellationToken`/iter | Ctrl-C | **none** |
| Steering | ✅ `turn/steer` | ❌ `BusyError` | ✅ queue-then-inject | ✅ first-class | ✅ `pending_steers` | ✅ Tab-queue | **none** |
| Parallel tools | ✅ `FuturesOrdered` | ✅ regular / Task serial | ✅ read-only conc. | ✅ default | ✅ `select_all` | partial | ❌ serial + batched |
| Per-call result stream | ✅ Begin/Delta/End | ✅ part updates | ✅ per-tool | ✅ events | ✅ as-they-arrive | ✅ output stream | ❌ end-of-step |
| Approvals | policy × sandbox | allow/ask/deny + Always | deny&gt;ask&gt;allow + modes + hooks | none (container) | modes + LLM judge | modes + PolicyEngine | risk × privilege + confirm |
| Compaction trigger | ~90% window, 2-trigger | usable-limit reserve | clear-tools-then-summarize | window − 16384 | 80% | 70%, keep 30% | **fixed 6000 tokens** |
| Loop guards | none confirmed | doom=3 + maxSteps | maxTurns/budget | none (philosophy) | max 1000 turns | 3-tier detector | repeat 2 / tool 6 / stall 2 + finalize |
| Iteration cap UX | token-bounded | `MAX_STEPS_PROMPT` | result subtype | model-driven | `MAX_TURNS_MESSAGE` | nudge inject | forced `_finalize` ✅ |

### 3.1 Turn ownership & disconnect survival → **unanimous: decouple**

Every agent that has a server shape decouples generation from the connection: opencode's
`prompt_async` returns `204` while the loop runs on ("sessions survive terminal disconnects, SSH
drops, machine sleeps"); Claude Code web sessions keep running after tab close; Codex's core is
explicitly transport-agnostic (SQ/EQ over channels/IPC/TCP). CLI-shaped agents (pi, Gemini,
Claude Code CLI) decouple *differently* — durable transcripts + resume. ctrl-b is server-shaped
(FastAPI + PWA), so ACA-1's Slice-3 direction is the unanimous field answer, not a preference.

### 3.2 Resume & replay → **append-only event log with app-level cursors; snapshot for cold joins**

Three independent implementations converge on the same mechanics ctrl-b planned: opencode persists
every bus event with a monotonic `seq` to SQLite, drops `seq ≤ current` client-side, and replays
the gap (and notably **doesn't trust browser `Last-Event-ID`** — replay is app-driven); Codex
replays rollout lines to *reconstruct the model's state* and appends to the same file; OpenAI
background mode resumes by `sequence_number` cursor. LibreChat (v1.1 research) adds the cold-join
answer: one **snapshot/sync event** carrying the rebuilt prefix when the cursor is stale. pi's
tree-structured JSONL (`id`/`parentId` per entry) is the elegant extra: compaction becomes a
*derived overlay* over an untouched log — which ctrl-b's `compacted` flag already approximates
(rows never deleted ⭐).

### 3.3 Cancel → **explicit, idempotent, with orphan-marking**

Codex `Op::Interrupt` (kills the task, *not* background processes); opencode `/abort` marks
in-flight tools `interrupted: true` and **filters orphaned tool blocks out of the next prefill**
(`isOrphanedInterruptedTool`) — exactly the context-validity problem ctrl-b's `_assemble` already
solves for abandoned confirms with synthesized `skipped` results; a `cancelled` marker slots into
the same seam. Goose checks a `CancellationToken` **each loop iteration** — the "flag checked
between steps" half of honest cancel (research dossier: cancellation only lands at awaits).

### 3.4 Steering → **5-of-6 ship queue-then-inject; it subsumes the 409**

Codex `turn/steer`/`thread/inject_items` (append to the in-flight turn, don't abort running
tools); Claude Code: "type a correction… Claude reads it as soon as the current action completes"
(injected at the tool-result boundary); pi: `pendingMessages` injected before the next assistant
response, Esc restores the queue to the editor; Goose: `pending_steers` drained mid-conversation;
Gemini: Tab queues the next prompt. Only opencode throws `BusyError` — and mid-turn injection is
an open feature request there. **Consequence for ctrl-b:** ACA-2's fix is a per-thread turn lock
*plus a steer queue drained at the top of each `_drive` iteration* — the lock is a prerequisite
(one loop per thread to inject into), the 409 is the interim UX, the queue is the destination
(ACA-A1).

### 3.5 Parallel tool execution & result streaming → **annotation-driven concurrency is the standard**

Claude Code's documented rule is the cleanest: *read-only tools run concurrently, state-mutating
tools run sequentially*, keyed on the **same MCP `readOnlyHint` annotation ctrl-b already stores**
(`ToolSpec.read_only/idempotent`, adopted for retry-safety I4). Codex runs independent calls under
`FuturesOrdered` (results ordered, execution concurrent) and streams `ExecCommandOutputDelta` per
call; Goose merges result streams with `select_all` and consumes them as they arrive; pi defaults
to `Promise.all` with a per-tool `sequential` override. ctrl-b needs no new metadata — only the
executor change (ACA-4/Slice 4). Cline's one-call-per-message is the deliberate outlier (VS Code
review-loop UX), not a counterexample for a fleet agent.

### 3.6 Approvals → **ctrl-b's two-axis gate is validated; the gap is persistence and patterns**

Codex separates *what the OS permits* (sandbox) from *when to ask* (approval policy) — ctrl-b's
risk × privilege split is the same shape minus the OS sandbox (deliberate: typed actions ARE the
boundary; containerization is a deploy concern, `SECURITY_MODEL.md`). The features the field has
that ctrl-b lacks: **persisted "always allow"** (opencode's Once/Always rows in SQLite; Gemini's
`PolicyEngine.updatePolicy`; Claude Code's "don't ask again" → settings allow-rule) and
**pattern rules** (`Bash(git diff *)`, last-match-wins wildcards). Goose's `smart_approve` LLM
risk judge is interesting but redundant with typed-action static risk. → ACA-A5, aligned with the
ROADMAP privilege-levels seam (D16/A1).

### 3.7 Compaction → **a consistent upgrade package emerges**

Six agents, one composite recipe: (1) **trigger on reserve headroom against the model window**,
not a fixed count — pi `window − reserveTokens(16384)`, Gemini 70%, Goose 80%, Codex ~90%,
opencode `window − 32k output − 20k buffer`; (2) **clear stale tool results before paying for a
summary** — Claude Code's two-tier microcompaction (re-fetchable outputs → placeholders, zero
inference); (3) **keep the recent tail verbatim, measured in tokens** — Codex ~20k of user
messages, pi 20k, Gemini newest 30%, opencode last 2 turns; (4) **structured summary template with
never-prune classes** — opencode's Goal/Constraints/Progress/Decisions/Next-Steps + "Rules &
Constraints" section, skill outputs never pruned; (5) **anti-thrash guard** — Claude Code stops
auto-compacting after a few failed attempts instead of looping; (6) **steerable** — `/compact
&lt;instructions&gt;` (Codex/Claude/pi). Cline adds the cost trick: summarize *on top of the existing
prompt cache* so compaction costs mostly output tokens. ctrl-b's Compactor already has the safe
turn-boundary split and rolling summary; the rest is ACA-A3 (Slice 6).

### 3.8 Prompt-cache discipline → **ctrl-b already implements the doctrine**

Codex (byte-stable prefix, deterministically sorted tool catalogs, session cache key), Claude Code
(stability layers + documented invalidators + deliberately deferring CLAUDE.md edits to next
session), Hermes (`stable → context → volatile`, memory snapshot **frozen per session** to protect
the KV cache) all describe what `_static_prefix`/`_tools_cache` already do. Two refinements worth
noting: Hermes's per-*session* memory freeze is stronger than ctrl-b's per-*turn* read (ACA-A9,
optional knob — UX trade-off: edits surface next thread); and Codex normalizes prompt fingerprints
(whitespace) so semantically-identical prompts still hit cache — not needed at ctrl-b's scale.
**v2.2 caveat:** the discipline is correctly *engineered* but currently *unverified in
production* — the llama.cpp parameter it depends on is never actually sent and nothing measures
hit rates (ACA-18); `_finalize` also defeats it once per capped turn (ACA-21). Both are Slice-1
one-liners.

### 3.9 Loop discipline → **ctrl-b is at or ahead of the field**

Gemini CLI has the most elaborate detector (3 tiers: SHA-256 identical-call hash at threshold 5 →
50-char content-chanting detector → LLM check only after 30 turns); opencode has doom=3 + a
step-cap wrap-up prompt; Goose a 1000-turn cap; Claude Code only `maxTurns`/`maxBudgetUsd`; Codex
nothing confirmed; pi refuses caps philosophically ("the loop just loops until the agent says it's
done" — viable with frontier models, not with `minig+`). ctrl-b's four-layer guard (repeat 2,
per-tool 6, result-sig stall 2, forced tool-less `_finalize`) already covers tiers 1–2; the only
idea worth stealing is the *tiering philosophy* (cheap checks always, expensive checks rarely) and
possibly Gemini's content-chant detector if narration loops ever appear — backlog, not a slice.

### 3.10 Retry & model routing → **make retries visible; route models by phase, not just failure**

pi splits the retry **classifier** from the retry **policy** (`isRetryableAssistantError` — 429/
5xx/overloaded/premature-end retryable, quota/billing not) and does **provider-portable context
transforms** (foreign thinking blocks → tagged text) so mid-conversation model handoff works —
directly relevant to ctrl-b's local↔cloud failover chain. Claude Code retries 10× and **emits each
retry as a typed wire event** (`system/api_retry`: attempt, delay, error category) — the client
renders progress instead of a dead spinner; ctrl-b's D18 `notice` is the embryo of this. Gemini
falls back Pro→Flash on persistent 429. **Goose's lead/worker split is the standout for ctrl-b**:
strong model for the first N planning turns → cheap/local worker → fall back to the lead after a
failure threshold (`GOOSE_LEAD_*`). ctrl-b's per-`AgentDef` `ModelRef` + failover chain are
exactly the seams this drops into (ACA-A4).

### 3.11 Memory → **parity with Hermes confirmed; progressive load is the growth seam**

Hermes Agent is ctrl-b's memory design, independently verified: MEMORY.md/USER.md split caps
(2,200/1,375 chars), `§` entries, `[67% — 1,474/2,200]` headers, consolidate-at-80% guidance,
**error-driven consolidation** on over-cap writes (= our `MemoryCapError`), no-`read` tool,
write-approval gating (= our `auto_write` propose flow), SOUL.md persona slot, SQLite FTS
archival (= our `session_search`). Two deltas: Hermes freezes the injected snapshot per session
(ACA-A9); and Claude Code's auto-memory loads **only a 200-line/25KB index** with topic files read
on demand — irrelevant at ctrl-b's current 2.2KB cap, but it is the named seam if caps ever grow
(ROADMAP B1 note, not a slice).

### 3.12 Context economy → **pi's warning maps onto ctrl-b's own live finding**

pi keeps prompt+tools under ~1,000 tokens and argues large manifests confuse models (Playwright
MCP: 21 tools = 13.7k tokens); Claude Code defers MCP tool *schemas* until needed (ToolSearch) and
loads skill bodies only on invocation. ctrl-b **observed this empirically** — the HANDOFF records
that `minig+` "isn't too weak, the 21-tool namespaced set confused it," which is why the `fleet`
intent-skill narrows the toolset. Adoption: measure and budget the manifest (ACA-A8); the heavier
"deferred tool schemas" mechanism is backlog until measurement demands it.

### 3.13 What the field does that we deliberately WON'T adopt

- **Dropping the confirm gate (pi).** pi's "permission popups are security theater" holds for a
  code-editing agent in a container; ctrl-b's actions **shut down real machines**. The typed-action
  risk×privilege gate is the product, not scaffolding. (pi's own docs concede the boundary belongs
  to the environment — ours is the gate + tailnet.)
- **Dropping task_plan/subagents (pi).** pi's objections (todos confuse models; subagents are
  black boxes) are noted; ctrl-b's plan panel is an owner-facing UI feature with clickable state,
  and subagents are bounded + audited. Keep, with pi as the reminder not to grow them.
- **OS sandboxing in-app (Codex/Claude/Gemini).** Wrong layer for a homelab control panel whose
  purpose is touching the host; the emma deploy + tailnet + gate is the boundary
  (`SECURITY_MODEL.md`). Containerizing the *backend* is a deploy-time option, not chat
  architecture.
- **LLM-judge approvals (Goose `smart_approve`).** Redundant with static typed-action risk; an
  LLM judging its own escalations is a weaker rail than the existing gate.
- **Unbounded loops (pi) / no guards (Codex).** `minig+` needs the guards; keep them.

---

## 4. Adoption ledger (ACA-A#)

| Id | Idea (source) | Verdict | Lands in |
|---|---|---|---|
| **A1** | Steering queue: per-thread pending messages drained at each `_drive` step boundary; Esc/stop restores queue to composer (Codex, Claude Code, pi, Goose, Gemini) | **ADOPT** | Slice 5 (needs Slice 3's turn registry; Slice 2's lock is the prerequisite) |
| **A2** | Annotation-driven parallel tool execution (`read_only`/`idempotent` concurrent, mutating serial, suspend-on-first-CONFIRM preserved) + per-call result streaming (Claude Code rule; Codex/Goose/pi mechanics) | **ADOPT** | Slice 4 |
| **A3** | Compaction v2 package: reserve-headroom trigger vs model window · tool-result-clearing tier before summarizing · keep-recent-**tokens** floor · structured never-prune template · anti-thrash guard · `/compact &lt;instructions&gt;` (composite: all six agents, §3.7) | **ADOPT** | Slice 6 |
| **A4** | Lead/worker model routing: cloud model for first N planning turns → local worker → fallback to lead on failure threshold (Goose) | **ADOPT (design-review first)** — fits `AgentDef.ModelRef`+failover seams; new D-entry | Slice 7 |
| **A5** | Persisted "always allow" approvals + pattern rules on the confirm gate (opencode Once/Always, Gemini PolicyEngine, Claude Code allow-rules) | **ADAPT** into the ROADMAP privilege-levels seam (D16/A1) — a new `approvals` store, gate-checked before `decide()` | Slice 8 |
| **A6** | Wire-visible retries: typed `retry`/failover events with attempt + category (Claude Code `api_retry`); `done` reason subtypes (already have ⭐) | **ADOPT (small)** | Slice 7 |
| **A7** | Retry classifier/policy split + provider-portable context transforms (thinking-block normalization) for clean mid-thread local↔cloud handoff (pi) | **ADAPT** — classifier explicit in `core/failover` policy; transforms only when a reasoning local model lands | Slice 7 (classifier) / backlog (transforms) |
| **A8** | Context-economy budget: measure tools+head token cost per agent (log it), keep manifests lean, skills-as-docs bias (pi; Claude Code deferred schemas) | **ADOPT (measure first)** | Slice 1 rider (measurement) → backlog (deferred schemas) |
| **A9** | Per-session memory-snapshot freeze knob (Hermes) — stronger cache stance, edits surface next thread | **DEFER (owner call)** — per-turn read is already head-stable within a turn | §6 question |
| **A10** | Hard reasoning budget for local thinking models (Hermes 4 `&lt;/think&gt;` cap) | **EXPLORE** — depends on llama.cpp control surface | backlog |
| **A11** | Cancelled-turn context hygiene: mark in-flight calls `cancelled`, filter/synthesize like abandoned confirms (opencode `isOrphanedInterruptedTool`) | **ADOPT** — extends the existing `_assemble` synthesized-result seam | Slice 3 |
| **A12** | Event-log-as-truth framing: compaction stays a derived overlay over the untouched message log (pi tree-JSONL model) — **already ctrl-b's design** (`compacted` flag, rows never deleted) | **KEEP (no work)** — cite as validation | — |

Rejected (with reasoning): confirm-gate removal, task_plan/subagent removal, in-app OS sandbox,
LLM-judge approvals, unbounded loops — §3.13.

---

## 5. Execution plan

Sequencing: **truth → hangs → integrity → durable turns → speed → steering → compaction v2 →
routing → approvals.** Slices 0–2 are small and safe pre-deploy; Slice 3 is the first post-deploy
architecture wave; 4–8 follow it (4 and 5 reshape the same event flow as 3 — doing them first
would rewrite the seam twice, [[fix-in-the-owning-phase]]). Every slice ends with the standard
audit gate (`python tools/check.py` + targeted pytest) and a pause for owner review
([[pause-between-phases-for-review]]). New DECISIONS entries are drafted at each slice's design
review, not retroactively.

**Cross-slice contract (v2.1)** — the rules that keep the slices from stepping on each other:
- **One seam, one owner.** `_run_calls` internals are touched exactly twice, deliberately:
  Slice 2 adds only the shielded-`finally` persistence wrapper (no structural change); Slice 4
  does the one structural refactor (per-call persistence + streaming + parallel dispatch). Slice 3
  wraps *around* `_drive` (who iterates it) and does not edit its body except the A11
  cancelled-marker.
- **The busy state has one shape across slices.** Slice 2 introduces a per-thread **turn marker**
  (`dict[thread_id, TurnHandle]` on `app.state`) — deliberately a registry entry, *not* an
  `asyncio.Lock` held across a response generator — precisely so Slice 3's `TurnRegistry` extends
  the same object (adds task/ring/seq to the value) instead of replacing a lock with a registry.
  Slice 5's steer queue hangs off the same entry.
- **The message log stays append-only truth (A12).** No slice rewrites persisted message content
  for context-management purposes: compaction flips `compacted` flags + adds summary rows
  (existing), and Slice 6's tool-result clearing is an **assembly-time transform only** (see
  Slice 6). The only in-place `messages.update` writers remain the call-state/plan/apply flows
  that already exist — and those are serialized by the turn marker (Slice 2).
- **Suspension semantics are invariant.** Every slice preserves: first CONFIRM/AWAITING_ANSWER in
  model order suspends the step; calls after it stay PENDING; `_assemble` synthesizes results for
  unresolved calls (`skipped`, and after Slice 3 `cancelled`) so the OpenAI context is always
  valid.

### Slice 0 — Doc truth (no behavior change) · S — ✅ PRE-LANDED 2026-07-07 (owner-approved ahead of the plan review; commit on `main`)
- `api/agent.py:5‑7`: rewrite the disconnect claim to actual semantics (streaming turn cancelled
  on disconnect; completed steps persist; buffered mode survives).
- `DESIGN.md` §5.3/§6/§12/§10-cancel: mark Last-Event-ID replay, `/cancel`, per-turn CancelScope,
  and "parallel messages → queued" as **target design (this doc's Slices 2/3/5)**.
- `session.py:762‑763`: fix the stale "tool execution is fast" comment.
- Memory-pattern lineage note (MemGPT/Letta → Hermes style) where docs say "Hermes-style" (§0).
- **Verify:** doc-only diff; grep for other repeats of the false claims.

**v2.3 amendments (2026-07-16, pre-build re-verification — code-truth vs HEAD `ece1080` + research
refresh; these BIND the Slice 1–2 builds):**
- **S1-1 (MCP deadline):** the stdio-cleanup hang is largely solved **in-SDK** — python-sdk
  ≥ v1.11.0 bounds child termination (graceful → 2 s → kill; installed: **1.28.1** ✓). The live
  remaining risk is the **cancel-during-handshake `RuntimeError`** ("attempted to exit cancel scope
  in a different task", open SDK issue class #521/#922/#1213): the test matrix MUST cover
  cancel-mid-`initialize`, and the outer deadline budgets the +2 s cleanup. Field note: per-call
  timeout conventions are split on progress-extension (Claude Code = flat wall-clock; opencode =
  progress resets it) — our flat `call_timeout_s` (None → `connect_timeout_s`) is the Claude-Code
  shape, correct default.
- **S1-9 (cache pin):** the reuse target is **`VoiceServiceCfg.extra_body`** (`config.py:342`),
  not `VoiceCfg`; `InferenceEndpointCfg` has **no `extra="allow"`**, so declare the field
  explicitly; inject **inside the per-endpoint failover closure** (`attempt(entry)` has `ep`),
  never the shared `kwargs` (OpenAI 400s on unknown args). Telemetry caveat: OpenAI
  `cached_tokens` is **0 below 1024 prompt tokens** — log line must not read as a cache failure.
  llama.cpp `cache_prompt` confirmed current (default true); fields `timings.prompt_n`/`cache_n`,
  streaming `prompt_progress{total,cache,processed,time_ms}` (needs `return_progress`).
- **S1-11 (wrap-up):** `tool_choice:"none"` is **UNDOCUMENTED for llama.cpp** (documented: auto /
  any / named) and doubly template-sensitive (`--jinja`) — the build-time A/B probe + per-endpoint
  `tools=None` fallback is mandatory, not optional.
- **S2-3 (shielded persistence):** installed anyio **4.14.1** clears the #642
  shield-shields-siblings bug (fixed post-4.1) — pin `anyio>=4.2` in deps; the shielded `finally`
  must be **yield-free** and re-raise `CancelledError`.
- **S2-5 (transactions):** use **`BEGIN IMMEDIATE`** (write lock at txn start → no mid-txn
  upgrade deadlock) + a non-zero **`busy_timeout`** (opencode's `busy_timeout=0` + WAL died
  silently under concurrency — cautionary precedent).
- **Field-trend confirmations (no action):** queue+steering is now **6-of-6** (opencode joined;
  also stopped decorating steered messages *specifically to preserve prompt cache* — validates
  Slice 5's posture); Claude Code shipped a 3-attempt compaction circuit breaker (validates
  Slice 6's anti-thrash guard).

### Slice 1 — Hang-proofing & hardening batch (ACA-3, 6, 7, 8, 9, 12, 13, 18, 20, 21 + A8 measurement) · M — ✅ EXECUTED 2026-07-16 + ADVERSARIALLY AUDITED (5 build commits + 2 audit-fix commits; full gate incl. e2e 7/7 GREEN on the tip; 298 backend tests [+44]; owner eyeball pending)
**Post-build adversarial audit (2026-07-16):** clause-by-clause spec walk = 12/12 COMPLETE; cross-slice contract COMPLIANT; new tests verified non-vacuous. ONE real find, **MED-1, reproduced + FIXED**: a malformed-args call ordered after a suspending call in the same assistant message was invoked with erased `{}` on resume (the `bad_args` side-channel was memory-only) → fixed by `ToolCallPart.invalid_raw` (additive field; the side-channel is DELETED; suspend→resume regression test added). Accepted with reasons: LOW-2 (cancel-scope classifier can label a genuine SDK task-group bug as TIMEOUT — documented tradeoff), LOW-3 (in-tool TimeoutError under a spec bound would claim the spec duration — latent, unreachable today), LOW-4 (`extra_body` not secret-masked — pre-existing VoiceServiceCfg precedent; SECURITY_MODEL §2.3/§2.4 noted), INFO-5 (stale ADAPTER_BOUNDED entries not test-caught — forward direction is fail-closed), INFO-6/7 (telemetry shape/BaseExceptionGroup — version-dependent, empirically fine on the installed stack). Riders landed with the audit fix: `complete()` (summarizer) gets the per-endpoint `extra_body` merge; SECURITY_MODEL gains the ACA-9 single-liveness row.
**As-built notes (deltas vs the plan text):** item 1 — the anyio cancel-scope RuntimeError is *classified* (message-shape + ExceptionGroup recursion), not blanket-caught, so a genuine RuntimeError still reads ERROR; item 3 — adapter-bounded tools are documented in ONE machine-enforced `ADAPTER_BOUNDED` map in core/tool.py (fail-closed registry-walk test) instead of scattered comments; item 7 — **empty/whitespace args keep the legacy silent-`{}` path** (orchestrator ruling: a legitimate zero-arg call shape; schema errors steer better there) — only garbage JSON/non-object triggers the repair steering; item 6 — ACA-12's call-scoping hands the varied-arg/same-result spiral to the per-tool cap (C1c), accepted + documented; item 11 — `tool_choice:"none"` **live-probed working** on the deployed llama-server (accepted, no parsed calls, prefix retained; textual-leak caveat + `tools=None` escape hatch in the `_finalize` comment); items 8/9 — telemetry rides `StreamReport`; `stream_options`/`return_progress` go through per-endpoint `extra_body`, never blanket. Skill-selector knobs are baked at startup (restart to apply; documented) — making them hot-reloadable is a possible follow-up.
1. **MCP deadline:** one `asyncio.timeout` around the whole `_session` entry + operation, both
   transports, `discover` and `call`; add `call_timeout_s` to `McpServerCfg` (None →
   `connect_timeout_s`). **Cleanup nuance to verify during build:** when the timeout cancels
   inside the `async with`, the context managers' `__aexit__` still runs its awaits *after* the
   scope fired — if the stdio client's exit path waits on the stuck subprocess without its own
   bound, the "timed-out" call can still hang in cleanup. Verify the MCP SDK's stdio `__aexit__`
   terminates the child with a bounded wait; if it doesn't, add a hard outer deadline + explicit
   process kill as the backstop. Test: stub stdio server that never handshakes → clean `TIMEOUT`
   result **within the bound, including cleanup**; `discover` returns the per-server error summary
   instead of hanging startup.
2. **Timeout-normalizer guard:** handle `timeout is None` in the `{timeout:.0f}` format.
3. **Backstop deadlines:** `timeout_s` on SSH-backed fleet actions (covers DNS worst case) and on
   MCP/OpenAPI-registered specs from config. Policy: every registered tool declares its bound or
   documents which adapter bound covers it.
4. **De-hardcode:** `agent.subagent_child_timeout_s` + `agent.skill_min_overlap`/
   `skill_max_active`, mirroring `auto_rotate_min_overlap`'s existing pattern.
5. **Confirm-token hygiene:** consume the original pending token on resume re-mint (owner
   decision 2026-07-16, §6 Q3 — CONSUME; keep `test_confirm_recovery_j3.py` green).
6. **Stall-guard key:** include the call sig in `result_sig` or document the summary invariant.
7. **Arg-parse steering:** on `JSONDecodeError`, synthesize "your tool arguments were not valid
   JSON: &lt;first 200 chars&gt;" instead of `{}`-then-validate.
8. **A8 measurement rider:** log the rendered token estimate of tools+static head per turn (debug
   level) so the context-economy budget is data, not vibes.
9. **Cache pin + telemetry (ACA-18):** `extra_body` passthrough field on `InferenceEndpointCfg`
   (reuse the `VoiceCfg.extra_body` convention — merge into the SDK call, per-endpoint, never
   blanket: OpenAI 400s on unknown args); set `cache_prompt: true` for the local endpoint in the
   config template. Debug-log cache-hit telemetry where the endpoint reports it (llama.cpp
   `timings`; cloud `usage.prompt_tokens_details.cached_tokens` via `stream_options`) — lands next
   to item 8's estimate log so prefix cost and hit rate read as one line.
10. **Message-order tiebreaker (ACA-20):** `ORDER BY ts, rowid` in `MessageRepo.list`.
11. **Wrap-up cache retention (ACA-21):** `_finalize` sends the cached `self._tools()` +
    `tool_choice: "none"` instead of `tools=None`; verify llama.cpp honors it for the target
    template, else keep `tools=None` as the per-endpoint fallback.
12. **Doc sweep rider:** fix the `_static_prefix` "lands next turn" docstring (ACA-15e — a
    suspend/resume re-reads memory mid-turn).
- **Verify:** unit tests per item; live probe: kill a stdio MCP server mid-handshake while
  chatting; cache probe: two consecutive turns on the local model show a near-full prefix hit in
  the new telemetry (and the wrap-up call after a forced stall no longer re-prefills from zero).

**v2.4 amendments (2026-07-17, Slice 2 design review — code-truth vs HEAD `3638ac5` + a four-agent
source-level field pass over opencode/Goose/Codex/pi/Hermes/Gemini/Claude Code; design LOCKED as
D38; these BIND the Slice 2 build):**
- **S2-A (endpoint truth):** the spec's six thread-mutating endpoints are complete at HEAD — no
  destructive thread routes exist (no delete/clear server-side; `/clear` is a frontend-only reset).
  The reserve/release point for BOTH SSE and buffered transports is **`_turn_response._counted`'s
  `finally`** (`api/agent.py:189-197`), not `collect_turn` (no state access).
- **S2-B (busy-truth):** `active_turns` **excludes resume turns** (`count=False`, agent.py:714) —
  it cannot gate ACA-17. The marker registry is the single busy-truth; BOTH rediscover checks
  (auto rider + the manual endpoint, integrations.py:97) read `app.state.turns`; the int gauge
  stays as telemetry. Handler order stays rediscover→reserve (reserve-first self-blocks the gate);
  the residual window is accepted (serialized by `discovery_lock`, "skip + re-fire" posture).
- **S2-C (ACA-10 delta):** `startNewThread` (chat.ts:178-183) no longer splices a live bubble —
  the work item reduces to the missing streaming guard. And the client swallows 409 details
  (`streamTurn` renders "url → 409"; `isLikelyUnreachable` matches 5xx only) — the sys-note
  behavior needs an explicit 409 branch reading `detail`.
- **S2-D (ACA-16 seam):** the spec's session.py:556-559 pointer is stale; `mode` mirrors the
  `ResumeRequest.privilege` endpoint-field pattern (agent.py:114/711) + a new `mode` param on
  `session.resume` → `_drive` (which already accepts it; `run_turn` already threads it).
- **S2-E (anyio):** 4.14.1 installed (≥4.2, #642 cleared) but **transitive-only** — the build adds
  the explicit `anyio>=4.2` pin alongside the first direct import.
- **S2-F (field findings, 2026-07-17):** busy state as a per-session **registry entry holding the
  run/cancel handle** is the server consensus (Goose `active_prompt_runs{run_id, cancel_token}`,
  opencode `runners` state-machine map; Codex `Option<ActiveTurn>`) — `TurnHandle` gains a
  `turn_id` now (Goose's `run_id`: log correlation + Slice 5's optimistic-concurrency hook).
  Reject-vs-queue on busy: pi/Goose reject (Goose's error is *actionable* — adopted for our 409
  detail), opencode/Codex/Gemini/Hermes queue-or-steer — validating 409-interim → Slice 5 queue
  (Gemini itself walked reject→queue). Cancel persistence: opencode `Effect.ensuring` finalizer +
  Hermes repair-then-persist = the shielded-finally shape; **Claude Code #3003** (persisted
  `tool_use`, missing `tool_result` → corrupted session) is the do-nothing failure mode. Storage:
  Hermes + Goose both run **BEGIN IMMEDIATE + WAL + non-zero busy_timeout** (Goose transacts its
  INSERT+UPDATE pair like our `_run_calls` tail wrapper); opencode ships `busy_timeout=5000`
  today (its `=0` incident stands as the S2-5 precedent). **Correction to §3:** "only opencode
  rejects with `BusyError`" conflated prompts with destructive ops — opencode *queues/attaches*
  a second prompt (DB re-read at step boundaries) and reserves `BusyError` for
  deleteMessage/revert/shell; its summarize folds into the turn; Codex's `/compact` aborts-and-
  replaces the turn.

### Slice 2 — Turn integrity (ACA-2 interim, 10, 16, 17, 19 + ACA-1 scenario 2) · M — ✅ EXECUTED 2026-07-17 + ADVERSARIALLY AUDITED (design LOCKED same day: D38 + the v2.4 amendments above; 4 Opus build waves + 1 audit-fix commit, per-wave hand-review + full-gate; owner eyeball pending)
**As-built (commits `868cf8a` [D38 lock] → `afb5e22` W1 · `e228089` W2 · `26a0bdb` W3 · `dfd42d2` W4 ·
`1d2c002` audit fixes; backend 324 tests, FE store 25; full gate 6/6 per wave).** W1
`Database.transaction()`: BEGIN IMMEDIATE CM + contextvar join in `execute()` + nested→RuntimeError +
`busy_timeout=5000` + the SYS-1 docstring rider; adopters = compaction/plan/apply/exec/`_run_calls`
tail; compaction-crash test. W2 turn registry: `turns.py` (`TurnHandle{turn_id,thread_id,kind,
started_at}`, sync no-await `reserve`, identity-guarded `release`), 409 on all six endpoints via one
`_reserve_turn`, ownership→`_counted` finally (SSE+buffered), busy-truth switch (both rediscovery
gates read the registry; `active_turns` = telemetry). W3 shielded-finally: the tail moved INTO
`finally` under `anyio.CancelScope(shield=True)` (sync entry, no checkpoint gap → BEGIN always paired
with COMMIT); `anyio>=4.2` declared; the cancel test is level-triggered (asyncio `task.cancel()` is
edge-triggered and passes even unshielded — documented) + shield=False verified to fail. W4:
`ResumeRequest.mode` → `session.resume(mode=)` → all THREE `_drive` sites (answer included — build
completion over the 2-site brief); shared `_coerce_mode`; client `busyDetail()` 409 sys-note+idle
(never a retryable bubble), `/clear`+plan+proposal streaming guards (store-guard-only, the
established pattern), module-level `turnMode` stash. **Post-build fresh-eyes audit: NO HIGH/MED;
spec walk + cross-slice contract CLEAN.** Fixed same day (`1d2c002`): LOW-3 shielded rollback
(double-cancel can't abandon an open BEGIN) · LOW-2 spawn-inside-txn contextvar warning · LOW-4
`query()` cross-task uncommitted-read note · INFO-5 apply-409 comment (busy vs no-pending-proposal).
Accepted with reasons: marker has no TTL/admin-clear (release rides the pre-existing proven
`_counted` finally; Slice 3's task handle adds real recovery) · `_coerce_mode` before-validator
leniency (intended) · post-reload `turnMode` resets to default (pre-existing semantics). Recorded
test gaps (opportunistic): SSE-mid-stream-raise release path · cross-task `execute()` lock-wait ·
one-flow suspend→release→resume-reserve. Suspension nuance worth knowing: a SUSPENDED turn (confirm
bubble) ends its stream and releases the marker — a new chat on that thread is allowed by design;
resume re-reserves fresh. **Pre-push 8-angle code review (2026-07-18, 6 Opus finders + verify):
5 fixes landed** — `runShell` 409 branch (the one wave-4 miss: exec-busy read as "backend
unreachable") · streamTurn 409 also drops the rejected user bubble · `modeByCall` per-call mode pin
(ACA-16 held only until the next interleaved send overwrote `turnMode`; keyed+cleaned like
`confirmTokens`) · finally exception-masking hardening (a DB failure during cancel unwind no longer
replaces the in-flight `CancelledError`; comment now also states the subagent path's edge-triggered
premise) · **`test_turn_guard_invariant.py`** (route-derived, fail-closed both ways — endpoint #7
can't mutate a thread unguarded). Recorded, not fixed: `PUT /settings` tool-override mutation is a
third ungated registry-mutation path (PRE-EXISTING — SYS-3's finding; the turns gate is its natural
close, ride a future slice) · `active_turns` is write-only (no telemetry consumer) — Slice 3 should
expose it or delete it.
1. **Per-thread turn marker** (`dict[thread_id, TurnHandle]` on `app.state` — see the cross-slice
   contract: a registry entry, not a held lock, so Slice 3 extends it in place). Semantics:
   - **Reserve synchronously** in the endpoint handler (no `await` between check and set — atomic
     under the single-threaded loop), *before* returning the response; release in the
     generator's/`collect_turn`'s `finally`. Reserving only when the stream starts being consumed
     would leave a TOCTOU window (`EventSourceResponse` begins iterating after the handler
     returns).
   - **Scope: every thread-mutating endpoint**, not just chat/resume. The audit pass found three
     more racers: `POST /agent/plan` and `POST /agent/apply` do read-modify-write
     `messages.update` on rows the live loop also updates (a mid-turn plan-dot tap can clobber the
     loop's call-state write on the same row, or be clobbered by it), and `POST /agent/compact`
     runs a read-modify-write compaction that can race the loop's own `_compactor.compact`
     (double summary insertion — the DB write lock serializes single statements, not these
     sequences). All three → 409 with a friendly detail while the thread's turn is live.
     `POST /exec` also mutates the thread; give it the same guard (revisit at Slice 5 — a mid-turn
     `!cmd` is arguably steering).
   - **Buffered (D17) turns hold the marker too** (reserve in handler, release when
     `collect_turn` finishes).
   - Client: 409 → sys note "// a turn is already running on this thread". Explicitly the interim
     that Slice 5's steer queue upgrades for *messages*; the 409 stays permanent for plan/apply/
     compact/second-stream collisions.
2. **ACA-17 gating rider:** the chat endpoint's auto-`rediscover_integrations` runs only when **no
   turn marker is held on any thread** (mirror the manual endpoint's `active_turns` check); when
   busy, skip — `integrations_dirty` persists and re-fires at the next quiet turn boundary.
3. **Step-persistence on cancellation:** wrap `_run_calls`' body in `try/finally` where the
   `finally` persists whatever accumulated (`messages.update(assistant)` + the partial
   `result_parts` tool message) inside `anyio.CancelScope(shield=True)` — valid here because
   Starlette runs handlers/streams under anyio task groups; do NOT use bare `asyncio.shield` (the
   detached-task leak from the v1.1 research). This closes ACA-1 scenario 2 for *completed* calls
   even when cancellation lands mid-batch: a shielded `finally` runs on `CancelledError`, persists
   call #1's result while call #2 was the one cancelled. Per-call persistence (the fuller fix) is
   deliberately deferred to Slice 4's structural refactor — one seam, one owner.
4. **Frontend guards:** block `/clear` while streaming (ACA-10); gate plan-dot taps
   (`editPlan`) and proposal approve/dismiss (`applyProposal`) on `status !== "streaming"` so the
   UI doesn't offer what the server will 409 (server check remains authoritative); carry `mode` in
   `ResumeRequest` (ACA-16 — `resume()` gains a `mode` param threaded to `_drive`).
5. **Transactional write batches (ACA-19):** a `Database.transaction()` async context manager
   (`BEGIN`…`COMMIT` under the existing write lock, one commit per batch); adopters: the
   compactor's summary-insert+flag-flip sequence, and the `/agent/plan` + `/agent/apply` in-place
   update pairs. Orthogonal to item 3 (shielding covers cancellation; this covers atomicity) and
   to the cross-slice contract (no `_run_calls` structural change — its `update`+`add` pair may
   adopt the CM as a wrapper without reshaping the seam).
- **Verify:** two-client concurrent-post pytest (chat×chat, chat×plan-edit, chat×compact);
  simulated-cancel test asserting completed calls' tool message survives while the in-flight
  call's does not; rediscovery-skipped-while-busy test; a compaction-crash test (raise between
  summary insert and flag flips inside the transaction → neither persists).

**v2.5 amendments (2026-07-18, Slice 3 design review — code-truth vs HEAD `24015e5` + a five-source
field pass [opencode event-planes + #19023/#20097 · LibreChat GenerationJobManager · Codex live
re-attach/interrupt-stale-turns · OpenAI background-mode cursor + idempotent cancel · Goose/pi/
Hermes/Claude Code absence findings] + an adversarial design review [4 HIGHs, all resolved into the
design]; LOCKED as **D39** — the "D35 proposed" below was stale numbering; these BIND the build):**
- **S3-A (re-attach reframed):** snapshot-primary, not cursor-primary — the field consensus is
  snapshot-then-atomic-subscribe (LibreChat `sync`, Codex history+subscribe); seq-cursor gap-fill
  only exists over a full server event log (OpenAI). The ring's tail-replay survives as the cheap
  brief-drop path; the registry-layer event-fold ACCUMULATOR makes snapshots complete without
  `_drive` edits.
- **S3-B (registry stays live-only; adversarial H1):** finished turns move to a capped terminal
  CACHE — lingering them in `app.state.turns` would poison every truthiness busy-read (ACA-17
  gates, `max_active_turns`). turns.py's reserve/release contract survives verbatim.
- **S3-C (cancel discipline; adversarial H2/H3):** exactly-one `task.cancel()` ever (`cancelling`
  flag; a second raw cancel pierces the anyio shield → the dangling-BEGIN hole); endpoint =
  cancel→await-task→status, writes NOTHING; stale-call marking runs inside the turn task's
  CancelledError path while the marker is held. New raw-task single+double-cancel tests are
  mandatory (the Slice-2 shield test's anyio-scope shape does not cover this).
- **S3-D (client; adversarial H4/M3/M4):** one total-order seq entry gate in the reducer; pinned
  re-attach sequence forced-reload → replace-semantics overlay → live; cold-load probes
  `GET /turns/{id}` and re-attaches (the mobile app-kill headline case); snapshot carries `mode`
  → modeByCall re-pin.
- **S3-E (A11 + reconciler):** `RunState.CANCELLED` end-to-end; `_assemble` synthesis keyed
  STRICTLY on persisted CANCELLED; shared `reconcile_stale_calls` (boot, best-effort + the task
  cancel path) — opencode #19023 is the do-nothing failure mode, Codex interrupt-stale-turns the
  precedent.
- **S3-F (riders):** chat SSE ping/`send_timeout` (none exist at HEAD); lifespan drain under
  `shutdown_grace_s`; CPython #116720 re-assert in subagents.py; config
  `agent.turns.{ring_size, subscriber_queue_size, linger_s, ping_s, send_timeout_s,
  shutdown_grace_s, max_active_turns}`; **`active_turns` DELETED** (D38 amended — write-only);
  buffered D17 = subscriber (cancellable for free; re-attach documented degraded); accepted
  losses: transient notice/compaction sys-notes.

### Slice 3 — Durable turns (ACA-1 + A11) · L — **flagship** — ✅ EXECUTED 2026-07-18 + ADVERSARIALLY AUDITED (design LOCKED same day: D39 + the v2.5 amendments above; 4 Opus build waves + 1 audit-fix commit, per-wave hand-review + full gate)
**As-built (commits `0cb9e09` [D39 lock] → `fc500ef` W1 · `622f258` W2 · `5a135aa` W3 · `d7ea3a7` W4 ·
`b7b4ca6` audit fixes; backend 354 tests, FE store 31; full gate 6/6 per wave).** W1 A11:
`RunState.CANCELLED` end-to-end (enum → `_RESOLVED` → `_assemble` synthesis keyed STRICTLY on the
persisted state → FE type/`RUN_STATES`/CSS/label) + `reconcile_stale_calls` (the `json_each` narrow
scan; best-effort boot crash-recovery — no per-message txn: `update()` is one atomic statement).
W2 the core inversion: `drain_turn` task owns the loop (attach-then-spawn zero-gap; per event
synchronously seq→ring→fold→fan-out; overflow DETACHES the subscriber); `TurnAccumulator` (delta
lists, ephemeral permission/question payloads, mode); terminal_status-before-sentinel on every exit;
shielded CancelledError reconcile WHILE the marker is held; `cancel_turn` single-cancel latch;
`TurnsCfg` knobs; chat SSE's first ping/send_timeout; `active_turns` DELETED; `max_active_turns`
counted BY KIND at reserve time (orchestrator hardening — task-spawn lag would under-count). W3:
status probe + re-attach stream (ring tail-replay iff `cursor.seq >= ring[0][0]-1`, else ONE
`turn.sync`; shared `_sse_frame`/`_stream_live` framing; non-live → JSON `{active:false,
terminal_status}`) + write-nothing idempotent cancel endpoint + capped linger-swept terminal cache
(populated at the done-callback) + lifespan drain BEFORE `db.close()` + the CPython #116720
re-assert (researched, cited). W4 client: `parseSSE` id: support; ONE total-order seq gate at the
reducer entry; `reattachTurn` (forced `reloadChat(true)` → REPLACE-semantics overlay → live);
interrupt re-attaches before `failStream`; cold-load probe (the app-kill case); `stopTurn` + the
Stop button on vapor AND all three kit layouts (orchestrator completion — the brief mis-scoped Stop
to vapor). **Post-build fresh-eyes audit: NO HIGH; server core clause-clean.** Fixed same day
(`b7b4ca6`): MED-1 LineComposer hid send/Stop in the STT resting state exactly while streaming ·
MED-2 a turn that COMPLETED during the drop rendered a false "connection interrupted" retry trap —
the JSON `active:false` branch now force-reloads + settles (regression test) · INFO-5 release-first
cleanup ordering (a terminal-cache raise can't leak the marker). Accepted with reasons: INFO-3
cancel response on a slow drain settles via the attached stream · INFO-4 the seq gate is a module
global (single-active-thread SPA; per-turn isolation = the seam if a second concurrent stream ever
exists) · INFO-6 a cancel racing a dispatched `done` could stamp "cancelled" (unreachable in
practice) · INFO-7 `shutdown_grace_s` assumes uvicorn's graceful timeout ≥ its value (ops note;
uvicorn defaults unbounded). Recorded gaps (opportunistic): re-attach during an active suspend ·
turn.sync-with-pending-confirm through resume e2e · the buffered client path post-inversion.
Process note: wave 4's first commit briefly carried a broken FE typecheck — a `| tail` pipe
swallowed the gate's exit code; caught immediately, amended clean; gates now run under `pipefail`.
**Pre-push 6-finder code review (2026-07-18, `aa83acf`): 8 verified fixes** — STRONG: the
done-but-unreleased window wedged re-attach (both turn endpoints now treat `terminal_status≠None`
as not-live) · buffered queue UNBOUNDED (lossless contract restored) · single release owner
post-spawn · `_stream_live`/`_consume` seq-continuity guard (a `_force_put` terminal eviction
can't settle a gapped stream — breaks unsettled → re-attach/reload recovery) · JSON re-attach
surfaces capped/error terminal states · turn.sync overlay batched to ONE `set()` ·
`terminal_cache_cap` → TurnsCfg · ring default single-sourced. Accepted/recorded: `_consume` vs
`_stream_live` near-dup (different yield types; collapse if Slice 4 touches teardown) · the
`_force_put` idiom echo of EventBus (deliberately different policies) · cache-first vs
handle-first `turn_id` in a double-window edge (client reloads regardless) · cold reload of a
non-live suspended confirm still loses ephemeral tokens (pre-existing; Slice 3 strictly improves
the live case). Backend 356 tests, FE 31; tip gate 7/7 incl. e2e.
**FINAL TRI-REVIEW (owner-ordered, 2026-07-18, `5175756`): Codex CLI (gpt-5.6-sol, read-only) as a
foreign second opinion + two fresh Opus lenses (fix-round regression review + a 9-scenario
end-to-end walk, all PASS). Codex found 2 HIGHs three same-family rounds missed:** the reconciler
flipped a suspended message's PENDING SIBLINGS (resume would skip them forever — now message-level
suspend exclusion; the two tests that ENCODED the buggy behavior were restructured) · the
generic-exception drain path left ambiguous PENDING calls reading "not executed" (duplicate-action
risk — now the same shielded reconcile; effect-unknown semantics). Plus 4 MED (Stop spinner reload ·
sync-kind markers read as live → immortal re-attach streams · leading-edge eviction baselined past
the continuity guard · the cold probe racing a user stream) and 2 LOW (JSON version-skew trusted ·
`ping_s` int truncation). Opus rounds added: thrown-read-error re-attach (the clean-EOF branch
alone missed TCP resets) · events-reconnect live-turn probe (`reconcileChat`) · the inert JSON
error terminal now renders via `failStream` · the snapshot `capped` note + a TURN-state-vs-RunState
narrowing bug TS exposed en route (`completed`/`capped` never settled on the snapshot path).
Accepted/recorded: turn mode is lost across a full app relaunch for a pre-crash suspend (mode isn't
persisted on the call — future seam) · lingering cosmetic `status:"error"` after a restart reload ·
the one-tick probe-vs-reserve divergence (documented in code). Backend 365 tests, FE 33; tip gate
7/7 incl. e2e. **Lesson pinned: a foreign-model reviewer catches what same-family rounds
normalize — keep Codex in the pre-push loop for structural slices.**
Pattern: *resumable streams* — server-owned turn task + replayable per-turn event log; the SSE
response is a subscriber. Grounded in §3.1–3.3 and the v1.1 research (LibreChat in-memory mode is
the single-process reference; OpenAI `sequence_number` cursor semantics; opencode's SQLite seq
log). Design sketch (confirmed refinements in **bold**):
- **TurnRegistry** on `app.state`: `{thread_id → ActiveTurn}` = task (strong-ref +
  `add_done_callback` cleanup), per-turn monotonic `seq`, bounded replay ring, subscriber queues
  (EventBus pattern, per-turn, no shedding), **explicit `terminal_status` stored, never inferred;
  terminal sentinel always emitted from `finally`**.
- **Event ids** `turn_id:seq`; reconnect: same-turn cursor → tail-replay; stale/absent → **one
  snapshot event** (rebuilt prefix), then live. **Snapshot fallback is mandatory** (ring eviction
  safety). App-level cursor, not browser `Last-Event-ID` semantics (opencode+LibreChat lesson).
- **Endpoints:** chat attaches a subscriber; `GET /api/agent/turns/{thread_id}/stream` re-attaches;
  `POST /api/agent/turns/{thread_id}/cancel` — **idempotent**; cancel = `task.cancel()` **plus a
  between-steps flag** (no mid-token promise); `send_timeout` drops frozen readers without
  touching the turn; ping ≈15 s for Tailscale Serve.
- **Cancellation correctness:** terminal persistence in `anyio.CancelScope(shield=True)` inside
  `finally`, `CancelledError` re-raised; re-assert cancellation after the subagent TaskGroup
  (CPython #116720); `shutdown_grace_period` &lt; uvicorn graceful timeout; lifespan drains the
  registry. **A11:** in-flight calls marked `cancelled` and synthesized in `_assemble` like
  abandoned confirms.
- **Client:** track last `seq`; on interrupt, re-attach (replay/snapshot) before falling back to
  `retryLastTurn`; reducer gains a highest-seq guard (already idempotent by `messageId`/`callId`);
  **Stop button** in the composer. D17 buffered mode collapses into a subscriber (`collect_turn`).
- **Reuse:** `AgentEvent` stays the wire unit; `_drive` untouched except who iterates it (+ the
  A11 marker); per-step SQLite persistence (Slice 2) is the durable floor — the ring is a cache,
  never the only copy. The registry **extends the Slice-2 turn marker in place** (same
  `thread_id` key; the marker's value grows task/seq/ring/subscribers) — one busy-state object
  across both slices.
- **Edge cases specified (v2.1):**
  - **Concurrency cap.** Detached turns remove the natural "one turn per connected client" bound —
    N threads could run N loops against the local model simultaneously. Add
    `agent.max_active_turns` (small default, e.g. 2); at the cap, a new chat 409s with a clear
    message. (The subagent global semaphore bounds fan-out *within* a turn, not turns themselves.)
  - **Cancel vs suspended.** A confirm/question suspension **ends the turn task**
    (`done(suspended)`) — there is nothing to cancel. `POST …/cancel` on a thread with no active
    turn returns the terminal state idempotently (OpenAI semantics); the pending bubble is
    resolved by the existing execute/dismiss path, not by cancel. The Stop button renders only
    while a turn task is live (streaming), never on a suspended bubble.
  - **Shutdown drain vs detached turns.** Lifespan shutdown cancels every registry task and awaits
    them (shielded terminal writes inside), bounded to stay under uvicorn's graceful timeout —
    detached turns must not block emma's systemd restart indefinitely.
  - **Unwatched suspension.** A detached turn can suspend on a confirm with no client attached;
    the `tool.permission` event (with token) sits in the ring. Fine short-term (the durable
    AWAITING_CONFIRM + re-mint J3 path already covers a lost token), but the snapshot event must
    include pending permission/question state so a late-joining client renders the bubble.
- **Verify:** e2e — kill client mid-stream, reconnect → full turn present; cancel mid-subagent
  batch → children unwound, `done(cancelled)`, coherent thread; cancel on idle/suspended thread →
  idempotent; snapshot after ring eviction renders a pending confirm; Playwright mobile smoke for
  Stop.

### Slice 4 — Interaction speed (ACA-4, 5-notice, 11 + A2) · M

> **▶ DESIGN LOCKED 2026-07-19 = D40** (full pipeline: code-truth pass [7 sketch contradictions
> pinned] + 7-agent×3-topic source-level field research + 3-lens adversarial design review
> [3H/9M resolved into the decision] + owner go). **The sketch below is superseded where it
> conflicts — D40 deviations:** the parallel prefix is **builtin-authored `read_only` ONLY**
> (NOT "read_only or idempotent" — idempotent ≠ order-independent; MCP/OpenAPI derived flags
> excluded, per-server `parallel_ok` = future seam) · repeat-cap classifies on counts alone
> (`last_results` is completion state) · `ToolSpec.suspending` is a prerequisite with static
> pin + two fail-closed belts (AWAITING_* and `needs_confirm`) · per-completion single-txn
> (tool row + assistant row) via the extracted `_persist_shielded` helper, persist-before-emit ·
> explicit task-list lifecycle (cancel+await+harvest in `finally`) · config
> `AgentDef.max_parallel_tools` + the **llamacpp rider** `InferenceEndpointCfg.
> max_concurrent_requests` (owner constraint: 1–2 non-queuing slots) · §7 debts C1-L5/C2-L6/
> C2-L7 discharged here. As-built record lands on this heading post-build.
>
> **✅ BUILT 2026-07-19 — AS-BUILT RECORD (commits `44bdfdd..62ab584`, 10; ALL LOCAL pending the
> owner's push OK).** Five Opus waves, each hand-reviewed + full-gate-green: **W1 `dbd016b`**
> (ToolSpec.suspending + static AST pin · AgentDef.max_parallel_tools · the llamacpp
> per-endpoint gate w/ stream-lifetime permit + deadlock pins · docstring/SECURITY_MODEL truth) ·
> **W2 `aad3366`** (`_classify_batch`/`_BatchPlan`: overlay-then-commit single-pass classifier,
> builtin-vs-derived discriminator = `category != "mcp"`, 16 property tests incl. shutdown@FULL
> never admitted) · **W3 `63f0398`** (THE structural refactor: `_run_calls` → async generator +
> `_BatchOutcome` holder; `_persist_shielded` extracted verbatim; per-call ONE-txn persistence,
> create-once/update-after tool Message; 24 call sites + both C3-H1 pins adapted shape-only) ·
> **W4 `dd86c33`** (the parallel head: retained tasks + `asyncio.wait(FIRST_COMPLETED)` single
> consumer sharing `result_parts`/`_persist`/`tool_msg`; belts; cancel→gather→harvest finally;
> the audit reference-equality pin [parallel guard state == all-serial run]; serial loop
> byte-identical; `max_parallel_tools==1` skips the classifier) · **W5 `6427ded`** (gated
> "// compacting…" notice via the shared `_over_threshold` predicate · `collect_turn.notices` ·
> `result_sig` full-output hash · `test_subagents_safety` + skills-zero-context).
> **Audit trail:** a MID-BUILD fresh-eyes audit after W3 (sound; its MED-1 prefix↔tail checklist
> became W4's pre-flight) · a POST-BUILD fresh-eyes audit (NO HIGH/MED; 2 of 4 LOWs fixed
> `df5ce7a` — duplicate-call_id batches go whole-serial + the belt fails closed on ANY
> non-`_RESOLVED` state; LOW-2 belt-token-lingers-to-TTL and LOW-3 AST-indirection accepted with
> reasons) · **the Codex tri-review (`gpt-5.6-sol` high, read-only): 1 HIGH the three same-family
> rounds missed — aclose/cancel released the inference permit WITHOUT closing the backend stream
> (an abandoned generation kept the real llama.cpp slot busy while the freed permit admitted a
> second request) → `c961e8d` close-before-release via `_shielded_close` + 2 same-client
> regressions — plus 4 LOW vacuous-passable test gaps → `62ab584` (barrier-exact subagent peaks ·
> the harvest sweep genuinely exercised · incremental streaming pinned fast-lands-while-slow-
> blocked · real notice timing).** Backend 447 tests / FE 40; tip gate 7/7 incl. e2e @ `62ab584`.
> Notable as-built rulings:
> completion-order `tool.result` events are the D40-sanctioned UI behavior (model order lives in
> the persisted parts; FE folds by callId — verified no FE change needed) · the
> `_invoke_error_result` mirror duplicates the serial inline shapes BY DESIGN (serial loop
> byte-identical was the harder invariant; consolidation left to a future simplify pass).

1. Per-call `tool.result` streaming + per-call persistence (`_run_calls` → async generator
   emitting through the Slice-3 log; the one structural refactor of this seam — replaces the
   Slice-2 shielded-`finally` batch persistence with persist-as-each-call-resolves).
2. Bounded parallel execution with **pre-classification**: `decide(spec, privilege)` is pure and
   cheap, so classify the batch *before* executing — the parallel set is the longest prefix of
   calls that are (a) `decide() == ALLOW`, (b) `read_only or idempotent`, and (c) **cannot
   suspend**. Run it under `asyncio.gather` + a small semaphore, emit results as they complete,
   persist in model order; everything from the first non-parallelizable call onward runs serially
   with today's semantics (suspension invariant, cross-slice contract).
   **Edge cases specified (v2.1):**
   - **The `question` tool is read_only but SUSPENDS** (returns `AWAITING_ANSWER`) — condition (c)
     exists because of it. Exclude `question` (and any future tool that can return a suspending
     state) explicitly; two questions gathered concurrently would both try to suspend one turn.
     Mechanism: a `ToolSpec` marker (e.g. `suspending: bool`) or a named exclusion set — decide at
     build, but it must be spec-level, not a name literal in the loop.
   - **`_LoopGuard` bookkeeping stays single-threaded-correct:** increment `counts`/`tool_counts`
     at *dispatch* (before gather), record `last_results`/`seen_results`/`made_progress` at each
     *completion* — all synchronous dict ops on the one event loop, no locking needed, but the
     dispatch/completion split must be explicit so suppression decisions for later calls in the
     same batch see the incremented counts.
   - **Event `Actor` audit rows** are written inside `invoke` per call (unchanged) — completion
     order in the events feed may differ from model order; acceptable, the feed is timestamped.
3. `notice` "compacting…" before the summarizer call; `collect_turn` carries `notices` (ACA-11).
- **Verify:** multi-host ping completes ≈max not Σ; results appear incrementally; a batch of
  [ping, ping, question] runs the pings in parallel and suspends exactly once on the question;
  repeat-suppression still trips inside one parallel batch; compaction notice within 100 ms.

### Slice 5 — Steering queue (A1; upgrades the Slice-2 409 for messages) · M — after Slice 3

> **▶ DESIGN LOCKED 2026-07-19 = D41** (code-truth + 6-system field pass + 2-lens adversarial
> review [5H resolved into the decision] + owner go). **The sketch below is superseded where it
> conflicts — D41 deviations:** turn-end spawn fires on **`completed` terminals ONLY** (the
> sketch's "queued message runs as a new turn while the confirm bubble stays pending" is
> overridden — spawn-on-suspended 409s the owner's own Approve and can double-propose the
> confirm; the queue instead survives suspension and drains at the next turn's loop top) ·
> `SteerEntry` is a UNIFIED submission object carrying mode/agent/privilege/skills · the exec
> gate re-checks at DRAIN (fail-closed) · cancel harvests FIRST, synchronously · the accumulator
> folds steered messages (snapshot-visible) · queue scope = messages+exec only · the Codex
> SQ/EQ note is corrected (its core drains at turn END, not step-boundary). As-built record
> lands here post-build.
Per-thread pending-message queue (a submission type on the turn registry — the SQ half of Codex's
SQ/EQ): composer sends during a live turn enqueue + render as queued bubbles; `_drive` drains the
queue at each step boundary and appends as user messages before the next model call
(Claude-Code/pi semantics); Stop cancels + returns queued text to the composer (pi's Esc). The
409 path remains for plan/apply/compact collisions and a second streaming attach — steering is
for *messages* only.
- **Semantics specified (v2.1):**
  - **Queue drain at turn end.** If the turn completes or suspends with a non-empty queue, the
    queued messages start a **new turn** in FIFO order (that's what "queued" means to the user) —
    EXCEPT after `cancel`, which returns the queue to the composer instead (pi's Esc semantics:
    stop means *stop*, don't auto-fire the backlog into a fresh turn). Suspension + queue is the
    subtle one: the queued message runs as a new turn while the confirm bubble stays pending —
    already-valid state today (`_assemble` synthesizes `skipped` for unresolved calls).
  - **What steering does NOT re-run:** skill activation (`_activate_skills`) and the reflection
    arm are turn-start concerns keyed to the *initial* message; a steered message doesn't
    re-select skills mid-turn (document in the steer bubble's help if surprising). The steered
    message DOES count in `count_user_messages` — reflection cadence drift is acceptable.
  - **Cache posture:** steered messages append to the history tail — the static head stays
    byte-stable; no cache impact.
  - **`!exec` mid-turn** (Slice 2's deferred question): route it through the same queue as a
    steering submission rather than 409 — it already persists an assistant+tool pair keyed by
    `call_id`, so pairing survives; the queue just serializes *when* it lands.
- **Verify:** send mid-turn → model visibly reacts next step; stop → draft restored (not
  auto-run); complete-with-queue → new turn fires FIFO; suspend-with-queue → confirm bubble +
  queued turn coexist coherently; queue order preserved.

### Slice 6 — Compaction v2 (A3, absorbs ACA-5 riders) · M–L — design review first
Reserve-headroom trigger (`window − reserve`, replacing the fixed 6000 default — `CompactionCfg`
gains `reserve_tokens`/`keep_recent_tokens`, per-agent like today); estimator includes static head
+ tools (Slice-1 measurement feeds this); tool-result-clearing tier before summarizing; structured
summary template with never-prune classes; anti-thrash guard; `/compact &lt;instructions&gt;`
passthrough. Cache-aware ordering noted from Cline (summarize with the cached prefix intact — we
already do, keep it).
- **Prerequisite specified (v2.1): the model context window is not in config today.**
  `InferenceEndpointCfg` has no `context_window` field, so `window − reserve` is currently
  *uncomputable*. Add `context_window` per endpoint (owner-set; optionally probed from llama.cpp
  `/props` later), resolved against the **turn's effective endpoint** (`eff_mode`/`eff_model`).
  Failover nuance: if a turn fails over local→cloud, the trigger evaluates against the endpoint
  that will actually serve the next call — use the *selected* endpoint's window and accept that a
  failover-served turn compacts on the primary's (smaller) budget; conservative is correct here.
  Unset window → fall back to today's absolute-threshold behavior (no regression path).
- **Tool-result clearing is an assembly-time transform, NOT a DB rewrite (A12 guard).** Claude
  Code clears results in the request it builds, not in its transcript. Ours the same: `_assemble`
  substitutes a placeholder (`[output cleared — re-run the tool if needed]`) for tool outputs
  older than N steps / larger than M chars, keyed off the **persisted** `ToolResultPart` which
  stays verbatim in SQLite. Never-clear classes: results whose call is unresolved
  (AWAITING_*), `task_plan` results (the live plan round-trips through its call args), `memory`
  results, and the most recent step. Caveat: the substitution changes the history tail, which is
  *already* the mutable cache region — no additional cache cost beyond compaction itself.
- **Never-prune classes for the summarizer** (distinct from clearing): the active `task_plan`
  pair, pending AWAITING_* calls, and the rolling-summary re-fold all stay out of the folded
  head or are explicitly carried into the template's "Rules & Constraints"/"Next Steps" sections.
- **Verify:** long-thread pytest matrix (trigger points per endpoint window, unset-window
  fallback, clearing placeholders present in the assembled payload but absent from
  `GET /threads/{id}/messages`, never-prune survival, thrash stop); live long session on `minig+`.

### Slice 7 — Model routing & retry visibility (A4, A6, A7-classifier) · M — design review first (new D-entry)
Lead/worker routing on the existing seams: `AgentDef.model` stays the base; a `routing` block
(lead `ModelRef`, `lead_turns`, `failure_threshold`, `fallback_turns`) resolved inside `_drive`'s
existing `eff_mode/eff_model` seam; failover chain unchanged underneath. Typed `retry`/failover
wire events with attempt + category (upgrade the D18 `notice`); explicit retryable-error
classifier in `core/failover` policy (pi's split — classifier decides *retryable?*, the chain
owns *what next*).
- **Edge cases specified (v2.1):**
  - **Route per TURN, not per iteration.** Switching endpoints mid-turn discards the KV/prefix
    cache and re-prefills the whole context every iteration — Goose's lead/worker switches on turn
    phase, and so must ours: the routing decision is taken once at turn start (with the
    failure-counter check), then held for the turn's iterations. Failover remains the
    per-request exception path.
  - **A7 transforms mostly unnecessary here:** ctrl-b already drops `ReasoningPart` from the
    assembled context (`_assemble`), so mid-thread local↔cloud handoff carries no
    provider-specific thinking blocks — pi's normalization layer is only needed if reasoning
    content ever starts round-tripping. Note this in the D-entry so nobody builds it
    preemptively.
  - **Wire-visible retries depend on Slice 3:** live per-attempt events require the turn task's
    emit-anytime capability (pre-Slice-3, the generator can't yield during `failover()`'s attempt
    loop — only a post-hoc `notice` is possible). Sequencing already correct; stated so it isn't
    "optimized" earlier.
- **Verify:** scripted flaky-provider harness; UI shows retry/failover narration; lead-fallback
  triggers on consecutive worker failures; cache-hit telemetry confirms no per-iteration
  endpoint churn.

### Slice 8 — Approvals evolution (A5) · M — aligns with ROADMAP privilege levels (D16/A1)
Persisted per-action "always allow" (a small `approvals` table keyed by action name + optional
args-pattern; consulted by the gate); pattern rules for arg-bearing actions (glob on the
normalized args json, opencode-style last-match-wins); Conf UI panel + "don't ask again"
affordance on the confirm bubble.
- **Precedence specified (v2.1)** — one explicit ladder, tested as such:
  **policy DENY** (READONLY-privilege denials, `run_shell` gating) **&gt; persisted approval**
  (CONFIRM→ALLOW downgrade only) **&gt; `decide()`'s normal outcome.** An approval can never
  resurrect a denied action, and a session `/privilege readonly` still denies regardless of stored
  approvals — the ladder slots into `ActionService.invoke` *between* the DENY branch and the
  CONFIRM branch, so the DENY path is structurally unreachable by approvals.
  **Open sub-question (§6 Q8):** may an approval bypass `ToolSpec.confirm=True` (the designer's
  forced-confirm on e.g. `shutdown`)? Field precedent is split (Claude Code's ask-rules still ask;
  opencode's Always genuinely persists). Recommendation: forced-confirm stays un-bypassable;
  risk-derived confirms (MED at CONFIRM privilege) are what "always allow" downgrades.
- **Verify:** gate tests (the full precedence ladder; patterns; persistence across restart;
  approval + `/privilege readonly` still denies); the SECURITY_MODEL checklist gets a new row.

### Backlog (explicitly not scheduled)
A8 deferred tool schemas (until the Slice-1 measurement shows pressure) · A9 memory freeze knob
(§6) · A10 reasoning budget (llama.cpp control surface) · Gemini-style content-chant detector
(only if narration loops appear) · pi-style provider-portable thinking-block transforms (when a
reasoning local model lands) · Claude-Code-style progressive memory index (when caps grow,
ROADMAP B1).

### Doc/decision artifacts
| Artifact | When |
|---|---|
| `DECISIONS.md` **D35 — Durable turns** (turn registry + replayable event log + explicit cancel + steering submissions) | Slice 3 design review (steering rider at Slice 5) |
| `DECISIONS.md` **D36 — Per-thread turn serialization** (lock now, steer queue as the end state) | Slice 2 |
| `DECISIONS.md` **D37 — Lead/worker model routing** | Slice 7 design review |
| `DESIGN.md` §5.3/§6/§12 rewrite | Slice 0 (interim), Slice 3/5 (final) |
| `TODO.md` new phase "Chat hardening & adoption (ACA)" | on plan approval |
| `SECURITY_MODEL.md` rows for ACA-9 outcome + Slice 8 approvals | Slices 1/8 |

---

## 6. Open questions for the owner (review checklist)

1. **Slice 3 direction confirmed?** Durable turns (server-owned task + replay + Stop) — now backed
   by unanimous field precedent (§3.1). The cheaper "transport-coupled + Stop + honest docs"
   remains listed for completeness only.
2. **Steering (Slice 5):** adopt queue-then-inject as the end state for ACA-2 (recommended, 5-of-6
   field precedent), or stay with the plain 409 permanently?
3. **ACA-9 / Slice 1.5:** consume the orphan token, or accept-and-comment? — **ANSWERED (owner,
   2026-07-16): CONSUME the original pending token on resume re-mint.** Rationale: no legitimate
   redeemer exists for the orphan; the two-device double-tap case *wants* the second stale Allow
   to fail cleanly.
4. **A4 lead/worker routing:** worth a slice, or defer until the cloud bill / local-model failure
   rate demands it? (It's the most speculative adoption; everything else is defect-adjacent.)
5. **A9 memory freeze:** keep per-turn memory reads (edits apply immediately) or adopt Hermes's
   per-session freeze (stronger cache, staler memory)? Default recommendation: keep per-turn.
6. **Timing vs emma deploy:** Slices 0–2 pre-deploy, 3+ post-deploy on emma — agreed?
7. **Slice 8 priority:** approvals-persistence is pure UX (fewer confirm taps); schedule after 7,
   or pull earlier?
8. **Forced-confirm bypass (Slice 8):** may a persisted "always allow" bypass
   `ToolSpec.confirm=True` (e.g. `shutdown`)? Recommendation in the slice: no — approvals only
   downgrade *risk-derived* confirms; the designer's forced-confirm stays un-bypassable. Confirm
   or overrule.
9. **Steering drain semantics (Slice 5, pre-answered — veto if wrong):** complete/suspend with a
   non-empty queue → queued messages auto-run as the next turn (FIFO); **cancel** → queue returns
   to the composer instead of auto-running. And `!exec` mid-turn becomes a steering submission
   rather than a 409.

---

## 7. References

### 7.1 Slice-3 pattern grounding (v1.1 research dossier)
**Official:** [Python asyncio — Tasks](https://docs.python.org/3/library/asyncio-task.html)
(strong-ref footgun; shield; CancelledError re-raise) ·
[AnyIO — Cancellation](https://anyio.readthedocs.io/en/stable/cancellation.html) ·
[OpenAI — Background mode](https://developers.openai.com/api/docs/guides/background)
(`sequence_number`+`starting_after`; idempotent cancel) ·
[AG-UI — Events](https://docs.ag-ui.com/concepts/events) ·
[LangGraph — Interrupts](https://docs.langchain.com/oss/python/langgraph/interrupts) ·
[CPython #116720](https://github.com/python/cpython/issues/116720).
**Maintainer:** [sse-starlette](https://github.com/sysid/sse-starlette) (+[#89
send_timeout](https://github.com/sysid/sse-starlette/issues/89)) ·
[LibreChat — resumable streams](https://www.librechat.ai/docs/features/resumable_streams)
(closest single-process prior art) ·
[vercel/resumable-stream](https://github.com/vercel/resumable-stream) +
[AI SDK resume](https://ai-sdk.dev/docs/ai-sdk-ui/chatbot-resume-streams) ·
[Chainlit — chat lifecycle](https://docs.chainlit.io/concepts/chat-lifecycle).
**Community:** [zknill — resumable SSE](https://zknill.io/posts/everyone-said-sse-token-streaming-was-easy/) ·
[Ably — resume tokens](https://ably.com/blog/resume-tokens-last-event-id-llm-streaming-reconnection) ·
[Stardrift — streaming resumptions](https://stardrift.ai/blog/streaming-resumptions) (explicit
terminal state).

### 7.2 Per-agent research packs (v2.0, key sources)
- **Codex CLI:** [protocol_v1.md (SQ/EQ)](https://raw.githubusercontent.com/openai/codex/main/codex-rs/docs/protocol_v1.md) ·
  [protocol.rs (EventMsg/Op vocabulary)](https://raw.githubusercontent.com/openai/codex/main/codex-rs/protocol/src/protocol.rs) ·
  [local-config (approvals/sandbox)](https://developers.openai.com/codex/local-config) ·
  [subagents](https://developers.openai.com/codex/subagents) ·
  [compaction research (badlogic gist)](https://gist.github.com/badlogic/cd2ef65b0697c4dbe2d13fbecb0a0a5f) ·
  [prompt-caching analysis](https://codex.danielvaughan.com/2026/04/21/codex-cli-prompt-caching-maximise-cache-hits-cost-reduction/).
- **opencode:** [docs/server](https://opencode.ai/docs/server/) ·
  [permissions](https://opencode.ai/docs/permissions/) ·
  [DeepWiki: prompt pipeline / compaction / event bus / permissions](https://deepwiki.com/sst/opencode)
  (`session/prompt.ts`, `processor.ts` DOOM_LOOP_THRESHOLD=3, `compaction.ts`, `sync/index.ts` seq
  replay, `permission/index.ts` Always rows).
- **Claude Code:** [How Claude Code works](https://code.claude.com/docs/en/how-claude-code-works)
  (steering, compaction tiers, anti-thrash) ·
  [Agent loop (SDK)](https://code.claude.com/docs/en/agent-sdk/agent-loop) (parallel read-only
  tools, maxTurns/budget, result subtypes) ·
  [permissions](https://code.claude.com/docs/en/permissions) ·
  [prompt caching in Claude Code](https://code.claude.com/docs/en/prompt-caching) ·
  [memory (auto-memory progressive load)](https://code.claude.com/docs/en/memory) ·
  [errors (10× retry + api_retry)](https://code.claude.com/docs/en/errors) ·
  [sandboxing (engineering)](https://www.anthropic.com/engineering/claude-code-sandboxing).
- **pi:** [agent-loop.ts](https://raw.githubusercontent.com/badlogic/pi-mono/main/packages/agent/src/agent-loop.ts)
  (parallel default, steering, no caps) ·
  [compaction.md](https://raw.githubusercontent.com/badlogic/pi-mono/main/packages/coding-agent/docs/compaction.md)
  (reserve 16384 / keep 20000) · [session-format.md (tree JSONL)](https://raw.githubusercontent.com/badlogic/pi-mono/main/packages/coding-agent/docs/session-format.md) ·
  [security stance](https://pi.dev/docs/latest/security) ·
  essays: [building pi](https://mariozechner.at/posts/2025-11-30-pi-coding-agent/) ·
  [what if you don't need MCP](https://mariozechner.at/posts/2025-11-02-what-if-you-dont-need-mcp/)
  (21 tools / 13.7k tokens).
- **Hermes Agent (Nous):** [memory](https://hermes-agent.nousresearch.com/docs/user-guide/features/memory)
  (cap headers verbatim, error-driven consolidation, write approval) ·
  [prompt-assembly (stable→context→volatile, frozen snapshot)](https://hermes-agent.nousresearch.com/docs/developer-guide/prompt-assembly) ·
  [personality (SOUL.md)](https://hermes-agent.nousresearch.com/docs/user-guide/features/personality) ·
  lineage: [MemGPT](https://arxiv.org/pdf/2310.08560) ·
  [Letta memory blocks](https://docs.letta.com/guides/core-concepts/memory/memory-blocks/) ·
  model-side: [Hermes 4 report](https://arxiv.org/abs/2508.18255) (reasoning budget, JSON repair) ·
  [Hermes-Function-Calling](https://github.com/NousResearch/Hermes-Function-Calling).
- **Gemini CLI:** [loopDetectionService.ts (3-tier)](https://raw.githubusercontent.com/google-gemini/gemini-cli/main/packages/core/src/services/loopDetectionService.ts) ·
  [client.ts (MAX_TURNS, tryCompressChat)](https://raw.githubusercontent.com/google-gemini/gemini-cli/main/packages/core/src/core/client.ts) ·
  [sandbox](https://geminicli.com/docs/cli/sandbox/) · [issue #12068 (0.7/0.3 compression)](https://github.com/google-gemini/gemini-cli/issues/12068).
- **Goose:** [agent.rs (pending_steers, select_all, CancellationToken)](https://github.com/block/goose/blob/main/crates/goose/src/agents/agent.rs) ·
  [permissions (smart_approve)](https://goose-docs.ai/docs/guides/managing-tools/goose-permissions/) ·
  [smart context management](https://goose-docs.ai/docs/guides/sessions/smart-context-management/) ·
  [lead/worker #4036](https://github.com/block/goose/issues/4036).
- **Cline:** [auto-compact (cache-aware)](https://docs.cline.bot/features/auto-compact) ·
  [checkpoints (shadow git)](https://docs.cline.bot/features/checkpoints) ·
  [auto-approve](https://docs.cline.bot/features/auto-approve) ·
  [plan-and-act](https://docs.cline.bot/features/plan-and-act).

## 7. Formal functionality & fix audit — 2026-07-18 (owner-ordered, pre-push; Codex external)

**Method.** An Opus-compiled audit matrix (28 functionality rows F1–F28 + every fixed issue
ACA-1..21 and all post-slice named fixes, each with commits/code/tests, honest UNVERIFIED flags) →
five focused **Codex CLI** verification runs (`gpt-5.6-sol`, reasoning high, read-only sandbox),
one per cluster, each returning a per-row verdict (VERIFIED / VERIFIED-WITH-NOTE / NO-TEST / FAIL)
+ findings. The matrix lived in the session scratchpad (ephemeral); the verdicts and dispositions
below are the durable record. **Codex is now a STANDING member of the pre-push review phase for
structural slices** (owner directive 2026-07-18) — this audit is why: five same-family review
rounds had preceded it, and the foreign model still found 5 HIGHs.

**Tally: 5 HIGH · 16 MED · ~14 LOW/NO-TEST — every row dispositioned.** Fixed same day in three
gated waves (each with per-finding pinning tests):

- **Wave A `9cc7e93` (confirm-flow fail-closed):** C1-H1 resume decisions fell OPEN (junk →
  EXECUTE; answer-against-confirm marked OK unrun) → strict Literals + fail-closed session
  branches · C1-H2+C2-M1 token lifecycle (dismiss now REVOKES the pending token; single-liveness
  on the deliberate re-mint — not generic mint, which would break the J3 stale-re-ask recovery) ·
  C1-M3 a proposal-decision typo APPLIED the write → Literal · C1-M4 a UI-reachable per-tool cap
  of 0 KeyError'd the turn → `ge=1` + defensive get · C4-H1 a confirmed call executed while
  persisted `AWAITING_CONFIRM` — a post-effect death left a RESUMABLE bubble that could repeat the
  side effect → pre-invoke RUNNING persist (death window now reads effect-unknown → CANCELLED) ·
  C4-H2 cancel was thread-scoped (a delayed Stop could kill the successor turn) → optional
  `{turn_id}` scoping, stopTurn sends the gate's id.
- **Wave B `0583507` (machinery):** C3-H1 a raw `task.cancel()` landing INSIDE the persistence
  tail defeated the anyio shield → asyncio.shield-with-await INSIDE the retained anyio scope
  (**empirically proven**: each mechanism alone fails under the other's cancellation source) ·
  C3-M3 COMMIT failure escaped the rollback arm · C4-M2 terminal answers could report the
  PREVIOUS turn (cache beat the settled handle) · C4-M3 a cancel before the drain task's first
  step bypassed all cleanup (subscribers blocked) → done-callback backfill · C2-M2 OpenAPI tools
  had per-chunk (not wall-clock) bounds → `OpenApiServerCfg.call_timeout_s` on every op ·
  C2-M3 the ADAPTER_BOUNDED test was open by category/name → symbol-keyed + dynamic-category walk
  + stale-entry detection · C5-M2 compaction could fold a durably-suspended call (orphaning its
  result) → `_split` snaps before AWAITING_* · C5-M3 the ACA-21 `tools=None` fallback existed
  only as a comment → executable one-shot retry · C5-M4 the template cache pin was commented out
  (fresh installs silently regressed ACA-18) → live YAML.
- **Wave C `a9e5199` (plumbing + tests):** C5-M1 skills were LOST across suspend/resume — the
  resumed half ran on a broader toolset than the owner confirmed under → `ResumeRequest.skills` +
  verbatim re-activation + client `skillsByCall` (the ACA-16 pattern; not snapshot-carried —
  cold-reload falls back, documented) · C3-M4 buffered questions never seeded modeByCall ·
  C4-M1 the probe race guard stopped one await early → `requireIdle` bail after the fetch ·
  C3-M1/M2 proposal truths: the §1 chokepoint row corrected (approve-to-apply is its OWN
  authorized path), failure audit Events added, apply-then-txn-fail convergence (no duplicate
  append on re-approve) · C3-L1 the turn-guard tripwire scans code-only + states its limits ·
  the 7-item missing-regression batch (rejected-bubble, runShell 409, buffered lossless,
  telemetry zero, `complete()` extra_body, thrown-read re-attach, JSON capped/error).

**Accepted with reasons (not fixed):** C1-L5 `result_sig` conflates changed error detail/output
past 300 chars (the per-tool cap bounds the spiral; revisit if a real stall-false-positive shows) ·
C2-L4 Streamable-HTTP MCP cleanup has no transport-specific test (structurally covered by the
outer timeout; stdio is the deployed transport) · C2-L5 the #116720 re-assert's exact collision
isn't reproducible from userland (CPython 3.14 carries the upstream fix — the guard is belt-only) ·
C2-L6/L7 subagent-safety + skills-zero-context contracts partially unpinned (recorded debt) ·
C4-M1-residual: the probe race is narrowed to the fetch window, not eliminated (single-user SPA) ·
C5-L3 compaction's substantive contract tests → Slice 6 (compaction v2 owns that surface) ·
C5-L4 an oversized owner-authored memory file can block the loop on read (owner-authored, single
user) · S3 cold-reload of a suspended confirm still loses ephemeral token/mode/skills pins (the
J3 re-mint makes resume WORK; mode/skills fall to defaults — persisted-on-call is the named seam
if it ever matters).

**Functionality verdicts (post-fix):** F1–F28 all VERIFIED or VERIFIED-WITH-NOTE except the
recorded debts above; F28 (voice) excluded from the chat stack by scope. Backend 397 tests,
FE 40 store tests; tip gate 7/7 incl. e2e on `a9e5199`.
