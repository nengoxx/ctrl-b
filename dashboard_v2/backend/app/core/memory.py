"""Memory — durable, file-based notes injected into each turn (DESIGN §Agent memory, D14/D15 #4).

The file impl of the ROADMAP B1 `MemoryProvider`: per-agent `memories/MEMORY.md` (isolated) + a
global `memories/USER.md` (the owner profile, shared across agents). The provider is the seam; the
default `FileMemoryProvider` reads/writes the markdown files, and a vector-backed provider is the
later "both" mode (over the unused `memory` table + the 4f embeddings client) — the same interface.

A `Protocol` with a swappable default, mirroring `core/skills.py`'s `SkillProvider` (D11). Kept in
`core/` (no service imports) so both `services/` and the agent runtime can depend on it without a
layering cycle. The write surface (the `memory` tool) and raw read/clear (the Conf panel) extend
this protocol in their slices (7e-d-2 / 7e-d-3); this slice defines just the read path.
"""

from __future__ import annotations

from typing import Protocol, runtime_checkable

from app.domain.agent import AgentDef


@runtime_checkable
class MemoryProvider(Protocol):
    """Durable memory for the agent loop. `load_context` returns the block injected into the system
    prompt each turn — the agent's own memory plus the global user profile, with cap-usage headers —
    or "" when there's nothing to inject (subsystem off, or both stores empty)."""

    def load_context(self, agent: AgentDef) -> str: ...
