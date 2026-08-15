"""A3 slice 2 — the automations ENGINE (D49 / AUTOMATIONS_PLAN §D-1/§D-2/§D-3/§D-7).

Slice 1 made every action say who set it in motion; this slice is the thing that sets them in motion
without an owner present. What's pinned here:

  1. Schema      — migration v5 creates both tables + their indexes, on top of a v4-era database.
  2. Schedule    — the cronsim wrapper: 5 fields only, unusable expressions refused at the WRITE, and
                   the DST fold crossed exactly once in each direction (the R7 trap).
  3. Writes      — one validated path: cron/tz/agent checked, the cap counted+inserted in one
                   transaction with a refusal that names the remedy, `rev` bumped on every change.
  4. next_run_at — the invariants: create computes a future slot, enable recomputes strictly-future,
                   disable nulls it, an unrelated edit keeps the pending slot.
  5. The claim   — due / not-due / disabled / rev-conflict / already-claimed, and misfire beyond the
                   grace recording a `missed` row that NEVER fires late.
  6. Runs        — driven through the real turn machinery: ok · timed_out (via `cancel_turn`) ·
                   interrupted (a shutdown cancel, terminalized by the shielded finalizer) · a missing
                   named agent FAILING the run instead of falling back to the default agent.
  7. Threads     — fresh per run, rolling reused + lazily recreated, and an interactive chat aimed at a
                   rolling thread refused.
  8. Housekeeping— the boot orphan sweep (+ its Event) and `keep_runs` retention pruning run rows AND
                   their per-run threads, never the rolling one.
  9. Session     — the ONE options object: interactive off, actor AUTOMATION, reflection disarmed,
                   no steer source, compaction state only for rolling, origin carrying the run id.
 10. Questions   — the `question_policy` ladder (skip · declared default · first choice · synthesized)
                   with subagents unchanged.
 11. Config      — the `automations:` section's defaults and that the loop/service read them LIVE.

Runs as `python tests/test_automations_14b.py` from backend/ or under pytest. Every test works in an
isolated `$CTRLB_HOME`/`CTRLB_CONFIG`/`CTRLB_DB` temp workspace — the real config/db are never touched.
"""

from __future__ import annotations

import asyncio
import contextlib
import os
import tempfile
import time
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

import anyio
from _async import drain_run_calls, run_async

_MADRID = ZoneInfo("Europe/Madrid")


@contextlib.contextmanager
def _workspace(config_text: str = "server:\n  port: 5433\n"):
    tmp = Path(tempfile.mkdtemp())
    cfg = tmp / "config.yaml"
    cfg.write_text(config_text, encoding="utf-8")
    os.environ["CTRLB_HOME"] = str(tmp)
    os.environ["CTRLB_CONFIG"] = str(cfg)
    os.environ["CTRLB_DB"] = str(tmp / "t.db")
    try:
        yield tmp
    finally:
        for k in ("CTRLB_HOME", "CTRLB_CONFIG", "CTRLB_DB"):
            os.environ.pop(k, None)


def _client():
    from fastapi.testclient import TestClient

    from app.main import create_app

    return TestClient(create_app())


def _run(coro):
    return run_async(coro)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _draft(**kw):
    """A valid draft with everything but the overrides defaulted (03:00 daily, UTC)."""
    from app.domain.automation import AutomationDraft

    base = {"name": "nightly", "schedule": "0 3 * * *", "prompt": "check the fleet", "tz": "UTC"}
    return AutomationDraft(**{**base, **kw})


def _svc(c):
    return c.app.state.automation_service


# ── 1. the migration ────────────────────────────────────────────────────────────────────────────


def test_migration_v5_creates_both_tables_on_a_v4_database() -> None:
    """A database written before this slice migrates in place: both tables appear with every column the
    spec names, plus the two indexes the claim scan and the history read depend on."""
    import app.db as dbmod
    from app.db import Database

    with _workspace() as tmp:
        path = tmp / "legacy.db"
        real = dbmod.MIGRATIONS

        async def go():
            dbmod.MIGRATIONS = [m for m in real if m[0] <= 4]  # a v4-era database
            legacy = Database(path)
            await legacy.connect()
            assert await legacy.schema_version() == 4
            await legacy.close()

            dbmod.MIGRATIONS = real
            db = Database(path)
            await db.connect()
            autos = [r["name"] for r in await db.query("PRAGMA table_info(automations)")]
            runs = [r["name"] for r in await db.query("PRAGMA table_info(automation_runs)")]
            idx = [r["name"] for r in await db.query("SELECT name FROM sqlite_master WHERE type='index'")]
            version = await db.schema_version()
            await db.close()
            return version, autos, runs, idx

        try:
            version, autos, runs, idx = _run(go())
        finally:
            dbmod.MIGRATIONS = real

    assert version == 5
    for col in (
        "id",
        "name",
        "enabled",
        "schedule",
        "tz",
        "prompt",
        "agent",
        "privilege",
        "question_policy",
        "thread_mode",
        "thread_id",
        "timeout_s",
        "next_run_at",
        "rev",
        "created_at",
        "updated_at",
    ):
        assert col in autos, col
    for col in (
        "id",
        "automation_id",
        "trigger",
        "scheduled_for",
        "started_at",
        "finished_at",
        "status",
        "error",
        "thread_id",
        "read_at",
    ):
        assert col in runs, col
    assert "idx_automations_next_run" in idx and "idx_automation_runs_automation" in idx


# ── 2. the schedule wrapper ─────────────────────────────────────────────────────────────────────


def test_cron_validation_accepts_five_fields_and_refuses_the_rest() -> None:
    """The write gate for schedules. The six-field form matters most: `cronsim` accepts it as a
    SECONDS-resolution cron, which a 10-second poll loop could only ever service as a stream of
    misfires — so it is refused here rather than stored and mis-run."""
    from app.services.automations.schedule import ScheduleError, describe, validate_cron

    assert validate_cron("  0   3 * * * ") == "0 3 * * *"  # whitespace normalized
    assert validate_cron("*/15 * * * *") == "*/15 * * * *"
    # the human echo the editor + the agent tool's card render (advisory: junk falls back to the raw text)
    assert describe("0 3 * * *") == "At 03:00 every day"
    assert describe("nonsense") == "nonsense"
    for bad in ("*/15 * * * * *", "0 3 * *", "", "   ", "@daily", "60 * * * *", "0 0 30 2 *"):
        try:
            validate_cron(bad)
        except ScheduleError:
            continue
        raise AssertionError(f"{bad!r} should not validate")


def test_tz_resolution_defaults_to_the_server_zone_and_refuses_junk() -> None:
    from app.services.automations.schedule import ScheduleError, resolve_tz, server_tz_key

    assert resolve_tz("Europe/Madrid") == "Europe/Madrid"
    assert resolve_tz(None) == server_tz_key()  # NOT NULL in storage: decided at save time
    assert resolve_tz("  ") == server_tz_key()
    try:
        resolve_tz("Mars/Olympus")
    except ScheduleError:
        pass
    else:
        raise AssertionError("an unknown zone must be refused at the write")
    ZoneInfo(server_tz_key())  # whatever it resolved to is loadable on THIS host


def test_next_fire_is_strictly_after_and_survives_both_dst_transitions() -> None:
    """The R7 DST trap, executable. A daily 02:30 in Madrid crosses the autumn fold (02:30 exists twice)
    exactly ONCE — the double-fire croniter was rejected for — and crosses the spring gap (02:30 does not
    exist) without vanishing or repeating. The epochs are strictly increasing and ~a day apart, which is
    what "computed, never incremented" buys."""
    from app.services.automations.schedule import next_fire, next_fires

    autumn = next_fires(
        "30 2 * * *", "Europe/Madrid", after=datetime(2026, 10, 24, 12, 0, tzinfo=_MADRID), count=3
    )
    assert [d.date().isoformat() for d in autumn] == ["2026-10-25", "2026-10-26", "2026-10-27"]
    stamps = [d.timestamp() for d in autumn]
    assert stamps == sorted(stamps) and len(set(stamps)) == 3  # one fire per day, none repeated

    spring = next_fires(
        "30 2 * * *", "Europe/Madrid", after=datetime(2026, 3, 28, 12, 0, tzinfo=_MADRID), count=3
    )
    assert [d.date().isoformat() for d in spring] == ["2026-03-29", "2026-03-30", "2026-03-31"]
    assert len({d.timestamp() for d in spring}) == 3

    # strictly-after: asked from a moment that IS a fire time, the next one comes back
    at = datetime(2026, 7, 30, 12, 15, tzinfo=timezone.utc)
    assert next_fire("*/15 * * * *", "UTC", after=at) > at


# ── 3./4. the write path + the next_run_at invariants ───────────────────────────────────────────


