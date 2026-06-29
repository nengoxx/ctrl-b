"""Shared, modern async test runner (replaces the deprecated per-file `get_event_loop()` helper).

The suite drove coroutines from SYNC test functions via a `asyncio.get_event_loop().run_until_complete()`
helper duplicated across 13 files. That pattern RAISES under current pytest-asyncio and Python 3.12+/3.14:
`get_event_loop()` no longer auto-creates a loop when none is set (it raises `RuntimeError`), and the
`DefaultEventLoopPolicy` is removed in 3.16.

This centralizes ONE explicitly-created persistent loop and exposes `run_async(coro)`. It preserves the
exact semantics the tests rely on — a SHARED loop across the many `run_async` calls within a test, so async
resources (e.g. aiosqlite connections) created in one call are still valid in later calls — while never
touching the deprecated API. `asyncio.new_event_loop()` is fully supported on 3.11 → 3.14+.

Why not `asyncio.run()` per call: it creates+closes a fresh loop each time, which would orphan loop-bound
resources reused across calls ("attached to a different loop"). Why not `pytest.mark.asyncio` everywhere:
a much larger refactor (every test → async); this is the minimal, behavior-preserving, 3.14-safe fix.
"""

import asyncio

_loop = asyncio.new_event_loop()


def run_async(coro):
    """Run a coroutine to completion on the shared test loop (3.14-safe). Returns its result."""
    return _loop.run_until_complete(coro)
