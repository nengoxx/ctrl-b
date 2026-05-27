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
from typing import Annotated, Literal

from pydantic import BaseModel, Field

from app.domain.enums import Actor

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


class ErrorPart(BaseModel):
    type: Literal["error"] = "error"
    message: str
    retryable: bool = False


Part = Annotated[TextPart | ReasoningPart | ErrorPart, Field(discriminator="type")]


class Message(BaseModel):
    id: str = Field(default_factory=_uid)
    thread_id: str
    role: Role
    parts: list[Part] = Field(default_factory=list)
    actor: Actor = Actor.USER
    ts: datetime = Field(default_factory=_now)
    tokens: int | None = None  # for compaction budgeting (4e)
    compacted: bool = False  # excluded from working context once summarized (4e)

    def text(self) -> str:
        """The concatenated `text` parts (the durable answer, excluding reasoning)."""
        return "".join(p.text for p in self.parts if isinstance(p, TextPart))


class Thread(BaseModel):
    id: str = Field(default_factory=_uid)
    title: str | None = None
    agent: str | None = None  # which AgentDef (D11) — single default agent in 4a
    created_at: datetime = Field(default_factory=_now)
    updated_at: datetime = Field(default_factory=_now)
    archived: bool = False
