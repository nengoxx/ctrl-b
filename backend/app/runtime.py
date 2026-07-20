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

import asyncio
import logging
from typing import TYPE_CHECKING, Any

from pydantic import ValidationError

from app.adapters.embeddings import EmbeddingsClient
from app.adapters.inference import EndpointGates, InferenceClient, warn_suspect_api_modes
from app.adapters.openterminal import OpenTerminalClient
from app.adapters.searxng import SearxngClient
from app.adapters.voice import VoiceClient
from app.config import (
    ApprovalRule,
    Settings,
    apply_patch_to_yaml,
    deep_merge,
    prune_unchanged,
    unmask_secrets,
)
from app.core.permissions import exact_arg_pins
from app.core.tool import UnknownTool

if TYPE_CHECKING:
    from fastapi import FastAPI

logger = logging.getLogger(__name__)


def set_inference(app: "FastAPI", settings: Settings) -> None:
    """Build + wire the inference client from `settings.inference`. The single construction site for
    inference, called by both lifespan and `reconfigure`. Assigns `app.state.inference` (read per
    turn by `api/agent._session`) and mirrors it onto `app.state.deps.inference` so subagents use the
    same client. Cheap + lazy — the SDK client is only opened on first use.

    D42 Codex FIX 1: the per-endpoint request-gate semaphores live in the app-owned `EndpointGates`
    registry (created once, memoized on `app.state.endpoint_gates`), NOT on the client — so a config
    change that rebuilds the client here keeps the SAME semaphores. Old-generation permit holders and
    the new client's acquirers then contend on ONE object per `(base_url, limit)`, so
    `max_concurrent_requests` is never split across client generations.

    Also the config-load boundary where `warn_suspect_api_modes` flags an endpoint left on the
    default `api_mode: openai` with a self-hosted `base_url` (D45 audit FIX 5) — advisory only,
    it never changes what gets built."""
    warn_suspect_api_modes(settings.inference)
    gates = getattr(app.state, "endpoint_gates", None)
    if gates is None:
        gates = EndpointGates()
        app.state.endpoint_gates = gates
    app.state.inference = InferenceClient(settings.inference, gates=gates)
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


#: agent_mode → (agent_exposed, core) overlay (D22). The inverse of `agent_mode_of`. A `None` mode
#: ("absent") is handled by the caller (restore the captured originals), not here.
_MODE_FIELDS: dict[str, tuple[bool, bool]] = {
    "core": (True, True),
    "enabled": (True, False),
    "disabled": (False, False),
}


def agent_mode_of(agent_exposed: bool, core: bool) -> str:
    """The tri-state `AgentMode` (D22) a tool's `(agent_exposed, core)` pair represents — the inverse
    of the `apply_tool_overrides` overlay. Lets the actions DTO report a tool's compile-time
    `default_agent_mode` so the catalog stores only deviations and can offer a reset to default."""
    if core:
        return "core"
    return "enabled" if agent_exposed else "disabled"


def spec_dto(app: "FastAPI", spec) -> dict:
    """The public tool DTO (`spec_to_dict`) enriched with `default_agent_mode` — the tri-state the
    tool's *compile-time* `(agent_exposed, core)` represents, read from the captured originals
    (`tool_spec_orig`) so a currently-overridden tool still reports its true default. Shared by
    `GET /api/actions` (the catalog) and `GET /api/tools` (the run cards) so both surfaces can render
    the tri-state, mark the default, store only deviations, and reset. Falls back to the live spec if
    the original wasn't captured (only before lifespan's first `apply_tool_overrides`)."""
    from app.core.tool import spec_to_dict

    d = spec_to_dict(spec)
    orig: dict = getattr(app.state, "tool_spec_orig", None) or {}
    base = orig.get(spec.name)
    base_exposed, base_core = base[1:3] if base else (spec.agent_exposed, spec.core)
    d["default_agent_mode"] = agent_mode_of(base_exposed, base_core)
    return d