def test_create_validates_and_computes_a_future_first_fire() -> None:
    with _workspace(), _client() as c:
        a = _run(_svc(c).create(_draft()))
        assert a.next_run_at is not None and a.next_run_at > _now()
        assert a.rev == 1 and a.enabled and a.tz == "UTC"
        assert _run(c.app.state.automations.get(a.id)).schedule == "0 3 * * *"  # round-trips


def test_a_disabled_create_is_never_claimable() -> None:
    with _workspace(), _client() as c:
        a = _run(_svc(c).create(_draft(enabled=False)))
        assert a.next_run_at is None
        assert _run(c.app.state.automations.due(_now() + timedelta(days=365))) == []


def test_invalid_schedule_tz_and_agent_are_refused_with_the_field_named() -> None:
    from app.services.automations import AutomationInvalid

    with _workspace(), _client() as c:
        for kw, field in (
            ({"schedule": "nonsense"}, "schedule"),
            ({"tz": "Mars/Olympus"}, "tz"),
            ({"agent": "ghost"}, "agent"),
        ):
            try:
                _run(_svc(c).create(_draft(**kw)))
            except AutomationInvalid as exc:
                assert exc.field == field, kw
            else:
                raise AssertionError(f"{kw} should have been refused")


def test_the_cap_counts_every_definition_and_names_the_remedy() -> None:
    """§D-1: the cap counts ALL definitions (enabled or not) and is counted+inserted in ONE
    transaction, so the count cannot go stale between the check and the insert."""
    from app.services.automations import AutomationCapReached

    with _workspace("automations:\n  max_count: 2\n"), _client() as c:
        _run(_svc(c).create(_draft(name="one")))
        _run(_svc(c).create(_draft(name="two", enabled=False)))  # disabled still counts
        try:
            _run(_svc(c).create(_draft(name="three")))
        except AutomationCapReached as exc:
            assert "delete one first" in str(exc)
        else:
            raise AssertionError("the cap must refuse the third definition")
        assert _run(c.app.state.automations.count()) == 2
        assert [a.name for a in _run(c.app.state.automations.list())] == ["one", "two"]  # creation order


def test_next_run_invariants_across_enable_disable_and_edits() -> None:
    """The four rules in one pass: disable nulls the slot · enable recomputes a strictly-future one and
    never reuses the stale value · a schedule edit recomputes · an unrelated edit KEEPS the pending slot
    (editing a prompt must not push the next run back). `rev` bumps on every one of them."""
    with _workspace(), _client() as c:
        svc = _svc(c)
        a = _run(svc.create(_draft()))
        first_slot, first_rev = a.next_run_at, a.rev

        off = _run(svc.set_enabled(a.id, False))
        assert off.next_run_at is None and off.rev == first_rev + 1

        # a stale slot in the past cannot survive an enable
        _run(c.app.state.automations.set_next_run(a.id, _now() - timedelta(days=2)))
        on = _run(svc.set_enabled(a.id, True))
        assert on.next_run_at is not None and on.next_run_at > _now() and on.rev == first_rev + 2

        same = _run(svc.update(a.id, _draft(prompt="a different prompt")))
        assert same.next_run_at == on.next_run_at  # unrelated edit → the pending slot stands
        assert same.prompt == "a different prompt" and same.rev == on.rev + 1

        moved = _run(svc.update(a.id, _draft(schedule="0 4 * * *")))
        assert moved.next_run_at is not None and moved.next_run_at != same.next_run_at
        assert moved.next_run_at > _now()

        assert _run(svc.update(a.id, _draft(enabled=False))).next_run_at is None
        assert first_slot is not None


# ── 5. the claim ────────────────────────────────────────────────────────────────────────────────


def _due_now(c, automation, *, ago_s: int = 5):
    """Drag an automation's slot into the past so the claim sees it as due (deterministically)."""
    slot = _now() - timedelta(seconds=ago_s)
    _run(c.app.state.automations.set_next_run(automation.id, slot))
    return slot


def test_a_due_claim_inserts_a_running_row_advances_and_freezes_a_snapshot() -> None:
    with _workspace(), _client() as c:
        svc = _svc(c)
        a = _run(svc.create(_draft(schedule="*/5 * * * *", prompt="original")))
        slot = _due_now(c, a)

        snap = _run(svc.claim(a.id, expected_rev=a.rev))
        assert snap is not None
        assert snap.prompt == "original" and snap.automation_id == a.id and snap.rev == a.rev
        assert snap.timeout_s == c.app.state.settings.automations.default_timeout_s  # resolved at claim
        row = _run(c.app.state.automations.get(a.id))
        assert row.next_run_at is not None and row.next_run_at > _now()  # advanced from NOW

        run = _run(c.app.state.automations.get_run(snap.run_id))
        assert run.status == "running" and run.trigger == "scheduled"
        assert run.scheduled_for is not None and abs((run.scheduled_for - slot).total_seconds()) < 2

        # a mid-flight edit reaches the NEXT run, never this one (the snapshot is frozen)
        _run(svc.update(a.id, _draft(prompt="edited")))
        assert snap.prompt == "original"


def test_the_claim_declines_when_not_due_disabled_or_edited() -> None:
    with _workspace(), _client() as c:
        svc = _svc(c)
        a = _run(svc.create(_draft()))
        assert _run(svc.claim(a.id, expected_rev=a.rev)) is None  # not due yet

        _due_now(c, a)
        assert _run(svc.claim(a.id, expected_rev=a.rev + 99)) is None  # edited since the scan

        _run(svc.set_enabled(a.id, False))
        _due_now(c, a)  # even with a slot forced back in, a disabled row is never claimed
        assert _run(svc.claim(a.id)) is None
        assert _run(svc.claim("no-such-automation")) is None
        assert _run(c.app.state.automations.runs(a.id)) == []  # nothing was recorded either


def test_two_claimers_of_the_same_slot_produce_exactly_one_run() -> None:
    """The claim's atomicity: whoever commits first has already advanced `next_run_at`, so the second
    re-read finds nothing due. This is what stops a run-now racing the loop into a double run."""
    with _workspace(), _client() as c:
        svc = _svc(c)
        a = _run(svc.create(_draft(schedule="*/5 * * * *")))
        _due_now(c, a)
        first = _run(svc.claim(a.id, expected_rev=a.rev))
        second = _run(svc.claim(a.id, expected_rev=a.rev))
        assert first is not None and second is None
        assert len(_run(c.app.state.automations.runs(a.id))) == 1


def test_a_slot_beyond_the_grace_is_recorded_missed_and_never_fires_late() -> None:
    """Owner ruling 3, executable: a box asleep at 09:00 does not run the 09:00 job at noon. The slot is
    recorded `missed` (terminal, with the lateness in it), the schedule advances, and NO snapshot is
    handed out — so nothing can invoke the agent for it."""
    with _workspace("automations:\n  misfire_grace_s: 60\n"), _client() as c:
        svc = _svc(c)
        a = _run(svc.create(_draft(schedule="*/5 * * * *")))
        _due_now(c, a, ago_s=3600)

        assert _run(svc.claim(a.id, expected_rev=a.rev)) is None
        runs = _run(c.app.state.automations.runs(a.id))
        assert len(runs) == 1 and runs[0].status == "missed"
        assert runs[0].finished_at is not None and "misfire grace" in (runs[0].error or "")
        row = _run(c.app.state.automations.get(a.id))
        assert row.next_run_at is not None and row.next_run_at > _now()


def test_a_manual_claim_consumes_a_due_slot_and_otherwise_leaves_the_schedule() -> None:
    with _workspace(), _client() as c:
        svc = _svc(c)
        a = _run(svc.create(_draft(schedule="0 3 * * *")))
        untouched = _run(c.app.state.automations.get(a.id)).next_run_at

        manual = _run(svc.claim(a.id, trigger="manual"))
        assert manual is not None and manual.trigger == "manual" and manual.scheduled_for is None
        assert _run(c.app.state.automations.get(a.id)).next_run_at == untouched  # schedule untouched

        _due_now(c, a)  # …but a manual run that happens ON a due slot consumes it
        consuming = _run(svc.claim(a.id, trigger="manual"))
        assert consuming is not None and consuming.scheduled_for is not None
        assert _run(c.app.state.automations.get(a.id)).next_run_at > _now()


def test_concurrent_claimers_of_one_slot_race_and_exactly_one_wins() -> None:
    """The SAME assertion as the sequential test above, made adversarial (post-14b review, MED): both
    claims are released from an `asyncio.Barrier` so they are genuinely in flight together, and the
    write lock + `BEGIN IMMEDIATE` are what decide it. A claim that read outside a transaction would
    hand both callers a snapshot here and run the automation twice."""
    with _workspace(), _client() as c:
        svc = _svc(c)
        a = _run(svc.create(_draft(schedule="*/5 * * * *")))
        _due_now(c, a)

        async def go():
            barrier = asyncio.Barrier(2)

            async def claimer():
                await barrier.wait()  # neither proceeds until BOTH are here
                return await svc.claim(a.id, expected_rev=a.rev)

            return await asyncio.gather(claimer(), claimer())

        won = [s for s in _run(go()) if s is not None]
        assert len(won) == 1
        runs = _run(c.app.state.automations.runs(a.id))
        assert len(runs) == 1 and runs[0].id == won[0].run_id


