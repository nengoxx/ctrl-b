"""D2-C — the LAN-arrival wake trigger + quiet hours (the SECOND presence source beside D50/15b).

The owner's phone holds a reserved DHCP address on the home Wi-Fi; the monitor probes it on the same
30 s tick as the tailnet source, and a confirmed away→home edge wakes the flagged hosts. What this
file pins, in the order the slice builds it:

  1. The probe    — `fleet.ping_addr`, extracted from `ping_host` so the server-OS branch stays one
                    allowlisted file: a 3-echo probe that gets no reply is OFFLINE (not the `ping
                    timeout` ERROR a mechanically-extracted deadline would have produced), a
                    diagnostic exit IS an error, and the fleet sweep still asks exactly once at 2 s.
  2. The reader   — the LAN mapping and its health gate: while the configured health address does not
                    answer, every no-reply that tick is UNKNOWN, so an unplugged server cannot arm
                    every device and wake the fleet on reconnect (the LAN analogue of D50 H2).
  3. Composition  — per-(device, source) arming machines: each source arms on its OWN evidence with
                    its OWN constant, a steady source never cancels the other's edge, and a changed
                    address re-baselines both.
  4. Quiet hours  — the pure wrap-midnight window, and its placement: the edge is always CONSUMED,
                    only the fan-out is skipped, NEITHER cooldown map is stamped, and a simultaneous
                    tailnet edge keeps the whole fan-out eligible.
  5. Config       — the device object's rules and the `wake.lan_*`/`quiet_hours` defaults.
  6. The fold     — `config_version` 2 → 3: `presence_device_ips` → `presence_devices`, deduplicated,
                    new-wins on a document holding both, and the old key GONE from the file.

Scheduling- and network-independent throughout: probes run against a scripted command rather than a
real `ping` (the live semantics were measured on emma and are recorded in `ping_addr`'s docstring),
presence readings are scripted, and elapsed time is simulated by rewinding a stamp. Config writes go
to a temp `CTRLB_HOME`, never the operator's real config.yaml.
"""

from __future__ import annotations

import asyncio
import contextlib
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

import pytest
import yaml
from _async import run_async
from test_monitor_15a import _IP, _scripted_presence
from test_monitor_15b import _arrive, _h, _service

from app import config_migration as cm
from app.adapters.tailnet import DeviceReading
from app.config import CONFIG_VERSION_KEY, PresenceDeviceCfg, QuietHoursCfg, Settings, load_settings
from app.domain.enums import OSType
from app.domain.host import Host
from app.services import fleet, monitor, wake_on_connect
from app.services.fleet import PingResult, ping_addr
from app.services.monitor import LAN, TAILNET, in_quiet_hours, read_lan_presence

_LAN_IP = "192.168.1.143"
_ROUTER = "192.168.1.1"


def _both(name: str = "phone", **over: Any) -> dict[str, Any]:
    """A device watched on BOTH sources — the owner's actual configuration. Both damping constants sit
    at 0 so ONE offline tick arms (the thresholds themselves are pinned as pure `arm()` calls in 15a
    and as a pair of constants below); `_service` does the same for the tailnet one."""
    return {"name": name, "tailnet_ip": _IP, "lan_ip": _LAN_IP, "lan_offline_after_s": 0, **over}


def _lan_only(name: str = "phone", **over: Any) -> dict[str, Any]:
    return {"name": name, "lan_ip": _LAN_IP, "lan_offline_after_s": 0, **over}


# ── 1. the probe ────────────────────────────────────────────────────────────────────────────────


@contextlib.contextmanager
def _scripted_ping(build):
    """Replace the ping COMMAND with a scripted one, keeping every line of `ping_addr` under test —
    the parse, the deadline arithmetic and the exit-code mapping all run for real, against a process
    whose behaviour the test chooses. A real `ping` would make these assertions depend on the box's
    network and on whether the CI runner may open a raw socket."""
    real = fleet._ping_cmd
    fleet._ping_cmd = build  # type: ignore[assignment]
    try:
        yield
    finally:
        fleet._ping_cmd = real  # type: ignore[assignment]


def _sh(script: str):
    return lambda ip, count, timeout_s: ["sh", "-c", script]


def test_a_three_echo_probe_that_gets_no_reply_is_offline_not_an_error() -> None:
    """The distinction the whole feature rests on: `ping` exiting 1 means it asked and heard nothing,
    which is evidence of absence and must ARM the device. Only a check that could not be MADE is an
    error, and an error disarms — so collapsing the two would make the LAN source either never fire
    or fire on nothing."""
    with _scripted_ping(_sh("exit 1")):
        result = run_async(ping_addr(_LAN_IP, count=3, timeout_s=1))
    assert (result.online, result.error) == (False, None)


