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
    #: VPN/overlay address (D47 / ROADMAP D3) — a MagicDNS name (preferred) or an overlay IP; generic,
    #: never named after a VPN product in logic. `None` ⇒ LAN-only (see `host_addresses`).
    vpn_host: str | None = None
    #: Per-host SSH failover preference (D47). See `ComputerCfg.ssh_prefer_vpn`.
    ssh_prefer_vpn: bool = False
    tags: list[str] = []


def host_addresses(host: Host, prefer_vpn: bool) -> list[str]:
    """The ordered, de-duplicated reach candidates for a multi-homed host (D47 / ROADMAP D3).

    THE single source of truth for the LAN>VPN preference — call sites never hardcode a candidate
    order. Default order is `[ip, vpn_host]`; `prefer_vpn` flips it to `[vpn_host, ip]` (a host whose
    LAN sshd is firewalled but whose overlay answers). Blank/`None` entries are dropped and duplicates
    removed preserving first-seen order (the `endpoint_chain` blank-drop precedent, config.py). A host
    with no `vpn_host` yields exactly `[ip]` — today's behavior, zero change.

    Pure helper on the domain leaf (no services/adapters imports) so the failover loop in the
    services layer can depend on it without an import cycle.
    """
    ordered = [host.vpn_host, host.ip] if prefer_vpn else [host.ip, host.vpn_host]
    seen: set[str] = set()
    out: list[str] = []
    for addr in ordered:
        a = (addr or "").strip()
        if a and a not in seen:
            seen.add(a)
            out.append(a)
    return out


class HostStatus(BaseModel):
    """Derived liveness — never persisted in YAML, computed by the fleet ping fan-out."""

    host_id: str
    online: bool
    ping_ms: float | None = None
    last_seen: datetime | None = None
    checked_at: datetime
    error: str | None = None  # e.g. "name resolution failed" — surfaced, not raised
