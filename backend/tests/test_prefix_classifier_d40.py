"""ACA Slice 4 (D40 §3) — the single-pass parallel-prefix classifier.

`AgentSession._classify_batch` is a PURE synchronous walk over an assistant message's tool calls
(no I/O, no awaits) that splits the batch into a **parallel read-only prefix** + a **serial tail**
(`_BatchPlan`). It is UNWIRED this wave — the Wave-4 parallel executor consumes it — so these tests
drive it directly against the REAL registry (built by `create_app`), asserting each admission
predicate and the overlay-then-commit guard semantics.

Admission (D40 §3) requires ALL of: (a) fresh — not `_RESOLVED`, no resume token/answer; (b) not
suppressed vs the current guard (denied_sigs / per-tool cap / repeat-cap **on counts alone**);
(c) args parsed OK (`invalid_raw is None`); (d) spec exists AND builtin-authored `read_only` AND not
`suspending` (builtin-vs-derived discriminator = `category != "mcp"`; `idempotent` grants nothing);
(e) `decide() == ALLOW`. A prefix of length < 2 is NOT parallel: the plan is empty + `guard` is
byte-identical to entry (the ≤1 serial path mutates nothing).

Each test runs in an isolated `$CTRLB_HOME` temp workspace; the real config/db are never touched.
"""

from __future__ import annotations

import contextlib
import os
import tempfile
import uuid
from pathlib import Path

from pydantic import BaseModel


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


def _guard(*, max_repeat: int = 5, max_per_tool: int = 10):
    from app.services.agent.session import _LoopGuard

    return _LoopGuard(max_repeat=max_repeat, max_per_tool=max_per_tool)


def _session(c, *, privilege=None, interactive: bool = True):
    """A session whose driving AgentDef runs at `privilege` (default = the resolved agent's own,
    CONFIRM). `_classify_batch` reads only `self._agent.privilege`, `self._settings`,
    `self._interactive`, and `self._actions.registry` — no DB is touched by the classifier."""
    from app.services.agent.session import AgentSession

    s = c.app.state
    agent = s.settings.resolve_agent(None)
    if privilege is not None:
        agent = agent.model_copy(update={"privilege": privilege})
    return AgentSession(
        s.threads, s.messages, s.inference, s.settings, s.actions, agent, interactive=interactive
    )


def _assistant(calls: list[dict]):
    """An in-memory assistant `Message` holding `calls` as `ToolCallPart`s (no DB — classify is
    pure). Each entry: `{tool, args?, state?, invalid_raw?, call_id?}`."""
    from app.domain.conversation import Message, ToolCallPart
    from app.domain.enums import RunState

    parts = [
        ToolCallPart(
            call_id=spec.get("call_id", uuid.uuid4().hex),
            tool=spec["tool"],
            args=spec.get("args", {}),
            state=spec.get("state", RunState.PENDING),
            invalid_raw=spec.get("invalid_raw"),
        )
        for spec in calls
    ]
    return Message(thread_id="t", role="assistant", parts=parts)


class _NoArgs(BaseModel):
    pass


@contextlib.contextmanager
def _temp_tool(registry, **spec_kw):
    """Register a synthetic tool into the live registry for one test, then remove it (the registry
    is a process-global singleton shared across `create_app()` calls — a leaked synthetic tool would
    poison e.g. the deadline-policy walk)."""
    from app.core.tool import FunctionTool, ToolSpec
    from app.domain.enums import RunState
    from app.domain.result import ToolResult

    spec_kw.setdefault("input_model", _NoArgs)

    async def _noop(inp, ctx):
        return ToolResult(state=RunState.OK, summary="ok")

    spec = ToolSpec(**spec_kw)
    registry.register(FunctionTool(spec=spec, fn=_noop))
    try:
        yield spec.name
    finally:
        registry.remove(spec.name)


def _snapshot(g):
    return (
        dict(g.counts),
        dict(g.tool_counts),
        set(g.denied_sigs),
        dict(g.last_results),
        set(g.seen_results),
    )


