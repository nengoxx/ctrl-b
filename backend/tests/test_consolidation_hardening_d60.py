"""D60 — the consolidation-hardening slice (CORE_MEMORY_PLAN §15 + §15b).

The Tier-1 clearing revision (①) lives with its neighbours in `test_compaction_w3_slice6.py` (section
A2) — it is `plan_clearing`'s own contract. This file owns the rest of the slice and its acceptance
list:

  1. Config     — every new knob's boundaries (§15b-10): the trigger pct's open range, the integer
                  battery (negative + NaN/±inf), `clear_keep_steps`'s retained `ge=1` pinned as
                  VALIDATION at boot AND on a Conf PUT, and back-compat (a pre-D60 config still loads).
  2. Failover   — `min_chain_window` takes the SMALLEST window across the whole chain and degrades to
                  `None` (always-on clearing) the moment ANY eligible entry has none (§15b-1).
  3. Budgets    — `core_memory` READ-class calls stop counting against `max_calls_per_tool` (②) —
                  proven through the real loop, past the blanket cap — `tool_overrides.<tool>.
                  max_calls` REPLACES that cap for one tool end to end (§15b-9), and every read-class
                  call charges `recall_min_charge_chars` whatever it returns, so a zero-char loop
                  terminates (§15b-3).
  4. Deletes    — the intent matrix at the PUBLIC boundary (blank/whitespace counts as absent),
                  create-before-delete resolved on disk, self-reference refused, both intents
                  sanitized into the D26 subject (asserted against the commit receipt, by contract
                  rather than exact wording), the SOFT delete into `.archive/`, the no-clobber
                  refusal, and restore-by-file-move (§15 ③ / §15b-4/5/8/12/13).
  5. Acceptance — §15's five: ① one turn reads past the cap then creates and deletes, with no
                  clearing and no cap denial — and a REAL suspend→resume keeps that turn's earlier
                  outputs immune after the session rebuild (§15b-6); ② run 2's exact failure is
                  refused; ③ archive + restore; ④ small-model pressure still clears; ⑤ the dry-run is
                  structural — with `memory.auto_write` off ALL FOUR write-class actions are REFUSED
                  and the corpus is byte-identical.

Every test runs against a synthesized corpus in its own `$CTRLB_HOME` (conftest) — never the owner's
real config, memory dir or vault.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import math
import os
import re
from pathlib import Path

import pytest
import yaml
from _async import run_async
from _reg import registry, target

from app.adapters.inference import InferenceClient
from app.config import CoreMemoryCfg, Settings, ToolOverride, load_settings
from app.domain.agent import CompactionCfg
from app.services.agent.core_memory import (
    CORE_MEMORY_TOOL,
    CoreMemoryCorpus,
    CoreMemoryError,
    RecallState,
)
from app.services.agent.core_memory_tool import is_recall_call
from app.services.agent.session import _LoopGuard

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


def _tree(root: Path) -> dict[str, bytes]:
    return {str(p.relative_to(root)): p.read_bytes() for p in sorted(root.rglob("*")) if p.is_file()}


def _seeded(tmp_path: Path, **kw) -> tuple[CoreMemoryCorpus, Path]:
    """Two indexed topics — enough for a merge (read both → create merged → delete both)."""
    root = _root()
    _topic(root, "wake.md", "---\nname: Wake\ndescription: how hosts wake\n---\n\nPress the button.\n")
    _topic(root, "sleep.md", "---\nname: Sleep\ndescription: how hosts sleep\n---\n\nIt idles out.\n")
    _index(root, "- [Wake](wake.md) — how hosts wake", "- [Sleep](sleep.md) — how hosts sleep")
    return _corpus(tmp_path, **kw), root


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


def _covered(corpus: CoreMemoryCorpus, *rels: str) -> RecallState:
    """A turn that has paged through each topic in full — the coverage a model-facing `delete` is
    minted from (D64 §2.3). The `test_core_memory_tool_d57` shape, imported by copy like the rest."""
    from app.domain.enums import RunState

    state = RecallState()
    for rel in rels:
        for _ in range(64):
            covered = state.reads.get(rel)
            if covered is not None and covered.complete:
                break
            result = _tool(
                corpus,
                action="read",
                path=rel,
                offset=covered.seen + 1 if covered else 1,
                recall=state,
            )
            assert result.state is RunState.OK, result.error
        else:  # pragma: no cover - a paging walk that never finishes is a bug, not a slow test
            raise AssertionError(f"{rel} never reached full coverage")
    return state


# ── 1. config boundaries (§15b-10) ────────────────────────────────────────────────────────────────


@pytest.mark.parametrize("bad", [0, -0.5, 1.5, math.nan, math.inf, -math.inf])
def test_clear_trigger_pct_rejects_out_of_range_and_non_finite(bad) -> None:
    with pytest.raises(ValueError):
        CompactionCfg(clear_trigger_pct=bad)


def test_clear_trigger_pct_accepts_the_whole_open_range() -> None:
    assert CompactionCfg(clear_trigger_pct=0.01).clear_trigger_pct == 0.01
    assert CompactionCfg(clear_trigger_pct=1).clear_trigger_pct == 1  # 1 = clear only at the window


def test_min_reclaim_floor_takes_zero_but_not_negative() -> None:
    assert CompactionCfg(clear_min_reclaim_tokens=0).clear_min_reclaim_tokens == 0  # 0 = no floor
    with pytest.raises(ValueError):
        CompactionCfg(clear_min_reclaim_tokens=-1)


#: The integer knobs D60 adds, each with the model that owns it — one battery, evened out with
#: `clear_trigger_pct`'s: negative and non-finite are rejected at the boundary for all of them.
_INT_KNOBS = [
    (CompactionCfg, "clear_min_reclaim_tokens"),
    (CoreMemoryCfg, "recall_min_charge_chars"),
    (ToolOverride, "max_calls"),
]


@pytest.mark.parametrize("bad", [-1, math.nan, math.inf, -math.inf])
@pytest.mark.parametrize("model,field", _INT_KNOBS, ids=[f for _m, f in _INT_KNOBS])
def test_every_new_integer_knob_rejects_negative_and_non_finite(model, field, bad) -> None:
    with pytest.raises(ValueError):
        model(**{field: bad})


def test_clear_keep_steps_zero_stays_rejected_at_the_boundary(tmp_path) -> None:
    """§15b-10 keeps `clear_keep_steps ≥ 1` — D60 changed the keep window's UNIT (the current turn is
    immune whatever the step age), never its floor. Pinned as VALIDATION, not behaviour: 0 must fail
    on the same pydantic model at boot AND on a Conf PUT."""
    with pytest.raises(ValueError):
        CompactionCfg(clear_keep_steps=0)
    cfg = tmp_path / "config.yaml"
    cfg.write_text(yaml.safe_dump({"agent": {"compaction": {"clear_keep_steps": 0}}}), encoding="utf-8")
    with pytest.raises(ValueError):
        load_settings(cfg)  # boot refuses it


def test_the_conf_put_refuses_the_same_bad_values(tmp_path, monkeypatch) -> None:
    """The same model validates the live edit — a Conf write of an out-of-range knob 422s rather than
    landing (`ge=1` on the keep window, the open range on the trigger pct, `ge=1` on the min charge)."""
    client, _root_ = _consolidation_thread(tmp_path, monkeypatch)
    with client as c:
        assert (
            c.put("/api/settings", json={"agent": {"compaction": {"clear_keep_steps": 0}}}).status_code == 422
        )
        assert (
            c.put("/api/settings", json={"agent": {"compaction": {"clear_trigger_pct": 0}}}).status_code
            == 422
        )
        assert (
            c.put("/api/settings", json={"agent": {"compaction": {"clear_trigger_pct": 1.5}}}).status_code
            == 422
        )
        assert (
            c.put(
                "/api/settings",
                json={"memory": {"longterm": {"core": {"recall_min_charge_chars": 0}}}},
            ).status_code
            == 422
        )
        assert (
            c.put("/api/settings", json={"tool_overrides": {"ping_host": {"max_calls": 0}}}).status_code
            == 422
        )
        # …and a legal edit of the same fields still lands (the control that keeps the 422s honest).
        ok = c.put(
            "/api/settings",
            json={"agent": {"compaction": {"clear_trigger_pct": 0.6, "clear_min_reclaim_tokens": 0}}},
        )
        assert ok.status_code == 200, ok.text


def test_exclude_tools_is_deduped_and_nonblank() -> None:
    cfg = CompactionCfg(clear_exclude_tools=[" memory ", "memory", "", "   ", "task_plan", "nope"])
    # order-preserving, stripped, deduped — and an unknown name is allowed (a tool may arrive later)
    assert cfg.clear_exclude_tools == ["memory", "task_plan", "nope"]


def test_recall_min_charge_chars_must_be_at_least_one() -> None:
    """The confirm-round close on §15b-3/10: 0 or negative would disable the read-loop bound, which is
    the exact failure the field exists to prevent."""
    assert CoreMemoryCfg(recall_min_charge_chars=1).recall_min_charge_chars == 1
    for bad in (0, -1):
        with pytest.raises(ValueError):
            CoreMemoryCfg(recall_min_charge_chars=bad)


def test_tool_override_max_calls_must_be_at_least_one() -> None:
    assert ToolOverride(max_calls=1).max_calls == 1
    assert ToolOverride().max_calls is None  # absent = the blanket cap (REPLACE semantics, §15b-9)
    with pytest.raises(ValueError):
        ToolOverride(max_calls=0)


def test_a_pre_d60_config_still_loads_with_the_new_defaults(tmp_path) -> None:
    """Back-compat: a config.yaml written before this slice names none of the new keys, so every one
    of them has to arrive as its default rather than as a validation failure."""
    cfg = tmp_path / "config.yaml"
    cfg.write_text(
        yaml.safe_dump(
            {
                "agent": {"compaction": {"clear_keep_steps": 3, "clear_output_min_tokens": 400}},
                "memory": {"longterm": {"backend": "core", "core": {"recall_char_limit": 9999}}},
                "tool_overrides": {"ping_host": {"description": "d"}},
            }
        ),
        encoding="utf-8",
    )
    s = load_settings(cfg)
    comp = s.agent.compaction
    assert (comp.clear_keep_steps, comp.clear_output_min_tokens) == (3, 400)  # what it did say
    assert comp.clear_trigger_pct == 0.5 and comp.clear_min_reclaim_tokens == 1024
    assert comp.clear_exclude_tools == ["task_plan", "memory", "core_memory"]
    assert s.memory.longterm.core.recall_min_charge_chars == 256
    assert s.tool_overrides["ping_host"].max_calls is None


# ── 2. the failover-chain window (§15b-1) ─────────────────────────────────────────────────────────


def _client(*targets) -> InferenceClient:
    return InferenceClient(registry(list(targets)))


def test_min_chain_window_is_the_smallest_across_the_whole_chain() -> None:
    """A turn is planned ONCE, so a straddling failover must already have been gated for the endpoint
    it lands on — the smallest window in the chain, whichever hop serves."""
    big = target("cloud", "http://cloud/v1", "m", context_window=200_000)
    small = target("local", "http://local/v1", "m", context_window=16_384)
    assert run_async(_client(big, small).min_chain_window()) == 16_384
    assert run_async(_client(small, big).min_chain_window()) == 16_384  # order-independent


def test_min_chain_window_is_none_when_any_entry_has_no_window() -> None:
    """An unknown window can be smaller than everything else, so the gate degrades to always-on
    clearing rather than guessing — and an empty chain resolves to nothing at all."""
    known = target("cloud", "http://cloud/v1", "m", context_window=200_000)
    unknown = target("other", "http://other/v1", "m")  # openai api_mode ⇒ not probe-eligible
    assert run_async(_client(known, unknown).min_chain_window()) is None
    assert run_async(_client().min_chain_window()) is None


# ── 3. the call-budget split (② / §15b-3/9) ───────────────────────────────────────────────────────


def test_only_core_memory_read_class_calls_are_uncapped() -> None:
    assert is_recall_call(CORE_MEMORY_TOOL, {"action": "read"}) is True
    assert is_recall_call(CORE_MEMORY_TOOL, {"action": "search"}) is True
    for action in ("create", "update", "remove", "delete", "", "bogus"):
        assert is_recall_call(CORE_MEMORY_TOOL, {"action": action}) is False
    assert is_recall_call(CORE_MEMORY_TOOL, {}) is False  # a missing action stays capped
    assert is_recall_call("ping_host", {"action": "read"}) is False  # another tool's `action` arg


def test_cap_for_uses_the_per_tool_override_then_the_blanket_cap() -> None:
    guard = _LoopGuard(max_repeat=2, max_per_tool=6, per_tool_max={"search_web": 20})
    assert guard.cap_for("search_web") == 20  # REPLACE, not add
    assert guard.cap_for("ping_host") == 6


def test_the_session_reads_max_calls_off_the_live_tool_overrides(tmp_path) -> None:
    """The override is consulted per turn from live settings (the `ApprovalRule` shape), never baked
    onto the registry spec — it is a loop limit, not a schema field."""
    from app.services.agent.session import AgentSession

    s = Settings.model_validate(
        {"tool_overrides": {"core_memory": {"max_calls": 12}, "ping_host": {"description": "d"}}}
    )
    session = AgentSession.__new__(AgentSession)
    session._settings = s
    assert session._per_tool_caps() == {"core_memory": 12}


def test_every_read_class_call_charges_the_floor(tmp_path) -> None:
    """§15b-3: a zero-char result (an empty `search`, a refused `read`) still costs the floor, so a
    read loop terminates now that reads are outside `max_calls_per_tool`."""
    from app.domain.enums import RunState

    corpus, _root_ = _seeded(tmp_path, recall_min_charge_chars=256)
    budget = RecallState()

    miss = _tool(corpus, action="search", query="nothing-matches-this", recall=budget)
    assert miss.state is RunState.OK and budget.used == 256

    bad = _tool(corpus, action="read", path="does-not-exist.md", recall=budget)
    assert bad.state is RunState.ERROR and budget.used == 512  # a refusal costs the floor too


def test_a_real_read_costs_exactly_its_framed_length(tmp_path) -> None:
    """The floor is a MINIMUM, not a surcharge: a result longer than it charges its own length once."""
    corpus, _root_ = _seeded(tmp_path, recall_min_charge_chars=64)
    budget = RecallState()
    result = _tool(corpus, action="read", path="wake.md", recall=budget)
    assert result.output is not None and len(result.output) > 64
    assert budget.used == len(result.output)


def test_the_read_loop_terminates_at_the_cap(tmp_path) -> None:
    """The structural bound the exemption trades for: `recall_char_limit / recall_min_charge_chars`
    zero-char calls, then every further read-class call is refused for the rest of the turn."""
    from app.domain.enums import RunState

    corpus, _root_ = _seeded(tmp_path, recall_char_limit=1024, recall_min_charge_chars=256)
    budget = RecallState()
    states = [
        _tool(corpus, action="search", query="nothing-matches-this", recall=budget).state for _ in range(6)
    ]
    assert states[:4] == [RunState.OK] * 4  # 4 × 256 == the 1,024 cap
    assert states[4:] == [RunState.ERROR] * 2
    assert budget.used == 1024


def test_the_floor_survives_a_suspend_resume_reseed(tmp_path) -> None:
    """§15b-3's other half: the floor is cumulative ACROSS a resume. A read-class call that produced
    no output (a refused read, an empty search) paid the floor live — the `_seed_recall` walk must
    re-charge it, or every confirm round-trip refunds the turn's failed reads. A no-output
    WRITE-class result stays free, exactly as it was live."""
    from app.db import Database
    from app.domain.conversation import Message, Thread, ToolCallPart, ToolResultPart
    from app.domain.enums import RunState
    from app.domain.result import ToolResult
    from app.services.agent.session import AgentSession
    from app.services.conversation import MessageRepo, ThreadRepo

    corpus, _root_ = _seeded(tmp_path, recall_min_charge_chars=256)

    async def go():
        db = Database(tmp_path / "t.db")
        await db.connect()
        messages, threads = MessageRepo(db), ThreadRepo(db)
        thread = await threads.create(Thread())
        await messages.add(Message(thread_id=thread.id, role="user"))
        await messages.add(
            Message(
                thread_id=thread.id,
                role="assistant",
                parts=[
                    ToolCallPart(
                        call_id="hit", tool=CORE_MEMORY_TOOL, args={"action": "read", "path": "wake.md"}
                    ),
                    ToolCallPart(
                        call_id="miss", tool=CORE_MEMORY_TOOL, args={"action": "read", "path": "no.md"}
                    ),
                    ToolCallPart(
                        call_id="write", tool=CORE_MEMORY_TOOL, args={"action": "delete", "path": "x.md"}
                    ),
                ],
            )
        )
        await messages.add(
            Message(
                thread_id=thread.id,
                role="tool",
                parts=[
                    ToolResultPart(
                        call_id="hit", result=ToolResult(state=RunState.OK, summary="r", output="Y" * 300)
                    ),
                    ToolResultPart(call_id="miss", result=ToolResult(state=RunState.ERROR, summary="r")),
                    ToolResultPart(call_id="write", result=ToolResult(state=RunState.ERROR, summary="w")),
                ],
            )
        )
        resumed = AgentSession(threads, messages, None, corpus.settings, None, core_memory=corpus)
        await resumed._seed_recall(thread)
        assert resumed._recall.used == 300 + 256  # the hit's length + the miss's floor; the write free

    run_async(go())


# ── 4. the delete guard (③ / §15b-4/5/8/12/13) ────────────────────────────────────────────────────


def _digest(corpus: CoreMemoryCorpus, rel: str) -> str:
    return corpus.read_topic(rel).content_hash


@pytest.mark.parametrize(
    "kw",
    [
        {},  # neither
        {"reason": "   "},  # whitespace-only reason == no intent
        {"superseded_by": "  "},  # …and the same on the supersedes side
        {"superseded_by": "  ", "reason": "\t\n "},  # both blank
        {"superseded_by": "sleep.md", "reason": "obsolete"},  # both given
        {"superseded_by": "sleep.md", "reason": "   "},  # one real, one blank → still exactly one
        {"superseded_by": " ", "reason": "obsolete"},
    ],
    ids=[
        "neither",
        "blank-reason",
        "blank-supersedes",
        "both-blank",
        "both",
        "supersedes+blank",
        "blank+reason",
    ],
)
def test_the_delete_intent_matrix_at_the_public_boundary(tmp_path, kw) -> None:
    """The XOR is enforced where every caller meets it — `CoreMemoryCorpus.delete` — with blanks
    treated as absent, so a whitespace `reason` can never pass as an intent. The two rows that DO
    carry exactly one intent are the control: they must NOT be refused for this reason."""
    corpus, root = _seeded(tmp_path)
    before = _tree(root)
    exactly_one = bool(kw.get("superseded_by", "").strip()) != bool(kw.get("reason", "").strip())
    if exactly_one:
        run_async(corpus.delete("wake.md", _digest(corpus, "wake.md"), **kw))
        assert not (root / "wake.md").exists()
        return
    with pytest.raises(CoreMemoryError) as exc:
        run_async(corpus.delete("wake.md", _digest(corpus, "wake.md"), **kw))
    assert "exactly one" in str(exc.value)
    assert _tree(root) == before  # a refused delete writes nothing


def test_the_intent_gate_reaches_the_model_through_the_tool(tmp_path) -> None:
    """…and the same refusal arrives as a steering ERROR (never an exception) on the tool boundary the
    model actually calls."""
    from app.domain.enums import RunState

    corpus, root = _seeded(tmp_path)
    before = _tree(root)
    result = _tool(corpus, action="delete", path="wake.md", recall=_covered(corpus, "wake.md"))
    assert result.state is RunState.ERROR and "exactly one of the two" in (result.error or "")
    assert _tree(root) == before


def test_supersedes_must_already_exist_run_twos_exact_failure(tmp_path) -> None:
    """§15 acceptance ②: run 2 deleted a live topic whose merged replacement had been cap-denied one
    turn earlier. The named replacement is resolved ON DISK, so that call is now refused."""
    corpus, root = _seeded(tmp_path)
    before = _tree(root)
    with pytest.raises(CoreMemoryError) as exc:
        run_async(corpus.delete("wake.md", _digest(corpus, "wake.md"), superseded_by="merged.md"))
    assert "create merged.md first" in str(exc.value)
    assert _tree(root) == before

    # …and once the replacement exists, the same delete goes through.
    run_async(corpus.create("Merged", "wake + sleep", None, "Both."))
    run_async(corpus.delete("wake.md", _digest(corpus, "wake.md"), superseded_by="merged.md"))
    assert not (root / "wake.md").exists()


def test_a_topic_cannot_supersede_itself(tmp_path) -> None:
    """Hermes #29912's guard after the identical incident: a self-reference is a delete with no
    replacement wearing an intent."""
    corpus, root = _seeded(tmp_path)
    before = _tree(root)
    with pytest.raises(CoreMemoryError) as exc:
        run_async(corpus.delete("wake.md", _digest(corpus, "wake.md"), superseded_by="wake.md"))
    assert "cannot supersede itself" in str(exc.value)
    assert _tree(root) == before


def test_an_archived_topic_can_never_be_the_replacement(tmp_path) -> None:
    """§15b-8: the replacement must be a LIVE regular file — `.archive/` is excluded by the same
    dotted-component rule that hides it from the scan, so it cannot be named at all."""
    corpus, root = _seeded(tmp_path)
    run_async(corpus.delete("sleep.md", _digest(corpus, "sleep.md"), reason="obsolete"))
    assert (root / ".archive" / "sleep.md").is_file()
    with pytest.raises(CoreMemoryError):
        run_async(corpus.delete("wake.md", _digest(corpus, "wake.md"), superseded_by=".archive/sleep.md"))


class _RecordingBackup:
    """A `MemoryBackup` stand-in that keeps the real lock and RECORDS the D26 subjects — the receipt
    the sanitation tests below read, so they assert what git would actually be handed rather than a
    private helper's return value."""

    def __init__(self) -> None:
        self.lock = asyncio.Lock()
        self.commits: list[str] = []

    def guard(self):
        @contextlib.asynccontextmanager
        async def _cm():
            async with self.lock:
                yield

        return _cm()

    async def commit(self, _paths, message):
        self.commits.append(message)


