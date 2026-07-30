"""A3 slice 1 — action attribution through the invoke chokepoint (D49 / AUTOMATIONS_PLAN §D-4).

The slice adds no behavior: it makes every recorded `Event` say WHO set the invocation in motion
(`origin`/`origin_id`/`run_id`) and WHY the gate let it run (`decision`), so the automation runner
that arrives in slice 2 has nothing to invent. What's pinned here:

  1. Migration  — v4 applies to a legacy (v3) database and backfills `origin` as the interactive
                  chat every existing row was; the three nullable columns read NULL.
  2. Threading  — `invoke` stamps the caller's `Origin` onto the Event, for every kind, and hands the
                  same object to the tool on its `InvocationContext`.
  3. Structure  — `origin` is a REQUIRED keyword with NO default (the point: a new call site is a type
                  error, never a silent `user_chat` mislabel — R9's structural-omission rule).
  4. Decision   — auto / confirmed / approval / policy, each from the path that produces it, with the
                  approval arm agreeing with D44's (untouched) summary marker.
  5. Wire       — the history read and the SSE frame carry the new keys (additive, `output` still out).
  6. Subagents  — a child session runs as `origin=subagent` named after the child agent, with the
                  parent's `run_id` PRESERVED — the transitive "descended from an automation" predicate.
  7. Reads      — a row this build can't interpret (a rollback reading what a newer build wrote)
                  degrades to `unknown`/None instead of failing the whole history read, while the write
                  path stays strict: the sentinel is unwritable BY TYPE (`Origin.kind` takes only the
                  four writable kinds; `Event.origin` takes the wider read vocabulary).

Runs as `python tests/test_attribution_14a.py` from backend/ (plain asserts + a __main__ runner) or
under pytest. Every test works in an isolated `$CTRLB_HOME`/`CTRLB_CONFIG`/`CTRLB_DB` temp workspace —
the operator's real config and database are never touched.
"""

from __future__ import annotations

import asyncio
import contextlib
import inspect
import json
import os
import tempfile
from pathlib import Path
from typing import get_args

from _async import run_async

from app.domain.event import ORIGIN_USER_CHAT, Event, Origin

_KINDS = ("user_chat", "automation", "subagent", "system")


@contextlib.contextmanager
def _workspace(config_text: str = "server:\n  port: 5433\n"):
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


def _run(coro):
    return run_async(coro)


# ── 1. the migration ────────────────────────────────────────────────────────────────────────────


def test_migration_v4_backfills_a_legacy_row_and_adds_the_columns() -> None:
    """A database written before the slice (schema v3) migrates in place: the four columns appear,
    `origin` backfills to `user_chat` for every existing row — an audit trail must not go blank about
    rows it recorded honestly — and the three nullable columns read NULL."""
    import app.db as dbmod
    from app.db import Database

    with _workspace() as tmp:
        path = tmp / "legacy.db"
        real = dbmod.MIGRATIONS

        async def go() -> tuple[int, list[str], tuple]:
            dbmod.MIGRATIONS = [m for m in real if m[0] <= 3]  # a v3-era database
            legacy = Database(path)
            await legacy.connect()
            assert await legacy.schema_version() == 3
            await legacy.execute(
                "INSERT INTO events (id, ts, actor, action, target, status, summary, output) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                ("old", "2026-07-01T00:00:00+00:00", "user", "wake_host", "alpha", "ok", "sent", None),
            )
            await legacy.close()

            dbmod.MIGRATIONS = real  # …now boot the shipped code against it
            db = Database(path)
            await db.connect()
            cols = [r["name"] for r in await db.query("PRAGMA table_info(events)")]
            row = await db.query("SELECT origin, origin_id, run_id, decision FROM events WHERE id = 'old'")
            version = await db.schema_version()
            await db.close()
            return version, cols, tuple(row[0])

        try:
            version, cols, values = _run(go())
        finally:
            dbmod.MIGRATIONS = real

        assert version == 4
        for col in ("origin", "origin_id", "run_id", "decision"):
            assert col in cols
        assert values == ("user_chat", None, None, None)


def test_migrations_are_append_only_up_to_v4() -> None:
    """The numbering invariant the release path depends on (db.py header): versions ascend by one and
    v4 is the tail — a re-ordered or re-used number silently skips a migration on an existing box."""
    from app.db import MIGRATIONS

    assert [v for v, _ in MIGRATIONS] == [1, 2, 3, 4]


