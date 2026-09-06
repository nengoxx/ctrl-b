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
    tool.permission  {callId, tool, args, risk, token, prompt, alwaysEligible}   # confirm bubble (D44)
    tool.question    {callId, tool, question, args}   # A2: `question` builtin asks the owner (answer bubble)
    tool.result      {callId, result}         # bubble resolves
    compaction       {removed, summaryId, truncated}   # older turns folded into a summary (4e)
    steer.applied    {entryId, messageId, kind, text?}   # a mid-turn steer drained at the loop top (D41)
    notice           {text}                    # breadcrumb (e.g. ACA-11 compaction)
    inference.retry  {endpoint, attempt, max, delaySeconds, category}  # a transient same-endpoint retry (D43)
    inference.failover {from, to, category}    # the chain dropped to the next endpoint (D43)
    message.end      {messageId, source?, usage?}   # D62 serve attribution (who served + call cost)
    error            {message, retryable}
    done             {threadId, state}        # completed | suspended | capped | error
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import sys
import uuid
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, AsyncIterator, Awaitable, Callable, Literal

import anyio
from pydantic import ValidationError

from app.adapters.inference import (
    FailoverNotice,
    InferenceClient,
    InferenceError,
    RetryNotice,
    StreamReport,
    image_part,
    is_context_overflow,
)
from app.config import Settings
from app.core.attachments import StoredReadError
from app.core.media import StoreWriteError
from app.core.memory import MemoryProvider
from app.core.permissions import Decision, decide
from app.core.skills import SkillProvider, SkillSelector
from app.core.tool import UnknownTool
from app.domain.agent import AgentDef, ModelRef
from app.domain.automation import QuestionPolicy
from app.domain.conversation import (
    AttachmentPart,
    CallUsage,
    ErrorPart,
    Message,
    Part,
    ReasoningPart,
    SourceInfo,
    TextPart,
    Thread,
    ToolCallPart,
    ToolResultPart,
)
from app.domain.enums import Actor, RunState
from app.domain.event import ORIGIN_USER_CHAT, Origin
from app.domain.provider import ResolvedTarget
from app.domain.result import ToolResult
from app.runtime import grant_approval
from app.services.action_service import ActionService, InvokeOutcome
from app.services.agent.attachments import (
    ATTACHMENT_ONLY_TEXT,
    claim_attachments,
    dimensions_notice,
    document_stub,
    image_stub,
    read_data_url,
    read_pdf_page,
    read_text_page,
    render_inline,
)
from app.services.agent.compaction import (
    OUTPUT_CLEARED_PLACEHOLDER,
    ClearingPlan,
    CompactionState,
    Compactor,
    ContextEstimate,
    ContextEstimator,
    estimate_payload_tokens,
    plan_clearing,
    turn_start_index,
)
from app.services.agent.core_memory import CORE_MEMORY_TOOL, CoreMemoryCorpus, RecallState
from app.services.agent.core_memory_tool import RECALL_RECEIPT, is_recall_call
from app.services.agent.exec import run_user_exec
from app.services.agent.macros import Macros, consumes_original, macros_for
from app.services.agent.prompts import resolve
from app.services.agent.routing import RoutingState
from app.services.agent.skills import available_skills, narrow_tools, resolve_skills, skills_prompt
from app.services.conversation import MessageRepo, ThreadRepo

if TYPE_CHECKING:
    from fastapi import FastAPI

    from app.services.agent.steering import SteerEntry, SteerSource

log = logging.getLogger(__name__)

#: The durable suspend states (D43) — a tool call in one of these parked the turn on the owner. The
#: per-call route-snapshot recording + the fresh-turn sweep both filter on these (mirrors turns.py's
#: `_SUSPEND_CALL_STATES`, kept local so the routing sweep never couples the session to that module).
_SUSPEND_CALL_STATES = (RunState.AWAITING_CONFIRM, RunState.AWAITING_ANSWER)

#: The informational outcome of a manual `/compact` that found nothing worth folding — the thread is
#: too small (no clean turn boundary, or a head so small a summary wouldn't shrink it). A benign no-op,
#: phrased so the composer reads it as "nothing to do" rather than a failure (A5-x, v1.3.1).
COMPACT_TOO_SMALL = "thread too small to compact — nothing to do"

#: The baked VOICE default — the last rung of the Class-A persona chain (SOUL.md →
#: `inference.system_prompt` → this) and the text the `default-prompt` endpoint serves + a new
#: agent's SOUL.md is scaffolded with.
#:
#: **D70 shrank it to the identity half.** It used to fuse identity and tool discipline into one
#: constant that SOUL.md then *replaced* wholesale — the exact failure R64 §5.4 measured (a
#: specialist persona silently costing the agent every technical instruction it had). The
#: discipline half now lives in the `duties_agent` registry prompt and rides the head's second
#: section for EVERY agent, persona or not (ROLEPLAY_PLAN §4.1, P3).
DEFAULT_SYSTEM_PROMPT = (
    "You are ctrl-b, a concise assistant embedded in a single-user homelab control panel. "
    "You help the owner wake, monitor, and manage a small fleet of PCs over their tailnet/LAN."
)

#: `AgentDef.duties` → the registry id of the text that rides the head's Duties section (§4.1,
#: ruling 5). A map rather than an f-string: the ids are registry keys, so the set of legal duties
#: values and the prompts that back them are stated in one place.
_DUTIES_PROMPTS = {"agent": "duties_agent", "conversational": "duties_conversational"}

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
    the live `notices` breadcrumbs (D18 failover, ACA-11 compaction — never persisted, so buffered
    consumers would otherwise miss them), and — when the turn suspended — the `permission` (which
    **carries the confirm token+prompt**, the one thing not persisted, required for a buffered confirm
    to be resumable) or `question` event, or the `error`. The endpoint merges `{threadId, title}` on
    top."""
    out: dict = {"state": "completed", "notices": []}
    async for ev in events:
        if ev.event in ("message.start", "message.end"):
            out["messageId"] = ev.data.get("messageId")
        elif ev.event == "tool.permission":
            out["permission"] = ev.data
        elif ev.event == "tool.question":
            out["question"] = ev.data
        elif ev.event == "notice":
            # Live breadcrumbs (ACA-11 "compacting…"): buffered-mode consumers get the text too (the
            # TurnAccumulator deliberately does NOT fold notices — turns.py untouched).
            out["notices"].append(ev.data.get("text", ""))
        elif ev.event == "inference.retry":
            # D43/A6 Wave 2 buffered parity: no live surface in buffered mode (D40 pattern), so render
            # the typed retry event as a `// …` notice line in the house voice.
            d = ev.data
            out["notices"].append(
                f"// retrying {d.get('endpoint')} in {d.get('delaySeconds', 0):g}s "
                f"(attempt {d.get('attempt')}/{d.get('max')} — {d.get('category')})"
            )
        elif ev.event == "inference.failover":
            d = ev.data
            out["notices"].append(f"// failover → {d.get('to')} ({d.get('category')})")
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
    #: Per-tool REPLACEMENTS of `max_per_tool` (D60 ②, `tool_overrides.<tool>.max_calls`) — absent
    #: means the blanket cap, present means that number for that tool. Snapshotted per turn from the
    #: live settings at `_drive` entry, like every other per-turn limit.
    per_tool_max: dict[str, int] = field(default_factory=dict)
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

    def cap_for(self, tool: str) -> int:
        """This tool's per-turn call cap: its `tool_overrides.<tool>.max_calls` REPLACEMENT when the
        owner set one, else the agent's blanket `max_calls_per_tool` (D60 ②, §15b-9)."""
        return self.per_tool_max.get(tool, self.max_per_tool)

    @staticmethod
    def uncapped(tool: str, args: dict) -> bool:
        """Is this call exempt from the per-tool cap entirely (D60 ②)? Today: `core_memory`
        READ-class calls, which the per-turn recall budget bounds instead — one counter funding reads
        AND writes is what stopped a merge turn from writing what it had just read (§14d). The
        classification itself lives on the tool (`is_recall_call`), never re-derived here."""
        return is_recall_call(tool, args)

    @staticmethod
    def result_sig(sig: str, result: ToolResult) -> str:
        """Call-scoped progress key (ACA-12): the exact-call signature (`sig(tool, args)`, the same
        canonical string C1a uses for repeat suppression) + the full outcome. Scoping by the call means
        two *different* calls returning identical text (two `ping`s both "ok") no longer collide into
        one "no-progress" bucket, while the SAME call returning the SAME result still repeats its key
        and trips the stall guard.

        This sig is ONLY a fidelity aid for the stall heuristic — it exists to avoid *false* progress
        collisions, not to bound a spiral. The **per-tool cap (C1c) is the AUTHORITATIVE spiral bound**
        (ACA-12 stance): a tool whose output flaps every call (a timestamp, a counter) makes every
        `result_sig` distinct, so the stall guard reads "progress" forever — the per-tool cap, which
        counts dispatches regardless of args or output, is what actually terminates it. `error` is
        folded in (empty-string when `None`) and the full `output` is hashed (sha256 hex over the raw
        bytes; empty output → the hash of `b""`) so a difference anywhere in the result — not just the
        first 300 chars — mints a distinct key without unbounded key growth (C1-L5 fidelity fix)."""
        out_hash = hashlib.sha256((result.output or "").encode("utf-8")).hexdigest()
        return f"{sig}|{result.state.value}|{result.summary}|{result.error or ''}|{out_hash}"


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


@dataclass
class _BackstopOutcome:
    """Mutable holder for the reactive backstop's shared force-compaction step (D42 Codex FIX 2). Async
    generators return no value (PEP 525), so `_overflow_fold` writes whether it actually FOLDED here:
    `folded=True` ⇒ the caller re-assembles + re-issues the SAME model call into the SAME assistant
    slot; a reject / nothing-to-fold leaves it `False` ⇒ the caller falls to its error path."""

    folded: bool = False


def _tool_content(result: ToolResult, *, cleared: bool = False) -> str:
    """Render a ToolResult as the `content` of an OpenAI `tool` message — what the model reads to
    reason about the outcome. Concise; `output` is already redacted + truncated upstream. `cleared`
    (D42 Tier 1) replaces ONLY the OUTPUT payload with `OUTPUT_CLEARED_PLACEHOLDER` — the `[state]
    summary` line + any error survive — an assembly-time transform (the DB row stays verbatim, A12)."""
    body = f"[{result.state.value}] {result.summary}"
    if cleared:
        body += f"\n{OUTPUT_CLEARED_PLACEHOLDER}"
    elif result.output:
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


def _control_event(item: RetryNotice | FailoverNotice) -> AgentEvent:
    """Map one typed `stream_chat` control item to its AgentEvent (D43/A6 Wave 2). ONE home for both
    consumers (`_drive` + `_finalize` — review F9) so the wire payload is byte-identical at each site:
    a `RetryNotice` → `inference.retry {endpoint, attempt, max, delaySeconds, category}`; a
    `FailoverNotice` → `inference.failover {from, to, category}`. The caller yields this ABOVE the delta
    checks and `continue`s, never touching `streamed_any`/the text buffers (the D42 nothing-streamed
    backstop stays honest)."""
    if isinstance(item, RetryNotice):
        return AgentEvent(
            "inference.retry",
            {
                "endpoint": item.endpoint,
                "attempt": item.attempt,
                "max": item.max_attempts,
                "delaySeconds": item.delay_s,
                "category": item.category,
            },
        )
    return AgentEvent(
        "inference.failover",
        {"from": item.from_endpoint, "to": item.to_endpoint, "category": item.category},
    )


