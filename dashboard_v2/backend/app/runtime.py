"""Runtime (re)configuration seam (Phase 7a, audit B1/B2).

The single place that turns `Settings` into wired, stateful adapters. Some runtime objects read the
shared `Settings` live (`FleetService`/`ServiceService`/`Deps` hold the reference and call
`settings.hosts()`/`.poll_seconds` each time), so an in-place update reaches them for free. Others
**captured** a sub-config + built a client once (`InferenceClient` caches an SDK client per base_url)
and must be rebuilt when their config changes.

**Anti-drift rule:** lifespan and `reconfigure` must never each construct an adapter inline — both
call the same `set_*(app, settings)` helper here, so there is exactly one construction site per
subsystem and the two paths cannot drift. This is also the future home of `build_runtime`: promoting
the light seam to a full rebuild-and-swap is "call every `set_*` + swap", not a rewrite.

Currently 7a only hot-applies `inference` + the live-read scalars (`server.poll_seconds`, host
edits). Later slices add `set_searxng`/`set_embeddings`/`set_open_terminal`/`rediscover_tools` here,
call them from lifespan too, and extend `reconfigure` — never a parallel reload path.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from app.adapters.embeddings import EmbeddingsClient
from app.adapters.inference import InferenceClient
from app.adapters.openterminal import OpenTerminalClient
from app.adapters.searxng import SearxngClient
from app.adapters.voice import VoiceClient
from app.config import Settings

if TYPE_CHECKING:
    from fastapi import FastAPI


def set_inference(app: "FastAPI", settings: Settings) -> None:
    """Build + wire the inference client from `settings.inference`. The single construction site for
    inference, called by both lifespan and `reconfigure`. Assigns `app.state.inference` (read per
    turn by `api/agent._session`) and mirrors it onto `app.state.deps.inference` so subagents use the
    same client. Cheap + lazy — the SDK client is only opened on first use."""
    app.state.inference = InferenceClient(settings.inference)
    deps = getattr(app.state, "deps", None)
    if deps is not None:
        deps.inference = app.state.inference


async def _swap_client(app: "FastAPI", attr: str, new_client: object) -> None:
    """Assign a freshly built adapter client onto `app.state.<attr>` (and mirror onto `deps.<attr>`),
    closing the previous one's httpx session first. The single-source helper for the scalar
    integration clients — called by both lifespan and `reconfigure`, so the two can't drift. At
    lifespan there's no prior client to close and `deps` isn't built yet (skipped); `Deps(...)` then
    reads `app.state.<attr>`."""
    old = getattr(app.state, attr, None)
    if old is not None and hasattr(old, "aclose"):
        await old.aclose()
    setattr(app.state, attr, new_client)
    deps = getattr(app.state, "deps", None)
    if deps is not None:
        setattr(deps, attr, new_client)


async def set_searxng(app: "FastAPI", settings: Settings) -> None:
    await _swap_client(app, "searxng", SearxngClient(settings.searxng))


async def set_embeddings(app: "FastAPI", settings: Settings) -> None:
    await _swap_client(app, "embeddings", EmbeddingsClient(settings.embeddings))


async def set_open_terminal(app: "FastAPI", settings: Settings) -> None:
    await _swap_client(app, "open_terminal", OpenTerminalClient(settings.open_terminal))


async def set_voice(app: "FastAPI", settings: Settings) -> None:
    """Build + wire the voice client from `settings.voice` (Phase 6). Voice isn't consumed by the
    agent loop/subagents, so it lives on `app.state.voice` only (the `_swap_client` deps mirror is
    harmless); the STT/TTS endpoints read it per request, so a Conf edit hot-applies."""
    await _swap_client(app, "voice", VoiceClient(settings.voice))


def apply_tool_descriptions(app: "FastAPI", settings: Settings | None = None) -> None:
    """Overlay the per-tool description overrides (Phase 7d) onto the **live** registry specs. The
    model sees `spec.description` via `to_openai_tools` and `GET /api/actions` returns it, so mutating
    the registered specs in place is the single seam that reaches both paths at once.

    Originals are captured once on `app.state.tool_desc_orig` (keyed by tool name), so clearing an
    override restores the tool's built-in description rather than leaving the last override stuck. Run
    by lifespan (after the registry is built), by `reconfigure` (when `tool_descriptions` changed), and
    at the end of `rediscover_integrations` (so freshly re-discovered MCP/OpenAPI tools pick overrides
    up too)."""
    settings = settings or app.state.settings
    overrides: dict = getattr(settings, "tool_descriptions", None) or {}
    registry = app.state.actions.registry
    orig: dict = getattr(app.state, "tool_desc_orig", None)
    if orig is None:
        orig = {}
        app.state.tool_desc_orig = orig
    for tool in registry.all():
        name = tool.spec.name
        if name not in orig:
            orig[name] = tool.spec.description
        ov = overrides.get(name)
        tool.spec.description = ov.strip() if isinstance(ov, str) and ov.strip() else orig[name]


async def rediscover_integrations(app: "FastAPI") -> dict:
    """Rebuild the MCP + OpenAPI tool sets from current settings and merge them into the live
    registry (Phase 7c-b). MCP and OpenAPI tools both register as category `"mcp"`, so we clear that
    bucket and re-run both providers' `discover()`. Guarded by `app.state.discovery_lock` and only
    ever called **between** agent turns (auto at a new turn's start when `integrations_dirty`, or via
    the manual endpoint which refuses while a turn is active) — never mid-turn, so an iterating loop
    never sees the registry change under it. Returns the fresh `{mcp, openapi, dirty}` status."""
    from app.adapters.mcp_client import McpClient
    from app.adapters.openapi_tools import OpenApiToolProvider

    async with app.state.discovery_lock:
        settings: Settings = app.state.settings
        registry = app.state.actions.registry
        registry.remove_category("mcp")

        old_openapi = getattr(app.state, "openapi", None)
        if old_openapi is not None and hasattr(old_openapi, "aclose"):
            await old_openapi.aclose()

        app.state.mcp = McpClient(settings.mcp_servers)
        app.state.mcp_summary = await app.state.mcp.discover(registry)
        app.state.openapi = OpenApiToolProvider(settings.openapi_servers)
        app.state.openapi_summary = await app.state.openapi.discover(registry)
        app.state.integrations_dirty = False
    # Re-apply description overrides onto the freshly registered MCP/OpenAPI specs (Phase 7d).
    apply_tool_descriptions(app)
    return integrations_status(app)


def integrations_status(app: "FastAPI") -> dict:
    """The per-server discovery summaries + the pending-changes flag (`GET /api/integrations/status`
    and the rediscover response)."""
    return {
        "mcp": getattr(app.state, "mcp_summary", []),
        "openapi": getattr(app.state, "openapi_summary", []),
        "dirty": bool(getattr(app.state, "integrations_dirty", False)),
    }


def apply_settings_inplace(app: "FastAPI", new: Settings) -> None:
    """Copy `new`'s top-level fields onto the **shared** `app.state.settings` object in place, so
    every holder that reads it lazily (`FleetService`/`ServiceService`/`Deps.settings`) sees the new
    values without being rebuilt. Mutating in place (rather than rebinding) is what keeps those live
    readers pointed at the same object."""
    cur: Settings = app.state.settings
    for field in type(cur).model_fields:
        setattr(cur, field, getattr(new, field))
    # `extra="allow"` sections (e.g. staged stt/tts) live in __pydantic_extra__, not model_fields.
    cur.__pydantic_extra__ = dict(new.__pydantic_extra__ or {})


def invalidate_status_caches(app: "FastAPI") -> None:
    """Drop the fleet + service status caches so a host/poll change is reflected on the next poll
    instead of being served stale until the old TTL elapses (audit B4)."""
    for svc_name in ("fleet", "services"):
        svc = getattr(app.state, svc_name, None)
        if svc is not None:
            svc._cache = None
            svc._cache_at = 0.0


def _changed(old: Settings, new: Settings, field: str) -> bool:
    return getattr(old, field) != getattr(new, field)


async def reconfigure(app: "FastAPI", new: Settings) -> None:
    """Hot-apply a freshly validated `Settings` (already persisted by the caller) into the running
    app. Rebuilds only the adapters whose section changed; the rest are reached via the in-place
    shared-settings update. The one entry point `PUT /api/settings` calls — later slices extend this
    body, not the caller."""
    old: Settings = app.state.settings
    inference_changed = _changed(old, new, "inference")
    searxng_changed = _changed(old, new, "searxng")
    embeddings_changed = _changed(old, new, "embeddings")
    open_terminal_changed = _changed(old, new, "open_terminal")
    voice_changed = _changed(old, new, "voice")
    tool_desc_changed = _changed(old, new, "tool_descriptions")
    caches_stale = _changed(old, new, "server") or _changed(old, new, "computers")

    apply_settings_inplace(app, new)
    if inference_changed:
        set_inference(app, new)
    if searxng_changed:
        await set_searxng(app, new)
    if embeddings_changed:
        await set_embeddings(app, new)
    if open_terminal_changed:
        await set_open_terminal(app, new)
    if voice_changed:
        await set_voice(app, new)
    if tool_desc_changed and getattr(app.state, "actions", None) is not None:
        apply_tool_descriptions(app, new)
    if caches_stale:
        invalidate_status_caches(app)
