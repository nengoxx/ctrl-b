"""Deps — the bundle of services/adapters a tool reaches for via `InvocationContext.deps`
(DESIGN.md §3). Kept in `services/` (not `core/`) so `core` stays free of service imports; the
context types it structurally. Phase 2 carries settings + fleet + events; the agent/inference/MCP
deps join in their phases.
"""

from __future__ import annotations

from dataclasses import dataclass

from app.config import Settings
from app.services.events import EventService
from app.services.fleet import FleetService
from app.services.svc import ServiceService


@dataclass
class Deps:
    settings: Settings
    fleet: FleetService
    events: EventService
    services: ServiceService
