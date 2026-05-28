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

from app.adapters.inference import InferenceClient
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
    caches_stale = _changed(old, new, "server") or _changed(old, new, "computers")

    apply_settings_inplace(app, new)
    if inference_changed:
        set_inference(app, new)
    if caches_stale:
        invalidate_status_caches(app)
