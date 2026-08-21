"""A3 slice 4 (14d) — the agent-facing automation tools + the run-terminal audit frame (§D-5).

Slice 3 gave the OWNER a REST surface and a Conf editor; this slice gives the MODEL two tools over the
exact same write service, and makes a finished run announce itself. What's pinned here:

  1. The specs   — `create_automation` is confirm-gated MED, agent-only, not core; `list_automations`
                   is a LOW read-only sibling. Both are registered from the one builtin module.
  2. The guard   — a NON-INTERACTIVE context is DENIED before anything is validated, for an automation
                   run AND for an ordinary chat-spawned subagent alike: interactivity is the predicate
                   (council R-3), so the check is not fooled by an origin that says `subagent`.
  3. The write   — a confirmed create lands through `AutomationService` (one writer): the row is armed
                   with a future slot, and every refusal — cap, cron, zone, missing agent,
                   whitespace-only name — comes back as a FAILED result carrying the service's own
                   message, never as an exception.
  4. The card    — the created record rides `result.data["automation"]` in the shape the chat bubble
                   renders (id · name · human schedule · tz · next fire · mode · enabled · agent).
  5. The listing — works HEADLESS (no gate), reads the shared repo, and says something useful about an
                   empty roster.
  6. The frame   — every terminal run records ONE `automation_run` Event with the run's own state, so
                   the F1 `automation_done` notification and the Conf list's live invalidation have a
                   frame to key on (the FE predicate is `action == "automation_run"` + a run id).

Runs as `python tests/test_automation_tools_14d.py` from backend/ or under pytest. Every test works in
an isolated `$CTRLB_HOME`/`CTRLB_CONFIG`/`CTRLB_DB` temp workspace — the real config/db are never
touched.
"""

from __future__ import annotations

import contextlib
import os
import tempfile
from pathlib import Path

from _async import run_async


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


def _svc(c):
    return c.app.state.automation_service


def _ctx(c, *, interactive: bool = True, origin=None, depth: int = 0):
    """An `InvocationContext` on the live app's `Deps` — the same world a real invocation gets."""
    from app.core.tool import InvocationContext
    from app.domain.enums import Actor, Privilege

    return InvocationContext(
        actor=Actor.AGENT,
        privilege=Privilege.FULL,  # FULL on purpose: the gate auto-allows confirms here (R-2), so the
        # in-tool guard is the ONLY thing standing between an unattended run and a new automation.
        deps=c.app.state.deps,
        interactive=interactive,
        depth=depth,
        **({"origin": origin} if origin is not None else {}),
    )


def _create(c, ctx=None, **kw):
    from app.services.agent.automation_tools import CreateAutomationInput, create_automation

    base = {"name": "nightly", "schedule": "0 3 * * *", "prompt": "check the fleet", "tz": "UTC"}
    return _run(create_automation(CreateAutomationInput(**{**base, **kw}), ctx or _ctx(c)))


def _list(c, ctx=None):
    from app.services.agent.automation_tools import ListAutomationsInput, list_automations

    return _run(list_automations(ListAutomationsInput(), ctx or _ctx(c)))


# ── 1. the specs ────────────────────────────────────────────────────────────────────────────────


def test_both_tools_register_with_the_specs_the_design_names() -> None:
    """§D-5's spec line, pinned: create is a confirm-gated MED builtin the UI never shows and no agent
    gets for free; list is its LOW read-only sibling (and therefore parallel-dispatch eligible)."""
    from app.services.actions import build_registry

    reg = build_registry()
    create = reg.get("create_automation").spec
    assert create.category == "builtin" and create.risk.value == "med"
    assert create.confirm is True and create.read_only is False
    assert create.ui_exposed is False and create.core is False and create.agent_exposed is True

    listing = reg.get("list_automations").spec
    assert listing.risk.value == "low" and listing.read_only is True
    assert listing.confirm is False and listing.ui_exposed is False and listing.core is False


