"""A3 slice 3 — the `/api/automations` REST surface (D49 / AUTOMATIONS_PLAN §D-6).

The engine (14b) is already pinned by `test_automations_14b.py`; this file pins the SURFACE over it:

  1. CRUD        — create/list/update/delete round-trip through the ONE shared write service, and the
                   list carries the derived echoes the Conf group renders (human schedule, next fires,
                   last run, unread count, running flag) plus the feature-level facts the editor needs.
  2. Statuses    — every `AutomationError` maps to exactly ONE status, with the FIELD named on a 422 so
                   the editor can point at the offending input (404 · 422+field · 409 cap · 409 busy).
  3. run-now     — starts the run and answers 202 immediately (it does not await the turn), refuses
                   with 409 while any run is active, and a delete is refused in that same window.
  4. enabled     — the cheap switch recomputes a strictly-future slot on enable and nulls it on disable.
  5. preview     — advisory: ALWAYS 200, valid or not, with the message on the field it belongs to.
  6. unread      — a finished run is unread until it is marked read, per automation, first-writer-wins.
  7. shutdown    — the detached run's two failure shapes: refused once shutdown has begun, and a task
                   that never ran its body still leaves NO `running` row behind (the sweep backstop).

Runs as `python tests/test_automations_api_14c.py` from backend/ or under pytest. Every test works in an
isolated `$CTRLB_HOME`/`CTRLB_CONFIG`/`CTRLB_DB` temp workspace — the real config/db are never touched.
"""

from __future__ import annotations

import asyncio
import contextlib
import os
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path

import anyio
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


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _body(**kw) -> dict:
    """A valid draft body (03:00 daily, UTC) with the overrides applied — the same shape the agent tool
    will post, because the endpoint's body IS `AutomationDraft`."""
    return {"name": "nightly", "schedule": "0 3 * * *", "prompt": "check the fleet", "tz": "UTC", **kw}


def _create(c, **kw) -> dict:
    r = c.post("/api/automations", json=_body(**kw))
    assert r.status_code == 201, r.text
    return r.json()


def _views(c) -> dict:
    r = c.get("/api/automations")
    assert r.status_code == 200, r.text
    doc = r.json()
    return {v["automation"]["id"]: v for v in doc["automations"]} | {"_doc": doc}


def _wait_terminal(c, automation_id: str, *, timeout_s: float = 10.0) -> dict:
    """Poll the run history until the newest run is finished.

    Real-time polling rather than awaiting the runner's task: run-now is DETACHED by design (§D-6), the
    task lives on the TestClient's own event loop, and the only honest observation from out here is the
    one the UI makes — the history row settling into a terminal status. The fake session finishes in
    milliseconds, so the loop below is a formality with a real ceiling.
    """
    deadline = time.monotonic() + timeout_s
    while time.monotonic() < deadline:
        runs = c.get(f"/api/automations/{automation_id}/runs").json()
        if runs and runs[0]["status"] != "running":
            return runs[0]
        time.sleep(0.02)
    raise AssertionError(f"the run of {automation_id} never terminalized within {timeout_s}s")


class _FakeSession:
    """The 14b session stand-in, re-used verbatim in shape: everything BELOW `_build_session` (reserve,
    the drain task, the terminal fold, the finalizer) stays the real machinery."""

    def __init__(self, *, hang: bool = False) -> None:
        self._hang = hang

    async def run_turn(self, thread, text, **_kw):
        from app.services.agent.session import AgentEvent

        if self._hang:
            await asyncio.sleep(30)  # cancelled by the run's own deadline
        yield AgentEvent("done", {"threadId": thread.id, "state": "completed"})


#: The "hangs until cancelled" sleep inside a stand-in turn. A duration only because a coroutine has to
#: await SOMETHING; nothing is ever ordered against it (every wait below is signalled).
_FOREVER_S = 30

#: A shutdown grace we WANT to expire. Safe at any machine speed because the turn it waits on is HELD by
#: the test — it provably cannot finish inside any window, so this is not a margin, it is a formality.
_TINY_GRACE_S = 0.05

