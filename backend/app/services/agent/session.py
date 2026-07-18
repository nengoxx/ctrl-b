"""AgentSession — drives one chat turn, streaming SSE events (DESIGN §5.2, §12).

Phase 4b adds the tool-call loop to the 4a text round-trip: assemble context (incl. prior tool
calls/results in OpenAI shape) → call the model with the agent toolset → stream deltas → if the
model asked for tools, run them through the **permission gate** and the existing `ActionService`,
append the results, and loop until the model returns text-only (or `max_iterations`).

A `confirm`-gated call (med/high risk at the agent's `CONFIRM` privilege) **suspends** the turn:
the call is persisted `AWAITING_CONFIRM`, a `tool.permission` event carries a single-use confirm
token to the UI, and the stream ends `done(suspended)`. The user's execute/dismiss reopens a new
stream via `resume()`, which finishes that step and continues the loop (DESIGN §5.3). State lives
in the DB, so a dropped stream can reconnect and re-read.

Event contract (DESIGN §12 subset emitted here):
    message.start    {messageId, role, agent}   # agent = resolved AgentDef name (7e-c)
    reasoning.delta  {messageId, delta}       # thinking model's chain-of-thought (dimmed)
    text.delta       {messageId, delta}       # answer content
    part.added       {messageId, part}        # a tool_call part — UI renders the command bubble
    tool.permission  {callId, tool, args, risk, token, prompt}   # confirm bubble
    tool.question    {callId, tool, question, args}   # A2: `question` builtin asks the owner (answer bubble)
    tool.result      {callId, result}         # bubble resolves
    compaction       {removed, summaryId, truncated}   # older turns folded into a summary (4e)
    notice           {text}                    # breadcrumb (e.g. D18 inference failover)
    message.end      {messageId}
    error            {message, retryable}
    done             {threadId, state}        # completed | suspended | capped | error
"""

from __future__ import annotations

import asyncio
import json
import logging
import sys
import uuid
from dataclasses import dataclass, field
from typing import AsyncIterator, Awaitable, Callable

import anyio
from pydantic import ValidationError

from app.adapters.inference import InferenceClient, InferenceError, StreamReport
from app.config import Settings
from app.core.memory import MemoryProvider
from app.core.permissions import Decision, decide
from app.core.skills import SkillProvider, SkillSelector
from app.core.tool import UnknownTool
from app.domain.agent import AgentDef
from app.domain.conversation import (
    ErrorPart,
    Message,
    Part,
    ReasoningPart,
    TextPart,
    Thread,
    ToolCallPart,
    ToolResultPart,
)
from app.domain.enums import Actor, RunState
from app.domain.result import ToolResult
from app.services.action_service import ActionService
from app.services.agent.compaction import Compactor, estimate_payload_tokens
from app.services.agent.skills import available_skills, narrow_tools, resolve_skills, skills_prompt
from app.services.conversation import MessageRepo, ThreadRepo

log = logging.getLogger(__name__)

DEFAULT_SYSTEM_PROMPT = (
    "You are ctrl-b, a concise assistant embedded in a single-user homelab control panel. "
    "You help the owner wake, monitor, and manage a small fleet of PCs over their tailnet/LAN. "
    "You can call the provided tools to inspect and control the fleet (wake/ping hosts, start/stop "
    "services, etc.). Prefer a tool over guessing. Risky actions (shutdown, stop/restart a service) "
    "will ask the owner to confirm before running — propose them when appropriate. Resolve a host "
    "or service the owner names to its stable `id` yourself using the fleet roster provided below — "
    "never ask the owner for an id. For a multi-step request, call `task_plan` first to lay out the "
    "steps, then update it (re-send the whole list) as you complete each — keep one step `active`. "
    "Skip the plan for a single quick action. "
    "Carry the task through to completion in this turn: keep calling tools until every step is done. "
    "Do NOT stop to narrate progress or ask whether to continue when the next step is already clear — "
    "the system pauses the turn for you whenever a risky action needs confirmation, so you never have "
    "to ask permission yourself. When the same action applies to several targets (e.g. pinging every "
    "host), issue all of those tool calls together in one step rather than one at a time. "
    "Tool routing: for fleet/host/service requests use the fleet tools (wake/ping/start/stop/restart/"
    "shutdown) and `task_plan` — do NOT use web search or crawling for fleet operations. Use "
    "`web_search`/crawl tools ONLY when the owner asks for information from the internet. Never repeat "
    "the same tool call with the same arguments; if a result didn't help, change approach or answer. "
    "Answer directly and briefly; after the final tool runs, summarize the outcome in one or two lines."
)

#: Every agent invocation is audited as `Actor.AGENT`; the privilege (which decides gating) is now
#: per-`AgentDef` (4.5) — `CONFIRM` (the default agent's) auto-runs low-risk tools while med/high
#: gate on a confirm bubble (DESIGN §3 decide()).
AGENT_ACTOR = Actor.AGENT

#: Call states that need no further processing (used to skip already-run calls on resume).
_RESOLVED = {
    RunState.OK,
    RunState.ERROR,
    RunState.DENIED,
    RunState.SKIPPED,
    RunState.TIMEOUT,
    RunState.CANCELLED,  # A11/D39: a cancelled call is terminal — never re-run on resume.
}
#: Sentinel in the resume-token map marking "the user dismissed this call".
_DISMISS = "__dismiss__"


@dataclass
class AgentEvent:
    event: str
    data: dict = field(default_factory=dict)


async def collect_turn(events: AsyncIterator[AgentEvent]) -> dict:
    """Drain a `run_turn()`/`resume()` event stream into one buffered payload (D17, dual-mode chat).

    Buffered mode is a second *consumer* of the same generator — the loop is never forked. Per-token
    `text`/`reasoning` deltas are discarded (the turn persists the full assistant message to SQLite
    regardless of transport; the client re-reads it via the normal restore path), so the payload
    carries only the control data needed to drive the UI: terminal `state`, the assistant `messageId`,
    and — when the turn suspended — the `permission` (which **carries the confirm token+prompt**, the
    one thing not persisted, required for a buffered confirm to be resumable) or `question` event, or
    the `error`. The endpoint merges `{threadId, title}` on top."""
    out: dict = {"state": "completed"}
    async for ev in events:
        if ev.event in ("message.start", "message.end"):
            out["messageId"] = ev.data.get("messageId")
        elif ev.event == "tool.permission":
            out["permission"] = ev.data
        elif ev.event == "tool.question":
            out["question"] = ev.data
        elif ev.event == "error":
            out["error"] = ev.data
        elif ev.event == "done":
            out["state"] = ev.data.get("state", "completed")
    return out


@dataclass
class _LoopGuard:
    """Per-turn loop-discipline state (capability layer C1), scoped to a single `_drive` call.
    Keyed by a normalized `(tool, args)` signature: `counts` is how many times each exact call has
    been *executed* this turn; `last_results` is the latest real result for it, echoed back when a
    further identical call is suppressed. A weak model can otherwise spiral (the live probe saw
    `search_web` fired ~14× until the iteration cap)."""

    max_repeat: int
    max_per_tool: int
    counts: dict[str, int] = field(default_factory=dict)
    tool_counts: dict[str, int] = field(default_factory=dict)
    last_results: dict[str, ToolResult] = field(default_factory=dict)
    #: Call-scoped outcome signatures already seen this turn (ACA-12: `result_sig` keys on the exact
    #: call sig + the outcome). A call whose (call, result) pair repeats a prior one made no real
    #: *progress* — the model re-ran the SAME call and got the SAME answer, so it's spinning; that
    #: repeated outcome counts as no-progress and trips the stall guard before the iteration cap.
    #: Scoping by the call (vs. the old outcome-only key) stops two DIFFERENT calls that happen to
    #: return identical text from colliding into one stall bucket — the ACA-12 false-positive that
    #: could `_finalize` a legitimately-progressing turn early. The varied-arg / identical-result
    #: spiral (the live probe saw search_and_crawl fired ~16x with trivially-varied queries, every
    #: call returning the *identical* result) is now caught by the per-tool cap (C1c) instead, which
    #: refuses the (N+1)th call to any one tool regardless of args.
    seen_results: set[str] = field(default_factory=set)
    #: Normalized `(tool, args)` signatures the owner DISMISSED this drive (the denial echo). A
    #: dismissal records its signature; a fresh model re-issue of the identical call this drive is
    #: refused with a denial echo (like C1a/C1c, NOT progress) instead of re-suspending on a new
    #: confirm bubble — the user-visible retry loop a small model triggers by reading a skip as
    #: transient. Only fresh calls are checked, never a user-approved resume (`token is None`).
    denied_sigs: set[str] = field(default_factory=set)

    @staticmethod
    def sig(tool: str, args: dict) -> str:
        return f"{tool}:{json.dumps(args, sort_keys=True, default=str)}"

    @staticmethod
    def result_sig(sig: str, result: ToolResult) -> str:
        """Call-scoped progress key (ACA-12): the exact-call signature (`sig(tool, args)`, the same
        canonical string C1a uses for repeat suppression) + the outcome. Scoping by the call means two
        *different* calls returning identical text (two `ping`s both "ok") no longer collide into one
        "no-progress" bucket, while the SAME call returning the SAME result still repeats its key and
        trips the stall guard. `output` is truncated to bound the key size."""
        return f"{sig}|{result.state.value}|{result.summary}|{(result.output or '')[:300]}"


