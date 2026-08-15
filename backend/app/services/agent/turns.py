"""Per-thread turn-marker registry (ACA Slice 2, D38).

One busy-truth for the chat stack: `app.state.turns: dict[thread_id, TurnHandle]` records the turn
currently owning each thread. Every thread-mutating endpoint (chat, resume, plan, apply, compact,
exec) `reserve()`s the thread's marker synchronously at the top of the handler and `release()`s it
when the turn finishes; a second concurrent turn on the same thread hits `TurnBusy` → HTTP 409.

This is a **registry entry, not a held lock** (the server field consensus: Goose's
`active_prompt_runs`, opencode's `runners` map) — a plain dict on `app.state`, safe under the
single-threaded event loop because `reserve()` does its check-and-set with **no `await`** between the
membership test and the insert (the D38 TOCTOU guarantee). It replaced the old `active_turns` int as
the busy signal for the rediscovery gates (that gauge missed resume turns — `count=False`); Slice 3
(D39) then DELETED `active_turns` entirely — the registry is the single busy-truth.

**Cross-slice contract:** Slice 3's `TurnRegistry` extends THIS `TurnHandle` in place with
`task`/`ring`/`seq` (the server-owned durable-turn ring); Slice 5's steer queue is thread-id-keyed on
`app.state.steer_queues` (it outlives this live-only handle, so it CANNOT hang off `turn_id`) and only
its optimistic-concurrency hook rides `turn_id`. Keep the class the single busy-marker shape — do not
fork a parallel record.
"""

from __future__ import annotations

import asyncio
import logging
import uuid
from collections import OrderedDict, deque
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import TYPE_CHECKING, Any, Literal

import anyio

from app.config import TurnsCfg
from app.domain.enums import RunState

if TYPE_CHECKING:
    from app.services.agent.session import AgentEvent
    from app.services.conversation import MessageRepo

log = logging.getLogger(__name__)

#: `automation` is a scheduled run's turn (A3/D49 §D-2): a turn nobody requested, driven through this
#: same machinery by the runner (the `start_steer_turn` precedent) rather than around it — so Stop, the
#: `max_active_turns` cap, live re-attach and the one marker lifecycle all cover it for free.
#: `prune` is the housekeeping marker (A3 post-14b review, HIGH): retention and automation-delete take a
#: thread's marker BEFORE deleting it, so a thread with a live interactive turn is never cascaded out
#: from under its drain task. Like the other sync kinds it spawns no task and is exempt from the cap — it
#: is held for the length of one DELETE. It is deliberately not a chat/resume kind, so a steer aimed at a
#: thread being deleted gets the busy 409 rather than being queued into a thread that is about to vanish.
TurnKind = Literal["chat", "resume", "exec", "plan", "apply", "compact", "automation", "prune"]

#: Kinds that spawn a server-owned drain task (D39) — the async turn loop runs detached and is
#: cancellable. The sync kinds (exec/plan/apply/compact) run inline in their handler and hold the
#: per-thread marker for their (short) duration; they never get a `task` and are exempt from the
#: `max_active_turns` cap. `automation` IS task-bearing and deliberately counts against the cap
#: (§D-2 "max_active_turns sees automation turns"): a scheduled run costs the same inference capacity
#: as a chat turn, and the runner treats a saturated cap as a failed run rather than queueing past it.
TASK_KINDS: frozenset[TurnKind] = frozenset({"chat", "resume", "automation"})

#: Terminal sentinel pushed onto every subscriber queue once a turn ends (D39/M2). A subscriber's
#: consumer loop stops when it dequeues this; it is NOT an `AgentEvent` (never framed onto the wire),
#: so it is distinguishable from real `(seq, event)` pairs by identity.
TERMINAL: Any = object()

#: Tool-call states a reconcile flips to CANCELLED (A11/D39): NON-terminal AND NON-suspend. The
#: durable suspends (AWAITING_CONFIRM/AWAITING_ANSWER) are deliberately excluded — they are the
#: owner's to resolve, not stale work — as are the already-terminal states in session `_RESOLVED`.
_STALE_CALL_STATES = (RunState.PENDING, RunState.RUNNING)

#: The durable suspend states. A message holding one of these is mid-suspend: the reconciler skips it
#: WHOLESALE (message-level, not per-call) so a suspended call's later PENDING SIBLINGS — legitimate
#: resume work that runs after the confirm/answer resolves — are not flipped to CANCELLED and lost.
_SUSPEND_CALL_STATES = (RunState.AWAITING_CONFIRM, RunState.AWAITING_ANSWER)