def test_the_subprocess_deadline_covers_every_echo() -> None:
    """The Emma MED-2 rider, pinned in both directions. `ping_host`'s `timeout_s + 1` is right for one
    echo and kills a 3-echo probe at ~2 s (measured: `-c 3 -W 1` against a silent address takes
    ~3.1 s on emma). Every absent LAN device would then read as a `ping timeout` ERROR rather than
    `offline`, never arm, and the feature would silently never fire — the worst failure mode it has.

    So: a process that takes 2.2 s survives a 3-echo deadline (3 × 1 + 1) and is cut short by a
    1-echo one (1 × 1 + 1). A mechanical extraction fails the first assertion."""
    with _scripted_ping(_sh("sleep 2.2")):
        patient = run_async(ping_addr(_LAN_IP, count=3, timeout_s=1))
        impatient = run_async(ping_addr(_LAN_IP, count=1, timeout_s=1))
    assert (patient.online, patient.error) == (False, None)
    assert impatient.error == "ping timeout"


def test_a_diagnostic_exit_is_an_error_the_arming_machine_disarms_on() -> None:
    """`ping` says "could not ask" with an exit code ≥ 2 and a line on stderr — no route, an
    unresolvable name. That is the one no-reply that is NOT evidence of absence, and reading stderr is
    the only way to tell it from a silent device."""
    with _scripted_ping(_sh("echo 'connect: Network is unreachable' >&2; exit 2")):
        result = run_async(ping_addr(_LAN_IP, count=3, timeout_s=1))
    assert (result.online, result.error) == (False, "connect: Network is unreachable")


def test_a_reply_is_online_with_its_latency() -> None:
    """The positive path still parses what it always did — the TTL test (not the exit code, which
    Windows returns 0 for "Destination host unreachable") and the `time=` capture."""
    with _scripted_ping(_sh("echo '64 bytes from 1.1.1.1: icmp_seq=1 ttl=64 time=1.83 ms'")):
        result = run_async(ping_addr(_LAN_IP, count=3, timeout_s=1))
    assert (result.online, result.ping_ms, result.error) == (True, 1.83, None)


def test_the_fleet_sweep_is_unchanged_by_the_extraction() -> None:
    """One echo, 2 s — the sweep's parameters are not the presence probe's, and sharing the code must
    not have quietly shared the tuning: three echoes per host would triple the fleet's ICMP."""
    asked: list[tuple[str, int, float]] = []

    def build(ip: str, count: int, timeout_s: float) -> list[str]:
        asked.append((ip, count, timeout_s))
        return ["sh", "-c", "exit 1"]

    host = Host(id="alpha", name="alpha", ip="10.0.0.1", os_type=OSType.LINUX)
    with _scripted_ping(build):
        status = run_async(fleet.ping_host(host))
    assert asked == [("10.0.0.1", 1, 2.0)]
    assert (status.host_id, status.online, status.error) == ("alpha", False, None)


# ── 2. the LAN reader + the health gate ─────────────────────────────────────────────────────────


@contextlib.contextmanager
def _scripted_probes(answers: dict[str, PingResult]):
    """Answer each address from a script, in place of the real probe."""

    async def fake(ip: str, *, count: int, timeout_s: float) -> PingResult:
        return answers[ip]

    real = monitor.ping_addr
    monitor.ping_addr = fake  # type: ignore[assignment]
    try:
        yield
    finally:
        monitor.ping_addr = real  # type: ignore[assignment]


def _read(answers: dict[str, PingResult], *, health: str | None = _ROUTER) -> dict[str, DeviceReading]:
    with _scripted_probes(answers):
        return run_async(read_lan_presence([_LAN_IP], count=3, timeout_s=1, health_ip=health))


def test_a_reply_is_online_and_a_miss_is_offline_while_the_link_is_healthy() -> None:
    """The two readings that are evidence, and the gate permitting the negative one."""
    up = _read({_LAN_IP: PingResult(online=True), _ROUTER: PingResult(online=True)})
    assert up[_LAN_IP].state == "online"
    away = _read({_LAN_IP: PingResult(online=False), _ROUTER: PingResult(online=True)})
    assert (away[_LAN_IP].state, away[_LAN_IP].reason) == ("offline", None)


def test_a_miss_is_unknown_while_the_health_address_does_not_answer() -> None:
    """Emma MED-1, whose live probe proved the plan's first version unimplementable: `ping` reports an
    unreachable device and a dead LOCAL link identically (`online=False`, no error), so without this
    gate unplugging the server would arm every device and wake the whole fleet on reconnect. An
    UNKNOWN disarms instead — and it says why, so the journal shows a link outage as a link outage."""
    reading = _read({_LAN_IP: PingResult(online=False), _ROUTER: PingResult(online=False)})[_LAN_IP]
    assert reading.state == "unknown"
    assert _ROUTER in (reading.reason or "")


def test_a_device_that_answers_is_online_even_while_the_gate_is_down() -> None:
    """The gate only ever downgrades a MISS. A reply is a fact whatever the router is doing, and
    treating it as unknown would discard a genuine arrival."""
    assert _read({_LAN_IP: PingResult(online=True), _ROUTER: PingResult(online=False)})[_LAN_IP].state == (
        "online"
    )


