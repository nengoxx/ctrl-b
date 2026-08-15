"""The prompt registry API (Phase 18 / D56, §6 C-23) — one read-only endpoint listing every
model-facing prompt ctrl-b ships, with its default, the owner's customization, and the effective
text that customization produces.

Read-only by design: writes go through the ordinary `PUT /api/settings` (`prompts:` is a normal
config section with a one-depth replace/delete hook, §7 L-4), so there is exactly one write path
into `config.yaml` and this router owns none of it.

Scope: the REGISTRY class only. The main system prompt keeps its own richer three-level chain and
its own endpoint (`GET /api/agent/default-prompt`, untouched) — a duplicate read-only row here would
invite the owner to edit the one that isn't wired (C-23).
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Request

from app.config import Settings
from app.services.agent.prompts import REGISTRY, effective_template, label, placeholders

router = APIRouter(tags=["prompts"])


@router.get("/prompts")
async def list_prompts(request: Request) -> dict[str, Any]:
    """Every registered prompt, in REGISTRY order (which is the Conf editor's list order).

    Per row: `default_text` (what ships), `override`/`append` (what the owner set, `None` when
    unset), `current` (the EFFECTIVE template the model gets — unrendered, so the editor shows the
    same `{{placeholders}}` the owner may edit rather than one turn's data), `is_customized`, and the
    `placeholders` DERIVED from the default (§2.3 — the editor lists them beside the text so an
    omission is a visible choice rather than a warning to plumb, L-7).

    `warnings` names ids present in `config.yaml` that the registry does not know — a typo or a
    renamed prompt. They are PRESERVED on disk (never silently dropped) but are not rows: nothing
    reads them, so the owner has to be told rather than shown an editor for a prompt that does not
    exist (C-18)."""
    settings: Settings = request.app.state.settings
    rows: list[dict[str, Any]] = []
    for prompt_id, definition in REGISTRY.items():
        entry = settings.prompts.get(prompt_id)
        override = (entry.override or None) if entry else None
        append = (entry.append or None) if entry else None
        rows.append(
            {
                "id": prompt_id,
                "label": label(prompt_id),
                "description": definition.description,
                "default_text": definition.default,
                "override": override,
                "append": append,
                "current": effective_template(prompt_id, settings),
                "is_customized": bool(override or append),
                "placeholders": placeholders(definition.default),
            }
        )
    unknown = [name for name in settings.prompts if name not in REGISTRY]
    warnings = (
        [f"config.yaml has prompts the registry doesn't know (kept, never read): {', '.join(unknown)}"]
        if unknown
        else []
    )
    return {"prompts": rows, "warnings": warnings}