#: The outer bound on a wait that is released by an explicit signal — the only real-time coupling left in
#: these tests, and it exists solely so a genuine deadlock fails the suite instead of hanging it.
_SETTLE_S = 10.0

#: `agent.turns.shutdown_grace_s` (the bound on the runner's post-cancel wait for the TURN's drain task)
#: pushed far out of the way, so the one thing a slow runner could otherwise change — that wait expiring
#: on its own and releasing the finalizer early — cannot happen while a test holds a turn on purpose.
_HELD_TURN_CONFIG = "server:\n  port: 5433\nagent:\n  turns:\n    shutdown_grace_s: 30\n"


def _running_loop():
    """The loop this caller is on, or None when it is a plain (sync) test body."""
    try:
        return asyncio.get_running_loop()
    except RuntimeError:
        return None


class _HeldTurn:
    """A turn that ignores its cancel until the TEST lets go — the structural stand-in for "still
    unwinding when the grace expires" (release wave: the release-by-`sleep(0.4)`-vs-grace-`0.05` shape
    this replaces is a MARGIN, and the v1.4.3 release gate proved the margin does not hold on a loaded
    ubuntu runner — its own proof-guard fired).

    Three signals, so a caller never sleeps to sequence anything:
      * `started`   — the turn is genuinely executing (replaces "sleep a bit to let it get going").
      * `cancelled` — the cancel has been delivered and the shielded wind-down has begun.
      * `release`   — set by the test, and the ONLY thing that lets the wind-down finish. Until then the
                      run task cannot reach its finalizer, which is what makes "the grace expired under a
                      live turn" a property of the code rather than of the clock.
    """

    def __init__(self) -> None:
        self.started = asyncio.Event()
        self.cancelled = asyncio.Event()
        self.release = asyncio.Event()
        #: The loop the turn actually ran on — captured because a TestClient drives the app on ITS OWN
        #: loop in a portal thread, so a sync test body releasing the hold is cross-thread.
        self.loop: asyncio.AbstractEventLoop | None = None

    def release_now(self) -> None:
        """Set `release` from ANY thread. `asyncio.Event.set` is not thread-safe, and a sync test body
        (TestClient) is on a different thread from the loop the turn is parked on — so hop through the
        loop when we know it, and set directly when the caller is already on it."""
        loop = self.loop
        if loop is None or loop is _running_loop():
            self.release.set()
        else:
            loop.call_soon_threadsafe(self.release.set)

    async def run_turn(self, thread, text, **_kw):
        from app.services.agent.session import AgentEvent

        try:
            self.loop = asyncio.get_running_loop()
            self.started.set()
            await asyncio.sleep(_FOREVER_S)
        except asyncio.CancelledError:
            self.cancelled.set()
            with anyio.CancelScope(shield=True):
                await self.release.wait()  # still doing real work AFTER the cancel — until the test says stop
            raise
        yield AgentEvent("done", {"threadId": thread.id, "state": "completed"})  # pragma: no cover


async def _settled(task) -> None:
    """Wait for a (usually cancelled) task to finish WITHOUT re-raising its outcome into the test — the
    `asyncio.wait` shape the runner itself uses. Bounded only so a deadlock fails loudly."""
    _, pending = await asyncio.wait([task], timeout=_SETTLE_S)
    assert not pending, "a released turn never settled — it is wedged, not slow"


@contextlib.contextmanager
def _fake_sessions(session):
    import app.api.agent as agent_api

    real = agent_api._build_session
    agent_api._build_session = lambda *a, **kw: session  # type: ignore[assignment]
    try:
        yield
    finally:
        agent_api._build_session = real  # type: ignore[assignment]


# ── 1. CRUD + the list's derived echoes ─────────────────────────────────────────────────────────


