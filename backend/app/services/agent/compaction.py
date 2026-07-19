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
from app.services.agent.turns import _SUSPEND_CALL_STATES
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


@dataclass
class ContextEstimate:
    """`ContextEstimator.estimate`'s verdict: the token estimate + whether it used the telemetry
    anchor (`anchored=False` = the heuristic+overhead fallback). The flag is for the debug line/tests;
    callers price on `.tokens`."""

    tokens: int
    anchored: bool


class ContextEstimator:
    """Session-held ANCHORED context-size estimator (D42 §3-v2 / Wave 2).

    The v1 heuristic (`estimate_tokens`, ~4 chars/token over the working history) MISSES the system
    head + tool schemas the model prefills every call. This anchors the estimate on the real TOTAL
    prompt size of the most recent model call — taken from telemetry (`StreamReport.prompt_tokens`,
    which precedence-picks llama.cpp `prompt_progress.total`, else a cloud `usage.prompt_tokens`) —
    then adds only a heuristic estimate of the messages appended AFTER that call's watermark. With no
    reliable total it falls back to `estimate_tokens(history)` + the caller-supplied A8 head+tools
    `overhead`.

    Stateless-Compactor contract (D42): the SESSION holds this and passes the resulting estimate into
    `should_compact`/`compact` via their `estimated_tokens` param — the Compactor never stores window
    or anchor state. Fresh per turn (the session is per-turn), so no anchor leaks across turns.

    INVALIDATION (anchor dropped → the next estimate is heuristic+overhead):
      - a compaction FOLD — the session calls `invalidate()` at the fold site (the history the anchor
        counted is gone, so the total no longer maps to the shrunk context);
      - a SERVED-ENDPOINT change — `estimate(served_key=…)` uses the anchor only when the endpoint being
        priced matches the one the anchor was measured on (a different backend tokenizes differently);
      - DEGRADED/ABSENT telemetry — `record(total=None)` drops the anchor (a backend without
        `return_progress`/`include_usage` reports no total);
      - the watermark message no longer in history (a defensive backstop to the explicit fold call)."""

    def __init__(self) -> None:
        self._anchor: int | None = None
        self._watermark_id: str | None = None
        self._served_key: str | None = None

    def record(self, *, total: int | None, served_key: str | None, watermark_id: str | None) -> None:
        """Re-anchor after a completed model call. `total` = the backend's TOTAL prompt tokens
        (`StreamReport.prompt_tokens`); `served_key` identifies the endpoint that answered; `watermark_id`
        = the id of the last message in the prompt that was sent. Any missing input (no usable total —
        degraded/absent telemetry) drops the anchor (heuristic mode next)."""
        if total is None or served_key is None or watermark_id is None:
            self.invalidate()
            return
        self._anchor = total
        self._watermark_id = watermark_id
        self._served_key = served_key

    def invalidate(self) -> None:
        """Drop the anchor (called by the session on a fold). The next `estimate` is heuristic+overhead
        until `record` re-anchors."""
        self._anchor = None
        self._watermark_id = None
        self._served_key = None

    def estimate(self, history: list[Message], *, overhead: int, served_key: str | None) -> ContextEstimate:
        """Estimate the working context in tokens. Anchored mode (a live anchor whose `served_key`
        matches the endpoint being priced AND whose watermark is still in `history`): `anchor +
        estimate_tokens(messages after the watermark)` — the anchor already accounts for head+tools, so
        `overhead` is NOT re-added. Otherwise: `estimate_tokens(history) + overhead`."""
        heuristic = ContextEstimate(estimate_tokens(history) + overhead, anchored=False)
        if self._anchor is None or self._watermark_id is None:
            return heuristic
        if served_key is None or served_key != self._served_key:
            return heuristic  # served-endpoint change → the anchor's token count is on a different backend
        idx = _index_after(history, self._watermark_id)
        if idx is None:
            return heuristic  # watermark folded away — backstop to the explicit fold-invalidation
        return ContextEstimate(self._anchor + estimate_tokens(history[idx:]), anchored=True)


def _index_after(history: list[Message], msg_id: str) -> int | None:
    """The index of the first message AFTER the one with id `msg_id`, or `None` if it isn't present."""
    for i, m in enumerate(history):
        if m.id == msg_id:
            return i + 1
    return None


