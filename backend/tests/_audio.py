"""Shared audio test helpers (Phase 26): in-test ENCODED audio (no committed binaries beyond the one
conformance fixture) and a FAKE parakeet-server for the clip door's HTTP leg.

* `encode` — a tone (or silence) encoded by PyAV's own encoders into any container the clip door decodes
  (moved here from `test_voice_prepass_s6i.py` in S9, so the decode tests and the clip-door tests share
  one encoder instead of two copies).
* `FakeEngine` — the house HTTP-mock pattern (`httpx.MockTransport`) shaped like parakeet-server v0.5.0
  (S9 audit §A): `POST /v1/audio/transcriptions` reads ONLY `file` (+ `response_format`), answers 400 to
  anything that is not a WAV, and ignores every other field. It records each request's form so a test can
  assert the REAL request shape the SDK put on the wire (ASR_PLAN §3.7 T-5). Installed per test by
  `install` (patches `VoiceClient._client`, so the SDK's own multipart encoding is exercised).
"""

from __future__ import annotations

import asyncio
import email
import email.policy
import io
import wave
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import av
import httpx
import numpy as np
from openai import AsyncOpenAI

#: The committed conformance fixture (S6-i ruling H12): 3 s of real speech, 16 kHz mono pcm16.
FIXTURE = Path(__file__).resolve().parent / "data" / "silero_test_3s.wav"


def encode(
    fmt: str,
    codec: str,
    rate: int,
    seconds: float = 1.0,
    *,
    amplitude: float = 0.3,
    samples: np.ndarray | None = None,
) -> bytes:
    """A 440 Hz tone (`amplitude` 0 = digital silence) — or the given int16 `samples` at `rate` — encoded
    IN-TEST by PyAV's own encoder."""
    buf = io.BytesIO()
    with av.open(buf, mode="w", format=fmt) as container:
        stream = container.add_stream(codec, rate=rate, layout="mono")
        if samples is None:
            t = np.arange(int(rate * seconds)) / rate
            x = (amplitude * np.sin(2 * np.pi * 440 * t) * 32767).astype(np.int16)
        else:
            x = np.asarray(samples, dtype=np.int16)
        size = 960 if codec == "libopus" else 1024
        for at in range(0, len(x), size):
            chunk = x[at : at + size].reshape(1, -1)
            frame = av.AudioFrame.from_ndarray(chunk, format="s16", layout="mono")
            frame.sample_rate, frame.pts = rate, at
            for packet in stream.encode(frame):  # type: ignore[attr-defined]
                container.mux(packet)
        for packet in stream.encode(None):  # type: ignore[attr-defined]
            container.mux(packet)
    return buf.getvalue()


def fixture_samples() -> np.ndarray:
    """The conformance fixture's int16 samples (16 kHz mono)."""
    with wave.open(str(FIXTURE), "rb") as w:
        return np.frombuffer(w.readframes(w.getnframes()), dtype="<i2")


def wav_info(body: bytes) -> tuple[int, int, int, int]:
    """`(channels, rate, sample width, frames)` of a WAV body — raises on anything that is not one."""
    with wave.open(io.BytesIO(body), "rb") as w:
        return w.getnchannels(), w.getframerate(), w.getsampwidth(), w.getnframes()


@dataclass
class EngineRequest:
    url: str
    fields: dict[str, bytes]
    filename: str | None
    content_type: str | None
    body: bytes


Responder = Callable[[EngineRequest], Awaitable[str] | str]


@dataclass
class FakeEngine:
    """A parakeet-server stand-in per `base_url` host. `responders[host]` answers a request's text (sync
    or async — an async one can park on an event, the way the real server parks on its mutex, and is cut at
    the client's READ timeout like a real socket); an exception it raises becomes a 500, and a host with no
    responder refuses the connection."""

    responders: dict[str, Responder] = field(default_factory=dict)
    requests: list[EngineRequest] = field(default_factory=list)

    async def handle(self, request: httpx.Request) -> httpx.Response:
        host = request.url.host
        responder = self.responders.get(host)
        if responder is None:
            raise httpx.ConnectError(f"connection refused: {host}", request=request)
        raw = await request.aread()
        head = b"Content-Type: " + request.headers["content-type"].encode() + b"\r\n\r\n"
        msg = email.message_from_bytes(head + raw, policy=email.policy.HTTP)
        fields: dict[str, bytes] = {}
        filename = content_type = None
        for part in msg.iter_parts():  # type: ignore[attr-defined]
            name = part.get_param("name", header="content-disposition")
            payload = part.get_payload(decode=True)
            fields[name] = payload if isinstance(payload, bytes) else b""
            if name == "file":
                filename, content_type = part.get_filename(), part.get_content_type()
        seen = EngineRequest(str(request.url), fields, filename, content_type, fields.get("file", b""))
        self.requests.append(seen)
        if not seen.body.startswith(b"RIFF"):  # parakeet-server: dr_wav or nothing
            return httpx.Response(400, json={"error": "accepts WAV uploads only"})
        try:
            text = responder(seen)
            if asyncio.iscoroutine(text):
                # The READ timeout the SDK client was built with, enforced here: MockTransport enforces
                # none, and a real socket would give up on a stalled engine after exactly this long.
                read = (request.extensions.get("timeout") or {}).get("read")
                try:
                    text = await asyncio.wait_for(text, read)
                except TimeoutError:
                    raise httpx.ReadTimeout("the engine did not answer in time", request=request) from None
        except httpx.TimeoutException:
            raise
        except Exception as exc:  # noqa: BLE001 — the server's inference-exception path
            return httpx.Response(500, json={"error": str(exc)})
        return httpx.Response(200, json={"text": text})

    def install(self, monkeypatch: Any) -> None:
        """Route every `VoiceClient` SDK client through this engine (the real SDK, a mocked socket)."""
        from app.adapters.voice import VoiceClient

        engine = self

        def client(self: VoiceClient, target: Any, connect_timeout_s: float, timeout_s: float) -> AsyncOpenAI:
            key = (target.provider, connect_timeout_s, timeout_s)
            if key not in self._clients:
                self._clients[key] = AsyncOpenAI(
                    base_url=target.base_url,
                    api_key="sk-test",
                    timeout=httpx.Timeout(timeout_s, connect=connect_timeout_s),  # as `_client` builds it
                    max_retries=0,
                    http_client=httpx.AsyncClient(transport=httpx.MockTransport(engine.handle)),
                )
            return self._clients[key]

        monkeypatch.setattr(VoiceClient, "_client", client)
