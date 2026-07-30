"""AutomationService — the ONE writer, the claim protocol, and the housekeeping (A3, §D-1/§D-2).

Everything that changes an automation goes through this class: the REST router (14c), the agent's
`create_automation` tool (14d) and the tests all hand it an `AutomationDraft`, so there is exactly one
implementation of "is this schedule real, is this zone real, does this agent exist, is the cap full,
and what is this row's next fire". A second validator would drift on its first disagreement, and the
one it would drift on is the cap (a per-caller count is a TOCTOU hole by construction).

The four things worth reading before touching it:

* **`next_run_at` invariants** (§D-1). A create computes a strictly-future value; enabling and any
  schedule/tz edit recompute one; disabling nulls it, so a disabled row is structurally unclaimable and
  a later enable can never resurrect a stale past slot. No path ever *increments* a stored time.
* **The claim is one `BEGIN IMMEDIATE` transaction** (§D-2): re-read the row, verify it is still enabled
  and still at the `rev` the scan saw, classify lateness against `misfire_grace_s`, advance
  `next_run_at` **from now**, insert the run row, and return a FROZEN snapshot. The agent is invoked
  strictly outside it — no task is ever spawned inside a `Database.transaction()` (db.py's warning).
* **Misfire = skip, honestly** (owner ruling 3). A box that was asleep at 09:00 does not run the 09:00
  job at noon; it records a `missed` row saying so and moves to the next slot.
* **Strict agent resolution** (§D-1). A non-NULL `agent` is checked at write AND re-checked at claim,
  and a missing one FAILS the run. Never `Settings.resolve_agent`, which is deliberately forgiving for
  chat — falling back to the default agent would hand an automation a different toolset and privilege
  than the owner authorized, silently.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone

from app.config import Settings
from app.domain.agent import AgentDef
from app.domain.automation import (
    Automation,
    AutomationDraft,
    AutomationRun,
    AutomationSnapshot,
    RunStatus,
    RunTrigger,
)
from app.domain.enums import Actor, RunState
from app.domain.event import Event
from app.services.agent.turns import TurnBusy, TurnHandle, release, reserve
from app.services.automations.repo import AutomationRepo
from app.services.automations.schedule import ScheduleError, next_fire, resolve_tz, validate_cron
from app.services.conversation import ThreadRepo
from app.services.events import EventService

log = logging.getLogger(__name__)

#: What the boot sweep writes on a run the previous process died in the middle of. Its external effects
#: are unknowable from here — the tools it had already invoked did run — so the wording says exactly
#: that rather than implying the run did nothing.
ORPHAN_NOTE = "server restarted during run — the run was interrupted and its effects may be incomplete"


def _now() -> datetime:
    return datetime.now(timezone.utc)


class AutomationError(Exception):
    """Base for the service's refusals. Each subclass maps to one HTTP status in 14c; the message is
    written for the owner (and for the agent tool's result summary), never a traceback."""


class AutomationNotFound(AutomationError):
    """No such automation (→ 404)."""


class AutomationInvalid(AutomationError):
    """A field the caller must fix (→ 422). `field` names it so a form can point at the right input."""

    def __init__(self, field: str, message: str) -> None:
        self.field = field
        super().__init__(message)


class AutomationCapReached(AutomationError):
    """`automations.max_count` is full (→ 409). The message names the remedy (§D-1: "delete one
    first") — a refusal the agent may hit too, so it has to be actionable without a UI."""


class AutomationBusy(AutomationError):
    """A run of this automation is active (→ 409). Deleting mid-run would strand the live turn's thread
    and its finalizer's write target."""


class AutomationAgentMissing(AutomationError):
    """The automation names an `agent` that no longer exists. Raised at write (→ 422) and again at
    claim, where it FAILS the run instead of falling back to the default agent (§D-1)."""

    def __init__(self, name: str) -> None:
        self.name = name
        super().__init__(
            f"agent {name!r} does not exist — the run was not started (it would otherwise run with a "
            "different toolset and privilege than you authorized)"
        )


class AutomationService:
    def __init__(
        self,
        repo: AutomationRepo,
        settings: Settings,
        threads: ThreadRepo,
        events: EventService,
        turns: dict[str, TurnHandle],
    ) -> None:
        self._repo = repo
        #: The live `Settings` object (mutated in place by `runtime.apply_settings_inplace`), so a Conf
        #: edit to `automations.*` is honoured from the very next call — never a boot-time copy.
        self._settings = settings
        self._threads = threads
        self._events = events
        #: The app's per-thread turn-marker registry (D38) — the SINGLE busy-truth for the chat stack.
        #: This service deletes threads (retention, and the delete cascade), and a fresh run's thread is
        #: explicitly continuable in chat, so it must take that thread's marker before removing it (see
        #: `_claim_thread`).
        #:
        #: REQUIRED, with no default (wave 2). It briefly defaulted to `None` → a private empty dict,
        #: which is the same shape as `origin`'s rejected default: a safety invariant that a caller can
        #: switch off by OMISSION, silently and without failing — here it would mean "nothing is ever
        #: live", i.e. deleting threads out from under running turns. There is one construction site
        #: (the lifespan) and it passes the shared registry; anything else is a wiring bug that should
        #: be a type error at the site, not a quiet loss of the guarantee.
        self._turns: dict[str, TurnHandle] = turns

    @property
    def repo(self) -> AutomationRepo:
        return self._repo

    @property
    def cfg(self):
        """The live `automations:` section (§D-7). Read per use — every tunable comes from here."""
        return self._settings.automations

    def _claim_thread(self, thread_id: str) -> TurnHandle | None:
        """Take a thread's turn marker so nothing can start a turn on it while we delete it, or `None`
        if a turn already owns it (post-14b review, HIGH).

        Deleting a thread cascades its messages, and a FRESH run's thread is deliberately continuable in
        chat afterwards — so retention firing while the owner is mid-turn in an old run's thread would
        delete the history out from under a live drain task (lost messages, then persistence failures
        against rows that no longer exist). `reserve` is the same check-and-set the endpoints use, so
        "busy" means exactly what it means everywhere else, and holding the marker across the delete
        closes the window a bare membership test would leave open (there are `await`s in between).

        Synchronous by construction (the D38 no-await discipline): the caller pairs it with `release`."""
        try:
            # ring_size=1: a prune marker carries no drain task, so its replay ring is never written to.
            return reserve(self._turns, thread_id, "prune", ring_size=1)
        except TurnBusy:
            return None

    # ── writes: the ONE validated path ────────────────────────────────────────────────────────────

    def resolve_agent_strict(self, name: str | None) -> AgentDef:
        """The automation's `AgentDef`. `None` → the configured default, resolved dynamically (so the
        owner changing their default agent changes what a default-agent automation runs as). A NAME must
        exist: `Settings.load_agent` returns `None` for a missing folder, and that is a refusal here —
        NOT `resolve_agent`, whose chat-friendly fallback is precisely what must not happen."""
        if name is None:
            return self._settings.resolve_agent(None)
        agent = self._settings.load_agent(name)
        if agent is None:
            raise AutomationAgentMissing(name)
        return agent

    def _validated(self, draft: AutomationDraft) -> tuple[str, str]:
        """Every cross-field write rule, in one place: the cron parses AND fires, the zone loads on THIS
        host, and a named agent exists. Returns the normalized `(schedule, tz)` to store."""
        try:
            schedule = validate_cron(draft.schedule)
        except ScheduleError as exc:
            raise AutomationInvalid("schedule", str(exc)) from exc
        try:
            tz = resolve_tz(draft.tz)
        except ScheduleError as exc:
            raise AutomationInvalid("tz", str(exc)) from exc
        if draft.agent is not None:
            try:
                self.resolve_agent_strict(draft.agent)
            except AutomationAgentMissing as exc:
                raise AutomationInvalid("agent", str(exc)) from exc
        return schedule, tz

    async def create(self, draft: AutomationDraft) -> Automation:
        """Validate, cap-check and insert — the count and the INSERT in ONE transaction, so two
        concurrent creates (the owner's form and the agent's tool) cannot both pass a cap with one slot
        left (§D-1 TOCTOU-closed)."""
        schedule, tz = self._validated(draft)
        now = _now()
        automation = Automation(
            name=draft.name.strip(),
            schedule=schedule,
            tz=tz,
            prompt=draft.prompt,
            enabled=draft.enabled,
            agent=draft.agent,
            privilege=draft.privilege,
            question_policy=draft.question_policy,
            thread_mode=draft.thread_mode,
            timeout_s=draft.timeout_s,
            # A create computes a FUTURE first fire (never "now"), and only when it is enabled.
            next_run_at=self._next(schedule, tz, after=now) if draft.enabled else None,
            created_at=now,
            updated_at=now,
        )
        cap = self.cfg.max_count
        async with self._repo.db.transaction():
            if await self._repo.count() >= cap:
                raise AutomationCapReached(f"the automation limit ({cap}) is reached — delete one first")
            await self._repo.create(automation)
        log.info(
            "automation %s (%s) created — next run %s", automation.id, automation.name, automation.next_run_at
        )
        return automation

    async def update(self, automation_id: str, draft: AutomationDraft) -> Automation:
        """Replace a definition (full-body PUT semantics) and bump `rev` — which is what invalidates any
        claim already in flight for the old shape.

        `next_run_at` is recomputed when the answer could have changed: an enable, a schedule/tz edit, or
        a row that somehow held none. An unchanged schedule keeps its pending slot, so editing the prompt
        does not push the next run back.

        A `thread_mode` CHANGE additionally takes the row's thread marker (wave 2), and is refused while a
        turn is live there. `fresh ↔ rolling` is what decides whether the interactive endpoints refuse a
        thread at all, so flipping it under a turn that already passed the guard would leave that turn
        writing into a conversation the automation now owns (or, the other way, leave the guard armed for
        a thread nothing owns any more). Ownership therefore only ever changes while the thread is idle,
        and — like every other marker here — it is held past COMMIT."""
        schedule, tz = self._validated(draft)
        now = _now()
        markers: list[TurnHandle] = []
        try:
            return await self._update(
                automation_id, draft, schedule=schedule, tz=tz, now=now, markers=markers
            )
        finally:
            for marker in markers:
                release(self._turns, marker)

    async def _update(
        self,
        automation_id: str,
        draft: AutomationDraft,
        *,
        schedule: str,
        tz: str,
        now: datetime,
        markers: list[TurnHandle],
    ) -> Automation:
        """`update`'s transactional body. Split out ONLY so the marker release can be ordered after the
        transaction context exits (see `prune_runs` for why that ordering is load-bearing)."""
        async with self._repo.db.transaction():
            current = await self._repo.get(automation_id)
            if current is None:
                raise AutomationNotFound(f"no automation {automation_id!r}")
            if draft.thread_mode != current.thread_mode and current.thread_id:
                marker = self._claim_thread(current.thread_id)
                if marker is None:
                    raise AutomationBusy(
                        f"a turn is running in {current.name!r}'s thread — wait for it, then change how "
                        "its results are stored"
                    )
                markers.append(marker)
            recompute = (
                schedule != current.schedule
                or tz != current.tz
                or (draft.enabled and not current.enabled)
                or current.next_run_at is None
            )
            if not draft.enabled:
                next_at = None  # disabled rows are never claimed
            elif recompute:
                next_at = self._next(schedule, tz, after=now)
            else:
                next_at = current.next_run_at
            updated = current.model_copy(
                update={
                    "name": draft.name.strip(),
                    "schedule": schedule,
                    "tz": tz,
                    "prompt": draft.prompt,
                    "enabled": draft.enabled,
                    "agent": draft.agent,
                    "privilege": draft.privilege,
                    "question_policy": draft.question_policy,
                    # `thread_id` is intentionally NOT cleared on a mode change: switching to `fresh`
                    # leaves the old rolling conversation intact (archived, still readable), and switching
                    # back resumes it. `rolling_owner` filters on the MODE, so a fresh automation's stale
                    # thread_id never keeps the chat guard armed.
                    "thread_mode": draft.thread_mode,
                    "timeout_s": draft.timeout_s,
                    "next_run_at": next_at,
                    "rev": current.rev + 1,
                    "updated_at": now,
                }
            )
            await self._repo.update(updated)
        return updated

    async def set_enabled(self, automation_id: str, enabled: bool) -> Automation:
        """The list's enable switch — a definition change like any other (`rev` bumps), and the ONE place
        the two halves of the invariant meet: enabling computes a strictly-future slot from *now*,
        disabling nulls it so nothing can claim the row."""
        now = _now()
        async with self._repo.db.transaction():
            current = await self._repo.get(automation_id)
            if current is None:
                raise AutomationNotFound(f"no automation {automation_id!r}")
            try:
                next_at = self._next(current.schedule, current.tz, after=now) if enabled else None
            except ScheduleError as exc:
                # A stored schedule this build cannot use (written looser, or a zone dropped from the
                # host). Refuse the ENABLE with the field named rather than 500ing or arming a row whose
                # every poll would fail: the owner fixes the schedule, which re-validates on save.
                raise AutomationInvalid("schedule", str(exc)) from exc
            updated = current.model_copy(
                update={
                    "enabled": enabled,
                    "next_run_at": next_at,
                    "rev": current.rev + 1,
                    "updated_at": now,
                }
            )
            await self._repo.update(updated)
        return updated

    async def delete(self, automation_id: str) -> None:
        """Delete a definition, its run history and the threads that history owned (§D-1). Refuses while
        a run is active — that run's finalizer still has a row to close and a thread to point at — or
        while any of those threads has a live turn of its own.

        **Everything happens inside ONE `BEGIN IMMEDIATE` transaction** (post-14b review, HIGH): the
        re-read, the active-run check, the ownership enumeration and the deletes. Read outside it, the
        active-run guarantee was a TOCTOU hole — a tick or a run-now could commit a `running` row in the
        window between the check and the delete, and the delete would then cascade that row away while
        its claimed snapshot happily ran on against an automation the owner had already deleted. Since
        the claim takes the same write lock, one transaction makes claim-vs-delete decide atomically:
        whichever commits first, the other sees the settled world (no row to claim / an active run to
        refuse for).

        Events are deliberately NOT touched: the audit trail is append-only, and a dangling `run_id` in
        it is explicit and acceptable (§D-1)."""
        markers: list[TurnHandle] = []
        try:
            async with self._repo.db.transaction():
                current = await self._repo.get(automation_id)
                if current is None:
                    raise AutomationNotFound(f"no automation {automation_id!r}")
                if await self._repo.open_runs(automation_id):
                    raise AutomationBusy(
                        f"a run of {current.name!r} is active — stop or wait for it, then delete"
                    )
                runs = await self._repo.runs(automation_id, limit=100_000)
                thread_ids = {r.thread_id for r in runs if r.thread_id}
                if current.thread_id:
                    thread_ids.add(current.thread_id)
                # Take every owned thread's marker BEFORE deleting anything. A live turn on ANY of them
                # (the owner continuing an old fresh-run thread in chat) refuses the whole delete rather
                # than deleting some threads and leaving the definition — the same busy answer the
                # active-run guard gives, so the owner's remedy is identical.
                for thread_id in sorted(thread_ids):
                    marker = self._claim_thread(thread_id)
                    if marker is None:
                        raise AutomationBusy(
                            f"a turn is running in one of {current.name!r}'s threads — wait for it, "
                            "then delete"
                        )
                    markers.append(marker)
                await self._repo.delete(automation_id)  # run rows go with it (FK cascade)
                for thread_id in thread_ids:
                    await self._threads.delete(thread_id)
        finally:
            for marker in markers:
                release(self._turns, marker)

    # ── the claim ─────────────────────────────────────────────────────────────────────────────────

    async def claim(
        self,
        automation_id: str,
        *,
        trigger: RunTrigger = "scheduled",
        expected_rev: int | None = None,
        now: datetime | None = None,
    ) -> AutomationSnapshot | None:
        """Atomically take ownership of one run, or decline. `None` means "nothing to run" — the row
        vanished, was disabled, was edited since the scan (`expected_rev`), is not due yet, or its slot
        was too late and a `missed` row was recorded instead. A snapshot means the caller now OWNS a
        `running` row it MUST terminalize.

        One `BEGIN IMMEDIATE` transaction covers the re-read, the `next_run_at` advance and the run
        insert, so a second claimer (a run-now racing the loop) cannot see the same due slot: whoever
        commits first has already moved it. Nothing here spawns a task or touches the agent.
        """
        moment = now or _now()
        grace = self.cfg.misfire_grace_s
        async with self._repo.db.transaction():
            row = await self._repo.get(automation_id)
            if row is None:
                return None
            scheduled_for: datetime | None = None
            if trigger == "scheduled":
                if not row.enabled:
                    return None
                if expected_rev is not None and row.rev != expected_rev:
                    return None  # edited between the scan and here — let the next poll re-read it
                if row.next_run_at is None or row.next_run_at > moment:
                    return None  # not due (a run-now already consumed it, or the clock moved back)
                scheduled_for = row.next_run_at
                advanced = await self._advance(row, after=moment, slot=scheduled_for, trigger=trigger)
                if not advanced:
                    return None  # unusable schedule — recorded + disarmed inside `_advance`
                late = (moment - scheduled_for).total_seconds()
                if late > grace:
                    # Skip-misfire (owner ruling 3): record the truth and do NOT invoke.
                    await self._repo.add_run(
                        AutomationRun(
                            automation_id=row.id,
                            trigger=trigger,
                            scheduled_for=scheduled_for,
                            started_at=moment,
                            finished_at=moment,
                            status="missed",
                            error=(
                                f"slot missed by {int(late)}s (misfire grace {grace}s) — skipped to the "
                                "next scheduled run rather than firing late"
                            ),
                        )
                    )
                    log.info("automation %s missed its %s slot by %ds", row.id, scheduled_for, int(late))
                    return None
            else:
                # Run-now (14c). It consumes a slot that is ALREADY due — so pressing the button at the
                # moment the loop would have fired doesn't run the automation twice — and otherwise
                # leaves the schedule completely untouched (§D-2).
                if row.enabled and row.next_run_at is not None and row.next_run_at <= moment:
                    scheduled_for = row.next_run_at
                    await self._advance(row, after=moment, slot=scheduled_for, trigger=trigger)
            run = AutomationRun(
                automation_id=row.id,
                trigger=trigger,
                scheduled_for=scheduled_for,
                started_at=moment,
                status="running",
            )
            await self._repo.add_run(run)
            return self._snapshot(row, run)

    async def _advance(
        self, row: Automation, *, after: datetime, slot: datetime | None, trigger: RunTrigger
    ) -> bool:
        """Move `next_run_at` to the next fire computed from `after` (never from the missed slot — that
        is how a backlog resolves to ONE next run instead of a queue of late ones).

        Returns False for a row whose schedule this build cannot use at all (a looser build wrote it, or
        a zone was removed from the host): the row is DISARMED (`next_run_at = NULL`) and an `error` run
        is recorded, so the loop reports the problem once instead of re-failing every poll."""
        try:
            await self._repo.set_next_run(row.id, self._next(row.schedule, row.tz, after=after))
        except ScheduleError as exc:
            await self._repo.set_next_run(row.id, None)
            await self._repo.add_run(
                AutomationRun(
                    automation_id=row.id,
                    trigger=trigger,
                    scheduled_for=slot,
                    started_at=after,
                    finished_at=after,
                    status="error",
                    error=f"unusable schedule — automation disabled itself: {exc}",
                )
            )
            log.error("automation %s has an unusable schedule (%s) — disarmed", row.id, exc)
            return False
        return True

    def _next(self, schedule: str, tz: str, *, after: datetime) -> datetime:
        return next_fire(schedule, tz, after=after)

    def _snapshot(self, row: Automation, run: AutomationRun) -> AutomationSnapshot:
        """Freeze the definition as claimed. `timeout_s` is resolved HERE against the config default, so
        the runner never has to re-consult settings mid-run and a Conf edit cannot shorten a deadline a
        run is already counting against."""
        return AutomationSnapshot(
            run_id=run.id,
            automation_id=row.id,
            name=row.name,
            rev=row.rev,
            trigger=run.trigger,
            scheduled_for=run.scheduled_for,
            tz=row.tz,
            prompt=row.prompt,
            agent=row.agent,
            privilege=row.privilege,
            question_policy=row.question_policy,
            thread_mode=row.thread_mode,
            thread_id=row.thread_id,
            timeout_s=row.timeout_s or self.cfg.default_timeout_s,
        )

    # ── housekeeping ──────────────────────────────────────────────────────────────────────────────

    async def sweep_orphans(self) -> int:
        """Turn every `running` row left by a dead process into `interrupted`, with an Event (§D-2).

        Safe to do wholesale at boot precisely because there cannot be a live run yet — the runner loop
        is started only AFTER this (the same reasoning as the stale-call reconcile it runs beside). An
        orphan is the one status a reader must never see as still-running: it would make the automation
        look permanently busy and block run-now and delete forever.
        """
        orphans = await self._repo.open_runs()
        moment = _now()
        for run in orphans:
            await self._repo.finish_run(run.id, status="interrupted", finished_at=moment, error=ORPHAN_NOTE)
            automation = await self._repo.get(run.automation_id)
            await self.record_run_event(
                automation_id=run.automation_id,
                run_id=run.id,
                name=automation.name if automation else run.automation_id,
                status=RunState.CANCELLED,
                summary=f"automation run interrupted — {ORPHAN_NOTE}",
            )
        if orphans:
            log.warning("marked %d orphaned automation run(s) interrupted at boot", len(orphans))
        return len(orphans)

    async def prune_runs(self, automation_id: str) -> int:
        """Retention (§D-1): drop run rows beyond `keep_runs` and the per-run threads they owned.

        Three rows are never pruned's business: a still-`running` run (its finalizer owns it), the
        automation's OWN thread — a rolling automation's runs all point at that one thread, and deleting
        it would destroy the accumulating conversation the mode exists for — and a run whose thread has a
        LIVE TURN (post-14b review, HIGH). The last one is the one that bites: a fresh run's thread is
        explicitly continuable in chat, so retention firing while the owner is talking in an old one would
        cascade its messages out from under the running drain task. That run is SKIPPED WHOLE (row and
        thread together, so the thread can never be orphaned by a half-prune) and prunes on a later cycle.

        Every marker taken here is held until AFTER the transaction has COMMITTED (wave 2): releasing
        inside the block — as the first version did — leaves a window in which the delete is not yet
        visible to any reader but the thread is already reservable, so a chat POST could take the marker
        and start a turn on a row that is about to vanish. The `finally` is deliberately ordered outside
        the `async with`, which is what makes "held past commit" a property of the code shape rather than
        of where the loop happens to end.
        """
        automation = await self._repo.get(automation_id)
        if automation is None:
            return 0
        excess = await self._repo.excess_runs(automation_id, self.cfg.keep_runs)
        if not excess:
            return 0
        pruned = 0
        skipped = 0
        markers: list[TurnHandle] = []
        try:
            async with self._repo.db.transaction():
                for run in excess:
                    if not run.terminal:
                        continue  # a live run is not history yet — its finalizer still owns the row
                    # The run's OWN thread (a rolling automation's shared one is never pruned's business).
                    own_thread = (
                        run.thread_id if run.thread_id and run.thread_id != automation.thread_id else None
                    )
                    marker = self._claim_thread(own_thread) if own_thread else None
                    if own_thread and marker is None:
                        skipped += 1
                        continue  # a live turn owns it — leave the pair alone until the next cycle
                    if marker is not None:
                        markers.append(marker)
                    await self._repo.delete_run(run.id)
                    pruned += 1
                    if own_thread is not None:
                        await self._threads.delete(own_thread)
        finally:
            for marker in markers:
                release(self._turns, marker)
        if pruned or skipped:
            log.debug(
                "pruned %d run(s) of automation %s (%d skipped: live thread)",
                pruned,
                automation_id,
                skipped,
            )
        return pruned

    async def record_run_event(
        self,
        *,
        automation_id: str,
        run_id: str,
        name: str,
        status: RunState,
        summary: str,
    ) -> None:
        """One audit row for something that happened to a RUN itself (not to a tool it invoked, which
        the gate already records). `actor=AUTOMATION` is exactly the semantics D-4 reserves for it: acts
        of the automation machinery, while the run's tool calls stay `AGENT`. Best-effort — a failed
        audit write must never be the reason a run is left unterminalized."""
        try:
            await self._events.record(
                Event(
                    actor=Actor.AUTOMATION,
                    action="automation_run",
                    target=automation_id,
                    status=status,
                    summary=f"{name}: {summary}",
                    origin="automation",
                    origin_id=automation_id,
                    run_id=run_id,
                )
            )
        except Exception:  # noqa: BLE001 — audit is not allowed to break the run lifecycle
            log.exception("failed to record the automation-run event for run %s", run_id)

    async def finish_run(
        self,
        run_id: str,
        *,
        status: RunStatus,
        error: str | None = None,
        thread_id: str | None = None,
    ) -> None:
        """Terminalize a claimed run. Thin on purpose — the runner's shielded finalizer is the only
        caller, and it must be able to say "close this row" in one await."""
        await self._repo.finish_run(
            run_id, status=status, finished_at=_now(), error=error, thread_id=thread_id
        )