def test_a_probe_error_is_unknown_whatever_the_health_address_says() -> None:
    """A check that could not be made outranks the gate: it is already the strongest statement the
    reader can make about that address, and the gate exists to REACH that statement, not to soften it."""
    reading = _read(
        {_LAN_IP: PingResult(online=False, error="ping not found"), _ROUTER: PingResult(online=True)}
    )[_LAN_IP]
    assert (reading.state, reading.reason) == ("unknown", "ping not found")


def test_without_a_health_address_a_miss_is_still_offline() -> None:
    """Unset ⇒ no gate. A documented posture (setting it is the recommended one), not a silent one:
    the feature must work on a LAN whose router does not answer ICMP at all."""
    with _scripted_probes({_LAN_IP: PingResult(online=False)}):
        out = run_async(read_lan_presence([_LAN_IP], count=3, timeout_s=1, health_ip=None))
    assert out[_LAN_IP].state == "offline"


def test_no_lan_addresses_probes_nothing_at_all() -> None:
    """The LAN half is inert until the owner gives a device a `lan_ip` — and the health address is not
    a reason to probe on its own."""
    with _scripted_probes({}):
        assert run_async(read_lan_presence([], count=3, timeout_s=1, health_ip=_ROUTER)) == {}


@contextlib.contextmanager
def _raising_probes(raises: dict[str, BaseException], answers: dict[str, PingResult] | None = None):
    """A probe fan-out where named addresses RAISE. `ping_addr` is written not to raise, and the point
    of the isolation is that "written not to" is not a guarantee the loop can lean on."""

    async def fake(ip: str, *, count: int, timeout_s: float) -> PingResult:
        if ip in raises:
            raise raises[ip]
        return (answers or {}).get(ip) or PingResult(online=True)

    real = monitor.ping_addr
    monitor.ping_addr = fake  # type: ignore[assignment]
    try:
        yield
    finally:
        monitor.ping_addr = real  # type: ignore[assignment]


def test_one_probe_that_raises_is_that_address_unknown_and_nothing_else() -> None:
    """Review MED-1, at the reader: a plain `gather` propagates the FIRST exception and discards every
    other result, so one `OSError` (a `communicate()` failing outside its `wait_for`, a kill on a pid
    that is already gone) would take the whole read down. Isolated, a broken address is a broken
    ADDRESS — UNKNOWN, which disarms — and its neighbour still gets its answer."""
    other = "192.168.1.144"
    with _raising_probes({_LAN_IP: OSError("bad file descriptor")}):
        out = run_async(read_lan_presence([_LAN_IP, other], count=3, timeout_s=1, health_ip=_ROUTER))
    assert out[_LAN_IP].state == "unknown"
    assert "OSError" in (out[_LAN_IP].reason or "")
    assert out[other].state == "online"


def test_a_health_probe_that_raises_closes_the_gate_rather_than_opening_it() -> None:
    """The isolation must not accidentally invert the gate: a health probe we could not MAKE is not
    evidence that the link is fine, so every miss behind it stays UNKNOWN."""
    with _raising_probes({_ROUTER: OSError("boom")}, {_LAN_IP: PingResult(online=False)}):
        out = run_async(read_lan_presence([_LAN_IP], count=3, timeout_s=1, health_ip=_ROUTER))
    assert out[_LAN_IP].state == "unknown"


def test_a_cancelled_probe_is_re_raised_not_reported_as_a_reading() -> None:
    """Cancellation is the loop shutting down, not a device saying something. Swallowing it would
    report a reading nobody took and make the task resist the cancel it was handed."""

    async def scenario() -> None:
        with _raising_probes({_LAN_IP: asyncio.CancelledError()}):
            await read_lan_presence([_LAN_IP], count=3, timeout_s=1, health_ip=None)

    with pytest.raises(asyncio.CancelledError):
        run_async(scenario())


def test_a_broken_lan_probe_never_costs_the_tailnet_its_edge() -> None:
    """The regression class the isolation exists for, end to end (review MED-1, REPRODUCED): the LAN
    and the tailnet share ONE tick, so an exception escaping the LAN read would abort the presence
    half wholesale — and the casualty is the SHIPPED D50 trigger, which has nothing to do with the
    LAN. Here the phone's probe raises every tick while the laptop arrives on the tailnet."""
    svc, actions, _ = _service(
        [_h("alpha")],
        devices=[_lan_only("phone"), {"name": "laptop", "tailnet_ip": _IP}],
    )
    with (
        _raising_probes({_LAN_IP: OSError("bad file descriptor")}),
        _scripted_presence(["offline", "online"]),
    ):
        run_async(svc.tick())
        run_async(svc.tick())
    assert actions.woken == ["alpha"]  # the tailnet edge landed
    assert svc.state.devices["phone"].seen[LAN] == "unknown"  # …and the broken probe disarmed, quietly


