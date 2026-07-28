"""Phase 6a-1 (A11/D48 Slice 2 re-key) — voice STT/TTS proxy over resolved target chains + failover.

Run plainly: `python tests/test_voice_6a.py` from `backend/` (plain asserts + a __main__ runner), or
under pytest. No network: the SDK client is stubbed per target so we can drive failover deterministically.

Covers:
- `core.failover`: primary served, primary-down → next hop + metadata, all-fail → `FailoverError`,
  empty chain → `FailoverError`.
- `VoiceClient` on the A11 chains: failover order + served=PROVIDER NAME; the winning-hop format sets the
  media type (primary mp3-model vs fallback wav-model); voice precedence request>model>"alloy"; speed sent
  iff the model set it; language model>service; STT extras (vad_filter/hotwords/service extra_body);
  configured/enabled; drain closes SDK clients.
- config/secret: a voice-referenced provider's `api_key` masks on read + blank-keeps on PUT (the standard
  `providers.*.api_key` path — the legacy `voice.*.primary.api_key` leaf is gone).
- API: `/voice/status` (composes `stt_auto_send` from live settings), `/voice/stt`, `/voice/tts`.
"""

from __future__ import annotations

import asyncio
import os
import tempfile
from pathlib import Path
from types import SimpleNamespace

from _reg import target
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.adapters.voice import VoiceClient, VoiceError
from app.config import (
    Settings,
    _mask,
    load_settings,
    mask_secrets,
    save_settings_comment_stripping_for_tests,
    unmask_secrets,
)
from app.core.failover import FailoverError, failover_collect
from app.domain.provider import SttPolicy, TtsPolicy


def _run(coro):
    return asyncio.run(coro)


# --- core.failover ----------------------------------------------------------------------------


def test_failover_primary_served() -> None:
    async def go():
        async def attempt(ep):
            return f"ok:{ep}"

        res = await failover_collect(["a", "b"], attempt)
        assert res.value == "ok:a"
        assert res.served_index == 0
        assert res.degraded is False

    _run(go())


def test_failover_falls_through_on_any_error() -> None:
    async def go():
        async def attempt(ep):
            if ep == "a":
                raise RuntimeError("boom")  # any error → next (Q2)
            return f"ok:{ep}"

        res = await failover_collect(["a", "b"], attempt, label=str)
        assert res.value == "ok:b"
        assert res.served_index == 1
        assert res.degraded is True

    _run(go())


def test_failover_all_fail_raises() -> None:
    async def go():
        async def attempt(ep):
            raise ValueError(f"down:{ep}")

        try:
            await failover_collect(["a", "b"], attempt)
            raise AssertionError("expected FailoverError")
        except FailoverError as exc:
            assert len(exc.failures) == 2

    _run(go())


def test_failover_empty_chain_raises() -> None:
    async def go():
        async def attempt(ep):  # pragma: no cover - never called
            return ep

        try:
            await failover_collect([], attempt)
            raise AssertionError("expected FailoverError on empty chain")
        except FailoverError as exc:
            assert exc.failures == []

    _run(go())


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
        return SimpleNamespace(text=on_transcribe(model, file, kw))

    async def s_create(*, model, voice, input, response_format, **kw):
        if isinstance(on_speech, Exception):
            raise on_speech
        return _FakeBinary(on_speech(model, voice, input, response_format, kw))

    return SimpleNamespace(
        audio=SimpleNamespace(
            transcriptions=SimpleNamespace(create=t_create),
            speech=SimpleNamespace(create=s_create),
        )
    )


def _vc(stt=(), tts=(), *, stt_policy=None, tts_policy=None, by_url=None, enabled=True) -> VoiceClient:
    vc = VoiceClient(
        tuple(stt), stt_policy or SttPolicy(), tuple(tts), tts_policy or TtsPolicy(), enabled=enabled
    )
    if by_url is not None:
        vc._client = lambda t, ct, tt: by_url[t.base_url]  # type: ignore[assignment]
    return vc


