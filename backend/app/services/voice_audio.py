"""The ear's DSP primitives (Phase 26 / D82, ASR_PLAN §3.4 + §3.4.1 ②; session-64 ruling H4).

Three things live here, and only here, because they are shared:

* **`PcmResampler`** — the stateful, anti-aliased PyAV (libswresample) resampler that brings the client's
  audio to the VAD's 16 kHz (R17, R97 P-7). It copies `core/audio.Pcm16Resampler`'s interface on purpose
  (`feed(pcm16 bytes) -> bytes`, the `identity` short-circuit, odd length → `ValueError`) plus the
  `flush()` a filter with a delay line needs, so the flip (S7b) swaps the call site and S10 deletes the
  linear class. Both exist until S10 — the linear one keeps ONLY the Speaches 24 kHz hop.
* **pcm16 ↔ float32** — the one conversion the VAD, the pass and the decode all use (÷ 32768, Silero's
  own convention; the inverse rounds and clips).
* **`HopBuffer`** — THE hop helper (§3.4.1 ②: "one function, no second copy"): the `< hop` residual carry,
  the zero-pad of a leftover to one hop, and the clamp of an edge to the last REAL sample. The live
  `VadSegmenter` streams through it; the pre-ASR pass pushes a whole buffer through the same object.

`app/core/` is stdlib-only by charter, so numpy/PyAV code lives in `services/`. **Import-safe (ruling H1):**
numpy and av are imported inside the functions that need them (annotations ride `TYPE_CHECKING`), so a
wheel-less install (Termux) still boots — the `voice` extra is only needed once the ear runs.
"""

from __future__ import annotations

import functools
import importlib.util
from fractions import Fraction
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    import numpy as np
    from numpy.typing import NDArray

#: What the `voice` extra brings (backend/pyproject.toml) — the three packages the clip door's decode,
#: resample and pass need at runtime.
VOICE_EXTRA = ("numpy", "onnxruntime", "av")


@functools.cache
def voice_extra_installed() -> bool:
    """Whether the `voice` extra is importable — probed by SPEC, never by import (onnxruntime costs tens
    of MB to load, and the boot must stay import-safe, ruling H1). Cached: the answer cannot change under
    a running process. A name blocked in `sys.modules` (`= None`, the wheel-less boot test) reads as
    missing — `find_spec` raises `ValueError` for it."""
    try:
        return all(importlib.util.find_spec(name) is not None for name in VOICE_EXTRA)
    except ValueError, ImportError:
        return False


#: The VAD's sample rate — every registered model runs at 16 kHz (§3.4.1 ①), and so does the pass.
MODEL_RATE = 16000

#: pcm16 full scale: int16 → float32 divides by it (Silero's reference loop, R98 `models_lib.py`).
_PCM16_SCALE = 32768.0
_SAMPLE_BYTES = 2


def pcm16_to_float32(data: bytes) -> NDArray[np.float32]:
    """pcm16 LE mono bytes → float32 in [-1, 1). Odd length is a misframed stream → `ValueError`."""
    import numpy as np

    if len(data) % _SAMPLE_BYTES:
        raise ValueError(f"pcm16 must be an even number of bytes (got {len(data)})")
    return np.frombuffer(data, dtype="<i2").astype(np.float32) / np.float32(_PCM16_SCALE)


def float32_to_pcm16(samples: NDArray[np.float32]) -> bytes:
    """float32 → pcm16 LE bytes: × 32768, rounded, clipped to the int16 range (the exact inverse of
    `pcm16_to_float32` on its own output)."""
    import numpy as np

    scaled = np.rint(np.asarray(samples, dtype=np.float64) * _PCM16_SCALE)
    return np.clip(scaled, -32768, 32767).astype("<i2").tobytes()


