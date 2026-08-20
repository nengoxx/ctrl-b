"""D62 — per-message serve attribution: the `source` routing record + the extended `usage`.

Four things this file locks in:

  1. The RULES (`SourceInfo.of` / `CallUsage.of`): what is recorded, what collapses to `None`, and the
     JSON keys that reach SQLite + the wire (`from` is a reserved word; absent facts are absent keys).
  2. The `meta` COLUMN: `source` rides beside `usage`/`prompt_stamps` as one more key — present, absent,
     and a legacy row written before D62 existed all round-trip through `MessageRepo`.
  3. The ATTACH SEAM: one real turn through `AgentSession` persists what the `StreamReport` carried —
     on the happy path and on a degraded failover (served/from/failed hops/window).
  4. The WIRE: `message.end` carries the same two objects, so a live bubble and a reloaded one render
     the same thing; `message.start` still carries nothing new (served is unknown there).

Every test runs against a synthesized `$CTRLB_HOME` (never the owner's real config/db).
"""

from __future__ import annotations

import contextlib
import json
import os
import tempfile
from pathlib import Path

from _async import run_async

from app.domain.conversation import CallUsage, Message, SourceInfo

_CONFIG = """
server:
  host: 127.0.0.1
  port: 5433
computers:
  Corsair:
    ip: 10.0.0.5
    os_type: windows
"""


@contextlib.contextmanager
def _workspace(config_text: str = _CONFIG):
    tmp = Path(tempfile.mkdtemp())
    cfg = tmp / "config.yaml"
    cfg.write_text(config_text, encoding="utf-8")
    os.environ["CTRLB_HOME"] = str(tmp)
    os.environ["CTRLB_CONFIG"] = str(cfg)
    os.environ["CTRLB_DB"] = str(tmp / "t.db")
    try:
        yield tmp
    finally:
        for k in ("CTRLB_HOME", "CTRLB_CONFIG", "CTRLB_DB"):
            os.environ.pop(k, None)


def _client():
    from fastapi.testclient import TestClient

    from app.main import create_app

    return TestClient(create_app())


# ── 1. the construction rules ───────────────────────────────────────────────────────────────────


def test_a_happy_serve_records_who_answered_and_nothing_it_did_not_lose() -> None:
    src = SourceInfo.of("corsair", False, "corsair", failed_hops=0, context_window=262144)
    assert src is not None
    assert src.model_dump(mode="json") == {
        "served": "corsair",
        "degraded": False,
        "context_window": 262144,
    }


def test_a_degraded_serve_records_the_primary_it_fell_back_from() -> None:
    src = SourceInfo.of("openrouter", True, "corsair", failed_hops=2)
    assert src is not None
    # `from` is the reserved-word key: the JSON contract, not the Python attribute name.
    assert src.model_dump(mode="json") == {
        "served": "openrouter",
        "degraded": True,
        "from": "corsair",
        "failed_hops": 2,
    }
    assert SourceInfo.model_validate({"served": "x", "degraded": True, "from": "y"}).from_ == "y"


def test_nothing_served_records_nothing() -> None:
    """A chain that died before any endpoint answered leaves `served` empty — the honest gap
    (mirroring `CallUsage.of`), never a `{"served": ""}` row the UI would render as a blank chip."""
    assert SourceInfo.of("", False, "corsair") is None


def test_usage_collapses_only_when_every_field_is_none() -> None:
    """The D62 amendment to the C-9 collapse rule: `duration_ms` is MEASURED, not quoted, so a call
    whose endpoint reported nothing still persists what we timed. Callers that measure nothing (the
    summarizer) pass neither keyword and keep the pre-D62 behaviour exactly."""
    assert CallUsage.of(None, None, None) is None  # unchanged: nothing at all → no object
    timed = CallUsage.of(None, None, None, duration_ms=12300)
    assert timed is not None and timed.duration_ms == 12300 and timed.input_tokens is None
    cached = CallUsage.of("m", 800, None, cached_tokens=640)
    assert cached is not None and cached.cached_tokens == 640


# ── 2. the `meta` column ────────────────────────────────────────────────────────────────────────


def _roundtrip(c, msg: Message) -> Message:
    run_async(c.app.state.messages.add(msg))
    got = run_async(c.app.state.messages.get(msg.id))
    assert got is not None
    return got


