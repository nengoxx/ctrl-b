"""Adapters — the I/O edge (SSH / WOL / ping / inference / DB). Blocking libs are isolated here
and called via `asyncio.to_thread` from the async services (DESIGN.md §1, §7)."""
