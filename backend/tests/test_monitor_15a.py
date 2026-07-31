"""D2-A slice 15a — the MonitorService: fleet up/down Events + presence OBSERVED but disarmed (D50).

What's pinned here, in the order the slice builds it:

  1. Config      — the `monitor:` section's defaults, the cross-field `>= server.poll_seconds` rule,
                   the `wake.presence_*` fields (incl. IP validation/normalization) and the two new
                   per-host fields reaching the domain `Host`.
  2. Transition  — the whole D50 M1 table on the PURE function: UNKNOWN resets both counters (never
                   pauses), a baseline must meet its threshold and installs silently, and a confirmed
                   report after a gap is a real transition.
  3. Arming      — the phone's own machine (D50 H1): a blip never arms, continuous offline does,
                   UNKNOWN disarms, ONLINE-while-unarmed baselines, and an armed device yields
                   EXACTLY one edge.
  4. Reader      — the R12 §4 failure taxonomy, every row → UNKNOWN with a reason, driven through an
                   httpx `MockTransport` (no tailscaled on the box, no sleeps).
  5. The tick    — Events in the D50 M5 vocabulary (status OK BOTH ways), `HostStatus.error` never
                   counting as down, live reconciliation of added/removed targets, and the presence
                   half observing an edge WITHOUT invoking anything (15b is what arms it).
  6. Lifecycle   — the loop task is created in the lifespan and cancelled cleanly at shutdown.

Everything is scheduling-independent: the transition/arming machines are driven with injected
observations and timestamps, and the reader with a fake transport — never a real sleep or a real
socket. Runs as `python tests/test_monitor_15a.py` from backend/ or under pytest; config writes go to
a temp `CTRLB_CONFIG`, never the operator's real config.yaml.
"""

from __future__ import annotations

import contextlib
import os
import tempfile
from datetime import datetime
from pathlib import Path
from typing import Any

import httpx
import pytest
from _async import run_async

from app.adapters import tailnet
from app.config import MonitorCfg, Settings
from app.domain.enums import Actor, RunState
from app.domain.host import HostStatus
from app.services.monitor import (
    ArmState,
    MonitorService,
    TargetState,
    arm,
    observe,
    step,
)

_NOW = "2026-07-31T12:00:00+00:00"


def _ts() -> datetime:
    """A fixed `checked_at` — the monitor never reads it, so a frozen stamp keeps the tests honest
    about what actually drives them (the observation, not the clock)."""
    return datetime.fromisoformat(_NOW)


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


# ── 1. config ───────────────────────────────────────────────────────────────────────────────────


def test_the_monitor_section_defaults() -> None:
    """§D50 M4: every tunable in one section, no magic numbers in the loop."""
    d = MonitorCfg()
    assert (d.enabled, d.poll_seconds, d.down_after_checks, d.up_after_checks) == (True, 30, 3, 2)


def test_the_wake_section_gains_the_presence_tunables_without_moving_the_old_one() -> None:
    """The D2-A half lands as additive fields on the EXISTING `wake:` object (D50), never a second
    wake-ish section — and the D2-B cooldown keeps its own value and meaning."""
    w = Settings().wake
    assert w.cooldown_s == 300  # D2-B, unchanged
    assert w.presence_device_ips == []
    assert (w.presence_offline_after_s, w.presence_cooldown_s) == (120, 3600)
    assert w.tailscale_socket_path == "/var/run/tailscale/tailscaled.sock"


def test_device_ips_are_validated_normalized_and_deduplicated() -> None:
    """A typo'd address must 422 at the boundary rather than become a device that is permanently
    UNKNOWN — the reader cannot tell those apart, and a wake that silently never fires is this
    feature's worst failure mode. Normalizing also keys the arming state canonically."""
    ok = Settings.model_validate({"wake": {"presence_device_ips": [" 100.64.0.5 ", "100.64.0.5", ""]}})
    assert ok.wake.presence_device_ips == ["100.64.0.5"]
    with pytest.raises(Exception) as exc:  # noqa: PT011 — pydantic wraps it; the message is the assert
        Settings.model_validate({"wake": {"presence_device_ips": ["phone.tailnet.ts.net"]}})
    assert "not an IP address" in str(exc.value)