# ── 2./3. threading the origin through the chokepoint ───────────────────────────────────────────


def test_origin_is_a_required_keyword_with_no_default() -> None:
    """The structural guarantee (R9): omitting `origin` at a call site must be impossible to do
    *quietly*. A default — any default — would let a future automation path record its actions as the
    owner's chat, so the parameter carries none and pyright rejects the omission."""
    from app.services.action_service import ActionService

    param = inspect.signature(ActionService.invoke).parameters["origin"]
    assert param.kind is inspect.Parameter.KEYWORD_ONLY
    assert param.default is inspect.Parameter.empty


def test_invoke_stamps_every_origin_kind_onto_the_event() -> None:
    """The whole point of the slice: whatever the caller says set this in motion is what the audit row
    says, for all four kinds — including the `id`/`run_id` an automation run carries."""
    from app.domain.enums import Actor, Privilege

    with _workspace(), _client() as c:
        actions = c.app.state.actions
        for kind in _KINDS:
            origin = Origin(kind=kind, id=f"{kind}-1", run_id="run-7")
            out = _run(
                actions.invoke(
                    "restart_service",
                    {"service_id": "ghost"},
                    origin=origin,
                    actor=Actor.AGENT,
                    privilege=Privilege.FULL,  # MED auto-allows at FULL — this is about attribution
                )
            )
            assert out.event is not None, kind
            assert (out.event.origin, out.event.origin_id, out.event.run_id) == (kind, f"{kind}-1", "run-7")


def test_the_origin_reaches_the_tool_on_its_invocation_context() -> None:
    """`InvocationContext.origin` is the seam the D-5 recursion guard will read, so the object the
    caller passed must arrive at the tool unchanged — not a reconstruction, not a default."""
    from pydantic import BaseModel

    from app.core.tool import FunctionTool, InvocationContext, ToolSpec
    from app.domain.enums import Privilege, RunState
    from app.domain.result import ToolResult

    class _NoArgs(BaseModel):
        pass

    seen: list[Origin] = []

    async def _probe(inp: _NoArgs, ctx: InvocationContext) -> ToolResult:
        seen.append(ctx.origin)
        return ToolResult(state=RunState.OK, summary="probed")

    with _workspace(), _client() as c:
        reg = c.app.state.actions.registry
        reg.register(
            FunctionTool(spec=ToolSpec(name="_probe", title="probe", input_model=_NoArgs), fn=_probe)
        )
        try:
            origin = Origin(kind="automation", id="nightly", run_id="run-9")
            _run(c.app.state.actions.invoke("_probe", {}, origin=origin, privilege=Privilege.FULL))
        finally:
            reg.remove("_probe")

    assert seen == [origin]
    assert seen[0] is not ORIGIN_USER_CHAT  # not the field default — the caller's own object arrived


def test_a_recorded_event_defaults_to_the_interactive_chat() -> None:
    """The two `Event`s written outside the gate (the memory/skill proposal apply path) construct the
    model directly. Their defaults must read as what they are — the owner, in a chat — so nothing had
    to change at those sites."""
    from app.domain.enums import Actor, RunState

    e = Event(actor=Actor.USER, action="memory", status=RunState.OK, summary="applied")
    assert (e.origin, e.origin_id, e.run_id, e.decision) == ("user_chat", None, None, None)
    assert ORIGIN_USER_CHAT == Origin(kind="user_chat")


# ── 4. the decision column ──────────────────────────────────────────────────────────────────────


def test_decision_auto_confirmed_and_policy() -> None:
    """`decision` records why the gate reached its outcome: a plain risk/privilege allow is `auto`, a
    run that redeemed a confirm token is `confirmed`, and a refusal is `policy` (the summary already
    says "denied by policy"; the column makes it queryable)."""
    from app.domain.enums import Actor, Privilege, RunState

    with _workspace(), _client() as c:
        actions = c.app.state.actions
        args = {"service_id": "ghost"}

        auto = _run(
            actions.invoke("restart_service", args, origin=ORIGIN_USER_CHAT, privilege=Privilege.FULL)
        )
        assert auto.event is not None and auto.event.decision == "auto"

        gate = _run(
            actions.invoke("restart_service", args, origin=ORIGIN_USER_CHAT, privilege=Privilege.CONFIRM)
        )
        assert gate.needs_confirm and gate.confirm_token
        assert gate.event is None  # a suspended call records nothing (unchanged)
        confirmed = _run(
            actions.invoke(
                "restart_service",
                args,
                origin=ORIGIN_USER_CHAT,
                privilege=Privilege.CONFIRM,
                confirm_token=gate.confirm_token,
            )
        )
        assert confirmed.event is not None and confirmed.event.decision == "confirmed"

        denied = _run(
            actions.invoke(
                "reboot_host",
                {"host_id": "nope"},
                origin=ORIGIN_USER_CHAT,
                actor=Actor.AGENT,
                privilege=Privilege.READONLY,
            )
        )
        assert denied.result is not None and denied.result.state is RunState.DENIED
        assert denied.event is not None and denied.event.decision == "policy"


