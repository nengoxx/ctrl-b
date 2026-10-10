"""D84 / Phase 27 S1 — conversations per agent: the data + repo half (CONVERSATIONS_PLAN §3, §4, §10 S1).

What is pinned here, one test per §10 "S1" verify bullet:

  1. migration 8 + the `_REPAIRS`: the NULL home becomes the last speaker, else the ROOT; an archived
     NULL home and a dangling slug are left alone; `seen_at` backfills to MAX(updated_at, newest message)
     so a greeting-only thread is NOT unread; a message-less thread gets `updated_at`;
  2. the repairs re-run on EVERY connect — rows an older build inserts after the stamp (a rollback by tag)
     are repaired on the next connect — and are no-ops on a clean database;
  3. `ThreadRepo.list`: an exact `agent=` match and keyset paging that neither skips nor repeats a row
     under an equal `updated_at`;
  4. `ThreadRepo.summaries`: label / preview / running / awaiting / unread, each by its §4 definition;
  5. `set_seen` monotonic + clamped to now, `set_title` trim/clear/unknown.

Every case runs on a throwaway SQLite file in a temp `$CTRLB_HOME`; the real `ctrlb.db` is never opened.
"""

from __future__ import annotations

import contextlib
import os
import tempfile
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta, timezone
from pathlib import Path

from _async import run_async

import app.db as dbmod
from app.db import MIGRATIONS, ROOT_AGENT_SLUG, Database
from app.domain.conversation import Message, TextPart, Thread, ToolCallPart, ToolResultPart
from app.domain.enums import Actor, RunState
from app.domain.result import ToolResult
from app.services.conversation import MessageRepo, ThreadRepo

T0 = datetime(2026, 10, 1, 12, 0, tzinfo=UTC)


def _t(seconds: float) -> datetime:
    return T0 + timedelta(seconds=seconds)


def _iso(seconds: float) -> str:
    return _t(seconds).isoformat()


@contextlib.contextmanager
def _workspace():
    tmp = Path(tempfile.mkdtemp())
    os.environ["CTRLB_HOME"] = str(tmp)
    try:
        yield tmp
    finally:
        os.environ.pop("CTRLB_HOME", None)


@contextlib.asynccontextmanager
async def _open(path: Path, migrations=None) -> AsyncIterator[Database]:
    """Connect (the connect-time migrate + repairs run here) against `migrations`, default the shipped list."""
    real = dbmod.MIGRATIONS
    dbmod.MIGRATIONS = migrations if migrations is not None else real
    db = Database(path)
    try:
        await db.connect()
    finally:
        dbmod.MIGRATIONS = real
    try:
        yield db
    finally:
        await db.close()


#: The shipped list as a build that predates migration 8 knows it.
_PRE8 = [m for m in MIGRATIONS if m[0] <= 7]


async def _old_thread(
    db: Database, tid: str, *, agent: str | None = None, updated: float = 0, archived=False
):
    """Insert a thread the way a pre-migration-8 build does: no `seen_at` (and usually no `agent`)."""
    await db.execute(
        "INSERT INTO threads (id, title, agent, created_at, updated_at, archived) VALUES (?, ?, ?, ?, ?, ?)",
        (tid, None, agent, _iso(0), _iso(updated), int(archived)),
    )


def _text(tid: str, role, text: str, at: float, *, agent: str | None = None, actor=None) -> Message:
    if actor is None:
        actor = Actor.AGENT if role == "assistant" else Actor.USER
    return Message(thread_id=tid, role=role, actor=actor, agent=agent, parts=[TextPart(text=text)], ts=_t(at))


def _call(tid: str, at: float, state: RunState, *, agent: str | None = "lynette") -> Message:
    return Message(
        thread_id=tid,
        role="assistant",
        actor=Actor.AGENT,
        agent=agent,
        parts=[ToolCallPart(call_id=f"c{at}", tool="question", args={"prompt": "?"}, state=state)],
        ts=_t(at),
    )


async def _row(db: Database, tid: str) -> dict:
    return dict((await db.query("SELECT * FROM threads WHERE id = ?", (tid,)))[0])


def _run(coro_fn):
    """Run `coro_fn(db, threads, messages)` on a fresh, fully-migrated database."""

    async def go():
        with _workspace() as tmp:
            async with _open(tmp / "t.db") as db:
                return await coro_fn(db, ThreadRepo(db), MessageRepo(db))

    return run_async(go())