def test_transcribe_failover_served_is_provider_name() -> None:
    async def go():
        vc = _vc(
            stt=[target("speaches", "http://p/v1", "w"), target("vault-whisper", "http://f/v1", "w")],
            by_url={
                "http://p/v1": _fake_client(on_transcribe=ValueError("400 bad request")),  # 4xx too
                "http://f/v1": _fake_client(on_transcribe=lambda m, f, kw: "hello world"),
            },
        )
        text, served = await vc.transcribe(content=b"x", filename="a.webm", content_type="audio/webm")
        assert text == "hello world"
        assert served.served == "vault-whisper" and served.degraded is True  # provider name, not "fallback"

    _run(go())


def test_synthesize_winning_hop_format_sets_media_type() -> None:
    """The response media type maps the WINNING hop's effective format (model > service), never
    precomputed: a primary mp3-model that fails falls over to a wav-model → audio/wav."""

    async def go():
        vc = _vc(
            tts=[
                target("emma", "http://p/v1", "kokoro", fmt="mp3"),
                target("vault", "http://f/v1", "alltalk", fmt="wav"),
            ],
            by_url={
                "http://p/v1": _fake_client(on_speech=RuntimeError("down")),
                "http://f/v1": _fake_client(on_speech=lambda *a: b"RIFFWAVE"),
            },
        )
        audio, media_type, served = await vc.synthesize(text="hi")
        assert audio == b"RIFFWAVE"
        assert media_type == "audio/wav"  # winning hop (fallback) format, not the primary's mp3
        assert served.served == "vault" and served.degraded is True

    _run(go())


def test_synthesize_voice_precedence_and_speed() -> None:
    """voice = request > model voice > "alloy"; speed sent iff the model set it."""

    async def go():
        captured: dict = {}

        def on_speech(model, voice, text, fmt, kw):
            captured.update({"voice": voice, "speed": kw.get("speed", "UNSET")})
            return b"AUD"

        # model voice set, no request voice, model speed set → voice=model, speed passed
        vc = _vc(
            tts=[target("emma", "http://p/v1", "kokoro", voice="bf_isabella", speed=1.25)],
            by_url={"http://p/v1": _fake_client(on_speech=on_speech)},
        )
        await vc.synthesize(text="hi")
        assert captured == {"voice": "bf_isabella", "speed": 1.25}
        # request voice overrides the model voice
        captured.clear()
        await vc.synthesize(text="hi", voice="nova")
        assert captured["voice"] == "nova"
        # no model voice + no request → protocol fallback "alloy"; no model speed → omitted
        captured.clear()
        vc2 = _vc(
            tts=[target("emma", "http://p/v1", "kokoro")],
            by_url={"http://p/v1": _fake_client(on_speech=on_speech)},
        )
        await vc2.synthesize(text="hi")
        assert captured == {"voice": "alloy", "speed": "UNSET"}

    _run(go())


def test_stt_language_model_over_service_and_extras() -> None:
    """language = target model > service policy (C8), omitted when blank; vad_filter/hotwords/service
    extra_body ride the SDK escape hatch; a service extra_body merges."""

    async def go():
        captured: dict = {}

        def on_t(model, file, kw):
            captured.update(kw)
            captured["model"] = model
            return "ok"

        # model language "sv" wins over service "en"
        vc = _vc(
            stt=[target("speaches", "http://p/v1", "parakeet", language="sv")],
            stt_policy=SttPolicy(
                language="en", vad_filter=True, hotwords="vault minig", extra_body={"temperature": 0.2}
            ),
            by_url={"http://p/v1": _fake_client(on_transcribe=on_t)},
        )
        await vc.transcribe(content=b"x", filename="a.webm", content_type="audio/webm")
        assert captured["language"] == "sv"
        assert captured["model"] == "parakeet"
        assert captured["extra_body"] == {"vad_filter": True, "hotwords": "vault minig", "temperature": 0.2}
        # blank both → language omitted (server auto-detects)
        captured.clear()
        vc2 = _vc(
            stt=[target("speaches", "http://p/v1", "parakeet", language=None)],
            stt_policy=SttPolicy(language=""),
            by_url={"http://p/v1": _fake_client(on_transcribe=on_t)},
        )
        await vc2.transcribe(content=b"x", filename="a.webm", content_type=None)
        assert "language" not in captured
        assert captured["extra_body"]["vad_filter"] is True  # default on

    _run(go())


