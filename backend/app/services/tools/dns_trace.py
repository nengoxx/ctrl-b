"""dns_trace — resolve a hostname's addresses + reverse PTR (Phase 8, D8).

The first *net-new* tool (proves "add a tool = one file"). Deliberately **dependency-free**: forward
resolution via `socket.getaddrinfo` (A/AAAA) and reverse PTR via `socket.gethostbyaddr`, both blocking
so they run via `asyncio.to_thread`. Full record types (MX/TXT/…) and traceroute are deferred — they'd
need `dnspython` / a `tracert` subprocess; scope kept minimal on purpose (ROADMAP E0).
"""

from __future__ import annotations

import asyncio
import socket

from pydantic import BaseModel, Field

from app.core.tool import InvocationContext, tool
from app.domain.enums import RunState
from app.domain.result import ToolResult


class DnsTraceInput(BaseModel):
    host: str = Field(..., description="A hostname (example.com) or IP address to resolve.")


def _resolve(host: str) -> dict:
    """Blocking forward+reverse resolution. Raises socket.gaierror/herror on failure."""
    infos = socket.getaddrinfo(host, None)
    addrs: list[str] = []
    for fam, _type, _proto, _canon, sockaddr in infos:
        ip = str(sockaddr[0])  # sockaddr[0] is the address; str() pins it (typeshed widens to str|int)
        if ip not in addrs:
            addrs.append(ip)
    ptr: str | None = None
    if addrs:
        try:
            ptr = socket.gethostbyaddr(addrs[0])[0]
        except socket.herror, socket.gaierror:
            ptr = None
    return {"host": host, "addresses": addrs, "ptr": ptr}


@tool(
    "dns_trace",
    title="DNS resolve",
    description=(
        "Resolve a hostname to its IP addresses (IPv4/IPv6) and the reverse PTR of the first address. "
        "Use to check what a domain or host resolves to."
    ),
    icon="globe",
    read_only=True,  # a DNS lookup, changes nothing → retry-safe
    # getaddrinfo has no internal timeout and can hang on bad DNS; 20s is far above any legitimate
    # resolution, so it bounds a true hang without ever cutting a slow-but-working lookup.
    timeout_s=20,
)
async def dns_trace(inp: DnsTraceInput, ctx: InvocationContext) -> ToolResult:
    """Resolve a hostname's A/AAAA addresses + reverse PTR."""
    host = inp.host.strip()
    if not host:
        return ToolResult(state=RunState.ERROR, summary="Give a hostname or IP to resolve.")
    try:
        data = await asyncio.to_thread(_resolve, host)
    except (socket.gaierror, socket.herror) as exc:
        return ToolResult(state=RunState.ERROR, summary=f"Could not resolve '{host}'.", error=str(exc)[:200])
    n = len(data["addresses"])
    ptr = f" · {data['ptr']}" if data["ptr"] else ""
    return ToolResult(
        state=RunState.OK,
        summary=f"{host} → {n} address{'es' if n != 1 else ''}{ptr}",
        data=data,
    )
