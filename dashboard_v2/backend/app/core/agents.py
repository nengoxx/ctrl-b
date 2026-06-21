"""Agent selection — the swappable strategy that auto-routes a turn to a specialist when no `/agent`
is pinned (7e-g, D15 #8). Mirrors `core/skills.py`'s `SkillSelector`.

The default `KeywordAgentSelector` (services/agent/selector.py) matches the user message against each
agent's `name + description` via the shared `core.textmatch` matcher; an LLM/embeddings router is a
drop-in via this same `Protocol`. `select` returns one specialist or `None` (fall through to the
configured default — the default agent is never a candidate, it's the no-match fallback).

`min_overlap` is a per-call keyword (not baked at construction like `KeywordSkillSelector`'s) so the
chat endpoint can thread the live `agent.auto_rotate_min_overlap` setting in without a restart; an
implementation that doesn't need a threshold can ignore it.
"""

from __future__ import annotations

from typing import Protocol, runtime_checkable

from app.domain.agent import AgentDef


@runtime_checkable
class AgentSelector(Protocol):
    """Picks one specialist `AgentDef` for a turn, or `None` to fall through to the configured
    default (the swappable strategy, D15 #8). `agents` is the specialist candidates only."""

    def select(
        self, user_msg: str, agents: list[AgentDef], *, min_overlap: int = 1
    ) -> AgentDef | None: ...
