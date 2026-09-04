"""Fleet status fan-out (DESIGN.md §10, §14).

Pings every host concurrently with `asyncio.gather`, bounded by a `Semaphore`, each ping under
its own `wait_for` timeout so one slow/dead host can't stall the sweep. Results are cached for
`poll_seconds` so N polling clients share a single sweep rather than each triggering their own.

The ping *command syntax* depends on the OS running this server (not the target). Windows uses
`-n`/`-w <ms>`, Linux uses `-c`/`-W <sec>`, macOS/BSD uses `-c`/`-t <sec>` (its `-W` is in ms, and
`-t` means TTL on Linux — so the three diverge and must be branched). We avoid import-time platform
branching (keeps the Termux/Android profile alive) by deciding the flags at call time.
"""

from __future__ import annotations

import asyncio
import platform
import re
import time
from dataclasses import dataclass
from datetime import datetime, timezone

from app.domain.host import Host, HostStatus

#: Matches "time=1.83 ms" (Linux/macOS) and "time=1ms" / "time<1ms" (Windows). Group 1 captures
#: the operator (`=` or `<`) so we can distinguish a real 1ms hop from sub-ms loopback — Windows
#: reports both as "1ms" if you only read the number, hiding the difference between a server
#: pinging itself and a real LAN hop.
_PING_TIME_RE = re.compile(r"time([=<])\s*([\d.]+)\s*ms", re.IGNORECASE)

_DEFAULT_TIMEOUT_S = 2.0
_MAX_CONCURRENT = 16


@dataclass(frozen=True)
class PingResult:
    """One probe's answer, said in the vocabulary every caller can map onto its own.

    Three-way on purpose: `error` is set iff the check could not be MADE (the binary missing, the
    subprocess wedged, `ping` itself refusing with a diagnostic), which is a different fact from "no
    reply". The fleet sweep maps it onto `HostStatus`; the D2-C LAN presence read maps it onto a
    `PresenceState`, where a miss ARMS a wake and a failed check must not. One shape, so neither
    caller re-decides what a ping means.
    """

    online: bool
    ping_ms: float | None = None
    error: str | None = None


def _ping_cmd(ip: str, count: int, timeout_s: float) -> list[str]:
    n = str(max(1, count))
    sysname = platform.system().lower()
    secs = str(max(1, int(timeout_s)))
    if sysname == "windows":
        return ["ping", ip, "-n", n, "-w", str(max(1, int(timeout_s * 1000)))]
    if sysname == "darwin":
        # BSD ping: -t is the TOTAL timeout in seconds (-W would be ms here), so unlike Linux's
        # per-reply -W it has to cover every echo — or a multi-echo probe would be cut short.
        return ["ping", "-c", n, "-t", str(max(1, int(timeout_s * max(1, count)))), ip]
    return ["ping", "-c", n, "-W", secs, ip]  # Linux/other iputils: -W is per-reply wait in seconds


async def ping_addr(ip: str, *, count: int = 1, timeout_s: float = _DEFAULT_TIMEOUT_S) -> PingResult:
    """`count` ICMP echoes to one address → the three-way answer. Never raises.

    **The one ping site.** `ping_host` is a thin mapping over this, so the server-OS branch stays a
    single allowlisted file (ARCHITECTURE §6) while the D2-C presence probe gets its own `count`: the
    fleet sweep asks once, the LAN probe asks three times so 802.11 DTIM buffering on a dozing phone
    cannot read as an absence (R63 §2.2). Linux's partial-success semantics are what make that work —
    any echo answered is a reply.

    Two riders, both load-bearing and neither obvious:

    * **The subprocess deadline is COUNT-AWARE.** `timeout_s + 1` is right for one echo and would kill
      a 3-echo probe at ~2 s (measured: `-c 3 -W 1` against a silent address takes ~3.1 s). Every
      absent LAN device would then come back as a `ping timeout` ERROR rather than `offline`, and a
      device that never reports offline never arms — the feature would silently never fire.
    * **`stderr` and the exit code are read.** `ping` distinguishes "asked and got nothing" (exit 1)
      from "could not ask" (exit ≥ 2: no route, unresolvable name), and only the first is evidence of
      absence. Exit 0 without a TTL stays a MISS, not an error: Windows answers 0 for "Destination
      host unreachable", which the TTL test already covers.
    """
    cmd = _ping_cmd(ip, count, timeout_s)
    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE
        )
    except FileNotFoundError:
        return PingResult(online=False, error="ping not found")
    except Exception as exc:  # noqa: BLE001 — surface, don't crash the sweep
        return PingResult(online=False, error=str(exc))

    try:
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=max(1, count) * timeout_s + 1.0)
    except asyncio.TimeoutError:
        proc.kill()
        await proc.wait()
        return PingResult(online=False, error="ping timeout")

    text = stdout.decode(errors="replace")
    # A genuine reply contains a TTL on every platform; this is more reliable than the exit code
    # (Windows can return 0 for "Destination host unreachable").
    online = proc.returncode == 0 and "ttl=" in text.lower()
    if not online and (proc.returncode or 0) > 1:
        diagnostic = stderr.decode(errors="replace").strip().splitlines()
        return PingResult(
            online=False, error=diagnostic[0] if diagnostic else f"ping exited {proc.returncode}"
        )
    ping_ms: float | None = None
    if online:
        m = _PING_TIME_RE.search(text)
        if m:
            value = float(m.group(2))
            # Windows reports sub-millisecond replies as `time<1ms`; flatten to a single number
            # would lie that loopback (~0ms) is the same as a 1ms LAN hop. Report sub-ms as half
            # the threshold so the UI can show the gradient.
            ping_ms = value / 2 if m.group(1) == "<" else value
    return PingResult(online=online, ping_ms=ping_ms)


