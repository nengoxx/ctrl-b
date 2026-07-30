"""Migrations apply all-or-nothing (post-14a review, MED) — `Database._apply_migration`.

The failure this pins is a stranded service, not a lost row. Migrations used to run as three separate
autocommits (script → version stamp → commit), so a crash between them — the killed systemd unit, the
full disk, the four `ALTER`s of migration 4 half-done — left a database whose real shape was AHEAD of
its recorded `schema_version`. The next boot re-ran the same migration, hit `duplicate column name`,
and since `connect()` runs inside the lifespan, the service crash-looped on every start with no
in-app way out.

So the pins here are about the state that must NOT be observable:

  1. A migration that dies mid-script leaves NEITHER its version NOR any of its partial effects — which
     also proves SQLite really does roll back DDL (`ALTER TABLE`), rather than us assuming it.
  2. A migration that dies on its FIRST statement leaves the version untouched too (no blind stamp).
  3. After the crash, a boot on the fixed/complete migration list applies it in full — the database is
     not wedged by the interrupted attempt.
  4. A cancel landing while the cleanup rollback is in flight neither abandons the transaction nor
     replaces the migration error with a `CancelledError` (the `_shielded_rollback` guarantee).
  5. No shipped script declares its own transaction control, which would close the wrapping transaction
     early and re-open the very window this closes…
  6. …checked statement-aware (via `sqlite3.complete_statement`), so a trigger body's `BEGIN` is not a
     false positive and a `COMMIT` sharing a line with another statement is not a false negative.

Runs as `python tests/test_db_migration_atomicity.py` from backend/ (plain asserts + a __main__ runner)
or under pytest. Every case works on a throwaway database inside a temp `$CTRLB_HOME`; the real
`ctrlb.db` is never opened.
"""

from __future__ import annotations

import asyncio
import contextlib
import os
import re
import sqlite3
import tempfile
from pathlib import Path

from _async import run_async

import app.db as dbmod
from app.db import MIGRATIONS, Database

#: A migration whose first statement succeeds and whose second cannot: the interrupted-mid-script case.
_POISON_LATE = (
    4,
    "ALTER TABLE events ADD COLUMN half_applied TEXT;\n"
    "INSERT INTO table_that_does_not_exist (x) VALUES (1);\n",
)
#: …and one that fails immediately, so nothing of the script could have applied.
_POISON_EARLY = (4, "INSERT INTO table_that_does_not_exist (x) VALUES (1);\n")


@contextlib.contextmanager
def _workspace():
    tmp = Path(tempfile.mkdtemp())
    os.environ["CTRLB_HOME"] = str(tmp)
    try:
        yield tmp
    finally:
        os.environ.pop("CTRLB_HOME", None)


#: Leading keywords that open or close a transaction (`END` is a `COMMIT` alias). Checked at STATEMENT
#: position, which is why the trigger-body `BEGIN`/`END` of migration 3 can never match: they are not
#: top-level statements, they are tokens inside one.
_CONTROL_KEYWORDS = frozenset({"begin", "commit", "end", "rollback", "savepoint", "release"})


def _statements(sql: str) -> list[str]:
    """Split a script into complete top-level statements the way SQLite itself would.

    `sqlite3.complete_statement` is the stdlib wrapper around `sqlite3_complete()` — the same predicate
    the interactive shell uses to decide whether to execute or keep reading. It understands trigger
    bodies, so a `;` inside `CREATE TRIGGER … BEGIN … END` does not terminate the statement (verified,
    not assumed: `test_the_control_check_is_statement_aware_not_line_aware` feeds it migration 3).

    Accumulated per CHARACTER, not per line: the shell's line-at-a-time loop cannot see a second
    statement sharing a line, which is precisely how `CREATE TABLE x(a); COMMIT;` would slip past. The
    predicate is only consulted at a `;` (nothing else can end a statement), so this stays cheap.
    """
    statements: list[str] = []
    buf = ""
    for ch in sql:
        buf += ch
        if ch == ";" and sqlite3.complete_statement(buf):
            statements.append(buf.strip())
            buf = ""
    if buf.strip():  # a trailing statement with no terminating ';' — still worth inspecting
        statements.append(buf.strip())
    return statements


def _leading_keyword(statement: str) -> str:
    """A statement's first SQL keyword, lowercased, with leading comments and whitespace stripped (so
    `-- note\\nCOMMIT;` is not mistaken for a comment-only statement)."""
    text = statement
    while True:
        text = text.lstrip()
        if text.startswith("--"):
            _, _, text = text.partition("\n")
        elif text.startswith("/*"):
            _, _, text = text.partition("*/")
        else:
            break
    match = re.match(r"[A-Za-z_]+", text)
    return match.group(0).lower() if match else ""


