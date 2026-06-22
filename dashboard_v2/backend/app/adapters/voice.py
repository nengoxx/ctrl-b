"""OpenAI-compatible voice (STT + TTS) proxy with primary→fallback failover (Phase 6).

Thin server-side proxies so the browser never holds STT/TTS keys and secure-context/CORS stay clean
(ARCHITECTURE §Voice). Same `AsyncOpenAI` client shape as `InferenceClient`/`EmbeddingsClient` — one
client cached per (base_url, timeouts), `max_retries=0` (we do our own failover, not blind retries).
Split timeouts via `httpx.Timeout(read, connect=…)` so an unreachable endpoint fails over fast while
the actual transcription/synthesis gets a generous read window.

Both ops run through `core.failover`: the primary is tried first, and on **any** error we fall
through to the fallback (Phase 6 Q2 — ensure functionality), returning which endpoint served so the
API can surface a `X-Voice-Served-By` header. TTS buffers the **whole clip** (full-clip playback, so
the PWA mini-player gets a natively seekable blob) — there's no chunked stream, so failover wraps the
entire synth atomically (no mid-stream-failover edge case). All-endpoints-failed → `VoiceError`.
"""

from __future__ import annotations

from dataclasses import dataclass

import httpx
from openai import AsyncOpenAI

from app.config import VoiceCfg, VoiceEndpointCfg, VoiceServiceCfg
from app.core.failover import FailoverError, FailoverResult, failover

# Local servers ignore the key but the SDK requires a non-empty string.
_PLACEHOLDER_KEY = "sk-no-key-required"

#: TTS `response_format` → HTTP media type for the proxied audio response.
_MEDIA_TYPES = {
    "mp3": "audio/mpeg",
    "opus": "audio/ogg",
    "aac": "audio/aac",
    "flac": "audio/flac",
    "wav": "audio/wav",
    "pcm": "audio/pcm",
}


class VoiceError(RuntimeError):
    """Voice unconfigured, or every endpoint in the chain failed — turned into a clean API error."""


@dataclass
class VoiceReply:
    """Where a successful voice op was served from (for the `X-Voice-Served-By` header). `served` is
    "primary"/"fallback" (or the raw index for a longer future chain); `degraded` is True when a
    prior endpoint failed before this one answered."""

    served: str
    degraded: bool


def _reply(result: FailoverResult) -> VoiceReply:
    served = {0: "primary", 1: "fallback"}.get(result.served_index, f"endpoint-{result.served_index}")
    return VoiceReply(served=served, degraded=result.degraded)


class VoiceClient:
    """Builds + caches OpenAI clients per endpoint; runs STT/TTS through the failover chain."""

    def __init__(self, cfg: VoiceCfg) -> None:
        self._cfg = cfg
        self._clients: dict[tuple[str, float, float], AsyncOpenAI] = {}

    def configured(self, service: str) -> bool:
        """Whether `service` ("stt"/"tts") has at least one usable endpoint (and voice is enabled).
        Drives `GET /api/voice/status` so the PWA shows/hides the mic + auto-TTS."""
        svc = self._cfg.stt if service == "stt" else self._cfg.tts
        return bool(self._cfg.enabled and svc.endpoints())

    def status(self) -> dict[str, bool]:
        return {"stt": self.configured("stt"), "tts": self.configured("tts")}

    def _client(self, ep: VoiceEndpointCfg, svc: VoiceServiceCfg) -> AsyncOpenAI:
        # Key by (url, timeouts) so STT and TTS sharing a host but wanting different windows don't
        # collide on one cached client.
        key = (ep.base_url, svc.connect_timeout_s, svc.timeout_s)
        if key not in self._clients:
            self._clients[key] = AsyncOpenAI(
                base_url=ep.base_url,
                api_key=ep.api_key or _PLACEHOLDER_KEY,
                timeout=httpx.Timeout(svc.timeout_s, connect=svc.connect_timeout_s),
                max_retries=0,
            )
        return self._clients[key]

    async def transcribe(
        self, *, content: bytes, filename: str, content_type: str | None
    ) -> tuple[str, VoiceReply]:
        """Push-to-talk STT: forward the recorded clip (filename + content-type preserved, since many
        Whisper servers route by extension) to each endpoint's `/v1/audio/transcriptions` until one
        answers. Returns the transcript text + which endpoint served. Raises `VoiceError`."""
        if not self.configured("stt"):
            raise VoiceError("speech-to-text is not configured")
        svc = self._cfg.stt
        # vad_filter/hotwords are faster-whisper/Speaches extras (not standard OpenAI params), so they
        # ride the SDK's `extra_body` escape hatch; a user-set `extra_body` merges on top (wins).
        extra: dict = {"vad_filter": svc.vad_filter}
        if svc.hotwords.strip():
            extra["hotwords"] = svc.hotwords.strip()
        extra.update(svc.extra_body or {})
        kwargs: dict = {"extra_body": extra}
        if svc.language.strip():          # blank → omit so the server auto-detects
            kwargs["language"] = svc.language.strip()

        async def attempt(ep: VoiceEndpointCfg) -> str:
            resp = await self._client(ep, svc).audio.transcriptions.create(
                model=ep.model or "whisper-1",
                file=(filename, content, content_type or "application/octet-stream"),
                **kwargs,
            )
            return getattr(resp, "text", "") or ""

        try:
            result = await failover(svc.endpoints(), attempt, label=lambda e: e.base_url)
        except FailoverError as exc:
            raise VoiceError(str(exc)) from exc
        return result.value, _reply(result)

    async def synthesize(
        self, *, text: str, voice: str | None = None
    ) -> tuple[bytes, str, VoiceReply]:
        """Read-aloud TTS: synthesize the **whole clip** (buffered, for a seekable blob) via each
        endpoint's `/v1/audio/speech` until one answers. `voice` overrides the endpoint's configured
        voice (best-effort — a voice id valid on one server may 4xx on another and simply fall
        through, Q2). Returns `(audio_bytes, media_type, served)`. Raises `VoiceError`."""
        if not self.configured("tts"):
            raise VoiceError("text-to-speech is not configured")
        svc = self._cfg.tts
        fmt = svc.format or "mp3"
        kwargs: dict = {"extra_body": svc.extra_body} if svc.extra_body else {}

        async def attempt(ep: VoiceEndpointCfg) -> bytes:
            resp = await self._client(ep, svc).audio.speech.create(
                model=ep.model or "tts-1",
                voice=voice or ep.voice or "alloy",
                input=text,
                response_format=fmt,  # type: ignore[arg-type]  # local servers accept the same set
                **kwargs,
            )
            return await resp.aread()

        try:
            result = await failover(svc.endpoints(), attempt, label=lambda e: e.base_url)
        except FailoverError as exc:
            raise VoiceError(str(exc)) from exc
        return result.value, _MEDIA_TYPES.get(fmt, "application/octet-stream"), _reply(result)

    async def aclose(self) -> None:
        for client in self._clients.values():
            await client.close()
        self._clients.clear()