def _now() -> datetime:
    return datetime.now(timezone.utc)


@dataclass
class TurnAccumulator:
    """The registry-layer event fold (D39): a running reconstruction of a turn's in-flight state,
    updated synchronously as every `AgentEvent` streams by, so a late-joining client can be handed
    ONE `turn.sync` snapshot instead of a replay — regardless of ring eviction. Built here (not in
    `_drive`) so the loop stays untouched (zero `_drive` edits, the D39 mandate).

    Text/reasoning are kept as DELTA LISTS and joined only when `snapshot()` is called (adversarial
    L2: never `+=` a growing string per delta → no O(n²) concat over a long turn). The open message
    is dropped on `message.end` — at that point it is durably persisted to SQLite, so a re-attaching
    client reads it via `GET …/messages`; the accumulator only needs to carry what is NOT yet durable
    (the in-flight streaming message + the ephemeral confirm token/prompt on a pending suspend).

    `notice`/`compaction` are deliberately NOT folded — D39 accepts that transient sys-notes are not
    re-attach-recoverable (they carry no durable state a snapshot must rebuild).

    `retry_status` (D43/A6 review M4) is the ONE exception the D43 lock carves out: a
    snapshot-ONLY field derived from the live `inference.retry` event, set while a same-endpoint
    backoff is in flight and cleared by the very NEXT event of any kind. It is NOT a notice log entry
    (the fold below never appends it anywhere durable — it is dropped when the turn's handle is) — it
    exists solely so a client that re-attaches DURING a backoff renders the "// retrying …" line
    instead of the dead spinner A6 exists to kill, rather than a replayable narration."""

    #: The currently-streaming assistant message: `{id, role, agent}` or None between messages.
    open_message: dict[str, Any] | None = None
    text_deltas: list[str] = field(default_factory=list)  # joined on snapshot (no O(n²))
    reasoning_deltas: list[str] = field(default_factory=list)
    #: Turn-global tool-call state keyed by call_id: the last-known `{call_id, tool, args, state}`
    #: plus, for a suspended call, the ephemeral `permission`/`question` payload (token+prompt) that
    #: is NOT persisted — the one thing a snapshot must carry so a late client renders the bubble.
    calls: dict[str, dict[str, Any]] = field(default_factory=dict)
    #: Steers applied mid-turn (D41 Drain A), in drain order: `{entryId, messageId, kind[, text]}`. A
    #: steered user message is DURABLE + load-bearing (unlike the live-only notices, which are NOT
    #: folded), so a snapshot re-attach must carry it — for `kind:"message"` the `text` too, so the
    #: client renders the bubble without a reload; `exec` entries are id-only (the persisted
    #: assistant+tool pair is the durable floor a reload re-reads).
    steers: list[dict[str, Any]] = field(default_factory=list)
    #: Terminal info once the turn ends: `{state, ...}` from the final `done` (or a synthesized one).
    terminal: dict[str, Any] | None = None
    #: The in-flight same-endpoint retry backoff (D43/A6), snapshot-only: `{endpoint, attempt, max,
    #: untilTs}` while a backoff is pending, else None. Set by an `inference.retry`, cleared by the very
    #: next event — so a re-attach mid-backoff renders the retry line, never a dead spinner.
    retry_status: dict[str, Any] | None = None

    def fold(self, event: AgentEvent) -> None:
        """Advance the reconstruction by one event. Pure state update, no awaits — called inside the
        drain task's synchronous per-event step so the accumulator is always consistent with `seq`."""
        ev, data = event.event, event.data
        # D43/A6 (review M4): the retry-backoff snapshot field. An `inference.retry` sets it (computing
        # the absolute `untilTs` from the event's `delaySeconds`); ANY other event clears it — the
        # session emits the retry, then the failover generator sleeps with no events until the backoff
        # ends, so this stays set for exactly the backoff window and is dropped on the next delta /
        # another notice / the terminal (D43: "cleared on the next item from the stream"). Snapshot-only,
        # never appended to a durable log — the TurnAccumulator stays notice-free.
        if ev == "inference.retry":
            self.retry_status = {
                "endpoint": data.get("endpoint"),
                "attempt": data.get("attempt"),
                "max": data.get("max"),
                "untilTs": _now().timestamp() + (data.get("delaySeconds") or 0),
            }
        else:
            self.retry_status = None
        if ev == "message.start":
            self.open_message = {
                "id": data.get("messageId"),
                "role": data.get("role"),
                "agent": data.get("agent"),
            }
            self.text_deltas = []
            self.reasoning_deltas = []
        elif ev == "text.delta":
            self.text_deltas.append(data.get("delta", ""))
        elif ev == "reasoning.delta":
            self.reasoning_deltas.append(data.get("delta", ""))
        elif ev == "part.added":
            part = data.get("part", {})
            cid = part.get("call_id")
            if cid is not None:
                self.calls[cid] = {
                    "call_id": cid,
                    "tool": part.get("tool"),
                    "args": part.get("args", {}),
                    "state": part.get("state"),
                }
        elif ev == "tool.permission":
            cid = data.get("callId")
            if cid is not None:
                call = self.calls.setdefault(cid, {"call_id": cid, "tool": data.get("tool")})
                call["state"] = RunState.AWAITING_CONFIRM.value
                call["permission"] = dict(data)  # carries token+prompt+args (not persisted)
        elif ev == "tool.question":
            cid = data.get("callId")
            if cid is not None:
                call = self.calls.setdefault(cid, {"call_id": cid, "tool": data.get("tool")})
                call["state"] = RunState.AWAITING_ANSWER.value
                call["question"] = dict(data)
        elif ev == "tool.result":
            cid = data.get("callId")
            if cid is not None:
                call = self.calls.setdefault(cid, {"call_id": cid})
                result = data.get("result", {})
                call["result"] = result
                if isinstance(result, dict) and result.get("state") is not None:
                    call["state"] = result["state"]
                # A resolved call is no longer pending — drop the ephemeral suspend payload.
                call.pop("permission", None)
                call.pop("question", None)
        elif ev == "steer.applied":
            # A mid-turn steer landed (D41): fold its id/message/kind so `turn.sync` carries it to a
            # re-attaching client. `text` (message kind only) rides along so the bubble renders without
            # a reload; exec entries stay id-only (their durable pair is re-read on reload).
            kind = data.get("kind")
            steer: dict[str, Any] = {
                "entryId": data.get("entryId"),
                "messageId": data.get("messageId"),
                "kind": kind,
            }
            if kind == "message":
                steer["text"] = data.get("text", "")
            self.steers.append(steer)
        elif ev == "message.end":
            # The assistant message (text + tool-call parts) is now persisted to SQLite; a
            # re-attaching client reads it via the normal restore path. Drop the in-flight message
            # state — the turn-global `calls` map (pending suspends) survives, since a
            # `tool.permission`/`tool.question` is emitted AFTER `message.end` in `_drive`.
            self.open_message = None
            self.text_deltas = []
            self.reasoning_deltas = []
        elif ev in ("done", "error"):
            # `done` carries the terminal state; a bare `error` (followed by its own `done`) records
            # the message so the last write wins with the real terminal state.
            self.terminal = dict(data)

    def suspended_skills(self) -> dict[str, list[str]]:
        """The active skill ids the turn suspended under, keyed by suspended call id (M2/C-12). Read
        straight off the `permission`/`question` payloads the fold already holds (a resolved call drops
        its payload, so only genuinely-pending suspends are reported) — the snapshot therefore carries
        them for free, and the terminal cache copies this so a resume that lands after the turn ended
        still gets the SERVER's set instead of whatever the client still remembers."""
        out: dict[str, list[str]] = {}
        for cid, call in self.calls.items():
            payload = call.get("permission") or call.get("question")
            if isinstance(payload, dict) and isinstance(payload.get("skills"), list):
                out[cid] = list(payload["skills"])
        return out

    def resolved_call_ids(self) -> set[str]:
        """Call ids this turn carried to a result (M2/C-12) — the fold writes `result` exactly then.
        The terminal cache uses it to expire a PRIOR turn's pins for the calls this turn resolved,
        while keeping the ones still awaiting the owner."""
        return {cid for cid, call in self.calls.items() if "result" in call}

    def snapshot(self, *, mode: str | None, seq: int) -> dict[str, Any]:
        """One coherent picture of the turn for a `turn.sync` re-attach event (D39/S3-A). Joins the
        delta lists (the only place the O(n) concat happens), includes the pending tool calls with
        their ephemeral suspend payloads + the turn's `mode` (so the client re-pins `modeByCall`) +
        the current `seq` (the client's new cursor floor). Wave 3's turn.sync endpoint consumes this;
        built now so the `fold` above is proven complete against the whole event vocabulary."""
        snap: dict[str, Any] = {
            "mode": mode,
            "seq": seq,
            "calls": list(self.calls.values()),
            "terminal": self.terminal,
        }
        if self.open_message is not None:
            snap["message"] = {
                **self.open_message,
                "text": "".join(self.text_deltas),
                "reasoning": "".join(self.reasoning_deltas),
            }
        if self.steers:  # D41: only when a steer landed, so the untouched-turn snapshot shape is stable
            snap["steers"] = list(self.steers)
        if self.retry_status is not None:  # D43/A6: only mid-backoff, so the no-retry snapshot is stable
            snap["retry_status"] = dict(self.retry_status)
        return snap


