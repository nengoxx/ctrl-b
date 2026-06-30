"""Services API (Phase 3). `GET /api/services` lists declared services with derived liveness;
`POST /api/services/{id}/actions/{action}` runs a control action through the same `ActionService`
(and its confirm-token dance) as the fleet actions — services are just more typed actions.

The control endpoint maps a short action verb (`start`/`stop`/`restart`/`open`) to the registered
action name and injects `service_id` from the path, so the client never has to know the action's
internal name. MED-risk controls (stop/restart) come back as `{needs_confirm, confirm_token}` at
the UI's `Privilege.CONFIRM`, exactly like shutting down a host.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, ValidationError

from app.core.tool import UnknownTool
from app.domain.host import Host
from app.domain.service import Service, ServiceStatus

router = APIRouter(tags=["services"])

#: Short verb (URL) → registered action name.
_ACTION_NAMES: dict[str, str] = {
    "start": "start_service",
    "stop": "stop_service",
    "restart": "restart_service",
    "open": "open_service_url",
}


class ServiceActionRequest(BaseModel):
    confirm_token: str | None = None


def _service_dto(
    svc: Service, host: Host | None, status: ServiceStatus | None, url: str | None
) -> dict[str, Any]:
    controls = (
        [a for a in ("start", "stop", "restart") if svc.command_for(a, host.os_type)]
        if host
        else []
    )
    return {
        "id": svc.id,
        "host_id": svc.host_id,
        "name": svc.name,
        "kind": svc.kind,
        "port": svc.port,
        "path": svc.path,
        "autostart": svc.autostart,
        "url": url,
        "controls": controls,  # control actions configured for this host's OS
        "status": status.model_dump(mode="json") if status else None,
    }


@router.get("/services")
async def list_services(request: Request) -> list[dict[str, Any]]:
    """All declared services with derived liveness (shared, cached probe sweep)."""
    svc_service = request.app.state.services
    fleet = request.app.state.fleet
    hosts = {h.id: h for h in fleet.hosts()}
    statuses = {s.service_id: s for s in await svc_service.status_all()}
    return [
        _service_dto(s, hosts.get(s.host_id), statuses.get(s.id), svc_service.url_for(s.id))
        for s in svc_service.services()
    ]


@router.post("/services/{service_id}/actions/{action}")
async def invoke_service_action(
    service_id: str, action: str, body: ServiceActionRequest, request: Request
) -> dict[str, Any]:
    """Run a service control action. Same response shape as `POST /api/actions/{name}`:
    `{needs_confirm, confirm_token}` (re-POST with the token) or `{needs_confirm:false, result, event}`."""
    name = _ACTION_NAMES.get(action)
    if name is None:
        raise HTTPException(status_code=404, detail=f"unknown service action '{action}'")

    svc = request.app.state.services
    if svc.service(service_id) is None:
        raise HTTPException(status_code=404, detail=f"unknown service '{service_id}'")

    actions = request.app.state.actions
    try:
        outcome = await actions.invoke(
            name, {"service_id": service_id}, confirm_token=body.confirm_token
        )
    except UnknownTool:
        raise HTTPException(status_code=404, detail=f"unknown action '{name}'") from None
    except ValidationError as exc:
        raise HTTPException(status_code=422, detail=exc.errors(include_url=False)) from None

    if outcome.needs_confirm:
        return {
            "needs_confirm": True,
            "confirm_token": outcome.confirm_token,
            "prompt": outcome.confirm_prompt,
        }
    return {
        "needs_confirm": False,
        "result": outcome.result.model_dump(mode="json") if outcome.result else None,
        "event": outcome.event.model_dump(mode="json") if outcome.event else None,
    }
