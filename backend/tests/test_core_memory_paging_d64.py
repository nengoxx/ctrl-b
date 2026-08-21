"""D64 — honest reads + the server-side delete guard (CORE_MEMORY_PLAN §17, DECISIONS D64).

The incident this closes: a model was handed a TRUNCATED topic, spliced a content hash out of the
read head, and deleted a topic it had seen a third of. D64 answers both halves — reads PAGE (so the
whole topic is reachable) and the authority to destroy is MINTED FROM READS and held by the server
(so the model carries no token at all). What's exercised here:

  1. Paging      — the page budget in lines and chars, the line-boundary rule and its overlong-line
                   exception, the empty file, past-EOF, the off-by-ones, and the marker's facts.
  2. Coverage    — a high-water mark banked ONLY when the budget accepted the framed page, reset by
                   a hash change, unmoved by an out-of-order page, and carried across a
                   suspend/resume through the opaque receipt in `ToolResult.data` (which is
                   persisted, and is never what the model reads).
  3. Delete gate — fail-closed with no read state, refused with no/partial coverage (steering to
                   the exact next offset), refused on a topic that changed under the reader, refused
                   to the OWNER for a topic no turn can read, allowed after a full paged read — and
                   the D60 crash-retry index-only branch still working through it.
  4. Riders      — the `.md` slug strip + the legacy-twin refusal, `_drop_entry`'s narrowed
                   contract, `CoreTopic.chars`/`CoreStatus.oversized`, the partial-prefix `old_text`
                   pin, and the repeat suppression that now carries the prior ERROR.
  5. Sizing      — the three measurements D64 §2.5 demands: the §14f family's FRAMED cost at the new
                   `recall_char_limit` default with a ≥10% margin, the worst in-cap family's call
                   count against `max_iterations`, and the `InvocationContext` construction-site
                   enumeration (every path that exposes `core_memory` threads a `RecallState`).

Every test runs against a synthesized corpus in its own `$CTRLB_HOME` (conftest) — never the owner's
real config, memory dir or vault.
"""

from __future__ import annotations

import ast
import os
from pathlib import Path

import pytest
import yaml
from _async import run_async

from app.config import CoreMemoryCfg, load_settings
from app.domain.enums import RunState
from app.services.agent import core_memory as cm
from app.services.agent.core_memory import (
    CORE_MEMORY_TOOL,
    CoreMemoryCorpus,
    CoreMemoryError,
    ReadCoverage,
    RecallState,
)
from app.services.agent.core_memory_tool import RECALL_RECEIPT

BACKEND = Path(__file__).resolve().parents[1]

# ── fixtures (the `test_core_memory_tool_d57` shapes, imported by copy — one corpus per test) ──────


def _corpus(tmp_path: Path, *, backend: str | None = "core", memory: dict | None = None, **core):
    cfg = tmp_path / "config.yaml"
    payload = {"memory": {**(memory or {}), "longterm": {"backend": backend, "core": core}}}
    cfg.write_text(yaml.safe_dump(payload), encoding="utf-8")
    return CoreMemoryCorpus(load_settings(cfg))


def _root() -> Path:
    root = Path(os.environ["CTRLB_HOME"]) / "memories" / "core"
    root.mkdir(parents=True, exist_ok=True)
    return root


def _topic(root: Path, rel: str, text: str) -> Path:
    path = root / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")
    return path


def _index(root: Path, *lines: str) -> None:
    (root / "MEMORY.md").write_text("\n".join(lines) + "\n", encoding="utf-8")


#: A fixed frontmatter block, so a page boundary is arithmetic rather than a guess: every fixture
#: topic below is exactly `_HEAD_CHARS + 40 × body lines` characters over `_HEAD_LINES + n` lines.
_HEAD = "---\nname: T\ndescription: d\n---\n\n"
_HEAD_LINES = _HEAD.count("\n")
_HEAD_CHARS = len(_HEAD)
_WIDTH = 40  # chars per body line, newline included


def _lines(n: int) -> str:
    return "".join(f"L{i:03d}".ljust(_WIDTH - 1) + "\n" for i in range(1, n + 1))


def _paged(root: Path, rel: str, n: int) -> int:
    """One topic of `n` 40-char body lines under `_HEAD`. Returns its TOTAL line count."""
    _topic(root, rel, _HEAD + _lines(n))
    return n + _HEAD_LINES


def _cap_for(body_lines: int) -> int:
    """The `topic_char_limit` that fits exactly `body_lines` body lines in the FIRST page."""
    return _HEAD_CHARS + _WIDTH * body_lines


def _tool(corpus: CoreMemoryCorpus | None, **args):
    from app.core.tool import InvocationContext
    from app.domain.enums import Actor, Privilege
    from app.services.agent.core_memory_tool import CoreMemoryInput, core_memory
    from app.services.deps import Deps

    deps = Deps.__new__(Deps)
    deps.core_memory = corpus
    ctx = InvocationContext(
        actor=Actor.AGENT,
        privilege=Privilege.CONFIRM,
        deps=deps,
        stamps=args.pop("stamps", None),
        recall=args.pop("recall", None),
    )
    return run_async(core_memory(CoreMemoryInput(**args), ctx))


def _page_through(corpus: CoreMemoryCorpus, rel: str, state: RecallState) -> int:
    """Follow the marker the way a model would until `rel` is fully covered; returns the page count."""
    for pages in range(1, 65):  # bounded: each page advances, so this converges
        covered = state.reads.get(rel)
        result = _tool(
            corpus, action="read", path=rel, offset=covered.seen + 1 if covered else 1, recall=state
        )
        assert result.state is RunState.OK, result.error
        if state.reads[rel].complete:
            return pages
    raise AssertionError(f"{rel} never reached full coverage")  # pragma: no cover - a bug, not slowness


