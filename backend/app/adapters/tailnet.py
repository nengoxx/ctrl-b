"""Tailnet presence reader — tailscaled's LocalAPI over its unix socket (D2-A/D50, research R12).

The monitor loop asks one question per tick — "is the owner's device on the tailnet right now?" — and
this module is the only thing that talks to tailscaled to answer it. Three properties it exists to
guarantee:

  1. **`Online: false` and "I could not tell" are never the same answer** (R12 §4, the central rule).
     `tailscale status`' JSON flattens a nil `*bool` to `false`, which would report a daemon restart
     as "the phone left" and fire a wake on its recovery. The raw Node from `whois` keeps the
     distinction (`Online` carries `json:",omitempty"`), and every failure below — socket gone, 403,
     404, non-Running backend, our own node out of the netmap poll, malformed body — maps to UNKNOWN
     **with a reason**, never to OFFLINE. UNKNOWN is what the caller's arming machine disarms on.
  2. **It never raises.** A tick that cannot read the tailnet is an ordinary UNKNOWN tick, not an
     exception the loop's blanket guard has to catch — the loop must be able to tell "no answer"
     from "the code broke".
  3. **The health gate runs first, and gates everything.** A cached peer `Node` is stale evidence
     while the daemon is not `Running` or while WE have fallen out of the netmap poll, so the whole
     tick is UNKNOWN in that case rather than N individually-plausible-looking readings (D50 H2).

Why the LocalAPI and not the `tailscale` CLI: same bytes (VERIFIED byte-for-byte in R12 §1a) for
0.16 ms instead of 5 ms, with no `create_subprocess_exec` — and read access on the unix socket needs
neither root nor operator. Why polling and not `watch-ipn-bus`: the stream is documented-unstable,
mid-rewrite upstream, and silently ignores mask bits it does not know (R12 §1c, D50).

The client is built per call, deliberately: a socket-path edit applies on the next tick, there is no
long-lived connection to leak, and at 0.16 ms per read the setup cost is not worth a cache.
"""

from __future__ import annotations

import json
import logging
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any, Literal

import httpx

log = logging.getLogger(__name__)

#: What one device reading can say. `unknown` always carries a `reason` — see the module docstring.
PresenceState = Literal["online", "offline", "unknown"]

#: httpx sends the URL's host as `Host:`, and tailscaled's `validHost` accepts ONLY `""` or
#: `local-tailscaled.sock` — anything else is an instant 403 "invalid localapi request" (R12 §1b,
#: VERIFIED live). So the base URL is not cosmetic: it IS the auth handshake. A stray `Origin`/
#: `Referer` header is refused the same way, which is why no default headers are set anywhere here.
_BASE_URL = "http://local-tailscaled.sock"

#: A transport property, not an operator knob (D50 M4). The measured read is 0.16 ms; this is three
#: orders of magnitude of headroom, and it exists only so a wedged daemon cannot hold a monitor tick
#: open — never as something to tune per install. Config carries the socket PATH, which is a real
#: deployment difference; a timeout this size is not.
_READ_TIMEOUT_S = 2.0

#: The one failure reason a caller reacts to differently (a stale config entry, not a transient), so
#: it is a named constant compared by value rather than a string the call site re-sniffs.
_NO_SUCH_PEER = "tailscaled has no such peer (404)"


@dataclass(frozen=True)
class DeviceReading:
    """One device's presence this tick. `reason` is set iff `state == "unknown"` and says WHY, so an
    operator can tell a stale config entry from a daemon restart in the logs."""

    ip: str
    state: PresenceState
    reason: str | None = None


def _unknown(ips: Sequence[str], reason: str) -> dict[str, DeviceReading]:
    """The whole tick's answer when the health gate says the tailnet view is not trustworthy."""
    return {ip: DeviceReading(ip=ip, state="unknown", reason=reason) for ip in ips}


def _describe(exc: Exception) -> str:
    """A short, log-safe cause. The TYPE is always included because the interesting connect failures
    (`FileNotFoundError`, `ConnectError`) carry their meaning there, and a bare `str(exc)` for them is
    often empty."""
    return f"{type(exc).__name__}: {exc}" if str(exc) else type(exc).__name__


