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
import logging
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from datetime import timedelta

from app.adapters.inference import InferenceClient, InferenceError, StreamReport
from app.config import CompactionCfg, Settings
from app.domain.conversation import (
    CallUsage,
    Message,
    TextPart,
    Thread,
    ToolCallPart,
    ToolResultPart,
)
from app.domain.enums import Actor
from app.services.agent.prompts import resolve
from app.services.agent.turns import _SUSPEND_CALL_STATES
from app.services.conversation import MessageRepo

log = logging.getLogger("ctrlb.compaction")

#: Marks a compaction-summary system message so repeated compaction can recognise + re-fold it.
SUMMARY_PREFIX = "[Earlier conversation summary]\n"
#: Inserted instead of a summary when the summarizer backend is unavailable (truncation fallback).
TRUNCATION_NOTICE = "[Earlier messages were dropped to stay within the context window.]"

#: The fixed five-section summarizer template (D42 Wave 3), replacing the v1 free-form prompt. The
#: section NAMES "Rules & Constraints" + "Next Steps" are ACA-pinned; the other three are the
#: field-standard shape (goals/requests · key facts/state · actions & outcomes). The model fills
#: EVERY section (or "none"), and "pending"/"next" is scoped to the folded head it is shown — never
#: the kept tail it can't see. A prior rolling summary in the head is re-folded by `_render_transcript`.
_SUMMARIZER_SECTIONS = (
    "Goals & Requests",
    "Key Facts & State",
    "Actions Taken & Outcomes",
    "Rules & Constraints",
    "Next Steps",
)
#: The section list as the `summarizer` prompt's `{{sections}}` value. The names are this module's
#: data (the registry owns the words around them, L-8), so the rendering lives here, once.
_SUMMARIZER_SECTION_BLOCK = "".join(f"## {s}\n" for s in _SUMMARIZER_SECTIONS)
#: Fraction of the summarizer endpoint's own window reserved (system prompt + generated summary) by
#: the overflow guard (D42): a transcript estimated ABOVE `window × (1 − this)` would push a doomed
#: call, so the summarizer is skipped for the truncation-fold instead. 0.2 = a generous margin
#: (the fixed template is small; the bulk of the reserve is headroom for the summary the model writes).
_SUMMARIZER_MARGIN_FRAC = 0.2

#: The Tier-1 assembly-time clearing placeholder (D42 §4-v2) — replaces ONLY a cleared tool result's
#: OUTPUT payload (its `[state] summary` line + any error survive). A11/A12: rendering-time only; the
#: DB row stays verbatim, so `GET /threads/{id}/messages` is unchanged.
OUTPUT_CLEARED_PLACEHOLDER = "[output cleared — re-run the tool if needed]"

#: Conservative pricing ratio for the clearing gain (D42): chars/5, deliberately BELOW the chars/4
#: `CHARS_PER_TOKEN` the estimator counts an output at — so subtracting the priced gain from the
#: estimate UNDER-removes headroom (clearing can never over-promise → the trigger never fires too
#: late because it over-credited a free trim). One named constant carrying that rationale, priced
#: PER-OUTPUT into `ClearingPlan.gains` so a subset can be re-priced without a second formula.
#:
#: The credit is applied differently by estimator mode (R1): in HEURISTIC mode the trigger subtracts
#: the FULL priced gain (the heuristic history-estimate still counts every cleared output at chars/4);
#: in ANCHORED mode the telemetry anchor already reflects the prompt AS-TRIMMED at anchor time, so the
#: trigger credits ONLY the outputs cleared SINCE that anchor (`gain_over(cleared_now − cleared_at_
#: anchor)`) — subtracting the full gain there would double-count the anchor-time trim.
CLEAR_CHARS_PER_TOKEN = 5

#: Builtin tools whose results are STRUCTURALLY never cleared (D42): `task_plan` (the live plan
#: round-trips through the model's context) + `memory` (durable-memory edits). Matched by the paired
#: call's `tool` name — the same by-name convention session.py uses (`cp.tool == "question"`). These
#: are the canonical builtin keys registered by `@action("task_plan"/"memory", …)`.
_NEVER_CLEAR_TOOLS = frozenset({"task_plan", "memory"})


