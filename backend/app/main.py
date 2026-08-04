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
import contextlib
import logging
import sys
from collections import OrderedDict
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles

from app import __version__
from app.adapters.inference import EndpointGates
from app.adapters.mcp_client import McpClient
from app.adapters.openapi_tools import OpenApiToolProvider
from app.api import (
    access as access_api,
)
from app.api import (
    actions,
    agent,
    automations,
    events,
    health,
    hosts,
    integrations,
    services,
)
from app.api import (
    media as media_api,
)
from app.api import (
    settings as settings_api,
)
from app.api import (
    tools as tools_api,
)
from app.api import (
    voice as voice_api,
)
from app.api.media import MediaFiles
from app.config import (
    ConfigValidationError,
    home_path,
    load_dotenv,
    load_settings,
    loggable,
    validation_detail,
)
from app.core.events import EventBus
from app.core.media import (
    MEDIA_FILES_SEGMENT,
    MEDIA_NAMESPACES,
    MEDIA_URL_ROOT,
    ensure_media_dirs,
    ns_dir,
)
from app.db import Database
from app.runtime import (
    apply_tool_overrides,
    resolve_generation,
    set_embeddings,
    set_inference,
    set_open_terminal,
    set_searxng,
    set_voice,
)
from app.services.action_service import ActionService
from app.services.actions import build_registry
from app.services.actions.terminal import register_openterminal
from app.services.agent.compaction import CompactionState
from app.services.agent.memory import FileMemoryProvider, migrate_legacy_specialist_memory
from app.services.agent.memory_backup import GitMemoryBackup
from app.services.agent.routing import RoutingState
from app.services.agent.selector import KeywordAgentSelector
from app.services.agent.skills import FileSkillProvider, KeywordSkillSelector
from app.services.agent.steering import SteerQueue
from app.services.agent.turns import (
    TerminalRecord,
    TurnHandle,
    cancel_turn,
    reconcile_stale_calls,
)
from app.services.automations import AutomationRepo, AutomationRunner, AutomationService
from app.services.conversation import MessageRepo, ThreadRepo
from app.services.deps import Deps
from app.services.events import EventService
from app.services.fleet import FleetService
from app.services.monitor import MonitorService
from app.services.svc import ServiceService

# backend/app/main.py -> repo-root/frontend/dist
_FRONTEND_DIST = Path(__file__).resolve().parents[2] / "frontend" / "dist"

logger = logging.getLogger(__name__)


async def _memory_sweep(backup: GitMemoryBackup, settings) -> None:
    """Periodic reconcile sweep (D26 #4): commit the owner's manual/external edits to memory files.
    Interval is read live (a Conf change applies; 0 → idle-check so a re-enable is picked up). Best-
    effort — a failure is logged and the loop continues."""
    while True:
        interval = settings.memory.git_backup.reconcile_interval_s
        await asyncio.sleep(interval if interval > 0 else 60)
        if settings.memory.git_backup.reconcile_interval_s <= 0:
            continue
        try:
            await backup.reconcile()
        except Exception:  # noqa: BLE001 — sweep must never die
            logger.exception("memory reconcile sweep failed")


