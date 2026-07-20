"""Slice 8 / D44 W2 — the server-side grant path (`execute_always` + `always_eligible`).

Covers the resume verb that persists an args-EXACT 'always allow' rule and the eligibility flag the
FE reads (SLICE8_PLAN §4, §7 invariants, §9). Layers, no live LLM / no real config.yaml:

  1. rule shape   — `runtime.grant_approval` builds the full-field, null-pinned, glob-escaped rule
                    and persists it through the ONE settings write machinery (`apply_settings_patch`).
  2. eligibility  — `ActionService.approval_eligible` + the `alwaysEligible` field on the emitted
                    `tool.permission` event (scalar → true, non-scalar → false).
  3. grant path   — `session.resume(..., "execute_always")` runs the call AND persists the rule, a
                    subsequent identical invoke auto-allows WITH the W1 marker, idempotent double-tap,
                    a write failure still executes (note in summary), plain execute/dismiss unchanged.

Fixtures follow `test_confirm_recovery_j3.py` (temp-config `_workspace` + a persisted pending confirm
call). CTRLB_CONFIG/CTRLB_DB temp paths only — never the real config.yaml.
"""

from __future__ import annotations

import contextlib
import os
import tempfile
import uuid
from pathlib import Path

from _async import drain_run_calls, run_async


def _client():
    from fastapi.testclient import TestClient

    from app.main import create_app

    return TestClient(create_app())


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


def _run(coro):
    return run_async(coro)


async def _collect(agen):
    return [e async for e in agen]


def _guard():
    from app.services.agent.session import _LoopGuard

    return _LoopGuard(max_repeat=5, max_per_tool=10)


def _grant(app, tool, args):
    from app.runtime import grant_approval

    return _run(grant_approval(app, tool, args))


def _approvals(app, tool):
    """The LIVE persisted rules for `tool` (the shared `app.state.settings`), or []."""
    override = app.state.settings.tool_overrides.get(tool)
    return list(override.approvals) if override and override.approvals else []


def _session_and_pending(c, tool: str, args: dict, *, interactive: bool = True):
    """Session + a persisted assistant message holding one PENDING call for `tool`/`args`."""
    from app.domain.conversation import Message, Thread, ToolCallPart
    from app.domain.enums import Actor, RunState
    from app.services.agent.session import AgentSession

    s = c.app.state
    agent = s.settings.resolve_agent(None)  # default privilege = CONFIRM → med/high suspends
    session = AgentSession(
        s.threads, s.messages, s.inference, s.settings, s.actions, agent, interactive=interactive
    )
    thread = _run(s.threads.create(Thread()))
    call_id = uuid.uuid4().hex
    assistant = Message(
        thread_id=thread.id,
        role="assistant",
        actor=Actor.AGENT,
        agent="default",
        parts=[ToolCallPart(call_id=call_id, tool=tool, args=args, state=RunState.PENDING)],
    )
    _run(s.messages.add(assistant))
    return session, thread, assistant, call_id


# ── rule shape: full-field pin, null optional, canonical scalars, glob-escape ──────────────────
def test_grant_pins_every_field_null_optional_and_canonical_scalars() -> None:
    """`web_search` (query:str, count:int=5, categories:str|None=None) — the grant pins ALL THREE:
    the omitted optional as "null", the int in canonical form, so the rule is args-EXACT (§7 inv 5)."""
    from app.core.permissions import NONE_CANON

    with _workspace(), _client() as c:
        note = _grant(c.app, "web_search", {"query": "homelab"})
        assert note is None  # success → no breadcrumb
        rules = _approvals(c.app, "web_search")
        assert len(rules) == 1
        assert rules[0].args == {"query": "homelab", "count": "5", "categories": NONE_CANON}


def test_grant_rule_is_persisted_to_yaml() -> None:
    with _workspace() as tmp, _client() as c:
        _grant(c.app, "web_search", {"query": "hi"})
        text = (tmp / "config.yaml").read_text(encoding="utf-8")
        assert "tool_overrides" in text and "approvals" in text and "web_search" in text


def test_none_sentinel_survives_the_yaml_round_trip() -> None:
    """MED-2, the hard requirement: the None sentinel is only sound if it round-trips through the REAL
    writer + loader. Grant `web_search {"query":"x"}` (which pins the omitted `categories` optional),
    re-load `Settings` from the written FILE, and assert the reloaded rule still matches that same call
    — and still does NOT match the literal-string `"null"` call that used to collide with it."""
    from app.config import load_settings
    from app.core.permissions import NONE_CANON, approval_match

    with _workspace() as tmp, _client() as c:
        assert _grant(c.app, "web_search", {"query": "x"}) is None
        text = (tmp / "config.yaml").read_text(encoding="utf-8")
        assert "\x00" not in text  # the writer escapes it rather than emitting a raw NUL byte

        reloaded = load_settings().tool_overrides["web_search"].approvals  # from the FILE, not memory
        assert reloaded is not None and len(reloaded) == 1
        assert reloaded[0].args["categories"] == NONE_CANON  # byte-identical after the round-trip

        model = c.app.state.actions.registry.get("web_search").spec.input_model
        omitted = model.model_validate({"query": "x"}).model_dump(mode="json")
        literal = model.model_validate({"query": "x", "categories": "null"}).model_dump(mode="json")
        assert approval_match(reloaded, omitted) is not None  # the grant still fires post-reload
        assert approval_match(reloaded, literal) is None  # …and stays exact