def test_create_list_update_delete_round_trip() -> None:
    """The happy path end to end. The POST body is the shared `AutomationDraft`, the PUT replaces the
    whole definition (and bumps `rev`), and the DELETE answers 204 with the row gone."""
    with _workspace(), _client() as c:
        created = _create(c, name="fleet check")
        assert created["enabled"] is True and created["rev"] == 1
        assert created["tz"] == "UTC" and created["next_run_at"] is not None
        assert datetime.fromisoformat(created["next_run_at"]) > _now()  # a create computes a FUTURE slot

        view = _views(c)[created["id"]]
        assert view["automation"]["name"] == "fleet check"
        assert "03:00" in view["schedule_text"]  # cronsim's human echo, not the raw cron
        assert len(view["next_fires"]) == 2 and all(
            datetime.fromisoformat(f) > _now() for f in view["next_fires"]
        )
        assert view["last_run"] is None and view["unread_runs"] == 0 and view["running"] is False

        r = c.put(
            f"/api/automations/{created['id']}",
            json=_body(name="fleet check", prompt="check the fleet twice", schedule="30 4 * * 1"),
        )
        assert r.status_code == 200, r.text
        assert r.json()["prompt"] == "check the fleet twice" and r.json()["rev"] == 2

        assert c.delete(f"/api/automations/{created['id']}").status_code == 204
        assert _views(c)["_doc"]["automations"] == []


def test_the_list_envelope_carries_the_feature_level_facts() -> None:
    """The editor must not hardcode what config already owns (§D-7): the cap, the server zone a blank
    `tz` resolves to, the default timeout a blank field means, and whether the master switch is even on.
    All four ride the list, so a Conf edit to `automations.*` is honoured by the UI with no redeploy."""
    cfg = "automations:\n  enabled: false\n  max_count: 3\n  default_timeout_s: 42\n"
    with _workspace(cfg), _client() as c:
        from app.services.automations import server_tz_key

        doc = _views(c)["_doc"]
        assert doc["enabled"] is False and doc["max_count"] == 3
        assert doc["default_timeout_s"] == 42 and doc["busy"] is False
        assert doc["server_tz"] == server_tz_key()


def test_a_disabled_automation_lists_with_no_upcoming_fires() -> None:
    """Nothing is scheduled for a disabled row — `next_run_at` is NULL by invariant — so the list says
    so with an empty `next_fires` rather than showing a time that will never happen."""
    with _workspace(), _client() as c:
        a = _create(c, enabled=False)
        view = _views(c)[a["id"]]
        assert a["next_run_at"] is None
        assert view["next_fires"] == [] and view["schedule_text"]  # the echo still renders


def test_an_unusable_stored_schedule_still_lists() -> None:
    """A row this build cannot evaluate (written by a looser build, or a zone dropped from the host) must
    not take the whole list down: the list is the only surface the owner can reach it from to fix it."""
    with _workspace(), _client() as c:
        a = _create(c)
        _run(c.app.state.db.execute("UPDATE automations SET schedule = ? WHERE id = ?", ("@yearly", a["id"])))
        view = _views(c)[a["id"]]
        assert view["next_fires"] == []
        assert view["schedule_text"] == "@yearly"  # describe() degrades to the raw form, never raises


# ── 2. the status mapping ───────────────────────────────────────────────────────────────────────


def test_every_service_refusal_maps_to_exactly_one_status() -> None:
    """The mapping itself, at the helper every endpoint wraps — including `AutomationAgentMissing`,
    which today's write path converts to an `AutomationInvalid("agent")` before it can escape, so the
    only way to pin its status is here. A new endpoint that lets one out must not 500."""
    from fastapi import HTTPException

    from app.api.automations import _mapped
    from app.services.automations import (
        AutomationAgentMissing,
        AutomationBusy,
        AutomationCapReached,
        AutomationInvalid,
        AutomationNotFound,
    )

    def status_of(exc: Exception) -> tuple[int, object]:
        try:
            with _mapped():
                raise exc
        except HTTPException as http:
            return http.status_code, http.detail
        raise AssertionError(f"{type(exc).__name__} was not mapped")

    assert status_of(AutomationNotFound("gone"))[0] == 404
    code, detail = status_of(AutomationInvalid("schedule", "nope"))
    assert code == 422 and detail == [{"path": "schedule", "message": "nope"}]
    code, detail = status_of(AutomationAgentMissing("ghost"))
    assert code == 422 and isinstance(detail, list) and detail[0]["path"] == "agent"
    assert status_of(AutomationCapReached("full"))[0] == 409
    assert status_of(AutomationBusy("running"))[0] == 409


