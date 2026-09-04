"""MonitorService — the backend's own periodic watcher (D2-A / D50 + D2-C, research R12 + R13 + R63).

ONE lifespan loop doing a few cheap reads per tick and feeding two consumers: confirmed fleet up/down
transitions become Events, and an owner-device ARRIVAL — on the tailnet (D50/15b) or on the home LAN
(D2-C) — fires the wake for every host flagged `wake_on_presence`. The loop is
`AutomationRunner.loop()`'s shape verbatim
— sleep-then-work so overlap is structurally impossible, config re-read per tick so the master switch
is live, blanket guard per tick, cancelled and awaited at shutdown. None of A3's arbiter/claim/shield
machinery is copied: that solves durable run ownership, which monitoring does not have.

Four properties are load-bearing and easy to break:

  1. **UNKNOWN is first-class and sticky.** A check that could not be MADE — `HostStatus.error` (the
     ping binary missing, a timeout), a tailscaled restart, our node out of the netmap poll — is not
     "down". It resets both counters and preserves the last CONFIRMED state, so a flap that never
     confirms produces nothing and a daemon outage cannot manufacture an edge (R13 §4 "tri-state";
     D50 M1).
  2. **The boot baseline is silent.** The first confirmed observation after a restart installs the
     state without an Event: a restart is not an incident, and the alternative replays the whole
     fleet into the audit log every deploy. The baseline still has to MEET the threshold, so a single
     packet cannot install a state either.
  3. **The phone has its own arming machine, not the fleet's counters** (D50 H1) — one PER SOURCE
     (D2-C). Continuous healthy OFFLINE for that source's threshold ARMS; the next healthy ONLINE is
     the edge; any UNKNOWN tick, a disable, or a reconfig DISARMS. That pairing is what makes "a
     tailscaled restart fires nothing" and "a genuine reconnect fires" simultaneously true — the
     fleet's 3/2 damping alone would fire on recovery from a daemon outage.
  4. **State is per-instance and per-target-key.** Counters live on the service object (never a module
     global — two `TestClient` apps in one process must not share them), keyed by host id and by
     device NAME. Every tick prunes targets that left the config and silently baselines the ones that
     arrived, so an edit cannot leave a ghost counter behind.

The two presence sources keep SEPARATE machines and are OR'd at the fan-out — deliberately not
R63 §4.2's recommendation of OR'ing them at the observation into one machine per device. That ladder
assumes the steady source is UP at home; here the owner keeps Tailscale OFF until they want the
servers, so a combined state would sit `online` on the LAN continuously, the device would never
re-arm, and turning Tailscale on AT HOME would fire nothing — silently breaking the live-proven D50
workflow. The two sources answer different questions ("the owner is home" vs "the owner wants the
servers"), so they carry different constants and their own evidence.

The fleet read is `FleetService.status_all()`, never `ping_host`: one sweep shared with the UI, which
is also why `monitor.poll_seconds >= server.poll_seconds` is validated at the config boundary. The
LAN presence probe is the one exception — it is `fleet.ping_addr` directly, because it asks a
different question (this address, three echoes) of an address that is not a fleet host at all.
"""

from __future__ import annotations

import asyncio
import logging
import time
from collections.abc import Sequence
from dataclasses import dataclass, field
from datetime import datetime
from typing import TYPE_CHECKING, Literal
from zoneinfo import ZoneInfo

from app.adapters.tailnet import DeviceReading, PresenceState, read_presence
from app.config import MonitorCfg, PresenceDeviceCfg, QuietHoursCfg, Settings
from app.domain.enums import Actor, RunState
from app.domain.event import Event, Origin
from app.domain.host import HostStatus
from app.services import wake_on_connect
from app.services.action_service import ActionService
from app.services.automations.schedule import server_tz_key
from app.services.events import EventService
from app.services.fleet import FleetService, PingResult, ping_addr

if TYPE_CHECKING:
    from fastapi import FastAPI

log = logging.getLogger(__name__)

