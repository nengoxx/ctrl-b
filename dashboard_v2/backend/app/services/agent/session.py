"""AgentSession — drives one chat turn, streaming SSE events (DESIGN §5.2, §12).

Phase 4a is the text-only slice of the loop: assemble context → call the model (streaming) →
emit deltas → persist. The tool-call branch (parse calls → permission gate → execute → loop) and
compaction slot into `run_turn` in 4b/4e without changing the event contract below.

Event contract (subset of DESIGN §12, what 4a emits):
    message.start    {messageId, role}
    reasoning.delta  {messageId, delta}     # thinking model's chain-of-thought (dimmed in UI)
    text.delta       {messageId, delta}     # answer content
    message.end      {messageId}
    error            {message, retryable}
    done             {threadId, state}      # completed | error

The assistant `messageId` is minted up front so every delta references it. Reasoning is streamed
for display but NOT replayed into the model's next context (it's scratchpad, not durable content).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import AsyncIterator

from app.adapters.inference import InferenceClient, InferenceError
from app.config import Settings
from app.domain.conversation import (
    ErrorPart,
    Message,
    Part,
    ReasoningPart,
    TextPart,
    Thread,
)
from app.domain.enums import Actor
from app.services.conversation import MessageRepo, ThreadRepo

DEFAULT_SYSTEM_PROMPT = (
    "You are ctrl-b, a concise assistant embedded in a single-user homelab control panel. "
    "You help the owner wake, monitor, and manage a small fleet of PCs over their tailnet/LAN. "
    "Answer directly and briefly. You cannot take actions yet (that arrives in a later update) — "
    "if asked to do something, explain what you would do."
)


@dataclass
class AgentEvent:
    event: str
    data: dict = field(default_factory=dict)


class AgentSession:
    """Constructed per turn from the shared deps. Stateless across turns — thread state lives in
    the DB so a dropped SSE stream can reconnect and re-read (DESIGN §5.3)."""

    def __init__(
        self,
        threads: ThreadRepo,
        messages: MessageRepo,
        inference: InferenceClient,
        settings: Settings,
    ) -> None:
        self._threads = threads
        self._messages = messages
        self._inference = inference
        self._settings = settings

    def _system_prompt(self) -> str:
        return self._settings.inference.system_prompt.strip() or DEFAULT_SYSTEM_PROMPT

    async def _assemble(self, thread: Thread) -> list[dict]:
        """Build the OpenAI `messages` array: system prompt + non-compacted history (text only —
        reasoning is the model's scratchpad and is not replayed)."""
        history = await self._messages.list(thread.id, include_compacted=False)
        out: list[dict] = [{"role": "system", "content": self._system_prompt()}]
        for m in history:
            text = m.text()
            if text:
                out.append({"role": m.role, "content": text})
        return out

    async def run_turn(self, thread: Thread, user_text: str) -> AsyncIterator[AgentEvent]:
        """Persist the user message, stream the assistant reply, persist it. Yields SSE events."""
        user_msg = Message(
            thread_id=thread.id, role="user", actor=Actor.USER, parts=[TextPart(text=user_text)]
        )
        await self._messages.add(user_msg)

        messages = await self._assemble(thread)
        assistant = Message(thread_id=thread.id, role="assistant", actor=Actor.AGENT)
        yield AgentEvent("message.start", {"messageId": assistant.id, "role": "assistant"})

        reasoning_buf: list[str] = []
        text_buf: list[str] = []
        try:
            async for delta in self._inference.stream_chat(messages):
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
        parts.append(TextPart(text="".join(text_buf)))
        assistant.parts = parts
        await self._messages.add(assistant)
        await self._threads.touch(thread.id, assistant.ts)

        yield AgentEvent("message.end", {"messageId": assistant.id})
        yield AgentEvent("done", {"threadId": thread.id, "state": "completed"})