def _control_statements(sql: str) -> list[str]:
    """The leading keywords of every top-level statement in `sql` that is transaction control."""
    heads = [_leading_keyword(s) for s in _statements(sql)]
    return [h for h in heads if h in _CONTROL_KEYWORDS]


async def _columns(db: Database, table: str) -> list[str]:
    return [r["name"] for r in await db.query(f"PRAGMA table_info({table})")]


async def _boot(path: Path, migrations) -> Database:
    """Open a database against a specific migration list (the connect-time migrate runs here)."""
    dbmod.MIGRATIONS = migrations
    db = Database(path)
    await db.connect()
    return db


async def _crash_then_inspect(path: Path, poison) -> tuple[BaseException | None, int, list[str]]:
    """Boot into a poisoned migration, then RE-boot at the last good version (so no migration runs) and
    report what the interrupted attempt left behind — the state the next real start would see."""
    real = [m for m in dbmod.MIGRATIONS if m[0] <= 3]
    db = Database(path)
    dbmod.MIGRATIONS = [*real, poison]
    raised: BaseException | None = None
    try:
        await db.connect()
    except BaseException as exc:  # noqa: BLE001 — the failure IS the scenario
        raised = exc
    await db.close()

    after = await _boot(path, real)  # a fresh boot, nothing left to apply
    version = await after.schema_version()
    cols = await _columns(after, "events")
    await after.close()
    return raised, version, cols


def test_a_crash_mid_script_leaves_neither_the_version_nor_the_partial_columns() -> None:
    """The core invariant: the `ALTER` that DID run is rolled back with the failure, and the version
    stays where it was — so the next boot re-runs the migration cleanly instead of dying on a column
    that already exists. (This is also the executable proof that SQLite's DDL is transactional.)"""
    real = dbmod.MIGRATIONS
    with _workspace() as tmp:
        try:
            raised, version, cols = run_async(_crash_then_inspect(tmp / "m.db", _POISON_LATE))
        finally:
            dbmod.MIGRATIONS = real

    assert raised is not None  # the migration really did fail
    assert version == 3  # …and was NOT stamped
    assert "half_applied" not in cols  # …and its first, successful statement was rolled back


def test_a_crash_on_the_first_statement_also_leaves_the_version_alone() -> None:
    """The other end of the same window: nothing applied, nothing stamped. A version stamp must never
    outrun the script it belongs to, in either direction."""
    real = dbmod.MIGRATIONS
    with _workspace() as tmp:
        try:
            raised, version, _cols = run_async(_crash_then_inspect(tmp / "m.db", _POISON_EARLY))
        finally:
            dbmod.MIGRATIONS = real

    assert raised is not None
    assert version == 3


def test_a_reboot_after_the_crash_applies_the_real_migration_in_full() -> None:
    """Recovery, which is the whole point: the interrupted attempt must not wedge the database. Booting
    the shipped list after the crash applies v4 completely — version stamped, all four columns present,
    and no residue from the poisoned attempt."""
    real = dbmod.MIGRATIONS

    async def go() -> tuple[int, list[str]]:
        with _workspace() as tmp:
            path = tmp / "m.db"
            await _crash_then_inspect(path, _POISON_LATE)
            db = await _boot(path, real)
            version = await db.schema_version()
            cols = await _columns(db, "events")
            await db.close()
            return version, cols

    try:
        version, cols = run_async(go())
    finally:
        dbmod.MIGRATIONS = real

    # The shipped list applies EVERY pending migration, so the stamp is the current tail (v5 landed in
    # A3 slice 2) — read off `MIGRATIONS` rather than pinned, since what this asserts is "recovery
    # completed", and the v4 columns below are what proves the poisoned attempt left no residue.
    assert version == real[-1][0] >= 4
    for col in ("origin", "origin_id", "run_id", "decision"):
        assert col in cols
    assert "half_applied" not in cols


