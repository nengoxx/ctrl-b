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

Under the A11/D48 registry-generation model, `reconfigure` resolves ONE immutable provider
`Registry` generation per apply (`resolve_generation`) and hands it to every `set_*` here —
`set_inference`/`set_voice`/`set_embeddings` rebuild from the SAME generation, while the scalar
integrations (`set_searxng`/`set_open_terminal`) and `rediscover_integrations` swap their own clients
through the same helpers. Lifespan walks the identical construction sites, so the boot and hot-apply can
never drift into a parallel reload path.
"""

from __future__ import annotations

import asyncio
import logging
from typing import TYPE_CHECKING, Any

from pydantic import ValidationError

from app.adapters.embeddings import EmbeddingsClient
from app.adapters.inference import InferenceClient
from app.adapters.openterminal import OpenTerminalClient
from app.adapters.searxng import SearxngClient
from app.adapters.voice import VoiceClient
from app.config import (
    ApprovalRule,
    Settings,
    deep_merge,
    deep_set,
    delete_path,
    edit_config_yaml,
    prune_unchanged,
    sync_mapping,
    unmask_secrets,
    walk_model_refs,
)
from app.core.permissions import exact_arg_pins
from app.core.provider_registry import (
    EndpointGates,
    ProviderResolveError,
    provider_skill_collision_warnings,
    resolve_lenient,
    resolve_strict,
)
from app.core.tool import UnknownTool

if TYPE_CHECKING:
    from fastapi import FastAPI

    from app.core.provider_registry import Registry

logger = logging.getLogger(__name__)


def resolve_generation(app: "FastAPI", settings: Settings) -> "Registry":
    """Resolve ONE immutable provider registry generation for a settings apply (A11/D48 R5). The single
    resolution site — `reconfigure` calls it ONCE per apply and hands the result to every `set_*` below,
    so inference + voice + embeddings rebuild from the SAME generation (no per-section re-resolve). Boot
    (main.py) calls it the same way. Memoizes the app-owned `EndpointGates` (created once on
    `app.state.endpoint_gates`) so a rebuild keeps the SAME `(gate_identity, limit)` semaphores — the cap
    is never split across generations (C4). Resolves LENIENTLY (boot policy: warn + drop/promote) and logs
    the lenient warnings (missing provider / gate conflict / dim mismatch / self-hosted default api_mode)."""
    gates = getattr(app.state, "endpoint_gates", None)
    if gates is None:
        gates = EndpointGates()
        app.state.endpoint_gates = gates
    registry, warnings = resolve_lenient(settings)
    for w in warnings:
        logger.warning("provider config: %s", w)
    return registry


def set_inference(app: "FastAPI", registry: "Registry") -> InferenceClient | None:
    """Build + wire the inference client from a RESOLVED `Registry` generation (A11). The single
    construction site for inference, called by both lifespan and `reconfigure`. Builds the client from the
    registry + the app-owned `EndpointGates`, PUBLISHES it (setattr on `app.state.inference` + the deps
    mirror), and RETURNS the previous client so the async caller can `retire()` it (R6 drain: publish new,
    then drain old — in-flight turns finish on their captured generation)."""
    gates = app.state.endpoint_gates
    old = getattr(app.state, "inference", None)
    new_client = InferenceClient(registry, gates=gates)
    app.state.inference = new_client
    deps = getattr(app.state, "deps", None)
    if deps is not None:
        deps.inference = new_client
    return old if isinstance(old, InferenceClient) else None


def clear_reasoning_demotions(app: "FastAPI") -> None:
    """Clear the inference client's learned reasoning demotions (D46/F6) through the runtime chokepoint,
    so the API layer never reaches into the client directly. Called by the agent-file mutation handlers
    (PUT/DELETE agent): an agent's reasoning edit must be RETRIED, not stay stripped, and — unlike an
    inference-section edit — it does NOT rebuild the client. A no-op before the client is wired (i.e.
    before lifespan's first `set_inference`)."""
    client = getattr(app.state, "inference", None)
    if client is not None:
        client.clear_reasoning_demotions()


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


async def set_open_terminal(app: "FastAPI", settings: Settings) -> None:
    await _swap_client(app, "open_terminal", OpenTerminalClient(settings.open_terminal))


def set_voice(app: "FastAPI", registry: "Registry") -> VoiceClient | None:
    """Build + wire the voice client from a RESOLVED `Registry` generation (A11/R5). Consumes the
    stt/tts chains + frozen policies + the app-owned `EndpointGates`; publishes onto `app.state.voice`
    (voice isn't consumed by the agent loop, so no deps mirror). Returns the previous client so the caller
    can `retire()` it (publish new, then drain old — in-flight STT/TTS finishes on its captured
    generation). `enabled` rides live settings, frozen into the client per generation."""
    old = getattr(app.state, "voice", None)
    new_client = VoiceClient(
        registry.stt_chain,
        registry.stt_policy,
        registry.tts_chain,
        registry.tts_policy,
        app.state.endpoint_gates,
        enabled=app.state.settings.voice.enabled,
    )
    app.state.voice = new_client
    return old if isinstance(old, VoiceClient) else None


def set_embeddings(app: "FastAPI", registry: "Registry") -> EmbeddingsClient | None:
    """Build + wire the embeddings client from a RESOLVED `Registry` generation (A11/R5). Consumes the
    embeddings chain + policy + the app-owned `EndpointGates`; `enabled` is passed in from live settings
    (frozen per generation, R11). Publishes onto `app.state.embeddings` + the deps mirror (Phase-7 memory
    reads `deps.embeddings`). Returns the previous client for `retire()`."""
    old = getattr(app.state, "embeddings", None)
    new_client = EmbeddingsClient(
        registry.embeddings_chain,
        registry.embeddings_policy,
        app.state.endpoint_gates,
        enabled=app.state.settings.embeddings.enabled,
    )
    app.state.embeddings = new_client
    deps = getattr(app.state, "deps", None)
    if deps is not None:
        deps.embeddings = new_client
    return old if isinstance(old, EmbeddingsClient) else None


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
    `rediscover_integrations` (so freshly re-discovered MCP/OpenAPI tools pick overrides up too).

    A spec carrying `describe` (D57 §4b-5) has its BASE description computed from the settings this
    call was handed, replacing the captured literal — so a tool whose capability boundary moves with a
    feature switch is reworded by the same pass, for both the model schema and `GET /api/actions`, the
    moment the switch flips. The captured original stays the compile-time literal (it is `spec_dto`'s
    default-mode source, and a `describe` that ever disappears must restore what the code declares);
    the owner's `tool_overrides` description still wins over both."""
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
        if spec.describe is not None:
            base_desc = spec.describe(settings)
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
    # R5/R7: a `providers` change rebuilds inference + voice + embeddings TOGETHER (they all resolve
    # against the same registry); a section-only edit rebuilds just that section (but still re-resolves,
    # since its policies now come from the registry). The ONE resolve below covers both.
    providers_changed = _changed(old, new, "providers")
    inference_changed = _changed(old, new, "inference") or providers_changed
    embeddings_changed = _changed(old, new, "embeddings") or providers_changed
    voice_changed = _changed(old, new, "voice") or providers_changed
    searxng_changed = _changed(old, new, "searxng")
    open_terminal_changed = _changed(old, new, "open_terminal")
    tool_overrides_changed = _changed(old, new, "tool_overrides")
    agent_changed = _changed(old, new, "agent")
    caches_stale = _changed(old, new, "server") or _changed(old, new, "computers")

    apply_settings_inplace(app, new)
    # R5: resolve the registry ONCE per apply, build ALL new clients, publish, THEN drain the old ones
    # (in-flight turns/streams/voice ops finish on their captured generation).
    if inference_changed or voice_changed or embeddings_changed:
        registry = resolve_generation(app, new)
        retired: list[Any] = []
        if inference_changed:
            retired.append(set_inference(app, registry))
        if voice_changed:
            retired.append(set_voice(app, registry))
        if embeddings_changed:
            retired.append(set_embeddings(app, registry))
        for old_client in retired:
            if old_client is not None:
                await old_client.retire()
    if agent_changed and not inference_changed:
        # `agent.defaults` can carry reasoning settings (D15 #1 / D42 ModelRef rider); a settings-PUT
        # edit there does NOT rebuild the INFERENCE client, so learned demotions clear explicitly — the
        # same D46/F6 blanket-on-mutation rule the file-per-agent handlers follow. Gated on
        # `not inference_changed`: a rebuild already minted an empty set (a voice/embeddings-only rebuild
        # leaves the inference client — and its demotions — untouched, so the clear must still run).
        clear_reasoning_demotions(app)
    if searxng_changed:
        await set_searxng(app, new)
    if open_terminal_changed:
        await set_open_terminal(app, new)
    actions = getattr(app.state, "actions", None)
    # The overlay is a pure function of (`tool_overrides`, live settings): a spec carrying `describe`
    # (D57 §4b-5) reads the settings half, so ANY saved section can move its base description. Re-run
    # for that case rather than enumerating which sections a `describe` may read — the pass is one loop
    # over the registry writing attributes, and it is idempotent.
    if actions is not None and (
        tool_overrides_changed or any(t.spec.describe is not None for t in actions.registry.all())
    ):
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


#: The config-held provider-name reference homes NOT covered by `walk_model_refs` — the flat
#: section primaries + fallbacks: `inference`, `voice.stt`, `voice.tts`, `embeddings` (D48 C1 cascade
#: list, extended to voice/embeddings in Slice 2).
def _cascade_provider_renames(merged: dict[str, Any], renames: dict[str, str]) -> None:
    """(3) of the C1 rename transaction: rewrite every config-held provider REFERENCE still equal to an
    old name in the FINAL MERGED doc to its new name. The closed home list = the flat section
    primaries/fallbacks (inference + voice.stt + voice.tts + embeddings) + every `ModelRef` home
    (`walk_model_refs`). A ref the UI already rewrote in its draft is a no-op (the backend ordering is
    authoritative — C1). Only the `provider` field is renamed; a `model` clean name is provider-relative
    and never carried across providers."""
    if not renames:
        return

    def _rw(ref: dict[str, Any]) -> None:
        if ref.get("provider") in renames:
            ref["provider"] = renames[ref["provider"]]

    # Flat section homes: inference, voice.stt, voice.tts, embeddings (primary + each fallback ref).
    sections: list[dict[str, Any]] = []
    inf = merged.get("inference")
    if isinstance(inf, dict):
        sections.append(inf)
    voice = merged.get("voice")
    if isinstance(voice, dict):
        for svc in ("stt", "tts"):
            sub = voice.get(svc)
            if isinstance(sub, dict):
                sections.append(sub)
    emb = merged.get("embeddings")
    if isinstance(emb, dict):
        sections.append(emb)
    for sect in sections:
        _rw(sect)  # primary `provider`
        for fb in sect.get("fallbacks") or []:
            if isinstance(fb, dict):
                _rw(fb)

    walk_model_refs(merged, _rw)


def provider_rename_error(
    renames: dict[str, str], stored_names: "set[str]", *, providers_in_patch: bool
) -> str | None:
    """Validate `provider_renames` as a SIMPLE BIJECTIVE map (D48 C1) — returns a precise error string
    (→ 422 in the handler) or None. Rules: every old exists; each new does not already exist as a
    provider (except a no-op `new == old`); no duplicate destinations; no chains/swaps/cycles (a
    destination that is itself a renamed source). A rename is meaningless without the full providers map
    (the rekey/replacement need it), so a rename without `providers` in the patch is rejected too."""
    if not renames:
        return None
    if not providers_in_patch:
        return "provider_renames requires the full 'providers' map in the same PUT"
    news = list(renames.values())
    if len(set(news)) != len(news):
        return "provider_renames has duplicate destination names"
    for old, new in renames.items():
        if old not in stored_names:
            return f"provider_renames: source provider {old!r} does not exist"
        if new == old:
            continue
        if new in stored_names:
            return f"provider_renames: destination {new!r} already exists"
        if new in renames:  # new is itself a renamed source ⇒ a chain/swap/cycle
            return f"provider_renames: {old!r}->{new!r} forms a chain/swap (not simple bijective)"
    return None


def _skill_names(app: "FastAPI") -> list[str]:
    """Live skill names for the provider-name-shadowed-by-skill collision warning (recomputed per PUT /
    per GET, never frozen — C7/R9). Empty when the skills subsystem is absent."""
    provider = getattr(app.state, "skills", None)
    return [s.name for s in provider.list()] if provider is not None else []


async def apply_settings_patch(
    app: "FastAPI", patch: dict[str, Any], *, renames: dict[str, str] | None = None
) -> tuple[Settings, list[str]]:
    """The atomic merge→validate→persist→hot-apply core shared by `PUT /api/settings` and the D44 grant
    path. MUST be called while holding `settings_write_lock`. Applies the C1 rename transaction (in exact
    order), deep-merges the rest of `patch` onto the live config with `providers` REPLACEMENT semantics,
    restores unchanged/renamed secrets, strict-resolves (raises `ProviderResolveError` — the caller maps
    it to 422), persists comment/format-preserving, and hot-applies via `reconfigure`. Returns
    `(new_settings, warnings)` where warnings are the strict non-fatal notices + the live skill-collision
    set (C9 envelope). Factored so the two write paths share ONE sequence rather than copy-pasting it."""
    renames = renames or {}
    current: Settings = app.state.settings
    current_raw = current.model_dump(mode="json")  # real (unmasked) secrets
    stored_providers = current_raw.get("providers") or {}
    patch_providers = patch.get("providers") if isinstance(patch.get("providers"), dict) else None
    # Phase 18 / L-4: `prompts` is REPLACED like `providers` and for the same reason — the UI submits
    # the complete map and a deep-merge can only add, so a deletion (restore-by-delete) would never
    # land. The API layer already resolved the patch's transport sentinels into that complete map.
    patch_prompts = patch.get("prompts") if isinstance(patch.get("prompts"), dict) else None
    rest_patch = {k: v for k, v in patch.items() if k not in ("providers", "prompts")}

    # (1) Rekey the STORED providers view so an unmask restores each renamed provider's secret by its OLD
    # structural identity: the new name inherits the old entry's stored secret (masks are not injective —
    # identity, not the masked string, drives restore; D48 C1). A THIRD provider is untouched, so its own
    # incoming secret round-trips against its own stored entry.
    #
    # The rename MOVES the identity — the old name is dropped first, and only then are the new names
    # bound. Copying was a credential-crossing bug (A11 pre-release FE audit, HIGH, canary-confirmed):
    # rename `openrouter`→`cloud` and create a FRESH `openrouter` pointing at a different host in the same
    # save, and the fresh entry — carrying no key of its own — inherited the old provider's real secret
    # and would have sent it to that host. Delete-then-recreate under one name had the same shape.
    # Dropped in a SEPARATE phase rather than `pop`ped inside the loop: `pop` is only safe while
    # `provider_rename_error` keeps rejecting chains/swaps/cycles upstream, and this function should not
    # silently depend on a rule enforced two layers away. The two-phase form is correct either way.
    rekeyed_stored = {name: cfg for name, cfg in stored_providers.items() if name not in renames}
    for old, new in renames.items():
        if old in stored_providers:
            rekeyed_stored[new] = stored_providers[old]
    stored_for_unmask = {**current_raw, "providers": rekeyed_stored}

    # (2) Apply the providers REPLACEMENT (the UI submits the complete map — never deep_merge, so deletes +
    # renames survive) + deep_merge the rest, then unmask against the rekeyed stored view. A real
    # (non-masked, non-blank) incoming secret WINS over restoration (via `_is_unchanged_secret`).
    merged = deep_merge(current_raw, rest_patch)
    if patch_providers is not None:
        merged["providers"] = patch_providers
    if patch_prompts is not None:
        merged["prompts"] = patch_prompts
    merged = unmask_secrets(merged, stored_for_unmask)

    # (3) Cascade every config-held ref STILL equal to an old name in the FINAL MERGED doc (authoritative
    # over the UI's own draft rewrite). (4) A third provider's explicit incoming change is already in the
    # replacement map, untouched by the rekey/cascade.
    _cascade_provider_renames(merged, renames)

    new = Settings.model_validate(merged)
    # R26 + FX7 (audit M2) + R7: strict-resolve ENFORCEMENT (422) applies only when the patch touches a
    # RESOLUTION-RELEVANT subtree (`providers` / `inference` / `agent` / `voice` / `embeddings` — every
    # home the registry now reads). A patch that touches none of them (appearance sync from the phone,
    # server, memory, …) must NOT be bricked by a PRE-EXISTING lenient-tolerated conflict (a min-wins gate
    # clash, a duplicate target, a blank-primary-with-fallbacks, a voice/embeddings dim mismatch) sitting
    # in a hand-edited config — those saves resolve LENIENTLY and surface the same notices as warnings
    # instead of blocking. The resolution-relevant subtrees stay strict-always so a provider/model/gate/
    # chain problem they introduce is a typed 422.
    touches_resolution = any(k in patch for k in ("providers", "inference", "agent", "voice", "embeddings"))
    if touches_resolution:
        resolved = resolve_strict(new)
        if isinstance(resolved, list):
            raise ProviderResolveError(resolved)
        reg_warnings = list(resolved.warnings)
    else:
        _reg, reg_warnings = resolve_lenient(new)
    warnings = reg_warnings + provider_skill_collision_warnings(new.providers.keys(), _skill_names(app))

    # Persist only the changed leaves, comment/format-preserving. `providers` writes via `sync_mapping`
    # (replacement — deletes/renames survive); the non-providers subtrees write via `deep_set`. When a
    # rename cascaded, the affected section homes (inference/voice/embeddings/agent — the closed cascade
    # list, C1/R8) are re-derived from the FINAL merged doc so a cascade the caller's patch did NOT carry
    # still lands on disk. The A11 migration write-back + backup ride the SAME single atomic edit at the
    # chokepoint (config._PENDING_MIGRATION).
    to_write = prune_unchanged(unmask_secrets(rest_patch, current_raw), current_raw)
    if renames:
        for sect in ("inference", "voice", "embeddings", "agent"):
            delta = prune_unchanged(merged.get(sect, {}), current_raw.get(sect))
            if delta:
                to_write[sect] = delta
            else:
                to_write.pop(sect, None)
    providers_write = merged.get("providers") if patch_providers is not None else None
    prompts_write = merged.get("prompts") if patch_prompts is not None else None

    def _replace_map(doc: Any, key: str, target: dict[str, Any]) -> None:
        """Replacement semantics on the YAML side for a map the UI submits whole: add/replace + DELETE
        the keys the submission dropped."""
        node = doc.get(key)
        if not hasattr(node, "get"):
            doc[key] = {}
            node = doc[key]
        sync_mapping(node, target)

    def _mutate(doc: Any) -> None:
        deep_set(doc, to_write)
        if providers_write is not None:
            _replace_map(doc, "providers", providers_write)
        if prompts_write:
            _replace_map(doc, "prompts", prompts_write)
        elif prompts_write is not None:
            # Restoring the LAST customized prompt empties the map: drop the key instead of leaving
            # `prompts: {}` behind. The owner reads and hand-edits this file (§2.2) — litter is noise.
            delete_path(doc, ["prompts"])

    edit_config_yaml(_mutate)
    await reconfigure(app, new)
    return new, warnings


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