def _subject_of(corpus: CoreMemoryCorpus, **kw) -> str:
    """Drive one public `delete` through a recording backup and return its commit subject."""
    backup = _RecordingBackup()
    corpus._backup = backup  # type: ignore[assignment]
    run_async(corpus.delete("wake.md", _digest(corpus, "wake.md"), **kw))
    return backup.commits[-1]


def _assert_subject_contract(subject: str, *, names: str) -> None:
    """The D26 subject CONTRACT (not its exact wording): one line, no control characters, bounded,
    content-free (never the topic's text), and it names the delete's stated intent."""
    assert "\n" not in subject and "\r" not in subject
    assert not re.search(r"[\x00-\x1f\x7f]", subject)
    assert len(subject) <= 200
    assert "core memory: delete wake.md" in subject
    assert names in subject
    assert "Press the button." not in subject  # the topic's body never rides the subject


def test_the_reason_is_sanitised_into_the_commit_subject(tmp_path) -> None:
    """§15b-13, through the public path: a multi-line, whitespace-ragged reason arrives as one
    sanitized line in the subject git is handed."""
    corpus, root = _seeded(tmp_path)
    subject = _subject_of(corpus, reason="  the host   was\n decommissioned ")
    _assert_subject_contract(subject, names="the host was decommissioned")
    assert "Press the button." in (root / ".archive" / "wake.md").read_text(encoding="utf-8")


