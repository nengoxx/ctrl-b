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
from app.services.agent.core_memory import CoreMemoryCorpus
from app.services.automations import AutomationService
from app.services.conversation import MessageRepo, ThreadRepo
from app.services.events import EventService
from app.services.fleet import FleetService
from app.services.svc import ServiceService

if TYPE_CHECKING:  # avoid the deps→action_service→deps import cycle; set at runtime in lifespan
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