def _sig(tool: str, args: dict) -> str:
    from app.services.agent.session import _LoopGuard

    return _LoopGuard.sig(tool, args)


# ── (a)+(d)+(e) happy path: a ≥2 read-only prefix admits + commits increments ───────────────────


def test_two_reads_form_a_parallel_prefix() -> None:
    with _workspace(), _client() as c:
        session = _session(c)  # CONFIRM
        guard = _guard()
        a = _assistant(
            [
                {"tool": "ping_host", "args": {"host_id": "x"}},
                {"tool": "ping_host", "args": {"host_id": "y"}},
            ]
        )
        plan = session._classify_batch(a, guard, {})
        assert plan.parallel is True
        assert len(plan.prefix) == 2
        assert plan.serial_from == 2
        # Commit == dispatch increments: each distinct sig +1, tool_counts ping_host = 2.
        assert guard.counts[_sig("ping_host", {"host_id": "x"})] == 1
        assert guard.counts[_sig("ping_host", {"host_id": "y"})] == 1
        assert guard.tool_counts["ping_host"] == 2


# ── the ≤1 rule: a single eligible call is NOT parallel and mutates nothing ──────────────────────


def test_single_read_is_serial_zero_mutation() -> None:
    with _workspace(), _client() as c:
        session = _session(c)
        guard = _guard()
        before = _snapshot(guard)
        plan = session._classify_batch(
            a := _assistant([{"tool": "ping_host", "args": {"host_id": "x"}}]), guard, {}
        )
        assert a.tool_calls()  # sanity: the batch had a call
        assert plan.parallel is False
        assert plan.prefix == []
        assert plan.serial_from == 0
        assert _snapshot(guard) == before  # zero guard mutation on the ≤1 path


# ── (e) decide(): a read-only+confirm builtin cuts at CONFIRM, admits at FULL ────────────────────


def test_decide_confirm_cuts_prefix_but_full_admits() -> None:
    with _workspace(), _client() as c:
        from app.domain.enums import Privilege, Risk

        with _temp_tool(
            c.app.state.actions.registry,
            name="_probe_confirm_d40",
            title="probe",
            category="builtin",
            read_only=True,
            confirm=True,
            risk=Risk.LOW,
        ):
            batch = _assistant(
                [
                    {"tool": "_probe_confirm_d40"},
                    {"tool": "ping_host", "args": {"host_id": "x"}},
                ]
            )
            # CONFIRM: decide(confirm tool) == CONFIRM → cut at index 0 → empty prefix.
            s_conf = _session(c, privilege=Privilege.CONFIRM)
            g1 = _guard()
            plan_conf = s_conf._classify_batch(batch, g1, {})
            assert plan_conf.prefix == []
            assert plan_conf.parallel is False
            # FULL: decide(confirm tool) == ALLOW → both admitted (read_only builtin, not suspending).
            s_full = _session(c, privilege=Privilege.FULL)
            g2 = _guard()
            plan_full = s_full._classify_batch(batch, g2, {})
            assert plan_full.parallel is True
            assert len(plan_full.prefix) == 2
            assert g2.tool_counts["_probe_confirm_d40"] == 1
            assert g2.tool_counts["ping_host"] == 1


# ── (d) suspending: `question` (read_only=True, suspending=True) is prefix-ineligible ────────────


def test_suspending_tool_cuts_prefix() -> None:
    with _workspace(), _client() as c:
        session = _session(c)
        # question is read_only but suspending → excluded; the two leading reads still form a prefix.
        plan = session._classify_batch(
            _assistant(
                [
                    {"tool": "ping_host", "args": {"host_id": "x"}},
                    {"tool": "ping_host", "args": {"host_id": "y"}},
                    {"tool": "question", "args": {"prompt": "?"}},
                    {"tool": "ping_host", "args": {"host_id": "z"}},
                ]
            ),
            _guard(),
            {},
        )
        assert len(plan.prefix) == 2
        assert plan.serial_from == 2
        assert plan.prefix[-1].tool == "ping_host"