def test_an_overlong_reason_is_capped_in_the_subject(tmp_path) -> None:
    corpus, _root_ = _seeded(tmp_path)
    subject = _subject_of(corpus, reason="x" * 500)
    _assert_subject_contract(subject, names="xxx")
    assert len(subject) < 500


@pytest.mark.parametrize("bad", ["bad\x07reason", "bell\x00null", "\x1b[31mred"])
def test_a_control_char_reason_is_refused(tmp_path, bad) -> None:
    corpus, root = _seeded(tmp_path)
    before = _tree(root)
    with pytest.raises(CoreMemoryError) as exc:
        run_async(corpus.delete("wake.md", _digest(corpus, "wake.md"), reason=bad))
    assert "control characters" in str(exc.value)
    assert _tree(root) == before


def test_the_supersedes_intent_is_sanitised_too(tmp_path) -> None:
    """Codex MED: the supersedes form used to reach the subject as the RAW argument. It is now
    canonicalized through the shared resolver and put through the same one-line/cap treatment."""
    corpus, root = _seeded(tmp_path)
    subject = _subject_of(corpus, superseded_by="  sleep.md  ")  # ragged input, canonical output
    _assert_subject_contract(subject, names="superseded by sleep.md")


@pytest.mark.parametrize(
    "hostile",
    ["merged\n.md", "merged\x07.md", "mer\tged.md", "sub\r\ndir/merged.md"],
    ids=["newline", "bell", "tab", "crlf"],
)
def test_a_hostile_supersedes_path_never_reaches_the_commit_subject(tmp_path, hostile) -> None:
    """A control character in the named replacement is refused outright by the canonical resolver —
    it can never be laundered into a malformed (multi-line) commit subject."""
    corpus, root = _seeded(tmp_path)
    before = _tree(root)
    with pytest.raises(CoreMemoryError) as exc:
        run_async(corpus.delete("wake.md", _digest(corpus, "wake.md"), superseded_by=hostile))
    assert "not a topic path" in str(exc.value)
    assert _tree(root) == before


