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

import contextlib
import logging
import os
import re
import tempfile
from pathlib import Path

from app.config import Settings
from app.core.memory import MemoryBackup
from app.domain.agent import AgentDef
from app.services.agent.memory_backup import NoopBackup


class MemoryWriteError(RuntimeError):
    """A memory write that can't proceed for a reason the model can fix (e.g. `old_text` not found).
    The `memory` tool catches it and returns an ERROR `ToolResult` steering the model, not a crash."""


class MemoryCapError(MemoryWriteError):
    """A write that would *grow* a store past its character cap (F1: only growth is rejected, never a
    shrink). The tool turns this into an ERROR `ToolResult` telling the model to free space first."""

    def __init__(self, label: str, length: int, cap: int, action: str = "add") -> None:
        self.label, self.length, self.cap, self.action = label, length, cap, action
        super().__init__(
            f"this {action} would grow {label} to {length:,} chars, past its {cap:,}-char cap. "
            "Remove or shorten existing entries first, then retry — a remove/shrink is always allowed."
        )


class FileMemoryProvider:
    """Reads the markdown memory files under `$CTRLB_HOME`. Stateless across turns — paths and caps
    resolve from live `Settings` each call, so an edited file or a changed cap is picked up with no
    restart (the same contract as `FileSkillProvider`)."""

    def __init__(self, settings: Settings, backup: "MemoryBackup | None" = None) -> None:
        self._settings = settings
        #: The git backup (D26). It owns the process-wide lock that couples each file write to its
        #: commit; `NoopBackup` (lock only, no git) when none is injected so serialization still holds.
        self._backup: MemoryBackup = backup or NoopBackup()

    def _memory_file(self, agent: AgentDef) -> Path:
        """The agent's own MEMORY.md, inside the memory directory (D26). Default/root agent → the memory
        dir root; a specialist → `<memory_dir>/agents/<slug>/` (or its `AgentDef.memory_dir` override)."""
        if agent.name == self._settings.DEFAULT_AGENT_NAME:
            return self._settings.memories_dir_path() / "MEMORY.md"
        return self._agent_memory_dir(agent) / "MEMORY.md"

    def _agent_memory_dir(self, agent: AgentDef) -> Path:
        """A specialist's memory directory, resolved **relative to** the memory-dir root. An absolute or
        `..`-escaping `AgentDef.memory_dir` is rejected → the safe default `agents/<slug>`, so every
        memory file stays inside the one repo (D26 #2)."""
        root = self._settings.memories_dir_path()
        rel = getattr(agent, "memory_dir", None) or f"agents/{agent.name}"
        sub = root / rel
        try:
            if not sub.resolve().is_relative_to(root.resolve()):
                sub = root / "agents" / agent.name
        except OSError:
            sub = root / "agents" / agent.name
        return sub

    def _user_file(self) -> Path:
        """The global owner profile, shared across all agents — at the memory-dir root."""
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

    async def write(
        self, agent: AgentDef, target: str, action: str, content: str, old_text: str | None = None
    ) -> str:
        """Apply one edit to a memory store and persist it; returns a one-line summary with the new
        cap usage. `add` appends a `§`-delimited entry; `replace`/`remove` operate on the first
        occurrence of the `old_text` substring. Raises `MemoryWriteError` (old_text not found / bad
        action) or `MemoryCapError` (a *growing* edit over cap) — the caller turns either into an
        ERROR result. The store's enable/profile gating + the `auto_write` switch live in the tool,
        not here.

        Concurrency invariant (F5): this read-modify-write is synchronous (no `await` between the
        `_read` and the `write_text`), so concurrent turns/subagents sharing one file can't interleave
        within our single-worker event loop. Slice 2's git backup moves all memory mutations under a
        process-wide async lock — that lock then *is* the serialization guarantee (and lets the commit
        capture exactly this write); the no-await property here is the interim guard."""
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

        new = _tidy(new)
        # F1 — the cap is a *growth* guard, not an absolute ceiling: reject only an edit that pushes
        # the store further over the cap. A `remove`/shrinking `replace` is always allowed even while
        # over cap, so an over-cap store (a lowered cap, or the uncapped manual `overwrite`) can never
        # trap the very edits that resolve it. (Raised before the lock — no file change, no commit.)
        if len(new) > cap and len(new) > len(body):
            raise MemoryCapError(label, len(new), cap, action)
        # D26 — couple the atomic write to its commit under the backup lock so the commit captures
        # exactly these bytes and concurrent writes/subagents can't interleave.
        async with self._backup.guard():
            _atomic_write(path, new + "\n" if new else "")
            await self._backup.commit([path], _commit_msg(agent, target, action))
        pct = round(100 * len(new) / cap) if cap > 0 else 0
        return f"{label} updated ({action}) — {pct}% ({len(new):,}/{cap:,})"

    def read_raw(self, agent: AgentDef, target: str) -> str:
        """The raw stored text of a memory file (USER.md for `user`, else the agent's MEMORY.md), or
        "" if absent — for the Conf editor. Distinct from `load_context`, which formats + wraps it."""
        path, _cap, _label = self._target(agent, target)
        return _read(path)

    async def overwrite(self, agent: AgentDef, target: str, content: str) -> str:
        """Replace a memory file wholesale (the Conf panel's manual edit). Blank content removes the
        file (→ nothing injected), mirroring the SOUL.md editor. **No cap enforcement** — manual
        owner edits aren't capped (the cap only governs the agent's own `write` auto-writes). The write
        (or deletion) is committed under the backup lock (D26). Returns the stored text (== what
        `read_raw` would return next)."""
        path, _cap, _label = self._target(agent, target)
        async with self._backup.guard():
            if content.strip():
                _atomic_write(path, content.rstrip("\n") + "\n")
            elif path.is_file():
                path.unlink()
            await self._backup.commit([path], _commit_msg(agent, target, "overwrite"))
        return _read(path)