def test_the_input_bounds_mirror_the_shared_write_shape() -> None:
    """The tool's own bounds exist so an over-long field fails at the INPUT model — the loop's repair
    path — instead of raising a pydantic error out of the draft construction. They must therefore be the
    draft's bounds, not a second opinion about them."""
    from pydantic import ValidationError

    from app.domain.automation import AutomationDraft
    from app.services.agent.automation_tools import (
        MAX_NAME_CHARS,
        MAX_SCHEDULE_CHARS,
        CreateAutomationInput,
    )

    fields = AutomationDraft.model_fields
    assert MAX_NAME_CHARS == next(m.max_length for m in fields["name"].metadata if hasattr(m, "max_length"))
    assert MAX_SCHEDULE_CHARS == next(
        m.max_length for m in fields["schedule"].metadata if hasattr(m, "max_length")
    )
    for over in ({"name": "x" * (MAX_NAME_CHARS + 1)}, {"schedule": "x" * (MAX_SCHEDULE_CHARS + 1)}):
        try:
            CreateAutomationInput(**{"name": "n", "schedule": "0 3 * * *", "prompt": "p", **over})
        except ValidationError:
            continue
        raise AssertionError(f"{over} should have been refused at the input model")


# ── 2. the recursion guard ──────────────────────────────────────────────────────────────────────


def test_a_non_interactive_context_is_denied_however_it_got_there() -> None:
    """Council R-3: the guard keys on INTERACTIVITY, not ancestry. An automation run and an ordinary
    chat-spawned subagent are both refused — neither has a live owner to confirm a record that will run
    the agent again unattended — and the refusal happens BEFORE any validation, so the reason it gives
    is the real one."""
    from app.domain.event import Origin

    with _workspace(), _client() as c:
        for origin in (
            Origin(kind="automation", id="a1", run_id="r1"),
            Origin(kind="subagent", id="researcher"),  # a plain chat subagent: no run id anywhere
        ):
            res = _create(c, _ctx(c, interactive=False, origin=origin, depth=1))
            assert res.state.value == "denied", origin
            assert "live owner" in res.summary and "automation runs or subagents" in res.summary
        assert _run(c.app.state.automations.list()) == []  # nothing was written on either path

        # …and the refusal is not about the ARGUMENTS: the same nonsense schedule that would be a 422
        # from an interactive caller still reads as the guard's denial.
        denied = _create(c, _ctx(c, interactive=False), schedule="not a cron")
        assert denied.state.value == "denied" and "live owner" in denied.summary


def _headless_turn(c, *, privilege, origin, tool: str, args: dict):
    """Drive ONE tool call through a real headless `AgentSession` at `privilege` — the whole gate +
    conversion path, not a hand-built context. Returns `(events, suspended)`."""
    import uuid

    from _async import drain_run_calls
    from test_automations_14b import _guard

    from app.domain.conversation import Message, Thread, ToolCallPart
    from app.domain.enums import Actor, RunState
    from app.services.agent.session import AgentSession

    state = c.app.state
    agent = state.settings.resolve_agent(None).model_copy(update={"privilege": privilege})
    session = AgentSession(
        state.threads,
        state.messages,
        state.inference,
        state.settings,
        state.actions,
        agent,
        interactive=False,
        origin=origin,
    )
    thread = _run(state.threads.create(Thread()))
    assistant = Message(
        thread_id=thread.id,
        role="assistant",
        actor=Actor.AGENT,
        agent="default",
        parts=[ToolCallPart(call_id=uuid.uuid4().hex, tool=tool, args=args, state=RunState.PENDING)],
    )
    _run(state.messages.add(assistant))
    events, suspended, _ = drain_run_calls(session, thread, assistant, {}, _guard())
    return events, suspended