def _legacy(seed_fn):
    """Seed a pre-8 database with `seed_fn(db, messages)`, then boot the shipped list (migration 8 +
    the repairs); return every thread row after that boot, by id."""

    async def go():
        with _workspace() as tmp:
            path = tmp / "legacy.db"
            async with _open(path, _PRE8) as db:
                await seed_fn(db, MessageRepo(db))
            async with _open(path) as db:
                assert await db.schema_version() == MIGRATIONS[-1][0]
                return {r["id"]: dict(r) for r in await db.query("SELECT * FROM threads")}

    return run_async(go())


# ── 1. the repairs ──────────────────────────────────────────────────────────────────────────────────


def test_repair_null_home_becomes_the_last_speaker() -> None:
    async def seed(db, messages):
        await _old_thread(db, "a")
        await messages.add(_text("a", "assistant", "hi", 1, agent="seraphina"))
        await messages.add(_text("a", "user", "hey", 2))
        await messages.add(_text("a", "assistant", "yo", 3, agent="lynette"))
        await messages.add(_text("a", "user", "later", 4))  # a newer USER row never speaks for the home

    assert _legacy(seed)["a"]["agent"] == "lynette"


def test_repair_null_home_falls_back_to_the_root() -> None:
    async def seed(db, messages):
        await _old_thread(db, "empty")
        await _old_thread(db, "legacy")  # an assistant row from before migration 2 carries no agent
        await messages.add(_text("legacy", "user", "hey", 1))
        await messages.add(_text("legacy", "assistant", "yo", 2, agent=None))

    rows = _legacy(seed)
    assert rows["empty"]["agent"] == ROOT_AGENT_SLUG == "default"
    assert rows["legacy"]["agent"] == ROOT_AGENT_SLUG


def test_repair_leaves_an_archived_null_home_untouched() -> None:
    async def seed(db, messages):
        await _old_thread(db, "run", archived=True)
        await messages.add(_text("run", "assistant", "done", 1, agent="lynette"))

    row = _legacy(seed)["run"]
    assert row["agent"] is None
    assert row["seen_at"] is not None  # the seen backfill is not scoped to live threads


def test_repair_leaves_a_dangling_slug_untouched() -> None:
    async def seed(db, messages):
        await _old_thread(db, "probe", agent="probe-s1")  # pinned to a slug whose folder is gone
        await messages.add(_text("probe", "assistant", "hi", 1, agent="lynette"))

    assert _legacy(seed)["probe"]["agent"] == "probe-s1"


def test_backfill_seen_at_is_the_newest_of_updated_at_and_the_newest_message_so_a_greeting_only_thread_is_not_unread() -> (
    None
):
    async def seed(db, messages):
        # `seed_greeting` adds the opening row WITHOUT touching `updated_at` — the greeting is newer.
        await _old_thread(db, "greeted", updated=0)
        await messages.add(_text("greeted", "assistant", "Hello there", 5, agent="seraphina"))
        # …and a thread touched after its newest message keeps `updated_at`.
        await _old_thread(db, "touched", updated=50)
        await messages.add(_text("touched", "assistant", "old reply", 10, agent="lynette"))

    rows = _legacy(seed)
    assert rows["greeted"]["seen_at"] == _iso(5)
    assert rows["touched"]["seen_at"] == _iso(50)

    async def unread(db, threads, messages):
        await _old_thread(db, "g")  # a NULL seen_at again, then the repair re-runs on the next connect
        await messages.add(_text("g", "assistant", "Hello there", 5, agent="seraphina"))
        await db.conn.execute(dbmod._REPAIRS[0][1])
        await db.conn.commit()
        rows_ = await threads.list(include_archived=True)
        return (await threads.summaries(rows_, ()))["g"].unread

    assert _run(unread) is False


def test_backfill_a_thread_with_no_messages_gets_its_updated_at() -> None:
    async def seed(db, messages):
        await _old_thread(db, "bare", updated=7)

    assert _legacy(seed)["bare"]["seen_at"] == _iso(7)


# ── 2. re-entrant repairs ───────────────────────────────────────────────────────────────────────────