def test_decision_approval_agrees_with_the_d44_marker() -> None:
    """A persisted D44 approval is the crossing worth auditing, and it now has a machine-readable
    column beside the summary marker. Both come off the SAME predicate, so they can never disagree —
    and the shipped marker is left exactly as it was."""
    from app.config import ApprovalRule, ToolOverride
    from app.domain.enums import Actor, Privilege

    with _workspace(), _client() as c:
        actions = c.app.state.actions
        actions._deps.settings.tool_overrides["restart_service"] = ToolOverride(
            approvals=[ApprovalRule(args={"service_id": "ghost"})]
        )
        out = _run(
            actions.invoke(
                "restart_service",
                {"service_id": "ghost"},
                origin=ORIGIN_USER_CHAT,
                actor=Actor.AGENT,
                privilege=Privilege.CONFIRM,
            )
        )
        assert not out.needs_confirm  # the rule downgraded CONFIRM → ALLOW
        assert out.event is not None
        assert out.event.decision == "approval"
        assert "[auto-allowed: service_id=ghost]" in (out.event.summary or "")


# ── 5. the wire: history + the live frame ───────────────────────────────────────────────────────


def test_history_and_the_live_frame_carry_the_attribution_keys() -> None:
    """Both event surfaces are additive: `GET /api/events` round-trips all four columns out of SQLite,
    and the SSE frame gains the same keys while still excluding `output`. The FE reads the frame
    defensively (`hooks/useEvents`' partial `WireEvent`), so new keys need no client change."""
    import app.api.events as events_api
    from app.domain.enums import Privilege
    from app.services import wake_on_connect

    with _workspace(), _client() as c:
        origin = Origin(kind="automation", id="nightly", run_id="run-3")
        _run(
            c.app.state.actions.invoke(
                "restart_service", {"service_id": "ghost"}, origin=origin, privilege=Privilege.FULL
            )
        )
        rows = c.get("/api/events").json()
        assert rows, "the invoke must have recorded an event"
        assert (rows[0]["origin"], rows[0]["origin_id"], rows[0]["run_id"]) == (
            "automation",
            "nightly",
            "run-3",
        )
        assert rows[0]["decision"] == "auto"

        # …and the same fields ride the live frame (driven against the router's own generator, as in
        # test_notifications_f1 — the endpoint is an infinite loop with a 15s first keepalive).
        event = Event.model_validate(rows[0])
        bus = c.app.state.event_bus

        class _FakeRequest:
            def __init__(self) -> None:
                self.app = c.app
                self._checks = 0

            async def is_disconnected(self) -> bool:
                self._checks += 1
                if self._checks == 1:
                    bus.publish(event)
                    return False
                return True

        async def drive() -> dict:
            response = await events_api.stream_events(_FakeRequest())  # type: ignore[arg-type]
            async for frame in response.body_iterator:
                if frame.get("event") == "event":
                    return frame
            raise AssertionError("the stream never yielded an event frame")

        real_schedule = wake_on_connect.schedule
        try:
            wake_on_connect.schedule = lambda _app: None  # type: ignore[assignment]
            frame = asyncio.run(drive())
        finally:
            wake_on_connect.schedule = real_schedule  # type: ignore[assignment]

        data = json.loads(frame["data"])
        assert "output" not in data  # the F1 projection is unchanged
        assert (data["origin"], data["origin_id"], data["run_id"], data["decision"]) == (
            "automation",
            "nightly",
            "run-3",
            "auto",
        )


# ── 6. subagent propagation ─────────────────────────────────────────────────────────────────────


