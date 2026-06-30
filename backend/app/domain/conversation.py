"""Conversation model — message-has-parts (DESIGN §4, adopted from opencode).

A `Message` carries a list of typed `Part`s rather than a flat string, so one assistant turn can
hold reasoning + text today and tool calls / plans / questions later (4b+) without a schema change.
Parts are a discriminated union on `type`. Phase 4a uses `text` / `reasoning` / `error`; the
tool/question/plan parts (DESIGN §4) slot into the same union in 4b.

Persistence: `messages.parts` is a JSON column (db.py migration 1). The repos serialize this
union with Pydantic, so adding a part type is one class + nothing else.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Annotated, Any, Literal

from pydantic import BaseModel, Field

from app.domain.enums import Actor, RunState
from app.domain.result import ToolResult

Role = Literal["user", "assistant", "system", "tool"]


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _uid() -> str:
    return uuid.uuid4().hex


class TextPart(BaseModel):
    type: Literal["text"] = "text"
    text: str = ""


class ReasoningPart(BaseModel):
    """A thinking model's chain-of-thought — rendered dimmed, excluded from the model's next
    working context (it's the model's scratchpad, not durable content)."""

    type: Literal["reasoning"] = "reasoning"
    text: str = ""


class ToolCallPart(BaseModel):
    """One tool/action the model asked to run (4b). `call_id` ties it to its `ToolResultPart`
    and to the OpenAI `tool_calls[].id` round-trip; `state` tracks the lifecycle the UI renders
    (PENDING → AWAITING_CONFIRM → OK/ERROR/DENIED/SKIPPED). The bubble is built from the pair."""

    type: Literal["tool_call"] = "tool_call"
    call_id: str
    tool: str
    args: dict[str, Any] = Field(default_factory=dict)
    state: RunState = RunState.PENDING


class ToolResultPart(BaseModel):
    """The outcome of a `ToolCallPart` (4b). Lives on a `role="tool"` message so the assembled
    OpenAI context maps cleanly (assistant `tool_calls` → `tool` results by `call_id`)."""

    type: Literal["tool_result"] = "tool_result"
    call_id: str
    result: ToolResult


class ErrorPart(BaseModel):
    type: Literal["error"] = "error"
    message: str
    retryable: bool = False


Part = Annotated[
    TextPart | ReasoningPart | ToolCallPart | ToolResultPart | ErrorPart,
    Field(discriminator="type"),
]


class Message(BaseModel):
    id: str = Field(default_factory=_uid)
    thread_id: str
    role: Role
    parts: list[Part] = Field(default_factory=list)
    actor: Actor = Actor.USER
    ts: datetime = Field(default_factory=_now)
    tokens: int | None = None  # for compaction budgeting (4e)
    compacted: bool = False  # excluded from working context once summarized (4e)
    #: Which AgentDef produced this assistant turn (7e-c, D15 #5). Set to the resolved agent name on
    #: assistant messages; None on user/system turns and legacy rows. `Thread.agent` stays the
    #: thread's primary/default; this is the source of truth for "who said this" per turn.
    agent: str | None = None

    def text(self) -> str:
        """The concatenated `text` parts (the durable answer, excluding reasoning)."""
        return "".join(p.text for p in self.parts if isinstance(p, TextPart))

    def tool_calls(self) -> list[ToolCallPart]:
        return [p for p in self.parts if isinstance(p, ToolCallPart)]

    def tool_results(self) -> list[ToolResultPart]:
        return [p for p in self.parts if isinstance(p, ToolResultPart)]


class Thread(BaseModel):
    id: str = Field(default_factory=_uid)
    title: str | None = None
    agent: str | None = None  # which AgentDef (D11) — single default agent in 4a
    created_at: datetime = Field(default_factory=_now)
    updated_at: datetime = Field(default_factory=_now)
    archived: bool = False