def test_an_unknown_id_is_404_on_every_endpoint_that_takes_one() -> None:
    with _workspace(), _client() as c:
        assert c.put("/api/automations/nope", json=_body()).status_code == 404
        assert c.post("/api/automations/nope/enabled", json={"enabled": True}).status_code == 404
        assert c.delete("/api/automations/nope").status_code == 404
        assert c.post("/api/automations/nope/run-now").status_code == 404
        assert c.get("/api/automations/nope/runs").status_code == 404
        assert c.post("/api/automations/runs/nope/read").status_code == 404


def test_a_bad_field_is_422_with_the_field_named() -> None:
    """The editor points at the offending input, so the message has to say WHICH one — a bare sentence
    in a toast would make the owner hunt for it.

    The whitespace rows are the point of the last two: `min_length=1` counts CHARACTERS, so `"   "`
    sails through pydantic and would store an automation with a blank name and an empty instruction.
    The rule therefore lives in the shared service, which is also how the 14d agent tool inherits it.
    """
    with _workspace(), _client() as c:
        for field, body in (
            ("schedule", _body(schedule="not a cron")),
            ("schedule", _body(schedule="*/15 * * * * *")),  # the 6-field seconds form is refused
            ("tz", _body(tz="Nowhere/Land")),
            ("agent", _body(agent="ghost")),
            ("name", _body(name="   ")),
            ("prompt", _body(prompt=" \n\t ")),
        ):
            r = c.post("/api/automations", json=body)
            assert r.status_code == 422, (field, r.text)
            assert r.json()["detail"][0]["path"] == field, r.text
            assert r.json()["detail"][0]["message"]


def test_the_name_is_stored_stripped_and_the_prompt_is_not() -> None:
    """Two different rules, and the difference is deliberate: a name is an identifier, so it is
    normalized; a prompt's leading indentation and trailing newlines are formatting the owner chose for
    text the model will read, so it is only CHECKED for content, never trimmed."""
    with _workspace(), _client() as c:
        a = _create(c, name="  nightly  ", prompt="\n  do the thing\n")
        assert a["name"] == "nightly"
        assert a["prompt"] == "\n  do the thing\n"
        r = c.put(f"/api/automations/{a['id']}", json=_body(name="  renamed  "))
        assert r.status_code == 200 and r.json()["name"] == "renamed"
        assert c.put(f"/api/automations/{a['id']}", json=_body(name=" ")).status_code == 422


def test_the_cap_is_409_and_names_the_remedy() -> None:
    with _workspace("automations:\n  max_count: 1\n"), _client() as c:
        _create(c, name="one")
        r = c.post("/api/automations", json=_body(name="two"))
        assert r.status_code == 409 and "delete one first" in r.json()["detail"]


# ── 3. run-now: detached, arbitrated, and honest about being busy ───────────────────────────────


def test_run_now_starts_a_manual_run_and_answers_immediately() -> None:
    """202, not 200: the row it hands back is `running`. The endpoint deliberately does NOT await the
    turn (a run is bounded by `timeout_s`, 300s by default) — the terminal lands in the history."""
    with _workspace(), _client() as c:
        a = _create(c, schedule="0 3 * * *")
        with _fake_sessions(_FakeSession()):
            r = c.post(f"/api/automations/{a['id']}/run-now")
            assert r.status_code == 202, r.text
            started = r.json()
            assert started["status"] == "running" and started["trigger"] == "manual"
            assert started["automation_id"] == a["id"]
            finished = _wait_terminal(c, a["id"])
        assert finished["id"] == started["id"] and finished["status"] == "ok"
        assert finished["thread_id"] and finished["read_at"] is None  # a fresh result is UNREAD
        # …and a manual run left the schedule alone (its slot was not due).
        assert c.get("/api/automations").json()["automations"][0]["automation"]["next_run_at"]


