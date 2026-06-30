"""Generic OpenAPI tool provider (Phase 4f) — the HTTP sibling of the MCP client.

Many useful agent backends aren't MCP servers but plain OpenAPI/REST services (Open WebUI "tool
servers", open-terminal, countless others). This provider fetches a service's OpenAPI document at
startup and registers **every operation** as a `Tool` in the shared registry — so they flow through
`ActionService` + the permission gate + the `.b.cmd` bubble exactly like built-in actions and MCP
tools. The agent never special-cases "is this OpenAPI."

Each operation becomes `api__<server>__<operationId>`. The model is handed a **self-contained JSON
Schema** built by merging the operation's path/query parameters (top-level props) with its request
body (a nested `body` prop), with `#/components/schemas/...` `$ref`s rewritten to local `$defs` so
the schema needs no external resolution. On call, the flat args are split back into path
substitutions, query params, and the JSON body.

Risk: **GET/HEAD auto-run** (LOW — reads); mutating verbs use the server's configured `risk`
(default `med` → confirm). Per-server failure isolation: a server whose spec won't load logs +
registers nothing, never breaking startup.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

import httpx
from pydantic import BaseModel

from app.config import OpenApiServerCfg
from app.core.tool import InvocationContext, ToolSpec
from app.domain.enums import Risk, RunState
from app.domain.result import ToolResult

if TYPE_CHECKING:
    from app.core.tool import ToolRegistry

log = logging.getLogger("ctrlb.openapi")

_MAX_OUTPUT_CHARS = 6000
_RISK = {"low": Risk.LOW, "med": Risk.MED, "high": Risk.HIGH}
_READ_METHODS = {"get", "head"}


class OpenApiError(RuntimeError):
    """Spec load / call failure — caught at discovery (logged) or normalized to a ToolResult."""


class _PassthroughArgs(BaseModel):
    """Accepts any args; the real schema is handed to the model via `ToolSpec.raw_schema`."""

    model_config = {"extra": "allow"}


def _qualified(server: str, op: str) -> str:
    return re.sub(r"[^A-Za-z0-9_-]", "_", f"api__{server}__{op}")[:64]


def _rewrite_refs(node: Any) -> Any:
    """Deep-copy a schema fragment, rewriting `#/components/schemas/X` $refs to `#/$defs/X` so the
    schema is self-contained once we attach `$defs` (OpenAI tool schemas resolve local $defs)."""
    if isinstance(node, dict):
        out = {}
        for k, v in node.items():
            if k == "$ref" and isinstance(v, str):
                out[k] = v.replace("#/components/schemas/", "#/$defs/")
            else:
                out[k] = _rewrite_refs(v)
        return out
    if isinstance(node, list):
        return [_rewrite_refs(v) for v in node]
    return node


@dataclass
class _Op:
    """A resolved operation: how to issue it + the schema handed to the model."""

    name: str
    method: str
    path: str                      # may contain {param} templates
    params: list[dict]             # OpenAPI parameter objects (in: path|query|header)
    has_body: bool
    risk: Risk
    description: str
    schema: dict


@dataclass
class OpenApiTool:
    spec: ToolSpec
    _provider: "OpenApiToolProvider"
    _server: OpenApiServerCfg
    _op: _Op

    async def run(self, inp: BaseModel, ctx: InvocationContext) -> ToolResult:  # noqa: ARG002
        return await self._provider.call(self._server, self._op, inp.model_dump(mode="json"))


class OpenApiToolProvider:
    def __init__(self, servers: list[OpenApiServerCfg]) -> None:
        self._servers = [s for s in servers if s.enabled]
        self._clients: dict[str, httpx.AsyncClient] = {}

    def _http(self, server: OpenApiServerCfg) -> httpx.AsyncClient:
        if server.name not in self._clients:
            headers = {"User-Agent": "ctrl-b/1.0", **server.headers}
            if server.api_key:
                val = f"{server.auth_scheme} {server.api_key}".strip() if server.auth_scheme else server.api_key
                headers[server.auth_header] = val
            self._clients[server.name] = httpx.AsyncClient(
                base_url=server.base_url.rstrip("/"),
                headers=headers,
                timeout=server.connect_timeout_s,
            )
        return self._clients[server.name]

    def _build_op(self, server: OpenApiServerCfg, method: str, path: str, op: dict, defs: dict) -> _Op:
        params = [p for p in op.get("parameters", []) if isinstance(p, dict)]
        props: dict[str, Any] = {}
        required: list[str] = []
        for p in params:
            if p.get("in") not in ("path", "query", "header"):
                continue
            props[p["name"]] = _rewrite_refs(p.get("schema") or {"type": "string"})
            if p.get("required"):
                required.append(p["name"])

        body = op.get("requestBody") or {}
        body_schema = (body.get("content", {}).get("application/json", {}) or {}).get("schema")
        has_body = body_schema is not None
        if has_body:
            props["body"] = _rewrite_refs(body_schema)
            if body.get("required"):
                required.append("body")

        schema: dict[str, Any] = {"type": "object", "properties": props}
        if required:
            schema["required"] = required
        if defs:
            schema["$defs"] = defs

        opid = op.get("operationId") or f"{method}_{path.strip('/').replace('/', '_') or 'root'}"
        risk = Risk.LOW if method in _READ_METHODS else _RISK.get(server.risk, Risk.MED)
        desc = op.get("summary") or op.get("description") or f"{method.upper()} {path}"
        return _Op(
            name=_qualified(server.name, opid),
            method=method,
            path=path,
            params=params,
            has_body=has_body,
            risk=risk,
            description=desc[:300],
            schema=schema,
        )

    def _included(self, server: OpenApiServerCfg, opid: str, path: str) -> bool:
        return not server.include or opid in server.include or path in server.include

    async def discover(self, registry: "ToolRegistry") -> list[dict]:
        """Fetch each server's OpenAPI doc and register a tool per operation. Per-server isolated."""
        summary: list[dict] = []
        for server in self._servers:
            spec_url = server.spec_url or (server.base_url.rstrip("/") + "/openapi.json")
            try:
                resp = await self._http(server).get(spec_url)
                resp.raise_for_status()
                spec = resp.json()
            except Exception as exc:  # noqa: BLE001 — a bad spec must not break startup
                log.warning("OpenAPI server %r spec load failed: %s", server.name, exc)
                summary.append({"server": server.name, "tools": 0, "error": str(exc)})
                continue

            defs = _rewrite_refs(spec.get("components", {}).get("schemas", {})) or {}
            registered = 0
            for path, item in (spec.get("paths") or {}).items():
                if not isinstance(item, dict):
                    continue
                for method, op in item.items():
                    if method.lower() not in {"get", "post", "put", "patch", "delete", "head"}:
                        continue
                    if not isinstance(op, dict):
                        continue
                    opid = op.get("operationId") or f"{method}_{path}"
                    if not self._included(server, opid, path):
                        continue
                    built = self._build_op(server, method.lower(), path, op, defs)
                    spec_obj = ToolSpec(
                        name=built.name,
                        title=built.name,
                        description=built.description,
                        category="mcp",  # external tool (shares the "remote tool" bucket; not a UI action)
                        input_model=_PassthroughArgs,
                        raw_schema=built.schema,
                        risk=built.risk,
                        agent_exposed=True,
                        ui_exposed=False,
                    )
                    try:
                        registry.register(
                            OpenApiTool(spec=spec_obj, _provider=self, _server=server, _op=built)
                        )
                        registered += 1
                    except ValueError:
                        log.debug("OpenAPI tool %r already registered; skipping", built.name)
            log.info("OpenAPI server %r: registered %d tool(s)", server.name, registered)
            summary.append({"server": server.name, "tools": registered, "error": None})
        return summary

    async def call(self, server: OpenApiServerCfg, op: _Op, args: dict) -> ToolResult:
        """Split flat args into path/query/header/body, issue the request, normalize the response."""
        url_path = op.path
        query: dict[str, Any] = {}
        extra_headers: dict[str, str] = {}
        for p in op.params:
            name, loc = p.get("name"), p.get("in")
            if name not in args or args[name] is None:
                continue
            val = args[name]
            if loc == "path":
                url_path = url_path.replace("{" + name + "}", str(val))
            elif loc == "query":
                query[name] = val
            elif loc == "header":
                extra_headers[name] = str(val)
        body = args.get("body") if op.has_body else None
        try:
            resp = await self._http(server).request(
                op.method, url_path, params=query or None, json=body, headers=extra_headers or None
            )
            resp.raise_for_status()
            payload: Any = resp.json() if resp.content else None
        except httpx.HTTPStatusError as exc:
            detail = exc.response.text[:300]
            return ToolResult(
                state=RunState.ERROR, summary=f"{op.name} HTTP {exc.response.status_code}", error=detail
            )
        except Exception as exc:  # noqa: BLE001 — normalize any transport/parse error
            # A non-JSON 2xx body is fine — fall back to text.
            try:
                text = resp.text  # type: ignore[possibly-undefined]
                payload = text
            except Exception:  # noqa: BLE001
                return ToolResult(state=RunState.ERROR, summary=f"{op.name} failed", error=str(exc)[:300])

        import json as _json

        output = payload if isinstance(payload, str) else _json.dumps(payload, indent=1, default=str)
        if output and len(output) > _MAX_OUTPUT_CHARS:
            output = output[:_MAX_OUTPUT_CHARS] + "\n… [truncated]"
        return ToolResult(
            state=RunState.OK,
            summary=f"{op.name} ok" + (f" · {len(output)} chars" if output else ""),
            output=output or None,
            data={"result": payload} if not isinstance(payload, str) else {},
        )

    async def aclose(self) -> None:
        for c in self._clients.values():
            await c.aclose()
        self._clients.clear()
