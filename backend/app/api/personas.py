"""Owner-persona library writes (D78 / ROLEPLAY_PLAN §14.4 A-3).

`roleplay.personas` is a user-named map, and `deep_merge`'s own rule sends a map section through a
dedicated endpoint rather than the generic settings merge — a deep-merge can add a key but never
remove one, so a deleted persona would come straight back. This router is `api/hosts.py`'s write
path for that map: the comment/format-preserving writer (`edit_config_yaml`), then the runtime
`reconfigure` seam, under `settings_write_lock`. READS stay on the settings document
(`GET /api/settings` carries the library); `roleplay.default_persona` is a scalar and rides the
ordinary settings PUT.

The slug is minted ONCE, here, by the one mint for author-chosen text (`card_import.mint_slug` —
personas are its third caller, Emma A-2) and never changes: a rename edits `name` only, so every
`AgentDef.persona` link survives it (R90 §3.1). A delete does NOT cascade — a link to a removed
persona dangles by design and resolves to the default (Emma A-4).
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, ValidationError

from app.config import PersonaCfg, edit_config_yaml, load_settings, validation_detail
from app.runtime import reconfigure, settings_write_lock
from app.services.agent.card_import import mint_slug

router = APIRouter(tags=["roleplay"])


class PersonaIn(BaseModel):
    name: str
    description: str = ""


def _check_basics(body: PersonaIn) -> None:
    if not body.name.strip():
        raise HTTPException(status_code=422, detail="persona name is required")


def _persona_entry(body: PersonaIn) -> dict[str, Any]:
    """Minimal YAML entry (the hosts `_host_entry` style: omit-when-empty), also the validation
    candidate."""
    e: dict[str, Any] = {"name": body.name.strip()}
    if body.description.strip():
        e["description"] = body.description
    return e


def _validate(entry: dict[str, Any]) -> None:
    """Type-check a candidate entry (→ 422). Uniqueness lives in the caller."""
    try:
        PersonaCfg.model_validate(entry)
    except ValidationError as exc:
        raise HTTPException(status_code=422, detail=validation_detail(exc)) from None


def _personas(doc: Any) -> Any:
    """The `roleplay.personas` node, created when the file has no `roleplay` section or no library
    yet (a fresh config has neither)."""
    rp = doc.get("roleplay")
    if not hasattr(rp, "get"):
        doc["roleplay"] = {}
        rp = doc["roleplay"]
    lib = rp.get("personas")
    if not hasattr(lib, "get"):
        rp["personas"] = {}
        lib = rp["personas"]
    return lib


async def _persist_and_reload(request: Request, mutate: Any) -> None:
    """MUST be called holding `settings_write_lock` (the callers hold it across their
    read-modify-write) — `api/hosts.py`'s helper, for the same reason."""
    edit_config_yaml(mutate)
    await reconfigure(request.app, load_settings())


def _persona_dto(request: Request, slug: str) -> dict[str, Any]:
    """The DTO for one persona after a write (reloaded config)."""
    persona = request.app.state.settings.roleplay.personas.get(slug)
    if persona is None:  # shouldn't happen post-write, but stay honest
        raise HTTPException(status_code=404, detail=f"unknown persona '{slug}'")
    return {"slug": slug, "name": persona.name, "description": persona.description}


@router.post("/personas", status_code=201)
async def create_persona(body: PersonaIn, request: Request) -> dict[str, Any]:
    """Add a persona — the server mints its slug from the name (409 if that slug is already taken,
    the hosts rule: two names that collapse to one slug are refused, never overwritten)."""
    _check_basics(body)
    async with settings_write_lock:
        library = request.app.state.settings.roleplay.personas
        slug = mint_slug(body.name, (), fallback="persona", collection="personas")
        if slug in library:
            raise HTTPException(
                status_code=409, detail=f"a persona named like '{body.name.strip()}' already exists"
            )
        entry = _persona_entry(body)
        _validate(entry)
        await _persist_and_reload(request, lambda doc: _personas(doc).__setitem__(slug, entry))
    return _persona_dto(request, slug)


@router.put("/personas/{slug}")
async def update_persona(slug: str, body: PersonaIn, request: Request) -> dict[str, Any]:
    """Edit a persona's name/description. The slug never changes (D78) — the whole point of minting
    it once — and any field the form does not manage (a later `avatar`) is left on the node."""
    _check_basics(body)
    async with settings_write_lock:
        if slug not in request.app.state.settings.roleplay.personas:
            raise HTTPException(status_code=404, detail=f"unknown persona '{slug}'")
        entry = _persona_entry(body)
        _validate(entry)

        def mutate(doc: Any) -> None:
            node = _personas(doc)[slug]
            if node.get("name") != entry["name"]:
                node["name"] = entry["name"]
            if "description" in entry:
                if node.get("description") != entry["description"]:
                    node["description"] = entry["description"]
            elif "description" in node:
                del node["description"]

        await _persist_and_reload(request, mutate)
    return _persona_dto(request, slug)


@router.delete("/personas/{slug}", status_code=204)
async def delete_persona(slug: str, request: Request) -> None:
    """Remove a persona. No cascade: an agent linked to it (or a `default_persona` naming it) keeps
    the slug and falls through to the next rung until the owner clears or re-points it."""
    async with settings_write_lock:
        if slug not in request.app.state.settings.roleplay.personas:
            raise HTTPException(status_code=404, detail=f"unknown persona '{slug}'")

        def mutate(doc: Any) -> None:
            lib = _personas(doc)
            if slug in lib:
                del lib[slug]

        await _persist_and_reload(request, mutate)
