"""`app/core/audio.py` — the live-voice relay's stateful resampler (Phase 24 / D71 S1).

Speaches' realtime door hardcodes 24 kHz (§7-S0 ②) and the phone declares whatever its
`AudioContext` gives it, so this converter sits in the hot path of every live call. What the arms pin:

* the identity fast path (a 24 kHz client pays nothing);
* **frame-boundary continuity** — `feed(a) + feed(b)` must equal `feed(a + b)` EXACTLY, which is the
  whole reason the resampler is stateful rather than per-frame (R51 §2.2's hardcoded-ratio defect
  inverted: a per-frame resampler stamps a discontinuity in 25 times a second);
* agreement with the whole-clip `np.interp` reference that `tools/speaches_realtime_smoke.py` used to
  pin the wire contract, within the tolerance the two mappings differ by (see `test_…_matches_…`);
* the non-integer ratio (44.1 k → 24 k) producing the right sample count;
* an odd-length frame REJECTED rather than guessed — half a sample means the stream is misframed and
  every later frame would be a byte out.

Plain asserts; no fixtures, no I/O (the module is pure stdlib by construction).
"""

from __future__ import annotations

import math
import struct

import pytest

from app.core.audio import SPEACHES_WIRE_RATE, Pcm16Resampler, frame_bytes, silence


def _pack(samples: list[int]) -> bytes:
    return struct.pack(f"<{len(samples)}h", *samples)


def _unpack(raw: bytes) -> list[int]:
    return list(struct.unpack(f"<{len(raw) // 2}h", raw))


def _sine(rate: int, hz: float, ms: int, amp: int = 10000) -> list[int]:
    n = int(rate * ms / 1000)
    return [int(amp * math.sin(2 * math.pi * hz * i / rate)) for i in range(n)]


def _whole_clip_reference(samples: list[int], src_rate: int, dst_rate: int) -> list[int]:
    """`tools/speaches_realtime_smoke.py`'s `resample()` verbatim — which is itself Speaches' own
    `np.interp` resampler. The endpoint-anchored mapping of a clip with a known end."""
    n_out = int(len(samples) * dst_rate / src_rate)
    step = (len(samples) - 1) / max(n_out - 1, 1)
    out: list[int] = []
    for i in range(n_out):
        x = i * step
        lo = int(x)
        hi = min(lo + 1, len(samples) - 1)
        out.append(int(samples[lo] + (samples[hi] - samples[lo]) * (x - lo)))
    return out


def test_identity_passes_frames_through_untouched() -> None:
    raw = _pack(_sine(SPEACHES_WIRE_RATE, 220, 40))
    r = Pcm16Resampler(SPEACHES_WIRE_RATE, SPEACHES_WIRE_RATE)
    assert r.identity is True
    assert r.feed(raw) is raw  # not merely equal: no copy, no unpack, no allocation


@pytest.mark.parametrize("samples_per_frame", [1764, 1000, 441, 137])
def test_frame_boundary_is_continuous(samples_per_frame: int) -> None:
    """The load-bearing property: chunking the input must not change the output by one sample.

    A per-frame resampler fails this — it restarts its phase at every frame and clamps the first
    output sample to the frame's own first sample instead of interpolating across the seam.

    Several frame sizes on purpose, because ONE can be vacuous: at 44.1 k → 24 k the ratio's period is
    147 source samples, so a 1764-sample (40 ms) frame is a whole number of periods and the carried
    phase happens to be zero at every boundary. That arm passes even for a stateless resampler. The
    unaligned sizes are the ones that actually exercise the carry — and a real client's frames are
    only aligned by luck (`frame_ms` is a config knob and the declared rate is whatever the device
    reports).
    """
    clip = _pack(_sine(44100, 100, 200))
    frame = samples_per_frame * 2

    one_shot = Pcm16Resampler(44100, SPEACHES_WIRE_RATE).feed(clip)
    streamed = Pcm16Resampler(44100, SPEACHES_WIRE_RATE)
    chunked = b"".join(streamed.feed(clip[i : i + frame]) for i in range(0, len(clip), frame))

    assert chunked == one_shot
    # …and it is not vacuously true because the chunking produced one call:
    assert len(clip) // frame > 2


