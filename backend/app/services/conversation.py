"""Thread + Message repositories over SQLite (DESIGN §8).

Hand-written SQL (no ORM). Writes go through `Database.execute` (serialized under the write lock;
multi-write sequences batch via `Database.transaction()`, SYS-1); reads use `Database.query` —
lock-free because the one shared connection's worker thread serializes every op anyway (see the
db.py module docstring). `parts` round-trips as a JSON column via the
Pydantic union in `domain/conversation.py`, so message shape can grow (tool/plan parts in 4b)
without touching the schema.
"""

from __future__ import annotations

import json
import re
from collections.abc import Sequence
from datetime import datetime
from typing import Any

from pydantic import TypeAdapter

from app.db import Database
from app.domain.conversation import Message, Part, Thread
from app.domain.enums import Actor, RunState

_PARTS = TypeAdapter(list[Part])


def _iso(dt: datetime) -> str:
    return dt.isoformat()


def _fts_query(raw: str) -> str:
    """Turn a free-text query into a safe FTS5 MATCH expression: each word becomes a quoted literal
    term, joined (implicit AND). Quoting neutralizes FTS5 operators (`"`, `*`, `AND`, `:`, `-`) so a
    model-supplied query can't throw a syntax error; `""` (no word chars) signals "no query"."""
    tokens = re.findall(r"\w+", raw, flags=re.UNICODE)
    return " ".join(f'"{t}"' for t in tokens)


class ThreadRepo:
    def __init__(self, db: Database) -> None:
        self._db = db

    async def create(self, thread: Thread) -> Thread:
        await self._db.execute(
            "INSERT INTO threads (id, title, agent, created_at, updated_at, archived) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (
                thread.id,
                thread.title,
                thread.agent,
                _iso(thread.created_at),
                _iso(thread.updated_at),
                int(thread.archived),
            ),
        )
        return thread

    async def touch(self, thread_id: str, updated_at: datetime) -> None:
        await self._db.execute(
            "UPDATE threads SET updated_at = ? WHERE id = ?", (_iso(updated_at), thread_id)
        )

    async def get(self, thread_id: str) -> Thread | None:
        rows = await self._db.query("SELECT * FROM threads WHERE id = ?", (thread_id,))
        return self._row(rows[0]) if rows else None

    async def list(self, *, include_archived: bool = False) -> list[Thread]:
        sql = "SELECT * FROM threads"
        if not include_archived:
            sql += " WHERE archived = 0"
        sql += " ORDER BY updated_at DESC"
        return [self._row(r) for r in await self._db.query(sql)]

    async def latest(self) -> Thread | None:
        threads = await self.list()
        return threads[0] if threads else None

    async def delete(self, thread_id: str) -> bool:
        """Delete a thread and everything hanging off it. Returns whether a row went.

        The first thread-deleting path in the app (A3 retention: an hourly automation would otherwise
        accumulate ~8.7k invisible archived threads a year — §D-1). One statement is enough: `messages`
        declares `ON DELETE CASCADE` on `thread_id` and the connection runs with `PRAGMA
        foreign_keys=ON`, so the messages go with the thread, and the cascade fires the `messages_fts_ad`
        trigger on each one — so the FTS index is cleaned too, rather than left with rows pointing at
        deleted messages (which `session_search` would then join into nothing).

        Deliberately unconditional on `archived`: the caller decides what it owns. Automations only ever
        pass a thread they created."""
        rows = await self._db.query("SELECT id FROM threads WHERE id = ?", (thread_id,))
        if not rows:
            return False
        await self._db.execute("DELETE FROM threads WHERE id = ?", (thread_id,))
        return True

    @staticmethod
    def _row(r) -> Thread:
        return Thread(
            id=r["id"],
            title=r["title"],
            agent=r["agent"],
            created_at=r["created_at"],
            updated_at=r["updated_at"],
            archived=bool(r["archived"]),
        )