def test_leading_suspending_then_read_is_short_prefix() -> None:
    # [ping, question] → tentative [ping] (len 1) → ≤1 rule → empty, zero mutation.
    with _workspace(), _client() as c:
        session = _session(c)
        guard = _guard()
        before = _snapshot(guard)
        plan = session._classify_batch(
            _assistant(
                [
                    {"tool": "ping_host", "args": {"host_id": "x"}},
                    {"tool": "question", "args": {"prompt": "?"}},
                ]
            ),
            guard,
            {},
        )
        assert plan.prefix == []
        assert _snapshot(guard) == before


# ── (c) malformed args: `invalid_raw is not None` cuts the prefix ────────────────────────────────


def test_malformed_args_cuts_prefix() -> None:
    with _workspace(), _client() as c:
        session = _session(c)
        plan = session._classify_batch(
            _assistant(
                [
                    {"tool": "ping_host", "args": {"host_id": "x"}},
                    {"tool": "ping_host", "args": {"host_id": "y"}},
                    {"tool": "ping_host", "args": {}, "invalid_raw": "{not json"},
                    {"tool": "ping_host", "args": {"host_id": "z"}},
                ]
            ),
            _guard(),
            {},
        )
        assert len(plan.prefix) == 2
        assert plan.serial_from == 2


def test_empty_string_args_are_admissible() -> None:
    # `invalid_raw is None` (the empty-string legacy zero-arg path) → admissible.
    with _workspace(), _client() as c:
        session = _session(c)
        plan = session._classify_batch(
            _assistant(
                [
                    {"tool": "ping_host", "args": {"host_id": "x"}, "invalid_raw": None},
                    {"tool": "ping_host", "args": {"host_id": "y"}, "invalid_raw": None},
                ]
            ),
            _guard(),
            {},
        )
        assert plan.parallel is True


# ── (d) idempotent mutators are NEVER admitted, at ANY privilege incl. FULL ──────────────────────


def test_idempotent_mutator_never_admitted() -> None:
    from app.domain.enums import Privilege

    with _workspace(), _client() as c:
        # start_service (LOW, idempotent, NOT read_only) and shutdown_host (HIGH, confirm, idempotent,
        # NOT read_only) must never enter the prefix — decide would ALLOW start_service at CONFIRM and
        # shutdown_host at FULL, but read_only is the gate and idempotent grants nothing.
        registry = c.app.state.actions.registry
        assert registry.get("start_service").spec.read_only is False
        assert registry.get("shutdown_host").spec.read_only is False
        for priv in (Privilege.CONFIRM, Privilege.AUTO_LOW, Privilege.FULL):
            session = _session(c, privilege=priv)
            # leading mutator → break at index 0 → empty prefix at every privilege.
            for mutator in ("start_service", "shutdown_host"):
                guard = _guard()
                before = _snapshot(guard)
                plan = session._classify_batch(
                    _assistant(
                        [
                            {"tool": mutator, "args": {"service_id": "s"}},
                            {"tool": "ping_host", "args": {"host_id": "x"}},
                            {"tool": "ping_host", "args": {"host_id": "y"}},
                        ]
                    ),
                    guard,
                    {},
                )
                assert plan.prefix == [], f"{mutator} admitted at {priv}"
                assert _snapshot(guard) == before
            # and a mutator MID-batch only cuts the tail, never enters the prefix.
            guard = _guard()
            plan = session._classify_batch(
                _assistant(
                    [
                        {"tool": "ping_host", "args": {"host_id": "x"}},
                        {"tool": "ping_host", "args": {"host_id": "y"}},
                        {"tool": "start_service", "args": {"service_id": "s"}},
                        {"tool": "ping_host", "args": {"host_id": "z"}},
                    ]
                ),
                guard,
                {},
            )
            assert [p.tool for p in plan.prefix] == ["ping_host", "ping_host"]
            assert plan.serial_from == 2


# ── (d) MCP/OpenAPI-derived read-only tools are prefix-ineligible (advisory flags) ───────────────


