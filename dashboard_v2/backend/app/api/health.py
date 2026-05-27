"""Health endpoint — the Phase 0 runnable checkpoint."""

from __future__ import annotations

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
        "schema_version": await db.schema_version(),
        "server": {
            "port": settings.server.port,
            "debug": settings.server.debug,
            "poll_seconds": settings.server.poll_seconds,
        },
    }
