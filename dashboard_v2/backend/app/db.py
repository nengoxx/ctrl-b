"""SQLite persistence (Phase 0 slice).

WAL mode for concurrent reads; a single write lock serializes writes (DESIGN.md §8 —
prevents SQLITE_BUSY under async fan-out). Migrations are numbered SQL blocks applied in
order and tracked in `schema_version`; no ORM (hand-written SQL is enough at this scale).

Phase 0 creates the v1 tables the rest of the app builds on — threads, messages, memory,
events. Repositories and later tables (automations, push_subscriptions, pending_actions)
arrive with the phases that need them.
"""

from __future__ import annotations

import asyncio
import os
from pathlib import Path

import aiosqlite

_PROJECT_ROOT = Path(__file__).resolve().parents[2]
_DEFAULT_DB = _PROJECT_ROOT / "ctrlb.db"

# Numbered migrations. Append new (version, sql) tuples; never edit a shipped one.
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
]


def db_path() -> Path:
    """Resolve the SQLite file path (env `CTRLB_DB` overrides the default)."""
    override = os.environ.get("CTRLB_DB")
    return Path(override).expanduser().resolve() if override else _DEFAULT_DB


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
        await self._conn.execute("PRAGMA foreign_keys=ON")
        await self._conn.commit()
        await self._migrate()

    async def close(self) -> None:
        if self._conn is not None:
            await self._conn.close()
            self._conn = None

    async def execute(self, sql: str, params: tuple = ()) -> None:
        """Run a single write under the process-wide write lock (DESIGN.md §8 — avoids
        SQLITE_BUSY under async fan-out). Reads can use `query` lock-free (WAL)."""
        async with self._write_lock:
            await self.conn.execute(sql, params)
            await self.conn.commit()

    async def query(self, sql: str, params: tuple = ()) -> list[aiosqlite.Row]:
        async with self.conn.execute(sql, params) as cur:
            return list(await cur.fetchall())

    async def _current_version(self) -> int:
        await self.conn.execute(
            "CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)"
        )
        async with self.conn.execute("SELECT MAX(version) FROM schema_version") as cur:
            row = await cur.fetchone()
        return row[0] if row and row[0] is not None else 0

    async def _migrate(self) -> None:
        async with self._write_lock:
            current = await self._current_version()
            for version, sql in MIGRATIONS:
                if version > current:
                    await self.conn.executescript(sql)
                    await self.conn.execute(
                        "INSERT INTO schema_version (version) VALUES (?)", (version,)
                    )
                    await self.conn.commit()

    async def schema_version(self) -> int:
        return await self._current_version()
