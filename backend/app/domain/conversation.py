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

from pydantic import BaseModel, ConfigDict, Field, model_serializer

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


#: The three attachment kinds (D68 §2). Named here rather than spelled inline on the part, because
#: the store's sniff produces exactly this union and the two must not be able to drift.
AttachmentKind = Literal["image", "text", "pdf"]


class AttachmentPart(BaseModel):
    """One file the owner attached to a user turn (D68 / ATTACHMENTS_PLAN §2).

    **FACTS ONLY — never the data, never a price.** The bytes live in the store
    (`$CTRLB_HOME/attachments/{thread_id}/{name}`) and this part is the durable reference to them:
    inlining base64 here would put tens of megabytes into a JSON column every history read has to
    parse (R61's anti-pattern), and persisting a token estimate would bake today's `attachments.*`
    knobs into rows the estimator re-prices at READ (confirm N1). `inline_chars` is therefore the
    EXTRACTED LENGTH — a property of the file — and never `min(len, max_inline_chars)`.

    **The server constructs every one of these** (E2), at claim time, from the bytes it just landed:
    the client sends opaque staging ids and nothing else, so no field here is ever client-authored.
    `name` is the EXACT stored (collision-suffixed) filename, which is what makes it addressable by
    `read_attachment`; `path` is store-relative (`{thread_id}/{name}`) so the store can be relocated
    with `$CTRLB_HOME` and so the sweep's referenced-set arm has one key to compare against.

    Additive: old message rows carry no attachment parts and load untouched (the union is
    discriminated on `type`, so nothing re-interprets an existing row).
    """

    type: Literal["attachment"] = "attachment"
    #: What the BYTES turned out to be (sniffed, never the extension's claim). `text` covers the
    #: extension-allowlisted text kinds — the one kind bytes cannot authenticate (§2).
    kind: AttachmentKind
    name: str
    #: The Content-Type derived from the sniff (images/pdf) or from the extension table (text).
    #: Never the request's `Content-Type`, which is a client claim.
    mime: str
    #: Store-relative: `{thread_id}/{name}`.
    path: str
    bytes: int = 0
    #: Pixel dimensions for `image` kinds, from the same header reader the media index uses.
    width: int | None = None
    height: int | None = None
    #: The decoded character count of a `text` file (and, from S4, of a PDF's extracted sidecar) —
    #: the FACT the estimator and the injection cap are both derived from, at read.
    inline_chars: int | None = None


Part = Annotated[
    TextPart | ReasoningPart | ToolCallPart | ToolResultPart | ErrorPart | AttachmentPart,
    Field(discriminator="type"),
]


class CallUsage(BaseModel):
    """What one model call cost, as the provider reported it (Phase 18 / C-9, L-11a) — persisted on
    the message that call produced. `model` is the SERVED model id (which may differ from the one
    requested, e.g. after a failover hop); the token counts are the provider's own.

    Every field is nullable and so is the whole object: a backend that reports nothing yields
    `usage: null` rather than a row of zeros (L-2 accepts the gap — the alternative is inventing
    numbers). Cost is deliberately NOT computed here: it is a later join against a price table
    (§2.7), never a capture requirement.

    D62 adds two per-call facts the D62 disclosure row reads: `cached_tokens` (how much of the
    prefill the endpoint reused from its prompt-prefix cache — ACA-18 telemetry, provider-reported)
    and `duration_ms` (the wall time of that one call, MEASURED by us in the inference adapter, not
    reported)."""

    model: str | None = None
    input_tokens: int | None = None
    output_tokens: int | None = None
    #: Prompt tokens the endpoint reused from its prefix cache (ACA-18). `None` = not reported, which
    #: is NOT the same as a cache miss.
    cached_tokens: int | None = None
    #: Wall time of the one model call this message came from, in milliseconds (D62). Measured
    #: monotonically around the call in `adapters/inference.py`, so it is the only field here we own
    #: rather than quote — and the only one a backend that reports nothing can still produce.
    duration_ms: int | None = None

    @classmethod
    def of(
        cls,
        model: str | None,
        input_tokens: int | None,
        output_tokens: int | None,
        *,
        cached_tokens: int | None = None,
        duration_ms: int | None = None,
    ) -> CallUsage | None:
        """The usage to persist, or `None` when the call yielded no fact at all. One construction rule
        for both call sites (the agent loop's streams + the summarizer's buffered call), so "nothing
        reported" can never be persisted as an all-null object at one of them.

        **The D62 collapse rule**: the object collapses to `None` only when EVERY field is `None` —
        i.e. a measured `duration_ms` alone is enough to persist. That keeps the original intent
        intact (never persist a row of zeros / invented numbers) while admitting the one datum that
        is genuinely ours: a duration is measured, not quoted, so recording it is not inventing a
        number. Callers that measure nothing (the summarizer) pass neither keyword and keep exactly
        the pre-D62 behaviour."""
        if model is None and input_tokens is None and output_tokens is None:
            if cached_tokens is None and duration_ms is None:
                return None
        return cls(
            model=model,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            cached_tokens=cached_tokens,
            duration_ms=duration_ms,
        )


