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

`trim_wav_silence` (D76 S3a) is the other resident: synthesized clips arrive padded with hundreds of
milliseconds of digital silence, and the one TTS chokepoint (`VoiceClient.synthesize`) cuts it here.
"""

from __future__ import annotations

import struct
import sys
from array import array
from math import gcd, sumprod

#: Speaches' realtime wire rate — hardcoded in its `input_audio_buffer_event_router`, no negotiation
#: (§7-S0 ②; `tools/speaches_realtime_smoke.py` pins the same constant).
SPEACHES_WIRE_RATE = 24000

#: Bytes per pcm16 mono sample.
_SAMPLE_BYTES = 2

#: The level under which a frame is a digital PAD, not signal (PocketTTS pads at −81 dBFS; the first
#: voiced 10 ms frame measured −21 → −16 dBFS across three clips). Estimator policy, not a preference
#: — a knob would be a second threshold beside the client's own floor.
TRIM_SILENCE_DBFS = -60.0
#: Kept before the first signal frame / after the last one: a soft onset is not a pad, a decaying
#: consonant is not a pad.
TRIM_LEAD_MS = 40
TRIM_TAIL_MS = 120
#: The analysis frame.
TRIM_FRAME_MS = 10
#: Consecutive frames at/over the threshold that make an ONSET (and, read from the end, the last
#: sound). A lone loud frame is a click, not speech: every PocketTTS clip opens with a ~−58 dBFS
#: decoder blip confined to its first 10 ms frame (measured 2026-09-25, identical across voices and
#: texts) — counted as signal, it pins the cut to sample 0 and the whole pad survives.
TRIM_MIN_RUN_FRAMES = 2

# RIFF/WAVE layout — format constants of the container, not tunables.
_RIFF_HEAD = 12  # "RIFF" + u32 size + "WAVE"
_CHUNK_HEAD = 8  # 4-byte id + u32 LE size
_WAVE_PCM = 0x0001
_WAVE_FLOAT = 0x0003
_WAVE_EXTENSIBLE = 0xFFFE
#: The KSDATAFORMAT_SUBTYPE_* GUID tail every PCM/float SubFormat shares — the first two bytes of the
#: 16-byte SubFormat are the plain format tag, so EXTENSIBLE resolves back onto the tags above.
_SUBFORMAT_TAIL = b"\x00\x00\x00\x00\x10\x00\x80\x00\x00\xaa\x00\x38\x9b\x71"
_FMT_BASE_LEN = 16  # tag, channels, rate, byte rate, block align, bits
_FMT_EXT_LEN = 40  # + cbSize, valid bits, channel mask, SubFormat
_SUBFORMAT_AT = 24  # SubFormat's offset inside an EXTENSIBLE fmt body
#: A streaming writer that never seeks back leaves the size it could not know as 0 or all-ones.
_UNKNOWN_SIZES = (0, 0xFFFFFFFF)
#: (typecode, full scale) per accepted (tag, bits): the ONLY two shapes trimmed — pcm16 and float32.
_SAMPLE_KINDS = {(_WAVE_PCM, 16): ("h", 32768.0), (_WAVE_FLOAT, 32): ("f", 1.0)}


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


def is_wav(data: bytes) -> bool:
    """Is this a RIFF/WAVE container? The ONE sniff `trim_wav_silence` and the TTS chokepoint's media
    type share — a provider that answers WAV to another format's ask (PocketTTS, to any) is recognised
    by its bytes in both places."""
    return len(data) >= _RIFF_HEAD and data[:4] == b"RIFF" and data[8:12] == b"WAVE"


def trim_wav_silence(
    data: bytes,
    *,
    threshold_dbfs: float = TRIM_SILENCE_DBFS,
    lead_ms: int = TRIM_LEAD_MS,
    tail_ms: int = TRIM_TAIL_MS,
) -> bytes:
    """Cut the leading/trailing digital pad off a WAV clip, keeping `lead_ms`/`tail_ms` of it.

    Why it exists: PocketTTS pads every clip with 320–760 ms of −81 dBFS silence before the first
    sound, so every sentence starts that much late AND the live call's leak probe (which listens to the
    head of each chunk for the reply bleeding into the mic) hears nothing but pad and releases the ear.

    A pass-through for everything it does not fully understand — not RIFF/WAVE (mp3/opus/…: there is
    no stdlib decoder, so those are simply not ours), a format other than pcm16 / float32 (plain or
    WAVE_FORMAT_EXTENSIBLE with a PCM/float SubFormat), more than two channels, a truncated or
    streaming-written `data` chunk (size 0 / all-ones / past the buffer), an all-silent clip (not ours
    to erase), or a clip whose cut would be the whole thing — returns `data` itself, the SAME object.
    Never raises for bad input.

    The level is the RMS of each `TRIM_FRAME_MS` frame across all channels, compared against
    `threshold_dbfs` in the linear power domain (`rms >= 10**(dB/20) * full_scale` — the dB form
    without a log per frame). Sound starts at the first run of `TRIM_MIN_RUN_FRAMES` loud frames and
    ends at the last such run, so an isolated click at either end is cut with the pad. The cut is in
    sample FRAMES, so channels never shear.

    The output keeps every chunk before `data` byte-for-byte (a `LIST`/`fact` between `fmt ` and
    `data` included, pad bytes and all), rewrites only the `data` size and the RIFF size, and drops
    whatever followed `data` (trailing metadata nothing downstream reads). Every accepted format has an
    even block align, so the trimmed `data` is word-aligned and never needs a pad byte of its own."""
    n_buf = len(data)
    if not is_wav(data):
        return data

    # Walk the chunk list up to `data`. Chunks are word-aligned: an odd-sized body is followed by one
    # pad byte that its size does not count, so every skip is `size + size % 2`.
    pos = _RIFF_HEAD
    fmt: tuple[int, int, int, int, int] | None = None  # (tag, channels, rate, block align, bits)
    while True:
        if pos + _CHUNK_HEAD > n_buf:
            return data  # ran out of buffer before a `data` chunk
        cid = data[pos : pos + 4]
        (size,) = struct.unpack_from("<I", data, pos + 4)
        body = pos + _CHUNK_HEAD
        if cid == b"data":
            break
        if body + size > n_buf:
            return data
        if cid == b"fmt " and fmt is None:
            fmt = _parse_fmt(data[body : body + size])
            if fmt is None:
                return data
        pos = body + size + size % 2
    if fmt is None or size in _UNKNOWN_SIZES or body + size > n_buf:
        return data
    tag, channels, rate, block_align, bits = fmt
    if size % block_align:
        return data  # a torn final sample frame — malformed, not ours to guess at

    typecode, full_scale = _SAMPLE_KINDS[(tag, bits)]
    samples = array(typecode)
    samples.frombytes(data[body : body + size])
    if sys.byteorder != "little":  # WAV is little-endian; `array` reads native
        samples.byteswap()

    n_frames = size // block_align
    step = max(1, rate * TRIM_FRAME_MS // 1000) * channels  # samples per analysis frame
    level = (10 ** (threshold_dbfs / 20) * full_scale) ** 2  # mean-square at the threshold
    total = len(samples)

    def loud(at: int) -> bool:
        seg = samples[at : at + step]
        return sumprod(seg, seg) >= level * len(seg)

    def run_end(order: range) -> int | None:
        """The frame at which the first `TRIM_MIN_RUN_FRAMES`-long loud run along `order` completes."""
        streak = 0
        for at in order:
            streak = streak + 1 if loud(at) else 0
            if streak == TRIM_MIN_RUN_FRAMES:
                return at
        return None

    starts = range(0, total, step)
    span = (TRIM_MIN_RUN_FRAMES - 1) * step
    onset = run_end(starts)
    if onset is None:
        return data
    first = onset - span
    back = run_end(starts[::-1])  # never None once `onset` exists: a forward run is a backward one
    last = (onset if back is None else back) + span

    lead = max(0, rate * lead_ms // 1000)
    tail = max(0, rate * tail_ms // 1000)
    cut_lo = max(0, first // channels - lead)
    cut_hi = min(n_frames, min(total, last + step) // channels + tail)
    if cut_lo == 0 and cut_hi == n_frames:
        return data

    trimmed = data[body + cut_lo * block_align : body + cut_hi * block_align]
    head = data[_RIFF_HEAD:pos]  # every pre-`data` chunk, verbatim
    riff_size = 4 + len(head) + _CHUNK_HEAD + len(trimmed)
    return b"".join(
        (
            b"RIFF",
            struct.pack("<I", riff_size),
            b"WAVE",
            head,
            b"data",
            struct.pack("<I", len(trimmed)),
            trimmed,
        )
    )


def _parse_fmt(body: bytes) -> tuple[int, int, int, int, int] | None:
    """`(tag, channels, rate, block align, bits)` for a `fmt ` body `trim_wav_silence` can measure, the
    EXTENSIBLE tag resolved onto its SubFormat's plain tag; `None` for anything else (the caller passes
    the clip through)."""
    if len(body) < _FMT_BASE_LEN:
        return None
    tag, channels, rate, _byte_rate, block_align, bits = struct.unpack_from("<HHIIHH", body)
    if tag == _WAVE_EXTENSIBLE:
        if len(body) < _FMT_EXT_LEN or body[_SUBFORMAT_AT + 2 : _SUBFORMAT_AT + 16] != _SUBFORMAT_TAIL:
            return None
        (tag,) = struct.unpack_from("<H", body, _SUBFORMAT_AT)
    if (tag, bits) not in _SAMPLE_KINDS or channels not in (1, 2) or rate <= 0:
        return None
    if block_align != channels * bits // 8:
        return None
    return tag, channels, rate, block_align, bits