@asynccontextmanager
async def lifespan(app: FastAPI):
    load_dotenv()  # .env → os.environ first, so CTRLB_CONFIG/CTRLB_DB are seen below
    app.state.settings = load_settings()
    # The config is already the shape this build understands: `_preflight_config()` refused at import
    # otherwise (UPDATE_PLAN §3.7). There is no fold here and no lazy write-back — that machinery left
    # `config.py` in slice 2, and this comment used to describe it.
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
    # A11/D48: the app-owned per-endpoint request-gate registry (created ONCE) + the ONE resolved
    # provider registry generation feeding inference + voice + embeddings (same construction as
    # `reconfigure`, so boot and hot-apply can't drift). Gates must exist before any `set_*` below.
    app.state.endpoint_gates = EndpointGates()
    boot_registry = resolve_generation(app, app.state.settings)
    set_embeddings(app, boot_registry)
    # Voice (Phase 6): STT/TTS proxy with failover. App-state only (not consumed by the agent loop);
    # the /api/voice endpoints read it per request, so a Conf edit hot-applies via `reconfigure`.
    set_voice(app, boot_registry)
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
    # next agent turn (or the manual endpoint) re-discovers under `discovery_lock`. The busy-truth for
    # the "rebuild only between turns" gate is the turn-marker registry below (`app.state.turns`), so
    # the registry is only ever rebuilt between turns, never under a live loop.
    app.state.discovery_lock = asyncio.Lock()
    app.state.integrations_dirty = False
    # Per-thread turn-marker registry (ACA Slice 2, D38; Slice 3/D39 extends TurnHandle in place with
    # the server-owned drain task + replay ring) — the single busy-truth for the chat stack: every
    # thread-mutating endpoint reserves the thread's marker while its turn runs, so concurrent posts
    # 409 and the rediscovery gates read it. The old write-only `active_turns` int is DELETED (D38
    # amendment / D39): the registry supersedes it — dead state mimicking a live signal is the trap
    # D38 exists to kill. See app/services/agent/turns.py.
    turns: dict[str, TurnHandle] = {}  # annotated via a local — Starlette's State attrs are Any
    app.state.turns = turns
    # Terminal cache (D39/S3-B): finished turns move HERE (not lingered in `turns`, which stays
    # live-only so every busy-read stays honest). A small capped, linger-swept map read by the
    # re-attach/status endpoints so a client that missed the terminal sentinel learns the outcome.
    turn_terminals: OrderedDict[str, TerminalRecord] = OrderedDict()
    app.state.turn_terminals = turn_terminals
    # Per-thread steer queues (ACA Slice 5, D41): mid-turn messages / `!exec` submitted while a
    # chat/resume turn owns the thread queue HERE (202) instead of 409. Thread-id-keyed on app.state
    # (the turn_terminals precedent) — it must outlive the live-only TurnHandle. NOT busy-state: every
    # `not app.state.turns` read stays honest. See app/services/agent/steering.py.
    steer_queues: dict[str, SteerQueue] = {}
    app.state.steer_queues = steer_queues
    # D41 FIX 4: replayable Stop-harvest receipts (the turn_terminals linger pattern). A cancel harvests
    # the steer queue destructively; this short-lived, linger-swept map lets a Stop whose response was
    # lost (socket drop) retry and recover the SAME harvested entries. Cleared on linger expiry (swept on
    # read) or when a new turn starts on the thread. See app/api/agent.py `_record_or_replay_harvest`.
    steer_harvests: dict[str, dict] = {}
    app.state.steer_harvests = steer_harvests
    # Per-thread compaction thrash-machine state (D42 Wave 3): the consecutive-failure counter +
    # latching breaker + one-notice guard, thread-id-keyed like the steer queues so it outlives any one
    # turn (the session is rebuilt per turn). NOT busy-state. Restart resets it. See
    # app/services/agent/compaction.py `CompactionState` / `compaction_state_for`.
    compaction_state: dict[str, CompactionState] = {}
    app.state.compaction_state = compaction_state
    # Per-thread failure-fallback routing state (D43/A4): the consecutive-failure counter + the live
    # fallback episode (`fallback_remaining`) + the logical-turn route lock, thread-id-keyed like the
    # compaction state so an episode outlives any one turn (the session is rebuilt per turn). NOT
    # busy-state. Restart resets it. See app/services/agent/routing.py `RoutingState` /
    # `routing_state_for`; pruned back to nothing on a healthy turn's done-callback.
    routing_state: dict[str, RoutingState] = {}
    app.state.routing_state = routing_state
    # D41 Drain B guard: set True at the top of the lifespan finally so a turn completing DURING
    # shutdown can't spawn a drain-B turn past the drain snapshot into a closing DB. Initialized here
    # so `_maybe_spawn_drain_b`'s `getattr(state, "shutting_down", False)` reads a real value.
    app.state.shutting_down = False
    # Stash the Deps bundle so the runtime reconfigure seam (PUT /api/settings) can re-point its
    # adapter handles (e.g. deps.inference) on a config change. Single source: see app/runtime.py.
    app.state.deps = deps

    # Chat stack (Phase 4a): one OpenAI-compatible client + the thread/message repos. The
    # AgentSession is built per turn in the API from these (stateless across turns). Inference is
    # built via the shared `set_inference` helper (the same one `reconfigure` calls) from the SAME
    # boot registry that fed voice/embeddings above, so the three can't drift and share the ONE
    # `app.state.endpoint_gates` (D42 Codex FIX 1: the cap is never split across generations).
    set_inference(app, boot_registry)
    app.state.threads = ThreadRepo(app.state.db)
    app.state.messages = MessageRepo(app.state.db)
    # Skills (Phase 4.5): file-discovered SKILL.md bundles + the default selection strategy. Built
    # once; the provider re-scans the dir per call so a dropped-in skill is live without a restart.
    app.state.skills = FileSkillProvider(app.state.settings.skills_dir_path())
    app.state.skill_selector = KeywordSkillSelector(
        min_overlap=app.state.settings.agent.skill_min_overlap,
        max_skills=app.state.settings.agent.skill_max_active,
    )
    # Agent auto-router (Phase 7e-g, D15 #8): picks a specialist per turn when no /agent is pinned
    # and agent.auto_rotate is on. Same swappable-protocol shape as the skill selector.
    app.state.agent_selector = KeywordAgentSelector()
    # File-based agent memory (Phase 7e-d): per-agent MEMORY.md + global USER.md, read each turn.
    # Stateless — paths/caps resolve from live Settings per call, so edits land with no restart.
    # D26: all memory lives under the memory dir, auto-versioned by a local git repo. One backup
    # instance → its lock serializes every mutation (incl. subagents sharing this provider).
    migrate_legacy_specialist_memory(app.state.settings)  # one-time relocate (≈no-op); before any commit
    app.state.memory_backup = GitMemoryBackup(app.state.settings)
    app.state.memory = FileMemoryProvider(app.state.settings, backup=app.state.memory_backup)

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

    # D26: capture edits made while the app was down (also lazily inits the repo + imports existing
    # memory on first run), then start the periodic sweep for edits made while running.
    await app.state.memory_backup.reconcile()
    app.state.memory_sweep_task = asyncio.create_task(
        _memory_sweep(app.state.memory_backup, app.state.settings)
    )

    # Crash recovery (A11/D39): a previous run that died mid-turn leaves tool calls persisted
    # PENDING/RUNNING with no result — permanent spinners on the next load (opencode #19023) that
    # would also re-run misleadingly on resume. Flip them to CANCELLED now, before serving; at boot
    # there is never a live turn, so the full cross-thread scan is safe. Best-effort: a DB hiccup
    # here must never abort startup, so swallow + log any failure rather than fail the lifespan.
    try:
        n_stale = await reconcile_stale_calls(app.state.messages)
        if n_stale > 0:
            logger.info("reconciled %d stale calls from a previous run", n_stale)
    except Exception:
        logger.exception("startup stale-call reconcile failed — continuing")

    # Scheduled automations (A3/D49). The repo + service are wired first (the API and the agent tools
    # read them off app.state), then the boot ORPHAN SWEEP, and only THEN the poll loop — the ordering is
    # load-bearing (§D-2): a `running` row left by a dead process must be resolved to `interrupted` before
    # anything can claim a new run, or the automation reads as permanently busy. Both sweeps (stale calls
    # above, orphan runs here) are best-effort for the same reason: a DB hiccup must not abort startup.
    app.state.automations = AutomationRepo(app.state.db)
    app.state.automation_service = AutomationService(
        app.state.automations,
        app.state.settings,
        app.state.threads,
        app.state.events,
        # The turn-marker registry (D38): the service takes a thread's marker before deleting it, so
        # retention and the delete cascade can never remove a thread a live turn still owns.
        turns,
    )
    # The agent's `create_automation`/`list_automations` builtins reach the service through `Deps` (a
    # tool's only handle on the world is its InvocationContext) — back-filled here, like the other
    # agent-runtime handles above, because `Deps` is built long before this stack exists.
    deps.automations = app.state.automation_service
    try:
        await app.state.automation_service.sweep_orphans()
    except Exception:
        logger.exception("startup automation orphan sweep failed — continuing")
    app.state.automation_runner = AutomationRunner(app, app.state.automation_service)
    # Started unconditionally: the loop re-reads `automations.enabled` every iteration, so the master
    # switch is live from Conf instead of needing a restart (an off switch just idles the poll).
    app.state.automation_task = asyncio.create_task(app.state.automation_runner.loop())

    # The fleet monitor (D2-A/D50). Started here because it needs fleet + events + actions already
    # built (15b's presence wake goes through the SAME `ActionService.invoke` chokepoint as the Wake
    # button), and unconditionally for the same reason as the automation loop above: the loop re-reads
    # `monitor.enabled` every iteration, so the master switch is live from Conf instead of needing a
    # restart (off just idles the tick and clears its counters).
    app.state.monitor = MonitorService(
        app, app.state.settings, app.state.fleet, app.state.events, app.state.actions
    )
    app.state.monitor_task = asyncio.create_task(app.state.monitor.loop())

    try:
        yield
    finally:
        # D41: mark shutdown BEFORE snapshotting live turns — a turn that completes naturally during
        # this drain must NOT spawn a drain-B turn past the snapshot into a DB we are about to close
        # (`_maybe_spawn_drain_b` checks this flag). Must be the first statement of the finally.
        app.state.shutting_down = True
        # Durable-turn drain (D39) — FIRST, before any adapter/DB close: a detached turn task's
        # shielded CancelledError `finally` still writes to `app.state.db`, so the DB must be open
        # when we cancel + await it. Route every cancel through `cancel_turn` (the single-cancel
        # discipline — a raw double cancel would pierce the persistence shield). Bounded by
        # `shutdown_grace_s` so detached turns can't block emma's systemd restart indefinitely.
        turns_cfg = app.state.settings.agent.turns
        live = [h for h in app.state.turns.values() if h.task is not None and not h.task.done()]
        for h in live:
            cancel_turn(h)
        drain_tasks = [h.task for h in live if h.task is not None]
        if drain_tasks:
            _, pending = await asyncio.wait(drain_tasks, timeout=turns_cfg.shutdown_grace_s)
            for h in live:
                if h.task in pending:
                    logger.warning(
                        "turn %s did not drain within %.1fs", h.turn_id, turns_cfg.shutdown_grace_s
                    )
        # A3/D49: the automation loop is cancelled AFTER the turn drain above and BEFORE the idle sweeps
        # and any adapter/DB close. Both halves matter: an automation run's turn IS one of the handles
        # drained above (kind `automation` lives in the same registry), and the runner's shielded
        # finalizer still has to write the run's terminal status — which needs `app.state.db` open. The
        # `shutting_down` flag set at the top of this block already stops it starting anything new.
        app.state.automation_task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await app.state.automation_task
        # …and the one execution that does NOT live on that task: a detached run-now (14c). Its
        # shielded finalizer still has a terminal status to write, so it is drained here — after the
        # turn drain that cancelled its turn, and still well before the DB closes below.
        await app.state.automation_runner.shutdown(turns_cfg.shutdown_grace_s)
        # D50 L2: cancelled AND awaited before the DB closes — a tick caught mid-sweep may still be
        # writing a host-transition Event through `app.state.db`. It holds nothing else (no claim, no
        # durable row), so a plain cancel is the whole shutdown protocol.
        app.state.monitor_task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await app.state.monitor_task
        app.state.memory_sweep_task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await app.state.memory_sweep_task
        await app.state.searxng.aclose()
        await app.state.open_terminal.aclose()
        await app.state.openapi.aclose()
        await app.state.embeddings.aclose()
        await app.state.voice.aclose()
        await app.state.db.close()


