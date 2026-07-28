"""Fleet read + CRUD API.

`GET` reads come from the cached concurrent ping sweep (Phase 1). `POST/PUT/DELETE` (Phase 7b) edit
the `computers:` map in `config.yaml` through the comment/format-preserving writer (`edit_config_yaml`)
and hot-apply via the runtime `reconfigure` seam — so a new/edited machine shows up on the next poll
without a restart. The list DTO never exposes `ssh_password` (only a `has_password` flag); a blank
password on `PUT` means "keep the stored one" (audit A2). Hosts are keyed by **name** in YAML with
`id = host_slug(name)`; renaming re-keys the entry (and re-slugs its id) while preserving the entry's
inner field comments.
"""

from __future__ import annotations

import socket
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, ValidationError

from app.config import (
    ComputerCfg,
    edit_config_yaml,
    host_slug,
    load_settings,
    sync_mapping,
    validation_detail,
)
from app.domain.host import Host, HostStatus
from app.runtime import reconfigure, settings_write_lock
from app.services.actions.tailscale import resolve_vpn_candidates

router = APIRouter(tags=["fleet"])

#: The server's own hostname (casefolded, computed once) — the fleet entry whose NAME matches it is the
#: machine ctrl-b itself runs on, surfaced as `self` on the DTO (owner directive 2026-07-12: the agent's
#: rig gets the distinguished presentation slot, derived from the environment — no config). The standard
#: node-identity signal (Ansible/Prometheus precedent). No match → nobody is self (a silent no-op — e.g.
#: a dev checkout on a machine outside the fleet). Seam noted: an explicit `self: true` config override
#: is a purely additive later valve if hostname-matching ever proves wrong for a deployment.
_SELF_HOSTNAME = socket.gethostname().casefold()


class ServiceIn(BaseModel):
    name: str
    kind: str | None = None
    port: int | None = None
    path: str = ""
    autostart: bool = False
    cmd: dict[str, dict[str, str]] = {}  # {action: {os_type: command}} — full map round-trips


class HostIn(BaseModel):
    name: str
    ip: str
    mac: str | None = None
    ssh_username: str | None = None
    ssh_password: str | None = None  # blank/None on PUT = keep the stored secret (audit A2)
    ssh_port: int = 22
    os_type: str = "linux"
    role: str | None = None
    vpn_host: str | None = None  # D47: VPN/overlay address (MagicDNS name preferred) — Conf editor is Slice 2
    ssh_prefer_vpn: bool = False  # D47: VPN-first SSH failover toggle
    tags: list[str] = []
    services: list[ServiceIn] = []


def _services_dto(cfg: ComputerCfg | None) -> list[dict[str, Any]]:
    if cfg is None:
        return []
    return [
        {
            "name": name,
            "kind": s.kind,
            "port": s.port,
            "path": s.path,
            "autostart": s.autostart,
            "cmd": s.cmd,  # full {action:{os:command}} so the editor round-trips other-OS entries
        }
        for name, s in cfg.services.items()
    ]


def _host_dto(host: Host, status: HostStatus | None, cfg: ComputerCfg | None) -> dict[str, Any]:
    return {
        "id": host.id,
        "name": host.name,
        "ip": host.ip,
        "mac": host.mac,
        "ssh_username": host.ssh_username,
        "ssh_port": host.ssh_port,
        "os_type": host.os_type.value,
        "role": host.role,
        "vpn_host": host.vpn_host,  # D47 — exposed for Slice-2's vantage-aware service links
        "ssh_prefer_vpn": host.ssh_prefer_vpn,
        "tags": host.tags,
        "has_password": bool(cfg and cfg.ssh_password),  # never the value — just whether one is set
        "services": _services_dto(cfg),
        # The §9.9 open per-host presentation blob, themeId-keyed — passed through verbatim (the theme owns
        # the inner schema; first consumed by frontier F2's present()). `{}` when there's no config entry.
        "appearance": cfg.appearance if cfg else {},
        # FACT: this fleet entry IS the machine ctrl-b runs on (see _SELF_HOSTNAME). The frontend's
        # presentation layer (useHosts) sorts self first; ordering is deliberately NOT done here — the
        # backend ships the fact, the client owns the presentation (the theme-engine layering).
        "self": host.name.casefold() == _SELF_HOSTNAME,
        "status": status.model_dump(mode="json") if status else None,
    }


