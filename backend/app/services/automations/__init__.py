"""Scheduled agent automations (A3, D49 / AUTOMATIONS_PLAN) — the subsystem package.

Split by concern, like `services/agent/`:

  * `schedule.py` — the ONE `cronsim`/`zoneinfo` wrapper (validate · next fire · human echo).
  * `repo.py`     — `AutomationRepo`: SQLite for `automations` + `automation_runs`.
  * `service.py`  — `AutomationService`: the ONE validated write path, the claim protocol, the boot
                    orphan sweep, retention, and the run-event audit helper.
  * `runner.py`   — `AutomationRunner`: the lifespan poll loop, the global concurrency-1 arbiter, and
                    one run driven through the existing turn machinery.

Re-exported here so callers (the lifespan, 14c's router, 14d's tools) import from the package rather
than reaching into a module and freezing today's file layout into their import lines.
"""

from app.services.automations.repo import AutomationRepo
from app.services.automations.runner import INTERRUPTED_NOTE, AutomationRunner
from app.services.automations.schedule import (
    ScheduleError,
    describe,
    next_fire,
    next_fires,
    resolve_tz,
    server_tz_key,
    validate_cron,
)
from app.services.automations.service import (
    ORPHAN_NOTE,
    AutomationAgentMissing,
    AutomationBusy,
    AutomationCapReached,
    AutomationError,
    AutomationInvalid,
    AutomationNotFound,
    AutomationService,
)

__all__ = [
    "INTERRUPTED_NOTE",
    "ORPHAN_NOTE",
    "AutomationAgentMissing",
    "AutomationBusy",
    "AutomationCapReached",
    "AutomationError",
    "AutomationInvalid",
    "AutomationNotFound",
    "AutomationRepo",
    "AutomationRunner",
    "AutomationService",
    "ScheduleError",
    "describe",
    "next_fire",
    "next_fires",
    "resolve_tz",
    "server_tz_key",
    "validate_cron",
]
