"""Arch invariant: every thread-mutating endpoint reserves the turn marker (D38).

The busy guard is applied per handler by convention (`_reserve_turn(...)`) — a FastAPI dependency
can't generalize it because chat/exec resolve or create the thread INSIDE the handler. This test is
the structural enforcement that convention lacks (the `test_arch_invariants_qh9.py` pattern for the
OS-branch allowlist): it derives the mutating set from the ROUTER (source-scanning each endpoint for
thread-mutation markers), so a future endpoint that mutates a thread without reserving fails here —
the ACA-2 concurrent-interleave hole can't silently reopen on endpoint number seven.

Fail-closed in both directions: an unguarded mutator fails the first loop; a drifted expectation
(guard removed, endpoint renamed) fails the exact-set assertion.

What this LEXICAL tripwire proves — and what it does NOT (C3-L1). It is a source-substring scan over
CODE ONLY (comments + string/docstring tokens are blanked by `_code_only` before matching, so a
marker mentioned in prose never counts as a mutation and a `_reserve_turn(` in a docstring never
counts as a guard). What it PROVES: no router handler *textually* performs one of the listed write
shapes (`_MUTATION_MARKERS`) without also *textually* calling `_reserve_turn(`. What it does NOT
prove: (1) that the reserve is CORRECTLY PLACED — it could sit after the write, or on the wrong
thread id, or be released too early — ordering/placement is out of a lexical scan's reach; (2) that a
write reaching the DB through an UNLISTED shape (a new repo method, a helper that hides `.execute`, a
raw cursor) is caught — a genuinely new mutation vocabulary must be ADDED to `_MUTATION_MARKERS`
(widen, never narrow); (3) anything about a mutation performed by a called helper whose source isn't
inlined here (only the handler's own `inspect.getsource` is scanned). It is a cheap structural
backstop against the obvious regression (a new endpoint that forgets the guard), not a proof of
concurrency-correctness — that lives in the D38/D39 turn-integrity tests.
"""

from __future__ import annotations

import inspect
import io
import tokenize

from app.api import agent as agent_api

#: Source markers that make a route handler "thread-mutating" (writes message/thread rows or drives
#: the agent loop, which does). Widen this list when a new mutation shape appears — do NOT narrow it.
#: `db.execute(`/`threads.touch(`/`.transaction(` (C3-L1) catch a write that bypasses the `messages`
#: repo helpers or touches the thread row directly.
_MUTATION_MARKERS = (
    "messages.add(",
    "messages.update(",
    "db.execute(",
    "threads.touch(",
    ".transaction(",
    ".compact(",
    "session.run_turn(",
    "session.resume(",
)


def _code_only(src: str) -> str:
    """Return `src` with every COMMENT and STRING token blanked (positions preserved) so the lexical
    marker scan reads ACTUAL CODE only (C3-L1). Without this the tripwire is dishonest in both
    directions: a marker sitting in a comment/docstring would count a handler as "mutating", and a
    `_reserve_turn(` mentioned in a docstring would count it as "guarded" — neither is real code. A
    tokenize pass is exact where a regex/`ast.get_source_segment` split would mangle f-strings or lose
    the original substrings (`messages.add(`). On a tokenizer error, fall back to the raw source
    (fail-loud-ish: the scan still runs, just without the strip)."""
    try:
        toks = list(tokenize.generate_tokens(io.StringIO(src).readline))
    except tokenize.TokenError:
        return src
    grid = [list(line) for line in src.splitlines(keepends=True)]
    blanked = {tokenize.COMMENT, tokenize.STRING, getattr(tokenize, "FSTRING_MIDDLE", -1)}
    for tok in toks:
        if tok.type not in blanked:
            continue
        (sr, sc), (er, ec) = tok.start, tok.end
        for row in range(sr, er + 1):
            line = grid[row - 1]
            c0 = sc if row == sr else 0
            c1 = ec if row == er else len(line)
            for col in range(c0, min(c1, len(line))):
                if line[col] != "\n":
                    line[col] = " "
    return "".join("".join(row) for row in grid)


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


def test_every_thread_mutating_endpoint_revalidates_under_its_marker() -> None:
    """A3 §D-3: the SAME set of thread-mutating endpoints must refuse a thread an automation owns as its
    rolling conversation — chat and exec were only the obvious two. Compact rewrites its history, a plan
    edit and a proposal apply rewrite its messages in place, and resume continues a suspended turn inside
    it; each changes what the automation's next scheduled run reads as context.

    Pinned as `_revalidate_thread`, which is the check made AFTER the turn marker is reserved (wave 2):
    every one of these handlers loads and decides BEFORE it reserves, and in that window the automations
    service can commit a prune, a delete or a mode switch — so a pre-reserve check alone is a check
    against a thread the handler may no longer be entitled to touch. The ORDER is asserted, not just the
    presence, and against the SAME `_EXPECTED` set as the marker guard, so the two can never drift."""
    guarded: set[str] = set()
    for fn in _route_endpoints():
        src = _code_only(inspect.getsource(fn))
        if "_revalidate_thread(" not in src:
            continue
        guarded.add(fn.__name__)
        reserve_at = min(
            (src.index(m) for m in ("_reserve_turn(", "_reserve_or_busy(") if m in src),
            default=-1,
        )
        assert reserve_at >= 0, f"{fn.__name__} revalidates without ever reserving"
        assert src.index("_revalidate_thread(") > reserve_at, (
            f"{fn.__name__} revalidates BEFORE it reserves — the whole point is that the marker is "
            "already held, so the answer cannot go stale between the check and the mutation"
        )
    assert guarded == _EXPECTED, (
        "the rolling-thread guard and the turn-marker guard must cover the same endpoints "
        f"(missing: {sorted(_EXPECTED - guarded)}, unexpected: {sorted(guarded - _EXPECTED)})"
    )


def test_every_thread_mutating_endpoint_reserves_the_turn_marker() -> None:
    guarded: set[str] = set()
    for fn in _route_endpoints():
        src = _code_only(inspect.getsource(fn))  # scan CODE only — markers in comments/docstrings don't count
        mutates = any(m in src for m in _MUTATION_MARKERS)
        # `_reserve_turn(` is the busy-or-409 chokepoint (5 sync endpoints); `_reserve_or_busy(` is the
        # D41 variant chat/exec call so they can steer-enqueue on a busy thread — both reserve the marker.
        reserves = "_reserve_turn(" in src or "_reserve_or_busy(" in src
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