def migrate_legacy_specialist_memory(settings: Settings) -> int:
    """One-time (D26): relocate specialist memory from the pre-D26 `$CTRLB_HOME/agents/<slug>/memories/`
    into the unified memory dir at `<memory_dir>/agents/<slug>/MEMORY.md`. Moves only when the new
    location is absent (never clobbers); cleans the emptied old dir. Returns the count moved (0 = nothing
    to do — the common case, since specialists are rare). Run once at startup, before the first commit."""
    old_root = settings.agents_dir_path()
    new_root = settings.memories_dir_path()
    if not old_root.is_dir():
        return 0
    moved = 0
    for folder in sorted(old_root.iterdir()):
        old_mem = folder / "memories" / "MEMORY.md"
        if not old_mem.is_file():
            continue
        new_mem = new_root / "agents" / folder.name / "MEMORY.md"
        if new_mem.exists():
            continue
        try:  # best-effort: one bad folder must never crash startup (worst case: stays at the old path)
            new_mem.parent.mkdir(parents=True, exist_ok=True)
            old_mem.replace(new_mem)
            with contextlib.suppress(OSError):
                old_mem.parent.rmdir()  # remove the now-empty `agents/<slug>/memories/`
            moved += 1
        except OSError:
            logging.getLogger(__name__).warning("memory migration skipped for %s", folder.name)
    return moved


def _read(p: Path) -> str:
    return p.read_text(encoding="utf-8").strip() if p.is_file() else ""


def _commit_msg(agent: AgentDef, target: str, action: str) -> str:
    """A content-free commit subject (D26 #6) — identifies the agent + which store, never the text, so
    nothing leaks via `git log`."""
    store = "USER.md" if target == "user" else "MEMORY.md"
    return f"memory({agent.name}): {action} {store}"


def _atomic_write(path: Path, content: str) -> None:
    """Write `content` to `path` atomically (D26): temp file in the **same dir** → flush → `os.fsync`
    → `os.replace`, then best-effort parent-dir fsync (POSIX). Same-dir temp keeps `os.replace`/
    `MoveFileEx` atomic on one volume (the silent Windows non-atomic fallback only happens cross-volume).
    Forces LF newlines so memory files stay git-clean across platforms."""
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=str(path.parent), prefix=".tmp-", suffix=".md")
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as f:
            f.write(content)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, path)
    except BaseException:
        with contextlib.suppress(OSError):
            os.unlink(tmp)
        raise
    _fsync_dir(path.parent)


def _fsync_dir(d: Path) -> None:
    """Best-effort fsync of a directory so a fresh file's name is durable (POSIX). No-op on Windows,
    which doesn't support directory fsync — and the git commit is the durable record regardless."""
    if os.name == "nt":
        return
    try:
        fd = os.open(str(d), os.O_RDONLY)
    except OSError:
        return
    try:
        os.fsync(fd)
    except OSError:
        pass
    finally:
        os.close(fd)


def _tidy(text: str) -> str:
    """Normalize a memory body after an edit (F3a): collapse blank-line runs and drop a `§` bullet
    left *empty* by a remove/replace (a marker whose entry text is gone). Conservative on purpose —
    a `§`-only line is dropped only when the next line is blank, another bullet, or end-of-text, so a
    multi-line entry whose first line was edited keeps its marker rather than being mangled."""
    text = re.sub(r"\n{3,}", "\n\n", text)
    lines = text.split("\n")
    kept: list[str] = []
    for i, line in enumerate(lines):
        if re.fullmatch(r"§[ \t]*", line):
            nxt = lines[i + 1] if i + 1 < len(lines) else ""
            if nxt == "" or nxt.startswith("§"):  # blank line / next bullet / EOF → orphaned marker
                continue
        kept.append(line)
    return re.sub(r"\n{3,}", "\n\n", "\n".join(kept)).strip()


def _section(title: str, body: str, cap: int) -> str:
    pct = round(100 * len(body) / cap) if cap > 0 else 0
    return f"## {title} ({pct}% — {len(body):,}/{cap:,})\n{body}"
