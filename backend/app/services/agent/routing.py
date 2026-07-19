"""Failure-fallback routing runtime state (ACA Slice 7, D43/A4-reduced).

The routing DECISION lives in `AgentSession._drive` (tightly coupled to the loop's terminals + the
suspend/resume boundary); this module hosts the per-thread runtime STATE it reads/writes — the exact
parallel of `compaction.py`'s `CompactionState` trio (dataclass + lazy-mint accessor + prune-when-
default). The session stays the owner of the reads/writes (like D42's stateless `Compactor` + the
injected `CompactionState`); this is just the lazy-mint / memoize / prune plumbing.

The cfg (`RoutingCfg`) lives in `domain/agent.py` beside `CompactionCfg` (an `AgentDef` field); this
module is its runtime counterpart, held on `app.state.routing_state` thread-id-keyed so a fallback
episode survives across a thread's turns (the session is rebuilt per turn). Restart resets it (in
memory; a recorded residual — a post-restart resume re-resolves to the worker)."""

from __future__ import annotations

from dataclasses import dataclass, field

from app.domain.agent import ModelRef


@dataclass
class RoutingState:
    """Per-thread failure-fallback view (D43), held in `app.state.routing_state` (the CompactionState
    template — thread-id-keyed, outliving any one turn).

    `consecutive_failures` counts back-to-back HARD worker failures (a clean completed worker turn
    resets it); `fallback_remaining` is how many more logical turns route to `lead` (set to
    `fallback_turns` when the threshold trips, decremented once per lead turn — the ONLY cross-turn
    write the fresh decision makes).

    `suspended_routes` is the per-SUSPENDED-CALL route snapshot map: `call_id → the RESOLVED routed
    ModelRef frozen at the fresh decision`. It replaces the old per-thread `current_route` slot, which
    D41's fresh-turn-while-suspended allowance made unsafe (turn B's decision could overwrite / B's
    conclude could clear turn A's still-suspended lock). Keying by the suspended call's id means each
    logical turn owns its own snapshot: a resume re-reads its call's frozen ModelRef VERBATIM (never
    re-dereferencing `RoutingCfg.lead` — so an owner edit/disable mid-suspend cannot flip the resumed
    half of a logical turn, D43 Invariant 1). A missing entry (restart / sweep) falls back to the
    worker (the recorded residual). Only LEAD routes are snapshotted — a worker resume falls to the
    worker naturally, so nothing to pin. Swept when a call_id is no longer a live AWAITING call.

    The old per-turn locks (`current_route` / `turn_had_model_failure`) are GONE from this state: they
    are now `_drive` turn-locals. `turn_had_model_failure` never needs to cross a suspend boundary — it
    is set ONLY at the exhaustion / stall / error terminals, each of which ends the turn immediately
    (no suspend can follow), so a plain turn-local suffices (documented at the sites)."""

    consecutive_failures: int = 0
    fallback_remaining: int = 0
    suspended_routes: dict[str, ModelRef] = field(default_factory=dict)


def routing_state_for(state, thread_id: str) -> RoutingState:
    """The per-thread `RoutingState` the session injects (D43) — lazily created + memoized in
    `app.state.routing_state`, so an in-flight fallback episode persists across a thread's turns (the
    session is rebuilt per turn). Mirrors `compaction_state_for` / `steer_source_for`; the session
    never reaches into the map."""
    store = state.routing_state
    st = store.get(thread_id)
    if st is None:
        st = RoutingState()
        store[thread_id] = st
    return st


def prune_routing_state(store: dict[str, RoutingState], thread_id: str) -> None:
    """Drop a thread's routing entry IFF it is back to all-defaults (D43) — no live episode, the
    failure counter clear, and NO suspended-route snapshots pending — so `routing_state_for` can
    re-mint an identical fresh one lazily with nothing lost. A live episode (`fallback_remaining > 0`),
    an in-progress counter, or a pending suspend snapshot is PRESERVED (it must survive to the next
    turn / the resume). The empty-dict default compares equal under dataclass `==`, so an all-default
    entry still prunes. Mirrors `prune_compaction_state`; keeps `app.state.routing_state` from
    accumulating dead threads. Called from the turn's done-callback, where the store owner has
    `(store, thread_id)` in hand."""
    st = store.get(thread_id)
    if st is not None and st == RoutingState():
        del store[thread_id]
