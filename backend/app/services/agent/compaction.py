"""Context compaction (Phase 4e, D10/D11; DESIGN §5.4).

The agent loop's working context is the **non-compacted** message history (the repo's
`include_compacted=False`). As a thread grows it eventually nears the model's context window, so
before each model call the session asks the `Compactor` to fold the oldest turns into a single
**summary system message**, marking the originals `compacted` — they stay verbatim in SQLite (so
reload + the audit trail keep the full history), they just drop out of the *live* context.

Design points carried from DESIGN §5.4 + §6 (edge cases):
- **Selectable summarizer** (D11): the summary is produced by `settings.agent.compaction.summarizer`
  (its own mode + model), independent of the chat model — `None` fields inherit the chat backend.
- **Turn-boundary safe:** the kept tail always starts at a `user` message, so we never split an
  assistant `tool_calls` message from its `tool` results (which would make the assembled OpenAI
  context invalid). Complete turns go into the summary; complete turns stay verbatim.
- **Floor:** never compact below `keep_last_messages` recent messages (snapped to that boundary).
- **Never lose history:** on summarizer failure we fall back to a truncation *placeholder* (still
  flip the head `compacted` so the context shrinks and the next call can't blow the window) — DB
  rows are never deleted, only their `compacted` flag flips.

There is no separate compaction store: the summary is a real `system` message timestamped at the
boundary, so it round-trips through `_assemble` and `GET /threads/{id}/messages` like any other.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import timedelta

from app.adapters.inference import InferenceClient, InferenceError
from app.config import CompactionCfg
from app.domain.conversation import (
    Message,
    TextPart,
    Thread,
    ToolCallPart,
    ToolResultPart,
)
from app.domain.enums import Actor
from app.services.conversation import MessageRepo

#: Marks a compaction-summary system message so repeated compaction can recognise + re-fold it.
SUMMARY_PREFIX = "[Earlier conversation summary]\n"
#: Inserted instead of a summary when the summarizer backend is unavailable (truncation fallback).
TRUNCATION_NOTICE = "[Earlier messages were dropped to stay within the context window.]"

_SUMMARIZER_SYSTEM = (
    "You compress the earlier part of a conversation between a user and an assistant that controls "
    "a single-user homelab (waking/monitoring/managing PCs and services). Produce a concise summary "
    "that preserves what later turns will need: the user's goals and requests, key facts learned, "
    "actions taken and their outcomes, decisions made, and anything still pending or unresolved. "
    "Use terse bullet points; omit pleasantries. This summary will replace the omitted messages in "
    "the assistant's working context, so keep every load-bearing detail and drop the rest."
)


@dataclass
class CompactionResult:
    summary_id: str  # id of the inserted summary system message
    removed: int  # how many messages were folded away (now `compacted`)
    truncated: bool  # True if the summarizer failed and we fell back to a placeholder


#: The one ~4-chars/token heuristic shared by both estimators below (message-shaped + payload-shaped).
#: One constant, one heuristic — not two competing estimators.
CHARS_PER_TOKEN = 4


def estimate_tokens(messages: list[Message]) -> int:
    """Rough token estimate for the working context — ~4 chars/token plus per-message overhead.

    Reasoning parts are excluded (they're the model's scratchpad, never replayed into context by
    `_assemble`); tool calls/results are counted at the size they round-trip into the OpenAI payload.
    Deliberately cheap + slightly conservative (overestimating just compacts a little earlier)."""
    chars = 0
    for m in messages:
        chars += 4  # role + framing overhead per message
        for p in m.parts:
            if isinstance(p, TextPart):
                chars += len(p.text)
            elif isinstance(p, ToolCallPart):
                chars += len(p.tool) + len(json.dumps(p.args))
            elif isinstance(p, ToolResultPart):
                r = p.result
                chars += len(r.summary) + len(r.output or "") + len(r.error or "")
            # ReasoningPart intentionally skipped (dropped from context)
    return chars // CHARS_PER_TOKEN


def estimate_payload_tokens(payload: list[dict]) -> int:
    """The payload-shaped counterpart of `estimate_tokens`, sharing the SAME `CHARS_PER_TOKEN`
    heuristic (not a second estimator — the same ratio applied to a different shape). Estimates a raw
    OpenAI wire payload — the assembled `messages` dicts and the tool-schema dicts — which are NOT
    `Message` objects, so `estimate_tokens` can't consume them. Used only by the A8 context-cost debug
    line (session.py), which measures the tools + system head the model prefills each call."""
    return sum(len(json.dumps(d, default=str)) for d in payload) // CHARS_PER_TOKEN


class Compactor:
    """Folds the oldest turns of a thread into a summary when the context grows too large. One
    instance per session is fine — it's stateless (all state is the thread in the DB)."""

    def __init__(self, inference: InferenceClient, messages: MessageRepo, cfg: CompactionCfg) -> None:
        self._inference = inference
        self._messages = messages
        self._cfg = cfg

    async def compact(self, thread: Thread, *, force: bool = False) -> CompactionResult | None:
        """Compact the thread if warranted. Returns a `CompactionResult` when it actually compacted,
        else `None` (disabled, under threshold, or nothing safe to fold). `force` (manual `/compact`)
        ignores the threshold but still honours the floor + turn-boundary safety."""
        if not self._cfg.enabled and not force:
            return None

        history = await self._messages.list(thread.id, include_compacted=False)
        if not force and estimate_tokens(history) <= self._cfg.threshold_tokens:
            return None

        head, tail = self._split(history)
        if not head:
            return None  # everything is within the floor / no clean boundary — nothing to fold

        summary, truncated = await self._summarize(head)
        boundary = Message(
            thread_id=thread.id,
            role="system",
            actor=Actor.AGENT,
            parts=[TextPart(text=summary)],
            # Timestamp just before the kept tail so the summary sorts ahead of it (and after the
            # folded head) on the `ORDER BY ts ASC` reload.
            ts=tail[0].ts - timedelta(microseconds=1),
        )
        await self._messages.add(boundary)
        for m in head:
            m.compacted = True
            await self._messages.update(m)
        return CompactionResult(summary_id=boundary.id, removed=len(head), truncated=truncated)

    def _split(self, history: list[Message]) -> tuple[list[Message], list[Message]]:
        """Split into (head to fold, tail to keep verbatim). The cut is `keep_last_messages` from the
        end, then snapped *back* to the nearest `user` message so the tail begins on a complete turn
        — never orphaning a `tool` result from its assistant `tool_calls`. A previous summary message
        in the head is folded in again (its content goes to the summarizer), keeping a single rolling
        summary."""
        cut = len(history) - self._cfg.keep_last_messages
        while cut > 0 and history[cut].role != "user":
            cut -= 1
        if cut <= 0:
            return [], history
        return history[:cut], history[cut:]

    async def _summarize(self, head: list[Message]) -> tuple[str, bool]:
        """Summarize the head via the selected summarizer model. On failure, fall back to a
        truncation placeholder (DESIGN §5.4) so the context still shrinks. Returns (text, truncated)."""
        transcript = _render_transcript(head)
        s = self._cfg.summarizer
        try:
            body = await self._inference.complete(
                [
                    {"role": "system", "content": _SUMMARIZER_SYSTEM},
                    {"role": "user", "content": transcript},
                ],
                mode=s.mode,
                model=s.model,
            )
            body = body.strip()
        except InferenceError:
            return TRUNCATION_NOTICE, True
        if not body:
            return TRUNCATION_NOTICE, True
        return SUMMARY_PREFIX + body, False


