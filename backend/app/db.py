"""SQLite persistence (Phase 0 slice).

All operations share **one** aiosqlite connection whose single worker thread serializes them, so a
process-wide write lock (`_write_lock`) is enough to keep multi-statement writes coherent and
`SQLITE_BUSY` is effectively impossible today (WAL is enabled but its cross-connection read
concurrency is unused — the named seam is a dedicated reader-pool if read latency ever matters, and
`PRAGMA busy_timeout` future-proofs it). See DESIGN.md §8. Migrations are numbered SQL blocks applied
in order and tracked in `schema_version` — each one **atomically together with its version stamp**
(`_apply_migration`), so a crash mid-migration can never leave a database whose shape is ahead of its
recorded version; no ORM (hand-written SQL is enough at this scale).

Multi-statement write *sequences* (compaction's summary-insert + flag-flips, the plan/apply/exec
message pairs) commit atomically via `transaction()` (SYS-1) — otherwise `execute()` commits per
statement and a crash mid-sequence tears state.

Phase 0 creates the v1 tables the rest of the app builds on — threads, messages, memory,
events; migration 5 adds the automations pair (A3/D49). Repositories and later tables
(push_subscriptions, pending_actions) arrive with the phases that need them.
"""

from __future__ import annotations

import asyncio
import contextlib
import contextvars
import os
from collections.abc import AsyncIterator
from pathlib import Path

import aiosqlite
import anyio

#: Milliseconds SQLite waits on a locked database before returning SQLITE_BUSY. Moot with today's
#: single shared connection (the worker thread already serializes every op), but set at connect so
#: the reader-pool seam (SYS-1) is future-proofed the day a second connection appears.
BUSY_TIMEOUT_MS = 5000

#: Marks an open `transaction()` on the current context. `execute()` reads it to *join* the open
#: transaction (skip lock re-acquire + per-statement commit) instead of opening its own. Set/reset
#: only by `transaction()`; nested `transaction()` is a programming error (raises).
_in_transaction: contextvars.ContextVar[bool] = contextvars.ContextVar("db_in_transaction", default=False)

