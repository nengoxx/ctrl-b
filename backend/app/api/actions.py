"""Action API (Phase 2). `GET /api/actions` lists the registry; `POST /api/actions/{name}` runs
an action with the confirm-token dance for high-risk ones (DESIGN.md §14).

The UI invokes as `Actor.USER` at `Privilege.CONFIRM`, which makes wake/ping run immediately and
shutdown require a confirm token. The request body is `{ "args": {...}, "confirm_token": ... }`.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field, ValidationError

from app.config import validation_detail
from app.core.tool import UnknownTool
from app.domain.event import ORIGIN_USER_CHAT
from app.runtime import spec_dto

router = APIRouter(tags=["actions"])


class InvokeRequest(BaseModel):
    args: dict[str, Any] = Field(default_factory=dict)
    confirm_token: str | None = None


@router.get("/actions")
async def list_actions(request: Request) -> list[dict[str, Any]]:
    """The action registry — metadata + input JSON Schema (drives UI buttons; the agent toolset; and
    the Phase-8b Tools-tab catalog). Each DTO carries `default_agent_mode` (see `runtime.spec_dto`) so
    the catalog can mark defaults, store only deviations, and offer a reset, plus `approvals` (D44 W3):
    the tool's live persisted 'always allow' rules (`tool_overrides[name].approvals`, `[]` when none) —
    approvals are settings state, NOT a spec property (they never overlay the spec, §3), so they're
    read here beside the live settings rather than in `spec_dto`. This keeps the catalog's invariant
    that its whole state reconstructs from this ONE always-active `["actions"]` query (the approvals
    editor renders + revokes from these, and `useSaveToolOverrides` re-invalidates `["actions"]`)."""
    app = request.app
    overrides = app.state.settings.tool_overrides
    dtos: list[dict[str, Any]] = []
    for t in app.state.actions.registry.all():
        d = spec_dto(app, t.spec)
        ov = overrides.get(t.spec.name)
        d["approvals"] = [r.model_dump(mode="json") for r in ov.approvals] if ov and ov.approvals else []
        dtos.append(d)
    return dtos


@router.post("/actions/{name}")
async def invoke_action(name: str, body: InvokeRequest, request: Request) -> dict[str, Any]:
    """Run an action. Returns either `{needs_confirm: true, confirm_token, ...}` (re-POST with the
    token to proceed) or `{needs_confirm: false, result, event}`."""
    svc = request.app.state.actions
    try:
        outcome = await svc.invoke(name, body.args, origin=ORIGIN_USER_CHAT, confirm_token=body.confirm_token)
    except UnknownTool:
        raise HTTPException(status_code=404, detail=f"unknown action '{name}'") from None
    except ValidationError as exc:
        raise HTTPException(status_code=422, detail=validation_detail(exc)) from None

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
