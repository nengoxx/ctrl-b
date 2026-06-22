"""Phase 6a-1 — voice STT/TTS proxy + the generic failover primitive.

Run plainly: `python tests/test_voice_6a.py` from `backend/` (plain asserts + a __main__ runner), or
under pytest if one is ever added. No network: the SDK client is stubbed per endpoint so we can drive
the failover truth-table deterministically.

Covers:
- `core.failover`: primary served (no degrade), primary-down → fallback served + metadata, every
  endpoint failing → `FailoverError`, empty chain → `FailoverError`.
- config: `VoiceServiceCfg.endpoints()` drops a blank-base_url endpoint; the `voice` api_key rides the
  existing mask/unmask machinery (nested two levels deep) + save/reload round-trip.
- `VoiceClient`: transcribe + synthesize fall over on ANY error (Q2), return the served endpoint,
  and synthesize returns the full bytes + media type. Unconfigured → `VoiceError`.
- API: `/voice/status`, `/voice/stt` (200 + `X-Voice-Served-By`, 422 empty, 503 unconfigured),
  `/voice/tts` (audio bytes + Content-Length + served header, 422 empty).
"""

from __future__ import annotations

import asyncio
import os
import tempfile
from pathlib import Path
from types import SimpleNamespace

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.adapters.voice import VoiceClient, VoiceError
from app.config import (
    Settings,
    VoiceCfg,
    _mask,
    load_settings,
    mask_secrets,
    save_settings,
    unmask_secrets,
)
from app.core.failover import FailoverError, failover


def _run(coro):
    return asyncio.run(coro)


# --- core.failover ----------------------------------------------------------------------------

def test_failover_primary_served() -> None:
    async def go():
        async def attempt(ep):
            return f"ok:{ep}"

        res = await failover(["a", "b"], attempt)
        assert res.value == "ok:a"
        assert res.served_index == 0
        assert res.degraded is False
        assert res.failures == []

    _run(go())


def test_failover_falls_through_on_any_error() -> None:
    async def go():
        async def attempt(ep):
            if ep == "a":
                raise RuntimeError("boom")  # any error → next (Q2)
            return f"ok:{ep}"

        res = await failover(["a", "b"], attempt, label=str)
        assert res.value == "ok:b"
        assert res.served_index == 1
        assert res.degraded is True
        assert len(res.failures) == 1 and "boom" in res.failures[0]

    _run(go())


def test_failover_all_fail_raises() -> None:
    async def go():
        async def attempt(ep):
            raise ValueError(f"down:{ep}")

        try:
            await failover(["a", "b"], attempt)
            raise AssertionError("expected FailoverError")
        except FailoverError as exc:
            assert len(exc.failures) == 2
            assert "down:a" in exc.failures[0]

    _run(go())


def test_failover_empty_chain_raises() -> None:
    async def go():
        async def attempt(ep):  # pragma: no cover - never called
            return ep

        try:
            await failover([], attempt)
            raise AssertionError("expected FailoverError on empty chain")
        except FailoverError as exc:
            assert exc.failures == []

    _run(go())


# --- config: endpoints() + secret round-trip --------------------------------------------------

def test_endpoints_drops_blank_base_url() -> None:
    cfg = VoiceCfg.model_validate(
        {"tts": {"primary": {"base_url": "http://p/v1"}, "fallback": {"base_url": ""}}}
    )
    eps = cfg.tts.endpoints()
    assert len(eps) == 1 and eps[0].base_url == "http://p/v1"
    # both configured → both in order
    cfg2 = VoiceCfg.model_validate(
        {"stt": {"primary": {"base_url": "http://p/v1"}, "fallback": {"base_url": "http://f/v1"}}}
    )
    assert [e.base_url for e in cfg2.stt.endpoints()] == ["http://p/v1", "http://f/v1"]