def test_a_second_run_now_and_a_delete_are_refused_while_a_run_is_active() -> None:
    """Concurrency 1 is GLOBAL (owner ruling 2), and a delete mid-run would strand the live turn's
    thread and its finalizer's write target — both are 409, from the same arbiter/open-run truth the
    engine already keeps. The list says `busy`/`running` in the same window, so the UI can grey the
    button instead of discovering the refusal."""
    with _workspace(_HELD_TURN_CONFIG), _client() as c:
        a = _create(c, timeout_s=1)  # its own deadline is what labels the run `timed_out`
        b = _create(c, name="other")
        held = _HeldTurn()
        with _fake_sessions(held):
            assert c.post(f"/api/automations/{a['id']}/run-now").status_code == 202
            # The run is HELD open (release wave): every refusal below is asserted against a run that
            # provably cannot finish, instead of racing the 1s deadline that used to be the only thing
            # keeping the window open — six TestClient round-trips inside one second is a margin, and
            # margins are what the v1.4.3 gate broke. The deadline may fire mid-window; that only starts
            # the runner's (unbounded) wait for the turn, so `busy` stays true either way.
            views = _views(c)
            assert views["_doc"]["busy"] is True
            assert views[a["id"]]["running"] is True and views[b["id"]]["running"] is False

            assert c.post(f"/api/automations/{a['id']}/run-now").status_code == 409
            assert c.post(f"/api/automations/{b['id']}/run-now").status_code == 409  # global, not per-row
            r = c.delete(f"/api/automations/{a['id']}")
            assert r.status_code == 409 and "active" in r.json()["detail"]

            held.release_now()  # let the deadline-cancelled turn finish unwinding
            finished = _wait_terminal(c, a["id"])
        assert finished["status"] == "timed_out"
        assert c.get("/api/automations").json()["busy"] is False
        assert c.delete(f"/api/automations/{a['id']}").status_code == 204  # idle again → it deletes


# ── 4. the list's enable switch ─────────────────────────────────────────────────────────────────


def test_the_enabled_switch_recomputes_a_strictly_future_slot() -> None:
    """§D-1's two halves in one endpoint: disabling NULLs `next_run_at` (a disabled row is structurally
    unclaimable) and enabling computes a fresh slot from now — never resurrecting a stale past one."""
    with _workspace(), _client() as c:
        a = _create(c, schedule="*/5 * * * *")
        r = c.post(f"/api/automations/{a['id']}/enabled", json={"enabled": False})
        assert r.status_code == 200 and r.json()["enabled"] is False
        assert r.json()["next_run_at"] is None and r.json()["rev"] == a["rev"] + 1

        # Force a stale slot in behind the switch's back, then enable: the value must be recomputed.
        past = _now().replace(microsecond=0)
        _run(c.app.state.automations.set_next_run(a["id"], past))
        r = c.post(f"/api/automations/{a['id']}/enabled", json={"enabled": True})
        assert r.status_code == 200 and r.json()["enabled"] is True
        assert datetime.fromisoformat(r.json()["next_run_at"]) > _now()


# ── 5. schedule-preview (advisory — never a 4xx) ────────────────────────────────────────────────


def test_schedule_preview_explains_a_valid_expression() -> None:
    with _workspace(), _client() as c:
        r = c.post("/api/automations/schedule-preview", json={"schedule": "0 3 * * *", "tz": "UTC"})
        assert r.status_code == 200, r.text
        p = r.json()
        assert p["valid"] is True and p["error"] is None and p["tz"] == "UTC"
        assert "03:00" in p["describe"]
        assert len(p["next_fires"]) == 3
        fires = [datetime.fromisoformat(f) for f in p["next_fires"]]
        assert fires == sorted(fires) and fires[0] > _now()


