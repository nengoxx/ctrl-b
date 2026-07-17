"""Arch invariant: every thread-mutating endpoint reserves the turn marker (D38).

The busy guard is applied per handler by convention (`_reserve_turn(...)`) — a FastAPI dependency
can't generalize it because chat/exec resolve or create the thread INSIDE the handler. This test is
the structural enforcement that convention lacks (the `test_arch_invariants_qh9.py` pattern for the
OS-branch allowlist): it derives the mutating set from the ROUTER (source-scanning each endpoint for
thread-mutation markers), so a future endpoint that mutates a thread without reserving fails here —
the ACA-2 concurrent-interleave hole can't silently reopen on endpoint number seven.

Fail-closed in both directions: an unguarded mutator fails the first loop; a drifted expectation
(guard removed, endpoint renamed) fails the exact-set assertion.
"""

from __future__ import annotations

import inspect

from app.api import agent as agent_api

#: Source markers that make a route handler "thread-mutating" (writes message rows or drives the
#: agent loop, which does). Widen this list when a new mutation shape appears — do NOT narrow it.
_MUTATION_MARKERS = (
    "messages.add(",
    "messages.update(",
    ".compact(",
    "session.run_turn(",
    "session.resume(",
)

#: Handlers allowed to mutate WITHOUT a marker. Empty today — additions need a D38-level ruling.
_EXEMPT: frozenset[str] = frozenset()

#: The complete guarded set as of ACA Slice 2 (D38). A new guarded endpoint updates this pin.
_EXPECTED = {
    "chat",
    "resume",
    "exec_shell",
    "compact",
    "edit_plan",
    "apply_proposal_endpoint",
}


def _route_endpoints():
    for route in agent_api.router.routes:
        fn = getattr(route, "endpoint", None)
        if fn is not None:
            yield fn


def test_every_thread_mutating_endpoint_reserves_the_turn_marker() -> None:
    guarded: set[str] = set()
    for fn in _route_endpoints():
        src = inspect.getsource(fn)
        mutates = any(m in src for m in _MUTATION_MARKERS)
        reserves = "_reserve_turn(" in src
        if mutates and fn.__name__ not in _EXEMPT:
            assert reserves, (
                f"{fn.__name__} mutates the thread without reserving the turn marker "
                f"(D38: call _reserve_turn + release, or add an explicit exemption with a ruling)"
            )
        if reserves:
            guarded.add(fn.__name__)
    assert guarded == _EXPECTED, (
        f"guarded-endpoint set drifted: {sorted(guarded)} != {sorted(_EXPECTED)} — "
        "update the pin (new guarded endpoint) or restore the missing guard"
    )
