"""Deps — the bundle of services/adapters a tool reaches for via `InvocationContext.deps`
(DESIGN.md §3). Kept in `services/` (not `core/`) so `core` stays free of service imports; the
context types it structurally. Phase 2 carries settings + fleet + events; the agent/inference/MCP
deps join in their phases.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from typing import TYPE_CHECKING

from app.adapters.embeddings import EmbeddingsClient
from app.adapters.inference import InferenceClient
from app.adapters.openterminal import OpenTerminalClient
from app.adapters.searxng import SearxngClient
from app.config import Settings
from app.core.memory import MemoryProvider
from app.core.skills import SkillProvider, SkillSelector
from app.services.agent.core_memory import CORE_MEMORY_TOOL, CoreMemoryCorpus
from app.services.automations import AutomationService
from app.services.conversation import MessageRepo, ThreadRepo
from app.services.events import EventService
from app.services.fleet import FleetService
from app.services.svc import ServiceService

if TYPE_CHECKING:  # avoid the deps→action_service→deps import cycle; set at runtime in lifespan
    from app.domain.agent import AgentDef
    from app.services.action_service import ActionService


@dataclass
class Deps:
    settings: Settings
    fleet: FleetService
    events: EventService
    services: ServiceService
    searxng: SearxngClient | None = None  # web_search backend (Phase 4f); None until configured/wired
    open_terminal: OpenTerminalClient | None = None  # open-terminal remote shell/files (Phase 4f)
    embeddings: EmbeddingsClient | None = None  # vector embeddings backend (Phase 4f); used by Phase-7 memory
    #: Agent-runtime handles the `spawn_subagents` tool needs to build + run child agents (4.5,
    #: DESIGN §5.5). Set in the lifespan after the chat stack is built (the ActionService reference
    #: is back-filled to dodge the deps↔action_service import cycle). `subagent_sem` is the
    #: process-wide concurrency cap held across the whole subagent tree.
    inference: InferenceClient | None = None
    threads: ThreadRepo | None = None
    messages: MessageRepo | None = None
    actions: "ActionService | None" = None
    skills: SkillProvider | None = None
    selector: SkillSelector | None = None
    memory: MemoryProvider | None = None  # file-based agent memory (Phase 7e-d); read each turn
    #: The tier-2 long-term corpus (D57/Phase 20), a SIBLING of `memory` rather than a store inside
    #: it. Here only so the subagent path can hand it to the child session — the session takes it as
    #: a `core_memory=` kwarg, never off `Deps` (CORE_MEMORY_PLAN §6, council M5).
    core_memory: CoreMemoryCorpus | None = None
    subagent_sem: asyncio.Semaphore | None = None
    #: The ONE automations writer/reader (A3 14d), for the `create_automation`/`list_automations`
    #: builtins. Imported directly (unlike `actions` above) because nothing under
    #: `services/automations/` imports `Deps` — there is no cycle to dodge, so the tools get a real
    #: type instead of a string one. Back-filled in the lifespan like the other agent-runtime handles:
    #: `Deps` is constructed before the chat stack, and the service needs the DB + the turn registry.
    automations: AutomationService | None = None

    def longterm_available(self, agent: "AgentDef") -> bool:
        """Is the tier-2 `core_memory` tool effectively reachable for `agent` right now? (D57 §4b-4.)

        Two halves, matching the two-layer exposure gate: the corpus is wired and its slot is on, AND
        the tool survives the agent's own `tools` allowlist (it is `core=False`, so an allowlist may
        legitimately exclude it). Lives HERE because it needs the corpus *and* the action registry,
        and because §8-4 forbids the tier-1 modules that ask it from importing the corpus module —
        `Deps` is the composition root that already holds both, so neither tier reaches into the other.

        Allowlist-level, not turn-level: a per-turn skill narrowing is invisible from here (the
        session, which owns that state, answers the same question with `_tool_allowed`). A caller that
        only needs to decide whether to MENTION the tool accepts that approximation."""
        if self.core_memory is None or not self.core_memory.enabled() or self.actions is None:
            return False
        return any(
            tool.spec.name == CORE_MEMORY_TOOL for tool in self.actions.registry.for_agent(agent.tools)
        )