def _thread(c):
    from app.domain.conversation import Thread

    return run_async(c.app.state.threads.create(Thread()))


def test_source_rides_the_meta_column_and_survives_the_round_trip() -> None:
    with _workspace(), _client() as c:
        t = _thread(c)
        src = SourceInfo.of("corsair", True, "openrouter", failed_hops=1, context_window=8192)
        got = _roundtrip(c, Message(thread_id=t.id, role="assistant", source=src))
        assert got.source is not None
        assert (got.source.served, got.source.from_, got.source.failed_hops) == ("corsair", "openrouter", 1)
        assert got.source.context_window == 8192
        # …as a KEY of the meta JSON object, not a column (the harness-phase query shape).
        rows = run_async(c.app.state.db.query("SELECT meta FROM messages WHERE id = ?", (got.id,)))
        assert json.loads(rows[0]["meta"])["source"]["from"] == "openrouter"


def test_a_message_with_no_source_writes_no_key_at_all() -> None:
    """The common case must stay exactly as cheap as it was: a plain user row still writes
    `meta = NULL`, and an assistant row with usage-only writes usage-only."""
    with _workspace(), _client() as c:
        t = _thread(c)
        user = _roundtrip(c, Message(thread_id=t.id, role="user"))
        assert user.source is None
        rows = run_async(c.app.state.db.query("SELECT meta FROM messages WHERE id = ?", (user.id,)))
        assert rows[0]["meta"] is None

        usage_only = Message(thread_id=t.id, role="assistant", usage=CallUsage.of("m", 10, 2))
        got = _roundtrip(c, usage_only)
        rows = run_async(c.app.state.db.query("SELECT meta FROM messages WHERE id = ?", (got.id,)))
        assert "source" not in json.loads(rows[0]["meta"])


def test_a_legacy_row_loads_with_no_attribution() -> None:
    """Every message written before this slice: `meta` carries stamps/usage and no `source` key. It
    must load as `source=None` — the plain who-line, no chip, no disclosure (the honest degradation)."""
    with _workspace(), _client() as c:
        t = _thread(c)
        legacy = Message(thread_id=t.id, role="assistant")
        run_async(c.app.state.messages.add(legacy))
        run_async(
            c.app.state.db.execute(
                "UPDATE messages SET meta = ? WHERE id = ?",
                (json.dumps({"prompt_stamps": {"p": "h"}, "usage": {"model": "old"}}), legacy.id),
            )
        )
        got = run_async(c.app.state.messages.get(legacy.id))
        assert got is not None and got.source is None
        assert got.usage is not None and got.usage.model == "old"
        assert got.usage.cached_tokens is None and got.usage.duration_ms is None  # new fields default


# ── 3. the attach seam (one real turn) ──────────────────────────────────────────────────────────


class _Fake:
    """A scripted `stream_chat` (the `test_prompt_stamping_p18` shape, by copy) whose `stamp(report)`
    plays the part of the inference adapter: it fills the report the way a real serve does."""

    def __init__(self, deltas, stamp=None):
        self.deltas = deltas
        self.stamp = stamp

    def stream_chat(self, _messages, *, report=None, **_kw):
        deltas, stamp = self.deltas, self.stamp

        async def gen():
            for d in deltas:
                yield d
            if stamp is not None and report is not None:
                stamp(report)

        return gen()

    async def effective_window(self, _ep):
        return None

    async def min_chain_window(self, _mode=None, _model=None):
        return None

    def target_for(self, _mode=None, _model=None):
        from app.domain.provider import ResolvedTarget

        return ResolvedTarget(provider="fake", base_url="http://fake/v1", model="m")


def _text(s: str):
    from app.adapters.inference import ChatDelta

    return ChatDelta(text=s)


def _session(c, fake):
    from app.services.agent.session import AgentSession

    s = c.app.state
    agent = s.settings.resolve_agent(None).model_copy(update={"max_parallel_tools": 1})
    thread = _thread(c)
    session = AgentSession(s.threads, s.messages, s.inference, s.settings, s.actions, agent)
    session._inference = fake

    async def _never(_thread, **_kw):
        return False

    async def _none(_thread, **_kw):
        return None

    session._compactor.should_compact = _never
    session._compactor.compact = _none
    return session, thread