def test_rollback_then_forward_repairs_rows_an_older_build_inserted_after_the_stamp() -> None:
    async def go():
        with _workspace() as tmp:
            path = tmp / "rb.db"
            async with _open(path) as db:  # migration 8 applied + stamped
                assert await db.schema_version() >= 8
                # …then prod rolls back by tag: the older build inserts without `seen_at`/`agent`.
                await _old_thread(db, "old", updated=3)
                await MessageRepo(db).add(_text("old", "assistant", "hi", 4, agent="lynette"))
                assert (await _row(db, "old"))["seen_at"] is None
            async with _open(path) as db:  # roll forward: 8 is stamped, no migration runs — the repairs do
                return await _row(db, "old")

    row = run_async(go())
    assert row["agent"] == "lynette"
    assert row["seen_at"] == _iso(4)


def test_the_repairs_are_noops_on_a_clean_database() -> None:
    async def go(db, threads, messages):
        await threads.create(Thread(id="x", agent="lynette", created_at=_t(0), updated_at=_t(0)))
        await messages.add(_text("x", "assistant", "hi", 1, agent="lynette"))
        await _old_thread(db, "arch", archived=True)  # an archived NULL home stays NULL: still clean
        await db.conn.execute(dbmod._REPAIRS[0][1])
        await db.conn.commit()
        before = {r["id"]: dict(r) for r in await db.query("SELECT * FROM threads")}
        changed = []
        for _needs, sql in dbmod._REPAIRS:
            cur = await db.conn.execute(sql)
            changed.append(cur.rowcount)
        await db.conn.commit()
        after = {r["id"]: dict(r) for r in await db.query("SELECT * FROM threads")}
        return changed, before, after

    changed, before, after = _run(go)
    assert changed == [0, 0]
    assert before == after


def test_migration_8_adds_the_column_and_the_index() -> None:
    async def go(db, threads, messages):
        cols = [r["name"] for r in await db.query("PRAGMA table_info(threads)")]
        idx = [r["name"] for r in await db.query("PRAGMA index_list(threads)")]
        return cols, idx

    cols, idx = _run(go)
    assert "seen_at" in cols
    assert "idx_threads_agent_updated" in idx


def test_create_seeds_seen_at_with_created_at() -> None:
    async def go(db, threads, messages):
        t = await threads.create(Thread(id="n", agent="lynette", created_at=_t(2), updated_at=_t(2)))
        stored = await threads.get("n")
        return t, stored, await _row(db, "n")

    t, stored, raw = _run(go)
    assert t.seen_at == _t(2)
    assert stored is not None and stored.seen_at == _t(2)
    assert raw["seen_at"] == _iso(2)


# ── 3. list ─────────────────────────────────────────────────────────────────────────────────────────


def test_keyset_paging_under_an_equal_updated_at_neither_skips_nor_repeats() -> None:
    async def go(db, threads, messages):
        for tid in ("a", "b", "c"):
            await threads.create(Thread(id=tid, agent="lynette", created_at=_t(0), updated_at=_t(9)))
        await threads.create(Thread(id="z", agent="lynette", created_at=_t(0), updated_at=_t(1)))
        first = await threads.list(agent="lynette", limit=2)
        last = first[-1]
        second = await threads.list(agent="lynette", limit=2, before=(last.updated_at, last.id))
        third = await threads.list(agent="lynette", limit=2, before=(second[-1].updated_at, second[-1].id))
        return [t.id for t in first], [t.id for t in second], [t.id for t in third]

    first, second, third = _run(go)
    assert first == ["c", "b"]  # equal `updated_at` → `id DESC` makes the order total
    assert second == ["a", "z"]
    assert third == []


def test_the_agent_filter_is_an_exact_match_not_a_prefix() -> None:
    async def go(db, threads, messages):
        await threads.create(Thread(id="1", agent="lyn", updated_at=_t(1)))
        await threads.create(Thread(id="2", agent="lynette", updated_at=_t(2)))
        await threads.create(Thread(id="3", agent="lynette", archived=True, updated_at=_t(3)))
        lyn = [t.id for t in await threads.list(agent="lyn")]
        lynette = [t.id for t in await threads.list(agent="lynette")]
        everything = [t.id for t in await threads.list()]
        latest = await threads.latest()
        return lyn, lynette, everything, latest

    lyn, lynette, everything, latest = _run(go)
    assert lyn == ["1"]
    assert lynette == ["2"]  # archived excluded by default
    assert everything == ["2", "1"]  # today's plain list keeps working
    assert latest is not None and latest.id == "2"


# ── 4. summaries ────────────────────────────────────────────────────────────────────────────────────