def test_an_overlong_supersedes_path_is_capped_in_the_subject(tmp_path) -> None:
    """…and a legal-but-absurd path (200 chars, the filesystem's own limit) is length-capped like a
    reason, so the subject stays a subject."""
    corpus, root = _seeded(tmp_path)
    long_rel = ("m" * 200) + ".md"
    _topic(root, long_rel, "---\nname: Long\ndescription: long\n---\n\nbody\n")
    subject = _subject_of(corpus, superseded_by=long_rel)
    _assert_subject_contract(subject, names="superseded by mmm")
    assert len(subject) < len(long_rel)


def test_a_delete_archives_instead_of_destroying(tmp_path) -> None:
    """§15 acceptance ③ (first half): the bytes survive at a predictable path, the scan ignores them,
    and the index line is gone."""
    corpus, root = _seeded(tmp_path)
    body = (root / "wake.md").read_bytes()
    summary = run_async(corpus.delete("wake.md", _digest(corpus, "wake.md"), reason="obsolete"))

    assert "archived wake.md" in summary
    assert (root / ".archive" / "wake.md").read_bytes() == body
    assert not (root / "wake.md").exists()
    scan = corpus.scan()
    assert [t.path for t in scan.topics] == ["sleep.md"]  # the archive is invisible to the reader
    assert "wake.md" not in (root / "MEMORY.md").read_text(encoding="utf-8")


