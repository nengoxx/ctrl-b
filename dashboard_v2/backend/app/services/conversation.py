"""Thread + Message repositories over SQLite (DESIGN §8).

Hand-written SQL (no ORM). Writes go through `Database.execute` (serialized under the write lock);
reads use `Database.query` (lock-free under WAL). `parts` round-trips as a JSON column via the
Pydantic union in `domain/conversation.py`, so message shape can grow (tool/plan parts in 4b)
without touching the schema.
"""

from __future__ import annotations

import json
from datetime import datetime

from pydantic import TypeAdapter

from app.db import Database
from app.domain.conversation import Message, Part, Thread
from app.domain.enums import Actor

_PARTS = TypeAdapter(list[Part])


def _iso(dt: datetime) -> str:
    return dt.isoformat()


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

    async def add(self, msg: Message) -> Message:
        await self._db.execute(
            "INSERT INTO messages (id, thread_id, role, parts, actor, ts, tokens, compacted) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (
                msg.id,
                msg.thread_id,
                msg.role,
                _PARTS.dump_json(msg.parts).decode(),
                msg.actor.value,
                _iso(msg.ts),
                msg.tokens,
                int(msg.compacted),
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
        sql += " ORDER BY ts ASC"
        return [self._row(r) for r in await self._db.query(sql, (thread_id,))]

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
        )