def test_a_claim_racing_a_delete_is_decided_atomically_either_way() -> None:
    """The TOCTOU hole the one-transaction DELETE closes (post-14b review, HIGH). Started together, the
    two outcomes are the only two legal ones: DELETE first ⇒ the claim finds no automation and nothing
    executes; CLAIM first ⇒ the delete refuses because a run is active. What must NEVER happen is the
    old third outcome — a snapshot handed out for an automation whose row and run were just cascaded
    away, executing after the owner deleted it."""
    from app.services.automations import AutomationBusy, AutomationNotFound

    with _workspace(), _client() as c:
        svc = _svc(c)
        a = _run(svc.create(_draft(schedule="*/5 * * * *")))
        _due_now(c, a)

        async def go():
            barrier = asyncio.Barrier(2)

            async def claimer():
                await barrier.wait()
                return await svc.claim(a.id, expected_rev=a.rev)

            async def deleter():
                await barrier.wait()
                await svc.delete(a.id)

            return await asyncio.gather(claimer(), deleter(), return_exceptions=True)

        snapshot, deletion = _run(go())
        gone = _run(c.app.state.automations.get(a.id)) is None
        if isinstance(deletion, (AutomationBusy, AutomationNotFound)):
            # the claim won: the automation survives WITH its running run, and the delete refused
            assert snapshot is not None and not gone
            assert [r.status for r in _run(c.app.state.automations.runs(a.id))] == ["running"]
        else:
            # the delete won: nothing was handed a snapshot, and no run row survives to be executed
            assert deletion is None and gone
            assert snapshot is None
            assert _run(c.app.state.automations.runs(a.id)) == []


def test_a_claim_during_the_autumn_fold_never_moves_the_slot_backward() -> None:
    """The HIGH the review caught, at the layer that stores it. During Europe/Madrid's 2026-10-25 fold,
    01:00Z is 02:00 local in the SECOND pass of the repeated hour — and `cronsim` answers a `30 2 * * *`
    schedule with `02:30+02:00`, the FIRST pass, whose epoch is thirty minutes in the PAST. Storing that
    as `next_run_at` makes the row due again immediately: the same slot is re-recorded `missed` every
    poll, or (with a grace wider than the offset) RE-RUN, until the fold ends."""
    with _workspace(), _client() as c:
        svc, repo = _svc(c), c.app.state.automations
        a = _run(svc.create(_draft(schedule="30 2 * * *", tz="Europe/Madrid")))
        during_fold = datetime(2026, 10, 25, 1, 0, tzinfo=timezone.utc)  # 02:00 local, second pass
        _run(repo.set_next_run(a.id, during_fold - timedelta(seconds=30)))

        snap = _run(svc.claim(a.id, expected_rev=a.rev, now=during_fold))
        assert snap is not None  # inside the grace, so it legitimately runs
        advanced = _run(repo.get(a.id)).next_run_at
        assert advanced is not None
        assert advanced.timestamp() > during_fold.timestamp()  # the regression this closes
        # …and a second claim at the same instant finds nothing due (the slot really did move on)
        assert _run(svc.claim(a.id, expected_rev=_run(repo.get(a.id)).rev, now=during_fold)) is None


# ── 6. runs through the turn machinery ──────────────────────────────────────────────────────────


class _FakeSession:
    """Stands in for `AgentSession` at the `_build_session` seam: everything BELOW it (reserve, the
    drain task, the terminal fold, marker release) is the REAL machinery under test."""

    def __init__(self, *, done: str | None = "completed", hang: bool = False) -> None:
        self._done = done
        self._hang = hang
        self.prompt: str | None = None

    async def run_turn(self, thread, text, **_kw):
        from app.services.agent.session import AgentEvent

        self.prompt = text
        if self._hang:
            await asyncio.sleep(30)  # cancelled by the deadline / the shutdown path
        if self._done is not None:
            yield AgentEvent("done", {"threadId": thread.id, "state": self._done})


class _StubbornSession:
    """A turn that does NOT die the instant it is cancelled — a tool finishing in `to_thread`, a
    subagent TaskGroup unwinding, the persistence `finally` the drain shields. The runner must treat
    "cancel delivered" as the START of the wait, never as the end of the turn."""

    def __init__(self, resist_s: float = 0.4) -> None:
        self._resist = resist_s
        #: signalled the moment the cancel LANDS, and cleared-by-nothing once the turn finally lets go —
        #: the window between them is the one the old grace-abandonment handed to the next automation.
        self.cancelled = asyncio.Event()
        self.released_at: float | None = None

    async def run_turn(self, thread, text, **_kw):
        from app.services.agent.session import AgentEvent

        try:
            await asyncio.sleep(30)
        except asyncio.CancelledError:
            self.cancelled.set()
            with anyio.CancelScope(shield=True):
                await asyncio.sleep(self._resist)  # still doing real work AFTER the cancel
            self.released_at = time.monotonic()
            raise
        yield AgentEvent("done", {"threadId": thread.id, "state": "completed"})  # pragma: no cover


@contextlib.contextmanager
def _fake_sessions(session):
    """Point the runner's session builder at `session` (it imports `_build_session` per call, so the
    module attribute is the seam) and restore it afterwards."""
    import app.api.agent as agent_api

    real = agent_api._build_session
    agent_api._build_session = lambda *a, **kw: session  # type: ignore[assignment]
    try:
        yield
    finally:
        agent_api._build_session = real  # type: ignore[assignment]


def _runner(c):
    return c.app.state.automation_runner


def test_a_run_rides_the_real_turn_machinery_and_ends_ok() -> None:
    """The core integration: claim → reserve(kind="automation") → drain task → terminal. The marker is
    released afterwards (so the thread is free), the run row is `ok`, and the prompt the session ran is
    the one frozen in the snapshot."""
    with _workspace(), _client() as c:
        svc, state = _svc(c), c.app.state
        a = _run(svc.create(_draft(prompt="do the thing", schedule="*/5 * * * *")))
        _due_now(c, a)
        snap = _run(svc.claim(a.id, expected_rev=a.rev))
        session = _FakeSession()
        with _fake_sessions(session):
            assert _run(_runner(c)._execute(snap)) == "ok"

        run = _run(state.automations.get_run(snap.run_id))
        assert run.status == "ok" and run.error is None and run.finished_at is not None
        assert run.thread_id is not None
        assert session.prompt == "do the thing"
        assert state.turns == {}  # the turn marker was released by the drain task's done-callback
        assert _runner(c).active is None and not _runner(c).busy  # the runner is free again
        thread = _run(state.threads.get(run.thread_id))
        assert thread is not None and thread.archived and a.name in (thread.title or "")


def test_a_run_past_its_timeout_is_cancelled_through_cancel_turn_and_reads_timed_out() -> None:
    """Deadline = `cancel_turn` (never a raw task cancel around a half-persisted call), then the run is
    labelled `timed_out` — distinct from `interrupted`, because only the runner knows it fired it."""
    with _workspace(), _client() as c:
        svc, state = _svc(c), c.app.state
        a = _run(svc.create(_draft(schedule="*/5 * * * *", timeout_s=1)))
        _due_now(c, a)
        snap = _run(svc.claim(a.id, expected_rev=a.rev))
        assert snap.timeout_s == 1  # the row's own timeout wins over the config default
        with _fake_sessions(_FakeSession(hang=True)):
            assert _run(_runner(c)._execute(snap)) == "timed_out"

        run = _run(state.automations.get_run(snap.run_id))
        assert run.status == "timed_out" and "timeout" in (run.error or "")
        assert state.turns == {}