@dataclass
class CompactionResult:
    summary_id: str  # id of the inserted summary system message ("" when rejected — nothing inserted)
    removed: int  # how many messages were folded away (now `compacted`); 0 when rejected
    truncated: bool  # True if the summarizer failed and we fell back to a placeholder
    #: Inflation-reject (D42 Wave 3): the produced summary would NOT shrink the working context
    #: (summary estimate ≥ the folded head's estimate), so the fold was ABANDONED — no DB write, the
    #: head stays live. This is the thrash machine's ONLY "failure" signal (a truncation-fold that
    #: shrinks is a SUCCESS). `force` (manual `/compact`) bypasses threshold/backoff/breaker but NEVER
    #: this reject. Surfaced in the `/compact` endpoint JSON.
    rejected: bool = False


@dataclass
class _SummaryCall:
    """Out-param for `_summarize` (the `StreamReport`/`_BatchOutcome` holder pattern — a helper that
    already returns its text can't also return this). Carries what the summary MESSAGE stamps
    (Phase 18): the `{summarizer: template hash}` identity of the prompt that produced it (C-8) and
    the token usage the summarizer endpoint reported (C-9). Both stay `None` when no model call
    happened — a truncation-fold notice has no prompt and no cost to attribute."""

    prompt_stamps: dict[str, str] | None = None
    usage: CallUsage | None = None


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


@dataclass(frozen=True)
class ClearingPlan:
    """The Tier-1 clearing selection for ONE iteration (D42 §4-v2). Produced by the PURE, shared
    `plan_clearing` and fed to BOTH consumers so there is exactly one selection, priced once:
      - the session's `_assemble` renders a cleared result's OUTPUT as `OUTPUT_CLEARED_PLACEHOLDER`
        (its `[state] summary` line + error survive) for every `call_id` in `cleared_call_ids`;
      - the trigger prices net of this trim, and the inflation-reject prices the folded head net of it.
    `gains` maps each cleared `call_id` → its reclaimed tokens priced at chars/`CLEAR_CHARS_PER_TOKEN`
    (conservative). Pricing lives ONLY in `plan_clearing`; `gain`/`gain_over` just sum those values, so
    a subset (the anchored-delta trigger credit R1, the head-net reject R5) is re-priced with no second
    formula."""

    cleared_call_ids: frozenset[str]
    gains: Mapping[str, int]

    @property
    def gain(self) -> int:
        """Total reclaimed tokens across every cleared output — the HEURISTIC-mode trigger credit."""
        return sum(self.gains.values())

    @property
    def empty(self) -> bool:
        return not self.cleared_call_ids

    def gain_over(self, call_ids: Iterable[str]) -> int:
        """The priced gain summed over just `call_ids` — the SAME per-output prices, restricted to a
        subset (a call_id not in the plan contributes 0). Powers the anchored-delta trigger credit (R1)
        and the head-net inflation-reject (R5) off one home, never a second pricing pass."""
        return sum(self.gains.get(cid, 0) for cid in call_ids)


