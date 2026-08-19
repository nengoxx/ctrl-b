"""Phase 18 Slice 2 — prompt-identity stamping + per-call usage on the persisted message.

The eval seam (PROMPTS_PLAN §2.7 as amended by §7 L-2/L-11a), exercised through REAL turns against a
scripted inference: every message a model call produces carries `{prompt_stamps, usage}`, so a stored
transcript can be attributed to the exact prompt VERSION (template hash) that produced it — with NO
eval tables this phase (L-2), just one nullable `messages.meta` JSON column (migration 6). Recovering
the TEXT of an override edited since is the harness phase's `prompt_texts` store, not this.

What's exercised:
  1. a turn stamps the prompts whose text reached the model, hashed per C-8 (the effective template
     BEFORE substitution) — and nothing else;
  2. an override changes the hash to the override's own;
  3. C-17: an owner edit mid-turn shows as the OLD hash on the message it actually fed and the NEW
     hash on the later one — a mixed-version turn is represented, not hidden;
  4. the compaction summary message stamps `summarizer` and ONLY `summarizer` (its own model call);
  5. usage rides the same message when the provider reports it, is `None` when it doesn't, and
     round-trips through the `meta` column unchanged — `parts` stays pure content;
  6. subagent sessions stamp their own messages — same machinery, not a forked path.

Each test runs in an isolated `$CTRLB_HOME`/config/db; no real backend, no real config.yaml.
"""

from __future__ import annotations

import contextlib
import json
import os
import tempfile
from pathlib import Path

from _async import run_async

from app.services.agent.prompts import REGISTRY, template_hash

#: An ISO instant for the hand-seeded legacy row in the migration test.
_TS = "2026-08-15T00:00:00+00:00"