def test_a_timeout_holds_ownership_until_the_turn_actually_ends() -> None:
    """The HIGH the review caught in the deadline path. After the sanctioned `cancel_turn`, the runner
    used to wait a grace window and then declare `timed_out` — releasing the arbiter while the turn was
    demonstrably still running, so the NEXT automation could start beside it (and a shutdown could close
    the DB under the straggler). Three things are pinned: the run is still `running` and the runner is
    still busy while the cancelled turn winds down, run-now is refused in that window, and the run row is
    written only AFTER the turn has genuinely released."""
    from app.services.automations import AutomationBusy

    # `shutdown_grace_s` is deliberately TINY here and the turn resists for much longer than it: the
    # discarded implementation waited exactly this budget and then declared the run finished, so a
    # resistance shorter than the grace would pass against the bug too. This is the discriminating shape.
    cfg = "agent:\n  turns:\n    shutdown_grace_s: 0.05\n"
    with _workspace(cfg), _client() as c:
        svc, state = _svc(c), c.app.state
        assert state.settings.agent.turns.shutdown_grace_s == 0.05
        a = _run(svc.create(_draft(schedule="*/5 * * * *", timeout_s=1)))
        _due_now(c, a)
        session = _StubbornSession(resist_s=0.6)
        order: list[str] = []
        real_finish = svc.finish_run

        async def _record_finish(run_id, **kw):
            order.append("finalized")
            return await real_finish(run_id, **kw)

        svc.finish_run = _record_finish  # type: ignore[assignment]

        async def go():
            runner = _runner(c)
            with _fake_sessions(session):
                run_task = asyncio.ensure_future(runner.run_now(a.id))
                # …wait for the deadline's cancel to LAND (an Event, so the observation is not a poll),
                # then look while the turn is still winding down — 0.6s of resistance against an
                # immediate wake-up, so the window is wide open when we assert into it.
                await asyncio.wait_for(session.cancelled.wait(), timeout=10)
                assert session.released_at is None and not run_task.done(), "the window closed too fast"
                assert runner.busy, "the arbiter must stay held while the cancelled turn winds down"
                assert await state.automations.open_runs(a.id), "the run must stay open until it ends"
                try:
                    await runner.run_now(a.id)
                except AutomationBusy:
                    pass
                else:
                    raise AssertionError("run-now must be refused while a run is still winding down")
                assert session.released_at is None  # …and none of that ended the turn early
                await run_task

        _run(go())
        svc.finish_run = real_finish  # type: ignore[assignment]
        assert session.released_at is not None
        assert order == ["finalized"]  # written once, after the turn released (asserted above)
        run = _run(state.automations.runs(a.id))[0]
        assert run.status == "timed_out" and state.turns == {}
        assert not _runner(c).busy


def test_a_cancelled_runner_terminalizes_the_run_as_interrupted_with_an_event() -> None:
    """Shutdown: the loop's own task is cancelled while a run is in flight. The run must not be left
    `running` (the boot sweep exists for the crash case, not for an orderly stop), the wording must not
    claim nothing happened, and it gets an audit row of its own."""
    with _workspace(), _client() as c:
        svc, state = _svc(c), c.app.state
        a = _run(svc.create(_draft(schedule="*/5 * * * *")))
        _due_now(c, a)
        snap = _run(svc.claim(a.id, expected_rev=a.rev))

        async def go():
            with _fake_sessions(_FakeSession(hang=True)):
                task = asyncio.ensure_future(_runner(c)._execute(snap))
                await asyncio.sleep(0.1)
                task.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await task

        _run(go())
        run = _run(state.automations.get_run(snap.run_id))
        assert run.status == "interrupted" and "may be incomplete" in (run.error or "")
        events = _run(state.events.recent(10))
        audit = [e for e in events if e.run_id == snap.run_id]
        assert audit and audit[0].origin == "automation" and audit[0].origin_id == a.id
        assert audit[0].actor.value == "automation"
        assert state.turns == {}


def test_a_repeatedly_cancelled_claim_still_hands_off_and_keeps_the_cancellation() -> None:
    """Wave 2, the claim/cancel handoff under an unfriendly shutdown. Three things must hold when a
    cancel lands after the claim COMMITs: the run it created is terminalized `interrupted` (never left
    `running` until a reboot), a SECOND cancel arriving during that cleanup does not abandon it, and the
    caller still sees `CancelledError` — a claim error surfacing instead would be caught by `loop()`'s
    `except Exception` and shutdown would stop being orderly."""
    with _workspace(), _client() as c:
        svc, state = _svc(c), c.app.state
        a = _run(svc.create(_draft(schedule="*/5 * * * *")))
        _due_now(c, a)
        real_claim = svc.claim
        # Signalled, not timed (release wave): the cancel below must land while the claim is IN FLIGHT,
        # and `sleep(0.01)`-vs-`sleep(0.05)` is a margin a loaded CI runner can invert — the shape that
        # failed the v1.4.3 gate elsewhere in this suite. `entered` is the same idiom
        # `test_two_further_cancels_during_cleanup_cannot_abandon_terminalization` below already uses.
        entered = asyncio.Event()

        async def _slow_claim(*args, **kw):
            entered.set()  # the claim is now running…
            await asyncio.sleep(0.05)  # …and stays in flight for the window the cancel lands in
            return await real_claim(*args, **kw)

        svc.claim = _slow_claim  # type: ignore[assignment]

        async def go():
            task = asyncio.ensure_future(_runner(c)._claim(a.id, expected_rev=a.rev))
            await asyncio.wait_for(entered.wait(), timeout=5)
            task.cancel()
            await asyncio.sleep(0)  # let the cleanup begin…
            task.cancel()  # …and cancel it AGAIN, mid-handoff
            with contextlib.suppress(asyncio.CancelledError):
                await task
            return task

        task = _run(go())
        svc.claim = real_claim  # type: ignore[assignment]
        assert task.cancelled(), "the original cancellation must survive the cleanup"
        runs = _run(state.automations.runs(a.id))
        assert len(runs) == 1 and runs[0].status == "interrupted"  # claimed, never started, closed
        assert _run(state.automations.open_runs()) == []


def test_two_further_cancels_during_cleanup_cannot_abandon_terminalization() -> None:
    """Micro-wave: the finalizer drain is pierce-proof. A cancel puts the run into its cleanup, and TWO
    MORE raw cancels land while the terminal status is being written — a Stop racing a shutdown, or any
    caller that cancels more than once. The previous shape re-awaited exactly once, so the second cancel
    propagated straight out of `_shielded` and left the row `running` until the next boot's sweep.

    The assertion is read the INSTANT the unwind finishes, deliberately: the point is not that the write
    eventually lands from a detached task, it is that terminalization is COMPLETE before the cancel
    propagates — the lifespan closes the DB immediately after."""
    with _workspace(), _client() as c:
        svc, state = _svc(c), c.app.state
        a = _run(svc.create(_draft(schedule="*/5 * * * *")))
        _due_now(c, a)
        snap = _run(svc.claim(a.id, expected_rev=a.rev))
        entered = asyncio.Event()
        real_finish = svc.finish_run

        async def _slow_finish(run_id, **kw):
            entered.set()  # the finalizer is now in flight INSIDE `_shielded`
            await asyncio.sleep(0.15)  # …the window the extra cancels land in
            return await real_finish(run_id, **kw)

        svc.finish_run = _slow_finish  # type: ignore[assignment]

        async def go():
            with _fake_sessions(_FakeSession(hang=True)):
                task = asyncio.ensure_future(_runner(c)._execute(snap))
                await asyncio.sleep(0.1)
                task.cancel()  # (1) the shutdown cancel — enters the cleanup
                await asyncio.wait_for(entered.wait(), timeout=5)
                # (2) and (3) are spaced so each is genuinely DELIVERED: asyncio does not queue
                # cancels, so two `cancel()` calls before the task next resumes collapse into one
                # CancelledError — and one is exactly what the shape being replaced survives.
                task.cancel()
                await asyncio.sleep(0.01)
                task.cancel()
                await asyncio.sleep(0.01)
                with contextlib.suppress(asyncio.CancelledError):
                    await task
                return task

        task = _run(go())
        # …read IMMEDIATELY: no sleep, no second chance for a detached write to land.
        run = _run(state.automations.get_run(snap.run_id))
        svc.finish_run = real_finish  # type: ignore[assignment]
        assert run.status == "interrupted", "terminalization was abandoned by a repeated raw cancel"
        assert _run(state.automations.open_runs()) == []
        assert task.cancelled(), "the cancellation must still propagate once the write has landed"
        assert state.turns == {}


def test_a_claim_that_raises_during_cancellation_never_replaces_the_cancellation() -> None:
    """The other half: if the claim itself fails while we are unwinding, that exception must not become
    the thing the caller sees — `loop()` would swallow it as an ordinary poll failure and keep going
    through a shutdown."""
    with _workspace(), _client() as c:
        svc = _svc(c)

        entered = asyncio.Event()  # signalled, not timed — see the sibling test above

        async def _boom(*_a, **_kw):
            entered.set()
            await asyncio.sleep(0.05)  # in flight while the cancel lands
            raise RuntimeError("the claim blew up while we were unwinding")

        svc.claim = _boom  # type: ignore[assignment]

        async def go():
            task = asyncio.ensure_future(_runner(c)._claim("whatever"))
            await asyncio.wait_for(entered.wait(), timeout=5)
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task
            return task

        task = _run(go())
        assert task.cancelled(), "the claim's own error must not replace the cancellation"


