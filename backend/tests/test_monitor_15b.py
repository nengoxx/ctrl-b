"""D2-A slice 15b — the presence wake, ARMED: the owner-device edge fans out to `wake_host` (D50).

15a proved the edge is detected honestly; this pins what happens behind it:

  1. Eligibility — the owner directive first: every machine defaults OFF, so an arrival with nothing
                   flagged fires NOTHING. Then the D2-B decision matrix reapplied (flag · `mac` · the
                   cached sweep · the cooldown), and the per-host cooldown override in both directions.
  2. Dedupe      — a fire stamps BOTH cooldown maps before awaiting (D50 M3), several devices arriving
                   in one tick are ONE fan-out, and `reset()` keeps the stamps (they gate ACTIONS).
  3. Fences      — a disable landing mid-read must not fire, and one failing invoke must not cost the
                   other hosts their wake.
  4. Wiring      — the API round-trip for both per-host fields, and the lifespan handing the monitor
                   the same `ActionService` chokepoint the Wake button uses.

Scheduling-independent throughout: the arming machine is driven with scripted readings (never a real
socket), and elapsed time is simulated by REWINDING a cooldown stamp rather than sleeping. Runs as
`python tests/test_monitor_15b.py` from backend/ or under pytest; config writes go to a temp
`CTRLB_CONFIG`, never the operator's real config.yaml.
"""

from __future__ import annotations

import os
import tempfile
from pathlib import Path
from types import SimpleNamespace
from typing import Any

from _async import run_async
from test_monitor_15a import _IP, _scripted_presence, _sweep

from app.adapters import tailnet
from app.config import Settings, load_settings
from app.domain.enums import Actor, OSType
from app.domain.event import Origin
from app.domain.host import Host
from app.services import wake_on_connect
from app.services.monitor import ArmState, MonitorService

_IP2 = "100.64.0.9"


class _FakeActions:
    """Stands in for `ActionService`, recording the exact invocations the fan-out makes."""

    def __init__(self, *, explode: set[str] | None = None) -> None:
        self.calls: list[tuple[str, dict, Actor, bool]] = []
        self.origins: list[Origin] = []
        self._explode = explode or set()

    async def invoke(self, name, raw_args, *, origin, actor=Actor.USER, interactive=True, **_kw):
        self.calls.append((name, raw_args, actor, interactive))
        self.origins.append(origin)
        if raw_args.get("host_id") in self._explode:
            raise RuntimeError("boom")
        return None

    @property
    def woken(self) -> list[str]:
        return [args["host_id"] for _n, args, _a, _i in self.calls]


class _FakeFleet:
    """The two reads the monitor makes of the fleet: the shared sweep (empty — the fleet half has its
    own tests in 15a) and the cheap cached-online set + host list the fan-out filters on."""

    def __init__(self, hosts: list[Host], online: set[str] | None = None) -> None:
        self._hosts = hosts
        self._online = online or set()

    async def status_all(self, *, force: bool = False):
        return _sweep()

    def hosts(self) -> list[Host]:
        return self._hosts

    def cached_online_ids(self) -> set[str]:
        return self._online


def _h(
    hid: str,
    *,
    mac: str | None = "00:11:22:33:44:55",
    presence: bool = True,
    cooldown: int | None = None,
    on_connect: bool = False,
) -> Host:
    return Host(
        id=hid,
        name=hid,
        ip="10.0.0.1",
        mac=mac,
        os_type=OSType.LINUX,
        wake_on_connect=on_connect,
        wake_on_presence=presence,
        wake_presence_cooldown_s=cooldown,
    )


def _service(
    hosts: list[Host],
    *,
    online: set[str] | None = None,
    explode: set[str] | None = None,
    devices: list[str] | None = None,
    **wake: Any,
) -> tuple[MonitorService, _FakeActions, Any]:
    """A monitor wired to fake fleet/actions, with the arming threshold at 0 so ONE offline tick arms
    (the threshold itself is 15a's test, not this slice's). The app carries settings/fleet/actions on
    `state` exactly as the lifespan does, so the D2-B trigger can be driven against the SAME app —
    which is what makes the shared-cooldown assertion real rather than a mock handshake."""
    settings = Settings.model_validate(
        {"wake": {"presence_device_ips": devices or [_IP], "presence_offline_after_s": 0, **wake}}
    )
    fleet = _FakeFleet(hosts, online)
    actions = _FakeActions(explode=explode)
    app = SimpleNamespace(
        state=SimpleNamespace(shutting_down=False, settings=settings, fleet=fleet, actions=actions)
    )
    events = SimpleNamespace(record=None)
    svc = MonitorService(app, settings, fleet, events, actions)  # type: ignore[arg-type]
    return svc, actions, app


