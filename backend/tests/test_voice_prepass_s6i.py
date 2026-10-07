"""Phase 26 S6-i — the pre-ASR pass + the bounded decode (`services/voice_prepass.py`; ASR_PLAN §3.6).

* **the pass constants** (code constants, not keys — §4) and each registered model's `prepass_act`;
* **the rule** (ruling H7) through a scripted fake model: no speech → `no_speech` after ONE scan (no other
  model call, and nothing ASR-shaped exists here to touch); the hysteresis; the 160 ms merge; ONE crop
  `[first − 400, last + 400]` ms; the tail pad (H8); > 30 s split BETWEEN spans in order; a single span
  past the cap hard-cut;
* **the decode** (H4/H8): webm/opus, ogg/opus, mp4/aac and wav encoded IN-TEST by PyAV's own encoders
  decode to 16 kHz mono of the right length (mp4 may carry ~21 ms of encoder priming); the decoded-
  duration bound, the wall bound (an injected clock), garbage → `UndecodableAudio`, and `from_ms`.
"""

from __future__ import annotations

import io

import av
import numpy as np
import pytest

from app.services.voice_prepass import (
    PREPASS_MAX_CHUNK_S,
    PREPASS_MIN_SILENCE_MS,
    PREPASS_PAD_MS,
    DecodeAborted,
    UndecodableAudio,
    decode_to_pcm16k,
    prepass,
    scan,
)
from app.services.voice_vad import VAD_MODELS, deact_of

HOP = 512
PAD = PREPASS_PAD_MS * 16  # 6400 samples


class _Stream:
    def __init__(self, model: _ScriptedModel) -> None:
        self._model = model

    def probs(self, pcm: np.ndarray) -> np.ndarray:
        self._model.calls += 1
        n = len(pcm) // HOP
        assert len(pcm) % HOP == 0 and n == len(self._model.script), (n, len(self._model.script))
        return np.asarray(self._model.script, dtype=np.float32)


class _ScriptedModel:
    """A `VadModel` whose one stream answers the given per-hop probabilities for the whole buffer."""

    name = "scripted"
    sample_rate = 16000
    hop = HOP
    delay_hops = 0
    default_act = 0.6
    prepass_act = 0.5
    sha256 = ""
    asset = ""

    def __init__(self, script: list[float]) -> None:
        self.script = script
        self.calls = 0

    def open(self) -> _Stream:
        return _Stream(self)


def _script(runs: list[tuple[float, int]]) -> list[float]:
    return [p for p, n in runs for _ in range(n)]


def _audio(n: int) -> np.ndarray:
    """A recognisable ramp, so a chunk's position in the input is checkable."""
    return (np.arange(n, dtype=np.float32) % 1000) / 1000


# ── constants ──


def test_the_pass_constants() -> None:
    assert (PREPASS_MIN_SILENCE_MS, PREPASS_PAD_MS, PREPASS_MAX_CHUNK_S) == (160, 400, 30)
    for cls in VAD_MODELS.values():
        assert cls.prepass_act == 0.5
        assert deact_of(cls.prepass_act) == pytest.approx(0.35)


# ── the rule ──


def test_no_speech_is_one_scan_and_nothing_else() -> None:
    model = _ScriptedModel(_script([(0.49, 100)]))  # just under prepass_act: not speech
    result = prepass(_audio(100 * HOP), model)
    assert (result.outcome, result.chunks, result.spans) == ("no_speech", [], [])
    assert model.calls == 1


def test_one_crop_around_the_speech() -> None:
    # Speech hops 100..149 → span [51200, 76800) → ONE chunk [51200 − 6400, 76800 + 6400).
    pcm = _audio(313 * HOP - 300)  # 312.4 hops: the last one is zero-padded by the hop helper
    model = _ScriptedModel(_script([(0.1, 100), (0.9, 50), (0.1, 163)]))
    result = prepass(pcm, model)
    assert result.outcome == "ok" and result.spans == [(51200, 76800)] and result.hop == HOP
    assert len(result.chunks) == 1
    assert np.array_equal(result.chunks[0], pcm[51200 - PAD : 76800 + PAD])