def _svc_entry(s: ServiceIn) -> dict[str, Any]:
    """Minimal YAML entry for one service — omit empty/default fields to match the hand-written style."""
    e: dict[str, Any] = {}
    if s.kind:
        e["kind"] = s.kind
    if s.port is not None:
        e["port"] = s.port
    if s.path:
        e["path"] = s.path
    if s.autostart:
        e["autostart"] = True
    cmd = {
        action: {os: c for os, c in by_os.items() if c}
        for action, by_os in s.cmd.items()
        if any(by_os.values())
    }
    if cmd:
        e["cmd"] = cmd
    return e


def _host_entry(body: HostIn, *, password: str | None) -> dict[str, Any]:
    """Minimal YAML entry for a whole machine (used on add + as the validation candidate)."""
    e: dict[str, Any] = {"ip": body.ip.strip()}
    if body.mac:
        e["mac"] = body.mac.strip()
    if body.ssh_username:
        e["ssh_username"] = body.ssh_username.strip()
    if password:
        e["ssh_password"] = password
    e["ssh_port"] = body.ssh_port
    e["os_type"] = body.os_type or "linux"
    if body.role:
        e["role"] = body.role.strip()
    if body.vpn_host:  # optional string — omit-when-absent, like mac/role
        e["vpn_host"] = body.vpn_host.strip()
    if body.ssh_prefer_vpn:  # bool default False — omit-when-default, like a service's `autostart`
        e["ssh_prefer_vpn"] = True
    if body.tags:
        e["tags"] = list(body.tags)
    svcs = {s.name.strip(): _svc_entry(s) for s in body.services}
    if svcs:
        e["services"] = svcs
    return e


def _validate(entry: dict[str, Any]) -> None:
    """Type-check a candidate machine entry (→ 422). Semantic checks (uniqueness) live in the caller."""
    try:
        ComputerCfg.model_validate(entry)
    except ValidationError as exc:
        raise HTTPException(status_code=422, detail=validation_detail(exc)) from None


def _check_basics(body: HostIn) -> None:
    if not body.name.strip():
        raise HTTPException(status_code=422, detail="host name is required")
    if not body.ip.strip():
        raise HTTPException(status_code=422, detail="ip is required")
    names = [s.name.strip() for s in body.services]
    if "" in names:
        raise HTTPException(status_code=422, detail="service name is required")
    if len(set(names)) != len(names):
        raise HTTPException(status_code=422, detail="duplicate service name")


def _set_or_del(node: Any, key: str, value: Any) -> None:
    """Set `key` only if it changed (preserves the line's comment/quoting); delete on empty value so a
    cleared optional field disappears rather than persisting as null."""
    if value in (None, ""):
        if key in node:
            del node[key]
    elif node.get(key) != value:
        node[key] = value