def test_a_cancel_during_the_cleanup_rollback_keeps_the_original_failure_and_the_connection() -> None:
    """The cleanup path under a RAW `Task.cancel()` (post-14a verify, LOW) — a shutdown racing a failing
    startup migration. Two things must hold, and a plain `rollback()` guaranteed neither:

      * the rollback COMPLETES (the shared connection is never abandoned mid-transaction, which would
        poison every later `transaction()` on it — the C3-H1 failure mode `_shielded_rollback` exists for);
      * the exception that escapes is still the MIGRATION failure. A `CancelledError` in its place would
        report a shutdown and hide the broken migration from the operator reading the boot log.

    Driven by slowing `rollback()` down and cancelling inside that window, then asserting the connection
    is genuinely still usable afterwards (a real transaction commits) — not merely that nothing raised.
    """
    real = dbmod.MIGRATIONS
    seen: dict = {}

    async def scenario() -> None:
        with _workspace() as tmp:
            db = Database(tmp / "cancel.db")
            await db.connect()  # a normal, fully-migrated database
            entered = asyncio.Event()
            real_rollback = db.conn.rollback

            async def slow_rollback() -> None:
                entered.set()
                await asyncio.sleep(0.05)  # the window the cancel lands in
                await real_rollback()
                seen["rolled_back"] = True

            db.conn.rollback = slow_rollback  # type: ignore[method-assign]
            try:
                task = asyncio.create_task(db._apply_migration(99, _POISON_LATE[1]))
                await entered.wait()
                task.cancel()  # raw cancel, mid-rollback
                try:
                    await task
                except BaseException as exc:  # noqa: BLE001 — capturing WHICH error escapes is the test
                    seen["escaped"] = type(exc).__name__
            finally:
                db.conn.rollback = real_rollback  # type: ignore[method-assign]

            # The connection survived: a fresh transaction commits (an abandoned BEGIN would fail here
            # with "cannot start a transaction within a transaction"), and the poisoned ALTER is gone.
            async with db.transaction():
                await db.execute(
                    "INSERT INTO events (id, ts, actor, action, status) VALUES (?,?,?,?,?)",
                    ("probe", "2026-07-30T00:00:00+00:00", "user", "probe", "ok"),
                )
            seen["rows"] = len(await db.query("SELECT id FROM events WHERE id = 'probe'"))
            seen["version"] = await db.schema_version()
            seen["cols"] = await _columns(db, "events")
            await db.close()

    try:
        run_async(scenario())
    finally:
        dbmod.MIGRATIONS = real

    assert seen["escaped"] == "OperationalError"  # the migration failure, NOT CancelledError
    assert seen["rolled_back"] is True  # the rollback ran to completion despite the cancel
    assert seen["rows"] == 1  # …so the connection is still transactable
    assert seen["version"] == MIGRATIONS[-1][0] and "half_applied" not in seen["cols"]


def test_no_shipped_migration_declares_its_own_transaction_control() -> None:
    """The authoring rule the mechanism depends on: `_apply_migration` composes `BEGIN … COMMIT` around
    the script + its stamp, so a script that opens or closes its own transaction would commit the
    wrapper early and restore the partial-application window."""
    for version, sql in MIGRATIONS:
        offenders = _control_statements(sql)
        assert offenders == [], f"migration {version} declares its own transaction control: {offenders}"


def test_the_control_check_is_statement_aware_not_line_aware() -> None:
    """The checker itself, pinned in both directions (post-14a verify, LOW) — a line-anchored regex got
    this wrong in both, so the test that guards the authoring rule needs its own test.

    It must not flag a trigger whose `BEGIN` legitimately starts a line (migration 3's real shape), and
    it must catch control that hides after another statement on the same line, or behind a comment.
    Statements are enumerated with `sqlite3.complete_statement` — SQLite's own predicate, which knows a
    `;` inside a `CREATE TRIGGER … BEGIN … END` body does not end the statement.
    """
    trigger = "CREATE TRIGGER t AFTER INSERT ON events\nBEGIN\n  DELETE FROM events WHERE id = 'x';\nEND;\n"
    assert _control_statements(trigger) == []  # the false-positive shape
    assert _control_statements(dict(MIGRATIONS)[3]) == []  # …and the real migration it mirrors

    assert _control_statements("CREATE TABLE x(a); COMMIT;") == ["commit"]  # hidden on a shared line
    assert _control_statements("-- set up\nBEGIN;\nCREATE TABLE x(a);") == ["begin"]  # behind a comment
    assert _control_statements("/* wrapped */ END TRANSACTION;") == ["end"]  # the COMMIT alias
    assert _control_statements("BEGIN IMMEDIATE;\nROLLBACK;") == ["begin", "rollback"]
    assert _control_statements("SAVEPOINT s; RELEASE s;") == ["savepoint", "release"]


def test_every_shipped_migration_still_applies_from_scratch() -> None:
    """The wrapper must not break any existing script — in particular migration 3 creates an FTS5
    virtual table (plus triggers and a backfill) and now does so INSIDE a transaction."""

    async def go() -> tuple[int, list[str]]:
        with _workspace() as tmp:
            db = Database(tmp / "fresh.db")
            await db.connect()
            version = await db.schema_version()
            tables = [r["name"] for r in await db.query("SELECT name FROM sqlite_master WHERE type='table'")]
            await db.close()
            return version, tables

    version, tables = run_async(go())
    assert version == MIGRATIONS[-1][0]
    for t in ("threads", "messages", "memory", "events", "messages_fts", "schema_version"):
        assert t in tables


if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    for fn in fns:
        fn()
        print(f"ok  {fn.__name__}")
    print(f"\n{len(fns)} passed")
