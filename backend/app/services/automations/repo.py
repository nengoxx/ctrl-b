"""AutomationRepo — SQLite persistence for `automations` + `automation_runs` (A3, §D-1).

Hand-written SQL, one class for both tables (the `ThreadRepo`/`MessageRepo` file pattern, minus the
split: a run has no life outside its automation, and the claim writes both tables in ONE transaction).
Writes go through `Database.execute`, reads through `Database.query`; the claim's multi-statement
sequence batches via `Database.transaction()` in `AutomationService` — this layer stays dumb about
policy, exactly like the conversation repos.

Two boundaries live here and nowhere else:

  * **Instant conversion.** Storage is UTC epoch integers (see the migration-5 comment), the domain is
    aware `datetime`s. `_epoch`/`_dt` are the only place that crossing happens.
  * **Lenient narrowing of the stored vocabularies.** A row written by a NEWER build (rollback is by
    tag — D32) can legitimately carry a `privilege`/`question_policy`/`thread_mode`/`status`/`trigger`
    this build has never heard of. The domain models are Literal-typed, so validating one raises —
    inside a list comprehension over the whole result, taking the entire list/history read down with
    it. Each read narrows to a documented fallback instead, chosen to be the *less capable* arm
    (unknown privilege → NULL = the agent's own · unknown policy → `skip` = ask nobody, do less ·
    unknown mode → `fresh` = a throwaway thread), so an unreadable row can never widen what a run is
    allowed to do. An unrecognized RUN STATUS keeps the raw text in `error` rather than pretending —
    the same "degrade the field, keep the record readable" rule as `events.recent()`.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, get_args

from app.db import Database
from app.domain.automation import (
    Automation,
    AutomationRun,
    QuestionPolicy,
    RunStatus,
    RunTrigger,
    ThreadMode,
)
from app.domain.enums import Privilege

_POLICIES: frozenset[str] = frozenset(get_args(QuestionPolicy))
_MODES: frozenset[str] = frozenset(get_args(ThreadMode))
_STATUSES: frozenset[str] = frozenset(get_args(RunStatus))
_TRIGGERS: frozenset[str] = frozenset(get_args(RunTrigger))
_PRIVILEGES: frozenset[str] = frozenset(p.value for p in Privilege)

#: Every column of `automations`, in the order both the INSERT and the full-row UPDATE use. Spelled
#: once so an added column cannot land in one statement and be forgotten in the other.
_COLUMNS = (
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
)


def _epoch(dt: datetime | None) -> int | None:
    """Aware datetime → UTC epoch seconds. `.timestamp()` resolves a DST fold via the datetime's own
    `fold` flag, which is why the schedule layer hands back aware, zone-bearing values."""
    return None if dt is None else int(dt.timestamp())


def _dt(value: Any) -> datetime | None:
    return None if value is None else datetime.fromtimestamp(int(value), tz=timezone.utc)


def _narrow(value: Any, allowed: frozenset[str], fallback: str) -> str:
    """A stored vocabulary value narrowed to what this build understands (see the module docstring for
    why the fallbacks lean toward *less* capability)."""
    return value if isinstance(value, str) and value in allowed else fallback


class AutomationRepo:
    def __init__(self, db: Database) -> None:
        self._db = db

    @property
    def db(self) -> Database:
        """The underlying `Database`, so the service can open ONE `transaction()` around the claim's
        re-read + advance + insert (the `MessageRepo.db` precedent). Writes still go through the
        methods below."""
        return self._db

    # ── automations ────────────────────────────────────────────────────────────────────────────────

    async def create(self, a: Automation) -> Automation:
        await self._db.execute(
            f"INSERT INTO automations ({', '.join(_COLUMNS)}) VALUES ({', '.join('?' for _ in _COLUMNS)})",
            self._values(a),
        )
        return a

    async def update(self, a: Automation) -> Automation:
        """Rewrite every mutable column of one row (the service always holds a complete `Automation`, so
        a partial-update method would only invite two writers with different ideas of the row)."""
        assignments = ", ".join(f"{c} = ?" for c in _COLUMNS if c not in ("id", "created_at"))
        values = tuple(
            v for c, v in zip(_COLUMNS, self._values(a), strict=True) if c not in ("id", "created_at")
        )
        await self._db.execute(f"UPDATE automations SET {assignments} WHERE id = ?", (*values, a.id))
        return a

    async def get(self, automation_id: str) -> Automation | None:
        rows = await self._db.query("SELECT * FROM automations WHERE id = ?", (automation_id,))
        return self._row(rows[0]) if rows else None

    async def list(self) -> list[Automation]:
        rows = await self._db.query("SELECT * FROM automations ORDER BY created_at ASC, rowid ASC")
        return [self._row(r) for r in rows]

    async def count(self) -> int:
        """ALL definitions, enabled or not — the `max_count` cap counts the row, not its state (§D-1).
        Read inside the service's cap transaction, so the count and the insert cannot race."""
        rows = await self._db.query("SELECT COUNT(*) AS n FROM automations")
        return int(rows[0]["n"]) if rows else 0

    async def delete(self, automation_id: str) -> bool:
        """Drop a definition; its run rows go with it via the FK cascade. Returns whether a row went.
        Threads are NOT touched here — they are not owned by the FK (see the migration comment), so the
        service deletes them explicitly and in the right order."""
        rows = await self._db.query("SELECT id FROM automations WHERE id = ?", (automation_id,))
        if not rows:
            return False
        await self._db.execute("DELETE FROM automations WHERE id = ?", (automation_id,))
        return True

    async def due(self, now: datetime, *, limit: int = 50) -> list[Automation]:
        """Enabled automations whose `next_run_at` has arrived, soonest first — the poll loop's scan.

        `enabled = 1` AND `next_run_at IS NOT NULL` are both required even though the service nulls
        `next_run_at` on disable: the pair keeps the scan correct against a row written by any other
        path (a manual DB edit, a future feature), and "disabled rows are never claimed" is an invariant
        worth being true twice. Ordering by the due time means a backlog is worked oldest-slot-first.
        """
        rows = await self._db.query(
            "SELECT * FROM automations WHERE enabled = 1 AND next_run_at IS NOT NULL "
            "AND next_run_at <= ? ORDER BY next_run_at ASC LIMIT ?",
            (_epoch(now), max(1, limit)),
        )
        return [self._row(r) for r in rows]

    async def set_next_run(self, automation_id: str, when: datetime | None) -> None:
        await self._db.execute(
            "UPDATE automations SET next_run_at = ? WHERE id = ?", (_epoch(when), automation_id)
        )

    async def set_thread(self, automation_id: str, thread_id: str | None) -> None:
        """Point a ROLLING automation at its thread. Deliberately does NOT bump `rev`: which thread the
        runner ended up using is machinery, not a definition change, and bumping would invalidate a
        claim that is already in flight."""
        await self._db.execute(
            "UPDATE automations SET thread_id = ? WHERE id = ?", (thread_id, automation_id)
        )

    async def rolling_owner(self, thread_id: str) -> Automation | None:
        """The automation that OWNS this thread as its rolling conversation, if any — the guard behind
        "interactive chat against an automation-owned rolling thread is rejected" (§D-3). Unindexed on
        purpose: `max_count` bounds this table to a couple of dozen rows, so the scan is cheaper than
        an index to maintain, and a `fresh` automation never matches (its `thread_id` stays NULL)."""
        rows = await self._db.query(
            "SELECT * FROM automations WHERE thread_id = ? AND thread_mode = 'rolling'", (thread_id,)
        )
        return self._row(rows[0]) if rows else None

    # ── runs ──────────────────────────────────────────────────────────────────────────────────────

    async def add_run(self, run: AutomationRun) -> AutomationRun:
        await self._db.execute(
            "INSERT INTO automation_runs (id, automation_id, trigger, scheduled_for, started_at, "
            "finished_at, status, error, thread_id, read_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                run.id,
                run.automation_id,
                run.trigger,
                _epoch(run.scheduled_for),
                _epoch(run.started_at),
                _epoch(run.finished_at),
                run.status,
                run.error,
                run.thread_id,
                _epoch(run.read_at),
            ),
        )
        return run

    async def get_run(self, run_id: str) -> AutomationRun | None:
        rows = await self._db.query("SELECT * FROM automation_runs WHERE id = ?", (run_id,))
        return self._run_row(rows[0]) if rows else None

    async def finish_run(
        self,
        run_id: str,
        *,
        status: RunStatus,
        finished_at: datetime,
        error: str | None = None,
        thread_id: str | None = None,
    ) -> None:
        """Close a run. `thread_id` is written only when supplied (`COALESCE`), so a finalizer that
        never got as far as resolving a thread cannot erase one an earlier step already recorded."""
        await self._db.execute(
            "UPDATE automation_runs SET status = ?, finished_at = ?, error = ?, "
            "thread_id = COALESCE(?, thread_id) WHERE id = ?",
            (status, _epoch(finished_at), error, thread_id, run_id),
        )

    async def set_run_thread(self, run_id: str, thread_id: str) -> None:
        await self._db.execute("UPDATE automation_runs SET thread_id = ? WHERE id = ?", (thread_id, run_id))

    async def runs(self, automation_id: str, *, limit: int = 20) -> list[AutomationRun]:
        rows = await self._db.query(
            "SELECT * FROM automation_runs WHERE automation_id = ? "
            "ORDER BY started_at DESC, rowid DESC LIMIT ?",
            (automation_id, max(1, limit)),
        )
        return [self._run_row(r) for r in rows]

    async def open_runs(self, automation_id: str | None = None) -> list[AutomationRun]:
        """Runs still marked `running`. Two callers, one query: the boot orphan sweep (all automations —
        after a restart there is by definition no live run, so every one of these is stale) and the
        "is this automation busy?" check the 14c DELETE/run-now paths need."""
        sql = "SELECT * FROM automation_runs WHERE status = 'running'"
        params: tuple[Any, ...] = ()
        if automation_id is not None:
            sql += " AND automation_id = ?"
            params = (automation_id,)
        sql += " ORDER BY started_at ASC, rowid ASC"
        return [self._run_row(r) for r in await self._db.query(sql, params)]

    async def latest_runs(self) -> dict[str, AutomationRun]:
        """The newest run of EVERY automation, keyed by automation id — the 14c list's last-status chip.

        One window query rather than a `runs(id, limit=1)` per row: the list is refetched on every Conf
        entry, and a query-per-automation would make the payload's cost scale with `max_count` for data
        SQLite can group in a single pass. The `ORDER BY` inside the partition is deliberately the same
        `started_at DESC, rowid DESC` the history read uses, so the chip can never disagree with the row
        at the top of the history it links to.
        """
        rows = await self._db.query(
            "SELECT * FROM (SELECT *, ROW_NUMBER() OVER (PARTITION BY automation_id "
            "ORDER BY started_at DESC, rowid DESC) AS rn FROM automation_runs) WHERE rn = 1"
        )
        return {r["automation_id"]: self._run_row(r) for r in rows}

    async def unread_counts(self) -> dict[str, int]:
        """Per automation, how many FINISHED runs the owner has not opened yet (the 14c unread badge).

        Only terminal runs count: a run that is still going is not a result to read. The filter is
        `status <> 'running'` rather than a list of the five terminal names on purpose — it matches
        `_run_row`'s lenient narrowing, where a status this build does not recognise degrades to `error`
        (terminal). A row a newer build wrote therefore counts as unread rather than silently vanishing
        from the badge.
        """
        rows = await self._db.query(
            "SELECT automation_id, COUNT(*) AS n FROM automation_runs "
            "WHERE read_at IS NULL AND status <> 'running' GROUP BY automation_id"
        )
        return {r["automation_id"]: int(r["n"]) for r in rows}

    async def mark_run_read(self, run_id: str, when: datetime) -> bool:
        """Clear a run's unread marker (idempotent — an already-read run keeps its FIRST `read_at`).

        First-writer-wins in ONE statement (post-14c review, MED): `COALESCE` makes the "only if unread"
        decision inside the write, so two marks racing — the history's open-sweep and a refetch behind
        it — cannot both read NULL and have the second overwrite the first timestamp. The existence
        probe stays a separate read only because the caller needs 404-vs-200, which an UPDATE cannot
        report on its own here.
        """
        rows = await self._db.query("SELECT id FROM automation_runs WHERE id = ?", (run_id,))
        if not rows:
            return False
        await self._db.execute(
            "UPDATE automation_runs SET read_at = COALESCE(read_at, ?) WHERE id = ?",
            (_epoch(when), run_id),
        )
        return True

    async def excess_runs(self, automation_id: str, keep: int) -> list[AutomationRun]:
        """The run rows beyond the newest `keep` — retention's input (§D-1). `LIMIT -1 OFFSET keep` is
        SQLite's "everything after the first N" (there is no bare OFFSET), applied to the same
        newest-first ordering the history reads use, so what survives is exactly what the UI shows."""
        rows = await self._db.query(
            "SELECT * FROM automation_runs WHERE automation_id = ? "
            "ORDER BY started_at DESC, rowid DESC LIMIT -1 OFFSET ?",
            (automation_id, max(0, keep)),
        )
        return [self._run_row(r) for r in rows]

    async def delete_run(self, run_id: str) -> None:
        await self._db.execute("DELETE FROM automation_runs WHERE id = ?", (run_id,))

    # ── row mapping ───────────────────────────────────────────────────────────────────────────────

    @staticmethod
    def _values(a: Automation) -> tuple:
        return (
            a.id,
            a.name,
            int(a.enabled),
            a.schedule,
            a.tz,
            a.prompt,
            a.agent,
            a.privilege.value if a.privilege is not None else None,
            a.question_policy,
            a.thread_mode,
            a.thread_id,
            a.timeout_s,
            _epoch(a.next_run_at),
            a.rev,
            _epoch(a.created_at),
            _epoch(a.updated_at),
        )

    @staticmethod
    def _row(r) -> Automation:
        raw_priv = r["privilege"]
        return Automation(
            id=r["id"],
            name=r["name"],
            enabled=bool(r["enabled"]),
            schedule=r["schedule"],
            tz=r["tz"],
            prompt=r["prompt"],
            agent=r["agent"],
            # A stored privilege this build cannot read narrows to READONLY — the floor of the ladder —
            # NOT to NULL (post-14b review, MED). NULL means "the agent's own level", so on a FULL agent
            # it would turn an unreadable value into MORE capability than the row asked for: the exact
            # inversion of the less-capable-arm rule the other fallbacks follow. A NULL column is still
            # "the agent's own" (that is what the owner wrote); only an unrecognized VALUE floors.
            privilege=(
                Privilege(raw_priv)
                if raw_priv in _PRIVILEGES
                else (None if raw_priv is None else Privilege.READONLY)
            ),
            question_policy=_narrow(r["question_policy"], _POLICIES, "skip"),  # type: ignore[arg-type]
            thread_mode=_narrow(r["thread_mode"], _MODES, "fresh"),  # type: ignore[arg-type]
            thread_id=r["thread_id"],
            timeout_s=r["timeout_s"],
            next_run_at=_dt(r["next_run_at"]),
            rev=int(r["rev"]),
            created_at=_dt(r["created_at"]) or datetime.now(timezone.utc),
            updated_at=_dt(r["updated_at"]) or datetime.now(timezone.utc),
        )

    @staticmethod
    def _run_row(r) -> AutomationRun:
        status, error = r["status"], r["error"]
        if status not in _STATUSES:
            # Keep the RAW value where a human will read it instead of coercing it away silently: the
            # history is an audit surface, and "this build could not read the status" is the honest
            # thing to show for a row a newer build wrote.
            error = f"unrecognized status {status!r}" + (f" — {error}" if error else "")
            status = "error"
        return AutomationRun(
            id=r["id"],
            automation_id=r["automation_id"],
            trigger=_narrow(r["trigger"], _TRIGGERS, "scheduled"),  # type: ignore[arg-type]
            scheduled_for=_dt(r["scheduled_for"]),
            started_at=_dt(r["started_at"]) or datetime.now(timezone.utc),
            finished_at=_dt(r["finished_at"]),
            status=status,  # type: ignore[arg-type]
            error=error,
            thread_id=r["thread_id"],
            read_at=_dt(r["read_at"]),
        )