def _apply_fields(node: Any, body: HostIn, *, password: str | None) -> None:
    """Edit an existing machine node in place: managed scalars set/cleared, services synced, and any
    field the form doesn't manage (e.g. tags it didn't send) left untouched on the node."""
    _set_or_del(node, "ip", body.ip.strip())
    _set_or_del(node, "mac", body.mac.strip() if body.mac else None)
    _set_or_del(node, "ssh_username", body.ssh_username.strip() if body.ssh_username else None)
    if password:  # only ever set — never delete a secret because the form posted blank
        if node.get("ssh_password") != password:
            node["ssh_password"] = password
    if node.get("ssh_port") != body.ssh_port:
        node["ssh_port"] = body.ssh_port
    if node.get("os_type") != (body.os_type or "linux"):
        node["os_type"] = body.os_type or "linux"
    _set_or_del(node, "role", body.role.strip() if body.role else None)
    # D47 vpn fields — OMIT-PRESERVES (Codex HIGH-2): the SHIPPED MachineEditor predates these two
    # fields and never sends them, so applying them unconditionally would WIPE a hand-configured VPN
    # address on any unrelated host edit (un-fixing Corsair). Touch them ONLY when the client actually
    # sent them (`model_fields_set`, pydantic v2); an omitted field preserves the existing YAML value.
    # Explicitly-sent null/false still clears, as today. Scoped to these two — every other field keeps
    # its existing omission behavior. Slice 2 adds the editor fields; PATCH semantics stay correct then.
    sent = body.model_fields_set
    if "vpn_host" in sent:
        _set_or_del(node, "vpn_host", body.vpn_host.strip() if body.vpn_host else None)
    if "ssh_prefer_vpn" in sent:
        # bool default-False: set only when on, delete when cleared (the `_set_or_del` shape for a
        # boolean; `False in (None, "")` is False, so it can't reuse that helper).
        if body.ssh_prefer_vpn:
            if node.get("ssh_prefer_vpn") is not True:
                node["ssh_prefer_vpn"] = True
        elif "ssh_prefer_vpn" in node:
            del node["ssh_prefer_vpn"]
    if body.tags:
        node["tags"] = list(body.tags)

    target = {s.name.strip(): _svc_entry(s) for s in body.services}
    svcs = node.get("services")
    if target:
        if not hasattr(svcs, "get"):
            node["services"] = {}
            svcs = node["services"]
        sync_mapping(svcs, target)
    elif hasattr(svcs, "get"):
        del node["services"]


def _computers(doc: Any) -> Any:
    c = doc.get("computers")
    if not hasattr(c, "get"):
        doc["computers"] = {}
        c = doc["computers"]
    return c


async def _persist_and_reload(request: Request, mutate: Any) -> None:
    """MUST be called holding `settings_write_lock` (never taken here — the callers hold it across
    their read-modify-write): the file edit + the in-memory reload are two steps, and interleaving
    with another writer leaves `app.state.settings` stale."""
    edit_config_yaml(mutate)
    await reconfigure(request.app, load_settings())


@router.get("/hosts")
async def list_hosts(request: Request) -> list[dict[str, Any]]:
    """All hosts with derived status (shared, cached ping sweep) + their declared services."""
    fleet = request.app.state.fleet
    cfgs = request.app.state.settings.computers
    by_id = {host_slug(name): cfg for name, cfg in cfgs.items()}
    statuses = {s.host_id: s for s in await fleet.status_all()}
    return [_host_dto(h, statuses.get(h.id), by_id.get(h.id)) for h in fleet.hosts()]


@router.get("/hosts/vpn-discovery")
async def vpn_discovery(request: Request) -> dict[str, Any]:
    """D3 Slice 3 — propose a `vpn_host` per configured host from `tailscale status --json` (READ-ONLY;
    never writes config). 403 when Tailscale control is disabled (mirrors `api/access.py`); a not-ok
    resolve passes its error envelope straight through. Match key = casefolded host name against the
    candidate's DNS label (primary), else a UNIQUE candidate HostName (fallback; HostName is non-unique,
    so an ambiguous hostname yields no proposal). Response:
    `{ok, results:[{id, name, current, proposed, online}], unmatched:[<name>...]}` (matched hosts only in
    `results`; wave 2 applies values via the existing per-host PUT)."""
    settings = request.app.state.settings
    if not settings.tailscale.enabled:
        raise HTTPException(status_code=403, detail="Tailscale control is disabled (tailscale.enabled)")
    res = await resolve_vpn_candidates(settings.tailscale)
    if not res.get("ok"):
        return res  # error envelope passthrough (200, ok:false) — as api/access.py surfaces resolve_status

    candidates = res.get("candidates") or []
    by_name = {c["name"]: c for c in candidates}  # DNS label → candidate (last wins; labels are unique)
    hostname_counts: dict[str, int] = {}
    for c in candidates:
        if c["hostname"]:
            hostname_counts[c["hostname"]] = hostname_counts.get(c["hostname"], 0) + 1
    # Only UNIQUE hostnames qualify for the fuzzy fallback (HostName is documented non-unique).
    by_hostname = {c["hostname"]: c for c in candidates if hostname_counts.get(c["hostname"]) == 1}

    results: list[dict[str, Any]] = []
    unmatched: list[str] = []
    for name, cfg in settings.computers.items():
        key = name.casefold()
        cand = by_name.get(key) or by_hostname.get(key)
        if cand is None:
            unmatched.append(name)
            continue
        results.append(
            {
                "id": host_slug(name),
                "name": name,
                "current": cfg.vpn_host,
                "proposed": cand["address"],
                "online": bool(cand["online"]),
            }
        )
    return {"ok": True, "results": results, "unmatched": unmatched}


