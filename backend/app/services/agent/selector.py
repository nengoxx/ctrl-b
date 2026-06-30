"""The default keyword agent selector + the chat-endpoint helper (7e-g, D15 #8).

`KeywordAgentSelector` ranks specialists by token overlap of the user message against each agent's
`name + description` (the shared `core.textmatch.rank_by_overlap`), returning the top one only when it
clears `min_overlap` AND strictly beats the runner-up — a below-threshold best or a tie at the top
yields `None` (don't guess between equals; fall through to the default).

`select_agent` is the endpoint glue: load the specialist `AgentDef`s (skipping any that fail to
load), run the selector with the live `agent.auto_rotate_min_overlap` threshold, return the picked
name (or `None` → the configured default). The chat endpoint only calls it when `agent.auto_rotate`
is on and no `/agent`/`thread.agent` is set, so an off switch costs nothing.
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING

from app.core.agents import AgentSelector
from app.core.textmatch import rank_by_overlap
from app.domain.agent import AgentDef

if TYPE_CHECKING:
    from app.config import Settings

log = logging.getLogger(__name__)


class KeywordAgentSelector(AgentSelector):
    """Default selector (D15 #8): pick the specialist whose `name + description` shares the most
    tokens with the user message — but only a *strict* winner clearing `min_overlap`. A
    below-threshold best or a tie at the top returns `None` (fall through to the default).
    Deterministic + model-agnostic; swap in an LLM/embeddings router via the `AgentSelector`
    protocol."""

    def select(
        self, user_msg: str, agents: list[AgentDef], *, min_overlap: int = 2
    ) -> AgentDef | None:
        ranked = rank_by_overlap(
            user_msg, agents, lambda a: f"{a.name} {a.description}", min_overlap=min_overlap
        )
        if not ranked:
            return None
        if len(ranked) > 1 and ranked[0][0] == ranked[1][0]:
            return None  # tie at the top → don't guess between equals
        return ranked[0][1]


def select_agent(
    settings: "Settings", selector: AgentSelector, user_msg: str
) -> str | None:
    """Resolve the auto-routed specialist name for a turn, or `None` → the configured default.

    Loads each specialist `AgentDef` (a malformed one is skipped, never fatal — like a malformed
    skill), runs `selector.select` with the live `agent.auto_rotate_min_overlap` threshold, and
    returns the picked agent's name. Pure read; the endpoint gates the call on `auto_rotate`."""
    specialists: list[AgentDef] = []
    for name in settings.list_agent_names():
        try:
            agent = settings.load_agent(name)
        except Exception as exc:  # malformed agent.yaml (ValidationError/YAMLError) — skip, don't 500
            log.warning("agent %s: unloadable for auto-routing (%s)", name, exc)
            agent = None
        if agent is not None:
            specialists.append(agent)
    if not specialists:
        return None
    picked = selector.select(
        user_msg, specialists, min_overlap=settings.agent.auto_rotate_min_overlap
    )
    return picked.name if picked else None