def _run(session, thread, user_text: str = "hi"):
    async def _collect():
        return [ev async for ev in session.run_turn(thread, user_text)]

    return run_async(_collect())


def _assistant(c, thread_id: str):
    msgs = run_async(c.app.state.messages.list(thread_id))
    (assistant,) = [m for m in msgs if m.role == "assistant"]
    return assistant


def _happy(report):
    report.served, report.primary, report.degraded = "corsair", "corsair", False
    report.model = "qwen3.6-max"
    report.prompt_tokens, report.cached_tokens, report.completion_tokens = 8100, 6900, 512
    report.context_window, report.duration_ms = 262144, 12300


def _degraded(report):
    report.served, report.primary, report.degraded = "openrouter", "corsair", True
    report.failures = ["local: down", "spare: 503"]
    report.model, report.duration_ms = "cloud-model", 4200


def test_a_turn_persists_who_served_it_and_what_the_call_cost() -> None:
    with _workspace(), _client() as c:
        session, thread = _session(c, _Fake([_text("done")], stamp=_happy))
        _run(session, thread)

        a = _assistant(c, thread.id)  # re-read from SQLite — the round-trip is part of the assertion
        assert a.source is not None
        assert (a.source.served, a.source.degraded, a.source.from_) == ("corsair", False, None)
        assert a.source.context_window == 262144
        assert a.usage is not None
        assert (a.usage.model, a.usage.input_tokens, a.usage.output_tokens) == ("qwen3.6-max", 8100, 512)
        assert (a.usage.cached_tokens, a.usage.duration_ms) == (6900, 12300)


def test_a_failover_turn_records_what_it_fell_back_from() -> None:
    with _workspace(), _client() as c:
        session, thread = _session(c, _Fake([_text("saved")], stamp=_degraded))
        _run(session, thread)

        a = _assistant(c, thread.id)
        assert a.source is not None
        assert (a.source.served, a.source.degraded) == ("openrouter", True)
        assert a.source.from_ == "corsair" and a.source.failed_hops == 2  # both hops that died
        assert a.source.context_window is None  # nothing resolvable → the segment simply won't render


def test_a_turn_whose_endpoint_reported_nothing_still_attributes_the_endpoint() -> None:
    """The partial case, which is the common one on a local backend without `return_progress`: the
    routing record stands on its own, and usage carries only what was actually known."""

    def _bare(report):
        report.served, report.primary, report.degraded = "corsair", "corsair", False
        report.duration_ms = 900

    with _workspace(), _client() as c:
        session, thread = _session(c, _Fake([_text("hi")], stamp=_bare))
        _run(session, thread)

        a = _assistant(c, thread.id)
        assert a.source is not None and a.source.served == "corsair"
        assert a.usage is not None and a.usage.duration_ms == 900
        assert a.usage.model is None and a.usage.input_tokens is None


# ── 4. the wire ─────────────────────────────────────────────────────────────────────────────────


def test_message_end_carries_the_same_two_objects_the_reload_serves() -> None:
    with _workspace(), _client() as c:
        session, thread = _session(c, _Fake([_text("done")], stamp=_happy))
        events = _run(session, thread)

        end = next(e for e in events if e.event == "message.end")
        assert end.data["source"] == {
            "served": "corsair",
            "degraded": False,
            "context_window": 262144,
        }
        assert end.data["usage"]["cached_tokens"] == 6900 and end.data["usage"]["duration_ms"] == 12300
        # …and byte-identical to what the durable thread-load path serves for the same message.
        a = _assistant(c, thread.id)
        dumped = a.model_dump(mode="json")
        assert dumped["source"] == end.data["source"] and dumped["usage"] == end.data["usage"]

        start = next(e for e in events if e.event == "message.start")
        assert "source" not in start.data  # served/degraded are unknown at start — nothing to say


def test_a_turn_with_nothing_to_attribute_streams_the_pre_d62_payload() -> None:
    with _workspace(), _client() as c:
        session, thread = _session(c, _Fake([_text("done")]))  # no report stamping at all
        events = _run(session, thread)

        end = next(e for e in events if e.event == "message.end")
        assert set(end.data) == {"messageId"}
        assert _assistant(c, thread.id).source is None
