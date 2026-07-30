"""D2-B — wake-on-connect: the `wake` config section, the per-host flag's CRUD round-trip, and the
stream-connect trigger's decision matrix.

Runs as `python tests/test_wake_on_connect_d2b.py` from backend/ (plain asserts + a __main__ runner)
or under pytest. Config writes go to a temp `CTRLB_CONFIG` — never the operator's real config.yaml.
No network: the decision matrix drives `wake_flagged_hosts` against fake fleet/actions objects, so
what is pinned is exactly the policy (which hosts, through which call, with which actor) rather than
a WOL packet.
"""

from __future__ import annotations

import asyncio
import gc
import os
import tempfile
import warnings
from pathlib import Path
from types import SimpleNamespace

from app.config import Settings, load_settings
from app.domain.enums import Actor, OSType
from app.domain.event import Origin
from app.domain.host import Host
from app.services import wake_on_connect

_SEED = """\
# my fleet
computers:
  alpha:
    ip: 192.168.1.10     # the LAN address
    mac: "00:11:22:33:44:55"
    os_type: linux
    wake_on_connect: true
  beta:
    ip: 192.168.1.20
    os_type: linux
# trailing note
"""


def _client(tmp: Path):
    from fastapi.testclient import TestClient

    from app.main import create_app

    cfg = tmp / "config.yaml"
    cfg.write_text(_SEED, encoding="utf-8")
    os.environ["CTRLB_CONFIG"] = str(cfg)
    os.environ["CTRLB_DB"] = str(tmp / "t.db")
    return TestClient(create_app()), cfg


def _host(c, hid):
    return next((h for h in c.get("/api/hosts").json() if h["id"] == hid), None)


# --------------------------------------------------------------------------- config model


def test_wake_section_defaults() -> None:
    """A config with no `wake:` block loads with the documented cooldown — purely additive."""
    assert Settings().wake.cooldown_s == 300
    assert Settings.model_validate({"wake": {"cooldown_s": 0}}).wake.cooldown_s == 0


def test_flag_defaults_off_and_projects_onto_the_domain_host() -> None:
    """`wake_on_connect` is an additive optional field on the unified per-host object (never a
    parallel `wake.targets` list), and it reaches the domain `Host` the trigger iterates."""
    s = Settings.model_validate(
        {"computers": {"a": {"ip": "10.0.0.1"}, "b": {"ip": "10.0.0.2", "wake_on_connect": True}}}
    )
    assert s.computers["a"].wake_on_connect is False
    by_id = {h.id: h for h in s.hosts()}
    assert by_id["a"].wake_on_connect is False
    assert by_id["b"].wake_on_connect is True


# --------------------------------------------------------------------------- the decision matrix


class _FakeActions:
    """Stands in for `ActionService`, recording the exact invocations the trigger makes."""

    def __init__(self, *, explode: bool = False) -> None:
        self.calls: list[tuple[str, dict, Actor, bool]] = []
        #: The `Origin` of each call, recorded separately so the decision-matrix assertions above stay
        #: about which hosts fire (attribution has its own test below).
        self.origins: list[Origin] = []
        self._explode = explode

    async def invoke(self, name, raw_args, *, origin, actor=Actor.USER, interactive=True, **_kw):
        self.calls.append((name, raw_args, actor, interactive))
        self.origins.append(origin)
        if self._explode:
            raise RuntimeError("boom")
        return None


class _FakeFleet:
    def __init__(self, hosts: list[Host], online: set[str] | None = None) -> None:
        self._hosts = hosts
        self._online = online or set()

    def hosts(self) -> list[Host]:
        return self._hosts

    def cached_online_ids(self) -> set[str]:
        return self._online


def _app(hosts: list[Host], *, online: set[str] | None = None, cooldown_s: int = 300, explode=False):
    actions = _FakeActions(explode=explode)
    return SimpleNamespace(
        state=SimpleNamespace(
            settings=Settings.model_validate({"wake": {"cooldown_s": cooldown_s}}),
            fleet=_FakeFleet(hosts, online),
            actions=actions,
        )
    ), actions


def _h(hid: str, *, mac: str | None = "00:11:22:33:44:55", flagged: bool = True) -> Host:
    return Host(id=hid, name=hid, ip="10.0.0.1", mac=mac, os_type=OSType.LINUX, wake_on_connect=flagged)


def test_fires_for_a_flagged_offline_host_through_the_chokepoint() -> None:
    """The whole point: `wake_host` via `ActionService.invoke` as `Actor.SYSTEM`, non-interactive —
    so it is privilege-gated and lands in the Event log exactly like a button press. Never a direct
    `wol.send_magic` shortcut."""
    app, actions = _app([_h("alpha")])
    asyncio.run(wake_on_connect.wake_flagged_hosts(app))
    assert actions.calls == [("wake_host", {"host_id": "alpha"}, Actor.SYSTEM, False)]


