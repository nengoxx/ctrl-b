"""Host + HostStatus domain models (DESIGN.md §2).

`Host.id` is a stable slug decoupled from `name` so renames don't orphan services/events.
`mac=None` and `ssh_*=None` are first-class — actions needing them fail with a clear result
later, never an exception. `ssh_password` is a `SecretStr` so it's never logged or serialized
by accident (the hosts API builds an explicit public DTO that omits it entirely).
"""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, SecretStr

from app.domain.enums import OSType


class Host(BaseModel):
    id: str
    name: str
    ip: str
    mac: str | None = None
    ssh_username: str | None = None
    ssh_password: SecretStr | None = None
    ssh_port: int = 22
    os_type: OSType = OSType.LINUX
    role: str | None = None
    tags: list[str] = []


class HostStatus(BaseModel):
    """Derived liveness — never persisted in YAML, computed by the fleet ping fan-out."""

    host_id: str
    online: bool
    ping_ms: float | None = None
    last_seen: datetime | None = None
    checked_at: datetime
    error: str | None = None  # e.g. "name resolution failed" — surfaced, not raised