def test_an_unattended_create_is_refused_at_every_privilege_and_always_audited() -> None:
    """The two headless refusal paths, through the REAL gate — and both must leave an audit row
    (post-14d review, MED).

    * Below FULL the gate answers `needs_confirm`, and the SESSION converts that into a denial because
      no owner can ever answer it. `invoke` records nothing for a suspend (correctly — the call may
      still be allowed), so before the fix an unattended run's blocked tool calls existed ONLY in its
      transcript: invisible to the event log and to the `action_failed` notification that is the one
      channel telling the owner their run was stopped.
    * At FULL the gate auto-allows the confirm (council R-2), the call ENTERS the tool, and the in-tool
      guard denies it there — already audited by `invoke`, and pinned here so the two paths can't
      diverge silently.

    Either way: no automation is written, the turn does not suspend, and the row carries the run's own
    attribution.
    """
    from app.domain.enums import Privilege
    from app.domain.event import Origin

    origin = Origin(kind="automation", id="a1", run_id="r1")
    args = {"name": "nightly", "schedule": "0 3 * * *", "prompt": "check the fleet", "tz": "UTC"}
    # (privilege, the `decision` the audit row must carry, what the summary has to mention)
    cases = (
        (Privilege.CONFIRM, "policy", "needs confirmation"),
        (Privilege.AUTO_LOW, "policy", "needs confirmation"),
        (Privilege.FULL, "auto", "live owner"),
    )
    for privilege, decision, needle in cases:
        with _workspace(), _client() as c:
            events, suspended = _headless_turn(
                c, privilege=privilege, origin=origin, tool="create_automation", args=args
            )
            result = next(e for e in events if e.event == "tool.result").data["result"]
            assert not suspended, privilege  # an unattended turn must never park on a confirm bubble
            assert result["state"] == "denied", (privilege, result)
            assert needle in result["summary"], (privilege, result["summary"])
            assert _run(c.app.state.automations.list()) == [], privilege

            audit = [e for e in _run(c.app.state.events.recent(20)) if e.action == "create_automation"]
            assert len(audit) == 1, (privilege, [e.summary for e in audit])
            row = audit[0]
            assert row.status.value == "denied" and row.decision == decision, privilege
            assert (row.origin, row.origin_id, row.run_id) == ("automation", "a1", "r1"), privilege
            assert row.actor.value == "agent", privilege


def test_the_headless_denial_audit_covers_confirm_tools_generally() -> None:
    """The chokepoint is the CONVERSION, not this tool: any confirm-gated call refused for want of an
    owner writes the same row. Pinned on a second, unrelated forced-confirm tool so the fix cannot
    quietly become create-specific."""
    from app.domain.enums import Privilege
    from app.domain.event import Origin

    with _workspace(), _client() as c:
        events, suspended = _headless_turn(
            c,
            privilege=Privilege.CONFIRM,
            origin=Origin(kind="subagent", id="researcher"),
            tool="reboot_host",  # `confirm=True` by design, un-downgradable below FULL
            args={"host_id": "corsair"},
        )
        result = next(e for e in events if e.event == "tool.result").data["result"]
        assert not suspended and result["state"] == "denied"
        audit = [e for e in _run(c.app.state.events.recent(20)) if e.action == "reboot_host"]
        assert len(audit) == 1 and audit[0].decision == "policy"
        # A subagent's denial is attributed to the subagent, with no run id to inherit.
        assert (audit[0].origin, audit[0].origin_id, audit[0].run_id) == ("subagent", "researcher", None)


def test_the_read_only_sibling_is_available_headless() -> None:
    """§D-5: `list_automations` has no gate. An unattended run may legitimately need to know what else is
    scheduled — reading the roster creates nothing and confirms nothing."""
    with _workspace(), _client() as c:
        _create(c)
        res = _list(c, _ctx(c, interactive=False))
        assert res.state.value == "ok" and "nightly" in (res.output or "")


# ── 3. the write path ───────────────────────────────────────────────────────────────────────────


def test_a_confirmed_create_lands_through_the_one_write_service() -> None:
    """The tool builds a draft and hands it over; the SERVICE does the rest — so the stored row carries
    the service's normalizations (a resolved zone, a strictly-future first slot) rather than anything the
    tool computed for itself."""
    from datetime import datetime, timezone

    with _workspace(), _client() as c:
        res = _create(c, name="  nightly  ", schedule="  0   3 * * * ", thread_mode="rolling")
        assert res.state.value == "ok"

        rows = _run(c.app.state.automations.list())
        assert len(rows) == 1
        row = rows[0]
        assert row.name == "nightly"  # stripped in the service, not here
        assert row.schedule == "0 3 * * *"  # whitespace collapsed by `validate_cron`
        assert row.tz == "UTC" and row.enabled and row.thread_mode == "rolling"
        assert row.next_run_at is not None and row.next_run_at > datetime.now(timezone.utc)
        # The fields the v1 tool surface deliberately does NOT expose land on their safe defaults.
        assert row.privilege is None and row.question_policy == "use_default" and row.timeout_s is None