def test_the_devices_and_the_health_address_are_probed_concurrently() -> None:
    """An absent device costs `count × timeout_s` (~3 s at the defaults), so sequential probes would
    spend most of a 30 s tick waiting. Pinned structurally rather than by timing: every probe must
    reach a barrier before any of them may return, which can only happen if they are in flight
    together. A sequential implementation deadlocks, and the `wait_for` turns that into a failure."""

    async def scenario() -> dict[str, DeviceReading]:
        barrier = asyncio.Barrier(3)

        async def fake(ip: str, *, count: int, timeout_s: float) -> PingResult:
            await barrier.wait()
            return PingResult(online=True)

        real = monitor.ping_addr
        monitor.ping_addr = fake  # type: ignore[assignment]
        try:
            return await asyncio.wait_for(
                read_lan_presence([_LAN_IP, "192.168.1.144"], count=3, timeout_s=1, health_ip=_ROUTER),
                timeout=5.0,
            )
        finally:
            monitor.ping_addr = real  # type: ignore[assignment]

    assert sorted(run_async(scenario())) == ["192.168.1.143", "192.168.1.144"]


# ── 3. composition: one arming machine per (device, source) ─────────────────────────────────────


@contextlib.contextmanager
def _scripted_lan(states: list[str]):
    """One scripted LAN reading per device per tick, in place of the probe fan-out."""

    async def fake(ips, *, count, timeout_s, health_ip):
        state = states.pop(0)
        return {ip: DeviceReading(ip=ip, state=state) for ip in ips}  # type: ignore[arg-type]

    real = monitor.read_lan_presence
    monitor.read_lan_presence = fake  # type: ignore[assignment]
    try:
        yield
    finally:
        monitor.read_lan_presence = real  # type: ignore[assignment]


def _lan_arrive(svc) -> None:
    """One full LAN absence→arrival on a device with no tailnet address (so the real tailnet reader is
    called with no ips and answers, correctly, nothing)."""
    with _scripted_lan(["offline", "online"]):
        run_async(svc.tick())
        run_async(svc.tick())


def test_a_lan_arrival_wakes_the_flagged_hosts() -> None:
    """The slice, end to end: an absence on the home LAN and a reply after it fires `wake_host`
    through the same `ActionService` chokepoint the tailnet edge and the Wake button use."""
    svc, actions, _ = _service([_h("alpha")], devices=[_lan_only()])
    _lan_arrive(svc)
    assert actions.woken == ["alpha"]


def test_each_source_arms_on_its_own_evidence_and_neither_cancels_the_other() -> None:
    """The main divergence from R63 §4.2, which recommends OR'ing the sources into ONE machine per
    device. Rejected for THIS deployment: the owner keeps Tailscale OFF until they want the servers,
    so a combined state would sit `online` on the LAN all day, the device would never re-arm, and
    turning Tailscale on AT HOME would fire nothing — silently breaking the live-proven D50 workflow.

    Both halves pinned: a LAN arrival fires while the tailnet says `online` throughout, and a tailnet
    arrival fires while the LAN says `online` throughout."""
    svc, actions, _ = _service([_h("alpha")], devices=[_both()], presence_cooldown_s=0, cooldown_s=0)
    with _scripted_presence(["online", "online"]), _scripted_lan(["offline", "online"]):
        run_async(svc.tick())
        run_async(svc.tick())
    assert actions.woken == ["alpha"]  # the LAN edge, un-cancelled by a steady tailnet presence

    with _scripted_presence(["offline", "online"]), _scripted_lan(["online", "online"]):
        run_async(svc.tick())
        run_async(svc.tick())
    assert actions.woken == ["alpha", "alpha"]  # …and the D50 edge still fires with the phone at home


def test_the_two_sources_keep_their_own_damping_constants() -> None:
    """One constant cannot mean both things (R63 §7.3): the tailnet's OFF state is a deliberate act
    (120 s), while an absent LAN reply is a radio whose Doze gaps are the unknown (900 s, five times
    the field's 180 s floor). Here the tailnet threshold is 0 and the LAN's is 900, so one tick of
    absence arms exactly one of the two machines."""
    svc, _actions, _ = _service([_h("alpha")], devices=[_both(lan_offline_after_s=900)])
    with _scripted_presence(["offline"]), _scripted_lan(["offline"]):
        run_async(svc.tick())
    arms = svc.state.devices["phone"].arms
    assert (arms[TAILNET].armed, arms[LAN].armed) == (True, False)


def test_a_device_with_one_address_only_runs_that_source() -> None:
    """An address the owner did not give is a source that cannot say anything — not an UNKNOWN read
    every tick, which would be noise in the journal and an arming machine that can never fire."""
    svc, _actions, _ = _service([_h("alpha")], devices=[_lan_only()])
    with _scripted_lan(["offline"]):
        run_async(svc.tick())
    assert set(svc.state.devices["phone"].arms) == {LAN}