def test_configured_and_status_and_unconfigured() -> None:
    async def go():
        # empty chains → both unconfigured; enabled=False → both off regardless of chain
        assert _vc().status() == {"stt": False, "tts": False}
        disabled = _vc(stt=[target("s", "http://p/v1", "w")], enabled=False)
        assert disabled.configured("stt") is False
        live = _vc(stt=[target("s", "http://p/v1", "w")], tts=[target("t", "http://q/v1", "k")])
        assert live.status() == {"stt": True, "tts": True}  # no stt_auto_send — composed at the API layer
        for coro in (
            _vc().transcribe(content=b"x", filename="a", content_type=None),
            _vc().synthesize(text="hi"),
        ):
            try:
                await coro
                raise AssertionError("expected VoiceError")
            except VoiceError:
                pass

    _run(go())


def test_drain_closes_sdk_clients() -> None:
    """retire() closes the cached SDK clients (R5 drain — no per-swap aclose)."""

    async def go():
        vc = _vc(stt=[target("s", "http://p/v1", "w")])
        closed = {"n": 0}

        class _FakeSDK:
            async def close(self):
                closed["n"] += 1

        vc._clients[("s", 3.0, 30.0)] = _FakeSDK()  # type: ignore[assignment]
        await vc.retire()  # idle → immediate close
        assert closed["n"] == 1

    _run(go())


# --- config: a voice-referenced provider's secret round-trips via providers.api_key -----------


def test_voice_provider_secret_roundtrip() -> None:
    """The legacy `voice.*.primary.api_key` leaf is gone; a voice endpoint's key now lives on its
    provider (`providers.<name>.api_key`) and rides the standard mask/unmask machinery."""
    s = Settings.model_validate(
        {
            "providers": {
                "vault-tts": {"base_url": "http://v/v1", "api_key": "supersecret", "models": {"tts-1": {}}}
            },
            "voice": {"tts": {"provider": "vault-tts", "model": "tts-1"}},
        }
    )
    masked = mask_secrets(s.model_dump(mode="json"))
    assert masked["providers"]["vault-tts"]["api_key"] == _mask("supersecret")
    # echo the masked value back → unmask restores the real secret (blank-keep)
    incoming = {"providers": {"vault-tts": {"api_key": _mask("supersecret")}}}
    restored = unmask_secrets(incoming, s.model_dump(mode="json"))
    assert restored["providers"]["vault-tts"]["api_key"] == "supersecret"
    with tempfile.TemporaryDirectory() as d:
        p = Path(d) / "config.yaml"
        save_settings_comment_stripping_for_tests(s, p)
        reloaded = load_settings(p)
        assert reloaded.providers["vault-tts"].api_key == "supersecret"


def test_timeout_floor_rejects_zero() -> None:
    """A blanked Conf timeout (→ 0) must 422, not silently wedge voice with instant-fail calls."""
    from pydantic import ValidationError

    from app.config import VoiceCfg

    for bad in ({"stt": {"timeout_s": 0}}, {"tts": {"connect_timeout_s": 0}}):
        try:
            VoiceCfg.model_validate(bad)
            raise AssertionError(f"expected ValidationError for {bad}")
        except ValidationError:
            pass


# --- API endpoints ----------------------------------------------------------------------------