def test_a_blank_tz_resolves_to_the_server_zone_like_any_other_writer() -> None:
    """`tz=None` is the usual call. It must mean exactly what a blank field in the editor means."""
    from app.services.automations import server_tz_key

    with _workspace(), _client() as c:
        _create(c, tz=None)
        assert _run(c.app.state.automations.list())[0].tz == server_tz_key()


def test_every_service_refusal_comes_back_as_a_failed_result_not_an_exception() -> None:
    """The cap, the cron, the zone, a missing agent and a whitespace-only field all raise
    `AutomationError` inside the service. Each must reach the model as a failed ToolResult carrying the
    service's own owner-readable message — a traceback would give neither the model nor the owner
    anything to act on."""
    with _workspace("automations:\n  max_count: 1\n"), _client() as c:
        assert _create(c, name="first").state.value == "ok"

        for kw, needle in (
            ({"name": "second"}, "limit (1) is reached"),
            ({"name": "   "}, "a name is required"),
            ({"prompt": "   "}, "a prompt is required"),
            ({"schedule": "*/15 * * * * *"}, "5 cron fields"),
            ({"schedule": "99 * * * *"}, "invalid cron expression"),
            ({"tz": "Mars/Olympus"}, "unknown timezone"),
            ({"agent": "ghost"}, "does not exist"),
        ):
            res = _create(c, **kw)
            assert res.state.value == "error", kw
            assert needle in (res.error or ""), (kw, res.error)
            assert res.summary.startswith("could not create the automation")
        assert len(_run(c.app.state.automations.list())) == 1  # nothing partial was written


# ── 4. the created card ─────────────────────────────────────────────────────────────────────────


def test_the_result_carries_the_card_payload_the_bubble_renders() -> None:
    """§D-5's persisted card. It rides `data` under a NAMED key (the `plan`/`results` pattern) so the
    bubble identifies it by shape rather than by tool name, and every value is JSON-ready — the result is
    persisted as a message part and read back after a reload."""
    import json

    with _workspace(), _client() as c:
        res = _create(c, agent=None)
        card = res.data["automation"]
        row = _run(c.app.state.automations.list())[0]

        assert set(card) == {
            "id",
            "name",
            "schedule",
            "schedule_text",
            "tz",
            "next_fire",
            "thread_mode",
            "enabled",
            "agent",
        }
        assert card["id"] == row.id and card["name"] == "nightly"
        assert card["schedule"] == "0 3 * * *" and card["schedule_text"] == "At 03:00 every day"
        assert card["tz"] == "UTC" and card["thread_mode"] == "fresh" and card["enabled"] is True
        assert card["agent"] is None
        assert card["next_fire"] == row.next_run_at.isoformat()  # the slot the scheduler will claim
        json.dumps(card)  # persisted with the message — no datetimes, no enums

        # The model gets the same facts in prose, so it can confirm back without reading `data`.
        assert "nightly" in res.summary and "At 03:00 every day" in res.summary and "UTC" in res.summary


# ── 5. the listing ──────────────────────────────────────────────────────────────────────────────


def test_the_listing_reads_the_shared_repo_and_says_when_there_is_nothing() -> None:
    """A compact echo per row (name · schedule · armed · next fire · last run), built from the same
    reads the REST list uses. An empty roster is a sentence, not an empty string the model has to guess
    the meaning of."""
    from app.domain.automation import AutomationRun
    from app.services.agent.automation_tools import NEVER_RUN

    with _workspace(), _client() as c:
        empty = _list(c)
        assert empty.state.value == "ok" and "no automations" in empty.summary and not empty.output

        _create(c, name="nightly")
        _create(c, name="hourly", schedule="0 * * * *")
        rows = {r.name: r for r in _run(c.app.state.automations.list())}
        _run(c.app.state.automations.add_run(AutomationRun(automation_id=rows["hourly"].id, status="ok")))
        _run(_svc(c).set_enabled(rows["nightly"].id, False))

        res = _list(c)
        assert res.summary == "2 automations"
        lines = {line.split(" · ")[0]: line for line in (res.output or "").splitlines()}
        assert set(lines) == {"nightly", "hourly"}
        # A disabled row has no next slot by construction (§D-1) — the two columns can't contradict.
        assert "disabled" in lines["nightly"] and "next —" in lines["nightly"]
        assert f"last {NEVER_RUN}" in lines["nightly"]
        assert "enabled" in lines["hourly"] and "last ok" in lines["hourly"]
        assert "At 03:00 every day (UTC)" in lines["nightly"]