def test_label_is_the_first_user_rows_first_line_collapsed_and_cut_at_60_and_none_for_a_greeting_only_thread() -> (
    None
):
    long_first = "  Plan   the\ttrip " + "x" * 80 + "\nsecond line"

    async def go(db, threads, messages):
        await threads.create(Thread(id="u", agent="lynette", created_at=_t(0), updated_at=_t(0)))
        await messages.add(_text("u", "assistant", "Greetings!", 1, agent="lynette"))
        await messages.add(
            Message(thread_id="u", role="user", parts=[], ts=_t(2))
        )  # attachment-only, no text
        await messages.add(_text("u", "user", long_first, 3))
        await messages.add(_text("u", "user", "a later message", 4))
        await threads.create(Thread(id="titled", title="My title", agent="lynette"))
        await messages.add(_text("titled", "user", "ignored", 1))
        await threads.create(Thread(id="greet", agent="seraphina"))
        await messages.add(_text("greet", "assistant", "Welcome, traveller.", 1, agent="seraphina"))
        return await threads.summaries(await threads.list(), ())

    s = _run(go)
    assert s["u"].label == ("Plan the trip " + "x" * 80)[:60]
    assert len(s["u"].label or "") == 60
    assert s["titled"].label == "My title"
    assert s["greet"].label is None


def test_preview_skips_tool_only_rows_is_cut_at_120_and_its_agent_is_none_on_a_user_row_and_a_legacy_row() -> (
    None
):
    async def go(db, threads, messages):
        await threads.create(Thread(id="p", agent="lynette"))
        await messages.add(_text("p", "user", "hello   there\n\nfriend " + "y" * 200, 1))
        await messages.add(_call("p", 2, RunState.OK))  # tool-only assistant row
        await messages.add(
            Message(
                thread_id="p",
                role="tool",
                actor=Actor.AGENT,
                parts=[ToolResultPart(call_id="c2", result=ToolResult(state=RunState.OK, summary="ok"))],
                ts=_t(3),
            )
        )
        await threads.create(Thread(id="legacy", agent="default"))
        await messages.add(_text("legacy", "assistant", "old reply", 1, agent=None))
        await threads.create(Thread(id="spoken", agent="lynette"))
        await messages.add(_text("spoken", "assistant", "a reply", 1, agent="seraphina"))
        await threads.create(Thread(id="empty", agent="lynette"))
        return await threads.summaries(await threads.list(), ())

    s = _run(go)
    p = s["p"].preview
    assert p is not None
    assert p.role == "user" and p.agent is None
    assert p.text == ("hello there friend " + "y" * 200)[:120] and len(p.text) == 120
    assert p.ts == _t(1)
    legacy = s["legacy"].preview
    assert legacy is not None and legacy.role == "assistant" and legacy.agent is None
    spoken = s["spoken"].preview
    assert spoken is not None and spoken.agent == "seraphina" and spoken.text == "a reply"
    assert s["empty"].preview is None and s["empty"].label is None


def test_running_is_membership_in_the_given_ids() -> None:
    async def go(db, threads, messages):
        await threads.create(Thread(id="r1", agent="lynette"))
        await threads.create(Thread(id="r2", agent="lynette"))
        return await threads.summaries(await threads.list(), {"r2", "elsewhere"})

    s = _run(go)
    assert s["r1"].running is False and s["r2"].running is True


def test_unread_ignores_an_exec_pair() -> None:
    async def go(db, threads, messages):
        await threads.create(Thread(id="e", agent="lynette", created_at=_t(0), updated_at=_t(0)))
        # `run_user_exec`'s pair: an assistant row with `actor = user` + a tool row, both after seen_at.
        await messages.add(
            Message(
                thread_id="e",
                role="assistant",
                actor=Actor.USER,
                parts=[
                    ToolCallPart(call_id="x", tool="run_shell", args={"command": "ls"}, state=RunState.OK)
                ],
                ts=_t(5),
            )
        )
        await messages.add(
            Message(
                thread_id="e",
                role="tool",
                actor=Actor.USER,
                parts=[ToolResultPart(call_id="x", result=ToolResult(state=RunState.OK, summary="ok"))],
                ts=_t(6),
            )
        )
        return (await threads.summaries(await threads.list(), ()))["e"]

    s = _run(go)
    assert s.unread is False
    assert s.awaiting is False