def test_the_monitor_interval_must_cover_the_fleet_cache_ttl() -> None:
    """D50 M4, and not a style rule: the damping counts CONSECUTIVE CHECKS, but the checks come from
    `status_all()`'s TTL cache keyed on `server.poll_seconds`. Ticking faster serves one sweep to
    several ticks, so a single ping would confirm a transition."""
    assert Settings.model_validate({"server": {"poll_seconds": 30}, "monitor": {"poll_seconds": 30}})
    with pytest.raises(Exception) as exc:  # noqa: PT011
        Settings.model_validate({"server": {"poll_seconds": 60}})
    assert "must be >= server.poll_seconds" in str(exc.value)


def test_the_per_host_presence_fields_default_off_and_reach_the_domain_host() -> None:
    """The next per-host wake dimension joins the UNIFIED host object (the `wake_on_connect`
    precedent), and passes through to the `Host` the 15b fan-out will iterate."""
    s = Settings.model_validate(
        {
            "computers": {
                "a": {"ip": "10.0.0.1"},
                "b": {"ip": "10.0.0.2", "wake_on_presence": True, "wake_presence_cooldown_s": 60},
            }
        }
    )
    assert s.computers["a"].wake_on_presence is False
    assert s.computers["a"].wake_presence_cooldown_s is None
    by_id = {h.id: h for h in s.hosts()}
    assert (by_id["a"].wake_on_presence, by_id["a"].wake_presence_cooldown_s) == (False, None)
    assert (by_id["b"].wake_on_presence, by_id["b"].wake_presence_cooldown_s) == (True, 60)


# ── 2. the pure fleet transition function (D50 M1) ──────────────────────────────────────────────


def _drive(seen: list[str], *, up_after: int = 2, down_after: int = 3) -> tuple[TargetState, list[str]]:
    """Replay a sequence of observations through `step`, collecting the transitions it confirmed."""
    state = TargetState()
    fired: list[str] = []
    for s in seen:
        state, transitioned = step(state, s, up_after=up_after, down_after=down_after)  # type: ignore[arg-type]
        if transitioned:
            fired.append(state.reported)
    return state, fired


def test_a_baseline_must_meet_the_threshold_and_installs_silently() -> None:
    """A restart is not an incident: the first CONFIRMED observation sets the state with no Event —
    and one packet is not enough to install one either."""
    state, fired = _drive(["up"])
    assert (state.reported, fired) == ("unknown", [])  # one reply < up_after=2
    state, fired = _drive(["up", "up"])
    assert (state.reported, fired) == ("up", [])  # confirmed, still silent


def test_unknown_resets_both_counters_rather_than_pausing() -> None:
    """The M1 rule with the false edge it closes: pausing would let non-consecutive samples cross a
    threshold that exists precisely to require consecutive ones."""
    # UP, UNKNOWN, UP must NOT confirm up (that would be 2 non-consecutive replies at up_after=2).
    state, fired = _drive(["up", "unknown", "up"])
    assert (state.reported, fired) == ("unknown", [])
    # DOWN, UNKNOWN, DOWN, DOWN must NOT confirm down at down_after=3.
    state, fired = _drive(["down", "unknown", "down", "down"])
    assert (state.reported, fired) == ("unknown", [])


def test_unknown_preserves_the_last_confirmed_report() -> None:
    """Sticky: a blind stretch must not un-know what was already confirmed, or the recovery after it
    would look like a first baseline and stay silent."""
    state, _ = _drive(["up", "up", "unknown", "unknown"])
    assert state.reported == "up"
    assert (state.up_streak, state.down_streak) == (0, 0)


def test_a_confirmed_transition_after_a_gap_is_a_real_event() -> None:
    """The recovery-after-blindness rule (M1): the counters are gone but the last CONFIRMED state is
    not, so a host that came back while the checks were failing still gets its `host_up`."""
    _, fired = _drive(["up", "up"] + ["down"] * 3 + ["unknown", "unknown"] + ["up", "up"])
    assert fired == ["down", "up"]  # the leading pair is the silent baseline


def test_no_prior_baseline_means_no_event_however_it_is_reached() -> None:
    """UNKNOWN → UP with nothing confirmed before it installs silently — a fresh target and a
    just-restarted backend are the same situation."""
    _, fired = _drive(["unknown", "unknown", "up", "up"])
    assert fired == []


def test_a_steady_state_never_re_reports_and_the_streaks_stay_bounded() -> None:
    """Edge-triggered, not level-triggered: 'corsair is off overnight' is ONE row, not 480. And the
    clamp keeps a long-lived process from carrying an unbounded counter."""
    state, fired = _drive(["up", "up"] + ["down"] * 50)
    assert fired == ["down"]
    assert state.down_streak == 3  # clamped at down_after