def test_subagent_child_runs_as_subagent_with_the_parent_run_id_preserved() -> None:
    """D-4's ancestry ruling, executable: a child's actions are attributed to the SUBAGENT that takes
    them (`kind=subagent`, `id` = the child agent's name) — never to whatever started the tree — while
    the parent's `run_id` is carried through, since THAT is the authoritative "descended from an
    automation" predicate and it has to survive every level of nesting."""
    import app.services.agent.session as sess_mod
    from app.services.agent.subagents import run_subagent

    captured: dict = {}

    class _NoopSession:
        def __init__(self, *_a, **kw) -> None:
            captured["origin"] = kw.get("origin")

        async def run_turn(self, thread, task):  # noqa: ANN001
            return
            yield  # unreachable — makes this an async generator like the real run_turn

    with _workspace(), _client() as c:
        deps = c.app.state.deps
        agent_def = deps.settings.default_agent_def()
        orig = sess_mod.AgentSession
        sess_mod.AgentSession = _NoopSession  # type: ignore[misc,assignment]
        try:
            _run(
                run_subagent(
                    deps,
                    agent_def,
                    "do a thing",
                    index=0,
                    depth=1,
                    timeout_s=5,
                    parent_origin=Origin(kind="automation", id="nightly", run_id="run-42"),
                )
            )
        finally:
            sess_mod.AgentSession = orig  # type: ignore[misc]

    assert captured["origin"] == Origin(kind="subagent", id=agent_def.name, run_id="run-42")


def test_spawn_subagents_forwards_the_context_origin_as_the_parent_origin() -> None:
    """The link that makes the above transitive: the tool propagates the origin it was invoked with,
    so a nested spawn keeps carrying the same `run_id` instead of restarting attribution at the
    orchestrator."""
    from app.core.tool import InvocationContext
    from app.domain.enums import Actor, Privilege
    from app.services.agent import subagents
    from app.services.agent.subagents import SpawnInput, SubTask, spawn_subagents

    captured: dict = {}

    class _FakeOrch:
        def __init__(self, **_kw) -> None: ...

        async def run_many(self, deps, children, *, depth, parent_origin):  # noqa: ANN001
            captured["parent_origin"] = parent_origin
            captured["depth"] = depth
            return []

    with _workspace(), _client() as c:
        deps = c.app.state.deps
        parent = deps.settings.default_agent_def()
        origin = Origin(kind="automation", id="nightly", run_id="run-5")
        ctx = InvocationContext(
            actor=Actor.AGENT, privilege=Privilege.FULL, deps=deps, depth=0, agent=parent, origin=origin
        )
        real = subagents.ParallelOrchestrator
        subagents.ParallelOrchestrator = _FakeOrch  # type: ignore[misc]
        try:
            _run(spawn_subagents(SpawnInput(tasks=[SubTask(task="x")]), ctx))
        finally:
            subagents.ParallelOrchestrator = real  # type: ignore[misc]

    assert captured["parent_origin"] == origin
    assert captured["depth"] == 1  # unchanged: attribution rides beside the existing depth plumbing


# ── 7. lenient reads (post-14a review, LOW) ─────────────────────────────────────────────────────


def _literal_values(tp: object) -> set[str]:
    """The member strings of a `Literal`, or of a union of them (`EventOriginKind` is the latter — the
    runtime keeps `Literal[…] | Literal["unknown"]` as a two-arm union rather than collapsing it)."""
    values: set[str] = set()
    for arg in get_args(tp):
        values |= {arg} if isinstance(arg, str) else _literal_values(arg)
    return values


def _insert_row(c, *, event_id: str, origin: str, decision: str | None) -> None:
    """Write an events row straight through SQLite, bypassing the domain model — the only way to stage
    what a NEWER build (or a corrupted row) would leave behind for this one to read."""
    _run(
        c.app.state.db.execute(
            "INSERT INTO events "
            "(id, ts, actor, action, target, status, summary, output, origin, origin_id, run_id, decision) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                event_id,
                f"2026-07-30T12:00:0{event_id[-1]}+00:00",
                "user",
                "wake_host",
                "alpha",
                "ok",
                "sent",
                None,
                origin,
                None,
                None,
                decision,
            ),
        )
    )