def test_a_nested_topic_keeps_its_path_under_the_archive(tmp_path) -> None:
    """The relative path is mirrored, not flattened, so two same-named topics can't collide and a
    restore is a move back to where the path already says."""
    root = _root()
    _topic(root, "hosts/nuc.md", "---\nname: NUC\ndescription: the nuc\n---\n\nbody\n")
    _index(root, "- [NUC](hosts/nuc.md) — the nuc")
    corpus = _corpus(tmp_path)
    run_async(corpus.delete("hosts/nuc.md", _digest(corpus, "hosts/nuc.md"), reason="gone"))
    assert (root / ".archive" / "hosts" / "nuc.md").is_file()


def test_the_archive_destination_is_no_clobber(tmp_path) -> None:
    """§15b-5: an earlier archived copy is the owner's to keep — one refusal the model can act on,
    never a silent second copy and never versioned naming."""
    corpus, root = _seeded(tmp_path)
    run_async(corpus.delete("wake.md", _digest(corpus, "wake.md"), reason="first"))
    archived = (root / ".archive" / "wake.md").read_bytes()

    _topic(root, "wake.md", "---\nname: Wake\ndescription: again\n---\n\nRecreated.\n")
    before = _tree(root)
    with pytest.raises(CoreMemoryError) as exc:
        run_async(corpus.delete("wake.md", _digest(corpus, "wake.md"), reason="second"))
    assert "already holds an earlier archived copy" in str(exc.value)
    assert _tree(root) == before and (root / ".archive" / "wake.md").read_bytes() == archived


def test_restore_is_a_file_move_plus_the_index_line(tmp_path) -> None:
    """§15 acceptance ③ (second half) / §15b-12: recovery is the documented two-step — move the file
    back, re-add its index line — after which the topic is discoverable again. And the live
    destination is NO-CLOBBER: while a recreated topic sits at the path, the corpus refuses to let a
    second copy of it be archived over the first (the guard that keeps a restore from ever silently
    overwriting live work)."""
    corpus, root = _seeded(tmp_path)
    run_async(corpus.delete("wake.md", _digest(corpus, "wake.md"), reason="obsolete"))
    assert "wake.md" not in [t.path for t in corpus.scan().topics]

    # A live topic now occupies the destination: restoring over it is exactly what must not happen.
    _topic(root, "wake.md", "---\nname: Wake\ndescription: newer\n---\n\nNewer work.\n")
    with pytest.raises(CoreMemoryError):
        run_async(corpus.delete("wake.md", _digest(corpus, "wake.md"), reason="make room"))
    (root / "wake.md").unlink()  # the owner resolves the collision by hand, as §5 documents

    (root / ".archive" / "wake.md").rename(root / "wake.md")
    _index(root, "- [Sleep](sleep.md) — how hosts sleep", "- [Wake](wake.md) — how hosts wake")
    scan = corpus.scan()
    assert "wake.md" in [t.path for t in scan.topics]
    assert "wake.md" in [target for _title, target, _hook in scan.entries]  # indexed = discoverable


