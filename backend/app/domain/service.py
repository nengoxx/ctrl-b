"""Service + ServiceStatus domain models (DESIGN.md §2).

A `Service` is a long-running app on a host (jellyfin, ollama, …). Its `id` is a stable slug
`"{host_id}.{service_slug}"` so it survives renames and never collides across hosts. `cmd` holds
the per-OS control commands keyed by action (`start`/`stop`/`restart`) → `{OSType: command}`; the
host's `os_type` selects which command runs, and a missing entry is a clean DENIED outcome (never
a crash). State is **derived** (port reachable / host online), never persisted in YAML.
"""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel

from app.domain.enums import OSType


class Service(BaseModel):
    id: str
    host_id: str
    name: str
    kind: str | None = None  # "jellyfin", "ollama", … — informational
    port: int | None = None  # probed for liveness; None → can't probe, tracks host online
    path: str = ""  # URL path suffix, e.g. "/web"
    autostart: bool = False
    #: {"start": {windows: "...", linux: "..."}, "stop": {...}, "restart": {...}}
    cmd: dict[str, dict[OSType, str]] = {}

    def command_for(self, action: str, os_type: OSType) -> str | None:
        """The configured control command for this action on the host's OS, or None."""
        return (self.cmd.get(action) or {}).get(os_type)


class ServiceStatus(BaseModel):
    """Derived liveness — computed by the service probe fan-out, never stored.

    `online` means the port answered a TCP connect (or, for a port-less service, the host is up).
    """

    service_id: str
    online: bool
    checked_at: datetime
    error: str | None = None