def _message_end(assistant: Message) -> AgentEvent:
    """`message.end` + the D62 per-message serve attribution. ONE home for all three emit sites (the
    text-only completion, the tool-call step, the wrap-up call) so the live payload can't drift
    between them — and so it carries EXACTLY what the thread-reload path serves for the same message
    (`Message.model_dump`), which is what lets the FE render a live bubble and a reloaded one
    identically. `served`/`degraded` are unknown at `message.start`, so this is the only place they
    can ride. Both keys are omitted when the call produced no such fact (a pre-D62 row reloads the
    same way), so the payload of a turn with nothing to attribute is byte-identical to before."""
    data: dict = {"messageId": assistant.id}
    if assistant.source is not None:
        data["source"] = assistant.source.model_dump(mode="json")
    if assistant.usage is not None:
        data["usage"] = assistant.usage.model_dump(mode="json")
    return AgentEvent("message.end", data)


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
        core_memory: CoreMemoryCorpus | None = None,
        interactive: bool = True,
        depth: int = 0,
        steer_source: SteerSource | None = None,
        compaction_state: CompactionState | None = None,
        routing_state: RoutingState | None = None,
        origin: Origin = ORIGIN_USER_CHAT,
        message_actor: Actor = Actor.USER,
        question_policy: QuestionPolicy = "skip",
    ) -> None:
        self._threads = threads
        self._messages = messages
        self._inference = inference
        self._settings = settings
        self._actions = actions
        #: The injected peek/commit view over this thread's steer queue (D41 Drain A). `None` for
        #: subagent sessions (children are never steered) + any non-thread call site — the drain at the
        #: `_drive` loop top is skipped entirely then. The session never touches `app.state.steer_queues`
        #: directly (registry-ignorant); the API layer builds this via `steer_source_for`.
        self._steer_source = steer_source
        #: The agent definition driving this turn (D11). Resolved by the caller from the thread's
        #: `agent` field; `None` falls back to the built-in default so older call sites still work.
        self._agent = agent or settings.default_agent_def()
        self._skills = skills
        self._selector = selector
        #: File-based agent memory (7e-d). `None` (unprovided) → no memory block, so older call
        #: sites + the subsystem-off case behave exactly as before.
        self._memory = memory
        #: The tier-2 long-term corpus (D57, CORE_MEMORY_PLAN §4) — a SIBLING of `memory`, passed
        #: directly like it rather than reached for through `Deps` (§6, council M5). `None`
        #: (unprovided) → no index block, so older call sites + the off-by-default case behave
        #: exactly as before; the corpus itself is inert until `memory.longterm.backend` is set.
        self._core_memory = core_memory
        #: Tool names suppressed for this whole turn because the FEATURE behind them is off (D57 §6,
        #: council M5 — the schema half of the two-layer gate). Computed ONCE here, at turn setup, and
        #: passed at BOTH `for_agent` consumers (`_tools` and `_tool_allowed`), so the schemas the
        #: model is offered and the names the loop will run can never disagree. Registry specs are
        #: untouched, so nothing here fights `tool_overrides`.
        self._hidden_tools: frozenset[str] = (
            frozenset()
            if (core_memory is not None and core_memory.enabled())
            else frozenset({CORE_MEMORY_TOOL})
        )
        #: This LOGICAL turn's Core Memory read state (D57 §4, council Codex-11; D64 §2.2) — the
        #: recall budget AND the per-topic coverage a `delete` is minted from — threaded to every tool
        #: invocation like `_stamps`. Fresh per session, and a session built to resume a suspended
        #: turn re-SEEDS both from that turn's persisted recall results (`_seed_recall`), so a confirm
        #: round-trip cannot hand the model a second full allowance nor a second right to destroy.
        self._recall = RecallState()
        #: Headless subagents (4.5) run with `interactive=False`: a confirm-gated call resolves
        #: DENIED in place rather than suspending the turn (a child has no UI to confirm against —
        #: DESIGN §5.3). `depth` is this session's subagent nesting level, forwarded to each tool
        #: invocation so a child's `spawn_subagents` sees depth+1.
        self._interactive = interactive
        self._depth = depth
        #: Who set this whole turn in motion (D49 / AUTOMATIONS_PLAN §D-4), stamped on every action
        #: this loop invokes. The interactive builders pass the chat default explicitly; a subagent
        #: session is built with `kind="subagent"` (its parent's `run_id` preserved) by `run_subagent`;
        #: an automation run is built with `kind="automation"` + its run id (§D-3).
        self._origin = origin
        #: Who the INJECTED prompt message is attributed to (§D-3). `run_turn` used to hardcode
        #: `Actor.USER`, which is true for every interactive path and a lie for an automation: nobody
        #: typed it. An automation session passes `Actor.AUTOMATION`, so the UI can badge the turn and
        #: the history reads honestly; the default keeps every existing caller byte-identical.
        self._message_actor = message_actor
        #: What an UNATTENDED run does when the model calls `question` (§D-3, owner ruling 1). Only ever
        #: consulted on the headless path (an interactive session suspends and asks), so the `skip`
        #: default IS today's behavior — subagents keep denying in place. An automation may pass
        #: `use_default`, which resolves an answer and lets the run continue.
        self._question_policy = question_policy
        # Context-window settings are per-agent (4.5): the AgentDef's `compaction` wins, else the
        # global default. A subagent inherits the parent's effective value (resolved at spawn).
        self._compaction_cfg = self._agent.compaction or settings.agent.compaction
        self._compactor = Compactor(inference, messages, self._compaction_cfg, settings)
        #: The injected per-thread thrash-machine view (D42 Wave 3), like `steer_source` — `None` for
        #: subagent sessions + non-thread call sites (their auto-compaction never latches a breaker).
        #: The Compactor stays STATELESS; the session reads/writes this off `compact()`'s outcome.
        self._compaction_state = compaction_state
        #: The injected per-thread failure-fallback routing view (D43/A4, the CompactionState
        #: precedent) — `None` for subagent sessions + non-thread call sites, which makes routing
        #: RUNTIME-INERT (the `_drive` decision falls straight to `agent.model`, today's behavior).
        #: The state MACHINE (the reads/writes at the loop's terminals) lives in `_drive`; this is just
        #: the injected holder.
        self._routing_state = routing_state
        #: The effective routing cfg for this agent (D43). `AgentDef.routing` already carries the
        #: `agent.defaults.routing` global default (baked in at config-build via deep_merge; there is
        #: NO `Settings.agent.routing` — the D16 divergence from compaction's dual home). `None` ⇒
        #: routing is off for this agent (the decision short-circuits to the worker model).
        self._routing_cfg = self._agent.routing
        #: Session-held anchored context estimator (D42 Wave 2). The Compactor stays STATELESS — this
        #: holds the telemetry anchor + watermark that price the window-aware trigger, invalidated on a
        #: fold / served-endpoint change / degraded telemetry. Fresh per turn (session is per-turn), so
        #: no anchor leaks across turns; iteration 1 always runs in heuristic+overhead mode.
        #: …and it carries the live `attachments:` prices (D68 §4.1 H3), because the session is where
        #: `Settings` lives: the estimator does the arithmetic, the session hands it the knobs.
        self._estimator = ContextEstimator(settings.attachments)
        #: Per-turn skill state (4.5), set by `_activate_skills` at the start of run_turn. The
        #: effective tool allowlist defaults to the agent's; active skills may narrow it.
        self._skills_note: str | None = None
        self._tool_allow: list[str] | str = self._agent.tools
        #: The ids of the skills active this turn (M2/C-12) — the selector's picks included, not just
        #: the `/skill-name` invocations the client asked for. Rides every suspend event, so the
        #: server-owned turn snapshot (and the terminal-linger record behind it) can hand the exact set
        #: back on resume instead of trusting whatever the client still remembers.
        self._active_skills: list[str] = []
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
        #: The turn's PROMPT STAMPS (Phase 18 / C-8): `{registry id: template hash}`, accumulated by
        #: every `resolve(..., stamps=self._stamps)` this session or its collaborators (the memory
        #: block, the skills note) performs. CUMULATIVE and TURN-SCOPED by design — never cleared
        #: between iterations — because that IS the payload: a C2 steering text resolved at iteration
        #: N persists as a tool result and stays in every later call's context. Each assistant message
        #: snapshots it at persist time (`_persist_assistant`), so an owner edit mid-turn shows as the
        #: new hash on the message it fed and the old hash on the earlier one (C-17). Per-turn like the
        #: caches above (the session is per-turn); a subagent has its own session and its own set.
        #:
        #: Two known edges, both accepted rather than engineered around (the run-level aggregate an
        #: eval reads is a UNION over the thread's messages, which is unchanged by either):
        #:   * OVER-REPORT: the reflection nudge is an EPHEMERAL tail layer — emitted into exactly one
        #:     call — but its stamp stays in the set for the rest of the turn.
        #:   * UNDER-REPORT: a stamp recorded before a suspend is absent from the messages of the
        #:     resumed half, because a resume builds a FRESH session (ACA-15e). The steering text
        #:     itself is in the transcript as a persisted tool result either way.
        self._stamps: dict[str, str] = {}
        #: Per-turn cache of the WIRE form of each attachment, keyed by its store path (D68 §4.1,
        #: council E5): an image's `data:` URL, a text file's framed page. `_assemble` runs once per
        #: loop iteration and would otherwise re-read and re-base64 tens of megabytes on every model
        #: call. Plain and strong (no revision key) because a claimed attachment is IMMUTABLE — see
        #: `_attachment_wire` — and per-turn like the caches above, so it needs no eviction.
        self._attachment_cache: dict[str, str] = {}

    def _macros(self) -> Macros:
        """This agent's `{{char}}`/`{{user}}` vocabulary (§4.3). Projected from the AgentDef +
        settings the turn already holds fixed, so it is rebuilt rather than cached."""
        return macros_for(self._agent, self._settings)

    def _section(self, heading_id: str, body: str) -> str:
        """One `## `-labelled head section: the registry-owned heading, then the body (L-8 — an
        override reframes the section, it can never drop the text underneath)."""
        return resolve(heading_id, self._settings, stamps=self._stamps) + "\n" + body

    def _voice(self) -> str:
        """The VOICE — who the agent is. The Class-A chain is unchanged in mechanism: the agent's own
        prompt (SOUL.md) wins, then the global `inference.system_prompt`, then the baked default.

        Its MEANING shifted with D70 (§4.1, Emma F13, recorded): `inference.system_prompt` used to
        replace the whole fused prompt, and is now the fallback VOICE only — the selected duties text
        is appended after it. An existing override that already carries tool discipline therefore
        sees that discipline stated twice until the owner trims it. No compatibility branch (the
        no-legacy-seams rule)."""
        return (
            self._agent.prompt.strip()
            or self._settings.inference.system_prompt.strip()
            or DEFAULT_SYSTEM_PROMPT
        )

    def _duties(self) -> str:
        """The DUTIES text this agent runs under — `duties_agent` or `duties_conversational`, chosen
        by `AgentDef.duties` (ruling 5). Never a capability lever (ruling 16): both texts assume
        whatever toolset the agent was granted."""
        return resolve(_DUTIES_PROMPTS[self._agent.duties], self._settings, stamps=self._stamps)

    def _no_card_head(self) -> str:
        """What `{{original}}` stands for in a persona text (§4.1): the head this chain would have
        produced WITHOUT this agent's own persona — the no-card Voice (`inference.system_prompt`
        when the owner configured one, else the baked default: a configured fallback override IS
        the no-card Voice, the baked text is only the last rung) plus the whole Duties section it
        consumes.

        It carries the Duties HEADING but not a second Voice heading: the substitution lands INSIDE
        the head's Voice section, which is already labelled, so re-labelling there would print
        `## Voice` twice and leave the head with three headings instead of §4.1's two.

        Rendered with `original=""` so a fallback override that itself contains the token cannot
        leave a literal `{{original}}` sitting in the head (`safe_substitute` makes one pass and
        never re-scans what it substituted)."""
        voice = self._macros().render(self._settings.inference.system_prompt.strip() or DEFAULT_SYSTEM_PROMPT)
        return voice + "\n\n" + self._section("duties_heading", self._duties())

    def _system_prompt(self) -> str:
        """The ONE leading system message: the Voice section, then the Duties section (D70 §4.1).

        Universal — every agent gets both, persona or not (P3). The two `## `-labelled sections are
        R64 §5.4's measured shape (+0.052 on a roleplay-plus-tools benchmark, where naive persona
        prompting bought +0.004); the labels themselves are registry framings, never literals here.

        `{{original}}` in the persona CONSUMES the separate Duties emission: the substituted no-card
        head already carries a Duties section, and stating it twice is what an author asking for
        "the original prompt, plus this" never meant. The head still ends up with exactly the two
        labelled sections either way."""
        source = self._voice()
        embeds_head = consumes_original(source)
        voice = self._macros().render(source, original=self._no_card_head() if embeds_head else "")
        sections = [self._section("voice_heading", voice)]
        if not embeds_head:
            sections.append(self._section("duties_heading", self._duties()))
        return "\n\n".join(sections)

    def _scenario(self) -> str | None:
        """The agent's scenario as its own head block (§4.2) — as static as the prompt, so it sits
        with the head rather than at the tail. Macro-substituted; empty ⇒ absent (ruling 10) —
        including a field that only becomes empty once its macros render (a lone `{{original}}`)."""
        text = self._macros().render(self._agent.scenario.strip()).strip()
        return text or None

    def _persona_block(self) -> str | None:
        """The OWNER's persona block (§3.2/§4.2), injected after the roster when
        `roleplay.persona.description` is non-empty — the same block for every agent, because it
        describes the owner rather than any one character. The registry framing, then the owner's
        text (L-8). Empty ⇒ absent."""
        description = self._settings.roleplay.persona.description.strip()
        if not description:
            return None
        return resolve("persona_intro", self._settings, stamps=self._stamps) + "\n\n" + description

    def _post_history(self) -> str | None:
        """The agent's post-history instructions (§4.2) — the operational last word, emitted AFTER
        the history where recency makes it bite (R64 §3). Macro-substituted, with `{{original}}`
        standing for ctrl-b's own default post-history text, which is empty: the token renders as
        nothing here and never drags the Duties section down to the tail. Empty ⇒ absent."""
        text = self._macros().render(self._agent.post_history.strip()).strip()
        return text or None

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
        return self._memory.load_context(self._agent, self._stamps, self._longterm_available()) or None

    def _longterm_available(self) -> bool:
        """Whether tier 2's `core_memory` tool is in THIS turn's effective schema (D57 §4b-2/§4b-5).

        The turn-level answer, which only the session has: `_tool_allowed` computes it from
        `for_agent(self._tool_allow, self._hidden_tools)`, so the disabled-feature hidden set (which
        already folds in `enabled()`) and a skill's per-turn narrowing are both accounted for — and
        the answer therefore matches exactly what the model was offered. Every tier-1 surface that
        rewords itself around tier 2 asks THIS, so none of them can advertise a tool this turn does
        not carry."""
        return self._core_memory is not None and self._tool_allowed(CORE_MEMORY_TOOL)

    def _core_index_block(self) -> str | None:
        """The tier-2 index block (D57, CORE_MEMORY_PLAN §4), injected as its own `system` message
        right after the tier-1 memory block. `None` when no corpus is wired, when the slot is off, or
        when there is nothing to route — off means NO prompt text at all (acceptance family 5), which
        is why the policy framing is resolved only once an index exists.

        Only the bounded INDEX rides the head; topic bodies arrive as ordinary tool results (S3). The
        corpus gates on `enabled()` and caches the render behind its scan signature itself, so this is
        a stat sweep on an unchanged corpus — nothing here re-implements any of that."""
        if self._core_memory is None:
            return None
        index = self._core_memory.render_index()
        if not index:
            return None
        # The registry frame + the rendered index concatenated (L-8): an override reframes the block,
        # it can never drop the routing data underneath.
        return resolve("core_memory_policy", self._settings, stamps=self._stamps) + "\n\n" + index

    def _reflection_nudge(self) -> str:
        """The one-shot periodic-reflection prompt (D27-C). Saving runs the normal `memory` tool path
        (auto_write on → saved; off → proposed for the owner's approval), so the nudge only steers —
        it never writes. The `state` clause appears only when that store is enabled."""
        cfg = self._settings.memory
        # No conditionals in templates (§2.3): the gated sentence is precomputed here and passed as an
        # ordinary value, empty when the store is off. Same shape for the tier-2 routing sentence
        # (D57 §4b-5) — with a durable shared tier available, a nudge that sends every lasting fact to
        # tier 1 sends it to the store that gets trimmed first.
        state_clause = (
            " Also update your `state` (action `set`) if how you feel has shifted."
            if cfg.state_enabled
            else ""
        )
        longterm = (
            " Durable, shared knowledge belongs in `core_memory` instead."
            if self._longterm_available()
            else ""
        )
        return resolve(
            "reflection_nudge",
            self._settings,
            {
                "reflection_interval": str(cfg.reflection_interval),
                "state_clause": state_clause,
                "longterm": longterm,
            },
            stamps=self._stamps,
        )

    def _roster(self) -> str | None:
        """A compact id↔name map of the fleet + services, injected each turn so the agent resolves
        a display name to the stable slug `host_id`/`service_id` a tool needs — instead of asking
        the owner for it. Projected straight from config (no live probe); ids are stable slugs."""
        hosts = self._settings.hosts()
        services = self._settings.services()
        if not hosts and not services:
            return None
        # The heading is the `fleet_roster` registry prompt; the rows below are this feature's data,
        # concatenated after it (L-8) — an override reframes the map, it cannot drop hosts.
        lines = [resolve("fleet_roster", self._settings, stamps=self._stamps)]
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
                self._actions.registry.for_agent(self._tool_allow, self._hidden_tools)
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
        self._active_skills = []
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
        self._skills_note = skills_prompt(active, self._settings, self._stamps)
        self._tool_allow = narrow_tools(active, self._agent.tools)
        self._active_skills = [s.name for s in active]  # M2/C-12 — captured right after selection

    def _static_prefix(self) -> list[dict]:
        """The INVARIANT system head for this turn — the Voice/Duties message + the scenario +
        appends + fleet roster + the owner's persona + durable-memory block + core-memory index +
        active-skill note, in that fixed order (7e-a/7e-d/D15 #4, AMENDED 2026-07-20: memory moved
        AFTER the roster; D57: the tier-2 index joins it; D70: the two character blocks join it —
        the scenario with the persona it belongs to, the owner's persona with the roster, both
        config/AgentDef-projected and as static as their neighbours). Every prefix cache — llama.cpp
        KV, cloud prefix — invalidates from the first
        changed byte ONWARD, and the two memory blocks are the only ones here that routinely change
        across a session's turns (a `memory`-tool write; an index-affecting corpus write or edit); the
        roster is config-projected and ~static. Keeping both last-among-stable-blocks, and adjacent,
        means either write re-prefills only from there on — plus the skills note, which changes per
        turn anyway — instead of also evicting the roster (A9; the Hermes volatile-block-after-
        breakpoint precedent, extended in CORE_MEMORY_PLAN §4). Built ONCE per turn and reused
        byte-identically every loop iteration so the cache prefix stays stable (see the `_static_head`
        field note). The reflection nudge is deliberately NOT here — it's an ephemeral tail layer
        appended in `_assemble`, so it never perturbs this cached head.

        Turn-invariant WITHIN ONE UNINTERRUPTED TURN: the system prompt / appends / roster project
        from per-turn-stable config + AgentDef, `_skills_note` is fixed at turn start by
        `_activate_skills`, and both memory blocks are read ONCE here — so a mid-turn `memory`- or
        `core_memory`-tool write does NOT land on the next loop iteration, which is what keeps the
        prefix byte-stable across iterations (the model sees that write in its own tool result). It is
        NOT frozen across a suspend/resume, though (ACA-15e): a confirm/question resume builds a
        **new** `AgentSession`, whose `_static_prefix` re-reads the memory files and re-renders the
        index — so an index-affecting write made before the suspend surfaces in the resumed half's
        head (a body-only topic edit leaves the rendered index, and so the head, unchanged), and the
        prefix re-prefills from the memory block onward. Behaviourally harmless; a full per-session
        freeze is A9."""
        if self._static_head is None:
            head: list[dict] = [{"role": "system", "content": self._system_prompt()}]
            scenario = self._scenario()  # the scene, with the persona it belongs to (D70 §4.2)
            if scenario:
                head.append({"role": "system", "content": scenario})
            for extra in self._appends():  # additive guidance, base-first (7e-a)
                head.append({"role": "system", "content": extra})
            roster = self._roster()  # config-projected, ~static — ahead of the mutable memory block
            if roster:
                head.append({"role": "system", "content": roster})
            persona = self._persona_block()  # who the OWNER is — config-projected, ~static (D70 §4.2)
            if persona:
                head.append({"role": "system", "content": persona})
            memory = self._memory_block()  # durable memory, after the roster (7e-d, D15 #4 AMENDED)
            if memory:
                head.append({"role": "system", "content": memory})
            core_index = self._core_index_block()  # tier-2 routing index, memory-adjacent (D57 §4)
            if core_index:
                head.append({"role": "system", "content": core_index})
            if self._skills_note:  # active skills' instructions (4.5)
                head.append({"role": "system", "content": self._skills_note})
            self._static_head = head
        return self._static_head

    async def _assemble(self, thread: Thread, *, clearing: ClearingPlan | None = None) -> list[dict]:
        """Build the OpenAI `messages` array: the cached static system head (`_static_prefix`) + the
        non-compacted history + the agent's post-history instructions + a one-shot reflection nudge
        at the tail (in that order — D70 §4.2). Reasoning is dropped (the model's scratchpad); tool
        calls + results round-trip as `assistant.tool_calls` followed by
        `tool` messages keyed by `call_id`. Any tool call left unresolved gets a synthesized
        result so the context is always valid for the API: a persisted-CANCELLED call (A11/D39) →
        `cancelled`; any other abandoned call (e.g. a dropped confirm) → `skipped`.

        `clearing` (D42 Tier 1) is the iteration's shared `ClearingPlan`: any tool result whose
        `call_id` is in `clearing.cleared_call_ids` renders its OUTPUT as the placeholder (assembly-time
        only — the DB row stays verbatim, A12). `None` (the resume/finalize legacy callers) → no trim.

        **Attachments (D68 §4.1/§4.2/§4.5).** A user turn that carried files is the ONE place the
        content stops being a plain string: images ride as OpenAI `image_url` parts beside the text,
        text files are injected INTO the text as tool-output-framed pages, and anything not sent this
        request degrades to a stub naming the file. A turn with no attachments renders exactly as it
        always did, byte for byte — which is what keeps every existing thread's prompt (and its prefix
        cache) unchanged.

        History is re-read every iteration on purpose: `_compactor.compact` runs before each model call
        and can fold older turns into a summary, so the history (the cache TAIL) legitimately changes —
        only the static head above is held stable."""
        cleared_ids = clearing.cleared_call_ids if clearing is not None else frozenset()
        history = await self._messages.list(thread.id, include_compacted=False)
        # Decided ONCE for the whole assembled request, before a single byte is read (§4.1): the
        # per-request image ceiling is a property of the payload, not of any one message.
        sent_images = self._images_to_send(history)
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
                                "content": _tool_content(res, cleared=c.call_id in cleared_ids),
                            }
                        )
                elif text:
                    out.append({"role": "assistant", "content": text})
            else:  # user / system
                text = m.text()
                files = m.attachments() if m.role == "user" else []
                if files:
                    content, notice = await self._render_attachments(thread, text, files, sent_images)
                    out.append({"role": m.role, "content": content})
                    if notice:
                        # The dimensions notice (§4.1, main-seat amendment) is its own developer-role
                        # line rather than words inside the owner's turn: it is the SERVER stating what
                        # it sent, and putting it in the user's mouth would be a small lie in the one
                        # place the model is reasoning about pixels. It sits AFTER the turn it
                        # describes; `normalize_system_messages` re-roles it in place, like any other
                        # mid-history system line.
                        out.append({"role": "system", "content": notice})
                elif text:
                    out.append({"role": m.role, "content": text})
        # Post-history instructions (D70 §4.2) as a TAIL layer — the operational last word, after the
        # history so recency carries it (R64 §3). Cache cost ~nil: everything after the newest message
        # re-prefills anyway. It sits ahead of the reflection nudge, which is the ephemeral one-shot.
        post_history = self._post_history()
        if post_history:
            out.append({"role": "system", "content": post_history})
        # Periodic reflection nudge (D27-C) as an EPHEMERAL TAIL layer — appended AFTER history so it
        # never sits inside the cached static head (Hermes ephemeral-layer pattern; volatile content goes
        # after the stable prefix). One-shot: emit in exactly ONE model call per armed turn, not on every
        # `_drive` iteration — a re-instructed weak model would otherwise re-save (a reworded save dodges
        # the loop-guard's exact-arg dedup). The model saw it once; that's the reflection prompt for the turn.
        if self._reflect_now:
            out.append({"role": "system", "content": self._reflection_nudge()})
            self._reflect_now = False
        return out

    def _images_to_send(self, history: list[Message]) -> set[str]:
        """The store paths of the image attachments THIS assembled request carries as real bytes
        (D68 §4.1/§4.5). Everything else degrades to the §4.5 stub.

        Two bounds, applied in this order:

          * `attachments.resend` off → only the CURRENT logical turn's images are eligible. The turn
            boundary is `turn_start_index` — the same definition the recall budget and Tier-1 immunity
            use, so "this turn" means one thing in the codebase (a mid-turn steer's photo counts as
            this turn's, which is what the owner means by attaching it).
          * `max_images_per_request` → the NEWEST that many survive; the oldest degrade first, which
            is the accepted prefix-churn residual (§10, O-conf N2): each image-adding turn past the
            ceiling rewrites the front of the assembled payload, bounded and observable through the
            per-call `cached_tokens` telemetry D62 already persists. A ceiling of 0 sends none.
        """
        cfg = self._settings.attachments
        if cfg.max_images_per_request <= 0:
            return set()
        start = 0 if cfg.resend else turn_start_index(history)
        eligible = [
            p.path for m in history[start:] if m.role == "user" for p in m.attachments() if p.kind == "image"
        ]
        return set(eligible[-cfg.max_images_per_request :])

    async def _render_attachments(
        self,
        thread: Thread,
        text: str,
        files: list[AttachmentPart],
        sent_images: set[str],
    ) -> tuple[object, str | None]:
        """One user turn's wire content + its dimensions notice (D68 §4.1/§4.2/§4.5).

        The content is a plain STRING unless real images ride along, in which case it is the OpenAI
        parts list `[text, image_url…]` (the 7/7 field shape). Text attachments are injected into the
        text half as D64-framed tool OUTPUT rather than as prose about a call (§4.2, council O-M7);
        a PDF resolves to its extracted-text sidecar when S4 has written one, and to an honest stub
        naming `read_attachment` until then.

        Every file read goes through the per-turn cache below — `_assemble` runs once per loop
        iteration, and re-reading + re-encoding tens of megabytes per call is the exact failure
        council E5 named."""
        blocks: list[str] = [text] if text else []
        images: list[dict] = []
        sent: list[AttachmentPart] = []
        for p in files:
            if p.kind == "image":
                url = await self._attachment_wire(thread, p) if p.path in sent_images else None
                if url is None:  # over the ceiling, resend off, or the file is gone from the store
                    blocks.append(image_stub(p))
                else:
                    images.append(image_part(url, p.name))
                    sent.append(p)
                continue
            blocks.append(await self._attachment_wire(thread, p) or document_stub(p))
        if not blocks:
            # An attachment-only send (§7) persists no `TextPart` at all, so the WIRE needs a text
            # part of its own — an empty string would be an empty turn to a strict template. R61's
            # sentence, said once, here: this is the only place that knows the turn was file-only.
            blocks.append(ATTACHMENT_ONLY_TEXT)
        body = "\n\n".join(blocks)
        content: object = [{"type": "text", "text": body}, *images] if images else body
        return content, dimensions_notice(sent)

    async def _attachment_wire(self, thread: Thread, part: AttachmentPart) -> str | None:
        """One attachment's rendered wire text — an image's `data:` URL, or a document's framed page —
        read at most ONCE per turn (§4.1, council E5).

        A plain dict keyed by the part's store path is sound because a stored attachment is IMMUTABLE
        once claimed (§2/§7: the claim is the only writer, and it links a fresh name rather than
        replacing bytes), so there is no revision to key on and nothing to invalidate. The session is
        per-turn, so the cache dies with the turn — which is also its size bound.

        `None` means "the store could not produce it" (the file is gone, or a PDF has no sidecar yet);
        the caller renders the honest stub for that, and does not cache the failure — a read that
        failed is not a fact about the file.
        """
        cached = self._attachment_cache.get(part.path)
        if cached is not None:
            return cached
        if part.kind == "image":
            wire = await read_data_url(self._settings, thread.id, part)
        elif part.kind == "pdf":
            page = await read_pdf_page(self._settings, thread.id, part)
            wire = render_inline(page) if page is not None else None
        else:
            try:
                wire = render_inline(await read_text_page(self._settings, thread.id, part.name))
            except StoredReadError:
                wire = None
        if wire is not None:
            self._attachment_cache[part.path] = wire
        return wire

    def _overhead_tokens(self) -> int:
        """The A8 invariant-prefix overhead (static head + tool schemas) as an estimated token count —
        the per-call cost the model prefills that `estimate_tokens(history)` misses. Memoized per turn
        in `_head_tokens`/`_tools_tokens` (the session is per-turn) and reused by BOTH the context
        estimator's no-anchor fallback (Wave 2 trigger) AND `_log_context_cost` (debug) — ONE
        measurement, never two (the A8 cache is the single source of truth for head+tools overhead)."""
        if self._head_tokens is None:
            self._head_tokens = estimate_payload_tokens(self._static_prefix())
        if self._tools_tokens is None:
            self._tools_tokens = estimate_payload_tokens(self._tools())
        return self._head_tokens + self._tools_tokens

    async def _persist_assistant(self, thread: Thread, assistant: Message, report: StreamReport) -> None:
        """Persist one assistant message + touch its thread — the single door every model call's
        message goes through, so the Phase 18 eval seam can never be forgotten at one of them.

        Three nullable fields ride along (L-2 — metadata on the message, no new table): the SNAPSHOT of
        this turn's prompt stamps as of now — TURN-SCOPED, i.e. every registry prompt rendered so far
        this turn with its latest hash (C-8/C-17; the accumulator's field note carries the semantic and
        its two accepted edges) — what the provider reported this call cost (C-9), and WHO served it
        (D62). A report that carries nothing yields `usage: None`/`source: None`; nothing here invents
        a number. Every fact is read off the ONE `StreamReport` the call was given, so the error paths
        and the wrap-up call are attributed by construction — this door is the only writer."""
        assistant.prompt_stamps = dict(self._stamps) or None
        assistant.usage = CallUsage.of(
            report.model,
            report.prompt_tokens,
            report.completion_tokens,
            cached_tokens=report.cached_tokens,
            duration_ms=report.duration_ms,
        )
        assistant.source = SourceInfo.of(
            report.served,
            report.degraded,
            report.primary,
            failed_hops=len(report.failures) or None,
            context_window=report.context_window,
        )
        await self._messages.add(assistant)
        await self._threads.touch(thread.id, assistant.ts)

    async def _estimate_context(self, thread: Thread, served_key: str | None) -> ContextEstimate:
        """The session-side anchored context estimate driving the D42 trigger (Wave 2). Reads the
        working history and asks the session-held `ContextEstimator` for `anchor + heuristic(messages
        after the watermark)` when a telemetry anchor is live for `served_key`, else `estimate_tokens
        (history) + the A8 head+tools overhead`. Returns the full `ContextEstimate` — callers price on
        `.tokens` and pass `.cleared_at_anchor` to the trigger so the clearing credit is exact (R1)."""
        history = await self._messages.list(thread.id, include_compacted=False)
        return self._estimator.estimate(history, overhead=self._overhead_tokens(), served_key=served_key)

    async def _plan_clearing(
        self,
        thread: Thread,
        *,
        window: int | None = None,
        estimated_tokens: int | None = None,
        cleared_at_anchor: frozenset[str] | None = None,
    ) -> ClearingPlan:
        """The iteration's Tier-1 clearing plan (D42) — the ONE selection shared by the trigger (its
        `gain` net-of-clearing) and `_assemble` (its `cleared_call_ids`). Reads the working history and
        delegates to the pure `plan_clearing`, so both consumers price/render off the same object.

        D60: `window` is the turn's smallest chain window (`min_chain_window`) and `estimated_tokens`
        the SAME assembled-prompt estimate the compaction trigger prices — together they are the
        pressure gate. `cleared_at_anchor` rides along from the SAME `ContextEstimate` (Codex MED)
        so an anchored estimate is gated against the UNTRIMMED prompt and cannot oscillate; a caller
        that has no estimate in hand passes neither and re-measures here through `_estimate_context`
        (the one estimator, heuristic without a served key), never a partial figure (§15b-11)."""
        history = await self._messages.list(thread.id, include_compacted=False)
        if estimated_tokens is None:
            est = await self._estimate_context(thread, None)
            estimated_tokens, cleared_at_anchor = est.tokens, est.cleared_at_anchor
        return plan_clearing(
            history,
            self._compaction_cfg,
            window=window,
            estimated_tokens=estimated_tokens,
            cleared_at_anchor=cleared_at_anchor,
        )

    async def _over_threshold_now(self, thread: Thread) -> bool:
        """Is the thread OVER the compaction trigger right now (D42)? Resolves the window for the
        agent's own mode + the session's (unanchored) estimate and asks the shared `_over_threshold`
        predicate. Used by the manual `/compact` path to decide whether a manual fold left the thread
        healthy enough to RESET the thrash breaker (net of the free clearing trim).

        D43/A4: this keeps `self._agent.model` (NOT a routed ref) — the manual `/compact` path is a
        sync-holder that never enters a routed turn, so pricing against the worker's window is correct
        + benign (noted, not a bug)."""
        ref = self._agent.model
        # D42 Codex FIX 3: price through the CAPTURED registry generation, not the live shared Settings
        # (which a settings PUT can mutate in place) — the window/target pin (A11: {provider, model}).
        price_ep = self._inference.target_for(ref.provider, ref.model)
        window = await self._inference.effective_window(price_ep) if price_ep is not None else None
        est = await self._estimate_context(thread, price_ep.base_url if price_ep is not None else None)
        clearing = await self._plan_clearing(
            thread,
            window=await self._inference.min_chain_window(ref.provider, ref.model),
            estimated_tokens=est.tokens,
            cleared_at_anchor=est.cleared_at_anchor,
        )
        history = await self._messages.list(thread.id, include_compacted=False)
        return self._compactor._over_threshold(
            history,
            window=window,
            reserve_tokens=self._agent.model.max_tokens,
            estimated_tokens=est.tokens,
            clearing=clearing,
            cleared_at_anchor=est.cleared_at_anchor,
        )

    async def _watermark_id(self, thread: Thread) -> str | None:
        """The id of the newest non-compacted message = the tail of the prompt about to be sent (the
        D42 anchor watermark: this call's total-prompt telemetry counts everything up to here, so the
        NEXT iteration's delta is only what's appended after it). `None` for an empty thread."""
        history = await self._messages.list(thread.id, include_compacted=False)
        return history[-1].id if history else None

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
        attachments: list[AttachmentPart] | None = None,
    ) -> AsyncIterator[AgentEvent]:
        """Persist the user message, then drive the loop. Yields SSE events. `mode` (a provider name,
        from the `/<provider>` composer verb, A11/D48) forces the inference backend for this turn;
        `None` uses the section default chain. `skills` are explicit `/skill-name` invocations
        (4.5); the selector adds model-invoked picks on top.

        `attachments` are the parts the endpoint CLAIMED before the turn started (D68 §3) — already
        server-built and already on disk. They ride the same user message the text does, because they
        ARE part of what the owner said; an attachment-only send therefore persists a message with no
        `TextPart` at all (the model-facing wire text for that case is S2's)."""
        self._activate_skills(user_text, skills)
        # `actor` is the session's `message_actor` (§D-3), not a hardcoded USER: the text is the owner's
        # for every interactive path (the default) and the AUTOMATION's for an unattended run. `role`
        # stays "user" — that is the model's turn-taking slot, not a claim about who wrote it.
        parts: list[Part] = [TextPart(text=user_text)] if user_text else []
        parts += attachments or []
        user_msg = Message(thread_id=thread.id, role="user", actor=self._message_actor, parts=parts)
        await self._messages.add(user_msg)
        await self._maybe_arm_reflection(thread)  # D27-C — periodic "save anything worth remembering"
        async for ev in self._drive(thread, mode=mode):
            yield ev

    def _reflection_eligible(self) -> bool:
        """Whether this session may reflect into the owner's DURABLE memory at all (D27-C, re-expressed
        for §D-3). Reflection is a property of the OWNER'S OWN CONVERSATION: the nudge asks the model to
        write lasting facts about the owner, and only a top-level interactive chat is that conversation.

        The old predicate was `depth > 0` — a proxy that read "not a subagent" and happened to mean
        "interactive top-level" because subagents were the only headless path. An automation breaks the
        proxy: a cron run is depth 0, so it would have reflected a throwaway unattended task into the
        owner's memory. Keying on the ORIGIN says what was always meant. `depth == 0` is kept beside it
        so the subagent guarantee survives even if a future caller forgets to pass an origin — and
        because it is exactly the old condition, every existing path (interactive chat arms, subagent
        never) behaves identically."""
        return self._origin.kind == "user_chat" and self._depth == 0

    async def _maybe_arm_reflection(self, thread: Thread) -> None:
        """Arm the periodic-reflection nudge for this turn (D27-C) when the thread's user-turn count
        is a multiple of `reflection_interval`. Counts the user message just persisted (so the cadence
        is every Nth turn) and **includes compacted messages** so it doesn't drift as history folds.
        Opt-in: off unless both the master memory switch and `reflection_enabled` are on, and only for a
        session `_reflection_eligible` admits — a headless subagent or an unattended automation run works
        a throwaway, archived thread and must not write the owner's durable memory from it."""
        cfg = self._settings.memory
        if not self._reflection_eligible() or not (cfg.enabled and cfg.reflection_enabled):
            self._reflect_now = False
            return
        interval = cfg.reflection_interval
        count = await self._messages.count_user_messages(thread.id)
        # `interval > 0` is belt-and-suspenders — `MemoryCfg` enforces `ge=1`, but guard the modulo
        # against a 0 reaching here via a direct mutation (tests) rather than risk a ZeroDivisionError.
        self._reflect_now = interval > 0 and count > 0 and count % interval == 0

    def _headless_label(self) -> str:
        """What to call this session in a message the MODEL reads when it cannot reach the owner. The
        wording ends up in a tool result the model reasons about (and in the run history a human reads),
        so it has to be true: a subagent and a cron run are both headless for different reasons, and
        telling an automation it is a "subagent" would be a small lie in the one place it is confusing."""
        return "unattended automation run" if self._origin.kind == "automation" else "headless subagent"

    def _headless_answer(self, cp: ToolCallPart, result: ToolResult) -> ToolResult:
        """Resolve a `question` that suspended with nobody to answer it (§D-3, owner ruling 1).

        `skip` → DENIED in place: byte-identical to the behavior every headless session had before this
        existed, and what subagents still get (the policy is an AUTOMATION session option).

        `use_default` → an answer, so the run CONTINUES, down a three-rung ladder: the declared
        `default` → the first offered choice → a synthesized "no owner is available, use your judgement".
        The third rung is the reason the policy is not just "skip with extra steps" (council R-1): a
        question with no default declared is the common case, and denying it would collapse `use_default`
        into `skip` for exactly those runs.

        The offer is read from the RESULT's `data`, not from the model's raw args: the suspending tool
        declares what it is offering, so this stays ignorant of `QuestionInput`'s field names and any
        future suspending tool gets the same treatment for free. Anything malformed simply isn't an offer.
        """
        if self._question_policy != "use_default":
            return ToolResult(
                state=RunState.DENIED,
                summary=f"{cp.tool}: cannot ask the owner — {self._headless_label()}",
            )
        offer = result.data if isinstance(result.data, dict) else {}
        declared = offer.get("default")
        choices = offer.get("choices")
        if isinstance(declared, str) and declared.strip():
            answer, source = declared.strip(), "the question's declared default"
        elif isinstance(choices, list) and choices and isinstance(choices[0], str) and choices[0].strip():
            answer, source = choices[0].strip(), "the first offered choice (no default was declared)"
        else:
            answer = resolve("unattended_answer", self._settings, stamps=self._stamps)
            source = "no default and no choices were offered"
        return ToolResult(
            state=RunState.OK,
            summary=f"no owner to ask ({self._headless_label()}) — answered from {source}",
            output=answer,
        )

    async def compact(self, thread: Thread, *, instructions: str | None = None) -> dict:
        """Manual `/compact` (4e/D42): force-fold the oldest turns now, ignoring the token threshold +
        the backoff/breaker (force) but still honouring the recent-message floor + turn-boundary safety
        AND the inflation-reject. `instructions` (the `/compact <instructions>` steer) threads into the
        summarizer as an emphasis block. Returns `{removed, summaryId?, truncated?, rejected?}` for a
        one-shot JSON response (no SSE — there's no turn to stream).

        D42 thrash RESET: a manual compact that leaves the thread UNDER threshold clears the breaker
        (the owner's escape hatch worked — failures=0, unlatched, notice re-armed). A rejected /
        still-over manual leaves the machine as-is; the breaker governs AUTO attempts only, and a manual
        run never itself latches it."""
        res = await self._compactor.compact(thread, force=True, instructions=instructions)
        cs = self._compaction_state
        if cs is not None and not (res is not None and res.rejected):
            if not await self._over_threshold_now(thread):
                cs.consecutive_failures = 0
                cs.breaker_latched = False
                cs.notice_emitted = False
        if res is None:
            # No clean turn boundary to fold — the thread is too small. A benign no-op (A5-x), not a
            # failure: mark it so the composer phrases it as "nothing to do".
            return {"removed": 0, "noop": True, "detail": COMPACT_TOO_SMALL}
        if res.rejected:
            # A FORCED compact only rejects on a pathologically small head (compaction.py) — i.e. the
            # thread is too small to usefully fold. Surface the SAME benign no-op as the empty-head case
            # rather than the auto path's "the summary wouldn't shrink" failure wording. `rejected` is
            # kept for back-compat; the thrash machine reads `res.rejected` directly, not this dict.
            return {
                "removed": 0,
                "noop": True,
                "detail": COMPACT_TOO_SMALL,
                "rejected": True,
                "truncated": res.truncated,
            }
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
        app: "FastAPI | None" = None,
    ) -> AsyncIterator[AgentEvent]:
        """Resume a suspended turn, then continue the loop so the model can react. Four decisions:
        `execute` (a confirm-gated call — re-run with the token), `execute_always` (D44 W2 — persist an
        args-exact grant, then run EXACTLY as `execute`), `dismiss` (skip it — works for a confirm *or*
        a question), and `answer` (a `question` — inject the owner's `answer` as the call's result, A2).
        Fail-closed (A1/C1-H1): an unknown decision is rejected with an error, NOT treated as execute,
        and `answer` is only honoured against an AWAITING_ANSWER call (never used to silently OK a
        confirm). `mode` (a `/<provider>` verb, ACA-16) is carried across the round-trip and threaded to
        `_drive` so a `/<provider>` turn resumes on that provider; `None` → the section default. `app` is passed only
        by the API endpoint (the `execute_always` grant reuses the settings write machinery via
        `runtime.grant_approval`); the write never blocks the run.

        `skills` (C5-M1) are the turn's active skills, carried across the round-trip so the resumed
        half runs under the SAME narrowed toolset + injected instructions the owner confirmed under —
        a fresh session otherwise re-activates nothing and continues on a BROADER toolset. Re-activated
        verbatim (`select=False`): no re-selection, since there's no user message on a resume."""
        # Re-activate the carried skills BEFORE `_drive` reads `_tool_allow`/`_skills_note` (via
        # `_tools`/`_static_prefix`) — mirrors `run_turn`'s `_activate_skills`, minus the selector.
        self._activate_skills("", skills, select=False)
        # …and re-seed the recall budget for the same reason: the resumed half belongs to the LOGICAL
        # turn that suspended, so it must inherit what that turn already spent (D57 §4).
        await self._seed_recall(thread)
        assistant = await self._find_pending(thread, call_id)
        if assistant is None:
            yield AgentEvent("error", {"message": "no pending action for this call", "retryable": False})
            yield AgentEvent("done", {"threadId": thread.id, "state": "error"})
            return
        cp = next((c for c in assistant.tool_calls() if c.call_id == call_id), None)
        if cp is not None and decision in ("execute", "execute_always") and not self._tool_allowed(cp.tool):
            # M1/C-11: the tool left the effective allowlist while the bubble was parked (an agent or
            # skill change, a dropped integration). Refuse BEFORE the D44 grant and the confirm-token
            # re-mint — neither may be spent on a call that cannot run, and a vanished tool would raise
            # `UnknownTool` into a generic ERROR instead of the ruled DENIED. Handing the call to `_drive`
            # with a `None` token makes it a FRESH call to the loop, whose own guard produces the single
            # denial text + audit row + denied signature (one implementation, not a second one here).
            async for ev in self._drive(
                thread, mode=mode, resume_assistant=assistant, resume_tokens={call_id: None}
            ):
                yield ev
            return
        grant_note: str | None = None
        if decision == "execute_always":
            # D44 W2: persist an args-EXACT 'always allow' rule for this call BEFORE running it, then run
            # it EXACTLY as `execute` (normalized below). The write NEVER blocks the run — a failure /
            # inexpressible args returns a breadcrumb note appended to THIS call's result summary. Since
            # the rule lands before the execute, `invoke` re-consults it and the W1 `[auto-allowed: …]`
            # marker DOES stamp this run too (benign — human-confirmed AND now approval-covered).
            if cp is not None and app is not None:
                grant_note = await grant_approval(app, cp.tool, cp.args)
            decision = "execute"
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
                thread,
                mode=mode,
                resume_assistant=assistant,
                resume_tokens={call_id: token},
                resume_notes={call_id: grant_note} if grant_note else None,
            ):
                yield ev
        finally:
            self._actions.end_execute(call_id)

    async def _seed_recall(self, thread: Thread) -> None:
        """Carry the Core Memory read state across a suspend/resume (§4, council Codex-11; D64 §2.2).

        A resume builds a FRESH `AgentSession` (ACA-15e), so its budget starts at zero — which would
        hand the model a full second allowance for the same logical turn every time it parked on a
        confirm bubble. So seed `used` from what this turn already recalled.

        **"The current logical turn" here is the transcript tail after the last NON-STEER `user`
        message**: the suspended turn began with that message and the resumed half continues it, so
        everything after it (the assistant calls, their tool results, any steer) belongs to the same
        turn. A mid-turn steer persists as an ordinary `role="user"` row (Drain A), so it carries the
        `steer` marker precisely so the walk does not stop at it and hand the model a second full
        allowance. Each `core_memory` call's result is counted by the length of its COMPLETE framed
        `output` — the exact quantity the tool charged live — and a READ-class call that produced no
        output (a refused read, an empty search) re-charges the `recall_min_charge_chars` floor it
        paid live (§15b-3: the floor is cumulative ACROSS a resume too, so parking on a confirm
        bubble never refunds a failed read's charge).

        READ COVERAGE (D64 §2.2) rides the same walk, from the opaque receipt each accepted page
        stashed in its `ToolResult.data` — never from the human-readable marker, because a
        presentation string must not be a safety rail's serialization. Receipts are replayed in
        TRANSCRIPT ORDER from OK results only, and `RecallState.restore` re-validates every field
        before it grants anything."""
        turn: list[Message] = []
        for m in reversed(await self._messages.list(thread.id)):
            if m.role == "user" and not m.steer:
                break
            turn.append(m)
        calls = {cp.call_id: cp.args for m in turn for cp in m.tool_calls() if cp.tool == CORE_MEMORY_TOOL}
        if not calls:
            return
        floor = self._core_memory.recall_min_charge_chars() if self._core_memory is not None else 0
        self._recall.used = sum(
            len(rp.result.output or "")
            or (floor if is_recall_call(CORE_MEMORY_TOOL, calls[rp.call_id]) else 0)
            for m in turn
            for rp in m.tool_results()
            if rp.call_id in calls
        )
        # `turn` was walked backwards; the receipts replay forwards, so the newest page for a path
        # lands last — which is the one carrying that path's final high-water mark.
        for m in reversed(turn):
            for rp in m.tool_results():
                if rp.call_id in calls and rp.result.ok:
                    self._recall.restore(rp.result.data.get(RECALL_RECEIPT))

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
        resume_notes: dict[str, str] | None = None,
    ) -> AsyncIterator[AgentEvent]:
        """The loop state machine (DESIGN §5.2). On resume, first finish the suspended step; then
        run model iterations until text-only / suspended / capped. `mode` forces the inference
        backend for this turn (4c); resume now carries the turn's `mode` across the confirm
        round-trip (ACA-16 — the PWA re-sends it), so a `/<provider>` turn resumes on that provider. `None`
        (no override) → the agent's own `model.provider`, else the section default."""
        # One loop-discipline guard per turn (C1): tracks repeated calls + stall across iterations.
        guard = _LoopGuard(
            max_repeat=self._agent.max_repeat_calls,
            max_per_tool=self._agent.max_calls_per_tool,
            per_tool_max=self._per_tool_caps(),
        )
        # ── D43/A4 failure-fallback routing: resolve ONE routed `ModelRef` for this LOGICAL turn ─────
        # RESOLVED FIRST — above the resume batch — so a re-suspend during that batch can freeze the same
        # `routed` under the new AWAITING call (chained suspension carries the snapshot). The router
        # returns the LEAD ModelRef during a fallback episode, else the agent's own (WORKER) model. ALL
        # FOUR derived locals below read from `routed` (review F4/H2: the draft's two-RHS form silently
        # left reasoning/max_tokens/compaction-reserve on the worker), and `_finalize` takes `routed`
        # too. The `/<provider>` verb (`mode`) WINS and BYPASSES the router entirely (the 4c
        # lock): the verb selects the ENDPOINT and runs the WORKER ModelRef on it — the owner's hand
        # chooses infrastructure, not persona. No routing state is read/written on the verb path (or
        # when routing is off / this is a subagent/non-thread session).
        rs, rcfg = self._routing_state, self._routing_cfg
        routed = self._agent.model
        route: Literal["lead", "worker"] = "worker"
        #: Per-turn hard-failure flag (was the deleted `RoutingState.turn_had_model_failure`). A PURE
        #: turn-local: it is set ONLY at the exhaustion / stall / error terminals below, each of which
        #: ends the turn immediately, so it NEVER needs to cross a suspend boundary (verified code-truth
        #: — that's why it no longer lives on the cross-turn `RoutingState`). Passed to `_conclude_routing`.
        had_failure = False
        if mode is None and rs is not None:
            if resume_assistant is not None:
                # RESUME: use the per-call SNAPSHOT frozen at the fresh decision — VERBATIM, never
                # re-dereferencing `rcfg.lead` (defect 2: an owner edit/disable mid-suspend must NOT
                # change the resumed half of a logical turn). Applies even if routing was disabled
                # mid-suspend (rcfg None) — the logical turn finishes as it started. A missing snapshot
                # (restart / swept / a worker turn we never pinned) → the worker (recorded residual).
                snap: ModelRef | None = None
                for cid in set(resume_tokens or {}) | set(resume_answers or {}):
                    if cid in rs.suspended_routes:
                        snap = rs.suspended_routes.pop(cid)
                        break
                if snap is not None:
                    routed = snap
                    route = "lead"  # only LEAD routes are snapshotted (see `_record_suspend_routes`)
            elif rcfg is not None:
                # FRESH turn = a new logical turn. First SWEEP any snapshot whose call is no longer a
                # live AWAITING call (an abandoned confirm / a restart residual): keyed here, at the
                # fresh-decision site — the reconciler (turns.py) operates on the DB and knows nothing of
                # routing state, so coupling the sweep there would be dirty; this is the clean hook and
                # runs only when snapshots actually exist. Then decide the route.
                if rs.suspended_routes:
                    awaiting = {
                        cp.call_id
                        for m in await self._messages.with_call_states(_SUSPEND_CALL_STATES, thread.id)
                        for cp in m.tool_calls()
                        if cp.state in _SUSPEND_CALL_STATES
                    }
                    for cid in list(rs.suspended_routes):
                        if cid not in awaiting:
                            del rs.suspended_routes[cid]
                if rs.fallback_remaining > 0:
                    # Inside a live episode → route to the lead and consume one turn. The decrement is
                    # committed HERE, at the fresh decision — a Stop that cancels this now-spawned turn
                    # mid-flight still consumes the episode turn (the episode shortens by that Stop —
                    # deliberate, matching the D41 "an already-spawned turn is what the cancel cancels"
                    # spirit; the per-turn flags are turn-locals, so a cancel leaves nothing to clean).
                    first_turn = rs.fallback_remaining == rcfg.fallback_turns
                    rs.fallback_remaining -= 1
                    routed = rcfg.lead
                    route = "lead"
                    if first_turn:  # the ONE opening notice — only on the episode's FIRST lead turn
                        yield AgentEvent(
                            "notice",
                            {
                                "text": (
                                    f"// lead model for the next {rcfg.fallback_turns} turns (worker failing)"
                                )
                            },
                        )
                # else: no episode → `route` stays "worker" (today's behavior); nothing written.

        if resume_assistant is not None:
            outcome = _BatchOutcome()
            async for ev in self._run_calls(
                thread,
                resume_assistant,
                resume_tokens or {},
                guard,
                resume_answers or {},
                outcome=outcome,
                resume_notes=resume_notes or {},
            ):
                yield ev
            if outcome.suspended:
                # Chained suspension: re-freeze the (unchanged) `routed` under the still-AWAITING
                # sibling call(s) of this same logical turn, so their eventual resume re-reads it.
                self._record_suspend_routes(resume_assistant, routed, route)
                yield AgentEvent("done", {"threadId": thread.id, "state": "suspended"})
                return

        # Effective inference target from the ROUTED ref: the per-message `mode` override (4c) still
        # wins for the ENDPOINT; the model id / reasoning / output reserve all price the routed ref.
        eff_mode = mode or routed.provider
        # C7 (Codex#2): a `ModelRef.model` clean name is PROVIDER-RELATIVE. When the per-message `mode`
        # override names a DIFFERENT provider than the routed ref, the routed model must NOT ride along —
        # the registry would treat it as a raw wire id and send it to the wrong backend. So carry the model
        # ONLY when `mode` is unset or equals the routed provider; otherwise resolve `mode`'s own default
        # (an explicit raw-id ModelRef still passes through in the mode-unset / same-provider cases).
        eff_model = routed.model if (mode is None or mode == routed.provider) else None
        #: Modeled per-call config threaded to `stream_chat` as first-class kwargs (D42/A10). The routed
        #: `ModelRef.max_tokens` doubles as BOTH the wire output cap AND the window trigger's output
        #: reserve (below); `reasoning_effort` is model-level (no per-message override). `reasoning_
        #: tokens` rides alongside as the explicit per-dialect budget OVERRIDE (D45) — the wire builder
        #: applies it only where the serving endpoint's dialect has a budget concept.
        eff_reasoning = routed.reasoning_effort
        eff_reasoning_tokens = routed.reasoning_tokens
        #: Output reserve subtracted from the window trigger line (D42) — the routed `ModelRef.max_tokens`
        #: (a lead turn reserves the lead's cap); `None` ⇒ nothing reserved (gated by `reserve_output`).
        reserve = routed.max_tokens
        #: The endpoint that ACTUALLY served the PREVIOUS iteration (D42 §C). Iteration 2+ prices the
        #: window trigger (and the anchor's served-endpoint consistency) against it; `None` on iteration
        #: 1 ⇒ price against the selected endpoint.
        served: ResolvedTarget | None = None
        #: The D60 Tier-1 pressure window: the SMALLEST context window across this turn's eligible
        #: failover chain, resolved ONCE for the whole turn (§15b-1 — a failover mid-turn must not
        #: re-plan clearing against a bigger window than the endpoint that ends up serving). `None`
        #: (any entry unresolvable) ⇒ always-on clearing, the pre-D60 behaviour.
        clear_window = await self._inference.min_chain_window(eff_mode, eff_model)

        stall = 0  # consecutive no-progress iterations (C1b) → forced wrap-up at the agent's cap
        #: D42 per-turn compaction backoff: set True after a failed (didn't-shrink) fold so AUTO-
        #: compaction does not re-attempt until the NEXT turn. Turn-LOCAL — the session is per-turn, so
        #: a fresh `_drive` clears it for free (no turn-id bookkeeping in the cross-turn CompactionState).
        compaction_blocked_this_turn = False
        #: D42 reactive backstop one-shot: a context-overflow'd model call (where nothing streamed yet)
        #: triggers ONE forced compaction + a re-stream into the same assistant slot, at most once per
        #: turn. Turn-LOCAL like `compaction_blocked_this_turn` — a fresh `_drive` clears it for free.
        backstop_fired_this_turn = False
        for _ in range(self._agent.max_iterations):
            # Drain A (D41): apply any steers queued mid-turn at the loop TOP, BEFORE `should_compact`,
            # so compaction always sees drained steers as ordinary history (ordering invariant to Slice
            # 6's trigger swap). No-op when unset (subagents) or the queue is empty.
            if self._steer_source is not None:
                async for ev in self._drain_steers(thread):
                    yield ev
            # Compaction check before each model call (DESIGN §5.2 step 2): if the working context is
            # over the trigger, fold the oldest turns into a summary system message. D42 Wave 2 — the
            # trigger is window-aware: resolve the window (config > probe > None) for the endpoint being
            # priced (iteration 1 = the selected endpoint; iteration 2+ = the one that actually served),
            # and pass the session's anchored estimate + the output reserve + the clearing gain. A `None`
            # window ⇒ the absolute `threshold_tokens` fallback (v1's no-regression path).
            # D42 Codex FIX 3: iteration 1 prices through the CAPTURED client's config generation
            # (`self._inference.endpoint`), NOT the live shared Settings — a settings PUT mutating them
            # mid-turn must not swing pricing to a different endpoint than the captured client streams
            # through (the hot-at-NEXT-turn pin). Iteration 2+ uses `served` (also off the captured chain).
            price_ep = served or self._inference.target_for(eff_mode, eff_model)
            window = await self._inference.effective_window(price_ep) if price_ep is not None else None
            est = await self._estimate_context(thread, price_ep.base_url if price_ep is not None else None)
            # D42 Tier 1 (D60 ①) — the assembly-time tool-output clearing plan for THIS iteration (ONE
            # shared selection): its `gain` prices the trigger net-of-clearing below, its
            # `cleared_call_ids` drive `_assemble`'s output-trim rendering. Planned AFTER the estimate
            # because it is now PRESSURE-GATED on it (against the turn's smallest chain window).
            clearing = await self._plan_clearing(
                thread,
                window=clear_window,
                estimated_tokens=est.tokens,
                cleared_at_anchor=est.cleared_at_anchor,
            )
            cs = self._compaction_state
            # D42 thrash machine: AUTO-compaction skips ENTIRELY while the breaker is latched OR after a
            # didn't-shrink attempt earlier THIS turn (per-turn backoff). Clearing (above) still applies.
            # Manual `/compact` (force) bypasses both. `None` state (subagents) never latches.
            auto_ok = not compaction_blocked_this_turn and not (cs is not None and cs.breaker_latched)
            if auto_ok:
                # ACA-11: summarizing can be a multi-second stall (a separate LLM call), so drop a live
                # breadcrumb FIRST — but only when compaction will actually fire (`should_compact`
                # mirrors `compact`'s own decision, net of clearing), never on a no-op iteration.
                if await self._compactor.should_compact(
                    thread,
                    window=window,
                    reserve_tokens=reserve,
                    estimated_tokens=est.tokens,
                    clearing=clearing,
                    cleared_at_anchor=est.cleared_at_anchor,
                ):
                    yield AgentEvent("notice", {"text": "// compacting the conversation…"})
                res = await self._compactor.compact(
                    thread,
                    window=window,
                    reserve_tokens=reserve,
                    estimated_tokens=est.tokens,
                    clearing=clearing,
                    cleared_at_anchor=est.cleared_at_anchor,
                )
                if res is not None and res.rejected:
                    # D42 FAILURE (the ONLY one): the fold DIDN'T SHRINK (inflation-reject). Nothing was
                    # written. Back off for the rest of this turn; count it, and at the cap latch the
                    # breaker + emit EXACTLY ONE notice (in the codebase's `// …` voice).
                    compaction_blocked_this_turn = True
                    if cs is not None:
                        cs.consecutive_failures += 1
                        if (
                            cs.consecutive_failures >= self._compaction_cfg.max_consecutive_failures
                            and not cs.breaker_latched
                        ):
                            cs.breaker_latched = True
                            if not cs.notice_emitted:
                                cs.notice_emitted = True
                                yield AgentEvent(
                                    "notice",
                                    {
                                        "text": "// compaction keeps failing — use /compact or start a new thread"
                                    },
                                )
                elif res is not None:
                    # A SHRINKING fold (summary OR a truncation-notice fallback) = SUCCESS: reset the
                    # failure counter and invalidate the anchor (its counted history is gone →
                    # heuristic+overhead until this call re-anchors). D42 explicit fold-invalidation.
                    if cs is not None:
                        cs.consecutive_failures = 0
                    self._estimator.invalidate()
                    yield AgentEvent(
                        "compaction",
                        {"removed": res.removed, "summaryId": res.summary_id, "truncated": res.truncated},
                    )
            messages = await self._assemble(thread, clearing=clearing)
            # The anchor watermark: the newest persisted message = the tail of the prompt we're about
            # to send. This call's total-prompt telemetry (below) counts up to here, so the next
            # iteration's heuristic delta is only what's appended after it (D42 anchored estimator).
            watermark = await self._watermark_id(thread)
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
            # The model call, wrapped so a context-overflow'd call where NOTHING streamed yet can be
            # rescued ONCE (D42 reactive backstop). Each pass re-initialises the buffers; a clean stream
            # `break`s, the backstop `continue`s into the SAME assistant slot, and any other failure /
            # exhausted backstop falls to the error path. The loop runs at most twice per iteration.
            while True:
                reasoning_buf = []
                text_buf = []
                reqs = []
                report = StreamReport()
                streamed_any = False  # the honest "no visible partial content reached the wire" signal
                try:
                    async for delta in self._inference.stream_chat(
                        messages,
                        mode=eff_mode,
                        model=eff_model,
                        max_tokens=reserve,
                        reasoning_effort=eff_reasoning,
                        reasoning_tokens=eff_reasoning_tokens,
                        tools=self._tools(),
                        report=report,
                    ):
                        # D43/A6 Wave 2: EMIT the typed retry/failover control items as live
                        # AgentEvents (the wire-visible failover narration — D43 Invariant 4). It MUST
                        # stay ABOVE the delta checks and MUST NOT touch `streamed_any` or the buffers —
                        # a control item before the first delta leaves the D42 nothing-streamed backstop
                        # honest (review F9 / D42 pin). Supersedes the deleted post-hoc degraded notice.
                        if isinstance(delta, (RetryNotice, FailoverNotice)):
                            yield _control_event(delta)
                            continue
                        if delta.reasoning:
                            streamed_any = True
                            reasoning_buf.append(delta.reasoning)
                            yield AgentEvent(
                                "reasoning.delta", {"messageId": assistant.id, "delta": delta.reasoning}
                            )
                        if delta.text:
                            streamed_any = True
                            text_buf.append(delta.text)
                            yield AgentEvent("text.delta", {"messageId": assistant.id, "delta": delta.text})
                        if delta.tool_calls:
                            reqs = delta.tool_calls
                    break  # streamed to completion — proceed to post-stream handling below
                except InferenceError as exc:
                    # D42 reactive backstop: a CONTEXT-OVERFLOW where nothing has streamed for this
                    # assistant response yet, and the backstop hasn't fired this turn, gets ONE forced
                    # compaction (force bypasses threshold/backoff/breaker but NEVER the inflation-reject)
                    # + a re-stream into the SAME assistant slot (no new message.start — the FE never
                    # sees a broken/duplicate bubble). A reject / nothing-to-fold, or a second overflow
                    # (the one-shot flag is already set) → the normal error path below.
                    if not backstop_fired_this_turn and not streamed_any and is_context_overflow(exc):
                        backstop_fired_this_turn = True
                        # D42 Codex FIX 4: the forced compact is priced NET of the iteration's clearing
                        # plan (and the estimator context matching the proactive call site) via the
                        # shared `_overflow_fold` — a bare `force=True` would price the folded head RAW
                        # and could accept a fold that GROWS the real cleared prompt.
                        bo = _BackstopOutcome()
                        async for ev in self._overflow_fold(
                            thread,
                            clearing=clearing,
                            window=window,
                            reserve_tokens=reserve,
                            estimated_tokens=est.tokens,
                            cleared_at_anchor=est.cleared_at_anchor,
                            outcome=bo,
                        ):
                            yield ev
                        if bo.folded:
                            # Re-plan against a FRESH estimate: the fold shrank the context and
                            # invalidated the anchor, so the pressure gate must re-decide on what is
                            # actually left (`_plan_clearing` re-measures when handed no estimate).
                            clearing = await self._plan_clearing(thread, window=clear_window)
                            messages = await self._assemble(thread, clearing=clearing)
                            watermark = await self._watermark_id(thread)
                            continue  # re-issue the SAME call into the SAME assistant slot
                    assistant.parts = [ErrorPart(message=str(exc), retryable=True)]
                    await self._persist_assistant(thread, assistant, report)
                    # D62 review F1 — the error terminal must carry the attribution it just persisted,
                    # or the live view and a refresh disagree (the FE handler is attribution-only, so
                    # this is safe on a message the client may not hold: it no-ops).
                    yield _message_end(assistant)
                    yield AgentEvent("error", {"message": str(exc), "retryable": True})
                    # D43/A4 Site 1: a chain-level InferenceError ENDS the turn. On a WORKER-routed turn
                    # it's a hard failure ONLY for a single-endpoint chain failure (`endpoints_tried ==
                    # 1` — the lead may live on a different endpoint); a multi-endpoint total outage
                    # (`> 1`) or an ambiguous shape (`None` — config / mid-stream) is NEUTRAL (no count,
                    # no reset — review F12: escalating to an equally-dead lead is pointless).
                    single_endpoint = exc.endpoints_tried == 1
                    had_failure = route == "worker" and single_endpoint
                    # The error terminal yields error+done SYNCHRONOUSLY (no await between conclude and
                    # done), so unlike the finalize sites it cannot cancel-race a counted failure onto a
                    # cancelled turn — conclude keeps its position here.
                    async for ev in self._conclude_routing(
                        route=route, had_failure=had_failure, neutral=not single_endpoint
                    ):
                        yield ev
                    yield AgentEvent("done", {"threadId": thread.id, "state": "error"})
                    return

            # D43/A6 Wave 2: the post-hoc degraded `notice` is DELETED — a fallback serve is now narrated
            # LIVE by the typed `inference.failover` event emitted above (D43 Invariant 5: superseded, no
            # double-narration). `report.degraded`/`failures`/`served` remain for logs + telemetry (the
            # debug context-cost line + the estimator's served-endpoint pin below).
            self._log_context_cost(messages, report)  # A8 estimate + ACA-18 cache telemetry (debug)

            # D42 Wave 2 — re-anchor the context estimator on THIS call's real total-prompt telemetry
            # (`report.prompt_tokens`: llama.cpp `prompt_progress.total`, else cloud `usage.prompt_tokens`)
            # and remember who served, so the NEXT iteration prices against the endpoint that answered.
            # No usable total (a backend without return_progress/include_usage) ⇒ `record` invalidates
            # ⇒ heuristic+overhead next iteration. `served_target` is None only if the report was never
            # stamped (shouldn't happen on a completed stream) — then heuristic mode too.
            served = report.served_target
            self._estimator.record(
                total=report.prompt_tokens,
                served_key=served.base_url if served is not None else None,
                watermark_id=watermark,
                # R1: remember WHICH tool outputs this call's prompt was trimmed by, so the next
                # anchored estimate credits only the outputs cleared SINCE (not the ones already gone).
                cleared_call_ids=clearing.cleared_call_ids,
            )

            parts: list[Part] = []
            if reasoning_buf:
                parts.append(ReasoningPart(text="".join(reasoning_buf)))
            text = "".join(text_buf)
            if text or not reqs:
                parts.append(TextPart(text=text))

            if not reqs:
                assistant.parts = parts
                await self._persist_assistant(thread, assistant, report)
                yield _message_end(assistant)
                # D43/A4: a clean text-only completion — the turn's conclusive end. On a worker turn
                # (`had_failure` still False) this resets the consecutive-failure counter; on a lead turn
                # it emits the close notice when the episode's last lead turn just finished.
                async for ev in self._conclude_routing(route=route, had_failure=had_failure):
                    yield ev
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
            await self._persist_assistant(thread, assistant, report)
            for cp in call_parts:
                yield AgentEvent(
                    "part.added", {"messageId": assistant.id, "part": cp.model_dump(mode="json")}
                )
            yield _message_end(assistant)

            outcome = _BatchOutcome()
            async for ev in self._run_calls(thread, assistant, {}, guard, outcome=outcome):
                yield ev
            if outcome.suspended:
                # Freeze the turn's `routed` under this batch's AWAITING call(s) so the resume re-reads
                # it verbatim — never re-deciding, immune to a config edit/disable mid-suspend (defects
                # 1+2). Neutral terminal: no count, no reset (the flags are turn-locals — untouched).
                self._record_suspend_routes(assistant, routed, route)
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
                    # D43/A4 Site 2: forced-finalize via the STALL guard is a hard worker failure (the
                    # true weak-worker signal — set explicitly on a worker route, never inferred from the
                    # terminal). Conclude runs AFTER `_finalize` (intercepting its `done`) so a Stop
                    # DURING the wrap-up cancels before any failure is counted — the cancelled turn stays
                    # neutral (defect 3). `_finalize` runs on the SAME `routed` ref.
                    had_failure = route == "worker"
                    async for ev in self._finalize_then_conclude(
                        thread,
                        eff_mode,
                        eff_model,
                        routed,
                        route=route,
                        had_failure=had_failure,
                        backstop_fired=backstop_fired_this_turn,
                    ):
                        yield ev
                    return
            # else: loop — call the model again so it can react to the tool results

        # Iterations exhausted: instead of a silent `capped` dead-end, force one tool-less call so
        # the owner always gets a final answer (C1c, opencode's max-step-guidance pattern).
        # D43/A4 Site 2: iteration exhaustion is a hard worker failure (set explicitly on a worker
        # route). Conclude runs AFTER `_finalize` (intercepting its `done`) so a Stop DURING the wrap-up
        # cancels before any failure is counted — the cancelled turn stays neutral (defect 3).
        had_failure = route == "worker"
        async for ev in self._finalize_then_conclude(
            thread,
            eff_mode,
            eff_model,
            routed,
            route=route,
            had_failure=had_failure,
            backstop_fired=backstop_fired_this_turn,
        ):
            yield ev

    def _record_suspend_routes(
        self, assistant: Message, routed: ModelRef, route: Literal["lead", "worker"]
    ) -> None:
        """Freeze the turn's routed ModelRef under EACH of the assistant message's still-AWAITING
        call_ids (D43) — the per-call snapshot a resume re-reads verbatim, so an owner config edit /
        disable mid-suspend never changes the resumed half of a logical turn (Invariant 1), and turn B's
        fresh decision on the same thread can never touch turn A's lock (defect 1: per-call keys, not one
        thread slot). Only LEAD routes are recorded: a worker resume falls to the worker naturally (no
        snapshot needed — recording it would just bloat the map + the sweep). A chained suspension
        re-records under the new call_id, carrying the same snapshot. No-op when routing is inert."""
        rs = self._routing_state
        if rs is None or route != "lead":
            return
        for cp in assistant.tool_calls():
            if cp.state in _SUSPEND_CALL_STATES:
                rs.suspended_routes[cp.call_id] = routed

    async def _finalize_then_conclude(
        self,
        thread: Thread,
        eff_mode: str | None,
        eff_model: str | None,
        routed: ModelRef,
        *,
        route: Literal["lead", "worker"],
        had_failure: bool,
        backstop_fired: bool = False,
    ) -> AsyncIterator[AgentEvent]:
        """Run `_finalize`, then settle routing AFTER it by intercepting `_finalize`'s terminal `done`:
        when the `done` arrives, FIRST yield the routing conclude events (the failure count + any close
        notice), THEN yield the `done` (events-after-`done` are forbidden — the wire ordering contract).

        This ordering closes defect 3: a Stop DURING the wrap-up model call raises `CancelledError` out
        of `_finalize` BEFORE its `done`, so conclude never runs — the cancelled turn counts no failure
        and arms no episode (the per-turn flags are turn-locals, so there is nothing to clean up). It
        also fixes the premature close notice — `// back to the worker model` now fires only after the
        final lead call actually finished."""
        async for ev in self._finalize(thread, eff_mode, eff_model, routed, backstop_fired=backstop_fired):
            if ev.event == "done":
                async for cev in self._conclude_routing(route=route, had_failure=had_failure):
                    yield cev
                yield ev
                return
            yield ev

    async def _conclude_routing(
        self, *, route: Literal["lead", "worker"], had_failure: bool, neutral: bool = False
    ) -> AsyncIterator[AgentEvent]:
        """Settle the failure-fallback routing machine at a LOGICAL turn's CONCLUSIVE end (D43/A4) —
        the completed / error / capped terminals, NEVER a suspend (the logical turn continues on resume;
        the suspend terminals record a route snapshot instead of concluding). Takes the turn's `route` +
        `had_failure` as PARAMS (the deleted `current_route` / `turn_had_model_failure` state fields are
        now `_drive` turn-locals).

        On a WORKER route: `had_failure` → `consecutive_failures += 1`, opening a fallback episode
        (`fallback_remaining = fallback_turns`, counter reset) once it reaches `failure_threshold`; a
        clean completion (`had_failure` False) → reset to 0; a `neutral` terminal (a multi-endpoint total
        outage — review F12) does NEITHER (no count, no reset). On a LEAD route: emit the ONE `// back to
        the worker model` close notice exactly when the episode's LAST lead turn just finished
        (`fallback_remaining == 0`).

        When routing is OFF (`rcfg is None`) — the owner disabled it mid-episode via a settings/agent
        edit — reset the WHOLE state to defaults (the episode counters AND any pending route snapshots),
        so the prune drops the now-orphaned entry and a later re-enable starts a FRESH count. Leaving a
        live `fallback_remaining`/`consecutive_failures`/`suspended_routes` behind would make the entry
        non-prunable AND silently resurrect a mid-episode lead route on re-enable (D43 Invariant 4)."""
        rs, rcfg = self._routing_state, self._routing_cfg
        if rs is None:
            return
        if rcfg is not None:
            if route == "lead":
                if rs.fallback_remaining == 0:  # the episode's last lead turn just concluded
                    yield AgentEvent("notice", {"text": "// back to the worker model"})
            elif route == "worker" and not neutral:
                if had_failure:
                    rs.consecutive_failures += 1
                    if rs.consecutive_failures >= rcfg.failure_threshold:
                        rs.fallback_remaining = rcfg.fallback_turns
                        rs.consecutive_failures = 0
                else:
                    rs.consecutive_failures = 0
        else:
            # Routing disabled mid-turn: drop the episode counters AND any pending snapshots, so the
            # entry prunes and a re-enable never inherits a stale mid-episode lead route (Invariant 4).
            rs.consecutive_failures = 0
            rs.fallback_remaining = 0
            rs.suspended_routes.clear()

    async def _drain_steers(self, thread: Thread) -> AsyncIterator[AgentEvent]:
        """Drain A (D41): apply the steers queued mid-turn at the `_drive` loop top. `peek()` snapshots
        the pending entries ONCE; each is processed FIFO in queue order, then `commit()`ed by id — so an
        entry enqueued DURING this drain (not in the snapshot) survives to the next loop top.

        **Message entries** persist as `role="user"` Messages (actor USER — the same shape `run_turn`
        persists the composer message). A CONTIGUOUS run of message entries commits in ONE
        `Database.transaction()`; `commit()` (which clears the queue) runs ONLY AFTER the txn returns
        (**persist-before-clear**: a failed persist raises here before `commit()`, leaving the queue
        intact, so un-persisted steer text has exactly ONE home at all times — the one-txn rule is
        per-contiguous-message-run, NOT across an interleaved exec, so an exec between two messages
        splits their runs). Each yields `steer.applied {entryId, messageId, kind:"message", text}` — the
        text rides the wire so the accumulator can render the bubble on a snapshot re-attach without a
        reload. An entry that left the queue while its attachments were being claimed (a DELETE, a
        Stop-harvest) is dropped just before the txn — the message branch's equivalent of the exec
        branch's claim-before-run count check (D68 MED-2).

        **Exec entries** re-check `shell.user_exec_enabled` LIVE (D41 fail-closed: the enqueue check is
        UX only; disabled at drain → drop the entry [`commit` it away] + a `notice`, and NEVER run it).
        Enabled → commit the entry off the queue FIRST (D41 MED-1 commit-before-run: for a shell command
        lost-on-crash beats double-run — a Stop/harvest mid-execution can no longer hand a running command
        back to the composer), THEN the SHARED `run_user_exec` (the same run_shell@FULL + atomic pair the
        `/exec` endpoint uses), then `steer.applied {entryId, messageId, kind:"exec"}` (id-only — the
        durable pair is the floor).

        Deliberately does NOT re-run `_activate_skills`/reflection arm and does NOT rebuild the static
        head (it's per-turn cached + tail-appends history — the new user rows surface via `_assemble`'s
        history re-read next iteration; `count_user_messages` bumps for the message rows naturally)."""
        assert self._steer_source is not None
        entries = self._steer_source.peek()
        if not entries:
            return
        i, n = 0, len(entries)
        while i < n:
            if entries[i].kind == "message":
                # Gather the CONTIGUOUS message run — one txn covers exactly it (not across an exec).
                run: list[SteerEntry] = []
                while i < n and entries[i].kind == "message":
                    run.append(entries[i])
                    i += 1
                # D68 (E7): claim each entry's staged files BEFORE the persist txn — the rename
                # cannot sit inside it (confirm-round NEW 1), and the same crash window the chat POST
                # accepts applies here, reclaimed by the boot sweep's referenced-set arm. A refusal
                # (the id expired while the steer waited, or a Stop/re-send consumed it) must not
                # cost the owner their TEXT: the message persists without the files and a `notice`
                # says so, which is the drain's equivalent of the POST's 409 — never a silent drop.
                claimed: dict[str, list[AttachmentPart]] = {}
                notices: list[str] = []
                for e in run:
                    if not e.attachments:
                        continue
                    try:
                        claimed[e.entry_id] = await claim_attachments(
                            self._settings, thread.id, e.attachments
                        )
                    except StoreWriteError as exc:
                        notices.append(f"// attachment not sent — {exc.detail}")
                msgs: list[tuple[SteerEntry, Message]] = []
                for e in run:
                    parts: list[Part] = [TextPart(text=e.text)] if e.text else []
                    parts += claimed.get(e.entry_id, [])
                    if not parts:
                        # An attachment-ONLY steer whose files all refused (D68): there is nothing
                        # left to say, and an empty user row would render an empty bubble and add an
                        # empty turn to the model's context. The notice above is the whole truth; the
                        # entry is still committed off the queue below — it is consumed either way.
                        continue
                    msgs.append(
                        (
                            e,
                            Message(
                                thread_id=thread.id,
                                role="user",
                                actor=Actor.USER,
                                parts=parts,
                                # Marks the row as a MID-TURN steer rather than a turn opener (D57).
                                # The model's context is unaffected — it is a `meta` key, not a part
                                # — but anything walking back to the start of the logical turn
                                # (`_seed_recall`) must not mistake a steer for the boundary.
                                steer=True,
                            ),
                        )
                    )
                # D68 MED-2: re-snapshot the queue IMMEDIATELY before the txn and drop any entry that
                # is no longer queued. The claims above are awaited — directory scans, fsyncs and a
                # strict whole-file decode of up to 10 MiB each — so a DELETE (`delete_steer`) or a
                # Stop-harvest has a real window to land on an entry we peeked, and persisting it
                # would resurrect a message the owner unsent. A dropped entry's already-claimed files
                # stay where they landed: that is the accepted unreferenced-file class the sweep's
                # referenced-set arm reclaims (§10), not a rollback worth building. The window
                # between this re-peek and the txn is the pre-D68 sub-ms race, accepted as before.
                live = {e.entry_id for e in self._steer_source.peek()}
                msgs = [(e, m) for e, m in msgs if e.entry_id in live]
                # persist-before-clear: the queue stays intact until this txn COMMITS. A failed persist
                # raises out of here (the turn errors cleanly) with `commit()` never reached → the
                # entries are still queued (retried at the next boundary / harvestable on Stop).
                async with self._messages.db.transaction():
                    for _, m in msgs:
                        await self._messages.add(m)
                # The WHOLE run leaves the queue, dropped entries included — committing an id that is
                # already gone removes nothing (`commit` is by id), and every entry in the run is
                # consumed either way: persisted, refused into a notice, or unsent by its owner.
                self._steer_source.commit([e.entry_id for e in run])
                for text in notices:
                    yield AgentEvent("notice", {"text": text})
                for e, m in msgs:
                    yield AgentEvent(
                        "steer.applied",
                        {"entryId": e.entry_id, "messageId": m.id, "kind": "message", "text": e.text},
                    )
            else:  # exec
                entry = entries[i]
                i += 1
                if not self._settings.shell.user_exec_enabled:
                    # Fail-closed (D41): the enqueue-time gate is UX only. Disabled at DRAIN → drop the
                    # queued command (commit it away) + a live breadcrumb; run_shell is NEVER invoked.
                    self._steer_source.commit([entry.entry_id])
                    yield AgentEvent("notice", {"text": "// shell disabled — queued command dropped"})
                    continue
                # ATOMIC CLAIM-BEFORE-RUN (D41 FIX 1, formerly MED-1 commit-before-run): claim the entry
                # OFF the queue BEFORE run_user_exec AND verify the claim removed exactly it. `commit`
                # returns the count removed — a return != 1 means the entry was DELETEd/harvested since
                # the `peek()` snapshot (e.g. a DELETE landed while the preceding message run's txn was
                # awaiting), so it is NO LONGER ours to run: skip it, never invoke run_shell (a
                # deleted/harvested exec must never still execute). Claim-first also gives lost-on-crash
                # over double-run: a Stop/harvest arriving mid-execution can no longer hand a
                # still-queued, already-running command back to the composer. The trade (a crash between
                # claim and run loses the command) is the in-memory queue's already-accepted failure mode.
                if self._steer_source.commit([entry.entry_id]) != 1:
                    continue  # DELETEd/harvested since the peek — skip, never run
                exec_out = await run_user_exec(self._actions, self._messages, thread.id, entry.text)
                yield AgentEvent(
                    "steer.applied",
                    {"entryId": entry.entry_id, "messageId": exec_out.assistant_id, "kind": "exec"},
                )

    async def _overflow_fold(
        self,
        thread: Thread,
        *,
        clearing: ClearingPlan,
        window: int | None = None,
        reserve_tokens: int | None = None,
        estimated_tokens: int | None = None,
        cleared_at_anchor: frozenset[str] | None = None,
        outcome: _BackstopOutcome,
    ) -> AsyncIterator[AgentEvent]:
        """The D42 reactive backstop's shared force-compaction step — the ONE home for the
        classify-already-done force+retry, used by BOTH the main loop's context-overflow rescue AND
        `_finalize`'s (Codex FIX 2). One `compact(force=True, …)` (bypasses threshold/backoff/breaker
        but NEVER the inflation-reject), priced NET of the iteration's `clearing` plan (Codex FIX 4 —
        without it the folded head is priced RAW and a fold that GROWS the real cleared prompt could be
        accepted); the estimator-context kwargs mirror the proactive `compact()` call site. On a
        SHRINKING fold: invalidate the anchor (its counted head is gone → heuristic next), emit the
        `compaction` event, and flip `outcome.folded`. The caller owns its own
        `is_context_overflow`/nothing-streamed/one-shot gating (it differs: the main loop tracks an
        anchor watermark, `_finalize` does not) and its own re-assemble + re-issue."""
        res = await self._compactor.compact(
            thread,
            force=True,
            window=window,
            reserve_tokens=reserve_tokens,
            estimated_tokens=estimated_tokens,
            clearing=clearing,
            cleared_at_anchor=cleared_at_anchor,
        )
        if res is not None and not res.rejected:
            self._estimator.invalidate()  # the folded head is gone → heuristic next
            outcome.folded = True
            yield AgentEvent(
                "compaction",
                {"removed": res.removed, "summaryId": res.summary_id, "truncated": res.truncated},
            )

    async def _finalize(
        self,
        thread: Thread,
        eff_mode: str | None,
        eff_model: str | None,
        routed: ModelRef,
        *,
        backstop_fired: bool = False,
    ) -> AsyncIterator[AgentEvent]:
        """Forced final answer (C1c). Reached when the loop stalls or exhausts `max_iterations` —
        one **tool-less** model call (so it can only produce text) with a nudge to wrap up, instead
        of the old silent `capped` dead-end. Always ends the turn with a reply; only if this call
        itself fails do we fall back to `capped` so there's still a terminal event.

        D43/A4: the wrap-up consumes the turn's ROUTED `ModelRef` — model id + `max_tokens` +
        `reasoning_effort` all come from `routed` (a lead turn wraps up on the lead), not a re-read of
        `self._agent.model` (review F4/H2: that asymmetry left the wrap-up on the worker's call-config).
        `eff_mode`/`eff_model` carry the per-message `/<provider>` verb override (A11/D48) — the SAME
        effective pair the main loop uses, so a mode that names a different provider does not carry the
        routed model across providers (Codex#2).

        D42 Codex FIX 2: the wrap-up now (a) assembles under the iteration's Tier-1 `plan_clearing` —
        the `clear_keep_steps` recent-step protection keeps the just-run results an honest wrap-up
        needs, and the cleared outputs keep their `[state] summary` lines by design; only OLD bulky
        outputs are trimmed — and (b) gets the SAME one-shot context-overflow rescue the main loop has:
        a context-overflow with NOTHING streamed, if the backstop hasn't fired this turn
        (`backstop_fired`), triggers ONE forced compaction + a re-attempt of this call, via the shared
        `_overflow_fold` (no second copy of the classify/force/retry logic)."""
        self._reflect_now = (
            False  # the wrap-up call is tool-less — don't carry the "use the memory tool" nudge
        )
        # D42 Codex FIX 2: the forced wrap-up runs Tier-1 clearing like the main loop. The current-turn
        # immunity (D60 ①) keeps the just-run outputs the wrap-up summarizes honestly; only PRIOR-turn
        # bulky outputs past the step window are trimmed, and their `[state] summary` lines survive.
        # The pressure gate prices the same turn-scoped chain window the loop used.
        clear_window = await self._inference.min_chain_window(eff_mode, eff_model)
        clearing = await self._plan_clearing(thread, window=clear_window)
        _WRAP_NUDGE = {
            "role": "system",
            "content": resolve("wrapup_nudge", self._settings, stamps=self._stamps),
        }

        async def _assemble_wrap() -> list[dict]:
            msgs = await self._assemble(thread, clearing=clearing)
            msgs.append(_WRAP_NUDGE)
            return msgs

        messages = await _assemble_wrap()
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
            advance = False  # the ACA-21 tool_choice-rejection fallback → advance to the tools=None attempt
            while True:  # D42 Codex FIX 2 overflow-rescue re-stream (one-shot), mirroring `_drive`'s backstop
                reasoning_buf = []
                text_buf = []
                report = StreamReport()
                try:
                    async for delta in self._inference.stream_chat(
                        messages,
                        mode=eff_mode,
                        model=eff_model,
                        max_tokens=routed.max_tokens,
                        reasoning_effort=routed.reasoning_effort,
                        reasoning_tokens=routed.reasoning_tokens,
                        tools=fin_tools,
                        tool_choice=fin_choice,
                        report=report,
                    ):
                        # D43/A6 Wave 2: EMIT the typed retry/failover control items (both consumers get
                        # this branch — review F9). ABOVE the delta checks and never touching the
                        # text/reasoning buffers — the ACA-21 "nothing streamed" fallback below stays
                        # honest. Same `_control_event` mapping as the main loop (one wire shape).
                        if isinstance(delta, (RetryNotice, FailoverNotice)):
                            yield _control_event(delta)
                            continue
                        if delta.reasoning:
                            reasoning_buf.append(delta.reasoning)
                            yield AgentEvent(
                                "reasoning.delta", {"messageId": assistant.id, "delta": delta.reasoning}
                            )
                        if delta.text:
                            text_buf.append(delta.text)
                            yield AgentEvent("text.delta", {"messageId": assistant.id, "delta": delta.text})
                    break  # streamed to completion
                except InferenceError as exc:
                    # D42 reactive backstop (Codex FIX 2): a context-overflow with NOTHING streamed and
                    # the backstop unfired this turn → ONE forced compaction + re-issue the SAME attempt
                    # into the now-smaller prompt. Shares `_overflow_fold` with the main loop; a reject /
                    # nothing-to-fold (folded=False) falls through to the ACA-21 fallback / error path.
                    if not backstop_fired and not text_buf and not reasoning_buf and is_context_overflow(exc):
                        backstop_fired = True
                        bo = _BackstopOutcome()
                        async for ev in self._overflow_fold(thread, clearing=clearing, outcome=bo):
                            yield ev
                        if bo.folded:
                            clearing = await self._plan_clearing(thread, window=clear_window)
                            messages = await _assemble_wrap()
                            continue  # re-issue the SAME attempt with the folded (smaller) prompt
                    if attempt == 0 and not text_buf and not reasoning_buf:
                        log.debug(
                            "finalize: tool_choice='none' failed (%s); retrying once with tools=None", exc
                        )
                        advance = True  # nothing streamed → safe to re-issue as a plain tool-less wrap-up
                        break
                    assistant.parts = [ErrorPart(message=str(exc), retryable=True)]
                    await self._persist_assistant(thread, assistant, report)
                    # D62 review F1 — same live/durable parity as the drive-loop error terminal above.
                    yield _message_end(assistant)
                    yield AgentEvent("error", {"message": str(exc), "retryable": True})
                    yield AgentEvent("done", {"threadId": thread.id, "state": "capped"})
                    return
            if advance:
                continue  # to the tools=None fallback attempt
            break  # streamed OK — don't run the fallback attempt
        self._log_context_cost(messages, report)  # A8 estimate + ACA-18 cache telemetry (debug)

        parts: list[Part] = []
        if reasoning_buf:
            parts.append(ReasoningPart(text="".join(reasoning_buf)))
        text = "".join(text_buf) or "(Stopped after reaching the step limit for this request.)"
        parts.append(TextPart(text=text))
        assistant.parts = parts
        await self._persist_assistant(thread, assistant, report)
        yield _message_end(assistant)
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
              `tool_counts[tool] < cap_for(tool)` (skipped entirely for an `uncapped` call — D60 ②,
              which then does not spend the counter either); repeat-cap `counts[sig] < max_repeat`. Repeat-cap
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
        # Fail-safe (audit LOW-1): a DUPLICATE call_id anywhere in the batch (a broken local model
        # re-streaming a fragment id) would collapse the executor's call_id-keyed slot map and drop a
        # result part. Duplicates are malformed-by-protocol → run the WHOLE batch on the serial tail
        # (conservative; the serial loop's per-part handling is the established behavior for them).
        ids = [cp.call_id for cp in calls]
        if len(set(ids)) != len(ids):
            return _BatchPlan(prefix=[], serial_from=0)
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
            capped = not guard.uncapped(cp.tool, cp.args)  # D60 ②: a core_memory read is uncapped
            if capped and guard.tool_counts.get(cp.tool, 0) + tool_overlay.get(cp.tool, 0) >= guard.cap_for(
                cp.tool
            ):
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
            # mutation yet — committed below only for a real (≥2) prefix. An uncapped call is not
            # COUNTED either (D60 ②) — a counter nobody reads would still be spent by later calls.
            counts_overlay[sig] = counts_overlay.get(sig, 0) + 1
            if capped:
                tool_overlay[cp.tool] = tool_overlay.get(cp.tool, 0) + 1
            tentative.append(cp)

        if len(tentative) >= 2:
            # Commit the overlay to the real guard IN MODEL ORDER — these ARE the dispatch increments
            # (the parallel executor does NOT increment again; the serial tail keeps its own).
            for cp in tentative:
                sig = _LoopGuard.sig(cp.tool, cp.args)
                guard.counts[sig] = guard.counts.get(sig, 0) + 1
                if not guard.uncapped(cp.tool, cp.args):
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

    @staticmethod
    def _invoke_error_result(tool: str, exc: Exception) -> ToolResult:
        """Map a failed `ActionService.invoke` to that call's ISOLATED error `ToolResult` (failure
        isolation, D40 §5 — one call's error is only its own). Mirrors the serial loop's inline
        `except UnknownTool` / `except ValidationError` shapes byte-for-byte so a parallel-prefix
        failure feeds the model exactly the error a serial failure would; a GENERIC exception (which
        the serial loop never catches — it lets it propagate) becomes a plain ERROR result so a
        parallel task NEVER raises out of its `invoke`. The single reusable construction for the
        parallel path (the serial loop's body is unchanged per the Wave-4 scope — it keeps its inline
        clauses; this helper reproduces their shapes rather than refactoring them)."""
        if isinstance(exc, UnknownTool):
            return ToolResult(state=RunState.DENIED, summary=f"unknown tool '{tool}'")
        if isinstance(exc, ValidationError):
            return ToolResult(
                state=RunState.ERROR, summary=f"invalid arguments for {tool}", error=str(exc)[:300]
            )
        return ToolResult(state=RunState.ERROR, summary=f"{tool} failed", error=str(exc)[:300])

    def _per_tool_caps(self) -> dict[str, int]:
        """The `tool_overrides.<tool>.max_calls` replacements for this turn (D60 ②) — read off the
        live settings at `_drive` entry, the same per-invocation source `ApprovalRule`s use (never an
        `apply_tool_overrides` spec overlay: this is a loop limit, not a schema field)."""
        overrides: dict = getattr(self._settings, "tool_overrides", None) or {}
        caps: dict[str, int] = {}
        for name, ov in overrides.items():
            cap = getattr(ov, "max_calls", None)
            if isinstance(cap, int) and cap >= 1:
                caps[name] = cap
        return caps

    def _tool_allowed(self, name: str) -> bool:
        """Is `name` inside THIS turn's effective toolset (M1/C-11)? Computed at call time from
        `for_agent(self._tool_allow)` — never from `_tools_cache`, which is only the OpenAI rendering
        of that set — because a skill narrows `_tool_allow` per turn, and the core builtins that
        survive any allowlist are `for_agent`'s semantics rather than a name list restated here."""
        return any(
            t.spec.name == name
            for t in self._actions.registry.for_agent(self._tool_allow, self._hidden_tools)
        )

    async def _blocked_call(self, cp: ToolCallPart, guard: _LoopGuard) -> ToolResult:
        """Refuse one model-emitted call that is outside the effective allowlist (M1/C-11) — the
        session-local guard on BOTH `ActionService.invoke` sites. The allowlist filtered the SCHEMAS
        the model saw, but the execution path resolved the emitted name from the FULL registry, so a
        hidden / excluded / skill-narrowed tool still ran on a hallucinated or stale-context name.

        Nothing reaches `ActionService` here, so this owns the two things `invoke` would have done:
        the audit Event (through the public caller-resolved-denial door — a guard that bypasses the
        gate must not also bypass the audit trail) and the denied-signature record, so a *loop* of
        blocked calls trips the loop guard's echo instead of spinning. Applies uniformly to a resumed
        call: with M2's restored skill set, a legitimately-approved call still passes."""
        result = ToolResult(
            state=RunState.DENIED,
            summary=f"{cp.tool} is not available to this agent — not run",
            output=resolve("m1_tool_blocked", self._settings, {"tool": cp.tool}, stamps=self._stamps),
        )
        guard.denied_sigs.add(_LoopGuard.sig(cp.tool, cp.args))
        await self._actions.record_policy_denial(
            cp.tool, cp.args, result, actor=AGENT_ACTOR, origin=self._origin
        )
        return result

    async def _run_calls(
        self,
        thread: Thread,
        assistant: Message,
        resume_tokens: dict[str, str | None],
        guard: _LoopGuard,
        resume_answers: dict[str, str] | None = None,
        *,
        outcome: _BatchOutcome,
        resume_notes: dict[str, str] | None = None,
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
            # ── PARALLEL PREFIX HEAD (D40 §5) ─────────────────────────────────────────────────────
            # Runs BEFORE the serial for-loop, as `_run_calls`' head, sharing its `result_parts` list,
            # `_persist()` closure and `tool_msg` holder (ONE consumer of both). `_classify_batch`
            # already COMMITTED the prefix's dispatch increments to `guard` (counts/tool_counts) in
            # model order — so this executor must NOT increment again; and every prefix call it
            # resolves becomes `_RESOLVED`, so the serial loop below `continue`s past it (its ONLY
            # skip). `max_parallel_tools == 1` = parallel dispatch OFF (agent.py): skip the classifier
            # entirely so `guard` is untouched and the batch runs on today's verbatim serial tail.
            plan = (
                self._classify_batch(assistant, guard, resume_tokens, resume_answers)
                if self._agent.max_parallel_tools > 1
                else _BatchPlan(prefix=[], serial_from=0)
            )
            if plan.parallel:
                # One result slot per prefix call, filled at its MODEL-ORDER index; `result_parts` is
                # always the filled slots in model order (gaps for not-yet-done calls dropped — the
                # compaction preserves model order among completed ones), and later serial-tail
                # appends go after. Concurrency is bounded by `asyncio.Semaphore(max_parallel_tools)`
                # acquired INSIDE each task around the invoke.
                sem = asyncio.Semaphore(self._agent.max_parallel_tools)
                slots: list[ToolResultPart | None] = [None] * len(plan.prefix)
                index_of: dict[str, int] = {cp.call_id: i for i, cp in enumerate(plan.prefix)}

                async def _invoke_one(cp: ToolCallPart) -> tuple[ToolCallPart, InvokeOutcome | ToolResult]:
                    """Invoke ONE prefix call under the concurrency bound. NEVER raises except
                    `CancelledError` (which must still cancel): any invoke failure maps to that call's
                    isolated error `ToolResult`. Returns `(cp, InvokeOutcome | ToolResult)`; the
                    invoke construction mirrors the serial loop's exactly (a prefix call is always
                    fresh → `confirm_token=None`). Actor audit rows are written inside `invoke`."""
                    async with sem:
                        if not self._tool_allowed(cp.tool):
                            return cp, await self._blocked_call(cp, guard)  # M1/C-11
                        try:
                            return cp, await self._actions.invoke(
                                cp.tool,
                                cp.args,
                                origin=self._origin,
                                actor=AGENT_ACTOR,
                                privilege=self._agent.privilege,
                                interactive=self._interactive,
                                confirm_token=None,
                                depth=self._depth,
                                agent=self._agent,
                                stamps=self._stamps,
                                recall=self._recall,
                                thread_id=thread.id,
                            )
                        except asyncio.CancelledError:
                            raise
                        except Exception as exc:  # failure isolation (incl. Unknown/Validation)
                            return cp, self._invoke_error_result(cp.tool, exc)

                def _complete(cp: ToolCallPart, produced: InvokeOutcome | ToolResult) -> ToolResult:
                    """Completion bookkeeping for ONE prefix call, copied faithfully from the serial
                    completion path (`cp.state`, `guard.last_results`, `seen_results`+`made_progress`
                    on a NEW real result). A prefix call is always fresh (`token is None`) so the
                    serial `token != _DISMISS` guard is unconditionally true here. D40 §4 BELTS: an
                    invoke that returns `needs_confirm` OR any result whose state is NOT `_RESOLVED`
                    (AWAITING_* = misdeclared suspension; PENDING/RUNNING = a state no tool may
                    return — audit LOW-4 fail-closed: an unresolved `cp.state` would make the serial
                    loop RE-INVOKE the call) → replace with a loud error result, log at ERROR, and
                    (per D40) do NOT flip `made_progress` — but still record `last_results`."""
                    sig = _LoopGuard.sig(cp.tool, cp.args)
                    belt = False
                    if isinstance(produced, ToolResult):
                        result = produced  # invoke raised → isolated error result
                    else:
                        inv = produced  # an InvokeOutcome
                        if inv.needs_confirm or (
                            inv.result is not None and inv.result.state not in _RESOLVED
                        ):
                            belt = True
                            log.error(
                                "tool %r misdeclared for parallel execution (needs_confirm/AWAITING_* "
                                "under the read-only prefix) — excluded",
                                cp.tool,
                            )
                            result = ToolResult(
                                state=RunState.ERROR,
                                summary=f"{cp.tool} misdeclared for parallel execution — excluded",
                                output=resolve("parallel_misdeclared", self._settings, stamps=self._stamps),
                            )
                        else:
                            result = inv.result or ToolResult(
                                state=RunState.ERROR, summary=f"{cp.tool} returned no result"
                            )
                    cp.state = result.state
                    guard.last_results[sig] = result  # C1a — recorded even for a belt result
                    if not belt:  # D40 §4: belt results are counted as no-progress
                        rsig = _LoopGuard.result_sig(sig, result)
                        if rsig not in guard.seen_results:
                            guard.seen_results.add(rsig)
                            outcome.made_progress = True
                    slots[index_of[cp.call_id]] = ToolResultPart(call_id=cp.call_id, result=result)
                    return result

                def _materialize() -> None:
                    result_parts[:] = [s for s in slots if s is not None]

                # Spawn OUTSIDE any open DB transaction — the head runs before any `_persist`, so no
                # txn is open here (D40 §5/§9, asserted by construction). Tasks retained explicitly.
                tasks = [asyncio.ensure_future(_invoke_one(cp)) for cp in plan.prefix]
                try:
                    pending: set[asyncio.Task] = set(tasks)
                    while pending:
                        done, pending = await asyncio.wait(pending, return_when=asyncio.FIRST_COMPLETED)
                        for t in done:  # SINGLE consumer, in completion order
                            cp, produced = t.result()  # never raises (CancelledError propagates)
                            result = _complete(cp, produced)
                            _materialize()
                            await _persist()  # persist-before-emit (same contract as serial)
                            yield AgentEvent(
                                "tool.result",
                                {"callId": cp.call_id, "result": result.model_dump(mode="json")},
                            )
                finally:
                    # Lifecycle on ANY exit (normal / exception / external cancel / GeneratorExit): NO
                    # tool task may outlive the generator. Cancel every still-pending task, AWAIT them
                    # all (no orphan warnings), then HARVEST every completed-but-unconsumed task so its
                    # work survives; the existing generator-level `finally` `_persist` then flushes it
                    # durably. NEVER yield here (a yield during GeneratorExit unwind → RuntimeError).
                    for t in tasks:
                        if not t.done():
                            t.cancel()
                    await asyncio.gather(*tasks, return_exceptions=True)
                    for t in tasks:
                        if t.cancelled() or t.exception() is not None:
                            continue  # cancelled / uncaught-BaseException → nothing to harvest
                        cp, produced = t.result()
                        if slots[index_of[cp.call_id]] is None:  # completed but not yet consumed
                            _complete(cp, produced)
                    _materialize()

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
                # D44 W2 breadcrumb for an `execute_always` whose rule could NOT be persisted. Passed
                # INTO `invoke` below so it's part of the summary the Event records (post-audit LOW-3 —
                # a post-hoc append reached the SSE stream only, leaving no audit trace of a failed
                # grant). `note_recorded` tracks whether that happened: results NOT produced by a
                # recorded invoke (an UnknownTool/ValidationError raise, a headless deny) still need the
                # append at the tail, and a recorded one must not get it twice.
                note = resume_notes.get(cp.call_id) if resume_notes and token != _DISMISS else None
                note_recorded = False
                if token == _DISMISS:
                    # The owner reviewed the confirm/question bubble and rejected it. Record the call's
                    # signature so a fresh model re-issue of the identical call this drive gets the denial
                    # echo (below) instead of minting a new confirm bubble (the user-visible retry loop).
                    guard.denied_sigs.add(_LoopGuard.sig(cp.tool, cp.args))
                    if cp.tool == "question":
                        result: ToolResult = ToolResult(
                            state=RunState.DENIED,
                            summary="question declined by the owner",
                            output=resolve("question_declined", self._settings, stamps=self._stamps),
                        )
                    else:
                        result = ToolResult(
                            state=RunState.DENIED,
                            summary=f"{cp.tool} rejected by the owner — not run",
                            output=resolve("rejection_notice", self._settings, stamps=self._stamps),
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
                                output=resolve("denial_echo", self._settings, stamps=self._stamps),
                            )
                        elif guard.counts.get(sig, 0) >= guard.max_repeat and sig in guard.last_results:
                            prior = guard.last_results[sig]
                            # D64 §2.7b: carry the prior ERROR through the registry's own slot. A
                            # suppression that replaces a refusal with "don't repeat this" deletes
                            # the one fact that could redirect the model — the incident's third
                            # delete attempt was answered by a note explaining nothing. The prior
                            # OUTPUT is never carried: a successful result is already in context.
                            suppressed = ToolResult(
                                state=prior.state,
                                summary=f"(repeat suppressed) {prior.summary}",
                                output=resolve(
                                    "repeat_suppressed",
                                    self._settings,
                                    {"details": f"\n\nIt returned: {prior.error}" if prior.error else ""},
                                    stamps=self._stamps,
                                ),
                            )
                        elif not guard.uncapped(cp.tool, cp.args) and guard.tool_counts.get(
                            cp.tool, 0
                        ) >= guard.cap_for(cp.tool):
                            suppressed = ToolResult(
                                state=RunState.DENIED,
                                summary=f"(call limit) {cp.tool} used too many times this turn",
                                output=resolve(
                                    "per_tool_cap",
                                    self._settings,
                                    {
                                        "tool": cp.tool,
                                        "count": str(guard.tool_counts.get(cp.tool, 0)),
                                    },
                                    stamps=self._stamps,
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
                        if not guard.uncapped(cp.tool, cp.args):  # D60 ②: reads don't spend the cap
                            guard.tool_counts[cp.tool] = guard.tool_counts.get(cp.tool, 0) + 1
                    if not self._tool_allowed(cp.tool):
                        # M1/C-11 — outside the effective allowlist. Checked FIRST: the capability
                        # boundary outranks argument validity (steering a repair for a tool that cannot
                        # run is noise), and it lands before the confirmed-resume RUNNING flip below, so
                        # a blocked call never persists as in-flight work.
                        result = await self._blocked_call(cp, guard)
                    elif cp.invalid_raw is not None:
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
                                origin=self._origin,
                                actor=AGENT_ACTOR,
                                privilege=self._agent.privilege,
                                interactive=self._interactive,
                                confirm_token=token,
                                depth=self._depth,
                                agent=self._agent,
                                summary_note=note,
                                stamps=self._stamps,
                                recall=self._recall,
                                thread_id=thread.id,
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
                            note_recorded = inv.event is not None  # invoke already folded it in
                            if inv.needs_confirm and not self._interactive:
                                # Headless (a subagent, or an unattended automation run): no UI to confirm
                                # against → deny in place so the turn never stalls (DESIGN §5.3, §D-3).
                                # UNCHANGED by `question_policy`, deliberately and out loud: that policy
                                # governs QUESTIONS only. A confirm always follows the privilege/approvals
                                # ladder — a D44 approval rule or `privilege: full` is how an automation is
                                # authorized to run risky tools, because consent belongs at authoring time
                                # (a stored prompt is not consent).
                                result = ToolResult(
                                    state=RunState.DENIED,
                                    summary=f"{cp.tool} needs confirmation — skipped ({self._headless_label()})",
                                )
                                # The note/`note_recorded` bookkeeping is `invoke`'s, kept locally rather
                                # than resting on "a resume note cannot reach a headless call": whatever
                                # produced this result, it now reaches an Event, so the note belongs in
                                # the row and must not be appended a second time by the tail below.
                                if note:
                                    result.summary = f"{result.summary}{note}"
                                # …and AUDITED (post-14d review, MED). `invoke` records nothing for a
                                # suspend — correctly, the call may still be allowed — but THIS converts
                                # the suspend into a refusal nobody can lift, so it is a decided outcome.
                                # Unaudited, an unattended run's blocked tool calls existed only in its
                                # transcript: absent from the event log, from the history, and from the
                                # notification that would have told the owner their run was stopped.
                                await self._actions.record_policy_denial(
                                    cp.tool, cp.args, result, actor=AGENT_ACTOR, origin=self._origin
                                )
                                note_recorded = True
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
                                        # D44 W2: whether a bubble 'always allow' grant is expressible for
                                        # these exact args (value-based) — the FE hides the affordance when
                                        # false (a non-scalar field, e.g. spawn_subagents.tasks).
                                        "alwaysEligible": self._actions.approval_eligible(cp.tool, cp.args),
                                        # M2/C-12: the turn's active skills ride the suspend event, so
                                        # the snapshot pins them under THIS call id for the resume.
                                        "skills": list(self._active_skills),
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
                            # No owner to ask (§D-3). `question_policy` decides between denying in place
                            # (today's behavior, and what every subagent still gets) and resolving an
                            # answer so an unattended run keeps moving. Resolved HERE — BEFORE the
                            # AWAITING_ANSWER flip is persisted and before any `tool.question` is emitted
                            # — so an unattended run leaves no suspended call behind for nobody to resolve.
                            result = self._headless_answer(cp, result)
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
                                    "skills": list(self._active_skills),  # M2/C-12, as on the confirm
                                },
                            )
                            break

                cp.state = result.state
                if note and not note_recorded:
                    # The result never reached an Event (see above) — breadcrumb it on the SSE result at
                    # least; the call still ran, only the standing rule is lost.
                    result.summary = f"{result.summary}{note}"
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