def test_flapping_that_never_confirms_produces_nothing() -> None:
    """The whole reason damping exists: single-packet loss on wifi and a host mid-reboot answer
    intermittently, and neither is an incident."""
    _, fired = _drive(["up", "up", "down", "up", "down", "up", "down", "up"])
    assert fired == []  # the initial baseline is silent, and nothing since has 3 consecutive misses


def test_a_check_that_failed_is_unknown_not_down() -> None:
    """`HostStatus.error` is HA's `unavailable`, not `off` (R13 §9). Collapsing it would report the
    whole fleet down the moment the server's own `ping` binary breaks."""
    assert observe(HostStatus(host_id="a", online=True, checked_at=_ts())) == "up"
    assert observe(HostStatus(host_id="a", online=False, checked_at=_ts())) == "down"
    assert observe(HostStatus(host_id="a", online=False, checked_at=_ts(), error="ping not found")) == (
        "unknown"
    )


# ── 3. the phone's arming machine (D50 H1) ──────────────────────────────────────────────────────


def _arm_seq(seq: list[tuple[str, float]], *, offline_after_s: float = 120) -> tuple[ArmState, list[float]]:
    """Replay (reading, monotonic-timestamp) pairs — injected clock, never a real sleep."""
    state = ArmState()
    edges: list[float] = []
    for seen, now in seq:
        state, edge = arm(state, seen, now=now, offline_after_s=offline_after_s)  # type: ignore[arg-type]
        if edge:
            edges.append(now)
    return state, edges


def test_a_one_tick_offline_blip_can_never_fire() -> None:
    """The property H1 exists for: a phone that drops off for one 30 s tick is not an arrival when it
    comes back."""
    state, edges = _arm_seq([("online", 0), ("offline", 30), ("online", 60)])
    assert edges == [] and state.armed is False


def test_continuous_offline_arms_and_the_next_online_is_the_edge() -> None:
    """Genuinely away for the threshold, then back → exactly one edge, and the device disarms so a
    steady online stream cannot fire again."""
    seq = [("offline", t) for t in (0, 30, 60, 90, 120)] + [("online", 150), ("online", 180)]
    state, edges = _arm_seq(seq)
    assert edges == [150]
    assert state.armed is False


def test_an_unknown_tick_disarms() -> None:
    """A tailscaled restart (or any unreadable tick) must fire NOTHING on recovery — without this the
    phone connecting during a daemon outage would wake the fleet when the daemon came back."""
    seq = [("offline", t) for t in (0, 120)] + [("unknown", 150), ("online", 180)]
    state, edges = _arm_seq(seq)
    assert edges == [] and state.armed is False


def test_unknown_also_breaks_the_continuity_of_an_offline_run() -> None:
    """The offline stretch must be CONTINUOUS and observed on reads we could actually make: an
    unknown in the middle restarts the clock rather than counting toward the threshold."""
    seq = [("offline", 0), ("unknown", 60), ("offline", 90), ("online", 150)]
    state, edges = _arm_seq(seq)
    assert edges == [] and state.armed is False


def test_online_while_unarmed_baselines_silently() -> None:
    """A device that was online all along (the phone with always-on VPN) never produces an edge — the
    signal is arrival, not presence."""
    _, edges = _arm_seq([("online", t) for t in (0, 30, 60, 90, 120, 150)])
    assert edges == []


def test_the_arming_clock_is_the_offline_threshold_not_the_tick_count() -> None:
    """Time-based, so it is independent of `poll_seconds`: two ticks 200 s apart arm, five ticks 10 s
    apart do not."""
    assert _arm_seq([("offline", 0), ("offline", 200)])[0].armed is True
    assert _arm_seq([("offline", t) for t in (0, 10, 20, 30, 40)])[0].armed is False


# ── 4. the LocalAPI reader's failure taxonomy (R12 §4) ──────────────────────────────────────────

_HEALTHY = {"BackendState": "Running", "Self": {"Online": True}}
_IP = "100.64.0.5"


def _reader(handler) -> dict[str, tailnet.DeviceReading]:
    transport = httpx.MockTransport(handler)
    return run_async(tailnet.read_presence("/run/tailscale/tailscaled.sock", [_IP], transport=transport))


