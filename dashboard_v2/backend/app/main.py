"""App factory + ASGI entrypoint.

Dev: Vite proxies `/api` → uvicorn (single origin, no CORS). Prod (Phase 9): this also serves
the built `frontend/dist` via StaticFiles + SPA fallback. Phase 0 only wires lifespan (db +
settings) and the `/api/health` checkpoint.

Run:  uvicorn app.main:app --reload --port 5433   (from backend/)
"""

from __future__ import annotations

from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app import __version__
from app.api import actions, events, health, hosts, services
from app.config import load_dotenv, load_settings
from app.core.events import EventBus
from app.db import Database
from app.services.action_service import ActionService
from app.services.actions import build_registry
from app.services.deps import Deps
from app.services.events import EventService
from app.services.fleet import FleetService
from app.services.svc import ServiceService

# backend/app/main.py -> dashboard_v2/frontend/dist
_FRONTEND_DIST = Path(__file__).resolve().parents[2] / "frontend" / "dist"


@asynccontextmanager
async def lifespan(app: FastAPI):
    load_dotenv()  # .env → os.environ first, so CTRLB_CONFIG/CTRLB_DB are seen below
    app.state.settings = load_settings()
    app.state.fleet = FleetService(app.state.settings)
    app.state.services = ServiceService(app.state.settings, app.state.fleet)
    app.state.db = Database()
    await app.state.db.connect()

    # Action stack: one EventBus (live SSE) + EventService (persist) feed every invocation; the
    # ActionService runs the registry built from services/actions (import side effects register).
    app.state.event_bus = EventBus()
    app.state.events = EventService(app.state.db, app.state.event_bus)
    deps = Deps(
        settings=app.state.settings,
        fleet=app.state.fleet,
        events=app.state.events,
        services=app.state.services,
    )
    app.state.actions = ActionService(build_registry(), deps)

    try:
        yield
    finally:
        await app.state.db.close()


def create_app() -> FastAPI:
    app = FastAPI(title="ctrl-b dashboard", version=__version__, lifespan=lifespan)

    app.include_router(health.router, prefix="/api")
    app.include_router(hosts.router, prefix="/api")
    app.include_router(services.router, prefix="/api")
    app.include_router(actions.router, prefix="/api")
    app.include_router(events.router, prefix="/api")

    # Prod single-origin serving. Absent in dev (Vite owns the SPA + proxies /api here).
    if _FRONTEND_DIST.is_dir():
        app.mount(
            "/assets",
            StaticFiles(directory=_FRONTEND_DIST / "assets"),
            name="assets",
        )

        @app.get("/{full_path:path}")
        async def spa_fallback(full_path: str) -> FileResponse:  # noqa: ARG001
            return FileResponse(_FRONTEND_DIST / "index.html")

    return app


app = create_app()