# ── 5. §15 acceptance ① / ④ / ⑤ ───────────────────────────────────────────────────────────────────


class _Fake:
    """The scripted `stream_chat` the session tests share, plus the D42/D60 window hooks."""

    def __init__(self, scripts):
        self.scripts = scripts
        self.calls = 0
        self.seen: list = []

    def stream_chat(self, messages, **_kw):
        idx = self.calls
        self.calls += 1
        self.seen.append(messages)
        script = self.scripts[idx] if idx < len(self.scripts) else self.scripts[-1]

        async def gen():
            for d in script:
                yield d

        return gen()

    async def effective_window(self, _ep):
        return 200_000

    async def min_chain_window(self, _mode=None, _model=None):
        return 200_000  # a roomy chain: the pressure gate never opens on a small thread

    def target_for(self, _mode=None, _model=None):
        from app.domain.provider import ResolvedTarget

        return ResolvedTarget(provider="fake", base_url="http://fake/v1", model="m")


async def _aw(value):
    """`await`-able constant — the one-liner the fake's coroutine hooks are patched with."""
    return value


def _call(name: str, args: dict, cid: str):
    from app.adapters.inference import ChatDelta, ToolCallRequest

    return ChatDelta(tool_calls=[ToolCallRequest(id=cid, name=name, arguments=json.dumps(args))])


def _text(s: str):
    from app.adapters.inference import ChatDelta

    return ChatDelta(text=s)


def _consolidation_thread(
    tmp_path, monkeypatch, *, auto_write: bool = True, extra: int = 0, overrides: dict | None = None
):
    """The real wiring (app lifespan → ActionService → the corpus singleton) with only the model
    scripted, over a two-topic corpus (+ `extra` filler topics) — the shape a consolidation run
    drives. `overrides` writes a real `tool_overrides` block, so a per-tool cap is exercised the way
    the owner sets it."""
    from fastapi.testclient import TestClient

    from app.main import create_app

    cfg = tmp_path / "config.yaml"
    cfg.write_text(
        yaml.safe_dump(
            {
                "server": {"port": 5433},
                "memory": {"auto_write": auto_write, "longterm": {"backend": "core"}},
                **({"tool_overrides": overrides} if overrides else {}),
            }
        ),
        encoding="utf-8",
    )
    monkeypatch.setenv("CTRLB_CONFIG", str(cfg))
    monkeypatch.setenv("CTRLB_DB", str(tmp_path / "t.db"))
    root = _root()
    _topic(root, "wake.md", "---\nname: Wake\ndescription: how hosts wake\n---\n\nPress the button.\n")
    _topic(root, "sleep.md", "---\nname: Sleep\ndescription: how hosts sleep\n---\n\nIt idles out.\n")
    lines = ["- [Wake](wake.md) — how hosts wake", "- [Sleep](sleep.md) — how hosts sleep"]
    for i in range(extra):
        _topic(root, f"t{i}.md", f"---\nname: T{i}\ndescription: filler {i}\n---\n\nBody {i}.\n")
        lines.append(f"- [T{i}](t{i}.md) — filler {i}")
    _index(root, *lines)
    return TestClient(create_app()), root


def _drive(client, fake):
    from app.domain.conversation import Thread
    from app.services.agent.session import AgentSession

    state = client.app.state
    agent = state.settings.resolve_agent(None).model_copy(update={"max_parallel_tools": 1})
    thread = run_async(state.threads.create(Thread()))
    session = AgentSession(
        state.threads,
        state.messages,
        state.inference,
        state.settings,
        state.actions,
        agent,
        core_memory=state.core_memory,
    )
    session._inference = fake

    async def _turn():
        return [ev async for ev in session.run_turn(thread, "consolidate the wake/sleep pair")]

    events = run_async(_turn())
    rows = run_async(state.messages.list(thread.id))
    return events, rows


def test_one_turn_reads_past_the_cap_then_creates_and_deletes(tmp_path, monkeypatch) -> None:
    """§15 acceptance ①: a consolidation-shaped turn reads MORE times than the blanket
    `max_calls_per_tool` (6) allows, then creates the merged topic and deletes a source — all in ONE
    turn, with zero clearing (the recalls are still verbatim in the payload that writes) and zero cap
    denials. Both halves of the pass §14d proved impossible: the reads survive, and the turn that
    read can still write."""
    from app.services.agent.compaction import OUTPUT_CLEARED_PLACEHOLDER

    client, root = _consolidation_thread(tmp_path, monkeypatch, extra=6)
    reads = [
        [_call(CORE_MEMORY_TOOL, {"action": "read", "path": p}, f"r{i}")]
        for i, p in enumerate(["wake.md", "sleep.md", *(f"t{n}.md" for n in range(6))])
    ]
    fake = _Fake(
        [
            *reads,  # 8 reads — past the 6-call blanket cap, which no longer applies to them
            [
                _call(
                    CORE_MEMORY_TOOL,
                    {
                        "action": "create",
                        "name": "Host power",
                        "description": "how hosts wake and sleep",
                        "content": "Press the button. It idles out.",
                    },
                    "c1",
                )
            ],
            [_text("placeholder — replaced below")],
        ]
    )
    with client:
        state = client.app.state
        # The delete needs the hash the read returned, so it is scripted from the live corpus.
        digest = state.core_memory.read_topic("wake.md").content_hash
        fake.scripts[-1] = [
            _call(
                CORE_MEMORY_TOOL,
                {
                    "action": "delete",
                    "path": "wake.md",
                    "content_hash": digest,
                    "superseded_by": "host-power.md",
                },
                "c2",
            )
        ]
        fake.scripts.append([_text("merged wake + sleep into host-power.md")])
        _events, rows = _drive(client, fake)

    results = [rp.result for m in rows for rp in m.tool_results()]
    assert [r.state.value for r in results] == ["ok"] * 10, [r.summary for r in results]
    assert not any("call limit" in r.summary for r in results)  # reads never spent the per-tool cap
    # The recalls are STILL verbatim in the payload of the call that wrote (no Tier-1 clearing).
    writing_payload = "\n".join(str(m.get("content") or "") for m in fake.seen[8])
    assert OUTPUT_CLEARED_PLACEHOLDER not in writing_payload
    assert "Press the button." in writing_payload and "It idles out." in writing_payload
    assert (root / "host-power.md").is_file()
    assert (root / ".archive" / "wake.md").is_file() and not (root / "wake.md").exists()


