"""Action API (Phase 2). `GET /api/actions` lists the registry; `POST /api/actions/{name}` runs
an action with the confirm-token dance for high-risk ones (DESIGN.md §14).

The UI invokes as `Actor.USER` at `Privilege.CONFIRM`, which makes wake/ping run immediately and
shutdown require a confirm token. The request body is `{ "args": {...}, "confirm_token": ... }`.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field, ValidationError

from app.core.tool import UnknownTool, spec_to_dict
from app.runtime import agent_mode_of

router = APIRouter(tags=["actions"])


class InvokeRequest(BaseModel):
    args: dict[str, Any] = Field(default_factory=dict)
    confirm_token: str | None = None


@router.get("/actions")
async def list_actions(request: Request) -> list[dict[str, Any]]:
    """The action registry — metadata + input JSON Schema (drives UI buttons; the agent toolset; and
    the Phase-8b Tools-tab catalog). Each DTO is enriched with `default_agent_mode`: the tri-state
    `agent_mode` the tool's compile-time `(agent_exposed, core)` represents, read from the captured
    originals (`tool_spec_orig`) so a tool whose mode is currently overridden still reports its
    *default* — letting the catalog mark defaults, store only deviations, and offer a reset."""
    svc = request.app.state.actions
    orig: dict = getattr(request.app.state, "tool_spec_orig", None) or {}
    out: list[dict[str, Any]] = []
    for t in svc.registry.all():
        d = spec_to_dict(t.spec)
        base = orig.get(t.spec.name)
        base_exposed, base_core = base[1:3] if base else (t.spec.agent_exposed, t.spec.core)
        d["default_agent_mode"] = agent_mode_of(base_exposed, base_core)
        out.append(d)
    return out


@router.post("/actions/{name}")
async def invoke_action(name: str, body: InvokeRequest, request: Request) -> dict[str, Any]:
    """Run an action. Returns either `{needs_confirm: true, confirm_token, ...}` (re-POST with the
    token to proceed) or `{needs_confirm: false, result, event}`."""
    svc = request.app.state.actions
    try:
        outcome = await svc.invoke(name, body.args, confirm_token=body.confirm_token)
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
