"""MonitorService — the backend's own periodic watcher (D2-A / D50, research R12 + R13).

ONE lifespan loop doing two cheap reads per tick and feeding two consumers: confirmed fleet up/down
transitions become Events, and the owner-device tailnet edge fires the D2-A wake (15b) for every host
flagged `wake_on_presence`. The loop is `AutomationRunner.loop()`'s shape verbatim
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
  3. **The phone has its own arming machine, not the fleet's counters** (D50 H1). Continuous healthy
     OFFLINE for `wake.presence_offline_after_s` ARMS; the next healthy ONLINE is the edge; any
     UNKNOWN tick, a disable, or a reconfig DISARMS. That pairing is what makes "a tailscaled restart
     fires nothing" and "a genuine reconnect fires" simultaneously true — the fleet's 3/2 damping
     alone would fire on recovery from a daemon outage.
  4. **State is per-instance and per-target-key.** Counters live on the service object (never a module
     global — two `TestClient` apps in one process must not share them), keyed by host id and by
     NORMALIZED device ip. Every tick prunes targets that left the config and silently baselines the
     ones that arrived, so an edit cannot leave a ghost counter behind.

The fleet read is `FleetService.status_all()`, never `ping_host`: one sweep shared with the UI, which
is also why `monitor.poll_seconds >= server.poll_seconds` is validated at the config boundary.
"""

from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Literal

from app.adapters.tailnet import DeviceReading, PresenceState, read_presence
from app.config import MonitorCfg, Settings
from app.domain.enums import Actor, RunState
from app.domain.event import Event, Origin
from app.domain.host import HostStatus
from app.services import wake_on_connect
from app.services.action_service import ActionService
from app.services.events import EventService
from app.services.fleet import FleetService

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


@dataclass
class MonitorState:
    """Everything the loop remembers between ticks — one object so a disable/re-enable clears it all."""

    hosts: dict[str, TargetState] = field(default_factory=dict)
    devices: dict[str, ArmState] = field(default_factory=dict)


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
        """One observation of everything watched: the shared fleet sweep, then the tailnet devices.

        The two halves are independent by construction — a tailnet that cannot be read must not cost
        the fleet its transition Events, so the presence half runs after the fleet half and its own
        failures are already UNKNOWN readings rather than exceptions.
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

    async def _tick_presence(self) -> None:
        """Observe the owner's devices, drive their arming machines, and wake the flagged hosts on an
        arrival.

        Edges are COLLECTED across the device loop and fanned out ONCE (D50 M3): the owner walking in
        with a phone and a laptop is one arrival, and a fan-out per device would write duplicate wake
        Events for it. The device loop only OBSERVES; every decision about hosts lives in the fan-out.
        """
        wake = self._settings.wake
        ips = wake.presence_device_ips
        for gone in [ip for ip in self._state.devices if ip not in ips]:
            del self._state.devices[gone]  # reconfigured away: never reuse state across ips (D50 M2)
        if not ips:
            return
        readings = await read_presence(wake.tailscale_socket_path, ips)
        # The await above is a reconfiguration window (15a review, MED): a Conf save lands between the
        # read starting and returning, so re-check the LIVE config before the readings drive anything.
        # Without this, a stale reading could emit the edge 15b fires behind DESPITE the master switch,
        # or resurrect state for a device the prune above just removed — and a disable/re-enable inside
        # one window would then keep that ghost armed indefinitely.
        if not self.cfg.enabled:
            self.reset()
            return
        fresh = self._settings.wake.presence_device_ips
        for gone in [ip for ip in self._state.devices if ip not in fresh]:
            del self._state.devices[gone]
        now = time.monotonic()
        arrived: list[str] = []
        for ip in fresh:
            # A device ADDED mid-window has no reading yet — an UNKNOWN tick, which correctly
            # baselines it disarmed rather than trusting a read it was not part of.
            reading = readings.get(ip) or DeviceReading(ip=ip, state="unknown", reason="not read")
            state, edge = arm(
                self._state.devices.get(ip, ArmState()),
                reading.state,
                now=now,
                offline_after_s=wake.presence_offline_after_s,
            )
            self._state.devices[ip] = state
            if edge:
                arrived.append(ip)
            self._log_presence(reading, state)
        if arrived:
            await self._wake_on_presence(arrived)

    def _log_presence(self, reading: DeviceReading, state: ArmState) -> None:
        """The per-device observation trail, DEBUG: a line per device per 30 s at INFO would drown the
        journal. An arrival gets its own INFO line from the fan-out, which is where the interesting
        part — what it actually did — is known."""
        log.debug(
            "tailnet: %s is %s%s (armed=%s)",
            reading.ip,
            reading.state,
            f" — {reading.reason}" if reading.reason else "",
            state.armed,
        )

    async def _wake_on_presence(self, arrived: list[str]) -> None:
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
        * **Both cooldown maps are stamped, BEFORE the await** (D50 M3). The presence map is what
          bounds this trigger; the shared D2-B map is stamped so that opening the dashboard seconds
          after walking in — the overwhelmingly likely next thing the owner does — cannot write a
          second wake Event for a host we just woke. Stamping first also means the stamp is committed
          even if the invoke fails: this is a "we already tried" mark, not a success receipt, and
          re-firing on the next tick is the failure mode it exists to prevent.
        * **One bad host must not cost the others their wake**, so a failing invoke is logged and the
          fan-out continues (the fleet loop's `_record` rule, applied to actions).
        """
        # The LAST gate before anything is invoked (D50 M2 — recheck before ACTING). The tick's read
        # fence above covers the reconfiguration window around the LocalAPI read; this one covers the
        # acting boundary itself, so no code added between the two can ever fire past the master
        # switch. A disable landing mid-fan-out still lets the remaining hosts through — same as the
        # D2-B detached task, and the edge that started it was genuine.
        if not self.cfg.enabled:
            return
        wake = self._settings.wake
        shared = wake_on_connect.cooldowns(self._app)  # D2-B's map — stamped, never read here
        online = self._fleet.cached_online_ids()  # cheap + probe-free; empty when the cache is cold
        now = time.monotonic()
        fired = 0
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
            self._presence_marks[host.id] = now
            shared[host.id] = now
            fired += 1
            try:
                await self._actions.invoke(
                    "wake_host",
                    {"host_id": host.id},
                    # Nobody typed this — the app itself observed the owner arriving (D-4).
                    origin=Origin(kind="system"),
                    actor=Actor.SYSTEM,
                    interactive=False,
                )
            except Exception:  # noqa: BLE001 — one host's failure is not the arrival's failure
                log.exception("presence wake failed for host %s", host.id)
        log.info(
            "tailnet: %s arrived — %s",
            ", ".join(arrived),
            f"firing wake for {fired} host(s)" if fired else "no eligible hosts",
        )