def test_write_class_calls_still_hit_the_per_tool_cap(tmp_path, monkeypatch) -> None:
    """The other half of ②: only READS left the cap. A run of `create`s is still refused at the
    blanket `max_calls_per_tool`, so a spiralling writer is bounded exactly as before."""
    client, root = _consolidation_thread(tmp_path, monkeypatch)
    fake = _Fake(
        [
            [
                _call(
                    CORE_MEMORY_TOOL,
                    {"action": "create", "name": f"Topic {i}", "description": "d", "content": "c"},
                    f"w{i}",
                )
            ]
            for i in range(8)
        ]
        + [[_text("done")]]
    )
    with client:
        _events, rows = _drive(client, fake)

    summaries = [rp.result.summary for m in rows for rp in m.tool_results()]
    assert sum("call limit" in s for s in summaries) == 2  # calls 7 and 8 of 8, cap 6
    assert len(list(root.glob("topic-*.md"))) == 6


def test_a_resumed_turn_still_protects_its_pre_suspension_outputs(tmp_path, monkeypatch) -> None:
    """§15b-6 for real: SUSPEND on a confirm-gated call, rebuild the session (a resume always does),
    and drive `resume(execute)`. The rebuilt session must still treat the turn's PRE-SUSPENSION tool
    output as current-turn — it is verbatim in the payload of the model call that follows — while a
    PRIOR turn's output in the same thread is cleared. A loop-iteration-offset identity would fail
    this: the resumed `_drive` starts counting from zero and mints a fresh `TurnHandle.turn_id`."""
    from _async import drain_run_calls

    from app.domain.conversation import Message, TextPart, Thread, ToolCallPart, ToolResultPart
    from app.domain.enums import Actor, RunState
    from app.domain.result import ToolResult
    from app.services.agent.compaction import OUTPUT_CLEARED_PLACEHOLDER
    from app.services.agent.session import AgentSession

    client, _root_ = _consolidation_thread(tmp_path, monkeypatch)
    old_out, live_out = "OLD-" + "x" * 6000, "LIVE-" + "y" * 6000

    def _session(state, cfg):
        agent = state.settings.resolve_agent(None).model_copy(update={"max_parallel_tools": 1})
        s = AgentSession(
            state.threads,
            state.messages,
            state.inference,
            state.settings,
            state.actions,
            agent,
            interactive=True,
            core_memory=state.core_memory,
        )
        s._compaction_cfg = cfg  # keep_steps=1 → only the TURN boundary can protect the live output
        return s

    with client:
        state = client.app.state
        cfg = CompactionCfg(clear_keep_steps=1, clear_output_min_tokens=500)
        thread = run_async(state.threads.create(Thread()))

        async def _seed() -> str:
            def user(text: str) -> Message:
                return Message(
                    thread_id=thread.id, role="user", actor=Actor.USER, parts=[TextPart(text=text)]
                )

            await state.messages.add(user("the previous turn"))
            for cid, out in (("old", old_out), ("live", live_out)):
                if cid == "live":
                    await state.messages.add(user("consolidate for me"))  # THE turn starts here
                await state.messages.add(
                    Message(
                        thread_id=thread.id,
                        role="assistant",
                        actor=Actor.AGENT,
                        parts=[ToolCallPart(call_id=cid, tool="ping_host", args={}, state=RunState.OK)],
                    )
                )
                res = ToolResult(state=RunState.OK, summary="pinged", output=out)
                res.duration_ms = 5
                await state.messages.add(
                    Message(
                        thread_id=thread.id,
                        role="tool",
                        actor=Actor.AGENT,
                        parts=[ToolResultPart(call_id=cid, result=res)],
                    )
                )
            # …and the confirm-gated call the turn suspends on.
            call_id = "confirm-me"
            await state.messages.add(
                Message(
                    thread_id=thread.id,
                    role="assistant",
                    actor=Actor.AGENT,
                    agent="default",
                    parts=[
                        ToolCallPart(
                            call_id=call_id,
                            tool="reboot_host",
                            args={"host_id": "nope"},
                            state=RunState.PENDING,
                        )
                    ],
                )
            )
            return call_id

        call_id = run_async(_seed())
        pending = run_async(state.messages.list(thread.id))[-1]

        # SUSPEND: the gated call runs with no token → AWAITING_CONFIRM, persisted.
        guard = _LoopGuard(max_repeat=5, max_per_tool=10)
        _events, suspended, _ = drain_run_calls(_session(state, cfg), thread, pending, {}, guard)
        assert suspended
        states = [
            cp.state
            for m in run_async(state.messages.list(thread.id))
            for cp in m.tool_calls()
            if cp.call_id == call_id
        ]
        assert states == [RunState.AWAITING_CONFIRM]

        # RESUME in a FRESH session (the rebuild), with a window small enough that the pressure gate
        # is wide open — so the ONLY thing that can protect the live output is the turn boundary.
        fake = _Fake([[_text("resumed and answered")]])
        fake.min_chain_window = lambda *_a, **_kw: _aw(200)  # type: ignore[assignment]
        resumed = _session(state, cfg)
        resumed._inference = fake

        async def _go():
            return [ev async for ev in resumed.resume(thread, call_id, "execute")]

        run_async(_go())

    payload = "\n".join(str(m.get("content") or "") for m in fake.seen[0])
    assert live_out in payload  # the turn's own pre-suspension output survived the rebuild
    assert old_out not in payload and OUTPUT_CLEARED_PLACEHOLDER in payload  # the prior turn cleared