def test_mcp_derived_read_only_excluded() -> None:
    from app.domain.enums import Risk

    with _workspace(), _client() as c:
        session = _session(c)
        with _temp_tool(
            c.app.state.actions.registry,
            name="mcp:test:probe",
            title="mcp probe",
            category="mcp",  # the builtin-vs-derived discriminator
            read_only=True,  # advisory (derived) → NOT trusted for ordering
            risk=Risk.LOW,
        ) as mcp_name:
            # leading mcp read-only → break at 0 → empty prefix.
            g1 = _guard()
            before = _snapshot(g1)
            p1 = session._classify_batch(
                _assistant(
                    [
                        {"tool": mcp_name},
                        {"tool": "ping_host", "args": {"host_id": "x"}},
                    ]
                ),
                g1,
                {},
            )
            assert p1.prefix == []
            assert _snapshot(g1) == before
            # mid-batch mcp read-only → cuts the tail; leading builtin reads still form a prefix.
            g2 = _guard()
            p2 = session._classify_batch(
                _assistant(
                    [
                        {"tool": "ping_host", "args": {"host_id": "x"}},
                        {"tool": "ping_host", "args": {"host_id": "y"}},
                        {"tool": mcp_name},
                    ]
                ),
                g2,
                {},
            )
            assert len(p2.prefix) == 2
            assert p2.serial_from == 2


# ── (b) repeat-cap on COUNTS ALONE (overlay), independent of last_results ────────────────────────


def test_repeat_cap_on_counts_via_overlay() -> None:
    with _workspace(), _client() as c:
        session = _session(c)
        guard = _guard(max_repeat=2)  # third identical call must be cut
        # Same tool+args three times → one sig; overlay drives the mid-walk cap without last_results.
        plan = session._classify_batch(
            _assistant(
                [
                    {"tool": "ping_host", "args": {"host_id": "x"}},
                    {"tool": "ping_host", "args": {"host_id": "x"}},
                    {"tool": "ping_host", "args": {"host_id": "x"}},
                ]
            ),
            guard,
            {},
        )
        assert len(plan.prefix) == 2
        assert plan.serial_from == 2
        # Exactly two increments committed (not three) — classify read counts only, never last_results.
        assert guard.counts[_sig("ping_host", {"host_id": "x"})] == 2
        assert guard.last_results == {}  # never touched at classify


def test_repeat_cap_seeded_from_prior_guard_counts() -> None:
    with _workspace(), _client() as c:
        session = _session(c)
        guard = _guard(max_repeat=2)
        sig = _sig("ping_host", {"host_id": "x"})
        guard.counts[sig] = 1  # one prior execution this turn (no last_results needed at classify)
        # base 1 + one tentative = 2 → the second identical call is cut (overlay+base).
        plan = session._classify_batch(
            _assistant(
                [
                    {"tool": "ping_host", "args": {"host_id": "x"}},
                    {"tool": "ping_host", "args": {"host_id": "x"}},
                    {"tool": "ping_host", "args": {"host_id": "y"}},
                ]
            ),
            guard,
            {},
        )
        # Only [ping x] admits before the cap trips → tentative len 1 → ≤1 rule → empty, zero mutation.
        assert plan.prefix == []
        assert guard.counts[sig] == 1  # unchanged (no commit on the ≤1 path)


# ── (b) per-tool cap: exactly `cap` admitted, the rest are the serial tail ───────────────────────


def test_per_tool_cap_bounds_the_prefix() -> None:
    with _workspace(), _client() as c:
        session = _session(c)
        cap = 3
        guard = _guard(max_repeat=10, max_per_tool=cap)  # distinct args → repeat-cap can't fire first
        calls = [{"tool": "ping_host", "args": {"host_id": f"h{i}"}} for i in range(cap + 2)]
        plan = session._classify_batch(_assistant(calls), guard, {})
        assert len(plan.prefix) == cap
        assert plan.serial_from == cap
        assert guard.tool_counts["ping_host"] == cap


# ── (b) denied_sigs blocks admission ─────────────────────────────────────────────────────────────


