"""Fleet read API (Phase 1). Status comes from the cached concurrent ping sweep.

The list DTO deliberately omits `ssh_password` — the fleet view never needs it, and the Conf
tab (Phase 7) will read/write secrets through the masked settings endpoint instead.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Request

from app.domain.host import Host, HostStatus

router = APIRouter(tags=["fleet"])


def _host_dto(host: Host, status: HostStatus | None) -> dict[str, Any]:
    return {
        "id": host.id,
        "name": host.name,
        "ip": host.ip,
        "mac": host.mac,
        "ssh_username": host.ssh_username,
        "ssh_port": host.ssh_port,
        "os_type": host.os_type.value,
        "role": host.role,
        "tags": host.tags,
        "status": status.model_dump(mode="json") if status else None,
    }


@router.get("/hosts")
async def list_hosts(request: Request) -> list[dict[str, Any]]:
    """All hosts with derived status (shared, cached ping sweep)."""
    fleet = request.app.state.fleet
    statuses = {s.host_id: s for s in await fleet.status_all()}
    return [_host_dto(h, statuses.get(h.id)) for h in fleet.hosts()]


@router.get("/hosts/{host_id}/status")
async def host_status(host_id: str, request: Request) -> HostStatus:
    """Fresh status for one host (bypasses the fleet cache)."""
    fleet = request.app.state.fleet
    status = await fleet.status_of(host_id)
    if status is None:
        raise HTTPException(status_code=404, detail=f"unknown host '{host_id}'")
    return status