def test_schedule_preview_never_4xxs_on_bad_input_and_names_the_field() -> None:
    """It is called on every keystroke: a half-typed expression is a normal state of a field, not a
    failed request. The message lands on the input it belongs to.

    The BLANK cases matter most (post-14c review, LOW): an empty field is the most ordinary input this
    endpoint sees, and a pydantic `min_length` would have answered it with the one thing the contract
    promises never to send — a 422 the editor would have to special-case.
    """
    with _workspace(), _client() as c:
        for body in ({"schedule": "nonsense"}, {"schedule": ""}, {"schedule": "   "}, {}):
            r = c.post("/api/automations/schedule-preview", json=body)
            assert r.status_code == 200, (body, r.text)
            p = r.json()
            assert p["valid"] is False and p["field"] == "schedule" and p["error"]
            assert p["next_fires"] == [] and p["describe"] is None

        r = c.post("/api/automations/schedule-preview", json={"schedule": "0 3 * * *", "tz": "Bad/Zone"})
        assert r.status_code == 200 and r.json()["valid"] is False and r.json()["field"] == "tz"


def test_schedule_preview_defaults_the_zone_to_the_servers() -> None:
    """A blank `tz` means "the server's zone", resolved the SAME way the write path resolves it — so the
    preview shows the times the saved automation will actually fire at."""
    with _workspace(), _client() as c:
        from app.services.automations import server_tz_key

        for body in ({"schedule": "0 3 * * *"}, {"schedule": "0 3 * * *", "tz": ""}):
            p = c.post("/api/automations/schedule-preview", json=body).json()
            assert p["valid"] is True and p["tz"] == server_tz_key()


# ── 6. runs + the unread marker ─────────────────────────────────────────────────────────────────


def test_a_finished_run_is_unread_until_it_is_marked_read() -> None:
    """The badge's whole contract, per automation: a terminal run nobody has opened counts; marking it
    read clears it and is idempotent (the first `read_at` stands)."""
    with _workspace(), _client() as c:
        a = _create(c)
        b = _create(c, name="other")
        with _fake_sessions(_FakeSession()):
            c.post(f"/api/automations/{a['id']}/run-now")
            run = _wait_terminal(c, a["id"])

        views = _views(c)
        assert views[a["id"]]["unread_runs"] == 1 and views[b["id"]]["unread_runs"] == 0
        assert views[a["id"]]["last_run"]["id"] == run["id"]  # the chip reads the newest run

        r = c.post(f"/api/automations/runs/{run['id']}/read")
        assert r.status_code == 200 and r.json()["read_at"] is not None
        first_read = r.json()["read_at"]
        assert _views(c)[a["id"]]["unread_runs"] == 0
        # First-writer-wins, in one statement (COALESCE): a second mark — the history's open-sweep
        # racing a refetch behind it — must not move the timestamp the owner actually read at.
        assert c.post(f"/api/automations/runs/{run['id']}/read").json()["read_at"] == first_read
        assert c.post(f"/api/automations/runs/{run['id']}/read").json()["read_at"] == first_read


def test_the_runs_listing_is_newest_first_and_honours_a_limit() -> None:
    with _workspace(), _client() as c:
        a = _create(c)
        with _fake_sessions(_FakeSession()):
            for _ in range(3):
                assert c.post(f"/api/automations/{a['id']}/run-now").status_code == 202
                _wait_terminal(c, a["id"])

        runs = c.get(f"/api/automations/{a['id']}/runs").json()
        assert len(runs) == 3
        starts = [datetime.fromisoformat(r["started_at"]) for r in runs]
        assert starts == sorted(starts, reverse=True)
        assert len(c.get(f"/api/automations/{a['id']}/runs?limit=1").json()) == 1
        # …and the page is BOUNDED: a caller cannot ask the server for an unlimited read.
        from app.api.automations import MAX_RUNS_PAGE

        assert c.get(f"/api/automations/{a['id']}/runs?limit={MAX_RUNS_PAGE}").status_code == 200
        assert c.get(f"/api/automations/{a['id']}/runs?limit={MAX_RUNS_PAGE + 1}").status_code == 422
        assert c.get(f"/api/automations/{a['id']}/runs?limit=0").status_code == 422