def _covered(corpus: CoreMemoryCorpus, *rels: str) -> RecallState:
    state = RecallState()
    for rel in rels:
        _page_through(corpus, rel, state)
    return state


# ── 1. paging (§2.1) ──────────────────────────────────────────────────────────────────────────────


def test_a_page_stops_at_the_char_budget_and_the_next_one_continues_exactly(tmp_path):
    """The two pages of a topic, concatenated, ARE the topic: a page ends on a line boundary inside
    `topic_char_limit`, and the offset its marker names starts at the very next character."""
    root = _root()
    total = _paged(root, "long.md", 40)
    corpus = _corpus(tmp_path, topic_char_limit=_cap_for(15))
    raw = (root / "long.md").read_text(encoding="utf-8")

    first = corpus.read_topic("long.md")
    assert first.first_line == 1 and first.last_line == _HEAD_LINES + 15 and first.lines == total
    assert len(first.text) == _cap_for(15) and not first.complete

    second = corpus.read_topic("long.md", first.last_line + 1)
    assert second.first_line == first.last_line + 1
    assert second.text == raw[len(first.text) : len(first.text) + _WIDTH * 15]
    third = corpus.read_topic("long.md", second.last_line + 1)
    assert first.text + second.text + third.text == raw and third.last_line == total


def test_limit_bounds_a_page_in_lines_and_the_char_cap_still_wins(tmp_path):
    """Whichever trips FIRST ends the page: a small `limit` inside a large budget, and a large
    `limit` outside a small one."""
    root = _root()
    _paged(root, "long.md", 40)
    corpus = _corpus(tmp_path, topic_char_limit=_cap_for(15))

    assert corpus.read_topic("long.md", 1, 3).last_line == 3  # `limit` bites first
    assert corpus.read_topic("long.md", 1, 999).last_line == _HEAD_LINES + 15  # the char cap does


def test_a_line_longer_than_the_page_budget_is_emitted_whole(tmp_path):
    """The honesty rule (§2.1): pages break only at line boundaries, so a single over-budget line is
    sent WHOLE and charged in full. A partial line would advertise coverage of characters the model
    never saw — and coverage is what authorizes a delete."""
    root = _root()
    _topic(root, "wide.md", "---\nname: W\ndescription: d\n---\n\n" + "x" * 900 + "\ntail\n")
    corpus = _corpus(tmp_path, topic_char_limit=100)

    page = corpus.read_topic("wide.md", 6)
    assert page.text == "x" * 900 + "\n" and len(page.text) > 100  # whole, over budget, one line
    assert page.first_line == 6 and page.last_line == 6 and not page.complete


def test_an_empty_topic_reads_complete_at_offset_one_and_refuses_any_other(tmp_path):
    root = _root()
    _topic(root, "empty.md", "")
    _index(root, "- [Empty](empty.md) — nothing yet")
    corpus = _corpus(tmp_path)

    page = corpus.read_topic("empty.md")
    assert page.text == "" and page.lines == 0 and page.complete  # the whole file, which is nothing
    with pytest.raises(CoreMemoryError) as exc:
        corpus.read_topic("empty.md", 2)
    assert "0 line(s)" in str(exc.value)


def test_the_off_by_ones_at_both_ends(tmp_path):
    """`offset` is 1-based and inclusive at both ends: the last line reads, one past it refuses with
    the REAL line count, and 0 is not a line number."""
    root = _root()
    total = _paged(root, "long.md", 10)
    corpus = _corpus(tmp_path)

    last = corpus.read_topic("long.md", total)
    assert last.first_line == total and last.last_line == total and not last.complete
    with pytest.raises(CoreMemoryError) as past:
        corpus.read_topic("long.md", total + 1)
    assert f"{total:,} line(s)" in str(past.value) and f"{total + 1:,}" in str(past.value)
    with pytest.raises(CoreMemoryError) as under:
        corpus.read_topic("long.md", 0)
    assert "1-based" in str(under.value)


def test_the_partial_marker_states_facts_and_the_call_that_continues_it(tmp_path):
    """FACTS ONLY (§2.1): which lines of how many, how many chars of how many, and the exact next
    call — no hash (the model carries no token) and no policy prose (the rail carries the rule)."""
    root = _root()
    total = _paged(root, "long.md", 40)
    cap = _cap_for(15)
    corpus = _corpus(tmp_path, topic_char_limit=cap)
    chars = len((root / "long.md").read_text(encoding="utf-8"))
    last = _HEAD_LINES + 15

    result = _tool(corpus, action="read", path="long.md", recall=RecallState())
    head = (result.output or "").split("\n\n")[1]
    assert head == (
        f"long.md (PARTIAL: lines 1-{last} of {total} — {cap:,} of {chars:,} chars) "
        f"· continue: read offset={last + 1}"
    )
    assert "hash" not in (result.output or "")


def test_a_page_that_ends_at_eof_without_starting_at_one_is_still_partial(tmp_path):
    """Honest by construction: reaching the end is not the same as having seen the beginning, so the
    tail page is marked PARTIAL — with no continuation, because there is nothing after it."""
    root = _root()
    total = _paged(root, "long.md", 10)
    corpus = _corpus(tmp_path)

    result = _tool(corpus, action="read", path="long.md", offset=total, recall=RecallState())
    head = (result.output or "").split("\n\n")[1]
    assert head.startswith(f"long.md (PARTIAL: lines {total}-{total} of {total}") and "continue" not in head


def test_a_complete_read_gets_a_plain_head(tmp_path):
    root = _root()
    _paged(root, "short.md", 3)
    corpus = _corpus(tmp_path)

    result = _tool(corpus, action="read", path="short.md", recall=RecallState())
    assert (result.output or "").split("\n\n")[1] == "short.md"


# ── 2. coverage (§2.2) ────────────────────────────────────────────────────────────────────────────