def test_grant_glob_escapes_pattern_values() -> None:
    """A value containing `*` is glob-escaped, so the rule matches that LITERAL string, not a wildcard."""
    from app.core.permissions import approval_match, glob_escape

    with _workspace(), _client() as c:
        _grant(c.app, "web_search", {"query": "a*b"})
        rule = _approvals(c.app, "web_search")[0]
        assert rule.args["query"] == glob_escape("a*b")  # bracketed, not a raw `*`
        exact = {"query": "a*b", "count": 5, "categories": None}
        wild = {"query": "axb", "count": 5, "categories": None}
        assert approval_match([rule], exact) is rule  # the literal string matches
        assert approval_match([rule], wild) is None  # `*` did NOT act as a wildcard


def test_grant_is_idempotent_no_duplicate() -> None:
    with _workspace(), _client() as c:
        assert _grant(c.app, "web_search", {"query": "x"}) is None
        assert _grant(c.app, "web_search", {"query": "x"}) is None  # identical double-tap
        assert len(_approvals(c.app, "web_search")) == 1  # no duplicate rule


def test_grant_inexpressible_args_returns_note_and_writes_nothing() -> None:
    """`spawn_subagents.tasks` is a required LIST → non-scalar → the rule is inexpressible: skip the
    write, return the breadcrumb note (defense in depth behind the FE's `always_eligible`)."""
    from app.runtime import _GRANT_INEXPRESSIBLE_NOTE

    with _workspace(), _client() as c:
        note = _grant(c.app, "spawn_subagents", {"tasks": [{"task": "do a thing"}]})
        assert note == _GRANT_INEXPRESSIBLE_NOTE
        assert c.app.state.settings.tool_overrides.get("spawn_subagents") is None  # nothing persisted


# ── eligibility: approval_eligible + the alwaysEligible event field ─────────────────────────────
def test_approval_eligible_scalar_true_nonscalar_false() -> None:
    with _workspace(), _client() as c:
        actions = c.app.state.actions
        assert actions.approval_eligible("restart_service", {"service_id": "ghost"}) is True
        assert actions.approval_eligible("web_search", {"query": "hi"}) is True  # null/int still scalar
        assert actions.approval_eligible("spawn_subagents", {"tasks": [{"task": "x"}]}) is False


def test_approval_eligible_false_for_confirm_pinned_tool_even_with_scalar_args() -> None:
    """W3 §1: a designer-pinned forced-confirm tool (`shutdown_host`, `confirm=True`) is un-approvable
    (R1, invariant 2) — a grant there writes a rule `invoke` never consults. Eligibility must be False
    EVEN THOUGH its args (`host_id: str`) are perfectly scalar/expressible, so the FE hides the affordance."""
    with _workspace(), _client() as c:
        actions = c.app.state.actions
        from app.core.permissions import exact_arg_pins

        model = actions.registry.get("shutdown_host").spec.input_model
        pins = exact_arg_pins(model.model_validate({"host_id": "corsair"}).model_dump(mode="json"))
        assert pins is not None  # the rule WOULD be expressible …
        assert actions.approval_eligible("shutdown_host", {"host_id": "corsair"}) is False  # … but it's inert


def test_permission_event_carries_always_eligible_true_for_scalar_call() -> None:
    with _workspace(), _client() as c:
        session, thread, assistant, _ = _session_and_pending(c, "restart_service", {"service_id": "ghost"})
        events, suspended, _ = drain_run_calls(session, thread, assistant, {}, _guard())
        assert suspended
        perm = next(e for e in events if e.event == "tool.permission")
        assert perm.data["alwaysEligible"] is True


def test_permission_event_carries_always_eligible_false_for_nonscalar_call() -> None:
    with _workspace(), _client() as c:
        session, thread, assistant, _ = _session_and_pending(c, "spawn_subagents", {"tasks": [{"task": "x"}]})
        events, suspended, _ = drain_run_calls(session, thread, assistant, {}, _guard())
        assert suspended
        perm = next(e for e in events if e.event == "tool.permission")
        assert perm.data["alwaysEligible"] is False