# ── 6. the run-terminal audit frame ─────────────────────────────────────────────────────────────


def test_every_terminal_run_records_one_audit_frame_the_client_can_key_on() -> None:
    """The F1 producer's source. A run-now answers 202 the moment it is claimed, so a DETACHED run has
    no completion signal at all unless it records one — this is that frame, and it must exist for a
    CLEAN run too (before 14d only `interrupted` wrote one). The FE predicate is `action ==
    "automation_run"` + a non-null `run_id`, which is what the notification and the list invalidation
    both hang off."""
    # The turn-machinery fixtures live with the engine slice that owns them (14b) — the drain task, the
    # marker lifecycle and the terminal fold under test here are the REAL ones, and a second `_FakeSession`
    # would be a copy that drifts the first time the seam moves.
    from test_automations_14b import _due_now, _fake_sessions, _FakeSession

    from app.domain.automation import AutomationDraft
    from app.services.automations.runner import COMPLETED_NOTE

    with _workspace(), _client() as c:
        svc, state = _svc(c), c.app.state
        a = _run(
            svc.create(
                AutomationDraft(name="nightly", schedule="*/5 * * * *", prompt="do the thing", tz="UTC")
            )
        )
        _due_now(c, a)
        snap = _run(svc.claim(a.id, expected_rev=a.rev))
        with _fake_sessions(_FakeSession()):
            assert _run(state.automation_runner._execute(snap)) == "ok"

        audit = [e for e in _run(state.events.recent(20)) if e.run_id == snap.run_id]
        assert len(audit) == 1
        frame = audit[0]
        assert frame.action == "automation_run" and frame.status.value == "ok"
        assert frame.origin == "automation" and frame.origin_id == a.id and frame.target == a.id
        assert frame.actor.value == "automation"
        assert frame.summary == f"nightly: {COMPLETED_NOTE}"  # the name leads, so a body reads as one


def test_the_shutdown_sweep_and_a_late_finalizer_terminalize_a_run_exactly_once() -> None:
    """The manual-shutdown race (post-14d review, MED). `shutdown()` gives a detached run a bounded grace
    and then closes the row through the backstop sweep — but the straggler task can still reach its OWN
    shielded finalizer afterwards. Unguarded, both wrote: the second silently replaced the first's status
    AND recorded a second terminal Event, i.e. a duplicate run in the audit log and a duplicate
    `automation_done` notification for one run.

    Terminalization is first-writer-wins, so what is pinned is the INVARIANT, not the winner: ONE
    transition, `interrupted`, and exactly ONE audit frame. The MESSAGE is deliberately either writer's
    — the v1.4.3 release gate failed here because a loaded ubuntu runner let the finalizer win, which is
    a perfectly legal outcome the old assertion had hard-coded against (it demanded the sweep's wording).

    The ORDERING is nonetheless deterministic now, and structurally so (release wave): `_HeldTurn` blocks
    the run task in its shielded wind-down until this test sets `release`, which it does only after
    `shutdown()` has returned. So the sweep provably writes first and the finalizer provably arrives
    late — the exact sequence the guard exists for — with no margin to lose on a slow machine.
    """
    import asyncio

    from test_automations_api_14c import (
        _HELD_TURN_CONFIG,
        _SETTLE_S,
        _TINY_GRACE_S,
        _fake_sessions,
        _HeldTurn,
        _settled,
    )
    from test_automations_api_14c import _create as _api_create

    from app.services.automations.runner import INTERRUPTED_NOTE
    from app.services.automations.service import ORPHAN_NOTE

    with _workspace(_HELD_TURN_CONFIG), _client() as c:
        state = c.app.state
        a = _api_create(c)
        held = _HeldTurn()

        async def go():
            with _fake_sessions(held):
                runner = state.automation_runner
                started = await runner.start_now(a["id"])
                await asyncio.wait_for(held.started.wait(), _SETTLE_S)  # the turn IS running
                await runner.shutdown(_TINY_GRACE_S)  # the grace expires under it → the SWEEP closes it
                assert not runner._manual.done()  # …with the straggler still provably in flight
                held.release.set()  # now let its finalizer land on an already-closed row
                await _settled(runner._manual)
                return started

        started = _run(go())
        run = _run(state.automations.get_run(started.id))
        assert run.status == "interrupted"
        # Either legal writer's wording is fine; anything else means a third path closed the row.
        assert (run.error or "") in (ORPHAN_NOTE, INTERRUPTED_NOTE), run.error
        audit = [e for e in _run(state.events.recent(50)) if e.run_id == started.id]
        assert len(audit) == 1, f"one run, one terminal Event — got {[e.summary for e in audit]}"