#: A config with one host, so the `fleet_roster` frame is actually injected (an empty fleet skips it).
_CONFIG = """server:
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


class _Fake:
    """A scripted `stream_chat` (the `test_steer_drain_a_d41` fake): `scripts[i]` is the i-th call's
    deltas. `on_call(idx)` fires at the START of each stream — the seam where a test edits a prompt
    mid-turn. `usage(report)` stamps the report like a provider that reports token counts."""

    def __init__(self, scripts, on_call=None, usage=None):
        self.scripts = scripts
        self.on_call = on_call
        self.usage = usage
        self.calls = 0

    def stream_chat(self, messages, *, report=None, **_kw):
        idx = self.calls
        self.calls += 1
        script = self.scripts[idx] if idx < len(self.scripts) else self.scripts[-1]
        on_call, usage = self.on_call, self.usage

        async def gen():
            if on_call is not None:
                await on_call(idx)
            for d in script:
                yield d
            if usage is not None and report is not None:
                usage(report)

        return gen()

    async def effective_window(self, _ep):
        return None

    async def min_chain_window(self, _mode=None, _model=None):  # D60 — the clearing pressure gate
        return None  # no window → always-on clearing (the pre-D60 behaviour these tests assume)

    def target_for(self, _mode=None, _model=None):
        from app.domain.provider import ResolvedTarget

        return ResolvedTarget(provider="fake", base_url="http://fake/v1", model="m")


def _text(s: str):
    from app.adapters.inference import ChatDelta

    return ChatDelta(text=s)


def _tool(name: str, args: dict, cid: str):
    from app.adapters.inference import ChatDelta, ToolCallRequest

    return ChatDelta(tool_calls=[ToolCallRequest(id=cid, name=name, arguments=json.dumps(args))])


def _session(c, fake):
    from app.domain.conversation import Thread
    from app.services.agent.session import AgentSession

    s = c.app.state
    agent = s.settings.resolve_agent(None).model_copy(update={"max_parallel_tools": 1})
    thread = run_async(s.threads.create(Thread()))
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


def _messages(c, thread_id: str):
    """The thread's messages RE-READ FROM SQLITE — so every assertion also proves the metadata
    survives the round-trip through the `meta` column, not just the in-memory object."""
    return run_async(c.app.state.messages.list(thread_id))


def _assistants(c, thread_id: str):
    return [m for m in _messages(c, thread_id) if m.role == "assistant"]


def _default_hash(prompt_id: str) -> str:
    return template_hash(REGISTRY[prompt_id].default)


def _tiny_compaction():
    """Floors low enough that a short seeded thread actually folds (the `test_compaction_w3` idiom) —
    these tests are about what the summary MESSAGE carries, not about the trigger."""
    from app.config import CompactionCfg

    return CompactionCfg(keep_last_messages=2, keep_recent_tokens=1)


# ── 1. what a plain turn stamps ──────────────────────────────────────────────────────────────────


def test_a_turn_stamps_the_prompts_that_reached_the_model() -> None:
    with _workspace(), _client() as c:
        session, thread = _session(c, _Fake([[_text("done")]]))
        _run(session, thread)

        (assistant,) = _assistants(c, thread.id)
        assert assistant.prompt_stamps == {"fleet_roster": _default_hash("fleet_roster")}
        # …and ONLY that: a prompt whose text never reached this call (the wrap-up nudge, the C2
        # steering texts, the summarizer) is not in the set.
        assert "wrapup_nudge" not in assistant.prompt_stamps


def test_the_user_message_carries_no_stamp() -> None:
    """Stamps mark what a MODEL CALL was made of — a user turn is not one."""
    with _workspace(), _client() as c:
        session, thread = _session(c, _Fake([[_text("done")]]))
        _run(session, thread)

        user = next(m for m in _messages(c, thread.id) if m.role == "user")
        assert user.prompt_stamps is None and user.usage is None


def test_an_override_changes_the_hash_to_its_own_template() -> None:
    from app.config import PromptOverride

    with _workspace(), _client() as c:
        c.app.state.settings.prompts["fleet_roster"] = PromptOverride(override="My machines:")
        session, thread = _session(c, _Fake([[_text("done")]]))
        _run(session, thread)

        (assistant,) = _assistants(c, thread.id)
        assert assistant.prompt_stamps == {"fleet_roster": template_hash("My machines:")}


def test_an_append_hashes_the_composed_template_not_either_half() -> None:
    """C-8 hashes the EFFECTIVE template — base + append — so an append-only customization is a
    distinct version, exactly like an override."""
    from app.config import PromptOverride

    with _workspace(), _client() as c:
        c.app.state.settings.prompts["fleet_roster"] = PromptOverride(append="Prefer the desktop.")
        session, thread = _session(c, _Fake([[_text("done")]]))
        _run(session, thread)

        (assistant,) = _assistants(c, thread.id)
        composed = REGISTRY["fleet_roster"].default + "\n\nPrefer the desktop."
        assert assistant.prompt_stamps == {"fleet_roster": template_hash(composed)}


# ── 2. C-17: a mid-turn edit is represented, not hidden ─────────────────────────────────────────


def test_a_mid_turn_edit_stamps_the_old_hash_on_the_message_it_fed() -> None:
    """The C-17 test. Two blocked tool calls (the M1 guard resolves `m1_tool_blocked` at EXECUTION
    time, one of the C2 texts that does not freeze with the head), with an override applied between
    the two model calls. The message persisted after the FIRST guard carries the default's hash —
    that is the text that actually fed the model — and the one after the second carries the
    override's. Two different names so each call goes through the guard rather than the denial echo."""
    from app.config import PromptOverride

    with _workspace(), _client() as c:
        settings = c.app.state.settings

        async def on_call(idx):
            if idx == 1:
                settings.prompts["m1_tool_blocked"] = PromptOverride(override="Nope: {{tool}}.")

        fake = _Fake(
            [
                [_tool("ghost_a", {}, "c1")],
                [_tool("ghost_b", {}, "c2")],
                [_text("giving up")],
            ],
            on_call=on_call,
        )
        session, thread = _session(c, fake)
        _run(session, thread)

        first, second, third = _assistants(c, thread.id)
        assert "m1_tool_blocked" not in (first.prompt_stamps or {})  # persisted before the guard ran
        assert second.prompt_stamps["m1_tool_blocked"] == _default_hash("m1_tool_blocked")
        assert third.prompt_stamps["m1_tool_blocked"] == template_hash("Nope: {{tool}}.")


