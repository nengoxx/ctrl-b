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
    message.end      {messageId}
    error            {message, retryable}
    done             {threadId, state}        # completed | suspended | capped | error
"""

from __future__ import annotations

import json
import uuid
from dataclasses import dataclass, field
from typing import AsyncIterator

from pydantic import ValidationError

from app.adapters.inference import InferenceClient, InferenceError, StreamReport
from app.config import Settings
from app.core.memory import MemoryProvider
from app.core.skills import SkillProvider, SkillSelector
from app.core.tool import UnknownTool
from app.domain.agent import AgentDef
from app.services.agent.skills import available_skills, narrow_tools, resolve_skills, skills_prompt
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
from app.services.agent.compaction import Compactor
from app.services.conversation import MessageRepo, ThreadRepo

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
    #: Outcome signatures already seen this turn. A call whose result repeats a prior one made no
    #: real *progress* — the model is spinning (the live probe saw search_and_crawl fired ~16x with
    #: trivially-varied queries, every call returning the *identical* result). Exact-arg suppression
    #: misses that (the args differ); counting a repeated outcome as no-progress trips the stall
    #: guard fast so the turn wraps up in a few calls instead of running to the iteration cap.
    seen_results: set[str] = field(default_factory=set)

    @staticmethod
    def sig(tool: str, args: dict) -> str:
        return f"{tool}:{json.dumps(args, sort_keys=True, default=str)}"

    @staticmethod
    def result_sig(result: ToolResult) -> str:
        return f"{result.state.value}|{result.summary}|{(result.output or '')[:300]}"


def _tool_content(result: ToolResult) -> str:
    """Render a ToolResult as the `content` of an OpenAI `tool` message — what the model reads to
    reason about the outcome. Concise; `output` is already redacted + truncated upstream."""
    body = f"[{result.state.value}] {result.summary}"
    if result.output:
        body += f"\n{result.output}"
    if result.error:
        body += f"\nerror: {result.error}"
    return body


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
        self._compactor = Compactor(
            inference, messages, self._agent.compaction or settings.agent.compaction
        )
        #: Per-turn skill state (4.5), set by `_activate_skills` at the start of run_turn. The
        #: effective tool allowlist defaults to the agent's; active skills may narrow it.
        self._skills_note: str | None = None
        self._tool_allow: list[str] | str = self._agent.tools
        #: Per-turn periodic-reflection flag (D27-C), armed by `_maybe_arm_reflection` at turn start
        #: when the thread's user-turn count hits the interval; `_assemble` injects a one-shot nudge
        #: while set. Default off (also the resume path, which doesn't re-arm — reflection is a
        #: turn-start concern, not a mid-turn one).
        self._reflect_now = False

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
        (`self._tool_allow`): the `AgentDef`'s allowlist, further narrowed by any active skill."""
        return self._actions.registry.to_openai_tools(
            self._actions.registry.for_agent(self._tool_allow)
        )

    def _activate_skills(self, user_text: str, invoked: list[str] | None) -> None:
        """Resolve the skills active for this turn (4.5) and stash the prompt addition + narrowed
        tool allowlist. No-op when the subsystem is off / unprovided so the default agent is
        unchanged. `invoked` are explicit `/skill-name` requests (user-invoked); the selector adds
        model-invoked picks by matching the user message."""
        self._skills_note = None
        self._tool_allow = self._agent.tools
        if not (self._skills and self._selector and self._settings.agent.skills_enabled):
            return
        available = available_skills(self._skills, self._settings, self._agent)
        active = resolve_skills(available, self._selector, user_text, invoked=invoked)
        if not active:
            return
        self._skills_note = skills_prompt(active)
        self._tool_allow = narrow_tools(active, self._agent.tools)

    async def _assemble(self, thread: Thread) -> list[dict]:
        """Build the OpenAI `messages` array from non-compacted history. Reasoning is dropped (the
        model's scratchpad); tool calls + results round-trip as `assistant.tool_calls` followed by
        `tool` messages keyed by `call_id`. Any tool call left unresolved (an abandoned confirm)
        gets a synthesized `skipped` result so the context is always valid for the API."""
        history = await self._messages.list(thread.id, include_compacted=False)
        results: dict[str, ToolResult] = {}
        for m in history:
            for rp in m.tool_results():
                results[rp.call_id] = rp.result

        out: list[dict] = [{"role": "system", "content": self._system_prompt()}]
        for extra in self._appends():  # additive guidance, base-first (7e-a)
            out.append({"role": "system", "content": extra})
        memory = self._memory_block()  # durable memory, after appends (7e-d, D15 #4)
        if memory:
            out.append({"role": "system", "content": memory})
        roster = self._roster()
        if roster:
            out.append({"role": "system", "content": roster})
        if self._skills_note:  # active skills' instructions (4.5)
            out.append({"role": "system", "content": self._skills_note})
        if self._reflect_now:  # periodic reflection nudge (D27-C), after the skills note
            out.append({"role": "system", "content": self._reflection_nudge()})
            # One-shot: emit in exactly ONE model call, not on every `_drive` iteration of the turn —
            # a re-instructed weak model would otherwise re-save (a reworded save dodges the loop-guard's
            # exact-arg dedup). The model saw it once; that's the reflection prompt for the turn.
            self._reflect_now = False
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
                        res = results.get(c.call_id) or ToolResult(
                            state=RunState.SKIPPED, summary="not executed"
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
        return out

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
    ) -> AsyncIterator[AgentEvent]:
        """Resume a suspended turn, then continue the loop so the model can react. Three decisions:
        `execute` (a confirm-gated call — re-run with the token), `dismiss` (skip it — works for a
        confirm *or* a question), and `answer` (a `question` — inject the owner's `answer` as the
        call's result, A2). Anything else is treated as execute."""
        assistant = await self._find_pending(thread, call_id)
        if assistant is None:
            yield AgentEvent(
                "error", {"message": "no pending action for this call", "retryable": False}
            )
            yield AgentEvent("done", {"threadId": thread.id, "state": "error"})
            return
        if decision == "answer":
            async for ev in self._drive(
                thread, resume_assistant=assistant, resume_answers={call_id: answer or ""}
            ):
                yield ev
            return
        token = _DISMISS if decision == "dismiss" else confirm_token
        async for ev in self._drive(thread, resume_assistant=assistant, resume_tokens={call_id: token}):
            yield ev

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
        backend for this turn (4c); resume uses the configured default (no per-message mode is
        carried across the confirm round-trip — a minor inconsistency only if the summary model
        differs from the turn's)."""
        # One loop-discipline guard per turn (C1): tracks repeated calls + stall across iterations.
        guard = _LoopGuard(
            max_repeat=self._agent.max_repeat_calls,
            max_per_tool=self._agent.max_calls_per_tool,
        )
        if resume_assistant is not None:
            events, suspended, _ = await self._run_calls(
                thread, resume_assistant, resume_tokens or {}, guard, resume_answers or {}
            )
            for ev in events:
                yield ev
            if suspended:
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
                        yield AgentEvent(
                            "text.delta", {"messageId": assistant.id, "delta": delta.text}
                        )
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
                yield AgentEvent("notice", {"text": f"// inference failover → {report.served} (primary unavailable)"})

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

            call_parts = [ToolCallPart(call_id=r.id or uuid.uuid4().hex, tool=r.name, args=_parse_args(r.arguments)) for r in reqs]
            parts.extend(call_parts)
            assistant.parts = parts
            await self._messages.add(assistant)
            await self._threads.touch(thread.id, assistant.ts)
            for cp in call_parts:
                yield AgentEvent(
                    "part.added", {"messageId": assistant.id, "part": cp.model_dump(mode="json")}
                )
            yield AgentEvent("message.end", {"messageId": assistant.id})

            events, suspended, made_progress = await self._run_calls(thread, assistant, {}, guard)
            for ev in events:
                yield ev
            if suspended:
                yield AgentEvent("done", {"threadId": thread.id, "state": "suspended"})
                return
            # Stall guard (C1b): only a *new tool result* counts as progress. Narration text does
            # NOT — a thinking model emits commentary alongside its tool calls every iteration, and
            # counting that as progress would defeat this guard entirely (the bug that let the loop
            # run to max_iterations). A text-only reply already returned `completed` above, so any
            # `text` here is just narration accompanying tool calls.
            if made_progress:
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
        self._reflect_now = False  # the wrap-up call is tool-less — don't carry the "use the memory tool" nudge
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
        assistant = Message(
            thread_id=thread.id, role="assistant", actor=AGENT_ACTOR, agent=self._agent.name
        )
        yield AgentEvent(
            "message.start",
            {"messageId": assistant.id, "role": "assistant", "agent": self._agent.name},
        )
        reasoning_buf: list[str] = []
        text_buf: list[str] = []
        try:
            async for delta in self._inference.stream_chat(
                messages, mode=eff_mode, model=eff_model, tools=None
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
            assistant.parts = [ErrorPart(message=str(exc), retryable=True)]
            await self._messages.add(assistant)
            await self._threads.touch(thread.id, assistant.ts)
            yield AgentEvent("error", {"message": str(exc), "retryable": True})
            yield AgentEvent("done", {"threadId": thread.id, "state": "capped"})
            return

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

    async def _run_calls(
        self,
        thread: Thread,
        assistant: Message,
        resume_tokens: dict[str, str | None],
        guard: _LoopGuard,
        resume_answers: dict[str, str] | None = None,
    ) -> tuple[list[AgentEvent], bool, bool]:
        """Process the assistant's not-yet-resolved tool calls in order. ALLOW runs immediately via
        `ActionService` (which validates, decides, executes, records the Event); DENY/bad-args
        synthesize a clean result fed back to the model; CONFIRM suspends (persist AWAITING_CONFIRM,
        emit `tool.permission`, stop). An exact-repeat call past `guard.max_repeat` is **suppressed**
        (C1): not executed, the prior result echoed back with a steering note — this both kills a
        weak model's spiral and is the safe choice for a mutating duplicate. Returns
        `(events, suspended, made_progress)`; `made_progress` is False when every call was a
        suppressed repeat (so `_drive` can count a stall). Tool execution is fast (local ping/SSH),
        so a step's results are batched here while the slow model call streams live."""
        events: list[AgentEvent] = []
        result_parts: list[ToolResultPart] = []
        suspended = False
        made_progress = False

        answers = resume_answers or {}
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
                made_progress = True
                result_parts.append(ToolResultPart(call_id=cp.call_id, result=result))
                events.append(
                    AgentEvent("tool.result", {"callId": cp.call_id, "result": result.model_dump(mode="json")})
                )
                continue

            token = resume_tokens.get(cp.call_id)
            if token == _DISMISS:
                result: ToolResult = ToolResult(
                    state=RunState.SKIPPED, summary=f"{cp.tool} dismissed by the owner"
                )
                made_progress = True
            else:
                sig = _LoopGuard.sig(cp.tool, cp.args)
                # Suppression guards apply only to fresh model calls, never a user-approved resume.
                # C1a — exact-repeat: an identical (tool,args) call past the cap echoes the prior
                # result + a steering note. C1c — per-tool cap: any one tool called too many times
                # this turn (the catch-all for varied-arg spam) is refused with a steering note.
                # A suppressed call is NOT counted as progress, so repeated suppression trips stall.
                suppressed: ToolResult | None = None
                if token is None:
                    if guard.counts.get(sig, 0) >= guard.max_repeat and sig in guard.last_results:
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
                                f"You have already called {cp.tool} {guard.tool_counts[cp.tool]} "
                                "times this turn. Stop calling it — use what you have, switch to a "
                                "different tool, or give the owner your final answer now."
                            ),
                        )
                if suppressed is not None:
                    cp.state = suppressed.state
                    result_parts.append(ToolResultPart(call_id=cp.call_id, result=suppressed))
                    events.append(
                        AgentEvent(
                            "tool.result",
                            {"callId": cp.call_id, "result": suppressed.model_dump(mode="json")},
                        )
                    )
                    continue
                if token is None:
                    guard.counts[sig] = guard.counts.get(sig, 0) + 1
                    guard.tool_counts[cp.tool] = guard.tool_counts.get(cp.tool, 0) + 1
                try:
                    outcome = await self._actions.invoke(
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
                    if outcome.needs_confirm and not self._interactive:
                        # Headless child (subagent): no UI to confirm against → deny in place so the
                        # turn never stalls (DESIGN §5.3). The child reports it skipped the risky step.
                        result = ToolResult(
                            state=RunState.DENIED,
                            summary=f"{cp.tool} needs confirmation — skipped (headless subagent)",
                        )
                    elif outcome.needs_confirm:
                        cp.state = RunState.AWAITING_CONFIRM
                        spec = self._actions.registry.get(cp.tool).spec
                        events.append(
                            AgentEvent(
                                "tool.permission",
                                {
                                    "callId": cp.call_id,
                                    "tool": cp.tool,
                                    "title": spec.title,
                                    "args": cp.args,
                                    "risk": spec.risk.value,
                                    "token": outcome.confirm_token,
                                    "prompt": outcome.confirm_prompt,
                                },
                            )
                        )
                        suspended = True
                        break
                    else:
                        result = outcome.result or ToolResult(
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
                        events.append(
                            AgentEvent(
                                "tool.question",
                                {"callId": cp.call_id, "tool": cp.tool, "question": result.summary, "args": cp.args},
                            )
                        )
                        suspended = True
                        break

            cp.state = result.state
            if token != _DISMISS:  # a real execution
                guard.last_results[sig] = result  # remember for exact-arg suppression (C1a)
                # Progress only if this outcome is *new* this turn — a repeated result means the
                # model is spinning on varied-but-equivalent calls, so it should NOT reset stall.
                rsig = _LoopGuard.result_sig(result)
                if rsig not in guard.seen_results:
                    guard.seen_results.add(rsig)
                    made_progress = True
            result_parts.append(ToolResultPart(call_id=cp.call_id, result=result))
            events.append(
                AgentEvent(
                    "tool.result",
                    {"callId": cp.call_id, "result": result.model_dump(mode="json")},
                )
            )

        # Persist the updated call states + the results gathered this step (a new `tool` message;
        # a suspend may leave it partial — the remaining call carries AWAITING_CONFIRM).
        await self._messages.update(assistant)
        if result_parts:
            await self._messages.add(
                Message(
                    thread_id=thread.id, role="tool", actor=AGENT_ACTOR, parts=list(result_parts)
                )
            )
        return events, suspended, made_progress


def _parse_args(raw: str) -> dict:
    """Parse the model's raw tool-call arguments JSON. A malformed/empty blob becomes `{}` so the
    downstream `input_model` validation produces a clean error result the model can self-correct."""
    if not raw or not raw.strip():
        return {}
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        return {}
    return parsed if isinstance(parsed, dict) else {}
