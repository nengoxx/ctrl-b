"""Access API (Phase 6c-2) — the in-app HTTPS control (Tailscale Serve).

`GET /access/status` is the always-on read the Conf → Access panel polls (tailscaled is the source of
truth — see `services/actions/tailscale.py`). `POST /access/serve {enable}` flips it through the typed
`tailscale_serve_*` action at USER/FULL, so each change is audited as an Event, then returns the fresh
status. Thin by design (validate + delegate). See DECISIONS D20 / `HTTPS_TAILSCALE.md`.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from app.domain.enums import Actor, Privilege, RunState
from app.domain.result import ToolResult
from app.services.actions.tailscale import resolve_status

router = APIRouter(tags=["access"], prefix="/access")


async def _status(request: Request) -> dict[str, Any]:
    cfg = request.app.state.settings.tailscale
    st = await resolve_status(cfg)
    st["enabled"] = cfg.enabled  # whether the control surface is active at all
    return st


@router.get("/status")
async def access_status(request: Request) -> dict[str, Any]:
    """Live Tailscale Serve status for the Access panel: `{available, serving, url, target_port,
    reason, enabled}`."""
    return await _status(request)


class ServeRequest(BaseModel):
    enable: bool


@router.post("/serve")
async def access_serve(body: ServeRequest, request: Request) -> dict[str, Any]:
    """Enable/disable Tailscale Serve HTTPS via the audited `tailscale_serve_*` action, then return the
    fresh status (with the action outcome under `last`)."""
    cfg = request.app.state.settings.tailscale
    if not cfg.enabled:
        raise HTTPException(status_code=403, detail="Tailscale control is disabled (tailscale.enabled)")
    name = "tailscale_serve_enable" if body.enable else "tailscale_serve_disable"
    outcome = await request.app.state.actions.invoke(
        name, {}, actor=Actor.USER, privilege=Privilege.FULL
    )
    result = outcome.result or ToolResult(state=RunState.ERROR, summary="no result")
    st = await _status(request)
    st["last"] = {"state": result.state.value, "summary": result.summary, "error": result.error}
    return st