def test_a_c2_stamp_rides_every_later_message_of_the_turn() -> None:
    """The TURN-SCOPED semantic, pinned on purpose (main-seat ruling): a C2 text resolved ONCE appears
    on the next assistant message AND on every one after it — not because the accumulator is sloppy,
    but because the text persists as a tool result and really is in those later calls' context.

    Falsifying an accumulator that CLEARED after each persist takes two things, so both are here:
    `m1_tool_blocked` is resolved exactly once (the second tool call is an allowed one that reaches
    no C2 text), and an override lands right after that single resolve — so a clear-and-re-resolve
    implementation would show the OVERRIDE's hash on the third message, and a clear-only one would
    show no `m1_tool_blocked` at all. Only persistence produces the default's hash on both."""
    from app.config import PromptOverride
    from app.domain.enums import RunState
    from app.domain.result import ToolResult
    from app.services.action_service import InvokeOutcome

    with _workspace(), _client() as c:
        settings = c.app.state.settings

        async def on_call(idx):
            if idx == 1:  # after the ONE guard resolve, before any later message is persisted
                settings.prompts["m1_tool_blocked"] = PromptOverride(override="Nope: {{tool}}.")

        fake = _Fake(
            [
                [_tool("ghost_a", {}, "c1")],  # blocked → the guard resolves `m1_tool_blocked` ONCE
                [_tool("ping_host", {"host_id": "corsair"}, "c2")],  # allowed → no C2 text at all
                [_text("done")],
            ],
            on_call=on_call,
        )
        session, thread = _session(c, fake)

        async def _ok(tool, args, **_kw):
            return InvokeOutcome(
                needs_confirm=False, result=ToolResult(state=RunState.OK, summary=f"ran {tool}")
            )

        session._actions.invoke = _ok
        _run(session, thread)

        first, second, third = _assistants(c, thread.id)
        blocked = _default_hash("m1_tool_blocked")
        assert "m1_tool_blocked" not in (first.prompt_stamps or {})  # written before the guard ran
        assert second.prompt_stamps["m1_tool_blocked"] == blocked
        assert third.prompt_stamps["m1_tool_blocked"] == blocked  # …carried, not re-resolved
        # the head's own stamp rides all three — it was frozen once, at the top of the turn
        assert all(
            m.prompt_stamps["fleet_roster"] == _default_hash("fleet_roster") for m in (first, second, third)
        )


# ── 3. the compaction summary message ───────────────────────────────────────────────────────────


def test_the_summary_message_stamps_only_the_summarizer() -> None:
    """The compaction call is its OWN model call in its OWN context, so the summary message carries
    the summarizer stamp alone — never the turn's accumulated set."""
    from app.domain.conversation import Message, TextPart, Thread
    from app.domain.enums import Actor
    from app.services.agent.compaction import SUMMARY_PREFIX, Compactor

    class _Summarizer:
        async def effective_window_for(self, *_a, **_kw):
            return None

        async def complete(self, _payload, *, report=None, **_kw):
            if report is not None:
                report.model = "summarizer-model"
                report.prompt_tokens, report.completion_tokens = 900, 40
            return "## Goals & Requests\n- none"

    with _workspace(), _client() as c:
        s = c.app.state
        thread = run_async(s.threads.create(Thread()))

        async def seed():
            for i in range(12):
                await s.messages.add(
                    Message(
                        thread_id=thread.id,
                        role="user" if i % 2 == 0 else "assistant",
                        actor=Actor.USER,
                        parts=[TextPart(text=f"message {i} " + "x" * 200)],
                    )
                )

        run_async(seed())
        comp = Compactor(_Summarizer(), s.messages, _tiny_compaction(), s.settings)
        result = run_async(comp.compact(thread, force=True))
        assert result is not None and not result.rejected

        summary = next(m for m in _messages(c, thread.id) if m.id == result.summary_id)
        assert summary.text().startswith(SUMMARY_PREFIX)
        assert summary.prompt_stamps == {"summarizer": _default_hash("summarizer")}
        assert summary.usage is not None
        assert (summary.usage.model, summary.usage.input_tokens, summary.usage.output_tokens) == (
            "summarizer-model",
            900,
            40,
        )


def test_a_truncation_fold_stamps_nothing() -> None:
    """No model call stands behind the truncation placeholder, so there is nothing to attribute."""
    from app.adapters.inference import InferenceError
    from app.domain.conversation import Message, TextPart, Thread
    from app.domain.enums import Actor
    from app.services.agent.compaction import TRUNCATION_NOTICE, Compactor

    class _Dead:
        async def effective_window_for(self, *_a, **_kw):
            return None

        async def complete(self, *_a, **_kw):
            raise InferenceError("summarizer down")

    with _workspace(), _client() as c:
        s = c.app.state
        thread = run_async(s.threads.create(Thread()))

        async def seed():
            for i in range(12):
                await s.messages.add(
                    Message(
                        thread_id=thread.id,
                        role="user" if i % 2 == 0 else "assistant",
                        actor=Actor.USER,
                        parts=[TextPart(text=f"message {i} " + "x" * 200)],
                    )
                )

        run_async(seed())
        comp = Compactor(_Dead(), s.messages, _tiny_compaction(), s.settings)
        result = run_async(comp.compact(thread, force=True))
        assert result is not None and result.truncated

        summary = next(m for m in _messages(c, thread.id) if m.id == result.summary_id)
        assert summary.text() == TRUNCATION_NOTICE
        assert summary.prompt_stamps is None and summary.usage is None


