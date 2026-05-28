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
from app.core.skills import SkillProvider, SkillSelector
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
    subagent_sem: asyncio.Semaphore | None = None
