"""Phase 26 S9 — the clip door on parakeet (ASR_PLAN §3.6, §3.7, §5 T9/T10, §6.3; session-64 S9 rulings).

The arms, by what they defend:

* **`door=`** (H3) — `transcribe(door="live")` walks the `voice.live` chain under `LivePolicy`'s own
  timeouts and sends `language` alone; the default door is today's; an unknown door is refused.
* **the gate walk** (council 9) — a capped engine (`max_concurrent_requests: 1`) busy with a long clip
  makes the next request WALK to the fallback after `connect_timeout_s`, on either door, instead of parking
  on the engine's lock; through the route too (`X-Voice-Served-By`, `X-Voice-Degraded`, T9).
* **the door** — decode → pass → per-chunk WAV ASR: the REAL request a fake parakeet-server receives
  (T-5); no speech ⇒ `""`, NO ASR call, no header (H5); > 30 s splits in order and joins; the three
  status codes (H4); every CPU step off the event loop.
* **the trail + capture** (H6/H7) — under `voice.live.debug` a server-minted `clip` trail (or the named
  dictation's) carries `prepass` / `capture_open` / `asr` lines with no transcript text, and the decoded
  16 kHz PCM is captured so `asr_corpus.py promote <id>-<leg>` takes it; nothing without debug.
* **one helper** — the clip door and `vad_replay.py --asr` transcribe through the same
  `voice_clip.transcribe_wavs`; `promote --file` (H13).
* **the status-bit degrade** (S6-i H1) — without the `voice` extra STT reports unconfigured.
"""

from __future__ import annotations

import asyncio
import importlib.util
import json
import logging
import os
import subprocess
import sys
import wave
from pathlib import Path
from types import ModuleType, SimpleNamespace
from typing import Any

import numpy as np
import pytest
from _audio import FIXTURE, FakeEngine, encode, fixture_samples, wav_info
from _reg import target
from fastapi import FastAPI
from fastapi.testclient import TestClient
from test_voice_prepass_s6i import _script, _ScriptedModel

from app.adapters.voice import VoiceClient, VoiceError
from app.api.csrf import CSRF_HEADER, CSRF_HEADER_VALUE
from app.config import Settings
from app.core.provider_registry import EndpointGates, resolve_lenient
from app.domain.provider import LivePolicy, SttPolicy, TtsPolicy
from app.runtime import build_voice_client
from app.services import voice_clip
from app.services.call_trail import CallTrail
from app.services.voice_audio import MODEL_RATE, voice_extra_installed
from app.services.voice_prepass import DecodeAborted, decode_to_pcm16k, prepass

BACKEND = Path(__file__).resolve().parents[1]
TOOLS = BACKEND.parent / "tools"
CALL = "0f8e2c4a-1b2c-4d3e-8f90-a1b2c3d4e5f6"
MODEL = "parakeet-tdt-0.6b-v3"


def _tool(name: str) -> ModuleType:
    spec = importlib.util.spec_from_file_location(f"_tool_s9_{name}", TOOLS / f"{name}.py")
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def _sdk(on_transcribe: Any) -> SimpleNamespace:
    """A stub SDK client: `on_transcribe(model, file, kwargs)` answers (sync or async), or raises."""

    async def create(*, model: str, file: Any, **kw: Any) -> Any:
        out = on_transcribe(model, file, kw)
        if asyncio.iscoroutine(out):
            out = await out
        return SimpleNamespace(text=out)

    return SimpleNamespace(audio=SimpleNamespace(transcriptions=SimpleNamespace(create=create)))


# ═══════════════════════════════ door= (ruling H3) ═══════════════════════════════


def test_the_live_door_walks_the_live_chain_under_its_own_policy_with_no_extras() -> None:
    seen: list[tuple[str, float, float, dict[str, Any]]] = []

    def client(t: Any, connect: float, timeout: float) -> SimpleNamespace:
        return _sdk(lambda model, file, kw: seen.append((t.provider, connect, timeout, kw)) or t.provider)

    vc = VoiceClient(
        (target("clip", "http://clip/v1", MODEL),),
        SttPolicy(language="en", vad_filter=True, hotwords="vault minig", connect_timeout_s=3, timeout_s=30),
        (),
        TtsPolicy(),
        live=(target("ear", "http://ear/v1", MODEL),),
        live_policy=LivePolicy(language="es", connect_timeout_s=1.5, timeout_s=9),
    )
    vc._client = client  # type: ignore[assignment]

    async def go() -> None:
        text, reply = await vc.transcribe(
            content=b"RIFF", filename="chunk.wav", content_type="audio/wav", door="live"
        )
        assert (text, reply.served) == ("ear", "ear")
        default, _ = await vc.transcribe(content=b"RIFF", filename="chunk.wav", content_type="audio/wav")
        assert default == "clip"  # the default door is today's

    asyncio.run(go())
    (live, stt) = seen
    assert live == ("ear", 1.5, 9, {"language": "es"})  # LivePolicy's timeouts, language only — no extras
    assert stt[:3] == ("clip", 3, 30)
    assert stt[3]["extra_body"] == {"vad_filter": True, "hotwords": "vault minig"}
    assert stt[3]["language"] == "en"


