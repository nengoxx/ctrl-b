"""Agent definitions (DESIGN §5.1, D11). An `AgentDef` is *data* — the configurable shape of one
agent: its system prompt, which inference backend+model it uses, the tool/skill allowlists, its
privilege, and the loop/subagent limits. Agents are folder-discovered (D14): the **default/root
agent** is `config.yaml` globals + `agent.defaults`, and each specialist is an `agents/<slug>/`
(agent.yaml + SOUL.md); `name` is the folder slug and `prompt` is loaded from SOUL.md.

Kept in `domain/` (pure pydantic, no I/O) so both `config.py` (which builds an `AgentDef` from
`agent.defaults` + a folder's agent.yaml) and the agent runtime can import it without a layering cycle. `ModelRef` lives here too — it's
a pure pointer reused by `AgentDef.model` *and* `CompactionCfg.summarizer` (the selectable
summarizer, D11).
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

from app.domain.enums import Privilege


class ModelRef(BaseModel):
    """A pointer to an inference backend + model name **plus its per-call config** (DESIGN §5.1, D42).
    `mode`/`model` are the pointer half — both optional so a consumer can inherit the chat backend
    (`mode=None` → `InferenceCfg.default_mode`) and/or its model (`model=None` → the endpoint's
    configured model). Set one or both to override. The `max_tokens`/`reasoning_*` fields are the
    call-config half (D42/A10): modeled call params threaded as first-class kwargs into
    `stream_chat`/`complete` (the codebase rule — modeled params are kwargs, `extra_body` is unmodeled
    passthrough only). Used by each `AgentDef.model` (the agent's own calls) and by the selectable
    compaction summarizer (which today runs uncapped — a `max_tokens` here caps it for free).

    Fields are DECLARED (no `extra="allow"`): an unknown key is a typo, not a silent passthrough."""

    mode: str | None = None  # "local" | "cloud" | None → InferenceCfg.default_mode
    model: str | None = None  # None → the endpoint's configured model id
    #: Output-token budget (D42/A10). `None`/blank → no cap (today's behaviour, "inherit"). `ge=1`: a
    #: 0 is never a meaningful budget (a 0-token cap would ask the backend for an empty reply), so it is
    #: rejected at the boundary — use `None` to inherit, not 0. Flows as first-class kwargs into the chat
    #: call; the per-endpoint field NAME (`max_tokens` vs `max_completion_tokens`) is chosen by
    #: `InferenceEndpointCfg.max_tokens_field` at the wire boundary (Wave 4).
    max_tokens: int | None = Field(default=None, ge=1)
    #: Reasoning-effort ladder (D42/A10 — the universal field convention) and, since D45, the ONE primary
    #: reasoning knob: it is TRANSLATED per backend at the wire by the serving endpoint's
    #: `reasoning_dialect`. An effort-only API takes it verbatim; llama.cpp (which never reads
    #: `reasoning_effort` — hence the translation, not a shrug) takes the ladder's token budget instead;
    #: OpenRouter takes it with `"off"` → its `"none"`. `"off"` additionally becomes llama.cpp
    #: `chat_template_kwargs: {enable_thinking: false}`. `None` → the backend default.
    reasoning_effort: Literal["off", "minimal", "low", "medium", "high", "xhigh", "max"] | None = None
    #: Explicit per-request reasoning-token budget (D45) — an OVERRIDE of the ladder above, not a parallel
    #: setting. Where the serving endpoint's `reasoning_dialect` accepts a budget (llama.cpp
    #: `reasoning_budget_tokens`, OpenRouter `reasoning:{max_tokens}`) this wins over the ladder-derived
    #: value; where the dialect is effort-only (OpenAI) it is ignored. `None`/blank → the ladder decides.
    #: `ge=1` for `max_tokens` symmetry — a 0-token reasoning budget is never a meaningful *explicit*
    #: setting (use `reasoning_effort: "off"`, which the ladder maps to the server's own 0 sentinel).
    reasoning_tokens: int | None = Field(default=None, ge=1)


class CompactionCfg(BaseModel):
    """Context-window compaction (Phase 4e, D10/D11; windows + trim tier + call config, D42). When the
    working context (non-compacted history) crosses the trigger — `window × threshold_frac` where a
    window is resolvable, else the absolute `threshold_tokens` fallback — the oldest complete turns are
    summarized into a single system message and marked `compacted` (kept verbatim in SQLite).
    `keep_last_messages`/`keep_recent_tokens` are the two floors of recent context always kept; the
    summarizer is independently selectable.

    Lives here (not config.py) so an `AgentDef` can carry a per-agent override without a config↔domain
    import cycle. `Settings.agent.compaction` is the global default; `AgentDef.compaction`, when set,
    wins for that agent (and is inherited by its subagents)."""

    enabled: bool = True
    #: Fraction-of-window trigger (D42) — fire compaction when the estimated context exceeds
    #: `window × threshold_frac` (presented in the UI as "Compact at N% of context"). The field
    #: plurality (Goose 0.8, Gemini 0.5–0.7, Hermes 0.5); `le=0.95` keeps a too-late-to-summarize
    #: fire impossible, `ge=0.5` is the sanity floor. Only used when a window is resolvable
    #: (config `context_window` > probed `/props` n_ctx); with NO window, `threshold_tokens` is the
    #: fallback trigger instead.
    threshold_frac: float = Field(default=0.85, ge=0.5, le=0.95)
    threshold_tokens: int = 6000  # the NO-WINDOW fallback trigger only (absolute working-context size)
    #: Token floor kept verbatim by the two-floor `_split` (D42) — `cut = min(message-cut, token-cut)`
    #: (pi's `keepRecentTokens` precedent). Declared now; consumed by the Wave 3 summarizer split.
    #: `ge=0`: 0 turns the TOKEN floor OFF (nothing is kept on token grounds) — the message floor
    #: (`keep_last_messages`, snapped to a turn boundary) still guards the recent context, so 0 is a
    #: valid "message-floor-only" setting, not a footgun. A negative would be nonsensical → rejected.
    keep_recent_tokens: int = Field(default=4096, ge=0)
    #: Tool-output trim floor (D42 Tier 1) — an output shorter than this many tokens is left alone
    #: (internally chars ≈ `CHARS_PER_TOKEN`×, the shared heuristic). Token-named per the field
    #: convention (Codex `tool_output_token_limit` / Claude `MAX_MCP_OUTPUT_TOKENS`). `ge=0`: 0 means
    #: clear EVERY eligible tool output (aggressive but valid — no output is below the floor); negative
    #: is meaningless → rejected at the boundary.
    clear_output_min_tokens: int = Field(default=500, ge=0)
    #: How many most-recent steps the Tier-1 trim never touches (`ge=1` IS the most-recent-step
    #: safety — a 0 would let the just-run tool's output be cleared out from under the model).
    clear_keep_steps: int = Field(default=2, ge=1)
    #: Thrash breaker (D42) — after this many consecutive didn't-shrink compactions the breaker
    #: latches (one notice, no more attempts this run). Consumed by the Wave 3 thrash machine.
    max_consecutive_failures: int = 3
    keep_last_messages: int = 8  # recent-message floor kept verbatim (snapped to a turn boundary)
    #: Output-reserve toggle (D42) — when the effective `ModelRef.max_tokens` is set, subtract EXACTLY
    #: it from the trigger line (`window × threshold_frac − max_tokens`): no global cap, no silent
    #: down-clamp (the two recorded opencode bugs). Unset `max_tokens` ⇒ nothing reserved (the
    #: `threshold_frac` headroom is the margin). Consumed by the Wave 2 trigger.
    reserve_output: bool = True
    summarizer: ModelRef = Field(default_factory=ModelRef)


class RoutingCfg(BaseModel):
    """Failure-fallback model routing (ACA Slice 7, D43/A4-reduced). Two tiers — the agent's own
    `model` (the WORKER) and a designated `lead` — with TEMPORARY escalation: after
    `failure_threshold` consecutive HARD worker failures (a chain-level inference error on a
    single-endpoint chain, or reaching the forced-finalize via iteration-exhaustion / the stall guard)
    the next `fallback_turns` logical turns route to `lead`, then the machine returns to the worker.
    Structural triggers ONLY — a confident-wrong answer is a clean turn by design (content-sniffing was
    the Goose regret, rejected). The D18 endpoint failover chain runs unchanged underneath; routing
    only picks who is asked FIRST.

    Lives here (not config.py), like `CompactionCfg`, so an `AgentDef` can carry a per-agent override
    without a config↔domain import cycle. UNLIKE compaction's dual home there is NO
    `Settings.agent.routing` global: the global default is `agent.defaults.routing` (D16 — the
    separate-Settings-field anti-pattern D16 rejected; a deliberate, recorded divergence). A subagent
    copies the field via `model_copy` but it is RUNTIME-INERT — a headless child is built with no
    `RoutingState`, so it never routes (documented, not sold as inheritance)."""

    lead: ModelRef  # REQUIRED — the escalation target (a bigger/smarter backend+model pointer).
    #: Consecutive HARD worker failures that OPEN a fallback episode. `ge=1`: a 0 would escalate on the
    #: first hiccup and is meaningless as a "threshold" — rejected at the boundary.
    failure_threshold: int = Field(default=2, ge=1)
    #: How many logical turns ONE episode routes to `lead` before returning to the worker. `ge=1`: a
    #: 0-turn episode would trip then never actually use the lead — rejected at the boundary.
    fallback_turns: int = Field(default=2, ge=1)


class AgentDef(BaseModel):
    """One agent's definition (D11). `tools`/`skills` are allowlists — `"*"` means every
    `agent_exposed` tool / discovered skill, or a list of names/globs to narrow it (a skill may
    narrow further, never widen). `privilege` decides gating: `CONFIRM` (the default) auto-runs
    low-risk tools and confirms med/high; the rest of the ladder lands post-v1 (A1). The limits cap
    the loop and the subagent tree (§5.5). `extra="allow"` so future per-agent knobs round-trip."""

    model_config = {"extra": "allow"}

    name: str  # slug = folder name; the stable /agent id
    title: str = ""  # optional display name (UI only); "" → show the slug
    #: Short routing summary (7e-g, D15 #8) — the text the `AgentSelector` matches the user message
    #: against (with `name`) to auto-route a turn when `agent.auto_rotate` is on and no `/agent` is
    #: pinned. The persona stays in SOUL.md (`prompt`); this is just "when to pick me".
    description: str = ""
    prompt: str = ""  # system prompt; "" → the built-in default
    #: Additive guidance (7e-a). When non-empty, emitted as its own `system` message *after* the
    #: base prompt — so the persona/base stays a stable cache-key candidate and the extra is easy
    #: to attribute when reading logs. The global `inference.system_prompt_append` is emitted too
    #: unless `inherit_append=False`; when both apply, global comes before per-agent.
    prompt_append: str = ""
    #: When False, this agent ignores the global `inference.system_prompt_append`. Default True
    #: mirrors Claude Code's CLAUDE.md model (always added) — flip it for an agent that needs to
    #: escape the global guidance (e.g. a sandboxed/clean-room persona).
    inherit_append: bool = True
    model: ModelRef = Field(default_factory=ModelRef)  # backend+model; inherits chat default when unset
    #: This agent's memory subdirectory (D26), resolved **relative to** `MemoryCfg.memory_dir` (the
    #: memory-directory git repo root). `None` → the default `agents/<slug>`. Absolute paths and `..`
    #: escapes are rejected by the provider (falls back to the safe default) so every memory file stays
    #: inside the one repo. The default/root agent ignores this — it lives at the memory-dir root.
    memory_dir: str | None = None
    tools: list[str] | Literal["*"] = "*"  # tool-name allowlist (globs) or all agent tools
    skills: list[str] | Literal["*"] = "*"  # skill allowlist or all discovered skills
    privilege: Privilege = Privilege.CONFIRM
    #: Per-agent context-window override. `None` → inherit `Settings.agent.compaction` (the global
    #: default). A subagent inherits its parent's effective value unless its own def sets this.
    compaction: CompactionCfg | None = None
    #: Per-agent failure-fallback routing override (D43/A4). `None` → routing OFF for this agent; the
    #: global default arrives via `agent.defaults.routing` baked into every AgentDef at config-build
    #: time (deep_merge) — there is NO separate `Settings.agent.routing` (the D16 divergence from
    #: compaction's dual home). A subagent copies this via `model_copy`, but it is RUNTIME-INERT: a
    #: headless child gets no `RoutingState`, so the router never engages for it.
    routing: RoutingCfg | None = None
    max_iterations: int = 16  # tool-call loop safety cap
    #: Loop-discipline guards (capability layer C1). A weak model can spiral — repeating one tool
    #: or churning many calls without ever answering. `max_repeat_calls` is how many *identical*
    #: (tool, args) calls run before the rest are suppressed with a steering note (2 still allows a
    #: legitimate re-poll, e.g. ping→wake→ping). `max_calls_per_tool` caps how many times *any one
    #: tool* may run in a single turn regardless of args — the catch-all for a model that spams one
    #: tool with varied inputs (raise it for a research-heavy agent). `max_stall_iterations` is how
    #: many consecutive no-progress iterations (no new result, no text) force a final answer.
    #: `ge=1` (A4/C4): a 0 cap is nonsensical AND crashes the turn — `0 >= max_per_tool` selects the
    #: per-tool suppression on the FIRST call, before that tool is ever counted, so the suppression
    #: message's `tool_counts[cp.tool]` used to KeyError (now also defended with `.get`). Reject the
    #: bad config at the boundary so it can never reach the loop.
    max_repeat_calls: int = Field(default=2, ge=1)
    max_calls_per_tool: int = Field(default=6, ge=1)
    max_stall_iterations: int = 2
    max_subagent_depth: int = 2  # how deep spawn_subagents may nest
    max_concurrent_subagents: int = 3  # per-agent fan-out cap (global cap in settings)
    #: How many read-only builtin tool calls the parallel prefix dispatches concurrently in one batch
    #: (Slice 4, D40). Bounds the `asyncio.Semaphore` over the prefix tasks; `1` = parallel dispatch
    #: off (every batch runs on today's serial tail). Per-agent (mirrors `max_concurrent_subagents`);
    #: a subagent reads its own AgentDef's value. `ge=1` — a 0 cap would dispatch nothing.
    max_parallel_tools: int = Field(default=4, ge=1)
