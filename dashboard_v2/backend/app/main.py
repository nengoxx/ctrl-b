"""App factory + ASGI entrypoint.

Dev: Vite proxies `/api` → uvicorn (single origin, no CORS). Prod (Phase 9): this also serves
the built `frontend/dist` via StaticFiles + SPA fallback. Phase 0 only wires lifespan (db +
settings) and the `/api/health` checkpoint.

Run:  uvicorn app.main:app --reload --port 5433   (from backend/)
"""

from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app import __version__
from app.adapters.embeddings import EmbeddingsClient
from app.adapters.inference import InferenceClient
from app.adapters.mcp_client import McpClient
from app.adapters.openapi_tools import OpenApiToolProvider
from app.adapters.openterminal import OpenTerminalClient
from app.adapters.searxng import SearxngClient
from app.api import actions, agent, events, health, hosts, services
from app.config import load_dotenv, load_settings
from app.core.events import EventBus
from app.db import Database
from app.services.action_service import ActionService
from app.services.actions import build_registry
from app.services.actions.terminal import register_openterminal
from app.services.agent.skills import FileSkillProvider, KeywordSkillSelector
from app.services.conversation import MessageRepo, ThreadRepo
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
    # Integration clients (Phase 4f): one cached httpx client each, closed at shutdown below.
    app.state.searxng = SearxngClient(app.state.settings.searxng)
    app.state.open_terminal = OpenTerminalClient(app.state.settings.open_terminal)
    app.state.embeddings = EmbeddingsClient(app.state.settings.embeddings)
    deps = Deps(
        settings=app.state.settings,
        fleet=app.state.fleet,
        events=app.state.events,
        services=app.state.services,
        searxng=app.state.searxng,
        open_terminal=app.state.open_terminal,
        embeddings=app.state.embeddings,
    )
    registry = build_registry()
    # open-terminal (Phase 4f): register its curated tools with per-op risk from config (skipped if
    # unconfigured). Done before MCP so a registry dump shows built-ins → terminal → MCP.
    n_term = register_openterminal(registry, app.state.settings.open_terminal)
    # MCP (Phase 4f): discover each configured server's tools at startup and merge them into the
    # shared registry, so the agent sees them alongside built-in actions. Per-server isolated — a
    # down server is logged + skipped (its tools just won't be present this run), never fatal.
    app.state.mcp = McpClient(app.state.settings.mcp_servers)
    app.state.mcp_summary = await app.state.mcp.discover(registry)
    # Generic OpenAPI tool servers (Phase 4f): same merge-into-the-registry pattern as MCP, for
    # plain REST/OpenAPI services (Open WebUI tool servers, etc.). Per-server failure isolation.
    app.state.openapi = OpenApiToolProvider(app.state.settings.openapi_servers)
    app.state.openapi_summary = await app.state.openapi.discover(registry)
    app.state.openterminal_tools = n_term
    app.state.actions = ActionService(registry, deps)

    # Chat stack (Phase 4a): one OpenAI-compatible client + the thread/message repos. The
    # AgentSession is built per turn in the API from these (stateless across turns).
    app.state.inference = InferenceClient(app.state.settings.inference)
    app.state.threads = ThreadRepo(app.state.db)
    app.state.messages = MessageRepo(app.state.db)
    # Skills (Phase 4.5): file-discovered SKILL.md bundles + the default selection strategy. Built
    # once; the provider re-scans the dir per call so a dropped-in skill is live without a restart.
    app.state.skills = FileSkillProvider(app.state.settings.skills_dir_path())
    app.state.skill_selector = KeywordSkillSelector()

    # Subagents (Phase 4.5): back-fill the agent-runtime handles onto the shared Deps so the
    # spawn_subagents tool can build + run child sessions (the ActionService reference is set here
    # to dodge the deps↔action_service import cycle). One process-wide concurrency cap (tree-wide).
    deps.inference = app.state.inference
    deps.threads = app.state.threads
    deps.messages = app.state.messages
    deps.actions = app.state.actions
    deps.skills = app.state.skills
    deps.selector = app.state.skill_selector
    deps.subagent_sem = asyncio.Semaphore(max(1, app.state.settings.agent.global_subagent_limit))

    try:
        yield
    finally:
        await app.state.searxng.aclose()
        await app.state.open_terminal.aclose()
        await app.state.openapi.aclose()
        await app.state.embeddings.aclose()
        await app.state.db.close()


def create_app() -> FastAPI:
    app = FastAPI(title="ctrl-b dashboard", version=__version__, lifespan=lifespan)

    app.include_router(health.router, prefix="/api")
    app.include_router(hosts.router, prefix="/api")
    app.include_router(services.router, prefix="/api")
    app.include_router(actions.router, prefix="/api")
    app.include_router(events.router, prefix="/api")
    app.include_router(agent.router, prefix="/api")

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
