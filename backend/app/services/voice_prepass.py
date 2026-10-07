"""The pre-ASR pass + the bounded decode (Phase 26 / D82, ASR_PLAN §3.6; S6-i, session-64 rulings H4/H7/H8).

**The pass** decides whether a span of audio reaches ASR at all, and what of it does: a fresh-state batch
run of the configured `vad_model` (its own stream — the live leg's state is never touched) at the model's
`prepass_act` (never `vad_threshold`, §3.4.1 ⑤). It implements the PLAN'S literal rule on the raw per-hop
probabilities (ruling H7 — no EMA, no port of faster-whisper's `get_speech_timestamps`):

1. hysteresis `prepass_act` / `deact_of(prepass_act)` → speech spans; spans separated by less than
   `PREPASS_MIN_SILENCE_MS` merge;
2. none → `no_speech` (no ASR call);
3. else ONE crop `[first − PREPASS_PAD_MS, last + PREPASS_PAD_MS]`, the head clamped to the buffer, the
   tail ZERO-PADDED so at least `PREPASS_PAD_MS` follows the last span (R97 P-5a's tail pad — a
   `max_segment` cut or a `flush` ends mid-air);
4. a crop longer than `PREPASS_MAX_CHUNK_S` splits BETWEEN spans, greedily — each chunk keeps its own
   ±`PREPASS_PAD_MS`, never past the middle of the silence gap it sits in; a single span longer than the cap
   is hard-cut at it.

`scan()` is the shared first step (probabilities + spans) a later stage reuses without a second VAD run
(D85's voiced span; enrolment). The return is a small frozen dataclass, so D85's `Verdict` widening is
additive. **The decode** turns an upload (MediaRecorder webm/ogg/mp4, wav — PyAV detects the container)
into 16 kHz mono, BOUNDED by decoded duration and by wall time (council 15) — both PARAMETERS, so the clip
door (`dictation_max_s + 60`) and D85's enrolment (60) share one function. Everything is sync; callers
wrap it in `to_thread`. Raw bytes are never logged or forwarded. Import-safe (ruling H1).
"""

from __future__ import annotations

import io
import time
from collections.abc import Callable
from dataclasses import dataclass
from typing import TYPE_CHECKING, Literal

from app.services.voice_audio import MODEL_RATE, HopBuffer, frames_to_pcm16, pcm16_to_float32
from app.services.voice_vad import VadModel, deact_of

if TYPE_CHECKING:
    import numpy as np
    from numpy.typing import NDArray

# Code constants, not keys (ASR_PLAN §4 "Not keys"): the values Speaches' HTTP door ran
# (faster-whisper's defaults, R94-evidence L3 §3.4), kept so the clip door's behaviour carries over.
#: Speech spans closer than this merge into one (a breath between words is not a boundary).
PREPASS_MIN_SILENCE_MS = 160
#: Audio kept around the speech — before the first span and (zero-padded if need be) after the last.
PREPASS_PAD_MS = 400
#: The longest chunk sent to ASR in one request; a longer crop splits between spans.
PREPASS_MAX_CHUNK_S = 30

#: The decode's default wall-time bound (council 15).
DECODE_MAX_WALL_S = 60.0


class UndecodableAudio(ValueError):
    """The upload is not audio PyAV can decode (the route answers 422, S9)."""


class DecodeAborted(Exception):
    """The decode passed one of its bounds — `bound` names which (`"decoded"` duration or `"wall"`)."""

    def __init__(self, bound: Literal["decoded", "wall"], limit_s: float) -> None:
        super().__init__(f"decode aborted past the {bound} bound ({limit_s:g} s)")
        self.bound = bound
        self.limit_s = limit_s


def decode_to_pcm16k(
    data: bytes,
    *,
    max_decoded_s: float,
    max_wall_s: float = DECODE_MAX_WALL_S,
    from_ms: int = 0,
    clock: Callable[[], float] = time.monotonic,
) -> NDArray[np.float32]:
    """Decode an upload to 16 kHz mono float32, aborting past `max_decoded_s` of decoded audio (counted
    from the file's start, `from_ms` included) or `max_wall_s` of wall time. `from_ms` trims the decoded
    head (the S8 recovery's suffix). Undecodable → `UndecodableAudio`; a bound → `DecodeAborted`."""
    import av
    import numpy as np
    from av.error import FFmpegError

    started = clock()
    limit = int(max_decoded_s * MODEL_RATE)
    parts: list[bytes] = []
    decoded = 0
    try:
        with av.open(io.BytesIO(data), mode="r") as container:
            if not container.streams.audio:
                raise UndecodableAudio("no audio stream")
            resampler = av.AudioResampler(format="s16", layout="mono", rate=MODEL_RATE)
            for frame in container.decode(container.streams.audio[0]):
                parts.append(frames_to_pcm16(resampler.resample(frame)))
                decoded += len(parts[-1]) // 2
                if decoded > limit:
                    raise DecodeAborted("decoded", max_decoded_s)
                if clock() - started > max_wall_s:
                    raise DecodeAborted("wall", max_wall_s)
            parts.append(frames_to_pcm16(resampler.resample(None)))
            decoded += len(parts[-1]) // 2
    except FFmpegError as exc:
        raise UndecodableAudio(type(exc).__name__) from None
    if decoded > limit:
        raise DecodeAborted("decoded", max_decoded_s)
    pcm = pcm16_to_float32(b"".join(parts))
    head = max(from_ms, 0) * MODEL_RATE // 1000
    return np.ascontiguousarray(pcm[head:])