def test_the_wake_is_attributed_to_the_system_not_the_owner() -> None:
    """Attribution (D49 / AUTOMATIONS_PLAN §D-4): nobody typed this, the app decided — so the origin is
    `system`, stated explicitly at the call site. Without it the audit row would be indistinguishable
    from the owner pressing Wake, which is the whole thing the origin column exists to separate."""
    app, actions = _app([_h("alpha")])
    asyncio.run(wake_on_connect.wake_flagged_hosts(app))
    assert actions.origins == [Origin(kind="system")]
    assert actions.origins[0].run_id is None  # not descended from an automation run


def test_unflagged_hosts_are_never_touched() -> None:
    """A config with zero flagged hosts is exactly today's behavior."""
    app, actions = _app([_h("alpha", flagged=False), _h("beta", flagged=False)])
    asyncio.run(wake_on_connect.wake_flagged_hosts(app))
    assert actions.calls == []


def test_no_mac_is_skipped() -> None:
    """`wake_host` would DENY a MAC-less host anyway (its own first-class outcome); the automatic
    trigger skips it EARLIER so a routine reconnect doesn't write a denial nobody asked for."""
    app, actions = _app([_h("alpha", mac=None)])
    asyncio.run(wake_on_connect.wake_flagged_hosts(app))
    assert actions.calls == []


def test_cached_online_host_is_skipped() -> None:
    """A host the last sweep saw awake needs no packet. Cheap cache read, no forced probe."""
    app, actions = _app([_h("alpha"), _h("beta")], online={"alpha"})
    asyncio.run(wake_on_connect.wake_flagged_hosts(app))
    assert [c[1] for c in actions.calls] == [{"host_id": "beta"}]


def test_cooldown_suppresses_the_second_connect_and_zero_disables_it() -> None:
    """Reconnect churn (a phone drifting off wifi) must not re-wake per connect. The cooldown is
    per-host and monotonic; `cooldown_s: 0` opts out entirely."""
    app, actions = _app([_h("alpha")], cooldown_s=300)
    asyncio.run(wake_on_connect.wake_flagged_hosts(app))
    asyncio.run(wake_on_connect.wake_flagged_hosts(app))  # immediately again — inside the window
    assert len(actions.calls) == 1

    app0, actions0 = _app([_h("alpha")], cooldown_s=0)
    asyncio.run(wake_on_connect.wake_flagged_hosts(app0))
    asyncio.run(wake_on_connect.wake_flagged_hosts(app0))
    assert len(actions0.calls) == 2


def test_cooldowns_are_per_app_not_global() -> None:
    """The marks live on `app.state`, so two apps in one process (every TestClient builds one) can't
    suppress each other's wakes."""
    a1, act1 = _app([_h("alpha")])
    a2, act2 = _app([_h("alpha")])
    asyncio.run(wake_on_connect.wake_flagged_hosts(a1))
    asyncio.run(wake_on_connect.wake_flagged_hosts(a2))
    assert len(act1.calls) == 1 and len(act2.calls) == 1


def test_an_exploding_invoke_never_escapes_the_scheduler() -> None:
    """The trigger runs off an SSE stream's prologue. `schedule` must swallow EVERYTHING — a broken
    action, a broken adapter — so a failing automation can never take the live feed down with it."""
    app, actions = _app([_h("alpha")], explode=True)

    async def drive() -> None:
        wake_on_connect.schedule(app)  # must not raise here…
        await asyncio.sleep(0)  # …nor when the detached task runs and blows up
        await asyncio.sleep(0)

    asyncio.run(drive())  # an escaped exception would fail the run
    assert len(actions.calls) == 1  # it really did try


def test_schedule_without_a_running_loop_is_silent_and_allocates_nothing() -> None:
    """`schedule` probes for the loop BEFORE building the coroutine (Codex final round, LOW).

    The old shape called `create_task(_guarded())`: with no running loop that constructs a coroutine
    which is then never awaited, so the interpreter emits "coroutine ... was never awaited" — a
    RuntimeWarning — when it is collected, ON TOP of the error already being handled. That is log
    noise in prod and a hard failure under a `-W error` run. The probe-first shape allocates nothing,
    so there is nothing to warn about. `gc.collect()` inside the block is what forces the old
    behavior to surface (the warning fires at collection, not at the call)."""
    app, actions = _app([_h("alpha")])
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        wake_on_connect.schedule(app)  # a SYNC context: no running event loop
        gc.collect()
    assert [w for w in caught if issubclass(w.category, RuntimeWarning)] == []
    assert actions.calls == []  # and of course nothing ran