def test_voice_secret_roundtrip() -> None:
    """The nested `voice.*.primary.api_key` masks on read and survives a masked echo on write."""
    s = Settings.model_validate(
        {"voice": {"tts": {"primary": {"base_url": "http://v/v1", "api_key": "supersecret", "model": "m"}}}}
    )
    masked = mask_secrets(s.model_dump(mode="json"))
    assert masked["voice"]["tts"]["primary"]["api_key"] == _mask("supersecret")
    # Echo the masked value back → unmask restores the real secret, doesn't clobber it.
    incoming = {"voice": {"tts": {"primary": {"api_key": _mask("supersecret")}}}}
    restored = unmask_secrets(incoming, s.model_dump(mode="json"))
    assert restored["voice"]["tts"]["primary"]["api_key"] == "supersecret"
    with tempfile.TemporaryDirectory() as d:
        p = Path(d) / "config.yaml"
        save_settings(s, p)
        reloaded = load_settings(p)
        assert reloaded.voice.tts.primary.api_key == "supersecret"


# --- VoiceClient with a stubbed SDK client ----------------------------------------------------

class _FakeBinary:
    def __init__(self, data: bytes) -> None:
        self._data = data

    async def aread(self) -> bytes:
        return self._data


def _fake_client(*, on_transcribe=None, on_speech=None):
    async def t_create(*, model, file, **kw):
        if isinstance(on_transcribe, Exception):
            raise on_transcribe
        return SimpleNamespace(text=on_transcribe(model, file))

    async def s_create(*, model, voice, input, response_format, **kw):
        if isinstance(on_speech, Exception):
            raise on_speech
        return _FakeBinary(on_speech(model, voice, input, response_format))

    return SimpleNamespace(
        audio=SimpleNamespace(
            transcriptions=SimpleNamespace(create=t_create),
            speech=SimpleNamespace(create=s_create),
        )
    )


def _voice_client(cfg: dict, *, by_url) -> VoiceClient:
    """A VoiceClient whose per-endpoint `_client` is stubbed: `by_url[base_url]` → fake client."""
    vc = VoiceClient(VoiceCfg.model_validate(cfg))
    vc._client = lambda ep, svc: by_url[ep.base_url]  # type: ignore[assignment]
    return vc


def test_transcribe_failover_any_error() -> None:
    async def go():
        vc = _voice_client(
            {"stt": {"primary": {"base_url": "http://p/v1", "model": "w"},
                     "fallback": {"base_url": "http://f/v1", "model": "w"}}},
            by_url={
                "http://p/v1": _fake_client(on_transcribe=ValueError("400 bad request")),  # 4xx too
                "http://f/v1": _fake_client(on_transcribe=lambda m, f: "hello world"),
            },
        )
        text, served = await vc.transcribe(content=b"x", filename="a.webm", content_type="audio/webm")
        assert text == "hello world"
        assert served.served == "fallback" and served.degraded is True

    _run(go())


def test_synthesize_returns_bytes_and_media_type() -> None:
    async def go():
        vc = _voice_client(
            {"tts": {"format": "mp3", "primary": {"base_url": "http://p/v1", "model": "t", "voice": "x"}}},
            by_url={"http://p/v1": _fake_client(on_speech=lambda *a: b"ID3AUDIO")},
        )
        audio, media_type, served = await vc.synthesize(text="hi")
        assert audio == b"ID3AUDIO"
        assert media_type == "audio/mpeg"
        assert served.served == "primary" and served.degraded is False

    _run(go())


def test_stt_passes_language_and_extras() -> None:
    """STT sends `language` natively and `vad_filter`/`hotwords`/`extra_body` via the SDK escape
    hatch; a user `extra_body` merges on top."""
    async def go():
        captured: dict = {}

        async def t_create(*, model, file, **kw):
            captured.update(kw)
            return SimpleNamespace(text="ok")

        fake = SimpleNamespace(audio=SimpleNamespace(transcriptions=SimpleNamespace(create=t_create)))
        vc = _voice_client(
            {"stt": {"language": "sv", "vad_filter": True, "hotwords": "vault minig",
                     "extra_body": {"temperature": 0.2},
                     "primary": {"base_url": "http://p/v1", "model": "w"}}},
            by_url={"http://p/v1": fake},
        )
        await vc.transcribe(content=b"x", filename="a.webm", content_type="audio/webm")
        assert captured["language"] == "sv"
        assert captured["extra_body"] == {"vad_filter": True, "hotwords": "vault minig", "temperature": 0.2}

    _run(go())