def test_unread_after_an_agent_reply_and_cleared_by_set_seen_at_its_ts() -> None:
    async def go(db, threads, messages):
        await threads.create(Thread(id="u", agent="lynette", created_at=_t(0), updated_at=_t(0)))
        await messages.add(_text("u", "user", "hi", 1))
        before_reply = (await threads.summaries(await threads.list(), ()))["u"].unread
        reply = await messages.add(_text("u", "assistant", "hello", 2, agent="lynette"))
        after_reply = (await threads.summaries(await threads.list(), ()))["u"].unread
        moved = await threads.set_seen("u", reply.ts, now=_t(100))
        after_seen = (await threads.summaries(await threads.list(), ()))["u"].unread
        return before_reply, after_reply, moved, after_seen

    before_reply, after_reply, moved, after_seen = _run(go)
    assert before_reply is False  # a user row alone never dots unread
    assert after_reply is True
    assert moved is True
    assert after_seen is False


def test_awaiting_counts_a_parked_call_after_the_last_owner_row_however_old_and_ignores_one_an_owner_row_follows() -> (
    None
):
    async def go(db, threads, messages):
        await threads.create(Thread(id="q", agent="lynette"))
        await messages.add(_text("q", "user", "do it", 1))
        await messages.add(_call("q", 2, RunState.AWAITING_CONFIRM))
        await threads.create(Thread(id="ans", agent="lynette"))
        await messages.add(_text("ans", "user", "ask me", 1))
        await messages.add(_call("ans", 2, RunState.AWAITING_ANSWER))
        await threads.create(Thread(id="old", agent="lynette"))  # parked a year ago — no TTL
        await messages.add(_text("old", "user", "do it", -400 * 86400))
        await messages.add(_call("old", -400 * 86400 + 1, RunState.AWAITING_CONFIRM))
        await threads.create(Thread(id="done", agent="lynette"))  # resolved: the state flipped
        await messages.add(_text("done", "user", "do it", 1))
        await messages.add(_call("done", 2, RunState.OK))
        s1 = await threads.summaries(await threads.list(), ())
        # the owner moves on instead of answering: an owner row follows the parked call → it drops out
        await messages.add(_text("q", "user", "never mind", 3))
        s2 = await threads.summaries(await threads.list(), ())
        return s1, s2

    s1, s2 = _run(go)
    assert s1["q"].awaiting is True
    assert s1["ans"].awaiting is True
    assert s1["old"].awaiting is True
    assert s1["done"].awaiting is False
    assert s2["q"].awaiting is False
    assert s2["ans"].awaiting is True


def test_summaries_of_an_empty_page_is_empty() -> None:
    async def go(db, threads, messages):
        return await threads.summaries([], {"x"})

    assert _run(go) == {}


# ── 5. set_seen / set_title ─────────────────────────────────────────────────────────────────────────


def test_set_seen_is_monotonic_and_clamped_to_now() -> None:
    async def go(db, threads, messages):
        await threads.create(Thread(id="s", agent="lynette", created_at=_t(0), updated_at=_t(0)))
        results = [
            await threads.set_seen("s", _t(10), now=_t(100)),  # moves
            await threads.set_seen("s", _t(5), now=_t(100)),  # older → never moves back
            await threads.set_seen("s", _t(10), now=_t(100)),  # equal → no move
            await threads.set_seen("s", _t(500), now=_t(100)),  # future → clamped to now
            await threads.set_seen("s", _t(400), now=_t(100)),  # still future → clamped = stored, no move
            await threads.set_seen("unknown", _t(10), now=_t(100)),
        ]
        # a non-UTC instant is stored in the UTC `_iso` text the unread predicate compares against
        tz = datetime(2026, 10, 1, 14, 5, tzinfo=timezone(timedelta(hours=2)))
        results.append(await threads.set_seen("s", tz, now=_t(1000)))
        return results, (await _row(db, "s"))["seen_at"]

    results, stored = _run(go)
    assert results == [True, False, False, True, False, False, True]
    assert stored == _iso(300)  # 14:05+02:00 == 12:05Z == T0 + 300 s


def test_set_seen_refuses_a_naive_datetime() -> None:
    async def go(db, threads, messages):
        await threads.create(Thread(id="s"))
        try:
            await threads.set_seen("s", datetime(2026, 10, 1, 12, 0))
        except ValueError:
            return True
        return False

    assert _run(go) is True