# ── the grant path through resume: execute_always runs + persists, subsequent invoke auto-allows ──
def test_execute_always_runs_and_persists_then_subsequent_invoke_auto_allows_with_marker() -> None:
    from app.domain.enums import Actor, Privilege

    with _workspace(), _client() as c:
        args = {"service_id": "ghost"}
        session, thread, assistant, cid = _session_and_pending(c, "restart_service", args)
        _, suspended, _ = drain_run_calls(session, thread, assistant, {}, _guard())
        assert suspended  # MED @ CONFIRM suspended

        events = _run(_collect(session.resume(thread, cid, "execute_always", app=c.app)))
        assert any(e.event == "tool.result" for e in events)  # it RAN
        assert not any(e.event == "tool.permission" for e in events)  # did NOT re-suspend

        rules = _approvals(c.app, "restart_service")  # the grant persisted
        assert len(rules) == 1 and rules[0].args == {"service_id": "ghost"}

        # A SUBSEQUENT identical invoke now auto-allows (no confirm) and stamps the W1 audit marker.
        out = _run(
            c.app.state.actions.invoke(
                "restart_service", args, actor=Actor.AGENT, privilege=Privilege.CONFIRM
            )
        )
        assert not out.needs_confirm
        assert out.event is not None and "[auto-allowed: service_id=ghost]" in out.event.summary


def test_plain_execute_does_not_persist_any_rule() -> None:
    """`execute` (not `execute_always`) is byte-identical to before — it runs but writes NO grant,
    even with `app` threaded through."""
    with _workspace(), _client() as c:
        session, thread, assistant, cid = _session_and_pending(c, "restart_service", {"service_id": "x"})
        drain_run_calls(session, thread, assistant, {}, _guard())
        events = _run(_collect(session.resume(thread, cid, "execute", app=c.app)))
        assert any(e.event == "tool.result" for e in events)  # ran
        assert _approvals(c.app, "restart_service") == []  # no grant written


def test_dismiss_unchanged_and_writes_nothing() -> None:
    with _workspace(), _client() as c:
        session, thread, assistant, cid = _session_and_pending(c, "restart_service", {"service_id": "x"})
        drain_run_calls(session, thread, assistant, {}, _guard())
        events = _run(_collect(session.resume(thread, cid, "dismiss", app=c.app)))
        assert not any(e.event == "tool.permission" for e in events)  # stayed dismissed
        assert _approvals(c.app, "restart_service") == []


def test_write_failure_still_executes_and_notes_it_in_summary() -> None:
    """A persist failure must NOT block the run (owner intent is primary): the call executes and the
    breadcrumb note lands on THIS call's result summary. Proves the resume→_run_calls note threading."""
    import app.runtime as runtime_mod
    from app.runtime import _GRANT_WRITE_FAILED_NOTE

    with _workspace(), _client() as c:
        session, thread, assistant, cid = _session_and_pending(c, "restart_service", {"service_id": "x"})
        drain_run_calls(session, thread, assistant, {}, _guard())

        orig = runtime_mod.apply_settings_patch

        async def _boom(*a, **k):
            raise RuntimeError("disk full")

        runtime_mod.apply_settings_patch = _boom
        try:
            events = _run(_collect(session.resume(thread, cid, "execute_always", app=c.app)))
        finally:
            runtime_mod.apply_settings_patch = orig

        result_ev = next(e for e in events if e.event == "tool.result")  # it RAN despite the failure
        assert _GRANT_WRITE_FAILED_NOTE in result_ev.data["result"]["summary"]
        assert _approvals(c.app, "restart_service") == []  # nothing persisted

        # LOW-3: the breadcrumb must reach the AUDIT LOG too, not just the SSE stream — it's threaded
        # into `invoke` so the Event carries it. (It was appended post-hoc before, leaving an audit
        # reader with no trace that a grant had failed.)
        events_rows = _run(c.app.state.events.recent(limit=10))
        row = next(e for e in events_rows if e.action == "restart_service")
        assert _GRANT_WRITE_FAILED_NOTE in row.summary


