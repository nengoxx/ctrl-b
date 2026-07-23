"""OpenAI-compatible voice (STT + TTS) proxy with failover over a resolved target chain (Phase 6 / A11).

Thin server-side proxies so the browser never holds STT/TTS keys and secure-context/CORS stay clean
(ARCHITECTURE §Voice). Same `AsyncOpenAI` client shape as `InferenceClient`/`EmbeddingsClient`. A11/D48
re-keys the adapter onto `tuple[ResolvedTarget, ...]` chains + a frozen per-service policy (`SttPolicy`
/ `TtsPolicy`) — it never reads live `Settings` (C10). One SDK client is cached per
`(provider, connect_timeout_s, timeout_s)` (the provider name + the immutable transport pair, D48/R10),
`max_retries=0` (we do our own failover, not blind retries). Split timeouts via
`httpx.Timeout(read, connect=…)` so an unreachable endpoint fails over fast while the actual
transcription/synthesis gets a generous read window.

Both ops run through `core.failover`: the primary is tried first, and on **any** error we fall through
to the next hop (Phase 6 Q2 — ensure functionality), returning which provider served so the API can
surface `X-Voice-Served-By`. Per attempt the served target's D40 request gate is acquired iff its
effective `max_concurrent_requests` is finite (R4), held for that one attempt. TTS buffers the **whole
clip** (full-clip playback → a seekable blob), so failover wraps the entire synth atomically.
All-endpoints-failed → `VoiceError`.

Generation drain (R5, mirroring `InferenceClient`): a `providers`/voice-section change rebuilds this
client; in-flight calls finish on their captured generation and the old SDK clients close only when the
old generation's refcount empties.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING

import httpx
from openai import AsyncOpenAI

from app.core.failover import FailoverError, FailoverResult, failover_collect
from app.core.provider_registry import EndpointGates

if TYPE_CHECKING:
    import asyncio

    from app.domain.provider import ResolvedTarget, SttPolicy, TtsPolicy

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
    """Where a successful voice op was served from (for the `X-Voice-Served-By` header). `served` is the
    served target's PROVIDER NAME (A11); `degraded` is True when a prior hop failed before this one
    answered."""

    served: str
    degraded: bool


def _reply(chain: "tuple[ResolvedTarget, ...]", result: FailoverResult) -> VoiceReply:
    return VoiceReply(served=chain[result.served_index].provider, degraded=result.degraded)


class VoiceClient:
    """Builds + caches OpenAI clients per (provider, transport); runs STT/TTS through the resolved chains.

    Consumes `ResolvedTarget` chains + frozen `SttPolicy`/`TtsPolicy` (resolution output, never live
    Settings) + the app-owned `EndpointGates`. `enabled` gates both services (a Conf switch); a `None`
    gates registry (tests / standalone) gets a private instance."""

    def __init__(
        self,
        stt: "tuple[ResolvedTarget, ...]",
        stt_policy: "SttPolicy",
        tts: "tuple[ResolvedTarget, ...]",
        tts_policy: "TtsPolicy",
        gates: EndpointGates | None = None,
        *,
        enabled: bool = True,
    ) -> None:
        self._stt = stt
        self._stt_policy = stt_policy
        self._tts = tts
        self._tts_policy = tts_policy
        self._enabled = enabled
        self._gates = gates if gates is not None else EndpointGates()
        #: SDK clients cached by (provider, connect_timeout_s, timeout_s) so STT and TTS sharing a host
        #: but wanting different windows don't collide; they die with this generation (drain).
        self._clients: dict[tuple[str, float, float], AsyncOpenAI] = {}
        #: Generation-drain refcount (R5, the `InferenceClient` pattern): an op increments on entry and
        #: decrements in `finally`; a rebuild publishes the new client then `retire()`s this one, closing
        #: its SDK clients when the last in-flight op completes.
        self._inflight = 0
        self._retired = False

    def configured(self, service: str) -> bool:
        """Whether `service` ("stt"/"tts") has at least one usable target (and voice is enabled).
        Drives `GET /api/voice/status` so the PWA shows/hides the mic + auto-TTS."""
        chain = self._stt if service == "stt" else self._tts
        return bool(self._enabled and chain)

    def status(self) -> dict[str, bool]:
        """Capability bits only. `stt_auto_send` is composed at the API layer from live settings (R2) —
        it is a client-behavior flag, not a wire capability, so it never rides the frozen chain."""
        return {"stt": self.configured("stt"), "tts": self.configured("tts")}

    def _client(self, target: "ResolvedTarget", connect_timeout_s: float, timeout_s: float) -> AsyncOpenAI:
        key = (target.provider, connect_timeout_s, timeout_s)
        if key not in self._clients:
            self._clients[key] = AsyncOpenAI(
                base_url=target.base_url,
                api_key=(target.api_key.get_secret_value() if target.api_key else "") or _PLACEHOLDER_KEY,
                timeout=httpx.Timeout(timeout_s, connect=connect_timeout_s),
                max_retries=0,
            )
        return self._clients[key]

    def _sem_for(self, target: "ResolvedTarget") -> "asyncio.Semaphore | None":
        """The shared request-gate semaphore for this target, or None when unlimited (the common
        speaches/openrouter case — zero overhead). Keyed `(gate_identity, limit)` in the app-owned
        registry so voice shares the D40 cap with chat on the same server (R4/C4)."""
        limit = target.max_concurrent_requests
        if limit is None:
            return None
        return self._gates.sem_for(target.gate_identity, limit)

    async def transcribe(
        self, *, content: bytes, filename: str, content_type: str | None
    ) -> tuple[str, VoiceReply]:
        """Push-to-talk STT: forward the recorded clip (filename + content-type preserved, since many
        Whisper servers route by extension) to each target's `/v1/audio/transcriptions` until one
        answers. `language` = target model > service policy (C8), omitted when blank; `vad_filter` /
        `hotwords` / service `extra_body` ride the SDK escape hatch. Returns the transcript + which
        provider served. Raises `VoiceError`."""
        if not self.configured("stt"):
            raise VoiceError("speech-to-text is not configured")
        self._inflight += 1
        try:
            policy = self._stt_policy
            # vad_filter/hotwords are faster-whisper/Speaches extras (not standard OpenAI params), so they
            # ride `extra_body`; a service `extra_body` merges on top (wins). Model `extra_body` stays
            # chat-only (D48 homes it as chat passthrough).
            extra: dict = {"vad_filter": policy.vad_filter}
            if policy.hotwords.strip():
                extra["hotwords"] = policy.hotwords.strip()
            extra.update(policy.extra_body or {})

            async def attempt(target: "ResolvedTarget") -> str:
                kwargs: dict = {"extra_body": extra}
                language = (target.language or policy.language or "").strip()
                if language:  # blank → omit so the server auto-detects
                    kwargs["language"] = language
                sem = self._sem_for(target)
                if sem is not None:
                    await sem.acquire()
                try:
                    resp = await self._client(
                        target, policy.connect_timeout_s, policy.timeout_s
                    ).audio.transcriptions.create(
                        model=target.model,
                        file=(filename, content, content_type or "application/octet-stream"),
                        **kwargs,
                    )
                finally:
                    if sem is not None:
                        sem.release()
                return getattr(resp, "text", "") or ""

            try:
                result = await failover_collect(self._stt, attempt, label=lambda t: t.provider)
            except FailoverError as exc:
                raise VoiceError(str(exc)) from exc
            return result.value, _reply(self._stt, result)
        finally:
            await self._release_inflight()

    async def synthesize(self, *, text: str, voice: str | None = None) -> tuple[bytes, str, VoiceReply]:
        """Read-aloud TTS: synthesize the **whole clip** (buffered, for a seekable blob) via each target's
        `/v1/audio/speech` until one answers. `voice` precedence = request > model voice > "alloy"; `speed`
        is sent iff the model set it. Each attempt returns `(bytes, effective_format)` where the format is
        model > service (C8); the response media type maps the WINNING hop's format. Returns
        `(audio_bytes, media_type, served)`. Raises `VoiceError`."""
        if not self.configured("tts"):
            raise VoiceError("text-to-speech is not configured")
        self._inflight += 1
        try:
            policy = self._tts_policy
            base_extra: dict = {"extra_body": policy.extra_body} if policy.extra_body else {}

            async def attempt(target: "ResolvedTarget") -> tuple[bytes, str]:
                effective_format = target.format or policy.format or "mp3"
                kwargs: dict = dict(base_extra)
                if target.speed is not None:
                    kwargs["speed"] = target.speed
                sem = self._sem_for(target)
                if sem is not None:
                    await sem.acquire()
                try:
                    resp = await self._client(
                        target, policy.connect_timeout_s, policy.timeout_s
                    ).audio.speech.create(
                        model=target.model,
                        voice=voice or target.voice or "alloy",
                        input=text,
                        response_format=effective_format,  # type: ignore[arg-type]
                        **kwargs,
                    )
                    data = await resp.aread()
                finally:
                    if sem is not None:
                        sem.release()
                return data, effective_format

            try:
                result = await failover_collect(self._tts, attempt, label=lambda t: t.provider)
            except FailoverError as exc:
                raise VoiceError(str(exc)) from exc
            audio, fmt = result.value
            return audio, _MEDIA_TYPES.get(fmt, "application/octet-stream"), _reply(self._tts, result)
        finally:
            await self._release_inflight()

    async def _close_clients(self) -> None:
        """Close every cached SDK client (best-effort, idempotent)."""
        for client in list(self._clients.values()):
            try:
                await client.close()
            except Exception:  # noqa: BLE001 — closing a client is best-effort
                pass
        self._clients.clear()

    async def _release_inflight(self) -> None:
        """Decrement the refcount and, if retired while draining, close the SDK clients on the last
        completion (R5)."""
        self._inflight -= 1
        if self._retired and self._inflight <= 0:
            await self._close_clients()

    async def retire(self) -> None:
        """Retire this generation (R5): close idle SDK clients now, else defer to the last in-flight op.
        Called by `runtime` AFTER the new generation is published."""
        self._retired = True
        if self._inflight <= 0:
            await self._close_clients()

    async def aclose(self) -> None:
        """Shutdown close (main.py lifespan). Retirement is the hot-swap path; this is the process exit."""
        await self._close_clients()