def test_a_changed_address_re_baselines_BOTH_machines() -> None:
    """D50 M2's "never reuse state across ips", generalized to the device object: state is evidence
    about a (name, addresses) pair, so correcting one address drops BOTH machines rather than letting
    an armed flag earned by the old address fire a wake for the new one. Conservative on purpose —
    the source that did not change loses nothing but one absence it can re-observe."""
    svc, _actions, _ = _service([_h("alpha")], devices=[_both()])
    with _scripted_presence(["offline"]), _scripted_lan(["offline"]):
        run_async(svc.tick())
    assert svc.state.devices["phone"].arms[TAILNET].armed is True

    svc._settings.wake.presence_devices = [
        PresenceDeviceCfg(name="phone", tailnet_ip=_IP, lan_ip="192.168.1.199")
    ]
    with _scripted_presence(["online"]), _scripted_lan(["online"]):
        run_async(svc.tick())
    arms = svc.state.devices["phone"].arms
    assert (arms[TAILNET].armed, arms[LAN].armed) == (False, False)


def test_a_rename_re_baselines_rather_than_inheriting() -> None:
    """The same rule from the other side: the name IS the state key, so a renamed device starts from
    nothing instead of inheriting an armed flag observed under the old name."""
    svc, actions, _ = _service([_h("alpha")], devices=[_lan_only()])
    with _scripted_lan(["offline"]):
        run_async(svc.tick())
    svc._settings.wake.presence_devices = [PresenceDeviceCfg(name="pixel", lan_ip=_LAN_IP)]
    with _scripted_lan(["online"]):
        run_async(svc.tick())
    assert "phone" not in svc.state.devices
    assert actions.woken == []  # the arrival the old name was armed for is not the new name's


# ── 4. quiet hours ──────────────────────────────────────────────────────────────────────────────


def _at(text: str, tz: str = "UTC") -> datetime:
    return datetime.fromisoformat(text).replace(tzinfo=ZoneInfo(tz))


def test_a_daytime_window_is_a_plain_interval(monkeypatch) -> None:
    """`start <= t < end` — HA's `time_condition` shape, half-open so the two ends of a pair of
    adjacent windows cannot both claim the same minute."""
    monkeypatch.setattr(monitor, "server_tz_key", lambda: "UTC")
    window = QuietHoursCfg(start="09:00", end="17:00")
    assert in_quiet_hours(window, now=_at("2026-09-04T09:00")) is True
    assert in_quiet_hours(window, now=_at("2026-09-04T12:34")) is True
    assert in_quiet_hours(window, now=_at("2026-09-04T17:00")) is False  # the end is exclusive
    assert in_quiet_hours(window, now=_at("2026-09-04T08:59")) is False


def test_the_window_wraps_midnight(monkeypatch) -> None:
    """The owner's actual window is 23:00–08:00, which is not an interval at all but its INVERSION —
    the case R63 §4.4 flags as the one every naive implementation gets wrong."""
    monkeypatch.setattr(monitor, "server_tz_key", lambda: "UTC")
    window = QuietHoursCfg(start="23:00", end="08:00")
    for text in ("2026-09-04T23:00", "2026-09-04T23:59", "2026-09-04T00:00", "2026-09-04T07:59"):
        assert in_quiet_hours(window, now=_at(text)) is True, text
    for text in ("2026-09-04T08:00", "2026-09-04T12:00", "2026-09-04T22:59"):
        assert in_quiet_hours(window, now=_at(text)) is False, text


def test_no_window_is_never_quiet() -> None:
    """Unset is how quiet hours are DISABLED — the feature ships present and empty."""
    assert in_quiet_hours(None) is False


def test_the_window_is_read_in_the_servers_own_zone(monkeypatch) -> None:
    """The A3 seam (`server_tz_key`), so "23:00" means the same thing to an automation and to quiet
    hours. An aware instant is converted; a naive one is already local."""
    monkeypatch.setattr(monitor, "server_tz_key", lambda: "Europe/Madrid")
    window = QuietHoursCfg(start="23:00", end="08:00")
    assert in_quiet_hours(window, now=_at("2026-09-04T21:30")) is True  # 23:30 in Madrid
    assert in_quiet_hours(window, now=datetime(2026, 9, 4, 21, 30)) is False  # naive = local already