def plan_clearing(history: list[Message], cfg: CompactionCfg) -> ClearingPlan:
    """Select tool-result OUTPUTS to clear at assembly time + price the total gain (D42 Tier 1) — a
    PURE function (no I/O), the ONE source of truth shared by `_assemble` and the trigger.

    Selection: a tool result is cleared iff its OUTPUT is larger than `clear_output_min_tokens`
    (measured in tokens, chars/`CHARS_PER_TOKEN`) AND longer than `OUTPUT_CLEARED_PLACEHOLDER` itself
    (net-positive — clearing a tinier output to the placeholder would GROW the prompt; Codex FIX 5) AND
    its paired call is OLDER than the most recent
    `clear_keep_steps` steps — where a **step** is one assistant message that carries tool calls (i.e.
    one assistant-tool-call round; each loop iteration mints exactly one). The last `clear_keep_steps`
    such rounds stay FULL (`clear_keep_steps ≥ 1` keeps at least the just-run tool's output).

    STRUCTURAL exemptions (never cleared, by shape not by string-matching content):
      - a call in `_SUSPEND_CALL_STATES` (AWAITING_*-paired — its result round-trips on resume);
      - a `task_plan` / `memory` result (`_NEVER_CLEAR_TOOLS`);
      - a SYNTHESIZED result — one that never came from a real tool execution (a skipped/denied/
        steering placeholder, an injected answer). The structural marker is `result.duration_ms is
        None`: `ActionService._execute` stamps `duration_ms` on every genuine run, so a result built
        directly in the session/service (no run) leaves it unset. Matched on the shape, never on text.

    Gain is priced at chars/`CLEAR_CHARS_PER_TOKEN` (below the estimator's chars/`CHARS_PER_TOKEN`) over
    the NET reclaimed chars — the output length MINUS the `OUTPUT_CLEARED_PLACEHOLDER` that replaces it
    (Codex FIX 5) — so subtracting it under-credits the trim and the trigger never fires too late nor
    over-credits a near-placeholder-sized clear. Gated on `cfg.enabled` (the master switch); the run is
    otherwise UNCONDITIONAL (not gated on being over threshold)."""
    if not cfg.enabled:
        return ClearingPlan(frozenset(), {})
    # Map each call to (its ToolCallPart, the ordinal of the step it belongs to). A "step" is an
    # assistant message bearing tool calls — the results paired to the last `clear_keep_steps` of
    # these stay full.
    calls_by_id: dict[str, ToolCallPart] = {}
    step_of: dict[str, int] = {}
    n_steps = 0
    for m in history:
        tcs = m.tool_calls()
        if not tcs:
            continue
        for cp in tcs:
            calls_by_id[cp.call_id] = cp
            step_of[cp.call_id] = n_steps
        n_steps += 1
    keep_from = n_steps - cfg.clear_keep_steps  # steps with ordinal ≥ this are protected (recent)

    cleared: set[str] = set()
    gains: dict[str, int] = {}
    for m in history:
        if m.role != "tool":
            continue
        for rp in m.tool_results():
            cp = calls_by_id.get(rp.call_id)
            if cp is None:
                continue  # orphan result (no paired call) — leave alone
            if step_of.get(rp.call_id, 0) >= keep_from:
                continue  # within the most-recent `clear_keep_steps` rounds — kept full
            if cp.state in _SUSPEND_CALL_STATES or cp.tool in _NEVER_CLEAR_TOOLS:
                continue  # structural exemptions (suspend-paired / task_plan / memory)
            res = rp.result
            if res.duration_ms is None:
                continue  # synthesized/steering placeholder — never a real tool output
            out = res.output or ""
            if len(out) // CHARS_PER_TOKEN <= cfg.clear_output_min_tokens:
                continue  # below the trim floor — not worth clearing
            # D42 Codex FIX 5: clearing REPLACES the output with `OUTPUT_CLEARED_PLACEHOLDER`, so an
            # output no longer than the placeholder would GROW the prompt (and, at `clear_output_min_
            # tokens: 0`, still earn positive credit). Require net-positive, and price the NET reclaimed
            # chars (output minus the placeholder that replaces it) — floor 0 handled by this check.
            if len(out) <= len(OUTPUT_CLEARED_PLACEHOLDER):
                continue
            cleared.add(rp.call_id)
            # priced once, here — the one home; NET of the placeholder (Codex FIX 5).
            gains[rp.call_id] = (len(out) - len(OUTPUT_CLEARED_PLACEHOLDER)) // CLEAR_CHARS_PER_TOKEN
    return ClearingPlan(frozenset(cleared), gains)


@dataclass
class CompactionState:
    """Per-thread thrash-machine view (D42 Wave 3), held in `app.state.compaction_state` (the
    `turn_terminals` / steer-queue precedent — thread-id-keyed, outliving any one turn). The
    `Compactor` stays STATELESS: the SESSION owns the reads/writes and passes decisions in, exactly as
    D41 injected `steer_source`. Restart resets it (in-memory; a recorded residual — fine).

    `consecutive_failures` counts back-to-back inflation-rejects (a shrinking fold resets it);
    `breaker_latched` stops AUTO-compaction attempting on this thread once the cap is hit (manual
    `/compact` with `force` still runs); `notice_emitted` guards the single latch breadcrumb. The
    per-turn backoff (no re-attempt until the NEXT turn after a failure) is a turn-LOCAL flag in
    `_drive` — the session is per-turn, so a fresh `_drive` clears it for free with no turn-id
    bookkeeping here."""

    consecutive_failures: int = 0
    breaker_latched: bool = False
    notice_emitted: bool = False