def _arrive(svc: MonitorService) -> None:
    """One full absence→arrival: an offline tick arms the device, the next online tick is the edge."""
    with _scripted_presence(["offline", "online"]):
        run_async(svc.tick())
        run_async(svc.tick())


# ── 1. eligibility ──────────────────────────────────────────────────────────────────────────────


def test_an_arrival_with_nothing_flagged_wakes_nothing() -> None:
    """The owner directive, pinned: every machine defaults OFF. A tailnet arrival against a fleet
    where nobody opted in must fire NOTHING — an unflagged host is not a candidate however the edge
    was reached, and this is the assertion that keeps a future refactor from defaulting it on."""
    svc, actions, _ = _service([_h("alpha", presence=False), _h("beta", presence=False)])
    _arrive(svc)
    assert actions.calls == []


def test_a_flagged_offline_host_is_woken_through_the_chokepoint() -> None:
    """The whole slice: `wake_host` via `ActionService.invoke`, non-interactive, as `Actor.SYSTEM`
    with an explicit `system` origin — so the automatic wake is privilege-gated and lands in the Event
    log exactly like a button press, distinguishable from the owner pressing Wake."""
    svc, actions, _ = _service([_h("alpha")])
    _arrive(svc)
    assert actions.calls == [("wake_host", {"host_id": "alpha"}, Actor.SYSTEM, False)]
    assert actions.origins == [Origin(kind="system")]
    assert actions.origins[0].run_id is None  # not descended from an automation run


def test_hosts_without_a_mac_or_already_awake_are_skipped_silently() -> None:
    """Same skip order as D2-B: a MAC-less host would only DENY (log noise nobody asked for at this
    instant), and a host the last sweep saw awake needs no packet. Neither is an error."""
    svc, actions, _ = _service(
        [_h("nomac", mac=None), _h("awake"), _h("asleep")],
        online={"awake"},
    )
    _arrive(svc)
    assert actions.woken == ["asleep"]


def test_a_second_arrival_inside_the_cooldown_fires_nothing() -> None:
    """A tailnet that flaps (the phone toggling wifi) must not re-wake per reconnect. Elapsed time is
    simulated by rewinding the STAMP — no sleep, no monkeypatched clock: the same arithmetic the
    service does, driven from the only value it reads."""
    svc, actions, _ = _service([_h("alpha")], presence_cooldown_s=3600)
    _arrive(svc)
    _arrive(svc)
    assert actions.woken == ["alpha"]  # the second arrival was inside the window

    svc._presence_marks["alpha"] -= 3601  # …and once the window has passed it wakes again
    _arrive(svc)
    assert actions.woken == ["alpha", "alpha"]


def test_the_per_host_cooldown_override_wins_in_both_directions() -> None:
    """`wake_presence_cooldown_s` is per-host precisely because the global is a compromise: a machine
    that costs nothing to wake can have a short window, a heavy one a long window. `None` ⇒ the global,
    and the override must be able to make it BOTH shorter and longer than that."""
    # A long global: only the host that overrode it to 0 wakes again immediately.
    svc, actions, _ = _service(
        [_h("quick", cooldown=0), _h("slow")],
        presence_cooldown_s=3600,
    )
    _arrive(svc)
    _arrive(svc)
    assert actions.woken == ["quick", "slow", "quick"]

    # A zero global: only the host that overrode it UP is suppressed on the second arrival.
    svc2, actions2, _ = _service(
        [_h("guarded", cooldown=3600), _h("free")],
        presence_cooldown_s=0,
    )
    _arrive(svc2)
    _arrive(svc2)
    assert actions2.woken == ["guarded", "free", "free"]


# ── 2. dedupe ───────────────────────────────────────────────────────────────────────────────────