@dataclass
class TurnHandle:
    """The turn currently owning a thread. `turn_id` (uuid4 hex) correlates logs and is Slice 5's
    optimistic-concurrency key (Goose's `run_id`). Slice 3 extends this SAME dataclass in place with
    the server-owned durable-turn machinery (D39) — see the module cross-slice contract; don't spawn
    a sibling record. The Slice-2 fields (`thread_id`/`kind`/`turn_id`/`started_at`) and their
    reserve/release semantics are untouched; everything below is additive."""

    thread_id: str
    kind: TurnKind
    turn_id: str = field(default_factory=lambda: uuid.uuid4().hex)
    started_at: datetime = field(default_factory=_now)
    #: The server-owned drain task (D39). `None` for the sync kinds (exec/plan/apply/compact), which
    #: run inline in their handler; set by `_turn_response` for the task kinds (chat/resume).
    task: asyncio.Task | None = None
    #: The turn's inference mode (`local`/`cloud`/None) — the snapshot carries it so a re-attaching
    #: client re-pins `modeByCall`. Set from the request in `_turn_response`.
    mode: str | None = None
    #: Monotonic per-turn event counter; each drained event is stamped `(seq, event)`. The wire id is
    #: `turn_id:seq`, and a reconnecting client's cursor floor.
    seq: int = 0
    #: Bounded replay ring of the last `ring_size` `(seq, event)` pairs (maxlen passed at
    #: construction). Undersizing forces snapshot on reconnect, never data loss (the SQLite persist
    #: is the durable floor). `deque(maxlen=…)` evicts the oldest automatically.
    ring: deque[tuple[int, AgentEvent]] = field(default_factory=deque)
    #: Attached subscriber queues (per-turn fan-out). Bounded (`subscriber_queue_size`); on overflow
    #: the offending subscriber is DETACHED (S3-F: events are never shed for connected subscribers).
    subscribers: list[asyncio.Queue] = field(default_factory=list)
    #: Single-cancel discipline flag (D39 H2/H3): set by `cancel_turn` so `task.cancel()` fires
    #: EXACTLY once ever — a second raw cancel would pierce the anyio shield in the persistence
    #: finally and reopen the dangling-BEGIN hole the Slice-2 audit closed.
    cancelling: bool = False
    #: The turn's terminal state string, set in the drain task's `finally` BEFORE the terminal
    #: sentinel is emitted — so there is no done-but-unmarked window (D39). Never inferred.
    terminal_status: str | None = None
    #: The registry-layer event fold (snapshot source for late re-attach).
    accumulator: TurnAccumulator = field(default_factory=TurnAccumulator)