@dataclass
class _BatchPlan:
    """The single-pass prefix classifier's verdict for one assistant tool-call batch (D40 §3).

    **Wired by the Wave-4 parallel executor** — nothing calls `_classify_batch` yet this wave; it is
    the pure, side-effect-scoped authority the parallel dispatcher will consult before `_run_calls`
    runs its (verbatim) serial loop.

    `prefix` is the maximal *leading* run of parallel-eligible tool calls (in model order); every
    call from index `serial_from` onward is the **serial tail's** verbatim territory (today's
    `_run_calls` loop owns its own suppression/increments/echoes/suspension there). A prefix shorter
    than 2 is NOT worth the parallel machinery: `parallel` is then False, `prefix` is empty, and
    `serial_from` is 0 — the caller falls back to the pure serial path, and (by construction) the
    classifier has mutated `guard` NOT AT ALL on that path (see `_classify_batch`)."""

    prefix: list[ToolCallPart]
    serial_from: int

    @property
    def parallel(self) -> bool:
        """True iff the parallel machinery should run — i.e. a real (≥2-call) read-only prefix. A
        single-call 'prefix' re-classifies as serial (the serial loop stays the one source of truth
        for one-call semantics), so this is the callers' gate for prefix-vs-serial dispatch."""
        return len(self.prefix) >= 2


@dataclass
class _BatchOutcome:
    """Mutable holder for `_run_calls`' outcome (D40 §2). `_run_calls` is now an async generator, and
    PEP 525 async generators return no value — so the `(suspended, made_progress)` the serial loop used
    to `return` is written into this holder instead. `_drive` constructs it, passes it in, and reads it
    AFTER the `async for` drains.

    NOT read on the exception path: an `async for` propagates the generator's exception (or cancel)
    BEFORE the post-loop read is reached, so a caller never observes a half-written holder under an
    error. The fields are written synchronously at the point each fact is determined (a suspend flips
    `suspended` right before its `tool.permission`/`tool.question` is yielded; a real tool result flips
    `made_progress`), so a consumer draining the stream sees them settle in lockstep with the events."""

    suspended: bool = False
    made_progress: bool = False


def _tool_content(result: ToolResult) -> str:
    """Render a ToolResult as the `content` of an OpenAI `tool` message — what the model reads to
    reason about the outcome. Concise; `output` is already redacted + truncated upstream."""
    body = f"[{result.state.value}] {result.summary}"
    if result.output:
        body += f"\n{result.output}"
    if result.error:
        body += f"\nerror: {result.error}"
    return body


def _fmt_cache(report: StreamReport) -> str:
    """Render `StreamReport` cache telemetry for the context-cost log (ACA-18). A `None` field means
    the endpoint didn't report that number (local llama.cpp without `return_progress`, or a cloud
    endpoint without `stream_options: {include_usage: true}`) — rendered as a dash, deliberately NOT
    "0 cached": OpenAI floors `cached_tokens` to 0 below 1024 prompt tokens, so a real 0 is also not a
    failure. Purely observational — the number just tells the owner whether the prefix cache is working."""
    pt, ct = report.prompt_tokens, report.cached_tokens
    if pt is None and ct is None:
        return "not reported"
    hit = f"{ct / pt:.0%} hit" if (isinstance(pt, int) and pt > 0 and isinstance(ct, int)) else "— hit"
    return f"prefill {pt if pt is not None else '—'} · cached {ct if ct is not None else '—'} ({hit})"


