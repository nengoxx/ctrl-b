"""open-terminal client (Phase 4f) — a thin async wrapper over the open-webui/open-terminal REST
API (https://github.com/open-webui/open-terminal). open-terminal is a self-hosted "computer you can
curl": a Bearer-auth HTTP service exposing a remote shell (`/execute`) and file ops (`/files/*`).

It is **not** an MCP server — plain HTTP — so it's wired as curated typed actions
(`services/actions/terminal.py`) rather than through the MCP client. One lazily-built
`httpx.AsyncClient` (with the Bearer header + base_url) is cached for the process and closed at
shutdown. Any failure raises `OpenTerminalError`, which the action turns into a clean `ToolResult`.

Endpoints used here (verified against v0.11.34):
  POST /execute?wait=<seconds>   {command, cwd?, env?}     # synchronous run (waits up to N sec)
  GET  /files/read?path=&start_line=&end_line=
  GET  /files/list?directory=
  GET  /files/grep?query=&path=&regex=&case_insensitive=&include=&max_results=
  GET  /files/glob?pattern=&path=&type=&max_results=
  POST /files/write              {path, content}
"""

from __future__ import annotations

from typing import Any

import httpx

from app.config import OpenTerminalCfg


class OpenTerminalError(RuntimeError):
    """Any open-terminal failure (unreachable, auth, bad status) — caught by the action layer."""


class OpenTerminalClient:
    def __init__(self, cfg: OpenTerminalCfg) -> None:
        self._cfg = cfg
        self._client: httpx.AsyncClient | None = None

    @property
    def configured(self) -> bool:
        return bool(self._cfg.enabled and self._cfg.base_url)

    def _http(self) -> httpx.AsyncClient:
        if self._client is None:
            headers = {"User-Agent": "ctrl-b/1.0"}
            if self._cfg.api_key:
                headers["Authorization"] = f"Bearer {self._cfg.api_key}"
            self._client = httpx.AsyncClient(
                base_url=self._cfg.base_url.rstrip("/"),
                headers=headers,
                timeout=self._cfg.timeout_s,
            )
        return self._client

    async def _request(self, method: str, path: str, **kw: Any) -> Any:
        if not self.configured:
            raise OpenTerminalError("open-terminal is not configured")
        try:
            resp = await self._http().request(method, path, **kw)
            resp.raise_for_status()
            return resp.json()
        except OpenTerminalError:
            raise
        except httpx.HTTPStatusError as exc:
            detail = ""
            try:
                detail = exc.response.json().get("detail", "")
            except Exception:  # noqa: BLE001
                detail = exc.response.text[:200]
            raise OpenTerminalError(f"HTTP {exc.response.status_code}: {detail}") from exc
        except Exception as exc:  # noqa: BLE001 — normalize any transport error
            raise OpenTerminalError(str(exc)) from exc

    async def execute(
        self,
        command: str,
        *,
        cwd: str | None = None,
        env: dict[str, str] | None = None,
        wait_s: float | None = None,
    ) -> dict:
        """Run a shell command synchronously (the server waits up to `wait_s`). Returns the process
        record `{id, status, exit_code, output:[{type,data}], truncated, …}`."""
        body: dict[str, Any] = {"command": command}
        if cwd:
            body["cwd"] = cwd
        if env:
            body["env"] = env
        wait = self._cfg.default_wait_s if wait_s is None else wait_s
        return await self._request("POST", "/execute", params={"wait": wait}, json=body)

    async def read_file(
        self, path: str, *, start_line: int | None = None, end_line: int | None = None
    ) -> dict:
        params: dict[str, Any] = {"path": path}
        if start_line is not None:
            params["start_line"] = start_line
        if end_line is not None:
            params["end_line"] = end_line
        return await self._request("GET", "/files/read", params=params)

    async def list_dir(self, directory: str | None = None) -> dict:
        params = {"directory": directory} if directory else {}
        return await self._request("GET", "/files/list", params=params)

    async def grep(
        self,
        query: str,
        *,
        path: str | None = None,
        regex: bool | None = None,
        case_insensitive: bool | None = None,
        include: str | None = None,
        max_results: int | None = None,
    ) -> dict:
        params: dict[str, Any] = {"query": query}
        if path:
            params["path"] = path
        if regex is not None:
            params["regex"] = regex
        if case_insensitive is not None:
            params["case_insensitive"] = case_insensitive
        if include:
            params["include"] = include
        if max_results is not None:
            params["max_results"] = max_results
        return await self._request("GET", "/files/grep", params=params)

    async def glob(
        self,
        pattern: str,
        *,
        path: str | None = None,
        type: str | None = None,  # noqa: A002 — matches the API param name
        max_results: int | None = None,
    ) -> dict:
        params: dict[str, Any] = {"pattern": pattern}
        if path:
            params["path"] = path
        if type:
            params["type"] = type
        if max_results is not None:
            params["max_results"] = max_results
        return await self._request("GET", "/files/glob", params=params)

    async def write_file(self, path: str, content: str) -> dict:
        return await self._request("POST", "/files/write", json={"path": path, "content": content})

    async def aclose(self) -> None:
        if self._client is not None:
            await self._client.aclose()
            self._client = None