def test_denied_sig_blocks_admission() -> None:
    with _workspace(), _client() as c:
        session = _session(c)
        guard = _guard()
        guard.denied_sigs.add(_sig("ping_host", {"host_id": "d"}))
        # mid-batch denied call cuts the tail; leading reads form the prefix.
        p1 = session._classify_batch(
            _assistant(
                [
                    {"tool": "ping_host", "args": {"host_id": "x"}},
                    {"tool": "ping_host", "args": {"host_id": "y"}},
                    {"tool": "ping_host", "args": {"host_id": "d"}},
                ]
            ),
            guard,
            {},
        )
        assert len(p1.prefix) == 2
        assert p1.serial_from == 2
        # leading denied call → empty prefix, zero mutation.
        guard2 = _guard()
        guard2.denied_sigs.add(_sig("ping_host", {"host_id": "d"}))
        before = _snapshot(guard2)
        p2 = session._classify_batch(
            _assistant(
                [
                    {"tool": "ping_host", "args": {"host_id": "d"}},
                    {"tool": "ping_host", "args": {"host_id": "x"}},
                ]
            ),
            guard2,
            {},
        )
        assert p2.prefix == []
        assert _snapshot(guard2) == before


# ── (a) resume batch → empty prefix (resolved leaders / token / injected answer) ─────────────────


def test_resume_batch_is_serial() -> None:
    from app.domain.enums import RunState

    with _workspace(), _client() as c:
        session = _session(c)
        # A resolved leading call → break at index 0 → empty prefix.
        g1 = _guard()
        before1 = _snapshot(g1)
        p1 = session._classify_batch(
            _assistant(
                [
                    {"tool": "ping_host", "args": {"host_id": "x"}, "state": RunState.OK},
                    {"tool": "ping_host", "args": {"host_id": "y"}},
                ]
            ),
            g1,
            {},
        )
        assert p1.prefix == []
        assert _snapshot(g1) == before1
        # A fresh leading call whose call_id carries a resume token → not fresh → empty prefix.
        resumed_id = uuid.uuid4().hex
        g2 = _guard()
        p2 = session._classify_batch(
            _assistant(
                [
                    {"tool": "ping_host", "args": {"host_id": "x"}, "call_id": resumed_id},
                    {"tool": "ping_host", "args": {"host_id": "y"}},
                ]
            ),
            g2,
            {resumed_id: "some-token"},
        )
        assert p2.prefix == []
        # A leading call with an injected resume answer → not fresh → empty prefix.
        ans_id = uuid.uuid4().hex
        g3 = _guard()
        p3 = session._classify_batch(
            _assistant(
                [
                    {"tool": "question", "args": {"prompt": "?"}, "call_id": ans_id},
                    {"tool": "ping_host", "args": {"host_id": "y"}},
                ]
            ),
            g3,
            {},
            {ans_id: "the answer"},
        )
        assert p3.prefix == []


# ── run_shell is never admitted (not read_only) ──────────────────────────────────────────────────


def test_run_shell_never_admitted() -> None:
    from app.domain.enums import Privilege

    with _workspace(), _client() as c:
        registry = c.app.state.actions.registry
        assert registry.get("run_shell").spec.read_only is False  # the real spec, load-bearing
        session = _session(c, privilege=Privilege.FULL)  # even at FULL where decide would ALLOW it
        plan = session._classify_batch(
            _assistant(
                [
                    {"tool": "run_shell", "args": {"command": "ls"}},
                    {"tool": "ping_host", "args": {"host_id": "x"}},
                    {"tool": "ping_host", "args": {"host_id": "y"}},
                ]
            ),
            _guard(),
            {},
        )
        assert plan.prefix == []  # run_shell (not read_only) cuts at index 0


# ── unknown tool cuts the prefix ─────────────────────────────────────────────────────────────────


def test_unknown_tool_cuts_prefix() -> None:
    with _workspace(), _client() as c:
        session = _session(c)
        plan = session._classify_batch(
            _assistant(
                [
                    {"tool": "ping_host", "args": {"host_id": "x"}},
                    {"tool": "ping_host", "args": {"host_id": "y"}},
                    {"tool": "definitely_not_a_tool_xyz"},
                ]
            ),
            _guard(),
            {},
        )
        assert len(plan.prefix) == 2
        assert plan.serial_from == 2