def test_hysteresis_and_the_160ms_merge() -> None:
    # 0.4 (≥ deact 0.35) continues a span; 0.3 ends it. Gaps of 4 hops (128 ms) merge, 6 hops (192 ms) not.
    runs = [(0.1, 20), (0.9, 5), (0.4, 5), (0.3, 4), (0.9, 5), (0.3, 6), (0.9, 5), (0.1, 20)]
    _, spans = scan(_audio(70 * HOP), _ScriptedModel(_script(runs)))
    # span 1: hops 20..29 (0.9 ×5 then 0.4 ×5), gap 30..33 (128 ms) → merged with 34..38; gap 39..44
    # (192 ms) → a second span 45..49.
    assert spans == [(20 * HOP, 39 * HOP), (45 * HOP, 50 * HOP)]


def test_the_head_clamps_and_the_tail_is_zero_padded() -> None:
    # Speech from hop 3 to the very end of a 5 s buffer (80000 samples = 156.25 hops → 157, the last
    # padded): the crop's head clamps to 0; the span ends at the REAL end (80000), and 6400 zeros follow.
    pcm = _audio(80000) + 0.5
    model = _ScriptedModel(_script([(0.1, 3), (0.9, 154)]))
    result = prepass(pcm, model)
    assert result.spans == [(3 * HOP, 80000)]
    (chunk,) = result.chunks
    assert len(chunk) == 80000 + PAD
    assert np.array_equal(chunk[:80000], pcm)
    assert not chunk[80000:].any()