@router.get("/hosts/{host_id}/status")
async def host_status(host_id: str, request: Request) -> HostStatus:
    """Fresh status for one host (bypasses the fleet cache)."""
    status = await request.app.state.fleet.status_of(host_id)
    if status is None:
        raise HTTPException(status_code=404, detail=f"unknown host '{host_id}'")
    return status


@router.post("/hosts", status_code=201)
async def create_host(body: HostIn, request: Request) -> dict[str, Any]:
    """Add a machine — writes a fresh `computers:` entry (409 if the name's slug already exists)."""
    _check_basics(body)
    async with settings_write_lock:
        settings = request.app.state.settings
        new_slug = host_slug(body.name)
        if any(host_slug(n) == new_slug for n in settings.computers):
            raise HTTPException(status_code=409, detail=f"a host named '{body.name}' already exists")
        entry = _host_entry(body, password=body.ssh_password or None)
        _validate(entry)
        await _persist_and_reload(request, lambda doc: _computers(doc).__setitem__(body.name.strip(), entry))
    return await _one_host_dto(request, new_slug)


@router.put("/hosts/{host_id}")
async def update_host(host_id: str, body: HostIn, request: Request) -> dict[str, Any]:
    """Edit a machine. Blank password keeps the stored secret; renaming re-keys the entry (and its id)
    while preserving inner field comments; removed services disappear."""
    _check_basics(body)
    async with settings_write_lock:
        settings = request.app.state.settings
        cur_name = next((n for n in settings.computers if host_slug(n) == host_id), None)
        if cur_name is None:
            raise HTTPException(status_code=404, detail=f"unknown host '{host_id}'")
        new_name = body.name.strip()
        new_slug = host_slug(new_name)
        if new_slug != host_id and any(host_slug(n) == new_slug for n in settings.computers):
            raise HTTPException(status_code=409, detail=f"a host named '{new_name}' already exists")

        stored_pw = settings.computers[cur_name].ssh_password  # real secret (or None)
        password = body.ssh_password if (body.ssh_password not in (None, "")) else stored_pw
        _validate(_host_entry(body, password=password))  # type-check before touching the file

        def mutate(doc: Any) -> None:
            comps = _computers(doc)
            if new_name != cur_name:
                comps[new_name] = comps.pop(cur_name)  # rename in place — keeps the node's comments
            _apply_fields(comps[new_name], body, password=password)

        await _persist_and_reload(request, mutate)
    return await _one_host_dto(request, new_slug)


@router.delete("/hosts/{host_id}", status_code=204)
async def delete_host(host_id: str, request: Request) -> None:
    """Remove a machine from `config.yaml`."""
    async with settings_write_lock:
        settings = request.app.state.settings
        cur_name = next((n for n in settings.computers if host_slug(n) == host_id), None)
        if cur_name is None:
            raise HTTPException(status_code=404, detail=f"unknown host '{host_id}'")

        def mutate(doc: Any) -> None:
            comps = doc.get("computers")
            if hasattr(comps, "get") and cur_name in comps:
                del comps[cur_name]

        await _persist_and_reload(request, mutate)


async def _one_host_dto(request: Request, host_id: str) -> dict[str, Any]:
    """Build the DTO for a single host after a write (fresh status, reloaded config)."""
    fleet = request.app.state.fleet
    host = fleet.host(host_id)
    if host is None:  # shouldn't happen post-write, but stay honest
        raise HTTPException(status_code=404, detail=f"unknown host '{host_id}'")
    cfg = request.app.state.settings.computers.get(host.name)
    return _host_dto(host, await fleet.status_of(host_id), cfg)