def _quoted(path: str) -> str:
    """Quote a path for a shell only when it contains a space — the remedy we print must be pasteable."""
    return f'"{path}"' if " " in path else path


def _preflight_config() -> None:
    """Refuse to start on a config this build cannot load — at **import time**, before `create_app()`.

    Placement is measured, not stylistic (UPDATE_PLAN §3.7): `sys.exit(78)` here propagates as **78**,
    while the same call inside the FastAPI lifespan is swallowed by uvicorn's `except BaseException` and
    becomes **3**. The unit pairs this with `RestartPreventExitStatus=78`, so an unmigratable config
    stops the service with one actionable message instead of crash-looping at `RestartSec=5` forever
    (measured 2026-07-27: 5 restarts in 8s without the directive, `NRestarts=0` with it — and a
    `--reload` worker propagates 78 at START-UP too — though a MID-SESSION reload re-import does not
    reach systemd at all; see §14).

    It checks two different things, and the second is not implied by the first: that no migration step
    applies (the shape), and that `load_settings()` actually succeeds (the values, env overlay
    included). A stamped config with an invalid value would otherwise die in the lifespan as exit 3,
    which `RestartPreventExitStatus=78` does not cover.

    **Why it must run FIRST**, before `load_settings`: since slice 2 nothing in the load path knows the
    legacy shape, and sections are `extra="allow"` — so a legacy config validates *silently* into zero
    providers and the app boots "healthy" with chat and voice dead. This is the check that makes that
    impossible.

    **Retired env overrides are LOGGED, never fatal** (§13.1): refusals live at the attended gates
    (`--check`/`--apply`, and slice 5's `install.sh`), because an unauthenticated provider fails
    visibly at call time while a refusing unit takes down the only UI there is to diagnose it from.

    **The stop-line, stated so it is not merely currently true** (Fable): this gate **decides, and
    never constructs or repairs**. No writes, no auto-apply, no caching of settings for the app to
    reuse — the lifespan loads independently, and the moment something here starts *fixing* what it
    finds, the responsibility has stopped being coherent.

    There is deliberately **no skip flag**. An escape hatch for a boot-blocking safety check is exactly
    the kind of environment variable that silently does something, which is what slice 3 spent itself
    removing; the remedy is always the one command the message prints.
    """
    try:
        # Imported HERE, not at module scope, so a damaged install is a message rather than a traceback:
        # `CONFIG_VERSION` is read from a file at import, so a corrupt `VERSION` raises `ValueError`
        # before any handler exists — exit 1, i.e. the crash-loop this whole slice exists to prevent.
        from app import config_migration as cm
    except Exception as exc:  # noqa: BLE001 — a broken package import is a broken deployment
        print(
            f"config preflight: the migration package failed to import ({type(exc).__name__}) — this "
            "build is damaged; re-run install.sh or roll back to the previous tag",
            file=sys.stderr,
        )
        raise SystemExit(78) from None

    try:
        load_dotenv()  # `.env` → os.environ first: CTRLB_CONFIG/CTRLB_HOME steer everything below
        status = cm.detect(cm.context_from_env())  # the cheap read-only verdict — no writes, no probe
        for var, path in cm.retired_env_overrides():
            logger.error(
                "%s targets `%s`, a config path this build retired — it supplies NOTHING. If it carried "
                "a credential, that role is running without it; move the value into config.yaml and "
                "unset the variable. (Set in the service's own environment? `systemctl --user show "
                "<unit> -p Environment`.)",
                loggable(var),
                path,
            )
        if status.needs_migration:
            print(
                f"config migration required: {loggable(str(status.config_path))}\n"
                f"  legacy key(s): {', '.join(status.legacy_keys) or 'in an agent file'}\n"
                # Quoted when it needs to be: on `C:\Users\Jane Doe\ctrl-b` an unquoted interpreter path
                # splits at the space when pasted, so the "exact command" would not be one.
                f"  → {_quoted(loggable(sys.executable))} -m app.config_migration --apply",
                file=sys.stderr,
            )
            raise SystemExit(cm.EXIT_REFUSE)
        # Proving it MIGRATES is not proving it LOADS. `detect()` reads the marker and asks each step
        # whether it applies; it never validates. A stamped config with `port: not-a-number` — or a live
        # `CTRLB_SERVER__PORT=not-a-number`, which only the service's own environment has — sails past
        # it and dies in the lifespan instead, where uvicorn turns the failure into **exit 3**: not
        # covered by `RestartPreventExitStatus=78`, so the unit crash-loops (measured). Loading through
        # the real `load_settings` is the only check with the effective semantics, env overlay included.
        load_settings()
    except SystemExit:
        raise
    except cm.MigrationRefused as exc:  # downgrade · unparseable · symlink · anchors · broken agent.yaml
        raise SystemExit(cm.report_refusal(exc)) from None
    except ConfigValidationError as exc:  # already sanitised: locations, never values
        print(f"config preflight: {exc}", file=sys.stderr)
        raise SystemExit(cm.EXIT_REFUSE) from None
    except OSError as exc:  # a vanished mount, a revoked permission — a retry may clear it
        print(
            f"config preflight: {exc.strerror or type(exc).__name__}: {loggable(str(exc.filename))}",
            file=sys.stderr,
        )
        raise SystemExit(cm.EXIT_FAIL) from None
    except Exception as exc:  # noqa: BLE001 — same structural answer as the runner's `_call_step`
        # A bootstrap variable can raise things no handler above anticipates (`CTRLB_HOME=~nosuchuser`
        # → `RuntimeError`). Naming only the TYPE keeps a message that quotes config out of the journal,
        # and 78 is right because no restart repairs an environment variable.
        print(
            f"config preflight: {type(exc).__name__} while resolving the config location — details "
            "withheld, they may quote your environment. Check CTRLB_HOME / CTRLB_CONFIG / CTRLB_ENV.",
            file=sys.stderr,
        )
        raise SystemExit(cm.EXIT_REFUSE) from None