def test_an_unknown_door_is_refused_and_an_unconfigured_one_is_a_voice_error() -> None:
    vc = VoiceClient((target("clip", "http://clip/v1"),), SttPolicy(), (), TtsPolicy())

    async def go() -> None:
        with pytest.raises(ValueError, match="door must be one of stt, live"):
            await vc.transcribe(content=b"x", filename="a", content_type=None, door="tts")  # type: ignore[arg-type]
        with pytest.raises(VoiceError, match="live ear is not configured"):
            await vc.transcribe(content=b"x", filename="a", content_type=None, door="live")

    asyncio.run(go())


@pytest.mark.parametrize("door", ["stt", "live"])
def test_a_busy_engine_walks_to_the_fallback_instead_of_parking(
    door: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Council 9: both engines declare `max_concurrent_requests: 1`. While a long clip holds
    `parakeet-clip`, the next request on the same door waits `connect_timeout_s` for the permit and then
    WALKS (visibly, `degraded`) — it never reaches the engine to park on its mutex. The timed-out waiter
    takes no permit; the long job finishes on the primary. Wrapped in `wait_for`: a regression would
    park, and the suite has no pytest-timeout."""
    release, started = asyncio.Event(), asyncio.Event()

    async def long_job(_req: Any) -> str:
        started.set()
        await release.wait()
        return "the long clip"

    engine = FakeEngine({"clip": long_job, "vault": lambda _r: "from the fallback"})
    engine.install(monkeypatch)
    busy = target("parakeet-clip", "http://clip:9011/v1", MODEL, max_concurrent_requests=1)
    spare = target("vault-speaches", "http://vault:9000/v1", "whisper")
    chain = (busy, spare)
    gates = EndpointGates()
    fast = {"connect_timeout_s": 0.05, "timeout_s": 5}
    if door == "stt":
        vc = VoiceClient(chain, SttPolicy(**fast), (), TtsPolicy(), gates)
    else:
        vc = VoiceClient((), SttPolicy(), (), TtsPolicy(), gates, live=chain, live_policy=LivePolicy(**fast))
    wav = encode("wav", "pcm_s16le", MODEL_RATE, 0.5)
    clip = {"content": wav, "filename": "chunk.wav", "content_type": "audio/wav", "door": door}

    async def go() -> None:
        first = asyncio.create_task(vc.transcribe(**clip))
        await asyncio.wait_for(started.wait(), timeout=5)  # the long clip is ON the engine
        text, reply = await asyncio.wait_for(vc.transcribe(**clip), timeout=5)
        assert (text, reply.served, reply.degraded) == ("from the fallback", "vault-speaches", True)
        assert reply.queue_ms >= 40  # the gate wait it paid on the busy hop (T9's queue_ms)
        assert [r.url.split("/")[2] for r in engine.requests] == ["clip:9011", "vault:9000"]
        assert gates.sem_for(busy.gate_identity, 1).locked()  # the long job still holds it — nothing leaked
        release.set()
        long_text, long_reply = await asyncio.wait_for(first, timeout=5)
        assert (long_text, long_reply.served, long_reply.degraded) == (
            "the long clip",
            "parakeet-clip",
            False,
        )
        assert not gates.sem_for(busy.gate_identity, 1).locked()

    asyncio.run(go())


def test_without_the_voice_extra_stt_reports_unconfigured() -> None:
    """The S6-i ruling H1 status-bit degrade, landed with its first consumer: the clip door decodes every
    upload, so a client built without the extra reports STT off (the mic hides) — TTS and the live ear
    are untouched."""
    chain = (target("clip", "http://clip/v1"),)
    vc = VoiceClient(
        chain, SttPolicy(), chain, TtsPolicy(), live=chain, live_policy=LivePolicy(), decode_ready=False
    )
    assert vc.status() == {"stt": False, "tts": True, "live": True}
    with pytest.raises(VoiceError):
        asyncio.run(vc.transcribe(content=b"x", filename="a", content_type=None))
    assert voice_extra_installed() is True  # the suite's own venv carries the extra (gate-mandatory)
    code = (
        "import sys\n"
        "for name in ('numpy', 'onnxruntime', 'av'):\n"
        "    sys.modules[name] = None\n"
        "from app.services.voice_audio import voice_extra_installed\n"
        "from app.config import Settings\n"
        "from app.core.provider_registry import resolve_lenient\n"
        "from app.runtime import build_voice_client\n"
        "assert voice_extra_installed() is False\n"
        "s = Settings.model_validate({'providers': {'e': {'base_url': 'http://e/v1', 'models': {'m': {}}}},\n"
        "                            'voice': {'stt': {'provider': 'e'}, 'tts': {'provider': 'e'}}})\n"
        "status = build_voice_client(resolve_lenient(s)[0], s, None).status()\n"
        "assert status['stt'] is False and status['tts'] is True, status\n"
    )
    done = subprocess.run(
        [sys.executable, "-c", code], cwd=BACKEND, capture_output=True, text=True, timeout=120
    )
    assert done.returncode == 0, done.stderr[-2000:]


# ═══════════════════════════════ the pass's T10 geometry ═══════════════════════════════


def test_the_pass_reports_its_crop_pad_and_chunk_bounds() -> None:
    hop, pad = 512, 6400
    n = 40 * hop
    inside = prepass(
        np.zeros(n, dtype=np.float32), _ScriptedModel(_script([(0.0, 10), (0.9, 10), (0.0, 20)]))
    )
    assert (inside.crop, inside.padded, inside.bounds) == ((0, 20 * hop + pad), False, ((0, 20 * hop + pad),))
    tail = prepass(np.zeros(n, dtype=np.float32), _ScriptedModel(_script([(0.0, 30), (0.9, 10)])))
    assert (
        tail.padded and tail.crop == (30 * hop - pad, n + pad) and tail.bounds == ((30 * hop - pad, n + pad),)
    )
    assert [len(c) for c in tail.chunks] == [e - s for s, e in tail.bounds]
    none = prepass(np.zeros(n, dtype=np.float32), _ScriptedModel(_script([(0.0, 40)])))
    assert (none.outcome, none.crop, none.padded, none.bounds) == ("no_speech", (0, 0), False, ())


# ═══════════════════════════════ the door, end to end ═══════════════════════════════


def _settings(
    *, debug: bool = False, stt: dict[str, Any] | None = None, live: dict[str, Any] | None = None
) -> Settings:
    return Settings.model_validate(
        {
            "providers": {
                "parakeet-clip": {
                    "base_url": "http://clip:9011/v1",
                    "max_concurrent_requests": 1,
                    "models": {MODEL: {}},
                },
                "vault-speaches": {"base_url": "http://vault:9000/v1", "models": {"whisper": {}}},
            },
            "voice": {
                "stt": {
                    "provider": "parakeet-clip",
                    "fallbacks": [{"provider": "vault-speaches"}],
                    "language": "en",
                    "hotwords": "vault minig",
                    **(stt or {}),
                },
                "live": {"debug": debug, **(live or {})},
            },
        }
    )


def _door(tmp_path: Path, settings: Settings, *, store: bool = True) -> tuple[TestClient, VoiceClient]:
    """The real router over the app's own client construction (`build_voice_client`) and a trail store."""
    from app.api import voice as voice_api

    app = FastAPI()
    app.state.settings = settings
    voice = build_voice_client(resolve_lenient(settings)[0], settings, EndpointGates())
    app.state.voice = voice
    if store:
        app.state.call_trail = CallTrail(tmp_path / "calls")
    app.include_router(voice_api.router, prefix="/api")
    return TestClient(app, headers={CSRF_HEADER: CSRF_HEADER_VALUE}), voice


def _post(client: TestClient, body: bytes, name: str = "dictation.webm", query: str = "") -> Any:
    return client.post(f"/api/voice/stt{query}", files={"file": (name, body, "audio/webm")})


def _speech_webm() -> bytes:
    """The conformance speech, re-encoded as the phone records it (webm/opus)."""
    return encode("webm", "libopus", MODEL_RATE, samples=fixture_samples())


def _lines(path: Path) -> list[dict[str, Any]]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines()]