def test_a_presence_fire_also_stamps_the_shared_wake_on_connect_map() -> None:
    """D50 M3, the cross-trigger dedupe. Walking in and opening the dashboard seconds later is the
    single most likely sequence there is, and D2-B would otherwise write a SECOND wake Event for a
    host we just woke. Driven against the real `wake_flagged_hosts` on the SAME app — a mock of the
    map would prove nothing about the trigger that reads it."""
    host = _h("alpha", on_connect=True)  # flagged for BOTH triggers
    svc, actions, app = _service([host])
    _arrive(svc)
    assert actions.woken == ["alpha"]

    run_async(wake_on_connect.wake_flagged_hosts(app))
    assert actions.woken == ["alpha"]  # suppressed by the stamp the presence fire left behind

    # Control: without a presence fire, that same call DOES wake — so the assertion above is the
    # stamp doing the work, not an unrelated skip.
    svc2, actions2, app2 = _service([host])
    run_async(wake_on_connect.wake_flagged_hosts(app2))
    assert actions2.woken == ["alpha"]


def test_two_devices_arriving_in_one_tick_are_one_fan_out() -> None:
    """The owner walking in with a phone AND a laptop is ONE arrival (D50 M3): the presence cooldown
    is per-HOST, shared across devices, so the coalescing is what keeps it from writing a duplicate
    wake — a per-device fan-out would fire twice before either stamp could be read."""
    svc, actions, _ = _service([_h("alpha")], devices=[_IP, _IP2], presence_cooldown_s=3600)
    _arrive(svc)
    assert actions.woken == ["alpha"]
    assert [svc.state.devices[ip].armed for ip in (_IP, _IP2)] == [False, False]


def test_disabling_the_monitor_keeps_the_cooldown_stamps() -> None:
    """D50 M2: `reset()` forgets OBSERVATIONS. A cooldown gates an ACTION, so toggling the master
    switch off and on must NOT hand back a free second wake for a host woken a minute ago — which is
    exactly why the stamps live outside `MonitorState`."""
    svc, actions, _ = _service([_h("alpha")], presence_cooldown_s=3600)
    _arrive(svc)
    svc.reset()
    assert svc.state.devices == {} and svc._presence_marks.keys() == {"alpha"}
    _arrive(svc)
    assert actions.woken == ["alpha"]  # still inside the window, despite the reset


# ── 3. fences ───────────────────────────────────────────────────────────────────────────────────


def test_a_disable_landing_mid_read_fires_nothing() -> None:
    """The master switch must win the race with an in-flight read (D50 M2 — recheck before ACTING).
    The device is armed and the read returns ONLINE, but the Conf save lands inside the await: the
    stale edge may not reach `invoke`."""
    import app.services.monitor as monitor_module

    svc, actions, _ = _service([_h("alpha")])
    svc.state.devices[_IP] = ArmState(armed=True, offline_since=0.0)

    async def read_then_disable(socket_path, ips, **kw):
        svc._settings.monitor.enabled = False
        return {ip: tailnet.DeviceReading(ip=ip, state="online") for ip in ips}

    real = monitor_module.read_presence
    monitor_module.read_presence = read_then_disable  # type: ignore[assignment]
    try:
        run_async(svc.tick())
    finally:
        monitor_module.read_presence = real  # type: ignore[assignment]
    assert actions.calls == []
    assert svc.state.devices == {}  # and no armed ghost survives the window


def test_one_failing_invoke_does_not_cost_the_other_hosts_their_wake() -> None:
    """A broken action on one machine is not the arrival's failure — the fan-out logs it and carries
    on (the fleet half's `_record` rule, applied to actions). The stamp is deliberately kept for the
    failed host too: it is a 'we already tried' mark, not a success receipt."""
    svc, actions, _ = _service([_h("broken"), _h("fine")], explode={"broken"}, presence_cooldown_s=3600)
    _arrive(svc)
    assert actions.woken == ["broken", "fine"]  # the second host still got its packet
    assert svc._presence_marks.keys() == {"broken", "fine"}


# ── 4. wiring ───────────────────────────────────────────────────────────────────────────────────


