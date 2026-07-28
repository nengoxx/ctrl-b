"""Voice API (Phase 6) — STT in / TTS out, thin proxies over `VoiceClient`.

The browser never holds STT/TTS keys: it posts a recorded clip / some text here, the server forwards
it to the configured OpenAI-compatible endpoint(s) with failover, and returns the transcript / audio.
`GET /voice/status` is the capability probe the PWA uses to decide whether to show the mic + auto-TTS
(without exposing whether keys exist). Thin by design (AGENTS conventions): validate + delegate.

HTTP contract: a success always returns 200 with `X-Voice-Served-By: <provider>` — the NAME of the
registry provider that actually served (A11/D48; a fallback serve carries that fallback's provider name,
a single-user diagnostic surface); every endpoint failing → 502 (the aggregated upstream error);
voice/service unconfigured → 503; STT with no file → 422.
"""

from __future__ import annotations

import json

from fastapi import APIRouter, HTTPException, Request, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel

from app.adapters.voice import VoiceClient, VoiceError

router = APIRouter(tags=["voice"], prefix="/voice")


def _client(request: Request) -> VoiceClient:
    return request.app.state.voice


@router.get("/status")
async def voice_status(request: Request) -> dict[str, bool]:
    """Capability probe: which voice services are configured + enabled, plus the STT auto-send flag
    (`{stt, tts, stt_auto_send}`). The FE `useVoiceStatus` contract is unchanged. `stt_auto_send` is a
    client-behavior flag (not a wire capability), so it is composed HERE from live settings (A11/R2) —
    the frozen resolved chain the `VoiceClient` holds deliberately doesn't carry it."""
    status = _client(request).status()
    status["stt_auto_send"] = request.app.state.settings.voice.stt.auto_send
    return status


@router.post("/stt")
async def stt(request: Request, file: UploadFile) -> Response:
    """Transcribe an uploaded audio clip → `{text}`. The clip's filename + content-type are forwarded
    as-is (Whisper servers often route by extension)."""
    voice = _client(request)
    if not voice.configured("stt"):
        raise HTTPException(status_code=503, detail="speech-to-text is not configured")
    max_bytes = request.app.state.settings.voice.stt.max_upload_bytes
    # Read at most cap+1 bytes: that is the least that still proves "over the cap", so an oversized
    # clip is refused without ever materializing more than the cap in memory (v1.3.1 Codex review).
    content = await file.read(max_bytes + 1)
    if not content:
        raise HTTPException(status_code=422, detail="empty audio upload")
    if len(content) > max_bytes:
        # The true size is deliberately NOT reported — we stopped reading at cap+1.
        raise HTTPException(
            status_code=413,
            detail=f"audio upload too large (limit {max_bytes} bytes)",
        )
    try:
        text, served = await voice.transcribe(
            content=content,
            filename=file.filename or "audio.webm",
            content_type=file.content_type,
        )
    except VoiceError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return Response(
        content=json.dumps({"text": text}),
        media_type="application/json",
        headers={"X-Voice-Served-By": served.served},
    )


class TtsRequest(BaseModel):
    text: str
    voice: str | None = None


@router.post("/tts")
async def tts(body: TtsRequest, request: Request) -> Response:
    """Synthesize speech for `text` → the full audio clip (buffered, seekable). Optional `voice`
    overrides the configured endpoint voice."""
    voice = _client(request)
    if not voice.configured("tts"):
        raise HTTPException(status_code=503, detail="text-to-speech is not configured")
    if not body.text.strip():
        raise HTTPException(status_code=422, detail="empty text")
    max_chars = request.app.state.settings.voice.tts.max_text_chars
    if len(body.text) > max_chars:
        raise HTTPException(
            status_code=422,
            detail=f"text too long ({len(body.text)} chars; limit {max_chars})",
        )
    try:
        audio, media_type, served = await voice.synthesize(text=body.text, voice=body.voice)
    except VoiceError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return Response(
        content=audio,
        media_type=media_type,
        headers={
            "X-Voice-Served-By": served.served,
            "Content-Length": str(len(audio)),
            "Cache-Control": "no-store",
        },
    )