def test_a_crop_past_30s_splits_between_spans_in_order() -> None:
    # Spans A = hops [100, 1000), B = [1100, 1900), C = [2000, 2100) in a 70 s buffer. A with its pads is
    # 29.6 s, A + B is not → chunk 1 ends at A's tail pad; chunk 2 starts at B's lead pad, holds B, and
    # ends at B's tail pad (C would pass the cap); chunk 3 = C ± pads. Pads never cross a gap's middle.
    n = 70 * 16000
    pcm = _audio(n)
    runs = [
        (0.1, 100),
        (0.9, 900),
        (0.1, 100),
        (0.9, 800),
        (0.1, 100),
        (0.9, 100),
        (0.1, n // HOP + 1 - 2100),
    ]
    result = prepass(pcm, _ScriptedModel(_script(runs)))
    a, b, c = (100 * HOP, 1000 * HOP), (1100 * HOP, 1900 * HOP), (2000 * HOP, 2100 * HOP)
    assert result.spans == [a, b, c]
    bounds = [(a[0] - PAD, a[1] + PAD), (b[0] - PAD, b[1] + PAD), (c[0] - PAD, c[1] + PAD)]
    assert [len(ch) for ch in result.chunks] == [hi - lo for lo, hi in bounds]
    for chunk, (lo, hi) in zip(result.chunks, bounds, strict=True):
        assert np.array_equal(chunk, pcm[lo:hi])
        assert len(chunk) <= PREPASS_MAX_CHUNK_S * 16000


def test_a_single_span_past_the_cap_is_hard_cut() -> None:
    # One 40 s span (hops 100..1349) in 45 s → crop [44800, 697600) = 40.8 s → [44800, +30 s) + the rest.
    n = 45 * 16000
    pcm = _audio(n)
    result = prepass(pcm, _ScriptedModel(_script([(0.1, 100), (0.9, 1250), (0.1, n // HOP + 1 - 1350)])))
    cap = PREPASS_MAX_CHUNK_S * 16000
    lo, hi = 100 * HOP - PAD, 1350 * HOP + PAD
    assert [len(ch) for ch in result.chunks] == [cap, hi - lo - cap]
    assert np.array_equal(np.concatenate(result.chunks), pcm[lo:hi])


def test_the_pass_runs_a_real_model_on_real_speech() -> None:
    """The shipped default end to end on the conformance fixture: speech found, one chunk."""
    import wave
    from pathlib import Path

    from app.services.voice_audio import pcm16_to_float32
    from app.services.voice_vad import get_model

    fixture = Path(__file__).resolve().parent / "data" / "silero_test_3s.wav"
    with wave.open(str(fixture), "rb") as w:
        pcm = pcm16_to_float32(w.readframes(w.getnframes()))
    result = prepass(pcm, get_model("silero-v6.2"))
    assert result.outcome == "ok" and len(result.chunks) == 1 and result.spans
    assert prepass(np.zeros(48000, dtype=np.float32), get_model("silero-v6.2")).outcome == "no_speech"


# ── the decode ──


def _encode(fmt: str, codec: str, rate: int, seconds: float = 1.0) -> bytes:
    """A 440 Hz tone encoded IN-TEST by PyAV's own encoder (no committed binaries)."""
    buf = io.BytesIO()
    with av.open(buf, mode="w", format=fmt) as container:
        stream = container.add_stream(codec, rate=rate, layout="mono")
        t = np.arange(int(rate * seconds)) / rate
        x = (0.3 * np.sin(2 * np.pi * 440 * t) * 32767).astype(np.int16)
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


CONTAINERS = [
    ("webm", "libopus", 48000),
    ("ogg", "libopus", 48000),
    ("mp4", "aac", 44100),
    ("wav", "pcm_s16le", 48000),
]


@pytest.mark.parametrize(("fmt", "codec", "rate"), CONTAINERS, ids=[c[0] for c in CONTAINERS])
def test_decode_each_container_to_16k_mono(fmt: str, codec: str, rate: int) -> None:
    pcm = decode_to_pcm16k(_encode(fmt, codec, rate, seconds=2.0), max_decoded_s=10)
    assert pcm.dtype == np.float32 and pcm.ndim == 1
    tolerance = 400 if fmt == "mp4" else 16  # AAC encoder priming ≈ 21 ms; the others land exact
    assert abs(len(pcm) - 32000) <= tolerance, len(pcm)
    rms = float(np.sqrt(np.mean(pcm[4000:-4000] ** 2)))
    assert rms == pytest.approx(0.3 / np.sqrt(2), abs=0.03)  # the 0.3-amplitude tone, not silence


def test_decode_aborts_past_the_decoded_duration() -> None:
    with pytest.raises(DecodeAborted) as caught:
        decode_to_pcm16k(_encode("wav", "pcm_s16le", 48000, seconds=3.0), max_decoded_s=1.0)
    assert caught.value.bound == "decoded"


def test_decode_aborts_past_the_wall_bound() -> None:
    ticks = iter(range(0, 10_000, 100))  # every read of the clock is 100 s later
    with pytest.raises(DecodeAborted) as caught:
        decode_to_pcm16k(
            _encode("webm", "libopus", 48000), max_decoded_s=10, max_wall_s=60, clock=lambda: next(ticks)
        )
    assert caught.value.bound == "wall"


@pytest.mark.parametrize("garbage", [b"", b"not audio at all " * 64, b"RIFF\x00\x00\x00\x00WAVEjunk"])
def test_garbage_is_undecodable(garbage: bytes) -> None:
    with pytest.raises(UndecodableAudio):
        decode_to_pcm16k(garbage, max_decoded_s=10)


def test_from_ms_trims_the_decoded_head() -> None:
    data = _encode("wav", "pcm_s16le", 16000, seconds=1.0)
    whole = decode_to_pcm16k(data, max_decoded_s=10)
    tail = decode_to_pcm16k(data, max_decoded_s=10, from_ms=250)
    assert len(whole) == 16000 and len(tail) == 12000
    assert np.array_equal(tail, whole[4000:])


def test_from_ms_audio_counts_toward_the_decoded_bound() -> None:
    """The bound is on DECODED audio from the file's start: a 1.5 s file with `from_ms=1000` keeps 0.5 s
    but still decodes 1.5 s, past a 1.0 s cap."""
    with pytest.raises(DecodeAborted) as caught:
        decode_to_pcm16k(_encode("wav", "pcm_s16le", 16000, seconds=1.5), max_decoded_s=1.0, from_ms=1000)
    assert caught.value.bound == "decoded"