async def ping_host(host: Host, timeout_s: float = _DEFAULT_TIMEOUT_S) -> HostStatus:
    """One ICMP echo → HostStatus. Never raises: failures become a status with `error`.

    The sweep's own parameters are unchanged (one echo, 2 s). What it gained with the D2-C extraction
    is `ping`'s diagnostic exits: a server whose link is down now reports UNKNOWN for the whole fleet
    instead of a fleet-wide `down` — which is D50 M1's stated property ("a check that could not be
    MADE is not a down") reaching the one failure that used to slip past it.
    """
    now = datetime.now(timezone.utc)
    result = await ping_addr(host.ip, timeout_s=timeout_s)
    return HostStatus(
        host_id=host.id,
        online=result.online,
        ping_ms=result.ping_ms,
        last_seen=now if result.online else None,
        checked_at=now,
        error=result.error,
    )


class FleetService:
    """Holds the host list (from settings) + a short-lived status cache."""

    def __init__(self, settings, *, max_concurrent: int = _MAX_CONCURRENT) -> None:
        self._settings = settings
        self._sem = asyncio.Semaphore(max_concurrent)
        self._lock = asyncio.Lock()
        self._cache: list[HostStatus] | None = None
        self._cache_at = 0.0

    def hosts(self) -> list[Host]:
        return self._settings.hosts()

    def host(self, host_id: str) -> Host | None:
        return next((h for h in self.hosts() if h.id == host_id), None)

    async def _ping(self, host: Host) -> HostStatus:
        async with self._sem:
            return await ping_host(host)

    def cached_online_ids(self) -> set[str]:
        """Host ids the LAST sweep saw online — a synchronous, probe-free read of the same cache
        `status_all` serves from, honoring the same `poll_seconds` TTL. A cold or expired cache
        returns an EMPTY set, i.e. "nothing is known to be online" rather than a stale claim.

        Exists for wake-on-connect (D2-B), which wants to skip already-awake hosts without paying for
        (or waiting on) a sweep. Callers must treat this as an optimization: absence from the set means
        unknown-or-offline, never a guarantee that the host is down."""
        ttl = max(1, self._settings.server.poll_seconds)
        if self._cache is None or (time.monotonic() - self._cache_at) >= ttl:
            return set()
        return {s.host_id for s in self._cache if s.online}

    async def status_all(self, *, force: bool = False) -> list[HostStatus]:
        """Ping the whole fleet concurrently, served from cache within `poll_seconds`."""
        ttl = max(1, self._settings.server.poll_seconds)
        async with self._lock:
            now = time.monotonic()
            if not force and self._cache is not None and (now - self._cache_at) < ttl:
                return self._cache
            hosts = self.hosts()
            results = list(await asyncio.gather(*(self._ping(h) for h in hosts)))
            self._cache, self._cache_at = results, now
            return results

    async def status_of(self, host_id: str) -> HostStatus | None:
        """Fresh status for a single host (bypasses the fleet cache)."""
        host = self.host(host_id)
        if host is None:
            return None
        return await self._ping(host)