# ── 4. usage ────────────────────────────────────────────────────────────────────────────────────


def test_usage_is_persisted_from_what_the_provider_reported() -> None:
    def _report(report):
        report.model = "served-model"
        report.prompt_tokens, report.completion_tokens = 1200, 34

    with _workspace(), _client() as c:
        session, thread = _session(c, _Fake([[_text("done")]], usage=_report))
        _run(session, thread)

        (assistant,) = _assistants(c, thread.id)
        assert assistant.usage is not None
        assert (assistant.usage.model, assistant.usage.input_tokens, assistant.usage.output_tokens) == (
            "served-model",
            1200,
            34,
        )


def test_usage_is_null_when_the_provider_reports_nothing() -> None:
    """Nullable end to end (L-2): a backend that reports no counts yields no usage — never zeros."""
    with _workspace(), _client() as c:
        session, thread = _session(c, _Fake([[_text("done")]]))
        _run(session, thread)

        (assistant,) = _assistants(c, thread.id)
        assert assistant.usage is None


def test_a_partial_report_persists_what_it_had() -> None:
    """llama.cpp reports a prompt total without `include_usage`; the output side stays unknown."""

    def _report(report):
        report.prompt_tokens = 800

    with _workspace(), _client() as c:
        session, thread = _session(c, _Fake([[_text("done")]], usage=_report))
        _run(session, thread)

        (assistant,) = _assistants(c, thread.id)
        assert assistant.usage is not None
        assert assistant.usage.input_tokens == 800
        assert assistant.usage.output_tokens is None and assistant.usage.model is None


# ── 5. the `meta` column ────────────────────────────────────────────────────────────────────────


def test_an_update_keeps_the_metadata_the_message_was_written_with() -> None:
    """The tool-call state flips rewrite the row mid-turn (`MessageRepo.update`) — a stamp must not
    evaporate on the first flip. It cannot: `add` is `meta`'s only writer, and an update touches only
    what changes afterwards (parts, tokens, the compaction flag)."""
    with _workspace(), _client() as c:
        session, thread = _session(c, _Fake([[_tool("ghost_a", {}, "c1")], [_text("done")]]))
        _run(session, thread)

        with_calls = next(m for m in _assistants(c, thread.id) if m.tool_calls())
        assert with_calls.prompt_stamps == {"fleet_roster": _default_hash("fleet_roster")}
        assert with_calls.tool_calls()[0].state.value == "denied"  # the flip landed too


def test_metadata_lives_in_its_own_column_and_parts_stays_content() -> None:
    """The storage contract the harness phase will query: `prompt_stamps`/`usage` are keys of the
    `meta` JSON object (`json_extract(messages.meta, '$.prompt_stamps')`), and `parts` carries the
    message's content and nothing else — no sentinel to strip, no `json_each` gymnastics."""
    with _workspace(), _client() as c:
        session, thread = _session(c, _Fake([[_text("done")]]))
        _run(session, thread)

        (assistant,) = _assistants(c, thread.id)
        assert [p.type for p in assistant.parts] == ["text"] and assistant.text() == "done"

        async def _query():
            return await c.app.state.db.query(
                "SELECT parts, json_extract(meta, '$.prompt_stamps') AS stamps FROM messages WHERE id = ?",
                (assistant.id,),
            )

        (row,) = run_async(_query())
        assert json.loads(row["parts"]) == [{"type": "text", "text": "done"}]
        assert json.loads(row["stamps"]) == {"fleet_roster": _default_hash("fleet_roster")}