class TurnBusy(Exception):
    """A turn is already running on the thread. Carries the live `TurnHandle` so the caller can
    surface which turn holds it; the endpoints map this to HTTP 409."""

    def __init__(self, handle: TurnHandle) -> None:
        self.handle = handle
        super().__init__(
            f"turn {handle.turn_id} ({handle.kind}) is already running on thread {handle.thread_id}"
        )


#: Default replay-ring depth when a caller doesn't pass one (test/unit paths). Production always
#: passes `agent.turns.ring_size`; this keeps the Slice-2 unit signature `reserve(turns, id, kind)`
#: working without threading config through every caller.
#: Test/unit fallback only — production always passes `cfg.ring_size`. Derived from the config
#: field so the default has ONE source of truth (review fix: the literal was duplicated).
_DEFAULT_RING_SIZE = TurnsCfg().ring_size


def reserve(
    turns: dict[str, TurnHandle], thread_id: str, kind: TurnKind, *, ring_size: int = _DEFAULT_RING_SIZE
) -> TurnHandle:
    """Check-and-set the thread's marker **synchronously** — raise `TurnBusy(existing)` if one is
    held, else create + insert + return a fresh `TurnHandle`. There is deliberately NO `await`
    anywhere in here: under the single-threaded loop the membership test and the insert are one
    atomic step, so two concurrent posts to the same thread can't both slip through (D38 TOCTOU).
    `ring_size` sizes the handle's bounded replay ring at construction (D39) — the replay-window
    knob; undersizing forces snapshot on reconnect, never data loss."""
    existing = turns.get(thread_id)
    if existing is not None:
        raise TurnBusy(existing)
    handle = TurnHandle(thread_id=thread_id, kind=kind, ring=deque(maxlen=ring_size))
    turns[thread_id] = handle
    return handle