def test_set_title_trims_clears_on_empty_or_none_and_is_false_for_an_unknown_id() -> None:
    async def go(db, threads, messages):
        await threads.create(Thread(id="t", title="Old"))
        out = []
        out.append((await threads.set_title("t", "  New name  "), (await _row(db, "t"))["title"]))
        out.append((await threads.set_title("t", ""), (await _row(db, "t"))["title"]))
        await threads.set_title("t", "Again")
        out.append((await threads.set_title("t", None), (await _row(db, "t"))["title"]))
        out.append((await threads.set_title("t", "   "), (await _row(db, "t"))["title"]))
        out.append((await threads.set_title("nope", "x"), None))
        return out

    assert _run(go) == [(True, "New name"), (True, None), (True, None), (True, None), (False, None)]


def test_the_root_agent_slug_is_the_settings_default_agent_name() -> None:
    from app.config import Settings

    assert ROOT_AGENT_SLUG == Settings.DEFAULT_AGENT_NAME


# ── S1 fix wave (the two-reviewer round) ────────────────────────────────────────────────────────────


def test_set_seen_answers_from_the_guarded_update_not_the_stale_pre_read() -> None:
    """A write interleaving between the lock-free pre-read and the guarded UPDATE (another `set_seen`
    advancing the floor past the target) leaves the UPDATE matching nothing: that is `False` — no
    spurious `seen` publish — and the stored floor is untouched."""

    async def go(db, threads, messages):
        await threads.create(Thread(id="s", created_at=_t(0), updated_at=_t(0)))
        assert await threads.set_seen("s", _t(50), now=_t(100))
        real_query = db.query

        async def stale_query(sql: str, params: tuple = ()):
            if sql.startswith("SELECT seen_at FROM threads"):
                return [{"seen_at": _iso(1)}]  # what the read saw BEFORE the other write landed
            return await real_query(sql, params)

        db.query = stale_query  # type: ignore[method-assign]
        try:
            moved = await threads.set_seen("s", _t(20), now=_t(100))
        finally:
            db.query = real_query  # type: ignore[method-assign]
        return moved, (await _row(db, "s"))["seen_at"]

    moved, stored = _run(go)
    assert moved is False
    assert stored == _iso(50)


def test_a_first_user_row_blank_only_to_python_labels_none_and_never_raises() -> None:
    """`_FTS_HAS_TEXT` trims only ASCII blanks, so a row of U+3000 / \\v passes the SQL test; the label
    is the first non-blank line OF THAT ROW — none here — so `None`, never an IndexError that would
    500 the whole list. (Row-scoped by design: the later real row does not become the label.)"""

    async def go(db, threads, messages):
        await threads.create(Thread(id="ws", agent="lynette"))
        await messages.add(_text("ws", "user", "　", 1))
        await messages.add(_text("ws", "user", "Real first line\nsecond", 2))
        await threads.create(Thread(id="vt", agent="lynette"))
        await messages.add(_text("vt", "user", "\x0b\x0c ", 1))
        await threads.create(Thread(id="lead", agent="lynette"))
        await messages.add(_text("lead", "user", "　\n  Actual   words  \nmore", 1))
        return await threads.summaries(await threads.list(), ())

    s = _run(go)
    assert s["ws"].label is None
    assert s["vt"].label is None
    assert s["lead"].label == "Actual words"
    assert s["ws"].preview is not None and s["ws"].preview.text == "Real first line second"


def test_preview_skips_a_newest_exec_pair() -> None:
    async def go(db, threads, messages):
        await threads.create(Thread(id="x", agent="lynette"))
        await messages.add(_text("x", "user", "check the disk", 1))
        await messages.add(_text("x", "assistant", "Looks fine.", 2, agent="lynette"))
        await messages.add(
            Message(
                thread_id="x",
                role="assistant",
                actor=Actor.USER,
                parts=[
                    ToolCallPart(call_id="e", tool="run_shell", args={"command": "df"}, state=RunState.OK)
                ],
                ts=_t(3),
            )
        )
        await messages.add(
            Message(
                thread_id="x",
                role="tool",
                actor=Actor.USER,
                parts=[ToolResultPart(call_id="e", result=ToolResult(state=RunState.OK, summary="ok"))],
                ts=_t(4),
            )
        )
        return (await threads.summaries(await threads.list(), ()))["x"].preview

    p = _run(go)
    assert p is not None
    assert p.role == "assistant" and p.agent == "lynette" and p.text == "Looks fine." and p.ts == _t(2)