def test_a_missing_named_agent_fails_the_run_and_never_falls_back() -> None:
    """§D-1's strict re-check. The forgiving `resolve_agent` would have handed the run the DEFAULT
    agent's toolset and privilege — a different blast radius than the owner authorized — so a vanished
    specialist fails the run instead, with no thread and no turn."""
    from app.domain.automation import AutomationSnapshot

    with _workspace(), _client() as c:
        svc, state = _svc(c), c.app.state
        (state.settings.agents_dir_path() / "ops").mkdir(parents=True, exist_ok=True)
        (state.settings.agents_dir_path() / "ops" / "SOUL.md").write_text("ops", encoding="utf-8")
        a = _run(svc.create(_draft(agent="ops", schedule="*/5 * * * *")))
        _due_now(c, a)
        snap = _run(svc.claim(a.id, expected_rev=a.rev))
        assert isinstance(snap, AutomationSnapshot) and snap.agent == "ops"

        # …the owner deletes the agent between the claim and the run
        (state.settings.agents_dir_path() / "ops" / "SOUL.md").unlink()
        (state.settings.agents_dir_path() / "ops").rmdir()
        built: list[str] = []

        import app.api.agent as agent_api

        real = agent_api._build_session
        agent_api._build_session = lambda *args, **kw: built.append("built") or _FakeSession()  # type: ignore[assignment]
        try:
            assert _run(_runner(c)._execute(snap)) == "error"
        finally:
            agent_api._build_session = real  # type: ignore[assignment]

        run = _run(state.automations.get_run(snap.run_id))
        assert run.status == "error" and "ops" in (run.error or "")
        assert built == []  # no session was ever built — no default-agent fallback
        assert run.thread_id is None and state.turns == {}


def test_the_terminal_mapping_is_honest_for_every_turn_outcome() -> None:
    """§D-2's table, as a pure function: a completed turn is the ONLY `ok`, a cap is an error, a
    deadline outranks the terminal string (both shutdown and timeout end a turn `cancelled`), and a
    headless suspend is an invariant violation rather than a quiet success."""
    with _workspace(), _client() as c:
        from app.domain.automation import AutomationSnapshot

        snap = AutomationSnapshot(
            run_id="r",
            automation_id="a",
            name="n",
            rev=1,
            trigger="scheduled",
            scheduled_for=None,
            tz="UTC",
            prompt="p",
            agent=None,
            privilege=None,
            question_policy="use_default",
            thread_mode="fresh",
            thread_id=None,
            timeout_s=30,
        )
        term = _runner(c)._terminal
        assert term(snap, "completed", timed_out=False)[0] == "ok"
        assert term(snap, "capped", timed_out=False)[0] == "error"
        assert term(snap, "error", timed_out=False)[0] == "error"
        assert term(snap, "cancelled", timed_out=False)[0] == "interrupted"
        assert term(snap, "cancelled", timed_out=True)[0] == "timed_out"
        assert term(snap, "completed", timed_out=True)[0] == "timed_out"  # the deadline outranks
        assert term(snap, "suspended", timed_out=False)[0] == "error"
        assert "invariant" in (term(snap, "suspended", timed_out=False)[1] or "")
        assert term(snap, None, timed_out=False)[0] == "error"


def test_the_arbiter_is_one_global_lock_shared_with_run_now() -> None:
    """Owner ruling 2. Concurrency 1 is a property of the RUNNER, not of one automation: while the
    arbiter is held, a poll tick does nothing at all and run-now refuses with the busy error 14c maps
    to 409 — both keyed on the same lock, not on a second gauge that could disagree."""
    from app.services.automations import AutomationBusy

    with _workspace(), _client() as c:
        svc = _svc(c)
        a = _run(svc.create(_draft(schedule="*/5 * * * *")))
        _due_now(c, a)
        runner = _runner(c)

        async def go():
            async with runner.arbiter:  # stand in for a run in flight
                assert runner.busy
                assert await runner.tick() == 0  # the loop declines to start anything
                try:
                    await runner.run_now(a.id)
                except AutomationBusy:
                    pass
                else:
                    raise AssertionError("run-now must refuse while the runner is busy")

        _run(go())
        assert _run(c.app.state.automations.runs(a.id)) == []  # nothing was claimed while busy
        assert not runner.busy


def test_a_tick_claims_and_runs_every_due_automation_then_prunes() -> None:
    with _workspace("automations:\n  keep_runs: 1\n"), _client() as c:
        svc, state = _svc(c), c.app.state
        a = _run(svc.create(_draft(name="one", schedule="*/5 * * * *")))
        b = _run(svc.create(_draft(name="two", schedule="*/5 * * * *")))
        _due_now(c, a)
        _due_now(c, b)
        with _fake_sessions(_FakeSession()):
            assert _run(_runner(c).tick()) == 2
        for auto in (a, b):
            runs = _run(state.automations.runs(auto.id))
            assert len(runs) == 1 and runs[0].status == "ok"  # keep_runs=1 pruned nothing yet
            assert _run(state.automations.get(auto.id)).next_run_at > _now()


# ── 7. threads ──────────────────────────────────────────────────────────────────────────────────


def test_fresh_mode_gets_a_new_archived_thread_per_run() -> None:
    with _workspace(), _client() as c:
        svc, state = _svc(c), c.app.state
        a = _run(svc.create(_draft(schedule="*/5 * * * *")))
        threads = []
        for _ in range(2):
            _due_now(c, a)
            snap = _run(svc.claim(a.id, expected_rev=_run(state.automations.get(a.id)).rev))
            with _fake_sessions(_FakeSession()):
                _run(_runner(c)._execute(snap))
            threads.append(_run(state.automations.get_run(snap.run_id)).thread_id)
        assert threads[0] != threads[1] and all(threads)
        assert _run(state.automations.get(a.id)).thread_id is None  # fresh mode owns no thread


def test_rolling_mode_reuses_one_thread_and_recreates_it_if_deleted() -> None:
    with _workspace(), _client() as c:
        svc, state = _svc(c), c.app.state
        a = _run(svc.create(_draft(thread_mode="rolling", schedule="*/5 * * * *")))

        def _one_run():
            _due_now(c, a)
            snap = _run(svc.claim(a.id, expected_rev=_run(state.automations.get(a.id)).rev))
            with _fake_sessions(_FakeSession()):
                _run(_runner(c)._execute(snap))
            return _run(state.automations.get_run(snap.run_id)).thread_id

        first, second = _one_run(), _one_run()
        assert first == second  # one continuing conversation
        assert _run(state.automations.get(a.id)).thread_id == first

        _run(state.threads.delete(first))  # the owner deletes it
        third = _one_run()
        assert third not in (None, first)  # recreated lazily, and the run row records which one
        assert _run(state.automations.get(a.id)).thread_id == third


def test_interactive_chat_into_a_rolling_thread_is_refused_but_a_run_thread_is_not() -> None:
    """§D-3: the rolling thread is the automation's own continuing conversation, so chatting into it
    would change what its next run reads. A FRESH run's thread is deliberately still chattable."""
    from fastapi import HTTPException

    from app.api.agent import _reject_automation_thread
    from app.domain.conversation import Thread

    with _workspace(), _client() as c:
        svc, state = _svc(c), c.app.state
        a = _run(svc.create(_draft(thread_mode="rolling", schedule="*/5 * * * *")))
        _due_now(c, a)
        snap = _run(svc.claim(a.id, expected_rev=a.rev))
        with _fake_sessions(_FakeSession()):
            _run(_runner(c)._execute(snap))
        rolling = _run(state.threads.get(_run(state.automations.get(a.id)).thread_id))

        try:
            _run(_reject_automation_thread(state, rolling.id))
        except HTTPException as exc:
            assert exc.status_code == 403 and "automation" in exc.detail
        else:
            raise AssertionError("chat into a rolling automation thread must be refused")

        ordinary = _run(state.threads.create(Thread()))
        _run(_reject_automation_thread(state, ordinary.id))  # no raise
        # and the endpoint itself refuses (the guard is wired, not just defined)
        r = c.post("/api/agent/chat", json={"text": "hello", "thread_id": rolling.id})
        assert r.status_code == 403


# ── 8. housekeeping ─────────────────────────────────────────────────────────────────────────────


def test_the_boot_sweep_turns_orphaned_runs_into_interrupted_with_an_event() -> None:
    """A `running` row is only ever written by a claim and only ever closed by its runner, so one that
    survives a restart means the process died mid-run. Left alone it would make the automation read as
    permanently busy — blocking run-now and delete forever."""
    from app.domain.automation import AutomationRun

    with _workspace(), _client() as c:
        svc, state = _svc(c), c.app.state
        a = _run(svc.create(_draft()))
        orphan = _run(state.automations.add_run(AutomationRun(automation_id=a.id, status="running")))
        assert _run(svc.sweep_orphans()) == 1

        run = _run(state.automations.get_run(orphan.id))
        assert run.status == "interrupted" and "server restarted" in (run.error or "")
        assert run.finished_at is not None
        audit = [e for e in _run(state.events.recent(20)) if e.run_id == orphan.id]
        assert audit and audit[0].origin_id == a.id and audit[0].actor.value == "automation"
        assert _run(svc.sweep_orphans()) == 0  # idempotent — nothing left open


