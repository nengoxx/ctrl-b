"""The owner-persona resolver (D78 / ROLEPLAY_PLAN §14.1 A3) — the ONE place that decides which
library persona an agent talks to.

Both consumers read it: `macros_for` (`{{user}}` = the persona's name, else `"User"`) and the
session's persona head block (its description). One resolver so the name the model is told and the
description it is shown can never come from two different personas.

The chain is `agent.persona` → `roleplay.default_persona` → none, each rung taken only when it is
set AND present in the library — the D75 `default_set` rule ("configured AND resolves"). A dangling
slug is a LEGAL state (Emma A-4: a library edit must never brick an agent file), so it falls
through rather than failing; a later `Thread.persona` would slot in as the first rung.
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.config import PersonaCfg, Settings
    from app.domain.agent import AgentDef

log = logging.getLogger(__name__)

#: `(agent, slug)` pairs whose dangling link has already been reported this process — the
#: `lorebooks._MISSING_WARNED` precedent: the resolver runs several times per turn, a dangling link is
#: a tolerated steady state the selectors already present as `missing: <slug>`, and one WARNING per
#: turn forever would bury the journal lines that matter.
_DANGLING_WARNED: set[tuple[str, str]] = set()


def _warn_once_dangling(agent: str, slug: str) -> None:
    if (agent, slug) not in _DANGLING_WARNED:
        _DANGLING_WARNED.add((agent, slug))
        log.warning(
            "agent %r: persona %r is not in roleplay.personas — using the default (not repeated)", agent, slug
        )


def resolve_persona(agent: AgentDef, settings: Settings) -> tuple[str, PersonaCfg] | None:
    """`(slug, persona)` for the persona `agent` talks to, or `None` when neither its own link nor
    the default resolves."""
    library = settings.roleplay.personas
    for slug in (agent.persona, settings.roleplay.default_persona):
        if not slug:
            continue
        persona = library.get(slug)
        if persona is not None:
            return slug, persona
        _warn_once_dangling(agent.name, slug)
    return None
