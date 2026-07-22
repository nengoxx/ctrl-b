"""Settings read/write API (Phase 7a).

`config.yaml` is the single UI-managed source of truth (DECISIONS §config-secrets). `GET` returns
the whole config with secrets masked; `PUT` takes a **partial** patch (the form only sends the
groups it edits), deep-merges it onto the current config, restores any unchanged secrets from disk
(so a masked value echoed back never overwrites the real one — audit A2), validates, persists, and
hot-applies via the runtime reconfigure seam.

Thin by design (AGENTS conventions): validate + delegate to `config.py` helpers + `runtime`.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import ValidationError

from app.config import Settings, mask_secrets, providers_rev
from app.core.provider_registry import ProviderResolveError
from app.runtime import apply_settings_patch, provider_rename_error, settings_write_lock

router = APIRouter(tags=["settings"])

#: Top-level config paths that can't be applied to the running process — persisted but flagged so
#: the UI can say "restart to apply". host/port can't rebind the live uvicorn socket; debug is
#: fixed at app construction (FastAPI(debug=…)).
_RESTART_REQUIRED = ("server.host", "server.port", "server.debug")


def _restart_paths(old: Settings, new: Settings) -> list[str]:
    """Which `_RESTART_REQUIRED` paths actually changed in this save (so the UI only nags when a
    restart-only field was edited)."""
    changed: list[str] = []
    for path in _RESTART_REQUIRED:
        section, _, key = path.partition(".")
        if getattr(getattr(old, section), key) != getattr(getattr(new, section), key):
            changed.append(path)
    return changed


@router.get("/settings")
async def get_settings(request: Request, response: Response) -> dict[str, Any]:
    """The full config, secrets masked (`api_key`/`password`/… → `ab…yz`).

    A11/D48 FR2-1: carries the providers fingerprint in the `X-Providers-Rev` response header, computed
    from the SAME settings object being serialized. The Conf draft binds its concurrency base to THIS
    header (the exact snapshot it seeds from) rather than the independently-fetched `GET /api/providers`
    rev — so a skew between the two reads can never send a stale base. The doc body stays naked (C9)."""
    settings: Settings = request.app.state.settings
    response.headers["X-Providers-Rev"] = providers_rev(settings)
    return mask_secrets(settings.model_dump(mode="json"))


@router.get("/appearance")
async def get_appearance(request: Request) -> dict[str, Any]:
    """The active appearance selection only (Phase 11 / D28 §9.11, extended M3 §14.3):
    `{theme, mode, accent, motion, perf, theme_settings, updated_at}` (the M3 fields null until seeded).

    A lightweight always-on read — the `ui` store reconciles against it on mount (the full
    `GET /api/settings` is Conf-tab-scoped on the client, so it can't drive first-paint/reconcile).
    No secrets in this block → no masking needed."""
    settings: Settings = request.app.state.settings
    return settings.appearance.model_dump(mode="json")


def _pop_provider_metadata(patch: dict[str, Any]) -> tuple[dict[str, str], str | None]:
    """Strip the two A11/D48 PUT TRANSPORT fields from the raw patch BEFORE it reaches the merge — they
    are request metadata, never config that lands in `Settings`/YAML (C1). `provider_renames`
    (`{old: new}`) drives the rename transaction; `providers_base` is the concurrency fingerprint the
    `providers`-replacement 409 checks against. Both are validated for shape here (→ 422)."""
    renames_raw = patch.pop("provider_renames", None)
    providers_base = patch.pop("providers_base", None)
    if renames_raw is None:
        renames: dict[str, str] = {}
    elif isinstance(renames_raw, dict) and all(
        isinstance(k, str) and isinstance(v, str) for k, v in renames_raw.items()
    ):
        renames = renames_raw
    else:
        raise HTTPException(
            status_code=422, detail="provider_renames must be an object of {old: new} strings"
        )
    if providers_base is not None and not isinstance(providers_base, str):
        raise HTTPException(status_code=422, detail="providers_base must be a string")
    return renames, providers_base


@router.put("/settings")
async def put_settings(patch: dict[str, Any], request: Request) -> dict[str, Any]:
    """Apply a partial settings patch. Deep-merges onto the current config, preserves unchanged
    secrets, applies the A11 provider rename transaction, validates + strict-resolves (→ 422 / 409),
    persists atomically, and hot-applies. The response envelope carries `warnings` (non-fatal notices)
    and `providers_rev` (the post-write providers fingerprint) alongside `restart_required`."""
    if not isinstance(patch, dict):
        raise HTTPException(status_code=422, detail="settings patch must be a JSON object")

    # A11/D48 C1: pop the PUT transport metadata (rename map + providers base fingerprint) before anything
    # else, so neither can flow into the merge / `Settings` (extra=allow would otherwise retain them).
    renames, providers_base = _pop_provider_metadata(patch)

    # SYS-3 / ACA-17: a `tool_overrides` patch reaches `apply_tool_overrides`, which mutates the LIVE
    # registered `ToolSpec` objects (description/agent_exposed/core) — mutating the registry under an
    # agent loop that may be iterating it. D38/S2-B: the turn-marker registry is the single busy-truth
    # (same gate + same 409 shape as `POST /api/integrations/rediscover`). Scoped deliberately:
    #   * ONLY when the patch carries `tool_overrides` — appearance/inference/voice/memory writes touch
    #     no registry state, and appearance sync is frequent + cross-device, so a blanket 409 would be a
    #     real UX regression. Key PRESENCE is the trigger (checked on the raw patch, before the write
    #     lock — cheap, no merge needed); refusing a no-op tool_overrides patch mid-turn is accepted as
    #     simpler and safer than diffing old-vs-new.
    #   * The gate lives HERE, in the API handler — NOT in `apply_settings_patch`/`reconfigure`/the lock.
    #     The D44 "always allow" grant path (`runtime.grant_approval`, Slice 8 W2) calls
    #     `apply_settings_patch` with a `tool_overrides` patch DURING a live turn, by design, from the
    #     resume path; it does not go through this handler, so it stays exempt. Do NOT hoist this check
    #     down into the shared core — that would break the approval grant.
    if "tool_overrides" in patch and request.app.state.turns:
        raise HTTPException(status_code=409, detail="agent is busy — try again in a moment")

    # Appearance writes are server-stamped LWW (§9.11): stamp `updated_at` on the server's own clock so
    # cross-device order is unambiguous (no client clocks). Stamp the PATCH (not just the live object) so
    # the timestamp flows through the merge AND the YAML persistence — it survives a restart.
    if isinstance(patch.get("appearance"), dict):
        patch = {
            **patch,
            "appearance": {**patch["appearance"], "updated_at": datetime.now(timezone.utc).isoformat()},
        }

    async with settings_write_lock:
        # Snapshot the OLD settings before applying: `apply_settings_patch`→`reconfigure` mutates
        # `app.state.settings` IN PLACE (rebinds its top-level fields), so a live reference would read
        # as already-updated. A shallow copy keeps the pre-update nested objects for the diff.
        current: Settings = request.app.state.settings
        old: Settings = current.model_copy()
        # A11/D48 C2/R8 — providers-base 409, computed under the lock BEFORE any mutation/backup: a
        # `providers`-carrying PUT whose base fingerprint is absent or stale means another client changed
        # the map since this draft loaded; a full-map replacement must not silently delete their addition.
        if "providers" in patch and providers_base != providers_rev(current):
            raise HTTPException(
                status_code=409,
                detail="providers changed elsewhere — refresh and re-apply",
            )
        # A11/D48 C1 — validate the rename map (simple bijective) against the CURRENT providers, → 422.
        rename_err = provider_rename_error(
            renames, set(current.providers.keys()), providers_in_patch="providers" in patch
        )
        if rename_err is not None:
            raise HTTPException(status_code=422, detail=rename_err)
        # `apply_settings_patch` (runtime) is the shared merge→validate→persist→hot-apply core (secret
        # carry-over + minimal-write pruning + `reconfigure`); the D44 grant path reuses it too.
        try:
            new, warnings = await apply_settings_patch(request.app, patch, renames=renames)
        except ValidationError as exc:
            # `include_context=False` drops the raw `ValueError`/`ctx` objects a custom field_validator
            # (e.g. the A11 provider-name guard) puts in the error — they are not JSON-serializable, so a
            # bare `exc.errors()` would 500 while trying to render the 422. `include_url=False` trims noise.
            raise HTTPException(
                status_code=422, detail=exc.errors(include_url=False, include_context=False)
            ) from exc
        except ProviderResolveError as exc:
            # A11/D48 C2/R26: strict provider resolution failed → the typed 422 envelope (structured
            # error list in `detail`, so the Conf UI can render per-path notices).
            raise HTTPException(
                status_code=422, detail=[{"path": e.path, "message": e.message} for e in exc.errors]
            ) from exc
        restart_required = _restart_paths(old, new)
        providers_rev_out = providers_rev(new)

    return {
        "settings": mask_secrets(new.model_dump(mode="json")),
        "restart_required": restart_required,
        "warnings": warnings,
        "providers_rev": providers_rev_out,
    }