def active_task_turns(turns: dict[str, TurnHandle]) -> int:
    """Count LIVE task-bearing turns (chat/resume kinds) across all threads — the `max_active_turns`
    gauge (D39). Counts by KIND, not by a spawned task: a task-kind handle counts from the moment it
    is *reserved* (there are awaits between reserve and `create_task`, so counting only spawned tasks
    would let two concurrent posts both slip under the cap in that window — the reserve-time count
    extends the D38 no-await TOCTOU discipline to the cap). A handle whose task already finished is
    excluded (its done-callback release may simply not have fired yet)."""
    return sum(1 for h in turns.values() if h.kind in TASK_KINDS and (h.task is None or not h.task.done()))


def release(turns: dict[str, TurnHandle], handle: TurnHandle) -> None:
    """Drop the thread's marker, but only if the stored handle **is** this one (identity via
    `turn_id`). A stale release — e.g. a turn that already yielded ownership — must never evict a
    newer turn's marker, so a mismatch is a no-op."""
    current = turns.get(handle.thread_id)
    if current is not None and current.turn_id == handle.turn_id:
        del turns[handle.thread_id]


async def reconcile_stale_calls(messages: MessageRepo, thread_id: str | None = None) -> int:
    """Flip tool calls stranded in an OPEN state (`PENDING`/`RUNNING`) to `CANCELLED`, persist them,
    and return how many calls were flipped (A11/D39). ONE shared helper for two call sites:

    1. **Lifespan boot (crash recovery)** — `thread_id=None`, scanning ALL threads. A previous run
       that died mid-turn (a crash, a `kill`, a hard restart) leaves calls persisted `PENDING`/
       `RUNNING` with no result; without this they render as permanent spinners (opencode #19023 —
       the do-nothing failure mode, closed not-planned) and re-run misleadingly on resume. At boot
       there is never a live turn, so the full cross-thread scan is safe. Best-effort at the call
       site so a DB hiccup never aborts startup.
    2. **The turn task's cancel path (wave 3)** — `thread_id=<thread>`, scoped to the cancelled
       turn's thread, marking its in-flight calls stale while the turn marker is still held (Codex's
       interrupt-stale-turns precedent — we take Codex's side over opencode's absence).

    The durable suspends (`AWAITING_CONFIRM`/`AWAITING_ANSWER`) MUST survive untouched — they are the
    owner's to resolve, not stale work. The exclusion is now **per-MESSAGE, not per-call**: a
    multi-call assistant message suspended on one call (state AWAITING_CONFIRM/AWAITING_ANSWER) leaves
    its LATER sibling calls legitimately PENDING — resume runs them after the confirm/answer resolves.
    Those siblings are resumable work, not stale, so if ANY call in the message is suspended the whole
    message is skipped (a call-level skip would flip the siblings to CANCELLED and `_RESOLVED` would
    then skip them forever). Efficiency: the narrow `MessageRepo.with_call_states` scan is a SQL
    `json_each` filter, so only messages that actually hold an open call are loaded (not every message
    of every thread). A message's own multiple flips persist atomically in a single `update()` (it
    rewrites the whole `parts` JSON in one statement), so no per-message transaction is needed — each
    `update` is its own write."""
    stale = await messages.with_call_states(_STALE_CALL_STATES, thread_id)
    flipped = 0
    for msg in stale:
        calls = msg.tool_calls()
        # Message-level suspend exclusion: a message mid-suspend keeps its PENDING siblings resumable.
        if any(c.state in _SUSPEND_CALL_STATES for c in calls):
            continue
        touched = False
        for call in calls:
            if call.state in _STALE_CALL_STATES:
                call.state = RunState.CANCELLED
                flipped += 1
                touched = True
        if touched:
            await messages.update(msg)
    return flipped


