"""Built-in fleet actions (Phase 2). Importing this package registers wake/shutdown/ping into the
module-level `core.tool.registry` (their `@action` decorators run on import). `main.py` calls
`build_registry()` at startup; the rest of the app reads the populated registry.
"""

from __future__ import annotations

from app.core.tool import ToolRegistry, registry

# Importing the modules triggers @action registration into `core.tool.registry`.
from app.services.actions import ping, shutdown, wake  # noqa: E402,F401


def build_registry() -> ToolRegistry:
    """Return the registry with all built-in actions registered (import side effects above)."""
    return registry
