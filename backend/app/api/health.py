"""Health endpoint — the Phase 0 runnable checkpoint."""

from __future__ import annotations

import os

from fastapi import APIRouter, Request

from app import __version__

router = APIRouter(tags=["health"])


@router.get("/health")
async def health(request: Request) -> dict[str, object]:
    """Liveness + a peek at config/db wiring (no secrets)."""
    db = request.app.state.db
    settings = request.app.state.settings
    return {
        "status": "ok",
        "version": __version__,
        # WHO answered. `install.sh`'s health gate compares this to systemd's `MainPID`, because
        # `ActiveState=active` plus a non-zero MainPID does NOT prove that the unit is what served the
        # request: a stale hand-started process can hold the port while the real unit fails to bind and
        # is briefly `active` on its way to a restart (UPDATE_PLAN §15.1). Not a secret — the endpoint
        # already reports version and schema, and it is tailnet-only.
        "pid": os.getpid(),
        "schema_version": await db.schema_version(),
        "server": {
            "port": settings.server.port,
            "debug": settings.server.debug,
            "poll_seconds": settings.server.poll_seconds,
            "feature_cycle_seconds": settings.server.feature_cycle_seconds,
        },
    }