# ── Server-owned durable turns: the drain task + fan-out (ACA Slice 3, D39) ─────────────────────
#
# `_turn_response` spawns `drain_turn(handle, run_turn()/resume(), messages)` as an asyncio task
# stored on `handle.task`; the SSE generator (and the buffered `collect_turn` wrapper) become
# subscribers reading a bounded queue. The turn now outlives its client socket: a phone lock /
# network blip kills the subscriber, not the loop (ACA-1). Marker release rides the task's
# `add_done_callback` (idempotent cleanup), so `terminal_status` — set here BEFORE the terminal
# sentinel — closes the done-but-unmarked window (D39).


def _agent_event(event: str, data: dict[str, Any]) -> AgentEvent:
    """Construct an `AgentEvent` without a module-level import of session.py (which would be a
    latent cycle — turns.py is imported by the API alongside session.py). Local import, cheap once
    the module is loaded."""
    from app.services.agent.session import AgentEvent as _AE

    return _AE(event, data)


def _force_put(q: asyncio.Queue, item: Any) -> None:
    """Deliver `item` to a bounded queue even when full by evicting its oldest entry first. Used ONLY
    for the terminal sentinel to a stuck/detached subscriber: that consumer is already being given up
    on (it re-attaches via snapshot), so dropping one buffered event to guarantee the stop signal
    lands is the correct trade (never used on the no-shed hot path)."""
    try:
        q.put_nowait(item)
    except asyncio.QueueFull:
        try:
            q.get_nowait()
        except asyncio.QueueEmpty:
            pass
        try:
            q.put_nowait(item)
        except asyncio.QueueFull:  # pragma: no cover — a concurrent producer refilled it
            pass


def _detach_subscriber(handle: TurnHandle, q: asyncio.Queue) -> None:
    """Remove an overflowing subscriber and hand it a close signal (S3-F: overflow detaches, it does
    NOT shed events for the *connected* subscribers). The detached client re-attaches via the
    snapshot path — so forcing the terminal sentinel in (losing its buffered tail) is fine."""
    try:
        handle.subscribers.remove(q)
    except ValueError:  # already removed
        return
    _force_put(q, TERMINAL)


def _dispatch(handle: TurnHandle, ev: AgentEvent) -> None:
    """Fold ONE event into the registry entry and fan it out — synchronously, no awaits between the
    steps, so `seq`/ring/accumulator/subscribers stay mutually consistent (the Slice-2 reserve
    discipline extended to the event plane). A subscriber whose bounded queue is full is DETACHED
    (never shed): the connected, keeping-up subscribers always see every event."""
    handle.seq += 1
    handle.ring.append((handle.seq, ev))
    handle.accumulator.fold(ev)
    item = (handle.seq, ev)
    for q in list(handle.subscribers):
        try:
            q.put_nowait(item)
        except asyncio.QueueFull:
            _detach_subscriber(handle, q)


def _push_terminal(handle: TurnHandle) -> None:
    """Signal every subscriber to stop (D39/M2 terminal sentinel). Always forced in — a subscriber
    that never sees it would hang on `queue.get()` forever."""
    for q in list(handle.subscribers):
        _force_put(q, TERMINAL)