def compaction_state_for(state, thread_id: str) -> CompactionState:
    """The per-thread `CompactionState` the session injects (D42 Wave 3) — lazily created + memoized in
    `app.state.compaction_state`, so the breaker/failure counter persist across a thread's turns (the
    session is rebuilt per turn). Mirrors `steer_source_for`; the session never reaches into the map."""
    store = state.compaction_state
    st = store.get(thread_id)
    if st is None:
        st = CompactionState()
        store[thread_id] = st
    return st


def prune_compaction_state(store: dict[str, CompactionState], thread_id: str) -> None:
    """Drop a thread's thrash-machine entry IFF it is back to all-defaults (D42 R3) — the failure
    counter, the latching breaker, and the notice guard are all clear, so `compaction_state_for` can
    re-mint an identical fresh one lazily with nothing lost. A LATCHED breaker (or any live residual)
    is preserved: the cross-turn latch must survive until a manual `/compact` resets it. Mirrors
    `steering.prune_if_empty` — keeps `app.state.compaction_state` from accumulating dead threads.
    Call it wherever the store owner has a `(store, thread_id)` in hand: after a manual-compact reset,
    and (if a thread-delete path is ever added) beside its other per-thread cleanup."""
    st = store.get(thread_id)
    if st is not None and st == CompactionState():
        del store[thread_id]


@dataclass
class ContextEstimate:
    """`ContextEstimator.estimate`'s verdict: the token estimate + whether it used the telemetry
    anchor (`anchored=False` = the heuristic+overhead fallback). The flag is for the debug line/tests;
    callers price on `.tokens`.

    `cleared_at_anchor` (R1) carries the set of tool-result `call_id`s that were ALREADY trimmed out of
    the anchored prompt when it was measured — `None` in heuristic mode (the trigger then credits the
    full clearing gain), the recorded set in anchored mode (the trigger credits only the delta cleared
    SINCE, so the anchor-time trim isn't double-counted)."""

    tokens: int
    anchored: bool
    cleared_at_anchor: frozenset[str] | None = None


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
        #: R1: the clearing selection that was applied to the anchored prompt (the outputs already
        #: trimmed out of the total the anchor holds). Empty until the first `record` with a plan.
        self._cleared_at_anchor: frozenset[str] = frozenset()

    def record(
        self,
        *,
        total: int | None,
        served_key: str | None,
        watermark_id: str | None,
        cleared_call_ids: frozenset[str] = frozenset(),
    ) -> None:
        """Re-anchor after a completed model call. `total` = the backend's TOTAL prompt tokens
        (`StreamReport.prompt_tokens`); `served_key` identifies the endpoint that answered; `watermark_id`
        = the id of the last message in the prompt that was sent; `cleared_call_ids` = the iteration's
        `ClearingPlan.cleared_call_ids` that shaped the prompt this total measured (R1 — so the next
        estimate credits only newly-cleared outputs, not the ones already trimmed here). Any missing
        input (no usable total — degraded/absent telemetry) drops the anchor (heuristic mode next)."""
        if total is None or served_key is None or watermark_id is None:
            self.invalidate()
            return
        self._anchor = total
        self._watermark_id = watermark_id
        self._served_key = served_key
        self._cleared_at_anchor = cleared_call_ids

    def invalidate(self) -> None:
        """Drop the anchor (called by the session on a fold). The next `estimate` is heuristic+overhead
        until `record` re-anchors."""
        self._anchor = None
        self._watermark_id = None
        self._served_key = None
        self._cleared_at_anchor = frozenset()

    def estimate(self, history: list[Message], *, overhead: int, served_key: str | None) -> ContextEstimate:
        """Estimate the working context in tokens. Anchored mode (a live anchor whose `served_key`
        matches the endpoint being priced AND whose watermark is still in `history`): `anchor +
        estimate_tokens(messages after the watermark)` — the anchor already accounts for head+tools, so
        `overhead` is NOT re-added; the anchor-time clearing set rides on `cleared_at_anchor` (R1).
        Otherwise: `estimate_tokens(history) + overhead` with `cleared_at_anchor=None`."""
        heuristic = ContextEstimate(estimate_tokens(history) + overhead, anchored=False)
        if self._anchor is None or self._watermark_id is None:
            return heuristic
        if served_key is None or served_key != self._served_key:
            return heuristic  # served-endpoint change → the anchor's token count is on a different backend
        idx = _index_after(history, self._watermark_id)
        if idx is None:
            return heuristic  # watermark folded away — backstop to the explicit fold-invalidation
        return ContextEstimate(
            self._anchor + estimate_tokens(history[idx:]),
            anchored=True,
            cleared_at_anchor=self._cleared_at_anchor,
        )