def test_retention_prunes_old_runs_with_their_threads_but_never_the_rolling_one() -> None:
    """§D-1: an hourly automation would otherwise leave thousands of invisible archived threads. The
    run rows beyond `keep_runs` go WITH their per-run threads (and the messages inside them), while the
    automation's own rolling thread — shared by every run — is protected."""
    from app.domain.automation import AutomationRun
    from app.domain.conversation import Message, TextPart, Thread
    from app.domain.enums import Actor

    with _workspace("automations:\n  keep_runs: 2\n"), _client() as c:
        svc, state = _svc(c), c.app.state
        a = _run(svc.create(_draft()))
        made = []
        for i in range(4):
            t = _run(state.threads.create(Thread(title=f"run {i}", archived=True)))
            _run(
                state.messages.add(
                    Message(thread_id=t.id, role="user", actor=Actor.AUTOMATION, parts=[TextPart(text="hi")])
                )
            )
            _run(
                state.automations.add_run(
                    AutomationRun(
                        automation_id=a.id,
                        status="ok",
                        thread_id=t.id,
                        started_at=_now() - timedelta(minutes=10 - i),
                    )
                )
            )
            made.append(t.id)

        assert _run(svc.prune_runs(a.id)) == 2  # the two oldest
        kept = _run(state.automations.runs(a.id, limit=50))
        assert len(kept) == 2 and {r.thread_id for r in kept} == set(made[2:])
        # the unread marker the history renders (and 14c's mark-read writes) — idempotent, and absent
        # for a run that no longer exists
        assert all(r.read_at is None for r in kept)
        assert _run(state.automations.mark_run_read(kept[0].id, _now())) is True
        first_read = _run(state.automations.get_run(kept[0].id)).read_at
        assert first_read is not None
        assert _run(state.automations.mark_run_read(kept[0].id, _now() + timedelta(minutes=1))) is True
        assert _run(state.automations.get_run(kept[0].id)).read_at == first_read  # first read wins
        assert _run(state.automations.mark_run_read("gone", _now())) is False
        for gone in made[:2]:
            assert _run(state.threads.get(gone)) is None
            assert _run(state.messages.list(gone)) == []  # messages cascaded with the thread
        for alive in made[2:]:
            assert _run(state.threads.get(alive)) is not None

        # …and a rolling automation's shared thread survives pruning
        b = _run(svc.create(_draft(name="rolling", thread_mode="rolling")))
        shared = _run(state.threads.create(Thread(archived=True)))
        _run(state.automations.set_thread(b.id, shared.id))
        for i in range(3):
            _run(
                state.automations.add_run(
                    AutomationRun(
                        automation_id=b.id,
                        status="ok",
                        thread_id=shared.id,
                        started_at=_now() - timedelta(minutes=5 - i),
                    )
                )
            )
        assert _run(svc.prune_runs(b.id)) == 1
        assert _run(state.threads.get(shared.id)) is not None


def test_retention_never_deletes_a_thread_with_a_live_turn() -> None:
    """The HIGH the review caught in retention. A fresh run's thread is explicitly continuable in chat,
    so an old one can have a LIVE interactive turn when a later run triggers pruning — and deleting it
    would cascade its messages out from under the running drain task. The pair (run row + thread) is
    skipped WHOLE while the marker is held, and prunes on the next cycle once the turn ends."""
    from app.domain.automation import AutomationRun
    from app.domain.conversation import Thread
    from app.services.agent.turns import release, reserve

    with _workspace("automations:\n  keep_runs: 1\n"), _client() as c:
        svc, state = _svc(c), c.app.state
        a = _run(svc.create(_draft()))
        made = []
        for i in range(3):
            t = _run(state.threads.create(Thread(title=f"run {i}", archived=True)))
            _run(
                state.automations.add_run(
                    AutomationRun(
                        automation_id=a.id,
                        status="ok",
                        thread_id=t.id,
                        started_at=_now() - timedelta(minutes=10 - i),
                    )
                )
            )
            made.append(t.id)

        busy = reserve(state.turns, made[0], "chat")  # the owner is talking in the oldest run's thread
        assert _run(svc.prune_runs(a.id)) == 1  # only the OTHER excess run went
        assert _run(state.threads.get(made[0])) is not None  # the live thread is untouched…
        assert [r.thread_id for r in _run(state.automations.runs(a.id, limit=9))] == [made[2], made[0]]
        assert _run(state.threads.get(made[1])) is None  # …and the idle one really was pruned

        release(state.turns, busy)  # the turn ends
        assert _run(svc.prune_runs(a.id)) == 1  # …and the next cycle collects it
        assert _run(state.threads.get(made[0])) is None


def test_delete_refuses_while_a_thread_it_owns_has_a_live_turn() -> None:
    """The same HIGH on the delete path: the definition's threads are cascaded, so a live turn in ANY of
    them refuses the whole delete (the same busy answer the active-run guard gives) rather than deleting
    some threads and leaving history half-gone."""
    from app.domain.automation import AutomationRun
    from app.domain.conversation import Thread
    from app.services.agent.turns import release, reserve
    from app.services.automations import AutomationBusy

    with _workspace(), _client() as c:
        svc, state = _svc(c), c.app.state
        a = _run(svc.create(_draft()))
        t = _run(state.threads.create(Thread(archived=True)))
        _run(state.automations.add_run(AutomationRun(automation_id=a.id, status="ok", thread_id=t.id)))

        busy = reserve(state.turns, t.id, "chat")
        try:
            _run(svc.delete(a.id))
        except AutomationBusy:
            pass
        else:
            raise AssertionError("delete must refuse while one of its threads has a live turn")
        assert _run(state.automations.get(a.id)) is not None  # nothing was half-deleted
        assert _run(state.threads.get(t.id)) is not None

        release(state.turns, busy)
        _run(svc.delete(a.id))
        assert _run(state.automations.get(a.id)) is None and _run(state.threads.get(t.id)) is None
        assert state.turns == {}  # every marker the delete took was released


def test_a_deleting_transaction_holds_its_markers_past_the_commit() -> None:
    """Wave 2. Releasing a prune marker INSIDE the transaction leaves a window that is invisible but
    real: the delete has not committed, so every reader still sees the thread — and the marker is already
    free, so a chat POST can reserve it and start a turn on a row that is about to vanish. The ordering is
    asserted directly, by recording when the connection COMMITs against when the markers are released."""
    from app.domain.automation import AutomationRun
    from app.domain.conversation import Thread
    from app.services.automations import service as service_mod

    with _workspace("automations:\n  keep_runs: 1\n"), _client() as c:
        svc, state = _svc(c), c.app.state
        a = _run(svc.create(_draft()))
        threads = []
        for i in range(2):
            t = _run(state.threads.create(Thread(archived=True)))
            _run(
                state.automations.add_run(
                    AutomationRun(
                        automation_id=a.id,
                        status="ok",
                        thread_id=t.id,
                        started_at=_now() - timedelta(minutes=5 - i),
                    )
                )
            )
            threads.append(t.id)

        order: list[str] = []
        real_commit = state.db.conn.commit
        real_release = service_mod.release

        async def _commit():
            order.append("commit")
            return await real_commit()

        def _release(turns, handle):
            order.append("release")
            return real_release(turns, handle)

        state.db.conn.commit = _commit  # type: ignore[assignment]
        service_mod.release = _release  # type: ignore[assignment]
        try:
            assert _run(svc.prune_runs(a.id)) == 1
        finally:
            state.db.conn.commit = real_commit  # type: ignore[assignment]
            service_mod.release = real_release  # type: ignore[assignment]

        assert "commit" in order and "release" in order
        assert order.index("commit") < order.index("release"), (
            f"the prune marker was released before the delete committed: {order}"
        )
        assert state.turns == {}  # …and it really was released afterwards