def test_the_autumn_fold_is_well_defined_without_any_dst_machinery(monkeypatch) -> None:
    """Why this is a wall clock and not a pair of instants: 02:30 exists TWICE on 2026-10-25 in
    Madrid, and both passes are inside a 23:00–08:00 window — no fold arithmetic, no double-fire, no
    cronsim. The spring gap is the same statement in reverse: the missing hour is simply never
    observed, so no window boundary can fall inside it."""
    monkeypatch.setattr(monitor, "server_tz_key", lambda: "Europe/Madrid")
    window = QuietHoursCfg(start="23:00", end="08:00")
    madrid = ZoneInfo("Europe/Madrid")
    first = datetime(2026, 10, 25, 2, 30, tzinfo=madrid, fold=0)
    second = datetime(2026, 10, 25, 2, 30, tzinfo=madrid, fold=1)
    assert first.utcoffset() != second.utcoffset()  # genuinely the ambiguous hour
    assert in_quiet_hours(window, now=first) is True
    assert in_quiet_hours(window, now=second) is True


def _window(start_h: int, end_h: int) -> dict[str, str]:
    """A window expressed relative to the server's own clock, so a test can say "now is inside it"
    without freezing time: `_window(-1, 1)` is live this minute, `_window(1, 2)` is not."""
    now = datetime.now(ZoneInfo(monitor.server_tz_key()))
    return {
        "start": (now + timedelta(hours=start_h)).strftime("%H:%M"),
        "end": (now + timedelta(hours=end_h)).strftime("%H:%M"),
    }


def test_a_lan_arrival_inside_the_window_wakes_nothing_and_stamps_nothing(caplog) -> None:
    """The whole feature, and the rule that makes it honest: a suppressed fire stamps NEITHER cooldown
    map. Nothing was attempted, so a stamp would wrongly suppress the first genuine arrival after the
    window — or a deliberate tailnet connect inside it. The journal still says what happened, because
    "why did nothing come up" is the first thing the owner will ask."""
    svc, actions, app = _service([_h("alpha")], devices=[_lan_only()], quiet_hours=_window(-1, 1))
    with caplog.at_level("INFO"):
        _lan_arrive(svc)
    assert actions.calls == []
    assert svc._presence_marks == {} and wake_on_connect.cooldowns(app) == {}
    assert any("suppressed by quiet hours" in r.getMessage() for r in caplog.records)


def test_the_suppressed_edge_is_DROPPED_not_held(caplog) -> None:
    """R63 §4.4's trap, pinned: the edge is consumed before the gate runs, so a 03:00 arrival produces
    no wake that night BY DESIGN rather than detonating at 08:00:00 sharp. The device is left
    DISARMED, so no amount of steady online afterwards fires — only a fresh absence can."""
    svc, actions, _ = _service([_h("alpha")], devices=[_lan_only()], quiet_hours=_window(-1, 1))
    _lan_arrive(svc)
    assert svc.state.devices["phone"].arms[LAN].armed is False
    svc._settings.wake.quiet_hours = None  # the window ends
    with _scripted_lan(["online", "online"]):
        run_async(svc.tick())
        run_async(svc.tick())
    assert actions.calls == []  # nothing was being held
    _lan_arrive(svc)  # …and a genuine arrival after the window still wakes
    assert actions.woken == ["alpha"]


def test_a_window_that_is_not_live_suppresses_nothing() -> None:
    """The control for the two tests above: the same arrival with the window an hour away fires."""
    svc, actions, _ = _service([_h("alpha")], devices=[_lan_only()], quiet_hours=_window(1, 2))
    _lan_arrive(svc)
    assert actions.woken == ["alpha"]


def test_a_tailnet_arrival_is_never_suppressed() -> None:
    """Owner-confirmed scope: a Tailscale connect is a deliberate act ("I want the servers"), and
    silencing that at night would be user-hostile. Only the automatic LAN arrival is gated."""
    svc, actions, _ = _service([_h("alpha")], quiet_hours=_window(-1, 1))
    _arrive(svc)
    assert actions.woken == ["alpha"]


def test_a_coalesced_lan_and_tailnet_arrival_stays_eligible() -> None:
    """Both sources edging in ONE tick: the suppression applies only when EVERY coalesced edge is LAN,
    so the deliberate connect carries the whole fan-out — including the host the LAN edge alone would
    not have woken. The alternative (suppress if ANY edge is LAN) would let a phone's Wi-Fi
    reappearance silently veto an explicit request."""
    svc, actions, _ = _service([_h("alpha")], devices=[_both()], quiet_hours=_window(-1, 1))
    with _scripted_presence(["offline", "online"]), _scripted_lan(["offline", "online"]):
        run_async(svc.tick())
        run_async(svc.tick())
    assert actions.woken == ["alpha"]


# ── 5. config ───────────────────────────────────────────────────────────────────────────────────


def test_the_lan_and_quiet_hours_defaults() -> None:
    """Ship inert: the probe's shape is decided, the window is empty until the owner sets one, and no
    health address is assumed (that value is a property of the owner's LAN, not of the app)."""
    w = Settings().wake
    assert (w.lan_probe_count, w.lan_probe_timeout_s) == (3, 1)
    assert (w.lan_health_ip, w.quiet_hours) == (None, None)
    assert PresenceDeviceCfg(name="phone", lan_ip=_LAN_IP).lan_offline_after_s == 900


