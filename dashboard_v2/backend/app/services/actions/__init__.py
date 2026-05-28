"""Built-in actions. Importing this package registers them into the module-level
`core.tool.registry` (each `@action` decorator runs on import). `main.py` calls `build_registry()`
at startup; the rest of the app reads the populated registry.

Phase 2: fleet actions (wake/shutdown/ping). Phase 3: service actions (start/stop/restart/open).
Phase 4d: the agent-only `task_plan` builtin (lives under agent/, registered here on import).
Phase 4f: the `web_search` utility tool (SearXNG-backed, agent-only).
"""

from __future__ import annotations

from app.core.tool import ToolRegistry, registry

# Importing the modules triggers @action registration into `core.tool.registry`.
from app.services.actions import ping, shutdown, wake  # noqa: E402,F401
from app.services.actions import (  # noqa: E402,F401
    open_service_url,
    restart_service,
    start_service,
    stop_service,
    web_search,
)
from app.services.agent import planning  # noqa: E402,F401  # task_plan builtin (agent-only)


def build_registry() -> ToolRegistry:
    """Return the registry with all built-in actions registered (import side effects above)."""
    return registry