def create_app() -> FastAPI:
    app = FastAPI(title="ctrl-b dashboard", version=__version__, lifespan=lifespan)

    @app.exception_handler(RequestValidationError)
    async def _validation_handler(_request: Request, exc: RequestValidationError) -> JSONResponse:
        """FastAPI's OWN 422s, rendered through the same sanitiser as our explicit ones.

        Routing the six explicit `except ValidationError` sites through `validation_detail` closed the
        leak we knew about and left the bigger door open: a body that fails validation BEFORE the
        handler runs never reaches those sites, and FastAPI's default renderer includes `input`.
        Verified both ways — a secret field failing its own rule echoes the secret
        (`ssh_password` too long → `input: "pw-…"`), and a whole-body shape failure echoes the ENTIRE
        body, secrets and all (`PUT` a list where an object was expected). Found by Codex after it
        judged the drift guard's class claim overstated; it was right.

        `.errors()` on a `RequestValidationError` has the same shape as pydantic's, so the same
        renderer applies. The status stays 422 and the envelope stays `{"detail": [...]}`, so nothing
        downstream changes — only the fields inside each entry.
        """
        return JSONResponse(status_code=422, content={"detail": validation_detail(exc)})

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
    app.include_router(automations.router, prefix="/api")
    app.include_router(media_api.router, prefix="/api")

    # Owner media (D52/G5, GACHA_PLAN §10.4): the namespace-generic read-only library over
    # `$CTRLB_HOME/media/<ns>/`. Three orderings are load-bearing here:
    #   ① the dirs are ENSURED first — `StaticFiles(check_dir=True)` RAISES at construction on a
    #     missing directory, so a fresh install would fail to build the app at all;
    #   ② the mounts come after the INDEX route (`/api/media/{ns}`) but their paths carry an extra
    #     `/files` segment, so the two can never shadow each other;
    #   ③ everything here is registered BEFORE the SPA fallback below, and OUTSIDE its prod-only
    #     branch — the Vite dev proxy forwards `/api` here, so this one placement serves both profiles
    #     with no vite.config change.
    # One `MediaFiles` per namespace: the mount is a static prefix, so the `{ns}` of the index route
    # is a registry walk here. Adding the next art-bearing theme is a row in `MEDIA_NAMESPACES`.
    home = home_path()
    # DEGRADE, NEVER BRICK (W2): a namespace whose tree is not servable is skipped, loudly, instead of
    # raising. This code runs AFTER the exit-78 config preflight, so an exception here would surface as
    # an ordinary uvicorn failure — which `Restart=on-failure` retries every 5s. An art folder with the
    # wrong shape must not be able to crash-loop the control panel.
    app.state.media_health = ensure_media_dirs(home)
    for ns, roles in MEDIA_NAMESPACES.items():
        # `ns_health`, not `health` — that name is the health ROUTER module, imported above.
        ns_health = app.state.media_health[ns]
        if not ns_health.ok:
            logger.error("media namespace %r is DISABLED — %s", ns, ns_health.reason)
            continue
        app.mount(
            f"{MEDIA_URL_ROOT}/{ns}/{MEDIA_FILES_SEGMENT}",
            # The namespace's ROLES are passed in, not inferred from what is on disk: the mount then
            # serves exactly what the index advertises, and a folder the owner parked beside the role
            # dirs is invisible rather than quietly public (Codex F1).
            MediaFiles(directory=ns_dir(home, ns), roles=roles),
            name=f"media-{ns}",
        )

    # Prod single-origin serving. Absent in dev (Vite owns the SPA + proxies /api here).
    if _FRONTEND_DIST.is_dir():
        app.mount(
            "/assets",
            StaticFiles(directory=_FRONTEND_DIST / "assets"),
            name="assets",
        )

        @app.get("/{full_path:path}")
        async def spa_fallback(full_path: str) -> Response:
            # An unmatched `/api/...` (or `/api` itself) is a mistyped/removed endpoint, not an SPA
            # route — return a JSON 404 rather than serving index.html with a 200, which would mask
            # the client bug behind an HTML body. Real API routes are registered under the `/api`
            # prefix above and never reach here.
            if full_path == "api" or full_path.startswith("api/"):
                return JSONResponse(status_code=404, content={"detail": "Not Found"})
            return FileResponse(_FRONTEND_DIST / "index.html")

    return app


_preflight_config()  # ← before the app object exists; see the docstring
app = create_app()