def test_a_finalized_run_is_not_re_terminalized_by_a_later_sweep() -> None:
    """The mirror ordering: the finalizer wins, and the sweep that follows finds nothing to close. It
    must neither rewrite the run's honest terminal nor add a second audit frame."""
    from test_automations_14b import _due_now, _fake_sessions, _FakeSession

    from app.domain.automation import AutomationDraft

    with _workspace(), _client() as c:
        svc, state = _svc(c), c.app.state
        a = _run(svc.create(AutomationDraft(name="nightly", schedule="*/5 * * * *", prompt="go", tz="UTC")))
        _due_now(c, a)
        snap = _run(svc.claim(a.id, expected_rev=a.rev))
        with _fake_sessions(_FakeSession()):
            assert _run(state.automation_runner._execute(snap)) == "ok"

        assert _run(svc.sweep_orphans()) == 0  # nothing open — the finalizer already closed it
        # A direct second close loses too: the guard is on the transition, not on who calls it.
        assert _run(svc.finish_run(snap.run_id, status="interrupted", error="late")) is False
        run = _run(state.automations.get_run(snap.run_id))
        assert run.status == "ok" and run.error is None
        assert len([e for e in _run(state.events.recent(50)) if e.run_id == snap.run_id]) == 1


def test_the_terminal_state_map_covers_every_run_status() -> None:
    """A new `RunStatus` arm must not silently KeyError the finalizer — the map is total by construction,
    and `missed` is in it for exactly that reason even though the claim writes those rows itself."""
    from app.domain.automation import TERMINAL_RUN_STATUSES
    from app.services.automations.runner import RUN_TERMINAL_STATES

    assert set(RUN_TERMINAL_STATES) == set(TERMINAL_RUN_STATUSES)
    assert RUN_TERMINAL_STATES["ok"].value == "ok"
    assert RUN_TERMINAL_STATES["timed_out"].value == "timeout"
    assert RUN_TERMINAL_STATES["interrupted"].value == "cancelled"


# ── 7. the config class ─────────────────────────────────────────────────────────────────────────


def test_the_automation_done_notification_class_is_an_additive_field() -> None:
    """F1 grows by one field on the ONE unified events object (never a sibling map), defaulting ON like
    its three siblings — the master switch is the spam guard."""
    from app.config import Settings

    n = Settings().notifications
    assert n.enabled is False and n.events.automation_done is True
    # A config written before this class loads unchanged, and naming one class doesn't switch it off.
    partial = Settings.model_validate({"notifications": {"events": {"turn_done": False}}})
    assert partial.notifications.events.turn_done is False
    assert partial.notifications.events.automation_done is True


def test_the_notifications_read_projection_carries_the_new_class() -> None:
    """The always-on `GET /api/notifications` is what the client's engine gates on — a class it cannot
    see is a class the owner can never turn off."""
    with _workspace(), _client() as c:
        events = c.get("/api/notifications").json()["events"]
        assert events["automation_done"] is True
        assert set(events) == {
            "agent_input",
            "turn_done",
            "action_failed",
            "automation_done",
            "host_up_down",
        }


if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    for fn in fns:
        fn()
        print(f"ok  {fn.__name__}")
    print(f"\n{len(fns)} passed")
