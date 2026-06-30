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
from datetime import datetime, timezone

from app.domain.host import Host, HostStatus

#: Matches "time=1.83 ms" (Linux/macOS) and "time=1ms" / "time<1ms" (Windows). Group 1 captures
#: the operator (`=` or `<`) so we can distinguish a real 1ms hop from sub-ms loopback — Windows
#: reports both as "1ms" if you only read the number, hiding the difference between a server
#: pinging itself and a real LAN hop.
_PING_TIME_RE = re.compile(r"time([=<])\s*([\d.]+)\s*ms", re.IGNORECASE)

_DEFAULT_TIMEOUT_S = 2.0
_MAX_CONCURRENT = 16


def _ping_cmd(ip: str, timeout_s: float) -> list[str]:
    sysname = platform.system().lower()
    secs = str(max(1, int(timeout_s)))
    if sysname == "windows":
        return ["ping", ip, "-n", "1", "-w", str(max(1, int(timeout_s * 1000)))]
    if sysname == "darwin":  # BSD ping: -t is the total timeout in seconds (-W would be ms here)
        return ["ping", "-c", "1", "-t", secs, ip]
    return ["ping", "-c", "1", "-W", secs, ip]  # Linux/other iputils: -W is per-reply wait in seconds


async def ping_host(host: Host, timeout_s: float = _DEFAULT_TIMEOUT_S) -> HostStatus:
    """One ICMP echo → HostStatus. Never raises: failures become a status with `error`."""
    now = datetime.now(timezone.utc)
    cmd = _ping_cmd(host.ip, timeout_s)
    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL
        )
    except FileNotFoundError:
        return HostStatus(host_id=host.id, online=False, checked_at=now, error="ping not found")
    except Exception as exc:  # noqa: BLE001 — surface, don't crash the sweep
        return HostStatus(host_id=host.id, online=False, checked_at=now, error=str(exc))

    try:
        stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=timeout_s + 1.0)
    except asyncio.TimeoutError:
        proc.kill()
        await proc.wait()
        return HostStatus(host_id=host.id, online=False, checked_at=now, error="ping timeout")

    text = stdout.decode(errors="replace")
    # A genuine reply contains a TTL on every platform; this is more reliable than the exit code
    # (Windows can return 0 for "Destination host unreachable").
    online = proc.returncode == 0 and "ttl=" in text.lower()
    ping_ms: float | None = None
    if online:
        m = _PING_TIME_RE.search(text)
        if m:
            value = float(m.group(2))
            # Windows reports sub-millisecond replies as `time<1ms`; flatten to a single number
            # would lie that loopback (~0ms) is the same as a 1ms LAN hop. Report sub-ms as half
            # the threshold so the UI can show the gradient.
            ping_ms = value / 2 if m.group(1) == "<" else value
    return HostStatus(
        host_id=host.id,
        online=online,
        ping_ms=ping_ms,
        last_seen=now if online else None,
        checked_at=now,
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
