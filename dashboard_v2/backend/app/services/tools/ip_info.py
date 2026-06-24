"""ip_info — look up geolocation/ownership for an IP or hostname (Phase 8, D8).

The v1 server's `ip_info` was a client-side HTML page (nothing to port), so this is a net-new
server-side lookup over ip-api.com's free JSON endpoint. A blank query returns *this host's* public
IP info (ip-api echoes the caller). NOTE: ip-api's free tier is plaintext **HTTP** (no key); this is
a backend→internet call on the tailnet — acceptable here, and the provider/timeout become per-tool
settings later (ROADMAP E0a).
"""

from __future__ import annotations

import httpx
from pydantic import BaseModel, Field

from app.core.tool import InvocationContext, tool
from app.domain.enums import RunState
from app.domain.result import ToolResult

_HTTP_TIMEOUT = 10.0
_FIELDS = "status,message,query,country,regionName,city,zip,isp,org,as,reverse,lat,lon,timezone"


class IpInfoInput(BaseModel):
    query: str | None = Field(
        None, description="An IP address or hostname to look up. Leave blank for your own public IP."
    )


def _summary(d: dict) -> str:
    loc = ", ".join(x for x in (d.get("city"), d.get("regionName"), d.get("country")) if x)
    org = d.get("isp") or d.get("org") or ""
    return f"{d.get('query', '?')} — {loc or 'unknown location'}{f' · {org}' if org else ''}"


@tool(
    "ip_info",
    title="IP lookup",
    description=(
        "Look up geolocation and network ownership (city, region, country, ISP/org, ASN) for an IP "
        "address or hostname. Leave the query blank to look up this host's own public IP."
    ),
    icon="globe",
)
async def ip_info(inp: IpInfoInput, ctx: InvocationContext) -> ToolResult:
    """Geolocate an IP/hostname (or this host's public IP) via ip-api.com."""
    target = (inp.query or "").strip()
    try:
        async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT) as client:
            resp = await client.get(f"http://ip-api.com/json/{target}", params={"fields": _FIELDS})
            resp.raise_for_status()
            data = resp.json()
    except (httpx.HTTPError, ValueError) as exc:
        return ToolResult(state=RunState.ERROR, summary="IP lookup failed.", error=str(exc)[:300])

    if data.get("status") != "success":
        return ToolResult(
            state=RunState.ERROR,
            summary=f"Lookup failed: {data.get('message', 'unknown error')}",
        )
    data.pop("status", None)
    data.pop("message", None)
    return ToolResult(state=RunState.OK, summary=_summary(data), data=data)