def test_coverage_advances_only_as_the_pages_are_accepted(tmp_path):
    root = _root()
    total = _paged(root, "long.md", 40)
    corpus = _corpus(tmp_path, topic_char_limit=_cap_for(15))
    state = RecallState()

    _tool(corpus, action="read", path="long.md", recall=state)
    assert state.reads["long.md"] == ReadCoverage(
        hash=corpus.read_topic("long.md").content_hash, total_lines=total, seen=_HEAD_LINES + 15
    )
    assert not state.reads["long.md"].complete
    assert _page_through(corpus, "long.md", state) == 2  # …two more pages finish it
    assert state.reads["long.md"].complete


def test_a_page_the_budget_refused_banks_nothing(tmp_path):
    """The mint point is budget ACCEPTANCE (§2.2): a page the model never received must not advance
    coverage, or a turn could earn a delete out of results it was refused."""
    root = _root()
    _paged(root, "long.md", 40)
    # What ONE page costs, framing and floor included — measured, then made the whole turn's budget.
    probe = RecallState()
    _tool(_corpus(tmp_path, topic_char_limit=_cap_for(15)), action="read", path="long.md", recall=probe)
    corpus = _corpus(tmp_path, topic_char_limit=_cap_for(15), recall_char_limit=probe.used)
    state = RecallState()

    assert _tool(corpus, action="read", path="long.md", recall=state).state is RunState.OK
    banked = state.reads["long.md"]
    refused = _tool(corpus, action="read", path="long.md", offset=banked.seen + 1, recall=state)
    assert refused.state is RunState.ERROR and "recall limit" in (refused.error or "")
    assert state.reads["long.md"] == banked  # unmoved


def test_an_out_of_order_page_does_not_bank(tmp_path):
    """The recorded trade of the high-water int: a page that skips ahead earns nothing (the marker
    always steers sequentially, so a model that jumps simply re-reads)."""
    root = _root()
    _paged(root, "long.md", 40)
    corpus = _corpus(tmp_path, topic_char_limit=_cap_for(15))
    state = RecallState()

    _tool(corpus, action="read", path="long.md", offset=_HEAD_LINES + 16, recall=state)
    assert state.reads["long.md"].seen == 0
    _tool(corpus, action="read", path="long.md", offset=1, recall=state)
    assert state.reads["long.md"].seen == _HEAD_LINES + 15


def test_a_page_read_under_a_new_hash_resets_that_paths_coverage(tmp_path):
    """The file changed, so everything read before it describes a topic that no longer exists."""
    root = _root()
    _paged(root, "long.md", 40)
    corpus = _corpus(tmp_path, topic_char_limit=_cap_for(15))
    state = RecallState()
    _tool(corpus, action="read", path="long.md", recall=state)
    assert state.reads["long.md"].seen == _HEAD_LINES + 15

    _paged(root, "long.md", 30)  # rewritten between pages
    _tool(corpus, action="read", path="long.md", offset=_HEAD_LINES + 16, recall=state)
    assert state.reads["long.md"].seen == 0  # a jump-ahead page under the NEW hash banks nothing
    _page_through(corpus, "long.md", state)
    assert state.reads["long.md"].complete  # …and reading it again from the top re-earns coverage


def test_a_topic_that_grew_between_pages_is_not_complete(tmp_path):
    """Grow/shrink between pages: the second page observes a new hash, so the first page's coverage
    is void and `total_lines` is the CURRENT file's — never the one the turn started against."""
    root = _root()
    _paged(root, "long.md", 15)
    corpus = _corpus(tmp_path, topic_char_limit=_cap_for(15))
    state = RecallState()
    _tool(corpus, action="read", path="long.md", recall=state)
    assert state.reads["long.md"].complete

    grown = _paged(root, "long.md", 60)
    _tool(corpus, action="read", path="long.md", recall=state)
    assert state.reads["long.md"].total_lines == grown and not state.reads["long.md"].complete


def test_the_receipt_rides_the_result_data_and_never_the_model_facing_text(tmp_path):
    root = _root()
    total = _paged(root, "short.md", 3)
    corpus = _corpus(tmp_path)

    result = _tool(corpus, action="read", path="short.md", recall=RecallState())
    receipt = result.data[RECALL_RECEIPT]
    assert receipt == {
        "path": "short.md",
        "hash": corpus.read_topic("short.md").content_hash,
        "total_lines": total,
        "seen": total,
    }
    assert receipt["hash"] not in (result.output or "") + result.summary


def test_a_read_with_no_recall_state_banks_no_receipt(tmp_path):
    """Nothing to bank into — and the read itself still works (a non-agent caller may read)."""
    root = _root()
    _paged(root, "short.md", 3)
    corpus = _corpus(tmp_path)

    result = _tool(corpus, action="read", path="short.md")
    assert result.state is RunState.OK and result.data == {}


