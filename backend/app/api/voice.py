"""Voice API (Phase 6) — STT in / TTS out, thin proxies over `VoiceClient`.

The browser never holds STT/TTS keys: it posts a recorded clip / some text here, the server forwards
it to the configured OpenAI-compatible endpoint(s) with failover, and returns the transcript / audio.
`GET /voice/status` is the capability probe the PWA uses to decide whether to show the mic + auto-TTS
(without exposing whether keys exist). Thin by design (AGENTS conventions): validate + delegate.

HTTP contract: a success always returns 200 with `X-Voice-Served-By: <provider>` — the NAME of the
registry provider that actually served (A11/D48; a fallback serve carries that fallback's provider name,
a single-user diagnostic surface); TTS additionally carries `X-Voice-Target: <provider>/<model>`, the
machine-readable identity a chunked reply pins with `prefer` (D63), plus `X-Voice-Degraded: 1` ONLY
when a hop failed before the serving one answered (the client's serve flash is exception-only, so the
header exists exactly where it says something); every endpoint failing → 502 (the aggregated upstream
error); voice/service unconfigured → 503; STT with no file → 422.
"""

from __future__ import annotations

import json

from fastapi import APIRouter, HTTPException, Request, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel

from app.adapters.voice import AUDIO_FORMATS, VoiceClient, VoiceError

router = APIRouter(tags=["voice"], prefix="/voice")


def _client(request: Request) -> VoiceClient:
    return request.app.state.voice


@router.get("/status")
async def voice_status(request: Request) -> dict[str, object]:
    """Capability probe: which voice services are configured + enabled, the STT auto-send flag, and the
    D63 TTS chunk policy (`{stt, tts, stt_auto_send, tts_chunking}`). Everything past the two capability
    bits is CLIENT BEHAVIOR composed HERE from live settings (A11/R2) — the frozen resolved chain the
    `VoiceClient` holds deliberately doesn't carry it — and this probe is the always-on endpoint the PWA
    already polls, so the chunker needs no query of its own.

    `tts_chunking` is shape-only: split mode + the size floors/caps + the container the client should ask
    for. No endpoint, no key, no model id — nothing here says whether a secret exists."""
    status: dict[str, object] = dict(_client(request).status())
    tts = request.app.state.settings.voice.tts
    status["stt_auto_send"] = request.app.state.settings.voice.stt.auto_send
    status["tts_chunking"] = {
        "mode": tts.chunking,
        "min_words": tts.chunk_min_words,
        "min_chars": tts.chunk_min_chars,
        "max_chars": tts.chunk_max_chars,
        "lookahead": tts.chunk_lookahead,
        "max_text_chars": tts.max_text_chars,
        "format": tts.chunk_format,
    }
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
    #: D63 — the container this call wants (chunked playback asks for `chunk_format`). Bounded by the
    #: closed `AUDIO_FORMATS` allowlist (adapters/voice); precedence at the wire is request > model >
    #: service.
    format: str | None = None
    #: D63 failover pin — `provider/model` (the `X-Voice-Target` of an earlier chunk) tried FIRST. An
    #: unknown value is a silent miss, not an error: the pinned target may have vanished mid-reply.
    prefer: str | None = None


@router.post("/tts")
async def tts(body: TtsRequest, request: Request) -> Response:
    """Synthesize speech for `text` → the full audio clip (buffered, seekable). Optional `voice`
    overrides the configured endpoint voice; optional `format` overrides the container; optional
    `prefer` pins which target the failover chain tries first. `X-Voice-Served-By` names the provider
    that served (display); `X-Voice-Target` is its full `provider/model` identity — the value the
    client echoes back as `prefer` on the rest of a chunked reply; `X-Voice-Degraded` appears only on
    a degraded serve, which is the one case the client announces who read the reply."""
    voice = _client(request)
    if not voice.configured("tts"):
        raise HTTPException(status_code=503, detail="text-to-speech is not configured")
    if not body.text.strip():
        raise HTTPException(status_code=422, detail="empty text")
    if body.format is not None and body.format not in AUDIO_FORMATS:
        raise HTTPException(
            status_code=422,
            detail=f"unsupported format {body.format!r} (allowed: {', '.join(sorted(AUDIO_FORMATS))})",
        )
    max_chars = request.app.state.settings.voice.tts.max_text_chars
    if len(body.text) > max_chars:
        raise HTTPException(
            status_code=422,
            detail=f"text too long ({len(body.text)} chars; limit {max_chars})",
        )
    try:
        audio, media_type, served = await voice.synthesize(
            text=body.text, voice=body.voice, audio_format=body.format, prefer=body.prefer
        )
    except VoiceError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    headers = {
        "X-Voice-Served-By": served.served,
        "X-Voice-Target": served.target,
        "Content-Length": str(len(audio)),
        "Cache-Control": "no-store",
    }
    if served.degraded:
        headers["X-Voice-Degraded"] = "1"  # absent on the happy path — see the module docstring
    return Response(content=audio, media_type=media_type, headers=headers)
