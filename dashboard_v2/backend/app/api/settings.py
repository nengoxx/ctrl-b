"""Settings read/write API (Phase 7a).

`config.yaml` is the single UI-managed source of truth (DECISIONS §config-secrets). `GET` returns
the whole config with secrets masked; `PUT` takes a **partial** patch (the form only sends the
groups it edits), deep-merges it onto the current config, restores any unchanged secrets from disk
(so a masked value echoed back never overwrites the real one — audit A2), validates, persists, and
hot-applies via the runtime reconfigure seam.

Thin by design (AGENTS conventions): validate + delegate to `config.py` helpers + `runtime`.
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from pydantic import ValidationError

from app.config import (
    Settings,
    apply_patch_to_yaml,
    deep_merge,
    mask_secrets,
    prune_unchanged,
    unmask_secrets,
)
from app.runtime import reconfigure

router = APIRouter(tags=["settings"])

#: Top-level config paths that can't be applied to the running process — persisted but flagged so
#: the UI can say "restart to apply". host/port can't rebind the live uvicorn socket; debug is
#: fixed at app construction (FastAPI(debug=…)).
_RESTART_REQUIRED = ("server.host", "server.port", "server.debug")

#: Serialize PUTs: the read-modify-write (merge onto current config) isn't atomic, so two racing
#: saves could interleave and lose one's changes.
_write_lock = asyncio.Lock()


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
    """The active appearance selection only (Phase 11 / D28 §9.11): `{theme, mode, accent, updated_at}`.

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

    async with _write_lock:
        current: Settings = request.app.state.settings
        current_raw = current.model_dump(mode="json")  # real (unmasked) secrets
        merged = deep_merge(current_raw, patch)
        # Restore secrets the form echoed back masked/blank — never overwrite a real credential.
        merged = unmask_secrets(merged, current_raw)
        try:
            new = Settings.model_validate(merged)
        except ValidationError as exc:
            raise HTTPException(status_code=422, detail=exc.errors()) from exc

        restart_required = _restart_paths(current, new)
        # Persist only what actually changed, comment/format-preserving (audit C1): unmask the patch
        # against real secrets, drop unchanged leaves, then edit the file in place. A masked secret
        # echoed back unchanged prunes away → its original line (text + quoting) is left untouched.
        to_write = prune_unchanged(unmask_secrets(patch, current_raw), current_raw)
        apply_patch_to_yaml(to_write)
        await reconfigure(request.app, new)

    return {
        "settings": mask_secrets(new.model_dump(mode="json")),
        "restart_required": restart_required,
    }