def _routes(*, status: Any = _HEALTHY, whois: Any = None, whois_code: int = 200):
    """A MockTransport handler serving the two LocalAPI endpoints the reader calls."""

    def handler(request: httpx.Request) -> httpx.Response:
        if "/status" in request.url.path:
            if isinstance(status, int):
                return httpx.Response(status)
            return httpx.Response(200, json=status)
        return httpx.Response(whois_code, json=whois) if whois_code == 200 else httpx.Response(whois_code)

    return handler


def test_the_reader_sends_the_host_header_localapi_demands_and_no_origin() -> None:
    """Not cosmetic: `validHost` accepts only `local-tailscaled.sock`, and a stray `Origin`/`Referer`
    is an instant 403 — the base URL IS the auth handshake (R12 §1b)."""
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        if "/status" in request.url.path:
            return httpx.Response(200, json=_HEALTHY)
        return httpx.Response(200, json={"Node": {"Online": True}})

    _reader(handler)
    assert [r.headers["host"] for r in seen] == ["local-tailscaled.sock"] * 2
    assert not any("origin" in r.headers or "referer" in r.headers for r in seen)
    assert seen[0].url.path == "/localapi/v0/status" and seen[0].url.params["peers"] == "false"
    assert seen[1].url.path == "/localapi/v0/whois" and seen[1].url.params["addr"] == _IP


def test_online_true_and_false_are_both_facts_when_the_gate_is_healthy() -> None:
    """The only two readings that are evidence — and `Online: false` really does mean the control
    plane says offline, which is what the arming machine counts."""
    assert _reader(_routes(whois={"Node": {"Online": True}}))[_IP].state == "online"
    assert _reader(_routes(whois={"Node": {"Online": False}}))[_IP].state == "offline"


def test_an_absent_online_key_is_unknown_never_offline() -> None:
    """The central R12 §4 rule, and the reason we read `whois` rather than `status`: the raw Node omits
    `Online` when control has not said, while `status` flattens the nil pointer to `false`. Treating
    that as offline is exactly the false absence that would arm a wake."""
    r = _reader(_routes(whois={"Node": {"Name": "phone", "LastSeen": _NOW}}))[_IP]
    assert r.state == "unknown" and r.reason is not None


def test_every_taxonomy_row_degrades_to_unknown_with_a_reason() -> None:
    """R12 §4, whole table. Each of these is a condition under which the peer's `Online` is not a
    fact, and every one of them must be distinguishable from 'the device left'."""
    cases = {
        "backend not running": _routes(status={"BackendState": "Starting", "Self": {"Online": True}}),
        "logged out": _routes(status={"BackendState": "NeedsLogin"}),
        "our node out of the netmap poll": _routes(status={**_HEALTHY, "Self": {"Online": False}}),
        "status 403": _routes(status=403),
        "status malformed": _routes(status="not-json"),
        "whois 403": _routes(whois_code=403),
        "whois 404 (peer removed / stale config)": _routes(whois_code=404),
        "whois 500": _routes(whois_code=500),
        "whois has no Node": _routes(whois={"UserProfile": {"LoginName": "someone"}}),
    }
    for label, handler in cases.items():
        reading = _reader(handler)[_IP]
        assert reading.state == "unknown", label
        assert reading.reason, f"{label}: an unknown must always say why"


def test_a_dead_socket_is_unknown_and_never_raises() -> None:
    """tailscaled not running is the most ordinary failure there is: the loop must see 'no answer',
    not an exception its blanket guard has to interpret."""

    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("connect: no such file or directory")

    reading = _reader(handler)[_IP]
    assert reading.state == "unknown" and "unreachable" in (reading.reason or "")


def test_a_malformed_whois_body_is_unknown() -> None:
    """A body that parses as JSON but is not an object (or does not parse at all) is a broken read,
    not a presence claim."""

    def handler(request: httpx.Request) -> httpx.Response:
        if "/status" in request.url.path:
            return httpx.Response(200, json=_HEALTHY)
        return httpx.Response(200, content=b"[]")

    assert _reader(handler)[_IP].state == "unknown"


def test_no_configured_devices_costs_nothing_and_reads_nothing() -> None:
    """The tailnet half is inert until the owner names a device — an empty config must not open a
    socket at all."""
    calls: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(str(request.url))
        return httpx.Response(200, json=_HEALTHY)

    out = run_async(
        tailnet.read_presence("/run/tailscale/tailscaled.sock", [], transport=httpx.MockTransport(handler))
    )
    assert out == {} and calls == []


def test_an_empty_socket_path_is_unknown_not_a_crash() -> None:
    """A blanked config value is a misconfiguration, and a misconfiguration is UNKNOWN like any other
    unreadable tick — never an exception out of the reader."""
    out = run_async(tailnet.read_presence("   ", [_IP]))
    assert out[_IP].state == "unknown"


