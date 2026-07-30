"""Wake-on-connect (ROADMAP D2-B) — wake the flagged machines when the owner's client shows up.

The trigger is the SPA opening its live activity stream (`GET /api/events/stream`): that connect IS
"the owner just opened the dashboard", so B needs no new surface, no poll loop and no new dependency.
(D2-A — the `tailscale status --json` poll for "the owner just got HOME" — is the stronger trigger and
lands with the scheduler/monitor subsystem; both fire the SAME `wake_host` action through the SAME
gate, so A slots in beside this without reshaping anything.)

Three properties this module exists to guarantee:

  1. **It never touches the stream.** `schedule()` returns immediately; the work runs in a detached
     task under a broad exception guard. A config typo, a dead adapter or an exploding `invoke` logs
     and dies alone — the SSE generator is already yielding by then either way.
  2. **It goes through the chokepoint.** `ActionService.invoke("wake_host", …, origin=system,
     actor=SYSTEM, interactive=False)` — privilege-gated and audited like every other invocation, so an
     automatic wake is visible in the Event log exactly like a button press (with `system` as both the
     actor and the origin). No direct `wol.send_magic` shortcut.
  3. **It stays quiet.** A phone walking in and out of wifi range reopens the stream constantly, and
     every reconnect would otherwise write a fresh Event per flagged host. A per-host monotonic
     cooldown (`wake.cooldown_s`) bounds that. WOL is idempotent, so this is log hygiene, not safety —
     which is also why the already-online skip may read a slightly stale fleet cache without harm.

A config with zero flagged hosts costs one dict lookup per stream connect and does nothing else.
"""

from __future__ import annotations

import asyncio
import logging
import time
from typing import TYPE_CHECKING

from app.domain.enums import Actor
from app.domain.event import Origin

if TYPE_CHECKING:
    from fastapi import FastAPI

logger = logging.getLogger(__name__)

#: Detached tasks are only weakly referenced by the event loop, so a task nobody holds can be garbage-
#: collected mid-flight (the documented `asyncio.create_task` footgun). Keep a strong ref until done.
_tasks: set[asyncio.Task[None]] = set()


def cooldowns(app: "FastAPI") -> dict[str, float]:
    """The per-host `{host_id: monotonic-timestamp-of-last-fire}` map, on `app.state` (NOT a module
    global) so two apps in one process — every `TestClient` builds a fresh one — can't share a
    cooldown. Created on first use: this runs from a request, always after the lifespan."""
    existing = getattr(app.state, "wake_cooldowns", None)
    if existing is None:
        existing = {}
        app.state.wake_cooldowns = existing
    return existing


async def wake_flagged_hosts(app: "FastAPI") -> None:
    """Fire `wake_host` for every host flagged `wake_on_connect` that is eligible right now.

    Skipped, in order: no `mac` (the action's own DENIED outcome is correct but pure log noise for an
    automatic fire — the owner never asked for it at this instant), known-online per the fleet's cached
    sweep, and inside the per-host cooldown. The cooldown is stamped BEFORE the await so a burst of
    near-simultaneous connects can't all pass the check and fan out N packets."""
    settings = app.state.settings
    fleet = app.state.fleet
    actions = app.state.actions
    cooldown_s = settings.wake.cooldown_s
    marks = cooldowns(app)

    online = fleet.cached_online_ids()  # cheap + probe-free; empty when the cache is cold/expired
    now = time.monotonic()
    for host in fleet.hosts():
        if not host.wake_on_connect or not host.mac:
            continue
        if host.id in online:
            continue
        last = marks.get(host.id)
        if last is not None and (now - last) < cooldown_s:
            continue
        marks[host.id] = now
        await actions.invoke(
            "wake_host",
            {"host_id": host.id},
            # Nobody typed this — the app itself decided (D-4): `system`, stated explicitly, so the
            # audit row distinguishes an automatic wake from the owner pressing the button.
            origin=Origin(kind="system"),
            actor=Actor.SYSTEM,
            interactive=False,
        )


def schedule(app: "FastAPI") -> None:
    """Fire-and-forget `wake_flagged_hosts` — the ONE entry point callers use. Never awaits, never
    raises: a failure to even schedule (no running loop) is swallowed like a failure to run."""

    async def _guarded() -> None:
        try:
            await wake_flagged_hosts(app)
        except Exception:  # noqa: BLE001 — an automation must never escape into its trigger
            logger.exception("wake-on-connect failed")

    # Probe for the loop BEFORE constructing the coroutine (Codex final round, LOW). The old shape
    # called `create_task(_guarded())`: with no running loop that builds a coroutine object which is
    # then never awaited, so the interpreter emits "coroutine was never awaited" (a RuntimeWarning)
    # when it is collected — log noise in prod, and a hard failure under a `-W error` test run, on top
    # of the error we were already handling. Probing first means the no-loop path allocates nothing.
    # Holding the loop also removes the second failure mode: `loop.create_task` cannot raise
    # "no running event loop" the way the module-level helper can.
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:  # no running loop (shouldn't happen from a request) — nothing to do
        logger.warning("wake-on-connect could not be scheduled: no running event loop")
        return
    # …and the create_task itself is guarded too (verify-5, fix 5). It sat OUTSIDE the try: a loop that
    # refuses the task (shutting down, a patched/instrumented loop, a scheduling error) would raise
    # straight into the SSE generator that called us — the ONE thing this module promises never to do —
    # and leave the just-built coroutine unstarted, so its collection warns "never awaited" on top.
    # Constructing the coroutine first means we hold the reference needed to `close()` it on that path.
    coro = _guarded()
    try:
        task = loop.create_task(coro)
    except Exception:  # noqa: BLE001 — an automation must never escape into its trigger
        coro.close()  # never started → close it explicitly, so nothing warns when it is collected
        logger.exception("wake-on-connect could not be scheduled")
        return
    _tasks.add(task)
    task.add_done_callback(_tasks.discard)
