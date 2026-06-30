"""Utility tools (Phase 8, D8) — the Tools-tab card registry.

Each module here registers exactly one `@tool` (a `category="utility"`, `ui_exposed=True` capability)
into the shared `core.tool.registry` on import — the same registry the actions/builtins/MCP tools
live in (NOT a parallel registry; D8). `services/actions/__init__.py` imports this package so the
registration side effects run at startup, and `api/tools.py` exposes the `ui_exposed` utility subset
as Tools-tab cards (`GET /api/tools`) + a category-guarded invoke (`POST /api/tools/{name}`).

Adding a utility = drop one file with one `@tool` + a flat Pydantic input model. Keep the input
model flat (scalar `Field(...)`s) so the generic card renders it with no per-tool UI code.
"""

from __future__ import annotations