async def _get_json(client: httpx.AsyncClient, path: str) -> tuple[dict[str, Any] | None, str | None]:
    """One LocalAPI GET → (body, None) or (None, reason). Never raises.

    Every documented failure in R12 §4 lands here: the socket missing or refusing (tailscaled not
    running), 403 (permissions, or a client bug in the Host/Origin handshake), 404 (the peer is not
    in this tailnet — a stale config entry), and a body that is not the JSON object we expect.
    """
    try:
        response = await client.get(path)
    except Exception as exc:  # noqa: BLE001 — a reader that raises would make "no answer" look like a bug
        return None, f"tailscaled localapi unreachable ({_describe(exc)})"
    if response.status_code == 403:
        return None, "tailscaled refused the read (403) — permissions or an invalid localapi request"
    if response.status_code == 404:
        return None, _NO_SUCH_PEER
    if response.status_code != 200:
        return None, f"tailscaled answered HTTP {response.status_code}"
    try:
        body = json.loads(response.content)
    except ValueError:
        return None, "tailscaled returned a body that is not JSON"
    if not isinstance(body, dict):
        return None, "tailscaled returned JSON that is not an object"
    return body, None


async def _gate(client: httpx.AsyncClient) -> str | None:
    """`None` when the tailnet view can be trusted this tick, else the reason it cannot (D50 H2).

    Both conditions are load-bearing and neither implies the other: `BackendState != "Running"` means
    the daemon is starting/stopped/logged-out and its peer map is empty or absent, while
    `Self.Online == false` means OUR node fell out of the netmap poll — the peer map still exists but
    every `Online` in it is a stale cache (R12 §4). `peers=false` keeps this read at ~3 KB.
    """
    body, reason = await _get_json(client, "/localapi/v0/status?peers=false")
    if body is None:
        return reason
    state = body.get("BackendState")
    if state != "Running":
        return f"tailscaled backend state is {state!r}, not Running"
    self_node = body.get("Self")
    if not isinstance(self_node, dict) or self_node.get("Online") is not True:
        return "this node is not in the netmap poll — every peer's Online is a stale cache"
    return None


async def _whois(client: httpx.AsyncClient, ip: str) -> DeviceReading:
    """One device's presence from `whois?addr=<tailnet ip>` — the 1.2 KB read that carries `Online`.

    The absent-key check is the whole point of using `whois` over `status`: the raw `tailcfg.Node`
    omits `Online` when control has not told us (ACL-hidden peer, a peer that has never been seen),
    and treating that omission as `false` is exactly the false OFFLINE that would arm a wake.
    """
    body, reason = await _get_json(client, f"/localapi/v0/whois?addr={ip}")
    if body is None:
        if reason == _NO_SUCH_PEER:
            # Only reached with a HEALTHY gate (the caller returns early otherwise), so this really is
            # a config entry pointing at a peer that no longer exists — worth saying out loud once a
            # tick rather than leaving the owner with a wake that silently never fires.
            log.warning("tailnet: no peer at %s — a wake.presence_devices tailnet_ip looks stale", ip)
        return DeviceReading(ip=ip, state="unknown", reason=reason or "no answer")
    node = body.get("Node")
    if not isinstance(node, dict):
        return DeviceReading(ip=ip, state="unknown", reason="the whois response carried no Node")
    online = node.get("Online")
    if online is True:
        return DeviceReading(ip=ip, state="online")
    if online is False:
        return DeviceReading(ip=ip, state="offline")
    return DeviceReading(ip=ip, state="unknown", reason="the peer's Online is unset (control has not said)")


async def read_presence(
    socket_path: str,
    ips: Sequence[str],
    *,
    transport: httpx.AsyncBaseTransport | None = None,
) -> dict[str, DeviceReading]:
    """Read every watched device's presence in one pass. Never raises; always returns a reading per ip.

    `transport` is an injection seam for the tests (httpx's `MockTransport`), so the whole R12 §4
    failure taxonomy can be pinned without a tailscaled on the box. Production passes nothing and gets
    the UDS transport built here — per call, so a socket-path edit applies on the next tick.
    """
    if not ips:
        return {}  # nothing configured: the tailnet half of the monitor costs literally nothing
    if not socket_path.strip():
        return _unknown(ips, "wake.tailscale_socket_path is empty")
    edge = transport or httpx.AsyncHTTPTransport(uds=socket_path)
    async with httpx.AsyncClient(transport=edge, base_url=_BASE_URL, timeout=_READ_TIMEOUT_S) as client:
        gate_reason = await _gate(client)
        if gate_reason is not None:
            return _unknown(ips, gate_reason)
        return {ip: await _whois(client, ip) for ip in ips}
