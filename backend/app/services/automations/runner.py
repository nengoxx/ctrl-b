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
import contextlib
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

#: How a terminal run reads on its audit row (§D-2 "honest terminals" → `RunState`). Every terminal
#: gets an Event, not just `interrupted` (14d): the live feed is what tells an open client a DETACHED
#: run finished — the F1 `automation_done` notification and the Conf list's invalidation both hang off
#: this frame, and a run-now that answered 202 has no other completion signal at all. `missed` is in
#: the map for totality only — it is written by the claim, which never reaches the finalizer, and
#: deliberately gets no Event: recording one would mean an EventBus publish from INSIDE the claim's
#: `BEGIN IMMEDIATE` transaction, i.e. telling every client to re-read a row that has not committed.
RUN_TERMINAL_STATES: dict[RunStatus, RunState] = {
    "ok": RunState.OK,
    "error": RunState.ERROR,
    "timed_out": RunState.TIMEOUT,
    "interrupted": RunState.CANCELLED,
    "missed": RunState.SKIPPED,
}

#: What a run that ended cleanly says on its audit row. The failing terminals carry `_terminal`'s own
#: explanation instead (it is always set for them).
COMPLETED_NOTE = "the run completed"


def _now() -> datetime:
    return datetime.now(timezone.utc)


async def _shielded(coro: Coroutine[Any, Any, None]) -> None:
    """Run a finalizer to completion even when the awaiting task is cancelled **raw**.

    Same mechanism, and the same reason, as `Database._shielded_rollback`: a plain
    `anyio.CancelScope(shield=True)` does not reliably suppress a bare `asyncio.Task.cancel()` (anyio
    cannot attribute it to a scope it owns, so it re-raises mid-await), and the lifespan cancels this
    loop exactly that way. Running the write as its OWN task makes it genuinely uncancellable by the
    outer cancel, and awaiting it to `done()` guarantees it FINISHED before the cancel propagates
    further — so it is never a detached task, and the DB is still open (the lifespan cancels this loop
    before closing it).

    **Every wait here consumes cancels; there is no bare `await task`** (micro-wave). The shape this
    replaces re-awaited the task ONCE, which survives exactly one further cancel: a second raw
    `cancel()` landing during that await propagated straight out, abandoning a half-written
    terminalization and leaving the run row `running` until the next boot's orphan sweep. Repeated raw
    cancellation is not exotic here — it is what a Stop racing a shutdown, or any caller that cancels
    more than once, actually looks like. The loop terminates because each `cancel()` is delivered at
    most once, and `asyncio.wait` never re-raises the TASK's own outcome, so the result is read off the
    settled task instead of an exception path.

    The write itself never raises out of here: a failing terminalize must not replace the cancel that is
    unwinding the loop, and it is logged where an operator will find it. A cancel that WAS consumed is
    re-raised at the end, so a caller that was not already unwinding still learns it was cancelled.
    """
    task = asyncio.ensure_future(coro)
    cancelled = False
    with anyio.CancelScope(shield=True):
        while not task.done():
            try:
                await asyncio.wait([task])
            except asyncio.CancelledError:
                cancelled = True  # consumed: the task is uncancellable by it — keep draining
        if not task.cancelled():  # nothing cancels the finalizer task itself — belt, not braces
            failure = task.exception()
            if failure is not None:
                log.error("a shielded finalizer failed: %r", failure)
    if cancelled:
        raise asyncio.CancelledError