# ── post-audit: the §9 promises that shipped untested ──────────────────────────────────────────
def test_grant_survives_a_concurrent_settings_write() -> None:
    """§9/LOW-2: the grant append and a settings PUT are two read-modify-write sequences over the SAME
    live config — run concurrently through the ONE `settings_write_lock`, neither may lose the other's
    change (in memory OR on disk). `reconfigure` (the only await inside a critical section, hence the
    only place a second writer could slip in) is wrapped to record its enter/exit order and to yield
    the loop while "inside": under the shared lock the two sequences MUST NOT overlap, and the test
    fails if they do — the read-modify-write is only atomic while it is exclusive."""
    import asyncio

    import app.runtime as runtime_mod
    from app.runtime import apply_settings_patch, grant_approval, settings_write_lock

    with _workspace() as tmp, _client() as c:
        trace: list[str] = []
        orig = runtime_mod.reconfigure

        async def _traced(app, new):
            trace.append("enter")
            await asyncio.sleep(0)  # a real suspension point mid-sequence
            await orig(app, new)
            trace.append("exit")

        async def _put():  # the PUT /api/settings body, minus the HTTP layer
            async with settings_write_lock:
                await apply_settings_patch(c.app, {"agent": {"max_steps": 9}})

        async def _both():
            return await asyncio.gather(grant_approval(c.app, "web_search", {"query": "race"}), _put())

        runtime_mod.reconfigure = _traced
        try:
            note, _ = _run(_both())
        finally:
            runtime_mod.reconfigure = orig
        assert note is None
        assert trace == ["enter", "exit", "enter", "exit"]  # serialized, never interleaved

        rules = _approvals(c.app, "web_search")  # the grant survived the interleaving …
        assert len(rules) == 1 and rules[0].args["query"] == "race"
        assert c.app.state.settings.agent.max_steps == 9  # … and so did the PUT
        text = (tmp / "config.yaml").read_text(encoding="utf-8")
        assert "approvals" in text and "max_steps: 9" in text  # both landed on disk


def test_grant_still_succeeds_while_a_turn_is_live() -> None:
    """SYS-3/ACA-17 exemption guard: the turn gate that refuses a `tool_overrides` PUT (409) lives in
    the `PUT /api/settings` HANDLER only. `grant_approval` is called BY the resume path DURING a live
    turn, by design — it must keep working with a marker held. If someone ever hoists that gate down
    into `apply_settings_patch`/`reconfigure`, this test fails and 'always allow' is broken."""
    with _workspace() as tmp, _client() as c:
        from app.services.agent.turns import reserve

        reserve(c.app.state.turns, "some-thread", "chat")  # a live turn, as during a resume
        # the HTTP path is refused …
        r = c.put("/api/settings", json={"tool_overrides": {"web_search": {"description": "x"}}})
        assert r.status_code == 409, r.text
        # … while the grant path goes straight through and persists.
        assert _grant(c.app, "web_search", {"query": "granted-mid-turn"}) is None
        rules = _approvals(c.app, "web_search")
        assert len(rules) == 1 and rules[0].args["query"] == "granted-mid-turn"
        assert "approvals" in (tmp / "config.yaml").read_text(encoding="utf-8")


def test_grant_preserves_sibling_override_fields() -> None:
    """§9: `approvals` is the THIRD dimension on the unified per-tool object — a grant must append to
    it without disturbing the `description`/`agent_mode` siblings (in memory or in the file)."""
    cfg = (
        "server:\n  port: 5433\n"
        "tool_overrides:\n"
        "  restart_service:\n"
        "    description: my own words\n"
        "    agent_mode: enabled\n"
    )
    with _workspace(cfg) as tmp, _client() as c:
        assert _grant(c.app, "restart_service", {"service_id": "ghost"}) is None
        override = c.app.state.settings.tool_overrides["restart_service"]
        assert override.description == "my own words"
        assert str(override.agent_mode) == "enabled"
        assert override.approvals and override.approvals[0].args == {"service_id": "ghost"}
        text = (tmp / "config.yaml").read_text(encoding="utf-8")
        assert "my own words" in text and "agent_mode: enabled" in text


def test_marker_stamped_on_a_headless_subagent_run() -> None:
    """§9/D44 §6: the audit marker is the SOLE visibility on the interactive→headless crossing — a
    bubble-born grant auto-allows a HEADLESS subagent's re-run of the matched call, and that run must
    carry the marker too (only the interactive path was asserted before)."""
    from app.config import ApprovalRule, ToolOverride

    with _workspace(), _client() as c:
        args = {"service_id": "ghost"}
        c.app.state.settings.tool_overrides["restart_service"] = ToolOverride(
            approvals=[ApprovalRule(args={"service_id": "ghost"})]
        )
        session, thread, assistant, _ = _session_and_pending(c, "restart_service", args, interactive=False)
        events, suspended, _ = drain_run_calls(session, thread, assistant, {}, _guard())
        assert not suspended  # the approval downgraded the confirm — no headless DENIED conversion
        result_ev = next(e for e in events if e.event == "tool.result")
        assert "[auto-allowed: service_id=ghost]" in result_ev.data["result"]["summary"]
        rows = _run(c.app.state.events.recent(limit=10))
        assert "[auto-allowed: service_id=ghost]" in rows[0].summary  # …and in the audit row


if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    for fn in fns:
        fn()
        print(f"ok  {fn.__name__}")
    print(f"\n{len(fns)} passed")
