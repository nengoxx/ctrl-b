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

from dataclasses import dataclass
from typing import Literal


@dataclass
class RoutingState:
    """Per-thread failure-fallback view (D43), held in `app.state.routing_state` (the CompactionState
    template — thread-id-keyed, outliving any one turn).

    `consecutive_failures` counts back-to-back HARD worker failures (a clean completed worker turn
    resets it); `fallback_remaining` is how many more logical turns route to `lead` (set to
    `fallback_turns` when the threshold trips, decremented once per lead turn); `current_route` is the
    LOGICAL-turn route lock — set on a fresh turn's decision and READ (not re-decided) on a resume, so
    a suspend/resume never flips the model mid-logical-turn (the ACA-16 mode-carry parallel), then
    cleared at the turn's conclusive end; `turn_had_model_failure` is the per-turn flag the session
    sets at the structural failure sites and consumes + clears when the turn concludes."""

    consecutive_failures: int = 0
    fallback_remaining: int = 0
    current_route: Literal["lead", "worker"] | None = None
    turn_had_model_failure: bool = False


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
    """Drop a thread's routing entry IFF it is back to all-defaults (D43) — no live episode, no route
    lock, no pending failure flag, the failure counter clear — so `routing_state_for` can re-mint an
    identical fresh one lazily with nothing lost. A live episode (`fallback_remaining > 0`), an
    in-progress counter, or a set route lock is PRESERVED (it must survive to the next turn). Mirrors
    `prune_compaction_state`; keeps `app.state.routing_state` from accumulating dead threads. Called
    from the turn's done-callback, where the store owner has `(store, thread_id)` in hand."""
    st = store.get(thread_id)
    if st is not None and st == RoutingState():
        del store[thread_id]