def apply_tool_overrides(app: "FastAPI", settings: Settings | None = None) -> None:
    """Overlay the per-tool overrides (Phase 8b, D22) onto the **live** registry specs: the
    model-facing `description` (generalizing 7d-a) **and** the tri-state agent-access `agent_mode`.
    The agent loop reads `spec.description`/`agent_exposed`/`core` straight off the registered specs
    (`to_openai_tools`/`for_agent`) and `GET /api/actions` returns them, so mutating the specs in
    place is the single seam that reaches both the model and the UI at once — no registry-logic change.

    Originals of `(description, agent_exposed, core)` are captured once per tool on
    `app.state.tool_spec_orig`, so clearing an override (a `None` field) restores the tool's
    compile-time default rather than leaving the last value stuck. Run by lifespan (after the registry
    is built), by `reconfigure` (when `tool_overrides` changed), and at the end of
    `rediscover_integrations` (so freshly re-discovered MCP/OpenAPI tools pick overrides up too)."""
    settings = settings or app.state.settings
    overrides: dict = getattr(settings, "tool_overrides", None) or {}
    registry = app.state.actions.registry
    orig: dict | None = getattr(app.state, "tool_spec_orig", None)
    if orig is None:
        orig = {}
        app.state.tool_spec_orig = orig
    for tool in registry.all():
        spec = tool.spec
        name = spec.name
        if name not in orig:
            orig[name] = (spec.description, spec.agent_exposed, spec.core)
        base_desc, base_exposed, base_core = orig[name]
        ov = overrides.get(name)
        desc = getattr(ov, "description", None)
        spec.description = desc.strip() if isinstance(desc, str) and desc.strip() else base_desc
        mode = getattr(ov, "agent_mode", None)
        # `mode or ""`: a None/absent override falls to the "" miss → the compile-time default tuple.
        spec.agent_exposed, spec.core = _MODE_FIELDS.get(mode or "", (base_exposed, base_core))


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
        # Drop the captured originals for the remote tools we're about to remove, so the freshly
        # re-discovered specs are re-captured as their *current* defaults (a remote server may have
        # changed a tool's description/risk between discoveries). `apply_tool_overrides` below only
        # captures a name absent from `tool_spec_orig`, so without this a re-added name keeps the
        # stale capture. Built-in/action originals (a different category) are untouched.
        orig: dict = getattr(app.state, "tool_spec_orig", None) or {}
        for t in registry.all():
            if t.spec.category == "mcp":
                orig.pop(t.spec.name, None)
        registry.remove_category("mcp")

        old_openapi = getattr(app.state, "openapi", None)
        if old_openapi is not None and hasattr(old_openapi, "aclose"):
            await old_openapi.aclose()

        app.state.mcp = McpClient(settings.mcp_servers)
        app.state.mcp_summary = await app.state.mcp.discover(registry)
        app.state.openapi = OpenApiToolProvider(settings.openapi_servers)
        app.state.openapi_summary = await app.state.openapi.discover(registry)
        app.state.integrations_dirty = False
    # Re-apply per-tool overrides onto the freshly registered MCP/OpenAPI specs (Phase 8b).
    apply_tool_overrides(app)
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
    tool_overrides_changed = _changed(old, new, "tool_overrides")
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
    if tool_overrides_changed and getattr(app.state, "actions", None) is not None:
        apply_tool_overrides(app, new)
    if caches_stale:
        invalidate_status_caches(app)


#: Serialize every persisted settings write: the read-modify-write (merge onto the live config) isn't
#: atomic, so two racing saves could interleave and lose one's changes — or leave `app.state.settings`
#: stale in memory when one writer's reload lands before another's file write. THE one lock, held by
#: EVERY config writer: `PUT /api/settings`, the D44 approval-grant path (Slice 8 W2), the `hosts`
#: CRUD and the `integrations` CRUD (re-homed here from `api/settings.py`, and the per-router locks
#: those two kept were folded in post-audit — a single lock object, never three; D44 §4/H2). Taken at
#: the OUTERMOST site only: nothing it guards (`apply_settings_patch`, `_persist_and_reload`,
#: `reconfigure`, `apply_settings_inplace`) re-acquires it, so the writers never nest.
settings_write_lock = asyncio.Lock()