def test_48k_to_24k_is_exact_decimation_of_a_ramp() -> None:
    """An integer ratio has an exact answer, so assert it exactly: every other source sample."""
    ramp = list(range(0, 960))
    out = _unpack(Pcm16Resampler(48000, SPEACHES_WIRE_RATE).feed(_pack(ramp)))
    assert len(out) == 480
    assert out == ramp[::2]


def test_matches_the_whole_clip_np_interp_reference_within_tolerance() -> None:
    """Agreement with the smoke tool's (= Speaches') whole-clip resampler.

    A TOLERANCE and not an equality, for a stated reason: the reference maps `[0, n-1]` onto
    `[0, n_out-1]` (endpoint-anchored, only possible when the end is known), while a streaming
    resampler must use a constant `src/dst` ratio. Over a clip that is a sub-sample phase drift —
    which on a smooth 100 Hz tone is a small fraction of full scale, and on the 40 ms frames a real
    call actually carries is negligible.
    """
    src = _sine(48000, 100, 100, amp=10000)
    mine = _unpack(Pcm16Resampler(48000, SPEACHES_WIRE_RATE).feed(_pack(src)))
    ref = _whole_clip_reference(src, 48000, SPEACHES_WIRE_RATE)
    assert len(mine) == len(ref)
    worst = max(abs(a - b) for a, b in zip(mine, ref, strict=True))
    assert worst <= 400, f"diverged by {worst} of 10000 full scale"


def test_44k1_to_24k_length_follows_the_ratio() -> None:
    """The non-integer ratio: 1764 source samples (40 ms @ 44.1 k) must yield 960 ± 1."""
    r = Pcm16Resampler(44100, SPEACHES_WIRE_RATE)
    for _ in range(10):  # steady state, not just the first frame
        out = r.feed(_pack(_sine(44100, 440, 40)))
        assert abs(len(out) // 2 - 960) <= 1


def test_upsampling_also_holds_the_boundary() -> None:
    """8 kHz is inside the accepted `start.sample_rate` range, so the ratio < 1 path is real."""
    clip = _pack(_sine(8000, 300, 120))
    frame = frame_bytes(40, 8000)
    one_shot = Pcm16Resampler(8000, SPEACHES_WIRE_RATE).feed(clip)
    streamed = Pcm16Resampler(8000, SPEACHES_WIRE_RATE)
    chunked = b"".join(streamed.feed(clip[i : i + frame]) for i in range(0, len(clip), frame))
    assert chunked == one_shot
    # 120 ms @ 24 kHz = 2880 samples, minus the tail the resampler holds back: an output sample is
    # emitted only once its RIGHT neighbour has arrived, so at a 1:3 ratio up to three of them wait
    # for the next frame. In a call that tail is emitted 40 ms later; at the end of a stream it is
    # ~0.1 ms of audio, which is why nothing tries to flush it.
    assert 2880 - 3 <= len(one_shot) // 2 <= 2880


def test_odd_length_frame_is_rejected() -> None:
    r = Pcm16Resampler(48000, SPEACHES_WIRE_RATE)
    with pytest.raises(ValueError, match="even number of bytes"):
        r.feed(b"\x00\x01\x02")


def test_empty_frame_and_bad_rates() -> None:
    assert Pcm16Resampler(48000, SPEACHES_WIRE_RATE).feed(b"") == b""
    with pytest.raises(ValueError, match="positive"):
        Pcm16Resampler(0, SPEACHES_WIRE_RATE)


def test_silence_and_frame_bytes_helpers() -> None:
    assert len(silence(40, SPEACHES_WIRE_RATE)) == frame_bytes(40, SPEACHES_WIRE_RATE) == 1920
    assert set(silence(40, SPEACHES_WIRE_RATE)) == {0}
    assert silence(0, SPEACHES_WIRE_RATE) == b"" and silence(-5, 24000) == b""
