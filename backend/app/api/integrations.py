"""Integrations API (Phase 7c-b) — MCP + OpenAPI server managers + tool re-discovery.

The two scalar integrations (SearXNG/embeddings/open-terminal) ride the settings PUT and hot-apply.
MCP + OpenAPI servers are **lists** whose tools merge into the agent registry, so they're managed by
dedicated, comment-preserving list CRUD here (mirroring `api/hosts.py`) and **applied between turns**:
a write flips `integrations_dirty`, the next `POST /agent/chat` re-discovers before building its
toolset, and `POST /integrations/rediscover` applies on demand (refused while a turn is iterating).
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, ValidationError

from app.config import (
    McpServerCfg,
    OpenApiServerCfg,
    edit_config_yaml,
    load_settings,
    mask_secrets,
    sync_mapping,
    unmask_secrets,
    validation_detail,
)
from app.runtime import (
    apply_settings_inplace,
    integrations_status,
    rediscover_integrations,
    settings_write_lock,
)

router = APIRouter(tags=["integrations"], prefix="/integrations")

# kind → (yaml list key, settings attr, Cfg model)
_KINDS: dict[str, tuple[str, str, type[BaseModel]]] = {
    "mcp": ("mcp_servers", "mcp_servers", McpServerCfg),
    "openapi": ("openapi_servers", "openapi_servers", OpenApiServerCfg),
}


def _kind(kind: str) -> tuple[str, str, type[BaseModel]]:
    if kind not in _KINDS:
        raise HTTPException(status_code=404, detail=f"unknown integration kind '{kind}'")
    return _KINDS[kind]


def _minimal(model: BaseModel) -> dict[str, Any]:
    """A server entry trimmed to its non-default fields (always keeping `name`) — so the persisted
    YAML stays minimal like the rest of the hand-written config instead of dumping every default."""
    defaults = type(model)(name="_").model_dump(mode="json")  # type: ignore[call-arg]
    full = model.model_dump(mode="json")
    return {k: v for k, v in full.items() if k == "name" or v != defaults.get(k)}


def _current(request: Request, attr: str, name: str) -> BaseModel | None:
    return next((s for s in getattr(request.app.state.settings, attr) if s.name == name), None)


def _validate(model_cls: type[BaseModel], data: dict[str, Any]) -> BaseModel:
    try:
        return model_cls.model_validate(data)
    except ValidationError as exc:
        raise HTTPException(status_code=422, detail=validation_detail(exc)) from None


def _seq(doc: Any, key: str) -> Any:
    lst = doc.get(key)
    if not isinstance(lst, list):
        doc[key] = []
        lst = doc[key]
    return lst


def _index_of(lst: Any, name: str) -> int:
    for i, item in enumerate(lst):
        if (item.get("name") if hasattr(item, "get") else None) == name:
            return i
    return -1


async def _finish(request: Request) -> None:
    """Reload the file into the shared settings + flag the change for the next-turn re-discovery."""
    apply_settings_inplace(request.app, load_settings())
    request.app.state.integrations_dirty = True


@router.get("/status")
async def status(request: Request) -> dict[str, Any]:
    """Per-server discovery summaries + the pending-changes flag."""
    return integrations_status(request.app)


@router.post("/rediscover")
async def rediscover(request: Request) -> dict[str, Any]:
    """Apply pending MCP/OpenAPI changes now. Refused (409) while an agent turn is iterating so the
    registry is never mutated under a live loop — retry once the turn finishes (or it auto-applies on
    the next chat). Declared before `/{kind}` so the literal path isn't captured as a kind."""
    # D38/S2-B: the turn-marker registry is the single busy-truth (the old `active_turns` int missed
    # resume turns — `count=False`). Refuse while ANY thread has a live turn.
    if request.app.state.turns:
        raise HTTPException(status_code=409, detail="agent is busy — try again in a moment")
    return await rediscover_integrations(request.app)


@router.post("/{kind}", status_code=201)
async def create_server(kind: str, body: dict[str, Any], request: Request) -> dict[str, Any]:
    key, attr, model_cls = _kind(kind)
    name = str(body.get("name", "")).strip()
    if not name:
        raise HTTPException(status_code=422, detail="server name is required")
    async with settings_write_lock:
        if _current(request, attr, name) is not None:
            raise HTTPException(status_code=409, detail=f"a {kind} server named '{name}' already exists")
        entry = _minimal(_validate(model_cls, {**body, "name": name}))
        edit_config_yaml(lambda doc: _seq(doc, key).append(entry))
        await _finish(request)
    return {"server": mask_secrets(entry), "status": integrations_status(request.app)}


@router.put("/{kind}/{name}")
async def update_server(kind: str, name: str, body: dict[str, Any], request: Request) -> dict[str, Any]:
    key, attr, model_cls = _kind(kind)
    async with settings_write_lock:
        cur = _current(request, attr, name)
        if cur is None:
            raise HTTPException(status_code=404, detail=f"unknown {kind} server '{name}'")
        cur_raw = cur.model_dump(mode="json")  # real secrets
        merged = unmask_secrets({**cur_raw, **body, "name": name}, cur_raw)
        target = _minimal(_validate(model_cls, merged))

        def mutate(doc: Any) -> None:
            lst = _seq(doc, key)
            i = _index_of(lst, name)
            if i < 0:
                lst.append(target)
            elif hasattr(lst[i], "get"):
                sync_mapping(lst[i], target)
            else:
                lst[i] = target

        edit_config_yaml(mutate)
        await _finish(request)
    return {"server": mask_secrets(target), "status": integrations_status(request.app)}


@router.delete("/{kind}/{name}", status_code=200)
async def delete_server(kind: str, name: str, request: Request) -> dict[str, Any]:
    key, attr, _ = _kind(kind)
    async with settings_write_lock:
        if _current(request, attr, name) is None:
            raise HTTPException(status_code=404, detail=f"unknown {kind} server '{name}'")

        def mutate(doc: Any) -> None:
            lst = doc.get(key)
            if isinstance(lst, list):
                i = _index_of(lst, name)
                if i >= 0:
                    del lst[i]

        edit_config_yaml(mutate)
        await _finish(request)
    return {"status": integrations_status(request.app)}
