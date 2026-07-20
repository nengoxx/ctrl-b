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

from fastapi import APIRouter, HTTPException, Request
from pydantic import ValidationError

from app.config import Settings, mask_secrets
from app.runtime import apply_settings_patch, settings_write_lock

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
async def get_settings(request: Request) -> dict[str, Any]:
    """The full config, secrets masked (`api_key`/`password`/… → `ab…yz`)."""
    settings: Settings = request.app.state.settings
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


@router.put("/settings")
async def put_settings(patch: dict[str, Any], request: Request) -> dict[str, Any]:
    """Apply a partial settings patch. Deep-merges onto the current config, preserves unchanged
    secrets, validates (→ 422 on bad values), persists atomically, and hot-applies."""
    if not isinstance(patch, dict):
        raise HTTPException(status_code=422, detail="settings patch must be a JSON object")

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
        old: Settings = request.app.state.settings.model_copy()
        # `apply_settings_patch` (runtime) is the shared merge→validate→persist→hot-apply core (secret
        # carry-over + minimal-write pruning + `reconfigure`); the D44 grant path reuses it too.
        try:
            new = await apply_settings_patch(request.app, patch)
        except ValidationError as exc:
            raise HTTPException(status_code=422, detail=exc.errors()) from exc
        restart_required = _restart_paths(old, new)

    return {
        "settings": mask_secrets(new.model_dump(mode="json")),
        "restart_required": restart_required,
    }