def test_a_thread_deleted_between_the_load_and_the_reserve_is_refused() -> None:
    """Wave 2, the stale pre-read. Every mutating endpoint resolves its thread BEFORE it reserves the
    marker, so a retention prune (or a delete) committing in that window leaves the handler holding a
    `Thread` object for a row that is gone — and it would happily persist messages against it. With the
    marker held, `_revalidate_thread` is the point at which that becomes impossible: it re-reads, and a
    vanished thread is a 404 rather than a turn on a deleted row."""
    from fastapi import HTTPException

    from app.api.agent import _revalidate_thread
    from app.domain.conversation import Thread

    with _workspace(), _client() as c:
        state = c.app.state
        stale = _run(state.threads.create(Thread()))  # what the handler pre-read
        _run(_revalidate_thread(state, stale.id))  # still there → proceeds

        _run(state.threads.delete(stale.id))  # …retention wins the race and commits
        try:
            _run(_revalidate_thread(state, stale.id))
        except HTTPException as exc:
            assert exc.status_code == 404
        else:
            raise AssertionError("a turn must not start against a thread that was deleted under it")

        # …and the endpoint refuses end-to-end (a rolling thread it may no longer touch → 403)
        svc = _svc(c)
        a = _run(svc.create(_draft(thread_mode="rolling", schedule="*/5 * * * *")))
        _due_now(c, a)
        snap = _run(svc.claim(a.id, expected_rev=a.rev))
        with _fake_sessions(_FakeSession()):
            _run(_runner(c)._execute(snap))
        rolling = _run(state.automations.get(a.id)).thread_id
        assert c.post("/api/agent/compact", json={"thread_id": rolling}).status_code == 403
        assert c.post("/api/agent/plan", json={"thread_id": rolling, "steps": []}).status_code == 403
        assert state.turns == {}  # every refusal released the marker it took


def test_a_mode_switch_cannot_flip_ownership_under_a_live_turn() -> None:
    """Wave 2. `fresh ↔ rolling` is what decides whether the endpoints refuse a thread at all, so
    flipping it while a turn runs there would leave that turn writing into a conversation the automation
    now owns — a guard that already passed, invalidated behind its back. The update takes the SAME marker
    and refuses while the thread is busy."""
    from app.domain.conversation import Thread
    from app.services.agent.turns import release, reserve
    from app.services.automations import AutomationBusy

    with _workspace(), _client() as c:
        svc, state = _svc(c), c.app.state
        a = _run(svc.create(_draft(thread_mode="rolling")))
        t = _run(state.threads.create(Thread(archived=True)))
        _run(state.automations.set_thread(a.id, t.id))

        busy = reserve(state.turns, t.id, "chat")  # the owner is talking in it right now
        try:
            _run(svc.update(a.id, _draft(thread_mode="fresh")))
        except AutomationBusy:
            pass
        else:
            raise AssertionError("a mode switch must not flip ownership under a live turn")
        assert _run(state.automations.get(a.id)).thread_mode == "rolling"  # unchanged

        # …an edit that does NOT change the mode is unaffected by the live turn
        edited = _run(svc.update(a.id, _draft(thread_mode="rolling", prompt="still fine")))
        assert edited.prompt == "still fine"

        release(state.turns, busy)
        switched = _run(svc.update(a.id, _draft(thread_mode="fresh")))
        assert switched.thread_mode == "fresh" and state.turns == {}


def test_delete_refuses_while_a_run_is_active_then_cascades() -> None:
    from app.domain.automation import AutomationRun
    from app.domain.conversation import Thread
    from app.services.automations import AutomationBusy

    with _workspace(), _client() as c:
        svc, state = _svc(c), c.app.state
        a = _run(svc.create(_draft(thread_mode="rolling")))
        t = _run(state.threads.create(Thread(archived=True)))
        _run(state.automations.set_thread(a.id, t.id))
        live = _run(state.automations.add_run(AutomationRun(automation_id=a.id, status="running")))
        try:
            _run(svc.delete(a.id))
        except AutomationBusy:
            pass
        else:
            raise AssertionError("delete must refuse while a run is active")

        _run(svc.finish_run(live.id, status="ok"))
        _run(svc.delete(a.id))
        assert _run(state.automations.get(a.id)) is None
        assert _run(state.automations.get_run(live.id)) is None  # run rows cascaded
        assert _run(state.threads.get(t.id)) is None  # …and the rolling thread went with them


# ── 9. the session options object ───────────────────────────────────────────────────────────────


def _snapshot(**kw):
    from app.domain.automation import AutomationSnapshot

    base = dict(
        run_id="run-1",
        automation_id="auto-1",
        name="nightly",
        rev=1,
        trigger="scheduled",
        scheduled_for=None,
        tz="UTC",
        prompt="p",
        agent=None,
        privilege=None,
        question_policy="use_default",
        thread_mode="fresh",
        thread_id=None,
        timeout_s=30,
    )
    return AutomationSnapshot(**{**base, **kw})


def test_build_session_turns_the_snapshot_into_an_unattended_session() -> None:
    """§D-3, through the ONE builder: everything an automation changes is derived from the snapshot, and
    an interactive turn built by the same function is untouched."""
    from app.api.agent import _build_session
    from app.domain.conversation import Thread
    from app.domain.enums import Actor

    with _workspace(), _client() as c:
        state = c.app.state
        thread = _run(state.threads.create(Thread()))

        chat = _build_session(state, thread)
        assert chat._interactive and chat._origin.kind == "user_chat"
        assert chat._message_actor is Actor.USER and chat._question_policy == "skip"
        assert chat._steer_source is not None and chat._compaction_state is not None

        auto = _build_session(state, thread, automation=_snapshot())
        assert auto._interactive is False
        assert auto._origin.kind == "automation" and auto._origin.id == "auto-1"
        assert auto._origin.run_id == "run-1"  # the ancestry predicate every descendant preserves
        assert auto._message_actor is Actor.AUTOMATION
        assert auto._question_policy == "use_default"
        assert auto._steer_source is None  # a scheduled run has no composer to be steered from
        assert auto._compaction_state is None  # a fresh per-run thread cannot outlive its one turn
        assert auto._routing_state is not None  # routing stays live (failure fallback still applies)

        rolling = _build_session(state, thread, automation=_snapshot(thread_mode="rolling"))
        assert rolling._compaction_state is not None  # a rolling thread grows — it needs the machine


def test_the_injected_prompt_is_attributed_to_the_automation_not_the_owner() -> None:
    from app.api.agent import _build_session
    from app.domain.conversation import Thread

    with _workspace(), _client() as c:
        state = c.app.state
        thread = _run(state.threads.create(Thread()))
        session = _build_session(state, thread, automation=_snapshot(prompt="scheduled work"))

        async def _no_drive(_thread, mode=None):  # the model is not the subject here
            return
            yield

        session._drive = _no_drive  # type: ignore[assignment]
        _run(_drain(session.run_turn(thread, "scheduled work")))

        msgs = _run(state.messages.list(thread.id))
        assert len(msgs) == 1 and msgs[0].role == "user"  # the model's turn-taking slot is unchanged…
        assert msgs[0].actor.value == "automation"  # …but nobody typed it

        interactive = _build_session(state, thread)
        interactive._drive = _no_drive  # type: ignore[assignment]
        _run(_drain(interactive.run_turn(thread, "hello")))
        assert _run(state.messages.list(thread.id))[1].actor.value == "user"  # unchanged for chat


async def _drain(gen):
    return [ev async for ev in gen]


def test_reflection_is_disarmed_for_an_automation_and_unchanged_for_chat() -> None:
    """The `depth > 0` proxy re-expressed (§D-3). A cron run is depth 0, so the old predicate would have
    let a throwaway unattended task write the owner's durable memory. Keyed on the origin now — and the
    interactive and subagent answers are bit-identical to before."""
    from app.api.agent import _build_session
    from app.domain.conversation import Thread

    cfg = "memory:\n  enabled: true\n  reflection_enabled: true\n  reflection_interval: 1\n"
    with _workspace(cfg), _client() as c:
        state = c.app.state
        thread = _run(state.threads.create(Thread()))

        chat = _build_session(state, thread)
        chat._drive = _no_drive_gen  # type: ignore[assignment]
        _run(_drain(chat.run_turn(thread, "hello")))
        assert chat._reflect_now is True  # unchanged: an owner conversation still reflects

        auto = _build_session(state, thread, automation=_snapshot())
        auto._drive = _no_drive_gen  # type: ignore[assignment]
        _run(_drain(auto.run_turn(thread, "scheduled")))
        assert auto._reflect_now is False
        assert auto._reflection_eligible() is False and chat._reflection_eligible() is True


async def _no_drive_gen(_thread, mode=None):
    return
    yield


# ── 10. the question policy ladder ──────────────────────────────────────────────────────────────


def _question_call(c, session, *, args):
    from app.domain.conversation import Message, Thread, ToolCallPart
    from app.domain.enums import Actor, RunState

    state = c.app.state
    thread = _run(state.threads.create(Thread()))
    assistant = Message(
        thread_id=thread.id,
        role="assistant",
        actor=Actor.AGENT,
        agent="default",
        parts=[ToolCallPart(call_id=uuid.uuid4().hex, tool="question", args=args, state=RunState.PENDING)],
    )
    _run(state.messages.add(assistant))
    return thread, assistant


def _headless_session(c, **kw):
    from app.services.agent.session import AgentSession

    s = c.app.state
    return AgentSession(
        s.threads,
        s.messages,
        s.inference,
        s.settings,
        s.actions,
        s.settings.resolve_agent(None),
        interactive=False,
        **kw,
    )


