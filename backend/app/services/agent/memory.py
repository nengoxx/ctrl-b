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

import asyncio
import contextlib
import logging
import os
import re
import tempfile
from pathlib import Path

from app.config import Settings
from app.core.memory import (
    MEMORY_STORE,
    STORES,
    MemoryBackup,
    StorePosition,
    StoreScope,
    StoreSemantics,
    StoreSpec,
    store_by_key,
)
from app.domain.agent import AgentDef
from app.services.agent.memory_backup import NoopBackup
from app.services.agent.prompts import resolve

#: Injection order rank — PERSONA-first (emotional state), then FACTS (`load_context` sorts stably by
#: this, so stores at the same position keep registration order: memory before user).
_POSITION_RANK = {StorePosition.PERSONA: 0, StorePosition.FACTS: 1}


class MemoryWriteError(RuntimeError):
    """A memory write that can't proceed for a reason the model can fix (e.g. `old_text` not found).
    The `memory` tool catches it and returns an ERROR `ToolResult` steering the model, not a crash."""


class MemoryCapError(MemoryWriteError):
    """A write that would *grow* a store past its character cap (F1: only growth is rejected, never a
    shrink). The tool turns this into an ERROR `ToolResult` telling the model to free space first."""

    def __init__(self, label: str, length: int, cap: int, action: str = "add") -> None:
        self.label, self.length, self.cap, self.action = label, length, cap, action
        # Remediation is semantics-aware: a SET store (`set`) has no entries to remove — the only fix
        # is a shorter value; an APPEND store consolidates existing entries.
        fix = (
            "Send a shorter value."
            if action == "set"
            else "Remove or shorten existing entries first, then retry — a remove/shrink is always allowed."
        )
        super().__init__(
            f"this {action} would grow {label} to {length:,} chars, past its {cap:,}-char cap. {fix}"
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

    def _stores(self) -> list[StoreSpec]:
        """The store registry (D27) — all structural specs, regardless of enablement. A store is
        *present* here always and *gated* per-store (injection in `load_context`, writes in the
        `memory` tool), so a write/read target always resolves to the right file even while the store
        is disabled (no silent misroute to agent memory)."""
        return list(STORES)

    def _store_file(self, agent: AgentDef, spec: StoreSpec) -> Path:
        """The file backing `spec` for `agent`. GLOBAL → the memory-dir root; AGENT → the root for the
        default/root agent, else the specialist's `agents/<slug>/` dir. Generalizes the former
        `_memory_file`/`_user_file` (D27) — same paths, one code path keyed by scope + filename."""
        root = self._settings.memories_dir_path()
        if spec.scope is StoreScope.GLOBAL or agent.name == self._settings.DEFAULT_AGENT_NAME:
            return root / spec.filename
        return self._agent_memory_dir(agent) / spec.filename

    def _cap_for(self, spec: StoreSpec) -> int:
        """The live char cap for `spec` from `MemoryCfg` (same source as the headers `load_context`
        shows), so a cap edit applies with no restart. Flat caps for now (D27 notes the future
        `stores: {key: {cap}}` map as the seam once stores grow past a handful)."""
        cfg = self._settings.memory
        return {
            "memory": cfg.memory_char_limit,
            "user": cfg.user_char_limit,
            "state": cfg.state_char_limit,
        }.get(spec.key, cfg.memory_char_limit)

    def _store_enabled(self, spec: StoreSpec) -> bool:
        """Whether `spec` is currently active (the master `memory.enabled` switch is checked once up in
        `load_context`). The `user` profile and `state` stores have their own opt-in switches; the
        agent's own memory is always on under the master switch."""
        cfg = self._settings.memory
        if spec.key == "user":
            return cfg.user_profile_enabled
        if spec.key == "state":
            return cfg.state_enabled
        return True

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

    def load_context(self, agent: AgentDef, stamps: dict[str, str] | None = None) -> str:
        """The memory block injected each turn (after the prompt appends, D15 #4), or "" when the
        subsystem is off or every injected store is empty. Iterates the store registry PERSONA-first
        then FACTS (D27); each section carries a Hermes-style usage header (`## Agent memory (67% —
        1,474/2,200)`) so the model sees cap pressure.

        `stamps` is the caller's prompt-stamp accumulator (Phase 18 / C-8), forwarded to the two
        prompts framing this block — the session passes its own, so the block's identity rides the
        message the block fed."""
        cfg = self._settings.memory
        if not cfg.enabled:
            return ""
        sections: list[str] = []
        pressured: list[str] = []  # store labels at/over the nudge threshold (Slice 1b)
        for spec in sorted(self._stores(), key=lambda s: _POSITION_RANK[s.position]):
            if not spec.injected or not self._store_enabled(spec):
                continue
            body = _read(self._store_file(agent, spec))
            if not body:
                continue
            cap = self._cap_for(spec)
            sections.append(_section(spec.label, body, cap))
            if _pct(len(body), cap) >= cfg.consolidation_nudge_pct:
                pressured.append(f"{spec.label} ({_pct(len(body), cap)}%)")
        if not sections:
            return ""
        # The registry owns the framing; the sections are this feature's data, concatenated after it
        # (L-8) — so an override can reword the intro but never drop what it introduces.
        block = resolve("memory_intro", self._settings, stamps=stamps) + "\n\n" + "\n\n".join(sections)
        # Proactive consolidation nudge (Slice 1b, opt-in). Neutral wording so it reads right at 85% and
        # at 150% alike (a manual over-cap overwrite — F10). The hard over-cap error is independent.
        if cfg.consolidation_nudge and pressured:
            nudge = resolve(
                "consolidation_nudge",
                self._settings,
                {"pressured": ", ".join(pressured)},
                stamps=stamps,
            )
            block += "\n\n" + nudge
        return block

    def _spec_for(self, key: str) -> StoreSpec:
        """Look up a store spec by its `key`. An unknown/legacy key falls back to the agent memory
        store — preserving the pre-registry `_target` behaviour (`user` → USER.md, anything else →
        the agent's own MEMORY.md)."""
        return store_by_key(key) or MEMORY_STORE

    def _target(self, agent: AgentDef, target: str) -> tuple[Path, StoreSpec]:
        """Resolve a write/read target to its (file, spec). Cap + label come from the spec via
        `_cap_for`/`spec.label` at the call site (caps read live from Settings, so a cap edit applies
        with no restart)."""
        spec = self._spec_for(target)
        return self._store_file(agent, spec), spec

    async def write(
        self, agent: AgentDef, target: str, action: str, content: str, old_text: str | None = None
    ) -> str:
        """Apply one edit to a memory store and persist it; returns a one-line summary with the new
        cap usage. Behaviour is keyed by the store's **semantics** (D27): an **APPEND** store (memory,
        user) takes `add` (a `§`-delimited entry) / `replace` / `remove` acting on the **unique**
        occurrence of `old_text` (F6 — an ambiguous match is rejected so the model adds context rather
        than editing the wrong entry); a **SET** store (state) takes `set`, where `content` *is* the new
        whole value (no `§`/tidy). Raises `MemoryWriteError` (old_text not found / ambiguous / bad
        action) or `MemoryCapError` (a *growing* edit over cap) — the caller turns either into an
        ERROR result. The store's enable/profile gating, the action↔semantics check, and the
        `auto_write` switch live in the tool, not here.

        Concurrency invariant (F5/D26): the **entire** read-modify-write-commit runs under the backup
        lock — the file read, the in-memory merge, the cap-check, the atomic write, and the commit are
        one critical section. That's what makes a concurrent edit safe: two subagents writing the same
        file (or any write that arrives while the periodic `reconcile()` sweep holds the same lock)
        serialize, and the second reads the *post*-first-write body, so no update is lost. (Earlier the
        read sat outside the lock; D26's `async with` could then suspend between read and write under
        contention — a lost-update window now closed.)"""
        path, spec = self._target(agent, target)
        cap, label = self._cap_for(spec), spec.label
        # The read-modify-write-commit is one critical section (see the invariant above). The merge can
        # raise (bad `old_text`/action) or the cap-check can raise — both propagate out of the lock with
        # no file change and no commit (the lock simply releases).
        async with self._backup.guard():
            new = await asyncio.to_thread(
                self._merge_and_write, path, spec, action, content, old_text, cap, label
            )
            await self._backup.commit([path], _commit_msg(agent, spec.filename, action))
        pct = round(100 * len(new) / cap) if cap > 0 else 0
        return f"{label} updated ({action}) — {pct}% ({len(new):,}/{cap:,})"

    def _merge_and_write(
        self,
        path: Path,
        spec: StoreSpec,
        action: str,
        content: str,
        old_text: str | None,
        cap: int,
        label: str,
    ) -> str:
        """The blocking read-modify-write half of `write`, hoisted into a single `asyncio.to_thread`
        hop (SYS-16): the read and the write must not straddle the event loop, and one hop keeps the
        whole critical section on one thread. `_merge` (bad `old_text`/action) and the cap check raise
        exactly as before — both propagate out of the thread with no file change and no commit."""
        body = _read(path)
        new = self._merge(spec, action, content, old_text, body, label)
        # F1 — the cap is a *growth* guard, not an absolute ceiling: reject only an edit that pushes
        # the store further over cap. A `remove`/shrinking `replace`/smaller `set` is always allowed
        # even while over cap, so an over-cap store (a lowered cap, or the uncapped manual
        # `overwrite`) can never trap the very edits that resolve it.
        if len(new) > cap and len(new) > len(body):
            raise MemoryCapError(label, len(new), cap, action)
        _atomic_write(path, new + "\n" if new else "")
        return new

    @staticmethod
    def _merge(
        spec: StoreSpec, action: str, content: str, old_text: str | None, body: str, label: str
    ) -> str:
        """Compute the new store body for one edit — pure (no I/O), so it runs inside the write lock.
        SET store → the wholesale stripped `content`; APPEND store → a `§`-delimited `add`, or a
        `replace`/`remove` on the **unique** `old_text` occurrence (F6), tidied (F3a). Raises
        `MemoryWriteError` on a bad `old_text`/action (the gate already validated args, but this stays
        self-defending). The action↔semantics gate guarantees `action == "set"` for a SET store."""
        if spec.semantics is StoreSemantics.SET:
            # SET store (state.md, D27-B): `content` is the new whole value — no `§` framing and no
            # `_tidy` (free-form markdown the model rewrites each time).
            return content.strip()
        if action == "add":
            entry = content.strip()
            return _tidy(f"{body}\n\n§ {entry}" if body else f"§ {entry}")
        if action in ("replace", "remove"):
            needle = old_text or ""
            if not needle:
                raise MemoryWriteError(f"{action} requires a non-empty `old_text`.")
            # F6 — require `old_text` to identify EXACTLY one place (Hermes / Claude memory-tool
            # behaviour). First-occurrence matching silently edited the wrong entry when a short needle
            # also appeared inside another (e.g. "cat" inside "category"); an ambiguous match now errors
            # so the model adds surrounding context instead of corrupting a different entry.
            count = body.count(needle)
            if count == 0:
                raise MemoryWriteError(
                    f"`old_text` not found in {label} — copy an exact substring from the memory "
                    "block injected this turn."
                )
            if count > 1:
                raise MemoryWriteError(
                    f"`old_text` matches {count} places in {label} — include more surrounding text "
                    "so it identifies exactly one entry."
                )
            return _tidy(body.replace(needle, content if action == "replace" else "", 1))
        raise MemoryWriteError(f"unknown memory action {action!r}")

    def read_raw(self, agent: AgentDef, target: str) -> str:
        """The raw stored text of a memory file (USER.md for `user`, else the agent's MEMORY.md), or
        "" if absent — for the Conf editor. Distinct from `load_context`, which formats + wraps it."""
        path, _spec = self._target(agent, target)
        return _read(path)

    async def overwrite(self, agent: AgentDef, target: str, content: str) -> str:
        """Replace a memory file wholesale (the Conf panel's manual edit). Blank content removes the
        file (→ nothing injected), mirroring the SOUL.md editor. **No cap enforcement** — manual
        owner edits aren't capped (the cap only governs the agent's own `write` auto-writes). The write
        (or deletion) is committed under the backup lock (D26). Returns the stored text (== what
        `read_raw` would return next)."""
        path, spec = self._target(agent, target)
        async with self._backup.guard():
            stored = await asyncio.to_thread(_overwrite_file, path, content)
            await self._backup.commit([path], _commit_msg(agent, spec.filename, "overwrite"))
        return stored


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


def _overwrite_file(path: Path, content: str) -> str:
    """The blocking write-or-remove + read-back behind `MemoryProvider.overwrite`, hoisted into a
    single `asyncio.to_thread` hop (SYS-16) so the whole read-modify-write sequence runs on one
    thread instead of widening the is_file/unlink window across several. Returns the stored text
    (== what `read_raw` returns next); the git commit that follows doesn't touch content."""
    if content.strip():
        _atomic_write(path, content.rstrip("\n") + "\n")
    elif path.is_file():
        path.unlink()
    return _read(path)


def _commit_msg(agent: AgentDef, filename: str, action: str) -> str:
    """A content-free commit subject (D26 #6) — identifies the agent + which store file, never the
    text, so nothing leaks via `git log`."""
    return f"memory({agent.name}): {action} {filename}"


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


def _pct(length: int, cap: int) -> int:
    return round(100 * length / cap) if cap > 0 else 0


def _section(title: str, body: str, cap: int) -> str:
    return f"## {title} ({_pct(len(body), cap)}% — {len(body):,}/{cap:,})\n{body}"
