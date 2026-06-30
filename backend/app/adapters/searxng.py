"""SearXNG metasearch adapter (Phase 4f, D9) — backs the agent `web_search` tool.

A thin async client over the instance's `/search?format=json` API. One lazily-built
`httpx.AsyncClient` is cached for the process and closed at shutdown (mirrors the inference
client's per-process reuse). Any failure (instance down, JSON format disabled → non-JSON body,
timeout) raises `SearxngError`, which the tool turns into a clean `ToolResult` — never a stack
trace to the agent or UI.

The instance must enable the JSON output format in its `settings.yml`
(`search.formats: [html, json]`); a default SearXNG only serves HTML and will 403/return HTML
here, which surfaces as a `SearxngError` the tool reports verbatim.
"""

from __future__ import annotations

from dataclasses import dataclass

import httpx

from app.config import SearxngCfg


class SearxngError(RuntimeError):
    """Any SearXNG failure (unreachable, non-JSON body, timeout, bad status) — caught by the tool."""


@dataclass
class SearchResult:
    """One normalized hit. SearXNG returns more fields per engine; we keep the stable, useful ones."""

    title: str
    url: str
    content: str = ""
    engine: str | None = None


class SearxngClient:
    """Builds + caches one httpx client; queries the configured SearXNG instance for JSON results."""

    def __init__(self, cfg: SearxngCfg) -> None:
        self._cfg = cfg
        self._client: httpx.AsyncClient | None = None

    @property
    def configured(self) -> bool:
        return bool(self._cfg.enabled and self._cfg.base_url)

    def _http(self) -> httpx.AsyncClient:
        if self._client is None:
            # A real browser-ish UA: some SearXNG instances reject the default httpx UA as a bot.
            self._client = httpx.AsyncClient(
                timeout=self._cfg.timeout_s,
                headers={"User-Agent": "ctrl-b/1.0 (homelab dashboard)"},
            )
        return self._client

    async def search(
        self,
        query: str,
        *,
        count: int = 5,
        categories: str | None = None,
        language: str | None = None,
    ) -> list[SearchResult]:
        """Run a metasearch and return up to `count` normalized results. `categories` is SearXNG's
        comma-separated category filter (e.g. `general`, `news`, `it`); `language` overrides the
        configured default. Raises `SearxngError` on any failure (incl. the JSON format disabled)."""
        if not self.configured:
            raise SearxngError("searxng is not configured")
        params: dict[str, str] = {"q": query, "format": "json"}
        if categories:
            params["categories"] = categories
        lang = language or self._cfg.language
        if lang:
            params["language"] = lang
        url = self._cfg.base_url.rstrip("/") + "/search"
        try:
            resp = await self._http().get(url, params=params)
            resp.raise_for_status()
            data = resp.json()
        except SearxngError:
            raise
        except httpx.HTTPStatusError as exc:
            raise SearxngError(f"searxng returned HTTP {exc.response.status_code}") from exc
        except ValueError as exc:  # .json() on an HTML body (JSON format not enabled)
            raise SearxngError(
                "searxng did not return JSON — enable the JSON format in its settings.yml"
            ) from exc
        except Exception as exc:  # noqa: BLE001 — normalize any transport error
            raise SearxngError(str(exc)) from exc

        results = data.get("results") if isinstance(data, dict) else None
        if not isinstance(results, list):
            return []
        out: list[SearchResult] = []
        for r in results[: max(count, 0)]:
            if not isinstance(r, dict):
                continue
            out.append(
                SearchResult(
                    title=str(r.get("title") or ""),
                    url=str(r.get("url") or ""),
                    content=str(r.get("content") or ""),
                    engine=r.get("engine"),
                )
            )
        return out

    async def aclose(self) -> None:
        if self._client is not None:
            await self._client.aclose()
            self._client = None