#: One observation of a target — and equally the last CONFIRMED state, which is why it is ONE type:
#: `unknown` is both "this check said nothing" and "nothing has been confirmed yet".
Liveness = Literal["up", "down", "unknown"]

#: The Event vocabulary for a confirmed host transition (D50 M5). `status = OK` in BOTH directions:
#: the monitor successfully observed a transition, and a host going down is not a failed action —
#: `ERROR` would make the frontend's live classifier file host-downs under `action_failed` today.
_ACTION: dict[Liveness, str] = {"up": "host_up", "down": "host_down"}
#: What the summary calls the checks that confirmed it, so the row says how much evidence there was.
_EVIDENCE: dict[Liveness, str] = {"up": "replies", "down": "misses"}


@dataclass
class TargetState:
    """A host's damping state: two consecutive counters plus the last CONFIRMED report (D50 M1)."""

    reported: Liveness = "unknown"
    up_streak: int = 0
    down_streak: int = 0


def observe(status: HostStatus) -> Liveness:
    """One `HostStatus` as an observation. `error` outranks `online` because it means the check did
    not happen — HA's `unavailable` vs `off` (R13 §9). Collapsing it would report the whole fleet down
    the moment the server's own `ping` breaks."""
    if status.error:
        return "unknown"
    return "up" if status.online else "down"


def step(state: TargetState, seen: Liveness, *, up_after: int, down_after: int) -> tuple[TargetState, bool]:
    """The pure fleet transition function → (next state, whether it CONFIRMED a new report).

    Pure and standalone so the whole D50 M1 table is unit-testable without a loop, a clock or a
    database (the `AutomationRunner._terminal` precedent). The rules, each with the false edge it
    closes:

    * **UNKNOWN resets BOTH counters** and preserves `reported`. Not "pauses": pausing would let
      non-consecutive samples (down, unknown, down, down) cross a threshold meant to require
      consecutive ones.
    * **A baseline must itself meet the threshold, and installs silently.** `reported == "unknown"`
      means nothing has been confirmed yet — a restart, or a target that just appeared — and there is
      no transition to report from an unknown.
    * **A confirmed report after a gap IS a transition** when the last confirmed state differs, so a
      host that recovers while the checks were failing still gets its recovery Event.

    Streaks clamp at their threshold rather than growing forever: past the threshold the count no
    longer carries information, and an unbounded counter on a long-lived process is pure litter.
    """
    if seen == "unknown":
        return TargetState(reported=state.reported), False
    threshold = up_after if seen == "up" else down_after
    streak = min((state.up_streak if seen == "up" else state.down_streak) + 1, max(1, threshold))
    nxt = TargetState(
        reported=state.reported,
        up_streak=streak if seen == "up" else 0,
        down_streak=streak if seen == "down" else 0,
    )
    if streak < threshold or state.reported == seen:
        return nxt, False
    nxt.reported = seen
    return nxt, state.reported != "unknown"  # a first baseline installs, but says nothing


@dataclass
class ArmState:
    """A watched device's arming state (D50 H1).

    `offline_since` is the monotonic instant the CURRENT continuous run of healthy OFFLINE readings
    began — monotonic because an NTP step must not be able to arm or un-arm a device (R13 §7 flags
    exactly this as where Kuma's wall-clock arithmetic goes wrong). On Linux — the deployed profile,
    D32 — CLOCK_MONOTONIC also excludes suspend time; Windows' QPC counts standby, so a
    suspends-and-resumes server deploy would need a resume guard before trusting long gaps.
    """

    armed: bool = False
    offline_since: float | None = None


def arm(state: ArmState, seen: PresenceState, *, now: float, offline_after_s: float) -> tuple[ArmState, bool]:
    """The pure device arming machine → (next state, whether THIS tick is the wake edge).

    Deliberately not the fleet's 3/2 counters. The fleet damps a NOISY signal in both directions; this
    answers one question — "did the owner just arrive?" — and the only honest evidence for that is a
    device that was genuinely away (continuously offline, on reads we could actually make) and is now
    back. Hence: UNKNOWN disarms outright rather than counting, and ONLINE while unarmed baselines
    silently instead of firing. A one-tick radio blip can never reach the edge.
    """
    if seen == "unknown":
        return ArmState(), False  # a reading we could not make is not evidence of absence
    if seen == "offline":
        since = now if state.offline_since is None else state.offline_since
        return ArmState(armed=state.armed or (now - since) >= offline_after_s, offline_since=since), False
    return ArmState(), state.armed