async def drain_turn(handle: TurnHandle, events: AsyncIterator[AgentEvent], messages: MessageRepo) -> None:
    """Iterate a `run_turn`/`resume` event generator to completion, INDEPENDENT of any client — the
    core inversion (D39). Per event: stamp `seq`, ring-append, fold, fan out (`_dispatch`). On exit,
    `terminal_status` is set FIRST, then the terminal sentinel is pushed, so the marker's
    done-callback release never opens a done-but-unmarked window.

    Terminal semantics (D39/M2):
      • normal end — the generator already emitted its own `done` (completed/suspended/capped/error);
        `terminal_status` reads that last `done`'s state.
      • CancelledError (Stop / shutdown) — inside `anyio.CancelScope(shield=True)`, while the turn
        marker is STILL held (no successor race), reconcile the thread's in-flight PENDING/RUNNING
        calls to CANCELLED (wave-1 helper), set `terminal_status="cancelled"`, synthesize a
        `done{state:"cancelled"}` close (no fake tool.results — the DB reconcile is the truth the
        client re-reads), then re-raise. The shield holds because the SINGLE cancel (`cancel_turn`'s
        one-shot discipline) has already been delivered — a second raw cancel would pierce it.
      • unexpected exception — same shielded `reconcile_stale_calls` as the cancel path (the thread's
        in-flight PENDING/RUNNING calls → CANCELLED so `_assemble` never mis-reports them "not
        executed" when a side effect may have fired), then captured as a `done{state:"error"}` close
        (a detached turn's error can't propagate to an absent client), logged, NOT re-raised.
    """
    emitted_done = False
    try:
        async for ev in events:
            _dispatch(handle, ev)
            if ev.event == "done":
                emitted_done = True
    except asyncio.CancelledError:
        # The shield holds because `cancel_turn` guarantees exactly ONE `task.cancel()` ever (D39
        # H2/H3): the single cancel is already delivered, so no second cancel can fire between this
        # `finally`-equivalent block's checkpoints and pierce the scope (the dangling-BEGIN hole the
        # Slice-2 audit closed). The marker is still held here — the cancel endpoint writes nothing —
        # so `reconcile_stale_calls` can flip this thread's in-flight calls with no successor-turn race.
        with anyio.CancelScope(shield=True):
            try:
                await reconcile_stale_calls(messages, handle.thread_id)
            except Exception:  # best-effort — a DB hiccup must not swallow the cancel
                log.exception("stale-call reconcile failed on cancel of turn %s", handle.turn_id)
            handle.terminal_status = "cancelled"
            if not emitted_done:
                _dispatch(handle, _agent_event("done", {"threadId": handle.thread_id, "state": "cancelled"}))
        raise
    except Exception:
        log.exception("turn %s drain failed", handle.turn_id)
        # Same shielded reconcile as the cancel path: an unexpected error releases the thread with its
        # in-flight PENDING/RUNNING calls still open, which `_assemble` would later read as "not
        # executed" — a FALSE account when the tool's side effect may already have fired
        # (duplicate-action risk). Flip them to CANCELLED ("cancelled — not completed": interrupted,
        # effect unknown) so they read honestly and never silently re-run. Best-effort + shielded (the
        # marker is still held here, so no successor-turn race), before the synthesized error/done.
        with anyio.CancelScope(shield=True):
            try:
                await reconcile_stale_calls(messages, handle.thread_id)
            except Exception:  # best-effort — a DB hiccup must not swallow the error close
                log.exception("stale-call reconcile failed on error of turn %s", handle.turn_id)
        handle.terminal_status = "error"
        if not emitted_done:
            _dispatch(handle, _agent_event("error", {"message": "turn failed", "retryable": False}))
            _dispatch(handle, _agent_event("done", {"threadId": handle.thread_id, "state": "error"}))
    else:
        term = handle.accumulator.terminal
        handle.terminal_status = (term.get("state") if term else None) or "completed"
    finally:
        # Safety net: no path above should leave this unset, but never emit the sentinel unmarked.
        if handle.terminal_status is None:
            handle.terminal_status = "error"
        _push_terminal(handle)


def cancel_turn(handle: TurnHandle) -> bool:
    """The ONE sanctioned way to cancel a turn (D39 single-cancel discipline; wave 3's cancel
    endpoint + the shutdown drain both route through here). Returns True if THIS call fired the
    cancel, False if there was nothing to cancel or it was already cancelling.

    Exactly-one-cancel-ever is load-bearing: the drain task's CancelledError persistence runs inside
    an `anyio.CancelScope(shield=True)`; a SECOND raw `task.cancel()` would pierce that shield mid
    write and reopen the dangling-BEGIN hole the Slice-2 audit closed (D39 H2). The `cancelling` flag
    latches on the first call so every later cancel is a no-op — idempotency at the source, not left
    to each caller."""
    if handle.cancelling or handle.task is None or handle.task.done():
        return False
    handle.cancelling = True
    handle.task.cancel()
    return True


async def subscribe_events(q: asyncio.Queue) -> AsyncIterator[tuple[int, AgentEvent]]:
    """Async-generator view over a subscriber queue: yield `(seq, event)` pairs until the terminal
    sentinel. Shared by the SSE generator and the buffered `collect_turn` wrapper so both consume the
    turn identically (buffered turns become cancellable for free, D17)."""
    while True:
        item = await q.get()
        if item is TERMINAL:
            return
        yield item


def make_subscriber(handle: TurnHandle, queue_size: int) -> asyncio.Queue:
    """Attach a fresh bounded subscriber queue to a handle and return it — synchronously, so a caller
    can attach then build a snapshot/tail with no `await` gap (the D39 zero-gap-join invariant)."""
    q: asyncio.Queue = asyncio.Queue(maxsize=queue_size)
    handle.subscribers.append(q)
    return q


def remove_subscriber(handle: TurnHandle, q: asyncio.Queue) -> None:
    """Detach a consumer's queue (its SSE stream ended / the client disconnected). The drain task
    stops fanning out to it, but keeps running — the turn OUTLIVES its client (ACA-1). Idempotent."""
    try:
        handle.subscribers.remove(q)
    except ValueError:
        pass