def _index_after(history: list[Message], msg_id: str) -> int | None:
    """The index of the first message AFTER the one with id `msg_id`, or `None` if it isn't present."""
    for i, m in enumerate(history):
        if m.id == msg_id:
            return i + 1
    return None


#: R2 once-flag: the degenerate-trigger warning (reserve ≥ window×frac) is emitted at most once per
#: process — a module-level bool, since the misconfiguration is global (config-level), not per-thread,
#: and re-warning every iteration would flood the log. Reset only on process restart (a config fix that
#: rebuilds nothing here; the residual is a single stale bool — harmless).
_degenerate_trigger_warned = False


def _warn_degenerate_trigger(
    window: int, threshold_frac: float, reserve_tokens: int | None, fallback: int
) -> None:
    """Warn ONCE (module once-flag) that the window-aware trigger line collapsed to ≤ 0 and we degraded
    to the `threshold_tokens` fallback — naming the numbers so the misconfiguration is actionable."""
    global _degenerate_trigger_warned
    if _degenerate_trigger_warned:
        return
    _degenerate_trigger_warned = True
    log.warning(
        "compaction trigger line window(%d) × threshold_frac(%.2f) − reserve(%s) ≤ 0: the output reserve "
        "meets/exceeds the window budget, so auto-compaction would fire every turn. Degrading to the "
        "threshold_tokens fallback (%d). Lower the agent's ModelRef.max_tokens or raise the context window.",
        window,
        threshold_frac,
        reserve_tokens,
        fallback,
    )