def test_an_unknown_origin_degrades_instead_of_failing_the_whole_history() -> None:
    """Rollback is by tag (D32), so a downgraded build can legitimately meet an origin kind it has never
    heard of. `Event`'s Literals would raise on it — inside a list comprehension over the whole result —
    so ONE such row would blank the entire audit trail exactly when it matters. The read coerces the
    field instead: `unknown` / `None`, every other column intact, and the valid rows beside it untouched."""
    with _workspace(), _client() as c:
        _insert_row(c, event_id="row1", origin="user_chat", decision="auto")
        _insert_row(c, event_id="row2", origin="fleet_monitor", decision="quorum")  # a v1.6 build's row

        by_id = {e.id: e for e in _run(c.app.state.events.recent(10))}
        assert len(by_id) == 2  # the read survived — this is the regression

        assert (by_id["row1"].origin, by_id["row1"].decision) == ("user_chat", "auto")
        assert (by_id["row2"].origin, by_id["row2"].decision) == ("unknown", None)
        # Degrade the field, not the record: everything else about the strange row still reads true.
        assert (by_id["row2"].action, by_id["row2"].target, by_id["row2"].summary) == (
            "wake_host",
            "alpha",
            "sent",
        )

        # …and the endpoint the SPA polls stays a 200 with both rows in it.
        body = c.get("/api/events").json()
        assert {r["id"] for r in body} == {"row1", "row2"}
        assert next(r for r in body if r["id"] == "row2")["origin"] == "unknown"


def test_the_coercion_is_derived_from_the_domain_vocabulary() -> None:
    """The known-value sets come off the `Literal`s via `get_args`, so adding a kind can never leave a
    hand-maintained copy behind (which would silently coerce a brand-new, perfectly valid kind)."""
    from app.domain.event import DecisionReason, OriginKind
    from app.services.events import _DECISIONS, _ORIGIN_KINDS, _decision, _origin_kind

    assert _ORIGIN_KINDS == frozenset(get_args(OriginKind))
    assert _DECISIONS == frozenset(get_args(DecisionReason))
    for kind in get_args(OriginKind):
        assert _origin_kind(kind) == kind  # every known kind passes through untouched
    for reason in get_args(DecisionReason):
        assert _decision(reason) == reason
    assert _origin_kind("nope") == "unknown" and _origin_kind(None) == "unknown"
    assert _decision("nope") is None and _decision(None) is None


def test_the_sentinel_is_unwritable_by_construction_not_by_convention() -> None:
    """The asymmetry that keeps the audit trail honest, carried by the TYPES rather than by a source scan
    (post-14a verify, LOW): `Origin.kind` takes only the four writable kinds, so no code path — present or
    future, in `app/` or anywhere else — can mint an `unknown` origin, while the read type accepts it.
    `unknown` can therefore only ever mean "this build could not read what was stored", never "the gate
    did not know who was calling"."""
    from pydantic import ValidationError

    from app.domain.event import UNKNOWN_ORIGIN, EventOriginKind, OriginKind

    # The write type refuses the sentinel…
    try:
        Origin(kind=UNKNOWN_ORIGIN)  # type: ignore[arg-type] — pyright rejects this statically too
    except ValidationError:
        pass
    else:
        raise AssertionError("Origin accepted the read-side sentinel — it must be unwritable")

    # …while the read type accepts it, and the two vocabularies differ by exactly that one member.
    stored = Event.model_validate({"actor": "user", "action": "x", "status": "ok", "origin": UNKNOWN_ORIGIN})
    assert stored.origin == UNKNOWN_ORIGIN
    assert set(get_args(OriginKind)) == set(_KINDS)
    assert _literal_values(EventOriginKind) == set(_KINDS) | {UNKNOWN_ORIGIN}


def test_a_real_invocation_records_the_kind_it_was_given() -> None:
    """The end-to-end half of the same asymmetry: the gate stamps what the caller declared, so no
    recorded row can read as the sentinel."""
    from app.domain.enums import Privilege

    with _workspace(), _client() as c:
        for kind in _KINDS:
            out = _run(
                c.app.state.actions.invoke(
                    "restart_service",
                    {"service_id": "ghost"},
                    origin=Origin(kind=kind),
                    privilege=Privilege.FULL,
                )
            )
            assert out.event is not None and out.event.origin == kind != "unknown"


def test_interactive_sessions_carry_the_chat_origin() -> None:
    """Every interactive turn is built by ONE builder, and the session it produces runs as the owner's
    chat — so the actions a chat turn invokes are attributed to the chat, and slice 2's automation
    runner changes exactly one argument to become an automation."""
    from app.api.agent import _build_session

    with _workspace(), _client() as c:
        session = _build_session(c.app.state)
        assert session._origin == ORIGIN_USER_CHAT


if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    for fn in fns:
        fn()
        print(f"ok  {fn.__name__}")
    print(f"\n{len(fns)} passed")