def test_a_clip_reaches_the_engine_as_the_real_wav_request(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """T-5 on the wire: a webm upload is decoded, passed and posted as ONE 16 kHz mono pcm16 WAV chunk;
    the SDK's form carries the configured model id, `language` and the stt door's faster-whisper extras
    (parakeet-server reads `file` only and ignores the rest — the bake-off re-proves that live)."""
    engine = FakeEngine({"clip": lambda _r: "  hello there  "})
    engine.install(monkeypatch)
    client, _ = _door(tmp_path, _settings())
    r = _post(client, _speech_webm())
    assert r.status_code == 200 and r.json() == {"text": "hello there"}
    assert r.headers["X-Voice-Served-By"] == "parakeet-clip" and "X-Voice-Degraded" not in r.headers
    (req,) = engine.requests
    assert (req.filename, req.content_type) == ("chunk.wav", "audio/wav")
    channels, rate, width, frames = wav_info(req.body)
    assert (channels, rate, width) == (1, MODEL_RATE, 2) and 0 < frames <= 3 * MODEL_RATE + 6400
    assert req.fields["model"] == MODEL.encode() and req.fields["language"] == b"en"
    assert (req.fields["vad_filter"], req.fields["hotwords"]) == (b"true", b"vault minig")
    assert not (tmp_path / "calls").exists()  # debug off: no trail, no capture


def test_no_speech_answers_empty_with_no_asr_call_and_no_header(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    engine = FakeEngine({"clip": lambda _r: "hallucinated"})
    engine.install(monkeypatch)
    client, _ = _door(tmp_path, _settings())
    r = _post(client, encode("webm", "libopus", 48000, 2.0, amplitude=0.0))
    assert r.status_code == 200 and r.json() == {"text": ""}
    assert "X-Voice-Served-By" not in r.headers  # ruling H5: nothing served it
    assert engine.requests == []


class _HopModel:
    """A `VadModel` whose probabilities are a function of the hop index — any clip length (the S6-i
    scripted model needs the exact hop count)."""

    name = "hops"
    sample_rate = MODEL_RATE
    hop = 512
    delay_hops = 0
    default_act = 0.6
    prepass_act = 0.5
    sha256 = ""
    asset = ""

    def __init__(self, speech: list[tuple[int, int]]) -> None:
        self.speech = speech

    def open(self) -> Any:
        model = self

        class _Stream:
            def probs(self, pcm: np.ndarray) -> np.ndarray:
                idx = np.arange(len(pcm) // model.hop)
                hit = np.zeros(len(idx), dtype=bool)
                for lo, hi in model.speech:
                    hit |= (idx >= lo) & (idx < hi)
                return np.where(hit, 0.9, 0.0).astype(np.float32)

        return _Stream()


def test_a_clip_past_thirty_seconds_splits_in_order_and_joins(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """§3.6: a crop longer than `PREPASS_MAX_CHUNK_S` splits between spans; each chunk is its own WAV
    request, in order, and the texts join with single spaces (empty answers dropped)."""
    model = _HopModel([(0, 780), (845, 1560), (1625, 10_000)])  # ≈ 25 s · 23 s · 17 s of "speech"
    monkeypatch.setattr(voice_clip, "get_model", lambda _name: model)
    answers = iter(["one", "", "  three "])
    engine = FakeEngine({"clip": lambda _r: next(answers)})
    engine.install(monkeypatch)
    client, _ = _door(tmp_path, _settings(debug=True))
    body = encode("wav", "pcm_s16le", MODEL_RATE, 70.0)
    r = _post(client, body, "clip.wav")
    assert r.status_code == 200 and r.json() == {"text": "one three"}
    expected = prepass(decode_to_pcm16k(body, max_decoded_s=200), model)
    assert len(expected.chunks) == 3
    assert [wav_info(req.body)[3] for req in engine.requests] == [len(c) for c in expected.chunks]
    (trail,) = (tmp_path / "calls" / "clip").glob("*.jsonl")
    pre, _cap, asr = _lines(trail)
    bounds_ms = [[s * 1000 // MODEL_RATE, e * 1000 // MODEL_RATE] for s, e in expected.bounds]
    assert pre["chunks"] == bounds_ms and pre["padded"] is True and pre["decoded_ms"] == 70_000
    assert asr["chunks"] == 3 and len(asr["per_chunk"]) == 3 and asr["ok"] is True


@pytest.mark.parametrize(
    "body",
    [b"not audio at all " * 64, b"RIFF\x00\x00\x00\x00WAVEjunk"],
    ids=["garbage", "riff-junk"],
)
def test_undecodable_audio_is_a_422_and_reaches_no_engine(
    body: bytes, tmp_path: Path, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    engine = FakeEngine({"clip": lambda _r: "x"})
    engine.install(monkeypatch)
    client, _ = _door(tmp_path, _settings(debug=True))
    caplog.set_level(logging.INFO, logger="app.api.voice")
    r = _post(client, body)
    assert r.status_code == 422 and r.json()["detail"] == "the upload is not decodable audio"
    assert engine.requests == [] and not (tmp_path / "calls").exists()
    (record,) = [x for x in caplog.records if x.name == "app.api.voice"]
    assert "undecodable" in record.getMessage() and "not audio" not in record.getMessage()  # never bytes


def test_audio_past_the_decoded_bound_is_a_413_naming_it(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    """H4: `dictation_max_s + 60` s of decoded audio (council 15) — past it, 413 with the bound named."""
    FakeEngine().install(monkeypatch)
    client, _ = _door(tmp_path, _settings(live={"dictation_max_s": 10}))
    caplog.set_level(logging.INFO, logger="app.api.voice")
    r = _post(client, encode("wav", "pcm_s16le", 8000, 71.0), "long.wav")
    assert r.status_code == 413
    detail = r.json()["detail"]
    assert detail == "audio longer than 70 s" and len(detail) < 80
    assert [x.getMessage() for x in caplog.records if x.name == "app.api.voice"] == [
        "voice stt: an upload refused past the decoded bound (70 s)"
    ]


def test_a_decode_past_the_wall_bound_is_a_422_naming_it(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    def slow(_data: bytes, **_kw: Any) -> Any:
        raise DecodeAborted("wall", 60.0)

    monkeypatch.setattr(voice_clip, "decode_to_pcm16k", slow)
    FakeEngine().install(monkeypatch)
    client, _ = _door(tmp_path, _settings())
    r = _post(client, _speech_webm())
    assert r.status_code == 422
    detail = r.json()["detail"]
    assert detail == "audio could not be decoded within 60 s" and len(detail) < 80


def test_every_cpu_step_runs_off_the_event_loop(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """The decode, the cold model, the pass and the WAV wrap each run in a worker thread (no running
    loop there) — the AST ratchet in `test_arch_invariants_sys16.py` pins the call shapes."""
    ran: list[str] = []

    def off_loop(name: str, fn: Any) -> Any:
        def wrapped(*a: Any, **kw: Any) -> Any:
            with pytest.raises(RuntimeError):
                asyncio.get_running_loop()
            ran.append(name)
            return fn(*a, **kw)

        return wrapped

    for name in ("decode_to_pcm16k", "get_model", "prepass", "chunk_wavs"):
        monkeypatch.setattr(voice_clip, name, off_loop(name, getattr(voice_clip, name)))
    FakeEngine({"clip": lambda _r: "ok"}).install(monkeypatch)
    client, _ = _door(tmp_path, _settings())
    assert _post(client, _speech_webm()).json() == {"text": "ok"}
    assert ran == ["decode_to_pcm16k", "get_model", "prepass", "chunk_wavs"]


def test_a_busy_primary_walks_through_the_route_visibly(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    engine = FakeEngine({"clip": lambda _r: "never", "vault": lambda _r: "from whisper"})
    engine.install(monkeypatch)
    client, voice = _door(tmp_path, _settings(debug=True, stt={"connect_timeout_s": 0.05}))
    primary = voice._stt[0]
    sem = voice._gates.sem_for(primary.gate_identity, 1)
    asyncio.run(sem.acquire())  # another request holds parakeet-clip's one slot
    try:
        r = _post(client, _speech_webm())
    finally:
        sem.release()
    assert r.status_code == 200 and r.json() == {"text": "from whisper"}
    assert r.headers["X-Voice-Served-By"] == "vault-speaches" and r.headers["X-Voice-Degraded"] == "1"
    assert [req.url.split("/")[2] for req in engine.requests] == ["vault:9000"]
    (trail,) = (tmp_path / "calls" / "clip").glob("*.jsonl")
    asr = _lines(trail)[-1]
    assert (asr["provider"], asr["degraded"], asr["ok"]) == ("vault-speaches", True, True)
    assert asr["queue_ms"] >= 40


# ═══════════════════════════════ the trail + capture (rulings H6/H7) ═══════════════════════════════


def test_a_debug_clip_gets_its_own_trail_and_capture_and_promotes(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: Any
) -> None:
    secret = "a sentence that must never reach a trail"
    FakeEngine({"clip": lambda _r: secret}).install(monkeypatch)
    client, _ = _door(tmp_path, _settings(debug=True))
    r = _post(client, FIXTURE.read_bytes(), "clip.wav")
    assert r.status_code == 200 and r.json() == {"text": secret}
    clip_dir = tmp_path / "calls" / "clip"
    (trail,) = clip_dir.glob("*.jsonl")
    call_id = trail.stem
    assert secret not in trail.read_text(encoding="utf-8")  # counts and timings only — NEVER text
    pre, cap, asr = _lines(trail)
    assert {line["src"] for line in (pre, cap, asr)} == {"clip"} and {pre["leg"], cap["leg"], asr["leg"]} == {
        1
    }
    assert (pre["ev"], pre["id"], pre["verdict"], pre["decoded_ms"], pre["from_ms"]) == (
        "prepass",
        "clip",
        "ok",
        3000,
        0,
    )
    assert pre["voiced_ms"] > 0 and pre["crop_ms"][0] == 0 and len(pre["chunks"]) == 1
    assert {"decode_ms", "prepass_ms", "padded"} <= pre.keys()
    assert cap == {"t": cap["t"], "src": "clip", "leg": 1, "ev": "capture_open", "file": f"{call_id}-1.wav"}
    assert (asr["ev"], asr["door"], asr["provider"], asr["chunks"], asr["ok"]) == (
        "asr",
        "stt",
        "parakeet-clip",
        1,
        True,
    )
    assert {"queue_ms", "asr_ms", "prepass_ms", "per_chunk", "degraded"} <= asr.keys()
    capture = clip_dir / f"{call_id}-1.wav"
    with wave.open(str(capture), "rb") as w, wave.open(str(FIXTURE), "rb") as f:
        assert (w.getframerate(), w.getnchannels()) == (MODEL_RATE, 1)
        assert w.readframes(w.getnframes()) == f.readframes(f.getnframes())  # the decoded 16 kHz, bit-exact
    if os.name != "nt":
        assert capture.stat().st_mode & 0o777 == 0o600 and clip_dir.stat().st_mode & 0o777 == 0o700
    corpus = _tool("asr_corpus")
    home = tmp_path / "home"
    argv = [
        "--home",
        str(home),
        "promote",
        f"{call_id}-1",
        "--owner-only",
        "--from",
        str(tmp_path),
        "--lang",
        "en",
    ]
    assert corpus.main(argv) == 0
    (raw,) = (home / "asr-corpus" / "raw").iterdir()
    assert f"-clip-unknown-en-{call_id[:8]}-1.wav" in raw.name


def test_a_no_speech_clip_is_still_captured_with_no_asr_line(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The negatives the §6.4 sweep needs: the pass's verdict is on the trail, the audio on disk, and
    nothing was sent."""
    engine = FakeEngine({"clip": lambda _r: "x"})
    engine.install(monkeypatch)
    client, _ = _door(tmp_path, _settings(debug=True))
    assert _post(client, encode("wav", "pcm_s16le", MODEL_RATE, 1.0, amplitude=0.0), "q.wav").json() == {
        "text": ""
    }
    (trail,) = (tmp_path / "calls" / "clip").glob("*.jsonl")
    assert [(line["ev"], line.get("verdict")) for line in _lines(trail)] == [
        ("prepass", "no_speech"),
        ("capture_open", None),
    ]
    assert (trail.parent / f"{trail.stem}-1.wav").is_file() and engine.requests == []


def test_a_dictation_fallback_writes_into_its_dictations_trail(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The whole-clip fallback names its streaming dictation: the clip door's lines and capture join
    THAT trail, as leg 0 — the streaming leg's own capture (`<id>-1.wav`) is never touched."""
    FakeEngine({"clip": lambda _r: "words"}).install(monkeypatch)
    client, _ = _door(tmp_path, _settings(debug=True))
    store = CallTrail(tmp_path / "calls")
    store.append(CALL, [{"t": 1, "src": "relay", "leg": 1, "ev": "leg_start"}], keep=20, mode="dictation")
    streaming = store.open_capture(CALL, 1, rate=MODEL_RATE, mode="dictation")
    assert streaming is not None
    streaming.append(b"\x01\x00" * 800)
    streaming.finalize()
    before = (tmp_path / "calls" / "dictation" / f"{CALL}-1.wav").read_bytes()
    r = _post(client, FIXTURE.read_bytes(), "dictation.wav", f"?call_id={CALL}")
    assert r.status_code == 200
    dictation = tmp_path / "calls" / "dictation"
    lines = _lines(dictation / f"{CALL}.jsonl")
    assert [(line["src"], line["leg"], line["ev"]) for line in lines[1:]] == [
        ("clip", 0, "prepass"),
        ("clip", 0, "capture_open"),
        ("clip", 0, "asr"),
    ]
    assert (dictation / f"{CALL}-0.wav").is_file()
    assert (dictation / f"{CALL}-1.wav").read_bytes() == before
    assert not (tmp_path / "calls" / "clip").exists()


@pytest.mark.parametrize("debug", [False, True])
def test_a_malformed_call_id_is_a_422(debug: bool, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    engine = FakeEngine({"clip": lambda _r: "x"})
    engine.install(monkeypatch)
    client, _ = _door(tmp_path, _settings(debug=debug))
    assert _post(client, FIXTURE.read_bytes(), "a.wav", "?call_id=../../etc").status_code == 422
    assert engine.requests == [] and not (tmp_path / "calls").exists()


def test_debug_without_a_store_writes_nothing_and_still_serves(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    FakeEngine({"clip": lambda _r: "fine"}).install(monkeypatch)
    client, _ = _door(tmp_path, _settings(debug=True), store=False)
    assert _post(client, FIXTURE.read_bytes(), "a.wav").json() == {"text": "fine"}
    assert not (tmp_path / "calls").exists()


def test_a_failed_chain_is_a_502_and_the_trail_says_so(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    def down(_r: Any) -> str:
        raise RuntimeError("engine crashed")

    FakeEngine({"clip": down}).install(monkeypatch)  # the vault host refuses the connection
    client, _ = _door(tmp_path, _settings(debug=True))
    assert _post(client, FIXTURE.read_bytes(), "a.wav").status_code == 502
    (trail,) = (tmp_path / "calls" / "clip").glob("*.jsonl")
    asr = _lines(trail)[-1]
    assert (asr["ev"], asr["ok"], asr["failed_chunk"], asr["provider"], asr["per_chunk"]) == (
        "asr",
        False,
        0,
        None,
        [],
    )


# ═══════════════════════════════ one helper, two callers ═══════════════════════════════


def test_the_door_and_the_replay_share_the_one_chunk_helper(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: Any
) -> None:
    callers: list[str] = []
    real = voice_clip.transcribe_wavs

    async def spy(voice: Any, wavs: list[bytes], *, door: str = "stt") -> Any:
        callers.append(sys._getframe(1).f_code.co_name)
        return await real(voice, wavs, door=door)  # type: ignore[arg-type]

    monkeypatch.setattr(voice_clip, "transcribe_wavs", spy)
    FakeEngine({"clip": lambda _r: "hi"}).install(monkeypatch)
    client, _ = _door(tmp_path, _settings())
    assert _post(client, FIXTURE.read_bytes(), "a.wav").json() == {"text": "hi"}
    config = tmp_path / "config.yaml"
    config.write_text(
        f"providers:\n  parakeet-clip:\n    base_url: http://clip:9011/v1\n    models: {{{MODEL}: {{}}}}\n"
        "voice:\n  stt: {provider: parakeet-clip}\n"
    )
    assert _tool("vad_replay").main([str(FIXTURE), "--asr", str(config)]) == 0
    assert callers == ["transcribe_clip", "transcribe_all"]
    # …and the replay's own copy of the loop is gone for good (the S6-ii near-duplicate)
    source = (TOOLS / "vad_replay.py").read_text(encoding="utf-8")
    assert "pcm16_wav_header" not in source and ".transcribe(" not in source


# ═══════════════════════════════ promote --file (S6-ii ruling H13) ═══════════════════════════════


def test_promote_file_imports_any_decodable_clip(tmp_path: Path, capsys: Any) -> None:
    corpus = _tool("asr_corpus")
    clip = tmp_path / "ptt.webm"
    clip.write_bytes(encode("webm", "libopus", 48000, 1.0))
    home = tmp_path / "home"
    base = ["--home", str(home), "promote", "--file", str(clip), "--owner-only"]
    assert corpus.main(base) == 2  # no trail to read a language from: --lang is required
    assert corpus.main([*base, "--lang", "es", "--label", "ptt"]) == 0
    (raw,) = (home / "asr-corpus" / "raw").iterdir()
    import hashlib

    sha8 = hashlib.sha256(clip.read_bytes()).hexdigest()[:8]
    assert raw.name.endswith(f"-file-unknown-es-{sha8}-0.wav")
    channels, rate, _w, frames = wav_info(raw.read_bytes())
    assert (channels, rate) == (1, MODEL_RATE) and abs(frames - MODEL_RATE) <= 16
    (entry,) = _lines(home / "asr-corpus" / "manifest.jsonl")
    assert entry["source"] == {"mode": "file", "file": str(clip.resolve())} and entry["label"] == ["ptt"]
    assert corpus.main([*base, "--lang", "es"]) == 1  # no-clobber
    assert (
        corpus.main(["--home", str(home), "promote", f"{CALL}-0", "--file", str(clip), "--owner-only"]) == 2
    )
    assert corpus.main(["--home", str(home), "promote", "--owner-only"]) == 2


def test_a_form_post_without_the_csrf_header_is_refused_before_any_work(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The S9 security ruling: a cross-origin-shaped multipart POST (no custom header) is a 403 before the
    decode, the pass, the trail, the capture or the engine — even with `debug` on; a wrong value too."""
    engine = FakeEngine({"clip": lambda _r: "x"})
    engine.install(monkeypatch)
    client, _ = _door(tmp_path, _settings(debug=True))

    def never(*_a: Any, **_kw: Any) -> Any:
        raise AssertionError("a refused send reached the decode")

    monkeypatch.setattr(voice_clip, "decode_to_pcm16k", never)
    form = {"file": ("a.wav", FIXTURE.read_bytes(), "audio/wav")}
    for headers in ({CSRF_HEADER: ""}, {CSRF_HEADER: "XMLHttpRequest"}):
        r = client.post("/api/voice/stt", files=form, headers=headers)
        assert r.status_code == 403 and r.json()["detail"] == "missing the X-Requested-With header"
    bare = TestClient(client.app)  # no default header at all
    assert (
        bare.post("/api/voice/stt", files=form, headers={"Origin": "https://evil.example"}).status_code == 403
    )
    assert engine.requests == [] and not (tmp_path / "calls").exists()


# ═══════════════════════════════ S9 wave 1 (the review round) ═══════════════════════════════


def test_from_ms_trims_the_decoded_head_and_rides_t10(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Emma HIGH: the S8 recovery's `?from_ms=` reaches the decode — the capture IS the decoded suffix and
    T10 records the value; negative or past the decoded bound (in ms) is a 422 before any work."""
    engine = FakeEngine({"clip": lambda _r: "tail"})
    engine.install(monkeypatch)
    client, _ = _door(tmp_path, _settings(debug=True, live={"dictation_max_s": 10}))
    r = _post(client, FIXTURE.read_bytes(), "a.wav", "?from_ms=1000")
    assert r.status_code == 200 and r.json() == {"text": "tail"}
    (trail,) = (tmp_path / "calls" / "clip").glob("*.jsonl")
    pre = _lines(trail)[0]
    assert (pre["from_ms"], pre["decoded_ms"]) == (1000, 2000)
    with wave.open(str(trail.parent / f"{trail.stem}-1.wav"), "rb") as w, wave.open(str(FIXTURE), "rb") as f:
        assert w.readframes(w.getnframes()) == f.readframes(f.getnframes())[2 * MODEL_RATE :]
    for bad in ("-1", "70001", "x"):  # the bound: (10 + 60) s = 70 000 ms
        assert _post(client, FIXTURE.read_bytes(), "a.wav", f"?from_ms={bad}").status_code == 422
    assert len(engine.requests) == 1


@pytest.mark.parametrize("owner", ["unknown", "call"])
def test_a_call_id_joins_only_an_existing_dictation_trail(
    owner: str, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Emma Q8: a client-named id never MINTS a trail — an unknown id, or one a CALL owns, makes the upload
    a standalone clip under a server-minted id; nothing is written under that id anywhere."""
    FakeEngine({"clip": lambda _r: "x"}).install(monkeypatch)
    client, _ = _door(tmp_path, _settings(debug=True))
    calls = tmp_path / "calls"
    if owner == "call":
        CallTrail(calls).append(CALL, [{"t": 1, "src": "relay", "leg": 0, "ev": "leg_start"}], keep=20)
    before = sorted(p.relative_to(tmp_path) for p in tmp_path.rglob("*"))
    assert _post(client, FIXTURE.read_bytes(), "a.wav", f"?call_id={CALL}").status_code == 200
    assert not (calls / "dictation").exists()
    (trail,) = (calls / "clip").glob("*.jsonl")
    assert trail.stem != CALL
    new = sorted(p.relative_to(tmp_path) for p in tmp_path.rglob("*"))
    assert [p for p in new if p not in before and CALL in p.name] == []


def _three_chunk_door(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, clip: Any
) -> tuple[TestClient, FakeEngine]:
    model = _HopModel([(0, 780), (845, 1560), (1625, 10_000)])  # three chunks (the split test's geometry)
    monkeypatch.setattr(voice_clip, "get_model", lambda _name: model)
    engine = FakeEngine({"clip": clip, "vault": lambda _r: "vault"})
    engine.install(monkeypatch)
    client, _ = _door(tmp_path, _settings())
    return client, engine


def _hosts(engine: FakeEngine) -> list[str]:
    return [req.url.split("/")[2].split(":")[0] for req in engine.requests]


def test_the_rest_of_a_clip_stays_on_the_hop_that_served(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Opus M1 — the D63 pin: the primary fails chunk 1, the fallback serves it, and chunks 2–3 go
    STRAIGHT to the fallback (no re-walk) although the primary would answer them now."""
    seen = {"n": 0}

    def flaky(_r: Any) -> str:
        seen["n"] += 1
        if seen["n"] == 1:
            raise RuntimeError("busy")
        return "clip"

    client, engine = _three_chunk_door(tmp_path, monkeypatch, flaky)
    r = _post(client, encode("wav", "pcm_s16le", MODEL_RATE, 70.0), "long.wav")
    assert r.status_code == 200 and r.json() == {"text": "vault vault vault"}
    assert _hosts(engine) == ["clip", "vault", "vault", "vault"]
    assert r.headers["X-Voice-Served-By"] == "vault-speaches" and r.headers["X-Voice-Degraded"] == "1"


def test_a_partly_walked_clip_names_both_hops_in_serve_order(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The review's test gap: chunk 1 on the primary, chunk 2 walks, chunk 3 stays on the fallback —
    `X-Voice-Served-By` lists both in SERVE order and `X-Voice-Degraded` says a chunk walked."""
    seen = {"n": 0}

    def second_fails(_r: Any) -> str:
        seen["n"] += 1
        if seen["n"] == 2:
            raise RuntimeError("crashed")
        return "clip"

    client, engine = _three_chunk_door(tmp_path, monkeypatch, second_fails)
    r = _post(client, encode("wav", "pcm_s16le", MODEL_RATE, 70.0), "long.wav")
    assert r.status_code == 200 and r.json() == {"text": "clip vault vault"}
    assert _hosts(engine) == ["clip", "clip", "vault", "vault"]
    assert r.headers["X-Voice-Served-By"] == "parakeet-clip, vault-speaches"
    assert r.headers["X-Voice-Degraded"] == "1"


def test_a_stalled_engine_walks_at_timeout_s(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """A hung-but-accepting primary (alive, its mutex wedged): the request is cut at `timeout_s` and the
    chain walks — the fake enforces the SDK client's read timeout the way a socket would."""
    import time

    async def wedged(_r: Any) -> str:
        await asyncio.sleep(30)
        return "never"

    engine = FakeEngine({"clip": wedged, "vault": lambda _r: "from whisper"})
    engine.install(monkeypatch)
    client, _ = _door(tmp_path, _settings(stt={"timeout_s": 0.3}))
    started = time.monotonic()
    r = _post(client, FIXTURE.read_bytes(), "a.wav")
    assert r.status_code == 200 and r.json() == {"text": "from whisper"}
    assert time.monotonic() - started < 5
    assert _hosts(engine) == ["clip", "vault"] and r.headers["X-Voice-Degraded"] == "1"