async def apply_settings_patch(app: "FastAPI", patch: dict[str, Any]) -> Settings:
    """The atomic merge→validate→persist→hot-apply core shared by `PUT /api/settings` and the D44
    grant path. MUST be called while holding `settings_write_lock`. Deep-merges `patch` onto the live
    config, restores unchanged secrets, validates (raises `ValidationError` — the caller maps it),
    persists comment/format-preserving, and hot-applies via `reconfigure`. Returns the new validated
    `Settings`. Factored so the two write paths share ONE sequence rather than copy-pasting it."""
    current: Settings = app.state.settings
    current_raw = current.model_dump(mode="json")  # real (unmasked) secrets
    merged = unmask_secrets(deep_merge(current_raw, patch), current_raw)
    new = Settings.model_validate(merged)
    # Persist only the changed leaves, comment/format-preserving (a masked secret echoed back prunes
    # away → its original line is untouched). The grant patch carries the FULL replacement approvals
    # list, so `deep_merge`/`_deep_set` replace it wholesale (no list-through-merge — D44 H2).
    to_write = prune_unchanged(unmask_secrets(patch, current_raw), current_raw)
    apply_patch_to_yaml(to_write)
    await reconfigure(app, new)
    return new


#: The W2 counterpart to `action_service._APPROVAL_MARKER` — breadcrumbs appended to the run's summary
#: when a bubble grant could NOT be persisted (defense in depth behind the FE's `always_eligible`).
#: Defined once here, beside the grant that returns them; a successful grant returns None (no note).
_GRANT_INEXPRESSIBLE_NOTE = " [always-allow skipped: non-scalar args can't be pinned]"
_GRANT_WRITE_FAILED_NOTE = " [always-allow not saved: settings write failed]"


async def grant_approval(app: "FastAPI", tool: str, args: dict[str, object]) -> str | None:
    """Persist an args-EXACT 'always allow' rule for this call (D44 W2 grant path) and hot-apply it,
    then return `None` on success or a short breadcrumb note (to append to THIS call's run summary)
    when the grant could not be written. Called by the resume path on `execute_always` BEFORE
    executing; the write NEVER blocks the run — the owner's intent to run is primary, so an
    inexpressible-args skip or a persist failure is logged/noted and the call still executes as a
    human-confirmed run.

    The rule pins EVERY top-level validated field to `glob_escape(canonical_str(value))` (None → the
    `permissions.NONE_CANON` sentinel, pinned unescaped — NOT the plain `"null"`, which a string arg
    could also produce; post-audit MED-2) via `exact_arg_pins`, so it matches THIS exact call and
    nothing else (§7 invariant 5, modulo the documented `int | str` type-blindness). Idempotent: an identical rule already on the tool is a no-op (no duplicate). Reuses
    the ONE settings write lock + apply/patch machinery, mirroring the PUT flow, so the bubble grant is
    atomic (no list-through-deep-merge from a stale FE cache).

    Note: because the grant lands BEFORE the resume executes and `ActionService.invoke` re-consults
    live settings on that execute, the W1 audit marker (`[auto-allowed: …]`) DOES stamp this very run —
    the rule already matches by the time the gate re-runs. Benign: the run is both human-confirmed and
    now approval-covered, and the marker + a failure note are mutually exclusive (a note only returns
    when NO rule was written)."""
    actions = app.state.actions
    settings: Settings = app.state.settings
    try:
        inp = actions.registry.get(tool).spec.input_model.model_validate(args)
    except UnknownTool, ValidationError:
        return _GRANT_INEXPRESSIBLE_NOTE  # args already validated upstream; fail-closed if not
    pins = exact_arg_pins(inp.model_dump(mode="json"))
    if pins is None:
        return _GRANT_INEXPRESSIBLE_NOTE  # a non-scalar field — nothing to persist (behind FE gate)
    new_rule = ApprovalRule(args=pins)
    async with settings_write_lock:
        override = settings.tool_overrides.get(tool)
        existing = list(override.approvals) if override and override.approvals else []
        if any(rule == new_rule for rule in existing):
            return None  # idempotent double-tap — the identical grant already stands
        approvals = [rule.model_dump(mode="json") for rule in existing]
        approvals.append(new_rule.model_dump(mode="json"))
        patch = {"tool_overrides": {tool: {"approvals": approvals}}}
        try:
            await apply_settings_patch(app, patch)
        except Exception:
            logger.exception("approval grant persist failed for tool %r", tool)
            return _GRANT_WRITE_FAILED_NOTE
    return None