def test_a_device_needs_a_name_and_at_least_one_address() -> None:
    """A device with no address looks configured and can never be observed — the same silent failure
    the address validation exists to prevent, one level up."""
    with pytest.raises(ValueError, match="at least one of"):
        Settings.model_validate({"wake": {"presence_devices": [{"name": "phone"}]}})
    with pytest.raises(ValueError, match="needs a name"):
        Settings.model_validate({"wake": {"presence_devices": [{"name": "  ", "lan_ip": _LAN_IP}]}})


def test_names_and_addresses_are_unique_across_the_list() -> None:
    """Two devices sharing a name would share one state entry; two sharing an address are one device
    counted twice. Refused rather than de-duplicated silently: the old list validator dropped
    duplicates on load, but deleting an entry the owner can SEE in their config is a different act."""
    for devices in (
        [{"name": "phone", "lan_ip": _LAN_IP}, {"name": "phone", "lan_ip": "192.168.1.144"}],
        [{"name": "phone", "lan_ip": _LAN_IP}, {"name": "pixel", "lan_ip": _LAN_IP}],
    ):
        with pytest.raises(ValueError, match="is used by two devices"):
            Settings.model_validate({"wake": {"presence_devices": devices}})


def test_a_quiet_window_that_starts_where_it_ends_is_refused() -> None:
    """Emma MED-5: under the wrap-midnight inversion `08:00`–`08:00` means all-day suppression, so an
    accidental one would silently kill every LAN wake. "Unset" already expresses disabled."""
    with pytest.raises(ValueError, match="suppress every"):
        Settings.model_validate({"wake": {"quiet_hours": {"start": "08:00", "end": "08:00"}}})


def test_an_unquoted_clock_time_is_refused_with_the_reason() -> None:
    """`start: 23:00` unquoted is the NUMBER 1380 to a YAML 1.1 parser, and a `time`-typed field would
    read that as 00:23 — silently, in the one feature whose failure mode is silence."""
    with pytest.raises(ValueError, match="NUMBER in YAML"):
        Settings.model_validate({"wake": {"quiet_hours": {"start": 1380, "end": "08:00"}}})


def test_a_clock_time_must_match_WHOLE_never_just_its_first_two_fields() -> None:
    """Review LOW-4: the first cut split on ":" and read `parts[0]`/`parts[1]`, so `"23:00:garbage"`
    was accepted AS `23:00` — a window the owner would read back as the one they typed while it meant
    something else. `HH:MM:SS` survives with a ZERO seconds field (a browser time input emits it when
    its step includes seconds); a real seconds value is refused rather than truncated, which is the
    same bug wearing valid digits."""
    for bad in ("23:00:garbage", "23:00:30", "23:00 and a half", "2300", "23:0", "", "23:00:00:00"):
        with pytest.raises(ValueError, match="quiet-hours time"):
            Settings.model_validate({"wake": {"quiet_hours": {"start": bad, "end": "08:00"}}})
    ok = Settings.model_validate({"wake": {"quiet_hours": {"start": "23:00:00", "end": "8:05"}}})
    assert (ok.wake.quiet_hours.start, ok.wake.quiet_hours.end) == ("23:00", "08:05")  # type: ignore[union-attr]


def test_the_health_address_may_not_be_one_of_the_watched_devices() -> None:
    """Review MED-2: pointing the gate at the device it guards makes the two questions one, and the
    feature stops working in BOTH directions — while the phone is away its own missing reply closes
    the gate (so its absence is UNKNOWN and never arms), and when it returns it is merely online with
    nothing armed behind it. Configured, plausible, and it can never fire."""
    with pytest.raises(ValueError, match="can never arm"):
        Settings.model_validate(
            {
                "wake": {
                    "presence_devices": [{"name": "phone", "lan_ip": _LAN_IP}],
                    "lan_health_ip": _LAN_IP,
                }
            }
        )
    # The router beside the same device is the shape this exists to keep working…
    ok = Settings.model_validate(
        {"wake": {"presence_devices": [{"name": "phone", "lan_ip": _LAN_IP}], "lan_health_ip": _ROUTER}}
    )
    assert ok.wake.lan_health_ip == _ROUTER
    # …and a device watched only on the TAILNET does not collide with anything on the LAN.
    assert (
        Settings.model_validate(
            {"wake": {"presence_devices": [{"name": "phone", "tailnet_ip": _IP}], "lan_health_ip": _ROUTER}}
        ).wake.lan_health_ip
        == _ROUTER
    )


# ── 6. the `config_version` 2 → 3 fold ──────────────────────────────────────────────────────────

V2_YAML = """config_version: 2
server:
  port: 5433
# the owner's own note above the wake block
wake:
  cooldown_s: 300
  presence_device_ips:
  - 100.64.0.5
  - 100.64.0.5
  - 100.64.0.9
computers:
  alpha:
    ip: 192.168.1.10
"""