# ── 5. the tick ─────────────────────────────────────────────────────────────────────────────────


class _FakeFleet:
    """Stands in for `FleetService`, serving a scripted sweep per tick."""

    def __init__(self, sweeps: list[list[HostStatus]]) -> None:
        self._sweeps = sweeps
        self.calls = 0

    async def status_all(self, *, force: bool = False):
        sweep = self._sweeps[min(self.calls, len(self._sweeps) - 1)]
        self.calls += 1
        return sweep


class _FakeEvents:
    def __init__(self) -> None:
        self.recorded: list[Any] = []

    async def record(self, event):
        self.recorded.append(event)
        return event


def _service(sweeps: list[list[HostStatus]], **cfg: Any) -> tuple[MonitorService, _FakeEvents]:
    from types import SimpleNamespace

    settings = Settings.model_validate(cfg or {})
    events = _FakeEvents()
    app = SimpleNamespace(state=SimpleNamespace(shutting_down=False))
    svc = MonitorService(app, settings, _FakeFleet(sweeps), events)  # type: ignore[arg-type]
    return svc, events


@contextlib.contextmanager
def _scripted_presence(states: list[str]):
    """Feed the tick a scripted reading per device per tick, in place of the real LocalAPI read — so a
    presence test never touches a socket (the box's own tailscaled must not decide a test's outcome).
    The reader itself is pinned against a MockTransport in §4."""
    import app.services.monitor as monitor_module

    async def fake_read(socket_path, ips, **kw):
        state = states.pop(0)
        return {ip: tailnet.DeviceReading(ip=ip, state=state) for ip in ips}  # type: ignore[arg-type]

    real = monitor_module.read_presence
    monitor_module.read_presence = fake_read  # type: ignore[assignment]
    try:
        yield
    finally:
        monitor_module.read_presence = real  # type: ignore[assignment]


def _sweep(**hosts: Any) -> list[HostStatus]:
    """`_sweep(alpha=True, beta=False, gamma="ping timeout")` — bool is online, str is a failed check."""
    out = []
    for host_id, value in hosts.items():
        error = value if isinstance(value, str) else None
        out.append(HostStatus(host_id=host_id, online=value is True, checked_at=_ts(), error=error))
    return out


def test_a_confirmed_down_writes_one_event_in_the_d50_vocabulary() -> None:
    """D50 M5: action `host_down`, target = the host id, actor SYSTEM + origin system (nobody typed
    this — the app observed it), and **status OK**: the monitor successfully observed a transition, so
    filing it as ERROR would make the frontend's live classifier report it as a failed action."""
    svc, events = _service([_sweep(alpha=True)] * 2 + [_sweep(alpha=False)] * 3)
    for _ in range(5):
        run_async(svc.tick())
    assert len(events.recorded) == 1
    e = events.recorded[0]
    assert (e.action, e.target, e.actor, e.status, e.origin) == (
        "host_down",
        "alpha",
        Actor.SYSTEM,
        RunState.OK,
        "system",
    )
    assert e.summary == "detected down after 3 consecutive misses"


def test_recovery_records_host_up_with_the_same_ok_status() -> None:
    """DOWN is not a failure and UP is not a success — both are observations, so both are OK and the
    direction lives in the action name."""
    svc, events = _service([_sweep(alpha=True)] * 2 + [_sweep(alpha=False)] * 3 + [_sweep(alpha=True)] * 2)
    for _ in range(7):
        run_async(svc.tick())
    assert [(e.action, e.status) for e in events.recorded] == [
        ("host_down", RunState.OK),
        ("host_up", RunState.OK),
    ]
    assert events.recorded[1].summary == "detected up after 2 consecutive replies"


def test_the_boot_baseline_writes_nothing() -> None:
    """A restart is not an incident — the first confirmed state installs silently, or every deploy
    would replay the whole fleet into the audit log."""
    svc, events = _service([_sweep(alpha=True, beta=False)] * 3)
    for _ in range(3):
        run_async(svc.tick())
    assert events.recorded == []
    assert svc.state.hosts["alpha"].reported == "up" and svc.state.hosts["beta"].reported == "down"


