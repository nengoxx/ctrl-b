"""PCM16 audio primitives — pure, stdlib-only (Phase 24 / D71 §3.1).

The live-voice relay has to reconcile two fixed rates it does not control: the phone declares its real
`AudioContext.sampleRate` (44.1 k / 48 k / whatever the device gives it) and Speaches' realtime door
hardcodes **24 kHz** with no negotiation (§7-S0 ②). So a resampler is mandatory — and it must be
STATEFUL, because the audio arrives as a stream of independent frames: a per-frame whole-clip
resampler would re-anchor at every boundary and stamp a discontinuity into the signal 25 times a
second (the inverse of RVC's hardcoded-ratio defect, R51 §2.2).

`app/core/` is the pure layer: no I/O, no `Settings`, and it may not import `app/services/`
(qh9 invariant). Everything here is `array`/`struct` — **no numpy**, which is not a dependency of
this backend and would be a large one to add for linear interpolation.
"""

from __future__ import annotations

from array import array
from math import gcd

#: Speaches' realtime wire rate — hardcoded in its `input_audio_buffer_event_router`, no negotiation
#: (§7-S0 ②; `tools/speaches_realtime_smoke.py` pins the same constant).
SPEACHES_WIRE_RATE = 24000

#: Bytes per pcm16 mono sample.
_SAMPLE_BYTES = 2


def silence(ms: int, rate: int) -> bytes:
    """`ms` milliseconds of zeroed pcm16 LE mono at `rate`. The R70 §4 release flush is nothing but a
    burst of these, so it lives beside the resampler rather than inside the relay."""
    if ms <= 0 or rate <= 0:
        return b""
    return b"\x00\x00" * int(rate * ms / 1000)


def frame_bytes(ms: int, rate: int) -> int:
    """Byte length of one `ms`-long pcm16 LE mono frame at `rate` — the length-only twin of `silence`,
    so the two can never disagree about how long a `frame_ms` frame is. Its callers today are the
    frame-boundary tests (which slice a clip at a real `frame_ms` for a real device rate); the relay
    itself only ever needs the bytes, which `silence` returns."""
    return int(rate * ms / 1000) * _SAMPLE_BYTES


class Pcm16Resampler:
    """Streaming linear-interpolation resampler for pcm16 LE mono, ONE per live session.

    The interpolation math is the same as `speaches.audio.resample_audio_data` (`np.interp`) and as
    `tools/speaches_realtime_smoke.py`'s `resample()` — what differs is that this one is *continuous*:

    * the read position carries across `feed()` calls as an exact rational, so output samples land on
      an even `src_rate / dst_rate` grid over the whole session rather than restarting per frame;
    * the LAST sample of the previous frame is retained, so the first output sample of a frame can
      interpolate across the boundary instead of clamping to the frame's own first sample.

    Together those two make `feed(a) + feed(b) == feed(a + b)` exactly, which is the property the
    frame-boundary test pins. The mapping is constant-ratio (output sample *i* reads source position
    `i * ratio`), not the endpoint-anchored `(n-1)/(n_out-1)` of a whole-clip resample — the only
    honest choice for a stream with no known end, and the reason the whole-clip comparison in the
    tests is a tolerance rather than an equality.

    Identity (`src_rate == dst_rate`, the common Chrome-at-24 kHz… case) is a pass-through fast path.
    An odd-length frame is a caller bug — half a sample means the stream is misframed and every later
    frame would be off by a byte — so it raises rather than guessing.
    """

    def __init__(self, src_rate: int, dst_rate: int) -> None:
        if src_rate <= 0 or dst_rate <= 0:
            raise ValueError(f"sample rates must be positive (got {src_rate} -> {dst_rate})")
        self.src_rate = src_rate
        self.dst_rate = dst_rate
        # The read position is carried as an EXACT RATIONAL, not a float: `_num / _den` source samples
        # relative to the current frame's index 0. A float `pos += src/dst` accumulates rounding, and
        # the accumulated error differs between "one big feed" and "the same audio in frames" — which
        # lands on a different source index whenever the true position is an integer, so the
        # continuity property above would hold only for ratios that happen to be representable
        # (8 kHz → 24 kHz, ratio 1/3, drifts within a tenth of a second). Reduced by the gcd and
        # re-origined per frame, so the integers stay small over a 30-minute call.
        div = gcd(src_rate, dst_rate)
        self._step = src_rate // div  # numerator advance per OUTPUT sample
        self._den = dst_rate // div
        self._num = 0
        #: The previous frame's last sample, addressable as index -1. Seeded 0 and never read on the
        #: first frame (the position starts at 0, whose left neighbour is index 0 itself).
        self._prev = 0

    @property
    def identity(self) -> bool:
        return self.src_rate == self.dst_rate

    def feed(self, frame: bytes) -> bytes:
        """Resample one frame, carrying phase + the boundary sample into the next call."""
        if len(frame) % _SAMPLE_BYTES:
            raise ValueError(f"pcm16 frame must be an even number of bytes (got {len(frame)})")
        if not frame:
            return b""
        if self.identity:
            return frame

        src = array("h")
        src.frombytes(frame)
        n = len(src)
        prev = self._prev
        num = self._num
        den = self._den
        step = self._step
        limit = (n - 1) * den
        out = array("h")
        # Emit while the right neighbour is still inside THIS frame: `num/den < n - 1` is exactly
        # floor(pos) + 1 <= n - 1. Anything past it waits for the next frame, which is what keeps the
        # grid even across boundaries instead of clamping at the edge.
        while num < limit:
            lo, rem = divmod(num, den)  # int divmod floors, so a negative `num` gives lo == -1
            left = prev if lo < 0 else src[lo]
            right = src[lo + 1]
            out.append(int(left + (right - left) * (rem / den)))
            num += step
        # Re-origin onto the next frame (its index 0 is this frame's index n) and keep the boundary
        # sample. The loop guarantees num >= (n-1)*den, so the carried position is >= -1 — i.e. the
        # single retained sample is always enough to interpolate the next frame's first output.
        self._num = num - n * den
        self._prev = src[n - 1]
        return out.tobytes()