#: The presence SOURCES, and the names the journal calls them by. A source is a name plus its own
#: arming machine per device (D2-C): adding a third is an entry here and a reading, never a new field
#: on every state object.
TAILNET = "tailnet"
LAN = "lan"


@dataclass
class DeviceState:
    """One watched device's presence state: the addresses it was baselined against, plus an
    INDEPENDENT arming machine per source (D2-C).

    `fingerprint` generalizes D50 M2's "never reuse state across ips" from the ip key to the device
    object: an edited address is a different device as far as evidence goes, so BOTH machines start
    over rather than inheriting an armed flag observed against something else. A rename is the same
    rule from the other side — the name is the state key, so it prunes and re-baselines.

    `seen` is the last observation LOGGED per source. It is what keeps the permanent
    state-transition journal to a line per CHANGE rather than a line per device per source per tick.
    """

    fingerprint: tuple[str | None, str | None] = (None, None)
    arms: dict[str, ArmState] = field(default_factory=dict)
    seen: dict[str, PresenceState] = field(default_factory=dict)


def _probe_answer(settled: PingResult | BaseException) -> PingResult:
    """One `gather(return_exceptions=True)` slot as a probe answer (D2-C review MED-1).

    `ping_addr` is written not to raise, and "written not to" is not "cannot": `communicate()` can
    fail outside its own `wait_for`, and a kill can land on a pid that is already gone. Under a plain
    `gather` ONE such `OSError` propagates out of the whole presence read — taking down the tick that
    also carries the shipped TAILNET edge, which has nothing to do with the LAN. Isolating each probe
    keeps a broken address a broken ADDRESS: an UNKNOWN reading, which disarms, which is what a check
    we could not make has meant since D50 M1.

    Cancellation is deliberately NOT swallowed. A cancelled probe means the loop is shutting down (or
    an outer timeout fired); turning that into "the phone is unknown" would report a reading nobody
    took and, worse, make the task resist the cancel it was handed.
    """
    if isinstance(settled, asyncio.CancelledError):
        raise settled
    if isinstance(settled, BaseException):
        detail = f"{type(settled).__name__}: {settled}" if str(settled) else type(settled).__name__
        return PingResult(online=False, error=f"the probe failed ({detail})")
    return settled


async def read_lan_presence(
    ips: Sequence[str], *, count: int, timeout_s: float, health_ip: str | None
) -> dict[str, DeviceReading]:
    """Probe the owner's devices on the home LAN → the SAME reading-per-address contract the tailnet
    reader returns. Never raises; always answers for every ip.

    `DeviceReading` is reused rather than mirrored: it says nothing about tailscaled (R63 §4.1), and
    one presence vocabulary is what lets `arm()` stay source-agnostic. The mapping is `ping`'s own
    three-way answer — a reply is ONLINE, a check that could not be made is UNKNOWN, a miss is
    OFFLINE — with one gate over the last row.

    **The health gate** (the LAN analogue of D50 H2, and the reason this is not two lines): `ping`
    reports an unreachable address and a dead LOCAL link identically — no reply, no error — so an
    unplugged server would read as every device leaving at once, arm them all, and wake the whole
    fleet on the next reconnect. `wake.lan_health_ip` (normally the router) is probed alongside the
    devices in the same `gather`; while it does not answer, every no-reply that tick is UNKNOWN, which
    disarms rather than arms. Unset ⇒ no gate, which is a documented posture rather than an oversight.

    Probes run concurrently for the same reason the fleet sweep does: an absent device costs
    `count × timeout_s` (~3 s at the defaults), and sequential probes would eat the 30 s tick — and
    each one is ISOLATED (`return_exceptions=True`, see `_probe_answer`), because a shared `gather`
    is exactly where one address's failure becomes the whole tick's.
    """
    if not ips:
        return {}  # nothing to ask about: the LAN half costs literally nothing, health address included
    targets = [*ips, health_ip] if health_ip else list(ips)
    settled = await asyncio.gather(
        *(ping_addr(ip, count=count, timeout_s=timeout_s) for ip in targets),
        return_exceptions=True,
    )
    results = [_probe_answer(r) for r in settled]
    healthy = results[-1].online if health_ip else True
    out: dict[str, DeviceReading] = {}
    for ip, result in zip(ips, results[: len(ips)], strict=True):
        if result.online:
            out[ip] = DeviceReading(ip=ip, state="online")
        elif result.error:
            out[ip] = DeviceReading(ip=ip, state="unknown", reason=result.error)
        elif healthy:
            out[ip] = DeviceReading(ip=ip, state="offline")
        else:
            out[ip] = DeviceReading(
                ip=ip, state="unknown", reason=f"no reply, and {health_ip} did not answer either"
            )
    return out