def _workspace(tmp_path: Path, monkeypatch, text: str) -> Path:
    home = tmp_path / "home"
    home.mkdir()
    (home / "config.yaml").write_text(text, encoding="utf-8")
    monkeypatch.setenv("CTRLB_HOME", str(home))
    monkeypatch.delenv("CTRLB_CONFIG", raising=False)
    return home


def test_the_fold_turns_each_legacy_ip_into_a_device_and_deletes_the_old_key(tmp_path, monkeypatch) -> None:
    """The whole step: each entry becomes `{name: "<ip>", tailnet_ip: "<ip>"}` — the ip is the name
    because it is the only identity the old shape carried — duplicates are dropped (the old field
    validator de-duplicated on LOAD, and a config that was valid yesterday must not become a 422
    today), the legacy key is GONE from the file, and the prose around it survives."""
    home = _workspace(tmp_path, monkeypatch, V2_YAML)
    status = cm.detect(cm.context_from_env())
    assert 3 in status.pending and "wake.presence_device_ips" in status.legacy_keys
    assert cm.apply(cm.context_from_env()).wrote is True

    text = (home / "config.yaml").read_text(encoding="utf-8")
    doc = yaml.safe_load(text)
    assert "presence_device_ips" not in doc["wake"]
    assert doc["wake"]["presence_devices"] == [
        {"name": "100.64.0.5", "tailnet_ip": "100.64.0.5"},
        {"name": "100.64.0.9", "tailnet_ip": "100.64.0.9"},
    ]
    assert doc["wake"]["cooldown_s"] == 300  # the sibling knob is untouched
    assert "# the owner's own note" in text
    assert doc[CONFIG_VERSION_KEY] == 3
    # …and the app can read what the migration wrote.
    devices = load_settings(home / "config.yaml").wake.presence_devices
    assert [(d.name, d.tailnet_ip, d.lan_ip) for d in devices] == [
        ("100.64.0.5", "100.64.0.5", None),
        ("100.64.0.9", "100.64.0.9", None),
    ]


def test_a_document_holding_both_shapes_keeps_the_new_one(tmp_path, monkeypatch) -> None:
    """New-wins, the house rule every fold follows: the hand-authored `presence_devices` is untouched
    and the legacy key is still declared consumed, so a half-migrated file converges rather than
    accreting two sources of truth."""
    home = _workspace(
        tmp_path,
        monkeypatch,
        "config_version: 2\nserver:\n  port: 5433\nwake:\n"
        "  presence_device_ips: [100.64.0.5]\n"
        "  presence_devices:\n  - name: phone\n    tailnet_ip: 100.64.0.9\n    lan_ip: 192.168.1.143\n",
    )
    cm.apply(cm.context_from_env())
    doc = yaml.safe_load((home / "config.yaml").read_text(encoding="utf-8"))
    assert "presence_device_ips" not in doc["wake"]
    assert doc["wake"]["presence_devices"] == [
        {"name": "phone", "tailnet_ip": "100.64.0.9", "lan_ip": "192.168.1.143"}
    ]


def test_an_empty_legacy_list_is_simply_dropped(tmp_path, monkeypatch) -> None:
    """The overwhelmingly common case — the key present and empty, which is what prod holds until the
    owner names a device. No `presence_devices: []` is invented for it."""
    home = _workspace(
        tmp_path, monkeypatch, "config_version: 2\nserver:\n  port: 5433\nwake:\n  presence_device_ips: []\n"
    )
    cm.apply(cm.context_from_env())
    doc = yaml.safe_load((home / "config.yaml").read_text(encoding="utf-8"))
    assert "presence_device_ips" not in doc["wake"] and "presence_devices" not in doc["wake"]


def test_a_legacy_value_that_is_not_a_list_is_refused(tmp_path, monkeypatch) -> None:
    """The `order:` precedent: a shape this step cannot read carries the owner's intent, and deleting
    their line while reporting success is the one outcome worth refusing over."""
    _workspace(
        tmp_path,
        monkeypatch,
        "config_version: 2\nserver:\n  port: 5433\nwake:\n  presence_device_ips: 100.64.0.5\n",
    )
    with pytest.raises(cm.MigrationRefused, match="must be a list"):
        cm.apply(cm.context_from_env())


def test_the_fold_is_idempotent_and_stamps_the_marker(tmp_path, monkeypatch) -> None:
    """The runner's postcondition over this step: nothing applies to what actually landed, the file is
    stamped, and a second run writes nothing."""
    home = _workspace(tmp_path, monkeypatch, V2_YAML)
    cm.apply(cm.context_from_env())
    before = (home / "config.yaml").read_bytes()
    fresh = cm.context_from_env()
    assert cm.needs_migration(fresh) is False
    assert cm.read_marker(fresh.config) == cm.CONFIG_VERSION == 3
    assert cm.apply(cm.context_from_env()).wrote is False
    assert (home / "config.yaml").read_bytes() == before
