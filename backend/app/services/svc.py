"""Service liveness fan-out (DESIGN.md §2, §10).

Mirrors `FleetService`: derives each service's `online` state concurrently and caches the sweep
for `poll_seconds` so N polling clients share one probe. Liveness is a **TCP connect** to the
service port — cheap, dependency-free, and the honest signal for "is this thing listening." A
port-less service can't be probed, so it tracks its host's online state. An offline host
short-circuits to offline without wasting a probe (it would only time out).

State is never persisted (DESIGN.md §2): config declares services, the probe derives liveness.
"""

from __future__ import annotations

import asyncio
import time
from datetime import datetime, timezone

from app.domain.host import Host
from app.domain.service import Service, ServiceStatus
from app.services.fleet import FleetService

_PROBE_TIMEOUT_S = 1.5
_MAX_CONCURRENT = 16


async def probe_port(ip: str, port: int, timeout_s: float = _PROBE_TIMEOUT_S) -> bool:
    """True if a TCP connection to `ip:port` opens within the timeout. Never raises."""
    try:
        reader, writer = await asyncio.wait_for(
            asyncio.open_connection(ip, port), timeout=timeout_s
        )
    except (OSError, asyncio.TimeoutError):
        return False
    writer.close()
    try:
        await writer.wait_closed()
    except OSError:
        pass
    return True


class ServiceService:
    """Holds the service list (from settings) + a short-lived derived-status cache.

    Reads host liveness from the shared `FleetService` so a service on an asleep host is reported
    offline immediately (and the two caches stay coherent at the same `poll_seconds` cadence).
    """

    def __init__(
        self, settings, fleet: FleetService, *, max_concurrent: int = _MAX_CONCURRENT
    ) -> None:
        self._settings = settings
        self._fleet = fleet
        self._sem = asyncio.Semaphore(max_concurrent)
        self._lock = asyncio.Lock()
        self._cache: list[ServiceStatus] | None = None
        self._cache_at = 0.0

    def services(self) -> list[Service]:
        return self._settings.services()

    def service(self, service_id: str) -> Service | None:
        return next((s for s in self.services() if s.id == service_id), None)

    def services_for(self, host_id: str) -> list[Service]:
        return [s for s in self.services() if s.host_id == host_id]

    async def _status(
        self, svc: Service, host: Host | None, host_online: bool
    ) -> ServiceStatus:
        now = datetime.now(timezone.utc)
        if host is None:
            return ServiceStatus(
                service_id=svc.id, online=False, checked_at=now, error="host not found"
            )
        if not host_online:
            return ServiceStatus(service_id=svc.id, online=False, checked_at=now)
        if svc.port is None:
            # No port to probe — best-effort: tracks the (online) host.
            return ServiceStatus(service_id=svc.id, online=True, checked_at=now)
        async with self._sem:
            online = await probe_port(host.ip, svc.port)
        return ServiceStatus(service_id=svc.id, online=online, checked_at=now)

    async def status_all(self, *, force: bool = False) -> list[ServiceStatus]:
        """Derive every service's status concurrently, served from cache within `poll_seconds`."""
        ttl = max(1, self._settings.server.poll_seconds)
        async with self._lock:
            now = time.monotonic()
            if not force and self._cache is not None and (now - self._cache_at) < ttl:
                return self._cache
            host_status = {s.host_id: s for s in await self._fleet.status_all(force=force)}
            hosts = {h.id: h for h in self._fleet.hosts()}
            svcs = self.services()
            results = list(
                await asyncio.gather(
                    *(
                        self._status(
                            s,
                            hosts.get(s.host_id),
                            bool(host_status.get(s.host_id) and host_status[s.host_id].online),
                        )
                        for s in svcs
                    )
                )
            )
            self._cache, self._cache_at = results, now
            return results

    async def status_of(self, service_id: str) -> ServiceStatus | None:
        """Fresh status for one service (bypasses the cache)."""
        svc = self.service(service_id)
        if svc is None:
            return None
        host = self._fleet.host(svc.host_id)
        host_status = await self._fleet.status_of(svc.host_id) if host else None
        return await self._status(svc, host, bool(host_status and host_status.online))

    def url_for(self, service_id: str) -> str | None:
        """The browser-openable URL for a service (`http://{host_ip}:{port}{path}`), or None."""
        svc = self.service(service_id)
        if svc is None or svc.port is None:
            return None
        host = self._fleet.host(svc.host_id)
        if host is None:
            return None
        return f"http://{host.ip}:{svc.port}{svc.path}"