def test_the_receipts_survive_a_suspend_resume_sparsely_and_interleaved(tmp_path):
    """The resumed session rebuilds coverage from the persisted receipts of the SAME logical turn —
    sparse (only some calls carry one), interleaved with another tool's results, and never from the
    human marker. An earlier turn's receipts stay outside the walk."""
    from app.db import Database
    from app.domain.conversation import Message, Thread, ToolCallPart, ToolResultPart
    from app.domain.result import ToolResult
    from app.services.agent.session import AgentSession
    from app.services.conversation import MessageRepo, ThreadRepo

    root = _root()
    _paged(root, "a.md", 30)  # exactly two pages at this cap
    _paged(root, "b.md", 3)
    corpus = _corpus(tmp_path, topic_char_limit=_cap_for(15))

    # The live turn's calls run OUTSIDE the async body: `_tool` drives the shared test loop itself.
    live = RecallState()
    pages = [
        _tool(corpus, action="read", path="a.md", recall=live),
        _tool(corpus, action="search", query="L001", recall=live),  # a read-class call with no receipt
        _tool(corpus, action="read", path="b.md", recall=live),
        _tool(corpus, action="read", path="a.md", offset=_HEAD_LINES + 16, recall=live),
    ]
    assert all(page.state is RunState.OK for page in pages)

    async def go():
        db = Database(tmp_path / "t.db")
        await db.connect()
        messages, threads = MessageRepo(db), ThreadRepo(db)
        thread = await threads.create(Thread())

        # An earlier turn's page, BEFORE the user message — it must not survive the boundary.
        await messages.add(
            Message(
                thread_id=thread.id,
                role="assistant",
                parts=[ToolCallPart(call_id="old", tool=CORE_MEMORY_TOOL, args={"action": "read"})],
            )
        )
        await messages.add(
            Message(
                thread_id=thread.id,
                role="tool",
                parts=[ToolResultPart(call_id="old", result=pages[0])],
            )
        )
        await messages.add(Message(thread_id=thread.id, role="user"))
        for i, produced in enumerate(pages):
            call_id = f"c{i}"
            await messages.add(
                Message(
                    thread_id=thread.id,
                    role="assistant",
                    parts=[
                        ToolCallPart(call_id=call_id, tool=CORE_MEMORY_TOOL, args={"action": "read"}),
                        ToolCallPart(call_id=f"x{i}", tool="ping_host", args={}),
                    ],
                )
            )
            await messages.add(
                Message(
                    thread_id=thread.id,
                    role="tool",
                    parts=[
                        ToolResultPart(call_id=call_id, result=produced),
                        ToolResultPart(
                            call_id=f"x{i}",
                            result=ToolResult(state=RunState.OK, summary="p", output="Z" * 50),
                        ),
                    ],
                )
            )

        resumed = AgentSession(threads, messages, None, corpus.settings, None, core_memory=corpus)
        assert resumed._recall.reads == {}
        await resumed._seed_recall(thread)
        assert resumed._recall.reads == live.reads  # rebuilt exactly, from receipts only
        assert resumed._recall.reads["a.md"].complete and resumed._recall.reads["b.md"].complete
        assert resumed._recall.used == live.used

    run_async(go())


def test_a_receipt_round_trips_through_the_database_verbatim(tmp_path):
    """`ToolResult.data` is persisted as JSON with the parts (`services/conversation._PARTS`) — the
    build-time check D64 §2.2 asks for, since the whole resume rail rests on it."""
    from app.db import Database
    from app.domain.conversation import Message, Thread, ToolResultPart
    from app.services.conversation import MessageRepo, ThreadRepo

    root = _root()
    _paged(root, "short.md", 3)
    corpus = _corpus(tmp_path)
    produced = _tool(corpus, action="read", path="short.md", recall=RecallState())

    async def go():
        db = Database(tmp_path / "t.db")
        await db.connect()
        messages, threads = MessageRepo(db), ThreadRepo(db)
        thread = await threads.create(Thread())
        await messages.add(
            Message(thread_id=thread.id, role="tool", parts=[ToolResultPart(call_id="a", result=produced)])
        )
        rows = await messages.list(thread.id)
        assert rows[0].tool_results()[0].result.data == produced.data

    run_async(go())


def test_a_malformed_receipt_grants_nothing(tmp_path):
    """Persisted JSON is replayed from a DB row that another build — or a hand edit — may have
    written, and this one authorizes destruction. Every field is re-validated."""
    state = RecallState()
    for junk in (
        None,
        "not a dict",
        {"path": "", "hash": "h", "total_lines": 3, "seen": 3},
        {"path": "a.md", "hash": "", "total_lines": 3, "seen": 3},
        {"path": "a.md", "hash": "h", "total_lines": 3, "seen": 4},  # seen past total
        {"path": "a.md", "hash": "h", "total_lines": -1, "seen": 0},
        {"path": "a.md", "hash": "h", "total_lines": True, "seen": True},  # bools are not counts
        {"path": "a.md", "hash": "h", "total_lines": "3", "seen": "3"},
        {"path": "a.md", "hash": "h"},
    ):
        state.restore(junk)
    assert state.reads == {}
    state.restore({"path": "a.md", "hash": "h", "total_lines": 3, "seen": 3})
    assert state.reads["a.md"].complete


# ── 3. the delete guard (§2.3) ────────────────────────────────────────────────────────────────────


def test_a_delete_with_no_read_state_fails_closed(tmp_path):
    """A non-agent caller (a direct API invoke) reaches the tool with no `RecallState`. Nothing
    recorded what was read, so nothing can authorize destroying it."""
    root = _root()
    _paged(root, "wake.md", 3)
    _index(root, "- [Wake](wake.md) — d")
    corpus = _corpus(tmp_path)

    result = _tool(corpus, action="delete", path="wake.md", reason="obsolete")
    assert result.state is RunState.ERROR and "no read state" in (result.error or "")
    assert (root / "wake.md").is_file()


def test_a_delete_of_an_unread_topic_is_refused(tmp_path):
    root = _root()
    _paged(root, "wake.md", 3)
    _paged(root, "other.md", 3)
    corpus = _corpus(tmp_path)

    state = _covered(corpus, "other.md")  # a turn that read something ELSE entirely
    result = _tool(corpus, action="delete", path="wake.md", reason="obsolete", recall=state)
    assert result.state is RunState.ERROR and "have not read wake.md" in (result.error or "")
    assert (root / "wake.md").is_file()


def test_a_partly_read_topic_is_refused_with_the_exact_next_offset(tmp_path):
    """The steering is always correct because the high-water mark IS the prefix the model was sent."""
    root = _root()
    total = _paged(root, "long.md", 40)
    _index(root, "- [Long](long.md) — d")
    corpus = _corpus(tmp_path, topic_char_limit=_cap_for(15))
    state = RecallState()
    _tool(corpus, action="read", path="long.md", recall=state)
    seen = _HEAD_LINES + 15

    result = _tool(corpus, action="delete", path="long.md", reason="obsolete", recall=state)
    assert result.state is RunState.ERROR
    assert f"lines 1-{seen} of {total}" in (result.error or "")
    assert f"offset={seen + 1}" in (result.error or "")
    assert (root / "long.md").is_file()