_SEED = """\
# my fleet
computers:
  alpha:
    ip: 192.168.1.10     # the LAN address
    mac: "00:11:22:33:44:55"
    os_type: linux
    wake_on_presence: true
    wake_presence_cooldown_s: 900
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


def test_the_lifespan_hands_the_monitor_the_action_chokepoint() -> None:
    """The fan-out must go through the SAME `ActionService` every other execution path uses — an
    injected handle, like fleet and events, so nothing reaches for `app.state` mid-tick."""
    tmp = Path(tempfile.mkdtemp())
    try:
        client, _cfg = _client(tmp)
        with client as c:
            assert c.app.state.monitor._actions is c.app.state.actions
    finally:
        for k in ("CTRLB_CONFIG", "CTRLB_DB"):
            os.environ.pop(k, None)


def test_the_presence_fields_round_trip_through_the_hosts_api() -> None:
    """Both fields ride the normal hosts DTO / create / update path through the comment-preserving
    writer, with the SAME treatment as `wake_on_connect`: omit-when-default on write, omit-PRESERVES
    on a body that doesn't model them (this PUT is not a PATCH, so a third client — a script, an older
    tab — must not silently clear the owner's flag), and an explicit value clears/sets."""
    tmp = Path(tempfile.mkdtemp())
    try:
        client, cfg = _client(tmp)
        with client as c:
            alpha = _host(c, "alpha")
            assert (alpha["wake_on_presence"], alpha["wake_presence_cooldown_s"]) == (True, 900)
            beta = _host(c, "beta")
            assert (beta["wake_on_presence"], beta["wake_presence_cooldown_s"]) == (False, None)

            body = {
                "name": "alpha",
                "ip": "192.168.1.10",
                "mac": "00:11:22:33:44:55",
                "os_type": "linux",
                "wake_on_presence": True,
                "wake_presence_cooldown_s": 900,
            }
            # An unrelated edit that SENDS both keeps them — and keeps the file's comments.
            assert c.put("/api/hosts/alpha", json={**body, "role": "nas"}).status_code == 200
            text = cfg.read_text(encoding="utf-8")
            assert "# my fleet" in text and "# trailing note" in text and "# the LAN address" in text
            stored = load_settings(cfg).computers["alpha"]
            assert (stored.wake_on_presence, stored.wake_presence_cooldown_s) == (True, 900)

            # An explicit false/null CLEARS both — and the keys are REMOVED, not written as
            # `false`/`null`, so the YAML keeps its hand-written omit-when-default style.
            cleared = {**body, "wake_on_presence": False, "wake_presence_cooldown_s": None}
            assert c.put("/api/hosts/alpha", json=cleared).status_code == 200
            text = cfg.read_text(encoding="utf-8")
            assert "wake_on_presence" not in text and "wake_presence_cooldown_s" not in text

            # `0` is a REAL value ("no cooldown on this host"), not an absent one.
            assert c.put("/api/hosts/alpha", json={**body, "wake_presence_cooldown_s": 0}).status_code == 200
            assert load_settings(cfg).computers["alpha"].wake_presence_cooldown_s == 0

            # A body that OMITS them preserves what's stored.
            assert (
                c.put(
                    "/api/hosts/alpha", json={"name": "alpha", "ip": "192.168.1.10", "os_type": "linux"}
                ).status_code
                == 200
            )
            a = _host(c, "alpha")
            assert (a["wake_on_presence"], a["wake_presence_cooldown_s"]) == (True, 0)

            # Create writes them (omit-when-default keeps a plain machine's entry clean).
            r = c.post(
                "/api/hosts",
                json={
                    "name": "gamma",
                    "ip": "192.168.1.30",
                    "mac": "aa:bb:cc:dd:ee:ff",
                    "wake_on_presence": True,
                    "wake_presence_cooldown_s": 60,
                },
            )
            assert r.status_code == 201, r.text
            assert (r.json()["wake_on_presence"], r.json()["wake_presence_cooldown_s"]) == (True, 60)
            r = c.post("/api/hosts", json={"name": "delta", "ip": "192.168.1.40"})
            assert r.status_code == 201, r.text
            assert "wake_on_presence" not in cfg.read_text(encoding="utf-8").split("delta:")[1]

            # A negative override is a 422 at the field, mirroring `ComputerCfg`'s own `ge=0`.
            assert c.put("/api/hosts/alpha", json={**body, "wake_presence_cooldown_s": -1}).status_code == 422
    finally:
        for k in ("CTRLB_CONFIG", "CTRLB_DB"):
            os.environ.pop(k, None)


if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    for fn in fns:
        fn()
        print(f"ok  {fn.__name__}")
    print(f"\n{len(fns)} passed")
