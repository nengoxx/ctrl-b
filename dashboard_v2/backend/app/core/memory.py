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

from collections.abc import AsyncIterator, Sequence
from dataclasses import dataclass
from enum import Enum
from pathlib import Path
from typing import Protocol, runtime_checkable

from app.domain.agent import AgentDef


class StoreScope(str, Enum):
    """Where a store's file lives. `AGENT` → per-agent (root agent → the memory-dir root, a specialist
    → its `agents/<slug>/`); `GLOBAL` → one shared file at the memory-dir root, across all agents."""

    AGENT = "agent"
    GLOBAL = "global"


class StoreSemantics(str, Enum):
    """How the `memory` tool edits a store. `APPEND` → `§`-delimited entries the model adds/replaces/
    removes (MEMORY.md, USER.md). `SET` → a wholesale value the model overwrites (the emotional
    `state.md`, D27 slice B) — no `§`/cap-tidy logic; `content` *is* the new value."""

    APPEND = "append"
    SET = "set"


class StorePosition(str, Enum):
    """Injection ordering within the single memory block (`load_context` emits PERSONA-first, then
    FACTS). `PERSONA` → affective/identity context that reads next to the persona (state); `FACTS` →
    durable factual context (agent memory, user profile)."""

    PERSONA = "persona"
    FACTS = "facts"


@dataclass(frozen=True)
class StoreSpec:
    """Structural descriptor for one memory store (D27). The *structural* facts are code constants
    here; the *tunables* (`enabled`, `cap`, `backed_up`) resolve live from `MemoryCfg` so a Conf toggle
    hot-applies. `FileMemoryProvider` builds its behaviour by iterating these instead of hardcoding
    each store, so adding a store (state.md) is one more entry rather than a new branch at ~6 sites."""

    key: str                              # stable id used by the tool / API / config (memory|user|state)
    label: str                            # human + header label ("Agent memory")
    scope: StoreScope
    filename: str                         # MEMORY.md / USER.md / STATE.md
    semantics: StoreSemantics
    position: StorePosition
    injected: bool = True                 # part of the injected `load_context` block
    writable: bool = True                 # the `memory` tool may write it
    backed_up: bool = True                # versioned in the D26 git repo (False → future ephemeral store)


@runtime_checkable
class MemoryProvider(Protocol):
    """Durable memory for the agent loop. `load_context` returns the block injected into the system
    prompt each turn — the agent's own memory plus the global user profile, with cap-usage headers —
    or "" when there's nothing to inject (subsystem off, or both stores empty). `write` applies one
    edit (the `memory` tool's write path, 7e-d-2) and returns a one-line summary; it raises on a
    failed/over-cap edit so the tool can steer the model. `read_raw`/`overwrite` are the Conf panel's
    read/clear (7e-d-3).

    `write`/`overwrite` are **async** (D26): each couples its file write to a git commit under a
    process-wide lock; `load_context`/`read_raw` are read-only and stay sync."""

    def load_context(self, agent: AgentDef) -> str: ...

    async def write(
        self, agent: AgentDef, target: str, action: str, content: str, old_text: str | None = ...
    ) -> str: ...

    def read_raw(self, agent: AgentDef, target: str) -> str: ...

    async def overwrite(self, agent: AgentDef, target: str, content: str) -> str: ...


@runtime_checkable
class MemoryBackup(Protocol):
    """Versions the memory directory in a local git repo (D26). The provider holds one instance; its
    `guard()` is the process-wide serialization lock that couples each file write to its commit.

    Contract: `commit()` assumes the caller already holds `guard()` (it's invoked from inside the
    provider's `async with backup.guard()`), so it must NOT re-acquire the lock; `reconcile()`
    acquires `guard()` itself (it's driven by startup + the background sweep, outside any write).
    All operations are best-effort — a git failure never propagates to the memory write."""

    def guard(self) -> "AsyncIterator[None]":  # an @asynccontextmanager
        ...

    async def commit(self, paths: Sequence[Path], message: str) -> None: ...

    async def reconcile(self) -> None: ...
