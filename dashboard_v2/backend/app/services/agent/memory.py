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

import re
from pathlib import Path

from app.config import Settings
from app.domain.agent import AgentDef


class MemoryWriteError(RuntimeError):
    """A memory write that can't proceed for a reason the model can fix (e.g. `old_text` not found).
    The `memory` tool catches it and returns an ERROR `ToolResult` steering the model, not a crash."""


class MemoryCapError(MemoryWriteError):
    """A write that would push a store past its character cap. The tool turns this into an ERROR
    `ToolResult` telling the model to consolidate (replace/remove) before adding."""

    def __init__(self, label: str, length: int, cap: int) -> None:
        self.label, self.length, self.cap = label, length, cap
        super().__init__(
            f"{label} would be {length:,} chars, over its {cap:,}-char cap — consolidate "
            "(replace/remove) existing entries before adding."
        )


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

    def _target(self, agent: AgentDef, target: str) -> tuple[Path, int, str]:
        """Resolve a write target to its (file, cap, label). `user` → the global USER.md; anything
        else → the agent's own MEMORY.md. Caps read from live Settings (same source as the headers
        `load_context` shows), so a cap edit applies with no restart."""
        cfg = self._settings.memory
        if target == "user":
            return self._user_file(), cfg.user_char_limit, "User profile"
        return self._memory_file(agent), cfg.memory_char_limit, "Agent memory"

    def write(
        self, agent: AgentDef, target: str, action: str, content: str, old_text: str | None = None
    ) -> str:
        """Apply one edit to a memory store and persist it; returns a one-line summary with the new
        cap usage. `add` appends a `§`-delimited entry; `replace`/`remove` operate on the first
        occurrence of the `old_text` substring. Raises `MemoryWriteError` (old_text not found / bad
        action) or `MemoryCapError` (over cap) — the caller turns either into an ERROR result. The
        store's enable/profile gating + the `auto_write` switch live in the tool, not here."""
        path, cap, label = self._target(agent, target)
        body = _read(path)
        if action == "add":
            entry = content.strip()
            new = f"{body}\n\n§ {entry}" if body else f"§ {entry}"
        elif action in ("replace", "remove"):
            needle = old_text or ""
            if not needle:
                raise MemoryWriteError(f"{action} requires a non-empty `old_text`.")
            if needle not in body:
                raise MemoryWriteError(
                    f"`old_text` not found in {label} — copy an exact substring from the memory "
                    "block injected this turn."
                )
            new = body.replace(needle, content if action == "replace" else "", 1)
        else:
            raise MemoryWriteError(f"unknown memory action {action!r}")

        new = re.sub(r"\n{3,}", "\n\n", new).strip()
        if len(new) > cap:
            raise MemoryCapError(label, len(new), cap)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(new + "\n" if new else "", encoding="utf-8")
        pct = round(100 * len(new) / cap) if cap > 0 else 0
        return f"{label} updated ({action}) — {pct}% ({len(new):,}/{cap:,})"

    def read_raw(self, agent: AgentDef, target: str) -> str:
        """The raw stored text of a memory file (USER.md for `user`, else the agent's MEMORY.md), or
        "" if absent — for the Conf editor. Distinct from `load_context`, which formats + wraps it."""
        path, _cap, _label = self._target(agent, target)
        return _read(path)

    def overwrite(self, agent: AgentDef, target: str, content: str) -> str:
        """Replace a memory file wholesale (the Conf panel's manual edit). Blank content removes the
        file (→ nothing injected), mirroring the SOUL.md editor. **No cap enforcement** — manual
        owner edits aren't capped (the cap only governs the agent's own `write` auto-writes). Returns
        the stored text (== what `read_raw` would return next)."""
        path, _cap, _label = self._target(agent, target)
        if content.strip():
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(content.rstrip("\n") + "\n", encoding="utf-8")
        elif path.is_file():
            path.unlink()
        return _read(path)


def _read(p: Path) -> str:
    return p.read_text(encoding="utf-8").strip() if p.is_file() else ""


def _section(title: str, body: str, cap: int) -> str:
    pct = round(100 * len(body) / cap) if cap > 0 else 0
    return f"## {title} ({pct}% — {len(body):,}/{cap:,})\n{body}"