def _guard():
    from app.services.agent.session import _LoopGuard

    return _LoopGuard(max_repeat=5, max_per_tool=10)


def test_the_unattended_question_ladder_resolves_and_keeps_the_run_moving() -> None:
    """Owner ruling 1 + council R-1. All four arms, each proving the turn is NOT suspended and the call
    is NOT left AWAITING_ANSWER — an unattended run must never park on a bubble nobody will see."""
    from app.domain.event import Origin
    from app.services.agent.prompts import resolve

    origin = Origin(kind="automation", id="a", run_id="r")
    with _workspace(), _client() as c:
        cases = [
            ({"prompt": "Which host?", "default": "emma", "choices": ["corsair", "emma"]}, "emma"),
            ({"prompt": "Which host?", "choices": ["corsair", "emma"]}, "corsair"),
            ({"prompt": "Proceed?"}, resolve("unattended_answer", c.app.state.settings)),
        ]
        for args, expected in cases:
            session = _headless_session(c, question_policy="use_default", origin=origin)
            thread, assistant = _question_call(c, session, args=args)
            events, suspended, progress = drain_run_calls(session, thread, assistant, {}, _guard())
            result = next(e for e in events if e.event == "tool.result").data["result"]
            assert not suspended and progress, args
            assert result["state"] == "ok" and result["output"] == expected, args
            assert assistant.tool_calls()[0].state.value == "ok"
            assert not any(e.event == "tool.question" for e in events)


def test_skip_keeps_todays_deny_in_place_and_subagents_are_unaffected() -> None:
    """`skip` is byte-for-byte the old headless behavior, and it is what a SUBAGENT still gets: the
    policy is an automation session option, defaulted to `skip`, so nothing about child sessions moved."""
    from app.domain.event import Origin

    with _workspace(), _client() as c:
        args = {"prompt": "Which host?", "default": "emma"}

        skipper = _headless_session(
            c, question_policy="skip", origin=Origin(kind="automation", id="a", run_id="r")
        )
        thread, assistant = _question_call(c, skipper, args=args)
        events, suspended, _ = drain_run_calls(skipper, thread, assistant, {}, _guard())
        result = next(e for e in events if e.event == "tool.result").data["result"]
        assert not suspended and result["state"] == "denied"
        assert "automation run" in result["summary"]  # honest about WHICH headless session it is

        child = _headless_session(c)  # a subagent: default policy, default origin
        assert child._question_policy == "skip"
        thread2, assistant2 = _question_call(c, child, args=args)
        events2, suspended2, _ = drain_run_calls(child, thread2, assistant2, {}, _guard())
        result2 = next(e for e in events2 if e.event == "tool.result").data["result"]
        assert not suspended2 and result2["state"] == "denied"
        assert "headless subagent" in result2["summary"]  # the original wording, unchanged


def test_an_unreadable_stored_privilege_floors_instead_of_widening() -> None:
    """Post-14b review, MED. A row written by a NEWER build can carry a privilege this one has never
    heard of. Narrowing it to NULL would mean "the agent's own level" — on a FULL agent, MORE capability
    than the row asked for. It floors to READONLY instead; an actually-NULL column still means the
    agent's own, because that is what the owner wrote."""
    from app.domain.enums import Privilege

    with _workspace(), _client() as c:
        a = _run(_svc(c).create(_draft(privilege=Privilege.AUTO_LOW)))
        _run(
            c.app.state.db.execute("UPDATE automations SET privilege = ? WHERE id = ?", ("quarantined", a.id))
        )
        assert _run(c.app.state.automations.get(a.id)).privilege is Privilege.READONLY

        _run(c.app.state.db.execute("UPDATE automations SET privilege = NULL WHERE id = ?", (a.id,)))
        assert _run(c.app.state.automations.get(a.id)).privilege is None


def test_the_question_tool_offers_choices_and_default_additively() -> None:
    """The A2 bubble shape, additive: the fields reach the model's schema, and the OFFER rides in the
    result's `data` so the loop's ladder never has to know this input model's field names."""
    from app.core.tool import InvocationContext
    from app.domain.enums import Actor, Privilege
    from app.services.agent.question import QuestionInput, question

    ctx = InvocationContext(actor=Actor.AGENT, privilege=Privilege.CONFIRM)
    plain = _run(question(QuestionInput(prompt="Which host?"), ctx))
    assert plain.state.value == "awaiting_answer" and plain.data == {}  # unchanged for old calls

    offered = _run(
        question(QuestionInput(prompt="Which?", choices=[" corsair ", "", "emma"], default=" emma "), ctx)
    )
    assert offered.data == {"choices": ["corsair", "emma"], "default": "emma"}  # trimmed, blanks dropped

    schema = QuestionInput.model_json_schema()["properties"]
    assert "choices" in schema and "default" in schema
    assert QuestionInput(prompt="x").choices is None  # both optional

    # …and the offer is BOUNDED (post-14b review, LOW): a phone renders these as buttons, so an
    # over-long list or a paragraph-length option fails validation — which the loop already turns into a
    # repair-this-call error — rather than being silently truncated or rendered as a wall of chips.
    from pydantic import ValidationError

    from app.services.agent.question import MAX_CHOICE_CHARS, MAX_CHOICES

    QuestionInput(prompt="x", choices=["a"] * MAX_CHOICES)  # the cap itself is fine
    for over in ({"choices": ["a"] * (MAX_CHOICES + 1)}, {"choices": ["x" * (MAX_CHOICE_CHARS + 1)]}):
        try:
            QuestionInput(prompt="x", **over)
        except ValidationError:
            continue
        raise AssertionError(f"{over} should have been refused")


def test_an_interactive_question_still_suspends_with_the_new_fields() -> None:
    """The regression guard on the additive change: an interactive turn must still park on the bubble."""
    from app.services.agent.session import AgentSession

    with _workspace(), _client() as c:
        s = c.app.state
        session = AgentSession(
            s.threads, s.messages, s.inference, s.settings, s.actions, s.settings.resolve_agent(None)
        )
        thread, assistant = _question_call(
            c, session, args={"prompt": "Which host?", "choices": ["corsair", "emma"]}
        )
        events, suspended, _ = drain_run_calls(session, thread, assistant, {}, _guard())
        assert suspended
        q = next(e for e in events if e.event == "tool.question")
        assert q.data["args"]["choices"] == ["corsair", "emma"]  # the FE renders chips off the args
        assert assistant.tool_calls()[0].state.value == "awaiting_answer"


# ── 11. the config section ──────────────────────────────────────────────────────────────────────


def test_the_automations_config_section_defaults_and_is_read_live() -> None:
    """§D-7: every tunable in one section, no magic numbers, and read LIVE off the shared Settings so a
    Conf edit applies without a restart."""
    from app.config import AutomationsCfg

    d = AutomationsCfg()
    assert (d.enabled, d.poll_seconds, d.default_timeout_s) == (True, 10, 300)
    assert (d.max_count, d.misfire_grace_s, d.keep_runs) == (20, 300, 50)

    cfg = "automations:\n  poll_seconds: 30\n  keep_runs: 5\n  enabled: false\n"
    with _workspace(cfg), _client() as c:
        live = c.app.state.settings.automations
        assert (live.poll_seconds, live.keep_runs, live.enabled) == (30, 5, False)
        assert _svc(c).cfg is live  # the service reads the SAME object, never a boot-time copy
        live.keep_runs = 7  # …a hot-applied edit is visible immediately
        assert _svc(c).cfg.keep_runs == 7


def test_the_runner_is_wired_into_the_lifespan_after_the_sweeps() -> None:
    """The boot ordering §D-2 requires: repo + service + a completed orphan sweep BEFORE the loop task
    exists, and the loop cancelled at shutdown (before the DB it writes through is closed)."""
    with _workspace(), _client() as c:
        state = c.app.state
        assert state.automations is not None and state.automation_service is not None
        assert state.automation_runner is not None
        assert not state.automation_task.done()
        assert state.automation_runner.arbiter is state.automation_runner._arbiter
    assert state.automation_task.cancelled() or state.automation_task.done()


def test_the_automation_turn_kind_counts_against_the_cap() -> None:
    """§D-2: `max_active_turns` sees automation turns — a scheduled run costs the same capacity as a
    chat turn, so it is task-bearing and counted, not exempt like the inline sync kinds."""
    from app.services.agent.turns import TASK_KINDS, TurnHandle, active_task_turns

    assert "automation" in TASK_KINDS
    turns = {"t1": TurnHandle(thread_id="t1", kind="automation")}
    assert active_task_turns(turns) == 1


if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    for fn in fns:
        fn()
        print(f"ok  {fn.__name__}")
    print(f"\n{len(fns)} passed")
