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
    message.start    {messageId, role}
    reasoning.delta  {messageId, delta}       # thinking model's chain-of-thought (dimmed)
    text.delta       {messageId, delta}       # answer content
    part.added       {messageId, part}        # a tool_call part — UI renders the command bubble
    tool.permission  {callId, tool, args, risk, token, prompt}   # confirm bubble
    tool.result      {callId, result}         # bubble resolves
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

from app.adapters.inference import InferenceClient, InferenceError
from app.config import Settings
from app.core.tool import UnknownTool
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
from app.domain.enums import Actor, Privilege, RunState
from app.domain.result import ToolResult
from app.services.action_service import ActionService
from app.services.conversation import MessageRepo, ThreadRepo

DEFAULT_SYSTEM_PROMPT = (
    "You are ctrl-b, a concise assistant embedded in a single-user homelab control panel. "
    "You help the owner wake, monitor, and manage a small fleet of PCs over their tailnet/LAN. "
    "You can call the provided tools to inspect and control the fleet (wake/ping hosts, start/stop "
    "services, etc.). Prefer a tool over guessing. Risky actions (shutdown, stop/restart a service) "
    "will ask the owner to confirm before running — propose them when appropriate. Resolve a host "
    "or service the owner names to its stable `id` yourself using the fleet roster provided below — "
    "never ask the owner for an id. Answer directly and briefly; after a tool runs, summarize the "
    "outcome in one or two lines."
)

#: The default chat agent's actor + privilege. CONFIRM means low-risk tools auto-run while
#: med/high-risk ones (shutdown, stop/restart) gate on a confirm bubble (DESIGN §3 decide()).
#: An `AgentDef` (4.5) will make these per-agent; today there's one default agent.
AGENT_ACTOR = Actor.AGENT
AGENT_PRIVILEGE = Privilege.CONFIRM
MAX_ITERATIONS = 8

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
    ) -> None:
        self._threads = threads
        self._messages = messages
        self._inference = inference
        self._settings = settings
        self._actions = actions

    def _system_prompt(self) -> str:
        return self._settings.inference.system_prompt.strip() or DEFAULT_SYSTEM_PROMPT

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
        return self._actions.registry.to_openai_tools()

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
        roster = self._roster()
        if roster:
            out.append({"role": "system", "content": roster})
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

    async def run_turn(self, thread: Thread, user_text: str) -> AsyncIterator[AgentEvent]:
        """Persist the user message, then drive the loop. Yields SSE events."""
        user_msg = Message(
            thread_id=thread.id, role="user", actor=Actor.USER, parts=[TextPart(text=user_text)]
        )
        await self._messages.add(user_msg)
        async for ev in self._drive(thread):
            yield ev

    async def resume(
        self, thread: Thread, call_id: str, decision: str, confirm_token: str | None = None
    ) -> AsyncIterator[AgentEvent]:
        """Resume a suspended turn: execute (with the token) or dismiss the awaited call, finish
        that step, then continue the loop so the model can react to the result."""
        assistant = await self._find_pending(thread, call_id)
        if assistant is None:
            yield AgentEvent(
                "error", {"message": "no pending confirmation for this action", "retryable": False}
            )
            yield AgentEvent("done", {"threadId": thread.id, "state": "error"})
            return
        token = _DISMISS if decision == "dismiss" else confirm_token
        async for ev in self._drive(thread, resume_assistant=assistant, resume_tokens={call_id: token}):
            yield ev

    async def _find_pending(self, thread: Thread, call_id: str) -> Message | None:
        for m in await self._messages.list(thread.id):
            if m.role != "assistant":
                continue
            for cp in m.tool_calls():
                if cp.call_id == call_id and cp.state == RunState.AWAITING_CONFIRM:
                    return m
        return None

    async def _drive(
        self,
        thread: Thread,
        *,
        resume_assistant: Message | None = None,
        resume_tokens: dict[str, str | None] | None = None,
    ) -> AsyncIterator[AgentEvent]:
        """The loop state machine (DESIGN §5.2). On resume, first finish the suspended step; then
        run model iterations until text-only / suspended / capped."""
        if resume_assistant is not None:
            events, suspended = await self._run_calls(thread, resume_assistant, resume_tokens or {})
            for ev in events:
                yield ev
            if suspended:
                yield AgentEvent("done", {"threadId": thread.id, "state": "suspended"})
                return

        for _ in range(MAX_ITERATIONS):
            messages = await self._assemble(thread)
            assistant = Message(thread_id=thread.id, role="assistant", actor=AGENT_ACTOR)
            yield AgentEvent("message.start", {"messageId": assistant.id, "role": "assistant"})

            reasoning_buf: list[str] = []
            text_buf: list[str] = []
            reqs = []
            try:
                async for delta in self._inference.stream_chat(messages, tools=self._tools()):
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

            events, suspended = await self._run_calls(thread, assistant, {})
            for ev in events:
                yield ev
            if suspended:
                yield AgentEvent("done", {"threadId": thread.id, "state": "suspended"})
                return
            # else: loop — call the model again so it can react to the tool results

        yield AgentEvent("done", {"threadId": thread.id, "state": "capped"})

    async def _run_calls(
        self, thread: Thread, assistant: Message, resume_tokens: dict[str, str | None]
    ) -> tuple[list[AgentEvent], bool]:
        """Process the assistant's not-yet-resolved tool calls in order. ALLOW runs immediately via
        `ActionService` (which validates, decides, executes, records the Event); DENY/bad-args
        synthesize a clean result fed back to the model; CONFIRM suspends (persist AWAITING_CONFIRM,
        emit `tool.permission`, stop). Returns (events, suspended). Tool execution is fast (local
        ping/SSH), so a step's results are batched here while the slow model call streams live."""
        events: list[AgentEvent] = []
        result_parts: list[ToolResultPart] = []
        suspended = False

        for cp in assistant.tool_calls():
            if cp.state in _RESOLVED:
                continue  # already ran (resume: an earlier call in this step)

            if resume_tokens.get(cp.call_id) == _DISMISS:
                result: ToolResult = ToolResult(
                    state=RunState.SKIPPED, summary=f"{cp.tool} dismissed by the owner"
                )
            else:
                token = resume_tokens.get(cp.call_id)
                try:
                    outcome = await self._actions.invoke(
                        cp.tool,
                        cp.args,
                        actor=AGENT_ACTOR,
                        privilege=AGENT_PRIVILEGE,
                        confirm_token=token,
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
                    if outcome.needs_confirm:
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
                    result = outcome.result or ToolResult(
                        state=RunState.ERROR, summary=f"{cp.tool} returned no result"
                    )

            cp.state = result.state
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
        return events, suspended


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