class AgentSession:
    """Constructed per turn/resume from the shared deps. Stateless across turns — thread state
    lives in the DB so a dropped SSE stream can reconnect and re-read (DESIGN §5.3)."""

    def __init__(
        self,
        threads: ThreadRepo,
        messages: MessageRepo,
        inference: InferenceClient,
        settings: Settings,
        actions: ActionService,
        agent: AgentDef | None = None,
        skills: SkillProvider | None = None,
        selector: SkillSelector | None = None,
        memory: MemoryProvider | None = None,
        interactive: bool = True,
        depth: int = 0,
    ) -> None:
        self._threads = threads
        self._messages = messages
        self._inference = inference
        self._settings = settings
        self._actions = actions
        #: The agent definition driving this turn (D11). Resolved by the caller from the thread's
        #: `agent` field; `None` falls back to the built-in default so older call sites still work.
        self._agent = agent or settings.default_agent_def()
        self._skills = skills
        self._selector = selector
        #: File-based agent memory (7e-d). `None` (unprovided) → no memory block, so older call
        #: sites + the subsystem-off case behave exactly as before.
        self._memory = memory
        #: Headless subagents (4.5) run with `interactive=False`: a confirm-gated call resolves
        #: DENIED in place rather than suspending the turn (a child has no UI to confirm against —
        #: DESIGN §5.3). `depth` is this session's subagent nesting level, forwarded to each tool
        #: invocation so a child's `spawn_subagents` sees depth+1.
        self._interactive = interactive
        self._depth = depth
        # Context-window settings are per-agent (4.5): the AgentDef's `compaction` wins, else the
        # global default. A subagent inherits the parent's effective value (resolved at spawn).
        self._compactor = Compactor(inference, messages, self._agent.compaction or settings.agent.compaction)
        #: Per-turn skill state (4.5), set by `_activate_skills` at the start of run_turn. The
        #: effective tool allowlist defaults to the agent's; active skills may narrow it.
        self._skills_note: str | None = None
        self._tool_allow: list[str] | str = self._agent.tools
        #: Per-turn periodic-reflection flag (D27-C), armed by `_maybe_arm_reflection` at turn start
        #: when the thread's user-turn count hits the interval; `_assemble` injects a one-shot nudge
        #: while set. Default off (also the resume path, which doesn't re-arm — reflection is a
        #: turn-start concern, not a mid-turn one).
        self._reflect_now = False
        #: Per-turn caches for the INVARIANT prompt prefix (BE efficiency pass). `AgentSession` is built
        #: per turn (stateless across turns), so these reset each turn for free. Computing the static
        #: system head + the tool-schema list ONCE and reusing them byte-identically across every loop
        #: iteration keeps a stable cache prefix → the local llama.cpp KV cache (`cache_prompt`) and the
        #: cloud provider's automatic prefix cache hit on iterations 2..N, re-prefilling only the appended
        #: tool result rather than the whole system+tools+history. (Pattern: Codex CLI / Hermes / opencode
        #: all keep tools+system stable and append at the tail; caching is prefix-based + position-sensitive
        #: so any per-iteration jitter in this prefix would defeat it.) Built lazily after `_activate_skills`
        #: has set `_skills_note`/`_tool_allow` (the only turn-start inputs they depend on).
        self._static_head: list[dict] | None = None
        self._tools_cache: list[dict] | None = None
        #: Per-turn cached A8 token estimates of the INVARIANT prefix (static head + tools), so the
        #: context-cost debug line (below) doesn't re-serialize the byte-stable prefix every iteration.
        #: Reset each turn for free (the session is per-turn). Computed lazily, DEBUG-guarded.
        self._head_tokens: int | None = None
        self._tools_tokens: int | None = None

    def _system_prompt(self) -> str:
        """The agent's own prompt wins; then the global `inference.system_prompt` override; then the
        built-in default. So the default agent (empty prompt) inherits today's behaviour exactly."""
        return (
            self._agent.prompt.strip()
            or self._settings.inference.system_prompt.strip()
            or DEFAULT_SYSTEM_PROMPT
        )

    def _appends(self) -> list[str]:
        """The additive append axis (7e-a). Returns 0-2 non-empty strings to emit as separate
        `system` messages, in this order: (1) global `inference.system_prompt_append` (skipped when
        this agent opts out via `inherit_append=False`); (2) per-agent `AgentDef.prompt_append`.
        Mirrors how the roster + skills note are already injected — keeps the base prompt stable
        for any future provider-side caching and makes the "extra" easy to attribute in logs."""
        out: list[str] = []
        if self._agent.inherit_append:
            g = self._settings.inference.system_prompt_append.strip()
            if g:
                out.append(g)
        a = self._agent.prompt_append.strip()
        if a:
            out.append(a)
        return out

    def _memory_block(self) -> str | None:
        """The durable-memory block (7e-d), injected as its own `system` message right after the
        appends (D15 #4) — so it sits ahead of the roster/skills note and the history. `None` when
        no provider is wired or the subsystem/stores are empty. Read fresh per turn from live files,
        so it never interacts with the rolling compaction summary (same as the appends/roster)."""
        if self._memory is None:
            return None
        return self._memory.load_context(self._agent) or None

    def _reflection_nudge(self) -> str:
        """The one-shot periodic-reflection prompt (D27-C). Saving runs the normal `memory` tool path
        (auto_write on → saved; off → proposed for the owner's approval), so the nudge only steers —
        it never writes. The `state` clause appears only when that store is enabled."""
        cfg = self._settings.memory
        state_clause = (
            " Also update your `state` (action `set`) if how you feel has shifted."
            if cfg.state_enabled
            else ""
        )
        return (
            f"It's been {cfg.reflection_interval} turns — pause and review the recent conversation. "
            "If anything is durably worth remembering (a lasting fact, preference, or decision), save "
            f"it with the `memory` tool.{state_clause} If there's nothing worth keeping, just continue "
            "— don't invent things to store."
        )

    def _roster(self) -> str | None:
        """A compact id↔name map of the fleet + services, injected each turn so the agent resolves
        a display name to the stable slug `host_id`/`service_id` a tool needs — instead of asking
        the owner for it. Projected straight from config (no live probe); ids are stable slugs."""
        hosts = self._settings.hosts()
        services = self._settings.services()
        if not hosts and not services:
            return None
        lines = ["Fleet roster - use the `id` as the tool argument (host_id / service_id):"]
        if hosts:
            lines.append("Hosts:")
            lines += [
                f"- {h.name} ({h.os_type.value}{', ' + h.role if h.role else ''}) -> host_id: {h.id}"
                for h in hosts
            ]
        if services:
            lines.append("Services:")
            lines += [f"- {s.name} on {s.host_id} -> service_id: {s.id}" for s in services]
        return "\n".join(lines)

    def _tools(self) -> list[dict]:
        """The OpenAI toolset for this turn — `agent_tools()` narrowed to the effective allowlist
        (`self._tool_allow`): the `AgentDef`'s allowlist, further narrowed by any active skill.

        Rendered ONCE per turn and the same list reused on every `stream_chat` call. The toolset is
        turn-invariant (the allowlist is fixed at turn start; the registry only rebuilds between turns),
        and `tools` sits at the TOP of the prompt-cache hierarchy (tools → system → messages), so any
        byte jitter here would invalidate the entire cache — re-rendering it per iteration is the most
        expensive possible prefix churn. Reusing the same object guarantees a stable head."""
        if self._tools_cache is None:
            self._tools_cache = self._actions.registry.to_openai_tools(
                self._actions.registry.for_agent(self._tool_allow)
            )
        return self._tools_cache

    def _activate_skills(self, user_text: str, invoked: list[str] | None, *, select: bool = True) -> None:
        """Resolve the skills active for this turn (4.5) and stash the prompt addition + narrowed
        tool allowlist. No-op when the subsystem is off / unprovided so the default agent is
        unchanged. `invoked` are explicit `/skill-name` requests (user-invoked); the selector adds
        model-invoked picks by matching the user message.

        `select=False` (the resume path, C5-M1) skips the selector entirely and re-activates EXACTLY
        the carried `invoked` skills — the resumed half must run under the SAME narrowed toolset +
        instructions the owner confirmed against, and there is no user message to re-select over (a
        re-selection could drift the active set). `run_turn` uses the default `select=True`."""
        self._skills_note = None
        self._tool_allow = self._agent.tools
        if not (self._skills and self._selector and self._settings.agent.skills_enabled):
            return
        available = available_skills(self._skills, self._settings, self._agent)
        if select:
            active = resolve_skills(available, self._selector, user_text, invoked=invoked)
        else:
            # Resume: re-activate the carried skills verbatim, no selector re-run (no user_text).
            by_name = {s.name: s for s in available}
            active = [by_name[n] for n in (invoked or []) if n in by_name]
        if not active:
            return
        self._skills_note = skills_prompt(active)
        self._tool_allow = narrow_tools(active, self._agent.tools)

    def _static_prefix(self) -> list[dict]:
        """The INVARIANT system head for this turn — system prompt + appends + durable-memory block +
        fleet roster + active-skill note, in that fixed order (7e-a/7e-d/D15 #4). Built ONCE per turn
        and reused byte-identically every loop iteration so the cache prefix stays stable (see the
        `_static_head` field note). The reflection nudge is deliberately NOT here — it's an ephemeral
        tail layer appended in `_assemble`, so it never perturbs this cached head.

        Turn-invariant WITHIN ONE UNINTERRUPTED TURN: the system prompt / appends / roster project
        from per-turn-stable config + AgentDef, `_skills_note` is fixed at turn start by
        `_activate_skills`, and the memory block is read ONCE here — so a mid-turn `memory`-tool write
        does NOT land on the next loop iteration, which is what keeps the prefix byte-stable across
        iterations. It is NOT frozen across a suspend/resume, though (ACA-15e): a confirm/question
        resume builds a **new** `AgentSession`, whose `_static_prefix` re-reads the memory files — so a
        write made before the suspend surfaces in the resumed half's head, and the prefix re-prefills
        from the memory block onward. Behaviourally harmless; a full per-session freeze is A9."""
        if self._static_head is None:
            head: list[dict] = [{"role": "system", "content": self._system_prompt()}]
            for extra in self._appends():  # additive guidance, base-first (7e-a)
                head.append({"role": "system", "content": extra})
            memory = self._memory_block()  # durable memory, after appends (7e-d, D15 #4)
            if memory:
                head.append({"role": "system", "content": memory})
            roster = self._roster()
            if roster:
                head.append({"role": "system", "content": roster})
            if self._skills_note:  # active skills' instructions (4.5)
                head.append({"role": "system", "content": self._skills_note})
            self._static_head = head
        return self._static_head

    async def _assemble(self, thread: Thread) -> list[dict]:
        """Build the OpenAI `messages` array: the cached static system head (`_static_prefix`) + the
        non-compacted history + a one-shot reflection nudge at the tail. Reasoning is dropped (the
        model's scratchpad); tool calls + results round-trip as `assistant.tool_calls` followed by
        `tool` messages keyed by `call_id`. Any tool call left unresolved gets a synthesized
        result so the context is always valid for the API: a persisted-CANCELLED call (A11/D39) →
        `cancelled`; any other abandoned call (e.g. a dropped confirm) → `skipped`.

        History is re-read every iteration on purpose: `_compactor.compact` runs before each model call
        and can fold older turns into a summary, so the history (the cache TAIL) legitimately changes —
        only the static head above is held stable."""
        history = await self._messages.list(thread.id, include_compacted=False)
        results: dict[str, ToolResult] = {}
        for m in history:
            for rp in m.tool_results():
                results[rp.call_id] = rp.result

        out: list[dict] = list(
            self._static_prefix()
        )  # shallow copy — append history below, never mutate the cached head
        for m in history:
            if m.role == "tool":
                continue  # emitted inline after the assistant call below
            if m.role == "assistant":
                calls = m.tool_calls()
                text = m.text()
                if calls:
                    out.append(
                        {
                            "role": "assistant",
                            "content": text or None,
                            "tool_calls": [
                                {
                                    "id": c.call_id,
                                    "type": "function",
                                    "function": {
                                        "name": c.tool,
                                        "arguments": json.dumps(c.args),
                                    },
                                }
                                for c in calls
                            ],
                        }
                    )
                    for c in calls:
                        res = results.get(c.call_id)
                        if res is None:
                            # No persisted result. A call persisted CANCELLED (A11/D39 — interrupted
                            # by turn cancellation or a restart) synthesizes a `cancelled` tool
                            # message keyed STRICTLY on that persisted state (adversarial L3): a live
                            # in-flight call keeps its own non-CANCELLED state, so this never masks a
                            # genuinely-running call. Any OTHER unresolved call (an abandoned confirm)
                            # keeps the existing `skipped`/"not executed" synthesis — so the payload
                            # always carries a tool message for every tool_call id.
                            res = (
                                ToolResult(state=RunState.CANCELLED, summary="cancelled — not completed")
                                if c.state == RunState.CANCELLED
                                else ToolResult(state=RunState.SKIPPED, summary="not executed")
                            )
                        out.append(
                            {
                                "role": "tool",
                                "tool_call_id": c.call_id,
                                "content": _tool_content(res),
                            }
                        )
                elif text:
                    out.append({"role": "assistant", "content": text})
            else:  # user / system
                text = m.text()
                if text:
                    out.append({"role": m.role, "content": text})
        # Periodic reflection nudge (D27-C) as an EPHEMERAL TAIL layer — appended AFTER history so it
        # never sits inside the cached static head (Hermes ephemeral-layer pattern; volatile content goes
        # after the stable prefix). One-shot: emit in exactly ONE model call per armed turn, not on every
        # `_drive` iteration — a re-instructed weak model would otherwise re-save (a reworded save dodges
        # the loop-guard's exact-arg dedup). The model saw it once; that's the reflection prompt for the turn.
        if self._reflect_now:
            out.append({"role": "system", "content": self._reflection_nudge()})
            self._reflect_now = False
        return out

    def _log_context_cost(self, messages: list[dict], report: StreamReport) -> None:
        """A8 context-cost measurement (§4) + ACA-18 cache telemetry as ONE debug line per model call,
        so the prefix the model prefills and the cache hit rate read together — turning "should be
        caching" (§3.8) into "provably caching". DEBUG-guarded: the estimate re-serializes the prompt
        payload, and the head+tools half is only cached once per turn (the byte-stable prefix), so the
        per-call cost is just the history half. Reuses the shared `estimate_payload_tokens` heuristic
        (compaction.py) — one estimator, not a second."""
        if not log.isEnabledFor(logging.DEBUG):
            return
        if self._head_tokens is None:
            self._head_tokens = estimate_payload_tokens(self._static_prefix())
        if self._tools_tokens is None:
            self._tools_tokens = estimate_payload_tokens(self._tools())
        prompt_tok = estimate_payload_tokens(messages) + self._tools_tokens  # messages already incl. head
        history_tok = prompt_tok - self._head_tokens - self._tools_tokens
        log.debug(
            "agent context-cost [%s]: prompt≈%d tok (head %d + tools %d cached + history≈%d) · cache: %s",
            self._agent.name,
            prompt_tok,
            self._head_tokens,
            self._tools_tokens,
            history_tok,
            _fmt_cache(report),
        )

    async def run_turn(
        self,
        thread: Thread,
        user_text: str,
        *,
        mode: str | None = None,
        skills: list[str] | None = None,
    ) -> AsyncIterator[AgentEvent]:
        """Persist the user message, then drive the loop. Yields SSE events. `mode` (`local`/`cloud`,
        from the `/local`//`/cloud` composer prefixes, 4c) forces the inference backend for this turn;
        `None` uses the configured `default_mode`. `skills` are explicit `/skill-name` invocations
        (4.5); the selector adds model-invoked picks on top."""
        self._activate_skills(user_text, skills)
        user_msg = Message(
            thread_id=thread.id, role="user", actor=Actor.USER, parts=[TextPart(text=user_text)]
        )
        await self._messages.add(user_msg)
        await self._maybe_arm_reflection(thread)  # D27-C — periodic "save anything worth remembering"
        async for ev in self._drive(thread, mode=mode):
            yield ev

    async def _maybe_arm_reflection(self, thread: Thread) -> None:
        """Arm the periodic-reflection nudge for this turn (D27-C) when the thread's user-turn count
        is a multiple of `reflection_interval`. Counts the user message just persisted (so the cadence
        is every Nth turn) and **includes compacted messages** so it doesn't drift as history folds.
        Opt-in: off unless both the master memory switch and `reflection_enabled` are on, and only on
        the **top-level** conversation — a headless subagent (`depth > 0`) runs a throwaway, archived
        task thread and must not reflect its internal task into the owner's durable memory."""
        cfg = self._settings.memory
        if self._depth > 0 or not (cfg.enabled and cfg.reflection_enabled):
            self._reflect_now = False
            return
        interval = cfg.reflection_interval
        count = await self._messages.count_user_messages(thread.id)
        # `interval > 0` is belt-and-suspenders — `MemoryCfg` enforces `ge=1`, but guard the modulo
        # against a 0 reaching here via a direct mutation (tests) rather than risk a ZeroDivisionError.
        self._reflect_now = interval > 0 and count > 0 and count % interval == 0

    async def compact(self, thread: Thread) -> dict:
        """Manual `/compact` (4e): force-fold the oldest turns now, ignoring the token threshold but
        still honouring the recent-message floor + turn-boundary safety. Returns `{removed,
        summaryId?, truncated?}` for a one-shot JSON response (no SSE — there's no turn to stream)."""
        res = await self._compactor.compact(thread, force=True)
        if res is None:
            return {"removed": 0}
        return {"removed": res.removed, "summaryId": res.summary_id, "truncated": res.truncated}

    async def resume(
        self,
        thread: Thread,
        call_id: str,
        decision: str,
        confirm_token: str | None = None,
        answer: str | None = None,
        *,
        mode: str | None = None,
        skills: list[str] | None = None,
    ) -> AsyncIterator[AgentEvent]:
        """Resume a suspended turn, then continue the loop so the model can react. Three decisions:
        `execute` (a confirm-gated call — re-run with the token), `dismiss` (skip it — works for a
        confirm *or* a question), and `answer` (a `question` — inject the owner's `answer` as the
        call's result, A2). Fail-closed (A1/C1-H1): an unknown decision is rejected with an error, NOT
        treated as execute, and `answer` is only honoured against an AWAITING_ANSWER call (never used to
        silently OK a confirm). `mode` (`/local`//`/cloud`, ACA-16) is carried across the round-trip and
        threaded to `_drive` so a `/local` turn resumes local; `None` → the configured default.

        `skills` (C5-M1) are the turn's active skills, carried across the round-trip so the resumed
        half runs under the SAME narrowed toolset + injected instructions the owner confirmed under —
        a fresh session otherwise re-activates nothing and continues on a BROADER toolset. Re-activated
        verbatim (`select=False`): no re-selection, since there's no user message on a resume."""
        # Re-activate the carried skills BEFORE `_drive` reads `_tool_allow`/`_skills_note` (via
        # `_tools`/`_static_prefix`) — mirrors `run_turn`'s `_activate_skills`, minus the selector.
        self._activate_skills("", skills, select=False)
        assistant = await self._find_pending(thread, call_id)
        if assistant is None:
            yield AgentEvent("error", {"message": "no pending action for this call", "retryable": False})
            yield AgentEvent("done", {"threadId": thread.id, "state": "error"})
            return
        cp = next((c for c in assistant.tool_calls() if c.call_id == call_id), None)
        if decision == "answer":
            # A1: only a real AWAITING_ANSWER question may be answered. `_find_pending` also matches an
            # AWAITING_CONFIRM call, so an `answer` aimed at a confirm would otherwise mark it OK without
            # running — reject it here (no state change) instead.
            if cp is None or cp.state != RunState.AWAITING_ANSWER:
                yield AgentEvent(
                    "error",
                    {"message": "this call is not awaiting an answer", "retryable": False},
                )
                yield AgentEvent("done", {"threadId": thread.id, "state": "error"})
                return
            async for ev in self._drive(
                thread, mode=mode, resume_assistant=assistant, resume_answers={call_id: answer or ""}
            ):
                yield ev
            return
        if decision == "dismiss":
            # C1-H2/C2-M1: the owner denied this bubble → revoke any live confirm token bound to this
            # exact (action, args) so it can no longer be redeemed via POST /api/actions within its TTL.
            # A no-op for a question (none is minted) / after a restart (`_pending` already empty).
            if cp is not None:
                self._actions.revoke_pending(cp.tool, cp.args)
            async for ev in self._drive(
                thread, mode=mode, resume_assistant=assistant, resume_tokens={call_id: _DISMISS}
            ):
                yield ev
            return
        if decision != "execute":
            # Fail-closed (A1): anything that isn't execute/dismiss/answer never falls through to run.
            yield AgentEvent("error", {"message": "unknown resume decision", "retryable": False})
            yield AgentEvent("done", {"threadId": thread.id, "state": "error"})
            return
        # execute. The confirmation is established by the DURABLE persisted AWAITING_CONFIRM call + the
        # explicit execute decision, so re-mint the confirm token server-side for the pending call (J3)
        # rather than trust the client's ephemeral one (gone after a restart / 120s expiry / a reload,
        # which would strand the bubble). Two guards around the re-mint:
        #   • J2 — a single-flight reservation rejects a concurrent double-execute (double-tap / two
        #     tabs) of the same call, so a non-idempotent action can't fire twice.
        #   • #2 — if the tool went unknown or its persisted args no longer validate (e.g. an MCP server
        #     dropped between turns), yield a clean error instead of letting the exception escape the SSE
        #     generator (a 500 / stranded bubble), mirroring `_run_calls`.
        if not self._actions.begin_execute(call_id):
            yield AgentEvent("error", {"message": "this action is already running", "retryable": False})
            yield AgentEvent("done", {"threadId": thread.id, "state": "error"})
            return
        try:
            try:
                token = self._actions.confirm_token_for(cp.tool, cp.args) if cp else confirm_token
            except (UnknownTool, ValidationError) as exc:
                yield AgentEvent(
                    "error",
                    {"message": f"cannot execute this action — {str(exc)[:200]}", "retryable": False},
                )
                yield AgentEvent("done", {"threadId": thread.id, "state": "error"})
                return
            async for ev in self._drive(
                thread, mode=mode, resume_assistant=assistant, resume_tokens={call_id: token}
            ):
                yield ev
        finally:
            self._actions.end_execute(call_id)

    async def _find_pending(self, thread: Thread, call_id: str) -> Message | None:
        for m in await self._messages.list(thread.id):
            if m.role != "assistant":
                continue
            for cp in m.tool_calls():
                if cp.call_id == call_id and cp.state in (
                    RunState.AWAITING_CONFIRM,
                    RunState.AWAITING_ANSWER,
                ):
                    return m
        return None

    async def _drive(
        self,
        thread: Thread,
        *,
        mode: str | None = None,
        resume_assistant: Message | None = None,
        resume_tokens: dict[str, str | None] | None = None,
        resume_answers: dict[str, str] | None = None,
    ) -> AsyncIterator[AgentEvent]:
        """The loop state machine (DESIGN §5.2). On resume, first finish the suspended step; then
        run model iterations until text-only / suspended / capped. `mode` forces the inference
        backend for this turn (4c); resume now carries the turn's `mode` across the confirm
        round-trip (ACA-16 — the PWA re-sends it), so a `/local` turn resumes local. `None` (no
        override) → the agent's own `model.mode`, else the configured default."""
        # One loop-discipline guard per turn (C1): tracks repeated calls + stall across iterations.
        guard = _LoopGuard(
            max_repeat=self._agent.max_repeat_calls,
            max_per_tool=self._agent.max_calls_per_tool,
        )
        if resume_assistant is not None:
            outcome = _BatchOutcome()
            async for ev in self._run_calls(
                thread, resume_assistant, resume_tokens or {}, guard, resume_answers or {}, outcome=outcome
            ):
                yield ev
            if outcome.suspended:
                yield AgentEvent("done", {"threadId": thread.id, "state": "suspended"})
                return

        # Effective inference target: the per-message mode override (4c `/local`//`/cloud`) wins,
        # else the agent's own `model.mode`; the agent's `model.model` overrides the endpoint model
        # (both `None` → the configured default, so the default agent is unchanged).
        eff_mode = mode or self._agent.model.mode
        eff_model = self._agent.model.model

        stall = 0  # consecutive no-progress iterations (C1b) → forced wrap-up at the agent's cap
        for _ in range(self._agent.max_iterations):
            # Compaction check before each model call (DESIGN §5.2 step 2): if the working context
            # is over the configured threshold, fold the oldest turns into a summary system message.
            res = await self._compactor.compact(thread)
            if res is not None:
                yield AgentEvent(
                    "compaction",
                    {"removed": res.removed, "summaryId": res.summary_id, "truncated": res.truncated},
                )
            messages = await self._assemble(thread)
            assistant = Message(
                thread_id=thread.id, role="assistant", actor=AGENT_ACTOR, agent=self._agent.name
            )
            yield AgentEvent(
                "message.start",
                {"messageId": assistant.id, "role": "assistant", "agent": self._agent.name},
            )

            reasoning_buf: list[str] = []
            text_buf: list[str] = []
            reqs = []
            report = StreamReport()  # D18: learn whether inference fell over, to surface a breadcrumb
            try:
                async for delta in self._inference.stream_chat(
                    messages, mode=eff_mode, model=eff_model, tools=self._tools(), report=report
                ):
                    if delta.reasoning:
                        reasoning_buf.append(delta.reasoning)
                        yield AgentEvent(
                            "reasoning.delta", {"messageId": assistant.id, "delta": delta.reasoning}
                        )
                    if delta.text:
                        text_buf.append(delta.text)
                        yield AgentEvent("text.delta", {"messageId": assistant.id, "delta": delta.text})
                    if delta.tool_calls:
                        reqs = delta.tool_calls
            except InferenceError as exc:
                assistant.parts = [ErrorPart(message=str(exc), retryable=True)]
                await self._messages.add(assistant)
                await self._threads.touch(thread.id, assistant.ts)
                yield AgentEvent("error", {"message": str(exc), "retryable": True})
                yield AgentEvent("done", {"threadId": thread.id, "state": "error"})
                return

            # D18 — the request fell over to a fallback inference endpoint. Surface a breadcrumb so a
            # down primary (e.g. the local model) is visible + actionable, not silent (it's logged too).
            if report.degraded:
                yield AgentEvent(
                    "notice", {"text": f"// inference failover → {report.served} (primary unavailable)"}
                )
            self._log_context_cost(messages, report)  # A8 estimate + ACA-18 cache telemetry (debug)

            parts: list[Part] = []
            if reasoning_buf:
                parts.append(ReasoningPart(text="".join(reasoning_buf)))
            text = "".join(text_buf)
            if text or not reqs:
                parts.append(TextPart(text=text))

            if not reqs:
                assistant.parts = parts
                await self._messages.add(assistant)
                await self._threads.touch(thread.id, assistant.ts)
                yield AgentEvent("message.end", {"messageId": assistant.id})
                yield AgentEvent("done", {"threadId": thread.id, "state": "completed"})
                return

            # Parse each call's raw args. A malformed blob (ACA-13) persists with `args={}` and the
            # raw blob stamped on the part's `invalid_raw` (truncated ≤200 chars — its only use is the
            # steering snippet), so `_run_calls` feeds the model a JSON-repair steering error instead
            # of silently invoking the tool with `{}`. Persisting the marker on the part (vs. a
            # memory-only side-channel) makes it survive a suspend/resume: a resumed malformed call
            # still steers rather than silently invoking with `{}`.
            call_parts: list[ToolCallPart] = []
            for r in reqs:
                call_id = r.id or uuid.uuid4().hex
                args, invalid = _parse_args(r.arguments)
                call_parts.append(
                    ToolCallPart(
                        call_id=call_id,
                        tool=r.name,
                        args=args,
                        invalid_raw=invalid[:200] if invalid is not None else None,
                    )
                )
            parts.extend(call_parts)
            assistant.parts = parts
            await self._messages.add(assistant)
            await self._threads.touch(thread.id, assistant.ts)
            for cp in call_parts:
                yield AgentEvent(
                    "part.added", {"messageId": assistant.id, "part": cp.model_dump(mode="json")}
                )
            yield AgentEvent("message.end", {"messageId": assistant.id})

            outcome = _BatchOutcome()
            async for ev in self._run_calls(thread, assistant, {}, guard, outcome=outcome):
                yield ev
            if outcome.suspended:
                yield AgentEvent("done", {"threadId": thread.id, "state": "suspended"})
                return
            # Stall guard (C1b): only a *new tool result* counts as progress. Narration text does
            # NOT — a thinking model emits commentary alongside its tool calls every iteration, and
            # counting that as progress would defeat this guard entirely (the bug that let the loop
            # run to max_iterations). A text-only reply already returned `completed` above, so any
            # `text` here is just narration accompanying tool calls.
            if outcome.made_progress:
                stall = 0
            else:
                stall += 1
                if stall >= self._agent.max_stall_iterations:
                    async for ev in self._finalize(thread, eff_mode, eff_model):
                        yield ev
                    return
            # else: loop — call the model again so it can react to the tool results

        # Iterations exhausted: instead of a silent `capped` dead-end, force one tool-less call so
        # the owner always gets a final answer (C1c, opencode's max-step-guidance pattern).
        async for ev in self._finalize(thread, eff_mode, eff_model):
            yield ev

    async def _finalize(
        self, thread: Thread, eff_mode: str | None, eff_model: str | None
    ) -> AsyncIterator[AgentEvent]:
        """Forced final answer (C1c). Reached when the loop stalls or exhausts `max_iterations` —
        one **tool-less** model call (so it can only produce text) with a nudge to wrap up, instead
        of the old silent `capped` dead-end. Always ends the turn with a reply; only if this call
        itself fails do we fall back to `capped` so there's still a terminal event."""
        self._reflect_now = (
            False  # the wrap-up call is tool-less — don't carry the "use the memory tool" nudge
        )
        messages = await self._assemble(thread)
        messages.append(
            {
                "role": "system",
                "content": (
                    "You have done enough tool work for this request. Do NOT call any more tools. "
                    "Give the owner your final answer now. Be honest: summarize only what you "
                    "actually accomplished via the tool results above, and clearly state what you "
                    "could NOT do. Do not claim a step or plan succeeded if its tool was never run "
                    "or returned an error."
                ),
            }
        )
        assistant = Message(thread_id=thread.id, role="assistant", actor=AGENT_ACTOR, agent=self._agent.name)
        yield AgentEvent(
            "message.start",
            {"messageId": assistant.id, "role": "assistant", "agent": self._agent.name},
        )
        reasoning_buf: list[str] = []
        text_buf: list[str] = []
        report = StreamReport()
        # ACA-21: first send the SAME cached toolset with `tool_choice="none"` (NOT `tools=None`) so the
        # prompt-cache prefix — tools sit at its very top — stays intact for this one wrap-up call
        # instead of re-prefilling system+memory+roster+history from zero. Live-probed against the
        # deployed llama-server (2026-07-16): `tool_choice:"none"` is accepted, emits no parsed
        # tool_calls, and retains the prefix cache. Caveat: with the grammar off the model can leak a
        # *textual* tool-call into `content` (cosmetic — it's just saved as answer text).
        #
        # ACA-21 v2.3 amendment made executable (audit C5-M3): an OpenAI-compatible endpoint that
        # REJECTS `tool_choice:"none"` (some 400 on it) would otherwise raise `InferenceError` on every
        # failover hop and cap the turn with NO answer. So fall back ONCE to `tools=None` (drops the
        # toolset — re-prefills, but today's pre-ACA-21 behaviour still yields a wrap-up). Only retry
        # when nothing streamed yet: a mid-stream failure can't be cleanly re-emitted, so it goes
        # straight to capped.
        # (tools, tool_choice) per attempt: the ACA-21 primary, then the tools=None fallback. When
        # `tools` is None `stream_chat` ignores `tool_choice`, so the fallback sends no tool_choice.
        for attempt, (fin_tools, fin_choice) in enumerate(((self._tools(), "none"), (None, None))):
            reasoning_buf = []
            text_buf = []
            report = StreamReport()
            try:
                async for delta in self._inference.stream_chat(
                    messages,
                    mode=eff_mode,
                    model=eff_model,
                    tools=fin_tools,
                    tool_choice=fin_choice,
                    report=report,
                ):
                    if delta.reasoning:
                        reasoning_buf.append(delta.reasoning)
                        yield AgentEvent(
                            "reasoning.delta", {"messageId": assistant.id, "delta": delta.reasoning}
                        )
                    if delta.text:
                        text_buf.append(delta.text)
                        yield AgentEvent("text.delta", {"messageId": assistant.id, "delta": delta.text})
            except InferenceError as exc:
                if attempt == 0 and not text_buf and not reasoning_buf:
                    log.debug("finalize: tool_choice='none' failed (%s); retrying once with tools=None", exc)
                    continue  # nothing streamed → safe to re-issue as a plain tool-less wrap-up
                assistant.parts = [ErrorPart(message=str(exc), retryable=True)]
                await self._messages.add(assistant)
                await self._threads.touch(thread.id, assistant.ts)
                yield AgentEvent("error", {"message": str(exc), "retryable": True})
                yield AgentEvent("done", {"threadId": thread.id, "state": "capped"})
                return
            break  # streamed OK — don't run the fallback attempt
        self._log_context_cost(messages, report)  # A8 estimate + ACA-18 cache telemetry (debug)

        parts: list[Part] = []
        if reasoning_buf:
            parts.append(ReasoningPart(text="".join(reasoning_buf)))
        text = "".join(text_buf) or "(Stopped after reaching the step limit for this request.)"
        parts.append(TextPart(text=text))
        assistant.parts = parts
        await self._messages.add(assistant)
        await self._threads.touch(thread.id, assistant.ts)
        yield AgentEvent("message.end", {"messageId": assistant.id})
        yield AgentEvent("done", {"threadId": thread.id, "state": "completed"})

    def _classify_batch(
        self,
        assistant: Message,
        guard: _LoopGuard,
        resume_tokens: dict[str, str | None],
        resume_answers: dict[str, str] | None = None,
    ) -> _BatchPlan:
        """Split one assistant tool-call batch into a **parallel read-only prefix** + a **serial tail**
        (D40 §3). PURE: one synchronous walk over `assistant.tool_calls()` in model order — NO I/O, NO
        awaits (registry lookup + `decide()` are pure). **Wired by the Wave-4 parallel executor**;
        unwired this wave.

        A call is admitted to the prefix iff ALL predicates pass, evaluated cheap-first in THIS order
        (the order matters because the walk's admissions ARE the dispatch increments):

          (a) **fresh** — `state not in _RESOLVED`, no resume token for its `call_id`, no resume answer
              (a resume batch's leading calls are `_RESOLVED` and the resumed call carries a token → a
              resume ALWAYS yields an empty prefix; resumes stay serial by construction).
          (b) **not suppressed vs the CURRENT guard** — `sig not in denied_sigs`; per-tool cap
              `tool_counts[tool] < max_per_tool`; repeat-cap `counts[sig] < max_repeat`. Repeat-cap
              reads **counts ONLY** — NOT `last_results`/`seen_results`: those are *completion* state
              (populated when a call finishes), and the serial tail re-checks this call AFTER its
              prefix twins complete and populate `last_results`, reproducing today's `>= max_repeat AND
              sig in last_results` verdict + echo byte-for-byte. Reading completion state here would
              diverge from that.
          (c) **args parsed OK** — the malformed-args marker `cp.invalid_raw` IS the persisted verdict
              of `_parse_args` (run once at `_drive` stamp time, incl. the empty-string legacy zero-arg
              path → `invalid_raw is None` → admissible); a parse failure (`invalid_raw is not None`)
              is NOT admitted (the serial tail owns malformed-args JSON-repair steering). We reuse that
              stored verdict rather than re-parsing (the raw blob isn't retained; one parse authority).
          (d) **spec exists AND builtin-authored `read_only` AND `not suspending`** — the
              builtin-vs-derived discriminator is `spec.category != "mcp"` (MCP *and* OpenAPI tools
              both register `category="mcp"`; their `read_only` is DERIVED from external annotations →
              advisory → prefix-INELIGIBLE per the ToolSpec docstring). `idempotent` grants NOTHING
              (idempotent ≠ order-independent: `start_service`/`stop_service`/`shutdown_host` are
              idempotent but must never race a sibling read).
          (e) `decide(...) == ALLOW` — mirroring `ActionService.invoke`'s live arguments exactly
              (`run_shell_allowed=self._settings.shell.agent_exec_enabled`, `interactive=`this turn's).

        **Overlay-then-commit** (why this shape): the classifier must NOT mutate `guard` on the ≤1
        (serial) path, yet call *j*'s verdict must see the tentative admissions of calls *i<j* (so a
        within-batch repeat trips the cap mid-walk exactly as the serial loop's post-increment does).
        So the walk keeps a LOCAL counts overlay (base `guard` counts + in-walk tentative increments),
        checks each predicate against `base + overlay`, and bumps the overlay on each tentative
        admission — WITHOUT touching `guard`. Only AFTER the walk, iff the prefix is ≥2, are the
        increments COMMITTED to `guard` in model order (those commits ARE the dispatch increments — no
        second pass anywhere, no double-count). A prefix of ≤1 returns an empty-prefix plan with
        `guard` byte-identical to entry."""
        answers = resume_answers or {}
        calls = assistant.tool_calls()
        # Mirror `invoke`'s live run_shell gate value (read once — this walk is synchronous).
        run_shell_allowed = self._settings.shell.agent_exec_enabled
        # LOCAL overlays: tentative in-walk increments, layered over the real guard for visibility to
        # later calls in the SAME batch, committed to `guard` only for a real (≥2) prefix.
        counts_overlay: dict[str, int] = {}
        tool_overlay: dict[str, int] = {}
        tentative: list[ToolCallPart] = []

        for cp in calls:
            sig = _LoopGuard.sig(cp.tool, cp.args)
            # (a) fresh — not already resolved, not part of a resume (token or injected answer).
            if cp.state in _RESOLVED or cp.call_id in resume_tokens or cp.call_id in answers:
                break
            # (b) suppression vs CURRENT guard + tentative in-batch admissions (counts only).
            if sig in guard.denied_sigs:
                break
            if guard.tool_counts.get(cp.tool, 0) + tool_overlay.get(cp.tool, 0) >= guard.max_per_tool:
                break
            if guard.counts.get(sig, 0) + counts_overlay.get(sig, 0) >= guard.max_repeat:
                break
            # (c) args parsed OK — the persisted `_parse_args` verdict (malformed → not admitted).
            if cp.invalid_raw is not None:
                break
            # (d) spec present, builtin-authored read_only, not suspending. `category == "mcp"` is the
            # verified builtin-vs-derived discriminator (MCP + OpenAPI both register there).
            try:
                spec = self._actions.registry.get(cp.tool).spec
            except UnknownTool:
                break
            if spec.category == "mcp" or not spec.read_only or spec.suspending:
                break
            # (e) decide() == ALLOW — mirror invoke's exact arguments.
            if (
                decide(
                    spec,
                    self._agent.privilege,
                    interactive=self._interactive,
                    run_shell_allowed=run_shell_allowed,
                )
                != Decision.ALLOW
            ):
                break
            # Tentative admission: bump the overlay so the NEXT call in this batch sees it. NO guard
            # mutation yet — committed below only for a real (≥2) prefix.
            counts_overlay[sig] = counts_overlay.get(sig, 0) + 1
            tool_overlay[cp.tool] = tool_overlay.get(cp.tool, 0) + 1
            tentative.append(cp)

        if len(tentative) >= 2:
            # Commit the overlay to the real guard IN MODEL ORDER — these ARE the dispatch increments
            # (the parallel executor does NOT increment again; the serial tail keeps its own).
            for cp in tentative:
                sig = _LoopGuard.sig(cp.tool, cp.args)
                guard.counts[sig] = guard.counts.get(sig, 0) + 1
                guard.tool_counts[cp.tool] = guard.tool_counts.get(cp.tool, 0) + 1
            return _BatchPlan(prefix=tentative, serial_from=len(tentative))
        # ≤1 eligible → pure serial path, zero guard mutation.
        return _BatchPlan(prefix=[], serial_from=0)

    async def _persist_shielded(self, write: Callable[[], Awaitable[None]]) -> None:
        """Run one persistence `write()` under the DUAL SHIELD (C3-H1, extracted verbatim from the old
        `_run_calls` `finally` tail — D40 §6, ONE implementation now used by BOTH the per-call persists
        and the finally backstop). `write` is a zero-arg coroutine factory that does the actual DB work
        (typically inside a `Database.transaction()`); it must be idempotent, since a cancel may drive
        it to completion after the caller stopped awaiting.

        TWO distinct cancellation sources are defeated:
          • a *fresh raw* `asyncio.Task.cancel()` (a Stop) arriving while we are parked awaiting the
            lock/BEGIN/writes/COMMIT. An `anyio.CancelScope(shield=True)` ALONE does NOT reliably
            suppress that — anyio can't attribute a raw asyncio cancel to a scope it owns, so it
            re-raises it mid-write and rolls the write back (audit C3-H1). The deterministic
            asyncio-native guard: run the write as its OWN task (`asyncio.ensure_future`) — genuinely
            uncancellable by the outer cancel — and `await asyncio.shield(persist)`; on `CancelledError`
            we `await persist` a SECOND time so it is guaranteed to finish before we re-raise (we ALWAYS
            await it → no detached-task leak; NOT a bare `asyncio.shield` without the second await).
          • anyio's level-triggered scope cancellation (Starlette request scope / the subagent
            TaskGroup), which re-raises at every await — the outer `anyio.CancelScope(shield=True)` is
            retained for THAT shape (it is what the Slice-2 shielded-persistence test pins).

        **Swallow-only-while-unwinding** (kept exactly as the old tail): captured `sys.exc_info()[1]` at
        entry. On the LIVE path (no exception in flight → `in_flight is None`) a write failure RAISES —
        so a per-call persist that fails raises BEFORE its event is yielded (**persist-before-emit**: a
        subscriber/snapshot can never hold a result whose row vanished). While UNWINDING an exception
        (the finally backstop under a cancel/error) a write failure is logged + swallowed so it never
        REPLACES the in-flight exception (a swallowed cancel would mis-drive the caller's cancel scope).
        The scope is entered synchronously (no checkpoint before it) so `BEGIN` is always paired with
        `COMMIT` — no dangling transaction."""
        in_flight = sys.exc_info()[1]  # the exception this call runs under (finally backstop), if any

        async def _guarded() -> None:
            try:
                await write()
            except Exception:
                if in_flight is None:
                    raise  # live path: fail loud → the caller must NOT emit the un-persisted event
                log.exception(
                    "step persistence failed while unwinding %r — original exception preserved",
                    type(in_flight).__name__,
                )

        persist = asyncio.ensure_future(_guarded())
        with anyio.CancelScope(shield=True):
            try:
                await asyncio.shield(persist)
            except asyncio.CancelledError:
                await persist  # the inner task is uncancellable by the outer cancel — let it finish
                raise

    async def _run_calls(
        self,
        thread: Thread,
        assistant: Message,
        resume_tokens: dict[str, str | None],
        guard: _LoopGuard,
        resume_answers: dict[str, str] | None = None,
        *,
        outcome: _BatchOutcome,
    ) -> AsyncIterator[AgentEvent]:
        """Process the assistant's not-yet-resolved tool calls in order, **as an async generator** (D40
        §2): each tool event is `yield`ed at the point it is produced instead of buffered — with the
        D40 **persist-before-emit** rule, a call's `tool.result`/`tool.permission`/`tool.question` is
        yielded ONLY AFTER that call's state + result are durably committed. ALLOW runs immediately via
        `ActionService` (which validates, decides, executes, records the Event); DENY/bad-args
        synthesize a clean result fed back to the model; CONFIRM suspends (persist AWAITING_CONFIRM,
        emit `tool.permission`, stop). A call whose `invalid_raw is not None` (its raw arguments
        weren't valid JSON — ACA-13) skips invocation entirely and yields an ERROR result echoing the
        raw blob so the model can repair it (it still counts toward the loop-guard caps, like any
        errored call). The marker rides the persisted `ToolCallPart`, so a malformed call that shares
        an assistant message with a suspending call still steers on resume rather than silently
        invoking with `{}`. An exact-repeat call past `guard.max_repeat` is **suppressed**
        (C1): not executed, the prior result echoed back with a steering note — this both kills a
        weak model's spiral and is the safe choice for a mutating duplicate.

        Outcome (async generators return no value — PEP 525) is written into the caller-supplied
        `outcome` holder: `outcome.suspended` (the turn parked on a confirm/question) and
        `outcome.made_progress` (False when every call was a suppressed repeat, so `_drive` can count a
        stall). Both are written synchronously as facts are determined; `_drive` reads them after the
        `async for` drains (not on the exception path — a cancel/error propagates first).

        **Per-call persistence (D40 §6):** ONE `tool` Message per invocation, created lazily on the
        FIRST resolved call and only `update()`d thereafter (idempotent by construction — the tail
        never `add()`s a duplicate). Each resolved call commits its tool-row upsert + the
        `assistant.update()` state-flip in ONE `Database.transaction()`, then yields its event. The
        `finally` tail is the BACKSTOP: on any exit it flushes the final assistant state + any
        resolved-but-unpersisted results to the SAME tool message — never a second row. This wave is
        still SERIAL (Wave 4 adds the parallel prefix); one slow call still holds the batch, but its
        result is now durable + on the wire the instant it resolves, not at step end (ACA-4).

        Generator discipline: the `finally` is await-only — it NEVER yields (a yield during
        `aclose()`/GeneratorExit unwind raises RuntimeError). `aclose()`/cancellation lands at a yield
        point; the finally backstop then runs to make the last flip/result durable before unwinding."""
        result_parts: list[ToolResultPart] = []
        #: The SINGLE `tool` Message for this invocation (D40 §6) — created lazily inside `_persist` on
        #: the first resolved call, then only `update()`d (consumer AND finally backstop). Held here so
        #: every later write targets the same row: create-once, update-thereafter, never a duplicate.
        tool_msg: Message | None = None

        async def _persist() -> None:
            """Commit the assistant state-flip + the single `tool` Message in ONE transaction, through
            the dual-shield helper (persist-before-emit). Create-once/update-after on `tool_msg`: the
            holder is assigned only AFTER the txn commits, so a rolled-back create leaves it `None` and
            the backstop re-attempts the `add()` rather than `update()`-ing a row that never landed."""

            async def _write() -> None:
                nonlocal tool_msg
                created: Message | None = None
                async with self._messages.db.transaction():
                    await self._messages.update(assistant)
                    if result_parts:
                        if tool_msg is None:
                            created = Message(
                                thread_id=thread.id,
                                role="tool",
                                actor=AGENT_ACTOR,
                                parts=list(result_parts),
                            )
                            await self._messages.add(created)
                        else:
                            tool_msg.parts = list(result_parts)
                            await self._messages.update(tool_msg)
                if created is not None:
                    tool_msg = created  # committed — later persists now UPDATE this row (never re-add)

            await self._persist_shielded(_write)

        answers = resume_answers or {}
        try:
            for cp in assistant.tool_calls():
                if cp.state in _RESOLVED:
                    continue  # already ran (resume: an earlier call in this step)

                # A2 resume: the owner answered a suspended `question` — inject their reply as this call's
                # result (the model reads it like any tool output) without re-running the tool. Mirrors
                # the `_DISMISS` injection below; the answer text rides in `output`.
                if cp.call_id in answers:
                    result = ToolResult(
                        state=RunState.OK, summary="the owner answered", output=answers[cp.call_id]
                    )
                    cp.state = RunState.OK
                    outcome.made_progress = True
                    result_parts.append(ToolResultPart(call_id=cp.call_id, result=result))
                    await _persist()  # persist-before-emit
                    yield AgentEvent(
                        "tool.result", {"callId": cp.call_id, "result": result.model_dump(mode="json")}
                    )
                    continue

                token = resume_tokens.get(cp.call_id)
                if token == _DISMISS:
                    # The owner reviewed the confirm/question bubble and rejected it. Record the call's
                    # signature so a fresh model re-issue of the identical call this drive gets the denial
                    # echo (below) instead of minting a new confirm bubble (the user-visible retry loop).
                    guard.denied_sigs.add(_LoopGuard.sig(cp.tool, cp.args))
                    if cp.tool == "question":
                        result: ToolResult = ToolResult(
                            state=RunState.DENIED,
                            summary="question declined by the owner",
                            output=(
                                "The owner chose not to answer this question. Do not re-ask it or "
                                "rephrase it. Proceed using your best judgment, or give the owner your "
                                "final answer."
                            ),
                        )
                    else:
                        result = ToolResult(
                            state=RunState.DENIED,
                            summary=f"{cp.tool} rejected by the owner — not run",
                            output=(
                                "The owner reviewed this tool call and REJECTED it. It was NOT run — "
                                "nothing happened. This is the owner's deliberate decision, not an "
                                "error: do not retry this call, and do not attempt the same action any "
                                "other way. If the rest of your task doesn't depend on it, continue "
                                "without it; otherwise stop and give the owner your final answer."
                            ),
                        )
                    outcome.made_progress = True
                else:
                    sig = _LoopGuard.sig(cp.tool, cp.args)
                    # Suppression guards apply only to fresh model calls, never a user-approved resume.
                    # C1a — exact-repeat: an identical (tool,args) call past the cap echoes the prior
                    # result + a steering note. C1c — per-tool cap: any one tool called too many times
                    # this turn (the catch-all for varied-arg spam) is refused with a steering note.
                    # A suppressed call is NOT counted as progress, so repeated suppression trips stall.
                    suppressed: ToolResult | None = None
                    if token is None:
                        if sig in guard.denied_sigs:
                            # Denial echo — the owner already rejected this exact call this drive (the
                            # `_DISMISS` branch above recorded it). A fresh re-issue is refused here rather
                            # than re-suspending on a new confirm bubble; like C1a/C1c it is NOT progress,
                            # so a persistent re-ask trips the stall guard. Checked FIRST so a denied call
                            # never re-suspends. (`token is None` keeps a user-approved resume exempt.)
                            suppressed = ToolResult(
                                state=RunState.DENIED,
                                summary=f"(already rejected) {cp.tool} — the owner rejected this call this turn",
                                output=(
                                    "The owner already rejected this exact call this turn. It was NOT "
                                    "run. Do not ask again — continue without it or give the owner your "
                                    "final answer."
                                ),
                            )
                        elif guard.counts.get(sig, 0) >= guard.max_repeat and sig in guard.last_results:
                            prior = guard.last_results[sig]
                            suppressed = ToolResult(
                                state=prior.state,
                                summary=f"(repeat suppressed) {prior.summary}",
                                output=(
                                    "You already ran this exact call. Do not repeat it — use the "
                                    "previous result, try a different approach, or give your final answer."
                                ),
                            )
                        elif guard.tool_counts.get(cp.tool, 0) >= guard.max_per_tool:
                            suppressed = ToolResult(
                                state=RunState.DENIED,
                                summary=f"(call limit) {cp.tool} used too many times this turn",
                                output=(
                                    f"You have already called {cp.tool} {guard.tool_counts.get(cp.tool, 0)} "
                                    "times this turn. Stop calling it — use what you have, switch to a "
                                    "different tool, or give the owner your final answer now."
                                ),
                            )
                    if suppressed is not None:
                        cp.state = suppressed.state
                        result_parts.append(ToolResultPart(call_id=cp.call_id, result=suppressed))
                        await _persist()  # persist-before-emit
                        yield AgentEvent(
                            "tool.result",
                            {"callId": cp.call_id, "result": suppressed.model_dump(mode="json")},
                        )
                        continue
                    if token is None:
                        guard.counts[sig] = guard.counts.get(sig, 0) + 1
                        guard.tool_counts[cp.tool] = guard.tool_counts.get(cp.tool, 0) + 1
                    if cp.invalid_raw is not None:
                        # ACA-13: the model's raw arguments weren't valid JSON. Don't invoke the tool with
                        # an erased `{}` (which steers it with a misleading "field required"). Hand it the
                        # raw blob back so it can repair the JSON. This counts toward the loop-guard caps
                        # exactly like a ValidationError above — the increments already ran, and the
                        # last-result / progress bookkeeping below runs on this synthesized result too.
                        # `invalid_raw` is already truncated (≤200 chars) at stamp time in `_drive`.
                        result = ToolResult(
                            state=RunState.ERROR,
                            summary=f"invalid arguments for {cp.tool}",
                            output=f"your tool arguments were not valid JSON: {cp.invalid_raw}",
                        )
                    else:
                        if token is not None and token != _DISMISS:
                            # A5 (C4-H1): on a confirmed RESUME (a real confirm token — not None for a
                            # fresh call, not `_DISMISS`), flip the persisted call AWAITING_CONFIRM →
                            # RUNNING and persist BEFORE invoking. Otherwise `cp.state` stays
                            # AWAITING_CONFIRM until `invoke` returns, so if the turn dies just AFTER the
                            # side effect (an audit-write raise, a Stop landing right after invoke), the
                            # shielded `finally` persists AWAITING_CONFIRM → the reconciler's
                            # suspend-exclusion SKIPS it → the bubble stays resumable → a second Allow
                            # REPEATS the side effect. The pre-invoke persist converts that death window
                            # into effect-unknown: the reconciler flips RUNNING → CANCELLED (never
                            # re-executable) and no AWAITING_* is left to protect it. One extra write per
                            # owner-confirmed action — negligible for a single-user panel.
                            cp.state = RunState.RUNNING
                            await self._messages.update(assistant)
                        try:
                            # `inv` — the invoke outcome (NOT the batch `outcome` holder above).
                            inv = await self._actions.invoke(
                                cp.tool,
                                cp.args,
                                actor=AGENT_ACTOR,
                                privilege=self._agent.privilege,
                                interactive=self._interactive,
                                confirm_token=token,
                                depth=self._depth,
                                agent=self._agent,
                            )
                        except UnknownTool:
                            result = ToolResult(state=RunState.DENIED, summary=f"unknown tool '{cp.tool}'")
                        except ValidationError as exc:
                            result = ToolResult(
                                state=RunState.ERROR,
                                summary=f"invalid arguments for {cp.tool}",
                                error=str(exc)[:300],
                            )
                        else:
                            if inv.needs_confirm and not self._interactive:
                                # Headless child (subagent): no UI to confirm against → deny in place so
                                # the turn never stalls (DESIGN §5.3). The child reports it skipped the step.
                                result = ToolResult(
                                    state=RunState.DENIED,
                                    summary=f"{cp.tool} needs confirmation — skipped (headless subagent)",
                                )
                            elif inv.needs_confirm:
                                cp.state = RunState.AWAITING_CONFIRM
                                spec = self._actions.registry.get(cp.tool).spec
                                await _persist()  # persist the AWAITING_CONFIRM flip BEFORE emitting
                                outcome.suspended = True
                                yield AgentEvent(
                                    "tool.permission",
                                    {
                                        "callId": cp.call_id,
                                        "tool": cp.tool,
                                        "title": spec.title,
                                        "args": cp.args,
                                        "risk": spec.risk.value,
                                        "token": inv.confirm_token,
                                        "prompt": inv.confirm_prompt,
                                    },
                                )
                                break
                            else:
                                result = inv.result or ToolResult(
                                    state=RunState.ERROR, summary=f"{cp.tool} returned no result"
                                )

                    # A2 — the `question` builtin signals AWAITING_ANSWER to suspend the turn and ask the
                    # owner. Mirrors the confirm suspend above: persist the call, emit `tool.question`,
                    # stop — resumed with the answer injected (top of this loop). A headless subagent has
                    # no one to ask, so (like a headless confirm) it's denied in place and the child carries on.
                    if result.state == RunState.AWAITING_ANSWER:
                        if not self._interactive:
                            result = ToolResult(
                                state=RunState.DENIED,
                                summary=f"{cp.tool}: cannot ask the owner — headless subagent",
                            )
                        else:
                            cp.state = RunState.AWAITING_ANSWER
                            await _persist()  # persist the AWAITING_ANSWER flip BEFORE emitting
                            outcome.suspended = True
                            yield AgentEvent(
                                "tool.question",
                                {
                                    "callId": cp.call_id,
                                    "tool": cp.tool,
                                    "question": result.summary,
                                    "args": cp.args,
                                },
                            )
                            break

                cp.state = result.state
                if token != _DISMISS:  # a real execution
                    guard.last_results[sig] = result  # remember for exact-arg suppression (C1a)
                    # Progress only if this (call, outcome) pair is *new* this turn — the SAME call
                    # re-returning the SAME result is spinning and should NOT reset stall (ACA-12;
                    # the varied-arg spiral is the per-tool cap C1c's job now).
                    rsig = _LoopGuard.result_sig(sig, result)
                    if rsig not in guard.seen_results:
                        guard.seen_results.add(rsig)
                        outcome.made_progress = True
                result_parts.append(ToolResultPart(call_id=cp.call_id, result=result))
                await _persist()  # persist-before-emit
                yield AgentEvent(
                    "tool.result",
                    {"callId": cp.call_id, "result": result.model_dump(mode="json")},
                )

        finally:
            # BACKSTOP persistence tail (ACA-1 scenario 2 + D38; hardened per audit C3-H1). With D40
            # per-call persistence the consumer already committed each resolved call's flip+result as it
            # went — so on the NORMAL path this re-flushes identical state (idempotent `update()` to the
            # SAME `tool_msg` — never a duplicate row). Its real job is the EARLY-EXIT path: a cancel/
            # error interrupting the batch (inside `invoke` for a later call, or an `aclose()`/
            # GeneratorExit landing at a yield) must still leave the completed calls' resolved states +
            # `result_parts` durable, while the in-flight call keeps its unresolved state (`_assemble`
            # synthesizes "not executed"; A11's `cancelled` marker is the reconciler's). `_persist` runs
            # through `_persist_shielded`, so the SAME dual-shield + swallow-only-while-unwinding rule
            # covers this write: standalone (normal-path) failure raises; failure during unwind is
            # logged + swallowed so it never replaces the in-flight cancel/error. This is await-only —
            # a generator NEVER yields during a GeneratorExit unwind (RuntimeError otherwise).
            await _persist()
        return


def _parse_args(raw: str) -> tuple[dict, str | None]:
    """Parse the model's raw tool-call arguments JSON. Returns `(args, invalid)`:

    - a valid JSON **object** → `(parsed, None)` — behaves exactly as before.
    - an empty/whitespace-only string → `({}, None)`: models legitimately emit `""` for a
      zero-arg tool call, so it takes the old silent-`{}` path — a no-arg tool just runs, and a
      tool with required fields gets the *schema* validation error, which steers better than a
      JSON-repair message with an empty snippet ever could.
    - a malformed blob → `({}, raw)`. Malformed is a `json.JSONDecodeError` (`{not json`) or a
      non-object top level (`[1,2]`, `"x"`, `42`). `args` is `{}` so the ToolCallPart persists
      cleanly (no raw invalid blob written into `parts`), while `invalid` carries the raw blob so
      `_run_calls` can synthesize an ERROR result steering the model to repair its JSON (ACA-13) —
      better than erasing to `{}` and letting schema validation emit a misleading "field required"
      (weak local models repair malformed JSON better than they guess a schema)."""
    if not raw or not raw.strip():
        return {}, None
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        return {}, raw
    if isinstance(parsed, dict):
        return parsed, None
    return {}, raw
