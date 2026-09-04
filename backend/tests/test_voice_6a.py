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
- API: `/voice/status` (composes `stt_auto_send` + the R51 Tier-0 `stt_auto_stop` policy from live
  settings), `/voice/stt`, `/voice/tts`.
- R51 Tier 0 auto-stop dictation: the config defaults (OFF) + the both-ways bounds on its two tunables.
- D63 chunked TTS: the `chunk_*` load-time bounds, the `tts_chunking` client policy on `/voice/status`,
  the request-level `format` override + its closed allowlist, the `prefer`/`X-Voice-Target` pin
  (reorder, silent miss, still-fails-over), and the degraded-only `X-Voice-Degraded` marker.
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

    def __init__(self, *, stt=True, tts=True, served="speaches", degraded=False) -> None:
        self._stt, self._tts, self._served, self._degraded = stt, tts, served, degraded
        self.calls: list[dict] = []  # every synthesize() call, in order (D63 request-field assertions)

    def configured(self, service: str) -> bool:
        return self._stt if service == "stt" else self._tts

    def status(self) -> dict:
        return {"stt": self._stt, "tts": self._tts}

    async def transcribe(self, *, content, filename, content_type):
        return "transcribed text", SimpleNamespace(served=self._served, degraded=self._served != "speaches")

    async def synthesize(self, *, text, voice=None, audio_format=None, prefer=None):
        self.calls.append({"text": text, "voice": voice, "format": audio_format, "prefer": prefer})
        return (
            b"AUDIOBYTES",
            "audio/mpeg",
            SimpleNamespace(served=self._served, degraded=self._degraded, target=f"{self._served}/kokoro"),
        )


def _app(
    stub: _StubVoice, *, auto_send=False, stt_max_bytes=None, tts_max_chars=None, stt=None, tts=None
) -> TestClient:
    from app.api import voice as voice_api

    app = FastAPI()
    app.state.voice = stub
    stt_cfg: dict = {"auto_send": auto_send, **(stt or {})}
    if stt_max_bytes is not None:
        stt_cfg["max_upload_bytes"] = stt_max_bytes
    voice_cfg: dict = {"stt": stt_cfg}
    tts_cfg: dict = dict(tts or {})
    if tts_max_chars is not None:
        tts_cfg["max_text_chars"] = tts_max_chars
    if tts_cfg:
        voice_cfg["tts"] = tts_cfg
    app.state.settings = Settings.model_validate({"voice": voice_cfg})
    app.include_router(voice_api.router, prefix="/api")
    return TestClient(app)


def test_api_status_composes_auto_send_and_stt() -> None:
    c = _app(_StubVoice(served="vault-whisper"), auto_send=True)
    # the API composes stt_auto_send from live settings (the client's status() no longer carries it)
    body = c.get("/api/voice/status").json()
    assert (body["stt"], body["tts"], body["stt_auto_send"]) == (True, True, True)
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
    # D63 bounds the chunk cap by this cap, so a tiny per-request limit needs the chunk sizes under it.
    c = _app(_StubVoice(), tts_max_chars=5, tts={"chunk_min_chars": 5, "chunk_max_chars": 5})
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


# --- R51 Tier 0: the auto-stop dictation policy ---------------------------------------------------


def test_auto_stop_defaults_off_and_bounds_reject_wedging_values() -> None:
    """Ships OFF (push-to-talk untouched), and both tunables are bounded BOTH ways — a ~0 s window would
    end every clip before a word and an unbounded one would never end; a 0 threshold never fires and a
    huge one stops on speech. `inf`/NaN are rejected by the same bounds."""
    from pydantic import ValidationError

    from app.config import VoiceCfg

    stt = VoiceCfg.model_validate({}).stt
    assert (stt.auto_stop, stt.auto_stop_silence_s, stt.auto_stop_threshold) == (False, 3.0, 0.01)
    for bad in (
        {"stt": {"auto_stop_silence_s": 0.4}},
        {"stt": {"auto_stop_silence_s": 31}},
        {"stt": {"auto_stop_silence_s": float("inf")}},
        {"stt": {"auto_stop_threshold": 0}},
        {"stt": {"auto_stop_threshold": 0.6}},
        {"stt": {"auto_stop_threshold": float("nan")}},
    ):
        try:
            VoiceCfg.model_validate(bad)
            raise AssertionError(f"expected ValidationError for {bad}")
        except ValidationError:
            pass