class MessageRepo:
    def __init__(self, db: Database) -> None:
        self._db = db

    @property
    def db(self) -> Database:
        """The underlying `Database` — so callers holding only this repo (the compactor, the agent
        session) can open a `Database.transaction()` around a multi-write sequence (SYS-1) without
        threading a separate db handle. Read-only accessor; writes still go through the repo methods."""
        return self._db

    async def add(self, msg: Message) -> Message:
        await self._db.execute(
            "INSERT INTO messages (id, thread_id, role, parts, actor, ts, tokens, compacted, agent) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                msg.id,
                msg.thread_id,
                msg.role,
                _PARTS.dump_json(msg.parts).decode(),
                msg.actor.value,
                _iso(msg.ts),
                msg.tokens,
                int(msg.compacted),
                msg.agent,
            ),
        )
        return msg

    async def update(self, msg: Message) -> Message:
        """Rewrite a message's parts in place (4b: a ToolCallPart flips PENDING →
        AWAITING_CONFIRM → resolved as the confirm dance completes)."""
        await self._db.execute(
            "UPDATE messages SET parts = ?, tokens = ?, compacted = ? WHERE id = ?",
            (
                _PARTS.dump_json(msg.parts).decode(),
                msg.tokens,
                int(msg.compacted),
                msg.id,
            ),
        )
        return msg

    async def get(self, message_id: str) -> Message | None:
        rows = await self._db.query("SELECT * FROM messages WHERE id = ?", (message_id,))
        return self._row(rows[0]) if rows else None

    async def list(self, thread_id: str, *, include_compacted: bool = True) -> list[Message]:
        sql = "SELECT * FROM messages WHERE thread_id = ?"
        if not include_compacted:
            sql += " AND compacted = 0"
        # `rowid` (insertion order) breaks a `ts` tie so relative order is never undefined (ACA-20):
        # step-mates are stamped microseconds apart and the compaction boundary is manufactured at
        # `tail[0].ts − 1µs`, so a collision could otherwise sort an assistant `tool_calls` message
        # after its `tool` results and invalidate the assembled OpenAI context. `messages` is a
        # normal rowid table (`id` is a TEXT PK, not INTEGER), so `rowid` tracks insertion order.
        sql += " ORDER BY ts ASC, rowid ASC"
        return [self._row(r) for r in await self._db.query(sql, (thread_id,))]

    async def with_call_states(
        self, states: Sequence[RunState], thread_id: str | None = None
    ) -> list[Message]:
        """Messages holding a `tool_call` part in one of `states` — the narrow scan behind the D39
        `reconcile_stale_calls` helper. A SQL-level `json_each`/`json_extract` filter (the same idiom
        the FTS triggers use over `parts`) so only the handful of messages with a matching call are
        loaded, never every message of every thread. Scoped to `thread_id` when given, all threads
        when `None` (boot crash-recovery). Empty `states` → `[]` (no predicate to build). Ordered like
        `list()` so a caller sees calls in insertion order."""
        if not states:
            return []
        placeholders = ", ".join("?" for _ in states)
        sql = (
            "SELECT * FROM messages WHERE EXISTS ("
            "SELECT 1 FROM json_each(messages.parts) "
            "WHERE json_extract(value, '$.type') = 'tool_call' "
            f"AND json_extract(value, '$.state') IN ({placeholders}))"
        )
        params: list[Any] = [s.value for s in states]
        if thread_id is not None:
            sql += " AND thread_id = ?"
            params.append(thread_id)
        sql += " ORDER BY ts ASC, rowid ASC"
        return [self._row(r) for r in await self._db.query(sql, tuple(params))]

    async def count_user_messages(self, thread_id: str) -> int:
        """Count user messages in a thread, **including compacted ones** (D27-C periodic reflection).
        Compaction only flips `compacted`, never deletes, so this is a monotonic per-thread turn
        counter — unlike `_assemble`'s `include_compacted=False` view, which shrinks as old turns fold
        into the rolling summary and would make the reflection cadence drift."""
        rows = await self._db.query(
            "SELECT COUNT(*) AS n FROM messages WHERE thread_id = ? AND role = 'user'", (thread_id,)
        )
        return int(rows[0]["n"]) if rows else 0

    async def search(
        self, query: str, *, limit: int = 5, include_archived: bool = False
    ) -> list[dict[str, Any]]:
        """Full-text search over user/assistant message text (the `messages_fts` index, migration 3)
        — global across threads (D15 #7). Returns the best `limit` hits (FTS5 `rank`) as dicts with
        the thread/agent context + a highlighted `snippet`. Archived (ephemeral subagent) threads are
        excluded by default. Caller redacts the snippet before exposing it. Empty/word-less query → []."""
        match = _fts_query(query)
        if not match:
            return []
        sql = (
            "SELECT f.message_id AS message_id, f.thread_id AS thread_id, "
            "       t.title AS thread_title, t.agent AS thread_agent, "
            "       m.role AS role, m.ts AS ts, m.agent AS agent, "
            "       snippet(messages_fts, 0, '«', '»', '…', 12) AS snippet "
            "FROM messages_fts f "
            "JOIN messages m ON m.id = f.message_id "
            "JOIN threads t ON t.id = f.thread_id "
            "WHERE messages_fts MATCH ?"
        )
        if not include_archived:
            sql += " AND t.archived = 0"
        sql += " ORDER BY rank LIMIT ?"
        return [dict(r) for r in await self._db.query(sql, (match, limit))]

    @staticmethod
    def _row(r) -> Message:
        return Message(
            id=r["id"],
            thread_id=r["thread_id"],
            role=r["role"],
            parts=_PARTS.validate_python(json.loads(r["parts"])),
            actor=Actor(r["actor"]),
            ts=r["ts"],
            tokens=r["tokens"],
            compacted=bool(r["compacted"]),
            agent=r["agent"],
        )
