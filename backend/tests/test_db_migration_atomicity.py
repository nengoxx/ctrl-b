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
  4. No shipped script declares its own transaction control, which would close the wrapping transaction
     early and re-open the very window this closes.

Runs as `python tests/test_db_migration_atomicity.py` from backend/ (plain asserts + a __main__ runner)
or under pytest. Every case works on a throwaway database inside a temp `$CTRLB_HOME`; the real
`ctrlb.db` is never opened.
"""

from __future__ import annotations

import contextlib
import os
import re
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

    assert version == 4
    for col in ("origin", "origin_id", "run_id", "decision"):
        assert col in cols
    assert "half_applied" not in cols


def test_no_shipped_migration_declares_its_own_transaction_control() -> None:
    """The authoring rule the mechanism depends on: `_apply_migration` composes `BEGIN … COMMIT` around
    the script + its stamp, so a script that opens or closes its own transaction would commit the
    wrapper early and restore the partial-application window.

    Matched at statement position only, and deliberately never by splitting on `;`: migration 3's FTS
    triggers contain both `BEGIN` (at the END of a `CREATE TRIGGER … BEGIN` line) and inner semicolons
    inside their bodies. A naive scan or split would flag/corrupt them.
    """
    control = re.compile(r"^\s*(begin|commit|rollback|savepoint|release)\b", re.IGNORECASE | re.MULTILINE)
    for version, sql in MIGRATIONS:
        assert control.search(sql) is None, f"migration {version} declares its own transaction control"


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
