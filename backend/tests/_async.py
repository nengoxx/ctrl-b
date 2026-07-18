"""Shared, modern async test runner (replaces the deprecated per-file `get_event_loop()` helper).

The suite drove coroutines from SYNC test functions via `asyncio.get_event_loop().run_until_complete()`
duplicated across 13 files. That raises under current pytest-asyncio and Python 3.12+/3.14 (`get_event_loop()`
no longer auto-creates a loop; the policy system is deprecated for removal in 3.16).

This uses **`asyncio.Runner`** (Python 3.11+) — the documented high-level API for *"running multiple top-level
coroutines in the same context"*, which is exactly the suite's pattern (a sync test calls `run_async` many
times, with blocking asserts between, and async resources like aiosqlite connections created in one call must
stay valid in later calls → they must share ONE loop). A single module-level `Runner` reuses one loop across
all `run()` calls AND finalizes it properly (async generators + executor shutdown) on close — unlike a raw
`asyncio.new_event_loop()`, which the docs explicitly say to avoid and which leaks if never closed.

Not `asyncio.run()` per call: it creates+closes a fresh loop each time, orphaning loop-bound resources reused
across calls ("attached to a different loop"). The maximally-idiomatic alternative — converting every test to
`async def` under pytest-asyncio `asyncio_mode = "auto"` (function-scoped loops) — is a much larger refactor;
noted as future work (TRIAGE-2). 3.11 → 3.14+ (3.14's event loop is thread-safe + faster).
"""

import asyncio
import atexit

# Lazy: Runner doesn't create the loop until the first run(); closed at process exit so it finalizes cleanly.
_runner = asyncio.Runner()
atexit.register(_runner.close)


def run_async(coro):
    """Run a coroutine to completion on the shared test loop (`asyncio.Runner`; 3.14-safe). Returns its result."""
    return _runner.run(coro)


def drain_run_calls(session, *args, **kwargs):
    """Drive the async-generator `AgentSession._run_calls` (D40 §2 — it now `yield`s events per-call and
    returns no value) to completion, and return the legacy `(events, suspended, made_progress)` tuple the
    older tests were written against. Constructs the `_BatchOutcome` holder that `_drive` now passes and
    reads it after the stream drains. Positional/keyword `*args`/`**kwargs` are forwarded verbatim (e.g.
    `drain_run_calls(session, thread, assistant, {}, guard)` or `..., {cid: "emma"}`)."""
    from app.services.agent.session import _BatchOutcome

    outcome = _BatchOutcome()

    async def _collect():
        return [ev async for ev in session._run_calls(*args, outcome=outcome, **kwargs)]

    events = run_async(_collect())
    return events, outcome.suspended, outcome.made_progress