class SourceInfo(BaseModel):
    """WHO served one assistant turn — the per-message ROUTING record (D62), persisted beside `usage`
    in `messages.meta`. `usage.model` stays the model-of-record; this object never duplicates it.

    `served` is the provider key that answered (a D48 key — already the owner's friendly name).
    `degraded` says a fallback saved the turn; `from_` (JSON `from`) is then the chain's PRIMARY, the
    endpoint we tried first, and `failed_hops` how many hops died before the winner. `context_window`
    is the served target's effective window (D42 ladder: explicit > probe), snapshotted at serve time
    so the disclosure's "31% of 262k" is priced against what actually served, not today's config.

    JSON shape: keys are emitted ONLY when set (`from`/`failed_hops` on a degraded serve, the window
    when resolvable), so an ordinary serve persists `{"served": …, "degraded": false}` and nothing
    else. `from` is a Python keyword, hence the alias pair + `serialize_by_alias` — so the OUTER
    `Message.model_dump()` (the thread-reload path) emits `from` without having to remember a flag.
    (Spelled as `validation_alias`/`serialization_alias` rather than one `alias`: the same JSON
    contract, but the synthesized `__init__` still accepts the field name — which `alias` hides from
    the type checker even under `populate_by_name`.)"""

    model_config = ConfigDict(populate_by_name=True, serialize_by_alias=True)

    served: str
    degraded: bool = False
    from_: str | None = Field(default=None, validation_alias="from", serialization_alias="from")
    failed_hops: int | None = None
    context_window: int | None = None

    @model_serializer(mode="wrap")
    def _omit_absent(self, handler) -> dict[str, Any]:  # noqa: ANN001 — pydantic's serializer handle
        """Drop the unset keys, so the persisted/wire object carries facts only (see the class note).
        `served`/`degraded` are never None, so the object is never empty."""
        return {k: v for k, v in handler(self).items() if v is not None}

    @classmethod
    def of(
        cls,
        served: str,
        degraded: bool,
        primary: str,
        *,
        failed_hops: int | None = None,
        context_window: int | None = None,
    ) -> SourceInfo | None:
        """The routing record to persist, or `None` when nothing served (a chain that died before any
        endpoint answered leaves `served` empty — the honest gap, mirroring `CallUsage.of`). `primary`
        + `failed_hops` are recorded ONLY on a degraded serve: on the happy path the primary IS the
        server and "fallback from X" would be a lie."""
        if not served:
            return None
        return cls(
            served=served,
            degraded=degraded,
            from_=primary or None if degraded else None,
            failed_hops=failed_hops if degraded else None,
            context_window=context_window,
        )


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
    #: WHO served this assistant turn (D62) — the routing record beside `usage`. Rides the `meta`
    #: column as one more key (like `steer`), emitted only when set; user turns, legacy rows and any
    #: message no model call produced load as `None` ⇒ the pre-D62 who-line, no chip, no disclosure.
    source: SourceInfo | None = None
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

    def attachments(self) -> list[AttachmentPart]:
        """The files attached to this turn (D68) — the same accessor idiom as the pair above, so a
        consumer (assembly, the estimator, the retention sweep) never re-writes the isinstance walk."""
        return [p for p in self.parts if isinstance(p, AttachmentPart)]


class Thread(BaseModel):
    id: str = Field(default_factory=_uid)
    title: str | None = None
    agent: str | None = None  # which AgentDef (D11) — single default agent in 4a
    created_at: datetime = Field(default_factory=_now)
    updated_at: datetime = Field(default_factory=_now)
    archived: bool = False