def _arrivals(arrived: Sequence[tuple[str, str]]) -> str:
    """`[("phone", "lan")]` → `"phone (lan)"` — one arrival rendered for the journal. Which SOURCE
    noticed is the first thing the owner needs when asking why something did or did not wake."""
    return ", ".join(f"{name} ({source})" for name, source in arrived)


def in_quiet_hours(window: QuietHoursCfg | None, *, now: datetime | None = None) -> bool:
    """Is the wall clock inside the owner's quiet window (D2-C)? Pure, with an injectable `now`.

    A window is an INTERVAL, not an instant, so this is deliberately not a cron: `cronsim` answers
    "when does this next match", which is the wrong question and would drag A3's fire-time machinery
    in to answer it. HA's `time_condition` shape instead — `start <= t < end`, INVERTED when the
    window wraps midnight (23:00–08:00 means "at or after 23:00, OR before 08:00"). `start == end` is
    refused at the config boundary, so those two cases are the whole space.

    Local time comes from the A3 seam (`server_tz_key`), the same zone an automation saved without an
    explicit `tz` runs in — so "23:00" means one thing across both features. No DST machinery is
    needed or wanted: a wall-clock window is well defined across a fold (23:30 is inside 23:00–08:00
    on both passes of an ambiguous hour) and across a spring gap (the missing hour is simply never
    observed). That is precisely why the comparison is a wall clock and not a pair of instants.
    """
    if window is None:
        return False
    zone = ZoneInfo(server_tz_key())
    local = datetime.now(zone) if now is None else (now.astimezone(zone) if now.tzinfo else now)
    minutes = local.hour * 60 + local.minute
    start, end = window.start_minutes, window.end_minutes
    if start < end:
        return start <= minutes < end
    return minutes >= start or minutes < end


@dataclass
class MonitorState:
    """Everything the loop remembers between ticks — one object so a disable/re-enable clears it all."""

    hosts: dict[str, TargetState] = field(default_factory=dict)
    devices: dict[str, DeviceState] = field(default_factory=dict)