class PcmResampler:
    """Streaming pcm16 LE mono resampler, ONE per live leg — PyAV's `AudioResampler` (libswresample).

    Replaces `core/audio.Pcm16Resampler` (linear, no anti-alias filter) on the VAD path at the flip; the
    linear class keeps only the Speaches 24 kHz hop until S10 deletes it. Measured on av 19.0.1
    (session-64 audit §D): fed in 40 ms chunks it is bit-identical to one whole-signal pass; a −6 dBFS
    9 kHz tone at 48/44.1 kHz lands on its 7 kHz alias ≈ 61 dB down; the filter holds a constant
    16-sample delay line that only `flush()` returns (the first 40 ms frame yields 624 samples, then 640).

    Each frame gets a monotonic `pts` in the source time base (libswresample keys its timeline on it).
    `identity` (src == dst, the 16 kHz main path) is a pass-through that never touches PyAV.
    """

    def __init__(self, src_rate: int, dst_rate: int = MODEL_RATE) -> None:
        if src_rate <= 0 or dst_rate <= 0:
            raise ValueError(f"sample rates must be positive (got {src_rate} -> {dst_rate})")
        self.src_rate = src_rate
        self.dst_rate = dst_rate
        self._pts = 0
        self._flushed = False
        self._resampler = None
        if not self.identity:
            import av

            self._resampler = av.AudioResampler(format="s16", layout="mono", rate=dst_rate)

    @property
    def identity(self) -> bool:
        return self.src_rate == self.dst_rate

    def feed(self, frame: bytes) -> bytes:
        """Resample one frame; the filter state carries into the next call."""
        if len(frame) % _SAMPLE_BYTES:
            raise ValueError(f"pcm16 frame must be an even number of bytes (got {len(frame)})")
        if self._flushed:
            raise RuntimeError("feed after flush: a new leg needs a new resampler")
        if not frame or self._resampler is None:
            return frame
        import av
        import numpy as np

        samples = np.frombuffer(frame, dtype="<i2").reshape(1, -1)
        audio = av.AudioFrame.from_ndarray(samples, format="s16", layout="mono")
        audio.sample_rate = self.src_rate
        audio.time_base = Fraction(1, self.src_rate)
        audio.pts = self._pts
        self._pts += samples.shape[1]
        return frames_to_pcm16(self._resampler.resample(audio))

    def flush(self) -> bytes:
        """Drain the filter's delay line (the tail of the last frame). Call once, at the end: the
        resampler is spent afterwards (a later `feed` raises)."""
        self._flushed = True
        if self._resampler is None:
            return b""
        return frames_to_pcm16(self._resampler.resample(None))


def frames_to_pcm16(frames: list) -> bytes:
    """PyAV s16 mono `AudioFrame`s → pcm16 LE bytes — the ONE conversion the wrapper and the decode use."""
    return b"".join(f.to_ndarray().astype("<i2").tobytes() for f in frames)


class HopBuffer:
    """The ONE residual / pad / clamp helper (§3.4.1 ②) — between audio of any length and a model that
    consumes whole hops.

    `push(x)` appends samples and returns the largest whole-hop prefix of everything held (possibly
    empty); the `< hop` remainder waits for the next push, so nothing is dropped and no boundary is
    quantised to the caller's frame (a 40 ms frame is 1.25 Silero hops). `pad()` zero-pads the leftover to
    ONE hop so the last real samples are judged (empty when there is none). `clamp(m)` caps a model-sample
    position at `real_end` — the exclusive end of the real audio — so an edge that lands in the pad never
    reports a position past the recording. A delayed model's drain (`delay_hops·hop` zeros) belongs here
    too, but is written only when such a model is registered (§3.4.1 "named exits").
    """

    def __init__(self, hop: int) -> None:
        import numpy as np

        if hop <= 0:
            raise ValueError(f"hop must be positive (got {hop})")
        self.hop = hop
        self.real_end = 0
        self._rest = np.zeros(0, dtype=np.float32)

    def push(self, samples: NDArray[np.float32]) -> NDArray[np.float32]:
        import numpy as np

        self.real_end += len(samples)
        held = np.concatenate([self._rest, np.asarray(samples, dtype=np.float32)])
        whole = len(held) - len(held) % self.hop
        self._rest = held[whole:]
        return held[:whole]

    def pad(self) -> NDArray[np.float32]:
        import numpy as np

        rest, self._rest = self._rest, np.zeros(0, dtype=np.float32)
        if not len(rest):
            return rest
        return np.concatenate([rest, np.zeros(self.hop - len(rest), dtype=np.float32)])

    def clamp(self, m: int) -> int:
        return min(m, self.real_end)
