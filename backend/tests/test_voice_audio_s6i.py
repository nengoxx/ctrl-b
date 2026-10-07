"""Phase 26 S6-i — the ear's DSP primitives (`services/voice_audio.py`; ASR_PLAN §3.4 "The resampler", R17).

* **The ONE alias golden test** (R17): a −6 dBFS 9 kHz tone at 48 kHz and at 44.1 kHz lands on its 7 kHz
  alias ≥ 30 dB down after the wrapper — with a 1 kHz control tone that must PASS at ≈ −6 dBFS, so a
  wrapper that output silence could not pass the alias arm.
* **chunked == whole**: 40 ms frames + flush are bit-identical to one feed + flush.
* **identity** at 16 kHz returns the input untouched and never touches PyAV (av blocked); odd length →
  `ValueError` (the `Pcm16Resampler` contract the wrapper copies).
* pcm16 ↔ float32 round-trip; `HopBuffer`'s residual, pad and clamp.

All audio is synthesized in-test (numpy).
"""

from __future__ import annotations

import sys

import numpy as np
import pytest

from app.services.voice_audio import HopBuffer, PcmResampler, float32_to_pcm16, pcm16_to_float32

OUT_RATE = 16000


def _tone(freq: float, rate: int, seconds: float = 1.0, dbfs: float = -6.0) -> bytes:
    t = np.arange(int(rate * seconds)) / rate
    return float32_to_pcm16((10 ** (dbfs / 20) * np.sin(2 * np.pi * freq * t)).astype(np.float32))


def _feed(resampler: PcmResampler, pcm: bytes, frame_ms: int | None = 40) -> bytes:
    if frame_ms is None:
        return resampler.feed(pcm) + resampler.flush()
    step = resampler.src_rate * frame_ms // 1000 * 2
    return b"".join(resampler.feed(pcm[i : i + step]) for i in range(0, len(pcm), step)) + resampler.flush()


def _level_dbfs(pcm: bytes, freq: float) -> float:
    """The level of the strongest bin within ±50 Hz of `freq`, in dBFS (Hann window, steady state only)."""
    x = pcm16_to_float32(pcm)[OUT_RATE // 10 : -OUT_RATE // 10].astype(np.float64)
    window = np.hanning(len(x))
    spectrum = np.abs(np.fft.rfft(x * window)) * 2 / window.sum()
    bins = np.fft.rfftfreq(len(x), 1 / OUT_RATE)
    near = (bins > freq - 50) & (bins < freq + 50)
    return 20 * np.log10(max(float(spectrum[near].max()), 1e-12))


@pytest.mark.parametrize("rate", [48000, 44100])
def test_the_9khz_alias_is_at_least_30db_down(rate: int) -> None:
    out = _feed(PcmResampler(rate), _tone(9000, rate))
    assert _level_dbfs(out, 7000) <= -6.0 - 30.0
    passband = _feed(PcmResampler(rate), _tone(1000, rate))
    assert _level_dbfs(passband, 1000) == pytest.approx(-6.0, abs=0.5)


@pytest.mark.parametrize("rate", [48000, 44100])
def test_chunked_equals_whole(rate: int) -> None:
    pcm = _tone(1234, rate, seconds=0.73)
    chunked = _feed(PcmResampler(rate), pcm, frame_ms=40)
    whole = _feed(PcmResampler(rate), pcm, frame_ms=None)
    assert chunked == whole
    assert abs(len(whole) // 2 - round(len(pcm) // 2 * OUT_RATE / rate)) <= 1


def test_the_hold_back_is_returned_by_flush() -> None:
    r = PcmResampler(48000)
    first = r.feed(_tone(440, 48000, seconds=0.04))
    assert 0 < len(first) // 2 < 640  # the delay line holds samples back…
    assert len(r.flush()) // 2 == 640 - len(first) // 2  # …until the flush


def test_identity_never_touches_pyav(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setitem(sys.modules, "av", None)  # any `import av` now raises
    r = PcmResampler(16000)
    frame = _tone(440, 16000, seconds=0.04)
    assert r.identity
    assert r.feed(frame) is frame
    assert r.flush() == b""


def test_odd_length_is_refused() -> None:
    with pytest.raises(ValueError):
        PcmResampler(48000).feed(b"\x00\x00\x00")
    with pytest.raises(ValueError):
        PcmResampler(16000).feed(b"\x00")
    with pytest.raises(ValueError):
        PcmResampler(0)


def test_pcm16_float32_round_trip() -> None:
    pcm = np.array([-32768, -1, 0, 1, 12345, 32767], dtype="<i2").tobytes()
    x = pcm16_to_float32(pcm)
    assert x.dtype == np.float32
    assert x[0] == -1.0 and x[2] == 0.0
    assert float32_to_pcm16(x) == pcm
    assert (
        float32_to_pcm16(np.array([2.0, -2.0], dtype=np.float32))
        == np.array([32767, -32768], "<i2").tobytes()
    )
    with pytest.raises(ValueError):
        pcm16_to_float32(b"\x00")


def test_hop_buffer_carries_pads_and_clamps() -> None:
    hops = HopBuffer(512)
    x = np.arange(640 * 4, dtype=np.float32)
    got = [hops.push(x[i : i + 640]) for i in range(0, len(x), 640)]
    assert [len(g) for g in got] == [512, 512, 512, 1024]  # 1.25 hops per 40 ms frame, nothing dropped
    assert np.array_equal(np.concatenate(got), x)
    assert hops.real_end == 2560
    assert len(hops.pad()) == 0  # 2560 is exactly five hops: no leftover, no pad
    hops.push(np.ones(100, dtype=np.float32))
    padded = hops.pad()
    assert len(padded) == 512 and padded[:100].sum() == 100 and not padded[100:].any()
    assert hops.clamp(2560 + 512) == 2660 and hops.clamp(100) == 100


@pytest.mark.parametrize("rate", [48000, 16000])
def test_feed_after_flush_is_a_clear_error(rate: int) -> None:
    """A flushed resampler is spent: a later `feed` is a caller bug, said plainly (never PyAV's EOFError)."""
    r = PcmResampler(rate)
    r.feed(_tone(440, rate, seconds=0.04))
    r.flush()
    with pytest.raises(RuntimeError, match="feed after flush"):
        r.feed(_tone(440, rate, seconds=0.04))