def test_a_fully_paged_topic_can_be_deleted(tmp_path):
    """The whole point: page through it and the delete goes through — no hash anywhere near the
    model, and the topic lands in `.archive/` (D60 ③, unchanged)."""
    root = _root()
    _paged(root, "long.md", 40)
    _index(root, "- [Long](long.md) — d", "- [Keep](keep.md) — d")
    _paged(root, "keep.md", 2)
    corpus = _corpus(tmp_path, topic_char_limit=_cap_for(15))

    state = _covered(corpus, "long.md")
    result = _tool(corpus, action="delete", path="long.md", reason="obsolete", recall=state)
    assert result.state is RunState.OK, result.error
    assert not (root / "long.md").exists() and (root / ".archive" / "long.md").is_file()
    assert (root / "MEMORY.md").read_text(encoding="utf-8") == "- [Keep](keep.md) — d\n"


def test_a_topic_that_changed_after_being_read_is_refused_and_its_coverage_dropped(tmp_path):
    """Freshness runs BEFORE coverage (§2.3): coverage of a file that has since changed is not
    coverage of anything, and "read 20 more lines" would steer into the wrong action."""
    root = _root()
    _paged(root, "wake.md", 3)
    _index(root, "- [Wake](wake.md) — d")
    corpus = _corpus(tmp_path)
    state = _covered(corpus, "wake.md")

    _topic(root, "wake.md", "---\nname: W\ndescription: d\n---\n\nrewritten by the owner\n")
    result = _tool(corpus, action="delete", path="wake.md", reason="obsolete", recall=state)
    assert result.state is RunState.ERROR and "has changed since you read it" in (result.error or "")
    assert "wake.md" not in state.reads and (root / "wake.md").is_file()


def test_a_topic_no_turn_can_read_steers_to_the_owner(tmp_path):
    """§2.3's last clause + Opus F9: never "raise `recall_char_limit`" — that cap also protects
    small-context models. A topic bigger than one turn's budget is an owner/file operation."""
    root = _root()
    _paged(root, "huge.md", 200)  # 8,000 chars of body
    corpus = _corpus(tmp_path, topic_char_limit=_cap_for(15), recall_char_limit=2400)
    state = RecallState()
    _tool(corpus, action="read", path="huge.md", recall=state)

    result = _tool(corpus, action="delete", path="huge.md", reason="obsolete", recall=state)
    assert result.state is RunState.ERROR
    assert "owner/file operation" in (result.error or "") and "offset=" not in (result.error or "")


def test_a_topic_the_framed_budget_cannot_reach_steers_to_the_owner(tmp_path):
    """The review round's REPRODUCTION (MED): raw length was the wrong yardstick. At the SHIPPED
    caps a ~23,000-char topic is under `recall_char_limit` on content alone, but the budget charges
    the FRAMED page — so paging stops part-way, the next page is budget-refused, and the old
    classifier kept answering "continue: read offset=N" for an offset this turn could never afford.
    The classifier now prices the framing, so the model is sent to the owner instead of a grind."""
    root = _root()
    cfg = CoreMemoryCfg()
    _paged(root, "big.md", 575)  # 23,000 chars of body over 40-char lines — under the 24,576 cap
    _index(root, "- [Big](big.md) — d")
    corpus = _corpus(tmp_path, topic_char_limit=cfg.topic_char_limit, recall_char_limit=cfg.recall_char_limit)
    assert cfg.topic_char_limit < corpus.topic_chars("big.md") < cfg.recall_char_limit  # the trap

    state = RecallState()
    for _ in range(16):  # page as far as the budget allows, exactly as a model would
        covered = state.reads.get("big.md")
        page = _tool(
            corpus, action="read", path="big.md", offset=covered.seen + 1 if covered else 1, recall=state
        )
        if page.state is not RunState.OK:
            break
    else:  # pragma: no cover - the fixture is sized so the budget bites first
        raise AssertionError("the budget never refused a page")
    assert not state.reads["big.md"].complete  # …and it stalled short of the end

    result = _tool(corpus, action="delete", path="big.md", reason="obsolete", recall=state)
    assert result.state is RunState.ERROR
    assert "owner/file operation" in (result.error or "")
    assert "offset=" not in (result.error or "")  # never a continuation the turn cannot pay for


def test_an_unreadable_first_page_still_reaches_the_owner_branch(tmp_path):
    """The unreachable case the review names: when the very FIRST page is refused, no coverage was
    ever banked — so a guard that checked "you have not read this" first could never reach the owner
    branch. The impossibility test is a property of the TOPIC, so it runs before that."""
    root = _root()
    cfg = CoreMemoryCfg()
    # ONE line, longer than the whole turn's budget: the whole-line rule sends it whole (§2.1), so
    # the very first page is refused. Indexed rather than frontmattered, so the scan still sees it
    # (§3) — an unlisted topic with no frontmatter is skipped, and then nothing knows its size.
    _topic(root, "wall.md", "z" * (cfg.recall_char_limit + 1) + "\n")
    _index(root, "- [Wall](wall.md) — one very long line")
    corpus = _corpus(tmp_path, topic_char_limit=cfg.topic_char_limit, recall_char_limit=cfg.recall_char_limit)
    state = RecallState()

    refused = _tool(corpus, action="read", path="wall.md", recall=state)
    assert refused.state is RunState.ERROR and "recall limit" in (refused.error or "")
    assert state.reads == {}  # nothing banked — there is no coverage to steer from

    result = _tool(corpus, action="delete", path="wall.md", reason="obsolete", recall=state)
    assert "owner/file operation" in (result.error or "")
    assert "have not read" not in (result.error or "")