class _StubVoice:
    """Mimics the VoiceClient surface the router uses, no SDK/network."""

    def __init__(self, *, stt=True, tts=True, served="speaches") -> None:
        self._stt, self._tts, self._served = stt, tts, served

    def configured(self, service: str) -> bool:
        return self._stt if service == "stt" else self._tts

    def status(self) -> dict:
        return {"stt": self._stt, "tts": self._tts}

    async def transcribe(self, *, content, filename, content_type):
        return "transcribed text", SimpleNamespace(served=self._served, degraded=self._served != "speaches")

    async def synthesize(self, *, text, voice=None):
        return b"AUDIOBYTES", "audio/mpeg", SimpleNamespace(served=self._served, degraded=False)


def _app(stub: _StubVoice, *, auto_send=False, stt_max_bytes=None, tts_max_chars=None) -> TestClient:
    from app.api import voice as voice_api

    app = FastAPI()
    app.state.voice = stub
    stt_cfg: dict = {"auto_send": auto_send}
    if stt_max_bytes is not None:
        stt_cfg["max_upload_bytes"] = stt_max_bytes
    voice_cfg: dict = {"stt": stt_cfg}
    if tts_max_chars is not None:
        voice_cfg["tts"] = {"max_text_chars": tts_max_chars}
    app.state.settings = Settings.model_validate({"voice": voice_cfg})
    app.include_router(voice_api.router, prefix="/api")
    return TestClient(app)


def test_api_status_composes_auto_send_and_stt() -> None:
    c = _app(_StubVoice(served="vault-whisper"), auto_send=True)
    # the API composes stt_auto_send from live settings (the client's status() no longer carries it)
    assert c.get("/api/voice/status").json() == {"stt": True, "tts": True, "stt_auto_send": True}
    r = c.post("/api/voice/stt", files={"file": ("clip.webm", b"abc", "audio/webm")})
    assert r.status_code == 200
    assert r.json() == {"text": "transcribed text"}
    assert r.headers["X-Voice-Served-By"] == "vault-whisper"  # provider name
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
    assert r.headers["X-Voice-Served-By"] == "speaches"
    assert r.headers["Content-Length"] == str(len(b"AUDIOBYTES"))
    assert c.post("/api/voice/tts", json={"text": "   "}).status_code == 422
    assert _app(_StubVoice(tts=False)).post("/api/voice/tts", json={"text": "hi"}).status_code == 503


def test_api_stt_rejects_oversized_upload() -> None:
    # SYS-17b: an upload over the configured byte cap is rejected (413); at the cap it still serves.
    c = _app(_StubVoice(), stt_max_bytes=8)
    at_cap = c.post("/api/voice/stt", files={"file": ("clip.webm", b"12345678", "audio/webm")})
    assert at_cap.status_code == 200  # exactly at the cap → allowed
    over = c.post("/api/voice/stt", files={"file": ("clip.webm", b"123456789", "audio/webm")})
    assert over.status_code == 413


def test_api_tts_rejects_overlong_text() -> None:
    # SYS-17a: text over the configured char cap is rejected (422); at the cap it still synthesizes.
    c = _app(_StubVoice(), tts_max_chars=5)
    assert c.post("/api/voice/tts", json={"text": "hello"}).status_code == 200  # exactly at the cap
    over = c.post("/api/voice/tts", json={"text": "hello!"})
    assert over.status_code == 422


def test_voice_caps_reject_zero_and_inf() -> None:
    # No hardcoding + no silent disable: the caps floor >0 and reject inf/NaN (int type), like the
    # D48 timeout fields.
    from pydantic import ValidationError

    from app.config import VoiceCfg

    for bad in (
        {"stt": {"max_upload_bytes": 0}},
        {"tts": {"max_text_chars": 0}},
        {"tts": {"max_text_chars": float("inf")}},
    ):
        try:
            VoiceCfg.model_validate(bad)
            raise AssertionError(f"expected ValidationError for {bad}")
        except ValidationError:
            pass


if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    os.environ.setdefault("CTRLB_CONFIG", str(Path(tempfile.gettempdir()) / "ctrlb_voice_test.yaml"))
    passed = 0
    for fn in fns:
        fn()
        passed += 1
        print(f"  ok  {fn.__name__}")
    print(f"\n{passed}/{len(fns)} voice 6a tests passed")