def test_stt_blank_language_omitted() -> None:
    """Blank language → omit the param (server auto-detects)."""
    async def go():
        captured: dict = {}

        async def t_create(*, model, file, **kw):
            captured.update(kw)
            return SimpleNamespace(text="ok")

        fake = SimpleNamespace(audio=SimpleNamespace(transcriptions=SimpleNamespace(create=t_create)))
        vc = _voice_client(
            {"stt": {"language": "", "primary": {"base_url": "http://p/v1", "model": "w"}}},
            by_url={"http://p/v1": fake},
        )
        await vc.transcribe(content=b"x", filename="a.webm", content_type=None)
        assert "language" not in captured
        assert captured["extra_body"]["vad_filter"] is True  # default on

    _run(go())


def test_unconfigured_raises() -> None:
    async def go():
        vc = VoiceClient(VoiceCfg.model_validate({"enabled": False}))
        assert vc.status() == {"stt": False, "tts": False}
        for coro in (
            vc.transcribe(content=b"x", filename="a.webm", content_type=None),
            vc.synthesize(text="hi"),
        ):
            try:
                await coro
                raise AssertionError("expected VoiceError")
            except VoiceError:
                pass

    _run(go())


# --- API endpoints ----------------------------------------------------------------------------

class _StubVoice:
    """Mimics the VoiceClient surface the router uses, no SDK/network."""

    def __init__(self, *, stt=True, tts=True, served="primary") -> None:
        self._stt, self._tts, self._served = stt, tts, served

    def configured(self, service: str) -> bool:
        return self._stt if service == "stt" else self._tts

    def status(self) -> dict:
        return {"stt": self._stt, "tts": self._tts}

    async def transcribe(self, *, content, filename, content_type):
        return "transcribed text", SimpleNamespace(served=self._served, degraded=self._served != "primary")

    async def synthesize(self, *, text, voice=None):
        return b"AUDIOBYTES", "audio/mpeg", SimpleNamespace(served=self._served, degraded=False)


def _app(stub: _StubVoice) -> TestClient:
    from app.api import voice as voice_api

    app = FastAPI()
    app.state.voice = stub
    app.include_router(voice_api.router, prefix="/api")
    return TestClient(app)


def test_api_status_and_stt() -> None:
    c = _app(_StubVoice(served="fallback"))
    assert c.get("/api/voice/status").json() == {"stt": True, "tts": True}
    r = c.post("/api/voice/stt", files={"file": ("clip.webm", b"abc", "audio/webm")})
    assert r.status_code == 200
    assert r.json() == {"text": "transcribed text"}
    assert r.headers["X-Voice-Served-By"] == "fallback"
    # empty upload → 422
    assert c.post("/api/voice/stt", files={"file": ("clip.webm", b"", "audio/webm")}).status_code == 422


def test_api_stt_unconfigured_503() -> None:
    c = _app(_StubVoice(stt=False))
    r = c.post("/api/voice/stt", files={"file": ("clip.webm", b"abc", "audio/webm")})
    assert r.status_code == 503


def test_api_tts() -> None:
    c = _app(_StubVoice())
    r = c.post("/api/voice/tts", json={"text": "hello"})
    assert r.status_code == 200
    assert r.content == b"AUDIOBYTES"
    assert r.headers["content-type"] == "audio/mpeg"
    assert r.headers["X-Voice-Served-By"] == "primary"
    assert r.headers["Content-Length"] == str(len(b"AUDIOBYTES"))
    # empty text → 422
    assert c.post("/api/voice/tts", json={"text": "   "}).status_code == 422
    # unconfigured → 503
    assert _app(_StubVoice(tts=False)).post("/api/voice/tts", json={"text": "hi"}).status_code == 503


if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    os.environ.setdefault("CTRLB_CONFIG", str(Path(tempfile.gettempdir()) / "ctrlb_voice_test.yaml"))
    passed = 0
    for fn in fns:
        fn()
        passed += 1
        print(f"  ok  {fn.__name__}")
    print(f"\n{passed}/{len(fns)} voice 6a tests passed")