def test_api_status_carries_the_auto_stop_policy() -> None:
    """`stt_auto_stop` rides the always-on probe beside `stt_auto_send` — shape only (a toggle + two
    thresholds), no endpoint/key/model. The mic is the only thing that listens."""
    off = _app(_StubVoice()).get("/api/voice/status").json()
    assert off["stt_auto_stop"] == {"enabled": False, "silence_s": 3.0, "threshold": 0.01}
    c = _app(_StubVoice(), stt={"auto_stop": True, "auto_stop_silence_s": 2.0})
    assert c.get("/api/voice/status").json()["stt_auto_stop"] == {
        "enabled": True,
        "silence_s": 2.0,
        "threshold": 0.01,
    }


# --- D63 chunked TTS: config bounds, the client policy, the pin, the format override --------------


def test_chunk_config_bounds_validate_at_load() -> None:
    """The two orderings the chunker needs to make progress are load-time errors (a bad Conf save 422s
    instead of silently muting TTS), and `chunk_lookahead` is bounded 1..4."""
    from pydantic import ValidationError

    from app.config import VoiceCfg

    ok = VoiceCfg.model_validate({"tts": {"chunk_min_chars": 400, "chunk_max_chars": 400}}).tts
    # shipped defaults — read-along stays OFF until it has had its device round (C3 S2)
    assert (ok.chunking, ok.chunk_format, ok.chunk_lookahead, ok.chunk_read_along) == (
        "sentence",
        "opus",
        1,
        False,
    )
    for bad in (
        {"tts": {"chunk_min_chars": 401, "chunk_max_chars": 400}},  # floor above the cap
        {"tts": {"chunk_max_chars": 5000}},  # cap above the per-message limit (4096)
        {"tts": {"chunk_lookahead": 0}},
        {"tts": {"chunk_lookahead": 5}},
        {"tts": {"chunking": "words"}},
        {"tts": {"chunk_min_words": 0}},
    ):
        try:
            VoiceCfg.model_validate(bad)
            raise AssertionError(f"expected ValidationError for {bad}")
        except ValidationError:
            pass


def test_api_status_carries_the_chunk_policy() -> None:
    """`tts_chunking` rides the always-on probe (D63 HIGH-2) — shape only, no endpoint/key/model."""
    c = _app(
        _StubVoice(),
        tts={
            "chunking": "paragraph",
            "chunk_max_chars": 300,
            "chunk_lookahead": 2,
            "chunk_read_along": True,
        },
    )
    policy = c.get("/api/voice/status").json()["tts_chunking"]
    assert policy == {
        "mode": "paragraph",
        "min_words": 4,
        "min_chars": 50,
        "max_chars": 300,
        "lookahead": 2,
        "max_text_chars": 4096,
        "format": "opus",
        "read_along": True,
    }


def test_api_tts_passes_format_and_prefer_and_returns_target() -> None:
    stub = _StubVoice(served="emma")
    c = _app(stub)
    r = c.post("/api/voice/tts", json={"text": "hi", "format": "opus", "prefer": "emma/kokoro"})
    assert r.status_code == 200
    assert stub.calls[-1] == {"text": "hi", "voice": None, "format": "opus", "prefer": "emma/kokoro"}
    assert r.headers["X-Voice-Served-By"] == "emma"  # display name, byte-identical to pre-D63
    assert r.headers["X-Voice-Target"] == "emma/kokoro"  # the machine-readable pin
    # the container allowlist is CLOSED — an arbitrary string never reaches a provider
    assert c.post("/api/voice/tts", json={"text": "hi", "format": "ogg"}).status_code == 422
    # omitted → no override at all (the adapter falls through to model > service)
    c.post("/api/voice/tts", json={"text": "hi"})
    assert stub.calls[-1]["format"] is None and stub.calls[-1]["prefer"] is None


def test_api_tts_degraded_header_only_when_degraded() -> None:
    """The serve flash is exception-only (D63 amendment): the wire says `degraded` ONLY when a hop
    failed before the serving one answered, so the happy path carries no header at all."""
    happy = _app(_StubVoice(served="emma")).post("/api/voice/tts", json={"text": "hi"})
    assert happy.status_code == 200
    assert "X-Voice-Degraded" not in happy.headers
    fell_over = _app(_StubVoice(served="vault", degraded=True)).post("/api/voice/tts", json={"text": "hi"})
    assert fell_over.headers["X-Voice-Degraded"] == "1"
    assert fell_over.headers["X-Voice-Target"] == "vault/kokoro"  # the pin still rides along


