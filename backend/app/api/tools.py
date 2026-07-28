"""Tools API (Phase 8, D8) — the Tools-tab surface for **utility** tools.

`GET /api/tools` lists the `ui_exposed` utility subset (the run cards); `POST /api/tools/{name}`
invokes one. This is a thin, **category-guarded facade** over the same `ActionService.invoke` that
`/api/actions` and the agent loop use — NOT a second execution path. The guard (utility + ui_exposed
only) is the security boundary: the Tools surface physically cannot invoke `shutdown_host`,
`run_shell`, or agent-only tools like `web_search` (those live behind `/api/actions` / the agent gate).

Utilities are LOW-risk and never `confirm`, so there's no confirm-token dance — we invoke as
`Actor.USER` at `Privilege.CONFIRM` (LOW ⇒ auto-allow) and the call is audited as an Event like any
other invocation.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field, ValidationError

from app.config import validation_detail
from app.core.tool import UnknownTool
from app.domain.enums import Actor, Privilege
from app.runtime import spec_dto

router = APIRouter(tags=["tools"])


class ToolInvokeRequest(BaseModel):
    args: dict[str, Any] = Field(default_factory=dict)


def _is_util_card(spec) -> bool:
    """The Tools-tab surface = utility tools the owner may run directly."""
    return spec.category == "utility" and spec.ui_exposed


@router.get("/tools")
async def list_tools(request: Request) -> list[dict[str, Any]]:
    """The utility tools shown as Tools-tab cards — metadata + input JSON Schema (drives the cards) +
    `default_agent_mode` so each card can render the tri-state agent-access toggle (8b)."""
    app = request.app
    return [spec_dto(app, t.spec) for t in app.state.actions.registry.all() if _is_util_card(t.spec)]


@router.post("/tools/{name}")
async def invoke_tool(name: str, body: ToolInvokeRequest, request: Request) -> dict[str, Any]:
    """Run a utility tool (USER, audited). 404 for any non-utility / non-card name — the Tools surface
    only invokes its own cards. Returns `{result, event}` (no confirm dance — utilities are LOW)."""
    svc = request.app.state.actions
    try:
        tool = svc.registry.get(name)
    except UnknownTool:
        raise HTTPException(status_code=404, detail=f"unknown tool '{name}'") from None
    if not _is_util_card(tool.spec):
        raise HTTPException(status_code=404, detail=f"'{name}' is not a Tools-tab utility") from None
    try:
        outcome = await svc.invoke(name, body.args, actor=Actor.USER, privilege=Privilege.CONFIRM)
    except ValidationError as exc:
        raise HTTPException(status_code=422, detail=validation_detail(exc)) from None
    return {
        "result": outcome.result.model_dump(mode="json") if outcome.result else None,
        "event": outcome.event.model_dump(mode="json") if outcome.event else None,
    }