class Compactor:
    """Folds the oldest turns of a thread into a summary when the context grows too large. One
    instance per session is fine — it's stateless (all state is the thread in the DB).

    `settings` is the SHARED live `Settings` object (the same one `ActionService._deps` holds), not a
    copy: `resolve()` reads the summarizer prompt off it per call, so an owner edit applies without a
    restart or any invalidation (C-17)."""

    def __init__(
        self,
        inference: InferenceClient,
        messages: MessageRepo,
        cfg: CompactionCfg,
        settings: Settings,
    ) -> None:
        self._inference = inference
        self._messages = messages
        self._cfg = cfg
        self._settings = settings

    async def compact(
        self,
        thread: Thread,
        *,
        force: bool = False,
        window: int | None = None,
        reserve_tokens: int | None = None,
        estimated_tokens: int | None = None,
        clearing: ClearingPlan | None = None,
        cleared_at_anchor: frozenset[str] | None = None,
        instructions: str | None = None,
    ) -> CompactionResult | None:
        """Compact the thread if warranted. Returns a `CompactionResult` when it actually folded OR
        REJECTED a would-inflate fold (`rejected=True` — nothing written), else `None` (disabled,
        under threshold, or nothing safe to fold). `force` (manual `/compact`) ignores the threshold
        but still honours the floor + turn-boundary safety AND the inflation-reject (force bypasses
        threshold/backoff/breaker but NEVER the reject).

        The D42 per-call trigger inputs (all defaulted, so every existing caller/test is unchanged and
        the Compactor stays STATELESS — the session owns this state): `window` = the resolved context
        window (config > probe > None); `reserve_tokens` = the effective `ModelRef.max_tokens` output
        reserve; `estimated_tokens` = the session's anchored context estimate (None ⇒ the v1
        `estimate_tokens(history)` heuristic); `clearing` = the iteration's shared `ClearingPlan` (the
        net-of-clearing trigger credit AND the head-net inflation-reject read off it — R1/R5);
        `cleared_at_anchor` = the anchor-time clearing set when the estimate is anchored, `None` in
        heuristic mode (the trigger credits the full clearing gain then). All flow to the single
        `_over_threshold` predicate. `instructions` = the `/compact <instructions>` summarizer steer
        (manual path only; auto-compaction never has one)."""
        if not self._cfg.enabled and not force:
            return None

        history = await self._messages.list(thread.id, include_compacted=False)
        if not force and not self._over_threshold(
            history,
            window=window,
            reserve_tokens=reserve_tokens,
            estimated_tokens=estimated_tokens,
            clearing=clearing,
            cleared_at_anchor=cleared_at_anchor,
        ):
            return None

        head, tail = self._split(history)
        if not head:
            return None  # everything is within the floor / no clean boundary — nothing to fold

        call = _SummaryCall()
        summary, truncated = await self._summarize(head, instructions=instructions, call=call)
        boundary = Message(
            thread_id=thread.id,
            role="system",
            actor=Actor.AGENT,
            parts=[TextPart(text=summary)],
            # The compaction call is its OWN model call, so the summary message carries its OWN
            # stamp + usage (Phase 18 / L-2) — just the `summarizer` prompt, never the turn's set.
            prompt_stamps=call.prompt_stamps,
            usage=call.usage,
            # Timestamp just before the kept tail so the summary sorts ahead of it (and after the
            # folded head) on the `ORDER BY ts ASC` reload.
            ts=tail[0].ts - timedelta(microseconds=1),
        )
        # Inflation-reject (D42): the fold must SHRINK the working context. If the produced summary is
        # no smaller than the head it replaces, abandon — no DB write, the head stays live — and report
        # `rejected` so the session's thrash machine counts a failure. Bypassed by NOTHING (force too:
        # a doomed fold that grows the context is never worth committing). A truncation-fold notice is
        # tiny, so it only rejects on a pathologically small head (where compaction is pointless anyway).
        # R5: price the head NET of the free clearing trim — in the LIVE context the head's cleared
        # outputs are already replaced by the tiny placeholder, so comparing the summary against the
        # untrimmed head would over-accept a summary that only "shrinks" against fat, already-cleared
        # output. Credit only the head's own cleared outputs, at the plan's per-output price (one home).
        head_net = estimate_tokens(head)
        if clearing is not None and not clearing.empty:
            head_cleared = {
                rp.call_id for m in head for rp in m.tool_results() if rp.call_id in clearing.cleared_call_ids
            }
            head_net -= clearing.gain_over(head_cleared)
        if estimate_tokens([boundary]) >= head_net:
            return CompactionResult(summary_id="", removed=0, truncated=truncated, rejected=True)
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
        clearing: ClearingPlan | None = None,
        cleared_at_anchor: frozenset[str] | None = None,
    ) -> bool:
        """The enabled+threshold gate — the SINGLE source of compaction's "is the working context big
        enough to fold?" decision, shared by `compact()` and `should_compact()` so the threshold math
        lives in exactly ONE place (no duplicated predicate).

        Trigger (D42): with a resolved `window`, fire when the estimate exceeds `window ×
        threshold_frac − reserve`; with NO window (`None`), fire when the estimate exceeds the absolute
        `threshold_tokens` (v1's unchanged no-regression path). `estimated_tokens` is the session's
        anchored estimate — `None` falls back to the v1 `estimate_tokens(history)` heuristic so every
        existing caller stays valid. `clearing` (the iteration's `ClearingPlan`) prices the trigger NET
        of the free assembly-time trim (see the credit rule below); `None` = no trim credit."""
        if not self._cfg.enabled:
            return False
        estimate = estimate_tokens(history) if estimated_tokens is None else estimated_tokens
        # D42 §E / §4-v2 + R1: subtract the free assembly-time clearing trim so the trigger prices the
        # context AS IT WILL BE SENT. The credit depends on the estimator mode: HEURISTIC mode (no
        # `cleared_at_anchor`) still counts every cleared output in the history estimate, so credit the
        # FULL gain; ANCHORED mode's total already reflects the anchor-time trim, so credit ONLY the
        # outputs cleared SINCE (`cleared_now − cleared_at_anchor`) — crediting the full gain there
        # would double-count the anchor-time trim (the exact-delta fix). One home: `ClearingPlan`.
        if clearing is not None:
            if cleared_at_anchor is None:
                estimate -= clearing.gain
            else:
                estimate -= clearing.gain_over(clearing.cleared_call_ids - cleared_at_anchor)
        return estimate > self._trigger_limit(window, reserve_tokens)

    def _trigger_limit(self, window: int | None, reserve_tokens: int | None) -> float:
        """The compaction trigger line in tokens (D42). With a resolved `window`: `window ×
        threshold_frac`, minus EXACTLY `reserve_tokens` when `reserve_output` is on AND a reserve is
        set (no global cap, no silent down-clamp — the two recorded opencode bugs; unset `max_tokens`
        ⇒ nothing reserved, the `threshold_frac` headroom being the margin). With no window: the
        absolute `threshold_tokens` fallback (v1 semantics).

        R2: if a misconfiguration (`reserve_tokens ≥ window × threshold_frac`) drives the line ≤ 0 —
        which would make EVERY estimate over-threshold and thrash — degrade to the same
        `threshold_tokens` fallback the no-window path uses (reuse the knob, no new magic floor) and
        warn once (`_warn_degenerate_trigger`)."""
        if window is None:
            return self._cfg.threshold_tokens
        limit = window * self._cfg.threshold_frac
        if self._cfg.reserve_output and reserve_tokens is not None:
            limit -= reserve_tokens
        if limit <= 0:
            _warn_degenerate_trigger(
                window, self._cfg.threshold_frac, reserve_tokens, self._cfg.threshold_tokens
            )
            return self._cfg.threshold_tokens
        return limit

    async def should_compact(
        self,
        thread: Thread,
        *,
        window: int | None = None,
        reserve_tokens: int | None = None,
        estimated_tokens: int | None = None,
        clearing: ClearingPlan | None = None,
        cleared_at_anchor: frozenset[str] | None = None,
    ) -> bool:
        """Cheap ACA-11 pre-check: will `compact()` actually summarize on this iteration? True iff
        compaction is enabled, the working context is over threshold (`_over_threshold`, the shared
        predicate — never a second copy of the threshold math), AND there is a foldable head (a clean
        turn boundary above the floor, via the same `_split` `compact()` uses). Mirrors `compact()`'s
        non-`force` decision exactly, so the caller's "compacting…" notice never fires on a no-op
        iteration. Does its own history read; at homelab thread sizes the extra list is negligible. The
        D42 trigger inputs (`window`/`reserve_tokens`/`estimated_tokens`/`clearing`/`cleared_at_anchor`)
        are threaded through to `_over_threshold` verbatim — all defaulted (existing callers unchanged)."""
        if not self._cfg.enabled:
            return False
        history = await self._messages.list(thread.id, include_compacted=False)
        if not self._over_threshold(
            history,
            window=window,
            reserve_tokens=reserve_tokens,
            estimated_tokens=estimated_tokens,
            clearing=clearing,
            cleared_at_anchor=cleared_at_anchor,
        ):
            return False
        head, _ = self._split(history)
        return bool(head)

    def _split(self, history: list[Message]) -> tuple[list[Message], list[Message]]:
        """Split into (head to fold, tail to keep verbatim). D42 two-floor cut: `cut = min(message-cut,
        token-cut)` — whichever keeps MORE recent context wins (the smaller cut index = the larger
        tail). The **message floor** is `keep_last_messages` from the end; the **token floor** walks
        back from the tail until the kept tail holds ≥ `keep_recent_tokens` (fat messages then keep
        fewer of them, thin messages keep more). Then three snaps, each only ever GROWING the tail:
          1. the C5-M2 suspend-snap — before the earliest durably-suspended call, so an
             AWAITING_CONFIRM/AWAITING_ANSWER call (and its later resume siblings/result) stays verbatim
             in the tail (a folded head could orphan its resume result);
          2. the ACTIVE task_plan pair — the MOST-RECENT `task_plan` call + its result must stay in the
             tail (the live plan round-trips through the model's context via its call args); snap before
             it if the cut would fold it. SUPERSEDED older task_plan pairs may fold;
          3. the user-boundary snap — the tail begins on a `user` message so a `tool` result is never
             orphaned from its assistant `tool_calls`.
        A previous summary in the head is re-folded by `_render_transcript` (one rolling summary)."""
        msg_cut = len(history) - self._cfg.keep_last_messages
        # Token floor: expand the tail (walk `tok_cut` left) until it holds ≥ keep_recent_tokens.
        tok_cut = len(history)
        while tok_cut > 0 and estimate_tokens(history[tok_cut:]) < self._cfg.keep_recent_tokens:
            tok_cut -= 1
        cut = min(msg_cut, tok_cut)  # keep whichever floor preserves MORE recent context
        # (1) Suspend-snap: BEFORE the earliest suspended-call message within the head. Uses turns.py's
        # `_SUSPEND_CALL_STATES` — one source of truth for "this message is mid-suspend".
        for i, m in enumerate(history):
            if i >= cut:
                break
            if any(cp.state in _SUSPEND_CALL_STATES for cp in m.tool_calls()):
                cut = i
                break
        # (2) Active-task_plan snap: the MOST-RECENT task_plan assistant message must be in the tail so
        # its call args (the live plan) + result round-trip. Snap to it if the cut would fold it;
        # superseded earlier task_plan rounds (before it) may still fold.
        active_tp = next(
            (
                i
                for i in range(len(history) - 1, -1, -1)
                if any(cp.tool == "task_plan" for cp in history[i].tool_calls())
            ),
            None,
        )
        if active_tp is not None and active_tp < cut:
            cut = active_tp
        # (3) User-boundary snap: the kept tail must start at a `user` message.
        while cut > 0 and history[cut].role != "user":
            cut -= 1
        if cut <= 0:
            return [], history
        return history[:cut], history[cut:]

    async def _summarize(
        self,
        head: list[Message],
        *,
        instructions: str | None = None,
        call: _SummaryCall | None = None,
    ) -> tuple[str, bool]:
        """Summarize the head via the selected summarizer model against the fixed five-section
        template (D42). `instructions` (the `/compact <instructions>` steer, manual path only) rides as
        an extra emphasis block. Returns (text, truncated). Two paths fall back to the truncation
        placeholder (DESIGN §5.4 — the context still shrinks): the summarizer backend failing
        (`InferenceError`/empty), AND the **overflow guard** — if the transcript is estimated to exceed
        the summarizer's OWN endpoint window (its `ModelRef.mode` via `effective_window_for`) minus the
        `_SUMMARIZER_MARGIN_FRAC` reserve, the call is doomed, so skip it for the truncation-fold
        (still a shrinking SUCCESS for the thrash machine — the failure signal is the inflation-reject,
        not this)."""
        stamps: dict[str, str] = {}
        transcript = _render_transcript(head)
        s = self._cfg.summarizer
        # No conditionals in templates (§2.3): the emphasis block is precomputed here — empty on an
        # automatic compaction — and passed as an ordinary `{{focus}}` value.
        focus = ""
        if instructions and instructions.strip():
            focus = "\n\nThe user asked to focus this summary on: " + instructions.strip()
        system = resolve(
            "summarizer",
            self._settings,
            {"sections": _SUMMARIZER_SECTION_BLOCK, "focus": focus},
            stamps=stamps,
        )
        payload = [
            {"role": "system", "content": system},
            {"role": "user", "content": transcript},
        ]
        # Overflow guard: a transcript that won't fit the summarizer's window (minus a reserve for the
        # template + the summary it must write) would just error — fall back to the truncation-fold
        # instead of the doomed call. A `None` window (unresolvable — e.g. a cloud summarizer with no
        # configured `context_window`) can't guard, so proceed best-effort (today's behaviour). D42 W4:
        # when the summarizer's `ModelRef.max_tokens` caps the OUTPUT, reserve EXACTLY that many tokens
        # for it — but never LESS than the `_SUMMARIZER_MARGIN_FRAC` floor (a tiny cap must not loosen
        # the guard below today's safety margin; a large cap tightens it honestly). Input (system +
        # transcript) is already in `payload`, so the reserve covers only the generated summary.
        window = await self._inference.effective_window_for(s.provider, s.model)
        if window is not None:
            reserve = max(s.max_tokens or 0, int(window * _SUMMARIZER_MARGIN_FRAC))
            if estimate_payload_tokens(payload) > window - reserve:
                return TRUNCATION_NOTICE, True
        report = StreamReport()
        try:
            body = await self._inference.complete(
                payload,
                mode=s.provider,
                model=s.model,
                max_tokens=s.max_tokens,
                reasoning_effort=s.reasoning_effort,
                reasoning_tokens=s.reasoning_tokens,
                report=report,
            )
            body = body.strip()
        except InferenceError:
            return TRUNCATION_NOTICE, True
        if not body:
            return TRUNCATION_NOTICE, True
        if call is not None:
            # Only on the path where the model actually wrote the summary: the truncation fallbacks
            # above produce a notice no model call stands behind, so they stamp nothing (Phase 18).
            call.prompt_stamps = stamps
            call.usage = CallUsage.of(report.model, report.prompt_tokens, report.completion_tokens)
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
