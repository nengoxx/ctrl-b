"""AutomationRunner — the poll-and-claim loop and the runs it drives (A3, §D-2).

One lifespan loop, the `_memory_sweep` shape (interval re-read live, blanket exception guard, cancelled
and awaited at shutdown), started only AFTER both boot sweeps. Per tick it scans for due automations and
executes them **sequentially**, and each execution rides the EXISTING turn machinery rather than around
it: `reserve(kind="automation")` → `_build_session` → `_spawn_drain_task` → await the handle's task. That
is the `start_steer_turn` precedent (a turn nobody requested, driven through the sanctioned path), and it
is what buys cancellation through the ONE `cancel_turn`, visibility to `max_active_turns`, live
watch/re-attach from the chat UI, and one turn-marker lifecycle instead of two.

Three properties are load-bearing and easy to break:

* **Concurrency 1, globally** (owner ruling 2). ONE `asyncio.Lock` — the arbiter — is held across a whole
  tick, and run-now takes the SAME lock. It is exposed (`arbiter`/`busy`), never buried, because 14c's
  run-now endpoint must be able to refuse with 409 instead of inventing a second gauge.
* **Every claimed run is terminalized.** A claim writes a `running` row that only this class can close, so
  the finalizer runs inside a shield that survives a raw task cancel (the `Database._shielded_rollback`
  shape). A `running` row that outlives the process is a real state, and the boot sweep — not luck — is
  what resolves it.
* **Honest terminals** (§D-2). `ok` only for a completed turn; `timed_out` only when THIS runner fired
  the deadline cancel; `interrupted` when something else cut the run off, because then the tools it had
  already invoked really did run and the summary must not claim otherwise.
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Coroutine
from datetime import datetime, timezone
from typing import TYPE_CHECKING, Any
from zoneinfo import ZoneInfo

import anyio

from app.domain.automation import AutomationRun, AutomationSnapshot, RunStatus
from app.domain.conversation import Thread
from app.domain.enums import RunState
from app.services.agent.turns import TurnBusy, active_task_turns, cancel_turn, reserve
from app.services.automations.service import (
    AutomationAgentMissing,
    AutomationBusy,
    AutomationNotFound,
    AutomationService,
)

if TYPE_CHECKING:
    from fastapi import FastAPI

log = logging.getLogger(__name__)

#: The note on a run something else cut off (shutdown, an owner Stop from the chat UI). Deliberately
#: says the effects may be unknown: the run's completed tool calls DID happen (§D-2).
INTERRUPTED_NOTE = (
    "the run was interrupted before it finished — any tools it had already called did run, "
    "so its external effects may be incomplete"
)


def _now() -> datetime:
    return datetime.now(timezone.utc)


async def _shielded(coro: Coroutine[Any, Any, None]) -> None:
    """Run a finalizer to completion even when the awaiting task is cancelled **raw**.

    Same mechanism, and the same reason, as `Database._shielded_rollback`: a plain
    `anyio.CancelScope(shield=True)` does not reliably suppress a bare `asyncio.Task.cancel()` (anyio
    cannot attribute it to a scope it owns, so it re-raises mid-await), and the lifespan cancels this
    loop exactly that way. Running the write as its OWN task makes it genuinely uncancellable by the
    outer cancel; `await asyncio.shield(...)` propagates the cancel to US while it continues, and the
    second `await` guarantees it FINISHED before the cancel propagates further (so it is never a
    detached task, and the DB is still open — the lifespan cancels this loop before closing it).

    The write itself never raises out of here: a failing terminalize must not replace the cancel that is
    unwinding the loop, and it is logged where an operator will find it.
    """
    task = asyncio.ensure_future(coro)
    with anyio.CancelScope(shield=True):
        try:
            await asyncio.shield(task)
        except asyncio.CancelledError:
            await task  # uncancellable by the outer cancel — let it land, then propagate
            raise


class AutomationRunner:
    """Owns the loop, the arbiter, and one run at a time. Constructed in the lifespan after the
    orphan sweep; `loop()` is the task, `tick()`/`run_now()` are the two entry points."""

    def __init__(self, app: "FastAPI", service: AutomationService) -> None:
        self._app = app
        self._service = service
        #: THE global concurrency-1 arbiter (owner ruling 2). One lock, two entry points: the poll tick
        #: holds it for the whole tick, run-now takes it for its single run. `asyncio.Lock.acquire()` on
        #: an uncontended lock completes without yielding, so a `locked()` check immediately followed by
        #: `async with` is atomic under the single-threaded loop (the `reserve()` discipline).
        self._arbiter = asyncio.Lock()
        #: The snapshot of the run currently executing, for diagnostics + 14c's status reads.
        self._active: AutomationSnapshot | None = None

    @property
    def arbiter(self) -> asyncio.Lock:
        """The shared arbiter — exposed so a second entry point (run-now) uses THIS lock and never a
        parallel busy flag."""
        return self._arbiter

    @property
    def busy(self) -> bool:
        return self._arbiter.locked()

    @property
    def active(self) -> AutomationSnapshot | None:
        return self._active

    # ── the loop ──────────────────────────────────────────────────────────────────────────────────

    async def loop(self) -> None:
        """Poll forever (the `_memory_sweep` pattern). `poll_seconds` and `enabled` are BOTH re-read per
        iteration, so a Conf edit applies with no restart — including turning the whole feature off,
        which leaves the loop idling rather than requiring one. Every failure is logged and swallowed:
        a poll loop that dies takes the feature down until the next restart."""
        while True:
            cfg = self._service.cfg
            await asyncio.sleep(max(1, cfg.poll_seconds))
            if not self._service.cfg.enabled:
                continue
            if getattr(self._app.state, "shutting_down", False):
                continue  # a run started now would race the drain snapshot into a closing DB
            try:
                await self.tick()
            except Exception:  # noqa: BLE001 — the sweep must never die
                log.exception("automation poll tick failed")

    async def tick(self) -> int:
        """One poll: claim and run everything due, oldest slot first. Returns how many runs executed.

        Returns 0 immediately when the arbiter is held — a long run (or a run-now) IS the reason not to
        start another (concurrency 1). The due slots stay due; whether they still deserve to run when the
        runner frees up is `misfire_grace_s`'s decision, made inside the claim, not here.
        """
        if self._arbiter.locked():
            return 0
        ran = 0
        async with self._arbiter:
            due = await self._service.repo.due(_now())
            for row in due:
                if getattr(self._app.state, "shutting_down", False):
                    break
                # `expected_rev` is the scan's view: an edit that landed since invalidates this claim
                # (the next poll re-reads the new definition). `now` is taken fresh INSIDE the claim, so
                # lateness is measured against the real clock even after a long preceding run.
                snapshot = await self._service.claim(row.id, trigger="scheduled", expected_rev=row.rev)
                if snapshot is None:
                    continue  # not due / disabled / edited / missed-beyond-grace (recorded in the claim)
                await self._execute(snapshot)
                ran += 1
                await self._service.prune_runs(row.id)  # retention, in the same loop (§D-1)
        return ran

    async def run_now(self, automation_id: str) -> AutomationRun | None:
        """Run one automation immediately (14c's run-now, and the arbiter's second citizen).

        Refuses with `AutomationBusy` while ANY run is active — 409 "runner busy" — rather than queueing:
        concurrency 1 is a global property, so the honest answer is "not now". A currently-due slot is
        consumed atomically by the claim, so pressing the button exactly when the loop would have fired
        cannot double-run; otherwise the schedule is untouched.
        """
        if self._arbiter.locked():
            raise AutomationBusy("the automation runner is busy with another run — try again shortly")
        async with self._arbiter:
            snapshot = await self._service.claim(automation_id, trigger="manual")
            if snapshot is None:
                raise AutomationNotFound(f"no automation {automation_id!r}")
            await self._execute(snapshot)
            await self._service.prune_runs(automation_id)
            return await self._service.repo.get_run(snapshot.run_id)

    # ── one run ───────────────────────────────────────────────────────────────────────────────────

    async def _execute(self, snapshot: AutomationSnapshot) -> RunStatus:
        """Drive one claimed run to a terminal status. Never raises except `CancelledError` (which must
        still unwind the loop) — and even then the run is terminalized first, in the shielded finalizer.

        The strict agent check runs FIRST, before a thread is created: a run that cannot legitimately
        start should not leave a thread behind, and the refusal is the same one the write path gives.
        """
        status: RunStatus = "error"
        error: str | None = None
        thread_id: str | None = None
        self._active = snapshot
        try:
            self._service.resolve_agent_strict(snapshot.agent)  # fail fast, before any state is created
            thread = await self._resolve_thread(snapshot)
            thread_id = thread.id
            await self._service.repo.set_run_thread(snapshot.run_id, thread.id)
            status, error = await self._drive(snapshot, thread)
        except AutomationAgentMissing as exc:
            status, error = "error", str(exc)
            log.error("automation %s: %s", snapshot.automation_id, exc)
        except asyncio.CancelledError:
            status, error = "interrupted", INTERRUPTED_NOTE
            raise
        except Exception as exc:  # noqa: BLE001 — one bad run must not kill the runner
            log.exception("automation run %s failed", snapshot.run_id)
            status, error = "error", f"{type(exc).__name__}: {exc}"[:500]
        finally:
            self._active = None
            await _shielded(self._finalize(snapshot, status=status, error=error, thread_id=thread_id))
        return status

    async def _resolve_thread(self, snapshot: AutomationSnapshot) -> Thread:
        """The run's conversation (owner ruling 4). `fresh` → a new archived thread stamped with the
        automation's name and the moment, in the automation's OWN zone (a title is read by a human, and
        UTC is not where they live). `rolling` → the automation's thread, created lazily on the first run
        and RECREATED if the owner deleted it: a deleted thread must not brick the automation. The run
        row records whichever thread was used, so the recreation is visible in the history.

        Archived like a subagent's thread: these are not conversations the owner started, so they stay out
        of the thread list until the history opens one.
        """
        threads = self._app.state.threads
        if snapshot.rolling:
            if snapshot.thread_id:
                existing = await threads.get(snapshot.thread_id)
                if existing is not None:
                    return existing
                log.info(
                    "automation %s: rolling thread %s is gone — creating a new one",
                    snapshot.automation_id,
                    snapshot.thread_id,
                )
            thread = Thread(title=f"[automation] {snapshot.name}", agent=snapshot.agent, archived=True)
            await threads.create(thread)
            await self._service.repo.set_thread(snapshot.automation_id, thread.id)
            return thread
        stamp = _now().astimezone(ZoneInfo(snapshot.tz)).strftime("%Y-%m-%d %H:%M")
        thread = Thread(title=f"[automation] {snapshot.name} · {stamp}", agent=snapshot.agent, archived=True)
        await threads.create(thread)
        return thread

    async def _drive(self, snapshot: AutomationSnapshot, thread: Thread) -> tuple[RunStatus, str | None]:
        """Run the turn through the sanctioned machinery and map its terminal to a run status.

        The imports are local: `app.api.agent` owns the ONE session builder and the ONE drain-task spawn,
        and a module-level import here would make `services` depend on `api` at load time (turns.py's
        `_agent_event` uses the same escape). Reusing them is the point — a private automation copy of
        the spawn would be a second turn lifecycle to keep in sync.
        """
        from app.api.agent import _build_session, _spawn_drain_task

        state = self._app.state
        cfg = state.settings.agent.turns
        # ── No `await` from here to `_spawn_drain_task` ─────────────────────────────────────────────
        # The strict agent re-check, the cap read, the marker reserve and the session build are one
        # synchronous block, so under the single-threaded loop nothing can change underneath them: the
        # agent this run was authorized for is the agent the session is built with (`_build_session`'s
        # own resolver is deliberately FORGIVING for chat — it would substitute the default agent), and
        # the cap check cannot be overtaken between read and reserve (the D38/D39 TOCTOU discipline).
        self._service.resolve_agent_strict(snapshot.agent)
        if active_task_turns(state.turns) >= cfg.max_active_turns:
            return "error", (
                f"the server was already running its maximum of {cfg.max_active_turns} turns "
                "(agent.turns.max_active_turns) — the run was not started"
            )
        try:
            handle = reserve(state.turns, thread.id, "automation", ring_size=cfg.ring_size)
        except TurnBusy as exc:
            return "error", (
                f"the run thread is busy with turn {exc.handle.turn_id} ({exc.handle.kind}) — "
                "the run was not started"
            )
        session = _build_session(
            state, thread, agent_name=snapshot.agent, privilege=snapshot.privilege, automation=snapshot
        )
        events = session.run_turn(thread, snapshot.prompt)
        task = _spawn_drain_task(state, thread, events, handle, cfg)
        # ───────────────────────────────────────────────────────────────────────────────────────────
        timed_out = False
        try:
            # `asyncio.wait` (not `await task`) deliberately: it never re-raises the awaited task's
            # exception or cancellation, so the drain task stays the ONE owner of the turn's outcome and
            # this await is purely a rendezvous. Shutdown cancels US, never the task directly.
            await asyncio.wait([task], timeout=snapshot.timeout_s)
            if not task.done():
                # Deadline: cancel through the ONE sanctioned path (`cancel_turn` — a raw task cancel
                # would pierce the drain's persistence shield, D39 H2) and WAIT for the reconcile the
                # cancel path performs, so the thread's in-flight calls are settled before we report.
                timed_out = True
                cancel_turn(handle)
                await asyncio.wait([task], timeout=cfg.shutdown_grace_s)
        except asyncio.CancelledError:
            # Our own await was cancelled (shutdown, or a Stop of the runner). Route the turn through the
            # same single cancel and let it settle under a shield, so its persistence completes while the
            # DB is still open; then re-raise so the loop unwinds. `_execute`'s finally still terminalizes
            # the run as `interrupted`.
            cancel_turn(handle)
            with anyio.CancelScope(shield=True):
                await asyncio.wait([task], timeout=cfg.shutdown_grace_s)
            raise
        return self._terminal(snapshot, handle.terminal_status, timed_out=timed_out)

    def _terminal(
        self, snapshot: AutomationSnapshot, terminal_status: str | None, *, timed_out: bool
    ) -> tuple[RunStatus, str | None]:
        """Map the turn's terminal to the run's status (§D-2 "honest terminals"). Pure → unit testable.

        `timed_out` outranks the terminal string because both a deadline cancel and a shutdown cancel end
        the turn `cancelled`: only the runner knows which one it fired, and conflating them would report a
        run the owner stopped as a timeout (or worse, a timeout as a clean shutdown).
        """
        if timed_out:
            return "timed_out", (
                f"exceeded its {snapshot.timeout_s}s timeout — the turn was cancelled; tools it had "
                "already called did run"
            )
        if terminal_status == "completed":
            return "ok", None
        if terminal_status == "capped":
            return "error", "the run hit the agent's iteration cap before finishing"
        if terminal_status == "cancelled":
            return "interrupted", INTERRUPTED_NOTE
        if terminal_status == "suspended":
            # An unattended session cannot suspend: confirms deny in place and questions resolve through
            # `question_policy` (§D-3). Reaching this means the headless degradations were bypassed, which
            # is a bug worth an ERROR log and a run that says so rather than a quietly "ok" one.
            log.error(
                "invariant: automation run %s ended SUSPENDED — an unattended turn has no owner to resolve it",
                snapshot.run_id,
            )
            return "error", (
                "invariant violated: the run suspended waiting for the owner, which an unattended run "
                "cannot do — nothing resolved it"
            )
        if terminal_status == "error":
            return "error", "the turn failed — open the run thread for the error"
        return "error", f"the turn ended in an unrecognized state {terminal_status!r}"

    async def _finalize(
        self,
        snapshot: AutomationSnapshot,
        *,
        status: RunStatus,
        error: str | None,
        thread_id: str | None,
    ) -> None:
        """Close the claimed run row (and audit an interrupted one). Runs inside `_shielded`, so it must
        swallow its own failures: whatever brought us here — a cancel, an exception — is the story, and a
        raise from the finalizer would replace it."""
        try:
            await self._service.finish_run(snapshot.run_id, status=status, error=error, thread_id=thread_id)
            if status == "interrupted":
                # The one terminal that gets its own audit row (§D-2): the owner needs to be able to see
                # that a run was cut off mid-flight without opening the run history.
                await self._service.record_run_event(
                    automation_id=snapshot.automation_id,
                    run_id=snapshot.run_id,
                    name=snapshot.name,
                    status=RunState.CANCELLED,
                    summary=error or INTERRUPTED_NOTE,
                )
        except Exception:  # noqa: BLE001 — never replace the outcome we are here to record
            log.exception("failed to terminalize automation run %s", snapshot.run_id)