def test_a_max_calls_override_moves_the_cap_through_the_real_loop(tmp_path, monkeypatch) -> None:
    """§15b-9 end to end: `tool_overrides.core_memory.max_calls: 8` REPLACES the blanket cap of 6 for
    this tool — calls 7 and 8 now run, and the 9th is refused. The blanket cap is untouched for
    everything else."""
    client, root = _consolidation_thread(
        tmp_path, monkeypatch, overrides={CORE_MEMORY_TOOL: {"max_calls": 8}}
    )
    fake = _Fake(
        [
            [
                _call(
                    CORE_MEMORY_TOOL,
                    {"action": "create", "name": f"Topic {i}", "description": "d", "content": "c"},
                    f"w{i}",
                )
            ]
            for i in range(9)
        ]
        + [[_text("done")]]
    )
    with client:
        assert client.app.state.settings.tool_overrides[CORE_MEMORY_TOOL].max_calls == 8
        _events, rows = _drive(client, fake)

    summaries = [rp.result.summary for m in rows for rp in m.tool_results()]
    assert sum("call limit" in s for s in summaries) == 1  # only the 9th
    assert len(list(root.glob("topic-*.md"))) == 8  # 7 and 8 landed — past the blanket 6


def test_the_dry_run_shape_refuses_every_write_and_changes_nothing(tmp_path, monkeypatch) -> None:
    """§15 acceptance ⑤ / §15b-2: the documented dry-run runs with `memory.auto_write` OFF, so the
    STRUCTURE refuses each write-class action — asserted by attempting one, never by trusting a
    cooperative model. Reads are unaffected and the corpus is byte-identical afterwards."""
    client, root = _consolidation_thread(tmp_path, monkeypatch, auto_write=False)
    before = _tree(root)
    fake = _Fake(
        [
            [_call(CORE_MEMORY_TOOL, {"action": "read", "path": "wake.md"}, "c1")],
            [
                _call(
                    CORE_MEMORY_TOOL,
                    {"action": "create", "name": "Merged", "description": "d", "content": "c"},
                    "c2",
                )
            ],
            [_text("here is the plan I would have run")],
        ]
    )
    with client:
        _events, rows = _drive(client, fake)

    read_res, write_res = [rp.result for m in rows for rp in m.tool_results()]
    assert read_res.state.value == "ok"  # reads still work under a dry run
    assert write_res.state.value == "error" and "memory.auto_write" in (write_res.error or "")
    assert _tree(root) == before  # zero corpus writes

    # …and the registry ships the text that tells the model what to produce instead (§15 ④).
    from app.services.agent.prompts import REGISTRY

    plan = REGISTRY["consolidation_dryrun"].default
    assert "DRY RUN" in plan and "Do NOT call `create`" in plan


@pytest.mark.parametrize("action", ["create", "update", "remove", "delete"])
def test_the_dry_run_refuses_every_write_class_action(tmp_path, action) -> None:
    """…and it is ALL FOUR, not just `create`: each with arguments that would otherwise SUCCEED (a
    real CAS substring, a fresh hash, a stated intent, a free filename), so the autonomy gate is the
    only thing that can be the denier — and the corpus is byte-identical after each attempt."""
    from app.domain.enums import RunState

    corpus, root = _seeded(tmp_path, memory={"auto_write": False})
    before = _tree(root)
    args = {
        "create": {"action": "create", "name": "Merged", "description": "d", "content": "c"},
        "update": {
            "action": "update",
            "path": "wake.md",
            "old_text": "Press the button.",
            "new_text": "Press it.",
        },
        "remove": {"action": "remove", "path": "wake.md", "old_text": "Press the button."},
        "delete": {
            "action": "delete",
            "path": "wake.md",
            "content_hash": _digest(corpus, "wake.md"),
            "superseded_by": "sleep.md",
        },
    }[action]

    result = _tool(corpus, **args)
    assert result.state is RunState.ERROR
    assert "memory.auto_write" in (result.error or "")
    assert _tree(root) == before  # zero corpus writes — including no `.archive/` entry


def test_the_dry_run_leaves_reads_and_the_archive_alone(tmp_path) -> None:
    """The control for the matrix above: under the same switch a read still works, so a dry run can
    actually survey the corpus it is planning over."""
    from app.domain.enums import RunState

    corpus, root = _seeded(tmp_path, memory={"auto_write": False})
    assert _tool(corpus, action="read", path="wake.md", recall=RecallState()).state is RunState.OK
    assert not (root / ".archive").exists()


def _clearable_history():
    """A prior turn with two big tool outputs + the current turn's opening user row."""
    from app.domain.conversation import Message, TextPart, ToolCallPart, ToolResultPart
    from app.domain.enums import Actor, RunState
    from app.domain.result import ToolResult

    def user(t: str) -> Message:
        return Message(thread_id="t", role="user", actor=Actor.USER, parts=[TextPart(text=t)])

    out: list[Message] = [user("start")]
    for i in range(3):
        cid = f"c{i}"
        res = ToolResult(state=RunState.OK, summary="did a thing", output="x" * 8000)
        res.duration_ms = 5
        out += [
            Message(
                thread_id="t",
                role="assistant",
                actor=Actor.AGENT,
                parts=[ToolCallPart(call_id=cid, tool="ping_host", args={}, state=RunState.OK)],
            ),
            Message(
                thread_id="t",
                role="tool",
                actor=Actor.AGENT,
                parts=[ToolResultPart(call_id=cid, result=res)],
            ),
        ]
    return [*out, user("now")]


def test_a_small_model_still_clears_above_its_gate() -> None:
    """§15 acceptance ④: chat behaviour at small-model pressure is preserved — a gemma-class 16k
    model gates at ~8k, so a loaded thread still gets its Tier-1 trim; it simply no longer pays for
    one on a context that has room."""
    from app.services.agent.compaction import plan_clearing

    history = _clearable_history()
    cfg = CompactionCfg()  # every D60 default: pct 0.5, floor 1024, the three excluded tools
    assert plan_clearing(history, cfg, window=16_384, estimated_tokens=4_000).empty
    trimmed = plan_clearing(history, cfg, window=16_384, estimated_tokens=12_000)
    assert trimmed.cleared_call_ids == frozenset({"c0"})  # c1/c2 are the protected recent steps
    assert trimmed.gain >= cfg.clear_min_reclaim_tokens