class MonitorService:
    """Owns the loop and the in-memory observation state. Constructed in the lifespan after fleet +
    events exist; `loop()` is the task and `tick()` is the single unit of work."""

    def __init__(
        self,
        app: "FastAPI",
        settings: Settings,
        fleet: FleetService,
        events: EventService,
        actions: ActionService,
    ) -> None:
        self._app = app
        self._settings = settings
        self._fleet = fleet
        self._events = events
        self._actions = actions
        self._state = MonitorState()
        #: `{host_id: monotonic instant of the last presence-driven wake}`. Deliberately OUTSIDE
        #: `MonitorState` (D50 M2): `reset()` forgets OBSERVATIONS, and a cooldown gates ACTIONS — so
        #: toggling the monitor off and on again must not hand back a free second wake for a host that
        #: was woken a minute ago. On the instance, never a module global, for `wake_on_connect`'s
        #: reason: two `TestClient` apps in one process must not share cooldowns.
        self._presence_marks: dict[str, float] = {}

    @property
    def cfg(self) -> MonitorCfg:
        """The live `monitor:` section. Read per use — a Conf edit applies with no restart."""
        return self._settings.monitor

    @property
    def state(self) -> MonitorState:
        """The observation state — exposed for diagnostics and the tests, never copied by callers."""
        return self._state

    # ── the loop ──────────────────────────────────────────────────────────────────────────────────

    async def loop(self) -> None:
        """Poll forever (the `AutomationRunner.loop` shape). Sleep FIRST, so two ticks can never
        overlap however long the sweep takes; `poll_seconds` and `enabled` are BOTH re-read after the
        sleep, so turning the monitor off idles the loop instead of needing a restart. Every failure is
        logged and swallowed: a poll loop that dies takes the feature down until the next restart."""
        while True:
            await asyncio.sleep(max(1, self.cfg.poll_seconds))
            if not self.cfg.enabled:
                self.reset()  # D50 M2 — a disable forgets its counters, so a re-enable re-baselines
                continue
            if getattr(self._app.state, "shutting_down", False):
                continue  # a sweep started now would race the fleet cache into a closing app
            try:
                await self.tick()
            except Exception:  # noqa: BLE001 — the monitor must never die
                log.exception("monitor tick failed")

    def reset(self) -> None:
        """Forget every counter, baseline and armed flag (D50 M2). Called when the monitor is turned
        off: re-enabling then re-baselines silently rather than reporting a transition against a state
        observed before an unknown length of blindness. Cooldown STAMPS are deliberately not this
        object's business — they gate actions, not observations, and must survive a toggle."""
        if self._state.hosts or self._state.devices:
            self._state = MonitorState()

    async def tick(self) -> None:
        """One observation of everything watched: the shared fleet sweep, then the owner's devices.

        The two halves are independent by construction — a tailnet (or a LAN) that cannot be read must
        not cost the fleet its transition Events, so the presence half runs after the fleet half and
        its own failures are already UNKNOWN readings rather than exceptions.
        """
        await self._tick_fleet()
        await self._tick_presence()

    # ── the fleet half ────────────────────────────────────────────────────────────────────────────

    async def _tick_fleet(self) -> None:
        """Damp one shared sweep into confirmed transitions and record an Event for each.

        `status_all()` (not `ping_host`) is the ONE fleet read: the UI's poll and this tick share the
        same TTL-cached sweep, so watching the fleet adds no ICMP traffic and the loop's view can never
        diverge from the dashboard's.
        """
        cfg = self.cfg
        statuses = await self._fleet.status_all()
        # Reconcile FIRST (D50 M2): a host removed from the config loses its counters here rather than
        # lingering as a ghost that would report a transition if the name ever came back.
        live = {s.host_id for s in statuses}
        for gone in [hid for hid in self._state.hosts if hid not in live]:
            del self._state.hosts[gone]
        for status in statuses:
            before = self._state.hosts.get(status.host_id, TargetState())  # an addition baselines
            seen = observe(status)
            state, transitioned = step(
                before, seen, up_after=cfg.up_after_checks, down_after=cfg.down_after_checks
            )
            self._state.hosts[status.host_id] = state
            if transitioned:
                checks = cfg.up_after_checks if state.reported == "up" else cfg.down_after_checks
                if not await self._record(status.host_id, state.reported, checks):
                    # A lost write must not lose the transition (15a review, MED): reverting
                    # `reported` makes the NEXT matching sample confirm again — the streak is
                    # already clamped at threshold — so the write retries naturally, sample by
                    # sample, until it lands. No queue, and a recovered host stops the retry by
                    # confirming the other direction instead.
                    state.reported = before.reported

    async def _record(self, host_id: str, reported: Liveness, checks: int) -> bool:
        """One audit row per CONFIRMED host transition (D50 M5) → whether the write landed.

        `actor=SYSTEM` + `origin=system` is D-4's semantics for "nobody typed this, the app itself
        observed it" — the same attribution the D2-B automatic wake carries. The timestamp is DETECTION
        time, not the moment the host actually went, and the summary says how many checks it took so
        the row is honest about that lag. A failing write must not abort the rest of the sweep — but it
        must not be SILENT either: the caller un-commits the report so the next matching sample retries
        it (15a review, MED — the old shape committed first and swallowed, losing the incident from the
        audit log forever).
        """
        try:
            await self._events.record(
                Event(
                    actor=Actor.SYSTEM,
                    action=_ACTION[reported],
                    target=host_id,
                    status=RunState.OK,
                    summary=f"detected {reported} after {checks} consecutive {_EVIDENCE[reported]}",
                    origin="system",
                )
            )
        except Exception:  # noqa: BLE001 — audit must not break the sweep
            log.exception("failed to record the %s transition for host %s", reported, host_id)
            return False
        return True

    # ── the presence half ─────────────────────────────────────────────────────────────────────────

    def _reconcile_devices(self, devices: Sequence[PresenceDeviceCfg]) -> None:
        """Drop the state of every device the config no longer names AS IT NAMED IT (D50 M2, D2-C).

        One rule covers both edits, because they are the same rule: state is evidence about a
        (name, addresses) pair, so a device that left, a device that was renamed, and a device whose
        address the owner corrected all lose it and re-baseline. Keeping it would let an armed flag
        earned by one address fire a wake for another.
        """
        live = {d.name: d.addresses for d in devices}
        for name, state in list(self._state.devices.items()):
            if live.get(name) != state.fingerprint:
                del self._state.devices[name]

    async def _tick_presence(self) -> None:
        """Observe the owner's devices on BOTH sources, drive their arming machines, and wake the
        flagged hosts on an arrival.

        Two sources, one machine EACH per device (D2-C — see the module docstring for why they are not
        combined at the observation), read concurrently: the tailnet read is a 0.16 ms socket call and
        the LAN probe is up to `count × timeout_s` of ICMP, so serializing them would spend the
        cheap one's latency waiting for the expensive one.

        Edges are COLLECTED across the whole device loop and fanned out ONCE (D50 M3): the owner
        walking in with a phone and a laptop is one arrival, and a fan-out per device — or per source
        — would write duplicate wake Events for it. Each edge carries its SOURCE, because quiet hours
        suppress an arrival only when every edge in it is LAN. The device loop only OBSERVES; every
        decision about hosts lives in the fan-out.
        """
        wake = self._settings.wake
        self._reconcile_devices(wake.presence_devices)
        if not wake.presence_devices:
            return
        readings, lan_readings = await asyncio.gather(
            read_presence(
                wake.tailscale_socket_path, [d.tailnet_ip for d in wake.presence_devices if d.tailnet_ip]
            ),
            read_lan_presence(
                [d.lan_ip for d in wake.presence_devices if d.lan_ip],
                count=wake.lan_probe_count,
                timeout_s=wake.lan_probe_timeout_s,
                health_ip=wake.lan_health_ip,
            ),
        )
        # The await above is a reconfiguration window (15a review, MED): a Conf save lands between the
        # reads starting and returning, so re-check the LIVE config before they drive anything.
        # Without this, a stale reading could emit the edge 15b fires behind DESPITE the master switch,
        # or resurrect state for a device the prune above just removed — and a disable/re-enable inside
        # one window would then keep that ghost armed indefinitely.
        if not self.cfg.enabled:
            self.reset()
            return
        wake = self._settings.wake
        self._reconcile_devices(wake.presence_devices)
        now = time.monotonic()
        arrived: list[tuple[str, str]] = []
        for device in wake.presence_devices:
            state = self._state.devices.setdefault(device.name, DeviceState(fingerprint=device.addresses))
            for source, ip, source_readings, offline_after_s in (
                (TAILNET, device.tailnet_ip, readings, wake.presence_offline_after_s),
                (LAN, device.lan_ip, lan_readings, device.lan_offline_after_s),
            ):
                if ip is None:
                    continue  # an address the owner did not give is a source that cannot say anything
                # A device ADDED mid-window has no reading yet — an UNKNOWN tick, which correctly
                # baselines it disarmed rather than trusting a read it was not part of.
                reading = source_readings.get(ip) or DeviceReading(ip=ip, state="unknown", reason="not read")
                armed, edge = arm(
                    state.arms.get(source, ArmState()),
                    reading.state,
                    now=now,
                    offline_after_s=offline_after_s,
                )
                state.arms[source] = armed
                if edge:
                    arrived.append((device.name, source))
                self._log_presence(device.name, source, reading, armed, state)
        if arrived:
            await self._wake_on_presence(arrived)

    def _log_presence(
        self, name: str, source: str, reading: DeviceReading, armed: ArmState, state: DeviceState
    ) -> None:
        """The observation trail, at two levels deliberately.

        Every tick at DEBUG: a line per device per source per 30 s at INFO would drown the journal.

        Every state CHANGE at INFO, **permanently** — not a rollout aid. It is the diagnostic for a
        stranded DHCP reservation, which v1 has no automated warning for: a LAN source pinned
        `offline` while the owner is demonstrably home is what a drifted lease looks like, and it is
        only visible if the journal says so. An arrival gets its own line from the fan-out, which is
        where the interesting part — what it actually did — is known.
        """
        detail = f" — {reading.reason}" if reading.reason else ""
        log.debug("presence: %s/%s is %s%s (armed=%s)", name, source, reading.state, detail, armed.armed)
        if state.seen.get(source) != reading.state:
            log.info(
                "presence: %s/%s %s -> %s%s",
                name,
                source,
                state.seen.get(source) or "unseen",
                reading.state,
                detail,
            )
            state.seen[source] = reading.state

    async def _wake_on_presence(self, arrived: list[tuple[str, str]]) -> None:
        """Fan ONE owner arrival out over the hosts flagged `wake_on_presence` (D50, 15b).

        Deliberately the D2-B `wake_flagged_hosts` shape, because it is the same decision with a
        different trigger: same eligibility order (flag, `mac`, the fleet's cached sweep, the
        cooldown), same `ActionService.invoke` chokepoint, same SYSTEM/`system` attribution — so an
        automatic wake is privilege-gated and lands in the Event log exactly like a button press, and
        the two triggers cannot drift into two policies.

        What is specific to this trigger:

        * **The cooldown is the presence one** (`wake.presence_cooldown_s`, per-host overridable via
          `wake_presence_cooldown_s`). A dashboard open is cheap and frequent; a fresh tailnet connect
          is rare and deliberate, so the two windows are different by design (D50).
        * **Both cooldown maps are CHECKED and stamped, before any await** (D50 M3, completed by the
          15b verify round). The presence map bounds this trigger; the shared D2-B map is the
          cross-trigger dedupe floor and needs BOTH halves: stamped, so a dashboard open seconds
          after walking in cannot re-wake a host this pass woke — and read, so this pass cannot
          re-wake a host D2-B stamped and is mid-way through waking (the reverse interleaving).
          Stamping first also means the stamp is committed even if the invoke fails: this is a "we
          already tried" mark, not a success receipt, and re-firing on the next tick is the failure
          mode it exists to prevent.
        * **One bad host must not cost the others their wake**, so a failing invoke is logged and the
          fan-out continues (the fleet loop's `_record` rule, applied to actions).
        * **Quiet hours gate the LAN source only** (D2-C), here and nowhere else — see below.
        """
        # The LAST gate before anything is invoked (D50 M2 — recheck before ACTING). The tick's read
        # fence above covers the reconfiguration window around the LocalAPI read; this one covers the
        # acting boundary itself, so no code added between the two can ever fire past the master
        # switch. A disable landing mid-fan-out still lets the remaining hosts through — same as the
        # D2-B detached task, and the edge that started it was genuine.
        if not self.cfg.enabled:
            return
        wake = self._settings.wake
        # QUIET HOURS, at the acting boundary and AFTER the edge was consumed (D2-C; R63 §4.4's trap).
        # `_tick_presence` has already written the disarmed state, so suppressing here DROPS the
        # arrival — which is the whole meaning of the feature. Checking any earlier would leave the
        # device armed and detonate it at 08:00:00 sharp, converting a suppressed 03:00 arrival into a
        # scheduled fleet wake. A blocked-window arrival produces no wake that night BY DESIGN; the
        # morning paths are D2-B (open the dashboard) and A3 schedules, both shipped.
        #
        # Two rules, both deliberate. Only when EVERY coalesced edge is LAN: a tailnet connect in the
        # same tick is a deliberate act ("I want the servers") and keeps the whole fan-out eligible.
        # And NEITHER cooldown map is stamped — nothing was attempted, and a stamp would wrongly
        # suppress a genuine arrival after the window or a deliberate connect inside it.
        window = wake.quiet_hours
        if all(source == LAN for _name, source in arrived) and in_quiet_hours(window):
            log.info(
                "presence: %s arrived, suppressed by quiet hours (%s–%s)",
                _arrivals(arrived),
                window.start if window else "",  # never empty here; `in_quiet_hours(None)` is False
                window.end if window else "",
            )
            return
        # D2-B's map — READ and stamped (15b verify round): the stamp alone only covered the
        # presence-first interleaving. Dashboard-first — D2-B stamps a host and parks at its invoke,
        # THEN the presence edge lands — needs the read too, or this pass re-wakes the host D2-B is
        # mid-way through waking. The window for the read is `cooldown_s` (the cross-trigger dedupe
        # floor, per the D50 M3 design finding), not the presence window: the shared map means "an
        # automatic wake tried recently", whichever trigger tried.
        shared = wake_on_connect.cooldowns(self._app)
        online = self._fleet.cached_online_ids()  # cheap + probe-free; empty when the cache is cold
        now = time.monotonic()
        # TWO PHASES, deliberately (15b review, MED — reproduced): eligibility + BOTH stamps for the
        # WHOLE set first, with no await anywhere in the pass — then the invokes. Stamping each host
        # just before its own await left the not-yet-reached hosts unstamped while the loop yielded,
        # so a dashboard connect landing mid-fan-out (the overwhelmingly likely next thing) woke a
        # later host through D2-B and this loop then woke it AGAIN. An awaitless first pass makes the
        # reservation atomic under cooperative scheduling — no lock needed, same guarantee. (Codex's
        # shared-reservation-helper extraction was overruled as the heavier fix: the copied policy is
        # these few lines, cross-referenced here and in `wake_flagged_hosts`.)
        eligible: list[str] = []
        for host in self._fleet.hosts():
            if not host.wake_on_presence or not host.mac:
                continue  # a MAC-less host would only DENY — noise nobody asked for at this instant
            if host.id in online:
                continue
            cooldown_s = (
                wake.presence_cooldown_s
                if host.wake_presence_cooldown_s is None
                else host.wake_presence_cooldown_s
            )
            last = self._presence_marks.get(host.id)
            if last is not None and (now - last) < cooldown_s:
                continue
            shared_last = shared.get(host.id)
            if shared_last is not None and (now - shared_last) < wake.cooldown_s:
                continue  # the other trigger just tried this host — the dedupe floor covers us both
            self._presence_marks[host.id] = now
            shared[host.id] = now
            eligible.append(host.id)
        for host_id in eligible:
            try:
                await self._actions.invoke(
                    "wake_host",
                    {"host_id": host_id},
                    # Nobody typed this — the app itself observed the owner arriving (D-4).
                    origin=Origin(kind="system"),
                    actor=Actor.SYSTEM,
                    interactive=False,
                )
            except Exception:  # noqa: BLE001 — one host's failure is not the arrival's failure
                log.exception("presence wake failed for host %s", host_id)
        log.info(
            "presence: %s arrived — %s",
            _arrivals(arrived),
            f"firing wake for {len(eligible)} host(s)" if eligible else "no eligible hosts",
        )