def test_the_framed_estimate_is_measured_from_the_live_frame_and_marker(tmp_path):
    """The estimate carries no magic number: it reads the resolved `core_memory_recall` text (an
    owner override moves it) and the marker `_read_result` itself renders. Pinned by making the
    frame longer and watching the verdict flip on a topic that was reachable before."""
    from app.services.agent.core_memory_tool import _framed_cost

    root = _root()
    cfg = CoreMemoryCfg()
    _paged(root, "mid.md", 400)  # 16,000 chars — comfortably reachable at the shipped frame
    corpus = _corpus(tmp_path, topic_char_limit=cfg.topic_char_limit, recall_char_limit=cfg.recall_char_limit)
    chars = corpus.topic_chars("mid.md")
    lean = _framed_cost(corpus, "mid.md", chars)
    assert chars < lean <= cfg.recall_char_limit  # framing costs something, and it still fits

    # The SAME corpus under an owner override of the frame — the one the tool actually resolves.
    wordy = tmp_path / "wordy.yaml"
    wordy.write_text(
        yaml.safe_dump(
            {
                "memory": {"longterm": {"backend": "core", "core": {}}},
                "prompts": {"core_memory_recall": {"append": "R " * 400}},
            }
        ),
        encoding="utf-8",
    )
    assert _framed_cost(CoreMemoryCorpus(load_settings(wordy)), "mid.md", chars) > lean


def test_the_crash_retry_index_only_delete_survives_the_guard(tmp_path):
    """D60's repair branch, through the model-facing door: the topic is already in `.archive/` and
    only its index line is left. There is no live file to read, so the guard hands the call to the
    corpus — which completes the index half."""
    root = _root()
    _paged(root, "wake.md", 3)
    _index(root, "- [Wake](wake.md) — d")
    corpus = _corpus(tmp_path)
    archive = root / ".archive" / "wake.md"
    archive.parent.mkdir(parents=True, exist_ok=True)
    (root / "wake.md").rename(archive)

    result = _tool(
        corpus, action="delete", path="wake.md", reason="finishing a crashed delete", recall=RecallState()
    )
    assert result.state is RunState.OK, result.error
    assert (root / "MEMORY.md").read_text(encoding="utf-8") == ""
    assert archive.is_file()  # the archived copy is untouched


def test_the_corpus_delete_still_takes_an_expected_hash_from_any_caller(tmp_path):
    """The corpus stays STATELESS (§2.3 / Opus F6): a caller that obtained the hash itself — a future
    Conf/API delete, or a test — is served, and a stale one is still refused under the lock."""
    root = _root()
    _paged(root, "wake.md", 3)
    _index(root, "- [Wake](wake.md) — d")
    corpus = _corpus(tmp_path)
    digest = corpus.read_topic("wake.md").content_hash

    with pytest.raises(CoreMemoryError) as exc:
        run_async(corpus.delete("wake.md", "0" * 64, reason="stale token"))
    assert "content hash" in str(exc.value)
    assert run_async(corpus.delete("wake.md", digest, reason="obsolete")).startswith("archived")


def test_the_corpus_refuses_to_delete_a_live_file_it_cannot_read(tmp_path):
    """Review round D10: `_content_hash` yields "" for a file that exists but cannot be READ, and an
    empty expected hash would have compared EQUAL to it — authorizing the archiving of a topic
    nobody has been able to look at. Refused before the comparison, with the truthful reason."""
    root = _root()
    _paged(root, "wake.md", 3)
    _index(root, "- [Wake](wake.md) — d")
    corpus = _corpus(tmp_path)
    (root / "wake.md").chmod(0o000)
    try:
        with pytest.raises(CoreMemoryError) as exc:
            run_async(corpus.delete("wake.md", "", reason="obsolete"))
    finally:
        (root / "wake.md").chmod(0o644)
    assert "cannot be read" in str(exc.value)
    assert (root / "wake.md").is_file() and not (root / ".archive").exists()


def test_current_hash_reports_the_live_file_or_nothing(tmp_path):
    root = _root()
    _paged(root, "wake.md", 3)
    corpus = _corpus(tmp_path)

    assert corpus.current_hash("wake.md") == corpus.read_topic("wake.md").content_hash
    assert corpus.current_hash("gone.md") is None


# ── 4. the riders (§2.7) ──────────────────────────────────────────────────────────────────────────


def test_a_name_ending_in_md_slugs_to_one_md(tmp_path):
    """§2.7a: a model naming its topic "Wake ritual.md" means the topic, not a file called
    `wake-ritual-md`. Exactly ONE trailing `.md` is stripped."""
    assert cm._slug("Wake ritual.md") == "wake-ritual.md"
    assert cm._slug("Wake ritual.MD") == "wake-ritual.md"
    assert cm._slug("notes.md.md") == "notes-md.md"  # one, not all
    assert cm._slug("Wake ritual") == "wake-ritual.md"
    assert cm._slug(".md") is None
    assert cm._slug("Wake ritual.md", legacy=True) == "wake-ritual-md.md"


def test_create_refuses_when_the_legacy_md_twin_exists(tmp_path):
    """§2.7a/Emma MED-8: the old rule may have left `wake-ritual-md.md` on disk. Creating beside it
    would open a SECOND topic for the same subject — the duplicate `create` already refuses, one
    filename rule away from being invisible."""
    root = _root()
    _topic(root, "wake-ritual-md.md", "---\nname: Wake\ndescription: d\n---\n\nbody\n")
    corpus = _corpus(tmp_path)

    with pytest.raises(CoreMemoryError) as exc:
        run_async(corpus.create("Wake ritual.md", "d", None, "new body"))
    assert "wake-ritual-md.md already covers this topic" in str(exc.value)
    assert not (root / "wake-ritual.md").exists()
    # …and with no twin on disk the same call creates the clean name.
    (root / "wake-ritual-md.md").unlink()
    assert run_async(corpus.create("Wake ritual.md", "d", None, "new body")).startswith(
        "created wake-ritual.md"
    )


