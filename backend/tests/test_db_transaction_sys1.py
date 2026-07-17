"""SYS-1 / D38 (ACA Slice 2 wave 1) — `Database.transaction()` atomic write batches.

`Database.execute` commits per statement, so a crash between the statements of a read-modify-write
*sequence* (compaction's summary-insert + `compacted` flag flips is the sharpest case) tears state.
`transaction()` is an async CM that batches those writes under the existing write lock: `BEGIN
IMMEDIATE` → commit on clean exit, rollback + re-raise on error. Statements inside join the open
transaction via a contextvar (`execute()` skips lock re-acquire + per-statement commit); nested use is
a programming error (raises); `PRAGMA busy_timeout` is set at connect to future-proof the reader-pool
seam.

What's exercised:
  1. commit         — two writes inside a transaction are both visible after it exits.
  2. rollback       — an error inside rolls BOTH writes back (nothing persists).
  3. contextvar join— `execute()` inside a transaction runs without deadlock and rolls back with it.
  4. nested guard   — opening a transaction inside a transaction raises `RuntimeError`.
  5. compaction crash — a raise between the summary insert and the flag flips persists neither the
                        summary row nor any flipped `compacted` flag (the D38/spec verify case).
  6. busy_timeout   — the pragma is applied to the connection at connect.

Each test builds its own `Database` on a temp file — the real config/db are never touched.
"""

from __future__ import annotations

import tempfile
from pathlib import Path
from typing import cast

from _async import run_async

from app.adapters.inference import InferenceClient
from app.db import BUSY_TIMEOUT_MS, Database
from app.domain.agent import CompactionCfg
from app.domain.conversation import Message, TextPart, Thread
from app.domain.enums import Actor
from app.services.agent.compaction import Compactor
from app.services.conversation import MessageRepo, ThreadRepo


def _run(coro):
    return run_async(coro)


async def _fresh_db() -> Database:
    """A connected `Database` on a throwaway temp file (migrations applied)."""
    path = Path(tempfile.mkdtemp()) / "t.db"
    db = Database(path)
    await db.connect()
    return db


async def _count(db: Database, sql: str, params: tuple = ()) -> int:
    rows = await db.query(sql, params)
    return int(rows[0]["n"]) if rows else 0


def test_transaction_commits_both_writes() -> None:
    async def go() -> None:
        db = await _fresh_db()
        await db.execute("CREATE TABLE kv (k TEXT)")
        async with db.transaction():
            await db.execute("INSERT INTO kv (k) VALUES ('a')")
            await db.execute("INSERT INTO kv (k) VALUES ('b')")
        assert await _count(db, "SELECT COUNT(*) AS n FROM kv") == 2
        await db.close()

    _run(go())


def test_transaction_rolls_back_on_error() -> None:
    async def go() -> None:
        db = await _fresh_db()
        await db.execute("CREATE TABLE kv (k TEXT)")
        raised = False
        try:
            async with db.transaction():
                await db.execute("INSERT INTO kv (k) VALUES ('a')")
                await db.execute("INSERT INTO kv (k) VALUES ('b')")
                raise ValueError("boom")
        except ValueError:
            raised = True
        assert raised, "the CM must re-raise the error"
        # NEITHER write survives — the whole batch rolled back.
        assert await _count(db, "SELECT COUNT(*) AS n FROM kv") == 0
        await db.close()

    _run(go())


def test_execute_joins_open_transaction_and_rolls_back() -> None:
    """`execute()` inside a transaction must not deadlock on the (already-held) write lock — it joins
    the open txn — and its write must roll back with the txn."""

    async def go() -> None:
        db = await _fresh_db()
        await db.execute("CREATE TABLE kv (k TEXT)")
        raised = False
        try:
            async with db.transaction():
                await db.execute("INSERT INTO kv (k) VALUES ('joined')")  # would deadlock if it re-locked
                raise ValueError("boom")
        except ValueError:
            raised = True
        assert raised
        assert await _count(db, "SELECT COUNT(*) AS n FROM kv") == 0
        await db.close()

    _run(go())


def test_nested_transaction_raises() -> None:
    async def go() -> None:
        db = await _fresh_db()
        inner_error = None
        async with db.transaction():
            try:
                async with db.transaction():
                    pass
            except RuntimeError as e:
                inner_error = e
        assert isinstance(inner_error, RuntimeError), "nested transaction() must raise RuntimeError"
        await db.close()

    _run(go())


def test_busy_timeout_pragma_applied() -> None:
    async def go() -> None:
        db = await _fresh_db()
        rows = await db.query("PRAGMA busy_timeout")
        assert rows[0][0] == BUSY_TIMEOUT_MS
        await db.close()

    _run(go())


def test_compaction_crash_persists_neither_summary_nor_flags(monkeypatch) -> None:
    """The D38/spec verify case: raise between the compactor's summary insert and its `compacted`
    flag flips → neither the summary system message nor any flipped flag survives."""

    async def go() -> None:
        db = await _fresh_db()
        threads = ThreadRepo(db)
        messages = MessageRepo(db)
        thread = await threads.create(Thread())

        # A foldable history: with keep_last_messages=1 the head is [user, assistant], tail [user].
        base = await messages.add(
            Message(thread_id=thread.id, role="user", actor=Actor.USER, parts=[TextPart(text="hi")])
        )
        await messages.add(
            Message(thread_id=thread.id, role="assistant", actor=Actor.AGENT, parts=[TextPart(text="hello")])
        )
        await messages.add(
            Message(thread_id=thread.id, role="user", actor=Actor.USER, parts=[TextPart(text="again")])
        )
        assert base is not None

        cfg = CompactionCfg(enabled=True, keep_last_messages=1)
        comp = Compactor(cast("InferenceClient", None), messages, cfg)

        async def _stub_summarize(_head):  # avoid touching a real inference backend
            return "[Earlier conversation summary]\nstub", False

        # Fail on the FIRST flag flip — i.e. AFTER the summary insert has run inside the txn.
        async def _boom_update(_msg):
            raise RuntimeError("crash between summary insert and flag flips")

        monkeypatch.setattr(comp, "_summarize", _stub_summarize)
        monkeypatch.setattr(messages, "update", _boom_update)

        raised = False
        try:
            await comp.compact(thread, force=True)
        except RuntimeError:
            raised = True
        assert raised, "the crash must propagate (the txn re-raises)"

        # Torn state must NOT exist: no summary row was committed …
        assert await _count(db, "SELECT COUNT(*) AS n FROM messages WHERE role = 'system'") == 0
        # … and no original was left flipped.
        assert await _count(db, "SELECT COUNT(*) AS n FROM messages WHERE compacted = 1") == 0
        # (the three originals are all still live/uncompacted)
        assert await _count(db, "SELECT COUNT(*) AS n FROM messages WHERE thread_id = ?", (thread.id,)) == 3
        await db.close()

    _run(go())