# Numbered migrations. Append new (version, sql) tuples; never edit a shipped one.
# Authoring rule: a script contains DDL/DML only — NO `BEGIN`/`COMMIT`/`ROLLBACK`. `_apply_migration`
# wraps the script and its version stamp in one transaction for you; own transaction control would
# close that one early and re-open the partial-application window it exists to shut.
# Release-compat rule (D32 amendment, expand/contract): migrations are FORWARD-ONLY and prod code
# rolls back by tag, so every change ships ADDITIVE first (new nullable column / new table); a
# DESTRUCTIVE contraction (drop/rename) may land at the earliest ONE release after the code stopped
# using the old shape, marked `DEPRECATED since vX, DROP in vY` at the site.
MIGRATIONS: list[tuple[int, str]] = [
    (
        1,
        """
        CREATE TABLE threads (
            id          TEXT PRIMARY KEY,
            title       TEXT,
            agent       TEXT,
            created_at  TEXT NOT NULL,
            updated_at  TEXT NOT NULL,
            archived    INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE messages (
            id          TEXT PRIMARY KEY,
            thread_id   TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
            role        TEXT NOT NULL,
            parts       TEXT NOT NULL,          -- JSON: list[Part] (DESIGN §4)
            actor       TEXT NOT NULL DEFAULT 'user',
            ts          TEXT NOT NULL,
            tokens      INTEGER,
            compacted   INTEGER NOT NULL DEFAULT 0
        );
        CREATE INDEX idx_messages_thread ON messages(thread_id, ts);

        CREATE TABLE memory (
            id          TEXT PRIMARY KEY,
            kind        TEXT NOT NULL,          -- 'fact' | 'summary'
            text        TEXT NOT NULL,
            created_at  TEXT NOT NULL,
            pinned      INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE events (
            id          TEXT PRIMARY KEY,
            ts          TEXT NOT NULL,
            actor       TEXT NOT NULL,          -- user | agent | system | automation
            action      TEXT NOT NULL,
            target      TEXT,
            status      TEXT NOT NULL,
            summary     TEXT,
            output      TEXT                    -- redacted before write (never raw secrets)
        );
        CREATE INDEX idx_events_ts ON events(ts);
        """,
    ),
    (
        2,
        # Per-turn agent attribution (7e-c, D15 #5). Nullable: NULL = legacy rows / non-assistant
        # turns. Set to the resolved AgentDef name on each assistant message so restore shows the
        # agent per-turn across `/agent` switches and resume can continue as the last turn's agent.
        "ALTER TABLE messages ADD COLUMN agent TEXT;",
    ),
    (
        3,
        # session_search (7e-e, D15 #7). An FTS5 index over the *text* of user/assistant messages so
        # the agent can recall past sessions. The searchable text is derived (the concatenated
        # TextPart text inside the JSON `parts` column, reasoning/tool parts excluded), so the index
        # is kept in sync by triggers that extract it with json_each — no coupling to MessageRepo,
        # and the JSON `parts` shape stays the single source of truth. `message_id`/`thread_id` are
        # UNINDEXED (stored for retrieval, not searched); the FTS rowid mirrors `messages.rowid`.
        # Archived (ephemeral subagent) threads are filtered at *query* time, not here, so a thread's
        # archived flag stays live without re-indexing. Backfill populates existing rows in one pass.
        """
        CREATE VIRTUAL TABLE messages_fts USING fts5(
            text,
            message_id UNINDEXED,
            thread_id  UNINDEXED
        );

        CREATE TRIGGER messages_fts_ai AFTER INSERT ON messages
        WHEN new.role IN ('user', 'assistant') BEGIN
            INSERT INTO messages_fts(rowid, text, message_id, thread_id)
            VALUES (
                new.rowid,
                (SELECT group_concat(json_extract(value, '$.text'), '')
                   FROM json_each(new.parts) WHERE json_extract(value, '$.type') = 'text'),
                new.id, new.thread_id
            );
        END;

        CREATE TRIGGER messages_fts_ad AFTER DELETE ON messages BEGIN
            DELETE FROM messages_fts WHERE rowid = old.rowid;
        END;

        CREATE TRIGGER messages_fts_au AFTER UPDATE ON messages BEGIN
            DELETE FROM messages_fts WHERE rowid = old.rowid;
            INSERT INTO messages_fts(rowid, text, message_id, thread_id)
            SELECT
                new.rowid,
                (SELECT group_concat(json_extract(value, '$.text'), '')
                   FROM json_each(new.parts) WHERE json_extract(value, '$.type') = 'text'),
                new.id, new.thread_id
            WHERE new.role IN ('user', 'assistant');
        END;

        INSERT INTO messages_fts(rowid, text, message_id, thread_id)
        SELECT
            m.rowid,
            (SELECT group_concat(json_extract(value, '$.text'), '')
               FROM json_each(m.parts) WHERE json_extract(value, '$.type') = 'text'),
            m.id, m.thread_id
        FROM messages m WHERE m.role IN ('user', 'assistant');
        """,
    ),
    (
        4,
        # Action attribution (A3 slice 1, D49 / AUTOMATIONS_PLAN §D-4). `origin` is the IMMEDIATE
        # initiator of the invocation (user_chat | automation | subagent | system); `origin_id` names it
        # within that kind (an automation's id, a subagent's agent name); `run_id` is the automation-run
        # id, preserved through every descendant — the authoritative "descended from an automation"
        # predicate; `decision` is why the gate let the call through (auto | confirmed | approval), or
        # `policy` when it denied it. Purely additive: `origin`'s NOT NULL default backfills every
        # existing row as the interactive chat action it was, the rest read NULL.
        """
        ALTER TABLE events ADD COLUMN origin     TEXT NOT NULL DEFAULT 'user_chat';
        ALTER TABLE events ADD COLUMN origin_id  TEXT;
        ALTER TABLE events ADD COLUMN run_id     TEXT;
        ALTER TABLE events ADD COLUMN decision   TEXT;
        """,
    ),
    (
        5,
        # Scheduled automations (A3 slice 2, D49 / AUTOMATIONS_PLAN §D-1). Two new tables, nothing
        # altered — the definitions the owner (and, from slice 4, the agent) writes, plus one row per
        # RUN of them. In SQLite rather than config.yaml on purpose: agent-writable records must never
        # be able to brick the config-validated boot (the unit crash-loops on a bad config).
        #
        # Every instant here is a **UTC epoch INTEGER**, not the ISO text the older tables use: these
        # columns are compared and ordered in SQL on the claim's hot path (`next_run_at <= ?`), and the
        # single-integer form makes that a real index range scan with no parsing and no timezone in the
        # comparison. `tz` is the SEPARATE, human-facing half — the IANA key the cron FIELDS are
        # evaluated in (the R7 DST rule: never do wall-clock arithmetic across a fold; ask cronsim for
        # the next fire in the zone and store the instant it resolves to).
        #
        # `automations.thread_id` deliberately carries NO foreign key: it is the ROLLING mode's lazily
        # owned thread, and a `threads` row the owner deletes must not be undeletable (nor silently
        # nulled behind the runner's back) — the service recreates it on the next run. Same for
        # `automation_runs.thread_id`: the run row is the historical record of which thread a run used,
        # so a dangling id after retention pruning is explicit and correct (the `events.run_id`
        # precedent). The runs→automation FK, in contrast, DOES cascade: a deleted definition has no
        # history worth keeping (the audit trail lives in `events`, which is never deleted).
        """
        CREATE TABLE automations (
            id               TEXT PRIMARY KEY,
            name             TEXT NOT NULL,
            enabled          INTEGER NOT NULL DEFAULT 1,
            schedule         TEXT NOT NULL,          -- 5-field cron, validated by the write service
            tz               TEXT NOT NULL,          -- IANA key; the cron fields are evaluated in it
            prompt           TEXT NOT NULL,
            agent            TEXT,                   -- NULL = the default agent, resolved per run
            privilege        TEXT,                   -- NULL = the resolved agent's own
            question_policy  TEXT NOT NULL DEFAULT 'use_default',   -- skip | use_default
            thread_mode      TEXT NOT NULL DEFAULT 'fresh',         -- fresh | rolling (pinned = later)
            thread_id        TEXT,                   -- rolling mode's own thread (see above)
            timeout_s        INTEGER,                -- NULL = automations.default_timeout_s
            next_run_at      INTEGER,                -- UTC epoch; NULL = never (disabled)
            rev              INTEGER NOT NULL DEFAULT 1,  -- bumped on every definition change
            created_at       INTEGER NOT NULL,
            updated_at       INTEGER NOT NULL
        );
        CREATE INDEX idx_automations_next_run ON automations(next_run_at);

        CREATE TABLE automation_runs (
            id             TEXT PRIMARY KEY,
            automation_id  TEXT NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
            trigger        TEXT NOT NULL,            -- scheduled | manual
            scheduled_for  INTEGER,                  -- the slot; NULL for a manual run
            started_at     INTEGER NOT NULL,
            finished_at    INTEGER,
            status         TEXT NOT NULL,            -- running|ok|error|timed_out|interrupted|missed
            error          TEXT,
            thread_id      TEXT,
            read_at        INTEGER                   -- NULL = unread
        );
        CREATE INDEX idx_automation_runs_automation ON automation_runs(automation_id, started_at DESC);
        """,
    ),
    (
        6,
        # Per-model-call message metadata (Phase 18 / D56, PROMPTS_PLAN §2.7 + §7 L-2). ONE nullable
        # JSON-OBJECT column holding everything we know about the model call a message came out of.
        # Today's keys: `prompt_stamps` ({registry id: sha256 of the effective prompt template — the
        # eval seam that makes a stored transcript attributable to the exact prompt VERSION that
        # produced it; recovering the TEXT of an override edited since needs the harness phase's
        # content-addressed `prompt_texts` store) and `usage` ({model, input_tokens, output_tokens}
        # as the provider reported it, or null).
        #
        # **Extend-don't-migrate: any future message-level metadata is a NEW KEY IN THIS COLUMN, never
        # a new column.** That is the whole reason it is a JSON object rather than the three scalar
        # columns the fields would suggest — the shape is known to grow (latency, the harness's run
        # ids), and a sibling column per dimension is exactly the migration debt D56 §L-2 wanted to
        # avoid. What L-2 actually ruled out is EVAL TABLES this phase (`model_calls`/`prompt_texts`,
        # deferred to the harness phase); its "no migration" wording assumed message-level metadata
        # could ride an existing JSON blob, which is false — only `parts` is JSON, and `parts` is
        # CONTENT. The precedent for an additive message field is this same mechanism: migration 2's
        # `agent` column (main-seat ruling 2026-08-15).
        #
        # NULL = every legacy row, every user/system turn, and any message no model call produced.
        "ALTER TABLE messages ADD COLUMN meta TEXT;",
    ),
]