def test_dropping_an_index_entry_preserves_every_other_line_as_read(tmp_path):
    """§2.7c: the old splitlines/join rebuild ate an owner's trailing blank lines. The contract is
    honestly narrowed to "as it was READ" — `_read_text` already folded CRLF to LF upstream."""
    raw = "# Index\n\n- [A](a.md) — one\n- [B](b.md) — two\n\n\n"
    assert cm._drop_entry(raw, "a.md") == "# Index\n\n- [B](b.md) — two\n\n\n"
    assert cm._drop_entry("- [A](a.md) — one", "a.md") == ""
    assert cm._drop_entry("- [B](b.md)\n- [A](a.md)", "a.md") == "- [B](b.md)\n"  # no final newline added


def test_a_crlf_index_keeps_its_surviving_lines(tmp_path):
    """The CRLF case, end to end through a real delete: the read normalizes endings (pre-existing,
    whole-path behaviour), and every surviving line — trailing blanks included — is still there."""
    root = _root()
    _paged(root, "wake.md", 2)
    _paged(root, "keep.md", 2)
    (root / "MEMORY.md").write_bytes(b"# Index\r\n\r\n- [W](wake.md)\r\n- [K](keep.md)\r\n\r\n\r\n")
    corpus = _corpus(tmp_path)

    run_async(corpus.delete("wake.md", corpus.read_topic("wake.md").content_hash, reason="obsolete"))
    assert (root / "MEMORY.md").read_text(encoding="utf-8") == "# Index\n\n- [K](keep.md)\n\n\n"


def test_a_partial_prefix_old_text_still_pins_exactly_one_passage(tmp_path):
    """§2.7d, a pin on UNCHANGED behaviour: an `old_text` that is a prefix of a longer sentence is a
    legal CAS match when it occurs once — and refused as ambiguous when it occurs twice. Paging
    changes nothing here; a model that copies a fragment must still identify one passage."""
    root = _root()
    _topic(root, "t.md", "---\nname: T\ndescription: d\n---\n\nThe host wakes on LAN.\nIt sleeps.\n")
    corpus = _corpus(tmp_path)

    assert "updated" in run_async(corpus.update("t.md", "The host wakes", "The NUC wakes"))
    assert "The NUC wakes on LAN." in (root / "t.md").read_text(encoding="utf-8")
    _topic(root, "t.md", "---\nname: T\ndescription: d\n---\n\nThe host wakes.\nThe host wakes on LAN.\n")
    with pytest.raises(CoreMemoryError) as exc:
        run_async(corpus.update("t.md", "The host wakes", "The NUC wakes"))
    assert "matches 2 places" in str(exc.value)


def test_status_counts_the_topics_that_take_more_than_one_page(tmp_path):
    """§2.7e: `CoreStatus.oversized`, derived from `CoreTopic.chars` (free — the scan already reads
    every byte). It answers the sizing question directly: is my page cap too small for this corpus?"""
    root = _root()
    _paged(root, "big.md", 40)
    _paged(root, "small.md", 2)
    _index(root, "- [Big](big.md) — d", "- [Small](small.md) — d")
    corpus = _corpus(tmp_path, topic_char_limit=_cap_for(15))

    status = corpus.status()
    assert status.oversized == 1 and status.topics == 2
    assert {t.path: t.chars for t in corpus.scan().topics}["small.md"] == len(
        (root / "small.md").read_text(encoding="utf-8")
    )
    assert _corpus(tmp_path, topic_char_limit=4096).status().oversized == 0  # a live cap edit applies


def test_the_suppression_slot_is_additive_to_the_pre_d64_text(tmp_path):
    """§2.7b, the REGISTRY half only: an empty `{{details}}` must render the pre-D64 text
    byte-for-byte (a suppression with nothing to add stays exactly as it shipped), and a filled one
    must append rather than displace. The BEHAVIOUR — that the loop passes the prior ERROR and never
    a prior success's output — is pinned where it lives, on the shared call path, in
    `test_loop_steering_aca1213.py`: this assertion alone would survive `session.py` silently
    dropping the argument."""
    from app.config import Settings
    from app.services.agent.prompts import resolve

    base = resolve("repeat_suppressed", Settings(), {"details": ""})
    assert base.endswith("give your final answer.")  # the pre-D64 text, unchanged
    assert resolve("repeat_suppressed", Settings(), {"details": "\n\nIt returned: boom"}) == (
        f"{base}\n\nIt returned: boom"
    )


# ── 5. sizing + the enumeration pin (§2.5, §2.3) ──────────────────────────────────────────────────


#: The §14f measured family: four source topics totalling 17,183 characters, consolidated in ONE
#: turn on 2026-08-19. The sizing question D64 §2.5 asks is whether the SAME family still fits once
#: paging multiplies the `core_memory_recall` frame per page.
_FAMILY = (4_600, 4_400, 4_300, 3_883)