@dataclass(frozen=True, slots=True)
class PrepassResult:
    """What the pass decided. `spans` are the merged speech spans in 16 kHz samples of the INPUT;
    `chunks` the audio to transcribe, in order (empty on `no_speech`); `hop` the model's."""

    outcome: Literal["ok", "no_speech"]
    chunks: list[NDArray[np.float32]]
    spans: list[tuple[int, int]]
    hop: int


def scan(
    pcm16k: NDArray[np.float32], model: VadModel, *, act: float | None = None
) -> tuple[NDArray[np.float32], list[tuple[int, int]]]:
    """One fresh-state VAD run over a whole buffer → (per-hop raw probabilities, merged speech spans).

    The buffer rides the SAME `HopBuffer` the live segmenter uses (the leftover zero-padded to one hop,
    span ends clamped to the real audio). A span is the hops from a `≥ act` crossing to the first
    `< deact` hop (exclusive); spans closer than `PREPASS_MIN_SILENCE_MS` merge. `act` defaults to the
    model's `prepass_act` — the override exists for the replay's `--prepass-sweep` (S6-ii ruling H7: the
    §6.4 S9 gate row sweeps it), never for a runtime caller."""
    import numpy as np

    hops = HopBuffer(model.hop)
    block = np.concatenate([hops.push(pcm16k), hops.pad()])
    probs = model.open().probs(block) if len(block) else np.zeros(0, dtype=np.float32)
    act = model.prepass_act if act is None else act
    deact = deact_of(act)
    raw: list[tuple[int, int]] = []
    start: int | None = None
    for j, p in enumerate(probs.tolist()):
        if start is None and p >= act:
            start = j
        elif start is not None and p < deact:
            raw.append((start * model.hop, j * model.hop))
            start = None
    if start is not None:
        raw.append((start * model.hop, len(probs) * model.hop))
    min_gap = PREPASS_MIN_SILENCE_MS * MODEL_RATE // 1000
    spans: list[tuple[int, int]] = []
    for s, e in raw:
        s, e = hops.clamp(s), hops.clamp(e)
        if spans and s - spans[-1][1] < min_gap:
            spans[-1] = (spans[-1][0], e)
        else:
            spans.append((s, e))
    return probs, spans


def prepass(pcm16k: NDArray[np.float32], model: VadModel, *, act: float | None = None) -> PrepassResult:
    """The pre-ASR pass (module docstring). `model` is the configured `vad_model` (`get_model(...)`);
    `act` overrides its `prepass_act` (the replay's sweep only — `scan`, ruling H7)."""
    import numpy as np

    _, spans = scan(pcm16k, model, act=act)
    if not spans:
        return PrepassResult("no_speech", [], [], model.hop)
    pad = PREPASS_PAD_MS * MODEL_RATE // 1000
    crop_start = max(spans[0][0] - pad, 0)
    crop_end = spans[-1][1] + pad
    shortfall = crop_end - len(pcm16k)  # the tail pad: zeros where the buffer ends before the pad does
    audio = np.asarray(pcm16k, dtype=np.float32)
    if shortfall > 0:
        audio = np.concatenate([audio, np.zeros(shortfall, dtype=np.float32)])
    cap = PREPASS_MAX_CHUNK_S * MODEL_RATE
    # A chunk holding spans a..k runs from span a's lead pad to span k's tail pad, and neither pad reaches
    # past the middle of the silence gap it sits in (so two chunks never share audio). The greedy walk
    # adds spans while the chunk stays within the cap.
    mids = [(e + s2) // 2 for (_, e), (s2, _) in zip(spans, spans[1:], strict=False)]
    ends = [min(e + pad, mid) for (_, e), mid in zip(spans, mids, strict=False)] + [crop_end]
    starts = [crop_start] + [max(s - pad, mid) for (s, _), mid in zip(spans[1:], mids, strict=True)]
    chunks: list[NDArray[np.float32]] = []
    lo, k = crop_start, 0
    while k < len(spans):
        hi = None
        while k < len(spans) and ends[k] - lo <= cap:
            hi, k = ends[k], k + 1
        if hi is None:  # one span (with its pads) longer than the cap: a hard cut AT the cap (H7)
            chunks.append(audio[lo : lo + cap])
            lo += cap
            continue
        chunks.append(audio[lo:hi])
        if k < len(spans):
            lo = starts[k]
    return PrepassResult("ok", chunks, spans, model.hop)
