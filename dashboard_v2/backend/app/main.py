"""App factory + ASGI entrypoint.

Dev: Vite proxies `/api` → uvicorn (single origin, no CORS). Prod (Phase 9): this also serves
the built `frontend/dist` via StaticFiles + SPA fallback. Phase 0 only wires lifespan (db +
settings) and the `/api/health` checkpoint.

Run:  uvicorn app.main:app --port 5433   (from backend/)

On Linux/macOS you can add `--reload` for dev. On **Windows do NOT use `--reload`** — uvicorn's
reload worker on Windows runs under an event loop that does not properly support
`asyncio.create_subprocess_exec`, so `fleet.ping_host` silently captures empty output and every
host reports offline. Run plain (no `--reload`) on Windows, or use `watchfiles` externally to
restart the process.
"""

from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app import __version__
from app.adapters.mcp_client import McpClient
from app.adapters.openapi_tools import OpenApiToolProvider
from app.api import (
    access as access_api,
    actions,
    agent,
    events,
    health,
    hosts,
    integrations,
    services,
    settings as settings_api,
    tools as tools_api,
    voice as voice_api,
)
from app.config import load_dotenv, load_settings
from app.runtime import (
    apply_tool_overrides,
    set_embeddings,
    set_inference,
    set_open_terminal,
    set_searxng,
    set_voice,
)
from app.core.events import EventBus
from app.db import Database
from app.services.action_service import ActionService
from app.services.actions import build_registry
from app.services.actions.terminal import register_openterminal
from app.services.agent.memory import FileMemoryProvider
from app.services.agent.selector import KeywordAgentSelector
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
    # Integration clients (Phase 4f): one cached httpx client each, closed at shutdown below. Built
    # via the runtime `set_*` helpers (single source shared with `reconfigure`, so a Conf edit
    # rebuilds them the same way — Phase 7c-a). `deps` isn't built yet, so these set app.state.* only.
    await set_searxng(app, app.state.settings)
    await set_open_terminal(app, app.state.settings)
    await set_embeddings(app, app.state.settings)
    # Voice (Phase 6): STT/TTS proxy with failover. App-state only (not consumed by the agent loop);
    # the /api/voice endpoints read it per request, so a Conf edit hot-applies via `reconfigure`.
    await set_voice(app, app.state.settings)
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
    # Overlay any per-tool overrides (description + tri-state agent_mode) onto the freshly registered
    # specs (Phase 8b, D22). Done after every provider has registered (built-ins → terminal → MCP →
    # OpenAPI) so the originals captured here are the true built-in/remote (description, exposed, core).
    apply_tool_overrides(app)
    # Integration re-discovery state (Phase 7c-b): MCP/OpenAPI edits flip `integrations_dirty`; the
    # next agent turn (or the manual endpoint) re-discovers under `discovery_lock`. `active_turns`
    # lets the manual rediscover refuse (409) while a turn is iterating, so the registry is only ever
    # rebuilt between turns, never under a live loop.
    app.state.discovery_lock = asyncio.Lock()
    app.state.integrations_dirty = False
    app.state.active_turns = 0
    # Stash the Deps bundle so the runtime reconfigure seam (PUT /api/settings) can re-point its
    # adapter handles (e.g. deps.inference) on a config change. Single source: see app/runtime.py.
    app.state.deps = deps

    # Chat stack (Phase 4a): one OpenAI-compatible client + the thread/message repos. The
    # AgentSession is built per turn in the API from these (stateless across turns). Inference is
    # built via the shared `set_inference` helper (the same one `reconfigure` calls) so the two
    # paths can't drift (audit B1).
    set_inference(app, app.state.settings)
    app.state.threads = ThreadRepo(app.state.db)
    app.state.messages = MessageRepo(app.state.db)
    # Skills (Phase 4.5): file-discovered SKILL.md bundles + the default selection strategy. Built
    # once; the provider re-scans the dir per call so a dropped-in skill is live without a restart.
    app.state.skills = FileSkillProvider(app.state.settings.skills_dir_path())
    app.state.skill_selector = KeywordSkillSelector()
    # Agent auto-router (Phase 7e-g, D15 #8): picks a specialist per turn when no /agent is pinned
    # and agent.auto_rotate is on. Same swappable-protocol shape as the skill selector.
    app.state.agent_selector = KeywordAgentSelector()
    # File-based agent memory (Phase 7e-d): per-agent MEMORY.md + global USER.md, read each turn.
    # Stateless — paths/caps resolve from live Settings per call, so edits land with no restart.
    app.state.memory = FileMemoryProvider(app.state.settings)

    # Subagents (Phase 4.5): back-fill the agent-runtime handles onto the shared Deps so the
    # spawn_subagents tool can build + run child sessions (the ActionService reference is set here
    # to dodge the deps↔action_service import cycle). One process-wide concurrency cap (tree-wide).
    deps.threads = app.state.threads
    deps.messages = app.state.messages
    deps.actions = app.state.actions
    deps.skills = app.state.skills
    deps.selector = app.state.skill_selector
    deps.memory = app.state.memory
    deps.subagent_sem = asyncio.Semaphore(max(1, app.state.settings.agent.global_subagent_limit))

    try:
        yield
    finally:
        await app.state.searxng.aclose()
        await app.state.open_terminal.aclose()
        await app.state.openapi.aclose()
        await app.state.embeddings.aclose()
        await app.state.voice.aclose()
        await app.state.db.close()


def create_app() -> FastAPI:
    app = FastAPI(title="ctrl-b dashboard", version=__version__, lifespan=lifespan)

    app.include_router(health.router, prefix="/api")
    app.include_router(hosts.router, prefix="/api")
    app.include_router(services.router, prefix="/api")
    app.include_router(actions.router, prefix="/api")
    app.include_router(tools_api.router, prefix="/api")
    app.include_router(events.router, prefix="/api")
    app.include_router(agent.router, prefix="/api")
    app.include_router(settings_api.router, prefix="/api")
    app.include_router(integrations.router, prefix="/api")
    app.include_router(voice_api.router, prefix="/api")
    app.include_router(access_api.router, prefix="/api")

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
