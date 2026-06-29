"""yt_captions — fetch a YouTube video's transcript and offer it as a downloadable JSON (Phase 8, D8).

Ported from the v1 Flask server (`wol_server/wol_server_win.py`): same video-id extraction (watch /
youtu.be / embed / shorts) and `youtube-transcript-api` fetch, but reshaped to the registry model —
the transcript rides back in `ToolResult.data` and the Tools-tab card downloads it client-side (the
`data["download"] = {filename, content}` convention), instead of the old `send_file` attachment.

The transcript fetch and the og:title scrape are blocking I/O, so both run via `asyncio.to_thread` /
async httpx — never block the event loop.
"""

from __future__ import annotations

import asyncio
from urllib.parse import parse_qs, urlparse

import httpx
from bs4 import BeautifulSoup
from pydantic import BaseModel, Field
from youtube_transcript_api import YouTubeTranscriptApi, YouTubeTranscriptApiException

from app.core.tool import InvocationContext, tool
from app.domain.enums import RunState
from app.domain.result import ToolResult

#: HTTP timeout for the title scrape. A sane default that becomes a per-tool setting later (ROADMAP E0a).
_HTTP_TIMEOUT = 10.0
#: Cap on the transcript text handed to the *agent* via `output` (the model reads summary+output, never
#: `data`). Keeps a long video from blowing up the context window; the UI still downloads the full
#: transcript from `data.download`. Becomes a per-tool setting later (ROADMAP E0a).
_AGENT_OUTPUT_CAP = 8000


def extract_video_id(url: str) -> str | None:
    """Pull the 11-char video id from a YouTube URL — watch?v=, youtu.be/, /embed/, /shorts/."""
    parsed = urlparse(url.strip())
    host = (parsed.hostname or "").removeprefix("www.")
    if host in ("youtube.com", "m.youtube.com"):
        if parsed.path == "/watch":
            return parse_qs(parsed.query).get("v", [None])[0]
        if parsed.path.startswith(("/embed/", "/shorts/", "/v/")):
            parts = parsed.path.split("/")
            return parts[2] if len(parts) > 2 else None
    if host == "youtu.be":
        return parsed.path.lstrip("/") or None
    return None


async def _fetch_title(video_id: str) -> str:
    """Best-effort video title via the page's og:title meta; falls back to the id on any failure."""
    try:
        async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT, follow_redirects=True) as client:
            resp = await client.get(f"https://www.youtube.com/watch?v={video_id}")
        soup = BeautifulSoup(resp.text, "html.parser")
        tag = soup.find("meta", property="og:title")
        if tag and tag.get("content"):
            return str(tag["content"])
    except Exception:  # title is cosmetic — never fail the tool over it
        pass
    return video_id


def _slug(title: str) -> str:
    """A filesystem-safe download name from the video title."""
    safe = "".join(c if c.isalnum() or c in " -_" else "_" for c in title).strip()
    return (safe or "captions")[:80]


class YtCaptionsInput(BaseModel):
    url: str = Field(..., description="A YouTube video URL (watch?v=…, youtu.be/…, /embed/…, /shorts/…).")


@tool(
    "yt_captions",
    title="YouTube captions",
    description=(
        "Fetch a YouTube video's transcript/captions as structured JSON (segments with text + "
        "timestamps). Use when the owner gives a YouTube URL and wants the captions or a transcript."
    ),
    icon="yt",
    # The transcript fetch (youtube-transcript-api) has no internal timeout; 60s is generous enough
    # that even a long video's fetch completes well under it, while bounding a true hang.
    timeout_s=60,
)
async def yt_captions(inp: YtCaptionsInput, ctx: InvocationContext) -> ToolResult:
    """Fetch a YouTube transcript and return it as downloadable JSON."""
    video_id = extract_video_id(inp.url)
    if not video_id:
        return ToolResult(state=RunState.ERROR, summary="Not a recognizable YouTube URL.")
    try:
        fetched = await asyncio.to_thread(YouTubeTranscriptApi().fetch, video_id)
    except YouTubeTranscriptApiException as exc:
        return ToolResult(
            state=RunState.ERROR,
            summary="Couldn't fetch captions for that video.",
            error=str(exc)[:300],
        )

    segments = fetched.to_raw_data()  # [{text, start, duration}, …]
    title = await _fetch_title(video_id)
    words = sum(len(s.get("text", "").split()) for s in segments)

    # The model reads `summary` + `output` (never `data`), so hand it the transcript *text* here —
    # bounded, so a long video can't blow up the context. The UI downloads the full structured
    # transcript from `data.download` (UI-only).
    text = " ".join(s.get("text", "") for s in segments).strip()
    output = text[:_AGENT_OUTPUT_CAP]
    if len(text) > _AGENT_OUTPUT_CAP:
        output += "\n…(transcript truncated; full text in the download)"

    return ToolResult(
        state=RunState.OK,
        summary=f"{title} — {len(segments)} caption segments (~{words} words).",
        output=output,
        data={
            "video_id": video_id,
            "title": title,
            "segment_count": len(segments),
            "download": {"filename": f"{_slug(title)}_captions.json", "content": segments},
        },
    )