def test_synthesize_format_precedence_request_over_model_over_service() -> None:
    """D63/MED-4: a model-level `format: mp3` must not silently defeat the chunk format."""

    async def go():
        seen: dict = {}

        def on_speech(model, voice, text, fmt, kw):
            seen["fmt"] = fmt
            return b"AUD"

        vc = _vc(
            tts=[target("emma", "http://p/v1", "kokoro", fmt="mp3")],
            tts_policy=TtsPolicy(format="flac"),
            by_url={"http://p/v1": _fake_client(on_speech=on_speech)},
        )
        _, media_type, _ = await vc.synthesize(text="hi")
        assert (seen["fmt"], media_type) == ("mp3", "audio/mpeg")  # model over service
        _, media_type, _ = await vc.synthesize(text="hi", audio_format="opus")
        assert (seen["fmt"], media_type) == ("opus", "audio/ogg")  # request over model
        # no model format → service
        vc2 = _vc(
            tts=[target("emma", "http://p/v1", "kokoro")],
            tts_policy=TtsPolicy(format="flac"),
            by_url={"http://p/v1": _fake_client(on_speech=on_speech)},
        )
        await vc2.synthesize(text="hi")
        assert seen["fmt"] == "flac"

    _run(go())


def test_synthesize_prefer_reorders_the_chain_and_misses_silently() -> None:
    """The pin tries that TARGET first (provider alone is ambiguous — one provider, two models); an
    unknown/vanished pin falls back to the configured order rather than erroring."""

    async def go():
        served: list[str] = []

        def on_speech(model, voice, text, fmt, kw):
            served.append(model)
            return b"AUD"

        chain = [
            target("emma", "http://p/v1", "kokoro"),
            target("emma", "http://p/v1", "piper"),  # same provider, second model
            target("vault", "http://f/v1", "alltalk"),
        ]
        clients = {
            "http://p/v1": _fake_client(on_speech=on_speech),
            "http://f/v1": _fake_client(on_speech=on_speech),
        }
        vc = _vc(tts=chain, by_url=clients)

        _, _, reply = await vc.synthesize(text="hi")
        assert served[-1] == "kokoro" and reply.target == "emma/kokoro" and reply.degraded is False
        _, _, reply = await vc.synthesize(text="hi", prefer="emma/piper")
        assert served[-1] == "piper" and reply.target == "emma/piper"
        assert reply.served == "emma" and reply.degraded is False  # pinned = position 0, NOT a fallback
        _, _, reply = await vc.synthesize(text="hi", prefer="vault/alltalk")
        assert served[-1] == "alltalk" and reply.served == "vault"
        # a vanished pin: silent miss → the normal chain, primary serves
        _, _, reply = await vc.synthesize(text="hi", prefer="ghost/model")
        assert served[-1] == "kokoro" and reply.target == "emma/kokoro"

    _run(go())


def test_synthesize_prefer_still_fails_over_when_the_pin_dies() -> None:
    """A pinned target that has gone down doesn't strand the reply — the rest of the chain still walks."""

    async def go():
        vc = _vc(
            tts=[
                target("emma", "http://p/v1", "kokoro"),
                target("vault", "http://f/v1", "alltalk"),
            ],
            by_url={
                "http://p/v1": _fake_client(on_speech=RuntimeError("down")),
                "http://f/v1": _fake_client(on_speech=lambda *a: b"AUD"),
            },
        )
        _, _, reply = await vc.synthesize(text="hi", prefer="emma/kokoro")
        assert reply.served == "vault" and reply.target == "vault/alltalk" and reply.degraded is True

    _run(go())


if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    os.environ.setdefault("CTRLB_CONFIG", str(Path(tempfile.gettempdir()) / "ctrlb_voice_test.yaml"))
    passed = 0
    for fn in fns:
        fn()
        passed += 1
        print(f"  ok  {fn.__name__}")
    print(f"\n{passed}/{len(fns)} voice 6a tests passed")