def _render_transcript(head: list[Message]) -> str:
    """Render the messages to fold into a plain-text transcript for the summarizer. Tool calls +
    their results are mapped by `call_id` so each action reads as a single line with its outcome."""
    tool_names: dict[str, str] = {}
    for m in head:
        for cp in m.tool_calls():
            tool_names[cp.call_id] = cp.tool

    lines: list[str] = []
    for m in head:
        text = m.text().strip()
        if m.role == "user":
            if text:
                lines.append(f"User: {text}")
        elif m.role == "system":
            # A prior rolling summary — feed it back so it's carried forward, not lost.
            body = text.removeprefix(SUMMARY_PREFIX).strip()
            if body:
                lines.append(f"[Previous summary]\n{body}")
        elif m.role == "assistant":
            if text:
                lines.append(f"Assistant: {text}")
            for cp in m.tool_calls():
                args = json.dumps(cp.args) if cp.args else "{}"
                lines.append(f"Assistant called {cp.tool}({args})")
        elif m.role == "tool":
            for rp in m.tool_results():
                name = tool_names.get(rp.call_id, "tool")
                r = rp.result
                outcome = f"→ {name} [{r.state.value}] {r.summary}"
                if r.output:
                    outcome += f" · {r.output}"
                lines.append(outcome)
    return "\n".join(lines)