def test_a_refused_create_task_never_escapes_the_trigger() -> None:
    """The same promise one level up (verify-5): `loop.create_task` itself can fail (a loop that is
    shutting down, an instrumented loop). That call used to sit OUTSIDE the guard, so the failure
    would raise into the SSE generator AND strand the already-built coroutine — which then warns
    "never awaited" when collected. Now it is guarded and the coroutine is closed explicitly."""
    app, actions = _app([_h("alpha")])
    seen: list[str] = []

    async def drive() -> None:
        loop = asyncio.get_running_loop()
        original = loop.create_task

        def boom(*_a, **_kw):
            seen.append("refused")
            raise RuntimeError("loop is shutting down")

        loop.create_task = boom  # type: ignore[method-assign]
        try:
            wake_on_connect.schedule(app)  # must not raise into the caller
        finally:
            loop.create_task = original  # type: ignore[method-assign]
        await asyncio.sleep(0)

    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        asyncio.run(drive())
        gc.collect()
    assert seen == ["refused"]  # the guarded call really did fire
    assert [w for w in caught if issubclass(w.category, RuntimeWarning)] == []
    assert actions.calls == []  # nothing ran — the wake was simply dropped


# --------------------------------------------------------------------------- API wiring


def test_stream_connect_schedules_the_wake() -> None:
    """The hook point: `stream_events`' generator prologue fires the trigger, and does so BEFORE it
    blocks on the queue — so the wake never waits on traffic that may never come.

    Driven directly against the router's own async generator rather than a live TestClient stream:
    the endpoint is an infinite loop whose first natural frame is a 15s keepalive, so an HTTP-level
    assertion would either hang or pin a timing constant. `is_disconnected()` returning True makes
    the loop exit on its first check, right after the prologue. `schedule` is swapped for a recorder
    so no real action fires — what's pinned is that the prologue calls it at all."""
    import app.api.events as events_api
    from app.core.events import EventBus

    fired: list[object] = []
    real_schedule = wake_on_connect.schedule
    app = SimpleNamespace(state=SimpleNamespace(event_bus=EventBus()))

    class _FakeRequest:
        def __init__(self) -> None:
            self.app = app

        async def is_disconnected(self) -> bool:
            return True  # exit the loop on the first check, after the prologue has run

    async def drive() -> None:
        response = await events_api.stream_events(_FakeRequest())  # type: ignore[arg-type]
        async for _frame in response.body_iterator:  # drains the prologue, then stops
            break

    try:
        wake_on_connect.schedule = fired.append  # type: ignore[assignment]
        asyncio.run(drive())
    finally:
        wake_on_connect.schedule = real_schedule  # type: ignore[assignment]
    assert fired == [app]


def test_hosts_crud_roundtrips_the_flag_and_keeps_comments() -> None:
    """The flag rides the normal hosts DTO / create / update path through the comment-preserving
    YAML writer: it survives an unrelated edit, clears on an explicit false, and sets on create."""
    tmp = Path(tempfile.mkdtemp())
    try:
        client, cfg = _client(tmp)
        with client as c:
            assert _host(c, "alpha")["wake_on_connect"] is True
            assert _host(c, "beta")["wake_on_connect"] is False

            # an unrelated edit that SENDS the flag unchanged keeps it, and keeps the comments
            body = {
                "name": "alpha",
                "ip": "192.168.1.10",
                "mac": "00:11:22:33:44:55",
                "os_type": "linux",
                "role": "nas",
                "wake_on_connect": True,
            }
            assert c.put("/api/hosts/alpha", json=body).status_code == 200
            text = cfg.read_text(encoding="utf-8")
            assert "# my fleet" in text and "# trailing note" in text and "# the LAN address" in text
            assert load_settings(cfg).computers["alpha"].wake_on_connect is True

            # an explicit false CLEARS it — and the key is removed, not written as `false`
            assert c.put("/api/hosts/alpha", json={**body, "wake_on_connect": False}).status_code == 200
            assert "wake_on_connect" not in cfg.read_text(encoding="utf-8")
            assert _host(c, "alpha")["wake_on_connect"] is False

            # a body that OMITS the field preserves what's stored (the D47 omit-preserves guard,
            # generalized: this PUT is not a PATCH, so a caller that doesn't model the field must not
            # silently clear an owner's flag).
            assert (
                c.put(
                    "/api/hosts/beta",
                    json={**body, "name": "beta", "ip": "192.168.1.20", "wake_on_connect": True},
                ).status_code
                == 200
            )
            assert (
                c.put(
                    "/api/hosts/beta", json={"name": "beta", "ip": "192.168.1.20", "os_type": "linux"}
                ).status_code
                == 200
            )
            assert _host(c, "beta")["wake_on_connect"] is True

            # create writes the flag (omit-when-default keeps a plain machine's entry clean)
            r = c.post(
                "/api/hosts",
                json={
                    "name": "gamma",
                    "ip": "192.168.1.30",
                    "mac": "aa:bb:cc:dd:ee:ff",
                    "wake_on_connect": True,
                },
            )
            assert r.status_code == 201, r.text
            assert r.json()["wake_on_connect"] is True
            assert load_settings(cfg).computers["gamma"].wake_on_connect is True
    finally:
        os.environ.pop("CTRLB_CONFIG", None)
        os.environ.pop("CTRLB_DB", None)


if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    for fn in fns:
        fn()
        print(f"ok  {fn.__name__}")
    print(f"\n{len(fns)} passed")