class AutomationRunner:
    """Owns the loop, the arbiter, and one run at a time. Constructed in the lifespan after the
    orphan sweep; `loop()` is the task, `tick()`/`start_now()` are the two entry points (`run_now()` is
    `start_now` awaited), and `shutdown()` drains a detached manual run."""

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
        #: The DETACHED run-now task (14c). At most one exists at a time — the arbiter guarantees it —
        #: and the lifespan drains it through `shutdown()`, exactly as it cancels the poll loop: a
        #: manual run is the one execution that does not live on `loop()`'s task, so without this its
        #: shielded finalizer could still be writing when the DB closes.
        self._manual: asyncio.Task[None] | None = None

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
                snapshot = await self._claim(row.id, trigger="scheduled", expected_rev=row.rev)
                if snapshot is None:
                    continue  # not due / disabled / edited / missed-beyond-grace (recorded in the claim)
                await self._execute(snapshot)
                ran += 1
                await self._service.prune_runs(row.id)  # retention, in the same loop (§D-1)
        return ran

    async def start_now(self, automation_id: str) -> AutomationRun:
        """Claim one manual run and execute it DETACHED — 14c's run-now endpoint (§D-6).

        Refuses with `AutomationBusy` while ANY run is active — 409 "runner busy" — rather than queueing:
        concurrency 1 is a global property (owner ruling 2), so the honest answer is "not now". A
        currently-due slot is consumed atomically by the claim, so pressing the button exactly when the
        loop would have fired cannot double-run; otherwise the schedule is untouched.

        **The claim is inline, the execution is not.** The claim is what decides 409-vs-started and it is
        the row the response carries, so the caller must wait for it. The RUN is a full agent turn
        bounded by `timeout_s` (300s by default) — awaiting that inside a request handler is precisely
        what D39's durable-turn machinery exists to avoid, since a client that navigates away (or a proxy
        that times the socket out) would cancel the handler mid-run and turn an ordinary run into an
        `interrupted` one.

        **The arbiter is acquired here and released by the detached task.** `asyncio.Lock` has no owner
        check, and that hand-off is what makes concurrency 1 hold across the request boundary: `tick()`
        sees `locked()` for the whole detached run, exactly as it does for an awaited one.

        **Refused once shutdown has begun**, on the same `shutting_down` flag `tick()` reads. Starting a
        run past that point would race a snapshot into a closing DB, and — because `_manual` holds ONE
        task — a start landing during `shutdown()`'s drain would replace the handle being drained with a
        run nothing is waiting for. Uvicorn stops serving before the lifespan unwinds, so this gate is a
        backstop rather than a hot path; the poll loop is gated identically.
        """
        if getattr(self._app.state, "shutting_down", False):
            raise AutomationBusy("the server is shutting down — no new automation runs are being started")
        if self._arbiter.locked():
            raise AutomationBusy("the automation runner is busy with another run — try again shortly")
        # Uncontended `acquire()` completes without yielding, so the `locked()` check above and this are
        # atomic under the single-threaded loop (the same `reserve()` discipline the turn registry uses).
        await self._arbiter.acquire()
        try:
            snapshot = await self._claim(automation_id, trigger="manual")
            if snapshot is None:
                raise AutomationNotFound(f"no automation {automation_id!r}")
        except BaseException:
            # Nothing was claimed, so nobody else will release the lock. `_claim` already terminalizes
            # a run it managed to commit before a cancel landed, so there is no orphan to close here.
            self._arbiter.release()
            raise
        # From here the claim OWNS a `running` row, and EVERY exit hands it to the detached task — which
        # is the only thing that can terminalize it and release the arbiter. So the read below sits in a
        # `try/finally` rather than the `except` shape above: a failing read must not become the reason a
        # claimed run is left `running` until the next boot's orphan sweep (the `_claim` handoff class).
        try:
            run = await self._service.repo.get_run(snapshot.run_id)
        finally:
            self._manual = asyncio.create_task(self._run_detached(snapshot))
        if run is None:  # the claim committed it in the same database — belt, not braces
            raise AutomationNotFound(f"no automation {automation_id!r}")
        return run

    async def _run_detached(self, snapshot: AutomationSnapshot) -> None:
        """The body `start_now` hands off: the SAME `_execute` the poll loop uses, plus retention, plus
        the arbiter release that closes the hand-off. Never raises — `_execute` already terminalizes the
        run in a shielded finalizer, and a detached task's exception has nowhere to go but the logs."""
        try:
            await self._execute(snapshot)
            await self._service.prune_runs(snapshot.automation_id)
        except asyncio.CancelledError:
            raise  # shutdown: `_execute` has already written the `interrupted` terminal
        except Exception:  # noqa: BLE001 — a detached run must not die silently
            log.exception("detached automation run %s failed", snapshot.run_id)
        finally:
            self._arbiter.release()

    async def run_now(self, automation_id: str) -> AutomationRun | None:
        """`start_now`, awaited to completion — the in-process entry point (and the tests').

        One execution path with the endpoint's: this only adds the rendezvous. `asyncio.wait` rather than
        a bare `await`, so the detached task stays the sole owner of the run's outcome and a failure
        there is reported where it happened, not re-raised into an unrelated caller.

        **Cancelling this coroutine no longer cancels the RUN** — deliberate, and a real change from the
        pre-14c shape. The run lives on the detached task `start_now` created, which only `shutdown()`
        cancels; a cancel here abandons the *rendezvous*, exactly as a client disconnecting from the 202
        endpoint does. Anything that needs the run itself stopped goes through `cancel_turn` on its turn,
        which is the one sanctioned cancel (§D-2).
        """
        started = await self.start_now(automation_id)
        task = self._manual
        if task is not None:
            await asyncio.wait([task])
        return await self._service.repo.get_run(started.id)

    async def shutdown(self, grace_s: float) -> None:
        """Cancel + drain a detached run-now, bounded (the lifespan's `shutdown_grace_s`).

        The poll loop's task is cancelled by the lifespan directly; this is its counterpart for the one
        execution that does not live on it. Bounded for the same reason the turn drain is: shutdown must
        not hang systemd, and the terminal a cancel produces (`interrupted` — "cut off, effects may be
        incomplete") stays true even if the turn is still unwinding when the process goes.

        **The sweep is the backstop, and it is not optional** (post-14c review, HIGH). A task cancelled
        before its FIRST scheduling step never runs its body at all — so neither `_execute`'s shielded
        finalizer nor `_run_detached`'s `finally` ever executes, and the `running` row the claim committed
        survives with nobody to close it. The same is true of a task still pending when the grace expires.
        In both cases we call `sweep_orphans()` — the EXISTING chokepoint that marks stale `running` rows
        `interrupted`, the one the boot path uses — while the DB is still open, instead of leaving the row
        for the next boot to find. The arbiter is deliberately NOT reasoned about here: a held lock is
        immaterial to a process that is exiting; the durable row is not.
        """
        task = self._manual
        if task is None or task.done():
            return
        task.cancel()
        _, pending = await asyncio.wait([task], timeout=grace_s)
        if pending:
            log.warning("a manual automation run did not drain within %.1fs", grace_s)
        if pending or task.cancelled():
            # Did not terminalize itself (never started, or still unwinding past the grace) — close the
            # row here rather than leaving it `running` until the next boot's sweep finds it.
            await self._service.sweep_orphans()

    async def _claim(self, automation_id: str, **kw) -> AutomationSnapshot | None:
        """`AutomationService.claim`, made uninterruptible ACROSS THE OWNERSHIP HANDOFF (post-14b review,
        MED).

        The gap this closes: a claim COMMITs a `running` row and only then returns the snapshot that
        makes `_execute` responsible for closing it. A cancel landing in between — plausibly while
        aiosqlite's worker thread is finishing the COMMIT, so the rollback that follows is a no-op —
        leaves a row that is durably `running` with nobody who knows about it. Nothing would resolve it
        until the next boot's orphan sweep, and until then the automation reads as permanently busy
        (run-now and delete both refuse).

        So the claim runs as its own task (genuinely uncancellable by our cancel), we `shield` it, and on
        a cancel we still await its outcome: if it committed a run, we terminalize that run as
        `interrupted` — the honest status for "claimed, never started" — before propagating. Same
        mechanism as `_shielded`/`Database._shielded_rollback`; here it protects a HANDOFF rather than a
        write.

        The cleanup is written to survive the two things that actually go wrong during a shutdown (wave
        2): a REPEATED or level-triggered cancel landing while we drain the claim — anyio's scope plus a
        second `await` on the task, the db.py shape, safe because our cancel cannot cancel that task —
        and the claim RAISING, which must never replace the cancellation. The bare `raise` at the end
        always re-raises the original `CancelledError`: a claim error surfacing in its place would be
        caught by `loop()`'s `except Exception` and swallowed, and shutdown would stop being orderly.
        """
        task = asyncio.ensure_future(self._service.claim(automation_id, **kw))
        try:
            return await asyncio.shield(task)
        except asyncio.CancelledError:
            snapshot: AutomationSnapshot | None = None
            # Drain the claim to completion, HOWEVER MANY cancels arrive. A single re-await (the db.py
            # shape) is enough for one delivered cancel, but a second `cancel()` landing during that
            # await raises again and would abandon a claim that is about to commit — the very row this
            # method exists to hand off. Each `cancel()` is delivered at most once, so consuming them in
            # a loop terminates; `asyncio.wait` never re-raises the TASK's own outcome, so the result is
            # read from the settled task below instead of from an exception path.
            while not task.done():
                with contextlib.suppress(BaseException):
                    await asyncio.wait([task])
            if not task.cancelled():  # nothing cancels the claim task itself — belt, not braces
                failure = task.exception()
                if failure is not None:
                    # Logged, never raised: a claim error surfacing here would REPLACE the cancellation,
                    # and `loop()`'s `except Exception` would swallow it as an ordinary poll failure —
                    # leaving the loop running through a shutdown.
                    log.error("the claim failed while unwinding a cancel: %r", failure)
                else:
                    snapshot = task.result()
            if snapshot is not None:
                # Best-effort, and deliberately swallowing even a `CancelledError` raised by the
                # finalizer: whatever it reports, the cancellation below is the story this unwind tells.
                with contextlib.suppress(BaseException):
                    await _shielded(
                        self._finalize(snapshot, status="interrupted", error=INTERRUPTED_NOTE, thread_id=None)
                    )
            raise  # ALWAYS the original CancelledError

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
                # would pierce the drain's persistence shield, D39 H2), then wait for the turn to
                # ACTUALLY END — no grace window (post-14b review, HIGH).
                #
                # The bounded wait this replaces released the arbiter and wrote `timed_out` while a
                # cancellation-resistant step (a tool in `to_thread`, a subagent TaskGroup unwinding)
                # could still be running: the NEXT automation would then start beside a turn the runner
                # had already declared finished, and a shutdown could close the DB underneath the
                # straggler's persistence. Waiting is honest about a wedge; the alternative is a lie about
                # an overlap. In practice the wait is bounded by the tools themselves — every registered
                # tool either declares `ToolSpec.timeout_s` or is covered by `ADAPTER_BOUNDED` (ACA-7).
                timed_out = True
                cancel_turn(handle)
                await asyncio.wait([task])
        except asyncio.CancelledError:
            # Our own await was cancelled (shutdown, or a Stop of the runner). Route the turn through the
            # same single cancel and let it settle under a shield, so its persistence completes while the
            # DB is still open; then re-raise so the loop unwinds. `_execute`'s finally still terminalizes
            # the run as `interrupted`.
            #
            # THIS wait stays bounded by `shutdown_grace_s`, unlike the deadline path above, and the
            # difference is deliberate: shutdown must not hang systemd, and the label it produces is
            # `interrupted` — "this was cut off, its effects may be incomplete" — which stays TRUE even
            # if the turn is still unwinding when the process goes. A bounded wait is only dishonest
            # when it is used to declare a RECONCILED terminal, which is exactly what the deadline path
            # no longer does.
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
        """Close the claimed run row and audit its terminal. Runs inside `_shielded`, so it must swallow
        its own failures: whatever brought us here — a cancel, an exception — is the story, and a raise
        from the finalizer would replace it.

        Terminalization is first-writer-wins (`AutomationService.finish_run`) because this is not always
        the only closer: `shutdown` sweeps a manual run that outlived its grace, and that task can still
        arrive here afterwards. Losing the race is a normal outcome, not an error — the row is already
        terminal and already audited."""
        try:
            won = await self._service.finish_run(
                snapshot.run_id, status=status, error=error, thread_id=thread_id
            )
            if not won:
                # The shutdown backstop sweep already closed this row (post-14d review, MED): it is
                # terminal, it has its own audit row, and writing a second one here would duplicate the
                # run in the log and fire a second `automation_done` notification for it.
                return
            # One audit row per terminal, whatever the outcome (see `RUN_TERMINAL_STATES`): the owner
            # can see how a run ended without opening the history, and an open client learns that a
            # detached run finished at all.
            await self._service.record_run_event(
                automation_id=snapshot.automation_id,
                run_id=snapshot.run_id,
                name=snapshot.name,
                status=RUN_TERMINAL_STATES[status],
                summary=error or COMPLETED_NOTE,
            )
        except Exception:  # noqa: BLE001 — never replace the outcome we are here to record
            log.exception("failed to terminalize automation run %s", snapshot.run_id)
