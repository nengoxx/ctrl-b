"""SQLite persistence (Phase 0 slice).

All operations share **one** aiosqlite connection whose single worker thread serializes them, so a
process-wide write lock (`_write_lock`) is enough to keep multi-statement writes coherent and
`SQLITE_BUSY` is effectively impossible today (WAL is enabled but its cross-connection read
concurrency is unused — the named seam is a dedicated reader-pool if read latency ever matters, and
`PRAGMA busy_timeout` future-proofs it). See DESIGN.md §8. Migrations are numbered SQL blocks applied
in order and tracked in `schema_version`; no ORM (hand-written SQL is enough at this scale).

Multi-statement write *sequences* (compaction's summary-insert + flag-flips, the plan/apply/exec
message pairs) commit atomically via `transaction()` (SYS-1) — otherwise `execute()` commits per
statement and a crash mid-sequence tears state.

Phase 0 creates the v1 tables the rest of the app builds on — threads, messages, memory,
events. Repositories and later tables (automations, push_subscriptions, pending_actions)
arrive with the phases that need them.
"""

from __future__ import annotations

import asyncio
import contextlib
import contextvars
import os
from collections.abc import AsyncIterator
from pathlib import Path

import aiosqlite

#: Milliseconds SQLite waits on a locked database before returning SQLITE_BUSY. Moot with today's
#: single shared connection (the worker thread already serializes every op), but set at connect so
#: the reader-pool seam (SYS-1) is future-proofed the day a second connection appears.
BUSY_TIMEOUT_MS = 5000

#: Marks an open `transaction()` on the current context. `execute()` reads it to *join* the open
#: transaction (skip lock re-acquire + per-statement commit) instead of opening its own. Set/reset
#: only by `transaction()`; nested `transaction()` is a programming error (raises).
_in_transaction: contextvars.ContextVar[bool] = contextvars.ContextVar("db_in_transaction", default=False)

# Numbered migrations. Append new (version, sql) tuples; never edit a shipped one.
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
        it), so a re-entry raises `RuntimeError` rather than silently degrading atomicity."""
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
                    await self.conn.rollback()
                    raise
                else:
                    await self.conn.commit()
            finally:
                _in_transaction.reset(token)

    async def query(self, sql: str, params: tuple = ()) -> list[aiosqlite.Row]:
        """Read rows. Lock-free by design — every op runs on the one shared connection's worker
        thread, which serializes it against writes (WAL's cross-connection read concurrency is unused;
        a reader-pool is the future seam, SYS-1). Inside a `transaction()` it sees that txn's own
        uncommitted writes (same connection)."""
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
                    await self.conn.executescript(sql)
                    await self.conn.execute("INSERT INTO schema_version (version) VALUES (?)", (version,))
                    await self.conn.commit()

    async def schema_version(self) -> int:
        return await self._current_version()
