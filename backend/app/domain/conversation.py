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
    #: The model's raw argument blob when it wasn't a valid JSON object (truncated ≤200 chars).
    #: Presence (`is not None`) means "do NOT invoke — synthesize the ACA-13 JSON-repair steering
    #: error" instead; `args` stays `{}` so the assembled OpenAI context never carries the invalid
    #: blob. Additive + default None, so old DB rows / persisted JSON load fine (ACA-13 resume-safe:
    #: the marker rides the persisted part, not a memory-only side-channel).
    invalid_raw: str | None = None


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


class CallUsage(BaseModel):
    """What one model call cost, as the provider reported it (Phase 18 / C-9, L-11a) — persisted on
    the message that call produced. `model` is the SERVED model id (which may differ from the one
    requested, e.g. after a failover hop); the token counts are the provider's own.

    Every field is nullable and so is the whole object: a backend that reports nothing yields
    `usage: null` rather than a row of zeros (L-2 accepts the gap — the alternative is inventing
    numbers). Cost is deliberately NOT computed here: it is a later join against a price table
    (§2.7), never a capture requirement."""

    model: str | None = None
    input_tokens: int | None = None
    output_tokens: int | None = None

    @classmethod
    def of(cls, model: str | None, input_tokens: int | None, output_tokens: int | None) -> CallUsage | None:
        """The usage to persist, or `None` when the provider reported nothing at all. One
        construction rule for both call sites (the agent loop's streams + the summarizer's buffered
        call), so "nothing reported" can never be persisted as an all-null object at one of them."""
        if model is None and input_tokens is None and output_tokens is None:
            return None
        return cls(model=model, input_tokens=input_tokens, output_tokens=output_tokens)


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
    #: WHICH PROMPT VERSIONS fed this message's turn (Phase 18 / C-8): `{registry id: sha256 of the
    #: effective template before substitution}`, following the OTel GenAI attribute pair
    #: `gen_ai.prompt.name`/`gen_ai.prompt.version` (the names, not OTLP spans). `None` on user turns,
    #: legacy rows, and any message no model call produced. The eval seam: a stored transcript is
    #: attributable to the exact prompt VERSION that produced it without a new table (L-2).
    #:
    #: **TURN-SCOPED, not per-call**: every registry prompt rendered during this turn up to the moment
    #: this message was written, latest hash per id. That is the honest description of the payload —
    #: a C2 steering text resolved at iteration N persists as a tool result and really is in every
    #: later call's context — and it is what makes a mid-turn edit visible (the earlier message keeps
    #: the old hash, the later one carries the new). Run-level eval aggregates are unions over a
    #: thread's messages, which are identical under per-call and turn-scoped stamping.
    prompt_stamps: dict[str, str] | None = None
    #: What that call cost, as reported (C-9). `None` when the provider reported nothing.
    usage: CallUsage | None = None
    #: This `role="user"` row is a MID-TURN STEER (D41 Drain A), not the message that opened a turn.
    #: A steer persists in exactly the shape a composer message does, which is right for the model's
    #: context but wrong for anything walking back to "where did this logical turn begin" — D57's
    #: `_seed_recall` walked to the last user row and a steer would have cut the turn in half, handing
    #: the resumed session a fresh recall allowance. Rides the `meta` column as one more key (the
    #: documented extension path), emitted only when true; historical rows load as False.
    steer: bool = False

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