def db_path() -> Path:
    """Resolve the SQLite file path. An explicit `CTRLB_DB` still overrides directly (back-compat +
    the temp-DB test workflow); otherwise it derives from `$CTRLB_HOME` (D15 #2 — layered)."""
    override = os.environ.get("CTRLB_DB")
    if override:
        return Path(override).expanduser().resolve()
    from app.config import home_path  # local import: config imports nothing from db (no cycle)

    return home_path() / "ctrlb.db"


class Database:
    """Owns the connection + write serialization. One instance per process."""

    def __init__(self, path: Path | None = None) -> None:
        self.path = path or db_path()
        self._conn: aiosqlite.Connection | None = None
        self._write_lock = asyncio.Lock()

    @property
    def conn(self) -> aiosqlite.Connection:
        if self._conn is None:
            raise RuntimeError("Database not connected — call connect() first")
        return self._conn

    async def connect(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._conn = await aiosqlite.connect(self.path)
        self._conn.row_factory = aiosqlite.Row
        await self._conn.execute("PRAGMA journal_mode=WAL")
        await self._conn.execute(f"PRAGMA busy_timeout={BUSY_TIMEOUT_MS}")
        await self._conn.execute("PRAGMA foreign_keys=ON")
        await self._conn.commit()
        await self._migrate()

    async def close(self) -> None:
        if self._conn is not None:
            await self._conn.close()
            self._conn = None

    async def execute(self, sql: str, params: tuple = ()) -> None:
        """Run a single write. Standalone (the common case) it takes the process-wide write lock and
        commits immediately (the shared-connection worker thread serializes the actual I/O, so this is
        about statement grouping, not SQLITE_BUSY — that's impossible with one connection). Inside a
        `transaction()` it **joins** the open transaction: the write lock is already held by the CM and
        the commit is deferred to the CM's COMMIT, so this call only issues the statement."""
        if _in_transaction.get():
            await self.conn.execute(sql, params)  # joins the open transaction — no lock, no commit
            return
        async with self._write_lock:
            await self.conn.execute(sql, params)
            await self.conn.commit()

    @contextlib.asynccontextmanager
    async def transaction(self) -> AsyncIterator[None]:
        """Batch multiple writes into one atomic transaction (SYS-1). Acquires the write lock, opens a
        `BEGIN IMMEDIATE` transaction, yields, then COMMITs on clean exit or ROLLBACKs and re-raises on
        error. `execute()` calls inside the block join this transaction via the `_in_transaction`
        contextvar (no lock re-acquire, no per-statement commit); `query()` reads the same connection
        so it sees the uncommitted writes.

        Nested `transaction()` is a programming error — there is no savepoint support (nothing needs
        it), so a re-entry raises `RuntimeError` rather than silently degrading atomicity.

        ⚠ Do NOT spawn tasks that write the DB from inside a `transaction()` block: a task created
        inside the block inherits `_in_transaction=True` (contextvars copy at task creation), so its
        `execute()` would join a transaction it doesn't own and race the owner's COMMIT/ROLLBACK.
        All current adopters are spawn-free; keep it that way (Slice 2 audit finding)."""
        if _in_transaction.get():
            raise RuntimeError(
                "transaction() is already open on this context — nested transactions are unsupported"
            )
        async with self._write_lock:
            token = _in_transaction.set(True)
            try:
                await self.conn.execute("BEGIN IMMEDIATE")
                try:
                    yield
                except BaseException:
                    # Roll back so a cancel landing mid-rollback can't abandon the open BEGIN on the
                    # shared connection (which would poison every later transaction with "cannot start
                    # a transaction within a transaction" — Slice 2 audit finding), THEN re-raise the
                    # original error (or the cancel).
                    await self._shielded_rollback()
                    raise
                else:
                    # COMMIT is inside the arm too (audit C3-M3): a commit failure otherwise escaped
                    # the rollback path, leaving the connection mid-transaction (a later BEGIN fails /
                    # a later standalone commit commits this stale batch). Roll back on a failed
                    # commit, then re-raise the commit error.
                    try:
                        await self.conn.commit()
                    except BaseException:
                        await self._shielded_rollback()
                        raise
            finally:
                _in_transaction.reset(token)

    async def _shielded_rollback(self) -> None:
        """Roll back the open transaction, guaranteed to complete even under cancellation (audit
        C3-H1). A plain `anyio.CancelScope(shield=True)` around the rollback await does NOT reliably
        suppress a *raw* `asyncio.Task.cancel()` (the durable-turn drain task's Stop path): anyio
        can't attribute a raw cancel to a scope it owns, so it re-raises it mid-`rollback()` and
        abandons the open BEGIN — poisoning every later transaction. The deterministic asyncio-native
        guard: run the rollback as its OWN task (`asyncio.ensure_future`) — genuinely uncancellable by
        the outer cancel — and `await asyncio.shield(rollback)`; on a `CancelledError` we `await` the
        inner task a SECOND time so it is guaranteed to finish before we propagate (we ALWAYS await it
        → no detached-task leak). The outer `anyio.CancelScope(shield=True)` is retained for the OTHER
        cancellation shape — anyio's level-triggered scope cancellation (Starlette request scope /
        subagent TaskGroup), which re-raises at every await; the two shields cover the two distinct
        cancellation sources."""
        rollback = asyncio.ensure_future(self.conn.rollback())
        with anyio.CancelScope(shield=True):
            try:
                await asyncio.shield(rollback)
            except asyncio.CancelledError:
                await rollback  # the inner task is uncancellable by the outer cancel — let it finish
                raise

    async def query(self, sql: str, params: tuple = ()) -> list[aiosqlite.Row]:
        """Read rows. Lock-free by design — every op runs on the one shared connection's worker
        thread, which serializes it against writes (WAL's cross-connection read concurrency is unused;
        a reader-pool is the future seam, SYS-1). Inside a `transaction()` it sees that txn's own
        uncommitted writes (same connection) — which also means a read from a DIFFERENT task during
        another task's open transaction sees those uncommitted writes and, if the txn rolls back, has
        returned phantom rows. Reachable only via marker-ungated reads (e.g. a thread listing during a
        live turn's txn) — transient + display-only, accepted (Slice 2 audit finding)."""
        async with self.conn.execute(sql, params) as cur:
            return list(await cur.fetchall())

    async def _current_version(self) -> int:
        await self.conn.execute("CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)")
        async with self.conn.execute("SELECT MAX(version) FROM schema_version") as cur:
            row = await cur.fetchone()
        return row[0] if row and row[0] is not None else 0

    async def _migrate(self) -> None:
        async with self._write_lock:
            current = await self._current_version()
            for version, sql in MIGRATIONS:
                if version > current:
                    await self._apply_migration(version, sql)

    async def _apply_migration(self, version: int, sql: str) -> None:
        """Apply ONE migration and its `schema_version` stamp **atomically** (post-14a review, MED).

        The partial state this closes is unrecoverable by the service itself: the old shape ran the
        script, then stamped the version, then committed — three separate autocommits — so a crash (or a
        killed unit, or a full disk) between v4's four `ALTER`s, or after any script but before its
        stamp, left a database whose real shape is ahead of its recorded version. The next boot re-runs
        the same migration and dies on `duplicate column name` / `table already exists`, and since
        `connect()` runs in the lifespan the service then crash-loops on every start. All-or-nothing
        means that state cannot exist: either the whole migration is visible AND stamped, or nothing is.

        The mechanism is explicit transaction control INSIDE the composed script, because wrapping the
        call cannot work: `executescript` implicitly COMMITs any pending transaction before it runs, so
        an outer `BEGIN` would be committed away (and `transaction()` here would strand the write lock).
        Python's sqlite3 documents this shape — "no other implicit transaction control is performed; any
        transaction control must be added to sql_script". SQLite's DDL is fully transactional, so the
        rollback really does undo the `CREATE`/`ALTER`s (pinned by
        `test_db_migration_atomicity.py`, which crashes a migration mid-script and asserts both the
        version and the partial columns are gone, then that a clean boot applies it in full — including
        with a cancel delivered while the cleanup rollback is in flight).

        The script is composed, never split: v3's FTS triggers carry semicolons inside `BEGIN … END`
        bodies, so any statement-splitting would corrupt them. `version` is interpolated (executescript
        takes no parameters) — it is an int from this module's own `MIGRATIONS`, never input.
        """
        script = "\n".join(
            (
                "BEGIN IMMEDIATE;",
                sql,
                f"INSERT INTO schema_version (version) VALUES ({int(version)});",
                "COMMIT;",
            )
        )
        try:
            await self.conn.executescript(script)
        except BaseException:
            # Clean up through the SAME cancellation-safe rollback `transaction()` uses (C3-H1) rather
            # than a plain `rollback()`: a failed script leaves its transaction ACTIVE, and a cancel
            # landing mid-rollback (a shutdown racing a failing startup migration) would otherwise
            # abandon the open BEGIN on the shared connection — poisoning every later transaction on it.
            # `_shielded_rollback` guarantees the rollback COMPLETES before anything propagates.
            #
            # Its outcome is deliberately discarded, including the `CancelledError` it re-raises: the
            # bare `raise` below must re-raise the MIGRATION failure, which is the diagnosis the operator
            # needs (a cancel in its place would report a shutdown and hide the broken migration). Safe
            # to swallow here specifically because this path always ends in that `raise` — the caller is
            # `connect()`, so startup fails either way; nothing continues believing it was not cancelled.
            with contextlib.suppress(BaseException):
                await self._shielded_rollback()
            raise

    async def schema_version(self) -> int:
        return await self._current_version()