class Compactor:
    """Folds the oldest turns of a thread into a summary when the context grows too large. One
    instance per session is fine — it's stateless (all state is the thread in the DB)."""

    def __init__(self, inference: InferenceClient, messages: MessageRepo, cfg: CompactionCfg) -> None:
        self._inference = inference
        self._messages = messages
        self._cfg = cfg

    async def compact(
        self,
        thread: Thread,
        *,
        force: bool = False,
        window: int | None = None,
        reserve_tokens: int | None = None,
        estimated_tokens: int | None = None,
        clearing_gain: int = 0,
    ) -> CompactionResult | None:
        """Compact the thread if warranted. Returns a `CompactionResult` when it actually compacted,
        else `None` (disabled, under threshold, or nothing safe to fold). `force` (manual `/compact`)
        ignores the threshold but still honours the floor + turn-boundary safety.

        The D42 per-call trigger inputs (all defaulted, so every existing caller/test is unchanged and
        the Compactor stays STATELESS — the session owns this state): `window` = the resolved context
        window (config > probe > None); `reserve_tokens` = the effective `ModelRef.max_tokens` output
        reserve; `estimated_tokens` = the session's anchored context estimate (None ⇒ the v1
        `estimate_tokens(history)` heuristic); `clearing_gain` = the Wave-3 net-of-clearing seam. All
        flow to the single `_over_threshold` predicate."""
        if not self._cfg.enabled and not force:
            return None

        history = await self._messages.list(thread.id, include_compacted=False)
        if not force and not self._over_threshold(
            history,
            window=window,
            reserve_tokens=reserve_tokens,
            estimated_tokens=estimated_tokens,
            clearing_gain=clearing_gain,
        ):
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
        # SYS-1: the summary insert + the per-message `compacted` flips are one logical edit — commit
        # them atomically so a crash mid-loop can't leave the summary AND the unfolded originals both
        # live (duplicated content next turn).
        async with self._messages.db.transaction():
            await self._messages.add(boundary)
            for m in head:
                m.compacted = True
                await self._messages.update(m)
        return CompactionResult(summary_id=boundary.id, removed=len(head), truncated=truncated)

    def _over_threshold(
        self,
        history: list[Message],
        *,
        window: int | None = None,
        reserve_tokens: int | None = None,
        estimated_tokens: int | None = None,
        clearing_gain: int = 0,
    ) -> bool:
        """The enabled+threshold gate — the SINGLE source of compaction's "is the working context big
        enough to fold?" decision, shared by `compact()` and `should_compact()` so the threshold math
        lives in exactly ONE place (no duplicated predicate).

        Trigger (D42): with a resolved `window`, fire when the estimate exceeds `window ×
        threshold_frac − reserve`; with NO window (`None`), fire when the estimate exceeds the absolute
        `threshold_tokens` (v1's unchanged no-regression path). `estimated_tokens` is the session's
        anchored estimate — `None` falls back to the v1 `estimate_tokens(history)` heuristic so every
        existing caller stays valid. `clearing_gain` is the Wave-3 seam (see below)."""
        if not self._cfg.enabled:
            return False
        estimate = estimate_tokens(history) if estimated_tokens is None else estimated_tokens
        # Wave-3 seam (D42 §E / §4-v2): the unconditional assembly-time tool-output trim prices the
        # trigger NET of the tokens it reclaims for free. Named + wired to subtract, but defaulted to 0
        # so it is a no-op THIS wave (nothing computes a gain yet) — Wave 3 passes the `plan_clearing`
        # gain in here without duplicating the threshold math below.
        estimate -= clearing_gain
        return estimate > self._trigger_limit(window, reserve_tokens)

    def _trigger_limit(self, window: int | None, reserve_tokens: int | None) -> float:
        """The compaction trigger line in tokens (D42). With a resolved `window`: `window ×
        threshold_frac`, minus EXACTLY `reserve_tokens` when `reserve_output` is on AND a reserve is
        set (no global cap, no silent down-clamp — the two recorded opencode bugs; unset `max_tokens`
        ⇒ nothing reserved, the `threshold_frac` headroom being the margin). With no window: the
        absolute `threshold_tokens` fallback (v1 semantics)."""
        if window is None:
            return self._cfg.threshold_tokens
        limit = window * self._cfg.threshold_frac
        if self._cfg.reserve_output and reserve_tokens is not None:
            limit -= reserve_tokens
        return limit

    async def should_compact(
        self,
        thread: Thread,
        *,
        window: int | None = None,
        reserve_tokens: int | None = None,
        estimated_tokens: int | None = None,
        clearing_gain: int = 0,
    ) -> bool:
        """Cheap ACA-11 pre-check: will `compact()` actually summarize on this iteration? True iff
        compaction is enabled, the working context is over threshold (`_over_threshold`, the shared
        predicate — never a second copy of the threshold math), AND there is a foldable head (a clean
        turn boundary above the floor, via the same `_split` `compact()` uses). Mirrors `compact()`'s
        non-`force` decision exactly, so the caller's "compacting…" notice never fires on a no-op
        iteration. Does its own history read; at homelab thread sizes the extra list is negligible. The
        D42 trigger inputs (`window`/`reserve_tokens`/`estimated_tokens`/`clearing_gain`) are threaded
        through to `_over_threshold` verbatim — all defaulted (existing callers unchanged)."""
        if not self._cfg.enabled:
            return False
        history = await self._messages.list(thread.id, include_compacted=False)
        if not self._over_threshold(
            history,
            window=window,
            reserve_tokens=reserve_tokens,
            estimated_tokens=estimated_tokens,
            clearing_gain=clearing_gain,
        ):
            return False
        head, _ = self._split(history)
        return bool(head)

    def _split(self, history: list[Message]) -> tuple[list[Message], list[Message]]:
        """Split into (head to fold, tail to keep verbatim). The cut is `keep_last_messages` from the
        end, then snapped *back* to the nearest `user` message so the tail begins on a complete turn
        — never orphaning a `tool` result from its assistant `tool_calls`. A previous summary message
        in the head is folded in again (its content goes to the summarizer), keeping a single rolling
        summary."""
        cut = len(history) - self._cfg.keep_last_messages
        # Never fold a durably-suspended call (AWAITING_CONFIRM/AWAITING_ANSWER) into the head (C5-M2):
        # its eventual resume result would be orphaned from a context that no longer holds the call.
        # Snap the boundary to BEFORE the earliest suspended-call message so it (and its later resume
        # siblings/result) stays verbatim in the tail. Uses turns.py's `_SUSPEND_CALL_STATES` — one
        # source of truth for "this message is mid-suspend", shared with the stale-call reconciler.
        for i, m in enumerate(history):
            if i >= cut:
                break
            if any(cp.state in _SUSPEND_CALL_STATES for cp in m.tool_calls()):
                cut = i
                break
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