def _family(root: Path) -> None:
    """The family as ordinary markdown — MANY lines, not one long one: the page count (and with it
    the number of `core_memory_recall` frames the budget pays for) is what the sizing turns on, and
    a single-line topic would page once by the whole-line rule and quietly under-report the cost."""
    for i, size in enumerate(_FAMILY):
        body = "".join(f"{i}-{n:04d}".ljust(_WIDTH - 1) + "\n" for n in range(size // _WIDTH))
        _topic(root, f"src{i}.md", body + "y" * (size - len(body) - 1) + "\n")


def _framed_cost(tmp_path: Path, recall_char_limit: int) -> int:
    """Page the whole §14f family with the SHIPPED `topic_char_limit`, and return what the turn's
    recall budget actually spent — framing, per-page floors and all."""
    root = _root()
    _family(root)
    corpus = _corpus(
        tmp_path,
        topic_char_limit=CoreMemoryCfg().topic_char_limit,
        recall_char_limit=recall_char_limit,
    )
    state = RecallState()
    for i in range(len(_FAMILY)):
        _page_through(corpus, f"src{i}.md", state)
    return state.used


def test_the_measured_family_fits_the_new_default_with_at_least_ten_percent_margin(tmp_path):
    """MEASUREMENT (a), D64 §2.5. Content-only arithmetic was one step short: the budget charges the
    FRAMED output, and paging pays the frame once per page. At the old 20,480 the §14f family landed
    inside by noise; the default rises to 24,576 and the margin is asserted, not assumed."""
    cap = CoreMemoryCfg().recall_char_limit
    assert cap == 24576  # the D64 default; an owner config with an explicit value keeps it
    spent = _framed_cost(tmp_path, cap)
    assert spent <= cap * 0.9, f"the §14f family costs {spent:,} of {cap:,} — under a 10% margin"
    print(f"\n[D64 §2.5 measurement a] framed cost of the §14f family: {spent:,} of {cap:,}")


def test_the_same_family_at_the_old_default_shows_why_it_rose(tmp_path):
    """The other half of the measurement: at 20,480 the same family clears by less than the 10%
    margin — the finding that made the default a ruling rather than a guess."""
    spent = _framed_cost(tmp_path, 20480)
    assert spent > 20480 * 0.9
    print(f"[D64 §2.5 measurement a'] the same family at the old cap: {spent:,} of 20,480")


def test_the_measured_family_still_fits_the_iteration_budget(tmp_path):
    """MEASUREMENT (b), D64 §2.5: paging consumes ITERATIONS as well as characters, so the §14f
    family — the one real consolidation ever measured, and the largest — is counted end to end:
    every page, the `create`, and one `delete` per source, against `max_iterations`.

    The bound is stated honestly. Paging adds calls in proportion to topic SIZE (a 4,600-char source
    costs two reads where it used to cost one truncated read), so the ceiling it can reach is the
    one measured here. It says nothing about a family of very many small topics — those page once
    each, exactly as before D64, and their call count was always ~2 per source; a family big enough
    to exhaust 16 iterations that way was already unbuildable in one turn, which is why the
    consolidation prompt's rule is ONE family per run."""
    from app.domain.agent import AgentDef

    root = _root()
    _family(root)
    cfg = CoreMemoryCfg()
    corpus = _corpus(tmp_path, topic_char_limit=cfg.topic_char_limit, recall_char_limit=cfg.recall_char_limit)
    state = RecallState()
    pages = sum(_page_through(corpus, f"src{i}.md", state) for i in range(len(_FAMILY)))

    calls = pages + 1 + len(_FAMILY)  # every page + one `create` + one `delete` per source
    ceiling = AgentDef(name="default").max_iterations
    assert calls <= ceiling, f"{calls} calls against max_iterations={ceiling}"
    print(
        f"[D64 §2.5 measurement b] the §14f family: {pages} pages + 1 create + {len(_FAMILY)} "
        f"deletes = {calls} calls of max_iterations={ceiling} ({state.used:,} chars spent)"
    )


def test_every_invocation_context_is_built_in_one_place(tmp_path):
    """MEASUREMENT (c) / §2.3's confirm-pass addition, half one: `ActionService._execute` is the ONLY
    place in `app/` that constructs an `InvocationContext`. That is what makes the second half — one
    audit of the session's invoke sites — a complete enumeration rather than a sample."""
    built = [
        str(path.relative_to(BACKEND))
        for path in sorted((BACKEND / "app").rglob("*.py"))
        for node in ast.walk(ast.parse(path.read_text(encoding="utf-8")))
        if isinstance(node, ast.Call)
        and isinstance(node.func, ast.Name)
        and node.func.id == "InvocationContext"
    ]
    assert built == ["app/services/action_service.py"]


def test_every_session_invoke_threads_the_turns_recall_state(tmp_path):
    """MEASUREMENT (c), half two: `ActionService.invoke` defaults `recall=None`, so a call site that
    forgot it would lose every model delete behind a refusal that reads like a model error. Both of
    the session's invoke sites (the serial loop and the D40 parallel prefix) must pass the turn's
    state — and a session is the only thing that owns one."""
    source = (BACKEND / "app/services/agent/session.py").read_text(encoding="utf-8")
    invokes = [
        node
        for node in ast.walk(ast.parse(source))
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) and node.func.attr == "invoke"
    ]
    assert len(invokes) == 2
    for call in invokes:
        threaded = [kw for kw in call.keywords if kw.arg == "recall"]
        assert threaded and ast.unparse(threaded[0].value) == "self._recall"


def test_every_agent_session_owns_a_recall_state(tmp_path):
    """…and the other end of the same thread: every `AgentSession` construction site — the API
    builder and the subagent runner alike — gets one by construction, because `__init__` builds it
    and nothing can pass one in. A headless automation or a subagent can therefore delete."""
    for path in (BACKEND / "app/api/agent.py", BACKEND / "app/services/agent/subagents.py"):
        source = path.read_text(encoding="utf-8")
        for node in ast.walk(ast.parse(source)):
            if isinstance(node, ast.Call) and isinstance(node.func, ast.Name):
                if node.func.id == "AgentSession":
                    assert not [kw for kw in node.keywords if kw.arg == "recall"]
    init = ast.parse((BACKEND / "app/services/agent/session.py").read_text(encoding="utf-8"))
    ctor = next(
        node
        for node in ast.walk(init)
        if isinstance(node, ast.ClassDef) and node.name == "AgentSession"
        for node in node.body
        if isinstance(node, ast.FunctionDef) and node.name == "__init__"
    )
    assert "RecallState()" in ast.unparse(ctor)