# ── 7. the detached run's shutdown edges ────────────────────────────────────────────────────────


def test_run_now_is_refused_once_shutdown_has_begun() -> None:
    """The `shutting_down` gate `tick()` already reads, applied to the other entry point (post-14c
    review, HIGH). Without it, a start landing during `shutdown()`'s drain would overwrite the single
    `_manual` handle with a run nothing is waiting for — and race a snapshot into a closing DB."""
    with _workspace(), _client() as c:
        a = _create(c)
        c.app.state.shutting_down = True
        try:
            r = c.post(f"/api/automations/{a['id']}/run-now")
            assert r.status_code == 409 and "shutting down" in r.json()["detail"]
            assert c.get(f"/api/automations/{a['id']}/runs").json() == []  # nothing was claimed
        finally:
            c.app.state.shutting_down = False


def test_a_run_task_cancelled_before_it_starts_still_leaves_no_running_row() -> None:
    """The HIGH the review caught in the detached hand-off. A task cancelled before its FIRST scheduling
    step never runs its body — so neither `_execute`'s shielded finalizer nor `_run_detached`'s `finally`
    ever executes, and the `running` row the claim committed would survive with nobody to close it.

    The shape is exact: `start_now` returns, and `shutdown()` is called with NO intervening yield, so the
    task genuinely has not begun. The backstop is the existing `sweep_orphans()` chokepoint, run while
    the DB is still open rather than left for the next boot to find.
    """
    with _workspace(), _client() as c:
        state = c.app.state
        a = _create(c)

        async def go():
            with _fake_sessions(_FakeSession(hang=True)):
                started = await state.automation_runner.start_now(a["id"])
                # NO `await` between the create and the cancel: the task has never been scheduled.
                await state.automation_runner.shutdown(0.05)
                return started

        started = _run(go())
        run = _run(state.automations.get_run(started.id))
        assert run.status == "interrupted", "a never-started task left the run row `running`"
        assert _run(state.automations.open_runs()) == []


def test_a_run_still_unwinding_past_the_grace_warns_and_is_swept() -> None:
    """The other half: the task DID start but is still winding down when the bounded grace expires.
    Shutdown must not hang systemd, so the wait stays bounded — and the row is closed here rather than
    left `running` for the next boot's sweep.

    "Still unwinding past the grace" is now STRUCTURAL, not a stopwatch (release wave): the turn blocks
    in its shielded wind-down on an Event this test sets only after `shutdown()` has returned, so the
    grace cannot fail to expire and the straggler cannot fail to be late. Everything the assertions
    depend on is signalled; the only durations left are a formality (`_TINY_GRACE_S`) and a
    deadlock-catcher (`_SETTLE_S`).
    """
    with _workspace(_HELD_TURN_CONFIG), _client() as c:
        state = c.app.state
        a = _create(c)
        held = _HeldTurn()

        async def go():
            with _fake_sessions(held):
                runner = state.automation_runner
                started = await runner.start_now(a["id"])
                await asyncio.wait_for(held.started.wait(), _SETTLE_S)  # the turn IS running
                await runner.shutdown(_TINY_GRACE_S)  # …and cannot finish, so the grace expires
                # Read INSIDE the window, with the run task still provably held: a terminal row here is
                # one SHUTDOWN wrote, not one the straggler got round to.
                assert runner._manual is not None and not runner._manual.done()
                assert held.cancelled.is_set(), "the turn was never cancelled — the test proves nothing"
                run = await state.automations.get_run(started.id)
                open_runs = await state.automations.open_runs()
                held.release.set()  # now let the straggler land, while the DB is still open
                await _settled(runner._manual)
                return run, open_runs, await state.automations.get_run(started.id)

        run, open_runs, after = _run(go())
        assert run.status == "interrupted"
        assert open_runs == []
        assert after.status == "interrupted"  # the late straggler did not rewrite the closed row


if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    for fn in fns:
        fn()
        print(f"ok  {fn.__name__}")
    print(f"\n{len(fns)} passed")