def test_a_broken_ping_never_reports_the_fleet_down() -> None:
    """The failure this guards: `ping` missing on the server makes EVERY host error out. That is the
    check failing, not the fleet — an UNKNOWN, forever, with no Events."""
    svc, events = _service([_sweep(alpha="ping not found")] * 10)
    for _ in range(10):
        run_async(svc.tick())
    assert events.recorded == []
    assert svc.state.hosts["alpha"].reported == "unknown"


def test_targets_are_reconciled_live() -> None:
    """D50 M2: a host that left the config loses its state (no ghost counter that would report a
    transition if the name ever came back), and one that arrived baselines silently."""
    svc, events = _service([_sweep(alpha=True)] * 2 + [_sweep(beta=False)] * 3)
    for _ in range(5):
        run_async(svc.tick())
    assert "alpha" not in svc.state.hosts
    assert svc.state.hosts["beta"].reported == "down"
    assert events.recorded == []  # beta only ever baselined


def test_a_failing_audit_write_does_not_abort_the_sweep() -> None:
    """The audit row is best-effort: a DB hiccup on one host must not cost the other hosts their
    observation, and the state is already committed so nothing re-fires forever."""

    class _Boom(_FakeEvents):
        async def record(self, event):
            self.recorded.append(event)
            raise RuntimeError("db is gone")

    svc, _ = _service([_sweep(alpha=True, beta=True)] * 2 + [_sweep(alpha=False, beta=True)] * 3)
    boom = _Boom()
    svc._events = boom  # type: ignore[assignment]
    for _ in range(5):
        run_async(svc.tick())
    assert len(boom.recorded) == 1  # it tried…
    assert svc.state.hosts["alpha"].reported == "down"  # …the state is committed regardless…
    assert svc.state.hosts["beta"].reported == "up"  # …and beta was still observed


def test_the_presence_half_observes_the_edge_and_invokes_nothing() -> None:
    """15a's whole contract: the arming machine runs end-to-end against the real reader and reaches
    the edge, and NOTHING is fired or recorded for it. 15b adds the fan-out behind exactly this point.
    """
    svc, events = _service(
        [_sweep()],
        wake={"presence_device_ips": [_IP], "presence_offline_after_s": 0},
    )
    armed: list[bool] = []
    with _scripted_presence(["offline", "offline", "online", "online"]):
        for _ in range(4):
            run_async(svc.tick())
            armed.append(svc.state.devices[_IP].armed)
    # Armed by the offline run, consumed by the edge on the third tick, and NOT re-armed by the
    # steady online that follows — one edge per absence.
    assert armed == [True, True, False, False]
    assert events.recorded == []  # an observation the owner cannot act on yet is not an audit record


def test_a_device_removed_from_the_config_loses_its_state() -> None:
    """State keys on the NORMALIZED ip and is never reused across different ones (D50 M2) — an owner
    swapping the watched device must not inherit the old one's armed flag."""
    svc, _ = _service([_sweep()], wake={"presence_device_ips": [_IP, "100.64.0.9"]})
    svc.state.devices[_IP] = ArmState(armed=True)
    svc._settings.wake.presence_device_ips = ["100.64.0.9"]
    with _scripted_presence(["offline"]):
        run_async(svc.tick())
    assert _IP not in svc.state.devices
    assert svc.state.devices["100.64.0.9"].armed is False  # the new device starts from nothing


def test_disabling_the_monitor_clears_its_state() -> None:
    """D50 M2: a disable forgets counters and disarms, so re-enabling re-baselines silently instead of
    reporting a transition against a state observed before an unknown stretch of blindness."""
    svc, _ = _service([_sweep(alpha=True)])
    svc.state.hosts["alpha"] = TargetState(reported="up", up_streak=2)
    svc.state.devices[_IP] = ArmState(armed=True)
    svc.reset()
    assert svc.state.hosts == {} and svc.state.devices == {}


# ── 6. lifecycle ────────────────────────────────────────────────────────────────────────────────


def test_the_monitor_is_wired_into_the_lifespan_and_cancelled_at_shutdown() -> None:
    """Started unconditionally after fleet + events (disabled would just idle the tick, so the Conf
    switch stays live), and cancelled + awaited before the DB it writes Events through closes."""
    with _workspace(), _client() as c:
        state = c.app.state
        assert isinstance(state.monitor, MonitorService)
        assert not state.monitor_task.done()
        assert state.monitor.cfg is state.settings.monitor  # live section, never a boot-time copy
    assert state.monitor_task.cancelled() or state.monitor_task.done()


if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    for fn in fns:
        fn()
        print(f"ok  {fn.__name__}")
    print(f"\n{len(fns)} passed")
