"""FileMemoryProvider — the file-based `MemoryProvider` (7e-d, D14/D15 #4).

Per-agent `memories/MEMORY.md` (isolated to the agent's workspace) + a global `memories/USER.md`
(the owner profile, shared across agents). The default/root agent's MEMORY.md is the root
`$CTRLB_HOME/memories/MEMORY.md`; a specialist's is `agents/<slug>/memories/MEMORY.md`. USER.md is
always the root `$CTRLB_HOME/memories/USER.md`.

This slice (7e-d-1) implements the read path: `load_context` injects the saved notes into each turn
with Hermes-style cap-usage headers, so the model both *uses* the memory and *sees* how close each
store is to its cap (cap pressure → the write tool's consolidation behaviour, 7e-d-2). The write
tool and Conf editing extend this provider in 7e-d-2 / 7e-d-3.
"""

from __future__ import annotations

from pathlib import Path

from app.config import Settings
from app.domain.agent import AgentDef


class FileMemoryProvider:
    """Reads the markdown memory files under `$CTRLB_HOME`. Stateless across turns — paths and caps
    resolve from live `Settings` each call, so an edited file or a changed cap is picked up with no
    restart (the same contract as `FileSkillProvider`)."""

    def __init__(self, settings: Settings) -> None:
        self._settings = settings

    def _memory_file(self, agent: AgentDef) -> Path:
        """The agent's own MEMORY.md. Default/root agent → `$CTRLB_HOME/memories/`; a specialist →
        `agents/<slug>/memories/` (its workspace folder)."""
        if agent.name == self._settings.DEFAULT_AGENT_NAME:
            base = self._settings.memories_dir_path()
        else:
            base = self._settings.agents_dir_path() / agent.name / "memories"
        return base / "MEMORY.md"

    def _user_file(self) -> Path:
        """The global owner profile, shared across all agents."""
        return self._settings.memories_dir_path() / "USER.md"

    def load_context(self, agent: AgentDef) -> str:
        """The memory block injected each turn (after the prompt appends, D15 #4), or "" when the
        subsystem is off or both stores are empty. Each section carries a Hermes-style usage header
        (`## Agent memory (67% — 1,474/2,200)`) so the model sees cap pressure."""
        cfg = self._settings.memory
        if not cfg.enabled:
            return ""
        sections: list[str] = []
        mem = _read(self._memory_file(agent))
        if mem:
            sections.append(_section("Agent memory", mem, cfg.memory_char_limit))
        if cfg.user_profile_enabled:
            user = _read(self._user_file())
            if user:
                sections.append(_section("User profile", user, cfg.user_char_limit))
        if not sections:
            return ""
        intro = (
            "Durable memory you saved in earlier sessions — treat it as known, current context. "
            "The percentages show how full each store is against its character cap."
        )
        return intro + "\n\n" + "\n\n".join(sections)


def _read(p: Path) -> str:
    return p.read_text(encoding="utf-8").strip() if p.is_file() else ""


def _section(title: str, body: str, cap: int) -> str:
    pct = round(100 * len(body) / cap) if cap > 0 else 0
    return f"## {title} ({pct}% — {len(body):,}/{cap:,})\n{body}"