def test_migration_6_adds_the_column_to_a_legacy_database_and_old_rows_read_null() -> None:
    """Additive + forward-only (the db.py release-compat rule): a database written before this slice
    gains `meta` in place, and every row it already had reads back with no metadata rather than
    failing — the `agent`-column precedent, one migration later."""
    import app.db as dbmod
    from app.db import Database
    from app.services.conversation import MessageRepo

    with _workspace() as tmp:
        path = tmp / "legacy.db"
        real = dbmod.MIGRATIONS

        async def go():
            dbmod.MIGRATIONS = [m for m in real if m[0] <= 5]  # a pre-Phase-18 database
            legacy = Database(path)
            await legacy.connect()
            # seeded through raw SQL in the PRE-6 column list: today's repo writes `meta`, so it
            # could not have produced this row
            await legacy.execute(
                "INSERT INTO threads (id, created_at, updated_at) VALUES (?, ?, ?)",
                ("t1", _TS, _TS),
            )
            await legacy.execute(
                "INSERT INTO messages (id, thread_id, role, parts, actor, ts) VALUES (?, ?, ?, ?, ?, ?)",
                ("m1", "t1", "assistant", '[{"type": "text", "text": "old row"}]', "agent", _TS),
            )
            await legacy.close()

            dbmod.MIGRATIONS = real
            db = Database(path)
            await db.connect()
            cols = [r["name"] for r in await db.query("PRAGMA table_info(messages)")]
            (old,) = await MessageRepo(db).list("t1")
            await db.close()
            return cols, old

        try:
            cols, old = run_async(go())
        finally:
            dbmod.MIGRATIONS = real

    assert "meta" in cols
    assert old.text() == "old row" and old.prompt_stamps is None and old.usage is None


def test_an_unknown_meta_key_survives_an_update() -> None:
    """`meta` is written ONCE, by `add`: model-call metadata is final before the row lands, and
    updates only touch what changes afterwards. So a key this version does not know — a future
    dimension, or one written by a newer version before a rollback — is not silently rewritten away."""
    from app.services.conversation import MessageRepo

    with _workspace(), _client() as c:
        db = c.app.state.db
        repo = MessageRepo(db)
        raw = '{"prompt_stamps":{"fleet_roster":"abc"},"usage":null,"latency_ms":42}'

        async def go():
            await db.execute(
                "INSERT INTO threads (id, created_at, updated_at) VALUES (?, ?, ?)", ("t9", _TS, _TS)
            )
            await db.execute(
                "INSERT INTO messages (id, thread_id, role, parts, actor, ts, meta) "
                "VALUES (?, ?, ?, ?, ?, ?, ?)",
                ("m9", "t9", "assistant", '[{"type": "text", "text": "hi"}]', "agent", _TS, raw),
            )
            (msg,) = await repo.list("t9")
            msg.compacted = True
            await repo.update(msg)  # the compaction flip — the ordinary update path
            return await db.query("SELECT meta FROM messages WHERE id = ?", ("m9",))

        (row,) = run_async(go())
        assert json.loads(row["meta"])["latency_ms"] == 42
        assert json.loads(row["meta"])["prompt_stamps"] == {"fleet_roster": "abc"}


def test_a_message_with_no_model_call_stores_no_meta_at_all() -> None:
    """NULL, never an object of nulls — the column is empty for every user turn and legacy row."""
    with _workspace(), _client() as c:
        session, thread = _session(c, _Fake([[_text("done")]]))
        _run(session, thread)
        user = next(m for m in _messages(c, thread.id) if m.role == "user")

        async def _query():
            return await c.app.state.db.query("SELECT meta FROM messages WHERE id = ?", (user.id,))

        (row,) = run_async(_query())
        assert row["meta"] is None


# ── 6. subagents run the same machinery ─────────────────────────────────────────────────────────


def test_a_subagent_turn_stamps_its_own_messages() -> None:
    """A child is an `AgentSession` like any other — verified, not assumed (the semconv rule is that
    a sub-agent's calls count against the CHILD, so its messages must carry their own stamps)."""
    from app.domain.conversation import Thread
    from app.services.agent.session import AgentSession

    with _workspace(), _client() as c:
        s = c.app.state
        thread = run_async(s.threads.create(Thread()))
        child = AgentSession(
            s.threads,
            s.messages,
            s.inference,
            s.settings,
            s.actions,
            s.settings.resolve_agent(None),
            interactive=False,
            depth=1,
        )
        child._inference = _Fake([[_text("child answer")]])

        async def _none(_thread, **_kw):
            return None

        child._compactor.compact = _none
        run_async(_drain(child, thread))

        (assistant,) = _assistants(c, thread.id)
        assert assistant.prompt_stamps == {"fleet_roster": _default_hash("fleet_roster")}


async def _drain(session, thread, text: str = "do it"):
    return [ev async for ev in session.run_turn(thread, text)]