# ── Terminal cache: the read-side late-re-attach convenience (ACA Slice 3, D39/S3-B) ─────────────
#
# The live registry (`app.state.turns`) stays LIVE-ONLY (adversarial H1): a finished turn is
# deleted, so every truthiness busy-read (ACA-17 gates, `max_active_turns`) stays honest. A finished
# turn's terminal FACT is instead moved into this small capped `app.state.turn_terminals` map so a
# client that missed the terminal sentinel (phone lock, socket drop) still learns the outcome on
# re-attach. It is read-side only — NEVER busy state — and swept opportunistically (no background
# task), so an idle server never accumulates stale records.

# The terminal-cache cap lives in config (`agent.turns.terminal_cache_cap`, review fix): it
# co-governs the cache with `linger_s`, and TurnsCfg's contract is "every tunable of the turn
# machinery lives here" — callers pass it explicitly to `record_terminal`.


@dataclass
class TerminalRecord:
    """One finished turn's terminal fact, held briefly in the capped `app.state.turn_terminals`
    cache (D39/S3-B). Carries just what a late re-attacher needs — the turn's id + its
    `terminal_status` — plus `ended_at` for the linger sweep. NOT busy state (the live registry is
    the only busy-truth); this is the read-side answer for a client that missed the sentinel."""

    turn_id: str
    terminal_status: str
    #: M2/C-12: the skill ids active when the turn suspended, keyed by suspended call id. A confirm/
    #: question outlives its turn (the owner resolves it later), so this is what makes the server —
    #: not the client's module state — authoritative about which skills the resumed half runs under.
    skills_by_call: dict[str, list[str]] = field(default_factory=dict)
    ended_at: datetime = field(default_factory=_now)


def _sweep_terminals(cache: OrderedDict[str, TerminalRecord], linger_s: float) -> None:
    """Drop records older than `linger_s`. Opportunistic — called on every insert and read, so
    there is no background sweeper task (D39); an idle server self-cleans on the next probe."""
    now = _now()
    expired = [tid for tid, rec in cache.items() if (now - rec.ended_at).total_seconds() > linger_s]
    for tid in expired:
        del cache[tid]


def record_terminal(
    cache: OrderedDict[str, TerminalRecord],
    handle: TurnHandle,
    *,
    linger_s: float,
    cap: int,
) -> None:
    """Move a just-finished turn's terminal fact into the cache (called at the `_turn_response`
    done-callback seam, AFTER the drain task's finally set `handle.terminal_status` — the D39/M2
    ordering). Sweeps expired first, inserts newest-at-end, then evicts oldest beyond `cap`.
    `terminal_status` is never None at this point (the drain `finally` guarantees it); the `or
    "error"` is a last-ditch guard so a malformed handle can never poison the record."""
    _sweep_terminals(cache, linger_s)
    # M2/C-12: the record is per-THREAD but a suspended call outlives the turn that raised it — the
    # owner may resolve turn A's bubble after turn B has come and gone on the same thread. So the new
    # turn's pins do not REPLACE the map: the prior record's pins are carried forward except for the
    # calls this turn actually resolved (a dismissed/executed bubble needs no pin), and the new turn's
    # own pins win on a shared id. Expiry stays with the record: the sweep above already dropped a
    # lingered-out one, so nothing outlives its window.
    prior = cache.get(handle.thread_id)
    pins = handle.accumulator.suspended_skills()
    if prior is not None:
        resolved = handle.accumulator.resolved_call_ids()
        pins = {c: s for c, s in prior.skills_by_call.items() if c not in resolved} | pins
    cache[handle.thread_id] = TerminalRecord(
        turn_id=handle.turn_id,
        terminal_status=handle.terminal_status or "error",
        skills_by_call=pins,
    )
    cache.move_to_end(handle.thread_id)  # freshest last (evict-oldest is popitem(last=False))
    while len(cache) > cap:
        cache.popitem(last=False)


def get_terminal(
    cache: OrderedDict[str, TerminalRecord], thread_id: str, *, linger_s: float
) -> TerminalRecord | None:
    """Read a thread's terminal record if still within its linger window (sweeps expired first, so
    an over-lingered record is dropped on this read and reported as absent). None → the client falls
    back to a full reload (the per-step SQLite persistence is the durable floor)."""
    _sweep_terminals(cache, linger_s)
    return cache.get(thread_id)
